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
const tabs=['Home','My Team','Matchup','League','Postseason','Players','My Waivers','Draft','Notifications','Locker Room','Commissioner'];
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
function faLatestMeta(x){
  const season=Number(state?.nflDirectorySync?.season||new Date().getFullYear());
  const week=Number(state?.nflDirectorySync?.currentWeek||state?.week||1);
  return nflPlayerMetaCache[season+':'+week]?.data?.players?.[String(x.espnId||String(x.id).replace(/^espn-/,''))]||null;
}
function faPlayerSigma(meta,expected){
  const scores=meta?.historicalWeeklyScores;
  if(Array.isArray(scores)&&scores.length>=3){
    const avg=scores.reduce((a,b)=>a+b,0)/scores.length;
    const variance=scores.reduce((sum,v)=>sum+(v-avg)**2,0)/(scores.length-1);
    return {sigma:Math.max(5,Math.sqrt(variance)),sample:scores.length,source:'historical weekly scoring'};
  }
  return {sigma:Math.max(9,Math.abs(expected)*0.85),sample:0,source:'position-independent conservative estimate'};
}
function faSubRisk(x,starter,mode){
  const meta=faLatestMeta(x),raw=meta?.weeklyProjectedPoints;
  const expected=raw==null||!Number.isFinite(Number(raw))?null:Number(raw);
  const keep=Number(starter.credited??starter.points)||0;
  if(expected===null)return '<span class="muted small">Score impact: insufficient ESPN projected stats · Probability unavailable</span>';
  const already=mode==='handcuff'?(Number(x.points)||0):0;
  const remaining=Math.max(0,expected-already);
  const gain=remaining-keep;
  const health=String(meta?.injuryStatus||x.injuryStatus||'UNKNOWN').toUpperCase();
  const unavailable=['OUT','IR','INJURED_RESERVE','SUSPENDED'].includes(health);
  const uncertain=['DOUBTFUL','QUESTIONABLE','UNKNOWN'].includes(health);
  const sigma=faPlayerSigma(meta,remaining);
  const conditional=1-faNormalCdf((keep-remaining)/sigma.sigma);
  const chance=unavailable?0:conditional;
  const adjusted=unavailable?-keep:gain;
  const source=sigma.sample>=3?'Historical variance ('+sigma.sample+' games)':'Conservative variance estimate';
  return `<div class="muted small">Projected credited: ${fmt(remaining)} pts · Expected change: ${adjusted>=0?'+':''}${fmt(adjusted)} pts<br>
    <b>${uncertain?'Improvement probability unavailable (playing status uncertain)':Math.round(chance*100)+'% estimated chance to improve · '+Math.round((1-chance)*100)+'% to tie or hurt'}</b><br>
    ${esc(source)} · ${unavailable?'Unavailable to play':uncertain?'Health status limits forecast':'Assumes player is active'} · Not a calibrated probability</div>`;
}
function injuryCard(injury){const starter=p(injury.player);if(!starter||starter.owner!==manager)return '';
  const choices=state.players.filter(x=>x.owner===manager&&x.slot==='BENCH'&&
    (starter.slot==='FLEX'?['RB','WR','TE'].includes(x.pos):x.pos===starter.pos)&&
    !(state.injurySwapHistory||[]).some(h=>h.week===state.week&&h.removedId===x.id))
    .map(x=>{const same=x.team===starter.team&&x.kickoff<=state.phase;
      const later=x.kickoff>state.phase,eligible=same||later;
      const health=faLatestMeta(x)?.injuryStatus||x.injuryStatus||'UNKNOWN';
      return `<div class="row"><div><b>${esc(x.name)}</b> ${injuryLabel(health)}
        <div class="muted small">${same?'Same-team handcuff: future points only':later?'Later kickoff: full-game points':'Not eligible'}</div>
        <div>${faSubRisk(x,starter,same?'handcuff':'later')}</div></div>
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
  finally{weeklyLoading=false;if(tab==='Players'||tab==='My Team'||tab==='Matchup')render();}
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
setInterval(()=>{if(tab==='Matchup'&&state){loadWeeklyDirectory(true);fetchNFLMatchups(selectedMatchupWeek());}},60000);
setInterval(()=>{if(token&&state&&!document.hidden){const week=Number(state.nflDirectorySync?.currentWeek||state.week||1);fetchNFLMatchups(week);}},5*60000);
const nflMatchupCache={};const nflMatchupPending=new Set();const nflPlayerMetaCache={};
async function fetchNFLMatchups(week){
  const season=Number(state?.nflDirectorySync?.season||new Date().getFullYear());
  const key=season+':'+week;
  if(nflMatchupPending.has(key)||(nflMatchupCache[key]&&Date.now()-nflMatchupCache[key].at<60000))return;
  nflMatchupPending.add(key);
  try{
    const response=await fetch('/api/nfl/week-matchups?season='+season+'&week='+week,{headers:{Authorization:'Bearer '+token}});
    if(!response.ok)throw Error('NFL schedule unavailable');
    nflMatchupCache[key]={at:Date.now(),data:await response.json()};
    try{
      const meta=await fetch('/api/nfl/player-metadata?season='+season+'&week='+week,{headers:{Authorization:'Bearer '+token}});
      if(meta.ok){
        const result=await meta.json();nflPlayerMetaCache[key]={at:Date.now(),data:result};
        const statuses=result.players||{};
        for(const item of state?.players||[]){
          const status=statuses[String(item.espnId||String(item.id).replace(/^espn-/,''))]?.injuryStatus;
          if(status&&status!=='UNKNOWN')item.injuryStatus=status;
        }
        for(const item of espn?.players||[]){
          const status=statuses[String(item.id)]?.injuryStatus;
          if(status&&status!=='UNKNOWN')item.injuryStatus=status;
        }
      }
    }catch(e){console.warn('NFL player metadata:',e.message);}
  }catch(e){console.warn('NFL matchup metadata:',e.message);nflMatchupCache[key]={at:Date.now(),data:{teams:{}}};}
  finally{nflMatchupPending.delete(key);if((tab==='Matchup'||tab==='Players'||tab==='My Team'||tab==='Home')&&(tab==='My Team'||tab==='Home'||selectedMatchupWeek()===week))render();}
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
function selectedMatchupWeek(){return Math.min(18,Math.max(1,matchupWeek??Number(state.scheduleStartWeek||state.nflDirectorySync?.currentWeek||state.week||1)));}
function setMatchupWeek(week){closeMatchupGameStats();matchupWeek=Math.min(18,Math.max(1,Number(week)||1));matchupIndex=0;render();fetchNFLMatchups(matchupWeek);}
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
// Live matchup forecasts use ESPN projected statistics scored under league rules.
// Favorability is a modeled indicator, not an ESPN or calibrated win probability.
function faProjectionProgress(game){
  if(!game)return null;
  if(game.status==='final')return 1;
  if(game.status==='upcoming'||game.status==='scheduled')return 0;
  if(game.status!=='playing'&&game.status!=='live')return null;
  const kickoff=Date.parse(game.kickoff||'');
  // Game clock is not exposed by the current week-matchups endpoint. Estimate
  // game progress from kickoff, capped to avoid claiming a final before ESPN does.
  if(!Number.isFinite(kickoff))return .5;
  return Math.max(.06,Math.min(.94,(Date.now()-kickoff)/(3.25*3600000)));
}
function faForecastPlayer(p,week){
  if(!p)return {actual:0,projected:0,variance:0,known:false};
  const season=Number(state?.nflDirectorySync?.season||new Date().getFullYear());
  const key=season+':'+week;
  const id=String(p.espnId||String(p.id||'').replace(/^espn-/,''));
  const meta=nflPlayerMetaCache[key]?.data?.players?.[id];
  const team=String(meta?.teamId||p.nflTeamId||p.team||'').toUpperCase();
  const teamId=/^\d+$/.test(team)?team:NFL_TEAM_IDS[team];
  const game=nflMatchupCache[key]?.data?.teams?.[teamId];
  const feed=weeklyDirectory[id];
  const raw=meta?.weeklyProjectedPoints;
  const baseline=raw!==null&&raw!==undefined&&Number.isFinite(Number(raw))?Math.max(0,Number(raw)):null;
  const progress=faProjectionProgress(game);
  const injury=String(meta?.injuryStatus||p.injuryStatus||'').toUpperCase().replace(/[ -]/g,'_');
  const explicitlyOut=['OUT','INJURED_RESERVE','IR','SUSPENDED','PUP','NON_FOOTBALL_INJURY'].includes(injury);
  // A verified bye means no NFL game is scheduled for this team in this week.
  // Do not mistake a missing/failed schedule response for a bye.
  const schedule=nflMatchupCache[key]?.data;
  const hasVerifiedSchedule=Boolean(schedule&&schedule.teams&&Object.keys(schedule.teams).length);
  const onBye=Boolean(hasVerifiedSchedule&&teamId&&!game);

  const feedPoints=feed?.points==null?null:Number(feed.points);
  const actual=Number.isFinite(feedPoints)&&feed?.gameStatus!=='upcoming'?feedPoints:Math.max(0,Number(p.points)||0);
  // The fantasy substitution ledger can credit fewer points than the NFL feed.
  const credited=Number.isFinite(Number(p.credited))&&p.scoringMode?Math.max(0,Number(p.credited)):actual;
  if(progress===1||feed?.gameStatus==='final')return {actual:credited,projected:credited,variance:0,known:true};
  // OUT/BYE are deterministic zeros for FUTURE scoring. Already earned points
  // remain credited even if a player is ruled out during a live game.
  if(explicitlyOut||onBye)return {actual:credited,projected:credited,variance:0,known:true};
  if(baseline===null||progress===null)return {actual:credited,projected:null,variance:null,known:false};
  const noFurtherPoints=false;
  const remaining=noFurtherPoints?0:baseline*(1-progress);
  // Higher early-game uncertainty; decreases as scoring opportunities expire.
  // Fantasy scoring has a wide weekly distribution. Do not let a projected
  // advantage of 8-40 points create near-certain pregame odds. This is a
  // conservative, explicitly uncalibrated uncertainty estimate until enough
  // player-level outcomes exist to fit and backtest distributions.
  const calibrated=faPlayerSigma(meta,baseline);
  const sigma=noFurtherPoints?0:calibrated.sigma*Math.sqrt(Math.max(0,1-progress));
  return {actual:credited,projected:credited+remaining,variance:sigma*sigma,known:true};
}
function faForecastTeam(players,week){
  let actual=0,projected=0,variance=0,missing=0;
  for(const p of players){if(!p)continue;const x=faForecastPlayer(p,week);
    actual+=x.actual;
    if(x.known){projected+=x.projected;variance+=x.variance;}else{projected+=x.actual;missing++;}}
  return {actual,projected,variance,missing};
}
function faNormalCdf(x){
  // Abramowitz-Stegun approximation to the standard normal CDF.
  const z=Math.abs(x),t=1/(1+.2316419*z);
  const density=Math.exp(-z*z/2)/Math.sqrt(2*Math.PI);
  const cdf=1-density*(.319381530*t-.356563782*t*t+1.781477937*t**3-1.821255978*t**4+1.330274429*t**5);
  return x>=0?cdf:1-cdf;
}
function faMatchForecastView(leftPlayers,rightPlayers,week,recorded){
  if(recorded?.status==='final'){
    const a=Number(recorded.homeScore)||0,b=Number(recorded.awayScore)||0;
    return `<div class="fa-forecast"><div class="fa-forecast-label">Final · ${fmt(a)} – ${fmt(b)}</div></div>`;
  }
  const a=faForecastTeam(leftPlayers,week),b=faForecastTeam(rightPlayers,week);
  const unknown=a.missing+b.missing;
  const anyKnown=leftPlayers.concat(rightPlayers).some(p=>p&&faForecastPlayer(p,week).known);
  if(!anyKnown)return `<div class="fa-forecast muted small">Projected final scores loading or unavailable.</div>`;
  // Without historical player-specific variance, this is a favorability indicator,
  // not a statistically calibrated probability. Missing projections prohibit odds.
  const variance=a.variance+b.variance;
  const chance=variance>0?faNormalCdf((a.projected-b.projected)/Math.sqrt(variance)):0.5;
  const percent=unknown?50:Math.max(2,Math.min(98,100*chance));
  return `<div class="fa-forecast" aria-label="Estimated matchup favorability">
    <div class="fa-forecast-label"><span>${unknown?'Known projected points':'Projected final'} <b>${fmt(a.projected)}</b></span><span><b>${fmt(b.projected)}</b> ${unknown?'Known projected points':'Projected final'}</span></div>
    <div class="fa-favor-track" style="${unknown?'background:#57677f':''}">${unknown?'':`<div class="fa-favor-left" style="width:${percent.toFixed(2)}%"></div>
      <div class="fa-favor-needle" style="left:${percent.toFixed(2)}%"></div>`}</div>
    <div class="fa-forecast-label"><span>${unknown?'—':Math.round(percent)+'%'} favored</span><span>${unknown?'—':Math.round(100-percent)+'%'} favored</span></div>
    <div class="muted small" style="text-align:center;margin-top:8px">${unknown?'Favorability unavailable · '+unknown+' missing ESPN stat projection'+(unknown===1?'':'s'):'Modeled win chance · historical variance where available · not yet backtested'}</div>
  </div>`;
}
function matchupView(){
  const week=selectedMatchupWeek(),games=state.matchupSchedule?.[week]||[];
  if(!games.length){const count=state.managers.filter(x=>x.claimed).length;
    const reason=count<2?'At least two registered teams are required.':state.draft?.status!=='completed'?'Matchups will be generated automatically when the draft finishes.':state.matchupScheduleNotice||(!state.scheduleStartWeek?'Draft completed. Automatic schedule activation pending; checking ESPN NFL kickoff calendar.':week<state.scheduleStartWeek?'Your league begins in NFL Week '+state.scheduleStartWeek+'.':week>=(state.postseason?.regularSeasonEnd||((state.managers||[]).filter(m=>m.claimed).length<=8?14:13))?'Awaiting verified final scoring and official postseason bracket activation or previous-round advancement.':'No matchup scheduled for this week.');
    return `<h1>Week ${week} Matchups</h1><div class="fa-week" style="display:flex;justify-content:center;align-items:center;gap:12px;margin:18px auto 22px;width:100%;"><button onclick="setMatchupWeek(${week-1})" ${week===1?'disabled':''}>‹</button><label>NFL Week <select onchange="setMatchupWeek(this.value)">${Array.from({length:18},(_,i)=>`<option value="${i+1}" ${week===i+1?'selected':''}>${i+1}</option>`).join('')}</select></label><button onclick="setMatchupWeek(${week+1})" ${week===18?'disabled':''}>›</button></div>${card('League matchups',esc(reason))}`;
  }
  if(matchupIndex>=games.length)matchupIndex=0;
  if(matchupWeek===null){matchupWeek=week;const mine=games.findIndex(g=>g.home===manager||g.away===manager);if(mine>=0)matchupIndex=mine;}
  const game=games[matchupIndex],left=m(game.home),right=m(game.away);
  const byeTeams=state.managers.filter(x=>x.claimed&&!games.some(g=>g.home===x.id||g.away===x.id));
  const current=Number(state.nflDirectorySync?.currentWeek||state.week||1),isCurrent=week===current;
  const recorded=state.weeklyLedger?.[week]?.matchups?.[game.id];
  const lineupBySlot=rows=>{const used=new Set();return STARTER_ORDER.map(slot=>{const p=(rows||[]).find(x=>!used.has(x.id)&&(x.slot===slot||(slot==='FLEX'&&['RB','WR','TE'].includes(x.slot))));if(p)used.add(p.id);return p||null;});};
  // Future weeks have no recorded lineup yet. Preview today's roster without
  // carrying current-week fantasy points into the future matchup.
  const futurePreview=players=>players.map(p=>({...p,points:0,credited:0,scoreAtSwap:0,scoringMode:null}));
  const leftPlayers=recorded?.homeLineup?lineupBySlot(recorded.homeLineup):
    (week>current?futurePreview(matchupStarters(game.home)):(isCurrent?matchupStarters(game.home):[]));
  const rightPlayers=recorded?.awayLineup?lineupBySlot(recorded.awayLineup):
    (week>current?futurePreview(matchupStarters(game.away)):(isCurrent?matchupStarters(game.away):[]));
  const cells=STARTER_ORDER.map((slot,i)=>`<div class="fa-match-row"><div class="fa-player">${leftPlayers[i]?(week>current?`<b>${esc(leftPlayers[i].name)}</b><div class="muted small">Projected starter · 0.0 actual</div>`:matchupPlayerCell(leftPlayers[i])):'<span class="muted">Open slot</span>'}</div><div class="fa-position">${slot}</div><div class="fa-player fa-right">${rightPlayers[i]?(week>current?`<b>${esc(rightPlayers[i].name)}</b><div class="muted small">Projected starter · 0.0 actual</div>`:matchupPlayerCell(rightPlayers[i])):'<span class="muted">Open slot</span>'}</div></div>`).join('');
  const status=recorded?.status==='final'?'Final':week>current?'Upcoming':week<current?'Past week · provisional':(Object.values(nflMatchupCache[(Number(state.nflDirectorySync?.season||new Date().getFullYear()))+':'+week]?.data?.teams||{}).some(g=>g.status==='playing')?'Live / provisional':'Upcoming / awaiting kickoff');
  const total=(id,side)=>recorded?fmt(Number(recorded[side+'Score'])||0):
    week>current?fmt(0):
    isCurrent?fmt(matchupStarters(id).reduce((sum,p)=>sum+(Number(p?.points)||0),0)):fmt(0);
  // Do not use current-week scores or a different week's projections for a
  // future matchup. A future forecast requires that week's own verified data.
  const forecast=week>current
    ?'<div class="fa-forecast muted small">Future-week projections will appear when that week’s ESPN statistical projections are available.</div>'
    :faMatchForecastView(leftPlayers,rightPlayers,week,recorded);
  return `<style>
  .fa-forecast{padding:12px 8px 18px;margin:0 0 14px;border-top:1px solid #384357}
  .fa-forecast-label{display:flex;justify-content:space-between;gap:12px;font-size:13px;font-variant-numeric:tabular-nums}
  .fa-favor-track{height:15px;background:#b34a47;border-radius:999px;position:relative;margin:16px 8px 12px}
  .fa-favor-left{height:100%;background:#2e8de2;border-radius:999px 0 0 999px;transition:width .7s ease}
  .fa-favor-needle{position:absolute;top:-7px;height:29px;width:3px;border-radius:3px;background:white;box-shadow:0 0 6px #fff;transform:translateX(-50%);transition:left .7s ease}
  .fa-week{display:flex;align-items:center;justify-content:center;gap:12px;margin:18px auto 22px;width:100%;flex-wrap:nowrap}.fa-week label{display:flex;align-items:center;gap:8px;white-space:nowrap}.fa-week select{padding:8px;background:#202d43;color:inherit;border-radius:8px}
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
  <h1>Week ${week} Matchups</h1><div class="fa-week"><button onclick="setMatchupWeek(${week-1})" ${week===1?'disabled':''}>‹</button><label>NFL Week <select onchange="setMatchupWeek(this.value)">${Array.from({length:18},(_,i)=>`<option value="${i+1}" ${week===i+1?'selected':''}>${i+1}</option>`).join('')}</select></label><button onclick="setMatchupWeek(${week+1})" ${week===18?'disabled':''}>›</button></div>
  <div class="fa-match-strip">${games.map((g,i)=>`<button class="fa-match-pill ${i===matchupIndex?'active':''}" onclick="selectMatchup(${i})">${teamPhoto(g.home,24)} ${esc(m(g.home)?.team||g.home)} vs ${teamPhoto(g.away,24)} ${esc(m(g.away)?.team||g.away)}</button>`).join('')}</div>
  <section class="card fa-match-surface" ontouchstart="matchupSwipeStart(event)" ontouchend="matchupSwipeEnd(event)">
    <div class="fa-match-nav"><button onclick="selectMatchup(${matchupIndex-1})">‹ Previous</button><span class="muted small">Matchup ${matchupIndex+1} of ${games.length}</span><button onclick="selectMatchup(${matchupIndex+1})">Next ›</button></div>
    <div class="fa-head"><div>${teamPhoto(game.home,54)}<br><b>${esc(left?.team||'Team')}</b><div class="fa-total">${total(game.home,'home')}</div></div><span>VS</span><div>${teamPhoto(game.away,54)}<br><b>${esc(right?.team||'Team')}</b><div class="fa-total">${total(game.away,'away')}</div></div></div>
    <div class="fa-match-meta muted small">${esc(status)} · ${recorded?.status==='final'?'Verified final':'Scores remain provisional until verified'}</div>
    ${forecast}
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
let faCurrentBuild='Build information loading…';
function faLoadBuild(){fetch('/api/build',{cache:'no-store'}).then(r=>r.ok?r.json():Promise.reject(Error('Build unavailable'))).then(info=>{faCurrentBuild='v'+String(info.version||'?')+' · Build '+String(info.build||'unavailable');if(tab==='Home'&&state)render();}).catch(()=>{faCurrentBuild='Build information unavailable';});}

function postseasonData(){
 const rows=(state.managers||[]).filter(x=>x.claimed).map(x=>{
 const r=(state.standings||[]).find(y=>String(y.manager)===String(x.id))||{};
 const w=Number(r.wins)||0,l=Number(r.losses)||0,t=Number(r.ties)||0,pf=Number(r.pointsFor)||0;
 return {id:x.id,name:x.team,w,l,t,pf,pct:w+l+t?(w+t/2)/(w+l+t):0};
 }).sort((a,b)=>b.pct-a.pct||b.pf-a.pf||String(a.id).localeCompare(String(b.id)));
 const n=rows.length,slots=n<=8?4:6,end=n<=8?14:13,remaining=new Map(rows.map(r=>[String(r.id),0]));
 let complete=Boolean(state.scheduleStartWeek)&&Number(state.scheduleStartWeek)<=end;
 for(let week=Number(state.scheduleStartWeek||1);week<=end;week++){
  const games=state.matchupSchedule?.[week];if(!Array.isArray(games)){complete=false;continue;}
  for(const g of games){if(!g?.id||!g.home||!g.away){complete=false;continue;}
   if(state.weeklyLedger?.[week]?.matchups?.[g.id]?.status!=='final')
    for(const id of [g.home,g.away])if(remaining.has(String(id)))remaining.set(String(id),remaining.get(String(id))+1);
  }
 }
 const status=rows.map(r=>{
  if(!complete||n<6)return 'In the hunt';
  const max=x=>x.w+(remaining.get(String(x.id))||0);
  if(rows.filter(o=>o.id!==r.id&&o.w>max(r)).length>=slots)return 'Eliminated';
  if(rows.filter(o=>o.id!==r.id&&max(o)>=r.w).length<slots)return 'Clinched';
  return 'In the hunt';
 });return {rows,n,slots,end,status};
}
function postseasonView(){
 if(state.postseason?.locked){
  const p=state.postseason,team=id=>esc(m(id)?.team||id||'TBD');
  const stage=week=>{
   const fixtures=(state.matchupSchedule?.[week]||[]).filter(g=>g.kind&&g.kind!=='placement');
   return '<div style="min-width:180px;flex:1;border:1px solid #394960;border-radius:12px;padding:12px"><b>Week '+week+'</b>'+(
    fixtures.length?fixtures.map(g=>'<div style="border:1px solid #4a607b;border-radius:8px;padding:10px;margin:8px 0">'+team(g.home)+'<div class="muted small">vs</div>'+team(g.away)+' <span class="muted small">('+esc(g.kind)+')</span></div>').join(''):'<p class="muted">Awaiting previous round</p>')+'</div>';
  };
  return '<h1>Postseason · Official Bracket</h1><p>Seeds locked after Week '+p.regularSeasonEnd+'. Phase: <b>'+esc(p.phase)+'</b></p>'+
   card('Official seeds',p.seeds.map((id,i)=>'<div class="row"><b>#'+(i+1)+' '+team(id)+'</b><span>'+(i<p.qualifiers?'Championship':'Consolation')+'</span></div>').join(''))+
   card('Postseason schedule','<div style="display:flex;flex-wrap:wrap;gap:10px">'+[14,15,16,17,18].filter(w=>w>p.regularSeasonEnd).map(stage).join('')+'</div>')+
   (p.championshipFinal?card('Final results','Champion: '+team(p.championshipFinal.champion)+' · Runner-up: '+team(p.championshipFinal.runnerUp)+' · Third: '+team(p.championshipFinal.third)):'')+
   '<p class="muted small">Future rounds remain hidden until all preceding NFL games and fantasy scores are verified.</p>';
 }
 const d=postseasonData();if(d.n<6)return '<h1>Postseason</h1>'+card('Bracket projections','Six registered teams are required.');
 const seed=i=>d.rows[i]?'#'+(i+1)+' '+esc(d.rows[i].name):'TBD';
 const game=(a,b)=>'<div style="border:1px solid #4a607b;border-radius:9px;margin:10px 0;padding:12px"><b>'+a+'</b><div class="muted small">vs</div><b>'+b+'</b></div>';
 const stage=(title,body)=>'<div style="border:1px solid #394960;border-radius:12px;padding:12px;min-width:190px;flex:1"><b>'+title+'</b>'+body+'</div>';
 const wild=d.slots===6;
 const round=wild?stage('Week 14 · Wild Card',game(seed(2),seed(5))+game(seed(3),seed(4))+'<p class="muted small">#1 and #2 byes</p>'):'';
 const semi=wild?game(seed(0),'Lowest Wild Card winner')+game(seed(1),'Highest Wild Card winner'):game(seed(0),seed(3))+game(seed(1),seed(2));
 return '<h1>Postseason · Projected Brackets</h1><p class="muted">Current standings projections. Seeds lock after Week '+d.end+'.</p>'+
 card('Championship','<div style="display:flex;flex-wrap:wrap;gap:12px">'+round+stage('Weeks 15–16 · Semifinals',semi+'<p class="muted small">Two-week aggregate</p>')+
 stage('Weeks 17–18 · Finals',game('Semifinal winner A','Semifinal winner B')+game('Semifinal loser A','Semifinal loser B')+'<p class="muted small">Two-week aggregate; championship and third place</p>')+'</div>')+
 card('Consolation · Single elimination','<p>Initial entrants: '+d.rows.slice(d.slots).map((r,i)=>'#'+(i+d.slots+1)+' '+esc(r.name)).join(' · ')+
 '.</p><p>'+(wild?'Week 14 championship Wild Card losers enter consolation in Week 15.':'No championship Wild Card round for this league size.')+
 ' Eliminated teams continue playing placement matchups through Week 18.</p><p class="muted small">Pairings are not yet generated by the server. This is a preview, not an active bracket.</p>')+
 card('Projected seeds',d.rows.map((r,i)=>'<div class="row"><span>#'+(i+1)+' '+esc(r.name)+' · <b>'+d.status[i]+'</b></span><span class="muted small">'+r.w+'-'+r.l+'-'+r.t+' · '+fmt(r.pf)+' PF</span></div>').join(''))+
 '<p class="muted small">Clinch and elimination use conservative bounds based on verified finals and complete regular-season schedules. Missing data remains In the hunt.</p>';
}

function render(){if(!state||!manager)return;const mine=state.players.filter(x=>x.owner===manager),myTeam=m(manager);
  if(!myTeam)return;
  const pendingInjuries=(state.injuries||[]).filter(i=>i.active&&state.players.some(p=>p.id===i.player&&p.owner===manager));
  if(!document.getElementById('fa-injury-priority-style')){
    const style=document.createElement('style');style.id='fa-injury-priority-style';
    style.textContent='.fa-injury-priority{border:2px solid #e34242;border-radius:14px;padding:12px;margin:12px 0 18px;background:linear-gradient(135deg,rgba(220,38,38,.20) 0%,rgba(220,38,38,.08) 14%,transparent 38%);box-shadow:0 0 0 1px rgba(220,38,38,.12)}.fa-injury-priority>.fa-injury-heading{font-weight:800;color:#ef5555;letter-spacing:.03em;margin-bottom:8px}.fa-injury-priority .card{margin:8px 0}.fa-home-medical-cross{color:#ef5555;font-weight:900;font-size:1.18em;margin-left:5px;vertical-align:middle}';
    document.head.appendChild(style);
  }
  $('tabs').innerHTML=tabs.filter(t=>t!=='Commissioner'||state.viewer.commissioner)
    .map(t=>`<button class="${tab===t?'active':''}" onclick="changeTab('${t}')">${t==='Home'&&pendingInjuries.length?`${t} <span class="fa-home-medical-cross" aria-label="${pendingInjuries.length} pending injury decision${pendingInjuries.length===1?'':'s'}" title="Injury substitution decision pending">✚</span>`:t==='Locker Room'&&chatLastId>chatSeenId?'💬 '+t+' •':t}</button>`).join('');
  let content='';
  if(tab==='Home')content=`${pendingInjuries.length?`<section class="fa-injury-priority" role="alert" aria-label="Pending injury substitution"><div class="fa-injury-heading">✚ INJURY SUBSTITUTION ${pendingInjuries.length===1?'AVAILABLE':'DECISIONS AVAILABLE'}</div>${pendingInjuries.map(injuryCard).join('')}</section>`:''}
    <h1>${esc(state.league)}</h1><p>Week ${state.week} · ${esc(myTeam.team)}</p>
    ${editorialView()}
    <div class="grid">${card('Your score',`<div class="stat">${fmt(total(manager))}</div>`)}
    ${card('Registered teams',`<div class="stat">${state.managers.filter(x=>x.claimed).length} / 12</div>`)}
    ${card('Draft status',`<p>${esc(draftData().status)}</p><button onclick="changeTab('Draft')">Open draft room</button>`)}</div>
    ${card('Recent activity',state.transactions.slice(0,8).map(t=>`<div class="row"><span>${esc(t.details)}</span></div>`).join('')||'<p>No activity yet.</p>')}<p class="muted small" style="text-align:center;opacity:.7">Fantasy Audible · ${esc(faCurrentBuild)}</p>`;
  if(tab==='My Team'){const picks=draftData().picks.filter(x=>x.manager===manager);
    content=`<h1>${teamPhoto(manager,64)} ${esc(myTeam.team)}</h1><button onclick="renameTeam()">Rename My Team</button><div class="fa-photo-editor"><label for="teamPhotoUpload">Team profile photo</label><input id="teamPhotoUpload" type="file" accept="image/jpeg,image/png,image/webp" onchange="uploadTeamPhoto(this)"><button onclick="removeTeamPhoto()" ${myTeam.photo?'':'disabled'}>Remove photo</button><p class="muted small">Images are cropped to a square and resized automatically.</p></div>
      ${card('Drafted players',picks.map(x=>`<div class="row"><div><b>${esc(x.playerName)}</b>
      <div class="muted small">${esc(x.position)} · Pick ${x.overall}</div></div>
      <b>${x.projectedPoints==null?'—':fmt(x.projectedPoints)}</b></div>`).join('')||'<p>No draft picks yet.</p>')}
      ${state.injuries.filter(i=>i.active).map(injuryCard).join('')}
      ${lineupManager(mine)}`;}
  if(tab==='Matchup')content=matchupView();
  if(tab==='Postseason')content=postseasonView();
  if(tab==='League')content=`<h1>League</h1>${card('Teams',state.managers.filter(x=>x.claimed).map(x=>
    `<div class="row"><button type="button" style="display:inline-flex;align-items:center;text-align:left;gap:7px;background:transparent;border:0;padding:6px 0;color:inherit;text-decoration:underline;text-underline-offset:3px" onclick='viewLeagueTeam(${jsAttr(x.id)})' aria-label="View ${esc(x.team)} roster">${teamPhoto(x.id,36)} <b>${esc(x.team)}</b></button><span><small>${esc((()=>{const d=postseasonData(),i=d.rows.findIndex(r=>r.id===x.id);return i<0?"In the hunt":d.status[i]})())}</small> · ${fmt(total(x.id))} pts</span></div>`).join(''))}${leagueTeamRosterView()}
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
  if(tab==='Matchup'){loadWeeklyDirectory();fetchNFLMatchups(selectedMatchupWeek());}
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

// Fantasy Audible launch gate: shown only to authenticated returning users.
// Audio is initiated by the user's tap, satisfying iOS user-gesture playback rules.
let faEntranceReady=false,faEntranceEntering=false,faEntranceAudio=null;
function faEntranceInit(){
  if(!token||document.getElementById('fa-entrance'))return;
  const css=document.createElement('style');css.id='fa-entrance-style';
  css.textContent=`
  #fa-entrance{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;
    overflow:hidden;background:radial-gradient(ellipse at 50% 28%,#142e48 0%,#071522 47%,#020812 100%);
    color:white;cursor:pointer;touch-action:manipulation;isolation:isolate;transition:opacity .75s ease,visibility .75s ease}
  #fa-entrance.fa-exit{opacity:0;visibility:hidden;pointer-events:none}
  #fa-entrance .fa-lights{position:absolute;inset:0;pointer-events:none;
    background:radial-gradient(ellipse 20% 10% at 11% 9%,rgba(255,255,255,.95),transparent 60%),
      radial-gradient(ellipse 20% 10% at 89% 9%,rgba(255,255,255,.95),transparent 60%),
      conic-gradient(from 135deg at 11% 10%,transparent 0deg,rgba(149,206,255,.12) 24deg,transparent 45deg),
      conic-gradient(from 185deg at 89% 10%,transparent 0deg,rgba(149,206,255,.12) 24deg,transparent 45deg);
    opacity:.75;filter:blur(5px)}
  #fa-entrance .fa-field{position:absolute;bottom:-12%;left:-25%;width:150%;height:42%;
    transform:perspective(380px) rotateX(65deg);transform-origin:center bottom;
    background:repeating-linear-gradient(90deg,transparent 0,transparent 16%,rgba(220,243,255,.22) 16.2%,transparent 16.5%),
      repeating-linear-gradient(0deg,transparent 0,transparent 19%,rgba(220,243,255,.18) 19.2%,transparent 19.5%),
      linear-gradient(180deg,#17382d,#06140e);opacity:.48;filter:blur(1px)}
  #fa-entrance .fa-content{position:relative;z-index:2;display:flex;flex-direction:column;align-items:center;
    justify-content:center;gap:clamp(34px,7vh,72px);width:100%;padding:30px 14px;transform:translateY(-2vh)}
  #fa-entrance .fa-logo{width:min(78vw,33dvh,360px);height:min(78vw,33dvh,360px);object-fit:contain;
    border-radius:22%;filter:drop-shadow(0 18px 22px rgba(0,0,0,.6)) drop-shadow(0 0 14px rgba(236,44,53,.32));
    animation:faFloat 3.8s ease-in-out infinite}
  #fa-entrance .fa-enter-label{font-size:clamp(25px,6.4vw,57px);font-style:italic;font-weight:950;letter-spacing:.025em;
    text-align:center;white-space:nowrap;line-height:1.2;max-width:100%;
    background:linear-gradient(110deg,#9eafc4 0%,#fff 19%,#d7e8f9 37%,#fff 47%,#7d99b7 57%,#fff 72%,#c0d5e8 100%);
    background-size:230% 100%;background-position:100% 50%;color:transparent;
    -webkit-background-clip:text;background-clip:text;
    filter:drop-shadow(0 0 9px rgba(176,220,255,.75));
    animation:faWords 2.7s ease-in-out infinite,faShimmer 4.4s linear infinite}
  #fa-entrance .fa-launch-status{font-size:12px;color:#bac8d7;letter-spacing:.13em;min-height:16px}
  #fa-entrance .fa-build-footer{position:absolute;bottom:max(14px,env(safe-area-inset-bottom));left:8px;right:8px;
    text-align:center;font-size:11px;letter-spacing:.09em;color:rgba(208,220,235,.68);font-weight:500;
    font-variant-numeric:tabular-nums;pointer-events:none}
  #fa-entrance.fa-entering .fa-logo{animation:faFlare .6s ease-out forwards}
  #fa-entrance.fa-entering .fa-enter-label{animation:none;opacity:1}
  @keyframes faFloat{0%,100%{transform:translateY(9px) scale(.985)}50%{transform:translateY(-11px) scale(1.018)}}
  @keyframes faWords{0%,100%{opacity:.98}50%{opacity:.10}}
  @keyframes faShimmer{0%{background-position:110% 50%}100%{background-position:-110% 50%}}
  @keyframes faFlare{0%{transform:scale(1);filter:drop-shadow(0 0 12px #d52a35)}
    55%{transform:scale(1.08);filter:drop-shadow(0 0 38px #fff)}
    100%{transform:scale(1.02);filter:drop-shadow(0 0 20px #f44)}}
  @media(prefers-reduced-motion:reduce){
    #fa-entrance .fa-logo,#fa-entrance .fa-enter-label{animation:none!important;opacity:1}
    #fa-entrance{transition:none}}
  `;
  document.head.appendChild(css);
  const overlay=document.createElement('div');overlay.id='fa-entrance';overlay.setAttribute('role','button');
  overlay.setAttribute('tabindex','0');overlay.setAttribute('aria-label','Tap to enter Fantasy Audible');
  overlay.innerHTML='<div class="fa-lights"></div><div class="fa-field"></div>'+
    '<div class="fa-content"><img class="fa-logo" src="data:image/webp;base64,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" alt="Fantasy Audible icon">'+
    '<div class="fa-enter-label">TAP TO ENTER</div><div class="fa-launch-status" aria-live="polite"></div></div>'+
    '<div class="fa-build-footer" id="fa-build-footer">VERSION LOADING…</div>';
  document.body.appendChild(overlay);
  faLoadBuild();
  fetch('/api/build',{cache:'no-store'})
    .then(response=>{if(!response.ok)throw Error('Build info unavailable');return response.json();})
    .then(info=>{
      const footer=document.getElementById('fa-build-footer');
      if(footer)footer.textContent='v'+String(info.version||'1.0.0')+' · Build '+String(info.build||'unavailable');
    })
    .catch(()=>{
      const footer=document.getElementById('fa-build-footer');
      if(footer)footer.textContent='Build information unavailable';
    });
  // Native HTML audio follows iPhone Silent Mode more reliably than Web Audio.
  faEntranceAudio=new Audio('/omaha_first.mp3');
  faEntranceAudio.preload='auto';
  faEntranceAudio.load();
  const enter=()=>{
    if(faEntranceEntering)return;
    if(!faEntranceReady){overlay.querySelector('.fa-launch-status').textContent='CONNECTING TO LEAGUE…';return;}
    faEntranceEntering=true;overlay.classList.add('fa-entering');
    // Play directly inside the user gesture, with no asynchronous audio setup.
    try{
      faEntranceAudio.currentTime=0;
      faEntranceAudio.play().catch(()=>{});
    }catch(e){}
    setTimeout(()=>{overlay.classList.add('fa-exit');
      setTimeout(()=>{overlay.remove();css.remove();},800);},650);
  };
  overlay.addEventListener('click',enter);
  overlay.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();enter();}});
}
function faEntranceDismiss(){
  const overlay=document.getElementById('fa-entrance');
  if(overlay)overlay.remove();
  document.getElementById('fa-entrance-style')?.remove();
  faEntranceReady=false;
}

async function connect(){if(!token)return authForm();faEntranceInit();try{const response=await fetch('/api/state',{
  headers:{Authorization:'Bearer '+token},cache:'no-store'});if(response.status===401){faEntranceDismiss();return logout();}
  if(!response.ok)throw Error('Server unavailable');state=await response.json();manager=state.viewer.manager;render();faEntranceReady=true;loadChat();}
  catch(e){faEntranceDismiss();$('connection').textContent='● Offline';return;}
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
