#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const home = os.homedir();

function flag(name) {
  const idx = process.argv.indexOf(name);
  return idx < 0 ? null : process.argv[idx + 1] ?? null;
}

function appDataDir() {
  if (process.platform === 'win32') return process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support');
  return process.env.XDG_CONFIG_HOME || path.join(home, '.config');
}

export function clientTargets() {
  const appData = appDataDir();
  return {
    'claude-code': { format: 'json', key: 'mcpServers', file: path.join(home, '.claude.json') },
    'claude-desktop': { format: 'json', key: 'mcpServers', file: path.join(appData, 'Claude', 'claude_desktop_config.json') },
    cursor: { format: 'json', key: 'mcpServers', file: path.join(home, '.cursor', 'mcp.json') },
    windsurf: { format: 'json', key: 'mcpServers', file: path.join(home, '.codeium', 'windsurf', 'mcp_config.json') },
    cline: { format: 'json', key: 'mcpServers', file: path.join(appData, 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json') },
    codex: { format: 'toml-hint', file: path.join(home, '.codex', 'config.toml') },
    generic: { format: 'stdout' },
  };
}

export function buildServerSpec({ client, mode = 'oss', projectRoot = root, nodeExec = process.execPath } = {}) {
  const args = [path.join(projectRoot, 'src', 'bridge.js'), '--client', client];
  if (mode === 'oss') args.push('--mode', 'oss');
  return { command: nodeExec, args };
}

export function installJsonClient({ file, serverName, spec, dryRun = false }) {
  const exists = fs.existsSync(file);
  const raw = exists ? fs.readFileSync(file, 'utf8') : null;
  const parsed = raw ? JSON.parse(raw.replace(/^\uFEFF/, '')) : {};
  parsed.mcpServers ??= {};
  const priorNames = Object.keys(parsed.mcpServers);
  parsed.mcpServers[serverName] = spec;
  if (dryRun) {
    return { dry_run: true, file, server_name: serverName, spec, preserved_servers: priorNames.filter(n => n !== serverName) };
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let backupPath = null;
  if (exists) {
    backupPath = file + '.bak-' + new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(file, backupPath);
  }
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(parsed, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, file);
  const verify = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (JSON.stringify(verify.mcpServers?.[serverName]) !== JSON.stringify(spec)) {
    throw new Error('Verification readback mismatch for ' + file);
  }
  return { installed: true, file, backup_path: backupPath, server_name: serverName, spec };
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
  const serverName = flag('--name') || (mode === 'oss' ? 'va_commerce_browser' : 'vamoon_browser');
  const dryRun = process.argv.includes('--dry-run');
  const spec = buildServerSpec({ client, mode });
  const target = targets[client];

  if (target.format === 'stdout') {
    console.log(JSON.stringify({ mcpServers: { [serverName]: spec } }, null, 2));
    process.exit(0);
  }
  if (target.format === 'toml-hint') {
    const cmd = ['codex', 'mcp', 'add', serverName, '--', spec.command, ...spec.args].map(s => /\s/.test(s) ? `"${s}"` : s).join(' ');
    console.log(JSON.stringify({
      client,
      config_file: target.file,
      run_command: cmd,
      snippet: { mcpServers: { [serverName]: spec } },
    }, null, 2));
    process.exit(0);
  }
  const result = installJsonClient({ file: target.file, serverName, spec, dryRun });
  console.log(JSON.stringify(result, null, 2));
}
