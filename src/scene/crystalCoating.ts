import * as THREE from 'three/webgpu';
import Delaunator from 'delaunator';
import type { PrismFace } from './citadelPrisms';

export interface CoatingVolume {
  x: number;
  z: number;
  width: number;
  depth: number;
  bottomY: number;
  height: number;
  rotationY: number;
}

interface SurfaceRectangle { left: number; right: number; bottom: number; top: number }
interface SurfaceCorner { point: THREE.Vector2; axes: [THREE.Vector2, THREE.Vector2] }
interface ExposedSurface {
  vertices: THREE.Vector3[];
  normal: THREE.Vector3;
  rectangles: SurfaceRectangle[];
  corners: SurfaceCorner[];
  boundary: { a: THREE.Vector2; b: THREE.Vector2 }[];
}
interface SurfaceDomain {
  rectangles: SurfaceRectangle[];
  corner: SurfaceCorner;
  maxScale: number;
  boundary: { a: THREE.Vector2; b: THREE.Vector2 }[];
}
export interface CoatingBox { bounds: THREE.Box3; coat?: boolean }
export interface AssemblyColony { score: number; maxScale: number; strength: number }
export interface CoatingAssemblyOptions {
  colonyAt?: (point: THREE.Vector3) => AssemblyColony | null;
  verticalBias?: number;
}

/** Planar boundary of a union of axis-aligned masonry volumes. Grid lines are
 * used only for exact boolean clipping: they never become growth origins. */
export const extractExposedBoxFaces = (boxes: readonly CoatingBox[]): ExposedSurface[] => {
  const directions = [
    [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, -1)],
    [new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, 1)],
    [new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0)],
    [new THREE.Vector3(0, 0, -1), new THREE.Vector3(-1, 0, 0)],
    [new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0)],
  ] as const;
  const faces: ExposedSurface[] = [];
  const uniqueCoordinates = (values: number[]) => values.sort((a,b)=>a-b)
    .filter((value,index,all)=>index===0||value-all[index-1]!>1e-6);
  for (const [normal, u] of directions) {
    const v = normal.clone().cross(u);
    const project = (box: THREE.Box3, axis: THREE.Vector3) => {
      const a=box.min.dot(axis),b=box.max.dot(axis);
      return [Math.min(a,b),Math.max(a,b)] as const;
    };
    const projected = boxes.map(box => {
      const [near, far] = project(box.bounds, normal);
      const [left, right] = project(box.bounds, u), [bottom, top] = project(box.bounds, v);
      return { near, far, left, right, bottom, top, coat: box.coat !== false };
    });
    const planes = uniqueCoordinates(projected.filter(b => b.coat).map(b => b.far));
    for (const plane of planes) {
      const sources = projected.filter(b => b.coat && Math.abs(b.far - plane) < 1e-6);
      const blockers = projected.filter(b => b.near <= plane + 1e-6 && b.far > plane + 1e-6);
      const left = Math.min(...sources.map(b => b.left)), right = Math.max(...sources.map(b => b.right));
      const bottom = Math.min(...sources.map(b => b.bottom)), top = Math.max(...sources.map(b => b.top));
      const cuts = (values: number[], lo: number, hi: number) => uniqueCoordinates(values
        .map(n => THREE.MathUtils.clamp(n, lo, hi)));
      const all = [...sources, ...blockers];
      const xs = cuts(all.flatMap(b => [b.left, b.right]), left, right);
      const ys = cuts(all.flatMap(b => [b.bottom, b.top]), bottom, top);
      const width = xs.length - 1, height = ys.length - 1;
      const occupied = new Set<number>();
      const inside = (x: number, y: number, r: SurfaceRectangle) =>
        x > r.left && x < r.right && y > r.bottom && y < r.top;
      for (let y=0; y<height; y++) for (let x=0; x<width; x++) {
        const a = (xs[x]! + xs[x+1]!) * 0.5, b = (ys[y]! + ys[y+1]!) * 0.5;
        if (sources.some(r => inside(a,b,r)) && !blockers.some(r => inside(a,b,r))) occupied.add(y*width+x);
      }
      while (occupied.size) {
        const first = occupied.values().next().value!;
        const component = new Set<number>([first]), queue = [first]; occupied.delete(first);
        for (let i=0; i<queue.length; i++) {
          const id = queue[i]!, x = id%width, y = Math.floor(id/width);
          for (const [dx,dy] of [[-1,0],[1,0],[0,-1],[0,1]]) {
            const nx=x+dx!, ny=y+dy!, next=ny*width+nx;
            if (nx>=0 && nx<width && ny>=0 && ny<height && occupied.delete(next)) {
              component.add(next); queue.push(next);
            }
          }
        }
        // Merge adjacent cells into rectangles. All sampling still shares one
        // nucleus/field over the complete connected surface, including L faces.
        const rectangles: SurfaceRectangle[] = [];
        for (let y=0; y<height; y++) for (let x=0; x<width; x++) {
          if (!component.has(y*width+x)) continue;
          const start=x;
          while (x+1<width && component.has(y*width+x+1)) x++;
          const previous=rectangles.find(r => r.left===xs[start] && r.right===xs[x+1] && r.top===ys[y]);
          if (previous) previous.top=ys[y+1]!;
          else rectangles.push({ left:xs[start]!,right:xs[x+1]!,bottom:ys[y]!,top:ys[y+1]! });
        }
        const minU=Math.min(...rectangles.map(r=>r.left)), maxU=Math.max(...rectangles.map(r=>r.right));
        const minV=Math.min(...rectangles.map(r=>r.bottom)), maxV=Math.max(...rectangles.map(r=>r.top));
        const boundary: {a:THREE.Vector2;b:THREE.Vector2}[]=[];
        const edge=(ax:number,ay:number,bx:number,by:number)=>boundary.push({
          a:new THREE.Vector2(ax-minU,ay-minV),b:new THREE.Vector2(bx-minU,by-minV)});
        for(const id of component) {
          const x=id%width,y=Math.floor(id/width);
          if(x===0||!component.has(id-1)) edge(xs[x]!,ys[y]!,xs[x]!,ys[y+1]!);
          if(x===width-1||!component.has(id+1)) edge(xs[x+1]!,ys[y]!,xs[x+1]!,ys[y+1]!);
          if(y===0||!component.has(id-width)) edge(xs[x]!,ys[y]!,xs[x+1]!,ys[y]!);
          if(y===height-1||!component.has(id+width)) edge(xs[x]!,ys[y+1]!,xs[x+1]!,ys[y+1]!);
        }
        const corners: SurfaceCorner[]=[];
        for(let y=0;y<=height;y++) for(let x=0;x<=width;x++) {
          const neighbours=[];
          for(const [dx,dy] of [[-1,-1],[0,-1],[0,0],[-1,0]]) {
            const nx=x+dx!,ny=y+dy!;
            if(nx>=0&&nx<width&&ny>=0&&ny<height&&component.has(ny*width+nx)) neighbours.push([dx!,dy!]);
          }
          if(neighbours.length!==1) continue; // Only convex physical corners.
          const [dx,dy]=neighbours[0]!;
          const a=new THREE.Vector2(dx===0?1:-1,0), b=new THREE.Vector2(0,dy===0?1:-1);
          corners.push({point:new THREE.Vector2(xs[x]!-minU,ys[y]!-minV),
            axes:a.cross(b)>0?[a,b]:[b,a]});
        }
        const point=(x:number,y:number)=>normal.clone().multiplyScalar(plane).addScaledVector(u,x).addScaledVector(v,y);
        faces.push({normal:normal.clone(), vertices:[point(minU,minV),point(maxU,minV),point(maxU,maxV),point(minU,maxV)],
          rectangles:rectangles.map(r=>({left:r.left-minU,right:r.right-minU,bottom:r.bottom-minV,top:r.top-minV})),corners,boundary});
      }
    }
  }
  return faces;
};

