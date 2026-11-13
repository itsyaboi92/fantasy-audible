'use strict';
// Single owner for week-scoped injury swap state and replacement eligibility.
// A committed injury swap permanently retires the removed player for that NFL week.
// Persisted in the league state so restarts cannot undo the decision.
function injurySwapWeek(s){return Number(s.week)||1;}
function injurySwapRetired(s,player){return Boolean(player&&s.injurySwapHistory?.some(x=>
  x.week===injurySwapWeek(s)&&x.removedId===player.id));}
function injurySwapCurrentSlot(s,player){return Boolean(player&&s.injurySwapHistory?.some(x=>
  x.week===injurySwapWeek(s)&&x.replacementId===player.id));}
// Live swap metadata belongs only to the week containing its committed event.
// Historical weeklyLedger/injurySwapHistory entries remain immutable.
function activeSwapMode(s,player){return Boolean(player&&injurySwapCurrentSlot(s,player));}
function activeSwapOffset(s,player){return activeSwapMode(s,player)&&player.scoreAtSwap!==undefined;}
function pendingInjury(s,player){return Boolean(player&&s.injuries?.some(i=>
  i.active&&i.player===player.id&&Number(i.week||s.week)===injurySwapWeek(s)));}
function expireOldInjuryState(s){
  const week=injurySwapWeek(s);
  for(const p of s.players||[]){
    if(!activeSwapMode(s,p)){
      delete p.scoringMode;delete p.scoreAtSwap;delete p.credited;
    }
  }
  for(const injury of s.injuries||[]){
    if(!injury.active)continue;
    // Legacy pending injuries have no week tag. Only preserve one when it
    // has an explicit current-week designation; otherwise expire on rollover.
    if(Number(injury.week)!==week)injury.active=false;
  }
}

function eligibility(s,starter,bench){if(!starter||!bench||starter.owner!==bench.owner||
  starter.slot==='BENCH'||bench.slot!=='BENCH'||
  !(starter.slot==='FLEX'?['RB','WR','TE'].includes(bench.pos):starter.pos===bench.pos)||
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

module.exports={injurySwapWeek,injurySwapRetired,injurySwapCurrentSlot,activeSwapMode,activeSwapOffset,pendingInjury,expireOldInjuryState,eligibility};
