import {randomUUID} from 'node:crypto';
import {database, equalSecret, issueSession, requireSession, readSession, COOKIE} from './study-auth.mjs';
import {NOUNS, NOUN_PROMPT, NOUN_PROMPT_VERSION, writingPrompt} from './random-noun.mjs';
const ok = data => ({status:200,data});
const denied = (error='This study link is not currently available.') => ({status:403,data:{error}});
async function rows(env,path,options) {
 const r = await database(env,path,options);
 if (!r.ok) throw new Error('Database operation failed');
 return r.json();
}
export function phaseAllowed(session, phase, now=Date.now()) {
 const start = session[`${phase}_started_at`];
 return ['rough','final'].includes(phase) && !session.finished_at && !session.revoked && start &&
  (phase !== 'rough' || !session.final_started_at) &&
  (session.ai_access === 'both' || session.ai_access === phase) && (session.data_kind === 'preview' || now < Date.parse(start)+600000);
}
export async function verifyProlific(body,env,fetchImpl=fetch) {
 if (!env.PROLIFIC_API_TOKEN || body.studyId !== env.PROLIFIC_STUDY_ID ||
 !/^[a-f0-9]{24}$/i.test(body.prolificId || '') || !/^[a-f0-9]{24}$/i.test(body.prolificSessionId || '')) return false;
 const response = await fetchImpl(`https://api.prolific.com/api/v1/submissions/${body.prolificSessionId}/`, {
  headers:{Authorization:`Token ${env.PROLIFIC_API_TOKEN}`}, signal:AbortSignal.timeout(15000)
 });
 if (!response.ok) return false;
 const submission = await response.json();
 return submission.participant === body.prolificId && submission.study_id === env.PROLIFIC_STUDY_ID && submission.status === 'ACTIVE';
}
export async function studyRequest(body, {env=process.env,cookie='',secure=true}={}) {
 try {
  if (!body || typeof body.action !== 'string') return {status:400,data:{error:'Invalid request'}};
  if (body.action === 'start') {
   if (env.STUDY_ENROLLMENT_OPEN !== 'true') return denied();
   const manualAllowed = ['walkthrough', 'test', 'preview'].includes(env.STUDY_MODE) || env.STUDY_ALLOW_CONDITION_OVERRIDE === 'true';
   const condition = body.condition;
   if (condition != null && condition !== '') {
    if (!manualAllowed) return denied('Manual condition links are not enabled for this study.');
    if (!['rough', 'final', 'both', 'random-noun'].includes(condition)) return {status:400,data:{error:'Condition must be rough, final, both, or random-noun.'}};
   }
   const nounOverride = body.noun || null;
   if (nounOverride && (!['test','walkthrough','preview'].includes(env.STUDY_MODE) || condition !== 'random-noun' || !NOUNS.includes(nounOverride))) return denied('Noun overrides are available only for random-noun pilot tests and must use a listed noun.');
   if (env.STUDY_MODE === 'walkthrough') {
    const previous = readSession(cookie, env);
    const id = previous?.mode === 'walkthrough' ? previous.id : randomUUID();
    const signed = issueSession(id,env,Date.now(),'walkthrough');
    return {...ok({walkthrough:true,testSession:true,prolificId:'PREVIEW',group:'AI-DIV',aiAccess:condition === 'random-noun' ? 'both' : condition || 'both'}),cookie:`${COOKIE}=${signed}; HttpOnly; SameSite=Strict; Path=/; Max-Age=7200${secure?'; Secure':''}`};
   }
   const dataKind = env.STUDY_MODE === 'preview' ? 'preview' : env.STUDY_MODE === 'prolific' ? 'main' : env.STUDY_DATA_KIND === 'pilot' ? 'pilot' : 'test';
   const existing = await requireSession(cookie,{},env);
   if (existing && !(env.STUDY_MODE === 'preview' && (body.restartPreview === true || (condition && (existing.condition || existing.ai_access) !== condition) || (nounOverride && existing.assigned_noun !== nounOverride)))) {
    if ((existing.data_kind || 'test') !== dataKind) return denied('Please open this study in a separate browser profile.');
    if (condition && (existing.condition || existing.ai_access) !== condition) return denied('This session already has a different condition. Use a separate browser profile for a new test session; an existing participant cannot switch conditions.');
    if (nounOverride && existing.assigned_noun !== nounOverride) return denied('This session already has a noun. Use a separate browser profile for a new pilot test.');
    return ok({sessionId:existing.id,prolificId:existing.prolific_id,group:existing.group_key,aiAccess:existing.ai_access,testSession:existing.test_session,dataKind:existing.data_kind,completed:!!existing.finished_at,completionCode:existing.finished_at && !existing.test_session ? env.PROLIFIC_COMPLETION_CODE : null});
   }
   const test = ['test','preview'].includes(env.STUDY_MODE);
   if (!test && !/^[A-Z0-9]{6,16}$/.test(env.PROLIFIC_COMPLETION_CODE || '')) return denied('Study completion is not configured.');
   if (test ? env.STUDY_MODE !== 'preview' && env.STUDY_TEST_OPEN_ENTRY !== 'true' && !equalSecret(body.invite,env.STUDY_INVITE_CODE) : env.STUDY_MODE !== 'prolific' || !await verifyProlific(body,env)) return denied('Please use your authorized study invitation.');
   const id = randomUUID(), prolificId = test ? `TEST-${randomUUID()}` : body.prolificId;
   const signed = issueSession(id,env);
   const selectedCondition = (manualAllowed && condition) || env.STUDY_CONDITION || env.STUDY_AI_ACCESS || 'both';
   const access = selectedCondition === 'random-noun' ? 'both' : selectedCondition;
   if (!['rough','final','both','neither'].includes(access)) throw new Error('Invalid AI schedule');
   const group = 'AI-DIV';
   if (selectedCondition === 'random-noun') {
    const enrolled = await rows(env,'rpc/enroll_random_noun_v2',{method:'POST',body:JSON.stringify({
     p_id:id,p_participant:prolificId,p_test:test,p_submission:test?null:body.prolificSessionId,
     p_kind:dataKind,p_pool:test?dataKind:`main:${env.PROLIFIC_STUDY_ID}`,p_override:nounOverride,p_nouns:NOUNS,
     p_prompt:NOUN_PROMPT,p_version:NOUN_PROMPT_VERSION,p_model:env.WRITING_MODEL||'gpt-6-luna'
    })});
    if (!enrolled[0]?.assigned_noun) throw new Error('Could not assign noun');
   } else {
   const participant = await database(env,'participants',{method:'POST',body:JSON.stringify({prolific_id:prolificId,group_key:group})});
   if (participant.status === 409) return denied('This participant has already started the study. Please contact the researcher.');
   if (!participant.ok) throw new Error('Could not enroll');
   await rows(env,'sessions',{method:'POST',body:JSON.stringify({id,prolific_id:prolificId,group_key:group,ai_access:access,condition:selectedCondition,test_session:test,data_kind:dataKind,prolific_submission_id:test?null:body.prolificSessionId,expires_at:new Date(Date.now()+7200000).toISOString()})});
   }
   return {...ok({sessionId:id,prolificId,group,aiAccess:access,testSession:test,dataKind}),cookie:`${COOKIE}=${signed}; HttpOnly; SameSite=Strict; Path=/; Max-Age=7200${secure?'; Secure':''}`};
  }
  if (env.STUDY_MODE === 'walkthrough') return denied('Preview does not save study data.');
  const session = await requireSession(cookie,body,env);
  if (!session) return denied('A valid study session is required.');
  if(body.action === 'events') {
   const uuid=/^[a-f0-9-]{36}$/i;
   if(!Array.isArray(body.items)||body.items.length>50||body.items.some(x=>
    !uuid.test(x.event_id)||!uuid.test(x.stream_id)||!Number.isSafeInteger(x.sequence)||x.sequence<1||
    !Number.isFinite(x.elapsed_ms)||x.elapsed_ms<0||!Number.isFinite(Date.parse(x.client_at))||
    !['rough','final'].includes(x.phase)||!['keydown','keyup','edit','focus','blur','selection','shortcut','chat_submit','chat_response_displayed','chat_error','phase_open','checkpoint','visibility'].includes(x.type)||
    !['draft','chat','page'].includes(x.target)||!x.payload||typeof x.payload!=='object'||Array.isArray(x.payload)||JSON.stringify(x.payload).length>150000
   ))return {status:400,data:{error:'Invalid interaction events'}};
   if(body.items.length)await rows(env,'interaction_events?on_conflict=event_id',{method:'POST',headers:{Prefer:'resolution=ignore-duplicates,return=representation'},body:JSON.stringify(body.items.map(x=>({event_id:x.event_id,session_id:session.id,stream_id:x.stream_id,sequence:x.sequence,client_at:x.client_at,elapsed_ms:x.elapsed_ms,phase:x.phase,type:x.type,target:x.target,payload:x.payload,version:1})))});
   return ok({saved:true});
  }
  if (session.finished_at) return body.action === 'finish' ? ok({saved:true,completionCode:session.test_session?null:env.PROLIFIC_COMPLETION_CODE}) : denied('This session is complete.');
  if (body.action === 'ban') {
   await rows(env,`sessions?id=eq.${session.id}`,{method:'PATCH',body:JSON.stringify({revoked:true})});
   return ok({saved:true});
  }
  if (body.action === 'phase') {
   if (!['rough','final'].includes(body.phase)) return denied();
   if (body.phase === 'final') {
    const rough = await rows(env,`study_records?session_id=eq.${session.id}&kind=eq.rough_draft&select=session_id`);
    if (!rough.length) return denied('Please finish your rough draft first.');
   }
   const field = `${body.phase}_started_at`;
   const result = await rows(env,`sessions?id=eq.${session.id}&${field}=is.null`,{method:'PATCH',body:JSON.stringify({[field]:new Date().toISOString()})});
   return ok({startedAt:result[0]?.[field] || session[field]});
  }
  if (body.action === 'snapshots') {
   if (!Array.isArray(body.items) || body.items.length > 100 || body.items.some(x=>!['brainstorm','writing'].includes(x.phase)||!['main','chat'].includes(x.textbox)||typeof x.text!=='string'||x.text.length>50000)) return {status:400,data:{error:'Invalid snapshots'}};
   if (body.items.length) await rows(env,'snapshots',{method:'POST',body:JSON.stringify(body.items.map(x=>({session_id:session.id,phase:x.phase,textbox:x.textbox,text:x.text,client_at:Number.isFinite(Date.parse(x.timestamp))?x.timestamp:null,writing_phase:['rough','final'].includes(x.writingPhase)?x.writingPhase:null,timestamp:new Date().toISOString()})))});
   return ok({saved:true});
  }
  if (body.action === 'chat') {
   if (!phaseAllowed(session,body.phase)) return denied('AI is not available in this section.');
   if (!env.OPENAI_API_KEY) return {status:503,data:{error:'The writing assistant is not configured yet.'}};
   if (typeof body.message !== 'string' || !body.message.trim() || body.message.length>20000) return {status:400,data:{error:'Please enter a prompt under 20,000 characters.'}};
   const previous = await rows(env,`ai_requests?session_id=eq.${session.id}&order=request_number.asc&select=*`);
   // A unique slot reserves budget before contacting the provider, even across server instances.
   let slot = 0;
   for (let n=previous.length+1;n<=15;n++) {
    const r = await database(env,'ai_requests',{method:'POST',body:JSON.stringify({session_id:session.id,request_number:n,phase:body.phase,prompt:body.message})});
    if(r.ok){slot=n;break;} if(r.status!==409) throw new Error('Could not reserve AI request');
   }
   if(!slot) return {status:429,data:{error:'The AI request limit has been reached.'}};
   const history = previous.filter(x=>x.response && (session.ai_access==='both'||x.phase===body.phase)).flatMap(x=>[{role:'user',content:x.prompt},{role:'assistant',content:x.response}]);
   const response = await fetch('https://api.openai.com/v1/chat/completions',{method:'POST',signal:AbortSignal.timeout(45000),headers:{'Content-Type':'application/json',Authorization:`Bearer ${env.OPENAI_API_KEY}`},body:JSON.stringify({model:session.writing_model||env.WRITING_MODEL||'gpt-6-luna',store:false,reasoning_effort:'low',messages:[{role:'system',content:writingPrompt(session)},...history,{role:'user',content:body.message}]})});
   if(!response.ok) throw new Error('Writing provider failed');
   const data=await response.json(), content=data.choices?.[0]?.message?.content;
   if(typeof content!=='string'||!content) throw new Error('Empty writing response');
   await rows(env,`ai_requests?session_id=eq.${session.id}&request_number=eq.${slot}`,{method:'PATCH',body:JSON.stringify({response:content,response_at:new Date().toISOString()})});
   return ok({content,model:data.model,requestNumber:slot});
  }
  if(body.action==='finish') {
   const quiz=(await rows(env,`recall_generations?session_id=eq.${session.id}&select=story,responses`))[0];
   const survey=(await rows(env,`study_records?session_id=eq.${session.id}&kind=eq.survey&select=payload`))[0];
   const rough=(await rows(env,`study_records?session_id=eq.${session.id}&kind=eq.rough_draft&select=payload`))[0];
   if((!quiz?.responses && !(session.data_kind === 'preview' && quiz?.story))||!survey||!rough) return denied('Please submit the survey and quiz first.');
   const chat=await rows(env,`ai_requests?session_id=eq.${session.id}&order=request_number.asc&select=prompt,response`);
   const payload={session_id:session.id,brainstorm_text:rough.payload.brainstorm||'',final_text:quiz.story,word_count:quiz.story.trim().split(/\s+/).length,attention_meta:body.attentionMeta||{},survey_responses:{...survey.payload,quiz:quiz.responses || {status:'skipped_preview'}},ai_transcript:chat.flatMap(x=>[{role:'user',content:x.prompt},...(x.response?[{role:'assistant',content:x.response}]:[])])};
   await rows(env,'submissions?on_conflict=session_id',{method:'POST',headers:{Prefer:'resolution=ignore-duplicates,return=representation'},body:JSON.stringify(payload)});
   await rows(env,`sessions?id=eq.${session.id}&finished_at=is.null`,{method:'PATCH',body:JSON.stringify({finished_at:new Date().toISOString()})});
   return ok({saved:true,completionCode:session.test_session?null:env.PROLIFIC_COMPLETION_CODE});
  }
  return {status:400,data:{error:'Unknown action'}};
 } catch(error) {console.error('Study request failed:',error.message);return {status:503,data:{error:'The study could not save or load your data. Please retry or contact the researcher.'}};}
}
