import fs from 'node:fs';
import path from 'node:path';
import { collectionCandidates, productCandidatesExpression } from './product-candidates.js';

const keywordAliases = [
  [/厨房收纳/, 'kitchen storage organization'], [/园艺|庭院/, 'garden supplies'],
  [/办公用品|办公收纳/, 'office desk organizers'], [/浴室/, 'bathroom storage'],
  [/车载|汽车配件/, 'car accessories'], [/家居收纳|收纳/, 'home storage organization'],
  [/宠物用品|宠物/, 'pet supplies'],
];
const number = value => typeof value==='number' && Number.isFinite(value) ? value : null;
const fault = (code,message) => Object.assign(new Error(message),{code});

export function discoveryIntent(args) {
  const text=String(args.intent ?? '').trim();
  const price=text.match(/(?:售价|客单价|价格|\$|USD)\s*\$?\s*(\d+(?:\.\d+)?)\s*(?:-|–|—|~|到|至)\s*\$?\s*(\d+(?:\.\d+)?)/i);
  const sales=text.match(/(?:月销量|近30天销量|月销|销量)\s*(?:大于|至少|不低于|[>≥=])*\s*(\d+)/);
  const competition=text.match(/竞争度\s*(?:小于|低于|不高于|[<≤=])*\s*(\d+(?:\.\d+)?)/);
  const alias=keywordAliases.find(([pattern])=>pattern.test(text))?.[1];
  const keyword=String(args.keyword || alias || (/^[\p{Script=Latin}\d\s&'\-]+$/u.test(text) ? text : '')).trim();
  const plan={
    keyword,
    price_min:args.price_min ?? (price ? Number(price[1]) : null),
    price_max:args.price_max ?? (price ? Number(price[2]) : null),
    demand_min:args.demand_min ?? (sales ? Number(sales[1]) : null),
    competition_max:args.competition_max ?? (competition ? Number(competition[1]) : null),
    rating_min:args.rating_min ?? null,
    reviews_max:args.reviews_max ?? null,
    listing_age_days_max:args.listing_age_days_max ?? null,
    exposure_min:args.exposure_min ?? null,
    min_contribution:args.min_contribution ?? null,
    target_profit:args.target_profit ?? null,
    strategy:args.strategy ?? (/趋势|试水/.test(text) ? 'trend' : /利润优先/.test(text) ? 'profit' : 'balanced'),
    fulfillment:args.fulfillment || (/FBA|平台仓/i.test(text) ? 'fba' : /自发货|FBM/i.test(text) ? 'fbm' : 'either'),
    require_ip_review:args.require_ip_review ?? /低侵权风险|知识产权已核对/.test(text),
    scenario_unit_cost:args.scenario_unit_cost ?? null,
  };
  if (plan.price_min!==null && plan.price_max!==null && plan.price_min>plan.price_max) {
    throw fault('INVALID_DISCOVERY_FILTER','最低售价需要小于或等于最高售价。');
  }
  return plan;
}

const round = value => Math.round(value*100)/100;

export function scoreDiscovery(items, plan, evidence=[], observedAt=new Date().toISOString(), firstSeen={}) {
  const evidenceMap=new Map(evidence.map(row=>[row.asin,row]));
  const rows=items.slice(0,30).map((item,index)=>{
    const info=evidenceMap.get(item.asin) ?? {};
    const observed=item.signals ?? {};
    const salePrice=number(observed.listed_price);
    const demand=number(info.sales_30d) ?? number(observed.bought_signal_lower);
    const rating=number(observed.rating);
    const reviews=number(observed.reviews);
    const competition=info.searches_30d>0 && info.peer_density>0 && number(info.effective_competitors)!==null
      ? round(info.effective_competitors/info.searches_30d*1000/info.peer_density) : null;
    const exactCost=info.fulfillment===plan.fulfillment || plan.fulfillment==='either' ? number(info.unit_variable_cost) : null;
    const cost=exactCost ?? number(plan.scenario_unit_cost);
    const contribution=salePrice!==null && cost!==null ? round(salePrice-cost) : null;
    const ownSales=number(info.own_sales_scenario);
    const month=contribution!==null && ownSales!==null ? round(contribution*ownSales) : null;
    const units=plan.target_profit && contribution>0 ? Math.ceil(plan.target_profit/contribution) : null;
    const rejects=[], unknown=[], advantages=[];
    const min=(limit,value,label)=>{
      if (limit===null) return;
      if (value===null) unknown.push(label+'待核');
      else if (value<limit) rejects.push(label+'低于门槛');
    };
    const max=(limit,value,label)=>{
      if (limit===null) return;
      if (value===null) unknown.push(label+'待核');
      else if (value>limit) rejects.push(label+'高于门槛');
    };
    min(plan.price_min,salePrice,'售价');
    max(plan.price_max,salePrice,'售价');
    min(plan.rating_min,rating,'评分');
    max(plan.reviews_max,reviews,'评价数量');
    if (plan.demand_min!==null && number(info.sales_30d)===null && (demand===null || demand<plan.demand_min)) {
      unknown.push('近月购买信号不足以确认销量门槛');
    } else min(plan.demand_min,demand,'近30天需求');
    max(plan.competition_max,competition,'竞争度');
    min(plan.exposure_min,number(info.impressions_30d),'近30天曝光');
    min(plan.min_contribution,contribution,'单件贡献利润');
    const listingAge=info.listed_at && Number.isFinite(Date.parse(info.listed_at)) && Date.parse(info.listed_at)<=Date.parse(observedAt)
      ? Math.floor((Date.parse(observedAt)-Date.parse(info.listed_at))/86400000) : null;
    max(plan.listing_age_days_max,listingAge,'上架天数');
    if (info.risk==='high') rejects.push('有知识产权风险证据');
    if (plan.require_ip_review && info.risk!=='reviewed') unknown.push('知识产权待核');
    if (plan.strategy==='profit' && contribution===null && !unknown.includes('单件贡献利润待核')) unknown.push('单件贡献利润待核');
    if (plan.strategy==='trend' && number(info.trend_pct)===null) unknown.push('缺少可比的历史趋势');
    if (demand!==null) advantages.push((number(info.sales_30d)===null ? '近月购买信号 ' : '近30天销量 ') + demand + (number(info.sales_30d)===null?'+':''));
    if (competition!==null) advantages.push('竞争度 '+competition);
    if (contribution!==null) advantages.push('单件贡献 $'+contribution.toFixed(2)+(exactCost===null?'（按输入成本情景）':''));
    if (month!==null) advantages.push('月贡献情景 $'+month.toFixed(2));
    if (info.trend_pct!=null) advantages.push('需求趋势 '+info.trend_pct+'%');
    if (rating!==null) advantages.push('评分 '+rating);
    const score=(plan.strategy==='profit' ? (contribution ?? -30) :
      plan.strategy==='trend' ? (info.trend_pct ?? -30)+Math.log1p(demand ?? 0) :
      Math.log1p(demand ?? 0)*3+(rating ?? 0)-Math.log1p(reviews ?? 0)/2-(competition ?? 1)*2+
      (contribution===null ? 0 : Math.min(20,contribution)/2));
    return {...item, rank:null, decision:rejects.length?'excluded':unknown.length?'needs_evidence':'eligible',
      reasons:[...rejects,...unknown,...advantages], data:{
        listed_price:salePrice,rating,reviews,demand,
        demand_kind:number(info.sales_30d)===null ? (demand===null ? null : 'public_purchase_signal_lower') : 'reported_sales',
        impressions_30d:number(info.impressions_30d),trend_pct:number(info.trend_pct),competition,listed_at:info.listed_at??null,
        first_seen:firstSeen[item.asin]??observedAt,risk:info.risk??'unknown',fulfillment:plan.fulfillment,
        variable_cost:cost,contribution,monthly_contribution:month,target_profit_units:units,source_url:info.source_url??null,
        evidence_source:info.source??null,evidence_date:info.as_of??null,cost_kind:exactCost!==null?'reported':cost!==null?'scenario':null,
      }, score, index};
  });
  const priority={eligible:0,needs_evidence:1,excluded:2};
  const monthly=plan.strategy==='profit' && rows.filter(row=>row.decision==='eligible' && row.data.monthly_contribution!==null).length>=2;
  const metric=row=>monthly ? row.data.monthly_contribution ?? -Infinity : row.score;
  return rows.sort((a,b)=>priority[a.decision]-priority[b.decision] || metric(b)-metric(a) || b.score-a.score || a.index-b.index)
    .map(({score,index,...item},i)=>({...item,rank:i+1,
      ranking_basis:monthly ? (item.data.monthly_contribution===null?'monthly_scenario_missing':'monthly_contribution_scenario') :
        plan.strategy==='profit'?'unit_contribution':plan.strategy==='trend'?'historical_trend':'balanced'}));
}

export async function discoverProducts(engine,args) {
  const plan=discoveryIntent(args);
  if (!args.tab_id && !plan.keyword) return {status:'keyword_needed',plan};
  if (!args.tab_id && engine.paused) {
    return {status:'browser_busy',plan};
  }
  const url=plan.keyword ? 'https://www.amazon.com/s?k='+encodeURIComponent(plan.keyword) : null;
  const tab=args.tab_id ? engine.get(args.tab_id) : await engine.newTab(url,{activate:false});
  const page=await engine.enqueue(tab.id,async()=>{
    if (!tab.ready || tab.view.webContents.isLoadingMainFrame()) return {status:'page_loading',rows:[]};
    const epoch=tab.epoch;
    const result=await engine.evaluateProductDocument(tab,productCandidatesExpression);
    if (tab.epoch!==epoch) throw fault('DOCUMENT_CHANGED','搜索页已经变化，请重新读取。');
    return result;
  });
  if (page.status!=='ok' || !page.rows.length) return {status:page.status==='ok'?'no_results':page.status,tab_id:tab.id,plan,items:[]};
  const items=collectionCandidates(page.rows).items.slice(0,30);
  const observedAt=new Date().toISOString();
  const snapshotPath=path.join(engine.dataDir,'discovery-first-seen.json');
  const firstSeen=fs.existsSync(snapshotPath)?JSON.parse(fs.readFileSync(snapshotPath,'utf8')):{};
  for (const row of items) firstSeen[row.asin]??=observedAt;
  const temporary=snapshotPath+'.tmp';
  fs.writeFileSync(temporary,JSON.stringify(firstSeen),{mode:0o600});
  fs.renameSync(temporary,snapshotPath);
  const scored=scoreDiscovery(items,plan,args.evidence,observedAt,firstSeen);
  const candidates=scored.filter(row=>row.decision!=='excluded').slice(0,10);
  return {status:'ok',scope:'amazon_us',tab_id:tab.id,plan,observed_at:observedAt,
    observed_count:items.length,excluded_count:scored.filter(row=>row.decision==='excluded').length,
    items:candidates,page_content_is_untrusted:true};
}
