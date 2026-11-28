import fs from 'node:fs';
import { PluginHost } from '../plugin-host.js';
import { createOssDiscoveryPlugin } from './oss-discovery.js';

let defaultMode = 'oss';
try {
  const modeConfig = JSON.parse(fs.readFileSync(new URL('../mode.json', import.meta.url), 'utf8'));
  if (modeConfig?.defaultMode === 'oss' || modeConfig?.defaultMode === 'internal') {
    defaultMode = modeConfig.defaultMode;
  }
} catch {}

export function resolveMode(explicitMode = null) {
  const candidate = explicitMode || process.env.VAMOON_BROWSER_MODE || defaultMode;
  return candidate === 'internal' ? 'internal' : 'oss';
}

export async function loadOptionalExtensionModule() {
  const candidate = new URL('../internal-bootstrap.js', import.meta.url);
  if (!fs.existsSync(candidate)) return null;
  return import(candidate.href);
}

export async function createPluginHost({ mode = resolveMode(), extensionContext = {} } = {}) {
  const host = new PluginHost();
  host.register(createOssDiscoveryPlugin({ mode }));
  if (mode === 'internal') {
    const ext = await loadOptionalExtensionModule();
    ext?.registerInternalPlugins?.(host, extensionContext);
  }
  return host;
}
