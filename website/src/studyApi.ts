export async function studyApi(body: Record<string, unknown>, signal?: AbortSignal) {
 const response=await fetch('/api/study',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:signal||AbortSignal.timeout(60000)});
 const result=await response.json();
 if(!response.ok)throw new Error(result.error||'The study service is unavailable.');
 return result;
}
