import * as THREE from 'three/webgpu';
import type { CrystalGrowthSurface } from './crystalCoating';
import { prismPlanes, type CitadelPrism } from './citadelPrisms';

export type CrystalQuality = 'high' | 'medium' | 'low';
const qualities: CrystalQuality[] = ['high', 'medium', 'low'];
const noise = (s: number) => THREE.MathUtils.euclideanModulo(Math.sin(s * 127.1 + 311.7) * 43758.5453, 1);
const palette = [0xb367cf, 0x9b51c5, 0xc584d5, 0x8542b2, 0xae60c8].map(c => new THREE.Color(c));
// Same canyon as Frames 7 / middle-transverse. City crystals elsewhere stay sparse.
const onFilmedStreet = (p: THREE.Vector3) =>
  p.x > -300 && p.x < 80 && Math.abs(p.z - 385) < 58;

/** Closed mineral shafts: broad faces, unequal terminal facets, bevels up close.
 * All levels retain the same length and width so a distant crown keeps its shape. */
export const createCrystalPrism = (quality: CrystalQuality): THREE.BufferGeometry => {
  const sides = quality === 'low' ? 4 : 6;
  const rings = quality === 'high' ? [[0, .78], [.1, 1], [.62, 1]]
    : [[0, 1], [.62, 1]];
  const positions: number[] = [], colors: number[] = [];
  const color = new THREE.Color(0xc6b1e4);
  const ring = (y: number, r: number) => Array.from({ length: sides }, (_, i) => {
    const a = i / sides * Math.PI * 2;
    const terminal = y > .5 ? .13 * noise(i * 7 + 17) : 0;
    const radius = r * (.88 + .12 * noise(i * 19 + 3));
    return new THREE.Vector3(Math.cos(a) * radius * .5, y + terminal, Math.sin(a) * radius * .5);
  });
  const rows = rings.map(([y, r]) => ring(y!, r!));
  const triangle = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, factor: number) => {
    positions.push(...a.toArray(), ...b.toArray(), ...c.toArray());
    const shade = color.clone().multiplyScalar(factor);
    colors.push(...shade.toArray(), ...shade.toArray(), ...shade.toArray());
  };
  for (let r = 1; r < rows.length; r++) for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides, a = rows[r - 1]![i]!, b = rows[r]![i]!;
    const c = rows[r]![j]!, d = rows[r - 1]![j]!;
    const shade = .79 + .21 * (i % 3) / 2;
    triangle(a, b, c, shade); triangle(a, c, d, shade);
  }
  const tip = new THREE.Vector3(.13, 1, -.09), base = new THREE.Vector3();
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    triangle(rows.at(-1)![i]!, tip, rows.at(-1)![j]!, 1.1);
    triangle(rows[0]![i]!, rows[0]![j]!, base, .67);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals(); geometry.computeBoundingSphere();
  return geometry;
};

interface CrystalInstance { matrix: THREE.Matrix4; center: THREE.Vector3; tint: THREE.Color; detail: number }
interface ClusterOptions {
  kind: 'city' | 'citadel';
  metricScale?: THREE.Vector3;
  masonry?: readonly CitadelPrism[];
  openings?: readonly CitadelPrism[];
  windowBounds?: readonly THREE.Box3[];
}

export const collectCrystalWindowBounds = (parent: THREE.Group): THREE.Box3[] => {
  parent.updateMatrixWorld(true);
  const inverse = parent.matrixWorld.clone().invert(), boxes: THREE.Box3[] = [];
  parent.traverse(object => {
    if (!(object instanceof THREE.Mesh) || !/window|slit|glazing/.test(object.name)) return;
    object.geometry.computeBoundingBox();
    if (!object.geometry.boundingBox) return;
    const count = object instanceof THREE.InstancedMesh ? object.count : 1;
    const instance = new THREE.Matrix4();
    for (let i = 0; i < count; i++) {
      if (object instanceof THREE.InstancedMesh) object.getMatrixAt(i, instance);
      else instance.identity();
      const matrix = inverse.clone().multiply(object.matrixWorld).multiply(instance);
      // Include the space just in front of the glazing, not only its thin
      // drawn plane: raised mineral must not bridge across a window either.
      boxes.push(object.geometry.boundingBox.clone().applyMatrix4(matrix).expandByScalar(.9));
    }
  });
  return boxes;
};

/** Batch rooted shafts into spatial LOD cells; Three updates LOD for the actual
 * camera in both inspection and the film, including free vertical movement. */
export class CrystalClusterBuilder {
  private readonly instances: CrystalInstance[] = [];
  private readonly metric: THREE.Vector3;
  private readonly inverseScale: THREE.Matrix4;
  private readonly solidPlanes: THREE.Plane[][];
  private readonly voidPlanes: THREE.Plane[][];
  private readonly windowCells = new Map<string, THREE.Box3[]>();
  private surfaces = 0;
  private rejected = 0;

