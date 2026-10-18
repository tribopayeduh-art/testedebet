const base=String(process.env.BASE_URL||'http://127.0.0.1:8787').replace(/\/$/,'');
const adminToken=String(process.env.ADMIN_ID_TOKEN||'').trim();

async function call(name,path,options={},expected=[200]){
  const r=await fetch(base+path,{...options,headers:{Accept:'application/json',...(options.headers||{})}});
  const text=await r.text();
  let data={}; try{data=JSON.parse(text)}catch{data={raw:text.slice(0,160)}}
  const ok=expected.includes(r.status);
  console.log(`${ok?'PASS':'FAIL'} ${name}: HTTP ${r.status}`);
  if(!ok) console.log(data);
  return {ok,status:r.status,data};
}

let failed=false;
for(const result of [
  await call('health','/api/health'),
  await call('providers','/api/providers'),
  await call('games','/api/games'),
  await call('admin sem token','/api/admin/me',{},[401]),
  await call('whatsapp POST sem token','/api/admin/whatsapp/connect',{method:'POST',headers:{'Content-Type':'application/json'}},[401]),
]) if(!result.ok) failed=true;

if(adminToken){
  const headers={Authorization:`Bearer ${adminToken}`};
  for(const result of [
    await call('admin/me','/api/admin/me',{headers},[200,403,503]),
    await call('admin readiness','/api/admin/system-readiness',{headers},[200,403,503]),
    await call('whatsapp status','/api/admin/whatsapp/status',{headers},[200,403,503]),
  ]) if(!result.ok) failed=true;
}else{
  console.log('INFO - ADMIN_ID_TOKEN não informado; testes administrativos autenticados foram ignorados.');
}

process.exit(failed?1:0);
