import { describe, expect, it } from 'vitest';
import { FINAL_VALUES, INTRO, introClock, introState, introValues, shouldPlayIntro } from './intro';
import { parseStageParams } from './params';
import { THEME_LOOK, layoutFor } from './themes';
import { makeStars } from './Stars';

const base = { readyAt: null as number | null, skipAt: null as number | null, failedAt: null as number | null };

describe('intro storyboard (pure timeline)', () => {
  it('starts dark: nothing but grain at t=0, the spark rises from 0.4 s and stars fade in to .9 by 1.2 s', () => {
    const v0 = introValues(0.2);
    expect(v0.stars).toBe(0); expect(v0.spark).toBe(0); expect(v0.warm).toBe(0); expect(v0.rim).toBe(0); expect(v0.ui).toBe(0);
    expect(introValues(0.8).spark).toBeGreaterThan(0.9);
    expect(introValues(1.2).stars).toBeCloseTo(0.9, 5);
  });

  it('lights (rim, then warm chest light), 6 % camera push, planet and UI follow the 1.2–2.2–3.2 s plan', () => {
    expect(introValues(1.2).warm).toBe(0);
    expect(introValues(1.6).rim).toBeGreaterThan(0.5); expect(introValues(1.6).warm).toBeLessThan(0.5);
    expect(introValues(2.2).warm).toBe(1);
    expect(introValues(2.2).title1).toBe(0); expect(introValues(3.2).button).toBe(1);
    const l = introValues(2.5); expect(l.title1).toBeGreaterThan(l.title2); // titles stagger
    expect(introValues(2.4).button).toBe(0); // the main button comes last
    expect(introValues(3.2)).toMatchObject({ push: 1, planet: 1, nav: 1, title2: 1, sub: 1 });
  });

  it('real duration = max(3.2 s, model ready): fast model → ends at 3.2 s; slow model → waits, then a short tail', () => {
    const end = (readyAt: number | null) => { for (let t = 0; t < 30; t += 0.01) if (introState({ ...base, elapsed: t, readyAt }).phase === 'done') return +t.toFixed(2); return Infinity; };
    expect(end(0.5)).toBeCloseTo(3.2, 1);
    expect(end(2.0)).toBeCloseTo(3.2, 1);
    expect(end(5.0)).toBeCloseTo(5.0 + INTRO.minTail, 1); // 0.9 s tail after a late model
    const held = introClock(4, null); expect(held).toEqual({ clock: INTRO.hold, waiting: true }); // no model: parked at the breathing spark
  });

  it('skip (Esc / Space / click): blends to the final state in 0.4 s and is "done" right after', () => {
    const at = (e: number) => introState({ ...base, readyAt: 0, skipAt: 1.0, elapsed: e });
    expect(at(1.0).phase).toBe('closing'); expect(at(1.0).values.ui).toBeCloseTo(0, 1);
    const mid = at(1.2); expect(mid.phase).toBe('closing'); expect(mid.values.ui).toBeGreaterThan(0.3); expect(mid.values.ui).toBeLessThan(0.8);
    expect(at(1.0 + INTRO.skipFade).phase).toBe('done');
    expect(at(1.0 + INTRO.skipFade).values).toEqual(FINAL_VALUES);
    expect(at(1.2).reason).toBe('skipped');
  });

  it('model load failure ends the intro on its own (reason "failed"), no spinner forever', () => {
    const s = introState({ ...base, elapsed: 0.7, failedAt: 0.5 });
    expect(s.reason).toBe('failed'); expect(s.phase).toBe('closing');
    expect(introState({ ...base, elapsed: 0.5 + INTRO.skipFade, failedAt: 0.5 }).phase).toBe('done');
  });

  it('no model after 8 s ends the intro (reason "timeout") and shows the waiting text; a model that arrives in time does not time out', () => {
    expect(introState({ ...base, elapsed: 7.9 }).phase).toBe('play');
    const t = introState({ ...base, elapsed: 8.1 }); expect(t.reason).toBe('timeout'); expect(t.showWaitingText).toBe(true);
    expect(introState({ ...base, elapsed: 8.0 + INTRO.skipFade }).phase).toBe('done');
    expect(introState({ ...base, elapsed: 8.1, readyAt: 7.5 }).reason).not.toBe('timeout');
  });

  it('Skip button appears after 0.6 s only', () => {
    expect(introState({ ...base, elapsed: 0.5 }).showSkip).toBe(false);
    expect(introState({ ...base, elapsed: 0.7 }).showSkip).toBe(true);
  });
});

describe('when the intro plays', () => {
  it('reduced motion never plays the storyboard, not even with ?intro=1 or ?introT', () => {
    expect(shouldPlayIntro({ intro: '1', reduced: true, seen: false, introT: 1.6 })).toBe(false);
    expect(shouldPlayIntro({ intro: null, reduced: true, seen: false, introT: null })).toBe(false);
  });
  it('?lod=low plays like the full model (the intro does not look at the LOD)', () => {
    const p = parseStageParams('?lod=low');
    expect(p.lod).toBe('low');
    expect(shouldPlayIntro({ intro: p.intro, reduced: false, seen: false, introT: p.introT })).toBe(true);
  });
  it('once per session, ?intro=0 skips, ?intro=1 forces, ?introT freezes', () => {
    expect(shouldPlayIntro({ intro: null, reduced: false, seen: true, introT: null })).toBe(false);
    expect(shouldPlayIntro({ intro: '1', reduced: false, seen: true, introT: null })).toBe(true);
    expect(shouldPlayIntro({ intro: '0', reduced: false, seen: false, introT: null })).toBe(false);
    expect(shouldPlayIntro({ intro: '1', reduced: false, seen: false, introT: 0.8 })).toBe(true);
    expect(parseStageParams('?theme=b&intro=0&introT=2.6')).toMatchObject({ theme: 'b', intro: '0', introT: 2.6 });
    expect(parseStageParams('?theme=zzz').theme).toBe('a');
    expect(parseStageParams('?introT=abc').introT).toBeNull();
  });
});

describe('themes and layout numbers', () => {
  it('theme A follows the visual-v3 recipe (warm chip light only on Baymax, cold rim, ACES 0.9)', () => {
    const a = THEME_LOOK.a;
    expect(a.warm.color).toBe('#ffd9a0'); expect(a.warm.distance).toBe(3.2); expect(a.warm.decay).toBe(2); expect(a.warm.breathPeriod).toBe(6); expect(a.warm.breathAmp).toBeLessThanOrEqual(0.12);
    expect(a.rim.color).toBe('#7dc0e8'); expect(a.hemi.sky).toBe('#1b2a44'); expect(a.hemi.ground).toBe('#0a0d14'); expect(a.exposure).toBe(0.9); expect(a.planet).toBe(true);
    expect(THEME_LOOK.b.planet).toBe(false);
  });
  it('desktop A shifts the figure right (text column on the left), B keeps it centred and lower', () => {
    expect(layoutFor('a', 1.6, false).shiftX).toBeGreaterThan(0.1);
    expect(layoutFor('b', 1.6, false).shiftX).toBe(0); expect(layoutFor('b', 1.6, false).shiftY).toBeGreaterThan(0);
    expect(layoutFor('a', 1.6, true)).toEqual({ fill: 0.6, shiftX: 0, shiftY: 0 });
  });
  it('star field: 80 stars (40 on the low tier), deterministic, five near-white colours', () => {
    expect(makeStars(80)).toHaveLength(80); expect(makeStars(80)).toEqual(makeStars(80));
    expect(new Set(makeStars(80).map(s => s.rgb.join())).size).toBe(5);
  });
});
