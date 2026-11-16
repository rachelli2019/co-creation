import {handle} from './http.mjs';
export function recallMiddleware(env) {
 return (req,res,next)=>['/api/study','/api/recall'].includes(req.url?.split('?')[0]) ? handle(req,res,{env,allowPreview:true}) : next();
}
