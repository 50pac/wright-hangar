export type FpsGuardOptions = { threshold: number; sustainMs: number; windowMs: number; warmupMs: number; minSamples: number };
export const FPS_GUARD_DEFAULTS: FpsGuardOptions = { threshold: 40, sustainMs: 3000, windowMs: 1000, warmupMs: 1000, minSamples: 3 };

/**
 * Rolling-average FPS monitor. `tick(nowMs)` is called once per rendered frame.
 * Fires (once, latched) when the rolling average stays below `threshold` for `sustainMs` in a row.
 * This only implements the mechanism; it says nothing about real-device performance.
 */
export class FpsGuard {
  private samples: number[] = [];
  private belowSince: number | null = null;
  private startedAt: number | null = null;
  private fired = false;
  fps = 0;
  constructor(private readonly o: FpsGuardOptions = FPS_GUARD_DEFAULTS) {}

  /** Call after a model (re)load or when the tab becomes visible again. */
  reset(nowMs: number | null = null) {
    this.samples = []; this.belowSince = null; this.startedAt = nowMs; this.fps = 0;
  }
  get hasFired() { return this.fired; }

  tick(nowMs: number): { fps: number; trigger: boolean } {
    if (this.startedAt === null) this.startedAt = nowMs;
    this.samples.push(nowMs);
    while (this.samples.length > this.o.minSamples && nowMs - this.samples[0] > this.o.windowMs) this.samples.shift();
    if (this.samples.length < this.o.minSamples) return { fps: this.fps, trigger: false };
    const span = this.samples[this.samples.length - 1] - this.samples[0];
    this.fps = span > 0 ? ((this.samples.length - 1) * 1000) / span : 0;
    if (nowMs - this.startedAt < this.o.warmupMs || this.fired) return { fps: this.fps, trigger: false };
    if (this.fps < this.o.threshold) {
      this.belowSince ??= nowMs;
      if (nowMs - this.belowSince >= this.o.sustainMs) { this.fired = true; return { fps: this.fps, trigger: true }; }
    } else {
      this.belowSince = null;
    }
    return { fps: this.fps, trigger: false };
  }
}
