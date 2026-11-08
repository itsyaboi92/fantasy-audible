'use strict';
const assert=require('node:assert/strict');
const {scoreDefense}=require('./live-nfl');
const store=require('./defense-store');
const rules={defense:{sack:1,interception:2,forcedFumble:1,fumbleRecovered:1,safety:2,blockedKick:2,interceptionTD:6,fumbleReturnTD:6,kickoffReturnTD:6,puntReturnTD:6,twoPointReturn:2,onePointSafety:1,pointsAllowed0:5,pointsAllowed7to13:3,yardsAllowedUnder100:5,yardsAllowed100to199:3}};
for(const category of ['sacks','interceptions','forcedFumble','fumbleRecovered','safety','blockedKick','interceptionTD','fumbleReturnTD','kickoffReturnTD','puntReturnTD','twoPointReturn','onePointSafety']){
 const r=scoreDefense({stats:{[category]:1},pointsAllowed:null,yardsAllowed:null,opponentFound:true},rules);
 assert(r.breakdown.some(x=>x.quantity===1&&x.points===rules.defense[category==='sacks'?'sack':category==='interceptions'?'interception':category]),category);
}
for(const v of [null,undefined,'']){
 const r=scoreDefense({stats:{},pointsAllowed:v,yardsAllowed:v,opponentFound:true},rules);
 assert.equal(r.points,0);assert(r.unsupported.includes('Points allowed'));assert(r.unsupported.includes('Yards allowed'));
}
const live=scoreDefense({stats:{sacks:7,interceptions:1},pointsAllowed:9,yardsAllowed:174,opponentFound:true},rules);
assert.equal(live.points,15);
const calls=[];
const pool={query:async(sql,args)=>{calls.push({sql,args});return {rows:[]}}};
(async()=>{
 await store.ingestFantasyForcedFumble(pool,2026,{id:'game',status:'playing'},'34',0,false);
 assert(calls.some(x=>x.sql.includes('DO UPDATE SET')&&x.sql.includes('EXCLUDED.verified')));
 console.log('PASS D/ST category scoring, missing values, Texans live score, forced-fumble persistence');
})().catch(e=>{console.error(e);process.exitCode=1});
