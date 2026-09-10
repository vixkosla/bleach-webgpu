import * as THREE from 'three/webgpu';
import { Fn, If, Loop, float, getViewPosition, mix, screenUV, texture3D, uniform, vec2, vec3, vec4 } from 'three/tsl';

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
    const safeRay = ray.abs().max(vec3(0.00001))
      .mul(ray.greaterThanEqual(vec3(0)).select(vec3(1), vec3(-1)));
    const near = vec3(-520, deckY + 0.5, centerZ - 640).sub(origin).div(safeRay);
    const far = vec3(520, deckY + 116, centerZ + 640).sub(origin).div(safeRay);
    const lo = near.min(far), hi = near.max(far);
    const entry = lo.x.max(lo.y).max(lo.z).max(0);
    const exit = hi.x.min(hi.y).min(hi.z).min(distance);
    const light = vec3(0).toVar();
    const coverage = float(0).toVar();
    If(exit.greaterThan(entry).and(controls.strength.greaterThan(0)), () => {
      // Integrate only the bounded low layer. Twelve smooth samples suffice
      // for this dilute medium; no new pass, render target or noise allocation.
      const step = exit.sub(entry).div(12);
      Loop(12, ({ i }) => {
        const p = origin.add(ray.mul(entry.add(float(i).add(0.5).mul(step))));
        const local = p.sub(vec3(0, deckY, centerZ));
        const edge = local.xz.div(vec2(510, 625)).length().smoothstep(0.80, 1).oneMinus();
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
        const extinction = edge.mul(vertical).mul(billows).mul(controls.density)
          .mul(controls.strength);
        const alpha = extinction.mul(step).negate().exp().oneMinus();
        // A small lavender lift within the air, subtly brighter toward the
        // citadel; the hue sits between the violet growth and the pale keep.
        // This does not alter stone/crystal palette or exposure.
        const innerLight = local.xz.div(vec2(260, 340)).length().pow(2).mul(-0.5).exp();
        const tint = mix(vec3(0.30, 0.20, 0.40), vec3(0.70, 0.50, 0.80),
          broad.mul(0.35).add(innerLight.mul(0.5))).mul(controls.glow);
        light.addAssign(tint.mul(coverage.oneMinus()).mul(alpha));
        coverage.addAssign(coverage.oneMinus().mul(alpha));
      });
    });
    // Cap the veil to retain dark apertures and the existing painted planes.
    const opacity = coverage.min(0.24);
    return vec4(light.div(coverage.max(0.0001)).mul(opacity), opacity);
  })();
  return { layer, controls };
};
