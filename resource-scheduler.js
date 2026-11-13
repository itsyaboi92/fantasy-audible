'use strict';
// A single process-local gate for memory-heavy ESPN operations. Skipped ticks
// are retried on the next interval, never queued into an unbounded backlog.
function createResourceScheduler({logger=console, memory=()=>process.memoryUsage(), now=()=>Date.now()}={}) {
  let active=null;
  const stats={started:0,completed:0,failed:0,skipped:0};
  const mb=n=>Math.round(n/1048576);
  function sample(){const m=memory();return {rssMB:mb(m.rss),heapUsedMB:mb(m.heapUsed),externalMB:mb(m.external||0),arrayBuffersMB:mb(m.arrayBuffers||0)};}
  async function run(name,task){
    if(active){stats.skipped++;logger.warn('[resource-job] skipped',name,'busy='+active.name);return false;}
    const started=now();active={name,started};stats.started++;
    const before=sample();logger.info('[resource-job] start',name,JSON.stringify(before));
    try {await task();stats.completed++;return true;}
    catch(err){stats.failed++;logger.error('[resource-job] failed',name,err?.message||err);return false;}
    finally {const after=sample();logger.info('[resource-job] end',name,'durationMs='+String(now()-started),JSON.stringify(after),'rssDeltaMB='+String(after.rssMB-before.rssMB));active=null;}
  }
  function status(){return {active:active?.name||null,stats:{...stats},memory:sample()};}
  return {run,status};
}
module.exports={createResourceScheduler};
