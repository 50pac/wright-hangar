/**
 * Intro animation (~3.2 s, also the model loading animation). Pure functions: the page drives them from requestAnimationFrame and
 * writes the numbers to CSS custom properties / the engine, so the timeline is unit-testable without a browser.
 *
 * Intro clock `c` (seconds) follows the storyboard:
 *   0–0.4   black + grain only (CSS, shown before JS / the model)
 *   0.4–1.2 a warm spark (4px) appears and drifts towards the chest chip, stars fade in 0 → .9
 *   1.2–2.2 (needs the model) rim light, then the warm chest light come up (0 → 1), camera pushes in 6 %, planet fades in
 *   2.2–3.2 title lines, nav (slides down) and finally the main button fade in
 * Real duration = the clock held at 1.2 until the model is ready (spark keeps breathing), then the rest runs in max(0.9, 3.2 − ready) s,
 * i.e. total ≈ max(3.2 s, model ready + 0.9 s).
 */
export const INTRO = {
  hold: 1.2, end: 3.2, minTail: 0.9,
  /** After this many seconds without a model: the intro closes itself and the page shows a placeholder + "Baymax is coming…". */
  giveUpAfter: 8,
  skipButtonAfter: 0.6,
  skipFade: 0.4,
  reducedFade: 0.3,
} as const;

export type IntroValues = Readonly<{
  /** 0..1 → warm chest light (and hemisphere) */ warm: number;
  rim: number; stars: number; planet: number; push: number;
  spark: number; sparkProgress: number;
  title1: number; title2: number; sub: number; nav: number; button: number; ui: number;
}>;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
export const smooth = (a: number, b: number, x: number) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

/** Final (post-intro) state: everything fully on. */
export const FINAL_VALUES: IntroValues = { warm: 1, rim: 1, stars: 0.9, planet: 1, push: 1, spark: 0, sparkProgress: 1, title1: 1, title2: 1, sub: 1, nav: 1, button: 1, ui: 1 };

/** Values at intro-clock `c` (model assumed ready; before `hold` the model is not needed). */
export function introValues(c: number): IntroValues {
  return {
    warm: smooth(1.5, 2.2, c), rim: smooth(1.2, 1.8, c), stars: 0.9 * smooth(0.4, 1.2, c), planet: smooth(1.4, 2.4, c),
    push: smooth(1.2, 3.2, c),
    spark: smooth(0.4, 0.8, c) * (1 - smooth(1.7, 2.3, c)), sparkProgress: smooth(0.4, 1.2, c),
    title1: smooth(2.2, 2.7, c), title2: smooth(2.3, 2.8, c), sub: smooth(2.45, 2.95, c), nav: smooth(2.3, 2.8, c), button: smooth(2.7, 3.2, c), ui: smooth(2.2, 3.2, c),
  };
}

export type IntroInput = { elapsed: number; readyAt: number | null; skipAt: number | null; failedAt: number | null };
export type IntroState = {
  /** 'play' = running, 'closing' = skip/timeout fade-out of the storyboard, 'done' = final state. */
  phase: 'play' | 'closing' | 'done';
  clock: number; values: IntroValues;
  waiting: boolean; showWaitingText: boolean; showSkip: boolean;
  /** Why it ended (only when phase !== 'play'). */
  reason: 'finished' | 'skipped' | 'failed' | 'timeout' | null;
};

/** Maps real elapsed seconds (+ when the model became ready / when the user skipped) to the intro clock. */
export function introClock(elapsed: number, readyAt: number | null): { clock: number; waiting: boolean } {
  if (elapsed < INTRO.hold) return { clock: elapsed, waiting: false };
  if (readyAt === null) return { clock: INTRO.hold, waiting: true };
  const start = Math.max(readyAt, INTRO.hold);
  if (elapsed < start) return { clock: INTRO.hold, waiting: true };
  const tail = Math.max(INTRO.minTail, INTRO.end - start);
  return { clock: INTRO.hold + ((elapsed - start) * (INTRO.end - INTRO.hold)) / tail, waiting: false };
}

const lerpValues = (a: IntroValues, b: IntroValues, k: number): IntroValues => {
  const out = {} as Record<string, number>;
  for (const key of Object.keys(b) as (keyof IntroValues)[]) out[key] = a[key] + (b[key] - a[key]) * k;
  return out as IntroValues;
};

/**
 * Whole intro as a function of real time. Ends in one of four ways:
 * finished (clock ≥ 3.2), skipped (Esc / Space / click / Skip → 0.4 s blend to the final state), failed (model error → same blend,
 * page shows the static placeholder) or timeout (no model after 8 s → same blend; the model joins in later).
 */
export function introState(i: IntroInput): IntroState {
  const { clock, waiting } = introClock(i.elapsed, i.readyAt);
  const base = introValues(Math.min(clock, INTRO.end));
  const showSkip = i.elapsed >= INTRO.skipButtonAfter;
  let endAt: number | null = null; let reason: IntroState['reason'] = null;
  if (clock >= INTRO.end) { return { phase: 'done', clock: INTRO.end, values: FINAL_VALUES, waiting: false, showWaitingText: false, showSkip: false, reason: 'finished' }; }
  const candidates: [number | null, NonNullable<IntroState['reason']>][] = [[i.skipAt, 'skipped'], [i.failedAt, 'failed'], [i.readyAt === null && i.elapsed >= INTRO.giveUpAfter ? INTRO.giveUpAfter : null, 'timeout']];
  for (const [t, r] of candidates) if (t !== null && (endAt === null || t < endAt)) { endAt = t; reason = r; }
  if (endAt !== null) {
    const k = smooth(0, INTRO.skipFade, i.elapsed - endAt);
    return { phase: k >= 1 ? 'done' : 'closing', clock, values: lerpValues(base, FINAL_VALUES, k), waiting, showWaitingText: reason === 'timeout', showSkip: false, reason };
  }
  return { phase: 'play', clock, values: base, waiting, showWaitingText: false, showSkip, reason: null };
}

/** Whether the intro should run at all. Reduced motion never plays the storyboard (it fades straight to the end state). */
export function shouldPlayIntro(o: { intro: '0' | '1' | null; reduced: boolean; seen: boolean; introT: number | null }): boolean {
  if (o.reduced) return false;
  if (o.introT !== null) return true;
  if (o.intro === '0') return false;
  if (o.intro === '1') return true;
  return !o.seen;
}
export const INTRO_SESSION_KEY = 'baymax-intro-seen';
