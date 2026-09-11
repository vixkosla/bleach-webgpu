import * as THREE from 'three/webgpu';
import { ISLAND_RADIUS_X, ISLAND_RADIUS_Z } from '../scene/islandLayout';
import { Fn, If, Loop, float, getViewPosition, mix, screenCoordinate, screenUV, texture3D, uniform, vec2, vec3, vec4 } from 'three/tsl';

/** Thin luminous air over the streets, composited after the distant weather
 * and before lunar matter. World-depth ends each ray at the first facade/roof;
 * no fog geometry or light enters the architecture's normal/emissive masks. */
export const createCityHaze = (
  depth: THREE.Node<'float'>,
  camera: THREE.PerspectiveCamera,
  noise: THREE.Data3DTexture,
  clock: THREE.Node<'float'>,
  deckY: number,
  centerZ: number,
) => {
  const controls = {
    strength: uniform(1),
    outerBanks: uniform(1),
    opacityLimit: uniform(.24),
    density: uniform(0.0032),
    height: uniform(28),
    // Reference-look tuning (Cursor, 2026-09-09, with Namikadzee's layer
    // released): a quieter veil keeps the dark-city / bright-crystal contrast.
    glow: uniform(0.38),
    speed: uniform(1),
    offset: uniform(0),
  };
  const cameraWorld = uniform(camera.matrixWorld);
  const inverseProjection = uniform(camera.projectionMatrixInverse);
  const time = clock.mul(controls.speed).add(controls.offset);
  const layer = Fn(() => {
    const view = getViewPosition(screenUV, depth, inverseProjection);
    const origin = cameraWorld.mul(vec4(0, 0, 0, 1)).xyz;
    const hit = cameraWorld.mul(vec4(view, 1)).xyz;
    const delta = hit.sub(origin);
    const distance = delta.length();
    const ray = delta.div(distance.max(0.0001));
    // Intersect the low height slab; the existing elliptical density fade
    // bounds it horizontally. Avoid a hard side-face boundary in street views.
    const safeY = ray.y.abs().max(.00001).mul(ray.y.greaterThanEqual(0).select(1, -1));
    const near = float(deckY + .5).sub(origin.y).div(safeY);
    const far = float(deckY + 190).sub(origin.y).div(safeY);
    const entry = near.min(far).max(0);
    const exit = near.max(far).min(distance).min(entry.add(2400));
    const light = vec3(0).toVar();
    const coverage = float(0).toVar();
    const outerCoverage = float(0).toVar();
    If(exit.greaterThan(entry).and(controls.strength.greaterThan(0)), () => {
      // Integrate only the bounded low layer. Twenty-four jittered samples suffice
      // for this dilute medium; no new pass, render target or noise allocation.
      const step = exit.sub(entry).div(24);
      // Stable subpixel offsets remove the horizontal integration shelves
      // in grazing island views. Noise is spatial, never a temporal flicker.
      const jitter = screenCoordinate.xy.dot(vec2(12.9898, 78.233)).sin().mul(43758.5453).fract();
      Loop(24, ({ i }) => {
        const p = origin.add(ray.mul(entry.add(float(i).add(jitter.mul(.8).add(.1)).mul(step))));
        const local = p.sub(vec3(0, deckY, centerZ));
        const edge = local.xz.div(vec2(ISLAND_RADIUS_X * 1.07, ISLAND_RADIUS_Z * 1.07))
          .length().smoothstep(.84, 1.05).oneMinus();
        const outer = local.xz.div(vec2(500, 620)).length().smoothstep(.84, 1.19)
          .mul(controls.outerBanks);
        const drift = vec3(time.mul(0.00065), time.mul(-0.00012), time.mul(-0.00038));
        // The shared texture is a 32-cell lattice: these coordinates give
        // broad 50–60m billows, with softer 25m folds instead of fine stripes.
        const q = local.mul(vec3(0.0006, 0.001, 0.000525)).add(drift);
        const broad = texture3D(noise, q.add(0.31), 0).r;
        const folds = texture3D(noise, q.mul(vec3(2.1, 1.35, 2.1))
          .sub(drift.mul(0.6)).add(broad.mul(0.015)).add(0.67), 0).r;
        const lifted = local.y.sub(broad.sub(0.5).mul(22));
        const vertical = lifted.sub(22).div(controls.height.max(1)).pow(2).mul(-0.5).exp()
          .mul(local.y.smoothstep(0.5, 6)).mul(local.y.smoothstep(70, 116).oneMinus());
        const billows = broad.mul(0.66).add(folds.mul(0.34)).smoothstep(0.28, 0.72)
          .mul(0.85).add(0.15);
        // A wind front moves across the actual ward coordinates. Roofs and
        // towers stay fixed while banks lift, fold and uncover them in sequence.
        const wind = time.mul(.29).add(local.x.mul(.008)).add(local.z.mul(.005));
        const bankLift = wind.sin().mul(32).add(57).add(broad.sub(.5).mul(35));
        const bankHeight = local.y.sub(bankLift).div(39).pow(2).mul(-.5).exp()
          .mul(local.y.smoothstep(.5, 10)).mul(local.y.smoothstep(125, 190).oneMinus());
        const bankDensity = wind.sin().smoothstep(-.45, .65).mul(1.15);
        const outerExtinction = bankHeight.mul(bankDensity).mul(outer).mul(3.7);
        const extinction = edge.mul(vertical.add(outerExtinction)).mul(billows)
          .mul(controls.density).mul(controls.strength);
        const alpha = extinction.mul(step).negate().exp().oneMinus();
        // A small lavender lift within the air, subtly brighter toward the
        // citadel; the hue sits between the violet growth and the pale keep.
        // This does not alter stone/crystal palette or exposure.
        const innerLight = local.xz.div(vec2(260, 340)).length().pow(2).mul(-0.5).exp();
        const tint = mix(mix(vec3(0.30, 0.20, 0.40), vec3(0.70, 0.50, 0.80),
          broad.mul(0.35).add(innerLight.mul(0.5))),
          vec3(.51, .46, .61).mul(broad.mul(.26).add(.87)), outer.mul(.8))
          .mul(controls.glow);
        const weight = coverage.oneMinus().mul(alpha);
        light.addAssign(tint.mul(weight));
        outerCoverage.addAssign(weight.mul(outerExtinction.div(vertical.add(outerExtinction).max(.0001))));
        coverage.addAssign(weight);
      });
    });
    // Cap the veil to retain dark apertures and the existing painted planes.
    const bankFraction = outerCoverage.div(coverage.max(.0001));
    const opacity = coverage.min(mix(controls.opacityLimit, .88, bankFraction));
    return vec4(light.div(coverage.max(0.0001)).mul(opacity), opacity);
  })();
  return { layer, controls };
};
