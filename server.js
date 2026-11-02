
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DB = path.join(__dirname, 'league.json');
const AUTH = path.join(__dirname, 'accounts.json');
const MAX_TEAMS = 12;

function load(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    return fallback;
  }
}

function save(file, value) {
  const temp = file + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), {mode:0o600});
  fs.renameSync(temp, file);
}

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
].map(x => {
  const [id,name,team,pos,kickoff,status,points,slot,owner] = x;
  return {id,name,team,pos,kickoff,status,points,slot,owner};
});

const initial = {
  version:1,
  league:'Fantasy Audible League',
  week:9,
  phase:2,
  managers:[
    {id:'m1',name:'Manager 1',team:'Fourth Down Rebels'},
    {id:'m2',name:'Manager 2',team:'Red Zone Raiders'},
    {id:'m3',name:'Manager 3',team:'Sunday Legends'},
    {id:'m4',name:'Manager 4',team:'Gridiron Kings'}
  ],
  players:demoPlayers,
  injuries:[{id:'i1',player:'p1',active:true,description:'Demo injury'}],
  transactions:[]
};

let state = load(DB, initial);
let accounts = load(AUTH, []);

if (!Array.isArray(accounts)) throw Error('Invalid accounts file');

state.managers ||= [];
state.players ||= [];
state.injuries ||= [];
state.transactions ||= [];

const clients = new Map();

function hashPassword(password,salt) {
  return crypto.scryptSync(password,salt,64).toString('hex');
}

