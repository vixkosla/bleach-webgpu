import * as THREE from 'three/webgpu';
import { createFloatingIsland } from './floatingIsland';
import { createCityOutskirts, OUTSKIRT_TOWERS } from './cityOutskirts';
import {
  createWahrWeltFlatMaterial,
  createWahrWeltFloorMaterial,
  createWahrWeltCrystalCoatingMaterial,
  createWahrWeltCrystalPrismMaterial,
  createWahrWeltStoneMaterial,
} from '../materials/wahrWeltCityMaterial';
import { CITY_DECK_Y, TOWER_Z } from './constants';
import { CrystalCoatingBuilder } from './crystalCoating';
import { CrystalClusterBuilder, collectCrystalWindowBounds } from './crystalClusters';
import { createCitadelCoatingOptions, clipCitadelCoating } from './citadelGrowth';
import type { CitadelPrism, PrismFace } from './citadelPrisms';
import { addCitadelGeometry, citadelTierPoint, createCitadelPrisms, intersectsCitadelFootprint, CITADEL_TIERS, CITADEL_WORLD_SCALE } from './citadelGeometry';

export interface CityMassSpec {
  name: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  upperScale: number;
  upperShiftX: number;
  upperShiftZ: number;
  rotationY?: number;
  tone: 'light' | 'mid' | 'dark';
  wings?: readonly CityMassWingSpec[];
  tierCount?: 1 | 2 | 3;
  tierSplit?: number;
}

interface CityMassWingSpec {
  offsetX: number;
  offsetZ: number;
  heightScale: number;
  upperScale: number;
}

interface CityLotMergePlan {
  role: 'anchor' | 'reserved';
  wings?: readonly CityMassWingSpec[];
}

interface CityDistrictSpec {
  name: string;
  kind: 'residential' | 'mixed';
  centerX: number;
  centerZ: number;
  columns: number;
  rows: number;
  spacingX: number;
  spacingZ: number;
  rotationY: number;
}

interface CityStreetSpec {
  name: string;
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  width: number;
}

interface CityPassageStairSpec {
  name: string;
  x: number;
  z: number;
  rotationY: number;
  width: number;
  steps: number;
}

type CityMillVariant = 'bulky' | 'short' | 'narrow' | 'tall';

interface CityMillVariantRecipe {
  spanMin: number;
  spanRange: number;
  heightBase: number;
  heightRange: number;
  heightMinRatio: number;
  heightMaxRatio: number;
  roofMin: number;
  roofRange: number;
  eaveScale: number;
}

export interface CityFreestandingTowerSpec {
  name: string;
  x: number;
  z: number;
  span: number;
  height: number;
  rotationY: number;
  variant: CityMillVariant;
  roofFraction: number;
  eaveScale: number;
  seed: number;
}

type GothicCivicFamily = 'great-hall' | 'bell-hall' | 'twin-chapel' | 'chapter-house';

interface GothicCivicSpec {
  anchorName: string;
  family: GothicCivicFamily;
  towerSide: -1 | 1;
}

// User-locked macro ratio: ordinary city structures are one fifth of the
// rejected blockout envelopes. The island, roads, court, and citadel keep
// their current scale so the true amount of urban space remains visible.
const CITY_BUILDING_PLAN_SCALE = 0.2;
// A small but persistent breathing gap between neighbouring lot envelopes.
// Keeping this separate from the 21/22-unit grid lets us loosen the city
// without moving districts, streets, landmarks, or the film camera route.
const CITY_BUILDING_GAP = 4.6;
// The user's 0.2x correction is retained in plan, but the reference street is
// made from tall, nearly level urban walls rather than one-storey miniatures.
// A separate vertical scale restores that street-canyon proportion without
// making each footprint large again.
const CITY_BUILDING_HEIGHT_SCALE = 0.42;

// Discrete ward terraces climb toward the citadel from the far front rim,
// then step back down behind it. Lifts stay small against the street walls
// so the processional avenue can remain on the original deck.
const getWardTerraceLift = (z: number): number => {
  if (z >= 400) return 0;
  if (z >= 190) return 3;
  if (z >= -40) return 5.6;
  if (z >= -270) return 3.6;
  return 1.4;
};

const getDeckY = (z: number): number => CITY_DECK_Y + getWardTerraceLift(z);

export interface BlockoutTowerController {
  group: THREE.Group;
  update: (_time: number) => void;
}

const createOutlineMaterial = (): THREE.LineBasicMaterial => new THREE.LineBasicMaterial({
  color: 0x100d18,
  transparent: true,
  opacity: 0.96,
  depthTest: true,
});

const addOutlinedGeometry = (
  parent: THREE.Object3D,
  geometry: THREE.BufferGeometry,
  material: THREE.Material | THREE.Material[],
  outlineMaterial: THREE.LineBasicMaterial,
  position: THREE.Vector3,
  scale: THREE.Vector3,
  name: string,
): THREE.Group => {
  const volume = new THREE.Group();
  volume.name = name;
  volume.position.copy(position);
  volume.scale.copy(scale);

  const fill = new THREE.Mesh(geometry, material);
  fill.name = `${name}-fill`;
  volume.add(fill);

  const outline = new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry, 18),
    outlineMaterial,
  );
  outline.name = `${name}-outline`;
  outline.renderOrder = 5;
  volume.add(outline);
  parent.add(volume);
  return volume;
};

const addOutlinedBox = (
  parent: THREE.Object3D,
  material: THREE.Material,
  outlineMaterial: THREE.LineBasicMaterial,
  width: number,
  height: number,
  depth: number,
  x: number,
  y: number,
  z: number,
  name: string,
): THREE.Group => addOutlinedGeometry(
  parent,
  new THREE.BoxGeometry(width, height, depth),
  material,
  outlineMaterial,
  new THREE.Vector3(x, y, z),
  new THREE.Vector3(1, 1, 1),
  name,
);

const createFacetedUnitPrismGeometry = (
  sides: number,
  openEnded = false,
): THREE.BufferGeometry => {
  const geometry = new THREE.CylinderGeometry(0.5, 0.5, 1, sides, 1, openEnded);
  const facetedGeometry = geometry.toNonIndexed();
  geometry.dispose();
  facetedGeometry.computeVertexNormals();
  return facetedGeometry;
};

const createFacetedUnitPyramidGeometry = (sides: number): THREE.BufferGeometry => {
  const geometry = new THREE.ConeGeometry(0.5, 1, sides, 1, true);
  const facetedGeometry = geometry.toNonIndexed();
  geometry.dispose();
  facetedGeometry.computeVertexNormals();
  return facetedGeometry;
};

const MILL_SHAFT_GEOMETRY = createFacetedUnitPrismGeometry(6, true);
const MILL_EAVE_GEOMETRY = createFacetedUnitPrismGeometry(6);
const MILL_PYRAMID_GEOMETRY = createFacetedUnitPyramidGeometry(6);
const MILL_HEX_SCALE = 2 / Math.sqrt(3);
const MILL_VARIANT_ORDER: readonly CityMillVariant[] = ['bulky', 'short', 'narrow', 'tall'];
const MILL_VARIANT_RECIPES: Record<CityMillVariant, CityMillVariantRecipe> = {
  // Kept as the accepted thick, tall grain-barn.
  bulky: {
    spanMin: 10.2,
    spanRange: 3.4,
    heightBase: 26,
    heightRange: 12,
    heightMinRatio: 2.45,
    heightMaxRatio: 3.3,
    roofMin: 0.26,
    roofRange: 0.06,
    eaveScale: 1.16,
  },
  short: {
    spanMin: 8.6,
    spanRange: 2.8,
    heightBase: 15,
    heightRange: 7,
    heightMinRatio: 1.5,
    heightMaxRatio: 2.05,
    roofMin: 0.32,
    roofRange: 0.08,
    eaveScale: 1.18,
  },
  narrow: {
    spanMin: 6.1,
    spanRange: 1.9,
    heightBase: 21,
    heightRange: 9,
    heightMinRatio: 2.7,
    heightMaxRatio: 3.55,
    roofMin: 0.27,
    roofRange: 0.06,
    eaveScale: 1.13,
  },
  tall: {
    spanMin: 7.2,
    spanRange: 2.1,
    heightBase: 34,
    heightRange: 12,
    heightMinRatio: 3.55,
    heightMaxRatio: 4.55,
    roofMin: 0.22,
    roofRange: 0.06,
    eaveScale: 1.12,
  },
};

const CITY_MASSES: readonly CityMassSpec[] = [
  { name: 'outer-west-complex', x: -150, z: 510, width: 170, depth: 105, height: 66, upperScale: 0.52, upperShiftX: -14, upperShiftZ: -8, rotationY: -0.08, tone: 'mid' },
  { name: 'outer-east-complex', x: 148, z: 500, width: 176, depth: 110, height: 78, upperScale: 0.46, upperShiftX: 20, upperShiftZ: 10, rotationY: 0.06, tone: 'light' },
  { name: 'middle-west-complex', x: -170, z: 300, width: 160, depth: 110, height: 74, upperScale: 0.58, upperShiftX: -12, upperShiftZ: 16, rotationY: 0.04, tone: 'dark' },
  { name: 'middle-east-complex', x: 172, z: 285, width: 162, depth: 105, height: 58, upperScale: 0.48, upperShiftX: 16, upperShiftZ: -14, rotationY: -0.07, tone: 'mid' },
  { name: 'lower-west-complex', x: -225, z: 105, width: 172, depth: 110, height: 86, upperScale: 0.42, upperShiftX: -20, upperShiftZ: 12, rotationY: -0.04, tone: 'light' },
  { name: 'lower-east-complex', x: 230, z: 90, width: 182, depth: 105, height: 68, upperScale: 0.56, upperShiftX: 12, upperShiftZ: -10, rotationY: 0.05, tone: 'mid' },
  { name: 'inner-west-complex', x: -205, z: -135, width: 152, depth: 100, height: 62, upperScale: 0.52, upperShiftX: -14, upperShiftZ: -10, rotationY: 0.08, tone: 'dark' },
  { name: 'inner-east-complex', x: 210, z: -145, width: 162, depth: 105, height: 82, upperScale: 0.44, upperShiftX: 19, upperShiftZ: 14, rotationY: -0.06, tone: 'light' },
  { name: 'west-curtain-outer', x: -375, z: 270, width: 88, depth: 210, height: 54, upperScale: 0.62, upperShiftX: -8, upperShiftZ: 20, rotationY: 0.12, tone: 'dark' },
  { name: 'east-curtain-outer', x: 378, z: 250, width: 90, depth: 218, height: 66, upperScale: 0.56, upperShiftX: 10, upperShiftZ: -16, rotationY: -0.1, tone: 'mid' },
  { name: 'west-curtain-inner', x: -335, z: -270, width: 96, depth: 184, height: 74, upperScale: 0.48, upperShiftX: -10, upperShiftZ: -12, rotationY: -0.12, tone: 'mid' },
  { name: 'east-curtain-inner', x: 340, z: -255, width: 94, depth: 178, height: 58, upperScale: 0.54, upperShiftX: 11, upperShiftZ: 16, rotationY: 0.1, tone: 'dark' },
] as const;

// Gothic architecture is a civic accent, not a city-wide skin. Four authored
// anchors are rebuilt as complete landmark families while the dense ordinary
// wards remain restrained enough to provide scale and visual rest.
const GOTHIC_CIVIC_SPECS: readonly GothicCivicSpec[] = [
  { anchorName: 'outer-west-complex', family: 'great-hall', towerSide: -1 },
  { anchorName: 'middle-east-complex', family: 'bell-hall', towerSide: 1 },
  { anchorName: 'lower-west-complex', family: 'twin-chapel', towerSide: -1 },
  { anchorName: 'inner-east-complex', family: 'chapter-house', towerSide: -1 },
] as const;

const getGothicCivicSpec = (anchorName: string): GothicCivicSpec | undefined => (
  GOTHIC_CIVIC_SPECS.find((spec) => spec.anchorName === anchorName)
);

const hashUnit = (column: number, row: number, salt: number): number => {
  const value = Math.sin(column * 12.9898 + row * 78.233 + salt * 37.719) * 43758.5453;
  return value - Math.floor(value);
};

interface CityVerticalTier {
  heightFraction: number;
  planScale: number;
  shiftFraction: number;
}

interface CityRenderPart extends CityMassWingSpec {
  widthScale: number;
  depthScale: number;
}

const createVerticalTierProfile = (
  spec: CityMassSpec,
  upperScale = spec.upperScale,
): readonly CityVerticalTier[] => {
  const fallbackTierSeed = hashUnit(Math.round(spec.x), Math.round(spec.z), 44);
  const tierCount = spec.tierCount
    ?? (fallbackTierSeed < 0.12 ? 1 : fallbackTierSeed < 0.5 ? 2 : 3);
  const split = Math.max(0, Math.min(
    1,
    spec.tierSplit ?? hashUnit(Math.round(spec.z), Math.round(spec.x), 45),
  ));

  if (tierCount === 1) {
    return [{ heightFraction: 1, planScale: 1, shiftFraction: 0 }];
  }

  if (tierCount === 2) {
    const lowerFraction = 0.42 + split * 0.36;
    return [
      { heightFraction: lowerFraction, planScale: 1, shiftFraction: 0 },
      {
        heightFraction: 1 - lowerFraction,
        planScale: upperScale,
        shiftFraction: 1,
      },
    ];
  }

  const lowerFraction = 0.34 + split * 0.18;
  const middleFraction = 0.36 - split * 0.12;
  return [
    { heightFraction: lowerFraction, planScale: 1, shiftFraction: 0 },
    {
      heightFraction: middleFraction,
      planScale: 1 - (1 - upperScale) * 0.72,
      shiftFraction: 0.46,
    },
    {
      heightFraction: 1 - lowerFraction - middleFraction,
      planScale: upperScale,
      shiftFraction: 1,
    },
  ];
};

const createCityRenderParts = (spec: CityMassSpec): readonly CityRenderPart[] => {
  const width = spec.width * CITY_BUILDING_PLAN_SCALE;
  const depth = spec.depth * CITY_BUILDING_PLAN_SCALE;
  const wings = spec.wings ?? [];
  if (wings.length === 0) {
    return [{
      offsetX: 0,
      offsetZ: 0,
      heightScale: 1,
      upperScale: spec.upperScale,
      widthScale: 1,
      depthScale: 1,
    }];
  }

  const primaryWing = wings[0];
  if (!primaryWing) return [];
  const bar: CityRenderPart = {
    offsetX: primaryWing.offsetX * 0.5,
    offsetZ: primaryWing.offsetZ * 0.5,
    heightScale: 1,
    upperScale: spec.upperScale,
    widthScale: primaryWing.offsetX === 0 ? 1 : 1 + Math.abs(primaryWing.offsetX) / width,
    depthScale: primaryWing.offsetZ === 0 ? 1 : 1 + Math.abs(primaryWing.offsetZ) / depth,
  };
  const transverseWing = wings[1];
  const collinearX = transverseWing
    && primaryWing.offsetZ === 0 && transverseWing.offsetZ === 0;
  const collinearZ = transverseWing
    && primaryWing.offsetX === 0 && transverseWing.offsetX === 0;
  if (transverseWing && (collinearX || collinearZ)) {
    const offsets = collinearX
      ? [0, primaryWing.offsetX, transverseWing.offsetX]
      : [0, primaryWing.offsetZ, transverseWing.offsetZ];
    const minimum = Math.min(...offsets);
    const maximum = Math.max(...offsets);
    return [{
      ...bar,
      offsetX: collinearX ? (minimum + maximum) * 0.5 : 0,
      offsetZ: collinearZ ? (minimum + maximum) * 0.5 : 0,
      widthScale: collinearX ? 1 + (maximum - minimum) / width : 1,
      depthScale: collinearZ ? 1 + (maximum - minimum) / depth : 1,
    }];
  }

  return transverseWing
    ? [bar, {
        ...transverseWing,
        widthScale: 1,
        depthScale: 1,
      }]
    : [bar];
};

const CITY_DISTRICTS: readonly CityDistrictSpec[] = [
  // Five continuous urban bands cover the island. Four wards per band keep
  // their own orientation, but their edges nearly meet; roads carve the open
  // space instead of buildings floating in unrelated clusters.
  { name: 'front-rim-west', kind: 'residential', centerX: -385, centerZ: 510, columns: 10, rows: 10, spacingX: 21, spacingZ: 22, rotationY: 0.055 },
  { name: 'front-core-west', kind: 'mixed', centerX: -138, centerZ: 510, columns: 14, rows: 10, spacingX: 21, spacingZ: 22, rotationY: -0.025 },
  { name: 'front-core-east', kind: 'mixed', centerX: 138, centerZ: 510, columns: 14, rows: 10, spacingX: 21, spacingZ: 22, rotationY: 0.02 },
  { name: 'front-rim-east', kind: 'residential', centerX: 385, centerZ: 510, columns: 10, rows: 10, spacingX: 21, spacingZ: 22, rotationY: -0.05 },

  { name: 'middle-rim-west', kind: 'residential', centerX: -385, centerZ: 300, columns: 10, rows: 10, spacingX: 21, spacingZ: 22, rotationY: 0.075 },
  { name: 'middle-core-west', kind: 'mixed', centerX: -138, centerZ: 300, columns: 14, rows: 10, spacingX: 21, spacingZ: 22, rotationY: 0.03 },
  { name: 'middle-core-east', kind: 'mixed', centerX: 138, centerZ: 300, columns: 14, rows: 10, spacingX: 21, spacingZ: 22, rotationY: -0.035 },
  { name: 'middle-rim-east', kind: 'residential', centerX: 385, centerZ: 300, columns: 10, rows: 10, spacingX: 21, spacingZ: 22, rotationY: -0.07 },

  { name: 'citadel-rim-west', kind: 'residential', centerX: -385, centerZ: 80, columns: 10, rows: 10, spacingX: 21, spacingZ: 22, rotationY: 0.055 },
  { name: 'citadel-core-west', kind: 'mixed', centerX: -138, centerZ: 80, columns: 14, rows: 10, spacingX: 21, spacingZ: 22, rotationY: -0.02 },
  { name: 'citadel-core-east', kind: 'mixed', centerX: 138, centerZ: 80, columns: 14, rows: 10, spacingX: 21, spacingZ: 22, rotationY: 0.025 },
  { name: 'citadel-rim-east', kind: 'residential', centerX: 385, centerZ: 80, columns: 10, rows: 10, spacingX: 21, spacingZ: 22, rotationY: -0.06 },

  { name: 'rear-rim-west', kind: 'residential', centerX: -385, centerZ: -140, columns: 10, rows: 10, spacingX: 21, spacingZ: 22, rotationY: -0.06 },
  { name: 'rear-core-west', kind: 'mixed', centerX: -138, centerZ: -140, columns: 14, rows: 10, spacingX: 21, spacingZ: 22, rotationY: 0.025 },
  { name: 'rear-core-east', kind: 'mixed', centerX: 138, centerZ: -140, columns: 14, rows: 10, spacingX: 21, spacingZ: 22, rotationY: -0.03 },
  { name: 'rear-rim-east', kind: 'residential', centerX: 385, centerZ: -140, columns: 10, rows: 10, spacingX: 21, spacingZ: 22, rotationY: 0.065 },

  { name: 'far-rear-rim-west', kind: 'residential', centerX: -385, centerZ: -385, columns: 10, rows: 13, spacingX: 21, spacingZ: 22, rotationY: -0.045 },
  { name: 'far-rear-core-west', kind: 'mixed', centerX: -138, centerZ: -385, columns: 14, rows: 13, spacingX: 21, spacingZ: 22, rotationY: -0.02 },
  { name: 'far-rear-core-east', kind: 'mixed', centerX: 138, centerZ: -385, columns: 14, rows: 13, spacingX: 21, spacingZ: 22, rotationY: 0.025 },
  { name: 'far-rear-rim-east', kind: 'residential', centerX: 385, centerZ: -385, columns: 10, rows: 13, spacingX: 21, spacingZ: 22, rotationY: 0.05 },
] as const;

