export const bannerWriteRoute = (path,method) =>
 (path==='/api/admin/banner-campaigns'&&method==='POST') ||
 (/^\/api\/admin\/banner-campaigns\/[0-9a-f-]{36}$/.test(path)&&['PATCH','DELETE'].includes(method)) ||
 (/^\/api\/admin\/banner-campaigns\/[0-9a-f-]{36}\/duplicate$/.test(path)&&method==='POST');
export function normalizeBannerPatch(input){
 if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Dados do banner inválidos.');
 const allowed=['name','title','subtitle','status','active','placement','template','desktopImage','mobileImage','desktopWidth','desktopHeight','mobileWidth','mobileHeight','sizePreset','objectFit','objectPosition','borderRadius','overlayOpacity','textColor','buttonColor','buttonText','badge','alignment','action','targeting','schedule','frequency','priority','sortOrder','autoplayMs','loop','showDots','showArrows','swipe'];
 const out=Object.fromEntries(Object.entries(input).filter(([k])=>allowed.includes(k)));
 const safeUrl=value=>value==null||value===''||(typeof value==='string'&&!/[\\\u0000-\u001f]/.test(value)&&(/^\/(?!\/)/.test(value)||/^https?:\/\/[^/\s]+/i.test(value)));
 for(const k of ['desktopImage','mobileImage'])if(k in out&&(typeof out[k]!=='string'||!safeUrl(out[k])))throw new Error('Use uma URL HTTP/HTTPS ou caminho local para a imagem.');
 if(out.action){if(typeof out.action!=='object'||Array.isArray(out.action))throw new Error('Ação inválida.');if(!safeUrl(out.action.url))throw new Error('O link do botão deve usar HTTP/HTTPS ou um caminho local.');}
 if('active' in out&&typeof out.active!=='boolean')throw new Error('Ativação inválida.');
 if(out.schedule){out.schedule={...out.schedule};for(const k of ['startsAt','endsAt']){const v=out.schedule[k];if(v){const d=new Date(v);if(!Number.isFinite(d.getTime()))throw new Error('Data de publicação inválida.');out.schedule[k]=d.toISOString();}}if(out.schedule.startsAt&&out.schedule.endsAt&&out.schedule.startsAt>=out.schedule.endsAt)throw new Error('O fim deve ser posterior ao início.');}
 if(JSON.stringify(out).length>32768)throw new Error('Configuração do banner muito grande.');return out;
}
export async function writeSupabaseBanner(req,client){
 const path=req.path,id=path.split('/')[4]||null;
 const operation=path.endsWith('/duplicate')?'DUPLICATE':req.method==='DELETE'?'DELETE':id?'UPDATE':'CREATE';
 let patch={};
 try{if(['CREATE','UPDATE'].includes(operation))patch=normalizeBannerPatch(req.body);}catch(error){throw Object.assign(error,{status:400});}
 const {data,error}=await client.rpc('zerobet_manage_banner',{p_operation:operation,p_id:id,p_patch:patch});
 if(error){const missing=error.code==='PGRST202';throw Object.assign(new Error(missing?'Execute o SQL de gerenciamento de banners no Supabase antes de salvar.':error.message),{status:missing?503:error.code==='42501'?403:400});}
 return {success:true,id:data?.id||id};
}