  constructor(private readonly options: ClusterOptions) {
    this.metric = options.metricScale ?? new THREE.Vector3(1, 1, 1);
    this.inverseScale = new THREE.Matrix4().makeScale(1 / this.metric.x, 1 / this.metric.y, 1 / this.metric.z);
    const metricPrism = (p: CitadelPrism) => ({ ...p, bottom: p.bottom * this.metric.y,
      top: p.top * this.metric.y, plan: p.plan.map(v => new THREE.Vector2(v.x * this.metric.x, v.y * this.metric.z)) });
    this.solidPlanes = (options.masonry ?? []).map(p => prismPlanes(metricPrism(p)));
    this.voidPlanes = (options.openings ?? []).map(p => prismPlanes(metricPrism(p)));
    for (const box of options.windowBounds ?? []) {
      for (let x = Math.floor(box.min.x / 24); x <= Math.floor(box.max.x / 24); x++) {
        for (let z = Math.floor(box.min.z / 24); z <= Math.floor(box.max.z / 24); z++) {
          const key = `${x},${z}`, cell = this.windowCells.get(key) ?? [];
          cell.push(box); this.windowCells.set(key, cell);
        }
      }
    }
  }

  addSurface = (surface: CrystalGrowthSurface): void => {
    this.surfaces++;
    const { origin, u, v, normal, seed, scale, veins } = surface;
    if (scale < 2) return;
    const citadel = this.options.kind === 'citadel';
    const street = !citadel && onFilmedStreet(origin);
    const point = (p: THREE.Vector2) => origin.clone().addScaledVector(u, p.x).addScaledVector(v, p.y);

    // The connected relief supplies the roots. Several squat intergrown
    // crystals occupy each strong ridge, rather than one long pencil per vein.
    // The filmed street uses more, smaller shafts so they read as clusters, not plates.
    for (let i = 0; i < veins.length; i++) {
      const vein = veins[i]!;
      if (!citadel && !street && i % 4 !== 0) continue;
      if (street && i % 2 !== 0) continue;
      const delta = vein.to.clone().sub(vein.from), available = delta.length();
      if (available < (street ? 0.7 : 1.2)) continue;
      const s = seed + i * 97;
      const direction = delta.clone().normalize();
      const tangent = u.clone().multiplyScalar(direction.x).addScaledVector(v, direction.y).normalize();
      const sideways = normal.clone().cross(tangent).normalize();
      const members = citadel ? 4 : street ? 5 : 2;
      for (let member = 0; member < members; member++) {
        const n = s + member * 43;
        const station = (street ? .04 : .10) + member / members * (street ? .78 : .67) + noise(n + 3) * .12;
        const root2 = vein.from.clone().lerp(vein.to, station);
        const width = Math.min(citadel ? 2.4 : street ? 0.62 : 1.25,
          Math.max(citadel ? .65 : street ? .18 : .35, vein.startWidth * (.5 + noise(n + 5) * .45)));
        const depth = width * (.68 + noise(n + 11) * .62);
        const length = Math.min(available * (1 - station) * (street ? .55 : .85),
          width * (street ? 1.15 + noise(n + 7) * 1.15 : 1.4 + noise(n + 7) * 2.4));
        if (length < width * (street ? .55 : .8)) continue;
        const root = point(root2).addScaledVector(normal, depth * .36 + .035);
        const growth = tangent.clone().addScaledVector(normal, .18 + noise(n + 17) * .38)
          .addScaledVector(sideways, (noise(n + 19) - .5) * (street ? .45 : .8)).normalize();
        const detail = street
          ? member < 2 ? 0 : member < 4 ? 1 : 2
          : member === 0 && i % 3 === 0 ? 0 : member === 0 ? 1 : 2;
        this.add(root, growth, normal, width, length, depth, n, detail);
      }
    }
  };

