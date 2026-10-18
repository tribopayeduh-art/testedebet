import { useState, useEffect, useMemo } from "react";
import { Search, RefreshCw, Gamepad2, Star, CheckCircle, Flame } from "lucide-react";
import { adminApi } from "../../lib/adminApi";
import { fetchIgamewinProviders, fetchIgamewinGames, type IGameWinProvider, type IGameWinGame } from "../../lib/igamewin";
import { PageTitle, AdminError } from "./AdminComponents";

const isPgSoftGame = (g: any) => {
  const pCode = String(g?.providerCode || "").toLowerCase();
  const pName = String(g?.providerName || "").toLowerCase();
  const gName = String(g?.name || "").toLowerCase();
  const gCode = String(g?.code || "").toLowerCase();
  return (
    pCode.includes("pg") ||
    pCode.includes("pocket") ||
    pName.includes("pg") ||
    pName.includes("pocket") ||
    /fortune tiger|fortune ox|fortune rabbit|fortune mouse|fortune dragon|fortune gods|dragon hatch|mahjong ways|lucky neko|treasures of aztec|wild bandito|ganesha gold|ways of the qilin|bikini paradise|candy burst|cocktail nights|wild bounty|asgardian rising|supermarket spree|tree of fortune|medusa|caishen wins/i.test(
      `${gName} ${gCode}`
    )
  );
};

