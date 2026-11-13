'use strict';
const assert=require('node:assert/strict');
const t=require('./trade-central');
const now=Date.now();
const games=Array.from({length:16},(_,i)=>({kickoff:new Date(now+86400000).toISOString(),teams:[{id:String(i*2+1)},{id:String(i*2+2)}]}));
const ctx={games};
function setup(n=10){return {s:{week:10,managers:Array.from({length:n},(_,i)=>({id:'m'+i,team:'Team '+i})),players:Array.from({length:n},(_,i)=>({id:'p'+i,name:'Player '+i,owner:'m'+i,slot:'BENCH',pos:'RB',espnId:'espn'+i,nflTeamId:String(i+1)})),settings:{roster:{bench:7,starters:{QB:1,RB:2,WR:2,TE:1,FLEX:1,'D/ST':1,K:1},maximums:{RB:8}}}},accounts:Array.from({length:n},(_,i)=>({manager:'m'+i}))};}
for(const [teams,threshold] of [[4,2],[6,3],[8,4],[10,5],[12,6]]){
  const {s,accounts}=setup(teams);const r=t.propose(s,accounts,'m0',{to:'m1',give:['p0'],receive:['p1']},ctx);
  assert.equal(r.ok,true);const a=t.accept(s,accounts,'m1',r.trade.id,ctx,now);assert.equal(a.trade.vetoThreshold,threshold);
  assert.equal(a.trade.eligibleVoters.length,teams-2);assert.equal(Date.parse(a.trade.deadline)-now,86400000);
  assert.equal(t.vote(s,'m0',r.trade.id,true,now).status,403);
  assert.equal(t.vote(s,'m2',r.trade.id,true,now).ok,true);
  assert.equal(t.vote(s,'m2',r.trade.id,true,now).status,409);
  assert.equal(t.process(s,ctx,now+86400001).changed,1);
  assert.equal(s.trades[0].status,threshold===1?'vetoed':'completed');
  if(threshold>1){assert.equal(s.players[0].owner,'m1');assert.equal(s.players[1].owner,'m0');}
}
{
 const {s,accounts}=setup(8);const r=t.propose(s,accounts,'m0',{to:'m1',give:['p0'],receive:['p1']},ctx);
 t.accept(s,accounts,'m1',r.trade.id,ctx,now);
 for(let i=2;i<=5;i++)t.vote(s,'m'+i,r.trade.id,true,now);
 assert.equal(s.trades[0].status,'vetoed');assert.equal(s.players[0].owner,'m0');
}
{
 const {s,accounts}=setup(8);s.injurySwapHistory=[{week:10,removedId:'p0'}];
 assert.equal(t.propose(s,accounts,'m0',{to:'m1',give:['p0'],receive:['p1']},ctx).status,409);
 s.week=11;assert.equal(t.propose(s,accounts,'m0',{to:'m1',give:['p0'],receive:['p1']},ctx).ok,true);
}
{
 const {s,accounts}=setup(8);const r=t.propose(s,accounts,'m0',{to:'m1',give:['p0'],receive:['p1']},ctx);
 t.accept(s,accounts,'m1',r.trade.id,ctx,now);
 s.players[0].owner='m2';t.process(s,ctx,now+86400001);
 assert.equal(s.trades[0].status,'blocked');assert.equal(s.players[1].owner,'m1');
}
console.log('Trade Central: thresholds, voting, veto, roster locks, deadline and ownership regression passed');
