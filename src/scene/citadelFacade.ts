import * as THREE from 'three/webgpu';
import { polygonArea, prismContains, prismPlanes, subtractPrism } from './citadelPrisms';
import type { CitadelPrism, PrismFace } from './citadelPrisms';

// The reference reads as enormous, mostly blank rectangular wall masses.
// Small individual openings leave most of each face blank. Long comb-like
// slit galleries exaggerated both the window scale and the repeated stripes.
// Edge 4 faces the street, 0 the rear, 2 east and 6 west.
interface GalleryConfig {
  owner: string;
  edges: readonly number[];
  count: number;
  spacing: number;
  width: number;
  depth: number;
  /** Row centre below the structural roof, and its opening height. */
  rows: readonly (readonly [number, number])[];
}
const GALLERIES: readonly GalleryConfig[] = [
  { owner: 'middle-upper-court', edges: [0, 2, 4, 6], count: 2, spacing: 30, width: .85, depth: 1.1, rows: [[10, 1.7]] },
  { owner: 'high-inner-keep', edges: [0, 2, 4, 6], count: 1, spacing: 6, width: .85, depth: 1.1, rows: [[9, 1.6]] },
  { owner: 'crown-keep', edges: [0, 2, 4, 6], count: 1, spacing: 5, width: .9, depth: 1.1, rows: [[6, 1.5]] },
  { owner: 'upper-keep', edges: [0, 2, 4, 6], count: 2, spacing: 26, width: .85, depth: 1.1, rows: [[10, 1.7]] },
  { owner: 'upper-west-slab', edges: [4, 6], count: 1, spacing: 6, width: .8, depth: 1.0, rows: [[10, 1.5]] },
  { owner: 'upper-east-slab', edges: [0, 2], count: 1, spacing: 6, width: .8, depth: 1.0, rows: [[9, 1.5]] },
  { owner: 'middle-keep', edges: [0, 2, 4, 6], count: 2, spacing: 32, width: .9, depth: 1.1, rows: [[12, 1.8]] },
  { owner: 'west-keep', edges: [4, 6], count: 2, spacing: 16, width: .85, depth: 1.1, rows: [[10, 1.7]] },
  { owner: 'east-keep', edges: [2, 4], count: 2, spacing: 15, width: .85, depth: 1.1, rows: [[11, 1.7]] },
  { owner: 'rear-keep', edges: [0], count: 2, spacing: 19, width: .85, depth: 1.0, rows: [[10, 1.6]] },
  { owner: 'lower-keep', edges: [0, 4], count: 2, spacing: 30, width: .9, depth: 1.1, rows: [[12, 1.8]] },
  { owner: 'gate-block', edges: [4], count: 1, spacing: 6, width: .8, depth: 1.0, rows: [[9, 1.5]] },
  { owner: 'front-west-hall', edges: [4, 6], count: 2, spacing: 22, width: .9, depth: 1.1, rows: [[11, 1.8]] },
  { owner: 'front-east-hall', edges: [2, 4], count: 2, spacing: 23, width: .9, depth: 1.1, rows: [[12, 1.8]] },
  { owner: 'rear-west-hall', edges: [0, 6], count: 2, spacing: 20, width: .85, depth: 1.0, rows: [[10, 1.6]] },
  { owner: 'rear-east-hall', edges: [0, 2], count: 2, spacing: 19, width: .85, depth: 1.0, rows: [[11, 1.6]] },
  { owner: 'west-buttress-hall', edges: [4, 6], count: 1, spacing: 6, width: .8, depth: 1.0, rows: [[9, 1.5]] },
  { owner: 'rear-west-tower', edges: [0, 6], count: 1, spacing: 6, width: .8, depth: 1.0, rows: [[10, 1.5]] },
  { owner: 'rear-east-annex', edges: [0, 2], count: 1, spacing: 6, width: .8, depth: 1.0, rows: [[8, 1.5]] },
  { owner: 'front-inner-keep', edges: [4], count: 1, spacing: 6, width: .85, depth: 1.1, rows: [[10, 1.7]] },
  { owner: 'front-west-step', edges: [4], count: 1, spacing: 6, width: .8, depth: 1.0, rows: [[9, 1.5]] },
  { owner: 'upper-west-buttress', edges: [4, 6], count: 1, spacing: 6, width: .8, depth: 1.0, rows: [[8, 1.5]] },
  { owner: 'east-inner-pylon', edges: [4], count: 1, spacing: 6, width: .8, depth: 1.0, rows: [[9, 1.5]] },
  { owner: 'east-outer-pylon', edges: [2], count: 1, spacing: 6, width: .8, depth: 1.0, rows: [[10, 1.5]] },
];

