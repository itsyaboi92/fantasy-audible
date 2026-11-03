
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');
const {
  initializeESPN,
  getESPNPlayers
} = require('./espn');

const PORT = process.env.PORT || 3000;
const MAX_TEAMS = 12;
const DRAFT_ROUNDS = 15;
const PICK_SECONDS = 90;

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

const clients = new Map();

const demoPlayers = [
  ['p1','Joe Burrow','CIN','QB',1,'injured',8.6,'QB','m1'],
  ['p2','Cincinnati Backup QB','CIN','QB',1,'playing',3.4,'BENCH','m1'],
  ['p3','Patrick Mahomes','KC','QB',3,'upcoming',0,'BENCH','m1'],
  ['p4','Ja’Marr Chase','CIN','WR',1,'playing',14.2,'WR','m1'],
  ['p5','Tee Higgins','CIN','WR',1,'playing',9.4,'BENCH','m1'],
  ['p6','Chase Brown','CIN','RB',1,'playing',12.3,'RB','m1'],
  ['p7','Jordan Mason','MIN','RB',3,'upcoming',0,'BENCH','m1'],
  ['p8','George Kittle','SF','TE',2,'playing',7.2,'TE','m1'],
  ['p9','Lamar Jackson','BAL','QB',1,'playing',18.7,'QB','m2'],
  ['p10','Derrick Henry','BAL','RB',1,'playing',17.5,'RB','m2'],
  ['p11','Zay Flowers','BAL','WR',1,'playing',11.1,'WR','m2'],
  ['p12','Mark Andrews','BAL','TE',1,'playing',6.3,'TE','m2']
].map(([id,name,team,pos,kickoff,status,points,slot,owner]) => ({
  id,name,team,pos,kickoff,status,points,slot,owner
}));

function initialState() {
  return {
    version:1,
    league:'Fantasy Audible League',
    week:9,
    phase:2,
    managers:[],
    players:demoPlayers,
    injuries:[{
      id:'i1',
      player:'p1',
      active:true,
      description:'Demo injury'
    }],
    transactions:[],
    draft:{
      status:'waiting',
      rounds:DRAFT_ROUNDS,
      secondsPerPick:PICK_SECONDS,
      order:[],
      picks:[],
      deadline:null,
      remainingSeconds:null
    }
  };
}

