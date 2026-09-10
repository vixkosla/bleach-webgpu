import * as THREE from 'three/webgpu';
import {
  createArchitecturalToonMaterial,
  createTypeGpuCitadelMaterial,
  createTypeGpuGlowMaterial,
  createTypeGpuHullMaterial,
  createTypeGpuPlazaMaterial,
  createTypeGpuRoofMaterial,
  createTypeGpuVoidMistMaterial,
} from '../materials/typegpuMaterials';
import { hash2 } from '../utils/math';
import { CITY_DECK_Y, CITY_RADIUS, TOWER_Z } from './constants';

interface InstanceTransform {
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  depth: number;
  rotation: number;
  rotationX?: number;
  rotationZ?: number;
}

// Wahr Welt is a field of monumental fortress blocks, not a dense village.
// The lot is sized so a 22-44 unit mass still leaves a real street gap to its
// neighbour. Absolute scale is set by the citadel: the castle (~200 units)
// must read 5-6x taller than a typical ward mass, so the city stays in the
// 18-50 height band and the avenue reads street-wide, not runway-wide.
const LOT = 48;
// Reserve a real ceremonial court for the castle's city-sized footprint. The
// old 24-unit hole was narrower than the castle itself, so surrounding lots
// visually crushed its shoulders and reduced it to a distant church tower.
const TOWER_COURT = 72;
const CAMERA_PATH: Array<readonly [number, number]> = [
  [0, 370],
  [0, 305],
  [0, 220],
  [0, 198],
  [72, 198],
  [36, 128],
  [0, 0],
];

const distToSegment = (
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number => {
  const abx = bx - ax;
  const abz = bz - az;
  const apx = px - ax;
  const apz = pz - az;
  const lengthSq = abx * abx + abz * abz;
  const t = lengthSq < 1e-6 ? 0 : Math.max(0, Math.min(1, (apx * abx + apz * abz) / lengthSq));
  return Math.hypot(apx - abx * t, apz - abz * t);
};

const applyInstances = (
  name: string,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  transforms: InstanceTransform[],
): THREE.InstancedMesh => {
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, transforms.length));
  mesh.name = name;
  if (transforms.length === 0) return mesh;

  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const rotation = new THREE.Euler();

  transforms.forEach((transform, index) => {
    position.set(transform.x, transform.y, transform.z);
    rotation.set(transform.rotationX ?? 0, transform.rotation, transform.rotationZ ?? 0);
    quaternion.setFromEuler(rotation);
    scale.set(transform.width, transform.height, transform.depth);
    matrix.compose(position, quaternion, scale);
    mesh.setMatrixAt(index, matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
};

const createMonumentalArchGeometry = (): THREE.ExtrudeGeometry => {
  const shape = new THREE.Shape();
  shape.moveTo(-0.5, -0.5);
  shape.lineTo(0.5, -0.5);
  shape.lineTo(0.5, 0.2);
  shape.quadraticCurveTo(0.5, 0.5, 0, 0.5);
  shape.quadraticCurveTo(-0.5, 0.5, -0.5, 0.2);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 1,
    steps: 1,
    bevelEnabled: false,
    curveSegments: 7,
  });
  geometry.translate(0, 0, -0.5);
  return geometry;
};

// The route test must account for the whole footprint, not only the lot centre.
// Otherwise a large keep can have its origin outside the spline while its wall
// still spans the road (the regression introduced when LOT became monumental).
const intersectsCameraCorridor = (
  x: number,
  z: number,
  width = 0,
  depth = 0,
  clearance = 10.5,
): boolean => {
  let distance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < CAMERA_PATH.length - 1; index += 1) {
    const start = CAMERA_PATH[index];
    const end = CAMERA_PATH[index + 1];
    if (!start || !end) continue;
    distance = Math.min(distance, distToSegment(x, z, start[0], start[1], end[0], end[1]));
  }
  const footprintRadius = Math.hypot(width, depth) * 0.5;
  return distance < clearance + footprintRadius;
};

const removeRouteIntersections = (
  transforms: InstanceTransform[],
  clearance: number,
): void => {
  for (let index = transforms.length - 1; index >= 0; index -= 1) {
    const transform = transforms[index];
    if (!transform) continue;
    if (intersectsCameraCorridor(
      transform.x,
      transform.z,
      transform.width,
      transform.depth,
      clearance,
    )) {
      transforms.splice(index, 1);
    }
  }
};

const createSeededRandom = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
};

