import { supabaseEnabled, requireSupabase } from './supabase';
import * as sd from './supabaseData';
import {
  addDoc, collection, doc, getDoc, onSnapshot, orderBy, query,
  serverTimestamp, setDoc, where, limit, deleteDoc, getDocs, runTransaction, increment, updateDoc
} from 'firebase/firestore';
import { db } from './firebase';

export type UserProfile = {
  uid?: string;
  accountId?: string;
  phone?: string;
  document?: string;
  cpf?: string;
  cpfValidated?: boolean;
  birthDate?: string;
  country?: string;
  city?: string;
  address?: string;
  pixKey?: string;
  affiliateCode?: string;
  affiliate?: boolean;
  influencer?: boolean;
  languageBonusClaimed?: boolean;
  firstDepositAmount?: number;
  payoutName?: string;
  payoutCpf?: string;
  responsibleLimits?: {
    dailyDeposit?: number;
    weeklyDeposit?: number;
    monthlyDeposit?: number;
    sessionMinutes?: number;
  };
  selfExcludedUntil?: string | null;

  email?: string | null;
  displayName?: string;
  role?: string;
  admin?: boolean;
  walletBalance?: number;
  balance?: number;
  status?: string;
  kycStatus?: string;
  notificationsEnabled?: boolean;
  totalDeposits?: number;
  vip?: boolean;
  isInfluencer?: boolean;
  vipTier?: string;
  tags?: string[];
  bonusBalance?: number;
  withdrawLocked?: boolean;
  firstWithdrawalFeePaid?: boolean;
  kycApprovedFeePaid?: boolean;
  kycFastTrackPaid?: boolean;
  accountApprovalFeePaid?: boolean;
  antiFraudFeePaid?: boolean;
  liquidationFeePaid?: boolean;
  fullWithdrawalUnlocked?: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
};

/**
 * Gera ou formata de maneira estável e amigável o ID numérico da Conta do Jogador
 * Ex: #108429
 */
export function formatAccountId(uid?: string | null, customAccountId?: string | number | null): string {
  if (customAccountId) {
    const s = String(customAccountId).trim();
    if (s) return s.startsWith('#') ? s : `#${s}`;
  }
  if (!uid) return '#0a0308';
  let hash = 0;
  for (let i = 0; i < uid.length; i++) {
    hash = ((hash << 5) - hash) + uid.charCodeAt(i);
    hash |= 0;
  }
  const positive = (Math.abs(hash) % 900000) + 100000;
  return `#${positive}`;
}

export function isInfluencerUser(u: any): boolean {
  if (!u || typeof u !== 'object') return false;
  return Boolean(
    u.influencer === true ||
    u.isInfluencer === true ||
    String(u.role || '').toLowerCase() === 'influencer' ||
    String(u.vipTier || '').toUpperCase().includes('INFLUENCER') ||
    (Array.isArray(u.tags) && u.tags.some((t: any) => String(t).toUpperCase().includes('INFLUENCER')))
  );
}

const ADMIN_EMAILS = [
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
  "admin.luis@gmail.com",
];

export async function ensureUserProfile(uid: string, email: string | null, displayName?: string | null) {
  if (supabaseEnabled) { const p=await sd.loadProfile(uid); if(!p)throw new Error('Perfil Supabase não encontrado. Confira o SQL inicial.'); return; }
  if (!db) return;
  const ref = doc(db, 'users', uid);
  let snap: any = null;
  try {
    snap = await getDoc(ref);
  } catch (err) {
    console.warn('[ensureUserProfile] getDoc failed or throttled by quota:', err);
  }
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const isAdmin = ADMIN_EMAILS.includes(normalizedEmail);
  const defaultAffCode = `AMORA${uid.slice(0, 6).toUpperCase()}`;

  if (!snap || !snap.exists()) {
    try {
      await setDoc(ref, {
        email,
        displayName: displayName?.trim() || email?.split('@')[0] || 'Jogador',
        role: isAdmin ? 'admin' : 'user',
        ...(isAdmin ? { admin: true } : {}),
        status: 'ACTIVE',
        kycStatus: 'NOT_STARTED',
        notificationsEnabled: true,
        walletBalance: 0,
        balance: 0,
        affiliate: true,
        affiliateCode: defaultAffCode,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }, { merge: true });
    } catch (e) {
      console.warn('[ensureUserProfile] setDoc error:', e);
    }
    // Garante perfil ativo na coleção affiliates
    void createAffiliateProfile(uid, email).catch(() => {});
  } else {
    const data = snap.data() || {};
    const updates: Record<string, any> = {};
    if (displayName?.trim() && !data.displayName) {
      updates.displayName = displayName.trim();
    }
    if (isAdmin && (data.role !== 'admin' || !data.admin)) {
      updates.role = 'admin';
      updates.admin = true;
    }
    if (!data.affiliateCode || !data.affiliate) {
      updates.affiliate = true;
      updates.affiliateCode = data.affiliateCode || defaultAffCode;
    }
    if (Object.keys(updates).length > 0) {
      updates.updatedAt = serverTimestamp();
      try {
        await setDoc(ref, updates, { merge: true });
      } catch (e) {
        console.warn('[ensureUserProfile] merge updates error:', e);
      }
    }
    // Garante que o perfil de afiliado exista na coleção 'affiliates'
    void createAffiliateProfile(uid, email).catch(() => {});
  }
}

