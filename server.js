const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');
const { initializeESPN, getESPNPlayers } = require('./espn');
const liveNFL = require('./live-nfl');

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
function safeState(s,accounts,user){return {...s,settings:settingsOf(s),managers:s.managers.map(m=>({...m,
  claimed:accounts.some(a=>a.manager===m.id)})),draftPreferences:{[user.manager]:preferencesOf(s,user.manager)},
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
function bodyOf(req){return new Promise((resolve,reject)=>{let raw='';let done=false;
  req.on('data',chunk=>{if(done)return;raw+=chunk;if(raw.length>100000){done=true;
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
function injuryOut(p){return ['OUT','IR','INJURED_RESERVE','DOUBTFUL','SUSPENSION','SUSPENDED'].includes(
  String(p.injuryStatus||'').toUpperCase());}
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
    audit(s,'DRAFT_COMPLETE',null,'Draft completed');}else nextDeadline(d);
  return {ok:true,pick};}
function eligibility(s,starter,bench){if(!starter||!bench||starter.owner!==bench.owner||
  starter.slot==='BENCH'||bench.slot!=='BENCH'||starter.pos!==bench.pos)return null;
  if(starter.team===bench.team&&bench.kickoff<=s.phase)return 'handcuff';
  if(bench.kickoff>s.phase)return 'later';return null;}
// Lineup moves are validated against the stored roster and game state.
function lineupLocked(s,player){
  if(!player)return true;
  if(['playing','injured','finished','final','completed'].includes(String(player.status).toLowerCase()))return true;
  if(player.kickoffAt){const at=Date.parse(player.kickoffAt);if(Number.isFinite(at)&&Date.now()>=at)return true;}
  // Older demo entries have phase-based kickoff values. ESPN draft entries
  // currently use 99 as a placeholder, not an actual NFL kickoff time.
  if(typeof player.kickoff==='number'&&player.kickoff!==99&&player.kickoff<=s.phase)return true;
  return false;
}
function slotEligible(player,slot){return slot==='FLEX'?['RB','WR','TE'].includes(player.pos):player.pos===slot;}
function lineupCapacity(s,slot){return slot==='BENCH'?settingsOf(s).roster.bench:
  slot==='IR'?settingsOf(s).roster.ir:settingsOf(s).roster.starters[slot];}
function eligibleIR(player){return ['OUT','IR','INJURED_RESERVE','PUP','NFI'].includes(
  String(player.injuryStatus||'').toUpperCase());}
function assignLineup(s,actor,body){
  const player=s.players.find(p=>p.id===body.playerId&&p.owner===actor.manager);
  const target=String(body.slot||'');
  const allowed=['QB','RB','WR','TE','FLEX','D/ST','K','BENCH','IR'];
  if(!player)return failure(404,'Player not found on your roster');
  if(!allowed.includes(target)||!Number.isInteger(lineupCapacity(s,target))||lineupCapacity(s,target)<1)
    return failure(400,'Invalid or disabled roster slot');
  if(player.slot===target)return {ok:true};
  if(lineupLocked(s,player))return failure(409,'This player is locked after kickoff');
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
    if(lineupLocked(s,displaced))return failure(409,'The current starter is locked');
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
function saveStartingLineup(s,actor,body){
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
      proposed.set(id,position);
    }
  }
  // Protect existing locked starters, including their exact numbered slot.
  for(const [position,count] of Object.entries(starters)){
    const existing=mine.filter(p=>p.slot===position);
    for(let index=0;index<existing.length;index++){
      const player=existing[index];
      const key=position+':'+index;
      if((lineupLocked(s,player)||player.scoringMode||
        s.injuries?.some(i=>i.active&&i.player===player.id))&&requested[key]!==player.id)
        return failure(409,player.name+' is locked in '+key);
    }
  }
  for(const player of mine){
    const target=proposed.get(player.id)||
      (player.slot==='IR'?'IR':'BENCH');
    if(target!==player.slot&&lineupLocked(s,player))
      return failure(409,player.name+' is locked after kickoff');
    if(target!==player.slot&&(player.scoringMode||player.scoreAtSwap!==undefined||
      s.injuries?.some(i=>i.active&&i.player===player.id)))
      return failure(409,player.name+' cannot be moved after an injury decision');
  }
  const benchCount=mine.filter(p=>!proposed.has(p.id)&&p.slot!=='IR').length;
  if(benchCount>settingsOf(s).roster.bench)
    return failure(409,'Bench capacity exceeded. Fill more starting positions.');
  for(const player of mine){
    player.slot=proposed.get(player.id)||(player.slot==='IR'?'IR':'BENCH');
  }
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
  if(req.method==='GET'&&route==='/api/state')return send(res,200,safeState(current.state,current.accounts,user));
  if(req.method==='GET'&&route==='/api/events'){
    res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform',Connection:'keep-alive'});
    res.write('data: '+JSON.stringify(safeState(current.state,current.accounts,user))+'\n\n');
    clients.set(res,user.id);req.on('close',()=>clients.delete(res));return;}
  if(req.method==='GET'&&route==='/api/espn/players'){
    try{const data=await draftPool();return send(res,200,{...data,count:data.players.length});}
    catch(e){return send(res,503,{error:'ESPN player data is not available yet',details:e.message});}}
  if(req.method==='GET'&&route==='/api/players/weekly'){
    const weekly=current.state.nflWeeklyDirectory||{};
    return send(res,200,{season:current.state.nflSync?.season||null,
      week:current.state.nflSync?.week||null,
      updatedAt:current.state.nflSync?.at||null,
      players:weekly,projectionStatus:'NOT_AVAILABLE',
      notice:'Weekly ESPN projections are not yet verified; unavailable projections are shown as —.'});
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
      s.week=1;
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
    if(route==='/api/draft/start'){
      if(!actor.commissioner)return failure(403,'Commissioner only');
      if(d.status!=='waiting')return failure(409,'Draft already started');
      const registered=s.managers.filter(m=>accounts.some(a=>a.manager===m.id));
      if(registered.length<2)return failure(409,'At least two managers required');
      const roster=settingsOf(s).roster;
      const rounds=Object.values(roster.starters).reduce((n,v)=>n+v,0)+roster.bench;
      if(espnData.players.length<registered.length*rounds)return failure(503,'Not enough ESPN players for draft');
      d.order=createDraftOrder(registered.map(m=>m.id),rounds);d.picks=[];d.status='active';
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
    if(route==='/api/team-name'){
      const name=teamName(body.name),team=s.managers.find(m=>m.id===actor.manager);
      if(!team)return failure(403,'Team not found');if(!name)return failure(400,'Invalid team name');
      if(taken(s,name,team.id))return failure(409,'Team name already taken');
      const old=team.team;team.team=name;audit(s,'RENAME',team.id,old+' renamed to '+name);
      return {ok:true,team:name};}
    if(route==='/api/lineup/save')return saveStartingLineup(s,actor,body);
    if(route==='/api/lineup/assign')return assignLineup(s,actor,body);
    if(route==='/api/substitute'){
      const injury=s.injuries.find(i=>i.id===body.injury&&i.active),starter=s.players.find(p=>p.id===injury?.player),
        bench=s.players.find(p=>p.id===body.bench);
      if(!starter||starter.owner!==actor.manager)return failure(403,'Not your team or injury unavailable');
      const mode=eligibility(s,starter,bench);if(!mode)return failure(409,'Replacement not eligible');
      const slot=starter.slot,previous=starter.points;starter.slot='BENCH';bench.slot=slot;
      bench.scoringMode=mode;bench.scoreAtSwap=mode==='handcuff'?bench.points:0;
      bench.credited=mode==='handcuff'?0:bench.points;injury.active=false;
      audit(s,'SUBSTITUTION',actor.manager,starter.name+' ('+previous.toFixed(1)+
        ' pts) replaced by '+bench.name+' ('+mode+')');return {ok:true,mode};}
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
    const week=Number(state.week);
    if(!Number.isInteger(week)||week<1||week>18)return;
    const games=await liveNFL.loadWeek(season,week);
    const summaries=new Map(),failures=[];
    await Promise.all(games.filter(g=>g.status!=='upcoming').map(async g=>{
      try{summaries.set(g.id,liveNFL.playerStats(await liveNFL.fetchGame(g.id)));}
      catch(e){failures.push(g.id+': '+e.message);}
    }));
    await change(s=>{
      // Read-only directory cache: includes unrostered players, not just league rosters.
      // A game with missing box-score data never produces an artificial zero.
      const directory={...(s.nflWeeklyDirectory||{})};
      for(const game of games){
        const box=summaries.get(game.id);
        if(!box)continue;
        for(const [athleteId,stats] of box){
          const points=liveNFL.scorePlayer(stats,settingsOf(s).scoring);
          if(points.fieldGoalsPending)continue;
          directory[athleteId]={
            points:points.points,breakdown:points.breakdown,gameId:game.id,
            opponent:game.teams.find(t=>t.id!==stats.teamId)?.abbreviation||null,
            gameStatus:game.status,
            kickoff:game.kickoff,week,season,
            provisional:points.unsupported.length>0,
            updatedAt:new Date().toISOString()
          };
        }
      }
      // Clear entries from older NFL weeks to prevent presenting stale results.
      s.nflWeeklyDirectory=Object.fromEntries(Object.entries(directory).filter(
        ([,v])=>v.week===week&&v.season===season));
      const ids=new Map();for(const game of games)for(const t of game.teams)ids.set(t.id,game);
      let changed=0;
      for(const player of s.players){
        if(!player.espnId)continue; // Demo data must never be overwritten.
        const game=ids.get(liveNFL.teamId(player));
        if(!game)continue; // Bye week.
        player.nflGame={id:game.id,kickoff:game.kickoff,status:game.status};
        player.status=game.status;
        if(game.status==='upcoming')continue;
        const box=summaries.get(game.id);if(!box)continue;
        const stats=box.get(String(player.espnId));
        if(!stats){player.liveScoreStatus='NO_BOX_SCORE_ENTRY';continue;}
        if(player.pos==='D/ST'){
          player.liveScoreStatus='DEFENSE_SCORING_NOT_VERIFIED';continue;
        }
        const calculated=liveNFL.scorePlayer(stats,settingsOf(s).scoring);
        if(player.pos==='K'&&calculated.fieldGoalsPending){player.liveScoreStatus='FIELD_GOAL_DISTANCES_PENDING';continue;}
        // Do not overwrite an in-progress injury handcuff's credited points.
        if(player.scoringMode){player.liveScoreStatus='INJURY_SUBSTITUTION_REQUIRES_EVENT_SCORING';continue;}
        player.points=calculated.points;
        player.liveScoreStatus=calculated.unsupported.length?'PARTIAL':'UPDATED';
        player.liveScoreUpdatedAt=new Date().toISOString();changed++;
      }
      s.nflSync={season,week,at:new Date().toISOString(),games:games.map(g=>({id:g.id,status:g.status,kickoff:g.kickoff,teams:g.teams})),failures,updatedPlayers:changed,warning:'Provisional: play-level bonuses, D/ST, kicking distance, and injury substitutions require event attribution.'};
      return {ok:true};
    });
  }catch(e){console.error('NFL scoring sync:',e.message);}
  finally{scoringSyncBusy=false;}
}
setInterval(syncNFLScoring,60000);
setTimeout(syncNFLScoring,6000);
let checkingWaivers=false;setInterval(async()=>{if(checkingWaivers)return;checkingWaivers=true;
  try{await processWaivers();}catch(e){console.error('Waiver processing:',e.message);}finally{checkingWaivers=false;}},30000);
let checkingTimer=false;setInterval(async()=>{if(checkingTimer)return;checkingTimer=true;
  try{await processAutomaticTurn();}catch(e){console.error('Draft timer error:',e);}finally{checkingTimer=false;}},1000);
init().then(()=>server.listen(PORT,()=>console.log('Fantasy Audible running on '+PORT)))
  .catch(e=>{console.error('Database startup failed:',e);process.exit(1);});
