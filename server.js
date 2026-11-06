const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');
const { initializeESPN, getESPNPlayers } = require('./espn');
const liveNFL = require('./live-nfl');
const matchupAnalytics = require('./matchup-analytics');
const webpush = require('web-push');
const PUSH_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const PUSH_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const PUSH_READY = Boolean(PUSH_PUBLIC_KEY && PUSH_PRIVATE_KEY);
if (PUSH_READY) webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@example.com', PUSH_PUBLIC_KEY, PUSH_PRIVATE_KEY);

const PORT = process.env.PORT || 3000;
const MAX_TEAMS = 12;
const DEFAULT_ROUNDS = 16;
const PICK_SECONDS = 90;
if (!process.env.DATABASE_URL) throw Error('DATABASE_URL is required');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const clients = new Map();

const DEFAULT_ROSTER = {
  starters: { QB:1, RB:2, WR:2, TE:1, FLEX:1, 'D/ST':1, K:1 },
  maximums: { QB:4, RB:8, WR:8, TE:3, 'D/ST':3, K:3 },
  bench:7, ir:1
};
const DEFAULT_SCORING = {
  passing:{yards:0.04, touchdowns:6, touchdowns40:1, interceptions:-2, twoPoint:2},
  rushing:{yards:0.1, touchdowns:6, touchdowns40:1, twoPoint:2, yards100to199:1},
  receiving:{yards:0.1, receptions:1, touchdowns:6, touchdowns40:1, twoPoint:2, yards100to199:1},
  kicking:{patMade:1, patMissed:-1, fg0to39:3, fg40to49:4, fg50to59:5, fg60plus:6, fgMiss0to39:-1},
  defense:{sack:1, interception:2, interceptionTD:6, fumbleReturnTD:6, kickoffReturnTD:6,
    puntReturnTD:6, blockedKickReturnTD:6, blockedKick:2, fumbleRecovered:1,
    forcedFumble:1, safety:2, twoPointReturn:2, onePointSafety:1,
    pointsAllowed0:5, pointsAllowed1to6:4, pointsAllowed7to13:3,
    pointsAllowed14to17:1, pointsAllowed18to27:0, pointsAllowed28to34:-1,
    pointsAllowed35to45:-3, pointsAllowed46plus:-5,
    yardsAllowedUnder100:5, yardsAllowed100to199:3, yardsAllowed200to299:2,
    yardsAllowed300to349:0, yardsAllowed350to399:-1, yardsAllowed400to449:-3,
    yardsAllowed450to499:-5, yardsAllowed500to549:-6, yardsAllowed550plus:-7},
  miscellaneous:{kickoffReturnTD:6,puntReturnTD:6,fumbleRecoveryTD:6,
    fumblesLost:-2,interceptionReturnTD:6,fumbleReturnTD:6,
    blockedKickReturnTD:6,twoPointReturn:2,onePointSafety:1}
};
const DEFAULT_TRANSACTIONS = {waiverDays:1, acquisitionLimit:null,
  playerUniverse:'ALL_NFL', undroppableList:true, lineupLock:'INDIVIDUAL_KICKOFF'};
const DEFAULT_SETTINGS = {roster:DEFAULT_ROSTER,scoring:DEFAULT_SCORING,
  transactions:DEFAULT_TRANSACTIONS};
const DEFAULT_PREFERENCES = {strategy:'balanced',autoDraft:false,avoidOut:true,
  positionPriority:['RB','WR','TE','QB','D/ST','K'],queue:[]};
const POSITIONS = ['QB','RB','WR','TE','D/ST','K'];
const STRATEGIES = ['balanced','bpa','starters','custom'];

const demoPlayers = [
  ['p1','Joe Burrow','CIN','QB',1,'injured',8.6,'QB','m1'],
  ['p2','Cincinnati Backup QB','CIN','QB',1,'playing',3.4,'BENCH','m1'],
  ['p3','Patrick Mahomes','KC','QB',3,'upcoming',0,'BENCH','m1'],
  ['p4','Ja’Marr Chase','CIN','WR',1,'playing',14.2,'WR','m1'],
  ['p5','Tee Higgins','CIN','WR',1,'playing',9.4,'BENCH','m1'],
  ['p6','Chase Brown','CIN','RB',1,'playing',12.3,'RB','m1'],
  ['p7','Jordan Mason','MIN','RB',3,'upcoming',0,'BENCH','m1'],
  ['p8','George Kittle','SF','TE',2,'playing',7.2,'TE','m1'],
  ['p9','Lamar Jackson','BAL','QB',1,'playing',18.7,'QB','m2'],
  ['p10','Derrick Henry','BAL','RB',1,'playing',17.5,'RB','m2'],
  ['p11','Zay Flowers','BAL','WR',1,'playing',11.1,'WR','m2'],
  ['p12','Mark Andrews','BAL','TE',1,'playing',6.3,'TE','m2']
].map(([id,name,team,pos,kickoff,status,points,slot,owner])=>
  ({id,name,team,pos,kickoff,status,points,slot,owner}));

