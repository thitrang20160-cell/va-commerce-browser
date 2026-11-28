(function () {
  const $ = id => document.getElementById(id);

  const I18N = {
    'zh-CN': {
      title: 'MCP 连接器',
      subtitle: '将浏览器一键接入本地 AI 客户端，共享真实登录态与后台标签页',
      refreshTitle: '刷新状态',
      closeLabel: '关闭',
      tabAll: '全部客户端',
      tabConnected: '已配置',
      tabHub: '🔗 产品 MCP 中介',
      tabDeps: '📦 运行环境',
      tabManual: '手动配置',
      searchPlaceholder: '搜索客户端…',
      toolsUnit: '个工具',
      statusActive: '运行中',
      statusConfigured: '已配置',
      statusIdle: '未配置',
      connect: '连接',
      reconnect: '更新',
      remove: '断开',
      copyCmd: '复制命令',
      viewCmd: '查看命令',
      emptyConnected: '还没有已配置的客户端。切换到「全部客户端」一键连接。',
      emptySearch: '没有匹配的客户端。',
      manualCodexTitle: 'Codex CLI 注册命令',
      manualCodexDesc: '在终端运行下方命令即可注册到 ~/.codex/config.toml，支持跨标签页读写。',
      manualJsonTitle: '通用 MCP stdio 配置 (JSON)',
      manualJsonDesc: '适用于任何支持标准 MCP stdio 的客户端，直接粘贴到 mcpServers 字段中。',
      manualHttpTitle: '本地 Streamable HTTP 端点',
      manualHttpDesc: '仅监听 127.0.0.1 本机回环，需配合配置目录中 runtime.json 的本地 Bearer 令牌。',
      copyJson: '复制 JSON',
      copyHttp: '复制地址',
      openDemo: '打开连接测试页',
      done: '完成',
      defaultFooter: '写入前自动备份原配置文件 · 本地回环 127.0.0.1 认证',
      installing: label => '正在写入 ' + label + ' 配置…',
      installed: (label, file) => '✓ 已连接 ' + label + '（重启客户端生效）：' + file,
      removing: label => '正在断开 ' + label + '…',
      removed: (label, file) => '✓ 已从 ' + label + ' 移除配置（已保留备份）：' + file,
      copiedCodex: '✓ 已复制 Codex CLI 注册命令，直接粘贴到终端运行即可。',
      copiedJson: '✓ 已复制通用 MCP JSON 配置。',
      copiedHttp: '✓ 已复制本地 /mcp 端点地址。',
      demoOpened: '✓ 已在浏览器中打开本地连接测试页。',
      desc: {
        'claude-code': '写入全局 ~/.claude.json，让 Claude Code 直接共享本浏览器的真实登录与后台标签页。',
        codex: '通过官方 codex mcp add 注册到 Codex CLI，后台检索与选品不抢当前窗口焦点。',
        cursor: '写入 ~/.cursor/mcp.json，在 Cursor Agent 中调用紧凑快照与本机视频阅读。',
        windsurf: '写入 Windsurf MCP 配置，支持多 Agent 180 秒分标签页租约并发工作。',
        'claude-desktop': '写入 Claude Desktop 配置文件，桌面对话直接读取网页、表单与回执。',
        cline: '写入 VS Code Cline MCP 设置，为代码代理提供可控的可见桌面浏览器。',
      },
    },
    en: {
      title: 'MCP Connectors',
      subtitle: 'Connect local AI clients in one click to share real logins and background tabs',
      refreshTitle: 'Refresh status',
      closeLabel: 'Close',
      tabAll: 'All Clients',
      tabConnected: 'Connected',
      tabHub: '🔗 Product MCP Hub',
      tabDeps: '📦 Runtimes',
      tabManual: 'Manual / JSON',
      searchPlaceholder: 'Search connectors…',
      toolsUnit: 'tools',
      statusActive: 'Active',
      statusConfigured: 'Connected',
      statusIdle: 'Not connected',
      connect: 'Connect',
      reconnect: 'Update',
      remove: 'Disconnect',
      copyCmd: 'Copy Command',
      viewCmd: 'View',
      emptyConnected: 'No connected clients yet. Switch to "All Clients" to connect in one click.',
      emptySearch: 'No matching connectors.',
      manualCodexTitle: 'Codex CLI Registration Command',
      manualCodexDesc: 'Run this command in your terminal to register VA Commerce Browser into ~/.codex/config.toml.',
      manualJsonTitle: 'Generic MCP stdio Config (JSON)',
      manualJsonDesc: 'Works with any standard MCP stdio client. Paste into your mcpServers object.',
      manualHttpTitle: 'Local Streamable HTTP Endpoint',
      manualHttpDesc: 'Bound strictly to 127.0.0.1 loopback and protected by the local Bearer token in runtime.json.',
      copyJson: 'Copy JSON',
      copyHttp: 'Copy URL',
      openDemo: 'Open Local Demo',
      done: 'Done',
      defaultFooter: 'Auto-backs up existing config before editing · 127.0.0.1 local loopback only',
      installing: label => 'Connecting ' + label + '…',
      installed: (label, file) => '✓ Connected ' + label + ' (restart client to apply): ' + file,
      removing: label => 'Disconnecting ' + label + '…',
      removed: (label, file) => '✓ Disconnected ' + label + ' (backup saved): ' + file,
      copiedCodex: '✓ Copied Codex CLI command — paste it into your terminal.',
      copiedJson: '✓ Copied generic MCP JSON config.',
      copiedHttp: '✓ Copied local /mcp URL.',
      demoOpened: '✓ Opened the local MCP test page in the browser.',
      desc: {
        'claude-code': 'Writes to ~/.claude.json so Claude Code shares your real logins and background tabs.',
        codex: 'Registers via codex mcp add into ~/.codex/config.toml for zero-focus-steal background tasks.',
        cursor: 'Writes to ~/.cursor/mcp.json to give Cursor Agent compact -93.5% token snapshots.',
        windsurf: 'Writes to Windsurf MCP config with 180s per-tab multi-agent leases.',
        'claude-desktop': 'Writes to Claude Desktop config for direct visible browser control and receipts.',
        cline: 'Writes to VS Code Cline MCP settings with idempotent writes and human takeover.',
      },
    },
  };

  const ICONS = {
    'claude-code': '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>',
    codex: '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="m8 10 3 2-3 2"/><path d="M13 14h3"/></svg>',
    cursor: '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="m4 4 7.07 17 2.51-7.39L21 11.07z"/></svg>',
    windsurf: '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12c2.5-3 5-3 7.5 0s5 3 7.5 0 3.5-2.5 5 0"/><path d="M2 17c2.5-3 5-3 7.5 0s5 3 7.5 0 3.5-2.5 5 0"/><path d="M2 7c2.5-3 5-3 7.5 0s5 3 7.5 0 3.5-2.5 5 0"/></svg>',
    'claude-desktop': '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>',
    cline: '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>',
  };

  let locale = 'zh-CN';
  let info = null;
  let hubInfo = null;
  let depsInfo = null;
  let confirmingDepId = null;
  const depLiveProgress = {};
  const initTabParam = new URLSearchParams(location.search).get('tab');
  let activeTab = initTabParam === 'hub' ? 'hub' : initTabParam === 'deps' ? 'deps' : 'all';
  let query = '';
  let busy = false;
  let customFooter = false;

  if (window.browserUI && typeof window.browserUI.subscribeDepProgress === 'function') {
    window.browserUI.subscribeDepProgress(prog => {
      if (!prog?.id) return;
      depLiveProgress[prog.id] = prog;
      if (activeTab === 'deps') renderDeps();
      if (prog.status === 'installed' || prog.status === 'error' || prog.status === 'cancelled') {
        void refresh();
      }
    });
  }

  const t = (key, ...args) => {
    const dict = I18N[locale] || I18N.en;
    const val = dict[key] ?? I18N.en[key] ?? key;
    return typeof val === 'function' ? val(...args) : val;
  };

  function setFooter(text, kind = '') {
    const el = $('footer-status');
    el.textContent = text;
    el.className = 'footer-status' + (kind ? ' is-' + kind : '');
    customFooter = Boolean(kind);
  }

  function applyStaticText() {
    document.documentElement.lang = locale;
    document.title = t('title');
    $('modal-title').textContent = t('title');
    $('modal-subtitle').textContent = t('subtitle');
    $('btn-refresh').title = t('refreshTitle');
    $('btn-close').setAttribute('aria-label', t('closeLabel'));
    $('tab-all').childNodes[0].nodeValue = t('tabAll') + ' ';
    $('tab-connected').childNodes[0].nodeValue = t('tabConnected') + ' ';
    if ($('tab-hub')) $('tab-hub').childNodes[0].nodeValue = t('tabHub') + ' ';
    if ($('tab-deps')) $('tab-deps').childNodes[0].nodeValue = t('tabDeps') + ' ';
    $('tab-manual').textContent = t('tabManual');
    $('search-input').placeholder = t('searchPlaceholder');
    $('manual-codex-title').textContent = t('manualCodexTitle');
    $('manual-codex-desc').textContent = t('manualCodexDesc');
    $('manual-json-title').textContent = t('manualJsonTitle');
    $('manual-json-desc').textContent = t('manualJsonDesc');
    $('manual-http-title').textContent = t('manualHttpTitle');
    $('manual-http-desc').textContent = t('manualHttpDesc');
    $('btn-copy-codex').textContent = t('copyCmd');
    $('btn-copy-json').textContent = t('copyJson');
    $('btn-copy-http').textContent = t('copyHttp');
    $('btn-open-demo').textContent = t('openDemo');
    $('btn-done').textContent = t('done');
    if (!customFooter) setFooter(t('defaultFooter'));
  }

  async function cmd(name, payload = {}) {
    return window.browserUI.command(name, payload);
  }

  function buildCard(client) {
    const card = document.createElement('article');
    const isConnected = Boolean(client.configured || client.active);
    card.className = 'connector-card' + (isConnected ? ' is-configured' : '');

    const top = document.createElement('div');
    top.className = 'card-top';

    const identity = document.createElement('div');
    identity.className = 'card-identity';
    const icon = document.createElement('div');
    icon.className = 'app-icon icon-' + client.id;
    icon.innerHTML = ICONS[client.id] || 'M';
    const titleWrap = document.createElement('div');
    titleWrap.className = 'card-title-wrap';
    const nameEl = document.createElement('h3');
    nameEl.className = 'card-name';
    nameEl.textContent = client.label;
    const kindEl = document.createElement('div');
    kindEl.className = 'card-kind';
    kindEl.textContent = client.format === 'json' ? 'MCP stdio · JSON' : 'MCP stdio · CLI TOML';
    titleWrap.append(nameEl, kindEl);
    identity.append(icon, titleWrap);

    const badge = document.createElement('span');
    if (client.active) {
      badge.className = 'status-badge status-active';
      badge.textContent = t('statusActive');
    } else if (client.configured) {
      badge.className = 'status-badge status-configured';
      badge.textContent = '✓ ' + t('statusConfigured');
    } else {
      badge.className = 'status-badge status-idle';
      badge.textContent = t('statusIdle');
    }
    top.append(identity, badge);

    const desc = document.createElement('p');
    desc.className = 'card-desc';
    const descDict = (I18N[locale] || I18N.en).desc;
    desc.textContent = descDict[client.id] || '';

    const bottom = document.createElement('div');
    bottom.className = 'card-bottom';
    const pathEl = document.createElement('span');
    pathEl.className = 'card-path';
    pathEl.textContent = client.short_file || client.file || '';
    pathEl.title = client.file || '';

    const btns = document.createElement('div');
    btns.className = 'card-btns';

    if (client.format === 'json') {
      if (client.configured) {
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'btn-danger-ghost';
        removeBtn.disabled = busy;
        removeBtn.textContent = t('remove');
        removeBtn.onclick = () => onUninstall(client);

        const updateBtn = document.createElement('button');
        updateBtn.type = 'button';
        updateBtn.className = 'btn-outline-sm';
        updateBtn.disabled = busy;
        updateBtn.textContent = t('reconnect');
        updateBtn.onclick = () => onInstall(client);

        btns.append(removeBtn, updateBtn);
      } else {
        const installBtn = document.createElement('button');
        installBtn.type = 'button';
        installBtn.className = 'btn-primary-sm';
        installBtn.disabled = busy;
        installBtn.textContent = t('connect');
        installBtn.onclick = () => onInstall(client);
        btns.append(installBtn);
      }
    } else {
      const viewBtn = document.createElement('button');
      viewBtn.type = 'button';
      viewBtn.className = 'btn-outline-sm';
      viewBtn.textContent = t('viewCmd');
      viewBtn.onclick = () => switchTab('manual');

      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'btn-primary-sm';
      copyBtn.textContent = t('copyCmd');
      copyBtn.onclick = () => onCopy(info?.codex_command, 'copiedCodex');
      btns.append(viewBtn, copyBtn);
    }

    bottom.append(pathEl, btns);
    card.append(top, desc, bottom);
    return card;
  }

  function render() {
    if (!info) return;
    document.documentElement.dataset.theme = info.theme === 'light' ? 'light' : 'dark';
    if (info.locale && I18N[info.locale] && info.locale !== locale) {
      locale = info.locale;
      applyStaticText();
    }
    const hostPort = info.endpoint ? info.endpoint.replace(/^https?:\/\//, '') : '127.0.0.1';
    const toolsText = typeof info.tool_count === 'number' ? ' · ' + info.tool_count + ' ' + t('toolsUnit') : '';
    $('live-pill').textContent = hostPort + toolsText;

    const clients = info.clients || [];
    const connectedCount = clients.filter(c => c.configured || c.active).length;
    $('count-all').textContent = String(clients.length);
    $('count-connected').textContent = String(connectedCount);

    $('code-codex').textContent = info.codex_command || '';
    $('code-json').textContent = info.generic_json || '';
    $('code-http').textContent = info.mcp_http_url || info.endpoint || 'http://127.0.0.1:18773/mcp';
    $('server-name-badge').textContent = info.server_name || 'va_commerce_browser';

    const isManual = activeTab === 'manual';
    const isHub = activeTab === 'hub';
    const isDeps = activeTab === 'deps';
    $('search-wrap').hidden = isManual || isHub || isDeps;
    $('view-manual').hidden = !isManual;
    $('view-hub').hidden = !isHub;
    if ($('view-deps')) $('view-deps').hidden = !isDeps;
    $('view-grid').hidden = isManual || isHub || isDeps;
    $('view-empty').hidden = true;

    if (hubInfo) {
      const readyCount = (hubInfo.services || []).filter(s => s.ready).length;
      if ($('count-hub')) $('count-hub').textContent = String(readyCount);
    }
    if (depsInfo && $('count-deps')) {
      const items = depsInfo.items || [];
      const okCount = items.filter(d => d.installed).length;
      $('count-deps').textContent = `${okCount}/${items.length}`;
    }

    if (isHub) {
      renderHub();
    } else if (isDeps) {
      renderDeps();
    } else if (!isManual) {
      const q = query.trim().toLowerCase();
      const filtered = clients.filter(c => {
        if (activeTab === 'connected' && !c.configured && !c.active) return false;
        if (!q) return true;
        return c.label.toLowerCase().includes(q) || c.id.includes(q) || (c.short_file || '').toLowerCase().includes(q);
      });
      if (!filtered.length) {
        $('view-grid').hidden = true;
        $('view-empty').hidden = false;
        $('view-empty').textContent = q ? t('emptySearch') : t('emptyConnected');
      } else {
        $('view-grid').replaceChildren(...filtered.map(buildCard));
      }
    }
  }

  function renderHub() {
    const list = $('hub-services-list');
    if (!list) return;
    const isEn = locale === 'en';
    const portalOk = Boolean(hubInfo?.portal_connected);
    const tenant = hubInfo?.portal_tenant || '';
    $('hub-portal-title').textContent = portalOk
      ? (isEn ? `Portal Session Connected (${tenant || 'active'})` : `✓ 已复用塞星登录会话（${tenant || '在线'}）`)
      : (isEn ? 'VA Browser · Outbound Product MCP Hub' : 'VA 浏览器 · 外部产品 MCP 中介中心');
    $('hub-portal-desc').textContent = portalOk
      ? (isEn ? 'SafeSellAI IP, SellerLens & 1688 sourcing are ready automatically via Portal session, or override any service with a standalone MCP URL below.'
        : 'SafeSellAI 侵权全查、SellerLens 精品分析与 1688 寻源已默认就绪；你也可以在下方单独配置独立产品 MCP 端点覆盖。')
      : (isEn ? 'Connect standalone Streamable HTTP MCP endpoints (SafeSellAI / SellerLens / 1688) so SOP steps invoke them directly.'
        : '未检测到塞星登录态。你可以直接登录塞星，或在下方填写独立产品 MCP 地址与 Bearer Key，由浏览器做中介统一编排。');
    if ($('btn-hub-open-portal')) {
      $('btn-hub-open-portal').hidden = portalOk || info?.mode === 'oss';
      $('btn-hub-open-portal').onclick = async () => {
        await cmd('sop-open-sellerstar');
        await cmd('mcp-connector-close');
      };
    }

    const services = hubInfo?.services || [];
    list.replaceChildren(...services.map(svc => {
      const card = document.createElement('article');
      card.className = 'hub-card' + (svc.ready ? ' is-ready' : '');

      const head = document.createElement('div');
      head.className = 'hub-card-head';
      const left = document.createElement('div');
      const h3 = document.createElement('h3');
      h3.className = 'hub-card-title';
      h3.textContent = isEn ? svc.name_en : svc.name;
      const p = document.createElement('p');
      p.className = 'hub-card-desc';
      p.textContent = isEn ? svc.description_en : svc.description;
      left.append(h3, p);

      const badge = document.createElement('span');
      const stateCls = svc.mode_label === 'mcp' ? 'status-active' : (svc.mode_label === 'portal' || svc.mode_label === 'builtin') ? 'status-configured' : 'status-idle';
      badge.className = 'status-badge ' + stateCls;
      badge.textContent = svc.mode_label === 'mcp'
        ? (isEn ? 'MCP Active' : '独立 MCP 已启用')
        : svc.mode_label === 'portal'
          ? (isEn ? 'Portal Ready' : '塞星通道就绪')
          : svc.mode_label === 'builtin'
            ? (isEn ? 'Built-in Ready' : '内置引擎就绪')
            : (isEn ? 'Not Configured' : '未配置');
      head.append(left, badge);

      const formRow = document.createElement('div');
      formRow.className = 'hub-form-row';
      const urlInput = document.createElement('input');
      urlInput.type = 'text';
      urlInput.className = 'hub-input';
      urlInput.value = svc.url || '';
      urlInput.placeholder = svc.default_url || 'https://.../mcp';

      const tokInput = document.createElement('input');
      tokInput.type = 'password';
      tokInput.className = 'hub-input';
      tokInput.placeholder = svc.has_token
        ? (isEn ? `Saved (${svc.token_hint}) — enter to replace` : `已保存 (${svc.token_hint}) · 留空保持不变`)
        : (isEn ? 'Bearer API Key (optional)' : 'Bearer API Key / sk_live_...（可选）');
      formRow.append(urlInput, tokInput);

      const foot = document.createElement('div');
      foot.className = 'hub-card-foot';
      const toggleLbl = document.createElement('label');
      toggleLbl.className = 'hub-toggle';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = Boolean(svc.enabled);
      toggleLbl.append(cb, document.createTextNode(isEn ? 'Prefer standalone MCP' : '优先走独立 MCP'));

      const toolsNote = document.createElement('span');
      toolsNote.className = 'hub-tools-note';
      toolsNote.textContent = svc.tools?.length ? `${svc.tools.length} tools` : '';

      const btns = document.createElement('div');
      btns.className = 'card-btns';
      const testBtn = document.createElement('button');
      testBtn.type = 'button';
      testBtn.className = 'btn-outline-sm';
      testBtn.textContent = isEn ? 'Test MCP' : '测试连接';
      testBtn.onclick = async () => {
        testBtn.disabled = true;
        setFooter((isEn ? 'Testing ' : '正在测试连接 ') + (isEn ? svc.name_en : svc.name) + '…');
        try {
          const res = await cmd('hub-test', { id: svc.id, url: urlInput.value.trim(), token: tokInput.value.trim() });
          if (res?.hub) hubInfo = res.hub;
          setFooter(`✓ ${isEn ? svc.name_en : svc.name} 连接成功：发现 ${res.count} 个工具 (${res.latency_ms}ms)`, 'ok');
          render();
        } catch (err) {
          setFooter(err?.message || String(err), 'err');
        } finally {
          testBtn.disabled = false;
        }
      };

      const saveBtn = document.createElement('button');
      saveBtn.type = 'button';
      saveBtn.className = 'btn-primary-sm';
      saveBtn.textContent = isEn ? 'Save' : '保存';
      saveBtn.onclick = async () => {
        try {
          hubInfo = await cmd('hub-save', {
            id: svc.id,
            url: urlInput.value.trim(),
            token: tokInput.value.trim(),
            enabled: cb.checked,
          });
          setFooter(`✓ 已保存 ${isEn ? svc.name_en : svc.name} 配置。`, 'ok');
          render();
        } catch (err) {
          setFooter(err?.message || String(err), 'err');
        }
      };

      btns.append(testBtn, saveBtn);
      foot.append(toggleLbl, toolsNote, btns);
      card.append(head, formRow, foot);
      return card;
    }));
  }

  function renderDeps() {
    const list = $('deps-list');
    if (!list) return;
    const isEn = locale === 'en';
    if ($('deps-banner-title')) {
      $('deps-banner-title').textContent = isEn
        ? 'On-Demand Local Runtimes (Consent-First · Isolated Sandbox)'
        : '按需自装运行环境（客户授权制 · 隔离沙箱）';
    }
    if ($('deps-banner-desc')) {
      $('deps-banner-desc').textContent = isEn
        ? 'Missing optional runtimes can be installed in one click into VA Browser\'s isolated directory after your explicit consent — never polluting system Python.'
        : '缺什么依赖可在此一键自装，均安装至浏览器隔离目录（不污染系统环境）；每次安装前均需你的明确授权，安装后自动可用并支持随时清理。';
    }
    if ($('btn-deps-open-dir')) {
      $('btn-deps-open-dir').textContent = isEn ? '📂 Open Runtimes Folder' : '📂 打开隔离目录';
      $('btn-deps-open-dir').onclick = () => cmd('dep-open-dir');
    }

    const items = depsInfo?.items || [];
    list.replaceChildren(...items.map(dep => {
      const prog = depLiveProgress[dep.id] || dep.progress;
      const isInstalling = Boolean(dep.installing || prog?.status === 'installing' || prog?.status === 'verifying');
      const card = document.createElement('article');
      card.className = 'hub-card' + (dep.installed ? ' is-ready' : '');

      const head = document.createElement('div');
      head.className = 'hub-card-head';
      const left = document.createElement('div');
      const h3 = document.createElement('h3');
      h3.className = 'hub-card-title';
      h3.textContent = isEn ? dep.name_en : dep.name;
      const p = document.createElement('p');
      p.className = 'hub-card-desc';
      p.textContent = isEn ? dep.purpose_en : dep.purpose;
      left.append(h3, p);

      const badge = document.createElement('span');
      if (isInstalling) {
        badge.className = 'status-badge is-active';
        badge.textContent = (isEn ? 'Installing ' : '安装中 ') + `${prog?.pct || 0}%`;
      } else if (dep.installed) {
        badge.className = 'status-badge is-active';
        const srcText = dep.source === 'isolated_venv' ? (isEn ? 'Isolated' : '隔离环境')
          : dep.source === 'local_model' ? (isEn ? 'Local Model' : '本地模型')
          : (isEn ? 'System' : '系统已装');
        badge.textContent = `✓ ${srcText}${dep.version ? ' · ' + dep.version : ''}`;
      } else {
        badge.className = 'status-badge is-idle';
        badge.textContent = isEn ? `Missing · ${dep.size_hint}` : `未安装 · 约 ${dep.size_hint}`;
      }
      head.append(left, badge);

      const meta = document.createElement('div');
      meta.className = 'dep-meta-row';
      for (const tag of (isEn ? dep.used_by_en : dep.used_by) || []) {
        const pill = document.createElement('span');
        pill.className = 'dep-tag';
        pill.textContent = tag;
        meta.appendChild(pill);
      }
      const pathSpan = document.createElement('span');
      pathSpan.className = 'hub-tools-note';
      pathSpan.textContent = (isEn ? 'Path: ' : '路径: ') + (dep.binary_path || dep.install_path || '');
      meta.appendChild(pathSpan);

      card.append(head, meta);

      if (isInstalling || (prog && prog.status === 'error')) {
        const pWrap = document.createElement('div');
        pWrap.className = 'dep-modal-progress';
        const track = document.createElement('div');
        track.className = 'dep-modal-track';
        const bar = document.createElement('div');
        bar.className = 'dep-modal-bar' + (prog?.status === 'error' ? ' is-err' : '');
        bar.style.width = `${prog?.status === 'error' ? 100 : Math.max(5, prog?.pct || 5)}%`;
        track.appendChild(bar);
        const msg = document.createElement('div');
        msg.className = 'dep-modal-msg';
        msg.textContent = (prog?.stage || '') + (prog?.log ? ` — ${prog.log}` : '');
        pWrap.append(track, msg);
        card.appendChild(pWrap);
      }

      // Explicit inline consent strip before any installation begins
      if (confirmingDepId === dep.id && !isInstalling && !dep.installed) {
        const strip = document.createElement('div');
        strip.className = 'dep-confirm-strip';
        const txt = document.createElement('div');
        txt.className = 'dep-confirm-text';
        txt.textContent = isEn
          ? `Confirm download & isolated install (${dep.size_hint}) to ${dep.install_path}?`
          : `确认授权下载并安装（约 ${dep.size_hint}）到 ${dep.install_path}？安装后可立即调用且随时可卸载。`;
        const cBtns = document.createElement('div');
        cBtns.className = 'card-actions';
        const yesBtn = document.createElement('button');
        yesBtn.type = 'button';
        yesBtn.className = 'btn-primary-sm';
        yesBtn.textContent = isEn ? '✓ Approve & Install' : '✓ 同意并开始安装';
        yesBtn.onclick = async () => {
          confirmingDepId = null;
          depLiveProgress[dep.id] = { id: dep.id, status: 'installing', pct: 4, stage: isEn ? 'Starting approved install…' : '已获授权，正在启动安装…', log: '' };
          renderDeps();
          setFooter(isEn ? `Installing ${dep.name_en}…` : `正在安装 ${dep.name}…`);
          try {
            const installed = await cmd('dep-install', { id: dep.id, approved: true, reason: 'runtime_manager_confirmed' });
            delete depLiveProgress[dep.id];
            setFooter(isEn ? `✓ Installed ${dep.name_en} (${installed.version})` : `✓ ${dep.name} 安装校验完成（${installed.version}）`, 'ok');
            await refresh();
          } catch (err) {
            depLiveProgress[dep.id] = { id: dep.id, status: 'error', pct: 0, stage: err?.message || String(err), log: '' };
            setFooter(err?.message || String(err), 'err');
            renderDeps();
          }
        };
        const noBtn = document.createElement('button');
        noBtn.type = 'button';
        noBtn.className = 'btn-outline-sm';
        noBtn.textContent = isEn ? 'Cancel' : '取消';
        noBtn.onclick = () => { confirmingDepId = null; renderDeps(); };
        cBtns.append(yesBtn, noBtn);
        strip.append(txt, cBtns);
        card.appendChild(strip);
      }

      const foot = document.createElement('div');
      foot.className = 'hub-card-foot';
      const note = document.createElement('span');
      note.className = 'hub-tools-note';
      note.textContent = isEn ? (dep.fallback_note_en || '') : (dep.fallback_note || '');

      const btns = document.createElement('div');
      btns.className = 'card-actions';
      if (isInstalling) {
        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'btn-outline-sm';
        cancelBtn.textContent = isEn ? 'Cancel Install' : '取消安装';
        cancelBtn.onclick = async () => {
          await cmd('dep-cancel', { id: dep.id });
          delete depLiveProgress[dep.id];
          setFooter(isEn ? 'Install cancelled.' : '已取消安装。');
          await refresh();
        };
        btns.appendChild(cancelBtn);
      } else if (!dep.installed) {
        if (confirmingDepId !== dep.id) {
          const instBtn = document.createElement('button');
          instBtn.type = 'button';
          instBtn.className = 'btn-primary-sm';
          instBtn.textContent = isEn ? `Install (${dep.size_hint})` : `一键自装（${dep.size_hint}）`;
          instBtn.onclick = () => { confirmingDepId = dep.id; renderDeps(); };
          btns.appendChild(instBtn);
        }
      } else {
        const recheckBtn = document.createElement('button');
        recheckBtn.type = 'button';
        recheckBtn.className = 'btn-outline-sm';
        recheckBtn.textContent = isEn ? 'Re-verify' : '重新校验';
        recheckBtn.onclick = () => refresh();
        btns.appendChild(recheckBtn);
        if (dep.removable) {
          const rmBtn = document.createElement('button');
          rmBtn.type = 'button';
          rmBtn.className = 'btn-outline-sm';
          rmBtn.textContent = isEn ? 'Clean Uninstall' : '卸载清理';
          rmBtn.onclick = async () => {
            await cmd('dep-uninstall', { id: dep.id });
            setFooter(isEn ? `Removed isolated ${dep.name_en}.` : `✓ 已清理隔离目录：${dep.name}`, 'ok');
            await refresh();
          };
          btns.appendChild(rmBtn);
        }
      }
      foot.append(note, btns);
      card.appendChild(foot);
      return card;
    }));
  }

  function switchTab(next) {
    activeTab = next;
    for (const [id, name] of [['tab-all', 'all'], ['tab-connected', 'connected'], ['tab-hub', 'hub'], ['tab-deps', 'deps'], ['tab-manual', 'manual']]) {
      const el = $(id);
      if (!el) continue;
      const active = name === next;
      el.classList.toggle('active', active);
      el.setAttribute('aria-selected', String(active));
    }
    render();
  }

  async function refresh() {
    busy = true;
    render();
    try {
      const [data, hub, deps] = await Promise.all([
        cmd('mcp-connector-info'),
        cmd('hub-status').catch(() => null),
        cmd('dep-list').catch(() => null),
      ]);
      if (data) info = data;
      if (hub) hubInfo = hub;
      if (deps) depsInfo = deps;
    } catch (err) {
      setFooter(err?.message || String(err), 'err');
    } finally {
      busy = false;
      render();
    }
  }

  async function onInstall(client) {
    busy = true;
    setFooter(t('installing', client.label));
    render();
    try {
      const res = await cmd('mcp-connector-install', { client: client.id });
      if (res?.info) info = res.info;
      if (res?.installed) setFooter(t('installed', client.label, res.short_file || res.file), 'ok');
    } catch (err) {
      setFooter(err?.message || String(err), 'err');
    } finally {
      busy = false;
      render();
    }
  }

  async function onUninstall(client) {
    busy = true;
    setFooter(t('removing', client.label));
    render();
    try {
      const res = await cmd('mcp-connector-uninstall', { client: client.id });
      if (res?.info) info = res.info;
      if (res?.removed) setFooter(t('removed', client.label, res.short_file || res.file), 'ok');
    } catch (err) {
      setFooter(err?.message || String(err), 'err');
    } finally {
      busy = false;
      render();
    }
  }

  async function onCopy(text, okKey) {
    if (!text) return;
    try {
      await cmd('mcp-connector-copy', { text });
      setFooter(t(okKey), 'ok');
    } catch (err) {
      setFooter(err?.message || String(err), 'err');
    }
  }

  $('tab-all').onclick = () => switchTab('all');
  $('tab-connected').onclick = () => switchTab('connected');
  if ($('tab-hub')) $('tab-hub').onclick = () => switchTab('hub');
  if ($('tab-deps')) $('tab-deps').onclick = () => switchTab('deps');
  $('tab-manual').onclick = () => switchTab('manual');
  switchTab(activeTab);
  $('search-input').oninput = e => { query = e.target.value; render(); };
  $('btn-refresh').onclick = () => refresh();
  $('btn-copy-codex').onclick = () => onCopy(info?.codex_command, 'copiedCodex');
  $('btn-copy-json').onclick = () => onCopy(info?.generic_json, 'copiedJson');
  $('btn-copy-http').onclick = () => onCopy(info?.mcp_http_url || info?.endpoint, 'copiedHttp');
  $('btn-open-demo').onclick = async () => {
    try {
      await cmd('mcp-connector-open-demo');
      setFooter(t('demoOpened'), 'ok');
      await cmd('mcp-connector-close');
    } catch (err) {
      setFooter(err?.message || String(err), 'err');
    }
  };
  const closeModal = () => cmd('mcp-connector-close');
  $('btn-close').onclick = closeModal;
  $('btn-done').onclick = closeModal;
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeModal();
  });

  applyStaticText();
  refresh();
})();
