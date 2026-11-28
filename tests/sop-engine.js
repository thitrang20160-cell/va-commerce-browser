import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  SopStore,
  analyzeItemRisk,
  build1688SearchUrl,
  calculateBoutiqueProfit,
  enrichDistributionItems,
  extractPainPointsFromReviews,
  formatBoutiqueBriefMarkdown,
} from '../src/sop-engine.js';

const mkTmp = prefix => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

test('Distribution risk filter catches known brands, restricted items, custom blocklist, and SellerStar duplicates', () => {
  const items = [
    { asin: 'B0CSPK5CP2', decision: 'eligible', title: 'Waterproof Silicone Under Sink Mat 34x22' },
    { asin: 'B0APPLE123', decision: 'eligible', title: 'Replacement Silicone Case for Apple AirPods Pro' },
    { asin: 'B0BAT12345', decision: 'eligible', title: 'Rechargeable Lithium Battery Pack for Kitchen' },
    { asin: 'B0DUP12345', decision: 'eligible', title: 'Extra Thick Cabinet Liner Mat', already_collected: true },
    { asin: 'B0CUST1234', decision: 'eligible', title: 'FLATO Waterproof Sink Liner Gray' },
  ];

  assert.ok(analyzeItemRisk(items[1]).some(f => f.kind === 'brand' && f.term === 'apple'));
  assert.ok(analyzeItemRisk(items[2]).some(f => f.kind === 'restricted'));

  const enriched = enrichDistributionItems(items, {
    skip_collected: true,
    block_known_brands: true,
    block_restricted: true,
    block_risk_items: true,
    custom_blocklist: ['FLATO'],
  });
  assert.equal(enriched[0].distribution_safe, true);
  assert.equal(enriched[1].distribution_safe, false);
  assert.equal(enriched[2].distribution_safe, false);
  assert.equal(enriched[3].distribution_safe, false);
  assert.equal(enriched[3].already_collected, true);
  assert.equal(enriched[4].distribution_safe, false);
  assert.ok(enriched[4].risk_flags.some(f => f.kind === 'custom' && f.term === 'FLATO'));
});

test('Boutique unit economics calculator computes margin, ROI, breakeven ACOS and verdict accurately', () => {
  const strong = calculateBoutiqueProfit({
    sale_price_usd: 29.99,
    cost_cny: 28,
    fx_rate: 7.2,
    weight_kg: 0.4,
    shipping_per_kg_cny: 45,
    fba_fee_usd: 5.2,
    referral_pct: 15,
    acos_pct: 15,
    return_pct: 4,
  });
  assert.equal(strong.verdict, 'go');
  assert.ok(strong.net_profit_usd > 7);
  assert.ok(strong.net_margin_pct > 25);
  assert.ok(strong.breakeven_acos_pct > 40);

  const weak = calculateBoutiqueProfit({
    sale_price_usd: 14.99,
    cost_cny: 42,
    fx_rate: 7.2,
    weight_kg: 0.6,
    shipping_per_kg_cny: 45,
    fba_fee_usd: 5.5,
    referral_pct: 15,
    acos_pct: 18,
    return_pct: 5,
  });
  assert.equal(weak.verdict, 'no_go');
  assert.ok(weak.net_profit_usd < 0);
});

test('Pain point extractor summarizes critical 1-3 star themes and 1688 search URL builds cleanly', () => {
  const pain = extractPainPointsFromReviews([
    { rating: 1, text: 'Started leaking water after 2 weeks, very thin silicone material.' },
    { rating: 2, text: 'Strong chemical smell right out of the box and too small for my cabinet.' },
    { rating: 2, text: 'Material feels flimsy and leaks from the corner.' },
    { rating: 5, text: 'Great product love it!' },
  ]);
  assert.equal(pain.themes[0].key, 'leak');
  assert.equal(pain.themes[0].hits, 2);
  assert.ok(pain.themes.some(t => t.key === 'thin'));
  assert.ok(pain.themes.some(t => t.key === 'smell'));
  assert.equal(pain.critical_samples.length, 3);

  const url = build1688SearchUrl({ keyword: 'silicone under sink mat' });
  assert.match(url, /^https:\/\/s\.1688\.com\/selloffer\/offer_search\.htm\?keywords=silicone%20under%20sink%20mat/);
});

test('SopStore persists dual modes, boutique shortlist updates, and exports Markdown + JSON brief', () => {
  const dir = mkTmp('vamoon-sop-');
  const store = new SopStore(dir, { defaultMode: 'distribution' });
  assert.equal(store.snapshot().mode, 'distribution');

  store.updateDistributionRules({ custom_blocklist: 'BrandX, 液体', collection_mode: 'main_only' });
  store.setMode('boutique');
  store.addBoutiqueItem({
    asin: 'B0CSPK5CP2',
    title: 'Waterproof Under Sink Mat 34" x 22"',
    url: 'https://www.amazon.com/dp/B0CSPK5CP2',
    price: 25.99,
  });
  store.updateBoutiqueItem('B0CSPK5CP2', {
    compliance: { status: 'passed', checks: ['商标', '外观专利'], note: '已排查 US/EU 专利' },
    profit: { sale_price_usd: 25.99, cost_cny: 24, weight_kg: 0.4, shipping_per_kg_cny: 45, fba_fee_usd: 5.0, acos_pct: 15 },
    diff_note: '加厚 2.5mm + 附赠收纳袋',
  });

  // Reload from disk to verify persistence
  const reloaded = new SopStore(dir, { defaultMode: 'distribution' });
  const snap = reloaded.snapshot();
  assert.equal(snap.mode, 'boutique');
  assert.equal(snap.distribution.collection_mode, 'main_only');
  assert.deepEqual(snap.distribution.custom_blocklist, ['BrandX', '液体']);
  assert.equal(snap.boutique.items.length, 1);
  assert.equal(snap.boutique.items[0].compliance.status, 'passed');
  assert.equal(snap.boutique.items[0].profit_calc.verdict, 'go');

  const md = formatBoutiqueBriefMarkdown(snap.boutique);
  assert.ok(md.includes('B0CSPK5CP2'));
  assert.ok(md.includes('✅ 建议立项'));
  assert.ok(md.includes('加厚 2.5mm'));

  const exported = reloaded.exportBrief(dir);
  assert.equal(exported.ok, true);
  assert.equal(fs.existsSync(exported.path), true);
  assert.equal(fs.existsSync(exported.json_path), true);
});
