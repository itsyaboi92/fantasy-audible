'use strict';
const assert=require('node:assert/strict');
const season=Number(process.env.SEASON||2026),week=Number(process.env.WEEK||9);
const url=`https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/players?scoringPeriodId=${week}&view=kona_player_info`;
function inspect(raw){
 const entries=Array.isArray(raw)?raw:raw?.players||[];
 const teams=new Map(),issues=[];
 for(const entry of entries){
  const p=entry.player||entry;
  if(Number(p.defaultPositionId)!==16)continue;
  const id=String(p.proTeamId??''),name=p.fullName||p.name||p.firstName||String(p.id);
  const records=[...(p.stats||[]),...(entry.stats||[])].filter(x=>Number(x.scoringPeriodId)===week);
  const actual=records.filter(x=>Number(x.statSourceId)===0);
  const projected=records.filter(x=>Number(x.statSourceId)===1);
  const vals=actual.filter(x=>Object.hasOwn(x.stats||{},'106')).map(x=>Number(x.stats['106']));
  const unique=[...new Set(vals)];
  if(unique.length>1)issues.push({id,name,issue:'conflicting actual 106',values:unique});
  teams.set(id,{id,name,actualRecords:actual.length,projectedRecords:projected.length,
    actualHas106:vals.length>0,actualFF:unique.length===1?unique[0]:null,
    projectedHas106:projected.some(x=>Object.hasOwn(x.stats||{},'106')),
    actualStatKeys:[...new Set(actual.flatMap(x=>Object.keys(x.stats||{})))].sort((a,b)=>Number(a)-Number(b))});
 }
 return {season,week,entryCount:entries.length,teamCount:teams.size,
  teamsWithActual106:[...teams.values()].filter(t=>t.actualHas106).length,
  teams:[...teams.values()].sort((a,b)=>Number(a.id)-Number(b.id)),issues};
}
async function main(){
 const res=await fetch(url,{headers:{Accept:'application/json','X-Fantasy-Filter':JSON.stringify({players:{limit:1500,offset:0}})},signal:AbortSignal.timeout(25000)});
 if(!res.ok)throw Error(`ESPN Fantasy HTTP ${res.status}`);
 const result=inspect(await res.json());
 console.log(JSON.stringify(result,null,2));
 const cin=result.teams.find(t=>t.id==='4');
 console.log('VERDICT',JSON.stringify({cinActual106:cin?.actualFF??null,
  cinPass:cin?.actualFF===1,coverage:result.teamsWithActual106+'/'+result.teamCount,
  productionReady:cin?.actualFF===1&&result.teamCount===32&&result.teamsWithActual106===32&&!result.issues.length}));
 if(cin?.actualFF!==1)process.exitCode=2;
}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1});
module.exports={inspect};
