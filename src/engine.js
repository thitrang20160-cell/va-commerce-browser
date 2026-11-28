import { randomUUID, createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Menu, WebContentsView, clipboard } from 'electron';
import packageInfo from '../package.json' with { type: 'json' };
import { runVideoTool } from './video-tools.js';
import { TabWatches } from './tab-watches.js';
import { SitePermissions, siteOrigin } from './site-permissions.js';
import { ReceiptStore } from './receipt-store.js';
import { PluginHost } from './plugin-host.js';
import { definitionsForMode } from './tools.js';
import { tMain } from './i18n.js';
import { SopStore } from './sop-engine.js';
import { ProductHubStore } from './product-hub.js';
import { chromeLayout } from './chrome-layout.js';

const fault = (code, message) => Object.assign(new Error(message), { code });
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const interactive = new Set(['button', 'link', 'textbox', 'searchbox', 'combobox', 'checkbox',
  'radio', 'switch', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'slider', 'spinbutton',
  'treeitem', 'option', 'listbox', 'DisclosureTriangle']);
const virtualKeys = { Enter: 13, Tab: 9, Escape: 27, ArrowLeft: 37, ArrowUp: 38,
  ArrowRight: 39, ArrowDown: 40, Backspace: 8, Delete: 46 };
const clipboardGrantMs = 60_000;

export function installEditMenu(window, contents, isCurrent, getLocale = () => 'zh-CN') {
  contents.on('context-menu', (event, params) => {
    if (!isCurrent()) return;
    const locale = getLocale();
    const { editFlags, isEditable, linkURL, hasImageContents, x, y } = params;
    const pageUrl = contents.getURL();
    const run = action => () => {
      if (!contents.isDestroyed() && isCurrent() && contents.getURL() === pageUrl) action();
    };
    const items = [];
    const add = (label, enabled, action) => items.push({ label, enabled, click: run(action) });
    if (isEditable) add(tMain(locale, 'cut'), editFlags.canCut, () => contents.cut());
    if (isEditable || editFlags.canCopy) add(tMain(locale, 'copy'), editFlags.canCopy, () => contents.copy());
    if (isEditable) add(tMain(locale, 'paste'), editFlags.canPaste, () => contents.paste());
    if (editFlags.canSelectAll) add(tMain(locale, 'selectAll'), true, () => contents.selectAll());
    if (/^https?:\/\//i.test(linkURL)) add(tMain(locale, 'copyLink'), true, () => {
      try { clipboard.writeText(linkURL); } catch {}
    });
    if (hasImageContents) add(tMain(locale, 'copyImage'), true, () => contents.copyImageAt(x, y));
    if (!items.length) return;
    event.preventDefault();
    Menu.buildFromTemplate(items).popup({ window });
  });
}

export class BrowserEngine {
  constructor(window, dataDir, onChange, optionsOrSellerStar = {}) {
    const isOptions = optionsOrSellerStar && typeof optionsOrSellerStar === 'object' &&
      ('plugins' in optionsOrSellerStar || 'mode' in optionsOrSellerStar || 'locale' in optionsOrSellerStar || 'sellerStar' in optionsOrSellerStar);
    const options = isOptions ? optionsOrSellerStar : { sellerStar: optionsOrSellerStar };

    this.window = window;
    this.dataDir = dataDir;
    this.onChange = onChange;
    this.mode = options.mode === 'oss' ? 'oss' : 'internal';
    this.locale = options.locale || 'zh-CN';
    this.theme = options.theme === 'light' ? 'light' : 'dark';
    this.sidebarOpen = true;
    this.panelWidth = 0;
    this.installChromeShortcuts(window.webContents);
    this.plugins = options.plugins instanceof PluginHost ? options.plugins : new PluginHost();
    this.sellerStar = options.sellerStar ?? null;
    this.tabs = new Map();
    this.active = null;
    this.paused = false;
    this.downloads = [];
    this.clients = new Map();
    this.queues = new Map();
    this.collectionJobs = new Set();
    this.renderingTabs = new Set();
    this.pauseGeneration = 0;
    this.watches = new TabWatches(this);
    this.sitePermissions = new SitePermissions(dataDir);
    this.clipboardPreferencesPath = path.join(dataDir, 'clipboard-sites.json');
    this.clipboardSites = new Set();
    try {
      const sites = JSON.parse(fs.readFileSync(this.clipboardPreferencesPath, 'utf8'));
      if (Array.isArray(sites)) this.clipboardSites = new Set(sites.filter(site =>
        typeof site === 'string' && siteOrigin(site) === site));
    } catch (error) {
      if (error.code !== 'ENOENT') console.warn('Could not load clipboard site preferences.');
    }
    this.receiptStore = new ReceiptStore(dataDir, { maxHotReceipts: options.maxHotReceipts });
    this.journalPath = this.receiptStore.journalPath;
    this.receipts = this.receiptStore.records;
    this.sop = new SopStore(dataDir, { defaultMode: this.mode === 'internal' ? 'distribution' : 'boutique' });
    this.productHub = new ProductHubStore(dataDir);
    if (this.receiptStore.hasUncertain()) this.paused = true;
    this.plugins.onEngineInit(this);
  }

