const {inspect}=require('./verify-espn-fantasy-ff');
const x=inspect([{player:{defaultPositionId:16,proTeamId:4,fullName:'Bengals',stats:[{statSourceId:0,scoringPeriodId:9,stats:{106:1}},{statSourceId:1,scoringPeriodId:9,stats:{106:2}}]}}]);
if(x.teams[0].actualFF!==1||x.teams[0].projectedHas106!==true)throw Error('test failed');
console.log('PASS actual vs projected fixture');
