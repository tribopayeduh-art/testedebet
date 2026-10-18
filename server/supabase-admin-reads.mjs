import {DEFAULT_PLATFORM_SETTINGS} from './public-settings-defaults.mjs';
import { isSecondaryPayment, isSecondaryUser } from './pix-router.mjs';
export const ADMIN_READS={
 '/api/admin/payments':['payment_requests','payments'],
 '/api/admin/support':['support_tickets','tickets'],
 '/api/admin/audit':['admin_audit_logs','logs'],
 '/api/admin/bonuses':['bonuses','bonuses'],
 '/api/admin/affiliates':['affiliates','affiliates'],
 '/api/admin/banner-campaigns':['banner_campaigns','banners'],
 '/api/admin/responsible-gaming':['responsible_limits','rows'],
 '/api/admin/staff':['profiles','staff'],
};
export const CONFIG_READS={'/api/admin/configuration':'public_settings','/api/admin/settings':'public_settings','/api/admin/home-layout':'home_layout'};
export function mapSupabaseRow(table,x){
 const out={...(x.admin_metadata||{}),...x,uid:x.user_id||x.id,createdAt:x.created_at,updatedAt:x.updated_at};
 if(table==='payment_requests')Object.assign(out,{type:x.kind==='WITHDRAWAL'?'WITHDRAW':x.kind,amount:Number(x.amount_cents)/100});
 if(table==='profiles')Object.assign(out,{displayName:x.display_name,accountId:x.account_id,kycStatus:x.kyc_status,admin:x.role==='admin',disabled:x.status==='BLOCKED'});
 if(table==='responsible_limits')Object.assign(out,{selfExcludedUntil:x.self_excluded_until,responsibleLimits:{dailyDeposit:x.daily_deposit_cents==null?null:x.daily_deposit_cents/100,weeklyDeposit:x.weekly_deposit_cents==null?null:x.weekly_deposit_cents/100,monthlyDeposit:x.monthly_deposit_cents==null?null:x.monthly_deposit_cents/100,sessionMinutes:x.session_minutes}});
 if(table==='affiliates')Object.assign(out,{commissionBalance:Number(x.commission_cents)/100});
 if(table==='bonuses')Object.assign(out,x.rules,{id:x.id,title:x.title,active:x.active});
 if(table==='admin_audit_logs')out.actorUid=x.actor_id;
 if(table==='user_notifications')Object.assign(out,{message:x.body,read:!!x.read_at});
 if(table==='banner_campaigns')Object.assign(out,x.presentation||{},{id:x.id,title:x.title,placement:x.placement,active:x.active,action:x.action,targeting:x.targeting,desktopImage:x.presentation?.desktopImage||x.image_path,mobileImage:x.presentation?.mobileImage||x.image_path,sortOrder:x.position,startsAt:x.starts_at,endsAt:x.ends_at,actionType:x.action?.type,actionTarget:x.action?.target});
 return out;
}
export async function supabaseAdminRead(path,client){
 if(ADMIN_READS[path]){
  const [table,key]=ADMIN_READS[path];
  const {data,error}=await client.from(table).select('*').limit(1000);
  if(error)throw new Error(error.message);
  let rows=(data||[]).filter(x=>path!=='/api/admin/staff'||x.role==='admin').map(x=>mapSupabaseRow(table,x));
  if (table === 'payment_requests') {
    rows = rows.filter(x => !isSecondaryPayment(x));
  } else if (table === 'profiles') {
    rows = rows.filter(x => !isSecondaryUser(x));
  }
  return {success:true,[key]:rows,source:'supabase',readOnlyMigration:true};
 }
 if(CONFIG_READS[path]){
  const key=CONFIG_READS[path];const {data,error}=await client.from('platform_config').select('value').eq('key',key).maybeSingle();
  if(error)throw new Error(error.message);
  return key==='home_layout'?{success:true,layout:data?.value?.sections||[]}:{success:true,settings:{...DEFAULT_PLATFORM_SETTINGS,...data?.value}};
 }
 return null;
}
