import { useState, useEffect } from "react";
import {
  Paintbrush, Palette, Shapes, Type, GripVertical, Smartphone, Monitor, Upload
} from "lucide-react";
import { adminApi } from "../../lib/adminApi";
import { uploadAdminAsset } from "../../lib/adminAssets";
import { patchRuntimeValue } from "../../lib/runtimeDb";
import { PageTitle } from "./AdminComponents";

export default function VisualBuilderPage() {
  const defaultSections = [
    "BANNER", "CATEGORIES", "FEATURED", "WINNERS", "PRAGMATIC_LIVE", "MOST_PLAYED",
    "FAST_GAMES", "NEW_RELEASES", "PROMO_BANNER", "SLOTS", "LIVE_CASINO", "PROVIDERS",
    "PLAYZADA_CLUB", "AFFILIATE", "RESPONSIBLE", "POPULAR"
  ];
  const sectionLabels: Record<string, string> = {
    BANNER: "Banner principal", CATEGORIES: "Atalhos e providers", FEATURED: "Em destaque", WINNERS: "Central de Vencedores",
    PRAGMATIC_LIVE: "Pragmatic Live", MOST_PLAYED: "Mais jogados", FAST_GAMES: "Jogos rápidos", NEW_RELEASES: "Lançamentos",
    PROMO_BANNER: "Banner promocional", SLOTS: "Slots", LIVE_CASINO: "Cassino ao vivo", PROVIDERS: "Providers",
    PLAYZADA_CLUB: "Zero Club", AMORA_CLUB: "Zero Club", AFFILIATE: "Afiliados", RESPONSIBLE: "Jogo responsável", POPULAR: "Populares"
  };
  const defaultTheme: any = {
    brandName: "Trevo da Sorte", logoUrl: "/brand/trevo-da-sorte-logo.svg", primaryColor: "#00b85c",
    backgroundColor: "#000000", surfaceColor: "#111111", surfaceAltColor: "#1b1b1b",
    textColor: "#f7f5f8", mutedColor: "#8f8993", borderColor: "rgba(255,255,255,.07)",
    buttonTextColor: "#ffffff", borderRadius: 14, cardRadius: 12, compactMode: false,
    navStyle: "FLOATING", gameCardRatio: "1:1", showProviderNames: true, showBalanceLabel: true,
    labels: { home: "Início", casino: "Casino", deposit: "Depositar", profile: "Perfil", menu: "Menu" },
    icons: { menu: "", casino: "/icons/slot-machine.svg", home: "", deposit: "", profile: "" }
  };
  const [theme, setTheme] = useState<any>(defaultTheme);
  const [sections, setSections] = useState<string[]>(defaultSections);
  const [preview, setPreview] = useState<"mobile" | "desktop">("mobile");
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState("");
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  useEffect(() => {
    Promise.all([
      adminApi<any>("/api/admin/configuration"),
      adminApi<any>("/api/admin/home-layout")
    ]).then(([cfg, layout]) => {
      const v = cfg.settings?.visualTheme || {};
      const primary = v.primaryColor || "#00b85c";
      const btnText = (primary === "#00b85c" && (!v.buttonTextColor || v.buttonTextColor === "#000000")) ? "#ffffff" : (v.buttonTextColor || "#ffffff");
      const logoUrl = (!v.logoUrl || v.logoUrl.includes("logoresenha") || v.logoUrl.includes("logoplayzada") || v.logoUrl.includes("canario") || v.logoUrl.includes("borah")) ? "/brand/trevo-da-sorte-logo.svg" : v.logoUrl;
      const brandName = (!v.brandName || v.brandName === "Resenha Bet" || v.brandName === "Playzada Bet" || v.brandName === "Trevo da Sorte" || v.brandName === "Canário Bet" || /borah/i.test(v.brandName)) ? "Trevo da Sorte" : v.brandName;
      setTheme({
        ...defaultTheme, ...v,
        brandName,
        logoUrl,
        primaryColor: primary,
        buttonTextColor: btnText,
        labels: { ...defaultTheme.labels, ...(v.labels || {}) },
        icons: { ...defaultTheme.icons, ...(v.icons || {}) }
      });
      if (layout.layout?.length) setSections(layout.layout);
    }).catch((e: any) => setMsg(e.message));
  }, []);

  const set = (key: string, value: any) => setTheme((x: any) => ({ ...x, [key]: value }));
  const setLabel = (key: string, value: string) => setTheme((x: any) => ({ ...x, labels: { ...x.labels, [key]: value } }));
  const setIcon = (key: string, value: string) => setTheme((x: any) => ({ ...x, icons: { ...x.icons, [key]: value } }));

  async function uploadAsset(file: File, kind: "logo" | "icon", slot = "") {
    setUploading(slot || kind);
    try {
      const url = await uploadAdminAsset(file);
      if (kind === "logo") set("logoUrl", url); else setIcon(slot, url);
      setMsg("Imagem enviada. Clique em Publicar design para aplicar.");
    } catch (e: any) { setMsg(e.message); } finally { setUploading(""); }
  }

  function dropSection(target: number) {
    if (dragIndex === null || dragIndex === target) { setDragIndex(null); return; }
    const next = [...sections];
    const [item] = next.splice(dragIndex, 1);
    next.splice(target, 0, item);
    setSections(next);
    setDragIndex(null);
  }

  function reset() {
    setTheme(defaultTheme);
    setSections(defaultSections);
    setMsg("Preview restaurado. Clique em Publicar design para salvar.");
  }

  async function save() {
    setSaving(true); setMsg("Publicando identidade visual...");
    try {
      const [cfg]: any = await Promise.all([
        adminApi("/api/admin/configuration", { method: "PATCH", body: JSON.stringify({ visualTheme: theme, siteName: theme.brandName }) }),
        adminApi("/api/admin/home-layout", { method: "PATCH", body: JSON.stringify({ sections }) }),
      ]);
      void patchRuntimeValue("runtime/publicSettings", { visualTheme: theme, siteName: theme.brandName });
      setMsg(`Design publicado com sucesso (${cfg?.storage || "banco"}).`);
    } catch (e: any) { setMsg(`Falha ao publicar: ${e.message || "erro desconhecido"}`); }
    finally { setSaving(false); }
  }

  const previewStyle: any = {
    "--pv-primary": theme.primaryColor, "--pv-bg": theme.backgroundColor, "--pv-surface": theme.surfaceColor,
    "--pv-surface2": theme.surfaceAltColor, "--pv-text": theme.textColor, "--pv-muted": theme.mutedColor,
    "--pv-radius": `${theme.borderRadius}px`, "--pv-card-radius": `${theme.cardRadius}px`
  };

  const iconSlots: [string, string][] = [["menu", "Menu"], ["casino", "Cassino"], ["home", "Início"], ["deposit", "Depósito"], ["profile", "Perfil"]];

  return <>
    <PageTitle eyebrow="DESIGN SYSTEM" title="Aparência da plataforma" text="Personalize marca, cores, ícones e organização visual com preview em tempo real." action={<div className="admin-actions"><button className="admin-secondary" onClick={reset}>Restaurar</button><button className="admin-primary" disabled={saving} onClick={save}>{saving ? "PUBLICANDO..." : "Publicar design"}</button></div>} />
    <div className="visual-builder-shell">
      <div className="visual-builder-controls">
        <section className="admin-card visual-editor-card">
          <div className="visual-editor-title"><Paintbrush size={18} /><div><span>IDENTIDADE</span><h3>Marca</h3></div></div>
          <label className="admin-field"><span>Nome da plataforma</span><input value={theme.brandName || ""} onChange={e => set("brandName", e.target.value)} maxLength={40} /></label>
          <div className="visual-logo-control">
            <div className="visual-logo-preview">{theme.logoUrl ? <img src={theme.logoUrl} alt="Logo" /> : <span>SEM LOGO</span>}</div>
            <label className="admin-upload-button"><Upload size={14} />{uploading === "logo" ? "Enviando..." : "Trocar logo"}<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e => { const f = e.target.files?.[0]; if (f) void uploadAsset(f, "logo"); }} /></label>
          </div>
          <label className="admin-field"><span>URL da logo</span><input value={theme.logoUrl || ""} onChange={e => set("logoUrl", e.target.value)} /></label>
        </section>

        <section className="admin-card visual-editor-card">
          <div className="visual-editor-title"><Palette size={18} /><div><span>PALETA</span><h3>Cores</h3></div></div>
          <div className="theme-presets">{[["Rosa Zero","#00b85c"],["Violeta","#7c3aed"],["Azul","#2563eb"],["Verde","#059669"],["Laranja","#ea580c"]].map(([label,color]) => <button key={color} title={label} aria-label={label} aria-pressed={theme.primaryColor===color} onClick={() => set("primaryColor",color)} style={{borderColor:color}}><i style={{background:color}} />{label}</button>)}</div><div className="visual-color-grid">
            {[
              ["primaryColor", "Principal"], ["backgroundColor", "Fundo"], ["surfaceColor", "Cards"],
              ["surfaceAltColor", "Cards 2"], ["textColor", "Texto"], ["mutedColor", "Texto secundário"], ["buttonTextColor", "Texto do botão"], ["borderColor", "Bordas"]
            ].map(([key, label]) => <label className="visual-color-field" key={key}><span>{label}</span><div><input type="color" value={/^#[0-9a-f]{6}$/i.test(theme[key] || "") ? theme[key] : "#101010"} onChange={e => set(key, e.target.value)} /><input value={theme[key] || ""} onChange={e => set(key, e.target.value)} /></div></label>)}
          </div>
        </section>

        <section className="admin-card visual-editor-card">
          <div className="visual-editor-title"><Shapes size={18} /><div><span>FORMA</span><h3>Componentes</h3></div></div>
          <div className="admin-form-grid">
            <label className="admin-field"><span>Arredondamento geral</span><input type="range" min="0" max="32" value={theme.borderRadius ?? 14} onChange={e => set("borderRadius", Number(e.target.value))} /><small>{theme.borderRadius}px</small></label>
            <label className="admin-field"><span>Arredondamento cards</span><input type="range" min="0" max="32" value={theme.cardRadius ?? 12} onChange={e => set("cardRadius", Number(e.target.value))} /><small>{theme.cardRadius}px</small></label>
            <label className="admin-field"><span>Barra mobile</span><select value={theme.navStyle || "FLOATING"} onChange={e => set("navStyle", e.target.value)}><option value="FLOATING">Flutuante</option><option value="FLAT">Reta</option><option value="PILL">Pílula</option></select></label>
            <label className="admin-field"><span>Proporção dos jogos</span><select value={theme.gameCardRatio || "1:1"} onChange={e => set("gameCardRatio", e.target.value)}><option value="1:1">Quadrado 1:1</option><option value="3:4">Vertical 3:4</option><option value="4:5">Vertical 4:5</option><option value="16:9">Horizontal 16:9</option></select></label>
          </div>
          <div className="config-switches">
            <label><input type="checkbox" checked={!!theme.compactMode} onChange={e => set("compactMode", e.target.checked)} /><span>Modo compacto</span></label>
            <label><input type="checkbox" checked={theme.showProviderNames !== false} onChange={e => set("showProviderNames", e.target.checked)} /><span>Mostrar providers</span></label>
            <label><input type="checkbox" checked={theme.showBalanceLabel !== false} onChange={e => set("showBalanceLabel", e.target.checked)} /><span>Mostrar texto “Saldo”</span></label>
          </div>
        </section>

        <section className="admin-card visual-editor-card">
          <div className="visual-editor-title"><Type size={18} /><div><span>NAVEGAÇÃO</span><h3>Nomes e ícones</h3></div></div>
          <div className="visual-icon-list">
            {iconSlots.map(([key, label]) => <div className="visual-icon-row" key={key}>
              <div className="visual-icon-thumb">{theme.icons?.[key] ? <img src={theme.icons[key]} alt="" /> : <span>{label.slice(0, 1)}</span>}</div>
              <label className="admin-field"><span>{label}</span><input value={theme.labels?.[key] || label} onChange={e => setLabel(key, e.target.value)} /></label>
              <label className="admin-upload-button compact"><Upload size={13} />{uploading === key ? "..." : "Ícone"}<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e => { const f = e.target.files?.[0]; if (f) void uploadAsset(f, "icon", key); }} /></label>
            </div>)}
          </div>
        </section>

        <section className="admin-card visual-editor-card layout-drag-card">
          <div className="visual-editor-title"><GripVertical size={18} /><div><span>HOME</span><h3>Arraste as seções</h3></div></div>
          <p className="config-help">Arraste para reorganizar. A ordem é salva na Home real.</p>
          <div className="visual-section-list">
            {sections.map((sec, index) => <div draggable key={sec} onDragStart={() => setDragIndex(index)} onDragOver={e => e.preventDefault()} onDrop={() => dropSection(index)} className={`visual-section-item ${dragIndex === index ? "dragging" : ""}`}>
              <GripVertical size={16} /><b>{index + 1}</b><span>{sectionLabels[sec] || sec}</span>
            </div>)}
          </div>
        </section>
      </div>

      <div className="visual-preview-column">
        <div className="visual-preview-toolbar">
          <div><span>PREVIEW AO VIVO</span><b>Alterações ainda não publicadas</b></div>
          <div><button className={preview === "mobile" ? "active" : ""} onClick={() => setPreview("mobile")}><Smartphone size={15} /> Mobile</button><button className={preview === "desktop" ? "active" : ""} onClick={() => setPreview("desktop")}><Monitor size={15} /> Desktop</button></div>
        </div>
        <div className={`visual-device-stage ${preview}`} style={previewStyle}>
          <div className="visual-device">
            <header><img src={theme.logoUrl || "/brand/trevo-da-sorte-logo.svg"} /><div><span>{theme.showBalanceLabel !== false ? "Saldo" : ""}</span><b>R$ 1.290,00</b></div></header>
            <main>
              <div className="visual-fake-banner"><span>{theme.brandName || "Trevo da Sorte"}</span><strong>SEU BANNER PRINCIPAL</strong><button>JOGAR AGORA</button></div>
              <div className="visual-fake-title"><b>Em destaque</b><span>Ver todos</span></div>
              <div className={`visual-fake-games ratio-${String(theme.gameCardRatio || "1:1").replace(":", "-")}`}>
                {[1, 2, 3, 4].map(n => <div key={n}><i /><b>Jogo {n}</b>{theme.showProviderNames !== false && <small>Provider</small>}</div>)}
              </div>
              <div className="visual-fake-title"><b>Mais jogados</b><span>Ver todos</span></div>
            </main>
            <nav className={`preview-nav ${String(theme.navStyle || "FLOATING").toLowerCase()}`}>
              {["menu", "casino", "home", "deposit", "profile"].map(key => <div key={key} className={key === "home" ? "active" : ""}>{theme.icons?.[key] ? <img src={theme.icons[key]} /> : <i />}<span>{theme.labels?.[key] || key}</span></div>)}
            </nav>
          </div>
        </div>
        {msg && <div className="admin-message visual-builder-message">{msg}</div>}
      </div>
    </div>
  </>;
}
