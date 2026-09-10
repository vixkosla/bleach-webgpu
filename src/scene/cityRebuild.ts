import * as THREE from 'three/webgpu';
import {
  createWahrWeltFlatMaterial,
  createWahrWeltFloorMaterial,
  createWahrWeltGrowthMaterial,
  createWahrWeltStoneMaterial,
} from '../materials/wahrWeltCityMaterial';
import { CITY_DECK_Y, CITY_RADIUS, TOWER_Z } from './constants';

type FacadeAxis = 'x' | 'z';
type BlockStyle = 'hall' | 'ward' | 'terrace' | 'gate';

interface BlockSpec {
  name: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  facadeAxis: FacadeAxis;
  facadeSign: -1 | 1;
  style: BlockStyle;
  roof: 'flat' | 'hip';
  seed: number;
  growth?: boolean;
  detail?: boolean;
  secondarySign?: -1 | 1;
  portalBias?: number;
  // Thin pointed spires on the roofline (Kubo's Wahr Welt is German gothic
  // stylised: steep tile roofs and needle spires, not flat brutalist slabs).
  spires?: number;
}

interface GrowthRidge {
  axis: FacadeAxis;
  fixed: number;
  start: number;
  end: number;
  y: number;
  seed: number;
  outward: -1 | 1;
}

interface InstanceTransform {
  position: THREE.Vector3;
  scale: THREE.Vector3;
  rotation: THREE.Euler;
}

const hash = (value: number): number => {
  const wave = Math.sin(value * 12.9898 + 78.233) * 43758.5453;
  return wave - Math.floor(wave);
};

const addBox = (
  parent: THREE.Object3D,
  material: THREE.Material,
  width: number,
  height: number,
  depth: number,
  x: number,
  y: number,
  z: number,
  rotationY = 0,
  name?: string,
): THREE.Mesh => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
  mesh.position.set(x, y, z);
  mesh.rotation.y = rotationY;
  if (name) mesh.name = name;
  parent.add(mesh);
  return mesh;
};

const createHipRoofGeometry = (
  width: number,
  depth: number,
  rise: number,
): THREE.BufferGeometry => {
  const halfW = width * 0.5;
  const halfD = depth * 0.5;
  const widthIsLong = width >= depth;
  // Wahr Welt uses a shallow macro roof with a long narrow ridge, not a
  // miniature pyramid perched on every block.
  const upperW = halfW * (widthIsLong ? 0.62 : 0.08);
  const upperD = halfD * (widthIsLong ? 0.08 : 0.62);
  const positions = new Float32Array([
    -halfW, 0, -halfD,
    halfW, 0, -halfD,
    halfW, 0, halfD,
    -halfW, 0, halfD,
    -upperW, rise, -upperD,
    upperW, rise, -upperD,
    upperW, rise, upperD,
    -upperW, rise, upperD,
  ]);
  const indices = [
    0, 1, 5, 0, 5, 4,
    1, 2, 6, 1, 6, 5,
    2, 3, 7, 2, 7, 6,
    3, 0, 4, 3, 4, 7,
    4, 5, 6, 4, 6, 7,
  ];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
};

const offsetPathPoint = (
  points: THREE.Vector2[],
  index: number,
  distance: number,
): THREE.Vector2 => {
  const point = points[index];
  if (!point) throw new Error('Invalid Wahr Welt road point');
  const previous = points[Math.max(0, index - 1)] ?? point;
  const next = points[Math.min(points.length - 1, index + 1)] ?? point;
  const incoming = point.clone().sub(previous);
  const outgoing = next.clone().sub(point);
  if (incoming.lengthSq() < 0.0001) incoming.copy(outgoing);
  if (outgoing.lengthSq() < 0.0001) outgoing.copy(incoming);
  incoming.normalize();
  outgoing.normalize();
  const previousNormal = new THREE.Vector2(-incoming.y, incoming.x);
  const nextNormal = new THREE.Vector2(-outgoing.y, outgoing.x);
  const miter = previousNormal.clone().add(nextNormal);
  if (miter.lengthSq() < 0.0001) miter.copy(nextNormal);
  miter.normalize();
  const denominator = Math.max(0.42, Math.abs(miter.dot(nextNormal)));
  return point.clone().addScaledVector(miter, distance / denominator);
};

