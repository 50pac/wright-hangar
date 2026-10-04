import { Color, DoubleSide, FrontSide, MeshPhysicalMaterial, type MeshPhysicalMaterialParameters } from 'three';
import type { MaterialRole } from './materialRoles';

/** Body white = vinyl token from the Baymax plan (#F6F3EB). Eyes stay matte black. */
export const STAGE_COLORS = { vinyl: '#F6F3EB', vinylShade: '#D8D2C4', chestRecess: '#BDB8AC', eye: '#0D0D11' } as const;

const PARAMS: Record<MaterialRole, MeshPhysicalMaterialParameters> = {
  body: {
    color: new Color(STAGE_COLORS.vinyl), roughness: 0.66, metalness: 0,
    // very light sheen = soft "inflated vinyl" edge; no transmission (extra pass, goes grey)
    sheen: 0.3, sheenRoughness: 0.55, sheenColor: new Color('#FFFFFF'),
    specularIntensity: 0.35, clearcoat: 0, envMapIntensity: 0.35, side: FrontSide,
  },
  chestCover: {
    color: new Color('#E9E5DA'), roughness: 0.6, metalness: 0,
    sheen: 0.2, sheenRoughness: 0.6, sheenColor: new Color('#FFFFFF'),
    specularIntensity: 0.3, envMapIntensity: 0.4, side: DoubleSide,
  },
  chestRecess: {
    color: new Color(STAGE_COLORS.chestRecess), roughness: 0.75, metalness: 0,
    specularIntensity: 0.2, envMapIntensity: 0.3, side: DoubleSide,
  },
  eye: {
    color: new Color(STAGE_COLORS.eye), roughness: 1, metalness: 0,
    sheen: 0, clearcoat: 0, specularIntensity: 0, envMapIntensity: 0, side: DoubleSide,
  },
};

export function createStageMaterial(role: MaterialRole, name: string): MeshPhysicalMaterial {
  const m = new MeshPhysicalMaterial(PARAMS[role]);
  m.name = `${name}:${role}`;
  return m;
}
