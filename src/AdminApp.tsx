import { supabaseEnabled } from './lib/supabase';
import { Component, useEffect, useState, lazy, Suspense, type ErrorInfo, type ReactNode } from "react";
import {
  Bell, ChevronRight, Gamepad2, Gift, Headphones, Image, LayoutDashboard,
  ListChecks, LogOut, Megaphone, Menu, RefreshCw, Server, Settings,
  ShieldAlert, ShieldCheck, Sparkles, Target, UserCheck, UserCog, Users,
  Wallet, X, Smartphone, Trophy, CreditCard, Palette, FileBarChart
} from "lucide-react";
import type { User } from "firebase/auth";
import { subscribeAuth, logout } from "./lib/auth";
import { adminApi } from "./lib/adminApi";
import AuthPage from "./pages/AuthPage";
import { AdminLazyFallback } from "./pages/admin/AdminComponents";

// Lazy-loaded administrative sub-pages
const Dashboard = lazy(() => import("./pages/admin/DashboardPage"));
const UsersPage = lazy(() => import("./pages/admin/UsersPage"));
const KycPage = lazy(() => import("./pages/admin/KycPage"));
const FinancePage = lazy(() => import("./pages/admin/FinancePage"));
const DotfyPage = lazy(() => import("./pages/admin/DotfyPage"));
const GamesAdmin = lazy(() => import("./pages/admin/GamesAdminPage"));
const PromotionsPage = lazy(() => import("./pages/admin/PromotionsPage"));
const BonusesPage = lazy(() => import("./pages/admin/BonusesPage"));
const AffiliatesPage = lazy(() => import("./pages/admin/AffiliatesPage"));
const NotificationsPage = lazy(() => import("./pages/admin/NotificationsPage"));
const SupportPage = lazy(() => import("./pages/admin/SupportPage"));
const TrackingPage = lazy(() => import("./pages/admin/TrackingPage"));
const WhatsAppPage = lazy(() => import("./pages/admin/WhatsAppPage"));
const WinnersAdminPage = lazy(() => import("./pages/admin/WinnersAdminPage"));
const ExperimentsPage = lazy(() => import("./pages/admin/ExperimentsPage"));
const HomeBuilderPage = lazy(() => import("./pages/admin/HomeBuilderPage"));
const VisualBuilderPage = lazy(() => import("./pages/admin/VisualBuilderPage"));
const RiskPage = lazy(() => import("./pages/admin/RiskPage"));
const ReportsPage = lazy(() => import("./pages/admin/ReportsPage"));
const IgamewinPage = lazy(() => import("./pages/admin/IgamewinPage"));
const ResponsibleAdminPage = lazy(() => import("./pages/admin/ResponsibleAdminPage"));
const StaffPage = lazy(() => import("./pages/admin/StaffPage"));
const SettingsPage = lazy(() => import("./pages/admin/SettingsPage"));
const AuditPage = lazy(() => import("./pages/admin/AuditPage"));

type Section =
  | "dashboard" | "users" | "kyc" | "finance" | "games" | "promotions"
  | "bonuses" | "affiliates" | "notifications" | "support" | "risk"
  | "reports" | "igamewin" | "responsible" | "dotfy" | "tracking" | "whatsapp" | "winners" | "experiments" | "homebuilder" | "visualbuilder" | "staff" | "settings" | "audit";

const ADMIN_PREFETCH: Partial<Record<Section, string[]>> = {
  dashboard: ["/api/admin/dashboard", "/api/admin/finance/dashboard", "/api/admin/operations/health"],
  users: ["/api/admin/users?limit=ALL"],
  finance: ["/api/admin/payments", "/api/admin/finance/dashboard"],
  dotfy: ["/api/admin/dotfy/config"],
  kyc: ["/api/admin/kyc"],
  risk: ["/api/admin/risk"],
  support: ["/api/admin/support"],
  promotions: ["/api/admin/banner-campaigns"],
  bonuses: ["/api/admin/bonuses"],
  affiliates: ["/api/admin/affiliates"],
  notifications: ["/api/admin/notifications"],
  reports: ["/api/admin/reports"],
  responsible: ["/api/admin/responsible-gaming"],
  winners: ["/api/admin/winners/config", "/api/admin/winners/demo"],
  experiments: ["/api/admin/experiments"],
  homebuilder: ["/api/admin/home-layout"],
  visualbuilder: ["/api/admin/configuration", "/api/admin/home-layout"],
  staff: ["/api/admin/staff"],
  settings: ["/api/admin/configuration"],
  audit: ["/api/admin/audit"],
  tracking: ["/api/admin/integrations/tracking"],
  whatsapp: ["/api/admin/whatsapp/status", "/api/admin/whatsapp/campaigns"],
};

