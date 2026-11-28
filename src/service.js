import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcp } from './tools.js';
import packageInfo from '../package.json' with { type: 'json' };

export const DEMO = `<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<title>浏览器连接验证</title><style>
body{margin:0;background:#f4f6f8;color:#18313b;font:17px "Segoe UI","Microsoft YaHei",sans-serif}
main{max-width:780px;margin:55px auto;background:white;padding:40px;border-radius:20px}
h1{font-size:32px}label{display:block;margin:20px 0 8px}input,select,button,textarea{font:inherit;padding:12px;border:1px solid #bbc9d0;border-radius:8px}
button{background:#145e67;color:white;cursor:pointer}#result{padding:20px;background:#eef7f5;margin-top:24px}small{color:#547078}</style>
<main><small>VA电商浏览器 AI版 · 本地验证页</small><h1>从这里开始连接 Agent</h1>
<p>这是本机示例表单。Agent 可以读取、填写、点击，并核对生成的回执。</p>
<form id="form"><label for="name">项目名称</label><input id="name" name="name" placeholder="填写一个测试项目">
<label for="kind">任务类型</label><select id="kind"><option value="research">资料整理</option><option value="listing">商品信息</option></select>
<label for="notes">任务说明</label><textarea id="notes" rows="2"></textarea>
<label for="upload">示例附件</label><input type="file" id="upload"><p><button id="save">保存本地任务</button></p></form>
<div id="result" role="status">尚未保存</div><p><a href="/demo/download" download>下载示例回执</a></p>
<button disabled>不可操作的按钮</button>
<script>
let saves=0;
document.querySelector('#form').addEventListener('submit',e=>{e.preventDefault();saves++;
document.querySelector('#result').textContent='保存成功 · '+document.querySelector('#name').value+' · '+document.querySelector('#kind').value+' · 次数 '+saves});
document.querySelector('#upload').addEventListener('change',e=>{e.target.setAttribute('aria-label','已选择附件 '+e.target.files[0]?.name)});
</script></main></html>`;

function matches(actual, expected) {
  const a = Buffer.from(actual || '');
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function jsonBody(req) {
  const pieces = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new Error('Request body too large');
    pieces.push(chunk);
  }
  return JSON.parse(Buffer.concat(pieces).toString('utf8'));
}

export async function startService(engine, token, port = 18773) {
  const activeDefinitions = engine.toolDefinitions();
  const schemas = new Map(activeDefinitions.map(([name, , schema]) => [name, z.object(schema).strict()]));
  const server = http.createServer(async (req, res) => {
    const send = (status, value) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(value));
    };
    try {
      const host = req.headers.host || '';
      if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host) || req.headers.origin) return send(403, { error: 'INVALID_ORIGIN' });
      if (req.url === '/health' && req.method === 'GET') {
        return send(200, {
          app: 'vamoon-browser',
          version: packageInfo.version,
          mode: engine.mode,
          plugins: engine.plugins.ids(),
          ...engine.plugins.healthFlags(),
        });
      }
      if (req.url === '/demo' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'" });
        return res.end(DEMO);
      }
      if (req.url === '/demo/download' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Disposition': 'attachment; filename="local-receipt.txt"' });
        return res.end('Local browser test receipt');
      }
      if (!matches(req.headers.authorization, 'Bearer ' + token)) return send(401, { error: 'AUTH_REQUIRED' });
      const client = String(req.headers['x-agent-client'] || 'mcp-http').replace(/[^\w. -]/g, '').slice(0, 60) || 'mcp-http';
      if (req.url === '/mcp') {
        if (req.method !== 'POST') return send(405, { error: 'POST_REQUIRED' });
        const body = await jsonBody(req);
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
        const mcp = createMcp(client, (name, args, who) => engine.execute(name, args, who), activeDefinitions);
        res.on('close', () => { transport.close().catch(() => {}); mcp.close().catch(() => {}); });
        await mcp.connect(transport);
        return await transport.handleRequest(req, res, body);
      }
      if (req.url === '/rpc' && req.method === 'POST') {
        const body = await jsonBody(req);
        const schema = schemas.get(body.tool);
        if (!schema) return send(400, { error: 'UNKNOWN_TOOL' });
        const args = schema.parse(body.args || {});
        return send(200, { result: await engine.execute(body.tool, args, client) });
      }
      return send(404, { error: 'NOT_FOUND' });
    } catch (error) {
      if (!res.headersSent) send(400, { error: error.code || 'REQUEST_FAILED', message: error.message });
      else res.end();
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return { server, port: server.address().port };
}
