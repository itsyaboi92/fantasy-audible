'use strict';
// Deterministic event scorer with category-level box-score reconciliation.
const {rawPlays,playerStats,defenseStats,playEvents,resolveKickerEvents}=require('./live-nfl');
const num=x=>Number(x)||0,round=x=>Math.round((x+Number.EPSILON)*100)/100;
const norm=s=>String(s||'').toLowerCase().replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
const id=x=>String(x??'');
const has=(s,re)=>re.test(s);
function ledger(summary){return rawPlays(summary).map(p=>({id:id(p.id),teamId:id(p.team?.id||p.teamId),text:String(p.text||p.shortText||''),type:String(p.type?.text||''),scoring:!!p.scoringPlay,participants:(p.participants||[]).map(x=>id(x.athlete?.id||x.id)).filter(Boolean),raw:p}));}
function surname(p){return norm(p.name).split(' ').at(-1)||'';}
function personMatch(text,p){const full=norm(p.name),last=surname(p);return !!(full&&(norm(text).includes(full)||(last.length>2&&new RegExp('\\b'+last+'\\b','i').test(text))));}
function fieldGoal(text){return text.match(/\b(\d{1,2})\s*[- ]?(?:yd|yard)s?\s+(?:field goal|fg)\b/i)||text.match(/\b(?:field goal|fg)\s+(?:of\s+|from\s+)?(\d{1,2})\s*(?:yd|yard)/i);}
function pointsBracket(n,r,prefix){const suffix=n===0?'0':n<=6?'1to6':n<=13?'7to13':n<=17?'14to17':n<=27?'18to27':n<=34?'28to34':n<=45?'35to45':'46plus';return r[prefix+suffix];}
function yardsBracket(n,r){const key=n<100?'Under100':n<200?'100to199':n<300?'200to299':n<350?'300to349':n<400?'350to399':n<450?'400to449':n<500?'450to499':n<550?'500to549':'550plus';return r['yardsAllowed'+key];}
function isConversion(t){return /two.point|2.point|2.pt|two point conversion|2 point conversion/i.test(t);}
function playYards(t){const m=t.match(/\bfor\s+(-?\d+)\s*(?:yards?|yds?)\b/i)||t.match(/\b(-?\d+)\s*(?:yards?|yds?)\s+(?:run|rush|pass|reception)\b/i);return m?Number(m[1]):null;}
function addEvent(a,e,kind,value=1){a.push({playId:e.id,kind,value,text:e.text});}
function extractPlayer(e,p){
 const a=[],t=e.text,type=e.type,all=t+' '+type,last=surname(p),player=personMatch(t,p);
 if(!last||!player)return a;
 const escaped=last.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 const subject=new RegExp('^\\s*(?:[A-Z]\\.\\s*)?(?:[A-Za-z.\'-]+\\s+){0,3}'+escaped+'\\b','i').test(t);
 const pass=/\bpass(?:es|ed|ing)?\b/i.test(all),intercept=/\bintercepted\b/i.test(t);
 const receiving=new RegExp('\\bpass\\s+(?:complete\\s+)?to\\s+[^,;()]{0,60}\\b'+escaped+'\\b','i').test(t)||new RegExp('\\b'+escaped+'\\b\\s+(-?\\d+)\\s*(?:yd|yard)s?\\s+(?:reception|pass)','i').test(t);
 const rushing=subject&&/\b(?:run|rush|rushed|scramble|scrambled|up the middle|left end|right end|left tackle|right tackle|left guard|right guard)\b/i.test(all)&&!pass;
 const y=playYards(t),td=/\btouchdown\b/i.test(all),two=isConversion(all),good=/\b(?:good|successful|succeeds|converted)\b/i.test(all)&&!/\b(?:no good|unsuccessful|failed|not good)\b/i.test(all);
 if(subject&&pass){if(!two&&y!==null&&!intercept&&/\bpass\s+(?:complete\s+)?to\b/i.test(t))addEvent(a,e,'passYards',y);
  if(intercept)addEvent(a,e,'passINT');if(td&&!intercept&&!two){addEvent(a,e,'passTD');if(y>=40)addEvent(a,e,'passTD40');}if(two&&good)addEvent(a,e,'passTwo');}
 if(rushing&&y!==null){if(!two)addEvent(a,e,'rushYards',y);if(td&&!two){addEvent(a,e,'rushTD');if(y>=40)addEvent(a,e,'rushTD40');}if(two&&good)addEvent(a,e,'rushTwo');}
 if(receiving&&y!==null&&!intercept){if(!two){addEvent(a,e,'recYards',y);addEvent(a,e,'receptions');if(td){addEvent(a,e,'recTD');if(y>=40)addEvent(a,e,'recTD40');}}else if(good)addEvent(a,e,'recTwo');}
 const fg=fieldGoal(t);if(fg){const miss=/\b(?:no good|missed|blocked|wide|failed|unsuccessful)\b/i.test(t);if(miss)addEvent(a,e,'fgMiss',Number(fg[1]));else if(/\b(?:good|made|successful)\b/i.test(t)||e.scoring)addEvent(a,e,'fgMade',Number(fg[1]));}
 // ESPN touchdown scoring summaries include the PAT kicker in parentheses.
 // A touchdown scorer must never inherit that kick merely because their
 // name occurs elsewhere in the same description. Only explicit kicker
 // attribution qualifies; unresolved attempts defer to the official kicker
 // box-score aggregate (never to the touchdown scorer).
 const patMention=/\bextra[ -]?point\b|\bPAT\b|\([^)]*\b(?:kick|extra[ -]?point)\b[^)]*\)/i.test(all);
 if(patMention&&!isConversion(all)){
  const kickerAttribution=t.match(/\(\s*([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,2})\s+(?:kick|extra[ -]?point)(?:\s+(?:good|no good|missed|blocked))?\s*\)/i)
   ||t.match(/\b([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,2})\s+(?:extra[ -]?point|PAT|kick)\s+(?:is\s+)?(?:good|made|missed|blocked|no good)\b/i)
   ||t.match(/\b(?:extra[ -]?point|PAT)\s+(?:by|attempt\s+by)\s+([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,2})\b/i);
  if(kickerAttribution&&norm(kickerAttribution[1])===norm(p.name)){
   const patText=kickerAttribution[0];
   if(/\b(?:no good|missed|blocked|failed|unsuccessful)\b/i.test(patText))addEvent(a,e,'patMiss');
   else if(/\b(?:good|made|successful|kick)\b/i.test(patText)||e.scoring)addEvent(a,e,'patMade');
  }
 }
 // A play mentioning a kicker, returner and recovery does not make all three
 // the fumbler. Require the athlete to be the explicitly named fumble owner.
 // When ESPN supplies no owner, defer to that athlete's official LOST total.
 if (/\bfumbl/i.test(t) && /\brecover(?:ed|y)\b/i.test(t)) {
  const beforeRecovery=t.split(/\brecover(?:ed|y)\s+by\b/i)[0];
  const ownerPatterns=[
   new RegExp('\\b'+escaped+'\\b\\s+(?:\\([^)]*\\)\\s*)?(?:fumbles?|fumbled)\\b','i'),
   new RegExp('\\b(?:fumble\\s+by|fumbled\\s+by)\\s+(?:[A-Za-z.\\-]+\\s+){0,3}'+escaped+'\\b','i')
  ];
  if (ownerPatterns.some(re=>re.test(beforeRecovery))) {
   const after=t.split(/\brecovered by\b/i)[1]||'';
   // A same-player recovery is not a fumble lost. For others, team
   // ownership must be confirmed; otherwise the box-score LOST field wins.
   if (after && !new RegExp('\\b'+escaped+'\\b','i').test(after) &&
       e.raw?.fumbleLost === true) addEvent(a,e,'fumblesLost');
  }
 }
 if(td&&/\bkickoff\s+return\b/i.test(all))addEvent(a,e,'kickoffReturnTD');
 if(td&&/\bpunt\s+return\b/i.test(all))addEvent(a,e,'puntReturnTD');
 if(td&&/\bfumble\s+(?:recovery|return)\b/i.test(all))addEvent(a,e,'fumbleRecoveryTD');
 if(td&&/\binterception\s+return\b/i.test(all))addEvent(a,e,'interceptionReturnTD');
 if(td&&/\bblocked\s+(?:punt|kick|field goal)\b/i.test(all))addEvent(a,e,'blockedKickReturnTD');
 if(two&&good&&/\breturn\b/i.test(all))addEvent(a,e,'twoPointReturn');
 return a;
}
function scoreEvents(events,rules){const r=rules||{},p=r.passing||{},ru=r.rushing||{},re=r.receiving||{},k=r.kicking||{},m=r.miscellaneous||{};
 const counts={};for(const e of events)if(!['fgMade','fgMiss'].includes(e.kind))counts[e.kind]=(counts[e.kind]||0)+e.value;
 const breakdown=[];let points=0;const add=(label,quantity,rate)=>{if(!quantity||!Number.isFinite(Number(rate)))return;const value=round(quantity*Number(rate));points+=value;breakdown.push({label,quantity,rate:Number(rate),points:value});};
 for(const [kind,label,rate] of [['passYards','Passing yards',p.yards],['passTD','Passing TD',p.touchdowns],['passTD40','40+ passing TD',p.touchdowns40],['passINT','Interceptions thrown',p.interceptions],['passTwo','Passing 2PT',p.twoPoint],['rushYards','Rushing yards',ru.yards],['rushTD','Rushing TD',ru.touchdowns],['rushTD40','40+ rushing TD',ru.touchdowns40],['rushTwo','Rushing 2PT',ru.twoPoint],['recYards','Receiving yards',re.yards],['receptions','Receptions',re.receptions],['recTD','Receiving TD',re.touchdowns],['recTD40','40+ receiving TD',re.touchdowns40],['recTwo','Receiving 2PT',re.twoPoint],['patMade','PAT made',k.patMade],['patMiss','PAT missed',k.patMissed],['fumblesLost','Fumbles lost',m.fumblesLost],['kickoffReturnTD','Kickoff return TD',m.kickoffReturnTD],['puntReturnTD','Punt return TD',m.puntReturnTD],['fumbleRecoveryTD','Fumble recovery TD',m.fumbleRecoveryTD],['interceptionReturnTD','Interception return TD',m.interceptionReturnTD],['blockedKickReturnTD','Blocked kick return TD',m.blockedKickReturnTD],['twoPointReturn','Two point return',m.twoPointReturn]])add(label,counts[kind]||0,rate);
 for(const e of events.filter(x=>x.kind==='fgMade'||x.kind==='fgMiss')){const y=e.value;add(`${e.kind==='fgMade'?'Field goal':'Missed field goal'} ${y} yd`,1,e.kind==='fgMiss'?(y<40?k.fgMiss0to39:0):(y>=60?k.fg60plus:y>=50?k.fg50to59:y>=40?k.fg40to49:k.fg0to39));}
 if(counts.rushYards>=100&&counts.rushYards<200)add('100–199 rushing yards',1,ru.yards100to199);
 if(counts.recYards>=100&&counts.recYards<200)add('100–199 receiving yards',1,re.yards100to199);
 return {points:round(points),breakdown,counts};}
