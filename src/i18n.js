import fs from 'node:fs';
import path from 'node:path';

export const SUPPORTED_LOCALES = ['zh-CN', 'en'];

export function normalizeLocale(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const lower = raw.trim().toLowerCase();
  if (lower === 'zh' || lower.startsWith('zh-') || lower.startsWith('zh_')) return 'zh-CN';
  if (lower === 'en' || lower.startsWith('en-') || lower.startsWith('en_')) return 'en';
  return null;
}

export function detectSystemLocale() {
  const envLang = process.env.VAMOON_LANG || process.env.LC_ALL || process.env.LANG;
  const fromEnv = normalizeLocale(envLang);
  if (fromEnv) return fromEnv;
  try {
    const intlLocale = Intl.DateTimeFormat().resolvedOptions().locale;
    return normalizeLocale(intlLocale) || 'en';
  } catch {
    return 'en';
  }
}

export function loadSavedLocale(dataDir) {
  if (!dataDir) return null;
  try {
    const prefs = JSON.parse(fs.readFileSync(path.join(dataDir, 'ui-prefs.json'), 'utf8'));
    return normalizeLocale(prefs?.locale);
  } catch {
    return null;
  }
}

export function saveLocale(dataDir, locale) {
  const normalized = normalizeLocale(locale);
  if (!normalized) throw Object.assign(new Error('Unsupported locale'), { code: 'INVALID_LOCALE' });
  if (!dataDir) return normalized;
  const file = path.join(dataDir, 'ui-prefs.json');
  let prefs = {};
  try { prefs = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  prefs.locale = normalized;
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(prefs, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
  return normalized;
}

export function resolveLocale({ explicitLang = null, dataDir = null } = {}) {
  return normalizeLocale(explicitLang) || loadSavedLocale(dataDir) || detectSystemLocale();
}

export function normalizeTheme(raw) {
  if (raw === 'light' || raw === 'dark') return raw;
  return null;
}

export function loadSavedTheme(dataDir) {
  if (!dataDir) return null;
  try {
    const prefs = JSON.parse(fs.readFileSync(path.join(dataDir, 'ui-prefs.json'), 'utf8'));
    return normalizeTheme(prefs?.theme);
  } catch {
    return null;
  }
}

export function saveTheme(dataDir, theme) {
  const normalized = normalizeTheme(theme);
  if (!normalized) throw Object.assign(new Error('Unsupported theme'), { code: 'INVALID_THEME' });
  if (!dataDir) return normalized;
  const file = path.join(dataDir, 'ui-prefs.json');
  let prefs = {};
  try { prefs = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  prefs.theme = normalized;
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(prefs, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
  return normalized;
}

export function resolveTheme({ explicitTheme = null, dataDir = null } = {}) {
  return normalizeTheme(explicitTheme) || loadSavedTheme(dataDir) || 'dark';
}

export const MAIN_STRINGS = {
  'zh-CN': {
    newTab: '新标签页',
    cut: '剪切',
    copy: '复制',
    paste: '粘贴',
    selectAll: '全选',
    copyLink: '复制链接地址',
    copyImage: '复制图片',
    clipboardHttpsOnly: '请在当前 HTTPS 页面开启复制。',
    permCamera: '摄像头',
    permMicrophone: '麦克风',
    permGeolocation: '定位',
    permNotifications: '通知',
    permScreen: '屏幕共享',
    permInvalid: '无效的网站权限。',
    permSiteChanged: '网站已变化，请在当前网站重新操作。',
    permRevokeTitle: name => '关闭' + name + '权限？',
    permRevokeDetail: '浏览器会刷新曾使用此权限的页面，结束可能仍在运行的会话。未提交的内容可能丢失。',
    cancel: '取消',
    revokeAndReload: '关闭权限并刷新',
    cancelShare: '取消共享',
    unnamedWindow: '未命名窗口',
    screenPromptTitle: '允许这一次屏幕共享？',
    screenPromptDetail: origin => origin + ' 请求共享屏幕或窗口。',
    continueShare: '继续共享',
  },
  en: {
    newTab: 'New Tab',
    cut: 'Cut',
    copy: 'Copy',
    paste: 'Paste',
    selectAll: 'Select All',
    copyLink: 'Copy Link Address',
    copyImage: 'Copy Image',
    clipboardHttpsOnly: 'Enable clipboard copy on the active HTTPS page.',
    permCamera: 'Camera',
    permMicrophone: 'Microphone',
    permGeolocation: 'Location',
    permNotifications: 'Notifications',
    permScreen: 'Screen Share',
    permInvalid: 'Invalid site permission.',
    permSiteChanged: 'Site changed. Retry on the current page.',
    permRevokeTitle: name => 'Disable ' + name + ' permission?',
    permRevokeDetail: 'Affected pages using this permission will reload to end active sessions. Unsaved form edits may be lost.',
    cancel: 'Cancel',
    revokeAndReload: 'Disable & Reload',
    cancelShare: 'Cancel Sharing',
    unnamedWindow: 'Untitled Window',
    screenPromptTitle: 'Allow screen sharing once?',
    screenPromptDetail: origin => origin + ' requests access to share a screen or window.',
    continueShare: 'Share',
  },
};

export function tMain(locale, key, ...args) {
  const dict = MAIN_STRINGS[normalizeLocale(locale) || 'en'] || MAIN_STRINGS.en;
  const entry = dict[key] ?? MAIN_STRINGS.en[key] ?? key;
  return typeof entry === 'function' ? entry(...args) : entry;
}