const CITY_STREETS: readonly CityStreetSpec[] = [
  { name: 'processional-avenue', x1: 0, z1: 76, x2: 0, z2: 620, width: 16 },

  // True X-axis cross streets cut the north/south processional line at right
  // angles. They turn the front half into connected blocks rather than long
  // parallel rows of lots.
  { name: 'front-transverse', x1: -260, z1: 520, x2: 260, z2: 520, width: 6 },
  { name: 'middle-transverse', x1: -375, z1: 385, x2: 375, z2: 385, width: 6 },
  { name: 'inner-transverse', x1: -440, z1: 250, x2: 440, z2: 250, width: 6 },

  // The street graph bends between wards instead of radiating from the
  // citadel. Every segment joins another one; no isolated road ribbons.
  { name: 'west-front-junction', x1: -8, z1: 238, x2: -112, z2: 252, width: 7 },
  { name: 'west-front-lane', x1: -112, z1: 252, x2: -292, z2: 348, width: 7 },
  { name: 'west-outer-lane', x1: -292, z1: 348, x2: -360, z2: 360, width: 6 },
  { name: 'west-rim-lane', x1: -360, z1: 360, x2: -275, z2: 505, width: 6 },
  { name: 'east-front-junction', x1: 8, z1: 224, x2: 108, z2: 242, width: 7 },
  { name: 'east-front-lane', x1: 108, z1: 242, x2: 292, z2: 335, width: 7 },
  { name: 'east-outer-lane', x1: 292, z1: 335, x2: 360, z2: 350, width: 6 },
  { name: 'east-rim-lane', x1: 360, z1: 350, x2: 285, z2: 505, width: 6 },

  // Two narrow bypasses carry the network around the castle footprint.
  { name: 'west-citadel-approach', x1: -112, z1: 252, x2: -190, z2: 118, width: 7 },
  { name: 'west-citadel-bypass', x1: -190, z1: 118, x2: -205, z2: -126, width: 7 },
  { name: 'east-citadel-approach', x1: 108, z1: 242, x2: 194, z2: 106, width: 7 },
  { name: 'east-citadel-bypass', x1: 194, z1: 106, x2: 214, z2: -136, width: 7 },

  // The citadel interrupts the central cross street, so its two halves terminate
  // on the bypasses instead of cutting through the castle footprint.
  { name: 'west-citadel-transverse', x1: -455, z1: -118, x2: -205, z2: -118, width: 6 },
  { name: 'east-citadel-transverse', x1: 214, z1: -128, x2: 455, z2: -128, width: 6 },

  // The rear wards connect back together asymmetrically behind the citadel.
  { name: 'west-rear-lane', x1: -205, z1: -126, x2: -350, z2: -220, width: 7 },
  { name: 'west-rear-rim', x1: -350, z1: -220, x2: -350, z2: -360, width: 6 },
  { name: 'east-rear-lane', x1: 214, z1: -136, x2: 352, z2: -228, width: 7 },
  { name: 'east-rear-rim', x1: 352, z1: -228, x2: 350, z2: -360, width: 6 },
  { name: 'rear-cross-west', x1: -350, z1: -360, x2: -150, z2: -365, width: 6 },
  { name: 'rear-cross-center', x1: -150, z1: -365, x2: 105, z2: -414, width: 6 },
  { name: 'rear-cross-east', x1: 105, z1: -414, x2: 350, z2: -360, width: 6 },
  { name: 'rear-transverse', x1: -425, z1: -275, x2: 425, z2: -275, width: 6 },
  { name: 'far-rear-transverse', x1: -335, z1: -430, x2: 335, z2: -430, width: 6 },
] as const;

const CITY_PASSAGE_STAIRS: readonly CityPassageStairSpec[] = [
  { name: 'processional-side-step', x: -5.4, z: 448, rotationY: 0, width: 4.2, steps: 4 },
  { name: 'front-cross-step', x: -116, z: 520, rotationY: Math.PI * 0.5, width: 4.6, steps: 4 },
  { name: 'middle-cross-step', x: 128, z: 385, rotationY: Math.PI * 0.5, width: 4.4, steps: 3 },
  { name: 'west-bypass-step', x: -278, z: -118, rotationY: Math.PI * 0.5, width: 4.6, steps: 4 },
  { name: 'rear-cross-step', x: 292, z: -275, rotationY: Math.PI * 0.5, width: 4.8, steps: 4 },
  { name: 'far-rear-step', x: -92, z: -430, rotationY: Math.PI * 0.5, width: 4.4, steps: 3 },
] as const;

const distanceToStreet = (x: number, z: number, street: CityStreetSpec): number => {
  const dx = street.x2 - street.x1;
  const dz = street.z2 - street.z1;
  const lengthSquared = dx * dx + dz * dz;
  const projection = lengthSquared > 0
    ? Math.max(0, Math.min(1, ((x - street.x1) * dx + (z - street.z1) * dz) / lengthSquared))
    : 0;
  const closestX = street.x1 + dx * projection;
  const closestZ = street.z1 + dz * projection;
  return Math.hypot(x - closestX, z - closestZ);
};

const lotKey = (column: number, row: number): string => `${column}:${row}`;

const createDistrictMergePlan = (
  district: CityDistrictSpec,
  districtIndex: number,
): Map<string, CityLotMergePlan> => {
  const plan = new Map<string, CityLotMergePlan>();
  const hasCourtyard = districtIndex % 5 === 1;
  const courtyardColumn = Math.floor(district.columns * 0.5);
  const courtyardRow = Math.floor(district.rows * 0.5);
  const isCourtyardLot = (column: number, row: number): boolean => (
    hasCourtyard
    && (column === courtyardColumn || column === courtyardColumn - 1)
    && (row === courtyardRow || row === courtyardRow - 1)
  );

  const addMerge = (
    anchorColumn: number,
    anchorRow: number,
    shape: readonly (readonly [number, number])[],
    salt: number,
  ): boolean => {
    const cells = [[anchorColumn, anchorRow] as const].concat(
      shape.map(([offsetColumn, offsetRow]) => (
        [anchorColumn + offsetColumn, anchorRow + offsetRow] as const
      )),
    );
    if (cells.some(([column, row]) => (
        column < 0 || column >= district.columns
        || row < 0 || row >= district.rows
        || isCourtyardLot(column, row)
        || plan.has(lotKey(column, row))
      ))) return false;

    const wings = shape.map(([offsetColumn, offsetRow], wingIndex) => ({
      offsetX: offsetColumn * district.spacingX,
      offsetZ: offsetRow * district.spacingZ,
      heightScale: 0.9 + hashUnit(anchorColumn + wingIndex, anchorRow + districtIndex, salt) * 0.14,
      upperScale: 0.72 + hashUnit(anchorColumn + districtIndex, anchorRow + wingIndex, salt + 1) * 0.22,
    }));
    plan.set(lotKey(anchorColumn, anchorRow), { role: 'anchor', wings });
    for (const [column, row] of cells.slice(1)) {
      plan.set(lotKey(column, row), { role: 'reserved' });
    }
    return true;
  };

  // The old rule force-tiled every 3x3 patch as an L, a straight triple and a
  // double. From above those long bars joined into accidental U/H labyrinths.
  // Four short two-lot houses now cover eight cells and leave one individual
  // house. Rotating the domino partition changes its flow without ever making
  // a three-lot strip or an L-shaped pseudo-building.
  interface MergeTemplate {
    anchor: readonly [number, number];
    cells: readonly (readonly [number, number])[];
  }
  const dominoPartition: readonly MergeTemplate[] = [
    { anchor: [0, 0], cells: [[1, 0]] },
    { anchor: [2, 0], cells: [[0, 1]] },
    { anchor: [0, 1], cells: [[0, 1]] },
    { anchor: [1, 1], cells: [[0, 1]] },
  ];
  const rotateCell = (
    column: number,
    row: number,
    quarterTurns: number,
  ): readonly [number, number] => {
    let rotatedColumn = column;
    let rotatedRow = row;
    for (let turn = 0; turn < quarterTurns; turn += 1) {
      [rotatedColumn, rotatedRow] = [2 - rotatedRow, rotatedColumn];
    }
    return [rotatedColumn, rotatedRow];
  };

  const fullColumns = Math.floor(district.columns / 3) * 3;
  const fullRows = Math.floor(district.rows / 3) * 3;
  for (let blockRow = 0; blockRow < fullRows; blockRow += 3) {
    for (let blockColumn = 0; blockColumn < fullColumns; blockColumn += 3) {
      const quarterTurns = Math.floor(
        hashUnit(blockColumn + districtIndex * 31, blockRow, 28) * 4,
      );

      const addRotatedTemplate = (template: MergeTemplate, salt: number): void => {
        const [localAnchorColumn, localAnchorRow] = rotateCell(
          template.anchor[0],
          template.anchor[1],
          quarterTurns,
        );
        const rotatedShape = template.cells.map(([targetOffsetColumn, targetOffsetRow]) => {
          const [targetColumn, targetRow] = rotateCell(
            template.anchor[0] + targetOffsetColumn,
            template.anchor[1] + targetOffsetRow,
            quarterTurns,
          );
          return [
            targetColumn - localAnchorColumn,
            targetRow - localAnchorRow,
          ] as const;
        });
        addMerge(
          blockColumn + localAnchorColumn,
          blockRow + localAnchorRow,
          rotatedShape,
          salt,
        );
      };

      for (let templateIndex = 0; templateIndex < dominoPartition.length; templateIndex += 1) {
        const template = dominoPartition[templateIndex];
        if (template) addRotatedTemplate(template, 30 + templateIndex * 2);
      }
    }
  }

  // Widths and heights not divisible by three leave a perimeter strip. Pair a
  // minority of it, but never create the former three-lot edge bars.
  const edgeShapes = [
    [[1, 0]],
    [[0, 1]],
    [[-1, 0]],
    [[0, -1]],
  ] as const;
  for (let row = 0; row < district.rows; row += 1) {
    for (let column = 0; column < district.columns; column += 1) {
      if (column < fullColumns && row < fullRows) continue;
      if (isCourtyardLot(column, row) || plan.has(lotKey(column, row))) continue;
      if (hashUnit(column + districtIndex * 47, row, 37) < 0.18) continue;
      const shapeOffset = Math.floor(
        hashUnit(column + districtIndex * 41, row, 38) * edgeShapes.length,
      );
      for (let attempt = 0; attempt < edgeShapes.length; attempt += 1) {
        const shape = edgeShapes[(shapeOffset + attempt) % edgeShapes.length];
        if (shape && addMerge(column, row, shape, 40 + attempt * 2)) break;
      }
    }
  }
  return plan;
};

const createCityInfillMasses = (): CityMassSpec[] => {
  const infill: CityMassSpec[] = [];
  const tones: readonly CityMassSpec['tone'][] = ['light', 'mid', 'dark'];

  for (let districtIndex = 0; districtIndex < CITY_DISTRICTS.length; districtIndex += 1) {
    const district = CITY_DISTRICTS[districtIndex];
    if (!district) continue;
    // Controlled plan disorder works hierarchically. A whole ward receives a
    // small turn, rows bend gradually across it, and 3x3 building families
    // share one additional angle. This breaks the 90-degree CAD grid without
    // rotating every house independently into visual noise.
    const sectorTurn = (hashUnit(districtIndex, 0, 46) - 0.5) * 0.24;
    const sectorRotation = district.rotationY + sectorTurn;
    const sectorCos = Math.cos(sectorRotation);
    const sectorSin = Math.sin(sectorRotation);
    const linePhase = hashUnit(districtIndex, 1, 47) * Math.PI * 2;
    const mergePlan = createDistrictMergePlan(district, districtIndex);

    for (let row = 0; row < district.rows; row += 1) {
      for (let column = 0; column < district.columns; column += 1) {
        const merge = mergePlan.get(lotKey(column, row));
        if (merge?.role === 'reserved') continue;
        // Only four wards receive a deliberate 2x2 internal court. Randomly
        // deleting lots made the city read as a suburb scattered on a field.
        const hasCourtyard = districtIndex % 5 === 1;
        const courtyardColumn = Math.floor(district.columns * 0.5);
        const courtyardRow = Math.floor(district.rows * 0.5);
        if (
          hasCourtyard
          && (column === courtyardColumn || column === courtyardColumn - 1)
          && (row === courtyardRow || row === courtyardRow - 1)
        ) continue;

        // Small deterministic vacancies keep the dense fabric believable.
        // The pair hash is shared by two horizontal neighbours, so an entire
        // two-lot pocket disappears together rather than producing noise one
        // isolated cell at a time.
        const pairColumn = column - (column % 2);
        const pairVacancy = hashUnit(pairColumn + districtIndex * 23, row, 21) < 0.042;
        const singleVacancy = hashUnit(column + districtIndex * 29, row, 22) < 0.032;
        if (merge?.role !== 'anchor' && (pairVacancy || singleVacancy)) continue;

        // Lots are grouped into short perimeter blocks. A few extra units at
        // every fourth/fifth lot form narrow service lanes, while shared row
        // drift prevents the plan from reading as one computer-perfect grid.
        const blockColumn = Math.floor(column / 5);
        const blockRow = Math.floor(row / 4);
        const blockColumnCenter = Math.floor((district.columns - 1) / 5) * 0.5;
        const blockRowCenter = Math.floor((district.rows - 1) / 4) * 0.5;
        const blockOffsetX = (blockColumn - blockColumnCenter) * 3.4;
        const blockOffsetZ = (blockRow - blockRowCenter) * 3.2;
        const rowDrift = (hashUnit(districtIndex, row, 11) - 0.5) * 5.2;
        const columnDrift = (hashUnit(column, districtIndex, 12) - 0.5) * 3.6;
        const localX = (column - (district.columns - 1) * 0.5) * district.spacingX
          + blockOffsetX + rowDrift;
        const localZ = (row - (district.rows - 1) * 0.5) * district.spacingZ
          + blockOffsetZ + columnDrift;
        const rotationGroupColumn = Math.floor(column / 3);
        const rotationGroupRow = Math.floor(row / 3);
        const rotationGroupStartColumn = rotationGroupColumn * 3;
        const rotationGroupStartRow = rotationGroupRow * 3;
        const rotationGroupColumnCount = Math.min(
          3,
          district.columns - rotationGroupStartColumn,
        );
        const rotationGroupRowCount = Math.min(
          3,
          district.rows - rotationGroupStartRow,
        );
        const rotationGroupCenterColumn = rotationGroupStartColumn
          + (rotationGroupColumnCount - 1) * 0.5;
        const rotationGroupCenterRow = rotationGroupStartRow
          + (rotationGroupRowCount - 1) * 0.5;
        const rotationGroupCenterX = (
          rotationGroupCenterColumn - (district.columns - 1) * 0.5
        ) * district.spacingX;
        const rotationGroupCenterZ = (
          rotationGroupCenterRow - (district.rows - 1) * 0.5
        ) * district.spacingZ;
        const groupNoise = (
          hashUnit(rotationGroupColumn + districtIndex * 17, rotationGroupRow, 48) * 2
          + hashUnit(rotationGroupColumn + 1 + districtIndex * 17, rotationGroupRow, 48)
          + hashUnit(rotationGroupColumn + districtIndex * 17, rotationGroupRow + 1, 48)
        ) * 0.25 - 0.5;
        const groupAccent = hashUnit(
          rotationGroupColumn + districtIndex * 13,
          rotationGroupRow,
          49,
        ) > 0.82 ? 1.45 : 1;
        const groupTurn = groupNoise * 0.2 * groupAccent;
        const rowProgress = district.rows > 1 ? row / (district.rows - 1) : 0;
        const lineTurn = Math.sin(rowProgress * Math.PI * 1.65 + linePhase) * 0.07;
        const groupCos = Math.cos(groupTurn);
        const groupSin = Math.sin(groupTurn);
        const groupDeltaX = localX - rotationGroupCenterX;
        const groupDeltaZ = localZ - rotationGroupCenterZ;
        const groupedLocalX = rotationGroupCenterX
          + groupDeltaX * groupCos + groupDeltaZ * groupSin;
        const groupedLocalZ = rotationGroupCenterZ
          - groupDeltaX * groupSin + groupDeltaZ * groupCos;
        // A mild row shear makes neighbouring lines flow into one another
        // instead of becoming a set of separately rotated rigid chessboards.
        const flowedLocalZ = groupedLocalZ - groupedLocalX * Math.tan(lineTurn * 0.52);
        const jitterX = (hashUnit(column + districtIndex * 13, row, 1) - 0.5) * 1.8;
        const jitterZ = (hashUnit(column + districtIndex * 17, row, 2) - 0.5) * 1.8;
        const x = district.centerX
          + groupedLocalX * sectorCos + flowedLocalZ * sectorSin + jitterX;
        const z = district.centerZ
          - groupedLocalX * sectorSin + flowedLocalZ * sectorCos + jitterZ;

        const seedColumn = column + districtIndex * 19;
        const widthSeed = hashUnit(seedColumn, row, 3);
        const depthSeed = hashUnit(seedColumn, row, 4);
        // Neighbours in one block share most of their roofline. Minor lot
        // variation remains, but the city reads as level urban shelves.
        const blockHeightSeed = hashUnit(
          blockColumn + districtIndex * 7,
          blockRow,
          5,
        );
        const heightSeed = blockHeightSeed * 0.76 + hashUnit(seedColumn, row, 5) * 0.24;
        const toneIndex = Math.floor(hashUnit(seedColumn, row, 6) * tones.length);
        const isMerged = merge?.role === 'anchor';
        const candidateWings = isMerged ? merge.wings ?? [] : [];
        const individualTurn = isMerged
          ? 0
          : (hashUnit(seedColumn, row, 13) - 0.5) * 0.05;
        const massRotation = sectorRotation + groupTurn + lineTurn + individualTurn;
        const massCos = Math.cos(massRotation);
        const massSin = Math.sin(massRotation);
        // Every lot keeps a real negative slot. The former near-maximum sizes
        // touched across neighbouring rotation groups and made separate roofs
        // read as one malformed generated building.
        const singleWidth = district.kind === 'mixed'
          ? 68 + widthSeed * 24
          : 58 + widthSeed * 32;
        const singleDepth = district.kind === 'mixed'
          ? 72 + depthSeed * 26
          : 66 + depthSeed * 34;
        const width = isMerged
          ? (district.spacingX - CITY_BUILDING_GAP) / CITY_BUILDING_PLAN_SCALE
          : Math.min(
              singleWidth,
              (district.spacingX - CITY_BUILDING_GAP) / CITY_BUILDING_PLAN_SCALE,
            );
        const depth = isMerged
          ? (district.spacingZ - CITY_BUILDING_GAP) / CITY_BUILDING_PLAN_SCALE
          : Math.min(
              singleDepth,
              (district.spacingZ - CITY_BUILDING_GAP) / CITY_BUILDING_PLAN_SCALE,
            );
        const finalHalfFootprint = Math.min(
          width * CITY_BUILDING_PLAN_SCALE,
          depth * CITY_BUILDING_PLAN_SCALE,
        ) * 0.5;
        const footprintCenters = [
          { x, z },
          ...candidateWings.map((wing) => ({
            x: x + wing.offsetX * massCos + wing.offsetZ * massSin,
            z: z - wing.offsetX * massSin + wing.offsetZ * massCos,
          })),
        ];

        // Keep every section of a double or L-shaped complex inside the island
        // and out of the street/citadel clearances. If a merged anchor cannot
        // fit, its reserved lots simply become one of the requested open pockets.
        const outsideIsland = footprintCenters.some((center) => {
          const islandX = center.x / 490;
          const islandZ = center.z / 608;
          return islandX * islandX + islandZ * islandZ > 0.99;
        });
        if (outsideIsland) continue;

        // Roads are the negative space between almost touching street walls.
        // The test includes the actual building half-width, leaving only a
        // one-to-two unit frontage setback beyond the paved strip.
        const overlapsStreet = CITY_STREETS.some((street) => (
          footprintCenters.some((center) => (
            distanceToStreet(center.x, center.z, street) < street.width * 0.5
              + finalHalfFootprint
              + (street.width >= 12 ? 2.2 : 1.2)
          ))
        ));
        if (overlapsStreet) continue;
        const overlapsCitadel = footprintCenters.some((center) => (
          intersectsCitadelFootprint(center.x, center.z,
            width * CITY_BUILDING_PLAN_SCALE, depth * CITY_BUILDING_PLAN_SCALE, massRotation)
        ));
        if (overlapsCitadel) continue;

        // The authored anchors are the larger civic/non-residential complexes.
        // Pack houses right up to them, but never intersect their footprints.
        const overlapsAnchor = CITY_MASSES.some((anchor) => (
          footprintCenters.some((center) => (
            Math.abs(anchor.x - center.x) < (anchor.width + width) * CITY_BUILDING_PLAN_SCALE * 0.5 + 6.5
            && Math.abs(anchor.z - center.z) < (anchor.depth + depth) * CITY_BUILDING_PLAN_SCALE * 0.5 + 6.5
          ))
        ));
        if (overlapsAnchor) continue;

        const heightBase = district.kind === 'mixed' ? 66 : 60;
        const heightRange = district.kind === 'mixed' ? 22 : 18;
        const upperScaleBase = district.kind === 'mixed' ? 0.6 : 0.56;
        const tierSeed = hashUnit(seedColumn, row, 14);
        infill.push({
          name: `city-infill-${district.name}-${row}-${column}`,
          x,
          z,
          // Plan dimensions remain 0.2x. Their narrow range creates continuous
          // row-house walls; their taller, also narrow height range produces a
          // level Dark-Souls-like city shelf beneath the citadel.
          width,
          depth,
          height: heightBase + heightSeed * heightRange,
          upperScale: upperScaleBase + hashUnit(seedColumn, row, 7) * (0.96 - upperScaleBase),
          upperShiftX: (hashUnit(seedColumn, row, 8) - 0.5) * 8,
          upperShiftZ: (hashUnit(seedColumn, row, 9) - 0.5) * 8,
          rotationY: massRotation,
          tone: tones[Math.min(toneIndex, tones.length - 1)] ?? 'mid',
          wings: candidateWings,
          tierCount: tierSeed < 0.16 ? 1 : tierSeed < 0.62 ? 2 : 3,
          tierSplit: hashUnit(seedColumn, row, 15),
        });
      }
    }
  }

  return infill;
};

