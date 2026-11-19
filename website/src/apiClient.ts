const failures = new Map<string, string>();
const listeners = new Set<() => void>();
export function connectionErrors() { return [...failures.values()]; }
export function subscribeConnectionErrors(listener: () => void) {
 listeners.add(listener);
 return () => {listeners.delete(listener);};
}
function report(key: string, message?: string) {
 if (message) failures.set(key,message); else failures.delete(key);
 listeners.forEach(listener => listener());
}
const labels: Record<string,string> = {
 start:'Starting the study', phase:'Starting the writing section', chat:'Contacting the AI writing assistant',
 events:'Saving your interaction log', snapshots:'Saving your progress', save_record:'Saving your responses', generate:'Preparing your quiz',
 status:'Checking your quiz', score:'Submitting your quiz', finish:'Submitting your study',
};
export async function apiRequest(path: string, body: Record<string,unknown>, signal?: AbortSignal) {
 const action=String(body.action || 'request');
 const key=`${path}:${action}:${body.kind || ''}`;
 const label=labels[action] || 'Connecting to the study';
 try {
  let response: Response;
  try {
   response=await fetch(path,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:signal || AbortSignal.timeout(60000)});
  } catch (error) {
   const timedOut=error instanceof Error && ['TimeoutError','AbortError'].includes(error.name);
   throw new Error(timedOut ? 'The request timed out. Please retry. It may already have reached the server.' : 'Cannot connect to the study server. Check your internet connection and retry.');
  }
  let result;
  try {result=await response.json();}
  catch {throw new Error(`The study server returned an unexpected response (${response.status}). Please retry.`);}
  if(!response.ok) throw new Error(typeof result?.error === 'string' ? result.error : `The study service is unavailable (${response.status}). Please retry.`);
  report(key);
  return result;
 } catch(error) {
  report(key,`${label}: ${error instanceof Error ? error.message : 'Please retry.'}`);
  throw error;
 }
}
