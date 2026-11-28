import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_MAX_HOT_RECEIPTS = 500;
const UNCERTAIN_STATUSES = new Set(['claimed', 'unknown']);

export class ReceiptStore {
  constructor(dataDir, { maxHotReceipts = DEFAULT_MAX_HOT_RECEIPTS } = {}) {
    this.dataDir = dataDir;
    this.maxHotReceipts = Math.max(10, Number(maxHotReceipts) || DEFAULT_MAX_HOT_RECEIPTS);
    this.journalPath = path.join(dataDir, 'receipts.json');
    this.records = fs.existsSync(this.journalPath)
      ? JSON.parse(fs.readFileSync(this.journalPath, 'utf8'))
      : {};
    this.archivedCount = 0;

    let dirty = this.reconcileLegacyPreflight();
    if (this.compactIfNeeded()) dirty = true;
    if (dirty) this.save();
  }

  reconcileLegacyPreflight() {
    let reconciled = false;
    for (const receipt of Object.values(this.records)) {
      // Older versions mislabeled these two pre-dispatch click checks as
      // uncertain. Retain their original error as evidence, without replaying.
      const match = receipt.tool === 'browser_click' && receipt.status === 'unknown' &&
        /^(?:Uncaught \(in promise\) )?Error: (Element is disabled or hidden|Element is covered)$/.exec(receipt.error?.message || '');
      if (!match) continue;
      receipt.preflight_reconciliation = {
        previous_status: receipt.status,
        previous_error: { ...receipt.error },
        reason: 'click_not_dispatched',
        at: new Date().toISOString(),
      };
      receipt.status = 'failed';
      receipt.error = {
        ...receipt.error,
        code: match[1] === 'Element is covered' ? 'ELEMENT_COVERED' : 'ELEMENT_NOT_INTERACTABLE',
      };
      reconciled = true;
    }
    return reconciled;
  }

  hasUncertain() {
    return Object.values(this.records).some(r => UNCERTAIN_STATUSES.has(r.status));
  }

  archivePathFor(isoDate) {
    const ym = /^\d{4}-\d{2}/.test(String(isoDate || ''))
      ? String(isoDate).slice(0, 7).replace('-', '')
      : new Date().toISOString().slice(0, 7).replace('-', '');
    return path.join(this.dataDir, `receipts-archive-${ym}.jsonl`);
  }

  compactIfNeeded() {
    const entries = Object.entries(this.records);
    const settled = entries.filter(([, entry]) => !UNCERTAIN_STATUSES.has(entry.status));
    if (settled.length <= this.maxHotReceipts) return false;
    settled.sort((a, b) => String(a[1].at || '').localeCompare(String(b[1].at || '')));
    const overflow = settled.length - this.maxHotReceipts;
    const toArchive = settled.slice(0, overflow);
    const grouped = new Map();
    for (const [key, entry] of toArchive) {
      const target = this.archivePathFor(entry.at);
      if (!grouped.has(target)) grouped.set(target, []);
      grouped.get(target).push(JSON.stringify({ key, ...entry }));
    }
    for (const [file, lines] of grouped) {
      fs.appendFileSync(file, lines.join('\n') + '\n', { mode: 0o600 });
    }
    for (const [key] of toArchive) {
      delete this.records[key];
      this.archivedCount++;
    }
    return true;
  }

  save() {
    this.compactIfNeeded();
    const temporary = this.journalPath + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify(this.records), { mode: 0o600 });
    fs.renameSync(temporary, this.journalPath);
  }

  get(key) {
    if (Object.hasOwn(this.records, key)) return this.records[key];
    return this.findArchived(key);
  }

  set(key, entry) {
    this.records[key] = entry;
  }

  values() {
    return Object.values(this.records);
  }

  recent(limit = 30) {
    return Object.values(this.records).slice(-limit).map(({ request_id, tool, status, at, client, tab_id, error }) => ({
      request_id, tool, status, at, client, tab_id, error,
    }));
  }

  findArchived(key) {
    let files;
    try {
      files = fs.readdirSync(this.dataDir)
        .filter(name => /^receipts-archive-\d{6}\.jsonl$/.test(name))
        .sort()
        .reverse();
    } catch {
      return null;
    }
    for (const name of files) {
      let content;
      try { content = fs.readFileSync(path.join(this.dataDir, name), 'utf8'); } catch { continue; }
      const lines = content.split('\n');
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i].trim();
        if (!line || !line.includes(key)) continue;
        try {
          const parsed = JSON.parse(line);
          if (parsed.key === key) {
            const { key: _ignored, ...entry } = parsed;
            return entry;
          }
        } catch {}
      }
    }
    return null;
  }
}
