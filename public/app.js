let state=null,manager=null,tab='Home',token=localStorage.getItem('audibleToken');
let chatMessages=[],chatMuted=false,chatMutedManagers=[],chatLastId=0,chatSeenId=Number(localStorage.getItem('audibleChatSeen')||0),chatLoading=false,chatError='',chatDraft='',chatPendingGif=null,tenorOpen=false,tenorResults=[],tenorQuery='',tenorError='',tenorBusy=false,tenorRequest=0;
let matchupWeek=null,matchupIndex=0,matchupTouchX=null;
let espn=null,espnError='',draftSearch='',draftPosition='ALL',loadingESPN=false;
let weeklyDirectory={},weeklyUpdatedAt=null,weeklyLoading=false,weeklyLastFetch=0;
let playerSort='rank';
let breakdownPlayerId=null;
let profilePlayerId=null,profileHistory=null,profileError="",profileLoading=false,expandedProfileWeek=null;
let transactionData=null,transactionError='',loadingTransactions=false,lastTransactionFetch=0;
let serverOffsetMs=0,clockSynchronized=false,clockSyncInProgress=false,lastClockSync=0;
let settingsDraft=null,prefsDraft=null,settingsDirty=false,prefsDirty=false;
const $=id=>document.getElementById(id);
const tabs=['Home','My Team','Matchup','League','Players','My Waivers','Draft','Notifications','Locker Room','Commissioner'];
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
const jsAttr=v=>JSON.stringify(v).replace(/"/g,"&quot;");
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
function teamPhoto(id,size=44){
  if(!document.getElementById('fa-avatar-style')){const style=document.createElement('style');style.id='fa-avatar-style';style.textContent='.fa-team-avatar{display:inline-flex;vertical-align:middle;align-items:center;justify-content:center;flex-shrink:0;border-radius:50%;overflow:hidden;background:#354662;color:white;font-weight:700;margin-right:5px}.fa-team-avatar img{width:100%;height:100%;object-fit:cover}.fa-photo-editor{margin:12px 0;padding:12px;border:1px solid #354662;border-radius:10px}.fa-photo-editor input{display:block;max-width:100%;margin:10px 0}.fa-match-pill .fa-team-avatar{margin:0 3px}';document.head.appendChild(style);}
const x=m(id),photo=x?.photo;
  const label=esc((x?.team||'Team').slice(0,1).toUpperCase());
  return `<span class="fa-team-avatar" style="width:${size}px;height:${size}px;font-size:${Math.round(size*.42)}px">${photo?`<img src="${esc(photo)}" alt="${esc(x.team)} team photo">`:label}</span>`;
}
async function uploadTeamPhoto(input){const file=input.files?.[0];if(!file)return;
  if(!['image/jpeg','image/png','image/webp'].includes(file.type)){toast('Choose a JPEG, PNG, or WebP photo');input.value='';return;}
  if(file.size>8*1024*1024){toast('Photo must be under 8 MB');input.value='';return;}
  try{const img=await createImageBitmap(file),canvas=document.createElement('canvas');
    canvas.width=160;canvas.height=160;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#ffffff';ctx.fillRect(0,0,160,160);
    const scale=Math.max(160/img.width,160/img.height);
    ctx.drawImage(img,(160-img.width*scale)/2,(160-img.height*scale)/2,img.width*scale,img.height*scale);
    img.close?.();
    let photo=canvas.toDataURL('image/jpeg',.78);
    if(photo.length>80000)photo=canvas.toDataURL('image/jpeg',.48);
    const result=await apiPost('/api/team-photo',{photo});m(manager).photo=result.photo;render();toast('Team photo updated');
  }catch(e){toast(e.message||'Unable to upload photo');}finally{input.value='';}
}
async function removeTeamPhoto(){if(!confirm('Remove your team photo?'))return;
  try{await apiPost('/api/team-photo',{photo:null});m(manager).photo=null;render();toast('Team photo removed');}
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
async function loadWeeklyDirectory(force=false){
  if(weeklyLoading||(!force&&Date.now()-weeklyLastFetch<60000))return;
  weeklyLoading=true;
  try{
    const response=await fetch('/api/players/weekly',{headers:{Authorization:'Bearer '+token}});
    if(!response.ok)throw Error('Weekly scoring feed unavailable');
    const data=await response.json();
    weeklyDirectory=data.players||{};
    weeklyUpdatedAt=data.updatedAt||null;
    weeklyLastFetch=Date.now();
  }catch(e){weeklyLastFetch=Date.now();console.warn('Weekly player directory:',e.message);}
  finally{weeklyLoading=false;if(tab==='Players')render();}
}
function weeklyCell(x){
  const entry=weeklyDirectory[String(x.id)];
  if(!entry)return {last:null,live:null};
  if(entry.gameStatus==='final')return {last:entry.points,live:null};
  if(entry.gameStatus==='playing')return {last:null,live:entry.points};
  return {last:null,live:null};
}
function sortDirectory(players){
  if(playerSort==='rank')return players;
  return [...players].sort((a,b)=>{
    const value=x=>playerSort==='last'?weeklyCell(x).last:
      playerSort==='live'?weeklyCell(x).live:null;
    const av=value(a),bv=value(b);
    if(av==null&&bv==null)return (a.rank??99999)-(b.rank??99999);
    if(av==null)return 1;if(bv==null)return -1;
    return bv-av;
  });
}
function updatePlayerSort(value){playerSort=value;render();}
async function openPlayerProfile(id){
  profilePlayerId=String(id);profileHistory=null;profileError='';profileLoading=true;
  expandedProfileWeek=null;render();
  try{
    const response=await fetch('/api/players/history?id='+encodeURIComponent(id),
      {headers:{Authorization:'Bearer '+token}});
    const data=await response.json();
    if(!response.ok)throw Error(data.details ? (data.error||'History unavailable')+': '+data.details : (data.error||'History unavailable'));
    if(profilePlayerId===String(id))profileHistory=data;
  }catch(e){if(profilePlayerId===String(id))profileError=e.message;}
  finally{if(profilePlayerId===String(id)){profileLoading=false;render();}}
}
function closePlayerProfile(){profilePlayerId=null;profileHistory=null;expandedProfileWeek=null;render();}
function toggleProfileWeek(week){expandedProfileWeek=expandedProfileWeek===week?null:week;render();}
function playerProfileCard(){
  if(!profilePlayerId)return '';
  const x=espn?.players?.find(p=>String(p.id)===profilePlayerId);
  const h=profileHistory;
  const title=esc(x?.name||h?.player?.name||'Player');
  if(profileLoading)return card(title,`<p>Loading 2026 season history…</p><button onclick="closePlayerProfile()">Close</button>`);
  if(profileError)return card(title,`<p>${esc(profileError)}</p><button onclick='openPlayerProfile(${jsAttr(profilePlayerId)})'>Retry</button> <button onclick="closePlayerProfile()">Close</button>`);
  if(!h)return '';
  const rows=h.weeks.map(w=>{
    const detail=expandedProfileWeek===w.week?`<div style="padding:8px 0">
      ${(w.breakdown||[]).map(r=>`<div class="row"><span>${esc(r.label)} (${esc(r.quantity)} × ${esc(r.rate)})</span><b>${fmt(r.points)}</b></div>`).join('')||'<p class="muted small">No scoring statistics reported.</p>'}
      ${w.unsupported?.length?`<p class="muted small">Not fully verified: ${esc(w.unsupported.join(', '))}</p>`:''}
      </div>`:'';
    return `<div><button type="button" style="width:100%;text-align:left" onclick="toggleProfileWeek(${w.week})">Week ${w.week} · ${esc(w.opponent?'vs '+w.opponent:'Opponent unavailable')} — ${w.status==='final'?fmt(w.points)+'*':esc(w.status)} ${expandedProfileWeek===w.week?'▴':'▾'}</button>${detail}</div>`;
  }).join('');
  return card(title+' — '+esc(h.season)+' season',
    `<p><b>Season points:</b> ${fmt(h.total)}* · <b>Per game:</b> ${h.average==null?'—':fmt(h.average)}* · <b>Games:</b> ${h.gamesPlayed}</p>
    ${rows||'<p>No completed games found for this season.</p>'}
    <p class="muted small">* Provisional totals calculated using current commissioner settings. Some event-level scoring categories are not yet supported. Missing games or unavailable statistics are not counted as zero.</p>
    <button onclick="closePlayerProfile()">Close profile</button>`);
}
function showPlayerBreakdown(id){breakdownPlayerId=String(id);render();}
function hidePlayerBreakdown(){breakdownPlayerId=null;render();}
function breakdownCard(){
  if(!breakdownPlayerId)return '';
  const x=espn?.players?.find(p=>String(p.id)===breakdownPlayerId);
  const d=weeklyDirectory[breakdownPlayerId];
  if(!d)return card('Scoring breakdown','No verified game data for this player.');
  const lines=(d.breakdown||[]).map(r=>`<div class="row"><span>${esc(r.label)} (${esc(r.quantity)} × ${esc(r.rate)})</span><b>${fmt(r.points)}</b></div>`).join('');
  return card('Scoring breakdown — '+esc(x?.name||breakdownPlayerId),
    `<p>Week ${esc(d.week)} · ${esc(d.opponent?'vs '+d.opponent:'Opponent unavailable')} · ${esc(d.gameStatus)} · ${esc(d.gameId)}</p>
    ${lines||'<p>No supported scoring categories reported.</p>'}
    <p><b>Provisional total: ${fmt(d.points)}</b></p>
    <p class="muted small">* Incomplete: long-TD bonuses, kicking distance, D/ST, fumbles and return scores may be missing. This total is not certified.</p>
    <button onclick="hidePlayerBreakdown()">Close</button>`);
}

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
  return espn.players.filter(x=>tab==='Players'||!selected.has(String(x.id)))
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
async function loadTransactions(){
  if(!token||loadingTransactions||draftData().status!=='completed')return;
  lastTransactionFetch=Date.now();
  loadingTransactions=true;
  try{const response=await fetch('/api/transactions/players',{headers:{Authorization:'Bearer '+token}});
    const data=await response.json();if(!response.ok)throw Error(data.error||'Transaction data unavailable');
    transactionData={...data,byId:new Map(data.players.map(x=>[x.id,x]))};transactionError='';
  }catch(e){transactionError=e.message;transactionData=null;}
  finally{loadingTransactions=false;if(tab==='Players'||tab==='My Waivers')render();}
}
async function playerTransaction(id,action){
  const player=espn?.players.find(p=>String(p.id)===String(id));
  if(!player){toast('Player not found in ESPN feed. Refresh the Players tab.');return;}
  if(!state?.settings?.roster){toast('League roster settings unavailable. Refresh the page.');return;}
  const mine=state.players.filter(p=>p.owner===manager);
  const roster=state.settings.roster;
  const active=mine.filter(p=>p.slot!=='IR');
  const full=active.length>=Object.values(roster.starters).reduce((a,b)=>a+b,0)+roster.bench;
  const maxed=active.filter(p=>p.pos===player.position).length>=Number(roster.maximums?.[player.position]??Infinity);
  let dropId=null;
  if(full||maxed){
    const options=mine.filter(p=>p.slot==='BENCH');
    if(!options.length)return toast('Roster full: no eligible bench player to drop.');
    const list=options.map((p,i)=>`${i+1}. ${p.name} (${p.pos})`).join('\n');
    const response=prompt(`Roster full or position limit reached. Select a BENCH player to drop (enter number):\n${list}`);
    if(response===null)return;
    const index=Number(response)-1;
    if(!Number.isInteger(index)||!options[index])return toast('Invalid drop selection');
    dropId=options[index].id;
  }
  if(!confirm(`${action==='claim'?'Submit waiver claim for':'Add'} ${player.name}${dropId?' and drop '+mine.find(p=>p.id===dropId)?.name:''}?`))return;
  try{await apiPost('/api/transactions/'+action,{playerId:String(id),dropId});
    toast(action==='claim'?'Waiver claim submitted — see My Waivers':'Player added to your bench');
    await loadTransactions();
  }catch(e){toast(e.message);}
}
async function dropRosterPlayer(id){
  const player=state.players.find(p=>p.id===id&&p.owner===manager);
  if(!player||!confirm('Drop '+player.name+' from your roster?'))return;
  try{await apiPost('/api/transactions/drop',{playerId:id});toast(player.name+' dropped');
    transactionData=null;lastTransactionFetch=0;
  }catch(e){toast(e.message);}
}
async function cancelWaiver(id){try{await apiPost('/api/transactions/cancel',{playerId:String(id)});
  toast('Waiver claim cancelled');await loadTransactions();}catch(e){toast(e.message);}}
function myWaiversPanel(){
  if(draftData().status!=='completed')return card('My pending waiver claims','<p>Waivers become available after the draft.</p>');
  if(loadingTransactions&&!transactionData)return card('My pending waiver claims','<p>Loading claims…</p>');
  if(transactionError)return card('My pending waiver claims',`<p role="alert">${esc(transactionError)}</p><button onclick="loadTransactions()">Retry</button>`);
  if(!transactionData)return card('My pending waiver claims','<p>Claim status has not loaded yet.</p><button onclick="loadTransactions()">Refresh claims</button>');
  const claims=transactionData.claims||[];
  const rows=claims.map(c=>{
    const id=String(c.playerId||'').replace(/^espn-/,'');
    const player=espn?.players?.find(p=>String(p.id)===id);
    const owned=state?.players?.find(p=>p.id===c.playerId);
    const name=player?.name||owned?.name||'Player #'+id;
    const drop=state?.players?.find(p=>p.id===c.dropId);
    const status=transactionData.byId?.get(id);
    const date=status?.clearsAt?new Date(status.clearsAt):null;
    const due=date&&!isNaN(date.getTime())?date.toLocaleString(): 'Processing time pending';
    return `<div class="row"><div><b>${esc(name)}</b><div class="muted small">Submitted: ${esc(new Date(c.at).toLocaleString())}</div><div class="muted small">${esc(due)}${drop?' · Drop '+esc(drop.name):''}</div></div><button type="button" onclick="cancelWaiver(${jsAttr(id)})">Cancel Claim</button></div>`;
  }).join('');
  return card('My pending waiver claims ('+claims.length+')',
    `<p class="muted small">Claims remain pending until waiver processing. Submission does not guarantee an award.</p>${rows||'<p>No pending waiver claims.</p>'}<button type="button" onclick="refreshMyWaivers()">Refresh claims</button>`);
}
async function refreshMyWaivers(){lastTransactionFetch=0;await loadTransactions();}
function playerTable(){if(!espn)return card('ESPN player data',`<p>${esc(espnError||'Loading ESPN rankings and projections...')}</p>
  <button onclick="loadESPN(true)">Retry ESPN feed</button>`);
  const d=draftData(),turn=currentTurn(),myTurn=d.status==='active'&&turn?.manager===manager;
  const players=sortDirectory(availablePlayers()).slice(0,250);
  const transactionsOpen=tab==='Players'&&d.status==='completed';
  const updated=espn.updatedAt?new Date(espn.updatedAt).toLocaleString():'Not available';
  return card('ESPN player rankings',`<p class="muted small">Season ${esc(espn.season)} · ESPN PPR projections ·
    Updated ${esc(updated)}${espn.stale?' · Cached data':''}</p>
    <div class="actions"><input id="draftSearch" placeholder="Search players" value="${esc(draftSearch)}"
      oninput="updateDraftSearch(this.value)"><select id="draftPosition" onchange="updateDraftPosition(this.value)">
      ${['ALL',...POSITIONS].map(pos=>`<option value="${pos}" ${draftPosition===pos?'selected':''}>${pos}</option>`).join('')}
      </select><select onchange="updatePlayerSort(this.value)">
      ${[['rank','ESPN Rank'],['last','Last Game Points'],['live','Live Points']].map(([v,l])=>
        `<option value="${v}" ${playerSort===v?'selected':''}>${l}</option>`).join('')}
      </select><button onclick="loadESPN(true);loadWeeklyDirectory(true)">Refresh</button></div>
    <p class="muted small">Showing ${players.length} players. Missing ranks and projections show —.</p>
    ${transactionsOpen?(transactionError?`<p>${esc(transactionError)} <button onclick="loadTransactions()">Retry</button></p>`:
      `<p class="muted small">Free agents: Add immediately · Locked: game in progress · Waivers: claim after final. Waiver priority: ${esc((transactionData?.priority||[]).join(' → ')||'Not initialized')}</p>`):''}
    ${playerProfileCard()}${breakdownCard()}<div id="draftPlayerRows">${players.map(x=>{const legal=canDraftPosition(x.position);
      return `<div class="row"><div><b>${x.rank==null?'—':'#'+x.rank} <button type="button" style="border:0;background:transparent;padding:0;text-decoration:underline;font:inherit;color:inherit;cursor:pointer" onclick='openPlayerProfile(${jsAttr(String(x.id))})'>${esc(x.name)}</button></b>
        <div class="muted small">${esc(x.position)} · ESPN ADP ${x.averageDraftPosition==null?'—':fmt(x.averageDraftPosition)}</div>
        ${injuryLabel(x.injuryStatus)}</div><div style="text-align:right"><b>${x.projectedPoints==null?'—':fmt(x.projectedPoints)}</b>
        <div class="muted small">Season projected PPR</div>
        <div class="muted small">Last game: ${weeklyCell(x).last==null?'—':fmt(weeklyCell(x).last)+'*'} ${weeklyDirectory[String(x.id)]?.gameStatus==='final'?'(Wk '+esc(weeklyDirectory[String(x.id)].week)+(weeklyDirectory[String(x.id)].opponent?' vs '+esc(weeklyDirectory[String(x.id)].opponent):'')+')':''}</div>
        ${weeklyDirectory[String(x.id)]?.breakdown?`<button type="button" onclick='showPlayerBreakdown(${jsAttr(String(x.id))})'>Scoring details</button>`:''}
        <div class="muted small">Live: ${weeklyCell(x).live==null?'—':fmt(weeklyCell(x).live)+'*'}</div>
        <div class="muted small">Next game projected: —</div>${myTurn?`<button ${legal?'':'disabled'}
          onclick="selectDraftPlayer('${esc(x.id)}')">${legal?'Draft':'Position locked'}</button>`:''}
        ${transactionsOpen?(()=>{const tx=transactionData?.byId.get(String(x.id));
          if(!tx)return '<span class="muted small">Checking status…</span>';
          if(tx.status==='ROSTERED')return `<span class="muted small">${esc(m(tx.owner)?.team||'Rostered')}</span>`;
          if(tx.status==='LOCKED')return '<span class="muted small">Locked — game in progress</span>';
          const claimed=transactionData.claims?.some(c=>c.playerId==='espn-'+x.id);
          if(tx.status==='WAIVERS')return claimed?
            `<button type="button" onclick="cancelWaiver(${jsAttr(String(x.id))})">Cancel claim</button>`:
            `<button type="button" onclick="playerTransaction(${jsAttr(String(x.id))},'claim').catch(e=>toast(e.message))">Claim Player</button>`;
          return `<button type="button" onclick="playerTransaction(${jsAttr(String(x.id))},'add').catch(e=>toast(e.message))">Add Player</button>`;
        })():''}</div></div>`;}).join('')||'<p>No matching players.</p>'}</div>`);}
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
    ${card('Save commissioner settings',`<p class="muted small">Scoring values are configurable. NFL game status controls free-agent locks and waiver processing.</p>
      <button onclick="saveSettings()">Save league settings${settingsDirty?' *':''}</button>`)}
  `;}
async function saveSettings(){try{const result=await apiPost('/api/settings',{settings:settingsDraft||state.settings});
  settingsDraft=structuredClone(result.settings);settingsDirty=false;toast('Commissioner settings saved');}
  catch(e){toast(e.message);}}
// Local form state survives live SSE refreshes while the manager edits.
let lineupDraft=null;
let lineupDraftSignature='';
let lineupDirty=false;
let lineupSaving=false;
function lineupSlots(){
  const starters=state.settings?.roster?.starters||
    {QB:1,RB:2,WR:2,TE:1,FLEX:1,'D/ST':1,K:1};
  return Object.entries(starters).flatMap(([position,count])=>
    Array.from({length:count},(_,index)=>({key:position+':'+index,position,index})));
}
function currentLineup(mine){
  const result={};
  for(const {key,position,index} of lineupSlots()){
    result[key]=mine.filter(p=>p.slot===position)[index]?.id||null;
  }
  return result;
}
function ensureLineupDraft(mine){
  const current=currentLineup(mine);
  const signature=JSON.stringify(current);
  if(!lineupDraft||(!lineupDirty&&lineupDraftSignature!==signature)){
    lineupDraft=current;
    lineupDraftSignature=signature;
    lineupDirty=false;
  }
}
function updateLineupSelection(key,value){
  if(!lineupDraft)return;
  const id=value||null;
  if(id){
    for(const other of Object.keys(lineupDraft)){
      if(other!==key&&lineupDraft[other]===id)lineupDraft[other]=null;
    }
  }
  lineupDraft[key]=id;
  lineupDirty=true;
  render();
}
function discardLineupChanges(){
  lineupDraft=null;lineupDirty=false;render();
}
async function saveLineup(){
  if(!lineupDraft||lineupSaving)return;
  lineupSaving=true;
  try{
    await apiPost('/api/lineup/save',{lineup:lineupDraft});
    lineupDirty=false;
    lineupDraftSignature=JSON.stringify(lineupDraft);
    toast('Starting lineup saved');
  }catch(e){toast(e.message);}
  finally{lineupSaving=false;render();}
}
function lineupManager(mine){
  ensureLineupDraft(mine);
  const roster=state.settings?.roster||{bench:7,ir:1};
  const rows=lineupSlots().map(({key,position,index})=>{
    const selected=lineupDraft[key];
    const choices=mine.filter(p=>p.slot!=='IR'&&
      (position==='FLEX'?['RB','WR','TE'].includes(p.pos):p.pos===position));
    return `<div class="row"><div><b>${esc(position)} ${index+1}</b></div>
      <select style="max-width:70%;min-width:170px" onchange="updateLineupSelection(${jsAttr(key)},this.value)">
        <option value="" ${!selected?'selected':''}>Empty starting slot</option>
        ${choices.map(p=>`<option value="${esc(p.id)}" ${selected===p.id?'selected':''}>
          ${esc(p.name)} (${esc(p.pos)})</option>`).join('')}
      </select></div>`;
  }).join('');
  const bench=mine.filter(p=>p.slot==='BENCH');
  const ir=mine.filter(p=>p.slot==='IR');
  const benchRows=bench.map(p=>`<div class="row"><span>${esc(p.name)} · ${esc(p.pos)}
    ${injuryLabel(p.injuryStatus)}</span>
    ${['OUT','IR','INJURED_RESERVE','PUP','NFI'].includes(String(p.injuryStatus||'').toUpperCase())?
      `<button onclick="moveToSection(${jsAttr(p.id)},'IR')">Move to IR</button>`:''}
    ${draftData().status==='completed'?`<button onclick="dropRosterPlayer(${jsAttr(p.id)})">Drop</button>`:''}</div>`).join('');
  const irRows=ir.map(p=>`<div class="row"><span>${esc(p.name)} · ${esc(p.pos)}
    ${injuryLabel(p.injuryStatus)}</span>
    <button onclick="moveToSection(${jsAttr(p.id)},'BENCH')">Move to bench</button></div>`).join('');
  return card('Set starting lineup',`<p class="muted small">Choose all your starters, then save once. Selecting a player in a different slot removes their earlier selection. Game locks are enforced by the server.</p>
    ${rows}
    <div class="actions"><button onclick="saveLineup()" ${!lineupDirty||lineupSaving?'disabled':''}>
      ${lineupSaving?'Saving…':'Save Starting Lineup'+(lineupDirty?' *':'')}</button>
      ${lineupDirty?'<button onclick="discardLineupChanges()">Discard changes</button>':''}</div>`)+
    card('Bench ('+bench.length+'/'+roster.bench+')',benchRows||'<p>No bench players.</p>')+
    card('IR ('+ir.length+'/'+roster.ir+')',irRows||'<p>No IR players.</p>');
}
async function moveToSection(playerId,slot){
  try{await apiPost('/api/lineup/assign',{playerId,slot});toast('Roster updated');}
  catch(e){toast(e.message);}
}
const STARTER_ORDER=['QB','RB','RB','WR','WR','TE','FLEX','D/ST','K'];
function selectedMatchupWeek(){return Math.min(14,Math.max(1,matchupWeek??Number(state.scheduleStartWeek||state.nflDirectorySync?.currentWeek||state.week||1)));}
function setMatchupWeek(week){matchupWeek=Math.min(14,Math.max(1,Number(week)||1));matchupIndex=0;render();}
function selectMatchup(index){const games=state.matchupSchedule?.[selectedMatchupWeek()]||[];if(!games.length)return;matchupIndex=(index+games.length)%games.length;render();}
function matchupSwipeStart(e){matchupTouchX=e.touches?.[0]?.clientX??null;}
function matchupSwipeEnd(e){if(matchupTouchX===null)return;const diff=(e.changedTouches?.[0]?.clientX??matchupTouchX)-matchupTouchX;matchupTouchX=null;if(Math.abs(diff)>55)selectMatchup(matchupIndex+(diff<0?1:-1));}
function matchupStarters(id){const starters=state.players.filter(x=>x.owner===id&&!['BENCH','IR'].includes(x.slot));
  const used=new Set();return STARTER_ORDER.map(slot=>{const player=starters.find(x=>!used.has(x.id)&&(x.slot===slot||(slot==='FLEX'&&['FLEX','RB','WR','TE'].includes(x.slot))));if(player)used.add(player.id);return player||null;});}
function matchupPlayerCell(x){if(!x)return '<span class="muted">Empty</span>';
  return `<b>${esc(x.name)}</b><div class="muted small">${esc(x.team||'')} · ${esc(x.status||'')}</div><strong>${fmt(score(x))}</strong>`;}
function matchupView(){const week=selectedMatchupWeek(),games=state.matchupSchedule?.[week]||[];
  if(!games.length){const count=state.managers.filter(x=>x.claimed).length;
    const reason=count<2?'At least two registered teams are required.':state.draft?.status!=='completed'?'Matchups will be generated automatically when the draft finishes.':state.matchupScheduleNotice||(!state.scheduleStartWeek?'Draft completed. Waiting for ESPN to confirm the first eligible NFL week.':week<state.scheduleStartWeek?'Your league begins in NFL Week '+state.scheduleStartWeek+'.': 'No matchup scheduled for this week.');
    return `<h1>Week ${week} Matchups</h1>${card('League matchups',esc(reason))}`;}
  if(matchupIndex>=games.length)matchupIndex=0;
  if(matchupWeek===null){matchupWeek=week;const mine=games.findIndex(g=>g.home===manager||g.away===manager);if(mine>=0)matchupIndex=mine;}
  const game=games[matchupIndex],left=m(game.home),right=m(game.away);
  const byeTeams=state.managers.filter(x=>x.claimed&&!games.some(g=>g.home===x.id||g.away===x.id));
  const current=Number(state.nflDirectorySync?.currentWeek||state.week||1),isCurrent=week===current;
  const recorded=state.weeklyLedger?.[week]?.matchups?.[game.id];
  const leftPlayers=recorded?.homeLineup|| (isCurrent?matchupStarters(game.home):[]),rightPlayers=recorded?.awayLineup||(isCurrent?matchupStarters(game.away):[]);
  const cells=STARTER_ORDER.map((slot,i)=>`<div class="fa-match-row"><div class="fa-player">${leftPlayers[i]?matchupPlayerCell(leftPlayers[i]):'<span class="muted">No saved lineup</span>'}</div><div class="fa-position">${slot}</div><div class="fa-player fa-right">${rightPlayers[i]?matchupPlayerCell(rightPlayers[i]):'<span class="muted">No saved lineup</span>'}</div></div>`).join('');
  return `<style>.fa-week{display:flex;align-items:center;justify-content:center;gap:12px;margin:14px 0}.fa-week select{padding:8px;background:#202d43;color:inherit;border-radius:8px}.fa-match-strip{display:flex;overflow-x:auto;gap:8px;padding:8px 0 16px;scroll-snap-type:x mandatory}.fa-match-pill{flex:0 0 auto;max-width:220px;white-space:normal;scroll-snap-align:center}.fa-match-pill.active{outline:2px solid #66da8c}.fa-head{display:grid;grid-template-columns:minmax(0,1fr) 36px minmax(0,1fr);align-items:center;text-align:center;gap:6px;padding:12px 0}.fa-head b{overflow-wrap:anywhere}.fa-total{font-size:26px;font-weight:700;margin:8px}.fa-match-row{display:grid;grid-template-columns:minmax(0,1fr) 46px minmax(0,1fr);gap:5px;align-items:stretch;border-top:1px solid #384357;min-height:66px}.fa-player{padding:10px 4px;min-width:0;overflow-wrap:anywhere}.fa-player strong{display:block;margin-top:5px}.fa-right{text-align:right}.fa-position{display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:bold;background:#101824}.fa-match-surface{touch-action:pan-y}</style><h1>Week ${week} Matchups</h1><div class="fa-week"><button onclick="setMatchupWeek(${week-1})" ${week===1?'disabled':''}>‹</button><label>Week <select onchange="setMatchupWeek(this.value)">${Array.from({length:14},(_,i)=>`<option value="${i+1}" ${week===i+1?'selected':''}>${i+1}</option>`).join('')}</select></label><button onclick="setMatchupWeek(${week+1})" ${week===14?'disabled':''}>›</button></div>
    <div class="fa-match-strip">${games.map((g,i)=>`<button class="fa-match-pill ${i===matchupIndex?'active':''}" onclick="selectMatchup(${i})">${teamPhoto(g.home,25)} ${esc(m(g.home)?.team||g.home)} vs ${teamPhoto(g.away,25)} ${esc(m(g.away)?.team||g.away)}</button>`).join('')}</div>
    <section class="card fa-match-surface" ontouchstart="matchupSwipeStart(event)" ontouchend="matchupSwipeEnd(event)"><div class="fa-head"><div>${teamPhoto(game.home,58)}<br><b>${esc(left?.team||'Team')}</b><div class="fa-total">${recorded?fmt(recorded.homeScore):'—'}</div></div><span>VS</span><div>${teamPhoto(game.away,58)}<br><b>${esc(right?.team||'Team')}</b><div class="fa-total">${recorded?fmt(recorded.awayScore):'—'}</div></div></div>
    ${byeTeams.length?`<p class="muted small">Bye: ${byeTeams.map(x=>esc(x.team||x.id)).join(', ')}</p>`:''}<p class="muted small">${recorded?(recorded.status==='final'?'Final · verified matchup result':'Provisional · not counted in standings'):'No recorded scores for this week'}</p>${cells}<p class="muted small" style="text-align:center">Swipe left or right to view other matchups</p></section><section class="card"><h3>League standings · verified finals only</h3><div style="overflow-x:auto"><table style="width:100%;text-align:left"><thead><tr><th>Team</th><th>W</th><th>L</th><th>T</th><th>PF</th></tr></thead><tbody>${(state.standings||[]).map(r=>`<tr><td>${esc(m(r.manager)?.team||r.manager)}</td><td>${r.wins}</td><td>${r.losses}</td><td>${r.ties}</td><td>${fmt(r.pointsFor)}</td></tr>`).join('')}</tbody></table></div></section>`;}
function chatComposerFocused(){
  const composer=$('chatInput');
  return !!(composer&&document.activeElement===composer);
}
function refreshChatDisplay(){
  if(tab!=='Locker Room'||chatComposerFocused())return;
  const list=$('chatList');
  if(!list)return;
  // Update the message list without replacing the form or its focused textarea.
  const temporary=document.createElement('div');
  temporary.innerHTML=chatView();
  const nextList=temporary.querySelector('#chatList');
  if(nextList&&list.innerHTML!==nextList.innerHTML){
    const nearBottom=list.scrollHeight-list.scrollTop-list.clientHeight<90;
    list.innerHTML=nextList.innerHTML;
    if(nearBottom)list.scrollTop=list.scrollHeight;
  }
  // Moderation controls can change while the composer remains mounted.
  const oldControls=document.querySelector('#chatModeration');
  const newControls=temporary.querySelector('#chatModeration');
  if(oldControls&&newControls&&oldControls.innerHTML!==newControls.innerHTML)oldControls.innerHTML=newControls.innerHTML;
  const picker=$('tenorPicker');if(picker&&tenorOpen)renderTenorResults();
  const error=$('chatError');if(error)error.textContent=chatError;
  const composer=$('chatForm');
  if(composer&&chatMuted){
    // A new mute must take effect immediately.
    composer.replaceWith(document.createTextNode('You have been muted by the commissioner.'));
  }
}
async function loadChat(){
  if(!token||!state||chatLoading)return;
  chatLoading=true;
  try{const r=await fetch('/api/chat',{headers:{Authorization:'Bearer '+token},cache:'no-store'});
    const d=await r.json();if(!r.ok)throw Error(d.error||'Chat unavailable');
    const wasMuted=chatMuted;
    chatMessages=d.messages||[];chatMuted=!!d.muted;chatMutedManagers=d.mutedManagers||[];
    chatLastId=chatMessages.length?Number(chatMessages[chatMessages.length-1].id):0;
    chatError='';
    if(tab==='Locker Room'){
      chatSeenId=Math.max(chatSeenId,chatLastId);localStorage.setItem('audibleChatSeen',String(chatSeenId));
      if(wasMuted&&!chatMuted){if(!chatComposerFocused())render();}else refreshChatDisplay();
    }else updateChatTabBadge();
  }catch(e){chatError=e.message;if(tab==='Locker Room')refreshChatDisplay();}
  finally{chatLoading=false;}
}
function updateChatTabBadge(){
  if(chatComposerFocused())return;
  const buttons=$('tabs')?.querySelectorAll('button');
  if(!buttons)return;
  for(const button of buttons){if(button.textContent.includes('Locker Room'))button.textContent=chatLastId>chatSeenId?'💬 Locker Room •':'Locker Room';}
}
// Render only HTTPS direct GIF media as images. Ordinary share pages remain links.
function chatBodyHtml(body){
  const value=String(body||'');
  const urlPattern=/https:\/\/[^\s<>"']+/gi;
  let html='',cursor=0,match;
  while((match=urlPattern.exec(value))){
    const raw=match[0],url=raw.replace(/[),.!?;]+$/,'');
    html+=esc(value.slice(cursor,match.index));
    let parsed=null;
    try{parsed=new URL(url);}catch(e){}
    if(parsed&&parsed.protocol==='https:'){
      const host=parsed.hostname.toLowerCase();
      const direct=/\.gif$/i.test(parsed.pathname);
      const trustedGiphy=(host==='media.giphy.com'||/^media[0-9]+\.giphy\.com$/.test(host))&&/\.(gif|webp)$/i.test(parsed.pathname);
      const trustedTenor=(host==='media.tenor.com'||host==='c.tenor.com')&&/\.(gif|webp)$/i.test(parsed.pathname);
      const safe=esc(url);
      html+=`<a href="${safe}" target="_blank" rel="noopener noreferrer">${safe}</a>`;
      if(direct||trustedGiphy||trustedTenor)html+=`<div><img class="fa-chat-gif" src="${safe}" alt="Shared GIF" loading="lazy" referrerpolicy="no-referrer"></div>`;
    }else html+=esc(url);
    cursor=match.index+raw.length;
    html+=esc(raw.slice(url.length));
  }
  return html+esc(value.slice(cursor));
}
function chatView(){
  const messages=chatMessages.map(x=>{
    const team=m(x.manager)?.team||'Former manager';
    return `<div class="fa-chat-msg"><div class="fa-chat-head">${teamPhoto(x.manager,30)} <b>${esc(team)}</b> <span class="muted small">${esc(new Date(x.created_at).toLocaleString())}</span>
    ${state.viewer.commissioner?`<button class="fa-chat-small" onclick="deleteChatMessage(${Number(x.id)})">Delete</button>`:''}</div>
    <div class="fa-chat-body">${chatBodyHtml(x.body)}${x.has_media?`<div><img class="fa-chat-gif" src="/api/chat/media?id=${Number(x.id)}&token=${encodeURIComponent(token)}" alt="Animated GIF" loading="lazy"></div>`:''}</div></div>`;
  }).join('')||'<p class="muted">No messages yet. Start the trash talk!</p>';
  const controls=state.viewer.commissioner?`<section class="card"><h3>Commissioner moderation</h3>
    ${state.managers.filter(x=>x.claimed&&x.id!==manager).map(x=>`<div class="row"><span>${esc(x.team)}</span>
    <button onclick='muteChatManager(${jsAttr(x.id)},${!chatMutedManagers.includes(x.id)})'>${chatMutedManagers.includes(x.id)?'Unmute':'Mute'}</button></div>`).join('')}</section>`:'';
  return `<h1>League Locker Room</h1><p class="muted small">Private league chat · Team names shown · Messages saved</p>
    <section class="card"><div class="fa-chat-list" id="chatList">${messages}</div>
    <p id="chatError" class="muted">${esc(chatError)}</p>
    ${chatMuted?'<p>You have been muted by the commissioner.</p>':`<form id="chatForm" onsubmit="sendChatMessage(event)">
      <textarea id="chatInput" maxlength="1000" rows="2" placeholder="Talk some trash..." oninput="chatDraft=this.value" onblur="setTimeout(()=>{refreshChatDisplay();updateChatTabBadge()},0)">${esc(chatDraft)}</textarea>
      <button type="button" onclick="toggleTenorPicker()">GIF</button>
      <button type="submit">Send message</button></form><div id="tenorPicker" class="fa-tenor-picker" style="display:${tenorOpen?'block':'none'}"><div class="fa-tenor-search"><input id="tenorSearch" type="search" placeholder="Search Tenor GIFs" maxlength="80" value="${esc(tenorQuery)}" onkeydown="if(event.key==='Enter'){event.preventDefault();searchTenor()}"><button type="button" onclick="searchTenor()">Search</button><button type="button" onclick="toggleTenorPicker()">Close</button></div><div id="tenorResults" class="fa-tenor-grid"></div><p class="muted small">GIFs powered by Tenor</p></div>`}</section><div id="chatModeration">${controls}</div>`;
}
function toggleTenorPicker(){
  tenorOpen=!tenorOpen;
  const picker=$('tenorPicker');if(!picker)return;
  picker.style.display=tenorOpen?'block':'none';
  if(tenorOpen){renderTenorResults();if(!tenorResults.length)searchTenor();}
}
function renderTenorResults(){
  const grid=$('tenorResults');if(!grid)return;
  if(tenorBusy){grid.textContent='Loading GIFs…';return;}
  if(tenorError){grid.textContent=tenorError;return;}
  if(!tenorResults.length){grid.textContent='No GIFs found.';return;}
  grid.replaceChildren();
  for(const result of tenorResults){
    const button=document.createElement('button');button.type='button';button.className='fa-tenor-item';
    button.title=result.title||'Send GIF';
    const img=document.createElement('img');img.src=result.preview;img.alt=result.title||'GIF';img.loading='lazy';
    button.appendChild(img);button.addEventListener('click',()=>sendTenorGif(result.url));grid.appendChild(button);
  }
}
async function searchTenor(){
  tenorQuery=$('tenorSearch')?.value.trim()||'';
  const request=++tenorRequest;tenorBusy=true;tenorError='';renderTenorResults();
  try{
    const r=await fetch('/api/chat/tenor?q='+encodeURIComponent(tenorQuery),{
      headers:{Authorization:'Bearer '+token},cache:'no-store'});
    const d=await r.json();if(!r.ok)throw Error(d.error||'GIF search unavailable');
    if(request===tenorRequest)tenorResults=d.results||[];
  }catch(e){if(request===tenorRequest)tenorError=e.message;}
  finally{if(request===tenorRequest){tenorBusy=false;renderTenorResults();}}
}
async function sendTenorGif(url){
  if(!/^https:\/\/(media|c)\.tenor\.com\//i.test(url))return;
  const caption=$('chatInput')?.value.trim()||'';
  const message=(caption?caption+'\n':'')+url;
  if(message.length>1000){toast('Message is too long');return;}
  try{
    await apiPost('/api/chat',{message});
    chatDraft='';const input=$('chatInput');if(input)input.value='';
    tenorOpen=false;const picker=$('tenorPicker');if(picker)picker.style.display='none';
    await loadChat();
  }catch(e){toast(e.message);}
}
async function sendChatMessage(event){event.preventDefault();const value=$('chatInput')?.value.trim()||'';
  if(!value)return;
  const sendButton=$('chatForm')?.querySelector('button[type="submit"]');if(sendButton)sendButton.disabled=true;
  try{
    await apiPost('/api/chat',{message:value});
    chatDraft='';const input=$('chatInput');if(input)input.value='';await loadChat();
  }catch(e){toast(e.message);}finally{if(sendButton)sendButton.disabled=false;}
}
async function deleteChatMessage(id){if(!confirm('Delete this message?'))return;
  try{await apiPost('/api/chat/delete',{id});await loadChat();}catch(e){toast(e.message);}}
async function muteChatManager(id,muted){
  try{await apiPost('/api/chat/mute',{manager:id,muted});await loadChat();}catch(e){toast(e.message);}}
function render(){if(!state||!manager)return;const mine=state.players.filter(x=>x.owner===manager),myTeam=m(manager);
  if(!myTeam)return;
  $('tabs').innerHTML=tabs.filter(t=>t!=='Commissioner'||state.viewer.commissioner)
    .map(t=>`<button class="${tab===t?'active':''}" onclick="changeTab('${t}')">${t==='Locker Room'&&chatLastId>chatSeenId?'💬 '+t+' •':t}</button>`).join('');
  let content='';
  if(tab==='Home')content=`<h1>${esc(state.league)}</h1><p>Week ${state.week} · ${esc(myTeam.team)}</p>
    <div class="grid">${card('Your score',`<div class="stat">${fmt(total(manager))}</div>`)}
    ${card('Registered teams',`<div class="stat">${state.managers.filter(x=>x.claimed).length} / 12</div>`)}
    ${card('Draft status',`<p>${esc(draftData().status)}</p><button onclick="changeTab('Draft')">Open draft room</button>`)}</div>
    ${state.injuries.filter(i=>i.active).map(injuryCard).join('')}
    ${card('Recent activity',state.transactions.slice(0,8).map(t=>`<div class="row"><span>${esc(t.details)}</span></div>`).join('')||'<p>No activity yet.</p>')}`;
  if(tab==='My Team'){const picks=draftData().picks.filter(x=>x.manager===manager);
    content=`<h1>${teamPhoto(manager,64)} ${esc(myTeam.team)}</h1><button onclick="renameTeam()">Rename My Team</button><div class="fa-photo-editor"><label for="teamPhotoUpload">Team profile photo</label><input id="teamPhotoUpload" type="file" accept="image/jpeg,image/png,image/webp" onchange="uploadTeamPhoto(this)"><button onclick="removeTeamPhoto()" ${myTeam.photo?'':'disabled'}>Remove photo</button><p class="muted small">Images are cropped to a square and resized automatically.</p></div>
      ${card('Drafted players',picks.map(x=>`<div class="row"><div><b>${esc(x.playerName)}</b>
      <div class="muted small">${esc(x.position)} · Pick ${x.overall}</div></div>
      <b>${x.projectedPoints==null?'—':fmt(x.projectedPoints)}</b></div>`).join('')||'<p>No draft picks yet.</p>')}
      ${state.injuries.filter(i=>i.active).map(injuryCard).join('')}
      ${lineupManager(mine)}`;}
  if(tab==='Matchup')content=matchupView();
  if(tab==='League')content=`<h1>League</h1>${card('Teams',state.managers.filter(x=>x.claimed).map(x=>
    `<div class="row"><b>${teamPhoto(x.id,36)} ${esc(x.team)}</b><span>${fmt(total(x.id))} pts</span></div>`).join(''))}
    ${card('League roster rules',state.settings?`<p>Starters: ${Object.entries(state.settings.roster.starters).map(([k,v])=>`${k} ${v}`).join(' · ')}</p>
      <p>Bench: ${state.settings.roster.bench} · IR: ${state.settings.roster.ir}</p>`:'<p>Not yet configured.</p>')}`;
  if((tab==='Players'||tab==='My Waivers')&&Date.now()-lastTransactionFetch>90000)loadTransactions();
  if(tab==='Players')content=`<h1>ESPN Player Directory</h1>${myWaiversPanel()}${playerTable()}`;
  if(tab==='My Waivers')content=`<h1>My Waivers</h1>${myWaiversPanel()}`;
  if(tab==='Draft')content=renderDraft();
  if(tab==='Locker Room')content=chatView();
  if(tab==='Notifications')content=`<h1>Notifications</h1>${card('Injury alerts',state.injuries.map(i=>
    `<div class="row"><b>${esc(p(i.player)?.name||'Player')}</b><span>${i.active?'Pending':'Resolved'}</span></div>`).join('')||'<p>No alerts.</p>')}
    ${card('Transactions',state.transactions.slice(0,50).map(t=>`<div class="row">${esc(t.details)}</div>`).join('')||'<p>No transactions.</p>')}`;
  if(tab==='Commissioner'&&state.viewer.commissioner)content=`<h1>Commissioner Controls</h1>
    ${card('Draft management','<p>Manage the snake draft.</p><button onclick="changeTab(\'Draft\')">Open draft controls</button>')}
    ${card('Restart league',`<p><b>Destructive action:</b> clear the current draft order, all picks, draft history, drafted rosters, and injuries. Keep manager accounts, team names, commissioner scoring/roster rules, and each manager's draft preferences.</p>
      <p>The next draft will use your configured roster size (16 rounds by default).</p>
      <button onclick="restartLeague()" style="background:#a32121;color:white">Restart league / New draft</button>`)}
    ${leagueMembersUI()}
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
  updateDraftClock();
  if(tab==='Locker Room'){const list=$('chatList');if(list)list.scrollTop=list.scrollHeight;}
}
async function manageLeagueMember(managerId,terminate){
  const team=state.managers.find(m=>m.id===managerId);
  if(!team||managerId===manager)return;
  const phrase=terminate?'TERMINATE ROSTER':'REMOVE MANAGER';
  const explanation=terminate
    ?'PERMANENT: remove '+team.team+' from the active league and release its entire roster to waivers. Historical draft records remain.'
    :'Remove the registered manager from '+team.team+' while preserving the team, lineup, and roster for a replacement.';
  const typed=prompt(explanation+'\n\nType '+phrase+' to continue:');
  if(typed===null)return;
  if(typed!==phrase){toast('Confirmation phrase did not match');return;}
  if(!confirm('Final confirmation: '+(terminate?'TERMINATE roster':'REMOVE manager')+' for '+team.team+'?'))return;
  try{
    const result=await apiPost(terminate?'/api/league/member/terminate':'/api/league/member/remove',
      {managerId,confirmation:phrase});
    toast(result.action==='terminated'?'Roster terminated; '+result.playersReleased+' players released':'Manager removed; team preserved');
  }catch(e){toast(e.message);}
}
function leagueMembersUI(){
  const rows=state.managers.filter(x=>x.id!==manager).map(x=>{
    const status=x.claimed?'Manager registered':'Vacant team — available for replacement';
    return `<div class="row"><div><b>${esc(x.team)}</b><div class="muted small">${esc(status)}</div><div class="muted small">Registered email: ${x.registeredEmail?esc(x.registeredEmail):'Not provided'}</div></div>
      <div class="actions">${x.claimed?`<button onclick='manageLeagueMember(${jsAttr(x.id)},false)'>Remove Manager</button>`:''}
      <button style="background:#a32121;color:white" onclick='manageLeagueMember(${jsAttr(x.id)},true)'>Terminate Roster</button></div></div>`;
  }).join('');
  return card('League Members',`<p class="muted small">Remove Manager revokes access but keeps the roster for a replacement. Terminate Roster removes the team and places its players on waivers. Both actions require two confirmations.</p>${rows||'<p>No other teams.</p>'}`);
}
function changeTab(next){if(next==='Matchup'&&tab!=='Matchup'){matchupWeek=null;matchupIndex=0;}tab=next;render();if(tab==='Draft')syncServerClock();
  if(tab==='Draft'||tab==='Players')loadESPN();
  if(tab==='Players')loadWeeklyDirectory();
  if(tab==='Players'||tab==='My Waivers')loadTransactions();
  if(tab==='Locker Room')loadChat();}
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
  if(!response.ok)throw Error('Server unavailable');state=await response.json();manager=state.viewer.manager;render();loadChat();}
  catch(e){$('connection').textContent='● Offline';return;}
  await syncServerClock();const events=new EventSource('/api/events?token='+encodeURIComponent(token));
  let previousPickCount=state.draft?.picks?.length??0,previousDeadline=state.draft?.deadline??null,
    previousStatus=state.draft?.status??null;
  events.onmessage=e=>{const next=JSON.parse(e.data),count=next.draft?.picks?.length??0,
    deadline=next.draft?.deadline??null,status=next.draft?.status??null;
    const changed=count!==previousPickCount||deadline!==previousDeadline||status!==previousStatus;
    previousPickCount=count;previousDeadline=deadline;previousStatus=status;
    state=next;manager=state.viewer.manager;$('connection').textContent='● Live synced';if(tab==='Locker Room'){refreshChatDisplay();updateChatTabBadge();}else render();
    if(changed)syncServerClock();};
  events.onerror=()=>{$('connection').textContent='● Reconnecting…';};}
setInterval(updateDraftClock,500);
setInterval(()=>{if(token&&state&&!document.hidden&&!chatComposerFocused())loadChat();},8000);
setInterval(()=>{if(token&&state&&Date.now()-lastClockSync>30000)syncServerClock();},5000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&token&&state)syncServerClock();});
connect();

// Team photo styles are injected once for all tabs.
