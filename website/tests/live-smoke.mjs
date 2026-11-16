// Synthetic records retained in the test project; model responses are mocked.
import assert from 'node:assert/strict';
import {loadEnv} from 'vite';
import {studyRequest} from '../server/study.mjs';
import {dispatch} from '../server/http.mjs';
import {database} from '../server/study-auth.mjs';
import {RECALL_CATEGORIES} from '../server/recall-prompt.mjs';
const env=loadEnv('development',process.cwd(),'');
const actualFetch=globalThis.fetch;
const start=await studyRequest({action:'start',invite:env.STUDY_INVITE_CODE},{env,secure:false});
assert.equal(start.status,200,JSON.stringify(start.data));
const sessionId=start.data.sessionId;
const req={headers:{cookie:start.cookie.split(';')[0],host:'localhost:5173',origin:'http://localhost:5173'}};
async function call(path,body){const r=await dispatch(path,{...body,sessionId},req,env);assert.equal(r.status,200,JSON.stringify(r.data));return r.data;}
const study=b=>call('/api/study',b), recall=b=>call('/api/recall',b);
await study({action:'snapshots',items:[{phase:'brainstorm',textbox:'main',text:'SYNTHETIC BACKEND VERIFICATION'}]});
await study({action:'phase',phase:'rough'});
assert.equal((await dispatch('/api/recall',{action:'save_record',kind:'rough_draft',sessionId,payload:{}},req,env)).status,403);
await database(env,`sessions?id=eq.${sessionId}`,{method:'PATCH',body:JSON.stringify({rough_started_at:new Date(Date.now()-601000).toISOString()})});
await recall({action:'save_record',kind:'rough_draft',payload:{text:'Synthetic rough draft',transcript:[],completedAt:new Date().toISOString(),brainstorm:'Synthetic outline'}});
await study({action:'phase',phase:'final'});
assert.equal((await dispatch('/api/study',{action:'chat',sessionId,phase:'rough',message:'out of phase'},req,env)).status,403);
const example=await dispatch('/api/recall',{action:'generate',preview:true,story:'fixture'},req,env,true);
const questions=example.data.questions.map((q,i)=>({category:RECALL_CATEGORIES[i],question:q.question,choices:q.choices.slice(0,4),correctIndex:0,evidence:'Synthetic test'}));
globalThis.fetch=async (url,options)=>{
 if(String(url).startsWith('https://api.openai.com/')) return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.parse(options.body).response_format?JSON.stringify({questions}):'Synthetic assistant reply'}}]});
 return actualFetch(url,options);
};
env.OPENAI_API_KEY='MOCK-NOT-A-REAL-KEY';
await study({action:'chat',phase:'final',message:'Synthetic test prompt'});
await database(env,`sessions?id=eq.${sessionId}`,{method:'PATCH',body:JSON.stringify({final_started_at:new Date(Date.now()-301000).toISOString()})});
const generated=await recall({action:'generate',story:'Synthetic final story for backend verification. No participant data.'});
assert.equal(generated.questions.length,5);assert.equal(generated.questions[0].correctIndex,undefined);
await recall({action:'save_record',kind:'survey',payload:{answers:{synthetic:true},submittedAt:new Date().toISOString()}});
const score=await recall({action:'score',id:generated.id,answers:[0,0,0,0,0]});assert.equal(score.bonusCents,50);
await study({action:'finish',attentionMeta:{synthetic:true}});await study({action:'finish'});
const saved=await (await database(env,`submissions?session_id=eq.${sessionId}&select=*`)).json();assert.equal(saved.length,1);
assert.equal(saved[0].final_text,'Synthetic final story for backend verification. No participant data.');
assert.equal((await dispatch('/api/study',{action:'snapshots',sessionId:'00000000-0000-0000-0000-000000000000',items:[]},req,env)).status,403);
for(const table of ['sessions','participants','snapshots','submissions','study_records','recall_generations','ai_requests']){
 const r=await actualFetch(`${env.SUPABASE_URL}/rest/v1/${table}?select=*`,{headers:{apikey:'sb_publishable_s1yOYaTB8xev-Hb0iXpP9A_ehQu-Oon'}});
 assert.ok([401,403].includes(r.status),`${table} public access status ${r.status}`);
}
console.log('PASS: all seven tables block public reads; session ownership, timing, snapshots, rough draft, final story, survey, quiz scoring, transcript, and idempotent final submission verified. LLM calls mocked; no charges.');
