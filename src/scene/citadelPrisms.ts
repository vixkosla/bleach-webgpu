import * as THREE from 'three/webgpu';

export interface CitadelPrism {
  name: string;
  plan: THREE.Vector2[]; // Counterclockwise in X/Z.
  bottom: number;
  top: number;
  /** Elevated connectors need a visible lower face over the open air. */
  underside?: boolean;
}
export interface PrismFace {
  owner: string;
  normal: THREE.Vector3;
  vertices: THREE.Vector3[];
}

export const octagonalPlan = (x: number, z: number, w: number, d: number, cut: number) => {
  const a = w * 0.5, b = d * 0.5;
  const cx = w * cut, cz = d * cut;
  return [[-a + cx, -b], [a - cx, -b], [a, -b + cz], [a, b - cz],
    [a - cx, b], [-a + cx, b], [-a, b - cz], [-a, -b + cz]]
    .map(([px, pz]) => new THREE.Vector2(x + px!, z + pz!));
};

export const prismPlanes = (prism: CitadelPrism): THREE.Plane[] => [
  ...prism.plan.map((a, i) => {
    const b = prism.plan[(i + 1) % prism.plan.length]!;
    const n = new THREE.Vector3(b.y - a.y, 0, a.x - b.x).normalize();
    return new THREE.Plane(n, -n.dot(new THREE.Vector3(a.x, 0, a.y)));
  }),
  new THREE.Plane(new THREE.Vector3(0, 1, 0), -prism.top),
  new THREE.Plane(new THREE.Vector3(0, -1, 0), prism.bottom),
];

export const prismContains = (prism: CitadelPrism, point: THREE.Vector3, margin = 0) =>
  prismPlanes(prism).every(plane => plane.distanceToPoint(point) <= margin);

export const polygonArea = (vertices: readonly THREE.Vector3[]) => {
  let area = 0;
  for (let i = 1; i + 1 < vertices.length; i++) {
    area += vertices[i]!.clone().sub(vertices[0]!).cross(vertices[i + 1]!.clone().sub(vertices[0]!)).length() * 0.5;
  }
  return area;
};

const clipHalfspace = (polygon: THREE.Vector3[], plane: THREE.Plane, inside: boolean) => {
  const result: THREE.Vector3[] = [];
  const sign = inside ? 1 : -1;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!, b = polygon[(i + 1) % polygon.length]!;
    const da = plane.distanceToPoint(a) * sign, db = plane.distanceToPoint(b) * sign;
    if (da <= 1e-8) result.push(a.clone());
    if ((da < -1e-8 && db > 1e-8) || (da > 1e-8 && db < -1e-8)) {
      result.push(a.clone().lerp(b, da / (da - db)));
    }
  }
  return result.filter((p, i) => p.distanceToSquared(result[(i + result.length - 1) % result.length]!) > 1e-12);
};

// Convex subtraction preserves the exact diagonal outline. Each outside
// fragment is disjoint; roofs can retain a terrace around a covered centre.
export const subtractPrism = (polygon: THREE.Vector3[], planes: THREE.Plane[]) => {
  if (planes.some(p => polygon.every(v => p.distanceToPoint(v) >= -1e-8))) return [polygon];
  const outside: THREE.Vector3[][] = [];
  let remaining = polygon;
  for (const plane of planes) {
    const fragment = clipHalfspace(remaining, plane, false);
    if (polygonArea(fragment) > 1e-6) outside.push(fragment);
    remaining = clipHalfspace(remaining, plane, true);
    if (remaining.length < 3) break;
  }
  return outside;
};

export const prismFaces = (prism: CitadelPrism): PrismFace[] => {
  const p = (v: THREE.Vector2, y: number) => new THREE.Vector3(v.x, y, v.y);
  return [
    ...prism.plan.map((a, i) => {
      const b = prism.plan[(i + 1) % prism.plan.length]!;
      return { owner: prism.name,
        normal: new THREE.Vector3(b.y - a.y, 0, a.x - b.x).normalize(),
        vertices: [p(a, prism.bottom), p(a, prism.top), p(b, prism.top), p(b, prism.bottom)] };
    }),
    { owner: prism.name, normal: new THREE.Vector3(0, 1, 0),
      vertices: prism.plan.map(v => p(v, prism.top)).reverse() },
    ...(prism.underside ? [{ owner: prism.name, normal: new THREE.Vector3(0, -1, 0),
      vertices: prism.plan.map(v => p(v, prism.bottom)) }] : []),
  ];
};

export const exposedPrismFaces = (input: readonly CitadelPrism[]): PrismFace[] => {
  const prisms = [...input].sort((a, b) => a.name.localeCompare(b.name));
  const output: PrismFace[] = [];
  for (const prism of prisms) for (const face of prismFaces(prism)) {
    let fragments = [face.vertices];
    for (const blocker of prisms) {
      if (blocker === prism) continue;
      const planes = prismPlanes(blocker);
      // Probe immediately outside the source plane. A coplanar union face
      // belongs to one stable owner; an inward touching face is fully hidden.
      const coplanar = planes.some(p => p.normal.dot(face.normal) > 0.999999
        && face.vertices.every(v => Math.abs(p.distanceToPoint(v)) < 1e-6));
      if (coplanar && blocker.name > prism.name) continue;
      const offset = coplanar ? -0.00001 : 0.00001;
      const shifted = planes.map(p => new THREE.Plane(p.normal, p.constant + offset * p.normal.dot(face.normal)));
      fragments = fragments.flatMap(fragment => subtractPrism(fragment, shifted));
      if (!fragments.length) break;
    }
    output.push(...fragments.filter(v => polygonArea(v) > 0.01).map(vertices => ({ ...face, vertices })));
  }
  return output;
};

export const prismSurfaceGeometry = (faces: readonly PrismFace[], origin = new THREE.Vector3()) => {
  const positions: number[] = [];
  for (const face of faces) for (let i = 1; i + 1 < face.vertices.length; i++) {
    for (const v of [face.vertices[0]!, face.vertices[i]!, face.vertices[i + 1]!]) {
      positions.push(v.x - origin.x, v.y - origin.y, v.z - origin.z);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
};
