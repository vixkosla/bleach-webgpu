import * as THREE from 'three/webgpu';
import { Fn, mix, texture3D, uniform, vec3 } from 'three/tsl';
import type { UpperEventLayout } from './upperEvent';

/** Shared lower edge of the distant storm. The city mist occupies its own
 * low volume; the empty interval between them reveals the original night. */
export const createUpperWeatherCeiling = (
  layout: UpperEventLayout,
  noise: THREE.Data3DTexture,
  clock: THREE.Node<'float'>,
) => {
  const controls = {
    nightGap: uniform(1),
    cloudBase: uniform(layout.crown.y - 150),
    cloudFade: uniform(165),
    cloudRelief: uniform(100),
    distantLight: uniform(0.65),
  };
  const coverage = Fn(([point]: [THREE.Node<'vec3'>]) => {
    // Broad horizontal folds, shared by the background and actual volume.
    // World height keeps the gap in place when the camera rises or orbits.
    const drift = vec3(clock.mul(0.00017), 0, clock.mul(-0.00012));
    const q = vec3(point.x, 0, point.z).mul(0.00033).add(drift);
    const broad = texture3D(noise, q.add(0.29), 0).r;
    const folds = texture3D(noise, q.mul(2.13).sub(drift.mul(0.4)).add(0.61), 0).r;
    const relief = broad.sub(0.5).add(folds.sub(0.5).mul(0.3)).mul(controls.cloudRelief);
    const height = point.y.sub(controls.cloudBase).sub(relief);
    return mix(1, height.div(controls.cloudFade.max(1)).smoothstep(0, 1), controls.nightGap);
  });
  // Sparse light openings in distant horizontal cloud strata. Their height
  // and slowly drifting folds belong to the scene, so orbit/elevation reveal
  // the same weather instead of dragging decorative lines with the camera.
  const distant = Fn(([point]: [THREE.Node<'vec3'>]) => {
    const drift = vec3(clock.mul(0.00005), 0, clock.mul(-0.000035));
    // Strongly stretched weather cells form uneven shelves at many heights.
    // A soft cloud mantle connects the narrow lit openings to their banks.
    const rolling = point.x.mul(0.0031).add(point.z.mul(0.0027)).add(clock.mul(0.018)).sin().mul(42)
      .add(point.x.mul(0.0078).sub(point.z.mul(0.0043)).sin().mul(18));
    const q = vec3(point.x, point.y.add(rolling), point.z)
      .mul(vec3(0.000065, 0.00045, 0.00008)).add(drift);
    const broad = texture3D(noise, q.add(0.37), 0).r;
    const folds = texture3D(noise, q.mul(vec3(1.83, 2.2, 1.83))
      .sub(drift).add(0.72), 0).r;
    const above = texture3D(noise, q.add(vec3(0.37, 0.379, 0.37)), 0).r;
    const field = broad.mul(0.76).add(folds.mul(0.24));
    const mantle = field.smoothstep(0.33, 0.62).mul(0.15);
    const litOpening = field.smoothstep(0.58, 0.76).mul(0.35);
    const rim = above.sub(broad).smoothstep(0.02, 0.18)
      .mul(field.smoothstep(0.44, 0.64)).mul(0.40);
    const envelope = point.y.sub(layout.crown.y - 90).div(135)
      .pow(2).mul(-0.5).exp().mul(point.y.smoothstep(100, 175));
    return mantle.add(litOpening).add(rim).mul(envelope).mul(controls.distantLight);
  });
  return { controls, coverage, distant };
};

export type UpperWeatherCeiling = ReturnType<typeof createUpperWeatherCeiling>;
