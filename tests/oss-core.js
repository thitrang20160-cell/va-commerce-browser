import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { ReceiptStore } from '../src/receipt-store.js';
import { createPluginHost, resolveMode } from '../src/plugins/index.js';
import { definitionsForMode } from '../src/tools.js';
import { normalizeLocale, saveLocale, loadSavedLocale } from '../src/i18n.js';
import { exportDiscoveryReport } from '../src/product-discovery.js';
import { buildServerSpec, installJsonClient } from '../scripts/setup-mcp.mjs';

const mkTmp = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

test('OSS build defaults to oss mode and exposes zero private SellerStar tools', async () => {
  assert.equal(resolveMode(), 'oss');
  const host = await createPluginHost({ mode: 'oss' });
  assert.deepEqual(host.ids(), ['oss-discovery']);
  const names = definitionsForMode('oss', host).map(([n]) => n);
  assert.ok(names.includes('browser_snapshot'));
  assert.ok(names.includes('browser_video_read'));
  assert.ok(names.includes('browser_product_discover'));
  assert.ok(!names.some(n => n.includes('sellerstar')));
});

test('ReceiptStore archives oldest settled entries and keeps uncertain receipts hot', () => {
  const dir = mkTmp('oss-receipts-');
  const store = new ReceiptStore(dir, { maxHotReceipts: 10 });
  store.set('a:u1', { request_id: 'u1', tool: 'browser_click', status: 'unknown', at: '2026-10-01T00:00:00Z', client: 'a' });
  for (let i = 0; i < 12; i++) {
    store.set('a:r' + i, { request_id: 'r' + i, tool: 'browser_fill', status: 'completed', result: { i }, at: '2026-11-0' + ((i % 9) + 1) + 'T00:00:00Z', client: 'a' });
  }
  store.save();
  assert.equal(store.hasUncertain(), true);
  assert.equal(store.archivedCount, 2);
  assert.ok(store.get('a:r0'));
});

test('i18n persistence, CSV export, and setup-mcp installer preserve existing client configs', () => {
  const dir = mkTmp('oss-setup-');
  assert.equal(normalizeLocale('en-US'), 'en');
  saveLocale(dir, 'en');
  assert.equal(loadSavedLocale(dir), 'en');

  const csv = exportDiscoveryReport({ plan: { keyword: 'test' }, items: [{ rank: 1, asin: 'B011111111', decision: 'eligible', title: 'Sample', url: 'https://www.amazon.com/dp/B011111111', reasons: [], data: { listed_price: 15, first_seen: '2026-11-28T00:00:00Z' } }] }, 'csv', dir);
  assert.equal(fs.existsSync(csv.path), true);

  const cfgFile = path.join(dir, 'mcp.json');
  fs.writeFileSync(cfgFile, JSON.stringify({ mcpServers: { existing_tool: { command: 'echo', args: ['hi'] } } }));
  const spec = buildServerSpec({ client: 'cursor', mode: 'oss', projectRoot: dir });
  const res = installJsonClient({ file: cfgFile, serverName: 'va_commerce_browser', spec });
  assert.equal(res.installed, true);
  assert.ok(fs.existsSync(res.backup_path));
  const after = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
  assert.deepEqual(after.mcpServers.existing_tool, { command: 'echo', args: ['hi'] });
  assert.deepEqual(after.mcpServers.va_commerce_browser, spec);
});
