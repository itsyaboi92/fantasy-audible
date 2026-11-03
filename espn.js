
const { Pool } = require('pg');

const SEASON = Number(process.env.ESPN_SEASON || 2026);

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
const CACHE_SCHEMA_VERSION = 2;

// ESPN statistical identifiers used for offensive scoring.
// These are separate from ESPN's fantasy-point totals.
const STAT = {
  PASS_YARDS: '3',
  PASS_TD: '4',
  INTERCEPTIONS: '20',
  RUSH_YARDS: '24',
  RUSH_TD: '25',
  RECEIVE_YARDS: '42',
  RECEIVE_TD: '43',
  RECEPTIONS: '53',
  FUMBLES_LOST: '72'
};

const PPR_RULES = {
  PASS_YARDS: 1 / 25,
  PASS_TD: 4,
  INTERCEPTIONS: -2,
  RUSH_YARDS: 1 / 10,
  RUSH_TD: 6,
  RECEIVE_YARDS: 1 / 10,
  RECEIVE_TD: 6,
  RECEPTIONS: 1,
  FUMBLES_LOST: -2
};

function numberOrNull(value) {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) return null;

  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round2(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function positionOf(player) {
  return POSITIONS[player.defaultPositionId] || null;
}

function getRank(player, entry) {
  const sources = [
    player.draftRanksByRankType,
    entry.draftRanksByRankType
  ];

  for (const rankings of sources) {
    if (!rankings || typeof rankings !== 'object') {
      continue;
    }

    const ppr = rankings.PPR || rankings.ppr;

    const rank = numberOrNull(
      typeof ppr === 'object' ? ppr?.rank : ppr
    );

    if (rank !== null && rank > 0) {
      return rank;
    }
  }

  return null;
}

function getADP(player, entry) {
  const candidates = [
    player.ownership?.averageDraftPosition,
    entry.ownership?.averageDraftPosition,
    player.averageDraftPosition,
    entry.averageDraftPosition
  ];

  for (const candidate of candidates) {
    const value = numberOrNull(candidate);

    if (value !== null && value >= 0) {
      return value;
    }
  }

  return null;
}

function getStatsRecords(player, entry) {
  const sources = [
    player.stats,
    entry.stats
  ];

  const records = [];

  for (const source of sources) {
    if (Array.isArray(source)) {
      records.push(...source);
    }
  }

  return records;
}

function isSeasonProjection(record) {
  if (!record || typeof record !== 'object') {
    return false;
  }

  const season = numberOrNull(record.seasonId);
  const period = numberOrNull(record.scoringPeriodId);
  const source = numberOrNull(record.statSourceId);

  return (
    season === SEASON &&
    period === 0 &&
    source === 1
  );
}

function projectionRecords(player, entry) {
  return getStatsRecords(player, entry)
    .filter(isSeasonProjection);
}

function pprAppliedTotal(record) {
  // appliedTotal is a fantasy-point total, but it is only
  // safe to use if ESPN identifies the scoring context
  // as full PPR.
  //
  // ESPN's public response does not consistently provide
  // an explicit scoring-format label. Therefore, we do
  // not automatically assume appliedTotal is full PPR.

  const label = String(
    record.scoringFormat ||
    record.scoringType ||
    record.scoringSettings?.name ||
    ''
  ).toUpperCase();

  const explicitlyPPR = (
    label === 'PPR' ||
    label === 'FULL_PPR' ||
    label === 'FULL PPR' ||
    label === 'POINTS_PER_RECEPTION'
  );

  if (!explicitlyPPR) return null;

  return numberOrNull(record.appliedTotal);
}

function statValue(stats, id) {
  if (
    !stats ||
    typeof stats !== 'object' ||
    !Object.prototype.hasOwnProperty.call(stats, id)
  ) {
    return null;
  }

  return numberOrNull(stats[id]);
}

function calculateOffensivePPR(record, position) {
  if (!['QB', 'RB', 'WR', 'TE'].includes(position)) {
    return null;
  }

  const stats = record.stats;

  if (
    !stats ||
    typeof stats !== 'object' ||
    Array.isArray(stats)
  ) {
    return null;
  }

  // Require meaningful projected statistics before
  // calculating a total. A record with only a few stats
  // cannot reliably represent a complete season projection.
  //
  // For quarterbacks, require passing yards and TDs.
  // For skill players, require receiving/rushing volume
  // appropriate to their position.

  if (position === 'QB') {
    if (
      statValue(stats, STAT.PASS_YARDS) === null ||
      statValue(stats, STAT.PASS_TD) === null ||
      statValue(stats, STAT.INTERCEPTIONS) === null
    ) {
      return null;
    }
  }

  if (position === 'RB') {
    if (
      statValue(stats, STAT.RUSH_YARDS) === null ||
      statValue(stats, STAT.RUSH_TD) === null ||
      statValue(stats, STAT.RECEPTIONS) === null ||
      statValue(stats, STAT.RECEIVE_YARDS) === null
    ) {
      return null;
    }
  }

  if (position === 'WR' || position === 'TE') {
    if (
      statValue(stats, STAT.RECEPTIONS) === null ||
      statValue(stats, STAT.RECEIVE_YARDS) === null ||
      statValue(stats, STAT.RECEIVE_TD) === null
    ) {
      return null;
    }
  }

  let points = 0;
  let fieldsUsed = 0;

  for (const [key, statId] of Object.entries(STAT)) {
    const value = statValue(stats, statId);

    if (value === null) continue;

    points += value * PPR_RULES[key];
    fieldsUsed++;
  }

  if (fieldsUsed < 3) return null;

  return round2(points);
}

function getProjection(player, entry, position) {
  const records = projectionRecords(player, entry);

  for (const record of records) {
    const applied = pprAppliedTotal(record);

    if (applied !== null) {
      return {
        points: round2(applied),
        method: 'espn_explicit_ppr'
      };
    }
  }

  for (const record of records) {
    const calculated = calculateOffensivePPR(
      record,
      position
    );

    if (calculated !== null) {
      return {
        points: calculated,
        method: 'calculated_from_espn_stats'
      };
    }
  }

  return {
    points: null,
    method: 'unavailable'
  };
}

function normalizePlayer(entry) {
  const player = entry.player || entry;

  if (!player || !player.id || !player.fullName) {
    return null;
  }

  const position = positionOf(player);

  if (!position) return null;

  const projection = getProjection(
    player,
    entry,
    position
  );

  return {
    id: String(player.id),
    name: player.fullName,
    position,
    nflTeamId: player.proTeamId ?? null,
    rank: getRank(player, entry),
    projectedPoints: projection.points,
    projectionMethod: projection.method,
    averageDraftPosition: getADP(player, entry),
    injuryStatus: player.injuryStatus || 'UNKNOWN',
    source: 'ESPN',
    season: SEASON
  };
}

function sortPlayers(players) {
  return players.sort((a, b) => {
    const rankA = a.rank ?? Infinity;
    const rankB = b.rank ?? Infinity;

    if (rankA !== rankB) {
      return rankA - rankB;
    }

    const adpA = a.averageDraftPosition ?? Infinity;
    const adpB = b.averageDraftPosition ?? Infinity;

    if (adpA !== adpB) {
      return adpA - adpB;
    }

    return a.name.localeCompare(b.name);
  });
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

  await pool.query(`
    ALTER TABLE espn_player_cache
    ADD COLUMN IF NOT EXISTS schema_version INTEGER
    NOT NULL DEFAULT 1
  `);
}

async function cachedESPN() {
  const result = await pool.query(`
    SELECT
      season,
      players,
      updated_at,
      schema_version
    FROM espn_player_cache
    WHERE id = 1
  `);

  if (!result.rows.length) {
    return {
      players: [],
      updatedAt: null,
      season: SEASON,
      source: 'ESPN',
      stale: true,
      cacheVersion: 0
    };
  }

  const row = result.rows[0];

  const age = Date.now() -
    new Date(row.updated_at).getTime();

  return {
    players: row.players,
    updatedAt: row.updated_at,
    season: row.season,
    source: 'ESPN',
    stale: (
      age > REFRESH_INTERVAL ||
      row.season !== SEASON ||
      row.schema_version !== CACHE_SCHEMA_VERSION
    ),
    cacheVersion: row.schema_version
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
    throw new Error(
      `ESPN returned HTTP ${response.status}`
    );
  }

  const payload = await response.json();

  const entries = Array.isArray(payload)
    ? payload
    : Array.isArray(payload.players)
    ? payload.players
    : [];

  const players = sortPlayers(
    entries.map(normalizePlayer).filter(Boolean)
  );

  if (players.length < 100) {
    throw new Error(
      'ESPN response did not contain a usable player pool'
    );
  }

  const withProjections = players.filter(
    p => p.projectedPoints !== null
  ).length;

  const withRanks = players.filter(
    p => p.rank !== null
  ).length;

  console.log(
    `ESPN season ${SEASON}: ` +
    `${players.length} players, ` +
    `${withRanks} ranked, ` +
    `${withProjections} with calculated/verified PPR projections`
  );

  await pool.query(`
    INSERT INTO espn_player_cache (
      id,
      season,
      players,
      updated_at,
      schema_version
    )
    VALUES (1,$1,$2::jsonb,NOW(),$3)
    ON CONFLICT (id)
    DO UPDATE SET
      season = EXCLUDED.season,
      players = EXCLUDED.players,
      updated_at = NOW(),
      schema_version = EXCLUDED.schema_version
  `, [
    SEASON,
    JSON.stringify(players),
    CACHE_SCHEMA_VERSION
  ]);

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
    console.error(
      'ESPN refresh failed:',
      error.message
    );

    if (cache.players.length) {
      return {
        ...cache,
        stale: true,
        refreshError: error.message
      };
    }

    throw error;
  }
}

module.exports = {
  initializeESPN,
  getESPNPlayers,
  refreshESPN
};
