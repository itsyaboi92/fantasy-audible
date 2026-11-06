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
// Stable, deduplicated game event stream. Keep the richest revision of a play.
function rawPlays(summary){
 const seen=new Map();
 const collect=xs=>{for(const p of xs||[]){if(!p?.id)continue;const id=String(p.id);const old=seen.get(id);if(!old||JSON.stringify(p).length>JSON.stringify(old).length)seen.set(id,p);}};
 collect(summary.scoringPlays);collect(summary.plays);
 for(const d of summary.drives?.previous||[])collect(d.plays);
 if(summary.drives?.current)collect(summary.drives.current.plays);
 return [...seen.values()].sort((a,b)=>Number(a.sequenceNumber||a.id||0)-Number(b.sequenceNumber||b.id||0));
}
function playEvents(summary){
 const events=[];
 for(const play of rawPlays(summary)){
  const desc=String(play.text||play.shortText||'');
  const type=String(play.type?.text||'');
  const teamId=String(play.team?.id||play.teamId||'');
  const participants=(play.participants||[]).map(x=>String(x.athlete?.id||x.id||'')).filter(Boolean);
  const fg=/\b(?:field goal|FG)\b/i.test(desc+' '+type);
  if(fg){
   const m=desc.match(/\b(\d{1,2})\s*[- ]?(?:yard|yd)\s+(?:field goal|fg)\b/i)||desc.match(/\b(?:field goal|fg)\s+(?:of\s+|from\s+)?(\d{1,2})\s*(?:yards?|yds?)\b/i);
   const yards=m?Number(m[1]):null;
   const missed=/\b(?:no good|missed|blocked|wide left|wide right|failed)\b/i.test(desc);
   const made=!missed&&(/\b(?:good|successful|made)\b/i.test(desc)||play.scoringPlay===true);
   // ESPN scoring-play entries sometimes omit participants. Preserve the
   // team and kicker name; resolve against the boxscore's kicker roster.
   const name=desc.match(/^\s*(?:\d+\s*[- ]?(?:yard|yd)\s+)?(?:field goal\s+)?(?:by\s+)?([A-Z][a-zA-Z.'-]+(?:\s+[A-Z][a-zA-Z.'-]+){1,2})\s+(?:\d+\s*[- ]?(?:yard|yd)|field goal)/i);
   if((made||missed)&&yards!==null)events.push({playId:String(play.id),kind:made?'fieldGoalMade':'fieldGoalMissed',yards,athleteId:participants.length===1?participants[0]:null,teamId,kickerName:name?.[1]||null,text:desc});
  }
  const isSack=/\bsacked\b|\bsack\b/i.test(desc+' '+type);
  const isInterception=/\bintercepted\b/i.test(desc);
  const isFumbleRecovery=/\bfumble\b.*\brecover(?:ed|y)\b/i.test(desc);
  const isSafety=/\bsafety\b/i.test(desc+' '+type);
  const isBlocked=/\bblocked\b.*\b(?:punt|field goal|kick)\b|\b(?:punt|field goal|kick)\b.*\bblocked\b/i.test(desc);
  // Defense on the snap is the opponent of the offensive play team. Never
  // guess on turnovers/returns where ESPN does not identify possession.
  for(const [kind,yes] of Object.entries({sack:isSack,interception:isInterception,fumbleRecovery:isFumbleRecovery,safety:isSafety,blockedKick:isBlocked}))
   if(yes)events.push({playId:String(play.id),kind,offenseTeamId:teamId,text:desc});
 }
 return events;
}
function resolveKickerEvents(events,p){
 const name=String(p.name||'').toLowerCase().replace(/[^a-z ]/g,'').trim();
 const last=name.split(/\s+/).at(-1);
 return events.filter(e=>e.kind.startsWith('fieldGoal')&&(String(e.athleteId||'')===String(p.id)||(!e.athleteId&&(!e.teamId||String(e.teamId)===String(p.teamId))&&last&&new RegExp('\\b'+last+'\\b','i').test(e.text||''))));
}
function defenseEvents(events,teamId,opponentId){
 const counts={sacks:0,interceptions:0,fumbleRecovered:0,safety:0,blockedKick:0};
 const types={sack:'sacks',interception:'interceptions',fumbleRecovery:'fumbleRecovered',safety:'safety',blockedKick:'blockedKick'};
 for(const e of events){const key=types[e.kind];if(key&&opponentId&&String(e.offenseTeamId)===String(opponentId))counts[key]++;}
 return counts;
}
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
 // Verified made-FG count earns the minimum configured field-goal award.
 // When individual distances are unavailable, distance bonuses remain provisional.
 // If event-level distances are available, award their exact bucket instead.
 let eventFG=0,eventMiss=0;
 for(const e of resolveKickerEvents(events,p)){
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
 if(madeFG>eventFG){
   const remaining=madeFG-eventFG;
   const minimumRate=Math.min(...[kick.fg0to39,kick.fg40to49,kick.fg50to59,kick.fg60plus].map(x=>Number(x)).filter(Number.isFinite));
   if(Number.isFinite(minimumRate))add('Made FG (distance unverified; minimum award)',remaining,minimumRate);
   unsupported.push('field-goal distances and possible additional distance points');
 }
 if(missedFG>eventMiss)unsupported.push('missed field-goal distances');
 unsupported.push('40+ yard TD bonuses','return touchdowns');
 return {points:Math.round(score*100)/100,breakdown,
   fieldGoalsPending:madeFG>eventFG,unsupported:[...new Set(unsupported)]};
}
// Defensive box-score attribution. Only award values present in the ESPN feed.
// Missing fields are never silently treated as verified zeros.
function defenseStats(summary,game,events=[]){
 const teams=summary.boxscore?.teams||[];
 const output=new Map();
 const aliases={sacks:['sacks','totalsacks'],interceptions:['interceptions','defensiveinterceptions'],
  fumbleRecovered:['fumblesrecovered','fumblerecoveries'],forcedFumble:['forcedfumbles'],
  safety:['safeties'],blockedKick:['blockedkicks','blockedpunts']};
 for(const team of teams){
  const id=String(team.team?.id||'');if(!id)continue;
  const raw={};
  for(const stat of team.statistics||[]){
   const key=String(stat.name||stat.label||'').toLowerCase().replace(/[^a-z0-9]/g,'');
   if(key)raw[key]=stat.displayValue??stat.value;
  }
  const stats={};
  for(const [key,keys] of Object.entries(aliases))for(const k of keys){
   if(raw[k]!==undefined){const v=Number(raw[k]);if(Number.isFinite(v)){stats[key]=v;break;} }
  }
  const opponent=game.teams.find(t=>String(t.id)!==id);
  const oppBox=teams.find(t=>String(t.team?.id)!==id);
  // ESPN's totalYards is the opponent's offensive total, not net punting yards.
  const oppTotal=(oppBox?.statistics||[]).find(x=>String(x.name||'').toLowerCase()==='totalyards');
  const yards=oppTotal?Number(oppTotal.displayValue??oppTotal.value):NaN;
  const observed=defenseEvents(events,id,opponent?.id);
  const hasPlayFeed=rawPlays(summary).length>0;
  // Event counts are authoritative where observed; a zero is provisional until
  // complete play coverage can be demonstrated.
  for(const [key,value] of Object.entries(observed))if(value>0)stats[key]=value;
  output.set(id,{stats,playEventCounts:observed,playFeedAvailable:hasPlayFeed,pointsAllowed:opponent?.score,
    yardsAllowed:Number.isFinite(yards)?yards:null,
    opponentFound:!!opponent,gameStatus:game.status});
 }
 return output;
}
function scoreDefense(input,rules){
 const r=rules.defense||{},d=input?.stats||{},breakdown=[],missing=[];let points=0;
 const add=(label,quantity,rate)=>{const v=Number(quantity),n=Number(rate);
  if(!Number.isFinite(v)||!Number.isFinite(n)||!v||!n)return;
  const value=Math.round(v*n*100)/100;points+=value;
  breakdown.push({label,quantity:v,rate:n,points:value});};
 for(const [key,label] of Object.entries({sacks:'Sacks',interceptions:'Interceptions',
   fumbleRecovered:'Fumbles recovered',forcedFumble:'Forced fumbles',
   safety:'Safeties',blockedKick:'Blocked kicks'})){
   if(Object.hasOwn(d,key))add(label,d[key],key==='sacks'?r.sack:r[key]);else missing.push(label);
 }
 const pa=Number(input?.pointsAllowed);
 if(input?.opponentFound&&Number.isFinite(pa)){
  const key=pa===0?'pointsAllowed0':pa<=6?'pointsAllowed1to6':pa<=13?'pointsAllowed7to13':
   pa<=17?'pointsAllowed14to17':pa<=27?'pointsAllowed18to27':pa<=34?'pointsAllowed28to34':
   pa<=45?'pointsAllowed35to45':'pointsAllowed46plus';
  add('Points allowed bracket',1,r[key]);
 }else missing.push('Points allowed');
 const ya=input?.yardsAllowed;
 if(Number.isFinite(ya)){
  const key=ya<100?'yardsAllowedUnder100':ya<200?'yardsAllowed100to199':
   ya<300?'yardsAllowed200to299':ya<350?'yardsAllowed300to349':
   ya<400?'yardsAllowed350to399':ya<450?'yardsAllowed400to449':
   ya<500?'yardsAllowed450to499':ya<550?'yardsAllowed500to549':'yardsAllowed550plus';
  add('Yards allowed bracket',1,r[key]);
 }else missing.push('Yards allowed');
 missing.push('Defensive/return touchdowns','2-point returns','1-point safeties');
 if(input?.playFeedAvailable)missing.push('Play-level defensive totals require reconciliation');
 return {points:Math.round(points*100)/100,breakdown,unsupported:missing};
}
function teamId(player){
 const raw=player?.nflTeamId??player?.proTeamId??player?.teamId??player?.team??'';
 const v=String(raw).trim();
 if(/^\d+$/.test(v)&&Number(v)>0)return v;
 const name=String(player?.name||player?.fullName||'').replace(/\s+D\/?ST$/i,'').trim().toUpperCase();
 const aliases={CARDINALS:'ARI',FALCONS:'ATL',RAVENS:'BAL',BILLS:'BUF',PANTHERS:'CAR',BEARS:'CHI',BENGALS:'CIN',BROWNS:'CLE',COWBOYS:'DAL',BRONCOS:'DEN',LIONS:'DET',PACKERS:'GB',TEXANS:'HOU',COLTS:'IND',JAGUARS:'JAX',CHIEFS:'KC',RAIDERS:'LV',RAMS:'LAR',DOLPHINS:'MIA',VIKINGS:'MIN',PATRIOTS:'NE',SAINTS:'NO',GIANTS:'NYG',JETS:'NYJ',EAGLES:'PHI',STEELERS:'PIT',FORTYNINERS:'SF','49ERS':'SF',SEAHAWKS:'SEA',BUCCANEERS:'TB',TITANS:'TEN',COMMANDERS:'WAS'};
 const normalized=name.split(/\s+/).at(-1);
 return TEAM_IDS[v.toUpperCase()]||TEAM_IDS[aliases[normalized]]||null;
}
async function loadWeek(season,week){const board=await json(`${BASE}/scoreboard?season=${season}&seasontype=2&week=${week}&limit=100`);const games=eventGames(board);if(!games.length)throw Error('No NFL games returned for requested week');return games;}
async function fetchGame(id){
 const summary=await json(`${BASE}/summary?event=${encodeURIComponent(id)}`);
 // ESPN's summary can omit older drives or individual plays. Merge the CDN
 // play-by-play package by stable play ID when available; never use its box
 // score to generate points.
 try{
   const cdn=await json(`https://cdn.espn.com/core/nfl/playbyplay?xhr=1&gameId=${encodeURIComponent(id)}`);
   const extra=cdn.gamepackageJSON||cdn;
   const byId=new Map();for(const p of rawPlays(summary).concat(rawPlays(extra))){
     const old=byId.get(String(p.id));if(!old||JSON.stringify(p).length>JSON.stringify(old).length)byId.set(String(p.id),p);
   }
   if(byId.size)summary.plays=[...byId.values()];
 }catch(e){console.warn('NFL CDN play feed unavailable for',id,e.message);}
 return summary;
}
module.exports={loadWeek,fetchGame,playerStats,rawPlays,playEvents,resolveKickerEvents,defenseEvents,scorePlayer,defenseStats,scoreDefense,teamId};
