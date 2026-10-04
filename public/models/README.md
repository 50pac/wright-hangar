# Baymax models

- `baymax_v4.glb` — the project owner's own Blender model (v4: 12 meshes, 21 bones, clip `Baymax_Arm_Mobility`), optimised with `scripts/optimize-baymax.mjs` (dedup, prune, 14-bit quantisation, meshopt). Needs `EXT_meshopt_compression` + `KHR_mesh_quantization` (three's `MeshoptDecoder`).
- `baymax_v4_low.glb` — same model, body meshes simplified (~28.6k triangles); eyes, eye line and chest parts are untouched.

Unofficial fan-made model of a Disney character (Big Hero 6), personal non-commercial use only.
Regenerate: `node scripts/optimize-baymax.mjs <path/to/baymax_v4.glb> public/models`.
