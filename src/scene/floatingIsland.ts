import * as THREE from 'three/webgpu';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { createBedrockMaterial } from '../materials/bedrockMaterial';
import { CITY_DECK_Y } from './constants';
import { ISLAND_RADIUS_X, ISLAND_RADIUS_Z, ISLAND_BOTTOM_Y, islandCoastRadius } from './islandLayout';

type Point = { u: number; v: number };
type Site = Point & { seed: number };
const COLUMNS = 41, ROWS = 4.6, V_SCALE = .82;
const hash = (x: number, y: number, seed: number): number => {
  const n = Math.sin(x * 127.1 + y * 311.7 + seed * 91.3) * 43758.5453;
  return n - Math.floor(n);
};

/** Clip in the surface's unwrapped coordinates. Shared edges become actual
 * mesh edges; rasterising a fracture onto a rectangular grid makes sawteeth. */
const clip = (polygon: Point[], a: number, b: number, c: number): Point[] => {
  const result: Point[] = [];
  for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i]!, q = polygon[(i + 1) % polygon.length]!;
    const dp = a * p.u + b * p.v - c, dq = a * q.u + b * q.v - c;
    if (dp <= 1e-10) result.push(p);
    if ((dp < 0 && dq > 0) || (dp > 0 && dq < 0)) {
      const t = dp / (dp - dq);
      result.push({ u: p.u + (q.u - p.u) * t, v: p.v + (q.v - p.v) * t });
    }
  }
  return result;
};

/** A closed land mass with unequal fracture plates. The cell boundary is a
 * recessed joint, its inset is the broken face; both share exact edge vertices.
 * Macro coast and roots retain the existing island composition. */
