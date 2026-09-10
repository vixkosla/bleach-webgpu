import * as THREE from 'three/webgpu';
import { BEATS, CITY_DECK_Y, TOWER_Z } from './constants';
import { smoothstep } from '../utils/math';

export interface LightningController {
  group: THREE.Group;
  update: (time: number) => void;
}

const BOLT_COUNT = 9;
const SUBDIVISIONS = 5;
const MAX_POINTS = 2 ** SUBDIVISIONS + 1;

interface Bolt {
  line: THREE.Line;
  glowLine: THREE.Line;
  material: THREE.LineBasicMaterial;
  glowMaterial: THREE.LineBasicMaterial;
  geometry: THREE.BufferGeometry;
  attribute: THREE.BufferAttribute;
  positions: Float32Array;
  timer: number;
  lit: boolean;
}

const createChargeHaloTexture = (): THREE.CanvasTexture => {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Unable to create charge halo');
  const gradient = context.createRadialGradient(128, 128, 8, 128, 128, 128);
  gradient.addColorStop(0, 'rgba(236,232,255,0.85)');
  gradient.addColorStop(0.38, 'rgba(168,132,255,0.5)');
  gradient.addColorStop(0.72, 'rgba(104,70,210,0.18)');
  gradient.addColorStop(1, 'rgba(60,36,140,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 256, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
};

// Midpoint-displacement arcs: cheap to rebuild every strike and read well at
// the long focal lengths used during the anticipation beat.
const regenerateBolt = (bolt: Bolt): void => {
  const angle = Math.random() * Math.PI * 2;
  const radius = 15 + Math.random() * 15;
  const start = new THREE.Vector3(
    Math.cos(angle) * radius,
    44 + Math.random() * 62,
    Math.sin(angle) * radius,
  );
  const end = new THREE.Vector3(
    0.4 + (Math.random() - 0.5) * 3.2,
    124 + (Math.random() - 0.5) * 3.2,
    6 + (Math.random() - 0.5) * 3.2,
  );

  let path: THREE.Vector3[] = [start, end];
  let roughness = 0.42;
  for (let level = 0; level < SUBDIVISIONS; level += 1) {
    const next: THREE.Vector3[] = [];
    for (let index = 0; index < path.length - 1; index += 1) {
      const a = path[index];
      const b = path[index + 1];
      if (!a || !b) continue;
      const mid = a.clone().add(b).multiplyScalar(0.5);
      const direction = b.clone().sub(a);
      const length = direction.length();
      if (length > 1e-5) {
        const jitter = new THREE.Vector3(
          Math.random() - 0.5,
          Math.random() - 0.5,
          Math.random() - 0.5,
        ).cross(direction.normalize());
        if (jitter.lengthSq() > 1e-8) {
          mid.addScaledVector(jitter.normalize(), (Math.random() - 0.5) * length * roughness);
        }
      }
      next.push(a, mid);
    }
    const last = path[path.length - 1];
    if (last) next.push(last);
    path = next;
    roughness *= 0.55;
  }

  const used = Math.min(path.length, MAX_POINTS);
  for (let index = 0; index < used; index += 1) {
    const point = path[index];
    if (!point) continue;
    bolt.positions[index * 3] = point.x;
    bolt.positions[index * 3 + 1] = point.y;
    bolt.positions[index * 3 + 2] = point.z;
  }
  bolt.geometry.setDrawRange(0, used);
  bolt.attribute.needsUpdate = true;
};

export const createChargeLightning = (): LightningController => {
  const group = new THREE.Group();
  group.name = 'wahr-welt-charge-lightning';
  group.position.set(0, CITY_DECK_Y, TOWER_Z);
  group.visible = false;

  const bolts: Bolt[] = [];
  for (let index = 0; index < BOLT_COUNT; index += 1) {
    const positions = new Float32Array(MAX_POINTS * 3);
    const geometry = new THREE.BufferGeometry();
    const attribute = new THREE.BufferAttribute(positions, 3);
    geometry.setAttribute('position', attribute);
    const material = new THREE.LineBasicMaterial({
      color: index % 3 === 0 ? 0xdde6ff : 0x9fb4ff,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const line = new THREE.Line(geometry, material);
    line.frustumCulled = false;
    line.visible = false;
    group.add(line);
    // Second additive pass over the same geometry fakes a thicker, hotter core.
    const glowMaterial = new THREE.LineBasicMaterial({
      color: 0x7d95ff,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const glowLine = new THREE.Line(geometry, glowMaterial);
    glowLine.frustumCulled = false;
    glowLine.visible = false;
    group.add(glowLine);
    bolts.push({
      line,
      glowLine,
      material,
      glowMaterial,
      geometry,
      attribute,
      positions,
      timer: index * 0.08,
      lit: false,
    });
  }

  const flash = new THREE.PointLight(0xbcd0ff, 0, 460, 1.9);
  flash.position.set(0.4, 124, 6);
  group.add(flash);

  // The drain in tower.ts blacks out the citadel during the charge; these two
  // carry the beat instead — a ramping violet glow plus strike flicker.
  const chargeLight = new THREE.PointLight(0x9a6bff, 0, 340, 1.8);
  chargeLight.position.set(0, 118, 6);
  group.add(chargeLight);

  const haloMaterial = new THREE.SpriteMaterial({
    map: createChargeHaloTexture(),
    color: 0xb7a6ff,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    toneMapped: false,
  });
  const halo = new THREE.Sprite(haloMaterial);
  halo.name = 'wahr-welt-charge-halo';
  halo.position.set(0, 108, -10);
  halo.scale.set(130, 210, 1);
  group.add(halo);

  let lastTime = 0;

  return {
    group,
    update(time: number) {
      const charge =
        smoothstep(BEATS.anticipation, BEATS.anticipation + 2.4, time) *
        (1 - smoothstep(BEATS.impact, BEATS.impact + 0.22, time));
      const delta = Math.min(0.1, Math.max(0, time - lastTime));
      lastTime = time;
      group.visible = charge > 0.01;
      if (!group.visible) return;

      let litCount = 0;
      for (const bolt of bolts) {
        bolt.timer -= delta;
        if (bolt.timer <= 0) {
          if (bolt.lit) {
            bolt.lit = false;
            bolt.line.visible = false;
            bolt.glowLine.visible = false;
            bolt.timer = 0.03 + Math.random() * (0.55 / Math.max(0.25, charge));
          } else {
            regenerateBolt(bolt);
            bolt.lit = true;
            bolt.line.visible = true;
            bolt.glowLine.visible = true;
            bolt.timer = 0.05 + Math.random() * 0.12;
          }
        }
        if (bolt.lit) {
          litCount += 1;
          const opacity = charge * (0.6 + Math.random() * 0.4);
          bolt.material.opacity = opacity;
          bolt.glowMaterial.opacity = opacity * 0.85;
        }
      }
      const flicker = 0.6 + Math.random() * 0.4;
      flash.intensity = charge * litCount * 120 * flicker;
      chargeLight.intensity = charge * charge * 150 * (0.75 + Math.random() * 0.25);
      haloMaterial.opacity = charge * (0.16 + 0.14 * flicker);
    },
  };
};
