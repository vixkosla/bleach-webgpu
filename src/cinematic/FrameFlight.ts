import * as T from 'three/webgpu';
import type { UpperEventLayout } from '../scene/upperEvent';
import { CITADEL_WORLD_SCALE, createCitadelPrisms } from '../scene/citadelGeometry';
import { prismPlanes } from '../scene/citadelPrisms';
import { CITY_DECK_Y, TOWER_Z } from '../scene/constants';
import { islandContains } from '../scene/islandLayout';
import { SceneTourDirector } from './SceneTourDirector';
import { smootherstep } from '../utils/math';

/** Collision queries are indexed once. Window decoration is not a solid wall. */
export class FrameClearance {
  private readonly cells = new Map<string, { bounds: T.Box3; inverse: T.Matrix4 }[]>();
  private readonly local = new T.Vector3();
  private readonly probe = new T.Vector3();
  private readonly scale = new T.Vector3(...CITADEL_WORLD_SCALE);
  private readonly shift = new T.Vector3(0, CITY_DECK_Y * (1 - CITADEL_WORLD_SCALE[1]), TOWER_Z);
  private readonly masonry = createCitadelPrisms(CITY_DECK_Y).map(prismPlanes);
  constructor(city: T.Object3D, private readonly layout: UpperEventLayout) {
    city.updateMatrixWorld(true);
    city.traverse(object => {
      const mesh = object as T.Mesh;
      if (!mesh.isMesh || mesh.geometry.type !== 'BoxGeometry' || /window|slit|glazing/.test(mesh.name)) return;
      mesh.geometry.computeBoundingBox();
      const instanced = mesh as T.InstancedMesh, instance = new T.Matrix4();
      for (let i = 0; i < (instanced.isInstancedMesh ? instanced.count : 1); i++) {
        if (instanced.isInstancedMesh) instanced.getMatrixAt(i, instance); else instance.identity();
        const matrix = mesh.matrixWorld.clone().multiply(instance);
        if (Math.abs(matrix.determinant()) < 1e-8) continue;
        const world = mesh.geometry.boundingBox!.clone().applyMatrix4(matrix).expandByScalar(2);
        const bounds = mesh.geometry.boundingBox!.clone();
        // A small near-plane allowance, expressed in each object's local scale.
        const size = new T.Vector3().setFromMatrixScale(matrix);
        bounds.min.add(new T.Vector3(-1.5 / size.x, -1.5 / size.y, -1.5 / size.z));
        bounds.max.add(new T.Vector3(1.5 / size.x, 1.5 / size.y, 1.5 / size.z));
        const box = { bounds, inverse: matrix.invert() };
        for (let x = Math.floor(world.min.x / 64); x <= Math.floor(world.max.x / 64); x++)
          for (let z = Math.floor(world.min.z / 64); z <= Math.floor(world.max.z / 64); z++) {
            const key = `${x},${z}`, cell = this.cells.get(key);
            if (cell) cell.push(box); else this.cells.set(key, [box]);
          }
      }
    });
  }
  free(point: T.Vector3): boolean {
    if (point.distanceToSquared(this.layout.center) < (this.layout.radius + 25) ** 2) return false;
    if (point.y < CITY_DECK_Y + 3 && islandContains(point.x, point.z - TOWER_Z, -.04)) return false;
    this.local.copy(point).sub(this.shift).divide(this.scale);
    if (this.masonry.some(planes => planes.every(plane => plane.distanceToPoint(this.local) <= 1))) return false;
    const boxes = this.cells.get(`${Math.floor(point.x / 64)},${Math.floor(point.z / 64)}`);
    return !boxes?.some(box => box.bounds.containsPoint(this.local.copy(point).applyMatrix4(box.inverse)));
  }
  segment(a: T.Vector3, b: T.Vector3): boolean {
    const steps = Math.max(1, Math.ceil(a.distanceTo(b) / 3));
    for (let i = 0; i <= steps; i++) if (!this.free(this.probe.copy(a).lerp(b, i / steps))) return false;
    return true;
  }
  curve(curve: T.Curve<T.Vector3>): boolean {
    const steps = Math.max(8, Math.ceil(curve.getLength() / 2));
    for (let i = 0; i <= steps; i++) if (!this.free(curve.getPoint(i / steps, this.probe))) return false;
    return true;
  }
}

/** Frames connect endpoint compositions, independently of the Cinema timeline.
 * A visibility graph finds a short clearance corridor; rounded corners form
 * one uninterrupted arc. No intermediate camera aim or film stop is replayed. */