  private add(root: THREE.Vector3, axis: THREE.Vector3, normal: THREE.Vector3,
    width: number, length: number, depth: number, seed: number, detail: number): void {
    const x = axis.clone().cross(normal).normalize(), z = x.clone().cross(axis).normalize();
    const rotation = new THREE.Matrix4().makeBasis(x, axis, z);
    const matrix = rotation.scale(new THREE.Vector3(width, length, depth)).setPosition(root);
    const tip = root.clone().addScaledVector(axis, length);
    const radius = Math.hypot(width, depth) * .55;
    const bounds = new THREE.Box3().setFromPoints([root, tip]).expandByScalar(radius);
    for (let x = Math.floor(bounds.min.x / 24); x <= Math.floor(bounds.max.x / 24); x++) {
      for (let z = Math.floor(bounds.min.z / 24); z <= Math.floor(bounds.max.z / 24); z++) {
        if (this.windowCells.get(`${x},${z}`)?.some(box => box.intersectsBox(bounds))) {
          this.rejected++; return;
        }
      }
    }
    // Segment clipping against expanded window voids also catches a crystal
    // bridging a small opening even when neither endpoint lies inside it.
    const bridgesOpening = this.voidPlanes.some(planes => {
      let near = 0, far = 1;
      const delta = tip.clone().sub(root);
      for (const plane of planes) {
        const a = plane.distanceToPoint(root) - radius, rate = plane.normal.dot(delta);
        if (Math.abs(rate) < 1e-8) { if (a > 0) return false; }
        else if (rate < 0) near = Math.max(near, -a / rate);
        else far = Math.min(far, -a / rate);
        if (near > far) return false;
      }
      return true;
    });
    const samples = [root, tip];
    for (const y of [.15, .7]) for (const side of [-1, 1]) {
      samples.push(root.clone().addScaledVector(axis, length * y).addScaledVector(x, width * .5 * side));
      samples.push(root.clone().addScaledVector(axis, length * y).addScaledVector(z, depth * .5 * side));
    }
    if (bridgesOpening || this.solidPlanes.some(planes => samples.some(p => planes.every(q => q.distanceToPoint(p) < -.035)))) {
      this.rejected++; return;
    }
    const tint = palette[Math.floor(noise(seed + 41) * palette.length)]!.clone();
    // Vertex colour supplies the mineral hue; instance tint only varies its
    // maturity slightly, never random rainbow faces within a single shaft.
    tint.lerp(new THREE.Color(0xffffff), .64);
    this.instances.push({ matrix: this.inverseScale.clone().multiply(matrix),
      center: root.clone().addScaledVector(axis, length * .5).divide(this.metric), tint, detail });
  }

  build(parent: THREE.Group, material: THREE.Material): THREE.Group {
    const root = new THREE.Group(); root.name = `${this.options.kind}-crystal-clusters`;
    const query = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('crystal-lod') : null;
    root.visible = query !== 'off';
    const cellSize = this.options.kind === 'citadel' ? 90 : 170;
    const cells = new Map<string, CrystalInstance[]>();
    for (const instance of this.instances) {
      const p = instance.center.clone().multiply(this.metric);
      const key = `${Math.floor(p.x / cellSize)},${Math.floor(p.y / cellSize)},${Math.floor(p.z / cellSize)}`;
      const cell = cells.get(key) ?? []; cell.push(instance); cells.set(key, cell);
    }
    const geometries = Object.fromEntries(qualities.map(q => [q, createCrystalPrism(q)])) as Record<CrystalQuality, THREE.BufferGeometry>;
    const counts = { high: 0, medium: 0, low: 0 };
    for (const [key, instances] of cells) {
      const center = instances.reduce((sum, p) => sum.add(p.center), new THREE.Vector3()).multiplyScalar(1 / instances.length);
      const lod = new THREE.LOD(); lod.name = `crystal-cell-${key}`; lod.position.copy(center);
      for (let index = 0; index < qualities.length; index++) {
        const quality = qualities[index]!;
        const members = instances.filter(p => p.detail <= 2 - index);
        const distance = index === 0 ? 0 : this.options.kind === 'citadel'
          ? index === 1 ? 400 : 1050 : index === 1 ? 150 : 500;
        // A sparse cell can have no coarse shafts. An empty group is a valid
        // LOD; a zero-instance mesh produces an invalid zero-size GPU binding.
        if (!members.length) {
          lod.addLevel(new THREE.Group(), distance, .16);
          continue;
        }
        const mesh = new THREE.InstancedMesh(geometries[quality], material, members.length);
        mesh.name = `${this.options.kind}-crystal-prisms-${quality}`;
        members.forEach((p, i) => {
          const matrix = p.matrix.clone(); matrix.elements[12]! -= center.x;
          matrix.elements[13]! -= center.y; matrix.elements[14]! -= center.z;
          mesh.setMatrixAt(i, matrix); mesh.setColorAt(i, p.tint);
        });
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        mesh.computeBoundingSphere(); mesh.computeBoundingBox();
        mesh.userData.crystalQuality = quality;
        counts[quality] += members.length;
        lod.addLevel(mesh, distance, .16);
      }
      if (qualities.includes(query as CrystalQuality)) {
        lod.autoUpdate = false;
        lod.levels.forEach((level, i) => { level.object.visible = qualities[i] === query; });
      }
      root.add(lod);
    }
    root.userData = { surfaces: this.surfaces, rejected: this.rejected, cells: cells.size,
      instances: counts, mode: query ?? 'auto',
      triangles: Object.fromEntries(qualities.map(q => [q, counts[q] * geometries[q].getAttribute('position').count / 3])) };
    parent.add(root); return root;
  }
}
