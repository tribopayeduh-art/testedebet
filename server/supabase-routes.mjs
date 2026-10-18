import {adminToolsRoute,adminToolsAction} from './supabase-admin-tools.mjs';
import {playerAdminRoute,playerAdminAction} from './supabase-player-admin.mjs';
import {DEFAULT_PLATFORM_SETTINGS} from './public-settings-defaults.mjs';
import {coreRoute,coreAction} from './supabase-core-actions.mjs';
import {bannerWriteRoute,writeSupabaseBanner} from './supabase-banners.mjs';
import {ADMIN_READS, CONFIG_READS, supabaseAdminRead, mapSupabaseRow} from './supabase-admin-reads.mjs';
import { createClient } from '@supabase/supabase-js';
export function supabaseMode(){return process.env.DATA_BACKEND==='supabase';}
function config(){return {url:process.env.SUPABASE_URL,key:process.env.SUPABASE_PUBLISHABLE_KEY};}
function check(result){if(result.error)throw Object.assign(new Error(result.error.message),{status:503});return result.data;}
export async function supabaseMiddleware(req,res,next){
 if(!supabaseMode())return next();
 const path=req.path;
 if(!path.startsWith('/api/')&&!/^\/webhooks?\//.test(path))return next();
 // Public catalog and signed image proxy do not access player data.
 if(req.method==='GET'&&['/api/assets/game-image','/api/igamewin/games','/api/igamewin/providers','/api/games','/api/providers'].includes(path))return next();
 const pending=()=>res.status(503).json({error:'SUPABASE_MIGRATION_PENDING',message:'Esta operação ainda está sendo migrada para o Supabase.'});
 const {url,key}=config();if(!url||!key)return res.status(503).json({error:'SUPABASE_NOT_CONFIGURED',message:'Configure a URL e a chave pública do Supabase no servidor.'});
 const publicClient=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 try{
  if(path==='/api/system/settings'&&req.method==='GET'){
   const rows=check(await publicClient.from('platform_config').select('key,value'))||[];
   const values=Object.fromEntries(rows.map(x=>[x.key,x.value]));
   return res.json({success:true,settings:{...DEFAULT_PLATFORM_SETTINGS,...values.public_settings},theme:values.theme||{},...values.public_settings});
  }
  if(path==='/api/winners-feed'&&req.method==='GET')return res.json({items:[],winners:[]});
  const supported=new Set(['/api/wallet/summary','/api/player/sync-profile','/api/supabase/responsible-limits','/api/admin/me','/api/admin/users','/api/admin/dashboard','/api/admin/finance/dashboard','/api/admin/operations/health','/api/admin/system-readiness']);
  const readOnlyRoute=req.method==='GET' && (ADMIN_READS[path]||CONFIG_READS[path]);
  const toolsRoute=adminToolsRoute(path,req.method);
  const playerAdmin=playerAdminRoute(path,req.method);
  const core=coreRoute(path,req.method);
  const bannerWrite=bannerWriteRoute(path,req.method);
  if(!supported.has(path)&&!readOnlyRoute&&!bannerWrite&&!core&&!playerAdmin&&!toolsRoute)return pending();
  const token=String(req.headers.authorization||'').replace(/^Bearer\s+/i,'').trim();
  if(!token)return res.status(401).json({error:'AUTH_REQUIRED',message:'Entre na sua conta.'});
  const {data,error}=await publicClient.auth.getUser(token);
  if(error||!data.user)return res.status(401).json({error:'INVALID_AUTH',message:'Sessão inválida ou expirada. Entre novamente.'});
  const client=createClient(url,key,{global:{headers:{Authorization:`Bearer ${token}`}},auth:{persistSession:false,autoRefreshToken:false}});
  const profile=check(await client.from('profiles').select('*').eq('id',data.user.id).single());
  if(profile.status!=='ACTIVE')return res.status(403).json({error:'ACCOUNT_BLOCKED',message:'Sua conta está bloqueada.'});
  if(path.startsWith('/api/admin/')&&profile.role!=='admin')return res.status(403).json({error:'ADMIN_REQUIRED',message:'Esta conta não possui acesso administrativo.'});
  if(toolsRoute)return res.json(await adminToolsAction(req,client));
  if(playerAdmin)return res.json(await playerAdminAction(req,client));
  if(core)return res.json(await coreAction(req,client));
  if(bannerWrite)return res.json(await writeSupabaseBanner(req,client));
  if(readOnlyRoute)return res.json(await supabaseAdminRead(path,client));
  if(path==='/api/admin/me'&&req.method==='GET')return res.json({success:true,user:{uid:profile.id,email:data.user.email,role:profile.role,admin:true}});
  if(path==='/api/wallet/summary'&&req.method==='GET'){
   const w=check(await client.from('wallets').select('*').eq('user_id',data.user.id).single());
   return res.json({success:true,walletBalance:Number(w.balance_cents)/100,balance:Number(w.balance_cents)/100,bonusBalance:Number(w.bonus_cents)/100,displayName:profile.display_name,kycStatus:profile.kyc_status,status:profile.status});
  }
  if(path==='/api/player/sync-profile'&&req.method==='POST')return res.json({success:true,uid:profile.id});
  if(path==='/api/admin/operations/health'&&req.method==='GET')return res.json({success:true,health:{backend:true,supabase:true,firebase:false,igamewin:false,igamewinConfigured:false}});
  if(path==='/api/admin/system-readiness'&&req.method==='GET')return res.json({success:true,backend:'supabase',migrationPending:true});
  if(path==='/api/admin/users'&&req.method==='GET'){
   const profiles=check(await client.from('profiles').select('*').order('created_at',{ascending:false}).limit(1000));
   const wallets=check(await client.from('wallets').select('*').limit(1000));const balances=new Map(wallets.map(w=>[w.user_id,w]));
   const users=profiles.map(p=>({id:p.id,uid:p.id,accountId:p.account_id,displayName:p.display_name,...mapSupabaseRow('profiles',p),email:p.email||null,phone:p.phone,cpf:p.cpf,role:p.role,admin:p.role==='admin',status:p.status,kycStatus:p.kyc_status,createdAt:p.created_at,walletBalance:Number(balances.get(p.id)?.balance_cents||0)/100,balance:Number(balances.get(p.id)?.balance_cents||0)/100}));
   return res.json({success:true,users,allUsers:users,totalCount:users.length,filteredCount:users.length,pageSize:users.length,limit:1000});
  }
  if((path==='/api/admin/dashboard'||path==='/api/admin/finance/dashboard')&&req.method==='GET'){
   const [p,w,pay,g,t]=await Promise.all([client.from('profiles').select('*').limit(10000),client.from('wallets').select('balance_cents').limit(10000),client.from('payment_requests').select('*').order('created_at',{ascending:false}).limit(10000),client.from('game_transactions').select('*').order('created_at',{ascending:false}).limit(10000),client.from('support_tickets').select('status').limit(10000)]);
   const profiles=check(p),wallets=check(w),payments=check(pay),games=check(g),tickets=check(t);
   const sum=(rows,key)=>rows.reduce((n,x)=>n+Number(x[key]||0),0)/100;
   const paidDeposits=payments.filter(x=>x.kind==='DEPOSIT'&&x.status==='PAID'),paidWithdrawals=payments.filter(x=>x.kind==='WITHDRAWAL'&&x.status==='PAID');
   if(path==='/api/admin/finance/dashboard')return res.json({success:true,summary:{depositPaid:sum(paidDeposits,'amount_cents'),withdrawPaid:sum(paidWithdrawals,'amount_cents'),paidDepositsCount:paidDeposits.length,paidWithdrawalsCount:paidWithdrawals.length,netCashFlow:sum(paidDeposits,'amount_cents')-sum(paidWithdrawals,'amount_cents')}});
   return res.json({success:true,metrics:{users:profiles.length,activePlayers:profiles.filter(x=>x.status==='ACTIVE'&&x.role==='player').length,totalWallet:sum(wallets,'balance_cents'),betVolume:sum(games,'bet_cents'),winVolume:sum(games,'win_cents'),ggrApprox:sum(games,'bet_cents')-sum(games,'win_cents'),openTickets:tickets.filter(x=>x.status!=='CLOSED').length},recentPayments:payments.slice(0,10).map(x=>({...x,type:x.kind,amount:x.amount_cents/100,createdAt:x.created_at})),recentGameTransactions:games.slice(0,10)});
  }
  return pending();
 }catch(e){console.error('[supabase API]',e.message);return res.status(e.status||503).json({error:'SUPABASE_REQUEST_FAILED',message:e.status===400||e.status===403||e.message?.startsWith('Execute o SQL')?e.message:'Não foi possível acessar os dados do Supabase. Confira o banco e as permissões.'});}
}
