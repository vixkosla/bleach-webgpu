import * as THREE from 'three/webgpu';
import { cameraFar, cameraNear, float, mix, pass, perspectiveDepthToViewZ, positionView, rtt, screenSize, screenUV, uniform, vec2, vec3, vec4 } from 'three/tsl';
import type PassNode from 'three/src/nodes/display/PassNode.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import type { UpperEventController } from '../scene/upperEvent';

/**
 * A separate transparent beauty pass, composited AFTER the architectural AO.
 * Solid effects sample the city's view-depth per fragment before blending.
 * The separate volume integrates only up to the closest city or moon surface.
 * Neither layer writes into the city's AO normals or crystal/window masks.
 */
export const createUpperEventComposite = (
  stage: UpperEventController,
  camera: THREE.PerspectiveCamera,
  worldPass: PassNode,
  background: ReturnType<typeof vec4>,
  cityHaze?: THREE.Node<'vec4'>,
) => {
  // Explicit SCREEN coordinates are essential here: a PassTexture's default
  // UV is the mesh's local UV inside a material (not the fullscreen-quad UV).
  const worldDepth = worldPass.getTextureNode('depth').sample(screenUV).r;
  const worldViewZ = perspectiveDepthToViewZ(worldDepth, cameraNear, cameraFar);
  for (const material of stage.materials) {
    // View-space Z is negative in front of the camera. Small tolerance is only
    // for surface precision, not permission to draw through architectural walls.
    material.maskNode = material.userData.upperBackground
      // Infinite storm belongs ONLY to empty sky, never over distant masonry.
      ? worldDepth.greaterThanEqual(1)
      : positionView.z.greaterThanEqual(worldViewZ.sub(0.02));
  }
  const layerPass = pass(stage.scene, camera);
  layerPass.name = 'Upper event / independent beauty';
  const layer = layerPass.getTextureNode('output');
  // Volumes stop at whichever is closer: the city or the rounded solid moon.
  // A box-backface depth test alone would wrongly hide front-facing cloud gas.
  const solidDepth = layerPass.getTextureNode('depth').sample(screenUV).r;
  stage.clouds.volume.setDepth(perspectiveDepthToViewZ(worldDepth.min(solidDepth), cameraNear, cameraFar));
  const volumePass = pass(stage.clouds.volume.scene, camera);
  volumePass.name = 'Upper storm / 3D density integration';
  volumePass.setResolutionScale(0.75);
  const volume = volumePass.getTextureNode('output');
  // The moon itself now lives inside this density integral. Only real
  // architecture stops the ray; no solid lunar surface cuts its folds apart.
  stage.matter.setDepth(worldViewZ);
  const matterPass = pass(stage.matter.scene, camera);
  matterPass.name = 'Lunar core and escaping matter / one density integral';
  matterPass.setResolutionScale(0.75);
  const matter = matterPass.getTextureNode('output');
  // Draw the larger 3D crescent in its own small scene. Reusing the solid
  // moon depth as a mask protects EVERY black silhouette pixel, including
  // overlapping near/far tips seen from the side of the concave crescent.
  stage.halo.mesh.material.maskNode = solidDepth.greaterThanEqual(1)
    .and(positionView.z.greaterThanEqual(worldViewZ.sub(0.02)))
    .and(stage.halo.radiance.greaterThan(0.003));
  const haloPass = pass(stage.halo.scene, camera);
  haloPass.name = 'Upper crescent / luminous silhouette';
  const halo = haloPass.getTextureNode('output');
  const haloBloom = bloom(halo, 0.48, 0.48, 0.9);
  haloBloom.smoothWidth.value = 0.3;
  // The blur must not put a white halo over foreground masonry after the
  // material-level depth test has already hidden the source behind it.
  const glowMask = worldPass.getTextureNode('depth').r.greaterThanEqual(1)
    .and(layerPass.getTextureNode('depth').r.greaterThanEqual(1));
  // The render target contains premultiplied colour (normal alpha blending
  // onto transparent black). Multiplying layer.rgb by alpha again is wrong.
  const solidColor = background.rgb.mul(layer.a.oneMinus()).add(layer.rgb)
    .mul(halo.a.oneMinus()).add(halo.rgb)
    .add(haloBloom.rgb.mul(glowMask.select(1, 0)));
  // Art direction: this light-absorbing moon must retain its dark body even
  // behind the foreground vapor. A trace of haze keeps a little depth cue.
  const moonHaze = layerPass.getTextureNode('depth').r.lessThan(1).select(0.12, 1);
  const atmosphere = solidColor.mul(volume.a.mul(moonHaze).oneMinus()).add(volume.rgb.mul(moonHaze));
  // Low street air lies in front of the distant weather, including gaps
  // above roofs. The lunar volume is composited afterwards and occludes it.
  const cityAtmosphere = cityHaze
    ? atmosphere.mul(cityHaze.a.oneMinus()).add(cityHaze.rgb) : atmosphere;
  // Reference: black matter burns across the luminous cavity/rim. The
  // broader dark weather stays readable; this is its own near-source layer.
  // Preserve optical continuity across the black skin: opacity cannot depend
  // on the background brightness, which formerly cut a hard surface seam.
  // The narrow citadel shaft stops at masonry; the lunar density absorbs
  // its continuation. The existing cloudy air gently softens its shoulders.
  const crossLight = stage.crossLight.layer(worldDepth, camera)
    .mul(volume.a.mul(0.35).oneMinus())
    .mul(cityHaze ? cityHaze.a.mul(0.4).oneMinus() : 1);
  const rawOutput = vec4(cityAtmosphere.add(crossLight).mul(matter.a.oneMinus()).add(matter.rgb), 1);
  // The cloud core no longer writes mesh depth. Detect its actual density
  // coverage so the small edge resolve follows the visible lunar silhouette.
  // Interior ink, cloud detail and masonry retain their original sharpness.
  const resolved = rtt(rawOutput, null, null, { type: THREE.HalfFloatType, depthBuffer: false });
  resolved.name = 'Upper event / silhouette resolve';
  const texel = screenSize.reciprocal();
  const edgeSoftness = uniform(0.9);
  const coverage = matter.a.greaterThan(0.95).select(1, 0);
  let boundary: THREE.Node<'float'> = float(0);
  let softened = resolved.sample(screenUV).rgb.mul(0.25);
  for (const [x, y, weight] of [
    [-1, 0, 0.125], [1, 0, 0.125], [0, -1, 0.125], [0, 1, 0.125],
    [-1, -1, 0.0625], [1, -1, 0.0625], [-1, 1, 0.0625], [1, 1, 0.0625],
  ] as const) {
    const at = screenUV.add(texel.mul(vec2(x, y)));
    const neighbour = matter.sample(at).a.greaterThan(0.95).select(1, 0);
    boundary = boundary.max(coverage.sub(neighbour).abs());
    softened = softened.add(resolved.sample(at).rgb.mul(weight));
  }
  const edgeWeight = boundary.mul(worldDepth.greaterThanEqual(1).select(1, 0)).mul(edgeSoftness);
  const output = vec4(mix(resolved.sample(screenUV).rgb, softened, edgeWeight), 1);
  return { output, layerPass, haloPass, haloBloom, volumePass, matterPass, resolved, edgeSoftness };
};
