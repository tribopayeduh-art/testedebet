import { onValue, ref, set, update, get, serverTimestamp as rtdbServerTimestamp } from 'firebase/database';
import { rtdb } from './firebase';

function withTimeout<T>(promise: Promise<T>, ms = 1500): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))
  ]);
}

export function subscribeRuntimeSettings(cb:(value:any)=>void){
  if(!rtdb){cb({});return()=>{}}
  try {
    return onValue(ref(rtdb,'runtime/publicSettings'),snap=>cb(snap.val()||{}),()=>cb({}));
  } catch {
    cb({});
    return () => {};
  }
}

export async function getRuntimeValue(path:string){
  if(!rtdb)return null;
  try {
    const snap: any = await withTimeout(get(ref(rtdb,path)), 1000);
    return snap && typeof snap.exists === 'function' && snap.exists() ? snap.val() : null;
  } catch {
    return null;
  }
}

export async function setRuntimeValue(path:string,value:any){
  if(!rtdb)return;
  try {
    await withTimeout(set(ref(rtdb,path),value), 1000);
  } catch {
    // Non-blocking
  }
}

export async function patchRuntimeValue(path:string,value:any){
  if(!rtdb)return;
  try {
    await withTimeout(update(ref(rtdb,path),{...value,updatedAt:rtdbServerTimestamp()}), 1000);
  } catch {
    // Non-blocking
  }
}

export async function mirrorRuntimeUser(uid:string,profile:any){
  if(!rtdb||!uid)return;
  const safe={
    displayName:String(profile?.displayName||''),
    email:String(profile?.email||''),
    status:String(profile?.status||'ACTIVE'),
    kycStatus:String(profile?.kycStatus||'NOT_STARTED'),
    walletBalance:Number(profile?.walletBalance??profile?.balance??0),
    vip:Boolean(profile?.vip),
    updatedAt:rtdbServerTimestamp(),
  };
  try {
    await withTimeout(update(ref(rtdb,`runtime/users/${uid}`),safe), 1000);
  } catch {
    // Non-blocking
  }
}

