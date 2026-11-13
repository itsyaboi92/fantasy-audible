'use strict';
// Weekly matchup snapshots, finalization, and standings.
// Keep persisted ledger structure and finalized matchups unchanged.
const postseason=require('./postseason');
function currentWeekScore(p,week){
  if(Number(p.scoreWeek)!==Number(week))return 0;
  if(p.nflGame?.status==='upcoming')return 0;
  return Number(p.scoringMode==='handcuff'?(p.credited??0):p.points)||0;
}
function ledgerScore(p,week){return currentWeekScore(p,week);}
function ledgerLineup(s,id,week){return s.players.filter(p=>p.owner===id&&!['BENCH','IR'].includes(p.slot)).map(p=>({id:p.id,name:p.name,team:p.team,pos:p.pos,slot:p.slot,status:p.status,points:ledgerScore(p,week),espnId:p.espnId||null,nflTeamId:p.nflTeamId||null,scoringMode:p.scoringMode||null,liveScoreStatus:p.liveScoreStatus||null}));}
function ledgerTotal(lineup){return Math.round(lineup.reduce((n,p)=>n+p.points,0)*100)/100;}
function createLeagueLedger(){
function updateWeeklyLedger(s,accounts,week,games,failures){
  if(!Number.isInteger(week)||week<1||week>18)return;
  s.weeklyLedger ||= {};
  const schedule=s.frozenMatchupSchedule||{};
  const matches=schedule[week]||[];
  const entry=s.weeklyLedger[week] ||= {week,createdAt:new Date().toISOString(),matchups:{}};
  const allFinal=games.length>0&&games.every(g=>g.status==='final')&&failures.length===0;
  for(const match of matches){
    const prior=entry.matchups[match.id];if(prior?.status==='final')continue;
    // A completed week's frozen lineup must never be rebuilt from today's
    // roster. Historical reconciliation updates the saved entries directly.
    if(prior&&allFinal)continue;
    const homeLineup=ledgerLineup(s,match.home,week),awayLineup=ledgerLineup(s,match.away,week);
    const allPlayers=[...homeLineup,...awayLineup];
    const verified=allPlayers.every(p=>p.liveScoreStatus==='UPDATED'&&
    (!p.scoringMode||p.scoringMode==='later')&&Number.isFinite(p.points));
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
  for(const [weekNumber,week] of Object.entries(s.weeklyLedger||{}))for(const match of Object.values(week.matchups||{})){
    if(Number(weekNumber)>postseason.endWeek(s.managers.filter(m=>accounts.some(a=>a.manager===m.id)).length))continue;
    if(match.status!=='final'||!result[match.home]||!result[match.away])continue;
    const a=result[match.home],b=result[match.away];a.pointsFor+=match.homeScore;a.pointsAgainst+=match.awayScore;
    b.pointsFor+=match.awayScore;b.pointsAgainst+=match.homeScore;
    if(match.homeScore===match.awayScore){a.ties++;b.ties++;}
    else if(match.homeScore>match.awayScore){a.wins++;b.losses++;}else{b.wins++;a.losses++;}
  }
  return Object.values(result).map(x=>({...x,pointsFor:Math.round(x.pointsFor*100)/100,pointsAgainst:Math.round(x.pointsAgainst*100)/100}))
    .sort((a,b)=>(b.wins+b.ties/2)/(b.wins+b.losses+b.ties||1)-(a.wins+a.ties/2)/(a.wins+a.losses+a.ties||1)||b.pointsFor-a.pointsFor);
}
return {updateWeeklyLedger,leagueStandings};
}
module.exports={createLeagueLedger,currentWeekScore,ledgerScore,ledgerLineup,ledgerTotal,...createLeagueLedger()};
