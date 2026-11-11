'use strict';
const assert=require('assert'),fs=require('fs'),vm=require('vm');
const source=fs.readFileSync(__dirname+'/live-nfl.js','utf8');
const start=source.indexOf('const byeScheduleCache=new Map();');
const end=source.indexOf('async function fetchGame(id){',start);
assert(start>0&&end>start);
let weeks=Array.from({length:18},(_,i)=>i+1).filter(w=>w!==9);
const context={Map,Set,String,Number,Object,encodeURIComponent,BASE:'https://mock',TEAM_IDS:{PIT:'23'},json:async()=>({events:weeks.map(w=>({week:{number:w}}))})};
vm.createContext(context);vm.runInContext(source.slice(start,end),context);
(async()=>{
 assert.equal(await vm.runInContext('verifyTeamBye(2026,9,"23")',context),true);
 assert.equal(await vm.runInContext('verifyTeamBye(2026,8,"23")',context),false);
 assert.equal(await vm.runInContext('verifyTeamBye(2026,9,"0")',context),false);
 const partial={...context,json:async()=>({events:[{week:{number:1}}]})};
 vm.createContext(partial);vm.runInContext(source.slice(start,end),partial);
 assert.equal(await vm.runInContext('verifyTeamBye(2026,9,"23")',partial),false);
 console.log('PASS: independent 17-game schedule, playing week, unknown ID, partial schedule');
})().catch(e=>{console.error(e);process.exitCode=1});
