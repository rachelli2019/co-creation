// Explicit opt-in integration test: real model calls and retained synthetic test records.
// Never run against participant sessions. Only this newly created test session is advanced.
import assert from 'node:assert/strict';
import {loadEnv} from 'vite';
import {database} from '../server/study-auth.mjs';
const env=loadEnv('development',process.cwd(),'');
const base=process.env.TEST_STUDY_URL;
assert.ok(base?.startsWith('https://'),'Set TEST_STUDY_URL to the real-backend test deployment');
let cookie='',sessionId;
async function request(path,body,expected=200){
 const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',Origin:base,...(cookie?{Cookie:cookie}:{})},body:JSON.stringify({...body,...(sessionId?{sessionId}:{})}),signal:AbortSignal.timeout(65000)});
 const setCookie=r.headers.get('set-cookie');if(setCookie)cookie=setCookie.split(';')[0];
 const data=await r.json();assert.equal(r.status,expected,JSON.stringify(data));return data;
}
async function rows(path,options){const r=await database(env,path,options);assert.equal(r.ok,true,`Database verification failed: ${r.status}`);return r.json();}
async function advance(field,seconds){
 const session=(await rows(`sessions?id=eq.${sessionId}&select=*`))[0];
 assert.equal(session.test_session,true);assert.ok(session.prolific_id.startsWith('TEST-'));
 const updated=await rows(`sessions?id=eq.${sessionId}&test_session=eq.true`,{method:'PATCH',body:JSON.stringify({[field]:new Date(Date.now()-seconds*1000).toISOString()})});
 assert.equal(updated.length,1);
}
const start=await request('/api/study',{action:'start'});
assert.equal(start.testSession,true);assert.equal(start.walkthrough,undefined);assert.equal(start.aiAccess,'both');
sessionId=start.sessionId;assert.ok(sessionId);console.log(`Synthetic session: ${sessionId}`);
assert.equal((await request('/api/study',{action:'start'})).sessionId,sessionId);
await request('/api/study',{action:'snapshots',items:[{phase:'brainstorm',textbox:'main',text:'SYNTHETIC TEST: Mira repairs a lighthouse lamp with her brother Theo during a storm. A brass compass helps them find the spare bulb.'}]});
await request('/api/study',{action:'phase',phase:'rough'});
const rough=await request('/api/study',{action:'chat',phase:'rough',message:'For a synthetic research software test, write a complete 250–300 word first-person short story. My name is Mira. My brother Theo and I repair a lighthouse lamp during a storm in a single afternoon. A brass compass helps us find the spare bulb. Return only the story.'});
assert.ok(rough.content.length>100);assert.ok(rough.model.startsWith('gpt-6-luna'));console.log('PASS: real rough-draft assistant reply saved');
await request('/api/recall',{action:'save_record',kind:'rough_draft',payload:{text:rough.content,transcript:[],completedAt:new Date().toISOString()}},403);
await advance('rough_started_at',601);
await request('/api/recall',{action:'save_record',kind:'rough_draft',payload:{text:rough.content,transcript:[{role:'assistant',content:rough.content}],completedAt:new Date().toISOString(),brainstorm:'Synthetic lighthouse outline'}});
await request('/api/study',{action:'phase',phase:'final'});
await request('/api/study',{action:'chat',phase:'rough',message:'This phase must be blocked.'},403);
const final=await request('/api/study',{action:'chat',phase:'final',message:'Polish the short story from our previous messages. Preserve the narrator, sibling, setting, compass, and events. Keep it 250–300 words. Return only the final story.'});
assert.ok(final.content.length>100);assert.ok(final.model.startsWith('gpt-6-luna'));console.log('PASS: real final-draft assistant reply using saved conversation');
await advance('final_started_at',301);
const survey={version:'18',answers:{synthetic:true,credit:50},submittedAt:new Date().toISOString()};
const generation=request('/api/recall',{action:'generate',story:final.content});
await request('/api/recall',{action:'save_record',kind:'survey',payload:survey});
const quiz=await generation;assert.equal(quiz.simulated,false);assert.equal(quiz.questions.length,5);
for(const q of quiz.questions){assert.equal(q.choices.length,5);assert.equal(q.correctIndex,undefined);assert.equal(q.evidence,undefined);}
const generated=(await rows(`recall_generations?session_id=eq.${sessionId}&select=*`))[0];
assert.equal(generated.story,final.content);assert.equal(generated.status,'ready');assert.equal(generated.model,'gpt-6.1-sol');
assert.equal((await request('/api/recall',{action:'generate',story:final.content})).id,quiz.id);
const answers=generated.questions.map(q=>q.correctIndex);
const score=await request('/api/recall',{action:'score',id:quiz.id,answers});assert.equal(score.score,5);assert.equal(score.bonusCents,50);
const retry=await request('/api/recall',{action:'score',id:quiz.id,answers:[4,4,4,4,4]});assert.equal(retry.score,5);
assert.equal((await request('/api/study',{action:'finish',attentionMeta:{synthetic:true}})).completionCode,null);
await request('/api/study',{action:'finish'});
const saved=await rows(`submissions?session_id=eq.${sessionId}&select=*`);assert.equal(saved.length,1);assert.equal(saved[0].final_text,final.content);assert.equal(saved[0].ai_transcript.length,4);assert.equal(saved[0].survey_responses.answers.synthetic,true);
const records=await rows(`study_records?session_id=eq.${sessionId}&select=*`);assert.equal(records.find(r=>r.kind==='rough_draft').payload.text,rough.content);
const chats=await rows(`ai_requests?session_id=eq.${sessionId}&select=*`);assert.equal(chats.length,2);assert.ok(chats.every(c=>c.response));
assert.ok((await rows(`sessions?id=eq.${sessionId}&select=finished_at`))[0].finished_at);
for(const table of ['sessions','participants','snapshots','submissions','study_records','recall_generations','ai_requests']){
 const r=await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?select=*`,{headers:{apikey:'sb_publishable_s1yOYaTB8xev-Hb0iXpP9A_ehQu-Oon'}});assert.ok([401,403].includes(r.status),`${table} allowed public reads`);
}
console.log('PASS: real quiz generation, survey saved during generation, hidden answer keys, immutable scoring, $0.50 quiz bonus, both drafts and four-message transcript stored, idempotent completion, seven tables deny public reads.');
