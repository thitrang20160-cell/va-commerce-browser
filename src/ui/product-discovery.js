function bindProductDiscovery($, command) {
  let state, result, busy = false;
  const selected = new Set();
  const i18n = window.browserI18n;
  const t = (key, ...args) => i18n ? i18n.t(key, ...args) : key;
  const panel = $('product-discovery');
  const message = $('discovery-message');
  const statuses = {
    verification_required: '亚马逊要求验证。请打开新标签中的验证页，完成后点「分析当前页」。',
    sign_in_required: '亚马逊要求登录。登录后可分析当前页面。',
    browser_busy: '浏览器当前处于「暂停接管」或忙碌状态，请先点击上方「恢复 Agent」再试。',
    keyword_needed: '暂未自动映射到英文词，已为你展开下方「Amazon 英文搜索词」，填写后点「开始发掘」即可。',
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
    if ($('discovery-open-modal')) $('discovery-open-modal').disabled = busy || !result?.items?.length;
    if ($('discovery-export-csv')) $('discovery-export-csv').disabled = busy || !result?.items?.length;
    if ($('discovery-export-json')) $('discovery-export-json').disabled = busy || !result?.items?.length;
  }

  function openGalleryModal(focusAsin = null) {
    if (!result?.items?.length) return;
    command('discovery-modal-open', { result, focus_asin: focusAsin });
  }

  function render() {
    $('discovery-ranked').hidden = !result?.items?.length;
    if (!result?.items?.length) return;
    const ssEnabled = hasSellerStar();
    $('discovery-items').replaceChildren(...result.items.map(item => {
      const row = document.createElement('div');
      row.className = 'batch-row discovery-thumb-row';
      if (ssEnabled) {
        const pick = document.createElement('input');
        pick.type = 'checkbox';
        pick.checked = selected.has(item.asin);
        pick.onclick = e => e.stopPropagation();
        pick.onchange = () => {
          if (pick.checked) selected.add(item.asin);
          else selected.delete(item.asin);
          updateButtons();
        };
        row.append(pick);
      }
      if (item.image) {
        const img = document.createElement('img');
        img.className = 'mini-thumb';
        img.src = item.image;
        img.alt = item.title || item.asin;
        img.loading = 'lazy';
        img.onerror = () => img.remove();
        row.append(img);
      }
      const block = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = item.rank + ' · ' + item.title;
      const meta = document.createElement('small');
      const price = item.data.listed_price === null ? '售价未知' : '$' + item.data.listed_price.toFixed(2);
      const decision = item.decision === 'eligible' ? '符合条件' : '待补充数据';
      meta.textContent = [item.asin, price, decision].join(' · ');
      const reasons = document.createElement('small');
      reasons.textContent = item.reasons.slice(0, 2).join(' · ');
      const actions = document.createElement('div');
      actions.className = 'mini-row-links';
      const previewBtn = document.createElement('button');
      previewBtn.type = 'button';
      previewBtn.className = 'mini-link-btn';
      previewBtn.textContent = t('discoveryPreviewItem');
      previewBtn.onclick = e => { e.stopPropagation(); openGalleryModal(item.asin); };
      const openBtn = document.createElement('button');
      openBtn.type = 'button';
      openBtn.className = 'mini-link-btn';
      openBtn.textContent = t('discoveryOpenProduct');
      openBtn.onclick = e => { e.stopPropagation(); command('new', { url: item.url }); };
      actions.append(previewBtn, openBtn);
      block.append(title, meta, reasons, actions);
      row.onclick = () => openGalleryModal(item.asin);
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
      if (result.status !== 'ok') {
        message.textContent = statuses[result.status] ?? '当前页没有可读的选品数据。';
        if (result.status === 'keyword_needed') {
          const drawer = panel.querySelector('.advanced-drawer');
          if (drawer) drawer.open = true;
          $('discovery-keyword')?.focus();
        }
        return;
      }
      const { plan } = result;
      const basis = result.items[0]?.ranking_basis;
      const ranking = basis === 'monthly_contribution_scenario' ? '按月贡献情景排序。' : basis === 'unit_contribution' ? '按单件贡献排序。' : '';
      const ssHint = hasSellerStar() && result.account?.status !== 'connected' ? ' 登录塞星后可确认采集。' : '';
      message.textContent = (plan.keyword ? plan.keyword + ' · ' : '') + '已读取 ' + result.observed_count + ' 件，排除 ' + result.excluded_count +
        ' 件，列出 ' + result.items.length + ' 件。' + ssHint + ranking;
      render();
      openGalleryModal();
    } finally { busy = false; updateButtons(); }
  }

  async function exportReport(format) {
    if (busy || !result?.items?.length) return;
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
  if ($('discovery-open-modal')) $('discovery-open-modal').onclick = () => openGalleryModal();
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
