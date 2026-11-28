import fs from 'node:fs';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export const HUB_SERVICES = [
  {
    id: 'safesellai',
    name: 'SafeSellAI 侵权全查',
    nameEn: 'SafeSellAI IP Compliance',
    defaultUrl: 'https://safesellai.com/mcp',
    description: '865万商标库 + 18,726起TRO + 64.5万外观专利图搜 + 涉诉版权库',
    descriptionEn: 'Trademark, TRO, Design Patent image search, Copyright & Logo vision',
    portalFallback: true,
  },
  {
    id: 'sellerlens',
    name: 'SellerLens 精品分析',
    nameEn: 'SellerLens Market Intel',
    defaultUrl: 'http://127.0.0.1:18988/mcp',
    description: '九站468万词库 + ABA/5年趋势 + 8/9维量化评分 + GO/WAIT/NO-GO决策',
    descriptionEn: '4.68M keywords, ABA & 5y Trends, 9-dim market score & GO/NO-GO verdict',
    portalFallback: true,
  },
  {
    id: 'sourcing_1688',
    name: '1688 货源寻源 MCP',
    nameEn: '1688 Sourcing MCP',
    defaultUrl: '',
    description: '以图找同款 / 源头工厂比价（未配置时复用塞星 1688 找货工作台或 1688 Skill）',
    descriptionEn: 'Image/keyword factory sourcing (falls back to ERP workbench or 1688 Skill)',
    portalFallback: true,
  },
];

function validateMcpUrl(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  const u = new URL(value);
  const isLoopback = ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname);
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && isLoopback)) {
    throw new Error('MCP 地址仅允许 HTTPS，或本机 http://127.0.0.1 / localhost。');
  }
  return u.href;
}

export function build1688AgentPrompt(item = {}) {
  const title = String(item.title || item.asin || '').trim();
  const asin = String(item.asin || '').trim();
  const price = item.price != null ? `$${Number(item.price).toFixed(2)}` : '未知';
  const img = item.image || '';
  const kw = item.keyword || '';
  return [
    `请使用 1688-product-find skill（或已连接的 1688 找货工具）帮我为以下亚马逊选品候选寻找 1688 源头同款工厂并比价（返回 TOP 3 报价、起订量、单件重量估算和 1688 详情链接）：`,
    `- ASIN：${asin || '未指定'}`,
    `- 标题：${title}`,
    kw ? `- 核心英文词：${kw}` : null,
    `- 亚马逊售价：${price}`,
    img ? `- 参考主图 URL（优先以图找同款 compare --image）：${img}` : null,
    item.url ? `- 亚马逊商品链接：${item.url}` : null,
  ].filter(Boolean).join('\n');
}

export class ProductHubStore {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.file = path.join(dataDir, 'product-hub.json');
    this.configs = this.load();
  }

  defaultConfigs() {
    const out = {};
    for (const svc of HUB_SERVICES) {
      out[svc.id] = {
        id: svc.id,
        enabled: false,
        url: svc.defaultUrl,
        token: '',
        last_checked_at: null,
        last_status: null,
        tools: [],
      };
    }
    return out;
  }

  load() {
    const base = this.defaultConfigs();
    try {
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      for (const svc of HUB_SERVICES) {
        if (saved?.[svc.id] && typeof saved[svc.id] === 'object') {
          base[svc.id] = { ...base[svc.id], ...saved[svc.id], id: svc.id };
        }
      }
    } catch {}
    return base;
  }

  save() {
    fs.mkdirSync(this.dataDir, { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.configs, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }

  getRaw(id) {
    return this.configs[id] || null;
  }

  isConfigured(id) {
    const cfg = this.configs[id];
    return Boolean(cfg && cfg.enabled && cfg.url);
  }

  // Sanitized view for UI / state — never exposes raw Bearer API keys
  snapshot({ portalConnected = false, portalTenant = '' } = {}) {
    return {
      portal_connected: Boolean(portalConnected),
      portal_tenant: portalTenant || '',
      services: HUB_SERVICES.map(meta => {
        const cfg = this.configs[meta.id] || {};
        return {
          id: meta.id,
          name: meta.name,
          name_en: meta.nameEn,
          description: meta.description,
          description_en: meta.descriptionEn,
          default_url: meta.defaultUrl,
          enabled: Boolean(cfg.enabled),
          url: cfg.url || meta.defaultUrl,
          has_token: Boolean(cfg.token),
          token_hint: cfg.token ? `${cfg.token.slice(0, 6)}…${cfg.token.slice(-4)}` : '',
          portal_fallback: Boolean(meta.portalFallback && portalConnected),
          ready: Boolean((cfg.enabled && cfg.url) || (meta.portalFallback && portalConnected)),
          mode_label: (cfg.enabled && cfg.url) ? 'mcp' : (meta.portalFallback && portalConnected ? 'portal' : 'unconfigured'),
          last_checked_at: cfg.last_checked_at || null,
          last_status: cfg.last_status || null,
          tools: Array.isArray(cfg.tools) ? cfg.tools.slice(0, 40) : [],
        };
      }),
    };
  }

  update(id, patch = {}) {
    if (!this.configs[id]) throw new Error('Unknown hub service: ' + id);
    const cur = this.configs[id];
    if (patch.url !== undefined) cur.url = validateMcpUrl(patch.url);
    if (typeof patch.enabled === 'boolean') cur.enabled = patch.enabled;
    if (typeof patch.token === 'string') {
      const trimmed = patch.token.trim();
      // Only overwrite if user provided a new non-empty value or explicitly cleared via clear_token
      if (trimmed) cur.token = trimmed;
    }
    if (patch.clear_token === true) cur.token = '';
    if (patch.last_checked_at !== undefined) cur.last_checked_at = patch.last_checked_at;
    if (patch.last_status !== undefined) cur.last_status = patch.last_status;
    if (Array.isArray(patch.tools)) cur.tools = patch.tools.slice(0, 60);
    this.save();
    return cur;
  }
}

async function withMcpClient(cfg, fn, { timeoutMs = 45000 } = {}) {
  const url = validateMcpUrl(cfg?.url);
  if (!url) throw new Error('尚未配置该产品的 MCP 服务地址。');
  const headers = {};
  if (cfg.token) headers.Authorization = `Bearer ${cfg.token}`;
  const client = new Client({ name: 'va-commerce-browser-hub', version: '0.8.0' }, { capabilities: {} });
  const transport = new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers } });
  const timer = setTimeout(() => { void client.close().catch(() => {}); }, timeoutMs);
  try {
    await client.connect(transport);
    return await fn(client);
  } finally {
    clearTimeout(timer);
    await client.close().catch(() => {});
  }
}

