'use strict';
// ESPN Fantasy actual weekly D/ST statistics. Never mix season splits or projections.
const cache=new Map(),pending=new Map();
function parse(raw,season,week){
 const entries=Array.isArray(raw)?raw:raw?.players||[];
 const result=new Map();
 for(const entry of entries){
  const player=entry.player||entry;
  if(Number(player.defaultPositionId)!==16)continue;
  const teamId=String(player.proTeamId??'');
  if(!teamId||teamId==='0')continue;
  const records=[...(Array.isArray(player.stats)?player.stats:[]),...(Array.isArray(entry.stats)?entry.stats:[])];
  const valid=records.filter(r=>Number(r.seasonId)===Number(season)&&Number(r.scoringPeriodId)===Number(week)&&Number(r.statSourceId)===0&&Number(r.statSplitTypeId)===1&&r.stats&&typeof r.stats==='object');
  if(!valid.length)continue;
  const values=[...new Set(valid.map(r=>Object.hasOwn(r.stats,'106')?Number(r.stats['106']):0))];
  if(values.length!==1||!Number.isInteger(values[0])||values[0]<0){
   result.set(teamId,{conflict:true,values});continue;
  }
  const explicit=valid.some(r=>Object.hasOwn(r.stats,'106'));
  const old=result.get(teamId);
  if(old&&(old.conflict||old.value!==values[0])){result.set(teamId,{conflict:true,values:[old.value,values[0]]});continue;}
  result.set(teamId,{value:values[0],explicit,recordCount:valid.length});
 }
 return result;
}
async function load(season,week,{fetchImpl=fetch,ttl=60000}={}){
 const key=season+':'+week,now=Date.now(),old=cache.get(key);
 if(old&&now-old.at<ttl)return old.values;
 if(pending.has(key))return pending.get(key);
 const job=(async()=>{
  const url=`https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/players?scoringPeriodId=${week}&view=kona_player_info`;
  const response=await fetchImpl(url,{headers:{Accept:'application/json','X-Fantasy-Filter':JSON.stringify({players:{limit:1500,offset:0}})},signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw Error('ESPN Fantasy D/ST HTTP '+response.status);
  const values=parse(await response.json(),season,week);
  if(values.size===0)throw Error('ESPN Fantasy D/ST weekly actuals empty');
  cache.set(key,{at:Date.now(),values});return values;
 })().finally(()=>pending.delete(key));
 pending.set(key,job);
 try{return await job;}catch(e){if(old&&Date.now()-old.at<15*60000)return old.values;throw e;}
}
async function ingestWeek(pool,defenseStore,season,week,games){
 const active=games.filter(g=>g.status!=='upcoming');if(!active.length)return {updated:0};
 const actual=await load(season,week);let updated=0,missing=0,conflicts=0;
 for(const game of active)for(const team of game.teams){
  const record=actual.get(String(team.id));
  if(!record){missing++;continue;}
  if(record.conflict){conflicts++;continue;}
  await defenseStore.ingestFantasyForcedFumble(pool,season,game,String(team.id),record.value,record.explicit);
  updated++;
 }
 return {updated,missing,conflicts};
}
module.exports={parse,load,ingestWeek};
