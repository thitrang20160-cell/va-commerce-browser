import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcp, definitionsForMode } from './tools.js';
import { resolveDataDir } from './paths.js';
import { resolveMode } from './plugins/index.js';
import packageInfo from '../package.json' with { type: 'json' };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const flag = (name) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
};
const mode = resolveMode(flag('--mode'));
const clientName = flag('--client') || 'generic-agent';
const profile = resolveDataDir({ explicitDir: flag('--data-dir'), mode });
const runtimePath = path.join(profile, 'runtime.json');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let launched = false;

async function connection() {
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      const data = JSON.parse(fs.readFileSync(runtimePath, 'utf8'));
      const url = new URL(data.endpoint);
      if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !data.token) throw new Error('Invalid local endpoint');
      const health = await fetch(data.endpoint + '/health', { signal: AbortSignal.timeout(1000) });
      const status = await health.json();
      if (status.app === 'vamoon-browser') {
        return { ...data, version: status.version, health: status };
      }
    } catch {}
    if (!launched && !process.argv.includes('--no-autostart')) {
      launched = true;
      const startArgs = [path.join(root, 'scripts', 'start.js'), '--data-dir', profile, '--mode', mode];
      const child = spawn(process.execPath, startArgs, {
        detached: true, stdio: 'ignore', windowsHide: true,
      });
      child.unref();
    }
    await delay(250);
  }
  throw new Error(`Browser is not ready. Open ${packageInfo.productName} and retry.`);
}

const server = createMcp(clientName, async (tool, args) => {
  const runtime = await connection();
  const h = runtime.health || {};
  if (tool === 'browser_product_discover' && h.product_discovery !== true) {
    throw Object.assign(new Error(`Restart ${packageInfo.productName} to load product discovery.`), { code: 'BROWSER_UPDATE_REQUIRED' });
  }
  const requiresCollectionUpdate = tool === 'browser_collect_batch' ||
    (tool === 'browser_snapshot' && (args.mode !== undefined || args.name_contains !== undefined));
  if (requiresCollectionUpdate && /^0\.[0-4]\./.test(runtime.version)) {
    throw Object.assign(new Error(`Restart ${packageInfo.productName} to load the collection update.`), { code: 'BROWSER_UPDATE_REQUIRED' });
  }
  const requiresTabsUpdate = tool.startsWith('browser_watch_') || tool === 'browser_collect' ||
    (tool === 'browser_new_tab' && args.activate !== undefined) || (tool === 'browser_downloads' && args.tab_id);
  if (requiresTabsUpdate && /^0\.[0-3]\./.test(runtime.version)) {
    throw Object.assign(new Error(`Restart ${packageInfo.productName} to load the tab monitoring update.`), { code: 'BROWSER_UPDATE_REQUIRED' });
  }
  // Never automatically replay an HTTP action after a disconnect.
  const response = await fetch(runtime.endpoint + '/rpc', {
    method: 'POST', headers: { Authorization: 'Bearer ' + runtime.token, 'Content-Type': 'application/json', 'X-Agent-Client': clientName },
    body: JSON.stringify({ tool, args }), signal: AbortSignal.timeout(60000),
  });
  const value = await response.json();
  if (!response.ok) throw Object.assign(new Error(value.message || value.error), { code: value.error });
  return value.result;
}, definitionsForMode(mode));

await server.connect(new StdioServerTransport());
