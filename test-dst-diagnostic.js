const assert=require('node:assert/strict');const {inspect,findGame}=require('./diagnose-dst-espn');
const summary={boxscore:{players:[{team:{id:'4',abbreviation:'CIN'},statistics:[{name:'defensive',labels:['TOT','FF'],athletes:[{athlete:{displayName:'Barrett Carter'},stats:['5','1']}]}]}]}};
const rows=inspect(summary);assert.equal(rows[0].groups[0].forcedFumbleColumns[0].i,1);assert.equal(rows[0].groups[0].athletes[0].name,'Barrett Carter');
assert.equal(findGame({events:[{competitions:[{competitors:[{team:{abbreviation:'CIN'}}]}]}]},'CIN')!==undefined,true);
console.log('PASS: read-only diagnostic fixture');
