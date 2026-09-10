import * as THREE from 'three/webgpu';
import { ImprovedNoise } from 'three/addons/math/ImprovedNoise.js';
import { smoothstep } from '../utils/math';

/** Central folds and their rear-light transmission in the storm's existing box.
 * Broad connected weather, with several scales of erosion and depth relief.
 * Light is baked through the same density, so dense ridges occlude its source.
 */
export const createCentralCloudTexture = (
  span: THREE.Vector3, offset: THREE.Vector3, cloudToMoon: THREE.Matrix4, size = 128,
): THREE.Data3DTexture => {
  const noise = new ImprovedNoise(), density = new Float32Array(size ** 3);
  const point = new THREE.Vector3();
  for (let z = 0; z < size; z++) for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    point.set((x / (size - 1) - 0.5) * span.x + offset.x,
      (y / (size - 1) - 0.5) * span.y + offset.y,
      (z / (size - 1) - 0.5) * span.z + offset.z).applyMatrix4(cloudToMoon);
    const { x: px, y: py, z: pz } = point;
    const broad = noise.noise(px * 0.83 + 19, py * 0.91 + 7, pz * 0.85 + 11);
    const bend = noise.noise(px * 1.25 + 3, py * 1.1 + 31, pz * 1.4 + 17);
    const across = py + px * 0.21 - Math.sin(px * 1.6 + 0.5) * 0.22 - broad * 0.35;
    const depth = pz + 0.88 + broad * 0.4 + Math.sin(px * 1.4) * 0.16;
    const envelope = Math.exp(-((px / 2.2) ** 4 + ((across + 0.04) / 1.42) ** 4
      + (depth / 0.44) ** 2) * 1.35);
    if (envelope < 0.002) continue;
    // Rolled ridges cross and join; nested turbulence breaks their crests.
    const folds = noise.noise(px * 1.7 + bend * 0.6 + 37,
      across * 3.6 + broad * 1.6 + 5, pz * 3.1 + 41);
    const lobes = noise.noise(px * 4.2 + broad + 13, py * 5.1 + bend + 29, pz * 4.6 + 3);
    const fine = noise.noise(px * 9.4 + 43, py * 10.1 + 17, pz * 8.7 + 23);
    const shape = 0.49 + folds * 0.8 + lobes * 0.34 + fine * 0.12;
    const body = smoothstep(0.27, 0.77, shape);
    // Keep a luminous, translucent opening through the centre of the moon.
    const opening = 0.30 + 0.70 * smoothstep(0.35, 1.18, Math.hypot(px + 0.10, py - 0.02));
    const border = 1 - smoothstep(0.39, 0.49, Math.max(Math.abs(x / (size - 1) - 0.5),
      Math.abs(y / (size - 1) - 0.5), Math.abs(z / (size - 1) - 0.5)));
    density[(z * size + y) * size + x] = envelope * (body * 0.95 + 0.025) * opening * border;
  }
  const sample = (p: THREE.Vector3) => {
    const x = Math.round(((p.x - offset.x) / span.x + 0.5) * (size - 1));
    const y = Math.round(((p.y - offset.y) / span.y + 0.5) * (size - 1));
    const z = Math.round(((p.z - offset.z) / span.z + 0.5) * (size - 1));
    if (x < 0 || y < 0 || z < 0 || x >= size || y >= size || z >= size) return 0;
    return density[(z * size + y) * size + x]!;
  };
  const lightStep = new THREE.Vector3(-0.20, 0.34, -0.65)
    .transformDirection(cloudToMoon.clone().invert()).multiplyScalar(0.09);
  const data = new Uint8Array(size ** 3 * 2), probe = new THREE.Vector3();
  for (let z = 0; z < size; z++) for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (z * size + y) * size + x;
    point.set((x / (size - 1) - 0.5) * span.x + offset.x,
      (y / (size - 1) - 0.5) * span.y + offset.y,
      (z / (size - 1) - 0.5) * span.z + offset.z);
    let optical = 0; probe.copy(point);
    for (let j = 0; j < 14; j++) { probe.add(lightStep); optical += sample(probe) * 0.09; }
    data[i * 2] = Math.round(density[i]! * 255);
    data[i * 2 + 1] = Math.round(Math.exp(-optical * 7) * 255);
  }
  const texture = new THREE.Data3DTexture(data, size, size, size);
  texture.name = 'central-cloud-folds-rear-transmission';
  texture.format = THREE.RGFormat;
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.unpackAlignment = 1; texture.needsUpdate = true;
  return texture;
};