// NFL scoreboard is authoritative for individual game kickoff and final status.
// Fail closed if it cannot be checked: never mistakenly allow an in-game pickup.
let nflSchedule={at:0,games:null,error:null};
async function nflGames(){
  if(nflSchedule.games&&Date.now()-nflSchedule.at<90000)return nflSchedule.games;
  try{
    const response=await fetch('https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?limit=100',
      {signal:AbortSignal.timeout(9000)});
    if(!response.ok)throw Error('NFL scoreboard HTTP '+response.status);
    const data=await response.json();
    let events=data.events||[];
    // A team without a game in the active NFL week is on BYE, not postgame waivers.
    const currentWeekTeams=new Set(events.flatMap(e=>(e.competitions?.[0]?.competitors||[]).map(c=>String(c.team?.id))));
    const week=Number(data.week?.number),year=Number(data.season?.year);
    if(week>1&&Number.isInteger(year)){
      try{const prior=await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${year}&seasontype=2&week=${week-1}&limit=100`,
        {signal:AbortSignal.timeout(9000)});
        if(prior.ok)events=events.concat((await prior.json()).events||[]);
      }catch{} // Current-week schedule still protects live kickoff locks.
    }
    const games=events.map(event=>{
      const competition=event.competitions?.[0];
      return {id:String(event.id),teams:(competition?.competitors||[]).map(x=>String(x.team?.id)),
        kickoff:competition?.date||event.date,
        state:event.status?.type?.state||competition?.status?.type?.state||'pre',
        completed:Boolean(event.status?.type?.completed||competition?.status?.type?.completed)};
    }).filter(g=>g.teams.length===2&&Number.isFinite(Date.parse(g.kickoff)));
    if(!games.length)throw Error('NFL scoreboard contains no games');
    nflSchedule={at:Date.now(),games,error:null,currentWeekTeams};return games;
  }catch(e){nflSchedule.error=e.message;
    // Never use stale game data for new transactions.
    throw Error('Live NFL schedule unavailable; player transactions temporarily paused');}
}
function easternParts(time){const p=new Intl.DateTimeFormat('en-US',
  {timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',weekday:'short',hour:'2-digit',hourCycle:'h23'}).formatToParts(time);
  return Object.fromEntries(p.map(x=>[x.type,x.value]));}
function sameEasternDay(a,b){const x=easternParts(new Date(a)),y=easternParts(new Date(b));
  return x.year===y.year&&x.month===y.month&&x.day===y.day;}
function nextWednesdayEastern(after){
  // 03:00 ET is 07:00 or 08:00 UTC, depending on DST.
  for(let i=0;i<9;i++){
    const d=new Date(after+i*86400000),parts=easternParts(d);
    if(parts.weekday!=='Wed')continue;
    const utc=Date.UTC(+parts.year,+parts.month-1,+parts.day,8);
    const candidate=new Date(utc);
    const offset=easternParts(candidate).hour==='03'?-5:-4;
    const when=Date.UTC(+parts.year,+parts.month-1,+parts.day,3-offset);
    if(when>after)return new Date(when).toISOString();
  }
  return new Date(after+7*86400000).toISOString();
}
function transactionStatus(player,gameMap,s,now=Date.now()){
  const id=String(player.nflTeamId??player.team??'');
  const game=gameMap.get(id);
  const forced=s.waiverHolds?.[String(player.id)];
  const zeroDay=settingsOf(s).transactions.waiverDays===0;
  if(game){
    const start=Date.parse(game.kickoff);
    if(now>=start&&!game.completed)return {status:'LOCKED',kickoff:game.kickoff};
    if(game.completed){
      const until=Date.parse(nextWednesdayEastern(start));
      if(now<until)return {status:'WAIVERS',clearsAt:zeroDay?new Date(now).toISOString():new Date(until).toISOString(),kickoff:game.kickoff};
    }
  }
  if(forced&&Date.parse(forced)>now&&!zeroDay)return {status:'WAIVERS',clearsAt:forced};
  return {status:'FREE_AGENT'};
}
function gameMapFrom(games){const map=new Map();
  const currentWeekTeams=nflSchedule.currentWeekTeams;
  for(const game of games)for(const id of game.teams){
    if(currentWeekTeams && !currentWeekTeams.has(id))continue;
    const previous=map.get(id);
    if(!previous||Date.parse(game.kickoff)>Date.parse(previous.kickoff))map.set(id,game);
    // Until Wednesday's clearance, a finished prior-week game takes precedence.
    if(previous?.completed&&Date.now()<Date.parse(nextWednesdayEastern(Date.parse(previous.kickoff))))map.set(id,previous);
    if(game.completed&&Date.now()<Date.parse(nextWednesdayEastern(Date.parse(game.kickoff))))map.set(id,game);
  }return map;}
function activeRoster(s,owner){return s.players.filter(x=>x.owner===owner&&x.slot!=='IR');}
function transactionCapacity(s,owner,player,drop){
  const roster=settingsOf(s).roster,active=activeRoster(s,owner).filter(x=>x.id!==drop?.id);
  if(active.length>=Object.values(roster.starters).reduce((a,b)=>a+b,0)+roster.bench)
    return 'Roster is full; select a player to drop';
  if(active.filter(x=>x.pos===player.position).length>=roster.maximums[player.position])
    return 'Position maximum reached';
  return null;
}
function acquisitionCount(s,owner){return (s.transactions||[]).filter(x=>x.manager===owner&&
  ['FREE_AGENT_ADD','WAIVER_AWARDED'].includes(x.type)).length;}
function acquire(s,owner,player,drop,kind){
  const old=drop?.name;
  if(drop){drop.owner=null;drop.slot='BENCH';drop.acquiredAt=null;drop.acquisitionType=null;
    // Same-day pickups return directly to free agency unless a game has begun.
    const immediate=drop.lastAcquiredAt&&drop.lastAcquisitionType!=='DRAFT'&&
      sameEasternDay(drop.lastAcquiredAt,Date.now());
    if(!immediate)s.waiverHolds[drop.id]=new Date(Date.now()+settingsOf(s).transactions.waiverDays*86400000).toISOString();
    else delete s.waiverHolds[drop.id];
  }
  player.owner=owner;player.slot='BENCH';player.acquiredAt=new Date().toISOString();
  player.lastAcquiredAt=player.acquiredAt;player.acquisitionType=kind;
  player.lastAcquisitionType=kind;delete s.waiverHolds[player.id];
  audit(s,kind==='WAIVER'?'WAIVER_AWARDED':'FREE_AGENT_ADD',owner,
    player.name+' acquired'+(old?' (dropped '+old+')':''));
}
function ensureTransactions(s){s.waiverHolds||={};s.waiverClaims||=[];}
function dropValidation(s,owner,id,gameMap){
  if(!id)return null;
  const player=s.players.find(p=>p.id===id&&p.owner===owner);
  if(!player)return failure(404,'Player to drop is not on your roster');
  const game=gameMap.get(String(player.nflTeamId??player.team??''));
  if(game&&Date.now()>=Date.parse(game.kickoff)&&!game.completed)
    return failure(409,'Cannot drop a player during their NFL game');
  if(lineupLocked(s,player))return failure(409,'Cannot drop a locked lineup player');
  return player;
}
async function processWaivers(){
  const {state}=await snapshot();
  if(!(state.waiverClaims||[]).length)return;
  const games=await nflGames(),map=gameMapFrom(games),now=Date.now();
  await change(s=>{
    ensureTransactions(s);
    const due=new Set();
    for(const claim of s.waiverClaims){
      const player=s.players.find(p=>p.id===claim.playerId);
      if(!player||player.owner){due.add(claim.id);continue;}
      const status=transactionStatus(player,map,s,now);
      // A claim is due when its processing deadline arrives, even if the
      // player is still classified as on waivers. Zero-day settings also
      // apply to claims submitted before the commissioner changed the delay.
      if(status.status==='FREE_AGENT'||(status.status==='WAIVERS'&&
          Number.isFinite(Date.parse(status.clearsAt))&&Date.parse(status.clearsAt)<=now))due.add(claim.id);
    }
    if(!due.size)return {ok:true};
    const byPlayer=new Map();
    for(const claim of s.waiverClaims.filter(c=>due.has(c.id))){
      if(!byPlayer.has(claim.playerId))byPlayer.set(claim.playerId,[]);
      byPlayer.get(claim.playerId).push(claim);
    }
    if(!s.waiverPriority?.length)s.waiverPriority=s.managers.map(m=>m.id);
    for(const [id,claims] of byPlayer){
      const player=s.players.find(p=>p.id===id);
      if(!player||player.owner)continue;
      claims.sort((a,b)=>s.waiverPriority.indexOf(a.manager)-s.waiverPriority.indexOf(b.manager)||a.at.localeCompare(b.at));
      for(const claim of claims){
        const drop=claim.dropId?s.players.find(p=>p.id===claim.dropId&&p.owner===claim.manager):null;
        if(claim.dropId&&!drop)continue;
        if(drop&&dropValidation(s,claim.manager,drop.id,map)?.error)continue;
        if(transactionCapacity(s,claim.manager,{position:player.pos},drop))continue;
        const limit=settingsOf(s).transactions.acquisitionLimit;
        if(limit!==null&&acquisitionCount(s,claim.manager)>=limit)continue;
        acquire(s,claim.manager,player,drop,'WAIVER');
        s.waiverPriority=s.waiverPriority.filter(x=>x!==claim.manager).concat(claim.manager);
        break;
      }
    }
    s.waiverClaims=s.waiverClaims.filter(c=>!due.has(c.id));
    return {ok:true};
  });
}
function initialState(){return {version:1,league:'Fantasy Audible League',week:9,phase:2,
  managers:[],players:demoPlayers,injuries:[{id:'i1',player:'p1',active:true,description:'Demo injury'}],
  transactions:[],waiverHolds:{},waiverClaims:[],waiverPriority:[],settings:structuredClone(DEFAULT_SETTINGS),draft:{status:'waiting',rounds:DEFAULT_ROUNDS,
    secondsPerPick:PICK_SECONDS,order:[],picks:[],deadline:null,remainingSeconds:null}};}
function ensureDraft(s){if(!s.draft)s.draft=initialState().draft;return s.draft;}
function settingsOf(s){
  const saved=s.settings||{};
  return {
    roster:{...DEFAULT_ROSTER,...(saved.roster||{}),
      starters:{...DEFAULT_ROSTER.starters,...(saved.roster?.starters||{})},
      maximums:{...DEFAULT_ROSTER.maximums,...(saved.roster?.maximums||{})}},
    scoring:{...DEFAULT_SCORING,...(saved.scoring||{})},
    transactions:{...DEFAULT_TRANSACTIONS,...(saved.transactions||{})}
  };
}
function preferencesOf(s,id){return {...DEFAULT_PREFERENCES,...(s.draftPreferences?.[id]||{})};}
// Schedule NFL weeks, not league-relative weeks. Odd team counts receive rotating byes.
function fantasySchedule(s,accounts,startWeek=1){
  const ids=s.managers.filter(m=>accounts.some(a=>a.manager===m.id)).map(m=>m.id).sort((a,b)=>Number(a.slice(1))-Number(b.slice(1)));
  if(ids.length<2)return {};
  let rotation=[...ids];if(rotation.length%2)rotation.push(null);
  const rounds=rotation.length-1,result={};
  for(let week=startWeek;week<=14;week++){
    const matches=[];
    for(let i=0;i<rotation.length/2;i++){
      const a=rotation[i],b=rotation[rotation.length-1-i];
      if(a&&b)matches.push({id:`${week}-${[a,b].sort().join('-')}`,home:a,away:b});
    }
    result[week]=matches;
    rotation=[rotation[0],rotation[rotation.length-1],...rotation.slice(1,-1)];
  }
  return result;
}
// ESPN is authoritative for NFL week and the first kickoff, including Thursday games.
async function currentNFLCalendar(){
  const base='https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';
  const response=await fetch(base+'?limit=100',{signal:AbortSignal.timeout(9000)});
  if(!response.ok)throw Error('NFL calendar HTTP '+response.status);
  const data=await response.json();
  const events=Array.isArray(data.events)?data.events:[];
  const season=Number(data.season?.year||events[0]?.season?.year);
  // ESPN sometimes omits top-level week metadata. The calendar is allowed to
  // fall back to event metadata, but never to the hard-coded demo league week.
  const week=Number(data.week?.number||data.leagues?.[0]?.calendar?.find?.(x=>x?.value===data.week?.value)?.value||events.find(e=>e.week?.number)?.week?.number);
  if(!Number.isInteger(week)||week<1||week>18||!Number.isInteger(season))
    throw Error('NFL calendar missing week/season metadata');
  const weekly=await fetch(`${base}?dates=${season}&seasontype=2&week=${week}&limit=100`,
    {signal:AbortSignal.timeout(9000)});
  if(!weekly.ok)throw Error('NFL weekly schedule HTTP '+weekly.status);
  const weekData=await weekly.json();
  const kickoffs=(weekData.events||[]).map(g=>Date.parse(g.competitions?.[0]?.date||g.date)).filter(Number.isFinite);
  if(!kickoffs.length)throw Error('NFL calendar missing kickoff times for Week '+week);
  return {week,season,firstKickoff:Math.min(...kickoffs)};
}
function validSchedule(schedule){return schedule&&typeof schedule==='object'&&Object.values(schedule).some(v=>Array.isArray(v)&&v.length>0);}
let scheduleActivationBusy=false;
async function activateLeagueSchedule(){
  if(scheduleActivationBusy)return;scheduleActivationBusy=true;
  try{
    const {state}=await snapshot();
    if(ensureDraft(state).status!=='completed'||validSchedule(state.frozenMatchupSchedule))return;
    const calendar=await currentNFLCalendar();
    const startWeek=calendar.week+(Date.now()>=calendar.firstKickoff?1:0);
    await change((s,accounts)=>{
      if(ensureDraft(s).status!=='completed'||validSchedule(s.frozenMatchupSchedule))return {ok:true};
      const count=s.managers.filter(m=>accounts.some(a=>a.manager===m.id)).length;
      if(count<2){s.matchupScheduleNotice='Only '+count+' registered team(s) available for scheduling.';return {ok:true};}
      if(startWeek>14){s.matchupScheduleNotice='The regular-season scheduling window has ended.';return {ok:true};}
      const schedule=fantasySchedule(s,accounts,startWeek);
      if(!validSchedule(schedule)){s.matchupScheduleNotice='Unable to pair registered teams; schedule not saved.';return {ok:true};}
      s.frozenMatchupSchedule=schedule;
      s.scheduleStartWeek=startWeek;s.scheduleSeason=calendar.season;s.week=startWeek;
      delete s.matchupScheduleNotice;
      audit(s,'MATCHUP_SCHEDULE_CREATED',null,'NFL Week '+startWeek+' through Week 14');
      console.log('MATCHUP_SCHEDULE_CREATED',JSON.stringify({startWeek,season:calendar.season,teams:count,matchups:schedule[startWeek].length}));
      return {ok:true};
    });
  }catch(e){
    console.error('NFL schedule activation:',e.stack||e.message);
    // Expose a useful error to commissioner instead of silently polling forever.
    try{await change(s=>{if(ensureDraft(s).status==='completed'&&!validSchedule(s.frozenMatchupSchedule))
      s.matchupScheduleNotice='Scheduling failed: '+String(e.message||e).slice(0,180);return {ok:true};});}catch{}
  }finally{scheduleActivationBusy=false;}
}
// Persisted week-specific ledger. Historical weeks are never inferred from today's roster.
function ledgerScore(p){return Number(p.scoringMode==='handcuff'?(p.credited??0):p.points)||0;}
function ledgerLineup(s,id){return s.players.filter(p=>p.owner===id&&!['BENCH','IR'].includes(p.slot)).map(p=>({id:p.id,name:p.name,team:p.team,pos:p.pos,slot:p.slot,status:p.status,points:ledgerScore(p),liveScoreStatus:p.liveScoreStatus||null}));}
function ledgerTotal(lineup){return Math.round(lineup.reduce((n,p)=>n+p.points,0)*100)/100;}
function updateWeeklyLedger(s,accounts,week,games,failures){
  if(!Number.isInteger(week)||week<1||week>14)return;
  s.weeklyLedger ||= {};
  const schedule=s.frozenMatchupSchedule||{};
  const matches=schedule[week]||[];
  const entry=s.weeklyLedger[week] ||= {week,createdAt:new Date().toISOString(),matchups:{}};
  const allFinal=games.length>0&&games.every(g=>g.status==='final')&&failures.length===0;
  for(const match of matches){
    const prior=entry.matchups[match.id];if(prior?.status==='final')continue;
    const homeLineup=ledgerLineup(s,match.home),awayLineup=ledgerLineup(s,match.away);
    const allPlayers=[...homeLineup,...awayLineup];
    const verified=allPlayers.every(p=>p.liveScoreStatus==='UPDATED'||p.status==='upcoming'&&p.points===0);
    const status=allFinal&&verified?'final':'provisional';
    const homeScore=ledgerTotal(homeLineup),awayScore=ledgerTotal(awayLineup);
    entry.matchups[match.id]={id:match.id,home:match.home,away:match.away,
      homeScore,awayScore,homeLineup,awayLineup,status,
      winner:status==='final'?(homeScore===awayScore?null:homeScore>awayScore?match.home:match.away):null,
      updatedAt:new Date().toISOString(),warning:status==='final'?null:'Scoring is provisional; missing or unsupported NFL scoring may affect results.'};
  }
}
function leagueStandings(s,accounts){
  const result={};for(const m of s.managers)result[m.id]={manager:m.id,wins:0,losses:0,ties:0,pointsFor:0,pointsAgainst:0};
  for(const week of Object.values(s.weeklyLedger||{}))for(const match of Object.values(week.matchups||{})){
    if(match.status!=='final'||!result[match.home]||!result[match.away])continue;
    const a=result[match.home],b=result[match.away];a.pointsFor+=match.homeScore;a.pointsAgainst+=match.awayScore;
    b.pointsFor+=match.awayScore;b.pointsAgainst+=match.homeScore;
    if(match.homeScore===match.awayScore){a.ties++;b.ties++;}
    else if(match.homeScore>match.awayScore){a.wins++;b.losses++;}else{b.wins++;a.losses++;}
  }
  return Object.values(result).map(x=>({...x,pointsFor:Math.round(x.pointsFor*100)/100,pointsAgainst:Math.round(x.pointsAgainst*100)/100}))
    .sort((a,b)=>(b.wins+b.ties/2)/(b.wins+b.losses+b.ties||1)-(a.wins+a.ties/2)/(a.wins+a.losses+a.ties||1)||b.pointsFor-a.pointsFor);
}
// V24: Persisted, league-scoped editorial editions. No invented game results.
function editorialWeek(s){return Math.max(1,Math.min(18,Number(s.week)||1));}
function editorialTeam(s,id){return s.managers.find(m=>m.id===id)?.team||'Unknown team';}
function editorialEdition(s,kind,week){
  const fixtures=(s.frozenMatchupSchedule||{})[week]||[];
  const ledger=s.weeklyLedger?.[week]?.matchups||{};
  const title=kind==='recap'?`Week ${week}: The Final Whistle`:kind==='rankings'?`Week ${week}: Power Rankings`:kind==='preview'?`Week ${week}: Matchup Preview`:`Week ${week}: Sunday Outlook`;
  const lines=[];
  if(kind==='recap'){
    const finals=Object.values(ledger).filter(x=>x.status==='final');
    if(!finals.length)return null; // Never fabricate completed games.
    const sorted=[...finals].sort((a,b)=>Math.abs(b.homeScore-b.awayScore)-Math.abs(a.homeScore-a.awayScore));
    for(const m of sorted){const h=editorialTeam(s,m.home),a=editorialTeam(s,m.away);
      const margin=Math.abs(m.homeScore-m.awayScore).toFixed(1);
      lines.push(`${h} ${m.homeScore.toFixed(1)} – ${a} ${m.awayScore.toFixed(1)}. ${m.winner?`${editorialTeam(s,m.winner)} takes it by ${margin}. ${Number(margin)<5?'That one needed a seatbelt.':'Somebody check the group chat.'}`:'A tie. Even the scoreboard refused to pick a side.'}`);}
    const biggest=sorted[0];if(biggest)lines.unshift(`Biggest margin: ${editorialTeam(s,biggest.winner||biggest.home)} in a ${Math.abs(biggest.homeScore-biggest.awayScore).toFixed(1)}-point decision.`);
    if(finals.length<fixtures.length)lines.push('Some matchups are still awaiting verified final scoring; this edition covers confirmed results only.');
  }else if(kind==='rankings'){
    const standings=leagueStandings(s,[]).filter(x=>s.managers.some(m=>m.id===x.manager));
    if(!standings.length||!Object.values(s.weeklyLedger||{}).some(w=>Object.values(w.matchups||{}).some(m=>m.status==='final')))return null;
    standings.forEach((r,i)=>lines.push(`#${i+1} ${editorialTeam(s,r.manager)} — ${r.wins}-${r.losses}${r.ties?`-${r.ties}`:''}, ${r.pointsFor.toFixed(1)} points for. ${i===0?'Top of the mountain. Everybody else has homework.':i===standings.length-1?'The comeback tour better start soon.':'The standings do not negotiate.'}`));
  }else if(kind==='preview'){
    if(!fixtures.length)return null;
    for(const f of fixtures)lines.push(`${editorialTeam(s,f.home)} vs ${editorialTeam(s,f.away)}. Bragging rights are on the line; the projections do not play the games.`);
  }else if(kind==='outlook'){
    if(!fixtures.length)return null;
    lines.push('Sunday check-in: Thursday results are in the mix. These are snapshots, not final predictions; remaining games can change everything.');
    for(const f of fixtures){
      const m=ledger[f.id];
      if(m && Number.isFinite(m.homeScore) && Number.isFinite(m.awayScore)){
        const leader=m.homeScore===m.awayScore?'Nobody':editorialTeam(s,m.homeScore>m.awayScore?f.home:f.away);
        lines.push(`${editorialTeam(s,f.home)} ${m.homeScore.toFixed(1)} – ${editorialTeam(s,f.away)} ${m.awayScore.toFixed(1)} (current recorded points; ${m.status==='final'?'final':'provisional'}). ${leader==='Nobody'?'Dead even for now.':`${leader} is ahead for now.`} The remaining slate still matters.`);
      }else lines.push(`${editorialTeam(s,f.home)} vs ${editorialTeam(s,f.away)}: no current matchup scores recorded yet. Sunday is where the plot thickens.`);
    }
  }
  return {id:`${kind}-${week}`,kind,week,title,lines,publishedAt:new Date().toISOString()};
}
function easternEditorialNow(now=new Date()){
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',weekday:'short',hour:'2-digit',hourCycle:'h23'}).formatToParts(now);
  const fields=Object.fromEntries(parts.map(p=>[p.type,p.value]));return {day:fields.weekday,hour:Number(fields.hour)};
}
let editorialBusy=false;
async function publishEditorial(){if(editorialBusy)return;editorialBusy=true;
  try{const {state:preview}=await snapshot();
    const {day,hour}=easternEditorialNow();
    const previewKind=day==='Tue'&&hour>=9?'recap':day==='Wed'&&hour>=9?'rankings':day==='Thu'&&hour>=9?'preview':day==='Sun'&&hour>=8?'outlook':null;
    const previewWeek=previewKind==='recap'?Math.max(1,editorialWeek(preview)-1):editorialWeek(preview);
    if(!previewKind||(preview.editorial||[]).some(e=>e.id===`${previewKind}-${previewWeek}`))return;
    await change(s=>{
    const {day,hour}=easternEditorialNow();
    const kind=day==='Tue'&&hour>=9?'recap':day==='Wed'&&hour>=9?'rankings':day==='Thu'&&hour>=9?'preview':day==='Sun'&&hour>=8?'outlook':null;
    if(!kind)return {ok:true};
    // Tuesday recap uses the previous week; Wednesday rankings and Thursday/Sunday coverage use the current week.
    const week=kind==='recap'?Math.max(1,editorialWeek(s)-1):editorialWeek(s);
    s.editorial ||= [];
    if(s.editorial.some(e=>e.id===`${kind}-${week}`))return {ok:true};
    const edition=editorialEdition(s,kind,week);if(edition)s.editorial.unshift(edition);
    s.editorial=s.editorial.slice(0,48);return {ok:true};
  });}catch(e){console.error('Editorial publish:',e.message);}finally{editorialBusy=false;}
}
// v26: league-scoped Locker Room bot. This release still has one authenticated league;
// its stable namespace prevents collisions and is ready for future per-league routing.
const BOT_MANAGER='__the_audible__';
function botLeagueId(s){return String(s.leagueId||'default').slice(0,100);}
function botPick(key,options){const h=crypto.createHash('sha256').update(String(key)).digest();return options[h[0]%options.length];}
function botSafeName(s,id){return editorialTeam(s,id).slice(0,80);}
function botEditionText(edition){
  const intro={recap:'🎙️ THE AUDIBLE | WEEKLY RECAP',rankings:'📊 THE AUDIBLE | POWER RANKINGS',preview:'🏈 THE AUDIBLE | MATCHUP PREVIEW',outlook:'🚨 THE AUDIBLE | SUNDAY OUTLOOK'};
  const first=(edition.lines||[]).slice(0,3).join('\n');
  return `${intro[edition.kind]||'🎙️ THE AUDIBLE'}\n${edition.title}\n${first}${edition.lines.length>3?'\nFull breakdown is on Home.':''}`.slice(0,1000);
}
function botEventText(s,event){
  const manager=botSafeName(s,event.manager),details=String(event.details||'').slice(0,180);
  switch(event.type){
    case 'DRAFT_COMPLETE':return '🎙️ THE AUDIBLE: The draft is over. Every manager thinks they built a dynasty. At least one of them built a cautionary tale.';
    case 'AUTO_PICK':return `🤖 THE AUDIBLE: ${manager} let autopick take the wheel. ${botPick(event.id,['Bold strategy. Let’s see if the algorithm can also coach.','The computer made the pick. The manager will still take credit.'])}`;
    case 'SUBSTITUTION':return `🚑 THE AUDIBLE: ${manager} made an injury substitution. ${botPick(event.id,['The training room is officially part of the coaching staff.','Desperation? Strategy? We will know after the points settle.'])}`;
    case 'RENAME':return `🪧 THE AUDIBLE: ${manager} changed the team name. ${botPick(event.id,['New branding. Same pressure to win.','A fresh coat of paint does not fix a bad lineup.'])}`;
    case 'WAIVER_AWARDED':return `📋 THE AUDIBLE: ${manager} won a waiver claim. ${botPick(event.id,['The waiver wire is where optimism goes shopping.','A roster move with playoff-level confidence.'])}`;
    case 'FREE_AGENT_ADD':return `🛒 THE AUDIBLE: ${manager} grabbed a free agent. ${botPick(event.id,['Either a steal or a future regret.','The bargain bin just got a headline.'])}`;
    default:return null;
  }
}
function botMatchupPosts(s){
  const out=[];
  for(const [week,record] of Object.entries(s.weeklyLedger||{})){
    for(const m of Object.values(record.matchups||{})){
      if(m.status!=='final'||!Number.isFinite(m.homeScore)||!Number.isFinite(m.awayScore))continue;
      const margin=Math.abs(m.homeScore-m.awayScore),winner=m.homeScore===m.awayScore?null:m.homeScore>m.awayScore?m.home:m.away;
      const loser=winner==null?null:winner===m.home?m.away:m.home;
      const label=winner?`${botSafeName(s,winner)} over ${botSafeName(s,loser)}`:`${botSafeName(s,m.home)} and ${botSafeName(s,m.away)} tied`;
      let remark;
      if(!winner)remark='Nobody won. Somehow both teams still have to live with it.';
      else if(margin>=40)remark=botPick(m.id,['That was not a matchup. That was a public demonstration.','Someone should have invoked the mercy rule.']);
      else if(margin<=3)remark=botPick(m.id,['That finish needed a heart monitor.','One bad lineup decision away from a different headline.']);
      else remark=botPick(m.id,['The scoreboard has spoken. The excuses are next.','A win is a win. The group chat will be unbearable.']);
      out.push({key:`final:${week}:${m.id}`,body:`🏁 THE AUDIBLE | WEEK ${week}: ${label}, ${m.homeScore.toFixed(1)}–${m.awayScore.toFixed(1)}. ${remark}`});
    }
  }
  return out;
}
let botBusy=false;
async function publishLockerBot(){
  if(botBusy)return;botBusy=true;
  try{
    const {state:s}=await snapshot(),leagueId=botLeagueId(s);
    // New installations do not backfill years of historical transaction chatter.
    await pool.query(`INSERT INTO fantasy_audible_bot_cursor(league_id,last_at)
      VALUES($1,NOW()) ON CONFLICT(league_id) DO NOTHING`,[leagueId]);
    const cursor=await pool.query('SELECT last_at FROM fantasy_audible_bot_cursor WHERE league_id=$1',[leagueId]);
    const since=Date.parse(cursor.rows[0].last_at);
    const posts=[];
    for(const edition of s.editorial||[])posts.push({key:`edition:${edition.id}`,body:botEditionText(edition)});
    for(const tx of s.transactions||[]){if(Date.parse(tx.at)<=since)continue;
      const body=botEventText(s,tx);if(body)posts.push({key:`event:${tx.id}`,body});}
    // Only final scores; skip retroactive historic matchups on initial deployment.
    for(const post of botMatchupPosts(s)){
      const parts=post.key.split(':'),m=s.weeklyLedger?.[parts[1]]?.matchups?.[parts.slice(2).join(':')];
      if(m&&Date.parse(m.updatedAt)>since)posts.push(post);
    }
    const client=await pool.connect();
    try{await client.query('BEGIN');
      for(const post of posts.slice(0,120))await client.query(`WITH inserted AS (
        INSERT INTO fantasy_audible_bot_events(league_id,event_key) VALUES($1,$2)
        ON CONFLICT DO NOTHING RETURNING event_key)
        INSERT INTO fantasy_audible_chat(league_id,manager,body)
        SELECT $1,$3,$4 FROM inserted`,[leagueId,post.key,BOT_MANAGER,post.body.slice(0,1000)]);
      await client.query('UPDATE fantasy_audible_bot_cursor SET last_at=NOW() WHERE league_id=$1',[leagueId]);
      await client.query('COMMIT');
    }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
  }catch(e){console.error('Locker Room bot:',e.message);}finally{botBusy=false;}
}
function safeState(s,accounts,user){return {...s,editorial:(s.editorial||[]).slice(0,48),matchupSchedule:s.frozenMatchupSchedule||{},standings:leagueStandings(s,accounts),settings:settingsOf(s),managers:s.managers.map(m=>({...m,
  claimed:accounts.some(a=>a.manager===m.id),
  ...(user.commissioner?{registeredEmail:accounts.find(a=>a.manager===m.id)?.email||null}: {})})),draftPreferences:{[user.manager]:preferencesOf(s,user.manager)},
  viewer:{manager:user.manager,commissioner:user.commissioner,name:user.name}};}
function pushState(s,accounts){for(const [res,id] of clients){const a=accounts.find(x=>x.id===id);
  if(!a){clients.delete(res);try{res.end();}catch{}continue;}try{res.write('data: '+JSON.stringify(safeState(s,accounts,a))+'\n\n');}
  catch{clients.delete(res);}}}
function send(res,status,data){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});
  res.end(JSON.stringify(data));}