export default function GamesAdminPage() {
  const [providers, setProviders] = useState<IGameWinProvider[]>([]);
  const [games, setGames] = useState<IGameWinGame[]>([]);
  const [overrides, setOverrides] = useState<any[]>([]);
  const [provider, setProvider] = useState("");
  const [filterMode, setFilterMode] = useState<"ALL" | "FEATURED" | "ENABLED" | "DISABLED">("ALL");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function load(p = provider) {
    setLoading(true); setError("");
    try {
      const [ps, gs, ov]: any = await Promise.all([
        fetchIgamewinProviders().catch(() => []),
        fetchIgamewinGames(p || undefined).catch(() => []),
        adminApi("/api/admin/game-overrides").catch(() => ({ overrides: [] }))
      ]);
      setProviders(ps || []);
      setGames(gs || []);
      setOverrides(ov?.overrides || []);
    } catch (e: any) {
      setError(e?.message || "");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(""); }, []);

  const map = useMemo(() => new Map(overrides.map(x => [x.id, x])), [overrides]);

  const featuredCount = useMemo(() => {
    return games.filter(g => {
      const o = map.get(`${g.providerCode}__${g.code}`);
      return o?.featured !== undefined ? Boolean(o.featured) : (Boolean(g.featured) || isPgSoftGame(g));
    }).length;
  }, [games, map]);

  const visible = useMemo(() => {
    return games.filter(g => {
      const o = map.get(`${g.providerCode}__${g.code}`) || {};
      const matchesSearch = `${g.name} ${g.providerName} ${g.code}`.toLowerCase().includes(q.toLowerCase());
      if (!matchesSearch) return false;

      const isFeatured = o.featured !== undefined ? Boolean(o.featured) : (Boolean(g.featured) || isPgSoftGame(g));
      if (filterMode === "FEATURED") return isFeatured;
      if (filterMode === "ENABLED") return o.enabled !== false;
      if (filterMode === "DISABLED") return o.enabled === false;
      return true;
    });
  }, [games, q, map, filterMode]);

  async function save(g: IGameWinGame, patch: any) {
    const key = `${g.providerCode}__${g.code}`;
    setSavingKey(key);
    try {
      await adminApi(`/api/admin/game-overrides/${encodeURIComponent(key)}`, {
        method: "PATCH",
        body: JSON.stringify(patch)
      });
      await load(provider);
    } catch (e: any) {
      setError(e?.message || "");
    } finally {
      setSavingKey(null);
    }
  }

  return <>
    <PageTitle
      eyebrow="CATÁLOGO & DESTAQUES"
      title="Jogos e Provedores"
      text="Defina quais jogos aparecem na seção 'Em Destaque', controle a visibilidade e personalize títulos e categorias."
      action={<button className="admin-primary" onClick={() => load()}><RefreshCw size={15} /> Sincronizar</button>}
    />

    <div className="admin-featured-summary" style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '16px', background: '#391926', padding: '12px 18px', borderRadius: '12px', border: '1px solid #4b2435', flexWrap: 'wrap' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#36e68b' }}>
        <Star size={18} fill="#36e68b" />
        <span style={{ fontWeight: 800, fontSize: '13px', color: '#fff' }}>{featuredCount} jogos em destaque</span>
      </div>
      <div style={{ display: 'flex', gap: '6px', marginLeft: 'auto' }}>
        <button
          className={`admin-filter-pill ${filterMode === 'ALL' ? 'active' : ''}`}
          style={{ padding: '6px 12px', fontSize: '12px', borderRadius: '8px', border: 0, cursor: 'pointer', background: filterMode === 'ALL' ? '#00b85c' : '#4b2435', color: '#fff', fontWeight: filterMode === 'ALL' ? 800 : 500 }}
          onClick={() => setFilterMode('ALL')}
        >
          Todos ({games.length})
        </button>
        <button
          className={`admin-filter-pill ${filterMode === 'FEATURED' ? 'active' : ''}`}
          style={{ padding: '6px 12px', fontSize: '12px', borderRadius: '8px', border: 0, cursor: 'pointer', background: filterMode === 'FEATURED' ? '#36e68b' : '#4b2435', color: '#fff', fontWeight: filterMode === 'FEATURED' ? 800 : 500 }}
          onClick={() => setFilterMode('FEATURED')}
        >
          Destaques ({featuredCount})
        </button>
        <button
          className={`admin-filter-pill ${filterMode === 'ENABLED' ? 'active' : ''}`}
          style={{ padding: '6px 12px', fontSize: '12px', borderRadius: '8px', border: 0, cursor: 'pointer', background: filterMode === 'ENABLED' ? '#20b956' : '#4b2435', color: '#fff' }}
          onClick={() => setFilterMode('ENABLED')}
        >
          Ativos
        </button>
      </div>
    </div>

    <div className="admin-toolbar">
      <label><Search size={16} /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar por nome, provider ou código..." /></label>
      <select value={provider} onChange={e => { setProvider(e.target.value); load(e.target.value); }}>
        <option value="">Todos os providers</option>
        {providers.map(p => <option key={p.code} value={p.code}>{p.name}</option>)}
      </select>
    </div>

    {error && <AdminError text={error} />}

    {loading ? <div className="admin-loading-card">Carregando catálogo e destaques...</div> : <div className="admin-games-grid admin-games-grid-v11">{visible.map(g => {
      const key = `${g.providerCode}__${g.code}`;
      const o = map.get(key) || {};
      const isFeatured = o.featured !== undefined ? Boolean(o.featured) : (Boolean(g.featured) || isPgSoftGame(g));
      const isSaving = savingKey === key;

      return <article key={`${g.providerCode}:${g.code}`} style={{ border: isFeatured ? '1.5px solid #00b85c' : undefined, position: 'relative' }}>
        {isFeatured && <div style={{ position: 'absolute', top: 8, right: 8, background: '#00b85c', color: '#fff', fontWeight: 900, fontSize: '10px', padding: '2px 8px', borderRadius: '6px', display: 'flex', alignItems: 'center', gap: '4px', zIndex: 2 }}>
          DESTAQUE
        </div>}
        <div className="admin-game-image">{g.image ? <img src={g.image} alt={g.name} /> : <Gamepad2 />}</div>
        <div>
          <b>{g.name}</b>
          <span>{g.providerName}</span>
          <code>{g.code}</code>
          <div className="admin-game-controls" style={{ marginTop: '10px', display: 'flex', gap: '6px' }}>
            <button
              style={{
                background: isFeatured ? '#4b2435' : '#00b85c',
                color: '#fff',
                fontWeight: 700,
                flex: 1
              }}
              disabled={isSaving}
              onClick={() => save(g, { featured: !isFeatured, enabled: o.enabled !== false })}
            >
              {isSaving ? "Salvando..." : isFeatured ? "Remover destaque" : "Destacar"}
            </button>
            <button
              onClick={() => save(g, { enabled: o.enabled === false ? true : false, featured: isFeatured })}
              disabled={isSaving}
              style={{ opacity: o.enabled === false ? 0.7 : 1 }}
            >
              {o.enabled === false ? "Ativar" : "Desativar"}
            </button>
          </div>
        </div>
      </article>;
    })}</div>}
  </>;
}
