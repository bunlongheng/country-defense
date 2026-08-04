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
    .then((r) => r.text())
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
  pending.set(code, p);
  return p;
}

/**
 * Draws a flag into a 2:1 canvas texture for wrapping onto a sphere. The flag is
 * scaled to cover the whole surface so the marble reads as fully flag-wrapped
 * with no bald poles.
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
  const scale = Math.max(canvas.width / iw, canvas.height / ih);
  const w = iw * scale;
  const h = ih * scale;
  ctx.drawImage(img, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
  return canvas;
}
