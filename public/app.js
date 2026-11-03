let state=null,manager=null,tab='Home',token=localStorage.getItem('audibleToken');
let espn=null,espnError='',draftSearch='',draftPosition='ALL',loadingESPN=false;
let serverOffsetMs=0,clockSynchronized=false,clockSyncInProgress=false,lastClockSync=0;
let settingsDraft=null,prefsDraft=null,settingsDirty=false,prefsDirty=false;
const $=id=>document.getElementById(id);
const tabs=['Home','My Team','Matchup','League','Players','Draft','Notifications','Commissioner'];
const POSITIONS=['QB','RB','WR','TE','D/ST','K'];
const GROUP_LABELS={passing:'Passing',rushing:'Rushing',receiving:'Receiving',kicking:'Kicking',
  defense:'Defense / Special Teams',miscellaneous:'Miscellaneous'};
const LABELS={yards:'Yards',touchdowns:'Touchdowns',touchdowns40:'40+ yard TD bonus',
  interceptions:'Interceptions thrown',twoPoint:'Two-point conversion',yards100to199:'100–199 yard game bonus',
  receptions:'Receptions',patMade:'PAT made',patMissed:'PAT missed',fg0to39:'FG made 0–39',
  fg40to49:'FG made 40–49',fg50to59:'FG made 50–59',fg60plus:'FG made 60+',
  fgMiss0to39:'FG missed 0–39',sack:'Sacks',interception:'Interceptions',
  interceptionTD:'Interception return TD',fumbleReturnTD:'Fumble return TD',
  kickoffReturnTD:'Kickoff return TD',puntReturnTD:'Punt return TD',
  blockedKickReturnTD:'Blocked kick return TD',blockedKick:'Blocked kick',
  fumbleRecovered:'Fumble recovered',forcedFumble:'Forced fumble',safety:'Safety',
  twoPointReturn:'Two-point return',onePointSafety:'One-point safety',
  pointsAllowed0:'Points allowed 0',pointsAllowed1to6:'Points allowed 1–6',
  pointsAllowed7to13:'Points allowed 7–13',pointsAllowed14to17:'Points allowed 14–17',
  pointsAllowed18to27:'Points allowed 18–27',pointsAllowed28to34:'Points allowed 28–34',
  pointsAllowed35to45:'Points allowed 35–45',pointsAllowed46plus:'Points allowed 46+',
  yardsAllowedUnder100:'Yards allowed under 100',yardsAllowed100to199:'Yards allowed 100–199',
  yardsAllowed200to299:'Yards allowed 200–299',yardsAllowed300to349:'Yards allowed 300–349',
  yardsAllowed350to399:'Yards allowed 350–399',yardsAllowed400to449:'Yards allowed 400–449',
  yardsAllowed450to499:'Yards allowed 450–499',yardsAllowed500to549:'Yards allowed 500–549',
  yardsAllowed550plus:'Yards allowed 550+',fumbleRecoveryTD:'Fumble recovery TD',fumblesLost:'Fumbles lost'};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=v=>Number(v||0).toFixed(1);
const m=id=>state?.managers.find(x=>x.id===id);
const p=id=>state?.players.find(x=>x.id===id);
const score=x=>x.scoringMode==='handcuff'?(x.credited??0):x.points;
const total=id=>state.players.filter(x=>x.owner===id&&!['BENCH','IR'].includes(x.slot))
  .reduce((sum,x)=>sum+score(x),0);
const card=(title,body)=>`<section class="card"><h2>${title}</h2>${body}</section>`;
function toast(message){const el=$('toast');if(!el)return;el.textContent=message;el.style.display='block';
  setTimeout(()=>el.style.display='none',3500);}
function playerRow(x){return `<div class="row"><div><b>${esc(x.name)}</b><div class="muted small">
  ${esc(x.team)} · ${esc(x.pos)} · ${esc(x.slot)} · ${esc(x.status)}</div></div><b>${fmt(score(x))}</b></div>`;}