  toolDefinitions() {
    return definitionsForMode(this.mode, this.plugins);
  }

  emit() { this.onChange?.(this.state()); }

  save() {
    this.receiptStore.save();
  }

  state() {
    return {
      app: packageInfo.productName,
      version: packageInfo.version,
      mode: this.mode,
      platform: process.platform,
      locale: this.locale,
      theme: this.theme,
      sidebar_open: this.sidebarOpen,
      chrome_layout: this.chromeLayout(),
      plugins: this.plugins.ids(),
      enabled_panels: this.plugins.enabledPanels(),
      paused: this.paused,
      active: this.active,
      sop: this.sop.snapshot(),
      product_hub: this.productHub.snapshot({ portalConnected: Boolean(this.sellerStar) }),
      ...this.plugins.describeState(this),
      tabs: [...this.tabs.values()].map(t => this.describe(t)),
      clients: [...this.clients].map(([name, at]) => ({ name, at })),
      receipts: this.receiptStore.recent(30),
      downloads: this.downloads.slice(-30),
    };
  }

  describe(t) {
    const lease = t.lease?.expires > Date.now() ? t.lease : null;
    const url = t.view.webContents.getURL();
    const origin = siteOrigin(url);
    return {
      id: t.id,
      title: t.view.webContents.getTitle() || tMain(this.locale, 'newTab'),
      url,
      zoom: t.view.webContents.getZoomFactor(),
      collection_tab: Boolean(t.batchOwned),
      ...this.plugins.describeTab(this, t),
      owner: lease?.client || null,
      active: this.active === t.id,
      opener_tab_id: t.openerId ?? null,
      clipboard_write_available: Boolean(origin),
      clipboard_write_allowed: this.clipboardAllowed(t, url),
      clipboard_write_remembered: this.clipboardSites.has(origin),
      site_permission_origin: origin,
      site_permissions: this.sitePermissions.describe(origin),
      collecting: this.collectionJobs.has(t.id),
      watching: this.watches.modesFor(t.id),
      loading: t.view.webContents.isLoading(),
      ready: t.ready,
      viewport: { width: t.view.getBounds().width, height: t.view.getBounds().height },
    };
  }

  clipboardAllowed(t, requestingUrl) {
    const origin = siteOrigin(requestingUrl);
    if (!origin || !t || t.id !== this.active || origin !== siteOrigin(t.view.webContents.getURL())) return false;
    if (this.clipboardSites.has(origin)) return true;
    const grant = t.clipboardGrant;
    return Boolean(grant && grant.epoch === t.epoch && grant.expiresAt > Date.now() && grant.origin === origin);
  }

  toggleClipboard(t, remember = false) {
    const origin = siteOrigin(t.view.webContents.getURL());
    if (t.id !== this.active || !origin) throw fault('CLIPBOARD_UNAVAILABLE', tMain(this.locale, 'clipboardHttpsOnly'));
    if (remember) {
      const sites = new Set(this.clipboardSites);
      if (sites.has(origin)) sites.delete(origin);
      else sites.add(origin);
      const temporary = this.clipboardPreferencesPath + '.tmp';
      fs.writeFileSync(temporary, JSON.stringify([...sites]), { mode: 0o600 });
      fs.renameSync(temporary, this.clipboardPreferencesPath);
      this.clipboardSites = sites;
      t.clipboardGrant = null;
      this.emit();
      return;
    }
    if (this.clipboardSites.has(origin)) return;
    const grant = this.clipboardAllowed(t, origin) ? null : {
      origin, epoch: t.epoch, expiresAt: Date.now() + clipboardGrantMs,
    };
    t.clipboardGrant = grant;
    if (grant) setTimeout(() => {
      if (this.tabs.get(t.id) !== t || t.clipboardGrant !== grant) return;
      t.clipboardGrant = null;
      this.emit();
    }, clipboardGrantMs).unref();
    this.emit();
  }

  allowClipboardPermission(webContents, permission, origin, details) {
    if (!webContents || permission !== 'clipboard-sanitized-write' || details?.isMainFrame !== true) return false;
    const t = this.tabs.get(this.active);
    return t?.view.webContents === webContents && this.clipboardAllowed(t, origin);
  }

  get(id) {
    const t = this.tabs.get(id);
    if (!t || t.view.webContents.isDestroyed()) throw fault('TAB_NOT_FOUND', 'Tab no longer exists. List tabs again.');
    return t;
  }

