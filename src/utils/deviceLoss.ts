import type { WebGPURenderer } from 'three/webgpu';

export type GpuFailure = 'lost' | 'memory' | 'render';

/** Stop false GOOD/FPS reporting on device loss AND uncaptured GPU failures. */
export const watchDeviceLoss = (
  renderer: Pick<WebGPURenderer, 'onDeviceLost' | 'setAnimationLoop'>
    & Partial<Pick<WebGPURenderer, 'onError'>>,
  onFailure: (reason: GpuFailure) => void,
) => {
  const defaultLost = renderer.onDeviceLost.bind(renderer);
  const defaultError = renderer.onError?.bind(renderer);
  let failed = false;
  const fail = (reason: GpuFailure) => {
    if (failed) return;
    failed = true;
    void renderer.setAnimationLoop(null);
    onFailure(reason);
  };
  renderer.onDeviceLost = info => {
    defaultLost(info); // Three must still set its own lost-device flag.
    fail('lost');
  };
  renderer.onError = error => {
    defaultError?.(error);
    // Three r185's runtime passes { api, type, message }, though its current
    // declarations still say string. Handle both without trusting the shape.
    const info: unknown = error;
    const text = typeof info === 'string' ? info
      : info && typeof info === 'object'
        ? `${'type' in info ? info.type : ''} ${'message' in info ? info.message : ''}` : '';
    fail(/out.?of.?memory|VK_ERROR_OUT_OF_DEVICE_MEMORY/i.test(text) ? 'memory' : 'render');
  };
  // Recovery is explicit, never an automatic device/reload loop.
  return { get failed() { return failed; } };
};
