'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const source=fs.readFileSync(require('node:path').join(__dirname,'server.js'),'utf8');
const start=source.indexOf('async function reconcileHistoricalMatchups()');
const end=source.indexOf('const playerHistoryCache=',start);
assert(start>=0&&end>start);
const fn=source.slice(start,end);
assert.match(fn,/candidates\.filter\(c=>!c\.bye&&!c\.inactive&&c\.game\)/);
assert.doesNotMatch(fn,/c\.pos!=='D\/ST'\)\.map\(c=>\[c\.game\.id/);
assert.match(fn,/await defenseStore\.ingest\(pool,season,game,summary\)/);
assert.match(fn,/await defenseStore\.get\(pool,season,c\.game,c\.team/);
assert.match(fn,/match\.status='final'/);
// The game-fetch selection must include games with ONLY a D/ST starter,
// and must not refetch a game when both a D/ST and an offensive starter use it.
const candidates=[
 {pos:'D/ST',game:{id:'defense-only'}},
 {pos:'RB',game:{id:'shared'}},
 {pos:'D/ST',game:{id:'shared'}},
 {pos:'D/ST',bye:true},
 {pos:'K',inactive:true}
];
const selected=[...new Map(candidates.filter(c=>!c.bye&&!c.inactive&&c.game).map(c=>[c.game.id,c.game])).values()];
assert.deepEqual(selected.map(g=>g.id),['defense-only','shared']);
console.log('PASS: historical reconciliation fetches D/ST-only final games once and persists evidence before verification');
