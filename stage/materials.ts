import { Color, DoubleSide, FrontSide, MeshPhysicalMaterial, type MeshPhysicalMaterialParameters } from 'three';
import type { MaterialRole } from './materialRoles';

/** Body white: a neutral #F4F4F2 (the plan's #F6F3EB vinyl read as cream under the warm key). Eyes stay matte black. */
export const STAGE_COLORS = { vinyl: '#F4F4F2', vinylShade: '#D8D2C4', chestRecess: '#BDB8AC', eye: '#0D0D11' } as const;

const PARAMS: Record<MaterialRole, MeshPhysicalMaterialParameters> = {
  body: {
    color: new Color(STAGE_COLORS.vinyl), roughness: 0.55, metalness: 0,
    // matte latex: a little sheen for the soft "inflated" edge, no clearcoat, no metal; no transmission (extra pass, goes grey)
    sheen: 0.4, sheenRoughness: 0.6, sheenColor: new Color('#F4F7FF'),
    specularIntensity: 0.3, clearcoat: 0, envMapIntensity: 0.3, side: FrontSide,
  },
  chestCover: {
    color: new Color('#ECEBE6'), roughness: 0.55, metalness: 0,
    sheen: 0.2, sheenRoughness: 0.6, sheenColor: new Color('#F4F7FF'),
    specularIntensity: 0.25, envMapIntensity: 0.3, side: DoubleSide,
  },
  chestRecess: {
    color: new Color(STAGE_COLORS.chestRecess), roughness: 0.78, metalness: 0,
    specularIntensity: 0.15, envMapIntensity: 0.25, side: DoubleSide,
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
