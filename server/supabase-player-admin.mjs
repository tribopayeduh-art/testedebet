import {randomUUID} from 'node:crypto';
import {mapSupabaseRow} from './supabase-admin-reads.mjs';
const uid='[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
export function playerAdminRoute(path,method){
 return (method==='PATCH'&&new RegExp(`^/api/admin/users/${uid}$`,'i').test(path)) || (method==='POST'&&new RegExp(`^/api/admin/(users/${uid}/(wallet-adjustment|zero-balance|grant-bonus)|risk/${uid}/action|staff/${uid}/(role|disable))$`,'i').test(path)) || (method==='GET'&&path==='/api/admin/risk');
}
export function moneyCents(value){
 const text=typeof value==='string'?value.trim().replace(',','.'):String(value);
 if(!/^\d+(?:\.\d{1,2})?$/.test(text))throw Object.assign(new Error('Informe um valor positivo com até duas casas decimais.'),{status:400});
 const cents=Math.round(Number(text)*100);
 if(!Number.isSafeInteger(cents)||cents>100000000)throw Object.assign(new Error('O valor máximo por ajuste é R$ 1.000.000.'),{status:400});
 return cents;
}
export async function playerAdminAction(req,client){
 if(req.path==='/api/admin/risk'){
  const r=await client.from('profiles').select('*').limit(1000);if(r.error)throw r.error;
  return {success:true,rows:r.data.map(x=>({...mapSupabaseRow('profiles',x),score:x.status==='BLOCKED'?50:x.admin_metadata?.withdrawLocked?20:0,flags:[...(x.status==='BLOCKED'?['Conta bloqueada']:[]),...(x.admin_metadata?.withdrawLocked?['Saque bloqueado']:[])],deposits:null,withdraws:null}))};
 }
 const id=req.path.split('/')[4],leaf=req.path.split('/')[5],body=req.body||{};
 let operation='PROFILE',patch=body;
 if(['wallet-adjustment','zero-balance','grant-bonus'].includes(leaf)){
  operation='WALLET';const mode=leaf==='zero-balance'?'SET':leaf==='grant-bonus'?'CREDIT':String(body.mode||'SET').toUpperCase();
  if(!['SET','CREDIT','DEBIT','INCREMENT'].includes(mode))throw Object.assign(new Error('Modo de ajuste inválido.'),{status:400});
  patch={mode,amountCents:leaf==='zero-balance'?0:moneyCents(body.amount??body.targetBalance),reason:body.reason|| (leaf==='zero-balance'?'Saldo zerado pelo administrador':leaf==='grant-bonus'?'Bônus administrativo':'Ajuste administrativo'),bonus:leaf==='grant-bonus',key:String(req.headers['idempotency-key']||body.idempotencyKey||randomUUID())};
 }else if(req.path.includes('/risk/'))operation='RISK';
 else if(req.path.includes('/staff/')){operation='PROFILE';patch=leaf==='role'?{role:body.role==='user'?'player':body.role}:{status:body.disabled?'BLOCKED':'ACTIVE'};}
 const r=await client.rpc('zerobet_player_admin',{p_operation:operation,p_id:id,p_patch:patch});
 if(r.error){const e=r.error;throw Object.assign(new Error(e.code==='PGRST202'?'Execute o SQL 005 de gestão administrativa no Supabase.':e.message),{status:e.code==='PGRST202'?503:e.code==='42501'?403:400});}
 return {success:true,...r.data};
}
