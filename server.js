
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

const PORT = process.env.PORT || 3000;
const MAX_TEAMS = 12;
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
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
].map(([id,name,team,pos,kickoff,status,points,slot,owner]) =>
  ({id,name,team,pos,kickoff,status,points,slot,owner}));

function initialState() {
  return {
    version:1, league:'Fantasy Audible League', week:9, phase:2,
    managers:[], players:demoPlayers,
    injuries:[{id:'i1',player:'p1',active:true,description:'Demo injury'}],
    transactions:[]
  };
}

async function init() {
  await pool.query(`CREATE TABLE IF NOT EXISTS fantasy_audible_store (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    state JSONB NOT NULL,
    accounts JSONB NOT NULL
  )`);
  await pool.query(
    'INSERT INTO fantasy_audible_store (id,state,accounts) VALUES (1,$1,$2) ON CONFLICT (id) DO NOTHING',
    [JSON.stringify(initialState()), JSON.stringify([])]
  );
}

async function snapshot() {
  const result = await pool.query('SELECT state,accounts FROM fantasy_audible_store WHERE id=1');
  if (!result.rows.length) throw new Error('Database not initialized');
  return result.rows[0];
}

// All changes to accounts and league state happen in one locked transaction.
async function change(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query('SELECT state,accounts FROM fantasy_audible_store WHERE id=1 FOR UPDATE');
    const {state,accounts} = result.rows[0];
    const output = await fn(state,accounts);
    if (output && output.error) {
      await client.query('ROLLBACK');
      return output;
    }
    state.version = (state.version || 0) + 1;
    await client.query('UPDATE fantasy_audible_store SET state=$1, accounts=$2 WHERE id=1',
      [JSON.stringify(state),JSON.stringify(accounts)]);
    await client.query('COMMIT');
    pushState(state,accounts);
    return output;
  } catch(e) {
    try { await client.query('ROLLBACK'); } catch {}
    throw e;
  } finally {
    client.release();
  }
}

