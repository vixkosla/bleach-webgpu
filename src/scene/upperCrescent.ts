import * as THREE from 'three/webgpu';

/** Closed, rounded crescent: an elliptical sweep tapering into two tips. */
export const createRoundedCrescentGeometry = (padding = 0): THREE.BufferGeometry => {
  if (!Number.isFinite(padding) || padding < 0 || padding > 0.1) throw new Error('Invalid crescent padding');
  const arcs = 128, sides = 24;
  const positions: number[] = [], indices: number[] = [];
  const start = -Math.PI + 0.13, sweep = Math.PI * 2 - 0.26;
  positions.push(Math.cos(start), Math.sin(start), 0);
  for (let i = 1; i < arcs; i++) {
    const t = i / arcs, angle = start + t * sweep;
    const weight = (Math.cos(angle) + 1) * 0.5;
    const taper = Math.sin(Math.PI * t) ** 0.55;
    // Add mass inward and through depth while retaining the outer radius/tips.
    const width = (0.025 + weight * 0.43) * taper;
    const bodyRadial = width * 0.5;
    // Expand the swept cross sections while retaining the exact centerline.
    // Unlike normal displacement, this cannot fold over the very thin tips.
    const radial = bodyRadial + padding * taper;
    const depth = bodyRadial * 1.18 + padding * taper;
    const center = 1 - bodyRadial;
    for (let j = 0; j <= sides; j++) {
      const cross = j / sides * Math.PI * 2;
      const radius = center + Math.cos(cross) * radial;
      positions.push(Math.cos(angle) * radius, Math.sin(angle) * radius, Math.sin(cross) * depth);
    }
  }
  const endTip = positions.length / 3;
  positions.push(Math.cos(start + sweep), Math.sin(start + sweep), 0);
  for (let j = 0; j < sides; j++) indices.push(0, 1 + j, 2 + j);
  for (let i = 0; i < arcs - 2; i++) for (let j = 0; j < sides; j++) {
    const a = 1 + i * (sides + 1) + j, b = a + sides + 1;
    indices.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const last = 1 + (arcs - 2) * (sides + 1);
  for (let j = 0; j < sides; j++) indices.push(last + j, endTip, last + j + 1);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  // The UV-style duplicate at each ring seam must share its smooth normal.
  const normal = geometry.getAttribute('normal');
  const seam = new THREE.Vector3(), other = new THREE.Vector3();
  for (let i = 0; i < arcs - 1; i++) {
    const a = 1 + i * (sides + 1), b = a + sides;
    seam.fromBufferAttribute(normal, a).add(other.fromBufferAttribute(normal, b)).normalize();
    normal.setXYZ(a, seam.x, seam.y, seam.z); normal.setXYZ(b, seam.x, seam.y, seam.z);
  }
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  geometry.name = padding > 0 ? 'rounded-crescent-halo-shell' : 'rounded-solid-crescent';
  return geometry;
};