type FrostKind = 'city' | 'citadel';
type FrostPattern = 'corner-lace' | 'wind-rime' | 'broken-front' | 'citadel-dendrites';
const random = (seed: number): number => THREE.MathUtils.euclideanModulo(
  Math.sin(seed * 127.1 + 311.7) * 43758.5453, 1,
);
// Project palette (not the anime frame's blue-violet): violet, pink and deep
// violet — sultry, a little playful, self-luminous. Broad plateaus carry a pale
// pink-lavender highlight, bevels the violet/orchid/magenta body; troughs fall
// to deep violet through the height shading; the material adds the glow. No
// blue, cyan, mint or warm facets.
// (Hex values are sRGB; THREE.Color converts them to linear, which is what
// the vertex attribute and the audits measure.)
const spectral = [0x8a3fd0, 0x9b3fbe, 0xb04fd8, 0x6c2f9e, 0xc45ad9, 0xd066d0, 0x7d38c4]
  .map(value => new THREE.Color(value));
const white = new THREE.Color(0xf0d9f3);
const pointKey = (p: THREE.Vector3): string => [p.x, p.y, p.z]
  .map(value => Math.round(value * 1000)).join(',');
const cross2 = (a: THREE.Vector2, b: THREE.Vector2, c: THREE.Vector2): number =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

/** Shared ridge/valley vertices, triangulated without scanning every existing
 * triangle for every site on thousands of architectural faces. */
const triangulateRelief = (points: THREE.Vector2[]): Uint32Array =>
  Delaunator.from(points, p => p.x, p => p.y).triangles;

/** Connected, edge-grown mineral relief following actual wall/roof planes. */
export class CrystalCoatingBuilder {
  private readonly positions: number[] = [];
  private readonly colours: number[] = [];
  private strokeCount = 0;
  private crystalCount = 0;
  private groupCount = 0;
  private valleyCount = 0;
  private crystalFootprint = 0;
  private coatedSurfaceArea = 0;
  private wallCount = 0;
  private roofCount = 0;
  private readonly patterns: Record<FrostPattern, number> = {
    'corner-lace': 0, 'wind-rime': 0, 'broken-front': 0, 'citadel-dendrites': 0,
  };

  private readonly layouts: object[] = [];
  private assemblyFaces = 0;
  private assemblyArea = 0;
  private readonly assemblyNuclei: number[][] = [];

  constructor(private readonly kind: FrostKind = 'city', private readonly recordLayout = false) {}

  private triangle(
    a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3,
    colourA: THREE.Color, colourB = colourA, colourC = colourA,
    outward?: THREE.Vector3,
  ): void {
    if (outward && b.clone().sub(a).cross(c.clone().sub(a)).dot(outward) < 0) {
      [b, c] = [c, b];
      [colourB, colourC] = [colourC, colourB];
    }
    this.positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    this.colours.push(...colourA.toArray(), ...colourB.toArray(), ...colourC.toArray());
  }