const CITY_INFILL_MASSES = createCityInfillMasses();

const createFreestandingCityTowers = (): CityFreestandingTowerSpec[] => {
  const cityMasses = [...CITY_MASSES, ...CITY_INFILL_MASSES];
  const candidates: Array<{
    x: number;
    z: number;
    score: number;
    span: number;
    height: number;
    variant: CityMillVariant;
    roofFraction: number;
    eaveScale: number;
  }> = [];

  const overlapsBuilding = (x: number, z: number, radius: number): boolean => (
    cityMasses.some((spec) => {
      const rotationY = spec.rotationY ?? 0;
      const cos = Math.cos(rotationY);
      const sin = Math.sin(rotationY);
      const dx = x - spec.x;
      const dz = z - spec.z;
      // Inverse of the city's local-to-world rotation convention.
      const localX = dx * cos - dz * sin;
      const localZ = dx * sin + dz * cos;
      return createCityRenderParts(spec).some((part) => {
        const partWidth = spec.width * CITY_BUILDING_PLAN_SCALE * part.widthScale;
        const partDepth = spec.depth * CITY_BUILDING_PLAN_SCALE * part.depthScale;
        return Math.abs(localX - part.offsetX) < partWidth * 0.5 + radius + 1.2
          && Math.abs(localZ - part.offsetZ) < partDepth * 0.5 + radius + 1.2;
      });
    })
  );

  // Probe the actual negative space left by the accepted block plan. A mill
  // is admitted only where its own small footprint clears buildings, streets,
  // the citadel court and the island edge; it never grows from another roof.
  for (let row = 0; row < 46; row += 1) {
    for (let column = 0; column < 40; column += 1) {
      const x = -430 + column * 22 + (hashUnit(column, row, 101) - 0.5) * 7;
      const z = -510 + row * 23 + (hashUnit(column, row, 102) - 0.5) * 7;
      const islandX = x / 470;
      const islandZ = z / 585;
      if (islandX * islandX + islandZ * islandZ > 0.92) continue;
      if (Math.abs(x) < 186 && Math.abs(z) < 132) continue;

      const variant = MILL_VARIANT_ORDER[
        Math.floor(hashUnit(column, row, 109) * MILL_VARIANT_ORDER.length)
      ] ?? 'bulky';
      const recipe = MILL_VARIANT_RECIPES[variant];
      const span = recipe.spanMin + hashUnit(column, row, 103) * recipe.spanRange;
      const heightSeed = hashUnit(column, row, 107);
      const height = THREE.MathUtils.clamp(
        recipe.heightBase + heightSeed * recipe.heightRange,
        span * recipe.heightMinRatio,
        span * recipe.heightMaxRatio,
      );
      const radius = span * 0.5;
      if (intersectsCitadelFootprint(x, z, span * recipe.eaveScale, span * recipe.eaveScale, 0, 7)) continue;
      if (CITY_STREETS.some((street) => (
        distanceToStreet(x, z, street) < street.width * 0.5 + radius + 1
      ))) continue;
      if (overlapsBuilding(x, z, radius)) continue;

      candidates.push({
        x,
        z,
        span,
        height,
        variant,
        roofFraction: recipe.roofMin + hashUnit(column, row, 110) * recipe.roofRange,
        eaveScale: recipe.eaveScale,
        score: hashUnit(column, row, 104),
      });
    }
  }
  candidates.sort((a, b) => b.score - a.score);

  const towers: CityFreestandingTowerSpec[] = [];
  const variantCounts: Record<CityMillVariant, number> = {
    bulky: 0,
    short: 0,
    narrow: 0,
    tall: 0,
  };
  for (const candidate of candidates) {
    if (towers.length >= 20) break;
    if (variantCounts[candidate.variant] >= 5) continue;
    if (towers.some((tower) => (
      Math.hypot(tower.x - candidate.x, tower.z - candidate.z) < 48
    ))) continue;

    const index = towers.length;
    variantCounts[candidate.variant] += 1;
    towers.push({
      name: `city-freestanding-tower-mill-${candidate.variant}-${index + 1}`,
      x: candidate.x,
      z: candidate.z,
      span: candidate.span,
      height: candidate.height,
      rotationY: (candidate.score - 0.5) * 0.5,
      variant: candidate.variant,
      roofFraction: candidate.roofFraction,
      eaveScale: candidate.eaveScale,
      seed: candidate.score,
    });
  }
  for (const candidate of candidates) {
    if (towers.length >= 20) break;
    if (towers.some((tower) => (
      Math.hypot(tower.x - candidate.x, tower.z - candidate.z) < 48
    ))) continue;
    const index = towers.length;
    towers.push({
      name: `city-freestanding-tower-mill-${candidate.variant}-${index + 1}`,
      x: candidate.x,
      z: candidate.z,
      span: candidate.span,
      height: candidate.height,
      rotationY: (candidate.score - 0.5) * 0.5,
      variant: candidate.variant,
      roofFraction: candidate.roofFraction,
      eaveScale: candidate.eaveScale,
      seed: candidate.score,
    });
  }
  return towers;
};

const CITY_FREESTANDING_TOWERS = createFreestandingCityTowers();

const addCityMass = (
  parent: THREE.Group,
  spec: CityMassSpec,
  materials: Record<CityMassSpec['tone'], THREE.Material>,
  outlineMaterial: THREE.LineBasicMaterial,
): void => {
  const material = materials[spec.tone];
  const width = spec.width * CITY_BUILDING_PLAN_SCALE;
  const depth = spec.depth * CITY_BUILDING_PLAN_SCALE;
  const height = spec.height * CITY_BUILDING_HEIGHT_SCALE;
  const complex = new THREE.Group();
  complex.name = spec.name;
  complex.position.set(spec.x, 0, spec.z);
  complex.rotation.y = spec.rotationY ?? 0;
  parent.add(complex);
  const tiers = createVerticalTierProfile(spec);
  let accumulatedHeight = 0;
  for (let tierIndex = 0; tierIndex < tiers.length; tierIndex += 1) {
    const tier = tiers[tierIndex];
    if (!tier) continue;
    const tierHeight = height * tier.heightFraction;
    addOutlinedBox(
      complex,
      material,
      outlineMaterial,
      width * tier.planScale,
      tierHeight,
      depth * tier.planScale,
      spec.upperShiftX * CITY_BUILDING_PLAN_SCALE * tier.shiftFraction,
      getDeckY(spec.z) + accumulatedHeight + tierHeight * 0.5,
      spec.upperShiftZ * CITY_BUILDING_PLAN_SCALE * tier.shiftFraction,
      `${spec.name}-tier-${tierIndex + 1}`,
    );
    accumulatedHeight += tierHeight;
  }
};

const addFreestandingCityTower = (
  parent: THREE.Group,
  spec: CityFreestandingTowerSpec,
  stoneMaterial: THREE.Material,
  roofMaterial: THREE.Material,
  slitMaterial: THREE.Material,
  outlineMaterial: THREE.LineBasicMaterial,
): void => {
  const tower = new THREE.Group();
  tower.name = spec.name;
  tower.position.set(spec.x, 0, spec.z);
  tower.rotation.y = spec.rotationY;
  parent.add(tower);

  const roofHeight = spec.height * spec.roofFraction;
  const eaveHeight = THREE.MathUtils.clamp(spec.span * 0.048, 0.38, 0.62);
  const eaveOverlap = 0.22;
  const shaftHeight = spec.height - roofHeight - eaveHeight;
  const prismScale = spec.span * MILL_HEX_SCALE;
  const eaveScale = prismScale * spec.eaveScale;
  const deckY = getDeckY(spec.z);
  const terraceLift = getWardTerraceLift(spec.z);
  if (terraceLift > 0.25) {
    addOutlinedGeometry(
      tower,
      MILL_EAVE_GEOMETRY,
      stoneMaterial,
      outlineMaterial,
      new THREE.Vector3(0, CITY_DECK_Y + terraceLift * 0.5, 0),
      new THREE.Vector3(prismScale * 1.08, terraceLift, prismScale * 1.08),
      `${spec.name}-mill-podium`,
    );
  }

  addOutlinedGeometry(
    tower,
    MILL_SHAFT_GEOMETRY,
    stoneMaterial,
    outlineMaterial,
    new THREE.Vector3(0, deckY + shaftHeight * 0.5, 0),
    new THREE.Vector3(prismScale, shaftHeight, prismScale),
    `${spec.name}-mill-shaft`,
  );
  addOutlinedGeometry(
    tower,
    MILL_EAVE_GEOMETRY,
    roofMaterial,
    outlineMaterial,
    new THREE.Vector3(0, deckY + shaftHeight - eaveOverlap + eaveHeight * 0.5, 0),
    new THREE.Vector3(eaveScale, eaveHeight, eaveScale),
    `${spec.name}-mill-eave`,
  );
  addOutlinedGeometry(
    tower,
    MILL_PYRAMID_GEOMETRY,
    roofMaterial,
    outlineMaterial,
    new THREE.Vector3(0, deckY + shaftHeight + eaveHeight + roofHeight * 0.5 - 0.22, 0),
    new THREE.Vector3(eaveScale * 0.98, roofHeight, eaveScale * 0.98),
    `${spec.name}-mill-roof`,
  );

  if (spec.seed > 0.44 && shaftHeight > 11) {
    const doorWidth = THREE.MathUtils.clamp(spec.span * 0.18, 0.85, 1.35);
    const doorHeight = THREE.MathUtils.clamp(shaftHeight * 0.18, 2.6, 4.4);
    addOutlinedBox(
      tower,
      slitMaterial,
      outlineMaterial,
      doorWidth,
      doorHeight,
      0.28,
      0,
      deckY + shaftHeight * 0.2,
      spec.span * 0.5 + 0.12,
      `${spec.name}-mill-door`,
    );
  }
};

const addCityInfillInstances = (
  parent: THREE.Group,
  specs: readonly CityMassSpec[],
  material: THREE.Material,
): void => {
  // Thousands of closely packed envelopes use three instanced tier pools rather than
  // thousands of individual meshes. The global toon outline pass still draws
  // their depth silhouettes, while the authored civic anchors retain explicit
  // construction edges for proportion inspection.
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  // A double is one uninterrupted bar; an L is that bar plus one transverse
  // wing. This removes the visual seam that previously made merged lots still
  // look like repeated individual cubes.
  const totalPartCount = specs.reduce(
    (count, spec) => count + createCityRenderParts(spec).length,
    0,
  );
  const tierInstances = [
    new THREE.InstancedMesh(geometry, material, totalPartCount),
    new THREE.InstancedMesh(geometry, material, totalPartCount),
    new THREE.InstancedMesh(geometry, material, totalPartCount),
  ];
  tierInstances[0]!.name = 'blockout-city-infill-lower';
  tierInstances[1]!.name = 'blockout-city-infill-middle';
  tierInstances[2]!.name = 'blockout-city-infill-upper';
  for (const instances of tierInstances) instances.frustumCulled = false;

  const dummy = new THREE.Object3D();
  const tierInstanceIndices = [0, 0, 0];
  for (const spec of specs) {
    if (!spec) continue;
    const rotationY = spec.rotationY ?? 0;
    const width = spec.width * CITY_BUILDING_PLAN_SCALE;
    const depth = spec.depth * CITY_BUILDING_PLAN_SCALE;
    const cos = Math.cos(rotationY);
    const sin = Math.sin(rotationY);
    const parts = createCityRenderParts(spec);

    for (const part of parts) {
      const baseX = spec.x + part.offsetX * cos + part.offsetZ * sin;
      const baseZ = spec.z - part.offsetX * sin + part.offsetZ * cos;
      const height = spec.height * CITY_BUILDING_HEIGHT_SCALE * part.heightScale;
      const shiftX = spec.upperShiftX * CITY_BUILDING_PLAN_SCALE;
      const shiftZ = spec.upperShiftZ * CITY_BUILDING_PLAN_SCALE;
      const tiers = createVerticalTierProfile(spec, part.upperScale);
      let accumulatedHeight = 0;
      for (let tierIndex = 0; tierIndex < tiers.length; tierIndex += 1) {
        const tier = tiers[tierIndex];
        const instances = tierInstances[tierIndex];
        if (!tier || !instances) continue;
        const tierHeight = height * tier.heightFraction;
        dummy.position.set(
          baseX + shiftX * tier.shiftFraction * cos + shiftZ * tier.shiftFraction * sin,
          getDeckY(spec.z) + accumulatedHeight + tierHeight * 0.5,
          baseZ - shiftX * tier.shiftFraction * sin + shiftZ * tier.shiftFraction * cos,
        );
        dummy.rotation.set(0, rotationY, 0);
        dummy.scale.set(
          width * part.widthScale * tier.planScale,
          tierHeight,
          depth * part.depthScale * tier.planScale,
        );
        dummy.updateMatrix();
        const instanceIndex = tierInstanceIndices[tierIndex] ?? 0;
        instances.setMatrixAt(instanceIndex, dummy.matrix);
        tierInstanceIndices[tierIndex] = instanceIndex + 1;
        accumulatedHeight += tierHeight;
      }
    }
  }
  for (let tierIndex = 0; tierIndex < tierInstances.length; tierIndex += 1) {
    const instances = tierInstances[tierIndex];
    if (!instances) continue;
    instances.count = tierInstanceIndices[tierIndex] ?? 0;
    instances.instanceMatrix.needsUpdate = true;
    parent.add(instances);
  }
};

