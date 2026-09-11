import * as THREE from 'three/webgpu';

const hash = (x: number, y: number, seed: number): number => {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ seed;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
};

const noise = (u: number, v: number, nx: number, ny: number, seed: number): number => {
  const x = u * nx, y = v * ny, ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const at = (dx: number, dy: number) => hash((ix + dx) % nx, (iy + dy) % ny, seed);
  const a = at(0, 0) * (1 - sx) + at(1, 0) * sx;
  const b = at(0, 1) * (1 - sx) + at(1, 1) * sx;
  return a * (1 - sy) + b * sy;
};

let sharedTexture: THREE.DataTexture | undefined;

/** Shared seamless stone masks, baked once. R: broad chalk variation;
 * G: elongated mineral erosion; B: pores; A: broken dry-brush edges.
 * All channels are data. Mipmaps filter the fine grain as the camera recedes;
 * world-space projection keeps one physical scale across instanced buildings. */
export const getStoneSurfaceTexture = (): THREE.DataTexture => {
  if (sharedTexture) return sharedTexture;
  const size = 512, data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = (x + .5) / size, v = (y + .5) / size;
    const wash = noise(u, v, 6, 6, 307) * .52 + noise(u, v, 13, 13, 503) * .27
      + noise(u, v, 29, 29, 701) * .14 + noise(u, v, 61, 61, 911) * .07;
    const erosion = noise(u, v, 17, 6, 1021) * .45 + noise(u, v, 41, 15, 1237) * .34
      + noise(u, v, 113, 59, 1613) * .21;
    const grain = noise(u, v, 128, 128, 1877) * .7 + hash(x, y, 2017) * .3;
    const chipped = noise(u, v, 53, 31, 2357) * .6 + noise(u, v, 127, 73, 2693) * .4;
    const index = (y * size + x) * 4;
    data[index] = Math.round(wash * 255);
    data[index + 1] = Math.round(erosion * 255);
    data[index + 2] = Math.round(grain * 255);
    data[index + 3] = Math.round(chipped * 255);
  }
  sharedTexture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  sharedTexture.name = 'wahr-welt-chalk-mineral-surface';
  sharedTexture.colorSpace = THREE.NoColorSpace;
  sharedTexture.wrapS = sharedTexture.wrapT = THREE.RepeatWrapping;
  sharedTexture.magFilter = THREE.LinearFilter;
  sharedTexture.minFilter = THREE.LinearMipmapLinearFilter;
  sharedTexture.generateMipmaps = true;
  sharedTexture.anisotropy = 4;
  sharedTexture.needsUpdate = true;
  return sharedTexture;
};
