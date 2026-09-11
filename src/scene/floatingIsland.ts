import * as THREE from 'three/webgpu';
import { mix, mx_noise_float, positionWorld, vec3 } from 'three/tsl';
import { createWahrWeltFlatMaterial } from '../materials/wahrWeltCityMaterial';
import { CITY_DECK_Y } from './constants';
import { ISLAND_RADIUS_X, ISLAND_RADIUS_Z, ISLAND_BOTTOM_Y, islandCoastRadius } from './islandLayout';

/** A single torn land mass: cliffs, overhanging shelves and off-centre roots.
 * Adjacent strata share vertices. The paving closes the same coast exactly. */
export const createFloatingIsland = (deckMaterial: THREE.Material): THREE.Group => {
  const group = new THREE.Group();
  group.name = 'blockout-island';
  const segments = 192;
  const profile: number[][] = [];
  for (let j = 0; j < 29; j++) {
    const depth = j / 29;
    profile.push([CITY_DECK_Y + (ISLAND_BOTTOM_Y - CITY_DECK_Y) * depth,
      Math.pow(1 - Math.pow(depth, 1.65), .69)]);
  }
  const positions: number[] = [], indices: number[] = [];
  for (let j = 0; j < profile.length; j++) {
    const [height, radius] = profile[j]!;
    const depth = (CITY_DECK_Y - height!) / (CITY_DECK_Y - ISLAND_BOTTOM_Y);
    for (let i = 0; i < segments; i++) {
      const angle = i / segments * Math.PI * 2;
      // Faults continue down several strata; the shelves are not concentric
      // rings. A broad buttress and broken opposing face give unequal weight.
      const fault = Math.sin(angle * 11 + .45 * depth) * .053
        + Math.sin(angle * 23 - depth) * .029
        + Math.sin(angle * 5 + depth * 1.7) * .085
        + Math.sin(angle * 41 + depth * 4) * .013
        + Math.sin(angle * 17 - depth * 11) * .015;
      const r = radius! * (islandCoastRadius(angle) + fault * Math.min(1, depth * 7));
      const y = height! + (j === 0 ? 0 : Math.sin(angle * 5 + .4) * 38
        + Math.cos(angle * 13 + depth * 4) * 16) * Math.sin(Math.PI * depth);
      positions.push(Math.cos(angle) * ISLAND_RADIUS_X * r - depth * 94,
        y, Math.sin(angle) * ISLAND_RADIUS_Z * r + depth * 61);
      if (j > 0) {
        const a = (j - 1) * segments + i, b = (j - 1) * segments + (i + 1) % segments;
        const c = j * segments + i, d = j * segments + (i + 1) % segments;
        if ((i + j) % 2) indices.push(a, b, c, b, d, c);
        else indices.push(a, b, d, a, d, c);
      }
    }
  }
  const bottom = positions.length / 3;
  positions.push(-94, ISLAND_BOTTOM_Y, 61);
  for (let i = 0; i < segments; i++) {
    indices.push((profile.length - 1) * segments + i,
      (profile.length - 1) * segments + (i + 1) % segments, bottom);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  const facets = geometry.toNonIndexed();
  geometry.dispose();
  facets.computeVertexNormals();
  const material = createWahrWeltFlatMaterial(0xffffff);
  material.name = 'fractured-island-bedrock';
  // Geological seams have world scale, unlike the architectural masonry.
  // Wide planes carry the shape; small variation stays quiet in a wide shot.
  const p = positionWorld;
  const mineral = mx_noise_float(p.mul(vec3(.022, .015, .022))).mul(.14);
  const grain = mx_noise_float(p.mul(.15)).mul(.045);
  const fissure = mx_noise_float(p.mul(vec3(.05, .009, .05))).abs()
    .smoothstep(.025, .11);
  const depthTone = p.y.smoothstep(ISLAND_BOTTOM_Y, CITY_DECK_Y).mul(.23).add(.28);
  material.colorNode = mix(vec3(.17, .168, .18), vec3(.60, .575, .625),
    depthTone.add(mineral).add(grain)).mul(fissure.mul(.19).add(.81));
  const rock = new THREE.Mesh(facets, material);
  rock.name = 'floating-island-connected-bedrock';
  group.add(rock);

  const topPositions = positions.slice(0, segments * 3);
  topPositions.push(0, CITY_DECK_Y, 0);
  const topIndices: number[] = [];
  for (let i = 0; i < segments; i++) topIndices.push(segments, (i + 1) % segments, i);
  const topGeometry = new THREE.BufferGeometry();
  topGeometry.setAttribute('position', new THREE.Float32BufferAttribute(topPositions, 3));
  topGeometry.setIndex(topIndices);
  topGeometry.computeVertexNormals();
  const top = new THREE.Mesh(topGeometry, deckMaterial);
  top.name = 'floating-island-paved-crown';
  group.add(top);
  return group;
};
