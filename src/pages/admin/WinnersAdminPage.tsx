import { useState, useEffect } from "react";
import { RefreshCw, ShieldCheck } from "lucide-react";
import { adminApi } from "../../lib/adminApi";
import { fetchIgamewinGames, type IGameWinGame } from "../../lib/igamewin";
import { PageTitle, money } from "./AdminComponents";

export default function WinnersAdminPage() {
  const [cfg, setCfg] = useState<any>({ enabled: true, mode: "REAL", limit: 10, updateSeconds: 10, maskNames: true, placement: "HOME", animation: "SLIDE" });
  const [rows, setRows] = useState<any[]>([]);
  const [games, setGames] = useState<IGameWinGame[]>([]);
  const [demo, setDemo] = useState<any>({ gameName: "Fortune Tiger", gameCode: "", providerCode: "", playerName: "Jogador Demo", bet: 2, payout: 114, image: "" });
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const names = ["Rafaela", "Ana", "Nathalia", "Giovana", "Eduarda", "Diogo", "George", "Valdeir", "Valdenice", "Camila", "Lucas", "Mariana", "Bruno", "Amanda", "Felipe", "Larissa", "João", "Isabela", "Rafael", "Vitória"];

  const load = async () => {
    try {
      const [a, b, g]: any = await Promise.all([
        adminApi("/api/admin/winners/config"),
        adminApi("/api/admin/winners/demo"),
        fetchIgamewinGames().catch(() => [])
      ]);
      setCfg((x: any) => ({ ...x, ...a.config }));
      setRows(b.rows || []);
      setGames(g || []);
    } catch (e: any) { setMsg(e.message); }
  };

  useEffect(() => { void load(); }, []);

  async function save() {
    setBusy(true); setMsg("Salvando...");
    try {
      await adminApi("/api/admin/winners/config", { method: "PATCH", body: JSON.stringify(cfg) });
      setMsg("Configuração da Central de Vencedores salva.");
      await load();
    } catch (e: any) { setMsg(`Falha ao salvar: ${e.message}`); }
    finally { setBusy(false); }
  }

  function chooseGame(code: string) {
    const g = games.find(x => `${x.providerCode}:${x.code}` === code);
    if (!g) return;
    setDemo((x: any) => ({ ...x, gameName: g.name, gameCode: g.code, providerCode: g.providerCode, image: g.image || "" }));
  }

  function randomize() {
    const g = games.length ? games[Math.floor(Math.random() * games.length)] : null;
    const bet = [1, 2, 3, 5, 10, 20][Math.floor(Math.random() * 6)];
    const multiplier = [20, 35, 50, 75, 100, 150, 250, 500][Math.floor(Math.random() * 8)];
    setDemo({
      gameName: g?.name || "Fortune Tiger",
      gameCode: g?.code || "",
      providerCode: g?.providerCode || "",
      image: g?.image || "",
      playerName: names[Math.floor(Math.random() * names.length)],
      bet,
      payout: Number((bet * multiplier).toFixed(2))
    });
  }

  async function add() {
    setBusy(true);
    try {
      await adminApi("/api/admin/winners/demo", { method: "POST", body: JSON.stringify(demo) });
      setMsg("Linha demonstrativa adicionada.");
      randomize();
      await load();
    } catch (e: any) { setMsg(e.message); }
    finally { setBusy(false); }
  }

  async function remove(id: string) {
    try {
      await adminApi(`/api/admin/winners/demo/${id}`, { method: "DELETE" });
      await load();
    } catch (e: any) { setMsg(e?.message || ""); }
  }

  return <>
    <PageTitle eyebrow="SOCIAL PROOF" title="Central de Vencedores" text="Resultados reais, curadoria real ou linhas demonstrativas claramente identificadas." action={<button className="admin-primary" disabled={busy} onClick={save}>Salvar configuração</button>} />
    <div className="admin-two-cols">
      <section className="admin-card admin-form-card">
        <h3>Configuração do feed</h3>
        <label className="admin-field"><span>Modo</span><select value={cfg.mode} onChange={e => setCfg({ ...cfg, mode: e.target.value })}><option>REAL</option><option>CURATED_REAL</option><option>DEMO</option></select></label>
        <div className="admin-form-grid">
          <label className="admin-field"><span>Linhas</span><input type="number" min="1" max="20" value={cfg.limit} onChange={e => setCfg({ ...cfg, limit: Number(e.target.value) })} /></label>
          <label className="admin-field"><span>Atualização (s)</span><input type="number" min="5" value={cfg.updateSeconds} onChange={e => setCfg({ ...cfg, updateSeconds: Number(e.target.value) })} /></label>
        </div>
        <div className="config-switches">
          <label><input type="checkbox" checked={!!cfg.enabled} onChange={e => setCfg({ ...cfg, enabled: e.target.checked })} /><span>Ativo</span></label>
          <label><input type="checkbox" checked={!!cfg.maskNames} onChange={e => setCfg({ ...cfg, maskNames: e.target.checked })} /><span>Mascarar nomes</span></label>
        </div>
        <div className="admin-note winners-mode-note"><ShieldCheck /><div><b>Modo DEMO</b><p>As linhas inventadas continuam identificadas internamente como demonstrativas. Use REAL para resultados originados das transações.</p></div></div>
      </section>

      <section className="admin-card admin-form-card">
        <div className="finance-card-head"><div><span>LINHA DEMONSTRATIVA</span><h3>Gerador rápido</h3></div><button className="admin-secondary" onClick={randomize}>Aleatório</button></div>
        <label className="admin-field"><span>Jogo iGameWin</span>
          <select value={demo.providerCode && demo.gameCode ? `${demo.providerCode}:${demo.gameCode}` : ""} onChange={e => chooseGame(e.target.value)}>
            <option value="">Escolher jogo...</option>
            {games.slice(0, 800).map(g => <option key={`${g.providerCode}:${g.code}`} value={`${g.providerCode}:${g.code}`}>{g.name} • {g.providerName || g.providerCode}</option>)}
          </select>
        </label>
        {demo.image && <div className="winner-admin-game-preview"><img src={demo.image} /><div><b>{demo.gameName}</b><small>{demo.providerCode}</small></div></div>}
        <label className="admin-field"><span>Jogador</span><div className="admin-inline-field"><input value={demo.playerName} onChange={e => setDemo({ ...demo, playerName: e.target.value })} /><button onClick={() => setDemo({ ...demo, playerName: names[Math.floor(Math.random() * names.length)] })}>Nome aleatório</button></div></label>
        <div className="admin-form-grid">
          <label className="admin-field"><span>Aposta</span><input type="number" value={demo.bet} onChange={e => setDemo({ ...demo, bet: Number(e.target.value) })} /></label>
          <label className="admin-field"><span>Pagamento</span><input type="number" value={demo.payout} onChange={e => setDemo({ ...demo, payout: Number(e.target.value) })} /></label>
        </div>
        <label className="admin-field"><span>Imagem personalizada (opcional)</span><input value={demo.image} onChange={e => setDemo({ ...demo, image: e.target.value })} /></label>
        <button className="admin-secondary full" disabled={busy || !demo.gameName || !demo.playerName} onClick={add}>Adicionar demo</button>
      </section>
    </div>

    <div className="admin-card admin-table-wrap">
      <div className="finance-card-head"><div><span>{rows.length} LINHAS</span><h3>Curadoria demonstrativa</h3></div><button className="admin-secondary" onClick={load}><RefreshCw size={13} /> Atualizar</button></div>
      <table><thead><tr><th>Jogo</th><th>Jogador</th><th>Aposta</th><th>Pagamento</th><th></th></tr></thead><tbody>
        {rows.map(x => <tr key={x.id}><td><div className="winner-admin-cell">{x.image && <img src={x.image} />}<span>{x.gameName}</span></div></td><td>{x.playerName}</td><td>{money(x.bet)}</td><td>{money(x.payout)}</td><td><button className="admin-secondary" onClick={() => remove(x.id)}>Excluir</button></td></tr>)}
        {!rows.length && <tr><td colSpan={5}>Nenhuma linha demonstrativa cadastrada.</td></tr>}
      </tbody></table>
    </div>
    {msg && <div className="admin-message">{msg}</div>}
  </>;
}
