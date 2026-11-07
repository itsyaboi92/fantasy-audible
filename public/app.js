let state=null,manager=null,tab=new URLSearchParams(location.search).get('tab')==='Notifications'?'Notifications':'Home',token=localStorage.getItem('audibleToken');
let chatMessages=[],chatMuted=false,chatMutedManagers=[],chatLastId=0,chatSeenId=Number(localStorage.getItem('audibleChatSeen')||0),chatLoading=false,chatError='',chatDraft='',chatPendingGif=null,giphyOpen=false,giphyResults=[],giphyQuery='',giphyError='',giphyBusy=false,giphyRequest=0;
let matchupWeek=null,matchupIndex=0,matchupTouchX=null;
let viewedLeagueTeamId=null;
let espn=null,espnError='',draftSearch='',draftPosition='ALL',loadingESPN=false;
let weeklyDirectory={},weeklyUpdatedAt=null,weeklyLoading=false,weeklyLastFetch=0;
let playerSort='rank';
let playerAvailability='all';
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
async function enablePush(){
  try{
    if(!('serviceWorker' in navigator)||!('PushManager' in window)||!('Notification' in window))
      throw Error('This browser does not support Web Push. On iPhone, install Fantasy Audible to your Home Screen.');
    const config=await fetch('/api/push/config',{headers:{Authorization:'Bearer '+token}}).then(r=>r.json());
    if(!config.enabled)throw Error('Server push keys are not configured yet.');
    const permission=await Notification.requestPermission();
    if(permission!=='granted')throw Error('Notification permission was not granted.');
    const registration=await navigator.serviceWorker.register('/sw.js');
    const key=Uint8Array.from(atob(config.publicKey.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
    let subscription=await registration.pushManager.getSubscription();
    if(!subscription)subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key});
    await apiPost('/api/push/subscribe',{subscription:subscription.toJSON()});
    toast('Injury push notifications enabled');
  }catch(e){toast(e.message);}
}
async function testPush(){try{await apiPost('/api/push/test',{});toast('Test notification sent');}
  catch(e){toast(e.message);}}
async function disablePush(){try{const registration=await navigator.serviceWorker.ready;
  const subscription=await registration.pushManager.getSubscription();
  if(subscription){await apiPost('/api/push/unsubscribe',{endpoint:subscription.endpoint});await subscription.unsubscribe();}
  toast('Push notifications disabled');}catch(e){toast(e.message);}}
function toast(message){const el=$('toast');if(!el)return;el.textContent=message;el.style.display='block';
  setTimeout(()=>el.style.display='none',3500);}
function playerRow(x){return `<div class="row"><div><b>${esc(x.name)}</b><div class="muted small">
  ${esc(x.team)} · ${esc(x.pos)} · ${esc(x.slot)} · ${esc(x.status)}</div></div><b>${fmt(score(x))}</b></div>`;}
