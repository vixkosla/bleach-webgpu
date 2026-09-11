import * as THREE from 'three/webgpu';
import type { UpperEventLayout } from '../scene/upperEvent';
import { CITY_DECK_Y, TOWER_Z } from '../scene/constants';
import { ISLAND_RADIUS_X, ISLAND_RADIUS_Z, ISLAND_BOTTOM_Y, islandCoastRadius } from '../scene/islandLayout';

/** Compose the entire keep and lunar body above the navigation, from either
 * shoulder of the city. Fit their world-space bounds, not only the moon. */
export class CitadelOverview {
  readonly position = new THREE.Vector3();
  readonly target = new THREE.Vector3();
  fov = 76;
  private readonly centre: THREE.Vector3;
  private readonly points: THREE.Vector3[] = [];
  private readonly back = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly relative = new THREE.Vector3();

  constructor(layout: UpperEventLayout) {
    this.centre = new THREE.Vector3(layout.crown.x, (ISLAND_BOTTOM_Y + layout.center.y + layout.radius) / 2, TOWER_Z);
    for (const x of [-160, 160]) for (const y of [CITY_DECK_Y, layout.crown.y + 14]) for (const z of [-160, 150]) {
      this.points.push(new THREE.Vector3(x, y, TOWER_Z + z));
    }
    // The keep stands on a whole suspended land mass, not a thin platform.
    // Include roofs at the rim and the displaced rocky root in both overviews.
    for (let i = 0; i < 64; i++) {
      const a = i / 64 * Math.PI * 2, radius = islandCoastRadius(a) * 1.025;
      for (const y of [CITY_DECK_Y - 80, CITY_DECK_Y + 130]) {
        this.points.push(new THREE.Vector3(Math.cos(a) * ISLAND_RADIUS_X * radius,
          y, TOWER_Z + Math.sin(a) * ISLAND_RADIUS_Z * radius));
      }
    }
    // A low approach sees the projecting rock shoulders, not only the root.
    // Bound the existing tapered profile at several depths, including its
    // displaced faults and a small allowance for the fractured face relief.
    for (let i = 0; i < 64; i++) for (let level = 1; level < 8; level++) {
      const a = i / 64 * Math.PI * 2, depth = level / 8;
      const radius = Math.pow(1 - Math.pow(depth, 1.65), .69);
      const fault = Math.sin(a * 11 + .45 * depth) * .036 + Math.sin(a * 5 + depth * 1.7) * .08;
      const r = radius * (islandCoastRadius(a) + fault * Math.min(1, depth * 7));
      const relief = 28 * Math.pow(radius, .6);
      const y = CITY_DECK_Y + (ISLAND_BOTTOM_Y - CITY_DECK_Y) * depth
        + (Math.sin(a * 5 + .4) * 32 + Math.cos(a * 13 + depth * 4) * 12) * Math.sin(Math.PI * depth);
      this.points.push(new THREE.Vector3(Math.cos(a) * (ISLAND_RADIUS_X * r + relief) - depth * 94,
        y, TOWER_Z + Math.sin(a) * (ISLAND_RADIUS_Z * r + relief) + depth * 61));
    }
    this.points.push(new THREE.Vector3(-94, ISLAND_BOTTOM_Y - 15, TOWER_Z + 61));
    // Include air around the solid crescent so the silhouette can breathe.
    for (let ring = 0; ring < 3; ring++) for (let i = 0; i < 32; i++) {
      const a = i / 32 * Math.PI * 2, c = Math.cos(a) * layout.radius * 1.05, s = Math.sin(a) * layout.radius * 1.05;
      this.points.push(layout.center.clone().add(new THREE.Vector3(ring === 2 ? 0 : c, ring === 1 ? 0 : ring === 2 ? c : s, ring === 0 ? 0 : s)));
    }
  }

  sample(side: number, aspect: number, climb = 0): void {
    const narrow = aspect < .8, lift = narrow ? .23 : .08;
    const low = narrow ? -.42 : -.61, high = .90;
    const angle = THREE.MathUtils.lerp(-.42, .5, side);
    this.back.set(Math.sin(angle), (narrow ? .20 : .02) + climb, Math.cos(angle)).normalize();
    this.right.set(0, 1, 0).cross(this.back).normalize();
    this.up.crossVectors(this.back, this.right);
    this.fov = Math.min(96, THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(76) / 2) / Math.min(1, aspect))));
    const tanY = Math.tan(THREE.MathUtils.degToRad(this.fov) / 2), tanX = tanY * aspect;
    let distance = 300;
    for (const point of this.points) {
      this.relative.copy(point).sub(this.centre);
      const x = this.relative.dot(this.right), y = this.relative.dot(this.up), z = this.relative.dot(this.back);
      distance = Math.max(distance, z + Math.abs(x) / (.88 * tanX),
        (y + high * tanY * z) / ((high - lift) * tanY),
        (-y - low * tanY * z) / ((lift - low) * tanY));
    }
    distance *= 1.025;
    this.target.copy(this.centre).addScaledVector(this.up, -lift * distance * tanY);
    this.position.copy(this.target).addScaledVector(this.back, distance);
  }
}