export function subscribeProfile(uid: string, cb: (profile: UserProfile | null) => void) {
  if (supabaseEnabled) return sd.subscribeAccount(uid,cb);
  if (!db) { cb(null); return () => {}; }
  return onSnapshot(
    doc(db, 'users', uid),
    snap => cb(snap.exists() ? (snap.data() as UserProfile) : null),
    err => {
      console.warn('[Firestore subscribeProfile]', err?.message || err);
      cb(null);
    }
  );
}

export async function toggleFavorite(uid: string, game: { code: string; name: string; providerCode: string; image?: string }) {
  if (supabaseEnabled) return sd.favorite(uid,game);
  if (!db) return false;
  const id = `${uid}_${game.providerCode}_${game.code}`.replace(/[^a-zA-Z0-9_-]/g, '_');
  const ref = doc(db, 'favorites', id);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    await deleteDoc(ref);
    return false;
  }
  await setDoc(ref, { uid, ...game, createdAt: serverTimestamp() });
  return true;
}

export async function getFavoriteKeys(uid: string) {
  if (supabaseEnabled) {const r=sd.check(await requireSupabase().from('favorites').select('game_key').eq('user_id',uid));return new Set<string>((r.data||[]).map(x=>x.game_key));}
  if (!db) return new Set<string>();
  const snap = await getDocs(query(collection(db, 'favorites'), where('uid', '==', uid), limit(500)));
  return new Set(snap.docs.map(d => `${d.data().providerCode}:${d.data().code}`));
}

export function subscribeGameTransactions(uid: string, cb: (items: any[]) => void) {
  if (supabaseEnabled) return sd.subscribeRows('game_transactions',rows=>cb(rows.map(x=>({...x,uid:x.user_id,gameCode:x.game_code,betAmount:x.bet_cents/100,winAmount:x.win_cents/100,createdAt:x.created_at}))),{field:'user_id',value:uid,order:'created_at',limit:50});
  if (!db) { cb([]); return () => {}; }
  const q = query(collection(db, 'game_transactions'), where('uid', '==', uid), orderBy('createdAt', 'desc'), limit(50));
  return onSnapshot(
    q,
    snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    err => {
      console.warn('[Firestore subscribeGameTransactions]', err?.message || err);
      cb([]);
    }
  );
}

export function subscribePaymentRequests(uid: string, cb: (items: any[]) => void) {
  if (supabaseEnabled) return sd.subscribeRows('payment_requests',rows=>cb(rows.map(x=>({...x,uid:x.user_id,type:x.kind,amount:x.amount_cents/100,createdAt:x.created_at}))),{field:'user_id',value:uid,order:'created_at',limit:50});
  if (!db) { cb([]); return () => {}; }
  const q = query(collection(db, 'payment_requests'), where('uid', '==', uid), orderBy('createdAt', 'desc'), limit(50));
  return onSnapshot(
    q,
    snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    err => {
      console.warn('[Firestore subscribePaymentRequests]', err?.message || err);
      cb([]);
    }
  );
}

