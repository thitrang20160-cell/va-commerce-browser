function bindSopStudio($, command) {
  let state = null;
  let busyTeardown = false;
  let busy1688 = false;
  let lastSavedTimer = null;

  const isEn = () => (state?.locale || 'zh-CN') === 'en';
  const hasSellerStar = () => Array.isArray(state?.enabled_panels) && state.enabled_panels.includes('sellerstar-batch');
  const sop = () => state?.sop || { mode: hasSellerStar() ? 'distribution' : 'boutique', distribution: {}, boutique: { items: [] } };

  const BOUTIQUE_STEPS_ZH = ['① 赛道初筛', '② 竞品拆解', '③ 侵权闸门', '④ 1688利润', '⑤ 立项包'];
  const BOUTIQUE_STEPS_EN = ['1. Screen', '2. Teardown', '3. IP Gate', '4. Profit', '5. Brief'];
  const DIST_STEPS_ZH = ['① 批量扫品', '② 查重风控', '③ 画廊勾选', '④ 入塞星上架'];
  const DIST_STEPS_EN = ['1. Scan', '2. Guardrails', '3. Gallery', '4. Push Box'];

  const BOUTIQUE_PRESETS_ZH = [
    { label: '厨房微创新 $20–45', prompt: '厨房硅胶防漏垫，售价 $20-45，FBA，评论小于 1500', kw: 'silicone under sink mat' },
    { label: '衣柜收纳痛点 $25–55', prompt: '家居衣柜收纳盒，售价 $25-55，FBA 平台仓，利润优先', kw: 'closet storage bins' },
    { label: '宠物高复购 $18–40', prompt: '宠物饮水机滤芯，售价 $18-40，FBA，评分高', kw: 'pet water fountain filters' },
  ];
  const DIST_PRESETS_ZH = [
    { label: '热销家居 $15–35', prompt: '厨房硅胶防漏垫，售价 $15-35，FBA 平台仓', kw: 'silicone under sink mat' },
    { label: '高频收纳 $18–40', prompt: '抽屉分隔收纳，售价 $18-40，FBA', kw: 'drawer organizer dividers' },
    { label: '车载配件 $15–35', prompt: '车载收纳配件，售价 $15-35，FBA', kw: 'car seat gap filler organizer' },
  ];

  function renderStepper(mode, activeStepIndex) {
    const el = $('sop-stepper');
    if (!el) return;
    const labels = mode === 'boutique'
      ? (isEn() ? BOUTIQUE_STEPS_EN : BOUTIQUE_STEPS_ZH)
      : (isEn() ? DIST_STEPS_EN : DIST_STEPS_ZH);
    el.replaceChildren(...labels.map((text, idx) => {
      const chip = document.createElement('span');
      chip.className = 'sop-step' + (idx < activeStepIndex ? ' is-done' : idx === activeStepIndex ? ' is-now' : '');
      chip.textContent = text;
      return chip;
    }));
  }

  function calcActiveBoutiqueStep(item) {
    if (!item) return 0;
    if (!item.teardown || item.teardown.status !== 'ok') return 1;
    if (!item.compliance || item.compliance.status === 'pending') return 2;
    if (!item.profit || !(Number(item.profit.cost_cny) > 0)) return 3;
    return 4;
  }

  function calcActiveDistStep() {
    const batch = state?.sellerstar_batch;
    if (batch && ['running', 'paused', 'completed'].includes(batch.phase)) return 3;
    const rankedVisible = $('discovery-ranked') && !$('discovery-ranked').hidden;
    if (rankedVisible) return 2;
    return 0;
  }

  function updatePresets(mode) {
    const wrap = $('discovery-presets');
    if (!wrap || wrap.dataset.sopMode === mode || isEn()) return;
    wrap.dataset.sopMode = mode;
    const list = mode === 'boutique' ? BOUTIQUE_PRESETS_ZH : DIST_PRESETS_ZH;
    wrap.replaceChildren(...list.map(p => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'preset-chip';
      btn.textContent = p.label;
      btn.onclick = () => {
        if ($('discovery-intent')) { $('discovery-intent').value = p.prompt; $('discovery-intent').focus(); }
        if ($('discovery-keyword')) $('discovery-keyword').value = p.kw;
      };
      return btn;
    }));
  }

  function renderDistributionCard() {
    const card = $('distribution-sop-card');
    if (!card) return;
    const cur = sop();
    const isDist = cur.mode === 'distribution';
    card.hidden = !isDist;
    if (!isDist) return;

    const ssEnabled = hasSellerStar();
    if ($('dist-ss-actions')) $('dist-ss-actions').hidden = !ssEnabled;

    const rules = cur.distribution || {};
    if ($('dist-skip-collected')) $('dist-skip-collected').checked = rules.skip_collected !== false;
    if ($('dist-block-brands')) $('dist-block-brands').checked = rules.block_known_brands !== false;
    if ($('dist-block-restricted')) $('dist-block-restricted').checked = rules.block_restricted !== false;

    const blockInput = $('dist-custom-blocklist');
    if (blockInput && document.activeElement !== blockInput) {
      blockInput.value = (rules.custom_blocklist || []).join(', ');
    }

    const scopeMode = rules.collection_mode || 'all_variants';
    if ($('dist-scope-all')) $('dist-scope-all').classList.toggle('active', scopeMode === 'all_variants');
    if ($('dist-scope-main')) $('dist-scope-main').classList.toggle('active', scopeMode === 'main_only');

    const statusBox = $('dist-batch-live');
    const batch = state?.sellerstar_batch;
    if (statusBox) {
      if (ssEnabled && batch) {
        const done = (batch.counts?.saved || 0) + (batch.counts?.already_collected || 0);
        const total = batch.items?.length || 0;
        const failed = batch.counts?.failed || 0;
        statusBox.hidden = false;
        $('dist-batch-text').textContent =
          batch.phase === 'running' ? `正在后台入塞星：${done}/${total}（失败 ${failed}）`
            : batch.phase === 'paused' ? `塞星采集已暂停：${done}/${total}（请处理验证或恢复）`
              : `最近批次完成：新增 ${batch.counts?.saved || 0} · 已有 ${batch.counts?.already_collected || 0} · 失败 ${failed}`;
      } else {
        statusBox.hidden = true;
      }
    }
  }

  function scheduleBoutiquePatch(asin, patch) {
    clearTimeout(lastSavedTimer);
    lastSavedTimer = setTimeout(() => {
      command('sop-boutique-update', { asin, patch });
    }, 280);
  }

  function renderBoutiqueCard() {
    const card = $('boutique-sop-card');
    if (!card) return;
    const cur = sop();
    const isBoutique = cur.mode === 'boutique';
    card.hidden = !isBoutique;
    if (!isBoutique) return;

    const items = cur.boutique?.items || [];
    const activeAsin = cur.boutique?.active_asin || items[0]?.asin || null;
    const active = items.find(i => i.asin === activeAsin) || null;

    if ($('boutique-count')) $('boutique-count').textContent = String(items.length);
    if ($('boutique-export-btn')) $('boutique-export-btn').disabled = !items.length;

    const tabsEl = $('boutique-shortlist');
    if (tabsEl) {
      tabsEl.replaceChildren(...items.map(item => {
        const pill = document.createElement('div');
        pill.className = 'bt-pill' + (item.asin === activeAsin ? ' active' : '');
        pill.onclick = () => command('sop-boutique-select', { asin: item.asin });
        if (item.image) {
          const img = document.createElement('img');
          img.src = item.image;
          img.alt = '';
          img.className = 'bt-pill-img';
          img.onerror = () => img.remove();
          pill.append(img);
        }
        const code = document.createElement('span');
        code.className = 'bt-pill-asin';
        code.textContent = item.asin.slice(-6);
        code.title = item.asin + ' · ' + item.title;
        const rm = document.createElement('button');
        rm.type = 'button';
        rm.className = 'bt-pill-rm';
        rm.textContent = '×';
        rm.title = isEn() ? 'Remove' : '移出立项单';
        rm.onclick = e => { e.stopPropagation(); command('sop-boutique-remove', { asin: item.asin }); };
        pill.append(code, rm);
        return pill;
      }));
    }

    $('boutique-empty').hidden = Boolean(active);
    $('boutique-detail').hidden = !active;
    if (!active) return;

    // Header
    const thumb = $('bt-active-img');
    if (active.image) { thumb.src = active.image; thumb.hidden = false; }
    else { thumb.hidden = true; }
    $('bt-active-title').textContent = active.title || active.asin;
    $('bt-active-meta').textContent = `${active.asin}${active.price != null ? ' · $' + Number(active.price).toFixed(2) : ''}${active.rating != null ? ' · ★' + active.rating : ''}`;
    $('bt-open-url').onclick = () => command('new', { url: active.url });

    // Step 2: Teardown
    const tdBtn = $('bt-run-teardown');
    tdBtn.disabled = busyTeardown || Boolean(state?.paused);
    tdBtn.textContent = busyTeardown
      ? (isEn() ? 'Analyzing…' : '后台拆解中…')
      : active.teardown?.status === 'ok'
        ? (isEn() ? '↻ Re-run Teardown' : '↻ 重新拆解竞品')
        : (isEn() ? '② Background Competitor Teardown' : '② 一键后台拆解（卖点+差评+视频）');
    tdBtn.onclick = async () => {
      if (busyTeardown) return;
      busyTeardown = true;
      renderBoutiqueCard();
      try {
        const res = await command('sop-boutique-teardown', { asin: active.asin });
        if (res?.teardown?.status && res.teardown.status !== 'ok') {
          $('bt-status-msg').textContent = res.teardown.status === 'verification_required'
            ? '亚马逊触发验证，请先点「打开商品页」人工过验证后重试。'
            : '未能读取详情页，请打开商品页检查。';
        } else {
          $('bt-status-msg').textContent = '✓ 竞品拆解完成：已提取卖点、变体、视频信号及中差评痛点。';
        }
      } finally {
        busyTeardown = false;
        renderBoutiqueCard();
      }
    };

    const tdBox = $('bt-teardown-result');
    const td = active.teardown;
    if (td && td.status === 'ok') {
      tdBox.hidden = false;
      $('bt-td-facts').textContent = [
        td.brand ? `品牌: ${td.brand}` : null,
        `变体: ${td.variant_count || 1}`,
        td.has_video ? '🎬 含主图视频' : '无主图视频',
      ].filter(Boolean).join(' · ');

      const pains = td.pain_points?.themes || [];
      const painEl = $('bt-td-pains');
      if (pains.length) {
        painEl.replaceChildren(...pains.map(p => {
          const span = document.createElement('span');
          span.className = 'bt-pain-tag';
          span.textContent = `${isEn() ? p.en : p.label} (${p.hits})`;
          return span;
        }));
      } else {
        painEl.replaceChildren(Object.assign(document.createElement('span'), {
          className: 'bt-muted-tag',
          textContent: isEn() ? 'No critical review keywords on main page' : '首屏未命中高频差评痛点词（可打开详情页翻看全部差评）',
        }));
      }

      const bList = $('bt-td-bullets');
      bList.replaceChildren(...(td.bullets || []).slice(0, 5).map(b => {
        const li = document.createElement('li');
        li.textContent = b;
        return li;
      }));
    } else {
      tdBox.hidden = true;
    }

    // Step 3: Compliance Gate
    const comp = active.compliance || { status: 'pending', checks: [], note: '' };
    for (const st of ['pending', 'passed', 'rejected']) {
      const btn = $('bt-ip-' + st);
      if (!btn) continue;
      btn.classList.toggle('active', comp.status === st);
      btn.onclick = () => command('sop-boutique-update', {
        asin: active.asin,
        patch: { compliance: { ...comp, status: st } },
      });
    }
    const checkList = ['商标', '外观专利', '类目认证'];
    const checksWrap = $('bt-ip-checks');
    if (checksWrap) {
      checksWrap.replaceChildren(...checkList.map(label => {
        const btn = document.createElement('button');
        btn.type = 'button';
        const on = (comp.checks || []).includes(label);
        btn.className = 'bt-check-chip' + (on ? ' active' : '');
        btn.textContent = (on ? '✓ ' : '+ ') + label;
        btn.onclick = () => {
          const next = on ? comp.checks.filter(x => x !== label) : [...(comp.checks || []), label];
          command('sop-boutique-update', { asin: active.asin, patch: { compliance: { ...comp, checks: next } } });
        };
        return btn;
      }));
    }

    // Step 4: 1688 Sourcing + Live Profit Calculator
    $('bt-jump-1688').onclick = () => command('sop-boutique-source-1688', { asin: active.asin });
    const read1688Btn = $('bt-read-1688');
    if (read1688Btn) {
      read1688Btn.hidden = !hasSellerStar();
      read1688Btn.disabled = busy1688;
      read1688Btn.onclick = async () => {
        busy1688 = true;
        read1688Btn.disabled = true;
        try {
          const res = await command('sop-boutique-read-1688-tab', { asin: active.asin });
          if (res?.status === 'ok') {
            $('bt-status-msg').textContent = `✓ 已读取 1688 报价 ¥${res.price_cny || '—'}${res.supplier ? ' · ' + res.supplier : ''}`;
          } else {
            $('bt-status-msg').textContent = '请先在浏览器打开一个 1688 商品详情页，再点读取报价。';
          }
        } finally {
          busy1688 = false;
          read1688Btn.disabled = false;
        }
      };
    }

    const profit = active.profit || {};
    const calc = active.profit_calc || {};
    const fields = ['sale_price_usd', 'cost_cny', 'weight_kg', 'shipping_per_kg_cny', 'fba_fee_usd', 'acos_pct'];
    for (const field of fields) {
      const input = document.querySelector(`#bt-profit-grid input[data-pfield="${field}"]`);
      if (!input) continue;
      if (document.activeElement !== input) {
        input.value = profit[field] ?? '';
      }
      input.oninput = () => {
        const nextProfit = { ...profit };
        for (const f of fields) {
          const el = document.querySelector(`#bt-profit-grid input[data-pfield="${f}"]`);
          if (el && el.value !== '') nextProfit[f] = Number(el.value);
        }
        scheduleBoutiquePatch(active.asin, { profit: nextProfit });
      };
    }

    const hasCost = Number(calc.cost_cny) > 0;
    $('bt-kpi-net').textContent = hasCost ? `$${Number(calc.net_profit_usd).toFixed(2)}` : '待填采购价';
    $('bt-kpi-margin').textContent = hasCost ? `${Number(calc.net_margin_pct).toFixed(1)}%` : '—';
    $('bt-kpi-acos').textContent = hasCost ? `${Number(calc.breakeven_acos_pct).toFixed(1)}%` : '—';
    const verdictEl = $('bt-kpi-verdict');
    if (comp.status === 'rejected') {
      verdictEl.textContent = '❌ 侵权驳回';
      verdictEl.className = 'bt-verdict is-bad';
    } else if (calc.verdict === 'go' && comp.status === 'passed') {
      verdictEl.textContent = '✅ 建议立项';
      verdictEl.className = 'bt-verdict is-go';
    } else if (calc.verdict === 'go') {
      verdictEl.textContent = '🟡 利润达标';
      verdictEl.className = 'bt-verdict is-warn';
    } else if (calc.verdict === 'caution') {
      verdictEl.textContent = '🟠 谨慎评估';
      verdictEl.className = 'bt-verdict is-warn';
    } else if (calc.verdict === 'no_go') {
      verdictEl.textContent = '🔴 利润不足';
      verdictEl.className = 'bt-verdict is-bad';
    } else {
      verdictEl.textContent = '待测算';
      verdictEl.className = 'bt-verdict';
    }

    const diffInput = $('bt-diff-note');
    if (diffInput) {
      if (document.activeElement !== diffInput) diffInput.value = active.diff_note || '';
      diffInput.oninput = () => scheduleBoutiquePatch(active.asin, { diff_note: diffInput.value });
    }
  }

  // Bind top business mode switcher
  if ($('sop-mode-boutique')) {
    $('sop-mode-boutique').onclick = async () => {
      await command('sop-set-mode', { mode: 'boutique' });
      if (typeof window.switchStudio === 'function') window.switchStudio('discovery');
    };
  }
  if ($('sop-mode-distribution')) {
    $('sop-mode-distribution').onclick = async () => {
      await command('sop-set-mode', { mode: 'distribution' });
      if (typeof window.switchStudio === 'function') window.switchStudio('discovery');
    };
  }

  // Bind distribution controls
  for (const [id, key] of [
    ['dist-skip-collected', 'skip_collected'],
    ['dist-block-brands', 'block_known_brands'],
    ['dist-block-restricted', 'block_restricted'],
  ]) {
    if ($(id)) $(id).onchange = () => command('sop-update-rules', { [key]: $(id).checked });
  }
  if ($('dist-save-blocklist')) {
    $('dist-save-blocklist').onclick = async () => {
      await command('sop-update-rules', { custom_blocklist: $('dist-custom-blocklist')?.value || '' });
      if ($('discovery-message')) $('discovery-message').textContent = '✓ 已保存自定义铺货屏蔽词库（重新发掘或打开画廊立即生效）。';
    };
  }
  if ($('dist-scope-all')) $('dist-scope-all').onclick = () => command('sop-update-rules', { collection_mode: 'all_variants' });
  if ($('dist-scope-main')) $('dist-scope-main').onclick = () => command('sop-update-rules', { collection_mode: 'main_only' });
  if ($('dist-quick-page')) $('dist-quick-page').onclick = () => { if ($('batch-toggle')) $('batch-toggle').click(); if ($('batch-from-page')) $('batch-from-page').click(); };
  if ($('dist-quick-tabs')) $('dist-quick-tabs').onclick = () => { if ($('batch-toggle')) $('batch-toggle').click(); if ($('batch-from-tabs')) $('batch-from-tabs').click(); };
  if ($('dist-open-ss')) $('dist-open-ss').onclick = () => command('sop-open-sellerstar');
  if ($('dist-live-open-ss')) $('dist-live-open-ss').onclick = () => command('sop-open-sellerstar');

  // Bind Boutique brief export
  if ($('boutique-export-btn')) {
    $('boutique-export-btn').onclick = async () => {
      const res = await command('sop-boutique-export-brief');
      if (res?.path && $('bt-status-msg')) {
        $('bt-status-msg').textContent = `✓ 已导出精品立项评审包（${res.count} 款）：${res.path}`;
      }
    };
  }

  return function updateSop(nextState) {
    state = nextState;
    const cur = sop();
    const mode = cur.mode === 'boutique' ? 'boutique' : 'distribution';
    document.documentElement.dataset.sopMode = mode;

    if ($('sop-mode-boutique')) $('sop-mode-boutique').classList.toggle('active', mode === 'boutique');
    if ($('sop-mode-distribution')) $('sop-mode-distribution').classList.toggle('active', mode === 'distribution');

    const activeBoutique = (cur.boutique?.items || []).find(i => i.asin === cur.boutique?.active_asin) || cur.boutique?.items?.[0] || null;
    renderStepper(mode, mode === 'boutique' ? calcActiveBoutiqueStep(activeBoutique) : calcActiveDistStep());
    updatePresets(mode);
    renderDistributionCard();
    renderBoutiqueCard();

    if (nextState?._focus_view === 'boutique' && typeof window.switchStudio === 'function') {
      window.switchStudio('discovery');
      setTimeout(() => $('boutique-sop-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
    }
  };
}
