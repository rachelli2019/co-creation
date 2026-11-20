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

test('manual condition links select and store pilot schedules, reject invalid values and cannot switch sessions',async t=>{
 const records=[];
 let saved;
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  if(options.method==='POST') {
   const body=JSON.parse(options.body);records.push(body);
   if(url.endsWith('/sessions')) saved=body;
   return Response.json([]);
  }
  return Response.json(saved?[saved]:[]);
 });
 const settings={...env,STUDY_MODE:'test',STUDY_TEST_OPEN_ENTRY:'true',STUDY_ENROLLMENT_OPEN:'true'};
 for(const condition of ['rough','final','both']) {
  const result=await studyRequest({action:'start',condition},{env:settings});
  assert.equal(result.status,200);assert.equal(result.data.aiAccess,condition);
  assert.equal(saved.ai_access,condition);
  const cookie=result.cookie.split(';')[0];
  assert.equal((await studyRequest({action:'start',condition},{env:settings,cookie})).status,200);
  assert.equal((await studyRequest({action:'start',condition:condition==='both'?'rough':'both'},{env:settings,cookie})).status,403);
 }
 const before=records.length;
 assert.equal((await studyRequest({action:'start',condition:'invalid-condition'},{env:settings})).status,400);
 assert.equal((await studyRequest({action:'start',condition:'rough'},{env:{...settings,STUDY_MODE:'prolific'}})).status,403);
 assert.equal(records.length,before);
});

test('server chooses preview/pilot/test labels, ignores client main label, and only previews bypass duration',async t=>{
 let saved;
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  if(options.method==='POST' && url.endsWith('/sessions'))saved=JSON.parse(options.body);
  return Response.json([]);
 });
 for(const [mode,kind,expected] of [['preview',undefined,'preview'],['test','pilot','pilot'],['test',undefined,'test']]){
  const response=await studyRequest({action:'start',dataKind:'main'},{env:{...env,STUDY_MODE:mode,STUDY_DATA_KIND:kind,STUDY_TEST_OPEN_ENTRY:'true',STUDY_ENROLLMENT_OPEN:'true'}});
  assert.equal(response.status,200);assert.equal(response.data.dataKind,expected);assert.equal(saved.data_kind,expected);
 }
 const session={ai_access:'both',rough_started_at:new Date(1000).toISOString()};
 assert.ok(phaseAllowed({...session,data_kind:'preview'},'rough',700000));
 for(const kind of ['pilot','test','main'])assert.ok(!phaseAllowed({...session,data_kind:kind},'rough',700000));
});

test('interaction ingest binds session server-side, validates data and requests retry deduplication',async t=>{
 const writes=[];
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  if(url.includes('/sessions?'))return Response.json([{id,expires_at:new Date(Date.now()+60000).toISOString()}]);
  writes.push({url,options});return Response.json([]);
 });
 const cookie=`study_session=${issueSession(id,env)}`;
 const event={event_id:id,stream_id:id,sequence:1,client_at:new Date().toISOString(),elapsed_ms:2,phase:'rough',type:'keydown',target:'draft',payload:{key:'a'},session_id:'forged'};
 assert.equal((await studyRequest({action:'events',items:[event]},{env,cookie})).status,200);
 assert.equal(JSON.parse(writes[0].options.body)[0].session_id,id);
 assert.match(writes[0].options.headers.Prefer,/ignore-duplicates/);
 assert.equal((await studyRequest({action:'events',items:[{...event,phase:'invalid'}]},{env,cookie})).status,400);
 assert.equal((await studyRequest({action:'events',items:[event]},{env})).status,403);
 assert.equal(writes.length,1);
});

test('rough draft save rejects whitespace and records time beyond the deadline',async t=>{
 const {dispatch}=await import('../server/http.mjs');
 let saved;
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  if(url.includes('/sessions?'))return Response.json([{id,rough_started_at:new Date(Date.now()-610000).toISOString(),expires_at:new Date(Date.now()+60000).toISOString()}]);
  if(options.method==='POST')saved=JSON.parse(options.body);
  return Response.json([]);
 });
 const req={headers:{cookie:`study_session=${issueSession(id,env)}`}};
 const body={action:'save_record',kind:'rough_draft',sessionId:id,payload:{text:' \n ',transcript:[]}};
 assert.equal((await dispatch('/api/recall',body,req,env)).status,400);
 assert.equal(saved,undefined);
 body.payload.text='A beginning.';
 assert.equal((await dispatch('/api/recall',body,req,env)).status,200);
 assert.ok(saved.payload.extraTimeMs>=10000);
});


test('rough draft can finish after five minutes but not before', async t => {
 const {dispatch}=await import('../server/http.mjs');
 let elapsed=299000;
 let saved;
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  if(url.includes('/sessions?'))return Response.json([{id,rough_started_at:new Date(Date.now()-elapsed).toISOString(),expires_at:new Date(Date.now()+60000).toISOString()}]);
  if(options.method==='POST')saved=JSON.parse(options.body);
  return Response.json([]);
 });
 const req={headers:{cookie:`study_session=${issueSession(id,env)}`}};
 const body={action:'save_record',kind:'rough_draft',sessionId:id,payload:{text:'A complete rough draft.',transcript:[]}};
 assert.equal((await dispatch('/api/recall',body,req,env)).status,403);
 assert.equal(saved,undefined);
 elapsed=300000;
 assert.equal((await dispatch('/api/recall',body,req,env)).status,200);
 assert.equal(saved.payload.extraTimeMs,0);
});

test('personal pilot invitations bind identity and condition and resume one session', async t => {
 const sessions=[];
 const settings={...env,STUDY_MODE:'test',STUDY_DATA_KIND:'pilot',STUDY_ENROLLMENT_OPEN:'true',PILOT_INVITATIONS:JSON.stringify({first:{id:'LAB-QA-01',condition:'rough'},second:{id:'LAB-QA-02',condition:'final'}})};
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  if(options.method==='POST') {
   if(url.endsWith('/sessions'))sessions.push(JSON.parse(options.body));
   return Response.json([]);
  }
  const params=new URL(url).searchParams;
  return Response.json(sessions.filter(s => params.has('prolific_id') ? 'eq.'+s.prolific_id===params.get('prolific_id') : 'eq.'+s.id===params.get('id')));
 });
 assert.equal((await studyRequest({action:'start',pilot:'missing'},{env:settings})).status,403);
 assert.equal((await studyRequest({action:'start',pilot:'first',condition:'final'},{env:settings})).status,403);
 assert.equal((await studyRequest({action:'start',pilot:'first'},{env:{...settings,STUDY_MODE:'prolific'}})).status,403);
 const first=await studyRequest({action:'start',pilot:'first'},{env:settings});
 const second=await studyRequest({action:'start',pilot:'second'},{env:settings});
 assert.equal(first.data.prolificId,'LAB-QA-01');
 assert.equal(first.data.aiAccess,'rough');
 assert.equal(second.data.aiAccess,'final');
 assert.notEqual(first.data.sessionId,second.data.sessionId);
 assert.equal(sessions.length,2);
 assert.ok(sessions.every(s=>s.data_kind==='pilot'));
 const resumed=await studyRequest({action:'start',pilot:'first'},{env:settings});
 assert.equal(resumed.data.sessionId,first.data.sessionId);
 assert.ok(resumed.cookie);
 assert.equal(sessions.length,2);
 assert.equal((await studyRequest({action:'start',pilot:'second'},{env:settings,cookie:first.cookie.split(';')[0]})).status,403);
});
