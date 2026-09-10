import assert from 'node:assert/strict';
import * as T from 'three/webgpu';
import { writeFile } from 'node:fs/promises';
import { addCitadelGeometry,createCitadelPrisms,CITADEL_WORLD_SCALE } from '../src/scene/citadelGeometry.ts';
import { octagonalPlan,prismContains,prismPlanes,exposedPrismFaces,polygonArea,prismSurfaceGeometry } from '../src/scene/citadelPrisms.ts';
import { CrystalCoatingBuilder } from '../src/scene/crystalCoating.ts';
import { createCitadelCoatingOptions,clipCitadelCoating } from '../src/scene/citadelGrowth.ts';
const make=(name,x,z,w,d,bottom,top,cut=0)=>({name,plan:octagonalPlan(x,z,w,d,cut).filter((v,i,a)=>v.distanceTo(a[(i+1)%a.length])>1e-6),bottom,top});
const area=ps=>exposedPrismFaces(ps).reduce((s,f)=>s+polygonArea(f.vertices),0);
assert(Math.abs(area([make('a',5,5,10,10,0,10),make('b',15,5,10,10,0,10)])-800)<.01,'joined boxes lose the internal face');
assert(Math.abs(area([make('a',10,10,20,20,0,10),make('b',10,10,10,10,10,20)])-1600)<.02,'covered terrace is subtracted');
const prisms=createCitadelPrisms(72),faces=exposedPrismFaces(prisms);
assert.deepEqual(exposedPrismFaces([...prisms].reverse()),faces,'stable source order');
assert(prisms.every(p=>p.plan.length===8),'all compound masses use structural diagonal walls');
const areaFaces=faces.reduce((s,f)=>s+polygonArea(f.vertices),0);
const overlaps=(a,b)=> {
 if(a.top<b.bottom-.001||b.top<a.bottom-.001)return false;
 for(const p of [a,b])for(let i=0;i<p.plan.length;i++) {
  const d=p.plan[(i+1)%p.plan.length].clone().sub(p.plan[i]),n=new T.Vector2(d.y,-d.x).normalize();
  const aa=a.plan.map(v=>v.dot(n)),bb=b.plan.map(v=>v.dot(n));
  if(Math.min(...aa)>=Math.max(...bb)-.01||Math.min(...bb)>=Math.max(...aa)-.01)return false;
 }
 return true;
};
const reached=new Set([0]);for(let changed=true;changed;){changed=false;for(let i=0;i<prisms.length;i++)if(!reached.has(i)&&[...reached].some(j=>overlaps(prisms[i],prisms[j]))){reached.add(i);changed=true;}}
assert.equal(reached.size,prisms.length,'exact polygon footprints are connected');
for(const f of faces){
 assert(f.vertices.length>=3&&polygonArea(f.vertices)>.001);
 const c=f.vertices.reduce((s,v)=>s.add(v),new T.Vector3()).divideScalar(f.vertices.length);
 assert(!prisms.some(p=>prismContains(p,c.clone().addScaledVector(f.normal,.02),-.0001)),'union contains a buried face');
 assert(prisms.some(p=>prismContains(p,c.clone().addScaledVector(f.normal,-.02),.0001)),'surface has no supporting masonry');
}
const root=new T.Group(),mat=new T.MeshBasicMaterial();addCitadelGeometry(root,mat,new T.LineBasicMaterial(),72);
const scale=new T.Vector3(...CITADEL_WORLD_SCALE);
const build=()=>{const g=new T.Group(),b=new CrystalCoatingBuilder('citadel',true);b.addPolygonAssembly(faces,scale,createCitadelCoatingOptions(CITADEL_WORLD_SCALE,72));b.build(g,mat,'frost');clipCitadelCoating(g.children[0],prisms);return g.children[0];};
const frost=build(),repeat=build();assert.deepEqual(frost.geometry.attributes.position.array,repeat.geometry.attributes.position.array);
const pos=frost.geometry.attributes.position;assert(pos.array.every(Number.isFinite));
assert(pos.count>1000&&frost.userData.triangles<80000,'bounded detailed coating');
assert(frost.userData.crystalCoverage>.04&&frost.userData.crystalCoverage<.3,'broad open masonry remains');
const cached=prisms.map(p=>({p,planes:prismPlanes(p)}));
let buried=0;const examples=[];
for(let i=0;i<pos.count;i++) {
 const p=new T.Vector3().fromBufferAttribute(pos,i);
 const blocker=cached.find(b=>b.planes.every(plane=>plane.distanceToPoint(p)<-.005));
 if(blocker){buried++;if(examples.length<4)examples.push([p.toArray(),blocker.p.name]);}
}
console.log(JSON.stringify({buried,examples}));
assert.equal(buried,0,'frost vertices must not enter adjacent masonry');
// Rays across the real union must match occupied intervals, including diagonals.
const mesh=new T.Mesh(prismSurfaceGeometry(faces),mat);mesh.updateMatrixWorld();
const ray=new T.Raycaster();let rays=0;
for(const y of [90,155,238,320,385])for(let x=-220;x<=220;x+=17){
 ray.set(new T.Vector3(x,y,250),new T.Vector3(0,0,-1));
 const hits=ray.intersectObject(mesh);const expected=[];
 for(const z of Array.from({length:280},(_,i)=>140-i))if(prisms.some(p=>prismContains(p,new T.Vector3(x,y,z),-.002)))expected.push(z);
 if(expected.length){assert(hits.length,'visible union surface missing');assert(Math.abs(hits[0].point.z-Math.max(...expected))<1.1,'incorrect front boundary');}
 rays++;
}
const {growthLayout,assemblyNuclei,...coating}=frost.userData;
const report={passed:true,prisms:prisms.length,connected:reached.size,exposedFaces:faces.length,areaFaces,coating,buried,rays};
console.log(JSON.stringify(report));
if(process.env.CITADEL_REPORT)await writeFile(process.env.CITADEL_REPORT,JSON.stringify(report,null,2));
