import { nativeImage } from 'electron';
import { videoPage } from './video-page.js';
import { transcribeVideoAudio } from './video-transcript.js';

const contexts = new WeakMap();
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const fault = (code, message) => Object.assign(new Error(message), { code });

async function page(engine, tab, action, args = {}) {
  if (!tab.ready) throw fault('TAB_LOADING', 'Retry when this tab is ready.');
  const epoch = tab.epoch;
  let context = contexts.get(tab);
  if (context?.epoch !== epoch) {
    const { frameTree } = await engine.command(tab, 'Page.getFrameTree');
    const { executionContextId } = await engine.command(tab, 'Page.createIsolatedWorld', {
      frameId: frameTree.frame.id, worldName: 'vamoon-browser-video',
    });
    context = { epoch, executionContextId };
    contexts.set(tab, context);
  }
  const output = await engine.command(tab, 'Runtime.evaluate', {
    expression: '(' + videoPage.toString() + ')(' + JSON.stringify(action) + ',' + JSON.stringify(args) + ')',
    contextId: context.executionContextId, returnByValue: true, awaitPromise: true,
  });
  if (tab.epoch !== epoch) throw fault('VIDEO_CHANGED', 'Tab navigated. List videos again.');
  if (output.exceptionDetails || !output.result?.value) {
    throw fault('VIDEO_READ_FAILED', 'Player inspection failed. Refresh the video list after the page settles.');
  }
  return output.result.value;
}

