import assert from 'node:assert/strict';
import {finaleFlowTime} from '../src/cinematic/FinaleFlow.ts';

for(const time of [-1,0,22,38,54,60])assert.equal(finaleFlowTime(time),0);
assert.equal(finaleFlowTime(66),3);
assert.equal(finaleFlowTime(66,15),18);
assert.equal(finaleFlowTime(54,15),0,'Held finale cannot leak into earlier shots');
for(const t of [NaN,Infinity,-Infinity])assert.equal(finaleFlowTime(t),0);
assert.equal(finaleFlowTime(66,NaN),3);
let previous=0;
for(let i=0;i<=3600;i++){
 const t=i*.05,flow=finaleFlowTime(t);
 assert(Number.isFinite(flow)&&flow>=previous);
 assert(flow-previous<=.050001,'Velocity never jumps above the steady current');
 previous=flow;
}
const epsilon=.0001;
assert(finaleFlowTime(60+epsilon)<1e-10,'Velocity starts continuously');
assert(Math.abs((finaleFlowTime(66)-finaleFlowTime(66-epsilon))/epsilon-1)<1e-7);
for(const t of [60.2,64,66,90]){
 const a=finaleFlowTime(t);finaleFlowTime(125);assert.equal(finaleFlowTime(t),a);
}
console.log({passed:true,samples:3601,startsAt:60,steadyAt:66,heldFinale:true});
