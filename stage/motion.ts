/**
 * Decorative motion. Applied to the wrapper group (lean, breath) and to the independent Bone_Head (tilt, additive on top of
 * the clip). Arm bones and the arm clip are never touched.
 */
export const BREATH = {
  hz: 0.2, // one breath every 5 s
  scaleY: 0.012, // ±1.2 % of body height (limit 1.5 %)
} as const;

export const POSE = {
  leanDeg: 4.5, // forward lean of the whole body
  headTiltDeg: 3, // roll of the head bone
  /** Fraction of every decorative amplitude kept under prefers-reduced-motion (must stay ≤ 0.5). */
  reducedFactor: 0.4,
} as const;

export type DecorPose = Readonly<{ scaleY: number; leanRad: number; headTiltRad: number; amplitudeFactor: number }>;

const rad = (deg: number) => (deg * Math.PI) / 180;

/** `frozen` (still / ?t= / paused) keeps the static lean and head tilt but stops the breath. */
export function decorPose(timeSec: number, opts: { reduced: boolean; frozen: boolean }): DecorPose {
  const k = opts.reduced ? POSE.reducedFactor : 1;
  const breath = opts.frozen ? 0 : Math.sin(2 * Math.PI * BREATH.hz * timeSec);
  return { scaleY: 1 + BREATH.scaleY * k * breath, leanRad: rad(POSE.leanDeg) * k, headTiltRad: rad(POSE.headTiltDeg) * k, amplitudeFactor: k };
}

/** Whether the arm clip may advance. Reduced motion holds the rest pose (clip time 0). */
export function clipShouldAdvance(opts: { reduced: boolean; fixed: boolean; paused: boolean }): boolean {
  return !opts.reduced && !opts.fixed && !opts.paused;
}
