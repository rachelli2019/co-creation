import {handle} from '../server/http.mjs';
export const config={maxDuration:60};
export default (req,res)=>handle(req,res,{path:'/api/recall'});
