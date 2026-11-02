
let state=null,tab='Home',manager=null;
let token=localStorage.getItem('audibleToken');

const tabs=['Home','My Team','Matchup','League','Players','Draft','Notifications','Commissioner'];
const $=id=>document.getElementById(id);
const p=id=>state.players.find(x=>x.id===id);
const m=id=>state.managers.find(x=>x.id===id);
const fmt=n=>Number(n||0).toFixed(1);

function esc(v) {
  return String(v??'').replace(/[&<>"']/g,c=>({
    '&':'&amp;','<':'&lt;','>':'&gt;',
    '"':'&quot;',"'":'&#39;'
  })[c]);
}

function toast(message) {
  const el=$('toast');
  el.textContent=message;
  el.style.display='block';
  setTimeout(()=>el.style.display='none',3500);
}

function score(x) {
  return x.scoringMode==='handcuff'?x.credited??0:x.points;
}

function total(id) {
  return state.players.filter(x=>x.owner===id&&x.slot!=='BENCH')
    .reduce((s,x)=>s+score(x),0);
}

function card(title,body,extra='') {
  return `<section class="card ${extra}"><h2>${title}</h2>${body}</section>`;
}

function playerRow(x) {
  return `<div class="row"><div><b>${esc(x.name)}</b>
    <div class="muted small">${esc(x.team)} · ${esc(x.pos)} ·
    ${esc(x.slot)} · ${esc(x.status)}</div></div>
    <b>${fmt(score(x))}</b></div>`;
}

async function renameTeam() {
  const current=m(manager)?.team||'';
  const proposed=prompt('Enter your fantasy team name:',current);
  if(proposed===null)return;
  const name=proposed.trim().replace(/\s+/g,' ');
  if(name===current)return;
  if(name.length<3||name.length>40){
    toast('Team name must be 3–40 characters');
    return;
  }
  try {
    const r=await fetch('/api/team-name',{
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        Authorization:'Bearer '+token
      },
      body:JSON.stringify({name})
    });
    const result=await r.json();
    if(!r.ok)throw Error(result.error);
    m(manager).team=result.team;
    render();
    toast('Team name updated');
  }catch(e){toast(e.message)}
}

function injuryCard(i) {
  const starter=p(i.player);
  if(!starter||starter.owner!==manager)return '';

  const choices=state.players.filter(x=>
    x.owner===manager&&x.slot==='BENCH'&&x.pos===starter.pos
  ).map(x=>{
    const mode=x.team===starter.team&&x.kickoff<=state.phase
      ?'Handcuff — prior points zeroed'
      :x.kickoff>state.phase
      ?'Later kickoff — full score':null;

    return `<div class="row"><div><b>${esc(x.name)}</b>
      <div class="muted small">${mode||'Game started — locked'}</div>
      </div><button ${mode?'':'disabled'}
      onclick="act('/api/substitute',{injury:'${i.id}',bench:'${x.id}'})">
      Substitute</button></div>`;
  }).join('');

  return card('🚨 Injury substitution available',
    `<p>${esc(starter.name)} · ${esc(starter.pos)} ·
    ${fmt(starter.points)} pts. Keep or substitute.</p>
    ${choices||'<p>No matching bench players.</p>'}
    <div class="actions"><button
    onclick="act('/api/keep',{injury:'${i.id}'})">
    Keep starter</button></div>`,'highlight');
}