export const createGrowthTexture = (seed: number): THREE.CanvasTexture => {
  const canvas = document.createElement('canvas');
  canvas.width = 384;
  canvas.height = 384;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Unable to create Wahr Welt growth texture');
  const random = createSeededRandom(seed);

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.lineCap = 'round';
  context.lineJoin = 'round';

  const frost = context.createLinearGradient(0, 0, 0, canvas.height);
  frost.addColorStop(0, 'rgba(214, 208, 240, 0.92)');
  frost.addColorStop(0.18, 'rgba(176, 168, 224, 0.62)');
  frost.addColorStop(0.55, 'rgba(132, 118, 196, 0.18)');
  frost.addColorStop(1, 'rgba(90, 70, 160, 0)');
  context.fillStyle = frost;
  context.fillRect(0, 0, canvas.width, canvas.height);

  for (let index = 0; index < 48; index += 1) {
    const startX = random() * canvas.width;
    const startY = random() * 48;
    const length = 120 + random() * 240;
    const sway = (random() - 0.5) * 18;
    context.strokeStyle = `rgba(${190 + Math.floor(random() * 50)}, ${186 + Math.floor(random() * 50)}, ${230 + Math.floor(random() * 25)}, ${0.35 + random() * 0.5})`;
    context.lineWidth = 2 + random() * 7;
    context.beginPath();
    context.moveTo(startX, startY);
    context.bezierCurveTo(
      startX + sway * 0.25,
      startY + length * 0.35,
      startX - sway * 0.2,
      startY + length * 0.7,
      startX + sway * 0.15,
      startY + length,
    );
    context.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
};

const createStoneWearTexture = (seed: number): THREE.CanvasTexture => {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Unable to create Wahr Welt stone-wear texture');
  const random = createSeededRandom(seed);

  context.clearRect(0, 0, canvas.width, canvas.height);
  for (let index = 0; index < 180; index += 1) {
    const shade = 34 + Math.floor(random() * 50);
    context.fillStyle = `rgba(${shade}, ${shade - 3}, ${shade + 8}, ${0.015 + random() * 0.075})`;
    context.beginPath();
    context.ellipse(
      random() * canvas.width,
      random() * canvas.height,
      3 + random() * 34,
      2 + random() * 18,
      random() * Math.PI,
      0,
      Math.PI * 2,
    );
    context.fill();
  }

  for (let index = 0; index < 42; index += 1) {
    let x = random() * canvas.width;
    let y = random() * canvas.height;
    context.strokeStyle = `rgba(42, 35, 48, ${0.12 + random() * 0.22})`;
    context.lineWidth = 0.7 + random() * 1.7;
    context.beginPath();
    context.moveTo(x, y);
    const segments = 2 + Math.floor(random() * 5);
    for (let segment = 0; segment < segments; segment += 1) {
      x += (random() - 0.5) * 38;
      y += 8 + random() * 42;
      context.lineTo(x, y);
    }
    context.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
};

export const createCity = (): THREE.Group => {
  const city = new THREE.Group();
  city.name = 'wahr-welt-procedural-citadel';
  city.position.z = TOWER_Z;

  // Reference frame 11-54-58: Wahr Welt stone is pale lavender-white even in
  // shadow, with the violet reserved for the crystal growth. The earlier dark
  // indigo palette made the masses read as office blocks at night; these
  // values keep the cold hue but lift the city into the anime's high key.
  const nearFacade = createTypeGpuCitadelMaterial({
    base: 0x6a6f9e,
    face: 0xc0c7e8,
    line: 0x1e1a34,
    ridge: 0xd6dcf5,
    crystal: 0x7d6ce8,
    panelFrequency: 0.046,
    courseFrequency: 0.064,
    bayFrequency: 0.058,
    ridgeStrength: 0.16,
    crystalStrength: 0.5,
    ambientStrength: 0.22,
  });
  const farFacade = createTypeGpuCitadelMaterial({
    base: 0x5a5f8c,
    face: 0xaab2da,
    line: 0x181528,
    ridge: 0xc0c8e8,
    crystal: 0x6a63d8,
    panelFrequency: 0.055,
    courseFrequency: 0.076,
    bayFrequency: 0.068,
    ridgeStrength: 0.13,
    crystalStrength: 0.4,
    ambientStrength: 0.16,
  });
  const hullFacade = createTypeGpuHullMaterial();
  const plazaMaterial = createTypeGpuPlazaMaterial();
  const roofMaterial = createTypeGpuRoofMaterial();
  const structural = createArchitecturalToonMaterial(0x2b2547, 0x0d0920, 0.08);
  const nicheMaterial = createArchitecturalToonMaterial(0x241d3d, 0x0a0718, 0.1);
  const ledgeMaterial = createArchitecturalToonMaterial(0x6d6794, 0x17112b, 0.035);
  const growthCrustMaterial = createArchitecturalToonMaterial(0x4a3f7a, 0x1c1638, 0.06);
  const growthMaterials = [19, 73, 149].map((seed) => new THREE.MeshBasicMaterial({
    map: createGrowthTexture(seed),
    transparent: true,
    alphaTest: 0.1,
    opacity: 0.22,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: true,
  }));
  const wearMaterials = [31, 101, 211].map((seed) => new THREE.MeshBasicMaterial({
    map: createStoneWearTexture(seed),
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    side: THREE.DoubleSide,
    toneMapped: true,
  }));
  const stoneTextureLoader = new THREE.TextureLoader();
  const stoneAlbedoMaterials = [
    { repeat: 1.12, offsetX: 0.03, offsetY: 0.08 },
    { repeat: 1.34, offsetX: 0.31, offsetY: 0.17 },
    { repeat: 1.58, offsetX: 0.63, offsetY: 0.42 },
  ].map(({ repeat, offsetX, offsetY }) => {
    const map = stoneTextureLoader.load('/textures/wahr-welt-stone-albedo-v2.png');
    map.colorSpace = THREE.SRGBColorSpace;
    map.wrapS = THREE.RepeatWrapping;
    map.wrapT = THREE.RepeatWrapping;
    map.repeat.set(repeat, repeat);
    map.offset.set(offsetX, offsetY);
    map.anisotropy = 8;
    return new THREE.MeshBasicMaterial({
      map,
      color: 0x756b83,
      transparent: true,
      opacity: 0.065,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -0.5,
      side: THREE.DoubleSide,
    });
  });
  const rubbleMaterial = createArchitecturalToonMaterial(0x6e6893, 0x150f26, 0.025);
  rubbleMaterial.map = stoneAlbedoMaterials[0]?.map ?? null;
  const darkRubbleMaterial = createArchitecturalToonMaterial(0x353154, 0x0b081a, 0.025);

  const lowerHull = new THREE.Mesh(
    new THREE.CylinderGeometry(CITY_RADIUS - 18, 45, 124, 16, 5),
    hullFacade,
  );
  lowerHull.name = 'wahr-welt-suspended-lower-hull';
  lowerHull.position.y = CITY_DECK_Y - 65;
  city.add(lowerHull);

  const deck = new THREE.Mesh(
    new THREE.CylinderGeometry(CITY_RADIUS, CITY_RADIUS - 10, 7, 16, 1),
    nearFacade,
  );
  deck.name = 'wahr-welt-terrace-0';
  deck.position.y = CITY_DECK_Y - 3.5;
  city.add(deck);

  const plaza = new THREE.Mesh(new THREE.CircleGeometry(CITY_RADIUS - 3, 160), plazaMaterial);
  plaza.name = 'wahr-welt-procedural-plaza-tessellation';
  plaza.rotation.x = -Math.PI * 0.5;
  plaza.position.y = CITY_DECK_Y + 0.08;
  plaza.receiveShadow = true;
  city.add(plaza);

  const nearBodies: InstanceTransform[] = [];
  const farBodies: InstanceTransform[] = [];
  const roofs: InstanceTransform[] = [];
  const flatCaps: InstanceTransform[] = [];
  const facadeNiches: InstanceTransform[] = [];
  const facadeCourseSegments: InstanceTransform[] = [];
  const facadeButtresses: InstanceTransform[] = [];
  const facadeLedges: InstanceTransform[] = [];
  const facadePilasters: InstanceTransform[] = [];
  const parapetTeeth: InstanceTransform[] = [];
  const growthCrusts: InstanceTransform[] = [];
  const growthShards: InstanceTransform[] = [];
  const crystalClusters: InstanceTransform[] = [];
  const growthCurtains: [InstanceTransform[], InstanceTransform[], InstanceTransform[]] = [[], [], []];
  const wearPanels: [InstanceTransform[], InstanceTransform[], InstanceTransform[]] = [[], [], []];
  const rubbleChunks: InstanceTransform[] = [];
  const darkRubbleChunks: InstanceTransform[] = [];
  const rubbleSlabs: InstanceTransform[] = [];
  const ruinWallFragments: InstanceTransform[] = [];
  const ruinColumns: InstanceTransform[] = [];
  const avenueSlabs: InstanceTransform[] = [];
  const avenueCurbs: InstanceTransform[] = [];

  const placeLot = (
    x: number,
    z: number,
    width: number,
    depth: number,
    height: number,
    rotation: number,
    near: boolean,
  ): void => {
    const target = near ? nearBodies : farBodies;
    const rightX = Math.cos(rotation);
    const rightZ = -Math.sin(rotation);
    const forwardX = Math.sin(rotation);
    const forwardZ = Math.cos(rotation);
    const detailSeed = hash2(Math.round(x * 0.37), Math.round(z * 0.41));
    const roofSeed = hash2(Math.round(x * 0.23) + 71, Math.round(z * 0.31) - 53);
    // Macro roofs still cover the entire original footprint (never little
    // house caps), but the anime city shows pale hipped planes on many masses,
    // not only on two or three heroes.
    const hasMacroRoof = height > 22 && roofSeed > 0.72;

    // Every lot starts with one monumental mass, then receives deterministic
    // annexes and setbacks. This breaks the repeated-box skyline without
    // sacrificing instancing or the camera corridor.
    target.push({
      x,
      y: CITY_DECK_Y + height * 0.5,
      z,
      width,
      height,
      depth,
      rotation,
    });

    const annexSeed = hash2(Math.round(z * 0.29) + 17, Math.round(x * 0.33) - 9);
    if (!hasMacroRoof && detailSeed > 0.7 && height > 28) {
      const side = annexSeed > 0.5 ? 1 : -1;
      const annexWidth = width * (0.42 + annexSeed * 0.12);
      const annexDepth = depth * (0.7 + annexSeed * 0.16);
      const annexHeight = height * (0.58 + annexSeed * 0.18);
      const annexShift = width * 0.4;
      target.push({
        x: x + rightX * side * annexShift - forwardX * depth * 0.04,
        y: CITY_DECK_Y + annexHeight * 0.5,
        z: z + rightZ * side * annexShift - forwardZ * depth * 0.04,
        width: annexWidth,
        height: annexHeight,
        depth: annexDepth,
        rotation,
      });
      flatCaps.push({
        x: x + rightX * side * annexShift - forwardX * depth * 0.04,
        y: CITY_DECK_Y + annexHeight + 0.2,
        z: z + rightZ * side * annexShift - forwardZ * depth * 0.04,
        width: annexWidth * 1.12,
        height: 0.72,
        depth: annexDepth * 1.12,
        rotation,
      });
    }

    // Macro roofs and upper keeps are separate silhouettes. Previously every
    // pitched roof inherited the narrow upper tier and inevitably read as a
    // little house cap. A roof now covers the entire original fortress block.
    const hasUpperTier = !hasMacroRoof && detailSeed > 0.52 && height > 28;
    const tierHeight = hasUpperTier ? height * (0.25 + annexSeed * 0.1) : 0;
    const tierWidth = hasUpperTier ? width * (0.68 + annexSeed * 0.12) : width;
    const tierDepth = hasUpperTier ? depth * (0.7 + detailSeed * 0.12) : depth;
    const tierLateralShift = hasUpperTier ? (annexSeed - 0.5) * width * 0.14 : 0;
    const crownX = x + rightX * tierLateralShift;
    const crownZ = z + rightZ * tierLateralShift;
    const crownHeight = height + tierHeight;
    if (hasUpperTier) {
      target.push({
        x: crownX,
        y: CITY_DECK_Y + height + tierHeight * 0.5,
        z: crownZ,
        width: tierWidth,
        height: tierHeight,
        depth: tierDepth,
        rotation,
      });
      flatCaps.push({
        x,
        y: CITY_DECK_Y + height + 0.22,
        z,
        width: width * 1.09,
        height: 0.78,
        depth: depth * 1.09,
        rotation,
      });
    }

    // Rise is 26-36% of the shorter footprint dimension: the pale hipped
    // planes are a major silhouette feature in the reference stills and must
    // read from street level, not just from above.
    const roofHeight = Math.min(width, depth) * (0.26 + roofSeed * 0.1);
    if (hasMacroRoof) {
      flatCaps.push({
        x,
        y: CITY_DECK_Y + height + 0.28,
        z,
        width: width * 1.13,
        height: 0.86,
        depth: depth * 1.13,
        rotation,
      });
      roofs.push({
        x,
        y: CITY_DECK_Y + height + roofHeight * 0.46,
        z,
        width: width,
        height: roofHeight,
        depth,
        rotation: rotation + Math.PI * 0.25,
      });
    } else {
      flatCaps.push({
        x: crownX,
        y: CITY_DECK_Y + crownHeight + 0.24,
        z: crownZ,
        width: tierWidth * 1.1,
        height: 0.82,
        depth: tierDepth * 1.1,
        rotation,
      });
    }

    if (detailSeed > 1.5) { // parapet teeth disabled: little caps read as houses
      const toothCount = Math.max(2, Math.min(4, Math.floor(tierWidth / 6)));
      for (let toothIndex = 0; toothIndex < toothCount; toothIndex += 1) {
        const toothSeed = hash2(
          Math.round(x) + toothIndex * 31,
          Math.round(z) - toothIndex * 17,
        );
        if (toothSeed < 0.36) continue;
        const lateral = ((toothIndex + 0.5) / toothCount - 0.5) * tierWidth * 0.88;
        const toothHeight = 0.72 + toothSeed * 1.08;
        parapetTeeth.push({
          x: crownX + rightX * lateral + forwardX * (tierDepth * 0.5 + 0.09),
          y: CITY_DECK_Y + crownHeight + 0.48 + toothHeight * 0.5,
          z: crownZ + rightZ * lateral + forwardZ * (tierDepth * 0.5 + 0.09),
          width: Math.max(1.05, tierWidth / (toothCount * 2.4)),
          height: toothHeight,
          depth: 0.72 + toothSeed * 0.42,
          rotation,
          rotationZ: (toothSeed - 0.5) * 0.14,
        });
      }
    }

    // These are fortress-scale voids, not windows. One opening is allowed to
    // occupy an entire former building module; only the broadest masses get a
    // second opening.
    // One real deep portal per macro mass. Repeated twin gates made every
    // facade look like an office frame; a single monumental opening reads
    // like a castle gate instead.
    const bayCount = 1;
    const frontOffset = depth * 0.5 + 0.035;
    const textureVariant = Math.min(2, Math.floor(detailSeed * 3));
    wearPanels[textureVariant]!.push({
      x: x + forwardX * (depth * 0.5 + 0.008),
      y: CITY_DECK_Y + height * 0.52,
      z: z + forwardZ * (depth * 0.5 + 0.008),
      width: width * 0.94,
      height: height * 0.9,
      depth: 1,
      rotation,
    });
    wearPanels[(textureVariant + 1) % 3]!.push({
      x: x - forwardX * (depth * 0.5 + 0.008),
      y: CITY_DECK_Y + height * 0.52,
      z: z - forwardZ * (depth * 0.5 + 0.008),
      width: width * 0.94,
      height: height * 0.9,
      depth: 1,
      rotation: rotation + Math.PI,
    });
    for (const side of [-1, 1]) {
      wearPanels[(textureVariant + 2) % 3]!.push({
        x: x + rightX * side * (width * 0.5 + 0.008),
        y: CITY_DECK_Y + height * 0.52,
        z: z + rightZ * side * (width * 0.5 + 0.008),
        width: depth * 0.94,
        height: height * 0.9,
        depth: 1,
        rotation: rotation + side * Math.PI * 0.5,
      });
    }

    const bayBands = [{ center: 0.5, extent: height > 42 ? 0.62 : 0.54, countScale: 1 }];
    const shadowBandIndex = 0;
    for (const [bandIndex, band] of bayBands.entries()) {
      const bandCount = Math.max(1, Math.min(2, Math.round(bayCount * band.countScale)));
      const bayHeight = height * band.extent;
      let recessedPanelLateral: number | null = null;
      let recessedPanelWidth = 0;

      // The reference architecture reads in broad light and shadow masses.
      // Reserve one unperforated stone field instead of filling every facade
      // with repeated dark slots; broken courses still give it real relief.
      if (detailSeed > 0.2 && bandIndex === shadowBandIndex) {
        const panelSeed = hash2(Math.round(x) + 137, Math.round(z) - 83);
        const panelSide = annexSeed > 0.5 ? 1 : -1;
        const panelWidth = width * (0.44 + panelSeed * 0.16);
        const panelHeight = bayHeight * (1.08 + panelSeed * 0.1);
        const panelLateral = panelSide * width * (0.1 - panelSeed * 0.025);
        const panelY = CITY_DECK_Y + height * band.center;
        recessedPanelLateral = panelLateral;
        recessedPanelWidth = panelWidth;

        const frameHeight = Math.max(0.22, Math.min(0.42, height * 0.016));
        for (const edge of [-1, 1]) {
          facadeCourseSegments.push({
            x: x + rightX * panelLateral + forwardX * (frontOffset + 0.07),
            y: panelY + edge * panelHeight * 0.5,
            z: z + rightZ * panelLateral + forwardZ * (frontOffset + 0.07),
            width: panelWidth * 1.08,
            height: frameHeight,
            depth: 0.28,
            rotation,
          });
        }

        // A few incomplete masonry courses break the remaining blank plaster
        // and cast short, crisp shadows without turning the wall into a grid.
        const courseLevel = band.center > 0.5 ? 0.28 : 0.78;
        const courseCount = detailSeed > 0.72 ? 3 : 2;
        for (let courseIndex = 0; courseIndex < courseCount; courseIndex += 1) {
          const courseSeed = hash2(
            Math.round(x) + courseIndex * 47,
            Math.round(z) - courseIndex * 29,
          );
          const courseWidth = width * (0.14 + courseSeed * 0.13);
          const lateral = ((courseIndex + 0.5) / courseCount - 0.5) * width * 0.66;
          facadeCourseSegments.push({
            x: x + rightX * lateral + forwardX * (frontOffset + 0.075),
            y: CITY_DECK_Y + height * courseLevel + (courseSeed - 0.5) * 0.38,
            z: z + rightZ * lateral + forwardZ * (frontOffset + 0.075),
            width: courseWidth,
            height: 0.22 + courseSeed * 0.16,
            depth: 0.32 + courseSeed * 0.16,
            rotation,
          });
        }
      }

      for (let bayIndex = 0; bayIndex < bandCount; bayIndex += 1) {
        const lateral = ((bayIndex + 0.5) / bandCount - 0.5) * width * 0.78;
        const portalLateral = bandCount === 1 && recessedPanelLateral !== null
          ? recessedPanelLateral
          : lateral;
        const bayWidth = Math.max(6, Math.min(12, width * 0.16));
        const frameWidth = Math.max(1.25, Math.min(2.35, width * 0.078));
        // Jambs project 2-3.5 units so the portal casts a real shadow.
        const frameDepth = 1.8 + detailSeed * 1.2;
        facadeNiches.push({
          x: x + rightX * portalLateral + forwardX * (frontOffset + 0.02),
          y: CITY_DECK_Y + height * band.center,
          z: z + rightZ * portalLateral + forwardZ * (frontOffset + 0.02),
          width: bayWidth,
          height: bayHeight,
          depth: 0.5,
          rotation,
        });
        for (const edge of [-1, 1]) {
          const frameLateral = portalLateral + edge * (bayWidth * 0.5 + frameWidth * 0.5);
          facadePilasters.push({
            x: x + rightX * frameLateral + forwardX * (frontOffset + 0.42),
            y: CITY_DECK_Y + height * band.center,
            z: z + rightZ * frameLateral + forwardZ * (frontOffset + 0.42),
            width: frameWidth,
            height: bayHeight + frameWidth * 1.8,
            depth: frameDepth,
            rotation,
          });
          facadeCourseSegments.push({
            x: x + rightX * portalLateral + forwardX * (frontOffset + 0.42),
            y: CITY_DECK_Y + height * band.center + edge * (bayHeight * 0.5 + frameWidth * 0.48),
            z: z + rightZ * portalLateral + forwardZ * (frontOffset + 0.42),
            width: bayWidth + frameWidth * 2,
            height: frameWidth,
            depth: frameDepth,
            rotation,
          });
        }
        if (bayIndex < bandCount - 1) {
          const pillarLateral = ((bayIndex + 1) / bandCount - 0.5) * width * 0.78;
          const pillarInsideRelief = recessedPanelLateral !== null
            && Math.abs(pillarLateral - recessedPanelLateral) < recessedPanelWidth * 0.43;
          if (!pillarInsideRelief) {
            facadePilasters.push({
              x: x + rightX * pillarLateral + forwardX * (frontOffset + 0.065),
              y: CITY_DECK_Y + height * band.center,
              z: z + rightZ * pillarLateral + forwardZ * (frontOffset + 0.065),
              width: Math.max(0.8, width / (bandCount * 12)),
              height: bayHeight * 1.08,
              depth: 0.2,
              rotation,
            });
          }
        }
      }

      // Ward-facade slot strips (ref: the wiki street frame — narrow deep
      // vertical slots between piers, not an office window grid). One low
      // band per mass, 2-4 slots at most, never crossing the portal panel.
      if (detailSeed > 0.62) {
        const slotCount = 2 + Math.floor(annexSeed * 3);
        const slotY = CITY_DECK_Y + height * 0.3;
        for (let slotIndex = 0; slotIndex < slotCount; slotIndex += 1) {
          const slotSeed = hash2(Math.round(x) + slotIndex * 17, Math.round(z) - slotIndex * 11);
          const lateral = ((slotIndex + 0.5) / slotCount - 0.5) * width * 0.58;
          if (recessedPanelLateral !== null
            && Math.abs(lateral - recessedPanelLateral) < recessedPanelWidth * 0.5) continue;
          facadeNiches.push({
            x: x + rightX * lateral + forwardX * (frontOffset + 0.03),
            y: slotY,
            z: z + rightZ * lateral + forwardZ * (frontOffset + 0.03),
            width: 1.15 + slotSeed * 0.75,
            height: height * (0.24 + slotSeed * 0.1),
            depth: 0.5,
            rotation,
          });
        }
      }
    }

    // Broad front-edge pylons establish the scale of the wall before any
    // surface pattern is read. They frame the full facade, not individual
    // windows, and cast long graphic shadows during the street fly-through.
    if (detailSeed > 0.26) {
      const pierWidth = Math.max(1.75, Math.min(3.25, width * 0.095));
      const pierHeight = height * (0.72 + detailSeed * 0.14);
      for (const edge of [-1, 1]) {
        const lateral = edge * (width * 0.5 - pierWidth * 0.34);
        facadePilasters.push({
          x: x + rightX * lateral + forwardX * (frontOffset + 0.2),
          y: CITY_DECK_Y + pierHeight * 0.5,
          z: z + rightZ * lateral + forwardZ * (frontOffset + 0.2),
          width: pierWidth,
          height: pierHeight,
          depth: 1.35 + detailSeed * 0.85,
          rotation,
        });
      }
    }

    if (detailSeed > 0.78) {
      const sideBayCount = depth > 25 && detailSeed > 0.9 ? 2 : 1;
      const sideOffset = width * 0.5 + 0.035;
      const sideBayHeight = height * (height > 42 ? 0.58 : 0.5);
      for (let bayIndex = 0; bayIndex < sideBayCount; bayIndex += 1) {
        const lateral = ((bayIndex + 0.5) / sideBayCount - 0.5) * depth * 0.76;
        facadeNiches.push({
          x: x + rightX * sideOffset + forwardX * lateral,
          y: CITY_DECK_Y + height * 0.38,
          z: z + rightZ * sideOffset + forwardZ * lateral,
          width: Math.max(3.4, Math.min(depth * 0.42, depth / (sideBayCount * 1.8))),
          height: sideBayHeight,
          depth: 0.16,
          rotation: rotation + Math.PI * 0.5,
        });
      }
    }

    if (detailSeed > 0.18) {
      const buttressSides = detailSeed > 0.76 ? [-1, 1] : [annexSeed > 0.5 ? 1 : -1];
      for (const side of buttressSides) {
        const buttressCount = depth > 9.5 && detailSeed > 0.56 ? 2 : 1;
        for (let buttressIndex = 0; buttressIndex < buttressCount; buttressIndex += 1) {
          const buttressSeed = hash2(
            Math.round(x) + side * 61 + buttressIndex * 23,
            Math.round(z) - buttressIndex * 43,
          );
          const lateral = ((buttressIndex + 0.5) / buttressCount - 0.5) * depth * 0.54
            + (buttressSeed - 0.5) * depth * 0.08;
          const buttressHeight = height * (0.64 + buttressSeed * 0.22);
          facadeButtresses.push({
            x: x + rightX * side * (width * 0.5 + 0.13) + forwardX * lateral,
            y: CITY_DECK_Y + buttressHeight * 0.5,
            z: z + rightZ * side * (width * 0.5 + 0.13) + forwardZ * lateral,
            width: 0.9 + buttressSeed * 0.78,
            height: buttressHeight,
            depth: 0.82 + buttressSeed * 0.7,
            rotation: rotation + side * Math.PI * 0.5,
          });

          const courseY = CITY_DECK_Y + height * (buttressSeed > 0.5 ? 0.34 : 0.76);
          facadeCourseSegments.push({
            x: x + rightX * side * (width * 0.5 + 0.105) + forwardX * lateral,
            y: courseY,
            z: z + rightZ * side * (width * 0.5 + 0.105) + forwardZ * lateral,
            width: depth * (0.2 + buttressSeed * 0.12),
            height: 0.24 + buttressSeed * 0.18,
            depth: 0.34 + buttressSeed * 0.18,
            rotation: rotation + side * Math.PI * 0.5,
          });
        }
      }
    }

    const ledgeLevels = height > 23 ? [0.5, 0.86] : [0.68];
    for (const level of ledgeLevels) {
      facadeLedges.push({
        x,
        y: CITY_DECK_Y + height * level,
        z,
        width: width * (level > 0.8 ? 1.11 : 1.085),
        height: Math.max(0.58, Math.min(1.08, height * 0.026)),
        depth: depth * (level > 0.8 ? 1.11 : 1.085),
        rotation,
      });
    }

    // The violet infestation is physical silhouette first, painted texture
    // second. Low-poly crusts and hanging shards catch the same toon light and
    // cast real shadows across the cornice, unlike the old flat sticker planes.
    if (roofSeed > 0.18) {
      const ridgeWidth = hasMacroRoof ? width : tierWidth;
      const ridgeDepth = hasMacroRoof ? depth : tierDepth;
      const ridgeX = hasMacroRoof ? x : crownX;
      const ridgeZ = hasMacroRoof ? z : crownZ;
      const ridgeY = CITY_DECK_Y + (hasMacroRoof ? height + 0.72 : crownHeight + 0.78);
      const crustCount = 3 + Math.floor(roofSeed * 4);
      for (let crustIndex = 0; crustIndex < crustCount; crustIndex += 1) {
        const crustSeed = hash2(
          Math.round(x) + crustIndex * 43 + 211,
          Math.round(z) - crustIndex * 37 - 97,
        );
        if (crustSeed < 0.24) continue;
        const lateral = ((crustIndex + 0.5) / crustCount - 0.5) * ridgeWidth * 0.94;
        const outward = ridgeDepth * 0.5 + 0.45 + crustSeed * 0.42;
        const crustX = ridgeX + rightX * lateral + forwardX * outward;
        const crustZ = ridgeZ + rightZ * lateral + forwardZ * outward;
        growthCrusts.push({
          x: crustX,
          y: ridgeY + (crustSeed - 0.5) * 0.28,
          z: crustZ,
          width: 1.7 + crustSeed * 3.3,
          height: 0.58 + crustSeed * 1.08,
          depth: 1.05 + crustSeed * 1.65,
          rotation: rotation + crustSeed * 0.75,
          rotationX: (crustSeed - 0.5) * 0.36,
          rotationZ: (crustSeed - 0.5) * 0.28,
        });
        if (crustSeed > 0.52) {
          const shardLength = 1.8 + crustSeed * 5.4;
          growthShards.push({
            x: crustX + rightX * (crustSeed - 0.5) * 0.7,
            y: ridgeY - shardLength * 0.43,
            z: crustZ + 0.08,
            width: 0.48 + crustSeed * 0.72,
            height: shardLength,
            depth: 0.48 + crustSeed * 0.72,
            rotation: rotation + crustSeed * Math.PI,
            rotationZ: Math.PI + (crustSeed - 0.5) * 0.2,
          });
        }
      }

      // Reference frame 11-54-58: the violet infestation erupts between the
      // masses as real crystal nests, not decals. On the most overgrown lots a
      // whole cluster of tall shards breaks through one corner of the roof,
      // tall enough to join the skyline.
      if (roofSeed > 0.6) {
        const clusterCount = roofSeed > 0.86 ? 2 : 1;
        for (let clusterIndex = 0; clusterIndex < clusterCount; clusterIndex += 1) {
          const clusterSeed = hash2(
            Math.round(x * 1.7) + clusterIndex * 13,
            Math.round(z * 1.3) - clusterIndex * 29,
          );
          const anchorLateral = (clusterSeed - 0.5) * ridgeWidth * 0.72;
          const anchorForward = (hash2(clusterIndex + 5, Math.round(x)) - 0.5) * ridgeDepth * 0.62;
          const anchorX = ridgeX + rightX * anchorLateral + forwardX * anchorForward;
          const anchorZ = ridgeZ + rightZ * anchorLateral + forwardZ * anchorForward;
          const shardCount = 3 + Math.floor(clusterSeed * 4);
          for (let shardIndex = 0; shardIndex < shardCount; shardIndex += 1) {
            const shardSeed = hash2(
              Math.round(x) + shardIndex * 11 + clusterIndex * 7,
              Math.round(z) - shardIndex * 17,
            );
            const shardHeight = 2.6 + shardSeed * 5.4;
            const spread = 1.1 + shardSeed * 2.2;
            crystalClusters.push({
              x: anchorX + (shardSeed - 0.5) * spread,
              y: ridgeY + shardHeight * 0.42,
              z: anchorZ + (hash2(shardIndex, clusterIndex + 3) - 0.5) * spread,
              width: 0.75 + shardSeed * 1.15,
              height: shardHeight,
              depth: 0.75 + shardSeed * 1.15,
              rotation: shardSeed * Math.PI,
              rotationX: (shardSeed - 0.5) * 0.3,
              rotationZ: (hash2(shardIndex + 31, clusterIndex) - 0.5) * 0.34,
            });
          }
        }
      }
    }

    if (detailSeed > 0.72) {
      const growthHeight = height * (0.18 + detailSeed * 0.12);
      growthCurtains[textureVariant]!.push({
        x: x + forwardX * (frontOffset + 0.16),
        y: CITY_DECK_Y + height * 0.62,
        z: z + forwardZ * (frontOffset + 0.16),
        width: width * 0.38,
        height: growthHeight,
        depth: 1,
        rotation,
      });
    }

    if (detailSeed > 0.3) {
      const rubbleCount = detailSeed > 0.76 ? 10 : 5;
      for (let rubbleIndex = 0; rubbleIndex < rubbleCount; rubbleIndex += 1) {
        const rubbleSeed = hash2(Math.round(x) - rubbleIndex * 19, Math.round(z) + rubbleIndex * 13);
        const side = rubbleIndex % 2 === 0 ? 1 : -1;
        const lateral = side * width * (0.32 + rubbleSeed * 0.2);
        const outward = depth * (0.48 + rubbleSeed * 0.1);
        const rubbleSize = 0.65 + rubbleSeed * 2.05;
        const rubbleTarget = rubbleSeed > 0.54 ? darkRubbleChunks : rubbleChunks;
        rubbleTarget.push({
          x: x + rightX * lateral + forwardX * outward,
          y: CITY_DECK_Y + rubbleSize * 0.32,
          z: z + rightZ * lateral + forwardZ * outward,
          width: rubbleSize * (0.72 + rubbleSeed * 0.45),
          height: rubbleSize * (0.48 + rubbleSeed * 0.38),
          depth: rubbleSize * (0.65 + rubbleSeed * 0.5),
          rotation: rotation + rubbleSeed * Math.PI,
        });
        if (rubbleIndex % 4 === 0) {
          rubbleSlabs.push({
            x: x + rightX * lateral * 0.9 + forwardX * (outward + rubbleSize * 0.34),
            y: CITY_DECK_Y + 0.18 + rubbleSeed * 0.22,
            z: z + rightZ * lateral * 0.9 + forwardZ * (outward + rubbleSize * 0.34),
            width: rubbleSize * (1.4 + rubbleSeed),
            height: 0.28 + rubbleSeed * 0.38,
            depth: rubbleSize * (0.55 + rubbleSeed * 0.6),
            rotation: rotation + rubbleSeed * 2.1,
          });
        }
      }
    }
  };

  // District planning: the field is split into radial sectors and each sector
  // keeps its own density band, family bias and height band, so the city reads
  // as planned quarters instead of per-lot noise. The seams between sectors
  // stay open and become secondary radial streets — in the overhead frames
  // they are the dark cuts separating whole blocks (ref 11-55-14).
  const SECTOR_COUNT = 10;
  const gridExtent = Math.floor((CITY_RADIUS - 8) / LOT);
  for (let cellZ = -gridExtent; cellZ <= gridExtent; cellZ += 1) {
    for (let cellX = -gridExtent; cellX <= gridExtent; cellX += 1) {
      const x = (cellX + 0.5) * LOT;
      const z = (cellZ + 0.5) * LOT;
      const radius = Math.hypot(x, z);
      if (radius < TOWER_COURT || radius > CITY_RADIUS - 10) continue;

      const occupancy = hash2(cellX, cellZ);
      const inward = 1 - radius / CITY_RADIUS;
      const near = radius < 118;
      let pathDistance = Number.POSITIVE_INFINITY;
      let streetAngle = 0;
      for (let index = 0; index < CAMERA_PATH.length - 1; index += 1) {
        const start = CAMERA_PATH[index];
        const end = CAMERA_PATH[index + 1];
        if (!start || !end) continue;
        const segmentDistance = distToSegment(x, z, start[0], start[1], end[0], end[1]);
        if (segmentDistance < pathDistance) {
          pathDistance = segmentDistance;
          streetAngle = Math.atan2(end[0] - start[0], end[1] - start[1]);
        }
      }
      // The whole first row of grid cells along the avenue becomes the street
      // wall: long mid-height fronts aligned with the nearest street segment,
      // so the canyon is closed by continuous facades at a real street
      // distance instead of random monumental lots the corridor test culls.
      const onStreetWall = pathDistance < 40;
      if (onStreetWall && pathDistance < 19) continue;

      const sectorFloat = ((Math.atan2(x, z) + Math.PI) / (Math.PI * 2)) * SECTOR_COUNT;
      const sectorIndex = Math.floor(sectorFloat) % SECTOR_COUNT;
      const sectorFract = sectorFloat - Math.floor(sectorFloat);
      if (!onStreetWall && (sectorFract < 0.04 || sectorFract > 0.96)) continue;
      const districtSeed = hash2(sectorIndex * 13 + 5, 91);
      // Street-wall lots are exempt from the district density roll: the
      // processional canyon must stay continuous even across sparse quarters.
      // Sparse quarters may thin the skyline but never open a whole vista:
      // even the loosest district keeps roughly half of its lots occupied.
      if (!onStreetWall && occupancy < 0.28 + districtSeed * 0.18) continue;

      // Three sparse monumental families (TYBW Wahr Welt grammar), with the
      // district seed shifting the mix so each quarter has a dominant family.
      // Sizes are set against the ~200-unit citadel (5-6x rule):
      //   terrace halls  — 22-34 wide, 16-26 deep, 26-40 high
      //   gate masses    — 26-38 wide, 18-28 deep, 34-52 high
      //   shoulder keeps — broader and lower, never house-like
      const familySeed = (hash2(cellX * 7 + 3, cellZ * 5 - 11) + districtSeed) % 1;
      const isGate = familySeed >= 0.45 && familySeed < 0.8;
      const isKeep = familySeed >= 0.8;
      const footprint = onStreetWall
        ? 10 + occupancy * 4
        : isKeep
          ? 30 + occupancy * 14
          : isGate
            ? 26 + occupancy * 12
            : 22 + occupancy * 12;
      const depth = onStreetWall
        ? 34 + occupancy * 8
        : isKeep
          ? 22 + occupancy * 12
          : isGate
            ? 18 + occupancy * 10
            : 16 + occupancy * 10;
      // Heights climb toward the castle so the skyline funnels the eye to the
      // citadel; the rim dips only modestly or the middle distance empties
      // out in the street-level frames.
      const districtRise = onStreetWall ? 1 : 0.82 + inward * 0.4;
      const height = (onStreetWall
        ? 24 + occupancy * 10
        : isKeep
          ? 18 + occupancy * 8
          : isGate
            ? 34 + occupancy * 18
            : 26 + occupancy * 14) * districtRise;
      const jitter = onStreetWall ? 0 : (hash2(cellZ, cellX) - 0.5) * 1.1;
      const lotX = x + jitter;
      const lotZ = z + (onStreetWall ? 0 : (hash2(cellX + 3, cellZ - 2) - 0.5) * 1.1);
      const lotRotation = onStreetWall
        ? streetAngle
        : Math.round(Math.atan2(x, z) / (Math.PI * 0.5)) * (Math.PI * 0.5);

      // Rare thin watch-towers rise between the low blocks (ref 11-55-14).
      // They replace the normal lot content entirely.
      const spireSeed = hash2(cellX * 11 - 7, cellZ * 13 + 41);
      if (!onStreetWall && spireSeed > 0.92) {
        const spireFoot = 9 + occupancy * 3;
        const spireDepth = 8 + occupancy * 3;
        if (!intersectsCameraCorridor(lotX, lotZ, spireFoot, spireDepth)) {
          placeLot(
            lotX,
            lotZ,
            spireFoot,
            spireDepth,
            (38 + occupancy * 16) * districtRise,
            lotRotation,
            near,
          );
        }
        continue;
      }

      // Street walls run parallel to the road, so the conservative
      // circumradius corridor test would cull them all; their perpendicular
      // clearance is already guaranteed by the pathDistance >= 19 gate above.
      const lotDepth = onStreetWall ? depth : footprint * (0.82 + occupancy * 0.28);
      if (!onStreetWall && intersectsCameraCorridor(lotX, lotZ, footprint, lotDepth)) continue;
      placeLot(
        lotX,
        lotZ,
        footprint,
        lotDepth,
        height,
        lotRotation,
        near,
      );
    }
  }

  // A continuous curtain of tall masses rings the outer rim. Wherever the
  // camera looks outward — especially across the cleared corridor fan at the
  // avenue turn — the vista must land on layered city, never on empty deck.
  // The corridor cut where the avenue crosses the rim reads as the outer
  // city gate.
  for (let index = 0; index < 34; index += 1) {
    const angle = (index / 34) * Math.PI * 2 + 0.07;
    const curtainSeed = hash2(index * 3 + 11, 577);
    const radius = 326 + curtainSeed * 14;
    const x = Math.sin(angle) * radius;
    const z = Math.cos(angle) * radius;
    const width = 36 + curtainSeed * 14;
    const depth = 18 + hash2(index, 613) * 8;
    if (intersectsCameraCorridor(x, z, width, depth)) continue;
    placeLot(
      x,
      z,
      width,
      depth,
      32 + curtainSeed * 20,
      Math.round(angle / (Math.PI * 0.5)) * (Math.PI * 0.5),
      false,
    );
  }

  // Authored anchors beyond the turn fan: the 6.4 frame looks straight across
  // the cleared corridor, so its middle ground is designed, not rolled.
  const turnAnchors = [
    { x: 112, z: 205, width: 38, depth: 28, height: 40 },
    { x: 122, z: 138, width: 34, depth: 26, height: 34 },
    { x: 100, z: 252, width: 42, depth: 30, height: 22 },
    { x: 62, z: 246, width: 30, depth: 22, height: 28 },
    { x: 150, z: 176, width: 32, depth: 24, height: 30 },
  ];
  for (const anchor of turnAnchors) {
    if (intersectsCameraCorridor(anchor.x, anchor.z, anchor.width, anchor.depth)) continue;
    placeLot(
      anchor.x,
      anchor.z,
      anchor.width,
      anchor.depth,
      anchor.height,
      Math.round(Math.atan2(anchor.x, anchor.z) / (Math.PI * 0.5)) * (Math.PI * 0.5),
      true,
    );
  }

  // A ceremonial ring of terrace keeps circles the castle court at a fixed
  // radius, every mass facing the citadel. The narrow height band reads as
  // one planned precinct wall; the corridor cut leaves the avenue mouth open.
  for (let index = 0; index < 12; index += 1) {
    const angle = (index / 12) * Math.PI * 2 + 0.11;
    const radius = 94;
    const x = Math.sin(angle) * radius;
    const z = Math.cos(angle) * radius;
    const width = 24;
    const depth = 20;
    if (intersectsCameraCorridor(x, z, width, depth)) continue;
    placeLot(
      x,
      z,
      width,
      depth,
      28 + (index % 3) * 3,
      angle,
      true,
    );
  }

  // Hero-route destruction is authored separately from the general lot
  // scatter. The sites sit just outside the camera corridor, so large rubble
  // fills the lower frame like the reference without intersecting the lens.
  // Debris hugs the building line (the roadway is ~7.7 half-width plus a
  // curb at 8.4): every site centre starts outside the curb so the street
  // itself stays a clean paved surface, exactly like the reference where the
  // rubble piles lean against facades, not the middle of the road.
  const ruinSites = [
    { x: 11.5, z: 315, scale: 0.72 },
    { x: -12.5, z: 304, scale: 0.75 },
    { x: -11.5, z: 291, scale: 0.66 },
    { x: 13, z: 286, scale: 0.62 },
    { x: -12.5, z: 264, scale: 0.8 },
    { x: 13.5, z: 241, scale: 0.66 },
    { x: -13.5, z: 217, scale: 0.9 },
    { x: 14, z: 194, scale: 0.72 },
    { x: -14.5, z: 170, scale: 0.92 },
    { x: 15.5, z: 146, scale: 0.76 },
    { x: -16, z: 124, scale: 0.95 },
  ];
  for (const [siteIndex, site] of ruinSites.entries()) {
    for (let index = 0; index < 9; index += 1) {
      const seed = hash2(siteIndex * 41 + index * 13, 700 + siteIndex * 17 - index * 19);
      const angle = seed * Math.PI * 2 + index * 0.83;
      const radius = 0.8 + hash2(index, siteIndex + 91) * 3.2 * site.scale;
      const size = (0.6 + seed * 1.5) * site.scale;
      const target = seed > 0.5 ? darkRubbleChunks : rubbleChunks;
      target.push({
        x: site.x + Math.cos(angle) * radius,
        y: CITY_DECK_Y + size * 0.3,
        z: site.z + Math.sin(angle) * radius,
        width: size * (0.65 + seed * 0.58),
        height: size * (0.45 + seed * 0.42),
        depth: size * (0.62 + hash2(index + 3, siteIndex) * 0.55),
        rotation: angle + seed,
        rotationX: (seed - 0.5) * 0.55,
        rotationZ: (hash2(siteIndex, index + 29) - 0.5) * 0.6,
      });
    }

    for (let index = 0; index < 3; index += 1) {
      const seed = hash2(siteIndex * 29 + index * 7, 911 - siteIndex * 23);
      const fragmentHeight = (1.4 + seed * 2.8) * site.scale;
      const fragmentWidth = (1.1 + hash2(index + 41, siteIndex) * 2.6) * site.scale;
      ruinWallFragments.push({
        x: site.x + (index - 1) * 1.7 + (seed - 0.5) * 1.3,
        y: CITY_DECK_Y + fragmentHeight * 0.46,
        z: site.z + (seed - 0.5) * 3.4,
        width: fragmentWidth,
        height: fragmentHeight,
        depth: 0.36 + seed * 0.55,
        rotation: seed * Math.PI,
        rotationX: (seed - 0.5) * 0.18,
        rotationZ: (hash2(siteIndex + 73, index) - 0.5) * 0.48,
      });
      rubbleSlabs.push({
        x: site.x + (seed - 0.5) * 3.8,
        y: CITY_DECK_Y + 0.2 + seed * 0.2,
        z: site.z + (index - 1) * 1.9,
        width: (1.6 + seed * 2.8) * site.scale,
        height: 0.28 + seed * 0.36,
        depth: (0.7 + seed * 1.6) * site.scale,
        rotation: seed * Math.PI * 1.7,
        rotationX: (seed - 0.5) * 0.24,
        rotationZ: (seed - 0.5) * 0.18,
      });
    }

    const columnSeed = hash2(siteIndex + 507, siteIndex * 37);
    ruinColumns.push({
      x: site.x + (columnSeed - 0.5) * 3,
      y: CITY_DECK_Y + 0.7 + columnSeed * 0.4,
      z: site.z + (hash2(siteIndex, 811) - 0.5) * 2.8,
      width: 0.45 + columnSeed * 0.45,
      height: (3.2 + columnSeed * 3.2) * site.scale,
      depth: 0.45 + columnSeed * 0.45,
      rotation: columnSeed * Math.PI,
      rotationX: 1.18 + columnSeed * 0.35,
      rotationZ: (columnSeed - 0.5) * 0.5,
    });
  }

  // The paved roadway (half-width 7.7 plus curbs at 8.4) must stay clean:
  // debris that lands inside the curb line is culled, so destruction reads as
  // piles against the facades instead of stones scattered across a plaza.
  removeRouteIntersections(rubbleChunks, 8.6);
  removeRouteIntersections(darkRubbleChunks, 8.6);
  removeRouteIntersections(rubbleSlabs, 8.6);
  removeRouteIntersections(ruinWallFragments, 9);
  removeRouteIntersections(ruinColumns, 9);

  // A real processional avenue makes the hero route legible as architecture,
  // not merely an accidental gap in the procedural scatter. Segment overlap
  // at turns forms broad stone junctions and hides any tiny miter gaps.
  for (let index = 0; index < CAMERA_PATH.length - 1; index += 1) {
    const start = CAMERA_PATH[index];
    const end = CAMERA_PATH[index + 1];
    if (!start || !end) continue;
    const dx = end[0] - start[0];
    const dz = end[1] - start[1];
    const length = Math.hypot(dx, dz);
    const rotation = Math.atan2(dx, dz);
    const rightX = Math.cos(rotation);
    const rightZ = -Math.sin(rotation);
    const midX = (start[0] + end[0]) * 0.5;
    const midZ = (start[1] + end[1]) * 0.5;
    avenueSlabs.push({
      x: midX,
      y: CITY_DECK_Y + 0.16,
      z: midZ,
      width: 15.4,
      height: 0.22,
      depth: length + 2.4,
      rotation,
    });
    for (const side of [-1, 1]) {
      avenueCurbs.push({
        x: midX + rightX * side * 8.4,
        y: CITY_DECK_Y + 0.42,
        z: midZ + rightZ * side * 8.4,
        width: 1.15,
        height: 0.72,
        depth: length + 1.4,
        rotation,
      });
    }
  }

  city.add(
    applyInstances('wahr-welt-processional-avenue', new THREE.BoxGeometry(1, 1, 1), plazaMaterial, avenueSlabs),
    applyInstances('wahr-welt-avenue-edge-blocks', new THREE.BoxGeometry(1, 1, 1), ledgeMaterial, avenueCurbs),
    applyInstances('wahr-welt-near-quarters', new THREE.BoxGeometry(1, 1, 1), nearFacade, nearBodies),
    applyInstances('wahr-welt-far-quarters', new THREE.BoxGeometry(1, 1, 1), farFacade, farBodies),
    applyInstances(
      'wahr-welt-hipped-roofs',
      new THREE.CylinderGeometry(0.2, 0.6, 1, 4, 1, false),
      roofMaterial,
      roofs,
    ),
    applyInstances('wahr-welt-flat-terrace-caps', new THREE.BoxGeometry(1, 1, 1), ledgeMaterial, flatCaps),
    applyInstances(
      'wahr-welt-broken-facade-courses',
      new THREE.BoxGeometry(1, 1, 1),
      ledgeMaterial,
      facadeCourseSegments,
    ),
    applyInstances(
      'wahr-welt-side-buttresses',
      new THREE.BoxGeometry(1, 1, 1),
      ledgeMaterial,
      facadeButtresses,
    ),
    applyInstances('wahr-welt-monumental-arched-voids', createMonumentalArchGeometry(), nicheMaterial, facadeNiches),
    applyInstances('wahr-welt-facade-ledges', new THREE.BoxGeometry(1, 1, 1), ledgeMaterial, facadeLedges),
    applyInstances('wahr-welt-facade-pilasters', new THREE.BoxGeometry(1, 1, 1), ledgeMaterial, facadePilasters),
    applyInstances('wahr-welt-broken-parapets', new THREE.BoxGeometry(1, 1, 1), ledgeMaterial, parapetTeeth),
    applyInstances(
      'wahr-welt-violet-growth-crust',
      new THREE.DodecahedronGeometry(0.5, 0),
      growthCrustMaterial,
      growthCrusts,
    ),
    applyInstances(
      'wahr-welt-violet-growth-shards',
      new THREE.ConeGeometry(0.5, 1, 5),
      growthCrustMaterial,
      growthShards,
    ),
    applyInstances(
      'wahr-welt-crystal-clusters',
      new THREE.ConeGeometry(0.5, 1, 5),
      growthCrustMaterial,
      crystalClusters,
    ),
    applyInstances(
      'wahr-welt-rubble-field',
      new THREE.DodecahedronGeometry(0.5, 0),
      rubbleMaterial,
      rubbleChunks,
    ),
    applyInstances(
      'wahr-welt-dark-rubble-field',
      new THREE.DodecahedronGeometry(0.5, 0),
      darkRubbleMaterial,
      darkRubbleChunks,
    ),
    applyInstances(
      'wahr-welt-collapsed-stone-slabs',
      new THREE.BoxGeometry(1, 1, 1),
      darkRubbleMaterial,
      rubbleSlabs,
    ),
    applyInstances(
      'wahr-welt-broken-wall-fragments',
      new THREE.BoxGeometry(1, 1, 1),
      rubbleMaterial,
      ruinWallFragments,
    ),
    applyInstances(
      'wahr-welt-collapsed-columns',
      new THREE.CylinderGeometry(0.5, 0.62, 1, 7, 1),
      darkRubbleMaterial,
      ruinColumns,
    ),
  );

  for (let variant = 0; variant < 3; variant += 1) {
    const stoneAlbedoMaterial = stoneAlbedoMaterials[variant];
    const wearMaterial = wearMaterials[variant];
    const growthMaterial = growthMaterials[variant];
    const variantWear = wearPanels[variant];
    const variantGrowth = growthCurtains[variant];
    void stoneAlbedoMaterial;
    void wearMaterial;
    void variantWear;
    if (growthMaterial && variantGrowth) {
      const growthMesh = applyInstances(
        `wahr-welt-violet-growth-${variant}`,
        new THREE.PlaneGeometry(1, 1),
        growthMaterial,
        variantGrowth,
      );
      growthMesh.renderOrder = 2;
      city.add(growthMesh);
    }
  }

  const undersideTeeth: InstanceTransform[] = [];
  for (const ring of [54, 104, 158, 214, 268]) {
    const count = Math.round(ring / 7.5);
    for (let index = 0; index < count; index += 1) {
      const angle = (index / count) * Math.PI * 2 + ring * 0.003;
      const height = 12 + (1 - ring / 280) * 38 + hash2(index, ring) * 16;
      undersideTeeth.push({
        x: Math.sin(angle) * ring,
        y: CITY_DECK_Y - 8 - height * 0.5,
        z: Math.cos(angle) * ring,
        width: 2.4 + hash2(ring, index) * 3.6,
        height,
        depth: 2.4 + hash2(index, ring + 1) * 3.6,
        rotation: angle + Math.PI * 0.25,
      });
    }
  }
  const hangingGeometry = new THREE.ConeGeometry(0.5, 1, 4);
  hangingGeometry.rotateZ(Math.PI);
  city.add(applyInstances('wahr-welt-hanging-infrastructure', hangingGeometry, farFacade, undersideTeeth));

  const rimGlow = createTypeGpuGlowMaterial(0x6d7ed0, 0.28);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(CITY_RADIUS - 2, 0.8, 6, 160), rimGlow.material);
  ring.name = `wahr-welt-energy-ring-${CITY_RADIUS - 2}`;
  ring.rotation.x = Math.PI * 0.5;
  ring.position.y = CITY_DECK_Y + 4.4;
  city.add(ring);

  const mistMaterial = createTypeGpuVoidMistMaterial(0x2a3558, 0.16);
  for (const [index, y] of [-54, -28, -4].entries()) {
    const mist = new THREE.Mesh(new THREE.PlaneGeometry(980, 980, 1, 1), mistMaterial);
    mist.name = `wahr-welt-procedural-void-mist-${index}`;
    mist.rotation.x = -Math.PI * 0.5;
    mist.position.y = y;
    mist.renderOrder = -2 + index;
    city.add(mist);
  }

  for (let index = 0; index < 12; index += 1) {
    const angle = (index / 12) * Math.PI * 2;
    const pylon = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 5.8, 24, 4), structural);
    pylon.position.set(
      Math.sin(angle) * (CITY_RADIUS - 9),
      CITY_DECK_Y + 11,
      Math.cos(angle) * (CITY_RADIUS - 9),
    );
    pylon.rotation.y = angle + Math.PI * 0.25;
    city.add(pylon);
  }

  return city;
};
