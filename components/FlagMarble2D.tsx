"use client";

import { useEffect, useRef } from "react";
import { loadFlagImage, getFlagImage } from "@/lib/flagImage";

// A glossy spinning flag marble drawn on a plain 2D canvas - no WebGL, so it
// renders identically on every device (the 3D WebGL version showed an empty
// sphere on some iPads / over LAN). Auto-spins, and you can drag to spin it.
export default function FlagMarble2D({ code }: { code: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const angleRef = useRef(0); // 0..1 = one full turn
  const rRef = useRef(1);
  const dragRef = useRef<{ x: number; angle: number } | null>(null);

  useEffect(() => {
    loadFlagImage(code).catch(() => {});
  }, [code]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const parent = canvas.parentElement!;
    let raf = 0;
    let last = performance.now();

    const resize = () => {
      const s = Math.min(parent.clientWidth, parent.clientHeight);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = s * dpr;
      canvas.height = s * dpr;
      canvas.style.width = `${s}px`;
      canvas.style.height = `${s}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(parent);

    const draw = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.width / dpr;
      const h = canvas.height / dpr;
      ctx.clearRect(0, 0, w, h);
      const cx = w / 2;
      const cy = h / 2;
      const r = Math.min(w, h) * 0.44;
      rRef.current = r;

      // soft cyan glow
      const glow = ctx.createRadialGradient(cx, cy, r * 0.75, cx, cy, r * 1.35);
      glow.addColorStop(0, "rgba(34,211,238,0.18)");
      glow.addColorStop(1, "rgba(34,211,238,0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 1.35, 0, Math.PI * 2);
      ctx.fill();

      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.clip();
      const img = getFlagImage(code);
      if (img) {
        const nw = img.naturalWidth || 640;
        const nh = img.naturalHeight || 480;
        const scale = Math.max((2 * r) / nw, (2 * r) / nh);
        const iw = nw * scale;
        const ih = nh * scale;
        const ox = (((angleRef.current % 1) + 1) % 1) * iw; // horizontal scroll = spin
        for (let k = -1; k <= 1; k++) {
          ctx.drawImage(img, cx - iw / 2 - ox + k * iw, cy - ih / 2, iw, ih);
        }
      } else {
        ctx.fillStyle = "#334155";
        ctx.fillRect(cx - r, cy - r, 2 * r, 2 * r);
      }
      // spherical shading, lit from top-left
      const sh = ctx.createRadialGradient(cx - r * 0.4, cy - r * 0.5, r * 0.1, cx, cy, r);
      sh.addColorStop(0, "rgba(255,255,255,0.28)");
      sh.addColorStop(0.55, "rgba(0,0,0,0)");
      sh.addColorStop(1, "rgba(0,0,0,0.55)");
      ctx.fillStyle = sh;
      ctx.fillRect(cx - r, cy - r, 2 * r, 2 * r);
      ctx.restore();

      // glossy specular glint
      ctx.beginPath();
      ctx.ellipse(cx - r * 0.42, cy - r * 0.48, r * 0.28, r * 0.18, -Math.PI / 5, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255,0.6)";
      ctx.fill();
    };

    const frame = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      if (!dragRef.current) angleRef.current += dt * 0.12; // gentle auto-spin
      draw();
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [code]);

  return (
    <canvas
      ref={canvasRef}
      className="mx-auto block cursor-grab touch-none active:cursor-grabbing"
      onPointerDown={(e) => {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        dragRef.current = { x: e.clientX, angle: angleRef.current };
      }}
      onPointerMove={(e) => {
        if (!dragRef.current) return;
        angleRef.current = dragRef.current.angle - (e.clientX - dragRef.current.x) / (rRef.current * 3);
      }}
      onPointerUp={() => {
        dragRef.current = null;
      }}
      onPointerCancel={() => {
        dragRef.current = null;
      }}
    />
  );
}
