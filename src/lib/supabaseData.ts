import {createRefreshQueue} from './refreshQueue';
import { requireSupabase, supabaseRequest } from './supabase';
import type { UserProfile } from './data';
export function check<T extends {error:any}>(result:T):T {if(result.error)throw new Error(result.error.message);return result;}
export function subscribeRows(table:string,cb:(rows:any[])=>void, options:{field?:string;value?:string;order?:string;limit?:number}={}) {
 const client=requireSupabase();let stopped=false,last:string|undefined;
 const queue=createRefreshQueue(async()=>{let q=client.from(table).select('*');if(options.field)q=q.eq(options.field,options.value);if(options.order)q=q.order(options.order,{ascending:false});q=q.limit(options.limit||100);const rows=check(await q).data||[];if(stopped)return;const signature=JSON.stringify(rows);if(signature!==last){last=signature;cb(rows);}},e=>console.error('[Supabase]',table,e));
 const refresh=()=>{if(!document.hidden)queue.request();};
 queue.request();const filter=options.field?`${options.field}=eq.${options.value}`:undefined;
 const channel=client.channel(`${table}:${crypto.randomUUID()}`).on('postgres_changes',{event:'*',schema:'public',table,...(filter?{filter}:{})},refresh).subscribe();
 const timer=window.setInterval(refresh,30000);document.addEventListener('visibilitychange',refresh);
 return ()=>{stopped=true;queue.stop();clearInterval(timer);document.removeEventListener('visibilitychange',refresh);void client.removeChannel(channel);};
}
export async function loadProfile(uid:string):Promise<UserProfile|null> {
 const client=requireSupabase();
 const [profileResult,walletResult,limitsResult,sessionResult]=await Promise.all([
  client.from('profiles').select('*').eq('id',uid).maybeSingle(),
  client.from('wallets').select('*').eq('user_id',uid).maybeSingle(),
  client.from('responsible_limits').select('*').eq('user_id',uid).maybeSingle(),
  client.auth.getSession()
 ]);
 const p=check(profileResult).data;if(!p)return null;
 const wallet=check(walletResult).data,limits=check(limitsResult).data,current=check(sessionResult).data.session?.user;
 return {uid:p.id,accountId:String(p.account_id),displayName:p.display_name,email:current?.email||null,phone:p.phone||current?.user_metadata?.phone,cpf:p.cpf||current?.user_metadata?.cpf,birthDate:p.birth_date||current?.user_metadata?.birthDate,role:p.role,admin:p.role==='admin',status:p.status,kycStatus:p.kyc_status,walletBalance:Number(wallet?.balance_cents||0)/100,balance:Number(wallet?.balance_cents||0)/100,bonusBalance:Number(wallet?.bonus_cents||0)/100,createdAt:p.created_at,updatedAt:p.updated_at,selfExcludedUntil:limits?.self_excluded_until,responsibleLimits:limits?{dailyDeposit:limits.daily_deposit_cents==null?undefined:limits.daily_deposit_cents/100,weeklyDeposit:limits.weekly_deposit_cents==null?undefined:limits.weekly_deposit_cents/100,monthlyDeposit:limits.monthly_deposit_cents==null?undefined:limits.monthly_deposit_cents/100,sessionMinutes:limits.session_minutes}:undefined};
}
export function subscribeAccount(uid:string,cb:(p:UserProfile|null)=>void){
 const client=requireSupabase();let stopped=false,last:string|undefined;
 const queue=createRefreshQueue(async()=>{const profile=await loadProfile(uid);if(stopped)return;const signature=JSON.stringify(profile);if(signature!==last){last=signature;cb(profile);}},e=>console.error('[Supabase profile]',e));
 const refresh=()=>{if(!document.hidden)queue.request();};
 const channel=client.channel(`account:${uid}:${crypto.randomUUID()}`);
 for(const table of ['profiles','wallets','responsible_limits'])channel.on('postgres_changes',{event:'*',schema:'public',table,filter:`${table==='profiles'?'id':'user_id'}=eq.${uid}`},refresh);
 channel.subscribe();queue.request();const timer=window.setInterval(refresh,30000);document.addEventListener('visibilitychange',refresh);
 return()=>{stopped=true;queue.stop();clearInterval(timer);document.removeEventListener('visibilitychange',refresh);void client.removeChannel(channel);};
}
export async function updateProfile(uid:string,patch:Record<string,unknown>) {
 const fields:Record<string,string>={displayName:'display_name',phone:'phone',birthDate:'birth_date'};
 const payload:Record<string,unknown>={};for(const [k,v] of Object.entries(patch)){if(k==='updatedAt')continue;if(!fields[k])throw new Error('Este dado deve ser atualizado pela validação da conta.');payload[fields[k]]=v;}
 const r=check(await requireSupabase().from('profiles').update(payload).eq('id',uid).select('id'));if(!r.data?.length)throw new Error('Perfil não encontrado ou alteração não permitida.');
}
export async function favorite(uid:string,game:{code:string;providerCode:string}){const c=requireSupabase(),key=`${game.providerCode}:${game.code}`;const row=check(await c.from('favorites').select('game_key').eq('user_id',uid).eq('game_key',key).maybeSingle()).data;if(row){check(await c.from('favorites').delete().eq('user_id',uid).eq('game_key',key));return false;}check(await c.from('favorites').insert({user_id:uid,game_key:key}));return true;}
export function config(key:string,cb:(value:any)=>void){return subscribeRows('platform_config',rows=>cb(rows[0]?.value||{}),{field:'key',value:key});}
export function unavailable():never{throw new Error('Esta operação ainda está sendo migrada para o Supabase.');}
export const saveLimits=(limits:any)=>supabaseRequest('/api/supabase/responsible-limits',limits);

export const saveSelfExclusion=(until:string|null,reason?:string)=>supabaseRequest('/api/supabase/self-exclusion',{until,reason});
