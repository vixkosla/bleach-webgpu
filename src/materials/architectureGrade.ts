import * as THREE from 'three/webgpu';
import { getViewPosition, mix, screenUV, uniform, vec2, vec3, vec4 } from 'three/tsl';
import { CITY_DECK_Y, TOWER_Z } from '../scene/constants';

/** Reference night grade, evaluated in world space before sky compositing.
 * The reference frames keep the city dark while the citadel reads pale over
 * its whole height, brightest at the crown: a radial mask around the keep
 * selects the citadel envelope, a height ramp lifts it toward the crown, and
 * the surrounding city sits under the storm. Camera motion cannot move this
 * light envelope. An optional glow (bloomed emission) is added after the gain
 * so luminous crystals in the dark city are not crushed with the stone. */
export const createArchitectureGrade = (
  beauty: THREE.Node<'vec3'>,
  depth: THREE.Node<'float'>,
  camera: THREE.PerspectiveCamera,
  crownY: number,
  glow: THREE.Node<'vec3'> | null = null,
) => {
  const controls = {
    exposure: uniform(0.72),
    saturation: uniform(0.88),
    cityGain: uniform(0.3),
    citadelGain: uniform(1.5),
    crownGain: uniform(3.2),
    citadelRadius: uniform(175),
    glowGain: uniform(1.0),
  };
  const view = getViewPosition(screenUV, depth, uniform(camera.projectionMatrixInverse));
  const world = uniform(camera.matrixWorld).mul(vec4(view, 1)).xyz;
  const rise = world.y.smoothstep(CITY_DECK_Y + 10, crownY).pow(1.1);
  const keepDistance = vec2(world.x, world.z.sub(TOWER_Z)).length();
  const keep = keepDistance.smoothstep(controls.citadelRadius.mul(1.55), controls.citadelRadius);
  const citadel = mix(controls.citadelGain, controls.crownGain, rise);
  const gain = mix(controls.cityGain, citadel, keep);
  const luminance = beauty.dot(vec3(0.2126, 0.7152, 0.0722));
  const restrained = mix(vec3(luminance), beauty, controls.saturation);
  // Project palette is violet-pink, not blue: the night tint leans lavender.
  let graded = restrained.mul(vec3(0.97, 0.9, 1)).mul(gain).mul(controls.exposure);
  if (glow) graded = graded.add(glow.mul(controls.glowGain));
  return { output: vec4(depth.lessThan(1).select(graded, beauty), 1), controls };
};