function failure(status,error){return {status,error};}
function hashPassword(password,salt){return crypto.scryptSync(password,salt,64).toString('hex');}
function tokenHash(token){return crypto.createHash('sha256').update(token).digest('hex');}
function findUser(req,accounts){const url=new URL(req.url,'http://localhost');
  const h=req.headers.authorization||'';const token=h.startsWith('Bearer ')?h.slice(7):url.searchParams.get('token')||'';
  if(!/^[a-f0-9]{64}$/.test(token))return null;const hash=tokenHash(token);
  return accounts.find(a=>Array.isArray(a.sessions)&&a.sessions.some(s=>s.hash===hash&&s.expires>Date.now()))||null;}
function teamName(v){if(typeof v!=='string')return null;const name=v.trim().replace(/\s+/g,' ');
  return name.length>=3&&name.length<=40&&!/[<>\x00-\x1f]/.test(name)?name:null;}
function taken(s,name,except){return s.managers.some(m=>m.id!==except&&m.team.toLowerCase()===name.toLowerCase());}
function availableSlot(s,accounts){const existing=s.managers.find(m=>!accounts.some(a=>a.manager===m.id));
  if(existing)return existing;if(s.managers.length>=MAX_TEAMS)return null;
  let n=1;while(s.managers.some(m=>m.id==='m'+n)||(s.archivedTeams||[]).some(m=>m.id==='m'+n))n++;
  const slot={id:'m'+n,name:'Manager '+n,team:'Team '+n};s.managers.push(slot);return slot;}
function audit(s,type,manager,details){s.transactions.unshift({id:crypto.randomUUID(),at:new Date().toISOString(),type,manager,details});}
async function init(){await pool.query(`CREATE TABLE IF NOT EXISTS fantasy_audible_store
  (id INTEGER PRIMARY KEY CHECK(id=1),state JSONB NOT NULL,accounts JSONB NOT NULL)`);
  await pool.query(`INSERT INTO fantasy_audible_store(id,state,accounts) VALUES(1,$1,$2)
    ON CONFLICT(id) DO NOTHING`,[JSON.stringify(initialState()),'[]']);
  // Migrate legacy persisted league state without resetting managers or rosters.
  await pool.query(`UPDATE fantasy_audible_store
    SET state=jsonb_set(state,'{settings}', $1::jsonb || COALESCE(state->'settings','{}'::jsonb),true)
    WHERE id=1 AND (NOT (state ? 'settings') OR NOT (state->'settings' ? 'roster'))`,
    [JSON.stringify(DEFAULT_SETTINGS)]);
  await pool.query(`CREATE TABLE IF NOT EXISTS fantasy_audible_chat (
    id BIGSERIAL PRIMARY KEY, manager TEXT NOT NULL, body TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), deleted_at TIMESTAMPTZ,
    deleted_by TEXT)`);
  await pool.query(`ALTER TABLE fantasy_audible_chat ADD COLUMN IF NOT EXISTS league_id TEXT NOT NULL DEFAULT 'default'`);
  await pool.query(`CREATE TABLE IF NOT EXISTS fantasy_audible_bot_events (
    league_id TEXT NOT NULL,event_key TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY(league_id,event_key))`);
  await pool.query(`CREATE TABLE IF NOT EXISTS fantasy_audible_bot_cursor (
    league_id TEXT PRIMARY KEY,last_at TIMESTAMPTZ NOT NULL)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS fantasy_audible_chat_media (
    message_id BIGINT PRIMARY KEY REFERENCES fantasy_audible_chat(id) ON DELETE CASCADE,
    mime TEXT NOT NULL, bytes BYTEA NOT NULL)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS fantasy_audible_chat_mutes (
    manager TEXT PRIMARY KEY, muted_by TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS fantasy_audible_push (
    endpoint TEXT PRIMARY KEY, manager TEXT NOT NULL, subscription JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW())`);
  await initializeESPN();}
async function snapshot(){const r=await pool.query('SELECT state,accounts FROM fantasy_audible_store WHERE id=1');
  if(!r.rows.length)throw Error('Database not initialized');return r.rows[0];}
async function change(fn){const c=await pool.connect();try{await c.query('BEGIN');
  const r=await c.query('SELECT state,accounts FROM fantasy_audible_store WHERE id=1 FOR UPDATE');
  const {state,accounts}=r.rows[0];const result=await fn(state,accounts);
  if(result?.error){await c.query('ROLLBACK');return result;}
  state.version=(state.version||0)+1;
  await c.query('UPDATE fantasy_audible_store SET state=$1,accounts=$2 WHERE id=1',
    [JSON.stringify(state),JSON.stringify(accounts)]);
  await c.query('COMMIT');pushState(state,accounts);return result;
  }catch(e){try{await c.query('ROLLBACK');}catch{}throw e;}finally{c.release();}}
function bodyOf(req,maxLength=100000){return new Promise((resolve,reject)=>{let raw='';let done=false;
  req.on('data',chunk=>{if(done)return;raw+=chunk;if(raw.length>maxLength){done=true;
    reject(Error('Request too large'));req.destroy();}});
  req.on('end',()=>{if(done)return;try{resolve(JSON.parse(raw||'{}'));}catch{reject(Error('Invalid JSON'));}});
  req.on('error',reject);});}
function rankedPlayers(players){return [...players].sort((a,b)=>
  (a.rank??Infinity)-(b.rank??Infinity)||
  (a.averageDraftPosition??Infinity)-(b.averageDraftPosition??Infinity)||a.name.localeCompare(b.name));}
async function draftPool(){const data=await getESPNPlayers();if(!Array.isArray(data.players))throw Error('ESPN player pool unavailable');return data;}
function createDraftOrder(ids,rounds){const order=[];for(let round=1;round<=rounds;round++){
  const seq=round%2?[...ids]:[...ids].reverse();for(const manager of seq)order.push({round,manager});}return order;}
function currentPick(d){return d.order[d.picks.length]||null;}
function draftResult(s){const d=ensureDraft(s);return {...d,currentPick:currentPick(d),
  overallPick:d.picks.length+1,totalPicks:d.order.length};}
function nextDeadline(d){d.deadline=new Date(Date.now()+d.secondsPerPick*1000).toISOString();}
function countsFor(s,id){const counts=Object.fromEntries(POSITIONS.map(p=>[p,0]));
  for(const pick of ensureDraft(s).picks)if(pick.manager===id&&counts[pick.position]!==undefined)counts[pick.position]++;
  return counts;}
function requiredPositions(roster){const st=roster.starters;return {
  QB:st.QB,RB:st.RB,WR:st.WR,TE:st.TE,'D/ST':st['D/ST'],K:st.K};}
function minimumUnfilled(counts,roster){const req=requiredPositions(roster);
  let missing=Object.keys(req).reduce((n,pos)=>n+Math.max(0,req[pos]-counts[pos]),0);
  const flex=roster.starters.FLEX;
  const skill=['RB','WR','TE'].reduce((n,pos)=>n+Math.max(0,counts[pos]-req[pos]),0);
  return missing+Math.max(0,flex-skill);}
function legalPosition(s,id,pos){if(!POSITIONS.includes(pos))return false;
  const roster=settingsOf(s).roster;const counts=countsFor(s,id);
  if(counts[pos]>=roster.maximums[pos])return false;
  const draft=ensureDraft(s);const teamTotal=draft.order.filter(x=>x.manager===id).length;
  const teamPicks=draft.picks.filter(x=>x.manager===id).length;
  const remainingAfter=teamTotal-teamPicks-1;
  if(remainingAfter<0)return false;
  counts[pos]++;
  return minimumUnfilled(counts,roster)<=remainingAfter;
}
function availableFor(s,players,id){const selected=new Set(ensureDraft(s).picks.map(p=>String(p.playerId)));
  return rankedPlayers(players).filter(p=>!selected.has(String(p.id))&&legalPosition(s,id,p.position));}
function injuryOut(p){return ['OUT','IR','INJURED_RESERVE','INJURY_RESERVE','INJURED_RESERVE_DESIGNATED_TO_RETURN','RESERVE_INJURED','DOUBTFUL','SUSPENSION','SUSPENDED','PUP','PHYSICALLY_UNABLE_TO_PERFORM','NFI','NON_FOOTBALL_INJURY'].includes(
  String(p.injuryStatus||'').toUpperCase().replace(/[\s-]+/g,'_'));}
