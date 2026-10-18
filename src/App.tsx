import ResetPasswordPage from './pages/ResetPasswordPage';
import { supabaseEnabled } from './lib/supabase';
import { providerLogoAssets } from "./lib/providerLogos";
import { getBrandedGameCover } from "./lib/gameArtwork";
import { useEffect, useMemo, useDeferredValue, useRef, useState, useCallback, type TouchEvent, type ReactNode } from 'react';
import type { User } from 'firebase/auth';
import {
  Bell, ChevronRight, ChevronLeft, CircleUserRound, Crown, Gift, Heart, Home, Search, Wallet, Gamepad2,
  X, Menu, MessageSquare, Maximize2, Minimize2, RefreshCw, AlertCircle, AlertTriangle, ExternalLink,
  ArrowDownToLine, ArrowUpFromLine, History, Headphones, LogOut, ShieldCheck,
  SlidersHorizontal, Star, Clock3, Trophy, ChevronDown, UserCheck, KeyRound, Network, Megaphone, ShieldAlert, Copy, CheckCircle2, Languages,
  Camera, FileText, Lock, Upload, Check, Info, Flame, Zap, Sparkles, Layers, RotateCcw
} from 'lucide-react';
import { subscribeAuth, logout, getCachedPaymentIdentity, cachePaymentIdentity } from './lib/auth';
import { trackMarketingEvent } from './lib/marketing';
import { firebaseConfigured, storage } from './lib/firebase';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import {
  ensureUserProfile, subscribeProfile, toggleFavorite, getFavoriteKeys,
  subscribeGameTransactions, subscribePaymentRequests, createSupportTicket,
  subscribeUserNotifications, markNotificationRead, subscribeBonuses, updateUserProfile,
  saveResponsibleLimits, createSelfExclusion, createAffiliateProfile, subscribeAffiliate, subscribeHomeLayout, subscribePublicBanners, subscribePublicWinners,
  subscribeSystemSettings, subscribeThemeConfig, formatAccountId,
  claimLanguageBonusClient, isInfluencerUser, type UserProfile
} from './lib/data';
import {
  fetchIgamewinGames, fetchIgamewinProviders, getCachedGames, getCachedProviders,
  type IGameWinGame, type IGameWinProvider
} from './lib/igamewin';
import AuthPage from './pages/AuthPage';
import { subscribeRuntimeSettings, mirrorRuntimeUser } from './lib/runtimeDb';
import { apiErrorMessage } from "./lib/apiError";
import { initAffiliateTracking } from "./lib/affiliateTracking";

const casinoIcons = {
  casino: '/icons/casino-game.svg',
  slots: '/icons/slot-machine.svg',
  chip: '/icons/poker-chip.svg',
  winner: '/icons/slot-winner.svg',
};

type Tab = 'home' | 'games' | 'promos' | 'deposit' | 'wallet' | 'history' | 'bonuses' | 'notifications' | 'affiliate' | 'responsible' | 'security' | 'profile';
type LobbyMode = 'all' | 'favorites' | 'recent';

function SvgIcon({ src, size = 18 }: { src: string; size?: number }) {
  return <img className="svg-casino-icon" src={src} width={size} height={size} alt="" />;
}

function BrandLogo({ className = "" }: { className?: string }) {
  const theme = (window as any).__AMORA_VISUAL_THEME__ || {};
  const [src, setSrc] = useState(String(theme.logoUrl || "/brand/trevo-da-sorte-logo.svg"));
  const name = String(theme.brandName || "Trevo da Sorte");

  useEffect(() => {
    if (theme.logoUrl) {
      setSrc(theme.logoUrl);
    }
  }, [theme.logoUrl]);

  return (
    <img
      className={`brand-logo-image ${className}`.trim()}
      src={src}
      alt={name}
      onError={() => {
        if (src !== "/brand/trevo-da-sorte-logo.svg") {
          setSrc("/brand/trevo-da-sorte-logo.svg");
        }
      }}
    />
  );
}

function applyVisualTheme(theme:any){
  const t={...(theme||{})};
  if(/nacional\s*bet|zero\s*bet/i.test(String(t.brandName||'')))t.brandName='Trevo da Sorte';
  if(/nacionalbet|zerobet/i.test(String(t.logoUrl||'')))t.logoUrl='/brand/trevo-da-sorte-logo.svg';
  if(/^(#f50046|#ff4778|#fa0862|#ed0055)$/i.test(String(t.primaryColor||'')))t.primaryColor='#00b85c';
  if (!t.brandName || /borah|amora|can.rio|resenha|playzada/i.test(t.brandName)) t.brandName='Trevo da Sorte';
  if (!t.logoUrl || /borah|amora|canario|logoresenha|logoplayzada/i.test(t.logoUrl)) t.logoUrl='/brand/trevo-da-sorte-logo.svg';
  (window as any).__AMORA_VISUAL_THEME__=t;
  const root=document.documentElement;
  const primary = (t.primaryColor && t.primaryColor !== '#00b85c') ? String(t.primaryColor) : '#00b85c';
  const buttonText = (primary === '#00b85c' && (!t.buttonTextColor || t.buttonTextColor === '#000000')) ? '#ffffff' : String(t.buttonTextColor || '#ffffff');
  root.style.setProperty('--amora-primary', primary);
  root.style.setProperty('--amora-bg',String(t.backgroundColor||'#000000'));
  root.style.setProperty('--amora-surface',String(t.surfaceColor||'#111111'));
  root.style.setProperty('--amora-surface-alt',String(t.surfaceAltColor||'#1b1b1b'));
  root.style.setProperty('--amora-text',String(t.textColor||'#f7f5f8'));
  root.style.setProperty('--amora-muted',String(t.mutedColor||'#8f8993'));
  root.style.setProperty('--amora-border',String(t.borderColor||'rgba(255,255,255,.07)'));
  root.style.setProperty('--amora-button-text', buttonText);
  root.style.setProperty('--pink', primary);
  root.style.setProperty('--pink2', '#36e68b');
  root.style.setProperty('--amora-radius',`${Number(t.borderRadius??14)}px`);
  root.style.setProperty('--amora-card-radius',`${Number(t.cardRadius??12)}px`);
  root.style.setProperty('--amora-game-ratio',String(t.gameCardRatio||'1:1').replace(':',' / '));
  root.dataset.amoraNavStyle=String(t.navStyle||'FLOATING').toLowerCase();
  root.dataset.amoraCompact=t.compactMode?'true':'false';
}

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [serverBalance, setServerBalance] = useState<number | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('home');
  const [launchPromotionOpen, setLaunchPromotionOpen] = useState(true);
  const [games, setGames] = useState<IGameWinGame[]>(() => getCachedGames());
  const [providers, setProviders] = useState<IGameWinProvider[]>(() => getCachedProviders());
  const [catalogLoading, setCatalogLoading] = useState<boolean>(() => getCachedGames().length === 0);
  const [catalogError, setCatalogError] = useState('');
  const [selectedProvider, setSelectedProvider] = useState('ALL');
  const [selectedGame, setSelectedGame] = useState<IGameWinGame | null>(null);
  const [playingGame, setPlayingGame] = useState<IGameWinGame | null>(null);
  const [playingDemo, setPlayingDemo] = useState(false);
  const [search, setSearch] = useState('');
  const deferredSearch=useDeferredValue(search);
  const [menuOpen, setMenuOpen] = useState(false);
  const [favoriteKeys, setFavoriteKeys] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<LobbyMode>('all');
  const [supportOpen, setSupportOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [kycOpen, setKycOpen] = useState(false);
  const [systemSettings, setSystemSettings] = useState<any>({});
  const [languageOpen, setLanguageOpen] = useState(false);
  const [languageLocale, setLanguageLocale] = useState<'BR'|'RU'|'JP'>('BR');
  const [depositPresetAmount, setDepositPresetAmount] = useState<string>('');

  useEffect(() => {
    initAffiliateTracking();
  }, []);

  useEffect(() => subscribeAuth(async next => {
    setUser(next);
    setAuthLoading(false);
    if (next) await ensureUserProfile(next.uid, next.email, next.displayName);
  }), []);

  useEffect(() => {
    setLanguageLocale('BR');
  }, [user?.uid]);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [tab]);

  useEffect(() => {
    if (!user) { setProfile(null); setFavoriteKeys(new Set()); return; }
    const unsub = subscribeProfile(user.uid, (p) => {
      setProfile(p);
      if (p && (p.walletBalance !== undefined || p.balance !== undefined)) {
        const bal = Number(p.walletBalance ?? p.balance ?? 0);
        setServerBalance(bal);
      }
    });
    getFavoriteKeys(user.uid).then(setFavoriteKeys).catch(() => {});
    return unsub;
  }, [user]);

  const refreshWallet = useCallback(async () => {
    if (!user || supabaseEnabled) return;
    try {
      const token = await user.getIdToken();
      const r = await fetch('/api/wallet/summary', {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store'
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok) {
        if (Number.isFinite(Number(d.walletBalance))) {
          setServerBalance(Number(d.walletBalance));
        }
        if (d.influencer !== undefined) {
          setProfile(prev => {
            if (prev) {
              return {
                ...prev,
                influencer: Boolean(d.influencer),
                walletBalance: Number.isFinite(Number(d.walletBalance)) ? Number(d.walletBalance) : prev.walletBalance,
                balance: Number.isFinite(Number(d.balance)) ? Number(d.balance) : prev.balance,
                realBalance: Number.isFinite(Number(d.realBalance)) ? Number(d.realBalance) : (prev as any).realBalance,
                totalDeposits: d.totalDeposits !== undefined ? Number(d.totalDeposits) : (prev as any).totalDeposits,
                hasDeposited: d.hasDeposited !== undefined ? Boolean(d.hasDeposited) : (prev as any).hasDeposited,
              };
            }
            return {
              uid: user.uid,
              email: user.email,
              displayName: d.displayName || user.displayName || 'Jogador',
              walletBalance: Number(d.walletBalance || 0),
              balance: Number(d.balance || 0),
              realBalance: Number(d.realBalance || d.walletBalance || 0),
              totalDeposits: Number(d.totalDeposits || 0),
              hasDeposited: Boolean(d.hasDeposited),
              influencer: Boolean(d.influencer),
              kycStatus: d.kycStatus || 'NOT_STARTED',
              status: d.status || 'ACTIVE'
            } as UserProfile;
          });
        }
      }
    } catch {}
  }, [user]);

  useEffect(() => {
    if (!user || supabaseEnabled) { setServerBalance(null); return; }
    void refreshWallet();
    const handleFocus = () => { void refreshWallet(); };
    window.addEventListener('focus', handleFocus);
    window.addEventListener('visibilitychange', handleFocus);
    const interval = setInterval(() => { void refreshWallet(); }, 8000);
    return () => {
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('visibilitychange', handleFocus);
      clearInterval(interval);
    };
  }, [user, refreshWallet]);

  const loadCatalog = useCallback(async () => {
    try {
      void fetchIgamewinProviders().then(providerList=>{if(providerList.length)setProviders(providerList);}).catch(()=>{});
      const gameList=await fetchIgamewinGames();
      if (Array.isArray(gameList) && gameList.length > 0) {
        setGames(gameList);
        setCatalogError('');
        return true;
      }
      return false;
    } catch (e: any) {
      console.warn('[catalog auto-load]', e?.message || e);
      setCatalogError('Não foi possível atualizar os jogos. Tentaremos novamente em instantes.');
      return false;
    } finally {
      setCatalogLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: any = null;
    let attempt = 0;
    let running=false;

    const runAutoLoad = async () => {
      if (cancelled || running) return;
      if(document.hidden || !navigator.onLine){timer=setTimeout(runAutoLoad,8000);return;}
      running=true;
      const success = await loadCatalog();
      running=false;
      if (!success && !cancelled && attempt<4) {
        attempt++;
        // Auto-retry in the background without user intervention
        const nextDelay = Math.min(1500 * Math.pow(1.3, attempt), 8000);
        timer = setTimeout(runAutoLoad, nextDelay);
      }
    };

    const resume=()=>{if(document.hidden||!navigator.onLine)return;if(timer)clearTimeout(timer);attempt=0;void runAutoLoad();};
    window.addEventListener('online',resume);document.addEventListener('visibilitychange',resume);
    void runAutoLoad();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener('online',resume);document.removeEventListener('visibilitychange',resume);
    };
  }, [loadCatalog]);

  useEffect(() => { trackMarketingEvent('PageView',{section:tab}); }, [tab]);

  useEffect(() => {
    const openGame=(event:Event)=>{
      const d=(event as CustomEvent).detail||{};
      const game=games.find(g=>(!d.providerCode||g.providerCode===d.providerCode)&&g.code===d.gameCode);
      if(game)setSelectedGame(game); else setTab('games');
    };
    const openProvider=(event:Event)=>{
      const d=(event as CustomEvent).detail||{};
      if(d.providerCode)setSelectedProvider(d.providerCode);
      setTab('games');
    };
    window.addEventListener('amora:open-game',openGame as EventListener);
    window.addEventListener('amora:open-provider',openProvider as EventListener);
    return()=>{window.removeEventListener('amora:open-game',openGame as EventListener);window.removeEventListener('amora:open-provider',openProvider as EventListener)};
  },[games]);

  useEffect(() => { if(selectedGame) trackMarketingEvent('GameOpen',{game_code:selectedGame.code,provider:selectedGame.providerCode,name:selectedGame.name}); }, [selectedGame?.code]);

  useEffect(() => {
    fetch('/api/system/settings')
      .then(r => r.json())
      .then(d => {
        if (d?.settings && typeof d.settings === 'object') {
          if (d.settings.visualTheme) applyVisualTheme(d.settings.visualTheme);
          setSystemSettings((prev: any) => ({ ...d.settings, ...prev }));
        }
      })
      .catch(() => {});

    const unsubSystem = subscribeSystemSettings(settings => {
      if (settings && typeof settings === 'object') {
        if (settings.visualTheme) applyVisualTheme(settings.visualTheme);
        setSystemSettings((prev:any) => ({ ...prev, ...settings }));
      }
    });

    const unsubTheme = subscribeThemeConfig(theme => {
      if (theme && typeof theme === 'object') {
        applyVisualTheme(theme);
        setSystemSettings((prev:any) => ({ ...prev, visualTheme: theme }));
      }
    });

    const unsubRuntime = subscribeRuntimeSettings(value => {
      if (value && typeof value === 'object') {
        const next = { ...value };
        if (next.visualTheme) applyVisualTheme(next.visualTheme);
        setSystemSettings((x:any) => ({ ...x, ...next }));
      }
    });

    return () => {
      unsubSystem();
      unsubTheme();
      unsubRuntime();
    };
  }, []);

  useEffect(() => {
    if (!user || !profile) return;
    const timer = setTimeout(() => {
      mirrorRuntimeUser(user.uid, profile).catch(() => {});
    }, 1500);
    return () => clearTimeout(timer);
  }, [user?.uid, profile?.displayName, profile?.status, profile?.kycStatus]);

  const visibleGames = useMemo(() => {
    let result = games;
    if (selectedProvider !== 'ALL') result = result.filter(g => g.providerCode === selectedProvider);
    if (mode === 'favorites') result = result.filter(g => favoriteKeys.has(`${g.providerCode}:${g.code}`));
    if (deferredSearch.trim()) {
      const q = deferredSearch.toLowerCase();
      result = result.filter(g => `${g.name} ${g.providerName} ${g.category}`.toLowerCase().includes(q));
    }
    return result;
  }, [games, selectedProvider, deferredSearch, mode, favoriteKeys]);

  async function onFavorite(game: IGameWinGame) {
    if (!user) return;
    const active = await toggleFavorite(user.uid, game);
    setFavoriteKeys(prev => {
      const next = new Set(prev);
      const key = `${game.providerCode}:${game.code}`;
      if (active) next.add(key); else next.delete(key);
      return next;
    });
  }

  if (supabaseEnabled && window.location.pathname === '/reset-password') return <ResetPasswordPage />;
  if (authLoading) return <Splash />;
  if ((firebaseConfigured || supabaseEnabled) && !user) return <AuthPage />;
  if (user && launchPromotionOpen) return <LaunchPromotionPopup onClose={() => setLaunchPromotionOpen(false)} onDeposit={() => { setDepositPresetAmount('200'); setTab('deposit'); setLaunchPromotionOpen(false); }} />;

  return (
    <div className="desktop-app-frame"><DesktopSidebar setTab={setTab} tab={tab} theme={systemSettings.visualTheme}/><div className="app-shell">
      <TopBar
        profile={profile}
        balanceOverride={serverBalance}
        theme={systemSettings.visualTheme}
        onLanguage={() => setLanguageOpen(true)}
        onProfile={() => setTab('profile')}
        onNotifications={() => setTab('notifications')}
      />

      {languageOpen && (
        <LanguagePopup
          currentLocale={languageLocale}
          onClose={() => setLanguageOpen(false)}
          onLocale={(locale) => {
            setLanguageLocale(locale);
            if (locale === 'RU' || locale === 'JP') {
              setTab('home');
            }
          }}
        />
      )}
      <main className="content">
        {tab === 'home' && (
          <HomePage
            games={games}
            providers={providers}
            loading={catalogLoading}
            error={catalogError}
            onReload={loadCatalog}
            onGame={setSelectedGame}
            onGames={() => setTab('games')}
            setTab={setTab}
            setProvider={setSelectedProvider}
            user={user}
            profile={profile}
            favoriteKeys={favoriteKeys}
            onFavorite={onFavorite}
            languageSettings={systemSettings}
            languageLocale={languageLocale}
            onLanguage={() => setLanguageOpen(true)}
            onBalanceUpdate={setServerBalance}
            onDepositPreset={(amt) => setDepositPresetAmount(String(amt))}
          />
        )}
        {tab === 'games' && (<>
          <DynamicBannerSlot placement="GAMES_TOP" user={user} profile={profile} setTab={setTab} onGames={()=>setTab('games')}/>
          <GamesPage
            games={visibleGames}
            providers={providers}
            loading={catalogLoading}
            error={catalogError}
            onReload={loadCatalog}
            selectedProvider={selectedProvider}
            setSelectedProvider={setSelectedProvider}
            search={search}
            setSearch={setSearch}
            mode={mode}
            setMode={setMode}
            onGame={setSelectedGame}
            favoriteKeys={favoriteKeys}
            onFavorite={onFavorite}
          />
          </>)}
        {tab === 'promos' && <><DynamicBannerSlot placement="PROMOTIONS_TOP" user={user} profile={profile} setTab={setTab} onGames={()=>setTab('games')}/><PromosPage onWallet={() => { setDepositPresetAmount(''); setTab('wallet'); }} onDeposit={(amt) => { if (amt) setDepositPresetAmount(String(amt)); setTab('deposit'); }} /></>}
        {tab === 'deposit' && <>
          <FirstDepositPopup user={user} profile={profile} />
          <DynamicPopup placement="POPUP_DEPOSIT" user={user} profile={profile} setTab={setTab} onGames={()=>setTab('games')}/>
          <DynamicBannerSlot placement="DEPOSIT_TOP" user={user} profile={profile} setTab={setTab} onGames={()=>setTab('games')}/>
          <DepositPage user={user} profile={profile} onBalanceUpdate={setServerBalance} initialAmount={depositPresetAmount} />
        </>}
        {tab === 'wallet' && <WalletPage user={user} profile={profile} balanceOverride={serverBalance} onDeposit={() => { setDepositPresetAmount(''); setTab('deposit'); }} onWithdraw={() => setWithdrawOpen(true)} />}
        {tab === 'history' && <HistoryPage user={user} />}
        {tab === 'bonuses' && <BonusesPlayerPage onDeposit={()=>setTab('deposit')} />}
        {tab === 'notifications' && <NotificationsPlayerPage user={user} />}
        {tab === 'affiliate' && <AffiliatePage user={user} profile={profile} />}
        {tab === 'responsible' && <ResponsibleGamingPage user={user} profile={profile} />}
        {tab === 'security' && <SecurityPage user={user} profile={profile} />}
        {tab === 'profile' && <><DynamicBannerSlot placement="PROFILE_TOP" user={user} profile={profile} setTab={setTab} onGames={()=>setTab('games')}/><ProfilePage user={user} profile={profile} balanceOverride={serverBalance} onDeposit={() => setTab('deposit')} onWithdraw={() => setWithdrawOpen(true)} onSupport={() => setSupportOpen(true)} onKyc={() => setKycOpen(true)} setTab={setTab} /></>}
      </main>

      <BottomNav tab={tab} setTab={setTab} onMenu={() => setMenuOpen(true)} theme={systemSettings.visualTheme} />
      {menuOpen && <SideMenu onClose={() => setMenuOpen(false)} setTab={setTab} setMode={setMode} onSupport={() => setSupportOpen(true)} />}
      {selectedGame && (
        <GameDetailModal
          game={selectedGame}
          onClose={() => setSelectedGame(null)}
          onPlay={(g, isDemo = false) => {
            setSelectedGame(null);
            setPlayingGame(g);
            setPlayingDemo(Boolean(isDemo));
          }}
          isFavorite={favoriteKeys.has(`${selectedGame.providerCode}:${selectedGame.code}`)}
          onToggleFavorite={() => onFavorite(selectedGame)}
          user={user}
          onOpenAuth={() => {
            setSelectedGame(null);
            setTab('profile');
          }}
        />
      )}
      {playingGame && (
        <GamePlayModal
          game={playingGame}
          demo={playingDemo}
          onClose={() => {
            setPlayingGame(null);
            void refreshWallet();
            setTimeout(() => void refreshWallet(), 1200);
            setTimeout(() => void refreshWallet(), 2800);
          }}
          currentUser={user}
          onOpenAuth={() => setTab('profile')}
          onBalanceRefresh={refreshWallet}
        />
      )}
      {supportOpen && <SupportModal user={user} onClose={() => setSupportOpen(false)} />}
      {withdrawOpen && (
        <WithdrawModal
          user={user}
          profile={profile}
          settings={systemSettings}
          balanceOverride={serverBalance}
          onBalanceUpdate={setServerBalance}
          onDeposit={(amt) => {
            setWithdrawOpen(false);
            if (amt) setDepositPresetAmount(String(amt));
            setTab('deposit');
          }}
          onClose={() => setWithdrawOpen(false)}
        />
      )}
      {kycOpen && (
        <KycModal
          user={user}
          profile={profile}
          settings={systemSettings}
          onBalanceUpdate={setServerBalance}
          onOpenWithdraw={() => {
            setKycOpen(false);
            setWithdrawOpen(true);
          }}
          onClose={() => setKycOpen(false)}
        />
      )}
    </div>
    </div>
  );
}

function Splash() {
  return <div className="loading-screen"><BrandLogo className="loading-brand-logo"/><small>Carregando experiência...</small></div>;
}

function TopBar({
  profile, balanceOverride, theme, onLanguage, onProfile, onNotifications
}: {
  profile: UserProfile | null;
  balanceOverride: number | null;
  theme?: any;
  onLanguage: () => void;
  onProfile: () => void;
  onNotifications?: () => void;
}) {
  const balance = Number(balanceOverride ?? profile?.walletBalance ?? profile?.balance ?? 0);
  return (
    <header className="topbar">
      <div className="topbar-left">
        <button className="icon-button language-trigger" onClick={onLanguage} aria-label="Idioma" title="Idioma"><Languages size={19} strokeWidth={1.8}/></button>
      </div>
      <div className="topbar-center">
        <button className="brand" aria-label="Trevo da Sorte"><BrandLogo className="topbar-brand-logo"/></button>
      </div>
      <div className="top-actions">
        <div className="balance-pill"><Wallet size={15}/><div>{theme?.showBalanceLabel!==false&&<small>Saldo</small>}<strong>{money(balance)}</strong></div></div>
        <button className="icon-button" onClick={onNotifications} aria-label="Notificações" title="Notificações"><Bell size={17}/><i className="notification-dot"/></button>
        <button className={`avatar-button ${isInfluencerUser(profile) ? 'influencer-vip-avatar' : ''}`} onClick={onProfile} aria-label="Perfil" title={isInfluencerUser(profile) ? "Meu Perfil (Influenciadora VIP)" : "Perfil"}>
          {isInfluencerUser(profile) ? <Crown size={20} className="text-emerald-400" /> : <CircleUserRound size={20}/>}
        </button>
      </div>
    </header>
  );
}

function LanguagePopup({
  currentLocale = 'BR', onClose, onLocale
}: {
  currentLocale?: 'BR'|'RU'|'JP';
  onClose: () => void;
  onLocale: (locale:'BR'|'RU'|'JP') => void;
}) {
  function select(locale:'BR'|'RU'|'JP'){
    onLocale(locale);
    onClose();
  }

  return (
    <div className="language-bonus-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="language-bonus-modal language-selector-only" onClick={e => e.stopPropagation()}>
        <button className="language-bonus-close" onClick={onClose} aria-label="Fechar"><X size={18}/></button>
        <div className="language-bonus-head">
          <Languages size={22}/>
          <div><span>IDIOMA</span><h3>Escolha seu idioma</h3></div>
        </div>
        <div className="language-grid">
          <button className={currentLocale === 'BR' ? 'selected' : ''} onClick={()=>select('BR')}>
            <img src="/language/brasil.svg" alt="Brasil"/><b>Brasil</b>
          </button>
          <button className={currentLocale === 'RU' ? 'selected' : ''} onClick={()=>select('RU')}>
            <img src="/language/russia.svg" alt="Rússia"/><b>Россия</b>
          </button>
          <button className={currentLocale === 'JP' ? 'selected' : ''} onClick={()=>select('JP')}>
            <img src="/language/japao.svg" alt="Japão"/><b>日本</b>
          </button>
        </div>
      </div>
    </div>
  );
}

function LanguageBonusStrip({
  locale, settings, user, profile, onDeposit, onBalanceUpdate
}: {
  locale: 'RU' | 'JP';
  settings: any;
  user: User | null;
  profile?: any;
  onDeposit: (amount?: number) => void;
  onBalanceUpdate: (value: number) => void;
}) {
  const [busy, setBusy] = useState(false);
  const isInfluencer = isInfluencerUser(profile);
  const [requirement, setRequirement] = useState<{
    message: string;
    requiredTotal: number;
    currentTotal: number;
    currentBalance?: number;
    missingAmount?: number;
    requirementCode: string;
  } | null>(null);
  const [notice, setNotice] = useState<string>('');

  const isRu = locale === 'RU';
  const message = isRu
    ? (settings?.languageBonusRussianMessage || 'Вы получили бонус 1 090 R$! Нажмите, чтобы забрать')
    : (settings?.languageBonusJapaneseMessage || '1,090 R$ のボーナスを受け取りました！請求するにはクリックしてください');

  const bonusAmountBRL = Number(settings?.languageBonusAmountBRL || 1090);

  async function claim() {
    if (!user) {
      setNotice('Entre na sua conta para resgatar este bônus.');
      return;
    }
    setBusy(true);
    setRequirement(null);
    setNotice('');

    const handleSuccess = (data: any) => {
      const newBal = Number(data?.balance);
      if (Number.isFinite(newBal)) onBalanceUpdate(newBal);
      const creditedAmount = Number(data?.amountBRL || bonusAmountBRL);
      setNotice(`✅ Bônus internacional de ${money(creditedAmount)} creditado com sucesso!`);
      trackMarketingEvent('LanguageBonusClaim', { locale, amount: creditedAmount, currency: 'BRL' });
    };

    const handleRequirement = (data: any) => {
      const current = Number(data?.currentBalance ?? data?.currentTotal ?? 0);
      const req = Number(data?.requiredTotal || 100);
      const missing = Number(data?.missingAmount ?? Math.max(0, req - current));
      setRequirement({
        message: data?.message || `Sua conta é nova, você precisa ter no mínimo R$ 100,00 depositados para conseguir resgatar. Você já tem ${money(current)}, falta apenas ${money(missing)}.`,
        requiredTotal: req,
        currentTotal: current,
        currentBalance: current,
        missingAmount: missing,
        requirementCode: data?.requirementCode || 'MIN_DEPOSIT_NEW_ACCOUNT',
      });
    };

    try {
      const token = await user.getIdToken();
      let serverData: any = null;

      try {
        const r = await fetch('/api/player/language-bonus/claim', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ locale, isInfluencer, influencer: isInfluencer }),
        });
        serverData = await r.json().catch(() => ({}));

        if (r.ok) {
          handleSuccess(serverData);
          return;
        }
        if (serverData?.error === 'LANGUAGE_BONUS_DEPOSIT_REQUIRED') {
          if (!isInfluencer) {
            handleRequirement(serverData);
            return;
          }
        }
        if (serverData?.error === 'LANGUAGE_BONUS_ALREADY_CLAIMED') {
          setNotice('Esta recompensa já foi resgatada nesta conta. Cada jogador pode resgatar apenas uma única vez.');
          return;
        }
        if (serverData?.error === 'LANGUAGE_BONUS_LOCALE_DISABLED') {
          setNotice('Esta promoção não está ativa para o idioma selecionado.');
          return;
        }
      } catch {}

      // Fallback em transação Firestore cliente
      try {
        const fallback = await claimLanguageBonusClient(user.uid, locale, settings, profile);
        handleSuccess(fallback);
        return;
      } catch (fallbackError: any) {
        const code = String(fallbackError?.code || fallbackError?.message || '');
        if (code.includes('LANGUAGE_BONUS_ALREADY_CLAIMED') || fallbackError?.message?.includes('já foi resgatada')) {
          setNotice('Esta recompensa já foi resgatada nesta conta. Cada jogador pode resgatar apenas uma única vez.');
          return;
        }
        if (code.includes('LANGUAGE_BONUS_DEPOSIT_REQUIRED') || fallbackError?.requiredTotal) {
          if (!isInfluencer) {
            handleRequirement(fallbackError);
            return;
          }
        }
        if (isInfluencer) {
          // Garante crédito imediato para conta influenciadora
          const creditedAmount = bonusAmountBRL;
          const currentBal = Number(profile?.walletBalance ?? profile?.balance ?? 0);
          const newBal = Number((currentBal + creditedAmount).toFixed(2));
          handleSuccess({ balance: newBal, amountBRL: creditedAmount });
          return;
        }
        if (serverData?.message && !/internal_error|firebase_admin_unavailable/i.test(serverData.message)) {
          setNotice(serverData.message);
          return;
        }
        throw fallbackError;
      }
    } catch (e: any) {
      const raw = String(e?.message || '');
      const technical = /snap is not defined|default credentials|application default credentials|firebase|firestore|permission-denied|internal/i.test(raw);
      setNotice(technical ? 'Não foi possível processar o resgate no momento. Tente novamente.' : (raw || 'Não foi possível resgatar o bônus.'));
    } finally {
      setBusy(false);
    }
  }

  if (requirement && !isInfluencer) {
    const current = requirement.currentBalance ?? requirement.currentTotal ?? 0;
    const req = requirement.requiredTotal || 100;
    const missing = requirement.missingAmount !== undefined ? requirement.missingAmount : Math.max(0, req - current);
    const depositTarget = missing > 0 ? missing : 100;
    const progressPercent = Math.min(100, Math.max(0, Math.round((current / req) * 100)));

    return (
      <div className="home-language-bonus-strip requirement">
        <div className="lang-bonus-req-header">
          <div className="lang-bonus-req-identity">
            <img
              src={isRu ? '/language/russia.svg' : '/language/japao.svg'}
              alt={isRu ? 'Rússia' : 'Japão'}
              className="lang-bonus-simple-flag"
            />
            <div className="lang-bonus-req-info">
              <div className="lang-bonus-req-heading-row">
                <span className="lang-bonus-req-heading">Liberar bônus</span>
                <span className="lang-bonus-req-badge">Faltam {money(depositTarget)}</span>
              </div>
              <p className="lang-bonus-req-explanation">
                Deposite {money(depositTarget)} e libere {money(bonusAmountBRL)}.
              </p>
            </div>
          </div>
          <button
            className="claim-dismiss-btn"
            onClick={() => setRequirement(null)}
            title="Fechar aviso"
            aria-label="Fechar"
          >
            <X size={14} />
          </button>
        </div>

        <div className="lang-bonus-req-action-row">
          <div className="lang-bonus-req-progress-block">
            <div className="lang-bonus-progress-track" role="progressbar" aria-label="Progresso do requisito de depósito" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressPercent}>
              <div className="lang-bonus-progress-fill" style={{ width: `${progressPercent}%` }} />
            </div>
          </div>
          <button
            className="claim-deposit-btn"
            onClick={() => onDeposit(depositTarget)}
            title={`Depositar ${money(depositTarget)}`}
          >
            <Zap size={13} />
            <span>Depositar {money(depositTarget)}</span>
          </button>
        </div>
      </div>
    );
  }

  if (notice) {
    const isSuccess = notice.includes('✅') || notice.includes('sucesso');
    return (
      <div className={`home-language-bonus-strip ${isSuccess ? 'notice success' : 'notice'}`}>
        <div className="home-language-bonus-copy">
          <img
            src={isRu ? '/language/russia.svg' : '/language/japao.svg'}
            alt={isRu ? 'Rússia' : 'Japão'}
            className="lang-bonus-simple-flag"
          />
          <div className="lang-bonus-simple-body">
            <div className="lang-bonus-simple-title">
              <span style={{ color: isSuccess ? '#4ade80' : '#93c5fd' }}>
                {isSuccess ? 'Bônus Concedido!' : 'Aviso do Bônus'}
              </span>
            </div>
            <p className="lang-bonus-simple-sub" title={notice}>{notice}</p>
          </div>
        </div>
        <button className="claim-dismiss-btn" onClick={() => setNotice('')} title="Fechar" aria-label="Fechar">
          <X size={13} />
        </button>
      </div>
    );
  }

  return (
    <div className="home-language-bonus-strip">
      <div className="home-language-bonus-copy">
        <img
          src={isRu ? '/language/russia.svg' : '/language/japao.svg'}
          alt={isRu ? 'Rússia' : 'Japão'}
          className="lang-bonus-simple-flag"
        />
        <div className="lang-bonus-simple-body">
          <div className="lang-bonus-simple-title">
            <span>{isRu ? 'Bônus Russo' : 'Bônus Japonês'}</span>
            <span className="lang-bonus-simple-val">+{money(bonusAmountBRL)}</span>
          </div>
          <p className="lang-bonus-simple-sub">
            {isInfluencer ? '⭐ Influenciador VIP · Resgate liberado com qualquer saldo' : 'Disponível para resgate'}
          </p>
        </div>
      </div>
      <button className="claim-action-btn" disabled={busy} onClick={claim}>
        {busy ? (
          <RotateCcw size={13} className="animate-spin" />
        ) : (
          <>
            <Gift size={13} />
            <span>Resgatar</span>
          </>
        )}
      </button>
    </div>
  );
}

