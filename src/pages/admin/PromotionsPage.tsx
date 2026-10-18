import { useState, useEffect } from "react";
import { Image, Eye, Activity, Sparkles } from "lucide-react";
import { adminApi } from "../../lib/adminApi";
import { uploadAdminAsset } from "../../lib/adminAssets";
import { PageTitle, Metric, Status } from "./AdminComponents";

export default function PromotionsPage() {
  const blank: any = {
    name: "", title: "", subtitle: "", status: "DRAFT", active: false, placement: "HOME_TOP", template: "FULL_IMAGE",
    desktopImage: "", mobileImage: "", desktopWidth: 1898, desktopHeight: 800, mobileWidth: 1080, mobileHeight: 1350,
    sizePreset: "1898x800", objectFit: "cover", objectPosition: "center", borderRadius: 16, overlayOpacity: .25,
    textColor: "#ffffff", buttonColor: "#00b85c", buttonText: "", badge: "", alignment: "left",
    action: { type: "NONE", url: "", providerCode: "", gameCode: "", newTab: true },
    targeting: { loggedIn: null, devices: ["MOBILE", "DESKTOP"], newUsersOnly: false, neverDeposited: false, depositedOnly: false, kycApproved: false, vipOnly: false, minBalance: "", maxBalance: "" },
    schedule: { startsAt: "", endsAt: "", weekdays: [], startTime: "", endTime: "" },
    frequency: "ALWAYS", priority: 100, sortOrder: 0, autoplayMs: 5500, loop: true, showDots: true, showArrows: true, swipe: true
  };
  const [items, setItems] = useState<any[]>([]);
  const [form, setForm] = useState<any>(blank);
  const [editing, setEditing] = useState<string | null>(null);
  const [tab, setTab] = useState<"CONTENT" | "DESIGN" | "RULES" | "ACTION" | "PREVIEW">("CONTENT");
  const [preview, setPreview] = useState<"DESKTOP" | "TABLET" | "MOBILE" | "POPUP">("DESKTOP");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("ALL");

  const load = () => adminApi<any>("/api/admin/banner-campaigns").then(d => setItems(d.banners || [])).catch(e => setMessage(e?.message || ""));
  useEffect(() => { void load(); }, []);
  const set = (k: string, v: any) => setForm((x: any) => ({ ...x, [k]: v }));
  const nested = (group: string, key: string, v: any) => setForm((x: any) => ({ ...x, [group]: { ...(x[group] || {}), [key]: v } }));

  function preset(value: string) {
    const map: any = {
      "1898x800": [1898, 800], "1413x595": [1413, 595], "16:9": [1600, 900], "2.37:1": [1413, 595],
      "1:1": [1080, 1080], "4:5": [1080, 1350], "9:16": [1080, 1920], "POPUP": [918, 1560], "MINI": [1200, 300]
    };
    const [w, h] = map[value] || [1898, 800];
    setForm((x: any) => ({ ...x, sizePreset: value, desktopWidth: w, desktopHeight: h }));
  }

  async function upload(kind: "desktopImage" | "mobileImage", file?: File) {
    if (!file) return;
    if (!file.type.startsWith("image/")) { setMessage("Selecione uma imagem válida."); return; }
    if (file.size > 10 * 1024 * 1024) { setMessage("A imagem deve ter no máximo 10 MB."); return; }
    setBusy(true);
    try {
      let dimensions = { width: 0, height: 0 };
      try {
        const bitmap = await createImageBitmap(file);
        dimensions = { width: bitmap.width, height: bitmap.height };
        bitmap.close();
      } catch { }
      const url = await uploadAdminAsset(file);
      setForm((x: any) => ({
        ...x,
        [kind]: url,
        ...(kind === "desktopImage" && dimensions.width ? { desktopWidth: dimensions.width, desktopHeight: dimensions.height } : {}),
        ...(kind === "mobileImage" && dimensions.width ? { mobileWidth: dimensions.width, mobileHeight: dimensions.height } : {})
      }));
      const ratio = dimensions.width && dimensions.height ? (dimensions.width / dimensions.height).toFixed(2) : "—";
      setMessage(`Imagem enviada: ${dimensions.width || "?"}×${dimensions.height || "?"} · proporção ${ratio}:1. Preview atualizado.`);
    } catch (e: any) { setMessage(e.message); } finally { setBusy(false); }
  }

  async function save() {
    setBusy(true); setMessage("");
    try {
      const method = editing ? "PATCH" : "POST";
      const path = editing ? `/api/admin/banner-campaigns/${editing}` : "/api/admin/banner-campaigns";
      await adminApi(path, { method, body: JSON.stringify(form) });
      setMessage(editing ? "Banner atualizado." : "Banner criado.");
      setEditing(null); setForm(blank); await load();
    } catch (e: any) { setMessage(e.message); } finally { setBusy(false); }
  }

  function edit(x: any) { setEditing(x.id); setForm({ ...blank, ...x, action: { ...blank.action, ...x.action }, targeting: { ...blank.targeting, ...x.targeting }, schedule: { ...blank.schedule, ...x.schedule } }); setTab("CONTENT"); window.scrollTo({ top: 0, behavior: "smooth" }); }
  async function toggle(x: any) { try { await adminApi(`/api/admin/banner-campaigns/${x.id}`, { method: "PATCH", body: JSON.stringify({ active: x.active === false, status: x.active === false ? "ACTIVE" : "PAUSED" }) }); await load(); } catch (e: any) { setMessage(e?.message || ""); } }
  async function duplicate(id: string) { try { await adminApi(`/api/admin/banner-campaigns/${id}/duplicate`, { method: "POST" }); await load(); } catch (e: any) { setMessage(e?.message || ""); } }
  async function remove(id: string) { if (!confirm("Excluir este banner?")) return; try { await adminApi(`/api/admin/banner-campaigns/${id}`, { method: "DELETE" }); await load(); } catch (e: any) { setMessage(e?.message || ""); } }

  const visible = items.filter(x => filter === "ALL" || x.status === filter || x.placement === filter);
  const ratio = preview === "DESKTOP" ? `${form.desktopWidth || 1898}/${form.desktopHeight || 800}` : preview === "TABLET" ? "4/3" : preview === "POPUP" ? "9/16" : `${form.mobileWidth || 1080}/${form.mobileHeight || 1350}`;
  const image = preview === "DESKTOP" || preview === "TABLET" ? (form.desktopImage || form.mobileImage) : (form.mobileImage || form.desktopImage);
  const impressions = visible.reduce((a, x) => a + Number(x.metrics?.impressions || 0), 0);
  const clicks = visible.reduce((a, x) => a + Number(x.metrics?.clicks || 0), 0);
  const ctr = impressions ? clicks / impressions * 100 : 0;

  return <>
    <PageTitle eyebrow="CAMPAIGN BUILDER" title="Banners & Campanhas" text="Controle completo de imagens, tamanhos, posições, segmentação, agendamento, ações, frequência e métricas." action={<button className="admin-primary" onClick={() => { setEditing(null); setForm(blank); setTab("CONTENT"); }}>+ Novo banner</button>} />
    <div className="banner-kpis"><Metric icon={Image} label="Campanhas" value={items.length} hint={`${items.filter(x => x.active).length} ativas`} /><Metric icon={Eye} label="Visualizações" value={impressions.toLocaleString("pt-BR")} hint="Impressões registradas" /><Metric icon={Activity} label="Cliques" value={clicks.toLocaleString("pt-BR")} hint={`CTR ${ctr.toFixed(2)}%`} /><Metric icon={Sparkles} label="Agendadas" value={items.filter(x => x.status === "SCHEDULED").length} hint="Campanhas futuras" /></div>

    <div className="banner-manager-layout">
      <section className="admin-card banner-editor">
        <div className="banner-editor-top"><div><span>{editing ? "EDITANDO" : "NOVA CAMPANHA"}</span><h3>{form.name || "Banner sem nome"}</h3></div><div className="banner-editor-tabs">{(["CONTENT", "DESIGN", "RULES", "ACTION", "PREVIEW"] as const).map(x => <button key={x} className={tab === x ? "active" : ""} onClick={() => setTab(x)}>{({CONTENT:"Imagens e conteúdo",DESIGN:"Aparência",RULES:"Público e horário",ACTION:"Ao clicar",PREVIEW:"Prévia"})[x]}</button>)}</div></div>

        {tab === "CONTENT" && <div className="banner-form-grid">
          <label className="admin-field"><span>Nome interno</span><input value={form.name} onChange={e => set("name", e.target.value)} placeholder="Ex.: Desafio Tiger Home" /></label>
          <label className="admin-field"><span>Título visível</span><input value={form.title} onChange={e => set("title", e.target.value)} /></label>
          <label className="admin-field wide"><span>Subtítulo</span><input value={form.subtitle} onChange={e => set("subtitle", e.target.value)} /></label>
          <label className="admin-field"><span>Posição</span><select value={form.placement} onChange={e => set("placement", e.target.value)}><option>HOME_TOP</option><option>HOME_AFTER_FEATURED</option><option>HOME_MIDDLE</option><option>DEPOSIT_TOP</option><option>PROMOTIONS_TOP</option><option>GAMES_TOP</option><option>PROFILE_TOP</option><option>POPUP_HOME</option><option>POPUP_DEPOSIT</option><option>SIDEBAR</option></select></label>
          <label className="admin-field"><span>Status</span><select value={form.status} onChange={e => { set("status", e.target.value); set("active", e.target.value === "ACTIVE"); }}><option>DRAFT</option><option>ACTIVE</option><option>PAUSED</option><option>SCHEDULED</option><option>FINISHED</option></select></label>
          <label className="admin-field wide"><span>Imagem desktop</span><div className="banner-upload-row"><input value={form.desktopImage} onChange={e => set("desktopImage", e.target.value)} placeholder="URL ou /banners/arquivo.png?v=trevo-identidade-v1" /><label className="banner-upload-btn">Trocar imagem<input type="file" accept="image/*" onChange={e => upload("desktopImage", e.target.files?.[0])} /></label></div></label>
          <label className="admin-field wide"><span>Imagem mobile</span><div className="banner-upload-row"><input value={form.mobileImage} onChange={e => set("mobileImage", e.target.value)} placeholder="Opcional — usa desktop como fallback" /><label className="banner-upload-btn">Trocar imagem<input type="file" accept="image/*" onChange={e => upload("mobileImage", e.target.files?.[0])} /></label></div></label>
          <div className="banner-form-grid wide"><label className="admin-field"><span>Prioridade</span><input type="number" value={form.priority} onChange={e => set("priority", Number(e.target.value))} /></label><label className="admin-field"><span>Ordem</span><input type="number" value={form.sortOrder} onChange={e => set("sortOrder", Number(e.target.value))} /></label></div>
        </div>}

        {tab === "DESIGN" && <div className="banner-form-grid">
          <label className="admin-field"><span>Template</span><select value={form.template} onChange={e => set("template", e.target.value)}><option>FULL_IMAGE</option><option>CLEAN</option><option>HERO</option><option>PROMO</option><option>GRADIENT</option><option>PREMIUM</option><option>POPUP</option><option>SPLIT</option><option>MINIMAL</option></select></label>
          <label className="admin-field"><span>Tamanho preset</span><select value={form.sizePreset} onChange={e => preset(e.target.value)}><option>1898x800</option><option>1413x595</option><option>16:9</option><option>2.37:1</option><option>1:1</option><option>4:5</option><option>9:16</option><option>POPUP</option><option>MINI</option><option>CUSTOM</option></select></label>
          <div className="banner-form-grid wide"><label className="admin-field"><span>Desktop largura</span><input type="number" value={form.desktopWidth} onChange={e => set("desktopWidth", Number(e.target.value))} /></label><label className="admin-field"><span>Desktop altura</span><input type="number" value={form.desktopHeight} onChange={e => set("desktopHeight", Number(e.target.value))} /></label><label className="admin-field"><span>Mobile largura</span><input type="number" value={form.mobileWidth} onChange={e => set("mobileWidth", Number(e.target.value))} /></label><label className="admin-field"><span>Mobile altura</span><input type="number" value={form.mobileHeight} onChange={e => set("mobileHeight", Number(e.target.value))} /></label></div>
          <label className="admin-field"><span>Ajuste da imagem</span><select value={form.objectFit} onChange={e => set("objectFit", e.target.value)}><option>cover</option><option>contain</option><option>fill</option></select></label>
          <label className="admin-field"><span>Posição da imagem</span><select value={form.objectPosition} onChange={e => set("objectPosition", e.target.value)}><option>center</option><option>top</option><option>bottom</option><option>left</option><option>right</option></select></label>
          <label className="admin-field"><span>Borda arredondada</span><input type="number" value={form.borderRadius} onChange={e => set("borderRadius", Number(e.target.value))} /></label>
          <label className="admin-field"><span>Overlay 0–1</span><input type="number" min="0" max="1" step=".05" value={form.overlayOpacity} onChange={e => set("overlayOpacity", Number(e.target.value))} /></label>
          <label className="admin-field"><span>Cor do texto</span><input type="color" value={form.textColor} onChange={e => set("textColor", e.target.value)} /></label>
          <label className="admin-field"><span>Cor do botão</span><input type="color" value={form.buttonColor} onChange={e => set("buttonColor", e.target.value)} /></label>
          <label className="admin-field"><span>Texto do botão</span><input value={form.buttonText} onChange={e => set("buttonText", e.target.value)} placeholder="JOGAR AGORA" /></label>
          <label className="admin-field"><span>Badge</span><input value={form.badge} onChange={e => set("badge", e.target.value)} placeholder="NOVO" /></label>
          <label className="admin-field"><span>Alinhamento</span><select value={form.alignment} onChange={e => set("alignment", e.target.value)}><option>left</option><option>center</option><option>right</option></select></label>
        </div>}

        {tab === "RULES" && <div className="banner-rules">
          <div className="banner-rule-card"><h4>Dispositivo & login</h4><div className="config-switches"><label><input type="checkbox" checked={form.targeting.devices.includes("MOBILE")} onChange={e => nested("targeting", "devices", e.target.checked ? [...new Set([...form.targeting.devices, "MOBILE"])] : form.targeting.devices.filter((x: string) => x !== "MOBILE"))} /><span>Mobile</span></label><label><input type="checkbox" checked={form.targeting.devices.includes("DESKTOP")} onChange={e => nested("targeting", "devices", e.target.checked ? [...new Set([...form.targeting.devices, "DESKTOP"])] : form.targeting.devices.filter((x: string) => x !== "DESKTOP"))} /><span>Desktop</span></label></div><label className="admin-field"><span>Login</span><select value={form.targeting.loggedIn === null ? "ANY" : String(form.targeting.loggedIn)} onChange={e => nested("targeting", "loggedIn", e.target.value === "ANY" ? null : e.target.value === "true")}><option value="ANY">Qualquer usuário</option><option value="true">Somente logado</option><option value="false">Somente visitante</option></select></label></div>
          <div className="banner-rule-card"><h4>Segmentação</h4><div className="config-switches"><label><input type="checkbox" checked={!!form.targeting.newUsersOnly} onChange={e => nested("targeting", "newUsersOnly", e.target.checked)} /><span>Usuários novos</span></label><label><input type="checkbox" checked={!!form.targeting.neverDeposited} onChange={e => nested("targeting", "neverDeposited", e.target.checked)} /><span>Nunca depositou</span></label><label><input type="checkbox" checked={!!form.targeting.depositedOnly} onChange={e => nested("targeting", "depositedOnly", e.target.checked)} /><span>Já depositou</span></label><label><input type="checkbox" checked={!!form.targeting.kycApproved} onChange={e => nested("targeting", "kycApproved", e.target.checked)} /><span>KYC aprovado</span></label><label><input type="checkbox" checked={!!form.targeting.vipOnly} onChange={e => nested("targeting", "vipOnly", e.target.checked)} /><span>VIP</span></label></div><div className="admin-form-grid"><label className="admin-field"><span>Saldo mínimo</span><input type="number" value={form.targeting.minBalance} onChange={e => nested("targeting", "minBalance", e.target.value)} /></label><label className="admin-field"><span>Saldo máximo</span><input type="number" value={form.targeting.maxBalance} onChange={e => nested("targeting", "maxBalance", e.target.value)} /></label></div></div>
          <div className="banner-rule-card"><h4>Agendamento</h4><div className="admin-form-grid"><label className="admin-field"><span>Início</span><input type="datetime-local" value={form.schedule.startsAt} onChange={e => nested("schedule", "startsAt", e.target.value)} /></label><label className="admin-field"><span>Fim</span><input type="datetime-local" value={form.schedule.endsAt} onChange={e => nested("schedule", "endsAt", e.target.value)} /></label><label className="admin-field"><span>Hora início</span><input type="time" value={form.schedule.startTime} onChange={e => nested("schedule", "startTime", e.target.value)} /></label><label className="admin-field"><span>Hora fim</span><input type="time" value={form.schedule.endTime} onChange={e => nested("schedule", "endTime", e.target.value)} /></label></div></div>
          <div className="banner-rule-card"><h4>Frequência</h4><label className="admin-field"><select value={form.frequency} onChange={e => set("frequency", e.target.value)}><option>ALWAYS</option><option>ONCE_PER_SESSION</option><option>ONCE_PER_DAY</option><option>ONCE_PER_USER</option></select></label><div className="admin-form-grid"><label className="admin-field"><span>Autoplay ms</span><input type="number" value={form.autoplayMs} onChange={e => set("autoplayMs", Number(e.target.value))} /></label><label className="admin-field checkbox"><input type="checkbox" checked={!!form.swipe} onChange={e => set("swipe", e.target.checked)} /><span>Swipe mobile</span></label></div></div>
        </div>}

        {tab === "ACTION" && <div className="banner-form-grid">
          <label className="admin-field"><span>Ação ao clicar</span><select value={form.action.type} onChange={e => nested("action", "type", e.target.value)}><option>NONE</option><option>GAMES</option><option>GAME</option><option>PROVIDER</option><option>DEPOSIT</option><option>WITHDRAW</option><option>WALLET</option><option>HOME</option><option>HISTORY</option><option>NOTIFICATIONS</option><option>RESPONSIBLE</option><option>PROMOS</option><option>BONUSES</option><option>AFFILIATE</option><option>PROFILE</option><option>URL</option></select></label>
          {form.action.type === "URL" && <label className="admin-field wide"><span>URL</span><input value={form.action.url} onChange={e => nested("action", "url", e.target.value)} /></label>}
          {["GAME", "PROVIDER"].includes(form.action.type) && <><label className="admin-field"><span>Provider Code</span><input value={form.action.providerCode} onChange={e => nested("action", "providerCode", e.target.value)} /></label>{form.action.type === "GAME" && <label className="admin-field"><span>Game Code</span><input value={form.action.gameCode} onChange={e => nested("action", "gameCode", e.target.value)} /></label>}</>}
          <label className="admin-field checkbox"><input type="checkbox" checked={!!form.action.newTab} onChange={e => nested("action", "newTab", e.target.checked)} /><span>Abrir URL externa em nova aba</span></label>
        </div>}

        {tab === "PREVIEW" && <div className="banner-preview-area"><div className="banner-preview-switch"><button className={preview === "DESKTOP" ? "active" : ""} onClick={() => setPreview("DESKTOP")}>Desktop</button><button className={preview === "TABLET" ? "active" : ""} onClick={() => setPreview("TABLET")}>Tablet</button><button className={preview === "MOBILE" ? "active" : ""} onClick={() => setPreview("MOBILE")}>Mobile</button><button className={preview === "POPUP" ? "active" : ""} onClick={() => setPreview("POPUP")}>Popup</button></div><div className={`banner-preview-frame ${preview.toLowerCase()}`}><div className="banner-preview-canvas" style={{ aspectRatio: ratio, borderRadius: `${form.borderRadius}px` }}>{image ? <><img src={image} style={{ objectFit: form.objectFit, objectPosition: form.objectPosition }} /><div className={`banner-preview-copy ${form.alignment}`} style={{ color: form.textColor, background: `rgba(0,0,0,${form.overlayOpacity})` }}>{form.badge && <span>{form.badge}</span>}<strong>{form.title}</strong><p>{form.subtitle}</p>{form.buttonText && <b style={{ background: form.buttonColor }}>{form.buttonText}</b>}</div></> : <div className="banner-preview-empty"><Image size={34} /><span>Adicione uma imagem para visualizar</span></div>}</div></div></div>}

        <div className="banner-editor-actions"><button className="admin-secondary" onClick={() => { setEditing(null); setForm(blank); }}>Limpar</button><button className="admin-primary" disabled={busy} onClick={save}>{busy ? "SALVANDO..." : editing ? "SALVAR ALTERAÇÕES" : "CRIAR CAMPANHA"}</button></div>
        {message && <div className="admin-message">{message}</div>}
      </section>

      <aside className="admin-card banner-live-preview"><div className="banner-preview-switch"><button className={preview === "DESKTOP" ? "active" : ""} onClick={() => setPreview("DESKTOP")}>Desktop</button><button className={preview === "TABLET" ? "active" : ""} onClick={() => setPreview("TABLET")}>Tablet</button><button className={preview === "MOBILE" ? "active" : ""} onClick={() => setPreview("MOBILE")}>Mobile</button><button className={preview === "POPUP" ? "active" : ""} onClick={() => setPreview("POPUP")}>Popup</button></div><div className={`banner-preview-frame side ${preview.toLowerCase()}`}><div className="banner-preview-canvas" style={{ aspectRatio: ratio, borderRadius: `${form.borderRadius}px` }}>{image ? <img src={image} style={{ objectFit: form.objectFit, objectPosition: form.objectPosition }} /> : <div className="banner-preview-empty"><Image size={30} /><span>Preview</span></div>}</div></div><div className="banner-summary"><div><span>Placement</span><b>{form.placement}</b></div><div><span>Template</span><b>{form.template}</b></div><div><span>Frequência</span><b>{form.frequency}</b></div><div><span>Prioridade</span><b>{form.priority}</b></div></div></aside>
    </div>

    <div className="banner-list-head"><div><span>CAMPANHAS</span><h3>Gerenciar banners</h3></div><div className="admin-filter-row">{["ALL", "ACTIVE", "PAUSED", "DRAFT", "SCHEDULED", "HOME_TOP", "POPUP_HOME"].map(x => <button key={x} className={filter === x ? "active" : ""} onClick={() => setFilter(x)}>{({CONTENT:"Imagens e conteúdo",DESIGN:"Aparência",RULES:"Público e horário",ACTION:"Ao clicar",PREVIEW:"Prévia"})[x]}</button>)}</div></div>
    <div className="banner-campaign-grid">{visible.map(x => { const imp = Number(x.metrics?.impressions || 0), clk = Number(x.metrics?.clicks || 0); return <article className="banner-campaign-card" key={x.id}><div className="banner-card-image">{x.desktopImage ? <img src={x.desktopImage} /> : <Image />}<Status value={x.active ? "ACTIVE" : x.status || "PAUSED"} /></div><div className="banner-card-body"><div><span>{x.placement}</span><h4>{x.name || x.title}</h4><p>{x.template} · {x.sizePreset}</p></div><div className="banner-card-stats"><div><span>Views</span><b>{imp}</b></div><div><span>Cliques</span><b>{clk}</b></div><div><span>CTR</span><b>{imp ? (clk / imp * 100).toFixed(1) : "0"}%</b></div></div><div className="banner-card-actions"><button onClick={() => edit(x)}>Editar</button><button onClick={() => duplicate(x.id)}>Duplicar</button><button onClick={() => toggle(x)}>{x.active ? "Pausar" : "Ativar"}</button><button onClick={() => remove(x.id)}>Excluir</button></div></div></article>; })}</div>
  </>;
}
