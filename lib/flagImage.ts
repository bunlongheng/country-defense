import { flagUrl } from "./countries.ts";

// Loads flag SVGs as HTMLImageElements once and caches them, so both the WebGL
// marble texture and the 2D canvas enemy sprites can draw them synchronously
// after the first load. Browser-only.
//
// flag-icons SVGs carry a viewBox but no width/height attributes, so a bare
// `new Image(src=...svg)` has naturalWidth 0 and canvas drawImage rasterizes
// nothing. We fetch the markup, inject an explicit size, and load it as a blob
// so drawImage always has real pixels to paint.

const cache = new Map<string, HTMLImageElement>();
const pending = new Map<string, Promise<HTMLImageElement>>();

export function getFlagImage(code: string): HTMLImageElement | undefined {
  return cache.get(code);
}

export function loadFlagImage(code: string): Promise<HTMLImageElement> {
  const cached = cache.get(code);
  if (cached) return Promise.resolve(cached);
  const inflight = pending.get(code);
  if (inflight) return inflight;

  const p = fetch(flagUrl(code))
    .then((r) => {
      if (!r.ok) throw new Error(`flag ${code}: HTTP ${r.status}`);
      return r.text();
    })
    .then(
      (svg) =>
        new Promise<HTMLImageElement>((resolve, reject) => {
          const sized = svg.includes("width=")
            ? svg
            : svg.replace("<svg", '<svg width="640" height="480"');
          const blob = new Blob([sized], { type: "image/svg+xml" });
          const url = URL.createObjectURL(blob);
          const img = new Image();
          img.decoding = "async";
          img.onload = () => {
            URL.revokeObjectURL(url);
            cache.set(code, img);
            pending.delete(code);
            resolve(img);
          };
          img.onerror = () => {
            URL.revokeObjectURL(url);
            pending.delete(code);
            reject(new Error(`flag load failed: ${code}`));
          };
          img.src = url;
        }),
    );
  // If the fetch/decode fails, drop the in-flight entry so a later call can retry
  // instead of being stuck on a permanently-rejected promise.
  p.catch(() => pending.delete(code));
  pending.set(code, p);
  return p;
}

// Dominant-color palette per flag, sampled once from the loaded SVG. Used to
// theme the arena to the player's country (USA -> red/white/blue, etc.). Colors
// are quantized into coarse buckets and ranked by area so the flag's real
// signature colors win. Returns hex strings, most-dominant first.
const paletteCache = new Map<string, string[]>();

export function getFlagPalette(code: string): string[] {
  const cached = paletteCache.get(code);
  if (cached) return cached;
  const img = cache.get(code);
  if (!img) return [];
  const size = 24;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return [];
  const iw = img.naturalWidth || 640;
  const ih = img.naturalHeight || 480;
  const scale = Math.max(size / iw, size / ih);
  ctx.drawImage(img, (size - iw * scale) / 2, (size - ih * scale) / 2, iw * scale, ih * scale);
  const { data } = ctx.getImageData(0, 0, size, size);
  const buckets = new Map<string, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const key = `${r >> 5}-${g >> 5}-${b >> 5}`;
    const bk = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    bk.n++; bk.r += r; bk.g += g; bk.b += b;
    buckets.set(key, bk);
  }
  const hex = (v: number) => v.toString(16).padStart(2, "0");
  const sorted = [...buckets.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, 4)
    .map((bk) => `#${hex(Math.round(bk.r / bk.n))}${hex(Math.round(bk.g / bk.n))}${hex(Math.round(bk.b / bk.n))}`);
  if (sorted.length) paletteCache.set(code, sorted);
  return sorted;
}

/**
 * Draws a flag into a 2:1 canvas texture for wrapping onto a sphere. The ENTIRE
 * flag must survive - every stripe and emblem - so we fit it to the full texture
 * HEIGHT (never cropping the top/bottom, which used to chop the outer bands off
 * flags like Cambodia, leaving only the middle colour). The flag keeps its aspect
 * and is centred; the leftover side strips are filled by extending the flag's own
 * edge columns, so band-flags wrap seamlessly with no empty poles or bald bars.
 */
export function flagToCanvas(
  img: HTMLImageElement,
  size = 512,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size * 2; // 2:1 for equirectangular wrap
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const iw = img.naturalWidth || 640;
  const ih = img.naturalHeight || 480;
  // On a sphere, an equirectangular texture maps its vertical CENTRE to the front
  // face and squeezes the top/bottom toward the poles (invisible). So the whole flag
  // must sit in the EQUATORIAL band - the middle ~64% of the texture height - so the
  // front face shows the complete flag (every stripe + emblem), not just the middle
  // colour. The pole caps above/below are filled by extending the flag's own top and
  // bottom edge rows, so nothing looks bald and band-flags stay coherent.
  const bandTop = Math.round(canvas.height * 0.18);
  const bandH = canvas.height - bandTop * 2;
  const scale = bandH / ih; // keep the flag's aspect (no stretch/distortion)
  const w = iw * scale;
  const x0 = (canvas.width - w) / 2;
  // side strips within the band: extend the flag's outermost columns so bands run edge to edge
  if (x0 > 0) {
    ctx.drawImage(img, 0, 0, 1, ih, 0, bandTop, x0, bandH);
    ctx.drawImage(img, iw - 1, 0, 1, ih, x0 + w, bandTop, x0, bandH);
  }
  // the full, uncropped flag, centred in the equatorial band
  ctx.drawImage(img, x0, bandTop, w, bandH);
  // pole caps: stretch the band's top row up and its bottom row down to fill the poles
  ctx.drawImage(canvas, 0, bandTop, canvas.width, 1, 0, 0, canvas.width, bandTop);
  ctx.drawImage(
    canvas,
    0,
    bandTop + bandH - 1,
    canvas.width,
    1,
    0,
    bandTop + bandH,
    canvas.width,
    canvas.height - (bandTop + bandH),
  );
  return canvas;
}
