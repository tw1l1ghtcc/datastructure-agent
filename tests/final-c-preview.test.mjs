import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createCPreviewServer } from '../scripts/preview-final-c.mjs';
test('独立预览真实HTTP：五算法、源码和播放器、坏输入与路径隔离',async()=>{
  const server=createCPreviewServer();server.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}`;
  try{
    assert.match(await(await fetch(base)).text(),/createPlayback/);
    assert.match(await(await fetch(base+'/playback.js')).text(),/export function createPlayback/);
    const entries=await(await fetch(base+'/api/algorithms')).json();assert.equal(entries.length,5);
    for(const entry of entries){const res=await fetch(base+'/api/run',{method:'POST',body:JSON.stringify({algorithm:entry.id,input:entry.example})});assert.equal(res.status,200);const run=await res.json();assert.ok(run.runId);assert.equal(run.steps.at(-1).done,true);assert.ok(run.sourceLines.some(l=>l.lineId===run.steps.at(-1).lineId));}
    for(const body of ['null','{',JSON.stringify({algorithm:'b-tree',input:{keys:['bad']}})])assert.equal((await fetch(base+'/api/run',{method:'POST',body})).status,400);
    assert.equal((await fetch(base+'/api/run',{method:'POST',body:'{"algorithm":"toString","input":{}}'})).status,404);
    assert.equal((await fetch(base+'/.env')).status,404);
    assert.equal((await fetch(base+'/api/run',{method:'POST',body:' '.repeat(11000)})).status,400);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