const createPathBandGeometry = (
  points: THREE.Vector2[],
  firstOffset: number,
  secondOffset: number,
): THREE.BufferGeometry => {
  const positions: number[] = [];
  const indices: number[] = [];
  points.forEach((_, index) => {
    const first = offsetPathPoint(points, index, firstOffset);
    const second = offsetPathPoint(points, index, secondOffset);
    positions.push(first.x, 0, first.y, second.x, 0, second.y);
    if (index === 0) return;
    const previous = (index - 1) * 2;
    const current = index * 2;
    indices.push(previous, previous + 1, current + 1, previous, current + 1, current);
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  const normals = new Float32Array(positions.length);
  for (let index = 1; index < normals.length; index += 3) normals[index] = 1;
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  return geometry;
};

const addProcessionalRoad = (
  parent: THREE.Group,
  roadMaterial: THREE.Material,
  sidewalkMaterial: THREE.Material,
  curbMaterial: THREE.Material,
): void => {
  const points = [
    new THREE.Vector2(0, 334),
    new THREE.Vector2(0, 198),
    new THREE.Vector2(64, 198),
    new THREE.Vector2(34, 126),
    new THREE.Vector2(0, 26),
  ];
  const road = new THREE.Mesh(createPathBandGeometry(points, 19, -19), roadMaterial);
  road.name = 'wahr-welt-new-road';
  road.position.y = CITY_DECK_Y + 0.24;
  parent.add(road);

  const leftWalk = new THREE.Mesh(createPathBandGeometry(points, 26.5, 21), sidewalkMaterial);
  leftWalk.name = 'wahr-welt-new-sidewalk-left';
  leftWalk.position.y = CITY_DECK_Y + 0.5;
  parent.add(leftWalk);
  const rightWalk = new THREE.Mesh(createPathBandGeometry(points, -21, -26.5), sidewalkMaterial);
  rightWalk.name = 'wahr-welt-new-sidewalk-right';
  rightWalk.position.y = CITY_DECK_Y + 0.5;
  parent.add(rightWalk);

  const leftCurb = new THREE.Mesh(createPathBandGeometry(points, 21, 19.15), curbMaterial);
  leftCurb.name = 'wahr-welt-new-curb-left';
  leftCurb.position.y = CITY_DECK_Y + 0.62;
  parent.add(leftCurb);
  const rightCurb = new THREE.Mesh(createPathBandGeometry(points, -19.15, -21), curbMaterial);
  rightCurb.name = 'wahr-welt-new-curb-right';
  rightCurb.position.y = CITY_DECK_Y + 0.62;
  parent.add(rightCurb);
};

const addFacadeSlot = (
  parent: THREE.Group,
  material: THREE.Material,
  axis: FacadeAxis,
  face: number,
  along: number,
  y: number,
  sign: -1 | 1,
  width: number,
  height: number,
): void => {
  if (axis === 'x') {
    addBox(parent, material, 0.55, height, width, face + sign * 0.22, y, along);
  } else {
    addBox(parent, material, width, height, 0.55, along, y, face + sign * 0.22);
  }
};

const addFacadePortal = (
  parent: THREE.Group,
  recessMaterial: THREE.Material,
  frameMaterial: THREE.Material,
  axis: FacadeAxis,
  face: number,
  along: number,
  sign: -1 | 1,
  width: number,
  height: number,
): void => {
  const centerY = CITY_DECK_Y + height * 0.5 + 0.5;
  const jamb = 2.4;
  const lintel = 2.8;
  const depth = 5;
  const frameOffset = 2;
  if (axis === 'x') {
    addBox(parent, recessMaterial, 0.7, height, width, face + sign * 0.25, centerY, along);
    addBox(parent, frameMaterial, depth, height + lintel, jamb, face + sign * frameOffset, centerY, along - width * 0.5 - jamb * 0.5);
    addBox(parent, frameMaterial, depth, height + lintel, jamb, face + sign * frameOffset, centerY, along + width * 0.5 + jamb * 0.5);
    addBox(parent, frameMaterial, depth, lintel, width + jamb * 2, face + sign * frameOffset, CITY_DECK_Y + height + lintel * 0.5 + 0.5, along);
  } else {
    addBox(parent, recessMaterial, width, height, 0.7, along, centerY, face + sign * 0.25);
    addBox(parent, frameMaterial, jamb, height + lintel, depth, along - width * 0.5 - jamb * 0.5, centerY, face + sign * frameOffset);
    addBox(parent, frameMaterial, jamb, height + lintel, depth, along + width * 0.5 + jamb * 0.5, centerY, face + sign * frameOffset);
    addBox(parent, frameMaterial, width + jamb * 2, lintel, depth, along, CITY_DECK_Y + height + lintel * 0.5 + 0.5, face + sign * frameOffset);
  }
};

const addFacadeDetails = (
  parent: THREE.Group,
  spec: BlockSpec,
  recessMaterial: THREE.Material,
  frameMaterial: THREE.Material,
): void => {
  if (spec.detail === false || spec.style === 'gate') return;
  const facadeLength = spec.facadeAxis === 'x' ? spec.depth : spec.width;
  const face = spec.facadeAxis === 'x'
    ? spec.x + spec.facadeSign * spec.width * 0.5
    : spec.z + spec.facadeSign * spec.depth * 0.5;
  const center = spec.facadeAxis === 'x' ? spec.z : spec.x;
  const slotWidth = THREE.MathUtils.clamp(spec.height * 0.04, 1.6, 2.4);
  const slotHeight = THREE.MathUtils.clamp(spec.height * 0.27, 11, 17);
  const spacing = THREE.MathUtils.clamp(spec.height * 0.19, 8, 13);
  const groupCenters = facadeLength > 96
    ? [center - facadeLength * 0.235, center + facadeLength * 0.235]
    : [center + (spec.seed > 0.5 ? -1 : 1) * facadeLength * 0.14];

  // A few deep vertical piers carry the scale. They are deliberately sparse
  // so the facade remains mostly uninterrupted masonry rather than an office
  // grid.
  const pierHeight = spec.height * 0.76;
  const pierWidth = THREE.MathUtils.clamp(spec.height * 0.085, 4, 5.8);
  const pierPositions = [center - facadeLength * 0.44, center + facadeLength * 0.44];
  for (const along of pierPositions) {
    if (spec.facadeAxis === 'x') {
      addBox(
        parent,
        frameMaterial,
        4.5,
        pierHeight,
        pierWidth,
        face + spec.facadeSign * 1.75,
        CITY_DECK_Y + pierHeight * 0.5,
        along,
      );
    } else {
      addBox(
        parent,
        frameMaterial,
        pierWidth,
        pierHeight,
        4.5,
        along,
        CITY_DECK_Y + pierHeight * 0.5,
        face + spec.facadeSign * 1.75,
      );
    }
  }

  for (const groupCenter of groupCenters) {
    for (let index = 0; index < 3; index += 1) {
      const along = groupCenter + (index - 1) * spacing;
      addFacadeSlot(
        parent,
        recessMaterial,
        spec.facadeAxis,
        face,
        along,
        CITY_DECK_Y + spec.height * 0.38,
        spec.facadeSign,
        slotWidth,
        slotHeight,
      );
    }
  }

  if (spec.height > 54) {
    const upperCenter = groupCenters[spec.seed > 0.5 ? 0 : groupCenters.length - 1] ?? center;
    for (let index = 0; index < 2; index += 1) {
      addFacadeSlot(
        parent,
        recessMaterial,
        spec.facadeAxis,
        face,
        upperCenter + (index - 0.5) * spacing,
        CITY_DECK_Y + spec.height * 0.69,
        spec.facadeSign,
        slotWidth,
        slotHeight * 0.88,
      );
    }
  }

  if (spec.style === 'ward' || spec.portalBias !== undefined) {
    const portalBias = spec.portalBias
      ?? ((spec.seed > 0.5 ? 1 : -1) * 0.32);
    const portalAlong = center + facadeLength * portalBias;
    addFacadePortal(
      parent,
      recessMaterial,
      frameMaterial,
      spec.facadeAxis,
      face,
      portalAlong,
      spec.facadeSign,
      THREE.MathUtils.clamp(spec.height * 0.15, 7, 10),
      THREE.MathUtils.clamp(spec.height * 0.34, 16, 23),
    );
  }
};

const addSecondaryFacadeDetails = (
  parent: THREE.Group,
  spec: BlockSpec,
  recessMaterial: THREE.Material,
  frameMaterial: THREE.Material,
): void => {
  if (spec.detail === false || spec.secondarySign === undefined || spec.style === 'gate') return;
  const axis: FacadeAxis = spec.facadeAxis === 'x' ? 'z' : 'x';
  const sign = spec.secondarySign;
  const facadeLength = axis === 'x' ? spec.depth : spec.width;
  const face = axis === 'x'
    ? spec.x + sign * spec.width * 0.5
    : spec.z + sign * spec.depth * 0.5;
  const center = axis === 'x' ? spec.z : spec.x;
  const slotWidth = THREE.MathUtils.clamp(spec.height * 0.038, 1.5, 2.3);
  const slotHeight = THREE.MathUtils.clamp(spec.height * 0.25, 10, 16);
  const spacing = THREE.MathUtils.clamp(spec.height * 0.18, 7.5, 12);
  const groupCenter = center + (spec.seed > 0.5 ? -1 : 1) * facadeLength * 0.12;
  for (let index = 0; index < 3; index += 1) {
    addFacadeSlot(
      parent,
      recessMaterial,
      axis,
      face,
      groupCenter + (index - 1) * spacing,
      CITY_DECK_Y + spec.height * 0.4,
      sign,
      slotWidth,
      slotHeight,
    );
  }

  const pierHeight = spec.height * 0.72;
  const pierWidth = THREE.MathUtils.clamp(spec.height * 0.08, 3.8, 5.5);
  for (const along of [center - facadeLength * 0.42, center + facadeLength * 0.4]) {
    if (axis === 'x') {
      addBox(parent, frameMaterial, 4, pierHeight, pierWidth, face + sign * 1.55, CITY_DECK_Y + pierHeight * 0.5, along);
    } else {
      addBox(parent, frameMaterial, pierWidth, pierHeight, 4, along, CITY_DECK_Y + pierHeight * 0.5, face + sign * 1.55);
    }
  }
};

const addBlockSpires = (
  building: THREE.Group,
  spec: BlockSpec,
  material: THREE.Material,
  capY: number,
): void => {
  const count = spec.spires ?? 0;
  if (count <= 0) return;
  const facadeLength = spec.facadeAxis === 'x' ? spec.depth : spec.width;
  const spireHeight = spec.height * (0.26 + spec.seed * 0.2);
  const spireRadius = THREE.MathUtils.clamp(spec.width * 0.02, 0.7, 1.4);
  const spacing = facadeLength * 0.3;
  const alongBase = spec.facadeAxis === 'x' ? spec.z : spec.x;
  for (let index = 0; index < count; index += 1) {
    const along = alongBase + (index - (count - 1) * 0.5) * spacing;
    const sx = spec.facadeAxis === 'x' ? spec.x : along;
    const sz = spec.facadeAxis === 'x' ? along : spec.z;
    // 4-sided needle cone: a steep pointed gothic roof peak.
    const spire = new THREE.Mesh(new THREE.ConeGeometry(spireRadius, spireHeight, 4), material);
    spire.position.set(sx, capY + spireHeight * 0.5, sz);
    spire.name = `${spec.name}-spire-${index}`;
    building.add(spire);
  }
};

const addBlock = (
  parent: THREE.Group,
  spec: BlockSpec,
  stoneMaterials: THREE.MeshToonNodeMaterial[],
  roofMaterial: THREE.Material,
  recessMaterial: THREE.Material,
  growthRidges: GrowthRidge[],
): void => {
  const material = stoneMaterials[Math.floor(spec.seed * stoneMaterials.length) % stoneMaterials.length]
    ?? stoneMaterials[0];
  if (!material) throw new Error('Wahr Welt stone material palette is empty');
  const building = new THREE.Group();
  building.name = spec.name;
  parent.add(building);

  const alongLength = spec.facadeAxis === 'x' ? spec.depth : spec.width;
  const shiftFactor = spec.style === 'terrace' ? 0.27 : spec.style === 'ward' ? 0.25 : 0.15;
  const alongShift = (spec.seed > 0.5 ? 1 : -1) * alongLength * shiftFactor;
  let growthY = CITY_DECK_Y + spec.height;

  if (spec.style === 'gate') {
    const openingDepth = 30;
    const pylonDepth = (spec.depth - openingDepth) * 0.5;
    const pylonOffset = (openingDepth + pylonDepth) * 0.5;
    const bridgeHeight = 18;
    const bridgeY = CITY_DECK_Y + spec.height - bridgeHeight * 0.5;
    const facadeFace = spec.x + spec.facadeSign * spec.width * 0.5;

    // This is a real urban void, not a black rectangle pasted onto another
    // box: two monumental pylons carry an elevated bridge over the street.
    for (const side of [-1, 1] as const) {
      const pylonZ = spec.z + side * pylonOffset;
      addBox(
        building,
        material,
        spec.width,
        spec.height,
        pylonDepth,
        spec.x,
        CITY_DECK_Y + spec.height * 0.5,
        pylonZ,
      );
      addBox(
        building,
        roofMaterial,
        spec.width + 3,
        1.8,
        pylonDepth + 2.5,
        spec.x,
        CITY_DECK_Y + spec.height + 0.9,
        pylonZ,
      );
      addFacadeSlot(
        building,
        recessMaterial,
        'x',
        facadeFace,
        pylonZ,
        CITY_DECK_Y + spec.height * 0.47,
        spec.facadeSign,
        2.4,
        17,
      );
    }
    addBox(
      building,
      material,
      spec.width,
      bridgeHeight,
      openingDepth,
      spec.x,
      bridgeY,
      spec.z,
    );
    addBox(
      building,
      roofMaterial,
      spec.width + 3,
      2,
      openingDepth + 3,
      spec.x,
      CITY_DECK_Y + spec.height + 1,
      spec.z,
    );

    const pierHeight = spec.height * 0.78;
    const pierWidth = THREE.MathUtils.clamp(spec.height * 0.085, 4, 5.8);
    for (const along of [spec.z - spec.depth * 0.44, spec.z + spec.depth * 0.44]) {
      addBox(
        building,
        material,
        4.5,
        pierHeight,
        pierWidth,
        facadeFace + spec.facadeSign * 1.75,
        CITY_DECK_Y + pierHeight * 0.5,
        along,
      );
    }

    if (spec.growth) {
      const ridgeFixed = facadeFace + spec.facadeSign * 0.65;
      const ridgeY = CITY_DECK_Y + spec.height + 1.6;
      const segments: Array<[number, number]> = [
        [spec.z - spec.depth * 0.44, spec.z - spec.depth * 0.25],
        [spec.z - openingDepth * 0.43, spec.z + openingDepth * 0.36],
        [spec.z + spec.depth * 0.27, spec.z + spec.depth * 0.46],
      ];
      segments.forEach(([start, end], index) => {
        growthRidges.push({
          axis: 'x',
          fixed: ridgeFixed,
          start,
          end,
          y: ridgeY,
          seed: spec.seed * 29 + 3.7 + index * 4.13,
          outward: spec.facadeSign,
        });
      });
    }
    growthY = CITY_DECK_Y + spec.height;
  } else if (spec.style === 'hall') {
    const roofRise = spec.roof === 'hip' ? Math.min(spec.width, spec.depth) * 0.15 : 0;
    const bodyHeight = spec.height - roofRise;
    addBox(building, material, spec.width, bodyHeight, spec.depth, spec.x, CITY_DECK_Y + bodyHeight * 0.5, spec.z);
    addBox(building, material, spec.width + 4.5, 2.1, spec.depth + 4.5, spec.x, CITY_DECK_Y + bodyHeight * 0.64, spec.z);
    if (spec.roof === 'hip') {
      const roofOverhang = Math.min(spec.width, spec.depth) * 0.055;
      const roof = new THREE.Mesh(
        createHipRoofGeometry(
          spec.width + roofOverhang * 2,
          spec.depth + roofOverhang * 2,
          roofRise,
        ),
        roofMaterial,
      );
      roof.position.set(spec.x, CITY_DECK_Y + bodyHeight, spec.z);
      roof.name = `${spec.name}-macro-roof`;
      building.add(roof);
    } else {
      addBox(building, roofMaterial, spec.width + 3, 1.8, spec.depth + 3, spec.x, CITY_DECK_Y + bodyHeight + 0.9, spec.z);
    }
    growthY = CITY_DECK_Y + bodyHeight + (spec.roof === 'hip' ? roofRise : 1.8);
  } else if (spec.style === 'ward') {
    const lowerHeight = spec.height * 0.68;
    const upperHeight = spec.height - lowerHeight;
    addBox(building, material, spec.width, lowerHeight, spec.depth, spec.x, CITY_DECK_Y + lowerHeight * 0.5, spec.z);
    addBox(building, material, spec.width + 4, 2.2, spec.depth + 4, spec.x, CITY_DECK_Y + lowerHeight + 1.1, spec.z);
    const upperWidth = spec.facadeAxis === 'x' ? spec.width * 0.76 : spec.width * 0.46;
    const upperDepth = spec.facadeAxis === 'x' ? spec.depth * 0.46 : spec.depth * 0.76;
    const upperX = spec.facadeAxis === 'z' ? spec.x + alongShift : spec.x - spec.facadeSign * spec.width * 0.08;
    const upperZ = spec.facadeAxis === 'x' ? spec.z + alongShift : spec.z - spec.facadeSign * spec.depth * 0.08;
    addBox(building, material, upperWidth, upperHeight, upperDepth, upperX, CITY_DECK_Y + lowerHeight + upperHeight * 0.5, upperZ);
    addBox(building, roofMaterial, upperWidth + 3, 1.8, upperDepth + 3, upperX, CITY_DECK_Y + spec.height + 0.9, upperZ);
    growthY = CITY_DECK_Y + lowerHeight + 2.2;
  } else {
    const lowerHeight = spec.height * 0.56;
    const upperHeight = spec.height - lowerHeight;
    addBox(building, material, spec.width, lowerHeight, spec.depth, spec.x, CITY_DECK_Y + lowerHeight * 0.5, spec.z);
    addBox(building, material, spec.width + 5, 2.4, spec.depth + 5, spec.x, CITY_DECK_Y + lowerHeight + 1.2, spec.z);
    const upperWidth = spec.facadeAxis === 'x' ? spec.width * 0.8 : spec.width * 0.5;
    const upperDepth = spec.facadeAxis === 'x' ? spec.depth * 0.5 : spec.depth * 0.8;
    const upperX = spec.facadeAxis === 'z' ? spec.x + alongShift : spec.x - spec.facadeSign * spec.width * 0.07;
    const upperZ = spec.facadeAxis === 'x' ? spec.z + alongShift : spec.z - spec.facadeSign * spec.depth * 0.07;
    addBox(building, material, upperWidth, upperHeight, upperDepth, upperX, CITY_DECK_Y + lowerHeight + upperHeight * 0.5, upperZ);
    addBox(building, roofMaterial, upperWidth + 3, 1.7, upperDepth + 3, upperX, CITY_DECK_Y + spec.height + 0.85, upperZ);
    growthY = CITY_DECK_Y + lowerHeight + 2.4;
  }

  addFacadeDetails(building, spec, recessMaterial, material);
  addSecondaryFacadeDetails(building, spec, recessMaterial, material);

  if (spec.spires) {
    const spireCapY = CITY_DECK_Y + spec.height + 2.2;
    addBlockSpires(building, spec, roofMaterial, spireCapY);
  }

  if (spec.growth && spec.style !== 'gate') {
    const facadeLength = spec.facadeAxis === 'x' ? spec.depth : spec.width;
    const face = spec.facadeAxis === 'x'
      ? spec.x + spec.facadeSign * spec.width * 0.5
      : spec.z + spec.facadeSign * spec.depth * 0.5;
    const center = spec.facadeAxis === 'x' ? spec.z : spec.x;
    const mirror = spec.seed > 0.5;
    growthRidges.push({
      axis: spec.facadeAxis,
      fixed: face + spec.facadeSign * 0.65,
      start: center - facadeLength * (mirror ? 0.36 : 0.3),
      end: center + facadeLength * (mirror ? 0.3 : 0.36),
      y: growthY,
      seed: spec.seed * 29 + 3.7,
      outward: spec.facadeSign,
    });
  }
};

const addGrowth = (
  parent: THREE.Group,
  ridges: GrowthRidge[],
  material: THREE.Material,
): void => {
  const chunks: InstanceTransform[] = [];
  const shards: InstanceTransform[] = [];
  for (const ridge of ridges) {
    const length = ridge.end - ridge.start;

    // A continuous torn sheet gives the growth its large anime silhouette;
    // faceted instances below break that sheet into crystalline detail.
    const sheetSegments = Math.max(12, Math.round(length / 2.4));
    const sheetPositions: number[] = [];
    const sheetIndices: number[] = [];
    for (let index = 0; index <= sheetSegments; index += 1) {
      const u = index / sheetSegments;
      const along = THREE.MathUtils.lerp(ridge.start, ridge.end, u);
      const upperNoise = hash(ridge.seed * 3.7 + index * 7.13);
      const lowerNoise = hash(ridge.seed * 5.9 + index * 11.41);
      const outward = ridge.fixed + ridge.outward * (0.48 + upperNoise * 1.35);
      const topY = ridge.y + 0.7 + upperNoise * 3.2;
      const bottomY = ridge.y - 2.3 - lowerNoise * 4.1;
      if (ridge.axis === 'x') {
        sheetPositions.push(outward, topY, along, outward, bottomY, along);
      } else {
        sheetPositions.push(along, topY, outward, along, bottomY, outward);
      }
      if (index === 0) continue;
      const previous = (index - 1) * 2;
      const current = index * 2;
      const reverse = hash(ridge.seed + index * 23.9) > 0.5;
      if (reverse) {
        sheetIndices.push(previous, previous + 1, current, current, previous + 1, current + 1);
      } else {
        sheetIndices.push(previous, previous + 1, current + 1, previous, current + 1, current);
      }
    }
    const sheetGeometry = new THREE.BufferGeometry();
    sheetGeometry.setAttribute('position', new THREE.Float32BufferAttribute(sheetPositions, 3));
    sheetGeometry.setIndex(sheetIndices);
    sheetGeometry.computeVertexNormals();
    const sheet = new THREE.Mesh(sheetGeometry, material);
    sheet.name = 'wahr-welt-new-growth-sheet';
    parent.add(sheet);

    const count = Math.max(20, Math.round(length / 1.7));
    for (let index = 0; index < count; index += 1) {
      const u = (index + 0.5) / count;
      const n0 = hash(ridge.seed + index * 2.73);
      const n1 = hash(ridge.seed * 2.1 + index * 5.17);
      if (n0 < 0.22) continue;
      const along = THREE.MathUtils.lerp(ridge.start, ridge.end, u);
      const fixed = ridge.fixed + ridge.outward * (n1 - 0.5) * 1.4;
      const position = ridge.axis === 'x'
        ? new THREE.Vector3(fixed, ridge.y + (n0 - 0.5) * 1.8, along)
        : new THREE.Vector3(along, ridge.y + (n0 - 0.5) * 1.8, fixed);
      const alongScale = 0.65 + n0 * 1.1;
      const outwardScale = 0.28 + n1 * 0.52;
      chunks.push({
        position,
        scale: ridge.axis === 'x'
          ? new THREE.Vector3(outwardScale, 0.55 + n1 * 1.15, alongScale)
          : new THREE.Vector3(alongScale, 0.55 + n1 * 1.15, outwardScale),
        rotation: new THREE.Euler(n1 * 1.4, n0 * Math.PI * 1.7, (n0 - 0.5) * 1.2),
      });

      if (n1 > 0.84) {
        const height = 1.8 + n1 * 3.4;
        const shardPosition = position.clone();
        shardPosition.y += n0 > 0.72 ? height * 0.42 : -height * 0.48;
        shards.push({
          position: shardPosition,
          scale: new THREE.Vector3(0.38 + n0 * 0.48, height, 0.38 + n0 * 0.48),
          rotation: new THREE.Euler(0, n1 * Math.PI, n0 > 0.72 ? (n0 - 0.5) * 0.18 : Math.PI),
        });
      }

      // Broad torn sheets crawl down the wall. They keep the growth connected
      // to the architecture and avoid the old necklace of repeated crystals.
      if (n0 > 0.66 && index % 3 === 0) {
        const tiers = 4;
        const halfWidth = 1.35 + n0 * 2.15;
        const drop = 7 + n1 * 15;
        const cascadePositions: number[] = [];
        const cascadeIndices: number[] = [];
        for (let tier = 0; tier <= tiers; tier += 1) {
          const t = tier / tiers;
          const tierHash = hash(ridge.seed * 7.3 + index * 19.7 + tier * 13.1);
          const centerDrift = (tierHash - 0.5) * halfWidth * (0.45 + t * 0.55);
          const width = halfWidth * (1 - t * 0.72) * (0.82 + tierHash * 0.34);
          const cascadeAlong = along + centerDrift;
          const cascadeFixed = ridge.fixed + ridge.outward * (0.62 + tierHash * 0.72);
          const cascadeY = ridge.y + 0.5 - drop * t;
          if (ridge.axis === 'x') {
            cascadePositions.push(
              cascadeFixed, cascadeY, cascadeAlong - width,
              cascadeFixed, cascadeY, cascadeAlong + width,
            );
          } else {
            cascadePositions.push(
              cascadeAlong - width, cascadeY, cascadeFixed,
              cascadeAlong + width, cascadeY, cascadeFixed,
            );
          }
          if (tier === 0) continue;
          const previous = (tier - 1) * 2;
          const current = tier * 2;
          cascadeIndices.push(
            previous, previous + 1, current + 1,
            previous, current + 1, current,
          );
        }
        const cascadeGeometry = new THREE.BufferGeometry();
        cascadeGeometry.setAttribute(
          'position',
          new THREE.Float32BufferAttribute(cascadePositions, 3),
        );
        cascadeGeometry.setIndex(cascadeIndices);
        cascadeGeometry.computeVertexNormals();
        const cascadeSheet = new THREE.Mesh(cascadeGeometry, material);
        cascadeSheet.name = 'wahr-welt-new-growth-cascade';
        parent.add(cascadeSheet);
      }
    }
  }

  const dummy = new THREE.Object3D();
  const chunkMesh = new THREE.InstancedMesh(new THREE.TetrahedronGeometry(1, 0), material, chunks.length);
  chunkMesh.name = 'wahr-welt-new-growth-crust';
  chunks.forEach((transform, index) => {
    dummy.position.copy(transform.position);
    dummy.scale.copy(transform.scale);
    dummy.rotation.copy(transform.rotation);
    dummy.updateMatrix();
    chunkMesh.setMatrixAt(index, dummy.matrix);
  });
  chunkMesh.instanceMatrix.needsUpdate = true;
  parent.add(chunkMesh);

  const shardMesh = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 5), material, shards.length);
  shardMesh.name = 'wahr-welt-new-growth-shards';
  shards.forEach((transform, index) => {
    dummy.position.copy(transform.position);
    dummy.scale.copy(transform.scale);
    dummy.rotation.copy(transform.rotation);
    dummy.updateMatrix();
    shardMesh.setMatrixAt(index, dummy.matrix);
  });
  shardMesh.instanceMatrix.needsUpdate = true;
  parent.add(shardMesh);
};

