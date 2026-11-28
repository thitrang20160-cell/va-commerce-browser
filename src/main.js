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
import { build1688SearchUrl, enrichDistributionItems, runBoutiqueTeardown } from './sop-engine.js';
import { build1688AgentPrompt, run1688McpSearch, runCadDraftMcp, runSafeSellMcpAudit, runSellerLensMcpAnalyze, testHubMcp } from './product-hub.js';
import { applyCadQueryCompileResult, generateModelDraft, inferDraftSpec } from './cad-draft-engine.js';
import { DependencyManager } from './dep-manager.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.dirname(here);
const appIconIco = path.join(projectRoot, 'build', 'icon.ico');
const appIconPng = path.join(projectRoot, 'build', 'icon.png');
const windowIcon = (process.platform === 'win32' && fs.existsSync(appIconIco))
  ? appIconIco
  : (fs.existsSync(appIconPng) ? appIconPng : undefined);

function titleBarOverlayOptions(theme) {
  return theme === 'light'
    ? { color: '#eeece7', symbolColor: '#2f2e2b', height: 43 }
    : { color: '#252523', symbolColor: '#c0bdb5', height: 43 };
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
const depManager = new DependencyManager(dataDir);
const runtimePath = path.join(dataDir, 'runtime.json');

function broadcastDepProgress(progress) {
  if (window && !window.isDestroyed()) window.webContents.send('dep-progress', progress);
  if (mcpModal && !mcpModal.isDestroyed()) mcpModal.webContents.send('dep-progress', progress);
}

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

function openMcpModal(initialTab = null) {
  if (!window || window.isDestroyed()) return { open: false };
  if (mcpModal && !mcpModal.isDestroyed()) {
    if (initialTab === 'hub' || initialTab === 'deps') {
      void mcpModal.loadFile(path.join(here, 'ui', 'mcp-modal.html'), { query: { tab: initialTab } });
    }
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
    backgroundColor: engine?.theme === 'light' ? '#f7f6f3' : '#1f1f1d',
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
  void mcpModal.loadFile(path.join(here, 'ui', 'mcp-modal.html'), initialTab ? { query: { tab: initialTab } } : undefined);
  return { open: true };
}

function buildDiscoveryModalPayload() {
  const sopSnap = engine?.sop?.snapshot() ?? null;
  const rules = sopSnap?.distribution || {};
  const enrichedResult = lastDiscoveryData ? {
    ...lastDiscoveryData,
    items: enrichDistributionItems(lastDiscoveryData.items || [], rules),
  } : null;
  return {
    locale: engine?.locale || 'zh-CN',
    theme: engine?.theme || 'dark',
    mode,
    sellerstar_enabled: Boolean(engine?.plugins?.enabledPanels?.().includes('sellerstar-batch')),
    paused: Boolean(engine?.paused),
    focus_asin: lastDiscoveryFocusAsin,
    sop: sopSnap,
    result: enrichedResult,
  };
}

function pushDiscoveryModalState() {
  if (discoveryModal && !discoveryModal.isDestroyed()) {
    discoveryModal.webContents.send('browser-state', buildDiscoveryModalPayload());
  }
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
    backgroundColor: engine?.theme === 'light' ? '#f7f6f3' : '#1f1f1d',
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
    width: 1480, height: 940, minWidth: 900, minHeight: 620,
    backgroundColor: theme === 'light' ? '#f7f6f3' : '#1f1f1d',
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
    'hub-status',
    'hub-save',
    'hub-test',
    'sop-open-sellerstar',
    'dep-list',
    'dep-check',
    'dep-install',
    'dep-cancel',
    'dep-uninstall',
    'dep-open-dir',
  ]);

  const DISCOVERY_MODAL_COMMANDS = new Set([
    'discovery-modal-data',
    'discovery-modal-close',
    'discovery-modal-open-url',
    'discovery-export',
    'mcp-connector-copy',
    'sellerstar-batch-start',
    'sop-set-mode',
    'sop-update-rules',
    'sop-boutique-add',
    'sop-boutique-remove',
    'sop-open-boutique-workbench',
    'sop-open-sellerstar',
    'sop-batch-ip-check',
    'sop-ip-check',
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

    if (command === 'sop-set-mode') {
      const sop = engine.sop.setMode(payload?.mode);
      engine.emit();
      pushDiscoveryModalState();
      return sop;
    }
    if (command === 'sop-update-rules') {
      const sop = engine.sop.updateDistributionRules(payload || {});
      engine.emit();
      pushDiscoveryModalState();
      return sop;
    }
    if (command === 'sop-boutique-add') {
      const list = Array.isArray(payload?.items) ? payload.items : (payload?.item ? [payload.item] : []);
      let sop = engine.sop.snapshot();
      for (const item of list) sop = engine.sop.addBoutiqueItem(item);
      engine.emit();
      pushDiscoveryModalState();
      return sop;
    }
    if (command === 'sop-boutique-remove') {
      const sop = engine.sop.removeBoutiqueItem(payload?.asin);
      engine.emit();
      pushDiscoveryModalState();
      return sop;
    }
    if (command === 'sop-boutique-select') {
      const sop = engine.sop.selectBoutiqueItem(payload?.asin);
      engine.emit();
      return sop;
    }
    if (command === 'sop-boutique-update') {
      const sop = engine.sop.updateBoutiqueItem(payload?.asin, payload?.patch || {});
      engine.emit();
      return sop;
    }
    if (command === 'sop-boutique-teardown') {
      const targetAsin = String(payload?.asin || '').trim().toUpperCase();
      const item = engine.sop.state.boutique.items.find(i => i.asin === targetAsin);
      if (!item) throw new Error('Boutique item not found');
      const teardown = await runBoutiqueTeardown(engine, item);
      const sop = engine.sop.updateBoutiqueItem(targetAsin, { teardown });
      engine.emit();
      return { teardown, sop };
    }
    if (command === 'sop-boutique-source-1688') {
      const targetAsin = String(payload?.asin || '').trim().toUpperCase();
      const item = engine.sop.state.boutique.items.find(i => i.asin === targetAsin) || payload;
      const url = build1688SearchUrl(item);
      const tab = await engine.newTab(url, { activate: true });
      window.focus();
      return { url, tab: engine.describe(tab) };
    }
    if (command === 'sop-boutique-read-1688-tab') {
      const targetAsin = String(payload?.asin || '').trim().toUpperCase();
      const tab = engine.tabs.get(engine.active);
      if (!tab) return { status: 'no_tab' };
      const url = tab.view.webContents.getURL();
      if (!/1688\.com/i.test(url)) return { status: 'not_1688' };
      if (typeof engine.readProductPreview !== 'function') return { status: 'unsupported' };
      const preview = await engine.readProductPreview(tab, { detail: true });
      if (preview?.status !== 'ok' || !preview.product) return { status: preview?.status || 'unavailable' };
      const prod = preview.product;
      const priceCny = Number(prod.offer?.amount || prod.offer?.price_candidate || 0);
      const weightKg = Number(prod.weight_kg || 0);
      const patch = {
        sourcing_url: prod.url || url,
        sourcing_supplier: prod.supplier || prod.brand || '',
        profit: {
          ...(priceCny > 0 ? { cost_cny: priceCny } : {}),
          ...(weightKg > 0 ? { weight_kg: weightKg } : {}),
        },
      };
      const sop = engine.sop.updateBoutiqueItem(targetAsin, patch);
      engine.emit();
      return { status: 'ok', price_cny: priceCny, supplier: patch.sourcing_supplier, sop };
    }
    if (command === 'sop-boutique-export-brief') {
      return engine.sop.exportBrief(downloadDir || dataDir);
    }
    if (command === 'sop-open-boutique-workbench') {
      engine.sop.setMode('boutique');
      if (discoveryModal && !discoveryModal.isDestroyed()) discoveryModal.close();
      engine.emit();
      if (!window.isDestroyed()) {
        window.webContents.send('browser-state', { ...engine.state(), _focus_view: 'boutique' });
        window.focus();
      }
      return { ok: true };
    }
    if (command === 'sop-open-sellerstar') {
      if (discoveryModal && !discoveryModal.isDestroyed()) discoveryModal.close();
      if (engine.plugins.hasIpc('sellerstar-open')) {
        const res = await engine.plugins.handleIpc('sellerstar-open', {}, { engine, window, downloadDir });
        window.focus();
        return res.result;
      }
      return { ok: false };
    }

    // ===== Product MCP Hub & External Ecosystem Orchestrator (v0.8.0) =====
    if (command === 'hub-status') {
      let portal = { status: 'unavailable', tenant_name: '' };
      if (engine.sellerStar) {
        portal = await engine.sellerStar.status().catch(() => ({ status: 'login_required' }));
      }
      return engine.productHub.snapshot({
        portalConnected: portal.status === 'connected',
        portalTenant: portal.tenant_name || portal.tenant_id || '',
      });
    }
    if (command === 'hub-save') {
      const id = String(payload?.id || '');
      engine.productHub.update(id, payload || {});
      engine.emit();
      let portal = { status: 'unavailable', tenant_name: '' };
      if (engine.sellerStar) portal = await engine.sellerStar.status().catch(() => ({ status: 'login_required' }));
      return engine.productHub.snapshot({
        portalConnected: portal.status === 'connected',
        portalTenant: portal.tenant_name || portal.tenant_id || '',
      });
    }
    if (command === 'hub-test') {
      const id = String(payload?.id || '');
      const raw = engine.productHub.getRaw(id);
      if (!raw) throw new Error('Unknown service');
      const testCfg = {
        ...raw,
        ...(payload?.url !== undefined ? { url: payload.url } : {}),
        ...(payload?.token ? { token: payload.token } : {}),
      };
      const tested = await testHubMcp(testCfg);
      engine.productHub.update(id, {
        ...(payload?.url !== undefined ? { url: payload.url } : {}),
        ...(payload?.token ? { token: payload.token } : {}),
        enabled: true,
        last_checked_at: new Date().toISOString(),
        last_status: `ok:${tested.count}`,
        tools: tested.tools,
      });
      engine.emit();
      return { ...tested, hub: engine.productHub.snapshot({ portalConnected: Boolean(engine.sellerStar) }) };
    }
    if (command === 'sop-ip-check') {
      const targetAsin = String(payload?.asin || '').trim().toUpperCase();
      const item = engine.sop.state.boutique.items.find(i => i.asin === targetAsin) || payload?.item;
      if (!item) throw new Error('找不到待查侵权的商品。');
      const dims = payload?.dims || { text: true, design: true, copyright: true, vision: true };
      let report;
      if (engine.productHub.isConfigured('safesellai')) {
        const res = await runSafeSellMcpAudit(engine.productHub.getRaw('safesellai'), [item], dims);
        report = res.results[0];
      } else if (engine.ecosystemBridge) {
        report = await engine.ecosystemBridge.runPortalIpFullCheck(item, dims);
      } else {
        throw new Error('请先在「MCP 连接器 → 产品 Hub」中配置 SafeSellAI MCP（https://safesellai.com/mcp + API Key），或在塞星中登录账号。');
      }
      if (engine.sop.state.boutique.items.some(i => i.asin === targetAsin)) {
        const checkedLabels = [];
        if (report.dims?.trademark_text?.scanned) checkedLabels.push('商标');
        if (report.dims?.design_patent?.scanned) checkedLabels.push('外观专利');
        if (report.dims?.copyright?.scanned) checkedLabels.push('版权');
        if (report.dims?.trademark_vision?.scanned) checkedLabels.push('图形商标');
        const sop = engine.sop.updateBoutiqueItem(targetAsin, {
          ip_report: report,
          compliance: {
            status: report.compliance_status || 'pending',
            checks: checkedLabels,
            note: `SafeSellAI (${report.verdict}) · ${report.checked_at?.slice(0, 16) || ''}`,
          },
        });
        engine.emit();
        return { report, sop };
      }
      return { report };
    }
    if (command === 'sop-batch-ip-check') {
      const targetItems = Array.isArray(payload?.items) && payload.items.length
        ? payload.items
        : (lastDiscoveryData?.items || []);
      if (!targetItems.length) throw new Error('当前没有待检查的商品列表。');
      let scanRes;
      if (engine.productHub.isConfigured('safesellai')) {
        scanRes = await runSafeSellMcpAudit(engine.productHub.getRaw('safesellai'), targetItems, { text: true, design: false, copyright: false, vision: false });
      } else if (engine.ecosystemBridge) {
        scanRes = await engine.ecosystemBridge.runPortalBatchIpScan(targetItems);
      } else {
        throw new Error('请先登录塞星或在「产品 MCP Hub」中配置 SafeSellAI MCP。');
      }
      const byKey = new Map((scanRes.results || []).map(r => [String(r.key), r]));
      if (lastDiscoveryData?.items?.length) {
        for (const it of lastDiscoveryData.items) {
          const hit = byKey.get(it.asin);
          if (hit) {
            it.safesell_verdict = hit.verdict;
            it.safesell_hits = hit.hits || [];
          }
        }
        pushDiscoveryModalState();
      }
      return scanRes;
    }
    if (command === 'sop-sellerlens-analyze') {
      const targetAsin = String(payload?.asin || '').trim().toUpperCase();
      const item = engine.sop.state.boutique.items.find(i => i.asin === targetAsin);
      if (!item) throw new Error('找不到精品候选商品。');
      const kw = String(payload?.keyword || item.keyword || item.title || '').trim().split(/\s+/).slice(0, 5).join(' ');
      let slReport;
      if (engine.productHub.isConfigured('sellerlens')) {
        slReport = await runSellerLensMcpAnalyze(engine.productHub.getRaw('sellerlens'), kw, 'US');
      } else if (engine.ecosystemBridge) {
        slReport = await engine.ecosystemBridge.runPortalSellerLensAnalyze(
          { ...item, keyword: kw },
          lastDiscoveryData?.items || []
        );
      } else {
        throw new Error('请先在「MCP 连接器 → 产品 Hub」配置 SellerLens MCP 地址，或登录塞星账号复用 SellerLens 选品引擎。');
      }
      const sop = engine.sop.updateBoutiqueItem(targetAsin, { sellerlens: slReport });
      engine.emit();
      return { sellerlens: slReport, sop };
    }
    if (command === 'sop-1688-handoff') {
      const targetAsin = String(payload?.asin || '').trim().toUpperCase();
      const item = engine.sop.state.boutique.items.find(i => i.asin === targetAsin) || payload;
      if (!item) throw new Error('找不到商品信息。');
      if (payload?.mode === 'agent_prompt') {
        const prompt = build1688AgentPrompt(item);
        clipboard.writeText(prompt);
        return { mode: 'agent_prompt', copied: true, prompt };
      }
      if (engine.productHub.isConfigured('sourcing_1688')) {
        const mcpRes = await run1688McpSearch(engine.productHub.getRaw('sourcing_1688'), item);
        if (engine.sop.state.boutique.items.some(i => i.asin === targetAsin)) {
          engine.sop.updateBoutiqueItem(targetAsin, { sourcing_handoff: mcpRes });
          engine.emit();
        }
        return mcpRes;
      }
      if (engine.ecosystemBridge) {
        const handoff = await engine.ecosystemBridge.runPortal1688Handoff(item);
        if (engine.sop.state.boutique.items.some(i => i.asin === targetAsin)) {
          engine.sop.updateBoutiqueItem(targetAsin, { sourcing_handoff: handoff, sourcing_url: handoff.portal_url });
          engine.emit();
        }
        if (handoff.portal_url) {
          await engine.newTab(handoff.portal_url, { activate: true });
          window.focus();
        }
        return handoff;
      }
      const prompt = build1688AgentPrompt(item);
      clipboard.writeText(prompt);
      return { mode: 'agent_prompt_fallback', copied: true, prompt, message: '已复制 1688 Skill / Agent 寻源指令到剪贴板。' };
    }

    // ===== Self-Installing Local Dependency Manager (Consent-First) =====
    if (command === 'dep-list') return depManager.listAll();
    if (command === 'dep-check') return depManager.check(String(payload?.id || ''));
    if (command === 'dep-install') {
      const id = String(payload?.id || '');
      return depManager.install(id, {
        approved: payload?.approved === true,
        reason: payload?.reason || 'user_ui_confirmed',
        onProgress: progress => broadcastDepProgress(progress),
      });
    }
    if (command === 'dep-cancel') return depManager.cancel(String(payload?.id || ''));
    if (command === 'dep-uninstall') return depManager.uninstall(String(payload?.id || ''));
    if (command === 'dep-open-dir') {
      fs.mkdirSync(depManager.runtimesDir, { recursive: true });
      await shell.openPath(depManager.runtimesDir);
      return { opened: true, dir: depManager.runtimesDir };
    }

    // ===== Parametric CAD Model Draft (STEP / STL / DXF / DFM / RFQ) =====
    if (command === 'sop-cad-infer') {
      const targetAsin = String(payload?.asin || '').trim().toUpperCase();
      const item = engine.sop.state.boutique.items.find(i => i.asin === targetAsin) || payload || {};
      return inferDraftSpec(item);
    }
    if (command === 'sop-cad-generate') {
      const targetAsin = String(payload?.asin || '').trim().toUpperCase();
      const item = engine.sop.state.boutique.items.find(i => i.asin === targetAsin);
      const requestedEngine = String(payload?.engine || 'auto'); // 'auto' | 'builtin' | 'cadquery'
      const baseSpec = item ? inferDraftSpec(item) : {};
      const mergedSpec = {
        ...baseSpec,
        ...(payload?.spec || {}),
        asin: targetAsin || payload?.spec?.asin || baseSpec.asin || '',
        title: item?.title || payload?.spec?.title || baseSpec.title || '',
        diff_note: item?.diff_note || payload?.spec?.diff_note || baseSpec.diff_note || '',
      };

      // If customer explicitly requested CadQuery OCCT precision kernel and it is missing,
      // return structured missing_dependency so UI asks customer consent before installing & auto-resuming.
      let cadDep = null;
      if (!engine.productHub.isConfigured('cad_draft') && requestedEngine !== 'builtin') {
        cadDep = await depManager.check('cadquery');
        if (requestedEngine === 'cadquery' && !cadDep.installed) {
          return {
            ok: false,
            missing_dependency: cadDep,
            pending_action: { command: 'sop-cad-generate', payload: { ...payload, engine: 'cadquery' } },
          };
        }
      }

      const outDir = path.join(downloadDir || dataDir, 'VA-Model-Drafts');
      let draft;
      if (engine.productHub.isConfigured('cad_draft')) {
        draft = await runCadDraftMcp(engine.productHub.getRaw('cad_draft'), mergedSpec);
      } else {
        draft = generateModelDraft(mergedSpec, outDir);
        if (cadDep?.installed && (requestedEngine === 'cadquery' || requestedEngine === 'auto')) {
          try {
            const occt = await depManager.compileCadQueryDraft(draft.files.cadquery_py, draft.files.dir);
            draft = applyCadQueryCompileResult(draft, occt);
          } catch (occtErr) {
            if (requestedEngine === 'cadquery') throw occtErr;
            draft.occt_warning = occtErr?.message || String(occtErr);
          }
        }
      }
      if (item) {
        const sop = engine.sop.updateBoutiqueItem(targetAsin, { model_draft: draft });
        engine.emit();
        return { ok: true, draft, sop };
      }
      return { ok: true, draft };
    }
    if (command === 'sop-cad-apply-weight') {
      const targetAsin = String(payload?.asin || '').trim().toUpperCase();
      const item = engine.sop.state.boutique.items.find(i => i.asin === targetAsin);
      if (!item?.model_draft?.dfm) throw new Error('请先生成模型草稿。');
      const wKg = Number(item.model_draft.dfm.weight_kg);
      const sop = engine.sop.updateBoutiqueItem(targetAsin, {
        profit: { ...(item.profit || {}), weight_kg: wKg > 0 ? wKg : item.profit?.weight_kg },
      });
      engine.emit();
      return { weight_kg: wKg, sop };
    }
    if (command === 'sop-cad-copy-rfq') {
      const targetAsin = String(payload?.asin || '').trim().toUpperCase();
      const item = engine.sop.state.boutique.items.find(i => i.asin === targetAsin);
      const text = item?.model_draft?.rfq_text;
      if (!text) throw new Error('请先生成模型草稿。');
      clipboard.writeText(text);
      return { copied: true };
    }
    if (command === 'sop-cad-open-folder') {
      const dir = path.resolve(String(payload?.dir || ''));
      const allowedRoots = [path.resolve(downloadDir || dataDir), path.resolve(dataDir)];
      if (!allowedRoots.some(r => dir === r || dir.startsWith(r + path.sep)) || !fs.existsSync(dir)) {
        throw new Error('草稿目录不可访问。');
      }
      await shell.openPath(dir);
      return { opened: true, dir };
    }

    if (command === 'mcp-connector-open') return openMcpModal(payload?.tab || null);
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
    if (command === 'set-panel-width') {
      const width = Number(payload.width);
      if (!Number.isFinite(width)) throw new Error('Invalid panel width');
      engine.panelWidth = width === 0 ? 0 : Math.max(300, Math.min(600, width));
      engine.layout();
      return { chrome_layout: engine.chromeLayout() };
    }
    if (command === 'download-reveal') {
      const file = engine.downloads.find(row => row.id === payload.id);
      if (!file || file.state !== 'completed' || !fs.existsSync(file.path)) throw new Error('下载文件不存在或尚未完成。');
      shell.showItemInFolder(file.path);
      return { shown: true };
    }
    if (command === 'pause') { engine.pause(); return engine.state(); }
    if (command === 'resume') { engine.resume(); return engine.state(); }
    if (command === 'set-locale') {
      engine.locale = saveLocale(dataDir, payload.locale);
      engine.emit();
      return engine.state();
    }
    if (command === 'set-theme') {
      engine.theme = saveTheme(dataDir, payload.theme);
      window.setBackgroundColor(engine.theme === 'light' ? '#f7f6f3' : '#1f1f1d');
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
    engine.emit();
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
