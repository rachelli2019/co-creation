import {useEffect,useRef} from 'react';
import {logInteraction,flushInteractions,textEdit} from './interactionLog';
export function useWritingLog(sessionId:string|null|undefined,phase:string,enabled:boolean,text:string,chat:string) {
 const previous=useRef({draft:text,chat});
 const input=useRef<Record<string,Record<string,unknown>>>({});
 useEffect(()=>{
  if(!enabled||!sessionId)return;
  const record=(type:string,target:string,payload:Record<string,unknown>={})=>logInteraction(sessionId,phase,type,target,payload);
  record('phase_open','page');
  for(const target of ['draft','chat'] as const)record('checkpoint',target,{text:previous.current[target],offsetUnit:'UTF-16'});
  const listener=(event:Event)=>{
   const el=event.target;
   if(!(el instanceof HTMLTextAreaElement))return;
   const target=el.id==='ai-prompt'?'chat':el.dataset.trace==='draft'?'draft':null;
   if(!target)return;
   const selection={start:el.selectionStart,end:el.selectionEnd,direction:el.selectionDirection};
   if(event.type==='beforeinput') {
    const e=event as InputEvent;input.current[target]={inputType:e.inputType,isComposing:e.isComposing,selectionBefore:selection};return;
   }
   if(event.type==='keydown'||event.type==='keyup') {
    const e=event as KeyboardEvent;record(event.type,target,{key:e.key,code:e.code,repeat:e.repeat,ctrl:e.ctrlKey,meta:e.metaKey,alt:e.altKey,shift:e.shiftKey,isComposing:e.isComposing,selection});
   } else record(event.type==='select'?'selection':event.type,target,{selection});
  };
  const click=(e:Event)=>{
   const button=e.target instanceof Element?e.target.closest('button'):null;
   const label=button?.textContent?.trim();
   if(label&&['Add to draft','Add draft to prompt','Add outline to prompt'].includes(label))record('shortcut','page',{action:label,requestNumber:button?.dataset.requestNumber ? Number(button.dataset.requestNumber) : null});
  };
  const visibility=()=>{record('visibility','page',{state:document.visibilityState});void flushInteractions(sessionId).catch(()=>{});};
  const events=['keydown','keyup','beforeinput','focus','blur','select'];
  events.forEach(type=>document.addEventListener(type,listener,true));
  document.addEventListener('click',click,true);document.addEventListener('visibilitychange',visibility);
  const timer=setInterval(()=>{void flushInteractions(sessionId).catch(()=>{});},3000);
  return ()=>{clearInterval(timer);events.forEach(type=>document.removeEventListener(type,listener,true));document.removeEventListener('click',click,true);document.removeEventListener('visibilitychange',visibility);void flushInteractions(sessionId).catch(()=>{});};
 },[sessionId,phase,enabled]);
 useEffect(()=>{
  for(const target of ['draft','chat'] as const) {
   const next=target==='draft'?text:chat;
   if(enabled&&previous.current[target]!==next)logInteraction(sessionId,phase,'edit',target,{...textEdit(previous.current[target],next),...(input.current[target]||{inputType:'application'}),offsetUnit:'UTF-16'});
   previous.current[target]=next;delete input.current[target];
  }
 },[text,chat,sessionId,phase,enabled]);
}
