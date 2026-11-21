import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcp } from './tools.js';
import packageInfo from '../package.json' with { type: 'json' };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const flag = (name) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
};
const clientName = flag('--client') || 'generic-agent';
const home = os.homedir();
const appData = process.platform === 'win32' ? process.env.APPDATA || path.join(home, 'AppData', 'Roaming') :
  process.platform === 'darwin' ? path.join(home, 'Library', 'Application Support') : process.env.XDG_CONFIG_HOME || path.join(home, '.config');
const profile = flag('--data-dir') || path.join(appData, 'VA Commerce Browser OSS');
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
      if (status.app === 'vamoon-browser') return { ...data, version: status.version, productDiscovery: status.product_discovery === true };
    } catch {}
    if (!launched && !process.argv.includes('--no-autostart')) {
      launched = true;
      const child = spawn(process.execPath, [path.join(root, 'scripts', 'start.js'), '--data-dir', profile], {
        detached: true, stdio: 'ignore', windowsHide: true,
      });
      child.unref();
    }
    await delay(250);
  }
  throw new Error(`浏览器尚未就绪。请打开 ${packageInfo.productName} 后重试。`);
}

const server = createMcp(clientName, async (tool, args) => {
  const runtime = await connection();
  if (tool === 'browser_product_discover' && !runtime.productDiscovery) {
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
});
await server.connect(new StdioServerTransport());