export const createFloatingIsland = (deckMaterial: THREE.Material): THREE.Group => {
  const group = new THREE.Group(); group.name = 'blockout-island';
  const sites: Site[] = [];
  for (let row = -2; row <= 8; row++) for (let column = -2; column <= COLUMNS + 1; column++) {
    const wrapped = (column % COLUMNS + COLUMNS) % COLUMNS;
    if (hash(wrapped, row, 7) < .24) continue;
    sites.push({ u: column - .07 + hash(wrapped, row, 1) * 1.14,
      v: row - .07 + hash(wrapped, row, 2) * 1.14,
      seed: hash(wrapped, row, 3) });
  }
  const positions: number[] = [], colors: number[] = [], topEdge = new Map<number, Point>();
  const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3();
  const edge1 = new THREE.Vector3(), edge2 = new THREE.Vector3();
  const world = (p: Point, relief: number, target: THREE.Vector3): THREE.Vector3 => {
    const angle = (Math.abs(p.u - COLUMNS) < 1e-9 ? 0 : p.u) / COLUMNS * Math.PI * 2, depth = THREE.MathUtils.clamp(p.v / ROWS, 0, 1);
    if (depth > 1 - 1e-10) return target.set(-94, ISLAND_BOTTOM_Y, 61);
    const radius = Math.pow(1 - Math.pow(depth, 1.65), .69);
    const fault = Math.sin(angle * 11 + .45 * depth) * .036
      + Math.sin(angle * 5 + depth * 1.7) * .08;
    const r = radius * (islandCoastRadius(angle) + fault * Math.min(1, depth * 7));
    const fade = THREE.MathUtils.smoothstep(depth, 0, .11)
      * (1 - THREE.MathUtils.smoothstep(depth, .88, 1));
    const displacement = relief * fade * Math.pow(radius, .6);
    const y = CITY_DECK_Y + (ISLAND_BOTTOM_Y - CITY_DECK_Y) * depth
      + (Math.sin(angle * 5 + .4) * 32 + Math.cos(angle * 13 + depth * 4) * 12) * Math.sin(Math.PI * depth);
    return target.set(Math.cos(angle) * (ISLAND_RADIUS_X * r + displacement) - depth * 94,
      y, Math.sin(angle) * (ISLAND_RADIUS_Z * r + displacement) + depth * 61);
  };
  const emit = (a: Point, b: Point, c: Point, relief: readonly number[], tone: readonly number[]) => {
    world(a, relief[0]!, va); world(b, relief[1]!, vb); world(c, relief[2]!, vc);
    if (edge1.subVectors(vb, va).cross(edge2.subVectors(vc, va)).lengthSq() < 1e-10) return;
    positions.push(...va.toArray(), ...vb.toArray(), ...vc.toArray());
    for (const value of tone) colors.push(value, value, value);
  };
  let plateCount = 0;
  for (const site of sites) {
    if (site.u < -1.5 || site.u > COLUMNS + 1.5 || site.v < -1.5 || site.v > ROWS + 1.5) continue;
    let polygon: Point[] = [{ u: 0, v: 0 }, { u: COLUMNS, v: 0 },
      { u: COLUMNS, v: ROWS }, { u: 0, v: ROWS }];
    for (const other of sites) {
      if (other === site) continue;
      const a = other.u - site.u, b = (other.v - site.v) * V_SCALE * V_SCALE;
      const c = (other.u * other.u - site.u * site.u
        + (other.v * other.v - site.v * site.v) * V_SCALE * V_SCALE) * .5;
      polygon = clip(polygon, a, b, c);
      if (polygon.length < 3) break;
    }
    polygon = polygon.filter((p, i) => {
      const previous = polygon[(i + polygon.length - 1) % polygon.length]!;
      return Math.hypot(p.u - previous.u, p.v - previous.v) > 1e-8;
    });
    if (polygon.length < 3) continue;
    // Centroid stays inside cells clipped at coast/root and at the periodic seam.
    const centre = polygon.reduce((p, q) => ({ u: p.u + q.u / polygon.length, v: p.v + q.v / polygon.length }), { u: 0, v: 0 });
    const boundary: Point[] = [];
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i]!, b = polygon[(i + 1) % polygon.length]!;
      const length = Math.hypot((b.u - a.u) * 165, (b.v - a.v) * 88);
      // Split root-bound edges: distinct curved paths must not collapse into
      // the same straight chord when the bottom rim converges to one point.
      const steps = Math.max(2, Math.ceil(Math.round(length * 1e6) / 1e6 / 22));
      for (let j = 0; j < steps; j++) {
        const t = j / steps, p = { u: a.u + (b.u - a.u) * t, v: a.v + (b.v - a.v) * t };
        boundary.push(p);
        if (Math.abs(p.v) < 1e-7) topEdge.set(Math.round(p.u * 1e7), { u: p.u, v: 0 });
      }
    }
    const inset = .055 + site.seed * .065;
    const inner = boundary.map(p => ({ u: p.u + (centre.u - p.u) * inset,
      v: p.v + (centre.v - p.v) * inset }));
    const faceRelief = (p: Point) => 6 + site.seed * 17
      + (p.u - centre.u) * (site.seed - .35) * 21
      + (p.v - centre.v) * (site.seed - .65) * 12
      + Math.sin(p.u * 13 + p.v * 5 + site.seed * 9) * 1.8
      + Math.sin(p.u * 6 - p.v * 8 + site.seed * 13) * 2.8;
    const faceTone = .88 + site.seed * .10;
    for (let i = 0; i < boundary.length; i++) {
      const j = (i + 1) % boundary.length;
      const a = boundary[i]!, b = boundary[j]!, ia = inner[i]!, ib = inner[j]!;
      emit(a, b, ib, [-5, -5, faceRelief(ib)], [.87, .87, faceTone]);
      emit(a, ib, ia, [-5, faceRelief(ib), faceRelief(ia)], [.87, faceTone, faceTone]);
      // Nested rings sample the curved rock under each face, avoiding a giant
      // triangle fan whose diagonals would show through the surface shading.
      const along = (p: Point, t: number): Point => ({
        u: p.u + (centre.u - p.u) * t, v: p.v + (centre.v - p.v) * t,
      });
      const face = (a: Point, b: Point, c: Point) => emit(a, b, c,
        [faceRelief(a), faceRelief(b), faceRelief(c)], [faceTone, faceTone, faceTone]);
      for (let ring = 0; ring < 4; ring++) {
        const a = along(ia, ring / 4), b = along(ib, ring / 4);
        const c = along(ib, (ring + 1) / 4), d = along(ia, (ring + 1) / 4);
        face(a, b, c); if (ring < 3) face(a, c, d);
      }
    }
    plateCount++;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const facets = toCreasedNormals(geometry, Math.PI * .25);
  const rock = new THREE.Mesh(facets, createBedrockMaterial());
  rock.name = 'floating-island-connected-bedrock'; rock.userData.fracturePlates = plateCount;
  group.add(rock);

  const coast = [...topEdge.values()].sort((a, b) => a.u - b.u);
  // u=0 and u=COLUMNS are one closed seam; retain just one endpoint.
  const uniqueCoast = coast.filter(p => p.u < COLUMNS - 1e-7);
  const topPositions: number[] = [], topIndices: number[] = [];
  for (const p of uniqueCoast) topPositions.push(...world(p, 0, va).toArray());
  const centreIndex = topPositions.length / 3;
  topPositions.push(0, CITY_DECK_Y, 0);
  for (let i = 0; i < centreIndex; i++) topIndices.push(centreIndex, (i + 1) % centreIndex, i);
  const topGeometry = new THREE.BufferGeometry();
  topGeometry.setAttribute('position', new THREE.Float32BufferAttribute(topPositions, 3));
  topGeometry.setIndex(topIndices); topGeometry.computeVertexNormals();
  const top = new THREE.Mesh(topGeometry, deckMaterial);
  top.name = 'floating-island-paved-crown'; group.add(top);
  return group;
};
