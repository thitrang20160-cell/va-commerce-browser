(function () {
  const $ = id => document.getElementById(id);

  const I18N = {
    'zh-CN': {
      title: 'AI 选品画廊',
      summary: (obs, listed, excl) => `已读取 ${obs} 件 · 精选 ${listed} 件 · 排除 ${excl} 件`,
      all: '全部',
      eligible: '符合',
      evidence: '待核',
      emptyList: '当前筛选下没有商品。',
      emptyDetail: '点击左侧商品卡片查看详细预览',
      decisionOk: '✓ 符合条件',
      decisionWarn: '待补充数据',
      openMini: '直达 ↗',
      copyAsin: '复制 ASIN',
      liveUrlLabel: '商品实际链接（点击直接打开）',
      copyUrl: '复制链接',
      priceLbl: '售价',
      demandLbl: '近月需求信号',
      ratingLbl: '评分 / 评价数',
      profitLbl: '单件贡献 / IP 风险',
      reasonsTitle: '评估依据与信号',
      openLiveBtn: '进入亚马逊实际商品页 ↗',
      selectEligible: '勾选符合条件',
      collectSelected: n => (n ? `确认采集已选 (${n})` : '确认并采集已选'),
      close: '关闭',
      defaultFooter: '点击左侧卡片预览详情 · 点击链接直接进入实际商品页',
      firstSeen: d => '首次发现 ' + d,
      copiedAsin: a => '✓ 已复制 ASIN：' + a,
      copiedUrl: '✓ 已复制商品链接到剪贴板。',
      exported: p => '✓ 已导出报表：' + p,
      collectStarted: n => `✓ 已将 ${n} 件商品送入后台采集队列。`,
      unknown: '未知',
      riskReviewed: 'IP 已核',
      riskHigh: '高风险',
      riskUnknown: 'IP 待核',
    },
    en: {
      title: 'AI Product Discovery Gallery',
      summary: (obs, listed, excl) => `Observed ${obs} · Ranked ${listed} · Excluded ${excl}`,
      all: 'All',
      eligible: 'Eligible',
      evidence: 'Needs Info',
      emptyList: 'No products match this filter.',
      emptyDetail: 'Select any product card on the left for full preview',
      decisionOk: '✓ Eligible',
      decisionWarn: 'Needs Evidence',
      openMini: 'Open ↗',
      copyAsin: 'Copy ASIN',
      liveUrlLabel: 'Live Product URL (click to open)',
      copyUrl: 'Copy URL',
      priceLbl: 'Listed Price',
      demandLbl: 'Monthly Demand Signal',
      ratingLbl: 'Rating / Reviews',
      profitLbl: 'Unit Contrib / IP Risk',
      reasonsTitle: 'Scoring Reasons & Signals',
      openLiveBtn: 'Open Live Amazon Product Page ↗',
      selectEligible: 'Select Eligible',
      collectSelected: n => (n ? `Collect Selected (${n})` : 'Confirm & Collect'),
      close: 'Close',
      defaultFooter: 'Click any product card for full preview · Click URL to open live page',
      firstSeen: d => 'First seen ' + d,
      copiedAsin: a => '✓ Copied ASIN: ' + a,
      copiedUrl: '✓ Copied product URL to clipboard.',
      exported: p => '✓ Exported report: ' + p,
      collectStarted: n => `✓ Queued ${n} item(s) for collection.`,
      unknown: 'N/A',
      riskReviewed: 'IP Reviewed',
      riskHigh: 'High Risk',
      riskUnknown: 'IP Unknown',
    },
  };

  let payload = null;
  let locale = 'zh-CN';
  let filter = 'all';
  let activeAsin = null;
  const selected = new Set();

  const t = (key, ...args) => {
    const dict = I18N[locale] || I18N.en;
    const val = dict[key] ?? I18N.en[key] ?? key;
    return typeof val === 'function' ? val(...args) : val;
  };

  function setFooter(text, kind = '') {
    const el = $('dm-footer-status');
    el.textContent = text;
    el.className = 'footer-status' + (kind ? ' is-' + kind : '');
  }

  function applyStatic() {
    document.documentElement.lang = locale;
    document.title = t('title');
    $('dm-title').textContent = t('title');
    $('f-all').childNodes[0].nodeValue = t('all') + ' ';
    $('f-eligible').childNodes[0].nodeValue = t('eligible') + ' ';
    $('f-evidence').childNodes[0].nodeValue = t('evidence') + ' ';
    $('gallery-empty').textContent = t('emptyList');
    $('detail-empty').textContent = t('emptyDetail');
    $('btn-copy-asin').textContent = t('copyAsin');
    $('lbl-live-url').textContent = t('liveUrlLabel');
    $('btn-copy-url').textContent = t('copyUrl');
    $('k-price-lbl').textContent = t('priceLbl');
    $('k-demand-lbl').textContent = t('demandLbl');
    $('k-rating-lbl').textContent = t('ratingLbl');
    $('k-profit-lbl').textContent = t('profitLbl');
    $('lbl-reasons').textContent = t('reasonsTitle');
    $('btn-open-live').textContent = t('openLiveBtn');
    $('btn-select-eligible').textContent = t('selectEligible');
    $('btn-done').textContent = t('close');
    setFooter(t('defaultFooter'));
  }

  const cmd = (name, args = {}) => window.browserUI.command(name, args);

  function itemsList() {
    return payload?.result?.items ?? [];
  }

  function filteredItems() {
    return itemsList().filter(row => {
      if (filter === 'eligible') return row.decision === 'eligible';
      if (filter === 'evidence') return row.decision !== 'eligible';
      return true;
    });
  }

  function formatDemand(data) {
    if (data?.demand == null) return t('unknown');
    return data.demand.toLocaleString('en-US') + (data.demand_kind === 'public_purchase_signal_lower' ? '+' : '');
  }

  function renderDetail(item) {
    if (!item) {
      $('detail-empty').hidden = false;
      $('detail-content').hidden = true;
      return;
    }
    $('detail-empty').hidden = true;
    $('detail-content').hidden = false;
    const data = item.data ?? {};

    const img = $('d-img');
    const fallback = $('d-img-fallback');
    if (item.image) {
      img.src = item.image;
      img.alt = item.title || item.asin;
      img.hidden = false;
      fallback.hidden = true;
      img.onerror = () => { img.hidden = true; fallback.hidden = false; };
    } else {
      img.hidden = true;
      fallback.hidden = false;
    }

    $('d-rank').textContent = '#' + item.rank;
    const dec = $('d-decision');
    dec.textContent = item.decision === 'eligible' ? t('decisionOk') : t('decisionWarn');
    dec.className = 'stage-decision ' + (item.decision === 'eligible' ? 'badge-ok' : 'badge-warn');

    $('d-title').textContent = item.title || item.asin;
    $('d-asin').textContent = item.asin;
    $('d-first-seen').textContent = data.first_seen ? t('firstSeen', String(data.first_seen).slice(0, 10)) : '';

    $('d-url-text').textContent = item.url;
    $('d-url-link').onclick = () => openLiveUrl(item.url);
    $('btn-open-live').onclick = () => openLiveUrl(item.url);
    $('btn-copy-asin').onclick = async () => {
      await cmd('mcp-connector-copy', { text: item.asin });
      setFooter(t('copiedAsin', item.asin), 'ok');
    };
    $('btn-copy-url').onclick = async () => {
      await cmd('mcp-connector-copy', { text: item.url });
      setFooter(t('copiedUrl'), 'ok');
    };

    $('d-price').textContent = data.listed_price != null ? '$' + Number(data.listed_price).toFixed(2) : t('unknown');
    $('d-demand').textContent = formatDemand(data);
    const ratingStr = data.rating != null ? '★ ' + data.rating : '—';
    const reviewsStr = data.reviews != null ? data.reviews.toLocaleString('en-US') : '—';
    $('d-rating').textContent = `${ratingStr} · ${reviewsStr}`;

    const riskText = data.risk === 'reviewed' ? t('riskReviewed') : data.risk === 'high' ? t('riskHigh') : t('riskUnknown');
    const contribText = data.contribution != null ? '$' + Number(data.contribution).toFixed(2) : null;
    $('d-profit').textContent = contribText ? `${contribText} · ${riskText}` : riskText;

    const tagsEl = $('d-reasons');
    const reasons = Array.isArray(item.reasons) ? item.reasons : [];
    tagsEl.replaceChildren(...reasons.map(r => {
      const span = document.createElement('span');
      const isWarn = /待核|缺少|不足|高于|低于|风险/.test(r);
      span.className = 'reason-tag ' + (isWarn ? 'is-warn' : 'is-good');
      span.textContent = r;
      return span;
    }));
  }

  function updateCollectButtons() {
    const canCollect = Boolean(payload?.sellerstar_enabled);
    $('btn-select-eligible').hidden = !canCollect;
    const collectBtn = $('btn-collect-selected');
    collectBtn.hidden = !canCollect;
    const connected = payload?.result?.account?.status === 'connected';
    collectBtn.disabled = !selected.size || !connected || Boolean(payload?.paused);
    collectBtn.textContent = t('collectSelected', selected.size);
  }

  function render() {
    if (!payload) return;
    document.documentElement.dataset.theme = payload.theme === 'light' ? 'light' : 'dark';
    if (payload.locale && I18N[payload.locale] && payload.locale !== locale) {
      locale = payload.locale;
      applyStatic();
    }

    const res = payload.result || {};
    const all = itemsList();
    const eligibleCount = all.filter(i => i.decision === 'eligible').length;
    const evidenceCount = all.length - eligibleCount;

    $('dm-keyword-pill').textContent = res.plan?.keyword || 'Amazon US';
    $('dm-summary').textContent = t('summary', res.observed_count ?? all.length, all.length, res.excluded_count ?? 0);
    $('c-all').textContent = String(all.length);
    $('c-eligible').textContent = String(eligibleCount);
    $('c-evidence').textContent = String(evidenceCount);

    const visible = filteredItems();
    if (payload.focus_asin && visible.some(i => i.asin === payload.focus_asin)) {
      activeAsin = payload.focus_asin;
      payload.focus_asin = null;
    } else if (!visible.some(i => i.asin === activeAsin)) {
      activeAsin = visible[0]?.asin ?? null;
    }

    const grid = $('gallery-grid');
    $('gallery-empty').hidden = visible.length > 0;
    grid.hidden = visible.length === 0;

    const canCollect = Boolean(payload.sellerstar_enabled);
    grid.replaceChildren(...visible.map(item => {
      const data = item.data ?? {};
      const card = document.createElement('article');
      card.className = 'product-card' + (item.asin === activeAsin ? ' is-selected' : '');
      card.onclick = () => { activeAsin = item.asin; render(); };

      const thumbWrap = document.createElement('div');
      thumbWrap.className = 'card-thumb-wrap';
      if (item.image) {
        const img = document.createElement('img');
        img.className = 'card-thumb';
        img.src = item.image;
        img.alt = item.title || item.asin;
        img.loading = 'lazy';
        img.onerror = () => {
          img.remove();
          const fb = document.createElement('div');
          fb.className = 'thumb-fallback';
          fb.textContent = item.asin;
          thumbWrap.append(fb);
        };
        thumbWrap.append(img);
      } else {
        const fb = document.createElement('div');
        fb.className = 'thumb-fallback';
        fb.innerHTML = '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>';
        thumbWrap.append(fb);
      }

      const rank = document.createElement('span');
      rank.className = 'card-rank';
      rank.textContent = '#' + item.rank;
      const badge = document.createElement('span');
      badge.className = 'card-badge ' + (item.decision === 'eligible' ? 'badge-ok' : 'badge-warn');
      badge.textContent = item.decision === 'eligible' ? t('decisionOk') : t('decisionWarn');
      thumbWrap.append(rank, badge);

      if (canCollect) {
        const pickWrap = document.createElement('label');
        pickWrap.className = 'card-pick';
        pickWrap.onclick = e => e.stopPropagation();
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = selected.has(item.asin);
        cb.onchange = () => {
          if (cb.checked) selected.add(item.asin);
          else selected.delete(item.asin);
          updateCollectButtons();
        };
        pickWrap.append(cb);
        thumbWrap.append(pickWrap);
      }

      const info = document.createElement('div');
      info.className = 'card-info';
      const title = document.createElement('h3');
      title.className = 'card-title';
      title.textContent = item.title || item.asin;
      title.title = item.title || item.asin;

      const metrics = document.createElement('div');
      metrics.className = 'card-metrics';
      const price = document.createElement('span');
      price.className = 'card-price';
      price.textContent = data.listed_price != null ? '$' + Number(data.listed_price).toFixed(2) : '—';
      metrics.append(price);
      if (data.demand != null) {
        const dem = document.createElement('span');
        dem.className = 'card-demand';
        dem.textContent = formatDemand(data);
        metrics.append(dem);
      }

      const foot = document.createElement('div');
      foot.className = 'card-foot';
      const ratingSpan = document.createElement('span');
      ratingSpan.textContent = data.rating != null ? `★ ${data.rating}${data.reviews != null ? ' (' + data.reviews + ')' : ''}` : item.asin;
      const openMini = document.createElement('button');
      openMini.type = 'button';
      openMini.className = 'card-open-mini';
      openMini.textContent = t('openMini');
      openMini.onclick = e => { e.stopPropagation(); openLiveUrl(item.url); };
      foot.append(ratingSpan, openMini);

      info.append(title, metrics, foot);
      card.append(thumbWrap, info);
      return card;
    }));

    const activeItem = visible.find(i => i.asin === activeAsin) || null;
    renderDetail(activeItem);
    updateCollectButtons();
  }

  async function openLiveUrl(url) {
    try {
      await cmd('discovery-modal-open-url', { url, close_modal: true });
    } catch (err) {
      setFooter(err?.message || String(err), 'err');
    }
  }

  async function exportReport(format) {
    if (!payload?.result?.items?.length) return;
    try {
      const exported = await cmd('discovery-export', { format, result: payload.result });
      if (exported?.path) setFooter(t('exported', exported.path), 'ok');
    } catch (err) {
      setFooter(err?.message || String(err), 'err');
    }
  }

  function setFilter(next) {
    filter = next;
    for (const [id, name] of [['f-all', 'all'], ['f-eligible', 'eligible'], ['f-evidence', 'evidence']]) {
      $(id).classList.toggle('active', name === next);
    }
    render();
  }

  $('f-all').onclick = () => setFilter('all');
  $('f-eligible').onclick = () => setFilter('eligible');
  $('f-evidence').onclick = () => setFilter('evidence');
  $('btn-csv').onclick = () => exportReport('csv');
  $('btn-json').onclick = () => exportReport('json');
  $('btn-select-eligible').onclick = () => {
    selected.clear();
    for (const item of itemsList()) if (item.decision === 'eligible') selected.add(item.asin);
    render();
  };
  $('btn-collect-selected').onclick = async () => {
    const chosen = itemsList().filter(row => selected.has(row.asin));
    if (!chosen.length || !payload?.result?.account?.tenant_id) return;
    try {
      const job = await cmd('sellerstar-batch-start', {
        tenant_id: payload.result.account.tenant_id,
        links: chosen.map(r => r.url),
      });
      if (job) {
        selected.clear();
        setFooter(t('collectStarted', chosen.length), 'ok');
        render();
      }
    } catch (err) {
      setFooter(err?.message || String(err), 'err');
    }
  };

  const close = () => cmd('discovery-modal-close');
  $('btn-close').onclick = close;
  $('btn-done').onclick = close;
  document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });

  window.browserUI.subscribe(next => {
    if (next && 'result' in next) {
      payload = next;
      render();
    }
  });

  applyStatic();
  cmd('discovery-modal-data').then(data => {
    payload = data;
    render();
  });
})();
