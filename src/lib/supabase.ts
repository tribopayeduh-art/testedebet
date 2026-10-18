import { createClient, type User as SupabaseUser } from '@supabase/supabase-js';
import type { User } from 'firebase/auth';
export const supabaseEnabled = import.meta.env.VITE_DATA_BACKEND === 'supabase';
const url = String(import.meta.env.VITE_SUPABASE_URL || '');
const key = String(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '');
const preferenceKey = 'zerobet:remember-session';
const authKey = 'zerobet:supabase-session';
const sessionStorageAdapter = {
  getItem: (k:string) => localStorage.getItem(preferenceKey) === 'false' ? sessionStorage.getItem(k) : localStorage.getItem(k),
  setItem: (k:string,v:string) => { (localStorage.getItem(preferenceKey) === 'false' ? sessionStorage : localStorage).setItem(k,v); },
  removeItem: (k:string) => { localStorage.removeItem(k); sessionStorage.removeItem(k); },
};
export const supabase = supabaseEnabled && url && key ? createClient(url,key, {auth:{storage:sessionStorageAdapter,storageKey:authKey,persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}}) : null;
export function requireSupabase() { if (!supabase) throw new Error('Supabase não configurado. Confira o arquivo .env.local.'); return supabase; }
export async function supabaseToken(forceRefresh=false) {
  const client=requireSupabase();
  const {data,error}=forceRefresh ? await client.auth.refreshSession() : await client.auth.getSession();
  if(error) throw error;
  if(!data.session) throw new Error('Sua sessão expirou. Entre novamente.');
  return data.session.access_token;
}
// Compatibility boundary for the existing UI; no Firebase SDK operation uses this object.
export function toAppUser(user:SupabaseUser):User {
  return {uid:user.id,email:user.email||null,displayName:user.user_metadata?.displayName||null,photoURL:user.user_metadata?.avatar_url||null,emailVerified:!!user.email_confirmed_at,isAnonymous:!!user.is_anonymous,providerData:[],getIdToken:supabaseToken} as unknown as User;
}
export function setRememberSession(remember:boolean) {
  // Move the existing session before changing the storage destination.
  const existing=sessionStorageAdapter.getItem(authKey);
  sessionStorageAdapter.removeItem(authKey);
  localStorage.setItem(preferenceKey,String(remember));
  if(existing)sessionStorageAdapter.setItem(authKey,existing);
}
export async function supabaseRequest(path:string,body?:unknown) {
  const token=await supabaseToken();
  const r=await fetch(path,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  const data=await r.json(); if(!r.ok)throw new Error(data.message||'Não foi possível concluir a operação.'); return data;
}
