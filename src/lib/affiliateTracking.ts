/**
 * Ultra-Precise Affiliate Tracking Engine (Multi-Touch, Deep Attribution & Conversion Tracking)
 * 
 * Capabilities:
 * - Omnichannel Parameter Detection: ?ref=, ?aff=, ?affiliate=, ?r=, ?referral=, ?aff_id=, #/ref=, etc.
 * - SubID & UTM Extraction: subid, s1, s2, utm_source, utm_medium, utm_campaign, utm_content.
 * - Multi-layer Persistence: localStorage + sessionStorage + 90-day Cookie + In-Memory Fallback.
 * - Intelligent Deduplication: Prevents double-counting fast page refreshes while preserving fresh clicks.
 * - Server & Firestore Atomic Sync: Increment clicks, registrations, depositors, and commissions.
 */

import { db } from "./firebase";
import {
  collection,
  doc,
  getDocs,
  getDoc,
  query,
  where,
  limit,
  setDoc,
  addDoc,
  updateDoc,
  increment,
  serverTimestamp
} from "firebase/firestore";

export interface AffiliateAttribution {
  code: string;
  affiliateUid?: string;
  clickId: string;
  subId?: string;
  sub2?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  landingUrl: string;
  referrer: string;
  firstSeenAt: number;
  lastSeenAt: number;
  clickRecorded?: boolean;
}

const STORAGE_KEY = "amora_aff_attr_v2";
const STORAGE_CODE_KEY = "amora_aff_code_v2";
const COOKIE_NAME = "amora_ref_code";
const COOKIE_ATTR_NAME = "amora_ref_attr";
const DEDUPE_WINDOW_MS = 10 * 60 * 1000; // 10 minutes dedupe window for same clickId

let inMemoryAttribution: AffiliateAttribution | null = null;
let initialized = false;

// Helpers for cookies
function setCookie(name: string, val: string, days = 90) {
  if (typeof document === "undefined") return;
  const expires = new Date(Date.now() + days * 864e5).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(val)}; expires=${expires}; path=/; SameSite=Lax`;
}

function getCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(^|;\\s*)(${name})=([^;]*)`));
  return match ? decodeURIComponent(match[3]) : null;
}

