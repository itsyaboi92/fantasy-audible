
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DB = path.join(__dirname, 'league.json');
const AUTH = path.join(__dirname, 'accounts.json');

const SESSION_DAYS = 30;

const initial = {
  version: 1,
  league: 'Fantasy Audible League',
  week: 9,
  phase: 2,
  managers: [
    { id: 'm1', name: 'Manager 1', team: 'Fourth Down Rebels' },
    { id: 'm2', name: 'Manager 2', team: 'Red Zone Raiders' },
    { id: 'm3', name: 'Manager 3', team: 'Sunday Legends' },
    { id: 'm4', name: 'Manager 4', team: 'Gridiron Kings' }
  ],
  players: [
    { id:'p1', name:'Joe Burrow', team:'CIN', pos:'QB', kickoff:1, status:'injured', points:8.6, slot:'QB', owner:'m1' },
    { id:'p2', name:'Cincinnati Backup QB', team:'CIN', pos:'QB', kickoff:1, status:'playing', points:3.4, slot:'BENCH', owner:'m1' },
    { id:'p3', name:'Patrick Mahomes', team:'KC', pos:'QB', kickoff:3, status:'upcoming', points:0, slot:'BENCH', owner:'m1' },
    { id:'p4', name:'Ja’Marr Chase', team:'CIN', pos:'WR', kickoff:1, status:'playing', points:14.2, slot:'WR', owner:'m1' },
    { id:'p5', name:'Tee Higgins', team:'CIN', pos:'WR', kickoff:1, status:'playing', points:9.4, slot:'BENCH', owner:'m1' },
    { id:'p6', name:'Chase Brown', team:'CIN', pos:'RB', kickoff:1, status:'playing', points:12.3, slot:'RB', owner:'m1' },
    { id:'p7', name:'Jordan Mason', team:'MIN', pos:'RB', kickoff:3, status:'upcoming', points:0, slot:'BENCH', owner:'m1' },
    { id:'p8', name:'George Kittle', team:'SF', pos:'TE', kickoff:2, status:'playing', points:7.2, slot:'TE', owner:'m1' },
    { id:'p9', name:'Lamar Jackson', team:'BAL', pos:'QB', kickoff:1, status:'playing', points:18.7, slot:'QB', owner:'m2' },
    { id:'p10', name:'Derrick Henry', team:'BAL', pos:'RB', kickoff:1, status:'playing', points:17.5, slot:'RB', owner:'m2' },
    { id:'p11', name:'Zay Flowers', team:'BAL', pos:'WR', kickoff:1, status:'playing', points:11.1, slot:'WR', owner:'m2' },
    { id:'p12', name:'Mark Andrews', team:'BAL', pos:'TE', kickoff:1, status:'playing', points:6.3, slot:'TE', owner:'m2' }
  ],
  injuries: [
    { id:'i1', player:'p1', active:true, description:'Demo injury' }
  ],
  transactions: []
};

function load(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return fallback;
  }
}

function save(file, value) {
  const temp = file + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), {
    mode: 0o600
  });
  fs.renameSync(temp, file);
}

let state = load(DB, initial);
let accounts = load(AUTH, []);

if (!Array.isArray(accounts)) {
  throw new Error('Invalid accounts database');
}

save(DB, state);

const clients = new Map();

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function tokenHash(token) {
  return crypto.createHash('sha256')
    .update(token)
    .digest('hex');
}

function issueToken(account) {
  const token = crypto.randomBytes(32).toString('hex');

  if (!Array.isArray(account.sessions)) {
    account.sessions = [];
  }

  account.sessions = account.sessions.filter(
    s => s.expires > Date.now()
  );

  account.sessions.push({
    hash: tokenHash(token),
    expires: Date.now() + SESSION_DAYS * 86400000
  });

  save(AUTH, accounts);
  return token;
}

function getUser(req) {
  const url = new URL(req.url, 'http://localhost');

  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ')
    ? header.slice(7)
    : url.searchParams.get('token') || '';

  if (!/^[a-f0-9]{64}$/.test(token)) return null;

  const hashed = tokenHash(token);

  return accounts.find(account =>
    Array.isArray(account.sessions) &&
    account.sessions.some(session =>
      session.hash === hashed &&
      session.expires > Date.now()
    )
  ) || null;
}

function send(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(data));
}

function safeState(user) {
  return {
    ...state,
    managers: state.managers.map(team => ({
      ...team,
      claimed: accounts.some(a => a.manager === team.id)
    })),
    viewer: {
      manager: user.manager,
      commissioner: user.commissioner,
      name: user.name
    }
  };
}

function pushState() {
  for (const [res, accountId] of clients) {
    const account = accounts.find(a => a.id === accountId);

    if (!account) {
      clients.delete(res);
      continue;
    }

    try {
      res.write(
        'data: ' + JSON.stringify(safeState(account)) + '\n\n'
      );
    } catch {
      clients.delete(res);
    }
  }
}

