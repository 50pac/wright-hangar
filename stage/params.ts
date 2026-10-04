export type StageView = 'front' | 'side' | 'threeq';
export type StageLod = 'full' | 'low';
export type StageTheme = 'a' | 'b';

export type StageParams = Readonly<{
  view: StageView;
  lod: StageLod;
  /** ?still=1 → hold the clip on frame 0 and freeze the breathing (for screenshots). */
  still: boolean;
  /** ?t=0.5 → hold the clip at that fraction (0–1) of its duration; implies a frozen pose. null = play normally. */
  t: number | null;
  /** ?bare=1 → stage only, without the page shell (for reviewing the model on its own). */
  bare: boolean;
  /** ?shell=1 with ?bare=1 / ?silhouette=1 → use the page-shell framing (figure shifted for the text column). For layout measurements. */
  shellLayout: boolean;
  /** FPS guard (auto-switch to the low model). On by default, `?fpsguard=0` is the dev opt-out. */
  fpsGuard: boolean;
  /** ?silhouette=1 → flat white-on-black render used to measure silhouettes (IoU, framing). Implies bare. */
  silhouette: boolean;
  /** ?theme=a (warm lamp night sky, default) | ?theme=b (aurora cool light). */
  theme: StageTheme;
  /** ?intro=0 skips the intro, ?intro=1 forces it (ignores the session flag). null = play once per session. */
  intro: '0' | '1' | null;
  /** ?introT=1.6 → freeze the intro at that many seconds (screenshots). null = real time. */
  introT: number | null;
  /** ?debug=1 exposes window.__baymaxStage in production builds (always exposed in dev). */
  debug: boolean;
}>;

export const MODEL_URLS: Record<StageLod, string> = {
  full: '/models/baymax_v4.glb',
  low: '/models/baymax_v4_low.glb',
};
export const CLIP_NAME = 'Baymax_Arm_Mobility';

/** Narrow lens (28–35° range): no wide-angle distortion. */
export const CAMERA_FOV = 30;
/** Model: ~1.008 units tall, standing on y = 0, facing +Z; arm span ≈ ±0.41. */
export const MODEL_HEIGHT = 1.008;
export const FRAME_FILL = 0.6; // body ≈ 60 % of the viewport height
export const TARGET: readonly [number, number, number] = [0, 0.5, 0];
/** Calibrated against measured silhouettes (see REPORT): scales the analytic distance. */
export const DISTANCE_TRIM = 1.017;

/** Camera presets: azimuth around Y (0 = in front of the model) and a slight look-down elevation. */
export const VIEW_PRESETS: Record<StageView, { azimuthDeg: number; elevationDeg: number }> = {
  front: { azimuthDeg: 0, elevationDeg: 8 },
  side: { azimuthDeg: 90, elevationDeg: 8 },
  threeq: { azimuthDeg: 35, elevationDeg: 9 },
};

/** Distance at which the model fills `fill` of the viewport height, widened if the viewport is too narrow for the arms. */
export function cameraDistance(aspect: number, fovDeg = CAMERA_FOV, fill = FRAME_FILL): number {
  const tan = Math.tan((fovDeg * Math.PI) / 360);
  const byHeight = MODEL_HEIGHT / fill / 2 / tan;
  const byWidth = 0.62 / (tan * Math.max(aspect, 0.2));
  return Math.max(byHeight, byWidth) * DISTANCE_TRIM;
}

export function cameraPosition(view: StageView, distance: number): [number, number, number] {
  const { azimuthDeg, elevationDeg } = VIEW_PRESETS[view];
  const az = (azimuthDeg * Math.PI) / 180, el = (elevationDeg * Math.PI) / 180;
  return [TARGET[0] + distance * Math.cos(el) * Math.sin(az), TARGET[1] + distance * Math.sin(el), TARGET[2] + distance * Math.cos(el) * Math.cos(az)];
}

const truthy = (v: string | null) => v === '1' || v === 'true';

export function parseStageParams(search: string): StageParams {
  const q = new URLSearchParams(search);
  const view = q.get('view');
  const guard = q.get('fpsguard');
  const rawT = q.get('t');
  const t = rawT !== null && rawT.trim() !== '' && Number.isFinite(Number(rawT)) ? Math.min(1, Math.max(0, Number(rawT))) : null;
  const silhouette = truthy(q.get('silhouette'));
  const rawIntroT = q.get('introT');
  const introT = rawIntroT !== null && rawIntroT.trim() !== '' && Number.isFinite(Number(rawIntroT)) ? Math.max(0, Number(rawIntroT)) : null;
  const intro = q.get('intro');
  return {
    theme: q.get('theme') === 'b' ? 'b' : 'a',
    intro: intro === '0' || intro === '1' ? intro : null,
    introT,
    view: view === 'front' || view === 'side' || view === 'threeq' ? view : 'threeq',
    lod: q.get('lod') === 'low' ? 'low' : 'full',
    still: truthy(q.get('still')),
    t,
    bare: truthy(q.get('bare')) || silhouette,
    shellLayout: truthy(q.get('shell')),
    fpsGuard: !(guard === '0' || guard === 'false'),
    silhouette,
    debug: truthy(q.get('debug')),
  };
}

export function isStageLocation(loc: Pick<Location, 'pathname' | 'search'>): boolean {
  return /^\/stage\/?$/.test(loc.pathname) || new URLSearchParams(loc.search).has('stage');
}