  /** A single grammar for a rectangular facade, a hip triangle or a gable
   * quad. Work in surface coordinates, not world-up: frost follows the edges
   * when a plane turns from wall to roof. Clip every facet to its real plane. */
  private frostSurface(
    vertices: THREE.Vector3[], normal: THREE.Vector3, seed: number, strength: number,
    domain?: SurfaceDomain,
    colony?: { nucleus: THREE.Vector3; maxScale: number; verticalBias?: number },
  ): void {
    const origin = vertices[0]!;
    const u = vertices[1]!.clone().sub(origin).normalize();
    const v = normal.clone().cross(u).normalize();
    const points = vertices.map(p => {
      const delta = p.clone().sub(origin);
      return new THREE.Vector2(delta.dot(u), delta.dot(v));
    }).sort((a, b) => a.x - b.x || a.y - b.y);
    // Coplanar roof triangles share duplicated vertices. Their convex hull
    // gives the actual slope boundary, with no artificial diagonal frost seam.
    const half = (input: THREE.Vector2[]): THREE.Vector2[] => {
      const result: THREE.Vector2[] = [];
      for (const p of input) {
        while (result.length > 1 && cross2(result[result.length - 2]!, result[result.length - 1]!, p) <= 0.0001) result.pop();
        result.push(p);
      }
      return result;
    };
    const lower = half(points);
    const upper = half([...points].reverse());
    const polygon = [...lower.slice(0, -1), ...upper.slice(0, -1)];
    if (polygon.length < 3) return;
    const centre = polygon.reduce((sum, p) => sum.add(p), new THREE.Vector2()).divideScalar(polygon.length);
    const edges = polygon.map((a, index) => {
      const b = polygon[(index + 1) % polygon.length]!;
      const tangent = b.clone().sub(a).normalize();
      return { a, b, length: a.distanceTo(b), tangent,
        inward: new THREE.Vector2(-tangent.y, tangent.x) };
    });
    const hullArea = Math.abs(polygon.reduce((sum, a, i) => {
      const b = polygon[(i + 1) % polygon.length]!;
      return sum + a.x * b.y - a.y * b.x;
    }, 0)) * 0.5;
    const area = domain ? domain.rectangles.reduce((sum,r)=>sum+(r.right-r.left)*(r.top-r.bottom),0) : hullArea;
    if (area < 3) return;
    const perimeter = edges.reduce((sum, edge) => sum + edge.length, 0);
    const scale = Math.min(hullArea * 4 / perimeter, domain?.maxScale ?? colony?.maxScale ?? Infinity);
    const citadel = this.kind === 'citadel';
    const roof = normal.y > 0.3;
    const pattern: FrostPattern = citadel ? 'citadel-dendrites'
      : (['corner-lace', 'wind-rime', 'broken-front'] as const)[Math.floor(random(seed + 97) * 3)]!;
    this.patterns[pattern] += 1;
    // Every corner of every ribbon remains inside the convex surface.
    const clip = (p: THREE.Vector2): THREE.Vector2 => {
      for (let pass = 0; pass < 3; pass += 1) {
        for (const edge of edges) {
          const distance = p.clone().sub(edge.a).dot(edge.inward);
          if (distance < 0.012) p.addScaledVector(edge.inward, 0.012 - distance);
        }
      }
      if (domain && !domain.rectangles.some(r=>p.x>=r.left&&p.x<=r.right&&p.y>=r.bottom&&p.y<=r.top)) {
        let nearest=p.clone(), distance=Infinity;
        for(const r of domain.rectangles) {
          const q=new THREE.Vector2(THREE.MathUtils.clamp(p.x,r.left+0.014,r.right-0.014),
            THREE.MathUtils.clamp(p.y,r.bottom+0.014,r.top-0.014));
          if(q.distanceToSquared(p)<distance) {distance=q.distanceToSquared(p);nearest=q;}
        }
        p.copy(nearest);
      }
      return p;
    };
    const world = (p: THREE.Vector2, relief = 0): THREE.Vector3 =>
      origin.clone().addScaledVector(u, p.x).addScaledVector(v, p.y)
        .addScaledVector(normal, 0.065 + relief);
    // The old visible needles now only define a growth field. Crystals will
    // occupy its whole width, not simply redraw the branch centre lines.
    const veins: { from: THREE.Vector2; to: THREE.Vector2; startWidth: number; endWidth: number; group: number }[] = [];
    const deposit = (from: THREE.Vector2, to: THREE.Vector2, startWidth: number, endWidth: number, group: number): void => {
      veins.push({ from: clip(from.clone()), to: clip(to.clone()), startWidth, endWidth, group });
      this.strokeCount += 1;
    };

    // A face has ONE nucleus on a real corner. Two ordered fans emerge from
    // its shared diagonal stem, like frost travelling over a glass pane.
    // They use adjacent edge directions (never opposing independent fronts).
    const corners = polygon.map((point, index) => ({ point, index,
      y: world(point).y }));
    const highest = Math.max(...corners.map(corner => corner.y));
    const candidates = roof ? corners : corners.filter(corner => corner.y > highest - 0.02);
    const chosen = colony ? candidates.reduce((best, c) =>
      world(c.point).distanceToSquared(colony.nucleus) < world(best.point).distanceToSquared(colony.nucleus) ? c : best)
      : candidates[Math.floor(random(seed + 47) * candidates.length)]!;
    const corner = domain?.corner.point ?? chosen.point;
    const next = domain?.corner.axes[0] ?? polygon[(chosen.index + 1) % polygon.length]!.clone().sub(corner).normalize();
    const previous = domain?.corner.axes[1] ?? polygon[(chosen.index + polygon.length - 1) % polygon.length]!
      .clone().sub(corner).normalize();
    const wedge = Math.acos(THREE.MathUtils.clamp(next.dot(previous), -1, 1));
    const turn = Math.min(Math.PI / 2, wedge);
    const across = new THREE.Vector2(-next.y, next.x);
    const axes = [next, next.clone().multiplyScalar(Math.cos(turn))
      .addScaledVector(across, Math.sin(turn))];
    const towardCentre = centre.clone().sub(corner);
    const stemAngle = THREE.MathUtils.clamp(
      Math.atan2(towardCentre.dot(across), towardCentre.dot(next)), turn * 0.2, turn * 0.8);
    const stemAxis = next.clone().multiplyScalar(Math.cos(stemAngle))
      .addScaledVector(across, Math.sin(stemAngle));
    const nucleus = clip(corner.clone().addScaledVector(stemAxis, 0.04));
    // Intersect a forward ray with the actual convex outline. Projecting an
    // overshooting tip back onto edges used to rotate individual crystals.
    const reach = (from: THREE.Vector2, direction: THREE.Vector2): number => {
      if(domain) {
        // The first gap in exposed stone stops growth; it cannot leap across
        // a higher tier or restart on the other side of a hidden wall.
        const intervals: [number,number][]=[];
        for(const r of domain.rectangles) {
          let near=0,far=Infinity;
          for(const [value,rate,lo,hi] of [[from.x,direction.x,r.left,r.right],[from.y,direction.y,r.bottom,r.top]]) {
            if(Math.abs(rate!)<1e-8) {if(value!<lo!-1e-6||value!>hi!+1e-6) far=-1;}
            else {const a=(lo!-value!)/rate!,b=(hi!-value!)/rate!;near=Math.max(near,Math.min(a,b));far=Math.min(far,Math.max(a,b));}
          }
          if(far>=near) intervals.push([near,far]);
        }
        intervals.sort((a,b)=>a[0]-b[0]);
        let end=0;
        for(const [near,far] of intervals) {if(near>end+0.001) break;end=Math.max(end,far);}
        return Math.max(0,end-0.014);
      }
      let distance = Infinity;
      for (const edge of edges) {
        const rate = direction.dot(edge.inward);
        if (rate >= -0.000001) continue;
        const clearance = from.clone().sub(edge.a).dot(edge.inward) - 0.014;
        distance = Math.min(distance, Math.max(0, clearance / -rate));
      }
      return Number.isFinite(distance) ? distance : 0;
    };
    // Ordinary city walls freeze the way the reference does: ice creeps along
    // the eave from the top corner, hangs off it as icicles, and a short veil
    // fans diagonally down from the corner. Everything still roots in the one
    // shared stem (the eave rim) inside the same <=90 degree sector.
    const worldRise = (a: THREE.Vector2): number => u.y * a.x + v.y * a.y;
    const eaveAxes = (() => {
      if (citadel || roof || domain || colony) return null;
      const pair = [next, axes[1]!];
      const along = pair.find(a => Math.abs(worldRise(a)) < 0.3);
      const down = pair.find(a => worldRise(a) < -0.7);
      return along && down && along !== down ? { along, down } : null;
    })();
    const grown = THREE.MathUtils.clamp(strength, 0.72, 1);
    if (eaveAxes) {
      const { along, down } = eaveAxes;
      const lean = (theta: number): THREE.Vector2 =>
        along.clone().multiplyScalar(Math.cos(theta)).addScaledVector(down, Math.sin(theta)).normalize();
      const rimLength = Math.min(reach(nucleus, along) * 0.96, scale * 2.2)
        * (0.8 + random(seed + 101) * 0.2) * grown;
      deposit(nucleus, nucleus.clone().addScaledVector(along, rimLength), scale * 0.07, scale * 0.07, 0);
      // Icicles: narrow, tapering, denser and longer near the corner.
      const drips = 6 + Math.floor(random(seed + 211) * 4);
      const dripWidth = rimLength / (drips + 0.3) * 0.42;
      for (let i = 0; i < drips; i += 1) {
        const s = seed + 613 + i * 67;
        const station = ((i + 0.35 + random(s + 3) * 0.3) / drips) ** 1.25;
        const root = nucleus.clone().addScaledVector(along, rimLength * station);
        const direction = lean(Math.PI / 2 - random(s + 29) * 0.28);
        const length = Math.min(reach(root, direction),
          scale * (0.2 + random(s + 31) * 0.5) * (1.2 - station * 0.55) * grown);
        if (length < scale * 0.05) continue;
        const width = dripWidth * (0.8 + random(s + 37) * 0.4);
        deposit(root, root.clone().addScaledVector(direction, length), width, width * 0.55, 1);
      }
      this.groupCount += 1;
      // Veil: two or three broad diagonal blades from the first third of the rim.
      const veils = 2 + Math.floor(random(seed + 307) * 2);
      const veilWidth = rimLength / 7 * 0.9;
      for (let i = 0; i < veils; i += 1) {
        const s = seed + 911 + i * 67;
        const station = (i + 0.4) / veils * 0.4;
        const root = nucleus.clone().addScaledVector(along, rimLength * station);
        const direction = lean(0.62 + random(s + 29) * 0.5);
        const length = Math.min(reach(root, direction), scale * (0.7 + random(s + 31) * 0.5) * (1 - station) * grown);
        if (length < scale * 0.05) continue;
        deposit(root, root.clone().addScaledVector(direction, length), veilWidth, veilWidth, 2);
      }
      this.groupCount += 1;
    }
    const stemLength = Math.min(reach(nucleus, stemAxis) * 0.58, scale * 0.82)
      * (0.88 + random(seed + 101) * 0.12) * grown;
    const count = colony?.verticalBias && !roof ? 9 : citadel ? 7 : roof ? 6 : 5;
    // The stem is part of the same height field, so every blade has a root
    // in existing ice. Nothing nucleates at a random point inside the face.
    if (!eaveAxes) deposit(nucleus, nucleus.clone().addScaledVector(stemAxis, stemLength),
      scale * 0.095, scale * 0.095, 0);
    for (let group = 0; group < (eaveAxes ? 0 : axes.length); group += 1) {
      const axis = axes[group]!;
      const side = new THREE.Vector2(-axis.y, axis.x);
      const transverseSpan = Math.abs(stemAxis.dot(side)) * stemLength;
      const bladeWidth = transverseSpan / (count + 0.3) / 0.70;
      for (let member = 0; member < count; member += 1) {
        const bladeSeed = seed + group * 419 + member * 67;
        const station = (member + 0.45) / (count + 0.15);
        const root = nucleus.clone().addScaledVector(stemAxis, stemLength * station);
        // Both families live in the same <=90 degree sector. Small inward
        // cant preserves natural variation without breaking their edge axes.
        const cant = random(bladeSeed + 29) * 0.035;
        const direction = axis.clone().lerp(stemAxis, cant).normalize();
        const available = reach(root, direction);
        const familyReach = domain || colony ? 0.72 + random(seed + group * 419 + 137) * 0.28 : 1;
        const vertical = Math.abs(u.y * axis.x + v.y * axis.y);
        const edgeReach = colony?.verticalBias && !roof ? 0.48 + vertical * 0.72 : 1;
        const length = Math.min(available, colony ? Math.min(66, scale * 1.65 * familyReach * edgeReach) : domain ? scale * 1.65 * familyReach : Infinity)
          * (0.73 + random(bladeSeed + 31) * 0.22);
        if (length < scale * 0.05) continue;
        const tip = root.clone().addScaledVector(direction, length);
        const width = bladeWidth * (0.94 + random(bladeSeed + 37) * 0.12);
        deposit(root, tip, width / 0.92, width / 0.92, group + 1);
      }
      this.groupCount += 1;
    }

    // Shared low relief fuses neighbouring blades into a dense mineral
    // patch. Wide tops and narrow bevels replace the old tall needle crests.
    const ranges = veins.map((vein, index) => ({ ...vein, index,
      direction: vein.to.clone().sub(vein.from),
      length: vein.from.distanceTo(vein.to),
    })).filter(vein => vein.length > scale * 0.025)
      .map(vein => ({ ...vein,
        phase: random(seed + vein.index * 17),
        mass: THREE.MathUtils.clamp(vein.startWidth / (scale * 0.055), 0.3, 1),
      }));
    if (this.recordLayout) this.layouts.push({
      polygon: polygon.map(p => p.toArray()), origin: origin.toArray(),
      u: u.toArray(), v: v.toArray(), normal: normal.toArray(),
      nucleus: nucleus.toArray(),
      ...(domain ? { exposedRectangles: domain.rectangles, physicalCorner: corner.toArray() } : {}),
      veins: ranges.map(vein => ({ from: vein.from.toArray(), to: vein.to.toArray(),
        width: vein.startWidth, group: vein.group })),
    });
    const maxRelief = Math.min(scale * 0.033, citadel ? 1.1 : 0.52);
    const profileWidth = (vein: typeof ranges[number], t: number): number =>
      vein.startWidth * 0.46 * (1 - THREE.MathUtils.smoothstep(t, 0.74, 1) * 0.98);
    const sampleField = (p: THREE.Vector2): { height: number; owner: number } => {
      let height = 0, owner = -1;
      for (let index = 0; index < ranges.length; index++) {
        const vein = ranges[index]!;
        const dx = p.x - vein.from.x, dy = p.y - vein.from.y;
        const t = THREE.MathUtils.clamp((dx * vein.direction.x + dy * vein.direction.y)
          / (vein.length * vein.length), 0, 1);
        const radius = profileWidth(vein, t);
        const offsetX = p.x - (vein.from.x + vein.direction.x * t);
        const offsetY = p.y - (vein.from.y + vein.direction.y * t);
        const distance = Math.sqrt(offsetX * offsetX + offsetY * offsetY);
        const flank = THREE.MathUtils.clamp((1 - distance / Math.max(radius, 0.01)) / 0.66, 0, 1);
        if (!flank) continue;
        const summit = (0.82 + vein.phase * 0.18)
          * (1 - THREE.MathUtils.smoothstep(t, 0.74, 1) * 0.94);
        const contribution = flank * summit * vein.mass;
        if (contribution > height) { height = contribution; owner = index; }
      }
      // A thin shared root at physical edges lets the relief fold onto the
      // next surface without isolated raised plates floating at the corners.
      let edgeDistance = Infinity;
      if(domain) {
        for(const edge of domain.boundary) {
          const delta=edge.b.clone().sub(edge.a);
          const t=THREE.MathUtils.clamp(p.clone().sub(edge.a).dot(delta)/delta.lengthSq(),0,1);
          edgeDistance=Math.min(edgeDistance,p.distanceTo(edge.a.clone().addScaledVector(delta,t)));
        }
      } else for (const edge of edges) {
        edgeDistance = Math.min(edgeDistance,
          (p.x - edge.a.x) * edge.inward.x + (p.y - edge.a.y) * edge.inward.y);
      }
      return { height: height * THREE.MathUtils.smoothstep(Math.max(0, edgeDistance), 0, Math.min(0.28, scale * 0.025)), owner };
    };
    const field = (p: THREE.Vector2): number => sampleField(p).height;
    const sites: THREE.Vector2[] = [];
    const keys = new Set<string>();
    const maxSites = citadel ? 620 : roof ? 300 : 260;
    const addSite = (p: THREE.Vector2): void => {
      if (sites.length >= maxSites) return;
      p = clip(p.clone());
      const key = `${Math.round(p.x * 1000)},${Math.round(p.y * 1000)}`;
      if (!keys.has(key)) { keys.add(key); sites.push(p); }
    };
    // Sample real boundaries; an invisible roof triangulation diagonal is
    // never allowed to become a growth edge.
    for (const edge of edges) {
      const steps = Math.min(9, Math.max(2, Math.ceil(edge.length / (scale * 0.21))));
      for (let i = 0; i < steps; i += 1) addSite(edge.a.clone().lerp(edge.b, i / steps));
    }
    if(domain) for(const edge of domain.boundary) {addSite(edge.a);addSite(edge.b);}
    // Overlapping broad blades put each other's old "feet" on a neighbouring
    // plateau, not in the trough. Without explicit valley stations Delaunay
    // bridges the whole sheaf with a flat mosaic. Preserve those creases first.
    for (let index = 1; index < ranges.length; index++) {
      const a = ranges[index - 1]!, b = ranges[index]!;
      if (a.group !== b.group) continue;
      const reach = Math.min(a.length, b.length);
      for (const fraction of [0.06, 0.24, 0.6, 0.8]) {
        const ta = reach * fraction / a.length, tb = reach * fraction / b.length;
        const ca = a.from.clone().addScaledVector(a.direction, ta);
        const cb = b.from.clone().addScaledVector(b.direction, tb);
        const ra = profileWidth(a, ta), rb = profileWidth(b, tb);
        if (ca.distanceTo(cb) > (ra + rb) * 1.25) continue;
        const valley = ca.clone().lerp(cb, ra / Math.max(0.001, ra + rb));
        if (field(valley) >= Math.min(field(ca), field(cb)) * 0.9) continue;
        const before = sites.length;
        addSite(valley);
        this.valleyCount += sites.length - before;
      }
    }
    // Spend tip samples on the actual end of the broad plateau. Four
    // near-coincident samples at a tapered point only create tiny slivers.
    for (const vein of ranges) {
      const side = new THREE.Vector2(-vein.direction.y, vein.direction.x).normalize();
      for (const t of [0, 0.30, 0.74, 0.9, 1]) {
        const ridge = vein.from.clone().addScaledVector(vein.direction, t);
        const radius = profileWidth(vein, t);
        // Shared feet touch; paired top samples retain a flattened central
        // face with a long bevel on either side rather than a raised wire.
        for (const across of t === 1 ? [0] : [-1.02, -0.34, 0.34, 1.02]) {
          addSite(ridge.clone().addScaledVector(side, radius * across));
        }
      }
      this.crystalCount += 1;
    }
    const heights = sites.map(field);
    this.coatedSurfaceArea += area;
    const triangulation = triangulateRelief(sites);
    const grazingLight = normal.clone().multiplyScalar(0.6).addScaledVector(u, 0.7)
      .addScaledVector(v, 0.35).normalize();
    // Keep the connected sheet grown from this nucleus. Boundary clipping
    // can leave tiny isolated tip triangles; those are not new frost seeds.
    const patches: { indices: number[]; footprint: number; owner: number }[] = [];
    const parents: number[] = [];
    const neighbours = new Map<number, number>();
    const find = (index: number): number => {
      while (parents[index] !== index) {
        parents[index] = parents[parents[index]!]!;
        index = parents[index]!;
      }
      return index;
    };
    for (let i = 0; i < triangulation.length; i += 3) {
      const indices = [triangulation[i]!, triangulation[i + 1]!, triangulation[i + 2]!];
      const [a, b, c] = indices.map(index => sites[index]!) as [THREE.Vector2, THREE.Vector2, THREE.Vector2];
      const footprint = Math.abs(cross2(a, b, c)) * 0.5;
      const sample = sampleField(a.clone().add(b).add(c).divideScalar(3));
      if (footprint < 0.0001 || Math.max(...indices.map(index => heights[index]!)) < 0.07
        || sample.height < 0.045) continue;
      const index = patches.length;
      patches.push({ indices, footprint, owner: sample.owner });
      parents.push(index);
      for (let edge = 0; edge < 3; edge++) {
        const from = indices[edge]!, to = indices[(edge + 1) % 3]!;
        const key = Math.min(from, to) * sites.length + Math.max(from, to);
        const neighbour = neighbours.get(key);
        if (neighbour !== undefined) parents[find(index)] = find(neighbour);
        else neighbours.set(key, index);
      }
    }
    const areas = new Map<number, number>();
    patches.forEach((patch, index) => {
      const root = find(index);
      areas.set(root, (areas.get(root) ?? 0) + patch.footprint);
    });
    let mainRoot = -1, mainArea = 0;
    for (const [root, footprint] of areas) {
      if (footprint > mainArea) { mainRoot = root; mainArea = footprint; }
    }
    for (let index = 0; index < patches.length; index++) {
      if (find(index) !== mainRoot) continue;
      const { indices, footprint, owner: ownerIndex } = patches[index]!;
      const [a, b, c] = indices.map(index => sites[index]!) as [THREE.Vector2, THREE.Vector2, THREE.Vector2];
      const h = indices.map(index => heights[index]!);
      const owner = ranges[ownerIndex]!;
      const s = seed + owner.index * 113;
      const p = [a, b, c].map((point, index) => world(point, 0.004 + h[index]! * maxRelief));
      const facetNormal = p[1]!.clone().sub(p[0]!).cross(p[2]!.clone().sub(p[0]!)).normalize();
      if (facetNormal.dot(normal) < 0) facetNormal.negate();
      const facetLight = Math.max(0, facetNormal.dot(grazingLight));
      const bevel = facetNormal.dot(normal) < 0.995;
      const side = new THREE.Vector2(-owner.direction.y, owner.direction.x).normalize();
      const sideNormal = u.clone().multiplyScalar(side.x).addScaledVector(v, side.y);
      const flankSeed = s + (facetNormal.dot(sideNormal) > 0 ? 19 : 47);
      const colour = bevel && random(flankSeed) < 0.6
        ? spectral[Math.floor(random(flankSeed + 23) * spectral.length)]!.clone().lerp(white, 0.18)
        : white.clone();
      // Pale tips and violet bevels. Palette follows the crystal/flank, not
      // each triangle. Absolute field height also prevents a colour seam where
      // two coplanar triangles have different local peaks. The body stays
      // bright in the night scene: troughs are a little quieter than plateaus,
      // but never fall back to the stone value.
      const shades = h.map(height => colour.clone().multiplyScalar(
        0.58 + facetLight * 0.14 + height ** 1.3 * 0.26));
      if(!domain) {
        this.triangle(p[0]!, p[1]!, p[2]!, shades[0]!, shades[1]!, shades[2]!, normal);
        this.crystalFootprint += footprint;
      } else {
        // Clip actual triangles, not their centroids, to the union's exposed
        // rectangles. Interpolate relief/colour so boolean grid seams vanish.
        for(const r of domain.rectangles) {
          let clipped=[a,b,c].map((xy,i)=>({xy,position:p[i]!,colour:shades[i]!}));
          for(const [axis,limit,sign] of [[0,r.left,1],[0,r.right,-1],[1,r.bottom,1],[1,r.top,-1]]) {
            const output: typeof clipped=[];
            for(let i=0;i<clipped.length;i++) {
              const start=clipped[i]!,end=clipped[(i+1)%clipped.length]!;
              const sa=(start.xy.getComponent(axis!)-limit!)*sign!,sb=(end.xy.getComponent(axis!)-limit!)*sign!;
              if(sa>=-1e-8) output.push(start);
              if((sa<0)!==(sb<0)) {
                const t=sa/(sa-sb);
                output.push({xy:start.xy.clone().lerp(end.xy,t),position:start.position.clone().lerp(end.position,t),colour:start.colour.clone().lerp(end.colour,t)});
              }
            }
            clipped=output;
          }
          for(let i=1;i<clipped.length-1;i++) {
            const a=clipped[0]!,b=clipped[i]!,c=clipped[i+1]!;
            const area=Math.abs(cross2(a.xy,b.xy,c.xy))*0.5;
            if(area<0.0001) continue;
            this.triangle(a.position,b.position,c.position,a.colour,b.colour,c.colour,normal);
            this.crystalFootprint+=area;
          }
        }
      }
    }
  }

