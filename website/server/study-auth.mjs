import {createHmac, timingSafeEqual} from 'node:crypto';
export const COOKIE = 'study_session';
export function equalSecret(a, b) {
 if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
 const x = Buffer.from(a), y = Buffer.from(b);
 return x.length === y.length && timingSafeEqual(x,y);
}
export function issueSession(id, env, now = Date.now(), mode = 'study') {
 if (!env.STUDY_SESSION_SECRET || env.STUDY_SESSION_SECRET.length < 32) throw new Error('Session signing is not configured');
 const data = Buffer.from(JSON.stringify({id, exp: now + 7200000, mode})).toString('base64url');
 return `${data}.${createHmac('sha256', env.STUDY_SESSION_SECRET).update(data).digest('base64url')}`;
}
export function readSession(cookie, env, now = Date.now()) {
 try {
  if (!env.STUDY_SESSION_SECRET || env.STUDY_SESSION_SECRET.length < 32) return null;
  const value = (cookie || '').split(';').map(s=>s.trim()).find(s=>s.startsWith(`${COOKIE}=`))?.slice(COOKIE.length+1);
  const [data, signature, extra] = (value || '').split('.');
  if (extra || !data || !equalSecret(signature, createHmac('sha256',env.STUDY_SESSION_SECRET).update(data).digest('base64url'))) return null;
  const parsed = JSON.parse(Buffer.from(data,'base64url').toString());
  return /^[\da-f-]{36}$/i.test(parsed.id) && parsed.exp > now ? parsed : null;
 } catch {return null;}
}
export async function database(env, path, options = {}) {
 const url = env.SUPABASE_URL;
 const key = env.SUPABASE_SERVICE_ROLE_KEY;
 if (!url || !key) throw new Error('Database is not configured');
 return fetch(`${url}/rest/v1/${path}`, {...options, signal: AbortSignal.timeout(15000), headers: {
  apikey:key, Authorization:`Bearer ${key}`, 'Content-Type':'application/json', Prefer:'return=representation', ...options.headers
 }});
}
export async function requireSession(cookie, body, env) {
 const token = readSession(cookie,env);
 if (!token || (body.sessionId && body.sessionId !== token.id)) return null;
 const response = await database(env,`sessions?id=eq.${token.id}&revoked=eq.false&select=*`);
 if (!response.ok) throw new Error('Could not verify session');
 const session = (await response.json())[0];
 return session && Date.parse(session.expires_at) > Date.now() ? session : null;
}
export function sameOrigin(req) {
 const origin = req.headers.origin;
 if (!origin) return true; // Non-browser callers still need the signed session/invitation.
 try {return new URL(origin).host === req.headers.host;} catch {return false;}
}
