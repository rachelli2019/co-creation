import {sameOrigin,requireSession,readSession} from './study-auth.mjs';
import {studyRequest} from './study.mjs';
import {recallRequest,mockQuestions,scoreQuestions} from './recall.mjs';
export async function dispatch(path,body,req,env,allowPreview=false) {
 if (!sameOrigin(req)) return {status:403,data:{error:'Cross-site requests are not allowed'}};
 if(path==='/api/study') return studyRequest(body,{env,cookie:req.headers.cookie,secure:!allowPreview});
 if (env.STUDY_MODE === 'walkthrough') {
  const token=readSession(req.headers.cookie,env);
  if (token?.mode !== 'walkthrough' || !body?.preview) return {status:403,data:{error:'A preview invitation is required'}};
  const id=`preview-${token.id}`;
  const questions=mockQuestions();
  if(body.action==='generate') return {status:200,data:{id,simulated:true,questions:questions.map((q,i)=>({id:`recall_${i+1}`,category:q.category,question:q.question,choices:[...q.choices,'None of the above']}))}};
  if(body.action==='save_record') return {status:200,data:{saved:true,simulated:true}};
  if(body.action==='score' && body.id===id) {
   try {const scored=scoreQuestions(questions,body.answers);return {status:200,data:{...scored,generationId:id,bonusCents:scored.score*10,simulated:true,submittedAt:new Date().toISOString()}};}
   catch {return {status:400,data:{error:'Answer all five questions'}};}
  }
  return {status:400,data:{error:'Invalid preview request'}};
 }
 if(allowPreview && body?.preview===true) return recallRequest(body,{env,allowPreview:true});
 const session=await requireSession(req.headers.cookie,body||{},env);
 if(!session || session.finished_at || body?.preview) return {status:403,data:{error:'A valid study session is required'}};
 if(body.action==='save_record' && body.kind==='rough_draft') {
  if(!session.rough_started_at || Date.now()<Date.parse(session.rough_started_at)+600000) return {status:403,data:{error:'The rough draft section has not ended yet.'}};
  body.payload={...body.payload,aiAccess:session.ai_access,phaseSeconds:600,completedAt:new Date().toISOString()};
 }
 if(body.action==='generate' && (!session.final_started_at || Date.now()<Date.parse(session.final_started_at)+300000)) return {status:403,data:{error:'Please complete the final draft section first.'}};
 return recallRequest({...body,sessionId:session.id},{env});
}
export async function handle(req,res,{env=process.env,allowPreview=false,path=req.url?.split('?')[0]}={}) {
 res.setHeader('Cache-Control','no-store');
 res.setHeader('Content-Type','application/json');
 if(req.method!=='POST'){res.statusCode=405;res.end(JSON.stringify({error:'POST required'}));return;}
 if(!String(req.headers['content-type']||'').startsWith('application/json')){res.statusCode=415;res.end(JSON.stringify({error:'JSON required'}));return;}
 try {
  let body=req.body;
  if(body===undefined){let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>500000){res.statusCode=413;res.end(JSON.stringify({error:'Request too large'}));return;}}body=JSON.parse(raw);}
  else if(typeof body==='string') body=JSON.parse(body);
  if(JSON.stringify(body||{}).length>500000){res.statusCode=413;res.end(JSON.stringify({error:'Request too large'}));return;}
  const result=await dispatch(path,body,req,env,allowPreview);
  if(result.cookie)res.setHeader('Set-Cookie',result.cookie);
  res.statusCode=result.status;res.end(JSON.stringify(result.data));
 } catch {res.statusCode=503;res.end(JSON.stringify({error:'The study service is unavailable. Please try again.'}));}
}