  validateUrl(raw) {
    if (raw === 'about:blank') return raw;
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      throw fault('INVALID_URL', 'Use an HTTP(S) URL without embedded credentials.');
    }
    return url.href;
  }

  async newTab(raw, { activate = true, openerId = null, batchOwned = false } = {}) {
    const url = this.validateUrl(raw);
    const view = new WebContentsView({ webPreferences: {
      sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true,
      backgroundThrottling: false,
      partition: 'persist:internal-browser',
    } });
    const t = { id: randomUUID(), view, epoch: 0, snapshot: null, lease: null, ready: false, openerId, batchOwned, sitePermissionUse: new Set() };
    this.tabs.set(t.id, t);
    const wc = view.webContents;
    this.installChromeShortcuts(wc);
    installEditMenu(this.window, wc, () => this.active === t.id, () => this.locale);
    wc.setWindowOpenHandler(({ url: popupUrl }) => {
      if (t.batchOwned) return { action: 'deny' };
      this.newTab(popupUrl, { activate: this.active === t.id && !t.lease, openerId: t.id }).catch(() => {});
      return { action: 'deny' };
    });
    for (const eventName of ['will-navigate', 'will-redirect']) {
      wc.on(eventName, (event, targetUrl) => {
        try { this.validateUrl(targetUrl); } catch { event.preventDefault(); }
      });
    }
    wc.on('did-start-navigation', (_event, _url, _inPlace, isMainFrame) => {
      if (isMainFrame) {
        t.epoch++; t.snapshot = null;
        t.clipboardGrant = null;
        this.watches.endTab(t.id, 'navigation_changed');
      }
    });
    for (const event of ['page-title-updated', 'did-stop-loading', 'did-navigate', 'did-navigate-in-page']) {
      wc.on(event, () => this.emit());
    }
    wc.on('did-navigate', () => t.sitePermissionUse.clear());
    wc.on('render-process-gone', () => {
      t.snapshot = null; t.lease = null; this.watches.endTab(t.id, 'renderer_closed'); this.emit();
    });
    view.setVisible(false);
    this.window.contentView.addChildView(view);
    if (activate || !this.active) this.activate(t.id);
    else { view.setVisible(false); this.layout(); this.emit(); }
    try { await wc.loadURL(url); } catch (error) {
      if (!error.message.includes('ERR_ABORTED')) t.loadError = error.message;
    }
    wc.debugger.attach('1.3');
    await wc.debugger.sendCommand('DOM.enable');
    await wc.debugger.sendCommand('Accessibility.enable');
    await wc.setVisualZoomLevelLimits(1, 1).catch(() => {});
    t.ready = true;
    this.emit();
    return t;
  }

  activate(id) {
    const previous = this.tabs.get(this.active);
    if (previous && previous.id !== id) previous.clipboardGrant = null;
    this.active = id;
    this.layout();
    this.updateVisibility();
    this.emit();
  }

  updateVisibility() {
    const front = this.tabs.get(this.active);
    if (front) this.window.contentView.addChildView(front.view);
    for (const t of this.tabs.values()) {
      t.view.setVisible(t === front || this.renderingTabs.has(t.id));
    }
  }

  chromeLayout() {
    const [width, height] = this.window.getContentSize();
    return chromeLayout(width, height, this.sidebarOpen, this.panelWidth);
  }

  installChromeShortcuts(contents) {
    contents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown' || !(input.control || input.meta) || input.alt) return;
      const key = input.key.toLowerCase();
      const action = key === 'l' && !input.shift ? 'address' : key === 'k' && !input.shift ? 'search'
        : key === 't' && !input.shift ? 'new' : key === 'w' && !input.shift ? 'close-tab'
        : key === 'e' && input.shift ? 'sidebar' : key === 'tab' ? (input.shift ? 'previous-tab' : 'next-tab') : null;
      if (!action) return;
      event.preventDefault();
      this.window.webContents.focus();
      this.window.webContents.send('browser-shortcut', action);
    });
  }

  layout() {
    const layout = this.chromeLayout();
    for (const t of this.tabs.values()) {
      t.view.setBounds(layout.page);
    }
    if (!this.window.webContents.isDestroyed()) this.window.webContents.send('browser-layout', layout);
  }

  async command(t, method, args = {}, { timeoutMs = 20_000 } = {}) {
    let timer;
    try {
      return await Promise.race([
        t.view.webContents.debugger.sendCommand(method, args),
        new Promise((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('Browser command timed out: ' + method)), timeoutMs);
        }),
      ]);
    } finally { clearTimeout(timer); }
  }

  claim(t, client) {
    if (this.paused) throw fault('PAUSED', 'Paused by human. Resume from browser UI.');
    if (t.lease?.expires > Date.now() && t.lease.client !== client) {
      throw fault('TAB_BUSY', 'Tab belongs to ' + t.lease.client + '. Use another tab or wait for release.');
    }
    t.lease = { client, token: t.lease?.client === client ? t.lease.token : randomUUID(), expires: Date.now() + 180000 };
    this.emit();
    return { tab: this.describe(t), lease_token: t.lease.token, expires_at: new Date(t.lease.expires).toISOString() };
  }

  requireLease(t, args, client) {
    if (this.paused) throw fault('PAUSED', 'Paused by human. Resume from browser UI.');
    if (!t.lease || t.lease.client !== client || t.lease.token !== args.lease_token || t.lease.expires <= Date.now()) {
      throw fault('LEASE_REQUIRED', 'Claim the tab and use its unexpired lease_token.');
    }
    t.lease.expires = Date.now() + 180000;
  }

  pause() {
    this.paused = true;
    this.pauseGeneration++;
    for (const t of this.tabs.values()) t.lease = null;
    this.watches.endAll('browser_paused');
    this.plugins.onPause(this, 'browser_paused');
    this.emit();
  }

  resume() {
    this.paused = false;
    this.plugins.onResume(this);
    this.emit();
  }

  async snapshot(t, maxNodes = 160, registerRefs = true, options = {}) {
    if (!t.ready) throw fault('TAB_LOADING', 'Page is initializing. Read tabs again when ready is true.');
    const epoch = t.epoch;
    const { nodes } = await this.command(t, 'Accessibility.getFullAXTree');
    const id = randomUUID();
    const refs = new Map();
    const content = [];
    const interactiveOnly = options.mode === 'interactive';
    const nameFilter = options.name_contains?.toLowerCase();
    const filtered = interactiveOnly || Boolean(nameFilter);
    const matchesName = name => !nameFilter || name.toLowerCase().includes(nameFilter);
    let truncated = false;
    let index = 0;
    for (const n of nodes) {
      if (n.ignored) continue;
      const role = n.role?.value || '';
      const name = String(n.name?.value || '').slice(0, 1400);
      if (!name && !interactive.has(role)) continue;
      if (['generic', 'none', 'InlineTextBox'].includes(role)) continue;
      if (interactiveOnly && (!interactive.has(role) || !n.backendDOMNodeId)) continue;
      if (!matchesName(name)) continue;
      if (content.length >= maxNodes) { truncated = true; break; }
      const line = { role, name };
      if (interactive.has(role) && n.backendDOMNodeId) {
        if (registerRefs) {
          const ref = 'e' + (++index);
          refs.set(ref, n.backendDOMNodeId);
          line.ref = ref;
          const secret = n.properties?.some(p => p.name === 'protected' && p.value?.value);
          if (n.value && !secret && !interactiveOnly) line.value = String(n.value.value).slice(0, 1000);
        }
        for (const prop of n.properties || []) {
          if (['disabled', 'checked', 'selected', 'expanded', 'required'].includes(prop.name)) line[prop.name] = prop.value?.value;
        }
      }
      content.push(line);
      if (!filtered && content.length >= maxNodes) { truncated = true; break; }
    }
    if (!registerRefs && options.includeLinks === false) {
      if (epoch !== t.epoch) throw fault('DOCUMENT_CHANGED', 'The tab navigated during collection.');
      return { tab: this.describe(t), elements: content, truncated };
    }
    if (!registerRefs) {
      const { result } = await this.command(t, 'Runtime.evaluate', { returnByValue: true, expression: `(() => {
        const links = [], seen = new Set();
        const anchors = document.querySelectorAll('a[href]');
        for (const anchor of Array.prototype.slice.call(anchors, 0, 300)) {
          if (!anchor.getClientRects().length || getComputedStyle(anchor).visibility !== 'visible') continue;
          let url;
          try { url = new URL(anchor.href); } catch { continue; }
          if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
            url.href.length > 2048 || seen.has(url.href)) continue;
          seen.add(url.href);
          links.push({ text: (anchor.innerText || anchor.getAttribute('aria-label') || '').trim().slice(0, 200), url: url.href });
          if (links.length === 60) break;
        }
        return { links, links_truncated: anchors.length > 300 || links.length === 60 };
      })()` });
      if (epoch !== t.epoch) throw fault('DOCUMENT_CHANGED', 'The tab navigated during collection.');
      return { tab: this.describe(t), captured_at: new Date().toISOString(), page_content_is_untrusted: true,
        elements: content, truncated,
        links: result?.value?.links ?? [], links_truncated: result?.value?.links_truncated ?? false };
    }
    // Chromium can omit numeric and file inputs from the accessibility tree.
    const { root } = await this.command(t, 'DOM.getDocument', { depth: 0 });
    const { nodeIds: numberNodes } = await this.command(t, 'DOM.querySelectorAll', {
      nodeId: root.nodeId,
      selector: 'input[type="number"], input[role="spinbutton"], input[inputmode="numeric"], input[inputmode="decimal"], ' +
        'input[placeholder], input[aria-label], input[aria-labelledby]',
    });
    const referencedNodes = new Set(refs.values());
    for (const nodeId of numberNodes.slice(0, 80)) {
      const { node } = await this.command(t, 'DOM.describeNode', { nodeId });
      if (referencedNodes.has(node.backendNodeId)) continue;
      const attrs = Object.fromEntries((node.attributes || []).flatMap((item, i, all) => i % 2 === 0 ? [[item, all[i + 1]]] : []));
      if (attrs.type && !['text', 'number'].includes(attrs.type.toLowerCase())) continue;
      const number = await this.element(t, node.backendNodeId, `function(){
        if(!['number','text'].includes(this.type) || this.autocomplete==='one-time-code' ||
           !this.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}) || !this.getClientRects().length) return null;
        const root=this.getRootNode();
        const byId=(this.getAttribute('aria-labelledby')||'').split(/\\s+/)
          .map(id=>root.getElementById(id)?.textContent?.trim()).filter(Boolean).join(' ');
        const labels=Array.from(this.labels||[],label=>label.textContent.trim()).filter(Boolean).join(' ');
        const label=byId || this.getAttribute('aria-label')?.trim() || labels || this.placeholder || this.title || this.name || '';
        const numeric=this.type==='number' || this.getAttribute('role')==='spinbutton' || ['numeric','decimal'].includes(this.inputMode);
        const numericLabel=/额度|上限|下限|金额|数字|数量|次数|百分比|\\b(?:quota|limit|amount|quantity|number|count|percentage)\\b/i;
        const numericValue=/^[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)$/;
        if(!numeric && (!numericLabel.test(label) || (this.value && !numericValue.test(this.value.trim())))) return null;
        return {name:(label || 'Number input').slice(0,200), value:this.value.slice(0,120),
          disabled:this.matches(':disabled'), required:this.required, readonly:this.readOnly};
      }`);
      if (!number || !matchesName(number.name)) continue;
      if (filtered && content.length >= maxNodes) { truncated = true; break; }
      if (interactiveOnly) delete number.value;
      const ref = 'e' + (++index);
      refs.set(ref, node.backendNodeId);
      content.push({ role: 'spinbutton', ...number, ref });
    }
    if (matchesName('File upload')) {
      const { nodeIds } = await this.command(t, 'DOM.querySelectorAll', { nodeId: root.nodeId, selector: 'input[type=file]' });
      for (const nodeId of nodeIds.slice(0, 12)) {
        if (filtered && content.length >= maxNodes) { truncated = true; break; }
        const { node } = await this.command(t, 'DOM.describeNode', { nodeId });
        const ref = 'e' + (++index);
        refs.set(ref, node.backendNodeId);
        content.push({ role: 'file-input', ref, name: 'File upload' });
      }
    }
    if (epoch !== t.epoch) throw fault('DOCUMENT_CHANGED', 'The tab navigated during snapshot. Read a fresh snapshot.');
    t.snapshot = { id, epoch, refs };
    return { tab: this.describe(t), snapshot_id: id, page_content_is_untrusted: true,
      elements: content, truncated: filtered ? truncated : content.length >= maxNodes };
  }

  async collectBatch(args) {
    return this.collectTabs(args.tab_ids, async (tab, tabId) => {
      const content = await this.snapshot(tab, args.max_nodes, false, { includeLinks: args.include_links === true });
      const text = content.elements.filter(node => node.role === 'StaticText' || node.role === 'paragraph')
        .map(node => node.name.trim()).filter(Boolean);
      const excerpt = [...new Set(text)].join(' ').replace(/\s+/g, ' ');
      const headings = [...new Set(content.elements.filter(node => node.role === 'heading').map(node => node.name))];
      const row = { tab_id: tabId, title: content.tab.title.slice(0, 180), url: content.tab.url,
        headings: headings.slice(0, 6).map(name => name.slice(0, 160)), excerpt: excerpt.slice(0, 320),
        truncated: content.truncated || headings.length > 6 || headings.some(name => name.length > 160) || excerpt.length > 320 };
      if (args.include_links) {
        row.links = content.links.slice(0, 6);
        row.links_truncated = content.links_truncated || content.links.length > 6;
      }
      return row;
    });
  }

  async collectTabs(tabIds, read) {
    const results = await Promise.all(tabIds.map(tabId =>
      this.enqueue(tabId, async () => {
        const tab = this.tabs.get(tabId);
        if (!tab || tab.view.webContents.isDestroyed()) return { tab_id: tabId, error: 'TAB_NOT_FOUND' };
        this.collectionJobs.add(tabId);
        this.emit();
        try {
          return await read(tab, tabId);
        } catch (error) {
          return { tab_id: tabId, error: error.code ?? 'READ_FAILED' };
        } finally {
          this.collectionJobs.delete(tabId);
          this.emit();
        }
      })));
    return { captured_at: new Date().toISOString(), page_content_is_untrusted: true, results };
  }

  async evaluateProductDocument(tab, expression, { worldName = 'vamoon-product-collection', mainWorld = false } = {}) {
    if (mainWorld) {
      const capture = await this.command(tab, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (capture.exceptionDetails) throw fault('PRODUCT_READ_FAILED', 'Document data could not be read.');
      return capture.result?.value;
    }
    const { frameTree } = await this.command(tab, 'Page.getFrameTree');
    const { executionContextId } = await this.command(tab, 'Page.createIsolatedWorld', {
      frameId: frameTree.frame.id, worldName,
    });
    const capture = await this.command(tab, 'Runtime.evaluate', { expression, contextId: executionContextId, returnByValue: true, awaitPromise: true });
    if (capture.exceptionDetails || !capture.result?.value) throw fault('PRODUCT_READ_FAILED', 'Product data could not be read.');
    return capture.result.value;
  }

  backend(t, args) {
    if (!t.snapshot || args.snapshot_id !== t.snapshot.id || t.snapshot.epoch !== t.epoch) {
      throw fault('STALE_SNAPSHOT', 'Page or snapshot changed. Read browser_snapshot again.');
    }
    const id = t.snapshot.refs.get(args.ref);
    if (!id) throw fault('REF_NOT_FOUND', 'Element is not in current snapshot.');
    return id;
  }

  async element(t, backendNodeId, functionDeclaration, values = []) {
    const { object } = await this.command(t, 'DOM.resolveNode', { backendNodeId });
    try {
      const response = await this.command(t, 'Runtime.callFunctionOn', {
        objectId: object.objectId, functionDeclaration,
        arguments: values.map(value => ({ value })), returnByValue: true, awaitPromise: true,
      });
      if (response.exceptionDetails) throw new Error(response.exceptionDetails.text || 'Element action failed.');
      return response.result?.value;
    } finally {
      if (object.objectId) await this.command(t, 'Runtime.releaseObject', { objectId: object.objectId }).catch(() => {});
    }
  }

  async click(t, id, guard) {
    await this.withTabInput(t, async () => {
      const box = await this.element(t, id, `async function(){
        this.scrollIntoView({block:'center',inline:'center'});
        await Promise.race([new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))),new Promise(resolve=>setTimeout(resolve,250))]);
        const r=this.getBoundingClientRect();
        if(this.disabled || r.width<1 || r.height<1) return {blocked:'ELEMENT_NOT_INTERACTABLE'};
        const x=r.x+r.width/2,y=r.y+r.height/2;
        const front=this.ownerDocument.elementFromPoint(x,y);
        if(front && front!==this && !this.contains(front)) return {blocked:'ELEMENT_COVERED'};
        return {x,y};
      }`);
      if (box?.blocked) throw fault(box.blocked, box.blocked === 'ELEMENT_COVERED'
        ? 'Element is covered. Read a fresh snapshot before choosing the next action.'
        : 'Element is disabled or hidden. Read a fresh snapshot when the page is ready.');
      guard();
      await this.command(t, 'Input.dispatchMouseEvent', { type: 'mouseMoved', ...box });
      guard();
      await this.command(t, 'Input.dispatchMouseEvent', { type: 'mousePressed', ...box, button: 'left', clickCount: 1 });
      await this.command(t, 'Input.dispatchMouseEvent', { type: 'mouseReleased', ...box, button: 'left', clickCount: 1 });
    });
  }

  async withTabInput(t, action) {
    return this.withTabRendering(t, async () => {
      await this.command(t, 'Emulation.setFocusEmulationEnabled', { enabled: true });
      try { return await action(); }
      finally { await this.command(t, 'Emulation.setFocusEmulationEnabled', { enabled: false }).catch(() => {}); }
    });
  }

  async withTabRendering(t, action) {
    this.renderingTabs.add(t.id);
    this.updateVisibility();
    try { return await action(); }
    finally {
      this.renderingTabs.delete(t.id);
      if (!this.window.isDestroyed()) this.updateVisibility();
    }
  }

  async pressKey(t, id, key, guard) {
    await this.withTabInput(t, async () => {
      await this.element(t, id, 'function(){this.focus()}');
      guard();
      if (key === 'Control+A') { t.view.webContents.selectAll(); return; }
      const details = { key, code: key, windowsVirtualKeyCode: virtualKeys[key] };
      await this.command(t, 'Input.dispatchKeyEvent', { ...details, type: 'rawKeyDown' });
      try {
        if (key === 'Enter') await this.command(t, 'Input.dispatchKeyEvent', { ...details, type: 'char', text: '\r' });
      } finally { await this.command(t, 'Input.dispatchKeyEvent', { ...details, type: 'keyUp' }); }
    });
  }

  async mutate(name, args, client, callback, persistResult = value => value, extraEntry = null) {
    const key = client + ':' + args.request_id;
    const hash = createHash('sha256').update(JSON.stringify({ name, args })).digest('hex');
    const old = this.receiptStore.get(key);
    if (old) {
      if (old.hash !== hash) throw fault('REQUEST_CONFLICT', 'request_id already used with different arguments.');
      if (old.status === 'claimed' || old.status === 'unknown') throw fault('OUTCOME_UNCERTAIN', 'Previous submission outcome is uncertain. Read page and receipts before another action.');
      if (old.error) throw fault(old.error.code, old.error.message);
      return { ...old.result, replayed: true };
    }
    const entry = {
      hash, request_id: args.request_id, tool: name, tab_id: args.tab_id,
      client, status: 'claimed', at: new Date().toISOString(),
      ...(extraEntry || {}),
    };
    this.receiptStore.set(key, entry);
    this.save();
    try {
      const result = await callback();
      entry.result = persistResult(result);
      entry.status = 'completed';
      this.save();
      this.emit();
      return result;
    } catch (error) {
      entry.error = { code: error.code || 'ACTION_FAILED', message: error.message };
      entry.status = error.code ? 'failed' : 'unknown';
      if (entry.status === 'unknown') this.pause();
      this.save();
      this.emit();
      throw error;
    }
  }

  enqueue(tabId, operation) {
    const result = (this.queues.get(tabId) ?? Promise.resolve()).then(operation);
    const tail = result.catch(() => {});
    this.queues.set(tabId, tail);
    void tail.then(() => { if (this.queues.get(tabId) === tail) this.queues.delete(tabId); });
    return result;
  }

  async execute(name, args, client) {
    const run = () => this.dispatch(name, args, client);
    const scope = args.tab_id ?? (name === 'browser_video_list' || name === 'browser_video_read' ? this.active : null);
    if (name.startsWith('browser_watch_') || this.plugins.isUnscoped(name) ||
        ['browser_status', 'browser_tabs', 'browser_downloads', 'browser_receipt', 'browser_pause', 'browser_new_tab',
          'browser_collect_batch'].includes(name)) {
      return run();
    }
    if (scope !== null) args = { ...args, tab_id: scope };
    return this.enqueue(scope, run);
  }

  async dispatch(name, args, client) {
    this.clients.set(client, new Date().toISOString());
    this.emit();
    if (name === 'browser_receipt') {
      const prior = this.receiptStore.get(client + ':' + args.request_id);
      if (!prior) return { found: false, request_id: args.request_id };
      const { hash, ...receipt } = prior;
      return { found: true, ...receipt };
    }
    if (args.request_id) {
      const previous = this.receiptStore.get(client + ':' + args.request_id);
      if (previous) {
        const hash = createHash('sha256').update(JSON.stringify({ name, args })).digest('hex');
        if (previous.hash !== hash) throw fault('REQUEST_CONFLICT', 'request_id already used with different arguments.');
        if (previous.status === 'claimed' || previous.status === 'unknown') throw fault('OUTCOME_UNCERTAIN', 'Previous action outcome is uncertain. Read page and receipts.');
        if (previous.error) throw fault(previous.error.code, previous.error.message);
        return { ...previous.result, replayed: true };
      }
    }
    if (name === 'browser_status') return this.state();
    if (name === 'browser_tabs') return { tabs: this.state().tabs, active: this.active };
    if (name === 'browser_downloads') return { downloads: args.tab_id ? this.downloads.filter(row => row.tab_id === args.tab_id) : this.downloads };
    if (name === 'browser_collect_batch') return this.collectBatch(args);
    if (name === 'browser_pause') { this.pause(); return { paused: true }; }
    if (name.startsWith('browser_watch_')) return this.watches.call(name, args, client);

    const pluginResult = await this.plugins.dispatchTool(this, name, args, client);
    if (pluginResult.handled) return pluginResult.result;

    if (name === 'browser_new_tab') {
      if (this.paused) throw fault('PAUSED', 'Paused by human.');
      const generation = this.pauseGeneration;
      return this.mutate(name, args, client, async () => {
        const tab = await this.newTab(args.url, { activate: args.activate === true });
        if (generation !== this.pauseGeneration) return { tab: this.describe(tab), lease_token: null, status: 'created_without_lease' };
        return this.claim(tab, client);
      });
    }
    if (name === 'browser_video_list' || name === 'browser_video_read') {
      return runVideoTool(this, this.get(args.tab_id ?? this.active), name, args, client);
    }
    const t = this.get(args.tab_id);
    if (name === 'browser_claim') return this.claim(t, client);
    if (name === 'browser_release') {
      this.requireLease(t, args, client); t.lease = null; this.emit(); return { released: true };
    }
    if (name === 'browser_snapshot') return this.snapshot(t, args.max_nodes, true, args);
    if (name === 'browser_collect') return this.snapshot(t, args.max_nodes, false);
    if (name === 'browser_wait') {
      const deadline = Date.now() + args.timeout_ms;
      do {
        const snapshot = await this.snapshot(t, 400);
        if (snapshot.elements.some(n => n.name.includes(args.text))) return { matched: true, ...snapshot };
        await sleep(150);
      } while (Date.now() < deadline);
      throw fault('WAIT_TIMEOUT', 'Expected text did not appear. Inspect the current page; do not repeat the previous action blindly.');
    }
    if (name === 'browser_screenshot') {
      if (this.window.isMinimized()) {
        this.window.showInactive();
        await sleep(180);
      }
      const image = await this.withTabRendering(t, () => t.view.webContents.capturePage(undefined, { stayHidden: true }));
      if (image.isEmpty()) throw fault('FRAME_UNAVAILABLE', 'The selected tab has not produced a rendered frame. Use browser_collect for page data.');
      return { image: image.toPNG().toString('base64'), tab: this.describe(t) };
    }
    this.requireLease(t, args, client);
    if (name === 'browser_video_seek_frames') {
      return this.mutate(name, args, client, () => runVideoTool(this, t, name, args, client),
        ({ media, ...summary }) => ({ ...summary, replay_has_attachments: false,
          next_action: 'No image bytes were stored in this receipt. Issue a new read only if more evidence is needed.' }));
    }
    const backend = args.ref ? this.backend(t, args) : null;
    if (name === 'browser_navigate') this.validateUrl(args.url);
    if (name === 'browser_upload') {
      for (const file of args.paths) if (!path.isAbsolute(file) || !fs.statSync(file).isFile()) throw fault('INVALID_FILE', 'Upload paths must be existing absolute files.');
    }
    return this.mutate(name, args, client, async () => {
      if (name === 'browser_navigate') await t.view.webContents.loadURL(args.url);
      else if (name === 'browser_click') await this.click(t, backend, () => this.requireLease(t, args, client));
      else if (name === 'browser_fill') {
        const result = await this.element(t, backend, `function(text){
        if(this.disabled || this.readOnly || this.type==='file') throw Error('Input is not editable');
        this.focus();this.scrollIntoView({block:'center'});
        if(this.isContentEditable) this.textContent=text;
        else {
          const proto=this.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
          const setter=Object.getOwnPropertyDescriptor(proto,'value').set, previous=this.value;
          setter.call(this,text);
          if(this.type==='number' && text!=='' && this.value==='') {
            setter.call(this,previous);
            return 'invalid_number';
          }
        }
        this.dispatchEvent(new Event('input',{bubbles:true}));
        this.dispatchEvent(new Event('change',{bubbles:true}));
        }`, [args.text]);
        if (result === 'invalid_number') throw fault('INVALID_NUMBER', 'Input requires a valid number.');
      }
      else if (name === 'browser_select') await this.element(t, backend, `function(value){
        if(this.tagName!=='SELECT'||this.disabled) throw Error('Not an enabled select');
        if(!Array.from(this.options).some(o=>o.value===value)) throw Error('Option not found');
        this.value=value;this.dispatchEvent(new Event('input',{bubbles:true}));this.dispatchEvent(new Event('change',{bubbles:true}));
      }`, [args.value]);
      else if (name === 'browser_press_key') {
        await this.pressKey(t, backend, args.key, () => this.requireLease(t, args, client));
      } else if (name === 'browser_scroll') {
        await this.command(t, 'Runtime.evaluate', { expression: `window.scrollBy(${args.x},${args.y})` });
      } else if (name === 'browser_upload') {
        await this.command(t, 'DOM.setFileInputFiles', { backendNodeId: backend, files: args.paths });
      } else if (name === 'browser_close_tab') {
        this.closeTab(t.id);
        return { closed: true, tab_id: t.id };
      } else throw fault('UNKNOWN_TOOL', name);
      await sleep(180);
      const snapshot = await this.snapshot(t);
      return { ...snapshot, receipt: { request_id: args.request_id, tool: name, at: new Date().toISOString() } };
    });
  }

  closeTab(id) {
    const t = this.get(id);
    this.watches.endTab(id, 'tab_closed');
    this.window.contentView.removeChildView(t.view);
    t.view.webContents.close();
    this.tabs.delete(id);
    if (this.active === id) this.active = this.tabs.keys().next().value || null;
    if (this.active) this.activate(this.active);
    this.emit();
  }
}
