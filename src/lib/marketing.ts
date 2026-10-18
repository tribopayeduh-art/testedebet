import { doc, getDoc } from "firebase/firestore";
import { db } from "./firebase";
import {
  DEFAULT_META_PIXEL_ID,
  trackMetaPurchase,
  trackMetaDepositIntent,
  trackMetaRegistration,
  trackMetaPageView,
  trackMetaViewContent,
  trackMetaContact,
} from "./metaTracking";

type MarketingConfig = {
  enabled?: boolean;
  metaPixelId?: string;
  tiktokPixelId?: string;
  googleAdsId?: string;
  googleConversions?: Record<string,string>;
};

declare global {
  interface Window {
    fbq?: any;
    _fbq?: any;
    ttq?: any;
    dataLayer?: any[];
    gtag?: (...args:any[]) => void;
  }
}

let loaded = false;
let config: MarketingConfig = {
  metaPixelId: DEFAULT_META_PIXEL_ID,
};

function appendScript(src:string, id:string) {
  if (document.getElementById(id)) return;
  const s = document.createElement('script');
  s.async = true; s.src = src; s.id = id;
  document.head.appendChild(s);
}

function loadMeta(pixelId:string) {
  const activePixelId = pixelId || DEFAULT_META_PIXEL_ID;
  if (!activePixelId) return;

  if (!window.fbq) {
    const f:any = function(...args:any[]){ f.callMethod ? f.callMethod.apply(f,args) : f.queue.push(args); };
    window.fbq = f; window._fbq = f; f.push=f; f.loaded=true; f.version='2.0'; f.queue=[];
    appendScript('https://connect.facebook.net/en_US/fbevents.js','amora-meta-pixel');
    window.fbq('init', activePixelId);
    window.fbq('track', 'PageView');
  } else {
    try {
      window.fbq('init', activePixelId);
    } catch {}
  }
}

function loadTikTok(pixelId:string) {
  if (!pixelId || window.ttq) return;
  const w:any = window;
  const ttq:any = w.ttq = w.ttq || [];
  ttq.methods = ['page','track','identify','instances','debug','on','off','once','ready','alias','group','enableCookie','disableCookie','holdConsent','revokeConsent','grantConsent'];
  ttq.setAndDefer = (t:any,m:string) => { t[m] = (...args:any[]) => { t.push([m,...args]); }; };
  for (const m of ttq.methods) ttq.setAndDefer(ttq,m);
  ttq.instance=(i:string)=>{ const t=ttq._i[i]||[]; for(const m of ttq.methods)ttq.setAndDefer(t,m); return t; };
  ttq.load=(i:string)=> {
    const src=`https://analytics.tiktok.com/i18n/pixel/events.js?sdkid=${encodeURIComponent(i)}&lib=ttq`;
    appendScript(src,'amora-tiktok-pixel');
    ttq._i=ttq._i||{}; ttq._i[i]=[]; ttq._i[i]._u=src;
    ttq._t=ttq._t||{}; ttq._t[i]=+new Date(); ttq._o=ttq._o||{}; ttq._o[i]={};
  };
  ttq.load(pixelId); ttq.page();
}

function loadGoogle(id:string) {
  if (!id) return;
  appendScript(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`,'amora-google-ads');
  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function(...args:any[]){ window.dataLayer!.push(args); };
  window.gtag('js', new Date());
  window.gtag('config', id);
}

export async function initMarketingTracking() {
  if (loaded) return config;
  try {
    const r = await fetch('/api/integrations/tracking');
    const d = await r.json();
    config = {
      metaPixelId: DEFAULT_META_PIXEL_ID,
      ...(d.config || {}),
    };
  } catch {}

  // Fallback direto no documento público quando o backend local não possui Service Account.
  if ((!config.metaPixelId || config.metaPixelId === DEFAULT_META_PIXEL_ID) && db) {
    try {
      const snap = await getDoc(doc(db, "public_config", "marketing_tracking"));
      if (snap.exists()) {
        config = {
          metaPixelId: DEFAULT_META_PIXEL_ID,
          ...snap.data(),
        };
      }
    } catch {}
  }

  if (config.enabled === false) return config;
  loadMeta(String(config.metaPixelId || DEFAULT_META_PIXEL_ID));
  loadTikTok(String(config.tiktokPixelId || ''));
  loadGoogle(String(config.googleAdsId || ''));
  loaded = true;
  return config;
}

export function trackMarketingEvent(name:string, params:Record<string,any>={}) {
  if (config.enabled === false) return;

  // 1. Meta Pixel - Eventos Oficiais Padronizados
  try {
    if (name === 'Deposit' || name === 'Purchase') {
      // "ele marca venda quando haver depositos!"
      const val = Number(params.value || params.amount || 0);
      trackMetaPurchase(val, {
        orderId: params.orderId,
        provider: params.provider || 'DOTFY',
        ...params,
      });
    } else if (name === 'DepositIntent' || name === 'InitiateCheckout') {
      trackMetaDepositIntent(Number(params.value || params.amount || 0), params);
    } else if (name === 'SignUp' || name === 'CompleteRegistration') {
      trackMetaRegistration(params);
    } else if (name === 'PageView') {
      trackMetaPageView();
    } else if (name === 'GameOpen' || name === 'ViewContent') {
      trackMetaViewContent(params.name || params.game_code || 'Jogo', params.provider);
    } else if (name === 'SupportOpen' || name === 'Contact') {
      trackMetaContact('Suporte');
    } else {
      window.fbq?.('trackCustom', name, params);
    }
  } catch (err) {
    console.warn('[trackMarketingEvent:Meta]', err);
  }

  // 2. TikTok Pixel
  try {
    if (name === 'Deposit' || name === 'Purchase') {
      window.ttq?.track?.('CompletePayment', { value: Number(params.value || 0), currency: 'BRL' });
    } else if (name === 'SignUp') {
      window.ttq?.track?.('CompleteRegistration');
    } else {
      window.ttq?.track?.(name, params);
    }
  } catch {}

  // 3. Google Ads & GA
  try {
    window.gtag?.('event', name, params);
    const label = config.googleConversions?.[name];
    if (label && config.googleAdsId) {
      window.gtag?.('event','conversion',{send_to:`${config.googleAdsId}/${label}`,...params});
    }
  } catch {}
}