function render() {
  if(!state||!manager)return;
  const mine=state.players.filter(x=>x.owner===manager);
  const myTeam=m(manager);
  if(!myTeam)return;

  $('tabs').innerHTML=tabs.filter(t=>
    t!=='Commissioner'||state.viewer.commissioner
  ).map(t=>`<button class="${tab===t?'active':''}"
    onclick="tab='${t}';render()">${t}</button>`).join('');

  let content='';

  if(tab==='Home') {
    content=`<h1>${esc(state.league)}</h1>
      <p>Week ${state.week} · ${esc(myTeam.team)} · Live shared league</p>
      <div class="grid">
      ${card('Your live score',`<div class="stat">${fmt(total(manager))}</div><p>Active starters</p>`)}
      ${card('League managers',`<div class="stat">${state.managers.filter(x=>x.claimed).length}</div><p>Registered teams</p>`)}
      ${card('Pending injuries',`<div class="stat">${state.injuries.filter(i=>i.active&&p(i.player)?.owner===manager).length}</div><p>Action required</p>`)}
      </div>
      ${state.injuries.filter(i=>i.active).map(injuryCard).join('')}
      ${card('Recent activity',state.transactions.slice(0,5)
        .map(t=>`<div class="row"><span>${esc(t.details)}</span>
        <span class="muted small">${new Date(t.at).toLocaleTimeString()}</span></div>`)
        .join('')||'<p>No transactions yet.</p>')}`;
  }

  if(tab==='My Team') {
    content=`<h1>${esc(myTeam.team)}</h1>
      <div class="actions"><button onclick="renameTeam()">✏️ Rename My Team</button></div>
      <p>Changes synchronize across devices.</p>
      ${state.injuries.filter(i=>i.active).map(injuryCard).join('')}
      ${card('Starting lineup',mine.filter(x=>x.slot!=='BENCH').map(playerRow).join('')||'<p>No starters assigned.</p>')}
      ${card('Bench',mine.filter(x=>x.slot==='BENCH').map(playerRow).join('')||'<p>No bench players assigned.</p>')}`;
  }

  if(tab==='Matchup') {
    const opponent=manager==='m1'?'m2':'m1';
    content=`<h1>Week ${state.week} Matchup</h1><div class="grid">
      ${card(esc(myTeam.team),`<div class="score">${fmt(total(manager))}</div>${mine.filter(x=>x.slot!=='BENCH').map(playerRow).join('')}`)}
      ${m(opponent)?card(esc(m(opponent).team),`<div class="score">${fmt(total(opponent))}</div>${state.players.filter(x=>x.owner===opponent&&x.slot!=='BENCH').map(playerRow).join('')}`):''}
      </div>`;
  }

  if(tab==='League') {
    content=`<h1>League standings</h1>
      <p>Demo standings by lineup points.</p>
      ${card('Live leaderboard',state.managers.slice()
        .filter(x=>x.claimed)
        .sort((a,b)=>total(b.id)-total(a.id))
        .map((x,i)=>`<div class="row"><div><b>${i+1}. ${esc(x.team)}</b>
        <div class="muted small">${esc(x.name)}</div></div>
        <b>${fmt(total(x.id))}</b></div>`).join(''))}`;
  }

  if(tab==='Players') {
    content=`<h1>Player pool</h1><p>Demo player directory.</p>
      ${card('League players',state.players.map(x=>
        `<div class="row"><div><b>${esc(x.name)}</b>
        <div class="muted small">${esc(x.team)} · ${esc(x.pos)} ·
        ${esc(m(x.owner)?.team||'')}</div></div>
        <b>${fmt(score(x))}</b></div>`).join(''))}`;
  }

  if(tab==='Draft') {
    content=`<h1>Draft room</h1>${card('Draft module',
      '<p>Real-time drafting is not implemented yet.</p><button disabled>Start draft</button>')}`;
  }

  if(tab==='Notifications') {
    content=`<h1>Notifications</h1>
      ${card('Injury alerts',state.injuries.map(i=>
        `<div class="row"><div><b>${esc(p(i.player)?.name||'Player')}</b>
        <div class="muted small">${esc(i.description)}</div></div>
        <span class="pill ${i.active?'warn':''}">${i.active?'Pending':'Resolved'}</span></div>`).join(''))}
      ${card('Transaction feed',state.transactions.map(t=>
        `<div class="row"><div>${esc(t.details)}
        <div class="muted small">${new Date(t.at).toLocaleString()}</div>
        </div></div>`).join('')||'<p>No transactions.</p>')}`;
  }

  if(tab==='Commissioner'&&state.viewer.commissioner) {
    content=`<h1>Commissioner demo controls</h1>
      <p>Simulate events for testing.</p>
      ${card('Simulate injury',`<select id="injuryPlayer">
        ${state.players.filter(x=>x.slot!=='BENCH').map(x=>
        `<option value="${x.id}">${esc(x.name)} (${esc(m(x.owner)?.team||'')})</option>`).join('')}
        </select><div class="actions"><button onclick="act('/api/demo',{action:'injure',player:$('injuryPlayer').value})">Trigger injury</button></div>`)}
      ${card('Advance game window',`<p>Phase: ${state.phase}</p>
        <button ${state.phase>=4?'disabled':''}
        onclick="act('/api/demo',{action:'advance'})">Advance kickoff window</button>`)}
      ${card('Simulate scoring',`<select id="pointPlayer">
        ${state.players.map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join('')}
        </select><div class="actions"><button
        onclick="act('/api/demo',{action:'points',player:$('pointPlayer').value,amount:3.5})">
        Add 3.5 points</button></div>
        <p class="small">Handcuff points count only after substitution.</p>`)}`;
  }

  $('app').innerHTML=`<div class="row">
    <span class="muted small">Signed in: ${esc(state.viewer.name)} · ${esc(myTeam.team)}</span>
    <div class="actions"><button onclick="renameTeam()">Rename Team</button>
    <button onclick="logout()">Sign out</button></div></div>${content}`;
}

