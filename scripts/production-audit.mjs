import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const failures=[];
const passes=[];
const pass=(m)=>passes.push(m);
const fail=(m)=>failures.push(m);

const read=(p)=>fs.readFileSync(path.join(root,p),'utf8');
const exists=(p)=>fs.existsSync(path.join(root,p));

for(const f of ['package.json','server/index.mjs','src/lib/adminApi.ts','.env.example','ecosystem.config.cjs','deploy/nginx-amora-bet.conf']){
  exists(f)?pass(`arquivo ${f}`):fail(`arquivo ausente ${f}`);
}

const server=read('server/index.mjs');
const adminApi=read('src/lib/adminApi.ts');
const auth=read('src/lib/auth.ts');
const pkg=JSON.parse(read('package.json'));

server.indexOf('dotenv.config') < server.indexOf('await import("firebase-admin")')
  ? pass('env carregado antes do Firebase Admin') : fail('ordem env/Firebase Admin');
server.includes('FIREBASE_SERVICE_ACCOUNT_JSON') && server.includes('GOOGLE_APPLICATION_CREDENTIALS')
  ? pass('duas fontes de credencial Firebase Admin') : fail('credenciais Firebase Admin incompletas');
server.includes('ADMIN_EMAILS') && server.includes('ADMIN_UIDS')
  ? pass('bootstrap admin por env') : fail('bootstrap admin env ausente');
server.includes('res.status(401)') && server.includes('res.status(403)')
  ? pass('401/403 administrativos') : fail('401/403 administrativos');
server.includes('FIREBASE_ADMIN_NOT_CONFIGURED')
  ? pass('admin bloqueado sem credencial') : fail('admin pode não estar bloqueado sem credencial');
!adminApi.includes('adminLocalFallback')
  ? pass('frontend Admin sem bypass Firestore') : fail('adminLocalFallback ainda usado pelo Admin');
!auth.includes('BOOTSTRAP_ADMIN_EMAILS')
  ? pass('frontend não concede Admin por e-mail hardcoded') : fail('frontend ainda concede Admin');

const srcFiles=[];
function walk(dir){
  for(const e of fs.readdirSync(dir,{withFileTypes:true})){
    const p=path.join(dir,e.name);
    if(e.isDirectory()) walk(p); else if(/\.(ts|tsx|js|jsx)$/.test(e.name)) srcFiles.push(p);
  }
}
walk(path.join(root,'src'));
const src=srcFiles.map(f=>fs.readFileSync(f,'utf8')).join('\n');
!/localhost:8787|127\.0\.0\.1:8787/.test(src)
  ? pass('frontend sem URL direta da porta 8787') : fail('frontend contém localhost/8787');
!/(VITE_.*(?:SECRET|TOKEN|PRIVATE|SERVICE_ACCOUNT|IGAMEWIN|CPF_API|PAYONPAG))/i.test(src)
  ? pass('sem VITE_* para segredos') : fail('possível segredo VITE_* no frontend');

const secretFiles=[];
function scanSecrets(dir){
  for(const e of fs.readdirSync(dir,{withFileTypes:true})){
    if(['node_modules','dist','.git'].includes(e.name)) continue;
    const p=path.join(dir,e.name);
    if(e.isDirectory()) scanSecrets(p);
    else {
      const rel=path.relative(root,p);
      if(rel==='.env.example' || rel==='.env.local' || rel==='.env') continue;
      let text=''; try{text=fs.readFileSync(p,'utf8')}catch{continue}
      if(/sk_[A-Za-z0-9_-]{30,}/.test(text) || /IGAMEWIN_AGENT_TOKEN\s*=\s*[^\s#]{15,}/.test(text) || /CPF_API_KEY\s*=\s*[0-9a-f]{40,}/i.test(text)) secretFiles.push(rel);
    }
  }
}
scanSecrets(root);
secretFiles.length===0?pass('sem segredos conhecidos em arquivos versionáveis'):fail(`segredos detectados: ${secretFiles.join(', ')}`);
const gitignore=exists('.gitignore')?read('.gitignore'):'';
gitignore.includes('.env.local')?pass('.env.local protegido no .gitignore'):fail('.env.local não está no .gitignore');

pkg.scripts?.build==='tsc -b && vite build'?pass('script build'):fail('script build');
pkg.scripts?.server==='node server/index.mjs'?pass('script server'):fail('script server');
pkg.scripts?.start==='node server/index.mjs'?pass('script start'):fail('script start');

for(const m of passes) console.log('PASS -',m);
for(const m of failures) console.error('FAIL -',m);
if(failures.length) process.exit(1);
console.log(`\nAuditoria de produção concluída: ${passes.length} verificações.`);
