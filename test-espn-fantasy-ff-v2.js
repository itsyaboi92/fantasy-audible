const {inspect}=require('./verify-espn-fantasy-ff-v2');
const report=inspect([{player:{defaultPositionId:16,proTeamId:4,fullName:'Bengals D/ST',stats:[
{seasonId:2026,scoringPeriodId:9,statSplitTypeId:0,statSourceId:0,stats:{106:5}},
{seasonId:2026,scoringPeriodId:9,statSplitTypeId:1,statSourceId:0,stats:{106:1}},
{seasonId:2026,scoringPeriodId:9,statSplitTypeId:1,statSourceId:1,stats:{106:3}}]}}]);
if(report.cin.weeklyFF!==1)throw Error('Did not isolate actual weekly FF');
console.log('PASS weekly vs season and actual vs projected');
