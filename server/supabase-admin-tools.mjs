import {mapSupabaseRow} from './supabase-admin-reads.mjs';
export function adminToolsRoute(path,method){
 return (path==='/api/admin/reports'&&method==='GET')||(['/api/admin/notifications','/api/admin/affiliates','/api/admin/game-overrides'].includes(path)&&['GET','POST'].includes(method))||(/^\/api\/admin\/notifications\/[0-9a-f-]{36}\/publish$/.test(path)&&method==='POST')||(/^\/api\/admin\/game-overrides\/[^/]+$/.test(path)&&method==='PATCH');
}
function check(r){if(r.error)throw Object.assign(new Error(r.error.code==='PGRST202'?'Execute o SQL 006 de ferramentas administrativas no Supabase.':r.error.message),{status:r.error.code==='PGRST202'?503:400});return r.data;}
export async function adminToolsAction(req,client){
 const path=req.path;
 if(path==='/api/admin/reports')return {success:true,...check(await client.rpc('zerobet_admin_report'))};
 if(req.method==='GET'){
  const table=path.endsWith('/notifications')?'notification_campaigns':path.endsWith('/game-overrides')?'game_overrides':'affiliates';
  const key=table==='notification_campaigns'?'notifications':table==='game_overrides'?'overrides':'affiliates';
  return {success:true,[key]:check(await client.from(table).select('*').limit(1000)).map(x=>({...mapSupabaseRow(table,x),...(x.settings||{}),...(x.config||{}),id:x.game_key||x.id,key:x.game_key||x.key}))};
 }
 const operation=path.endsWith('/publish')?'NOTIFICATION_PUBLISH':path==='/api/admin/notifications'?'NOTIFICATION_CREATE':path==='/api/admin/affiliates'?'AFFILIATE_SAVE':'GAME_OVERRIDE';
 const id=path.split('/')[4]?decodeURIComponent(path.split('/')[4]):null;
 const data=check(await client.rpc('zerobet_admin_tool',{p_operation:operation,p_id:id,p_patch:req.body||{}}));
 return {success:true,...data};
}