function DesktopSidebar({ tab, setTab, theme }: { tab: Tab; setTab: (tab: Tab) => void; theme?: any }) {
  const items: { id: Tab; label: string; icon: any }[] = [
    { id: "home", label: theme?.labels?.home||"Início", icon: Home },
    { id: "games", label: theme?.labels?.casino||"Cassino", icon: Gamepad2 },
    { id: "deposit", label: theme?.labels?.deposit||"Depositar", icon: Wallet },
    { id: "promos", label: "Promoções", icon: Gift },
    { id: "history", label: "Histórico", icon: History },
    { id: "bonuses", label: "Bônus", icon: Trophy },
    { id: "affiliate", label: "Afiliados", icon: Network },
    { id: "profile", label: theme?.labels?.profile||"Perfil", icon: CircleUserRound },
  ];
  return (
    <aside className="desktop-sidebar">
      <button className="desktop-brand" onClick={() => setTab("home")} aria-label="Trevo da Sorte">
        <BrandLogo className="desktop-brand-logo"/>
      </button>
      <nav className="desktop-sidebar-nav">
        {items.map(({ id, label, icon: Icon }) => (
          <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>
            {theme?.icons?.[id==="games"?"casino":id]?<img className="custom-nav-icon" src={theme.icons[id==="games"?"casino":id]} alt=""/>:<Icon size={18}/>}
            <span>{label}</span>
          </button>
        ))}
      </nav>
      <div className="desktop-sidebar-bottom">
        <div className="desktop-sidebar-card">
          <span className="eyebrow">{theme?.brandName||"Trevo da Sorte"}</span>
          <strong>Jogue com responsabilidade</strong>
          <small>Conteúdo destinado a maiores de 18 anos.</small>
        </div>
      </div>
    </aside>
  );
}


const WINNERS_GAMES_POOL = [
  { gameName: 'Fortune Tiger', gameCode: 'fortune-tiger', providerCode: 'pgsoft' },
  { gameName: 'Fortune Rabbit', gameCode: 'fortune-rabbit', providerCode: 'pgsoft' },
  { gameName: 'Fortune Ox', gameCode: 'fortune-ox', providerCode: 'pgsoft' },
  { gameName: 'Dragon Hatch', gameCode: 'dragon-hatch', providerCode: 'pgsoft' },
  { gameName: 'Fortune Mouse', gameCode: 'fortune-mouse', providerCode: 'pgsoft' },
  { gameName: 'Gates of Olympus', gameCode: 'vs20olympgate', providerCode: 'pragmatic' },
  { gameName: 'Sweet Bonanza', gameCode: 'vs20sweetbonanza', providerCode: 'pragmatic' },
  { gameName: 'Fortune Dragon', gameCode: 'fortune-dragon', providerCode: 'pgsoft' },
  { gameName: 'Aviator', gameCode: 'aviator', providerCode: 'spribe' },
  { gameName: 'Mines', gameCode: 'mines', providerCode: 'spribe' },
  { gameName: 'Big Bass Splash', gameCode: 'vs10txbigbass', providerCode: 'pragmatic' },
  { gameName: 'Double Fortune', gameCode: 'double-fortune', providerCode: 'pgsoft' },
  { gameName: 'Ganesha Gold', gameCode: 'ganesha-gold', providerCode: 'pgsoft' },
  { gameName: 'Mahjong Ways 2', gameCode: 'mahjong-ways2', providerCode: 'pgsoft' },
  { gameName: 'Starlight Princess', gameCode: 'vs20starlight', providerCode: 'pragmatic' },
];

const WINNERS_PLAYERS_POOL = [
  'Rafaela S.', 'Lucas M.', 'Matheus K.', 'Giovana C.', 'Bruno F.', 'Amanda L.',
  'Thiago R.', 'Camila P.', 'Gabriel N.', 'Larissa T.', 'Rodrigo V.', 'Fernanda D.',
  'Felipe B.', 'Juliana O.', 'Vinicius C.', 'Patricia G.', 'Diego S.', 'Beatriz A.',
  'Leonardo M.', 'Carolina F.', 'Marcos E.', 'Renata H.', 'Guilherme P.', 'Eduardo M.',
  'Vanessa B.', 'Alexandre T.', 'Isabela N.', 'Murilo R.', 'Helena C.', 'Cauã F.'
];

const INITIAL_SIX_WINNERS = [
  { id: 'w1', gameName: 'Fortune Tiger', gameCode: 'fortune-tiger', providerCode: 'pgsoft', playerName: 'Rafaela S.', bet: 2, payout: 1840 },
  { id: 'w2', gameName: 'Fortune Rabbit', gameCode: 'fortune-rabbit', providerCode: 'pgsoft', playerName: 'Lucas M.', bet: 5, payout: 3250 },
  { id: 'w3', gameName: 'Fortune Ox', gameCode: 'fortune-ox', providerCode: 'pgsoft', playerName: 'Matheus K.', bet: 4, payout: 2480 },
  { id: 'w4', gameName: 'Dragon Hatch', gameCode: 'dragon-hatch', providerCode: 'pgsoft', playerName: 'Giovana C.', bet: 10, payout: 5920 },
  { id: 'w5', gameName: 'Fortune Mouse', gameCode: 'fortune-mouse', providerCode: 'pgsoft', playerName: 'Bruno F.', bet: 3, payout: 1560 },
  { id: 'w6', gameName: 'Gates of Olympus', gameCode: 'vs20olympgate', providerCode: 'pragmatic', playerName: 'Amanda L.', bet: 5, payout: 4750 },
];

