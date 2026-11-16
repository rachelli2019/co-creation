import {spawnSync} from 'node:child_process';
const values={STUDY_MODE:'walkthrough',STUDY_INVITE_CODE:'preview-2026',STUDY_ENROLLMENT_OPEN:'true',VITE_HOSTED_PREVIEW:'true'};
for(const [name,value] of Object.entries(values)){
 const r=spawnSync('npx',['--yes','vercel','env','add',name,'--environment','preview','--force',name==='STUDY_INVITE_CODE'?'--sensitive':'--no-sensitive','--yes'],{input:value,encoding:'utf8'});
 if(r.status!==0){console.error(`Could not configure ${name}`);process.exit(1);}console.log(`Configured ${name}`);
}