async function apiPost(route,body){const response=await fetch(route,{method:'POST',headers:{
  'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(body)});
  const result=await response.json();if(!response.ok)throw Error(result.error||'Request failed');return result;}
async function act(route,body){if(route==='/api/substitute'&&!confirm('This substitution is permanent. Your starter points will be forfeited. Continue?'))return;
  try{await apiPost(route,body);toast('League updated');}catch(e){toast(e.message);}}
async function renameTeam(){const current=m(manager)?.team||'',proposed=prompt('Enter your fantasy team name:',current);
  if(proposed===null)return;const name=proposed.trim().replace(/\s+/g,' ');if(name===current)return;
  try{const result=await apiPost('/api/team-name',{name});m(manager).team=result.team;render();toast('Team name updated');}
  catch(e){toast(e.message);}}
function injuryCard(injury){const starter=p(injury.player);if(!starter||starter.owner!==manager)return '';
  const choices=state.players.filter(x=>x.owner===manager&&x.slot==='BENCH'&&x.pos===starter.pos)
    .map(x=>{const same=x.team===starter.team&&x.kickoff<=state.phase;
      const later=x.kickoff>state.phase,eligible=same||later;
      return `<div class="row"><div><b>${esc(x.name)}</b><div class="muted small">${same?'Same-team handcuff: future points only':later?'Later kickoff: full-game points':'Not eligible'}</div></div>
        <button ${eligible?'':'disabled'} onclick='act("/api/substitute",${JSON.stringify({injury:injury.id,bench:x.id})})'>Substitute</button></div>`;}).join('');
  return card('Injury substitution available',`<p><b>${esc(starter.name)}</b> — ${fmt(starter.points)} points</p>
    <p>Keep your starter or permanently substitute.</p>${choices||'<p>No eligible bench players.</p>'}
    <button onclick='act("/api/keep",${JSON.stringify({injury:injury.id})})'>Keep starter</button>`);}
function serverNow(){return Date.now()+serverOffsetMs;}
async function syncServerClock(){if(!token||clockSyncInProgress)return;clockSyncInProgress=true;
  try{const started=Date.now(),response=await fetch('/api/draft?clockSync='+started,{
    headers:{Authorization:'Bearer '+token,'Cache-Control':'no-cache'},cache:'no-store'});
    const finished=Date.now();if(!response.ok)throw Error('Clock synchronization failed');
    const dateHeader=response.headers.get('Date');if(!dateHeader)throw Error('Server Date header unavailable');
    const serverTime=Date.parse(dateHeader);if(!Number.isFinite(serverTime)||finished-started>10000)throw Error('Clock sync failed');
    serverOffsetMs=serverTime+500-(started+finished)/2;clockSynchronized=true;lastClockSync=finished;
    updateDraftClock();}catch(e){console.warn('Draft clock sync:',e.message);}finally{clockSyncInProgress=false;}}
function draftData(){return state?.draft||{status:'waiting',rounds:16,secondsPerPick:90,order:[],picks:[],deadline:null};}
function currentTurn(){const d=draftData();return d.order[d.picks.length]||null;}
function clockText(seconds){return seconds===null?'--:--':`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;}
function remainingTime(){const d=draftData();if(d.status==='paused')return d.remainingSeconds??d.secondsPerPick??90;
  if(d.status!=='active'||!d.deadline||!clockSynchronized)return null;
  const deadline=Date.parse(d.deadline);return Number.isFinite(deadline)?Math.max(0,Math.ceil((deadline-serverNow())/1000)):null;}
function updateDraftClock(){const clock=$('draftClock');if(!clock||tab!=='Draft')return;
  const d=draftData();clock.textContent=clockText(remainingTime());const status=$('draftClockStatus');
  if(status)status.textContent=d.status==='paused'?'Timer paused':d.status==='completed'?'Draft complete':
    !clockSynchronized?'Synchronizing with server…':d.status==='active'?'Server-synchronized countdown':'Waiting for draft';}
async function loadESPN(force=false){if(loadingESPN||(espn&&!force))return;loadingESPN=true;espnError='';
  try{const response=await fetch('/api/espn/players',{headers:{Authorization:'Bearer '+token}});
    const result=await response.json();if(!response.ok)throw Error(result.details||result.error);espn=result;}
  catch(e){espnError=e.message;}finally{loadingESPN=false;if(tab==='Draft'||tab==='Players')render();}}
function injuryLabel(status){const v=String(status||'UNKNOWN').toUpperCase();
  if(['QUESTIONABLE','DOUBTFUL','OUT'].includes(v))return `<span class="pill warn">${esc(v)}</span>`;
  if(['ACTIVE','HEALTHY'].includes(v))return '<span class="pill">Healthy</span>';
  return `<span class="muted small">${esc(v)}</span>`;}
function myCounts(){const counts=Object.fromEntries(POSITIONS.map(x=>[x,0]));
  draftData().picks.filter(x=>x.manager===manager).forEach(x=>{if(x.position in counts)counts[x.position]++;});return counts;}
function missingStarters(counts){const r=state.settings?.roster;
  if(!r)return 0;let missing=POSITIONS.reduce((n,pos)=>n+Math.max(0,r.starters[pos]-counts[pos]),0);
  const flexFilled=['RB','WR','TE'].reduce((n,pos)=>n+Math.max(0,counts[pos]-r.starters[pos]),0);
  return missing+Math.max(0,r.starters.FLEX-flexFilled);}
function canDraftPosition(pos){const r=state.settings?.roster;if(!r)return true;
  const counts=myCounts();if(counts[pos]>=r.maximums[pos])return false;
  const d=draftData();const total=d.order.filter(x=>x.manager===manager).length;
  const used=d.picks.filter(x=>x.manager===manager).length;counts[pos]++;
  return missingStarters(counts)<=total-used-1;}
function availablePlayers(){if(!espn?.players)return [];
  const selected=new Set(draftData().picks.map(x=>String(x.playerId)));
  return espn.players.filter(x=>!selected.has(String(x.id)))
    .filter(x=>draftPosition==='ALL'||x.position===draftPosition)
    .filter(x=>{const q=draftSearch.toLowerCase();return x.name.toLowerCase().includes(q)||
      x.position.toLowerCase().includes(q)||String(x.nflTeamId??'').includes(q);})
    .sort((a,b)=>(a.rank??Infinity)-(b.rank??Infinity)||
      (a.averageDraftPosition??Infinity)-(b.averageDraftPosition??Infinity));}
async function draftAction(action){if(!confirm({start:'Start the draft now?',pause:'Pause the draft?',resume:'Resume the draft?'}[action]))return;
  try{await apiPost('/api/draft/'+action,{});await syncServerClock();toast('Draft updated');}catch(e){toast(e.message);}}
async function restartLeague(){
  const confirmation=prompt(
    'DANGER: This permanently clears all draft picks, the draft order, '+
    'draft history, team rosters, and injury events. Accounts, team names, '+
    'league settings, and manager draft preferences are kept. '+
    'Type RESTART LEAGUE to proceed:'
  );
  if(confirmation!=='RESTART LEAGUE'){
    if(confirmation!==null)toast('Restart canceled: confirmation did not match');
    return;
  }
  if(!confirm('Final confirmation: restart the league and erase the current draft?'))return;
  try{
    const result=await apiPost('/api/league/restart',{confirmation});
    toast('League restarted. '+result.clearedPicks+' picks cleared.');
    tab='Commissioner';
    await syncServerClock();
  }catch(e){toast(e.message);}
}
async function selectDraftPlayer(id){const turn=currentTurn();if(!turn||turn.manager!==manager)return toast('It is not your turn');
  const player=espn?.players.find(x=>String(x.id)===String(id));if(!player)return;
  if(!canDraftPosition(player.position))return toast('Position limit or required-starter protection');
  if(!confirm(`Draft ${player.name}? This pick is final.`))return;
  try{await apiPost('/api/draft/pick',{playerId:String(id)});await syncServerClock();toast(`${player.name} drafted`);}
  catch(e){toast(e.message);}}
function draftBoard(){const d=draftData();if(!d.order.length)return card('Draft order',`<p>The commissioner has not started the draft.</p>
  <p>Registered managers: ${state.managers.filter(x=>x.claimed).length} of 12</p>`);
  return card('Upcoming picks',d.order.slice(d.picks.length,d.picks.length+12).map((pick,i)=>
    `<div class="row"><div><b>#${d.picks.length+i+1}</b> ${esc(m(pick.manager)?.team||pick.manager)}
    <div class="muted small">Round ${pick.round}</div></div>${i===0?'<b>ON THE CLOCK</b>':''}</div>`).join('')||'<p>Draft complete.</p>');}
function draftHistory(){const picks=[...draftData().picks].reverse();return card('Draft history',picks.length?picks.map(x=>
  `<div class="row"><div><b>#${x.overall} ${esc(x.playerName)}</b><div class="muted small">
  ${esc(m(x.manager)?.team||x.manager)} · ${esc(x.position)} · Round ${x.round}${x.automatic?' · Auto-pick':''}
  </div></div><b>${x.rank==null?'—':'#'+x.rank}</b></div>`).join(''):'<p>No players drafted yet.</p>');}
function playerTable(){if(!espn)return card('ESPN player data',`<p>${esc(espnError||'Loading ESPN rankings and projections...')}</p>
  <button onclick="loadESPN(true)">Retry ESPN feed</button>`);
  const d=draftData(),turn=currentTurn(),myTurn=d.status==='active'&&turn?.manager===manager;
  const players=availablePlayers().slice(0,250);
  const updated=espn.updatedAt?new Date(espn.updatedAt).toLocaleString():'Not available';
  return card('ESPN player rankings',`<p class="muted small">Season ${esc(espn.season)} · ESPN PPR projections ·
    Updated ${esc(updated)}${espn.stale?' · Cached data':''}</p>
    <div class="actions"><input id="draftSearch" placeholder="Search players" value="${esc(draftSearch)}"
      oninput="updateDraftSearch(this.value)"><select id="draftPosition" onchange="updateDraftPosition(this.value)">
      ${['ALL',...POSITIONS].map(pos=>`<option value="${pos}" ${draftPosition===pos?'selected':''}>${pos}</option>`).join('')}
      </select><button onclick="loadESPN(true)">Refresh</button></div>
    <p class="muted small">Showing ${players.length} available players. Missing ranks and projections show —.</p>
    <div id="draftPlayerRows">${players.map(x=>{const legal=canDraftPosition(x.position);
      return `<div class="row"><div><b>${x.rank==null?'—':'#'+x.rank} ${esc(x.name)}</b>
        <div class="muted small">${esc(x.position)} · ESPN ADP ${x.averageDraftPosition==null?'—':fmt(x.averageDraftPosition)}</div>
        ${injuryLabel(x.injuryStatus)}</div><div style="text-align:right"><b>${x.projectedPoints==null?'—':fmt(x.projectedPoints)}</b>
        <div class="muted small">Projected PPR</div>${myTurn?`<button ${legal?'':'disabled'}
          onclick="selectDraftPlayer('${esc(x.id)}')">${legal?'Draft':'Position locked'}</button>`:''}</div></div>`;}).join('')||'<p>No matching players.</p>'}</div>`);}
function updateDraftSearch(v){draftSearch=v;const input=$('draftSearch'),start=input?.selectionStart??v.length;
  render();const replacement=$('draftSearch');replacement?.focus();try{replacement?.setSelectionRange(start,start);}catch{}}
function updateDraftPosition(v){draftPosition=v;render();}
function prefs(){return prefsDraft||state.draftPreferences?.[manager]||{strategy:'balanced',autoDraft:false,
  avoidOut:true,positionPriority:['RB','WR','TE','QB','D/ST','K'],queue:[]};}
function ensurePrefsDraft(){if(!prefsDraft)prefsDraft=structuredClone(prefs());return prefsDraft;}
function updatePref(key,value){ensurePrefsDraft()[key]=value;prefsDirty=true;render();}
function updatePriority(index,value){const x=ensurePrefsDraft(),old=x.positionPriority.indexOf(value);
  if(old<0||old===index)return;[x.positionPriority[index],x.positionPriority[old]]=
    [x.positionPriority[old],x.positionPriority[index]];prefsDirty=true;render();}
function addToQueue(id){const x=ensurePrefsDraft(),key=String(id);
  x.queue=x.queue.filter(v=>v!==key);x.queue.push(key);prefsDirty=true;render();}
function removeFromQueue(id){const x=ensurePrefsDraft();x.queue=x.queue.filter(v=>v!==String(id));prefsDirty=true;render();}
async function savePreferences(){try{await apiPost('/api/draft/preferences',prefs());prefsDirty=false;toast('Draft preferences saved');}
  catch(e){toast(e.message);}}
function draftPreferencesUI(){const x=prefs(),queue=x.queue||[];
  return card('My auto-draft settings',`<p class="muted small">These settings belong to your team. The server enforces all position maximums.</p>
    <label>Strategy</label><select onchange="updatePref('strategy',this.value)">
      ${[['balanced','Value-Aware Balanced Roster (default)'],['bpa','Best Player Available'],
        ['starters','Fill Starting Lineup'],['custom','Custom Position Priority']].map(([value,label])=>
        `<option value="${value}" ${x.strategy===value?'selected':''}>${label}</option>`).join('')}</select>
    <p><label><input type="checkbox" ${x.autoDraft?'checked':''}
      onchange="updatePref('autoDraft',this.checked)"> Auto-pick immediately when my turn starts</label></p>
    <p><label><input type="checkbox" ${x.avoidOut?'checked':''}
      onchange="updatePref('avoidOut',this.checked)"> Prefer players not designated OUT / IR</label></p>
    ${x.strategy==='custom'?`<h3>Position priority</h3>${x.positionPriority.map((pos,i)=>
      `<div class="row"><span>${i+1}.</span><select onchange="updatePriority(${i},this.value)">
      ${POSITIONS.map(p=>`<option value="${p}" ${pos===p?'selected':''}>${p}</option>`).join('')}</select></div>`).join('')}`:''}
    <h3>Personal player queue</h3><p class="muted small">Queue picks take priority over your strategy, but never override roster limits.</p>
    ${queue.map((id,i)=>{const player=espn?.players?.find(p=>String(p.id)===id);
      return `<div class="row"><span>${i+1}. ${esc(player?.name||'Player '+id)}</span>
        <button onclick="removeFromQueue('${esc(id)}')">Remove</button></div>`;}).join('')||'<p>No queued players.</p>'}
    <div class="actions"><input id="queueSearch" placeholder="ESPN player ID or search name">
      <button onclick="queueFromInput()">Add player</button></div>
    <button onclick="savePreferences()">Save my draft settings${prefsDirty?' *':''}</button>`);}
function queueFromInput(){const v=$('queueSearch')?.value.trim();if(!v)return;
  const player=espn?.players?.find(x=>String(x.id)===v)||espn?.players?.find(x=>x.name.toLowerCase()===v.toLowerCase());
  if(!player)return toast('Player not found. Load ESPN data or use exact name / ID.');addToQueue(player.id);}
function renderDraft(){const d=draftData(),turn=currentTurn(),myTurn=d.status==='active'&&turn?.manager===manager;
  const controls=state.viewer.commissioner?`<div class="actions">
    ${d.status==='waiting'?'<button onclick="draftAction(\'start\')">Start draft</button>':''}
    ${d.status==='active'?'<button onclick="draftAction(\'pause\')">Pause draft</button>':''}
    ${d.status==='paused'?'<button onclick="draftAction(\'resume\')">Resume draft</button>':''}</div>`:'';
  return `<h1>Fantasy Audible Draft Room</h1>${card('Draft status',`
    <p><b>${esc(d.status.toUpperCase())}</b> · ${d.rounds} rounds</p>
    <div class="grid"><div><div class="muted small">Overall pick</div><h2>${d.picks.length+1} / ${d.order.length||'Not started'}</h2></div>
    <div><div class="muted small">Pick timer</div><h2 id="draftClock">${clockText(remainingTime())}</h2>
    <div id="draftClockStatus" class="muted small">Server-synchronized countdown</div></div></div>
    <p>${turn?`On the clock: <b>${esc(m(turn.manager)?.team||turn.manager)}</b>`:
      d.status==='completed'?'All draft selections are complete.':'Waiting for commissioner.'}</p>
    ${myTurn?'<p><b>Your turn! Select a player below.</b></p>':''}${controls}`)}
    ${draftPreferencesUI()}${draftBoard()}${playerTable()}${draftHistory()}`;}
function ensureSettingsDraft(){if(!settingsDraft)settingsDraft=structuredClone(state.settings);return settingsDraft;}
function editSetting(section,key,value,subkey){const x=ensureSettingsDraft();
  if(subkey)x[section][key][subkey]=Number(value);
  else if(section==='transactions')x.transactions[key]=value;
  else x[section][key]=Number(value);settingsDirty=true;}
function settingsUI(){const x=settingsDraft||state.settings;if(!x)return card('League settings','<p>Settings will appear after server deployment.</p>');
  const d=draftData(),locked=d.status!=='waiting';
  const numberField=(section,key,subkey,value,disabled=false)=>`<div class="row"><label>${esc(LABELS[subkey]||subkey)}</label>
    <input style="max-width:95px" type="number" step="any" value="${esc(value)}" ${disabled?'disabled':''}
    onchange="editSetting('${section}','${key}',this.value,'${subkey}')"></div>`;
  const roster=x.roster;
  return `${card('Roster configuration',`<p class="muted small">${locked?'Roster rules locked because the draft has started.':'Future draft rounds equal starters plus bench. IR is additional.'}</p>
    ${[...POSITIONS,'FLEX'].map(pos=>`<div class="row"><b>${pos}</b><label>Starters
      <input type="number" min="0" max="8" style="max-width:65px" ${locked?'disabled':''}
      value="${roster.starters[pos]}" onchange="editSetting('roster','starters',this.value,'${pos}')"></label>
      ${pos==='FLEX'?'':`<label>Maximum <input type="number" min="0" max="12" style="max-width:65px"
      ${locked?'disabled':''} value="${roster.maximums[pos]}" onchange="editSetting('roster','maximums',this.value,'${pos}')"></label>`}</div>`).join('')}
    ${['bench','ir'].map(key=>`<div class="row"><label>${key.toUpperCase()}</label><input type="number"
      ${locked?'disabled':''} style="max-width:90px" value="${roster[key]}"
      onchange="editSetting('roster','${key}',this.value)"></div>`).join('')}`)}
    ${Object.entries(x.scoring).map(([group,rules])=>card(GROUP_LABELS[group],
      Object.entries(rules).map(([key,value])=>numberField('scoring',group,key,value)).join(''))).join('')}
    ${card('Transactions',`<div class="row"><label>Waiver period (days)</label><input type="number" min="0" max="7"
      value="${x.transactions.waiverDays}" onchange="editSetting('transactions','waiverDays',Number(this.value))"></div>
      <div class="row"><label>Season acquisition limit (blank = unlimited)</label>
      <input type="number" min="0" value="${x.transactions.acquisitionLimit??''}"
      onchange="editSetting('transactions','acquisitionLimit',this.value===''?null:Number(this.value))"></div>
      <label><input type="checkbox" ${x.transactions.undroppableList?'checked':''}
      onchange="editSetting('transactions','undroppableList',this.checked)"> ESPN undroppable list</label>
      <p class="muted small">Player universe: All NFL · Lineup lock: Individual kickoff.</p>`)}
    ${card('Save commissioner settings',`<p class="muted small">Scoring values are configurable but live NFL stat scoring and waivers are not yet implemented.</p>
      <button onclick="saveSettings()">Save league settings${settingsDirty?' *':''}</button>`)}
  `;}
async function saveSettings(){try{const result=await apiPost('/api/settings',{settings:settingsDraft||state.settings});
  settingsDraft=structuredClone(result.settings);settingsDirty=false;toast('Commissioner settings saved');}
  catch(e){toast(e.message);}}
function render(){if(!state||!manager)return;const mine=state.players.filter(x=>x.owner===manager),myTeam=m(manager);
  if(!myTeam)return;
  $('tabs').innerHTML=tabs.filter(t=>t!=='Commissioner'||state.viewer.commissioner)
    .map(t=>`<button class="${tab===t?'active':''}" onclick="changeTab('${t}')">${t}</button>`).join('');
  let content='';
  if(tab==='Home')content=`<h1>${esc(state.league)}</h1><p>Week ${state.week} · ${esc(myTeam.team)}</p>
    <div class="grid">${card('Your score',`<div class="stat">${fmt(total(manager))}</div>`)}
    ${card('Registered teams',`<div class="stat">${state.managers.filter(x=>x.claimed).length} / 12</div>`)}
    ${card('Draft status',`<p>${esc(draftData().status)}</p><button onclick="changeTab('Draft')">Open draft room</button>`)}</div>
    ${state.injuries.filter(i=>i.active).map(injuryCard).join('')}
    ${card('Recent activity',state.transactions.slice(0,8).map(t=>`<div class="row"><span>${esc(t.details)}</span></div>`).join('')||'<p>No activity yet.</p>')}`;
  if(tab==='My Team'){const picks=draftData().picks.filter(x=>x.manager===manager);
    content=`<h1>${esc(myTeam.team)}</h1><button onclick="renameTeam()">Rename My Team</button>
      ${card('Drafted players',picks.map(x=>`<div class="row"><div><b>${esc(x.playerName)}</b>
      <div class="muted small">${esc(x.position)} · Pick ${x.overall}</div></div>
      <b>${x.projectedPoints==null?'—':fmt(x.projectedPoints)}</b></div>`).join('')||'<p>No draft picks yet.</p>')}
      ${state.injuries.filter(i=>i.active).map(injuryCard).join('')}
      ${card('Starting lineup',mine.filter(x=>!['BENCH','IR'].includes(x.slot)).map(playerRow).join('')||'<p>No starters assigned.</p>')}
      ${card('Bench',mine.filter(x=>x.slot==='BENCH').map(playerRow).join('')||'<p>No bench players assigned.</p>')}`;}
  if(tab==='Matchup'){const opponent=manager==='m1'?'m2':'m1';
    content=`<h1>Week ${state.week} Matchup</h1><div class="grid">${card(esc(myTeam.team),
      `<div class="stat">${fmt(total(manager))}</div>${mine.filter(x=>!['BENCH','IR'].includes(x.slot)).map(playerRow).join('')}`)}
      ${m(opponent)?card(esc(m(opponent).team),`<div class="stat">${fmt(total(opponent))}</div>
      ${state.players.filter(x=>x.owner===opponent&&!['BENCH','IR'].includes(x.slot)).map(playerRow).join('')}`):''}</div>`;}
  if(tab==='League')content=`<h1>League</h1>${card('Teams',state.managers.filter(x=>x.claimed).map(x=>
    `<div class="row"><b>${esc(x.team)}</b><span>${fmt(total(x.id))} pts</span></div>`).join(''))}
    ${card('League roster rules',state.settings?`<p>Starters: ${Object.entries(state.settings.roster.starters).map(([k,v])=>`${k} ${v}`).join(' · ')}</p>
      <p>Bench: ${state.settings.roster.bench} · IR: ${state.settings.roster.ir}</p>`:'<p>Not yet configured.</p>')}`;
  if(tab==='Players')content=`<h1>ESPN Player Directory</h1>${playerTable()}`;
  if(tab==='Draft')content=renderDraft();
  if(tab==='Notifications')content=`<h1>Notifications</h1>${card('Injury alerts',state.injuries.map(i=>
    `<div class="row"><b>${esc(p(i.player)?.name||'Player')}</b><span>${i.active?'Pending':'Resolved'}</span></div>`).join('')||'<p>No alerts.</p>')}
    ${card('Transactions',state.transactions.slice(0,50).map(t=>`<div class="row">${esc(t.details)}</div>`).join('')||'<p>No transactions.</p>')}`;
  if(tab==='Commissioner'&&state.viewer.commissioner)content=`<h1>Commissioner Controls</h1>
    ${card('Draft management','<p>Manage the snake draft.</p><button onclick="changeTab(\'Draft\')">Open draft controls</button>')}
    ${card('Restart league',`<p><b>Destructive action:</b> clear the current draft order, all picks, draft history, drafted rosters, and injuries. Keep manager accounts, team names, commissioner scoring/roster rules, and each manager's draft preferences.</p>
      <p>The next draft will use your configured roster size (16 rounds by default).</p>
      <button onclick="restartLeague()" style="background:#a32121;color:white">Restart league / New draft</button>`)}
    ${settingsUI()}
    ${card('Simulate injury',`<select id="injuryPlayer">${state.players.filter(x=>x.slot!=='BENCH').map(x=>
      `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('')}</select>
      <button onclick="act('/api/demo',{action:'injure',player:$('injuryPlayer').value})">Trigger injury</button>`)}
    ${card('Advance game window',`<p>Current phase: ${state.phase}</p>
      <button onclick="act('/api/demo',{action:'advance'})">Advance</button>`)}
    ${card('Simulate points',`<select id="pointPlayer">${state.players.map(x=>
      `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('')}</select>
      <button onclick="act('/api/demo',{action:'points',player:$('pointPlayer').value,amount:3.5})">Add 3.5 points</button>`)}`;
  $('app').innerHTML=`<div class="row"><span class="muted small">${esc(state.viewer.name)} · ${esc(myTeam.team)}</span>
    <div class="actions"><button onclick="renameTeam()">Rename Team</button><button onclick="logout()">Sign out</button></div></div>${content}`;
  updateDraftClock();}
function changeTab(next){tab=next;render();if(tab==='Draft')syncServerClock();
  if(tab==='Draft'||tab==='Players')loadESPN();}
function logout(){localStorage.removeItem('audibleToken');location.reload();}
function authForm(){$('tabs').innerHTML='';$('connection').textContent='● Sign in';
  $('app').innerHTML=`<section class="card" style="max-width:500px;margin:auto"><h1>Fantasy Audible</h1>
    <p>Create your own fantasy team.</p><form id="auth">
    <input id="email" type="email" required placeholder="Email" style="width:100%;padding:12px;margin:6px 0">
    <input id="password" type="password" required minlength="10" placeholder="Password (10+ characters)"
      style="width:100%;padding:12px;margin:6px 0"><label for="teamName">Fantasy team name (new accounts)</label>
    <input id="teamName" type="text" minlength="3" maxlength="40" placeholder="Your custom team name"
      style="width:100%;padding:12px;margin:6px 0"><div class="actions">
    <button type="submit">Sign in</button><button type="button" id="register">Create Account</button></div>
    <p id="authError" role="alert"></p></form></section>`;
  async function submit(kind){try{const body={email:$('email').value,password:$('password').value};
    if(kind==='register'){body.teamName=$('teamName').value.trim();
      if(body.teamName.length<3||body.teamName.length>40)throw Error('Team name must be 3–40 characters');}
    const response=await fetch('/api/'+kind,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const result=await response.json();if(!response.ok)throw Error(result.error||'Authentication failed');
    localStorage.setItem('audibleToken',result.token);location.reload();}
    catch(e){$('authError').textContent=e.message;}}
  $('auth').onsubmit=e=>{e.preventDefault();submit('login');};$('register').onclick=()=>submit('register');}
async function connect(){if(!token)return authForm();try{const response=await fetch('/api/state',{
  headers:{Authorization:'Bearer '+token},cache:'no-store'});if(response.status===401)return logout();
  if(!response.ok)throw Error('Server unavailable');state=await response.json();manager=state.viewer.manager;render();}
  catch(e){$('connection').textContent='● Offline';return;}
  await syncServerClock();const events=new EventSource('/api/events?token='+encodeURIComponent(token));
  let previousPickCount=state.draft?.picks?.length??0,previousDeadline=state.draft?.deadline??null,
    previousStatus=state.draft?.status??null;
  events.onmessage=e=>{const next=JSON.parse(e.data),count=next.draft?.picks?.length??0,
    deadline=next.draft?.deadline??null,status=next.draft?.status??null;
    const changed=count!==previousPickCount||deadline!==previousDeadline||status!==previousStatus;
    previousPickCount=count;previousDeadline=deadline;previousStatus=status;
    state=next;manager=state.viewer.manager;$('connection').textContent='● Live synced';render();
    if(changed)syncServerClock();};
  events.onerror=()=>{$('connection').textContent='● Reconnecting…';};}
setInterval(updateDraftClock,500);
setInterval(()=>{if(token&&state&&Date.now()-lastClockSync>30000)syncServerClock();},5000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&token&&state)syncServerClock();});
connect();
