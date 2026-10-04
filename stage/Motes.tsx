import { useEffect, useRef } from 'react';
import { anchor } from './anchor';

function lcg(seed: number) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }

/** A few warm gold dust motes drifting slowly around the figure. Deterministic layout; drawn with mix-blend-mode: screen (CSS). */
export function makeMotes(count: number) {
  const r = lcg(1005);
  return Array.from({ length: count }, () => ({
    ux: r() * 2 - 1,           // horizontal offset, in half-widths of the dust zone
    uy: r(),                   // start height inside the zone (0 = feet, 1 = above the head)
    size: 0.7 + r() * 1.3, rise: 0.012 + r() * 0.02, // zone-heights per second
    sway: 4 + r() * 10, swaySpeed: 0.2 + r() * 0.3, phase: r() * Math.PI * 2, base: 0.25 + r() * 0.5,
  }));
}

/** ≤ 20 motes (10 on the low tier). Not mounted under reduced motion. */
export default function Motes({ count }: { count: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current; if (!canvas) return;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    const motes = makeMotes(Math.min(count, 20));
    let raf = 0, w = 0, h = 0, dpr = 1;
    const fit = () => { dpr = Math.min(window.devicePixelRatio || 1, 2); w = canvas.clientWidth; h = canvas.clientHeight; canvas.width = Math.max(1, Math.round(w * dpr)); canvas.height = Math.max(1, Math.round(h * dpr)); };
    const draw = (now: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
      if (anchor.h > 20) {
        const t = now / 1000, zh = anchor.h * 1.15, zw = anchor.h * 0.5;
        for (const m of motes) {
          const k = (m.uy + t * m.rise) % 1;
          const x = anchor.cx + m.ux * zw + Math.sin(t * m.swaySpeed + m.phase) * m.sway;
          const y = anchor.footY + anchor.h * 0.02 - k * zh;
          const fade = Math.sin(Math.PI * k) ** 0.8; // in at the bottom, out at the top
          const a = m.base * fade * (0.75 + 0.25 * Math.sin(t * 0.9 + m.phase));
          const g = ctx.createRadialGradient(x, y, 0, x, y, m.size * 4);
          g.addColorStop(0, `rgba(255,226,168,${a})`); g.addColorStop(0.25, `rgba(244,200,142,${a * 0.5})`); g.addColorStop(1, 'rgba(244,200,142,0)');
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, m.size * 4, 0, Math.PI * 2); ctx.fill();
        }
      }
      raf = requestAnimationFrame(draw);
    };
    fit(); raf = requestAnimationFrame(draw);
    const ro = new ResizeObserver(fit); ro.observe(canvas);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [count]);
  return <canvas ref={ref} className="vz-motes" aria-hidden="true" data-stage-motes data-count={count}/>;
}