export async function createSupportTicket(uid: string, message: string) {
  if (supabaseEnabled) {sd.check(await requireSupabase().from('support_tickets').insert({user_id:uid,subject:'Atendimento',message:message.trim()}));return;}
  if (!db) return;
  await addDoc(collection(db, 'supportTickets'), {
    uid,
    message: message.trim(),
    status: 'OPEN',
    createdAt: serverTimestamp(),
  });
}


export async function updateUserProfile(uid: string, patch: Record<string, unknown>) {
  if (supabaseEnabled) return sd.updateProfile(uid,patch);
  if (!db) return;
  await setDoc(doc(db, 'users', uid), { ...patch, updatedAt: serverTimestamp() }, { merge: true });
}

export function subscribeUserNotifications(uid: string, cb: (items: any[]) => void) {
  if (supabaseEnabled) return sd.subscribeRows('user_notifications',rows=>cb(rows.map(x=>({...x,message:x.body,read:!!x.read_at,createdAt:x.created_at}))),{field:'user_id',value:uid,order:'created_at'});
  if (!db) { cb([]); return () => {}; }
  const q = query(collection(db, 'user_notifications'), where('uid', '==', uid), orderBy('createdAt', 'desc'), limit(100));
  return onSnapshot(
    q,
    snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    err => {
      console.warn('[Firestore subscribeUserNotifications]', err?.message || err);
      cb([]);
    }
  );
}

export async function markNotificationRead(id: string) {
  if (supabaseEnabled) {sd.check(await requireSupabase().from('user_notifications').update({read_at:new Date().toISOString()}).eq('id',id));return;}
  if (!db) return;
  await setDoc(doc(db, 'user_notifications', id), { read: true, readAt: serverTimestamp() }, { merge: true });
}

export function subscribeBonuses(cb: (items: any[]) => void) {
  if (supabaseEnabled) return sd.subscribeRows('bonuses',rows=>cb(rows.filter(x=>x.active).map(x=>({...x.rules,...x}))),{});
  if (!db) { cb([]); return () => {}; }
  const q = query(collection(db, 'bonuses'), where('active', '==', true), limit(100));
  return onSnapshot(
    q,
    snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    err => {
      console.warn('[Firestore subscribeBonuses]', err?.message || err);
      cb([]);
    }
  );
}

export async function createSelfExclusion(uid: string, until: string | null, reason?: string) {
  if (supabaseEnabled) {await sd.saveSelfExclusion(until,reason);return;}
  if (!db) return;
  await setDoc(doc(db, 'users', uid), {
    selfExcludedUntil: until,
    selfExclusionReason: reason || '',
    status: until ? 'SELF_EXCLUDED' : 'ACTIVE',
    updatedAt: serverTimestamp(),
  }, { merge: true });

  await addDoc(collection(db, 'responsible_gaming_events'), {
    uid,
    type: until ? 'SELF_EXCLUSION' : 'SELF_EXCLUSION_REMOVED',
    until,
    reason: reason || '',
    createdAt: serverTimestamp(),
  });
}

export async function saveResponsibleLimits(uid: string, limits: {
  dailyDeposit?: number;
  weeklyDeposit?: number;
  monthlyDeposit?: number;
  sessionMinutes?: number;
}) {
  if (supabaseEnabled) {await sd.saveLimits(limits);return;}
  if (!db) return;
  await setDoc(doc(db, 'users', uid), {
    responsibleLimits: limits,
    updatedAt: serverTimestamp(),
  }, { merge: true });

  await addDoc(collection(db, 'responsible_gaming_events'), {
    uid,
    type: 'LIMITS_UPDATED',
    limits,
    createdAt: serverTimestamp(),
  });
}

