import * as THREE from 'three/webgpu';
import type { CoatingAssemblyOptions } from './crystalCoating';
import { prismPlanes } from './citadelPrisms';
import type { CitadelPrism } from './citadelPrisms';

// Raised facets at a concave joint can enter the next wall even though their
// flat source polygon is exposed. Clip the actual relief against the union.
export const clipCitadelCoating = (mesh: THREE.Mesh, prisms: readonly CitadelPrism[]): void => {
  const input = mesh.geometry;
  const p = input.getAttribute('position'), c = input.getAttribute('color');
  const positions: number[] = [], colours: number[] = [];
  const blockers = prisms.map(prism => ({ planes: prismPlanes(prism), bounds: new THREE.Box3(
    new THREE.Vector3(Math.min(...prism.plan.map(v => v.x)), prism.bottom, Math.min(...prism.plan.map(v => v.y))),
    new THREE.Vector3(Math.max(...prism.plan.map(v => v.x)), prism.top, Math.max(...prism.plan.map(v => v.y))),
  ) }));
  type Vertex = { position: THREE.Vector3; colour: THREE.Color };
  const halfspace = (polygon: Vertex[], plane: THREE.Plane, sign: number): Vertex[] => {
    const output: Vertex[] = [];
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i]!, b = polygon[(i + 1) % polygon.length]!;
      const da = plane.distanceToPoint(a.position) * sign, db = plane.distanceToPoint(b.position) * sign;
      if (da <= 1e-8) output.push(a);
      if ((da < -1e-8 && db > 1e-8) || (db < -1e-8 && da > 1e-8)) {
        const t = da / (da - db);
        output.push({ position: a.position.clone().lerp(b.position, t), colour: a.colour.clone().lerp(b.colour, t) });
      }
    }
    return output;
  };
  let clipped = 0;
  for (let i = 0; i < p.count; i += 3) {
    const triangle = [0, 1, 2].map(j => ({ position: new THREE.Vector3().fromBufferAttribute(p, i + j),
      colour: new THREE.Color(c.getX(i + j), c.getY(i + j), c.getZ(i + j)) }));
    const bounds = new THREE.Box3().setFromPoints(triangle.map(v => v.position));
    let fragments = [triangle];
    for (const blocker of blockers) {
      if (!bounds.intersectsBox(blocker.bounds)) continue;
      fragments = fragments.flatMap(polygon => {
        if (blocker.planes.some(plane => polygon.every(v => plane.distanceToPoint(v.position) >= -1e-7))) return [polygon];
        clipped++;
        const outside: Vertex[][] = [];
        let remainder = polygon;
        for (const plane of blocker.planes) {
          const fragment = halfspace(remainder, plane, -1);
          if (fragment.length >= 3) outside.push(fragment);
          remainder = halfspace(remainder, plane, 1);
          if (remainder.length < 3) break;
        }
        return outside;
      });
    }
    for (const fragment of fragments) for (let j = 1; j + 1 < fragment.length; j++) {
      const tri = [fragment[0]!, fragment[j]!, fragment[j + 1]!];
      if (tri[1]!.position.clone().sub(tri[0]!.position).cross(tri[2]!.position.clone().sub(tri[0]!.position)).lengthSq() < 1e-12) continue;
      for (const v of tri) { positions.push(...v.position.toArray()); colours.push(...v.colour.toArray()); }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  geometry.computeVertexNormals(); geometry.computeBoundingSphere();
  mesh.geometry = geometry; input.dispose();
  mesh.userData.triangles = positions.length / 9;
  mesh.userData.clippedAtMasonryJoints = clipped;
};

// A few growth courses follow successive structural corners down the compound
// keep. They are in citadel-local coordinates above the deck, shared by walls
// and roofs. Clean bays between courses give the individual halls breathing room.
export const CITADEL_GROWTH_COURSES = [
  [[-30,207,-2],[-63,178,26],[-89,128,49],[-102,60,40],[-102,12,40]],
  [[6,207,-38],[60,172,-59],[100,142,-52],[100,70,-50],[100,12,-50]],
  [[-30,207,-38],[-30,170,-76],[-32,120,-91],[-40,46,-94],[-40,12,-94]],
  [[6,207,-2],[24,166,33],[48,154,32],[100,100,31],[128,62,40],[128,20,40]],
] as const;

export const createCitadelCoatingOptions = (
  metricScale: readonly [number, number, number], deckY: number,
): CoatingAssemblyOptions => ({
  verticalBias: 1,
  colonyAt(metricPoint) {
    const p = metricPoint.clone().divide(new THREE.Vector3(...metricScale));
    p.y -= deckY;
    // Do not seed every foundation corner: lower masonry reads as a solid base.
    if (p.y < 20) return null;
    let distance = Infinity;
    for (const course of CITADEL_GROWTH_COURSES) {
      for (let i = 1; i < course.length; i++) {
        const a = new THREE.Vector3(...course[i-1]!);
        const b = new THREE.Vector3(...course[i]!);
        const t = THREE.MathUtils.clamp((p.y-a.y)/(b.y-a.y),0,1);
        const q = a.lerp(b,t);
        // A course is a strip over a corner, not a sphere of floating crystals.
        distance = Math.min(distance,Math.hypot(p.x-q.x,p.z-q.z,(p.y-q.y)*0.35));
      }
    }
    const affinity = Math.exp(-Math.pow(distance/42,2));
    // Frozen-city direction: fewer colonies on the citadel, each a larger
    // sheet of ice, so the keep reads as a few big glacial slabs rather than
    // many small patches.
    if (affinity < 0.3) return null;
    const maturity = 0.5+0.5*Math.sin(p.x*0.041+p.y*0.029+p.z*0.037);
    return { score: affinity + p.y*0.00001,
      maxScale: 20+affinity*(26+maturity*10), strength: 0.82+affinity*0.18 };
  },
});