export class FrameFlight {
  readonly clearance: FrameClearance;
  readonly target = new T.Vector3();
  readonly lookAhead = new T.Vector3();
  length = 0;
  bends = 0;
  private path = new T.CurvePath<T.Vector3>();
  private readonly fromRotation = new T.Quaternion();
  private readonly toRotation = new T.Quaternion();
  private fromDistance = 0;
  private toDistance = 0;
  private fromFov = 60;
  private toFov = 60;
  private nodes: T.Vector3[] = [];
  private edges: number[][] = [];
  private aspect = 0;
  private readonly guideCamera = new T.PerspectiveCamera();
  private readonly guide: SceneTourDirector;
  constructor(city: T.Object3D, layout: UpperEventLayout) {
    this.clearance = new FrameClearance(city, layout);
    this.guide = new SceneTourDirector(this.guideCamera, layout);
  }
  warm(aspect: number): void {
    if (aspect === this.aspect) return;
    this.aspect = this.guideCamera.aspect = aspect;
    this.nodes = [];
    // Authored positions provide known open corridors, not mandatory stops.
    // Every mutually visible pair is a candidate shortcut, regardless of time.
    for (let t = 0; t <= 66; t += 2) {
      this.guide.update(t);
      if (this.clearance.free(this.guideCamera.position)) this.nodes.push(this.guideCamera.position.clone());
    }
    this.edges = this.nodes.map(() => []);
    for (let i = 0; i < this.nodes.length; i++) for (let j = 0; j < i; j++)
      if (this.clearance.segment(this.nodes[i]!, this.nodes[j]!)) {
        this.edges[i]!.push(j); this.edges[j]!.push(i);
      }
  }
  start(camera: T.PerspectiveCamera, target: T.Vector3, destination: T.PerspectiveCamera, aim: T.Vector3): void {
    this.fromFov = camera.fov; this.toFov = destination.fov;
    this.fromRotation.copy(camera.quaternion); this.toRotation.copy(destination.quaternion);
    this.fromDistance = camera.position.distanceTo(target); this.toDistance = destination.position.distanceTo(aim);
    const a = camera.position.clone(), b = destination.position.clone();
    const direct = new T.QuadraticBezierCurve3(a, a.clone().lerp(b, .5).add(new T.Vector3(0, Math.min(42, a.distanceTo(b) * .055), 0)), b);
    this.path = new T.CurvePath<T.Vector3>();
    if (this.clearance.curve(direct)) { this.path.add(direct); this.bends = 0; }
    else {
      this.warm(camera.aspect);
      const nodes = [...this.nodes, a, b], start = nodes.length - 2, end = nodes.length - 1;
      const edges = this.edges.map(edge => [...edge]); edges.push([], []);
      for (const endpoint of [start, end]) for (let j = 0; j < endpoint; j++)
        if (this.clearance.segment(nodes[endpoint]!, nodes[j]!)) { edges[endpoint]!.push(j); edges[j]!.push(endpoint); }
      const distances = nodes.map(() => Infinity), previous = nodes.map(() => -1), visited = new Set<number>();
      distances[start] = 0;
      for (let k = 0; k < nodes.length; k++) {
        let nearest = -1;
        for (let i = 0; i < nodes.length; i++) if (!visited.has(i) && (nearest < 0 || distances[i]! < distances[nearest]!)) nearest = i;
        if (nearest === end || nearest < 0 || !Number.isFinite(distances[nearest])) break;
        visited.add(nearest);
        for (const next of edges[nearest]!) {
          const cost = distances[nearest]! + nodes[nearest]!.distanceTo(nodes[next]!) + 55;
          if (cost < distances[next]!) { distances[next] = cost; previous[next] = nearest; }
        }
      }
      if (!Number.isFinite(distances[end])) throw new Error('No clear Frame corridor between the selected compositions');
      const points: T.Vector3[] = [];
      for (let n = end; n >= 0; n = previous[n]!) points.unshift(nodes[n]!);
      this.bends = points.length - 2;
      let cursor = points[0]!;
      for (let i = 1; i < points.length - 1; i++) {
        const before = points[i - 1]!, corner = points[i]!, after = points[i + 1]!;
        let radius = Math.min(before.distanceTo(corner), corner.distanceTo(after)) * .36;
        let bend: T.QuadraticBezierCurve3;
        do {
          const entry = corner.clone().lerp(before, radius / corner.distanceTo(before));
          const exit = corner.clone().lerp(after, radius / corner.distanceTo(after));
          bend = new T.QuadraticBezierCurve3(entry, corner, exit); radius *= .5;
        } while (!this.clearance.curve(bend) && radius > .01);
        this.path.add(new T.LineCurve3(cursor, bend.v0)); this.path.add(bend); cursor = bend.v2;
      }
      this.path.add(new T.LineCurve3(cursor, b));
    }
    this.path.updateArcLengths(); this.length = this.path.getLength();
  }
  sample(progress: number, camera: T.PerspectiveCamera): void {
    const u = smootherstep(0, 1, Math.max(0, Math.min(1, progress)));
    this.path.getPoint(u, camera.position);
    this.path.getPoint(Math.min(1, u + .025), this.lookAhead);
    // Match endpoint compositions by the shortest rotation. A world-space
    // interpolated target can pass behind a travelling camera and cause a spin.
    camera.quaternion.copy(this.fromRotation).slerp(this.toRotation, u);
    this.target.set(0, 0, -1).applyQuaternion(camera.quaternion)
      .multiplyScalar(this.fromDistance + (this.toDistance - this.fromDistance) * u).add(camera.position);
    camera.fov = this.fromFov + (this.toFov - this.fromFov) * u;
    camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
  }
}