function broadcast() {
  state.version = (state.version || 0) + 1;
  save(DB, state);
  pushState();
}

function validTeamName(value) {
  if (typeof value !== 'string') return null;

  const name = value.trim().replace(/\s+/g, ' ');

  if (
    name.length < 3 ||
    name.length > 40 ||
    /[<>\x00-\x1f]/.test(name)
  ) return null;

  return name;
}

function nameTaken(name, exceptId) {
  return state.managers.some(team =>
    team.id !== exceptId &&
    team.team.toLowerCase() === name.toLowerCase()
  );
}

function eligible(starter, bench) {
  if (!starter || !bench) return null;
  if (starter.owner !== bench.owner) return null;
  if (starter.slot === 'BENCH') return null;
  if (bench.slot !== 'BENCH') return null;
  if (starter.pos !== bench.pos) return null;

  if (
    starter.team === bench.team &&
    bench.kickoff <= state.phase
  ) return 'handcuff';

  if (bench.kickoff > state.phase) return 'later';

  return null;
}

function readBody(req, res, callback) {
  let raw = '';
  let tooLarge = false;

  req.on('data', chunk => {
    raw += chunk;

    if (raw.length > 20000) {
      tooLarge = true;
      req.destroy();
    }
  });

  req.on('end', () => {
    if (tooLarge) return;

    try {
      const body = JSON.parse(raw || '{}');
      callback(body);
    } catch {
      send(res, 400, { error: 'Invalid JSON' });
    }
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const route = url.pathname;

  if (req.method === 'GET' && route === '/api/teams') {
    return send(res, 200, state.managers.map(team => ({
      id: team.id,
      team: team.team,
      claimed: accounts.some(a => a.manager === team.id)
    })));
  }

  if (
    req.method === 'POST' &&
    (route === '/api/register' || route === '/api/login')
  ) {
    return readBody(req, res, body => {
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '');

      if (!email.includes('@') || password.length < 10) {
        return send(res, 400, {
          error: 'Valid email and password of 10+ characters required'
        });
      }

      let account;

      if (route === '/api/register') {
        const team = state.managers.find(
          t => t.id === body.manager
        );

        if (!team) {
          return send(res, 400, { error: 'Invalid team slot' });
        }

        if (
          accounts.some(a => a.email === email) ||
          accounts.some(a => a.manager === team.id)
        ) {
          return send(res, 409, {
            error: 'Email or team already claimed'
          });
        }

        const customName = body.teamName
          ? validTeamName(body.teamName)
          : team.team;

        if (!customName) {
          return send(res, 400, {
            error: 'Team name must be 3–40 valid characters'
          });
        }

        if (nameTaken(customName, team.id)) {
          return send(res, 409, {
            error: 'Another team already uses that name'
          });
        }

        const salt = crypto.randomBytes(16).toString('hex');

        account = {
          id: crypto.randomUUID(),
          email,
          name: email.split('@')[0],
          manager: team.id,
          commissioner: accounts.length === 0,
          salt,
          passwordHash: hashPassword(password, salt),
          sessions: []
        };

        accounts.push(account);
        save(AUTH, accounts);

        const oldName = team.team;
        team.team = customName;

        state.transactions.unshift({
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          type: 'REGISTRATION',
          manager: team.id,
          details: `${oldName} claimed as ${customName}`
        });

        broadcast();
      } else {
        account = accounts.find(a => a.email === email);

        if (!account) {
          return send(res, 401, {
            error: 'Incorrect credentials'
          });
        }

        const candidate = hashPassword(password, account.salt);
        const stored = account.passwordHash;

        if (
          !/^[a-f0-9]{128}$/.test(stored) ||
          !crypto.timingSafeEqual(
            Buffer.from(candidate, 'hex'),
            Buffer.from(stored, 'hex')
          )
        ) {
          return send(res, 401, {
            error: 'Incorrect credentials'
          });
        }
      }

      const token = issueToken(account);
      send(res, 200, { token });
    });
  }

  const user = route.startsWith('/api/')
    ? getUser(req)
    : null;

  if (route.startsWith('/api/') && !user) {
    return send(res, 401, {
      error: 'Please sign in'
    });
  }

  if (req.method === 'GET' && route === '/api/state') {
    return send(res, 200, safeState(user));
  }

  if (req.method === 'GET' && route === '/api/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive'
    });

    res.write(
      'data: ' + JSON.stringify(safeState(user)) + '\n\n'
    );

    clients.set(res, user.id);
    req.on('close', () => clients.delete(res));
    return;
  }

  if (req.method === 'POST' && route.startsWith('/api/')) {
    return readBody(req, res, body => {

      if (route === '/api/team-name') {
        const name = validTeamName(body.name);

        if (!name) {
          return send(res, 400, {
            error: 'Team name must be 3–40 valid characters'
          });
        }

        const team = state.managers.find(
          t => t.id === user.manager
        );

        if (!team) {
          return send(res, 403, {
            error: 'Team not found'
          });
        }

        if (nameTaken(name, team.id)) {
          return send(res, 409, {
            error: 'Another team already uses that name'
          });
        }

        const previous = team.team;
        team.team = name;

        state.transactions.unshift({
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          type: 'RENAME',
          manager: team.id,
          details: `${previous} renamed to ${name}`
        });

        broadcast();
        return send(res, 200, { ok: true, team: name });
      }

      if (route === '/api/substitute') {
        const injury = state.injuries.find(
          i => i.id === body.injury && i.active
        );

        const starter = state.players.find(
          x => x.id === injury?.player
        );

        const bench = state.players.find(
          x => x.id === body.bench
        );

        if (!starter || starter.owner !== user.manager) {
          return send(res, 403, {
            error: 'You do not own this team'
          });
        }

        const mode = eligible(starter, bench);

        if (!mode) {
          return send(res, 409, {
            error: 'Replacement is not eligible'
          });
        }

        const oldSlot = starter.slot;
        const oldPoints = starter.points;

        starter.slot = 'BENCH';
        bench.slot = oldSlot;

        bench.scoringMode = mode;
        bench.scoreAtSwap = mode === 'handcuff'
          ? bench.points
          : 0;

        bench.credited = mode === 'handcuff'
          ? 0
          : bench.points;

        injury.active = false;

        state.transactions.unshift({
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          type: 'SUBSTITUTION',
          manager: starter.owner,
          details: `${starter.name} (${oldPoints.toFixed(1)} pts) replaced by ${bench.name} (${mode})`
        });

        broadcast();
        return send(res, 200, { ok: true, mode });
      }

      if (route === '/api/keep') {
        const injury = state.injuries.find(
          i => i.id === body.injury && i.active
        );

        if (!injury) {
          return send(res, 409, {
            error: 'Injury already resolved'
          });
        }

        const starter = state.players.find(
          x => x.id === injury.player
        );

        if (starter?.owner !== user.manager) {
          return send(res, 403, {
            error: 'You do not own this team'
          });
        }

        injury.active = false;

        state.transactions.unshift({
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          type: 'KEEP',
          manager: user.manager,
          details: 'Manager retained injured starter'
        });

        broadcast();
        return send(res, 200, { ok: true });
      }

      if (route === '/api/demo') {
        if (!user.commissioner) {
          return send(res, 403, {
            error: 'Commissioner only'
          });
        }

        if (body.action === 'advance') {
          state.phase = Math.min(4, state.phase + 1);

          state.players.forEach(player => {
            if (
              player.kickoff <= state.phase &&
              player.status === 'upcoming'
            ) {
              player.status = 'playing';
            }
          });
        } else if (body.action === 'injure') {
          const player = state.players.find(
            x => x.id === body.player &&
            x.slot !== 'BENCH'
          );

          if (!player) {
            return send(res, 400, {
              error: 'Choose an active starter'
            });
          }

          player.status = 'injured';

          state.injuries.push({
            id: crypto.randomUUID(),
            player: player.id,
            active: true,
            description: 'Demo injury event'
          });
        } else if (body.action === 'points') {
          const player = state.players.find(
            x => x.id === body.player
          );

          if (!player) {
            return send(res, 400, {
              error: 'Player not found'
            });
          }

          const amount = Number(body.amount);

          if (!Number.isFinite(amount) || Math.abs(amount) > 100) {
            return send(res, 400, {
              error: 'Invalid points amount'
            });
          }

          player.points += amount;

          if (player.scoringMode === 'handcuff') {
            player.credited = Math.max(
              0,
              player.points - player.scoreAtSwap
            );
          }
        } else {
          return send(res, 400, {
            error: 'Unknown demo action'
          });
        }

        broadcast();
        return send(res, 200, { ok: true });
      }

      return send(res, 404, { error: 'Not found' });
    });
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405);
    return res.end();
  }

  const publicRoot = path.resolve(__dirname, 'public');

  let decodedPath;
  try {
    decodedPath = decodeURIComponent(route);
  } catch {
    res.writeHead(400);
    return res.end();
  }

  const requested = path.resolve(
    publicRoot,
    '.' + (decodedPath === '/' ? '/index.html' : decodedPath)
  );

  if (
    requested !== publicRoot &&
    !requested.startsWith(publicRoot + path.sep)
  ) {
    res.writeHead(403);
    return res.end();
  }

  fs.readFile(requested, (error, data) => {
    if (error) {
      res.writeHead(404);
      return res.end();
    }

    const type = requested.endsWith('.html')
      ? 'text/html; charset=utf-8'
      : requested.endsWith('.js')
        ? 'application/javascript; charset=utf-8'
        : requested.endsWith('.css')
          ? 'text/css; charset=utf-8'
          : 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': type,
      'X-Content-Type-Options': 'nosniff'
    });

    res.end(req.method === 'HEAD' ? undefined : data);
  });
});

server.listen(PORT, () => {
  console.log(`Fantasy Audible running on port ${PORT}`);
});
