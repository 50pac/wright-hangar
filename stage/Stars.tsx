import { useEffect, useRef } from 'react';

/** Wispal-style star palette: cold white-blue, warm white, warm gold, pale violet, mint (all near-white). */
const STAR_RGB: [number, number, number][] = [[216, 232, 255], [255, 246, 232], [255, 230, 187], [215, 195, 255], [200, 240, 230]];

/** Deterministic PRNG so the sky looks the same on every load (screenshots, tests). */
function lcg(seed: number) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }

export function makeStars(count: number) {
  const r = lcg(20261005);
  return Array.from({ length: count }, () => ({
    x: r(), y: r(), size: 0.4 + r() * 0.8, rgb: STAR_RGB[Math.floor(r() * STAR_RGB.length)],
    phase: r() * Math.PI * 2, speed: 0.5 + r() * 0.6, base: 0.3 + r() * 0.5,
  }));
}

/** 2D canvas star field (mix-blend-mode: screen in CSS). ~50 stars (fine and restrained), 30 on the low tier, DPR ≤ 2. Not mounted under reduced motion. */
export default function Stars({ count }: { count: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current; if (!canvas) return;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    const stars = makeStars(count);
    let raf = 0, w = 0, h = 0, dpr = 1;
    const fit = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth; h = canvas.clientHeight;
      canvas.width = Math.max(1, Math.round(w * dpr)); canvas.height = Math.max(1, Math.round(h * dpr));
    };
    const draw = (now: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
      const t = now / 1000;
      for (const s of stars) {
        const tw = 0.65 + 0.35 * Math.sin(t * s.speed + s.phase);
        const a = s.base * tw, [r, g, b] = s.rgb;
        const x = s.x * w, y = s.y * h, rad = s.size * (w < 520 ? 0.7 : 1);
        ctx.fillStyle = `rgba(${r},${g},${b},${a})`;
        ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill();
        if (s.size > 1.0) { ctx.fillStyle = `rgba(${r},${g},${b},${a * 0.14})`; ctx.beginPath(); ctx.arc(x, y, rad * 3, 0, Math.PI * 2); ctx.fill(); }
      }
      raf = requestAnimationFrame(draw);
    };
    fit(); raf = requestAnimationFrame(draw);
    const ro = new ResizeObserver(fit); ro.observe(canvas);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [count]);
  return <canvas ref={ref} className="vz-stars" aria-hidden="true" data-stage-stars data-count={count}/>;
}