export async function testHubMcp(cfg) {
  const t0 = Date.now();
  const listed = await withMcpClient(cfg, c => c.listTools(), { timeoutMs: 15000 });
  const tools = (listed?.tools || []).map(t => t.name);
  return { ok: true, count: tools.length, tools, latency_ms: Date.now() - t0 };
}

function parseMcpToolJson(res) {
  if (res?.structuredContent && typeof res.structuredContent === 'object') return res.structuredContent;
  const text = (res?.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n').trim();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return { raw_text: text }; }
}

export async function runSafeSellMcpAudit(cfg, items, dims = {}) {
  const wantDesign = dims.design !== false;
  const wantCopyright = dims.copyright !== false;
  const wantVision = dims.vision !== false;
  const wantPatentText = dims.patent !== false;

  const args = {
    items: items.map(it => ({
      sku: String(it.asin || it.key || 'item'),
      title: String(it.title || '').slice(0, 500),
      brand: '', // Strict safesell-compliance rule: never pass competitor brand as own_brand
      category: String(it.category || '').slice(0, 120),
      ...(it.image ? { images: [it.image] } : {}),
    })),
    compliance: false,
    patent: wantPatentText,
    design_patent: wantDesign && items.some(i => i.image),
    copyright: wantCopyright && items.some(i => i.image),
    trademark_vision: wantVision && items.some(i => i.image),
  };

  const res = await withMcpClient(cfg, c => c.callTool({ name: 'store_audit', arguments: args }), { timeoutMs: 120000 });
  const parsed = parseMcpToolJson(res);
  if (!parsed || res?.isError) {
    throw new Error(parsed?.error || parsed?.raw_text || 'SafeSellAI MCP store_audit 返回异常');
  }
  const rows = parsed.items || parsed.data?.items || [];
  return normalizeSafeSellAuditRows(items, rows, 'safesellai_mcp');
}

export function normalizeSafeSellAuditRows(inputItems, auditedRows, source = 'safesellai_mcp') {
  const results = inputItems.map((src, idx) => {
    const row = auditedRows[idx] || null;
    if (!row) {
      return {
        key: src.asin || src.key,
        source,
        verdict: '无法判定',
        compliance_status: 'pending',
        dims: {},
        hits: [],
        refs: [],
        warnings: ['引擎未返回该商品结果'],
      };
    }
    const risks = Array.isArray(row.risks) ? row.risks : [];
    const troHits = Array.isArray(row.tro_hits) ? row.tro_hits : [];
    const hits = [
      ...risks.map(r => ({
        word: String(r.word || r.brand || ''),
        risk: String(r.risk || ''),
        action: String(r.action || ''),
        isTro: Boolean(r.isTro),
        reason: String(r.factLabel || r.advice || r.risk || ''),
      })),
      ...troHits.map(t => ({
        word: String(t.word || t.brand || ''),
        risk: '高风险',
        action: 'block',
        isTro: true,
        reason: '命中活跃 TRO 诉讼原告',
      })),
    ].filter(h => h.word);

    const dp = row.design_patent;
    const cr = row.copyright;
    const tv = row.trademark_vision;
    const up = row.utility_patent;

    const dims = {
      trademark_text: { scanned: true, hit_count: hits.length },
      ...(up ? { utility_patent: { scanned: true, hit_count: (up.matches || []).length } } : {}),
      ...(dp ? { design_patent: { scanned: Boolean(dp.scanned), hit_count: (dp.matches || []).length } } : {}),
      ...(cr ? { copyright: { scanned: Boolean(cr.scanned), hit_count: (cr.matches || []).length } } : {}),
      ...(tv ? { trademark_vision: { scanned: Boolean(tv.scanned), hit_count: ((tv.brands || []).length + (tv.characters || []).length) } } : {}),
    };

    const refs = [];
    for (const m of (dp?.matches || []).slice(0, 5)) {
      refs.push({ dim: '外观专利', label: String(m.patent_number || m.patent_id || ''), title: String(m.title || ''), owner: String(m.assignee || ''), similarity: m.similarity ?? null });
    }
    for (const m of (cr?.matches || []).slice(0, 5)) {
      refs.push({ dim: '版权', label: String(m.id || m.title || ''), title: String(m.title || ''), owner: String(m.owner || m.author || ''), similarity: m.similarity ?? null });
    }
    for (const b of (tv?.brands || []).slice(0, 5)) refs.push({ dim: '图形商标', label: String(b.name || b), owner: '' });
    for (const c of (tv?.characters || []).slice(0, 5)) refs.push({ dim: '图形角色', label: String(c.name || c), owner: '' });
    for (const u of (up?.matches || []).slice(0, 3)) {
      refs.push({ dim: '发明专利(文字)', label: String(u.patent_number || u.patent_id || ''), title: String(u.title || ''), owner: String(u.assignee || '') });
    }

    const sev = Number(row.max_severity) || 0;
    const overall = String(row.overall_risk || '');
    const acts = row.actions || {};
    const anyBlocked = troHits.length > 0 || (Number(acts.block) || 0) > 0 || sev >= 4 || overall === '禁止使用' || overall === '高风险';
    const anyMid = (Number(acts.rewrite) || 0) > 0 || sev === 3 || overall === '中风险';
    const unScanned = Object.values(dims).some(d => d.scanned === false);

    const verdict = anyBlocked ? '命中风险' : anyMid ? '改写后可上' : unScanned ? '部分未查成' : '可上';
    const compliance_status = anyBlocked ? 'rejected' : (!unScanned && !anyMid ? 'passed' : 'pending');

    return {
      key: src.asin || src.key,
      source,
      checked_at: new Date().toISOString(),
      verdict,
      compliance_status,
      overall_risk: overall || null,
      dims,
      hits: hits.slice(0, 12),
      refs: refs.slice(0, 12),
      warnings: Array.isArray(row.warnings) ? row.warnings : [],
      caveat: '判定结果来自 SafeSellAI 引擎风险信号（非法律意见）；「未查成」维度不代表无风险，专利库存在公开延迟。',
    };
  });
  return { source, results };
}

export async function runSellerLensMcpAnalyze(cfg, keyword, marketplace = 'US') {
  return withMcpClient(cfg, async client => {
    const listed = await client.listTools();
    const names = (listed?.tools || []).map(t => t.name);
    const deepTool = names.find(n => /deep.?dive|keyword.*analy|market_keyword/i.test(n)) || names[0];
    if (!deepTool) throw new Error('SellerLens MCP 未暴露可用的关键词分析工具。');
    const res = await client.callTool({
      name: deepTool,
      arguments: { keyword, marketplace: marketplace.toLowerCase() },
    });
    const parsed = parseMcpToolJson(res);
    if (!parsed || res?.isError) throw new Error(parsed?.error || parsed?.raw_text || 'SellerLens MCP 返回异常');
    return {
      source: 'sellerlens_mcp',
      tool: deepTool,
      keyword,
      checked_at: new Date().toISOString(),
      raw: parsed,
      composite_score: parsed.composite_score ?? parsed.score ?? null,
      tier: parsed.tier || null,
      ai_verdict: parsed.ai_verdict || parsed.decision_verdict || null,
      ai_headline: parsed.ai_headline || parsed.decision_headline || parsed.summary || null,
      aba_rank: parsed.aba_rank ?? parsed.overview?.latest_rank ?? null,
      trend_label: parsed.trend_forecast?.label_zh || parsed.trend_label || null,
    };
  }, { timeoutMs: 45000 });
}

export async function run1688McpSearch(cfg, item) {
  return withMcpClient(cfg, async client => {
    const listed = await client.listTools();
    const names = (listed?.tools || []).map(t => t.name);
    const tool = item.image
      ? (names.find(n => /compare|image.?search|find/i.test(n)) || names[0])
      : (names.find(n => /text.?search|search|find/i.test(n)) || names[0]);
    if (!tool) throw new Error('1688 MCP 未暴露可用的找货工具。');
    const args = item.image
      ? { image: item.image, imageUrl: item.image, query: item.keyword || item.title }
      : { query: item.keyword || item.title };
    const res = await client.callTool({ name: tool, arguments: args });
    const parsed = parseMcpToolJson(res);
    if (!parsed || res?.isError) throw new Error(parsed?.error || parsed?.raw_text || '1688 MCP 调用失败');
    return { source: '1688_mcp', tool, data: parsed };
  }, { timeoutMs: 45000 });
}
