export type MaterialRole = 'body' | 'chestCover' | 'chestRecess' | 'eye';

/** Maps glTF material name (primary) and mesh/node name (fallback) to a render role. Returns null when unrecognised. */
export function classifyMaterial(materialName: string, meshName = ''): MaterialRole | null {
  const mat = materialName.toLowerCase();
  if (/soft_white_vinyl/.test(mat)) return 'body';
  if (/^chest_cover$/.test(mat)) return 'chestCover';
  if (/chest_recess/.test(mat)) return 'chestRecess';
  if (/^eyes?_/.test(mat)) return 'eye';
  const mesh = meshName.toLowerCase().replace(/[._]/g, '');
  if (/^eye/.test(mesh)) return 'eye';
  if (/^chestrecess|^chestcoverdivision/.test(mesh)) return 'chestRecess';
  if (/^chestcover/.test(mesh)) return 'chestCover';
  if (/torso|palm|head|leg/.test(mesh)) return 'body';
  return null;
}

/** Expected mapping for the shipped model; used by the smoke test and the report. */
export const EXPECTED_MESH_ROLES: Record<string, MaterialRole> = {
  'src_torso.001': 'body', 'palm_L.001': 'body', 'palm_R.001': 'body', Baymax_Head: 'body', Baymax_Leg_L: 'body', Baymax_Leg_R: 'body',
  Chest_Cover: 'chestCover', Chest_Cover_Division: 'chestRecess', Chest_Recess: 'chestRecess',
  Eye_L: 'eye', Eye_R: 'eye', Eye_Line: 'eye',
};

/** The character has no mouth or nose; anything matching is hidden if a future model ever ships one. */
export const HIDDEN_MESH_PATTERN = /mouth|nose|nostril|lip|teeth|tongue/i;
