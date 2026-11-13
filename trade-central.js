'use strict';
const crypto=require('crypto');
const DAY=24*60*60*1000;
const err=(status,error)=>({status,error});
const list=s=>s.trades||(s.trades=[]);
const activeTeams=(s,accounts)=>s.managers.filter(m=>accounts.some(a=>a.manager===m.id));
const requiredVetoes=n=>Math.floor(n/2)+1;
const same=(a,b)=>String(a)===String(b);
function tradePlayers(s,ids,owner){
  if(!Array.isArray(ids)||ids.length>12||!ids.length||new Set(ids.map(String)).size!==ids.length)return null;
  const found=ids.map(id=>s.players.find(p=>same(p.id,id)&&p.owner===owner));
  return found.every(Boolean)?found:null;
}
function locked(s,p,ctx){
  if(s.injurySwapHistory?.some(h=>Number(h.week)===Number(s.week)&&(same(h.removedId,p.id)||same(h.replacementId,p.id))))return 'Current-week injury substitution';
  if(s.injuries?.some(i=>i.active&&same(i.player,p.id)))return 'Pending injury decision';
  if(!ctx?.games||!Array.isArray(ctx.games))return 'Verified NFL schedule unavailable';
  const team=String(p.nflTeamId??p.team??'');
  if(p.espnId||p.nflGame){
    if(!team)return 'NFL affiliation unavailable';
    const game=ctx.games.find(g=>g.teams?.some(t=>String(t.id??t)===team));
    if(!game)return ctx.games.length<10?'NFL schedule incomplete':null;
    const kickoff=Date.parse(game.kickoff);
    if(!Number.isFinite(kickoff))return 'Kickoff unavailable';
    if(Date.now()>=kickoff)return 'NFL kickoff passed';
  }else if(['playing','injured','finished','final','completed'].includes(String(p.status).toLowerCase()))return 'Player game locked';
  return null;
}
function capacity(s,owner,outgoing,incoming){
  const settings=s.settings?.roster||{};
  const max=settings.maximums||{QB:4,RB:8,WR:8,TE:3,'D/ST':3,K:3};
  const roster=s.players.filter(p=>p.owner===owner&&!outgoing.some(x=>same(x.id,p.id))).concat(incoming.map(p=>({...p,slot:'BENCH'})));
  if(roster.filter(p=>p.slot!=='IR').length>(Object.values(settings.starters||{QB:1,RB:2,WR:2,TE:1,FLEX:1,'D/ST':1,K:1}).reduce((a,b)=>a+Number(b||0),0)+Number(settings.bench??7)))return 'Roster capacity exceeded';
  for(const [pos,limit] of Object.entries(max))if(roster.filter(p=>p.pos===pos).length>limit)return pos+' positional maximum exceeded';
  return null;
}
function validate(s,t,ctx){
  const giving=tradePlayers(s,t.give,t.from),receiving=tradePlayers(s,t.receive,t.to);
  if(!giving||!receiving)return err(409,'A traded player is no longer on the offered roster');
  for(const p of [...giving,...receiving]){const reason=locked(s,p,ctx);if(reason)return err(409,p.name+': '+reason);}
  const first=capacity(s,t.from,giving,receiving),second=capacity(s,t.to,receiving,giving);
  if(first||second)return err(409,first||second);
  return {giving,receiving};
}
function propose(s,accounts,actor,body,ctx){
  const from=actor,to=String(body.to||'');
  if(!to||from===to||!activeTeams(s,accounts).some(m=>m.id===to))return err(400,'Select another active league team');
  const t={id:crypto.randomUUID(),from,to,give:(body.give||[]).map(String),receive:(body.receive||[]).map(String),status:'pending',createdAt:new Date().toISOString(),votes:{}};
  const valid=validate(s,t,ctx);if(valid.error)return valid;
  list(s).unshift(t);return {ok:true,trade:t};
}
function counter(s,accounts,actor,id,body,ctx){
  const original=list(s).find(t=>t.id===id);
  if(!original||original.status!=='pending'||original.to!==actor)return err(409,'Offer cannot be countered');
  const response=propose(s,accounts,actor,{to:original.from,give:body.give,receive:body.receive},ctx);
  if(response.error)return response;
  original.status='countered';original.closedAt=new Date().toISOString();original.counterId=response.trade.id;
  return response;
}
function accept(s,accounts,actor,id,ctx,now=Date.now()){
  const t=list(s).find(x=>x.id===id);
  if(!t||t.status!=='pending'||t.to!==actor)return err(409,'Only the receiving team can accept a pending offer');
  const valid=validate(s,t,ctx);if(valid.error)return valid;
  const voters=activeTeams(s,accounts).map(m=>m.id).filter(x=>x!==t.from&&x!==t.to);
  t.status='voting';t.acceptedAt=new Date(now).toISOString();t.deadline=new Date(now+DAY).toISOString();
  t.eligibleVoters=voters;t.vetoThreshold=requiredVetoes(voters.length);t.votes={};
  return {ok:true,trade:t};
}
function reject(s,actor,id){const t=list(s).find(x=>x.id===id);
  if(!t||t.status!=='pending'||![t.from,t.to].includes(actor))return err(409,'Offer cannot be declined or withdrawn');
  t.status=actor===t.from?'withdrawn':'declined';t.closedAt=new Date().toISOString();return {ok:true,trade:t};}
function vote(s,actor,id,veto,now=Date.now()){
  const t=list(s).find(x=>x.id===id);
  if(!t||t.status!=='voting'||!t.eligibleVoters?.includes(actor))return err(403,'Not eligible to vote on this trade');
  if(now>=Date.parse(t.deadline))return err(409,'Voting window has ended');
  if(Object.hasOwn(t.votes||{},actor))return err(409,'This team has already voted');
  t.votes[actor]=veto===true?'veto':'approve';
  if(Object.values(t.votes).filter(v=>v==='veto').length>=t.vetoThreshold){t.status='vetoed';t.closedAt=new Date(now).toISOString();}
  return {ok:true,trade:t};
}
function process(s,ctx,now=Date.now()){
  let changed=0;
  for(const t of list(s)){
    if(t.status!=='voting'||Date.parse(t.deadline)>now)continue;
    if(Object.values(t.votes||{}).filter(v=>v==='veto').length>=t.vetoThreshold){t.status='vetoed';t.closedAt=new Date(now).toISOString();changed++;continue;}
    const valid=validate(s,t,ctx);
    if(valid.error){
      if(/schedule unavailable|schedule incomplete|Kickoff unavailable/i.test(valid.error))continue;
      t.status='blocked';t.failure=valid.error;t.closedAt=new Date(now).toISOString();changed++;continue;
    }
    for(const p of valid.giving){p.owner=t.to;p.slot='BENCH';}
    for(const p of valid.receiving){p.owner=t.from;p.slot='BENCH';}
    t.status='completed';t.closedAt=new Date(now).toISOString();
    s.transactions||=[];s.transactions.unshift({id:crypto.randomUUID(),at:t.closedAt,type:'TRADE_COMPLETED',manager:null,details:`Trade ${t.id}: ${t.from} ↔ ${t.to}`});changed++;
  }
  return {ok:true,changed};
}
function publicTrades(s,actor){return list(s).map(t=>({...t,vetoCount:Object.values(t.votes||{}).filter(v=>v==='veto').length,
  voteCount:Object.keys(t.votes||{}).length,
  votes:Object.fromEntries(Object.entries(t.votes||{}).map(([id,v])=>[id,id===actor?v:'cast']))}));}
module.exports={propose,counter,accept,reject,vote,process,publicTrades,requiredVetoes,validate,locked};
