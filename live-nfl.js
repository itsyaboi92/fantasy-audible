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
function scorePlayer(p,rules){const a=p.passing,b=p.rushing,c=p.receiving,k=p.kicking,m=p.misc;const pass=rules.passing||{},rush=rules.rushing||{},rec=rules.receiving||{},kick=rules.kicking||{},misc=rules.miscellaneous||{};
const passY=get(a,'YDS'),rushY=get(b,'YDS'),recY=get(c,'YDS');
const components=[];
const add=(label,quantity,rate)=>{if(quantity&&rate)components.push({label,quantity,rate,points:Math.round(quantity*rate*100)/100});};

const ptd=get(a,'TD'),rtd=get(b,'TD'),ctd=get(c,'TD');
add('Passing yards',passY,pass.yards||0);
add('Passing TD',ptd,pass.touchdowns||0);
add('Interceptions thrown',get(a,'INT'),pass.interceptions||0);
add('Passing 2PT',get(a,'2PT'),pass.twoPoint||0);
let score=passY*(pass.yards||0)+ptd*(pass.touchdowns||0)+get(a,'INT')*(pass.interceptions||0)+get(a,'2PT')*(pass.twoPoint||0);
add('Rushing yards',rushY,rush.yards||0);
add('Rushing TD',rtd,rush.touchdowns||0);
add('Rushing 2PT',get(b,'2PT'),rush.twoPoint||0);
score+=rushY*(rush.yards||0)+rtd*(rush.touchdowns||0)+get(b,'2PT')*(rush.twoPoint||0);
add('Receiving yards',recY,rec.yards||0);
add('Receptions',get(c,'REC'),rec.receptions||0);
add('Receiving TD',ctd,rec.touchdowns||0);
add('Receiving 2PT',get(c,'2PT'),rec.twoPoint||0);
score+=recY*(rec.yards||0)+get(c,'REC')*(rec.receptions||0)+ctd*(rec.touchdowns||0)+get(c,'2PT')*(rec.twoPoint||0);
if(rushY>=100&&rushY<200){score+=rush.yards100to199||0;add('100–199 rush yards bonus',1,rush.yards100to199||0);}
if(recY>=100&&recY<200){score+=rec.yards100to199||0;add('100–199 receiving yards bonus',1,rec.yards100to199||0);}
// Fumbles lost are a Miscellaneous scoring rule. ESPN may expose this
// as LOST, FL, FUMLOST, or FUMBLESLOST in a dedicated fumbles group.
const lost=get(m,'LOST','FL','FUMLOST','FUMBLESLOST');
const lostRate=Number(misc.fumblesLost??0);
if(lost){score+=lost*lostRate;add('Fumbles lost',lost,lostRate);}
// ESPN summary aggregates do not reliably contain each scoring play's length.
// 40+ yard TD bonuses and return TDs are added only when event-level attribution is reliable.
const fg=get(k,'FG'),fga=get(k,'FGA');const xp=get(k,'XP'),xpa=get(k,'XPA');
// ESPN kicking rows generally use "FG" and "XP" as made/attempted pairs (e.g. 2/3).
function madeAttempts(raw){const match=String(raw??'').match(/^(\d+)\s*\/\s*(\d+)$/);return match?[+match[1],+match[2]]:null;}
const fgPair=madeAttempts(k.FG),xpPair=madeAttempts(k.XP);
score+=(xpPair?xpPair[0]:xp)*(kick.patMade||0)+(xpPair?xpPair[1]-xpPair[0]:Math.max(0,xpa-xp))*(kick.patMissed||0);
// Field goal distance scoring requires play-level distance data; never assign a false 3-point default.
return {points:Math.round(score*100)/100,breakdown:components,fieldGoalsPending:!!(fgPair?.[0]||fg),unsupported:['field-goal distance','40+ yard TD bonuses','return touchdowns']};}
function teamId(player){const v=String(player.nflTeamId??player.team??'');return /^\d+$/.test(v)?v:TEAM_IDS[v.toUpperCase()]||null;}
async function loadWeek(season,week){const board=await json(`${BASE}/scoreboard?season=${season}&seasontype=2&week=${week}&limit=100`);const games=eventGames(board);if(!games.length)throw Error('No NFL games returned for requested week');return games;}
async function fetchGame(id){return json(`${BASE}/summary?event=${encodeURIComponent(id)}`);}
module.exports={loadWeek,fetchGame,playerStats,scorePlayer,teamId};
