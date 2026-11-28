import { z } from 'zod';
import { discoverProducts, exportDiscoveryReport } from '../product-discovery.js';

const metric = z.number().min(0).max(1000000000).optional();
const dateField = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const amazonAsin = z.string().regex(/^[A-Z0-9]{10}$/);

export const discoveryArgs = {
  tab_id: z.string().min(1).optional(),
  intent: z.string().max(1000).optional(),
  keyword: z.string().trim().min(1).max(120).optional(),
  price_min: metric,
  price_max: metric,
  demand_min: metric,
  competition_max: metric,
  reviews_max: metric,
  rating_min: z.number().min(0).max(5).optional(),
  listing_age_days_max: metric,
  exposure_min: metric,
  min_contribution: metric,
  target_profit: metric,
  scenario_unit_cost: metric,
  require_ip_review: z.boolean().optional(),
  fulfillment: z.enum(['fba', 'fbm', 'either']).optional(),
  strategy: z.enum(['balanced', 'profit', 'trend']).optional(),
  evidence: z.array(z.object({
    asin: amazonAsin,
    source: z.string().trim().min(1).max(100),
    as_of: dateField,
    sales_30d: metric,
    searches_30d: metric,
    effective_competitors: metric,
    peer_density: metric,
    impressions_30d: metric,
    listed_at: dateField.optional(),
    trend_pct: z.number().min(-100).max(1000000).optional(),
    unit_variable_cost: metric,
    own_sales_scenario: metric,
    fulfillment: z.enum(['fba', 'fbm', 'either']).optional(),
    risk: z.enum(['reviewed', 'high', 'unknown']).optional(),
    source_url: z.string().url().regex(/^https:\/\//i).max(1000).optional(),
  }).strict()).max(30).optional(),
};

export function createOssDiscoveryPlugin({ mode = 'oss' } = {}) {
  const description = mode === 'oss'
    ? 'Run Amazon US product discovery from an explicit search keyword or an existing results tab. Pass structured user filters and optional attributed evidence. Returns up to 10 ranked candidates from 30 observed products, distinguishing unknown fields and scenarios. Read-only with respect to the marketplace.'
    : 'Run Amazon US product discovery from an explicit search keyword or an existing results tab. Pass structured user filters and optional attributed evidence. Returns up to 10 ranked candidates from 30 observed products, distinguishing unknown fields and scenarios. Never collects items into SellerStar. Ask for selection before using the batch write tools.';

  return {
    id: 'oss-discovery',
    healthFlags: { product_discovery: true },
    uiPanels: ['product-discovery'],
    tools: [
      [
        'browser_product_discover',
        description,
        discoveryArgs,
        true,
        (engine, args) => discoverProducts(engine, args),
        { unscoped: true },
      ],
    ],
    ipcHandlers: {
      'product-discovery': (payload, { engine }) =>
        engine.execute('browser_product_discover', z.object(discoveryArgs).strict().parse(payload), 'local-user'),
      'discovery-export': (payload, { engine, downloadDir }) => {
        const parsed = z.object({
          format: z.enum(['csv', 'json']),
          result: z.object({
            observed_at: z.string().optional(),
            plan: z.record(z.string(), z.unknown()).optional(),
            items: z.array(z.record(z.string(), z.unknown())).max(100),
          }).passthrough(),
        }).strict().parse(payload);
        return exportDiscoveryReport(parsed.result, parsed.format, downloadDir || engine.dataDir);
      },
    },
  };
}
