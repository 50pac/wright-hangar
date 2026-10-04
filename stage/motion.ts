/** Decorative motion applied to the wrapper group only. The skeleton and the clip are never touched or scaled. */
export const BREATH = {
  periodSec: 4.0,
  scaleY: 0.01, // ±1 % of body height
  leanRad: 0.012, // ≈ ±0.7° forward/back lean
  /** Fraction of the amplitude kept under prefers-reduced-motion (must stay ≤ 0.5). */
  reducedFactor: 0.4,
} as const;

export type DecorPose = Readonly<{ scaleY: number; pitch: number; amplitudeFactor: number }>;

export function decorPose(timeSec: number, opts: { reduced: boolean; still: boolean }): DecorPose {
  if (opts.still) return { scaleY: 1, pitch: 0, amplitudeFactor: 0 };
  const k = opts.reduced ? BREATH.reducedFactor : 1;
  const s = Math.sin((2 * Math.PI * timeSec) / BREATH.periodSec);
  return { scaleY: 1 + BREATH.scaleY * k * s, pitch: BREATH.leanRad * k * s, amplitudeFactor: k };
}

/** Whether the arm clip may advance. Reduced motion holds the rest pose (clip time 0). */
export function clipShouldAdvance(opts: { reduced: boolean; still: boolean; paused: boolean }): boolean {
  return !opts.reduced && !opts.still && !opts.paused;
}
