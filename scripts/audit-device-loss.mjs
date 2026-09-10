// CPU-only: node --experimental-strip-types scripts/audit-device-loss.mjs
import assert from 'node:assert/strict';
import { watchDeviceLoss } from '../src/utils/deviceLoss.ts';
import { chooseRenderPixelRatio, MAX_RENDER_PIXELS } from '../src/utils/renderBudget.ts';

for (const [method, error, expected] of [
  ['onDeviceLost', { api: 'WebGPU', reason: 'unknown' }, 'lost'],
  ['onError', { type: 'GPUOutOfMemoryError', message: 'vkAllocateMemory failed' }, 'memory'],
  ['onError', 'VK_ERROR_OUT_OF_DEVICE_MEMORY', 'memory'],
  ['onError', { type: 'GPUValidationError', message: 'invalid bind group' }, 'render'],
]) {
  const reasons = [];
  let stops = 0;
  const renderer = {
    lostFlag: false, errors: 0,
    onDeviceLost() { this.lostFlag = true; },
    onError() { this.errors++; },
    async setAnimationLoop(callback) { assert.equal(callback, null); stops++; },
  };
  const status = watchDeviceLoss(renderer, reason => reasons.push(reason));
  assert.equal(status.failed, false);
  renderer[method](error);
  renderer[method](error);
  assert.equal(status.failed, true);
  assert.equal(renderer.lostFlag, method === 'onDeviceLost', 'preserve default this binding');
  assert.equal(renderer.errors, method === 'onError' ? 2 : 0);
  assert.deepEqual(reasons, [expected], 'one recovery prompt, no reload loop');
  assert.equal(stops, 1, 'stop the misleading live FPS loop');
}
for (const [width, height, dpr, mobile] of [
  [1280, 720, 1, false], [2560, 1268, 1, false], [3840, 2160, 2, false],
  [390, 844, 3, true], [1600, 900, 2, false],
]) {
  const ratio = chooseRenderPixelRatio(width, height, dpr, mobile);
  assert(ratio > 0 && ratio <= dpr && ratio <= (mobile ? 1.2 : 1.6));
  assert(width * height * ratio ** 2 <= MAX_RENDER_PIXELS + 0.01, 'MRT pixel budget exceeded');
}
assert.equal(chooseRenderPixelRatio(1280, 720, 1, false), 1);
assert.equal(chooseRenderPixelRatio(390, 844, 3, true), 1.2);
assert(Number.isFinite(chooseRenderPixelRatio(NaN, 0, Infinity, false)));
console.log('GPU failure handling + render budget passed (CPU mocks; no browser/device touched).');
