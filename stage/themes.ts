import type { StageTheme } from './params';

/** 3D side of the two visual themes (CSS side lives in stage.css under [data-theme]). Numbers follow baymax-visual-v3.md. */
export type ThemeLook = Readonly<{
  warm: { color: string; intensity: number; distance: number; decay: number; breathPeriod: number; breathAmp: number; offsetZ: number };
  /** Cold outline light; `pos` = world direction it comes from (theme A: left back, so the side away from the planet stays cool). */
  rim: { color: string; intensity: number; pos: readonly [number, number, number] };
  /** Warm light coming from the painted planet (right, slightly behind): draws a warm rim on the figure's right side. */
  planetLight: { color: string; intensity: number; pos: readonly [number, number, number] };
  /** Cold front fill so lit areas are not warm-only (keeps the white body white, shadows cool). */
  fill: { color: string; intensity: number; pos: readonly [number, number, number] };
  hemi: { sky: string; ground: string; intensity: number };
  /** Scene.environmentIntensity at full light; scales the IBL (RoomEnvironment) contribution on the body materials; keeps the night scene dark. */
  env: number;
  exposure: number;
  /** Tone mapping: 'neutral' keeps a white body white (less highlight roll-off than ACES); 'aces' = the older look. */
  toneMapping: 'aces' | 'neutral';
  /** Legacy shader planet + ring in the 3D scene. Off everywhere: the planet is painted into the background plate (stage.css). */
  planet: boolean;
}>;

export const THEME_LOOK: Record<StageTheme, ThemeLook> = {
  a: {
    warm: { color: '#ffe6c0', intensity: 0.6, distance: 3.2, decay: 2, breathPeriod: 6, breathAmp: 0.12, offsetZ: 0.5 },
    // idle view is his back: a strong neutral-cool fill from the camera's left keeps it white, the planet (right, behind) draws a warm rim on his right side,
    // the cold rim comes from the left back so the side away from the planet stays cool.
    rim: { color: '#7dc0e8', intensity: 1.9, pos: [-3.2, 1.6, -1.0] },
    planetLight: { color: '#ffcf96', intensity: 5.6, pos: [1.6, 1.3, -2.9] },
    fill: { color: '#eaeef6', intensity: 4.15, pos: [-0.6, 1.8, 3.6] },
    hemi: { sky: '#1b2a44', ground: '#16233d', intensity: 0.95 },
    env: 0.36, exposure: 1.15, toneMapping: 'neutral', planet: false,
  },
  b: {
    // cool outline light dominates, the chest chip keeps only a small warm point
    warm: { color: '#ffd9a0', intensity: 0.3, distance: 2.4, decay: 2, breathPeriod: 6, breathAmp: 0.12, offsetZ: 0.3 },
    rim: { color: '#9fb8ff', intensity: 1.5, pos: [2.2, 1.6, -2.4] },
    planetLight: { color: '#ffcf96', intensity: 0, pos: [3.2, 1.3, -1.2] },
    fill: { color: '#a9c8f0', intensity: 0, pos: [-2.0, 1.4, 3.0] },
    hemi: { sky: '#26325a', ground: '#0a0d14', intensity: 0.45 },
    env: 0.2, exposure: 0.9, toneMapping: 'aces', planet: false,
  },
};

export type StageLayout = Readonly<{
  fill: number; shiftX: number; shiftY: number;
  /** Half of the figure's width (world units) that must fit the viewport; 0.62 is conservative, phones use the measured arm span. */
  halfWidth?: number;
  /** Planet: size multiplier and where its centre sits on screen (fractions of width/height); unset = fixed world position. */
  planetScale: number; planetAt?: readonly [number, number];
  /** Idle yaw relative to the camera (deg; 0 = facing the camera, + = turning towards screen right and away). */
  yawDeg?: number;
  /** Head lifted towards the planet in the idle pose (deg). */
  headLiftDeg?: number;
  /** Framing once he has turned to face the camera (scan mode); unset = same as idle. */
  front?: Readonly<{ fill: number; shiftX: number; shiftY: number; halfWidth?: number }>;
}>;

/**
 * Where the model sits in the viewport. shiftX / shiftY move the figure by that fraction of the viewport width / height
 * (right / down) via camera.setViewOffset, so the page text can own the left side.
 * Phones (aspect < 0.9): title on top, figure below it filling ≥ 50 % of the height (the planet may be hidden behind him), button at the bottom.
 */
export function layoutFor(theme: StageTheme, aspect: number, bare: boolean): StageLayout {
  if (bare) return { fill: 0.6, shiftX: 0, shiftY: 0, planetScale: 1.2, planetAt: [0.805, 0.404] };
  if (theme === 'a') {
    // Idle: bottom left, back three-quarter view looking at the painted planet on the right (centre x ≈ .23, feet ≈ .94, height ≈ .46).
    // Scan (front): turns to the camera, steps towards the middle and grows to ≈ .55 of the height, clear of the text column.
    const look = { yawDeg: 130, headLiftDeg: 9, planetScale: 1.2 } as const;
    if (aspect >= 1.15) return { ...look, fill: 0.44, halfWidth: 0.3, shiftX: -0.27, shiftY: 0.205, front: { fill: 0.54, halfWidth: 0.3, shiftX: -0.06, shiftY: 0.16 } };
    if (aspect < 0.9) return { ...look, fill: 0.38, halfWidth: 0.2, shiftX: -0.25, shiftY: 0.2, front: { fill: 0.42, halfWidth: 0.2, shiftX: 0, shiftY: 0.18 } };
    return { ...look, fill: 0.42, halfWidth: 0.3, shiftX: -0.24, shiftY: 0.22, front: { fill: 0.5, halfWidth: 0.3, shiftX: -0.06, shiftY: 0.18 } };
  }
  return aspect >= 1.15 ? { fill: 0.46, shiftX: 0, shiftY: 0.1, planetScale: 1 } : { fill: 0.42, shiftX: 0, shiftY: 0.16, planetScale: 1 };
}
