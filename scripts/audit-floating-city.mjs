import assert from 'node:assert/strict';
import * as T from 'three/webgpu';
import {createFloatingIsland} from '../src/scene/floatingIsland.ts';
import {createCityOutskirts,OUTSKIRT_TOWERS} from '../src/scene/cityOutskirts.ts';
import {islandContains} from '../src/scene/islandLayout.ts';
import {CITY_DECK_Y,TOWER_Z} from '../src/scene/constants.ts';
import {SceneTourDirector} from '../src/cinematic/SceneTourDirector.ts';
import {CITADEL_WORLD_SCALE,CITADEL_UPPER_ANCHOR} from '../src/scene/citadelGeometry.ts';
import {createUpperLayout} from '../src/scene/upperEvent.ts';
const island=createFloatingIsland(new T.MeshBasicMaterial()),rock=island.children[0],edges=new Map();let volume=0,triangles=0;
const key=v=>v.toArray().map(n=>n.toFixed(3)).join(',');
const cross=new T.Vector3(),a=new T.Vector3(),b=new T.Vector3(),c=new T.Vector3();
for(const mesh of island.children){const g=mesh.geometry,ps=g.attributes.position,idx=g.index;for(let i=0;i<(idx?.count??ps.count);i+=3){const vs=[a,b,c];for(let j=0;j<3;j++)vs[j].fromBufferAttribute(ps,idx?idx.getX(i+j):i+j);assert(vs.every(v=>v.toArray().every(Number.isFinite)));assert(cross.crossVectors(b.clone().sub(a),c.clone().sub(a)).length()>1e-5,'Degenerate face');volume+=a.dot(cross.crossVectors(b,c))/6;triangles++;for(let j=0;j<3;j++){const edge=[key(vs[j]),key(vs[(j+1)%3])].sort().join('|');edges.set(edge,(edges.get(edge)??0)+1)}}}
assert([...edges.values()].every(n=>n===2),'Paving/rock must form a closed connected shell');assert(volume>0,'Outward winding');
const lots=createCityOutskirts();assert.equal(lots.length,1152);assert.deepEqual(lots,createCityOutskirts());
for(const lot of lots)for(const dx of [-lot.width*.11,lot.width*.11])for(const dz of [-lot.depth*.11,lot.depth*.11])assert(islandContains(lot.x+dx,lot.z+dz),lot.name+' off island');
for(const t of OUTSKIRT_TOWERS)assert(islandContains(t.x,t.z,.025));
const scale=new T.Vector3(...CITADEL_WORLD_SCALE),shift=new T.Vector3(0,CITY_DECK_Y*(1-scale.y),TOWER_Z),crown=new T.Vector3(...CITADEL_UPPER_ANCHOR).add(new T.Vector3(0,CITY_DECK_Y,0)).multiply(scale).add(shift),layout=createUpperLayout(crown),views=[];
for(const aspect of [2560/1268,1.5,390/844]){
 const camera=new T.PerspectiveCamera(58,aspect,.12,4200),director=new SceneTourDirector(camera,layout);
 for(const time of [62,69,76]){
  director.update(time);const range={x:0,minY:Infinity,maxY:-Infinity,maxZ:-Infinity};
  for(const mesh of island.children)for(let i=0;i<mesh.geometry.attributes.position.count;i++){
   const p=a.fromBufferAttribute(mesh.geometry.attributes.position,i).add(new T.Vector3(0,0,TOWER_Z)).project(camera);
   range.x=Math.max(range.x,Math.abs(p.x));range.minY=Math.min(range.minY,p.y);range.maxY=Math.max(range.maxY,p.y);range.maxZ=Math.max(range.maxZ,p.z);
  }
  assert(range.x<.9&&range.minY>(aspect<.8?-.45:-.58)&&range.maxZ<1,JSON.stringify({aspect,time,range}));views.push({aspect,time,range});
 }
}
console.log(JSON.stringify({passed:true,lots:lots.length,towers:OUTSKIRT_TOWERS.length,rockTriangles:rock.geometry.attributes.position.count/3,closedShellTriangles:triangles,volume,views},null,2));
