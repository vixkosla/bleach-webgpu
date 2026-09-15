import assert from 'node:assert/strict';
import {FrameTransition} from '../src/cinematic/FrameTransition.ts';
import {SCENE_TOUR_FRAMES, SCENE_TOUR_DURATION} from '../src/cinematic/SceneTourDirector.ts';
const travel=new FrameTransition();let cases=0;
for(const fps of [20,30,60])for(const direction of [1,-1]){
 const from=direction>0?0:SCENE_TOUR_DURATION,to=direction>0?SCENE_TOUR_DURATION:0;
 travel.start(from,to);let previous=from,peak=0,elapsed=0,trailTime=0;
 while(travel.active){const time=travel.update(1/fps);elapsed+=1/fps;assert(Number.isFinite(time));assert((time-previous)*direction>=0);assert(time>=0&&time<=SCENE_TOUR_DURATION);peak=Math.max(peak,travel.amount);if(travel.amount>.8)trailTime+=1/fps;assert((travel.lookAheadTime-time)*direction>=0);assert(travel.lookAheadTime>=0&&travel.lookAheadTime<=SCENE_TOUR_DURATION);previous=time}
 assert.equal(travel.time,to);assert.equal(travel.amount,0);assert(peak>.95);assert(elapsed>=1.6-1e-6&&elapsed<1.7);assert(trailTime>.8);assert.equal(travel.push,0);cases++;
}
travel.start(0,48);travel.update(.1);const shown=travel.time;travel.start(shown,7);assert.equal(travel.time,shown);while(travel.active)travel.update(.05);assert.equal(travel.time,7);cases++;
travel.start(7,38,true);assert.equal(travel.time,38);assert(!travel.active&&travel.amount===0);cases++;
travel.start(38,7);travel.update(.1);travel.cancel();assert(!travel.active&&travel.amount===0);cases++;
travel.start(7,38,false,.8);assert.equal(travel.amount,.8);travel.update(.01);assert(travel.amount>=.8);cases++;
assert(SCENE_TOUR_FRAMES.every((f,i,a)=>f.time>=0&&f.time<=SCENE_TOUR_DURATION&&(!i||f.time>a[i-1].time)));
travel.start(16.5,22);assert(travel.duration>1.2&&travel.duration<1.25);travel.update(.1);const incomingPush=.62;travel.start(travel.time,38,false,.87,incomingPush);assert.equal(travel.amount,.87);assert.equal(travel.push,incomingPush);cases++;
// The runtime uses corridor distance, not the story-time fallback above.
for(const distance of [80,1100,3000])for(const fps of [20,30,60])for(const direction of [1,-1]){
 const from=direction>0?7:66,to=direction>0?66:7;
 travel.start(from,to,false,0,0,distance);
 const expected=(1.65+Math.min(1.35,distance/1100))/2;
 assert.equal(travel.duration,expected);assert(travel.duration>=.825&&travel.duration<=1.5);
 let elapsed=0,previous=from,peak=0;
 while(travel.active){const time=travel.update(1/fps);elapsed+=1/fps;assert((time-previous)*direction>=0);previous=time;peak=Math.max(peak,travel.amount);}
 assert.equal(travel.time,to);assert(elapsed>=expected-1e-6&&elapsed<=expected+1/fps+1e-6);
 assert(peak>.95);assert.equal(travel.amount,0);assert.equal(travel.push,0);cases++;
}
travel.start(7,38,true,0,0,3000);assert.equal(travel.duration,0);assert.equal(travel.time,38);assert(!travel.active);cases++;
console.log(JSON.stringify({passed:true,cases,frames:SCENE_TOUR_FRAMES.length}));
