import { statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { expect, it } from 'vitest';
import { FpsGuard } from './fpsGuard';
import { classifyMaterial, EXPECTED_MESH_ROLES } from './materialRoles';
import { createStageMaterial, STAGE_COLORS } from './materials';
import { BREATH, clipShouldAdvance, decorPose } from './motion';
import { CLIP_NAME, isStageLocation, MODEL_URLS, parseStageParams } from './params';

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
  expect(body.color.getHexString()).toBe('f6f3eb');
  expect(body.roughness).toBeGreaterThanOrEqual(0.6);
  expect(body.roughness).toBeLessThanOrEqual(0.7);
  expect(body.sheen).toBeLessThanOrEqual(0.4);
  expect(body.transmission).toBe(0);
});

it('parses stage URL params', () => {
  expect(parseStageParams('')).toEqual({ view: 'threeq', lod: 'full', still: false, fpsGuard: true, silhouette: false, debug: false });
  expect(parseStageParams('?view=side&lod=low&still=1&fpsguard=0')).toMatchObject({ view: 'side', lod: 'low', still: true, fpsGuard: false });
  expect(parseStageParams('?view=bogus&lod=bogus').view).toBe('threeq');
  expect(isStageLocation({ pathname: '/stage', search: '' })).toBe(true);
  expect(isStageLocation({ pathname: '/', search: '?stage' })).toBe(true);
  expect(isStageLocation({ pathname: '/', search: '' })).toBe(false);
});

it('reduced motion cuts decorative amplitude to at most half and freezes the clip', () => {
  expect(BREATH.reducedFactor).toBeLessThanOrEqual(0.5);
  const peak = (reduced: boolean) => Math.max(...Array.from({ length: 80 }, (_, i) => Math.abs(decorPose(i * 0.05, { reduced, still: false }).pitch)));
  expect(peak(true)).toBeLessThanOrEqual(peak(false) * 0.5);
  expect(decorPose(1, { reduced: false, still: true })).toEqual({ scaleY: 1, pitch: 0, amplitudeFactor: 0 });
  expect(clipShouldAdvance({ reduced: false, still: false, paused: false })).toBe(true);
  for (const o of [{ reduced: true, still: false, paused: false }, { reduced: false, still: true, paused: false }, { reduced: false, still: false, paused: true }]) expect(clipShouldAdvance(o)).toBe(false);
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
