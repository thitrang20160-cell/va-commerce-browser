import os from 'node:os';
import path from 'node:path';

export function systemAppDataDir() {
  const home = os.homedir();
  if (process.platform === 'win32') {
    return process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
  }
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support');
  }
  return process.env.XDG_CONFIG_HOME || path.join(home, '.config');
}

export function defaultProfileName(mode = 'internal') {
  return mode === 'oss' ? 'VA Commerce Browser OSS' : 'VaMoon Browser';
}

export function resolveDataDir({ explicitDir = null, mode = 'internal' } = {}) {
  return explicitDir || path.join(systemAppDataDir(), defaultProfileName(mode));
}

export function resolveDownloadDir({ explicitDir = null, electronDownloads = null, mode = 'internal' } = {}) {
  if (explicitDir) return explicitDir;
  const base = electronDownloads || path.join(os.homedir(), 'Downloads');
  return path.join(base, defaultProfileName(mode));
}
