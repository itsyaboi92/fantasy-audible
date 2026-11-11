
'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const source=fs.readFileSync(__dirname+'/server.js','utf8');
const a=source.indexOf('let historyReconcileBusy=false;');
const b=source.indexOf('const playerHistoryCache=new Map();',a);
assert(a>0&&b>a);
const fn=source.slice(a,b);
async function run({mode='later',swap=true,ownerChanged=false,complete=true,bye=false}={}){
 const player={id:'espn-1',name:'Replacement',pos:'RB',espnId:'1',nflTeamId:bye?23:14,owner:ownerChanged?'other':'home',scoringMode:mode,points:7};
 const entry={id:player.id,name:player.name,pos:'RB',espnId:'1',nflTeamId:bye?23:14,scoringMode:bye?null:mode,liveScoreStatus:'INJURY_SUBSTITUTION_REQUIRES_EVENT_SCORING',points:7};
 if(bye)player.scoringMode=null;
 const state={scheduleSeason:2026,players:[player],injurySwapHistory:swap?[{week:9,mode:'later',manager:'home',replacementId:'espn-1'}]:[],
 frozenMatchupSchedule:{9:[{}]},weeklyLedger:{9:{matchups:{m:{id:'m',home:'home',away:'away',status:'provisional',homeLineup:[entry],awayLineup:[{id:'x',name:'X',points:2,liveScoreStatus:'UPDATED'}]}}}}};
 let scoreCalls=0;
 const ctx={console:{warn(){},error(e){throw e},log(){}},process:{env:{}},Date,Number,String,Map,Object,
  scoringSyncBusy:false,ensureDraft:()=>({status:'completed'}),
  snapshot:async()=>({state}),liveNFL:{loadWeek:async()=>[{id:'g',status:'final',teams:[{id:14},{id:15}]}],
   teamId:p=>p?.nflTeamId,fetchGame:async()=>({})},
  defenseStore:{ingest:async()=>{},get:async()=>null},
  fantasyDST:{ingestWeek:async()=>{}},
  pool:{},settingsOf:()=>({scoring:{}}),
  authoritativeGameScore:()=>{scoreCalls++;return {points:11,complete}},
  change:async fn=>fn(state,[]),ledgerTotal:xs=>xs.reduce((a,p)=>a+p.points,0)};
 vm.createContext(ctx);
 vm.runInContext(fn,ctx);
 await vm.runInContext('reconcileHistoricalMatchups()',ctx);
 return {state,scoreCalls};
}
(async()=>{
 let r=await run({ownerChanged:true});
 assert.equal(r.scoreCalls,1,'frozen lineup must not require current ownership');
 assert.equal(r.state.weeklyLedger[9].matchups.m.status,'final');
 assert.equal(r.state.weeklyLedger[9].matchups.m.homeScore,11);
 r=await run({mode:'handcuff'});
 assert.equal(r.scoreCalls,0);
 assert.equal(r.state.weeklyLedger[9].matchups.m.status,'provisional');
 r=await run({swap:false});
 assert.equal(r.scoreCalls,0);
 assert.equal(r.state.weeklyLedger[9].matchups.m.status,'provisional');
 r=await run({bye:true});
 assert.equal(r.state.weeklyLedger[9].matchups.m.homeLineup[0].liveScoreStatus,'BYE');
 assert.equal(r.state.weeklyLedger[9].matchups.m.homeLineup[0].points,0);
 assert.equal(r.state.weeklyLedger[9].matchups.m.status,'final');
 r=await run({complete:false});
 assert.equal(r.state.weeklyLedger[9].matchups.m.status,'provisional');
 console.log('PASS: later kickoff replacement, changed owner, handcuff block, missing swap block, incomplete score block');
})().catch(e=>{console.error(e);process.exitCode=1});
