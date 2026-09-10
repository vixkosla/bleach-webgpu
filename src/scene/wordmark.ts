import * as THREE from 'three/webgpu';
import { CITY_DECK_Y } from './constants';
import { createRandom, smootherstep } from '../utils/math';

export interface WordmarkController {
  group: THREE.Group;
  update: (time: number) => void;
}

const TITLE_TEXT = 'BLACK MOON';
const CREDIT_TEXT = 'SONICXBOY.DEV';
const ASSEMBLE_START = 0.25;
const ASSEMBLE_SPAN = 1.55;
// Hold the assembled wordmark a beat longer so the title is actually legible
// before the particles scatter into the city fly-through.
const SCATTER_START = 2.85;
const SCATTER_END = 4.2;
const MAX_PARTICLES = 5200;

const sampleGlyphs = (
  text: string,
  worldWidth: number,
  fontFamily: string,
  weight: number,
): Array<[number, number]> => {
  const canvas = document.createElement('canvas');
  canvas.width = 1600;
  canvas.height = 360;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return [];
  let fontSize = 220;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  do {
    context.font = `${weight} ${fontSize}px ${fontFamily}`;
    fontSize -= 6;
  } while (context.measureText(text).width > canvas.width * 0.9 && fontSize > 28);
  context.fillStyle = '#ffffff';
  context.fillText(text, canvas.width / 2, canvas.height / 2);

  const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const worldHeight = worldWidth * (canvas.height / canvas.width);
  const points: Array<[number, number]> = [];
  const step = text.length > 12 ? 4 : 3;
  for (let y = 0; y < canvas.height; y += step) {
    for (let x = 0; x < canvas.width; x += step) {
      if ((data[(y * canvas.width + x) * 4 + 3] ?? 0) > 110) {
        points.push([
          (x / canvas.width - 0.5) * worldWidth,
          -(y / canvas.height - 0.5) * worldHeight,
        ]);
      }
    }
  }
  return points;
};

export const createTitleWordmark = (): WordmarkController => {
  const group = new THREE.Group();
  group.name = 'black-moon-wordmark';
  group.position.set(0, CITY_DECK_Y + 18, 196);

  const sampled = [
    ...sampleGlyphs(TITLE_TEXT, 18, 'Georgia, "Times New Roman", serif', 400).map(
      (point): [number, number, 'title'] => [point[0], point[1], 'title'],
    ),
    ...sampleGlyphs(CREDIT_TEXT, 7.4, 'Inter, ui-sans-serif, system-ui, sans-serif', 650).map(
      (point): [number, number, 'credit'] => [point[0], (point[1] ?? 0) - 3.15, 'credit'],
    ),
  ];
  const count = Math.max(1, Math.min(sampled.length, MAX_PARTICLES));
  const random = createRandom(0xb1ac4e);

  const seeds = new Float32Array(count * 3);
  const targets = new Float32Array(count * 3);
  const scatters = new Float32Array(count * 3);
  const delays = new Float32Array(count);
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);

  const titleA = new THREE.Color(0x5b6cff);
  const titleB = new THREE.Color(0xe9edff);
  const creditA = new THREE.Color(0x9a6ad8);
  const creditB = new THREE.Color(0xf3e9ff);
  const mixed = new THREE.Color();
  const roles = new Array<'title' | 'credit'>(count).fill('title');

  for (let index = 0; index < count; index += 1) {
    const point = sampled[Math.floor((index * sampled.length) / count)] ?? [0, 0, 'title'];
    const role = point[2] === 'credit' ? 'credit' : 'title';
    roles[index] = role;
    seeds[index * 3] = (random() - 0.5) * 40;
    seeds[index * 3 + 1] = (random() - 0.5) * 16;
    seeds[index * 3 + 2] = (random() - 0.5) * 18;
    targets[index * 3] = point[0] ?? 0;
    targets[index * 3 + 1] = point[1] ?? 0;
    targets[index * 3 + 2] = (random() - 0.5) * 1.6;
    const theta = random() * Math.PI * 2;
    scatters[index * 3] = Math.cos(theta);
    scatters[index * 3 + 1] = (random() - 0.5) * 1.4 + 0.45;
    scatters[index * 3 + 2] = Math.sin(theta);
    delays[index] = random();
  }
  positions.set(seeds);

  const geometry = new THREE.BufferGeometry();
  const positionAttribute = new THREE.BufferAttribute(positions, 3);
  const colorAttribute = new THREE.BufferAttribute(colors, 3);
  geometry.setAttribute('position', positionAttribute);
  geometry.setAttribute('color', colorAttribute);

  const material = new THREE.PointsMaterial({
    size: 0.6,
    sizeAttenuation: true,
    vertexColors: true,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  group.add(points);

  return {
    group,
    update(time: number) {
      const alive = time < SCATTER_END + 0.35;
      group.visible = alive;
      if (!alive) return;
      const fade = 1 - smootherstep(SCATTER_START + 0.25, SCATTER_END, time);
      for (let index = 0; index < count; index += 1) {
        const delay = delays[index] ?? 0;
        const isCredit = roles[index] === 'credit';
        const assemble = smootherstep(
          ASSEMBLE_START + (isCredit ? 0.55 : 0) + delay * 0.45,
          ASSEMBLE_START + ASSEMBLE_SPAN + (isCredit ? 0.7 : 0) + delay * 0.35,
          time,
        );
        const scatter = smootherstep(
          SCATTER_START + (isCredit ? 0.35 : 0) + delay * 0.45,
          SCATTER_END + 0.2,
          time,
        );
        const offset = index * 3;
        const spread = scatter * (26 + delay * 58);
        positions[offset] =
          (seeds[offset] ?? 0) +
          ((targets[offset] ?? 0) - (seeds[offset] ?? 0)) * assemble +
          (scatters[offset] ?? 0) * spread;
        positions[offset + 1] =
          (seeds[offset + 1] ?? 0) +
          ((targets[offset + 1] ?? 0) - (seeds[offset + 1] ?? 0)) * assemble +
          (scatters[offset + 1] ?? 0) * spread;
        positions[offset + 2] =
          (seeds[offset + 2] ?? 0) +
          ((targets[offset + 2] ?? 0) - (seeds[offset + 2] ?? 0)) * assemble +
          (scatters[offset + 2] ?? 0) * spread;
        const strength = (0.45 + assemble * 0.55) * (1 - scatter) * fade;
        mixed
          .copy(isCredit ? creditA : titleA)
          .lerp(isCredit ? creditB : titleB, assemble)
          .multiplyScalar(strength * (isCredit ? 0.82 : 1));
        colors[offset] = mixed.r;
        colors[offset + 1] = mixed.g;
        colors[offset + 2] = mixed.b;
      }
      positionAttribute.needsUpdate = true;
      colorAttribute.needsUpdate = true;
    },
  };
};
