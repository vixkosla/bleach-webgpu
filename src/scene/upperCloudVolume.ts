import * as THREE from 'three/webgpu';
import {
  Break, Fn, If, Loop, cameraPosition, color, float, mix, modelViewMatrix,
  modelWorldMatrix, modelWorldMatrixInverse, positionGeometry, screenCoordinate, texture3D, uniform, vec2, vec3, vec4,
} from 'three/tsl';
import { ImprovedNoise } from 'three/addons/math/ImprovedNoise.js';
import { smoothstep } from '../utils/math';
import { createCloudDetailTexture } from './cloudDetailTexture';
import { createCentralCloudTexture } from './upperCentralClouds';
import { CRESCENT_SHAFT_ANGLE, crescentParallelShafts, crescentShaftSource } from './crescentLight';
import type { UpperEventLayout } from './upperEvent';
import { UPPER_ATMOSPHERE } from './upperAtmosphereLayout';
import type { UpperWeatherCeiling } from './upperWeatherCeiling';

// Preserve the original bank sizes, diagonal slopes and relative rhythm.
// Translate their centres outwards as a group, with deeper Z placement.
// The dense dark banks leave room for the separately lit central folds.
const CURRENTS = [
  [-3.4, 2.0, 0.25, 2.3, 0.60, 0.65, -0.30],
  [-1.85, 1.35, 0.4, 1.45, 0.52, 0.62, -0.55],
  [3.35, 1.85, 0.1, 2.5, 0.58, 0.72, 0.32],
  [1.95, 0.82, 0.5, 1.55, 0.48, 0.62, 0.62],
  [-2.65, -1.25, 0.05, 2.2, 0.70, 0.7, 0.2],
  [2.3, -1.45, 0.18, 2.1, 0.62, 0.65, -0.32],
  [-0.15, -2.0, -0.55, 1.8, 0.6, 0.65, 0.08],
] as const;
const SPAN = new THREE.Vector3(10.4, 7.2, 3.8);
const OFFSET = new THREE.Vector3(0, 0.1, -0.15);

