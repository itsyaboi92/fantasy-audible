
const { Pool } = require('pg');

const SEASON = 2026;

const ESPN_URL =
  `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${SEASON}/players?scoringPeriodId=0&view=kona_player_info`;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

const POSITIONS = {
  1: 'QB',
  2: 'RB',
  3: 'WR',
  4: 'TE',
  5: 'K',
  16: 'D/ST'
};

const REFRESH_INTERVAL = 6 * 60 * 60 * 1000;

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function getRank(player) {
  const rankings = player.draftRanksByRankType || {};

  const ppr = rankings.PPR;

  if (ppr) {
    const rank = finiteNumber(ppr.rank);
    if (rank !== null && rank > 0) return rank;
  }

  return null;
}

function getProjection(player) {
  const stats = Array.isArray(player.stats)
    ? player.stats
    : [];

  const projection = stats.find(s =>
    s.seasonId === SEASON &&
    s.scoringPeriodId === 0 &&
    s.statSourceId === 1
  );

  if (!projection) return null;

  // Some ESPN responses include an already-scored total.
  // Others provide raw statistical projections only.
  // Never mistake raw yardage for fantasy points.
  return finiteNumber(projection.appliedTotal);
}

function normalizePlayer(entry) {
  const player = entry.player || entry;

  if (!player || !player.id || !player.fullName) {
    return null;
  }

  const position = POSITIONS[player.defaultPositionId];

  if (!position) return null;

  return {
    id: String(player.id),
    name: player.fullName,
    position,
    nflTeamId: player.proTeamId ?? null,
    rank: getRank(player),
    projectedPoints: getProjection(player),
    averageDraftPosition: finiteNumber(
      player.ownership?.averageDraftPosition
    ),
    injuryStatus: player.injuryStatus || 'UNKNOWN',
    source: 'ESPN',
    season: SEASON
  };
}

async function initializeESPN() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS espn_player_cache (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      season INTEGER NOT NULL,
      players JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function cachedESPN() {
  const result = await pool.query(`
    SELECT season, players, updated_at
    FROM espn_player_cache
    WHERE id = 1
  `);

  if (!result.rows.length) {
    return {
      players: [],
      updatedAt: null,
      season: SEASON,
      source: 'ESPN',
      stale: true
    };
  }

  const row = result.rows[0];

  return {
    players: row.players,
    updatedAt: row.updated_at,
    season: row.season,
    source: 'ESPN',
    stale:
      Date.now() - new Date(row.updated_at).getTime()
      > REFRESH_INTERVAL
  };
}

async function refreshESPN() {
  const filter = {
    players: {
      limit: 1500,
      offset: 0,
      filterRanksForScoringPeriodIds: {
        value: [0]
      }
    }
  };

  const response = await fetch(ESPN_URL, {
    headers: {
      Accept: 'application/json',
      'X-Fantasy-Filter': JSON.stringify(filter)
    },
    signal: AbortSignal.timeout(20000)
  });

  if (!response.ok) {
    throw new Error(`ESPN returned HTTP ${response.status}`);
  }

  const payload = await response.json();

  const entries = Array.isArray(payload)
    ? payload
    : Array.isArray(payload.players)
      ? payload.players
      : [];

  const players = entries
    .map(normalizePlayer)
    .filter(Boolean)
    .sort((a, b) => {
      const rankA = a.rank ?? Infinity;
      const rankB = b.rank ?? Infinity;

      if (rankA !== rankB) return rankA - rankB;

      return (
        (a.averageDraftPosition ?? Infinity) -
        (b.averageDraftPosition ?? Infinity)
      );
    });

  if (players.length < 100) {
    throw new Error(
      'ESPN response did not contain a usable player pool'
    );
  }

  await pool.query(`
    INSERT INTO espn_player_cache
      (id, season, players, updated_at)
    VALUES (1, $1, $2::jsonb, NOW())
    ON CONFLICT (id)
    DO UPDATE SET
      season = EXCLUDED.season,
      players = EXCLUDED.players,
      updated_at = NOW()
  `, [SEASON, JSON.stringify(players)]);

  return cachedESPN();
}

let refreshInProgress = null;

async function getESPNPlayers() {
  const cache = await cachedESPN();

  if (!cache.stale) return cache;

  if (!refreshInProgress) {
    refreshInProgress = refreshESPN()
      .finally(() => {
        refreshInProgress = null;
      });
  }

  try {
    return await refreshInProgress;
  } catch (error) {
    console.error('ESPN refresh failed:', error.message);

    // Continue serving the last successful data.
    if (cache.players.length) return cache;

    throw error;
  }
}

module.exports = {
  initializeESPN,
  getESPNPlayers,
  refreshESPN
};
