import test from 'node:test';
import assert from 'node:assert/strict';
import {NOUNS,NOUN_PROMPT,NOUN_PROMPT_VERSION,writingPrompt} from '../server/random-noun.mjs';
import {WRITING_PROMPT} from '../server/writing-prompt.mjs';
import {studyRequest} from '../server/study.mjs';
import {issueSession} from '../server/study-auth.mjs';
const env={STUDY_SESSION_SECRET:'test-secret-at-least-thirty-two-characters',SUPABASE_URL:'https://example.invalid',SUPABASE_SERVICE_ROLE_KEY:'test',STUDY_MODE:'test',STUDY_TEST_OPEN_ENTRY:'true',STUDY_ENROLLMENT_OPEN:'true',OPENAI_API_KEY:'test'};
const id='12345678-1234-1234-1234-123456789abc';
test('noun list has no duplicates; standard prompt remains unchanged and missing noun fails closed',()=>{
 assert.ok(NOUNS.length>=50);assert.equal(new Set(NOUNS).size,NOUNS.length);
 assert.equal(writingPrompt({ai_access:'both'}),WRITING_PROMPT);
 assert.throws(()=>writingPrompt({condition:'random-noun'}));
});
test('pilot enrolls atomically with saved prompt, both-phase access, and no noun in response',async t=>{
 let stored;
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  if(url.endsWith('/rpc/enroll_random_noun')){
   const p=JSON.parse(options.body);
   assert.equal(p.p_pool,'pilot');assert.equal(p.p_test,true);assert.equal(p.p_override,'leek');
   assert.deepEqual(p.p_nouns,NOUNS);assert.equal(p.p_prompt,NOUN_PROMPT);assert.equal(p.p_version,NOUN_PROMPT_VERSION);
   stored={id:p.p_id,prolific_id:p.p_participant,condition:'random-noun',assigned_noun:'leek',ai_access:'both',group_key:'AI-DIV',test_session:true,expires_at:new Date(Date.now()+7200000).toISOString()};
  }
  return Response.json(stored?[stored]:[]);
 });
 const result=await studyRequest({action:'start',condition:'random-noun',noun:'leek'},{env});
 assert.equal(result.status,200);assert.equal(result.data.aiAccess,'both');assert.equal(result.data.assigned_noun,undefined);
 const cookie=result.cookie.split(';')[0];
 assert.equal((await studyRequest({action:'start',condition:'random-noun',noun:'leek'},{env,cookie})).data.sessionId,result.data.sessionId);
 assert.equal((await studyRequest({action:'start',condition:'random-noun',noun:'anchor'},{env,cookie})).status,403);
});
test('rejects invalid nouns, standard-condition overrides and all main-study noun overrides before allocation',async t=>{
 t.mock.method(globalThis,'fetch',()=>{throw new Error('Must not access database');});
 for(const body of [{condition:'both',noun:'leek'},{condition:'random-noun',noun:'not-listed'}]) assert.equal((await studyRequest({action:'start',...body},{env})).status,403);
 assert.equal((await studyRequest({action:'start',condition:'random-noun',noun:'leek'},{env:{...env,STUDY_MODE:'prolific',STUDY_ALLOW_CONDITION_OVERRIDE:'true'}})).status,403);
});
test('final chat uses persisted noun prompt and earlier requests to remove it, without changing assigned noun',async t=>{
 const storedPrompt=NOUN_PROMPT.replaceAll('{noun}','leek');
 const session={id,condition:'random-noun',assigned_noun:'leek',writing_system_prompt:storedPrompt,writing_model:'gpt-6-luna',ai_access:'both',final_started_at:new Date().toISOString(),expires_at:new Date(Date.now()+7200000).toISOString()};
 let modelRequest;
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  if(url.includes('/sessions?'))return Response.json([session]);
  if(url==='https://api.openai.com/v1/chat/completions'){
   modelRequest=JSON.parse(options.body);return Response.json({model:'gpt-6-luna',choices:[{message:{content:'Revised story without that metaphor.'}}]});
  }
  if(options.method==='POST'||options.method==='PATCH')return Response.json([]);
  return Response.json([{request_number:1,phase:'rough',prompt:'Remove the leek and do not use it again.',response:'I will remove it.'}]);
 });
 const result=await studyRequest({action:'chat',phase:'final',message:'Polish the ending.'},{env,cookie:`study_session=${issueSession(id,env)}`});
 assert.equal(result.status,200);assert.equal(modelRequest.messages[0].content,storedPrompt);
 assert.equal(modelRequest.messages[1].content,'Remove the leek and do not use it again.');
 assert.equal(modelRequest.messages.at(-1).content,'Polish the ending.');
 assert.equal(modelRequest.model,'gpt-6-luna');assert.equal(session.assigned_noun,'leek');
});
