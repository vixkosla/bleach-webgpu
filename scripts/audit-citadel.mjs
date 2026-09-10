import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import { addCitadelGeometry, CITADEL_TIERS, CITADEL_WORLD_SCALE } from '../src/scene/citadelGeometry.ts';

const tower = new THREE.Group();
addCitadelGeometry(tower, new THREE.MeshBasicMaterial(), new THREE.LineBasicMaterial(), 72);
tower.updateMatrixWorld(true);
const meshes = [], tierBounds = [];
let triangles = 0;
tower.traverse(o => {
  assert(!o.name.includes('oculus'), 'video player overlay must not become architecture');
  if (!o.isMesh) return;
  meshes.push(o);
  for (const v of o.geometry.attributes.position.array) assert(Number.isFinite(v));
  triangles += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3 * (o.count ?? 1);
  if (o.userData.citadelCoatingSurface && !o.name.includes('gate')) {
    tierBounds.push(new THREE.Box3().setFromObject(o));
  }
});
// Physical connectivity of the major mass, including upper setbacks.
const reached = new Set([0]);
for (let changed = true; changed;) {
  changed = false;
  for (let i = 0; i < tierBounds.length; i++) {
    if (!reached.has(i) && [...reached].some(j => tierBounds[i].intersectsBox(tierBounds[j]))) {
      reached.add(i); changed = true;
    }
  }
}
assert.equal(reached.size, tierBounds.length, 'detached citadel tier');

const arch = tower.getObjectByName('citadel-sky-arch-fill');
const ray = new THREE.Raycaster();
for (const side of [-1, 1]) {
  ray.set(new THREE.Vector3(-12, 72 + 213, side * 200), new THREE.Vector3(0, 0, -side));
  assert.equal(ray.intersectObjects(meshes, false).length, 0, 'sky must pass through the crown arch');
  ray.set(new THREE.Vector3(-12, 72 + 220, side * 200), new THREE.Vector3(0, 0, -side));
  assert(ray.intersectObject(arch).length > 0, 'arch must have solid front and back');
}
// The entrance actually recedes behind the front facade, rather than a black
// plane painted onto its surface. Neighbouring piers must block the same ray.
const gateRay = x => {
  ray.set(new THREE.Vector3(x, 72 + 40, 150), new THREE.Vector3(0, 0, -1));
  return ray.intersectObjects(meshes, false)[0].point.z;
};
const pierBounds = new THREE.Box3().setFromObject(tower.getObjectByName('citadel-gate-pier-1-fill'));
const pierX = (pierBounds.min.x + pierBounds.max.x) * 0.5;
assert(gateRay(0) < pierBounds.min.z - 10, 'portal void must recede well behind the portico piers');
assert(gateRay(pierX) >= pierBounds.max.z - 0.1, 'entrance pier is missing');
// The stepped reveal arch sits inside the void, not across the passage.
ray.set(new THREE.Vector3(0, 72 + 20, 150), new THREE.Vector3(0, 0, -1));
assert(ray.intersectObjects(meshes, false)[0].point.z < pierBounds.min.z - 10, 'passage must stay open at walking height');
// Both ends of the recessed arch must bear on masonry all the way to the
// threshold, without the new supports filling the open middle of the gate.
for (const side of [-1, 1]) {
  for (const height of [6, 22, 40]) {
    ray.set(new THREE.Vector3(side * 10.5, 72 + height, 150), new THREE.Vector3(0, 0, -1));
    const hit = ray.intersectObjects(meshes, false)[0];
    assert(hit && Math.abs(hit.point.z - 96) < 0.01, 'recessed arch support must reach the threshold');
  }
}
// Trace the actual first floor surface from the avenue into the portico.
// This catches buried treads, gaps at the landing, and an impassable riser.
const approach = [], avenueTop = 6.06 / CITADEL_WORLD_SCALE[1];
for (let z = 132; z >= 94.1; z -= 0.1) {
  ray.set(new THREE.Vector3(0, 72 + 6, z), new THREE.Vector3(0, -1, 0));
  const hit = ray.intersectObjects(meshes, false)[0];
  approach.push(Math.max(avenueTop, hit ? hit.point.y - 72 : 0));
}
for (let i = 1; i < approach.length; i++) {
  const rise = approach[i] - approach[i - 1];
  assert(rise >= -0.001 && rise <= 0.421, 'approach must rise continuously from the raised avenue in shallow steps');
}
assert.equal(new Set(approach.map(y => y.toFixed(3))).size, 4, 'approach must connect the upper avenue to the sill through three risers');
assert(Math.abs(approach.at(-1) - 5) < 0.001, 'landing must meet the existing foundation at sill height');
const bounds = new THREE.Box3().setFromObject(tower);
assert(bounds.min.y >= 71.99 && bounds.max.y <= 72 + 223, 'foundation/height drift');
assert(triangles < 45000, 'stone details exceeded the geometry budget');
const displayedSize = bounds.getSize(new THREE.Vector3()).multiply(new THREE.Vector3(...CITADEL_WORLD_SCALE));
// Latest user correction removes the third outer ring: preserve a tall tower
// with attached shoulders instead of restoring the superseded broad fortress.
assert(displayedSize.x > displayedSize.y * 0.6 && displayedSize.x < displayedSize.y * 0.8,
  'citadel must retain the revised slender tower proportions');
assert(displayedSize.z > displayedSize.y * 0.6, 'side view must retain fortress depth');
assert(CITADEL_TIERS.filter(t => Math.abs(t.x) >= 60 && t.bottom <= 12 && t.top >= 100).length >= 2,
  'tall shoulders must rise as independent attached keeps from the lower foundation');
assert.deepEqual(tower.userData.upperEventAnchor, [-8, 294, -10]);
console.log(JSON.stringify({ tiersConnected: reached.size, triangles, bounds, crownArchOpen: true, gateRecessOpen: true, gateSupportsGrounded: true, approachRisers: 3 }));
