import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

export async function transcribeVideoAudio(dataDir, audio, data, language) {
  const modelDir = path.join(dataDir, 'media-models');
  const modelName = 'ggml-base-q5_1.bin';
  if (!existsSync(path.join(modelDir, modelName))) return { status: 'local_model_unavailable' };
  if (audio.timing !== 'continuous') return { status: 'audio_timing_unavailable' };

  const result = await new Promise(resolve => {
    const filter = `whisper=model=${modelName}:language=${language}:queue=8:use_gpu=false:format=json:destination='pipe\\:1'`;
    const child = spawn('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'error', '-f', 'matroska', '-i', 'pipe:0',
      '-af', filter, '-f', 'null', '-'], { cwd: modelDir, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    let output = '';
    let stopped;
    const timer = setTimeout(() => { stopped = 'transcription_timeout'; child.kill(); }, 12000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      output += chunk;
      if (output.length > 32000) { stopped = 'transcript_too_large'; child.kill(); }
    });
    child.stdin.on('error', () => {});
    child.once('error', error => {
      stopped = error.code === 'ENOENT' ? 'local_decoder_unavailable' : 'transcription_failed';
    });
    child.once('close', code => {
      clearTimeout(timer);
      resolve(stopped ? { status: stopped } : code === 0 ? { output } : { status: 'transcription_failed' });
    });
    child.stdin.end(Buffer.from(data, 'base64'));
  });
  if (result.status) return result;

  const round = value => Math.round(value * 1000) / 1000;
  const time = ms => round(Math.min(audio.end_seconds, audio.start_seconds + ms * audio.playback_rate / 1000));
  try {
    const segments = result.output.trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line))
      .filter(row => typeof row.text === 'string' && row.text.trim() && Number.isFinite(row.start) && Number.isFinite(row.end))
      .map(row => ({ start_seconds: time(Math.max(0, row.start)), end_seconds: time(Math.max(0, row.end)),
        text: row.text.trim().slice(0, 600) }))
      .filter(segment => segment.end_seconds > segment.start_seconds);
    return { status: segments.length ? 'available' : 'no_speech_recognized', source: 'local_asr',
      requested_language: language, coverage_start_seconds: audio.start_seconds, coverage_end_seconds: audio.end_seconds, segments };
  } catch {
    return { status: 'transcription_failed' };
  }
}
