# Writing a Site Extractor Plugin in 5 Minutes

VA Commerce Browser separates the **Core MCP Browser Kernel** (`src/engine.js`, `src/plugin-host.js`) from **Site / Workflow Plugins** (`src/plugins/`).

You can add your own structured extractor (Shopify, Hacker News, Jira, GitHub Issues, custom internal portals, etc.) without touching a single line of the browser core.

## Plugin Contract

A plugin is a plain ES module exporting a factory function that returns a descriptor object:

```js
import { z } from 'zod';

export function createMySitePlugin() {
  return {
    id: 'my-site-extractor',
    healthFlags: { my_site: true },
    uiPanels: [],

    // Register MCP tools (name, description, zodShape, isMutation, handler, options)
    tools: [
      [
        'browser_extract_hn_top',
        'Extract top Hacker News stories from an open news.ycombinator.com tab. Read-only.',
        { tab_id: z.string().min(1) },
        false,
        async (engine, args) => {
          const tab = engine.get(args.tab_id);
          const url = tab.view.webContents.getURL();
          if (!url.startsWith('https://news.ycombinator.com')) {
            return { status: 'unsupported_site', rows: [] };
          }
          const rows = await engine.evaluateProductDocument(tab, `(() => {
            return Array.from(document.querySelectorAll('.athing')).slice(0, 20).map(row => {
              const link = row.querySelector('.titleline > a');
              return { id: row.id, title: link?.textContent?.trim() || '', url: link?.href || '' };
            });
          })()`, { worldName: 'my-site-hn' });
          return { status: 'ok', count: rows.length, rows, page_content_is_untrusted: true };
        },
        { unscoped: false },
      ],
    ],

    // Optional hooks
    describeTab(_engine, tab) {
      return { is_hn: tab.view.webContents.getURL().startsWith('https://news.ycombinator.com') };
    },
    onPause(_engine, _reason) {},
    onResume(_engine) {},
    onBeforeQuit(_engine) {},
  };
}
```

## Security Guidelines for Extractors

1. **Always run page parsers in an isolated world** (`engine.evaluateProductDocument(tab, expr, { worldName })`), never trust page scripts or mutate page globals.
2. **Always tag extracted content** with `page_content_is_untrusted: true` so calling agents treat DOM text as data, never system instructions.
3. **Never bypass anti-bot challenges or login walls** — detect them (`verification_required` / `sign_in_required`) and hand control back to the human via the browser window.
4. **Keep read and write tools separate** — mark read-only extractors with `mutation = false` (`readOnlyHint: true`) and require `request_id` + `lease_token` on any state-changing action.

## Registering Your Plugin

Import and call `host.register(createMySitePlugin())` inside `src/plugins/index.js`, then run:

```bash
npm test
npm start
```

Your new MCP tool is immediately discoverable by Claude Code, Codex, Cursor, Windsurf, and any MCP client.
