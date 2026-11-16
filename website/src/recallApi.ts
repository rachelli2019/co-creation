export async function recallApi(body: Record<string, unknown>) {
 const response=await fetch('/api/recall',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(60000)});
 const result=await response.json();
 if(!response.ok)throw new Error(result.error||'The story questions could not be loaded.');
 return result;
}
