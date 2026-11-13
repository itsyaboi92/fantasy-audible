const fs=require('fs'),vm=require('vm'),assert=require('assert');
const src=fs.readFileSync('public/app.js','utf8');
function fn(name){const start=src.indexOf('function '+name+'(');assert(start>=0,name);let depth=0,open=src.indexOf('{',start);for(let i=open;i<src.length;i++){if(src[i]==='{')depth++;if(src[i]==='}'&&!--depth)return src.slice(start,i+1);}throw Error(name)}
const context={state:{week:10,nflDirectorySync:{season:2026,currentWeek:10}},nflPlayerMetaCache:{'2026:10':{data:{players:{'123':{teamId:'4',weeklyProjectedPoints:16.5,lastCompletedPoints:22.4,lastCompletedWeek:9}}}}},nflMatchupCache:{'2026:10':{data:{teams:{'4':{status:'upcoming'}}}}},weeklyDirectory:{},selectedMatchupWeek:()=>10,fmt:n=>String(n),esc:x=>x,tradeGiving:[],tradeReceiving:[],jsAttr:x=>JSON.stringify(x)};
vm.createContext(context);vm.runInContext(['playerNextProjection','weeklyCell','tradeLastScore','tradePlayerRow'].map(fn).join('\n'),context);
const player={id:'espn-123',espnId:'123',name:'Example Player',pos:'RB',slot:'BENCH'};
assert.equal(context.playerNextProjection(player),16.5);
assert.equal(context.tradeLastScore(player),22.4);
assert.match(context.tradePlayerRow(player,'give'),/Proj 16.5 · Last 22.4/);
context.weeklyDirectory['123']={gameStatus:'playing',points:8,week:10};assert.equal(context.tradeLastScore(player),22.4,'live points must not replace last completed game');
context.weeklyDirectory['123']={gameStatus:'final',points:19,week:10};assert.equal(context.tradeLastScore(player),19);
context.nflPlayerMetaCache['2026:10'].data.players['123'].weeklyProjectedPoints=null;assert.equal(context.playerNextProjection(player),null,'missing projection is not fabricated');
assert(src.includes("tab==='League'||selectedMatchupWeek()===week"),'League rerender on metadata arrival');
assert(src.includes("if(tab==='League'){loadTrades();loadWeeklyDirectory();fetchNFLMatchups"),'League triggers metadata load');
console.log('Trade Central scoring mapping, completed-week scores, no invented projections, and League refresh passed');