interface CityDetailTransform {
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  depth: number;
  rotationY: number;
  rotationX?: number;
  rotationZ?: number;
}

interface CityTierVolume {
  x: number;
  z: number;
  width: number;
  depth: number;
  bottomY: number;
  height: number;
  rotationY: number;
  tierIndex: number;
  tierCount: number;
}

type CityFacadeAxis = 'x' | 'z';

type CityWindowFamily = 'arrow' | 'narrow' | 'vertical' | 'broad' | 'grand';

interface CityWindowProfile {
  family: CityWindowFamily;
  width: number;
  heightAspect: number;
  density: number;
}

const createCityWindowProfile = (
  spec: CityMassSpec,
  specIndex: number,
): CityWindowProfile => {
  const familySeed = hashUnit(
    Math.round(spec.x) + specIndex * 31,
    Math.round(spec.z) - specIndex * 19,
    81,
  );
  const sizeSeed = hashUnit(
    Math.round(spec.z) + specIndex * 23,
    Math.round(spec.x) - specIndex * 29,
    82,
  );

  // A complete building owns one aperture profile. The exact width still
  // varies inside each family, so adjacent houses no longer share one office-
  // window module merely because their facade lengths happen to be similar.
  if (familySeed < 0.18) {
    return {
      family: 'arrow',
      width: THREE.MathUtils.lerp(0.42, 0.68, sizeSeed),
      heightAspect: THREE.MathUtils.lerp(5.1, 6.4, 1 - sizeSeed),
      density: 1.18,
    };
  }
  if (familySeed < 0.39) {
    return {
      family: 'narrow',
      width: THREE.MathUtils.lerp(0.72, 1.08, sizeSeed),
      heightAspect: THREE.MathUtils.lerp(3.3, 4.4, sizeSeed),
      density: 1,
    };
  }
  if (familySeed < 0.64) {
    return {
      family: 'vertical',
      width: THREE.MathUtils.lerp(1.12, 1.72, sizeSeed),
      heightAspect: THREE.MathUtils.lerp(2.45, 3.35, 1 - sizeSeed),
      density: 0.9,
    };
  }
  if (familySeed < 0.84) {
    return {
      family: 'broad',
      width: THREE.MathUtils.lerp(1.82, 2.72, sizeSeed),
      heightAspect: THREE.MathUtils.lerp(1.35, 1.9, sizeSeed),
      density: 0.7,
    };
  }
  return {
    family: 'grand',
    width: THREE.MathUtils.lerp(2.8, 4.15, sizeSeed),
    heightAspect: THREE.MathUtils.lerp(1.55, 2.25, 1 - sizeSeed),
    density: 0.5,
  };
};

const addDetailInstances = (
  parent: THREE.Group,
  name: string,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  transforms: readonly CityDetailTransform[],
): void => {
  if (transforms.length === 0) return;
  const instances = new THREE.InstancedMesh(geometry, material, transforms.length);
  instances.name = name;
  instances.frustumCulled = false;
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const rotation = new THREE.Euler();
  transforms.forEach((transform, index) => {
    position.set(transform.x, transform.y, transform.z);
    rotation.set(
      transform.rotationX ?? 0,
      transform.rotationY,
      transform.rotationZ ?? 0,
    );
    quaternion.setFromEuler(rotation);
    scale.set(transform.width, transform.height, transform.depth);
    matrix.compose(position, quaternion, scale);
    instances.setMatrixAt(index, matrix);
  });
  instances.instanceMatrix.needsUpdate = true;
  parent.add(instances);
};

// Openings sit just above the solid wall to avoid depth fighting. Only the
// stone surround has visible depth; the dark insert must never form a box.
const WINDOW_SURFACE_DEPTH = 0.024;
const WINDOW_FRAME_DEPTH = 0.18;

const createLancetWindowGeometry = (frame = false): THREE.ExtrudeGeometry => {
  const shape = new THREE.Shape();
  const halfWidth = frame ? 0.66 : 0.5;
  const halfHeight = frame ? 0.62 : 0.5;
  const shoulder = frame ? 0.22 : 0.18;
  shape.moveTo(-halfWidth, -halfHeight);
  shape.lineTo(halfWidth, -halfHeight);
  shape.lineTo(halfWidth, shoulder);
  shape.lineTo(0, halfHeight);
  shape.lineTo(-halfWidth, shoulder);
  shape.closePath();
  if (frame) {
    // A real hole lets the glass remain at the wall, behind the stone reveal.
    const opening = new THREE.Path();
    opening.moveTo(-0.49, -0.49);
    opening.lineTo(-0.49, 0.1764);
    opening.lineTo(0, 0.49);
    opening.lineTo(0.49, 0.1764);
    opening.lineTo(0.49, -0.49);
    opening.closePath();
    shape.holes.push(opening);
  }
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 1,
    steps: 1,
    bevelEnabled: false,
  });
  geometry.translate(0, 0, -0.5);
  return geometry;
};

const createUnitHipRoofGeometry = (ridgeAxis: CityFacadeAxis): THREE.BufferGeometry => {
  // The ridge is a line, not a narrow top plateau. Shared indexed vertices
  // previously averaged normals across the ridge and hip seams; the toon
  // gradient then quantized that fake rounding into visible light bands.
  const ridgeHalfX = ridgeAxis === 'x' ? 0.34 : 0;
  const ridgeHalfZ = ridgeAxis === 'z' ? 0.34 : 0;
  const positions = new Float32Array([
    -0.5, 0, -0.5,
    0.5, 0, -0.5,
    0.5, 0, 0.5,
    -0.5, 0, 0.5,
    -ridgeHalfX, 1, -ridgeHalfZ,
    ridgeHalfX, 1, -ridgeHalfZ,
    ridgeHalfX, 1, ridgeHalfZ,
    -ridgeHalfX, 1, ridgeHalfZ,
  ]);
  const indices = ridgeAxis === 'x'
    ? [
        0, 5, 1, 0, 4, 5,
        1, 5, 2,
        2, 4, 3, 2, 5, 4,
        3, 4, 0,
      ]
    : [
        0, 4, 1,
        1, 6, 2, 1, 4, 6,
        2, 6, 3,
        3, 4, 0, 3, 6, 4,
      ];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  const facetedGeometry = geometry.toNonIndexed();
  geometry.dispose();
  facetedGeometry.computeVertexNormals();
  return facetedGeometry;
};

const createUnitGableRoofGeometry = (): THREE.BufferGeometry => {
  // Local X is the ridge direction. Z-oriented ridges reuse this geometry by
  // rotating the instance 90 degrees, which keeps one shared GPU buffer.
  const positions = new Float32Array([
    -0.5, 0, -0.5,
    0.5, 0, -0.5,
    0.5, 0, 0.5,
    -0.5, 0, 0.5,
    -0.5, 1, 0,
    0.5, 1, 0,
  ]);
  const indices = [
    0, 5, 1, 0, 4, 5,
    3, 2, 5, 3, 5, 4,
    0, 3, 4,
    1, 5, 2,
    0, 1, 2, 0, 2, 3,
  ];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  // Duplicate the vertices at the ridge and eaves so every planar roof side
  // has one constant normal. The two triangles of a slope stay visually one
  // plane, while adjacent slopes keep a hard architectural edge.
  const facetedGeometry = geometry.toNonIndexed();
  geometry.dispose();
  facetedGeometry.computeVertexNormals();
  return facetedGeometry;
};

const createUnitWallCrackGeometry = (): THREE.BufferGeometry => {
  const positions: number[] = [];
  const indices: number[] = [];
  const appendStrip = (
    points: ReadonlyArray<readonly [number, number]>,
    halfWidth: number,
  ): void => {
    const firstVertex = positions.length / 3;
    points.forEach((point, index) => {
      const previous = points[Math.max(0, index - 1)] ?? point;
      const next = points[Math.min(points.length - 1, index + 1)] ?? point;
      const tangentX = next[0] - previous[0];
      const tangentY = next[1] - previous[1];
      const tangentLength = Math.max(0.0001, Math.hypot(tangentX, tangentY));
      const offsetX = -tangentY / tangentLength * halfWidth;
      const offsetY = tangentX / tangentLength * halfWidth;
      positions.push(
        point[0] - offsetX, point[1] - offsetY, 0,
        point[0] + offsetX, point[1] + offsetY, 0,
      );
      if (index === 0) return;
      const previousPair = firstVertex + (index - 1) * 2;
      const currentPair = firstVertex + index * 2;
      indices.push(
        previousPair, currentPair, previousPair + 1,
        currentPair, currentPair + 1, previousPair + 1,
      );
    });
  };

  appendStrip([
    [-0.08, -0.5],
    [0.04, -0.3],
    [-0.03, -0.11],
    [0.13, 0.08],
    [0.05, 0.25],
    [0.19, 0.5],
  ], 0.018);
  appendStrip([
    [0.1, 0.05],
    [0.27, 0.16],
    [0.36, 0.31],
  ], 0.012);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
};

const createUnitFloorCrackGeometry = (): THREE.BufferGeometry => {
  const geometry = createUnitWallCrackGeometry();
  geometry.rotateX(-Math.PI * 0.5);
  return geometry;
};

const pushFacadeElement = (
  transforms: CityDetailTransform[],
  volume: CityTierVolume,
  axis: CityFacadeAxis,
  sign: -1 | 1,
  along: number,
  y: number,
  alongSize: number,
  height: number,
  projection: number,
  rotationZ = 0,
): void => {
  const localX = axis === 'z'
    ? along
    : sign * (volume.width * 0.5 + projection * 0.5);
  const localZ = axis === 'z'
    ? sign * (volume.depth * 0.5 + projection * 0.5)
    : along;
  const cos = Math.cos(volume.rotationY);
  const sin = Math.sin(volume.rotationY);
  transforms.push({
    x: volume.x + localX * cos + localZ * sin,
    y,
    z: volume.z - localX * sin + localZ * cos,
    width: alongSize,
    height,
    depth: projection,
    rotationY: volume.rotationY + (axis === 'x' ? Math.PI * 0.5 : 0),
    rotationZ,
  });
};

const pushWrapBand = (
  transforms: CityDetailTransform[],
  volume: CityTierVolume,
  y: number,
  height: number,
  projection = 0.5,
): void => {
  for (const sign of [-1, 1] as const) {
    pushFacadeElement(
      transforms,
      volume,
      'z',
      sign,
      0,
      y,
      volume.width + projection * 2,
      height,
      projection,
    );
    pushFacadeElement(
      transforms,
      volume,
      'x',
      sign,
      0,
      y,
      volume.depth + projection * 2,
      height,
      projection,
    );
  }
};

