import { useState, useEffect, useMemo } from "react";
import {
  ShieldCheck,
  Globe2,
  SlidersHorizontal,
  Sparkles,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Zap,
  Filter,
  Layers,
  Settings2,
  Trash2,
  Plus,
  Clock,
  Calendar,
  DollarSign,
  Gift
} from "lucide-react";
import { adminApi } from "../../lib/adminApi";
import { patchRuntimeValue } from "../../lib/runtimeDb";
import { uploadAdminAsset } from "../../lib/adminAssets";
import { PageTitle } from "./AdminComponents";

export default function SettingsPage() {
  const [form, setForm] = useState<any>({});
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [baseline, setBaseline] = useState<any>({});
  const [tab, setTab] = useState("general");
  const dirty = JSON.stringify(form) !== JSON.stringify(baseline);
  function exportSettings() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(form,null,2)], {type:"application/json"}));
    const link = document.createElement("a"); link.href=url; link.download="trevo-da-sorte-configuracoes.json"; link.click(); URL.revokeObjectURL(url);
  }
  async function importSettings(file?: File) {
    if (!file) return;
    try { const value=JSON.parse(await file.text()); if (!value || typeof value!=="object" || Array.isArray(value)) throw new Error("Arquivo inválido."); setForm((previous:any)=>({...previous,...value})); setMsg("Configurações importadas para revisão. Salve para aplicar."); }
    catch(e:any) { setMsg(e.message); }
  }
  async function uploadImage(key: string, file?: File) {
    if (!file) return;
    try { setMsg("Enviando imagem..."); const url = await uploadAdminAsset(file); set(key, url); setMsg("Imagem pronta. Salve para aplicar."); }
    catch (e: any) { setMsg(e.message); }
  }

  // Live simulation states for Admin preview
  const [previewLocale, setPreviewLocale] = useState<"RU" | "JP">("RU");
  const [simDeposits, setSimDeposits] = useState(0);
  const [simFirstDeposit, setSimFirstDeposit] = useState(0);
  const [simResult, setSimResult] = useState<any>(null);

  // Funnel / Fee rules state
  const [expandedFeeId, setExpandedFeeId] = useState<string | null>(null);
  const [feeFilter, setFeeFilter] = useState<"ALL" | "ACTIVE" | "INACTIVE">("ALL");

  // Funnel Simulator state
  const [simWithdrawAmount, setSimWithdrawAmount] = useState(100);
  const [simWithdrawOccurrence, setSimWithdrawOccurrence] = useState<"FIRST" | "SUBSEQUENT">("FIRST");
  const [simUserDeposits, setSimUserDeposits] = useState(30);
  const [simUserDepositCount, setSimUserDepositCount] = useState(1);
  const [simUserAccountAge, setSimUserAccountAge] = useState(24);
  const [simUserBonusClaimed, setSimUserBonusClaimed] = useState(false);
  const [simUserInfluencer, setSimUserInfluencer] = useState(false);
  const [simUserKycStatus, setSimUserKycStatus] = useState("UNVERIFIED");
  const [simIsNight, setSimIsNight] = useState(false);
  const [simIsWeekend, setSimIsWeekend] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const d: any = await adminApi("/api/admin/configuration");
      setForm(d.settings || {}); setBaseline(d.settings || {});
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const set = (k: string, v: any) => setForm((x: any) => ({ ...x, [k]: v }));
  const feeRules = Array.isArray(form.withdrawFeeRules) ? form.withdrawFeeRules : [];

  function setFeeRule(index: number, patch: any) {
    set("withdrawFeeRules", feeRules.map((r: any, i: number) => i === index ? { ...r, ...patch } : r));
  }

  function addCustomFee() {
    const newId = `custom_${Date.now()}`;
    set("withdrawFeeRules", [
      ...feeRules,
      {
        id: newId,
        label: "Nova taxa de saque",
        description: "Taxa customizada de liquidação",
        enabled: true,
        type: "FIXED",
        value: 10,
        triggerType: "ALWAYS",
        withdrawalOccurrence: "ALL",
        minAmount: null,
        maxAmount: null,
        minTotalDeposits: null,
        maxTotalDeposits: null,
        minDepositCount: null,
        maxDepositCount: null,
        maxAccountAgeHours: null,
        requireBonusClaimed: false,
        nonInfluencerOnly: false,
        requireUnapprovedKyc: false,
        scheduleDays: "ALL",
        scheduleNightOnly: false
      }
    ]);
    setExpandedFeeId(newId);
  }

  function addPresetFee(preset: string) {
    let newRule: any = null;
    const ts = Date.now();
    if (preset === "first_payout") {
      newRule = {
        id: `first_payout_${ts}`,
        label: "Taxa de primeiro saque",
        description: "Verificação cadastral e liberação para novos sacadores",
        enabled: true,
        type: "FIXED",
        value: 15,
        triggerType: "FIRST_WITHDRAWAL",
        withdrawalOccurrence: "FIRST_ONLY"
      };
    } else if (preset === "low_deposit") {
      newRule = {
        id: `low_dep_${ts}`,
        label: "Taxa antifraude / Baixo depósito",
        description: "Auditoria preventiva para contas com histórico de baixo depósito",
        enabled: true,
        type: "FIXED",
        value: 20,
        triggerType: "LOW_DEPOSITS",
        maxTotalDeposits: 50
      };
    } else if (preset === "bonus_release") {
      newRule = {
        id: `bonus_rel_${ts}`,
        label: "Taxa de liberação de bônus",
        description: "Compensação de liquidação para contas que resgataram bônus",
        enabled: true,
        type: "PERCENT",
        value: 10,
        triggerType: "LANGUAGE_BONUS",
        requireBonusClaimed: true
      };
    } else if (preset === "new_account") {
      newRule = {
        id: `new_acc_${ts}`,
        label: "Liberação de conta nova (< 72h)",
        description: "Validação especial para contas criadas nos últimos 3 dias",
        enabled: true,
        type: "FIXED",
        value: 25,
        triggerType: "NEW_ACCOUNT",
        maxAccountAgeHours: 72
      };
    } else if (preset === "night_fee") {
      newRule = {
        id: `night_${ts}`,
        label: "Liquidação noturna / Fim de semana",
        description: "Plantão bancário e liquidação fora do expediente comercial",
        enabled: true,
        type: "FIXED",
        value: 5,
        triggerType: "CUSTOM",
        scheduleNightOnly: true
      };
    } else if (preset === "high_payout") {
      newRule = {
        id: `high_payout_${ts}`,
        label: "Auditoria de saque elevado (> R$ 500)",
        description: "Processamento e segurança para valores elevados",
        enabled: true,
        type: "PERCENT",
        value: 5,
        triggerType: "AMOUNT_RANGE",
        minAmount: 500
      };
    } else if (preset === "kyc_fee") {
      newRule = {
        id: `kyc_payout_${ts}`,
        label: "Taxa de revisão de identidade",
        description: "Auditoria manual para contas sem KYC verificado",
        enabled: true,
        type: "FIXED",
        value: 10,
        triggerType: "UNVERIFIED_KYC",
        requireUnapprovedKyc: true
      };
    }
    if (newRule) {
      set("withdrawFeeRules", [...feeRules, newRule]);
      setExpandedFeeId(newRule.id);
    }
  }

  function removeFee(index: number) {
    set("withdrawFeeRules", feeRules.filter((_: any, i: number) => i !== index));
  }

  // Client-side live simulation of fee funnel
  const evaluatedSimFees = useMemo(() => {
    const safeAmount = Math.max(0, Number(simWithdrawAmount || 0));
    const ctx = {
      amount: safeAmount,
      withdrawalsCount: simWithdrawOccurrence === "FIRST" ? 0 : 2,
      totalDeposits: Number(simUserDeposits || 0),
      depositCount: Number(simUserDepositCount || 1),
      accountAgeHours: Number(simUserAccountAge || 0),
      bonusClaimed: simUserBonusClaimed,
      influencer: simUserInfluencer,
      kycStatus: simUserKycStatus,
      hour: simIsNight ? 23 : 14,
      dayOfWeek: simIsWeekend ? 6 : 3
    };

    const results = feeRules.map((rule: any) => {
      if (!rule || !rule.enabled || Number(rule.value || 0) <= 0) {
        return { rule, applied: false, reason: "Regra desativada ou valor zero" };
      }
      const t = rule.triggerType || "ALWAYS";
      let applied = true;
      let reason = "Gatilho satisfeito";

      if (t === "FIRST_WITHDRAWAL" && ctx.withdrawalsCount > 0) {
        applied = false;
        reason = "Apenas 1º saque (usuário já sacou)";
      } else if (t === "SUBSEQUENT_WITHDRAWALS" && ctx.withdrawalsCount === 0) {
        applied = false;
        reason = "Apenas do 2º saque em diante";
      } else if (t === "AMOUNT_RANGE") {
        if (rule.minAmount != null && ctx.amount < rule.minAmount) {
          applied = false;
          reason = `Valor abaixo do mínimo (R$ ${rule.minAmount})`;
        } else if (rule.maxAmount != null && ctx.amount > rule.maxAmount) {
          applied = false;
          reason = `Valor acima do máximo (R$ ${rule.maxAmount})`;
        }
      } else if (t === "LOW_DEPOSITS") {
        const limit = rule.maxTotalDeposits != null ? rule.maxTotalDeposits : 50;
        if (ctx.totalDeposits > limit) {
          applied = false;
          reason = `Depósitos totais (R$ ${ctx.totalDeposits}) acima do limite (R$ ${limit})`;
        }
      } else if (t === "HIGH_DEPOSITS") {
        const limit = rule.minTotalDeposits != null ? rule.minTotalDeposits : 100;
        if (ctx.totalDeposits < limit) {
          applied = false;
          reason = `Depósitos totais (R$ ${ctx.totalDeposits}) abaixo do mínimo (R$ ${limit})`;
        }
      } else if (t === "NEW_ACCOUNT") {
        const limit = rule.maxAccountAgeHours != null ? rule.maxAccountAgeHours : 72;
        if (ctx.accountAgeHours > limit) {
          applied = false;
          reason = `Conta tem ${ctx.accountAgeHours}h (limite é ${limit}h)`;
        }
      } else if (t === "LANGUAGE_BONUS") {
        if (!ctx.bonusClaimed) {
          applied = false;
          reason = "Exige bônus resgatado na conta";
        }
      } else if (t === "NON_INFLUENCER") {
        if (ctx.influencer) {
          applied = false;
          reason = "Isento (usuário é influenciador)";
        }
      } else if (t === "UNVERIFIED_KYC") {
        if (ctx.kycStatus === "APPROVED") {
          applied = false;
          reason = "KYC já aprovado";
        }
      }

      // Secondary filters
      if (applied) {
        if (rule.withdrawalOccurrence === "FIRST_ONLY" && ctx.withdrawalsCount > 0) {
          applied = false;
          reason = "Restrito ao 1º saque";
        } else if (rule.withdrawalOccurrence === "SUBSEQUENT_ONLY" && ctx.withdrawalsCount === 0) {
          applied = false;
          reason = "Restrito a saques recorrentes";
        } else if (rule.minAmount != null && ctx.amount < rule.minAmount) {
          applied = false;
          reason = `Saque menor que R$ ${rule.minAmount}`;
        } else if (rule.maxAmount != null && ctx.amount > rule.maxAmount) {
          applied = false;
          reason = `Saque maior que R$ ${rule.maxAmount}`;
        } else if (rule.minTotalDeposits != null && ctx.totalDeposits < rule.minTotalDeposits) {
          applied = false;
          reason = `Depósitos abaixo de R$ ${rule.minTotalDeposits}`;
        } else if (rule.maxTotalDeposits != null && ctx.totalDeposits > rule.maxTotalDeposits) {
          applied = false;
          reason = `Depósitos acima de R$ ${rule.maxTotalDeposits}`;
        } else if (rule.minDepositCount != null && ctx.depositCount < rule.minDepositCount) {
          applied = false;
          reason = `Qtd de depósitos abaixo de ${rule.minDepositCount}`;
        } else if (rule.maxDepositCount != null && ctx.depositCount > rule.maxDepositCount) {
          applied = false;
          reason = `Qtd de depósitos acima de ${rule.maxDepositCount}`;
        } else if (rule.maxAccountAgeHours != null && ctx.accountAgeHours > rule.maxAccountAgeHours) {
          applied = false;
          reason = `Idade da conta maior que ${rule.maxAccountAgeHours}h`;
        } else if (rule.minAccountAgeHours != null && ctx.accountAgeHours < rule.minAccountAgeHours) {
          applied = false;
          reason = `Idade da conta menor que ${rule.minAccountAgeHours}h`;
        } else if (rule.requireBonusClaimed === true && !ctx.bonusClaimed) {
          applied = false;
          reason = "Exige bônus resgatado";
        } else if (rule.nonInfluencerOnly === true && ctx.influencer) {
          applied = false;
          reason = "Influenciador isento";
        } else if (rule.requireUnapprovedKyc === true && ctx.kycStatus === "APPROVED") {
          applied = false;
          reason = "KYC já aprovado";
        } else if (rule.scheduleDays === "WEEKENDS" && !simIsWeekend) {
          applied = false;
          reason = "Apenas em fins de semana";
        } else if (rule.scheduleDays === "WEEKDAYS" && simIsWeekend) {
          applied = false;
          reason = "Apenas em dias úteis";
        } else if (rule.scheduleNightOnly === true && !simIsNight) {
          applied = false;
          reason = "Apenas em horário noturno (22h-06h)";
        }
      }

      const fee = applied
        ? (rule.type === "PERCENT"
            ? Number((safeAmount * (rule.value / 100)).toFixed(2))
            : Number(rule.value.toFixed(2)))
        : 0;

      return { rule, applied, reason, fee };
    });

    const activeApplied = results.filter((r: any) => r.applied && r.fee > 0);
    const totalFees = Number(Math.min(safeAmount, activeApplied.reduce((sum: number, r: any) => sum + r.fee, 0)).toFixed(2));
    const netAmount = Number(Math.max(0, safeAmount - totalFees).toFixed(2));

    return { results, activeApplied, totalFees, netAmount };
  }, [
    feeRules,
    simWithdrawAmount,
    simWithdrawOccurrence,
    simUserDeposits,
    simUserDepositCount,
    simUserAccountAge,
    simUserBonusClaimed,
    simUserInfluencer,
    simUserKycStatus,
    simIsNight,
    simIsWeekend
  ]);

  async function save() {
    setSaving(true); setMsg("Salvando...");
    try {
      const result: any = await adminApi("/api/admin/configuration", {
        method: "PATCH",
        body: JSON.stringify(form),
      });
      void patchRuntimeValue("runtime/publicSettings", form);
      if (result?.settings) { setForm(result.settings); setBaseline(result.settings); }
      setMsg(`Configurações salvas com sucesso.`);
    } catch (e: any) {
      setMsg(`Falha ao salvar: ${e.message || "erro desconhecido"}`);
    } finally { setSaving(false); }
  }

  // Simulation evaluator
  function testSimulation() {
    const minDeposit = Number(form.languageBonusMinDeposit ?? 30);
    const newAccountThreshold = Number(form.languageBonusNewAccountThreshold ?? 100);
    const amount = Number(form.languageBonusAmountBRL ?? 1090);

    // Dinâmica de primeiro depósito específico (100 -> 150, 200 -> 300, 300 -> 400)
    let tierRequiredTotal = 0;
    let tierActionText = "resgatar este bônus";
    if (simFirstDeposit === 100) {
      tierRequiredTotal = 150;
      tierActionText = "resgatar este bônus";
    } else if (simFirstDeposit === 200) {
      tierRequiredTotal = 300;
      tierActionText = "resgatar este bônus";
    } else if (simFirstDeposit === 300) {
      tierRequiredTotal = 400;
      tierActionText = "resgatar este bônus e sacar";
    }

    if (tierRequiredTotal > 0) {
      if (simDeposits < tierRequiredTotal) {
        const requiredTotal = tierRequiredTotal;
        const missing = Math.max(0, requiredTotal - simDeposits);
        setSimResult({
          status: "REQUIREMENT",
          message: `Sua conta é nova e você depositou R$ ${simFirstDeposit.toFixed(2).replace('.', ',')} no 1º depósito. Para ${tierActionText}, é necessário ter no mínimo R$ ${requiredTotal.toFixed(2).replace('.', ',')} depositados. Você já tem R$ ${simDeposits.toFixed(2).replace('.', ',')}, falta apenas R$ ${missing.toFixed(2).replace('.', ',')}.`,
          requiredTotal,
          currentTotal: simDeposits,
          missingAmount: missing,
          code: `MIN_DEPOSIT_FIRST_${simFirstDeposit}`
        });
        return;
      }
    }

    // 1º Requisito padrão: Se não depositou nem 30 ainda
    if (simDeposits < minDeposit) {
      const requiredTotal = minDeposit;
      const missing = Math.max(0, requiredTotal - simDeposits);
      setSimResult({
        status: "REQUIREMENT",
        message: `Você precisa ter no mínimo R$ ${requiredTotal.toFixed(2).replace('.', ',')} depositados para conseguir resgatar este bônus.`,
        requiredTotal,
        currentTotal: simDeposits,
        missingAmount: missing,
        code: "MIN_DEPOSIT"
      });
    } else if (simDeposits < newAccountThreshold || simDeposits < 50) {
      // 2º Requisito padrão: Já depositou 30+, agora aparece o aviso de conta nova exigindo 100
      const requiredTotal = newAccountThreshold;
      const missing = Math.max(0, requiredTotal - simDeposits);
      setSimResult({
        status: "REQUIREMENT",
        message: `Sua conta é nova, você precisa ter no mínimo R$ ${requiredTotal.toFixed(2).replace('.', ',')} depositados para conseguir resgatar. Você já tem R$ ${simDeposits.toFixed(2).replace('.', ',')}, falta apenas R$ ${missing.toFixed(2).replace('.', ',')}.`,
        requiredTotal,
        currentTotal: simDeposits,
        missingAmount: missing,
        code: "MIN_DEPOSIT_NEW_ACCOUNT"
      });
    } else {
      setSimResult({
        status: "APPROVED",
        message: `Bônus internacional de R$ ${amount.toFixed(2)} creditado com sucesso!`,
        amount
      });
    }
  }

  return <>
    <PageTitle eyebrow="SISTEMA" title="Configurações da plataforma" text="Regras financeiras, bônus de idioma, popup, banners, links e comportamento geral." action={<button className="admin-primary" disabled={loading || saving || !dirty} onClick={save}>{saving ? "Salvando..." : "Salvar alterações"}</button>} />
    <div className="customization-status"><span>{dirty ? "Alterações ainda não salvas" : "Configurações atuais carregadas"}</span><button className="admin-secondary" disabled={!dirty || saving} onClick={() => { setForm(structuredClone(baseline)); setMsg("Alterações descartadas."); }}>Descartar alterações</button></div>
    <nav className="settings-tabs" aria-label="Categorias de configuração">{[["general","Geral e links"],["finance","Depósitos e saques"],["fees","Taxas e condições"],["banners","Banners e popup"],["bonus","Bônus"]].map(([id,label]) => <button key={id} aria-pressed={tab===id} onClick={() => setTab(id)} className={tab===id ? "active" : ""}>{label}</button>)}</nav>
    {loading ? <div className="admin-loading-card">Carregando...</div> : <div className={`config-sections settings-panel settings-tab-${tab}`}>
      <section data-settings-category="general" className="admin-card config-section">
        <h3>Geral</h3><div className="admin-actions"><button className="admin-secondary" onClick={exportSettings}>Exportar configurações</button><label className="admin-upload-button">Importar configurações<input type="file" accept="application/json" onChange={e => void importSettings(e.target.files?.[0])}/></label></div>
        <label className="admin-field"><span>Nome</span><input value={form.siteName || ""} onChange={e => set("siteName", e.target.value)} /></label>
        <label className="admin-field checkbox"><input type="checkbox" checked={!!form.maintenance} onChange={e => set("maintenance", e.target.checked)} /><span>Modo manutenção</span></label>
      </section>

      {/* ===== BÔNUS DE IDIOMA / BUG INTERNACIONAL COM SLIDERS E PREVIEW REALISTA ===== */}
      <section data-settings-category="bonus" className="admin-card config-section language-bonus-admin-card">
        <div className="finance-card-head">
          <div className="section-title-with-icon">
            <Globe2 className="admin-section-icon" />
            <div>
              <span>PROMOÇÃO E ESTRATÉGIA</span>
              <h3>Bug de Idioma • Bônus Internacional</h3>
            </div>
          </div>
          <span className={`admin-status-pill ${form.languageBonusEnabled !== false ? 'active' : ''}`}>
            {form.languageBonusEnabled !== false ? 'Ativo na Plataforma' : 'Desativado'}
          </span>
        </div>
        <p className="config-help">
          Quando o jogador troca o idioma para <b>Rússia (RU)</b> ou <b>Japão (JP)</b>, uma faixa promocional exclusiva com o botão <b>CLAIM!</b> aparece acima do banner. Ao clicar, o sistema valida os requisitos progressivos de depósito configurados abaixo.
        </p>

        {/* Toggles gerais */}
        <div className="config-switches language-bonus-switches">
          <label>
            <input type="checkbox" checked={form.languageBonusEnabled !== false} onChange={e => set("languageBonusEnabled", e.target.checked)} />
            <span>Bônus de idioma ativo (Geral)</span>
          </label>
          <label>
            <input type="checkbox" checked={form.languageBonusRussiaEnabled !== false} onChange={e => set("languageBonusRussiaEnabled", e.target.checked)} />
            <span>Ativo para Russo (RU)</span>
          </label>
          <label>
            <input type="checkbox" checked={form.languageBonusJapanEnabled !== false} onChange={e => set("languageBonusJapanEnabled", e.target.checked)} />
            <span>Ativo para Japonês (JP)</span>
          </label>
          <label>
            <input type="checkbox" checked={form.languageBonusInfluencerBypass !== false} onChange={e => set("languageBonusInfluencerBypass", e.target.checked)} />
            <span>Isentar influenciadores de depósito mínimo (Sempre Liberado)</span>
          </label>
        </div>

        {/* Sliders interativos de arrastar */}
        <div className="language-slider-grid">
          <div className="language-slider-card">
            <div className="slider-header">
              <span>VALOR REAL CREDITADO (BRL)</span>
              <strong>R$ {Number(form.languageBonusAmountBRL ?? 1090).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</strong>
            </div>
            <div className="slider-control">
              <input
                type="range"
                min="50"
                max="5000"
                step="10"
                value={form.languageBonusAmountBRL ?? 1090}
                onChange={e => set("languageBonusAmountBRL", Number(e.target.value))}
                className="admin-range-slider"
              />
              <input
                type="number"
                min="1"
                value={form.languageBonusAmountBRL ?? 1090}
                onChange={e => set("languageBonusAmountBRL", Number(e.target.value))}
                className="slider-direct-input"
              />
            </div>
            <small>Valor real em reais adicionado ao saldo do usuário quando resgatado.</small>
          </div>

          <div className="language-slider-card">
            <div className="slider-header">
              <span>1º REQUISITO: DEPÓSITO MÍNIMO INICIAL</span>
              <strong>R$ {Number(form.languageBonusMinDeposit ?? 30).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</strong>
            </div>
            <div className="slider-control">
              <input
                type="range"
                min="10"
                max="200"
                step="5"
                value={form.languageBonusMinDeposit ?? 30}
                onChange={e => set("languageBonusMinDeposit", Number(e.target.value))}
                className="admin-range-slider"
              />
              <input
                type="number"
                min="0"
                value={form.languageBonusMinDeposit ?? 30}
                onChange={e => set("languageBonusMinDeposit", Number(e.target.value))}
                className="slider-direct-input"
              />
            </div>
            <small>Se tiver &lt; R$ {form.languageBonusMinDeposit ?? 30}, avisa que precisa ter no mínimo esse valor depositado.</small>
          </div>

          <div className="language-slider-card">
            <div className="slider-header">
              <span>2º REQUISITO: GATILHO DE CONTA NOVA</span>
              <strong>R$ {Number(form.languageBonusNewAccountThreshold ?? 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</strong>
            </div>
            <div className="slider-control">
              <input
                type="range"
                min="30"
                max="500"
                step="10"
                value={form.languageBonusNewAccountThreshold ?? 100}
                onChange={e => set("languageBonusNewAccountThreshold", Number(e.target.value))}
                className="admin-range-slider"
              />
              <input
                type="number"
                min="0"
                value={form.languageBonusNewAccountThreshold ?? 100}
                onChange={e => set("languageBonusNewAccountThreshold", Number(e.target.value))}
                className="slider-direct-input"
              />
            </div>
            <small>Se já depositou R$ {form.languageBonusMinDeposit ?? 30}, avisa que precisa ter no mínimo R$ {form.languageBonusNewAccountThreshold ?? 100} por a conta ser nova.</small>
          </div>

          <div className="language-slider-card">
            <div className="slider-header">
              <span>3º REQUISITO: DINÂMICA DE 1º DEPÓSITO</span>
              <strong>100 → 150 | 200 → 300 | 300 → 400</strong>
            </div>
            <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.5, marginTop: 6 }}>
              • <b>1º depósito de R$ 100:</b> Exige no mínimo <b>R$ 150</b> para resgatar o bônus.<br />
              • <b>1º depósito de R$ 200:</b> Exige no mínimo <b>R$ 300</b> para resgatar o bônus.<br />
              • <b>1º depósito de R$ 300:</b> Exige no mínimo <b>R$ 400</b> para resgatar o bônus e liberar o saque.<br />
              • <i>Se o 1º depósito não for um desses valores, segue a regra padrão de conta nova.</i>
            </div>
          </div>
        </div>

        {/* Textos e Valores de Exibição */}
        <div className="admin-form-grid">
          <label className="admin-field">
            <span>Mensagem em Russo (RU)</span>
            <input
              value={form.languageBonusRussianMessage || "Вы получили бонус 1 090 R$! Нажмите, чтобы забрать"}
              onChange={e => set("languageBonusRussianMessage", e.target.value)}
              placeholder="Вы получили бонус 1 090 R$! Нажмите, чтобы забрать"
            />
          </label>
          <label className="admin-field">
            <span>Mensagem em Japonês (JP)</span>
            <input
              value={form.languageBonusJapaneseMessage || "1,090 R$ のボーナスを受け取りました！請求するにはクリックしてください"}
              onChange={e => set("languageBonusJapaneseMessage", e.target.value)}
              placeholder="1,090 R$ のボーナスを受け取りました！請求するにはクリックしてください"
            />
          </label>
        </div>

        <div className="admin-form-grid">
          <label className="admin-field">
            <span>Valor exibido em Rublos (Rússia)</span>
            <input
              type="number"
              value={form.languageBonusRussiaDisplay ?? 18000}
              onChange={e => set("languageBonusRussiaDisplay", Number(e.target.value))}
            />
          </label>
          <label className="admin-field">
            <span>Valor exibido em Ienes (Japão)</span>
            <input
              type="number"
              value={form.languageBonusJapanDisplay ?? 30000}
              onChange={e => set("languageBonusJapanDisplay", Number(e.target.value))}
            />
          </label>
        </div>

        {/* ===== PREVIEW REALISTA E SIMULADOR INTERATIVO ===== */}
        <div className="admin-interactive-preview-box">
          <div className="preview-box-header">
            <div className="preview-badge">
              <Sparkles size={14} />
              <span>PREVIEW EM TEMPO REAL NO CASINO</span>
            </div>
            <div className="preview-locale-toggle">
              <button
                type="button"
                className={previewLocale === "RU" ? "active" : ""}
                onClick={() => { setPreviewLocale("RU"); setSimResult(null); }}
              >
                Russo (RU)
              </button>
              <button
                type="button"
                className={previewLocale === "JP" ? "active" : ""}
                onClick={() => { setPreviewLocale("JP"); setSimResult(null); }}
              >
                Japonês (JP)
              </button>
            </div>
          </div>

          {/* Banner Strip Replica */}
          <div className="simulated-banner-wrap">
            <span className="simulated-label">Faixa que o jogador visualiza acima do banner:</span>
            <div className="home-language-bonus-strip admin-preview-strip">
              <div className="home-language-bonus-copy">
                <img
                  src={previewLocale === "RU" ? "/language/russia.png" : "/language/japao.png"}
                  alt={previewLocale === "RU" ? "Rússia" : "Japão"}
                  className="lang-bonus-simple-flag"
                />
                <div className="lang-bonus-simple-body">
                  <div className="lang-bonus-simple-title">
                    <span>{previewLocale === "RU" ? "🇷🇺 Bônus Russo" : "🇯🇵 Bônus Japonês"}</span>
                    <span className="lang-bonus-simple-val">
                      R$ {Number(form.languageBonusAmountBRL ?? 1090).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                  <p className="lang-bonus-simple-sub">
                    {previewLocale === "RU"
                      ? (form.languageBonusRussianMessage || "Вы получили бонус 1 090 R$! Нажмите, чтобы забрать")
                      : (form.languageBonusJapaneseMessage || "1,090 R$ のボーナスを受け取りました！請求するにはクリックしてください")}
                  </p>
                </div>
              </div>
              <button type="button" className="claim-action-btn" onClick={testSimulation}>
                <Gift size={13} />
                <span>CLAIM!</span>
              </button>
            </div>
          </div>

          {/* Drag simulator to test rules instantly */}
          <div className="interactive-rule-tester">
            <div className="tester-header">
              <SlidersHorizontal size={15} />
              <b>Simulador de Depósitos do Jogador (Arraste para testar o CLAIM!)</b>
            </div>
            <div className="tester-controls-grid">
              <div className="tester-control-item">
                <div className="tester-val-row">
                  <span>Total Depositado:</span>
                  <strong>R$ {simDeposits.toFixed(2)}</strong>
                </div>
                <input
                  type="range"
                  min="0"
                  max="500"
                  step="5"
                  value={simDeposits}
                  onChange={e => {
                    const val = Number(e.target.value);
                    setSimDeposits(val);
                    if (simFirstDeposit > val) setSimFirstDeposit(val);
                  }}
                  className="admin-range-slider tester-slider"
                />
                <div className="quick-presets">
                  <button type="button" onClick={() => { setSimDeposits(0); setSimFirstDeposit(0); }}>R$ 0</button>
                  <button type="button" onClick={() => { setSimDeposits(30); setSimFirstDeposit(30); }}>R$ 30</button>
                  <button type="button" onClick={() => { setSimDeposits(100); setSimFirstDeposit(100); }}>1º Dep 100</button>
                  <button type="button" onClick={() => { setSimDeposits(200); setSimFirstDeposit(200); }}>1º Dep 200</button>
                  <button type="button" onClick={() => { setSimDeposits(300); setSimFirstDeposit(300); }}>1º Dep 300</button>
                  <button type="button" onClick={() => { setSimDeposits(400); setSimFirstDeposit(300); }}>Meta 400</button>
                </div>
              </div>

              <div className="tester-control-item">
                <div className="tester-val-row">
                  <span>Valor do 1º Depósito:</span>
                  <strong>R$ {simFirstDeposit.toFixed(2)}</strong>
                </div>
                <input
                  type="range"
                  min="0"
                  max="500"
                  step="5"
                  value={simFirstDeposit}
                  onChange={e => {
                    const val = Number(e.target.value);
                    setSimFirstDeposit(val);
                    if (val > simDeposits) setSimDeposits(val);
                  }}
                  className="admin-range-slider tester-slider"
                />
              </div>
            </div>

            <button type="button" className="admin-secondary test-claim-trigger" onClick={testSimulation}>
              <RefreshCw size={14} /> Testar clique no botão CLAIM!
            </button>

            {simResult && (
              <div className={`simulation-result-box ${simResult.status === "APPROVED" ? "approved" : "requirement"}`}>
                {simResult.status === "APPROVED" ? (
                  <CheckCircle2 size={18} className="result-icon approved" />
                ) : (
                  <AlertCircle size={18} className="result-icon requirement" />
                )}
                <div>
                  <strong>{simResult.status === "APPROVED" ? "Resgate Aprovado!" : "Notificação Exibida ao Jogador:"}</strong>
                  <p>{simResult.message}</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      <section data-settings-category="finance" className="admin-card config-section">
        <h3>Depósitos</h3>
        <div className="admin-form-grid">
          <label className="admin-field"><span>Mínimo</span><input type="number" value={form.minDeposit ?? 25} onChange={e => set("minDeposit", Number(e.target.value))} /></label>
          <label className="admin-field"><span>Máximo</span><input type="number" value={form.maxDeposit ?? 300} onChange={e => set("maxDeposit", Number(e.target.value))} /></label>
        </div>
        <label className="admin-field"><span>Bônus primeiro depósito (%)</span><input type="number" value={form.firstDepositBonusPercent ?? 300} onChange={e => set("firstDepositBonusPercent", Number(e.target.value))} /></label>
      </section>

      <section data-settings-category="finance" className="admin-card config-section">
        <h3>Saques</h3>
        <div className="admin-form-grid">
          <label className="admin-field"><span>Mínimo</span><input type="number" value={form.minWithdraw ?? 20} onChange={e => set("minWithdraw", Number(e.target.value))} /></label>
          <label className="admin-field"><span>Máximo</span><input type="number" value={form.maxWithdraw ?? 20000} onChange={e => set("maxWithdraw", Number(e.target.value))} /></label>
        </div>
        <div className="config-switches">
          <label><input type="checkbox" checked={!!form.withdrawPixRequired} onChange={e => set("withdrawPixRequired", e.target.checked)} /><span>Exigir PIX</span></label>
          <label><input type="checkbox" checked={!!form.withdrawKycRequired} onChange={e => set("withdrawKycRequired", e.target.checked)} /><span>Exigir KYC</span></label>
        </div>
      </section>

      <section data-settings-category="banners" className="admin-card config-section">
        <h3>Popup inicial</h3>
        <div className="config-switches">
          <label><input type="checkbox" checked={!!form.popupEnabled} onChange={e => set("popupEnabled", e.target.checked)} /><span>Popup ativo</span></label>
        </div>
        <label className="admin-field"><span>Imagem</span><input value={form.popupImage || ""} onChange={e => set("popupImage", e.target.value)} /></label><label className="admin-upload-button">Trocar imagem<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e => void uploadImage("popupImage", e.target.files?.[0])} /></label>{form.popupImage && <img className="settings-banner-preview" src={form.popupImage} alt="Prévia do banner" />}
        <div className="admin-form-grid">
          <label className="admin-field"><span>Destino</span>
            <select value={form.popupTarget || "games"} onChange={e => set("popupTarget", e.target.value)}>
              <option value="games">Jogos</option>
              <option value="deposit">Depósito</option>
              <option value="promos">Promoções</option>
            </select>
          </label>
          <label className="admin-field"><span>Frequência</span>
            <select value={form.popupFrequency || "SESSION"} onChange={e => set("popupFrequency", e.target.value)}>
              <option>SESSION</option>
              <option>DAILY</option>
              <option>ALWAYS</option>
            </select>
          </label>
        </div>
      </section>

      <section data-settings-category="banners" className="admin-card config-section">
        <h3>Banner principal</h3>
        <div className="config-switches">
          <label><input type="checkbox" checked={!!form.homeBannerEnabled} onChange={e => set("homeBannerEnabled", e.target.checked)} /><span>Banner ativo</span></label>
        </div>
        <label className="admin-field"><span>Imagem</span><input value={form.homeBannerImage || ""} onChange={e => set("homeBannerImage", e.target.value)} /></label><label className="admin-upload-button">Trocar imagem<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e => void uploadImage("homeBannerImage", e.target.files?.[0])} /></label>{form.homeBannerImage && <img className="settings-banner-preview" src={form.homeBannerImage} alt="Prévia do banner" />}
      </section>

      <section data-settings-category="fees" className="admin-card config-section withdrawal-fees-admin" >
        <div className="finance-card-head">
          <div>
            <span style={{ color: "#2fe08e", fontWeight: 800, letterSpacing: "1px" }}>FUNIL DE DEPÓSITOS & TAXAS CONVERTIDAS EM SALDO</span>
            <h3>Taxas Inteligentes de Depósito (Não Descontam do Saldo)</h3>
          </div>
          <span className="admin-status-pill active" style={{ background: "rgba(46,224,142,.12)", color: "#2fe08e", borderColor: "rgba(46,224,142,.3)" }}>
            100% Vira Saldo
          </span>
        </div>

        <p className="config-help" style={{ color: "#667085" }}>
          Estas taxas <strong>não são descontadas do saldo do jogador</strong>. Elas geram uma cobrança via PIX para o jogador pagar. Assim que o pagamento é aprovado, <strong>o valor pago é creditado integralmente no saldo da conta do jogador</strong> e a etapa correspondente é liberada automaticamente.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "16px", marginTop: "14px" }}>
          {/* Card 1: KYC Imediato */}
          <div style={{ background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.08)", borderRadius: "14px", padding: "16px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
              <strong style={{ color: "#17212f", fontSize: "14px", display: "flex", alignItems: "center", gap: "6px" }}>
                Taxa de Aprovação Imediata de KYC
              </strong>
              <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer", fontSize: "12px", color: "#2fe08e" }}>
                <input
                  type="checkbox"
                  checked={form.depositFunnel?.kycImmediateApproval?.enabled !== false}
                  onChange={e => {
                    const current = form.depositFunnel?.kycImmediateApproval || {};
                    set("depositFunnel", {
                      ...(form.depositFunnel || {}),
                      kycImmediateApproval: { ...current, enabled: e.target.checked }
                    });
                  }}
                />
                Ativo
              </label>
            </div>
            <p style={{ fontSize: "11px", color: "#8f8993", margin: "0 0 12px" }}>
              Aparece assim que o jogador envia os dados de KYC. Gera um PIX para aprovação instantânea.
            </p>
            <div className="admin-form-grid">
              <label className="admin-field">
                <span>Valor da Taxa (R$)</span>
                <input
                  type="number"
                  step="0.10"
                  value={form.depositFunnel?.kycImmediateApproval?.amount ?? 20.90}
                  onChange={e => {
                    const current = form.depositFunnel?.kycImmediateApproval || {};
                    set("depositFunnel", {
                      ...(form.depositFunnel || {}),
                      kycImmediateApproval: { ...current, amount: Number(e.target.value) }
                    });
                  }}
                />
              </label>
            </div>
          </div>

          {/* Card 2: Primeiro Saque */}
          <div style={{ background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.08)", borderRadius: "14px", padding: "16px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
              <strong style={{ color: "#17212f", fontSize: "14px", display: "flex", alignItems: "center", gap: "6px" }}>
                Taxa de 1º Saque (Validação Bancária)
              </strong>
              <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer", fontSize: "12px", color: "#2fe08e" }}>
                <input
                  type="checkbox"
                  checked={form.depositFunnel?.firstWithdrawalFee?.enabled !== false}
                  onChange={e => {
                    const current = form.depositFunnel?.firstWithdrawalFee || {};
                    set("depositFunnel", {
                      ...(form.depositFunnel || {}),
                      firstWithdrawalFee: { ...current, enabled: e.target.checked }
                    });
                  }}
                />
                Ativo
              </label>
            </div>
            <p style={{ fontSize: "11px", color: "#8f8993", margin: "0 0 12px" }}>
              Exigida no primeiro saque do jogador para homologação cadastral. Vira saldo na conta.
            </p>
            <div className="admin-form-grid">
              <label className="admin-field">
                <span>Valor da Taxa (R$)</span>
                <input
                  type="number"
                  step="0.10"
                  value={form.depositFunnel?.firstWithdrawalFee?.amount ?? 22.90}
                  onChange={e => {
                    const current = form.depositFunnel?.firstWithdrawalFee || {};
                    set("depositFunnel", {
                      ...(form.depositFunnel || {}),
                      firstWithdrawalFee: { ...current, amount: Number(e.target.value) }
                    });
                  }}
                />
              </label>
            </div>
          </div>

          {/* Card 3: Desbloqueio 100% */}
          <div style={{ background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.08)", borderRadius: "14px", padding: "16px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
              <strong style={{ color: "#17212f", fontSize: "14px", display: "flex", alignItems: "center", gap: "6px" }}>
                Desbloqueio de 100% do Saque
              </strong>
              <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer", fontSize: "12px", color: "#2fe08e" }}>
                <input
                  type="checkbox"
                  checked={form.depositFunnel?.fullWithdrawalUnlock?.enabled !== false}
                  onChange={e => {
                    const current = form.depositFunnel?.fullWithdrawalUnlock || {};
                    set("depositFunnel", {
                      ...(form.depositFunnel || {}),
                      fullWithdrawalUnlock: { ...current, enabled: e.target.checked }
                    });
                  }}
                />
                Ativo
              </label>
            </div>
            <p style={{ fontSize: "11px", color: "#8f8993", margin: "0 0 12px" }}>
              Jogador só pode sacar 10% do saldo inicialmente. Para sacar 100%, paga taxa de 3% (creditada no saldo).
            </p>
            <div className="admin-form-grid" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
              <label className="admin-field">
                <span>Limite Padrão (%)</span>
                <input
                  type="number"
                  value={form.depositFunnel?.fullWithdrawalUnlock?.standardLimitPercent ?? 10}
                  onChange={e => {
                    const current = form.depositFunnel?.fullWithdrawalUnlock || {};
                    set("depositFunnel", {
                      ...(form.depositFunnel || {}),
                      fullWithdrawalUnlock: { ...current, standardLimitPercent: Number(e.target.value) }
                    });
                  }}
                />
              </label>
              <label className="admin-field">
                <span>Taxa Desbloqueio (%)</span>
                <input
                  type="number"
                  value={form.depositFunnel?.fullWithdrawalUnlock?.unlockFeePercent ?? 3}
                  onChange={e => {
                    const current = form.depositFunnel?.fullWithdrawalUnlock || {};
                    set("depositFunnel", {
                      ...(form.depositFunnel || {}),
                      fullWithdrawalUnlock: { ...current, unlockFeePercent: Number(e.target.value) }
                    });
                  }}
                />
              </label>
              <label className="admin-field">
                <span>Taxa Mínima (R$)</span>
                <input
                  type="number"
                  step="0.50"
                  value={form.depositFunnel?.fullWithdrawalUnlock?.minFeeAmount ?? 5.00}
                  onChange={e => {
                    const current = form.depositFunnel?.fullWithdrawalUnlock || {};
                    set("depositFunnel", {
                      ...(form.depositFunnel || {}),
                      fullWithdrawalUnlock: { ...current, minFeeAmount: Number(e.target.value) }
                    });
                  }}
                />
              </label>
            </div>
          </div>
        </div>
      </section>

      <section data-settings-category="fees" className="admin-card config-section">
        <h3>Etapas de validação do saque</h3><p className="config-help">Valores atuais já selecionados. Você pode editar ou desativar cada etapa. As taxas abaixo geram uma cobrança separada; as regras de desconto do saque ficam mais abaixo.</p>
        <div className="simple-fees-grid">{[["languageFirstWithdrawal","Primeiro saque com bônus",32.90],["kycApproval","Aprovação KYC",21.90],["accountApproval","Validação de conta PIX",19.67],["antiFraud","Análise antifraude",14.90],["liquidation","Liquidação PIX",9.90]].map(([key,label,value]) => {
          const id=String(key); const fee=form.validationFees?.[id] || { enabled:true, amount:value };
          return <div className="simple-fee" key={id}><label className="admin-field checkbox"><input type="checkbox" checked={fee.enabled !== false} onChange={e => set("validationFees", {...form.validationFees,[id]:{...fee,enabled:e.target.checked}})} /><span>{label}</span></label><label className="admin-field"><span>Valor em R$</span><input type="number" min="1" step="0.01" value={fee.amount} onChange={e => set("validationFees",{...form.validationFees,[id]:{...fee,amount:Number(e.target.value)}})} /></label><small>Padrão: R$ {Number(value).toFixed(2).replace('.',',')}</small></div>;
        })}</div>
      </section>
      <section data-settings-category="fees" className="admin-card config-section withdrawal-fees-admin">
        <div className="finance-card-head">
          <div>
            <span style={{ color: "#bf476e", fontWeight: 800, letterSpacing: "1px" }}>FUNIL DE CONVERSÃO & RETENÇÃO</span>
            <h3>Taxas de Saque & Regras Inteligentes</h3>
          </div>
          <div style={{ display: "flex", gap: "8px" }}>
            <button type="button" className="admin-secondary" onClick={addCustomFee}>
              <Plus size={14} /> Nova taxa personalizada
            </button>
          </div>
        </div>

        <p className="config-help">
          Configure quando cada taxa deve aparecer no funil de saque. As taxas podem ser ativadas por ocorrência (1º saque vs recorrente), faixas de valor, depósitos acumulados, tempo de conta, bônus resgatado, KYC ou horário.
        </p>

        {/* Quick Presets Bar */}
        <div style={{ marginBottom: "14px" }}>
          <span style={{ fontSize: "11px", fontWeight: 700, color: "#8a8590", display: "block", marginBottom: "6px" }}>
            Adicionar regras pré-definidas ao funil:
          </span>
          <div className="withdraw-fee-presets">
            <button type="button" onClick={() => addPresetFee("first_payout")}>
              1º Saque (Validação Cadastral)
            </button>
            <button type="button" onClick={() => addPresetFee("low_deposit")}>
              Antifraude (Baixo Depósito)
            </button>
            <button type="button" onClick={() => addPresetFee("bonus_release")}>
              Liberação de Bônus
            </button>
            <button type="button" onClick={() => addPresetFee("new_account")}>
              Conta Recente (&lt; 72h)
            </button>
            <button type="button" onClick={() => addPresetFee("high_payout")}>
              Saque Elevado (&gt; R$ 500)
            </button>
            <button type="button" onClick={() => addPresetFee("kyc_fee")}>
              KYC Pendente
            </button>
            <button type="button" onClick={() => addPresetFee("night_fee")}>
              Noturno / Fim de Semana
            </button>
          </div>
        </div>

        {/* Filter Bar */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
          <div style={{ display: "flex", gap: "6px" }}>
            <button
              type="button"
              className={`admin-tab-btn ${feeFilter === "ALL" ? "active" : ""}`}
              style={{
                padding: "4px 10px",
                fontSize: "11px",
                borderRadius: "6px",
                border: "1px solid rgba(255,255,255,.08)",
                background: feeFilter === "ALL" ? "#00b85c" : "#2a121c",
                color: "#17212f",
                fontWeight: feeFilter === "ALL" ? 800 : 500,
                cursor: "pointer"
              }}
              onClick={() => setFeeFilter("ALL")}
            >
              Todas ({feeRules.length})
            </button>
            <button
              type="button"
              className={`admin-tab-btn ${feeFilter === "ACTIVE" ? "active" : ""}`}
              style={{
                padding: "4px 10px",
                fontSize: "11px",
                borderRadius: "6px",
                border: "1px solid rgba(255,255,255,.08)",
                background: feeFilter === "ACTIVE" ? "#00b85c" : "#2a121c",
                color: "#17212f",
                fontWeight: feeFilter === "ACTIVE" ? 800 : 500,
                cursor: "pointer"
              }}
              onClick={() => setFeeFilter("ACTIVE")}
            >
              Ativas ({feeRules.filter((r: any) => r.enabled).length})
            </button>
            <button
              type="button"
              className={`admin-tab-btn ${feeFilter === "INACTIVE" ? "active" : ""}`}
              style={{
                padding: "4px 10px",
                fontSize: "11px",
                borderRadius: "6px",
                border: "1px solid rgba(255,255,255,.08)",
                background: feeFilter === "INACTIVE" ? "#00b85c" : "#2a121c",
                color: "#17212f",
                fontWeight: feeFilter === "INACTIVE" ? 800 : 500,
                cursor: "pointer"
              }}
              onClick={() => setFeeFilter("INACTIVE")}
            >
              Inativas ({feeRules.filter((r: any) => !r.enabled).length})
            </button>
          </div>
          <span style={{ fontSize: "11px", color: "#8a8590" }}>
            {feeRules.filter((r: any) => r.enabled).length} taxas ativas no sistema
          </span>
        </div>

        {/* List of Fee Cards */}
        <div className="withdraw-fee-rule-list">
          {feeRules
            .map((rule: any, index: number) => ({ rule, index }))
            .filter(({ rule }: any) => {
              if (feeFilter === "ACTIVE") return rule.enabled;
              if (feeFilter === "INACTIVE") return !rule.enabled;
              return true;
            })
            .map(({ rule, index }: any) => {
              const ruleId = rule.id || `fee_${index}`;
              const isExpanded = expandedFeeId === ruleId;
              const triggerType = rule.triggerType || "ALWAYS";

              return (
                <div className={`withdraw-fee-card ${rule.enabled ? "active" : ""}`} key={ruleId}>
                  {/* Top summary row */}
                  <div className="withdraw-fee-top-row">
                    <label className="fee-enable" style={{ margin: 0, cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={!!rule.enabled}
                        onChange={e => setFeeRule(index, { enabled: e.target.checked })}
                      />
                      <span style={{ fontWeight: 700, color: rule.enabled ? "#bf476e" : "#777" }}>
                        {rule.enabled ? "Ativa" : "Inativa"}
                      </span>
                    </label>

                    <div className="withdraw-fee-title-wrap">
                      <input
                        value={rule.label || ""}
                        placeholder="Nome da taxa (ex: Taxa de liberação)"
                        onChange={e => setFeeRule(index, { label: e.target.value })}
                      />
                      <input
                        className="fee-desc-input"
                        value={rule.description || ""}
                        placeholder="Descrição explicativa exibida ao jogador"
                        onChange={e => setFeeRule(index, { description: e.target.value })}
                      />
                    </div>

                    <div>
                      <select
                        className="withdraw-fee-type-select"
                        value={rule.type || "FIXED"}
                        onChange={e => setFeeRule(index, { type: e.target.value })}
                      >
                        <option value="FIXED">Valor fixo (R$)</option>
                        <option value="PERCENT">Percentual (%)</option>
                      </select>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                      <span style={{ fontSize: "11px", color: "#8a8590" }}>{rule.type === "PERCENT" ? "%" : "R$"}</span>
                      <input
                        className="withdraw-fee-val-input"
                        type="number"
                        min="0"
                        step={rule.type === "PERCENT" ? "0.1" : "1"}
                        value={rule.value ?? 0}
                        onChange={e => setFeeRule(index, { value: Number(e.target.value) })}
                      />
                    </div>

                    <div className="withdraw-fee-trigger-badge">
                      {triggerType === "ALWAYS" && "Sempre"}
                      {triggerType === "FIRST_WITHDRAWAL" && "1º Saque"}
                      {triggerType === "SUBSEQUENT_WITHDRAWALS" && "2º Saque+"}
                      {triggerType === "AMOUNT_RANGE" && "Faixa Valor"}
                      {triggerType === "LOW_DEPOSITS" && "Depósito Baixo"}
                      {triggerType === "HIGH_DEPOSITS" && "Depósito Alto"}
                      {triggerType === "NEW_ACCOUNT" && "Conta Nova"}
                      {triggerType === "LANGUAGE_BONUS" && "Com Bônus"}
                      {triggerType === "NON_INFLUENCER" && "Normal (Não VIP)"}
                      {triggerType === "UNVERIFIED_KYC" && "KYC Pendente"}
                      {triggerType === "CUSTOM" && "Custom"}
                    </div>

                    <div style={{ display: "flex", gap: "6px" }}>
                      <button
                        type="button"
                        className="withdraw-fee-expand-btn"
                        onClick={() => setExpandedFeeId(isExpanded ? null : ruleId)}
                      >
                        <Settings2 size={13} />
                        {isExpanded ? "Fechar" : "Regras"}
                        {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                      </button>
                      <button
                        type="button"
                        className="admin-secondary fee-remove"
                        style={{ padding: "0 8px", color: "#d96183" }}
                        onClick={() => removeFee(index)}
                        title="Remover taxa"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>

                  {/* Expandable Configuration Body */}
                  {isExpanded && (
                    <div className="withdraw-fee-config-body">
                      {/* Main Trigger Selector */}
                      <div className="withdraw-trigger-selector">
                        <div>
                          <span style={{ fontSize: "11px", fontWeight: 700, color: "#bf476e", display: "block" }}>
                            Gatilho Principal (Quando esta taxa deve aparecer?)
                          </span>
                          <small style={{ color: "#777", fontSize: "10px" }}>
                            Define a condição principal para o disparo da taxa no funil.
                          </small>
                        </div>
                        <select
                          className="withdraw-fee-type-select"
                          style={{ width: "100%" }}
                          value={triggerType}
                          onChange={e => setFeeRule(index, { triggerType: e.target.value })}
                        >
                          <option value="ALWAYS">Sempre aplicar (todos os saques)</option>
                          <option value="FIRST_WITHDRAWAL">Apenas no 1º saque do jogador</option>
                          <option value="SUBSEQUENT_WITHDRAWALS">Apenas a partir do 2º saque em diante</option>
                          <option value="AMOUNT_RANGE">Apenas para faixas específicas de valor do saque</option>
                          <option value="LOW_DEPOSITS">Apenas para jogadores com poucos depósitos (Antifraude)</option>
                          <option value="HIGH_DEPOSITS">Apenas para jogadores com depósitos elevados</option>
                          <option value="NEW_ACCOUNT">Apenas para contas criadas recentemente (ex: &lt; 72 horas)</option>
                          <option value="LANGUAGE_BONUS">Apenas para usuários que resgataram bônus</option>
                          <option value="NON_INFLUENCER">Apenas para jogadores comuns (Isentar influenciadores)</option>
                          <option value="UNVERIFIED_KYC">Apenas para contas com KYC pendente ou não aprovado</option>
                          <option value="CUSTOM">Combinação livre multi-variáveis (regras avançadas)</option>
                        </select>
                      </div>

                      {/* Detailed Variables Grid */}
                      <div className="withdraw-variables-grid">
                        <div className="withdraw-var-field">
                          <span>Ocorrência do Saque</span>
                          <select
                            value={rule.withdrawalOccurrence || "ALL"}
                            onChange={e => setFeeRule(index, { withdrawalOccurrence: e.target.value })}
                          >
                            <option value="ALL">Todos os saques</option>
                            <option value="FIRST_ONLY">Apenas no 1º saque</option>
                            <option value="SUBSEQUENT_ONLY">Apenas do 2º saque em diante</option>
                          </select>
                        </div>

                        <div className="withdraw-var-field">
                          <span>Valor Mínimo do Saque (R$)</span>
                          <input
                            type="number"
                            placeholder="Sem mínimo"
                            value={rule.minAmount ?? ""}
                            onChange={e => setFeeRule(index, { minAmount: e.target.value ? Number(e.target.value) : null })}
                          />
                        </div>

                        <div className="withdraw-var-field">
                          <span>Valor Máximo do Saque (R$)</span>
                          <input
                            type="number"
                            placeholder="Sem máximo"
                            value={rule.maxAmount ?? ""}
                            onChange={e => setFeeRule(index, { maxAmount: e.target.value ? Number(e.target.value) : null })}
                          />
                        </div>

                        <div className="withdraw-var-field">
                          <span>Depósitos Totais Mínimos (R$)</span>
                          <input
                            type="number"
                            placeholder="Sem mínimo"
                            value={rule.minTotalDeposits ?? ""}
                            onChange={e => setFeeRule(index, { minTotalDeposits: e.target.value ? Number(e.target.value) : null })}
                          />
                        </div>

                        <div className="withdraw-var-field">
                          <span>Depósitos Totais Máximos (R$)</span>
                          <input
                            type="number"
                            placeholder="Ex: 50 (Antifraude)"
                            value={rule.maxTotalDeposits ?? ""}
                            onChange={e => setFeeRule(index, { maxTotalDeposits: e.target.value ? Number(e.target.value) : null })}
                          />
                        </div>

                        <div className="withdraw-var-field">
                          <span>Qtd Mínima de Depósitos</span>
                          <input
                            type="number"
                            placeholder="Sem mínimo"
                            value={rule.minDepositCount ?? ""}
                            onChange={e => setFeeRule(index, { minDepositCount: e.target.value ? Number(e.target.value) : null })}
                          />
                        </div>

                        <div className="withdraw-var-field">
                          <span>Qtd Máxima de Depósitos</span>
                          <input
                            type="number"
                            placeholder="Sem máximo"
                            value={rule.maxDepositCount ?? ""}
                            onChange={e => setFeeRule(index, { maxDepositCount: e.target.value ? Number(e.target.value) : null })}
                          />
                        </div>

                        <div className="withdraw-var-field">
                          <span>Idade Máxima da Conta (Horas)</span>
                          <input
                            type="number"
                            placeholder="Ex: 72 (3 dias)"
                            value={rule.maxAccountAgeHours ?? ""}
                            onChange={e => setFeeRule(index, { maxAccountAgeHours: e.target.value ? Number(e.target.value) : null })}
                          />
                        </div>

                        <div className="withdraw-var-field">
                          <span>Dias da Semana</span>
                          <select
                            value={rule.scheduleDays || "ALL"}
                            onChange={e => setFeeRule(index, { scheduleDays: e.target.value })}
                          >
                            <option value="ALL">Todos os dias</option>
                            <option value="WEEKENDS">Apenas fins de semana (Sáb/Dom)</option>
                            <option value="WEEKDAYS">Apenas dias úteis (Seg-Sex)</option>
                          </select>
                        </div>
                      </div>

                      {/* Toggles */}
                      <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
                        <label className="withdraw-var-toggle">
                          <input
                            type="checkbox"
                            checked={!!rule.requireBonusClaimed}
                            onChange={e => setFeeRule(index, { requireBonusClaimed: e.target.checked })}
                          />
                          <span>Exigir que o usuário tenha resgatado bônus</span>
                        </label>
                        <label className="withdraw-var-toggle">
                          <input
                            type="checkbox"
                            checked={!!rule.nonInfluencerOnly}
                            onChange={e => setFeeRule(index, { nonInfluencerOnly: e.target.checked })}
                          />
                          <span>Isentar influenciadores / VIPs</span>
                        </label>
                        <label className="withdraw-var-toggle">
                          <input
                            type="checkbox"
                            checked={!!rule.requireUnapprovedKyc}
                            onChange={e => setFeeRule(index, { requireUnapprovedKyc: e.target.checked })}
                          />
                          <span>Apenas se KYC não estiver aprovado</span>
                        </label>
                        <label className="withdraw-var-toggle">
                          <input
                            type="checkbox"
                            checked={!!rule.scheduleNightOnly}
                            onChange={e => setFeeRule(index, { scheduleNightOnly: e.target.checked })}
                          />
                          <span>Apenas em horário noturno (22h às 06h)</span>
                        </label>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
        </div>

        {/* Live Interactive Funnel Simulator */}
        <div className="withdraw-simulator-shell">
          <div className="withdraw-simulator-head">
            <h4>
              <Zap size={16} color="#bf476e" />
              Simulador em Tempo Real do Funil de Saque
            </h4>
            <span style={{ fontSize: "11px", color: "#8a8590" }}>
              Altere os parâmetros do jogador e veja quais taxas são disparadas
            </span>
          </div>

          <div className="withdraw-simulator-inputs">
            <div className="withdraw-sim-field">
              <span>Valor Solicitado (R$)</span>
              <input
                type="number"
                value={simWithdrawAmount}
                onChange={e => setSimWithdrawAmount(Math.max(1, Number(e.target.value)))}
              />
            </div>
            <div className="withdraw-sim-field">
              <span>Ocorrência de Saque</span>
              <select
                value={simWithdrawOccurrence}
                onChange={e => setSimWithdrawOccurrence(e.target.value as any)}
              >
                <option value="FIRST">1º Saque do jogador</option>
                <option value="SUBSEQUENT">2º Saque em diante (Recorrente)</option>
              </select>
            </div>
            <div className="withdraw-sim-field">
              <span>Total Depositado (R$)</span>
              <input
                type="number"
                value={simUserDeposits}
                onChange={e => setSimUserDeposits(Number(e.target.value))}
              />
            </div>
            <div className="withdraw-sim-field">
              <span>Qtd de Depósitos</span>
              <input
                type="number"
                value={simUserDepositCount}
                onChange={e => setSimUserDepositCount(Number(e.target.value))}
              />
            </div>
            <div className="withdraw-sim-field">
              <span>Idade da Conta (Horas)</span>
              <input
                type="number"
                value={simUserAccountAge}
                onChange={e => setSimUserAccountAge(Number(e.target.value))}
              />
            </div>
            <div className="withdraw-sim-field">
              <span>Status do KYC</span>
              <select
                value={simUserKycStatus}
                onChange={e => setSimUserKycStatus(e.target.value)}
              >
                <option value="UNVERIFIED">Não Verificado / Pendente</option>
                <option value="APPROVED">Aprovado</option>
              </select>
            </div>
          </div>

          <div style={{ display: "flex", gap: "14px", flexWrap: "wrap", marginBottom: "14px" }}>
            <label className="withdraw-var-toggle">
              <input
                type="checkbox"
                checked={simUserBonusClaimed}
                onChange={e => setSimUserBonusClaimed(e.target.checked)}
              />
              <span>Usuário resgatou bônus</span>
            </label>
            <label className="withdraw-var-toggle">
              <input
                type="checkbox"
                checked={simUserInfluencer}
                onChange={e => setSimUserInfluencer(e.target.checked)}
              />
              <span>É influenciador / VIP</span>
            </label>
            <label className="withdraw-var-toggle">
              <input
                type="checkbox"
                checked={simIsNight}
                onChange={e => setSimIsNight(e.target.checked)}
              />
              <span>Horário noturno (22h - 06h)</span>
            </label>
            <label className="withdraw-var-toggle">
              <input
                type="checkbox"
                checked={simIsWeekend}
                onChange={e => setSimIsWeekend(e.target.checked)}
              />
              <span>Fim de semana</span>
            </label>
          </div>

          {/* Simulation Output */}
          <div className="withdraw-sim-results">
            <div style={{ fontSize: "12px", fontWeight: 700, color: "#17212f", marginBottom: "4px" }}>
              Resultado do Funil para este Saque ({evaluatedSimFees.activeApplied.length} taxas disparadas):
            </div>

            {evaluatedSimFees.activeApplied.length === 0 ? (
              <div style={{ fontSize: "12px", color: "#8a8590", padding: "8px 0" }}>
                Nenhuma taxa ativada para este perfil de saque (Taxa total: R$ 0,00).
              </div>
            ) : (
              evaluatedSimFees.activeApplied.map(({ rule, fee }: any) => (
                <div className="withdraw-sim-fee-item" key={rule.id}>
                  <div>
                    <span style={{ fontWeight: 700, color: "#17212f" }}>{rule.label}</span>
                    <span style={{ fontSize: "10px", color: "#8a8590", marginLeft: "6px" }}>
                      ({rule.type === "PERCENT" ? `${rule.value}%` : `R$ ${rule.value.toFixed(2)}`})
                    </span>
                    {rule.description && (
                      <small style={{ display: "block", color: "#777", fontSize: "10px" }}>{rule.description}</small>
                    )}
                  </div>
                  <div style={{ fontWeight: 800, color: "#d96183" }}>
                    - R$ {fee.toFixed(2)}
                  </div>
                </div>
              ))
            )}

            <div className="withdraw-sim-summary">
              <div>
                <span>Valor Solicitado: <b>R$ {Number(simWithdrawAmount).toFixed(2)}</b></span>
                <span style={{ marginLeft: "14px", color: "#d96183" }}>
                  Total de Taxas: <b>- R$ {evaluatedSimFees.totalFees.toFixed(2)}</b>
                </span>
              </div>
              <div style={{ color: "#22c55e", fontSize: "14px" }}>
                Valor Líquido a Receber: <b>R$ {evaluatedSimFees.netAmount.toFixed(2)}</b>
              </div>
            </div>
          </div>
        </div>

        <div className="admin-note" style={{ marginTop: "14px" }}>
          <ShieldCheck />
          <div>
            <b>Transparência e Controle Total do Funil</b>
            <p>
              O backend valida rigorosamente as regras na prévia e no envio do saque. Cada transação salva a discriminação exata das taxas aplicadas e o valor líquido a pagar.
            </p>
          </div>
        </div>
      </section>

      <section data-settings-category="general" className="admin-card config-section">
        <h3>Links</h3>
        <label className="admin-field"><span>Suporte</span><input value={form.supportUrl || ""} onChange={e => set("supportUrl", e.target.value)} /></label>
        <label className="admin-field"><span>Termos</span><input value={form.termsUrl || ""} onChange={e => set("termsUrl", e.target.value)} /></label>
        <label className="admin-field"><span>Privacidade</span><input value={form.privacyUrl || ""} onChange={e => set("privacyUrl", e.target.value)} /></label>
        <label className="admin-field"><span>Jogo responsável</span><input value={form.responsibleGamingUrl || ""} onChange={e => set("responsibleGamingUrl", e.target.value)} /></label>
      </section>
    </div>}
    {msg && <div role="status" className="admin-message">{msg}</div>}
  </>;
}
