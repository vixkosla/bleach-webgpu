import { Renderer, StandardNodeLibrary, WebGPUBackend, type WebGPURendererParameters } from 'three/webgpu';

/** Three's standard node renderer, with only a WebGPU backend available. */
export class WebGPUOnlyRenderer extends Renderer {
  override library = new StandardNodeLibrary();
  readonly isWebGPURenderer = true;

  constructor(parameters: Omit<WebGPURendererParameters, 'forceWebGL' | 'getFallback'>) {
    // WebGPURenderer installs an automatic WebGL2 fallback. Build the same
    // renderer from Three's exports so initialization fails instead.
    super(new WebGPUBackend(parameters), { ...parameters, getFallback: null });
  }
}

export const hasWebGPUDevice = (renderer: Renderer): boolean => {
  const backend = renderer.backend;
  return backend instanceof WebGPUBackend && backend.isWebGPUBackend === true
    && typeof GPUDevice !== 'undefined'
    && 'device' in backend && backend.device instanceof GPUDevice;
};
