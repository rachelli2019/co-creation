import {studyApi} from './studyApi';
const streamId=crypto.randomUUID();
let sequence=0;
const queues=new Map<string, any[]>();
const pending=new Map<string, Promise<void>>();
const key=(id:string)=>`study-events-v1:${id}`;
function queue(id:string) {
 if(!queues.has(id)) {
  try {queues.set(id,JSON.parse(localStorage.getItem(key(id)) || '[]'));}
  catch {queues.set(id,[]);}
 }
 return queues.get(id)!;
}
function persist(id:string) {
 try {localStorage.setItem(key(id),JSON.stringify(queue(id)));window.dispatchEvent(new CustomEvent('study-log-warning',{detail:''}));}
 catch {window.dispatchEvent(new CustomEvent('study-log-warning',{detail:'Interaction logs could not be backed up in this browser. Keep this page open while they upload.'}));}
}
export function logInteraction(id:string|null|undefined,phase:string,type:string,target:string,payload:Record<string,unknown>={}) {
 if(!id)return;
 queue(id).push({event_id:crypto.randomUUID(),stream_id:streamId,sequence:++sequence,client_at:new Date().toISOString(),elapsed_ms:performance.now(),phase,type,target,payload,version:1});
 persist(id);
}
export async function flushInteractions(id:string|null|undefined):Promise<void> {
 if(!id)return;
 if(pending.has(id)) {await pending.get(id);return flushInteractions(id);}
 const batch=queue(id).slice(0,50);
 if(!batch.length)return;
 const request=studyApi({action:'events',sessionId:id,items:batch}).then(()=>{
  const sent=new Set(batch.map(x=>x.event_id));queues.set(id,queue(id).filter(x=>!sent.has(x.event_id)));persist(id);
 }).finally(()=>pending.delete(id));
 pending.set(id,request);await request;
 if(queue(id).length)await flushInteractions(id);
}
export function textEdit(before:string,after:string) {
 let start=0;while(start<before.length&&start<after.length&&before[start]===after[start])start++;
 let endBefore=before.length,endAfter=after.length;
 while(endBefore>start&&endAfter>start&&before[endBefore-1]===after[endAfter-1]){endBefore--;endAfter--;}
 return {start,deleted:before.slice(start,endBefore),inserted:after.slice(start,endAfter),length:after.length};
}
