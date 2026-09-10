import * as THREE from 'three/webgpu';
import { BEATS, CITY_DECK_Y, FILM_DURATION, TOWER_Z } from './constants';
import { createRandom, smoothstep } from '../utils/math';

export interface EmbersController {
  group: THREE.Group;
  update: (time: number) => void;
}

const COUNT = 700;
const FIELD_RADIUS = 250;
const RISE_BOTTOM = CITY_DECK_Y - 26;
const RISE_TOP = CITY_DECK_Y + 150;

export const createEmberFallout = (): EmbersController => {
  const group = new THREE.Group();
  group.name = 'wahr-welt-ember-fallout';
  group.position.set(0, 0, TOWER_Z);
  group.visible = false;

  const random = createRandom(0xefe4a1);
  const positions = new Float32Array(COUNT * 3);
  const baseX = new Float32Array(COUNT);
  const baseZ = new Float32Array(COUNT);
  const speeds = new Float32Array(COUNT);
  const phases = new Float32Array(COUNT);
  const sways = new Float32Array(COUNT);

  for (let index = 0; index < COUNT; index += 1) {
    const radius = 24 + Math.pow(random(), 0.62) * (FIELD_RADIUS - 24);
    const angle = random() * Math.PI * 2;
    baseX[index] = Math.cos(angle) * radius;
    baseZ[index] = Math.sin(angle) * radius;
    positions[index * 3] = baseX[index] ?? 0;
    positions[index * 3 + 1] = RISE_BOTTOM + random() * (RISE_TOP - RISE_BOTTOM);
    positions[index * 3 + 2] = baseZ[index] ?? 0;
    speeds[index] = 1.6 + random() * 4.2;
    phases[index] = random() * Math.PI * 2;
    sways[index] = 0.6 + random() * 1.8;
  }

  const geometry = new THREE.BufferGeometry();
  const attribute = new THREE.BufferAttribute(positions, 3);
  geometry.setAttribute('position', attribute);

  const material = new THREE.PointsMaterial({
    color: 0x9fb0ff,
    size: 0.85,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  group.add(points);

  let lastTime = 0;

  return {
    group,
    update(time: number) {
      const envelope =
        smoothstep(BEATS.moonBirth + 0.5, BEATS.moonBirth + 3.4, time) *
        (1 - smoothstep(FILM_DURATION - 1.6, FILM_DURATION, time) * 0.45);
      const delta = Math.min(0.1, Math.max(0, time - lastTime));
      lastTime = time;
      group.visible = envelope > 0.012;
      if (!group.visible) return;

      material.opacity = envelope * 0.72;
      for (let index = 0; index < COUNT; index += 1) {
        const offset = index * 3;
        let height = (positions[offset + 1] ?? 0) + (speeds[index] ?? 1) * delta;
        if (height > RISE_TOP) height = RISE_BOTTOM;
        const wave = time * (0.35 + (speeds[index] ?? 1) * 0.09) + (phases[index] ?? 0);
        positions[offset] = (baseX[index] ?? 0) + Math.sin(wave) * (sways[index] ?? 1) * 2.6;
        positions[offset + 1] = height;
        positions[offset + 2] = (baseZ[index] ?? 0) + Math.cos(wave * 0.83) * (sways[index] ?? 1) * 2.2;
      }
      attribute.needsUpdate = true;
    },
  };
};
