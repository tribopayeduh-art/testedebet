import {supabaseEnabled} from '../../lib/supabase';
import {uploadAdminAsset} from '../../lib/adminAssets';
import { useState, useEffect } from "react";
import { adminApi } from "../../lib/adminApi";
import { storage } from "../../lib/firebase";
import { ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";
import { PageTitle, Status, money } from "./AdminComponents";

export default function BonusesPage() {
  const [items, setItems] = useState<any[]>([]);
  const [form, setForm] = useState<any>({
    title: "", type: "DEPOSIT", percent: 300, minDeposit: 10, maxBonus: 1000,
    rollover: 0, active: true, image: "", imageSizePreset: "4:5",
    placement: "BONUSES_MAIN", buttonText: "RESGATAR"
  });
  const [msg, setMsg] = useState("");

  const load = () => adminApi<any>("/api/admin/bonuses").then(d => setItems(d.bonuses || [])).catch(e => setMsg(e?.message || ""));
  useEffect(() => { void load(); }, []);

  async function upload(file?: File) {
    if (!file) return;
    if(supabaseEnabled){
      setMsg('Enviando imagem...');
      try{const image=await uploadAdminAsset(file);setForm((x:any)=>({...x,image}));setMsg('Imagem enviada. Salve o bônus para associá-la.');}catch(e:any){setMsg(e.message);}
      return;
    }
    if(!storage)return;
    setMsg("Enviando imagem...");
    try {
      const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const r = storageRef(storage, `bonuses/${Date.now()}-${safe}`);
      await uploadBytes(r, file, { contentType: file.type });
      const url = await getDownloadURL(r);
      setForm((x: any) => ({ ...x, image: url })); setMsg("Imagem do bônus salva no Storage.");
    } catch (e: any) { setMsg(e.message); }
  }

  async function create() {
    try {
      await adminApi("/api/admin/bonuses", { method: "POST", body: JSON.stringify(form) });
      setForm({ ...form, title: "" });
      setMsg("Bônus criado.");
      await load();
    } catch (e: any) { setMsg(e?.message || ""); }
  }

  async function toggle(x: any) {
    try {
      await adminApi(`/api/admin/bonuses/${x.id}`, { method: "PATCH", body: JSON.stringify({ active: x.active === false }) });
      await load();
    } catch (e: any) { setMsg(e?.message || ""); }
  }

  async function remove(id: string) {
    try {
      await adminApi(`/api/admin/bonuses/${id}`, { method: "DELETE" });
      await load();
    } catch (e: any) { setMsg(e?.message || ""); }
  }

  const ratio = form.imageSizePreset === '1:1' ? '1/1' : form.imageSizePreset === '16:9' ? '16/9' : form.imageSizePreset === '9:16' ? '9/16' : '4/5';

  return <>
    <PageTitle eyebrow="PROMOÇÕES" title="Bônus" text="Controle regras, banner, tamanho, posicionamento e CTA de cada bônus." />
    <div className="admin-two-cols unequal">
      <div className="admin-card admin-form-card">
        <h3>Novo bônus</h3>
        <label className="admin-field"><span>Nome</span><input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></label>
        <div className="admin-form-grid">
          <label className="admin-field"><span>Tipo</span><select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}><option>DEPOSIT</option><option>CASHBACK</option><option>FIXED</option></select></label>
          <label className="admin-field"><span>Percentual</span><input type="number" value={form.percent} onChange={e => setForm({ ...form, percent: Number(e.target.value) })} /></label>
        </div>
        <div className="admin-form-grid">
          <label className="admin-field"><span>Depósito mínimo</span><input type="number" value={form.minDeposit} onChange={e => setForm({ ...form, minDeposit: Number(e.target.value) })} /></label>
          <label className="admin-field"><span>Bônus máximo</span><input type="number" value={form.maxBonus} onChange={e => setForm({ ...form, maxBonus: Number(e.target.value) })} /></label>
        </div>
        <label className="admin-field"><span>Rollover</span><input type="number" value={form.rollover} onChange={e => setForm({ ...form, rollover: Number(e.target.value) })} /></label>
        <label className="admin-field"><span>Banner do bônus</span><div className="banner-upload-row"><input value={form.image || ""} onChange={e => setForm({ ...form, image: e.target.value })} /><label className="banner-upload-btn">UPLOAD<input type="file" accept="image/*" onChange={e => upload(e.target.files?.[0])} /></label></div></label>
        <div className="admin-form-grid">
          <label className="admin-field"><span>Tamanho</span><select value={form.imageSizePreset} onChange={e => setForm({ ...form, imageSizePreset: e.target.value })}><option>1:1</option><option>4:5</option><option>16:9</option><option>9:16</option></select></label>
          <label className="admin-field"><span>Posição</span><select value={form.placement} onChange={e => setForm({ ...form, placement: e.target.value })}><option>BONUSES_MAIN</option><option>BONUSES_TOP</option><option>HOME_PROMO</option></select></label>
        </div>
        <label className="admin-field"><span>Texto do botão</span><input value={form.buttonText || ""} onChange={e => setForm({ ...form, buttonText: e.target.value })} /></label>
        {form.image && <div className="bonus-admin-preview" style={{ aspectRatio: ratio }}><img src={form.image} /></div>}
        <button className="admin-primary full" onClick={create}>Criar bônus</button>
        {msg && <div className="admin-message">{msg}</div>}
      </div>
      <div className="admin-card admin-table-wrap">
        <table>
          <thead><tr><th>Bônus</th><th>Banner</th><th>Tipo</th><th>%</th><th>Mínimo</th><th>Máximo</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {items.map(x => <tr key={x.id}>
              <td><b>{x.title}</b><small>{x.imageSizePreset || "4:5"} · {x.placement || "BONUSES_MAIN"}</small></td>
              <td>{x.image ? <img className="bonus-admin-thumb" src={x.image} /> : "—"}</td>
              <td>{x.type}</td>
              <td>{x.percent}%</td>
              <td>{money(x.minDeposit)}</td>
              <td>{money(x.maxBonus)}</td>
              <td><Status value={x.active === false ? "INACTIVE" : "ACTIVE"} /></td>
              <td><div className="admin-actions"><button onClick={() => toggle(x)}>{x.active === false ? "Ativar" : "Pausar"}</button><button onClick={() => remove(x.id)}>Excluir</button></div></td>
            </tr>)}
          </tbody>
        </table>
      </div>
    </div>
  </>;
}
