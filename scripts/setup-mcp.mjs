#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildCodexCommand,
  buildServerSpec,
  clientTargets,
  defaultServerName,
  installJsonClient,
} from '../src/mcp-connector.js';

export { buildCodexCommand, buildServerSpec, clientTargets, defaultServerName, installJsonClient };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function flag(name) {
  const idx = process.argv.indexOf(name);
  return idx < 0 ? null : process.argv[idx + 1] ?? null;
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isCli) {
  const client = flag('--client');
  const targets = clientTargets();
  if (!client || !targets[client]) {
    console.log('Usage: node scripts/setup-mcp.mjs --client <' + Object.keys(targets).join('|') + '> [--mode oss|internal] [--name <serverName>] [--dry-run]');
    process.exit(client ? 1 : 0);
  }
  let defaultMode = 'oss';
  try {
    const modeCfg = JSON.parse(fs.readFileSync(path.join(root, 'src', 'mode.json'), 'utf8'));
    if (modeCfg?.defaultMode) defaultMode = modeCfg.defaultMode;
  } catch {}
  const mode = flag('--mode') || defaultMode;
  const serverName = flag('--name') || defaultServerName(mode);
  const dryRun = process.argv.includes('--dry-run');
  const spec = buildServerSpec({ client, mode, projectRoot: root });
  const target = targets[client];

  if (target.format === 'stdout') {
    console.log(JSON.stringify({ mcpServers: { [serverName]: spec } }, null, 2));
    process.exit(0);
  }
  if (target.format === 'toml-hint') {
    const cmd = buildCodexCommand({ mode, serverName, projectRoot: root });
    console.log(JSON.stringify({ client, config_file: target.file, command: cmd, spec }, null, 2));
    process.exit(0);
  }
  const result = installJsonClient({ file: target.file, serverName, spec, dryRun });
  console.log(JSON.stringify(result, null, 2));
}
