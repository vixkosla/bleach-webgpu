import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { octagonalPlan, exposedPrismFaces, prismContains, prismPlanes, prismSurfaceGeometry } from './citadelPrisms';
import type { CitadelPrism } from './citadelPrisms';
import { createCitadelFacade, PORTAL } from './citadelFacade';

// A tall compound keep read from the user's references: a two-step podium, an
// unequal ring of low halls, a core with two attached shoulders of different
// height, then quickly narrowing upper slabs around the crown and its open
// arch. The references show fine masonry seams and roof crenellations on broad
// continuous walls, without stacked ornamental cornices or applied frames.
// Window galleries have their own sparse layout, independent of stone details.
const TIER_MASSES = [
  { name: 'foundation', x: 0, z: -20, width: 292, depth: 228, bottom: 0, top: 5, cut: 0.13, crest: 'coping' },
  { name: 'plinth', x: 0, z: -20, width: 280, depth: 216, bottom: 4, top: 12, cut: 0.12, crest: 'coping' },
  { name: 'front-west-hall', x: -84, z: 53, width: 72, depth: 58, bottom: 8, top: 74, cut: 0.045, crest: 'merlons', rotation: -0.42 },
  { name: 'front-east-hall', x: 85, z: 50, width: 66, depth: 64, bottom: 8, top: 94, cut: 0.045, crest: 'merlons', rotation: 0.44 },
  { name: 'rear-west-hall', x: -71, z: -73, width: 78, depth: 48, bottom: 8, top: 66, cut: 0.05, crest: 'merlons', rotation: 0.36 },
  { name: 'rear-east-hall', x: 68, z: -75, width: 76, depth: 48, bottom: 8, top: 76, cut: 0.05, crest: 'merlons', rotation: -0.38 },
  { name: 'gate-block', x: 0, z: 76, width: 64, depth: 44, bottom: 0, top: 72, cut: 0.045, crest: 'merlons' },
  { name: 'lower-keep', x: -2, z: -8, width: 150, depth: 128, bottom: 8, top: 88, cut: 0.045, crest: 'merlons' },
  { name: 'west-keep', x: -65, z: 0, width: 50, depth: 90, bottom: 8, top: 116, cut: 0.045, crest: 'merlons' },
  { name: 'east-keep', x: 65, z: -14, width: 44, depth: 90, bottom: 8, top: 124, cut: 0.045, crest: 'merlons' },
  { name: 'rear-keep', x: 8, z: -62, width: 72, depth: 50, bottom: 40, top: 120, cut: 0.045, crest: 'coping' },
  { name: 'middle-keep', x: -8, z: -18, width: 106, depth: 94, bottom: 80, top: 136, cut: 0.04, crest: 'merlons' },
  { name: 'upper-west-slab', x: -44, z: -18, width: 38, depth: 66, bottom: 116, top: 187, cut: 0.045, crest: 'merlons' },
  { name: 'upper-east-slab', x: 30, z: -42, width: 28, depth: 50, bottom: 124, top: 198, cut: 0.045, crest: 'coping' },
  { name: 'upper-keep', x: -10, z: -20, width: 72, depth: 66, bottom: 170, top: 234, cut: 0.04, crest: 'merlons' },
  { name: 'crown-keep', x: -12, z: -20, width: 36, depth: 36, bottom: 230, top: 251, cut: 0.045, crest: 'coping' },
  // Two added central storeys lift the crown while keeping broad wall planes.
  { name: 'middle-upper-court', x: -8, z: -18, width: 96, depth: 86, bottom: 132, top: 156, cut: 0.04, crest: 'merlons' },
  { name: 'high-inner-keep', x: -10, z: -20, width: 84, depth: 74, bottom: 152, top: 174, cut: 0.04, crest: 'coping' },
  // The outer buildings turn around the core. Short curtain walls close their
  // gaps; unequal roof levels retain terraces and recesses inside the circuit.
  { name: 'front-west-curtain', x: -44, z: 82, width: 42, depth: 14, bottom: 8, top: 62, cut: 0.035, crest: 'merlons', rotation: -0.42 },
  { name: 'front-east-curtain', x: 44, z: 82, width: 42, depth: 14, bottom: 8, top: 70, cut: 0.035, crest: 'merlons', rotation: 0.44 },
  { name: 'rear-curtain', x: 0, z: -97, width: 94, depth: 14, bottom: 8, top: 59, cut: 0.035, crest: 'merlons' },
  // Unequal attached buildings occupy the existing foundation. These have
  // their own wall depth and roof height, rather than another concentric tier.
  { name: 'west-buttress-hall', x: -112, z: -1, width: 44, depth: 82, bottom: 8, top: 92, cut: 0.045, crest: 'merlons' },
  { name: 'rear-west-tower', x: -101, z: -51, width: 34, depth: 48, bottom: 8, top: 106, cut: 0.045, crest: 'merlons' },
  { name: 'rear-east-annex', x: 112, z: -26, width: 30, depth: 66, bottom: 8, top: 78, cut: 0.045, crest: 'merlons' },
  { name: 'front-inner-keep', x: -18, z: 48, width: 32, depth: 40, bottom: 8, top: 116, cut: 0.04, crest: 'merlons' },
  { name: 'front-west-step', x: -52, z: 39, width: 22, depth: 28, bottom: 8, top: 102, cut: 0.04, crest: 'coping' },
  { name: 'upper-west-buttress', x: -53, z: -6, width: 18, depth: 30, bottom: 160, top: 210, cut: 0.04, crest: 'coping' },
  { name: 'east-inner-pylon', x: 48, z: 26, width: 12, depth: 12, bottom: 8, top: 149, cut: 0.045, crest: 'coping' },
  // The original's high right-hand connector terminates in a tall shaft.
  // Both ends enter masonry, with a real open span and a visible soffit.
  { name: 'east-outer-pylon', x: 111, z: -30, width: 10, depth: 13, bottom: 8, top: 174, cut: 0.045, crest: 'coping' },
  { name: 'east-high-bridge', x: 76, z: -30, width: 74, depth: 6, bottom: 168, top: 172, cut: 0.02, crest: 'coping', underside: true },
] as const;

