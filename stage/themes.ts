import type { StageTheme } from './params';

/** 3D side of the two visual themes (CSS side lives in stage.css under [data-theme]). Numbers follow baymax-visual-v3.md. */
export type ThemeLook = Readonly<{
  warm: { color: string; intensity: number; distance: number; decay: number; breathPeriod: number; breathAmp: number; offsetZ: number };
  rim: { color: string; intensity: number };
  /** Cold front fill so lit areas are not warm-only (keeps the white body white, shadows cool). */
  fill: { color: string; intensity: number };
  hemi: { sky: string; ground: string; intensity: number };
  /** Scene.environmentIntensity at full light; scales the IBL (RoomEnvironment) contribution on the body materials; keeps the night scene dark. */
  env: number;
  exposure: number;
  /** Legacy shader planet + ring in the 3D scene. Off everywhere: the planet is painted into the background plate (stage.css). */
  planet: boolean;
}>;

export const THEME_LOOK: Record<StageTheme, ThemeLook> = {
  a: {
    warm: { color: '#ffe6c0', intensity: 0.6, distance: 3.2, decay: 2, breathPeriod: 6, breathAmp: 0.12, offsetZ: 0.3 },
    rim: { color: '#7dc0e8', intensity: 1.9 },
    fill: { color: '#a9c8f0', intensity: 1.1 },
    hemi: { sky: '#1b2a44', ground: '#16233d', intensity: 0.75 },
    env: 0.2, exposure: 0.9, planet: false,
  },
  b: {
    // cool outline light dominates, the chest chip keeps only a small warm point
    warm: { color: '#ffd9a0', intensity: 0.3, distance: 2.4, decay: 2, breathPeriod: 6, breathAmp: 0.12, offsetZ: 0.3 },
    rim: { color: '#9fb8ff', intensity: 1.5 },
    fill: { color: '#a9c8f0', intensity: 0 },
    hemi: { sky: '#26325a', ground: '#0a0d14', intensity: 0.45 },
    env: 0.2, exposure: 0.9, planet: false,
  },
};

export type StageLayout = Readonly<{
  fill: number; shiftX: number; shiftY: number;
  /** Half of the figure's width (world units) that must fit the viewport; 0.62 is conservative, phones use the measured arm span. */
  halfWidth?: number;
  /** Planet: size multiplier and where its centre sits on screen (fractions of width/height); unset = fixed world position. */
  planetScale: number; planetAt?: readonly [number, number];
}>;

/**
 * Where the model sits in the viewport. shiftX / shiftY move the figure by that fraction of the viewport width / height
 * (right / down) via camera.setViewOffset, so the page text can own the left side.
 * Phones (aspect < 0.9): title on top, figure below it filling ≥ 50 % of the height (the planet may be hidden behind him), button at the bottom.
 */
export function layoutFor(theme: StageTheme, aspect: number, bare: boolean): StageLayout {
  if (bare) return { fill: 0.6, shiftX: 0, shiftY: 0, planetScale: 1.2, planetAt: [0.805, 0.404] };
  if (theme === 'a') {
    // desktop: figure ~65 % of the height, horizontal centre ≈ 0.66, feet near 0.86 (the warm mist of the plate)
    if (aspect >= 1.15) return { fill: 0.65, shiftX: 0.16, shiftY: 0.035, planetScale: 1.2, planetAt: [0.805, 0.404] };
    if (aspect < 0.9) return { fill: 0.52, halfWidth: 0.44, shiftX: 0, shiftY: 0.07, planetScale: 0.4, planetAt: [0.7, 0.5] };
    return { fill: 0.5, shiftX: 0, shiftY: 0.06, planetScale: 0.7, planetAt: [0.7, 0.45] };
  }
  return aspect >= 1.15 ? { fill: 0.46, shiftX: 0, shiftY: 0.1, planetScale: 1 } : { fill: 0.42, shiftX: 0, shiftY: 0.16, planetScale: 1 };
}
