import fs from 'node:fs';
import path from 'node:path';
import { desktopCapturer, dialog, Menu } from 'electron';
import { tMain } from './i18n.js';

const permissionKeys = ['camera', 'microphone', 'geolocation', 'notifications', 'screen'];
const permissionLabelKey = {
  camera: 'permCamera',
  microphone: 'permMicrophone',
  geolocation: 'permGeolocation',
  notifications: 'permNotifications',
  screen: 'permScreen',
};
const mediaPermissions = { video: 'camera', audio: 'microphone' };

export function siteOrigin(raw) {
  try {
    const url = new URL(raw);
    if (url.protocol === 'https:' ||
        (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) return url.origin;
  } catch {}
  return null;
}

export class SitePermissions {
  constructor(directory) {
    this.file = path.join(directory, 'site-permissions.json');
    this.sites = new Map();
    try {
      const stored = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      for (const [origin, grants] of Object.entries(stored)) {
        if (siteOrigin(origin) === origin && Array.isArray(grants)) {
          this.sites.set(origin, new Set(grants.filter(grant => permissionKeys.includes(grant))));
        }
      }
    } catch (error) {
      if (error.code !== 'ENOENT') console.warn('Could not load site permissions.');
    }
  }

  has(origin, permission) { return this.sites.get(origin)?.has(permission) === true; }

  describe(origin) {
    return Object.fromEntries(permissionKeys.map(permission => [permission, this.has(origin, permission)]));
  }

  save(origin, permission, allowed) {
    const sites = new Map(this.sites);
    const grants = new Set(sites.get(origin));
    if (allowed) grants.add(permission);
    else grants.delete(permission);
    if (grants.size) sites.set(origin, grants);
    else sites.delete(origin);
    const temporary = this.file + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify(Object.fromEntries(
      [...sites].map(([site, grants]) => [site, [...grants]]))), { mode: 0o600 });
    fs.renameSync(temporary, this.file);
    this.sites = sites;
  }

  async update(engine, window, tab, { origin, permission, allowed }) {
    const locale = engine.locale || 'zh-CN';
    if (!permissionKeys.includes(permission) || typeof allowed !== 'boolean') throw new Error(tMain(locale, 'permInvalid'));
    const isCurrent = () => Boolean(origin && engine.active === tab.id && !tab.view.webContents.isDestroyed() &&
      siteOrigin(tab.view.webContents.getURL()) === origin);
    if (!isCurrent()) throw new Error(tMain(locale, 'permSiteChanged'));
    if (this.has(origin, permission) === allowed) return;
    const affectedTabs = () => [...engine.tabs.values()].filter(candidate =>
      candidate.sitePermissionUse.has(permission) && !candidate.view.webContents.isDestroyed() &&
      siteOrigin(candidate.view.webContents.getURL()) === origin);
    if (!allowed && affectedTabs().length) {
      const permName = tMain(locale, permissionLabelKey[permission]);
      const { response } = await dialog.showMessageBox(window, {
        type: 'warning',
        message: tMain(locale, 'permRevokeTitle', permName),
        detail: tMain(locale, 'permRevokeDetail'),
        buttons: [tMain(locale, 'cancel'), tMain(locale, 'revokeAndReload')],
        defaultId: 0,
        cancelId: 0,
      });
      if (response !== 1 || !isCurrent()) return;
    }
    this.save(origin, permission, allowed);
    if (!allowed) for (const candidate of affectedTabs()) candidate.view.webContents.reload();
    engine.emit();
  }
}

function chooseDisplaySource(window, sources, locale) {
  return new Promise(resolve => {
    let selected;
    const items = sources.map(source => ({
      label: source.name.replaceAll('&', '&&').slice(0, 130) || tMain(locale, 'unnamedWindow'),
      click: () => { selected = source; resolve(source); },
    }));
    items.push({ type: 'separator' }, { label: tMain(locale, 'cancelShare'), click: () => resolve(null) });
    Menu.buildFromTemplate(items).popup({
      window, callback: () => setImmediate(() => resolve(selected ?? null)),
    });
  });
}