function ensureDraft(state) {
  if (!state.draft) {
    state.draft = {
      status:'waiting',
      rounds:DRAFT_ROUNDS,
      secondsPerPick:PICK_SECONDS,
      order:[],
      picks:[],
      deadline:null,
      remainingSeconds:null
    };
  }
  return state.draft;
}

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS fantasy_audible_store (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      state JSONB NOT NULL,
      accounts JSONB NOT NULL
    )
  `);

  await pool.query(`
    INSERT INTO fantasy_audible_store
      (id,state,accounts)
    VALUES (1,$1,$2)
    ON CONFLICT (id) DO NOTHING
  `,[
    JSON.stringify(initialState()),
    JSON.stringify([])
  ]);

  await initializeESPN();
}

async function snapshot() {
  const result = await pool.query(`
    SELECT state,accounts
    FROM fantasy_audible_store
    WHERE id=1
  `);

  if (!result.rows.length) {
    throw new Error('Database not initialized');
  }

  return result.rows[0];
}

async function change(fn) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const result = await client.query(`
      SELECT state,accounts
      FROM fantasy_audible_store
      WHERE id=1
      FOR UPDATE
    `);

    const {state,accounts} = result.rows[0];

    const output = await fn(state,accounts);

    if (output && output.error) {
      await client.query('ROLLBACK');
      return output;
    }

    state.version = (state.version || 0) + 1;

    await client.query(`
      UPDATE fantasy_audible_store
      SET state=$1,accounts=$2
      WHERE id=1
    `,[
      JSON.stringify(state),
      JSON.stringify(accounts)
    ]);

    await client.query('COMMIT');

    pushState(state,accounts);

    return output;

  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {}

    throw error;

  } finally {
    client.release();
  }
}

function failure(status,error) {
  return {status,error};
}

function hashPassword(password,salt) {
  return crypto.scryptSync(password,salt,64).toString('hex');
}

function tokenHash(token) {
  return crypto.createHash('sha256')
    .update(token)
    .digest('hex');
}

function findUser(req,accounts) {
  const url = new URL(req.url,'http://localhost');

  const header = req.headers.authorization || '';

  const token = header.startsWith('Bearer ')
    ? header.slice(7)
    : url.searchParams.get('token') || '';

  if (!/^[a-f0-9]{64}$/.test(token)) return null;

  const hashed = tokenHash(token);

  return accounts.find(a =>
    Array.isArray(a.sessions) &&
    a.sessions.some(s =>
      s.hash === hashed &&
      s.expires > Date.now()
    )
  ) || null;
}

function safeState(state,accounts,user) {
  return {
    ...state,
    managers:state.managers.map(m=>({
      ...m,
      claimed:accounts.some(a=>a.manager===m.id)
    })),
    viewer:{
      manager:user.manager,
      commissioner:user.commissioner,
      name:user.name
    }
  };
}

function pushState(state,accounts) {
  for (const [res,id] of clients) {
    const account = accounts.find(a=>a.id===id);

    if (!account) {
      clients.delete(res);
      continue;
    }

    try {
      res.write(
        'data: ' +
        JSON.stringify(safeState(state,accounts,account)) +
        '\n\n'
      );
    } catch {
      clients.delete(res);
    }
  }
}

function send(res,status,data) {
  res.writeHead(status,{
    'Content-Type':'application/json',
    'Cache-Control':'no-store'
  });

  res.end(JSON.stringify(data));
}

function teamName(value) {
  if (typeof value !== 'string') return null;

  const name = value.trim().replace(/\s+/g,' ');

  if (
    name.length < 3 ||
    name.length > 40 ||
    /[<>\x00-\x1f]/.test(name)
  ) return null;

  return name;
}

function taken(state,name,except) {
  return state.managers.some(m =>
    m.id !== except &&
    m.team.toLowerCase() === name.toLowerCase()
  );
}

function availableSlot(state,accounts) {
  const existing = state.managers.find(m =>
    !accounts.some(a=>a.manager===m.id)
  );

  if (existing) return existing;

  if (state.managers.length >= MAX_TEAMS) return null;

  const used = new Set(state.managers.map(m=>m.id));

  let n=1;

  while (used.has('m'+n)) n++;

  const slot = {
    id:'m'+n,
    name:'Manager '+n,
    team:'Team '+n
  };

  state.managers.push(slot);

  return slot;
}

function audit(state,type,manager,details) {
  state.transactions.unshift({
    id:crypto.randomUUID(),
    at:new Date().toISOString(),
    type,
    manager,
    details
  });
}

function eligibility(state,starter,bench) {
  if (
    !starter ||
    !bench ||
    starter.owner !== bench.owner ||
    starter.slot === 'BENCH' ||
    bench.slot !== 'BENCH' ||
    starter.pos !== bench.pos
  ) return null;

  if (
    starter.team === bench.team &&
    bench.kickoff <= state.phase
  ) return 'handcuff';

  if (bench.kickoff > state.phase) return 'later';

  return null;
}

function bodyOf(req) {
  return new Promise((resolve,reject)=>{
    let raw='';
    let tooLarge=false;

    req.on('data',chunk=>{
      raw+=chunk;

      if (raw.length > 20000) {
        tooLarge=true;
        reject(new Error('Request too large'));
        req.destroy();
      }
    });

    req.on('end',()=>{
      if (tooLarge) return;

      try {
        resolve(JSON.parse(raw||'{}'));
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });

    req.on('error',reject);
  });
}

// -------------------------------
// ESPN PLAYER DATA
// -------------------------------

async function draftPool() {
  const result = await getESPNPlayers();

  if (!Array.isArray(result.players)) {
    throw new Error('ESPN player pool unavailable');
  }

  return result;
}

function rankedPlayers(players) {
  return [...players].sort((a,b)=>{
    const ra = a.rank ?? Infinity;
    const rb = b.rank ?? Infinity;

    if (ra !== rb) return ra-rb;

    const aa = a.averageDraftPosition ?? Infinity;
    const ab = b.averageDraftPosition ?? Infinity;

    if (aa !== ab) return aa-ab;

    return a.name.localeCompare(b.name);
  });
}

// -------------------------------
// SNAKE DRAFT ENGINE
// -------------------------------

function createDraftOrder(managerIds,rounds) {
  const order=[];

  for (let round=1;round<=rounds;round++) {
    const sequence = round%2===1
      ? [...managerIds]
      : [...managerIds].reverse();

    for (const manager of sequence) {
      order.push({
        round,
        manager
      });
    }
  }

  return order;
}

function currentPick(draft) {
  return draft.order[draft.picks.length] || null;
}

function draftResult(state) {
  const draft=ensureDraft(state);

  return {
    ...draft,
    currentPick:currentPick(draft),
    overallPick:draft.picks.length+1,
    totalPicks:draft.order.length
  };
}

function nextDeadline(draft) {
  draft.deadline =
    new Date(Date.now()+draft.secondsPerPick*1000)
      .toISOString();
}

function recordPick(state,player,automatic=false) {
  const draft=ensureDraft(state);
  const turn=currentPick(draft);

  if (!turn) {
    return failure(409,'Draft is complete');
  }

  if (draft.picks.some(p=>p.playerId===player.id)) {
    return failure(409,'Player already drafted');
  }

  const overall=draft.picks.length+1;

  const pick={
    overall,
    round:turn.round,
    manager:turn.manager,
    playerId:player.id,
    playerName:player.name,
    position:player.position,
    nflTeamId:player.nflTeamId,
    rank:player.rank,
    projectedPoints:player.projectedPoints,
    automatic,
    at:new Date().toISOString()
  };

  draft.picks.push(pick);

  // Newly drafted players are placed on the bench.
  // Starting-lineup management comes in the next update.
  state.players.push({
    id:'espn-'+player.id,
    espnId:player.id,
    name:player.name,
    team:String(player.nflTeamId ?? ''),
    pos:player.position,
    kickoff:99,
    status:'upcoming',
    points:0,
    slot:'BENCH',
    owner:turn.manager,
    projectedPoints:player.projectedPoints,
    rank:player.rank
  });

  audit(
    state,
    automatic?'AUTO_PICK':'DRAFT_PICK',
    turn.manager,
    player.name+' selected at pick '+overall
  );

  if (draft.picks.length>=draft.order.length) {
    draft.status='completed';
    draft.deadline=null;
    draft.remainingSeconds=null;

    audit(state,'DRAFT_COMPLETE',null,'Draft completed');
  } else {
    nextDeadline(draft);
  }

  return {ok:true,pick};
}

async function processExpiredPick() {
  const data=await snapshot();
  const draft=ensureDraft(data.state);

  if (
    draft.status!=='active' ||
    !draft.deadline ||
    Date.now()<new Date(draft.deadline).getTime()
  ) return;

  let poolData;

  try {
    poolData=await draftPool();
  } catch(error) {
    console.error('Auto-pick data unavailable:',error.message);

    // Stop the clock rather than make an unverified pick.
    await change(state=>{
      const d=ensureDraft(state);

      if (
        d.status==='active' &&
        d.deadline &&
        Date.now()>=new Date(d.deadline).getTime()
      ) {
        d.status='paused';
        d.remainingSeconds=d.secondsPerPick;
        d.deadline=null;
        audit(state,'DRAFT_PAUSED',null,
          'Draft paused because player data is unavailable');
      }

      return {ok:true};
    });

    return;
  }

  await change(state=>{
    const d=ensureDraft(state);

    if (
      d.status!=='active' ||
      !d.deadline ||
      Date.now()<new Date(d.deadline).getTime()
    ) return {ok:true};

    const selected=new Set(
      d.picks.map(p=>p.playerId)
    );

    const available=rankedPlayers(poolData.players)
      .filter(p=>!selected.has(p.id));

    if (!available.length) {
      d.status='paused';
      d.remainingSeconds=d.secondsPerPick;
      d.deadline=null;
      return {ok:true};
    }

    return recordPick(state,available[0],true);
  });
}

// -------------------------------
// API
// -------------------------------

async function api(req,res,route) {

  if (req.method==='GET' && route==='/api/teams') {
    const {state,accounts}=await snapshot();

    return send(res,200,state.managers.map(m=>({
      id:m.id,
      team:m.team,
      claimed:accounts.some(a=>a.manager===m.id)
    })));
  }

  if (req.method==='POST' && route==='/api/register') {
    const body=await bodyOf(req);

    const email=String(body.email||'')
      .trim().toLowerCase();

    const password=String(body.password||'');
    const name=teamName(body.teamName);

    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      password.length<10
    ) {
      return send(res,400,{
        error:'Valid email and 10-character password required'
      });
    }

    if (!name) {
      return send(res,400,{
        error:'Team name must be 3–40 valid characters'
      });
    }

    const result=await change((state,accounts)=>{
      const draft=ensureDraft(state);

      if (draft.status!=='waiting') {
        return failure(409,'Registration is closed after the draft starts');
      }

      if (accounts.some(a=>a.email===email)) {
        return failure(409,'Email already registered');
      }

      if (taken(state,name)) {
        return failure(409,'Team name already taken');
      }

      const slot=availableSlot(state,accounts);

      if (!slot) {
        return failure(409,'League is full (12 teams)');
      }

      const salt=crypto.randomBytes(16).toString('hex');
      const token=crypto.randomBytes(32).toString('hex');

      const account={
        id:crypto.randomUUID(),
        email,
        name:email.split('@')[0],
        manager:slot.id,
        commissioner:accounts.length===0,
        salt,
        passwordHash:hashPassword(password,salt),
        sessions:[{
          hash:tokenHash(token),
          expires:Date.now()+30*86400000
        }]
      };

      slot.team=name;
      accounts.push(account);

      audit(
        state,
        'REGISTRATION',
        slot.id,
        name+' joined the league'
      );

      return {token};
    });

    return send(res,result.status||200,result);
  }

  if (req.method==='POST' && route==='/api/login') {
    const body=await bodyOf(req);

    const email=String(body.email||'')
      .trim().toLowerCase();

    const password=String(body.password||'');

    const result=await change((state,accounts)=>{
      const account=accounts.find(a=>a.email===email);

      if (
        !account ||
        !/^[a-f0-9]{128}$/.test(account.passwordHash)
      ) return failure(401,'Incorrect credentials');

      const candidate=hashPassword(password,account.salt);

      if (!crypto.timingSafeEqual(
        Buffer.from(candidate,'hex'),
        Buffer.from(account.passwordHash,'hex')
      )) return failure(401,'Incorrect credentials');

      const token=crypto.randomBytes(32).toString('hex');

      account.sessions=(account.sessions||[])
        .filter(s=>s.expires>Date.now());

      account.sessions.push({
        hash:tokenHash(token),
        expires:Date.now()+30*86400000
      });

      return {token};
    });

    return send(res,result.status||200,result);
  }

  const current=await snapshot();
  const user=findUser(req,current.accounts);

  if (!user) {
    return send(res,401,{error:'Please sign in'});
  }

  if (req.method==='GET' && route==='/api/state') {
    return send(
      res,200,
      safeState(current.state,current.accounts,user)
    );
  }

  if (req.method==='GET' && route==='/api/events') {
    res.writeHead(200,{
      'Content-Type':'text/event-stream',
      'Cache-Control':'no-cache, no-transform',
      Connection:'keep-alive'
    });

    res.write(
      'data: '+
      JSON.stringify(
        safeState(current.state,current.accounts,user)
      )+'\n\n'
    );

    clients.set(res,user.id);

    req.on('close',()=>clients.delete(res));
    return;
  }

  // ESPN rankings and projections.
  if (req.method==='GET' && route==='/api/espn/players') {
    try {
      const data=await draftPool();

      return send(res,200,{
        ...data,
        count:data.players.length
      });

    } catch(error) {
      return send(res,503,{
        error:'ESPN player data is not available yet',
        details:error.message
      });
    }
  }

  if (req.method==='GET' && route==='/api/draft') {
    return send(res,200,draftResult(current.state));
  }

  if (req.method!=='POST') {
    return send(res,405,{error:'Method not allowed'});
  }

  const body=await bodyOf(req);

  // Fetch ESPN outside the database transaction.
  let espnData=null;

  if (
    route==='/api/draft/start' ||
    route==='/api/draft/pick'
  ) {
    try {
      espnData=await draftPool();
    } catch(error) {
      return send(res,503,{
        error:'ESPN player data unavailable',
        details:error.message
      });
    }
  }

  const result=await change((state,accounts)=>{
    const actor=findUser(req,accounts);

    if (!actor) {
      return failure(401,'Session expired');
    }

    const draft=ensureDraft(state);

    // ---------------------------
    // DRAFT START
    // ---------------------------

    if (route==='/api/draft/start') {
      if (!actor.commissioner) {
        return failure(403,'Commissioner only');
      }

      if (draft.status!=='waiting') {
        return failure(409,'Draft already started');
      }

      const registered=state.managers.filter(m=>
        accounts.some(a=>a.manager===m.id)
      );

      if (registered.length<2) {
        return failure(409,'At least two managers required');
      }

      if (!espnData.players.length) {
        return failure(503,'No ESPN players available');
      }

      if (
        espnData.players.length <
        registered.length*DRAFT_ROUNDS
      ) {
        return failure(503,'Not enough ESPN players for draft');
      }

      const ids=registered.map(m=>m.id);

      draft.order=createDraftOrder(ids,DRAFT_ROUNDS);
      draft.picks=[];
      draft.status='active';
      draft.rounds=DRAFT_ROUNDS;
      draft.secondsPerPick=PICK_SECONDS;
      draft.remainingSeconds=null;

      nextDeadline(draft);

      // Remove beta demo rosters when the real draft starts.
      state.players=[];
      state.injuries=[];

      audit(state,'DRAFT_STARTED',actor.manager,
        registered.length+'-team snake draft started');

      return {ok:true,draft:draftResult(state)};
    }

    // ---------------------------
    // DRAFT PAUSE
    // ---------------------------

    if (route==='/api/draft/pause') {
      if (!actor.commissioner) {
        return failure(403,'Commissioner only');
      }

      if (draft.status!=='active') {
        return failure(409,'Draft is not active');
      }

      draft.remainingSeconds=Math.max(
        1,
        Math.ceil(
          (new Date(draft.deadline).getTime()-Date.now())/1000
        )
      );

      draft.status='paused';
      draft.deadline=null;

      audit(state,'DRAFT_PAUSED',actor.manager,
        'Commissioner paused draft');

      return {ok:true};
    }

    // ---------------------------
    // DRAFT RESUME
    // ---------------------------

    if (route==='/api/draft/resume') {
      if (!actor.commissioner) {
        return failure(403,'Commissioner only');
      }

      if (draft.status!=='paused') {
        return failure(409,'Draft is not paused');
      }

      const seconds=draft.remainingSeconds ||
        draft.secondsPerPick;

      draft.status='active';
      draft.deadline=new Date(
        Date.now()+seconds*1000
      ).toISOString();

      draft.remainingSeconds=null;

      audit(state,'DRAFT_RESUMED',actor.manager,
        'Commissioner resumed draft');

      return {ok:true};
    }

    // ---------------------------
    // DRAFT PICK
    // ---------------------------

    if (route==='/api/draft/pick') {
      if (draft.status!=='active') {
        return failure(409,'Draft is not active');
      }

      const turn=currentPick(draft);

      if (!turn) {
        return failure(409,'Draft complete');
      }

      if (turn.manager!==actor.manager) {
        return failure(403,'Not your turn');
      }

      if (
        draft.deadline &&
        Date.now()>new Date(draft.deadline).getTime()
      ) {
        return failure(409,'Pick timer expired');
      }

      const player=espnData.players.find(p=>
        p.id===String(body.playerId)
      );

      if (!player) {
        return failure(404,'Player not found');
      }

      return recordPick(state,player,false);
    }

    // ---------------------------
    // TEAM NAME
    // ---------------------------

    if (route==='/api/team-name') {
      const name=teamName(body.name);
      const team=state.managers.find(m=>m.id===actor.manager);

      if (!team) return failure(403,'Team not found');
      if (!name) return failure(400,'Invalid team name');

      if (taken(state,name,team.id)) {
        return failure(409,'Team name already taken');
      }

      const old=team.team;
      team.team=name;

      audit(state,'RENAME',team.id,
        old+' renamed to '+name);

      return {ok:true,team:name};
    }

    // ---------------------------
    // INJURY SUBSTITUTION
    // ---------------------------

    if (route==='/api/substitute') {
      const injury=state.injuries.find(i=>
        i.id===body.injury && i.active
      );

      const starter=state.players.find(p=>
        p.id===injury?.player
      );

      const bench=state.players.find(p=>
        p.id===body.bench
      );

      if (!starter || starter.owner!==actor.manager) {
        return failure(403,'Not your team or injury unavailable');
      }

      const mode=eligibility(state,starter,bench);

      if (!mode) {
        return failure(409,'Replacement not eligible');
      }

      const slot=starter.slot;
      const previous=starter.points;

      starter.slot='BENCH';
      bench.slot=slot;
      bench.scoringMode=mode;
      bench.scoreAtSwap=mode==='handcuff'?bench.points:0;
      bench.credited=mode==='handcuff'?0:bench.points;

      injury.active=false;

      audit(state,'SUBSTITUTION',actor.manager,
        starter.name+' ('+previous.toFixed(1)+
        ' pts) replaced by '+bench.name+' ('+mode+')');

      return {ok:true,mode};
    }

    if (route==='/api/keep') {
      const injury=state.injuries.find(i=>
        i.id===body.injury && i.active
      );

      if (!injury) {
        return failure(409,'Injury already resolved');
      }

      const starter=state.players.find(p=>
        p.id===injury.player
      );

      if (starter?.owner!==actor.manager) {
        return failure(403,'Not your team');
      }

      injury.active=false;

      audit(state,'KEEP',actor.manager,
        'Manager retained injured starter');

      return {ok:true};
    }

    // ---------------------------
    // COMMISSIONER DEMO
    // ---------------------------

    if (route==='/api/demo') {
      if (!actor.commissioner) {
        return failure(403,'Commissioner only');
      }

      if (body.action==='advance') {
        state.phase=Math.min(4,state.phase+1);

        state.players.forEach(p=>{
          if (
            p.kickoff<=state.phase &&
            p.status==='upcoming'
          ) p.status='playing';
        });

      } else if (body.action==='injure') {
        const player=state.players.find(p=>
          p.id===body.player &&
          p.slot!=='BENCH'
        );

        if (!player) {
          return failure(400,'Choose a starter');
        }

        if (state.injuries.some(i=>
          i.player===player.id && i.active
        )) {
          return failure(409,'Injury already pending');
        }

        player.status='injured';

        state.injuries.push({
          id:crypto.randomUUID(),
          player:player.id,
          active:true,
          description:'Demo injury event'
        });

      } else if (body.action==='points') {
        const player=state.players.find(p=>
          p.id===body.player
        );

        const amount=Number(body.amount);

        if (
          !player ||
          !Number.isFinite(amount) ||
          Math.abs(amount)>100
        ) {
          return failure(400,'Invalid player or points');
        }

        player.points+=amount;

        if (player.scoringMode==='handcuff') {
          player.credited=
            player.points-player.scoreAtSwap;
        }

      } else {
        return failure(400,'Unknown action');
      }

      return {ok:true};
    }

    return failure(404,'Not found');
  });

  return send(res,result.status||200,result);
}

// -------------------------------
// STATIC FILES
// -------------------------------

function staticFile(req,res,route) {
  if (req.method!=='GET' && req.method!=='HEAD') {
    res.writeHead(405);
    return res.end();
  }

  const root=path.resolve(__dirname,'public');

  let decoded;

  try {
    decoded=decodeURIComponent(route);
  } catch {
    res.writeHead(400);
    return res.end();
  }

  const file=path.resolve(
    root,
    '.'+(decoded==='/'?'/index.html':decoded)
  );

  if (
    file!==root &&
    !file.startsWith(root+path.sep)
  ) {
    res.writeHead(403);
    return res.end();
  }

  fs.readFile(file,(err,data)=>{
    if (err) {
      res.writeHead(404);
      return res.end();
    }

    const type=file.endsWith('.html')
      ? 'text/html; charset=utf-8'
      :file.endsWith('.js')
      ? 'application/javascript; charset=utf-8'
      :file.endsWith('.css')
      ? 'text/css; charset=utf-8'
      :'application/octet-stream';

    res.writeHead(200,{
      'Content-Type':type,
      'X-Content-Type-Options':'nosniff',
      'Cache-Control':'no-cache'
    });

    res.end(req.method==='HEAD'?undefined:data);
  });
}

// -------------------------------
// SERVER
// -------------------------------

const server=http.createServer((req,res)=>{
  const route=new URL(
    req.url,'http://localhost'
  ).pathname;

  if (route.startsWith('/api/')) {
    api(req,res,route).catch(error=>{
      console.error('API error:',error);

      if (!res.headersSent) {
        send(res,500,{error:'Server error'});
      } else {
        res.end();
      }
    });
  } else {
    staticFile(req,res,route);
  }
});

// Check expired draft timers every second.
// PostgreSQL transactions prevent duplicate picks.
let checkingTimer=false;

setInterval(async()=>{
  if (checkingTimer) return;

  checkingTimer=true;

  try {
    await processExpiredPick();
  } catch(error) {
    console.error('Draft timer error:',error);
  } finally {
    checkingTimer=false;
  }
},1000);

init()
  .then(()=>server.listen(PORT,()=>{
    console.log(
      'Fantasy Audible running with PostgreSQL and ESPN draft support on '+PORT
    );
  }))
  .catch(error=>{
    console.error('Database startup failed:',error);
    process.exit(1);
  });
