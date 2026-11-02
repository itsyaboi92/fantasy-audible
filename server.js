
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const DB = path.join(ROOT, 'league.json');
const AUTH = path.join(ROOT, 'accounts.json');
const PORT = process.env.PORT || 3000;

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

let state;
try {
  state = JSON.parse(fs.readFileSync(DB, 'utf8'));
} catch {
  state = initial;
  fs.writeFileSync(DB, JSON.stringify(state, null, 2));
}

let accounts = [];
try {
  accounts = JSON.parse(fs.readFileSync(AUTH, 'utf8'));
} catch {}

const sessions = new Map();
const clients = new Map();

function saveAccounts() {
  fs.writeFileSync(AUTH, JSON.stringify(accounts, null, 2));
}

function hash(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function tokenUser(req) {
  const token = (req.headers.authorization || '')
    .replace(/^Bearer /, '') ||
    new URL(req.url, 'http://localhost').searchParams.get('token') ||
    '';

  const session = sessions.get(token);
  if (!session || session.expires < Date.now()) return null;

  return accounts.find(a => a.id === session.id) || null;
}

function safeState(user) {
  return {
    ...state,
    managers: state.managers.map(m => ({
      ...m,
      claimed: accounts.some(a => a.manager === m.id)
    })),
    viewer: {
      manager: user.manager,
      commissioner: user.commissioner,
      name: user.name
    }
  };
}

function send(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(JSON.stringify(data));
}

function pushState() {
  for (const [res, userId] of clients) {
    const user = accounts.find(a => a.id === userId);
    if (!user) continue;

    try {
      res.write(`data: ${JSON.stringify(safeState(user))}\n\n`);
    } catch {
      clients.delete(res);
    }
  }
}

function broadcast() {
  state.version++;
  fs.writeFileSync(DB, JSON.stringify(state, null, 2));
  pushState();
}

function eligibility(starter, bench) {
  if (!starter || !bench) return null;
  if (starter.owner !== bench.owner) return null;
  if (starter.slot === 'BENCH') return null;
  if (bench.slot !== 'BENCH') return null;
  if (starter.pos !== bench.pos) return null;

  if (bench.team === starter.team && bench.kickoff <= state.phase) {
    return 'handcuff';
  }

  if (bench.kickoff > state.phase) {
    return 'later';
  }

  return null;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');

  // ACCOUNT REGISTRATION AND LOGIN
  if (
    req.method === 'POST' &&
    (url.pathname === '/api/register' || url.pathname === '/api/login')
  ) {
    let raw = '';

    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 10000) req.destroy();
    });

    req.on('end', () => {
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        return send(res, 400, { error: 'Invalid request' });
      }

      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '');

      if (!email.includes('@') || password.length < 10) {
        return send(res, 400, {
          error: 'Valid email and 10-character password required'
        });
      }

      let account;

      if (url.pathname === '/api/register') {
        const manager = state.managers.find(m => m.id === body.manager);

        if (
          !manager ||
          accounts.some(a => a.manager === manager.id) ||
          accounts.some(a => a.email === email)
        ) {
          return send(res, 409, {
            error: 'Email or team already claimed'
          });
        }

        const salt = crypto.randomBytes(16).toString('hex');

        account = {
          id: crypto.randomUUID(),
          email,
          name: email.split('@')[0],
          manager: manager.id,
          commissioner: accounts.length === 0,
          salt,
          passwordHash: hash(password, salt)
        };

        accounts.push(account);
        saveAccounts();
      } else {
        account = accounts.find(a => a.email === email);

        if (!account) {
          return send(res, 401, { error: 'Incorrect credentials' });
        }

        const candidate = hash(password, account.salt);

        if (!crypto.timingSafeEqual(
          Buffer.from(candidate, 'hex'),
          Buffer.from(account.passwordHash, 'hex')
        )) {
          return send(res, 401, { error: 'Incorrect credentials' });
        }
      }

      const token = crypto.randomBytes(32).toString('hex');

      sessions.set(token, {
        id: account.id,
        expires: Date.now() + 7 * 86400000
      });

      return send(res, 200, { token });
    });

    return;
  }

  // AVAILABLE TEAMS
  if (req.method === 'GET' && url.pathname === '/api/teams') {
    return send(res, 200, state.managers.map(m => ({
      id: m.id,
      team: m.team,
      claimed: accounts.some(a => a.manager === m.id)
    })));
  }

  const user = url.pathname.startsWith('/api/')
    ? tokenUser(req)
    : null;

  if (url.pathname.startsWith('/api/') && !user) {
    return send(res, 401, { error: 'Please sign in' });
  }

  // LEAGUE STATE
  if (req.method === 'GET' && url.pathname === '/api/state') {
    return send(res, 200, safeState(user));
  }

  // REAL-TIME MULTIPLAYER EVENTS
  if (req.method === 'GET' && url.pathname === '/api/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });

    res.write(`data: ${JSON.stringify(safeState(user))}\n\n`);
    clients.set(res, user.id);

    req.on('close', () => clients.delete(res));
    return;
  }

  // AUTHENTICATED ACTIONS
  if (req.method === 'POST' && url.pathname.startsWith('/api/')) {
    let raw = '';

    req.on('data', chunk => raw += chunk);

    req.on('end', () => {
      let body;

      try {
        body = JSON.parse(raw || '{}');
      } catch {
        return send(res, 400, { error: 'Invalid JSON' });
      }

      // CUSTOM TEAM NAME
      if (url.pathname === '/api/team-name') {
        const name = String(body.name || '')
          .trim()
          .replace(/\s+/g, ' ');

        if (
          name.length < 3 ||
          name.length > 40 ||
          /[<>\x00-\x1f]/.test(name)
        ) {
          return send(res, 400, {
            error: 'Team name must contain 3–40 valid characters'
          });
        }

        const team = state.managers.find(
          m => m.id === user.manager
        );

        if (!team) {
          return send(res, 403, { error: 'Team not found' });
        }

        if (state.managers.some(
          m => m.id !== team.id &&
          m.team.toLowerCase() === name.toLowerCase()
        )) {
          return send(res, 409, {
            error: 'Another team already uses that name'
          });
        }

        const oldName = team.team;
        team.team = name;

        state.transactions.unshift({
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          type: 'RENAME',
          manager: team.id,
          details: `${oldName} renamed to ${name}`
        });

        broadcast();

        return send(res, 200, {
          ok: true,
          team: name
        });
      }

      // INJURY SUBSTITUTION
      if (url.pathname === '/api/substitute') {
        const injury = state.injuries.find(
          i => i.id === body.injury && i.active
        );

        const starter = state.players.find(
          p => p.id === injury?.player
        );

        const bench = state.players.find(
          p => p.id === body.bench
        );

        if (!starter || starter.owner !== user.manager) {
          return send(res, 403, {
            error: 'You do not own this team'
          });
        }

        const mode = eligibility(starter, bench);

        if (!mode) {
          return send(res, 409, {
            error: 'Replacement is not eligible'
          });
        }

        const oldSlot = starter.slot;
        const previous = starter.points;

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
          details: `${starter.name} (${previous.toFixed(1)} pts) replaced by ${bench.name} (${mode})`
        });

        broadcast();

        return send(res, 200, { ok: true, mode });
      }

      // KEEP INJURED STARTER
      if (url.pathname === '/api/keep') {
        const injury = state.injuries.find(
          i => i.id === body.injury && i.active
        );

        if (!injury) {
          return send(res, 409, {
            error: 'Injury already resolved'
          });
        }

        const starter = state.players.find(
          p => p.id === injury.player
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

      // COMMISSIONER DEMO CONTROLS
      if (url.pathname === '/api/demo') {
        if (!user.commissioner) {
          return send(res, 403, {
            error: 'Commissioner only'
          });
        }

        if (body.action === 'advance') {
          state.phase = Math.min(4, state.phase + 1);

          state.players.forEach(p => {
            if (p.kickoff <= state.phase && p.status === 'upcoming') {
              p.status = 'playing';
            }
          });
        } else if (body.action === 'injure') {
          const player = state.players.find(
            p => p.id === body.player && p.slot !== 'BENCH'
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
            p => p.id === body.player
          );

          if (!player) {
            return send(res, 400, {
              error: 'Player not found'
            });
          }

          player.points += Number(body.amount) || 0;

          if (player.scoringMode === 'handcuff') {
            player.credited = Math.max(
              0,
              player.points - player.scoreAtSwap
            );
          }
        } else {
          return send(res, 400, {
            error: 'Unknown action'
          });
        }

        broadcast();
        return send(res, 200, { ok: true });
      }

      return send(res, 404, { error: 'Not found' });
    });

    return;
  }

  // SERVE WEBSITE
  const publicRoot = path.join(ROOT, 'public');
  const requested = path.resolve(
    publicRoot,
    '.' + (url.pathname === '/' ? '/index.html' : url.pathname)
  );

  if (
    requested !== publicRoot &&
    !requested.startsWith(publicRoot + path.sep)
  ) {
    res.writeHead(403);
    return res.end();
  }

  fs.readFile(requested, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end();
    }

    const type = requested.endsWith('.html')
      ? 'text/html'
      : requested.endsWith('.js')
      ? 'application/javascript'
      : 'text/css';

    res.writeHead(200, { 'Content-Type': type });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`Fantasy Audible running on port ${PORT}`);
});
