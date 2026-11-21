import { amazonTarget } from './amazon-target.js';

export const maxCollectionItems = 100;

export function amazonCandidate(raw) {
  if (typeof raw !== 'string' || raw.length > 2048) return null;
  const asin = amazonTarget(raw.trim())?.asin;
  return asin ? { asin, url: 'https://www.amazon.com/dp/' + asin } : null;
}

export function collectionCandidates(rows) {
  const candidates = new Map();
  const rejected = [];
  let overflow = 0;
  for (const raw of rows) {
    const value = typeof raw === 'string' ? raw : raw?.url;
    const parsed = amazonCandidate(value);
    if (!parsed) {
      rejected.push(String(value ?? '').slice(0, 250));
      continue;
    }
    if (candidates.has(parsed.asin)) continue;
    if (candidates.size >= maxCollectionItems) { overflow++; continue; }
    const title = typeof raw?.title === 'string' ? raw.title.trim().slice(0, 160) : '';
    candidates.set(parsed.asin, { ...parsed, title: title || parsed.asin, ...(raw?.signals ? { signals:raw.signals } : {}) });
  }
  return { items: [...candidates.values()], rejected, overflow };
}

function amazonCardSignals(card) {
  if (!card) return undefined;
  const cleaned = value => String(value ?? '').replaceAll(',','').trim();
  const priceNode = card.querySelector('.a-price:not(.a-text-price) .a-offscreen');
  const price = cleaned(priceNode?.textContent).match(/^\$\s*(\d+(?:\.\d{2})?)$/);
  const stars = cleaned(card.querySelector('.a-icon-star-small .a-icon-alt, .a-icon-star .a-icon-alt')?.textContent)
    .match(/^(\d(?:\.\d)?)\s+out of 5/i);
  const reviewNode = card.querySelector('[aria-label$="ratings"], [aria-label$="reviews"], a[href*="#customerReviews"]');
  const reviews = cleaned(reviewNode?.getAttribute('aria-label') || reviewNode?.textContent)
    .match(/^\(?([\d.]+)\s*([KM])?\)?(?:\s+(?:ratings|reviews))?$/i);
  const purchase = [...card.querySelectorAll('span')].findLast(node =>
    /^[\d,.]+\s*[KM]?\+?\s+bought in past month$/i.test(node.textContent?.trim() ?? ''));
  const bought = cleaned(purchase?.textContent ?? card.innerText).match(/\b([\d.]+)\s*([KM])?\+?\s+bought in past month/i);
  const multiply = (n, unit) => Number(n) * ({k:1000,m:1000000}[unit?.toLowerCase()] ?? 1);
  return {
    listed_price: price ? Number(price[1]) : null,
    rating: stars ? Number(stars[1]) : null,
    reviews: reviews ? multiply(reviews[1],reviews[2]) : null,
    bought_signal_lower: bought ? multiply(bought[1],bought[2]) : null,
  };
}

function amazonPageCandidates() {
  if (!amazonTarget(location.href)) return { status: 'unsupported_store', rows: [] };
  const body = document.body?.innerText?.slice(0, 900) ?? '';
  if (document.querySelector('#captchacharacters, form[action*="validateCaptcha"]') ||
      /robot check|captcha/i.test(document.title) || /enter the characters you see below|automated access/i.test(body)) {
    return { status: 'verification_required', rows: [] };
  }
  if (/^\/ap\/signin/.test(location.pathname)) return { status: 'sign_in_required', rows: [] };
  const current = amazonTarget(location.href);
  const title = document.querySelector('#productTitle')?.textContent?.trim();
  if (current.asin && title) return { status: 'ok', rows: [{ url: location.href, title }] };

  const rows = new Map();
  const cards = document.querySelectorAll('[data-component-type="s-search-result"], #zg-ordered-list li, #gridItemRoot, #zg-center-div li');
  const add = (anchor, label, card) => {
    if (!anchor?.getClientRects().length) return;
    const target = amazonTarget(anchor.href);
    if (!target?.asin || rows.has(target.asin) || rows.size >= 150) return;
    const name = (label || anchor.querySelector('img')?.alt || anchor.getAttribute('aria-label') || anchor.textContent || '').trim();
    if (name) rows.set(target.asin, { url: anchor.href, title: name.slice(0, 160), signals:amazonCardSignals(card) });
  };
  for (const card of cards) {
    if (!card.getClientRects().length) continue;
    const heading = card.querySelector('h2, h3, [role="heading"]');
    const anchors = card.querySelectorAll('a[href*="/dp/"], a[href*="/gp/product/"]');
    for (const anchor of anchors) {
      const before = rows.size;
      add(anchor, heading?.textContent, card);
      if (rows.size > before) break;
    }
  }
  if (!cards.length) {
    const headings = document.querySelectorAll('main h2, [role="main"] h2, #search h2, #zg h2');
    for (const heading of headings) add(heading.closest('a') || heading.querySelector('a'), heading.textContent);
  }
  return { status: 'ok', rows: [...rows.values()] };
}

export const productCandidatesExpression = `(() => { ${amazonTarget.toString()}; ${amazonCardSignals.toString()}; return (${amazonPageCandidates.toString()})(); })()`;
