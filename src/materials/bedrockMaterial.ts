import { mix, mx_noise_float, normalView, positionView, positionWorld, vec3 } from 'three/tsl';
import { createWahrWeltFlatMaterial } from './wahrWeltCityMaterial';

/** Mineral variation and a world-space surface gradient, shared by the rock.
 * Geometry owns the fractures. Grain only changes the light on their faces. */
export const createBedrockMaterial = () => {
  const material = createWahrWeltFlatMaterial(0xffffff);
  material.name = 'fractured-island-bedrock';
  material.vertexColors = true;
  const p = positionWorld;
  const mineral = mx_noise_float(p.mul(vec3(.019, .014, .017)));
  const cleavage = mx_noise_float(p.mul(vec3(.046, .011, .038)));
  const chips = mx_noise_float(p.mul(.095));
  const grain = mx_noise_float(p.mul(.36));
  const footprint = p.dFdx().length().max(p.dFdy().length());
  const detail = footprint.smoothstep(1.8, 5.5).oneMinus();
  const weathering = mineral.mul(.48).add(cleavage.mul(.28)).add(.52);
  material.colorNode = mix(vec3(.19, .184, .20), vec3(.58, .55, .575), weathering)
    .mul(chips.mul(.18).add(grain.mul(detail).mul(.065)).add(1));

  const height = cleavage.mul(4.5).add(chips.mul(1.75)).add(grain.mul(detail).mul(.30));
  const dx = positionView.dFdx(), dy = positionView.dFdy();
  const r1 = dy.cross(normalView), r2 = normalView.cross(dx);
  const determinant = dx.dot(r1);
  const gradient = determinant.sign().mul(height.dFdx().mul(r1).add(height.dFdy().mul(r2)));
  material.normalNode = determinant.abs().mul(normalView).sub(gradient).normalize();
  return material;
};