function chooseAutomatic(s,players,id){let available=availableFor(s,players,id);
  if(!available.length)return null;const pref=preferencesOf(s,id);
  if(pref.avoidOut){const healthy=available.filter(p=>!injuryOut(p));if(healthy.length)available=healthy;}
  const queued=(pref.queue||[]).map(String);
  for(const q of queued){const match=available.find(p=>String(p.id)===q);if(match)return match;}
  if(pref.strategy==='bpa')return available[0];
  const roster=settingsOf(s).roster, counts=countsFor(s,id), req=requiredPositions(roster);
  const missing=Object.keys(req).filter(pos=>counts[pos]<req[pos]);
  const flexNeed=roster.starters.FLEX>
    ['RB','WR','TE'].reduce((n,pos)=>n+Math.max(0,counts[pos]-req[pos]),0);
  const needs=available.filter(p=>missing.includes(p.position)||
    (flexNeed&&['RB','WR','TE'].includes(p.position)));
  if(pref.strategy==='starters'&&needs.length)return needs[0];
  if(pref.strategy==='custom'){
    const priority=Array.isArray(pref.positionPriority)?pref.positionPriority:DEFAULT_PREFERENCES.positionPriority;
    for(const pos of priority){const found=available.find(p=>p.position===pos);if(found)return found;}
  }
  if(pref.strategy==='balanced'){
    const teamPicks=ensureDraft(s).picks.filter(p=>p.manager===id).length;
    const teamTotal=ensureDraft(s).order.filter(x=>x.manager===id).length;
    const left=teamTotal-teamPicks;
    const missingCount=minimumUnfilled(counts,roster);
    if(missingCount>=left&&needs.length)return needs[0];
    // Use BPA within needed positions, but avoid early K/DST reaches.
    const skillNeeds=needs.filter(p=>!['K','D/ST'].includes(p.position));
    const first=skillNeeds[0]||needs[0];
    if(first){const overall=available[0];
      if(!overall)return first;
      const rankA=Number.isFinite(first.rank)?first.rank:9999;
      const rankB=Number.isFinite(overall.rank)?overall.rank:9999;
      const allowedReach=left>5?20:40;
      if(rankA-rankB<=allowedReach)return first;
    }
    // If starters are covered, seek underrepresented depth positions.
    const target={QB:2,RB:4,WR:4,TE:2,'D/ST':1,K:1};
    const depth=available.filter(p=>counts[p.position]<Math.min(target[p.position],roster.maximums[p.position]));
    if(depth.length){const best=depth[0];const top=available[0];
      if((best.rank??9999)-(top.rank??9999)<=25)return best;}
  }
  return available[0];
}
// Fill only vacant starting slots; never replace a manager's selections.
function autoFillStarters(s, managerId){
  const caps=settingsOf(s).roster.starters;
  const owned=s.players.filter(p=>p.owner===managerId);
  const assigned=[];
  const intentional=s.intentionalEmptySlots?.[managerId]||{};
  const rankValue=p=>{
    const projected=Number(p.projectedPoints);
    const rank=Number(p.rank);
    return [Number.isFinite(projected)&&projected>0?projected:-Infinity,
      Number.isFinite(rank)&&rank>0?-rank:-Infinity];
  };
  const candidates=owned.filter(p=>p.slot==='BENCH'&&!p.scoringMode&&!lineupLocked(s,p))
    .sort((a,b)=>{const x=rankValue(a),y=rankValue(b);return y[0]-x[0]||y[1]-x[1];});
  // Dedicated positions first; FLEX receives the strongest remaining RB/WR/TE.
  for(const slot of ['QB','RB','WR','TE','D/ST','K','FLEX']){
    const capacity=Number(caps[slot]||0);
    let filled=owned.filter(p=>p.slot===slot).length;
    const reserved=Math.min(Math.max(0,Number(intentional[slot])||0),Math.max(0,capacity-filled));
    while(filled<capacity-reserved){
      const next=candidates.find(p=>p.slot==='BENCH'&&slotEligible(p,slot));
      if(!next)break;
      next.slot=slot;assigned.push(next.name+' ('+slot+')');filled++;
    }
  }
  if(assigned.length)audit(s,'AUTO_LINEUP',managerId,'Filled empty starter slots: '+assigned.join(', '));
  return assigned.length;
}
function recordPick(s,player,automatic=false){const d=ensureDraft(s),turn=currentPick(d);
  if(!turn)return failure(409,'Draft is complete');
  if(d.picks.some(p=>String(p.playerId)===String(player.id)))return failure(409,'Player already drafted');
  if(!legalPosition(s,turn.manager,player.position))return failure(409,'Position maximum reached or required starters would become impossible to fill');
  const overall=d.picks.length+1;
  const pick={overall,round:turn.round,manager:turn.manager,playerId:String(player.id),
    playerName:player.name,position:player.position,nflTeamId:player.nflTeamId,
    rank:player.rank,projectedPoints:player.projectedPoints,automatic,at:new Date().toISOString()};
  d.picks.push(pick);s.players.push({id:'espn-'+player.id,espnId:String(player.id),
    name:player.name,team:String(player.nflTeamId??''),pos:player.position,
    kickoff:99,status:'upcoming',points:0,slot:'BENCH',owner:turn.manager,
    projectedPoints:player.projectedPoints,rank:player.rank,injuryStatus:player.injuryStatus||'UNKNOWN',
    nflTeamId:player.nflTeamId,acquisitionType:'DRAFT',lastAcquisitionType:'DRAFT'});
  audit(s,automatic?'AUTO_PICK':'DRAFT_PICK',turn.manager,player.name+' selected at pick '+overall);
  if(d.picks.length>=d.order.length){d.status='completed';d.deadline=null;d.remainingSeconds=null;
    for(const manager of new Set(d.order.map(p=>p.manager)))autoFillStarters(s,manager);
    audit(s,'DRAFT_COMPLETE',null,'Draft completed');setTimeout(activateLeagueSchedule,0);}else nextDeadline(d);
  return {ok:true,pick};}
// A committed injury swap permanently retires the removed player for that NFL week.
// Persisted in the league state so restarts cannot undo the decision.
function injurySwapWeek(s){return Number(s.week)||1;}
function injurySwapRetired(s,player){return Boolean(player&&s.injurySwapHistory?.some(x=>
  x.week===injurySwapWeek(s)&&x.removedId===player.id));}
function injurySwapCurrentSlot(s,player){return Boolean(player&&s.injurySwapHistory?.some(x=>
  x.week===injurySwapWeek(s)&&x.replacementId===player.id));}
function eligibility(s,starter,bench){if(!starter||!bench||starter.owner!==bench.owner||
  starter.slot==='BENCH'||bench.slot!=='BENCH'||starter.pos!==bench.pos||
  injurySwapRetired(s,starter)||injurySwapRetired(s,bench))return null;
  // Real NFL schedule supersedes demo phase counters for drafted ESPN players.
  if(starter.espnId&&bench.espnId){
    const games=s.nflSync?.games||[];
    const starterGame=games.find(g=>g.teams?.some(t=>String(t.id)===String(starter.nflTeamId)));
    const benchGame=games.find(g=>g.teams?.some(t=>String(t.id)===String(bench.nflTeamId)));
    if(!starterGame||!benchGame)return null; // Fail closed without authoritative games.
    if(starterGame.id===benchGame.id)return bench.nflTeamId===starter.nflTeamId&&
      starterGame.status==='live'?'handcuff':null;
    return benchGame.status==='upcoming'&&Date.parse(benchGame.kickoff)>Date.now()?'later':null;
  }
  if(starter.team===bench.team&&bench.kickoff<=s.phase)return 'handcuff';
  if(bench.kickoff>s.phase)return 'later';return null;}
// Lineup moves are validated against the stored roster and game state.
// A lineup edit uses a freshly verified NFL-week schedule, not the optional
// scoring snapshot (which may not exist until the draft is complete).
function lineupLockReason(s,player,verifiedSchedule){
  if(!player)return 'Missing player';
  if(player.espnId||player.nflGame){
    if(!verifiedSchedule||!Array.isArray(verifiedSchedule.games))return 'NFL schedule unavailable';
    const id=liveNFL.teamId(player);
    if(!id)return 'NFL team could not be identified';
    const game=verifiedSchedule.games.find(g=>g.teams?.some(t=>String(t.id)===String(id)));
    if(!game)return verifiedSchedule.games.length<10?'NFL schedule incomplete':null; // bye
    const kickoff=Date.parse(game.kickoff);
    if(!Number.isFinite(kickoff))return 'Kickoff timestamp unavailable';
    // The verified UTC kickoff is authoritative. ESPN status is not a substitute:
    // stale status labels must not lock players before kickoff.
    if(Date.now()>=kickoff)return `NFL kickoff passed (${new Date(kickoff).toISOString()}, season ${verifiedSchedule.season}, week ${verifiedSchedule.week})`;
    return null;
  }
  if(['playing','injured','finished','final','completed'].includes(String(player.status).toLowerCase()))return 'Legacy player status: '+player.status;
  if(player.kickoffAt){const at=Date.parse(player.kickoffAt);if(Number.isFinite(at)&&Date.now()>=at)return 'Stored kickoff passed: '+player.kickoffAt;}
  if(typeof player.kickoff==='number'&&player.kickoff!==99&&player.kickoff<=s.phase)return 'Legacy demo phase lock';
  return null;
}
function lineupLocked(s,player,verifiedSchedule){return lineupLockReason(s,player,verifiedSchedule)!==null;}

function slotEligible(player,slot){return slot==='FLEX'?['RB','WR','TE'].includes(player.pos):player.pos===slot;}
function lineupCapacity(s,slot){return slot==='BENCH'?settingsOf(s).roster.bench:
  slot==='IR'?settingsOf(s).roster.ir:settingsOf(s).roster.starters[slot];}
function eligibleIR(player){return ['OUT','IR','INJURED_RESERVE','PUP','NFI'].includes(
  String(player.injuryStatus||'').toUpperCase());}
function assignLineup(s,actor,body,verifiedSchedule){
  const player=s.players.find(p=>p.id===body.playerId&&p.owner===actor.manager);
  const target=String(body.slot||'');
  const allowed=['QB','RB','WR','TE','FLEX','D/ST','K','BENCH','IR'];
  if(!player)return failure(404,'Player not found on your roster');
  if(!allowed.includes(target)||!Number.isInteger(lineupCapacity(s,target))||lineupCapacity(s,target)<1)
    return failure(400,'Invalid or disabled roster slot');
  if(injurySwapRetired(s,player))return failure(409,'Player was substituted out and cannot return this NFL week');
  if(player.slot===target)return {ok:true};
  if(lineupLocked(s,player,verifiedSchedule))return failure(409,'This player is locked after kickoff');
  if(target==='IR'&&!eligibleIR(player))return failure(409,'Only IR/out-designated players can enter IR');
  if(!['BENCH','IR'].includes(target)&&!slotEligible(player,target))
    return failure(409,'Player is not eligible for this starting position');
  if(s.injuries?.some(i=>i.active&&i.player===player.id))
    return failure(409,'Resolve the pending injury decision first');
  if(player.scoringMode||player.scoreAtSwap!==undefined)
    return failure(409,'An injury substitution cannot be reversed through lineup management');
  const mine=s.players.filter(p=>p.owner===actor.manager);
  const occupied=mine.filter(p=>p.slot===target&&p.id!==player.id);
  if(occupied.length>=lineupCapacity(s,target)){
    // Move to an occupied starting slot by swapping with its existing starter.
    // Bench/IR slots cannot silently displace another player.
    if(['BENCH','IR'].includes(target))return failure(409,'That roster section is full');
    const displacedId=String(body.displacedId||'');
    const displaced=occupied.find(p=>p.id===displacedId);
    if(!displaced)return failure(409,'Choose which starter to replace');
    if(injurySwapRetired(s,displaced))return failure(409,'Substituted-out player cannot return this NFL week');
    if(lineupLocked(s,displaced,verifiedSchedule))return failure(409,'The current starter is locked');
    if(s.injuries?.some(i=>i.active&&i.player===displaced.id)||displaced.scoringMode)
      return failure(409,'The current starter cannot be moved');
    if(player.slot==='IR'&&!eligibleIR(displaced))return failure(409,'Cannot swap a healthy player into IR');
    if(!['BENCH','IR'].includes(player.slot)&&!slotEligible(displaced,player.slot))
      return failure(409,'Displaced player cannot fill the previous starting slot');
    displaced.slot=player.slot;
  }else if(player.slot!=='BENCH'&&player.slot!=='IR'){
    // Vacating a starting position is allowed, subject to bench capacity.
  }
  player.slot=target;
  audit(s,'LINEUP_CHANGE',actor.manager,player.name+' moved to '+target);
  return {ok:true};
}
// Save a complete starting lineup atomically. No partial moves are committed.
function saveStartingLineup(s,actor,body,verifiedSchedule){
  const starters=settingsOf(s).roster.starters;
  const slots=Object.entries(starters).flatMap(([position,count])=>
    Array.from({length:count},(_,index)=>position+':'+index));
  const requested=body.lineup;
  if(!requested||typeof requested!=='object'||Array.isArray(requested)||
    Object.keys(requested).length!==slots.length||
    Object.keys(requested).some(key=>!slots.includes(key)))
    return failure(400,'Submit every starting lineup position');
  const mine=s.players.filter(p=>p.owner===actor.manager);
  const byId=new Map(mine.map(p=>[p.id,p]));
  const selected=new Set();
  const proposed=new Map();
  for(const key of slots){
    const id=requested[key];
    if(id!==null&&typeof id!=='string')return failure(400,'Invalid lineup selection');
    if(id!==null){
      if(!byId.has(id))return failure(403,'Player not on your roster');
      if(selected.has(id))return failure(409,'A player cannot occupy two starting slots');
      selected.add(id);
      const player=byId.get(id),position=key.split(':')[0];
      if(!slotEligible(player,position))return failure(409,player.name+' is not eligible at '+position);
      if(player.slot==='IR')return failure(409,player.name+' must be moved off IR first');
      if(injurySwapRetired(s,player))return failure(409,player.name+' was substituted out and cannot return this NFL week');
      proposed.set(id,position);
    }
  }
  // Protect existing locked starters, including their exact numbered slot.
  for(const [position,count] of Object.entries(starters)){
    const existing=mine.filter(p=>p.slot===position);
    for(let index=0;index<existing.length;index++){
      const player=existing[index];
      const key=position+':'+index;
      if((lineupLocked(s,player,verifiedSchedule)||injurySwapCurrentSlot(s,player)||player.scoringMode||
        s.injuries?.some(i=>i.active&&i.player===player.id))&&requested[key]!==player.id)
        return failure(409,player.name+' is locked in '+key+' ('+(lineupLockReason(s,player,verifiedSchedule)|| (player.scoringMode?'injury substitution already committed':'pending injury decision'))+')');
    }
  }
  for(const player of mine){
    const target=proposed.get(player.id)||
      (player.slot==='IR'?'IR':'BENCH');
    if(target!==player.slot&&lineupLocked(s,player,verifiedSchedule))
      return failure(409,player.name+' is locked after kickoff ('+lineupLockReason(s,player,verifiedSchedule)+')');
    if(target!==player.slot&&(injurySwapRetired(s,player)||injurySwapCurrentSlot(s,player)||player.scoringMode||player.scoreAtSwap!==undefined||
      s.injuries?.some(i=>i.active&&i.player===player.id)))
      return failure(409,player.name+' cannot be moved after an injury decision');
  }
  const benchCount=mine.filter(p=>!proposed.has(p.id)&&p.slot!=='IR').length;
  if(benchCount>settingsOf(s).roster.bench)
    return failure(409,'Bench capacity exceeded. Fill more starting positions.');
  for(const player of mine){
    player.slot=proposed.get(player.id)||(player.slot==='IR'?'IR':'BENCH');
  }
  // Explicit empty selections are intentional and must not be auto-filled later.
  s.intentionalEmptySlots ||= {};
  s.intentionalEmptySlots[actor.manager]=Object.fromEntries(Object.entries(starters).map(([position,count])=>
    [position,Array.from({length:count},(_,index)=>requested[position+':'+index]).filter(id=>id===null).length]));
  audit(s,'LINEUP_SAVED',actor.manager,'Starting lineup saved');
  return {ok:true};
}
function validateSettings(input){if(!input||typeof input!=='object'||Array.isArray(input))return null;
  const previous=DEFAULT_SETTINGS;
  const result=structuredClone(previous);
  const r=input.roster;
  if(!r||typeof r!=='object'||!r.starters||!r.maximums)return null;
  for(const pos of [...POSITIONS,'FLEX']){
    if(pos==='FLEX'){
      const n=r.starters.FLEX;if(!Number.isInteger(n)||n<0||n>3)return null;result.roster.starters.FLEX=n;
    }else{
      const a=r.starters[pos],b=r.maximums[pos];
      if(!Number.isInteger(a)||a<0||a>8||!Number.isInteger(b)||b<a||b>12)return null;
      result.roster.starters[pos]=a;result.roster.maximums[pos]=b;
    }
  }
  for(const field of ['bench','ir']){const n=r[field];if(!Number.isInteger(n)||n<0||n>20)return null;
    result.roster[field]=n;}
  const starterCount=Object.values(result.roster.starters).reduce((a,b)=>a+b,0);
  if(starterCount+result.roster.bench<2||starterCount+result.roster.bench>30)return null;
  if(result.roster.starters.FLEX>0&&
    ['RB','WR','TE'].reduce((n,p)=>n+result.roster.maximums[p]-result.roster.starters[p],0)<result.roster.starters.FLEX)return null;
  for(const [group,defaults] of Object.entries(DEFAULT_SCORING)){
    if(!input.scoring?.[group]||typeof input.scoring[group]!=='object')return null;
    for(const key of Object.keys(defaults)){
      const n=input.scoring[group][key];if(typeof n!=='number'||!Number.isFinite(n)||n< -100||n>100)return null;
      result.scoring[group][key]=n;
    }
  }
  const t=input.transactions;if(!t||typeof t!=='object')return null;
  if(!Number.isInteger(t.waiverDays)||t.waiverDays<0||t.waiverDays>7)return null;
  if(t.acquisitionLimit!==null&&(!Number.isInteger(t.acquisitionLimit)||t.acquisitionLimit<0||t.acquisitionLimit>1000))return null;
  if(t.playerUniverse!=='ALL_NFL'||t.lineupLock!=='INDIVIDUAL_KICKOFF'||typeof t.undroppableList!=='boolean')return null;
  result.transactions={...t};return result;}
