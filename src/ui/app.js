let current;
const $ = id => document.getElementById(id);
const i18n = window.browserI18n;
const t = (key, ...args) => i18n ? i18n.t(key, ...args) : key;
const permissionInputs = [...document.querySelectorAll('#site-permissions input')];
let appliedLocale = null;
let appliedMode = null;

const command = async (name, args = {}) => {
  try { return await window.browserUI.command(name, args); }
  catch (error) {
    $('error').textContent = error.message; $('error').hidden = false;
    setTimeout(() => { $('error').hidden = true; }, 6000);
  }
};

const extensionUpdaters = (window.browserExtensions || []).map(bind => bind($, command));
const updateDiscovery = typeof bindProductDiscovery === 'function' ? bindProductDiscovery($, command) : () => {};

function hasPanel(state, name) {
  return Array.isArray(state?.enabled_panels) ? state.enabled_panels.includes(name) : true;
}

function updateTabTasks(tabs) {
  const list = $('tab-tasks');
  const tasks = tabs.filter(tab => tab.active || tab.owner || tab.collecting || tab.watching?.length);
  list.replaceChildren(...tasks.map(tab => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'tab-task';
    if (tab.active) item.setAttribute('aria-current', 'true');
    const title = document.createElement('strong');
    title.textContent = tab.title;
    title.title = tab.title;
    const detail = document.createElement('small');
    const phases = [tab.active ? t('tabForeground') : t('tabBackground')];
    if (tab.loading) phases.push(t('tabLoading'));
    if (tab.owner) phases.push(tab.owner);
    if (tab.collecting) phases.push(t('tabCollecting'));
    for (const kind of tab.watching ?? []) phases.push(kind === 'video' ? t('tabWatchVideo') : t('tabWatchPage'));
    detail.textContent = phases.join(' · ');
    item.onclick = () => command('switch', { tab_id: tab.id });
    item.append(title, detail);
    return item;
  }));
}

function update(state) {
  current = state;
  const nextLocale = state.locale || 'zh-CN';
  const nextMode = state.mode || 'internal';
  const nextTheme = state.theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = nextTheme;
  if ($('theme-icon-sun')) $('theme-icon-sun').hidden = nextTheme === 'light';
  if ($('theme-icon-moon')) $('theme-icon-moon').hidden = nextTheme !== 'light';

  const sidebarOpen = state.sidebar_open !== false;
  document.body.classList.toggle('sidebar-collapsed', !sidebarOpen);
  if ($('sidebar-toggle')) $('sidebar-toggle').setAttribute('aria-pressed', String(sidebarOpen));

  if (i18n && (appliedLocale !== nextLocale || appliedMode !== nextMode)) {
    i18n.setLocale(nextLocale);
    i18n.applyStatic(nextMode);
    appliedLocale = nextLocale;
    appliedMode = nextMode;
    document.title = nextMode === 'oss' ? t('brandOss') : t('brandName');
  }

  const discoveryEnabled = hasPanel(state, 'product-discovery');
  if ($('discovery-toggle')) $('discovery-toggle').hidden = !discoveryEnabled;
  if ($('product-discovery') && !discoveryEnabled) $('product-discovery').hidden = true;

  const active = state.tabs.find(tab => tab.id === state.active);
  if (document.activeElement !== $('address')) $('address').value = active?.url || '';
  $('zoom').textContent = Math.round((active?.zoom || 1) * 100) + '%';
  $('tabs').replaceChildren(...state.tabs.map(tab => {
    const item = document.createElement('div');
    item.className = 'tab' + (tab.id === state.active ? ' active' : '');
    if (tab.owner || tab.collecting || tab.watching?.length) {
      const dot = document.createElement('span');
      dot.className = 'tab-dot';
      item.append(dot);
    }
    const title = document.createElement('span');
    title.className = 'tab-title';
    title.textContent = tab.title;
    title.title = tab.url;
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = '×';
    close.title = t('closeTabTitle');
    close.onclick = event => { event.stopPropagation(); command('close', { tab_id: tab.id }); };
    item.onclick = () => command('switch', { tab_id: tab.id });
    item.append(title, close);
    return item;
  }));

  const chip = $('state-chip');
  if (chip) {
    chip.className = 'state-chip' + (state.paused ? ' is-paused' : active?.owner ? ' is-agent' : '');
    chip.textContent = state.paused ? t('statePaused') : active?.owner ? t('stateAgent') : t('stateReady');
  }
  $('ownership').textContent = state.paused
    ? t('ownershipPaused')
    : active?.owner ? t('ownershipActive', active.owner) : t('ownershipIdle');
  $('takeover').hidden = state.paused;
  $('resume').hidden = !state.paused;

  const clipboard = $('clipboard-write');
  clipboard.hidden = !active?.clipboard_write_available || active.clipboard_write_remembered;
  clipboard.textContent = active?.clipboard_write_allowed ? t('clipboardRevokeOnce') : t('clipboardAllowOnce');
  clipboard.setAttribute('aria-pressed', String(Boolean(active?.clipboard_write_allowed)));
  const siteClipboard = $('clipboard-site');
  siteClipboard.hidden = !active?.clipboard_write_available;
  siteClipboard.textContent = active?.clipboard_write_remembered ? t('clipboardRevokeSite') : t('clipboardAllowSite');
  siteClipboard.setAttribute('aria-pressed', String(Boolean(active?.clipboard_write_remembered)));
  siteClipboard.title = siteClipboard.hidden ? '' : new URL(active.url).origin;

  $('site-permissions').hidden = !active?.site_permission_origin;
  $('permission-origin').textContent = active?.site_permission_origin ?? '';
  for (const input of permissionInputs) input.checked = Boolean(active?.site_permissions?.[input.name]);

  for (const updater of extensionUpdaters) updater(state, active);
  if (discoveryEnabled) updateDiscovery(state);

  $('status').textContent = t('statusLocal', state.version);
  $('empty').hidden = state.tabs.length > 0;
  updateTabTasks(state.tabs);

  const badge = $('mcp-badge');
  if (badge) {
    badge.hidden = !state.clients.length;
    badge.textContent = String(state.clients.length);
  }

  $('clients').replaceChildren();
  if (!state.clients.length) $('clients').textContent = t('clientsEmpty');
  for (const client of state.clients) {
    const node = document.createElement('div');
    node.className = 'client';
    node.textContent = client.name;
    $('clients').append(node);
  }

  $('receipts').replaceChildren();
  if (!state.receipts.length) $('receipts').textContent = t('receiptsEmpty');
  for (const receipt of state.receipts.slice(-8).reverse()) {
    const node = document.createElement('div');
    node.className = 'receipt';
    const title = document.createElement('strong');
    title.textContent = receipt.tool.replace('browser_', '');
    const detail = document.createElement('small');
    detail.textContent = receipt.client + ' · ' + receipt.status;
    node.append(title, detail);
    $('receipts').append(node);
  }
}

