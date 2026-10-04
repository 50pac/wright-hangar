// Usage: node scripts/optimize-baymax.mjs <source.glb> [outDir=public/models]
// Produces baymax_v4.glb (meshopt + quantize) and baymax_v4_low.glb (simplified + meshopt).
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, quantize, meshopt, simplifyPrimitive, reorder } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer';
import { statSync } from 'node:fs';
import path from 'node:path';

const [src, outDir = 'public/models'] = process.argv.slice(2);
if (!src) throw new Error('usage: optimize-baymax.mjs <source.glb> [outDir]');

await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready, MeshoptSimplifier.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'meshopt.decoder': MeshoptDecoder,
  'meshopt.encoder': MeshoptEncoder,
});

const tris = doc => doc.getRoot().listMeshes().reduce((n, m) => n + m.listPrimitives().reduce((k, p) => k + (p.getIndices()?.getCount() ?? 0) / 3, 0), 0);

// Per-mesh keep ratio for the low LOD. Face details (eyes, eye line, chest parts) are kept intact so they stay crisp.
const LOW_RATIO = { src_torso_001: 0.1, palm_L_001: 0.3, palm_R_001: 0.3, Baymax_Head: 0.25, Baymax_Leg_L: 0.08, Baymax_Leg_R: 0.08 };
const DETAIL = /^(Eye_|Chest_)/;

async function write(doc, name) {
  const file = path.join(outDir, name);
  await io.write(file, doc);
  const d = await io.read(file);
  const r = d.getRoot();
  console.log(JSON.stringify({ file, bytes: statSync(file).size, triangles: tris(d), meshes: r.listMeshes().length, skins: r.listSkins().length, joints: r.listSkins()[0]?.listJoints().length, animations: r.listAnimations().map(a => a.getName()) }));
}

// Main: dedup + prune + quantize + meshopt. Skinned POSITION quantisation is kept at 14 bit; verify bbox after load.
{
  const doc = await io.read(src);
  await doc.transform(dedup(), prune(), quantize({ quantizePosition: 14, quantizeNormal: 12, quantizeTexcoord: 12, quantizeWeight: 8, quantizeColor: 8 }), reorder({ encoder: MeshoptEncoder }), meshopt({ encoder: MeshoptEncoder, level: 'high' }));
  await write(doc, 'baymax_v4.glb');
}

// Low: simplify per mesh (weights/joints are kept since simplify only collapses onto existing vertices).
{
  const doc = await io.read(src);
  await doc.transform(dedup(), prune());
  for (const mesh of doc.getRoot().listMeshes()) {
    const key = mesh.getName().replace(/\./g, '_');
    if (DETAIL.test(key)) continue;
    const ratio = LOW_RATIO[key] ?? 1;
    if (ratio >= 1) continue;
    for (const prim of mesh.listPrimitives()) simplifyPrimitive(prim, { simplifier: MeshoptSimplifier, ratio, error: 0.02, lockBorder: false });
  }
  await doc.transform(prune(), quantize({ quantizePosition: 14, quantizeNormal: 12, quantizeWeight: 8 }), reorder({ encoder: MeshoptEncoder }), meshopt({ encoder: MeshoptEncoder, level: 'high' }));
  await write(doc, 'baymax_v4_low.glb');
}