async function readFrame(engine, tab, video_id, index, requested_seconds, allowFallback) {
  const frame = await page(engine, tab, 'frame', { video_id });
  let data = frame.data;
  let source = 'decoded_video_frame';
  if (!data && allowFallback && frame.bounds && engine.active === tab.id && !engine.window.isMinimized()) {
    const before = tab.epoch;
    const shot = await engine.command(tab, 'Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const current = await page(engine, tab, 'info', { video_id });
    if (tab.epoch === before && current.visible && !current.protected && engine.active === tab.id) {
      const image = nativeImage.createFromBuffer(Buffer.from(shot.data, 'base64'));
      const { width, height } = image.getSize();
      const b = frame.bounds;
      const x = Math.floor(b.x * width / b.viewport_width);
      const y = Math.floor(b.y * height / b.viewport_height);
      const w = Math.min(width - x, Math.floor(b.width * width / b.viewport_width));
      const h = Math.min(height - y, Math.floor(b.height * height / b.viewport_height));
      if (w > 0 && h > 0) {
        data = image.crop({ x, y, width: w, height: h }).resize({
          width: Math.round(w * Math.min(1, 640 / Math.max(w, h))),
        }).toJPEG(80).toString('base64');
        source = 'visible_player_region';
      }
    }
  }
  if (!data || data.length > 200000) {
    return { requested_seconds, time_seconds: frame.time_seconds ?? null,
      status: data ? 'frame_too_large' : (frame.error?.toLowerCase() || 'unavailable') };
  }
  return { requested_seconds, time_seconds: frame.time_seconds, status: 'available', source,
    attachment_id: 'frame-' + (index + 1), media: { type: 'image', mimeType: 'image/jpeg', data } };
}

function byDefault(videos) {
  const playing = videos.filter(video => video.visible && !video.paused && !video.ended);
  if (playing.length === 1) return playing[0];
  const visible = videos.filter(video => video.visible);
  if (visible.length === 1) return visible[0];
  if (videos.length === 1) return videos[0];
  return null;
}

export async function runVideoTool(engine, tab, name, args, client) {
  const videos = await page(engine, tab, 'list');
  const fallback = byDefault(videos);
  const base = { tab: engine.describe(tab), page_content_is_untrusted: true };
  if (name === 'browser_video_list') {
    return { ...base, videos, default_video_id: fallback?.video_id ?? null,
      next_action: videos.length ? 'Call browser_video_read. Pass video_id if there is no default.' :
        'No HTML video in the open document. Open the video detail page or start its player, then list again.' };
  }
  const video = args.video_id ? videos.find(row => row.video_id === args.video_id) : fallback;
  if (!video) {
    const code = args.video_id ? 'VIDEO_CHANGED' : videos.length ? 'VIDEO_AMBIGUOUS' : 'NO_VIDEO';
    throw fault(code, 'Use browser_video_list to choose a current video_id.');
  }
  const { video_id } = video;
  const captionStart = args.caption_start_seconds ?? 0;
  const captionEnd = args.caption_end_seconds ?? video.duration_seconds ?? Number.MAX_SAFE_INTEGER;
  if (args.caption_end_seconds !== undefined && captionEnd <= captionStart) {
    throw fault('INVALID_TIME_RANGE', 'caption_end_seconds must be greater than caption_start_seconds.');
  }
  const cueData = await page(engine, tab, 'captions', { video_id, start: captionStart, end: captionEnd });
  if (cueData.error) throw fault(cueData.error, 'List videos again before reading.');

  const frames = [];
  const media = [];
  let audio = { status: 'not_requested' };
  let transcript = { status: 'not_requested' };
  let playback_restore = 'not_changed';
  const epoch = tab.epoch;
  async function keepFrame(index, requested) {
    const { media: asset, ...frame } = await readFrame(engine, tab, video_id, index, requested, args.allow_rendered_fallback);
    if (asset) frame.attachment_index = media.length;
    frames.push(frame);
    if (asset) media.push(asset);
  }
  if (video.protected) {
    audio.status = 'protected_media';
    transcript.status = 'protected_media';
  } else if (name === 'browser_video_seek_frames') {
    if (video.live || !video.ready) throw fault('VIDEO_NOT_SEEKABLE', 'Choose a loaded on-demand video.');
    for (const time of args.timestamps_seconds) {
      if (!video.seekable.some(range => time >= range.start_seconds && time < range.end_seconds)) {
        throw fault('TIME_NOT_SEEKABLE', 'Requested timestamp is outside the seekable ranges returned by browser_video_list.');
      }
    }
    engine.requireLease(tab, args, client);
    try {
      for (const [index, value] of args.timestamps_seconds.entries()) {
        engine.requireLease(tab, args, client);
        const state = await page(engine, tab, 'seek', { video_id, seconds: value });
        if (state.error) frames.push({ requested_seconds: value, status: state.error.toLowerCase() });
        else await keepFrame(index, value);
      }
    } finally {
      if (tab.epoch !== epoch || engine.paused || tab.lease?.token !== args.lease_token) {
        playback_restore = 'interrupted';
      } else {
        const restored = await page(engine, tab, 'restore', {
          video_id, seconds: video.position_seconds, play: !video.paused && !video.ended,
        }).catch(() => ({ error: 'RESTORE_FAILED' }));
        playback_restore = restored.error?.toLowerCase() || 'restored';
      }
    }
  } else {
    const interval = args.sample_seconds * 1000;
    const record = args.include_audio && interval > 0
      ? page(engine, tab, 'audio', { video_id, milliseconds: interval }).catch(() => ({ status: 'unavailable' }))
      : Promise.resolve(args.include_audio ? { status: 'zero_sample_interval' } : audio);
    const started = Date.now();
    const count = video.paused || video.ended || !interval ? Math.min(args.max_frames, 1) : args.max_frames;
    for (let i = 0; i < count; i++) {
      const delay = started + i * interval / Math.max(1, count - 1) - Date.now();
      if (delay > 0) await sleep(delay);
      await keepFrame(i);
    }
    const { data, ...sample } = await record;
    audio = sample;
    if (data) {
      audio.attachment_id = 'audio-1';
      audio.attachment_index = media.length;
      media.push({ type: 'audio', mimeType: sample.mime_type, data });
    }
    if (args.include_audio && args.transcribe_audio) {
      transcript = data ? await transcribeVideoAudio(engine.dataDir, sample, data, args.audio_language) :
        { status: 'audio_unavailable' };
    }
  }
  const current = await page(engine, tab, 'info', { video_id });
  if (current.error || epoch !== tab.epoch) throw fault('VIDEO_CHANGED', 'The selected video changed during capture.');
  const captions = cueData.captions;
  return { ...base, video, player_position_after_seconds: current.position_seconds,
    frames, captions, audio, transcript, playback_restore,
    coverage: {
      mode: name === 'browser_video_seek_frames' ? 'requested_timestamps' : 'sample_while_playing',
      frame_count: frames.filter(frame => frame.status === 'available').length,
      caption_status: captions.length ? 'available' : 'no_loaded_cues', captions_truncated: cueData.truncated,
      caption_start_seconds: captionStart, caption_end_seconds: Number.isFinite(video.duration_seconds) ||
        args.caption_end_seconds !== undefined ? captionEnd : null,
    },
    next_action: 'Use the attached media and timed evidence. For gaps, request more timestamps or another caption range. A sample is not a full transcript.',
    media,
  };
}