const addCityFacadeLayer = (
  parent: THREE.Group,
  specs: readonly CityMassSpec[],
  windowMaterial: THREE.Material,
  stainedGlassMaterial: THREE.Material,
  reliefMaterial: THREE.Material,
  roofMaterial: THREE.Material,
): void => {
  const slitWindows: CityDetailTransform[] = [];
  const stainedWindows: CityDetailTransform[] = [];
  const facadeBands: CityDetailTransform[] = [];
  const lancetFrames: CityDetailTransform[] = [];
  const basePlinths: CityDetailTransform[] = [];
  const buttressLower: CityDetailTransform[] = [];
  const buttressMiddle: CityDetailTransform[] = [];
  const buttressUpper: CityDetailTransform[] = [];
  const flatCaps: CityDetailTransform[] = [];
  const roofParapets: CityDetailTransform[] = [];
  const gableRoofs: CityDetailTransform[] = [];
  const hipRoofsX: CityDetailTransform[] = [];
  const hipRoofsZ: CityDetailTransform[] = [];

  for (let specIndex = 0; specIndex < specs.length; specIndex += 1) {
    const spec = specs[specIndex];
    if (!spec) continue;
    // These anchors own a coherent authored facade and roof system below.
    // Mixing the generic window/roof lottery into them would break their
    // silhouette and turn the Gothic accents back into decorated city boxes.
    if (getGothicCivicSpec(spec.name)) continue;
    const rotationY = spec.rotationY ?? 0;
    const cos = Math.cos(rotationY);
    const sin = Math.sin(rotationY);
    const baseWidth = spec.width * CITY_BUILDING_PLAN_SCALE;
    const baseDepth = spec.depth * CITY_BUILDING_PLAN_SCALE;
    const shiftX = spec.upperShiftX * CITY_BUILDING_PLAN_SCALE;
    const shiftZ = spec.upperShiftZ * CITY_BUILDING_PLAN_SCALE;
    const styleSeed = hashUnit(Math.round(spec.x) + specIndex * 7, Math.round(spec.z), 71);
    const bandSeed = hashUnit(Math.round(spec.z), Math.round(spec.x) + specIndex * 11, 72);
    const roofSeed = hashUnit(Math.round(spec.x) - specIndex * 5, Math.round(spec.z), 73);
    const windowProfile = createCityWindowProfile(spec, specIndex);
    // Facade density is authored per complete building, not per tier. The
    // minimal family has exactly two openings across the whole complex; the
    // remaining families can lose a tier or shorten one row so the city does
    // not collapse back into a repeated office-window grid.
    const style = styleSeed < 0.13
      ? 'minimal'
      : styleSeed < 0.31
        ? 'sparse'
        : styleSeed < 0.66
          ? 'banded'
          : styleSeed < 0.86
            ? 'buttressed'
            : 'stained';
    // Most medieval walls stay broad and uninterrupted. Cornices and courses
    // are accents, not a white strip repeated at every floor line.
    const bandMode = bandSeed < 0.48
      ? 0
      : bandSeed < 0.7
        ? 1
        : bandSeed < 0.88
          ? 2
          : 3;
    const tierRhythmSeed = hashUnit(
      Math.round(spec.x) + specIndex * 13,
      Math.round(spec.z) - specIndex * 3,
      75,
    );
    const verticalAccentSeed = hashUnit(
      Math.round(spec.z) + specIndex * 5,
      Math.round(spec.x) - specIndex * 17,
      76,
    );
    const primaryFaceIndex = Math.floor(
      hashUnit(Math.round(spec.x), Math.round(spec.z), 74) * 4,
    );
    const faces = [
      { axis: 'z' as const, sign: 1 as const },
      { axis: 'x' as const, sign: 1 as const },
      { axis: 'z' as const, sign: -1 as const },
      { axis: 'x' as const, sign: -1 as const },
    ];

    const parts = createCityRenderParts(spec);
    for (let partIndex = 0; partIndex < parts.length; partIndex += 1) {
      const part = parts[partIndex];
      if (!part) continue;
      const baseX = spec.x + part.offsetX * cos + part.offsetZ * sin;
      const baseZ = spec.z - part.offsetX * sin + part.offsetZ * cos;
      const totalHeight = spec.height * CITY_BUILDING_HEIGHT_SCALE * part.heightScale;
      const tiers = createVerticalTierProfile(spec, part.upperScale);
      const tierVolumes: CityTierVolume[] = [];
      let accumulatedHeight = 0;
      for (let tierIndex = 0; tierIndex < tiers.length; tierIndex += 1) {
        const tier = tiers[tierIndex];
        if (!tier) continue;
        const tierHeight = totalHeight * tier.heightFraction;
        tierVolumes.push({
          x: baseX + shiftX * tier.shiftFraction * cos + shiftZ * tier.shiftFraction * sin,
          z: baseZ - shiftX * tier.shiftFraction * sin + shiftZ * tier.shiftFraction * cos,
          width: baseWidth * part.widthScale * tier.planScale,
          depth: baseDepth * part.depthScale * tier.planScale,
          bottomY: getDeckY(spec.z) + accumulatedHeight,
          height: tierHeight,
          rotationY,
          tierIndex,
          tierCount: tiers.length,
        });
        accumulatedHeight += tierHeight;
      }

      const baseVolume = tierVolumes[0];
      if (baseVolume) {
        const attachmentSeed = hashUnit(
          specIndex * 37 + partIndex * 11,
          Math.round(spec.x - spec.z),
          79,
        );

        // A low projecting stone foot grounds most buildings on the deck. Its
        // changing height and depth replace the repeated full-height white
        // ribs with the stepped base language visible in the reference street.
        if (attachmentSeed > 0.12) {
          const plinthHeight = 0.62 + attachmentSeed * 0.92;
          pushWrapBand(
            basePlinths,
            baseVolume,
            baseVolume.bottomY + plinthHeight * 0.5,
            plinthHeight,
            0.38 + attachmentSeed * 0.72,
          );
        }

        const hasButtresses = style === 'buttressed'
          || (style === 'banded' && attachmentSeed > 0.86);
        if (hasButtresses && baseVolume.height > 8) {
          const attachmentFaceIndices = [primaryFaceIndex];
          if (attachmentSeed > 0.72) {
            const sideStep = attachmentSeed > 0.86 ? 1 : 3;
            attachmentFaceIndices.push((primaryFaceIndex + sideStep) % 4);
          }

          for (let attachmentIndex = 0; attachmentIndex < attachmentFaceIndices.length; attachmentIndex += 1) {
            const faceIndex = attachmentFaceIndices[attachmentIndex];
            const face = faces[faceIndex ?? primaryFaceIndex];
            if (!face) continue;
            const alongLength = face.axis === 'z' ? baseVolume.width : baseVolume.depth;
            if (alongLength < 8.5) continue;
            const supportSeed = hashUnit(
              specIndex * 43 + partIndex * 13,
              (faceIndex ?? 0) + attachmentIndex * 5,
              80,
            );
            const supportCount = alongLength > 16 && supportSeed > 0.34 ? 2 : 1;
            const supportHeight = baseVolume.height * (0.64 + supportSeed * 0.3);
            const lowerHeight = supportHeight * (0.18 + supportSeed * 0.08);
            const middleHeight = supportHeight * (0.25 + (1 - supportSeed) * 0.08);
            const upperHeight = supportHeight - lowerHeight - middleHeight;
            const shaftWidth = THREE.MathUtils.clamp(
              alongLength * (0.075 + supportSeed * 0.055),
              1.35,
              3.6,
            );
            const projection = 0.9 + supportSeed * 1.65;

            for (let supportIndex = 0; supportIndex < supportCount; supportIndex += 1) {
              const side = supportCount === 1
                ? (supportSeed > 0.5 ? 1 : -1)
                : supportIndex === 0 ? -1 : 1;
              const along = side * Math.min(
                alongLength * (supportCount === 1 ? 0.34 : 0.41),
                alongLength * 0.5 - shaftWidth,
              );
              pushFacadeElement(
                buttressLower,
                baseVolume,
                face.axis,
                face.sign,
                along,
                baseVolume.bottomY + lowerHeight * 0.5,
                shaftWidth * 1.55,
                lowerHeight,
                projection * 1.45,
              );
              pushFacadeElement(
                buttressMiddle,
                baseVolume,
                face.axis,
                face.sign,
                along,
                baseVolume.bottomY + lowerHeight + middleHeight * 0.5,
                shaftWidth * 1.18,
                middleHeight,
                projection,
              );
              pushFacadeElement(
                buttressUpper,
                baseVolume,
                face.axis,
                face.sign,
                along,
                baseVolume.bottomY + lowerHeight + middleHeight + upperHeight * 0.5,
                shaftWidth * 0.78,
                upperHeight,
                projection * 0.58,
              );
            }
          }
        }
      }

      for (const volume of tierVolumes) {
        const minimalTierIndex = Math.min(
          volume.tierCount - 1,
          Math.floor(verticalAccentSeed * volume.tierCount),
        );
        const hasBlankTier = style !== 'minimal'
          && style !== 'sparse'
          && style !== 'stained'
          && volume.tierCount > 1
          && tierRhythmSeed < 0.38;
        const blankTierIndex = Math.min(
          volume.tierCount - 1,
          Math.floor((tierRhythmSeed / 0.38) * volume.tierCount),
        );
        const isBlankTier = hasBlankTier && volume.tierIndex === blankTierIndex;

        // Some buildings have only two openings in total. Their height and
        // tier vary, but secondary faces and merged wings remain solid stone.
        if (
          style === 'minimal'
          && partIndex === 0
          && volume.tierIndex === minimalTierIndex
        ) {
          const face = faces[primaryFaceIndex];
          if (face) {
            const alongLength = face.axis === 'z' ? volume.width : volume.depth;
            const openingWidth = Math.min(windowProfile.width, alongLength * 0.26);
            const openingHeight = Math.min(
              volume.height * 0.62,
              Math.max(1.8, openingWidth * windowProfile.heightAspect),
            );
            const openingY = volume.bottomY + volume.height * (
              0.36 + verticalAccentSeed * 0.28
            );
            const openingSpread = Math.min(alongLength * 0.2, 4.6);
            for (const side of [-1, 1] as const) {
              pushFacadeElement(
                slitWindows,
                volume,
                face.axis,
                face.sign,
                side * openingSpread,
                openingY,
                openingWidth,
                openingHeight,
                WINDOW_SURFACE_DEPTH,
              );
            }
          }
        }

        const isSparseTier = style === 'sparse' && volume.tierIndex > 0;
        if (style !== 'minimal' && !isSparseTier && !isBlankTier) {
          for (let faceIndex = 0; faceIndex < faces.length; faceIndex += 1) {
            const face = faces[faceIndex];
            if (!face) continue;
            const isPrimaryFace = faceIndex === primaryFaceIndex;
            if (style === 'sparse' && !isPrimaryFace) continue;
            const alongLength = face.axis === 'z' ? volume.width : volume.depth;
            if (alongLength < 5.2 || volume.height < 3.8) continue;
            const rowSlotCount = style === 'sparse'
              ? 1
              : Math.max(1, Math.min(
                4,
                Math.round(volume.height / (7.2 / windowProfile.density)),
              ));
            const nominalBayCount = style === 'sparse'
              ? 3
              : style === 'buttressed'
                ? (alongLength > 31 ? 5 : 3)
                : Math.max(3, Math.min(6, Math.round(alongLength / 7)));
            const maximumFittingBays = Math.max(1, Math.floor(
              alongLength * 0.72 / (windowProfile.width * 1.42),
            ));
            const bayCount = Math.max(1, Math.min(
              maximumFittingBays,
              Math.round(nominalBayCount * windowProfile.density),
            ));
            const faceRhythmSeed = hashUnit(
              specIndex * 29 + partIndex * 7 + faceIndex,
              volume.tierIndex + Math.round(spec.z),
              77,
            );
            const rowAccentIndex = Math.min(
              rowSlotCount - 1,
              Math.floor(hashUnit(specIndex + faceIndex, partIndex + volume.tierIndex, 78) * rowSlotCount),
            );
            const rowMode = style === 'sparse'
              ? 'full'
              : faceRhythmSeed < 0.2 && rowSlotCount > 1
                ? 'gap'
                : faceRhythmSeed < 0.47 && bayCount >= 4
                  ? 'half'
                  : faceRhythmSeed < 0.64 && bayCount >= 3
                    ? 'pair'
                    : 'full';
            const useStainedGlass = style === 'stained'
              && partIndex === 0
              && isPrimaryFace
              && volume.tierIndex === minimalTierIndex;

            if (useStainedGlass) {
              const glassCount = alongLength < 12
                ? 1
                : verticalAccentSeed < 0.34
                  ? 1
                  : verticalAccentSeed < 0.74
                    ? 2
                    : 3;
              const glassWidth = THREE.MathUtils.clamp(
                windowProfile.width * 1.34 + 0.56,
                1.1,
                Math.min(4.9, alongLength * 0.3),
              );
              const glassHeight = THREE.MathUtils.clamp(
                volume.height * (0.48 + verticalAccentSeed * 0.22),
                4.4,
                9.2,
              );
              const glassY = volume.bottomY + volume.height * (
                0.39 + verticalAccentSeed * 0.22
              );
              const glassSpacing = Math.min(
                Math.max(glassWidth * 1.34, 2.2),
                alongLength * 0.22,
              );
              for (let glassIndex = 0; glassIndex < glassCount; glassIndex += 1) {
                const along = (glassIndex - (glassCount - 1) * 0.5)
                  * glassSpacing;
                pushFacadeElement(
                  stainedWindows,
                  volume,
                  face.axis,
                  face.sign,
                  along,
                  glassY,
                  glassWidth,
                  glassHeight,
                  WINDOW_SURFACE_DEPTH,
                );
              }
              const glassSpan = glassWidth + glassSpacing * (glassCount - 1);
              for (const edge of [-1, 1] as const) {
                pushFacadeElement(
                  lancetFrames,
                  volume,
                  face.axis,
                  face.sign,
                  edge * Math.min(alongLength * 0.4, glassSpan * 0.5 + 0.7),
                  glassY,
                  0.72,
                  Math.min(volume.height * 0.82, glassHeight + 2.2),
                  0.62,
                );
              }
              continue;
            }

            const windowWidth = Math.min(
              windowProfile.width,
              alongLength * (bayCount === 1 ? 0.34 : 0.22),
            );
            const rowGap = volume.height / (rowSlotCount + 1);
            const windowHeight = Math.min(
              rowGap * 0.78,
              Math.max(1.7, windowWidth * windowProfile.heightAspect),
            );
            const rowLift = (verticalAccentSeed - 0.5) * rowGap * 0.38;
            for (let rowIndex = 0; rowIndex < rowSlotCount; rowIndex += 1) {
              if (rowMode === 'gap' && rowIndex === rowAccentIndex) continue;
              const y = volume.bottomY + rowGap * (rowIndex + 1) + rowLift;
              for (let bayIndex = 0; bayIndex < bayCount; bayIndex += 1) {
                if (rowIndex === rowAccentIndex && rowMode === 'half') {
                  const keepRightHalf = verticalAccentSeed >= 0.5;
                  const midpoint = bayCount * 0.5;
                  if (keepRightHalf ? bayIndex < midpoint : bayIndex >= midpoint) continue;
                }
                if (rowIndex === rowAccentIndex && rowMode === 'pair') {
                  const leftCenter = Math.floor((bayCount - 1) * 0.5);
                  const rightCenter = Math.min(bayCount - 1, leftCenter + 1);
                  if (bayIndex !== leftCenter && bayIndex !== rightCenter) continue;
                }
                const along = ((bayIndex + 0.5) / bayCount - 0.5) * alongLength * 0.72;
                pushFacadeElement(
                  slitWindows,
                  volume,
                  face.axis,
                  face.sign,
                  along,
                  y,
                  windowWidth,
                  windowHeight,
                  WINDOW_SURFACE_DEPTH,
                );
              }
            }

          }
        }

        if (bandMode === 1 && volume.tierIndex === volume.tierCount - 1) {
          const corniceHeight = 0.42 + bandSeed * 0.34;
          pushWrapBand(
            facadeBands,
            volume,
            volume.bottomY + volume.height - corniceHeight * 0.5,
            corniceHeight,
            0.34 + bandSeed * 0.42,
          );
        } else if (bandMode === 2 && volume.tierIndex === 0) {
          pushWrapBand(
            facadeBands,
            volume,
            volume.bottomY + volume.height * (0.44 + bandSeed * 0.2),
            0.38 + bandSeed * 0.24,
            0.32 + bandSeed * 0.34,
          );
        } else if (bandMode === 3 && volume.tierIndex === 0) {
          for (const level of [0.26 + bandSeed * 0.08, 0.58 + bandSeed * 0.08]) {
            pushWrapBand(
              facadeBands,
              volume,
              volume.bottomY + volume.height * level,
              0.28 + bandSeed * 0.16,
              0.28 + bandSeed * 0.22,
            );
          }
        }
      }

      const topVolume = tierVolumes[tierVolumes.length - 1];
      if (!topVolume) continue;
      const topY = topVolume.bottomY + topVolume.height;
      const partRoofSeed = hashUnit(
        Math.round(spec.x) + specIndex * 17,
        Math.round(spec.z) + partIndex * 23,
        83,
      ) * 0.72 + roofSeed * 0.28;
      const roofSpan = Math.min(topVolume.width, topVolume.depth);
      const canUsePitchedRoof = roofSpan > 5.4;

      if (canUsePitchedRoof && partRoofSeed < 0.42) {
        const ridgeAlongX = topVolume.width >= topVolume.depth;
        const roofRise = THREE.MathUtils.clamp(roofSpan * 0.3, 1.8, 6.6);
        gableRoofs.push({
          x: topVolume.x,
          y: topY,
          z: topVolume.z,
          width: (ridgeAlongX ? topVolume.width : topVolume.depth) + 1.35,
          height: roofRise,
          depth: (ridgeAlongX ? topVolume.depth : topVolume.width) + 1.35,
          rotationY: topVolume.rotationY + (ridgeAlongX ? 0 : Math.PI * 0.5),
        });
      } else if (canUsePitchedRoof && partRoofSeed < 0.64) {
        const roofRise = THREE.MathUtils.clamp(
          roofSpan * 0.23,
          1.6,
          5.8,
        );
        const roofTransform = {
          x: topVolume.x,
          y: topY,
          z: topVolume.z,
          width: topVolume.width + 1.25,
          height: roofRise,
          depth: topVolume.depth + 1.25,
          rotationY,
        };
        (topVolume.width >= topVolume.depth ? hipRoofsX : hipRoofsZ).push(roofTransform);
      } else {
        const parapetHeight = 0.62 + partRoofSeed * 0.86;
        flatCaps.push({
          x: topVolume.x,
          y: topY + 0.22,
          z: topVolume.z,
          width: topVolume.width + 0.5,
          height: 0.44,
          depth: topVolume.depth + 0.5,
          rotationY,
        });
        pushWrapBand(
          roofParapets,
          topVolume,
          topY + parapetHeight * 0.5,
          parapetHeight,
          0.34 + partRoofSeed * 0.26,
        );
      }
    }
  }

  const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  addDetailInstances(parent, 'blockout-facade-slit-windows', boxGeometry, windowMaterial, slitWindows);
  addDetailInstances(
    parent,
    'blockout-facade-stained-lancets',
    createLancetWindowGeometry(),
    stainedGlassMaterial,
    stainedWindows,
  );
  addDetailInstances(parent, 'blockout-facade-course-bands', boxGeometry, reliefMaterial, facadeBands);
  addDetailInstances(parent, 'blockout-facade-lancet-frames', boxGeometry, reliefMaterial, lancetFrames);
  addDetailInstances(parent, 'blockout-building-base-plinths', boxGeometry, reliefMaterial, basePlinths);
  addDetailInstances(parent, 'blockout-buttress-lower-steps', boxGeometry, reliefMaterial, buttressLower);
  addDetailInstances(parent, 'blockout-buttress-middle-steps', boxGeometry, reliefMaterial, buttressMiddle);
  addDetailInstances(parent, 'blockout-buttress-upper-shafts', boxGeometry, reliefMaterial, buttressUpper);
  addDetailInstances(parent, 'blockout-flat-roof-caps', boxGeometry, reliefMaterial, flatCaps);
  addDetailInstances(parent, 'blockout-roof-parapets', boxGeometry, roofMaterial, roofParapets);
  addDetailInstances(
    parent,
    'blockout-gable-roofs',
    createUnitGableRoofGeometry(),
    roofMaterial,
    gableRoofs,
  );
  addDetailInstances(
    parent,
    'blockout-hip-roofs-x',
    createUnitHipRoofGeometry('x'),
    roofMaterial,
    hipRoofsX,
  );
  addDetailInstances(
    parent,
    'blockout-hip-roofs-z',
    createUnitHipRoofGeometry('z'),
    roofMaterial,
    hipRoofsZ,
  );
};

const addGothicChapterHouseMass = (
  parent: THREE.Group,
  spec: CityMassSpec,
  stoneMaterial: THREE.Material,
  reliefMaterial: THREE.Material,
  roofMaterial: THREE.Material,
  windowMaterial: THREE.Material,
  stainedGlassMaterial: THREE.Material,
  outlineMaterial: THREE.LineBasicMaterial,
): void => {
  const building = new THREE.Group();
  building.name = `gothic-civic-${spec.name}`;
  building.position.set(spec.x, 0, spec.z);
  building.rotation.y = spec.rotationY ?? 0;
  parent.add(building);

  const width = spec.width * CITY_BUILDING_PLAN_SCALE;
  const depth = spec.depth * CITY_BUILDING_PLAN_SCALE;
  const height = spec.height * CITY_BUILDING_HEIGHT_SCALE;
  const plinthHeight = 1.5;
  const deckY = getDeckY(spec.z);
  const wallBottomY = deckY + plinthHeight;
  const hallRadius = Math.min(width * 0.35, depth * 0.47);
  const hallHeight = height * 0.62;
  const roofRise = THREE.MathUtils.clamp(hallRadius * 0.82, 6.8, 9.4);

  const plinth = addOutlinedGeometry(
    building,
    new THREE.CylinderGeometry(hallRadius + 1.45, hallRadius + 1.75, plinthHeight, 8),
    reliefMaterial,
    outlineMaterial,
    new THREE.Vector3(0, deckY + plinthHeight * 0.5, -0.25),
    new THREE.Vector3(1, 1, 1),
    `${building.name}-octagonal-plinth`,
  );
  plinth.rotation.y = Math.PI * 0.125;

  const hall = addOutlinedGeometry(
    building,
    new THREE.CylinderGeometry(hallRadius, hallRadius, hallHeight, 8),
    stoneMaterial,
    outlineMaterial,
    new THREE.Vector3(0, wallBottomY + hallHeight * 0.5, -0.25),
    new THREE.Vector3(1, 1, 1),
    `${building.name}-octagonal-hall`,
  );
  hall.rotation.y = Math.PI * 0.125;

  const entryWidth = hallRadius * 0.96;
  const entryDepth = 4.2;
  const entryHeight = hallHeight * 0.56;
  const entryZ = hallRadius + entryDepth * 0.5 - 0.65;
  addOutlinedBox(
    building,
    stoneMaterial,
    outlineMaterial,
    entryWidth,
    entryHeight,
    entryDepth,
    -hallRadius * 0.08,
    wallBottomY + entryHeight * 0.5,
    entryZ,
    `${building.name}-offset-entry-house`,
  );

  // A low archive wing gives the chapter house a directional tail instead of
  // repeating the nave-and-two-aisles footprint used by the other landmarks.
  const archiveWidth = width * 0.58;
  const archiveDepth = depth * 0.34;
  const archiveHeight = hallHeight * 0.36;
  addOutlinedBox(
    building,
    stoneMaterial,
    outlineMaterial,
    archiveWidth,
    archiveHeight,
    archiveDepth,
    -width * 0.13,
    wallBottomY + archiveHeight * 0.5,
    -hallRadius - archiveDepth * 0.3,
    `${building.name}-archive-wing`,
  );

  const framedLancets: CityDetailTransform[] = [];
  const darkLancets: CityDetailTransform[] = [];
  const stainedLancets: CityDetailTransform[] = [];
  const radialButtresses: CityDetailTransform[] = [];
  const roofTransforms: CityDetailTransform[] = [];

  const pushRadialLancet = (
    angle: number,
    y: number,
    windowWidth: number,
    windowHeight: number,
    stained: boolean,
    radius = hallRadius,
  ): void => {
    // The octagon's wall is on its apothem, inside the vertex radius.
    const faceRadius = radius * Math.cos(Math.PI / 8);
    const surfaceRadius = faceRadius + WINDOW_SURFACE_DEPTH * 0.5;
    const transform = {
      x: Math.sin(angle) * surfaceRadius,
      y,
      z: Math.cos(angle) * surfaceRadius - 0.25,
      width: windowWidth,
      height: windowHeight,
      depth: WINDOW_SURFACE_DEPTH,
      rotationY: angle,
    };
    framedLancets.push({
      ...transform,
      x: Math.sin(angle) * (faceRadius + WINDOW_FRAME_DEPTH * 0.5),
      z: Math.cos(angle) * (faceRadius + WINDOW_FRAME_DEPTH * 0.5) - 0.25,
      depth: WINDOW_FRAME_DEPTH,
    });
    (stained ? stainedLancets : darkLancets).push(transform);
  };

  for (let faceIndex = 0; faceIndex < 8; faceIndex += 1) {
    const angle = faceIndex * Math.PI * 0.25;
    if (faceIndex === 0) continue;
    pushRadialLancet(
      angle,
      wallBottomY + hallHeight * 0.56,
      faceIndex % 2 === 0 ? 1.2 : 0.88,
      faceIndex % 2 === 0 ? 6.4 : 4.8,
      faceIndex === 2 || faceIndex === 6,
    );
  }

  const entryVolume: CityTierVolume = {
    x: -hallRadius * 0.08,
    z: entryZ,
    width: entryWidth,
    depth: entryDepth,
    bottomY: wallBottomY,
    height: entryHeight,
    rotationY: 0,
    tierIndex: 0,
    tierCount: 1,
  };
  pushFacadeElement(
    framedLancets,
    entryVolume,
    'z',
    1,
    0,
    wallBottomY + entryHeight * 0.42,
    2.48,
    entryHeight * 0.64,
    WINDOW_FRAME_DEPTH,
  );
  pushFacadeElement(
    darkLancets,
    entryVolume,
    'z',
    1,
    0,
    wallBottomY + entryHeight * 0.42,
    2.48,
    entryHeight * 0.64,
    WINDOW_SURFACE_DEPTH,
  );

  for (let cornerIndex = 0; cornerIndex < 8; cornerIndex += 2) {
    const angle = cornerIndex * Math.PI * 0.25 + Math.PI * 0.125;
    radialButtresses.push({
      x: Math.sin(angle) * (hallRadius + 0.78),
      y: wallBottomY + hallHeight * 0.34,
      z: Math.cos(angle) * (hallRadius + 0.78) - 0.25,
      width: 1.35,
      height: hallHeight * 0.68,
      depth: 1.8,
      rotationY: angle,
    });
  }

  roofTransforms.push({
    x: -hallRadius * 0.08,
    y: wallBottomY + entryHeight,
    z: entryZ,
    width: entryDepth + 0.9,
    height: 3.2,
    depth: entryWidth + 0.9,
    rotationY: Math.PI * 0.5,
  });
  addDetailInstances(
    building,
    `${building.name}-entry-roof`,
    createUnitGableRoofGeometry(),
    roofMaterial,
    roofTransforms,
  );

  const roof = addOutlinedGeometry(
    building,
    new THREE.ConeGeometry(hallRadius * 1.16, roofRise, 8),
    roofMaterial,
    outlineMaterial,
    new THREE.Vector3(0, wallBottomY + hallHeight + roofRise * 0.5, -0.25),
    new THREE.Vector3(1, 1, 1),
    `${building.name}-faceted-roof`,
  );
  roof.rotation.y = Math.PI * 0.125;

  const lanternRadius = hallRadius * 0.33;
  const lanternHeight = THREE.MathUtils.clamp(height * 0.18, 5.4, 7.2);
  const lanternBaseY = wallBottomY + hallHeight + roofRise * 0.58;
  const lantern = addOutlinedGeometry(
    building,
    new THREE.CylinderGeometry(lanternRadius, lanternRadius, lanternHeight, 8),
    stoneMaterial,
    outlineMaterial,
    new THREE.Vector3(0, lanternBaseY + lanternHeight * 0.5, -0.25),
    new THREE.Vector3(1, 1, 1),
    `${building.name}-lantern`,
  );
  lantern.rotation.y = Math.PI * 0.125;
  const lanternCapHeight = lanternRadius * 1.25;
  const lanternCap = addOutlinedGeometry(
    building,
    new THREE.ConeGeometry(lanternRadius * 1.24, lanternCapHeight, 8),
    roofMaterial,
    outlineMaterial,
    new THREE.Vector3(
      0,
      lanternBaseY + lanternHeight + lanternCapHeight * 0.5,
      -0.25,
    ),
    new THREE.Vector3(1, 1, 1),
    `${building.name}-lantern-cap`,
  );
  lanternCap.rotation.y = Math.PI * 0.125;

  addDetailInstances(
    building,
    `${building.name}-lancet-frames`,
    createLancetWindowGeometry(true),
    reliefMaterial,
    framedLancets,
  );
  addDetailInstances(
    building,
    `${building.name}-dark-lancets`,
    createLancetWindowGeometry(),
    windowMaterial,
    darkLancets,
  );
  addDetailInstances(
    building,
    `${building.name}-stained-lancets`,
    createLancetWindowGeometry(),
    stainedGlassMaterial,
    stainedLancets,
  );
  addDetailInstances(
    building,
    `${building.name}-radial-buttresses`,
    new THREE.BoxGeometry(1, 1, 1),
    reliefMaterial,
    radialButtresses,
  );
};