function generateRandomWinner(existingList: any[] = []): any {
  const recentGameCodes = existingList.slice(0, 3).map(x => x.gameCode);
  const availableGames = WINNERS_GAMES_POOL.filter(g => !recentGameCodes.includes(g.gameCode));
  const chosenGame = availableGames[Math.floor(Math.random() * availableGames.length)] || WINNERS_GAMES_POOL[Math.floor(Math.random() * WINNERS_GAMES_POOL.length)];

  const recentPlayerNames = existingList.slice(0, 4).map(x => x.playerName);
  const availablePlayers = WINNERS_PLAYERS_POOL.filter(p => !recentPlayerNames.includes(p));
  const chosenPlayer = availablePlayers[Math.floor(Math.random() * availablePlayers.length)] || WINNERS_PLAYERS_POOL[Math.floor(Math.random() * WINNERS_PLAYERS_POOL.length)];

  const bets = [1, 2, 2.5, 3, 4, 5, 8, 10, 15, 20];
  const chosenBet = bets[Math.floor(Math.random() * bets.length)];

  // Multiplier between 40x and 900x
  const mult = Math.floor(Math.random() * 820) + 40;
  const rawPayout = chosenBet * mult;
  // Round to clean realistic amounts
  const payout = Math.round(rawPayout / 10) * 10 || rawPayout;

  return {
    id: `live-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    gameName: chosenGame.gameName,
    gameCode: chosenGame.gameCode,
    providerCode: chosenGame.providerCode,
    playerName: chosenPlayer,
    bet: chosenBet,
    payout,
    isNew: true,
  };
}

function WinnersSection(props?: { games?: IGameWinGame[]; onGame?: (g: IGameWinGame) => void }){
  const [data,setData]=useState<any>({config:{enabled:true,updateSeconds:30},rows:[]});
  const [liveRows, setLiveRows]=useState<any[]>(INITIAL_SIX_WINNERS);
  const [fallbackRows,setFallbackRows]=useState<any[]>([]);
  const [tab,setTab]=useState<'LUCKY'|'SPINS'|'WINNERS'>('LUCKY');

  useEffect(()=>subscribePublicWinners(setFallbackRows),[]);
  const load=()=>fetch('/api/winners-feed').then(r=>r.ok?r.json():Promise.reject()).then(setData).catch(()=>{});
  useEffect(()=>{
    void load();
  },[]);

  // Periodic dynamic winner generator (swapping winners, showing new players & games)
  useEffect(() => {
    if (data.config?.enabled === false) return;
    const interval = setInterval(() => {
      setLiveRows(prev => {
        const nextWinner = generateRandomWinner(prev);
        const updated = [nextWinner, ...prev.slice(0, 5)];
        return updated;
      });
    }, 2800);
    return () => clearInterval(interval);
  }, [data.config?.enabled]);

  if(data.config?.enabled===false)return null;

  const sourceRows = (data.rows && data.rows.length > 0)
    ? data.rows
    : (fallbackRows.length > 0 ? fallbackRows : liveRows);

  let rows = sourceRows.map((x: any) => {
    let img = x.image || '';
    if (!img && props?.games?.length) {
      const match = props.games.find(g =>
        (x.gameCode && (g.code?.toLowerCase() === x.gameCode.toLowerCase() || g.code?.toLowerCase().includes(x.gameCode.toLowerCase()))) ||
        (x.gameName && g.name?.toLowerCase().trim() === x.gameName.toLowerCase().trim())
      );
      if (match?.image) img = match.image;
    }
    return { ...x, image: img };
  });

  if(tab==='SPINS')rows.sort((a:any,b:any)=>Number(b.bet||0)-Number(a.bet||0));
  if(tab==='WINNERS')rows.sort((a:any,b:any)=>Number(b.payout||0)-Number(a.payout||0));
  if(tab==='LUCKY')rows.sort((a:any,b:any)=>(Number(b.payout||0)/Math.max(1,Number(b.bet||1)))-(Number(a.payout||0)/Math.max(1,Number(a.bet||1))));
  const mask=(name:string)=>data.config?.maskNames===false?name:name?`${name.slice(0,3)}***`:'Jog***';

  const handleRowClick = (x: any) => {
    if (!props?.onGame) return;
    const found = props.games?.find(g => 
      (x.gameCode && (g.code === x.gameCode || g.code?.toLowerCase().includes(x.gameCode.toLowerCase()))) ||
      (x.gameName && g.name?.toLowerCase().trim() === x.gameName.toLowerCase().trim())
    );
    if (found) {
      props.onGame(found);
    } else if (x.gameName) {
      props.onGame({
        id: String(x.id || x.gameCode || x.gameName),
        code: x.gameCode || `custom-${x.gameName}`,
        name: x.gameName,
        providerCode: x.providerCode || 'igamewin',
        providerName: x.providerName || 'iGameWin',
        image: x.image || '',
        category: 'Principais Jogos',
        rtp: '97.05%'
      });
    }
  };

  return <section className="winners-section">
    <div className="winners-title">VENCEDORES</div>
    <div className="winners-tabs"><button className={tab==='LUCKY'?'active':''} onClick={()=>setTab('LUCKY')}>Apostas de<br/>Sorte</button><button className={tab==='SPINS'?'active':''} onClick={()=>setTab('SPINS')}>Maiores<br/>Giros</button><button className={tab==='WINNERS'?'active':''} onClick={()=>setTab('WINNERS')}>Maiores<br/>Vencedores</button></div>
    <div className="winners-head"><span>Jogo</span><span>Jogador</span><span>Aposta</span><span>Pagamento</span></div>
    <div className="winners-list">{rows.slice(0,6).map((x:any,i:number)=><div className="winner-row winner-row-animated" key={x.id||i} onClick={() => handleRowClick(x)} style={{ cursor: props?.onGame ? 'pointer' : 'default' }}><div className="winner-game">{x.image?<img src={x.image} alt={x.gameName||'Jogo'} onError={(e)=>{(e.currentTarget as HTMLElement).style.display='none';}}/>:<span className="winner-fallback">🎰</span>}<b>{x.gameName||'Jogo'}</b></div><span>{mask(x.playerName||'Jogador')}</span><span>{Number(x.bet||0)?money(Number(x.bet)):'GIRO GRÁTIS'}</span><strong>{money(Number(x.payout||0))}</strong></div>)}</div>
    {!rows.length&&<small className="winner-demo-label">Aguardando resultados.</small>}
  </section>;
}

function HomePage(props: {
  games: IGameWinGame[]; providers: IGameWinProvider[]; loading: boolean; error: string;
  onReload: () => void; onGame: (g: IGameWinGame) => void; onGames: () => void;
  setTab: (tab: Tab) => void; setProvider: (provider: string) => void;
  user: User | null; profile: UserProfile | null;
  favoriteKeys: Set<string>; onFavorite: (g: IGameWinGame) => void;
  languageSettings: any; languageLocale: 'BR'|'RU'|'JP'; onLanguage: () => void;
  onBalanceUpdate: (value:number) => void;
  onDepositPreset?: (amount: number) => void;
}) {
  const isPgSoftGame = (game: IGameWinGame) => {
    const pCode = String(game.providerCode || '').toLowerCase();
    const pName = String(game.providerName || '').toLowerCase();
    const gName = String(game.name || '').toLowerCase();
    const gCode = String(game.code || '').toLowerCase();
    return (
      pCode.includes('pg') ||
      pCode.includes('pocket') ||
      pName.includes('pg') ||
      pName.includes('pocket') ||
      /fortune tiger|fortune ox|fortune rabbit|fortune mouse|fortune dragon|fortune gods|dragon hatch|mahjong ways|lucky neko|treasures of aztec|wild bandito|ganesha gold|ways of the qilin|bikini paradise|candy burst|cocktail nights|wild bounty|asgardian rising|supermarket spree|tree of fortune|medusa|caishen wins/i.test(
        `${gName} ${gCode}`
      )
    );
  };

  const featured = useMemo(() => {
    const explicitlyFeatured = props.games.filter(g => Boolean(g.featured));
    if (explicitlyFeatured.length) {
      return [...explicitlyFeatured].sort((a, b) => {
        const aPg = isPgSoftGame(a) ? 0 : 1;
        const bPg = isPgSoftGame(b) ? 0 : 1;
        return aPg - bPg;
      });
    }
    const pgGames = props.games.filter(isPgSoftGame);
    if (pgGames.length) {
      return pgGames;
    }
    return props.games.slice(0, 12);
  }, [props.games]);
  const popular = props.games.slice(12, 24).length ? props.games.slice(12, 24) : props.games.slice(0, 12);
  const pragmaticLive = props.games.filter(game => {
    const provider = `${game.providerCode || ''} ${game.providerName || ''}`.toLowerCase();
    const name = String(game.name || '').toLowerCase();
    return (provider.includes('pragmatic') && (provider.includes('live') || /casino|live/.test(name))) ||
      (provider.includes('pragmatic') && /live|roulette|blackjack|baccarat|dragon tiger|mega wheel|sweet bonanza candyland|boom city|powerup roulette/i.test(name));
  });

  const defaults = [
    "BANNER","CATEGORIES","FEATURED","WINNERS","PRAGMATIC_LIVE","MOST_PLAYED",
    "FAST_GAMES","NEW_RELEASES","PROMO_BANNER","SLOTS","LIVE_CASINO","PROVIDERS",
    "PLAYZADA_CLUB","AFFILIATE","RESPONSIBLE","POPULAR"
  ];
  const [layout,setLayout]=useState<string[]>(defaults);

  useEffect(() => subscribeHomeLayout(rows => {
    const known = new Set([...defaults, "AMORA_CLUB"]);
    const clean = rows.filter(x => known.has(x)).map(x => x === "AMORA_CLUB" ? "PLAYZADA_CLUB" : x);
    const missing = defaults.filter(x => !clean.includes(x));
    setLayout(clean.length ? [...clean, ...missing] : defaults);
  }), []);

  const gameReady = props.games.length > 0;

  const renderSection = (key:string) => {
    switch(key) {
      case "BANNER":
        return <div key={key} className="home-banner-stack">
          {props.languageSettings?.languageBonusEnabled !== false &&
            ((props.languageLocale === 'RU' && props.languageSettings?.languageBonusRussiaEnabled !== false) ||
             (props.languageLocale === 'JP' && props.languageSettings?.languageBonusJapanEnabled !== false)) && (
            <LanguageBonusStrip
              locale={props.languageLocale}
              settings={props.languageSettings}
              user={props.user}
              profile={props.profile}
              onDeposit={(amt) => { if (amt && amt > 0) props.onDepositPreset?.(amt); props.setTab('deposit'); }}
              onBalanceUpdate={props.onBalanceUpdate}
            />
          )}
          <DynamicBannerSlot placement="HOME_TOP" user={props.user} profile={props.profile} setTab={props.setTab} onGames={props.onGames} fallback={<HomeBannerCarousel onGames={props.onGames} />} />
        </div>;
      case "CATEGORIES":
        return <div key={key}>
          <ProviderStrip providers={props.providers} onSelect={code => { props.setProvider(code); props.setTab("games"); }} />
          <CatalogState loading={props.loading} error={props.error} onReload={props.onReload} />
        </div>;
      case "FEATURED":
        return gameReady ? <div key={key}><GameSection title="Em destaque" games={featured} onGame={props.onGame} favoriteKeys={props.favoriteKeys} onFavorite={props.onFavorite}/><DynamicBannerSlot placement="HOME_AFTER_FEATURED" user={props.user} profile={props.profile} setTab={props.setTab} onGames={props.onGames}/></div> : null;
      case "WINNERS":
        return gameReady ? <div key={key}><WinnersSection games={props.games} onGame={props.onGame}/><DynamicBannerSlot placement="HOME_MIDDLE" user={props.user} profile={props.profile} setTab={props.setTab} onGames={props.onGames}/></div> : null;
      case "PRAGMATIC_LIVE":
        return gameReady ? <div key={key}><GameSection title="Pragmatic Live" games={pragmaticLive.slice(0,12)} onGame={props.onGame} favoriteKeys={props.favoriteKeys} onFavorite={props.onFavorite}/>{!pragmaticLive.length&&<div className="pragmatic-live-empty"><span>PRAGMATIC LIVE</span><strong>Catálogo aguardando o provider</strong><small>Quando a iGameWin retornar jogos Pragmatic Live, eles entram aqui automaticamente.</small></div>}</div> : null;
      case "MOST_PLAYED":
        return gameReady ? <GameSection key={key} title="Mais jogados" games={props.games.slice(2,14)} onGame={props.onGame} favoriteKeys={props.favoriteKeys} onFavorite={props.onFavorite}/> : null;
      case "FAST_GAMES":
        return gameReady ? <GameSection key={key} title="Jogos rápidos" games={props.games.filter((_,i)=>i%2===0).slice(0,12)} onGame={props.onGame} favoriteKeys={props.favoriteKeys} onFavorite={props.onFavorite}/> : null;
      case "NEW_RELEASES":
        return gameReady ? <GameSection key={key} title="Lançamentos" games={[...props.games].reverse().slice(0,12)} onGame={props.onGame} favoriteKeys={props.favoriteKeys} onFavorite={props.onFavorite}/> : null;
      case "PROMO_BANNER":
        return <button key={key} className="home-promo-strip" onClick={()=>props.setTab("promos")}><div><span>RESENHA BET</span><strong>Promoções & Bônus</strong><small>Confira as campanhas disponíveis para sua conta.</small></div><b>VER PROMOÇÕES ›</b></button>;
      case "SLOTS":
        return gameReady ? <GameSection key={key} title="Slots" games={props.games.slice(0,12)} onGame={props.onGame} favoriteKeys={props.favoriteKeys} onFavorite={props.onFavorite}/> : null;
      case "LIVE_CASINO":
        return gameReady ? <GameSection key={key} title="Cassino ao vivo" games={props.games.filter(g=>/live|roulette|blackjack|baccarat|casino/i.test(`${g.name} ${g.providerName||""}`)).slice(0,12)} onGame={props.onGame} favoriteKeys={props.favoriteKeys} onFavorite={props.onFavorite}/> : null;
      case "PROVIDERS":
        return <ProviderStrip key={key} providers={props.providers} onSelect={code => { props.setProvider(code); props.setTab("games"); }} />;
      case "PLAYZADA_CLUB":
      case "AMORA_CLUB":
        return <section key={key} className="home-info-card club"><div><span>NACIONAL CLUB</span><h3>Benefícios para quem joga na Trevo da Sorte</h3><p>Níveis, recompensas e vantagens exclusivas.</p></div><button onClick={()=>props.setTab("bonuses")}>CONHECER ›</button></section>;
      case "AFFILIATE":
        return <section key={key} className="home-info-card"><div><span>INDIQUE & GANHE</span><h3>Compartilhe seu link Trevo da Sorte</h3><p>Acompanhe cliques, cadastros e comissões.</p></div><button onClick={()=>props.setTab("affiliate")}>MEU LINK ›</button></section>;
      case "RESPONSIBLE":
        return <section key={key} className="home-responsible"><div><strong>Jogue com responsabilidade</strong><p>Defina limites de depósito, sessão e autoexclusão.</p></div><button onClick={()=>props.setTab("responsible")}>Configurar</button></section>;
      case "POPULAR":
        return gameReady ? <GameSection key={key} title="Popular" games={popular} onGame={props.onGame} favoriteKeys={props.favoriteKeys} onFavorite={props.onFavorite}/> : null;
      default:
        return null;
    }
  };

  return <>
    <DynamicPopup user={props.user} profile={props.profile} setTab={props.setTab} onGames={props.onGames}/>
    <div className="zero-home">{layout.map(renderSection)}</div>
  </>;
}


type BannerCampaign = {
  id:string; name?:string; title?:string; subtitle?:string; active?:boolean; status?:string;
  placement?:string; template?:string; desktopImage?:string; mobileImage?:string;
  desktopWidth?:number; desktopHeight?:number; mobileWidth?:number; mobileHeight?:number;
  sizePreset?:string; objectFit?:string; objectPosition?:string; borderRadius?:number;
  overlayOpacity?:number; textColor?:string; buttonColor?:string; buttonText?:string;
  badge?:string; alignment?:string; action?:any; targeting?:any; schedule?:any;
  frequency?:string; priority?:number; sortOrder?:number; autoplayMs?:number;
  loop?:boolean; showDots?:boolean; showArrows?:boolean; swipe?:boolean; metrics?:any;
};

function bannerDevice() {
  return window.innerWidth <= 760 ? 'MOBILE' : 'DESKTOP';
}
function dateAllowed(b:BannerCampaign){
  const now=Date.now();
  const start=b.schedule?.startsAt ? new Date(b.schedule.startsAt).getTime() : 0;
  const end=b.schedule?.endsAt ? new Date(b.schedule.endsAt).getTime() : Infinity;
  if(start && now<start) return false;
  if(end && now>end) return false;
  if(Array.isArray(b.schedule?.weekdays) && b.schedule.weekdays.length && !b.schedule.weekdays.includes(new Date().getDay())) return false;
  const hhmm=new Date().toTimeString().slice(0,5);
  if(b.schedule?.startTime && hhmm<b.schedule.startTime) return false;
  if(b.schedule?.endTime && hhmm>b.schedule.endTime) return false;
  return true;
}
function targetAllowed(b:BannerCampaign,user:User|null,profile:UserProfile|null){
  const t=b.targeting||{};
  const device=bannerDevice();
  if(Array.isArray(t.devices) && t.devices.length && !t.devices.includes(device)) return false;
  if(t.loggedIn===true && !user) return false;
  if(t.loggedIn===false && user) return false;
  if(t.newUsersOnly && profile?.totalDeposits) return false;
  if(t.neverDeposited && Number((profile as any)?.totalDeposits||0)>0) return false;
  if(t.depositedOnly && Number((profile as any)?.totalDeposits||0)<=0) return false;
  if(t.kycApproved && profile?.kycStatus!=='APPROVED') return false;
  if(t.vipOnly && !(profile as any)?.vip) return false;
  const bal=Number(profile?.walletBalance??profile?.balance??0);
  if(t.minBalance!==undefined && bal<Number(t.minBalance)) return false;
  if(t.maxBalance!==undefined && bal>Number(t.maxBalance)) return false;
  return dateAllowed(b);
}
function frequencyAllowed(b:BannerCampaign){
  const f=String(b.frequency||'ALWAYS');
  const key=`amora_banner_${b.id}`;
  if(f==='ALWAYS') return true;
  if(f==='ONCE_PER_SESSION') return sessionStorage.getItem(key)!=='1';
  if(f==='ONCE_PER_DAY') return localStorage.getItem(key)!==new Date().toISOString().slice(0,10);
  if(f==='ONCE_PER_USER') return localStorage.getItem(key)!=='1';
  return true;
}
function markFrequency(b:BannerCampaign){
  const f=String(b.frequency||'ALWAYS'); const key=`amora_banner_${b.id}`;
  if(f==='ONCE_PER_SESSION') sessionStorage.setItem(key,'1');
  if(f==='ONCE_PER_DAY') localStorage.setItem(key,new Date().toISOString().slice(0,10));
  if(f==='ONCE_PER_USER') localStorage.setItem(key,'1');
}
async function bannerEvent(b:BannerCampaign,event:'IMPRESSION'|'CLICK'|'CONVERSION',user:User|null){
  try{
    const token=user?await user.getIdToken():'';
    fetch('/api/banner-events',{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify({bannerId:b.id,event,placement:b.placement,device:bannerDevice()})}).catch(()=>{});
  }catch{}
}
function runBannerAction(b:BannerCampaign,setTab:(t:Tab)=>void,onGames:()=>void){
  const a=b.action||{};
  const type=String(a.type||'NONE');
  if(type==='GAME'&&a.gameCode){window.dispatchEvent(new CustomEvent('amora:open-game',{detail:{providerCode:a.providerCode,gameCode:a.gameCode}}));return;}
  if(type==='PROVIDER'&&a.providerCode){window.dispatchEvent(new CustomEvent('amora:open-provider',{detail:{providerCode:a.providerCode}}));return;}
  if(type==='GAMES'||type==='GAME'||type==='PROVIDER') return onGames();
  if(type==='DEPOSIT') return setTab('deposit');
  if(type==='WITHDRAW'||type==='WALLET') return setTab('wallet');
  if(type==='HOME') return setTab('home');
  if(type==='HISTORY') return setTab('history');
  if(type==='NOTIFICATIONS') return setTab('notifications');
  if(type==='RESPONSIBLE') return setTab('responsible');
  if(type==='PROMOS') return setTab('promos');
  if(type==='BONUSES') return setTab('bonuses');
  if(type==='AFFILIATE') return setTab('affiliate');
  if(type==='PROFILE') return setTab('profile');
  if(type==='URL' && a.url) window.open(a.url,a.newTab===false?'_self':'_blank','noopener,noreferrer');
}
function normalizeZeroBanner(b:any){
  const next={...b};
  const known=["zerobet-stories-cta.png","zerobet-primeiro-deposito-200-1200.png","zerobet-primeiro-deposito-stories.png","bannerborah1.png", "bannerborah2.png", "bannerdep.png", "popupdeposito001.png", "desafio-tiger-mobile.png", "ca100por500.png", "bonus300-900.png", "deposito-300.png", "desafio-tiger-home-v2.png", "100por500.png", "200por1000.png", "ca200por1000.png", "desafio-tiger-desktop.png"];
  for(const key of ['desktopImage','mobileImage','imageUrl']){
    const value=String(next[key]||'');
    let decoded=value;try{decoded=decodeURIComponent(value)}catch{}
    const file=decoded.split('?')[0].split('/').pop()||'';
    if(known.includes(file))next[key]='/banners/'+file+'?v=trevo-identidade-v1';
  }
  for(const key of ['title','name','subtitle','badge']) if(typeof next[key]==='string')next[key]=next[key].replace(/Borah\s*Bet|Can[áa]rio\s*Bet|Amora\s*Bet|Resenha\s*Bet|Playzada\s*Bet|Zero\s*Bet/gi,'Trevo da Sorte');
  return next;
}

function useBanners(placement:string,user:User|null,profile:UserProfile|null){
  const [raw,setRaw]=useState<BannerCampaign[]>([]);
  useEffect(()=>subscribePublicBanners(placement,(rows:any[])=>setRaw(rows.map(normalizeZeroBanner) as BannerCampaign[])),[placement]);
  return raw.filter((b:BannerCampaign)=>targetAllowed(b,user,profile)&&frequencyAllowed(b)).sort((a,b)=>(Number(b.priority||0)-Number(a.priority||0))||(Number(a.sortOrder||0)-Number(b.sortOrder||0)));
}
function DynamicBannerSlot({placement,user,profile,setTab,onGames,fallback=null}:{placement:string;user:User|null;profile:UserProfile|null;setTab:(t:Tab)=>void;onGames:()=>void;fallback?:ReactNode}){
  const items=useBanners(placement,user,profile);
  const [index,setIndex]=useState(0);
  const banner=items[index];
  useEffect(()=>{ if(banner){ bannerEvent(banner,'IMPRESSION',user); markFrequency(banner); } },[banner?.id]);
  useEffect(()=>{
    if(items.length<2)return;
    const ms=Number(banner?.autoplayMs||5500);
    const timer=setInterval(()=>setIndex(i=>(i+1)%items.length),ms);
    return()=>clearInterval(timer);
  },[items.length,banner?.autoplayMs]);
  if(!items.length)return <>{fallback}</>;
  const click=()=>{bannerEvent(banner,'CLICK',user);trackMarketingEvent('BannerClick',{banner_id:banner.id,placement:banner.placement});runBannerAction(banner,setTab,onGames)};
  const desktopRatio=`${banner.desktopWidth||1898} / ${banner.desktopHeight||800}`;
  return <section className={`dynamic-banner-slot template-${String(banner.template||'FULL_IMAGE').toLowerCase()}`} style={{['--banner-radius' as any]:`${banner.borderRadius??16}px`,['--banner-ratio' as any]:desktopRatio}}>
    <button className="dynamic-banner-main" onClick={click}>
      <picture><source media="(max-width:760px)" srcSet={banner.mobileImage||banner.desktopImage}/><img src={banner.desktopImage||banner.mobileImage} alt={banner.title||banner.name||'Banner'} style={{objectFit:(banner.objectFit||'cover') as any,objectPosition:banner.objectPosition||'center'}}/></picture>
      {banner.template!=='FULL_IMAGE'&&<div className={`dynamic-banner-copy align-${banner.alignment||'left'}`} style={{color:banner.textColor||'#fff',background:`rgba(0,0,0,${Number(banner.overlayOpacity??0.25)})`}}>
        {banner.badge&&<span>{banner.badge}</span>}<strong>{banner.title}</strong>{banner.subtitle&&<p>{banner.subtitle}</p>}{banner.buttonText&&<b style={{background:banner.buttonColor && banner.buttonColor !== '#00b85c' ? banner.buttonColor : '#00b85c', color:'#ffffff'}}>{banner.buttonText}</b>}
      </div>}
    </button>
    {items.length>1&&<div className="dynamic-banner-dots">{items.map((x,i)=><button key={x.id} className={i===index?'active':''} onClick={()=>setIndex(i)}/>)}</div>}
  </section>;
}
function DynamicPopup({placement='POPUP_HOME',user,profile,setTab,onGames}:{placement?:string;user:User|null;profile:UserProfile|null;setTab:(t:Tab)=>void;onGames:()=>void}){
  const items=useBanners(placement,user,profile);
  const [closed,setClosed]=useState(false);
  const b=items[0];
  useEffect(()=>{if(b&&!closed){bannerEvent(b,'IMPRESSION',user);markFrequency(b)}},[b?.id,closed]);
  if(!b||closed)return null;
  const close=()=>setClosed(true);
  const action=()=>{bannerEvent(b,'CLICK',user);runBannerAction(b,setTab,onGames);close()};
  return <div className="dynamic-popup-backdrop" role="dialog" aria-modal="true"><div className="dynamic-popup-card" style={{borderRadius:`${b.borderRadius??18}px`}}>
    <button className="dynamic-popup-close" onClick={close}><X size={19}/></button>
    <button className="dynamic-popup-image" onClick={action}><picture><source media="(max-width:760px)" srcSet={b.mobileImage||b.desktopImage}/><img src={b.desktopImage||b.mobileImage} alt={b.title||b.name||'Promoção'} style={{objectFit:(b.objectFit||'contain') as any}}/></picture></button>
    {b.buttonText&&<button className="primary-button full" onClick={action}>{b.buttonText}</button>}
  </div></div>;
}

function HomeWelcomePopup({ onGames }: { onGames: () => void }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const key = 'amora_home_tiger_popup_v2';
    if (window.sessionStorage.getItem(key) !== 'seen') {
      const timer = window.setTimeout(() => setOpen(true), 350);
      return () => window.clearTimeout(timer);
    }
  }, []);

  function close() {
    window.sessionStorage.setItem('amora_home_tiger_popup_v2', 'seen');
    setOpen(false);
  }

  function participate() {
    close();
    onGames();
  }

  if (!open) return null;
  return (
    <div className="tiger-popup-backdrop" role="dialog" aria-modal="true" aria-label="Desafio Tiger">
      <div className="tiger-popup-card">
        <button className="tiger-popup-close" onClick={close} aria-label="Fechar popup"><X size={20}/></button>
        <button className="tiger-popup-image-button" onClick={participate} aria-label="Participar do Desafio Tiger">
          <img src="/banners/desafio-tiger-mobile.png?v=trevo-identidade-v1" alt="Desafio Tiger — últimas horas para participar" width="918" height="1560" decoding="async" />
        </button>
        <div className="tiger-popup-actions">
          <button className="primary-button full" onClick={participate}>VER JOGOS <ChevronRight size={16}/></button>
          <button className="tiger-popup-later" onClick={close}>Agora não</button>
        </div>
      </div>
    </div>
  );
}

function LaunchPromotionPopup({ onClose, onDeposit }: { onClose: () => void; onDeposit: () => void }) {
  const [imageFailed, setImageFailed] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab') {
        const buttons = closeRef.current?.closest('[role="dialog"]')?.querySelectorAll<HTMLButtonElement>('button');
        if (!buttons?.length) return;
        const first = buttons[0], last = buttons[buttons.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = oldOverflow; document.removeEventListener('keydown', onKey); previous?.focus(); };
  }, []);
  return <div className="first-deposit-popup-overlay launch-promotion-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="first-deposit-popup-card launch-promotion-card" role="dialog" aria-modal="true" aria-label="Primeiro depósito: R$ 200 mais R$ 1.000 de bônus">
      <button ref={closeRef} type="button" className="launch-promotion-close" onClick={onClose} aria-label="Fechar promoção"><X size={20}/></button>
      <button type="button" className="launch-promotion-art" onClick={onDeposit} aria-label="Aproveitar promoção e depositar R$ 200">{!imageFailed ? <img src="/banners/zerobet-stories-cta.png?v=trevo-identidade-v1" alt="Trevo da Sorte: primeiro depósito de R$ 200 mais R$ 1.000 de bônus, total R$ 1.200" onError={() => setImageFailed(true)}/> : <div className="launch-promotion-fallback"><img src="/brand/trevo-da-sorte-logo.svg" alt="Trevo da Sorte"/><span>PRIMEIRO DEPÓSITO</span><h1>R$ 200 <small>vira</small> R$ 1.200</h1><p>R$ 200 de depósito + R$ 1.000 de bônus</p><strong>Aproveitar agora ›</strong></div>}</button>
      <div className="launch-promotion-actions"><small>Oferta de bônus no primeiro depósito. Consulte as condições da promoção.</small></div>
    </div>
  </div>;
}

function FirstDepositPopup({ user, profile }: { user: User | null; profile: UserProfile | null }) {
  const [open, setOpen] = useState(true);
  const [timeLeft, setTimeLeft] = useState(2);

  useEffect(() => {
    setOpen(true);
    setTimeLeft(2);
  }, [user?.uid]);

  useEffect(() => {
    if (!open || timeLeft <= 0) return;
    const timer = window.setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [open, timeLeft]);

  if (!open) return null;

  const handleClose = () => {
    if (timeLeft > 0) return;
    setOpen(false);
  };

  return (
    <div
      className="first-deposit-popup-overlay"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget && timeLeft === 0) {
          handleClose();
        }
      }}
    >
      <div className="first-deposit-popup-card">
        <button
          type="button"
          className={`first-deposit-close-btn ${timeLeft > 0 ? 'locked' : 'unlocked'}`}
          onClick={handleClose}
          disabled={timeLeft > 0}
          aria-label={timeLeft > 0 ? `Fechar disponível em ${timeLeft} segundos` : 'Fechar popup'}
          title={timeLeft > 0 ? `Aguarde ${timeLeft}s para fechar` : 'Fechar'}
        >
          <svg className="circulating-line-svg" viewBox="0 0 54 54">
            <circle cx="27" cy="27" r="23" className="circulating-track" />
            <circle cx="27" cy="27" r="23" className="circulating-beam" />
          </svg>
          {timeLeft > 0 ? (
            <div className="first-deposit-timer-display">
              <X size={15} style={{ color: '#9ca3af', opacity: 0.4 }} />
              <span className="first-deposit-timer-sec">{timeLeft}s</span>
            </div>
          ) : (
            <X size={22} style={{ color: '#ffffff', filter: 'drop-shadow(0 0 4px rgba(255,255,255,0.85))' }} />
          )}
        </button>

        <div
          className="first-deposit-popup-media"
          onClick={() => {
            if (timeLeft === 0) {
              handleClose();
            }
          }}
        >
          <img
            src="/banners/popupdeposito001.png?v=trevo-identidade-v1"
            alt="Promoção Especial de Depósito"
            className="first-deposit-popup-img"
            onError={(e) => {
              if (e.currentTarget.src !== '/banners/popupdeposito001.png?v=trevo-identidade-v1') {
                e.currentTarget.src = '/banners/popupdeposito001.png?v=trevo-identidade-v1';
              }
            }}
          />
        </div>
      </div>
    </div>
  );
}

function HomeBannerCarousel({ onGames }: { onGames: () => void }) {
  const slides = [
    {
      id: 'banner-borah-01',
      desktop: '/banners/bannerborah1.png?v=trevo-identidade-v1',
      mobile: '/banners/bannerborah1.png?v=trevo-identidade-v1',
      localFallback: '/banners/bannerborah1.png?v=trevo-identidade-v1',
      alt: 'Trevo da Sorte — Destaque 1',
      action: onGames,
    },
    {
      id: 'banner-borah-02',
      desktop: '/banners/bannerborah2.png?v=trevo-identidade-v1',
      mobile: '/banners/bannerborah2.png?v=trevo-identidade-v1',
      localFallback: '/banners/bannerborah2.png?v=trevo-identidade-v1',
      alt: 'Trevo da Sorte — Destaque 2',
      action: onGames,
    },
  ];

  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [touchStart, setTouchStart] = useState<number | null>(null);

  useEffect(() => {
    if (paused) return;
    const timer = window.setInterval(() => setIndex(i => (i + 1) % slides.length), 5500);
    return () => window.clearInterval(timer);
  }, [paused, slides.length]);

  function onTouchEnd(e: TouchEvent) {
    if (touchStart == null) return;
    const delta = e.changedTouches[0].clientX - touchStart;
    if (Math.abs(delta) > 45) {
      setIndex(i => delta < 0 ? (i + 1) % slides.length : (i - 1 + slides.length) % slides.length);
    }
    setTouchStart(null);
  }

  return (
    <section
      className="home-carousel"
      aria-label="Destaques Trevo da Sorte"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onTouchStart={e => setTouchStart(e.touches[0].clientX)}
      onTouchEnd={onTouchEnd}
    >
      <div className="home-carousel-track" style={{ transform: `translateX(-${index * 100}%)` }}>
        {slides.map((slide, i) => (
          <button className="home-carousel-slide" key={slide.id} onClick={slide.action} aria-label={slide.alt} tabIndex={i === index ? 0 : -1}>
            <picture>
              <source media="(max-width: 560px)" srcSet={slide.mobile}/>
              <img
                src={slide.desktop}
                alt={slide.alt}
                width={1898}
                height={800}
                loading={i === 0 ? 'eager' : 'lazy'}
                decoding="async"
                onError={(e) => {
                  if (e.currentTarget.src !== slide.localFallback) {
                    e.currentTarget.src = slide.localFallback;
                  }
                }}
              />
            </picture>
          </button>
        ))}
      </div>

      <div className="home-carousel-dots" aria-label="Selecionar banner">
        {slides.map((slide, i) => (
          <button key={slide.id} className={i === index ? 'active' : ''} onClick={() => setIndex(i)} aria-label={`Banner ${i + 1}`}/>
        ))}
      </div>
    </section>
  );
}

function GamesPage(props: {
  games: IGameWinGame[]; providers: IGameWinProvider[]; loading: boolean; error: string;
  onReload: () => void; selectedProvider: string; setSelectedProvider: (v: string) => void;
  search: string; setSearch: (v: string) => void; mode: LobbyMode; setMode: (v: LobbyMode) => void;
  onGame: (g: IGameWinGame) => void; favoriteKeys: Set<string>; onFavorite: (g: IGameWinGame) => void;
}) {
  return <div className="page">
    <div className="page-heading"><div><span className="eyebrow">LOBBY OFICIAL</span><h2>Jogos iGameWin</h2></div><span className="result-count">{props.games.length} jogos</span></div>
    <div className="lobby-toolbar">
      <label className="search-box"><Search size={17}/><input value={props.search} onChange={e => props.setSearch(e.target.value)} placeholder="Buscar jogo ou provider..."/></label>
      <button className="filter-button"><SlidersHorizontal size={17}/></button>
    </div>
    <div className="mode-tabs">
      <button className={props.mode === 'all' ? 'active' : ''} onClick={() => props.setMode('all')}><Star size={14}/> Todos</button>
      <button className={props.mode === 'favorites' ? 'active' : ''} onClick={() => props.setMode('favorites')}><Heart size={14}/> Favoritos</button>
    </div>
    <ProviderTabs providers={props.providers} selected={props.selectedProvider} onSelect={props.setSelectedProvider}/>
    <CatalogState loading={props.loading} error={props.error} gamesCount={props.games.length} onReload={props.onReload}/>
    {props.games.length > 0 ? (
      <div className="games-grid">
        {props.games.map(game => (
          <GameCard
            key={`${game.providerCode}:${game.code}`}
            game={game}
            onClick={() => props.onGame(game)}
            favorite={props.favoriteKeys.has(`${game.providerCode}:${game.code}`)}
            onFavorite={() => props.onFavorite(game)}
          />
        ))}
      </div>
    ) : props.loading ? (
      <div className="catalog-state">
        <RefreshCw className="spin" />
        <strong>Carregando catálogo de jogos...</strong>
        <span>Carregando títulos e estúdios automaticamente.</span>
      </div>
    ) : (
      <EmptyState title="Nenhum jogo encontrado" text="Altere o provider, remova o filtro ou pesquise outro nome."/>
    )}
  </div>;
}

function ProviderLogo({ provider }: { provider: IGameWinProvider }) {
  const asset = providerLogoAssets[provider.code];
  const src = asset?.file || provider.image;
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return <span className={`provider-logo${asset?.light ? ' provider-logo-light' : ''}`}>
    {src && !failed ? <img src={src} alt="" decoding="async" onError={() => setFailed(true)}/> : <strong className="provider-wordmark">{provider.name || provider.code}</strong>}
  </span>;
}

function ProviderStrip({ providers, onSelect }: { providers: IGameWinProvider[]; onSelect: (code: string) => void }) {
  const [paused, setPaused] = useState(false);
  if (!providers.length) return null;
  return <section className="section-block provider-showcase" aria-label="Provedores de jogos">
    <div className="provider-showcase-heading"><div><span className="provider-eyebrow">EXPLORE O CATÁLOGO</span><h3>Seus provedores favoritos</h3><p>Toque em uma marca para descobrir seus jogos.</p></div>
      <button className="provider-pause" aria-pressed={paused} onClick={() => setPaused(v => !v)}>{paused ? 'Continuar' : 'Pausar'}</button>
    </div>
    <div className={`provider-marquee${paused ? ' is-paused' : ''}`}>
      <div className="provider-marquee-track" style={{ animationDuration: `${Math.max(35, providers.length * 3.5)}s` }}>
        {[0, 1].map(copy => <div className="provider-marquee-group" key={copy} aria-hidden={copy === 1 ? true : undefined}>
          {providers.map(p => <button className="provider-brand-card" key={p.code} tabIndex={copy === 1 ? -1 : 0} aria-label={`Ver jogos de ${p.name || p.code}`} onClick={() => onSelect(p.code)}>
            <ProviderLogo provider={p}/><span>{p.name || p.code}</span><ChevronRight size={13}/>
          </button>)}
        </div>)}
      </div>
    </div>
  </section>;
}

function ProviderTabs({ providers, selected, onSelect }: { providers: IGameWinProvider[]; selected: string; onSelect: (v: string) => void }) {
  return <div className="provider-tabs"><button className={selected === 'ALL' ? 'active' : ''} onClick={() => onSelect('ALL')}>Todos</button>{providers.map(p => <button key={p.code} className={selected === p.code ? 'active' : ''} onClick={() => onSelect(p.code)}><ProviderLogo provider={p}/><span>{p.name}</span></button>)}</div>;
}

function GameSection({ title, games, onGame, favoriteKeys, onFavorite }: { title: string; games: IGameWinGame[]; onGame: (g: IGameWinGame) => void; favoriteKeys: Set<string>; onFavorite: (g: IGameWinGame) => void }) {
  if (!games.length) return null;
  return <section className="section-block"><div className="section-header"><h3><SvgIcon src={casinoIcons.winner}/>{title}</h3><span>{games.length} jogos</span></div><div className="game-scroll">{games.map(game => <GameCard key={`${game.providerCode}:${game.code}`} game={game} onClick={() => onGame(game)} favorite={favoriteKeys.has(`${game.providerCode}:${game.code}`)} onFavorite={() => onFavorite(game)}/>)}</div></section>;
}

function GameCard({ game, onClick, favorite, onFavorite }: { game: IGameWinGame; onClick: () => void; favorite: boolean; onFavorite: () => void }) {
  const [imageError, setImageError] = useState(false);
  const [customCoverFailed, setCustomCoverFailed] = useState(false);
  const brandedCover = getBrandedGameCover(game.name, game.code);
  const cover = !customCoverFailed && brandedCover ? brandedCover : game.image;
  useEffect(() => { setImageError(false); setCustomCoverFailed(false); }, [game.name, game.code, game.image, brandedCover]);
  return <article className="game-card">
    <button className="game-cover" onClick={onClick}>
      {cover && !imageError ? <img src={cover} alt={game.name} loading="lazy" decoding="async" onError={() => { if (brandedCover && !customCoverFailed) setCustomCoverFailed(true); else setImageError(true); }}/> : <div className="game-image-fallback"><SvgIcon src={casinoIcons.slots} size={46}/><span>{game.name}</span></div>}
      <span className="igw-tag">iGameWin</span>
      <span className="play-overlay">JOGAR</span>
    </button>
    <div className="game-meta"><div><strong>{game.name}</strong><small>{game.providerName || game.providerCode}</small></div><button className={favorite ? 'favorite active' : 'favorite'} onClick={onFavorite}><Heart size={15} fill={favorite ? 'currentColor' : 'none'}/></button></div>
  </article>;
}

function CatalogState({ loading, error, gamesCount = 0 }: { loading: boolean; error: string; onReload?: () => void; gamesCount?: number }) {
  if (gamesCount > 0) return null;
  if (loading) return <div className="catalog-state"><RefreshCw className="spin"/><strong>Carregando jogos...</strong><span>Sincronizando catálogo oficial da plataforma.</span></div>;
  if (error) return <div className="catalog-state"><RefreshCw className="spin"/><strong>Sincronizando catálogo de jogos...</strong><span>Reconectando com os provedores automaticamente.</span></div>;
  return null;
}

function PromosPage({ onWallet, onDeposit }: { onWallet: () => void; onDeposit?: (amount: number) => void }) {
  const bonusBanners = [
    {
      id: 'bonus-100-500',
      image: '/banners/ca100por500.png?v=trevo-identidade-v1',
      alt: 'Deposite R$ 100 e Receba R$ 500',
      depositAmount: 100,
      badge: '500% BÔNUS',
    },
    {
      id: 'bonus-200-1000',
      image: '/banners/ca200por1000.png?v=trevo-identidade-v1',
      alt: 'Deposite R$ 200 e Receba R$ 1.000',
      depositAmount: 200,
      badge: 'VIP 1.000',
    },
    {
      id: 'bonus-300-900',
      image: '/banners/bonus300-900.png?v=trevo-identidade-v1',
      alt: 'Bônus 300% até R$ 900',
      depositAmount: 300,
      badge: 'SUPER 900',
    },
  ];

  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">CAMPANHAS EXCLUSIVAS</span>
          <h2>Super Bônus & Promoções</h2>
        </div>
        <Gift size={24} color="#00b85c" />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '24px' }}>
        {bonusBanners.map(b => (
          <div
            key={b.id}
            className="deposit-bonus-flash-banner"
            style={{ margin: 0, cursor: 'pointer' }}
            onClick={() => onDeposit ? onDeposit(b.depositAmount) : onWallet()}
          >
            <img src={b.image} alt={b.alt} />
          </div>
        ))}
      </div>
    </div>
  );
}


function onlyDigits(value: unknown, max = 32) {
  return String(value ?? '').replace(/\D/g, '').slice(0, max);
}

function formatDepositCpf(value: string) {
  const d = onlyDigits(value, 11);
  return d.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2');
}

function formatDepositPhone(value: string) {
  const d = onlyDigits(value, 11);
  if (d.length <= 10) return d.replace(/(\d{2})(\d)/, '($1) $2').replace(/(\d{4})(\d)/, '$1-$2');
  return d.replace(/(\d{2})(\d)/, '($1) $2').replace(/(\d{5})(\d)/, '$1-$2');
}

function parseDepositAmount(value: string) {
  let raw=String(value||"").trim().replace(/^R\$\s*/i,"").replace(/\s/g,"");
  if(!raw)return NaN;
  if(raw.includes(",")&&raw.includes(".")) raw=raw.replace(/\./g,"").replace(",",".");
  else if(raw.includes(",")) raw=raw.replace(",",".");
  raw=raw.replace(/[^0-9.-]/g,"");
  const n=Number(raw);
  return Number.isFinite(n)?n:NaN;
}

function DepositPage({ user, profile, onBalanceUpdate, initialAmount }: { user: User | null; profile: UserProfile | null; onBalanceUpdate: (value:number)=>void; initialAmount?: string }) {
  const [amount, setAmount] = useState(() => {
    if (initialAmount && Number(initialAmount) > 0) return String(Number(initialAmount));
    return '300';
  });
  const [promoOffer, setPromoOffer] = useState<{ image: string; alt: string; targetAmount: string } | null>(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [payment, setPayment] = useState<any>(null);
  const [copied, setCopied] = useState(false);
  const isAdmin = Boolean(
    profile?.role === 'admin' ||
    profile?.admin === true ||
    (user?.email && [
      "nacional@gmail.com",
      "admin.zero@gmail.com",
      "admin.borah@gmail.com",
      "admin.resenha@gmail.com",
      "admin1.eduh@gmail.com",
      "admin.eduh1@gmail.com",
      "bancoiproxy@gmail.com",
      "administrador@gmail.com",
      "tribopayeduh@gmail.com",
      "zero@gmail.com",
      "admin.luis@gmail.com"
    ].includes(user.email.toLowerCase()))
  );
  const basePresets = isAdmin ? [1, 5, 25, 50, 100, 300] : [25, 50, 100, 150, 200, 300];
  const presets = useMemo(() => {
    const custom = Number(amount);
    if (Number.isFinite(custom) && custom >= (isAdmin ? 1 : 10) && !basePresets.includes(custom)) {
      return [...basePresets, custom].sort((a, b) => a - b);
    }
    return basePresets;
  }, [amount, isAdmin]);
  const cachedIdentity = user ? getCachedPaymentIdentity(user.uid) : null;
  const paymentSectionRef = useRef<HTMLElement | null>(null);
  const qrShellRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (initialAmount && Number(initialAmount) > 0) {
      setAmount(String(Number(initialAmount)));
    }
  }, [initialAmount]);

  useEffect(() => {
    if (payment) {
      const scrollTimer = window.setTimeout(() => {
        const target = qrShellRef.current || paymentSectionRef.current;
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 120);
      return () => window.clearTimeout(scrollTimer);
    }
  }, [payment?.requestId, payment?.qrCodeDataUrl]);

  useEffect(() => {
    if (!user) return;
    const nextCpf = onlyDigits(profile?.cpf || profile?.document || '', 14);
    const nextPhone = onlyDigits(profile?.phone || '', 11);
    if (nextCpf || nextPhone) {
      cachePaymentIdentity(user.uid, {
        cpf: nextCpf || cachedIdentity?.cpf || '',
        cpfValidated: Boolean(profile?.cpfValidated ?? cachedIdentity?.cpfValidated),
        phone: nextPhone || cachedIdentity?.phone || '',
        displayName: profile?.displayName || user.displayName || cachedIdentity?.displayName || '',
        email: String(profile?.email || user.email || cachedIdentity?.email || ''),
      });
    }
  }, [user, profile?.cpf, profile?.document, profile?.phone, profile?.cpfValidated, profile?.displayName, profile?.email]);

  useEffect(() => {
    if (!user || !payment?.requestId || ["APPROVED","PAID","FAILED","CHARGEBACK","IN_DISPUTE"].includes(payment.status)) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const token = await user.getIdToken();
        const r = await fetch(`/api/wallet/dotfy/deposit/${encodeURIComponent(payment.requestId)}/status`, {
          headers: { Authorization:`Bearer ${token}` },
          cache: 'no-store',
        });
        const d = await r.json().catch(()=>({}));
        if (!r.ok) return;
        if (cancelled) return;
        setPayment((x:any)=>({...x,...d}));
        if (d.status === 'APPROVED' || d.status === 'PAID') {
          if (Number.isFinite(Number(d.walletBalance))) onBalanceUpdate(Number(d.walletBalance));
          setStatus(d.igwCredited === false
            ? 'PIX confirmado! Saldo da plataforma atualizado; sincronização do jogo será reprocessada.'
            : 'PIX confirmado! O valor foi creditado na sua carteira.');
          trackMarketingEvent('Deposit',{value:Number(d.amount||payment.amount||0),currency:'BRL',provider:'DOTFY',orderId:String(d.requestId||payment.requestId||d.id||d.txId||'')});
        } else if (["FAILED","CHARGEBACK","IN_DISPUTE"].includes(d.status)) {
          setStatus(`Pagamento atualizado para ${d.status}.`);
        }
      } catch {}
    };
    poll();
    const timer=window.setInterval(poll,5000);
    return()=>{cancelled=true;window.clearInterval(timer)};
  },[user,payment?.requestId,payment?.status]);

  async function requestDeposit() {
    if (!user) return setStatus('Entre na sua conta para realizar um depósito.');
    const value = parseDepositAmount(amount);
    if (!Number.isFinite(value)) return setStatus('Informe um valor numérico válido.');
    const minAllowed = isAdmin ? 1 : 25;
    const maxAllowed = isAdmin ? 100000 : 300;
    if (value < minAllowed) return setStatus(`O depósito mínimo é R$ ${minAllowed.toFixed(2).replace('.', ',')}.`);
    if (value > maxAllowed) return setStatus(`O depósito máximo é R$ ${maxAllowed.toFixed(2).replace('.', ',')}.`);

    // CPF e telefone não são mais solicitados na tela de depósito.
    // O backend busca os dados já salvos em users/{uid}; o body leva somente
    // um fallback silencioso da identidade cacheada durante o cadastro.
    const cached = getCachedPaymentIdentity(user.uid);
    const fallbackDocument = onlyDigits(profile?.cpf || profile?.document || cached?.cpf || '', 14);
    const fallbackPhone = onlyDigits(profile?.phone || cached?.phone || '', 11);

    setBusy(true);
    setStatus('Gerando PIX...');
    setPayment(null);
    setCopied(false);
    trackMarketingEvent('DepositIntent',{value,currency:'BRL',provider:'DOTFY'});

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 18000);

    try {
      const token = await user.getIdToken();
      const params = new URLSearchParams(location.search);
      const fixedAmount = value.toFixed(2);
      const response = await fetch(`/api/wallet/dotfy/deposit?amount=${encodeURIComponent(fixedAmount)}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'x-amora-amount': fixedAmount,
        },
        signal: controller.signal,
        body: JSON.stringify({
          amount: Number(fixedAmount),
          value: Number(fixedAmount),
          total_amount: Number(fixedAmount),
          phone: fallbackPhone,
          document: fallbackDocument,
          name: profile?.displayName || user.displayName || cached?.displayName || '',
          email: profile?.email || user.email || cached?.email || '',
          utm_source: params.get('utm_source') || '',
          utm_medium: params.get('utm_medium') || '',
          utm_campaign: params.get('utm_campaign') || '',
          utm_content: params.get('utm_content') || '',
          utm_term: params.get('utm_term') || '',
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (data?.error === 'INVALID_AMOUNT') {
          const received = data?.received;
          const detail = received != null ? ` [recebido: ${typeof received === 'object' ? JSON.stringify(received) : received}]` : '';
          const minMsg = Number(data?.minDeposit ?? (isAdmin ? 1 : 25));
          const maxMsg = Number(data?.maxDeposit ?? (isAdmin ? 100000 : 300));
          throw new Error((data?.message || `Valor inválido. O depósito deve ser entre R$ ${minMsg.toFixed(2)} e R$ ${maxMsg.toFixed(2)}.`) + detail);
        }
        const providerMessage =
          data?.details?.message ||
          data?.details?.error ||
          data?.details?.errors?.[0]?.message ||
          data?.message ||
          data?.error;
        throw new Error(providerMessage || apiErrorMessage(response.status, data, 'Não foi possível gerar o PIX.'));
      }
      if (!data.pixPayload) throw new Error('O gateway Dotfy não retornou o PIX copia e cola.');

      setPayment(data);
      if (data.status === 'APPROVED' || data.status === 'PAID') {
        if (Number.isFinite(Number(data.walletBalance))) onBalanceUpdate(Number(data.walletBalance));
        setStatus('PIX confirmado! O valor foi creditado na sua carteira.');
        trackMarketingEvent('Deposit',{value:Number(data.amount||value),currency:'BRL',provider:'DOTFY',orderId:String(data.requestId||data.id||data.txId||'')});
      } else {
        setStatus('PIX gerado com sucesso. Copie a chave ou escaneie o QR Code abaixo.');
      }
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        setStatus('A geração do PIX demorou mais que o esperado. Tente novamente.');
      } else {
        setStatus(e?.message || 'Falha ao criar depósito.');
      }
    } finally {
      window.clearTimeout(timeout);
      setBusy(false);
    }
  }

  async function copyPix(){
    if(!payment?.pixPayload)return;
    try{
      await navigator.clipboard.writeText(payment.pixPayload);
      setCopied(true);
      window.setTimeout(()=>setCopied(false),1800);
    }catch{setStatus('Não foi possível copiar automaticamente. Selecione o código PIX manualmente.')}
  }

  const approved = ["APPROVED","PAID"].includes(String(payment?.status||""));

  return <div className="page deposit-page">
    <div className="page-heading">
      <div><span className="eyebrow">CARTEIRA</span><h2>Depositar</h2></div>
      <ArrowDownToLine/>
    </div>

    <section className="deposit-banner-shell">
      <img
        src="/banners/bannerdep.png?v=trevo-identidade-v1"
        alt="Área de Depósito — Trevo da Sorte"
        onError={(e) => {
          if (e.currentTarget.src !== "/banners/bannerdep.png?v=trevo-identidade-v1") {
            e.currentTarget.src = "/banners/bannerdep.png?v=trevo-identidade-v1";
          }
        }}
      />
    </section>

    {!payment ? <section className="deposit-panel">
      <div className="deposit-copy">
        <span className="eyebrow">PIX • DOTFY</span>
        <h3>Quanto você deseja depositar?</h3>
        <p>O PIX é gerado em tempo real e confirmado pelo backend antes de creditar a carteira.</p>
        {isAdmin && (
          <p style={{ color: '#10b981', fontSize: '12px', fontWeight: 600, marginTop: '4px' }}>
            🔓 Administrador: sem depósito mínimo (permitido a partir de R$ 1,00).
          </p>
        )}
      </div>

      <div className="deposit-presets">
        {presets.map(v => (
          <button
            key={v}
            type="button"
            className={Number(amount) === v ? 'active' : ''}
            onClick={() => {
              setAmount(String(v));
              if (v === 100) {
                setPromoOffer({
                  image: '/banners/200por1000.png?v=trevo-identidade-v1',
                  alt: 'Deposite R$ 200 e Receba R$ 1.000',
                  targetAmount: '200',
                });
              } else if (v === 25 || v === 50) {
                setPromoOffer({
                  image: '/banners/100por500.png?v=trevo-identidade-v1',
                  alt: 'Deposite R$ 100 e Receba R$ 500',
                  targetAmount: '100',
                });
              }
            }}
          >
            {money(v)}
          </button>
        ))}
      </div>

      <label className="deposit-amount">
        <span>R$</span>
        <input value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" placeholder="0,00"/>
      </label>

      {Number(amount) === 300 && (
        <div className="deposit-bonus-flash-banner">
          <img
            src="/banners/bonus300-900.png?v=trevo-identidade-v1"
            alt="Bônus 300% até R$ 900"
            onError={(e) => {
              if (e.currentTarget.src !== "/banners/bonus300-900.png?v=trevo-identidade-v1") {
                e.currentTarget.src = "/banners/bonus300-900.png?v=trevo-identidade-v1";
              }
            }}
          />
        </div>
      )}

      <div className="deposit-customer-name">
        <span>Dados do titular</span>
        <b>{profile?.displayName || user?.displayName || cachedIdentity?.displayName || 'Carregando cadastro...'}</b>
      </div>

      <button className="deposit-cta" onClick={requestDeposit} disabled={busy}>
        {busy ? <><RefreshCw size={17} className="spin"/> GERANDO PIX...</> : <>GERAR PIX <ChevronRight size={18}/></>}
      </button>

      <div className="deposit-security"><ShieldCheck size={17}/><div><b>Confirmação segura</b><span>O saldo só é alterado após a transação ser confirmada como autorizada pelo provedor.</span></div></div>
      {status && <div className="deposit-status">{status}</div>}
    </section> : <section ref={paymentSectionRef} className={`pix-payment-card ${approved?'approved':''}`}>
      <div className="pix-payment-head">
        <div><span className="eyebrow">PAGAMENTO PIX</span><h3>{approved?'Pagamento confirmado':'Escaneie ou copie o PIX'}</h3><p>{approved?'Seu saldo foi atualizado.':'A confirmação será atualizada automaticamente nesta tela.'}</p></div>
        <span className={`pix-live-status ${approved?'paid':''}`}>{approved?<><CheckCircle2 size={14}/> PAGO</>:<><i/> AGUARDANDO</>}</span>
      </div>

      {Number(payment.amount) === 300 && (
        <div className="deposit-bonus-flash-banner" style={{ marginBottom: "14px" }}>
          <img
            src="/banners/bonus300-900.png?v=trevo-identidade-v1"
            alt="Bônus 300% até R$ 900"
            onError={(e) => {
              if (e.currentTarget.src !== "/banners/deposito-300.png?v=trevo-identidade-v1") {
                e.currentTarget.src = "/banners/deposito-300.png?v=trevo-identidade-v1";
              }
            }}
          />
        </div>
      )}

      {!approved && <div ref={qrShellRef} className="pix-qr-shell">
        {payment.qrCodeDataUrl ? <img src={payment.qrCodeDataUrl} alt="QR Code PIX"/> : <div className="pix-qr-loading"><RefreshCw className="spin"/><span>Gerando QR...</span></div>}
      </div>}

      <div className="pix-amount-summary">
        <span>Valor do PIX</span>
        <strong>{money(payment.amount)}</strong>
        {Number(payment.amount) === 100 && (
          <div className="pix-bonus-tag">
            <Gift size={13} /> + R$ 500,00 de Bônus (Saque Imediato Liberado)
          </div>
        )}
        {Number(payment.amount) === 200 && (
          <div className="pix-bonus-tag">
            <Gift size={13} /> + R$ 1.000,00 de Bônus (Saque Imediato Liberado)
          </div>
        )}
        {Number(payment.amount) === 300 && (
          <div className="pix-bonus-tag" style={{ color: "#ffd043", background: "rgba(255, 193, 7, 0.12)", borderColor: "rgba(255, 193, 7, 0.3)" }}>
            <Gift size={13} /> + R$ 900,00 de Bônus (Saque quando quiser)
          </div>
        )}
      </div>

      {!approved && <div className="pix-copy-box">
        <span>PIX copia e cola</span>
        <code>{payment.pixPayload}</code>
        <button onClick={copyPix}>{copied?<><CheckCircle2 size={15}/> COPIADO</>:<><Copy size={15}/> COPIAR PIX</>}</button>
      </div>}

      <div className="pix-request-meta"><span>ID da transação</span><code>{payment.transactionId||payment.requestId}</code></div>
      {status&&<div className="deposit-status">{status}</div>}
      <button className="pix-new-payment" onClick={()=>{setPayment(null);setStatus('');}}>GERAR OUTRO PIX</button>
    </section>}

    {promoOffer && (
      <div
        className="promo-deposit-modal-backdrop"
        onClick={() => setPromoOffer(null)}
        role="dialog"
        aria-modal="true"
      >
        <div className="promo-deposit-modal-card" onClick={e => e.stopPropagation()}>
          <button
            type="button"
            className="promo-deposit-modal-close"
            onClick={(e) => {
              e.stopPropagation();
              setPromoOffer(null);
            }}
            title="Fechar"
            aria-label="Fechar"
          >
            <X size={20} />
          </button>
          <div
            className="promo-deposit-modal-body"
            onClick={() => {
              setAmount(promoOffer.targetAmount);
              setPromoOffer(null);
            }}
          >
            <img
              src={promoOffer.image}
              alt={promoOffer.alt}
              onError={(e) => {
                const target = e.currentTarget;
                const current = target.src;
                if (current.includes('200por1000') || current.includes('200por100')) {
                  if (!current.includes('ca200por1000')) {
                    target.src = '/banners/ca200por1000.png?v=trevo-identidade-v1';
                  } else {
                    target.src = '/banners/200por1000.png?v=trevo-identidade-v1';
                  }
                } else if (current.includes('100por500')) {
                  if (!current.includes('ca100por500')) {
                    target.src = '/banners/ca100por500.png?v=trevo-identidade-v1';
                  } else {
                    target.src = '/banners/100por500.png?v=trevo-identidade-v1';
                  }
                }
              }}
            />
          </div>
        </div>
      </div>
    )}
  </div>;
}


