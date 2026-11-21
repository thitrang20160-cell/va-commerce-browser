import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import electron from 'electron';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

test('Desktop MCP reads two background tabs and preserves the active tab', { timeout: 40000 }, async () => {
  const root = path.resolve(import.meta.dirname, '..');
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'va-browser-smoke-'));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const browser = spawn(electron, [root, '--data-dir', profile, '--port', '0', '--test-minimize'],
    { env, stdio: 'ignore', windowsHide: true });
  const client = new Client({ name: 'va-browser-smoke', version: '1' });
  const call = async (name, args = {}) => {
    const result = await client.callTool({ name, arguments: args });
    assert(!result.isError, name);
    return result.structuredContent;
  };
  try {
    let runtime;
    for (let tries = 0; tries < 100 && !runtime; tries++) {
      assert.equal(browser.exitCode, null, 'Electron must stay open');
      try {
        runtime = JSON.parse(await fs.readFile(path.join(profile, 'runtime.json'), 'utf8'));
      } catch (error) {
        if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
        await delay(100);
      }
    }
    assert(runtime, 'Browser should publish its loopback endpoint');
    assert.equal(new URL(runtime.endpoint).hostname, '127.0.0.1');
    const unauthenticated = await fetch(runtime.endpoint + '/rpc', { method: 'POST', body: '{}' });
    assert.equal(unauthenticated.status, 401);
    await client.connect(new StdioClientTransport({
      command: process.execPath,
      args: [path.join(root, 'src', 'bridge.js'), '--data-dir', profile, '--no-autostart', '--client', 'smoke'],
      stderr: 'pipe',
    }));
    const names = (await client.listTools()).tools.map(tool => tool.name);
    assert(names.includes('browser_product_discover'));
    assert(names.includes('browser_collect_batch'));
    assert(!names.some(name => name.includes('sellerstar')));
    let initial;
    for (let tries = 0; tries < 70; tries++) {
      initial = await call('browser_tabs');
      if (initial.active && initial.tabs.find(tab => tab.id === initial.active)?.ready) break;
      await delay(100);
    }
    assert(initial.active);
    const [first, second] = await Promise.all(['a', 'b'].map(key => call('browser_new_tab', {
      url: runtime.endpoint + '/demo', activate: false, request_id: 'smoke-background-' + key,
    })));
    const ids = [first.tab.id, second.tab.id];
    assert.notEqual(ids[0], ids[1]);
    const batch = await call('browser_collect_batch', { tab_ids: ids });
    assert.deepEqual(batch.results.map(result => result.tab_id), ids);
    for (const result of batch.results) assert.match(JSON.stringify(result), /浏览器连接验证/);
    assert.equal((await call('browser_tabs')).active, initial.active);
    const status = await call('browser_status');
    assert.equal(status.app, 'VA电商浏览器 AI版');
  } finally {
    await client.close();
    if (browser.exitCode === null && browser.signalCode === null) {
      const stopped = once(browser, 'exit');
      browser.kill();
      await stopped;
    }
  }
});
