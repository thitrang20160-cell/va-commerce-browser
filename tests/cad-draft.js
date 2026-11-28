import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { generateModelDraft, inferDraftSpec } from '../src/cad-draft-engine.js';
import { startCadDraftMcpServer } from '../scripts/cad-draft-mcp.mjs';

const mkTmp = prefix => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

test('inferDraftSpec auto-detects silicone mat template and converts 34" x 22" title dimensions to mm', () => {
  const spec = inferDraftSpec({
    asin: 'B0CSNXRQDT',
    title: 'Waterproof Under Sink Mat 34" x 22", Silicone Mat, Beige',
    teardown: { pain_points: { themes: [{ key: 'thin', hits: 4 }, { key: 'leak', hits: 2 }] } },
  });
  assert.equal(spec.template, 'silicone_mat');
  assert.equal(spec.material, 'food_grade_silicone');
  assert.equal(spec.length_mm, 863.6);
  assert.equal(spec.width_mm, 558.8);
  assert.ok(spec.wall_mm >= 2.8);
  assert.ok(spec.height_mm >= 24);
});

test('generateModelDraft produces valid ISO-10303-21 STEP, watertight binary STL, DXF, SVG, CadQuery script & DFM check', () => {
  const dir = mkTmp('vamoon-cad-');
  const draft = generateModelDraft({
    asin: 'B0CSNXRQDT',
    title: 'Waterproof Under Sink Mat 34" x 22"',
    template: 'silicone_mat',
    material: 'food_grade_silicone',
    length_mm: 864,
    width_mm: 559,
    height_mm: 22,
    wall_mm: 2.5,
    corner_radius_mm: 14,
    draft_deg: 2.0,
    diff_note: '加厚2.5mm + 导流排水边',
  }, dir);

  assert.equal(draft.ok, true);
  assert.ok(draft.dfm.weight_g > 1000 && draft.dfm.weight_g < 2500);
  assert.equal(draft.dfm.fba_tier, 'Roll-Pack Standard');
  assert.equal(draft.dfm.warn_count, 0);

  // Verify STEP AP214 file structure
  const step = fs.readFileSync(draft.files.step, 'utf8');
  assert.ok(step.startsWith('ISO-10303-21;'));
  assert.ok(step.includes('MANIFOLD_SOLID_BREP'));
  assert.ok(step.includes('ADVANCED_FACE'));
  assert.ok(step.trim().endsWith('END-ISO-10303-21;'));

  // Verify Binary STL exact byte size: 84 header + triCount * 50 bytes
  const stl = fs.readFileSync(draft.files.stl);
  const triCount = stl.readUInt32LE(80);
  assert.equal(triCount, draft.dfm.triangle_count);
  assert.equal(stl.length, 84 + triCount * 50);

  // Verify DXF, SVG, CadQuery script, and Tech Pack exist and have real content
  assert.ok(fs.readFileSync(draft.files.dxf, 'utf8').includes('ENTITIES'));
  assert.ok(fs.readFileSync(draft.files.svg, 'utf8').includes('<svg'));
  assert.ok(fs.readFileSync(draft.files.cadquery_py, 'utf8').includes('import cadquery as cq'));
  assert.ok(fs.readFileSync(draft.files.techpack_md, 'utf8').includes('加厚2.5mm'));

  // Verify DFM catches thin wall + oversize rigid bin
  const warnDraft = generateModelDraft({
    template: 'storage_bin',
    material: 'pp_plastic',
    length_mm: 520,
    width_mm: 360,
    height_mm: 220,
    wall_mm: 1.0,
    draft_deg: 0.5,
    corner_radius_mm: 1,
  }, dir);
  assert.ok(warnDraft.dfm.warn_count >= 3);
  assert.equal(warnDraft.dfm.fba_tier, 'Oversize Warning');
});

test('Standalone cad-draft-mcp.mjs serves tools over real Streamable HTTP MCP and generates drafts', async () => {
  const dir = mkTmp('vamoon-cad-mcp-');
  const srv = await startCadDraftMcpServer({ port: 0, outRootDir: dir });
  const client = new Client({ name: 'cad-mcp-test', version: '1.0.0' }, { capabilities: {} });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(srv.endpoint)));
    const tools = (await client.listTools()).tools.map(t => t.name);
    assert.ok(tools.includes('cad_list_templates'));
    assert.ok(tools.includes('cad_generate_draft'));

    const res = await client.callTool({
      name: 'cad_generate_draft',
      arguments: {
        asin: 'B0TEST1234',
        template: 'organizer_tray',
        material: 'abs_plastic',
        length_mm: 280,
        width_mm: 180,
        height_mm: 60,
        wall_mm: 2.2,
        compartments_x: 3,
        compartments_y: 2,
      },
    });
    assert.equal(res.isError, undefined);
    assert.equal(res.structuredContent.ok, true);
    assert.equal(fs.existsSync(res.structuredContent.files.step), true);
    assert.equal(fs.existsSync(res.structuredContent.files.stl), true);
  } finally {
    await client.close().catch(() => {});
    await srv.close();
  }
});
