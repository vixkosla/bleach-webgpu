import assert from 'node:assert/strict';
import * as T from 'three/webgpu';
import {FrameFlight} from '../src/cinematic/FrameFlight.ts';
import {SceneTourDirector,SCENE_TOUR_FRAMES} from '../src/cinematic/SceneTourDirector.ts';
import {createBlockoutCity} from '../src/scene/worldBlockout.ts';
import {createUpperLayout} from '../src/scene/upperEvent.ts';
import {CITADEL_WORLD_SCALE,CITADEL_UPPER_ANCHOR} from '../src/scene/citadelGeometry.ts';
import {createRoundedCrescentGeometry} from '../src/scene/upperCrescent.ts';
import {CITY_DECK_Y,TOWER_Z} from '../src/scene/constants.ts';
const scale=new T.Vector3(...CITADEL_WORLD_SCALE),shift=new T.Vector3(0,CITY_DECK_Y*(1-scale.y),TOWER_Z);
const crown=new T.Vector3(...CITADEL_UPPER_ANCHOR).add(new T.Vector3(0,CITY_DECK_Y,0)).multiply(scale).add(shift),layout=createUpperLayout(crown);
const moonPoints=createRoundedCrescentGeometry().getAttribute('position'),moonPoint=new T.Vector3();
const city=createBlockoutCity(),flight=new FrameFlight(city,layout),report=[];
assert.deepEqual(SCENE_TOUR_FRAMES.map(f=>f.time),[0,7,16.5,22,38,54,66]);
for(const aspect of [1.5,390/844]){
 const camera=new T.PerspectiveCamera(60,aspect,.12,4200),dest=camera.clone(),tour=new SceneTourDirector(camera,layout),preview=new SceneTourDirector(dest,layout);
 tour.update(22);const old=camera.position.distanceTo(tour.target);tour.updateFrame(22);assert(Math.abs(camera.position.distanceTo(tour.target)/old-1.16)<1e-8);
 tour.updateFrame(38);let lunarTop=-Infinity,lunarWidth=0;
 for(let i=0;i<moonPoints.count;i++){
  moonPoint.fromBufferAttribute(moonPoints,i).multiplyScalar(layout.radius).applyQuaternion(layout.orientation).add(layout.center).project(camera);
  lunarTop=Math.max(lunarTop,moonPoint.y);lunarWidth=Math.max(lunarWidth,Math.abs(moonPoint.x));
 }
 assert(lunarTop>.875&&lunarTop<.905,'Above Storm moon should meet the upper picture edge with contour clearance');
 assert(lunarWidth<.94,'Above Storm moon must remain inside portrait side edges');
 for(const from of SCENE_TOUR_FRAMES) for(const to of SCENE_TOUR_FRAMES) {
  if(from===to)continue;
  tour.updateFrame(from.time);preview.updateFrame(to.time);
  const start=camera.position.clone(),q=camera.quaternion.clone(),stamp=performance.now();
  flight.start(camera,tour.target,dest,preview.target);const planMs=performance.now()-stamp,bends=flight.bends,length=flight.length;
  flight.sample(0,camera);assert(camera.position.distanceTo(start)<1e-8);assert(camera.quaternion.angleTo(q)<1e-6);
  let maxTurn=0,last=null;
  for(let i=0;i<=400;i++){
   flight.sample(i/400,camera);
   assert(flight.clearance.free(camera.position),`Collision ${aspect} ${from.time}->${to.time} at ${i}: ${camera.position.toArray()}`);
   assert(camera.position.toArray().every(Number.isFinite));
   if(last)maxTurn=Math.max(maxTurn,T.MathUtils.radToDeg(last.angleTo(camera.quaternion)));last=camera.quaternion.clone();
  }
  assert(camera.position.distanceTo(dest.position)<1e-7);assert(camera.quaternion.angleTo(dest.quaternion)<1e-6);assert.equal(camera.fov,dest.fov);
  assert(maxTurn<1,`Sudden turn ${from.time}->${to.time}: ${maxTurn}`);
  // Re-target from the exact displayed pose, even in the middle of a corridor.
  flight.sample(.42,camera);const shown=camera.position.clone(),rotation=camera.quaternion.clone(),aim=flight.target.clone();
  flight.start(camera,aim,dest,preview.target);flight.sample(0,camera);
  assert(camera.position.distanceTo(shown)<1e-7);assert(camera.quaternion.angleTo(rotation)<1e-6);
  report.push({aspect,from:from.time,to:to.time,bends,length,maxTurn,planMs});
 }
}
// A frame can also be requested at any Cinema time or while already travelling.
const camera=new T.PerspectiveCamera(60,1.5,.12,4200),dest=camera.clone(),tour=new SceneTourDirector(camera,layout),preview=new SceneTourDirector(dest,layout);
let entries=0;
for(let t=0;t<66;t+=1.1)for(const to of SCENE_TOUR_FRAMES){
 tour.update(t);preview.updateFrame(to.time);flight.start(camera,tour.target,dest,preview.target);
 for(let j=0;j<=50;j++){flight.sample(j/50,camera);assert(flight.clearance.free(camera.position),`Cinema entry ${t}->${to.time} at ${j}`)}
 flight.sample(.37,camera);const aim=flight.target.clone();preview.updateFrame(22);flight.start(camera,aim,dest,preview.target);
 for(let j=0;j<=50;j++){flight.sample(j/50,camera);assert(flight.clearance.free(camera.position),`Retarget ${t}->${to.time}->22 at ${j}`)}
 entries++;
}
console.log(JSON.stringify({passed:true,frames:7,pairs:report.length,samples:report.length*401,entries,report},null,2));