const HERO_BLOCKS: BlockSpec[] = [
  { name: 'new-west-outer-hall', x: -52, z: 320, width: 54, depth: 122, height: 48, facadeAxis: 'x', facadeSign: 1, secondarySign: 1, style: 'hall', roof: 'flat', seed: 0.12, growth: true },
  { name: 'new-east-outer-ward', x: 58, z: 318, width: 62, depth: 112, height: 68, facadeAxis: 'x', facadeSign: -1, secondarySign: 1, style: 'ward', roof: 'flat', seed: 0.71, growth: true },
  { name: 'new-west-inner-hall', x: -57, z: 202, width: 64, depth: 102, height: 42, facadeAxis: 'x', facadeSign: 1, secondarySign: 1, style: 'hall', roof: 'hip', seed: 0.44, growth: true },
  { name: 'new-turn-north-terrace', x: 110, z: 255, width: 136, depth: 50, height: 47, facadeAxis: 'z', facadeSign: -1, secondarySign: -1, style: 'terrace', roof: 'flat', seed: 0.83, growth: true },
  { name: 'new-turn-south-hall', x: 158, z: 153, width: 122, depth: 50, height: 44, facadeAxis: 'z', facadeSign: 1, secondarySign: -1, style: 'hall', roof: 'hip', seed: 0.27, growth: true },
  { name: 'new-quarter-east-gate', x: 230, z: 198, width: 52, depth: 110, height: 62, facadeAxis: 'x', facadeSign: -1, secondarySign: -1, style: 'gate', roof: 'flat', seed: 0.57, growth: true },
  { name: 'new-inner-west-ward', x: -24, z: 130, width: 68, depth: 108, height: 68, facadeAxis: 'z', facadeSign: 1, secondarySign: 1, style: 'ward', roof: 'flat', seed: 0.62, growth: true },
  { name: 'new-inner-east-hall', x: 101, z: 94, width: 66, depth: 108, height: 49, facadeAxis: 'x', facadeSign: -1, secondarySign: 1, style: 'hall', roof: 'flat', seed: 0.35, growth: true },
];

