'use strict';
// Evidence-backed historical roster exceptions. Never infer inactivity from an
// absent box-score row: that could be a feed outage or an unused active player.
const evidence=[Object.freeze({
  espnId:'4574716',season:2026,fromWeek:9,throughWeek:9,teamId:'14',
  status:'RELEASED',
  source:'https://www.nfl.com/news/rams-releasing-kicker-harrison-mevis-signing-k-blake-grupe-off-jets-practice-squad',
  effectiveDate:'2026-10-13'
})];
function historicalStatus(espnId,season,week){
 const id=String(espnId||'').replace(/^espn-/,'');
 return evidence.find(x=>x.espnId===id&&x.season===Number(season)&&Number(week)>=x.fromWeek&&Number(week)<=x.throughWeek)||null;
}
function verifiedInactive(espnId,season,week){
 const x=historicalStatus(espnId,season,week);
 return x&&x.status==='RELEASED'?{teamId:x.teamId,points:0,status:'INACTIVE',source:x.source}:null;
}
module.exports={historicalStatus,verifiedInactive};
