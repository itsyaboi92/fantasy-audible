'use strict';
// A missing field is not a zero. Game/team/stat keys are shared by every league.
const {defenseStats,scoreDefense}=require('./live-nfl');
const COUNT_FIELDS=new Set(['sacks','interceptions','forcedFumble','fumbleRecovered','safety','blockedKick','interceptionTD','fumbleReturnTD','kickoffReturnTD','puntReturnTD','twoPointReturn','onePointSafety']);
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
   if(!Number.isInteger(value)||value<0)continue;
   result.push({team,field,value,source:Object.hasOwn(playerTotals.get(team)||{},field)?'ESPN attributed player defensive totals':'ESPN defensive box score',verified:true});
  }
  if(box.opponentFound&&Number.isInteger(Number(box.pointsAllowed))&&Number(box.pointsAllowed)>=0&&box.pointsAllowed!==null&&box.pointsAllowed!==undefined)result.push({team,field:'pointsAllowed',value:box.pointsAllowed,source:'ESPN game scoreboard',verified:true});
  if(Number.isInteger(box.yardsAllowed)&&box.yardsAllowed>=0)result.push({team,field:'yardsAllowed',value:box.yardsAllowed,source:'ESPN offensive team total',verified:true});
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
   observed_at=NOW(),game_final=(fantasy_audible_defense_stats.game_final OR EXCLUDED.game_final),
   verified=(fantasy_audible_defense_stats.verified OR EXCLUDED.verified),
   source=CASE WHEN fantasy_audible_defense_stats.game_final AND NOT EXCLUDED.game_final THEN fantasy_audible_defense_stats.source WHEN fantasy_audible_defense_stats.stat='forcedFumble' AND fantasy_audible_defense_stats.source LIKE 'ESPN Fantasy weekly actual%' THEN fantasy_audible_defense_stats.source ELSE EXCLUDED.source END,
   value=CASE WHEN fantasy_audible_defense_stats.game_final AND NOT EXCLUDED.game_final THEN fantasy_audible_defense_stats.value WHEN fantasy_audible_defense_stats.stat='forcedFumble' AND fantasy_audible_defense_stats.source LIKE 'ESPN Fantasy weekly actual%' THEN fantasy_audible_defense_stats.value ELSE EXCLUDED.value END`,
   [season,String(game.id),x.team,x.field,x.value,x.source,x.verified,game.status==='final']);
 }
 return incoming.length;
}
// ESPN Fantasy weekly actual is authoritative for forced fumbles only.
// Its omitted zero is inferred (not verified); no week record means NO update.
async function ingestFantasyForcedFumble(pool,season,game,teamId,value,explicit){
 if(!Number.isInteger(value)||value<0)throw Error('Invalid ESPN Fantasy forced-fumble count');
 const params=[season,String(game.id),String(teamId),'forcedFumble',value];
 await pool.query(`INSERT INTO fantasy_audible_defense_conflicts
 (season,game_id,team_id,stat,stored_value,incoming_value)
 SELECT $1,$2,$3,$4,value,$5 FROM fantasy_audible_defense_stats
 WHERE season=$1 AND game_id=$2 AND team_id=$3 AND stat=$4 AND value<>$5
 ON CONFLICT(season,game_id,team_id,stat,incoming_value) DO UPDATE SET last_seen=NOW()`,params);
 await pool.query(`INSERT INTO fantasy_audible_defense_stats
 (season,game_id,team_id,stat,value,source,verified,game_final)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8)
 ON CONFLICT(season,game_id,team_id,stat) DO UPDATE SET
 value=CASE WHEN NOT EXCLUDED.verified AND fantasy_audible_defense_stats.verified THEN fantasy_audible_defense_stats.value ELSE EXCLUDED.value END,
 source=CASE WHEN NOT EXCLUDED.verified AND fantasy_audible_defense_stats.verified THEN fantasy_audible_defense_stats.source ELSE EXCLUDED.source END,
 verified=(fantasy_audible_defense_stats.verified OR EXCLUDED.verified),
 game_final=(fantasy_audible_defense_stats.game_final OR EXCLUDED.game_final),observed_at=NOW()`,
 [...params,explicit?'ESPN Fantasy weekly actual':'ESPN Fantasy weekly actual (omitted zero inferred)',explicit,game.status==='final']);
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
  const displayKey=({sacks:'sack',interceptions:'interception'})[row.stat]||row.stat;
  details[displayKey]={value,source:row.source,verified:row.verified,final:row.game_final};
 }
 const scored=scoreDefense({stats,pointsAllowed,yardsAllowed,opponentFound:pointsAllowed!==null},rules);
 const critical=[...FIELDS,'pointsAllowed','yardsAllowed'];
 const verification=Object.fromEntries(critical.map(field=>{const d=details[({sacks:'sack',interceptions:'interception'})[field]||field];return [field,{present:!!d,verified:!!d?.verified,source:d?.source||null,final:!!d?.final}];}));
 return {...scored,statDetails:details,verification,counts:stats,pointsAllowed,yardsAllowed,complete:game.status==='final'&&!scored.unsupported.length&&
  critical.every(field=>verification[field].present&&verification[field].verified&&verification[field].final),source:'persisted-defense-stats'};
}
module.exports={init,ingest,get,observations,ingestFantasyForcedFumble};
