import {useEffect,useState,type ReactNode} from 'react';
import {PreviewMode} from './previewMode';
import {studyApi} from './studyApi';
let startPromise: ReturnType<typeof studyApi> | undefined;
export function startStudy(invite?: string, restartPreview = false) {
 if (!startPromise || invite !== undefined || restartPreview) {
  const params=new URLSearchParams(window.location.search);
  const fragment=new URLSearchParams(window.location.hash.slice(1));
  startPromise=studyApi({action:'start',restartPreview,condition:params.get('condition'),noun:params.get('noun'),invite:invite ?? fragment.get('invite') ?? params.get('invite') ?? '',
   prolificId:params.get('PROLIFIC_PID') || params.get('prolific_id') || params.get('pid'),
   studyId:params.get('STUDY_ID'),prolificSessionId:params.get('SESSION_ID')}).then(result=>{
    params.delete('invite');fragment.delete('invite');
    window.history.replaceState(null,'',window.location.pathname+(params.size?'?'+params:'')+(fragment.size?'#'+fragment:''));
    return result;
   });
 }
 return startPromise;
}
export default function StudyAccess({children,walkthrough}:{children:ReactNode;walkthrough?:ReactNode}) {
 const [isWalkthrough,setIsWalkthrough]=useState(false);
 const [dataKind,setDataKind]=useState('');
 const [testSession,setTestSession]=useState(false);
 const [ready,setReady]=useState(false),[error,setError]=useState(''),[code,setCode]=useState(''),[busy,setBusy]=useState(true);
 const prolific=new URLSearchParams(window.location.search).has('SESSION_ID');
 useEffect(()=>{startStudy().then(result=>{setDataKind(result.dataKind || '');setTestSession(result.testSession);setIsWalkthrough(result.walkthrough === true);setReady(true);}).catch(e=>setError(e.message)).finally(()=>setBusy(false));},[]);
 async function restart(condition?: string) {
  setBusy(true);setError('');
  const previous=location.href;
  try {
   if(condition) {const params=new URLSearchParams(location.search);params.set('condition',condition);params.delete('noun');history.replaceState(null,'','?'+params);}
   await startStudy(undefined,true);location.reload();
  } catch(e) {history.replaceState(null,'',previous);setError(e instanceof Error?e.message:'Unable to start preview.');setBusy(false);}
 }
 if(ready && isWalkthrough)return walkthrough;
 if(ready && dataKind === 'preview') return <PreviewMode.Provider value={true}><div className="bg-amber-50 p-4 text-sm"><strong>Live preview</strong> — real AI and saved data, labeled preview. Timers and required survey answers can be skipped.
 <div className="flex flex-wrap gap-3 mt-2"><label>Condition <select className="border p-2 rounded" value={new URLSearchParams(location.search).get('condition') || 'both'} disabled={busy} onChange={e=>void restart(e.target.value)}><option value="rough">Rough only</option><option value="final">Final only</option><option value="both">Both drafts</option><option value="random-noun">Random noun · Both drafts</option></select></label>
 <button className="border px-3 rounded" disabled={busy} onClick={()=>void restart()}>Start fresh preview</button></div>{error && <p role="alert">{error}</p>}</div>{children}</PreviewMode.Provider>;
 if(ready)return <>{testSession && <div className="bg-amber-50 p-2 text-center text-sm">{dataKind === 'pilot' ? 'Lab pilot' : 'Researcher test'} — real AI replies and data storage. Not a paid Prolific submission.</div>}{children}</>;
 return <main className="min-h-screen bg-gray-50 flex items-center justify-center p-6"><div className="bg-white border rounded-xl p-8 max-w-md w-full">
  <h1 className="text-xl font-semibold mb-4">Writing study</h1>
  {busy?<p>Checking study access…</p>:<><p role="alert" className="mb-4">{error}</p>{!prolific&&<form onSubmit={async e=>{e.preventDefault();setBusy(true);try{const result=await startStudy(code);setDataKind(result.dataKind || '');setTestSession(result.testSession);setIsWalkthrough(result.walkthrough === true);setReady(true);}catch(e){setError(e instanceof Error?e.message:'Unable to enter.');}finally{setBusy(false);}}}>
   <label className="block mb-2" htmlFor="invite">Invitation code</label><input id="invite" type="password" autoComplete="off" className="border rounded-lg p-2 w-full" value={code} onChange={e=>setCode(e.target.value)} required/>
   <button className="mt-4 bg-indigo-600 text-white rounded-lg px-4 py-2" type="submit">Enter study</button>
  </form>}</>}
 </div></main>;
}
