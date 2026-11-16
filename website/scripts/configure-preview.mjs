// Upload only server configuration to the linked project's Preview environment.
// Secrets are piped over stdin, never included in command arguments or logs.
import {loadEnv} from 'vite';
import {spawnSync} from 'node:child_process';
const env=loadEnv('development',process.cwd(),'');
const values={SUPABASE_URL:env.SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY:env.SUPABASE_SERVICE_ROLE_KEY,STUDY_SESSION_SECRET:env.STUDY_SESSION_SECRET,STUDY_INVITE_CODE:env.STUDY_INVITE_CODE,STUDY_MODE:'test',STUDY_AI_ACCESS:'both',STUDY_ENROLLMENT_OPEN:'false'};
if(env.OPENAI_API_KEY) values.OPENAI_API_KEY=env.OPENAI_API_KEY;
for(const [name,value] of Object.entries(values)){
 if(!value)throw new Error(`${name} missing from local configuration`);
 const secret=/KEY|SECRET|CODE/.test(name);
 const r=spawnSync('npx',['--yes','vercel','env','add',name,'--environment','preview',secret?'--sensitive':'--no-sensitive','--yes'],{input:value,encoding:'utf8'});
 if(r.status!==0){console.error(`Could not configure ${name}. Inspect Vercel environment settings.`);process.exit(1);}
 console.log(`Configured ${name}`);
}
