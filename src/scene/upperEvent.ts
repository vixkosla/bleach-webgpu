import * as THREE from 'three/webgpu';
import type { MatterStoryPose } from '../cinematic/MatterStoryState';
import { atan, attribute, color, mix, positionGeometry, uniform } from 'three/tsl';
import { createUpperClouds } from './upperClouds';
import { createUpperGetsugaMatter } from './upperGetsugaMatter';
import { createCitadelCrossLight } from './citadelCrossLight';
import { createRoundedCrescentGeometry } from './upperCrescent';
import { crescentRadiance } from './crescentLight';
import { BEATS, FILM_DURATION } from './constants';
import { pulse, smootherstep, smoothstep } from '../utils/math';

// Blockout of the supplied black-crescent / illuminated-cloud reference.
// Own scene, materials and timeline: never put these meshes into the city's
// normal/emissive MRT (where emission is also an AO art-direction mask).
export const UPPER_BEATS = [
  { label: 'CHARGE', time: 13.8 },
  { label: 'RELEASE', time: 15.65 },
  { label: 'OPENING', time: 17.8 },
  { label: 'HOLD', time: 21.8 },
] as const;

export const sampleUpperEvent = (input: number) => {
  const time = Math.max(0, Math.min(FILM_DURATION, Number.isFinite(input) ? input : 0));
  const birth = smootherstep(BEATS.impact, BEATS.moonBirth + 2.8, time);
  const charge = smoothstep(BEATS.anticipation, BEATS.impact - 0.3, time)
    * (1 - smoothstep(BEATS.impact, BEATS.impact + 0.65, time));
  const shock = pulse(BEATS.impact + 0.65, 0.65, time);
  const opening = smootherstep(BEATS.moonBirth, BEATS.scaleReveal, time);
  return { time, birth, charge, shock, opening,
    visible: time > BEATS.anticipation,
    scale: 0.32 + birth * 0.68,
    cloud: Math.max(charge * 0.35, birth * 0.9),
  };
};

export const createUpperLayout = (crown: THREE.Vector3, citadelOrientation = new THREE.Quaternion()) => {
  const radius = 200;
  // Old MOON_Y predates the 1.62x citadel scale and is now INSIDE the tower.
  // Anchor to actual world-space bounds, not another guessed deck offset.
  const orientation = citadelOrientation.clone();
  const center = crown.clone().add(new THREE.Vector3(0, radius + 48, 0).applyQuaternion(orientation));
  return { crown: crown.clone(), center, radius, orientation };
};

export type UpperEventLayout = ReturnType<typeof createUpperLayout>;

/** Weather and matter have independent lifecycles at a fixed world scale. */
export interface UpperAtmosphereCue {
  matter?: Readonly<MatterStoryPose>;
  storyTime?: number;
  presence: number;
  illumination: number;
  atmosphereLight?: number;
  cloudOpacity: number;
  distantTime: number;
}

// Small charge-column texture, generated without a canvas/network dependency.
const createSoftTexture = (): THREE.DataTexture => {
  const size = 128;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
    const u = x / (size - 1) * 2 - 1;
    const v = y / (size - 1) * 2 - 1;
    const offset = (y * size + x) * 4;
    data[offset] = data[offset + 1] = data[offset + 2] = 255;
    data[offset + 3] = Math.round(255 * (1 - smoothstep(0.38, 1, Math.hypot(u, v))));
  }
  const texture = new THREE.DataTexture(data, size, size);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
};

