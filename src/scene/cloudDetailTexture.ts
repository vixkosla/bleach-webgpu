import * as THREE from 'three/webgpu';

/** Periodic 3D billows and creases, shared by all cloud samples (512 KiB). */
export const createCloudDetailTexture = (size = 64): THREE.Data3DTexture => {
  if (!Number.isInteger(size) || size < 8 || size > 128) throw new Error('Invalid cloud detail size');
  const cells = 8;
  const hash = (x: number, y: number, z: number, seed: number) => {
    let h = Math.imul((x + cells) % cells, 374761393)
      ^ Math.imul((y + cells) % cells, 668265263)
      ^ Math.imul((z + cells) % cells, 1442695041) ^ seed;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  };
  const points: THREE.Vector3[] = [];
  for (let z = 0; z < cells; z++) for (let y = 0; y < cells; y++) for (let x = 0; x < cells; x++) {
    points.push(new THREE.Vector3(hash(x, y, z, 71), hash(x, y, z, 113), hash(x, y, z, 199)));
  }
  const data = new Uint8Array(size ** 3 * 2);
  for (let z = 0; z < size; z++) for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const px = (x + 0.5) / size * cells, py = (y + 0.5) / size * cells, pz = (z + 0.5) / size * cells;
    const ix = Math.floor(px), iy = Math.floor(py), iz = Math.floor(pz);
    let nearest = 10, second = 10;
    for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = ix + dx, yy = iy + dy, zz = iz + dz;
      const point = points[((zz + cells) % cells * cells + (yy + cells) % cells) * cells + (xx + cells) % cells]!;
      const distance = (xx + point.x - px) ** 2 + (yy + point.y - py) ** 2 + (zz + point.z - pz) ** 2;
      if (distance < nearest) { second = nearest; nearest = distance; }
      else if (distance < second) second = distance;
    }
    const index = ((z * size + y) * size + x) * 2;
    data[index] = Math.round(Math.max(0, 1 - Math.sqrt(nearest) * 0.8) * 255);
    data[index + 1] = Math.round(Math.min(1, (Math.sqrt(second) - Math.sqrt(nearest)) * 2) * 255);
  }
  const texture = new THREE.Data3DTexture(data, size, size, size);
  texture.name = 'upper-cloud-billows-and-creases';
  texture.format = THREE.RGFormat;
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.wrapS = texture.wrapT = texture.wrapR = THREE.RepeatWrapping;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  return texture;
};