const addGothicCivicMass = (
  parent: THREE.Group,
  spec: CityMassSpec,
  gothic: GothicCivicSpec,
  stoneMaterial: THREE.Material,
  reliefMaterial: THREE.Material,
  roofMaterial: THREE.Material,
  windowMaterial: THREE.Material,
  stainedGlassMaterial: THREE.Material,
  outlineMaterial: THREE.LineBasicMaterial,
): void => {
  if (gothic.family === 'chapter-house') {
    addGothicChapterHouseMass(
      parent,
      spec,
      stoneMaterial,
      reliefMaterial,
      roofMaterial,
      windowMaterial,
      stainedGlassMaterial,
      outlineMaterial,
    );
    return;
  }

  const building = new THREE.Group();
  building.name = `gothic-civic-${spec.name}`;
  building.position.set(spec.x, 0, spec.z);
  building.rotation.y = spec.rotationY ?? 0;
  parent.add(building);

  const width = spec.width * CITY_BUILDING_PLAN_SCALE;
  const depth = spec.depth * CITY_BUILDING_PLAN_SCALE;
  const height = spec.height * CITY_BUILDING_HEIGHT_SCALE;
  const plinthHeight = 1.35;
  const deckY = getDeckY(spec.z);
  const wallBottomY = deckY + plinthHeight;
  const isGreatHall = gothic.family === 'great-hall';
  const isTwinChapel = gothic.family === 'twin-chapel';
  const isBellHall = gothic.family === 'bell-hall';
  const naveWidth = width * (isTwinChapel ? 0.48 : isBellHall ? 0.56 : 0.82);
  const naveDepth = depth * (isBellHall ? 0.74 : isGreatHall ? 0.9 : 0.84);
  const naveHeight = height * (isTwinChapel ? 0.9 : isBellHall ? 0.66 : 0.58);
  const naveX = isBellHall ? -gothic.towerSide * width * 0.1 : 0;
  const naveZ = -depth * 0.025;
  const aisleWidth = Math.max(2.4, (width - naveWidth) * 0.46);
  const aisleHeight = naveHeight * (isTwinChapel ? 0.48 : isBellHall ? 0.44 : 0.62);
  const aisleDepth = naveDepth * 0.91;
  const aisleX = naveWidth * 0.5 + aisleWidth * 0.5 - 0.12;
  const aisleSides: readonly (-1 | 1)[] = isBellHall
    ? [gothic.towerSide === -1 ? 1 : -1]
    : isTwinChapel
      ? []
      : [-1, 1];
  const frontBayWidth = THREE.MathUtils.clamp(
    naveWidth * (isGreatHall ? 0.62 : isBellHall ? 0.46 : 0.52),
    5.2,
    isGreatHall ? 16 : 8.8,
  );
  const frontBayDepth = isGreatHall ? 3.6 : 2.5;
  const frontBayHeight = naveHeight * (isGreatHall ? 0.56 : isBellHall ? 0.72 : 0.82);
  const frontBayX = isBellHall ? naveX - gothic.towerSide * naveWidth * 0.08 : 0;
  const frontBayZ = naveZ + naveDepth * 0.5 + frontBayDepth * 0.5 - 0.18;

  addOutlinedBox(
    building,
    reliefMaterial,
    outlineMaterial,
    width + 1.8,
    plinthHeight,
    depth + 1.8,
    0,
    deckY + plinthHeight * 0.5,
    0,
    `${building.name}-stepped-plinth`,
  );
  addOutlinedBox(
    building,
    stoneMaterial,
    outlineMaterial,
    naveWidth,
    naveHeight,
    naveDepth,
    naveX,
    wallBottomY + naveHeight * 0.5,
    naveZ,
    `${building.name}-nave`,
  );

  for (const side of aisleSides) {
    addOutlinedBox(
      building,
      stoneMaterial,
      outlineMaterial,
      aisleWidth,
      aisleHeight,
      aisleDepth,
      naveX + side * aisleX,
      wallBottomY + aisleHeight * 0.5,
      naveZ - 0.15,
      `${building.name}-aisle-${side < 0 ? 'west' : 'east'}`,
    );
  }

  // A shallow transept breaks the footprint into a cruciform civic mass and
  // gives the roof a real crossing instead of a decorated rectangular box.
  if (isGreatHall) {
    const transeptDepth = Math.max(4.2, depth * 0.28);
    addOutlinedBox(
      building,
      stoneMaterial,
      outlineMaterial,
      width * 0.94,
      naveHeight * 0.67,
      transeptDepth,
      0,
      wallBottomY + naveHeight * 0.335,
      naveZ - depth * 0.08,
      `${building.name}-transept`,
    );
  }

  addOutlinedBox(
    building,
    stoneMaterial,
    outlineMaterial,
    frontBayWidth,
    frontBayHeight,
    frontBayDepth,
    frontBayX,
    wallBottomY + frontBayHeight * 0.5,
    frontBayZ,
    `${building.name}-portal-bay`,
  );

  const naveVolume: CityTierVolume = {
    x: naveX,
    z: naveZ,
    width: naveWidth,
    depth: naveDepth,
    bottomY: wallBottomY,
    height: naveHeight,
    rotationY: 0,
    tierIndex: 0,
    tierCount: 1,
  };
  const frontBayVolume: CityTierVolume = {
    x: frontBayX,
    z: frontBayZ,
    width: frontBayWidth,
    depth: frontBayDepth,
    bottomY: wallBottomY,
    height: frontBayHeight,
    rotationY: 0,
    tierIndex: 0,
    tierCount: 1,
  };
  const aisleVolumes: CityTierVolume[] = aisleSides.map((side) => ({
    x: naveX + side * aisleX,
    z: naveZ - 0.15,
    width: aisleWidth,
    depth: aisleDepth,
    bottomY: wallBottomY,
    height: aisleHeight,
    rotationY: 0,
    tierIndex: 0,
    tierCount: 1,
  }));
  const framedLancets: CityDetailTransform[] = [];
  const darkLancets: CityDetailTransform[] = [];
  const stainedLancets: CityDetailTransform[] = [];
  const lowerButtresses: CityDetailTransform[] = [];
  const middleButtresses: CityDetailTransform[] = [];
  const upperButtresses: CityDetailTransform[] = [];
  const cornices: CityDetailTransform[] = [];
  const roofs: CityDetailTransform[] = [];
  const spireShafts: CityDetailTransform[] = [];
  const spireCaps: CityDetailTransform[] = [];

  const pushFramedLancet = (
    volume: CityTierVolume,
    axis: CityFacadeAxis,
    sign: -1 | 1,
    along: number,
    y: number,
    windowWidth: number,
    windowHeight: number,
    glass: 'dark' | 'stained',
  ): void => {
    pushFacadeElement(
      framedLancets,
      volume,
      axis,
      sign,
      along,
      y,
      windowWidth,
      windowHeight,
      WINDOW_FRAME_DEPTH,
    );
    pushFacadeElement(
      glass === 'stained' ? stainedLancets : darkLancets,
      volume,
      axis,
      sign,
      along,
      y,
      windowWidth,
      windowHeight,
      WINDOW_SURFACE_DEPTH,
    );
  };

  const portalHeight = THREE.MathUtils.clamp(frontBayHeight * 0.55, 5.4, 8.4);
  pushFramedLancet(
    frontBayVolume,
    'z',
    1,
    0,
    wallBottomY + portalHeight * 0.5 + 0.12,
    THREE.MathUtils.clamp(frontBayWidth * 0.38, 2.3, 3.5),
    portalHeight,
    'dark',
  );

  if (isGreatHall) {
    for (const side of [-1, 1] as const) {
      pushFramedLancet(
        frontBayVolume,
        'z',
        1,
        side * frontBayWidth * 0.31,
        wallBottomY + portalHeight * 0.38,
        1.55,
        portalHeight * 0.68,
        'dark',
      );
    }
  }

  const frontGlassY = wallBottomY + frontBayHeight * 0.73;
  const frontGlassHeight = THREE.MathUtils.clamp(frontBayHeight * 0.24, 3.3, 5.8);
  if (isBellHall) {
    for (const side of [-1, 1] as const) {
      pushFramedLancet(
        frontBayVolume,
        'z',
        1,
        side * frontBayWidth * 0.23,
        frontGlassY,
        0.82,
        frontGlassHeight,
        'stained',
      );
    }
  } else if (isTwinChapel) {
    for (const offset of [-0.28, 0, 0.28]) {
      pushFramedLancet(
        frontBayVolume,
        'z',
        1,
        offset * frontBayWidth,
        frontGlassY,
        offset === 0 ? 1.02 : 0.78,
        offset === 0 ? frontGlassHeight * 1.18 : frontGlassHeight,
        'stained',
      );
    }
  }

  // The projecting entrance is a vertical composition, not a pasted door:
  // two slim full-height piers carry its little gable and frame the archivolt.
  for (const side of [-1, 1] as const) {
    pushFacadeElement(
      upperButtresses,
      frontBayVolume,
      'z',
      1,
      side * frontBayWidth * 0.43,
      wallBottomY + frontBayHeight * 0.48,
      0.58,
      frontBayHeight * 0.96,
      0.76,
    );
  }

  for (const aisleVolume of aisleVolumes) {
    pushFramedLancet(
      aisleVolume,
      'z',
      1,
      0,
      wallBottomY + aisleHeight * 0.48,
      THREE.MathUtils.clamp(aisleWidth * 0.24, 0.72, 1.18),
      THREE.MathUtils.clamp(aisleHeight * 0.34, 3.2, 5.2),
      'dark',
    );
  }

  const sideWindowHeight = THREE.MathUtils.clamp(naveHeight * 0.25, 4.1, 6.8);
  const sideWindowY = wallBottomY + naveHeight * 0.48;
  for (const side of [-1, 1] as const) {
    for (const longitudinal of [-0.29, 0, 0.29]) {
      pushFramedLancet(
        naveVolume,
        'x',
        side,
        longitudinal * naveDepth,
        sideWindowY,
        1.05,
        sideWindowHeight,
        longitudinal === 0 ? 'stained' : 'dark',
      );
    }
  }

  const buttressHeight = naveHeight * 0.76;
  // A pair of stepped front buttresses makes the gable structurally legible
  // from the street and prevents the nave from reading as another flat box.
  for (const side of [-1, 1] as const) {
    const lowerHeight = buttressHeight * 0.24;
    const middleHeight = buttressHeight * 0.29;
    const upperHeight = buttressHeight - lowerHeight - middleHeight;
    const along = side * naveWidth * 0.43;
    pushFacadeElement(
      lowerButtresses,
      naveVolume,
      'z',
      1,
      along,
      wallBottomY + lowerHeight * 0.5,
      1.9,
      lowerHeight,
      2.05,
    );
    pushFacadeElement(
      middleButtresses,
      naveVolume,
      'z',
      1,
      along,
      wallBottomY + lowerHeight + middleHeight * 0.5,
      1.42,
      middleHeight,
      1.32,
    );
    pushFacadeElement(
      upperButtresses,
      naveVolume,
      'z',
      1,
      along,
      wallBottomY + lowerHeight + middleHeight + upperHeight * 0.5,
      0.96,
      upperHeight,
      0.72,
    );
  }

  const buttressPositions = [-0.39, 0, 0.39];
  for (const side of [-1, 1] as const) {
    for (const longitudinal of buttressPositions) {
      const lowerHeight = buttressHeight * 0.24;
      const middleHeight = buttressHeight * 0.29;
      const upperHeight = buttressHeight - lowerHeight - middleHeight;
      pushFacadeElement(
        lowerButtresses,
        naveVolume,
        'x',
        side,
        longitudinal * naveDepth,
        wallBottomY + lowerHeight * 0.5,
        1.7,
        lowerHeight,
        1.85,
      );
      pushFacadeElement(
        middleButtresses,
        naveVolume,
        'x',
        side,
        longitudinal * naveDepth,
        wallBottomY + lowerHeight + middleHeight * 0.5,
        1.28,
        middleHeight,
        1.18,
      );
      pushFacadeElement(
        upperButtresses,
        naveVolume,
        'x',
        side,
        longitudinal * naveDepth,
        wallBottomY + lowerHeight + middleHeight + upperHeight * 0.5,
        0.9,
        upperHeight,
        0.68,
      );
    }
  }

  pushWrapBand(
    cornices,
    naveVolume,
    wallBottomY + naveHeight - 0.42,
    0.84,
    0.62,
  );

  const naveRoofRise = THREE.MathUtils.clamp(
    naveWidth * (isGreatHall ? 0.28 : isBellHall ? 0.46 : 0.68),
    isGreatHall ? 3.8 : 4.8,
    isTwinChapel ? 11.8 : 9.4,
  );
  roofs.push({
    x: naveX,
    y: wallBottomY + naveHeight,
    z: naveZ,
    width: naveDepth + 1.45,
    height: naveRoofRise,
    depth: naveWidth + 1.45,
    rotationY: Math.PI * 0.5,
  });
  for (const side of aisleSides) {
    roofs.push({
      x: naveX + side * aisleX,
      y: wallBottomY + aisleHeight,
      z: naveZ - 0.15,
      width: aisleDepth + 1.05,
      height: THREE.MathUtils.clamp(aisleWidth * 0.62, 2.1, 4.2),
      depth: aisleWidth + 1.05,
      rotationY: Math.PI * 0.5,
    });
  }
  roofs.push({
    x: frontBayX,
    y: wallBottomY + frontBayHeight,
    z: frontBayZ,
    width: frontBayDepth + 0.9,
    height: THREE.MathUtils.clamp(frontBayWidth * 0.44, 2.5, 4.2),
    depth: frontBayWidth + 0.9,
    rotationY: Math.PI * 0.5,
  });

  interface LocalTower {
    x: number;
    z: number;
    width: number;
    depth: number;
    height: number;
    name: string;
  }
  const towers: LocalTower[] = [];
  if (isBellHall) {
    const towerWidth = THREE.MathUtils.clamp(width * 0.23, 5.2, 7.2);
    towers.push({
      x: gothic.towerSide * width * 0.33,
      z: depth * 0.22,
      width: towerWidth,
      depth: Math.min(depth * 0.34, towerWidth * 1.08),
      height: height * 1.12,
      name: 'bell-tower',
    });
  } else if (isTwinChapel) {
    const towerWidth = THREE.MathUtils.clamp(width * 0.18, 4.7, 6.4);
    for (const side of [-1, 1] as const) {
      towers.push({
        x: side * width * 0.32,
        z: depth * 0.28,
        width: towerWidth,
        depth: Math.min(depth * 0.3, towerWidth * 1.08),
        height: height * (side === gothic.towerSide ? 1.12 : 1.02),
        name: `front-tower-${side < 0 ? 'west' : 'east'}`,
      });
    }
  }

  for (const tower of towers) {
    addOutlinedBox(
      building,
      stoneMaterial,
      outlineMaterial,
      tower.width,
      tower.height,
      tower.depth,
      tower.x,
      wallBottomY + tower.height * 0.5,
      tower.z,
      `${building.name}-${tower.name}`,
    );
    const towerVolume: CityTierVolume = {
      x: tower.x,
      z: tower.z,
      width: tower.width,
      depth: tower.depth,
      bottomY: wallBottomY,
      height: tower.height,
      rotationY: 0,
      tierIndex: 0,
      tierCount: 1,
    };
    pushWrapBand(
      cornices,
      towerVolume,
      wallBottomY + tower.height - 1.05,
      0.72,
      0.58,
    );
    for (const level of [0.48, 0.72]) {
      pushFramedLancet(
        towerVolume,
        'z',
        1,
        0,
        wallBottomY + tower.height * level,
        0.92,
        THREE.MathUtils.clamp(tower.height * 0.14, 3.4, 5.8),
        level > 0.6 ? 'stained' : 'dark',
      );
    }
    const spireHeight = THREE.MathUtils.clamp(tower.width * 1.58, 7.2, 11.5);
    spireCaps.push({
      x: tower.x,
      y: wallBottomY + tower.height + spireHeight * 0.5,
      z: tower.z,
      width: tower.width * 1.16,
      height: spireHeight,
      depth: tower.depth * 1.16,
      rotationY: Math.PI * 0.25,
    });
  }

  // Great halls receive one small crossing lantern instead of a full tower;
  // this gives the family its own silhouette without repeating the chapels.
  if (gothic.family === 'great-hall') {
    const lanternWidth = THREE.MathUtils.clamp(naveWidth * 0.22, 3.8, 5.4);
    const lanternHeight = THREE.MathUtils.clamp(naveHeight * 0.28, 5.2, 7.6);
    const lanternBaseY = wallBottomY + naveHeight + naveRoofRise * 0.32;
    addOutlinedBox(
      building,
      stoneMaterial,
      outlineMaterial,
      lanternWidth,
      lanternHeight,
      lanternWidth,
      0,
      lanternBaseY + lanternHeight * 0.5,
      naveZ - depth * 0.08,
      `${building.name}-crossing-lantern`,
    );
    const lanternSpireHeight = lanternWidth * 1.45;
    spireCaps.push({
      x: 0,
      y: lanternBaseY + lanternHeight + lanternSpireHeight * 0.5,
      z: naveZ - depth * 0.08,
      width: lanternWidth * 1.18,
      height: lanternSpireHeight,
      depth: lanternWidth * 1.18,
      rotationY: Math.PI * 0.25,
    });
  }

  const pinnacleBaseY = wallBottomY + naveHeight + naveRoofRise * 0.08;
  const pinnaclePlacements: readonly (readonly [-1 | 1, -1 | 1])[] = isBellHall
    ? []
    : isGreatHall
      ? [[-1, -1], [1, -1]]
      : [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  for (const [side, longitudinal] of pinnaclePlacements) {
    const shaftHeight = 2.7;
    const capHeight = 3.5;
    spireShafts.push({
      x: naveX + side * naveWidth * 0.46,
      y: pinnacleBaseY + shaftHeight * 0.5,
      z: naveZ + longitudinal * naveDepth * 0.43,
      width: 0.82,
      height: shaftHeight,
      depth: 0.82,
      rotationY: 0,
    });
    spireCaps.push({
      x: naveX + side * naveWidth * 0.46,
      y: pinnacleBaseY + shaftHeight + capHeight * 0.5,
      z: naveZ + longitudinal * naveDepth * 0.43,
      width: 1.35,
      height: capHeight,
      depth: 1.35,
      rotationY: Math.PI * 0.25,
    });
  }

  addDetailInstances(
    building,
    `${building.name}-lancet-frames`,
    createLancetWindowGeometry(true),
    reliefMaterial,
    framedLancets,
  );
  addDetailInstances(
    building,
    `${building.name}-dark-lancets`,
    createLancetWindowGeometry(),
    windowMaterial,
    darkLancets,
  );
  addDetailInstances(
    building,
    `${building.name}-stained-lancets`,
    createLancetWindowGeometry(),
    stainedGlassMaterial,
    stainedLancets,
  );
  const detailBox = new THREE.BoxGeometry(1, 1, 1);
  addDetailInstances(building, `${building.name}-cornices`, detailBox, reliefMaterial, cornices);
  addDetailInstances(building, `${building.name}-buttress-feet`, detailBox, reliefMaterial, lowerButtresses);
  addDetailInstances(building, `${building.name}-buttress-steps`, detailBox, reliefMaterial, middleButtresses);
  addDetailInstances(building, `${building.name}-buttress-shafts`, detailBox, reliefMaterial, upperButtresses);
  addDetailInstances(building, `${building.name}-pinnacle-shafts`, detailBox, reliefMaterial, spireShafts);
  addDetailInstances(
    building,
    `${building.name}-steep-roofs`,
    createUnitGableRoofGeometry(),
    roofMaterial,
    roofs,
  );
  addDetailInstances(
    building,
    `${building.name}-spire-caps`,
    new THREE.ConeGeometry(0.5, 1, 4),
    roofMaterial,
    spireCaps,
  );

  if (isGreatHall) {
    const roseRadius = THREE.MathUtils.clamp(frontBayWidth * 0.17, 1.05, 1.72);
    const roseY = wallBottomY + frontBayHeight * 0.73;
    const roseWallZ = frontBayZ + frontBayDepth * 0.5;
    const roseZ = roseWallZ + 0.18;
    const roseFrame = new THREE.Mesh(
      new THREE.TorusGeometry(roseRadius, roseRadius * 0.17, 8, 28),
      reliefMaterial,
    );
    roseFrame.name = `${building.name}-rose-window-frame`;
    roseFrame.position.set(0, roseY, roseZ);
    building.add(roseFrame);
    const roseGlass = new THREE.Mesh(
      new THREE.CircleGeometry(roseRadius * 0.78, 28),
      stainedGlassMaterial,
    );
    roseGlass.name = `${building.name}-stained-rose-window`;
    roseGlass.position.set(0, roseY, roseWallZ + WINDOW_SURFACE_DEPTH);
    building.add(roseGlass);

    // Eight stone mullions and a central boss turn the coloured disc into a
    // Gothic rose. These are only used on two civic landmarks, so the geometry
    // remains a deliberate hero detail rather than a city-wide micro-pattern.
    const spokeGeometry = new THREE.BoxGeometry(roseRadius * 1.42, 0.12, 0.14);
    for (let spokeIndex = 0; spokeIndex < 8; spokeIndex += 1) {
      const spoke = new THREE.Mesh(spokeGeometry, reliefMaterial);
      spoke.name = `${building.name}-rose-window-mullion-${spokeIndex + 1}`;
      spoke.position.set(0, roseY, roseZ + 0.17);
      spoke.rotation.z = spokeIndex * Math.PI / 8;
      building.add(spoke);
    }
    const roseBoss = new THREE.Mesh(
      new THREE.CircleGeometry(roseRadius * 0.18, 16),
      reliefMaterial,
    );
    roseBoss.name = `${building.name}-rose-window-boss`;
    roseBoss.position.set(0, roseY, roseZ + 0.27);
    building.add(roseBoss);
  }
};

const addCityGrowthLayer = (
  parent: THREE.Group,
  specs: readonly CityMassSpec[],
  material: THREE.Material,
): void => {
  const clusters = new CrystalClusterBuilder({ kind: 'city', windowBounds: collectCrystalWindowBounds(parent) });
  const coating = new CrystalCoatingBuilder('city', false, clusters.addSurface);
  for (let specIndex = 0; specIndex < specs.length; specIndex += 1) {
    const spec = specs[specIndex]!;
    if (getGothicCivicSpec(spec.name)) continue;
    const rotationY = spec.rotationY ?? 0;
    const cos = Math.cos(rotationY);
    const sin = Math.sin(rotationY);
    const colonyWave = Math.sin(spec.x * 0.018 + spec.z * 0.011 + 0.7) * 0.6
      + Math.sin(spec.x * 0.009 - spec.z * 0.021 + 1.9) * 0.4;
    const strength = 0.88 + colonyWave * 0.18;
    // The cold settles in drifts: roughly a quarter of the masses, in smooth
    // spatial patches, carry frost on their roofs only and keep clean walls.
    const wallsFrozen = colonyWave > -0.38;
    const baseWidth = spec.width * CITY_BUILDING_PLAN_SCALE;
    const baseDepth = spec.depth * CITY_BUILDING_PLAN_SCALE;
    const shiftX = spec.upperShiftX * CITY_BUILDING_PLAN_SCALE;
    const shiftZ = spec.upperShiftZ * CITY_BUILDING_PLAN_SCALE;
    // Share exactly the same wings and tier boundaries as the architecture.
    // Every colony starts on a real eave, corner or foot of one of these tiers.
    const parts = createCityRenderParts(spec);
    for (let partIndex = 0; partIndex < parts.length; partIndex += 1) {
      const part = parts[partIndex]!;
      const baseX = spec.x + part.offsetX * cos + part.offsetZ * sin;
      const baseZ = spec.z - part.offsetX * sin + part.offsetZ * cos;
      const totalHeight = spec.height * CITY_BUILDING_HEIGHT_SCALE * part.heightScale;
      const tiers = createVerticalTierProfile(spec, part.upperScale);
      let accumulatedHeight = 0;
      for (let tierIndex = 0; tierIndex < tiers.length; tierIndex += 1) {
        const tier = tiers[tierIndex]!;
        const tierHeight = totalHeight * tier.heightFraction;
        // Ice hangs from eaves. A tier whose top edge is buried under an equal
        // tier above has no eave, so its walls stay clean.
        const above = tiers[tierIndex + 1];
        const hasEave = !above || above.planScale < tier.planScale - 0.03
          || Math.abs(above.shiftFraction - tier.shiftFraction) * Math.max(Math.abs(shiftX), Math.abs(shiftZ)) > 1.5;
        if (!wallsFrozen || !hasEave) { accumulatedHeight += tierHeight; continue; }
        coating.addWalls({
          x: baseX + shiftX * tier.shiftFraction * cos + shiftZ * tier.shiftFraction * sin,
          z: baseZ - shiftX * tier.shiftFraction * sin + shiftZ * tier.shiftFraction * cos,
          width: baseWidth * part.widthScale * tier.planScale,
          depth: baseDepth * part.depthScale * tier.planScale,
          bottomY: getDeckY(spec.z) + accumulatedHeight,
          height: tierHeight,
          rotationY,
        }, specIndex * 101 + partIndex * 31 + tierIndex * 17, strength);
        accumulatedHeight += tierHeight;
      }
    }
  }
  // Civic landmarks and polygonal mill towers are not ordinary tier boxes.
  // Coat only their structural masses, leaving glazing and detail trim alone.
  coating.addMeshWalls(parent, mesh => /-mill-shaft-fill$/.test(mesh.name)
    || (mesh.name.startsWith('gothic-civic-')
      && /-(?:nave|aisle-(?:west|east)|transept|portal-bay|bell-tower|front-tower-(?:west|east)|crossing-lantern|octagonal-hall|offset-entry-house|archive-wing|lantern)-fill$/.test(mesh.name)));
  coating.addRoofs(parent, mesh => /^(?:blockout-gable-roofs|blockout-hip-roofs-[xz]|blockout-flat-roof-caps)$/.test(mesh.name)
    || mesh.name.endsWith('-steep-roofs') || mesh.name.endsWith('-mill-roof-fill')
    || (mesh.name.startsWith('gothic-civic-')
      && /-(?:entry-roof|faceted-roof-fill|lantern-cap-fill|spire-caps)$/.test(mesh.name)));
  coating.build(parent, material, 'blockout-violet-growth-crystal-coating');
  clusters.build(parent, createWahrWeltCrystalPrismMaterial());
};

const addCityAgingLayer = (
  parent: THREE.Group,
  specs: readonly CityMassSpec[],
  crackMaterial: THREE.Material,
): void => {
  const wallCracks: CityDetailTransform[] = [];
  const deckCracks: CityDetailTransform[] = [
    { x: -218, y: CITY_DECK_Y + 0.035, z: -118, width: 10, height: 1, depth: 20, rotationY: -0.42 },
    { x: -178, y: CITY_DECK_Y + 0.035, z: 142, width: 8, height: 1, depth: 17, rotationY: 0.28 },
    { x: -92, y: CITY_DECK_Y + 0.035, z: -214, width: 11, height: 1, depth: 22, rotationY: 0.63 },
    { x: -34, y: CITY_DECK_Y + 0.035, z: 186, width: 9, height: 1, depth: 18, rotationY: -0.18 },
    { x: 72, y: CITY_DECK_Y + 0.035, z: -192, width: 8, height: 1, depth: 16, rotationY: -0.72 },
    { x: 148, y: CITY_DECK_Y + 0.035, z: 168, width: 12, height: 1, depth: 21, rotationY: 0.44 },
    { x: 214, y: CITY_DECK_Y + 0.035, z: -76, width: 9, height: 1, depth: 19, rotationY: 0.16 },
    { x: 252, y: CITY_DECK_Y + 0.035, z: 104, width: 7, height: 1, depth: 15, rotationY: -0.56 },
  ];
  const roadCracks: CityDetailTransform[] = [];

  for (let specIndex = 0; specIndex < specs.length; specIndex += 1) {
    const spec = specs[specIndex];
    if (!spec || getGothicCivicSpec(spec.name)) continue;
    const crackSeed = hashUnit(
      Math.round(spec.x) + specIndex * 43,
      Math.round(spec.z) - specIndex * 31,
      111,
    );
    if (crackSeed < 0.955) continue;

    const rotationY = spec.rotationY ?? 0;
    const cos = Math.cos(rotationY);
    const sin = Math.sin(rotationY);
    const parts = createCityRenderParts(spec);
    const partIndex = Math.min(
      parts.length - 1,
      Math.floor(hashUnit(specIndex * 7, Math.round(spec.x + spec.z), 112) * parts.length),
    );
    const part = parts[partIndex];
    const baseTier = createVerticalTierProfile(spec, part?.upperScale ?? 1)[0];
    if (!part || !baseTier) continue;

    const baseX = spec.x + part.offsetX * cos + part.offsetZ * sin;
    const baseZ = spec.z - part.offsetX * sin + part.offsetZ * cos;
    const volume: CityTierVolume = {
      x: baseX,
      z: baseZ,
      width: spec.width * CITY_BUILDING_PLAN_SCALE * part.widthScale * baseTier.planScale,
      depth: spec.depth * CITY_BUILDING_PLAN_SCALE * part.depthScale * baseTier.planScale,
      bottomY: getDeckY(spec.z),
      height: spec.height * CITY_BUILDING_HEIGHT_SCALE * part.heightScale * baseTier.heightFraction,
      rotationY,
      tierIndex: 0,
      tierCount: 1,
    };
    const faceSeed = hashUnit(specIndex * 17, Math.round(spec.z), 113);
    const axis: CityFacadeAxis = faceSeed < 0.5 ? 'z' : 'x';
    const sign: -1 | 1 = faceSeed < 0.25 || faceSeed >= 0.75 ? 1 : -1;
    const alongLength = axis === 'z' ? volume.width : volume.depth;
    if (alongLength < 6 || volume.height < 5) continue;
    const crackWidth = 2.2 + crackSeed * 2.4;
    const crackHeight = THREE.MathUtils.clamp(volume.height * 0.46, 4.2, 9.5);
    const along = (hashUnit(specIndex * 19, Math.round(spec.x), 114) - 0.5)
      * Math.max(0, alongLength - crackWidth - 1.2) * 0.72;
    pushFacadeElement(
      wallCracks,
      volume,
      axis,
      sign,
      along,
      volume.bottomY + volume.height * (0.42 + crackSeed * 0.12),
      crackWidth,
      crackHeight,
      0.18,
      (crackSeed - 0.975) * 5.6,
    );
  }

  CITY_STREETS.forEach((street, streetIndex) => {
    const roadSeed = hashUnit(
      Math.round(street.x1 + street.x2) + streetIndex * 13,
      Math.round(street.z1 + street.z2) - streetIndex * 17,
      115,
    );
    if (roadSeed < 0.72) return;
    const t = 0.24 + roadSeed * 0.5;
    const dx = street.x2 - street.x1;
    const dz = street.z2 - street.z1;
    roadCracks.push({
      x: street.x1 + dx * t,
      y: CITY_DECK_Y + 0.475,
      z: street.z1 + dz * t,
      width: 4.4 + roadSeed * 3.2,
      height: 1,
      depth: 8 + roadSeed * 6,
      rotationY: Math.atan2(dx, dz) + (roadSeed - 0.5) * 0.36,
    });
  });

  addDetailInstances(
    parent,
    'blockout-wall-aging-cracks',
    createUnitWallCrackGeometry(),
    crackMaterial,
    wallCracks,
  );
  addDetailInstances(
    parent,
    'blockout-city-deck-aging-cracks',
    createUnitFloorCrackGeometry(),
    crackMaterial,
    deckCracks,
  );
  addDetailInstances(
    parent,
    'blockout-road-aging-cracks',
    createUnitFloorCrackGeometry(),
    crackMaterial,
    roadCracks,
  );
};

const addStairFlight = (
  parent: THREE.Group,
  material: THREE.Material,
  _outlineMaterial: THREE.LineBasicMaterial,
  x: number,
  z: number,
  rotationY: number,
  width: number,
  steps: number,
  stepDepth: number,
  stepHeight: number,
  name: string,
  originY = CITY_DECK_Y,
): void => {
  const flight = new THREE.Group();
  flight.name = name;
  flight.position.set(x, 0, z);
  flight.rotation.y = rotationY;
  parent.add(flight);

  const totalDepth = steps * stepDepth;
  for (let step = 0; step < steps; step += 1) {
    const height = (step + 1) * stepHeight;
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(width, height, stepDepth),
      material,
    );
    slab.name = `${name}-${step + 1}`;
    slab.position.set(
      0,
      originY + height * 0.5,
      totalDepth * 0.5 - (step + 0.5) * stepDepth,
    );
    flight.add(slab);
  }
};