// A subordinate entrance at street level; it no longer occupies nearly a
// quarter of the whole castle height. The deep passage and approach remain.
export const PORTAL = { owner: 'gate-block', edge: 4, width: 16, height: 32, depth: 14, sill: 5 } as const;

export interface CitadelAperture {
  owner: string;
  kind: 'window' | 'portal';
  center: THREE.Vector3;
  normal: THREE.Vector3;
  tangent: THREE.Vector3;
  width: number;
  height: number;
  depth: number;
  front: THREE.Vector3[];
  void: CitadelPrism;
}

// Outward half-space planes through the edges of one convex wall fragment;
// used to subtract the fragment from a test rectangle lying in the same plane.
const fragmentPlanes = (face: PrismFace): THREE.Plane[] => {
  const winding = new THREE.Vector3();
  face.vertices.forEach((a, i) => winding.add(a.clone().cross(face.vertices[(i + 1) % face.vertices.length]!)));
  const sign = winding.dot(face.normal) >= 0 ? 1 : -1;
  return face.vertices.map((a, i) => {
    const b = face.vertices[(i + 1) % face.vertices.length]!;
    const n = b.clone().sub(a).cross(face.normal).multiplyScalar(sign).normalize();
    return new THREE.Plane(n, -n.dot(a));
  });
};

// An opening may straddle the seams between coplanar fragments of one wall
// (the exposed-face union splits walls wherever a neighbour ends), so the
// margin rectangle is tested against the union of fragments, not each alone.
const WALL_MARGIN = 1.5;
const insideWall = (faces: readonly PrismFace[], center: THREE.Vector3, tangent: THREE.Vector3, width: number, height: number) => {
  let remaining = [[[-1, -1], [-1, 1], [1, 1], [1, -1]].map(([x, y]) =>
    center.clone().addScaledVector(tangent, x! * (width * 0.5 + WALL_MARGIN)).add(new THREE.Vector3(0, y! * (height * 0.5 + WALL_MARGIN), 0)))];
  for (const face of faces) {
    remaining = remaining.flatMap(part => subtractPrism(part, fragmentPlanes(face)));
    if (!remaining.length) return true;
  }
  return remaining.every(part => polygonArea(part) < 0.05);
};