/** Density and approximate light transmission occupy a real 3D grid. */
export const createStormVolumeTexture = (size = 128): THREE.Data3DTexture => {
  if (!Number.isInteger(size) || size < 8 || size > 128) throw new Error('Invalid cloud volume size');
  const density = new Float32Array(size ** 3);
  const field = new ImprovedNoise();
  const currents = CURRENTS.map(([x, y, z, rx, ry, rz, angle]) =>
    ({ x: x + x / Math.hypot(x, y) * 0.82,
      y: y + y / Math.hypot(x, y) * 0.82, z: z - 0.9,
      rx, ry, rz, cos: Math.cos(angle), sin: Math.sin(angle), strength: 1 }));
  for (let z = 0; z < size; z++) for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const px = (x / (size - 1) - 0.5) * SPAN.x + OFFSET.x;
    const py = (y / (size - 1) - 0.5) * SPAN.y + OFFSET.y;
    const pz = (z / (size - 1) - 0.5) * SPAN.z + OFFSET.z;
    const border = 1 - smoothstep(0.40, 0.49, Math.max(Math.abs(x / (size - 1) - 0.5),
      Math.abs(y / (size - 1) - 0.5), Math.abs(z / (size - 1) - 0.5)));
    if (border === 0) continue;
    const warp = field.noise(px * 1.35 + 17, py * 1.35, pz * 1.35 + 5) * 0.46;
    let body = 0, mantle = 0;
    for (const c of currents) {
      const dx = px - c.x, dy = py - c.y + warp, dz = pz - c.z;
      const u = (dx * c.cos + dy * c.sin) / c.rx;
      const v = (-dx * c.sin + dy * c.cos) / c.ry;
      body = Math.max(body, (1 - u * u - v * v - (dz / c.rz) ** 2) * c.strength);
      // Extend the same seven banks through depth with dilute shoulders.
      // No new cloudlets: a low-density envelope around existing solids.
      mantle = Math.max(mantle, Math.exp(-(u * u / 1.35 + v * v / 2.6
        + (dz / c.rz) ** 2 / 2.4) * 1.35));
    }
    const coarse = field.noise(px * 2.1 + 13, py * 2.1 + 7, pz * 2.1 + 3);
    const fine = field.noise(px * 6.3 + 23, py * 6.3 - 11, pz * 6.3 + 19);
    // Long torn folds run along the currents. Their density modulates the
    // whole bank, so its silhouette does not remain an intact smooth oval.
    const folds = field.noise(px * 1.2 + 31, (py - Math.abs(px) * 0.22) * 5.8,
      pz * 4.8 + 29);
    const erosion = coarse * 0.40 + fine * 0.18 + folds * 0.34;
    // Thin continuous medium connects the dark currents and carries backlight.
    const veil = Math.exp(-(((pz + 0.65 + warp) / 0.8) ** 2)) * 0.016
      * (0.65 + coarse * 0.35);
    const value = Math.max(0, body * 0.78 + erosion - 0.15) + veil;
    // Cut the central column out of the baked field as well as the shader:
    // turbulence and the connecting veil must not refill the white opening.
    const zone = UPPER_ATMOSPHERE.weather;
    const separation = smoothstep(zone.start, zone.full,
      Math.hypot(px / zone.axes[0], py / zone.axes[1]));
    const fogSeparation = smoothstep(UPPER_ATMOSPHERE.fog.start, UPPER_ATMOSPHERE.fog.full,
      Math.hypot(px / zone.axes[0], py / zone.axes[1]));
    const fog = mantle * 0.075 * (0.7 + coarse * 0.3) * fogSeparation;
    density[(z * size + y) * size + x] = Math.min(1, (value * separation + fog) * border);
  }
  const data = new Uint8Array(size ** 3 * 2);
  const at = (x: number, y: number, z: number) => density[
    (Math.max(0, Math.min(size - 1, Math.round(z))) * size
      + Math.max(0, Math.min(size - 1, Math.round(y)))) * size
      + Math.max(0, Math.min(size - 1, Math.round(x)))
  ]!;
  // Short light march is baked once; the animated shader samples both channels.
  const lightGrid = new THREE.Vector3(0.5, 0.5 - OFFSET.y / SPAN.y, 0.5 + (-0.6 - OFFSET.z) / SPAN.z)
    .multiplyScalar(size - 1);
  for (let z = 0; z < size; z++) for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (z * size + y) * size + x;
    const dx = lightGrid.x - x, dy = lightGrid.y - y, dz = lightGrid.z - z;
    const length = Math.hypot(dx, dy, dz) || 1;
    let optical = 0;
    for (let j = 1; j <= 6; j++) optical += at(x + dx / length * j * 1.6,
      y + dy / length * j * 1.6, z + dz / length * j * 1.6);
    data[i * 2] = Math.round(density[i]! * 255);
    data[i * 2 + 1] = Math.round(Math.exp(-optical * 0.8) * 255);
  }
  const result = new THREE.Data3DTexture(data, size, size, size);
  result.name = 'storm-volume-density-transmission';
  result.format = THREE.RGFormat;
  result.minFilter = result.magFilter = THREE.LinearFilter;
  result.unpackAlignment = 1;
  result.needsUpdate = true;
  return result;
};

/** Approximate optical visibility along the shared diagonal from the corona.
 * It shares the storm density rather than drawing arbitrary light streaks.
 * The shader advects this field with the broad cloud deformation. */
export const createCoronalTransmissionTexture = (
  storm: THREE.Data3DTexture, size = 64, moonToCloud = new THREE.Matrix4(),
) => {
  if (!Number.isInteger(size) || size < 8 || size > 128) throw new Error('Invalid coronal visibility size');
  const source = storm.image.data as Uint8Array, n = storm.image.width;
  const data = new Uint8Array(size ** 3);
  const cloudToMoon = moonToCloud.clone().invert();
  const moonPoint = new THREE.Vector3(), cloudSource = new THREE.Vector3();
  const at = (x: number, y: number, z: number) => {
    const grid = [x, y, z].map((v, axis) => Math.round(((v - OFFSET.getComponent(axis))
      / SPAN.getComponent(axis) + 0.5) * (n - 1)));
    if (grid.some(v => v < 0 || v >= n)) return 0;
    return source[((grid[2]! * n + grid[1]!) * n + grid[0]!) * 2]! / 255;
  };
  for (let z = 0; z < size; z++) for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const px = (x / (size - 1) - 0.5) * SPAN.x + OFFSET.x;
    const py = (y / (size - 1) - 0.5) * SPAN.y + OFFSET.y;
    const pz = (z / (size - 1) - 0.5) * SPAN.z + OFFSET.z;
    moonPoint.set(px, py, pz).applyMatrix4(cloudToMoon);
    const origin = crescentShaftSource(moonPoint.x, moonPoint.y);
    cloudSource.set(origin.x, origin.y, 0).applyMatrix4(moonToCloud);
    const sx = cloudSource.x, sy = cloudSource.y, sz = cloudSource.z;
    const dx = px - sx, dy = py - sy, dz = pz - sz, distance = Math.hypot(dx, dy, dz);
    let optical = 0;
    for (let i = 0; i < 12; i++) {
      const t = (i + 0.5) / 12;
      optical += at(sx + dx * t, sy + dy * t, sz + dz * t);
    }
    data[(z * size + y) * size + x] = Math.round(Math.exp(-optical * distance / 12 * 9.12) * 255);
  }
  const texture = new THREE.Data3DTexture(data, size, size, size);
  texture.name = 'cloud-visibility-from-crescent-corona';
  texture.format = THREE.RedFormat;
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.unpackAlignment = 1; texture.needsUpdate = true;
  return texture;
};