  /** Use the visible boundary of the whole stepped structure. Distribution
   * is measured in rendered units, so a tall presentation scale cannot turn
   * ordinary broad crystals into enormous hanging triangles. */
  addBoxAssembly(boxes: readonly CoatingBox[], metricScale = new THREE.Vector3(1,1,1)): void {
    const metric = boxes.map(box=>({coat:box.coat,bounds:new THREE.Box3(
      box.bounds.min.clone().multiply(metricScale),box.bounds.max.clone().multiply(metricScale))}));
    const surfaces=extractExposedBoxFaces(metric);
    for(const face of surfaces) {
      if(!face.corners.length) continue;
      const origin=face.vertices[0]!,u=face.vertices[1]!.clone().sub(origin).normalize(),v=face.normal.clone().cross(u);
      const point=(corner:SurfaceCorner)=>origin.clone().addScaledVector(u,corner.point.x).addScaledVector(v,corner.point.y);
      const highest=Math.max(...face.corners.map(c=>point(c).y));
      const candidates=face.normal.y>0.3?face.corners:face.corners.filter(c=>point(c).y>highest-0.02);
      // A common exposure direction chooses the same physical top corner on
      // adjacent walls/terraces. This is an authored frost model, not a fluid
      // or thermodynamic simulation; it replaces unrelated per-face lotteries.
      const corner=candidates.reduce((best,c)=> {
        const a=point(best),b=point(c);
        return -b.x*0.73+b.z*0.52 > -a.x*0.73+a.z*0.52 ? c : best;
      });
      const nucleus=point(corner);
      const seed=nucleus.x*3.1+nucleus.y*1.3+nucleus.z*4.7;
      const start=this.positions.length;
      // Colonies sharing a corner also share maturity. Different exposed
      // corners may have shorter/longer fans, without shuffling their axes.
      const maturityScale=28+random(seed+287)*16;
      this.frostSurface(face.vertices,face.normal,seed,0.94,
        {rectangles:face.rectangles,corner,boundary:face.boundary,maxScale:maturityScale});
      for(let i=start;i<this.positions.length;i+=3) {
        this.positions[i]!/=metricScale.x;this.positions[i+1]!/=metricScale.y;this.positions[i+2]!/=metricScale.z;
      }
      this.assemblyFaces++;
      this.assemblyArea+=face.rectangles.reduce((sum,r)=>sum+(r.right-r.left)*(r.top-r.bottom),0);
      this.assemblyNuclei.push(nucleus.toArray());
      if(face.normal.y>0.3) this.roofCount++;else this.wallCount++;
    }
  }

