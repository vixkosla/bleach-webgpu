import * as THREE from 'three/webgpu';
import { createRandom, smoothstep } from '../utils/math';

const hash = (x: number, y: number, z: number, seed: number): number => {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1442695041) ^ seed;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
};
const noise = (x: number, y: number, z: number, seed: number): number => {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy), sz = fz * fz * (3 - 2 * fz);
  const mix = (a: number, b: number, t: number) => a + (b - a) * t;
  const plane = (dz: number) => mix(
    mix(hash(ix, iy, iz + dz, seed), hash(ix + 1, iy, iz + dz, seed), sx),
    mix(hash(ix, iy + 1, iz + dz, seed), hash(ix + 1, iy + 1, iz + dz, seed), sx), sy,
  );
  return mix(plane(0), plane(1), sz);
};

/**
 * Offline-style volumetric impostor, baked once on CPU (no canvas or network).
 * Integrate an eroded 3D cloud body along Z, then derive soft surface normals.
 * RG = tangent normal XY, B = optical depth / 4, A = Beer-Lambert coverage.
 * Unlike a flat fBm stamp, thick lobes and thin edges respond differently to
 * runtime light. Four seeds are used by the scene, not 31 identical sprites.
 */
export const createCloudTexture = (seed = 0x45c10d, size = 192): THREE.DataTexture => {
  if (!Number.isInteger(size) || size < 4) throw new Error('Cloud atlas size must be >= 4');
  const random = createRandom(seed);
  const lobes = Array.from({ length: 7 }, (_, i) => ({
    x: i === 0 ? 0 : (random() - 0.5) * 1.1,
    y: i === 0 ? 0 : (random() - 0.5) * 0.92,
    z: (random() - 0.5) * 0.55,
    rx: 1 / (i === 0 ? 0.72 : 0.32 + random() * 0.32),
    ry: 1 / (i === 0 ? 0.59 : 0.3 + random() * 0.3),
    rz: 1 / (0.38 + random() * 0.22),
  }));
  const data = new Uint8Array(size * size * 4);
  const heights = new Float32Array(size * size);
  const step = 2 / 20;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / (size - 1) * 2 - 1, v = y / (size - 1) * 2 - 1;
    const border = 1 - smoothstep(0.86, 1, Math.max(Math.abs(u), Math.abs(v)));
    let optical = 0, visibleHeight = 0, transmittance = 1;
    if (border > 0) for (let slice = 0; slice < 20; slice++) {
      const z = 1 - (slice + 0.5) * step;
      let envelope = -1;
      for (const lobe of lobes) {
        const dx = (u - lobe.x) * lobe.rx, dy = (v - lobe.y) * lobe.ry, dz = (z - lobe.z) * lobe.rz;
        envelope = Math.max(envelope, 1 - dx * dx - dy * dy - dz * dz);
      }
      if (envelope < -0.32) continue;
      const turbulence = noise(u * 4.2 + 7, v * 4.2 + 13, z * 4.2, seed) * 0.46
        + noise(u * 9.1, v * 9.1 + 3, z * 9.1, seed + 17) * 0.34
        + noise(u * 19.3, v * 19.3, z * 19.3, seed + 71) * 0.2;
      const density = Math.max(0, envelope * 0.55 + (turbulence - 0.55) * 1.65) * border;
      const depth = density * step * 7;
      const alpha = 1 - Math.exp(-depth);
      visibleHeight += z * alpha * transmittance;
      transmittance *= 1 - alpha;
      optical += depth;
    }
    const coverage = 1 - transmittance;
    heights[y * size + x] = coverage > 0.01 ? visibleHeight / coverage : -0.4;
    data[(y * size + x) * 4 + 2] = Math.round(Math.min(1, optical / 4) * 255);
    data[(y * size + x) * 4 + 3] = Math.round(coverage * 255);
  }
  const height = (x: number, y: number) => heights[
    Math.min(size - 1, Math.max(0, y)) * size + Math.min(size - 1, Math.max(0, x))
  ]!;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    // Broad derivatives, not shiny high-frequency marble normals.
    const dx = (height(x + 2, y) - height(x - 2, y)) * size / 8;
    const dy = (height(x, y + 2) - height(x, y - 2)) * size / 8;
    const length = Math.hypot(dx, dy, 1.6);
    const offset = (y * size + x) * 4;
    data[offset] = Math.round((-dx / length * 0.5 + 0.5) * 255);
    data[offset + 1] = Math.round((-dy / length * 0.5 + 0.5) * 255);
  }
  const texture = new THREE.DataTexture(data, size, size);
  texture.name = `upper-cloud-volume-impostor-${seed}`;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
};

/** Tiny seamless 3D noise lattice for the continuous far storm, not ray marching. */
export const createCloudNoiseTexture = (size = 32): THREE.Data3DTexture => {
  if (!Number.isInteger(size) || size < 2 || size > 128) throw new Error('Invalid storm noise size');
  const data = new Uint8Array(size ** 3);
  for (let z = 0; z < size; z++) for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    data[(z * size + y) * size + x] = Math.round(hash(x, y, z, 0x45c10d) * 255);
  }
  const texture = new THREE.Data3DTexture(data, size, size, size);
  texture.name = 'upper-storm-seamless-noise';
  texture.format = THREE.RedFormat;
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.wrapS = texture.wrapT = texture.wrapR = THREE.RepeatWrapping;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  return texture;
};