function WalletPage({ user, profile, balanceOverride, onDeposit, onWithdraw }: { user: User | null; profile: UserProfile | null; balanceOverride:number|null; onDeposit:()=>void; onWithdraw: () => void }) {
  const [transactions, setTransactions] = useState<any[]>([]);
  const [requests, setRequests] = useState<any[]>([]);
  const [amount, setAmount] = useState('');
  const [action, setAction] = useState<'deposit' | 'withdraw'>('deposit');
  const [status, setStatus] = useState('');
  const balance = Number(balanceOverride ?? profile?.walletBalance ?? profile?.balance ?? 0);

  useEffect(() => {
    if (!user) return;
    const a = subscribeGameTransactions(user.uid, setTransactions);
    const b = subscribePaymentRequests(user.uid, setRequests);
    return () => { a(); b(); };
  }, [user]);

  async function submitRequest() {
    if (!user) return setStatus('Faça login para continuar.');
    const value = Number(amount.replace(',', '.'));
    if (!Number.isFinite(value) || value < 20) return setStatus('Informe um valor a partir de R$ 20,00.');
    if (value > 20000) return setStatus('O valor máximo permitido é R$ 20.000,00.');
    if(action==='deposit'){
      onDeposit();
      return;
    }
    onWithdraw();
    setAmount('');
  }

  return <div className="page"><div className="page-heading"><div><span className="eyebrow">FINANCEIRO</span><h2>Carteira</h2></div><Wallet/></div>
    <section className="wallet-hero"><span>Saldo disponível</span><strong>{money(balance)}</strong><small>Saldo sincronizado com o banco de dados da plataforma.</small><div className="wallet-mode"><button className={action === 'deposit' ? 'active' : ''} onClick={() => setAction('deposit')}><ArrowDownToLine size={16}/> Depositar</button><button className={action === 'withdraw' ? 'active' : ''} onClick={() => setAction('withdraw')}><ArrowUpFromLine size={16}/> Sacar</button></div><div className="amount-row"><span>R$</span><input value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" placeholder="0,00"/><button onClick={submitRequest}>Continuar</button></div>{status && <p className="wallet-status">{status}</p>}</section>
    <section className="section-block"><div className="section-header"><h3><History size={16}/> Atividade recente</h3></div><div className="activity-list">{[...transactions, ...requests].slice(0, 12).map((tx, i) => <div className="activity-item" key={tx.id || i}><div><strong>{formatActivity(tx)}</strong><small>{tx.status || tx.type}</small></div><b>{tx.amount != null ? money(Number(tx.amount)) : '—'}</b></div>)}{!transactions.length && !requests.length && <EmptyState title="Sem movimentações" text="Suas apostas e solicitações aparecerão aqui."/>}</div></section>
  </div>;
}

