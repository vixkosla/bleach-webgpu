import assert from 'node:assert/strict';
import * as T from 'three/webgpu';
import { writeFile } from 'node:fs/promises';
import { createBlockoutTower } from '../src/scene/worldBlockout.ts';
import { prismPlanes } from '../src/scene/citadelPrisms.ts';

const {group} = createBlockoutTower();
group.updateMatrixWorld(true);
const apertures=group.userData.citadelApertures,meshes=[],ray=new T.Raycaster();
group.traverse(o=>{if(o.isMesh)meshes.push(o);});
// Storey rows (2–8 per keep, between the string courses) raised the count from
// ~80 single-row openings to ~370; the cap still rejects a saturated wall.
assert(apertures.length>=40 && apertures.length<=460,'bay-based galleries must exist without saturating the walls');
const counts={};let probes=0;
for(const a of apertures) {
  counts[a.owner]=(counts[a.owner]??0)+1;
  const center=a.center.clone().applyMatrix4(group.matrixWorld);
  ray.set(center.clone().addScaledVector(a.normal,8),a.normal.clone().negate());
  const hit=ray.intersectObjects(meshes,false)[0];
  assert(hit && Math.abs(hit.distance-(8+a.depth))<.01,`${a.owner}: center must hit the recessed back, not a flat facade or frost`);
  for(const side of [-1,1]) {
    ray.set(center.clone().addScaledVector(a.normal,-.25),a.tangent.clone().multiplyScalar(side));
    const jamb=ray.intersectObjects(meshes,false)[0];
    assert(jamb && Math.abs(jamb.distance-a.width*.5)<.01,'opening needs real inward-facing jambs');
  }
  for(const side of [-1,1]) {
    ray.set(center.clone().addScaledVector(a.normal,-.25),new T.Vector3(0,side,0));
    const reveal=ray.intersectObjects(meshes,false)[0];
    assert(reveal && Math.abs(reveal.distance-a.height*.5)<.01,'opening needs a sill and lintel');
  }
  const origin=center.clone().addScaledVector(a.normal,8).addScaledVector(a.tangent,2);
  const back=center.clone().addScaledVector(a.normal,-a.depth);
  ray.set(origin,back.clone().sub(origin).normalize());
  const oblique=ray.intersectObjects(meshes,false)[0];
  assert(oblique && Math.abs(oblique.distance-origin.distanceTo(back))<.01,'recess must remain open obliquely');
  probes+=6;
}
const coating=group.getObjectByName('blockout-citadel-growth-crystal-coating');
const voids=group.userData.citadelApertureVoids.map(prismPlanes);
const positions=coating.geometry.attributes.position;
let blocked=0;
for(let i=0;i<positions.count;i++) {
  const p=new T.Vector3().fromBufferAttribute(positions,i);
  if(voids.some(planes=>planes.every(plane=>plane.distanceToPoint(p)<-.001)))blocked++;
}
assert.equal(blocked,0,'crystal relief must be clipped away from the gallery openings');
const report={passed:true,apertures:apertures.length,counts,probes,blocked,coatingTriangles:coating.userData.triangles};
console.log(JSON.stringify(report));
if(process.env.CITADEL_REPORT)await writeFile(process.env.CITADEL_REPORT,JSON.stringify(report,null,2));
