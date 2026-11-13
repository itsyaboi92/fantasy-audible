'use strict';
const assert=require('node:assert/strict');
const {createResourceScheduler}=require('./resource-scheduler');
const logs=[];const logger={info:(...x)=>logs.push(x),warn:(...x)=>logs.push(x),error:(...x)=>logs.push(x)};
const s=createResourceScheduler({logger,memory:()=>({rss:200*1048576,heapUsed:90*1048576,external:0,arrayBuffers:0})});
(async()=>{
 let release;const wait=new Promise(resolve=>{release=resolve;});let runs=0;
 const first=s.run('scoring',async()=>{runs++;await wait;});
 assert.equal(await s.run('directory',async()=>{runs++;}),false,'parallel job must be skipped');
 assert.equal(runs,1);release();assert.equal(await first,true);
 assert.equal(await s.run('directory',async()=>{runs++;}),true);
 assert.equal(runs,2);assert.equal(s.status().stats.skipped,1);
 assert.equal(await s.run('failed',async()=>{throw Error('test failure');}),false);
 assert.equal(s.status().active,null);
 assert.equal(await s.run('retry',async()=>{runs++;}),true);
 assert.equal(s.status().stats.failed,1);
 assert.equal(s.status().memory.rssMB,200);
 console.log('resource scheduler tests passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