  /** Polygonal citadel only. Work on visible convex fragments after the
   * masonry union, in world-size units. One colony per structural plane keeps
   * boolean cuts from becoming a repeated decorative grid. */
  addPolygonAssembly(
    faces: readonly PrismFace[], metricScale: THREE.Vector3,
    options: CoatingAssemblyOptions,
  ): void {
    const groups = new Map<string, { vertices: THREE.Vector3[]; normal: THREE.Vector3; area: number }[]>();
    for (const face of faces) {
      const vertices = face.vertices.map(v => v.clone().multiply(metricScale));
      const normal = face.normal.clone().divide(metricScale).normalize();
      let area = 0;
      for (let i = 1; i + 1 < vertices.length; i++) area += vertices[i]!.clone().sub(vertices[0]!)
        .cross(vertices[i + 1]!.clone().sub(vertices[0]!)).length() * 0.5;
      this.assemblyFaces++;
      this.assemblyArea += area;
      if (area < 18) continue;
      const key = face.owner + ':' + normal.toArray().map(v => v.toFixed(5)).join(',');
      const group = groups.get(key) ?? [];
      group.push({ vertices, normal, area }); groups.set(key, group);
    }
    for (const fragments of groups.values()) {
      const candidates = fragments.flatMap(face => {
        const highest = Math.max(...face.vertices.map(v => v.y));
        return face.vertices.filter(v => face.normal.y > 0.3 || v.y > highest - 0.02)
          .flatMap(nucleus => {
            const profile = options.colonyAt?.(nucleus);
            return profile ? [{ ...face, nucleus, profile }] : [];
          });
      });
      if (!candidates.length) continue;
      const chosen = candidates.reduce((a, b) =>
        b.profile.score * Math.sqrt(b.area) > a.profile.score * Math.sqrt(a.area) ? b : a);
      const { vertices, normal, nucleus, profile } = chosen;
      const seed = nucleus.x * 3.1 + nucleus.y * 1.3 + nucleus.z * 4.7;
      const start = this.positions.length;
      this.frostSurface(vertices, normal, seed, profile.strength, undefined,
        { nucleus, maxScale: profile.maxScale, verticalBias: options.verticalBias });
      for (let i = start; i < this.positions.length; i += 3) {
        this.positions[i]! /= metricScale.x;
        this.positions[i + 1]! /= metricScale.y;
        this.positions[i + 2]! /= metricScale.z;
      }
      this.assemblyNuclei.push(nucleus.toArray());
      if (normal.y > 0.3) this.roofCount++; else this.wallCount++;
    }
  }

