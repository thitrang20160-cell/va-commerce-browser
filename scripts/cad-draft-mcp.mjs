#!/usr/bin/env node
/**
 * Standalone Streamable HTTP MCP server for Parametric CAD Model Drafts.
 * Exposes cad_list_templates, cad_infer_spec, cad_dfm_check, cad_generate_draft.
 * Usage: node scripts/cad-draft-mcp.mjs [--port 18990] [--out-dir ./drafts]
 */
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import {
  CAD_MATERIALS,
  CAD_TEMPLATES,
  generateModelDraft,
  inferDraftSpec,
  normalizeDraftSpec,
  runDfmCheck,
} from '../src/cad-draft-engine.js';

function createCadMcpServer(outRootDir) {
  const server = new McpServer({ name: 'va-cad-draft-mcp', version: '0.9.0' });

  server.tool(
    'cad_list_templates',
    'List supported parametric e-commerce Model Draft templates and manufacturing materials.',
    {},
    async () => {
      const payload = { templates: CAD_TEMPLATES, materials: Object.values(CAD_MATERIALS) };
      return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }], structuredContent: payload };
    }
  );

  server.tool(
    'cad_infer_spec',
    'Infer a parametric Model Draft spec (template, mm dimensions, wall thickness, draft angle) from product title, keyword, and pain points.',
    {
      asin: z.string().max(20).optional(),
      title: z.string().max(300),
      keyword: z.string().max(160).optional(),
      diff_note: z.string().max(500).optional(),
    },
    async args => {
      const spec = inferDraftSpec(args);
      return { content: [{ type: 'text', text: JSON.stringify(spec, null, 2) }], structuredContent: spec };
    }
  );

  const specShape = {
    template: z.enum(['silicone_mat', 'storage_bin', 'organizer_tray', 'stand_holder']).optional(),
    material: z.enum(['food_grade_silicone', 'pp_plastic', 'abs_plastic', 'pet_clear', 'aluminum_6061', 'acrylic']).optional(),
    length_mm: z.number().min(30).max(1500).optional(),
    width_mm: z.number().min(30).max(1200).optional(),
    height_mm: z.number().min(6).max(600).optional(),
    wall_mm: z.number().min(0.8).max(25).optional(),
    corner_radius_mm: z.number().min(0).max(60).optional(),
    draft_deg: z.number().min(0).max(15).optional(),
    compartments_x: z.number().int().min(1).max(8).optional(),
    compartments_y: z.number().int().min(1).max(6).optional(),
    asin: z.string().max(20).optional(),
    title: z.string().max(200).optional(),
    diff_note: z.string().max(500).optional(),
  };

  server.tool(
    'cad_dfm_check',
    'Run engineering DFM, exact volume/weight, material cost, and Amazon US FBA size-tier checks on a parametric draft spec.',
    specShape,
    async args => {
      const spec = normalizeDraftSpec(args);
      const draft = generateModelDraft(spec, os.tmpdir());
      const out = { spec: draft.spec, dfm: draft.dfm };
      return { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }], structuredContent: out };
    }
  );

  server.tool(
    'cad_generate_draft',
    'Generate a factory-oriented Model Draft package (.STEP AP214, watertight Binary .STL, 2D .DXF, 4-view .SVG blueprint, CadQuery .py script, and RFQ Tech Pack .md).',
    specShape,
    async args => {
      const result = generateModelDraft(args, outRootDir);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], structuredContent: result };
    }
  );

  return server;
}

export async function startCadDraftMcpServer({ port = 18990, outRootDir = path.join(os.tmpdir(), 'va-model-drafts') } = {}) {
  const httpServer = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, app: 'va-cad-draft-mcp', version: '0.9.0' }));
      return;
    }
    if (url.pathname !== '/mcp') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found. Use /mcp' }));
      return;
    }
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Use POST /mcp' }));
      return;
    }
    const chunks = [];
    for await (const c of req) chunks.push(c);
    let body = {};
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch {}
    const mcp = createCadMcpServer(outRootDir);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { void transport.close(); void mcp.close(); });
    await mcp.connect(transport);
    await transport.handleRequest(req, res, body);
  });

  await new Promise(resolve => httpServer.listen(port, '127.0.0.1', resolve));
  const actualPort = httpServer.address().port;
  return {
    port: actualPort,
    endpoint: `http://127.0.0.1:${actualPort}/mcp`,
    close: () => new Promise(resolve => httpServer.close(resolve)),
  };
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
if (isCli) {
  const arg = name => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; };
  const port = Number(arg('--port') ?? 18990);
  const outRootDir = arg('--out-dir') || path.join(os.homedir(), 'Downloads', 'VA-Model-Drafts');
  startCadDraftMcpServer({ port, outRootDir }).then(srv => {
    console.log(`VA CAD Draft MCP listening on ${srv.endpoint} (out: ${outRootDir})`);
  });
}