const BACKGROUND_BLOCKS: BlockSpec[] = [
  { name: 'new-background-west-a', x: -145, z: 315, width: 92, depth: 142, height: 42, facadeAxis: 'x', facadeSign: 1, style: 'terrace', roof: 'flat', seed: 0.18, detail: false },
  { name: 'new-background-east-a', x: 166, z: 310, width: 96, depth: 146, height: 46, facadeAxis: 'x', facadeSign: -1, style: 'hall', roof: 'flat', seed: 0.52, detail: false },
  { name: 'new-background-west-b', x: -150, z: 145, width: 100, depth: 132, height: 39, facadeAxis: 'x', facadeSign: 1, style: 'hall', roof: 'hip', seed: 0.76, detail: false },
  { name: 'new-background-east-b', x: 176, z: 105, width: 108, depth: 130, height: 44, facadeAxis: 'x', facadeSign: -1, style: 'terrace', roof: 'flat', seed: 0.31, detail: false },
  { name: 'new-background-north', x: 36, z: -132, width: 166, depth: 78, height: 36, facadeAxis: 'z', facadeSign: 1, style: 'hall', roof: 'flat', seed: 0.91, detail: false },
];

// The citadel sits in the geometric centre of the single island; these
// quarters close the ring behind it so every viewing angle lands on city,
// exactly like the reference overhead frame with the central cathedral.
const SOUTH_BLOCKS: BlockSpec[] = [
  { name: 'new-south-west-hall', x: -74, z: -168, width: 66, depth: 104, height: 45, facadeAxis: 'x', facadeSign: 1, secondarySign: 1, style: 'hall', roof: 'flat', seed: 0.23, growth: true },
  { name: 'new-south-east-ward', x: 84, z: -158, width: 66, depth: 112, height: 58, facadeAxis: 'x', facadeSign: -1, secondarySign: 1, style: 'ward', roof: 'flat', seed: 0.68, growth: true },
  { name: 'new-south-centre-terrace', x: 6, z: -244, width: 148, depth: 54, height: 47, facadeAxis: 'z', facadeSign: 1, secondarySign: -1, style: 'terrace', roof: 'flat', seed: 0.41, growth: true },
  { name: 'new-south-background-west', x: -168, z: -196, width: 96, depth: 138, height: 40, facadeAxis: 'x', facadeSign: 1, style: 'hall', roof: 'flat', seed: 0.85, detail: false },
  { name: 'new-south-background-east', x: 182, z: -172, width: 100, depth: 132, height: 43, facadeAxis: 'x', facadeSign: -1, style: 'terrace', roof: 'flat', seed: 0.14, detail: false },
  { name: 'new-south-background-far', x: -28, z: -318, width: 162, depth: 70, height: 36, facadeAxis: 'z', facadeSign: 1, style: 'hall', roof: 'flat', seed: 0.57, detail: false },
  { name: 'new-west-flank-terrace', x: -186, z: -22, width: 104, depth: 128, height: 41, facadeAxis: 'x', facadeSign: 1, style: 'terrace', roof: 'flat', seed: 0.36, detail: false },
  { name: 'new-east-flank-hall', x: 196, z: -34, width: 104, depth: 136, height: 46, facadeAxis: 'x', facadeSign: -1, style: 'hall', roof: 'flat', seed: 0.79, detail: false },
];

