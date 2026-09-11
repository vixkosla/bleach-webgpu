import * as THREE from 'three/webgpu';
import {
  cameraPosition, cameraProjectionMatrixInverse, cameraWorldMatrix, color,
  mix, positionGeometry, texture3D, uniform, vec3, vec4,
} from 'three/tsl';
import { createCloudNoiseTexture } from './cloudTexture';
import { createUpperCloudVolume } from './upperCloudVolume';
import { createUpperWeatherCeiling } from './upperWeatherCeiling';
import { createUpperSkyDepth } from './upperSkyDepth';
import { UPPER_ATMOSPHERE } from './upperAtmosphereLayout';
import type { UpperAtmosphereCue, UpperEventLayout } from './upperEvent';

// Back-to-front strata on a shared imaginary sky sphere. Each has a different
// density scale, opacity and wind; they are alpha-composited in one draw.
const SKY_LAYERS = [
  { frequency: 0.18, offset: 0.11, wind: [0.0055, 0.00075, -0.0015], opacity: 0.68, shade: 0x746e80 },
  { frequency: 0.29, offset: 0.37, wind: [-0.0035, 0.00225, 0.003], opacity: 0.57, shade: 0x595563 },
  { frequency: 0.46, offset: 0.63, wind: [0.009, -0.00175, 0.001], opacity: 0.44, shade: 0x37333f },
  { frequency: 0.72, offset: 0.89, wind: [-0.0115, 0.003, -0.004], opacity: 0.33, shade: 0x1e1b28 },
] as const;

