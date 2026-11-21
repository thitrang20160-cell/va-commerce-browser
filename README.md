# VA电商浏览器 AI版 · VA Commerce Browser

An open-source desktop browser with MCP tools for AI agents. Read one tab, search in another, and keep your current page in view.

一个供 AI 调用的桌面浏览器。让 Agent 在后台搜索、读网页和采集商品线索，前台继续浏览你的页面。

## Quick start

Install Node.js 22 or later, then run these commands from the checkout.

```bash
npm ci
npm start
```

The desktop window opens with a local sample form that you can test without a website account. The first run downloads Electron when you install dependencies.

## Connect an AI agent

Register the following **MCP stdio** server in an MCP client. Replace the path with the absolute path to the checkout on your computer.

```json
{
  "mcpServers": {
    "va_commerce_browser": {
      "command": "node",
      "args": ["/absolute/path/to/va-commerce-browser/src/bridge.js", "--client", "my-agent"]
    }
  }
}
```

Try asking your agent:

> List my browser tabs. Open the local demo in a background tab and read its form without switching the tab I'm viewing.

Use `browser_tabs` to identify tabs, `browser_snapshot` for accessible elements, and `browser_collect_batch` to read up to six tabs. Actions use per-tab leases, current element references and request IDs. The desktop sidebar lets you pause the agent and take over.

## Product discovery

`browser_product_discover` ranks visible results on Amazon US. Pass a keyword or an open results tab, then supply filters for price, purchase signals or review count. The tool returns source links and marks missing evidence. Use public purchase badges and review counts as preliminary indicators. Supplier costs and market competition need their own evidence.

Example arguments for an MCP client:

```json
{
  "keyword": "silicone under sink mat",
  "price_min": 13,
  "price_max": 25,
  "demand_min": 500,
  "reviews_max": 3000,
  "strategy": "balanced"
}
```

## Local data and scope

- The public edition uses its own local browser profile. It exposes a loopback service and an MCP stdio bridge for trusted local clients.
- The release includes background page reads, tab watches, page actions, structured product discovery and supported video observations. Video transcription requires separately configured local tools and model files.
- The hosted remote gateway and private SellerStar connectors belong to the internal build.

Website content should be treated as untrusted data. Review the target and action before authorizing changes to third-party websites.

## Contribute

Run `npm test` before submitting a patch. For bug reports, include your OS, Node version, the MCP tool name and a reproducible sample without account details.

If the browser makes your agent workflow easier, a GitHub Star helps other users find it.

[MIT License](LICENSE)
