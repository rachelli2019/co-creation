import {useEffect,useState} from 'react';
import {connectionErrors,subscribeConnectionErrors} from './apiClient';
export default function BackendStatus() {
 const [logWarning,setLogWarning]=useState('');
 useEffect(()=>{const listener=(e:Event)=>setLogWarning((e as CustomEvent<string>).detail);window.addEventListener('study-log-warning',listener);return ()=>window.removeEventListener('study-log-warning',listener);},[]);
 const [errors,setErrors]=useState(connectionErrors);
 const [offline,setOffline]=useState(!navigator.onLine);
 useEffect(()=>subscribeConnectionErrors(()=>setErrors(connectionErrors())),[]);
 useEffect(()=>{
  const update=()=>setOffline(!navigator.onLine);
  window.addEventListener('online',update);window.addEventListener('offline',update);
  return ()=>{window.removeEventListener('online',update);window.removeEventListener('offline',update);};
 },[]);
 if(!offline && !errors.length && !logWarning)return null;
 return <aside role="alert" className="sticky top-0 z-50 border-b border-red-300 bg-red-50 px-5 py-3 text-sm text-red-900">
  <strong>{offline ? 'You are offline.' : 'A study request could not be completed.'}</strong>
  {logWarning && <p>{logWarning}</p>}
  {errors.map(error=><p key={error} className="mt-1">{error}</p>)}
  <p className="mt-1">Keep this page open. Progress saves retry automatically; for other actions, use the retry or submit button on the page. Do not assume a failed save has been recorded.</p>
 </aside>;
}