function validatePreferences(input){if(!input||typeof input!=='object')return null;
  const strategy=String(input.strategy||'balanced');if(!STRATEGIES.includes(strategy))return null;
  if(typeof input.autoDraft!=='boolean'||typeof input.avoidOut!=='boolean')return null;
  const priority=input.positionPriority;
  if(!Array.isArray(priority)||priority.length!==POSITIONS.length||
    new Set(priority).size!==POSITIONS.length||priority.some(p=>!POSITIONS.includes(p)))return null;
  const queue=input.queue;if(!Array.isArray(queue)||queue.length>200||
    queue.some(id=>!/^\d{1,20}$/.test(String(id))))return null;
  return {strategy,autoDraft:input.autoDraft,avoidOut:input.avoidOut,
    positionPriority:priority,queue:[...new Set(queue.map(String))]};}
async function processAutomaticTurn(){const data=await snapshot(),d=ensureDraft(data.state);
  if(d.status!=='active'||!d.deadline)return;
  const turn=currentPick(d);if(!turn)return;
  const expired=Date.now()>=Date.parse(d.deadline);
  const immediate=preferencesOf(data.state,turn.manager).autoDraft;
  if(!expired&&!immediate)return;
  let poolData;try{poolData=await draftPool();}catch(e){console.error('Auto-pick data unavailable:',e.message);
    if(expired)await change(s=>{const x=ensureDraft(s);
      if(x.status==='active'&&x.deadline&&Date.now()>=Date.parse(x.deadline)){
        x.status='paused';x.remainingSeconds=x.secondsPerPick;x.deadline=null;
        audit(s,'DRAFT_PAUSED',null,'Draft paused because player data is unavailable');}
      return {ok:true};});return;}
  await change(s=>{const x=ensureDraft(s),t=currentPick(x);
    if(x.status!=='active'||!t||!x.deadline)return {ok:true};
    if(Date.now()<Date.parse(x.deadline)&&!preferencesOf(s,t.manager).autoDraft)return {ok:true};
    const player=chooseAutomatic(s,poolData.players,t.manager);
    if(!player){x.status='paused';x.remainingSeconds=x.secondsPerPick;x.deadline=null;
      audit(s,'DRAFT_PAUSED',null,'No eligible players for current pick');return {ok:true};}
    return recordPick(s,player,true);});}