export function installSitePermissions(session, engine, window) {
  const store = engine.sitePermissions;
  let displayPromptOpen = false;
  let choosingDisplay = false;
  const findTab = (contents, origin, details, foreground) => {
    if (!contents || !origin || details?.isMainFrame !== true ||
        (details.securityOrigin && siteOrigin(details.securityOrigin) !== origin)) return null;
    const tab = [...engine.tabs.values()].find(candidate => candidate.view.webContents === contents);
    return tab && !contents.isDestroyed() && siteOrigin(contents.getURL()) === origin &&
      (!foreground || tab.id === engine.active) ? tab : null;
  };

  session.setPermissionCheckHandler((contents, permission, url, details) => {
    if (permission === 'clipboard-sanitized-write') {
      return engine.allowClipboardPermission(contents, permission, url, details);
    }
    const origin = siteOrigin(url);
    if (permission === 'notifications' && !contents) {
      return store.has(origin, 'notifications') &&
        (!details?.embeddingOrigin || siteOrigin(details.embeddingOrigin) === origin);
    }
    const tab = findTab(contents, origin, details, permission !== 'notifications');
    if (!tab) return false;
    if (permission === 'media') {
      if (details.mediaType === 'unknown') return store.has(origin, 'camera') && store.has(origin, 'microphone');
      return store.has(origin, mediaPermissions[details.mediaType]);
    }
    const key = permission === 'display-capture' ? 'screen' : permission;
    return ['screen', 'geolocation', 'notifications'].includes(key) && store.has(origin, key);
  });

  session.setPermissionRequestHandler((contents, permission, callback, details) => {
    const url = details?.requestingUrl;
    if (permission === 'clipboard-sanitized-write') {
      callback(engine.allowClipboardPermission(contents, permission, url, details));
      return;
    }
    const origin = siteOrigin(url);
    const tab = findTab(contents, origin, details, permission !== 'notifications');
    if (!tab) { callback(false); return; }
    if (permission === 'display-capture') {
      if (!store.has(origin, 'screen') || !window.isFocused() || displayPromptOpen || choosingDisplay) {
        callback(false);
        return;
      }
      const locale = engine.locale || 'zh-CN';
      const epoch = tab.epoch;
      displayPromptOpen = true;
      dialog.showMessageBox(window, {
        type: 'warning',
        message: tMain(locale, 'screenPromptTitle'),
        detail: tMain(locale, 'screenPromptDetail', origin),
        buttons: [tMain(locale, 'cancel'), tMain(locale, 'continueShare')],
        defaultId: 0,
        cancelId: 0,
      }).then(({ response }) => {
        const allowed = response === 1 && tab.epoch === epoch &&
          Boolean(findTab(contents, origin, details, true)) && store.has(origin, 'screen');
        if (allowed) tab.sitePermissionUse.add('screen');
        return allowed;
      }, () => false).then(allowed => {
        displayPromptOpen = false;
        callback(allowed);
      });
      return;
    }
    if (permission === 'media') {
      const requested = (details.mediaTypes ?? []).map(type => mediaPermissions[type]);
      const allowed = requested.length > 0 && requested.every(key => store.has(origin, key));
      if (allowed) for (const key of requested) tab.sitePermissionUse.add(key);
      callback(allowed);
      return;
    }
    const allowed = ['geolocation', 'notifications'].includes(permission) && store.has(origin, permission);
    if (allowed && permission === 'geolocation') tab.sitePermissionUse.add(permission);
    callback(allowed);
  });

  session.setDisplayMediaRequestHandler((request, callback) => {
    const tab = engine.tabs.get(engine.active);
    const contents = tab?.view.webContents;
    const epoch = tab?.epoch;
    const origin = siteOrigin(request.securityOrigin);
    const canShare = () => Boolean(tab && engine.active === tab.id && tab.epoch === epoch &&
      !contents.isDestroyed() && request.frame && request.frame === contents.mainFrame &&
      siteOrigin(contents.getURL()) === origin && store.has(origin, 'screen'));
    if (!request.userGesture || !request.videoRequested || !canShare() || choosingDisplay) {
      callback(null);
      return;
    }
    choosingDisplay = true;
    const locale = engine.locale || 'zh-CN';
    desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 0, height: 0 } })
      .then(sources => sources.length && canShare() ? chooseDisplaySource(window, sources, locale) : null)
      .then(source => source && canShare() ? { video: source } : null)
      .catch(() => null)
      .then(streams => {
        choosingDisplay = false;
        callback(streams);
      });
  });
}
