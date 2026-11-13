'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const server=fs.readFileSync(__dirname+'/server.js','utf8');
const injury=require('./injury-substitutions');
const ledger=require('./league-ledger');
const roster=require('./roster-rules');
for(const [name,owner] of Object.entries({injurySwapWeek:'injury-substitutions.js',expireOldInjuryState:'injury-substitutions.js',eligibility:'injury-substitutions.js',updateWeeklyLedger:'league-ledger.js',leagueStandings:'league-ledger.js',ledgerLineup:'league-ledger.js',currentWeekScore:'league-ledger.js',lineupLockReason:'roster-rules.js',lineupLocked:'roster-rules.js'})){
  assert(!new RegExp('(?:^|\\n)(?:async )?function '+name+'\\(').test(server),`${name} still implemented in server.js`);
  assert(fs.readFileSync(__dirname+'/'+owner,'utf8').includes('function '+name+'('),`${name} missing from ${owner}`);
}
assert.equal(injury.injurySwapRetired({week:10,injurySwapHistory:[{week:9,removedId:'a'}]},{id:'a'}),false);
assert.equal(injury.injurySwapRetired({week:10,injurySwapHistory:[{week:10,removedId:'a'}]},{id:'a'}),true);
assert.equal(ledger.currentWeekScore({scoreWeek:9,points:32},10),0);
assert.equal(roster.slotEligible({pos:'TE'},'FLEX'),true);
assert.equal(roster.slotEligible({pos:'QB'},'FLEX'),false);
console.log('PASS authoritative module ownership and cross-module invariants');
