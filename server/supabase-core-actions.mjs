import {mapSupabaseRow} from './supabase-admin-reads.mjs';
const uuid='[0-9a-f-]{36}';
export function playerStats(payments,games,wallet){
 const sum=(list,key)=>list.reduce((n,x)=>n+Number(x[key]||0),0)/100;
 const deposits=payments.filter(x=>x.kind==='DEPOSIT'&&x.status==='PAID');
 const withdrawals=payments.filter(x=>x.kind==='WITHDRAWAL'&&x.status==='PAID');
 const totalDeposits=sum(deposits,'amount_cents'),totalWithdrawals=sum(withdrawals,'amount_cents');
 return {totalDeposits,totalWithdrawals,depositCount:deposits.length,withdrawalCount:withdrawals.length,netProfit:totalDeposits-totalWithdrawals,pendingWithdrawals:sum(payments.filter(x=>x.kind==='WITHDRAWAL'&&['PENDING','IN_REVIEW','PROCESSING'].includes(x.status)),'amount_cents'),currentBalance:wallet.balance_cents/100,bonusBalance:wallet.bonus_cents/100,totalBets:sum(games,'bet_cents'),totalWins:sum(games,'win_cents'),lastDepositAt:deposits[0]?.created_at||null,lastWithdrawalAt:withdrawals[0]?.created_at||null};
}
export function coreRoute(path,method){
 if(method==='PATCH'&&['/api/admin/configuration','/api/admin/settings','/api/admin/home-layout'].includes(path))return true;
 if(method==='POST'&&['/api/supabase/responsible-limits','/api/supabase/self-exclusion','/api/admin/bonuses'].includes(path))return true;
 if(method==='PATCH'&&new RegExp(`^/api/admin/support/${uuid}$`).test(path))return true;
 if(['PATCH','DELETE'].includes(method)&&new RegExp(`^/api/admin/bonuses/${uuid}$`).test(path))return true;
 return method==='GET'&&new RegExp(`^/api/admin/users/${uuid}/details$`).test(path);
}
function check(result){if(result.error)throw Object.assign(new Error(result.error.code==='PGRST202'?'Execute o SQL 004 de ações no Supabase.':result.error.message),{status:result.error.code==='PGRST202'?503:400});return result.data;}
export async function coreAction(req,client){
 const path=req.path,id=path.split('/')[4]||null;
 if(path.endsWith('/details')){
  const p=check(await client.from('profiles').select('*').eq('id',id).single());
  const w=check(await client.from('wallets').select('*').eq('user_id',id).single());
  const tables=['payment_requests','wallet_entries','bonus_grants','game_transactions'];
  const rows=await Promise.all(tables.map(async t=>check(await client.from(t).select('*').eq('user_id',id).order('created_at',{ascending:false}).limit(1000))));
  const [payments,entries,grants,games]=rows;
  return {success:true,user:{...mapSupabaseRow('profiles',p),walletBalance:w.balance_cents/100,balance:w.balance_cents/100,bonusBalance:w.bonus_cents/100},paymentRequests:payments.map(x=>mapSupabaseRow('payment_requests',x)),walletAdjustments:entries.map(x=>({...x,...x.metadata,amount:x.amount_cents/100,balanceAfter:x.balance_after_cents/100,createdAt:x.created_at})),bonusGrants:grants.map(x=>({...x,amount:x.amount_cents/100,createdAt:x.created_at})),stats:playerStats(payments,games,w),truncated:rows.some(x=>x.length===1000)};
 }
 const op=path.endsWith('/home-layout')?'HOME_LAYOUT':path.endsWith('/configuration')||path.endsWith('/settings')?'PUBLIC_SETTINGS':path.includes('/support/')?'SUPPORT_UPDATE':path.includes('/bonuses')?`BONUS_${req.method==='POST'?'CREATE':req.method==='DELETE'?'DELETE':'UPDATE'}`:path.endsWith('/self-exclusion')?'SELF_EXCLUSION':'RESPONSIBLE_LIMITS';
 const data=check(await client.rpc('zerobet_core_action',{p_operation:op,p_id:id,p_patch:req.body||{}}));if(op==='PUBLIC_SETTINGS'){const saved=check(await client.from('platform_config').select('value').eq('key','public_settings').single());return {success:true,settings:saved.value};}return {success:true,...data};
}
