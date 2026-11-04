'use strict';
// Historical, scoring-aware estimates. Never substitutes ESPN's own projections.
const nfl=require('./live-nfl');
const cache=new Map();
const POS=['QB','RB','WR','TE'];
const round=n=>Math.round(n*10)/10;
async function build(season,week,rules){
 const start=Math.max(1,week-4),end=week-1;
 if(end<start)return {players:{},defenses:{},sampleWeeks:0,method:'insufficient history'};
 const games=[];
 for(let w=start;w<=end;w++){
  try{games.push(...(await nfl.loadWeek(season,w)).filter(g=>g.status==='final'));}catch{}
 }
 const data=await Promise.all(games.map(async g=>{
  try{return {game:g,summary:await nfl.fetchGame(g.id)};}catch{return null;}
 }));
 const playerGames=new Map(),defenses=new Map();
 for(const item of data){if(!item)continue;
  const {game,summary}=item,stats=nfl.playerStats(summary);
  for(const p of stats.values()){
   const position=String(p.position||'');
   const team=game.teams.find(t=>String(t.id)===String(p.teamId));
   if(!team)continue;
   const opponent=game.teams.find(t=>String(t.id)!==String(p.teamId));
   if(!opponent)continue;
   const rosterPos=position||null;
   const scored=nfl.scorePlayer(p,rules);
   if(!Number.isFinite(scored.points))continue;
   const key=String(p.id);if(!playerGames.has(key))playerGames.set(key,[]);
   playerGames.get(key).push({points:scored.points,week:game.week,teamId:String(p.teamId),opponentId:String(opponent.id)});
  }
 }
 // Position is sourced from current ESPN player directory by the caller, not inferred from names.
 return {playerGames:Object.fromEntries(playerGames),gamesProcessed:data.filter(Boolean).length,sampleWeeks:end-start+1};
}
async function analytics(season,week,rules,positions){
 const key=JSON.stringify([season,week,rules]);const existing=cache.get(key);
 if(existing&&Date.now()-existing.at<60*60*1000)return existing.data;
 if(existing?.pending)return existing.pending;
 const pending=(async()=>{
  const raw=await build(season,week,rules);
  const defense=new Map(),players={};
  for(const [id,history] of Object.entries(raw.playerGames||{})){
   const pos=positions.get(id);if(!POS.includes(pos))continue;
   const values=history.slice(-4);
   if(values.length>=2){const weights=values.map((_,i)=>i+1),total=weights.reduce((a,b)=>a+b,0);
    players[id]={weeklyProjectedPoints:round(values.reduce((s,v,i)=>s+v.points*weights[i],0)/total),projectionMethod:'Weighted last '+values.length+' completed games; estimated, not ESPN projection',projectionSample:values.length};
   }
   for(const v of values){const key=v.opponentId+':'+pos;
    if(!defense.has(key))defense.set(key,{points:0,games:new Set()});
    const row=defense.get(key);row.points+=v.points;row.games.add(v.week);
   }
  }
  // Rank only among defenses with at least 2 observed games at a position;
  // do not present a partial 32-team ranking as an official OPRK.
  const rankings={};
  for(const pos of POS){const rows=[...defense].filter(([k,v])=>k.endsWith(':'+pos)&&v.games.size>=2)
    .map(([k,v])=>({teamId:k.split(':')[0],average:v.points/v.games.size,games:v.games.size}))
    .sort((a,b)=>a.average-b.average);
   if(rows.length===32)rows.forEach((r,i)=>{rankings[r.teamId+':'+pos]={rank:i+1,averageAllowed:round(r.average),sample:r.games};});
  }
  return {players,rankings,method:'Historical ESPN box scores using league scoring; estimates, not official ESPN projections',gamesProcessed:raw.gamesProcessed,sampleWeeks:raw.sampleWeeks};
 })();cache.set(key,{at:Date.now(),pending});
 try{const data=await pending;cache.set(key,{at:Date.now(),data});return data;}
 catch(e){cache.delete(key);throw e;}
}
module.exports={analytics};
