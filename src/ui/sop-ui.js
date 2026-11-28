function bindSopStudio($, command) {
  let state = null;
  let busyTeardown = false;
  let busySafeSell = false;
  let busySellerLens = false;
  let busy1688 = false;
  let lastSavedTimer = null;

  const isEn = () => (state?.locale || 'zh-CN') === 'en';
  const hasSellerStar = () => Array.isArray(state?.enabled_panels) && state.enabled_panels.includes('sellerstar-batch');
  const sop = () => state?.sop || { mode: hasSellerStar() ? 'distribution' : 'boutique', distribution: {}, boutique: { items: [] } };

  const BOUTIQUE_STEPS = [
    { zh: '① 赛道初筛', en: '1. Screen', target: () => document.querySelector('#product-discovery .composer-card') },
    { zh: '② SellerLens分析', en: '2. SellerLens', target: () => $('bt-step-2') || $('boutique-sop-card') },
    { zh: '③ 侵权全查', en: '3. SafeSellAI IP', target: () => $('bt-step-3') || $('boutique-sop-card') },
    { zh: '④ 1688寻源', en: '4. 1688 Source', target: () => $('bt-step-4') || $('boutique-sop-card') },
    { zh: '⑤ 立项包', en: '5. Brief', target: () => $('bt-step-5') || $('boutique-sop-card') },
  ];
  const DIST_STEPS = [
    { zh: '① 批量扫品', en: '1. Scan', target: () => document.querySelector('#product-discovery .composer-card') },
    { zh: '② 查重风控', en: '2. Guardrails', target: () => $('distribution-sop-card') },
    { zh: '③ 画廊勾选', en: '3. Gallery', target: () => $('discovery-ranked') || $('distribution-sop-card') },
    { zh: '④ 入塞星上架', en: '4. Push ERP', target: () => $('distribution-sop-card') },
  ];

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

  function jumpToStep(stepDef) {
    const target = stepDef.target?.();
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      target.classList.add('step-flash');
      setTimeout(() => target.classList.remove('step-flash'), 900);
    }
  }

  function renderStepper(mode, activeStepIndex) {
    const el = $('sop-stepper');
    if (!el) return;
    const defs = mode === 'boutique' ? BOUTIQUE_STEPS : DIST_STEPS;
    el.replaceChildren(...defs.map((def, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sop-step' + (idx < activeStepIndex ? ' is-done' : idx === activeStepIndex ? ' is-now' : '');
      btn.textContent = isEn() ? def.en : def.zh;
      btn.title = isEn() ? 'Click to jump to this step' : '点击直达此步骤';
      btn.onclick = () => jumpToStep(def);
      return btn;
    }));
  }

  function calcActiveBoutiqueStep(item) {
    if (!item) return 0;
    if (!item.sellerlens && (!item.teardown || item.teardown.status !== 'ok')) return 1;
    if (!item.compliance || item.compliance.status === 'pending') return 2;
    if (!item.sourcing_handoff && !(Number(item.profit?.cost_cny) > 0)) return 3;
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

  const DIM_LABELS = {
    trademark_text: '商标+TRO',
    utility_patent: '发明专利',
    design_patent: '外观专利',
    copyright: '版权图库',
    trademark_vision: '图形商标',
  };

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
        rm.onclick = e => { e.stopPropagation(); command('sop-boutique-remove', { asin: item.asin }); };
        pill.append(code, rm);
        return pill;
      }));
    }

    $('boutique-empty').hidden = Boolean(active);
    $('boutique-detail').hidden = !active;
    if (!active) return;

    const setMsg = text => { if ($('bt-status-msg')) $('bt-status-msg').textContent = text; };

    // Header
    const thumb = $('bt-active-img');
    if (active.image) { thumb.src = active.image; thumb.hidden = false; }
    else { thumb.hidden = true; }
    $('bt-active-title').textContent = active.title || active.asin;
    $('bt-active-meta').textContent = `${active.asin}${active.price != null ? ' · $' + Number(active.price).toFixed(2) : ''}${active.rating != null ? ' · ★' + active.rating : ''}`;
    $('bt-open-url').onclick = () => command('new', { url: active.url });

    // Step 2: SellerLens Market Analysis (primary) + lightweight page reader
    const slBtn = $('bt-run-sellerlens');
    if (slBtn) {
      slBtn.disabled = busySellerLens;
      slBtn.textContent = busySellerLens
        ? (isEn() ? 'Calling SellerLens…' : '正在调用 SellerLens 引擎…')
        : active.sellerlens
          ? (isEn() ? '↻ Refresh SellerLens Analysis' : '↻ 重新调用 SellerLens 分析')
          : (isEn() ? '🔍 Run SellerLens Market Analysis' : '🔍 调用 SellerLens 市场评分 & 趋势');
      slBtn.onclick = async () => {
        if (busySellerLens) return;
        busySellerLens = true;
        renderBoutiqueCard();
        setMsg('正在连接 SellerLens（市场评分 + ABA/趋势）…');
        try {
          const res = await command('sop-sellerlens-analyze', { asin: active.asin });
          if (res?.sellerlens) setMsg(`✓ SellerLens 分析完成（来源：${res.sellerlens.source}）。`);
        } finally {
          busySellerLens = false;
          renderBoutiqueCard();
        }
      };
    }

    const slBox = $('bt-sellerlens-result');
    const sl = active.sellerlens;
    if (slBox && sl) {
      slBox.hidden = false;
      const v = String(sl.ai_verdict || sl.tier || '已分析').toUpperCase();
      const vEl = $('bt-sl-verdict');
      vEl.textContent = v;
      vEl.className = 'hub-badge ' + (/GO|A|S/.test(v) && !/NO/.test(v) ? 'is-ok' : /NO|D|REJECT/.test(v) ? 'is-bad' : 'is-warn');
      $('bt-sl-score').textContent = [
        sl.composite_score != null ? `评分 ${sl.composite_score}` : null,
        sl.tier ? `Tier ${sl.tier}` : null,
        sl.aba_rank ? `ABA #${sl.aba_rank}` : null,
      ].filter(Boolean).join(' · ');
      $('bt-sl-headline').textContent = sl.ai_headline || sl.profit_gate_reason || '';
      const slOpen = $('bt-sl-open');
      if (slOpen) {
        slOpen.hidden = !sl.portal_url;
        slOpen.onclick = () => command('new', { url: sl.portal_url });
      }
      const tags = [sl.trend_label, ...(sl.risk_flags || []).slice(0, 3)].filter(Boolean);
      $('bt-sl-tags').replaceChildren(...tags.map(txt => Object.assign(document.createElement('span'), { className: 'bt-pain-tag', textContent: txt })));
    } else if (slBox) {
      slBox.hidden = true;
    }

    const tdBtn = $('bt-run-teardown');
    if (tdBtn) {
      tdBtn.disabled = busyTeardown || Boolean(state?.paused);
      tdBtn.textContent = busyTeardown ? '读取中…' : (active.teardown?.status === 'ok' ? '↻ 重读本页' : '读取本页基础信息');
      tdBtn.onclick = async () => {
        if (busyTeardown) return;
        busyTeardown = true;
        renderBoutiqueCard();
        try {
          const res = await command('sop-boutique-teardown', { asin: active.asin });
          setMsg(res?.teardown?.status === 'ok' ? '✓ 已读取商品详情、变体数及视频信号。' : '未能读取页面，请先打开商品页检查。');
        } finally {
          busyTeardown = false;
          renderBoutiqueCard();
        }
      };
    }

    const tdBox = $('bt-teardown-result');
    const td = active.teardown;
    if (tdBox && td && td.status === 'ok') {
      tdBox.hidden = false;
      $('bt-td-facts').textContent = [td.brand ? `品牌: ${td.brand}` : null, `变体: ${td.variant_count || 1}`, td.has_video ? '🎬 含主图视频' : '无主图视频'].filter(Boolean).join(' · ');
      const pains = td.pain_points?.themes || [];
      $('bt-td-pains').replaceChildren(...pains.map(p => Object.assign(document.createElement('span'), { className: 'bt-pain-tag', textContent: `${p.label} (${p.hits})` })));
      $('bt-td-bullets').replaceChildren(...(td.bullets || []).slice(0, 5).map(b => Object.assign(document.createElement('li'), { textContent: b })));
    } else if (tdBox) {
      tdBox.hidden = true;
    }

    // Step 3: SafeSellAI Patent / Trademark / Copyright Full Check
    const ipBtn = $('bt-run-safesell');
    if (ipBtn) {
      ipBtn.disabled = busySafeSell;
      ipBtn.textContent = busySafeSell
        ? (isEn() ? 'Scanning via SafeSellAI…' : '🛡️ SafeSellAI 侵权全查中（含图搜约 6–15s）…')
        : active.ip_report
          ? (isEn() ? '↻ Re-run SafeSellAI IP Check' : '🛡️ 重新调用 SafeSellAI 侵权全查')
          : (isEn() ? '🛡️ Run SafeSellAI IP Full Check' : '🛡️ 一键 SafeSellAI 专利/商标/版权全查');
      ipBtn.onclick = async () => {
        if (busySafeSell) return;
        const dims = {
          text: $('ip-dim-text') ? $('ip-dim-text').checked : true,
          design: $('ip-dim-design') ? $('ip-dim-design').checked : true,
          copyright: $('ip-dim-copyright') ? $('ip-dim-copyright').checked : true,
          vision: $('ip-dim-vision') ? $('ip-dim-vision').checked : true,
        };
        busySafeSell = true;
        renderBoutiqueCard();
        setMsg('正在调用 SafeSellAI 引擎排查商标/TRO/外观专利/版权…');
        try {
          const res = await command('sop-ip-check', { asin: active.asin, dims });
          if (res?.report) {
            setMsg(`✓ SafeSellAI 全查完成：${res.report.verdict}${res.report.charged_scoin ? `（消耗 ${res.report.charged_scoin} S算力）` : ''}。`);
          }
        } finally {
          busySafeSell = false;
          renderBoutiqueCard();
        }
      };
    }

    const ipBox = $('bt-safesell-result');
    const ip = active.ip_report;
    if (ipBox && ip) {
      ipBox.hidden = false;
      const vEl = $('bt-ip-verdict');
      vEl.textContent = ip.verdict || '—';
      vEl.className = 'hub-badge ' + (ip.verdict === '可上' ? 'is-ok' : ip.verdict === '命中风险' ? 'is-bad' : 'is-warn');
      $('bt-ip-source').textContent = (ip.source === 'safesellai_mcp' ? 'SafeSellAI MCP' : '塞星·SafeSellAI')
        + (ip.charged_scoin ? ` · ${ip.charged_scoin} S` : '');

      const dimPills = Object.entries(ip.dims || {}).map(([k, v]) => {
        const span = document.createElement('span');
        const ok = v.scanned && !v.hit_count;
        const bad = v.scanned && v.hit_count > 0;
        span.className = 'ip-dim-pill ' + (bad ? 'is-bad' : ok ? 'is-ok' : 'is-unscanned');
        span.textContent = `${DIM_LABELS[k] || k}: ${!v.scanned ? '未查成' : v.hit_count > 0 ? `${v.hit_count}命中` : '未命中'}`;
        return span;
      });
      $('bt-ip-dim-pills').replaceChildren(...dimPills);

      const hitNodes = [];
      for (const h of (ip.hits || []).slice(0, 5)) {
        const div = document.createElement('div');
        div.className = 'hub-hit-row' + (h.isTro ? ' is-tro' : '');
        div.textContent = `${h.isTro ? '🚨 TRO ' : '⚠ '}${h.word} · ${h.risk || h.reason || ''}`;
        hitNodes.push(div);
      }
      for (const r of (ip.refs || []).slice(0, 5)) {
        const div = document.createElement('div');
        div.className = 'hub-hit-row';
        div.textContent = `[${r.dim}] ${r.label}${r.owner ? ' · ' + r.owner : ''}${r.similarity ? ' (' + Math.round(r.similarity * 100) + '%)' : ''}`;
        hitNodes.push(div);
      }
      $('bt-ip-hits').replaceChildren(...hitNodes);
      $('bt-ip-caveat').textContent = ip.caveat || '';
    } else if (ipBox) {
      ipBox.hidden = true;
    }

    // Manual override compliance controls
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
    const checksWrap = $('bt-ip-checks');
    if (checksWrap) {
      checksWrap.replaceChildren(...['商标', '外观专利', '版权', '图形商标'].map(label => {
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

    // Step 4: 1688 Sourcing Handoff (reuse SellerStar / 1688 Skill / MCP)
    const handoffBtn = $('bt-handoff-1688');
    if (handoffBtn) {
      handoffBtn.disabled = busy1688;
      handoffBtn.onclick = async () => {
        if (busy1688) return;
        busy1688 = true;
        handoffBtn.disabled = true;
        setMsg('正在推送至塞星 1688 以图找货工作台…');
        try {
          const res = await command('sop-1688-handoff', { asin: active.asin, mode: 'portal' });
          if (res?.portal_url) setMsg(`✓ 已创建塞星 1688 找货任务并打开：${res.portal_url}`);
          else if (res?.copied) setMsg('✓ ' + (res.message || '已复制 1688 Skill 找货指令。'));
          else if (res?.source === '1688_mcp') setMsg(`✓ 已通过 1688 MCP (${res.tool}) 返回货源结果。`);
        } finally {
          busy1688 = false;
          handoffBtn.disabled = false;
        }
      };
    }
    const copyAgentBtn = $('bt-copy-1688-agent');
    if (copyAgentBtn) {
      copyAgentBtn.onclick = async () => {
        const res = await command('sop-1688-handoff', { asin: active.asin, mode: 'agent_prompt' });
        if (res?.copied) setMsg('✓ 已复制 1688-product-find Skill 找货指令，直接粘贴给 Claude Code / Codex 即可找同款比价。');
      };
    }
    const hNote = $('bt-1688-handoff-note');
    if (hNote) {
      if (active.sourcing_handoff?.portal_url) {
        hNote.hidden = false;
        hNote.textContent = '✓ 已推送塞星 1688 工作台：' + active.sourcing_handoff.portal_url;
      } else {
        hNote.hidden = true;
      }
    }

    // Quick profit calculator
    const profit = active.profit || {};
    const calc = active.profit_calc || {};
    const fields = ['sale_price_usd', 'cost_cny', 'weight_kg', 'shipping_per_kg_cny', 'fba_fee_usd', 'acos_pct'];
    for (const field of fields) {
      const input = document.querySelector(`#bt-profit-grid input[data-pfield="${field}"]`);
      if (!input) continue;
      if (document.activeElement !== input) input.value = profit[field] ?? '';
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
    if (comp.status === 'rejected') { verdictEl.textContent = '❌ 侵权驳回'; verdictEl.className = 'bt-verdict is-bad'; }
    else if (calc.verdict === 'go' && comp.status === 'passed') { verdictEl.textContent = '✅ 建议立项'; verdictEl.className = 'bt-verdict is-go'; }
    else if (calc.verdict === 'go') { verdictEl.textContent = '🟡 利润达标'; verdictEl.className = 'bt-verdict is-warn'; }
    else if (calc.verdict === 'caution') { verdictEl.textContent = '🟠 谨慎评估'; verdictEl.className = 'bt-verdict is-warn'; }
    else if (calc.verdict === 'no_go') { verdictEl.textContent = '🔴 利润不足'; verdictEl.className = 'bt-verdict is-bad'; }
    else { verdictEl.textContent = '待测算'; verdictEl.className = 'bt-verdict'; }

    const diffInput = $('bt-diff-note');
    if (diffInput) {
      if (document.activeElement !== diffInput) diffInput.value = active.diff_note || '';
      diffInput.oninput = () => scheduleBoutiquePatch(active.asin, { diff_note: diffInput.value });
    }
  }

  // Bind top business mode switcher & Hub opener
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
  if ($('bt-open-hub')) $('bt-open-hub').onclick = () => command('mcp-connector-open', { tab: 'hub' });

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
      if ($('discovery-message')) $('discovery-message').textContent = '✓ 已保存自定义铺货屏蔽词库。';
    };
  }
  if ($('dist-scope-all')) $('dist-scope-all').onclick = () => command('sop-update-rules', { collection_mode: 'all_variants' });
  if ($('dist-scope-main')) $('dist-scope-main').onclick = () => command('sop-update-rules', { collection_mode: 'main_only' });
  if ($('dist-quick-page')) $('dist-quick-page').onclick = () => { if ($('batch-toggle')) $('batch-toggle').click(); if ($('batch-from-page')) $('batch-from-page').click(); };
  if ($('dist-quick-tabs')) $('dist-quick-tabs').onclick = () => { if ($('batch-toggle')) $('batch-toggle').click(); if ($('batch-from-tabs')) $('batch-from-tabs').click(); };
  if ($('dist-open-ss')) $('dist-open-ss').onclick = () => command('sop-open-sellerstar');
  if ($('dist-live-open-ss')) $('dist-live-open-ss').onclick = () => command('sop-open-sellerstar');

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
