import * as THREE from 'three/webgpu';
import { createGrowthTexture } from './city';
import {
  createArchitecturalToonMaterial,
  createTypeGpuCitadelMaterial,
  createTypeGpuGlowMaterial,
} from '../materials/typegpuMaterials';
import { smoothstep } from '../utils/math';
import { BEATS, CITY_DECK_Y, TOWER_Z } from './constants';

export interface TowerController {
  group: THREE.Group;
  update: (time: number) => void;
}

interface GrowthRidge {
  x0: number;
  x1: number;
  y: number;
  z: number;
  count: number;
  seed: number;
}

const addBox = (
  parent: THREE.Group,
  material: THREE.Material,
  width: number,
  height: number,
  depth: number,
  x: number,
  y: number,
  z: number,
  rotationY = 0,
  rotationZ = 0,
): THREE.Mesh => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
  mesh.position.set(x, y, z);
  mesh.rotation.set(0, rotationY, rotationZ);
  parent.add(mesh);
  return mesh;
};

const hash = (value: number): number => {
  const wave = Math.sin(value * 12.9898 + 78.233) * 43758.5453;
  return wave - Math.floor(wave);
};

// The reference spires are pointed obelisks, not blunt posts: a masonry shaft
// carrying a sharp four-sided tip.
const addSpire = (
  parent: THREE.Group,
  material: THREE.Material,
  x: number,
  z: number,
  baseY: number,
  height: number,
  width = 4,
): void => {
  const shaftHeight = height * 0.72;
  addBox(parent, material, width, shaftHeight + 0.6, width * 1.15, x, baseY + shaftHeight * 0.5, z);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(width * 0.62, height - shaftHeight, 4), material);
  tip.position.set(x, baseY + shaftHeight + (height - shaftHeight) * 0.5, z);
  tip.rotation.y = Math.PI * 0.25;
  parent.add(tip);
};

