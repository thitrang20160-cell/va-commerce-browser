import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcp } from './tools.js';
import packageInfo from '../package.json' with { type: 'json' };

export const DEMO = `<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<title>浏览器连接验证</title><style>
*{box-sizing:border-box}
body{margin:0;min-height:100vh;background:radial-gradient(ellipse 80% 55% at 50% 0%,rgba(45,212,191,.13),transparent 65%),#0b1016;color:#e8f1f5;font:15px Inter,"Segoe UI Variable","Microsoft YaHei UI",sans-serif;padding:42px 20px}
main{max-width:740px;margin:0 auto;background:#121922;border:1px solid rgba(255,255,255,.09);padding:34px 36px;border-radius:18px;box-shadow:0 24px 60px rgba(0,0,0,.4)}
.eyebrow{display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:999px;background:rgba(45,212,191,.12);border:1px solid rgba(45,212,191,.35);color:#2dd4bf;font:600 11.5px "JetBrains Mono",Consolas,monospace;margin-bottom:12px}
h1{font-size:28px;margin:0 0 8px;letter-spacing:-.5px;color:#f5fafc}
p.lead{color:#8fa6b2;margin:0 0 24px;line-height:1.6}
label{display:block;margin:16px 0 6px;font-size:13px;font-weight:600;color:#c2d4dc}
input,select,textarea{width:100%;font:inherit;padding:10px 13px;border:1px solid rgba(255,255,255,.12);border-radius:10px;background:#0a0f14;color:#eef5f8}
input:focus,select:focus,textarea:focus{outline:2px solid #2dd4bf;outline-offset:1px;border-color:#2dd4bf}
button{font:inherit;padding:10px 18px;border-radius:10px;border:1px solid #14b8a6;background:linear-gradient(135deg,#14b8a6,#0d8a81);color:#032221;font-weight:700;cursor:pointer}
button:hover{filter:brightness(1.08)}
button:disabled{background:#18222d;border-color:rgba(255,255,255,.08);color:#5d7380;cursor:not-allowed}
#result{padding:14px 16px;border-radius:10px;background:rgba(45,212,191,.1);border:1px solid rgba(45,212,191,.3);color:#99f6e4;margin-top:20px;font-family:"JetBrains Mono",Consolas,monospace;font-size:13px}
.foot{display:flex;align-items:center;justify-content:space-between;margin-top:18px;padding-top:16px;border-top:1px solid rgba(255,255,255,.08)}
a{color:#2dd4bf;text-decoration:none;font-weight:600}a:hover{text-decoration:underline}
</style>
<main><small class="eyebrow">VA电商浏览器 AI版 · 本地验证页</small><h1>从这里开始连接 Agent</h1>
<p class="lead">这是本机示例表单。Agent 可以读取、填写、点击，并核对生成的回执。</p>
<form id="form"><label for="name">项目名称</label><input id="name" name="name" placeholder="填写一个测试项目">
<label for="kind">任务类型</label><select id="kind"><option value="research">资料整理</option><option value="listing">商品信息</option></select>
<label for="notes">任务说明</label><textarea id="notes" rows="2"></textarea>
<label for="upload">示例附件</label><input type="file" id="upload"><p><button id="save">保存本地任务</button></p></form>
<div id="result" role="status">尚未保存</div><div class="foot"><a href="/demo/download" download>下载示例回执</a>
<button disabled>不可操作的按钮</button></div>
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
