// Tiny image cache for optional tower/effect sprites (generated art dropped into
// public/towers/...). Renderers call getSprite() each frame; it returns null until
// the image has loaded, so drawing always falls back to the procedural look and
// nothing ever blocks on a missing/loading asset.

const cache = new Map<string, HTMLImageElement | null>();

/** Kick off (or reuse) a load. Safe to call repeatedly. */
export function loadSprite(url: string): void {
  if (typeof window === "undefined" || cache.has(url)) return;
  cache.set(url, null); // mark in-flight so we don't reload
  const img = new Image();
  img.onload = () => cache.set(url, img);
  img.onerror = () => cache.set(url, null);
  img.src = url;
}

/** The loaded image, or null if not ready / not present. */
export function getSprite(url: string): HTMLImageElement | null {
  const img = cache.get(url);
  return img && img.complete && img.naturalWidth > 0 ? img : null;
}
