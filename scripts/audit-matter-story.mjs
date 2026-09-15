import assert from 'node:assert/strict';
import * as T from 'three/webgpu';
import { MatterStoryState, writeMatterGrowth } from '../src/cinematic/MatterStoryState.ts';
import { CloudStoryState, CLOUD_STORY_CELLS } from '../src/cinematic/CloudStoryState.ts';
import { SceneStoryState } from '../src/cinematic/SceneStoryState.ts';
import { SceneAtmosphereDirector } from '../src/cinematic/SceneAtmosphereDirector.ts';
import { ScenePacing } from '../src/cinematic/ScenePacing.ts';
import { createUpperEvent } from '../src/scene/upperEvent.ts';
import { UPPER_ATMOSPHERE } from '../src/scene/upperAtmosphereLayout.ts';

const pose = new MatterStoryState(), neutral = { assembly: 1, cohesion: 1, compression: 0, release: 0, wake: 0 };
const sample = time => ({ ...pose.update(time) });
let previous = sample(0), maxStep = 0;
for (let i = 0; i <= 6600; i++) {
  const time = i / 100, current = sample(time);
  for (const [key, value] of Object.entries(current)) {
    assert(Number.isFinite(value) && value >= 0 && value <= 1, `${key} at ${time}`);
    maxStep = Math.max(maxStep, Math.abs(value - previous[key]));
  }
  if (time >= 36) assert.deepEqual(current, neutral, 'Later shots retain mature matter');
  previous = current;
}
assert(maxStep < .007, 'No temporal jumps between material states');
for (const t of [NaN, Infinity, -100, 0, 12, 12.5, 14, 16.5, 18, 20, 22, 24, 26, 66]) {
  const expected = sample(t); sample(35); sample(13.2); assert.deepEqual(sample(t), expected);
}
assert.equal(sample(13).assembly, 0);
assert(sample(16.5).compression > .9);
assert(sample(16.5).assembly > .05 && sample(16.5).assembly < .15);
assert(sample(22).assembly > .6 && sample(22).assembly < .8, 'Growth must continue during castle orbit');
assert(sample(26).cohesion < 1 && sample(26).release === 1);
assert(sample(30).wake === 1);

const upper = createUpperEvent(new T.Vector3(-7.2, 432, -130.4));
const grade = { controls: Object.fromEntries(['story', 'eventLight', 'lightReach', 'exposure'].map(k => [k, { value: 1 }])) };
const director = new SceneAtmosphereDirector(upper, grade, null), state = new SceneStoryState();
const originalScale = upper.matter.mesh.scale.clone(), originalPosition = upper.matter.mesh.position.clone();
const originalLayers = upper.clouds.layers.map(l => l.offset.value.toArray());
const uniforms = () => Object.fromEntries(Object.entries(upper.matter.story).map(([k, u]) => [k, u.value]));
for (const time of [0, 12.5, 14.5, 16.5, 19, 22, 26, 54, 16.5]) {
  director.update(state.update(time));
  assert.deepEqual(uniforms(), sample(time));
  assert.equal(upper.matter.material.opacity, 1, 'Formation must not be whole-volume opacity');
  assert.equal(upper.matter.controls.birth.value, 1, 'Do not use the legacy central scale/fade');
  const growth = new T.Vector3(); writeMatterGrowth(pose, growth);
  assert(upper.matter.mesh.scale.distanceTo(originalScale.clone().multiply(growth)) < 1e-9);
  const offset = UPPER_ATMOSPHERE.matter.offset;
  upper.matter.mesh.updateMatrixWorld(true);
  const root = new T.Vector3(-offset[0] / 3.8, (-1 - offset[1]) / 3.8, -offset[2] / 1.6)
    .applyMatrix4(upper.matter.mesh.matrixWorld);
  assert(root.distanceTo(upper.layout.center.clone().add(new T.Vector3(0, -upper.layout.radius, 0))) < 1e-9, 'Root stays attached');
  assert.equal(upper.matter.mesh.visible, time > 13);
  const expected = uniforms(); director.update(state, 120);
  assert.deepEqual(uniforms(), expected, 'HOLD motion does not replay the entire birth');
  assert(upper.matter.field && !upper.group.getObjectByName('upper-black-crescent').visible);
}
director.restore(); assert.deepEqual(uniforms(), neutral);
assert.deepEqual(upper.matter.mesh.scale.toArray(), originalScale.toArray());
assert.deepEqual(upper.matter.mesh.position.toArray(), originalPosition.toArray());
assert.deepEqual(upper.clouds.layers.map(l => l.offset.value.toArray()), originalLayers);
director.update(state.update(14.5)); upper.update(21.8, 10);
assert.deepEqual(uniforms(), neutral, 'Legacy inspection cannot inherit narrative deformation');
assert.equal(upper.matter.material.opacity, 1);
upper.dispose();
const clouds = new CloudStoryState();
for (let i = 0; i <= 6600; i++) {
  clouds.update(i / 100);
  for (const c of clouds.cells) assert(Object.values(c).every(v => Number.isFinite(v) && v >= 0 && v <= 1));
}
for (const spec of CLOUD_STORY_CELLS) {
  const i = CLOUD_STORY_CELLS.indexOf(spec);
  for (const t of [spec.start, spec.start + spec.period - .001, spec.start + spec.period]) {
    clouds.update(t); assert(clouds.cells[i].erosion > .999, 'Cycle resets only after spatial density is fully eroded');
  }
}
clouds.update(22); const cloudSample = structuredClone(clouds.cells);
clouds.update(66); clouds.update(14); clouds.update(22); assert.deepEqual(clouds.cells, cloudSample);
const pacing = new ScenePacing(); assert.equal(pacing.duration, 36);
console.log(JSON.stringify({ passed: true, samples: 6601, maxStep,
  first: sample(16.5), second: sample(22), neutral: sample(36), cloudCells: clouds.cells.length,
  filmWindow: [pacing.filmAt(13), pacing.filmAt(30)], deterministic: true, heldPhase: true, restore: true }, null, 2));
