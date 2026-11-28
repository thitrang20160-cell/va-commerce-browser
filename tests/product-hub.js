import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  ProductHubStore,
  build1688AgentPrompt,
  normalizeSafeSellAuditRows,
} from '../src/product-hub.js';

const mkTmp = prefix => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

test('ProductHubStore persists outbound MCP settings safely and redacts raw API keys from snapshot', () => {
  const dir = mkTmp('vamoon-hub-');
  const store = new ProductHubStore(dir);
  assert.equal(store.isConfigured('safesellai'), false);

  store.update('safesellai', {
    url: 'https://safesellai.com/mcp',
    token: 'sk_live_secret_token_987654321',
    enabled: true,
    tools: ['store_audit', 'check_brand', 'check_image'],
  });
  store.update('sellerlens', {
    url: 'http://127.0.0.1:18988/mcp',
    enabled: true,
  });

  // Reject non-https non-loopback URLs
  assert.throws(() => store.update('sellerlens', { url: 'http://example.com/mcp' }), /HTTPS/);

  const reloaded = new ProductHubStore(dir);
  assert.equal(reloaded.isConfigured('safesellai'), true);
  const snap = reloaded.snapshot({ portalConnected: true, portalTenant: 'demo-team' });
  const ss = snap.services.find(s => s.id === 'safesellai');
  assert.equal(ss.has_token, true);
  assert.equal(ss.mode_label, 'mcp');
  assert.ok(!JSON.stringify(snap).includes('sk_live_secret_token_987654321'));

  const s1688 = snap.services.find(s => s.id === 'sourcing_1688');
  assert.equal(s1688.mode_label, 'portal');
  assert.equal(s1688.ready, true);
});

test('normalizeSafeSellAuditRows honors strict scanned=false discipline and classifies TRO/patent hits', () => {
  const items = [
    { asin: 'B0CLEAR123', title: 'Generic Silicone Sink Mat', image: 'https://m.media-amazon.com/images/I/1.jpg' },
    { asin: 'B0RISK1234', title: 'Branded Kitchen Mat', image: 'https://m.media-amazon.com/images/I/2.jpg' },
    { asin: 'B0UNSCAN12', title: 'Unscanned Image Item', image: 'https://m.media-amazon.com/images/I/3.jpg' },
  ];
  const audited = [
    {
      overall_risk: '安全', max_severity: 1, risks: [], tro_hits: [], actions: {},
      design_patent: { scanned: true, matches: [] },
      copyright: { scanned: true, matches: [] },
      trademark_vision: { scanned: true, brands: [], characters: [], texts: [] },
    },
    {
      overall_risk: '高风险', max_severity: 5,
      risks: [{ word: 'OXO', risk: '高风险', action: 'block', isTro: true, factLabel: '活跃TRO品牌' }],
      tro_hits: [{ word: 'OXO' }],
      actions: { block: 1 },
      design_patent: { scanned: true, matches: [{ patent_number: 'D946925', title: 'Sink Mat', assignee: 'OXO', similarity: 0.91 }] },
    },
    {
      overall_risk: '安全', max_severity: 1, risks: [], tro_hits: [], actions: {},
      design_patent: { scanned: false, matches: [] },
      copyright: { scanned: true, matches: [] },
    },
  ];
  const out = normalizeSafeSellAuditRows(items, audited, 'safesellai_mcp');
  assert.equal(out.results[0].verdict, '可上');
  assert.equal(out.results[0].compliance_status, 'passed');

  assert.equal(out.results[1].verdict, '命中风险');
  assert.equal(out.results[1].compliance_status, 'rejected');
  assert.ok(out.results[1].refs.some(r => r.dim === '外观专利' && r.label === 'D946925'));

  // Never give a green light when design_patent.scanned === false!
  assert.equal(out.results[2].verdict, '部分未查成');
  assert.equal(out.results[2].compliance_status, 'pending');
});

test('build1688AgentPrompt embeds ASIN, price, and Amazon image URL cleanly for 1688-product-find skill', () => {
  const prompt = build1688AgentPrompt({
    asin: 'B0CSPK5CP2',
    title: 'Waterproof Under Sink Mat',
    keyword: 'silicone under sink mat',
    price: 35.29,
    image: 'https://m.media-amazon.com/images/I/71test.jpg',
    url: 'https://www.amazon.com/dp/B0CSPK5CP2',
  });
  assert.ok(prompt.includes('1688-product-find'));
  assert.ok(prompt.includes('B0CSPK5CP2'));
  assert.ok(prompt.includes('$35.29'));
  assert.ok(prompt.includes('https://m.media-amazon.com/images/I/71test.jpg'));
});
