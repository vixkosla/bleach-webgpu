import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { octagonalPlan, exposedPrismFaces, prismContains, prismPlanes, prismSurfaceGeometry } from './citadelPrisms';
import type { CitadelPrism } from './citadelPrisms';
import { createCitadelFacade, PORTAL } from './citadelFacade';
import type { FacadeBay } from './citadelFacade';

// A tall compound keep read from the user's references: a two-step podium, an
// unequal ring of low halls, a core with two attached shoulders of different
// height, then quickly narrowing upper slabs around the crown and its open
// arch. `crest` alternates crenellated parapets with plain coping over full
// modillion cornices, so successive setbacks do not repeat the same profile.
// `bays` enables pilasters; `buttress` steps them out at the base.
const TIER_MASSES = [
  { name: 'foundation', x: 0, z: -4, width: 292, depth: 196, bottom: 0, top: 5, cut: 0.22, crest: 'coping', bays: false, buttress: false, modillions: false },
  { name: 'plinth', x: 0, z: -4, width: 280, depth: 184, bottom: 4, top: 12, cut: 0.22, crest: 'coping', bays: false, buttress: false, modillions: false },
  { name: 'front-west-hall', x: -86, z: 46, width: 86, depth: 80, bottom: 8, top: 52, cut: 0.2, crest: 'merlons', bays: true, buttress: false, modillions: false },
  { name: 'front-east-hall', x: 86, z: 40, width: 84, depth: 92, bottom: 8, top: 62, cut: 0.2, crest: 'merlons', bays: true, buttress: false, modillions: false },
  { name: 'rear-west-hall', x: -74, z: -68, width: 104, depth: 52, bottom: 8, top: 46, cut: 0.18, crest: 'merlons', bays: true, buttress: false, modillions: false },
  { name: 'rear-east-hall', x: 64, z: -70, width: 100, depth: 48, bottom: 8, top: 58, cut: 0.18, crest: 'merlons', bays: true, buttress: false, modillions: false },
  { name: 'gate-block', x: 0, z: 76, width: 88, depth: 44, bottom: 0, top: 80, cut: 0.12, crest: 'merlons', bays: false, buttress: false, modillions: false },
  { name: 'lower-keep', x: -2, z: -8, width: 170, depth: 136, bottom: 8, top: 102, cut: 0.22, crest: 'coping', bays: true, buttress: true, modillions: true },
  { name: 'west-keep', x: -72, z: 0, width: 60, depth: 98, bottom: 8, top: 128, cut: 0.22, crest: 'merlons', bays: true, buttress: true, modillions: false },
  { name: 'east-keep', x: 72, z: -14, width: 56, depth: 90, bottom: 8, top: 142, cut: 0.22, crest: 'merlons', bays: true, buttress: true, modillions: false },
  { name: 'rear-keep', x: 8, z: -66, width: 80, depth: 50, bottom: 40, top: 120, cut: 0.25, crest: 'coping', bays: true, buttress: false, modillions: true },
  { name: 'middle-keep', x: -8, z: -18, width: 112, depth: 100, bottom: 94, top: 154, cut: 0.22, crest: 'coping', bays: true, buttress: false, modillions: true },
  { name: 'upper-west-slab', x: -48, z: -6, width: 52, depth: 64, bottom: 132, top: 178, cut: 0.22, crest: 'merlons', bays: true, buttress: false, modillions: false },
  { name: 'upper-east-slab', x: 38, z: -32, width: 44, depth: 54, bottom: 142, top: 172, cut: 0.24, crest: 'merlons', bays: false, buttress: false, modillions: false },
  { name: 'upper-front-step', x: -4, z: 16, width: 56, depth: 34, bottom: 148, top: 167, cut: 0.2, crest: 'merlons', bays: false, buttress: false, modillions: false },
  { name: 'upper-rear-step', x: -8, z: -58, width: 44, depth: 36, bottom: 148, top: 170, cut: 0.24, crest: 'merlons', bays: false, buttress: false, modillions: false },
  { name: 'upper-keep', x: -10, z: -20, width: 66, depth: 62, bottom: 150, top: 190, cut: 0.22, crest: 'coping', bays: true, buttress: false, modillions: true },
  { name: 'crown-keep', x: -12, z: -20, width: 36, depth: 36, bottom: 186, top: 207, cut: 0.12, crest: 'merlons', bays: false, buttress: false, modillions: false },
] as const;

