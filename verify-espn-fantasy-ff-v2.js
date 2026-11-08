'use strict';
const season=Number(process.env.SEASON||2026),week=Number(process.env.WEEK||9);
const url=`https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/players?scoringPeriodId=${week}&view=kona_player_info`;
function inspect(raw){
 const entries=Array.isArray(raw)?raw:raw?.players||[];
 const output=[];
 for(const entry of entries){
  const p=entry.player||entry;
  if(Number(p.defaultPositionId)!==16)continue;
  const records=[...(Array.isArray(p.stats)?p.stats:[]),...(Array.isArray(entry.stats)?entry.stats:[])];
  const seen=new Set(),actual=[];
  for(const r of records){
   if(Number(r.statSourceId)!==0)continue;
   const key=JSON.stringify([r.seasonId,r.scoringPeriodId,r.statSplitTypeId,r.statSourceId,r.stats]);
   if(seen.has(key))continue;seen.add(key);
   actual.push({seasonId:r.seasonId??null,scoringPeriodId:r.scoringPeriodId??null,statSplitTypeId:r.statSplitTypeId??null,
    appliedTotal:r.appliedTotal??null,forcedFumble:Object.hasOwn(r.stats||{},'106')?r.stats['106']:null,
    hasFF:Object.hasOwn(r.stats||{},'106'),statKeys:Object.keys(r.stats||{}).length});
  }
  const weekly=actual.filter(r=>Number(r.seasonId)===season&&Number(r.scoringPeriodId)===week&&Number(r.statSplitTypeId)===1);
  const values=[...new Set(weekly.filter(r=>r.hasFF).map(r=>Number(r.forcedFumble)))];
  output.push({id:String(p.proTeamId),name:p.fullName||p.name,weeklyRecords:weekly.length,weeklyFF:values.length===1?values[0]:null,
   weeklyFFMissing:values.length===0,weeklyConflict:values.length>1,allActualRecordMetadata:actual});
 }
 return {season,week,teamCount:output.length,weeklyFFPresent:output.filter(x=>!x.weeklyFFMissing).length,
  weeklyConflicts:output.filter(x=>x.weeklyConflict).map(x=>x.name),
  cin:output.find(x=>x.id==='4'),teams:output};
}
async function main(){
 const res=await fetch(url,{headers:{Accept:'application/json','X-Fantasy-Filter':JSON.stringify({players:{limit:1500,offset:0}})},signal:AbortSignal.timeout(25000)});
 if(!res.ok)throw Error(`HTTP ${res.status}`);
 const report=inspect(await res.json());
 console.log('SUMMARY',JSON.stringify({season,week,teamCount:report.teamCount,weeklyFFPresent:report.weeklyFFPresent,weeklyConflicts:report.weeklyConflicts,cinWeeklyFF:report.cin?.weeklyFF}));
 for(const t of report.teams)console.log('TEAM',JSON.stringify(t));
 if(report.cin?.weeklyFF!==1){console.error('Cincinnati validation not confirmed for strict weekly record');process.exitCode=2;}
}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1});
module.exports={inspect};
