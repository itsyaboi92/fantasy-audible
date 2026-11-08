'use strict';
// A missing field is not a zero. Game/team/stat keys are shared by every league.
const {defenseStats,scoreDefense}=require('./live-nfl');
const FIELDS=['sacks','interceptions','forcedFumble','fumbleRecovered','safety','blockedKick','interceptionTD','fumbleReturnTD','kickoffReturnTD','puntReturnTD','twoPointReturn','onePointSafety'];
async function init(pool){
 await pool.query(`CREATE TABLE IF NOT EXISTS fantasy_audible_defense_conflicts (
 season INTEGER NOT NULL,game_id TEXT NOT NULL,team_id TEXT NOT NULL,stat TEXT NOT NULL,
 stored_value NUMERIC NOT NULL,incoming_value NUMERIC NOT NULL,
 first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(season,game_id,team_id,stat,incoming_value))`);
 await pool.query(`CREATE TABLE IF NOT EXISTS fantasy_audible_defense_stats (
 season INTEGER NOT NULL,game_id TEXT NOT NULL,team_id TEXT NOT NULL,stat TEXT NOT NULL,
 value NUMERIC NOT NULL CHECK(value>=0),source TEXT NOT NULL,verified BOOLEAN NOT NULL DEFAULT FALSE,
 game_final BOOLEAN NOT NULL DEFAULT FALSE,observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(season,game_id,team_id,stat))`);
}
function observations(summary,game){
 const result=[];
 const playerTotals=require('./live-nfl').defensivePlayerTotals(summary);
 for(const [team,box] of defenseStats(summary,game).entries()){
  for(const field of FIELDS){
   const value=box.stats[field];
   if(!Number.isFinite(value)||value<0)continue;
   result.push({team,field,value,source:Object.hasOwn(playerTotals.get(team)||{},field)?'ESPN attributed player defensive totals':'ESPN defensive box score',verified:true});
  }
  if(box.opponentFound&&Number.isFinite(box.pointsAllowed))result.push({team,field:'pointsAllowed',value:box.pointsAllowed,source:'ESPN game scoreboard',verified:true});
  if(Number.isFinite(box.yardsAllowed))result.push({team,field:'yardsAllowed',value:box.yardsAllowed,source:'ESPN offensive team total',verified:true});
 }
 return result;
}
async function ingest(pool,season,game,summary){
 const incoming=observations(summary,game);
 for(const x of incoming){
  // Preserve the last confirmed value on a missing/partial refresh. Do not
  // silently replace conflicting values: retain evidence for review instead.
  await pool.query(`INSERT INTO fantasy_audible_defense_conflicts
    (season,game_id,team_id,stat,stored_value,incoming_value)
    SELECT $1,$2,$3,$4,value,$5 FROM fantasy_audible_defense_stats
    WHERE season=$1 AND game_id=$2 AND team_id=$3 AND stat=$4 AND value<>$5
    ON CONFLICT(season,game_id,team_id,stat,incoming_value) DO UPDATE SET last_seen=NOW()`,
    [season,String(game.id),x.team,x.field,x.value]);
  await pool.query(`INSERT INTO fantasy_audible_defense_stats
   (season,game_id,team_id,stat,value,source,verified,game_final)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8)
   ON CONFLICT(season,game_id,team_id,stat) DO UPDATE SET
   observed_at=NOW(),game_final=EXCLUDED.game_final,
   source=CASE WHEN EXCLUDED.source='ESPN attributed player defensive totals' THEN EXCLUDED.source ELSE fantasy_audible_defense_stats.source END,
   value=CASE WHEN fantasy_audible_defense_stats.value=EXCLUDED.value OR EXCLUDED.source='ESPN attributed player defensive totals' THEN EXCLUDED.value ELSE fantasy_audible_defense_stats.value END`,
   [season,String(game.id),x.team,x.field,x.value,x.source,x.verified,game.status==='final']);
 }
 return incoming.length;
}
async function get(pool,season,game,teamId,rules){
 const r=await pool.query('SELECT stat,value,source,verified,game_final FROM fantasy_audible_defense_stats WHERE season=$1 AND game_id=$2 AND team_id=$3',[season,String(game.id),String(teamId)]);
 if(!r.rows.length)return null;
 const stats={},details={};let pointsAllowed=null,yardsAllowed=null;
 for(const row of r.rows){
  const value=Number(row.value);
  if(row.stat==='pointsAllowed')pointsAllowed=value;
  else if(row.stat==='yardsAllowed')yardsAllowed=value;
  else stats[row.stat]=value;
  details[row.stat]={value,source:row.source,verified:row.verified,final:row.game_final};
 }
 const scored=scoreDefense({stats,pointsAllowed,yardsAllowed,opponentFound:pointsAllowed!==null},rules);
 return {...scored,statDetails:details,counts:stats,pointsAllowed,yardsAllowed,complete:game.status==='final'&&!scored.unsupported.length,source:'persisted-defense-stats'};
}
module.exports={init,ingest,get,observations};
