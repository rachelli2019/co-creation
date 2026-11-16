import test from 'node:test';
import assert from 'node:assert/strict';
import {issueSession,readSession,sameOrigin,requireSession} from '../server/study-auth.mjs';
import {phaseAllowed,verifyProlific,studyRequest} from '../server/study.mjs';
const env={STUDY_SESSION_SECRET:'test-secret-at-least-thirty-two-characters',SUPABASE_URL:'https://example.invalid',SUPABASE_SERVICE_ROLE_KEY:'test'};
const id='12345678-1234-1234-1234-123456789abc';
test('signed sessions reject forgery, expiry, and missing cookies',()=>{
 const token=issueSession(id,env,1000);
 assert.equal(readSession(`study_session=${token}`,env,2000).id,id);
 assert.equal(readSession(`study_session=${token}x`,env,2000),null);
 assert.equal(readSession(`study_session=${token}`,env,7201001),null);
 assert.equal(readSession('',env),null);
});
test('cross-site browser writes and cross-session access are rejected',async()=>{
 assert.equal(sameOrigin({headers:{origin:'https://attacker.example',host:'study.example'}}),false);
 assert.equal(await requireSession(`study_session=${issueSession(id,env)}`,{sessionId:'other'},env),null);
});
test('AI schedule and server deadlines are enforced',()=>{
 const s={ai_access:'rough',rough_started_at:new Date(1000).toISOString()};
 assert.equal(Boolean(phaseAllowed(s,'rough',2000)),true);
 assert.equal(Boolean(phaseAllowed(s,'final',2000)),false);
 assert.equal(Boolean(phaseAllowed(s,'rough',601001)),false);
 assert.equal(Boolean(phaseAllowed({...s,final_started_at:new Date().toISOString()},'rough',2000)),false);
});
test('closed enrollment does not contact a provider',async()=>{
 assert.equal((await studyRequest({action:'start'},{env})).status,403);
});
test('Prolific eligibility requires exact participant, study, active submission',async()=>{
 const body={prolificId:'a'.repeat(24),prolificSessionId:'b'.repeat(24),studyId:'c'.repeat(24)};
 const settings={PROLIFIC_API_TOKEN:'test',PROLIFIC_STUDY_ID:body.studyId};
 const valid={participant:body.prolificId,study_id:body.studyId,status:'ACTIVE'};
 assert.equal(await verifyProlific(body,settings,async()=>Response.json(valid)),true);
 assert.equal(await verifyProlific(body,settings,async()=>Response.json({...valid,participant:'other'})),false);
 assert.equal(await verifyProlific(body,settings,async()=>Response.json({...valid,status:'APPROVED'})),false);
});

test('hosted walkthrough opens without an invitation and never contacts storage or models',async()=>{
 const {dispatch}=await import('../server/http.mjs');
 const config={...env,STUDY_MODE:'walkthrough',STUDY_ENROLLMENT_OPEN:'true'};
 const original=globalThis.fetch;
 globalThis.fetch=async()=>{throw new Error('Walkthrough must not contact external services');};
 try{
  const started=await studyRequest({action:'start'},{env:config});
  assert.equal(started.status,200);assert.equal(started.data.walkthrough,true);
  const req={headers:{cookie:started.cookie.split(';')[0],host:'study.example'}};
  assert.equal((await dispatch('/api/study',{action:'finish'},req,config)).status,403);
  assert.equal((await dispatch('/api/study',{action:'chat',message:'test'},req,config)).status,403);
  const quiz=await dispatch('/api/recall',{action:'generate',preview:true,story:'test'},req,config);
  assert.equal(quiz.status,200);assert.equal(quiz.data.questions.length,5);
  const scored=await dispatch('/api/recall',{action:'score',preview:true,id:quiz.data.id,answers:[2,1,2,1,2]},req,config);
  assert.equal(scored.data.score,5);assert.equal(scored.data.simulated,true);
  assert.equal((await dispatch('/api/recall',{action:'generate',preview:true},{headers:{host:'study.example'}},config)).status,403);
 }finally{globalThis.fetch=original;}
});


test('open test entry creates labelled sessions but cannot bypass Prolific verification',async()=>{
 const original=globalThis.fetch;
 const records=[];
 globalThis.fetch=async(url,options)=>{records.push({url,body:JSON.parse(options.body)});return Response.json([]);};
 try {
  const settings={...env,STUDY_MODE:'test',STUDY_ENROLLMENT_OPEN:'true',STUDY_AI_ACCESS:'both'};
  assert.equal((await studyRequest({action:'start'},{env:settings})).status,403);
  const result=await studyRequest({action:'start'},{env:{...settings,STUDY_TEST_OPEN_ENTRY:'true'}});
  assert.equal(result.status,200);assert.equal(result.data.testSession,true);assert.equal(result.data.aiAccess,'both');
  assert.equal(records.length,2);assert.equal(records[1].body.test_session,true);
  assert.ok(records[1].body.prolific_id.startsWith('TEST-'));
  assert.equal((await studyRequest({action:'start'},{env:{...settings,STUDY_MODE:'prolific',STUDY_TEST_OPEN_ENTRY:'true',PROLIFIC_COMPLETION_CODE:'TESTCODE'}})).status,403);
  assert.equal(records.length,2);
 } finally {globalThis.fetch=original;}
});
