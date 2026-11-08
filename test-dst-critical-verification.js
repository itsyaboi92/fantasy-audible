'use strict';
const assert=require('node:assert/strict');
const {scoreDefense}=require('./live-nfl');
const {observations}=require('./defense-store');
const rules={defense:{pointsAllowed0:5,pointsAllowed7to13:3,yardsAllowedUnder100:5,yardsAllowed300to349:0,sack:1,interception:2}};
for(const absent of [null,undefined,'']){
 const r=scoreDefense({stats:{sacks:6,interceptions:1},pointsAllowed:absent,yardsAllowed:null,opponentFound:true},rules);
 assert.equal(r.points,8,'Missing scoreboard/yardage must not earn a shutout or low-yardage bonus');
 assert(r.unsupported.includes('Points allowed'));
 assert(r.unsupported.includes('Yards allowed'));
}
const valid=scoreDefense({stats:{sacks:6,interceptions:1},pointsAllowed:9,yardsAllowed:319,opponentFound:true},rules);
assert.equal(valid.points,11);
assert(valid.breakdown.some(x=>x.label.includes('Points allowed: 9')));
const zero=scoreDefense({stats:{},pointsAllowed:0,yardsAllowed:0,opponentFound:true},rules);
assert.equal(zero.points,10,'Genuine verified zeros still earn both bonuses');
const obs=observations({boxscore:{teams:[]}}, {id:'x',status:'in',teams:[]});
assert.deepEqual(obs,[]);
console.log('PASS: critical D/ST missing vs verified zero, live scoreboard bracket, missing team box score');
