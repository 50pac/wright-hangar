import { statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { expect, it } from 'vitest';
import { FpsGuard } from './fpsGuard';
import { classifyMaterial, EXPECTED_MESH_ROLES, HIDDEN_MESH_PATTERN } from './materialRoles';
import { createStageMaterial, STAGE_COLORS } from './materials';
import { BREATH, POSE, clipShouldAdvance, decorPose } from './motion';
import { CAMERA_FOV, CLIP_NAME, FRAME_FILL, TARGET, VIEW_PRESETS, cameraDistance, cameraPosition, isStageLocation, MODEL_URLS, parseStageParams } from './params';

const modelPath = (lod: 'full' | 'low') => fileURLToPath(new URL(`../public${MODEL_URLS[lod]}`, import.meta.url));
async function readGlb(lod: 'full' | 'low') {
  await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  return io.read(modelPath(lod));
}
const triangles = (doc: Awaited<ReturnType<typeof readGlb>>) =>
  doc.getRoot().listMeshes().reduce((n, m) => n + m.listPrimitives().reduce((k, p) => k + (p.getIndices()?.getCount() ?? 0) / 3, 0), 0);

it.each(['full', 'low'] as const)('GLB smoke (%s): skeleton, clip, materials, size', async lod => {
  const doc = await readGlb(lod);
  const root = doc.getRoot();
  const joints = new Set(root.listSkins().flatMap(s => s.listJoints().map(j => j.getName())));
  expect(joints.size).toBe(21);
  expect(root.listAnimations().map(a => a.getName())).toEqual([CLIP_NAME]);
  const clip = root.listAnimations()[0];
  expect(clip.listChannels().length).toBe(63);
  const end = Math.max(...clip.listSamplers().map(s => s.getInput()!.getMax([])[0]));
  expect(end).toBeCloseTo(4, 1); // 96 frames @ 24 fps, model's own range
  expect(root.listMeshes().length).toBe(12);
  const roles: Record<string, string | null> = {};
  for (const mesh of root.listMeshes()) roles[mesh.getName()] = classifyMaterial(mesh.listPrimitives()[0].getMaterial()!.getName(), mesh.getName());
  expect(roles).toEqual(EXPECTED_MESH_ROLES);
  expect(statSync(modelPath(lod)).size).toBeLessThan(1_500_000);
  expect(doc.getRoot().listExtensionsRequired().map(e => e.extensionName)).toContain('EXT_meshopt_compression');
  if (lod === 'low') expect(triangles(doc)).toBeLessThanOrEqual(30_000);
});

it('low LOD keeps face and chest detail meshes untouched', async () => {
  const [full, low] = [await readGlb('full'), await readGlb('low')];
  const count = (doc: typeof full, name: string) => doc.getRoot().listMeshes().find(m => m.getName() === name)!.listPrimitives()[0].getIndices()!.getCount();
  for (const name of ['Eye_L', 'Eye_R', 'Eye_Line', 'Chest_Cover', 'Chest_Recess']) expect(count(low, name), name).toBe(count(full, name));
  expect(triangles(low)).toBeLessThan(triangles(full) / 5);
});

it('classifies materials by name with mesh-name fallback', () => {
  expect(classifyMaterial('Baymax_Soft_White_Vinyl')).toBe('body');
  expect(classifyMaterial('Eyes_Charcoal')).toBe('eye');
  expect(classifyMaterial('Chest_Recess_Shadow')).toBe('chestRecess');
  expect(classifyMaterial('Chest_Cover')).toBe('chestCover');
  expect(classifyMaterial('Material.001', 'Eye_L')).toBe('eye');
  expect(classifyMaterial('Material.001', 'mystery')).toBeNull();
});

it('keeps eyes matte black and the body matte white', () => {
  const eye = createStageMaterial('eye', 'Eyes_Charcoal');
  expect(eye.color.getHexString()).toBe(STAGE_COLORS.eye.slice(1).toLowerCase());
  expect(eye.roughness).toBe(1);
  expect(eye.specularIntensity).toBe(0);
  expect(eye.envMapIntensity).toBe(0);
  expect(eye.sheen).toBe(0);
  expect(eye.clearcoat).toBe(0);
  const body = createStageMaterial('body', 'Baymax_Soft_White_Vinyl');
  expect(body.color.getHexString()).toBe('f4f4f2');
  expect(body.roughness).toBeGreaterThanOrEqual(0.5);
  expect(body.roughness).toBeLessThanOrEqual(0.7);
  expect(body.sheen).toBeLessThanOrEqual(0.4);
  expect(body.transmission).toBe(0);
});

it('parses stage URL params', () => {
  expect(parseStageParams('')).toEqual({ view: 'threeq', lod: 'full', still: false, t: null, bare: false, shellLayout: false, fpsGuard: true, silhouette: false, theme: 'a', intro: null, introT: null, debug: false, yaw: null });
  expect(parseStageParams('?yaw=90').yaw).toBe(90); expect(parseStageParams('?yaw=abc').yaw).toBeNull();
  expect(parseStageParams('?view=side&lod=low&still=1&fpsguard=0')).toMatchObject({ view: 'side', lod: 'low', still: true, fpsGuard: false });
  expect(parseStageParams('?view=bogus&lod=bogus').view).toBe('threeq');
  expect(parseStageParams('?t=0.5').t).toBe(0.5);
  expect(parseStageParams('?t=7').t).toBe(1);
  expect(parseStageParams('?t=abc').t).toBeNull();
  expect(parseStageParams('?bare=1').bare).toBe(true);
  expect(parseStageParams('?silhouette=1').bare).toBe(true);
  expect(isStageLocation({ pathname: '/stage', search: '' })).toBe(true);
  expect(isStageLocation({ pathname: '/', search: '?stage' })).toBe(true);
  expect(isStageLocation({ pathname: '/', search: '' })).toBe(false);
});

it('uses a narrow lens, a slight look-down and ~60 % framing', () => {
  expect(CAMERA_FOV).toBeGreaterThanOrEqual(28);
  expect(CAMERA_FOV).toBeLessThanOrEqual(35);
  for (const v of ['front', 'side', 'threeq'] as const) {
    expect(VIEW_PRESETS[v].elevationDeg).toBeGreaterThan(3);
    expect(VIEW_PRESETS[v].elevationDeg).toBeLessThan(15);
    const [, y] = cameraPosition(v, 3);
    expect(y).toBeGreaterThan(TARGET[1]); // camera above the look-at point
  }
  expect(FRAME_FILL).toBeGreaterThanOrEqual(0.55);
  expect(FRAME_FILL).toBeLessThanOrEqual(0.65);
  expect(cameraDistance(16 / 10)).toBeLessThan(cameraDistance(0.5)); // narrow viewports back off so the arms stay in frame
});

it('breath is slow and light; lean / head tilt match the brief; reduced motion keeps at most half and freezes the clip', () => {
  expect(BREATH.hz).toBeCloseTo(0.2, 5);
  expect(BREATH.scaleY).toBeLessThanOrEqual(0.015);
  expect(POSE.leanDeg).toBeGreaterThanOrEqual(4);
  expect(POSE.leanDeg).toBeLessThanOrEqual(5);
  expect(POSE.headTiltDeg).toBeCloseTo(3, 1);
  expect(POSE.reducedFactor).toBeLessThanOrEqual(0.5);
  const samples = Array.from({ length: 200 }, (_, i) => i * 0.05);
  const peak = (reduced: boolean) => Math.max(...samples.map(t => Math.abs(decorPose(t, { reduced, frozen: false }).scaleY - 1)));
  expect(peak(false)).toBeLessThanOrEqual(0.015);
  expect(peak(true)).toBeLessThanOrEqual(peak(false) * 0.5);
  const full = decorPose(1, { reduced: false, frozen: false }), red = decorPose(1, { reduced: true, frozen: false });
  expect(red.leanRad).toBeLessThanOrEqual(full.leanRad * 0.5);
  expect(red.headTiltRad).toBeLessThanOrEqual(full.headTiltRad * 0.5);
  const frozen = decorPose(1, { reduced: false, frozen: true });
  expect(frozen.scaleY).toBe(1); // no breath while frozen, static pose kept
  expect(frozen.leanRad).toBeCloseTo((4.5 * Math.PI) / 180, 6);
  expect(clipShouldAdvance({ reduced: false, fixed: false, paused: false })).toBe(true);
  for (const o of [{ reduced: true, fixed: false, paused: false }, { reduced: false, fixed: true, paused: false }, { reduced: false, fixed: false, paused: true }]) expect(clipShouldAdvance(o)).toBe(false);
});

it('the model ships no mouth or nose (and any such mesh would be hidden)', async () => {
  const doc = await readGlb('full');
  const names = [...doc.getRoot().listMeshes().map(m => m.getName()), ...doc.getRoot().listNodes().map(n => n.getName())];
  expect(names.filter(n => HIDDEN_MESH_PATTERN.test(n))).toEqual([]);
  expect(HIDDEN_MESH_PATTERN.test('Mouth_01')).toBe(true);
});

it('the head is an independent bone', async () => {
  const doc = await readGlb('full');
  expect(doc.getRoot().listSkins()[0].listJoints().map(j => j.getName())).toContain('Bone_Head');
});

it('FPS guard fires once after 3 s below 40 fps and not for healthy or recovering frame rates', () => {
  const run = (frameMs: (t: number) => number, until = 12_000) => {
    const g = new FpsGuard(); let t = 0; let fired = -1;
    g.reset(0);
    while (t < until) { t += frameMs(t); if (g.tick(t).trigger && fired < 0) fired = t; }
    return { fired, g };
  };
  const slow = run(() => 50); // 20 fps
  expect(slow.fired).toBeGreaterThanOrEqual(4_000); // 1 s warm-up + 3 s sustained
  expect(slow.fired).toBeLessThanOrEqual(5_500);
  expect(slow.g.hasFired).toBe(true);
  expect(run(() => 16.7).fired).toBe(-1);
  expect(run(t => (t % 6000 < 2000 ? 50 : 16.7)).fired).toBe(-1); // dips shorter than 3 s
});