  addWalls(volume: CoatingVolume, seed: number, strength = 0.75): void {
    const h = volume.height;
    if (h < 2.5) return;
    const rotation = new THREE.Matrix4().makeRotationY(volume.rotationY);
    for (let face = 0; face < 4; face += 1) {
      const axisZ = face % 2 === 0;
      const sign = face < 2 ? 1 : -1;
      const span = axisZ ? volume.width : volume.depth;
      if (span < 3.5) continue;
      const normal = new THREE.Vector3(axisZ ? 0 : sign, 0, axisZ ? sign : 0).transformDirection(rotation);
      const point = (along: number, y: number): THREE.Vector3 =>
        new THREE.Vector3(axisZ ? along : sign * volume.width * 0.5,
          y, axisZ ? sign * volume.depth * 0.5 : along)
          .applyMatrix4(rotation).add(new THREE.Vector3(volume.x, volume.bottomY, volume.z));
      this.frostSurface([
        point(-span * 0.5, 0.02), point(span * 0.5, 0.02),
        point(span * 0.5, h), point(-span * 0.5, h),
      ], normal, seed + face * 71, strength);
      this.wallCount += 1;
    }
  }

  /** Recover connected coplanar roof faces from actual instanced geometry.
   * Removing triangulation diagonals prevents the old repeated corner fans. */
  addRoofs(parent: THREE.Group, include: (mesh: THREE.Mesh) => boolean): void {
    this.addMeshSurfaces(parent, include, 'roof');
  }