// Eight sides remain an interpretation of the perspective references.
export const CITADEL_TIERS = TIER_MASSES;
export const createCitadelPrisms = (deckY: number): CitadelPrism[] =>
  CITADEL_TIERS.map(tier => ({ name: tier.name,
    plan: octagonalPlan(tier.x, tier.z, tier.width, tier.depth, tier.cut),
    bottom: deckY + tier.bottom, top: deckY + tier.top,
  }));

export type CitadelTier = typeof CITADEL_TIERS[number];

// Keep the existing sky composition independent of revisions to tower bounds.
export const CITADEL_UPPER_ANCHOR = [-8, 222, -10] as const;
export const CITADEL_WORLD_SCALE = [0.9, 1.62, 1.04] as const;

// Slender spires rise out of the masses below their terraces, never perched
// loose on a roof. The tallest pair frames the open crown arch; smaller ones
// mark the shoulders, the rear keep, the low halls and the portal.
const SPIRES = [
  { name: 'crown-west', x: -38, z: -2, bottom: 150, shoulder: 206, top: 223, radius: 3.4 },
  { name: 'crown-east', x: 16, z: -44, bottom: 150, shoulder: 197, top: 216, radius: 3.0 },
  { name: 'crown-rear-west', x: -66, z: -30, bottom: 132, shoulder: 187, top: 201, radius: 2.8 },
  { name: 'crown-front', x: -24, z: 26, bottom: 148, shoulder: 181, top: 195, radius: 2.6 },
  { name: 'upper-east-corner', x: 54, z: -52, bottom: 142, shoulder: 184, top: 198, radius: 2.4 },
  { name: 'upper-rear-corner', x: -24, z: -70, bottom: 148, shoulder: 182, top: 194, radius: 2.3 },
  { name: 'west-front', x: -93, z: 36, bottom: 60, shoulder: 140, top: 158, radius: 3.6 },
  { name: 'west-rear', x: -93, z: -38, bottom: 60, shoulder: 129, top: 143, radius: 2.8 },
  { name: 'east-front', x: 92, z: 22, bottom: 70, shoulder: 154, top: 174, radius: 3.4 },
  { name: 'east-rear', x: 92, z: -50, bottom: 70, shoulder: 141, top: 153, radius: 2.6 },
  { name: 'rear-keep', x: 38, z: -82, bottom: 90, shoulder: 131, top: 145, radius: 2.6 },
  { name: 'front-west-hall', x: -120, z: 78, bottom: 20, shoulder: 63, top: 75, radius: 2.4 },
  { name: 'front-east-hall', x: 119, z: 74, bottom: 20, shoulder: 73, top: 87, radius: 2.4 },
  { name: 'portal-west', x: -15, z: 106, bottom: 40, shoulder: 74, top: 86, radius: 1.9 },
  { name: 'portal-east', x: 15, z: 106, bottom: 40, shoulder: 74, top: 86, radius: 1.9 },
] as const;
// The right crown accent is a slim crenellated shaft in the clean street source.
const CROWN_SHAFT = { x: 14, z: 2, bottom: 150, top: 214, radius: 3.2 } as const;
// Open crown arch; its ends sit at -45 degrees and embed in the crown keep.
const SKY_ARCH = { x: -12, y: 208, z: -14, outer: 23, inner: 21.1, depth: 2.8, start: -Math.PI / 4 } as const;
const SKY_ARCH_FEET = [-1, 1].map(side => SKY_ARCH.x + side * SKY_ARCH.outer * Math.cos(SKY_ARCH.start));

const footprints = createCitadelPrisms(0).map(prism => prism.plan.map(p =>
  new THREE.Vector2(p.x * CITADEL_WORLD_SCALE[0], p.y * CITADEL_WORLD_SCALE[2])));