async function apiPost(route,body){const response=await fetch(route,{method:'POST',headers:{
  'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(body)});
  const result=await response.json();if(!response.ok)throw Error(result.error||'Request failed');return result;}
async function act(route,body){if(route==='/api/substitute'&&!confirm('This substitution is permanent for this NFL week. Removed players cannot return, and their points are forfeited. Continue?'))return;
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
  const choices=state.players.filter(x=>x.owner===manager&&x.slot==='BENCH'&&x.pos===starter.pos&&!(state.injurySwapHistory||[]).some(h=>h.week===state.week&&h.removedId===x.id))
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
  finally{weeklyLoading=false;if(tab==='Players'||tab==='My Team')render();}
}
function playerNextProjection(x){
  const season=Number(state?.nflDirectorySync?.season||new Date().getFullYear());
  const week=Math.min(18,Math.max(1,Number(state?.nflDirectorySync?.currentWeek||state?.week||selectedMatchupWeek())));
  const key=season+':'+week;
  const metadata=nflPlayerMetaCache[key]?.data?.players?.[String(x.id)];
  const game=nflMatchupCache[key]?.data?.teams?.[String(metadata?.teamId||x.nflTeamId||'')];
  if(!game||game.status==='final')return null;
  const value=metadata?.weeklyProjectedPoints;
  return value==null||!Number.isFinite(Number(value))?null:Number(value);
}
function weeklyCell(x){
  const entry=weeklyDirectory[String(x.id)];
  if(!entry)return {last:null,live:null};
  if(entry.gameStatus==='final')return {last:entry.points,live:null};
  if(entry.gameStatus==='playing')return {last:null,live:entry.points};
  return {last:null,live:null};
}
function directoryOwnership(x){
  const id=String(x.id);
  const tx=transactionData?.byId?.get(id);
  if(tx?.status==='ROSTERED')return true;
  if(tx&&['FREE_AGENT','LOCKED','WAIVERS'].includes(tx.status))return false;
  return (state?.players||[]).some(p=>String(p.espnId||String(p.id).replace(/^espn-/,''))===id&&p.owner);
}
function sortDirectory(players){
  const filtered=tab==='Players'&&playerAvailability!=='all'
    ?players.filter(x=>directoryOwnership(x)===(playerAvailability==='rostered')):players;
  if(playerSort==='rank')return filtered;
  return [...filtered].sort((a,b)=>{
    const value=x=>playerSort==='next'?playerNextProjection(x):
      playerSort==='last'?weeklyCell(x).last:
      playerSort==='live'?weeklyCell(x).live:null;
    const av=value(a),bv=value(b);
    if(av==null&&bv==null)return (a.rank??99999)-(b.rank??99999);
    if(av==null)return 1;if(bv==null)return -1;
    return bv-av||((a.rank??99999)-(b.rank??99999));
  });
}
function updatePlayerSort(value){playerSort=value;render();}
function updatePlayerAvailability(value){playerAvailability=value;render();}
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
function defenseStatTable(stats){
  if(!stats)return '';
  const labels={sack:'Sacks',interception:'Interceptions',forcedFumble:'Forced fumbles',fumbleRecovered:'Fumble recoveries',safety:'Safeties',blockedKick:'Blocked kicks',interceptionTD:'Interception return TDs',fumbleReturnTD:'Fumble return TDs',puntReturnTD:'Punt return TDs',kickoffReturnTD:'Kickoff return TDs',blockedKickReturnTD:'Blocked kick return TDs',twoPointReturn:'Two-point returns',onePointSafety:'One-point safeties',pointsAllowed:'Points allowed',yardsAllowed:'Offensive yards allowed'};
  return `<section class="fa31-group"><h3>Actual D/ST statistics</h3>${Object.entries(labels).map(([k,label])=>{const x=stats[k],v=x?.value;return `<div class="fa31-stat"><span>${esc(label)}</span><b>${v===null||v===undefined?'—':esc(v)}${x?.verified?' ✓':''}</b></div>`;}).join('')}<p class="muted small">✓ Verified against final totals. — Data unavailable, not zero. D/ST statistics are sourced from ESPN box scores only.</p></section>`;
}
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
      ${defenseStatTable(w.statDetails)}
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
      </select>${tab==='Players'?`<select aria-label="Player availability" onchange="updatePlayerAvailability(this.value)">
      ${[['all','All Players'],['available','Available / Unrostered'],['rostered','On Rosters']].map(([v,l])=>
        `<option value="${v}" ${playerAvailability===v?'selected':''}>${l}</option>`).join('')}
      </select>`:''}<select aria-label="Sort players" onchange="updatePlayerSort(this.value)">
      ${[['rank','ESPN Rank'],['next','Next Game Projected'],['last','Last Game Points'],['live','Live Points']].map(([v,l])=>
        `<option value="${v}" ${playerSort===v?'selected':''}>${l}</option>`).join('')}
      </select><button onclick="loadESPN(true);loadWeeklyDirectory(true)">Refresh</button></div>
    <p class="muted small">Showing ${players.length} players. Missing ranks and projections show —.</p>
    ${transactionsOpen?(transactionError?`<p>${esc(transactionError)} <button onclick="loadTransactions()">Retry</button></p>`:
      `<p class="muted small">Free agents: Add immediately · Locked: game in progress · Waivers: claim after final. Waiver priority: ${esc((transactionData?.priority||[]).join(' → ')||'Not initialized')}</p>`):''}
    ${playerProfileCard()}${breakdownCard()}<div id="draftPlayerRows">${players.map(x=>{const legal=canDraftPosition(x.position);
      return `<div class="row"><div><b>${x.rank==null?'—':'#'+x.rank} <button type="button" style="border:0;background:transparent;padding:0;text-decoration:underline;font:inherit;color:inherit;cursor:pointer" onclick='openPlayerProfile(${jsAttr(String(x.id))})'>${esc(x.name)}</button></b>
        <div class="muted small">${esc(x.position)} · ESPN ADP ${x.averageDraftPosition==null?'—':fmt(x.averageDraftPosition)}</div>
        ${x.position==='D/ST'?'':injuryLabel(x.injuryStatus)}</div><div style="text-align:right"><b>${x.projectedPoints==null?'—':fmt(x.projectedPoints)}</b>
        <div class="muted small">Season projected PPR</div>
        <div class="muted small">Last game: ${weeklyCell(x).last==null?'—':fmt(weeklyCell(x).last)+'*'} ${weeklyDirectory[String(x.id)]?.gameStatus==='final'?'(Wk '+esc(weeklyDirectory[String(x.id)].week)+(weeklyDirectory[String(x.id)].opponent?' vs '+esc(weeklyDirectory[String(x.id)].opponent):'')+')':''}</div>
        ${weeklyDirectory[String(x.id)]?.breakdown?`<button type="button" onclick='showPlayerBreakdown(${jsAttr(String(x.id))})'>Scoring details</button>`:''}
        <div class="muted small">Live: ${weeklyCell(x).live==null?'—':fmt(weeklyCell(x).live)+'*'}</div>
        <div class="muted small">Next game projected: ${(()=>{const info=playerNextProjection(x);return info===null?'—':fmt(info)+' est.';})()}</div>${myTurn?`<button ${legal?'':'disabled'}
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
async function saveDraftSequence(order,randomize=false){
  try{await apiPost('/api/draft/order',randomize?{randomize:true}:{order});await syncServerClock();
    toast(randomize?'Draft order randomized':'Draft order saved');}
  catch(e){toast(e.message);}
}
function moveDraftTeam(index,direction){
  const ids=draftSequenceForUI();const target=index+direction;
  if(target<0||target>=ids.length)return;
  [ids[index],ids[target]]=[ids[target],ids[index]];
  saveDraftSequence(ids);
}
function draftSequenceForUI(){
  const registered=state.managers.filter(x=>x.claimed).map(x=>x.id);
  const chosen=draftData().draftSequence;
  return Array.isArray(chosen)&&chosen.length===registered.length&&
    new Set(chosen).size===registered.length&&chosen.every(id=>registered.includes(id))
    ?[...chosen]:registered;
}
function commissionerDraftOrderUI(){
  if(!state.viewer.commissioner)return '';
  const d=draftData(),ids=draftSequenceForUI(),waiting=d.status==='waiting';
  return card('Commissioner draft order',`<p class="muted small">First-round selection order. Snake rounds automatically reverse the sequence every other round. ${waiting?'Move teams or randomize before starting.':'Locked because the draft has started.'}</p>
    ${ids.map((id,i)=>`<div class="row"><span><b>#${i+1}</b> ${esc(m(id)?.team||id)}</span>
      ${waiting?`<span><button type="button" onclick="moveDraftTeam(${i},-1)" ${i===0?'disabled':''} aria-label="Move team up">↑</button>
      <button type="button" onclick="moveDraftTeam(${i},1)" ${i===ids.length-1?'disabled':''} aria-label="Move team down">↓</button></span>`:''}</div>`).join('')||'<p>No registered teams yet.</p>'}
    ${waiting?`<button type="button" onclick="if(confirm('Randomize the first-round draft order?'))saveDraftSequence([],true)" ${ids.length<2?'disabled':''}>🎲 Randomize order</button>`:''}`);
}
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
    ${commissionerDraftOrderUI()}${draftPreferencesUI()}${draftBoard()}${playerTable()}${draftHistory()}`;}
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
// v21: Optimize the whole lineup (including FLEX) with slot-mask dynamic programming.
// No roster changes occur until the manager confirms and saves the preview.
function optimizeProjectedLineup(){
  const mine=state.players.filter(p=>p.owner===manager);
  ensureLineupDraft(mine);
  const slots=lineupSlots();
  if(slots.length>20){toast('Too many starting slots for lineup optimization');return;}
  const season=Number(state?.nflDirectorySync?.season||new Date().getFullYear());
  const week=Math.min(18,Math.max(1,Number(state?.nflDirectorySync?.currentWeek||state?.week||1)));
  const key=season+':'+week;
  const metadata=nflPlayerMetaCache[key]?.data?.players;
  if(!metadata){toast('Matchup projections are still loading. Try again shortly.');fetchNFLMatchups(week);return;}
  const eligible=(player,position)=>position==='FLEX'?['RB','WR','TE'].includes(player.pos):player.pos===position;
  const playerProjection=player=>{
    const espnId=String(player.espnId||String(player.id||'').replace(/^espn-/,''));
    const value=metadata[espnId]?.weeklyProjectedPoints;
    return value==null||!Number.isFinite(Number(value))?null:Math.max(0,Number(value));
  };
  // Preserve each existing locked starter in the exact slot; a bench player
  // whose game started cannot be moved into the starting lineup.
  const fixed={};const fixedIds=new Set();
  for(const slot of slots){
    const id=currentLineup(mine)[slot.key];
    const player=mine.find(p=>p.id===id);
    if(player&&(player.scoringMode||player.scoreAtSwap!==undefined||
      state.injuries?.some(i=>i.active&&i.player===player.id)||playerGameLocked(player))){
      fixed[slot.key]=player.id;fixedIds.add(player.id);
    }
  }
  const available=mine.filter(p=>p.slot!=='IR'&&!fixedIds.has(p.id)&&!playerGameLocked(p)&&
    !p.scoringMode&&p.scoreAtSwap===undefined&&!state.injuries?.some(i=>i.active&&i.player===p.id)&&
    !['OUT','IR','INJURED_RESERVE','PUP','NFI'].includes(String(p.injuryStatus||'').toUpperCase())&&
    playerProjection(p)!==null);
  const open=slots.filter(slot=>!(slot.key in fixed));
  // DP assigns at most one slot to each player, maximizing the global total.
  let dp=new Map([[0,{score:0,assign:{}}]]);
  for(const player of available){
    const next=new Map(dp);const projected=playerProjection(player);
    for(const [mask,entry] of dp){
      for(let i=0;i<open.length;i++){
        if(mask&(1<<i)||!eligible(player,open[i].position))continue;
        const newMask=mask|(1<<i),newScore=entry.score+projected;
        if(!next.has(newMask)||newScore>next.get(newMask).score+1e-8)
          next.set(newMask,{score:newScore,assign:{...entry.assign,[open[i].key]:player.id}});
      }
    }
    dp=next;
  }
  // Prefer filling every possible slot, then maximize projected points.
  let best=null,bestCount=-1;
  for(const [mask,entry] of dp){
    const count=mask.toString(2).replace(/0/g,'').length;
    if(count>bestCount||(count===bestCount&&(!best||entry.score>best.score))){best=entry;bestCount=count;}
  }
  const proposed=Object.fromEntries(slots.map(slot=>[slot.key,fixed[slot.key]||best?.assign[slot.key]||null]));
  const total=lineup=>Object.values(lineup).reduce((sum,id)=>sum+(id?playerProjection(mine.find(p=>p.id===id)||{})||0:0),0);
  const before=total(lineupDraft),after=total(proposed);
  const changes=slots.filter(slot=>lineupDraft[slot.key]!==proposed[slot.key]).map(slot=>{
    const from=mine.find(p=>p.id===lineupDraft[slot.key]);
    const to=mine.find(p=>p.id===proposed[slot.key]);
    return `${slot.position} ${slot.index+1}: ${from?.name||'Empty'} → ${to?.name||'Empty'}`;
  });
  if(!changes.length){toast('Your starting lineup is already optimized for available projections.');return;}
  const message=`Current projected: ${fmt(before)} pts\nOptimized projected: ${fmt(after)} pts\nChange: ${after>=before?'+':''}${fmt(after-before)} pts\n\n${changes.join('\n')}\n\nPreview these changes? You will still need to select Save Starting Lineup.`;
  if(!confirm(message))return;
  lineupDraft=proposed;lineupDirty=true;render();
  toast('Optimized lineup preview ready. Save to apply.');
}
function playerGameLocked(player){
  if(player.espnId||player.nflGame){
    const season=Number(state?.nflDirectorySync?.season||new Date().getFullYear());
    const week=Math.min(18,Math.max(1,Number(state?.nflDirectorySync?.currentWeek||state?.week||1)));
    const key=season+':'+week;
    const espnId=String(player.espnId||String(player.id||'').replace(/^espn-/,''));
    const meta=nflPlayerMetaCache[key]?.data?.players?.[espnId];
    const team=String(meta?.teamId||player.nflTeamId||player.team||'').toUpperCase();
    const teamId=/^\d+$/.test(team)?team:NFL_TEAM_IDS[team];
    const weeklyGames=nflMatchupCache[key]?.data?.teams||{};
    const game=weeklyGames[teamId];
    // Once a complete week is loaded, an unscheduled team is on bye.
    if(!game&&teamId&&Object.keys(weeklyGames).length>=20)return false;
    if(game?.kickoff&&Number.isFinite(Date.parse(game.kickoff)))return Date.now()>=Date.parse(game.kickoff);
    const synced=state?.nflSync;
    if(Number(synced?.week)===week){
      const stored=synced.games?.find(g=>g.teams?.some(t=>String(t.id)===String(teamId)));
      if(stored?.kickoff&&Number.isFinite(Date.parse(stored.kickoff)))return Date.now()>=Date.parse(stored.kickoff);
      if(player.nflGame?.kickoff&&Number.isFinite(Date.parse(player.nflGame.kickoff)))return Date.now()>=Date.parse(player.nflGame.kickoff);
    }
    return true; // Cannot safely verify an individual kickoff yet.
  }
  if(['playing','injured','finished','final','completed'].includes(String(player.status||'').toLowerCase()))return true;
  if(player.kickoffAt&&Number.isFinite(Date.parse(player.kickoffAt))&&Date.parse(player.kickoffAt)<=Date.now())return true;
  return typeof player.kickoff==='number'&&player.kickoff!==99&&player.kickoff<=state.phase;
}
function rosterMatchupDetails(p){
  const season=Number(state?.nflDirectorySync?.season||new Date().getFullYear());
  const week=Math.min(18,Math.max(1,Number(state?.nflDirectorySync?.currentWeek||state?.week||1)));
  const key=season+':'+week;
  const espnId=String(p.espnId||String(p.id||'').replace(/^espn-/,''));
  const meta=nflPlayerMetaCache[key]?.data?.players?.[espnId];
  const team=String(meta?.teamId||p.nflTeamId||p.team||'').toUpperCase();
  const teamId=/^\d+$/.test(team)?team:NFL_TEAM_IDS[team];
  const game=nflMatchupCache[key]?.data?.teams?.[teamId];
  const loaded=!!nflMatchupCache[key];
  const opponent=game?.opponent?(game.homeAway==='home'?'vs ':'@ ')+game.opponent:(loaded?'Bye / no matchup':'Matchup loading…');
  const kickoff=game?.kickoff&&!Number.isNaN(Date.parse(game.kickoff))?new Date(game.kickoff).toLocaleString(undefined,{weekday:'short',hour:'numeric',minute:'2-digit'}):null;
  const projection=meta?.weeklyProjectedPoints==null?null:Number(meta.weeklyProjectedPoints);
  const rank=meta?.oprk==null?null:Number(meta.oprk);
  const rankLabel=Number.isInteger(rank)&&rank>=1&&rank<=32?rank+' / 32':'—';
  // Lower OPRK is tougher; high OPRK is a more favorable matchup.
  const strength=Number.isInteger(rank)&&rank>=1&&rank<=32?(rank<=10?'Difficult':rank>=23?'Easy':'Average'):'Unrated';
  const live=weeklyDirectory[espnId]?.gameStatus==='playing'?Number(weeklyDirectory[espnId].points):null;
  return `<div class="muted small">Next: ${esc(opponent)}${kickoff?' · '+esc(kickoff):''} · Wk ${week}</div>
    <div class="muted small">Projected PPR: ${game?.status==='final'?'—':Number.isFinite(projection)&&projection>=0?fmt(projection)+' est.':'—'} · OPRK: ${rankLabel} · ${strength}</div>
    ${live!==null&&Number.isFinite(live)?`<div class="muted small">Live: ${fmt(live)} pts</div>`:''}`;
}
function lineupManager(mine){
  ensureLineupDraft(mine);
  const roster=state.settings?.roster||{bench:7,ir:1};
  const rows=lineupSlots().map(({key,position,index})=>{
    const selected=lineupDraft[key];
    const choices=mine.filter(p=>p.slot!=='IR'&&
      (position==='FLEX'?['RB','WR','TE'].includes(p.pos):p.pos===position));
    return `<div class="row"><div><b>${esc(position)} ${index+1}</b>${selected?rosterMatchupDetails(mine.find(p=>String(p.id)===String(selected))||{}):''}</div>
      <select style="max-width:70%;min-width:170px" onchange="updateLineupSelection(${jsAttr(key)},this.value)">
        <option value="" ${!selected?'selected':''}>Empty starting slot</option>
        ${choices.map(p=>`<option value="${esc(p.id)}" ${selected===p.id?'selected':''}>
          ${esc(p.name)} (${esc(p.pos)})</option>`).join('')}
      </select></div>`;
  }).join('');
  const bench=mine.filter(p=>p.slot==='BENCH');
  const ir=mine.filter(p=>p.slot==='IR');
  const benchRows=bench.map(p=>`<div class="row"><span>${esc(p.name)} · ${esc(p.pos)}
    ${injuryLabel(p.injuryStatus)}${rosterMatchupDetails(p)}</span>
    ${['OUT','IR','INJURED_RESERVE','PUP','NFI'].includes(String(p.injuryStatus||'').toUpperCase())?
      `<button onclick="moveToSection(${jsAttr(p.id)},'IR')">Move to IR</button>`:''}
    ${draftData().status==='completed'?`<button onclick="dropRosterPlayer(${jsAttr(p.id)})">Drop</button>`:''}</div>`).join('');
  const irRows=ir.map(p=>`<div class="row"><span>${esc(p.name)} · ${esc(p.pos)}
    ${injuryLabel(p.injuryStatus)}${rosterMatchupDetails(p)}</span>
    <button onclick="moveToSection(${jsAttr(p.id)},'BENCH')">Move to bench</button></div>`).join('');
  return card('Set starting lineup',`<div class="actions"><button onclick="optimizeProjectedLineup()" ${lineupSaving?'disabled':''}>⚡ Maximize Projected Points</button></div><p class="muted small">Preview an optimized starting lineup using available weekly projections. Locked players remain in place. Confirm the preview, then save to apply.</p><p class="muted small">Choose all your starters, then save once. Selecting a player in a different slot removes their earlier selection. Game locks are enforced by the server.</p>
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
const NFL_TEAM_IDS={ARI:'22',ATL:'1',BAL:'33',BUF:'2',CAR:'29',CHI:'3',CIN:'4',CLE:'5',DAL:'6',DEN:'7',DET:'8',GB:'9',HOU:'34',IND:'11',JAX:'30',JAC:'30',KC:'12',LV:'13',LAR:'14',LA:'14',MIA:'15',MIN:'16',NE:'17',NO:'18',NYG:'19',NYJ:'20',PHI:'21',PIT:'23',SF:'25',SEA:'26',TB:'27',TEN:'10',WAS:'28'};
const nflMatchupCache={};const nflMatchupPending=new Set();const nflPlayerMetaCache={};
async function fetchNFLMatchups(week){
  const season=Number(state?.nflDirectorySync?.season||new Date().getFullYear());
  const key=season+':'+week;
  if(nflMatchupPending.has(key)||(nflMatchupCache[key]&&Date.now()-nflMatchupCache[key].at<300000))return;
  nflMatchupPending.add(key);
  try{
    const response=await fetch('/api/nfl/week-matchups?season='+season+'&week='+week,{headers:{Authorization:'Bearer '+token}});
    if(!response.ok)throw Error('NFL schedule unavailable');
    nflMatchupCache[key]={at:Date.now(),data:await response.json()};
    try{
      const meta=await fetch('/api/nfl/player-metadata?season='+season+'&week='+week,{headers:{Authorization:'Bearer '+token}});
      if(meta.ok)nflPlayerMetaCache[key]={at:Date.now(),data:await meta.json()};
    }catch(e){console.warn('NFL player metadata:',e.message);}
  }catch(e){console.warn('NFL matchup metadata:',e.message);nflMatchupCache[key]={at:Date.now(),data:{teams:{}}};}
  finally{nflMatchupPending.delete(key);if((tab==='Matchup'||tab==='Players'||tab==='My Team')&&(tab==='My Team'||selectedMatchupWeek()===week))render();}
}
function nflPlayerGame(x){
  const week=selectedMatchupWeek(),season=Number(state?.nflDirectorySync?.season||new Date().getFullYear());
  const board=nflMatchupCache[season+':'+week]?.data;
  const espnId=String(x.espnId||String(x.id||'').replace(/^espn-/,''));
  const verified=nflPlayerMetaCache[season+':'+week]?.data?.players?.[espnId];
  const team=String(verified?.teamId||x.nflTeamId||x.team||'').trim().toUpperCase();
  const id=/^\d+$/.test(team)?team:NFL_TEAM_IDS[team];
  return {game:board?.teams?.[id]||null,loaded:!!board,verified};
}
function selectedMatchupWeek(){return Math.min(14,Math.max(1,matchupWeek??Number(state.scheduleStartWeek||state.nflDirectorySync?.currentWeek||state.week||1)));}
function setMatchupWeek(week){closeMatchupGameStats();matchupWeek=Math.min(14,Math.max(1,Number(week)||1));matchupIndex=0;render();fetchNFLMatchups(matchupWeek);}
function selectMatchup(index){const games=state.matchupSchedule?.[selectedMatchupWeek()]||[];if(!games.length)return;matchupIndex=(index+games.length)%games.length;render();}
function matchupSwipeStart(e){matchupTouchX=e.touches?.[0]?.clientX??null;}
function matchupSwipeEnd(e){if(matchupTouchX===null)return;const diff=(e.changedTouches?.[0]?.clientX??matchupTouchX)-matchupTouchX;matchupTouchX=null;if(Math.abs(diff)>55)selectMatchup(matchupIndex+(diff<0?1:-1));}
function matchupStarters(id){const starters=state.players.filter(x=>x.owner===id&&!['BENCH','IR'].includes(x.slot));
  const used=new Set();return STARTER_ORDER.map(slot=>{const player=starters.find(x=>!used.has(x.id)&&(x.slot===slot||(slot==='FLEX'&&['FLEX','RB','WR','TE'].includes(x.slot))));if(player)used.add(player.id);return player||null;});}
function matchupPlayerCell(x){
  if(!x)return '<span class="muted">Open slot</span>';
  const playerId=String(x.id||'');
  const directoryPlayer=espn?.players?.find(p=>String(p.id)===String(x.espnId||playerId.replace(/^espn-/,'')));
  const clickable=!!directoryPlayer||/^\d{1,12}$/.test(String(x.espnId||playerId.replace(/^espn-/,'')));
  const name=clickable?`<button class="fa-match-player-link" onclick='openMatchupGameStats(${jsAttr(String(x.espnId||playerId.replace(/^espn-/,'')))})'>${esc(x.name)}</button>`:`<b>${esc(x.name)}</b>`;
  const {game,loaded,verified}=nflPlayerGame(x);
  const injury=String(verified?.injuryStatus||directoryPlayer?.injuryStatus||x.injuryStatus||'').toUpperCase();
  const designation=({QUESTIONABLE:'Q',DOUBTFUL:'D',OUT:'O',INJURED_RESERVE:'IR',IR:'IR',PROBABLE:'P'})[injury]||'';
  const injuryBadge=designation?`<span class="fa-injury" title="${esc(injury)} · Latest available ESPN designation">${esc(designation)}</span>`:'';
  const opponent=game?.opponent||null;
  const kickoff=game?.kickoff&&!Number.isNaN(Date.parse(game.kickoff))?new Date(game.kickoff).toLocaleString(undefined,{weekday:'short',hour:'numeric',minute:'2-digit',timeZoneName:'short'}):null;
  const nflTeam=game?.team||(/^[A-Z]{2,3}$/.test(String(x.team||''))?x.team:null);
  const gameLabel=game?`${nflTeam||''} ${game.homeAway==='home'?'vs':'@'} ${opponent||'TBD'}`:nflTeam||'NFL team unavailable';
  const gameStatus=game?.status|| (loaded?'Bye / no game':'Schedule loading');
  // Do not treat season-long projections as weekly projections.
  const oprk=verified?.oprk==null?NaN:Number(verified.oprk);
  const projected=verified?.weeklyProjectedPoints==null?NaN:Number(verified.weeklyProjectedPoints);
  return `<div class="fa-match-player-title">${name} ${injuryBadge}</div>
    <div class="muted small">${esc(gameLabel)}</div>
    <div class="muted small">${kickoff?esc(kickoff):(loaded?'No kickoff':'Loading kickoff…')} · ${esc(gameStatus)}</div>
    <div class="muted small">OPRK: ${Number.isInteger(oprk)&&oprk>=1&&oprk<=32?oprk+(oprk%10===1&&oprk!==11?'st':oprk%10===2&&oprk!==12?'nd':oprk%10===3&&oprk!==13?'rd':'th'):'—'} · Proj: ${Number.isFinite(projected)&&projected>=0?fmt(projected)+' est.':'—'}</div>
    <strong>${fmt(Number(x.points??score(x))||0)} <span class="muted small">pts</span></strong>`;
}
// v31: Game-specific player boxscore overlay, independent of season history.
let fa31StatsTimer=null,fa31Selected=null,fa31Request=0;
function closeMatchupGameStats(){
  fa31Selected=null;fa31Request++;clearTimeout(fa31StatsTimer);fa31StatsTimer=null;
  document.getElementById('fa31GameModal')?.remove();
}
function openMatchupGameStats(id){
  closeMatchupGameStats();
  const season=Number(state?.nflDirectorySync?.season||new Date().getFullYear());
  fa31Selected={id:String(id),week:selectedMatchupWeek(),season};
  const el=document.createElement('div');el.id='fa31GameModal';el.className='fa31-overlay';
  el.innerHTML=`<div class="fa31-dialog" role="dialog" aria-modal="true" aria-label="Player game statistics"><div class="fa31-top"><b>Live NFL game statistics</b><button onclick="closeMatchupGameStats()" aria-label="Close player statistics">✕</button></div><div id="fa31GameContent" aria-live="polite">Loading game statistics…</div></div>`;
  el.addEventListener('click',e=>{if(e.target===el)closeMatchupGameStats();});
  document.body.appendChild(el);loadMatchupGameStats();
}
async function loadMatchupGameStats(){
  const selection=fa31Selected;if(!selection)return;
  const request=++fa31Request;
  const content=document.getElementById('fa31GameContent');
  try{
    const params=new URLSearchParams({id:selection.id,week:String(selection.week),season:String(selection.season)});
    const response=await fetch('/api/nfl/player-game?'+params,{headers:{Authorization:'Bearer '+token},cache:'no-store'});
    const data=await response.json();if(!response.ok)throw Error(data.details||data.error||'Game stats unavailable');
    if(request!==fa31Request||!fa31Selected)return;
    const game=data.game;
    const scoreRow=game?.teams?.map(t=>esc(t.abbreviation)+' '+esc(t.score)).join(' · ')||'';
    const time=game?.kickoff?new Date(game.kickoff).toLocaleString(undefined,{weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}):'Unavailable';
    const title=`<h2 style="margin:8px 0">${esc(data.player?.name||'Player')}</h2><div class="muted small">${esc(data.player?.position||'')} · ${esc(game?.team||'')} ${game?.homeAway==='home'?'vs':'@'} ${esc(game?.opponent||'')}</div><p class="muted small">${esc(game?.status||data.status||'Unavailable')} · ${esc(time)}${scoreRow?' · '+scoreRow:''}</p>`;
    const groupHtml=(data.groups||[]).map(g=>`<section class="fa31-group"><h3>${esc(g.name.charAt(0).toUpperCase()+g.name.slice(1))}</h3>${g.rows.map(r=>`<div class="fa31-stat"><span>${esc(r.label)}</span><b>${esc(r.value)}</b></div>`).join('')}</section>`).join('');
    const breakdown=(data.breakdown||[]).map(r=>`<div class="fa31-stat"><span>${esc(r.label)} (${esc(r.quantity)} × ${esc(r.rate)})</span><b>${fmt(r.points)}</b></div>`).join('');
    content.innerHTML=title+(data.status==='available'?`<div class="fa31-points">${fmt(data.points)} <span>provisional fantasy pts</span></div>${data.statDetails?defenseStatTable(data.statDetails):groupHtml}<section class="fa31-group"><h3>Fantasy scoring breakdown</h3>${breakdown||'<p class="muted small">No supported scoring events yet.</p>'}</section>${data.unsupported?.length?`<p class="muted small">Unverified categories: ${esc(data.unsupported.join(', '))}</p>`:''}`:`<p class="muted">${esc(data.notice||'No statistics available yet.')}</p>`)+`<p class="muted small">${esc(data.notice||'Unofficial ESPN feed; fantasy ledger remains authoritative.')}</p><button onclick="loadMatchupGameStats()">Refresh stats</button>`;
    if(game?.status==='playing')fa31StatsTimer=setTimeout(()=>{if(fa31Selected&&!document.hidden)loadMatchupGameStats();},25000);
  }catch(e){if(request===fa31Request&&fa31Selected&&content)content.innerHTML=`<p>${esc(e.message)}</p><button onclick="loadMatchupGameStats()">Retry</button>`;}
}
function matchupView(){
  const week=selectedMatchupWeek(),games=state.matchupSchedule?.[week]||[];
  if(!games.length){const count=state.managers.filter(x=>x.claimed).length;
    const reason=count<2?'At least two registered teams are required.':state.draft?.status!=='completed'?'Matchups will be generated automatically when the draft finishes.':state.matchupScheduleNotice||(!state.scheduleStartWeek?'Draft completed. Automatic schedule activation pending; checking ESPN NFL kickoff calendar.':week<state.scheduleStartWeek?'Your league begins in NFL Week '+state.scheduleStartWeek+'.':'No matchup scheduled for this week.');
    return `<h1>Week ${week} Matchups</h1>${card('League matchups',esc(reason))}`;
  }
  if(matchupIndex>=games.length)matchupIndex=0;
  if(matchupWeek===null){matchupWeek=week;const mine=games.findIndex(g=>g.home===manager||g.away===manager);if(mine>=0)matchupIndex=mine;}
  const game=games[matchupIndex],left=m(game.home),right=m(game.away);
  const byeTeams=state.managers.filter(x=>x.claimed&&!games.some(g=>g.home===x.id||g.away===x.id));
  const current=Number(state.nflDirectorySync?.currentWeek||state.week||1),isCurrent=week===current;
  const recorded=state.weeklyLedger?.[week]?.matchups?.[game.id];
  const lineupBySlot=rows=>{const used=new Set();return STARTER_ORDER.map(slot=>{const p=(rows||[]).find(x=>!used.has(x.id)&&(x.slot===slot||(slot==='FLEX'&&['RB','WR','TE'].includes(x.slot))));if(p)used.add(p.id);return p||null;});};
  const leftPlayers=recorded?.homeLineup?lineupBySlot(recorded.homeLineup):(isCurrent?matchupStarters(game.home):[]);
  const rightPlayers=recorded?.awayLineup?lineupBySlot(recorded.awayLineup):(isCurrent?matchupStarters(game.away):[]);
  const cells=STARTER_ORDER.map((slot,i)=>`<div class="fa-match-row"><div class="fa-player">${leftPlayers[i]?matchupPlayerCell(leftPlayers[i]):'<span class="muted">Open slot</span>'}</div><div class="fa-position">${slot}</div><div class="fa-player fa-right">${rightPlayers[i]?matchupPlayerCell(rightPlayers[i]):'<span class="muted">Open slot</span>'}</div></div>`).join('');
  const status=recorded?.status==='final'?'Final':week>current?'Upcoming':week<current?'Past week · provisional':(Object.values(nflMatchupCache[(Number(state.nflDirectorySync?.season||new Date().getFullYear()))+':'+week]?.data?.teams||{}).some(g=>g.status==='playing')?'Live / provisional':'Upcoming / awaiting kickoff');
  const total=(id,side)=>recorded?fmt(Number(recorded[side+'Score'])||0):fmt(matchupStarters(id).reduce((sum,p)=>sum+(Number(p?.points)||0),0));
  return `<style>
  .fa-week{display:flex;align-items:center;justify-content:center;gap:12px;margin:14px 0}.fa-week select{padding:8px;background:#202d43;color:inherit;border-radius:8px}
  .fa-match-strip{display:flex;overflow-x:auto;gap:8px;padding:10px 0 16px;scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch}
  .fa-match-pill{flex:0 0 auto;max-width:210px;white-space:normal;scroll-snap-align:center;min-height:50px}.fa-match-pill.active{outline:2px solid #66da8c}
  .fa-match-surface{touch-action:pan-y;overflow:hidden}.fa-head{display:grid;grid-template-columns:minmax(0,1fr) 36px minmax(0,1fr);align-items:center;text-align:center;gap:6px;padding:12px 0 20px}
  .fa-head b{overflow-wrap:anywhere}.fa-total{font-size:32px;font-weight:800;margin:8px 0 3px;font-variant-numeric:tabular-nums}
  .fa-match-row{display:grid;grid-template-columns:minmax(0,1fr) 44px minmax(0,1fr);gap:5px;align-items:stretch;border-top:1px solid #384357;min-height:72px}
  .fa-match-row:nth-child(even){background:rgba(255,255,255,.025)}.fa-player{padding:12px 5px;min-width:0;overflow-wrap:anywhere;font-size:14px}
  .fa-player strong{display:block;margin-top:7px;font-size:18px}.fa-right{text-align:right}.fa-position{display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:bold;background:#101824}
  .fa-match-player-link{background:transparent;border:0;padding:0;text-align:inherit;color:#77dbb6;font:inherit;font-weight:700;text-decoration:underline}
  .fa-injury{display:inline-block;background:#8c5c22;color:#fff;border-radius:4px;padding:1px 5px;font-size:11px;font-weight:800}.fa-match-player-title{display:flex;gap:4px;align-items:center;flex-wrap:wrap}.fa-right .fa-match-player-title{justify-content:flex-end}
  .fa-match-meta{text-align:center;margin:4px 0 16px}.fa-match-nav{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:10px 0}
  @media(max-width:420px){.fa-head .fa-total{font-size:26px}.fa-player{font-size:12px}.fa-position{font-size:11px}}
  </style>
  <h1>Week ${week} Matchups</h1><div class="fa-week"><button onclick="setMatchupWeek(${week-1})" ${week===1?'disabled':''}>‹</button><label>NFL Week <select onchange="setMatchupWeek(this.value)">${Array.from({length:14},(_,i)=>`<option value="${i+1}" ${week===i+1?'selected':''}>${i+1}</option>`).join('')}</select></label><button onclick="setMatchupWeek(${week+1})" ${week===14?'disabled':''}>›</button></div>
  <div class="fa-match-strip">${games.map((g,i)=>`<button class="fa-match-pill ${i===matchupIndex?'active':''}" onclick="selectMatchup(${i})">${teamPhoto(g.home,24)} ${esc(m(g.home)?.team||g.home)} vs ${teamPhoto(g.away,24)} ${esc(m(g.away)?.team||g.away)}</button>`).join('')}</div>
  <section class="card fa-match-surface" ontouchstart="matchupSwipeStart(event)" ontouchend="matchupSwipeEnd(event)">
    <div class="fa-match-nav"><button onclick="selectMatchup(${matchupIndex-1})">‹ Previous</button><span class="muted small">Matchup ${matchupIndex+1} of ${games.length}</span><button onclick="selectMatchup(${matchupIndex+1})">Next ›</button></div>
    <div class="fa-head"><div>${teamPhoto(game.home,54)}<br><b>${esc(left?.team||'Team')}</b><div class="fa-total">${total(game.home,'home')}</div></div><span>VS</span><div>${teamPhoto(game.away,54)}<br><b>${esc(right?.team||'Team')}</b><div class="fa-total">${total(game.away,'away')}</div></div></div>
    <div class="fa-match-meta muted small">${esc(status)} · ${recorded?.status==='final'?'Verified final':'Scores remain provisional until verified'}</div>
    ${cells}<p class="muted small" style="text-align:center">Swipe left/right for other matchups · Scroll down for players</p>
  </section>${byeTeams.length?card('This week’s bye',byeTeams.map(x=>esc(x.team||x.id)).join(', ')):''}
  <section class="card"><h3>League standings · verified finals only</h3><div style="overflow-x:auto"><table style="width:100%;text-align:left"><thead><tr><th>Team</th><th>W</th><th>L</th><th>T</th><th>PF</th></tr></thead><tbody>${(state.standings||[]).map(r=>`<tr><td>${esc(m(r.manager)?.team||r.manager)}</td><td>${r.wins}</td><td>${r.losses}</td><td>${r.ties}</td><td>${fmt(r.pointsFor)}</td></tr>`).join('')}</tbody></table></div></section>`;
}
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
  const picker=$('giphyPicker');if(picker&&giphyOpen)renderGiphyResults();
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
    const isBot=x.manager==='__the_audible__';
    const team=isBot?'🎙️ The Audible':m(x.manager)?.team||'Former manager';
    return `<div class="fa-chat-msg"><div class="fa-chat-head">${isBot?'🎙️':teamPhoto(x.manager,30)} <b>${esc(team)}</b> <span class="muted small">${esc(new Date(x.created_at).toLocaleString())}</span>
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
      <button type="button" onclick="toggleGiphyPicker()">GIF</button>
      <button type="submit">Send message</button></form><div id="giphyPicker" class="fa-giphy-picker" style="display:${giphyOpen?'block':'none'}"><div class="fa-giphy-search"><input id="giphySearch" type="search" placeholder="Search GIPHY GIFs" maxlength="80" value="${esc(giphyQuery)}" onkeydown="if(event.key==='Enter'){event.preventDefault();searchGiphy()}"><button type="button" onclick="searchGiphy()">Search</button><button type="button" onclick="toggleGiphyPicker()">Close</button></div><div id="giphyResults" class="fa-giphy-grid"></div><p class="muted small">Powered by GIPHY</p></div>`}</section><div id="chatModeration">${controls}</div>`;
}
function toggleGiphyPicker(){
  giphyOpen=!giphyOpen;
  const picker=$('giphyPicker');if(!picker)return;
  picker.style.display=giphyOpen?'block':'none';
  if(giphyOpen){renderGiphyResults();if(!giphyResults.length)searchGiphy();}
}
function renderGiphyResults(){
  const grid=$('giphyResults');if(!grid)return;
  if(giphyBusy){grid.textContent='Loading GIFs…';return;}
  if(giphyError){grid.textContent=giphyError;return;}
  if(!giphyResults.length){grid.textContent='No GIFs found.';return;}
  grid.replaceChildren();
  for(const result of giphyResults){
    const button=document.createElement('button');button.type='button';button.className='fa-giphy-item';
    button.title=result.title||'Send GIF';
    const img=document.createElement('img');img.src=result.preview;img.alt=result.title||'GIF';img.loading='lazy';
    button.appendChild(img);button.addEventListener('click',()=>sendGiphyGif(result.url));grid.appendChild(button);
  }
}
async function searchGiphy(){
  giphyQuery=$('giphySearch')?.value.trim()||'';
  const request=++giphyRequest;giphyBusy=true;giphyError='';renderGiphyResults();
  try{
    const configResponse=await fetch('/api/chat/giphy/config',{headers:{Authorization:'Bearer '+token},cache:'no-store'});
    const config=await configResponse.json();
    if(!configResponse.ok)throw Error(config.error||'GIPHY is unavailable');
    const endpoint=new URL('https://api.giphy.com/v1/gifs/'+(giphyQuery?'search':'trending'));
    endpoint.searchParams.set('api_key',config.apiKey);
    endpoint.searchParams.set('limit','18');endpoint.searchParams.set('rating','pg');
    if(giphyQuery)endpoint.searchParams.set('q',giphyQuery.slice(0,50));
    const response=await fetch(endpoint.toString());
    if(!response.ok)throw Error('GIPHY search failed ('+response.status+')');
    const payload=await response.json();
    if(request===giphyRequest)giphyResults=(payload.data||[]).map(item=>({
      id:String(item.id||''),title:String(item.title||'GIF'),
      url:item.images?.fixed_height?.url||item.images?.original?.url,
      preview:item.images?.fixed_width_small?.url||item.images?.fixed_width?.url
    })).filter(item=>item.url&&item.preview&&/^https:\/\/media\d*\.giphy\.com\//i.test(item.url));
  }catch(e){if(request===giphyRequest)giphyError=e.message;}
  finally{if(request===giphyRequest){giphyBusy=false;renderGiphyResults();}}
}
async function sendGiphyGif(url){
  if(!/^https:\/\/media\d*\.giphy\.com\//i.test(url))return;
  const caption=$('chatInput')?.value.trim()||'';
  const message=(caption?caption+'\n':'')+url;
  if(message.length>1000){toast('Message is too long');return;}
  try{
    await apiPost('/api/chat',{message});
    chatDraft='';const input=$('chatInput');if(input)input.value='';
    giphyOpen=false;const picker=$('giphyPicker');if(picker)picker.style.display='none';
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
function editorialView(){
  const articles=state.editorial||[];
  if(!articles.length)return card('🎙️ The Audible', '<p>League coverage is warming up. Verified game results and the scheduled editions will appear here automatically.</p>');
  const article=articles[0];
  const section=a=>`<article style="padding:12px 0;border-bottom:1px solid #ffffff20"><div class="muted small">${esc(a.kind.toUpperCase())} · WEEK ${a.week}</div><h3>${esc(a.title)}</h3>${a.lines.map(line=>`<p>${esc(line)}</p>`).join('')}</article>`;
  return card('🎙️ The Audible · Latest Edition',section(article)+`<button onclick="changeTab('Locker Room')">Discuss in Locker Room</button><details style="margin-top:12px"><summary>Previous editions (${articles.length-1})</summary>${articles.slice(1).map(section).join('')||'<p>No previous editions yet.</p>'}</details>`);
}
function render(){if(!state||!manager)return;const mine=state.players.filter(x=>x.owner===manager),myTeam=m(manager);
  if(!myTeam)return;
  $('tabs').innerHTML=tabs.filter(t=>t!=='Commissioner'||state.viewer.commissioner)
    .map(t=>`<button class="${tab===t?'active':''}" onclick="changeTab('${t}')">${t==='Locker Room'&&chatLastId>chatSeenId?'💬 '+t+' •':t}</button>`).join('');
  let content='';
  if(tab==='Home')content=`<h1>${esc(state.league)}</h1><p>Week ${state.week} · ${esc(myTeam.team)}</p>
    ${editorialView()}
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
    `<div class="row"><button type="button" style="display:inline-flex;align-items:center;text-align:left;gap:7px;background:transparent;border:0;padding:6px 0;color:inherit;text-decoration:underline;text-underline-offset:3px" onclick='viewLeagueTeam(${jsAttr(x.id)})' aria-label="View ${esc(x.team)} roster">${teamPhoto(x.id,36)} <b>${esc(x.team)}</b></button><span>${fmt(total(x.id))} pts</span></div>`).join(''))}${leagueTeamRosterView()}
    ${card('League roster rules',state.settings?`<p>Starters: ${Object.entries(state.settings.roster.starters).map(([k,v])=>`${k} ${v}`).join(' · ')}</p>
      <p>Bench: ${state.settings.roster.bench} · IR: ${state.settings.roster.ir}</p>`:'<p>Not yet configured.</p>')}`;
  if((tab==='Players'||tab==='My Waivers')&&Date.now()-lastTransactionFetch>90000)loadTransactions();
  if(tab==='Players')content=`<h1>ESPN Player Directory</h1>${myWaiversPanel()}${playerTable()}`;
  if(tab==='My Waivers')content=`<h1>My Waivers</h1>${myWaiversPanel()}`;
  if(tab==='Draft')content=renderDraft();
  if(tab==='Locker Room')content=chatView();
  if(tab==='Notifications')content=`<h1>Notifications</h1>${card('Injury alerts',state.injuries.map(i=>
    `<div class="row"><b>${esc(p(i.player)?.name||'Player')}</b><span>${i.active?'Pending':'Resolved'}</span></div>`).join('')||'<p>No alerts.</p>')}
    ${card('Push notifications',`<p>On iPhone, add Fantasy Audible to your Home Screen before enabling alerts. Notifications require permission and server configuration.</p><div class="actions"><button onclick="enablePush()">Enable injury alerts</button><button onclick="testPush()">Test notification</button><button onclick="disablePush()">Disable on this device</button></div>`)}
    ${card('Transactions',state.transactions.slice(0,50).map(t=>`<div class="row">${esc(t.details)}</div>`).join('')||'<p>No transactions.</p>')}`;
  if(tab==='Commissioner'&&state.viewer.commissioner)content=`<h1>Commissioner Controls</h1>
    ${card('Draft management','<p>Manage the snake draft.</p><button onclick="changeTab(\'Draft\')">Open draft controls</button>')}
    ${commissionerDraftOrderUI()}
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
function viewLeagueTeam(id){
  if(!state?.managers.some(x=>x.id===id&&x.claimed))return;
  viewedLeagueTeamId=id;render();
  document.getElementById('leagueRosterDetail')?.scrollIntoView({behavior:'smooth',block:'start'});
}
function closeLeagueTeam(){viewedLeagueTeamId=null;render();}
function leagueTeamRosterView(){
  if(viewedLeagueTeamId==null)return '';
  const team=state.managers.find(x=>x.id===viewedLeagueTeamId&&x.claimed);
  if(!team)return '';
  const players=state.players.filter(x=>x.owner===team.id);
  const starters=players.filter(x=>!['BENCH','IR'].includes(x.slot));
  const bench=players.filter(x=>x.slot==='BENCH');
  const ir=players.filter(x=>x.slot==='IR');
  const order=['QB','RB','WR','TE','FLEX','D/ST','K'];
  starters.sort((a,b)=>order.indexOf(a.slot)-order.indexOf(b.slot)||a.name.localeCompare(b.name));
  const rows=items=>items.map(x=>`<div class="row"><div><b>${esc(x.name)}</b><div class="muted small">${esc(x.slot)} · ${esc(x.pos)} · ${esc(x.team)}${x.injuryStatus?' · '+esc(x.injuryStatus):''}</div></div><b>${fmt(score(x))} pts</b></div>`).join('');
  return `<section id="leagueRosterDetail" class="card"><div class="row"><h2>${teamPhoto(team.id,42)} ${esc(team.team)} · Roster</h2><button onclick="closeLeagueTeam()">Close</button></div>
    <p class="muted small">${players.length} rostered players · Current lineup and scores</p>
    <h3>Starters (${starters.length})</h3>${rows(starters)||'<p class="muted">No starters assigned yet.</p>'}
    <h3>Bench (${bench.length})</h3>${rows(bench)||'<p class="muted">No bench players yet.</p>'}
    <h3>Injured Reserve (${ir.length})</h3>${rows(ir)||'<p class="muted">No players on IR.</p>'}</section>`;
}
function changeTab(next){closeMatchupGameStats();if(next==='Matchup'&&tab!=='Matchup'){matchupWeek=null;matchupIndex=0;}tab=next;render();if(tab==='Draft')syncServerClock();
  if(tab==='Draft'||tab==='Players')loadESPN();
  if(tab==='My Team'){loadWeeklyDirectory();fetchNFLMatchups(Math.min(18,Math.max(1,Number(state?.nflDirectorySync?.currentWeek||state?.week||1))));}
  if(tab==='Players'){loadWeeklyDirectory();fetchNFLMatchups(Math.min(18,Math.max(1,Number(state?.nflDirectorySync?.currentWeek||state?.week||selectedMatchupWeek()))));}
  if(tab==='Matchup')fetchNFLMatchups(selectedMatchupWeek());
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
