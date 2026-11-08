'use strict';
// Read-only ESPN diagnostic. No database writes and no fantasy scoring changes.
const https=require('node:https');
const BASE='https://site.api.espn.com/apis/site/v2/sports/football/nfl';
function fetchJSON(url){return new Promise((resolve,reject)=>{
 https.get(url,{headers:{'User-Agent':'FantasyAudible-Diagnostic/1.0','Accept':'application/json'}},res=>{
 let data='';res.on('data',x=>data+=x);res.on('end',()=>{try{if(res.statusCode!==200)throw Error('HTTP '+res.statusCode);resolve(JSON.parse(data))}catch(e){reject(e)}});
 }).on('error',reject);
});}
function findGame(board,abbr){
 return (board.events||[]).find(e=>(e.competitions?.[0]?.competitors||[]).some(c=>c.team?.abbreviation===abbr));
}
function inspect(summary){
 return (summary.boxscore?.players||[]).map(team=>({
  team:team.team?.abbreviation,teamId:team.team?.id,
  groups:(team.statistics||[]).map(g=>({
   name:g.name,type:g.type,labels:g.labels,
   forcedFumbleColumns:(g.labels||[]).map((x,i)=>({x,i})).filter(({x})=>/^(FF|FORCED.?FUMBLES?|FUM.?FORCED)$/i.test(String(x).replace(/\s+/g,''))),
   athletes:(g.athletes||[]).filter(a=>/carter/i.test(a.athlete?.displayName||'')||(g.labels||[]).some((x,i)=>/^(FF|FORCED.?FUMBLES?|FUM.?FORCED)$/i.test(String(x).replace(/\s+/g,''))&&Number(a.stats?.[i])>0)).map(a=>({name:a.athlete?.displayName,stats:a.stats}))
  }))
 }));
}
async function main(){
 const season=Number(process.argv[2]||2026),week=Number(process.argv[3]||9);
 const board=await fetchJSON(`${BASE}/scoreboard?dates=${season}&seasontype=2&week=${week}`);
 for(const abbr of ['CIN','LAR']){
  const game=findGame(board,abbr);
  if(!game){console.log(abbr,'game not found');continue}
  const summary=await fetchJSON(`${BASE}/summary?event=${encodeURIComponent(game.id)}`);
  console.log(JSON.stringify({abbr,gameId:game.id,opponent:(game.competitions?.[0]?.competitors||[]).map(x=>x.team?.abbreviation),playerGroups:inspect(summary),
    teamStatistics:(summary.boxscore?.teams||[]).map(t=>({team:t.team?.abbreviation,statistics:(t.statistics||[]).filter(s=>/fumb|intercept|sack/i.test(String(s.name||s.label||'')))}))
  },null,2));
 }
}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1});
module.exports={findGame,inspect};