// City and citadel share their X/Z origin. Test rotated neighbouring lots
// against the real compound plan, preserving the empty diagonal corners.
export const intersectsCitadelFootprint = (
  x: number, z: number, width: number, depth: number, rotation = 0, padding = 5,
): boolean => {
  const centre = new THREE.Vector2(x, z);
  const right = new THREE.Vector2(Math.cos(rotation), -Math.sin(rotation));
  const back = new THREE.Vector2(Math.sin(rotation), Math.cos(rotation));
  return footprints.some(plan => {
    const axes = [right, back, ...plan.map((a, i) => {
      const b = plan[(i + 1) % plan.length]!;
      return new THREE.Vector2(b.y - a.y, a.x - b.x).normalize();
    })];
    return axes.every(axis => {
      const values = plan.map(p => p.dot(axis));
      const mid = centre.dot(axis);
      const extent = Math.abs(axis.dot(right)) * width * 0.5
        + Math.abs(axis.dot(back)) * depth * 0.5 + padding;
      return mid + extent > Math.min(...values) && mid - extent < Math.max(...values);
    });
  });
};

export const createCitadelArchGeometry = (
  outerRadius: number, innerRadius: number, depth: number,
  startAngle = 0,
): THREE.ExtrudeGeometry => {
  const shape = new THREE.Shape();
  const endAngle = Math.PI - startAngle;
  shape.moveTo(outerRadius * Math.cos(startAngle), outerRadius * Math.sin(startAngle));
  shape.absarc(0, 0, outerRadius, startAngle, endAngle, false);
  shape.lineTo(innerRadius * Math.cos(endAngle), innerRadius * Math.sin(endAngle));
  shape.absarc(0, 0, innerRadius, endAngle, startAngle, true);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth, steps: 1, bevelEnabled: false, curveSegments: 24,
  });
  geometry.translate(0, 0, -depth * 0.5);
  return geometry;
};

const CORNER_PIER = 2.8;
const PILASTER = 2.4;
const BAY_TARGET = 19;

interface EdgeFrame {
  a: THREE.Vector2; span: number; tangent: THREE.Vector2; outward: THREE.Vector2; angle: number;
}
const edgeFrame = (plan: readonly THREE.Vector2[], edge: number): EdgeFrame => {
  const a = plan[edge]!, b = plan[(edge + 1) % plan.length]!;
  const span = a.distanceTo(b), tangent = b.clone().sub(a).normalize();
  return { a, span, tangent, outward: new THREE.Vector2(tangent.y, -tangent.x), angle: -Math.atan2(tangent.y, tangent.x) };
};

// Pilaster stations divide long walls into near-equal bays; short diagonal
// walls and the gatehouse stay whole.
const pilasterStations = (tier: CitadelTier, span: number): number[] => {
  if (!tier.bays || span < 30) return [];
  const clear = span - CORNER_PIER * 2;
  const count = Math.max(2, Math.round(clear / BAY_TARGET));
  return Array.from({ length: count - 1 }, (_, k) => CORNER_PIER + clear * (k + 1) / count);
};

