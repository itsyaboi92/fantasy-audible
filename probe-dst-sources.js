'use strict';
const fs=require('node:fs');
const targets=[
 {name:'FOX Sports',url:'https://www.foxsports.com/nfl/week-9-cincinnati-bengals-vs-atlanta-falcons-nov-08-2026-game-boxscore-11135?tab=boxscore'},
 {name:'The Football Database',url:'https://www.footballdb.com/games/boxscore/cincinnati-bengals-vs-atlanta-falcons-2026110811'},
 {name:'CBS Sports',url:'https://www.cbssports.com/nfl/gametracker/boxscore/NFL_20261108_CIN%40ATL/'}
];
(async()=>{let results=[];for(const t of targets){try{const r=await fetch(t.url,{headers:{'User-Agent':'Mozilla/5.0 (compatible; FantasyAudibleDiagnostic/1.0)'}});const body=await r.text();const stripped=body.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ');const hits=[...stripped.matchAll(/(?:Barrett\s+Carter|B\.\s*Carter|forced fumbles?|\bFF\b)/gi)].slice(0,12).map(m=>stripped.slice(Math.max(0,m.index-110),m.index+180));results.push({source:t.name,url:t.url,http:r.status,bytes:body.length,mentionsCarter:/Barrett\s+Carter|B\.\s*Carter/i.test(stripped),mentionsFF:/forced fumbles?|\bFF\b/i.test(stripped),excerpts:hits,warning:'Presence of a column does not establish live reliability, attribution, or permission to scrape.'});}catch(e){results.push({source:t.name,error:String(e)})}}fs.writeFileSync('dst-source-probe.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results.map(({source,http,mentionsCarter,mentionsFF,error})=>({source,http,mentionsCarter,mentionsFF,error})),null,2))})().catch(e=>{console.error(e);process.exitCode=1});
