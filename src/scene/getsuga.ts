import * as THREE from 'three/webgpu';
import { createTypeGpuGlowMaterial } from '../materials/typegpuMaterials';
import { createRandom, pulse, smootherstep, smoothstep } from '../utils/math';
import { BEATS, MOON_Y, TOWER_Z } from './constants';

export interface GetsugaController {
  group: THREE.Group;
  update: (time: number) => void;
}

const createCloudTexture = (): THREE.CanvasTexture => {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not create cloud texture');

  const random = createRandom(0xc10d5);
  context.clearRect(0, 0, size, size);
  context.globalCompositeOperation = 'lighter';
  for (let index = 0; index < 38; index += 1) {
    const x = size * (0.22 + random() * 0.56);
    const y = size * (0.25 + random() * 0.5);
    const radius = size * (0.07 + random() * 0.17);
    const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
    const alpha = 0.05 + random() * 0.1;
    gradient.addColorStop(0, `rgba(255,255,255,${alpha})`);
    gradient.addColorStop(0.45, `rgba(220,228,255,${alpha * 0.72})`);
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    context.fillStyle = gradient;
    context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
};

const createHaloTexture = (): THREE.CanvasTexture => {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not create halo texture');
  const gradient = context.createRadialGradient(128, 128, 6, 128, 128, 128);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.24, 'rgba(240,245,255,.86)');
  gradient.addColorStop(0.52, 'rgba(205,218,255,.28)');
  gradient.addColorStop(1, 'rgba(180,200,255,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
};

const createAnnularRingGeometry = (): THREE.TorusGeometry =>
  new THREE.TorusGeometry(30.4, 2.7, 22, 160);

export const createGetsuga = (): GetsugaController => {
  const group = new THREE.Group();
  group.name = 'getsuga-event';
  group.position.set(0, MOON_Y, TOWER_Z);

  const haloMaterial = new THREE.SpriteMaterial({
    map: createHaloTexture(),
    color: 0xdce6ff,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const halo = new THREE.Sprite(haloMaterial);
  halo.scale.set(132, 132, 1);
  halo.position.z = -3;
  group.add(halo);

  const coreGlow = createTypeGpuGlowMaterial(0xf4f6ff, 0);
  const core = new THREE.Mesh(new THREE.CircleGeometry(27.2, 96), coreGlow.material);
  core.position.z = 0;
  group.add(core);

  const ringMaterial = new THREE.MeshStandardMaterial({
    color: 0x05060a,
    roughness: 0.42,
    metalness: 0.22,
    transparent: true,
    opacity: 0,
  });
  const ring = new THREE.Mesh(createAnnularRingGeometry(), ringMaterial);
  ring.position.z = 1.2;
  group.add(ring);

  const innerShadowMaterial = new THREE.MeshBasicMaterial({
    color: 0x000000,
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
  });
  const innerShadow = new THREE.Mesh(new THREE.RingGeometry(24.6, 27.8, 96), innerShadowMaterial);
  innerShadow.position.z = 0.6;
  group.add(innerShadow);

  const rimMaterial = new THREE.MeshBasicMaterial({
    color: 0xf5f7ff,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const shockRing = new THREE.Mesh(new THREE.TorusGeometry(35, 0.55, 8, 128), rimMaterial);
  shockRing.position.z = -1;
  group.add(shockRing);

  const cloudTexture = createCloudTexture();
  const clouds: Array<{
    sprite: THREE.Sprite;
    angle: number;
    radius: number;
    depth: number;
    scale: number;
    speed: number;
  }> = [];
  const random = createRandom(0x45defe);
  for (let index = 0; index < 52; index += 1) {
    const material = new THREE.SpriteMaterial({
      map: cloudTexture,
      color: index % 5 === 0 ? 0x1a2233 : 0x8b96b0,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: index % 4 === 0 ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    const sprite = new THREE.Sprite(material);
    const scale = 22 + random() * 40;
    sprite.scale.set(scale * (1.4 + random()), scale * (0.38 + random() * 0.42), 1);
    sprite.renderOrder = index % 4 === 0 ? 3 : 1;
    group.add(sprite);
    clouds.push({
      sprite,
      angle: (index / 52) * Math.PI * 2 + random() * 0.18,
      radius: 34 + random() * 58,
      depth: -22 + random() * 32,
      scale,
      speed: 0.18 + random() * 0.55,
    });
  }

  const particleCount = 780;
  const particlePositions = new Float32Array(particleCount * 3);
  const particleBase = new Float32Array(particleCount * 3);
  const particleVelocity = new Float32Array(particleCount * 3);
  for (let index = 0; index < particleCount; index += 1) {
    const angle = random() * Math.PI * 2;
    const radius = 24 + random() * 54;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius * 0.72;
    const z = -12 + random() * 28;
    particlePositions.set([x, y, z], index * 3);
    particleBase.set([x, y, z], index * 3);
    const velocity = 6 + random() * 38;
    particleVelocity.set([
      Math.cos(angle) * velocity,
      Math.sin(angle) * velocity * 0.65,
      (random() - 0.5) * 13,
    ], index * 3);
  }
  const particleGeometry = new THREE.BufferGeometry();
  particleGeometry.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
  const particleMaterial = new THREE.PointsMaterial({
    color: 0xe5eaff,
    size: 0.72,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const particles = new THREE.Points(particleGeometry, particleMaterial);
  group.add(particles);

  group.scale.setScalar(0.05);

  return {
    group,
    update(time: number) {
      const birth = smootherstep(BEATS.impact - 0.2, BEATS.moonBirth + 2.8, time);
      const settle = smootherstep(BEATS.moonBirth + 2, BEATS.scaleReveal + 2.4, time);
      const shock = smoothstep(BEATS.impact, BEATS.impact + 1.7, time);
      const shockFade = 1 - smoothstep(BEATS.impact + 0.5, BEATS.impact + 3.1, time);
      const scale = Math.max(0.05, 0.25 + birth * 1.2 - settle * 0.1);
      group.scale.setScalar(scale);
      group.rotation.z = (1 - birth) * -0.28;

      coreGlow.setAlpha(Math.min(1, birth * 1.35));
      ringMaterial.opacity = birth;
      innerShadowMaterial.opacity = birth * 0.72;
      haloMaterial.opacity = Math.min(0.92, birth * 1.5) * (0.8 + pulse(BEATS.moonBirth + 1.3, 2.4, time) * 0.2);
      halo.scale.setScalar(115 + birth * 26 + Math.sin(time * 1.4) * 3);
      rimMaterial.opacity = shock * shockFade * 0.9;
      shockRing.scale.setScalar(0.18 + shock * 3.4);

      const cloudExpansion = 0.48 + birth * 0.82 + settle * 0.12;
      clouds.forEach((cloud, index) => {
        const radius = cloud.radius * cloudExpansion + Math.sin(time * cloud.speed + index) * 2.2;
        const angle = cloud.angle + (1 - settle) * 0.12 * Math.sin(time * 0.3 + cloud.angle);
        cloud.sprite.position.set(
          Math.cos(angle) * radius,
          Math.sin(angle) * radius * 0.66,
          cloud.depth,
        );
        const material = cloud.sprite.material;
        material.opacity = birth * (0.18 + (index % 5) * 0.045) * (1 - pulse(BEATS.impact + 0.3, 0.7, time) * 0.8);
        const breathing = 1 + Math.sin(time * cloud.speed + index * 1.7) * 0.06;
        cloud.sprite.scale.set(cloud.scale * 1.9 * breathing, cloud.scale * 0.72 * breathing, 1);
      });

      const elapsed = Math.max(0, time - BEATS.impact);
      const particleAlpha = birth * (1 - smoothstep(BEATS.scaleReveal + 1, BEATS.finalHold, time) * 0.55);
      particleMaterial.opacity = particleAlpha * 0.78;
      particleMaterial.size = 0.5 + shockFade * 1.35;
      for (let index = 0; index < particleCount; index += 1) {
        const offset = index * 3;
        particlePositions[offset] = (particleBase[offset] ?? 0) + (particleVelocity[offset] ?? 0) * elapsed * 0.16;
        particlePositions[offset + 1] = (particleBase[offset + 1] ?? 0) + (particleVelocity[offset + 1] ?? 0) * elapsed * 0.16;
        particlePositions[offset + 2] = (particleBase[offset + 2] ?? 0) + (particleVelocity[offset + 2] ?? 0) * elapsed * 0.16;
      }
      const attribute = particleGeometry.getAttribute('position');
      attribute.needsUpdate = true;
    },
  };
};