const addAnchorStairs = (
  parent: THREE.Group,
  material: THREE.Material,
  outlineMaterial: THREE.LineBasicMaterial,
): void => {
  for (let index = 0; index < CITY_MASSES.length; index += 1) {
    const anchor = CITY_MASSES[index];
    if (!anchor) continue;
    if (getWardTerraceLift(anchor.z) > 0.25) continue;
    if (getGothicCivicSpec(anchor.name)) continue;
    const rotationY = anchor.rotationY ?? 0;
    // A three-step crepidoma (about 1.5 units) in front of every civic
    // anchor: low enough to sit under the facade, deep enough to read as a
    // raised stone platform rather than a stack of thin strips.
    const steps = 3;
    const stepDepth = 1.9;
    const totalDepth = steps * stepDepth;
    const frontDistance = anchor.depth * CITY_BUILDING_PLAN_SCALE * 0.5 + totalDepth * 0.5;
    addStairFlight(
      parent,
      material,
      outlineMaterial,
      anchor.x + Math.sin(rotationY) * frontDistance,
      anchor.z + Math.cos(rotationY) * frontDistance,
      rotationY,
      Math.max(5.2, Math.min(8.5, anchor.width * CITY_BUILDING_PLAN_SCALE * 0.34)),
      steps,
      stepDepth,
      0.52,
      `blockout-anchor-stairs-${anchor.name}`,
    );
  }
};