// Each aggregate is a category-level replacement, never an additional award.
// Event-only details (FG distances, long TDs, return TDs) are retained.
function numericStat(group,...names){
 if(!group)return null;
 for(const name of names){const v=group[name];if(v!==undefined&&v!==null&&String(v).trim()!==''&&!String(v).includes('/')){const n=Number(String(v).replace(/,/g,''));if(Number.isFinite(n))return n;}}
 return null;
}
function aggregatePlayer(summary,p){
 const b=playerStats(summary).get(id(p.id));if(!b)return {};
 const a=b.passing||{},r=b.rushing||{},c=b.receiving||{},m=b.misc||{},k=b.kicking||{};
 const pair=x=>{const z=String(x??'').match(/^(\d+)\s*\/\s*(\d+)$/);return z?{made:+z[1],attempts:+z[2]}:null;};
 const fg=pair(k.FG??k.FGA),xp=pair(k.XP??k.XPA);
 return {passYards:numericStat(a,'YDS'),passTD:numericStat(a,'TD'),passINT:numericStat(a,'INT'),passTwo:numericStat(a,'2PT'),rushYards:numericStat(r,'YDS'),rushTD:numericStat(r,'TD'),rushTwo:numericStat(r,'2PT'),recYards:numericStat(c,'YDS'),receptions:numericStat(c,'REC'),recTD:numericStat(c,'TD'),recTwo:numericStat(c,'2PT'),fumblesLost:numericStat(m,'LOST','FL','FUMLOST','FUMBLESLOST'),patMade:xp?xp.made:numericStat(k,'XPM','XPMADE'),patMiss:xp?xp.attempts-xp.made:numericStat(k,'XPMISS','XPMISSED'),fgMade:fg?fg.made:numericStat(k,'FGM','FGMADE'),fgMiss:fg?fg.attempts-fg.made:numericStat(k,'FGMISS','FGMISSED')};
}
function playerLedger(summary,p,rules){
 const plays=ledger(summary),raw=plays.flatMap(e=>extractPlayer(e,p)),aggregate=aggregatePlayer(summary,p),events=[...raw],discrepancies=[],sources={};
 // Reuse the v34 kicker extractor that was validated against Cam Little's
 // 36, 45, 47 and 33-yard kicks. Event IDs prevent double counting.
 const kickerEvents=resolveKickerEvents(playEvents(summary),p);
 for(const kick of kickerEvents){
   const kind=kick.kind==='fieldGoalMade'?'fgMade':'fgMiss';
   if(!events.some(e=>e.playId===kick.playId&&e.kind===kind))events.push({playId:kick.playId,kind,value:kick.yards,text:kick.text});
 }

 const categories=['passYards','passTD','passINT','passTwo','rushYards','rushTD','rushTwo','recYards','receptions','recTD','recTwo','fumblesLost','patMade','patMiss'];
 for(const kind of categories){
  const observed=events.filter(e=>e.kind===kind).reduce((a,e)=>a+e.value,0),official=aggregate[kind];
  if(official===null||official===undefined){sources[kind]='events';continue;}
  if(observed!==official){
   discrepancies.push({stat:kind,box:official,events:observed,resolved:'box-score-category'});
   for(let i=events.length-1;i>=0;i--)if(events[i].kind===kind)events.splice(i,1);
   if(official)events.push({playId:'aggregate:'+kind,kind,value:official,text:'ESPN category fallback'});
   sources[kind]='box-score';
  }else sources[kind]='verified-events';
 }
 // FG distance buckets are authoritative. A count discrepancy cannot be
 // converted into an invented distance or a fabricated 3-point kick.
 for(const kind of ['fgMade','fgMiss']){
  const observed=events.filter(e=>e.kind===kind).length,official=aggregate[kind];
  if(official!==null&&official!==undefined&&official!==observed)discrepancies.push({stat:kind,box:official,events:observed,resolved:'unverified-distance'});
  sources[kind]='events';
 }
 const scored=scoreEvents(events,rules);
 return {...scored,events,discrepancies,sources,complete:plays.length>0&&discrepancies.every(x=>x.resolved==='box-score-category'),source:'hybrid-category-reconciliation',unsupported:discrepancies.filter(x=>x.resolved==='unverified-distance').map(x=>x.stat+' distance unverified')};
}
function eventYards(e){const t=e.text,kind=e.type;if(/\b(?:kickoff|punt|field goal|extra point|penalty|timeout|kneel)\b/i.test(kind+' '+t))return null;if(/\bintercepted\b|\bincomplete\b|\bno gain\b/i.test(t))return 0;
 if(/\bsacked\b/i.test(t))return playYards(t);if(/\b(?:pass|rush|run|scramble)\b/i.test(kind+' '+t))return playYards(t);return null;}
