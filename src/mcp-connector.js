import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const home = os.homedir();

function appDataDir() {
  if (process.platform === 'win32') return process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support');
  return process.env.XDG_CONFIG_HOME || path.join(home, '.config');
}

function shortenHome(filePath) {
  if (!filePath) return '';
  const normFile = path.resolve(filePath);
  const normHome = path.resolve(home);
  if (normFile.toLowerCase().startsWith(normHome.toLowerCase() + path.sep)) {
    return '~' + normFile.slice(normHome.length).replace(/\\/g, '/');
  }
  return normFile.replace(/\\/g, '/');
}

export function findNodeOnPath() {
  const pathEnv = process.env.PATH || process.env.Path || '';
  const names = process.platform === 'win32' ? ['node.exe', 'node.cmd'] : ['node'];
  for (const dir of pathEnv.split(path.delimiter).filter(Boolean)) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      try {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
      } catch {}
    }
  }
  return null;
}

export function resolveNodeRuntime({ explicitNode = null } = {}) {
  if (explicitNode) return { command: explicitNode, env: null };
  if (!process.versions?.electron) return { command: process.execPath, env: null };
  const systemNode = findNodeOnPath();
  if (systemNode) return { command: systemNode, env: null };
  return { command: process.execPath, env: { ELECTRON_RUN_AS_NODE: '1' } };
}

export function clientTargets() {
  const appData = appDataDir();
  return {
    'claude-code': { id: 'claude-code', label: 'Claude Code', format: 'json', key: 'mcpServers', file: path.join(home, '.claude.json') },
    codex: { id: 'codex', label: 'Codex CLI', format: 'toml-hint', file: path.join(home, '.codex', 'config.toml') },
    cursor: { id: 'cursor', label: 'Cursor', format: 'json', key: 'mcpServers', file: path.join(home, '.cursor', 'mcp.json') },
    windsurf: { id: 'windsurf', label: 'Windsurf', format: 'json', key: 'mcpServers', file: path.join(home, '.codeium', 'windsurf', 'mcp_config.json') },
    'claude-desktop': { id: 'claude-desktop', label: 'Claude Desktop', format: 'json', key: 'mcpServers', file: path.join(appData, 'Claude', 'claude_desktop_config.json') },
    cline: { id: 'cline', label: 'Cline', format: 'json', key: 'mcpServers', file: path.join(appData, 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json') },
    generic: { id: 'generic', label: 'Generic MCP JSON', format: 'stdout' },
  };
}

export function defaultServerName(mode = 'oss') {
  return mode === 'oss' ? 'va_commerce_browser' : 'vamoon_browser';
}

export function buildServerSpec({ client, mode = 'oss', projectRoot = defaultRoot, nodeExec = null } = {}) {
  const runtime = resolveNodeRuntime({ explicitNode: nodeExec });
  const args = [path.join(projectRoot, 'src', 'bridge.js'), '--client', client];
  if (mode === 'oss') args.push('--mode', 'oss');
  const spec = { command: runtime.command, args };
  if (runtime.env) spec.env = runtime.env;
  return spec;
}

export function buildCodexCommand({ mode = 'oss', serverName = defaultServerName(mode), projectRoot = defaultRoot, nodeExec = null } = {}) {
  const spec = buildServerSpec({ client: 'codex', mode, projectRoot, nodeExec });
  const parts = ['codex', 'mcp', 'add', serverName];
  if (spec.env) {
    for (const [k, v] of Object.entries(spec.env)) parts.push('--env', `${k}=${v}`);
  }
  parts.push('--', spec.command, ...spec.args);
  return parts.map(s => /\s/.test(s) ? `"${s}"` : s).join(' ');
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
  return { installed: true, file, short_file: shortenHome(file), backup_path: backupPath, server_name: serverName, spec };
}

export function removeJsonClient({ file, serverName, bridgePath = null }) {
  if (!fs.existsSync(file)) return { removed: false, file, short_file: shortenHome(file), server_name: serverName };
  const raw = fs.readFileSync(file, 'utf8');
  const parsed = JSON.parse(raw.replace(/^\uFEFF/, ''));
  const servers = parsed?.mcpServers;
  if (!servers || typeof servers !== 'object') return { removed: false, file, short_file: shortenHome(file), server_name: serverName };
  const keysToRemove = [];
  if (serverName in servers) keysToRemove.push(serverName);
  if (bridgePath) {
    const resolvedBridge = path.resolve(bridgePath);
    for (const [k, entry] of Object.entries(servers)) {
      if (keysToRemove.includes(k)) continue;
      if (Array.isArray(entry?.args) && entry.args.some(a => typeof a === 'string' && path.resolve(a) === resolvedBridge)) {
        keysToRemove.push(k);
      }
    }
  }
  if (!keysToRemove.length) return { removed: false, file, short_file: shortenHome(file), server_name: serverName };
  const backupPath = file + '.bak-' + new Date().toISOString().replace(/[:.]/g, '-');
  fs.copyFileSync(file, backupPath);
  for (const k of keysToRemove) delete servers[k];
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(parsed, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, file);
  return { removed: true, removed_keys: keysToRemove, file, short_file: shortenHome(file), backup_path: backupPath, server_name: serverName };
}

function readJsonConfigured(file, serverName, bridgePath) {
  if (!file || !fs.existsSync(file)) return { exists: false, configured: false };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    const servers = parsed?.mcpServers || {};
    if (servers[serverName]) return { exists: true, configured: true };
    const matchByBridge = Object.values(servers).some(entry =>
      Array.isArray(entry?.args) && entry.args.some(a => typeof a === 'string' && path.resolve(a) === path.resolve(bridgePath))
    );
    return { exists: true, configured: matchByBridge };
  } catch {
    return { exists: true, configured: false };
  }
}

function readCodexConfigured(file, serverName, bridgePath) {
  if (!file || !fs.existsSync(file)) return { exists: false, configured: false };
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const configured = raw.includes('[mcp_servers.' + serverName + ']') ||
      raw.includes('va_commerce_browser') ||
      raw.includes('vamoon_browser') ||
      raw.includes(bridgePath.replace(/\\/g, '\\\\')) ||
      raw.includes(bridgePath);
    return { exists: true, configured };
  } catch {
    return { exists: true, configured: false };
  }
}

