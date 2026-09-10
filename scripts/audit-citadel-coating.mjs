import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import { extractExposedBoxFaces } from '../src/scene/crystalCoating.ts';

const box = (min,max,coat=true) => ({ bounds:new THREE.Box3(new THREE.Vector3(...min),new THREE.Vector3(...max)),coat });
const area = faces => faces.reduce((sum,f)=>sum+f.rectangles.reduce((s,r)=>s+(r.right-r.left)*(r.top-r.bottom),0),0);
// Two 10x10x10 blocks touching along a whole face form one 20x10x10 mass:
// 600 units of wall + 200 roof, no buried seam or duplicated coplanar faces.
const joined=[box([0,0,0],[10,10,10]),box([10,0,0],[20,10,10])];
const joinedFaces=extractExposedBoxFaces(joined);
assert.equal(area(joinedFaces),800);assert.equal(joinedFaces.length,5);
assert.deepEqual(extractExposedBoxFaces([...joined].reverse()),joinedFaces,'input order must not shuffle colonies');
const almostCoplanar=[box([0,0,0],[10,0.1+0.2,10]),box([10,0,0],[20,0.3,10])];
assert.equal(extractExposedBoxFaces(almostCoplanar).filter(f=>f.normal.y===1).length,1,
  'floating point scale arithmetic must not duplicate a shared roof');
// A roof with an off-centre upper keep contains an actual hole. The new
// upper walls replace the covered roof area; none of its grid cuts are seeds.
const stepped=[box([0,0,0],[20,10,20]),box([5,10,5],[15,20,15])];
assert.equal(area(extractExposedBoxFaces(stepped)),1600);
const roof=extractExposedBoxFaces(stepped).find(f=>f.normal.y===1&&f.vertices[0].y===10);
assert.equal(roof.rectangles.reduce((s,r)=>s+(r.right-r.left)*(r.top-r.bottom),0),300);
assert.equal(roof.corners.length,4,'hole/grid subdivisions must not add convex frost nuclei');

// The active citadel now uses convex polygonal masonry.
await import('./audit-citadel-polygons.mjs');
