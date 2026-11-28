function bindMcpConnector($, command) {
  const panel = $('mcp-connector');
  const toggleBtn = $('mcp-toggle');
  const openBtn = $('mcp-open-from-card');
  if (!panel || !toggleBtn) return () => {};

  const i18n = window.browserI18n;
  const t = (key, ...args) => (i18n ? i18n.t(key, ...args) : key);

  let info = null;
  let busy = false;
  let lastLocale = null;

  function setStatus(text, isError = false) {
    const el = $('mcp-feedback');
    if (!el) return;
    el.textContent = text || '';
    el.classList.toggle('mcp-feedback-error', Boolean(isError));
  }

  function render() {
    if (!info) return;
    if ($('mcp-endpoint')) {
      const hostPort = info.endpoint ? info.endpoint.replace(/^https?:\/\//, '') : '127.0.0.1';
      const toolsPart = typeof info.tool_count === 'number' ? ' · ' + info.tool_count + ' ' + t('mcpToolsUnit') : '';
      $('mcp-endpoint').textContent = hostPort + toolsPart;
    }
    if ($('mcp-server-name')) {
      $('mcp-server-name').textContent = info.server_name || 'va_commerce_browser';
    }
    if ($('mcp-codex-cmd')) {
      $('mcp-codex-cmd').value = info.codex_command || '';
    }
    if ($('mcp-generic-json')) {
      $('mcp-generic-json').value = info.generic_json || '';
    }
    const list = $('mcp-client-list');
    if (list) {
      const jsonClients = (info.clients || []).filter(c => c.format === 'json');
      list.replaceChildren(...jsonClients.map(client => {
        const row = document.createElement('div');
        row.className = 'mcp-client-row';

        const meta = document.createElement('div');
        meta.className = 'mcp-client-meta';
        const name = document.createElement('strong');
        name.textContent = client.label;
        const sub = document.createElement('small');
        sub.textContent = client.configured ? t('mcpStateConfigured') : (client.exists ? t('mcpStateDetected') : t('mcpStateNotConfigured'));
        sub.className = client.configured ? 'mcp-ok' : '';
        meta.append(name, sub);

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = client.configured ? 'mcp-btn-reinstall' : 'mcp-btn-install';
        btn.disabled = busy;
        btn.textContent = client.configured ? t('mcpReinstall') : t('mcpInstall');
        btn.onclick = () => installClient(client.id, client.label);

        row.append(meta, btn);
        return row;
      }));
    }
    const codexInfo = (info.clients || []).find(c => c.id === 'codex');
    if ($('mcp-codex-badge')) {
      $('mcp-codex-badge').textContent = codexInfo?.configured ? t('mcpStateConfigured') : t('mcpCodexHint');
      $('mcp-codex-badge').className = codexInfo?.configured ? 'mcp-ok' : 'muted';
    }
  }

  async function refresh() {
    busy = true;
    render();
    try {
      const data = await command('mcp-connector-info');
      if (data) info = data;
    } finally {
      busy = false;
      render();
    }
  }

  async function installClient(clientId, label) {
    busy = true;
    setStatus(t('mcpInstalling', label));
    render();
    try {
      const res = await command('mcp-connector-install', { client: clientId });
      if (res?.info) info = res.info;
      if (res?.installed) {
        setStatus(t('mcpInstalledOk', label, res.file));
      }
    } catch (err) {
      setStatus(err?.message || String(err), true);
    } finally {
      busy = false;
      render();
    }
  }

  async function copyText(text, okKey) {
    if (!text) return;
    try {
      await command('mcp-connector-copy', { text });
      setStatus(t(okKey));
    } catch (err) {
      setStatus(err?.message || String(err), true);
    }
  }

  function closeOtherPanels() {
    for (const [panelId, btnId] of [['product-discovery', 'discovery-toggle'], ['sellerstar-batch', 'batch-toggle']]) {
      if ($(panelId)) $(panelId).hidden = true;
      if ($(btnId)) $(btnId).setAttribute('aria-expanded', 'false');
    }
  }

  function setOpen(open) {
    panel.hidden = !open;
    toggleBtn.setAttribute('aria-expanded', String(open));
    if (open) {
      closeOtherPanels();
      panel.scrollIntoView({ block: 'nearest' });
      refresh();
    }
  }

  toggleBtn.onclick = () => setOpen(panel.hidden);
  if (openBtn) openBtn.onclick = () => setOpen(true);
  if ($('mcp-refresh')) $('mcp-refresh').onclick = () => refresh();
  if ($('mcp-copy-codex')) $('mcp-copy-codex').onclick = () => copyText(info?.codex_command, 'mcpCopiedCodex');
  if ($('mcp-copy-json')) $('mcp-copy-json').onclick = () => copyText(info?.generic_json, 'mcpCopiedJson');
  if ($('mcp-copy-endpoint')) $('mcp-copy-endpoint').onclick = () => copyText(info?.mcp_http_url || info?.endpoint, 'mcpCopiedEndpoint');
  if ($('mcp-open-demo')) $('mcp-open-demo').onclick = () => command('mcp-connector-open-demo');

  return state => {
    const loc = state?.locale || 'zh-CN';
    if (lastLocale !== loc) {
      lastLocale = loc;
      if (!panel.hidden && info) render();
    }
  };
}