function tokenHash(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function issueToken(account) {
  const token = crypto.randomBytes(32).toString('hex');
  account.sessions ||= [];
  account.sessions = account.sessions.filter(s=>s.expires>Date.now());
  account.sessions.push({
    hash:tokenHash(token),
    expires:Date.now()+30*86400000
  });
  save(AUTH,accounts);
  return token;
}

function getUser(req) {
  const url = new URL(req.url,'http://localhost');
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ')
    ? auth.slice(7)
    : url.searchParams.get('token') || '';

  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  const hashed = tokenHash(token);

  return accounts.find(a =>
    Array.isArray(a.sessions) &&
    a.sessions.some(s=>s.hash===hashed&&s.expires>Date.now())
  ) || null;
}

function send(res,status,data) {
  res.writeHead(status,{
    'Content-Type':'application/json',
    'Cache-Control':'no-store'
  });
  res.end(JSON.stringify(data));
}

function safeState(user) {
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

function pushState() {
  for (const [res,id] of clients) {
    const account = accounts.find(a=>a.id===id);
    if (!account) {
      clients.delete(res);
      continue;
    }
    try {
      res.write('data: '+JSON.stringify(safeState(account))+'\n\n');
    } catch {
      clients.delete(res);
    }
  }
}

function broadcast() {
  state.version=(state.version||0)+1;
  save(DB,state);
  pushState();
}

function teamName(value) {
  if (typeof value!=='string') return null;
  const name=value.trim().replace(/\s+/g,' ');
  if (name.length<3||name.length>40||/[<>\x00-\x1f]/.test(name))
    return null;
  return name;
}

function taken(name,except) {
  return state.managers.some(m=>
    m.id!==except && m.team.toLowerCase()===name.toLowerCase()
  );
}

function availableSlot() {
  for (const team of state.managers) {
    if (!accounts.some(a=>a.manager===team.id)) return team;
  }
  if (state.managers.length>=MAX_TEAMS) return null;
  const used=new Set(state.managers.map(m=>m.id));
  let number=1;
  while(used.has('m'+number)) number++;
  const team={
    id:'m'+number,
    name:'Manager '+number,
    team:'Team '+number
  };
  state.managers.push(team);
  return team;
}

function eligibility(starter,bench) {
  if (!starter||!bench) return null;
  if (starter.owner!==bench.owner) return null;
  if (starter.slot==='BENCH'||bench.slot!=='BENCH') return null;
  if (starter.pos!==bench.pos) return null;

  if (starter.team===bench.team&&bench.kickoff<=state.phase)
    return 'handcuff';

  if (bench.kickoff>state.phase) return 'later';
  return null;
}

function readBody(req,res,callback) {
  let raw='';
  req.on('data',chunk=>{
    raw+=chunk;
    if(raw.length>20000) req.destroy();
  });
  req.on('end',()=>{
    try {
      callback(JSON.parse(raw||'{}'));
    } catch {
      if (!res.headersSent) send(res,400,{error:'Invalid request'});
    }
  });
}

const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');
  const route=url.pathname;

  if(req.method==='GET'&&route==='/api/teams') {
    return send(res,200,state.managers.map(m=>({
      id:m.id,team:m.team,
      claimed:accounts.some(a=>a.manager===m.id)
    })));
  }

  if(req.method==='POST'&&
    (route==='/api/register'||route==='/api/login')) {
    return readBody(req,res,body=>{
      const email=String(body.email||'').trim().toLowerCase();
      const password=String(body.password||'');

      if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||password.length<10)
        return send(res,400,{error:'Valid email and 10-character password required'});

      let account;

      if(route==='/api/register') {
        const name=teamName(body.teamName);
        if(!name)
          return send(res,400,{error:'Team name must be 3–40 valid characters'});

        if(accounts.some(a=>a.email===email))
          return send(res,409,{error:'Email already registered'});

        if(taken(name))
          return send(res,409,{error:'Team name already taken'});

        const slot=availableSlot();
        if(!slot)
          return send(res,409,{error:'League is full (12 teams)'});

        const salt=crypto.randomBytes(16).toString('hex');

        account={
          id:crypto.randomUUID(),
          email,
          name:email.split('@')[0],
          manager:slot.id,
          commissioner:accounts.length===0,
          salt,
          passwordHash:hashPassword(password,salt),
          sessions:[]
        };

        slot.team=name;
        accounts.push(account);
        save(AUTH,accounts);

        state.transactions.unshift({
          id:crypto.randomUUID(),
          at:new Date().toISOString(),
          type:'REGISTRATION',
          manager:slot.id,
          details:name+' joined the league'
        });
        broadcast();
      } else {
        account=accounts.find(a=>a.email===email);
        if(!account)
          return send(res,401,{error:'Incorrect credentials'});

        const candidate=hashPassword(password,account.salt);
        if(
          !/^[a-f0-9]{128}$/.test(account.passwordHash)||
          !crypto.timingSafeEqual(
            Buffer.from(candidate,'hex'),
            Buffer.from(account.passwordHash,'hex')
          )
        ) return send(res,401,{error:'Incorrect credentials'});
      }

      return send(res,200,{token:issueToken(account)});
    });
  }

  const user=route.startsWith('/api/')?getUser(req):null;
  if(route.startsWith('/api/')&&!user)
    return send(res,401,{error:'Please sign in'});

  if(req.method==='GET'&&route==='/api/state')
    return send(res,200,safeState(user));

  if(req.method==='GET'&&route==='/api/events') {
    res.writeHead(200,{
      'Content-Type':'text/event-stream',
      'Cache-Control':'no-cache, no-transform',
      Connection:'keep-alive'
    });
    res.write('data: '+JSON.stringify(safeState(user))+'\n\n');
    clients.set(res,user.id);
    req.on('close',()=>clients.delete(res));
    return;
  }

  if(req.method==='POST'&&route.startsWith('/api/')) {
    return readBody(req,res,body=>{
      if(route==='/api/team-name') {
        const name=teamName(body.name);
        const team=state.managers.find(m=>m.id===user.manager);
        if(!team) return send(res,403,{error:'Team not found'});
        if(!name) return send(res,400,{error:'Invalid team name'});
        if(taken(name,team.id))
          return send(res,409,{error:'Team name already taken'});

        const old=team.team;
        team.team=name;
        state.transactions.unshift({
          id:crypto.randomUUID(),
          at:new Date().toISOString(),
          type:'RENAME',
          manager:team.id,
          details:old+' renamed to '+name
        });
        broadcast();
        return send(res,200,{ok:true,team:name});
      }

      if(route==='/api/substitute') {
        const injury=state.injuries.find(i=>i.id===body.injury&&i.active);
        const starter=state.players.find(p=>p.id===injury?.player);
        const bench=state.players.find(p=>p.id===body.bench);

        if(!starter||starter.owner!==user.manager)
          return send(res,403,{error:'Not your team'});

        const mode=eligibility(starter,bench);
        if(!mode)
          return send(res,409,{error:'Replacement not eligible'});

        const slot=starter.slot;
        const previous=starter.points;
        starter.slot='BENCH';
        bench.slot=slot;
        bench.scoringMode=mode;
        bench.scoreAtSwap=mode==='handcuff'?bench.points:0;
        bench.credited=mode==='handcuff'?0:bench.points;
        injury.active=false;

        state.transactions.unshift({
          id:crypto.randomUUID(),
          at:new Date().toISOString(),
          type:'SUBSTITUTION',
          manager:user.manager,
          details:starter.name+' ('+previous.toFixed(1)+
            ' pts) replaced by '+bench.name+' ('+mode+')'
        });
        broadcast();
        return send(res,200,{ok:true,mode});
      }

      if(route==='/api/keep') {
        const injury=state.injuries.find(i=>i.id===body.injury&&i.active);
        if(!injury)
          return send(res,409,{error:'Injury already resolved'});
        const starter=state.players.find(p=>p.id===injury.player);
        if(starter?.owner!==user.manager)
          return send(res,403,{error:'Not your team'});
        injury.active=false;
        state.transactions.unshift({
          id:crypto.randomUUID(),
          at:new Date().toISOString(),
          type:'KEEP',
          manager:user.manager,
          details:'Manager retained injured starter'
        });
        broadcast();
        return send(res,200,{ok:true});
      }

      if(route==='/api/demo') {
        if(!user.commissioner)
          return send(res,403,{error:'Commissioner only'});

        if(body.action==='advance') {
          state.phase=Math.min(4,state.phase+1);
          state.players.forEach(p=>{
            if(p.kickoff<=state.phase&&p.status==='upcoming')
              p.status='playing';
          });
        } else if(body.action==='injure') {
          const player=state.players.find(p=>
            p.id===body.player&&p.slot!=='BENCH'
          );
          if(!player)
            return send(res,400,{error:'Choose a starter'});
          if(state.injuries.some(i=>i.player===player.id&&i.active))
            return send(res,409,{error:'Injury already pending'});
          player.status='injured';
          state.injuries.push({
            id:crypto.randomUUID(),
            player:player.id,
            active:true,
            description:'Demo injury event'
          });
        } else if(body.action==='points') {
          const player=state.players.find(p=>p.id===body.player);
          const amount=Number(body.amount);
          if(!player||!Number.isFinite(amount)||Math.abs(amount)>100)
            return send(res,400,{error:'Invalid player or points'});
          player.points+=amount;
          if(player.scoringMode==='handcuff')
            player.credited=Math.max(0,player.points-player.scoreAtSwap);
        } else {
          return send(res,400,{error:'Unknown action'});
        }

        broadcast();
        return send(res,200,{ok:true});
      }

      return send(res,404,{error:'Not found'});
    });
  }

  if(req.method!=='GET'&&req.method!=='HEAD') {
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

  const file=path.resolve(root,'.'+(decoded==='/'?'/index.html':decoded));
  if(file!==root&&!file.startsWith(root+path.sep)) {
    res.writeHead(403);
    return res.end();
  }

  fs.readFile(file,(err,data)=>{
    if(err) {
      res.writeHead(404);
      return res.end();
    }
    const type=file.endsWith('.html')?'text/html; charset=utf-8':
      file.endsWith('.js')?'application/javascript; charset=utf-8':
      file.endsWith('.css')?'text/css; charset=utf-8':
      'application/octet-stream';
    res.writeHead(200,{
      'Content-Type':type,
      'X-Content-Type-Options':'nosniff'
    });
    res.end(req.method==='HEAD'?undefined:data);
  });
});

server.listen(PORT,()=>{
  console.log('Fantasy Audible running on port '+PORT);
});