const addWardTerracePodiums = (
  parent: THREE.Group,
  specs: readonly CityMassSpec[],
  material: THREE.Material,
): void => {
  const podiums: CityDetailTransform[] = [];
  for (const spec of specs) {
    const lift = getWardTerraceLift(spec.z);
    if (lift < 0.25) continue;
    const rotationY = spec.rotationY ?? 0;
    const cos = Math.cos(rotationY);
    const sin = Math.sin(rotationY);
    for (const part of createCityRenderParts(spec)) {
      podiums.push({
        x: spec.x + part.offsetX * cos + part.offsetZ * sin,
        y: CITY_DECK_Y + lift * 0.5,
        z: spec.z - part.offsetX * sin + part.offsetZ * cos,
        width: spec.width * CITY_BUILDING_PLAN_SCALE * part.widthScale * 1.08,
        height: lift,
        depth: spec.depth * CITY_BUILDING_PLAN_SCALE * part.depthScale * 1.08,
        rotationY,
      });
    }
  }
  addDetailInstances(
    parent,
    'blockout-ward-terrace-podiums',
    new THREE.BoxGeometry(1, 1, 1),
    material,
    podiums,
  );
};

const addMonumentalTerraceStairs = (
  parent: THREE.Group,
  material: THREE.Material,
  outlineMaterial: THREE.LineBasicMaterial,
  cheekMaterial: THREE.Material,
): void => {
  // Two road stairs on the processional only: the avenue itself climbs
  // toward the citadel. Treads are deliberately huge (Wahr Welt procession
  // scale) and each flight is flanked by solid stone cheeks, so a level
  // break reads as architecture from the street while the few big steps
  // cannot hatch into zebra stripes from the air.
  const width = 16;
  const tread = 3;
  const addRoadStair = (
    name: string,
    lipZ: number,
    fromLift: number,
    toLift: number,
  ): void => {
    const rise = toLift - fromLift;
    const steps = Math.max(3, Math.round(rise / 0.8));
    const totalDepth = steps * tread;
    const flightZ = lipZ + totalDepth * 0.5;
    addStairFlight(
      parent,
      material,
      outlineMaterial,
      0,
      flightZ,
      0,
      width,
      steps,
      tread,
      rise / steps,
      `blockout-terrace-stairs-${name}`,
      CITY_DECK_Y + fromLift,
    );
    // Cheeks sit just inside the road edges, span both road levels and cap
    // slightly above the top tread, framing the ceremonial climb. They are
    // deliberately NOT named with "stairs": the shadow pass treats stair
    // treads as ground surfaces, while these walls must cast their own
    // silhouette onto the lower road to make the level break readable.
    for (const side of [-1, 1] as const) {
      const cheek = new THREE.Mesh(
        new THREE.BoxGeometry(1.2, rise + 0.5, totalDepth + 2.4),
        cheekMaterial,
      );
      cheek.name = `blockout-terrace-cheek-${name}-${side < 0 ? 'w' : 'e'}`;
      cheek.position.set(
        side * (width * 0.5 - 0.7),
        CITY_DECK_Y + fromLift + (rise + 0.5) * 0.5,
        flightZ,
      );
      parent.add(cheek);
    }
  };

  addRoadStair('processional-front-middle', 400, 0, 3);
  addRoadStair('processional-middle-citadel', 190, 3, 5.6);
};

export const createBlockoutCity = (): THREE.Group => {
  const city = new THREE.Group();
  city.name = 'wahr-welt-world-blockout';
  city.position.z = TOWER_Z;

  const outlineMaterial = createOutlineMaterial();
  // First accepted texture pass: large pale slabs with low-contrast engraved
  // joints. This gives the floor scale without restoring the rejected purple
  // mottling or turning the streets into dark asphalt ribbons.
  const islandDeckMaterial = createWahrWeltFloorMaterial({
    base: 0xcfccd6,
    joint: 0xb0aeb8,
    ageTint: 0x9a90a4,
    slabWidth: 34,
    slabDepth: 46,
    seed: 0.8,
    ageStrength: 0.11,
  });
  const roadMaterial = createWahrWeltFloorMaterial({
    base: 0xd5d2da,
    joint: 0xb4b0ba,
    ageTint: 0x988ea0,
    slabWidth: 18,
    slabDepth: 26,
    seed: 2.4,
    ageStrength: 0.075,
  });
  const alleyMaterial = createWahrWeltFloorMaterial({
    base: 0xc8c5ce,
    joint: 0xa5a2ac,
    ageTint: 0x948aa0,
    slabWidth: 15,
    slabDepth: 22,
    seed: 4.1,
    ageStrength: 0.14,
  });
  // Monumental stair flights use their own lighter paving so a procession
  // stair reads as architecture against the road and deck. Joints (3.0 units)
  // are world-anchored and match the 3.0 tread, so the paving reads as one
  // division per step instead of vanishing into the road's 18x26 grid.
  // Cheeks are the darker shadow-stone of terrace walls so the flights keep
  // a solid silhouette from the quarter/city views.
  const stairMaterial = createWahrWeltFloorMaterial({
    base: 0xeae8ee,
    joint: 0xc4c2cc,
    ageTint: 0xaaa0b4,
    slabWidth: 9,
    slabDepth: 3,
    seed: 8.6,
    ageStrength: 0.06,
  });
  const stairCheekMaterial = createWahrWeltFlatMaterial(0x5a566a);
  // One shared world-space masonry shader covers every ordinary building and
  // instanced tier. Its procedural bump keeps blocks at a physical scale, so
  // hundreds of differently sized buildings do not allocate or stretch their
  // own normal maps.
  const cityMassMaterialLight = createWahrWeltStoneMaterial({
    base: 0xeeeaf2,
    top: 0xf5f1f7,
    joint: 0xaaa2b8,
    ageTint: 0x887399,
    courseWidth: 7.2,
    courseHeight: 3.1,
    originY: CITY_DECK_Y,
    seed: 3.7,
    reliefDepth: 0.085,
    grainStrength: 0.004,
    ageStrength: 0.05,
  });
  const cityMassMaterialMid = createWahrWeltStoneMaterial({
    base: 0xe1dce9,
    top: 0xede8f1,
    joint: 0xa299b0,
    ageTint: 0x806b93,
    courseWidth: 7.2,
    courseHeight: 3.1,
    originY: CITY_DECK_Y,
    seed: 3.7,
    reliefDepth: 0.085,
    grainStrength: 0.004,
    ageStrength: 0.06,
  });
  const cityMassMaterialDark = createWahrWeltStoneMaterial({
    base: 0xd1cade,
    top: 0xded8e8,
    joint: 0x958ba8,
    ageTint: 0x786489,
    courseWidth: 7.2,
    courseHeight: 3.1,
    originY: CITY_DECK_Y,
    seed: 3.7,
    reliefDepth: 0.09,
    grainStrength: 0.0045,
    ageStrength: 0.07,
  });
  const windowMaterial = createWahrWeltFlatMaterial(0x171321);
  const stainedGlassMaterial = createWahrWeltFlatMaterial(0x21182a);
  const facadeReliefMaterial = createWahrWeltFlatMaterial(0xd2d0d8);
  // The same chalk/mineral surface reaches the roof planes. World projection
  // and mipmaps keep the texture at a stable scale on pitched and flat roofs.
  const roofMaterial = createWahrWeltStoneMaterial({
    base: 0xd1cade, top: 0xe3deeb, joint: 0xa299b0, ageTint: 0x887399,
    originY: CITY_DECK_Y, courseWidth: 7.2, courseHeight: 3.1,
    seed: 3.7, surfaceScale: 70, mineralStrength: .4,
    reliefDepth: .065, grainStrength: .003, ageStrength: .04,
  });
  const gothicRoofMaterial = roofMaterial;
  const growthMaterial = createWahrWeltCrystalCoatingMaterial();
  const ageCrackMaterial = createWahrWeltFlatMaterial(0x6d6362);
  ageCrackMaterial.side = THREE.DoubleSide;
  ageCrackMaterial.transparent = true;
  ageCrackMaterial.opacity = 0.46;
  ageCrackMaterial.depthWrite = false;
  const freestandingTowerSlitMaterial = createWahrWeltFlatMaterial(0x241a31);
  const materials: Record<CityMassSpec['tone'], THREE.Material> = {
    light: cityMassMaterialLight,
    mid: cityMassMaterialMid,
    dark: cityMassMaterialDark,
  };

  city.add(createFloatingIsland(islandDeckMaterial));

  for (const street of CITY_STREETS) {
    const dx = street.x2 - street.x1;
    const dz = street.z2 - street.z1;
    const material = street.width >= 12 ? roadMaterial : alleyMaterial;
    if (street.name === 'processional-avenue') {
      const segments: Array<{ z1: number; z2: number; lift: number }> = [
        { z1: 400, z2: 620, lift: 0 },
        { z1: 190, z2: 400, lift: 3 },
        { z1: 76, z2: 190, lift: 5.6 },
      ];
      for (const segment of segments) {
        const length = segment.z2 - segment.z1;
        const road = new THREE.Mesh(
          new THREE.BoxGeometry(street.width, 0.46, length),
          material,
        );
        road.name = `blockout-road-${street.name}-${segment.lift}`;
        road.position.set(0, CITY_DECK_Y + 0.23 + segment.lift, (segment.z1 + segment.z2) * 0.5);
        city.add(road);
      }
      continue;
    }
    const length = Math.hypot(dx, dz);
    const road = new THREE.Mesh(
      new THREE.BoxGeometry(street.width, 0.46, length),
      material,
    );
    road.name = `blockout-road-${street.name}`;
    road.position.set(
      (street.x1 + street.x2) * 0.5,
      CITY_DECK_Y + 0.23,
      (street.z1 + street.z2) * 0.5,
    );
    road.rotation.y = Math.atan2(dx, dz);
    city.add(road);
  }
  addOutlinedBox(city, roadMaterial, outlineMaterial, 210, 0.7, 88, 0, CITY_DECK_Y + 0.35, 20, 'blockout-citadel-court');

  addWardTerracePodiums(
    city,
    [...CITY_MASSES, ...CITY_INFILL_MASSES],
    islandDeckMaterial,
  );
  addMonumentalTerraceStairs(city, stairMaterial, outlineMaterial, stairCheekMaterial);
  addAnchorStairs(city, stairMaterial, outlineMaterial);
  for (const stair of CITY_PASSAGE_STAIRS) {
    addStairFlight(
      city,
      stairMaterial,
      outlineMaterial,
      stair.x,
      stair.z,
      stair.rotationY,
      stair.width,
      stair.steps,
      1.4,
      0.45,
      `blockout-passage-stairs-${stair.name}`,
    );
  }

  // The twelve authored envelopes act as civic and non-residential anchors.
  // Four are complete Gothic landmarks; the rest keep the restrained blockout
  // grammar so those accents remain legible in the wider city composition.
  for (const spec of CITY_MASSES) {
    const gothic = getGothicCivicSpec(spec.name);
    if (gothic) {
      addGothicCivicMass(
        city,
        spec,
        gothic,
        cityMassMaterialMid,
        facadeReliefMaterial,
        gothicRoofMaterial,
        windowMaterial,
        stainedGlassMaterial,
        outlineMaterial,
      );
    } else {
      addCityMass(city, spec, materials, outlineMaterial);
    }
  }
  addCityInfillInstances(city, CITY_INFILL_MASSES, cityMassMaterialMid);
  addCityFacadeLayer(
    city,
    [...CITY_MASSES, ...CITY_INFILL_MASSES],
    windowMaterial,
    windowMaterial,
    facadeReliefMaterial,
    roofMaterial,
  );
  addCityAgingLayer(
    city,
    [...CITY_MASSES, ...CITY_INFILL_MASSES],
    ageCrackMaterial,
  );
  for (const tower of CITY_FREESTANDING_TOWERS) {
    addFreestandingCityTower(
      city,
      tower,
      cityMassMaterialMid,
      roofMaterial,
      freestandingTowerSlitMaterial,
      outlineMaterial,
    );
  }
  addCityGrowthLayer(
    city,
    [...CITY_MASSES, ...CITY_INFILL_MASSES],
    growthMaterial,
  );
  const outskirts = new THREE.Group();
  outskirts.name = 'city-outer-wards';
  const outerLots = createCityOutskirts();
  for (const tone of ['light', 'mid', 'dark'] as const) {
    const ward = new THREE.Group();
    ward.name = `outer-wards-${tone}`;
    const lots = outerLots.filter(lot => lot.tone === tone);
    addCityInfillInstances(ward, lots, materials[tone]);
    addCityFacadeLayer(ward, lots, windowMaterial, windowMaterial, facadeReliefMaterial, roofMaterial);
    outskirts.add(ward);
  }
  for (const tower of OUTSKIRT_TOWERS) {
    addFreestandingCityTower(outskirts, tower, cityMassMaterialMid, roofMaterial,
      freestandingTowerSlitMaterial, outlineMaterial);
  }
  outskirts.userData.lots = outerLots.length;
  outskirts.userData.towers = OUTSKIRT_TOWERS.length;
  city.add(outskirts);
  return city;
};

const addCitadelGrowthLayer = (
  parent: THREE.Group,
  material: THREE.Material,
): void => {
  const clusters = new CrystalClusterBuilder({ kind: 'citadel',
    metricScale: new THREE.Vector3(...CITADEL_WORLD_SCALE),
    masonry: createCitadelPrisms(CITY_DECK_Y),
    openings: parent.userData.citadelApertureClearances as CitadelPrism[],
  });
  const coating = new CrystalCoatingBuilder('citadel', false, clusters.addSurface);
  const faces = parent.userData.citadelExposedFaces as PrismFace[];
  coating.addPolygonAssembly(faces, new THREE.Vector3(...CITADEL_WORLD_SCALE),
    createCitadelCoatingOptions(CITADEL_WORLD_SCALE, CITY_DECK_Y));
  coating.build(parent, material, 'blockout-citadel-growth-crystal-coating');
  const mesh = parent.getObjectByName('blockout-citadel-growth-crystal-coating') as THREE.Mesh;
  clipCitadelCoating(mesh, [...createCitadelPrisms(CITY_DECK_Y),
    ...(parent.userData.citadelApertureClearances as CitadelPrism[])]);
  mesh.userData.distribution = 'exposed-polygonal-assembly';
  clusters.build(parent, createWahrWeltCrystalPrismMaterial());
};

const addCitadelAgingLayer = (
  parent: THREE.Group,
  crackMaterial: THREE.Material,
): void => {
  const wallCracks: CityDetailTransform[] = CITADEL_TIERS
    .filter(tier => tier.top - tier.bottom > 30)
    .map((tier, index) => {
      const point = citadelTierPoint(tier, tier.width * .17, tier.depth * .5 + .08);
      return {
        x: point.x, y: CITY_DECK_Y + tier.top - 14, z: point.y,
        width: 8, height: 18, depth: 0.12,
        rotationY: 'rotation' in tier ? tier.rotation : 0, rotationZ: index % 2 ? -0.13 : 0.16,
      };
    });
  addDetailInstances(
    parent,
    'blockout-citadel-aging-cracks',
    createUnitWallCrackGeometry(),
    crackMaterial,
    wallCracks,
  );
};

export const createBlockoutTower = (): BlockoutTowerController => {
  const group = new THREE.Group();
  group.name = 'wahr-welt-citadel-blockout';
  group.position.set(0, 0, TOWER_Z);

  const outlineMaterial = createOutlineMaterial();
  const ageCrackMaterial = createWahrWeltFlatMaterial(0x6d6362);
  ageCrackMaterial.side = THREE.DoubleSide;
  ageCrackMaterial.transparent = true;
  ageCrackMaterial.opacity = 0.46;
  ageCrackMaterial.depthWrite = false;
  const citadelGrowthMaterial = createWahrWeltCrystalCoatingMaterial();
  // The citadel is also one stone mass. Its stepped silhouette and the scene
  // lights provide hierarchy; separate light/dark paints caused false colour
  // variation that is absent from the reference.
  const citadelMaterial = createWahrWeltStoneMaterial({
    base: 0xe5e1ea,
    top: 0xf0ecf3,
    joint: 0xaaa0b6,
    ageTint: 0x857194,
    courseWidth: 14.5,
    courseHeight: 5.8,
    originY: CITY_DECK_Y,
    seed: 8.4,
    surfaceScale: 105,
    mineralStrength: .56,
    reliefDepth: 0.095,
    grainStrength: 0.004,
    ageStrength: 0.06,
  });

  addCitadelGeometry(group, citadelMaterial, outlineMaterial, CITY_DECK_Y);
  addCitadelGrowthLayer(
    group,
    citadelGrowthMaterial,
  );
  addCitadelAgingLayer(group, ageCrackMaterial);

  return {
    group,
    update: (_time: number) => {},
  };
};