export const createCitadelFacade = (
  source: readonly PrismFace[], prisms: readonly CitadelPrism[],
  isBlocked: (front: THREE.Vector3[], center: THREE.Vector3) => boolean = () => false,
) => {
  const apertures: CitadelAperture[] = [];
  const edgeFrame = (prism: CitadelPrism, edge: number) => {
    const a = prism.plan[edge]!, b = prism.plan[(edge + 1) % prism.plan.length]!;
    const tangent = new THREE.Vector3(b.x - a.x, 0, b.y - a.y).normalize();
    return { a, b, tangent, normal: new THREE.Vector3(tangent.z, 0, -tangent.x) };
  };
  const tryOpening = (
    prism: CitadelPrism, edge: number, kind: CitadelAperture['kind'], center: THREE.Vector3,
    width: number, height: number, depth: number, name: string,
  ): CitadelAperture | null => {
    const { tangent, normal } = edgeFrame(prism, edge);
    const faces = source.filter(f => f.owner === prism.name && f.normal.dot(normal) > 0.99999);
    const front = [[-1, -1], [-1, 1], [1, 1], [1, -1]].map(([x, y]) =>
      center.clone().addScaledVector(tangent, x! * width * 0.5).add(new THREE.Vector3(0, y! * height * 0.5, 0)));
    if (!faces.length || !insideWall(faces, center, tangent, width, height)) return null;
    if (!front.every(p => prismContains(prism, p.clone().addScaledVector(normal, -depth), -0.01))) return null;
    // No openings into a slot: a wall facing another mass within a few units
    // is never read, and frost on the opposite wall would fill the recess.
    if ([2, 6, 10].some(k => prisms.some(other => other !== prism
      && prismContains(other, center.clone().addScaledVector(normal, k), -0.01)))) return null;
    if (isBlocked(front, center)) return null;
    const plan = [[-1, -depth], [1, -depth], [1, 2], [-1, 2]].map(([u, n]) => {
      const p = center.clone().addScaledVector(tangent, u! * width * 0.5).addScaledVector(normal, n!);
      return new THREE.Vector2(p.x, p.z);
    });
    // The footprint is CCW, matching the masonry subtraction convention.
    if (plan.reduce((s, p, j) => s + p.x * plan[(j + 1) % 4]!.y - p.y * plan[(j + 1) % 4]!.x, 0) < 0) plan.reverse();
    return { owner: prism.name, kind, center, normal, tangent, width, height, depth, front,
      void: { name, plan, bottom: center.y - height * 0.5, top: center.y + height * 0.5 } };
  };

  for (const group of GALLERIES) {
    const prism = prisms.find(p => p.name === group.owner);
    if (!prism) continue;
    for (const edge of group.edges) {
      const { a, b, tangent } = edgeFrame(prism, edge);
      {
        const span = a.distanceTo(b);
        const clear = span - 8;
        let count = group.count;
        while (count > 1 && (count - 1) * group.spacing + group.width > clear) count--;
        if (group.width > clear) continue;
        const middle = span * 0.5;
        for (const [fromTop, height] of group.rows) {
          const row: CitadelAperture[] = [];
          for (let i = 0; i < count; i++) {
            const along = middle + (i - (count - 1) * 0.5) * group.spacing;
            const center = new THREE.Vector3(a.x, prism.top - fromTop, a.y).addScaledVector(tangent, along);
            const opening = tryOpening(prism, edge, 'window', center, group.width, height, group.depth,
              `gallery-${group.owner}-${edge}-${Math.round(along)}-${Math.round(center.y)}`);
            if (opening) row.push(opening);
          }
          // An attached structure may hide one of these isolated openings.
          apertures.push(...row);
        }
      }
    }
  }
  const gate = prisms.find(p => p.name === PORTAL.owner);
  if (gate) {
    const { a, b } = edgeFrame(gate, PORTAL.edge);
    const middle = a.clone().lerp(b, 0.5);
    // A low threshold step keeps the void inside the exposed wall polygon.
    const center = new THREE.Vector3(middle.x, gate.bottom + PORTAL.sill + PORTAL.height * 0.5, middle.y);
    const portal = tryOpening(gate, PORTAL.edge, 'portal', center, PORTAL.width, PORTAL.height, PORTAL.depth, 'portal');
    if (portal) apertures.push(portal);
  }

  const facade: PrismFace[] = source.flatMap(face => {
    let fragments = [face.vertices];
    for (const aperture of apertures) {
      if (face.owner !== aperture.owner || face.normal.dot(aperture.normal) < 0.99999) continue;
      fragments = fragments.flatMap(fragment => subtractPrism(fragment, prismPlanes(aperture.void)));
    }
    return fragments.filter(vertices => polygonArea(vertices) > 0.001).map(vertices => ({ ...face, vertices }));
  });
  for (const aperture of apertures) {
    const back = aperture.front.map(p => p.clone().addScaledVector(aperture.normal, -aperture.depth));
    facade.push({ owner: aperture.owner, normal: aperture.normal, vertices: back });
    for (let i = 0; i < 4; i++) {
      const next = (i + 1) % 4;
      const vertices = [aperture.front[i]!, aperture.front[next]!, back[next]!, back[i]!];
      const normal = vertices[1]!.clone().sub(vertices[0]!).cross(vertices[2]!.clone().sub(vertices[0]!)).normalize();
      const inward = aperture.center.clone().addScaledVector(aperture.normal, -aperture.depth * .5).sub(vertices[0]!);
      if (normal.dot(inward) < 0) { vertices.reverse(); normal.negate(); }
      facade.push({ owner: aperture.owner, normal, vertices });
    }
  }
  // Small slits must remain visible obliquely through the raised mineral
  // skin. Keep the actual masonry void exact, but widen the crystal clearance
  // toward the viewer. This catches overhangs just outside a narrow jamb.
  const clearances: CitadelPrism[] = apertures.map(aperture => {
    const plan = [[-1, -aperture.depth], [1, -aperture.depth], [1, 8], [-1, 8]].map(([side, distance]) => {
      const halfWidth = aperture.width * .5 + (distance! > 0 ? 2.2 : 0);
      const p = aperture.center.clone().addScaledVector(aperture.tangent, side! * halfWidth)
        .addScaledVector(aperture.normal, distance!);
      return new THREE.Vector2(p.x, p.z);
    });
    if (plan.reduce((sum, p, i) => sum + p.x * plan[(i + 1) % 4]!.y - p.y * plan[(i + 1) % 4]!.x, 0) < 0) plan.reverse();
    return { name: `${aperture.void.name}-crystal-clearance`, plan,
      bottom: aperture.void.bottom - .5, top: aperture.void.top + .5 };
  });
  return { faces: facade, apertures, voids: apertures.map(a => a.void), clearances };
};