function failure(status,error) { return {error,status}; }
function hashPassword(password,salt) {
  return crypto.scryptSync(password,salt,64).toString('hex');
}
function tokenHash(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}
function findUser(req,accounts) {
  const url = new URL(req.url,'http://localhost');
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : url.searchParams.get('token') || '';
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  const hashed = tokenHash(token);
  return accounts.find(a => Array.isArray(a.sessions) &&
    a.sessions.some(s => s.hash === hashed && s.expires > Date.now())) || null;
}
function safeState(state,accounts,user) {
  return {...state,
    managers:state.managers.map(m=>({...m,claimed:accounts.some(a=>a.manager===m.id)})),
    viewer:{manager:user.manager,commissioner:user.commissioner,name:user.name}
  };
}
function pushState(state,accounts) {
  for (const [res,id] of clients) {
    const account=accounts.find(a=>a.id===id);
    if (!account) { clients.delete(res); continue; }
    try { res.write('data: '+JSON.stringify(safeState(state,accounts,account))+'\n\n'); }
    catch { clients.delete(res); }
  }
}
function send(res,status,data) {
  res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});
  res.end(JSON.stringify(data));
}
function teamName(value) {
  if (typeof value !== 'string') return null;
  const name=value.trim().replace(/\s+/g,' ');
  if (name.length<3 || name.length>40 || /[<>\x00-\x1f]/.test(name)) return null;
  return name;
}
function taken(state,name,except) {
  return state.managers.some(m=>m.id!==except && m.team.toLowerCase()===name.toLowerCase());
}
function availableSlot(state,accounts) {
  const existing=state.managers.find(m=>!accounts.some(a=>a.manager===m.id));
  if (existing) return existing;
  if (state.managers.length>=MAX_TEAMS) return null;
  const used=new Set(state.managers.map(m=>m.id));
  let n=1; while (used.has('m'+n)) n++;
  const slot={id:'m'+n,name:'Manager '+n,team:'Team '+n};
  state.managers.push(slot);
  return slot;
}
function eligibility(state,starter,bench) {
  if (!starter || !bench || starter.owner!==bench.owner ||
      starter.slot==='BENCH' || bench.slot!=='BENCH' || starter.pos!==bench.pos) return null;
  if (starter.team===bench.team && bench.kickoff<=state.phase) return 'handcuff';
  if (bench.kickoff>state.phase) return 'later';
  return null;
}
function bodyOf(req) {
  return new Promise((resolve,reject)=>{
    let raw='';
    req.on('data',chunk=>{
      raw+=chunk;
      if (raw.length>20000) reject(new Error('Request too large'));
    });
    req.on('end',()=>{
      try { resolve(JSON.parse(raw||'{}')); }
      catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error',reject);
  });
}
function audit(state,type,manager,details) {
  state.transactions.unshift({id:crypto.randomUUID(),at:new Date().toISOString(),type,manager,details});
}

async function api(req,res,route) {
  if (req.method==='GET' && route==='/api/teams') {
    const {state,accounts}=await snapshot();
    return send(res,200,state.managers.map(m=>({id:m.id,team:m.team,claimed:accounts.some(a=>a.manager===m.id)})));
  }

  if (req.method==='POST' && route==='/api/register') {
    const body=await bodyOf(req);
    const email=String(body.email||'').trim().toLowerCase();
    const password=String(body.password||'');
    const name=teamName(body.teamName);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length<10)
      return send(res,400,{error:'Valid email and 10-character password required'});
    if (!name) return send(res,400,{error:'Team name must be 3–40 valid characters'});
    const result=await change((state,accounts)=>{
      if (accounts.some(a=>a.email===email)) return failure(409,'Email already registered');
      if (taken(state,name)) return failure(409,'Team name already taken');
      const slot=availableSlot(state,accounts);
      if (!slot) return failure(409,'League is full (12 teams)');
      const salt=crypto.randomBytes(16).toString('hex');
      const token=crypto.randomBytes(32).toString('hex');
      const account={id:crypto.randomUUID(),email,name:email.split('@')[0],
        manager:slot.id,commissioner:accounts.length===0,salt,
        passwordHash:hashPassword(password,salt),
        sessions:[{hash:tokenHash(token),expires:Date.now()+30*86400000}]};
      slot.team=name;
      accounts.push(account);
      audit(state,'REGISTRATION',slot.id,name+' joined the league');
      return {token};
    });
    return send(res,result.status||200,result);
  }

  if (req.method==='POST' && route==='/api/login') {
    const body=await bodyOf(req);
    const email=String(body.email||'').trim().toLowerCase();
    const password=String(body.password||'');
    const result=await change((state,accounts)=>{
      const account=accounts.find(a=>a.email===email);
      if (!account || !/^[a-f0-9]{128}$/.test(account.passwordHash))
        return failure(401,'Incorrect credentials');
      const candidate=hashPassword(password,account.salt);
      if (!crypto.timingSafeEqual(Buffer.from(candidate,'hex'),Buffer.from(account.passwordHash,'hex')))
        return failure(401,'Incorrect credentials');
      const token=crypto.randomBytes(32).toString('hex');
      account.sessions=(account.sessions||[]).filter(s=>s.expires>Date.now());
      account.sessions.push({hash:tokenHash(token),expires:Date.now()+30*86400000});
      return {token};
    });
    return send(res,result.status||200,result);
  }

  const current=await snapshot();
  const user=findUser(req,current.accounts);
  if (!user) return send(res,401,{error:'Please sign in'});

  if (req.method==='GET' && route==='/api/state')
    return send(res,200,safeState(current.state,current.accounts,user));

  if (req.method==='GET' && route==='/api/events') {
    res.writeHead(200,{'Content-Type':'text/event-stream',
      'Cache-Control':'no-cache, no-transform',Connection:'keep-alive'});
    res.write('data: '+JSON.stringify(safeState(current.state,current.accounts,user))+'\n\n');
    clients.set(res,user.id);
    req.on('close',()=>clients.delete(res));
    return;
  }

  if (req.method!=='POST') return send(res,405,{error:'Method not allowed'});
  const body=await bodyOf(req);
  const result=await change((state,accounts)=>{
    // Check authorization again while the transaction is locked.
    const actor=findUser(req,accounts);
    if (!actor) return failure(401,'Session expired');

    if (route==='/api/team-name') {
      const name=teamName(body.name);
      const team=state.managers.find(m=>m.id===actor.manager);
      if (!team) return failure(403,'Team not found');
      if (!name) return failure(400,'Invalid team name');
      if (taken(state,name,team.id)) return failure(409,'Team name already taken');
      const old=team.team;
      team.team=name;
      audit(state,'RENAME',team.id,old+' renamed to '+name);
      return {ok:true,team:name};
    }

    if (route==='/api/substitute') {
      const injury=state.injuries.find(i=>i.id===body.injury && i.active);
      const starter=state.players.find(p=>p.id===injury?.player);
      const bench=state.players.find(p=>p.id===body.bench);
      if (!starter || starter.owner!==actor.manager) return failure(403,'Not your team or injury unavailable');
      const mode=eligibility(state,starter,bench);
      if (!mode) return failure(409,'Replacement not eligible');
      const slot=starter.slot;
      const previous=starter.points;
      starter.slot='BENCH';
      bench.slot=slot;
      bench.scoringMode=mode;
      bench.scoreAtSwap=mode==='handcuff'?bench.points:0;
      bench.credited=mode==='handcuff'?0:bench.points;
      injury.active=false;
      audit(state,'SUBSTITUTION',actor.manager,
        starter.name+' ('+previous.toFixed(1)+' pts) replaced by '+bench.name+' ('+mode+')');
      return {ok:true,mode};
    }

    if (route==='/api/keep') {
      const injury=state.injuries.find(i=>i.id===body.injury && i.active);
      if (!injury) return failure(409,'Injury already resolved');
      const starter=state.players.find(p=>p.id===injury.player);
      if (starter?.owner!==actor.manager) return failure(403,'Not your team');
      injury.active=false;
      audit(state,'KEEP',actor.manager,'Manager retained injured starter');
      return {ok:true};
    }

    if (route==='/api/demo') {
      if (!actor.commissioner) return failure(403,'Commissioner only');
      if (body.action==='advance') {
        state.phase=Math.min(4,state.phase+1);
        state.players.forEach(p=>{
          if (p.kickoff<=state.phase && p.status==='upcoming') p.status='playing';
        });
      } else if (body.action==='injure') {
        const player=state.players.find(p=>p.id===body.player && p.slot!=='BENCH');
        if (!player) return failure(400,'Choose a starter');
        if (state.injuries.some(i=>i.player===player.id && i.active))
          return failure(409,'Injury already pending');
        player.status='injured';
        state.injuries.push({id:crypto.randomUUID(),player:player.id,active:true,description:'Demo injury event'});
      } else if (body.action==='points') {
        const player=state.players.find(p=>p.id===body.player);
        const amount=Number(body.amount);
        if (!player || !Number.isFinite(amount) || Math.abs(amount)>100)
          return failure(400,'Invalid player or points');
        player.points+=amount;
        if (player.scoringMode==='handcuff')
          player.credited=player.points-player.scoreAtSwap;
      } else return failure(400,'Unknown action');
      return {ok:true};
    }
    return failure(404,'Not found');
  });
  return send(res,result.status||200,result);
}

function staticFile(req,res,route) {
  if (req.method!=='GET' && req.method!=='HEAD') {
    res.writeHead(405); return res.end();
  }
  const root=path.resolve(__dirname,'public');
  let decoded;
  try { decoded=decodeURIComponent(route); }
  catch { res.writeHead(400); return res.end(); }
  const file=path.resolve(root,'.'+(decoded==='/'?'/index.html':decoded));
  if (file!==root && !file.startsWith(root+path.sep)) {
    res.writeHead(403); return res.end();
  }
  fs.readFile(file,(err,data)=>{
    if (err) { res.writeHead(404); return res.end(); }
    const type=file.endsWith('.html')?'text/html; charset=utf-8':
      file.endsWith('.js')?'application/javascript; charset=utf-8':
      file.endsWith('.css')?'text/css; charset=utf-8':'application/octet-stream';
    res.writeHead(200,{'Content-Type':type,'X-Content-Type-Options':'nosniff',
      'Cache-Control':'no-cache'});
    res.end(req.method==='HEAD'?undefined:data);
  });
}

const server=http.createServer((req,res)=>{
  const route=new URL(req.url,'http://localhost').pathname;
  if (route.startsWith('/api/')) {
    api(req,res,route).catch(e=>{
      console.error('API error:',e);
      if (!res.headersSent) send(res,500,{error:'Server error'});
      else res.end();
    });
  } else staticFile(req,res,route);
});

init().then(()=>server.listen(PORT,()=>
  console.log('Fantasy Audible PostgreSQL server running on '+PORT)
)).catch(e=>{console.error('Database startup failed:',e);process.exit(1)});
