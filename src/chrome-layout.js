// One geometry contract for native page views and the renderer's browser chrome.
export function chromeLayout(width, height, sidebarOpen = true, preferredWidth = 0) {
  const rail = 68, top = 96;
  const defaultWidth = width >= 1600 ? 440 : width <= 1120 ? 360 : 400;
  const requested = Number.isFinite(preferredWidth) && preferredWidth > 0 ? preferredWidth : defaultWidth;
  const panel = Math.round(Math.max(300, Math.min(requested, 600, width - rail - 360)));
  const right = sidebarOpen ? panel : 0;
  return { rail, top, panel, right, page: {
    x: rail, y: top, width: Math.max(1, width - rail - right), height: Math.max(1, height - top),
  } };
}
