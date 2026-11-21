import { createHash, randomUUID } from 'node:crypto';
import { runVideoTool } from './video-tools.js';

const fault = (code, message) => Object.assign(new Error(message), { code });
const retentionMs = 15 * 60 * 1000;
const eventHistory = 12;

// Session-local and read-only. Every sample is queued on the original tab.
// Never select a different tab, attach to a new document, or register action refs.
export class TabWatches {
  constructor(engine) {
    this.engine = engine;
    this.items = new Map();
  }

  describe(item) {
    return { watch_id: item.id, tab_id: item.args.tab_id, mode: item.args.mode,
      status: item.status, reason: item.reason, cursor: item.cursor,
      started_at: new Date(item.started).toISOString(), expires_at: new Date(item.deadline).toISOString(),
      next_poll_ms: item.status === 'running' ? item.args.interval_ms : null };
  }

  modesFor(tabId) {
    return [...this.items.values()].filter(item => item.args.tab_id === tabId && item.status === 'running')
      .map(item => item.args.mode);
  }

  emit(item, type, data, media = []) {
    item.events.push({ cursor: ++item.cursor, type, at: new Date().toISOString(), data, media });
    if (item.events.length > eventHistory) item.events.shift();
  }

  end(item, reason) {
    if (item.status !== 'running') return;
    clearTimeout(item.timer);
    clearTimeout(item.expiry);
    item.status = 'stopped';
    item.reason = reason;
    item.finished = Date.now();
    this.emit(item, 'stopped', { reason });
    if (reason !== 'browser_closed') this.engine.emit();
  }

  endTab(tabId, reason) {
    for (const item of this.items.values()) if (item.args.tab_id === tabId) this.end(item, reason);
  }

  endAll(reason) {
    for (const item of this.items.values()) this.end(item, reason);
  }

  async sample(item) {
    if (item.status !== 'running') return;
    const { args, client } = item;
    try {
      await this.engine.enqueue(args.tab_id, async () => {
        if (item.status !== 'running') return;
        const tab = this.engine.get(args.tab_id);
        if (tab.epoch !== item.epoch) { this.end(item, 'navigation_changed'); return; }
        const data = args.mode === 'page'
          ? await this.engine.snapshot(tab, args.max_nodes, false)
          : await runVideoTool(this.engine, tab, 'browser_video_read', {
            ...args, video_id: item.videoId, max_frames: 1, allow_rendered_fallback: false,
          }, client);
        if (item.status !== 'running' || tab.epoch !== item.epoch) return;
        if (data.video && !item.videoId) item.videoId = data.video.video_id;
        const signature = args.mode === 'page' ? [data.tab.url, data.tab.title, data.elements, data.truncated, data.links, data.links_truncated] :
          [data.video.video_id, data.video.paused, data.video.ended, data.video.position_seconds,
            data.audio.status, data.frames.map(frame => frame.status), data.captions];
        const digest = createHash('sha256').update(JSON.stringify(signature)).digest('hex');
        if (item.digest !== digest) {
          const { media, ...content } = data;
          this.emit(item, args.mode === 'page' ? 'page_snapshot' : 'video_sample', content, media);
          item.digest = digest;
        }
        if (data.video?.ended) this.end(item, 'video_ended');
      });
    } catch (error) {
      if (item.status !== 'running') return;
      const code = error.code ?? 'READ_FAILED';
      if (code === 'VIDEO_CHANGED' || code === 'TAB_NOT_FOUND') this.end(item, code.toLowerCase());
      else if (item.digest !== code) {
        this.emit(item, 'read_unavailable', { code });
        item.digest = code;
      }
    } finally {
      if (item.status === 'running') {
        item.timer = setTimeout(() => void this.sample(item), args.interval_ms);
        item.timer.unref();
      }
    }
  }

  call(name, args, client) {
    const now = Date.now();
    for (const item of this.items.values()) {
      if (item.finished && now - item.finished > retentionMs) this.items.delete(item.id);
    }
    if (name === 'browser_watch_list') {
      return { watches: [...this.items.values()].filter(item => item.client === client).map(item => this.describe(item)) };
    }
    if (name === 'browser_watch_start') {
      const request = [...this.items.values()].find(item => item.client === client && item.args.request_id === args.request_id);
      if (request) {
        if (JSON.stringify(request.args) !== JSON.stringify(args)) throw fault('REQUEST_CONFLICT', 'watch request_id already used with different arguments.');
        return { ...this.describe(request), replayed: true };
      }
      const running = [...this.items.values()].filter(item => item.status === 'running');
      if (running.length >= 8 || this.items.size >= 64) throw fault('WATCH_CAPACITY', 'Watch capacity reached. Stop unused monitors or wait for old results to expire.');
      if (running.some(item => item.args.tab_id === args.tab_id && item.args.mode === args.mode)) {
        throw fault('WATCH_EXISTS', 'A monitor of this mode is already running on this tab.');
      }
      const tab = this.engine.get(args.tab_id);
      if (!tab.ready || tab.view.webContents.isLoading()) throw fault('TAB_LOADING', 'Start a watch after this tab has finished loading.');
      const item = { id: randomUUID(), args, client, epoch: tab.epoch, videoId: args.video_id, status: 'running',
        reason: null, started: now, deadline: now + args.duration_seconds * 1000, events: [], cursor: 0 };
      this.items.set(item.id, item);
      this.engine.emit();
      item.expiry = setTimeout(() => this.end(item, 'duration_reached'), item.deadline - now);
      item.expiry.unref();
      void this.sample(item);
      return this.describe(item);
    }
    const item = this.items.get(args.watch_id);
    if (!item || item.client !== client) throw fault('WATCH_NOT_FOUND', 'Use browser_watch_list to find your active or recently stopped watches.');
    if (name === 'browser_watch_stop') { this.end(item, 'stopped_by_client'); return this.describe(item); }
    if (name !== 'browser_watch_poll') throw fault('UNKNOWN_TOOL', name);
    if (args.after_cursor > item.cursor) throw fault('INVALID_CURSOR', 'Use the cursor returned by the latest delivered event.');
    const media = [];
    const events = item.events.filter(event => event.cursor > args.after_cursor).slice(0, args.limit).map(event => {
      const { media: attachments, ...content } = event;
      const attachment_offset = args.include_media && attachments.length ? media.length : null;
      if (attachment_offset !== null) media.push(...attachments);
      return { ...content, attachment_offset, attachment_count: attachment_offset === null ? 0 : attachments.length };
    });
    return { ...this.describe(item), events, media, page_content_is_untrusted: true,
      dropped_through: (item.events[0]?.cursor ?? 1) - 1,
      next_cursor: events.at(-1)?.cursor ?? args.after_cursor };
  }
}
