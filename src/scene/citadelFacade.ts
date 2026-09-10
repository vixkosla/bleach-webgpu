import * as THREE from 'three/webgpu';
import { polygonArea, prismContains, prismPlanes, subtractPrism } from './citadelPrisms';
import type { CitadelPrism, PrismFace } from './citadelPrisms';

// Openings are laid out per structural bay (the wall between two pilasters or
// corner piers), so window rows never collide with the vertical articulation.
// Edge 4 faces the street, 0 the rear, 2 east and 6 west; odd edges are the
// short diagonal walls, which stay blank.
interface GalleryConfig {
  owner: string;
  edges: readonly number[];
  perBay: number;
  spacing: number;
  width: number;
  depth: number;
  /**
   * Storey rows as [distance of the row centre below the tier top, height].
   * Rows are placed between the string courses of citadelGeometry (0.42 and
   * 0.72 of the tier height) and clear of the plinth band and the cornice, so
   * the stacked-storey read of the references never crosses a moulding.
   */
  rows: readonly (readonly [number, number])[];
  /** Keep a shortened row where spires or the arch feet block part of it. */
  partial?: boolean;
}
const GALLERIES: readonly GalleryConfig[] = [
  // Loggia around the crown keep, read in every final frame below the arch.
  { owner: 'crown-keep', edges: [0, 2, 4, 6], perBay: 5, spacing: 5.0, width: 3.0, depth: 3.4, rows: [[8, 10]], partial: true },
  { owner: 'upper-keep', edges: [0, 2, 4, 6], perBay: 2, spacing: 5.0, width: 2.8, depth: 3, rows: [[9.5, 9], [21.5, 8]] },
  { owner: 'upper-west-slab', edges: [4, 6], perBay: 2, spacing: 5.0, width: 2.8, depth: 3, rows: [[9, 8], [21, 8], [33, 8]] },
  { owner: 'upper-east-slab', edges: [2], perBay: 3, spacing: 5.0, width: 2.8, depth: 3, rows: [[9, 8], [20, 7]] },
  { owner: 'upper-front-step', edges: [2, 4], perBay: 3, spacing: 5.0, width: 2.6, depth: 3, rows: [[8, 7]] },
  { owner: 'upper-rear-step', edges: [0, 2, 6], perBay: 3, spacing: 5.0, width: 2.6, depth: 3, rows: [[8.5, 7]] },
  { owner: 'middle-keep', edges: [2, 4, 6], perBay: 3, spacing: 5.0, width: 2.8, depth: 3, rows: [[10, 7.5], [22, 7.5], [44, 7.5]] },
  // The two shoulders are the tallest continuous walls in every frame: tall
  // paired lancets under the cornice, then a storey row between each course.
  { owner: 'west-keep', edges: [4, 6], perBay: 2, spacing: 5.0, width: 2.8, depth: 3,
    rows: [[13, 12], [27, 8], [44, 8], [57, 8], [80, 8], [95, 8], [110, 8]] },
  { owner: 'east-keep', edges: [2, 4], perBay: 2, spacing: 5.0, width: 2.8, depth: 3,
    rows: [[13, 12], [27, 8], [46, 8], [60, 8], [72, 8], [92, 8], [106, 8], [120, 8]] },
  { owner: 'rear-keep', edges: [0], perBay: 2, spacing: 5.0, width: 2.8, depth: 3, rows: [[9, 8], [32, 8], [55, 8]] },
  { owner: 'lower-keep', edges: [0, 2, 4, 6], perBay: 3, spacing: 5.0, width: 2.8, depth: 3,
    rows: [[10.5, 8], [20.5, 7], [33, 8], [45, 8], [64, 8], [77, 8]] },
  // Gatehouse: one row above the portico crest, between its flanking buttresses,
  // and two storeys on the flanks above the low halls.
  { owner: 'gate-block', edges: [4], perBay: 5, spacing: 5.2, width: 2.6, depth: 3, rows: [[9, 7]] },
  { owner: 'gate-block', edges: [2, 6], perBay: 3, spacing: 5.2, width: 2.6, depth: 3, rows: [[9, 7], [18, 6]] },
  // Low halls: short gallery rows directly beneath their cornices, then the
  // storeys below down to the plinth band.
  { owner: 'front-west-hall', edges: [4, 6], perBay: 3, spacing: 5.0, width: 2.8, depth: 3, rows: [[8.5, 6.5], [19, 6.5], [30, 6.5]] },
  { owner: 'front-east-hall', edges: [2, 4], perBay: 3, spacing: 5.0, width: 2.8, depth: 3, rows: [[8.5, 6.5], [20, 6.5], [32, 6.5], [44, 6.5]] },
  { owner: 'rear-west-hall', edges: [0, 6], perBay: 3, spacing: 5.0, width: 2.8, depth: 3, rows: [[8.5, 6.5], [19, 6.5], [28, 6]] },
  { owner: 'rear-east-hall', edges: [0, 2], perBay: 3, spacing: 5.0, width: 2.8, depth: 3, rows: [[8.5, 6.5], [20, 6.5], [31.5, 6.5], [41, 6]] },
];

// The single deep portal of the gatehouse. Its arch and stepped reveal are
// built in front of this void by citadelGeometry.
export const PORTAL = { owner: 'gate-block', edge: 4, width: 24, height: 48, depth: 14, sill: 5 } as const;

export interface FacadeBay {
  owner: string;
  edge: number;
  /** Distances along the edge from its first vertex, in citadel units. */
  start: number;
  end: number;
}

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
  source: readonly PrismFace[], prisms: readonly CitadelPrism[], bays: readonly FacadeBay[],
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
      const { a, tangent } = edgeFrame(prism, edge);
      for (const bay of bays.filter(b => b.owner === group.owner && b.edge === edge)) {
        const clear = bay.end - bay.start - 3;
        let count = group.perBay;
        while (count > 1 && (count - 1) * group.spacing + group.width > clear) count--;
        if (group.width > clear) continue;
        const middle = (bay.start + bay.end) * 0.5;
        for (const [fromTop, height] of group.rows) {
          const row: CitadelAperture[] = [];
          for (let i = 0; i < count; i++) {
            const along = middle + (i - (count - 1) * 0.5) * group.spacing;
            const center = new THREE.Vector3(a.x, prism.top - fromTop, a.y).addScaledVector(tangent, along);
            const opening = tryOpening(prism, edge, 'window', center, group.width, height, group.depth,
              `gallery-${group.owner}-${edge}-${Math.round(along)}-${Math.round(center.y)}`);
            if (opening) row.push(opening);
          }
          // A bay either receives its whole rhythm or stays a clean wall panel.
          if (row.length === count || (group.partial && row.length >= 2)) apertures.push(...row);
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
  return { faces: facade, apertures, voids: apertures.map(a => a.void) };
};
