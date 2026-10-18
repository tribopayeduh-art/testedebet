import {spawn} from 'node:child_process';import fs from 'node:fs';
const port=33120;let log='';
const child=spawn(process.execPath,['server/index.mjs'],{env:{...process.env,PORT:String(port),NODE_ENV:'production',IGAMEWIN_API_URL:'http://127.0.0.1:1',GOOGLE_APPLICATION_CREDENTIALS:'/tmp/nonexistent-audit-creds.json'},stdio:['ignore','pipe','pipe']});
try{
 await new Promise((resolve,reject)=>{
  const timeout=setTimeout(()=>reject(new Error('Server startup timed out')),20000);
  const receive=x=>{log+=x.toString();if(log.includes(`:${port}`)){clearTimeout(timeout);resolve();}};
  child.stdout.on('data',receive);child.stderr.on('data',receive);
  child.once('error',e=>{clearTimeout(timeout);reject(e);});
  child.once('exit',code=>{clearTimeout(timeout);reject(new Error(`Server exited: ${code}`));});
 });
 const results=[];
 for(const [path,method,expected] of [['/brand/nacionalbet-logo.svg','GET',200],['/api/assets/game-image?url=https%3A%2F%2Fexample.com%2Fa.png&sig=invalid','GET',403],['/api/admin/me','GET',401],['/api/wallet/dotfy/deposit','POST',503],['/api/player/kyc-request','POST',503],['/api/system/settings','GET',200]]){
  const r=await fetch(`http://127.0.0.1:${port}`+path,{method,signal:AbortSignal.timeout(10000)});results.push({path,method,status:r.status,expected,pass:r.status===expected});await r.text();
 }
 const report={checkedAt:new Date().toISOString(),results,firebaseStartupError:log.includes('[firebase-admin:init]'),legacyReconcileObserved:log.includes('[reconcileAllPendingDepositsRoutine error]'),limitations:['No authenticated operation, financial transaction or external game launch was executed.','Provider URL replaced only in this test process; provider integration not tested.']};
 fs.writeFileSync('supabase/audit/SMOKE-LOCAL.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
 if(results.some(x=>!x.pass)||report.firebaseStartupError||report.legacyReconcileObserved)process.exitCode=1;
}finally{child.kill('SIGTERM');}