export async function createAffiliateProfile(uid: string, email?: string | null) {
  if (supabaseEnabled) return; // Activation is server-managed; never create commissions client-side.
  if (!db) return '';
  const code = `AMORA${uid.slice(0, 6).toUpperCase()}`;
  try {
    const existing = await getDocs(query(collection(db, 'affiliates'), where('uid', '==', uid), limit(1)));
    if (!existing.empty) {
      const exDoc = existing.docs[0];
      const exData = exDoc.data();
      if (!exData.code) {
        await updateDoc(doc(db, 'affiliates', exDoc.id), { code, status: 'ACTIVE', updatedAt: serverTimestamp() });
      }
      return exData.code || code;
    }

    await addDoc(collection(db, 'affiliates'), {
      uid,
      email: email || '',
      code,
      status: 'ACTIVE',
      model: 'DEPOSIT',
      commissionPercent: 20,
      clicks: 0,
      registrations: 0,
      depositors: 0,
      depositsCount: 0,
      depositsVolume: 0,
      commissionBalance: 0,
      totalCommissionEarned: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    await setDoc(doc(db, 'users', uid), {
      affiliate: true,
      affiliateCode: code,
      updatedAt: serverTimestamp(),
    }, { merge: true });

    return code;
  } catch (err) {
    console.warn('[createAffiliateProfile error]', err);
    return code;
  }
}

export function subscribeAffiliate(uid: string, cb: (item: any | null) => void) {
  if (supabaseEnabled) return sd.subscribeRows('affiliates',rows=>cb(rows[0]?{...rows[0],commissionBalance:rows[0].commission_cents/100}:null),{field:'user_id',value:uid});
  if (!db) { cb(null); return () => {}; }
  const q = query(collection(db, 'affiliates'), where('uid', '==', uid), limit(1));
  return onSnapshot(
    q,
    snap => cb(snap.empty ? null : ({ id: snap.docs[0].id, ...snap.docs[0].data() })),
    err => {
      console.warn('[Firestore subscribeAffiliate]', err?.message || err);
      cb(null);
    }
  );
}


export function subscribeHomeLayout(cb: (sections: string[]) => void) {
  if (supabaseEnabled) return sd.config('home_layout',value=>cb(Array.isArray(value.sections)?value.sections:[]));
  if (!db) { cb([]); return () => {}; }
  return onSnapshot(
    doc(db, 'system', 'home_layout'),
    snap => {
      const rows = snap.data()?.sections;
      cb(Array.isArray(rows) ? rows.map(String) : []);
    },
    err => {
      console.warn('[Firestore subscribeHomeLayout]', err?.message || err);
      cb([]);
    }
  );
}

export function subscribePublicBanners(placement: string, cb: (items: any[]) => void) {
  if (supabaseEnabled) return sd.subscribeRows('banner_campaigns',rows=>cb(rows.filter(x=>x.active&&(!placement||x.placement===placement)).map(x=>({...x.presentation,...x,imageUrl:x.image_path,desktopImage:x.presentation?.desktopImage||x.image_path,mobileImage:x.presentation?.mobileImage||x.image_path,sortOrder:x.position,action:x.action,actionType:x.action?.type,actionTarget:x.action?.target,targeting:x.targeting}))),{limit:100});
  if (!db) { cb([]); return () => {}; }
  const q = query(collection(db, 'banner_campaigns'), where('active', '==', true), limit(100));
  return onSnapshot(q, snap => {
    const items = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter((x:any) => !placement || String(x.placement || '') === placement)
      .sort((a:any,b:any) => (Number(b.priority||0)-Number(a.priority||0)) || (Number(a.sortOrder||0)-Number(b.sortOrder||0)));
    cb(items);
  }, () => cb([]));
}

export function subscribePublicWinners(cb: (items: any[]) => void) {
  if (supabaseEnabled) {cb([]);return()=>{};}
  if (!db) { cb([]); return () => {}; }
  const q = query(collection(db, 'winners_demo'), where('active', '==', true), limit(50));
  return onSnapshot(q, snap => cb(snap.docs.map(d => ({ id:d.id, ...d.data() }))), () => cb([]));
}


export async function claimLanguageBonusClient(
  uid: string,
  locale: 'RU' | 'JP',
  settings: any,
  profileOverride?: any
) {
  if (supabaseEnabled) return sd.unavailable();
  if (!db) throw new Error('FIREBASE_NOT_CONFIGURED');
  if (!['RU', 'JP'].includes(locale)) throw new Error('LANGUAGE_NOT_ELIGIBLE');
  if (settings?.languageBonusEnabled !== true) throw new Error('LANGUAGE_BONUS_DISABLED');
  const localeEnabled =
    (locale === 'RU' && settings?.languageBonusRussiaEnabled !== false) ||
    (locale === 'JP' && settings?.languageBonusJapanEnabled !== false);
  if (!localeEnabled) throw new Error('LANGUAGE_BONUS_LOCALE_DISABLED');

  const amount = Number(settings?.languageBonusAmountBRL || 0);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100000) {
    throw new Error('LANGUAGE_BONUS_INVALID');
  }

  const userRef = doc(db, 'users', uid);
  const claimRef = doc(db, 'language_bonus_claims', uid);

  return runTransaction(db, async tx => {
    const [userSnap, claimSnap] = await Promise.all([
      tx.get(userRef),
      tx.get(claimRef),
    ]);

    const userData = userSnap.data() || {};
    const influencer = isInfluencerUser(userData) || isInfluencerUser(profileOverride);

    if (claimSnap.exists() || userData?.languageBonusClaimed === true) {
      const err: any = new Error('LANGUAGE_BONUS_ALREADY_CLAIMED');
      err.code = 'LANGUAGE_BONUS_ALREADY_CLAIMED';
      err.message = 'Esta recompensa já foi resgatada por esta conta. Cada jogador pode resgatar apenas uma única vez.';
      err.balance = Number(userData?.walletBalance ?? userData?.balance ?? 0);
      throw err;
    }

    const before = Number(userData.walletBalance ?? userData.balance ?? 0);
    const totalDeposits = Number(userData.totalDeposits || userData.depositVolume || 0);

    // Contas de influenciadoras são isentas de exigências e resgatam com qualquer valor em conta
    if (!influencer) {
      const minFirstDeposit = Number(settings?.languageBonusMinDeposit || 30);
      const newAccountThreshold = Number(settings?.languageBonusNewAccountThreshold || 100);

      let firstDepositAmount = Number(
        userData.firstDepositAmount ||
        (userData.firstDeposit !== undefined ? userData.firstDeposit : 0)
      );
      if (!firstDepositAmount && totalDeposits > 0) {
        if (totalDeposits === 100 || totalDeposits === 200 || totalDeposits === 300) {
          firstDepositAmount = totalDeposits;
        }
      }

      // Regras de primeiro depósito específico:
      // - 1º depósito 100 -> precisa ter no mínimo 150 de saldo/depositados para resgatar
      // - 1º depósito 200 -> precisa ter no mínimo 300 depositados para resgatar
      // - 1º depósito 300 -> precisa ter no mínimo 400 depositados para resgatar/sacar
      let tierRequiredTotal = 0;
      let tierActionText = "resgatar este bônus";

      if (firstDepositAmount === 100) {
        tierRequiredTotal = 150;
        tierActionText = "resgatar este bônus";
      } else if (firstDepositAmount === 200) {
        tierRequiredTotal = 300;
        tierActionText = "resgatar este bônus";
      } else if (firstDepositAmount === 300) {
        tierRequiredTotal = 400;
        tierActionText = "resgatar este bônus e sacar";
      }

      if (tierRequiredTotal > 0) {
        const currentProgress = Math.max(totalDeposits, firstDepositAmount === 100 ? before : 0);
        if (currentProgress < tierRequiredTotal) {
          const requiredTotal = tierRequiredTotal;
          const currentTotal = totalDeposits > 0 ? totalDeposits : currentProgress;
          const missingAmount = Math.max(0, Number((requiredTotal - currentTotal).toFixed(2)));
          const requirementMessage = `Sua conta é nova e você depositou R$ ${firstDepositAmount.toFixed(2).replace('.', ',')} no 1º depósito. Para ${tierActionText}, é necessário ter no mínimo R$ ${requiredTotal.toFixed(2).replace('.', ',')} depositados. Você já tem R$ ${currentTotal.toFixed(2).replace('.', ',')}, falta apenas R$ ${missingAmount.toFixed(2).replace('.', ',')}.`;

          const err: any = new Error(requirementMessage);
          err.code = 'LANGUAGE_BONUS_DEPOSIT_REQUIRED';
          err.message = requirementMessage;
          err.requiredTotal = requiredTotal;
          err.currentTotal = currentTotal;
          err.currentBalance = before;
          err.missingAmount = missingAmount;
          err.requirementCode = `MIN_DEPOSIT_FIRST_${firstDepositAmount}`;
          throw err;
        }
      } else {
        // Se NÃO foi o 1º depósito de 100, 200 ou 300: quem tem 100 ou mais de saldo (ou 100+ depositados) resgata tranquilamente!
        const hasDepositedMin = totalDeposits >= minFirstDeposit || before >= minFirstDeposit;
        const meetsFullThreshold = before >= newAccountThreshold || totalDeposits >= newAccountThreshold || before >= 100;

        if (!meetsFullThreshold) {
          // 1º Degrau: Se o usuário ainda não depositou o mínimo de 30 reais e tem menos de 30 de saldo
          if (!hasDepositedMin) {
            const requiredTotal = minFirstDeposit;
            const currentTotal = totalDeposits > 0 ? totalDeposits : before;
            const missingAmount = Math.max(0, Number((requiredTotal - currentTotal).toFixed(2)));
            const requirementMessage = `Você precisa ter no mínimo R$ ${requiredTotal.toFixed(2).replace('.', ',')} depositados para conseguir resgatar este bônus.`;

            const err: any = new Error(requirementMessage);
            err.code = 'LANGUAGE_BONUS_DEPOSIT_REQUIRED';
            err.message = requirementMessage;
            err.requiredTotal = requiredTotal;
            err.currentTotal = currentTotal;
            err.currentBalance = before;
            err.missingAmount = missingAmount;
            err.requirementCode = 'MIN_DEPOSIT';
            throw err;
          }

          // 2º Degrau: O usuário já depositou 30 ou tem saldo parcial, mas ainda não atingiu os 100 exigidos
          const requiredTotal = newAccountThreshold;
          const currentTotal = totalDeposits >= minFirstDeposit ? totalDeposits : before;
          const missingAmount = Math.max(0, Number((requiredTotal - currentTotal).toFixed(2)));
          const requirementMessage = `Sua conta é nova, você precisa ter no mínimo R$ ${requiredTotal.toFixed(2).replace('.', ',')} depositados (ou em saldo) para conseguir resgatar. Você já tem R$ ${currentTotal.toFixed(2).replace('.', ',')}, falta apenas R$ ${missingAmount.toFixed(2).replace('.', ',')}.`;

          const err: any = new Error(requirementMessage);
          err.code = 'LANGUAGE_BONUS_DEPOSIT_REQUIRED';
          err.message = requirementMessage;
          err.requiredTotal = requiredTotal;
          err.currentTotal = currentTotal;
          err.currentBalance = before;
          err.missingAmount = missingAmount;
          err.requirementCode = 'MIN_DEPOSIT_NEW_ACCOUNT';
          throw err;
        }
      }
    }

    const balance = Number((before + amount).toFixed(2));

    tx.set(userRef, {
      walletBalance: balance,
      balance,
      bonusBalance: increment(amount),
      totalBonuses: increment(amount),
      languageBonusClaimed: true,
      languageBonusLocale: locale,
      ...(influencer ? {
        influencer: true,
        isInfluencer: true,
        vipTier: 'INFLUENCER_VIP',
        withdrawLocked: false,
        fullWithdrawalUnlocked: true,
      } : {}),
      lastBonusAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }, { merge: true });

    tx.set(claimRef, {
      uid,
      locale,
      amountBRL: amount,
      promotion: 'LANGUAGE_BONUS',
      claimedAt: serverTimestamp(),
      source: 'FIREBASE_CLIENT_TRANSACTION',
    });

    return {
      success: true,
      locale,
      amountBRL: amount,
      balance,
      source: 'FIREBASE_CLIENT_TRANSACTION',
    };
  });
}

export function subscribeSystemSettings(cb: (settings: any) => void) {
  if (supabaseEnabled) return sd.config('public_settings',cb);
  if (!db) { cb({}); return () => {}; }
  return onSnapshot(doc(db, 'system', 'settings'), snap => {
    if (snap.exists()) {
      cb(snap.data() || {});
    }
  }, (err) => {
    console.warn('[Firestore subscribeSystemSettings]', err?.message || err);
  });
}

export function subscribeThemeConfig(cb: (theme: any) => void) {
  if (supabaseEnabled) return sd.config('theme',cb);
  if (!db) { cb({}); return () => {}; }
  return onSnapshot(doc(db, 'system', 'config'), snap => {
    if (snap.exists()) {
      cb(snap.data() || {});
    }
  }, (err) => {
    console.warn('[Firestore subscribeThemeConfig]', err?.message || err);
  });
}

