import test from 'node:test';
import assert from 'node:assert/strict';
import {apiRequest,connectionErrors} from '../src/apiClient.ts';
test('connection errors surface and a successful retry clears them',async()=>{
 const original=global.fetch;
 try {
  global.fetch=async()=>{throw new TypeError('Failed to fetch');};
  await assert.rejects(apiRequest('/api/study',{action:'snapshots'}),/Cannot connect/);
  assert.match(connectionErrors().join(' '),/Saving your progress/);
  global.fetch=async()=>new Response('{"saved":true}',{status:200});
  assert.deepEqual(await apiRequest('/api/study',{action:'snapshots'}),{saved:true});
  assert.equal(connectionErrors().length,0);
  global.fetch=async()=>new Response('Bad gateway',{status:502});
  await assert.rejects(apiRequest('/api/recall',{action:'generate'}),/unexpected response \(502\)/);
  global.fetch=async()=>{throw new DOMException('timeout','TimeoutError');};
  await assert.rejects(apiRequest('/api/recall',{action:'generate'}),/timed out/);
  global.fetch=async()=>new Response('{"error":"A valid study session is required"}',{status:403});
  await assert.rejects(apiRequest('/api/study',{action:'chat'}),/valid study session/);
 } finally {global.fetch=original;}
});
