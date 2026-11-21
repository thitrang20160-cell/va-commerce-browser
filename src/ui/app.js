let current;
const $ = id => document.getElementById(id);
const permissionInputs = [...document.querySelectorAll('#site-permissions input')];
const command = async (name, args = {}) => {
  try { return await window.browserUI.command(name, args); }
  catch (error) {
    $('error').textContent = error.message; $('error').hidden = false;
    setTimeout(() => { $('error').hidden = true; }, 6000);
  }
};
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
    const phases = [tab.active ? '前台' : '后台'];
    if (tab.loading) phases.push('加载中');
    if (tab.owner) phases.push(tab.owner);
    if (tab.collecting) phases.push('采集中');
    for (const kind of tab.watching ?? []) phases.push(kind === 'video' ? '视频监控' : '网页监控');
    detail.textContent = phases.join(' · ');
    item.onclick = () => command('switch', { tab_id: tab.id });
    item.append(title, detail);
    return item;
  }));
}
function update(state) {
  current = state;
  const active = state.tabs.find(t => t.id === state.active);
  if (document.activeElement !== $('address')) $('address').value = active?.url || '';
  $('zoom').textContent = Math.round((active?.zoom || 1) * 100) + '%';
  $('tabs').replaceChildren(...state.tabs.map(tab => {
    const item = document.createElement('div'); item.className = 'tab' + (tab.id === state.active ? ' active' : '');
    const title = document.createElement('span'); title.textContent = tab.title; title.title = tab.url;
    const close = document.createElement('button'); close.textContent = '×'; close.title = '关闭标签页';
    close.onclick = event => { event.stopPropagation(); command('close', { tab_id: tab.id }); };
    item.onclick = () => command('switch', { tab_id: tab.id }); item.append(title, close); return item;
  }));
  $('ownership').textContent = state.paused ? '已暂停。现在可以人工操作页面。' : active?.owner ? active.owner + ' 正在操作这个标签页' : '当前标签页由你控制，等待 Agent 接管。';
  $('takeover').hidden = state.paused; $('resume').hidden = !state.paused;
  const clipboard = $('clipboard-write');
  clipboard.hidden = !active?.clipboard_write_available || active.clipboard_write_remembered;
  clipboard.textContent = active?.clipboard_write_allowed ? '撤销本页复制权限' : '允许本页复制（60 秒）';
  clipboard.setAttribute('aria-pressed', String(Boolean(active?.clipboard_write_allowed)));
  const siteClipboard = $('clipboard-site');
  siteClipboard.hidden = !active?.clipboard_write_available;
  siteClipboard.textContent = active?.clipboard_write_remembered ? '撤销此网站复制权限' : '始终允许此网站复制';
  siteClipboard.setAttribute('aria-pressed', String(Boolean(active?.clipboard_write_remembered)));
  siteClipboard.title = siteClipboard.hidden ? '' : new URL(active.url).origin;
  $('site-permissions').hidden = !active?.site_permission_origin;
  $('permission-origin').textContent = active?.site_permission_origin ?? '';
  for (const input of permissionInputs) input.checked = Boolean(active?.site_permissions?.[input.name]);
  $('status').textContent = '本地运行 · ' + state.version;
  $('empty').hidden = state.tabs.length > 0;
  updateTabTasks(state.tabs);
  $('clients').replaceChildren();
  if (!state.clients.length) $('clients').textContent = '等待 MCP 客户端连接';
  for (const client of state.clients) { const node = document.createElement('div'); node.className = 'client'; node.textContent = client.name; $('clients').append(node); }
  $('receipts').replaceChildren();
  if (!state.receipts.length) $('receipts').textContent = '操作完成后，回执会显示在这里。';
  for (const receipt of state.receipts.slice(-8).reverse()) {
    const node = document.createElement('div'); node.className = 'receipt';
    const title = document.createElement('strong'); title.textContent = receipt.tool.replace('browser_', '');
    const detail = document.createElement('small'); detail.textContent = receipt.client + ' · ' + receipt.status;
    node.append(title, detail); $('receipts').append(node);
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