// Dense shoulder-to-shoulder infill. The hero blocks above establish the
// grammar; these close the gaps so the city reads as packed monumental mass
// (Kubo: buildings stand shoulder to shoulder, each one colossal), not a few
// lonely boxes in a void. Kept clear of the processional road corridor.
const INFILL_BLOCKS: BlockSpec[] = [
  { name: 'new-inf-w-1', x: -38, z: 296, width: 26, depth: 40, height: 34, facadeAxis: 'x', facadeSign: 1, secondarySign: 1, style: 'ward', roof: 'flat', seed: 0.22, growth: true, spires: 1 },
  { name: 'new-inf-w-2', x: -40, z: 248, width: 24, depth: 38, height: 31, facadeAxis: 'x', facadeSign: 1, secondarySign: 1, style: 'terrace', roof: 'flat', seed: 0.55, growth: true, spires: 1 },
  { name: 'new-inf-w-3', x: -80, z: 190, width: 28, depth: 36, height: 36, facadeAxis: 'x', facadeSign: 1, secondarySign: 1, style: 'hall', roof: 'hip', seed: 0.81, growth: true, spires: 2 },
  { name: 'new-inf-e-1', x: 40, z: 292, width: 26, depth: 40, height: 35, facadeAxis: 'x', facadeSign: -1, secondarySign: 1, style: 'hall', roof: 'hip', seed: 0.33, growth: true, spires: 1 },
  { name: 'new-inf-e-2', x: 42, z: 244, width: 24, depth: 38, height: 32, facadeAxis: 'x', facadeSign: -1, secondarySign: 1, style: 'ward', roof: 'flat', seed: 0.68, growth: true, spires: 1 },
  { name: 'new-inf-e-3', x: 100, z: 190, width: 26, depth: 36, height: 37, facadeAxis: 'x', facadeSign: -1, secondarySign: 1, style: 'terrace', roof: 'flat', seed: 0.91, growth: true, spires: 2 },
  { name: 'new-inf-n-1', x: -74, z: 158, width: 38, depth: 24, height: 30, facadeAxis: 'z', facadeSign: 1, secondarySign: -1, style: 'ward', roof: 'flat', seed: 0.14, growth: true, spires: 1 },
  { name: 'new-inf-n-2', x: 96, z: 232, width: 36, depth: 26, height: 33, facadeAxis: 'z', facadeSign: -1, secondarySign: 1, style: 'hall', roof: 'hip', seed: 0.47, growth: true, spires: 1 },
  { name: 'new-inf-n-3', x: 110, z: 180, width: 34, depth: 26, height: 35, facadeAxis: 'z', facadeSign: 1, secondarySign: -1, style: 'ward', roof: 'flat', seed: 0.72, growth: true, spires: 2 },
  { name: 'new-inf-s-1', x: -74, z: 92, width: 40, depth: 26, height: 34, facadeAxis: 'z', facadeSign: 1, secondarySign: -1, style: 'hall', roof: 'hip', seed: 0.26, growth: true, spires: 2 },
  { name: 'new-inf-s-2', x: -56, z: 96, width: 26, depth: 42, height: 38, facadeAxis: 'x', facadeSign: 1, secondarySign: 1, style: 'ward', roof: 'flat', seed: 0.59, growth: true, spires: 1 },
  { name: 'new-inf-s-3', x: 58, z: 52, width: 28, depth: 40, height: 36, facadeAxis: 'x', facadeSign: -1, secondarySign: 1, style: 'terrace', roof: 'flat', seed: 0.88, growth: true, spires: 1 },
  { name: 'new-inf-bg-1', x: -96, z: 262, width: 44, depth: 52, height: 30, facadeAxis: 'x', facadeSign: 1, style: 'hall', roof: 'hip', seed: 0.37, growth: true, spires: 1 },
  { name: 'new-inf-bg-2', x: 98, z: 276, width: 46, depth: 48, height: 31, facadeAxis: 'x', facadeSign: -1, style: 'ward', roof: 'flat', seed: 0.64, growth: true, spires: 1 },
  { name: 'new-inf-bg-3', x: -108, z: 150, width: 48, depth: 46, height: 29, facadeAxis: 'x', facadeSign: 1, style: 'terrace', roof: 'flat', seed: 0.19, growth: true, spires: 1 },
  { name: 'new-inf-bg-4', x: 132, z: 92, width: 44, depth: 50, height: 33, facadeAxis: 'x', facadeSign: -1, style: 'hall', roof: 'hip', seed: 0.51, growth: true, spires: 2 },
  { name: 'new-inf-court-1', x: -76, z: 46, width: 36, depth: 44, height: 35, facadeAxis: 'x', facadeSign: 1, secondarySign: 1, style: 'ward', roof: 'flat', seed: 0.83, growth: true, spires: 2 },
  { name: 'new-inf-court-2', x: 84, z: 140, width: 38, depth: 44, height: 37, facadeAxis: 'x', facadeSign: -1, secondarySign: 1, style: 'hall', roof: 'hip', seed: 0.05, growth: true, spires: 2 },
];

