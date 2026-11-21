import assert from 'node:assert/strict';
import { test } from 'node:test';
import { discoveryIntent, scoreDiscovery } from '../src/product-discovery.js';

const product=(asin,fields)=>({asin,title:asin,url:'https://www.amazon.com/dp/'+asin,signals:fields});
const a=product('B011111111',{listed_price:28,bought_signal_lower:500,rating:4.5});
const b=product('B022222222',{listed_price:42,bought_signal_lower:100,rating:4.6});
const dated='2026-11-20T10:00:00Z';

test('Recognized intent uses explicit editable overrides without asking for links',()=>{
  const p=discoveryIntent({intent:'厨房收纳，售价 $20–50，平台仓，月销至少500，竞争度小于1',price_max:45});
  assert.equal(p.keyword,'kitchen storage organization');
  assert.equal(p.price_min,20);
  assert.equal(p.price_max,45);
  assert.equal(p.fulfillment,'fba');
  assert.equal(p.demand_min,500);
  assert.equal(p.competition_max,1);
  assert.throws(()=>discoveryIntent({price_min:40,price_max:38}),{code:'INVALID_DISCOVERY_FILTER'});
});

test('Public purchase signal remains a lower bound and cannot exclude unknown actual sales or imply competitive data',()=>{
  const [first,second]=scoreDiscovery([a,b],discoveryIntent({demand_min:500}),[],dated);
  assert.equal(first.asin,a.asin);
  assert.equal(first.data.demand_kind,'public_purchase_signal_lower');
  assert.equal(first.data.competition,null);
  assert.equal(second.decision,'needs_evidence');
});

test('Profit ranks comparable monthly scenarios, with unit contribution as the shared fallback',()=>{
  const rows=scoreDiscovery([a,b],discoveryIntent({strategy:'profit',target_profit:300}),[
    {asin:a.asin,unit_variable_cost:25,own_sales_scenario:1000},
    {asin:b.asin,unit_variable_cost:35,own_sales_scenario:80},
  ],dated);
  assert.equal(rows[0].asin,a.asin);
  assert.equal(rows[0].ranking_basis,'monthly_contribution_scenario');
  assert.equal(rows[0].data.monthly_contribution,3000);
  assert.equal(rows[1].data.monthly_contribution,560);
  assert.equal(rows[1].data.target_profit_units,43);
  const fallback=scoreDiscovery([a,b],discoveryIntent({strategy:'profit'}),[
    {asin:a.asin,unit_variable_cost:25},{asin:b.asin,unit_variable_cost:35,own_sales_scenario:80},
  ],dated);
  assert.equal(fallback[0].asin,b.asin);
  assert.equal(fallback[0].ranking_basis,'unit_contribution');
});

test('Missing authorities and positive risk evidence are separated and first seen is not listing age',()=>{
  const rows=scoreDiscovery([a,b],discoveryIntent({require_ip_review:true,listing_age_days_max:100}),[
    {asin:b.asin,risk:'high'},
  ],dated,{[a.asin]:'2026-11-01T01:00:00Z'});
  assert.equal(rows[0].decision,'needs_evidence');
  assert.equal(rows[0].data.listed_at,null);
  assert.equal(rows[0].data.first_seen,'2026-11-01T01:00:00Z');
  assert.equal(rows[1].decision,'excluded');
});
