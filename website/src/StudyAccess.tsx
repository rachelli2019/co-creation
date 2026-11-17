import {useEffect,useState,type ReactNode} from 'react';
import {studyApi} from './studyApi';
let startPromise: ReturnType<typeof studyApi> | undefined;
export function startStudy(invite?: string) {
 if (!startPromise || invite !== undefined) {
  const params=new URLSearchParams(window.location.search);
  const fragment=new URLSearchParams(window.location.hash.slice(1));
  startPromise=studyApi({action:'start',condition:params.get('condition'),invite:invite ?? fragment.get('invite') ?? params.get('invite') ?? '',
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
 const [testSession,setTestSession]=useState(false);
 const [ready,setReady]=useState(false),[error,setError]=useState(''),[code,setCode]=useState(''),[busy,setBusy]=useState(true);
 const prolific=new URLSearchParams(window.location.search).has('SESSION_ID');
 useEffect(()=>{startStudy().then(result=>{setTestSession(result.testSession);setIsWalkthrough(result.walkthrough === true);setReady(true);}).catch(e=>setError(e.message)).finally(()=>setBusy(false));},[]);
 if(ready && isWalkthrough)return walkthrough;
 if(ready)return <>{testSession && <div className="bg-amber-50 p-2 text-center text-sm">Researcher test session — real AI replies and data storage. Not a paid Prolific submission.</div>}{children}</>;
 return <main className="min-h-screen bg-gray-50 flex items-center justify-center p-6"><div className="bg-white border rounded-xl p-8 max-w-md w-full">
  <h1 className="text-xl font-semibold mb-4">Writing study</h1>
  {busy?<p>Checking study access…</p>:<><p role="alert" className="mb-4">{error}</p>{!prolific&&<form onSubmit={async e=>{e.preventDefault();setBusy(true);try{const result=await startStudy(code);setTestSession(result.testSession);setIsWalkthrough(result.walkthrough === true);setReady(true);}catch(e){setError(e instanceof Error?e.message:'Unable to enter.');}finally{setBusy(false);}}}>
   <label className="block mb-2" htmlFor="invite">Invitation code</label><input id="invite" type="password" autoComplete="off" className="border rounded-lg p-2 w-full" value={code} onChange={e=>setCode(e.target.value)} required/>
   <button className="mt-4 bg-indigo-600 text-white rounded-lg px-4 py-2" type="submit">Enter study</button>
  </form>}</>}
 </div></main>;
}