window.browserUI.subscribe(update);
$('address-form').onsubmit = event => {
  event.preventDefault();
  let url = $('address').value.trim(); if (!/^https?:|^about:/.test(url)) url = 'https://' + url;
  command(current.tabs.length ? 'navigate' : 'new', { url });
};
$('new').onclick = () => command('new');
for (const name of ['back', 'forward', 'reload']) $(name).onclick = () => command(name);
$('takeover').onclick = () => command('pause');
$('resume').onclick = () => command('resume');
$('clipboard-write').onclick = () => command('toggle-clipboard', { tab_id: current.active });
$('clipboard-site').onclick = () => command('toggle-site-clipboard', { tab_id: current.active });

const openMcp = () => command('mcp-connector-open');
for (const id of ['mcp-toggle', 'mcp-open-from-card', 'mcp-open-from-clients']) {
  if ($(id)) $(id).onclick = openMcp;
}
if ($('theme-toggle')) {
  $('theme-toggle').onclick = () => {
    const next = (current?.theme || 'dark') === 'dark' ? 'light' : 'dark';
    command('set-theme', { theme: next });
  };
}
if ($('sidebar-toggle')) {
  $('sidebar-toggle').onclick = () => command('toggle-sidebar');
}
if ($('lang-toggle')) {
  $('lang-toggle').onclick = () => {
    const next = (current?.locale || 'zh-CN') === 'zh-CN' ? 'en' : 'zh-CN';
    command('set-locale', { locale: next });
  };
}
for (const input of permissionInputs) input.onchange = async () => {
  const active = current.tabs.find(tab => tab.id === current.active);
  const state = await command('set-site-permission', {
    tab_id: active?.id, origin: active?.site_permission_origin, permission: input.name, allowed: input.checked,
  });
  update(state ?? current);
};
$('zoom-in').onclick = () => command('zoom', { zoom: (current.tabs.find(t => t.id === current.active)?.zoom || 1) + 0.1 });
$('zoom-out').onclick = () => command('zoom', { zoom: (current.tabs.find(t => t.id === current.active)?.zoom || 1) - 0.1 });
command('state').then(update);
