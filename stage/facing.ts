/**
 * "Look at the planet" ↔ "face the camera" turn. Pure helpers so the timing can be unit-tested; the engine drives them per frame.
 * f = 0: idle pose (back three-quarter view, looking at the planet on the right); f = 1: facing the camera (scan mode).
 */
export const TURN = { toFrontSec: 0.8, toBackSec: 1.2 } as const;

export function easeInOutCubic(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export type TurnState = Readonly<{ from: number; to: number; start: number; dur: number }>;

/** Current eased facing value at time `now` (seconds). */
export function turnValue(s: TurnState, now: number): number {
  if (s.dur <= 0) return s.to;
  const p = (now - s.start) / s.dur;
  return s.from + (s.to - s.from) * easeInOutCubic(p);
}

/** Start a turn towards `front` from wherever the figure is now; reduced motion switches instantly. */
export function startTurn(current: number, front: boolean, now: number, reduced: boolean): TurnState {
  const to = front ? 1 : 0;
  if (reduced || current === to) return { from: to, to, start: now, dur: 0 };
  const full = front ? TURN.toFrontSec : TURN.toBackSec;
  return { from: current, to, start: now, dur: full * Math.abs(to - current) };
}

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