export const createUpperCloudVolume = (
  layout: UpperEventLayout,
  clock: THREE.Node<'float'>,
  exposure: THREE.Node<'float'>,
  ceiling: UpperWeatherCeiling,
) => {
  const scene = new THREE.Scene(); scene.name = 'upper-cloud-volume-layer';
  const texture = createStormVolumeTexture();
  const detailTexture = createCloudDetailTexture();
  // Outer banks keep their tilted frame; central folds and the white
  // clearing follow the moon. Use the same transform for density and light.
  // Both the shader and optical bake use this same frame conversion.
  const stormOrientation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 6);
  const cloudToMoon = new THREE.Matrix4().makeRotationFromQuaternion(
    layout.orientation.clone().invert().multiply(stormOrientation));
  const sourceFrame = uniform(new THREE.Matrix3().setFromMatrix4(cloudToMoon));
  const centralTexture = createCentralCloudTexture(SPAN, OFFSET, cloudToMoon);
  const coronalTransmission = createCoronalTransmissionTexture(texture, 64, cloudToMoon.clone().invert());
  const controls = { density: uniform(2.4), light: uniform(0.95), cavity: uniform(1.8), steps: uniform(64), detail: uniform(0.85), rays: uniform(12), rayClouds: uniform(1), sourceScale: uniform(1),
    centralClouds: uniform(1), centralLight: uniform(0.75), centralRays: uniform(0.22),
    bankSpread: uniform(0), centralLift: uniform(0), centralFold: uniform(0),
    royalGlow: uniform(UPPER_ATMOSPHERE.castle.strength), royalRadius: uniform(UPPER_ATMOSPHERE.castle.radius) };
  const material = new THREE.MeshBasicNodeMaterial({ color: 0xffffff, side: THREE.BackSide,
    transparent: true, depthTest: false, depthWrite: false, fog: false });
  material.name = 'upper-raymarched-storm';
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
  mesh.name = 'upper-cloud-volume';
  mesh.quaternion.copy(stormOrientation);
  mesh.position.copy(layout.center).add(OFFSET.clone().multiplyScalar(layout.radius).applyQuaternion(mesh.quaternion));
  mesh.scale.copy(SPAN).multiplyScalar(layout.radius);
  scene.add(mesh);

  const setDepth = (viewDepth: THREE.Node<'float'>) => {
    // Ray-box integration follows Three's RaymarchingBox technique, with
    // explicit step length and per-sample architecture/moon depth clipping.
    material.colorNode = Fn(() => {
      const origin = modelWorldMatrixInverse.mul(vec4(cameraPosition, 1)).xyz.toVar();
      const direction = positionGeometry.sub(origin).normalize().toVar();
      const lo = vec3(-0.5).sub(origin).div(direction), hi = vec3(0.5).sub(origin).div(direction);
      const lower = lo.min(hi), upper = lo.max(hi);
      const entry = lower.x.max(lower.y).max(lower.z).max(0).toVar();
      const end = upper.x.min(upper.y).min(upper.z).toVar();
      entry.greaterThanEqual(end).discard();
      const worldLength = modelWorldMatrix.mul(vec4(direction.mul(end.sub(entry)), 0)).xyz.length();
      // A side-on ray is much longer than a frontal ray through this volume.
      // Keep its physical sample spacing rather than stretching 64 slices.
      const steps = controls.steps.mul(worldLength.div(layout.radius * 3.8).max(1)).ceil().min(176).toVar();
      const step = end.sub(entry).div(steps).toVar();
      const opticalStep = modelWorldMatrix.mul(vec4(direction.mul(step), 0)).xyz.length()
        .div(layout.radius).toVar();
      const jitter = screenCoordinate.xy.dot(vec2(12.9898, 78.233)).sin().mul(43758.5453).fract();
      const p = origin.add(direction.mul(entry.add(step.mul(jitter.mul(0.7).add(0.15))))).toVar();
      const sum = vec4(0).toVar();
      const physicalRay = direction.mul(vec3(SPAN.x, SPAN.y, SPAN.z)).normalize().toVar();
      Loop({ start: 0, end: steps, type: 'float', condition: '<' }, () => {
        If(modelViewMatrix.mul(vec4(p, 1)).z.lessThan(viewDepth), () => { Break(); });
        const wave = vec3(
          p.y.mul(14).add(clock.mul(0.18)).sin().mul(0.017),
          p.x.mul(11).sub(clock.mul(0.14)).sin().mul(0.021),
          p.x.mul(8).add(p.y.mul(7)).add(clock.mul(0.16)).sin().mul(0.023),
        );
        // Authored pressure opens the two banks within the existing volume.
        // Sample their baked transmission in the same deformed coordinates.
        // Leave the baked zero-density border in place. A uniform stretch
        // would pull dense banks onto the box exit and expose a straight cut.
        const deformationEnvelope = p.abs().x.max(p.abs().y).max(p.abs().z)
          .smoothstep(.30, .48).oneMinus();
        const bankUv = vec3(p.x.div(controls.bankSpread.mul(deformationEnvelope).add(1)), p.y, p.z)
          .add(0.5).add(wave);
        const field = texture3D(texture, bankUv, 0).toVar();
        const local = p.mul(vec3(SPAN.x, SPAN.y, SPAN.z)).add(vec3(OFFSET.x, OFFSET.y, OFFSET.z));
        const moonLocal = sourceFrame.mul(local).toVar();
        const zone = UPPER_ATMOSPHERE.weather;
        const weatherRadius = moonLocal.xy.div(vec2(...zone.axes)).length();
        const weatherCoverage = ceiling.coverage(modelWorldMatrix.mul(vec4(p, 1)).xyz).toVar();
        const weatherMask = weatherRadius.smoothstep(UPPER_ATMOSPHERE.fog.start, UPPER_ATMOSPHERE.fog.full)
          .mul(weatherCoverage);
        const wind = vec3(clock.mul(0.016), clock.mul(0.004), clock.mul(-0.012));
        // World-proportioned cellular volumes add coherent lobes and creases,
        // rather than uncorrelated grain sampled more finely than the ray step.
        const billows = texture3D(detailTexture, local.mul(0.72).add(wind), 0).toVar();
        const fine = texture3D(detailTexture, local.mul(1.63).sub(wind.mul(1.2)).add(0.37), 0).toVar();
        // Fade sub-step frequencies on long side rays to avoid boiling specks.
        const fineWeight = opticalStep.smoothstep(0.028, 0.082).oneMinus();
        const eddies = billows.r.mul(0.7).add(fine.r.mul(0.3));
        const erosion = billows.r.oneMinus().mul(0.12)
          .add(fine.r.oneMinus().mul(0.06).mul(fineWeight)).mul(controls.detail);
        // Erode dense banks; retain their much thinner, softly graded mantle.
        const cloudDensity = field.r.sub(erosion.mul(field.r.smoothstep(0.025, 0.18))).max(0)
          .mul(controls.density).mul(weatherMask).toVar();
        // Thin volumes stretched along the same light direction. Anisotropic
        // billows split each ray into unequal pieces instead of painting a
        // continuous gold line or adding round cloud stamps around the moon.
        const rayZone = UPPER_ATMOSPHERE.rays;
        const shaftAxis = vec2(Math.cos(CRESCENT_SHAFT_ANGLE), Math.sin(CRESCENT_SHAFT_ANGLE));
        const shaftTangent = vec2(-Math.sin(CRESCENT_SHAFT_ANGLE), Math.cos(CRESCENT_SHAFT_ANGLE));
        const along = moonLocal.xy.dot(shaftAxis), across = moonLocal.xy.dot(shaftTangent);
        const fragmentUv = vec3(
          across.add(eddies.sub(0.5).mul(0.018)).mul(1.8),
          along.mul(0.72).sub(clock.mul(0.006)),
          // Keep gaps coherent through the thickness. Independent high-Z
          // billows integrated into a continuous bright ribbon from the front.
          moonLocal.z.mul(0.02),
        ).add(vec3(0.19, 0.31, 0.47));
        const fragmentField = texture3D(detailTexture, fragmentUv, 0).toVar();
        const fragmentShape = fragmentField.r.mul(0.86).add(fine.r.mul(0.14))
          .smoothstep(0.52, 0.77);
        // Shift the short fragments away from the magma. Their lines still
        // trace back to the same contour openings, along the shared diagonal.
        const bridgeAlong = along.abs().sub(rayZone.startOffset).max(0).mul(along.sign());
        const bridgePoint = vec3(shaftAxis.mul(bridgeAlong).add(shaftTangent.mul(across)),
          moonLocal.z.sub(rayZone.depth));
        const bridgeRadius = moonLocal.xy.length();
        const bridgeMask = bridgeRadius.smoothstep(rayZone.start, rayZone.full)
          .mul(bridgeRadius.smoothstep(rayZone.edge - 0.3, rayZone.edge).oneMinus());
        const beamEnvelope = crescentParallelShafts(bridgePoint, clock, controls.sourceScale)
          .mul(bridgeMask).toVar();
        // Shallow, soft volumes keep perspective integration from filling
        // the gaps with unrelated pieces farther along the viewing ray.
        const fragmentDepth = moonLocal.z.sub(rayZone.depth).div(0.18).pow(2).mul(-0.5).exp();
        const fragmentTravel = along.abs().sub(controls.sourceScale.mul(controls.sourceScale)
          .sub(across.mul(across)).max(0.0001).sqrt()).sub(rayZone.startOffset);
        const fragmentReach = fragmentTravel.smoothstep(0.45, 1.05).oneMinus();
        const fragmentDensity = beamEnvelope.mul(fragmentShape).mul(fragmentDepth).mul(fragmentReach).mul(0.45)
          .mul(controls.rayClouds).mul(weatherCoverage).toVar();
        // Connected pale folds sit behind the lunar body. This is the same
        // depth-clipped storm integral, with its own baked rear illumination.
        // Broad advection deforms the bank; resolved billows erode its crests.
        const fold = p.x.mul(9).add(clock.mul(.15)).sin().mul(.025).mul(controls.centralFold);
        const centralUv = vec3(p.x, p.y.add(fold.sub(controls.centralLift).mul(deformationEnvelope)), p.z)
          .add(0.5).add(wave.mul(0.45));
        const central = texture3D(centralTexture, centralUv, 0).toVar();
        const centralDensity = central.r.mul(billows.r.mul(0.48).add(0.68))
          .mul(controls.centralClouds).mul(weatherCoverage).mul(2.1).toVar();
        // Dilute air in front of the cloud carries its baked light/shadow
        // paths. No separate streak geometry: the folds occlude the shafts.
        const centralAir = moonLocal.sub(vec3(0, 0, -0.35)).div(vec3(2.15, 1.35, 0.55));
        const centralVeil = centralAir.dot(centralAir).mul(-1.65).exp().mul(0.04)
          .mul(controls.centralClouds).mul(controls.centralRays).mul(weatherCoverage).toVar();
        const mistDensity = p.abs().x.max(p.abs().y).max(p.abs().z)
          .smoothstep(0.35, 0.49).oneMinus().mul(0.0025).mul(weatherMask);
        const density = cloudDensity.add(mistDensity).add(fragmentDensity)
          .add(centralDensity).add(centralVeil).toVar();
        const alpha = density.mul(opticalStep).mul(-3.8).exp().oneMinus();
        const lightDistance = local.sub(vec3(0, 0, -0.6)).length();
        // Approximate dual-lobe scattering: light wraps into thin rims and
        // changes naturally with the eye/light angle during an orbit.
        const lightDirection = vec3(0, 0, -0.6).sub(local).normalize();
        const cosine = lightDirection.dot(physicalRay).clamp(-1, 1);
        const forward = float(1 - 0.45 ** 2)
          .div(float(1 + 0.45 ** 2).sub(cosine.mul(0.9)).pow(1.5));
        const backward = float(1 - 0.2 ** 2)
          .div(float(1 + 0.2 ** 2).add(cosine.mul(0.4)).pow(1.5));
        const phase = forward.mul(0.22).add(backward.mul(0.12)).add(0.60).min(1.8);
        const softShadow = field.g.pow(2.2);
        const powder = cloudDensity.mul(-1.8).exp().oneMinus();
        const illumination = lightDistance.div(1.8).pow(2).mul(-0.75).exp()
          .mul(softShadow).mul(exposure).mul(controls.light).mul(phase)
          .mul(powder.mul(0.28).add(0.78));
        const smallRelief = billows.g.mul(0.17).add(fine.g.mul(0.10).mul(fineWeight)).add(0.86);
        const royalDistance = moonLocal.sub(vec3(...UPPER_ATMOSPHERE.castle.offset)).length()
          .div(controls.royalRadius.mul(1.25));
        const royalScatter = royalDistance.pow(2).mul(-1.4).exp()
          .mul(controls.royalGlow).mul(softShadow).mul(exposure.smoothstep(0, 0.9));
        const cloudColor = color(0x24212c).mul(0.28)
          .add(color(0xe1dce4).mul(illumination).mul(smallRelief))
          .add(color(0xffd29a).mul(royalScatter));
        // Strong parallel shafts of light crossing the cloud gaps. World
        // coordinates keep them attached to the event throughout an orbit.
        const distanceFromRim = moonLocal.xy.length().sub(controls.sourceScale).max(0);
        const visibility = texture3D(coronalTransmission, bankUv, 0).r;
        const thinGas = cloudDensity.smoothstep(0.008, 0.09)
          .mul(cloudDensity.smoothstep(0.35, 1.0).oneMinus());
        const pockets = thinGas.mul(eddies.smoothstep(0.24, 0.66)).mul(0.94).add(0.06);
        const shafts = beamEnvelope
          .mul(visibility).mul(pockets)
          .mul(controls.rays).mul(exposure.mul(0.43));
        const shaftColor = mix(color(0xfffaf0), color(0xfff1d8), distanceFromRim.smoothstep(0.08, 0.85));
        const shaftScatter = mistDensity.mul(0.65).add(cloudDensity.mul(0.65))
          .div(density.max(0.0001))
          .mul(mix(1, 0.35, controls.rayClouds));
        // Warm light has a cloudy core and feathered, less luminous edges.
        // The density participates in the same depth-clipped integration as
        // the storm. Existing baked source visibility remains approximate.
        const fragmentLight = visibility.mul(controls.rays).mul(exposure.mul(0.43))
          .mul(fragmentField.g.mul(0.3).add(0.9));
        const fragmentColor = mix(color(0xf4d49e), color(0xd6a967), fragmentShape)
          .mul(fragmentLight).add(color(0x24212c).mul(0.22));
        // Rear transmission picks out thin ridges and the long openings
        // between them. A broad, restrained warm-white source stays buried
        // behind the weather instead of outlining each cloud in gold.
        const centralRelief = billows.g.mul(0.20).add(fine.g.mul(0.12).mul(fineWeight)).add(0.82);
        const centralBacklight = central.g.pow(2.2).mul(controls.centralLight)
          .mul(exposure).mul(phase.mul(0.22).add(0.78));
        const centralColor = color(0xb5b0bf).mul(0.34)
          .add(color(0xfff5e4).mul(centralBacklight)).mul(centralRelief);
        const centralShaftColor = color(0xfff6e8).mul(central.g.pow(2))
          .mul(exposure).mul(controls.centralLight).mul(1.8);
        const sampleColor = cloudColor.mul(cloudDensity)
          .add(fragmentColor.mul(fragmentDensity))
          .add(centralColor.mul(centralDensity))
          .add(centralShaftColor.mul(centralVeil))
          .div(density.max(0.0001)).add(shaftColor.mul(shafts).mul(shaftScatter));
        const amount = sum.a.oneMinus().mul(alpha);
        sum.rgb.addAssign(sampleColor.mul(amount));
        sum.a.addAssign(amount);
        If(sum.a.greaterThan(0.985), () => { Break(); });
        p.addAssign(direction.mul(step));
      });
      // Normal alpha blending into the transparent pass premultiplies once.
      return vec4(sum.rgb.div(sum.a.max(0.0001)), sum.a);
    })();
  };
  setDepth(float(-1e8));
  return { scene, mesh, texture, detailTexture, centralTexture, coronalTransmission, material, controls, sourceFrame, setDepth,
    update: (visible: boolean, opacity: number, sourceScale = 1) => {
      mesh.visible = visible; material.opacity = opacity; controls.sourceScale.value = sourceScale;
    },
    dispose: () => { texture.dispose(); detailTexture.dispose(); centralTexture.dispose(); coronalTransmission.dispose(); mesh.geometry.dispose(); material.dispose(); scene.clear(); },
  };
};
