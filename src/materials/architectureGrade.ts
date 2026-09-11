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
    story: uniform(0), eventLight: uniform(1), lightReach: uniform(1250),
  };
  const view = getViewPosition(screenUV, depth, uniform(camera.projectionMatrixInverse));
  const world = uniform(camera.matrixWorld).mul(vec4(view, 1)).xyz;
  const rise = world.y.smoothstep(CITY_DECK_Y + 10, crownY).pow(1.1);
  const keepDistance = vec2(world.x, world.z.sub(TOWER_Z)).length();
  const keep = keepDistance.smoothstep(controls.citadelRadius.mul(1.55), controls.citadelRadius);
  const citadel = mix(controls.citadelGain, controls.crownGain, rise);
  // Buried rock must not inherit the bright radial citadel mask. Its faint
  // reflected light reveals the torn mass without lifting city or lunar colour.
  const belowDeck = world.y.smoothstep(CITY_DECK_Y - 4, CITY_DECK_Y - 55);
  const rockGain = world.y.smoothstep(-440, CITY_DECK_Y).mul(.22).add(.47);
  const gain = mix(mix(controls.cityGain, citadel, keep), rockGain, belowDeck);
  // The event illuminates world positions, not a screen-space wipe: the
  // crown catches it first and the same front then reaches lower masonry.
  const sourceDistance = world.sub(vec3(0, crownY + 248, TOWER_Z)).length();
  const reached = sourceDistance.smoothstep(controls.lightReach.sub(90), controls.lightReach.add(90)).oneMinus();
  const received = reached.mul(controls.eventLight);
  const storyGain = mix(gain.mul(.22).add(.055), gain.mul(1.12), received);
  const surfaceGain = mix(gain, storyGain, controls.story);
  const luminance = beauty.dot(vec3(0.2126, 0.7152, 0.0722));
  const restrained = mix(vec3(luminance), beauty, controls.saturation);
  // Project palette is violet-pink, not blue: the night tint leans lavender.
  const tint = mix(vec3(.64, .62, 1), vec3(.97, .9, 1), received.min(1));
  let graded = restrained.mul(mix(vec3(.97, .9, 1), tint, controls.story))
    .mul(surfaceGain).mul(controls.exposure);
  if (glow) graded = graded.add(glow.mul(controls.glowGain)
    .mul(mix(1, received.mul(.84).add(.16), controls.story)));
  return { output: vec4(depth.lessThan(1).select(graded, beauty), 1), controls };
};
