// Runs in a dedicated Chromium isolated world. Only the fixed operations below
// can access the page; callers cannot pass JS, selectors, URLs or credentials.
export async function videoPage(operation, args) {
  const catalog = globalThis.__vamoonVideoCatalog ??= {
    documentId: Math.random().toString(36).slice(2), next: 0, ids: new WeakMap(),
  };
  const videos = Array.from(document.querySelectorAll('video')).slice(0, 32);
  function key(video) {
    const source = video.currentSrc || video.src;
    const prior = catalog.ids.get(video);
    if (prior && prior.source === source && prior.stream === video.srcObject) return prior.id;
    const id = 'v-' + catalog.documentId + '-' + (++catalog.next);
    catalog.ids.set(video, { id, source, stream: video.srcObject });
    return id;
  }
  const seconds = value => Number.isFinite(value) ? Math.round(value * 1000) / 1000 : null;
  function bounds(video) {
    const r = video.getBoundingClientRect();
    const x = Math.max(0, r.left), y = Math.max(0, r.top);
    const width = Math.min(innerWidth, r.right) - x;
    const height = Math.min(innerHeight, r.bottom) - y;
    if (width < 8 || height < 8 || getComputedStyle(video).visibility !== 'visible') return null;
    const front = document.elementFromPoint(x + width / 2, y + height / 2);
    // Cropped image must be the visible player, never a dialog in front of it.
    if (front !== video) return null;
    return { x, y, width, height, viewport_width: innerWidth, viewport_height: innerHeight };
  }
  function describe(video) {
    return {
      video_id: key(video), label: (video.getAttribute('aria-label') || video.title || '').slice(0, 250),
      duration_seconds: seconds(video.duration), position_seconds: seconds(video.currentTime),
      paused: video.paused, ended: video.ended, seeking: video.seeking, playback_rate: video.playbackRate,
      live: video.duration === Infinity, visible: Boolean(bounds(video)), ready: video.readyState >= 2,
      protected: Boolean(video.mediaKeys), width: video.videoWidth, height: video.videoHeight,
      seekable: Array.from({ length: Math.min(video.seekable.length, 10) }, (_, i) => ({
        start_seconds: seconds(video.seekable.start(i)), end_seconds: seconds(video.seekable.end(i)),
      })),
      text_tracks: Array.from(video.textTracks).slice(0, 8).map(track => ({
        language: track.language, label: track.label.slice(0, 100), kind: track.kind, mode: track.mode,
        cues_loaded: track.cues !== null,
      })),
    };
  }
  if (operation === 'list') return videos.map(describe);
  const video = videos.find(candidate => key(candidate) === args.video_id);
  if (!video) return { error: 'VIDEO_CHANGED' };
  if (operation === 'info') return describe(video);
  if (operation === 'captions') {
    const captions = [];
    for (const track of Array.from(video.textTracks).slice(0, 8)) {
      if (!['subtitles', 'captions'].includes(track.kind) || !track.cues) continue;
      for (const cue of Array.from(track.cues)) {
        if (cue.endTime <= args.start || cue.startTime >= args.end || typeof cue.text !== 'string') continue;
        captions.push({ start_seconds: seconds(cue.startTime), end_seconds: seconds(cue.endTime),
          language: track.language, text: cue.text.slice(0, 600), source: 'text_track' });
        if (captions.length > 80) return { captions: captions.slice(0, 80), truncated: true };
      }
    }
    return { captions, truncated: false };
  }
  if (video.mediaKeys) return { error: 'PROTECTED_MEDIA' };
  if (operation === 'frame') {
    if (video.readyState < 2 || !video.videoWidth || video.seeking) return { error: 'VIDEO_NOT_READY' };
    const time_seconds = seconds(video.currentTime);
    try {
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
      canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
      return { time_seconds, data: canvas.toDataURL('image/jpeg', 0.8).split(',')[1] };
    } catch (error) {
      if (error.name !== 'SecurityError') throw error;
      return { time_seconds, bounds: bounds(video), error: 'DIRECT_FRAME_UNAVAILABLE' };
    }
  }
  if (operation === 'seek' || operation === 'restore') {
    const time = args.seconds;
    const seekable = Array.from({ length: video.seekable.length }, (_, i) => i)
      .some(i => time >= video.seekable.start(i) && time <= video.seekable.end(i));
    if (!seekable) return { error: 'TIME_NOT_SEEKABLE' };
    video.pause();
    if (Math.abs(video.currentTime - time) > 0.001) {
      let timer, listener;
      try {
        await new Promise((resolve, reject) => {
          listener = resolve;
          video.addEventListener('seeked', listener, { once: true });
          timer = setTimeout(() => reject(new Error('Seek timed out')), 1750);
          video.currentTime = time;
        });
      } catch { return { error: 'SEEK_TIMEOUT' }; }
      finally { clearTimeout(timer); video.removeEventListener('seeked', listener); }
    }
    if (operation === 'restore' && args.play) {
      try {
        const resumed = await Promise.race([
          video.play().then(() => true), new Promise(resolve => setTimeout(() => resolve(false), 600)),
        ]);
        if (!resumed) return { error: 'PLAYBACK_RESUME_UNCONFIRMED' };
      } catch { return { error: 'PLAYBACK_RESUME_FAILED' }; }
    }
    return describe(video);
  }
  if (operation === 'audio') {
    if (video.paused || video.ended) return { status: 'not_playing' };
    if (!('captureStream' in video) || !globalThis.MediaRecorder) return { status: 'unsupported' };
    let stream;
    try { stream = video.captureStream(); }
    catch (error) { return { status: error.name === 'SecurityError' ? 'origin_restricted' : 'unavailable' }; }
    try {
      const tracks = stream.getAudioTracks().filter(track => track.readyState === 'live');
      if (!tracks.length) return { status: 'no_accessible_audio_track' };
      if (tracks.every(track => track.muted)) return { status: 'muted_or_restricted' };
      const start_seconds = seconds(video.currentTime);
      const playback_rate = video.playbackRate;
      const started = performance.now();
      let interrupted = false;
      let end_seconds;
      const mime_type = 'audio/webm;codecs=opus';
      if (!MediaRecorder.isTypeSupported(mime_type)) return { status: 'unsupported' };
      const recorder = new MediaRecorder(new MediaStream(tracks), { mimeType: mime_type, audioBitsPerSecond: 48000 });
      const chunks = [];
      const blob = await new Promise(resolve => {
        const stop = () => {
          if (recorder.state === 'inactive') return;
          end_seconds = seconds(video.currentTime);
          recorder.stop();
        };
        const stopOnDiscontinuity = () => { interrupted = true; stop(); };
        const timer = setTimeout(stop, args.milliseconds);
        const finish = blob => {
          clearTimeout(timer);
          for (const event of ['pause', 'ended']) video.removeEventListener(event, stop);
          for (const event of ['seeking', 'ratechange', 'waiting']) video.removeEventListener(event, stopOnDiscontinuity);
          resolve(blob);
        };
        for (const event of ['pause', 'ended']) video.addEventListener(event, stop);
        for (const event of ['seeking', 'ratechange', 'waiting']) video.addEventListener(event, stopOnDiscontinuity);
        recorder.ondataavailable = event => chunks.push(event.data);
        recorder.onerror = () => finish(null);
        recorder.onstop = () => finish(new Blob(chunks, { type: mime_type }));
        try { recorder.start(); } catch { finish(null); }
      });
      if (!blob?.size || blob.size > 100000 || !video.isConnected || key(video) !== args.video_id) {
        return { status: 'no_usable_audio' };
      }
      const elapsed = (performance.now() - started) * playback_rate / 1000;
      const timing = !interrupted && end_seconds > start_seconds && Math.abs(end_seconds - start_seconds - elapsed) < 0.5
        ? 'continuous' : 'interrupted';
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      return { status: 'available', source: 'player_audio', start_seconds,
        end_seconds: timing === 'continuous' ? end_seconds : null, playback_rate, timing, mime_type: 'audio/webm', data };
    } finally {
      for (const track of stream.getTracks()) track.stop();
    }
  }
  throw new Error('Unsupported video operation');
}