// Broad rectangular faces with a small corner chamfer, read from the reference.
export const CITADEL_TIERS = TIER_MASSES;
export const citadelTierPoint = (tier: { x: number; z: number; rotation?: number }, x: number, z: number): THREE.Vector2 => {
  const angle = tier.rotation ?? 0, c = Math.cos(angle), s = Math.sin(angle);
  return new THREE.Vector2(tier.x + x * c + z * s, tier.z - x * s + z * c);
};
export const createCitadelPrisms = (deckY: number): CitadelPrism[] =>
  CITADEL_TIERS.map(tier => ({ name: tier.name,
    plan: octagonalPlan(0, 0, tier.width, tier.depth, tier.cut).map(p => citadelTierPoint(tier, p.x, p.y)),
    bottom: deckY + tier.bottom, top: deckY + tier.top,
    underside: 'underside' in tier && tier.underside,
  }));

export type CitadelTier = typeof CITADEL_TIERS[number];

// The authored crown anchor follows the two added storeys; small trim changes
// still cannot move the sky. The moon and its light retain their crown offset.
export const CITADEL_UPPER_ANCHOR = [-8, 266, -10] as const;
export const CITADEL_WORLD_SCALE = [0.9, 1.62, 1.04] as const;

// Slender spires rise out of the masses below their terraces, never perched
// loose on a roof. The tallest pair frames the open crown arch; smaller ones
// mark the shoulders, the rear keep, the low halls and the portal.
const SPIRES = [
  { name: 'crown-west', x: -38, z: -2, bottom: 194, shoulder: 250, top: 267, radius: 3.4 },
  { name: 'crown-east', x: 16, z: -44, bottom: 194, shoulder: 241, top: 260, radius: 3.0 },
  { name: 'crown-rear-west', x: -60, z: -35, bottom: 140, shoulder: 193, top: 208, radius: 2.1 },
  { name: 'upper-east-corner', x: 41, z: -62, bottom: 148, shoulder: 200, top: 215, radius: 1.9 },
  { name: 'west-front', x: -86, z: 40, bottom: 50, shoulder: 134, top: 151, radius: 2.8 },
  { name: 'west-rear', x: -86, z: -38, bottom: 50, shoulder: 121, top: 136, radius: 2.2 },
  { name: 'east-front', x: 83, z: 26, bottom: 84, shoulder: 178, top: 198, radius: 2.7 },
  { name: 'east-rear', x: 83, z: -54, bottom: 60, shoulder: 134, top: 149, radius: 2.2 },
  { name: 'rear-keep', x: 38, z: -82, bottom: 90, shoulder: 131, top: 145, radius: 2.6 },
  { name: 'front-west-hall', x: -121.072, z: 61.853, bottom: 20, shoulder: 77, top: 90, radius: 1.9 },
  { name: 'front-east-hall', x: 120.984, z: 61.355, bottom: 20, shoulder: 97, top: 110, radius: 1.9 },
  { name: 'portal-west', x: -11, z: 106, bottom: 25, shoulder: 45, top: 56, radius: 1.2 },
  { name: 'portal-east', x: 11, z: 106, bottom: 25, shoulder: 45, top: 56, radius: 1.2 },
  { name: 'east-inner-pylon', x: 48, z: 26, bottom: 138, shoulder: 152, top: 165, radius: 1.8 },
  { name: 'east-outer-pylon', x: 111, z: -30, bottom: 163, shoulder: 177, top: 195, radius: 2.2 },
] as const;
// The right crown accent is a slim crenellated shaft in the clean street source.
const CROWN_SHAFT = { x: 14, z: 2, bottom: 194, top: 258, radius: 3.2 } as const;
// Open crown arch; its ends sit at -45 degrees and embed in the crown keep.
const SKY_ARCH = { x: -12, y: 252, z: -14, outer: 23, inner: 21.1, depth: 2.8, start: -Math.PI / 4 } as const;
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

