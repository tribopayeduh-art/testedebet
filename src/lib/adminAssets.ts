import {supabaseEnabled,requireSupabase} from './supabase';
import { auth } from "./firebase";
export async function uploadAdminAsset(file: File): Promise<string> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) throw new Error("Use uma imagem PNG, JPG ou WebP.");
  if (file.size > 15 * 1024 * 1024) throw new Error("A imagem deve ter até 15 MB.");
  if(supabaseEnabled){
    if(file.size>10*1024*1024)throw new Error('A imagem deve ter até 10 MB.');
    const client=requireSupabase();const {data,error}=await client.auth.getUser();
    if(error||!data.user)throw new Error('Entre com sua conta de administrador.');
    const extension=file.type==='image/png'?'png':file.type==='image/webp'?'webp':'jpg';
    const filename=`${data.user.id}/${crypto.randomUUID()}.${extension}`;
    const uploaded=await client.storage.from('zerobet-banners').upload(filename,file,{contentType:file.type,upsert:false});
    if(uploaded.error)throw new Error(uploaded.error.message);
    return client.storage.from('zerobet-banners').getPublicUrl(filename).data.publicUrl;
  }
  const user = auth?.currentUser;
  if (!user) throw new Error("Entre com sua conta de administrador.");
  const response = await fetch("/api/admin/assets", { method: "POST", headers: { Authorization: `Bearer ${await user.getIdToken()}`, "Content-Type": file.type }, body: file });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || "Não foi possível enviar a imagem.");
  return data.url;
}