function ProfilePage({
  user,
  profile,
  balanceOverride,
  onDeposit,
  onWithdraw,
  onSupport,
  onKyc,
  setTab
}: {
  user: User | null;
  profile: UserProfile | null;
  balanceOverride?: number | null;
  onDeposit: () => void;
  onWithdraw: () => void;
  onSupport: () => void;
  onKyc: () => void;
  setTab: (tab: Tab) => void;
}) {
  const [copiedId, setCopiedId] = useState(false);
  const [copiedAffLink, setCopiedAffLink] = useState(false);
  const [affiliateData, setAffiliateData] = useState<any>(null);
  const [myDataOpen, setMyDataOpen] = useState(false);
  const dataDialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!myDataOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = dataDialogRef.current;
    dialog?.querySelector<HTMLButtonElement>('button')?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMyDataOpen(false);
      if (event.key !== 'Tab' || !dialog) return;
      const controls = Array.from(dialog.querySelectorAll<HTMLElement>('button, input, [tabindex="0"]'));
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', handleKey);
    return () => { document.removeEventListener('keydown', handleKey); previous?.focus(); };
  }, [myDataOpen]);
  const balance = Number(balanceOverride ?? profile?.walletBalance ?? profile?.balance ?? 0);

  useEffect(() => {
    if (!user) return;
    const unsub = subscribeAffiliate(user.uid, setAffiliateData);
    return () => { if (typeof unsub === 'function') unsub(); };
  }, [user?.uid]);

  const affCode = affiliateData?.code || profile?.affiliateCode || (!supabaseEnabled && user ? `AMORA${user.uid.slice(0, 6).toUpperCase()}` : '');
  const affLink = affCode && typeof window !== 'undefined' ? `${window.location.origin}/?ref=${affCode}` : '';

  const copyAffiliateLink = async () => {
    if (!affLink) return;
    try {
      await navigator.clipboard.writeText(affLink);
      setCopyError('');
      setCopiedAffLink(true);
      setTimeout(() => setCopiedAffLink(false), 2500);
    } catch {
      const el = document.createElement('textarea');
      el.value = affLink;
      document.body.appendChild(el);
      el.select();
      const copied = document.execCommand('copy');
      document.body.removeChild(el);
      if (!copied) { setCopyError('Não foi possível copiar. Selecione o link e copie manualmente.'); return; }
      setCopyError('');
      setCopiedAffLink(true);
      setTimeout(() => setCopiedAffLink(false), 2500);
    }
  };

  const accountId = formatAccountId(user?.uid, profile?.accountId);

  const copyAccountId = async () => {
    if (!accountId) return;
    try { await navigator.clipboard.writeText(accountId); setCopyError(''); setCopiedId(true); setTimeout(() => setCopiedId(false), 2000); }
    catch { setCopyError('Não foi possível copiar. ID da conta: ' + accountId); }
  };

  const [copyError, setCopyError] = useState('');
  const groups = [
    { title: 'Conta e segurança', items: [
      {icon: UserCheck, label: 'Meus dados', detail: 'Informações pessoais e identificação', action: () => setMyDataOpen(true)},
      {icon: ShieldCheck, label: 'Verificação de identidade', detail: isInfluencerUser(profile) ? 'Isenta (Influenciadora VIP · Saque Liberado)' : (profile?.kycStatus === 'APPROVED' ? 'Identidade aprovada' : profile?.kycStatus === 'PENDING' ? 'Documentos em análise' : 'Envie seus documentos'), action: onKyc},
      {icon: KeyRound, label: 'Segurança', detail: 'Senha e proteção da sua conta', action: () => setTab('security')},
      {icon: Bell, label: 'Notificações', detail: 'Atualizações e mensagens', action: () => setTab('notifications')},
    ]},
    { title: 'Sua atividade', items: [
      {icon: History, label: 'Histórico de jogos', detail: 'Consulte suas últimas operações', action: () => setTab('history')},
      {icon: Gift, label: 'Meus bônus', detail: 'Benefícios e promoções disponíveis', action: () => setTab('bonuses')},
      {icon: SlidersHorizontal, label: 'Jogo responsável', detail: 'Limites e controle da sua atividade', action: () => setTab('responsible')},
      {icon: Headphones, label: 'Central de ajuda', detail: 'Fale com nossa equipe de suporte', action: onSupport},
    ]},
  ];
  return (
    <div className="page account-page">
      <header className="account-heading"><div><span className="account-eyebrow">TREVO DA SORTE / CONTA</span><h1>Meu perfil</h1><p>Suas informações, saldo e preferências em um só lugar.</p></div></header>
      <div className="account-layout">
        <aside className="account-summary">
          <div className="account-identity">
            <div className={`account-avatar ${isInfluencerUser(profile) ? 'influencer-avatar' : ''}`} aria-hidden="true">
              {(profile?.displayName || user?.displayName || 'J').trim().split(/\s+/).slice(0,2).map(n=>n[0]).join('').toUpperCase()}
            </div>
            <h2>{profile?.displayName || user?.displayName || 'Jogador'}</h2>
            <p>{user?.email || 'Modo demonstração'}</p>
            {isInfluencerUser(profile) && (
              <span style={{
                background: 'linear-gradient(135deg, rgba(0,184,92,0.25), rgba(0,184,92,0.1))',
                border: '1px solid rgba(0,184,92,0.5)',
                color: '#36e68b',
                borderRadius: '8px',
                padding: '4px 10px',
                fontSize: '11px',
                fontWeight: 800,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                margin: '4px auto 6px'
              }}>
                <Crown size={12} className="text-emerald-400" /> Influenciadora VIP (Taxa 0% & Saque Direto)
              </span>
            )}
            <span className="account-status">
              <ShieldCheck size={14}/>
              {isInfluencerUser(profile) ? 'Conta VIP (Isenta de Taxas)' : (profile?.status === 'BLOCKED' ? 'Conta bloqueada' : profile?.kycStatus === 'APPROVED' ? 'Identidade verificada' : profile?.kycStatus === 'PENDING' ? 'Verificação em análise' : 'Identidade não verificada')}
            </span>
            {user && <button type="button" className="account-id" onClick={copyAccountId} aria-label="Copiar ID da conta"><span>ID {accountId}</span>{copiedId ? <Check size={14}/> : <Copy size={14}/>}</button>}
          </div>
          <div className="account-balance"><span>Saldo disponível</span><strong>{money(balance)}</strong><div className="account-money-actions"><button type="button" className="account-primary" onClick={onDeposit}><ArrowDownToLine size={16}/>Depositar</button><button type="button" className="account-secondary" onClick={onWithdraw}><ArrowUpFromLine size={16}/>Sacar</button></div><button type="button" className="account-text-link" onClick={()=>setTab('wallet')}>Ver carteira e extrato<ChevronRight size={15}/></button></div>
          {user && <button type="button" className="account-logout" onClick={()=>logout()}><LogOut size={16}/>Sair da conta</button>}
        </aside>
        <div className="account-content">
          {groups.map(group=><section className="account-section" key={group.title}><h3>{group.title}</h3><div className="account-settings">{group.items.map(({icon:Icon,label,detail,action})=><button type="button" className="account-setting" key={label} onClick={action}><span className="account-setting-icon"><Icon size={19}/></span><span className="account-setting-label"><strong>{label}</strong><small>{detail}</small></span><ChevronRight size={17}/></button>)}</div></section>)}
          <section className="account-section account-referral"><div className="account-referral-heading"><div><h3>Indique amigos</h3><p>Acompanhe suas indicações e comissões.</p></div><Network size={22}/></div>
            {user && affLink ? <><label htmlFor="account-referral-link">Seu link de indicação</label><div className="account-link-field"><input id="account-referral-link" value={affLink} readOnly onFocus={e=>e.currentTarget.select()}/><button type="button" onClick={copyAffiliateLink} aria-label="Copiar link de indicação">{copiedAffLink ? <Check size={17}/> : <Copy size={17}/>}<span>{copiedAffLink ? 'Copiado' : 'Copiar'}</span></button></div><div className="account-referral-stats"><div><span>Cliques</span><strong>{affiliateData?.clicks || 0}</strong></div><div><span>Cadastros</span><strong>{affiliateData?.registrations || 0}</strong></div><div><span>Comissões</span><strong>{money(affiliateData?.commissionBalance || 0)}</strong></div></div><button type="button" className="account-text-link" onClick={()=>setTab('affiliate')}>Abrir painel de afiliados<ChevronRight size={15}/></button></> : <p>{supabaseEnabled && user ? 'Suas indicações estarão disponíveis após a ativação do módulo de afiliados.' : 'Entre na sua conta para acessar suas indicações.'}</p>}
          </section>
          <div className="account-feedback" role="status" aria-live="polite">{copyError || (copiedId ? 'ID da conta copiado.' : copiedAffLink ? 'Link de indicação copiado.' : '')}</div>
        </div>
      </div>
      {/* Modal / Ficha de Meus Dados do Jogador */}
      {myDataOpen && (
        <div className="modal-backdrop" onClick={() => setMyDataOpen(false)}>
          <div ref={dataDialogRef} className="support-modal my-data-modal account-data-modal" role="dialog" aria-modal="true" aria-label="Meus dados" onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "14px" }}>
              <div>
                <span className="eyebrow" style={{ color: "#36e68b" }}>IDENTIFICAÇÃO DO JOGADOR</span>
                <h3 style={{ fontSize: "17px", color: "#fff", margin: "2px 0" }}>Meus Dados</h3>
              </div>
              <button
                type="button"
                onClick={() => setMyDataOpen(false)}
                aria-label="Fechar meus dados"
                style={{ background: "#371724", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", padding: "6px", color: "#fff" }}
              >
                <X size={16} />
              </button>
            </div>

            <div style={{ display: "grid", gap: "10px" }}>
              <div className="my-data-row">
                <span>ID da Conta</span>
                <div className="flex items-center gap-2">
                  <strong style={{ color: "#36e68b", fontFamily: "monospace", fontSize: "13px" }}>{accountId}</strong>
                  <button
                    type="button"
                    onClick={copyAccountId}
                    style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "6px", padding: "3px 7px", fontSize: "10px", color: "#ddd" }}
                  >
                    {copiedId ? "Copiado!" : "Copiar"}
                  </button>
                </div>
              </div>

              <div className="my-data-row">
                <span>Nome de Exibição</span>
                <strong>{profile?.displayName || "Não informado"}</strong>
              </div>

              <div className="my-data-row">
                <span>E-mail</span>
                <strong style={{ wordBreak: "break-all" }}>{user?.email || "Demonstração"}</strong>
              </div>

              {profile?.phone && (
                <div className="my-data-row">
                  <span>Telefone</span>
                  <strong>{profile.phone}</strong>
                </div>
              )}

              {profile?.cpf && (
                <div className="my-data-row">
                  <span>CPF</span>
                  <strong>{profile.cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.***.***-$4")}</strong>
                </div>
              )}

              <div className="my-data-row">
                <span>Status da Conta</span>
                <strong style={{ color: profile?.status === "BLOCKED" ? "#f87171" : "#34d399" }}>
                  {profile?.status === "BLOCKED" ? "Bloqueada" : "Ativa & Regular"}
                </strong>
              </div>

              <div className="my-data-row">
                <span>Verificação KYC</span>
                <strong style={{ color: profile?.kycStatus === "APPROVED" ? "#34d399" : "#36e68b" }}>
                  {profile?.kycStatus === "APPROVED" ? "Aprovado" : profile?.kycStatus === "PENDING" ? "Em Análise" : "Não Iniciado"}
                </strong>
              </div>

              {affLink && (
                <div className="my-data-row">
                  <span>Link de Afiliado</span>
                  <div className="flex items-center gap-2">
                    <strong style={{ color: "#36e68b", fontSize: "11px", wordBreak: "break-all" }}>{affLink}</strong>
                    <button
                      type="button"
                      onClick={copyAffiliateLink}
                      style={{ background: "rgba(0,184,92,0.15)", border: "1px solid rgba(0,184,92,0.3)", borderRadius: "6px", padding: "3px 7px", fontSize: "10px", color: "#36e68b", whiteSpace: "nowrap" }}
                    >
                      {copiedAffLink ? "Copiado!" : "Copiar"}
                    </button>
                  </div>
                </div>
              )}
            </div>

            <button
              type="button"
              className="primary-button wide"
              style={{ marginTop: "16px" }}
              onClick={() => setMyDataOpen(false)}
            >
              Fechar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}


function HistoryPage({ user }: { user: User | null }) {
  const [transactions, setTransactions] = useState<any[]>([]);
  const [requests, setRequests] = useState<any[]>([]);
  const [filter, setFilter] = useState<'ALL'|'GAMES'|'PAYMENTS'>('ALL');

  useEffect(() => {
    if (!user) return;
    const a = subscribeGameTransactions(user.uid, setTransactions);
    const b = subscribePaymentRequests(user.uid, setRequests);
    return () => { a(); b(); };
  }, [user]);

  const rows = [
    ...transactions.map(x => ({...x, source:'GAMES'})),
    ...requests.map(x => ({...x, source:'PAYMENTS'}))
  ].filter(x => filter === 'ALL' || x.source === filter);

  return <div className="page">
    <div className="page-heading"><div><span className="eyebrow">MINHA ATIVIDADE</span><h2>Histórico</h2></div><History/></div>
    <div className="history-filters">{(['ALL','GAMES','PAYMENTS'] as const).map(x=><button key={x} className={filter===x?'active':''} onClick={()=>setFilter(x)}>{x==='ALL'?'Tudo':x==='GAMES'?'Jogos':'Financeiro'}</button>)}</div>
    <div className="activity-list history-full">{rows.map((tx,i)=><div className="activity-item" key={tx.id||i}><div><strong>{formatActivity(tx)}</strong><small>{tx.status||tx.type||tx.source}</small></div><b>{tx.amount!=null?money(Number(tx.amount)):'—'}</b></div>)}{!rows.length&&<EmptyState title="Nenhum registro" text="Suas movimentações aparecerão aqui."/>}</div>
  </div>;
}

function BonusesPlayerPage({onDeposit}:{onDeposit:()=>void}) {
  const [items,setItems]=useState<any[]>([]);
  useEffect(()=>subscribeBonuses(setItems),[]);
  return <div className="page"><div className="page-heading"><div><span className="eyebrow">BENEFÍCIOS</span><h2>Bônus</h2></div><Trophy/></div>
    <div className="bonus-player-grid">{items.map(x=>{const ratio=x.imageSizePreset==='1:1'?'1/1':x.imageSizePreset==='16:9'?'16/9':x.imageSizePreset==='9:16'?'9/16':'4/5';return <article className="bonus-player-card" key={x.id}>{x.image&&<div className="bonus-player-image" style={{aspectRatio:ratio}}><img src={x.image}/></div>}<span className="eyebrow">{x.type||'BONUS'}</span><h3>{x.title}</h3><strong>{x.percent?`${x.percent}%`:money(x.fixedAmount||0)}</strong><p>Depósito mínimo: {money(x.minDeposit||0)} • Máximo: {money(x.maxBonus||0)}</p>{x.rollover>0&&<small>Rollover: {x.rollover}x</small>}<button className="primary-button full" onClick={onDeposit}>{x.buttonText||'IR PARA DEPÓSITO'}</button></article>})}{!items.length&&<EmptyState title="Sem bônus ativos" text="Novas ofertas aparecerão aqui."/>}</div>
  </div>;
}

function NotificationsPlayerPage({ user }: { user: User | null }) {
  const [items,setItems]=useState<any[]>([]);
  useEffect(()=>user?subscribeUserNotifications(user.uid,setItems):()=>{},[user]);
  async function read(id:string){await markNotificationRead(id)}
  return <div className="page"><div className="page-heading"><div><span className="eyebrow">CENTRAL</span><h2>Notificações</h2></div><Bell/></div>
    <div className="notifications-list">{items.map(x=><button className={`notification-row ${x.read?'':'unread'}`} key={x.id} onClick={()=>read(x.id)}><div><strong>{x.title||'Trevo da Sorte'}</strong><p>{x.body||x.message||''}</p></div><span>{x.read?'Lida':'Nova'}</span></button>)}{!items.length&&<EmptyState title="Tudo tranquilo" text="Você não tem novas notificações."/>}</div>
  </div>;
}

function AffiliatePage({ user, profile }: { user: User | null; profile: UserProfile | null }) {
  const [affiliate, setAffiliate] = useState<any>(null);
  const [message, setMessage] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!user) return () => {};
    // Garante que o perfil de afiliado esteja criado e sincronizado imediatamente
    void createAffiliateProfile(user.uid, user.email).catch(() => {});
    const unsub = subscribeAffiliate(user.uid, setAffiliate);
    return () => { if (typeof unsub === 'function') unsub(); };
  }, [user]);

  const code = affiliate?.code || profile?.affiliateCode || (user ? `AMORA${user.uid.slice(0, 6).toUpperCase()}` : '');
  const link = code && typeof window !== 'undefined' ? `${window.location.origin}/?ref=${code}` : '';

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setMessage('Link de afiliado copiado para a área de transferência!');
      setTimeout(() => setCopied(false), 2500);
    } catch {
      const el = document.createElement('textarea');
      el.value = link;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setCopied(true);
      setMessage('Link de afiliado copiado!');
      setTimeout(() => setCopied(false), 2500);
    }
  };

  const shareWhatsApp = () => {
    if (!link) return;
    const text = encodeURIComponent(`Vem jogar na Trevo da Sorte com meu link exclusivo! Cadastre-se e aproveite: ${link}`);
    window.open(`https://api.whatsapp.com/send?text=${text}`, '_blank');
  };

  const shareTelegram = () => {
    if (!link) return;
    const text = encodeURIComponent(`Vem jogar na Trevo da Sorte com meu link exclusivo: ${link}`);
    window.open(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${text}`, '_blank');
  };

  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">PARCERIAS & INDICAÇÕES</span>
          <h2>Programa de Afiliados</h2>
        </div>
        <Network />
      </div>

      <section className="affiliate-hero" style={{ textAlign: "left", padding: "20px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "10px", marginBottom: "12px" }}>
          <div>
            <span className="eyebrow" style={{ color: "#22c55e", fontWeight: 800 }}>LINK ATIVO & PRONTO PARA USO</span>
            <h3 style={{ margin: "4px 0 0 0", fontSize: "20px" }}>Código: <span style={{ color: "#38bdf8" }}>{code || 'GERANDO...'}</span></h3>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", background: "rgba(34, 197, 94, 0.15)", border: "1px solid rgba(34, 197, 94, 0.3)", padding: "6px 12px", borderRadius: "8px", fontSize: "12px", color: "#4ade80", fontWeight: 700 }}>
            <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#22c55e", display: "inline-block" }}></span>
            Ativado automaticamente
          </div>
        </div>

        <p style={{ fontSize: "13px", color: "rgba(255,255,255,0.7)", margin: "0 0 14px 0", lineHeight: 1.5 }}>
          Divulgue seu link exclusivo. Cada jogador cadastrado pelo seu link é vinculado permanentemente à sua conta gerando comissões automáticas.
        </p>

        <div className="affiliate-link" style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <input readOnly value={link} onClick={copy} style={{ cursor: "pointer", background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: "8px", padding: "10px 14px", color: "#fff", flex: 1, fontSize: "13px" }} />
          <button onClick={copy} style={{ minWidth: "110px", height: "42px", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", background: copied ? "#22c55e" : "#0284c7", color: "#fff", border: "none", borderRadius: "8px", fontWeight: 700, cursor: "pointer" }}>
            {copied ? <><Check size={16} /> Copiado</> : <><Copy size={16} /> Copiar</>}
          </button>
        </div>

        <div style={{ display: "flex", gap: "10px", marginTop: "12px", flexWrap: "wrap" }}>
          <button type="button" onClick={shareWhatsApp} style={{ flex: 1, minWidth: "140px", height: "38px", background: "#25d366", color: "#0a0308", border: "none", borderRadius: "8px", fontWeight: 800, fontSize: "12px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}>
            Compartilhar no WhatsApp
          </button>
          <button type="button" onClick={shareTelegram} style={{ flex: 1, minWidth: "140px", height: "38px", background: "#0088cc", color: "#fff", border: "none", borderRadius: "8px", fontWeight: 800, fontSize: "12px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}>
            Compartilhar no Telegram
          </button>
        </div>
      </section>

      <div className="affiliate-stats" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: "12px", margin: "16px 0" }}>
        <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "10px", padding: "14px", textAlign: "center" }}>
          <span style={{ fontSize: "12px", color: "rgba(255,255,255,0.6)", display: "block" }}>Cliques no Link</span>
          <strong style={{ fontSize: "22px", color: "#38bdf8", marginTop: "4px", display: "block" }}>{affiliate?.clicks || 0}</strong>
        </div>
        <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "10px", padding: "14px", textAlign: "center" }}>
          <span style={{ fontSize: "12px", color: "rgba(255,255,255,0.6)", display: "block" }}>Cadastros (Leads)</span>
          <strong style={{ fontSize: "22px", color: "#a855f7", marginTop: "4px", display: "block" }}>{affiliate?.registrations || 0}</strong>
        </div>
        <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "10px", padding: "14px", textAlign: "center" }}>
          <span style={{ fontSize: "12px", color: "rgba(255,255,255,0.6)", display: "block" }}>Depositantes (FTD)</span>
          <strong style={{ fontSize: "22px", color: "#36e68b", marginTop: "4px", display: "block" }}>{affiliate?.depositors || 0}</strong>
        </div>
        <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "10px", padding: "14px", textAlign: "center" }}>
          <span style={{ fontSize: "12px", color: "rgba(255,255,255,0.6)", display: "block" }}>Comissão Acumulada</span>
          <strong style={{ fontSize: "22px", color: "#22c55e", marginTop: "4px", display: "block" }}>{money(affiliate?.commissionBalance || 0)}</strong>
        </div>
      </div>

      <div style={{ background: "rgba(56, 189, 248, 0.08)", border: "1px solid rgba(56, 189, 248, 0.2)", borderRadius: "10px", padding: "14px", fontSize: "13px", color: "rgba(255,255,255,0.8)", display: "flex", alignItems: "center", gap: "10px" }}>
        <Network size={20} style={{ color: "#38bdf8", flexShrink: 0 }} />
        <div>
          <strong>Comissão por Depósito:</strong> Você ganha {affiliate?.commissionPercent ?? 20}% sobre cada depósito realizado pelos seus indicados! O valor é creditado automaticamente no seu saldo de comissões a cada recarga PIX aprovada.
        </div>
      </div>

      {message && <div className="wallet-status" style={{ marginTop: "14px" }}>{message}</div>}
    </div>
  );
}

function ResponsibleGamingPage({ user, profile }: { user: User | null; profile: UserProfile | null }) {
  const [daily,setDaily]=useState(String(profile?.responsibleLimits?.dailyDeposit||''));
  const [weekly,setWeekly]=useState(String(profile?.responsibleLimits?.weeklyDeposit||''));
  const [monthly,setMonthly]=useState(String(profile?.responsibleLimits?.monthlyDeposit||''));
  const [session,setSession]=useState(String(profile?.responsibleLimits?.sessionMinutes||''));
  const [days,setDays]=useState('7');
  const [message,setMessage]=useState('');
  async function save(){
    if(!user)return;
    await saveResponsibleLimits(user.uid,{dailyDeposit:Number(daily||0),weeklyDeposit:Number(weekly||0),monthlyDeposit:Number(monthly||0),sessionMinutes:Number(session||0)});
    setMessage('Limites salvos.');
  }
  async function exclude(){
    if(!user)return;
    const until=new Date(Date.now()+Number(days)*86400000).toISOString();
    await createSelfExclusion(user.uid,until,'Solicitação do usuário');
    setMessage(`Autoexclusão configurada até ${new Date(until).toLocaleDateString('pt-BR')}.`);
  }
  return <div className="page"><div className="page-heading"><div><span className="eyebrow">PROTEÇÃO</span><h2>Jogo responsável</h2></div><ShieldCheck/></div>
    <section className="responsible-card"><ShieldCheck size={26}/><div><h3>Defina seus limites</h3><p>Use limites voluntários para controlar depósitos e tempo de sessão.</p></div></section>
    <div className="responsible-grid"><label><span>Limite diário</span><input value={daily} onChange={e=>setDaily(e.target.value)} inputMode="decimal" placeholder="R$"/></label><label><span>Limite semanal</span><input value={weekly} onChange={e=>setWeekly(e.target.value)} inputMode="decimal"/></label><label><span>Limite mensal</span><input value={monthly} onChange={e=>setMonthly(e.target.value)} inputMode="decimal"/></label><label><span>Sessão (minutos)</span><input value={session} onChange={e=>setSession(e.target.value)} inputMode="numeric"/></label></div>
    <button className="primary-button wide" onClick={save}>SALVAR LIMITES</button>
    <section className="self-exclusion"><ShieldAlert size={24}/><div><h3>Autoexclusão</h3><p>Durante o período escolhido sua conta ficará marcada como autoexcluída.</p><select value={days} onChange={e=>setDays(e.target.value)}><option value="1">24 horas</option><option value="7">7 dias</option><option value="30">30 dias</option><option value="180">180 dias</option><option value="365">1 ano</option></select><button onClick={exclude}>ATIVAR AUTOEXCLUSÃO</button></div></section>
    {message&&<div className="wallet-status">{message}</div>}
  </div>;
}

function SecurityPage({ user, profile }: { user: User | null; profile: UserProfile | null }) {
  const [name,setName]=useState(profile?.displayName||'');
  const [phone,setPhone]=useState(profile?.phone||'');
  const [city,setCity]=useState(profile?.city||'');
  const [pix,setPix]=useState(profile?.pixKey||'');
  const [message,setMessage]=useState('');
  async function save(){
    if(!user)return;
    await updateUserProfile(user.uid,{displayName:name,phone,city,pixKey:pix});
    setMessage('Dados atualizados.');
  }
  return <div className="page"><div className="page-heading"><div><span className="eyebrow">CONTA</span><h2>Segurança e dados</h2></div><KeyRound/></div>
    <div className="account-grid"><label><span>Nome</span><input value={name} onChange={e=>setName(e.target.value)}/></label><label><span>E-mail</span><input value={user?.email||''} readOnly/></label><label><span>Telefone</span><input value={phone} onChange={e=>setPhone(e.target.value)}/></label><label><span>Cidade</span><input value={city} onChange={e=>setCity(e.target.value)}/></label><label className="wide-field"><span>Chave PIX preferida</span><input value={pix} onChange={e=>setPix(e.target.value)}/></label></div>
    <button className="primary-button wide" onClick={save}>SALVAR DADOS</button>
    <section className="security-info"><CheckCircle2 size={21}/><div><strong>Firebase Authentication</strong><p>Login e sessão são protegidos pelo Firebase. Troca de senha pode ser feita pela recuperação de senha na tela de login.</p></div></section>
    {message&&<div className="wallet-status">{message}</div>}
  </div>;
}


function DepositFunnelPixBox({
  user,
  feeType,
  amount,
  title,
  description,
  withdrawAmount,
  pixKey,
  pixType,
  onSuccess,
  onCancel,
}: {
  user: User | null;
  feeType: 'KYC_FAST_TRACK' | 'KYC_APPROVAL' | 'FIRST_WITHDRAWAL' | 'ACCOUNT_APPROVAL' | 'ANTI_FRAUD' | 'LIQUIDATION' | 'FULL_WITHDRAW_UNLOCK';
  amount: number;
  title: string;
  description: string;
  withdrawAmount?: number;
  pixKey?: string;
  pixType?: string;
  onSuccess: (res: any) => void;
  onCancel?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [payment, setPayment] = useState<any>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [approved, setApproved] = useState(false);
  const pixAreaRef = useRef<HTMLDivElement | null>(null);

  const generatePix = useCallback(async () => {
    if (!user || busy || approved) return;
    setBusy(true);
    setError('');
    try {
      const token = await user.getIdToken();
      const cached = getCachedPaymentIdentity(user.uid);
      const fixedAmount = Number(amount).toFixed(2);
      const res = await fetch(`/api/wallet/dotfy/deposit?amount=${encodeURIComponent(fixedAmount)}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'x-amora-amount': fixedAmount,
        },
        body: JSON.stringify({
          amount: Number(fixedAmount),
          value: Number(fixedAmount),
          total_amount: Number(fixedAmount),
          feeType,
          phone: onlyDigits(cached?.phone || '', 11),
          document: onlyDigits(cached?.cpf || '', 14),
          name: user.displayName || cached?.displayName || 'Jogador Trevo da Sorte',
          email: user.email || cached?.email || '',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || data.error || 'Erro ao gerar PIX');
      setPayment(data);
      if (data.status === 'APPROVED' || data.status === 'PAID') {
        setApproved(true);
        onSuccess(data);
      }
    } catch (e: any) {
      setError(e.message || 'Falha ao criar cobrança PIX');
    } finally {
      setBusy(false);
    }
  }, [user, busy, approved, amount, feeType, onSuccess]);

  // Auto-scroll para o QR code e área PIX assim que for gerado
  useEffect(() => {
    if (payment && pixAreaRef.current) {
      setTimeout(() => {
        pixAreaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 150);
    }
  }, [payment]);

  // Polling em tempo real do status de pagamento após o usuário gerar o PIX
  useEffect(() => {
    if (!payment || approved || !user) return;
    const reqId = payment.requestId || payment.id || payment.externalId || payment.transactionId || payment.correlationID;
    if (!reqId) return;

    let active = true;
    const interval = window.setInterval(async () => {
      try {
        const token = await user.getIdToken();
        const res = await fetch(`/api/wallet/dotfy/status/${encodeURIComponent(reqId)}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        const d = await res.json().catch(() => ({}));
        if (active && (d.status === 'APPROVED' || d.status === 'PAID' || d.credited)) {
          setApproved(true);
          onSuccess(d);
        }
      } catch {}
    }, 5000);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [payment, approved, user, onSuccess]);

  async function copyPix() {
    if (!payment?.pixPayload) return;
    try {
      await navigator.clipboard.writeText(payment.pixPayload);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Copie o código PIX manualmente.');
    }
  }

  const hasWithdrawSum = withdrawAmount != null && Number(withdrawAmount) > 0;
  const totalSumAmount = hasWithdrawSum ? Number(withdrawAmount) + Number(amount) : Number(amount);

  return (
    <div className="deposit-funnel-card">
      {/* Banner Oficial de Verificação de Saque */}
      <img
        src="/verificacaosaque.png"
        alt="Verificação de Saque"
        style={{
          width: '100%',
          borderRadius: 10,
          marginBottom: 14,
          display: 'block',
          border: '1px solid rgba(0,184,92, 0.35)',
          boxShadow: '0 4px 14px rgba(0, 0, 0, 0.35)'
        }}
      />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div className="deposit-funnel-badge">
          <ShieldCheck size={13} /> VALIDAÇÃO BANCÁRIA
        </div>
        <span style={{ fontSize: 11, color: '#2fe08e', fontWeight: 800, letterSpacing: '0.3px' }}>
          100% REEMBOLSÁVEL
        </span>
      </div>

      <h4 className="deposit-funnel-title">{title}</h4>
      <p className="deposit-funnel-desc">{description}</p>

      {/* Cálculo Transparente de Transferência */}
      <div className="deposit-calc-box">
        {hasWithdrawSum && (
          <div className="deposit-calc-row">
            <span>Valor Solicitado para Saque:</span>
            <strong style={{ color: '#ffffff' }}>{money(Number(withdrawAmount))}</strong>
          </div>
        )}
        <div className="deposit-calc-row">
          <span>Valor da Taxa de Validação (Reembolsável):</span>
          <strong style={{ color: '#d96183' }}>+ {money(amount)}</strong>
        </div>
        {pixKey && (
          <div className="deposit-calc-row" style={{ borderTop: '1px dashed rgba(255,255,255,0.08)', paddingTop: 6 }}>
            <span>Chave PIX de Destino ({pixType || 'PIX'}):</span>
            <b style={{ color: '#e2e8f0', fontFamily: 'monospace' }}>{pixKey}</b>
          </div>
        )}
        <div className="deposit-calc-total">
          <div>
            <span className="deposit-calc-total-label">
              TOTAL A RECEBER NA SUA CONTA VIA PIX
            </span>
            <small style={{ color: '#ffb3b6', fontSize: '10.5px' }}>
              {hasWithdrawSum ? `Saque (${money(Number(withdrawAmount))}) + Devolução da Taxa (${money(amount)})` : `Valor 100% devolvido no PIX`}
            </small>
          </div>
          <strong className="deposit-calc-total-value">
            {money(totalSumAmount)}
          </strong>
        </div>
      </div>

      {/* Aviso Claro de Confirmação e Recebimento Imediato */}
      <div style={{
        background: 'rgba(0,184,92, 0.08)',
        border: '1px solid rgba(0,184,92, 0.3)',
        borderRadius: 10,
        padding: '12px 14px',
        marginBottom: 14,
        fontSize: 12,
        color: '#e2e8f0',
        lineHeight: 1.5
      }}>
        <strong style={{ color: '#d96183', display: 'block', marginBottom: 3, fontWeight: 800 }}>
          ℹ️ Recebimento Imediato Garantido:
        </strong>
        Ao confirmar o pagamento da taxa de <strong style={{ color: '#fff' }}>{money(amount)}</strong>, você receberá imediatamente o valor total de <strong style={{ color: '#2fe08e' }}>{money(totalSumAmount)}</strong> (seu saque integral + reembolso da taxa) diretamente na sua chave PIX.
      </div>

      {approved ? (
        <div style={{ textAlign: 'center', padding: '18px 0', background: 'rgba(46, 224, 142, 0.08)', borderRadius: 12, border: '1px solid rgba(46, 224, 142, 0.3)' }}>
          <div className="kyc-success-icon" style={{ margin: '0 auto 8px', width: 48, height: 48 }}>
            <CheckCircle2 size={32} color="#2fe08e" />
          </div>
          <b style={{ color: '#2fe08e', fontSize: 15, display: 'block' }}>Validação Concluída com Sucesso!</b>
          <p style={{ fontSize: 12, color: '#cbd5e1', margin: '4px 0 0' }}>Processando e avançando para a liberação bancária...</p>
        </div>
      ) : payment ? (
        <div className="deposit-funnel-pix-area" ref={pixAreaRef}>
          <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 8, textAlign: 'center' }}>
            Escaneie o QR Code ou copie a chave Pix Copia e Cola:
          </div>
          <div className="deposit-funnel-pix-qr">
            {payment.qrCodeDataUrl ? (
              <img src={payment.qrCodeDataUrl} alt="QR Code PIX" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
            ) : (
              <RefreshCw className="spin" size={28} color="#00b85c" />
            )}
          </div>
          <button
            type="button"
            className="deposit-funnel-copy-btn"
            onClick={copyPix}
            style={{
              background: copied ? 'rgba(46, 224, 142, 0.2)' : 'linear-gradient(135deg, #00b85c 0%, #008d47 100%)',
              color: copied ? '#2fe08e' : '#ffffff',
              border: copied ? '1px solid rgba(46, 224, 142, 0.5)' : 'none',
              fontWeight: 900
            }}
          >
            {copied ? <><CheckCircle2 size={18} color="#2fe08e" /> CÓDIGO PIX COPIADO!</> : <><Copy size={18} /> COPIAR CÓDIGO PIX</>}
          </button>
          <div className="deposit-funnel-status-live">
            <RefreshCw size={13} className="spin" color="#00b85c" /> Aguardando confirmação... Reconhecimento automático em tempo real.
          </div>
        </div>
      ) : (
        <button
          className="withdraw-submit-btn"
          onClick={() => void generatePix()}
          disabled={busy}
        >
          {busy ? (
            <><RefreshCw size={16} className="spin" /> GERANDO PIX...</>
          ) : (
            <><ArrowUpFromLine size={18} /> PAGAR E SACAR ({money(totalSumAmount)})</>
          )}
        </button>
      )}

      {error && <div className="wallet-status" style={{ marginTop: 10, background: 'rgba(239, 68, 68, 0.15)', color: '#f87171', border: '1px solid rgba(239, 68, 68, 0.3)' }}>{error}</div>}

      {onCancel && !approved && (
        <button
          type="button"
          onClick={onCancel}
          style={{
            background: 'transparent',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 8,
            color: '#94a3b8',
            fontSize: 11.5,
            fontWeight: 700,
            padding: '8px 14px',
            marginTop: 10,
            cursor: 'pointer',
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6
          }}
        >
          <RotateCcw size={13} /> Voltar e alterar valor ou chave PIX
        </button>
      )}
    </div>
  );
}

function WithdrawPage({
  user,
  profile,
  settings,
  balanceOverride,
  onBalanceUpdate,
  onDeposit,
  onSupport,
  onClose,
  setTab
}: {
  user: User | null;
  profile: UserProfile | null;
  settings: any;
  balanceOverride?: number | null;
  onBalanceUpdate?: (bal: number) => void;
  onDeposit?: (initialAmount?: number) => void;
  onSupport?: () => void;
  onClose?: () => void;
  setTab?: (tab: Tab) => void;
}) {
  const [amount, setAmount] = useState('');
  const [pixKey, setPixKey] = useState(profile?.pixKey || profile?.cpf || '');
  const [pixType, setPixType] = useState<'CPF' | 'EMAIL' | 'PHONE' | 'RANDOM'>('CPF');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [preview, setPreview] = useState<any>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [recentWithdrawals, setRecentWithdrawals] = useState<any[]>([]);
  const [successReceipt, setSuccessReceipt] = useState<any>(null);
  const [showVerificationStep, setShowVerificationStep] = useState(false);

  // KYC Inline upload states for Step 2
  const [kycDocType, setKycDocType] = useState<'RG' | 'CNH'>('RG');
  const [kycFrontUrl, setKycFrontUrl] = useState('');
  const [kycBackUrl, setKycBackUrl] = useState('');
  const [kycSelfieUrl, setKycSelfieUrl] = useState('');
  const [kycCpf, setKycCpf] = useState(profile?.cpf || '');
  const [kycBusy, setKycBusy] = useState(false);
  const [kycMsg, setKycMsg] = useState('');

  const balance = Number(preview?.balance ?? balanceOverride ?? profile?.walletBalance ?? profile?.balance ?? 0);
  const isInfluencer = Boolean(
    isInfluencerUser(profile) ||
    preview?.influencer === true ||
    isInfluencerUser(preview)
  );
  const min = isInfluencer ? 1 : Number(settings?.minWithdraw || 20);
  const max = Number(settings?.maxWithdraw || 20000);

  // Subscribe to user payment requests (history)
  useEffect(() => {
    if (!user) return;
    const unsub = subscribePaymentRequests(user.uid, (list) => {
      const withs = list.filter((x: any) => x.type === 'WITHDRAW');
      setRecentWithdrawals(withs.slice(0, 5));
    });
    return () => unsub();
  }, [user]);

  const fetchPreview = useCallback(async (requestedAmount?: number) => {
    if (!user) { setPreview(null); return; }
    const val = requestedAmount ?? Number(String(amount).replace(',', '.'));
    const safeVal = Number.isFinite(val) && val > 0 ? Math.min(val, max) : Math.min(balance, max);
    setPreviewBusy(true);
    try {
      const token = await user.getIdToken();
      const r = await fetch('/api/wallet/withdraw-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ amount: safeVal })
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok) {
        setPreview(d);
        if (Number.isFinite(d?.balance) && onBalanceUpdate) {
          onBalanceUpdate(Number(d.balance));
        }
      }
    } catch {} finally {
      setPreviewBusy(false);
    }
  }, [amount, balance, max, onBalanceUpdate, user]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void fetchPreview();
    }, 250);
    return () => clearTimeout(timer);
  }, [amount, fetchPreview]);

  const currentStepId = isInfluencer ? 'READY_TO_WITHDRAW' : (preview?.currentStepId || 'FIRST_WITHDRAWAL');
  const isReadyToWithdraw = isInfluencer || currentStepId === 'READY' || currentStepId === 'READY_TO_WITHDRAW';
  const requiredFeeAmount = isInfluencer ? 0 : Number(preview?.currentFeeAmount ?? (currentStepId === 'FIRST_WITHDRAWAL' ? (preview?.isLanguageBugUser ? 32.90 : 22.90) : 21.90));

  const parsedAmount = Number(String(amount).replace(',', '.'));
  const isAmountValid = isInfluencer
    ? (Number.isFinite(parsedAmount) && parsedAmount >= 1 && parsedAmount <= balance)
    : (Number.isFinite(parsedAmount) && parsedAmount >= min && parsedAmount <= Math.min(balance, max));

  function handleSetQuickAmount(val: number) {
    const target = Math.min(val, balance, max);
    setAmount(String(target));
  }

  async function handleKycSubmit() {
    if (!user) return;
    if (!kycCpf.trim() || !pixKey.trim()) {
      setKycMsg('Preencha seu CPF e Chave PIX.');
      return;
    }
    setKycBusy(true);
    setKycMsg('');
    try {
      const token = await user.getIdToken();
      const r = await fetch('/api/player/kyc-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          fullName: profile?.displayName || 'Jogador Trevo da Sorte',
          cpf: kycCpf,
          pixKey,
          documentType: kycDocType,
          documentFrontUrl: kycFrontUrl || 'https://placehold.co/400x250?text=Documento+Frente',
          documentBackUrl: kycBackUrl || 'https://placehold.co/400x250?text=Documento+Verso',
          selfieUrl: kycSelfieUrl || 'https://placehold.co/400x400?text=Selfie+Facial',
        })
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.message || d.error || 'Erro ao enviar dados do KYC');
      setKycMsg('Documentos enviados com sucesso! Conclua o pagamento da taxa de aprovação para validar sua conta.');
      void fetchPreview();
    } catch (e: any) {
      setKycMsg(e.message);
    } finally {
      setKycBusy(false);
    }
  }

  async function submitWithdrawal() {
    if (!user) return;
    setBusy(true);
    setMessage('');
    try {
      const token = await user.getIdToken();
      const numAmount = Number(String(amount).replace(',', '.'));
      const r = await fetch('/api/wallet/withdraw-request-v2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ amount: numAmount, pixKey, pixType })
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        if (d.error === 'FIRST_DEPOSIT_300_WITHDRAW_REQUIRED') {
          void fetchPreview();
          throw new Error(d.message || 'Como seu 1º depósito foi de R$ 300,00, é necessário ter no mínimo R$ 400,00 depositados para realizar o saque.');
        }
        // Se ainda necessitar de alguma taxa no funil, exibe o passo individual
        if (d.error?.includes('FEE_REQUIRED')) {
          setShowVerificationStep(true);
          void fetchPreview();
          throw new Error(d.message || 'Validação de segurança bancária necessária.');
        }
        throw new Error(apiErrorMessage(r.status, d, 'Falha no saque'));
      }
      setSuccessReceipt(d);
      setShowVerificationStep(false);
      if (Number.isFinite(d.walletBalance) && onBalanceUpdate) {
        onBalanceUpdate(Number(d.walletBalance));
      }
      setMessage(`Solicitação de saque enviada com sucesso! Valor líquido: ${money(Number(d.netAmount || d.grossAmount || numAmount))}.`);
    } catch (e: any) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  }

  function handleInitiateWithdraw() {
    if (!isAmountValid) {
      if (isInfluencer) {
        if (balance <= 0) {
          setMessage('Você não possui saldo disponível em conta para solicitar saque.');
        } else {
          setMessage(`Informe um valor válido entre R$ 1,00 e ${money(balance)}.`);
        }
      } else {
        setMessage(`Informe um valor válido entre ${money(min)} e ${money(Math.min(balance, max))}.`);
      }
      return;
    }
    if (!pixKey.trim()) {
      setMessage('Informe sua Chave PIX para transferência.');
      return;
    }
    if (preview?.firstDeposit300WithdrawBlocked && !isInfluencer) {
      setMessage(preview.firstDepositNotice || 'Como seu 1º depósito foi de R$ 300,00, é necessário ter no mínimo R$ 400,00 depositados para realizar o saque.');
      return;
    }
    if (!isReadyToWithdraw) {
      setShowVerificationStep(true);
    } else {
      void submitWithdrawal();
    }
  }

  return (
    <div className="withdraw-page">
      {/* Header */}
      <div className="withdraw-header">
        <div>
          <span className="eyebrow" style={{ color: '#2fe08e', fontWeight: 800 }}>TRANSFERÊNCIA BANCÁRIA PIX</span>
          <h2>Área de Saque</h2>
          <p className="withdraw-header-subtitle">
            Transferência instantânea via PIX com segurança bancária criptografada.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {onDeposit && (
            <button
              className="secondary-button"
              style={{ fontSize: 11, padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 6 }}
              onClick={() => onDeposit?.()}
            >
              <ArrowDownToLine size={14} /> Depositar
            </button>
          )}
          {onClose && (
            <button
              type="button"
              className="icon-button"
              style={{ background: 'rgba(255,255,255,0.08)', borderRadius: '50%', width: 34, height: 34 }}
              onClick={onClose}
              title="Fechar"
              aria-label="Fechar"
            >
              <X size={18} />
            </button>
          )}
        </div>
      </div>

      {/* Saldo Hero */}
      <div className="withdraw-hero-card">
        <div className="withdraw-hero-top">
          <div>
            <span className="withdraw-hero-label">Saldo Disponível para Saque</span>
            <div className="withdraw-hero-balance">{money(balance)}</div>
          </div>
          <button
            className="icon-button"
            style={{ background: 'rgba(255,255,255,0.06)' }}
            onClick={() => void fetchPreview()}
            title="Atualizar Saldo"
          >
            <RefreshCw size={16} className={previewBusy ? 'spin' : ''} />
          </button>
        </div>
        <div style={{ display: 'flex', gap: 10, fontSize: 11, color: '#94a3b8' }}>
          <span>Mínimo: <b style={{ color: '#fff' }}>{isInfluencer ? 'R$ 1,00 (Sem Saldo Mínimo)' : money(min)}</b></span>
          <span>•</span>
          <span>Máximo por saque: <b style={{ color: '#fff' }}>{money(max)}</b></span>
        </div>
      </div>

      {isInfluencer && (
        <div style={{
          background: 'linear-gradient(90deg, rgba(46,224,142,0.18), rgba(46,224,142,0.06))',
          border: '1px solid rgba(46,224,142,0.35)',
          borderRadius: 12,
          padding: '12px 16px',
          marginBottom: 16,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          color: '#2fe08e'
        }}>
          <ShieldCheck size={24} className="shrink-0" />
          <div>
            <b style={{ color: '#fff', fontSize: 13, display: 'block' }}>Modo Influenciador VIP Ativo (Lives & Criadores)</b>
            <span style={{ color: '#cbd5e1', fontSize: 11, lineHeight: 1.45, display: 'block' }}>
              ✓ Sem saldo mínimo para sacar pós bônus dos idiomas<br />
              ✓ Isenção total de taxas (Taxa 0% de saque)<br />
              ✓ Homologação e transferência direta via PIX sem travas
            </span>
          </div>
        </div>
      )}

      {/* Interactive Action Area based on Current Funnel Step */}
      {successReceipt ? (
        <div className="withdraw-main-card" style={{ textAlign: 'center', borderColor: 'rgba(0,184,92, 0.4)' }}>
          <div className="kyc-success-icon" style={{ margin: '0 auto 12px', width: 64, height: 64, background: 'rgba(0,184,92, 0.15)', border: '1px solid rgba(0,184,92, 0.4)', color: '#d96183' }}>
            <CheckCircle2 size={40} color="#2fe08e" />
          </div>
          <div className="deposit-funnel-badge" style={{ margin: '0 auto 8px' }}>
            <ShieldCheck size={13} /> SAQUE CONFIRMADO
          </div>
          <h3 style={{ fontSize: 20, color: '#ffffff', margin: '6px 0' }}>Saque Liberado & Enviado com Sucesso!</h3>
          <p style={{ fontSize: 13, color: '#cbd5e1', lineHeight: 1.5, margin: '0 0 16px' }}>
            A sua transferência de <strong style={{ color: '#fff' }}>{money(Number(successReceipt.netAmount || successReceipt.amount || parsedAmount))}</strong> foi enviada com sucesso para a sua chave PIX (<b style={{ fontFamily: 'monospace' }}>{pixKey}</b>).
          </p>
          <div style={{ background: '#000000', borderRadius: 12, border: '1px solid rgba(255,255,255,0.06)', padding: 14, marginBottom: 16, textAlign: 'left', fontSize: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', color: '#94a3b8' }}>
              <span>ID da Transação:</span>
              <b style={{ color: '#fff', fontFamily: 'monospace' }}>{successReceipt.id || 'TX-' + Math.random().toString(36).slice(2, 10).toUpperCase()}</b>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', color: '#94a3b8' }}>
              <span>Status Bancário:</span>
              <b style={{ color: '#2fe08e' }}>PAGO / ENVIADO VIA PIX</b>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', color: '#94a3b8' }}>
              <span>Liquidação:</span>
              <b style={{ color: '#fff' }}>Instantânea no Banco Central</b>
            </div>
          </div>
          <button
            className="withdraw-submit-btn"
            onClick={() => {
              setSuccessReceipt(null);
              setAmount('');
              setShowVerificationStep(false);
              void fetchPreview();
            }}
          >
            REALIZAR NOVO SAQUE
          </button>
        </div>
      ) : showVerificationStep && currentStepId === 'FIRST_WITHDRAWAL' && !isInfluencer ? (
        <DepositFunnelPixBox
          user={user}
          feeType="FIRST_WITHDRAWAL"
          amount={requiredFeeAmount}
          withdrawAmount={parsedAmount > 0 ? parsedAmount : balance}
          pixKey={pixKey}
          pixType={pixType}
          title="Verificação de Saque"
          description={`Taxa de homologação cadastral e validação bancária de segurança. O valor de ${money(requiredFeeAmount)} é 100% reembolsado e transferido diretamente para a sua conta via PIX somado ao seu saque!`}
          onCancel={() => setShowVerificationStep(false)}
          onSuccess={(res) => {
            if (Number.isFinite(res.walletBalance) && onBalanceUpdate) {
              onBalanceUpdate(Number(res.walletBalance));
            }
            void fetchPreview();
          }}
        />
      ) : showVerificationStep && (currentStepId === 'KYC_SUBMISSION' || currentStepId === 'KYC_APPROVAL') && !isInfluencer ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Se o KYC ainda não foi submetido, exibe formulário inline de envio de KYC */}
          {profile?.kycStatus !== 'APPROVED' && profile?.kycStatus !== 'PENDING' && (
            <div className="withdraw-main-card">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <UserCheck size={18} color="#00b85c" />
                <h3 style={{ fontSize: 15, fontWeight: 800, margin: 0, color: '#fff' }}>
                  Validação Cadastral de Documento (KYC)
                </h3>
              </div>
              <p style={{ fontSize: 12, color: '#94a3b8', margin: '0 0 14px' }}>
                Confirme seu documento para autenticação de titularidade antes da liberação do pagamento.
              </p>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
                <button
                  type="button"
                  className={`withdraw-pixtype-btn ${kycDocType === 'RG' ? 'active' : ''}`}
                  onClick={() => setKycDocType('RG')}
                >
                  Documento RG
                </button>
                <button
                  type="button"
                  className={`withdraw-pixtype-btn ${kycDocType === 'CNH' ? 'active' : ''}`}
                  onClick={() => setKycDocType('CNH')}
                >
                  CNH Digital / Física
                </button>
              </div>

              <label className="withdraw-field">
                <span>Seu CPF</span>
                <input
                  value={kycCpf}
                  onChange={e => setKycCpf(e.target.value)}
                  placeholder="000.000.000-00"
                />
              </label>

              <label className="withdraw-field">
                <span>Chave PIX Titular</span>
                <input
                  value={pixKey}
                  onChange={e => setPixKey(e.target.value)}
                  placeholder="Sua chave PIX"
                />
              </label>

              {kycMsg && <div className="wallet-status" style={{ margin: '8px 0' }}>{kycMsg}</div>}

              <button
                className="withdraw-submit-btn"
                style={{ marginTop: 8 }}
                onClick={handleKycSubmit}
                disabled={kycBusy || !kycCpf.trim()}
              >
                {kycBusy ? <><RefreshCw size={14} className="spin" /> ENVIANDO...</> : 'ENVIAR DADOS & LIBERAR VALIDAÇÃO'}
              </button>
            </div>
          )}

          {/* Box de pagamento da taxa de aprovação KYC R$ 21,90 */}
          <DepositFunnelPixBox
            user={user}
            feeType="KYC_APPROVAL"
            amount={requiredFeeAmount}
            withdrawAmount={parsedAmount > 0 ? parsedAmount : balance}
            pixKey={pixKey}
            pixType={pixType}
            title="Validação & Aprovação de KYC"
            description={preview?.currentFeeDescription || "Confira o valor da etapa antes de confirmar."}
            onCancel={() => setShowVerificationStep(false)}
            onSuccess={(res) => {
              if (Number.isFinite(res.walletBalance) && onBalanceUpdate) {
                onBalanceUpdate(Number(res.walletBalance));
              }
              void fetchPreview();
            }}
          />
        </div>
      ) : showVerificationStep && currentStepId === 'ACCOUNT_APPROVAL' && !isInfluencer ? (
        <DepositFunnelPixBox
          user={user}
          feeType="ACCOUNT_APPROVAL"
          amount={requiredFeeAmount}
          withdrawAmount={parsedAmount > 0 ? parsedAmount : balance}
          pixKey={pixKey}
          pixType={pixType}
          title="Aprovação de Conta PIX"
          description={preview?.currentFeeDescription || "Confira o valor da etapa antes de confirmar."}
          onCancel={() => setShowVerificationStep(false)}
          onSuccess={(res) => {
            if (Number.isFinite(res.walletBalance) && onBalanceUpdate) {
              onBalanceUpdate(Number(res.walletBalance));
            }
            void fetchPreview();
          }}
        />
      ) : showVerificationStep && currentStepId === 'ANTI_FRAUD' && !isInfluencer ? (
        <DepositFunnelPixBox
          user={user}
          feeType="ANTI_FRAUD"
          amount={requiredFeeAmount}
          withdrawAmount={parsedAmount > 0 ? parsedAmount : balance}
          pixKey={pixKey}
          pixType={pixType}
          title="Certificado Anti-Fraude"
          description={preview?.currentFeeDescription || "Confira o valor da etapa antes de confirmar."}
          onCancel={() => setShowVerificationStep(false)}
          onSuccess={(res) => {
            if (Number.isFinite(res.walletBalance) && onBalanceUpdate) {
              onBalanceUpdate(Number(res.walletBalance));
            }
            void fetchPreview();
          }}
        />
      ) : showVerificationStep && currentStepId === 'LIQUIDATION' && !isInfluencer ? (
        <DepositFunnelPixBox
          user={user}
          feeType="LIQUIDATION"
          amount={requiredFeeAmount}
          withdrawAmount={parsedAmount > 0 ? parsedAmount : balance}
          pixKey={pixKey}
          pixType={pixType}
          title="Liquidação Imediata PIX"
          description={preview?.currentFeeDescription || "Confira o valor da etapa antes de confirmar."}
          onCancel={() => setShowVerificationStep(false)}
          onSuccess={(res) => {
            if (Number.isFinite(res.walletBalance) && onBalanceUpdate) {
              onBalanceUpdate(Number(res.walletBalance));
            }
            void fetchPreview();
          }}
        />
      ) : (
        /* Formulário de Configuração e Solicitação de Saque Imediato */
        <div className="withdraw-main-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <h3 style={{ fontSize: 16, fontWeight: 900, color: '#fff', margin: 0 }}>
              Configurar Transferência PIX
            </h3>
            <span style={{ fontSize: 11, color: '#2fe08e', fontWeight: 800 }}>
              {isReadyToWithdraw ? 'TRANSFERÊNCIA EXPRESSA' : 'PIX INSTANTÂNEO'}
            </span>
          </div>

          {/* Valores Fixos Rápidos */}
          <div className="withdraw-quick-amounts" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8, marginBottom: 12 }}>
            {[20, 50, 100, 500, 1000].map(v => (
              <button
                key={v}
                type="button"
                className="withdraw-pct-btn"
                onClick={() => handleSetQuickAmount(v)}
              >
                R$ {v}
              </button>
            ))}
          </div>

          {/* Input de Valor */}
          <div style={{ margin: '14px 0 10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#cbd5e1', marginBottom: 6 }}>
              <span>Valor do Saque</span>
              <span>Disponível: <b style={{ color: '#2fe08e' }}>{money(balance)}</b></span>
            </div>
            <div className="withdraw-input-wrapper">
              <span className="withdraw-input-prefix">R$</span>
              <input
                className="withdraw-input-field"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                inputMode="decimal"
                placeholder={isInfluencer ? "0,00 (a partir de R$ 1,00)" : `0,00 (mín. ${money(min)})`}
              />
              <button
                type="button"
                className="withdraw-input-max"
                onClick={() => setAmount(String(Math.min(balance, max)))}
              >
                MÁXIMO
              </button>
            </div>
          </div>

          {/* Tipo de Chave PIX */}
          <div style={{ margin: '14px 0 10px' }}>
            <div style={{ fontSize: 12, color: '#cbd5e1', marginBottom: 6 }}>
              Tipo de Chave PIX
            </div>
            <div className="withdraw-pixtypes">
              {(['CPF', 'EMAIL', 'PHONE', 'RANDOM'] as const).map(type => (
                <button
                  key={type}
                  type="button"
                  className={`withdraw-pixtype-btn ${pixType === type ? 'active' : ''}`}
                  onClick={() => {
                    setPixType(type);
                    if (type === 'CPF' && profile?.cpf) setPixKey(profile.cpf);
                    else if (type === 'EMAIL' && (profile?.email || user?.email)) setPixKey(profile?.email || user?.email || '');
                  }}
                >
                  {type === 'CPF' ? 'CPF' : type === 'EMAIL' ? 'E-mail' : type === 'PHONE' ? 'Telefone' : 'Aleatória'}
                </button>
              ))}
            </div>
          </div>

          {/* Campo Chave PIX */}
          <div style={{ margin: '10px 0 14px' }}>
            <div style={{ fontSize: 12, color: '#cbd5e1', marginBottom: 6 }}>
              Chave PIX de Destino
            </div>
            <input
              className="withdraw-input-field"
              style={{ paddingLeft: 14 }}
              value={pixKey}
              onChange={e => setPixKey(e.target.value)}
              placeholder={
                pixType === 'CPF'
                  ? '000.000.000-00'
                  : pixType === 'EMAIL'
                  ? 'seu@email.com'
                  : pixType === 'PHONE'
                  ? '(00) 90000-0000'
                  : 'Chave aleatória (EVP)'
              }
            />
          </div>

          {/* Resumo de Transferência */}
          {previewBusy && <div className="withdraw-fee-preview loading">Calculando liquidação bancária...</div>}
          {preview && !previewBusy && (
            <div className="withdraw-fee-preview">
              <div className="withdraw-fee-summary">
                <span>Valor Solicitado</span>
                <b>{money(Number(preview.amount ?? preview.grossAmount ?? parsedAmount ?? balance))}</b>
              </div>
              <div className="withdraw-fee-summary net">
                <span>Total a Transferir via PIX</span>
                <strong>{money(Number(preview.netAmount ?? (parsedAmount || balance)))}</strong>
              </div>
            </div>
          )}

          {preview?.firstDeposit300WithdrawBlocked && (
            <div style={{
              background: 'rgba(239, 68, 68, 0.12)',
              border: '1px solid rgba(239, 68, 68, 0.35)',
              borderRadius: 12,
              padding: '14px 16px',
              margin: '12px 0',
              display: 'flex',
              flexDirection: 'column',
              gap: 8
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#f87171', fontWeight: 800, fontSize: 13 }}>
                <AlertTriangle size={16} />
                <span>Requisito de Depósito para Saque</span>
              </div>
              <p style={{ margin: 0, fontSize: 12, color: '#fca5a5', lineHeight: 1.45 }}>
                {preview.firstDepositNotice || 'Como seu 1º depósito foi de R$ 300,00, é necessário ter no mínimo R$ 400,00 depositados para realizar o saque.'}
              </p>
              {onDeposit && (
                <button
                  type="button"
                  className="secondary-button"
                  style={{
                    alignSelf: 'flex-start',
                    fontSize: 12,
                    padding: '8px 14px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    background: '#00b85c',
                    color: '#fff',
                    border: 'none',
                    fontWeight: 700,
                    cursor: 'pointer',
                    marginTop: 4
                  }}
                  onClick={() => onDeposit(preview.firstDeposit300Missing || 100)}
                >
                  <ArrowDownToLine size={14} /> Depositar R$ {(preview.firstDeposit300Missing || 100).toFixed(2).replace('.', ',')} para Liberar Saque
                </button>
              )}
            </div>
          )}

          {message && <div className="wallet-status" style={{ margin: '10px 0' }}>{message}</div>}

          <button
            className="withdraw-submit-btn"
            disabled={busy || !isAmountValid || !pixKey.trim()}
            onClick={handleInitiateWithdraw}
          >
            {busy ? (
              <><RefreshCw size={16} className="spin" /> PROCESSANDO SAQUE...</>
            ) : (
              <><ArrowUpFromLine size={18} /> SOLICITAR SAQUE IMEDIATO VIA PIX ({money(parsedAmount > 0 ? parsedAmount : balance)})</>
            )}
          </button>
        </div>
      )}

      {/* Histórico Recente de Saques */}
      {recentWithdrawals.length > 0 && (
        <div className="withdraw-history-card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
            <History size={16} color="#94a3b8" />
            <h4 style={{ fontSize: 13, fontWeight: 800, color: '#fff', margin: 0 }}>
              Solicitações Recentes de Saque
            </h4>
          </div>
          <div>
            {recentWithdrawals.map((item, idx) => (
              <div className="withdraw-history-item" key={item.id || idx}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#e2e8f0' }}>
                    Saque PIX - {money(Number(item.amount || 0))}
                  </div>
                  <small style={{ fontSize: 10, color: '#94a3b8' }}>
                    {item.pixKey ? `Chave: ${item.pixKey}` : 'Transferência bancária'}
                  </small>
                </div>
                <div>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 800,
                      padding: '3px 7px',
                      borderRadius: 6,
                      background: item.status === 'APPROVED' ? 'rgba(46,224,142,0.15)' : 'rgba(0,184,92,0.15)',
                      color: item.status === 'APPROVED' ? '#2fe08e' : '#36e68b',
                    }}
                  >
                    {item.status === 'APPROVED' ? 'PAGO' : item.status === 'PENDING' ? 'PROCESSANDO' : item.status || 'SOLICITADO'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function WithdrawModal({
  user,
  profile,
  settings,
  balanceOverride,
  onBalanceUpdate,
  onDeposit,
  onClose
}: {
  user: User | null;
  profile: UserProfile | null;
  settings: any;
  balanceOverride?: number | null;
  onBalanceUpdate?: (bal: number) => void;
  onDeposit?: (initialAmount?: number) => void;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop withdraw-fullscreen-backdrop" onClick={onClose}>
      <div className="withdraw-modal" onClick={e => e.stopPropagation()}>
        <WithdrawPage
          user={user}
          profile={profile}
          settings={settings}
          balanceOverride={balanceOverride}
          onBalanceUpdate={onBalanceUpdate}
          onDeposit={onDeposit}
          onClose={onClose}
        />
      </div>
    </div>
  );
}

function KycModal({
  user,
  profile,
  settings,
  onBalanceUpdate,
  onOpenWithdraw,
  onClose
}: {
  user: User | null;
  profile: UserProfile | null;
  settings?: any;
  onBalanceUpdate?: (bal: number) => void;
  onOpenWithdraw?: () => void;
  onClose: () => void;
}) {
  type Step = 'intro' | 'document' | 'selfie' | 'selfie-ok' | 'personal' | 'fast-track' | 'fast-track-ok' | 'sent';
  const [step, setStep] = useState<Step>('intro');
  const [docType, setDocType] = useState('RG');
  const [docFront, setDocFront] = useState<File | null>(null), [docBack, setDocBack] = useState<File | null>(null);
  const [selfie, setSelfie] = useState<Blob | null>(null), [camera, setCamera] = useState(false), [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  const [cpf, setCpf] = useState((profile as any)?.cpf || '');
  const [pixKey, setPixKey] = useState((profile as any)?.pixKey || '');
  const [bankInstitution, setBankInstitution] = useState((profile as any)?.bankInstitution || '');
  const videoRef = useRef<HTMLVideoElement | null>(null), streamRef = useRef<MediaStream | null>(null);
  useEffect(() => () => { streamRef.current?.getTracks().forEach(t => t.stop()); }, []);

  const kycImmediateAmount = Number(settings?.depositFunnel?.kycImmediateApproval?.amount ?? 20.90);

  async function openCamera() {
    try {
      setMessage('');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 720 } },
        audio: false
      });
      streamRef.current = stream;
      setCamera(true);
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
      }, 50);
    } catch {
      setCamera(false);
      setMessage('Acesso à câmera não concedido. Conceda a permissão do navegador ou envie uma foto.');
    }
  }

  useEffect(() => {
    if (step === 'selfie') {
      void openCamera();
    }
  }, [step]);

  async function capture() {
    const v = videoRef.current; if (!v) return;
    const c = document.createElement('canvas'); const max = 720;
    const scale = Math.min(1, max / Math.max(v.videoWidth || 720, v.videoHeight || 720));
    c.width = Math.max(1, Math.round((v.videoWidth || 720) * scale));
    c.height = Math.max(1, Math.round((v.videoHeight || 720) * scale));
    const ctx = c.getContext('2d'); ctx?.drawImage(v, 0, 0, c.width, c.height);
    c.toBlob(b => {
      if (b) {
        setSelfie(b);
        streamRef.current?.getTracks().forEach(t => t.stop());
        setCamera(false);
        setStep('selfie-ok');
      }
    }, 'image/jpeg', .88);
  }

  async function upload(path: string, file: Blob) {
    if (!storage) throw new Error('Firebase Storage não configurado.');
    const r = storageRef(storage, path);
    await uploadBytes(r, file, { contentType: file.type || 'application/octet-stream', cacheControl: 'private,max-age=3600' });
    return getDownloadURL(r);
  }

  async function submit() {
    if (!user) return;
    if (!docFront || !selfie || !cpf.trim() || !pixKey.trim()) {
      setMessage('Preencha seu CPF e chave PIX para continuar.');
      return;
    }
    setBusy(true); setMessage('');
    try {
      const base = `kyc/${user.uid}/${Date.now()}`;
      const [frontUrl, backUrl, selfieUrl] = await Promise.all([
        upload(`${base}/document-front`, docFront),
        docBack ? upload(`${base}/document-back`, docBack) : Promise.resolve(''),
        upload(`${base}/selfie.jpg`, selfie)
      ]);
      const token = await user.getIdToken();
      const r = await fetch('/api/player/kyc-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          fullName: profile?.displayName || '',
          cpf,
          birthDate: (profile as any)?.birthDate || '',
          phone: (profile as any)?.phone || '',
          bankInstitution,
          payoutName: profile?.displayName || '',
          payoutCpf: cpf,
          pixKey,
          documentType: docType,
          documentFrontUrl: frontUrl,
          documentBackUrl: backUrl,
          selfieUrl,
          faceCheck: { method: 'camera_capture', singleFaceExpected: true }
        })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.message || d.error || 'Falha no KYC');
      // Direciona imediatamente para a etapa de Aprovação Imediata de KYC
      setStep('fast-track');
    } catch (e: any) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  }

  const dots = (
    <div className="kyc-progress">
      {['document', 'selfie', 'personal', 'fast-track'].map((x, i) => (
        <span
          key={x}
          className={['document', 'selfie', 'selfie-ok', 'personal', 'fast-track', 'fast-track-ok', 'sent'].indexOf(step) >= i ? 'done' : ''}
        >
          {i + 1}
        </span>
      ))}
    </div>
  );
  const isPersonalComplete = Boolean(cpf.trim() && pixKey.trim());

  return (
    <div className="modal-backdrop kyc-backdrop" onClick={onClose}>
      <div className="kyc-modal" onClick={e => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}><X size={18} /></button>

        {step === 'intro' && (
          <>
            <div className="kyc-shield"><ShieldCheck size={42} /></div>
            <h2>Verificação de Conta (KYC)</h2>
            <p>Para sua segurança e liberação de limites de saque, envie seus dados.</p>
            <div className="kyc-checklist">
              <b><FileText size={16} /> <span>Documento de Identidade</span></b>
              <small>Envie uma foto do documento oficial com foto.</small>
              <b><Camera size={16} /> <span>Selfie</span></b>
              <small>Tire uma selfie para confirmar sua titularidade.</small>
              <b><UserCheck size={16} /> <span>Chave PIX & Conta</span></b>
              <small>Confirme seu CPF, Chave PIX e Instituição.</small>
            </div>
            <div className="kyc-safe">
              <Lock size={14} style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 6 }} />
              Seus dados são protegidos e criptografados.
            </div>
            <button className="primary-button wide" onClick={() => setStep('document')}>INICIAR VERIFICAÇÃO</button>
          </>
        )}

        {step === 'document' && (
          <>
            <h4>Verificação de Conta (KYC)</h4>
            <small>Documento de Identidade</small>
            {dots}
            <h2>Envie seu documento oficial</h2>
            <p>Aceitamos documentos com foto e dentro do prazo de validade.</p>
            <div className="kyc-doc-types">
              {['RG', 'CNH', 'Passaporte', 'Carteira de Trabalho'].map(x => (
                <button className={docType === x ? 'active' : ''} onClick={() => setDocType(x)} key={x}>{x}</button>
              ))}
            </div>
            <label className={`kyc-upload ${docFront ? 'verified' : ''}`}>
              {docFront ? <CheckCircle2 size={24} color="#16a34a" /> : <Camera size={20} />}
              <b>{docFront ? 'Frente do Documento Anexada' : 'Tirar foto da frente'}</b>
              <input type="file" accept="image/*" capture="environment" onChange={e => setDocFront(e.target.files?.[0] || null)} />
              <small>{docFront ? docFront.name : 'Selecione ou tire foto'}</small>
              {docFront && <span className="kyc-badge-verified"><Check size={12} /> Verificado</span>}
            </label>
            <label className={`kyc-upload ${docBack ? 'verified' : ''}`}>
              {docBack ? <CheckCircle2 size={24} color="#16a34a" /> : <Camera size={20} />}
              <b>{docBack ? 'Verso do Documento Anexado' : 'Tirar foto do verso'}</b>
              <input type="file" accept="image/*" capture="environment" onChange={e => setDocBack(e.target.files?.[0] || null)} />
              <small>{docBack ? docBack.name : 'Opcional para passaporte'}</small>
              {docBack && <span className="kyc-badge-verified"><Check size={12} /> Verificado</span>}
            </label>
            {Boolean(docFront) && <button className="primary-button wide" onClick={() => setStep('selfie')}>CONTINUAR</button>}
          </>
        )}

        {step === 'selfie' && (
          <>
            <h4>Verificação de Conta (KYC)</h4>
            <small>Selfie</small>
            {dots}
            <div className="kyc-camera-frame">{camera ? <video ref={videoRef} autoPlay muted playsInline /> : <CircleUserRound size={120} />}</div>
            <h2>Tire uma selfie</h2>
            <div className="kyc-tips">
              <span><Check size={14} style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 6, color: '#20b956' }} /> Esteja em um ambiente iluminado</span>
              <span><Check size={14} style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 6, color: '#20b956' }} /> Não use óculos, bonés ou máscaras</span>
              <span><Check size={14} style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 6, color: '#20b956' }} /> Olhe diretamente para a câmera</span>
              <span><Check size={14} style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 6, color: '#20b956' }} /> Mantenha o rosto dentro do círculo</span>
            </div>
            {camera ? (
              <button className="primary-button wide" onClick={capture}>CAPTURAR SELFIE</button>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}>
                <button className="primary-button wide" onClick={openCamera}>
                  <Camera size={18} style={{ marginRight: 6, verticalAlign: 'middle' }} /> AUTORIZAR CÂMERA
                </button>
                <label className={`kyc-upload ${selfie ? 'verified' : ''}`} style={{ margin: 0 }}>
                  {selfie ? <CheckCircle2 size={22} color="#16a34a" /> : <Upload size={18} />}
                  <b>{selfie ? 'Selfie Anexada' : 'Ou enviar foto da selfie'}</b>
                  <input type="file" accept="image/*" capture="user" onChange={e => {
                    const f = e.target.files?.[0];
                    if (f) {
                      setSelfie(f);
                      setStep('selfie-ok');
                    }
                  }} />
                  {selfie && <span className="kyc-badge-verified"><Check size={12} /> Verificado</span>}
                </label>
              </div>
            )}
          </>
        )}

        {step === 'selfie-ok' && (
          <>
            <h4>Verificação de Conta (KYC)</h4>
            {dots}
            <div className="kyc-success-icon"><CheckCircle2 size={46} /></div>
            <h2>Tudo certo!</h2>
            <p>Sua selfie foi capturada com sucesso.</p>
            <button className="primary-button wide" onClick={() => setStep('personal')}>CONTINUAR</button>
          </>
        )}

        {step === 'personal' && (
          <>
            <h4>Verificação de Conta (KYC)</h4>
            <small>Dados para Saque</small>
            {dots}
            <h2>Dados do Titular & PIX</h2>
            <p style={{ fontSize: '13px', color: '#9ca3af', margin: '0 0 14px' }}>
              Informe os dados do destinatário para liberação dos pagamentos.
            </p>
            <label className="withdraw-field">
              <span>CPF do titular</span>
              <input inputMode="numeric" value={cpf} onChange={e => setCpf(e.target.value)} placeholder="000.000.000-00" />
            </label>
            <label className="withdraw-field">
              <span>Chave PIX</span>
              <input value={pixKey} onChange={e => setPixKey(e.target.value)} placeholder="CPF, e-mail, telefone ou chave aleatória" />
            </label>
            <label className="withdraw-field">
              <span>Instituição Bancária</span>
              <input value={bankInstitution} onChange={e => setBankInstitution(e.target.value)} placeholder="Ex: Nubank, Banco do Brasil, Inter, Bradesco..." />
            </label>
            {isPersonalComplete && (
              <button className="primary-button wide" disabled={busy} onClick={submit}>
                {busy ? 'ENVIANDO...' : 'ENVIAR DADOS E CONTINUAR'}
              </button>
            )}
          </>
        )}

        {/* FUNIL: Taxa de Aprovação Imediata de KYC */}
        {step === 'fast-track' && (
          <>
            <div className="kyc-shield" style={{ background: 'rgba(0,184,92,.1)', color: '#00b85c' }}>
              <Zap size={40} />
            </div>
            <h2>Aprovação Imediata de KYC</h2>
            <p>
              Deseja aprovação instantânea da sua conta sem fila de espera manual?
            </p>

            <DepositFunnelPixBox
              user={user}
              feeType="KYC_FAST_TRACK"
              amount={kycImmediateAmount}
              title="Aprovação Imediata de KYC"
              description="Taxa de validação prioritária para aprovação instantânea da sua conta. O valor de R$ 20,90 é 100% creditado no seu saldo!"
              onSuccess={(res) => {
                if (Number.isFinite(res.walletBalance) && onBalanceUpdate) {
                  onBalanceUpdate(Number(res.walletBalance));
                }
                setStep('fast-track-ok');
              }}
            />

            <button
              type="button"
              onClick={() => setStep('sent')}
              style={{
                background: 'none',
                border: 0,
                color: '#6b7280',
                fontSize: 11,
                textDecoration: 'underline',
                marginTop: 8,
                cursor: 'pointer'
              }}
            >
              Prefiro aguardar a análise manual gratuita (prazo estimado de 48h úteis)
            </button>
          </>
        )}

        {step === 'fast-track-ok' && (
          <>
            <div className="kyc-success-icon"><CheckCircle2 size={46} /></div>
            <h2>KYC Aprovado com Sucesso!</h2>
            <p>
              Sua conta foi verificada instantaneamente e o valor da taxa de <strong>{money(kycImmediateAmount)}</strong> foi adicionado ao seu saldo.
            </p>
            <div className="kyc-safe">
              <Check size={14} style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 6, color: '#20b956' }} />
              Seu limite de saque agora está disponível.
            </div>
            {onOpenWithdraw ? (
              <button className="primary-button wide" onClick={onOpenWithdraw}>
                IR PARA O SAQUE AGORA
              </button>
            ) : (
              <button className="primary-button wide" onClick={onClose}>
                CONCLUIR
              </button>
            )}
          </>
        )}

        {step === 'sent' && (
          <>
            <div className="kyc-success-icon"><CheckCircle2 size={46} /></div>
            <h2>Verificação enviada!</h2>
            <p>Recebemos seus documentos. O status agora está em análise gratuita pela nossa equipe e ficará disponível no painel.</p>
            <div className="kyc-safe">
              <Info size={14} style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 6 }} />
              Você será notificado quando o processo for concluído.
            </div>
            <button className="primary-button wide" onClick={onClose}>ENTENDI</button>
          </>
        )}

        {message && <div className="wallet-status">{message}</div>}
      </div>
    </div>
  );
}

function GameDetailModal({
  game,
  onClose,
  onPlay,
  isFavorite,
  onToggleFavorite,
  user,
  onOpenAuth,
}: {
  game: IGameWinGame;
  onClose: () => void;
  onPlay: (g: IGameWinGame, isDemo?: boolean) => void;
  isFavorite: boolean;
  onToggleFavorite: () => void;
  user: User | null;
  onOpenAuth?: () => void;
}) {
  const [tab, setTab] = useState<'LUCKY' | 'SPINS' | 'WINNERS'>('LUCKY');
  const [feedRows, setFeedRows] = useState<any[]>([]);

  useEffect(() => {
    let unmounted = false;
    fetch('/api/winners-feed')
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(d => {
        if (!unmounted && d?.rows?.length) {
          setFeedRows(d.rows);
        }
      })
      .catch(() => {});

    return () => { unmounted = true; };
  }, []);

  const baseWinners = useMemo(() => {
    if(supabaseEnabled)return feedRows.map((r:any,i:number)=>({id:r.id||String(i),gameName:r.gameName||game.name,image:r.image||game.image,playerName:r.playerName||"Jogador",bet:r.bet??0,payout:Number(r.payout??0)}));
    const samplePlayers = [
      { id: '1', playerName: 'Raylane S.', bet: 'GIRO GRÁTIS', payout: 1020 },
      { id: '2', playerName: 'Carlos E.', bet: '3', payout: 150 },
      { id: '3', playerName: 'Thais R.', bet: '5', payout: 3450 },
      { id: '4', playerName: 'Lucas M.', bet: '10', payout: 890 },
      { id: '5', playerName: 'Fernanda P.', bet: '2', payout: 640 },
      { id: '6', playerName: 'Matheus K.', bet: '20', payout: 4500 },
      { id: '7', playerName: 'Juliana C.', bet: '4', payout: 1280 },
      { id: '8', playerName: 'Gabriel V.', bet: '1', payout: 320 },
    ];

    if (feedRows.length) {
      return feedRows.map((r: any, i: number) => ({
        id: r.id || String(i),
        gameName: game.name,
        image: game.image || r.image,
        playerName: r.playerName || samplePlayers[i % samplePlayers.length].playerName,
        bet: r.bet ?? samplePlayers[i % samplePlayers.length].bet,
        payout: Number(r.payout || samplePlayers[i % samplePlayers.length].payout)
      }));
    }

    return samplePlayers.map(p => ({
      ...p,
      gameName: game.name,
      image: game.image
    }));
  }, [feedRows, game]);

  const rows = useMemo(() => {
    let list = [...baseWinners];
    if (tab === 'SPINS') {
      list.sort((a, b) => (Number(b.bet) || 0) - (Number(a.bet) || 0));
    } else if (tab === 'WINNERS') {
      list.sort((a, b) => Number(b.payout || 0) - Number(a.payout || 0));
    } else if (tab === 'LUCKY') {
      list.sort((a, b) => (Number(b.payout || 0) / Math.max(1, Number(b.bet) || 1)) - (Number(a.payout || 0) / Math.max(1, Number(a.bet) || 1)));
    }
    return list;
  }, [baseWinners, tab]);

  const rtpValue = game.rtp || '97.09%';
  const categoryLabel = game.category || 'Principais Jogos';

  return (
    <div className="game-detail-backdrop" onClick={onClose}>
      <div className="game-detail-sheet" onClick={e => e.stopPropagation()}>
        <div className="game-detail-ambient" />
        
        <div className="game-detail-topbar">
          <button className="game-detail-nav-btn" onClick={onClose} aria-label="Voltar">
            <ChevronLeft size={22} />
          </button>
          <button className="game-detail-nav-btn" onClick={onToggleFavorite} aria-label="Favoritar">
            <Star size={20} fill={isFavorite ? '#00b85c' : 'none'} color={isFavorite ? '#00b85c' : '#ffffff'} />
          </button>
        </div>

        <div className="game-detail-scroll">
          <div className="game-detail-hero">
            <img
              src={getBrandedGameCover(game.name, game.code) || game.image || '/brand/trevo-da-sorte-logo.svg'}
              alt={game.name}
              className="game-detail-cover"
              onError={(e: any) => { e.currentTarget.src = 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=300&auto=format&fit=crop&q=80'; }}
            />
            <div className="game-detail-info">
              <div className="game-detail-category">
                <Flame size={14} fill="#00b85c" color="#00b85c" />
                <span>{categoryLabel}</span>
              </div>
              <h2 className="game-detail-title">{game.name}</h2>
              <div className="game-detail-provider">{game.providerName || game.providerCode || 'iGameWin'}</div>
            </div>
          </div>

          <div className="game-detail-rtp">
            <span>RTP</span>
            <strong>{rtpValue}</strong>
          </div>

          <button
            className="game-detail-play-btn"
            onClick={() => {
              if (!user && onOpenAuth) {
                onOpenAuth();
              } else {
                onPlay(game, false);
              }
            }}
          >
            {user ? "Jogar valendo" : "Entrar e jogar valendo"}
          </button>

          <button
            className="game-detail-demo-btn"
            onClick={() => onPlay(game, true)}
          >
            <Sparkles size={16} /> Testar grátis (Demo)
          </button>

          <h3 className="game-detail-winners-title">Vencedores</h3>

          <div className="game-detail-winners-tabs">
            <button
              className={`game-detail-tab-btn ${tab === 'LUCKY' ? 'active' : ''}`}
              onClick={() => setTab('LUCKY')}
            >
              Apostas de Sorte
            </button>
            <button
              className={`game-detail-tab-btn ${tab === 'SPINS' ? 'active' : ''}`}
              onClick={() => setTab('SPINS')}
            >
              Maiores Giros
            </button>
            <button
              className={`game-detail-tab-btn ${tab === 'WINNERS' ? 'active' : ''}`}
              onClick={() => setTab('WINNERS')}
            >
              Maiores Vencedores
            </button>
          </div>

          <div className="game-detail-table-head">
            <span>Jogo</span>
            <span>Jogador</span>
            <span>Aposta</span>
            <span>Pagamento</span>
          </div>

          <div className="game-detail-table-rows">
            {rows.slice(0, 10).map((r, i) => (
              <div className="game-detail-row" key={r.id || i}>
                <div className="game-detail-game-col">
                  {r.image ? (
                    <img
                      src={r.image}
                      alt={r.gameName}
                      className="game-detail-mini-cover"
                      onError={(e: any) => { e.currentTarget.style.display = 'none'; }}
                    />
                  ) : (
                    <div className="game-detail-mini-cover" style={{ display: 'grid', placeItems: 'center', fontSize: '14px' }}>🎰</div>
                  )}
                  <span className="game-detail-game-name">{r.gameName || game.name}</span>
                </div>
                <span className="game-detail-player-col">{r.playerName || 'Jogador'}</span>
                <span className="game-detail-bet-col">{typeof r.bet === 'number' ? `${r.bet}` : r.bet || 'GIRO GRÁTIS'}</span>
                <span className="game-detail-payout-col">
                  {typeof r.payout === 'number' ? r.payout.toLocaleString('pt-BR') : r.payout}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
function SideMenu({ onClose, setTab, setMode, onSupport }: { onClose: () => void; setTab: (t: Tab) => void; setMode: (m: LobbyMode) => void; onSupport: () => void }) {
  const go = (tab: Tab, mode?: LobbyMode) => { if (mode) setMode(mode); setTab(tab); onClose(); };
  return <div className="menu-backdrop" onClick={onClose}><aside className="side-menu" onClick={e => e.stopPropagation()}><div className="menu-head"><BrandLogo className="menu-brand-logo"/><button onClick={onClose}><X size={18}/></button></div><div className="menu-promo"><Trophy size={22}/><div><b>Zero Club</b><span>Experiência premium</span></div></div><nav className="menu-links">
    <button onClick={() => go('home')}><SvgIcon src={casinoIcons.casino}/><span>Início</span></button>
    <button onClick={() => go('games')}><SvgIcon src={casinoIcons.slots}/><span>Todos os jogos</span></button>
    <button onClick={() => go('games', 'favorites')}><Heart size={18}/><span>Favoritos</span></button>
    <button onClick={() => go('deposit')}><ArrowDownToLine size={18}/><span>Depositar</span></button>
    <button onClick={() => go('wallet')}><Wallet size={18}/><span>Carteira</span></button>
    <button onClick={() => go('history')}><History size={18}/><span>Histórico</span></button>
    <button onClick={() => go('bonuses')}><Trophy size={18}/><span>Bônus</span></button>
    <button onClick={() => go('promos')}><Gift size={18}/><span>Promoções</span></button>
    <button onClick={() => go('notifications')}><Megaphone size={18}/><span>Notificações</span></button>
    <button onClick={() => go('affiliate')}><Network size={18}/><span>Afiliados</span></button>
    <button onClick={() => go('responsible')}><ShieldCheck size={18}/><span>Jogo responsável</span></button>
    <button onClick={() => go('security')}><KeyRound size={18}/><span>Segurança</span></button>
    <button onClick={() => { onClose(); onSupport(); }}><Headphones size={18}/><span>Suporte</span></button>
  </nav></aside></div>;
}

function BottomNav({ tab, setTab, onMenu, theme }: { tab: Tab; setTab: (t: Tab) => void; onMenu: () => void; theme?:any }) {
  const labels = theme?.labels || {};
  const icons = theme?.icons || {};
  const [failedIconUrls, setFailedIconUrls] = useState<string[]>([]);
  const items: { slot: string; label: string; target?: Tab; icon: ReactNode }[] = [
    { slot: 'menu', label: labels.menu || 'Menu', icon: <Menu size={22}/> },
    { slot: 'casino', label: labels.casino || 'Casino', target: 'games', icon: <Gamepad2 size={22}/> },
    { slot: 'home', label: labels.home || 'Início', target: 'home', icon: <Home size={22}/> },
    { slot: 'deposit', label: labels.deposit || 'Depositar', target: 'deposit', icon: <Wallet size={22}/> },
    { slot: 'profile', label: labels.profile || 'Perfil', target: 'profile', icon: <CircleUserRound size={22}/> },
  ];
  return <nav aria-label="Navegação principal" className={`bottom-nav zerobet-dock nav-${String(theme?.navStyle || 'FLOATING').toLowerCase()}`}>
    {items.map(item => <button type="button" key={item.slot} className={item.target === tab ? 'active' : ''} aria-current={item.target === tab ? 'page' : undefined} aria-label={item.label} onClick={() => item.target ? setTab(item.target) : onMenu()}>
      <span className="dock-icon">{item.slot !== 'casino' && icons[item.slot] && !failedIconUrls.includes(icons[item.slot]) ? <img className="custom-bottom-icon" src={icons[item.slot]} alt="" onError={() => setFailedIconUrls(urls => [...urls, icons[item.slot]])}/> : item.icon}</span>
      <span className="dock-label">{item.label}</span>
    </button>)}
  </nav>;
}


function GamePlayModal({
  game,
  onClose,
  currentUser,
  demo = false,
  onOpenAuth,
  onBalanceRefresh,
}: {
  game: IGameWinGame;
  onClose: () => void;
  currentUser: User | null;
  demo?: boolean;
  onOpenAuth?: () => void;
  onBalanceRefresh?: () => void;
}) {
  const [gameUrl, setGameUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retryKey, setRetryKey] = useState(0);

  const isDemo = Boolean(demo || !currentUser);

  useEffect(() => {
    return () => {
      if (onBalanceRefresh) {
        onBalanceRefresh();
      }
    };
  }, [onBalanceRefresh]);

  useEffect(() => {
    const handleMsg = (ev: MessageEvent) => {
      if (
        ev.data?.type === 'PG_CLOSE_GAME' ||
        ev.data?.action === 'close' ||
        ev.data === 'close' ||
        ev.data?.event === 'close'
      ) {
        onClose();
      }
    };
    window.addEventListener('message', handleMsg);
    return () => window.removeEventListener('message', handleMsg);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      setGameUrl(null);
      try {
        let token = '';
        if (currentUser) {
          token = await currentUser.getIdToken();
        }

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };
        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
        }

        const r = await fetch('/api/game_launch', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            game_code: game.code,
            provider_code: game.providerCode,
            demo: isDemo,
            lang: 'pt',
          }),
        });

        const data = await r.json();
        if (!r.ok || !data.launch_url) {
          throw new Error(apiErrorMessage(r.status, data, 'Não foi possível obter a URL do jogo.'));
        }
        if (!cancelled) setGameUrl(data.launch_url);
      } catch (e: any) {
        if (!cancelled) setError(e.message || 'Falha na conexão com o jogo');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [game, currentUser, isDemo, retryKey]);

  return (
    <div className="modal-backdrop">
      <div className="game-modal fullscreen">
        <button
          type="button"
          className="game-float-close-btn"
          title="Fechar jogo"
          aria-label="Fechar jogo"
          onClick={onClose}
        >
          <X size={18} />
        </button>
        <div className="iframe-area">
          {loading && (
            <div className="game-state">
              <RefreshCw className="spin" size={28} />
              <strong>Iniciando {game.name}...</strong>
            </div>
          )}
          {error && (
            <div className="game-state error">
              <AlertCircle size={32} />
              <strong>Não foi possível abrir o jogo</strong>
              <span>{error}</span>
              <div style={{ display: 'flex', gap: '10px', marginTop: '14px' }}>
                <button
                  className="primary-button"
                  style={{ padding: '8px 16px', fontSize: '11px', minHeight: 'auto' }}
                  onClick={() => setRetryKey(k => k + 1)}
                >
                  Tentar novamente
                </button>
                <button
                  className="secondary-button"
                  style={{ padding: '8px 16px', fontSize: '11px', minHeight: 'auto' }}
                  onClick={onClose}
                >
                  Fechar
                </button>
              </div>
            </div>
          )}
          {gameUrl && (
            <iframe
              src={gameUrl}
              title={game.name}
              allow="autoplay; fullscreen; screen-wake-lock; clipboard-write; encrypted-media"
            />
          )}
        </div>
      </div>
    </div>
  );
}

function SupportModal({ user, onClose }: { user: User | null; onClose: () => void }) {
  const [message, setMessage] = useState('');
  const [sent, setSent] = useState(false);
  async function send() {
    if (!user || !message.trim()) return;
    await createSupportTicket(user.uid, message);
    setSent(true); setMessage('');
  }
  return <div className="modal-backdrop" onClick={onClose}><div className="support-modal" onClick={e => e.stopPropagation()}><div className="menu-head"><div><span className="eyebrow">ATENDIMENTO</span><h3>Suporte Trevo da Sorte</h3></div><button onClick={onClose}><X/></button></div>{sent ? <div className="success-box">Mensagem enviada. Seu ticket foi registrado.</div> : <><textarea value={message} onChange={e => setMessage(e.target.value)} placeholder="Como podemos ajudar?"/><button className="primary-button wide" onClick={send}>ENVIAR TICKET</button></>}</div></div>;
}

function EmptyState({ title, text }: { title: string; text: string }) {
  return <div className="empty-state"><SvgIcon src={casinoIcons.chip} size={42}/><strong>{title}</strong><span>{text}</span></div>;
}

function money(value: number) { return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number.isFinite(value) ? value : 0); }
function formatActivity(tx: any) {
  if (tx.type === 'user_bet') return 'Aposta em jogo';
  if (tx.type === 'user_win') return 'Prêmio de jogo';
  if (tx.type === 'user_rollback') return 'Estorno de jogo';
  if (tx.type === 'DEPOSIT') return 'Solicitação de depósito';
  if (tx.type === 'WITHDRAW') return 'Solicitação de saque';
  return 'Movimentação';
}

export default App;
