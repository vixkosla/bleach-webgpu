// Run: node --experimental-transform-types scripts/audit-upper.mjs
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import * as THREE from 'three/webgpu';

// Match the extensionless TS imports resolved by Vite, without emitting files.
const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.') && context.parentURL?.includes('/src/') && !/\.[a-z]+$/i.test(specifier)) {
    return nextResolve(`${specifier}.ts`, context);
  }
  return nextResolve(specifier, context);
} });
const { createUpperEvent, createUpperLayout, sampleUpperEvent } = await import('../src/scene/upperEvent.ts');
const { createUpperInspectionPreset, UPPER_SHOT_PRESETS } = await import('../src/cinematic/upperInspection.ts');
const { createRoundedCrescentGeometry } = await import('../src/scene/upperCrescent.ts');
const { createCloudTexture, createCloudNoiseTexture } = await import('../src/scene/cloudTexture.ts');
const { createStormVolumeTexture } = await import('../src/scene/upperCloudVolume.ts');
const volumeTexture = createStormVolumeTexture(16);
for (let z = 0; z < 16; z++) for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
  if ([x, y, z].some(v => v === 0 || v === 15)) {
    assert.equal(volumeTexture.image.data[((z * 16 + y) * 16 + x) * 2], 0,
      'volume density must vanish on all six box faces');
  }
}
assert(volumeTexture.image.data.some((v, i) => i % 2 === 0 && v > 40), 'cloud volume has real density');
volumeTexture.dispose();
const noise = createCloudNoiseTexture();
assert.equal(noise.image.data.length, 32 ** 3, 'far storm costs only a 32KB lattice');
assert.equal(noise.wrapR, THREE.RepeatWrapping);
noise.dispose();
const atlas = createCloudTexture(17, 64);
const sameAtlas = createCloudTexture(17, 64);
const otherAtlas = createCloudTexture(18, 64);
assert.deepEqual(atlas.image.data, sameAtlas.image.data, 'cloud density is seeded, not random per frame');
assert.notDeepEqual(atlas.image.data, otherAtlas.image.data);
for (let offset = 0; offset < atlas.image.data.length; offset += 4) {
  const [r, g, depth, coverage] = atlas.image.data.slice(offset, offset + 4);
  assert((r / 255 * 2 - 1) ** 2 + (g / 255 * 2 - 1) ** 2 <= 1.02, 'valid tangent normal');
  if (depth < 254) assert(Math.abs((1 - Math.exp(-depth / 255 * 4)) * 255 - coverage) < 3,
    'coverage follows integrated optical thickness, not a flat radial mask');
}
const alpha = [...atlas.image.data].filter((_, index) => index % 4 === 3);
assert(alpha.some(value => value > 70) && alpha.some(value => value === 0), 'clouds need density and gaps');
assert(new Set(alpha).size > 50, 'cloud coverage must not be a binary cutout');
for (let i = 0; i < 64; i++) {
  for (const pixel of [i, 63 * 64 + i, i * 64, i * 64 + 63]) assert.equal(atlas.image.data[pixel * 4 + 3], 0);
}
for (const value of [atlas, sameAtlas, otherAtlas]) value.dispose();
const crown = new THREE.Vector3(-7.2, 432, -130.4);
const layout = createUpperLayout(crown);
assert(layout.center.y - layout.radius > crown.y + 40, 'crescent must clear the scaled crown');
assert.deepEqual(layout.crown, crown);
assert.equal(layout.center.z, crown.z);
const shifted = createUpperLayout(crown.clone().add(new THREE.Vector3(0, 50, 0)));
assert.equal(shifted.center.y - layout.center.y, 50, 'layout follows real crown height');
for (const settings of Object.values(UPPER_SHOT_PRESETS)) for (const aspect of [2560 / 1268, 16 / 9, 1, 390 / 844]) {
  const preset = createUpperInspectionPreset(layout, aspect, settings);
  const camera = new THREE.PerspectiveCamera(preset.fov, aspect, 0.12, 4200);
  camera.position.fromArray(preset.position);
  camera.lookAt(...preset.target);
  camera.updateMatrixWorld(true);
  assert.equal(preset.position[1], crown.y + settings.height, 'final camera follows the saved low citadel view');
  assert(preset.target[1] > preset.position[1], 'look up toward the moon from the citadel');
  const centre = layout.center.clone().project(camera);
  assert(Math.abs(centre.y - (1 - settings.frameY * 2)) < 0.001, 'moon centre follows the selected frame position');
  const crownInFrame = crown.clone().project(camera);
  assert(crownInFrame.y < centre.y && crownInFrame.y > -1, 'citadel crown is visible below the event');
  // The black core must fit, but outer storm clouds deliberately reach beyond
  // the frame instead of fitting a small isolated diagram in empty space.
  const geometry = createRoundedCrescentGeometry();
  const vertices = geometry.getAttribute('position');
  for (let i = 0; i < vertices.count; i++) {
    const point = new THREE.Vector3().fromBufferAttribute(vertices, i).multiplyScalar(layout.radius).add(layout.center).project(camera);
    assert(Math.abs(point.x) < 0.95 && Math.abs(point.y) < 0.95 && point.z < 1, `event clipped at FOV ${settings.fov}, aspect ${aspect}`);
  }
  geometry.dispose();
}
for (const time of [NaN, Infinity, -1, 0, 11.5, 13.8, 15.15, 15.65, 17.8, 21.8, 26, 100]) {
  const sample = sampleUpperEvent(time);
  for (const [name, value] of Object.entries(sample)) {
    if (typeof value === 'number') assert(Number.isFinite(value), `${name} must be finite`);
  }
  for (const name of ['birth', 'charge', 'shock', 'opening', 'scale', 'cloud']) {
    assert(sample[name] >= 0 && sample[name] <= 1, `${name} out of bounds at ${time}`);
  }
}
assert.equal(sampleUpperEvent(11.5).visible, false);
assert(sampleUpperEvent(13.8).charge > 0.5);
assert.equal(sampleUpperEvent(13.8).birth, 0);
assert.equal(sampleUpperEvent(21.8).birth, 1);
assert.equal(sampleUpperEvent(26).charge, 0);