  /** Authored octagonal halls and freestanding towers use their real faces,
   * not an approximate box that would spill frost across their silhouette. */
  addMeshWalls(parent: THREE.Group, include: (mesh: THREE.Mesh) => boolean): void {
    this.addMeshSurfaces(parent, include, 'wall');
  }

  private addMeshSurfaces(
    parent: THREE.Group, include: (mesh: THREE.Mesh) => boolean, orientation: 'wall' | 'roof',
  ): void {
    parent.updateMatrixWorld(true);
    const inverseParent = parent.matrixWorld.clone().invert();
    parent.traverse(object => {
      if (!(object instanceof THREE.Mesh) || !include(object)) return;
      const position = object.geometry.getAttribute('position');
      const indices = object.geometry.index;
      if (!position) return;
      const instance = new THREE.Matrix4();
      const count = object instanceof THREE.InstancedMesh ? object.count : 1;
      for (let n = 0; n < count; n += 1) {
        if (object instanceof THREE.InstancedMesh) object.getMatrixAt(n, instance);
        else instance.identity();
        const matrix = inverseParent.clone().multiply(object.matrixWorld).multiply(instance);
        const surfaces: { vertices: THREE.Vector3[]; normal: THREE.Vector3; plane: number; keys: Set<string> }[] = [];
        for (let i = 0; i < (indices?.count ?? position.count); i += 3) {
          const corners = [0, 1, 2].map(k => new THREE.Vector3()
            .fromBufferAttribute(position, indices ? indices.getX(i + k) : i + k).applyMatrix4(matrix));
          const [a, b, c] = corners as [THREE.Vector3, THREE.Vector3, THREE.Vector3];
          const normal = b.clone().sub(a).cross(c.clone().sub(a));
          if (normal.lengthSq() < 64) continue;
          normal.normalize();
          if (orientation === 'roof' ? normal.y < 0.3 : Math.abs(normal.y) > 0.15) continue;
          const plane = normal.dot(a);
          const keys = corners.map(pointKey);
          const surface = surfaces.find(item => item.normal.dot(normal) > 0.9999
            && Math.abs(item.plane - plane) < 0.01 && keys.filter(key => item.keys.has(key)).length >= 2);
          if (surface) {
            for (let k = 0; k < 3; k += 1) {
              if (!surface.keys.has(keys[k]!)) surface.vertices.push(corners[k]!);
              surface.keys.add(keys[k]!);
            }
          } else surfaces.push({ vertices: corners, normal, plane, keys: new Set(keys) });
        }
        for (const surface of surfaces) {
          const centre = surface.vertices.reduce((sum, p) => sum.add(p), new THREE.Vector3())
            .divideScalar(surface.vertices.length);
          const seed = centre.x * 3.1 + centre.z * 4.7 + centre.y * 1.3;
          this.frostSurface(surface.vertices, surface.normal, seed, 0.86 + random(seed + 7) * 0.24);
          if (orientation === 'roof') this.roofCount += 1;
          else this.wallCount += 1;
        }
      }
    });
  }

  build(parent: THREE.Group, material: THREE.Material, name: string): void {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(this.colours, 3));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.userData = { kind: this.kind, patternFaces: this.patterns,
      growthSegments: this.strokeCount, crystals: this.crystalCount, growthGroups: this.groupCount,
      valleySamples: this.valleyCount, facetPalette: 'crystal-and-bevel',
      growthOrigin: 'shared-corner-stem', ...(this.recordLayout ? { growthLayout: this.layouts } : {}),
      crystalCoverage: this.crystalFootprint / this.coatedSurfaceArea, wallFaces: this.wallCount,
      roofSurfaces: this.roofCount, triangles: this.positions.length / 9 };
    if(this.assemblyFaces) Object.assign(mesh.userData,{distribution:'exposed-assembly-corners',
      exposedAssemblyFaces:this.assemblyFaces,exposedAssemblyArea:this.assemblyArea,
      assemblyNuclei:this.assemblyNuclei,crystalScaleLimit:44,
      crystalCoverage:this.crystalFootprint/this.assemblyArea});
    parent.add(mesh);
  }
}
