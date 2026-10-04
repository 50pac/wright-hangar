import type { StageTheme } from './params';

/** 3D side of the two visual themes (CSS side lives in stage.css under [data-theme]). Numbers follow baymax-visual-v3.md. */
export type ThemeLook = Readonly<{
  warm: { color: string; intensity: number; distance: number; decay: number; breathPeriod: number; breathAmp: number; offsetZ: number };
  rim: { color: string; intensity: number };
  hemi: { sky: string; ground: string; intensity: number };
  /** Scene.environmentIntensity at full light; scales the IBL (RoomEnvironment) contribution on the body materials; keeps the night scene dark. */
  env: number;
  exposure: number;
  planet: boolean;
}>;

export const THEME_LOOK: Record<StageTheme, ThemeLook> = {
  a: {
    warm: { color: '#ffd9a0', intensity: 0.6, distance: 3.2, decay: 2, breathPeriod: 6, breathAmp: 0.12, offsetZ: 0.3 },
    rim: { color: '#7dc0e8', intensity: 1.1 },
    hemi: { sky: '#1b2a44', ground: '#0a0d14', intensity: 0.35 },
    env: 0.15, exposure: 0.9, planet: true,
  },
  b: {
    // cool outline light dominates, the chest chip keeps only a small warm point
    warm: { color: '#ffd9a0', intensity: 0.3, distance: 2.4, decay: 2, breathPeriod: 6, breathAmp: 0.12, offsetZ: 0.3 },
    rim: { color: '#9fb8ff', intensity: 1.5 },
    hemi: { sky: '#26325a', ground: '#0a0d14', intensity: 0.45 },
    env: 0.2, exposure: 0.9, planet: false,
  },
};

export type StageLayout = Readonly<{ fill: number; shiftX: number; shiftY: number }>;

/**
 * Where the model sits in the viewport. shiftX / shiftY move the figure by that fraction of the viewport width / height
 * (right / down) via camera.setViewOffset, so the page text can own the left side.
 */
export function layoutFor(theme: StageTheme, aspect: number, bare: boolean): StageLayout {
  if (bare) return { fill: 0.6, shiftX: 0, shiftY: 0 };
  if (theme === 'a') return aspect >= 1.15 ? { fill: 0.6, shiftX: 0.17, shiftY: 0 } : { fill: 0.5, shiftX: 0, shiftY: 0.06 };
  return aspect >= 1.15 ? { fill: 0.46, shiftX: 0, shiftY: 0.1 } : { fill: 0.42, shiftX: 0, shiftY: 0.16 };
}