function prefetchAdminSection(section: Section) {
  for (const url of ADMIN_PREFETCH[section] || []) adminApi(url).catch(() => {});
}

export default function AdminApp() {
  const [user, setUser] = useState<User | null>(null);
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [adminAccessError, setAdminAccessError] = useState("");
  const validSections: Section[] = [
    "dashboard", "users", "kyc", "finance", "games", "promotions", "bonuses",
    "affiliates", "notifications", "support", "risk", "reports", "igamewin",
    "responsible", "dotfy", "tracking", "whatsapp", "winners", "experiments",
    "homebuilder", "visualbuilder", "staff", "settings", "audit"
  ];
  const initialSection = (() => {
    let raw = String(location.hash || "").replace(/^#admin\/?/, "").replace(/^#/, "") as any;
    if (raw === "payonpag") raw = "dotfy";
    return validSections.includes(raw) ? raw : "dashboard";
  })();
  const [section, setSectionState] = useState<Section>(initialSection);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [readiness, setReadiness] = useState<any>(null);
  const [runtimeError, setRuntimeError] = useState("");
  const [navigating, setNavigating] = useState(false);
  const sectionNames: Record<Section, string> = {
    dashboard:"Visão geral", users:"Jogadores", kyc:"KYC", finance:"Financeiro", games:"Jogos",
    promotions:"Banners", bonuses:"Bônus", affiliates:"Afiliados", notifications:"Notificações",
    support:"Suporte", risk:"Risco & Fraude", reports:"Relatórios", igamewin:"iGameWin",
    responsible:"Jogo responsável", dotfy:"PIX Dotfy", tracking:"Ads & Tracking", whatsapp:"WhatsApp CRM",
    winners:"Vencedores", experiments:"Easter Eggs", homebuilder:"Home Builder", visualbuilder:"Design Studio",
    staff:"Equipe", settings:"Configurações", audit:"Auditoria"
  };

  const setSection = (next: Section) => {
    if (next === section) return;
    setNavigating(true);
    setSectionState(next);
    history.replaceState(null, "", `${location.pathname}${location.search}#admin/${next}`);
    window.setTimeout(() => setNavigating(false), 320);
  };

  useEffect(() => subscribeAuth(next => {
    setUser(next);
    setLoadingAuth(false);
  }), []);

  useEffect(() => {
    const onHash = () => {
      const raw = String(location.hash || "").replace(/^#admin\/?/, "").replace(/^#/, "") as Section;
      if (validSections.includes(raw)) setSectionState(raw);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    const onUnhandled = (event: PromiseRejectionEvent) => {
      const reason: any = event.reason;
      if (!reason) {
        event.preventDefault();
        return;
      }
      const name = String(reason?.name || "");
      const code = String(reason?.code || "");
      if (name === "AbortError" || code === "API_TIMEOUT" || code === "AUTH_REQUIRED") {
        event.preventDefault();
        return;
      }
      const message = reason?.message || (typeof reason === "string" ? reason : "");
      console.warn("[admin caught unhandled rejection]", reason);
      if (message && message !== "[object Object]") {
        setRuntimeError(message);
      }
      event.preventDefault();
    };
    const onError = (event: ErrorEvent) => {
      if (event.error?.message) setRuntimeError(event.error.message);
    };
    window.addEventListener("unhandledrejection", onUnhandled);
    window.addEventListener("error", onError);
    return () => {
      window.removeEventListener("unhandledrejection", onUnhandled);
      window.removeEventListener("error", onError);
    };
  }, []);

  useEffect(() => {
    if (!user) {
      setAllowed(null);
      setReadiness(null);
      setAdminAccessError("");
      return;
    }

    let cancelled = false;
    let validationTimer: ReturnType<typeof setTimeout> | undefined;

    async function validateAdmin() {
      setAllowed(null);
      setAdminAccessError("");

      try {
        // The API owns the single controlled refresh on HTTP 401.
        // Forcing refresh here emits TOKEN_REFRESHED and used to restart this effect.
        await Promise.race([
          adminApi("/api/admin/me"),
          new Promise<never>((_, reject) => {
            validationTimer = setTimeout(() => reject(new Error("A validação demorou demais. Recarregue a página e tente novamente.")), 20000);
          }),
        ]);
        clearTimeout(validationTimer);
        if (cancelled) return;

        setAllowed(true);
        if(!supabaseEnabled) adminApi<any>("/api/admin/bootstrap-defaults", { method: "POST" })
          .catch(error => console.warn("[bootstrap defaults]", error?.code || error?.message || error));
        adminApi<any>("/api/admin/system-readiness")
          .then(data => { if (!cancelled) setReadiness(data); })
          .catch(() => {});
      } catch (error: any) {
        if (cancelled) return;
        const code = String(error?.code || "");
        const status = Number(error?.status || 0);

        if (status === 403 || code === "ADMIN_REQUIRED") {
          setAdminAccessError(supabaseEnabled ? "Sua conta não possui a função admin no Supabase." : "Sua conta está autenticada, mas não está cadastrada em ADMIN_EMAILS ou ADMIN_UIDS no servidor.");
        } else if (code === "FIREBASE_ADMIN_NOT_CONFIGURED" || code === "ADMIN_AUTH_BACKEND_UNAVAILABLE" || status === 503) {
          setAdminAccessError(supabaseEnabled ? "Não foi possível consultar sua permissão no Supabase. Confira o banco e a configuração do servidor." : "O Firebase Admin ainda não está configurado corretamente na VPS. Configure FIREBASE_SERVICE_ACCOUNT_JSON ou GOOGLE_APPLICATION_CREDENTIALS e reinicie o backend.");
        } else if (status === 401) {
          setAdminAccessError("Sua sessão está inválida ou expirou. Saia e entre novamente com sua conta de administrador.");
        } else {
          setAdminAccessError(error?.message || "Não foi possível validar o acesso administrativo.");
        }
        setAllowed(false);
      } finally {
        clearTimeout(validationTimer);
      }
    }

    void validateAdmin();
    return () => { cancelled = true; clearTimeout(validationTimer); };
  }, [user?.uid]);

  if (loadingAuth) return <div className="admin-loading">Carregando painel...</div>;
  if (!user) return <AuthPage />;
  if (allowed === null) return <div className="admin-loading">Validando permissão administrativa...</div>;
  if (!allowed) return <AccessDenied message={adminAccessError} />;

  return (
    <div className="admin-shell">
      <AdminSidebar section={section} setSection={setSection} navigating={navigating} mobile={mobileMenu} close={() => setMobileMenu(false)} />
      <div className="admin-main">
        <header className="admin-topbar">
          <button className="admin-mobile-menu" onClick={() => setMobileMenu(true)}><Menu size={20}/></button>
          <div className="admin-topbar-brand"><div><span>Painel de gestão</span><strong>{sectionNames[section]}</strong></div></div>
          <div className="admin-top-actions">
            <span className="admin-live-status"><i/> Operação online</span>
            <a
              className="admin-view-site"
              href={typeof window !== "undefined" && window.location.hostname.startsWith("admin.") ? (window.location.hostname.includes("borah.bet") ? "https://borah.bet" : `${window.location.protocol}//${window.location.hostname.replace(/^admin\./, "")}`) : "/"}
            >
              Ver plataforma <ChevronRight size={14}/>
            </a>
            <button title="Notificações" onClick={() => setSection("notifications")}><Bell size={18}/></button>
            <button onClick={() => logout()} title="Sair"><LogOut size={18}/></button>
          </div>
        </header>
        {navigating && <div className="admin-route-progress"><i/></div>}

        {runtimeError && (
          <div className="admin-runtime-error">
            <ShieldAlert size={15}/>
            <div><b>Uma operação falhou</b><span>{runtimeError}</span></div>
            <button onClick={() => setRuntimeError("")}><X size={14}/></button>
          </div>
        )}

        {readiness && !readiness.checks?.firestoreAdmin && (
          <div className="admin-readiness-warning">
            <ShieldAlert size={16}/>
            <div>
              <b>Acesso Admin liberado</b>
              <span>O backend reconheceu sua conta. Algumas operações privilegiadas do Firebase Auth/Firestore podem exigir Service Account no servidor.</span>
            </div>
            <span className="admin-readiness-badge">ADMIN OK</span>
          </div>
        )}

        <main className={`admin-content ${navigating ? "is-navigating" : ""}`}>
          <AdminSectionBoundary key={section} section={section} onRecover={() => setSection("dashboard")}>
            <Suspense fallback={<AdminLazyFallback />}>
              {section === "dashboard" && <div className="admin-quick-controls"><div><b>Sua plataforma, do seu jeito</b><span>Acesse os controles mais usados.</span></div><button onClick={() => setSection("promotions")}><Image size={17}/> Trocar banners</button><button onClick={() => setSection("visualbuilder")}><Palette size={17}/> Cores e logo</button><button onClick={() => setSection("settings")}><Settings size={17}/> Taxas e limites</button></div>}
              {section === "dashboard" && <Dashboard />}
              {section === "users" && <UsersPage />}
              {section === "kyc" && <KycPage />}
              {section === "finance" && <FinancePage />}
              {section === "dotfy" && <DotfyPage />}
              {section === "games" && <GamesAdmin />}
              {section === "promotions" && <PromotionsPage />}
              {section === "bonuses" && <BonusesPage />}
              {section === "affiliates" && <AffiliatesPage />}
              {section === "notifications" && <NotificationsPage />}
              {section === "support" && <SupportPage />}
              {section === "tracking" && <TrackingPage />}
              {section === "whatsapp" && <WhatsAppPage />}
              {section === "winners" && <WinnersAdminPage />}
              {section === "experiments" && <ExperimentsPage />}
              {section === "homebuilder" && <HomeBuilderPage />}
              {section === "visualbuilder" && <VisualBuilderPage />}
              {section === "risk" && <RiskPage />}
              {section === "reports" && <ReportsPage />}
              {section === "igamewin" && <IgamewinPage />}
              {section === "responsible" && <ResponsibleAdminPage />}
              {section === "staff" && <StaffPage />}
              {section === "settings" && <SettingsPage />}
              {section === "audit" && <AuditPage />}
            </Suspense>
          </AdminSectionBoundary>
        </main>
      </div>
    </div>
  );
}

class AdminSectionBoundary extends Component<
  { children: ReactNode; section: string; onRecover: () => void },
  { error: Error | null; details: string }
> {
  state = { error: null as Error | null, details: "" };

  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[Admin section crash: ${this.props.section}]`, error, info);
    this.setState({ details: info.componentStack || "" });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="admin-section-crash">
        <div className="admin-section-crash-icon"><ShieldAlert size={28}/></div>
        <span>RECUPERAÇÃO AUTOMÁTICA</span>
        <h2>Esta área encontrou um erro</h2>
        <p>O painel continua funcionando. Tente recarregar somente esta área ou volte para a visão geral.</p>
        <code>{this.state.error.message || "Erro inesperado"}</code>
        <div>
          <button className="admin-primary" onClick={() => this.setState({ error: null, details: "" })}><RefreshCw size={14}/> Tentar novamente</button>
          <button className="admin-secondary" onClick={this.props.onRecover}>Ir para visão geral</button>
        </div>
      </div>
    );
  }
}

function AccessDenied({ message }: { message?: string }) {
  return (
    <div className="admin-denied">
      <ShieldCheck size={42}/>
      <h1>Acesso administrativo necessário</h1>
      <p>{message || "Sua conta não possui permissão administrativa."}</p>
      <a href="/">Voltar para a plataforma</a>
    </div>
  );
}

function AdminSidebar({
  section,
  setSection,
  navigating,
  mobile,
  close
}: {
  section: Section;
  setSection: (s: Section) => void;
  navigating: boolean;
  mobile: boolean;
  close: () => void;
}) {
  const [navSearch, setNavSearch] = useState("");
  const groups: { title: string; items: [Section, any, string, string][] }[] = [
    { title: "OPERAÇÃO", items: [
      ["dashboard", LayoutDashboard, "Visão geral", "Métricas e operação"],
      ["users", Users, "Jogadores", "Contas e carteiras"],
      ["kyc", UserCheck, "KYC", "Validação de usuários"],
      ["finance", Wallet, "Financeiro", "Depósitos e saques"],
      ["dotfy", CreditCard, "PIX Dotfy", "Cobranças PIX & webhook"],
      ["risk", ShieldAlert, "Risco & Fraude", "Sinais e restrições"],
    ]},
    { title: "PRODUTO", items: [
      ["games", Gamepad2, "Jogos", "Catálogo e ordem"],
      ["winners", Trophy, "Vencedores", "Feed real ou demo"],
      ["experiments", Sparkles, "Easter Eggs", "Experimentos e recompensas"],
      ["homebuilder", LayoutDashboard, "Home Builder", "Ordem das seções"],
      ["visualbuilder", Palette, "Aparência", "Cores, logo e layout"],
      ["promotions", Image, "Banners", "Campanhas visuais"],
      ["bonuses", Gift, "Bônus", "Regras promocionais"],
      ["affiliates", Users, "Afiliados", "RevShare e performance"],
    ]},
    { title: "RELACIONAMENTO", items: [
      ["notifications", Megaphone, "Notificações", "Campanhas e avisos"],
      ["tracking", Target, "Ads & Tracking", "Meta, TikTok e Google"],
      ["whatsapp", Smartphone, "WhatsApp CRM", "Baileys e campanhas"],
      ["support", Headphones, "Suporte", "Tickets"],
    ]},
    { title: "GESTÃO", items: [
      ["reports", FileBarChart, "Relatórios", "Financeiro e jogos"],
      ["responsible", ShieldCheck, "Jogo responsável", "Limites e autoexclusão"],
      ["igamewin", Server, "iGameWin", "Status e catálogo"],
      ["staff", UserCog, "Equipe", "Cargos e acessos"],
      ["settings", Settings, "Configurações", "Taxas, limites e personalização"],
      ["audit", ListChecks, "Auditoria", "Histórico de ações"],
    ]},
  ];

  return (
    <aside className={`admin-sidebar admin-sidebar-v11 ${mobile ? "open" : ""}`}>
      <div className="admin-sidebar-brand">
        <span className="admin-saas-brand"><img src="/brand/trevo-da-sorte-logo.svg" alt="Trevo da Sorte" style={{width:150,height:50,objectFit:"contain"}}/><small>ADMIN</small></span>
        <button onClick={close}><X size={18}/></button>
      </div>
      <label className="admin-nav-search"><span>⌕</span><input value={navSearch} onChange={e => setNavSearch(e.target.value)} placeholder="Buscar controles..." aria-label="Buscar controles do painel"/></label>
      <nav>
        {groups.map(group => ({...group, items: group.items.filter(([, , title, sub]) => `${title} ${sub}`.toLocaleLowerCase("pt-BR").includes(navSearch.toLocaleLowerCase("pt-BR")))})).filter(group => group.items.length).map(group => (
          <div className="admin-nav-group" key={group.title}>
            <span className="admin-nav-title">{group.title}</span>
            {group.items.map(([id, Icon, title, sub]) => (
              <button
                key={id}
                aria-current={section === id ? "page" : undefined}
                className={`${section === id ? "active" : ""} ${navigating && section === id ? "nav-loading" : ""}`}
                onPointerEnter={() => prefetchAdminSection(id)}
                onFocus={() => prefetchAdminSection(id)}
                onPointerDown={(e) => e.currentTarget.classList.add("pressed")}
                onPointerUp={(e) => e.currentTarget.classList.remove("pressed")}
                onPointerLeave={(e) => e.currentTarget.classList.remove("pressed")}
                onClick={() => { setSection(id); close(); }}
              >
                <Icon size={18}/>
                <span><b>{title}</b><small>{sub}</small></span>
              </button>
            ))}
          </div>
        ))}
        {navSearch && !groups.some(group => group.items.some(([, , title, sub]) => `${title} ${sub}`.toLocaleLowerCase("pt-BR").includes(navSearch.toLocaleLowerCase("pt-BR")))) && <p className="admin-nav-empty">Nenhum controle encontrado.</p>}
      </nav>
      <div className="admin-sidebar-foot">
        <span className="online-dot"/>
        <div><b>Sistema operacional</b><small>Firebase + iGameWin</small></div>
      </div>
    </aside>
  );
}