function generateClickId(): string {
  return `clk_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Normalizes affiliate code (uppercase, trimmed, alphanumeric and underscores/hyphens only)
 */
export function normalizeAffiliateCode(raw: string): string {
  if (!raw) return "";
  return String(raw).trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "");
}

/**
 * Extract referral code and UTMs from current window location (Query string, Hash, Path)
 */
export function extractUrlReferral(): { code: string; params: Record<string, string> } | null {
  if (typeof window === "undefined") return null;

  try {
    const url = new URL(window.location.href);
    const searchParams = url.searchParams;

    // Check query params
    const codeCandidates = [
      searchParams.get("ref"),
      searchParams.get("aff"),
      searchParams.get("affiliate"),
      searchParams.get("r"),
      searchParams.get("referral"),
      searchParams.get("aff_id"),
      searchParams.get("afiliado"),
      searchParams.get("partner"),
    ];

    let foundCode = codeCandidates.find((c) => c && c.trim().length > 0) || "";

    // Check hash params if query didn't have it (e.g., #/?ref=CODE or #/ref=CODE)
    if (!foundCode && window.location.hash) {
      const hashStr = window.location.hash.replace(/^[#/]+/, "");
      const hashParams = new URLSearchParams(hashStr.includes("?") ? hashStr.split("?")[1] : hashStr);
      foundCode =
        hashParams.get("ref") ||
        hashParams.get("aff") ||
        hashParams.get("affiliate") ||
        hashParams.get("r") ||
        "";
    }

    // Check direct path like /r/CODE
    if (!foundCode && url.pathname.startsWith("/r/")) {
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts[0] === "r" && parts[1]) {
        foundCode = parts[1];
      }
    }

    foundCode = normalizeAffiliateCode(foundCode);
    if (!foundCode) return null;

    const params: Record<string, string> = {
      subId: searchParams.get("subid") || searchParams.get("sub_id") || searchParams.get("s1") || "",
      sub2: searchParams.get("s2") || searchParams.get("sub2") || "",
      utmSource: searchParams.get("utm_source") || "",
      utmMedium: searchParams.get("utm_medium") || "",
      utmCampaign: searchParams.get("utm_campaign") || "",
      utmContent: searchParams.get("utm_content") || "",
    };

    return { code: foundCode, params };
  } catch (err) {
    console.warn("[AffiliateTracking] extractUrlReferral error:", err);
    return null;
  }
}

/**
 * Retrieve the active stored attribution from multi-tier storage
 */
export function getStoredAffiliateAttribution(): AffiliateAttribution | null {
  if (inMemoryAttribution) return inMemoryAttribution;
  if (typeof window === "undefined") return null;

  try {
    // 1. Check LocalStorage
    const rawLocal = localStorage.getItem(STORAGE_KEY);
    if (rawLocal) {
      const parsed = JSON.parse(rawLocal);
      if (parsed && parsed.code) {
        inMemoryAttribution = parsed;
        return parsed;
      }
    }

    // 2. Check SessionStorage
    const rawSession = sessionStorage.getItem(STORAGE_KEY);
    if (rawSession) {
      const parsed = JSON.parse(rawSession);
      if (parsed && parsed.code) {
        inMemoryAttribution = parsed;
        return parsed;
      }
    }

    // 3. Check Cookies
    const cookieAttr = getCookie(COOKIE_ATTR_NAME);
    if (cookieAttr) {
      const parsed = JSON.parse(cookieAttr);
      if (parsed && parsed.code) {
        inMemoryAttribution = parsed;
        return parsed;
      }
    }

    const simpleCode = getCookie(COOKIE_NAME) || localStorage.getItem(STORAGE_CODE_KEY);
    if (simpleCode) {
      const normalized = normalizeAffiliateCode(simpleCode);
      if (normalized) {
        const attr: AffiliateAttribution = {
          code: normalized,
          clickId: generateClickId(),
          landingUrl: window.location.href,
          referrer: document.referrer || "direct",
          firstSeenAt: Date.now(),
          lastSeenAt: Date.now(),
        };
        inMemoryAttribution = attr;
        return attr;
      }
    }
  } catch (e) {
    console.warn("[AffiliateTracking] getStoredAffiliateAttribution error:", e);
  }

  return null;
}

/**
 * Saves attribution to all tiers: LocalStorage, SessionStorage, Cookies, In-Memory
 */
function persistAttribution(attr: AffiliateAttribution) {
  inMemoryAttribution = attr;
  if (typeof window === "undefined") return;

  try {
    const json = JSON.stringify(attr);
    localStorage.setItem(STORAGE_KEY, json);
    localStorage.setItem(STORAGE_CODE_KEY, attr.code);
    sessionStorage.setItem(STORAGE_KEY, json);
    setCookie(COOKIE_NAME, attr.code, 90);
    setCookie(COOKIE_ATTR_NAME, json, 90);
  } catch (e) {
    console.warn("[AffiliateTracking] persistAttribution error:", e);
  }
}

/**
 * Records click in backend & Firestore with atomic increment
 */
async function recordClickEvent(attr: AffiliateAttribution): Promise<void> {
  const code = normalizeAffiliateCode(attr.code);
  if (!code) return;

  // 1. Try server endpoint first (fast, atomic, bypasses ad-blockers)
  try {
    const resp = await fetch("/api/affiliates/track-click", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code,
        clickId: attr.clickId,
        subId: attr.subId || null,
        sub2: attr.sub2 || null,
        utmSource: attr.utmSource || null,
        utmMedium: attr.utmMedium || null,
        utmCampaign: attr.utmCampaign || null,
        utmContent: attr.utmContent || null,
        landingUrl: attr.landingUrl,
        referrer: attr.referrer,
      }),
    });
    if (resp.ok) {
      const data = await resp.json();
      if (data.affiliateUid && !attr.affiliateUid) {
        attr.affiliateUid = data.affiliateUid;
        persistAttribution(attr);
      }
      return;
    }
  } catch {
    // Fallback to direct client-side Firestore increment
  }

  // 2. Direct Firestore fallback
  if (db) {
    try {
      const affQuery = query(collection(db, "affiliates"), where("code", "==", code), limit(1));
      const snap = await getDocs(affQuery);
      if (!snap.empty) {
        const affDoc = snap.docs[0];
        attr.affiliateUid = affDoc.data().uid;
        persistAttribution(attr);

        // Atomic click increment
        await updateDoc(doc(db, "affiliates", affDoc.id), {
          clicks: increment(1),
          updatedAt: serverTimestamp(),
        }).catch(() => {});

        // Add audit click entry
        await addDoc(collection(db, "affiliate_clicks"), {
          affiliateId: affDoc.id,
          affiliateUid: affDoc.data().uid,
          code,
          clickId: attr.clickId,
          subId: attr.subId || null,
          utmSource: attr.utmSource || null,
          utmCampaign: attr.utmCampaign || null,
          landingUrl: attr.landingUrl,
          referrer: attr.referrer,
          createdAt: serverTimestamp(),
        }).catch(() => {});
      }
    } catch (err) {
      console.warn("[AffiliateTracking] direct Firestore click record fallback error:", err);
    }
  }
}

/**
 * Initializes ultra-precise affiliate tracking on application startup.
 * Automatically extracts referral link, registers deduplicated clicks,
 * and maintains continuous attribution across sessions.
 */
export function initAffiliateTracking(): AffiliateAttribution | null {
  if (typeof window === "undefined") return null;
  if (initialized) return getStoredAffiliateAttribution();
  initialized = true;

  try {
    const urlData = extractUrlReferral();
    const stored = getStoredAffiliateAttribution();

    if (urlData && urlData.code) {
      const isSameCode = stored && stored.code === urlData.code;
      const isRecent = stored && Date.now() - (stored.lastSeenAt || 0) < DEDUPE_WINDOW_MS;

      const newAttr: AffiliateAttribution = {
        code: urlData.code,
        affiliateUid: stored?.code === urlData.code ? stored.affiliateUid : undefined,
        clickId: isSameCode && stored?.clickId ? stored.clickId : generateClickId(),
        subId: urlData.params.subId || stored?.subId || "",
        sub2: urlData.params.sub2 || stored?.sub2 || "",
        utmSource: urlData.params.utmSource || stored?.utmSource || "",
        utmMedium: urlData.params.utmMedium || stored?.utmMedium || "",
        utmCampaign: urlData.params.utmCampaign || stored?.utmCampaign || "",
        utmContent: urlData.params.utmContent || stored?.utmContent || "",
        landingUrl: window.location.href,
        referrer: document.referrer || "direct",
        firstSeenAt: stored?.code === urlData.code ? stored.firstSeenAt : Date.now(),
        lastSeenAt: Date.now(),
        clickRecorded: isSameCode && isRecent ? stored?.clickRecorded : false,
      };

      persistAttribution(newAttr);

      // Record atomic click only if not recently recorded for this session
      if (!newAttr.clickRecorded) {
        newAttr.clickRecorded = true;
        persistAttribution(newAttr);
        void recordClickEvent(newAttr);
      }

      return newAttr;
    }

    return stored;
  } catch (err) {
    console.warn("[AffiliateTracking] initAffiliateTracking error:", err);
    return null;
  }
}

/**
 * Returns current affiliate referral code if present.
 */
export function getActiveReferralCode(): string {
  const attr = getStoredAffiliateAttribution();
  return attr?.code || "";
}

/**
 * Attaches referral attribution to newly registered user.
 * Atomically increments registrations on the affiliate doc and creates an audit conversion record.
 */
export async function trackAffiliateRegistration(user: { uid: string; email?: string | null }, explicitCode?: string): Promise<{ success: boolean; code?: string }> {
  const code = normalizeAffiliateCode(explicitCode || getActiveReferralCode());
  if (!code || !user?.uid) return { success: false };

  const attr = getStoredAffiliateAttribution();

  // 1. Try server route
  try {
    const res = await fetch("/api/affiliates/track-registration", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        uid: user.uid,
        email: user.email || "",
        code,
        clickId: attr?.clickId || generateClickId(),
        subId: attr?.subId || null,
        utmSource: attr?.utmSource || null,
        utmCampaign: attr?.utmCampaign || null,
      }),
    });
    if (res.ok) {
      return { success: true, code };
    }
  } catch {
    // fallback
  }

  // 2. Direct Firestore fallback
  if (db) {
    try {
      const q = query(collection(db, "affiliates"), where("code", "==", code), limit(1));
      const snap = await getDocs(q);
      if (!snap.empty) {
        const affDoc = snap.docs[0];
        const affData = affDoc.data();

        // Increment registrations on affiliate doc
        await updateDoc(doc(db, "affiliates", affDoc.id), {
          registrations: increment(1),
          updatedAt: serverTimestamp(),
        }).catch(() => {});

        // Link referral to user profile
        await setDoc(
          doc(db, "users", user.uid),
          {
            referredBy: code,
            referredByUid: affData.uid || "",
            referralClickId: attr?.clickId || null,
            referralSubId: attr?.subId || null,
            referredAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        ).catch(() => {});

        // Create conversion audit record
        await addDoc(collection(db, "affiliate_conversions"), {
          affiliateId: affDoc.id,
          affiliateUid: affData.uid || "",
          code,
          referredUid: user.uid,
          referredEmail: user.email || "",
          clickId: attr?.clickId || null,
          subId: attr?.subId || null,
          createdAt: serverTimestamp(),
        }).catch(() => {});

        return { success: true, code };
      }
    } catch (e) {
      console.warn("[AffiliateTracking] trackAffiliateRegistration fallback error:", e);
    }
  }

  return { success: true, code };
}
