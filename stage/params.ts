export type StageView = 'front' | 'side' | 'threeq';
export type StageLod = 'full' | 'low';

export type StageParams = Readonly<{
  view: StageView;
  lod: StageLod;
  /** ?still=1 → hold the clip on frame 0 and freeze decorative motion (for screenshots). */
  still: boolean;
  /** FPS guard (auto-switch to the low model). On by default, `?fpsguard=0` is the dev opt-out. */
  fpsGuard: boolean;
  /** ?silhouette=1 → flat white-on-black render used to measure silhouettes (IoU). */
  silhouette: boolean;
  /** ?debug=1 exposes window.__baymaxStage in production builds (always exposed in dev). */
  debug: boolean;
}>;

export const MODEL_URLS: Record<StageLod, string> = {
  full: '/models/baymax_v4.glb',
  low: '/models/baymax_v4_low.glb',
};
export const CLIP_NAME = 'Baymax_Arm_Mobility';

/** Camera presets. The model faces +Z, is ~1.01 units tall and stands on y = 0. */
export const VIEW_PRESETS: Record<StageView, { position: readonly [number, number, number]; target: readonly [number, number, number] }> = {
  front: { position: [0, 0.52, 2.8], target: [0, 0.5, 0] },
  side: { position: [2.8, 0.52, 0], target: [0, 0.5, 0] },
  threeq: { position: [2.0, 0.64, 2.15], target: [0, 0.5, 0] },
};

const truthy = (v: string | null) => v === '1' || v === 'true';

export function parseStageParams(search: string): StageParams {
  const q = new URLSearchParams(search);
  const view = q.get('view');
  const guard = q.get('fpsguard');
  return {
    view: view === 'front' || view === 'side' || view === 'threeq' ? view : 'threeq',
    lod: q.get('lod') === 'low' ? 'low' : 'full',
    still: truthy(q.get('still')),
    fpsGuard: !(guard === '0' || guard === 'false'),
    silhouette: truthy(q.get('silhouette')),
    debug: truthy(q.get('debug')),
  };
}

export function isStageLocation(loc: Pick<Location, 'pathname' | 'search'>): boolean {
  return /^\/stage\/?$/.test(loc.pathname) || new URLSearchParams(loc.search).has('stage');
}
