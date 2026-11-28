import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_BRAND_BLOCKLIST = [
  'apple', 'iphone', 'ipad', 'airpods', 'nike', 'adidas', 'disney', 'marvel', 'lego',
  'barbie', 'nintendo', 'pokemon', 'sony', 'playstation', 'xbox', 'dyson', 'stanley',
  'yeti', 'hydro flask', 'kitchenaid', 'ninja', 'shark', 'philips', 'braun', 'oxo',
  'simplehuman', 'coleman', 'crocs', 'birkenstock', 'samsung', 'anker', 'bose', 'jbl',
  'lego', 'hasbro', 'mattel', 'louis vuitton', 'gucci', 'chanel', 'hermes', 'rolex',
];

export const DEFAULT_RESTRICTED_TERMS = [
  'lithium', 'battery pack', 'aerosol', 'pesticide', 'insecticide', 'medical device',
  'prescription', 'fda approved', 'weapon', 'tactical knife', 'laser pointer',
  'magnetic balls', 'buckyballs', 'supplement', 'vitamins', 'cbd', 'hemp', 'flammable',
  'firework', 'alcohol', 'tobacco', 'vape',
];

const PAIN_POINT_PATTERNS = [
  { key: 'leak', label: '漏水 / 密封不严', en: 'Leaking / poor seal', re: /\b(leak|leaks|leaking|leaked|drip|dripping|seal|waterproof failed)\b/i },
  { key: 'thin', label: '材质偏薄 / 偏软', en: 'Thin / flimsy material', re: /\b(thin|flimsy|cheap material|too soft|tears easily|ripped|torn)\b/i },
  { key: 'size', label: '尺寸偏差 / 不贴合', en: 'Sizing / fit mismatch', re: /\b(too small|too big|doesn't fit|does not fit|didn't fit|wrong size|shrink|shrunk|curl|curled|wrinkle)\b/i },
  { key: 'smell', label: '气味刺鼻 / 异味', en: 'Strong odor / smell', re: /\b(smell|smells|odor|stink|chemical smell|rubber smell|plastic smell)\b/i },
  { key: 'durable', label: '易损坏 / 寿命短', en: 'Durability / breaks fast', re: /\b(broke|broken|cracked|stopped working|fell apart|peeling|rust|rusted|mold|mildew)\b/i },
  { key: 'slip', label: '易滑动 / 不防滑', en: 'Slips / lacks grip', re: /\b(slip|slips|slippery|slides around|won't stay|does not stick)\b/i },
  { key: 'clean', label: '难清洗 / 易染色', en: 'Hard to clean / stains', re: /\b(hard to clean|stain|stains|stained|discolor|yellowed|traps dirt)\b/i },
  { key: 'missing', label: '缺件 / 包装破损', en: 'Missing parts / packaging', re: /\b(missing part|missing piece|damaged box|bent|crease|creased|fold line)\b/i },
];

const num = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const round2 = v => Math.round(v * 100) / 100;

export function escapeRegex(text) {
  return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function normalizeCustomTerms(input) {
  const raw = Array.isArray(input) ? input : String(input || '').split(/[,，\n;；]+/);
  const out = [];
  const seen = new Set();
  for (const part of raw) {
    const clean = String(part || '').trim().slice(0, 60);
    const key = clean.toLowerCase();
    if (!clean || seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
    if (out.length >= 120) break;
  }
  return out;
}

export function analyzeItemRisk(item, rules = {}) {
  const haystack = [item?.title || '', item?.brand || ''].join(' ').trim();
  const flags = [];
  if (!haystack) return flags;
  const seen = new Set();

  const matchTerm = (term, kind) => {
    const clean = String(term || '').trim();
    if (!clean) return;
    const key = kind + ':' + clean.toLowerCase();
    if (seen.has(key)) return;
    const isAscii = /^[a-z0-9\s\-&']+$/i.test(clean);
    const re = isAscii
      ? new RegExp('(?:^|[^a-z0-9])' + escapeRegex(clean) + '(?:$|[^a-z0-9])', 'i')
      : new RegExp(escapeRegex(clean), 'i');
    if (re.test(haystack)) {
      seen.add(key);
      flags.push({
        kind,
        term: clean,
        label: kind === 'brand' ? `大牌词: ${clean}` : kind === 'custom' ? `自定义屏蔽: ${clean}` : `高危敏感词: ${clean}`,
      });
    }
  };

  if (rules.block_known_brands !== false) {
    for (const term of DEFAULT_BRAND_BLOCKLIST) matchTerm(term, 'brand');
  }
  if (rules.block_restricted !== false) {
    for (const term of DEFAULT_RESTRICTED_TERMS) matchTerm(term, 'restricted');
  }
  for (const term of normalizeCustomTerms(rules.custom_blocklist || [])) {
    matchTerm(term, 'custom');
  }
  return flags;
}

export function enrichDistributionItems(items = [], rules = {}) {
  return items.map(item => {
    const riskFlags = analyzeItemRisk(item, rules);
    const alreadyCollected = Boolean(item.already_collected || item.sellerstar_collection_id);
    const blockedByRisk = riskFlags.length > 0 && rules.block_risk_items !== false;
    const blockedByDup = alreadyCollected && rules.skip_collected !== false;
    const distributionSafe = item.decision === 'eligible' && !blockedByRisk && !blockedByDup;
    return {
      ...item,
      already_collected: alreadyCollected,
      risk_flags: riskFlags,
      distribution_safe: distributionSafe,
    };
  });
}

export function calculateBoutiqueProfit(input = {}) {
  const salePriceUsd = Math.max(0, num(input.sale_price_usd, 0));
  const costCny = Math.max(0, num(input.cost_cny, 0));
  const fxRate = Math.max(1, num(input.fx_rate, 7.2));
  const weightKg = Math.max(0, num(input.weight_kg, 0.45));
  const shippingPerKgCny = Math.max(0, num(input.shipping_per_kg_cny, 45));
  const fbaFeeUsd = Math.max(0, num(input.fba_fee_usd, 5.2));
  const referralPct = Math.max(0, Math.min(50, num(input.referral_pct, 15)));
  const acosPct = Math.max(0, Math.min(100, num(input.acos_pct, 15)));
  const returnPct = Math.max(0, Math.min(50, num(input.return_pct, 4)));

  const productCostUsd = costCny / fxRate;
  const freightUsd = (weightKg * shippingPerKgCny) / fxRate;
  const landedCostUsd = productCostUsd + freightUsd;
  const referralFeeUsd = salePriceUsd * (referralPct / 100);
  const adCostUsd = salePriceUsd * (acosPct / 100);
  const returnLossUsd = salePriceUsd * (returnPct / 100);
  const totalCostUsd = landedCostUsd + fbaFeeUsd + referralFeeUsd + adCostUsd + returnLossUsd;
  const netProfitUsd = salePriceUsd - totalCostUsd;
  const netMarginPct = salePriceUsd > 0 ? (netProfitUsd / salePriceUsd) * 100 : 0;
  const roiPct = landedCostUsd > 0 ? (netProfitUsd / landedCostUsd) * 100 : 0;
  const profitBeforeAds = salePriceUsd - (landedCostUsd + fbaFeeUsd + referralFeeUsd + returnLossUsd);
  const breakevenAcosPct = salePriceUsd > 0 ? Math.max(0, (profitBeforeAds / salePriceUsd) * 100) : 0;

  let verdict = 'pending';
  if (salePriceUsd > 0 && costCny > 0) {
    if (netMarginPct >= 20 && netProfitUsd >= 4) verdict = 'go';
    else if (netMarginPct >= 10 && netProfitUsd > 0) verdict = 'caution';
    else verdict = 'no_go';
  }

  return {
    sale_price_usd: round2(salePriceUsd),
    cost_cny: round2(costCny),
    fx_rate: round2(fxRate),
    weight_kg: round2(weightKg),
    shipping_per_kg_cny: round2(shippingPerKgCny),
    fba_fee_usd: round2(fbaFeeUsd),
    referral_pct: round2(referralPct),
    acos_pct: round2(acosPct),
    return_pct: round2(returnPct),
    product_cost_usd: round2(productCostUsd),
    freight_usd: round2(freightUsd),
    landed_cost_usd: round2(landedCostUsd),
    referral_fee_usd: round2(referralFeeUsd),
    ad_cost_usd: round2(adCostUsd),
    return_loss_usd: round2(returnLossUsd),
    net_profit_usd: round2(netProfitUsd),
    net_margin_pct: round2(netMarginPct),
    roi_pct: round2(roiPct),
    breakeven_acos_pct: round2(breakevenAcosPct),
    verdict,
  };
}

export function extractPainPointsFromReviews(reviews = []) {
  const counts = new Map();
  const samples = [];
  for (const rev of Array.isArray(reviews) ? reviews : []) {
    const text = String(rev?.text || rev || '').trim();
    if (!text) continue;
    const rating = num(rev?.rating, 0);
    if (rating > 0 && rating <= 3) samples.push({ rating, text: text.slice(0, 220) });
    for (const pat of PAIN_POINT_PATTERNS) {
      if (pat.re.test(text)) {
        counts.set(pat.key, { ...pat, hits: (counts.get(pat.key)?.hits || 0) + 1 });
      }
    }
  }
  const themes = [...counts.values()]
    .sort((a, b) => b.hits - a.hits)
    .slice(0, 6)
    .map(({ key, label, en, hits }) => ({ key, label, en, hits }));
  return { themes, critical_samples: samples.slice(0, 6) };
}

export function boutiqueTeardownExpression() {
  return `(() => {
    const clean = s => String(s || '').replace(/[\\u200e\\u200f]/g, '').replace(/\\s+/g, ' ').trim();
    const title = clean(document.querySelector('#productTitle')?.textContent);
    if (!title) {
      const body = clean(document.body?.innerText || '').slice(0, 600);
      if (document.querySelector('#captchacharacters, form[action*="validateCaptcha"]') || /robot check|captcha/i.test(document.title + ' ' + body)) {
        return { status: 'verification_required' };
      }
      if (/\\/ap\\/signin/i.test(location.pathname)) return { status: 'sign_in_required' };
      return { status: 'unavailable' };
    }
    const brandRaw = clean(document.querySelector('#bylineInfo')?.textContent);
    const brand = brandRaw.replace(/^(Visit the |Brand:\\s*)/i, '').replace(/\\s+Store$/i, '').trim() || null;
    const priceText = clean(document.querySelector('#corePriceDisplay_desktop_feature_div .a-price .a-offscreen, #corePrice_feature_div .a-price .a-offscreen, .priceToPay .a-offscreen')?.textContent);
    const priceMatch = priceText.match(/\\$([\\d,]+(?:\\.\\d{1,2})?)/);
    const price = priceMatch ? Number(priceMatch[1].replace(/,/g, '')) : null;
    const ratingText = clean(document.querySelector('#acrPopover')?.getAttribute('title') || document.querySelector('[data-hook="rating-out-of-text"]')?.textContent);
    const ratingMatch = ratingText.match(/([0-5](?:\\.\\d)?)/);
    const rating = ratingMatch ? Number(ratingMatch[1]) : null;
    const revText = clean(document.querySelector('#acrCustomerReviewText')?.textContent);
    const revMatch = revText.match(/([\\d,]+)/);
    const reviewsCount = revMatch ? Number(revMatch[1].replace(/,/g, '')) : null;
    const bullets = [...document.querySelectorAll('#feature-bullets ul li span.a-list-item')]
      .map(el => clean(el.textContent))
      .filter(t => t && t.length > 8 && !/^make sure this fits/i.test(t))
      .slice(0, 6);
    const categoryPath = [...document.querySelectorAll('#wayfinding-breadcrumbs_feature_div ul li a')]
      .map(a => clean(a.textContent)).filter(Boolean).slice(0, 6);
    const variantNodes = document.querySelectorAll('#twister li[data-defaultasin], #inline-twister-expander-content-color_name li, #variation_color_name li, #variation_size_name li');
    const variantCount = variantNodes.length || 1;
    const hasVideo = Boolean(document.querySelector('video, .videoThumbnail, #videoCount, [data-action="video-block"]'));
    const bsrText = clean([...document.querySelectorAll('#productDetails_detailBullets_sections1 tr, #detailBulletsWrapper_feature_div li')]
      .map(el => clean(el.textContent))
      .find(t => /Best Sellers Rank/i.test(t)) || '').slice(0, 220) || null;
    const reviews = [...document.querySelectorAll('[data-hook="review"], .review')].slice(0, 18).map(node => {
      const starRaw = clean(node.querySelector('[data-hook="review-star-rating"], [data-hook="cmps-review-star-rating"], .a-icon-alt')?.textContent);
      const starM = starRaw.match(/([1-5])(?:\\.0)?/);
      const heading = clean(node.querySelector('[data-hook="review-title"]')?.textContent);
      const body = clean(node.querySelector('[data-hook="review-body"]')?.textContent);
      return { rating: starM ? Number(starM[1]) : 0, text: (heading ? heading + ' — ' : '') + body.slice(0, 320) };
    }).filter(r => r.text);
    const heroImg = document.querySelector('#landingImage')?.getAttribute('data-old-hires') || document.querySelector('#landingImage')?.getAttribute('src') || null;
    return {
      status: 'ok',
      title: title.slice(0, 280),
      brand,
      price,
      rating,
      reviews_count: reviewsCount,
      variant_count: variantCount,
      has_video: hasVideo,
      bsr: bsrText,
      category_path: categoryPath,
      bullets,
      reviews,
      image: heroImg,
    };
  })()`;
}

export function build1688SearchUrl(item) {
  const raw = String(item?.sourcing_keyword || item?.keyword || item?.title || '').trim();
  // Keep concise high-signal search words (remove punctuation/measurements noise)
  const clean = raw.replace(/["'()[\],]/g, ' ').replace(/\s+/g, ' ').trim().split(' ').slice(0, 6).join(' ');
  return 'https://s.1688.com/selloffer/offer_search.htm?keywords=' + encodeURIComponent(clean || 'silicone mat');
}

export function formatBoutiqueBriefMarkdown(project = {}) {
  const items = Array.isArray(project.items) ? project.items : [];
  const now = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const lines = [
    `# VA 电商AI浏览器 · 精品立项评审包`,
    ``,
    `- **生成时间**: ${now} UTC`,
    `- **候选标杆数量**: ${items.length} 款`,
    `- **模式**: 精品深挖 SOP（赛道初筛 → 竞品拆解 → IP 合规 → 1688 利润精算 → 立项评审）`,
    ``,
    `## 一、候选标杆汇总对比`,
    ``,
    `| # | ASIN | 商品标题 | 售价 | 1688 采购 | 预估净利 / 净利率 | 盈亏 ACOS | IP 状态 | 立项建议 |`,
    `| :-: | :--- | :--- | ---: | ---: | ---: | ---: | :-: | :-: |`,
  ];

  const verdictLabel = (item, profit) => {
    if (item.compliance?.status === 'rejected') return '❌ 侵权驳回';
    if (profit.verdict === 'go' && item.compliance?.status === 'passed') return '✅ 建议立项';
    if (profit.verdict === 'go') return '🟡 利润达标(待IP终审)';
    if (profit.verdict === 'caution') return '🟠 谨慎评估';
    if (profit.verdict === 'no_go') return '🔴 利润不足';
    return '⚪ 待补数据';
  };
  const ipLabel = s => s === 'passed' ? '✅ 已通过' : s === 'rejected' ? '❌ 驳回' : '⏳ 待核查';

  items.forEach((item, idx) => {
    const p = calculateBoutiqueProfit(item.profit || { sale_price_usd: item.price });
    const title = String(item.title || item.asin).replace(/\|/g, ' ').slice(0, 56);
    const price = p.sale_price_usd > 0 ? `$${p.sale_price_usd.toFixed(2)}` : '—';
    const cost = p.cost_cny > 0 ? `¥${p.cost_cny.toFixed(1)}` : '待填';
    const margin = p.cost_cny > 0 ? `$${p.net_profit_usd.toFixed(2)} (${p.net_margin_pct.toFixed(1)}%)` : '—';
    const acos = p.cost_cny > 0 ? `${p.breakeven_acos_pct.toFixed(1)}%` : '—';
    lines.push(`| ${idx + 1} | [${item.asin}](${item.url}) | ${title} | ${price} | ${cost} | ${margin} | ${acos} | ${ipLabel(item.compliance?.status)} | ${verdictLabel(item, p)} |`);
  });

  lines.push('', '## 二、逐款深度拆解与差异化方案', '');
  items.forEach((item, idx) => {
    const p = calculateBoutiqueProfit(item.profit || { sale_price_usd: item.price });
    const td = item.teardown || null;
    lines.push(`### ${idx + 1}. ${item.title || item.asin} (\`${item.asin}\`)`);
    lines.push(`- **实际商品链接**: ${item.url}`);
    if (td?.brand) lines.push(`- **品牌 / 变体数 / 视频**: ${td.brand} · ${td.variant_count || 1} 变体 · ${td.has_video ? '有主图视频（建议用 browser_video_read 拆解脚本）' : '暂无主图视频'}`);
    if (td?.bsr) lines.push(`- **BSR 排名**: ${td.bsr}`);
    if (item.sellerlens) {
      const sl = item.sellerlens;
      lines.push(`- **SellerLens 精品分析**: 综合分 \`${sl.composite_score ?? '—'}\` (${sl.tier || '—'}) · 战略结论 **${sl.ai_verdict || '—'}**${sl.aba_rank ? ` · ABA #${sl.aba_rank}` : ''}${sl.trend_label ? ` · 趋势 ${sl.trend_label}` : ''}${sl.ai_headline ? ` — ${sl.ai_headline}` : ''}`);
    }
    if (item.ip_report) {
      const ip = item.ip_report;
      const dimSummary = Object.entries(ip.dims || {}).map(([k, v]) => `${k}:${v.scanned ? (v.hit_count ? v.hit_count + '命中' : '未命中') : '未查成'}`).join(' / ');
      lines.push(`- **SafeSellAI 侵权全查**: **${ip.verdict}**（来源 \`${ip.source}\` · ${dimSummary || '文字维度'}）`);
    }
    lines.push(`- **合规与 IP 核查**: ${ipLabel(item.compliance?.status)}${item.compliance?.checks?.length ? ' · 已核项: ' + item.compliance.checks.join(' / ') : ''}${item.compliance?.note ? ' · 备注: ' + item.compliance.note : ''}`);
    if (p.cost_cny > 0) {
      lines.push(`- **单件利润精算**: 售价 \`$${p.sale_price_usd}\` − 采购 \`¥${p.cost_cny}\`(\`$${p.product_cost_usd}\`) − 头程 \`$${p.freight_usd}\` − FBA \`$${p.fba_fee_usd}\` − 佣金 \`$${p.referral_fee_usd}\` − 广告(${p.acos_pct}%) \`$${p.ad_cost_usd}\` − 退货损耗 \`$${p.return_loss_usd}\` = **净利 \`$${p.net_profit_usd}\`（净利率 ${p.net_margin_pct}% · ROI ${p.roi_pct}% · 盈亏平衡 ACOS ${p.breakeven_acos_pct}%）**`);
    } else {
      lines.push(`- **单件利润精算**: 尚未录入 1688 采购价（CNY）`);
    }
    if (item.sourcing_url) lines.push(`- **1688 参考货源**: ${item.sourcing_url}${item.sourcing_supplier ? ' · ' + item.sourcing_supplier : ''}`);
    if (td?.pain_points?.themes?.length) {
      lines.push(`- **中差评痛点（微创新机会）**:`);
      for (const theme of td.pain_points.themes) {
        lines.push(`  - **${theme.label}**（命中 ${theme.hits} 次）`);
      }
    }
    if (td?.bullets?.length) {
      lines.push(`- **竞品核心五点卖点**:`);
      for (const b of td.bullets.slice(0, 5)) lines.push(`  - ${b}`);
    }
    if (item.diff_note) lines.push(`- **我方差异化改造思路**: ${item.diff_note}`);
    lines.push('');
  });

  return lines.join('\n');
}

export class SopStore {
  constructor(dataDir, { defaultMode = 'boutique' } = {}) {
    this.dataDir = dataDir;
    this.file = path.join(dataDir, 'sop-state.json');
    this.state = this.load(defaultMode);
  }

  defaultState(defaultMode) {
    return {
      mode: defaultMode === 'distribution' ? 'distribution' : 'boutique',
      distribution: {
        skip_collected: true,
        block_known_brands: true,
        block_restricted: true,
        block_risk_items: true,
        collection_mode: 'all_variants',
        custom_blocklist: [],
      },
      boutique: {
        active_asin: null,
        items: [],
      },
    };
  }

  load(defaultMode) {
    const base = this.defaultState(defaultMode);
    try {
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return {
        mode: saved.mode === 'distribution' || saved.mode === 'boutique' ? saved.mode : base.mode,
        distribution: {
          ...base.distribution,
          ...(saved.distribution || {}),
          custom_blocklist: normalizeCustomTerms(saved.distribution?.custom_blocklist || []),
        },
        boutique: {
          active_asin: saved.boutique?.active_asin || saved.boutique?.items?.[0]?.asin || null,
          items: Array.isArray(saved.boutique?.items) ? saved.boutique.items.slice(0, 20) : [],
        },
      };
    } catch {
      return base;
    }
  }

  save() {
    fs.mkdirSync(this.dataDir, { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }

  snapshot() {
    return {
      mode: this.state.mode,
      distribution: { ...this.state.distribution, custom_blocklist: [...this.state.distribution.custom_blocklist] },
      boutique: {
        active_asin: this.state.boutique.active_asin,
        items: this.state.boutique.items.map(item => ({
          ...item,
          profit_calc: calculateBoutiqueProfit(item.profit || { sale_price_usd: item.price }),
        })),
      },
    };
  }

  setMode(mode) {
    if (mode !== 'boutique' && mode !== 'distribution') return this.snapshot();
    this.state.mode = mode;
    this.save();
    return this.snapshot();
  }

  updateDistributionRules(patch = {}) {
    const d = this.state.distribution;
    for (const key of ['skip_collected', 'block_known_brands', 'block_restricted', 'block_risk_items']) {
      if (typeof patch[key] === 'boolean') d[key] = patch[key];
    }
    if (patch.collection_mode === 'all_variants' || patch.collection_mode === 'main_only') {
      d.collection_mode = patch.collection_mode;
    }
    if (patch.custom_blocklist !== undefined) {
      d.custom_blocklist = normalizeCustomTerms(patch.custom_blocklist);
    }
    this.save();
    return this.snapshot();
  }

  addBoutiqueItem(candidate = {}) {
    const asin = String(candidate.asin || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{10}$/.test(asin)) throw new Error('Invalid ASIN');
    const existing = this.state.boutique.items.find(i => i.asin === asin);
    if (existing) {
      this.state.boutique.active_asin = asin;
      this.save();
      return this.snapshot();
    }
    const price = candidate.price ?? candidate.data?.listed_price ?? null;
    const item = {
      asin,
      title: String(candidate.title || asin).slice(0, 260),
      url: String(candidate.url || `https://www.amazon.com/dp/${asin}`),
      image: candidate.image || null,
      keyword: candidate.keyword || '',
      price: typeof price === 'number' ? price : null,
      rating: candidate.rating ?? candidate.data?.rating ?? null,
      reviews: candidate.reviews ?? candidate.data?.reviews ?? null,
      demand: candidate.demand ?? candidate.data?.demand ?? null,
      added_at: new Date().toISOString(),
      teardown: null,
      compliance: { status: 'pending', checks: [], note: '' },
      profit: {
        sale_price_usd: typeof price === 'number' ? price : 24.99,
        cost_cny: 0,
        fx_rate: 7.2,
        weight_kg: 0.45,
        shipping_per_kg_cny: 45,
        fba_fee_usd: 5.2,
        referral_pct: 15,
        acos_pct: 15,
        return_pct: 4,
      },
      sourcing_url: '',
      sourcing_supplier: '',
      diff_note: '',
    };
    this.state.boutique.items.unshift(item);
    if (this.state.boutique.items.length > 20) this.state.boutique.items.length = 20;
    this.state.boutique.active_asin = asin;
    this.save();
    return this.snapshot();
  }

  removeBoutiqueItem(asin) {
    const target = String(asin || '').trim().toUpperCase();
    this.state.boutique.items = this.state.boutique.items.filter(i => i.asin !== target);
    if (this.state.boutique.active_asin === target) {
      this.state.boutique.active_asin = this.state.boutique.items[0]?.asin ?? null;
    }
    this.save();
    return this.snapshot();
  }

  selectBoutiqueItem(asin) {
    const target = String(asin || '').trim().toUpperCase();
    if (this.state.boutique.items.some(i => i.asin === target)) {
      this.state.boutique.active_asin = target;
      this.save();
    }
    return this.snapshot();
  }

  updateBoutiqueItem(asin, patch = {}) {
    const target = String(asin || '').trim().toUpperCase();
    const item = this.state.boutique.items.find(i => i.asin === target);
    if (!item) throw new Error('Boutique item not found: ' + target);
    if (patch.compliance && typeof patch.compliance === 'object') {
      item.compliance = {
        status: ['pending', 'passed', 'rejected'].includes(patch.compliance.status) ? patch.compliance.status : item.compliance.status,
        checks: Array.isArray(patch.compliance.checks) ? patch.compliance.checks.slice(0, 12).map(String) : item.compliance.checks,
        note: typeof patch.compliance.note === 'string' ? patch.compliance.note.slice(0, 500) : item.compliance.note,
      };
    }
    if (patch.profit && typeof patch.profit === 'object') {
      item.profit = { ...item.profit, ...patch.profit };
    }
    if (typeof patch.sourcing_url === 'string') item.sourcing_url = patch.sourcing_url.slice(0, 500);
    if (typeof patch.sourcing_supplier === 'string') item.sourcing_supplier = patch.sourcing_supplier.slice(0, 140);
    if (typeof patch.diff_note === 'string') item.diff_note = patch.diff_note.slice(0, 1000);
    if (patch.teardown && typeof patch.teardown === 'object') {
      item.teardown = patch.teardown;
      if (typeof patch.teardown.price === 'number' && !item.profit.sale_price_usd) {
        item.profit.sale_price_usd = patch.teardown.price;
      }
    }
    if (patch.ip_report && typeof patch.ip_report === 'object') {
      item.ip_report = patch.ip_report;
    }
    if (patch.sellerlens && typeof patch.sellerlens === 'object') {
      item.sellerlens = patch.sellerlens;
    }
    if (patch.sourcing_handoff && typeof patch.sourcing_handoff === 'object') {
      item.sourcing_handoff = patch.sourcing_handoff;
    }
    this.save();
    return this.snapshot();
  }

  exportBrief(outDir) {
    const dir = outDir || this.dataDir;
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const mdPath = path.join(dir, `va-boutique-brief-${stamp}.md`);
    const jsonPath = path.join(dir, `va-boutique-brief-${stamp}.json`);
    const md = formatBoutiqueBriefMarkdown(this.state.boutique);
    fs.writeFileSync(mdPath, md, 'utf8');
    fs.writeFileSync(jsonPath, JSON.stringify(this.snapshot().boutique, null, 2), 'utf8');
    return { ok: true, count: this.state.boutique.items.length, path: mdPath, json_path: jsonPath };
  }
}

export async function runBoutiqueTeardown(engine, item) {
  const url = `https://www.amazon.com/dp/${item.asin}`;
  let tab = [...engine.tabs.values()].find(t => !t.view.webContents.isDestroyed() && t.view.webContents.getURL().includes('/dp/' + item.asin));
  let owned = false;
  if (!tab) {
    tab = await engine.newTab(url, { activate: false, batchOwned: true });
    owned = true;
  }
  try {
    // Wait briefly if page is still loading
    for (let i = 0; i < 20; i++) {
      if (!tab.view.webContents.isLoadingMainFrame()) break;
      await new Promise(r => setTimeout(r, 250));
    }
    const raw = await engine.evaluateProductDocument(tab, boutiqueTeardownExpression(), { worldName: 'vamoon-boutique-teardown' });
    if (!raw || raw.status !== 'ok') {
      return { status: raw?.status || 'unavailable', checked_at: new Date().toISOString() };
    }
    const painPoints = extractPainPointsFromReviews(raw.reviews);
    return {
      status: 'ok',
      checked_at: new Date().toISOString(),
      title: raw.title,
      brand: raw.brand,
      price: raw.price,
      rating: raw.rating,
      reviews_count: raw.reviews_count,
      variant_count: raw.variant_count,
      has_video: Boolean(raw.has_video),
      bsr: raw.bsr,
      category_path: raw.category_path || [],
      bullets: raw.bullets || [],
      pain_points: painPoints,
    };
  } finally {
    if (owned && engine.tabs.has(tab.id)) {
      try { engine.closeTab(tab.id); } catch {}
    }
  }
}
