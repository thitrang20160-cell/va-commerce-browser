import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DependencyManager, DEP_SPECS, resolveFfmpegBinary } from '../src/dep-manager.js';
import { applyCadQueryCompileResult, generateModelDraft } from '../src/cad-draft-engine.js';
import { transcribeVideoAudio } from '../src/video-transcript.js';

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('DependencyManager enforces explicit customer consent before any install', async () => {
  const dir = mkTmp('va-dep-consent-');
  const dm = new DependencyManager(dir);

  await assert.rejects(
    () => dm.install('whisper_model'),
    err => err.code === 'CONSENT_REQUIRED'
  );
  await assert.rejects(
    () => dm.install('cadquery', { approved: false }),
    err => err.code === 'CONSENT_REQUIRED'
  );

  // Zero files or manifest consents written without approval
  assert.equal(fs.existsSync(path.join(dir, 'runtimes', 'manifest.json')), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('DependencyManager approved install streams progress, verifies, records consent, and uninstalls cleanly', async () => {
  const dir = mkTmp('va-dep-life-');
  const events = [];
  const dm = new DependencyManager(dir, {
    customRunner: async (spec, { report, dataDir }) => {
      assert.equal(spec.id, 'whisper_model');
      report(35, 'Downloading model…');
      const target = path.join(dataDir, ...spec.target_rel);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      // Write a file exceeding min_bytes (46 MB sparse/filled buffer -> use small buffer? No, write real 46MB or test file)
      const fd = fs.openSync(target, 'w');
      fs.ftruncateSync(fd, 46 * 1024 * 1024);
      fs.closeSync(fd);
      report(88, 'Download finished');
    },
  });

  const before = await dm.check('whisper_model');
  assert.equal(before.installed, false);
  assert.equal(before.removable, false);

  const installed = await dm.install('whisper_model', {
    approved: true,
    reason: 'unit_test_consent',
    onProgress: ev => events.push(ev),
  });

  assert.equal(installed.installed, true);
  assert.equal(installed.removable, true);
  assert.equal(installed.source, 'local_model');
  assert.ok(events.some(e => e.status === 'installing'));
  assert.ok(events.some(e => e.status === 'verifying'));
  assert.ok(events.some(e => e.status === 'installed' && e.pct === 100));

  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'runtimes', 'manifest.json'), 'utf8'));
  assert.equal(manifest.consents.whisper_model.approved, true);
  assert.equal(manifest.consents.whisper_model.reason, 'unit_test_consent');

  const afterUninstall = await dm.uninstall('whisper_model');
  assert.equal(afterUninstall.installed, false);
  assert.equal(fs.existsSync(path.join(dir, 'media-models', 'ggml-base-q5_1.bin')), false);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('DependencyManager listAll exposes all 4 managed capabilities and transcribeVideoAudio returns installable_dependency hint', async () => {
  const dir = mkTmp('va-dep-list-');
  const dm = new DependencyManager(dir);
  const res = await dm.listAll();
  assert.equal(res.items.length, DEP_SPECS.length);
  assert.deepEqual(
    res.items.map(i => i.id),
    ['cadquery', 'whisper_model', 'ffmpeg', 'sourcing_1688_cli']
  );

  // Video transcript returns actionable installable_dependency hint when model missing
  const tr = await transcribeVideoAudio(dir, { timing: 'continuous', start_seconds: 0, end_seconds: 5, playback_rate: 1 }, '', 'en');
  assert.equal(tr.status, 'local_model_unavailable');
  assert.equal(tr.installable_dependency, 'whisper_model');

  // resolveFfmpegBinary returns a string binary path
  assert.equal(typeof resolveFfmpegBinary(dir), 'string');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('applyCadQueryCompileResult upgrades draft kernel and recalculates exact OCCT weight/material cost', () => {
  const dir = mkTmp('va-dep-occt-');
  const draft = generateModelDraft({
    asin: 'B0CSNXRQDT',
    template: 'silicone_mat',
    material: 'food_grade_silicone',
    length_mm: 863.6,
    width_mm: 558.8,
    height_mm: 20,
    wall_mm: 2.5,
  }, dir);
  assert.equal(draft.kernel, 'builtin_parametric');

  const upgraded = applyCadQueryCompileResult(draft, {
    ok: true,
    kernel: 'cadquery_occt',
    cadquery_version: '2.5.2',
    volume_cm3: 1400,
    step_path: draft.files.step,
    stl_path: draft.files.stl,
  });
  assert.equal(upgraded.kernel, 'cadquery_occt');
  assert.equal(upgraded.source, 'cadquery_occt');
  assert.equal(upgraded.cadquery_version, '2.5.2');
  assert.equal(upgraded.dfm.volume_cm3, 1400);
  // 1400 cm³ * 1.15 g/cm³ = 1610 g = 1.61 kg
  assert.equal(upgraded.dfm.weight_g, 1610);
  assert.equal(upgraded.dfm.weight_kg, 1.61);

  fs.rmSync(dir, { recursive: true, force: true });
});