const stage = createUpperEvent(crown);
const crescentMaterial = stage.group.getObjectByName('upper-black-crescent').material;
const originalSurfaceGraph = crescentMaterial.colorNode;
assert.equal(stage.group.parent, stage.scene, 'own scene, never city AO MRT');
assert(stage.materials.length < 10, 'cloud volumes should not multiply material count');
assert.equal(stage.materials.filter(value => value.userData.upperBackground).length, 1);
const cloudBounds = new THREE.Box3().setFromObject(stage.clouds.volume.mesh).getSize(new THREE.Vector3());
assert(Math.min(cloudBounds.x, cloudBounds.y, cloudBounds.z) > layout.radius,
  'near cloud density occupies a real world-space volume');
const moonGeometry = stage.group.getObjectByName('upper-black-crescent').geometry;
const moonSize = moonGeometry.boundingBox.getSize(new THREE.Vector3());
assert(moonSize.z > 0.50, 'heavier crescent must have visible additional depth from the side');
assert(Math.abs(moonSize.y - 2) < 0.02, 'added mass preserves the outer diameter and crown clearance');
let signedMoonVolume = 0;
const mp = moonGeometry.getAttribute('position'), mi = moonGeometry.index;
const ma = new THREE.Vector3(), mb = new THREE.Vector3(), mc = new THREE.Vector3();
for (let i = 0; i < mi.count; i += 3) {
  ma.fromBufferAttribute(mp, mi.getX(i)); mb.fromBufferAttribute(mp, mi.getX(i + 1));
  mc.fromBufferAttribute(mp, mi.getX(i + 2)); signedMoonVolume += ma.dot(mb.cross(mc)) / 6;
}
assert(signedMoonVolume > 0.30, 'closed heavier crescent needs outward winding and added solid volume');
let triangles = 0;
stage.group.traverse(object => {
  if (!object.isMesh) return;
  const positions = object.geometry.getAttribute('position');
  assert([...positions.array].every(Number.isFinite));
  triangles += (object.geometry.index?.count ?? positions.count) / 3;
  assert.equal(object.castShadow, false);
  assert.equal(object.material.fog, false);
});
assert(triangles < 10000, `unexpected upper geometry cost: ${triangles}`);
const snapshot = (time, motionTime = time) => {
  stage.update(time, motionTime);
  assert.equal(crescentMaterial.colorNode, originalSurfaceGraph,
    'animation updates uniforms; rebuilding the surface graph per frame leaks GPU programs');
  assert.equal(stage.clouds.motionTime.value, motionTime);
  stage.scene.updateMatrixWorld(true);
  const objects = [];
  stage.group.traverse(object => objects.push({ name: object.name, matrix: [...object.matrixWorld.elements],
    visible: object.visible, opacity: object.material?.opacity }));
  return { objects, backgroundMotion: stage.clouds.backgroundMotionTime.value };
};
for (const time of [13.8, 15.65, 17.8, 21.8, 26]) {
  const direct = snapshot(time);
  snapshot(26); snapshot(0); snapshot(15.15);
  assert.deepEqual(snapshot(time), direct, `reverse seek must reproduce ${time}`);
  assert.deepEqual(snapshot(time), direct, `pause must hold ${time}`);
}
const livingHold = snapshot(21.8, 10);
const heldPhase = { ...stage.state };
const nextHold = snapshot(21.8, 11);
assert.notDeepEqual(nextHold, livingHold, 'cloud motion must continue during HOLD');
assert.deepEqual(nextHold.objects, livingHold.objects, 'material animation must not tip the moon away from the citadel');
assert.deepEqual(stage.state, heldPhase, 'motion must not advance the selected event phase');
assert.deepEqual(snapshot(21.8, 10), livingHold, 'explicit motion time remains reproducible for QA');
assert.equal(stage.motionTime, 10);
const farStart = stage.clouds.backgroundMotionTime.value;
snapshot(21.8, 20);
const farElapsed = stage.clouds.backgroundMotionTime.value - farStart;
assert(farElapsed > 0 && farElapsed < 10, 'distant sky moves more slowly than near clouds during HOLD');
assert.deepEqual(snapshot(21.8, 10), livingHold, 'reverse seek restores distant weather as well as the moon');
stage.update(0);
assert.equal(stage.group.visible, false, 'rewind hides all event geometry');
assert.equal(stage.clouds.volume.mesh.visible, false, 'rewind hides the separate cloud volume too');
stage.dispose();
assert.equal(stage.scene.children.length, 0);
assert.equal(stage.clouds.root.children.length, 0);
hooks.deregister();
console.log(JSON.stringify({ passed: true, triangles, materials: stage.materials.length,
  signedMoonVolume, moonDepth: moonSize.z, deterministic: true, crownClearance: 48 }));
