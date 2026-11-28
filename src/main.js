import { app, BrowserWindow, clipboard, ipcMain, session, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import packageInfo from '../package.json' with { type: 'json' };
import { BrowserEngine, installEditMenu } from './engine.js';
import { startService } from './service.js';
import { installSitePermissions } from './site-permissions.js';
import { resolveDataDir, resolveDownloadDir } from './paths.js';
import { resolveLocale, resolveTheme, saveLocale, saveTheme } from './i18n.js';
import { createPluginHost, loadOptionalExtensionModule, resolveMode } from './plugins/index.js';
import { inspectMcpConnector, installMcpClient, uninstallMcpClient } from './mcp-connector.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.dirname(here);
const appIconIco = path.join(projectRoot, 'build', 'icon.ico');
const appIconPng = path.join(projectRoot, 'build', 'icon.png');
const windowIcon = (process.platform === 'win32' && fs.existsSync(appIconIco))
  ? appIconIco
  : (fs.existsSync(appIconPng) ? appIconPng : undefined);

function titleBarOverlayOptions(theme) {
  return theme === 'light'
    ? { color: '#ebf1f4', symbolColor: '#0f242c', height: 41 }
    : { color: '#090d12', symbolColor: '#93a9b5', height: 41 };
}

function argument(name) {
  const at = process.argv.indexOf(name);
  return at < 0 ? null : process.argv[at + 1];
}

const mode = resolveMode(argument('--mode'));
const dataDir = resolveDataDir({ explicitDir: argument('--data-dir'), mode });
fs.mkdirSync(dataDir, { recursive: true });
app.setPath('userData', dataDir);
if (process.platform === 'win32') app.setAppUserModelId(process.execPath);
if (!app.requestSingleInstanceLock()) app.quit();

let window;
let mcpModal = null;
let discoveryModal = null;
let lastDiscoveryData = null;
let lastDiscoveryFocusAsin = null;
let engine;
let service;
let relay;
const runtimePath = path.join(dataDir, 'runtime.json');

function saveTabs() {
  if (!engine) return;
  const tabs = [...engine.tabs.values()].filter(t => !t.view.webContents.isDestroyed() && (!t.batchOwned || t.id === engine.active));
  if (!tabs.length) return;
  fs.writeFileSync(path.join(dataDir, 'tabs.json'), JSON.stringify({
    urls: tabs.map(t => t.view.webContents.getURL()),
    active_index: tabs.findIndex(t => t.id === engine.active),
  }), { mode: 0o600 });
}

function buildConnectorInfo() {
  return inspectMcpConnector({
    mode,
    locale: engine?.locale || 'zh-CN',
    theme: engine?.theme || 'dark',
    projectRoot: path.dirname(here),
    endpoint: service ? 'http://127.0.0.1:' + service.port : null,
    toolCount: engine ? engine.toolDefinitions().length : 0,
    dataDir,
    activeClients: engine ? [...engine.clients.keys()] : [],
  });
}

function openMcpModal() {
  if (!window || window.isDestroyed()) return { open: false };
  if (mcpModal && !mcpModal.isDestroyed()) {
    mcpModal.show();
    mcpModal.focus();
    return { open: true };
  }
  const modalWidth = 860;
  const modalHeight = 724;
  const parentBounds = window.getBounds();
  const x = Math.round(parentBounds.x + (parentBounds.width - modalWidth) / 2);
  const y = Math.round(parentBounds.y + (parentBounds.height - modalHeight) / 2);

  mcpModal = new BrowserWindow({
    parent: window,
    modal: true,
    icon: windowIcon,
    width: modalWidth,
    height: modalHeight,
    x,
    y,
    resizable: false,
    minimizable: false,
    maximizable: false,
    frame: false,
    show: false,
    backgroundColor: engine?.theme === 'light' ? '#ffffff' : '#0d131a',
    webPreferences: {
      preload: path.join(here, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mcpModal.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mcpModal.webContents.on('will-navigate', event => event.preventDefault());
  mcpModal.once('ready-to-show', () => {
    if (mcpModal && !mcpModal.isDestroyed()) mcpModal.show();
  });
  mcpModal.on('closed', () => { mcpModal = null; });
  void mcpModal.loadFile(path.join(here, 'ui', 'mcp-modal.html'));
  return { open: true };
}

function buildDiscoveryModalPayload() {
  return {
    locale: engine?.locale || 'zh-CN',
    theme: engine?.theme || 'dark',
    mode,
    sellerstar_enabled: Boolean(engine?.plugins?.enabledPanels?.().includes('sellerstar-batch')),
    paused: Boolean(engine?.paused),
    focus_asin: lastDiscoveryFocusAsin,
    result: lastDiscoveryData,
  };
}

function openDiscoveryModal(result, focusAsin = null) {
  if (!window || window.isDestroyed()) return { open: false };
  if (result) lastDiscoveryData = result;
  lastDiscoveryFocusAsin = focusAsin || null;
  if (discoveryModal && !discoveryModal.isDestroyed()) {
    discoveryModal.webContents.send('browser-state', buildDiscoveryModalPayload());
    discoveryModal.show();
    discoveryModal.focus();
    return { open: true };
  }
  const modalWidth = 1080;
  const modalHeight = 736;
  const parentBounds = window.getBounds();
  const x = Math.round(parentBounds.x + (parentBounds.width - modalWidth) / 2);
  const y = Math.round(parentBounds.y + (parentBounds.height - modalHeight) / 2);

  discoveryModal = new BrowserWindow({
    parent: window,
    modal: true,
    icon: windowIcon,
    width: modalWidth,
    height: modalHeight,
    x,
    y,
    resizable: true,
    minWidth: 880,
    minHeight: 580,
    minimizable: false,
    maximizable: true,
    frame: false,
    show: false,
    backgroundColor: engine?.theme === 'light' ? '#f4f7f9' : '#0c1117',
    webPreferences: {
      preload: path.join(here, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  discoveryModal.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  discoveryModal.webContents.on('will-navigate', event => event.preventDefault());
  discoveryModal.once('ready-to-show', () => {
    if (discoveryModal && !discoveryModal.isDestroyed()) discoveryModal.show();
  });
  discoveryModal.on('closed', () => { discoveryModal = null; });
  void discoveryModal.loadFile(path.join(here, 'ui', 'discovery-modal.html'));
  return { open: true };
}

app.on('second-instance', () => { window?.restore(); window?.focus(); });

app.whenReady().then(async () => {
  if (process.platform === 'win32' && !argument('--data-dir') && mode === 'internal') {
    const programs = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs');
    const shortcut = path.join(programs, packageInfo.productName + '.lnk');
    try {
      fs.mkdirSync(programs, { recursive: true });
      const op = fs.existsSync(shortcut) ? 'update' : 'create';
      const installed = shell.writeShortcutLink(shortcut, op, {
        target: process.execPath, args: '"' + projectRoot + '"', cwd: projectRoot,
        icon: fs.existsSync(appIconIco) ? appIconIco : process.execPath, iconIndex: 0,
        description: packageInfo.productName, appUserModelId: process.execPath,
      });
      if (!installed) console.warn('Could not register browser notifications with Windows.');
    } catch { console.warn('Could not register browser notifications with Windows.'); }
  }

  const locale = resolveLocale({ explicitLang: argument('--lang'), dataDir });
  const theme = resolveTheme({ explicitTheme: argument('--theme'), dataDir });
  const downloadDir = resolveDownloadDir({
    explicitDir: argument('--download-dir'),
    electronDownloads: app.getPath('downloads'),
    mode,
  });

  const isMac = process.platform === 'darwin';
  window = new BrowserWindow({
    title: mode === 'oss' ? 'VA Commerce Browser' : packageInfo.productName,
    icon: windowIcon,
    width: 1420, height: 940, minWidth: 980, minHeight: 640,
    backgroundColor: theme === 'light' ? '#f4f7f9' : '#0b0f14',
    autoHideMenuBar: true,
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    ...(isMac
      ? { trafficLightPosition: { x: 14, y: 14 } }
      : { titleBarOverlay: titleBarOverlayOptions(theme) }),
    webPreferences: { preload: path.join(here, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });

  const browserSession = session.fromPartition('persist:internal-browser');
  const ext = mode === 'internal' ? await loadOptionalExtensionModule() : null;
  const extensionContext = ext?.createInternalSessionContext?.(browserSession) ?? {};
  const plugins = await createPluginHost({ mode, extensionContext });

  engine = new BrowserEngine(window, dataDir, state => {
    if (!window.isDestroyed()) window.webContents.send('browser-state', state);
  }, { mode, locale, theme, plugins, sellerStar: extensionContext.sellerStar ?? null });

  window.on('resize', () => engine.layout());
  window.on('maximize', () => engine.layout());
  window.on('unmaximize', () => engine.layout());
  window.on('close', saveTabs);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  installEditMenu(window, window.webContents, () => true, () => engine.locale);

  const MODAL_ALLOWED_COMMANDS = new Set([
    'mcp-connector-info',
    'mcp-connector-install',
    'mcp-connector-uninstall',
    'mcp-connector-copy',
    'mcp-connector-open-demo',
    'mcp-connector-close',
  ]);

  const DISCOVERY_MODAL_COMMANDS = new Set([
    'discovery-modal-data',
    'discovery-modal-close',
    'discovery-modal-open-url',
    'discovery-export',
    'mcp-connector-copy',
    'sellerstar-batch-start',
  ]);

  ipcMain.handle('browser-ui', async (event, command, payload = {}) => {
    const isMainSender = event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame;
    const isModalSender = Boolean(mcpModal && !mcpModal.isDestroyed() &&
      event.sender === mcpModal.webContents && event.senderFrame === mcpModal.webContents.mainFrame);
    const isDiscoveryModalSender = Boolean(discoveryModal && !discoveryModal.isDestroyed() &&
      event.sender === discoveryModal.webContents && event.senderFrame === discoveryModal.webContents.mainFrame);
    if (!isMainSender && !(isModalSender && MODAL_ALLOWED_COMMANDS.has(command)) &&
        !(isDiscoveryModalSender && DISCOVERY_MODAL_COMMANDS.has(command))) {
      throw new Error('Invalid UI sender');
    }

    if (command === 'discovery-modal-open') return openDiscoveryModal(payload?.result || null, payload?.focus_asin || null);
    if (command === 'discovery-modal-data') return buildDiscoveryModalPayload();
    if (command === 'discovery-modal-close') {
      if (discoveryModal && !discoveryModal.isDestroyed()) discoveryModal.close();
      return { closed: true };
    }
    if (command === 'discovery-modal-open-url') {
      const targetUrl = engine.validateUrl(String(payload?.url || ''));
      const tab = await engine.newTab(targetUrl, { activate: true });
      if (payload?.close_modal !== false && discoveryModal && !discoveryModal.isDestroyed()) discoveryModal.close();
      window.focus();
      return engine.describe(tab);
    }

    if (command === 'mcp-connector-open') return openMcpModal();
    if (command === 'mcp-connector-close') {
      if (mcpModal && !mcpModal.isDestroyed()) mcpModal.close();
      return { closed: true };
    }
    if (command === 'mcp-connector-info') return buildConnectorInfo();
    if (command === 'mcp-connector-install') {
      const clientId = String(payload?.client || '');
      const result = installMcpClient({ client: clientId, mode, projectRoot: path.dirname(here) });
      return { ...result, info: buildConnectorInfo() };
    }
    if (command === 'mcp-connector-uninstall') {
      const clientId = String(payload?.client || '');
      const result = uninstallMcpClient({ client: clientId, mode, projectRoot: path.dirname(here) });
      return { ...result, info: buildConnectorInfo() };
    }
    if (command === 'mcp-connector-copy') {
      clipboard.writeText(String(payload?.text || ''));
      return { copied: true };
    }
    if (command === 'mcp-connector-open-demo') {
      if (!service) throw new Error('Local service not ready');
      return engine.newTab('http://127.0.0.1:' + service.port + '/demo').then(t => engine.describe(t));
    }

    if (command === 'state') return engine.state();
    if (command === 'pause') { engine.pause(); return engine.state(); }
    if (command === 'resume') { engine.resume(); return engine.state(); }
    if (command === 'set-locale') {
      engine.locale = saveLocale(dataDir, payload.locale);
      engine.emit();
      return engine.state();
    }
    if (command === 'set-theme') {
      engine.theme = saveTheme(dataDir, payload.theme);
      window.setBackgroundColor(engine.theme === 'light' ? '#f4f7f9' : '#0b0f14');
      if (!isMac && typeof window.setTitleBarOverlay === 'function') {
        window.setTitleBarOverlay(titleBarOverlayOptions(engine.theme));
      }
      engine.emit();
      return engine.state();
    }
    if (command === 'toggle-sidebar') {
      engine.sidebarOpen = typeof payload.open === 'boolean' ? payload.open : !engine.sidebarOpen;
      engine.layout();
      engine.emit();
      return engine.state();
    }
    if (command === 'new') return engine.newTab(payload.url || 'about:blank').then(t => engine.describe(t));

    if (engine.plugins.hasIpc(command)) {
      const handled = await engine.plugins.handleIpc(command, payload, { engine, window, downloadDir });
      if (handled.handled) return handled.result;
    }

    const tab = engine.get(payload.tab_id || engine.active);
    if (command === 'switch') return engine.activate(tab.id);
    if (command === 'set-site-permission') {
      await engine.sitePermissions.update(engine, window, tab, payload);
      return engine.state();
    }
    if (['toggle-clipboard', 'toggle-site-clipboard'].includes(command)) {
      engine.toggleClipboard(tab, command === 'toggle-site-clipboard');
      tab.view.webContents.focus();
      return engine.state();
    }
    tab.lease = null;
    tab.snapshot = null;
    return engine.enqueue(tab.id, async () => {
      engine.get(tab.id);
      tab.lease = null;
      tab.snapshot = null;
      if (command === 'navigate') await tab.view.webContents.loadURL(engine.validateUrl(payload.url));
      else if (command === 'back' && tab.view.webContents.navigationHistory.canGoBack()) tab.view.webContents.navigationHistory.goBack();
      else if (command === 'forward' && tab.view.webContents.navigationHistory.canGoForward()) tab.view.webContents.navigationHistory.goForward();
      else if (command === 'reload') tab.view.webContents.reload();
      else if (command === 'zoom') tab.view.webContents.setZoomFactor(Math.max(0.5, Math.min(3, payload.zoom)));
      else if (command === 'close') engine.closeTab(tab.id);
      engine.emit();
      return engine.state();
    });
  });

  installSitePermissions(browserSession, engine, window);
  browserSession.on('will-download', (_event, item, contents) => {
    fs.mkdirSync(downloadDir, { recursive: true });
    const filename = path.basename(item.getFilename()).replace(/[<>:"/\\|?*]/g, '_');
    const destination = path.join(downloadDir, Date.now() + '-' + filename);
    item.setSavePath(destination);
    const tab = [...engine.tabs.values()].find(tab => tab.view.webContents === contents);
    const record = { id: randomBytes(8).toString('hex'), tab_id: tab?.id ?? null, filename, path: destination, state: 'progressing' };
    engine.downloads.push(record);
    item.once('done', (_ev, state) => { record.state = state; engine.emit(); });
  });

  const token = randomBytes(32).toString('hex');
  service = await startService(engine, token, Number(argument('--port') ?? 18773));
  fs.writeFileSync(runtimePath, JSON.stringify({
    pid: process.pid, endpoint: 'http://127.0.0.1:' + service.port, token, mode, started_at: new Date().toISOString(),
  }), { mode: 0o600 });

  relay = ext?.maybeStartCloudRelay?.({
    dataDir, engine, testLocalRelay: process.argv.includes('--test-local-relay'),
  }) ?? null;

  await window.loadFile(path.join(here, 'ui', 'index.html'));
  let restore;
  try { restore = JSON.parse(fs.readFileSync(path.join(dataDir, 'tabs.json'), 'utf8')); } catch {}
  if (restore?.urls?.length) {
    for (const url of restore.urls.slice(0, 20)) {
      try { await engine.newTab(/^http:\/\/127\.0\.0\.1:\d+\/demo$/.test(url) ? 'http://127.0.0.1:' + service.port + '/demo' : url); } catch {}
    }
    const active = [...engine.tabs.values()][restore.active_index];
    if (active) engine.activate(active.id);
  }
  if (!engine.tabs.size) await engine.newTab('http://127.0.0.1:' + service.port + '/demo');
  engine.emit();
  if (process.argv.includes('--test-minimize')) window.minimize();
  if (process.argv.includes('--open-mcp-modal')) setTimeout(() => openMcpModal(), 250);
}).catch(error => {
  fs.appendFileSync(path.join(dataDir, 'startup-error.log'), new Date().toISOString() + ' ' + error.stack + '\n');
  app.quit();
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
  if (mcpModal && !mcpModal.isDestroyed()) mcpModal.destroy();
  if (discoveryModal && !discoveryModal.isDestroyed()) discoveryModal.destroy();
  relay?.close();
  engine?.watches.endAll('browser_closed');
  engine?.plugins.onBeforeQuit(engine);
  saveTabs();
  service?.server.close();
  try {
    const live = JSON.parse(fs.readFileSync(runtimePath, 'utf8'));
    if (live.pid === process.pid) fs.unlinkSync(runtimePath);
  } catch {}
});
