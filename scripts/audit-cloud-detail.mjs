import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import * as THREE from 'three/webgpu';
const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) return nextResolve(`${specifier}.ts`, context);
  return nextResolve(specifier, context);
} });
const { createUpperEvent } = await import('../src/scene/upperEvent.ts');
const { createCloudDetailTexture } = await import('../src/scene/cloudDetailTexture.ts');
const { createCoronalTransmissionTexture } = await import('../src/scene/upperCloudVolume.ts');
const { crescentShaftSource, CRESCENT_SHAFT_ANGLE } = await import('../src/scene/crescentLight.ts');
// Separate openings must preserve the SAME ray direction and trace back to
// the actual rim on both sides. This catches the former radial-petal rule.
const axis = new THREE.Vector2(Math.cos(CRESCENT_SHAFT_ANGLE), Math.sin(CRESCENT_SHAFT_ANGLE));
const transverse = new THREE.Vector2(-axis.y, axis.x);
for (const across of [-0.9, -0.4, 0.2, 0.7]) for (const along of [-3, -1.5, 1.5, 3]) {
  const point = axis.clone().multiplyScalar(along).addScaledVector(transverse, across);
  const source = crescentShaftSource(point.x, point.y);
  assert(source.valid && source.travel > 0);
  assert(Math.abs(Math.hypot(source.x, source.y) - 1) < 1e-12, 'source lies on the circular outer edge');
  const delta = point.clone().sub(new THREE.Vector2(source.x, source.y));
  assert(Math.abs(delta.dot(transverse)) < 1e-12, 'source-to-gas path is parallel to the shared direction');
}
// Gas on the path must attenuate the light monotonically. In an empty volume
// every ray remains unoccluded; this exercises the baked optical integration.
const transmittance = [];
for (const density of [0, 100, 255]) {
  const grid = new THREE.Data3DTexture(new Uint8Array(8 ** 3 * 2).fill(density), 8, 8, 8);
  const visibility = createCoronalTransmissionTexture(grid, 8);
  if (density === 0) assert(visibility.image.data.every(v => v === 255));
  transmittance.push(visibility.image.data.reduce((a, b) => a + b, 0));
  visibility.dispose(); grid.dispose();
}
assert(transmittance[0] > transmittance[1] && transmittance[1] > transmittance[2]);
const started = performance.now();
const citadelOrientation = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, -0.3, 0.1));
const stage = createUpperEvent(new THREE.Vector3(-7.2, 431.64, -130.4), citadelOrientation);
const constructionMs = performance.now() - started;
const texture = stage.clouds.volume.detailTexture;
assert.equal(texture.image.data.byteLength, 64 ** 3 * 2);
for (const axis of ['wrapS', 'wrapT', 'wrapR']) assert.equal(texture[axis], THREE.RepeatWrapping);
const a = createCloudDetailTexture(8), b = createCloudDetailTexture(8);
assert.deepEqual(a.image.data, b.image.data);
assert(new Set(texture.image.data).size > 180, 'detail must contain continuous density transitions');
a.dispose(); b.dispose();
const solid = stage.group.getObjectByName('upper-black-crescent');
const halo = stage.halo.mesh;
assert.equal(halo.geometry.attributes.position.count, solid.geometry.attributes.position.count, 'shared crescent sweep topology');
assert.equal(halo.material.side, THREE.BackSide);
assert.equal(solid.material.depthWrite, true);
assert.equal(halo.material.depthWrite, false);
assert.notEqual(stage.halo.scene, stage.scene, 'halo has a separate target for silhouette masking');
for (const t of [0, 13.8, 15.65, 17.8, 21.8, 26]) for (const motion of [0, 4, 21.8, 59]) {
  stage.update(t, motion);
  assert.deepEqual(halo.quaternion.toArray(), solid.quaternion.toArray());
  assert.equal(halo.material.opacity, solid.material.opacity);
  stage.scene.updateMatrixWorld(true); stage.halo.scene.updateMatrixWorld(true);
  assert.deepEqual(halo.matrixWorld.elements, solid.matrixWorld.elements,
    'both 3D forms must coincide throughout animation and seek');
  assert.equal(halo.parent.visible, stage.group.visible);
  assert.equal(stage.clouds.volume.controls.sourceScale.value, stage.state.scale);
  const moonUp = new THREE.Vector3(0, 1, 0).transformDirection(solid.matrixWorld);
  assert(moonUp.distanceTo(new THREE.Vector3(0, 1, 0).applyQuaternion(citadelOrientation)) < 1e-12,
    'moon follows the actual citadel axis through phase changes and motion');
  const point = new THREE.Vector3(0.6, 0.8, 0).applyMatrix4(solid.matrixWorld)
    .sub(stage.layout.center).divideScalar(stage.layout.radius)
    .applyQuaternion(stage.clouds.volume.mesh.quaternion.clone().invert())
    .applyMatrix3(stage.clouds.volume.sourceFrame.value);
  assert(point.distanceTo(new THREE.Vector3(0.6, 0.8, 0).multiplyScalar(stage.state.scale)) < 1e-12,
    'cloud-to-source coordinates must land on the actual upright luminous rim');
}
// Trace the actual expanded sweep from front, back and both sides.
// Concave near/far lobe overlap explains why GPU solid-depth masking is needed;
// the hardware review separately checks the masked halo's actual pixels.
const shell = new THREE.Mesh(halo.geometry, new THREE.MeshBasicMaterial({ side: THREE.BackSide }));
const body = new THREE.Mesh(solid.geometry, new THREE.MeshBasicMaterial());
shell.updateMatrixWorld(true); body.updateMatrixWorld(true);
const ray = new THREE.Raycaster();
const views = [];
for (const angle of [0, Math.PI / 2, Math.PI, Math.PI * 1.5, Math.PI / 4]) {
  const camera = new THREE.OrthographicCamera(-1.15, 1.15, 1.15, -1.15, 0.01, 10);
  camera.position.set(Math.sin(angle) * 4, 0.6, Math.cos(angle) * 4);
  camera.lookAt(0, 0, 0); camera.updateMatrixWorld(true);
  let dark = 0, luminous = 0, overlap = 0;
  for (let y = -32; y <= 32; y++) for (let x = -32; x <= 32; x++) {
    ray.setFromCamera(new THREE.Vector2(x / 32, y / 32), camera);
    const s = ray.intersectObject(body)[0], h = ray.intersectObject(shell)[0];
    if (s && h) { if (s.distance >= h.distance + 1e-7) { overlap++; } dark++; }
    if (!s && h) luminous++;
  }
  assert(dark > 20 && luminous > 5, 'solid and luminous silhouette must survive this orbit angle');
  views.push({ angle, dark, luminous, overlap });
}
shell.material.dispose(); body.material.dispose();
const haloMaterial = halo.material, detailTexture = texture;
let haloGeometryDisposed = false, haloMaterialDisposed = false, detailDisposed = false;
halo.geometry.addEventListener('dispose', () => { haloGeometryDisposed = true; });
haloMaterial.addEventListener('dispose', () => { haloMaterialDisposed = true; });
detailTexture.addEventListener('dispose', () => { detailDisposed = true; });
stage.dispose();
assert(haloGeometryDisposed && haloMaterialDisposed && detailDisposed);
assert.equal(stage.halo.scene.children.length, 0);
hooks.deregister();
console.log(JSON.stringify({ passed: true, constructionMs, detailBytes: texture.image.data.byteLength, views }));