export const createUpperEvent = (crown: THREE.Vector3, citadelOrientation = new THREE.Quaternion()) => {
  const layout = createUpperLayout(crown, citadelOrientation);
  const scene = new THREE.Scene();
  scene.name = 'upper-event-layer';
  const group = new THREE.Group();
  group.name = 'upper-event-container';
  scene.add(group);
  const materials: THREE.MeshBasicNodeMaterial[] = [];
  const material = (color: number, map?: THREE.Texture) => {
    const result = new THREE.MeshBasicNodeMaterial({
      color, map: map ?? null, side: THREE.DoubleSide, transparent: true,
      depthWrite: false, fog: false, opacity: 0,
    });
    materials.push(result);
    return result;
  };
  const glowTexture = createSoftTexture();
  const plane = new THREE.PlaneGeometry(1, 1);
  const clouds = createUpperClouds(layout, material);
  const matter = createUpperGetsugaMatter(layout, clouds.noise, clouds.volume.detailTexture, clouds.motionTime);
  const crossLight = createCitadelCrossLight(layout, clouds.motionTime);
  group.add(clouds.root);
  const event = new THREE.Group();
  event.name = 'upper-getsuga-form';
  event.position.copy(layout.center);
  // The moon continues the citadel's axis, independently of the storm's tilt.
  event.quaternion.copy(layout.orientation);
  group.add(event);

  const crescentMaterial = new THREE.MeshBasicNodeMaterial({
    color: 0x010103, side: THREE.FrontSide, transparent: true,
    depthWrite: true, fog: false, opacity: 0,
  });
  crescentMaterial.name = 'upper-solid-black-crescent';
  const skin = matter.field.surface(positionGeometry).xyz;
  const skinFlow = matter.field.flow(skin);
  crescentMaterial.positionNode = skin;
  crescentMaterial.colorNode = matter.field.tint(skinFlow.x)
    .mul(skinFlow.y.mul(matter.controls.roots).mul(matter.controls.strength).mul(-0.22).add(1));
  materials.push(crescentMaterial);
  const crescent = new THREE.Mesh(createRoundedCrescentGeometry(), crescentMaterial);
  crescent.name = 'upper-black-crescent';
  // Kept only as a canonical framing/debug guide. All visible lunar matter,
  // including the opaque core, is integrated by the single density volume.
  crescent.visible = false;
  crescent.scale.setScalar(layout.radius);
  event.add(crescent);

  // An expanded back-facing copy exposes only its silhouette around the
  // black body, from any orbit angle. A separate solid-depth mask also
  // suppresses near-tip glow over a far black lobe. Both meshes share the same
  // rounded 3D crescent; this is not a light card or a camera-facing decal.
  const haloPadding = 0.060, haloLight = uniform(8.0);
  const haloMaterial = new THREE.MeshBasicNodeMaterial({
    side: THREE.BackSide, transparent: true, depthWrite: false,
    depthTest: true, fog: false, opacity: 0,
  });
  haloMaterial.name = 'upper-crescent-volume-halo';
  const energy = crescentRadiance(atan(positionGeometry.y, positionGeometry.x), clouds.motionTime);
  // Displace only the luminous shell. A source's OFF plateau has neither
  // expansion nor emission; replacement patches share this same field.
  haloMaterial.positionNode = mix(attribute('crescentBodyPosition', 'vec3'), positionGeometry,
    energy);
  haloMaterial.colorNode = color(0xfffaf0).mul(haloLight).mul(energy);
  materials.push(haloMaterial);
  const halo = new THREE.Mesh(createRoundedCrescentGeometry(haloPadding), haloMaterial);
  halo.geometry.setAttribute('crescentBodyPosition', crescent.geometry.getAttribute('position').clone());
  halo.name = 'upper-crescent-luminous-contour';
  // Temporarily removed at the user's request while the surrounding white
  // field and cloud composition are developed. Keep the authored geometry
  // available, but do not draw a white outline or feed its bloom pass.
  halo.visible = false;
  halo.scale.copy(crescent.scale);
  halo.rotation.copy(crescent.rotation);
  halo.renderOrder = 1;
  const haloScene = new THREE.Scene(); haloScene.name = 'upper-halo-layer';
  const haloRoot = new THREE.Group(); haloRoot.matrixAutoUpdate = false;
  haloRoot.add(halo); haloScene.add(haloRoot);


  const chargeMaterial = material(0xddd4fa, glowTexture);
  chargeMaterial.color.multiplyScalar(2);
  const chargeColumn = new THREE.Mesh(plane, chargeMaterial);
  chargeColumn.name = 'upper-crown-charge-axis';
  const columnHeight = layout.center.y - layout.radius * 0.7 - crown.y;
  chargeColumn.position.copy(crown).add(new THREE.Vector3(0, columnHeight * 0.5, 4));
  chargeColumn.scale.set(15, columnHeight * 1.3, 1);
  group.add(chargeColumn);

  const shockMaterial = material(0xdddce7);
  const shock = new THREE.Mesh(new THREE.RingGeometry(1, 1.012, 112), shockMaterial);
  shock.name = 'upper-release-front';
  shock.position.copy(layout.center);
  shock.quaternion.copy(event.quaternion);
  group.add(shock);

  let state = sampleUpperEvent(0);
  let motion = 0;
  const update = (time: number, motionTime = time, cue?: UpperAtmosphereCue): void => {
    state = sampleUpperEvent(time);
    if (cue) state = { ...state, visible: true, birth: cue.presence,
      charge: 0, shock: 0, scale: 1, cloud: cue.cloudOpacity };
    motion = Number.isFinite(motionTime) ? motionTime : 0;
    group.visible = state.visible;
    clouds.update(motion, state.birth, state.charge, state.opening, state.cloud, cue);
    matter.setStory(cue?.matter);
    matter.update(cue ? (cue.matter ? cue.matter.assembly > 0 : cue.presence > .001) : state.visible, cue ? 1 : state.birth);
    // The authored dense plate grows about its lower world-space attachment.
    // Preserve the historical cue/inspector contract when no story is supplied.
    matter.material.opacity = cue && !cue.matter ? cue.presence : 1;
    crossLight.update(state.visible, cue ? cue.illumination : state.birth);
    event.scale.setScalar(state.scale);
    crescentMaterial.opacity = state.birth;
    halo.rotation.copy(crescent.rotation);
    event.updateWorldMatrix(true, false);
    haloRoot.matrix.copy(event.matrixWorld);
    haloRoot.matrixWorldNeedsUpdate = true;
    haloRoot.visible = state.visible;
    haloMaterial.opacity = state.birth;
    haloLight.value = 8.0;
    chargeMaterial.opacity = state.charge * 0.82 + state.shock * 0.3;
    shockMaterial.opacity = state.shock * 0.45;
    shock.scale.setScalar(layout.radius * (0.5 + smoothstep(BEATS.impact, BEATS.impact + 1.3, state.time) * 1.7));
    group.userData.phase = { ...state };
    group.userData.motionTime = motion;
  };
  update(0);

  return { scene, group, materials, layout, clouds, matter, crossLight, update, halo: { scene: haloScene, mesh: halo, padding: haloPadding, light: haloLight, radiance: energy },
    get state() { return state; },
    get motionTime() { return motion; },
    dispose() {
      const geometries = new Set<THREE.BufferGeometry>();
      group.traverse(object => { if (object instanceof THREE.Mesh) geometries.add(object.geometry); });
      geometries.add(halo.geometry);
      geometries.forEach(geometry => geometry.dispose());
      materials.forEach(value => value.dispose());
      glowTexture.dispose();
      matter.dispose();
      clouds.dispose();
      group.clear();
      haloScene.clear();
      scene.clear();
    },
  };
};

export type UpperEventController = ReturnType<typeof createUpperEvent>;
