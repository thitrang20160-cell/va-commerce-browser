export function amazonTarget(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:' || !['www.amazon.com','amazon.com'].includes(url.hostname) ||
        url.port || url.username || url.password) return null;
    return {asin:url.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:\/|$)/i)?.[1].toUpperCase() ?? null};
  } catch { return null; }
}