async function act(url,body) {
  if(url==='/api/substitute'&&!confirm(
    'Confirm permanent substitution? Starter points will be forfeited.'
  ))return;
  try {
    const r=await fetch(url,{
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        Authorization:'Bearer '+token
      },
      body:JSON.stringify(body)
    });
    const v=await r.json();
    if(!r.ok)throw Error(v.error||'Action failed');
    toast('League updated on connected devices');
  }catch(e){toast(e.message)}
}

function logout() {
  localStorage.removeItem('audibleToken');
  location.reload();
}

async function authForm() {
  $('tabs').innerHTML='';
  $('connection').textContent='● Sign in';

  $('app').innerHTML=`<section class="card" style="max-width:500px;margin:auto">
    <h1>Fantasy Audible</h1>
    <p>Create an account with your own team name, or sign in.</p>
    <form id="auth">
      <input id="email" type="email" required placeholder="Email"
        style="width:100%;padding:12px;margin:6px 0">
      <input id="password" type="password" required minlength="10"
        placeholder="Password (10+ characters)"
        style="width:100%;padding:12px;margin:6px 0">
      <label for="teamName">Fantasy team name (new accounts)</label>
      <input id="teamName" type="text" minlength="3" maxlength="40"
        placeholder="Enter your fantasy team name"
        style="width:100%;padding:12px;margin:6px 0">
      <div class="actions">
        <button type="submit">Sign in</button>
        <button type="button" id="register">Create Account</button>
      </div>
      <p id="authError" role="alert"></p>
    </form></section>`;

  async function submit(kind) {
    try {
      const body={
        email:$('email').value,
        password:$('password').value
      };

      if(kind==='register') {
        const name=$('teamName').value.trim();
        if(name.length<3||name.length>40)
          throw Error('Enter a team name between 3 and 40 characters');
        body.teamName=name;
      }

      const r=await fetch('/api/'+kind,{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify(body)
      });
      const v=await r.json();
      if(!r.ok)throw Error(v.error||'Authentication failed');
      localStorage.setItem('audibleToken',v.token);
      location.reload();
    }catch(e){$('authError').textContent=e.message}
  }

  $('auth').onsubmit=e=>{
    e.preventDefault();
    submit('login');
  };
  $('register').onclick=()=>submit('register');
}

async function connect() {
  if(!token)return authForm();

  try {
    const r=await fetch('/api/state',{
      headers:{Authorization:'Bearer '+token}
    });
    if(r.status===401)return logout();
    if(!r.ok)throw Error('Server unavailable');
    state=await r.json();
    manager=state.viewer.manager;
    render();
  }catch(e){
    $('connection').textContent='● Offline';
    return;
  }

  const events=new EventSource(
    '/api/events?token='+encodeURIComponent(token)
  );
  events.onmessage=e=>{
    state=JSON.parse(e.data);
    manager=state.viewer.manager;
    $('connection').textContent='● Live synced';
    render();
  };
  events.onerror=()=>{
    $('connection').textContent='● Reconnecting…';
  };
}

connect();