interface EdgeFrame {
  a: THREE.Vector2; span: number; tangent: THREE.Vector2; outward: THREE.Vector2; angle: number;
}
const edgeFrame = (plan: readonly THREE.Vector2[], edge: number): EdgeFrame => {
  const a = plan[edge]!, b = plan[(edge + 1) % plan.length]!;
  const span = a.distanceTo(b), tangent = b.clone().sub(a).normalize();
  return { a, span, tangent, outward: new THREE.Vector2(tangent.y, -tangent.x), angle: -Math.atan2(tangent.y, tangent.x) };
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
  // Battlements are suppressed where a wall is buried in a neighbour and
  // where an opening has been cut, so their bases stop at every reveal. The
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
  // A vertical strip at station t of the edge, split where neighbours cover it.
  const pier = (frame: EdgeFrame, t: number, y0: number, y1: number, w: number, d: number, p: number) => {
    const at = frame.a.clone().addScaledVector(frame.tangent, t);
    const test = at.clone().addScaledVector(frame.outward, 0.35);
    const pos = at.addScaledVector(frame.outward, p - d * 0.5);
    for (const [ya, yb] of exposedSpans(test.x, test.y, y0, y1)) detail(pos.x, (ya + yb) * 0.5, pos.y, w, yb - ya, d, frame.angle);
  };

  // Spires, the crown shaft and the two embedded feet of the sky arch keep
  // openings away from where they enter the masonry. worldBlockout also lays
  // one translucent crack decal (8 x 18, tilted) on the street face of every
  // tier taller than 30, at x + 0.17 width and 14 below the top; mirror those
  // spots here so a decal never floats across a recess.
  const blockers = [...SPIRES, { ...CROWN_SHAFT, shoulder: CROWN_SHAFT.top },
    ...SKY_ARCH_FEET.map(x => ({ x, z: SKY_ARCH.z, bottom: SKY_ARCH.y - 12, top: SKY_ARCH.y + 2, radius: 2.4 })),
    ...CITADEL_TIERS.filter(t => t.top - t.bottom > 30).map(t => {
      const p = citadelTierPoint(t, t.width * .17, t.depth * .5);
      return { x: p.x, z: p.y, bottom: t.top - 24, top: t.top - 4, radius: 4.4 };
    })];
  const facade = createCitadelFacade(faces, prisms, (front, center) => blockers.some(t =>
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
    const merlons = tier.crest === 'merlons';
    const small = tier.name === 'crown-keep';
    for (let edge = 0; edge < prism.plan.length; edge++) {
      const frame = edgeFrame(prism.plan, edge);
      // The original has uninterrupted wall planes, not a raised dark band
      // tracing each terrace. Plain roofs end at the structural wall; where
      // battlements remain, their outer faces continue that same wall plane.
      // Fine horizontal seams already belong to the masonry material.
      for (const [s, e] of merlons ? exposedRuns(frame, tier.top + 1) : []) {
        const rail = small ? 0.6 : 0.8, merlon = small ? 1.6 : 1.9;
        band(frame, s, e, tier.top + rail * 0.5, rail, 1.1, 0);
        const margin = 1.2;
        const count = Math.max(1, Math.round((e - s - margin * 2) / (small ? 6.0 : 8.5)));
        for (let i = 0; i < count; i++) {
          const t = s + margin + (e - s - margin * 2) * (i + 0.5) / count;
          const pos = frame.a.clone().addScaledVector(frame.tangent, t).addScaledVector(frame.outward, -0.55);
          detail(pos.x, tier.top + rail + merlon * 0.5, pos.y, small ? 2.0 : 2.6, merlon, 1.1, frame.angle);
        }
      }

    }
  }
  parent.userData.citadelExposedFaces = faces;
  parent.userData.citadelApertures = facade.apertures;
  parent.userData.citadelApertureVoids = facade.voids;
  parent.userData.citadelApertureClearances = facade.clearances;

  const tierDetailCount = details.length;

  // Gatehouse portal: the facade void recedes 14 units behind the wall; a
  // projecting portico with two stepped arches, a lintel course and its own
  // crest stands in front, flanked by the two portal pinnacles below.
  const gate = CITADEL_TIERS.find(t => t.name === 'gate-block')!;
  const gateFront = gate.z + gate.depth * 0.5;
  const porticoDepth = 16, porticoZ = gateFront + porticoDepth * 0.5;
  const half = PORTAL.width * 0.5, pierW = PORTAL.width * 0.25, springing = gate.bottom + PORTAL.sill + PORTAL.height - half;
  for (const side of [-1, 1]) {
    solid(`gate-pier-${side}`, new THREE.BoxGeometry(pierW, springing, porticoDepth), side * (half + pierW * 0.5), springing * 0.5, porticoZ);
  }
  solid('gate-arch', createCitadelArchGeometry(half + pierW, half, porticoDepth), 0, springing, porticoZ);
  const sill = gate.bottom + PORTAL.sill;
  const revealOuter = half - 0.05, revealInner = half * 0.75, revealDepth = 4;
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

  // A neighbour's diagonal coping can project in front of a gallery even
  // when its centreline is outside the window void. Keep the complete box
  // clear of each opening's viewing space, using planar separating axes.
  const visibleDetails = details.filter((part, index) => index >= tierDetailCount || !facade.apertures.some(aperture => {
    if (Math.abs(deckY + part.y - aperture.center.y) >= (part.h + aperture.height) * 0.5) return false;
    const right = new THREE.Vector3(Math.cos(part.angle), 0, -Math.sin(part.angle));
    const back = new THREE.Vector3(Math.sin(part.angle), 0, Math.cos(part.angle));
    const frontClearance = 8;
    const center = aperture.center.clone().addScaledVector(aperture.normal, (frontClearance - aperture.depth) * 0.5);
    const delta = new THREE.Vector3(part.x, deckY + part.y, part.z).sub(center);
    return [right, back, aperture.tangent, aperture.normal].every(axis => {
      const partExtent = Math.abs(axis.dot(right)) * part.w * 0.5 + Math.abs(axis.dot(back)) * part.d * 0.5;
      const apertureExtent = Math.abs(axis.dot(aperture.tangent)) * aperture.width * 0.5
        + Math.abs(axis.dot(aperture.normal)) * (frontClearance + aperture.depth) * 0.5;
      return Math.abs(delta.dot(axis)) < partExtent + apertureExtent + 0.02;
    });
  }));
  // These details are static. Bake their transforms (including normals) into
  // one mesh so coplanar battlements receive the same light as the main walls.
  // The instanced version darkened this shared material along every crest in
  // the current WebGPU/node path. Baking fixes that without changing the
  // stone palette or adding draw calls; the shadow pass sees the same mesh.
  const matrix = new THREE.Matrix4();
  const rotation = new THREE.Quaternion();
  const box = new THREE.BoxGeometry(1, 1, 1);
  const detailParts = visibleDetails.map(part => {
    matrix.compose(new THREE.Vector3(part.x, deckY + part.y, part.z), rotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), part.angle),
      new THREE.Vector3(part.w, part.h, part.d));
    return box.clone().applyMatrix4(matrix);
  });
  box.dispose();
  const trimGeometry = mergeGeometries(detailParts, false)!;
  detailParts.forEach(geometry => geometry.dispose());
  trimGeometry.computeBoundingSphere();
  const trim = new THREE.Mesh(trimGeometry, material);
  trim.name = 'citadel-battlements-and-stone-trim';
  parent.add(trim);
  parent.userData.upperEventAnchor = [CITADEL_UPPER_ANCHOR[0], deckY + CITADEL_UPPER_ANCHOR[1], CITADEL_UPPER_ANCHOR[2]];
};
