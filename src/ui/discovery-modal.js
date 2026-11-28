(function () {
  const $ = id => document.getElementById(id);

  const I18N = {
    'zh-CN': {
      title: 'AI 选品画廊',
      modeBoutique: '💎 精品',
      modeDistribution: '⚡ 铺货',
      summary: (obs, listed, excl, safe, dup) =>
        `已读取 ${obs} 件 · 精选 ${listed} 件 · 排除 ${excl} 件` + (safe != null ? ` · 可铺货 ${safe} 件` : '') + (dup ? ` · 塞星已有 ${dup} 件` : ''),
      all: '全部',
      safe: '可铺货',
      eligible: '符合',
      evidence: '待核',
      emptyList: '当前筛选下没有商品。',
      emptyDetail: '点击左侧商品卡片查看详细预览',
      decisionOk: '✓ 符合条件',
      decisionWarn: '待补充数据',
      dupBadge: '塞星已有',
      riskBadge: '⚠ 风险词',
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
      openLiveShort: '打开实际链接 ↗',
      addBoutique: '+ 加入精品立项',
      addedBoutique: '✓ 已入精品单',
      cardAddBoutique: '+ 立项',
      cardAddedBoutique: '✓ 已立项',
      openBoutique: n => `进入精品深挖 SOP (${n}) →`,
      scopeAll: '含全部变体',
      scopeMain: '仅主商品',
      selectSafe: '一键勾选可铺货',
      selectEligible: '勾选符合条件',
      collectSelected: n => (n ? `推送至塞星采集箱 (${n})` : '推送至塞星采集箱'),
      openSellerStar: '去塞星上架 ↗',
      close: '关闭',
      defaultFooterDist: '⚡ 铺货模式：已自动查重并标记大牌/敏感词 · 勾选后一键推送塞星入箱上架',
      defaultFooterBoutique: '💎 精品模式：挑选 3–5 个标杆竞品加入立项单 → 拆解差评与 1688 利润精算',
      firstSeen: d => '首次发现 ' + d,
      copiedAsin: a => '✓ 已复制 ASIN：' + a,
      copiedUrl: '✓ 已复制商品链接到剪贴板。',
      exported: p => '✓ 已导出报表：' + p,
      collectStarted: n => `✓ 已将 ${n} 件商品送入塞星后台采集队列，可点击右侧「去塞星上架 ↗」查看。`,
      boutiqueAdded: a => `✓ 已将 ${a} 加入精品立项单，可点击右下角进入深挖 SOP。`,
      boutiqueRemoved: a => `已将 ${a} 从精品立项单移除。`,
      unknown: '未知',
      riskReviewed: 'IP 已核',
      riskHigh: '高风险',
      riskUnknown: 'IP 待核',
    },
    en: {
      title: 'AI Discovery Gallery',
      modeBoutique: '💎 Boutique',
      modeDistribution: '⚡ Distribute',
      summary: (obs, listed, excl, safe, dup) =>
        `Observed ${obs} · Ranked ${listed} · Excluded ${excl}` + (safe != null ? ` · Safe ${safe}` : '') + (dup ? ` · In Box ${dup}` : ''),
      all: 'All',
      safe: 'Safe',
      eligible: 'Eligible',
      evidence: 'Needs Info',
      emptyList: 'No products match this filter.',
      emptyDetail: 'Select any product card on the left for full preview',
      decisionOk: '✓ Eligible',
      decisionWarn: 'Needs Evidence',
      dupBadge: 'In Box',
      riskBadge: '⚠ Risk',
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
      openLiveShort: 'Open Live URL ↗',
      addBoutique: '+ Shortlist for Boutique',
      addedBoutique: '✓ Shortlisted',
      cardAddBoutique: '+ Pick',
      cardAddedBoutique: '✓ Picked',
      openBoutique: n => `Open Boutique SOP (${n}) →`,
      scopeAll: 'All Variants',
      scopeMain: 'Main Only',
      selectSafe: 'Select Safe SKUs',
      selectEligible: 'Select Eligible',
      collectSelected: n => (n ? `Push to Collection (${n})` : 'Push to Collection'),
      openSellerStar: 'Open Collection Box ↗',
      close: 'Close',
      defaultFooterDist: '⚡ Distribution SOP: auto brand/risk filter & dedup → select & push to collection box',
      defaultFooterBoutique: '💎 Boutique SOP: shortlist 3–5 benchmark ASINs → teardown pain points & 1688 profit calc',
      firstSeen: d => 'First seen ' + d,
      copiedAsin: a => '✓ Copied ASIN: ' + a,
      copiedUrl: '✓ Copied product URL to clipboard.',
      exported: p => '✓ Exported report: ' + p,
      collectStarted: n => `✓ Queued ${n} SKU(s) for background collection.`,
      boutiqueAdded: a => `✓ Added ${a} to Boutique SOP shortlist.`,
      boutiqueRemoved: a => `Removed ${a} from Boutique SOP shortlist.`,
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
  let collectionMode = 'all_variants';
  let justQueued = false;
  let lastRenderedMode = null;
  const selected = new Set();

  const t = (key, ...args) => {
    const dict = I18N[locale] || I18N.en;
    const val = dict[key] ?? I18N.en[key] ?? key;
    return typeof val === 'function' ? val(...args) : val;
  };

  const sopMode = () => payload?.sop?.mode || (payload?.sellerstar_enabled ? 'distribution' : 'boutique');
  const boutiqueSet = () => new Set((payload?.sop?.boutique?.items || []).map(i => i.asin));

  function setFooter(text, kind = '') {
    const el = $('dm-footer-status');
    el.textContent = text;
    el.className = 'footer-status' + (kind ? ' is-' + kind : '');
  }

  function applyStatic() {
    document.documentElement.lang = locale;
    document.title = t('title');
    $('dm-title').textContent = t('title');
    $('m-boutique').textContent = t('modeBoutique');
    $('m-distribution').textContent = t('modeDistribution');
    $('f-all').childNodes[0].nodeValue = t('all') + ' ';
    $('f-safe').childNodes[0].nodeValue = t('safe') + ' ';
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
    $('scope-all').textContent = t('scopeAll');
    $('scope-main').textContent = t('scopeMain');
    $('btn-open-sellerstar').textContent = t('openSellerStar');
    $('btn-done').textContent = t('close');
  }

  const cmd = (name, args = {}) => window.browserUI.command(name, args);
  const itemsList = () => payload?.result?.items ?? [];

  function filteredItems() {
    return itemsList().filter(row => {
      if (filter === 'safe') return Boolean(row.distribution_safe);
      if (filter === 'eligible') return row.decision === 'eligible';
      if (filter === 'evidence') return row.decision !== 'eligible';
      return true;
    });
  }

  function formatDemand(data) {
    if (data?.demand == null) return t('unknown');
    return data.demand.toLocaleString('en-US') + (data.demand_kind === 'public_purchase_signal_lower' ? '+' : '');
  }

  async function toggleBoutique(item) {
    const inList = boutiqueSet().has(item.asin);
    try {
      if (inList) {
        const sop = await cmd('sop-boutique-remove', { asin: item.asin });
        if (payload) payload.sop = sop;
        setFooter(t('boutiqueRemoved', item.asin));
      } else {
        const sop = await cmd('sop-boutique-add', {
          item: {
            asin: item.asin,
            title: item.title,
            url: item.url,
            image: item.image || null,
            keyword: payload?.result?.plan?.keyword || '',
            price: item.data?.listed_price ?? null,
            rating: item.data?.rating ?? null,
            reviews: item.data?.reviews ?? null,
            demand: item.data?.demand ?? null,
          },
        });
        if (payload) payload.sop = sop;
        setFooter(t('boutiqueAdded', item.asin), 'ok');
      }
      render();
    } catch (err) {
      setFooter(err?.message || String(err), 'err');
    }
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
    const modeNow = sopMode();

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
    $('d-dup-chip').hidden = !item.already_collected;
    $('d-dup-chip').textContent = t('dupBadge');

    const risks = Array.isArray(item.risk_flags) ? item.risk_flags : [];
    const riskChip = $('d-risk-chip');
    riskChip.hidden = !risks.length;
    if (risks.length) {
      riskChip.textContent = '⚠ ' + risks[0].label;
      riskChip.title = risks.map(r => r.label).join(' · ');
    }

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
    const allTags = [
      ...risks.map(r => ({ text: '⚠ ' + r.label, warn: true })),
      ...(Array.isArray(item.reasons) ? item.reasons.map(r => ({ text: r, warn: /待核|缺少|不足|高于|低于|风险/.test(r) })) : []),
    ];
    tagsEl.replaceChildren(...allTags.map(entry => {
      const span = document.createElement('span');
      span.className = 'reason-tag ' + (entry.warn ? 'is-warn' : 'is-good');
      span.textContent = entry.text;
      return span;
    }));

    const bBtn = $('btn-boutique-toggle');
    const isBoutique = modeNow === 'boutique';
    bBtn.hidden = !isBoutique;
    if (isBoutique) {
      const added = boutiqueSet().has(item.asin);
      bBtn.textContent = added ? t('addedBoutique') : t('addBoutique');
      bBtn.classList.toggle('is-added', added);
      bBtn.onclick = () => toggleBoutique(item);
      $('btn-open-live').textContent = t('openLiveShort');
      $('btn-open-live').style.flex = '1';
    } else {
      $('btn-open-live').textContent = t('openLiveBtn');
      $('btn-open-live').style.flex = '';
    }
  }

  function updateFooterControls() {
    const modeNow = sopMode();
    const isDist = modeNow === 'distribution';
    const canCollect = Boolean(payload?.sellerstar_enabled);
    const boutiqueCount = (payload?.sop?.boutique?.items || []).length;

    $('m-boutique').className = 'sop-mode-btn' + (modeNow === 'boutique' ? ' active is-boutique' : '');
    $('m-distribution').className = 'sop-mode-btn' + (isDist ? ' active' : '');

    $('scope-pills').hidden = !(isDist && canCollect);
    $('scope-all').classList.toggle('active', collectionMode === 'all_variants');
    $('scope-main').classList.toggle('active', collectionMode === 'main_only');

    $('btn-select-eligible').hidden = !(isDist && canCollect);
    $('btn-select-eligible').textContent = t('selectSafe');

    const collectBtn = $('btn-collect-selected');
    collectBtn.hidden = !(isDist && canCollect);
    const connected = payload?.result?.account?.status === 'connected';
    collectBtn.disabled = !selected.size || !connected || Boolean(payload?.paused);
    collectBtn.textContent = t('collectSelected', selected.size);

    $('btn-open-sellerstar').hidden = !(isDist && canCollect && (justQueued || connected));

    const bOpen = $('btn-open-boutique');
    bOpen.hidden = isDist;
    bOpen.textContent = t('openBoutique', boutiqueCount);
  }

  function render() {
    if (!payload) return;
    document.documentElement.dataset.theme = payload.theme === 'light' ? 'light' : 'dark';
    if (payload.locale && I18N[payload.locale] && payload.locale !== locale) {
      locale = payload.locale;
      applyStatic();
    }
    if (payload.sop?.distribution?.collection_mode) {
      collectionMode = payload.sop.distribution.collection_mode;
    }

    const modeNow = sopMode();
    if (lastRenderedMode !== modeNow) {
      lastRenderedMode = modeNow;
      setFooter(modeNow === 'boutique' ? t('defaultFooterBoutique') : t('defaultFooterDist'));
    }
    const isDist = modeNow === 'distribution';
    const res = payload.result || {};
    const all = itemsList();
    const safeCount = all.filter(i => i.distribution_safe).length;
    const dupCount = all.filter(i => i.already_collected).length;
    const eligibleCount = all.filter(i => i.decision === 'eligible').length;
    const evidenceCount = all.length - eligibleCount;

    $('dm-keyword-pill').textContent = res.plan?.keyword || 'Amazon US';
    $('dm-summary').textContent = t('summary', res.observed_count ?? all.length, all.length, res.excluded_count ?? 0, isDist ? safeCount : null, isDist ? dupCount : 0);
    $('f-safe').hidden = !isDist;
    if (!isDist && filter === 'safe') setFilter('all');
    $('c-all').textContent = String(all.length);
    $('c-safe').textContent = String(safeCount);
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
    const bSet = boutiqueSet();

    grid.replaceChildren(...visible.map(item => {
      const data = item.data ?? {};
      const risks = Array.isArray(item.risk_flags) ? item.risk_flags : [];
      const card = document.createElement('article');
      card.className = 'product-card'
        + (item.asin === activeAsin ? ' is-selected' : '')
        + (isDist && item.already_collected ? ' is-muted' : '');
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

      if (isDist && canCollect) {
        const pickWrap = document.createElement('label');
        pickWrap.className = 'card-pick';
        pickWrap.onclick = e => e.stopPropagation();
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = selected.has(item.asin);
        cb.onchange = () => {
          if (cb.checked) selected.add(item.asin);
          else selected.delete(item.asin);
          updateFooterControls();
        };
        pickWrap.append(cb);
        thumbWrap.append(pickWrap);
      } else if (!isDist) {
        const pickBtn = document.createElement('button');
        pickBtn.type = 'button';
        const added = bSet.has(item.asin);
        pickBtn.className = 'card-boutique-pill' + (added ? ' is-added' : '');
        pickBtn.textContent = added ? t('cardAddedBoutique') : t('cardAddBoutique');
        pickBtn.onclick = e => { e.stopPropagation(); toggleBoutique(item); };
        thumbWrap.append(pickBtn);
      }

      if (item.already_collected || risks.length) {
        const guardRow = document.createElement('div');
        guardRow.className = 'card-guard-row';
        if (item.already_collected) {
          const d = document.createElement('span');
          d.className = 'guard-pill guard-dup';
          d.textContent = t('dupBadge');
          guardRow.append(d);
        }
        if (risks.length) {
          const r = document.createElement('span');
          r.className = 'guard-pill guard-risk';
          r.textContent = t('riskBadge');
          r.title = risks.map(x => x.label).join(' · ');
          guardRow.append(r);
        }
        thumbWrap.append(guardRow);
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
    updateFooterControls();
  }

  async function openLiveUrl(url) {
    try { await cmd('discovery-modal-open-url', { url, close_modal: true }); }
    catch (err) { setFooter(err?.message || String(err), 'err'); }
  }

  async function exportReport(format) {
    if (!payload?.result?.items?.length) return;
    try {
      const exported = await cmd('discovery-export', { format, result: payload.result });
      if (exported?.path) setFooter(t('exported', exported.path), 'ok');
    } catch (err) { setFooter(err?.message || String(err), 'err'); }
  }

  function setFilter(next) {
    filter = next;
    for (const [id, name] of [['f-all', 'all'], ['f-safe', 'safe'], ['f-eligible', 'eligible'], ['f-evidence', 'evidence']]) {
      $(id).classList.toggle('active', name === next);
    }
    render();
  }

  $('m-boutique').onclick = async () => {
    const sop = await cmd('sop-set-mode', { mode: 'boutique' });
    if (payload) payload.sop = sop;
    setFooter(t('defaultFooterBoutique'));
    render();
  };
  $('m-distribution').onclick = async () => {
    const sop = await cmd('sop-set-mode', { mode: 'distribution' });
    if (payload) payload.sop = sop;
    setFooter(t('defaultFooterDist'));
    render();
  };

  $('f-all').onclick = () => setFilter('all');
  $('f-safe').onclick = () => setFilter('safe');
  $('f-eligible').onclick = () => setFilter('eligible');
  $('f-evidence').onclick = () => setFilter('evidence');
  $('btn-csv').onclick = () => exportReport('csv');
  $('btn-json').onclick = () => exportReport('json');

  $('scope-all').onclick = async () => {
    collectionMode = 'all_variants';
    const sop = await cmd('sop-update-rules', { collection_mode: 'all_variants' });
    if (payload) payload.sop = sop;
    updateFooterControls();
  };
  $('scope-main').onclick = async () => {
    collectionMode = 'main_only';
    const sop = await cmd('sop-update-rules', { collection_mode: 'main_only' });
    if (payload) payload.sop = sop;
    updateFooterControls();
  };

  $('btn-select-eligible').onclick = () => {
    selected.clear();
    for (const item of itemsList()) {
      if (item.distribution_safe) selected.add(item.asin);
    }
    render();
  };

  $('btn-collect-selected').onclick = async () => {
    const chosen = itemsList().filter(row => selected.has(row.asin));
    if (!chosen.length || !payload?.result?.account?.tenant_id) return;
    try {
      const job = await cmd('sellerstar-batch-start', {
        tenant_id: payload.result.account.tenant_id,
        links: chosen.map(r => r.url),
        collection_mode: collectionMode,
      });
      if (job) {
        justQueued = true;
        selected.clear();
        setFooter(t('collectStarted', chosen.length), 'ok');
        render();
      }
    } catch (err) {
      setFooter(err?.message || String(err), 'err');
    }
  };

  $('btn-open-sellerstar').onclick = () => cmd('sop-open-sellerstar');
  $('btn-open-boutique').onclick = () => cmd('sop-open-boutique-workbench');

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
    setFooter(sopMode() === 'boutique' ? t('defaultFooterBoutique') : t('defaultFooterDist'));
    render();
  });
})();