function matchesActiveClient(clientId, activeClients) {
  if (!Array.isArray(activeClients) || !activeClients.length) return false;
  const tokens = clientId.split('-');
  return activeClients.some(name => {
    const lower = String(name || '').toLowerCase();
    if (lower === clientId) return true;
    if (clientId === 'codex' && lower.includes('codex')) return true;
    if (clientId === 'claude-code' && (lower.includes('claude-code') || lower === 'claude')) return true;
    if (clientId === 'claude-desktop' && lower.includes('claude-desktop')) return true;
    return tokens.every(tok => lower.includes(tok));
  });
}

export function inspectMcpConnector({
  mode = 'oss',
  locale = 'zh-CN',
  theme = 'dark',
  serverName = defaultServerName(mode),
  projectRoot = defaultRoot,
  endpoint = null,
  toolCount = null,
  dataDir = null,
  activeClients = [],
  nodeExec = null,
} = {}) {
  const targets = clientTargets();
  const bridgePath = path.join(projectRoot, 'src', 'bridge.js');
  const genericSpec = buildServerSpec({ client: 'my-agent', mode, projectRoot, nodeExec });
  const clients = ['claude-code', 'codex', 'cursor', 'windsurf', 'claude-desktop', 'cline'].map(id => {
    const t = targets[id];
    const state = t.format === 'json'
      ? readJsonConfigured(t.file, serverName, bridgePath)
      : readCodexConfigured(t.file, serverName, bridgePath);
    return {
      id: t.id,
      label: t.label,
      format: t.format,
      file: t.file,
      short_file: shortenHome(t.file),
      exists: state.exists,
      configured: state.configured,
      active: matchesActiveClient(id, activeClients),
    };
  });
  return {
    mode,
    locale,
    theme,
    server_name: serverName,
    endpoint,
    mcp_http_url: endpoint ? endpoint + '/mcp' : null,
    data_dir: dataDir,
    tool_count: toolCount,
    active_clients: activeClients,
    bridge_path: bridgePath,
    codex_command: buildCodexCommand({ mode, serverName, projectRoot, nodeExec }),
    generic_json: JSON.stringify({ mcpServers: { [serverName]: genericSpec } }, null, 2),
    clients,
  };
}

export function installMcpClient({ client, mode = 'oss', serverName = defaultServerName(mode), projectRoot = defaultRoot, nodeExec = null, dryRun = false } = {}) {
  const targets = clientTargets();
  const target = targets[client];
  if (!target) throw Object.assign(new Error('Unsupported MCP client: ' + client), { code: 'INVALID_MCP_CLIENT' });
  if (target.format !== 'json') {
    throw Object.assign(new Error('Client ' + client + ' does not support automatic JSON installation'), { code: 'NON_JSON_CLIENT' });
  }
  const spec = buildServerSpec({ client, mode, projectRoot, nodeExec });
  return installJsonClient({ file: target.file, serverName, spec, dryRun });
}

export function uninstallMcpClient({ client, mode = 'oss', serverName = defaultServerName(mode), projectRoot = defaultRoot } = {}) {
  const targets = clientTargets();
  const target = targets[client];
  if (!target) throw Object.assign(new Error('Unsupported MCP client: ' + client), { code: 'INVALID_MCP_CLIENT' });
  if (target.format !== 'json') {
    throw Object.assign(new Error('Client ' + client + ' must be removed via CLI'), { code: 'NON_JSON_CLIENT' });
  }
  const bridgePath = path.join(projectRoot, 'src', 'bridge.js');
  return removeJsonClient({ file: target.file, serverName, bridgePath });
}
