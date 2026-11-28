function bindProductDiscovery($, command) {
  let state, result, busy = false;
  const selected = new Set();
  const i18n = window.browserI18n;
  const t = (key, ...args) => i18n ? i18n.t(key, ...args) : key;
  const panel = $('product-discovery');
  const message = $('discovery-message');
  const statuses = {
    verification_required: '亚马逊要求验证。请打开新标签中的验证页，完成后点「分析当前 Amazon 页面」。',
    sign_in_required: '亚马逊要求登录。登录后可分析当前页面。',
    browser_busy: 'VaMoon 正在采集或暂停中，请先处理已有任务。',
    keyword_needed: '请补充英文搜索词。',
    no_results: '本页还未识别到商品。可换关键词或分析已打开的搜索页。',
    page_loading: '页面还在加载，请稍后分析当前页。',
    unsupported_store: '请先打开 Amazon 美国站的搜索结果页。',
  };

  function hasSellerStar() {
    return Array.isArray(state?.enabled_panels) ? state.enabled_panels.includes('sellerstar-batch') : true;
  }

  function updateButtons() {
    const confirmBtn = $('discovery-confirm');
    const batch = state?.sellerstar_batch;
    const ssEnabled = hasSellerStar();
    confirmBtn.hidden = !ssEnabled;
    confirmBtn.disabled = busy || !selected.size || result?.account?.status !== 'connected' ||
      ['running', 'paused'].includes(batch?.phase) || Boolean(state?.paused);
    confirmBtn.textContent = t('discoveryConfirm', selected.size);
    $('discovery-search').disabled = busy;
    $('discovery-current').disabled = busy;
    if ($('discovery-export-csv')) $('discovery-export-csv').disabled = busy || !result?.items?.length;
    if ($('discovery-export-json')) $('discovery-export-json').disabled = busy || !result?.items?.length;
  }

  function render() {
    $('discovery-ranked').hidden = !result?.items?.length;
    if (!result?.items?.length) return;
    const ssEnabled = hasSellerStar();
    $('discovery-items').replaceChildren(...result.items.map(item => {
      const row = document.createElement('div');
      row.className = 'batch-row';
      if (ssEnabled) {
        const pick = document.createElement('input');
        pick.type = 'checkbox';
        pick.disabled = item.decision !== 'eligible';
        pick.checked = selected.has(item.asin);
        pick.setAttribute('aria-label', '选中 ' + item.title);
        pick.onchange = () => { if (pick.checked) selected.add(item.asin); else selected.delete(item.asin); updateButtons(); };
        row.append(pick);
      }
      const block = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = item.rank + ' · ' + item.title;
      const metrics = document.createElement('small');
      metrics.textContent = [
        item.asin,
        item.data.listed_price === null ? '售价待核' : '$' + item.data.listed_price.toFixed(2),
        item.decision === 'eligible' ? '符合当前条件' : '待核',
      ].join(' · ');
      const reason = document.createElement('small');
      reason.textContent = item.reasons.join(' · ') || '该商品的需求信号尚未取得';
      const evidence = document.createElement('small');
      evidence.textContent = (item.data.evidence_source ? item.data.evidence_source + ' ' + item.data.evidence_date + ' · ' : '') +
        '首次发现 ' + item.data.first_seen.slice(0, 10);
      const link = document.createElement('button');
      link.type = 'button';
      link.textContent = t('discoveryOpenProduct');
      link.onclick = () => command('new', { url: item.url });
      block.append(title, metrics, reason, evidence);
      if (item.data.source_url) {
        const source = document.createElement('small');
        source.textContent = '导入货源 ' + item.data.source_url;
        block.append(source);
      }
      if (item.data.target_profit_units !== null) {
        const units = document.createElement('small');
        units.textContent = '达到月贡献目标需卖 ' + item.data.target_profit_units + ' 件（情景）';
        block.append(units);
      }
      block.append(link);
      row.append(block);
      return row;
    }));
    updateButtons();
  }

  async function search(useCurrent) {
    if (busy) return;
    const input = { intent: $('discovery-intent').value.trim() };
    const keyword = $('discovery-keyword').value.trim();
    if (keyword) input.keyword = keyword;
    for (const key of ['strategy', 'fulfillment']) {
      const value = $('discovery-' + key).value;
      if (value) input[key] = value;
    }
    for (const control of $('discovery-metrics').querySelectorAll('input')) {
      if (control.value !== '' && !control.checkValidity()) { message.textContent = '请检查筛选字段的数值。'; return; }
      if (control.value !== '') input[control.dataset.field] = Number(control.value);
    }
    if ($('discovery-ip').checked) input.require_ip_review = true;
    const evidence = $('discovery-evidence').value.trim();
    if (evidence) {
      try { input.evidence = JSON.parse(evidence); }
      catch { message.textContent = '补充数据不是有效的 JSON。'; return; }
    }
    if (useCurrent && state?.active) input.tab_id = state.active;
    result = null;
    selected.clear();
    render();
    busy = true;
    updateButtons();
    message.textContent = '正在从 Amazon 读取商品…';
    try {
      result = await command('product-discovery', input);
      if (!result) { message.textContent = '读取失败，请根据提示检查页面。'; return; }
      if (result.status !== 'ok') { message.textContent = statuses[result.status] ?? '当前页没有可读的选品数据。'; return; }
      const { plan } = result;
      const basis = result.items[0]?.ranking_basis;
      const ranking = basis === 'monthly_contribution_scenario' ? '按月贡献情景排序。' : basis === 'unit_contribution' ? '按单件贡献排序。' : '';
      const ssHint = hasSellerStar() && result.account?.status !== 'connected' ? ' 登录塞星后可确认采集。' : '';
      message.textContent = (plan.keyword ? plan.keyword + ' · ' : '') + '已读取 ' + result.observed_count + ' 件，排除 ' + result.excluded_count +
        ' 件，列出 ' + result.items.length + ' 件。' + ssHint + ranking;
      render();
    } finally { busy = false; updateButtons(); }
  }

  async function exportReport(format) {
    if (!result?.items?.length || busy) return;
    busy = true;
    updateButtons();
    try {
      const exported = await command('discovery-export', { format, result });
      if (exported?.path) message.textContent = t('discoveryExported', exported.path);
    } finally { busy = false; updateButtons(); }
  }

  $('discovery-toggle').onclick = () => {
    if (typeof window.switchStudio === 'function') window.switchStudio('discovery');
  };
  $('discovery-search').onclick = () => search(false);
  $('discovery-current').onclick = () => search(true);
  $('discovery-select').onclick = () => {
    selected.clear();
    for (const row of result?.items ?? []) if (row.decision === 'eligible') selected.add(row.asin);
    render();
  };
  if ($('discovery-export-csv')) $('discovery-export-csv').onclick = () => exportReport('csv');
  if ($('discovery-export-json')) $('discovery-export-json').onclick = () => exportReport('json');
  $('discovery-confirm').onclick = async () => {
    if ($('discovery-confirm').disabled) return;
    busy = true; updateButtons();
    try {
      const chosen = result.items.filter(row => selected.has(row.asin));
      const job = await command('sellerstar-batch-start', { tenant_id: result.account.tenant_id, links: chosen.map(row => row.url) });
      if (job) { selected.clear(); render(); $('batch-toggle').click(); }
    } finally { busy = false; updateButtons(); }
  };
  return next => { state = next; updateButtons(); };
}