const createCastleHaloTexture = (): THREE.CanvasTexture => {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Unable to create Wahr Welt castle halo');
  const gradient = context.createRadialGradient(128, 128, 12, 128, 128, 128);
  gradient.addColorStop(0, 'rgba(255,248,255,0.75)');
  gradient.addColorStop(0.42, 'rgba(227,204,255,0.55)');
  gradient.addColorStop(0.7, 'rgba(172,123,226,0.22)');
  gradient.addColorStop(1, 'rgba(105,64,170,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 256, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
};

const addSlitRow = (
  parent: THREE.Group,
  material: THREE.Material,
  centerX: number,
  width: number,
  y: number,
  z: number,
  height: number,
  count: number,
): void => {
  const spacing = width / (count + 1);
  for (let index = 0; index < count; index += 1) {
    const uneven = hash(index + y * 0.17);
    const openingWidth = Math.max(1.15, Math.min(2.15, width / (count * 5.8)));
    addBox(
      parent,
      material,
      openingWidth * (0.9 + uneven * 0.1),
      height * (0.9 + uneven * 0.1),
      0.55,
      centerX - width * 0.5 + spacing * (index + 1),
      y - (1 - uneven) * height * 0.06,
      z,
    );
  }
};

const addFramedRecess = (
  parent: THREE.Group,
  frameMaterial: THREE.Material,
  recessMaterial: THREE.Material,
  centerX: number,
  centerY: number,
  frontZ: number,
  width: number,
  height: number,
  frameDepth = 3.4,
  recessDepth = 7,
): void => {
  const jamb = Math.max(2.1, width * 0.13);
  const lintel = Math.max(2.4, height * 0.1);
  const surroundDepth = frameDepth + recessDepth;
  const surroundZ = frontZ - recessDepth * 0.5 + frameDepth * 0.5;
  addBox(parent, recessMaterial, width, height, 0.9, centerX, centerY, frontZ - recessDepth);
  addBox(
    parent,
    frameMaterial,
    jamb,
    height + lintel,
    surroundDepth,
    centerX - width * 0.5 - jamb * 0.5,
    centerY + lintel * 0.25,
    surroundZ,
  );
  addBox(
    parent,
    frameMaterial,
    jamb,
    height + lintel,
    surroundDepth,
    centerX + width * 0.5 + jamb * 0.5,
    centerY + lintel * 0.25,
    surroundZ,
  );
  addBox(
    parent,
    frameMaterial,
    width + jamb * 2,
    lintel,
    surroundDepth,
    centerX,
    centerY + height * 0.5 + lintel * 0.5,
    surroundZ,
  );
};

const addGrowth = (
  parent: THREE.Group,
  ridges: GrowthRidge[],
  material: THREE.MeshToonNodeMaterial,
): void => {
  const shardTransforms: Array<{
    position: THREE.Vector3;
    scale: THREE.Vector3;
    rotation: THREE.Euler;
  }> = [];
  const chunkTransforms: Array<{
    position: THREE.Vector3;
    scale: THREE.Vector3;
    rotation: THREE.Euler;
  }> = [];

  for (const ridge of ridges) {
    for (let index = 0; index < ridge.count; index += 1) {
      const u = (index + 0.5) / ridge.count;
      const noise = hash(ridge.seed * 19 + index * 7.17);
      const secondNoise = hash(ridge.seed * 37 + index * 3.41);
      const hasShard = noise > 0.78;
      const hasChunk = secondNoise > 0.66;
      if (!hasShard && !hasChunk) continue;
      const height = 0.8 + noise * 3.1;
      const radius = 0.46 + secondNoise * 0.76;
      const x = THREE.MathUtils.lerp(ridge.x0, ridge.x1, u) + (noise - 0.5) * 0.55;
      const z = ridge.z + (secondNoise - 0.5) * 1.2;

      if (hasShard) {
        shardTransforms.push({
          position: new THREE.Vector3(x, ridge.y + height * 0.5, z),
          scale: new THREE.Vector3(radius, height, radius),
          rotation: new THREE.Euler(0, noise * Math.PI, (secondNoise - 0.5) * 0.34),
        });
      }

      if (hasShard && index % 2 === 1 && secondNoise > 0.76) {
        const hangLength = 1.8 + secondNoise * 5.2;
        shardTransforms.push({
          position: new THREE.Vector3(x + (noise - 0.5) * 0.7, ridge.y - hangLength * 0.5, z + 0.15),
          scale: new THREE.Vector3(radius * 0.76, hangLength, radius * 0.76),
          rotation: new THREE.Euler(0, secondNoise * Math.PI, Math.PI + (noise - 0.5) * 0.22),
        });
      }

      if (hasChunk) {
        chunkTransforms.push({
          position: new THREE.Vector3(x, ridge.y + 0.02, z - 0.08),
          scale: new THREE.Vector3(1.7 + noise * 2.1, 0.28 + secondNoise * 0.42, 1.05 + noise * 0.9),
          rotation: new THREE.Euler(noise, secondNoise * Math.PI, noise * 0.45),
        });
      }
    }
  }

  const dummy = new THREE.Object3D();
  const shards = new THREE.InstancedMesh(
    new THREE.ConeGeometry(1, 1, 5),
    material,
    shardTransforms.length,
  );
  shards.name = 'wahr-welt-tower-growth-shards';
  shardTransforms.forEach((transform, index) => {
    dummy.position.copy(transform.position);
    dummy.scale.copy(transform.scale);
    dummy.rotation.copy(transform.rotation);
    dummy.updateMatrix();
    shards.setMatrixAt(index, dummy.matrix);
  });
  shards.instanceMatrix.needsUpdate = true;
  parent.add(shards);

  const chunks = new THREE.InstancedMesh(
    new THREE.DodecahedronGeometry(1, 0),
    material,
    chunkTransforms.length,
  );
  chunks.name = 'wahr-welt-tower-growth-crust';
  chunkTransforms.forEach((transform, index) => {
    dummy.position.copy(transform.position);
    dummy.scale.copy(transform.scale);
    dummy.rotation.copy(transform.rotation);
    dummy.updateMatrix();
    chunks.setMatrixAt(index, dummy.matrix);
  });
  chunks.instanceMatrix.needsUpdate = true;
  parent.add(chunks);
};

export const createTower = (): TowerController => {
  const group = new THREE.Group();
  group.name = 'wahr-welt-castle';
  group.position.set(0, CITY_DECK_Y, TOWER_Z);

  const paleStone = createTypeGpuCitadelMaterial({
    base: 0x8b90bd,
    face: 0xd6dbf2,
    line: 0x2a2747,
    ridge: 0xeef0fb,
    crystal: 0x8f7cf2,
    panelFrequency: 0.038,
    courseFrequency: 0.05,
    bayFrequency: 0.09,
    ridgeStrength: 0.14,
    crystalStrength: 0.3,
    ambientStrength: 0.14,
  });
  const stone = createTypeGpuCitadelMaterial({
    base: 0x6b6f9c,
    face: 0xb8bfdf,
    line: 0x232039,
    ridge: 0xdcdff6,
    crystal: 0x7668de,
    panelFrequency: 0.05,
    courseFrequency: 0.07,
    bayFrequency: 0.13,
    ridgeStrength: 0.16,
    crystalStrength: 0.52,
    ambientStrength: 0.12,
  });
  const shadowStone = createTypeGpuCitadelMaterial({
    base: 0x292c47,
    face: 0x5a5f8e,
    line: 0x0b0b17,
    ridge: 0x8a92c4,
    crystal: 0x4b2d6e,
    panelFrequency: 0.055,
    courseFrequency: 0.078,
    bayFrequency: 0.14,
    ridgeStrength: 0.12,
    crystalStrength: 0.42,
    ambientStrength: 0.1,
  });
  const recess = new THREE.MeshBasicMaterial({ color: 0x0d0b16 });
  const growthMaterial = createArchitecturalToonMaterial(0x4a3f7a, 0x1c1638, 0.05);

  const haloMaterial = new THREE.SpriteMaterial({
    map: createCastleHaloTexture(),
    color: 0xd9c5ff,
    transparent: true,
    opacity: 0.18,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    toneMapped: false,
  });
  const castleHalo = new THREE.Sprite(haloMaterial);
  castleHalo.name = 'wahr-welt-castle-atmospheric-halo';
  castleHalo.position.set(-24, 128, -62);
  castleHalo.scale.set(235, 250, 1);
  group.add(castleHalo);
  const SPINE_X = -20;

  // The anime citadel reads as one enormous, asymmetrical mountain of masonry:
  // a dominant off-centre spine, one high shoulder, one broad lower shoulder,
  // every mass coupled into a single silhouette. No detached parts, no twin
  // halves, no wedding-cake symmetry.
  addBox(group, shadowStone, 148, 10, 68, -2, 5, -4);
  addBox(group, stone, 140, 5, 72, -2, 12.5, 1);

  // A real processional entrance: two unequal masses leave a 23-unit physical
  // gap. The black back wall sits 50+ units behind the facade, so perspective
  // and shadows make this read as depth rather than a pasted window.
  addBox(group, paleStone, 62, 34, 58, -35.5, 30, -3);
  addBox(group, stone, 45, 40, 58, 41.5, 33, -3);
  addBox(group, shadowStone, 18, 1.2, 54, 7.25, 13.2, 0);
  addBox(group, recess, 19, 29, 1, 7.25, 29.5, -27.5);
  addBox(group, paleStone, 4.2, 38, 6, -6.6, 31, 29);
  addBox(group, paleStone, 4.2, 42, 6, 21.1, 33, 29);
  addBox(group, paleStone, 32, 7, 7, 7.25, 51.5, 28.5);
  for (let step = 0; step < 7; step += 1) {
    addBox(group, stone, 38 - step * 1.4, 1.2, 5.8, 7.25, 1.2 + step * 1.15, 38 + step * 2.1);
  }

  // Wide terrace ties the gate level to the upper keeps; its pale cap marks
  // the shared horizon line that keeps the whole complex visually coupled.
  addBox(group, stone, 160, 25, 56, -4, 62, -10);
  addBox(group, paleStone, 162, 6, 64, -4, 77.5, -5);

  // Deep middle block behind the front keeps: a parallax layer that shows
  // between and above the shoulders from oblique angles, never a flat wall.
  addBox(group, shadowStone, 120, 40, 40, -6, 94.5, -28);

  // Broad lower shoulder on the left: wider than it is tall.
  addBox(group, stone, 44, 44, 50, -60, 96.5, -8);
  addBox(group, paleStone, 47, 5, 53, -60, 121, -8);

  // Dominant off-centre spine: the tallest mass, left of centre, running
  // unbroken from the terrace to the crown cap. A stepped tier on the crown
  // breaks the flat roofline and carries the pinnacles.
  addBox(group, paleStone, 46, 104, 44, SPINE_X, 126.5, -12);
  addBox(group, shadowStone, 50, 5.5, 48, SPINE_X, 181.5, -12);
  addBox(group, paleStone, 30, 7, 30, SPINE_X - 3, 188, -12);
  addBox(group, shadowStone, 34, 4, 34, SPINE_X - 3, 193.5, -12);

  // The signature apex ring of Yhwach's castle is cradled between two crown
  // pillars: its edges sink into the pillars on both sides, so it reads as
  // masonry holding a void, never as a target floating against the sky.
  addBox(group, paleStone, 6, 26, 8, SPINE_X - 14, 208, -12);
  addBox(group, paleStone, 6, 24, 8, SPINE_X + 10, 207, -12);
  const apexRingShape = new THREE.Shape();
  apexRingShape.absarc(0, 0, 12, 0, Math.PI * 2, false);
  const apexRingHole = new THREE.Path();
  apexRingHole.absarc(0, 0, 8.8, 0, Math.PI * 2, true);
  apexRingShape.holes.push(apexRingHole);
  const apexRingGeometry = new THREE.ExtrudeGeometry(apexRingShape, {
    depth: 5,
    bevelEnabled: false,
    curveSegments: 48,
  });
  apexRingGeometry.center();
  const apexRing = new THREE.Mesh(apexRingGeometry, paleStone);
  apexRing.name = 'wahr-welt-apex-ring';
  apexRing.position.set(SPINE_X - 2, 206.5, -12);
  group.add(apexRing);

  // High right shoulder, footprint overlapping the spine so the two read as
  // one coupled mass rather than separated towers.
  addBox(group, stone, 56, 72, 46, 28, 110.5, -7);
  addBox(group, paleStone, 59, 5, 49, 28, 149, -7);

  // Two coupled mid-towers sit behind the front keeps: they overlap their
  // neighbours' footprints and peek above the caps, adding the layered
  // coupled-tower read of the reference castle instead of three flat slabs.
  addBox(group, stone, 24, 58, 30, -44, 103.5, -24);
  addBox(group, paleStone, 26, 4, 32, -44, 134.5, -24);
  addBox(group, shadowStone, 22, 90, 26, 57, 119.5, -24);
  addSpire(group, paleStone, 57, -24, 164.5, 10, 2.8);

  // Far-right step down keeps the right flank low and broad.
  addBox(group, shadowStone, 22, 36, 40, 63, 92.5, -2);

  // The recognisable circular void sits high INSIDE the spine with stone on
  // every side — an oculus punched through masonry, not a target ring
  // floating against the sky. The dark disc is flush with the facade and the
  // stone ring stands only a few units proud of it.
  const VOID_Y = 148;
  const SPINE_FRONT_Z = 10;
  const crownVoid = new THREE.Mesh(new THREE.CircleGeometry(8.6, 48), recess);
  crownVoid.name = 'wahr-welt-crown-void';
  crownVoid.position.set(SPINE_X, VOID_Y, SPINE_FRONT_Z + 0.16);
  group.add(crownVoid);

  const crownRingShape = new THREE.Shape();
  crownRingShape.absarc(0, 0, 11.2, 0, Math.PI * 2, false);
  const crownRingHole = new THREE.Path();
  crownRingHole.absarc(0, 0, 8.7, 0, Math.PI * 2, true);
  crownRingShape.holes.push(crownRingHole);
  const crownRingGeometry = new THREE.ExtrudeGeometry(crownRingShape, {
    depth: 3.6,
    bevelEnabled: false,
    curveSegments: 48,
  });
  crownRingGeometry.center();
  const crownRing = new THREE.Mesh(crownRingGeometry, paleStone);
  crownRing.name = 'wahr-welt-crown-ring';
  crownRing.position.set(SPINE_X, VOID_Y, SPINE_FRONT_Z + 1.8);
  group.add(crownRing);

  // Only a few large facade openings. Projecting jambs catch the key light and
  // make the recesses legible without turning the keeps into office buildings.
  addFramedRecess(group, paleStone, recess, SPINE_X, 106, SPINE_FRONT_Z + 0.4, 16, 36, 4.2, 7);
  addFramedRecess(group, paleStone, recess, 28, 104, 16.4, 14, 32, 3.8, 7);
  addFramedRecess(group, stone, recess, -60, 100, 17.4, 12, 26, 3.6, 7);
  addSlitRow(group, recess, -34, 42, 68, 22.4, 14, 3);
  addSlitRow(group, recess, 42, 38, 66, 22.4, 12, 2);

  // Pointed obelisk spires with jagged staggered heights: hostile silhouette,
  // never a crenellated wall. Every spire is grounded on a real cap surface.
  addSpire(group, paleStone, -42, -8, 184.2, 17);
  addSpire(group, stone, 2, -9, 184.2, 13);
  addSpire(group, paleStone, 50, 0, 164, 12);
  addSpire(group, stone, -60, -10, 123.5, 13);
  addSpire(group, stone, -76, -2, 123.5, 10);
  addBox(group, stone, 11, 13, 11, 50, 157.5, -4);

  // Four huge merlons establish scale; a repeated row would read like LEGO.
  for (const [index, x] of [-64, -26, 16, 58].entries()) {
    addBox(group, index % 2 === 0 ? paleStone : stone, 10, 14 + (index % 2) * 2, 10, x, 87.5, 21);
  }

  addGrowth(group, [
    { x0: -78, x1: 72, y: 81.4, z: 21, count: 26, seed: 1.1 },
    { x0: -80, x1: -40, y: 124.3, z: 16, count: 12, seed: 2.7 },
    { x0: 2, x1: 55, y: 152.2, z: 17, count: 12, seed: 4.2 },
    { x0: -40, x1: 0, y: 184.7, z: 10, count: 12, seed: 5.9 },
    { x0: 52, x1: 72, y: 111.3, z: 16, count: 8, seed: 7.3 },
  ], growthMaterial);

  // Violet crust creeps across the castle walls themselves (ref: the Yhwach
  // castle close-up — mottled patches on every keep). Flattened low-poly
  // chunks sit proud of the facade and catch the toon light; no decals.
  const wallCrustPatches: Array<readonly [number, number, number, number, number]> = [
    [-38, -4, 84, 126, 10.4],
    [6, 50, 84, 136, 16.4],
    [-76, -46, 82, 110, 17.4],
    [-66, 56, 52, 70, 22.4],
  ];
  const wallCrustTransforms: Array<{
    position: THREE.Vector3;
    scale: THREE.Vector3;
    rotation: THREE.Euler;
  }> = [];
  wallCrustPatches.forEach(([minX, maxX, minY, maxY, frontZ], patchIndex) => {
    const count = 3 + (patchIndex % 2);
    for (let index = 0; index < count; index += 1) {
      const seed = hash(patchIndex * 7.3 + index * 1.97);
      const seed2 = hash(index * 3.1 + patchIndex * 11.7);
      wallCrustTransforms.push({
        position: new THREE.Vector3(
          minX + (maxX - minX) * seed,
          minY + (maxY - minY) * seed2,
          frontZ + 0.15,
        ),
        scale: new THREE.Vector3(1.8 + seed * 3.4, 2.6 + seed2 * 4.6, 0.35 + seed * 0.55),
        rotation: new THREE.Euler((seed - 0.5) * 0.2, seed * Math.PI, (seed2 - 0.5) * 0.45),
      });
    }
  });
  const wallCrustDummy = new THREE.Object3D();
  const wallCrusts = new THREE.InstancedMesh(
    new THREE.DodecahedronGeometry(1, 0),
    growthMaterial,
    wallCrustTransforms.length,
  );
  wallCrusts.name = 'wahr-welt-castle-wall-crusts';
  wallCrustTransforms.forEach((transform, index) => {
    wallCrustDummy.position.copy(transform.position);
    wallCrustDummy.scale.copy(transform.scale);
    wallCrustDummy.rotation.copy(transform.rotation);
    wallCrustDummy.updateMatrix();
    wallCrusts.setMatrixAt(index, wallCrustDummy.matrix);
  });
  wallCrusts.instanceMatrix.needsUpdate = true;
  group.add(wallCrusts);

  const glow = createTypeGpuGlowMaterial(0xcbb5f4, 0.32);
  const crownGlow = new THREE.Mesh(
    new THREE.TorusGeometry(9.55, 0.55, 8, 48),
    glow.material,
  );
  crownGlow.name = 'wahr-welt-crown-edge-glow';
  crownGlow.position.set(SPINE_X, VOID_Y, SPINE_FRONT_Z + 1.4);
  crownGlow.renderOrder = 2;
  group.add(crownGlow);

  const crownLight = new THREE.PointLight(0xd9c8ff, 44, 235, 2.05);
  crownLight.position.set(SPINE_X, VOID_Y, 24);
  group.add(crownLight);

  return {
    group,
    update(time: number) {
      const drain = smoothstep(BEATS.anticipation, BEATS.impact, time);
      const aftermath = smoothstep(BEATS.moonBirth, BEATS.scaleReveal, time);
      const energy = Math.max(0.1, 0.7 - drain * 0.52 + aftermath * 0.12);
      glow.setAlpha(energy * 0.44);
      crownLight.intensity = 44 * (1 - drain * 0.84) + aftermath * 10;
      growthMaterial.emissiveIntensity = 0.12 + energy * 0.22;
      haloMaterial.opacity = 0.16 + energy * 0.2;
    },
  };
};