export const addCitadelGeometry = (
  parent: THREE.Group,
  material: THREE.Material,
  outlineMaterial: THREE.LineBasicMaterial,
  deckY: number,
): void => {
  const details: { x: number; y: number; z: number; w: number; h: number; d: number; angle: number }[] = [];
  const detail = (x: number, y: number, z: number, w: number, h: number, d: number, angle = 0) => {
    details.push({ x, y, z, w, h, d, angle });
  };
  const solid = (
    name: string, geometry: THREE.BufferGeometry,
    x: number, y: number, z: number, coated = false,
    outlineSource = geometry,
  ) => {
    const group = new THREE.Group();
    group.name = `citadel-${name}`;
    group.position.set(x, deckY + y, z);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `${group.name}-fill`;
    mesh.userData.citadelCoatingSurface = coated;
    group.add(mesh);
    const lines = new THREE.LineSegments(new THREE.EdgesGeometry(outlineSource, 24), outlineMaterial);
    if (outlineSource !== geometry) outlineSource.dispose();
    lines.name = `${group.name}-outline`;
    lines.renderOrder = 5;
    group.add(lines);
    parent.add(group);
    return mesh;
  };
  const spireParts: THREE.BufferGeometry[] = [];
  const octagonal = (geometry: THREE.BufferGeometry, x: number, y: number, z: number) => {
    geometry.rotateY(Math.PI / 8);
    geometry.translate(x, y, z);
    spireParts.push(geometry);
  };

  // Rails and merlons wrap a rectangular footprint (portico, shaft turret).
  const parapet = (x: number, z: number, w: number, d: number, y: number, small = false) => {
    const wall = small ? 1.1 : 1.7;
    const rail = small ? 1.3 : 2;
    const merlon = small ? 2.4 : 3.4;
    for (const side of [-1, 1]) {
      detail(x, y + rail * 0.5, z + side * (d - wall) * 0.5, w, rail, wall);
      detail(x + side * (w - wall) * 0.5, y + rail * 0.5, z, wall, rail, d);
      const countX = Math.max(3, Math.round(w / (small ? 6.5 : 10)));
      const countZ = Math.max(3, Math.round(d / (small ? 6.5 : 10)));
      for (let i = 0; i < countX; i++) {
        detail(x - w * 0.5 + wall + (w - wall * 2) * i / (countX - 1),
          y + rail + merlon * 0.5, z + side * (d - wall) * 0.5,
          small ? 2.3 : 4.1, merlon, wall);
      }
      for (let i = 1; i < countZ - 1; i++) {
        detail(x + side * (w - wall) * 0.5, y + rail + merlon * 0.5,
          z - d * 0.5 + wall + (d - wall * 2) * i / (countZ - 1),
          wall, merlon, small ? 2.3 : 4.1);
      }
    }
  };

  const prisms = createCitadelPrisms(deckY);
  const faces = exposedPrismFaces(prisms);
  const probe = new THREE.Vector3();
  // Trim is suppressed where a wall is buried in a neighbour and where an
  // opening has been cut, so bands and pilasters stop at every reveal. The
  // hundreds of small voids are tested through cached planes and boxes.
  const openings: { planes: THREE.Plane[]; bounds: THREE.Box3 }[] = [];
  const insideOpening = (o: typeof openings[number]) =>
    o.bounds.containsPoint(probe) && o.planes.every(plane => plane.distanceToPoint(probe) <= -0.06);
  const covered = (x: number, y: number, z: number) =>
    prisms.some(p => prismContains(p, probe.set(x, deckY + y, z), -0.06)) || openings.some(insideOpening);

  // Contiguous exposed intervals along an edge at one height, so a cornice or
  // course becomes one long box per visible stretch rather than many segments.
  const exposedRuns = (frame: EdgeFrame, y: number, from = 0, to = frame.span, step = 1.5): [number, number][] => {
    const runs: [number, number][] = [];
    let start: number | null = null;
    for (let t0 = from; t0 < to - 1e-6; t0 += step) {
      const t1 = Math.min(to, t0 + step);
      const p = frame.a.clone().addScaledVector(frame.tangent, (t0 + t1) * 0.5).addScaledVector(frame.outward, 0.35);
      const exposed = !covered(p.x, y, p.y);
      if (exposed && start === null) start = t0;
      if (!exposed && start !== null) { runs.push([start, t0]); start = null; }
    }
    if (start !== null) runs.push([start, to]);
    return runs.filter(([s, e]) => e - s > 1.2);
  };
  const exposedSpans = (x: number, z: number, y0: number, y1: number, step = 2): [number, number][] => {
    const spans: [number, number][] = [];
    let start: number | null = null;
    for (let y = y0; y < y1 - 1e-6; y += step) {
      const exposed = !covered(x, Math.min(y1, y + step * 0.5), z);
      if (exposed && start === null) start = y;
      if (!exposed && start !== null) { spans.push([start, y]); start = null; }
    }
    if (start !== null) spans.push([start, y1]);
    return spans.filter(([s, e]) => e - s > 1.5);
  };
  // A horizontal band along [s, e] of the edge: thickness d, projecting p.
  const band = (frame: EdgeFrame, s: number, e: number, y: number, h: number, d: number, p: number) => {
    const pos = frame.a.clone().addScaledVector(frame.tangent, (s + e) * 0.5).addScaledVector(frame.outward, p - d * 0.5);
    detail(pos.x, y, pos.y, e - s, h, d, frame.angle);
  };
  // Small blocks repeated along [s, e] at a fixed rhythm.
  const blocks = (frame: EdgeFrame, s: number, e: number, y: number, w: number, h: number, d: number, p: number, pitch: number) => {
    const count = Math.max(1, Math.round((e - s) / pitch));
    for (let i = 0; i < count; i++) {
      const pos = frame.a.clone().addScaledVector(frame.tangent, s + (e - s) * (i + 0.5) / count).addScaledVector(frame.outward, p - d * 0.5);
      detail(pos.x, y, pos.y, w, h, d, frame.angle);
    }
  };
  // A vertical strip at station t of the edge, split where neighbours cover it.
  const pier = (frame: EdgeFrame, t: number, y0: number, y1: number, w: number, d: number, p: number) => {
    const at = frame.a.clone().addScaledVector(frame.tangent, t);
    const test = at.clone().addScaledVector(frame.outward, 0.35);
    const pos = at.addScaledVector(frame.outward, p - d * 0.5);
    for (const [ya, yb] of exposedSpans(test.x, test.y, y0, y1)) detail(pos.x, (ya + yb) * 0.5, pos.y, w, yb - ya, d, frame.angle);
  };

  // Structural bays per wall drive both the pilasters and the window rhythm.
  const bays: FacadeBay[] = [];
  const stations = new Map<string, number[]>();
  for (const tier of CITADEL_TIERS) {
    const prism = prisms.find(p => p.name === tier.name)!;
    for (let edge = 0; edge < prism.plan.length; edge++) {
      const frame = edgeFrame(prism.plan, edge);
      const at = pilasterStations(tier, frame.span);
      stations.set(`${tier.name}/${edge}`, at);
      const limits = [CORNER_PIER, ...at.flatMap(t => [t - PILASTER * 0.5, t + PILASTER * 0.5]), frame.span - CORNER_PIER];
      for (let i = 0; i + 1 < limits.length; i += 2) bays.push({ owner: tier.name, edge, start: limits[i]!, end: limits[i + 1]! });
    }
  }
  // Spires, the crown shaft and the two embedded feet of the sky arch keep
  // openings away from where they enter the masonry. worldBlockout also lays
  // one translucent crack decal (8 x 18, tilted) on the street face of every
  // tier taller than 30, at x + 0.17 width and 14 below the top; mirror those
  // spots here so a decal never floats across a recess.
  const blockers = [...SPIRES, { ...CROWN_SHAFT, shoulder: CROWN_SHAFT.top },
    ...SKY_ARCH_FEET.map(x => ({ x, z: SKY_ARCH.z, bottom: SKY_ARCH.y - 12, top: SKY_ARCH.y + 2, radius: 2.4 })),
    ...CITADEL_TIERS.filter(t => t.top - t.bottom > 30).map(t => ({
      x: t.x + t.width * 0.17, z: t.z + t.depth * 0.5, bottom: t.top - 24, top: t.top - 4, radius: 4.4 }))];
  const facade = createCitadelFacade(faces, prisms, bays, (front, center) => blockers.some(t =>
    [...front, center].some(p => p.y > deckY + t.bottom && p.y < deckY + t.top + 1
      && Math.hypot(p.x - t.x, p.z - t.z) < t.radius * 1.2 + 0.6)));
  openings.push(...facade.voids.map(o => ({ planes: prismPlanes(o), bounds: new THREE.Box3(
    new THREE.Vector3(Math.min(...o.plan.map(v => v.x)) - 0.1, o.bottom - 0.1, Math.min(...o.plan.map(v => v.y)) - 0.1),
    new THREE.Vector3(Math.max(...o.plan.map(v => v.x)) + 0.1, o.top + 0.1, Math.max(...o.plan.map(v => v.y)) + 0.1),
  ) })));

  // Build only the union boundary; covered roofs and internal coplanar walls
  // cannot flicker or receive frost. Trim follows each of the eight edges.
  for (const tier of CITADEL_TIERS) {
    const prism = prisms.find(p => p.name === tier.name)!;
    const origin = new THREE.Vector3(tier.x, deckY + (tier.bottom + tier.top) * 0.5, tier.z);
    const ownedFaces = facade.faces.filter(f => f.owner === tier.name);
    // Aperture subtraction introduces coplanar T-junctions. Outline only the
    // original structural boundary so those cuts cannot stripe a whole wall.
    if (ownedFaces.length) solid(tier.name, prismSurfaceGeometry(ownedFaces, origin),
      tier.x, (tier.bottom + tier.top) * 0.5, tier.z, true,
      prismSurfaceGeometry(faces.filter(f => f.owner === tier.name), origin));
    if (tier.name === 'foundation' || tier.name === 'plinth') continue;
    const height = tier.top - tier.bottom;
    const merlons = tier.crest === 'merlons';
    const small = tier.name === 'crown-keep';
    // Cornice depth grows with a modillion course; pilasters stop beneath it.
    const corniceDepth = tier.modillions ? 4.4 : 2.1;
    const pierTop = tier.top - corniceDepth - 0.3;
    const pierBottom = tier.bottom + 5.6;
    const stepY = tier.buttress ? tier.bottom + Math.round(height * 0.42) : null;
    const pinnacles = merlons && tier.top >= 120;
    for (let edge = 0; edge < prism.plan.length; edge++) {
      const frame = edgeFrame(prism.plan, edge);
      // Cornice: corona over bed mould, with modillions and fascia on keeps.
      for (const [s, e] of exposedRuns(frame, tier.top - 1)) {
        // Keeps with a modillion course carry the deep ledges that read as
        // bright horizontal lines in the references; halls stay lighter.
        if (tier.modillions) band(frame, s, e, tier.top - 0.65, 1.3, 3.4, 2.5);
        else band(frame, s, e, tier.top - 0.55, 1.1, small ? 2.2 : 2.8, small ? 1.4 : 1.9);
        band(frame, s, e, tier.top - 1.6, 1.0, small ? 1.8 : 2.2, small ? 0.8 : 1.1);
        if (tier.modillions) {
          blocks(frame, s + 0.6, e - 0.6, tier.top - 2.9, 1.4, 1.6, 2.0, 1.3, 3.6);
          band(frame, s, e, tier.top - 4.05, 0.7, 1.6, 0.6);
        }
      }
      // Crest above the roof edge: crenellated parapet or low coping.
      for (const [s, e] of exposedRuns(frame, tier.top + 1)) {
        if (!merlons) { band(frame, s, e, tier.top + 0.65, 1.3, 1.6, 0.7); continue; }
        const rail = small ? 1.6 : 2.0, merlon = small ? 2.2 : 2.6;
        band(frame, s, e, tier.top + rail * 0.5, rail, 1.4, 0.5);
        const margin = pinnacles ? 2.4 : 0.4;
        const count = Math.max(1, Math.round((e - s - margin * 2) / (small ? 5.2 : 6.2)));
        for (let i = 0; i < count; i++) {
          const t = s + margin + (e - s - margin * 2) * (i + 0.5) / count;
          const pos = frame.a.clone().addScaledVector(frame.tangent, t).addScaledVector(frame.outward, 0.5 - 0.7);
          detail(pos.x, tier.top + rail + merlon * 0.5, pos.y, small ? 2.4 : 3.0, merlon, 1.4, frame.angle);
        }
      }
      // Plinth band where the tier meets the podium or a lower terrace.
      for (const [s, e] of exposedRuns(frame, tier.bottom + 1.6)) {
        band(frame, s, e, tier.bottom + 1.6, 3.2, 2.4, 1.4);
        band(frame, s, e, tier.bottom + 3.9, 1.4, 1.8, 0.7);
      }
      // String courses tie the buttress steps together and divide the tall
      // keeps into the stacked storeys read in the references.
      const courses = height >= 80 ? [0.42, 0.72] : height >= 56 ? [0.42] : [];
      for (const fraction of courses) {
        const y = fraction === 0.42 && stepY !== null ? stepY : tier.bottom + Math.round(height * fraction);
        for (const [s, e] of exposedRuns(frame, y)) band(frame, s, e, y, 1.0, 1.8, 0.8);
      }
      // Corner piers on both walls meeting at each vertex, then pilasters.
      const corner = (t: number) => {
        if (stepY !== null) {
          pier(frame, t, pierBottom, stepY - 0.5, CORNER_PIER + 0.8, 2.4, 2.2);
          pier(frame, t, stepY + 0.5, pierTop, CORNER_PIER, 1.8, 1.0);
        } else pier(frame, t, pierBottom, pierTop, CORNER_PIER, 1.6, 0.9);
      };
      corner(CORNER_PIER * 0.5);
      corner(frame.span - CORNER_PIER * 0.5);
      for (const t of stations.get(`${tier.name}/${edge}`)!) {
        if (stepY !== null) {
          pier(frame, t, pierBottom, stepY - 0.5, PILASTER + 1.2, 2.4, 2.2);
          pier(frame, t, stepY + 0.5, pierTop, PILASTER, 1.6, 1.0);
        } else pier(frame, t, pierBottom, pierTop, PILASTER, 1.5, 0.9);
      }
      // Pinnacles at the exposed corners of the upper parapets.
      if (pinnacles) {
        const next = edgeFrame(prism.plan, (edge + 1) % prism.plan.length);
        const v = next.a, bisector = frame.outward.clone().add(next.outward).normalize();
        const test = v.clone().addScaledVector(bisector, 0.5);
        if (!covered(test.x, tier.top + 1, test.y)) {
          detail(v.x, tier.top + 1.5, v.y, 2.0, 3.0, 2.0, frame.angle);
          octagonal(new THREE.ConeGeometry(1.15, 5.4, 8), v.x, tier.top + 3 + 2.7, v.y);
        }
      }
    }
  }
  parent.userData.citadelExposedFaces = faces;
  parent.userData.citadelApertures = facade.apertures;
  parent.userData.citadelApertureVoids = facade.voids;

  // Gatehouse portal: the facade void recedes 14 units behind the wall; a
  // projecting portico with two stepped arches, a lintel course and its own
  // crest stands in front, flanked by the two portal pinnacles below.
  const gate = CITADEL_TIERS.find(t => t.name === 'gate-block')!;
  const gateFront = gate.z + gate.depth * 0.5;
  const porticoDepth = 16, porticoZ = gateFront + porticoDepth * 0.5;
  const half = PORTAL.width * 0.5, pierW = 6, springing = gate.bottom + PORTAL.sill + PORTAL.height - half;
  for (const side of [-1, 1]) {
    solid(`gate-pier-${side}`, new THREE.BoxGeometry(pierW, springing, porticoDepth), side * (half + pierW * 0.5), springing * 0.5, porticoZ);
  }
  solid('gate-arch', createCitadelArchGeometry(half + pierW, half, porticoDepth), 0, springing, porticoZ);
  const sill = gate.bottom + PORTAL.sill;
  const revealOuter = half - 0.05, revealInner = half - 3, revealDepth = 4;
  solid('gate-reveal-arch', createCitadelArchGeometry(revealOuter, revealInner, revealDepth), 0, springing, gateFront - 4);
  // Continue the recessed archivolt down to the threshold. Its two ends
  // otherwise hang unsupported inside the taller outer portico.
  for (const side of [-1, 1]) {
    detail(side * (revealOuter + revealInner) * 0.5, (sill + springing) * 0.5, gateFront - 4,
      revealOuter - revealInner, springing - sill, revealDepth);
  }
  // The foundation already reaches the sill behind the gate. Extend that
  // level through the portico, then meet the avenue with shallow treads.
  const foundation = CITADEL_TIERS.find(t => t.name === 'foundation')!;
  const landingBack = foundation.z + foundation.depth * 0.5;
  const landingFront = gateFront + porticoDepth;
  const approachWidth = PORTAL.width - 0.1;
  detail(0, sill * 0.5, (landingBack + landingFront) * 0.5,
    approachWidth, sill, landingFront - landingBack);
  // The city avenue already arrives on its upper terrace (5.6 lift plus
  // 0.46 paving in worldBlockout). Account for the tower's vertical scale;
  // a flight from deck zero would disappear under that raised road.
  const avenueTop = (5.6 + 0.46) / CITADEL_WORLD_SCALE[1];
  const risers = 3, tread = 3.75;
  for (let step = 1; step < risers; step++) {
    const top = avenueTop + (sill - avenueTop) * step / risers;
    const z = landingFront + (risers - step - 0.5) * tread;
    detail(0, top * 0.5, z, approachWidth, top, tread);
  }
  const porticoW = (half + pierW) * 2 + 4, porticoTop = springing + half + pierW;
  detail(0, porticoTop + 1, porticoZ, porticoW, 2, porticoDepth + 2);
  parapet(0, porticoZ, porticoW, porticoDepth + 2, porticoTop + 2, true);
  // Stepped buttresses frame the whole portal bay on the gatehouse front.
  const gatePlan = prisms.find(p => p.name === gate.name)!.plan;
  const gateFace = edgeFrame(gatePlan, PORTAL.edge);
  for (const side of [-1, 1]) {
    const t = gateFace.span * 0.5 + side * (porticoW * 0.5 + 2.6);
    pier(gateFace, t, gate.bottom + 5.6, gate.bottom + Math.round((gate.top - gate.bottom) * 0.42) - 0.5, 4.2, 2.6, 2.4);
    pier(gateFace, t, gate.bottom + Math.round((gate.top - gate.bottom) * 0.42) + 0.5, gate.top - 2.4, 3.2, 2.0, 1.3);
  }

  // Slender octagonal spires: tapered shaft, collar and a tall cone. All parts
  // share one mesh so the cluster does not cost a draw call per turret.
  for (const s of SPIRES) {
    const shaft = new THREE.CylinderGeometry(s.radius * 0.94, s.radius * 1.08, s.shoulder - s.bottom, 8);
    octagonal(shaft, s.x, (s.bottom + s.shoulder) * 0.5, s.z);
    octagonal(new THREE.CylinderGeometry(s.radius * 1.16, s.radius * 1.04, 1.4, 8), s.x, s.shoulder - 0.7, s.z);
    octagonal(new THREE.ConeGeometry(s.radius * 1.12, s.top - s.shoulder, 8), s.x, (s.shoulder + s.top) * 0.5, s.z);
  }
  {
    const c = CROWN_SHAFT;
    octagonal(new THREE.CylinderGeometry(c.radius, c.radius * 1.05, c.top - c.bottom, 8), c.x, (c.bottom + c.top) * 0.5, c.z);
    octagonal(new THREE.CylinderGeometry(c.radius * 1.3, c.radius * 1.12, 1.6, 8), c.x, c.top - 0.8, c.z);
    parapet(c.x, c.z, c.radius * 2.3, c.radius * 2.3, c.top, true);
  }
  const spires = mergeGeometries(spireParts, false)!;
  spireParts.forEach(g => g.dispose());
  spires.computeBoundingSphere();
  solid('spires', spires, 0, 0, 0);

  // This arch is open to the sky and has actual front, back and intrados
  // surfaces, so it remains legible from low and side viewpoints.
  const skyArch = createCitadelArchGeometry(SKY_ARCH.outer, SKY_ARCH.inner, SKY_ARCH.depth, SKY_ARCH.start);
  // Compensate the existing tower's (0.9, 1.62, 1.04) presentation scale:
  // the reference arc is round, with its lower ends embedded beside the keep.
  skyArch.scale(1, CITADEL_WORLD_SCALE[0] / CITADEL_WORLD_SCALE[1], 1);
  solid('sky-arch', skyArch, SKY_ARCH.x, SKY_ARCH.y, SKY_ARCH.z);

  // Batch repeated stone trim rather than hundreds of independent draws.
  const trim = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, details.length);
  trim.name = 'citadel-battlements-and-stone-trim';
  const matrix = new THREE.Matrix4();
  const rotation = new THREE.Quaternion();
  details.forEach((part, i) => {
    matrix.compose(new THREE.Vector3(part.x, deckY + part.y, part.z), rotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), part.angle),
      new THREE.Vector3(part.w, part.h, part.d));
    trim.setMatrixAt(i, matrix);
  });
  trim.instanceMatrix.needsUpdate = true;
  trim.computeBoundingSphere();
  parent.add(trim);
  parent.userData.upperEventAnchor = [CITADEL_UPPER_ANCHOR[0], deckY + CITADEL_UPPER_ANCHOR[1], CITADEL_UPPER_ANCHOR[2]];
};