async function api(req,res,route){
  const url=new URL(req.url,'http://localhost');
  if(req.method==='GET'&&route==='/api/teams'){const {state,accounts}=await snapshot();
    return send(res,200,state.managers.map(m=>({id:m.id,team:m.team,
      claimed:accounts.some(a=>a.manager===m.id)})));}
  if(req.method==='POST'&&route==='/api/register'){
    const body=await bodyOf(req),email=String(body.email||'').trim().toLowerCase(),
      password=String(body.password||''),name=teamName(body.teamName);
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||password.length<10)
      return send(res,400,{error:'Valid email and 10-character password required'});
    if(!name)return send(res,400,{error:'Team name must be 3–40 valid characters'});
    const result=await change((s,accounts)=>{const d=ensureDraft(s);
      if(d.status!=='waiting'&&!s.managers.some(m=>!accounts.some(a=>a.manager===m.id)))
        return failure(409,'Registration is closed; no vacant team is available');
      if(accounts.some(a=>a.email===email))return failure(409,'Email already registered');
      if(taken(s,name))return failure(409,'Team name already taken');
      const slot=availableSlot(s,accounts);if(!slot)return failure(409,'League is full (12 teams)');
      const salt=crypto.randomBytes(16).toString('hex'),token=crypto.randomBytes(32).toString('hex');
      accounts.push({id:crypto.randomUUID(),email,name:email.split('@')[0],manager:slot.id,
        commissioner:accounts.length===0,salt,passwordHash:hashPassword(password,salt),
        sessions:[{hash:tokenHash(token),expires:Date.now()+30*86400000}]});
      if(d.status==='waiting')slot.team=name;
      audit(s,'REGISTRATION',slot.id,name+' joined the league'+(d.status==='waiting'?'':' as replacement manager'));return {token};});
    return send(res,result.status||200,result);}
  if(req.method==='POST'&&route==='/api/login'){
    const body=await bodyOf(req),email=String(body.email||'').trim().toLowerCase(),password=String(body.password||'');
    const result=await change((s,accounts)=>{const a=accounts.find(x=>x.email===email);
      if(!a||!/^[a-f0-9]{128}$/.test(a.passwordHash))return failure(401,'Incorrect credentials');
      const candidate=hashPassword(password,a.salt);
      if(!crypto.timingSafeEqual(Buffer.from(candidate,'hex'),Buffer.from(a.passwordHash,'hex')))
        return failure(401,'Incorrect credentials');
      const token=crypto.randomBytes(32).toString('hex');a.sessions=(a.sessions||[]).filter(x=>x.expires>Date.now());
      a.sessions.push({hash:tokenHash(token),expires:Date.now()+30*86400000});return {token};});
    return send(res,result.status||200,result);}
  const current=await snapshot(),user=findUser(req,current.accounts);
  if(!user)return send(res,401,{error:'Please sign in'});
  if(req.method==='GET'&&route==='/api/push/config')
    return send(res,200,{enabled:PUSH_READY,publicKey:PUSH_READY?PUSH_PUBLIC_KEY:null});
  if(req.method==='POST'&&route==='/api/push/subscribe'){
    if(!PUSH_READY)return send(res,503,{error:'Push is not configured on the server'});
    const body=await bodyOf(req),sub=body.subscription;
    if(!sub||typeof sub.endpoint!=='string'||!/^https:\/\//.test(sub.endpoint)||
      sub.endpoint.length>2048||typeof sub.keys?.p256dh!=='string'||typeof sub.keys?.auth!=='string')
      return send(res,400,{error:'Invalid push subscription'});
    await pool.query(`INSERT INTO fantasy_audible_push(endpoint,manager,subscription) VALUES($1,$2,$3)
      ON CONFLICT(endpoint) DO UPDATE SET manager=$2,subscription=$3`,[sub.endpoint,user.manager,JSON.stringify(sub)]);
    return send(res,200,{ok:true});
  }
  if(req.method==='POST'&&route==='/api/push/unsubscribe'){
    const body=await bodyOf(req);
    if(typeof body.endpoint!=='string')return send(res,400,{error:'Invalid endpoint'});
    await pool.query('DELETE FROM fantasy_audible_push WHERE endpoint=$1 AND manager=$2',[body.endpoint,user.manager]);
    return send(res,200,{ok:true});
  }
  if(req.method==='POST'&&route==='/api/push/test'){
    if(!PUSH_READY)return send(res,503,{error:'Push is not configured on the server'});
    const result=await notifyManager(user.manager,{title:'Fantasy Audible test',body:'Push notifications are enabled.',url:'/'});
    return send(res,result?200:409,result?{ok:true}:{error:'No active subscription or delivery failed'});
  }
  if(req.method==='GET'&&route==='/api/state'){
    // One-time, non-destructive backfill for leagues drafted before auto-lineup existed.
    if(ensureDraft(current.state).status==='completed'&&
      current.state.players.some(p=>p.owner&&p.slot==='BENCH')&&
      current.state.managers.some(m=>{
        const mine=current.state.players.filter(p=>p.owner===m.id);
        return mine.some(p=>p.slot==='BENCH')&&Object.entries(settingsOf(current.state).roster.starters)
          .some(([slot,count])=>mine.filter(p=>p.slot===slot).length<count&&
            mine.some(p=>p.slot==='BENCH'&&slotEligible(p,slot)));})){
      await change(s=>{if(ensureDraft(s).status==='completed')
        for(const m of s.managers)autoFillStarters(s,m.id);
        return {ok:true};});
      const fresh=await snapshot();return send(res,200,safeState(fresh.state,fresh.accounts,user));
    }
    return send(res,200,safeState(current.state,current.accounts,user));
  }
  if(req.method==='GET'&&route==='/api/events'){
    res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform',Connection:'keep-alive'});
    res.write('data: '+JSON.stringify(safeState(current.state,current.accounts,user))+'\n\n');
    clients.set(res,user.id);req.on('close',()=>clients.delete(res));return;}
  // GIPHY Web API key is delivered to authenticated clients; GIPHY requires client-side searches.
  if(route==='/api/chat/giphy/config'&&req.method==='GET'){
    const key=String(process.env.GIPHY_API_KEY||'').trim();
    if(!key)return send(res,503,{error:'GIPHY is not configured. Add GIPHY_API_KEY in Render environment settings.'});
    return send(res,200,{apiKey:key});
  }
  // Private league chat. All endpoints require an active league account.
  if(route==='/api/chat'&&req.method==='GET'){
    const before=Number(url.searchParams.get('before')||0);
    const values=[botLeagueId(current.state)];let where='WHERE deleted_at IS NULL AND league_id=$1';
    if(Number.isSafeInteger(before)&&before>0){values.push(before);where+=' AND id < $2';}
    const r=await pool.query(`SELECT id,manager,body,created_at, EXISTS(SELECT 1 FROM fantasy_audible_chat_media cm WHERE cm.message_id=fantasy_audible_chat.id) AS has_media FROM fantasy_audible_chat ${where} ORDER BY id DESC LIMIT 100`,values);
    const muted=await pool.query('SELECT manager FROM fantasy_audible_chat_mutes');
    return send(res,200,{messages:r.rows.reverse(),muted:muted.rows.some(x=>x.manager===user.manager),
      mutedManagers:user.commissioner?muted.rows.map(x=>x.manager):undefined});
  }
  if(route==='/api/chat'&&req.method==='POST'){
    const body=await bodyOf(req),message=String(body.message||'').trim();
    if(!message||message.length>1000||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(message))
      return send(res,400,{error:'Message must be 1–1000 characters'});
    const mute=await pool.query('SELECT 1 FROM fantasy_audible_chat_mutes WHERE manager=$1',[user.manager]);
    if(mute.rowCount)return send(res,403,{error:'You are muted by the commissioner'});
    const r=await pool.query(`INSERT INTO fantasy_audible_chat(league_id,manager,body) VALUES($1,$2,$3)
      RETURNING id,manager,body,created_at`,[botLeagueId(current.state),user.manager,message]);
    return send(res,201,{message:r.rows[0]});
  }
  // Uploaded GIFs are disabled: use externally hosted GIPHY GIFs instead.
  if(route==='/api/chat/media'&&req.method==='POST')
    return send(res,410,{error:'GIF uploads are disabled. Use the GIPHY GIF picker.'});
  if(route==='/api/chat/media'&&req.method==='GET'){
    const id=Number(url.searchParams.get('id'));
    if(!Number.isSafeInteger(id)||id<1)return send(res,400,{error:'Invalid GIF'});
    const result=await pool.query(`SELECT cm.mime,cm.bytes FROM fantasy_audible_chat_media cm
      JOIN fantasy_audible_chat c ON c.id=cm.message_id WHERE cm.message_id=$1 AND c.deleted_at IS NULL AND c.league_id=$2`,[id,botLeagueId(current.state)]);
    if(!result.rowCount)return send(res,404,{error:'GIF not found'});
    res.writeHead(200,{'Content-Type':'image/gif','Cache-Control':'private, max-age=120',
      'X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"});
    return res.end(result.rows[0].bytes);
  }
  if(route==='/api/chat/delete'&&req.method==='POST'){
    if(!user.commissioner)return send(res,403,{error:'Commissioner only'});
    const body=await bodyOf(req),id=Number(body.id);
    if(!Number.isSafeInteger(id)||id<1)return send(res,400,{error:'Invalid message ID'});
    const r=await pool.query(`UPDATE fantasy_audible_chat SET deleted_at=NOW(),deleted_by=$2
      WHERE id=$1 AND league_id=$3 AND deleted_at IS NULL RETURNING id`,[id,user.manager,botLeagueId(current.state)]);
    return send(res,r.rowCount?200:404,r.rowCount?{ok:true}:{error:'Message not found'});
  }
  if(route==='/api/chat/mute'&&req.method==='POST'){
    if(!user.commissioner)return send(res,403,{error:'Commissioner only'});
    const body=await bodyOf(req),target=String(body.manager||''),muted=body.muted===true;
    if(target===user.manager||!current.state.managers.some(x=>x.id===target)||
      !current.accounts.some(x=>x.manager===target))return send(res,400,{error:'Invalid active manager'});
    if(muted)await pool.query(`INSERT INTO fantasy_audible_chat_mutes(manager,muted_by)
      VALUES($1,$2) ON CONFLICT(manager) DO UPDATE SET muted_by=$2,created_at=NOW()`,[target,user.manager]);
    else await pool.query('DELETE FROM fantasy_audible_chat_mutes WHERE manager=$1',[target]);
    return send(res,200,{ok:true});
  }
  if(req.method==='GET'&&route==='/api/espn/players'){
    try{const data=await draftPool();return send(res,200,{...data,count:data.players.length});}
    catch(e){return send(res,503,{error:'ESPN player data is not available yet',details:e.message});}}
  if(req.method==='GET'&&route==='/api/nfl/player-metadata'){
    const season=Number(url.searchParams.get('season')||current.state.nflDirectorySync?.season||new Date().getUTCFullYear());
    const week=Number(url.searchParams.get('week'));
    if(!Number.isInteger(season)||season<2020||season>2100||!Number.isInteger(week)||week<1||week>18)
      return send(res,400,{error:'Invalid NFL season or week'});
    try{
      // ESPN fantasy directory carries the athlete's current proTeamId and injury
      // designation. The roster's old team ID is not authoritative after trades.
      const directory=await draftPool();
      const players={};
      for(const p of directory.players){
        const id=String(p.id);
        players[id]={teamId:p.nflTeamId==null?null:String(p.nflTeamId),
          injuryStatus:p.injuryStatus||'UNKNOWN',position:p.position,
          // Season projections must not masquerade as week projections.
          weeklyProjectedPoints:null};
      }
      // Historical projections are estimates, calculated from completed games with
      // the league's configured scoring; never present them as ESPN forecasts.
      let historical=null;
      try{
        const positions=new Map(directory.players.map(p=>[String(p.id),p.position]));
        historical=await matchupAnalytics.analytics(season,week,settingsOf(current.state).scoring,positions);
        for(const [id,entry] of Object.entries(players)){
          const h=historical.players[id];if(h){entry.weeklyProjectedPoints=h.weeklyProjectedPoints;
            entry.projectionMethod=h.projectionMethod;entry.projectionSample=h.projectionSample;}
        }
        const games=await liveNFL.loadWeek(season,week);
        const opponents={};for(const g of games)for(const side of g.teams){
          const opp=g.teams.find(t=>String(t.id)!==String(side.id));
          if(opp)opponents[String(side.id)]=String(opp.id);
        }
        for(const entry of Object.values(players)){
          const opponentId=opponents[String(entry.teamId)];
          const rank=historical.rankings[opponentId+':'+entry.position];
          if(rank){entry.oprk=rank.rank;entry.oprkAverageAllowed=rank.averageAllowed;entry.oprkSample=rank.sample;}
        }
      }catch(e){console.warn('Historical matchup analytics unavailable:',e.message);}
      return send(res,200,{season,week,players,updatedAt:new Date().toISOString(),
        historicalMethod:historical?.method||'Unavailable',historicalGames:historical?.gamesProcessed||0,
        projectionStatus:historical?'HISTORICAL_ESTIMATE':'UNAVAILABLE',oprkStatus:historical&&Object.keys(historical.rankings).length?'HISTORICAL_32_TEAM_RANK':'UNAVAILABLE',
        notice:'Projections are weighted historical estimates using league scoring, not ESPN forecasts. OPRK shown only when a complete 32-defense sample is available.'});
    }catch(e){return send(res,503,{error:'NFL player metadata unavailable',details:e.message});}
  }
  if(req.method==='GET'&&route==='/api/nfl/week-matchups'){
    const season=Number(url.searchParams.get('season')||current.state.nflDirectorySync?.season||process.env.NFL_SEASON||new Date().getUTCFullYear());
    const week=Number(url.searchParams.get('week'));
    if(!Number.isInteger(season)||season<2020||season>2100||!Number.isInteger(week)||week<1||week>18)
      return send(res,400,{error:'Invalid NFL season or week'});
    try{
      const games=await liveNFL.loadWeek(season,week);
      const teams={};
      for(const game of games)for(const side of game.teams){
        const opponent=game.teams.find(x=>x.id!==side.id);
        teams[String(side.id)]={team:side.abbreviation,opponent:opponent?.abbreviation||null,
          homeAway:side.homeAway,kickoff:game.kickoff,status:game.status,gameId:game.id};
      }
      return send(res,200,{season,week,teams,updatedAt:new Date().toISOString()});
    }catch(e){return send(res,503,{error:'NFL weekly schedule unavailable',details:e.message});}
  }
  // v31: Read-only, week-specific NFL boxscore. Does not mutate fantasy scoring or lineups.
  if(req.method==='GET'&&route==='/api/nfl/player-game'){
    const id=String(url.searchParams.get('id')||'');
    const week=Number(url.searchParams.get('week'));
    const season=Number(url.searchParams.get('season')||current.state.nflDirectorySync?.season||new Date().getUTCFullYear());
    if(!/^\d{1,12}$/.test(id)||!Number.isInteger(week)||week<1||week>18||!Number.isInteger(season)||season<2020||season>2100)
      return send(res,400,{error:'Invalid player, season, or week'});
    try{
      const poolData=await draftPool();
      const athlete=poolData.players.find(x=>String(x.id)===id);
      if(!athlete)return send(res,404,{error:'ESPN player not found'});
      const teamId=String(liveNFL.teamId(athlete)||'');
      if(!teamId)return send(res,200,{id,season,week,status:'unavailable',notice:'No verified NFL team assignment'});
      const games=await liveNFL.loadWeek(season,week);
      const game=games.find(g=>g.teams.some(t=>String(t.id)===teamId));
      if(!game)return send(res,200,{id,season,week,status:'bye',notice:'No NFL game scheduled for this player this week'});
      const own=game.teams.find(t=>String(t.id)===teamId),opponent=game.teams.find(t=>String(t.id)!==teamId);
      const result={id,season,week,player:{name:athlete.name,position:athlete.position,team:own?.abbreviation},
        game:{id:game.id,status:game.status,kickoff:game.kickoff,team:own?.abbreviation,opponent:opponent?.abbreviation,
          homeAway:own?.homeAway,teams:game.teams},updatedAt:new Date().toISOString(),provisional:true};
      if(game.status==='upcoming')return send(res,200,{...result,notice:'Game has not started; live statistics are not yet available'});
      // ESPN summaries are cached briefly to avoid duplicate network calls from managers.
      const cacheKey='v31:'+game.id;
      if(!globalThis.fa31GameCache)globalThis.fa31GameCache=new Map();
      const cache=globalThis.fa31GameCache;
      let item=cache.get(cacheKey);
      const ttl=game.status==='final'?600000:20000;
      if(!item||Date.now()-item.at>ttl){
        const summary=await liveNFL.fetchGame(game.id);
        item={at:Date.now(),stats:liveNFL.playerStats(summary),events:liveNFL.playEvents(summary)};
        if(cache.size>80)cache.clear();
        cache.set(cacheKey,item);
      }
      const stats=item.stats.get(id);
      if(!stats)return send(res,200,{...result,status:'no-stats',notice:'ESPN has not reported player boxscore statistics for this game'});
      const scored=liveNFL.scorePlayer(stats,settingsOf(current.state).scoring,item.events);
      const groups=[];
      for(const [name,values] of Object.entries({passing:stats.passing,rushing:stats.rushing,receiving:stats.receiving,kicking:stats.kicking,miscellaneous:stats.misc})){
        const rows=Object.entries(values||{}).map(([label,value])=>({label,value:String(value)}));
        if(rows.length)groups.push({name,rows});
      }
      return send(res,200,{...result,status:'available',groups,points:scored.points,
        breakdown:scored.breakdown,unsupported:scored.unsupported,
        notice:'Provisional ESPN boxscore and scoring. The official fantasy ledger remains authoritative.'});
    }catch(e){return send(res,503,{error:'Live NFL game statistics unavailable',details:e.message});}
  }
  if(req.method==='GET'&&route==='/api/players/weekly'){
    const weekly=current.state.nflWeeklyDirectory||{};
    return send(res,200,{season:current.state.nflSync?.season||null,
      week:current.state.nflDirectorySync?.currentWeek||null,
      updatedAt:current.state.nflDirectorySync?.at||null,
      players:weekly,projectionStatus:'NOT_AVAILABLE',
      notice:'Weekly ESPN projections are not yet verified; unavailable projections are shown as —.'});
  }
  if(req.method==='GET'&&route==='/api/players/history'){
    const id=String(url.searchParams.get('id')||'');
    if(!/^\d{1,12}$/.test(id))return send(res,400,{error:'Invalid player ID'});
    try{
      const pool=await draftPool();
      const player=pool.players.find(x=>String(x.id)===id);
      if(!player)return send(res,404,{error:'Player not found in ESPN directory'});
      const season=Number(current.state.nflDirectorySync?.season||process.env.NFL_SEASON||new Date().getUTCFullYear());
      const currentWeek=Math.min(18,Math.max(1,Number(current.state.nflDirectorySync?.currentWeek||1)));
      const team=liveNFL.teamId(player);
      if(!team)return send(res,200,{player:{id,name:player.name,position:player.position},season,weeks:[],notice:'No NFL team available'});
      const key=`${season}:${currentWeek}:${team}:${id}:${JSON.stringify(settingsOf(current.state).scoring)}`;
      const cached=playerHistoryCache.get(key);
      if(cached&&Date.now()-cached.at<15*60*1000)return send(res,200,cached.value);
      const boards=await Promise.all(Array.from({length:currentWeek},(_,i)=>i+1).map(async week=>{
        try{return {week,games:await liveNFL.loadWeek(season,week)};}
        catch(e){return {week,games:[],error:e.message};}
      }));
      const games=boards.flatMap(x=>x.games.map(g=>({...g,week:x.week})))
        .filter(g=>g.status==='final'&&g.teams.some(t=>String(t.id)===String(team)));
      const weeks=await Promise.all(games.map(async game=>{
        try{
          const summary=await liveNFL.fetchGame(game.id);
          const stats=liveNFL.playerStats(summary);
          const playerStats=stats.get(id);
          if(!playerStats)return {week:game.week,gameId:game.id,status:'NO_STATS',opponent:game.teams.find(t=>String(t.id)!==String(team))?.abbreviation||null};
          const result=liveNFL.scorePlayer(playerStats,settingsOf(current.state).scoring,liveNFL.playEvents(summary));
          return {week:game.week,gameId:game.id,status:'final',opponent:game.teams.find(t=>String(t.id)!==String(team))?.abbreviation||null,
            points:result.points,breakdown:result.breakdown,unsupported:result.unsupported,provisional:true};
        }catch(e){return {week:game.week,gameId:game.id,status:'UNAVAILABLE',error:'Game statistics unavailable'};}
      }));
      weeks.sort((a,b)=>b.week-a.week);
      const scored=weeks.filter(w=>w.status==='final');
      const value={player:{id,name:player.name,position:player.position},season,weeks,
        total:Math.round(scored.reduce((n,w)=>n+w.points,0)*100)/100,
        average:scored.length?Math.round(scored.reduce((n,w)=>n+w.points,0)/scored.length*100)/100:null,
        gamesPlayed:scored.length,partial:boards.some(b=>b.error)||weeks.some(w=>w.status!=='final')};
      if(playerHistoryCache.size>250)playerHistoryCache.clear();
      playerHistoryCache.set(key,{at:Date.now(),value});
      return send(res,200,value);
    }catch(e){return send(res,503,{error:'Player history unavailable',details:e.message});}
  }
  if(req.method==='GET'&&route==='/api/transactions/players'){
    try{
      const games=await nflGames(),map=gameMapFrom(games),data=await draftPool();
      const owned=new Map(current.state.players.filter(p=>p.espnId).map(p=>[String(p.espnId),p]));
      const selected=new Set(ensureDraft(current.state).picks.map(p=>String(p.playerId)));
      const result=data.players.map(p=>{
        const record=owned.get(String(p.id))||{id:'espn-'+p.id,nflTeamId:p.nflTeamId};
        const availability=transactionStatus(record,map,current.state);
        return {id:String(p.id),owner:record.owner||null,
          status:record.owner?'ROSTERED':availability.status,clearsAt:availability.clearsAt||null,
          kickoff:availability.kickoff||null,
          drafted:selected.has(String(p.id))};
      });
      return send(res,200,{players:result,priority:current.state.waiverPriority||[],
        claims:(current.state.waiverClaims||[]).filter(x=>x.manager===user.manager)});
    }catch(e){return send(res,503,{error:e.message});}
  }
  if(req.method==='GET'&&route==='/api/draft')return send(res,200,draftResult(current.state));
  if(req.method!=='POST')return send(res,405,{error:'Method not allowed'});
  const body=await bodyOf(req);
  let espnData=null;
  if(['/api/draft/start','/api/draft/pick','/api/transactions/add','/api/transactions/claim'].includes(route)){
    try{espnData=await draftPool();}catch(e){return send(res,503,{error:'ESPN player data unavailable',details:e.message});}}
  let verifiedLineupSchedule=null;
  if(route==='/api/lineup/save'||route==='/api/lineup/assign'){
    try{
      const calendar=await currentNFLCalendar();
      // Use the league's active NFL week, not ESPN's rolling current week.
      // The two can differ around Thursday kickoff and during week rollover.
      const {state:leagueSnapshot}=await snapshot();
      const leagueWeek=Number(leagueSnapshot.week);
      const leagueSeason=Number(leagueSnapshot.scheduleSeason||leagueSnapshot.nflDirectorySync?.season||calendar.season);
      if(!Number.isInteger(leagueWeek)||leagueWeek<1||leagueWeek>18||leagueSeason!==calendar.season)
        throw Error(`League week/season requires synchronization (league ${leagueSeason} W${leagueWeek}, NFL ${calendar.season} W${calendar.week})`);
      const games=await liveNFL.loadWeek(leagueSeason,leagueWeek);
      if(games.length<10)throw Error('Incomplete NFL schedule');
      verifiedLineupSchedule={season:leagueSeason,week:leagueWeek,games};
    }catch(e){return send(res,503,{error:'Unable to verify NFL kickoff times. Lineup changes temporarily paused.',details:e.message});}
  }
  let nflMap=null;
  if(route.startsWith('/api/transactions/')){
    try{nflMap=gameMapFrom(await nflGames());}catch(e){return send(res,503,{error:e.message});}
  }
  const result=await change((s,accounts)=>{
    const actor=findUser(req,accounts);if(!actor)return failure(401,'Session expired');
    const d=ensureDraft(s);
    if(route==='/api/settings'){
      if(!actor.commissioner)return failure(403,'Commissioner only');
      const valid=validateSettings(body.settings);if(!valid)return failure(400,'Invalid league settings');
      // Roster configuration cannot change once draft has started.
      if(d.status!=='waiting'&&JSON.stringify(valid.roster)!==JSON.stringify(settingsOf(s).roster))
        return failure(409,'Roster settings are locked once the draft starts');
      s.settings=valid;audit(s,'SETTINGS_CHANGED',actor.manager,'Commissioner updated league settings');
      return {ok:true,settings:valid};}
    if(route==='/api/league/member/remove'||route==='/api/league/member/terminate'){
      if(!actor.commissioner)return failure(403,'Commissioner only');
      const terminate=route.endsWith('/terminate');
      if(body.confirmation!==(terminate?'TERMINATE ROSTER':'REMOVE MANAGER'))
        return failure(400,'Incorrect confirmation phrase');
      const id=String(body.managerId||'');
      const team=s.managers.find(m=>m.id===id);
      if(!team)return failure(404,'Team not found');
      if(id===actor.manager)return failure(403,'Commissioner cannot remove their own team');
      if(terminate&&['active','paused'].includes(d.status))
        return failure(409,'Cannot terminate a roster during an active or paused draft');
      const removed=accounts.filter(a=>a.manager===id);
      if(!removed.length&&!terminate)return failure(409,'This team already has no manager');
      for(let i=accounts.length-1;i>=0;i--)if(accounts[i].manager===id)accounts.splice(i,1);
      ensureTransactions(s);
      s.waiverClaims=s.waiverClaims.filter(c=>c.manager!==id);
      if(terminate){
        const now=Date.now(),days=settingsOf(s).transactions.waiverDays;
        const rostered=s.players.filter(p=>p.owner===id);
        for(const p of rostered){
          p.owner=null;p.slot='BENCH';p.acquiredAt=null;p.acquisitionType=null;
          s.waiverHolds[p.id]=new Date(now+days*86400000).toISOString();
        }
        s.injuries=(s.injuries||[]).filter(i=>!rostered.some(p=>p.id===i.player));
        s.waiverPriority=(s.waiverPriority||[]).filter(x=>x!==id);
        if(s.draftPreferences)delete s.draftPreferences[id];
        s.archivedTeams||=[];
        s.archivedTeams.push({id:team.id,team:team.team,terminatedAt:new Date().toISOString(),
          draftedPicks:(d.picks||[]).filter(p=>p.manager===id).length});
        s.managers=s.managers.filter(m=>m.id!==id);
        // Historical draft picks and matchups are retained for audit purposes.
        audit(s,'ROSTER_TERMINATED',actor.manager,
          'Terminated '+team.team+'; '+rostered.length+' players released to waivers');
        return {ok:true,action:'terminated',team:team.team,playersReleased:rostered.length};
      }
      audit(s,'MANAGER_REMOVED',actor.manager,
        'Removed manager from '+team.team+'; roster retained for replacement');
      return {ok:true,action:'removed',team:team.team};
    }
    if(route==='/api/draft/preferences'){
      const valid=validatePreferences(body);if(!valid)return failure(400,'Invalid draft preferences');
      s.draftPreferences ||= {};s.draftPreferences[actor.manager]=valid;
      audit(s,'DRAFT_PREFERENCES',actor.manager,'Updated personal auto-draft preferences');return {ok:true};}
    if(route==='/api/league/restart'){
      if(!actor.commissioner)return failure(403,'Commissioner only');
      if(body.confirmation!=='RESTART LEAGUE')
        return failure(400,'Type RESTART LEAGUE to confirm');
      // Preserve manager accounts, sessions, team names, league rules,
      // and personal draft preferences. Discard the current draft and
      // its rosters, injuries, and simulated scoring data.
      const priorPicks=d.picks.length;
      s.draft={status:'waiting',rounds:DEFAULT_ROUNDS,
        secondsPerPick:PICK_SECONDS,order:[],picks:[],
        deadline:null,remainingSeconds:null};
      s.players=[];
      s.injuries=[];s.waiverClaims=[];s.waiverHolds={};s.waiverPriority=s.managers.map(m=>m.id);
      s.phase=0;
      s.week=1;delete s.frozenMatchupSchedule;delete s.scheduleStartWeek;delete s.scheduleSeason;
      delete s.matchupScheduleNotice;delete s.weeklyLedger;
      // Remove draft-specific history while retaining non-draft audits.
      const draftEvents=new Set([
        'DRAFT_PICK','AUTO_PICK','DRAFT_STARTED','DRAFT_PAUSED',
        'DRAFT_RESUMED','DRAFT_COMPLETE'
      ]);
      s.transactions=s.transactions.filter(t=>!draftEvents.has(t.type));
      audit(s,'LEAGUE_RESTART',actor.manager,
        'Commissioner restarted league; cleared '+priorPicks+' draft picks');
      return {ok:true,clearedPicks:priorPicks};
    }
    if(route==='/api/draft/order'){
      if(!actor.commissioner)return failure(403,'Commissioner only');
      if(d.status!=='waiting')return failure(409,'Draft order is locked after draft starts');
      const registered=s.managers.filter(m=>accounts.some(a=>a.manager===m.id)).map(m=>m.id);
      if(body.randomize===true){
        const shuffled=[...registered];
        for(let i=shuffled.length-1;i>0;i--){const j=crypto.randomInt(i+1);[shuffled[i],shuffled[j]]=[shuffled[j],shuffled[i]];}
        d.draftSequence=shuffled;
      }else{
        const seq=body.order;
        if(!Array.isArray(seq)||seq.length!==registered.length||new Set(seq).size!==registered.length||
           !seq.every(id=>registered.includes(id)))return failure(400,'Order must include every registered manager exactly once');
        d.draftSequence=[...seq];
      }
      audit(s,'DRAFT_ORDER_SET',actor.manager,body.randomize===true?'Randomized draft order':'Saved manual draft order');
      return {ok:true,order:d.draftSequence};
    }
    if(route==='/api/draft/start'){
      if(!actor.commissioner)return failure(403,'Commissioner only');
      if(d.status!=='waiting')return failure(409,'Draft already started');
      const registered=s.managers.filter(m=>accounts.some(a=>a.manager===m.id));
      if(registered.length<2)return failure(409,'At least two managers required');
      const roster=settingsOf(s).roster;
      const rounds=Object.values(roster.starters).reduce((n,v)=>n+v,0)+roster.bench;
      if(espnData.players.length<registered.length*rounds)return failure(503,'Not enough ESPN players for draft');
      const registeredIds=registered.map(m=>m.id);
      const chosen=d.draftSequence;
      const sequence=Array.isArray(chosen)&&chosen.length===registeredIds.length&&
        new Set(chosen).size===registeredIds.length&&chosen.every(id=>registeredIds.includes(id))
        ?chosen:registeredIds;
      d.draftSequence=[...sequence];
      d.order=createDraftOrder(sequence,rounds);d.picks=[];d.status='active';
      d.rounds=rounds;d.secondsPerPick=PICK_SECONDS;d.remainingSeconds=null;nextDeadline(d);
      s.players=[];s.injuries=[];
      audit(s,'DRAFT_STARTED',actor.manager,registered.length+'-team '+rounds+'-round snake draft started');
      return {ok:true,draft:draftResult(s)};}
    if(route==='/api/draft/pause'){
      if(!actor.commissioner)return failure(403,'Commissioner only');
      if(d.status!=='active')return failure(409,'Draft is not active');
      d.remainingSeconds=Math.max(1,Math.ceil((Date.parse(d.deadline)-Date.now())/1000));
      d.status='paused';d.deadline=null;audit(s,'DRAFT_PAUSED',actor.manager,'Commissioner paused draft');return {ok:true};}
    if(route==='/api/draft/resume'){
      if(!actor.commissioner)return failure(403,'Commissioner only');
      if(d.status!=='paused')return failure(409,'Draft is not paused');
      d.status='active';d.deadline=new Date(Date.now()+(d.remainingSeconds||d.secondsPerPick)*1000).toISOString();
      d.remainingSeconds=null;audit(s,'DRAFT_RESUMED',actor.manager,'Commissioner resumed draft');return {ok:true};}
    if(route==='/api/draft/pick'){
      if(d.status!=='active')return failure(409,'Draft is not active');
      const turn=currentPick(d);if(!turn)return failure(409,'Draft complete');
      if(turn.manager!==actor.manager)return failure(403,'Not your turn');
      if(d.deadline&&Date.now()>Date.parse(d.deadline))return failure(409,'Pick timer expired');
      const player=espnData.players.find(p=>String(p.id)===String(body.playerId));
      if(!player)return failure(404,'Player not found');return recordPick(s,player,false);}
    if(route.startsWith('/api/transactions/')){
      if(d.status!=='completed')return failure(409,'Player transactions open after the draft is complete');
      ensureTransactions(s);
      const playerId=String(body.playerId||''),espnPlayer=espnData?.players.find(p=>String(p.id)===playerId);
      if(route==='/api/transactions/drop'){
        const owned=dropValidation(s,actor.manager,String(body.playerId||''),nflMap);
        if(!owned||owned.error)return owned||failure(400,'Select a player to drop');
        const acquiredSameDay=owned.lastAcquiredAt&&owned.lastAcquisitionType!=='DRAFT'&&
          sameEasternDay(owned.lastAcquiredAt,Date.now());
        owned.owner=null;owned.slot='BENCH';
        if(!acquiredSameDay)s.waiverHolds[owned.id]=new Date(Date.now()+settingsOf(s).transactions.waiverDays*86400000).toISOString();
        else delete s.waiverHolds[owned.id];
        audit(s,'PLAYER_DROPPED',actor.manager,owned.name+' dropped');return {ok:true};
      }
      if(route==='/api/transactions/cancel'){
        const count=s.waiverClaims.length;
        s.waiverClaims=s.waiverClaims.filter(c=>!(c.manager===actor.manager&&c.playerId==='espn-'+playerId));
        return {ok:true,cancelled:count-s.waiverClaims.length};
      }
      if(!espnPlayer)return failure(404,'ESPN player not found');
      let player=s.players.find(p=>p.espnId===playerId);
      if(player?.owner)return failure(409,'Player is already rostered');
      if(!player){player={id:'espn-'+playerId,espnId:playerId,name:espnPlayer.name,
        team:String(espnPlayer.nflTeamId??''),nflTeamId:espnPlayer.nflTeamId,
        pos:espnPlayer.position,injuryStatus:espnPlayer.injuryStatus||'UNKNOWN',
        projectedPoints:espnPlayer.projectedPoints,rank:espnPlayer.rank,
        kickoff:99,status:'upcoming',points:0,slot:'BENCH',owner:null};s.players.push(player);}
      const availability=transactionStatus(player,nflMap,s);
      const dropId=body.dropId?String(body.dropId):null;
      const drop=dropValidation(s,actor.manager,dropId,nflMap);
      if(drop?.error)return drop;
      if(drop?.id===player.id)return failure(400,'Cannot drop the player being acquired');
      const limit=settingsOf(s).transactions.acquisitionLimit;
      if(limit!==null&&acquisitionCount(s,actor.manager)>=limit)return failure(409,'Season acquisition limit reached');
      if(transactionCapacity(s,actor.manager,espnPlayer,drop))
        return failure(409,transactionCapacity(s,actor.manager,espnPlayer,drop));
      if(route==='/api/transactions/add'){
        if(availability.status!=='FREE_AGENT')return failure(409,
          availability.status==='LOCKED'?'Player is locked until their game ends':'Player is on waivers; submit a claim');
        acquire(s,actor.manager,player,drop,'FREE_AGENT');return {ok:true};
      }
      if(route==='/api/transactions/claim'){
        if(availability.status!=='WAIVERS')return failure(409,'Player is not currently on waivers');
        s.waiverClaims=s.waiverClaims.filter(c=>!(c.manager===actor.manager&&c.playerId===player.id));
        s.waiverClaims.push({id:crypto.randomUUID(),manager:actor.manager,playerId:player.id,
          dropId,at:new Date().toISOString()});
        audit(s,'WAIVER_CLAIM',actor.manager,'Submitted waiver claim for '+player.name);
        return {ok:true,clearsAt:availability.clearsAt};
      }
      return failure(404,'Unknown transaction action');
    }
    if(route==='/api/team-photo'){
      const team=s.managers.find(m=>m.id===actor.manager);
      if(!team)return failure(403,'Team not found');
      if(body.photo===null){team.photo=null;return {ok:true,photo:null};}
      const photo=body.photo;
      if(typeof photo!=='string'||photo.length>85000)return failure(400,'Image is too large');
      const match=/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(photo);
      if(!match)return failure(400,'Upload a JPEG, PNG or WebP image');
      const bytes=Buffer.from(match[2],'base64');
      if(bytes.length<12||bytes.length>62000)return failure(400,'Image must be under 62 KB after resizing');
      const valid=match[1]==='jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:
        match[1]==='png'?bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')):
        bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
      if(!valid)return failure(400,'Invalid image data');
      team.photo=photo;return {ok:true,photo};
    }
    if(route==='/api/team-name'){
      const name=teamName(body.name),team=s.managers.find(m=>m.id===actor.manager);
      if(!team)return failure(403,'Team not found');if(!name)return failure(400,'Invalid team name');
      if(taken(s,name,team.id))return failure(409,'Team name already taken');
      const old=team.team;team.team=name;audit(s,'RENAME',team.id,old+' renamed to '+name);
      return {ok:true,team:name};}
    if(route==='/api/lineup/save')return saveStartingLineup(s,actor,body,verifiedLineupSchedule);
    if(route==='/api/lineup/assign')return assignLineup(s,actor,body,verifiedLineupSchedule);
    if(route==='/api/substitute'){
      const injury=s.injuries.find(i=>i.id===body.injury&&i.active),starter=s.players.find(p=>p.id===injury?.player),
        bench=s.players.find(p=>p.id===body.bench);
      if(!starter||starter.owner!==actor.manager)return failure(403,'Not your team or injury unavailable');
      if(injurySwapRetired(s,starter)||injurySwapRetired(s,bench))
        return failure(409,'A substituted-out player cannot reenter this NFL week');
      if(!injury||!injury.active)return failure(409,'Injury decision already resolved');
      const mode=eligibility(s,starter,bench);if(!mode)return failure(409,'Replacement not eligible');
      const slot=starter.slot,previous=ledgerScore(starter);
      // The replacement can later be injured and replaced again. No previously
      // removed player can return, and only the active replacement earns points.
      starter.slot='BENCH';bench.slot=slot;
      bench.scoringMode=mode;bench.scoreAtSwap=mode==='handcuff'?bench.points:0;
      bench.credited=mode==='handcuff'?0:bench.points;injury.active=false;
      s.injurySwapHistory ||= [];
      s.injurySwapHistory.push({id:crypto.randomUUID(),week:injurySwapWeek(s),
        manager:actor.manager,injuryId:injury.id,removedId:starter.id,
        replacementId:bench.id,slot,mode,forfeitedPoints:previous,
        at:new Date().toISOString()});
      audit(s,'SUBSTITUTION',actor.manager,starter.name+' ('+previous.toFixed(1)+
        ' pts forfeited) replaced by '+bench.name+' ('+mode+')');return {ok:true,mode};}
    if(route==='/api/keep'){
      const injury=s.injuries.find(i=>i.id===body.injury&&i.active);
      if(!injury)return failure(409,'Injury already resolved');
      const starter=s.players.find(p=>p.id===injury.player);
      if(starter?.owner!==actor.manager)return failure(403,'Not your team');
      injury.active=false;audit(s,'KEEP',actor.manager,'Manager retained injured starter');return {ok:true};}
    if(route==='/api/demo'){
      if(!actor.commissioner)return failure(403,'Commissioner only');
      if(body.action==='advance'){
        s.phase=Math.min(4,s.phase+1);s.players.forEach(p=>{if(p.kickoff<=s.phase&&p.status==='upcoming')p.status='playing';});
      }else if(body.action==='injure'){
        const player=s.players.find(p=>p.id===body.player&&p.slot!=='BENCH');
        if(!player)return failure(400,'Choose a starter');
        if(injurySwapRetired(s,player))return failure(409,'Player already substituted out this week');
        if(s.injuries.some(i=>i.player===player.id&&i.active))return failure(409,'Injury already pending');
        player.status='injured';s.injuries.push({id:crypto.randomUUID(),player:player.id,active:true,description:'Demo injury event'});
      }else if(body.action==='points'){
        const player=s.players.find(p=>p.id===body.player),amount=Number(body.amount);
        if(!player||!Number.isFinite(amount)||Math.abs(amount)>100)return failure(400,'Invalid player or points');
        player.points+=amount;if(player.scoringMode==='handcuff')player.credited=player.points-player.scoreAtSwap;
      }else return failure(400,'Unknown action');return {ok:true};}
    return failure(404,'Not found');});
  return send(res,result.status||200,result);
}
function staticFile(req,res,route){if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);return res.end();}
  const root=path.resolve(__dirname,'public');let decoded;
  try{decoded=decodeURIComponent(route);}catch{res.writeHead(400);return res.end();}
  const file=path.resolve(root,'.'+(decoded==='/'?'/index.html':decoded));
  if(file!==root&&!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
  fs.readFile(file,(err,data)=>{if(err){res.writeHead(404);return res.end();}
    const type=file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.js')?
      'application/javascript; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':'application/octet-stream';
    res.writeHead(200,{'Content-Type':type,'X-Content-Type-Options':'nosniff','Cache-Control':'no-cache'});
    res.end(req.method==='HEAD'?undefined:data);});}
