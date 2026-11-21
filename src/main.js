import { app, BrowserWindow, ipcMain, session, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import packageInfo from '../package.json' with { type: 'json' };
import { BrowserEngine, installEditMenu } from './engine.js';
import { startService } from './service.js';
import { installSitePermissions } from './site-permissions.js';

const here = path.dirname(fileURLToPath(import.meta.url));
function argument(name) {
  const at = process.argv.indexOf(name);
  return at < 0 ? null : process.argv[at + 1];
}
const dataDir = argument('--data-dir') || path.join(app.getPath('appData'), 'VA Commerce Browser OSS');
fs.mkdirSync(dataDir, { recursive: true });
app.setPath('userData', dataDir);
if (process.platform === 'win32') app.setAppUserModelId(process.execPath);
if (!app.requestSingleInstanceLock()) app.quit();
let window;
let engine;
let service;
const runtimePath = path.join(dataDir, 'runtime.json');
function saveTabs() {
  if (!engine) return;
  const tabs = [...engine.tabs.values()].filter(t => !t.view.webContents.isDestroyed() && (!t.batchOwned || t.id === engine.active));
  if (!tabs.length) return;
  fs.writeFileSync(path.join(dataDir, 'tabs.json'), JSON.stringify({ urls: tabs.map(t => t.view.webContents.getURL()), active_index: tabs.findIndex(t => t.id === engine.active) }), { mode: 0o600 });
}

app.on('second-instance', () => { window?.restore(); window?.focus(); });
app.whenReady().then(async () => {
  if (process.platform === 'win32' && !argument('--data-dir')) {
    const programs = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs');
    const shortcut = path.join(programs, packageInfo.productName + '.lnk');
    try {
      fs.mkdirSync(programs, { recursive: true });
      if (!fs.existsSync(shortcut)) {
        const installed = shell.writeShortcutLink(shortcut, 'create', {
          target: process.execPath, args: '"' + path.dirname(here) + '"', cwd: path.dirname(here),
          description: packageInfo.productName, appUserModelId: process.execPath,
        });
        if (!installed) console.warn('Could not register browser notifications with Windows.');
      }
    } catch { console.warn('Could not register browser notifications with Windows.'); }
  }
  window = new BrowserWindow({
    title: packageInfo.productName, width: 1400, height: 940, minWidth: 960, minHeight: 640,
    backgroundColor: '#eef2f3', autoHideMenuBar: true,
    webPreferences: { preload: path.join(here, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  const browserSession = session.fromPartition('persist:internal-browser');
  engine = new BrowserEngine(window, dataDir, state => {
    if (!window.isDestroyed()) window.webContents.send('browser-state', state);
  });
  window.on('resize', () => engine.layout());
  window.on('close', saveTabs);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  installEditMenu(window, window.webContents, () => true);
  ipcMain.handle('browser-ui', async (event, command, payload = {}) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Invalid UI sender');
    if (command === 'state') return engine.state();
    if (command === 'pause') { engine.pause(); return engine.state(); }
    if (command === 'resume') { engine.paused = false; engine.emit(); return engine.state(); }
    if (command === 'new') return engine.newTab(payload.url || 'about:blank').then(t => engine.describe(t));
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
    // Direct human navigation takes the tab back from the agent.
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
    const directory = argument('--download-dir') || path.join(app.getPath('downloads'), 'VA Commerce Browser OSS');
    fs.mkdirSync(directory, { recursive: true });
    const filename = path.basename(item.getFilename()).replace(/[<>:"/\\|?*]/g, '_');
    const destination = path.join(directory, Date.now() + '-' + filename);
    item.setSavePath(destination);
    const tab = [...engine.tabs.values()].find(tab => tab.view.webContents === contents);
    const record = { id: randomBytes(8).toString('hex'), tab_id: tab?.id ?? null, filename, path: destination, state: 'progressing' };
    engine.downloads.push(record);
    item.once('done', (_ev, state) => { record.state = state; engine.emit(); });
  });
  const token = randomBytes(32).toString('hex');
  service = await startService(engine, token, Number(argument('--port') ?? 18773));
  fs.writeFileSync(runtimePath, JSON.stringify({
    pid: process.pid, endpoint: 'http://127.0.0.1:' + service.port, token, started_at: new Date().toISOString(),
  }), { mode: 0o600 });
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
}).catch(error => {
  fs.appendFileSync(path.join(dataDir, 'startup-error.log'), new Date().toISOString() + ' ' + error.stack + '\n');
  app.quit();
});
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
  engine?.watches.endAll('browser_closed');
  saveTabs();
  service?.server.close();
  try {
    const live = JSON.parse(fs.readFileSync(runtimePath, 'utf8'));
    if (live.pid === process.pid) fs.unlinkSync(runtimePath);
  } catch {}
});