export const createCity = (): THREE.Group => {
  const city = new THREE.Group();
  city.name = 'wahr-welt-city-rebuild';
  city.position.z = TOWER_Z;

  // Palette matched to the night overhead reference: deep indigo-navy walls,
  // pale violet tops that catch the steep moon key, near-black navy joints.
  const stoneMaterials = [
    createWahrWeltStoneMaterial({ base: 0x585179, top: 0xa79cd8, joint: 0x1b1834, seed: 0.11 }),
    createWahrWeltStoneMaterial({ base: 0x615a85, top: 0xb3a9e0, joint: 0x1e1a38, seed: 0.47 }),
    createWahrWeltStoneMaterial({ base: 0x4f4872, top: 0x998ecb, joint: 0x171430, seed: 0.83 }),
  ];
  const roofMaterial = createWahrWeltStoneMaterial({
    base: 0x65608d,
    top: 0xb5aae4,
    joint: 0x201c3c,
    courseWidth: 18,
    courseHeight: 6.5,
    seed: 0.64,
  });
  const deckMaterial = createWahrWeltFloorMaterial({
    base: 0x2e2b4e,
    joint: 0x121026,
    slabWidth: 28,
    slabDepth: 28,
    seed: 0.31,
  });
  const roadMaterial = createWahrWeltFloorMaterial({
    base: 0x403b66,
    joint: 0x181530,
    slabWidth: 15,
    slabDepth: 21,
    seed: 0.67,
  });
  const sidewalkMaterial = createWahrWeltFloorMaterial({
    base: 0x4a4470,
    joint: 0x1e1a3a,
    slabWidth: 7,
    slabDepth: 12,
    seed: 0.49,
  });
  const curbMaterial = createWahrWeltFlatMaterial(0x4e4879);
  const recessMaterial = new THREE.MeshBasicMaterial({ color: 0x080711 });
  const growthMaterial = createWahrWeltGrowthMaterial();

  // One central island: the deck is centred on the citadel (local origin), so
  // the castle stands in the middle of the city rather than at its edge.
  const deck = new THREE.Mesh(
    new THREE.CylinderGeometry(CITY_RADIUS + 48, CITY_RADIUS + 30, 16, 48, 1),
    deckMaterial,
  );
  deck.name = 'wahr-welt-new-city-deck';
  deck.position.set(0, CITY_DECK_Y - 8, 0);
  city.add(deck);

  addProcessionalRoad(city, roadMaterial, sidewalkMaterial, curbMaterial);

  const growthRidges: GrowthRidge[] = [];
  for (const spec of [...BACKGROUND_BLOCKS, ...HERO_BLOCKS, ...INFILL_BLOCKS, ...SOUTH_BLOCKS]) {
    addBlock(city, spec, stoneMaterials, roofMaterial, recessMaterial, growthRidges);
  }
  addGrowth(city, growthRidges, growthMaterial);

  return city;
};
