'use strict';
const liveNFL=require('./live-nfl');
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
function eligibleIR(player){return ['OUT','IR','INJURED_RESERVE','PUP','NFI'].includes(
  String(player.injuryStatus||'').toUpperCase());}

module.exports={lineupLockReason,lineupLocked,slotEligible,eligibleIR};
