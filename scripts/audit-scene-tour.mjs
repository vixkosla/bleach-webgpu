import assert from 'node:assert/strict';
import * as T from 'three/webgpu';
import {SceneTourDirector, SCENE_TOUR_DURATION, SCENE_STORY_CUTS} from '../src/cinematic/SceneTourDirector.ts';
import {SCENE_STORY_INTRO} from '../src/cinematic/SceneStoryState.ts';
import {createUpperInspectionPreset} from '../src/cinematic/upperInspection.ts';
import {ScenePacing} from '../src/cinematic/ScenePacing.ts';
import {MatterStoryState,writeMatterGrowth} from '../src/cinematic/MatterStoryState.ts';
import {createUpperLayout} from '../src/scene/upperEvent.ts';
import {CITADEL_WORLD_SCALE,createCitadelPrisms,CITADEL_UPPER_ANCHOR} from '../src/scene/citadelGeometry.ts';
import {prismContains} from '../src/scene/citadelPrisms.ts';
import {createBlockoutCity} from '../src/scene/worldBlockout.ts';
import {CITY_DECK_Y,TOWER_Z} from '../src/scene/constants.ts';
import {islandContains} from '../src/scene/islandLayout.ts';
const scale=new T.Vector3(...CITADEL_WORLD_SCALE),shift=new T.Vector3(0,CITY_DECK_Y*(1-scale.y),TOWER_Z);
const crown=new T.Vector3(...CITADEL_UPPER_ANCHOR).add(new T.Vector3(0,CITY_DECK_Y,0)).multiply(scale).add(shift),layout=createUpperLayout(crown);
assert.equal(SCENE_STORY_CUTS.length, 0, 'The entire film is one take');
const city=createBlockoutCity(),boxes=[];city.updateMatrixWorld(true);
city.traverse(o=>{if(!o.isMesh||o.geometry.type!=='BoxGeometry'||/window|slit|glazing/.test(o.name))return;o.geometry.computeBoundingBox();const n=o.isInstancedMesh?o.count:1,instance=new T.Matrix4();for(let i=0;i<n;i++){if(o.isInstancedMesh)o.getMatrixAt(i,instance);else instance.identity();const matrix=o.matrixWorld.clone().multiply(instance);if(Math.abs(matrix.determinant())<1e-8)continue;boxes.push({name:o.name,bounds:o.geometry.boundingBox.clone(),inverse:matrix.invert()})}});
const masonry=createCitadelPrisms(CITY_DECK_Y),report=[];const local=new T.Vector3();
const aspects=[1.5,390/844,768/1024,1024/768];
for(const aspect of aspects){
 const camera=new T.PerspectiveCamera(60,aspect,.12,4200),d=new SceneTourDirector(camera,layout);let minMoon=Infinity,maxSpeed=0,maxTurn=0;let previous=null;
 for(let i=0;i<=SCENE_TOUR_DURATION*20;i++){
  const time=i*.05, storyTime=time-SCENE_STORY_INTRO;d.update(time);assert(camera.position.toArray().every(Number.isFinite));assert(Number.isFinite(camera.fov));
  minMoon=Math.min(minMoon,camera.position.distanceTo(layout.center));
  if(storyTime<=4.6) { assert.equal(d.state.presence,0); assert.equal(d.state.illumination,0); assert.equal(d.state.weather,0); assert.equal(d.state.cloudOpacity,0); }
  if(storyTime>=27) { assert.equal(d.state.presence,1); assert.equal(d.state.illumination,1); assert.equal(d.state.weather,1); assert(d.state.cloudOpacity>=.9); }
  if(time>=14 && time<=28){
   const growth=new T.Vector3();writeMatterGrowth(new MatterStoryState().update(time),growth);
   const center=layout.center.clone().add(new T.Vector3(.25*growth.x,growth.y-1,0).multiplyScalar(layout.radius));
   center.project(camera);assert(Math.abs(center.x)<.72&&Math.abs(center.y)<.72&&center.z<1,`Growing source must be framed at ${time}: ${center.toArray()}`);
   if(aspect<1.35&&time>=14.5)for(let k=0;k<8;k++){
    const p=new T.Vector3((k&1?1:-1)*growth.x,(k&2?1:-1)*growth.y+growth.y-1,(k&4?.3:-.3)*growth.z).multiplyScalar(layout.radius).add(layout.center).project(camera);
    assert(Math.abs(p.x)<.97&&Math.abs(p.y)<.97,`Responsive body clipped at ${time}, aspect${aspect}: ${p.toArray()}`);
   }
  }
  assert(Object.values(d.state).every(Number.isFinite));
  if(time<.6){const top=crown.clone().project(camera);assert(Math.abs(top.x)<.95&&Math.abs(top.y)<.95,'Opening castle must be framed')}
  // Architecture owns the low response and terrace shots. The following
  // tilt deliberately leaves masonry to transfer attention to the sky.
  if((storyTime>=8.8 && storyTime<=10.5) || (storyTime>=17 && storyTime<=20.5)){
   const top=crown.clone().add(new T.Vector3(0,6,0)).project(camera);
   assert(Math.abs(top.x)<.95&&Math.abs(top.y)<.95,`Citadel crown clipped at ${time}: ${top.toArray()}`);
  }
  // The right-side citadel approach regains the complete moon at52s;
  // keep that silhouette through the saved main shot and island reveal.
  if(storyTime>=33 && (time<=48 || time>=52)){
   for(let ring=0;ring<3;ring++)for(let j=0;j<32;j++){
    const angle=j/32*Math.PI*2,point=layout.center.clone();
    if(ring===0)point.add(new T.Vector3(Math.cos(angle)*layout.radius,Math.sin(angle)*layout.radius,0));
    if(ring===1)point.add(new T.Vector3(Math.cos(angle)*layout.radius,0,Math.sin(angle)*layout.radius));
    if(ring===2)point.add(new T.Vector3(0,Math.cos(angle)*layout.radius,Math.sin(angle)*layout.radius));
    point.project(camera);assert(Math.abs(point.x)<.97&&Math.abs(point.y)<.97,`Lunar reveal clipped at ${time}`);
   }
  }
  local.copy(camera.position).sub(shift).divide(scale);assert(!masonry.some(p=>prismContains(p,local,-.2)),`Camera enters citadel at ${time}`);
  if(camera.position.y<CITY_DECK_Y+3)assert(!islandContains(camera.position.x,camera.position.z-TOWER_Z,-.04),`Camera enters rocky coast at ${time}`);
  assert(d.motionSmear>=0&&d.motionSmear<=.101,'Cinema shutter remains restrained');
  for(const box of boxes){local.copy(camera.position).applyMatrix4(box.inverse);assert(!box.bounds.containsPoint(local),`Camera enters ${box.name} at ${time}`)}
  if(previous){maxSpeed=Math.max(maxSpeed,camera.position.distanceTo(previous.p)/.05);maxTurn=Math.max(maxTurn,T.MathUtils.radToDeg(camera.quaternion.angleTo(previous.q))/.05)}
  previous={p:camera.position.clone(),q:camera.quaternion.clone()};
 }
 assert(minMoon>230);assert(maxSpeed<350, `Continuous camera speed ${maxSpeed}`);assert(maxTurn<185, `Turn too abrupt: ${maxTurn}`);
 const home=createUpperInspectionPreset(layout,aspect);d.update(54);
 assert(camera.position.distanceTo(new T.Vector3(...home.position))<.0001,'Frame54 must use the saved main-page camera');
 assert(d.target.distanceTo(new T.Vector3(...home.target))<.0001,'Frame54 must retain the saved right-side aim');
 assert(Math.abs(camera.fov-home.fov)<.001,'Frame54 must retain the saved lens');
 for(const time of [62,64,66]){
  d.update(time);
  for(const prism of masonry)for(const v of prism.plan)for(const y of [prism.bottom,prism.top]){
   const point=new T.Vector3(v.x,y,v.y).multiply(scale).add(shift).project(camera);
   assert(Math.abs(point.x)<.86 && point.y<( .85 ) && point.y>(aspect<.8?-.43:-.57),`Full citadel/UI fit failed at ${time}: ${point.toArray()}`);
  }
 }
 d.update(SCENE_TOUR_DURATION);const end=camera.position.clone();d.update(SCENE_TOUR_DURATION-.01);const endSpeed=end.distanceTo(camera.position)/.01;assert(endSpeed<1,'Final frame should settle');
 for(const t of [0,5,7,8.8,11.2,18.5,19.8,23,27,32]){d.update(t);const expected=camera.matrixWorld.clone(), state={...d.state};d.update(17.13);d.update(t);assert.deepEqual(camera.matrixWorld.elements,expected.elements,'Seeking must reproduce the same camera');assert.deepEqual({...d.state},state,'Reverse seek must restore sky/light/advection')}
 report.push({aspect,minMoon,maxSpeed,maxTurn,endSpeed});
}
const pacing=new ScenePacing();let last=-1,minRate=Infinity,maxRate=0;
for(let i=0;i<=3600;i++){
 const film=i/100,story=pacing.storyAt(film),rate=pacing.rateAt(film);
 assert(story>last&&story>=0&&story<=66,'Cinema pacing must advance without cuts or reversals');last=story;
 assert(Math.abs(pacing.filmAt(story)-film)<.00001,'Scrubbing must invert the Cinema clock');
 assert(rate>1&&rate<4.5);minRate=Math.min(minRate,rate);maxRate=Math.max(maxRate,rate);
}
assert.equal(pacing.storyAt(29),54,'Saved right-side frame lands at29film seconds');
assert.equal(pacing.storyAt(36),66);assert.equal(pacing.duration,36);
assert(pacing.rateAt(21)>pacing.rateAt(24.5)*2.5,'Repeated moon angles should rush into the slower hero view');
console.log(JSON.stringify({passed:true,cityBoxes:boxes.length,samples:(SCENE_TOUR_DURATION*20+1)*aspects.length,report,pacing:{duration:pacing.duration,minRate,maxRate}},null,2));
