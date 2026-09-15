import * as THREE from 'three/webgpu';
import {
  Break, Fn, If, Loop, atan, cameraPosition, color, float, modelViewMatrix,
  modelWorldMatrix, modelWorldMatrixInverse, positionGeometry, screenCoordinate,
  uniform, vec2, vec3, vec4,
} from 'three/tsl';
import type { UpperEventLayout } from './upperEvent';
import { UPPER_ATMOSPHERE } from './upperAtmosphereLayout';
import { crescentContourRadiance } from './crescentLight';
import { createUpperMatterField } from './upperMatterField';
import { writeMatterGrowth, type MatterStoryPose } from '../cinematic/MatterStoryState';

/** Absorbing, turbulent Getsuga matter, independent of the grey weather. */
export const createUpperGetsugaMatter = (
  layout: UpperEventLayout, noise: THREE.Data3DTexture,
  detail: THREE.Data3DTexture, clock: THREE.Node<'float'>,
) => {
  const scene = new THREE.Scene(); scene.name = 'upper-getsuga-dark-matter';
  const controls = { strength: uniform(1), density: uniform(9.0), coreDensity: uniform(110), speed: uniform(1), offset: uniform(0), birth: uniform(0), roots: uniform(1), wisps: uniform(1), flameTips: uniform(1), scatter: uniform(1), openings: uniform(1), contour: uniform(1.15), cavityLight: uniform(0.45) };
  const story = { assembly: uniform(1), cohesion: uniform(1), compression: uniform(0), release: uniform(0), wake: uniform(0) };
  const growth = new THREE.Vector3(1, 1, 1);
  const finalFlow = uniform(0);
  const setStory = (pose?: Readonly<MatterStoryPose>) => {
    story.assembly.value = pose?.assembly ?? 1;
    story.cohesion.value = pose?.cohesion ?? 1;
    story.compression.value = pose?.compression ?? 0;
    story.release.value = pose?.release ?? 0;
    story.wake.value = pose?.wake ?? 0;
    writeMatterGrowth(pose, growth);
    mesh.scale.copy(span).multiply(growth).multiplyScalar(layout.radius);
    // Lower attachment stays fixed in the lunar frame. Width and thickness
    // expand at different rates; this is not a uniform zoom of a finished moon.
    mesh.position.set(zone.offset[0] * growth.x,
      zone.offset[1] * growth.y + growth.y - 1, zone.offset[2] * growth.z)
      .multiplyScalar(layout.radius).applyQuaternion(layout.orientation).add(layout.center);
    mesh.updateMatrix();
  };
  const zone = UPPER_ATMOSPHERE.matter;
  const wispZone = UPPER_ATMOSPHERE.wisps;
  const span = new THREE.Vector3(3.8, 3.8, 1.6);
  const material = new THREE.MeshBasicNodeMaterial({
    side: THREE.BackSide, transparent: true, depthTest: false, depthWrite: false, fog: false,
  });
  material.name = 'getsuga-cohesive-turbulent-matter';
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
  mesh.name = 'getsuga-dark-matter-volume';
  mesh.position.copy(layout.center).add(new THREE.Vector3(...zone.offset)
    .multiplyScalar(layout.radius).applyQuaternion(layout.orientation));
  mesh.quaternion.copy(layout.orientation);
  mesh.scale.copy(span).multiplyScalar(layout.radius); scene.add(mesh);

  const matterClock = clock.mul(controls.speed).add(controls.offset);
  const field = createUpperMatterField(noise, detail, matterClock, story.compression, story.release, story.wake, finalFlow);
  // Compatibility handle for inspecting the same source on the solid skin.
  const surfaceActivity = Fn(([point]: [THREE.Node<'vec3'>]) => {
    return field.flow(point).y;
  });
  const surfaceFrame = field.surface;

  const setDepth = (viewDepth: THREE.Node<'float'>) => {
    material.colorNode = Fn(() => {
      const origin = modelWorldMatrixInverse.mul(vec4(cameraPosition, 1)).xyz;
      const direction = positionGeometry.sub(origin).normalize();
      // Box coordinates are non-uniformly scaled: use the actual lunar
      // ray, not the box-local vector, for surface-facing measurements.
      const lunarRay = direction.mul(vec3(...span.toArray())).normalize().toVar();
      const a = vec3(-0.5).sub(origin).div(direction), b = vec3(0.5).sub(origin).div(direction);
      const lower = a.min(b), upper = a.max(b);
      const entry = lower.x.max(lower.y).max(lower.z).max(0);
      const end = upper.x.min(upper.y).min(upper.z);
      entry.greaterThanEqual(end).discard();
      const rayScale = modelWorldMatrix.mul(vec4(direction, 0)).xyz.length().div(layout.radius);
      const canonicalRayScale = direction.mul(vec3(...span.toArray())).length();
      const jitter = screenCoordinate.xy.dot(vec2(12.9898, 78.233)).sin().mul(43758.5453).fract();
      const travelled = entry.add(jitter.mul(0.008).div(canonicalRayScale)).toVar();
      const p = origin.add(direction.mul(travelled)).toVar();
      const coverage = float(0).toVar();
      const coreCoverage = float(0).toVar();
      const radiance = vec3(0).toVar();
      const lightRadiance = vec3(0).toVar();
      Loop({ start: 0, end: 176, type: 'float', condition: '<' }, () => {
        If(travelled.greaterThanEqual(end), () => { Break(); });
        If(modelViewMatrix.mul(vec4(p, 1)).z.lessThan(viewDepth), () => { Break(); });
        const local = p.mul(vec3(...span.toArray())).add(vec3(...zone.offset))
          .div(controls.birth.mul(0.68).add(0.32));
        const radius = local.xy.div(vec2(...zone.axes)).length();
        const surface = surfaceFrame(local).toVar();
        const skinDistance = surface.w.max(0);
        const flow = field.flow(local).toVar();
        const fold = flow.x, source = flow.y, ink = flow.w;
        // A smooth analytic radius contains the optically thick cloud core.
        // The moving field still shades it and shapes all escaping matter;
        // it must not turn the clean inner arc into a stepped, wavy contour.
        const signedDensityDistance = surface.w;
        const opticalStep = signedDensityDistance.abs().mul(controls.birth.mul(0.68).add(0.32))
          .mul(0.55).clamp(0.008, 0.05).mul(rayScale.div(canonicalRayScale))
          .min(end.sub(travelled).mul(rayScale)).toVar();
        // The opaque eruption favours the outside of the crescent. The
        // central cavity carries only a little diffuse cloud shadow.
        const outward = local.xy.length().smoothstep(0.74, 1.04);
        // The dense body follows the actual lunar skin. Its thickness varies
        // with source activity; there is no separate circular source shell.
        const reach = source.mul(0.12).add(0.14)
          .mul(story.release.mul(0.25).sub(story.compression.mul(0.12)).add(1));
        const sourceBody = skinDistance.div(reach).pow(2).mul(-0.5).exp()
          .mul(surface.x.smoothstep(-0.85, 0.25).mul(0.65).add(0.35))
          .mul(source.mul(0.45).add(0.55)).mul(outward.mul(0.93).add(0.07));
        // A faint, off-centre eddy inside the luminous cavity belongs to the
        // same field, not another ring or an independently orbiting object.
        const innerEddy = local.sub(vec3(-0.2, 0.06, -0.06))
          .div(vec3(0.36, 0.31, 0.26)).length().pow(2).mul(-0.5).exp().mul(0.075);
        const radialBoundary = radius.smoothstep(zone.fade, zone.edge).oneMinus();
        const boundary = radialBoundary
          .mul(local.z.sub(zone.offset[2]).div(zone.depth).pow(2).mul(-0.5).exp());
        // The exact same fold/tint is evaluated on the displaced solid.
        const threshold = skinDistance.smoothstep(0.06, 0.55).mul(0.12).add(0.46);
        const clumps = fold.smoothstep(threshold, threshold.add(0.17));
        const arc = atan(local.y, local.x).abs().smoothstep(Math.PI - 0.20, Math.PI - 0.13).oneMinus();
        const core = signedDensityDistance.smoothstep(-0.012, 0.018).oneMinus()
          .mul(arc).mul(controls.coreDensity);
        // The same patches darken the solid skin and feed dense roots.
        // Turbulent folds erode the transition without severing that contact.
        const throat = skinDistance.div(0.09).negate().exp().mul(source)
          .mul(skinDistance.smoothstep(0.22, 0.40).oneMinus()).mul(arc)
          .mul(fold.smoothstep(0.32, 0.59).mul(0.72).add(0.28))
          .mul(radialBoundary).mul(controls.roots).mul(1.5)
          .mul(outward.mul(0.93).add(0.07));
        // A more dilute continuation of the SAME folds occupies the white
        // clearing. Shared billow/crease texture joins the source to torn
        // cloudlets; density varies through real depth instead of stamping
        // flat clouds or placing floating objects on a ring.
        const wispRadius = local.xy.div(vec2(...wispZone.axes)).length();
        const wispBorder = wispRadius.smoothstep(wispZone.fade, wispZone.edge).oneMinus();
        const driftDepth = ink.sub(0.5).mul(0.36).add(0.02);
        const wispDepth = local.z.sub(driftDepth).div(wispZone.depth).pow(2).mul(-0.5).exp();
        const wispReach = skinDistance.div(0.48).pow(2).mul(-0.5).exp()
          .mul(skinDistance.smoothstep(0.025, 0.18)).mul(outward.mul(0.85).add(0.15));
        // Some folds retain a charcoal core while thin stretched creases
        // disappear into the light. No constant-density grey veil is added.
        const torn = fold.smoothstep(0.48, 0.69);
        const cloudlets = torn.mul(wispReach).mul(wispDepth).mul(wispBorder)
          .mul(0.20).mul(controls.wisps).mul(story.wake.mul(0.35).add(1));
        const tips = field.tips(local).mul(fold.smoothstep(0.28, 0.60).mul(0.50).add(0.50))
          .mul(controls.flameTips).mul(controls.roots);
        const inkDensity = clumps.mul(sourceBody).add(innerEddy.mul(fold.smoothstep(0.4, 0.64)))
          .mul(boundary).add(throat).add(cloudlets).add(tips)
          .mul(controls.density).add(core).mul(controls.birth).mul(controls.strength).toVar();
        // A small amount of translucent gas redistributes light from the
        // actual moving rim openings. It shares the folded cloud texture;
        // opaque ink absorbs that light, and gaps remain transparent.
        const gas = fold.smoothstep(0.30, 0.64).mul(wispDepth).mul(wispBorder)
          .mul(skinDistance.div(0.48).pow(2).mul(-0.5).exp())
          .mul(0.85).mul(controls.scatter).mul(controls.birth).mul(controls.strength).toVar();
        const sourceLight = crescentContourRadiance(local, signedDensityDistance,
          field.surfaceNormal(local), lunarRay, matterClock)
          .mul(controls.contour).mul(controls.openings)
          .mul(story.cohesion).mul(controls.birth).mul(controls.strength).toVar();
        const transmission = inkDensity.mul(-0.85).exp();
        // A pale, swirling medium fills the open side of the analytic lunar
        // surface, almost to its inner edge. It occupies real depth and uses
        // the same moving folds; the opaque core still occludes it in orbit.
        const inside = local.xy.length().sub(surface.xy.length())
          .smoothstep(-0.015, 0.045).oneMinus();
        const cavityDepth = local.z.div(0.30).pow(2).mul(-0.5).exp()
          .mul(local.z.abs().smoothstep(0.42, 0.66).oneMinus());
        const cavityGas = inside.mul(cavityDepth)
          .mul(fold.smoothstep(0.28, 0.68).mul(0.85).add(0.35)).mul(1.65)
          .mul(transmission).mul(controls.cavityLight)
          .mul(story.cohesion).mul(controls.birth).mul(controls.strength).toVar();
        const cavityColor = color(0xf4f4fa)
          .mul(fold.smoothstep(0.30, 0.70).mul(0.70).add(1.05));
        // Thin gas scatters the recessed sources; dense ink extinguishes
        // them. Bright pockets accumulate behind whichever folds the ray
        // has already crossed, and stop at actual city/solid view depth.
        const illumination = sourceLight.mul(14).mul(transmission);
        const luminousGas = sourceLight.mul(flow.z.mul(0.45).add(0.55))
          .mul(transmission).mul(0.85).toVar();
        const density = inkDensity.add(gas).add(luminousGas).add(cavityGas);
        const alpha = density.mul(opticalStep).negate().exp().oneMinus();
        const sampleColor = field.tint(fold).mul(inkDensity)
          .add(color(0xf8f5ef).mul(0.12).mul(transmission).mul(gas)).div(density.max(0.0001));
        const sampleLight = color(0xf8f5ef).mul(illumination).mul(gas)
          .add(color(0xfffaf1).mul(luminousGas).mul(8))
          .add(cavityColor.mul(cavityGas)).div(density.max(0.0001));
        radiance.addAssign(sampleColor.mul(coverage.oneMinus()).mul(alpha));
        lightRadiance.addAssign(sampleLight.mul(coverage.oneMinus()).mul(alpha));
        coreCoverage.addAssign(coreCoverage.oneMinus().mul(core.mul(controls.birth)
          .mul(controls.strength).mul(opticalStep).negate().exp().oneMinus()));
        coverage.addAssign(coverage.oneMinus().mul(alpha));
        // Pale foreground gas can become opaque before reaching the core.
        // Finish the core mask before early exit, including at edge-on views.
        If(coverage.greaterThan(0.997).and(coreCoverage.greaterThan(0.995)), () => { Break(); });
        const step = opticalStep.div(rayScale);
        travelled.addAssign(step);
        p.addAssign(direction.mul(step));
      });
      // Actual ray-integrated core coverage replaces the old hidden-mesh
      // depth mask. Even from the side, foreground luminous gas cannot
      // paint a white shell across the optically thick black body.
      const exposedContour = coreCoverage.smoothstep(0.70, 0.985).oneMinus();
      return vec4(radiance.add(lightRadiance.mul(exposedContour))
        .div(coverage.max(0.0001)), coverage);
    })();
  };
  setDepth(float(-1e8));
  return { scene, mesh, material, controls, story, growth, finalFlow, setStory, field, surfaceActivity, surfaceFrame, setDepth,
    update: (visible: boolean, birth: number) => { mesh.visible = visible && birth > 0.001; controls.birth.value = birth; },
    dispose: () => { mesh.geometry.dispose(); material.dispose(); scene.clear(); },
  };
};
