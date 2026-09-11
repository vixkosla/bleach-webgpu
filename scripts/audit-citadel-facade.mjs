import assert from 'node:assert/strict';
import * as T from 'three/webgpu';
import { writeFile } from 'node:fs/promises';
import { createBlockoutTower } from '../src/scene/worldBlockout.ts';
import { prismPlanes, polygonArea } from '../src/scene/citadelPrisms.ts';

const {group} = createBlockoutTower();
group.updateMatrixWorld(true);
const apertures=group.userData.citadelApertures,meshes=[],ray=new T.Raycaster();
group.traverse(o=>{if(o.isMesh)meshes.push(o);});
// The original leaves monumental blank walls between small crest galleries.
const windows=apertures.filter(a=>a.kind==='window');
assert(windows.length>=40 && windows.length<=100,'individual openings must stay sparse');
const wallArea=group.userData.citadelExposedFaces.filter(f=>Math.abs(f.normal.y)<.1).reduce((sum,f)=>sum+polygonArea(f.vertices),0);
const openingArea=windows.reduce((sum,a)=>sum+a.width*a.height,0);
assert(openingArea/wallArea<.02,'windows must not turn the monumental walls into domestic storeys');
assert(windows.every(a=>a.height<=2 && a.width<=1 && a.height/a.width<=2.2),'windows must stay small without elongated stripe proportions');
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
  for (const side of [-1,1]) {
    const origin=center.clone().addScaledVector(a.normal,8).addScaledVector(a.tangent,side*2);
    const back=center.clone().addScaledVector(a.normal,-a.depth);
    ray.set(origin,back.clone().sub(origin).normalize());
    const oblique=ray.intersectObjects(meshes,false)[0];
    assert(oblique && Math.abs(oblique.distance-origin.distanceTo(back))<.01,`${a.owner} ${a.center.toArray()}: oblique recess blocked by ${oblique?.object.name}, distance ${oblique?.distance}, expected ${origin.distanceTo(back)}`);
  }
  probes+=7;
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
const report={passed:true,apertures:apertures.length,windowAreaRatio:openingArea/wallArea,windowHeightRange:[Math.min(...windows.map(a=>a.height)),Math.max(...windows.map(a=>a.height))],counts,probes,blocked,coatingTriangles:coating.userData.triangles};
console.log(JSON.stringify(report));
if(process.env.CITADEL_REPORT)await writeFile(process.env.CITADEL_REPORT,JSON.stringify(report,null,2));