export const createUpperClouds = (
  layout: UpperEventLayout,
  material: (color: number, map?: THREE.Texture) => THREE.MeshBasicNodeMaterial,
) => {
  const root = new THREE.Group();
  root.name = 'upper-storm-clouds';
  const noise = createCloudNoiseTexture();
  const time = uniform(0), backgroundTime = uniform(0), exposure = uniform(0);
  const ceiling = createUpperWeatherCeiling(layout, noise, time);
  const volume = createUpperCloudVolume(layout, time, exposure, ceiling);
  const skyDepth = createUpperSkyDepth(layout, noise, backgroundTime, exposure);
  const layers = SKY_LAYERS.map(() => ({
    offset: uniform(new THREE.Vector3()), density: uniform(1),
  }));
  // Art-direction controls remain live-editable without rebuilding the city.
  const controls = { density: uniform(1.35), glow: uniform(0.85), cavity: volume.controls.cavity,
    clearing: uniform(1), clearingWidth: uniform(3.2), clearingLight: uniform(0.25),
    greyTransition: uniform(1.55), royalGlow: volume.controls.royalGlow,
    royalRadius: volume.controls.royalRadius, canopy: uniform(1), ...ceiling.controls, ...skyDepth.controls };
  const orientation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 6);
  const lightPosition = layout.center.clone().add(new THREE.Vector3(0, 0, -layout.radius * 0.55).applyQuaternion(orientation));
  const light = vec3(...lightPosition.toArray());

  // Far atmosphere uses world directions, so the stacked sky has no sprite
  // boundaries or seams at the spherical poles. Eight samples from the SAME
  // 32KB lattice supply four moving translucent layers in one render pass.
  const backdropMaterial = material(0xffffff);
  backdropMaterial.name = 'upper-continuous-storm';
  backdropMaterial.userData.upperBackground = true;
  backdropMaterial.depthTest = false;
  backdropMaterial.vertexNode = vec4(positionGeometry.xy, 1, 1);
  const rayView = cameraProjectionMatrixInverse.mul(vec4(positionGeometry.xy, 1, 1));
  const direction = cameraWorldMatrix.mul(vec4(rayView.xyz, 0)).xyz.normalize();
  const sourceDirection = light.sub(cameraPosition).normalize();
  const skyLight = direction.sub(sourceDirection).length().div(0.46).pow(2).mul(-2).exp()
    .mul(exposure).mul(controls.glow);
  let skyColor = color(0x0b0a10).mul(1).add(color(0xdbd4d8).mul(skyLight).mul(0.045));
  for (const [index, layer] of SKY_LAYERS.entries()) {
    const drift = vec3(backgroundTime.mul(layer.wind[0]), backgroundTime.mul(layer.wind[1]), backgroundTime.mul(layer.wind[2]));
    // Broad rolling deformation makes the sky evolve, not merely slide as a
    // dim stationary-looking wallpaper. Each stratum travels independently.
    const rolling = vec3(
      direction.y.mul(8).add(backgroundTime.mul(0.12)).add(index).sin(),
      direction.z.mul(7).sub(backgroundTime.mul(0.09)).add(index * 2).sin(),
      direction.x.mul(6).add(backgroundTime.mul(0.1)).sub(index).sin(),
    ).mul(0.018);
    const fieldUv = direction.mul(layer.frequency).add(layer.offset).add(drift).add(rolling)
      .add(layers[index]!.offset);
    const weather = texture3D(noise, fieldUv).r.mul(0.7)
      .add(texture3D(noise, fieldUv.mul(2.07).sub(layer.offset)).r.mul(0.3));
    const opticalDepth = weather.smoothstep(0.27, 0.73).mul(controls.density).mul(layers[index]!.density);
    const coverage = opticalDepth.mul(-2).exp().oneMinus().mul(layer.opacity);
    const transmission = opticalDepth.mul(-3.1).exp();
    const layerColor = color(layer.shade).mul(opticalDepth.mul(0.26).add(0.3))
      .add(color(0xdbd4d8).mul(skyLight).mul(transmission).mul(0.12 / (1 + index * 0.5)));
    skyColor = skyColor.mul(coverage.oneMinus()).add(layerColor.mul(coverage));
  }
  // A genuinely empty luminous clearing behind the moon. Closest approach
  // of the world ray to an ellipsoid keeps it volumetric from every angle;
  // this is not another moving grey cloud layer or a screen-space circle.
  const clearing = UPPER_ATMOSPHERE.clearing;
  const lunarFrame = uniform(new THREE.Matrix3().setFromMatrix4(
    new THREE.Matrix4().makeRotationFromQuaternion(layout.orientation.clone().invert())));
  const eye = lunarFrame.mul(cameraPosition.sub(vec3(...layout.center.toArray())))
    .div(layout.radius).sub(vec3(...clearing.offset)).div(vec3(...clearing.axes));
  const ray = lunarFrame.mul(direction).div(vec3(...clearing.axes));
  const travel = eye.dot(ray).negate().div(ray.dot(ray)).max(0);
  const closest = eye.add(ray.mul(travel));
  const radius = closest.length();
  // A compact, smooth shoulder preserves the original dark storm contrast.
  // Unequal folds distort only its outer edge; the light must not wash over
  // the entire sky or erase the broad diagonal weather composition.
  const drift = vec3(backgroundTime.mul(0.0014), backgroundTime.mul(-0.0009), backgroundTime.mul(0.0007));
  const broad = texture3D(noise, closest.mul(vec3(0.055, 0.041, 0.048)).add(drift).add(0.27)).r;
  const folds = texture3D(noise, closest.mul(vec3(0.115, 0.068, 0.09)).sub(drift.mul(0.6)).add(0.63)).r;
  const diagonal = closest.x.mul(0.85).add(closest.y.mul(1.3)).add(0.4).sin().mul(0.16);
  const bend = broad.sub(0.5).mul(0.58).add(folds.sub(0.5).mul(0.26)).add(diagonal)
    .mul(radius.smoothstep(0.65, 1.5));
  const shoulder = radius.add(bend).sub(clearing.white).max(0);
  // Let the bright field extend beneath the outer storm nearly to the frame
  // edges. Dark banks retain their own density in front of this backdrop.
  const spread = broad.mul(0.12).add(clearing.edge - clearing.white).mul(controls.clearingWidth);
  const clearMask = shoulder.div(spread).pow(2).mul(-2.2).exp()
    .mul(controls.clearing).mul(exposure.smoothstep(0, 0.8));
  // Dimmer uneven ambient light behind the source. The brightest whites now
  // come from its real contour and the small volume scattering that light,
  // rather than a broad flat luminous disc behind the entire composition.
  const cloudShadow = texture3D(noise, closest.mul(vec3(0.12, 0.17, 0.11))
    .add(drift.mul(1.8)).add(0.41)).r.smoothstep(0.30, 0.74);
  const transmission = cloudShadow.mul(0.62).oneMinus();
  // Coverage, peak luminance and the grey shoulder are independent. The
  // broad region stays present underneath the storm without becoming white.
  const greyShoulder = shoulder.div(controls.greyTransition).pow(2).mul(-0.85).exp();
  const lowerBanks = closest.y.add(broad.sub(0.5).mul(0.7)).smoothstep(-2.8, -0.35)
    .mul(0.70).add(0.30);
  const lightLevels = greyShoulder.mul(0.80).add(0.20).mul(lowerBanks);
  const white = color(0xf4f3f4).mul(exposure).mul(controls.clearingLight)
    .mul(transmission).mul(lightLevels).mul(controls.cavity.div(1.8));

  // A small warm sphere of backlight behind the castle. Closest approach in
  // world space gives a circular falloff from every view, with cloud breakup.
  // This background material is masked by real architectural/solid depth.
  const castle = UPPER_ATMOSPHERE.castle;
  const castleEye = lunarFrame.mul(cameraPosition.sub(vec3(...layout.center.toArray())))
    .div(layout.radius).sub(vec3(...castle.offset));
  const castleRay = lunarFrame.mul(direction);
  const castleTravel = castleEye.dot(castleRay).negate().max(0);
  const castleClosest = castleEye.add(castleRay.mul(castleTravel));
  const castleDistance = castleClosest.length().div(controls.royalRadius);
  const royalFalloff = castleDistance.pow(2).mul(-1.8).exp()
    .add(castleDistance.pow(2).mul(-0.65).exp().mul(0.10));
  const royalFog = texture3D(noise, castleClosest.mul(0.11).add(drift).add(0.57)).r
    .mul(0.28).add(0.72);
  const royalLight = color(0xffd29a).mul(royalFalloff).mul(royalFog)
    .mul(controls.royalGlow).mul(exposure.smoothstep(0, 0.9));
  // Project the weather's world-height boundary onto its distant backdrop.
  // Closest approach to the event anchors it in the scene during orbit and
  // elevation; the same boundary removes low density from the actual banks.
  const weatherTravel = vec3(...layout.center.toArray()).sub(cameraPosition).dot(direction).max(0);
  const weatherPoint = cameraPosition.add(direction.mul(weatherTravel));
  const weatherCoverage = ceiling.coverage(weatherPoint);
  // The distant shelves sit on a far weather cylinder around the island.
  // Intersect the real viewing ray: projecting them at the moon's closest
  // point would curl horizontal strata underneath the city in high views.
  const horizonOrigin = cameraPosition.sub(vec3(...layout.center.toArray())).xz;
  const horizonRay = direction.xz;
  const horizonA = horizonRay.dot(horizonRay).max(0.00001);
  const horizonB = horizonOrigin.dot(horizonRay);
  const horizonC = horizonOrigin.dot(horizonOrigin).sub(2200 * 2200);
  const horizonTravel = horizonB.negate().add(horizonB.mul(horizonB)
    .sub(horizonA.mul(horizonC)).max(0).sqrt()).div(horizonA).max(0);
  const distantPoint = cameraPosition.add(direction.mul(horizonTravel));
  const distantField = ceiling.distant(distantPoint);
  const distantOpenings = distantField.x.mul(exposure.smoothstep(0, 0.9));
  const night = color(0x03040a).mul(1).add(color(0xe4d5d8).mul(distantOpenings).mul(0.10));
  const weatherBackground = mix(night,
    mix(skyColor, white, clearMask).add(royalLight), weatherCoverage);
  // Far mist/light remains behind the near volume, at its own world height.
  // Previously its seams were confined to (1-weatherCoverage), disappearing
  // wherever the upper background covered them. Story air reveals them in
  // the overlapping region too; the inspector's zero mist keeps its look.
  const farAir = distantField.y.mul(.34);
  const farColor = color(0xc8b8d1).mul(.10).add(color(0xffefd9).mul(distantOpenings).mul(.5));
  const oldSky = mix(weatherBackground, farColor, farAir)
    .add(color(0xf0e0d3).mul(distantOpenings).mul(controls.distantMist).mul(weatherCoverage).mul(.14));
  const depth = skyDepth.layer(direction);
  backdropMaterial.colorNode = vec4(oldSky.mul(depth.a.oneMinus()).add(depth.rgb), 1);
  const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), backdropMaterial);
  backdrop.name = 'upper-storm-background';
  backdrop.frustumCulled = false;
  backdrop.renderOrder = -1000;
  root.add(backdrop);

  const update = (motion: number, birth: number, charge: number, opening: number, cloud: number, cue?: UpperAtmosphereCue) => {
    time.value = motion;
    // Distant weather evolves at 70% of the near-cloud clock. Derive it from
    // absolute motion time so pause, HOLD and reverse seek remain reproducible.
    backgroundTime.value = cue ? cue.distantTime : motion * 0.7;
    exposure.value = (cue ? (cue.atmosphereLight ?? cue.illumination) * 2.3 : Math.max(charge * 0.7, birth * 2.3))
      * (0.97 + Math.sin(motion * 0.38) * 0.03);
    backdropMaterial.opacity = (cue ? 1 : 0.75 + birth * 0.25) * controls.canopy.value;
    volume.update(cue ? cloud > .001 : birth > 0 || charge > 0, cloud, cue ? 1 : 0.32 + birth * 0.68);
  };
  return { root, textures: [volume.texture, volume.detailTexture, volume.coronalTransmission], noise, controls, layers, volume, update, motionTime: time, backgroundMotionTime: backgroundTime, skyLayers: SKY_LAYERS,
    dispose() { volume.dispose(); noise.dispose(); root.clear(); },
  };
};
