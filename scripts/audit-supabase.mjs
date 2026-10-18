import {bannerWriteRoute} from '../server/supabase-banners.mjs';
import {coreRoute} from '../server/supabase-core-actions.mjs';
import dotenv from 'dotenv';
import fs from 'node:fs';
import {ADMIN_READS,CONFIG_READS} from '../server/supabase-admin-reads.mjs';
dotenv.config({path:'.env.local',quiet:true});dotenv.config({path:'.env',quiet:true});
const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_PUBLISHABLE_KEY;
if(!url||!key)throw new Error('Configure SUPABASE_URL e SUPABASE_PUBLISHABLE_KEY no servidor.');
const columns={
 profiles:'id,account_id,display_name,phone,cpf,birth_date,role,status,kyc_status,created_at,updated_at',
 wallets:'user_id,balance_cents,bonus_cents,currency,updated_at',
 wallet_entries:'id,user_id,amount_cents,balance_after_cents,kind,idempotency_key,metadata,created_at',
 payment_requests:'id,user_id,kind,amount_cents,status,external_id,metadata,created_at,updated_at',
 game_transactions:'id,user_id,provider,game_code,external_id,bet_cents,win_cents,metadata,created_at',
 favorites:'user_id,game_key,created_at',user_notifications:'id,user_id,title,body,read_at,created_at',
 support_tickets:'id,user_id,subject,message,status,created_at',affiliates:'user_id,code,status,commission_cents,clicks,registrations,created_at',
 referrals:'user_id,affiliate_id,created_at',responsible_limits:'user_id,daily_deposit_cents,weekly_deposit_cents,monthly_deposit_cents,session_minutes,self_excluded_until,updated_at',
 bonuses:'id,title,active,rules,created_at',bonus_grants:'id,user_id,bonus_id,amount_cents,status,idempotency_key,created_at',
 banner_campaigns:'id,title,placement,image_path,active,position,action,targeting,starts_at,ends_at,created_at',
 platform_config:'key,value,updated_at',admin_audit_logs:'id,actor_id,action,target_id,metadata,created_at',
};
const publicTables=new Set(['bonuses','banner_campaigns','platform_config']);
const results=[];
const entries=Object.entries(columns);
for(let i=0;i<entries.length;i+=4){
 const batch=await Promise.all(entries.slice(i,i+4).map(async([table,cols])=>{
  try{const r=await fetch(`${url}/rest/v1/${table}?select=${cols}&limit=1`,{headers:{apikey:key},signal:AbortSignal.timeout(10000)});const data=await r.json();const code=Array.isArray(data)?null:data.code;
   return {table,columns:cols.split(','),http:r.status,code,classification:r.ok?(publicTables.has(table)?'public_read_ok':'REVIEW_PRIVATE_TABLE_PUBLIC_READ'):(code==='42501'&&!publicTables.has(table)?'anonymous_access_denied_expected':'needs_review'),rowsInspected:r.ok&&Array.isArray(data)?data.length:0};
  }catch(e){return {table,classification:'connection_failed',message:e.message};}
 }));results.push(...batch);
}
const source=fs.readFileSync('server/index.mjs','utf8');
const legacyRoutes=[];
for(const m of source.matchAll(/app\.(get|post|put|patch|delete|all)\((\[[^\]]+\]|"[^"]+"|'[^']+')/g)){
 for(const q of m[2].matchAll(/["']([^"']+)["']/g))legacyRoutes.push({method:m[1].toUpperCase(),path:q[1]});
}
const reads=new Set([...Object.keys(ADMIN_READS),...Object.keys(CONFIG_READS),'/api/system/settings','/api/winners-feed','/api/admin/me','/api/wallet/summary','/api/admin/operations/health','/api/admin/system-readiness','/api/admin/users','/api/admin/dashboard','/api/admin/finance/dashboard']);
const report={checkedAt:new Date().toISOString(),project:url,mode:process.env.DATA_BACKEND,serverSecretPresent:!!process.env.SUPABASE_SECRET_KEY,limitations:['Public key cannot inspect private player records or SQL metadata.','SQL audit must be run in Supabase SQL Editor.','Authenticated roles/uploads and financial integrations require separate testing.'],tables:results,routes:legacyRoutes.map(r=>({...r,status:r.method==='GET'&&['/api/assets/game-image','/api/igamewin/games','/api/igamewin/providers','/api/games','/api/providers'].includes(r.path)?'public_provider_read_only':bannerWriteRoute(r.path.replace(/:[^/]+/g,'12345678-1234-1234-1234-123456789abc'),r.method)?'supabase_banner_implemented_auth_test_pending':coreRoute(r.path.replace(/:[^/]+/g,'12345678-1234-1234-1234-123456789abc'),r.method)?'supabase_core_implemented_requires_sql004_and_auth_test':r.method==='GET'&&reads.has(r.path)?'supabase_read_implemented_auth_test_pending':r.method==='POST'&&r.path==='/api/player/sync-profile'?'supabase_implemented_auth_test_pending':!r.path.startsWith('/api/')&&!/^\/webhooks?\//.test(r.path)?'outside_supabase_api_guard':'migration_pending'}))};
fs.mkdirSync('supabase/audit',{recursive:true});fs.writeFileSync('supabase/audit/public-audit.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({tables:results.map(({table,http,code,classification})=>({table,http,code,classification})),routes:report.routes.length,supabaseReadEndpoints:reads.size,serverSecretPresent:report.serverSecretPresent},null,2));
