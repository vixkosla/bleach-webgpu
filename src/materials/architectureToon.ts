import * as THREE from 'three/webgpu';
import { mix, nodeObject, uniform, vec4 } from 'three/tsl';
import { denoise } from 'three/addons/tsl/display/DenoiseNode.js';

/** Consolidate tiny lit facets into painted planes before the existing grade.
 * Depth and normals keep separate buildings, recesses and silhouettes apart.
 * This is a normalized colour average, with no new palette or light curve. */
export const createArchitectureToon = (
  sceneColor: THREE.TextureNode,
  depth: THREE.TextureNode,
  normal: THREE.TextureNode,
  contactAo: THREE.TextureNode,
  camera: THREE.PerspectiveCamera,
) => {
  const strength = uniform(0.86);
  const surfacePass = denoise(sceneColor, depth, normal, camera);
  surfacePass.radius.value = 3.5;
  surfacePass.depthPhi.value = 2.5;
  surfacePass.normalPhi.value = 2;
  // Keep the small value boundaries in worn stone and mineral deposits.
  // Broad light/AO still softens, but a near-unconditional colour average
  // erased the albedo texture even when its world-space surface was detailed.
  surfacePass.lumaPhi.value = 0.035;
  const contactPass = denoise(contactAo, depth, normal, camera);
  contactPass.radius.value = 3;
  contactPass.depthPhi.value = 4;
  contactPass.normalPhi.value = 4;
  const surface = nodeObject(surfacePass) as unknown as ReturnType<typeof vec4>;
  const contact = nodeObject(contactPass) as unknown as ReturnType<typeof vec4>;
  return {
    color: mix(sceneColor.rgb, surface.rgb, strength),
    contact: mix(contactAo.r, contact.r, strength),
    controls: { strength, radius: surfacePass.radius, depth: surfacePass.depthPhi },
    surfacePass,
    contactPass,
  };
};
