// The shell reorganizes existing controls. Business handlers stay in their original modules.
(() => {
  const $ = id => document.getElementById(id);
  const make = (tag, cls, text) => {
    const el = document.createElement(tag); if (cls) el.className = cls;
    if (text) el.textContent = text; return el;
  };
  const paths = {
    browse: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M3 9h18M8 4v5"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
    download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4"/>',
    settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>',
    close: '<path d="m6 6 12 12M6 18l12-12"/>',
    arrow: '<path d="m9 5 7 7-7 7"/>',
    link: '<path d="M14 3h7v7m0-7L11 13M10 5H5v14h14v-5"/>',
    folder: '<path d="M3 7V5h6l2 2h10v13H3Z"/>',
  };
  const icon = name => {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none');
    s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '1.7');
    s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
    s.setAttribute('aria-hidden', 'true'); s.innerHTML = paths[name] || paths.browse; return s;
  };
  const button = (id, cls, name) => {
    const el = make('button', cls); el.id = id; el.type = 'button';
    if (name) el.append(icon(name)); return el;
  };
  const labels = {
    'zh-CN': {
      workspace: ['浏览工作台', '标签、任务和运行记录'], discovery: ['AI 选品', '从找商品到完成立项'],
      batch: ['采集队列', '整理商品，确认后入库'], settings: ['浏览器设置', '外观、语言和当前网站权限'],
      downloads: ['下载文件', '查看本次浏览中的下载'], search: ['快速查找', '搜索标签页或功能入口'],
      browse: '浏览', discover: '选品', collect: '采集', connect: '连接', download: '下载', setting: '设置',
      searchHint: '搜索标签或功能…', tabHint: '搜索已打开的标签…', empty: '没有匹配的标签或功能',
      appearance: '外观与语言', theme: '深浅主题', language: '界面语言', site: '当前网站',
      pages: '已打开的标签', noDownloads: '暂无下载文件', downloadHint: '网页下载的文件会出现在这里。',
      reveal: '打开所在文件夹', open: '打开文件', close: '收起工作台', resize: '调整工作台宽度',
      status: { progressing: '下载中', completed: '已完成', cancelled: '已取消', interrupted: '已中断' },
      help: '快捷键', shortcuts: 'Ctrl+L 地址栏 · Ctrl+K 快速查找 · Ctrl+T 新标签 · Ctrl+Shift+E 工作台',
      quickTitle: '继续你的工作', quickHint: '按任务选择入口，网页始终留在当前窗口。',
      quickDiscover: '发现与分析商品', quickBatch: '整理待采集商品', about: '本机浏览器',
      siteEmpty: '打开一个网页后，在这里管理它的权限。',
    },
    en: {
      workspace: ['Browser workspace', 'Tabs, agents and activity'], discovery: ['Product discovery', 'Research, compare and qualify'],
      batch: ['Collection queue', 'Review products before collecting'], settings: ['Browser settings', 'Appearance, language and site permissions'],
      downloads: ['Downloads', 'Files from this browsing session'], search: ['Quick find', 'Search tabs and tools'],
      browse: 'Browse', discover: 'Discover', collect: 'Collect', connect: 'Connect', download: 'Files', setting: 'Settings',
      searchHint: 'Search tabs or tools…', tabHint: 'Search open tabs…', empty: 'No matching tabs or tools',
      appearance: 'Appearance & language', theme: 'Color theme', language: 'Language', site: 'Current site',
      pages: 'Open tabs', noDownloads: 'No downloads yet', downloadHint: 'Files downloaded from a page will appear here.',
      reveal: 'Show in folder', open: 'Open file', close: 'Hide workspace', resize: 'Resize workspace',
      status: { progressing: 'Downloading', completed: 'Completed', cancelled: 'Cancelled', interrupted: 'Interrupted' },
      help: 'Keyboard shortcuts', shortcuts: 'Ctrl+L Address · Ctrl+K Quick find · Ctrl+T New tab · Ctrl+Shift+E Workspace',
      quickTitle: 'Continue your work', quickHint: 'Pick a task and keep the page in view.',
      quickDiscover: 'Discover products', quickBatch: 'Prepare collection', about: 'Local browser',
      siteEmpty: 'Open a web page to manage its permissions here.',
    },
  };
  let state, command, switchPane, active = 'workspace', locale = 'zh-CN';
  let searchKey = '', downloadsKey = '';
  const tr = key => (labels[locale] || labels['zh-CN'])[key];
  const aside = document.querySelector('aside'); aside.id = 'workbench';
  const toolbar = document.querySelector('body > nav'); toolbar.classList.add('browser-toolbar');
  toolbar.setAttribute('aria-label', '浏览导航');
  const rail = make('div', 'workspace-rail'); rail.setAttribute('role', 'navigation');
  rail.setAttribute('aria-label', '工作空间'); document.body.append(rail);
  const mainRail = make('div', 'rail-main'); const lowerRail = make('div', 'rail-lower');
  rail.append(mainRail, lowerRail);
  const railMap = [
    ['workspace-toggle', 'browse', 'browse'], ['discovery-toggle', 'discover'], ['batch-toggle', 'collect'], ['mcp-toggle', 'connect'],
  ];
  const railLabels = [];
  for (const [id, key, glyph] of railMap) {
    const el = $(id); if (!el) continue;
    el.className = 'rail-button'; el.removeAttribute('role'); el.removeAttribute('aria-selected');
    el.removeAttribute('data-i18n-title'); el.removeAttribute('aria-expanded');
    let span = el.querySelector('span:not(.mcp-badge)'); if (!span) { span = make('span'); el.append(span); }
    if (id !== 'batch-toggle') span.removeAttribute('data-i18n'); span.dataset.shellLabel = key;
    if (glyph) { el.querySelector('svg')?.remove(); el.prepend(icon(glyph)); }
    mainRail.append(el); railLabels.push({ el, span, key });
  }
  for (const [id, key, glyph] of [['downloads-toggle', 'download', 'download'], ['settings-toggle', 'setting', 'settings']]) {
    const el = button(id, 'rail-button', glyph), span = make('span');
    el.append(span); lowerRail.append(el); railLabels.push({ el, span, key });
  }
  document.querySelector('.studio-tabs')?.remove();
  const modeBar = document.querySelector('.sop-topbar');
  if (modeBar) $('product-discovery').prepend(modeBar);

  const head = make('div', 'workbench-heading'), titleBlock = make('div');
  const title = make('h1'); title.id = 'workbench-title';
  const subtitle = make('p'); subtitle.id = 'workbench-subtitle';
  titleBlock.append(title, subtitle); head.append(titleBlock);
  const close = button('workbench-close', 'icon-square', 'close'); head.append(close); aside.prepend(head);
  const resizer = make('div', 'workbench-resizer'); resizer.id = 'workbench-resizer';
  resizer.setAttribute('role', 'separator'); resizer.setAttribute('aria-orientation', 'vertical');
  resizer.tabIndex = 0; aside.prepend(resizer);

  const agentStrip = document.querySelector('.agent-strip'); toolbar.append(agentStrip);
  toolbar.append($('sidebar-toggle'));
  const find = button('quick-find', 'icon-square', 'search'); document.querySelector('header').insertBefore(find, $('new'));
  const topUtils = document.querySelector('.top-utils');

  const body = document.querySelector('.studio-body');
  function pane(id) { const el = make('section', 'studio-pane'); el.id = id; el.hidden = true; body.append(el); return el; }
  const settings = pane('settings-pane');
  const appearance = make('section', 'card settings-card');
  const appearanceTitle = make('h2'); appearanceTitle.dataset.shellText = 'appearance'; appearance.append(appearanceTitle);
  for (const [id, key] of [['theme-toggle', 'theme'], ['lang-toggle', 'language']]) {
    const row = make('div', 'settings-row'), text = make('span'); text.dataset.shellText = key;
    row.append(text, $(id)); appearance.append(row);
  }
  const siteEmpty = make('p', 'muted'); siteEmpty.id = 'site-empty'; siteEmpty.dataset.shellText = 'siteEmpty';
  const help = make('section', 'card'), helpTitle = make('h2'), helpText = make('p', 'shortcut-help');
  helpTitle.dataset.shellText = 'help'; helpText.dataset.shellText = 'shortcuts'; help.append(helpTitle, helpText);
  settings.append(appearance, $('site-controls-card'), siteEmpty, help); topUtils?.remove();
  // All existing permission switches stay bound to the same IPC; opening Settings grants nothing.
  $('site-permissions').open = true;

  const downloads = pane('downloads-pane'), downloadList = make('div', 'download-list'); downloadList.id = 'download-list';
  downloads.append(downloadList);
  const searchPane = pane('search-pane'), search = make('input', 'shell-search');
  search.id = 'command-search'; search.type = 'search'; search.autocomplete = 'off';
  const searchResults = make('div', 'command-results'); searchResults.id = 'command-results';
  searchPane.append(search, searchResults);
  const tabSearch = make('input', 'shell-search'); tabSearch.id = 'tab-search'; tabSearch.type = 'search';
  $('tab-tasks').before(tabSearch);
  const intro = make('section', 'workspace-intro'), introHeading = make('h2'), introText = make('p');
  introHeading.dataset.shellText = 'quickTitle'; introText.dataset.shellText = 'quickHint';
  const quickActions = make('div', 'workspace-actions');
  for (const [id, key] of [['quick-discover', 'quickDiscover'], ['quick-batch', 'quickBatch']]) {
    const b = button(id, 'workspace-action'); const label = make('span'); label.dataset.shellText = key;
    b.append(label, icon('arrow')); quickActions.append(b);
  }
  intro.append(introHeading, introText, quickActions); $('workspace-pane').prepend(intro);
  // Single-product collection belongs next to the batch queue, not among browser settings.
  if ($('sellerstar')) $('sellerstar-batch')?.prepend($('sellerstar'));
  const footerLink = $('mcp-open-from-card'); if (footerLink) footerLink.hidden = true;
  const footerHint = make('button', 'footer-link', 'Ctrl K'); footerHint.type = 'button'; footerHint.id = 'footer-find';
  document.querySelector('.studio-footer').append(footerHint);
  const tabs = $('tabs'); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', '网页标签');

  const menuEntries = () => [
    { name: tr('workspace')[0], keys: 'tabs 浏览 标签 工作台', mode: 'workspace', icon: 'browse' },
    ...(state?.enabled_panels?.includes('product-discovery') ? [{ name: tr('discovery')[0], keys: '商品 产品 精品 铺货 选品 sellerlens 1688 safesellai', mode: 'discovery', icon: 'search' }] : []),
    ...(state?.enabled_panels?.includes('sellerstar-batch') ? [{ name: tr('batch')[0], keys: 'batch collection 采集 塞星 变体 查重', mode: 'batch', icon: 'browse' }] : []),
    { name: tr('connect'), keys: 'mcp agent 连接 工具 hub', action: () => $('mcp-toggle').click(), icon: 'link' },
    { name: tr('downloads')[0], keys: 'download 文件 下载', mode: 'downloads', icon: 'download' },
    { name: tr('settings')[0], keys: 'settings theme language permissions 主题 语言 权限 复制', mode: 'settings', icon: 'settings' },
  ];
  function renderSearch() {
    const q = search.value.toLocaleLowerCase().trim();
    const key = JSON.stringify([q, locale, state?.enabled_panels, state?.tabs.map(t => [t.id, t.title, t.url])]);
    if (key === searchKey) return;
    searchKey = key; searchResults.replaceChildren();
    const matching = menuEntries().filter(e => `${e.name} ${e.keys}`.toLocaleLowerCase().includes(q));
    for (const entry of matching) {
      const row = button('', 'command-row', entry.icon); row.append(make('span', '', entry.name));
      row.onclick = () => entry.action ? entry.action() : switchPane(entry.mode); searchResults.append(row);
    }
    for (const tab of (state?.tabs || []).filter(t => `${t.title} ${t.url}`.toLocaleLowerCase().includes(q))) {
      const row = button('', 'command-row', 'browse'), copy = make('span', 'command-copy');
      copy.append(make('strong', '', tab.title), make('small', '', tab.url)); row.append(copy);
      row.onclick = () => { command('switch', { tab_id: tab.id }); switchPane('workspace'); }; searchResults.append(row);
    }
    if (!searchResults.children.length) searchResults.append(make('p', 'empty-note', tr('empty')));
  }
  function renderDownloads() {
    const rows = state?.downloads || [];
    const key = JSON.stringify([rows, locale]); if (key === downloadsKey) return;
    downloadsKey = key; downloadList.replaceChildren();
    if (!rows.length) {
      const empty = make('div', 'download-empty'); empty.append(icon('download'), make('h2', '', tr('noDownloads')), make('p', '', tr('downloadHint')));
      downloadList.append(empty); return;
    }
    for (const file of [...rows].reverse()) {
      const row = make('section', 'download-row'), title = make('strong', '', file.filename);
      title.title = file.filename;
      row.append(title, make('small', '', tr('status')[file.state] || file.state));
      const reveal = button('', 'download-action', 'folder'); reveal.title = tr('reveal'); reveal.setAttribute('aria-label', tr('reveal'));
      reveal.disabled = file.state !== 'completed'; reveal.onclick = () => command('download-reveal', { id: file.id });
      row.append(reveal); downloadList.append(row);
    }
  }
  function applyLocale() {
    for (const { el, span, key } of railLabels) { span.textContent = tr(key); el.title = tr(key); el.setAttribute('aria-label', tr(key)); }
    document.querySelectorAll('[data-shell-text]').forEach(el => { el.textContent = tr(el.dataset.shellText); });
    search.placeholder = tr('searchHint'); search.setAttribute('aria-label', tr('searchHint'));
    tabSearch.placeholder = tr('tabHint'); tabSearch.setAttribute('aria-label', tr('tabHint'));
    find.title = tr('search')[0] + ' (Ctrl+K)'; find.setAttribute('aria-label', find.title);
    close.title = tr('close'); close.setAttribute('aria-label', tr('close'));
    $('sop-mode-boutique').textContent = locale === 'en' ? 'Boutique research' : '精品研究';
    $('sop-mode-distribution').textContent = locale === 'en' ? 'Distribution' : '铺货选品';
    resizer.setAttribute('aria-label', tr('resize')); $('tab-tasks').previousElementSibling.previousElementSibling.querySelector('h2').textContent = tr('pages');
    onPaneChange(active);
  }
  function onPaneChange(mode) {
    active = mode; title.textContent = tr(mode)?.[0] || tr('workspace')[0]; subtitle.textContent = tr(mode)?.[1] || '';
    for (const { el } of railLabels) {
      const selected = ({'workspace-toggle':'workspace', 'discovery-toggle':'discovery', 'batch-toggle':'batch', 'settings-toggle':'settings', 'downloads-toggle':'downloads'})[el.id] === mode && state?.sidebar_open !== false;
      el.classList.toggle('active', selected); if (selected) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current');
    }
    if (mode === 'search') renderSearch();
    if (mode === 'downloads') renderDownloads();
  }
  function applyLayout(layout) {
    if (!layout) return;
    if (state) state.chrome_layout = layout;
    const style = document.documentElement.style;
    style.setProperty('--rail-width', layout.rail + 'px'); style.setProperty('--chrome-height', layout.top + 'px');
    style.setProperty('--panel-width', layout.panel + 'px');
    resizer.setAttribute('aria-valuenow', String(layout.panel)); resizer.setAttribute('aria-valuemin', '300'); resizer.setAttribute('aria-valuemax', '600');
  }
  window.workspaceShell = {
    onPaneChange,
    update(next) {
      state = next; locale = next.locale === 'en' ? 'en' : 'zh-CN'; applyLayout(next.chrome_layout); applyLocale();
      $('quick-discover').hidden = !next.enabled_panels?.includes('product-discovery');
      $('quick-batch').hidden = !next.enabled_panels?.includes('sellerstar-batch');
      const activeTab = next.tabs.find(t => t.id === next.active);
      $('site-empty').hidden = Boolean(activeTab?.site_permission_origin);
      $('ownership').title = $('ownership').textContent;
      if (active === 'search' && document.activeElement === search) renderSearch();
      if (active === 'downloads') renderDownloads();
    },
    bind(runCommand, changePane) {
      command = runCommand; switchPane = changePane;
      const openSearch = () => { switchPane('search'); search.focus(); search.select(); };
      find.onclick = openSearch; footerHint.onclick = openSearch;
      $('settings-toggle').onclick = () => switchPane('settings');
      $('downloads-toggle').onclick = () => switchPane('downloads');
      $('quick-discover').onclick = () => $('discovery-toggle').click();
      $('quick-batch').onclick = () => $('batch-toggle').click();
      close.onclick = () => command('toggle-sidebar', { open: false });
      search.oninput = renderSearch;
      tabSearch.oninput = () => window.filterBrowserTabs?.(tabSearch.value);
      searchPane.onkeydown = e => {
        const rows = [...searchResults.querySelectorAll('button')];
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault(); const i = rows.indexOf(document.activeElement), step = e.key === 'ArrowDown' ? 1 : -1;
          rows[(i + step + rows.length) % rows.length]?.focus();
        } else if (e.key === 'Enter' && document.activeElement === search) { e.preventDefault(); rows[0]?.click(); }
        else if (e.key === 'Escape') switchPane('workspace');
      };
      let resizeStart = null;
      resizer.onpointerdown = e => { if (e.button !== 0) return; e.preventDefault(); resizeStart = { x: e.clientX, width: state.chrome_layout.panel }; resizer.setPointerCapture(e.pointerId); document.body.classList.add('resizing'); };
      resizer.onpointermove = e => { if (resizeStart) command('set-panel-width', { width: resizeStart.width + resizeStart.x - e.clientX }); };
      const endResize = () => { resizeStart = null; document.body.classList.remove('resizing'); };
      resizer.onpointerup = endResize; resizer.onlostpointercapture = endResize;
      resizer.onkeydown = e => { if (!['ArrowLeft', 'ArrowRight', 'Home'].includes(e.key)) return; e.preventDefault(); command('set-panel-width', { width: e.key === 'Home' ? 0 : state.chrome_layout.panel + (e.key === 'ArrowLeft' ? 20 : -20) }); };
      window.browserUI.subscribeLayout?.(applyLayout);
      window.browserUI.subscribeShortcut?.(name => {
        if (name === 'address') { $('address').focus(); $('address').select(); }
        if (name === 'search') openSearch();
        if (name === 'new') $('new').click();
        if (name === 'close-tab' && state?.active) command('close', { tab_id: state.active });
        if (name === 'sidebar') $('sidebar-toggle').click();
        if (name === 'next-tab' || name === 'previous-tab') {
          const items = state?.tabs || [], at = items.findIndex(t => t.id === state.active);
          const target = items[(at + (name === 'next-tab' ? 1 : -1) + items.length) % items.length];
          if (target) command('switch', { tab_id: target.id });
        }
      });
    },
  };
})();
