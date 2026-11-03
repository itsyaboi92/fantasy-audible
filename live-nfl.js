'use strict';
// Unofficial ESPN site API adapter. No artificial scoring if a feed is missing.
const BASE='https://site.api.espn.com/apis/site/v2/sports/football/nfl';
const TEAM_IDS={'ARI':'22','ATL':'1','BAL':'33','BUF':'2','CAR':'29','CHI':'3','CIN':'4','CLE':'5','DAL':'6','DEN':'7','DET':'8','GB':'9','HOU':'34','IND':'11','JAX':'30','JAC':'30','KC':'12','LV':'13','LAR':'14','LA':'14','MIA':'15','MIN':'16','NE':'17','NO':'18','NYG':'19','NYJ':'20','PHI':'21','PIT':'23','SF':'25','SEA':'26','TB':'27','TEN':'10','WAS':'28'};
async function json(url){const response=await fetch(url,{signal:AbortSignal.timeout(12000),headers:{Accept:'application/json'}});if(!response.ok)throw Error(`NFL data HTTP ${response.status}`);return response.json();}
function stateOf(event){const t=event.status?.type||event.competitions?.[0]?.status?.type||{};return t.completed?'final':t.state==='in'?'playing':t.state==='post'?'final':'upcoming';}
function eventGames(board){return (board.events||[]).map(e=>({id:String(e.id),week:Number(board.week?.number||board.week?.week||0),season:Number(board.season?.year||0),kickoff:e.date||e.competitions?.[0]?.date,status:stateOf(e),teams:(e.competitions?.[0]?.competitors||[]).map(c=>({id:String(c.team?.id),abbreviation:c.team?.abbreviation,homeAway:c.homeAway,score:Number(c.score||0)}))})).filter(g=>g.teams.length===2);}
const number=x=>{const n=Number(String(x??'').replace(/,/g,''));return Number.isFinite(n)?n:0;};
function rowValues(group,row){const labels=group.labels||[],values=row.stats||[];const result={};for(let i=0;i<labels.length;i++)result[String(labels[i]).toUpperCase().replace(/[^A-Z0-9]/g,'')]=values[i];return result;}
function get(v,...keys){for(const k of keys){const x=v[k.replace(/[^A-Z0-9]/g,'')];if(x!==undefined)return number(x);}return 0;}
function playerStats(summary){const out=new Map();for(const team of summary.boxscore?.players||[])for(const group of team.statistics||[])for(const entry of group.athletes||[]){const athlete=entry.athlete||{};if(!athlete.id)continue;const id=String(athlete.id);let p=out.get(id);if(!p){p={id,teamId:String(team.team?.id),name:athlete.displayName,passing:{},rushing:{},receiving:{},kicking:{},misc:{}};out.set(id,p);}const values=rowValues(group,entry);const name=String(group.name||group.type||'').toLowerCase();if(name.includes('pass'))Object.assign(p.passing,values);else if(name.includes('rush'))Object.assign(p.rushing,values);else if(name.includes('receiv'))Object.assign(p.receiving,values);else if(name.includes('kick')||name.includes('field'))Object.assign(p.kicking,values);else if(name.includes('return')||name.includes('fumbl')||name.includes('misc'))Object.assign(p.misc,values);
if(name.includes('fumbl'))p.fumbleGroupSeen=true;}
return out;}
function scorePlayer(p,rules,events=[]){
 const pass=rules.passing||{},rush=rules.rushing||{},rec=rules.receiving||{},
   kick=rules.kicking||{},misc=rules.miscellaneous||{};
 const a=p.passing||{},b=p.rushing||{},c=p.receiving||{},k=p.kicking||{},m=p.misc||{};
 const breakdown=[],unsupported=[];
 let score=0;
 const add=(label,quantity,rate)=>{
   quantity=Number(quantity)||0;rate=Number(rate)||0;
   if(!quantity||!rate)return;
   const points=Math.round(quantity*rate*100)/100;
   score+=points;breakdown.push({label,quantity,rate,points});
 };
 const parsePair=value=>{
   const match=String(value??'').match(/^\s*(\d+)\s*\/\s*(\d+)\s*$/);
   return match?{made:+match[1],attempts:+match[2]}:null;
 };
 add('Passing yards',get(a,'YDS'),pass.yards);
 add('Passing TD',get(a,'TD'),pass.touchdowns);
 add('Interceptions thrown',get(a,'INT'),pass.interceptions);
 add('Passing 2PT',get(a,'2PT'),pass.twoPoint);
 const rushY=get(b,'YDS'),recY=get(c,'YDS');
 add('Rushing yards',rushY,rush.yards);
 add('Rushing TD',get(b,'TD'),rush.touchdowns);
 add('Rushing 2PT',get(b,'2PT'),rush.twoPoint);
 add('Receiving yards',recY,rec.yards);
 add('Receptions',get(c,'REC'),rec.receptions);
 add('Receiving TD',get(c,'TD'),rec.touchdowns);
 add('Receiving 2PT',get(c,'2PT'),rec.twoPoint);
 if(rushY>=100&&rushY<200)add('100–199 rush yards bonus',1,rush.yards100to199);
 if(recY>=100&&recY<200)add('100–199 receiving yards bonus',1,rec.yards100to199);
 add('Fumbles lost',get(m,'LOST','FL','FUMLOST','FUMBLESLOST'),misc.fumblesLost);
 const xpPair=parsePair(k.XP??k.XPA);
 if(xpPair){
   add('PAT made',xpPair.made,kick.patMade);
   add('PAT missed',xpPair.attempts-xpPair.made,kick.patMissed);
 }else{
   add('PAT made',get(k,'XPM','XPMADE'),kick.patMade);
   const miss=get(k,'XPMISS','XPMISSED');
   if(miss)add('PAT missed',miss,kick.patMissed);
   else if(k.XP!==undefined||k.XPA!==undefined)unsupported.push('PAT attempts unverified');
 }
 const fgPair=parsePair(k.FG??k.FGA);
 const madeFG=fgPair?fgPair.made:get(k,'FGM','FGMADE');
 const missedFG=fgPair?fgPair.attempts-fgPair.made:get(k,'FGMISS','FGMISSED');
 // Event-level play attribution is required for distance buckets.
 // Do not award a default three points for unverified field goals.
 let eventFG=0,eventMiss=0;
 for(const e of events){
   if(String(e.athleteId)!==String(p.id))continue;
   if(e.kind==='fieldGoalMade'){
     const yards=Number(e.yards);
     if(!Number.isFinite(yards))continue;
     add(`Field goal ${yards} yd`,1,yards>=60?kick.fg60plus:yards>=50?kick.fg50to59:yards>=40?kick.fg40to49:kick.fg0to39);
     eventFG++;
   }else if(e.kind==='fieldGoalMissed'){
     const yards=Number(e.yards);
     if(Number.isFinite(yards)&&yards<40){add(`Missed field goal ${yards} yd`,1,kick.fgMiss0to39);eventMiss++;}
   }else if(e.kind==='passingTD40')add('40+ yard passing TD',1,pass.touchdowns40);
   else if(e.kind==='rushingTD40')add('40+ yard rushing TD',1,rush.touchdowns40);
   else if(e.kind==='receivingTD40')add('40+ yard receiving TD',1,rec.touchdowns40);
   else if(e.kind==='kickoffReturnTD')add('Kickoff return TD',1,misc.kickoffReturnTD);
   else if(e.kind==='puntReturnTD')add('Punt return TD',1,misc.puntReturnTD);
   else if(e.kind==='fumbleRecoveryTD')add('Fumble recovery TD',1,misc.fumbleRecoveryTD);
 }
 if(madeFG>eventFG)unsupported.push('field-goal distances');
 if(missedFG>eventMiss)unsupported.push('missed field-goal distances');
 if(!events.length)unsupported.push('40+ yard TD bonuses','return touchdowns');
 return {points:Math.round(score*100)/100,breakdown,
   fieldGoalsPending:madeFG>eventFG,unsupported:[...new Set(unsupported)]};
}
function teamId(player){const v=String(player.nflTeamId??player.team??'');return /^\d+$/.test(v)?v:TEAM_IDS[v.toUpperCase()]||null;}
async function loadWeek(season,week){const board=await json(`${BASE}/scoreboard?season=${season}&seasontype=2&week=${week}&limit=100`);const games=eventGames(board);if(!games.length)throw Error('No NFL games returned for requested week');return games;}
async function fetchGame(id){return json(`${BASE}/summary?event=${encodeURIComponent(id)}`);}
module.exports={loadWeek,fetchGame,playerStats,scorePlayer,teamId};