const server=http.createServer((req,res)=>{const route=new URL(req.url,'http://localhost').pathname;
  if(route.startsWith('/api/'))api(req,res,route).catch(e=>{console.error('API error:',e);
    if(!res.headersSent)send(res,500,{error:'Server error'});else res.end();});
  else staticFile(req,res,route);});
// Fetch outside the database transaction; apply one consistent snapshot atomically.
let scoringSyncBusy=false;
async function syncNFLScoring(){
  if(scoringSyncBusy)return;scoringSyncBusy=true;
  try{
    const {state}=await snapshot();
    const season=Number(process.env.NFL_SEASON||new Date().getUTCFullYear());
    if(ensureDraft(state).status!=='completed'||!state.frozenMatchupSchedule)return;
    const calendar=await currentNFLCalendar();
    if(state.scheduleSeason&&calendar.season!==state.scheduleSeason)return;
    const week=calendar.week;
    if(week<Number(state.scheduleStartWeek||1)||week>14)return;
    const games=await liveNFL.loadWeek(season,week);
    const summaries=new Map(),failures=[];
    await Promise.all(games.filter(g=>g.status!=='upcoming').map(async g=>{
      try{const summary=await liveNFL.fetchGame(g.id);
        summaries.set(g.id,{players:liveNFL.playerStats(summary),events:liveNFL.playEvents(summary),defenses:liveNFL.defenseStats(summary,g,liveNFL.playEvents(summary))});}
      catch(e){failures.push(g.id+': '+e.message);}
    }));
    await change((s,accounts)=>{
      // Player-directory history is updated by its own NFL-calendar sync below.
      // Never overwrite it with the fantasy league's draft/matchup week.
      const ids=new Map();for(const game of games)for(const t of game.teams)ids.set(t.id,game);
      let changed=0;
      for(const player of s.players){
        if(!player.espnId&&player.pos!=='D/ST')continue; // Demo data must never be overwritten.
        const game=ids.get(liveNFL.teamId(player));
        if(!game)continue; // Bye week.
        player.nflGame={id:game.id,kickoff:game.kickoff,status:game.status};
        player.status=game.status;
        if(game.status==='upcoming')continue;
        const box=summaries.get(game.id);if(!box)continue;
        let calculated;
        if(player.pos==='D/ST'){
          const teamStats=box.defenses.get(liveNFL.teamId(player));
          if(!teamStats){player.liveScoreStatus='DEFENSE_BOX_SCORE_UNAVAILABLE';continue;}
          calculated=liveNFL.scoreDefense(teamStats,settingsOf(s).scoring);
        }else{
          const stats=box.players.get(String(player.espnId));
          if(!stats){player.liveScoreStatus='NO_BOX_SCORE_ENTRY';continue;}
          calculated=liveNFL.scorePlayer(stats,settingsOf(s).scoring,box.events);
        }
        // Credit verified field-goal makes at the minimum configured rate; mark unknown distances partial.
        // Do not overwrite an in-progress injury handcuff's credited points.
        if(player.scoringMode){player.liveScoreStatus='INJURY_SUBSTITUTION_REQUIRES_EVENT_SCORING';continue;}
        player.points=calculated.points;
        player.liveScoreStatus=calculated.unsupported.length?'PARTIAL':'UPDATED';
        player.liveScoreUpdatedAt=new Date().toISOString();changed++;
      }
      s.week=week;
      updateWeeklyLedger(s,accounts,week,games,failures);
      s.nflSync={season,week,at:new Date().toISOString(),games:games.map(g=>({id:g.id,status:g.status,kickoff:g.kickoff,teams:g.teams})),failures,updatedPlayers:changed,warning:'Provisional: D/ST, play-level bonuses, field-goal distances, and injury substitutions remain unverified.'};
      return {ok:true};
    });
  }catch(e){console.error('NFL scoring sync:',e.message);}
  finally{scoringSyncBusy=false;}
}
const playerHistoryCache=new Map();
// Independent player-directory game history. League state.week is not the NFL
// calendar week: newly created leagues often remain on week 1.
let directorySyncBusy=false;
async function syncPlayerDirectory(){
  if(directorySyncBusy)return;
  directorySyncBusy=true;
  try{
    const season=Number(process.env.NFL_SEASON||new Date().getUTCFullYear());
    // ESPN's current scoreboard supplies the NFL calendar week; if its feed
    // is unavailable, leave existing directory entries unchanged.
    const response=await fetch('https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?limit=100',
      {signal:AbortSignal.timeout(12000)});
    if(!response.ok)throw Error('NFL calendar scoreboard HTTP '+response.status);
    const board=await response.json();
    if(Number(board.season?.year)!==season)throw Error('NFL season mismatch');
    const currentWeek=Number(board.week?.number||board.week?.week);
    if(!Number.isInteger(currentWeek)||currentWeek<1||currentWeek>18)throw Error('Invalid NFL calendar week');
    // Scan the current and preceding four weeks to cover byes and short absences.
    // Persist earlier entries, so long absences do not erase last completed games.
    const first=Math.max(1,currentWeek-4),weeks=[];
    for(let w=first;w<=currentWeek;w++){
      try{weeks.push({week:w,games:await liveNFL.loadWeek(season,w)});}
      catch(e){console.warn('Directory week',w,e.message);}
    }
    const completed=weeks.flatMap(x=>x.games.map(g=>({...g,week:x.week})))
      .filter(g=>g.status==='final');
    const boxscores=await Promise.all(completed.map(async game=>{
      try{const summary=await liveNFL.fetchGame(game.id);return {game,stats:liveNFL.playerStats(summary),events:liveNFL.playEvents(summary)};}
      catch(e){console.warn('Directory game',game.id,e.message);return null;}
    }));
    await change(s=>{
      const directory={...(s.nflWeeklyDirectory||{})};
      for(const entry of boxscores.filter(Boolean)){
        const {game,stats,events}=entry;
        for(const [athleteId,playerStats] of stats){
          const previous=directory[athleteId];
          // Select the latest COMPLETED game by NFL week, not processing order.
          if(previous?.season===season&&previous?.gameStatus==='final'&&previous.week>game.week)continue;
          const result=liveNFL.scorePlayer(playerStats,settingsOf(s).scoring,events);
          directory[athleteId]={points:result.points,breakdown:result.breakdown,
            gameId:game.id,opponent:game.teams.find(t=>t.id!==playerStats.teamId)?.abbreviation||null,
            gameStatus:'final',kickoff:game.kickoff,week:game.week,season,
            provisional:true,updatedAt:new Date().toISOString()};
        }
      }
      s.nflWeeklyDirectory=directory;
      s.nflDirectorySync={season,currentWeek,at:new Date().toISOString(),completedGames:completed.length};
      return {ok:true};
    });
  }catch(e){console.error('NFL player directory sync:',e.message);}
  finally{directorySyncBusy=false;}
}
// Web Push subscriptions are per device; failures remove expired endpoints.
async function notifyManager(manager,payload){
  if(!PUSH_READY)return false;
  const r=await pool.query('SELECT endpoint,subscription FROM fantasy_audible_push WHERE manager=$1',[manager]);
  let sent=false;
  await Promise.all(r.rows.map(async row=>{
    try{await webpush.sendNotification(row.subscription,JSON.stringify(payload),{TTL:300});sent=true;}
    catch(e){if(e.statusCode===404||e.statusCode===410)
      await pool.query('DELETE FROM fantasy_audible_push WHERE endpoint=$1',[row.endpoint]);
      else console.error('Push delivery:',e.message);}
  }));return sent;
}
const injuryStatuses=new Set(['QUESTIONABLE','DOUBTFUL','OUT','IR','INJURED_RESERVE']);
let injuryPolling=false;
async function pollLiveInjuries(){
  if(injuryPolling)return;injuryPolling=true;
  try{
    const {state}=await snapshot();
    if(ensureDraft(state).status!=='completed')return;
    const games=await nflGames();
    const liveTeams=new Set(games.filter(g=>g.state==='in'&&!g.completed).flatMap(g=>g.teams));
    const starters=state.players.filter(p=>p.owner&&!['BENCH','IR'].includes(p.slot)&&p.espnId&&
      liveTeams.has(String(p.nflTeamId||p.proTeamId||p.teamId||'')));
    if(!starters.length)return;
    const ids=new Set(starters.map(p=>String(p.espnId)));
    const url=`https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${Number(process.env.ESPN_SEASON||2026)}/players?scoringPeriodId=0&view=kona_player_info`;
    const response=await fetch(url,{headers:{Accept:'application/json',
      'X-Fantasy-Filter':JSON.stringify({players:{limit:1500,offset:0}})},signal:AbortSignal.timeout(20000)});
    if(!response.ok)throw Error('ESPN injury feed HTTP '+response.status);
    const raw=await response.json(),entries=Array.isArray(raw)?raw:raw.players||[];
    const statuses=new Map();for(const entry of entries){const p=entry.player||entry;
      if(ids.has(String(p.id)))statuses.set(String(p.id),String(p.injuryStatus||'UNKNOWN').toUpperCase());}
    if(!statuses.size)return;
    const alerts=[];
    await change(s=>{
      s.injuryObservations=s.injuryObservations||{};
      for(const player of s.players){if(!ids.has(String(player.espnId)))continue;
        const status=statuses.get(String(player.espnId));if(!status)continue;
        const previous=s.injuryObservations[player.id];
        s.injuryObservations[player.id]=status;player.injuryStatus=status;
        // Never treat a first observation as a new injury. Require a status transition
        // while the player's game is live, preventing pre-existing injury false alerts.
        if(!previous||previous===status||!injuryStatuses.has(status)||injuryStatuses.has(previous))continue;
        if(s.injuries.some(i=>i.player===player.id&&i.active))continue;
        const eligible=s.players.filter(b=>b.owner===player.owner&&eligibility(s,player,b));
        if(!eligible.length)continue;
        const event={id:crypto.randomUUID(),player:player.id,active:true,
          description:`ESPN live injury designation: ${status}`,source:'ESPN',at:new Date().toISOString()};
        s.injuries.push(event);
        alerts.push({manager:player.owner,player:player.name,status,eventId:event.id});
      }
      return {ok:true};
    });
    for(const alert of alerts)await notifyManager(alert.manager,{title:`Injury alert: ${alert.player}`,
      body:`${alert.status} during game. Review eligible substitution options.`,url:'/?tab=Notifications'});
  }catch(e){console.error('Live injury monitoring:',e.message);}
  finally{injuryPolling=false;}
}
let reminderBusy=false;
async function remindPendingInjuries(){
  if(reminderBusy)return;reminderBusy=true;
  try{
    const games=await nflGames(),now=Date.now(),alerts=[];
    await change(s=>{
      for(const injury of s.injuries||[]){
        if(!injury.active||injury.reminderSent||injury.source!=='ESPN')continue;
        const starter=s.players.find(p=>p.id===injury.player);
        if(!starter)continue;
        const next=s.players.filter(p=>p.owner===starter.owner&&p.slot==='BENCH'&&p.pos===starter.pos)
          .map(p=>({player:p,game:games.find(g=>g.teams.includes(String(p.nflTeamId)))}))
          .filter(x=>x.game?.state==='pre'&&Date.parse(x.game.kickoff)>now)
          .sort((a,b)=>Date.parse(a.game.kickoff)-Date.parse(b.game.kickoff))[0];
        if(!next)continue;
        const until=Date.parse(next.game.kickoff)-now;
        if(until>0&&until<=10*60000){injury.reminderSent=true;
          alerts.push({manager:starter.owner,player:starter.name,replacement:next.player.name});}
      }return {ok:true};
    });
    for(const a of alerts)await notifyManager(a.manager,{title:`Injury decision reminder: ${a.player}`,
      body:`${a.replacement} kicks off soon. Review your substitution before kickoff.`,url:'/?tab=Notifications'});
  }catch(e){console.error('Injury reminder:',e.message);}finally{reminderBusy=false;}
}
setInterval(publishEditorial,5*60000);
setInterval(publishLockerBot,60000);
setTimeout(publishLockerBot,35000);
setTimeout(publishEditorial,25000);
setInterval(remindPendingInjuries,60000);
setInterval(pollLiveInjuries,120000);
setTimeout(pollLiveInjuries,18000);
setInterval(syncPlayerDirectory,15*60*1000);
setTimeout(syncPlayerDirectory,12000);
setInterval(activateLeagueSchedule,60000);
setTimeout(activateLeagueSchedule,3000);
setInterval(syncNFLScoring,60000);
setTimeout(syncNFLScoring,6000);
let checkingWaivers=false;setInterval(async()=>{if(checkingWaivers)return;checkingWaivers=true;
  try{await processWaivers();}catch(e){console.error('Waiver processing:',e.message);}finally{checkingWaivers=false;}},30000);
let checkingTimer=false;setInterval(async()=>{if(checkingTimer)return;checkingTimer=true;
  try{await processAutomaticTurn();}catch(e){console.error('Draft timer error:',e);}finally{checkingTimer=false;}},1000);
init().then(()=>server.listen(PORT,()=>console.log('Fantasy Audible running on '+PORT)))
  .catch(e=>{console.error('Database startup failed:',e);process.exit(1);});