// Conservative special-teams turnover classification. Never infer recovery
// ownership from a kicker's name or from the play.team field alone.
function specialTeamsTurnover(e, game, summary){
 const t=e.text, kind=e.type, raw=e.raw||{};
 const kickoff=/\bkick\s*off\b|\bkickoff\b/i.test(kind+' '+t);
 const punt=/\bpunt\b/i.test(kind+' '+t);
 if(!kickoff&&!punt||!/\bfumbl/i.test(t)||!/\brecover(?:ed|y)\b/i.test(t))return null;
 const teams=game?.teams||[];
 if(teams.length!==2)return null;
 const kicking=id(e.teamId);
 if(!teams.some(x=>id(x.id)===kicking))return null;
 const returning=id(teams.find(x=>id(x.id)!==kicking)?.id);
 const fumbler=t.match(/(?:^|[.;,]\s*)([A-Z][A-Za-z'-]+(?:\s+[A-Z][A-Za-z'-]+){0,2})\s+(?:fumbles|fumbled)\b/i)||t.match(/\bfumbled?\s+by\s+([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,3})/i);
 if(!fumbler)return null;
 // Require a return context: the fumbler must appear after the kick and
 // before the recovery, not merely elsewhere in the description.
 const before=t.split(/\brecovered\s+by\b/i)[0];
 if(!/\breturn(?:ed|er|s|ing)?\b|\bto\s+[A-Z]{2,3}\s*\d+\b/i.test(before))return null;
 const recoveryText=(t.match(/\brecovered\s+by\s+([^.;,]+)/i)||[])[1]||'';
 const recoveryRaw=raw.recoveryTeam?.id||raw.recoveringTeam?.id||raw.recoveryTeamId||raw.recoveringTeamId||raw.fumbleRecovery?.team?.id;
 let recovery=id(recoveryRaw);
 if(!recovery){
  const aliases={ '33':['baltimore','ravens','bal'], '30':['jacksonville','jaguars','jax','jac'] };
  const matches=teams.filter(team=>[team.displayName,team.name,...(aliases[id(team.id)]||[]).filter(x=>x.length>3)].filter(Boolean).some(n=>new RegExp('\\b'+String(n).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\b','i').test(recoveryText)));
  if(matches.length===1)recovery=id(matches[0].id);
 }
 if(!recovery&&recoveryText&&summary){
  const ownerTeams=new Set();
  const clean=x=>norm(x).replace(/[^a-z ]/g,'').trim();
  const wanted=clean(recoveryText);
  for(const boxTeam of summary.boxscore?.players||[]){
   for(const group of boxTeam.statistics||[])for(const entry of group.athletes||[]){
    const athlete=entry.athlete||{};
    const full=clean(athlete.displayName||athlete.fullName||'');
    if(full&&(wanted===full||wanted.startsWith(full+' ')||wanted.includes(' '+full+' ')))ownerTeams.add(id(boxTeam.team?.id));
   }
  }
  if(ownerTeams.size===1)recovery=[...ownerTeams][0];
 }
 if(!recovery||recovery===returning||!teams.some(x=>id(x.id)===recovery))return null;
 return {playId:e.id,returning,recovery,kind:kickoff?'kickoff':'punt',fumbler:fumbler[1].trim()};
}
function teamLedger(summary,teamId,opponentId,rules,game){
 // All D/ST categories, including scoring, use ESPN box score exclusively.
 // No play-by-play fallback or return-fumble-lost penalty.
 const box=defenseStats(summary,game,[]).get(id(teamId));
 if(!box)return {points:0,breakdown:[],counts:{},statDetails:{},unsupported:['D/ST box score unavailable'],complete:false,source:'espn-boxscore-only'};
 const {scoreDefense}=require('./live-nfl');
 const scored=scoreDefense(box,rules||{});
 const mapping={sack:'sacks',interception:'interceptions',fumbleRecovered:'fumbleRecovered',forcedFumble:'forcedFumble',safety:'safety',blockedKick:'blockedKick',interceptionTD:'interceptionTD',fumbleReturnTD:'fumbleReturnTD',puntReturnTD:'puntReturnTD',kickoffReturnTD:'kickoffReturnTD',blockedKickReturnTD:'blockedKickReturnTD',twoPointReturn:'twoPointReturn',onePointSafety:'onePointSafety'};
 const counts={},statDetails={},final=game?.status==='final';
 for(const [key,field] of Object.entries(mapping)){
  const available=Object.prototype.hasOwnProperty.call(box.stats,field);
  if(available)counts[key]=box.stats[field];
  statDetails[key]={value:available?box.stats[field]:null,source:available?'ESPN box score':'unavailable',verified:available&&final};
 }
 for(const [key,value] of Object.entries({pointsAllowed:box.pointsAllowed,yardsAllowed:box.yardsAllowed}))
  statDetails[key]={value:value??null,source:value===null||value===undefined?'unavailable':'ESPN box score',verified:value!==null&&value!==undefined&&final};
 return {...scored,counts,statDetails,events:[],discrepancies:[],sources:{},pointsAllowed:box.pointsAllowed,yardsAllowed:box.yardsAllowed,source:'espn-boxscore-only',complete:final&&!scored.unsupported.length};
}
module.exports={ledger,extractPlayer,playerLedger,teamLedger,scoreEvents,eventYards,specialTeamsTurnover};
