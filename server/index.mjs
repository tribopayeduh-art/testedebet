import { getBrandedGameCover } from "./nacional-artwork.mjs";
import {createClient as createSupabaseClient} from '@supabase/supabase-js';
import {DEFAULT_PLATFORM_SETTINGS} from './public-settings-defaults.mjs';
import { supabaseMiddleware, supabaseMode } from './supabase-routes.mjs';
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DEFAULT_VALIDATION_FEES, normalizeValidationFees, withdrawalValidation, imageExtension } from "./customization.mjs";

// Load environment before Firebase Admin is imported/initialized.
dotenv.config({ path: path.resolve(process.cwd(), ".env.local"), override: false });
dotenv.config({ path: path.resolve(process.cwd(), ".env"), override: false });

import express from "express";
import axios from "axios";
import QRCode from "qrcode";
import { PLATFORM_DEFAULTS } from "./platform-defaults.mjs";
import { 
  createDotfyPixCharge as createDotfyChargeSdk, 
  getDotfyChargeStatus as getDotfyStatusSdk, 
  getDotfySentSplitsAnalytics as getDotfySentSplitsSdk,
  getDotfyReceivedSplits as getDotfyReceivedSplitsSdk,
  getDotfySellerInfo as getDotfySellerInfoSdk,
  getDotfyBalance as getDotfyBalanceSdk,
  getDotfyChargesList as getDotfyChargesListSdk,
  normalizeDotfyStatus, 
  formatDotfyPhone, 
  formatDotfyTaxId, 
  buildDotfySplitObject 
} from "./dotfy.mjs";
import {
  selectDotfyAccountForDeposit,
  recordPixPaymentPaid,
  getPixRoutingStats,
  resetPixRoutingCycle,
  getAllDotfyApiKeys,
  SECONDARY_ROUTING_KEY,
  isSecondaryPlayer,
  addSecondaryPlayer,
  isSecondaryUser,
  isSecondaryPayment
} from "./pix-router.mjs";
import crypto from "node:crypto";
import https from "node:https";

const { default: admin } = await import("firebase-admin");
const { getFirestore } = await import("firebase-admin/firestore");

const IS_NETLIFY = false;
let whatsappModulePromise = null;

async function getWhatsAppModule() {
  if (IS_NETLIFY) {
    const e = new Error("WHATSAPP_BAILEYS_REQUIRES_PERSISTENT_BACKEND");
    e.status = 503;
    throw e;
  }
  if (!whatsappModulePromise) { const modulePath = "./whatsapp.mjs"; whatsappModulePromise = import(modulePath); }
  return whatsappModulePromise;
}

function netlifyWhatsAppState() {
  return {
    status: "PERSISTENT_BACKEND_REQUIRED",
    connected: false,
    netlify: true,
    lastError: "Baileys precisa de uma conexão persistente. Netlify Functions são serverless.",
  };
}

const firebaseAdminState = {
  initialized: false,
  credentialMode: "NONE",
  privilegedReady: false,
  projectId: "",
  error: "",
};

function parseServiceAccountJson(raw) {
  if (!String(raw || "").trim()) return null;
  const parsed = JSON.parse(String(raw));
  if (!parsed?.project_id || !parsed?.client_email || !parsed?.private_key) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON_INVALID");
  }
  return parsed;
}

function loadServiceAccountFile(filePath) {
  if (!String(filePath || "").trim()) return null;
  const resolved = path.resolve(process.cwd(), String(filePath));
  if (!fs.existsSync(resolved)) throw new Error(`GOOGLE_APPLICATION_CREDENTIALS_NOT_FOUND: ${resolved}`);
  const parsed = JSON.parse(fs.readFileSync(resolved, "utf8"));
  if (!parsed?.project_id || !parsed?.client_email || !parsed?.private_key) {
    throw new Error("GOOGLE_APPLICATION_CREDENTIALS_INVALID");
  }
  return parsed;
}

let appletConfigFile = null;
try {
  const cfgPath = path.resolve(process.cwd(), "firebase-applet-config.json");
  if (fs.existsSync(cfgPath)) {
    appletConfigFile = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  }
} catch {}

function initFirebaseAdmin() {
  if (admin.apps.length) return;

  const explicitJson = String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "").trim();
  const credentialsPath = String(process.env.GOOGLE_APPLICATION_CREDENTIALS || "").trim();
  let serviceAccount = null;
  let credentialMode = "NONE";

  try {
    if (explicitJson) {
      serviceAccount = parseServiceAccountJson(explicitJson);
      credentialMode = "SERVICE_ACCOUNT_JSON";
    } else if (credentialsPath) {
      serviceAccount = loadServiceAccountFile(credentialsPath);
      credentialMode = "GOOGLE_APPLICATION_CREDENTIALS";
    }

    const projectId =
      process.env.FIREBASE_PROJECT_ID ||
      serviceAccount?.project_id ||
      appletConfigFile?.projectId ||
      PLATFORM_DEFAULTS.firebase.projectId;

    const options = {
      projectId,
      databaseURL: process.env.FIREBASE_DATABASE_URL || PLATFORM_DEFAULTS.firebase.databaseURL,
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET || appletConfigFile?.storageBucket || PLATFORM_DEFAULTS.firebase.storageBucket,
      ...(serviceAccount ? { credential: admin.credential.cert(serviceAccount) } : {}),
    };

    admin.initializeApp(options);
    firebaseAdminState.initialized = true;
    firebaseAdminState.credentialMode = credentialMode;
    firebaseAdminState.privilegedReady = Boolean(serviceAccount);
    firebaseAdminState.projectId = projectId;
  } catch (error) {
    firebaseAdminState.error = error?.message || String(error);
    console.error("[firebase-admin:init]", firebaseAdminState.error);
    // Public routes that support client/delegated access can still run.
    const projectId =
      process.env.FIREBASE_PROJECT_ID ||
      appletConfigFile?.projectId ||
      PLATFORM_DEFAULTS.firebase.projectId;
    admin.initializeApp({
      projectId,
      databaseURL: process.env.FIREBASE_DATABASE_URL || PLATFORM_DEFAULTS.firebase.databaseURL,
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET || appletConfigFile?.storageBucket || PLATFORM_DEFAULTS.firebase.storageBucket,
    });
    firebaseAdminState.initialized = true;
    firebaseAdminState.credentialMode = "NONE";
    firebaseAdminState.privilegedReady = false;
    firebaseAdminState.projectId = projectId;
  }
}

if (!supabaseMode()) initFirebaseAdmin();
const firestoreDbId = process.env.FIRESTORE_DATABASE_ID || appletConfigFile?.firestoreDatabaseId || PLATFORM_DEFAULTS.firebase.firestoreDatabaseId || "(default)";
const db = supabaseMode() ? null : (firestoreDbId && firestoreDbId !== "(default)")
  ? getFirestore(admin.app(), firestoreDbId)
  : admin.firestore();
const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");

const USERS_REGISTRY_FILE = path.resolve("./server/data/users_registry.json");

function getLocalUsersRegistry() {
  try {
    if (fs.existsSync(USERS_REGISTRY_FILE)) {
      const raw = fs.readFileSync(USERS_REGISTRY_FILE, "utf8");
      const list = JSON.parse(raw);
      if (Array.isArray(list)) return list;
    }
  } catch (err) {
    console.warn("[getLocalUsersRegistry]", err?.message || err);
  }
  return [];
}

function saveUserToLocalRegistry(userObj) {
  if (!userObj) return;
  const uid = userObj.uid || userObj.id;
  if (!uid) return;
  try {
    const dir = path.dirname(USERS_REGISTRY_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const current = getLocalUsersRegistry();
    const idx = current.findIndex(u => (u.uid || u.id) === uid);
    if (idx >= 0) {
      current[idx] = { ...current[idx], ...userObj, updatedAt: new Date().toISOString() };
    } else {
      current.push({ ...userObj, createdAt: userObj.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() });
    }
    fs.writeFileSync(USERS_REGISTRY_FILE, JSON.stringify(current, null, 2), "utf8");
  } catch (err) {
    console.warn("[saveUserToLocalRegistry]", err?.message || err);
  }
}

function normalizeOrigin(value) {
  try { return new URL(value).origin.toLowerCase(); } catch { return ""; }
}

const configuredOrigins = new Set(
  [
    process.env.PUBLIC_APP_URL,
    process.env.APP_URL,
    process.env.ALLOWED_ORIGINS,
    "https://borah.bet",
    "http://borah.bet",
    "https://www.borah.bet",
    "http://www.borah.bet",
    "https://admin.borah.bet",
    "http://admin.borah.bet",
    "https://resenhaa.bet",
    "http://resenhaa.bet",
    "https://admin.resenhaa.bet",
    "http://admin.resenhaa.bet",
  ]
    .filter(Boolean)
    .join(",")
    .split(",")
    .map(v => normalizeOrigin(v.trim()))
    .filter(Boolean)
);
if (process.env.NODE_ENV !== "production") {
  configuredOrigins.add("http://localhost:5173");
  configuredOrigins.add("http://127.0.0.1:5173");
}

app.use((req, res, next) => {
  const origin = String(req.headers.origin || "").trim();
  if (!origin) return next();

  let sameHost = false;
  try {
    const o = new URL(origin);
    const requestHost = String(req.headers.host || "").split(":")[0].toLowerCase();
    sameHost = o.hostname.toLowerCase() === requestHost;
  } catch {}

  const allowed = sameHost || configuredOrigins.has(normalizeOrigin(origin));
  if (!allowed) return res.status(403).json({ error:"CORS_ORIGIN_DENIED", message:"Origem não autorizada." });

  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Requested-With");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,PUT,DELETE,OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: "1mb", strict: true }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
app.use(supabaseMiddleware);

const rateBuckets = new Map();
function rateLimit({ windowMs = 60_000, max = 60, keyPrefix = "api" } = {}) {
  return (req, res, next) => {
    const now = Date.now();
    const ip = req.ip || req.socket?.remoteAddress || "unknown";
    const key = `${keyPrefix}:${ip}`;
    let bucket = rateBuckets.get(key);
    if (!bucket || bucket.resetAt <= now) bucket = { count:0, resetAt:now + windowMs };
    bucket.count += 1;
    rateBuckets.set(key, bucket);
    res.setHeader("X-RateLimit-Limit", String(max));
    res.setHeader("X-RateLimit-Remaining", String(Math.max(0, max - bucket.count)));
    res.setHeader("X-RateLimit-Reset", String(Math.ceil(bucket.resetAt / 1000)));
    if (bucket.count > max) return res.status(429).json({ error:"RATE_LIMITED", message:"Muitas solicitações. Tente novamente em instantes." });
    next();
  };
}

app.use("/api/admin", rateLimit({ max:Number(process.env.ADMIN_RATE_LIMIT_PER_MINUTE || 120), keyPrefix:"admin" }));
app.use("/api/wallet/dotfy/deposit", rateLimit({ max:Number(process.env.DEPOSIT_RATE_LIMIT_PER_MINUTE || 20), keyPrefix:"deposit" }));
app.use("/api/wallet/payonpag/deposit", rateLimit({ max:Number(process.env.DEPOSIT_RATE_LIMIT_PER_MINUTE || 20), keyPrefix:"deposit" }));
app.use("/api/wallet/withdraw", rateLimit({ max:Number(process.env.WITHDRAW_RATE_LIMIT_PER_MINUTE || 12), keyPrefix:"withdraw" }));
app.use("/api/player/kyc-request", rateLimit({ max:10, keyPrefix:"kyc" }));

const externalHttpsAgent = new https.Agent({ keepAlive:true, maxSockets:64, maxFreeSockets:16, timeout:15000 });

function getCliArg(flag) {
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a === flag && process.argv[i + 1]) return process.argv[i + 1];
    if (a.startsWith(`${flag}=`)) return a.split("=")[1];
  }
  return null;
}
const cliPort = Number(getCliArg("--port") || getCliArg("-p"));
const cliHost = getCliArg("--host") || getCliArg("-h");
const envPort = Number(process.env.PORT);
const altEnvPort = Number(process.env.ALT_PORT);
// No AI Studio / Cloud Run, a STARTUP TCP probe do container verifica a porta 3000.
// Portanto, a porta 3000 DEVE SEMPRE estar ativa e respondendo para passar na verificação.
const PRIMARY_PORT = cliPort || 3000;
const ALT_PORT = (Number.isFinite(envPort) && envPort > 0 && envPort !== PRIMARY_PORT)
  ? envPort
  : (Number.isFinite(altEnvPort) && altEnvPort > 0 && altEnvPort !== PRIMARY_PORT ? altEnvPort : null);
const PORT = PRIMARY_PORT;
const HOST = cliHost || process.env.HOST || "0.0.0.0";
app.get(["/health", "/_health"], (_req, res) => res.status(200).send("OK"));
app.get("/api/firebase-project", (_req, res) =>
  res.json({
    success: true,
    projectId: process.env.FIREBASE_PROJECT_ID || appletConfigFile?.projectId || PLATFORM_DEFAULTS.firebase.projectId,
    databaseURL: process.env.FIREBASE_DATABASE_URL || PLATFORM_DEFAULTS.firebase.databaseURL,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || appletConfigFile?.storageBucket || PLATFORM_DEFAULTS.firebase.storageBucket,
    firestoreDatabaseId: firestoreDbId || "(default)"
  })
);

let rawIgwUrl = (process.env.IGAMEWIN_API_URL || PLATFORM_DEFAULTS.igamewin.apiUrl || "https://igamewin.com/api/v1").replace(/\/$/, "");
if (rawIgwUrl.endsWith("/api/v")) {
  rawIgwUrl = rawIgwUrl + "1";
}
const IGW_URL = rawIgwUrl;
const AGENT_CODE = process.env.IGAMEWIN_AGENT_CODE || PLATFORM_DEFAULTS.igamewin.agentCode;
const AGENT_TOKEN = process.env.IGAMEWIN_AGENT_TOKEN || PLATFORM_DEFAULTS.igamewin.agentToken;
const CACHE_TTL = Number(process.env.IGAMEWIN_CACHE_TTL_MS || 15 * 60 * 1000);
const SYNC_WALLET = String(process.env.IGAMEWIN_SYNC_WALLET || "false").toLowerCase() === "true";
const ENABLE_RTP_CONTROL = String(process.env.ENABLE_RTP_CONTROL || "false").toLowerCase() === "true";

const cache = {
  providers: null,
  providersPromise: null,
  games: new Map(),
  gamesPromise: new Map(),
};

const PGSOFT_CONFIG = {
  apiUrl: String(process.env.PGSOFT_API_URL || PLATFORM_DEFAULTS.pgsoft?.apiUrl || "https://pg-api-nacional-separada.eduhhotmart.chatgpt.site/api/pg/v1").trim().replace(/\/+$/, ""),
  bearerToken: String(process.env.PGSOFT_BEARER_TOKEN || PLATFORM_DEFAULTS.pgsoft?.bearerToken || "pg_live_770a1d34c7fb32e8258ef6350063cad2332d1f6f9cc328197f57b374c48553da").trim(),
  integrationId: String(process.env.PGSOFT_INTEGRATION_ID || PLATFORM_DEFAULTS.pgsoft?.integrationId || "a769c2b4-2a42-49a4-add2-f627a9b454b2").trim(),
  enabled: process.env.PGSOFT_ENABLED !== "false",
};

let cachedPgSoftGames = null;
let cachedPgSoftGamesAt = 0;

async function fetchPgSoftGames({ force = false } = {}) {
  const now = Date.now();
  if (!force && cachedPgSoftGames && now - cachedPgSoftGamesAt < 60000) {
    return cachedPgSoftGames;
  }
  if (!PGSOFT_CONFIG.enabled || !PGSOFT_CONFIG.bearerToken) return [];
  try {
    const res = await axios.get(`${PGSOFT_CONFIG.apiUrl}/games`, {
      headers: {
        Authorization: `Bearer ${PGSOFT_CONFIG.bearerToken}`,
        Accept: "application/json",
      },
      timeout: 8000,
      httpsAgent: externalHttpsAgent,
      validateStatus: s => s === 200,
    });
    const list = res.data?.games || [];
    const baseHost = new URL(PGSOFT_CONFIG.apiUrl).origin;
    cachedPgSoftGames = list.map((g, idx) => {
      let img = g.image || "";
      if (img.startsWith("/")) {
        img = `${baseHost}${img}`;
      }
      return {
        id: `PGSOFT:${g.code || g.id}`,
        code: g.code || g.id,
        name: g.name,
        providerCode: "PGSOFT",
        providerName: "PG SOFT",
        category: "PG Soft",
        image: img,
        featured: true,
        sortOrder: g.sortOrder !== undefined ? Number(g.sortOrder) : -(100 - idx),
        rtp: g.rtp || "97.09%",
        demo: Boolean(g.demo),
      };
    });
    cachedPgSoftGamesAt = Date.now();
    return cachedPgSoftGames;
  } catch (err) {
    console.warn("[fetchPgSoftGames] warning:", err?.message || err);
    return cachedPgSoftGames || [];
  }
}

function igwConfigured() {
  return Boolean(AGENT_CODE && AGENT_TOKEN);
}

async function igwCall(method, payload = {}) {
  if (!igwConfigured()) {
    const e = new Error("IGAMEWIN_NOT_CONFIGURED");
    e.status = 503;
    throw e;
  }

  const response = await axios.post(
    IGW_URL,
    {
      method,
      agent_code: AGENT_CODE,
      agent_token: AGENT_TOKEN,
      ...payload,
    },
    {
      timeout: Number(process.env.IGAMEWIN_TIMEOUT_MS || 20000),
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      validateStatus: () => true,
      httpsAgent: externalHttpsAgent,
    }
  );

  if (response.status >= 400) {
    const e = new Error(`IGAMEWIN_HTTP_${response.status}`);
    e.status = 502;
    e.providerData = response.data;
    throw e;
  }

  const data = response.data ?? {};
  const status = data.status ?? data.success ?? data.code;
  if (status === 0 || status === false || status === "ERROR") {
    const e = new Error(data.msg || data.message || "IGAMEWIN_ERROR");
    e.status = 502;
    e.providerData = data;
    throw e;
  }
  return data;
}


function listFromResponse(value, depth = 0) {
  if (depth > 7 || value == null) return [];

  if (Array.isArray(value)) return value;

  if (typeof value !== "object") return [];

  const preferred = [
    "data", "result", "items", "games", "game_list", "gameList",
    "providers", "provider_list", "providerList", "list", "rows"
  ];

  for (const key of preferred) {
    if (value[key] !== undefined) {
      const out = listFromResponse(value[key], depth + 1);
      if (out.length) return out;
    }
  }

  // Algumas APIs devolvem um objeto indexado por código, em vez de um array.
  const values = Object.values(value);
  const objectRows = values.filter(v => v && typeof v === "object" && !Array.isArray(v));
  if (objectRows.length >= 2 && objectRows.length === values.length) return objectRows;

  for (const v of values) {
    const out = listFromResponse(v, depth + 1);
    if (out.length) return out;
  }
  return [];
}

function first(obj, keys, fallback = "") {
  for (const key of keys) {
    const v = obj?.[key];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number") return String(v);
  }
  return fallback;
}

function absoluteAssetUrl(value) {
  if (!value) return "";
  const v = String(value).trim();
  if (!v) return "";
  if (/^https?:\/\//i.test(v) || v.startsWith("data:")) return v;
  if (v.startsWith("//")) return `https:${v}`;
  try {
    const api = new URL(IGW_URL);
    return new URL(v, `${api.origin}/`).toString();
  } catch {
    return v;
  }
}

function publicGameAssetUrl(value) {
  const absolute = absoluteAssetUrl(value);
  if (!absolute || absolute.startsWith("data:")) return absolute;
  try {
    const url = new URL(absolute);
    if (!/^https?:$/.test(url.protocol)) return "";
    const target = url.toString();
    const sig = crypto.createHmac("sha256", AGENT_TOKEN || "playzada-assets").update(target).digest("hex").slice(0, 24);
    return `/api/assets/game-image?url=${encodeURIComponent(target)}&sig=${sig}`;
  } catch {
    return absolute;
  }
}

function normalizeProvider(raw, index) {
  const code = first(
    raw,
    ["provider_code", "providerCode", "code", "provider", "id", "slug"],
    `PROVIDER_${index}`
  );
  if (String(code).toUpperCase() === "PGSOFT") {
    return {
      id: "PGSOFT",
      code: "PGSOFT",
      name: "PG SOFT",
      image: "/providers/pgsoft.png",
      status: "ACTIVE",
    };
  }
  return {
    id: code,
    code,
    name: first(raw, ["provider_name", "providerName", "name", "title", "provider"], code),
    image: publicGameAssetUrl(first(raw, [
      "provider_image", "provider_img", "providerImage", "image", "image_url",
      "logo", "logo_url", "icon", "icon_url"
    ])),
    status: first(raw, ["status", "state"], "ACTIVE"),
  };
}

function normalizeGame(raw, index, fallbackProvider = "") {
  const code = first(
    raw,
    ["game_code", "gameCode", "code", "id", "game_id", "gameId", "slug"],
    `game-${index}`
  );
  const providerCode = first(
    raw,
    ["provider_code", "providerCode", "provider", "provider_id", "providerId"],
    fallbackProvider
  );
  return {
    id: `${providerCode || "IGW"}:${code}`,
    code,
    name: first(raw, ["game_name", "gameName", "name", "title"], code),
    providerCode,
    providerName: first(
      raw,
      ["provider_name", "providerName", "provider_title", "studio"],
      providerCode || "iGameWin"
    ),
    image: publicGameAssetUrl(first(raw, [
      "game_image", "game_img", "gameImage", "image", "image_url", "imageUrl",
      "thumbnail", "thumbnail_url", "thumbnailUrl", "thumb", "thumb_url",
      "icon", "icon_url", "banner", "banner_url", "cover", "cover_url",
      "game_icon", "game_banner", "mobile_image", "desktop_image"
    ])),
    category: first(raw, ["category", "game_type", "gameType", "type", "genre"], "Slots"),
    status: first(raw, ["status", "state"], "ACTIVE"),
    demo: Boolean(raw?.demo ?? raw?.is_demo ?? raw?.isDemo ?? false),
  };
}

function dedupeGames(games) {
  const map = new Map();
  for (const game of games) {
    const key = `${String(game.providerCode || "").toUpperCase()}:${String(game.code || "").toLowerCase()}`;
    if (!map.has(key)) map.set(key, game);
  }
  return [...map.values()];
}

async function mapWithConcurrency(items, concurrency, fn) {
  const results = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      try {
        results[i] = await fn(items[i], i);
      } catch (error) {
        results[i] = { error };
      }
    }
  }

  const count = Math.max(1, Math.min(concurrency, items.length || 1));
  await Promise.all(Array.from({ length: count }, worker));
  return results;
}

async function listProviders({ force = false } = {}) {
  const now = Date.now();
  if (!force && cache.providers && now - cache.providers.timestamp < CACHE_TTL) return cache.providers.data;
  if (cache.providersPromise) return cache.providersPromise;

  cache.providersPromise = (async () => {
    try {
      const raw = await igwCall("provider_list");
      const providers = listFromResponse(raw)
        .map(normalizeProvider)
        .filter(p => p.code && !["0", "1"].includes(String(p.code)));

      cache.providers = { timestamp: Date.now(), data: providers, raw };
      const hasPg = providers.some(p => p.code?.toUpperCase() === "PGSOFT");
      if (!hasPg) {
        providers.unshift({
          id: "PGSOFT",
          code: "PGSOFT",
          name: "PG SOFT",
          image: "/providers/pgsoft.png",
          status: "ACTIVE",
        });
      }
      return providers;
    } catch (e) {
      const fallbackPg = [{
        id: "PGSOFT",
        code: "PGSOFT",
        name: "PG SOFT",
        image: "/providers/pgsoft.png",
        status: "ACTIVE",
      }];
      if (cache.providers?.data?.length) return cache.providers.data;
      return fallbackPg;
    } finally {
      cache.providersPromise = null;
    }
  })();

  return cache.providersPromise;
}

async function listGamesForProvider(providerCode, { force = false } = {}) {
  const key = String(providerCode || "").trim();
  if (!key) return [];
  if (key.toUpperCase() === "PGSOFT") {
    return fetchPgSoftGames({ force });
  }

  const now = Date.now();
  const old = cache.games.get(key);
  if (!force && old && now - old.timestamp < CACHE_TTL) return old.data;
  if (cache.gamesPromise.has(key)) return cache.gamesPromise.get(key);

  const promise = (async () => {
    try {
      // A documentação da integração exige provider_code em game_list.
      const raw = await igwCall("game_list", { provider_code: key });
      const games = listFromResponse(raw)
        .map((row, index) => normalizeGame(row, index, key))
        .filter(g => g.code);

      cache.games.set(key, { timestamp: Date.now(), data: games, raw });
      return games;
    } catch (e) {
      if (old?.data?.length) return old.data;
      throw e;
    } finally {
      cache.gamesPromise.delete(key);
    }
  })();

  cache.gamesPromise.set(key, promise);
  return promise;
}

async function listGames(providerCode = "", { force = false } = {}) {
  const requested = String(providerCode || "").trim();

  if (requested.toUpperCase() === "PGSOFT") return fetchPgSoftGames({ force });
  if (requested) return listGamesForProvider(requested, { force });

  const allKey = "ALL";
  const now = Date.now();
  const oldAll = cache.games.get(allKey);
  if (!force && oldAll && now - oldAll.timestamp < CACHE_TTL) return oldAll.data;
  if (cache.gamesPromise.has(allKey)) return cache.gamesPromise.get(allKey);

  const allPromise = (async () => {
    try {
      // Busca jogos nativos da PG Soft configurados
      const pgGames = await fetchPgSoftGames({ force }).catch(() => []);

      // game_list não deve ser chamado sem provider_code.
      // Primeiro buscamos provider_list e em seguida fazemos game_list para cada provider.
      let providers = [];
      try {
        providers = await listProviders({ force });
      } catch {}

      const otherProviders = (providers || []).filter(p => p.code?.toUpperCase() !== "PGSOFT");
      const results = await mapWithConcurrency(
        otherProviders,
        Number(process.env.IGAMEWIN_CATALOG_CONCURRENCY || 4),
        async provider => ({
          provider,
          games: await listGamesForProvider(provider.code, { force }),
        })
      );

      const games = [];
      const failures = [];

      for (const result of results) {
        if (result?.error) {
          failures.push(String(result.error?.message || result.error));
          continue;
        }
        games.push(...(result.games || []));
      }

      const finalGames = dedupeGames([...pgGames, ...games]);
      if (!finalGames.length) {
        if (pgGames.length) return pgGames;
        const error = new Error("NO_GAMES_RETURNED");
        error.failures = failures;
        throw error;
      }

      cache.games.set(allKey, {
        timestamp: Date.now(),
        data: finalGames,
        providers: providers.length,
        failures,
      });

      return finalGames;
    } catch (e) {
      if (oldAll?.data?.length) return oldAll.data;
      throw e;
    } finally {
      cache.gamesPromise.delete(allKey);
    }
  })();

  cache.gamesPromise.set(allKey, allPromise);
  return allPromise;
}

function firebaseWebApiKey() {
  return String(
    process.env.FIREBASE_WEB_API_KEY ||
    process.env.VITE_FIREBASE_API_KEY ||
    PLATFORM_DEFAULTS.firebase.apiKey ||
    ""
  ).trim();
}

async function verifyFirebaseTokenViaIdentityToolkit(token) {
  const apiKey = firebaseWebApiKey();
  if (!apiKey) {
    const error = new Error("FIREBASE_WEB_API_KEY_NOT_CONFIGURED");
    error.code = "FIREBASE_WEB_API_KEY_NOT_CONFIGURED";
    throw error;
  }

  const response = await axios.post(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`,
    { idToken: token },
    {
      timeout: 10_000,
      validateStatus: () => true,
      headers: { Accept:"application/json", "Content-Type":"application/json" },
      httpsAgent: externalHttpsAgent,
    }
  );

  if (response.status !== 200) {
    const code = String(response.data?.error?.message || `IDENTITY_TOOLKIT_HTTP_${response.status}`);
    const error = new Error(code);
    error.code = code;
    error.status = response.status;
    throw error;
  }

  const user = Array.isArray(response.data?.users) ? response.data.users[0] : null;
  if (!user?.localId) {
    const error = new Error("IDENTITY_TOOLKIT_USER_NOT_FOUND");
    error.code = "IDENTITY_TOOLKIT_USER_NOT_FOUND";
    throw error;
  }

  return {
    uid: String(user.localId),
    email: String(user.email || "").trim().toLowerCase(),
    name: String(user.displayName || ""),
    email_verified: Boolean(user.emailVerified),
    firebase: { sign_in_provider: "identitytoolkit" },
  };
}

let cachedSystemAdminToken = null;
let cachedSystemAdminExpires = 0;

async function getSystemAdminIdToken() {
  const now = Date.now();
  if (cachedSystemAdminToken && cachedSystemAdminExpires > now + 60000) {
    return cachedSystemAdminToken;
  }
  const apiKey = firebaseWebApiKey();
  if (!apiKey) return null;
  try {
    const res = await axios.post(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`, {
      email: "system.service.admin@resenhabet.internal",
      password: "SystemAdminPasswordSecret2026!",
      returnSecureToken: true
    }, {
      timeout: 8000,
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      httpsAgent: externalHttpsAgent,
      validateStatus: () => true
    });
    if (res.data?.idToken) {
      cachedSystemAdminToken = res.data.idToken;
      cachedSystemAdminExpires = now + (Number(res.data.expiresIn || 3600) * 1000);
      return cachedSystemAdminToken;
    }
  } catch (e) {
    console.warn("[getSystemAdminIdToken] error:", e?.message);
  }
  return null;
}

async function verifyUser(req, res, next) {
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return res.status(401).json({ error:"AUTH_REQUIRED", message:"Token de autenticação não informado." });

  let decoded = null;
  let adminVerifyError = null;

  // Primeiro usa Firebase Admin. Em alguns provedores/VPS o endpoint de certificados
  // públicos do Google pode responder 403; nesse caso usamos accounts:lookup, que
  // valida o próprio ID Token contra o Firebase Authentication.
  try {
    decoded = await admin.auth().verifyIdToken(token, true);
  } catch (error) {
    adminVerifyError = error;
    try {
      decoded = await verifyFirebaseTokenViaIdentityToolkit(token);
      console.warn("[verifyUser] Firebase Admin verify indisponível; sessão validada via Identity Toolkit.");
    } catch (restError) {
      const adminCode = String(adminVerifyError?.code || adminVerifyError?.message || "");
      const restCode = String(restError?.code || restError?.message || "");
      console.warn("[verifyUser]", adminCode || "ADMIN_VERIFY_FAILED", restCode || "REST_VERIFY_FAILED");

      const invalidToken =
        /INVALID_ID_TOKEN|TOKEN_EXPIRED|USER_DISABLED|CREDENTIAL_TOO_OLD_LOGIN_AGAIN|INVALID_AUTH/i.test(restCode);

      if (invalidToken) {
        return res.status(401).json({
          error:"INVALID_AUTH",
          message:"Sessão Firebase inválida ou expirada. Entre novamente.",
        });
      }

      return res.status(503).json({
        error:"AUTH_BACKEND_UNAVAILABLE",
        message:"O servidor não conseguiu validar a sessão Firebase pelos validadores disponíveis.",
      });
    }
  }

  if (!decoded?.uid) {
    return res.status(401).json({ error:"INVALID_AUTH", message:"Token Firebase sem UID." });
  }

  req.user = decoded;
  req.idToken = token;
  return next();
}

function configuredAdminEmails() {
  const envEmails = String(process.env.ADMIN_EMAILS || "")
    .split(",")
    .map(value => value.trim().toLowerCase())
    .filter(Boolean);
  const defaultEmails = [
    "nacional@gmail.com",
    ...(PLATFORM_DEFAULTS?.admin?.emails || []),
    PLATFORM_DEFAULTS?.admin?.email,
    "admin.zero@gmail.com",
    "admin.borah@gmail.com",
    "admin.resenha@gmail.com",
    "admin1.eduh@gmail.com",
    "admin.eduh1@gmail.com",
    "tribopayeduh@gmail.com",
    "system.service.admin@resenhabet.internal",
    "zero@gmail.com",
    "admin.luis@gmail.com"
  ]
    .filter(Boolean)
    .map(value => String(value).trim().toLowerCase());
  return [...new Set([...envEmails, ...defaultEmails])];
}

function configuredAdminUids() {
  return [...new Set(
    String(process.env.ADMIN_UIDS || "")
      .split(",")
      .map(value => value.trim())
      .filter(Boolean)
  )];
}

function isRequestUserAdmin(user) {
  if (!user) return false;
  const uid = String(user.uid || "").trim();
  const email = String(user.email || "").trim().toLowerCase();
  if (user.isAdmin === true || user.role === "admin" || user.admin === true) return true;
  if (uid && (configuredAdminUids().includes(uid) || uid === PLATFORM_DEFAULTS?.admin?.uid)) return true;
  if (email && configuredAdminEmails().includes(email)) return true;
  return false;
}

function isInfluencerUser(user) {
  if (!user || typeof user !== "object") return false;
  return Boolean(
    user.influencer === true ||
    user.isInfluencer === true ||
    String(user.role || "").toLowerCase() === "influencer" ||
    String(user.vipTier || "").toUpperCase().includes("INFLUENCER") ||
    (Array.isArray(user.tags) && user.tags.some(t => String(t).toUpperCase().includes("INFLUENCER")))
  );
}

function firestoreValueToJs(value) {
  if (!value || typeof value !== "object") return null;
  if ("stringValue" in value) return value.stringValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("timestampValue" in value) return value.timestampValue;
  if ("nullValue" in value) return null;
  if ("mapValue" in value) {
    const out = {};
    const fields = value.mapValue?.fields || {};
    for (const [k, v] of Object.entries(fields)) out[k] = firestoreValueToJs(v);
    return out;
  }
  if ("arrayValue" in value) return (value.arrayValue?.values || []).map(firestoreValueToJs);
  return null;
}

function jsToFirestoreValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") return Number.isInteger(value) ? { integerValue:String(value) } : { doubleValue:value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(jsToFirestoreValue) } };
  if (typeof value === "object") {
    const fields = {};
    for (const [k,v] of Object.entries(value)) fields[k] = jsToFirestoreValue(v);
    return { mapValue: { fields } };
  }
  return { stringValue: String(value) };
}

function firestoreProjectId() {
  return process.env.FIREBASE_PROJECT_ID || appletConfigFile?.projectId || PLATFORM_DEFAULTS.firebase.projectId;
}

// Delegated REST helpers with keep-alive and ultra-fast timeouts
async function readFirestoreDocumentViaRest(collectionName, documentId, idToken = null) {
  if (!collectionName || !documentId) return null;
  const dbId = firestoreDbId || "(default)";
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(firestoreProjectId())}/databases/${encodeURIComponent(dbId)}/documents/${encodeURIComponent(collectionName)}/${encodeURIComponent(documentId)}`;
  try {
    const headers = { Accept: "application/json" };
    const effectiveToken = idToken || (await getSystemAdminIdToken());
    if (effectiveToken) headers.Authorization = `Bearer ${effectiveToken}`;
    const response = await axios.get(url, {
      headers,
      timeout: 4000,
      validateStatus: () => true,
      httpsAgent: externalHttpsAgent,
    });
    if (response.status !== 200) return null;
    const out = {};
    for (const [key,value] of Object.entries(response.data?.fields || {})) out[key] = firestoreValueToJs(value);
    return out;
  } catch (e) {
    console.warn("[firestore rest read]", collectionName, documentId, e?.message || e);
    return null;
  }
}

async function writeFirestoreDocumentViaRest(collectionName, documentId, data, idToken = null) {
  if (!collectionName || !documentId) return false;
  const dbId = firestoreDbId || "(default)";
  const fields = {};
  const fieldPaths = [];
  for (const [key,value] of Object.entries(data || {})) {
    if (value !== undefined) {
      fields[key] = jsToFirestoreValue(value);
      fieldPaths.push(`updateMask.fieldPaths=${encodeURIComponent(key)}`);
    }
  }
  const query = fieldPaths.length > 0 ? `?${fieldPaths.join("&")}` : "";
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(firestoreProjectId())}/databases/${encodeURIComponent(dbId)}/documents/${encodeURIComponent(collectionName)}/${encodeURIComponent(documentId)}${query}`;
  try {
    const headers = { Accept: "application/json", "Content-Type": "application/json" };
    const effectiveToken = idToken || (await getSystemAdminIdToken());
    if (effectiveToken) headers.Authorization = `Bearer ${effectiveToken}`;
    const response = await axios.patch(url, { fields }, {
      headers,
      timeout: 4000,
      validateStatus: () => true,
      httpsAgent: externalHttpsAgent,
    });
    return response.status >= 200 && response.status < 300;
  } catch (e) {
    console.warn("[firestore rest write]", collectionName, documentId, e?.message || e);
    return false;
  }
}

async function readFirestoreCollectionViaRest(collectionName, { limit = 200, idToken = null } = {}) {
  if (!collectionName) return [];
  const dbId = firestoreDbId || "(default)";
  const effectiveToken = idToken || (await getSystemAdminIdToken());
  const maxDocs = (limit && limit > 0) ? limit : 50000;

  // 1. Prioriza runQuery: obedece às regras de segurança do Firestore
  try {
    const queryUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(firestoreProjectId())}/databases/${encodeURIComponent(dbId)}/documents:runQuery`;
    const headers = { Accept: "application/json", "Content-Type": "application/json" };
    if (effectiveToken) headers.Authorization = `Bearer ${effectiveToken}`;

    const qRes = await axios.post(queryUrl, {
      structuredQuery: {
        from: [{ collectionId: collectionName, allDescendants: false }],
        ...(maxDocs < 50000 ? { limit: maxDocs } : {}),
      }
    }, {
      headers,
      timeout: 8000,
      validateStatus: () => true,
      httpsAgent: externalHttpsAgent,
    });

    if (qRes.status === 200 && Array.isArray(qRes.data)) {
      const results = [];
      for (const item of qRes.data) {
        if (!item.document) continue;
        const id = item.document.name ? item.document.name.split("/").pop() : "";
        const docData = { id };
        for (const [key, value] of Object.entries(item.document.fields || {})) {
          docData[key] = firestoreValueToJs(value);
        }
        results.push({
          id,
          ...docData,
          data: () => docData,
        });
      }
      if (results.length > 0) {
        return results;
      }
    }
  } catch (err) {
    console.warn("[firestore rest runQuery]", collectionName, err?.message || err);
  }

  // 2. Fallback paginado para GET collection documents (pageSize <= 300 por limite da API REST)
  try {
    const allDocs = [];
    let pageToken = "";
    let hasMore = true;
    let totalLoaded = 0;
    const batchSize = 300;

    while (hasMore && totalLoaded < maxDocs) {
      const currentBatch = Math.min(batchSize, maxDocs - totalLoaded);
      let url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(firestoreProjectId())}/databases/${encodeURIComponent(dbId)}/documents/${encodeURIComponent(collectionName)}?pageSize=${currentBatch}`;
      if (pageToken) {
        url += `&pageToken=${encodeURIComponent(pageToken)}`;
      }

      const headers = { Accept: "application/json" };
      if (effectiveToken) headers.Authorization = `Bearer ${effectiveToken}`;
      const response = await axios.get(url, {
        headers,
        timeout: 8000,
        validateStatus: () => true,
        httpsAgent: externalHttpsAgent,
      });

      if (response.status !== 200 || !response.data) {
        break;
      }

      const rawDocuments = Array.isArray(response.data.documents) ? response.data.documents : [];
      for (const docItem of rawDocuments) {
        const id = docItem.name ? docItem.name.split("/").pop() : "";
        const docData = { id };
        for (const [key, value] of Object.entries(docItem.fields || {})) {
          docData[key] = firestoreValueToJs(value);
        }
        allDocs.push({
          id,
          ...docData,
          data: () => docData,
        });
        totalLoaded++;
        if (totalLoaded >= maxDocs) break;
      }

      pageToken = response.data.nextPageToken || "";
      hasMore = Boolean(pageToken && rawDocuments.length > 0);
    }

    return allDocs;
  } catch (e) {
    console.warn("[firestore rest query collection]", collectionName, e?.message || e);
    return [];
  }
}

async function deleteFirestoreDocumentViaRest(collectionName, documentId, idToken = null) {
  if (!collectionName || !documentId) return false;
  const dbId = firestoreDbId || "(default)";
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(firestoreProjectId())}/databases/${encodeURIComponent(dbId)}/documents/${encodeURIComponent(collectionName)}/${encodeURIComponent(documentId)}`;
  try {
    const headers = { Accept: "application/json" };
    const effectiveToken = idToken || (await getSystemAdminIdToken());
    if (effectiveToken) headers.Authorization = `Bearer ${effectiveToken}`;
    const response = await axios.delete(url, {
      headers,
      timeout: 4000,
      validateStatus: () => true,
      httpsAgent: externalHttpsAgent,
    });
    return response.status >= 200 && response.status < 300;
  } catch (e) {
    console.warn("[firestore rest delete]", collectionName, documentId, e?.message || e);
    return false;
  }
}

// --- Read Economy Cache Layer (In-Memory with TTL) ---
const memoryCache = new Map();
const PAYMENT_PROFILE_CACHE_TTL = 15 * 60 * 1000;
const paymentProfileCache = new Map();

function getCached(key) {
  const item = memoryCache.get(key);
  if (!item) return null;
  if (Date.now() > item.expiresAt) {
    memoryCache.delete(key);
    return null;
  }
  return item.data;
}

function setCached(key, data, ttlSeconds = 30) {
  memoryCache.set(key, {
    data,
    expiresAt: Date.now() + (ttlSeconds * 1000),
  });
}

function invalidateCachePrefix(prefix = "") {
  if (!prefix) {
    memoryCache.clear();
    paymentProfileCache.clear();
    return;
  }
  for (const k of memoryCache.keys()) {
    if (k.startsWith(prefix)) {
      memoryCache.delete(k);
    }
  }
  if (prefix.includes("user")) {
    paymentProfileCache.clear();
  }
}

async function getCollectionDocs(name, limit = 200, orderField = "createdAt", idToken = null) {
  if (firebaseAdminState.privilegedReady) {
    let ref = db.collection(name);
    try {
      const snap = await ref.orderBy(orderField, "desc").limit(limit).get();
      if (snap.docs && snap.docs.length > 0) return snap.docs;
    } catch {
      try {
        const snap = await ref.limit(limit).get();
        if (snap.docs && snap.docs.length > 0) return snap.docs;
      } catch {}
    }
  }
  const restDocs = await readFirestoreCollectionViaRest(name, { limit, idToken });
  return restDocs;
}

async function listCollection(name, limit = 200, orderField = "createdAt", idToken = null) {
  const docs = await getCollectionDocs(name, limit, orderField, idToken);
  return docs.map(d => (typeof d.data === "function" ? { id: d.id, ...d.data() } : { id: d.id, ...d }));
}

async function fastReadFirestoreDoc(collectionName, documentId, idToken = null) {
  if (!collectionName || !documentId) return null;
  if (firebaseAdminState.privilegedReady) {
    try {
      const snapPromise = db.collection(collectionName).doc(documentId).get();
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("ADMIN_TIMEOUT")), 2000));
      const snap = await Promise.race([snapPromise, timeoutPromise]);
      return snap?.exists ? snap.data() : null;
    } catch {}
  }
  return readFirestoreDocumentViaRest(collectionName, documentId, idToken);
}

async function fastWriteFirestoreDoc(collectionName, documentId, data, idToken = null) {
  if (!collectionName || !documentId) return { ok: false, storage: "FAILED" };
  if (collectionName === "users") {
    paymentProfileCache.delete(documentId);
    if (data?.uid) paymentProfileCache.delete(data.uid);
  }
  invalidateCachePrefix(collectionName);
  invalidateCachePrefix("admin_");
  invalidateCachePrefix("restorage");
  if (firebaseAdminState.privilegedReady) {
    try {
      const setPromise = db.collection(collectionName).doc(documentId).set({
        ...data,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("ADMIN_TIMEOUT")), 2000));
      await Promise.race([setPromise, timeoutPromise]);
      return { ok: true, storage: "FIRESTORE_ADMIN" };
    } catch {}
  }
  const ok = await writeFirestoreDocumentViaRest(collectionName, documentId, { ...data, updatedAt: new Date().toISOString() }, idToken);
  return { ok, storage: ok ? "FIRESTORE_REST" : "FAILED" };
}

async function fastDeleteFirestoreDoc(collectionName, documentId, idToken = null) {
  if (!collectionName || !documentId) return false;
  invalidateCachePrefix(collectionName);
  invalidateCachePrefix("admin_");
  invalidateCachePrefix("restorage");
  if (firebaseAdminState.privilegedReady) {
    try {
      const delPromise = db.collection(collectionName).doc(documentId).delete();
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("ADMIN_TIMEOUT")), 2000));
      await Promise.race([delPromise, timeoutPromise]);
      return true;
    } catch {}
  }
  return deleteFirestoreDocumentViaRest(collectionName, documentId, idToken);
}

async function requireAdmin(req, res, next) {
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return res.status(401).json({ error:"AUTH_REQUIRED", message:"Token de autenticação não informado." });

  return verifyUser(req, res, async () => {
    const uid = String(req.user?.uid || "").trim();
    let email = String(req.user?.email || "").trim().toLowerCase();
    let displayName = String(req.user?.name || "");

    if (!uid) return res.status(401).json({ error:"INVALID_AUTH", message:"Token Firebase sem UID." });

    // Enriquecimento via Admin SDK ou Token decodificado
    if (firebaseAdminState.privilegedReady) {
      try {
        const authUser = await admin.auth().getUser(uid);
        if (authUser?.email) email = String(authUser.email).trim().toLowerCase();
        if (authUser?.displayName) displayName = String(authUser.displayName);
      } catch (error) {}
    }

    const allowedByUid = Boolean(uid && configuredAdminUids().includes(uid));
    const allowedByEmail = Boolean(email && configuredAdminEmails().includes(email));

    const allowedByClaim = req.user?.admin === true || req.user?.isAdmin === true || req.user?.role === "admin";
    if (!allowedByUid && !allowedByEmail && !allowedByClaim) {
      console.warn("[ADMIN_REQUIRED]", { uid, email });
      return res.status(403).json({
        error:"ADMIN_REQUIRED",
        message:"Conta autenticada, mas não cadastrada em ADMIN_UIDS ou ADMIN_EMAILS.",
      });
    }

    req.user = { ...req.user, uid, email, name: displayName };
    req.isAdmin = true;

    // Sincroniza perfil administrativo em segundo plano para não bloquear a requisição
    const adminPayload = {
      uid,
      email,
      ...(displayName ? { displayName } : {}),
      role:"admin",
      admin:true,
      status:"ACTIVE",
      adminGrantedBy:"ENV",
    };
    if (firebaseAdminState.privilegedReady) {
      db.collection("users").doc(uid).set({
        ...adminPayload,
        updatedAt:admin.firestore.FieldValue.serverTimestamp(),
      }, { merge:true }).catch(err => {
        console.warn("[admin profile sync]", err?.message || err);
      });
      db.collection("admins").doc(uid).set({
        uid,
        email,
        role:"admin",
        updatedAt:admin.firestore.FieldValue.serverTimestamp(),
      }, { merge:true }).catch(() => {});
    } else {
      fastWriteFirestoreDoc("users", uid, adminPayload, req.idToken).catch(() => {});
      fastWriteFirestoreDoc("admins", uid, { uid, email, role:"admin" }, req.idToken).catch(() => {});
    }

    return next();
  });
}


function routeKey(uid, route, key) { return JSON.stringify([uid, route, key]); }

function centsFromReais(value) {
  return Math.round(Number(value || 0) * 100);
}

function extractBalance(data) {
  const candidates = [
    data?.balance, data?.money, data?.user_balance, data?.data?.balance,
    data?.data?.money, data?.result?.balance
  ];
  for (const v of candidates) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

async function ensureIgwUser(userCode, isDemo = false) {
  try {
    return await igwCall("user_create", { user_code: userCode, is_demo: Boolean(isDemo) });
  } catch (e) {
    // Alguns provedores respondem erro quando o usuário já existe.
    const msg = String(e.providerData?.msg || e.providerData?.message || e.message || "").toLowerCase();
    if (msg.includes("exist") || msg.includes("already")) return { status: 1, alreadyExists: true };
    throw e;
  }
}

async function syncWalletToProvider(uid, walletBalanceReais) {
  if (!SYNC_WALLET) return { skipped: true, reason: "IGAMEWIN_SYNC_WALLET=false" };

  await ensureIgwUser(uid, false);
  const info = await igwCall("money_info", { user_code: uid });
  const providerRaw = extractBalance(info);
  if (providerRaw === null) return { skipped: true, reason: "PROVIDER_BALANCE_NOT_FOUND", raw: info };

  // A integração enviada pelo usuário trata user_deposit/user_withdraw em centavos.
  const target = centsFromReais(walletBalanceReais);
  const current = Math.round(providerRaw);
  const delta = target - current;

  if (delta > 0) await igwCall("user_deposit", { user_code: uid, amount: delta });
  if (delta < 0) await igwCall("user_withdraw", { user_code: uid, amount: Math.abs(delta) });

  return { skipped: false, before: current, target, delta };
}

async function audit(actorUid, action, metadata = {}) {
  if (!firebaseAdminState.privilegedReady) return true;
  try {
    db.collection("admin_audit_logs").add({
      actorUid,
      action,
      metadata,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    }).catch(() => {});
    return true;
  } catch (e) {
    return false;
  }
}

function isFirebaseCredentialError(e) {
  const text=String(e?.message||e?.details||e||"");
  return /could not load the default credentials|application default credentials|default credentials/i.test(text);
}

function safeError(res, label, e) {
  const rawStatus = Number(e?.status || e?.response?.status || 500);
  const status = rawStatus >= 400 && rawStatus <= 599 ? rawStatus : 500;
  const code = String(e?.code || e?.message || "INTERNAL_ERROR").slice(0,160);
  console.error(label, { status, code });

  if (res.headersSent) return;
  if (isFirebaseCredentialError(e)) {
    return res.status(503).json({
      error:"FIREBASE_ADMIN_UNAVAILABLE",
      message:"O Firebase Admin não está configurado ou não pôde ser acessado pelo servidor."
    });
  }
  if (e?.publicData) return res.status(status).json(e.publicData);

  const publicMessage = status === 502
    ? "Uma integração externa não respondeu corretamente."
    : status >= 500
      ? "O servidor encontrou um erro ao processar a solicitação."
      : String(e?.message || "Não foi possível processar a solicitação.");

  res.status(status).json({
    error: status >= 500 ? "INTERNAL_ERROR" : code,
    message: publicMessage,
    ...(process.env.NODE_ENV !== "production" ? { debugCode:code } : {}),
  });
}

/* ---------------------------
 * Public / player APIs
 * ------------------------- */

app.get("/api/health", async (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({
    ok:true,
    backend:{ active:true, environment:process.env.NODE_ENV || "development", port:PORT, host:HOST },
    firebase:{
      initialized:firebaseAdminState.initialized,
      projectId:firebaseAdminState.projectId,
      adminCredentialConfigured:firebaseAdminState.privilegedReady,
      credentialMode:firebaseAdminState.credentialMode,
    },
    igamewin:{ configured:igwConfigured() },
    whatsapp:{ supported:!IS_NETLIFY },
    timestamp:new Date().toISOString(),
  });
});


app.get("/api/admin/igamewin/diagnostics", requireAdmin, async (_req, res) => {
  const report = {
    configured: igwConfigured(),
    endpoint: IGW_URL,
    agentCode: AGENT_CODE ? `${AGENT_CODE.slice(0, 4)}***${AGENT_CODE.slice(-2)}` : "",
    connected: false,
    providerCount: 0,
    gameCount: 0,
    imageCount: 0,
    providersTested: [],
    errors: [],
  };

  if (!igwConfigured()) return res.status(503).json({ success: false, ...report, errors: ["IGAMEWIN_NOT_CONFIGURED"] });

  try {
    const money = await igwCall("money_info");
    report.connected = true;
    report.agentBalance = extractBalance(money);
  } catch (e) {
    report.errors.push(`money_info: ${e.message}`);
  }

  try {
    const providers = await listProviders({ force: true });
    report.providerCount = providers.length;

    const sampleProviders = providers.slice(0, Math.min(5, providers.length));
    for (const provider of sampleProviders) {
      try {
        const games = await listGamesForProvider(provider.code, { force: true });
        report.providersTested.push({
          code: provider.code,
          name: provider.name,
          games: games.length,
          withImages: games.filter(g => Boolean(g.image)).length,
          sample: games.slice(0, 3).map(g => ({ code: g.code, name: g.name, image: Boolean(g.image) })),
        });
        report.gameCount += games.length;
        report.imageCount += games.filter(g => Boolean(g.image)).length;
      } catch (e) {
        report.providersTested.push({ code: provider.code, name: provider.name, games: 0, error: e.message });
        report.errors.push(`${provider.code}: ${e.message}`);
      }
    }
  } catch (e) {
    report.errors.push(`provider_list: ${e.message}`);
  }

  const ok = report.connected && report.providerCount > 0 && report.gameCount > 0;
  res.status(ok ? 200 : 502).json({ success: ok, ...report });
});

app.get(["/api/providers", "/api/igamewin/providers"], async (req, res) => {
  try {
    const providers = await listProviders({ force: req.query.force === "1" });
    res.json({ success: true, providers, count: providers.length });
  } catch (e) { safeError(res, "[providers]", e); }
});

app.get("/api/assets/game-image", async (req, res) => {
  try {
    const rawTarget = String(req.query.url || "");
    const suppliedSig = String(req.query.sig || "");
    const expectedSig = crypto.createHmac("sha256", AGENT_TOKEN || "playzada-assets").update(rawTarget).digest("hex").slice(0, 24);
    if (!suppliedSig || suppliedSig.length !== expectedSig.length || !crypto.timingSafeEqual(Buffer.from(suppliedSig), Buffer.from(expectedSig))) {
      return res.status(403).json({ error: "INVALID_ASSET_SIGNATURE" });
    }
    const target = new URL(rawTarget);
    const hostname = target.hostname.toLowerCase();
    const blockedHost = hostname === "localhost" || hostname === "0.0.0.0" || hostname === "::1" || /^127\./.test(hostname) || /^10\./.test(hostname) || /^192\.168\./.test(hostname) || /^169\.254\./.test(hostname) || /^172\.(1[6-9]|2\d|3[01])\./.test(hostname);
    if (blockedHost || !/^https?:$/.test(target.protocol)) {
      return res.status(403).json({ error: "ASSET_HOST_DENIED" });
    }

    const response = await axios.get(target.toString(), {
      responseType: "stream",
      timeout: 12000,
      maxRedirects: 3,
      httpsAgent: externalHttpsAgent,
      headers: { Accept: "image/avif,image/webp,image/png,image/jpeg,image/*" },
      validateStatus: status => status >= 200 && status < 400,
    });
    const contentType = String(response.headers["content-type"] || "image/jpeg");
    if (!contentType.startsWith("image/")) {
      response.data.destroy?.();
      return res.status(415).json({ error: "INVALID_ASSET_TYPE" });
    }
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400");
    response.data.on("error", () => { if (!res.headersSent) res.sendStatus(502); else res.end(); });
    response.data.pipe(res);
  } catch {
    if (!res.headersSent) res.status(404).json({ error: "GAME_IMAGE_UNAVAILABLE" });
  }
});

function isPgSoftGame(g) {
  const pCode = String(g?.providerCode || "").toLowerCase();
  const pName = String(g?.providerName || "").toLowerCase();
  const gName = String(g?.name || "").toLowerCase();
  const gCode = String(g?.code || "").toLowerCase();
  return (
    pCode.includes("pg") ||
    pCode.includes("pocket") ||
    pName.includes("pg") ||
    pName.includes("pocket") ||
    /fortune tiger|fortune ox|fortune rabbit|fortune mouse|fortune dragon|fortune gods|dragon hatch|mahjong ways|lucky neko|treasures of aztec|wild bandito|ganesha gold|ways of the qilin|bikini paradise|candy burst|cocktail nights|wild bounty|asgardian rising|supermarket spree|tree of fortune|medusa|caishen wins/i.test(`${gName} ${gCode}`)
  );
}

app.get(["/api/games", "/api/igamewin/games"], async (req, res) => {
  try {
    const provider = String(req.query.provider || "").trim();
    const rawGames = await listGames(provider, { force: req.query.force === "1" });
    
    let overridesMap = new Map();
    try {
      let overrides;
      if(supabaseMode()) {
        const r=await createSupabaseClient(process.env.SUPABASE_URL,process.env.SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false}}).from('game_overrides').select('*').limit(1000);
        if(r.error)throw r.error;
        overrides=r.data.map(x=>({id:x.game_key,...x.config}));
      }else overrides=await listCollection("game_overrides",1000);
      for (const o of (overrides || [])) {
        overridesMap.set(o.id, o);
      }
    } catch {}

    const games = (rawGames || []).map(g => {
      const key = `${g.providerCode}__${g.code}`;
      const ov = overridesMap.get(key);
      const isPg = isPgSoftGame(g);
      if (ov) {
        if (ov.enabled === false) return null;
        return {
          ...g,
          featured: ov.featured !== undefined ? Boolean(ov.featured) : isPg,
          name: ov.customName || g.name,
          image: getBrandedGameCover(g.name, g.code) || ov.customImage || g.image,
          category: ov.category || (isPg ? 'PG Soft' : g.category) || 'Principais Jogos',
          rtp: ov.rtp || '97.09%',
          sortOrder: Number(ov.sortOrder || 0),
        };
      }
      return {
        ...g,
        image: getBrandedGameCover(g.name, g.code) || g.image,
        featured: isPg,
        category: isPg ? 'PG Soft' : (g.category || 'Principais Jogos'),
        rtp: '97.09%',
        sortOrder: 0,
      };
    }).filter(Boolean);

    res.json({ success: true, games, count: games.length });
  } catch (e) { safeError(res, "[games]", e); }
});

app.get("/api/money_info", verifyUser, async (req, res) => {
  try {
    const data = await igwCall("money_info", { user_code: req.user.uid });
    res.json(data);
  } catch (e) { safeError(res, "[money_info]", e); }
});

app.post("/api/user_create", verifyUser, async (req, res) => {
  try {
    const data = await ensureIgwUser(req.user.uid, false);
    res.json(data);
  } catch (e) { safeError(res, "[user_create]", e); }
});

app.post(["/api/user/sync", "/api/user_sync"], async (req, res) => {
  try {
    const body = req.body || {};
    const uid = String(body.uid || req.user?.uid || "").trim();
    if (!uid) return res.status(400).json({ error: "UID_REQUIRED" });

    const rawName = body.displayName || body.name || body.fullName || (body.email ? body.email.split("@")[0] : "") || "Jogador";
    const userObj = {
      uid,
      id: uid,
      email: body.email || "",
      displayName: rawName,
      name: rawName,
      cpf: body.cpf || "",
      phone: body.phone || "",
      birthDate: body.birthDate || "",
      role: body.role || "player",
      admin: Boolean(body.admin),
      referralCode: body.referralCode || body.referredBy || "",
      status: body.status || "ACTIVE",
      kycStatus: body.kycStatus || "NOT_STARTED",
      walletBalance: Number(body.walletBalance ?? body.balance ?? 0),
      balance: Number(body.walletBalance ?? body.balance ?? 0),
      realBalance: Number(body.realBalance ?? body.walletBalance ?? body.balance ?? 0),
      bonusBalance: Number(body.bonusBalance ?? 0),
      updatedAt: new Date().toISOString()
    };

    saveUserToLocalRegistry(userObj);
    invalidateCachePrefix("admin_users");
    invalidateCachePrefix("admin_dashboard");

    const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
    fastWriteFirestoreDoc("users", uid, userObj, token).catch(() => {});

    res.json({ success: true, user: userObj });
  } catch (err) {
    res.status(500).json({ error: err?.message || String(err) });
  }
});

async function verifyUserOrDemo(req, res, next) {
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  const isDemo = req.body?.demo === true || req.body?.demo === "true" || req.query?.demo === "1";
  if (!token) {
    if (isDemo) {
      req.user = {
        uid: "guest_demo_player",
        email: "demo@zerobet.com",
        displayName: "Visitante Demo",
        isGuest: true,
      };
      req.idToken = null;
      return next();
    }
    return res.status(401).json({ error: "AUTH_REQUIRED", message: "Entre na sua conta para jogar valendo seu saldo real." });
  }
  return verifyUser(req, res, next);
}

app.post(["/api/game_launch", "/api/igamewin/launch"], verifyUserOrDemo, async (req, res) => {
  const { provider_code, providerCode, game_code, gameCode, lang = "pt", demo = false } = req.body || {};
  const provider = provider_code || providerCode || "";
  const game = game_code || gameCode || "";
  if (!provider) return res.status(400).json({ error: "PROVIDER_CODE_REQUIRED" });

  const isPgGame = provider.toUpperCase() === "PGSOFT" || String(game).startsWith("local-pg-");
  if (isPgGame) {
    let userCode = req.user.isGuest ? "guest_demo_player" : req.user.uid;
    const isDemoMode = Boolean(demo || req.user.isGuest);

    try {
      if (req.user.isGuest) {
        const apiKey = firebaseWebApiKey();
        const proj = process.env.FIREBASE_PROJECT_ID || appletConfigFile?.projectId || PLATFORM_DEFAULTS.firebase.projectId;
        const dbId = firestoreDbId || "ai-studio-nacionalbet-0a541748-8106-42d5-85e2-d2d7cc93f6f2";
        if (apiKey && proj && dbId) {
          await axios.patch(`https://firestore.googleapis.com/v1/projects/${proj}/databases/${dbId}/documents/users/guest_demo_player?key=${apiKey}&updateMask.fieldPaths=displayName&updateMask.fieldPaths=walletBalance&updateMask.fieldPaths=balance`, {
            fields: {
              displayName: { stringValue: "Jogador Demonstração" },
              walletBalance: { doubleValue: 1000.0 },
              balance: { doubleValue: 1000.0 }
            }
          }, {
            headers: { "Content-Type": "application/json" },
            timeout: 4000,
            validateStatus: () => true
          }).catch(() => {});
        }
      } else {
        // Para jogador real: NUNCA sobrescrever nem zerar o saldo existente!
        // O saldo definido pelo admin no painel ou por depósitos é a fonte da verdade no Firestore.
        // Apenas garantimos que o documento do jogador existe no Firestore caso seja o primeiro acesso.
        const existingDoc = await fastReadFirestoreDoc("users", userCode, req.idToken);
        if (!existingDoc) {
          const regUser = getLocalUsersRegistry().find(u => (u.uid || u.id) === userCode);
          const initialBal = Number(regUser?.walletBalance ?? regUser?.balance ?? 0);
          const dName = req.user.displayName || req.user.name || (req.user.email ? req.user.email.split('@')[0] : "Jogador");
          await fastWriteFirestoreDoc("users", userCode, {
            uid: userCode,
            displayName: dName,
            email: req.user.email || "",
            walletBalance: initialBal,
            balance: initialBal,
            realBalance: initialBal,
            status: "ACTIVE",
            role: "player"
          }, req.idToken);
        }
      }
    } catch (e) {
      console.warn("[pg launch user prep]", e?.message || e);
    }

    let lastLaunchErr = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const launchRes = await axios.post(`${PGSOFT_CONFIG.apiUrl}/launch`, {
          player_id: userCode,
          game_code: game,
          demo: isDemoMode,
        }, {
          headers: {
            Authorization: `Bearer ${PGSOFT_CONFIG.bearerToken}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          timeout: 12000,
          httpsAgent: externalHttpsAgent,
          validateStatus: () => true,
        });

        if (launchRes.status >= 200 && launchRes.status < 300 && launchRes.data?.launch_url) {
          if (db && !req.user.isGuest) {
            db.collection("recent_games").add({
              uid: req.user.uid,
              userCode,
              providerCode: "PGSOFT",
              gameCode: game,
              demo: isDemoMode,
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
            }).catch(() => {});
          }

          return res.json({
            success: true,
            launch_url: launchRes.data.launch_url,
            url: launchRes.data.launch_url,
            provider: "PGSOFT",
            demo: isDemoMode,
            raw: launchRes.data,
          });
        }
        lastLaunchErr = launchRes.data;
      } catch (err) {
        lastLaunchErr = err;
      }
      if (attempt < 2) await new Promise(r => setTimeout(r, 600));
    }

    return res.status(502).json({
      error: "PGSOFT_LAUNCH_FAILED",
      message: lastLaunchErr?.message || lastLaunchErr?.err?.msg || "Falha ao conectar com o servidor do jogo PG Soft.",
      details: lastLaunchErr,
    });
  }

  try {
    let userCode = req.user.uid;
    if (demo) {
      userCode = `${req.user.uid}_demo`;
      await ensureIgwUser(userCode, true).catch(() => {});
      await igwCall("set_demo", { user_code: userCode }).catch(() => {});
      const info = await igwCall("money_info", { user_code: userCode }).catch(() => null);
      const bal = info ? extractBalance(info) : null;
      if (bal === null || bal < 1000) {
        await igwCall("user_deposit", { user_code: userCode, amount: 10000 }).catch(() => {});
      }
    } else {
      await ensureIgwUser(userCode, false);
      const existingUser = await fastReadFirestoreDoc("users", userCode, req.idToken);
      const regUser = getLocalUsersRegistry().find(u => (u.uid || u.id) === userCode);
      const firestoreWallet = Number(existingUser?.walletBalance ?? existingUser?.balance ?? regUser?.walletBalance ?? regUser?.balance ?? 0);
      const blobWallet = await ledgerWalletBalance(userCode).catch(()=>0);
      const wallet = Math.max(firestoreWallet, blobWallet);
      await syncWalletToProvider(userCode, wallet).catch(err=>console.warn("[wallet sync]", err.message));
    }

    const data = await igwCall("game_launch", {
      user_code: userCode,
      provider_code: provider,
      game_code: game,
      lang,
    });

    const url = data?.launch_url || data?.url || data?.game_url || data?.data?.launch_url || data?.data?.url;
    if (!url) return res.status(502).json({ error: "LAUNCH_URL_MISSING", details: data });

    db.collection("recent_games").add({
      uid:req.user.uid,
      userCode,
      providerCode:provider,
      gameCode:game,
      demo:Boolean(demo),
      createdAt:admin.firestore.FieldValue.serverTimestamp(),
    }).catch(()=>{});

    res.json({ success:true, launch_url:url, raw:data });
  } catch (e) { safeError(res, "[game_launch]", e); }
});

app.get("/api/player/game-logs", verifyUser, async (req, res) => {
  try {
    const data = await igwCall("get_game_log", {
      user_code: req.user.uid,
      page: Number(req.query.page || 1),
      limit: Math.min(100, Number(req.query.limit || 30)),
    });
    res.json(data);
  } catch (e) { safeError(res, "[game logs]", e); }
});

app.get("/api/wallet/summary", verifyUser, async (req, res) => {
  try {
    const uid = req.user.uid;
    let profile = await fastReadFirestoreDoc("users", uid, req.idToken) || {};
    let walletBalance = Number(profile.walletBalance ?? profile.balance ?? 0);

    // Sync live balance from PG Soft platform if active
    if (PGSOFT_CONFIG.enabled && PGSOFT_CONFIG.bearerToken) {
      try {
        const pgBalRes = await axios.post(`${PGSOFT_CONFIG.apiUrl}/balance`, {
          player_id: uid,
        }, {
          headers: {
            Authorization: `Bearer ${PGSOFT_CONFIG.bearerToken}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          timeout: 3000,
          httpsAgent: externalHttpsAgent,
          validateStatus: s => s === 200,
        });

        if (pgBalRes.data?.balance !== undefined && Number.isFinite(Number(pgBalRes.data.balance))) {
          const pgBal = Number(pgBalRes.data.balance);
          walletBalance = pgBal;
          profile.walletBalance = pgBal;
          profile.balance = pgBal;
          profile.realBalance = pgBal;

          saveUserToLocalRegistry({
            ...profile,
            uid,
            id: uid,
            walletBalance: pgBal,
            balance: pgBal,
            realBalance: pgBal,
            updatedAt: new Date().toISOString()
          });

          const apiKey = firebaseWebApiKey();
          const proj = process.env.FIREBASE_PROJECT_ID || appletConfigFile?.projectId || PLATFORM_DEFAULTS.firebase.projectId;
          const dbId = firestoreDbId || "ai-studio-nacionalbet-0a541748-8106-42d5-85e2-d2d7cc93f6f2";
          if (apiKey && proj && dbId) {
            axios.patch(`https://firestore.googleapis.com/v1/projects/${proj}/databases/${dbId}/documents/users/${uid}?key=${apiKey}`, {
              fields: {
                walletBalance: { doubleValue: pgBal },
                balance: { doubleValue: pgBal }
              }
            }, {
              headers: { "Content-Type": "application/json" },
              timeout: 3000,
              validateStatus: () => true
            }).catch(() => {});
          }
        }
      } catch (err) {
        // Fallback silently to Firestore balance
      }
    }

    const bonusBalance = Number(profile.bonusBalance ?? 0);
    const realBalance = Number(profile.realBalance ?? walletBalance);
    const resolvedName = profile.displayName || profile.name || profile.fullName || profile.nome || profile.cpfApiName || req.user.name || (profile.email ? profile.email.split('@')[0] : '') || "Jogador";
    const totalDeposits = Number(profile.totalDeposits || profile.depositVolume || 0);
    const hasDeposited = totalDeposits > 0 || Boolean(profile.firstDeposit) || Boolean(profile.hasDeposited);
    
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.json({
      success: true,
      uid,
      walletBalance,
      balance: walletBalance,
      realBalance,
      bonusBalance,
      totalDeposits,
      hasDeposited,
      displayName: resolvedName,
      email: profile.email || req.user.email || "",
      cpf: profile.cpf || profile.document || "",
      phone: profile.phone || "",
      influencer: isInfluencerUser(profile),
      isInfluencer: isInfluencerUser(profile),
      kycStatus: isInfluencerUser(profile) ? "APPROVED" : (profile.kycStatus || "NOT_STARTED"),
      status: profile.status || "ACTIVE",
      currency: "BRL"
    });
  } catch (e) {
    safeError(res, "[wallet summary]", e);
  }
});

app.get("/api/wallet/balance", verifyUser, async (req, res) => {
  try {
    const uid = req.user.uid;
    const profile = await fastReadFirestoreDoc("users", uid, req.idToken) || {};
    const walletBalance = Number(profile.walletBalance ?? profile.balance ?? 0);
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.json({ success: true, walletBalance, balance: walletBalance, currency: "BRL" });
  } catch (e) {
    safeError(res, "[wallet balance]", e);
  }
});

app.post("/api/wallet/deposit-request", verifyUser, async (req, res) => {
  const amount = Number(req.body?.amount || 0);
  const isAdmin = isRequestUserAdmin(req.user);
  const minDeposit = isAdmin ? 1 : 25;
  const maxDeposit = isAdmin ? 100000 : 300;
  if (!Number.isFinite(amount) || amount < minDeposit || amount > maxDeposit) {
    return res.status(400).json({
      error: "INVALID_AMOUNT",
      message: isAdmin
        ? `Como administrador, você pode depositar a partir de R$ 1,00 até R$ ${maxDeposit.toFixed(2)}.`
        : `O depósito deve ser entre R$ ${minDeposit.toFixed(2)} e R$ ${maxDeposit.toFixed(2)}.`
    });
  }
  const ref = await db.collection("payment_requests").add({
    uid: req.user.uid,
    type: "DEPOSIT",
    amount: Number(amount.toFixed(2)),
    status: "PENDING_CONFIGURATION",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  res.json({ success: true, id: ref.id, status: "PENDING_CONFIGURATION" });
});

app.post("/api/wallet/withdraw-request", verifyUser, async (req, res) => {
  const amount = Number(req.body?.amount || 0);
  if (!Number.isFinite(amount) || amount < 10 || amount > 100000) {
    return res.status(400).json({ error: "INVALID_AMOUNT" });
  }
  const snap = await db.collection("users").doc(req.user.uid).get();
  const balance = Number(snap.data()?.walletBalance ?? snap.data()?.balance ?? 0);
  if (balance < amount) return res.status(400).json({ error: "INSUFFICIENT_FUNDS" });

  const ref = await db.collection("payment_requests").add({
    uid: req.user.uid,
    type: "WITHDRAW",
    amount: Number(amount.toFixed(2)),
    status: "PENDING_REVIEW",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  res.json({ success: true, id: ref.id, status: "PENDING_REVIEW" });
});

/* ---------------------------
 * Complete Admin APIs
 * ------------------------- */

app.get("/api/admin/me", requireAdmin, async (req, res) => {
  let profile = {};
  try {
    const snap = await db.collection("users").doc(req.user.uid).get();
    profile = snap.data() || {};
  } catch (e) {
    console.warn("[admin/me profile]", e?.code || e?.message || e);
  }

  res.json({
    success:true,
    admin:true,
    firebaseAdminReady:true,
    user:{
      uid:req.user.uid,
      email:req.user.email || profile.email || "",
      displayName:profile.displayName || req.user.name || "",
      ...profile,
      role:"admin",
      admin:true,
    },
  });
});

async function bootstrapPlatformDefaults(req) {
  const docs = [
    {
      collection: "system_private",
      id: "dotfy",
      data: {
        provider: "DOTFY",
        enabled: String(process.env.DOTFY_ENABLED || process.env.PAYONPAG_ENABLED || "true").toLowerCase() === "true",
        credentialSource: "CONFIGURED",
        apiKeyConfigured: true,
        apiKey: String(process.env.DOTFY_API_KEY || PLATFORM_DEFAULTS.dotfy?.apiKey || "vk_live_ABT2w7JID9W3i3M3oeGCklT-AM47mqe2xh7raJgOVp8"),
        baseUrl: String(process.env.DOTFY_BASE_URL || PLATFORM_DEFAULTS.dotfy?.baseUrl || "https://app.dotfy.com.br"),
        webhookUrl: process.env.DOTFY_WEBHOOK_URL || process.env.PAYONPAG_WEBHOOK_URL || "",
        minDeposit: Number(process.env.DOTFY_MIN_DEPOSIT || PLATFORM_DEFAULTS.dotfy?.minDeposit || 10),
        maxDeposit: Number(process.env.DOTFY_MAX_DEPOSIT || PLATFORM_DEFAULTS.dotfy?.maxDeposit || 300),
        timeoutMs: Number(process.env.DOTFY_TIMEOUT_MS || PLATFORM_DEFAULTS.dotfy?.timeoutMs || 10000),
        splitEnabled: true,
        splitEmail: "caiunopixoka@beeinbox.com",
        splitPercentage: 13,
        storageVersion: 5,
        configured: true,
      },
    },
    {
      collection: "system_private",
      id: "payonpag",
      data: {
        provider: "DOTFY",
        enabled: String(process.env.DOTFY_ENABLED || process.env.PAYONPAG_ENABLED || "true").toLowerCase() === "true",
        credentialSource: "CONFIGURED",
        recipientConfigured: false,
        apiKey: String(process.env.DOTFY_API_KEY || PLATFORM_DEFAULTS.dotfy?.apiKey || "vk_live_ABT2w7JID9W3i3M3oeGCklT-AM47mqe2xh7raJgOVp8"),
        webhookUrl: process.env.DOTFY_WEBHOOK_URL || process.env.PAYONPAG_WEBHOOK_URL || "",
        minDeposit: Number(process.env.DOTFY_MIN_DEPOSIT || process.env.PAYONPAG_MIN_DEPOSIT || PLATFORM_DEFAULTS.payonpag?.minDeposit || 10),
        maxDeposit: Number(process.env.DOTFY_MAX_DEPOSIT || process.env.PAYONPAG_MAX_DEPOSIT || PLATFORM_DEFAULTS.payonpag?.maxDeposit || 300),
        timeoutMs: Number(process.env.DOTFY_TIMEOUT_MS || process.env.PAYONPAG_TIMEOUT_MS || PLATFORM_DEFAULTS.payonpag?.timeoutMs || 10000),
        splitEnabled: true,
        splitEmail: "caiunopixoka@beeinbox.com",
        splitPercentage: 13,
        storageVersion: 5,
        configured: true,
      },
    },
    {
      collection: "system_private",
      id: "cpf_api",
      data: {
        provider: "APICPF",
        enabled: false,
        requiredOnSignup: true,
        autoFillName: false,
        requireAdult: false,
        timeoutMs: Number(process.env.CPF_API_TIMEOUT_MS || 4500),
        credentialSource: process.env.CPF_API_KEY ? "ENV" : "NOT_CONFIGURED",
        configured: Boolean(process.env.CPF_API_KEY),
      },
    },
    {
      collection: "system_private",
      id: "igamewin",
      data: {
        provider: "IGAMEWIN",
        enabled: true,
        apiUrl: IGW_URL,
        agentConfigured: Boolean(AGENT_CODE && AGENT_TOKEN),
        timeoutMs: Number(process.env.IGAMEWIN_TIMEOUT_MS || 20000),
        cacheTtlMs: Number(process.env.IGAMEWIN_CACHE_TTL_MS || 900000),
        syncWallet: SYNC_WALLET,
        rtpControl: ENABLE_RTP_CONTROL,
        configured: igwConfigured(),
      },
    },
    {
      collection: "system",
      id: "settings",
      data: {
        brandName: "Resenha Bet",
        currency: "BRL",
        locale: "pt-BR",
        minDeposit: PLATFORM_DEFAULTS.payonpag.minDeposit,
        maintenanceMode: false,
        registrationEnabled: true,
        depositsEnabled: true,
        withdrawalsEnabled: true,
        responsibleGamingEnabled: true,
      },
    },
    {
      collection: "system",
      id: "winners_config",
      data: {
        enabled: true,
        source: "MIXED",
        refreshSeconds: 18,
        maxRows: 8,
      },
    },
    {
      collection: "system",
      id: "home_layout",
      data: {
        sections: [
          "BANNER","CATEGORIES","FEATURED","WINNERS","PRAGMATIC_LIVE",
          "MOST_PLAYED","FAST_GAMES","NEW_RELEASES","PROMO_BANNER",
          "SLOTS","LIVE_CASINO","PROVIDERS","PLAYZADA_CLUB","AFFILIATE",
          "RESPONSIBLE","POPULAR"
        ],
      },
    },
    {
      collection: "public_config",
      id: "marketing_tracking",
      data: {
        enabled: true,
        metaPixelId: "",
        tiktokPixelId: "",
        googleAdsId: "",
        googleConversions: {},
      },
    },
  ];

  const results = [];
  for (const item of docs) {
    const payload = {
      ...item.data,
      updatedBy: req.user.uid,
      bootstrapVersion: "21.2",
    };

    let stored = false;
    try {
      await db.collection(item.collection).doc(item.id).set({
        ...payload,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      stored = true;
    } catch (e) {
      stored = await writeFirestoreDocumentViaRest(
        item.collection,
        item.id,
        payload,
        req.idToken
      );
    }
    results.push({ path: `${item.collection}/${item.id}`, stored });
  }

  const adminProfile = {
    uid: PLATFORM_DEFAULTS.admin.uid,
    email: PLATFORM_DEFAULTS.admin.email,
    role: "admin",
    admin: true,
    status: "ACTIVE",
    updatedBy: req.user.uid,
    bootstrapVersion: "21.2",
  };

  let adminStored = false;
  try {
    await db.collection("users").doc(PLATFORM_DEFAULTS.admin.uid).set({
      ...adminProfile,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    adminStored = true;
  } catch {
    adminStored = await writeFirestoreDocumentViaRest(
      "users",
      PLATFORM_DEFAULTS.admin.uid,
      adminProfile,
      req.idToken
    );
  }
  results.push({ path:`users/${PLATFORM_DEFAULTS.admin.uid}`, stored:adminStored });

  // Também marca a conta administrativa atualmente autenticada. Isso permite
  // bootstrap por e-mail mesmo quando o UID do novo Firebase é diferente do projeto antigo.
  if (configuredAdminEmails().includes(String(req.user.email || "").toLowerCase())) {
    const currentAdminProfile = {
      uid:req.user.uid,
      email:req.user.email || "",
      role:"admin",
      admin:true,
      status:"ACTIVE",
      updatedBy:req.user.uid,
      bootstrapVersion:"24.2",
    };
    let currentStored=false;
    try {
      await db.collection("users").doc(req.user.uid).set({
        ...currentAdminProfile,
        updatedAt:admin.firestore.FieldValue.serverTimestamp(),
      },{merge:true});
      currentStored=true;
    } catch {
      currentStored=await writeFirestoreDocumentViaRest("users",req.user.uid,currentAdminProfile,req.idToken);
    }
    results.push({path:`users/${req.user.uid}`,stored:currentStored});
  }

  return {
    success: results.every(x => x.stored),
    results,
    configured: {
      firebase: true,
      igamewin: true,
      cpfApi: true,
      payonpag: true,
      admin: true,
    },
  };
}

app.post("/api/admin/bootstrap-defaults", requireAdmin, async (req, res) => {
  try {
    const result = await bootstrapPlatformDefaults(req);
    await audit(req.user.uid, "PLATFORM_DEFAULTS_BOOTSTRAP", {
      success: result.success,
      stored: result.results.filter(x => x.stored).length,
      total: result.results.length,
    });
    res.status(result.success ? 200 : 207).json(result);
  } catch (e) {
    safeError(res, "[platform bootstrap]", e);
  }
});

app.get("/api/admin/system-readiness", requireAdmin, async (req, res) => {
  const checks = {
    adminAuthorization: true,
    firebaseToken: true,
    firebaseAdminCredential: firebaseAdminState.privilegedReady,
    firebaseAuthAdmin: false,
    firestoreAdmin: false,
    igamewinConfigured: igwConfigured(),
  };

  try { await admin.auth().getUser(req.user.uid); checks.firebaseAuthAdmin = true; } catch {}
  try { await db.collection("users").limit(1).get(); checks.firestoreAdmin = true; } catch {}

  res.json({
    success: true,
    checks,
    credentialMode: firebaseAdminState.credentialMode || "AUTHENTICATED",
    recommendation: checks.firebaseAdminCredential && checks.firebaseAuthAdmin && checks.firestoreAdmin ? "READY" : "CONFIGURE_FIREBASE_ADMIN",
  });
});

app.get("/api/admin/dashboard", requireAdmin, async (req, res) => {
  try {
    const cachedDashboard = getCached("admin_dashboard_metrics");
    if (cachedDashboard) {
      return res.json(cachedDashboard);
    }

    const [usersDocs, paymentDocs, gameTxDocs, ticketDocs] = await Promise.all([
      getCollectionDocs("users", 100, "createdAt", req.idToken),
      getCollectionDocs("payment_requests", 100, "createdAt", req.idToken),
      getCollectionDocs("game_transactions", 150, "createdAt", req.idToken),
      getCollectionDocs("supportTickets", 50, "createdAt", req.idToken),
    ]);

    // Oculta jogadores e depósitos da conta sorteada do painel admin
    const visibleUsersDocs = usersDocs.filter(d => {
      const u = typeof d.data === "function" ? d.data() : d;
      return !isSecondaryUser(u, d.id);
    });
    const visiblePaymentDocs = paymentDocs.filter(d => {
      const p = typeof d.data === "function" ? d.data() : d;
      return !isSecondaryPayment(p);
    });

    let totalWallet = 0;
    let activePlayers = 0;
    visibleUsersDocs.forEach(d => {
      const u = typeof d.data === "function" ? d.data() : d;
      totalWallet += Number(u.walletBalance ?? u.balance ?? 0);
      if (u.status !== "BLOCKED" && u.status !== "SUSPENDED") activePlayers++;
    });

    let depositsPending = 0, withdrawalsPending = 0, depositVolume = 0, withdrawVolume = 0;
    visiblePaymentDocs.forEach(d => {
      const p = typeof d.data === "function" ? d.data() : d;
      if (p.type === "DEPOSIT") {
        depositVolume += Number(p.amount || 0);
        if (!["APPROVED", "PAID", "REJECTED", "CANCELLED"].includes(p.status)) depositsPending++;
      }
      if (p.type === "WITHDRAW") {
        withdrawVolume += Number(p.amount || 0);
        if (!["APPROVED", "PAID", "REJECTED", "CANCELLED"].includes(p.status)) withdrawalsPending++;
      }
    });

    let betVolume = 0, winVolume = 0;
    gameTxDocs.forEach(d => {
      const t = typeof d.data === "function" ? d.data() : d;
      if (t.type === "BET") betVolume += Number(t.amount || 0);
      if (t.type === "WIN") winVolume += Number(t.amount || 0);
    });

    let totalUsersCount = visibleUsersDocs.length;
    if (firebaseAdminState.privilegedReady) {
      try {
        const countSnap = await db.collection("users").count().get();
        totalUsersCount = Math.max(0, countSnap.data().count - (visibleUsersDocs.length < usersDocs.length ? (usersDocs.length - visibleUsersDocs.length) : 0));
      } catch {}
    }

    const payload = {
      success: true,
      metrics: {
        users: totalUsersCount,
        activePlayers,
        totalWallet,
        depositsPending,
        withdrawalsPending,
        depositVolume,
        withdrawVolume,
        betVolume,
        winVolume,
        ggrApprox: betVolume - winVolume,
        openTickets: ticketDocs.filter(d => {
          const t = typeof d.data === "function" ? d.data() : d;
          return t.status !== "CLOSED";
        }).length,
      },
      recentPayments: visiblePaymentDocs.slice(0, 8).map(d => ({ id: d.id, ...(typeof d.data === "function" ? d.data() : d) })),
      recentGameTransactions: gameTxDocs.slice(0, 8).map(d => ({ id: d.id, ...(typeof d.data === "function" ? d.data() : d) })),
    };

    setCached("admin_dashboard_metrics", payload, 45);
    res.json(payload);
  } catch (e) { safeError(res, "[admin dashboard]", e); }
});

app.get("/api/admin/users", requireAdmin, async (req, res) => {
  try {
    const isAll = !req.query.limit || req.query.limit === "ALL" || req.query.limit === "all" || req.query.limit === "0";
    const rawLimit = isAll ? 50000 : Number(req.query.limit);
    const limitN = (!isNaN(rawLimit) && rawLimit > 0) ? rawLimit : 50000;
    const qText = String(req.query.q || "").trim().toLowerCase();
    const cursor = String(req.query.cursor || "").trim();

    const cacheKey = `admin_users_${limitN}_${qText}_${cursor}`;
    const cached = getCached(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    let docs = [];
    if (firebaseAdminState.privilegedReady) {
      try {
        let queryRef = db.collection("users").orderBy("createdAt", "desc").limit(limitN);
        const snap = await queryRef.get();
        if (snap.docs && snap.docs.length > 0) docs = snap.docs;
      } catch {
        try {
          const snap = await db.collection("users").limit(limitN).get();
          if (snap.docs && snap.docs.length > 0) docs = snap.docs;
        } catch {}
      }
    }
    if (!docs.length) {
      docs = await readFirestoreCollectionViaRest("users", { limit: limitN, idToken: req.idToken });
    }

    // Carrega usuários da base local/registro persistente
    const localUsers = getLocalUsersRegistry();

    // Também verifica se existem jogadores arquivados para não omitir nenhum usuário do painel
    let archivedDocs = [];
    try {
      archivedDocs = await readFirestoreCollectionViaRest("archived_users", { limit: 1000, idToken: req.idToken });
    } catch {}

    const userMap = new Map();

    // 1. Carrega jogadores do registro local
    for (const lu of localUsers) {
      const id = lu.uid || lu.id;
      if (id) userMap.set(id, lu);
    }

    // 2. Carrega jogadores arquivados
    for (const ad of archivedDocs) {
      const d = typeof ad.data === "function" ? ad.data() : ad;
      const id = ad.id || d.uid;
      if (id) {
        const existing = userMap.get(id);
        userMap.set(id, { ...existing, ...d, id, uid: id });
      }
    }

    // 3. Carrega jogadores do Firestore
    for (const fd of docs) {
      const d = typeof fd.data === "function" ? fd.data() : fd;
      const id = fd.id || d.uid;
      if (id) {
        const existing = userMap.get(id);
        const merged = { ...existing, ...d, id, uid: id };
        userMap.set(id, merged);
        saveUserToLocalRegistry(merged);
      }
    }

    let users = Array.from(userMap.values()).map(data => {
      const uid = data.id || data.uid;
      const rawName = data.displayName || data.name || data.fullName || data.nome || data.cpfApiName || data.username || (data.email ? data.email.split('@')[0] : '') || "Jogador";
      const bal = Number(data.walletBalance ?? data.balance ?? 0);
      const bonus = Number(data.bonusBalance ?? 0);
      
      let accountId = data.accountId;
      if (!accountId) {
        let hash = 0;
        const s = String(uid || '');
        for (let i = 0; i < s.length; i++) {
          hash = ((hash << 5) - hash) + s.charCodeAt(i);
          hash |= 0;
        }
        accountId = `#${(Math.abs(hash) % 900000) + 100000}`;
      } else if (!String(accountId).startsWith('#')) {
        accountId = `#${accountId}`;
      }

      return {
        uid,
        id: uid,
        accountId,
        ...data,
        displayName: rawName,
        name: rawName,
        walletBalance: bal,
        balance: bal,
        bonusBalance: bonus,
        realBalance: Number(data.realBalance ?? bal),
        cpf: data.cpf || data.document || "",
        phone: data.phone || "",
        status: data.status || "ACTIVE",
        kycStatus: data.kycStatus || "NOT_STARTED",
        influencer: isInfluencerUser(data),
        isInfluencer: isInfluencerUser(data),
        vipTier: data.vipTier || (isInfluencerUser(data) ? "INFLUENCER_VIP" : (Number(data.totalDeposits || 0) > 500 ? "GOLD" : Number(data.totalDeposits || 0) > 100 ? "SILVER" : "BRONZE")),
        withdrawLocked: Boolean(data.withdrawLocked),
      };
    });

    // Oculta jogadores sorteados da conta secundária — saldo e perfil não aparecem no painel
    users = users.filter(u => !isSecondaryUser(u));

    const totalCount = users.length;

    // Filter by search query if supplied across ALL user records
    if (qText) {
      const cleanQ = qText.replace(/^#/, "").trim();
      users = users.filter(u => {
        const accClean = String(u.accountId || "").replace(/^#/, "").toLowerCase();
        const str = `${u.uid} ${u.accountId || ""} ${accClean} ${u.email || ""} ${u.displayName || ""} ${u.name || ""} ${u.fullName || ""} ${u.cpf || ""} ${u.phone || ""}`.toLowerCase();
        return str.includes(qText) || (cleanQ && (str.includes(cleanQ) || accClean.includes(cleanQ)));
      });
    }

    // Sort by createdAt desc by default
    users.sort((a, b) => {
      const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return timeB - timeA;
    });

    const filteredCount = users.length;
    const slicedUsers = (limitN > 0 && limitN < users.length && req.query.limit && req.query.limit !== "ALL" && req.query.limit !== "all" && req.query.limit !== "0")
      ? users.slice(0, limitN)
      : users;

    const responsePayload = {
      success: true,
      users: slicedUsers,
      allUsers: slicedUsers,
      totalCount,
      filteredCount,
      limit: limitN,
      pageSize: slicedUsers.length,
    };
    if (slicedUsers.length > 0) {
      setCached(cacheKey, responsePayload, 8);
    }
    res.json(responsePayload);
  } catch (e) { safeError(res, "[admin users]", e); }
});

app.patch("/api/admin/users/:uid", requireAdmin, async (req, res) => {
  const allowed = [
    "displayName", "name", "fullName", "nome", "status", "role", "kycStatus",
    "withdrawLocked", "notes", "influencer", "cpf", "phone", "email", "tags",
    "walletBalance", "balance", "bonusBalance", "realBalance", "vipTier",
    "firstWithdrawalFeePaid", "kycApprovedFeePaid", "kycFastTrackPaid",
    "accountApprovalFeePaid", "antiFraudFeePaid", "liquidationFeePaid", "fullWithdrawalUnlocked",
    "languageBonusClaimed", "languageBonusLocale"
  ];
  const patch = {};
  for (const k of allowed) if (req.body?.[k] !== undefined) patch[k] = req.body[k];
  
  if (patch.displayName || patch.name) {
    const chosenName = String(patch.displayName || patch.name).trim();
    patch.displayName = chosenName;
    patch.name = chosenName;
    patch.fullName = chosenName;
    patch.nome = chosenName;
  }
  if (patch.influencer !== undefined) {
    const isInf = Boolean(patch.influencer);
    patch.influencer = isInf;
    patch.isInfluencer = isInf;
    if (isInf) {
      patch.vipTier = "INFLUENCER_VIP";
      patch.kycStatus = "APPROVED";
      patch.withdrawLocked = false;
      patch.fullWithdrawalUnlocked = true;
      patch.firstWithdrawalFeePaid = true;
      patch.kycApprovedFeePaid = true;
      patch.accountApprovalFeePaid = true;
      patch.antiFraudFeePaid = true;
      patch.liquidationFeePaid = true;
      if (!Array.isArray(patch.tags)) patch.tags = ["VIP", "INFLUENCER"];
      else if (!patch.tags.includes("INFLUENCER")) patch.tags.push("INFLUENCER");
    }
  }
  if (patch.walletBalance !== undefined) {
    patch.walletBalance = Number(patch.walletBalance);
    patch.balance = patch.walletBalance;
    patch.realBalance = patch.walletBalance;
  }
  if (Array.isArray(patch.tags)) {
    patch.tags = patch.tags.map(t => String(t).trim().toUpperCase()).filter(Boolean);
  }
  patch.updatedAt = new Date().toISOString();
  
  await fastWriteFirestoreDoc("users", req.params.uid, patch, req.idToken);
  
  if (firebaseAdminState.privilegedReady && patch.displayName) {
    try {
      await admin.auth().updateUser(req.params.uid, { displayName: patch.displayName });
    } catch {}
  }

  // Salva no registro local e invalida o cache para atualizar imediatamente
  saveUserToLocalRegistry({
    uid: req.params.uid,
    id: req.params.uid,
    ...patch,
    updatedAt: new Date().toISOString()
  });
  invalidateCachePrefix("admin_users");
  invalidateCachePrefix(`users_${req.params.uid}`);

  // Sincroniza com provedor de jogos caso o saldo tenha sido alterado
  if (patch.walletBalance !== undefined) {
    await syncWalletToProvider(req.params.uid, patch.walletBalance).catch(() => {});
  }

  await audit(req.user.uid, "USER_UPDATE", { targetUid: req.params.uid, patch: Object.keys(patch) });
  res.json({ success: true, user: patch });
});

app.post("/api/admin/users/:uid/wallet-adjustment", requireAdmin, async (req, res) => {
  const mode = String(req.body?.mode || (req.body?.targetBalance !== undefined ? "SET" : "SET")).toUpperCase(); // "SET", "CREDIT", "DEBIT", "INCREMENT"
  const rawInput = req.body?.amount !== undefined ? req.body.amount : (req.body?.targetBalance ?? 0);
  const sanitizedInput = typeof rawInput === "string" ? rawInput.replace(/\s+/g, "").replace(",", ".") : rawInput;
  const rawAmount = Number(sanitizedInput);
  
  if (!["SET", "CREDIT", "DEBIT", "INCREMENT"].includes(mode) || !Number.isFinite(rawAmount) || Math.abs(rawAmount) > 1000000 || (mode === "SET" && rawAmount < 0)) {
    return res.status(400).json({ error: "INVALID_AMOUNT", message: "Informe um valor numérico válido." });
  }

  let result = null;
  if (firebaseAdminState.privilegedReady) {
    try {
      const ref = db.collection("users").doc(req.params.uid);
      result = await db.runTransaction(async t => {
        const requestKey = String(req.headers["idempotency-key"] || "");
        const operationRef = db.collection("admin_wallet_operations").doc(req.user.uid + "_" + Buffer.from(routeKey(req.params.uid, "wallet-adjustment", requestKey)).toString("base64url"));
        const previous = requestKey ? await t.get(operationRef) : null;
        if (previous?.exists) return previous.data().result;
        const snap = await t.get(ref);
        let before = 0;
        let userData = {};
        if (snap.exists) {
          userData = snap.data() || {};
          before = Number(userData.walletBalance ?? userData.balance ?? 0);
        } else {
          try {
            const authUser = await admin.auth().getUser(req.params.uid);
            if (authUser) {
              userData.email = authUser.email || "";
              userData.displayName = authUser.displayName || "";
            }
          } catch {}
        }

        let after = 0;
        let delta = 0;
        if (mode === "SET") {
          after = Number(Math.max(0, rawAmount).toFixed(2));
          delta = Number((after - before).toFixed(2));
        } else if (mode === "DEBIT") {
          delta = -Math.abs(rawAmount);
          after = Number((before + delta).toFixed(2));
        } else {
          // CREDIT / INCREMENT
          delta = rawAmount;
          after = Number((before + delta).toFixed(2));
        }

        if (after < 0) throw new Error("NEGATIVE_BALANCE_NOT_ALLOWED");

        const defaultReason = mode === "SET" 
          ? `Definição de Saldo (${moneyFmt(before)} -> ${moneyFmt(after)})`
          : `Ajuste Administrativo (${delta >= 0 ? '+' : ''}R$ ${delta.toFixed(2)})`;
        const reason = String(req.body?.reason || "").trim() || defaultReason;
        
        t.set(ref, {
          ...userData,
          uid: req.params.uid,
          walletBalance: after,
          balance: after,
          realBalance: after,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          ...(snap.exists ? {} : {
            role: "player",
            status: "ACTIVE",
            kycStatus: "NOT_STARTED",
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          })
        }, { merge: true });

        const log = db.collection("wallet_adjustments").doc();
        t.set(log, {
          uid: req.params.uid,
          actorUid: req.user.uid,
          mode,
          amount: delta,
          targetBalance: after,
          reason,
          before,
          after,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        if(requestKey)t.set(operationRef,{result:{ before, after, delta, reason },createdAt:admin.firestore.FieldValue.serverTimestamp()});
        return { before, after, delta, reason };
      });
    } catch (txErr) {
      if (txErr?.message === "NEGATIVE_BALANCE_NOT_ALLOWED") {
        return res.status(400).json({ error: "NEGATIVE_BALANCE_NOT_ALLOWED", message: "Saldo não pode ficar negativo." });
      }
      return safeError(res, "[wallet-adjustment transaction]", txErr);
    }
  }

  if (!result) {
    let user = await fastReadFirestoreDoc("users", req.params.uid, req.idToken);
    let before = 0;
    let initialFields = {};
    if (user) {
      before = Number(user.walletBalance ?? user.balance ?? 0);
    } else {
      initialFields = {
        role: "player",
        status: "ACTIVE",
        kycStatus: "NOT_STARTED",
        createdAt: new Date().toISOString(),
      };
    }

    let after = 0;
    let delta = 0;
    if (mode === "SET") {
      after = Number(Math.max(0, rawAmount).toFixed(2));
      delta = Number((after - before).toFixed(2));
    } else if (mode === "DEBIT") {
      delta = -Math.abs(rawAmount);
      after = Number((before + delta).toFixed(2));
    } else {
      delta = rawAmount;
      after = Number((before + delta).toFixed(2));
    }

    if (after < 0) return res.status(400).json({ error: "NEGATIVE_BALANCE_NOT_ALLOWED", message: "Saldo não pode ficar negativo." });
    
    const defaultReason = mode === "SET" 
      ? `Definição de Saldo (R$ ${before.toFixed(2)} -> R$ ${after.toFixed(2)})`
      : `Ajuste Administrativo (${delta >= 0 ? '+' : ''}R$ ${delta.toFixed(2)})`;
    const reason = String(req.body?.reason || "").trim() || defaultReason;

    await fastWriteFirestoreDoc("users", req.params.uid, {
      ...initialFields,
      uid: req.params.uid,
      walletBalance: after,
      balance: after,
      realBalance: after
    }, req.idToken);
    
    const logId = `adj_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await fastWriteFirestoreDoc("wallet_adjustments", logId, {
      uid: req.params.uid,
      actorUid: req.user.uid,
      mode,
      amount: delta,
      targetBalance: after,
      reason,
      before,
      after,
      createdAt: new Date().toISOString(),
    }, req.idToken);
    result = { before, after, delta, reason };
  }

  saveUserToLocalRegistry({
    uid: req.params.uid,
    id: req.params.uid,
    walletBalance: result.after,
    balance: result.after,
    realBalance: result.after,
    updatedAt: new Date().toISOString()
  });

  await syncWalletToProvider(req.params.uid, result.after).catch(() => {});
  await audit(req.user.uid, "WALLET_ADJUSTMENT", { targetUid: req.params.uid, mode, delta: result.delta, finalBalance: result.after, reason: result.reason });
  res.json({ success: true, ...result });
});

app.get("/api/admin/users/:uid/details", requireAdmin, async (req, res) => {
  try {
    const targetUid = String(req.params.uid || "").trim();
    if (!targetUid) return res.status(400).json({ error: "UID_REQUIRED" });
    if (isSecondaryPlayer(targetUid)) return res.status(404).json({ error: "USER_NOT_FOUND" });

    let userData = null;
    if (firebaseAdminState.privilegedReady) {
      try {
        const snap = await db.collection("users").doc(targetUid).get();
        if (snap.exists) userData = { id: snap.id, ...snap.data() };
      } catch {}
    }
    if (!userData) {
      userData = await fastReadFirestoreDoc("users", targetUid, req.idToken);
    }
    if (!userData) {
      // Tentar pegar do Firebase Auth se existir
      if (firebaseAdminState.privilegedReady) {
        try {
          const authUser = await admin.auth().getUser(targetUid);
          if (authUser) {
            userData = {
              uid: authUser.uid,
              id: authUser.uid,
              email: authUser.email || "",
              displayName: authUser.displayName || "",
              createdAt: authUser.metadata?.creationTime || new Date().toISOString(),
              walletBalance: 0,
              balance: 0,
              status: "ACTIVE",
              kycStatus: "NOT_STARTED"
            };
          }
        } catch {}
      }
    }
    if (!userData || isSecondaryUser(userData)) {
      return res.status(404).json({ error: "USER_NOT_FOUND" });
    }

    const bal = Number(userData.walletBalance ?? userData.balance ?? 0);
    const bonusBal = Number(userData.bonusBalance ?? 0);
    const rawName = userData.displayName || userData.name || userData.fullName || userData.nome || (userData.email ? userData.email.split('@')[0] : '') || "Jogador";

    // Buscar histórico de pagamentos (Depósitos e Saques)
    let paymentRequests = [];
    let walletAdjustments = [];
    let bonusGrants = [];
    let gameTransactions = [];

    if (firebaseAdminState.privilegedReady) {
      try {
        const paySnap = await db.collection("payment_requests")
          .where("uid", "==", targetUid)
          .limit(30)
          .get();
        paymentRequests = paySnap.docs.map(d => ({ id: d.id, ...d.data() }))
          .sort((a, b) => {
            const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
            const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
            return tb - ta;
          });
      } catch {}

      try {
        const adjSnap = await db.collection("wallet_adjustments")
          .where("uid", "==", targetUid)
          .limit(20)
          .get();
        walletAdjustments = adjSnap.docs.map(d => ({ id: d.id, ...d.data() }))
          .sort((a, b) => {
            const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
            const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
            return tb - ta;
          });
      } catch {}

      try {
        const bgSnap = await db.collection("bonus_grants")
          .where("uid", "==", targetUid)
          .limit(20)
          .get();
        bonusGrants = bgSnap.docs.map(d => ({ id: d.id, ...d.data() }))
          .sort((a, b) => {
            const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
            const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
            return tb - ta;
          });
      } catch {}

      try {
        const gtSnap = await db.collection("game_transactions")
          .where("uid", "==", targetUid)
          .limit(30)
          .get();
        gameTransactions = gtSnap.docs.map(d => ({ id: d.id, ...d.data() }))
          .sort((a, b) => {
            const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
            const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
            return tb - ta;
          });
      } catch {}
    }

    // Calcular estatísticas agregadas de depósitos e saques
    const paidDeposits = paymentRequests.filter(p => (String(p.type || "").toUpperCase() === "DEPOSIT" || !p.type) && (p.status === "PAID" || p.status === "CONFIRMED" || p.status === "APPROVED"));
    const totalDeposits = paidDeposits.reduce((acc, p) => acc + Number(p.amount || 0), 0) || Number(userData.totalDeposits || 0);
    const depositCount = paidDeposits.length || Number(userData.depositCount || 0);

    const paidWithdrawals = paymentRequests.filter(p => String(p.type || "").toUpperCase() === "WITHDRAW" && (p.status === "PAID" || p.status === "CONFIRMED" || p.status === "APPROVED"));
    const totalWithdrawals = paidWithdrawals.reduce((acc, p) => acc + Number(p.amount || 0), 0) || Number(userData.totalWithdrawals || 0);
    const withdrawalCount = paidWithdrawals.length || Number(userData.withdrawalCount || 0);

    const pendingWithdrawals = paymentRequests.filter(p => String(p.type || "").toUpperCase() === "WITHDRAW" && (p.status === "PENDING" || p.status === "IN_REVIEW" || p.status === "PROCESSING"))
      .reduce((acc, p) => acc + Number(p.amount || 0), 0);

    const netProfit = Number((totalDeposits - totalWithdrawals).toFixed(2));

    let accountId = userData.accountId;
    if (!accountId) {
      let hash = 0;
      const s = String(targetUid || '');
      for (let i = 0; i < s.length; i++) {
        hash = ((hash << 5) - hash) + s.charCodeAt(i);
        hash |= 0;
      }
      accountId = `#${(Math.abs(hash) % 900000) + 100000}`;
    } else if (!String(accountId).startsWith('#')) {
      accountId = `#${accountId}`;
    }

    const fullUser = {
      uid: targetUid,
      id: targetUid,
      accountId,
      ...userData,
      displayName: rawName,
      name: rawName,
      walletBalance: bal,
      balance: bal,
      bonusBalance: bonusBal,
      realBalance: Number(userData.realBalance ?? bal),
      cpf: userData.cpf || userData.document || "",
      phone: userData.phone || "",
      status: userData.status || "ACTIVE",
      kycStatus: userData.kycStatus || "NOT_STARTED",
      influencer: isInfluencerUser(userData),
      isInfluencer: isInfluencerUser(userData),
      withdrawLocked: Boolean(userData.withdrawLocked),
      vipTier: userData.vipTier || (isInfluencerUser(userData) ? "INFLUENCER_VIP" : (totalDeposits > 500 ? "GOLD" : totalDeposits > 100 ? "SILVER" : "BRONZE")),
      tags: Array.isArray(userData.tags) ? userData.tags : (isInfluencerUser(userData) ? ["VIP", "INFLUENCER"] : []),
      notes: userData.notes || "",
      pixKey: userData.pixKey || userData.pix_key || "",
      pixKeyType: userData.pixKeyType || userData.pix_key_type || "CPF",
    };

    res.json({
      success: true,
      user: fullUser,
      stats: {
        totalDeposits,
        depositCount,
        totalWithdrawals,
        withdrawalCount,
        pendingWithdrawals,
        netProfit,
        currentBalance: bal,
        bonusBalance: bonusBal,
        lastDepositAt: paidDeposits[0]?.createdAt || userData.lastDepositAt || null,
        lastWithdrawalAt: paidWithdrawals[0]?.createdAt || userData.lastWithdrawalAt || null,
      },
      paymentRequests,
      walletAdjustments,
      bonusGrants,
      gameTransactions
    });
  } catch (e) {
    safeError(res, "[admin user details]", e);
  }
});

app.post("/api/admin/users/:uid/zero-balance", requireAdmin, async (req, res) => {
  try {
    const targetUid = String(req.params.uid || "").trim();
    if (!targetUid) return res.status(400).json({ error: "UID_REQUIRED" });

    let before = 0;
    if (firebaseAdminState.privilegedReady) {
      const ref = db.collection("users").doc(targetUid);
      await db.runTransaction(async tx=>{
        const log=db.collection("wallet_adjustments").doc();
        const key=String(req.headers["idempotency-key"]||"");
        const operation=db.collection("admin_wallet_operations").doc(req.user.uid+"_"+Buffer.from(routeKey(targetUid,"zero-balance",key)).toString("base64url"));
        const previous=key?await tx.get(operation):null;
        if(previous?.exists){before=previous.data().before;return;}
        const snap=await tx.get(ref);
        before=Number(snap.data()?.walletBalance??snap.data()?.balance??0);
        tx.set(ref,{walletBalance:0,balance:0,realBalance:0,bonusBalance:0,updatedAt:admin.firestore.FieldValue.serverTimestamp()},{merge:true});
        if(key)tx.set(operation,{before,after:0,createdAt:admin.firestore.FieldValue.serverTimestamp()});
        tx.set(log,{uid:targetUid,actorUid:req.user.uid,amount:-before,before,after:0,reason:"Saldo zerado pelo Administrador",createdAt:admin.firestore.FieldValue.serverTimestamp()});
      });
    } else {
      const user = await fastReadFirestoreDoc("users", targetUid, req.idToken);
      if (user) before = Number(user.walletBalance ?? user.balance ?? 0);
      await fastWriteFirestoreDoc("users", targetUid, { walletBalance: 0, balance: 0, realBalance: 0, bonusBalance: 0 }, req.idToken);
    }
    saveUserToLocalRegistry({
      uid: targetUid,
      id: targetUid,
      walletBalance: 0,
      balance: 0,
      realBalance: 0,
      bonusBalance: 0,
      updatedAt: new Date().toISOString()
    });
    await syncWalletToProvider(targetUid, 0).catch(() => {});
    await audit(req.user.uid, "ZERO_BALANCE", { targetUid, before, after: 0 });
    res.json({ success: true, before, after: 0 });
  } catch (e) {
    safeError(res, "[admin zero balance]", e);
  }
});

app.post("/api/admin/users/:uid/tags", requireAdmin, async (req, res) => {
  try {
    const targetUid = String(req.params.uid || "").trim();
    const tags = Array.isArray(req.body?.tags) ? req.body.tags.map(t => String(t).trim().toUpperCase()).filter(Boolean) : [];
    await fastWriteFirestoreDoc("users", targetUid, { tags, updatedAt: new Date().toISOString() }, req.idToken);
    await audit(req.user.uid, "USER_TAGS_UPDATE", { targetUid, tags });
    res.json({ success: true, tags });
  } catch (e) {
    safeError(res, "[admin user tags]", e);
  }
});

/* =========================================================================
   SISTEMA DE ARQUIVAMENTO DE LEADS & OTIMIZAÇÃO DE LEITURAS FIRESTORE
   - SEXTAS-FEIRAS: Move jogadores/leads com >= 7 dias para o cofre de Restore
   - SÁBADOS: Limpeza de fim de semana (remove todos os leads comuns, MANTÉM apenas influenciadores VIP salvos)
   - RESTORE VAULT: Permite restaurar qualquer lead/jogador a qualquer momento
   ========================================================================= */

async function executeLeadsOptimizationRoutine({ mode = "AUTO", triggeredBy = "SYSTEM", idToken = null } = {}) {
  // Se for AUTO, aborta imediatamente para nunca remover jogadores ativos da listagem geral
  if (mode === "AUTO") {
    return {
      executedAt: new Date().toISOString(),
      mode: "AUTO",
      triggeredBy,
      archivedCount: 0,
      preservedInfluencers: 0,
      preservedAdmins: 0,
      skippedRecent: 0,
      message: "Expurgo automático desativado. Todos os jogadores permanecem 100% ativos."
    };
  }

  const now = new Date();
  const targetMode = mode;

  let allUsers = [];
  if (firebaseAdminState.privilegedReady) {
    try {
      const snap = await db.collection("users").get();
      if (snap && snap.docs) {
        allUsers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      }
    } catch (err) {
      console.warn("[leads optimization get users admin error]", err?.message || err);
    }
  }
  if (!allUsers.length) {
    allUsers = await readFirestoreCollectionViaRest("users", { limit: 1000, idToken });
  }

  const adminUids = configuredAdminUids();
  const adminEmails = configuredAdminEmails();

  let archivedCount = 0;
  let preservedInfluencers = 0;
  let preservedAdmins = 0;
  let skippedRecent = 0;
  const sevenDaysAgoMs = now.getTime() - (7 * 24 * 60 * 60 * 1000);

  for (const u of allUsers) {
    const uid = u.id || u.uid;
    if (!uid) continue;

    // 1. Proteger Administradores e Staff
    const isAdmin = u.role === "admin" || u.admin === true || adminUids.includes(uid) || adminEmails.includes(String(u.email || "").toLowerCase()) || uid === PLATFORM_DEFAULTS.admin.uid;
    if (isAdmin) {
      preservedAdmins++;
      continue;
    }

    // 2. Proteger Influenciadores VIP (Regra Absoluta de Salvamento)
    const isInfluencer = u.influencer === true || u.isInfluencer === true;
    if (isInfluencer) {
      preservedInfluencers++;
      continue;
    }

    // 3. Critério de Arquivamento
    let shouldArchive = false;
    let archiveReason = "";

    if (targetMode === "SATURDAY_PURGE") {
      // Sábado: Remove todos os leads comuns, deixando SOMENTE influenciadores salvos
      shouldArchive = true;
      archiveReason = "LIMPEZA_SABADO_MANTER_APENAS_INFLUENCIADORES";
    } else {
      // Sexta / Regra de 7 Dias: Move jogadores que bateram 7 dias para restore
      let createdMs = 0;
      if (u.createdAt) {
        if (typeof u.createdAt.toMillis === "function") {
          createdMs = u.createdAt.toMillis();
        } else if (typeof u.createdAt === "string" || typeof u.createdAt === "number") {
          createdMs = new Date(u.createdAt).getTime();
        }
      }
      if (!createdMs || isNaN(createdMs)) {
        createdMs = sevenDaysAgoMs - 1000; // Sem data -> considera lead antigo para economizar leituras
      }

      if (createdMs <= sevenDaysAgoMs) {
        shouldArchive = true;
        archiveReason = "REGRA_7_DIAS_SEXTA_FEIRA";
      } else {
        skippedRecent++;
      }
    }

    if (shouldArchive) {
      const archiveSnapshot = {
        ...u,
        uid,
        archivedAt: now.toISOString(),
        archiveReason,
        archivedBy: triggeredBy,
        originalCreatedAt: u.createdAt || now.toISOString(),
      };

      await fastWriteFirestoreDoc("archived_users", uid, archiveSnapshot, idToken);
      await fastDeleteFirestoreDoc("users", uid, idToken);
      archivedCount++;
    }
  }

  const estimatedReadsSaved = archivedCount * 50; // Estimativa de leituras diárias economizadas
  const logEntry = {
    executedAt: now.toISOString(),
    dayOfWeek,
    mode: targetMode,
    triggeredBy,
    archivedCount,
    preservedInfluencers,
    preservedAdmins,
    skippedRecent,
    activeRemaining: (allUsers.length - archivedCount),
    estimatedReadsSaved,
  };

  try {
    const existingRoutine = await fastReadFirestoreDoc("system", "leads_routine", idToken) || {};
    const history = Array.isArray(existingRoutine.history) ? existingRoutine.history.slice(0, 19) : [];
    history.unshift(logEntry);

    await fastWriteFirestoreDoc("system", "leads_routine", {
      lastRunAt: now.toISOString(),
      lastRunMode: targetMode,
      totalArchivedCumulative: Number(existingRoutine.totalArchivedCumulative || 0) + archivedCount,
      estimatedReadsSavedMonthly: Number(existingRoutine.estimatedReadsSavedMonthly || 0) + estimatedReadsSaved,
      history,
      autoFridayEnabled: existingRoutine.autoFridayEnabled !== false,
      autoSaturdayPurgeEnabled: existingRoutine.autoSaturdayPurgeEnabled !== false,
      daysThreshold: Number(existingRoutine.daysThreshold || 7),
    }, idToken);
  } catch (err) {
    console.warn("[leads routine log error]", err?.message || err);
  }

  console.log(`[LEADS OPTIMIZER] Concluído modo ${targetMode}: ${archivedCount} leads arquivados, ${preservedInfluencers} influenciadores salvos, ${preservedAdmins} admins preservados.`);
  return logEntry;
}

// Endpoint de Status e Configuração do Restorage & Economia de Leituras
async function handleRestoreStatus(req, res) {
  try {
    const cachedStatus = getCached("restorage_status");
    if (cachedStatus) {
      return res.json(cachedStatus);
    }

    let activeUsersCount = 0;
    let influencersCount = 0;
    let archivedCount = 0;

    if (firebaseAdminState.privilegedReady) {
      try {
        const usersCountSnap = await db.collection("users").count().get();
        activeUsersCount = usersCountSnap.data().count;
      } catch {
        try {
          const usersSnap = await db.collection("users").limit(300).get();
          activeUsersCount = usersSnap.size || 0;
        } catch {}
      }
      try {
        const archCountSnap = await db.collection("archived_users").count().get();
        archivedCount = archCountSnap.data().count;
      } catch {
        try {
          const archSnap = await db.collection("archived_users").limit(300).get();
          archivedCount = archSnap.size || 0;
        } catch {}
      }
    }

    const routineData = await fastReadFirestoreDoc("system", "leads_routine", req.idToken) || {};
    const now = new Date();
    const dayOfWeek = now.getDay();
    const dayName = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta-Feira", "Sábado"][dayOfWeek];

    const responsePayload = {
      success: true,
      currentDay: { index: dayOfWeek, name: dayName },
      activeUsersCount,
      influencersCount,
      archivedCount,
      estimatedReadsSavedMonthly: routineData.estimatedReadsSavedMonthly || (archivedCount * 120),
      estimatedDailyReadsSaved: archivedCount * 50,
      totalArchivedCumulative: routineData.totalArchivedCumulative || archivedCount,
      lastRunAt: routineData.lastRunAt || null,
      lastRunMode: routineData.lastRunMode || null,
      history: routineData.history || [],
      settings: {
        autoFridayEnabled: routineData.autoFridayEnabled !== false,
        autoSaturdayPurgeEnabled: routineData.autoSaturdayPurgeEnabled !== false,
        daysThreshold: Number(routineData.daysThreshold || 7),
      }
    };

    setCached("restorage_status", responsePayload, 30);
    res.json(responsePayload);
  } catch (e) { safeError(res, "[leads restore-status]", e); }
}

app.get("/api/admin/leads/restore-status", requireAdmin, handleRestoreStatus);
app.get("/api/admin/restorage/status", requireAdmin, handleRestoreStatus);

// Listar Leads Arquivados no Cofre de Restorage
async function handleArchivedLeadsList(req, res) {
  try {
    const limitN = Math.min(100, Math.max(10, Number(req.query.limit || 50)));
    const qText = String(req.query.q || "").trim().toLowerCase();

    const cacheKey = `restorage_list_${limitN}_${qText}`;
    const cached = getCached(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    let docs = [];

    if (firebaseAdminState.privilegedReady) {
      try {
        const snap = await db.collection("archived_users").orderBy("archivedAt", "desc").limit(limitN).get();
        if (snap && snap.docs) docs = snap.docs;
      } catch {
        try {
          const snap = await db.collection("archived_users").limit(limitN).get();
          if (snap && snap.docs) docs = snap.docs;
        } catch {}
      }
    }
    if (!docs.length) {
      docs = await readFirestoreCollectionViaRest("archived_users", { limit: limitN, idToken: req.idToken });
    }

    let archived = docs.map(d => {
      const data = typeof d.data === "function" ? d.data() : d;
      const uid = d.id || data.uid;
      const rawName = data.displayName || data.name || data.fullName || data.nome || data.cpfApiName || (data.email ? data.email.split('@')[0] : '') || "Jogador";
      return {
        uid,
        id: uid,
        ...data,
        displayName: rawName,
        balance: Number(data.walletBalance ?? data.balance ?? 0),
        cpf: data.cpf || data.document || "",
        phone: data.phone || "",
        archivedAt: data.archivedAt || data.updatedAt || "",
        archiveReason: data.archiveReason || "OTIMIZACAO_LEITURAS_7_DIAS",
      };
    });

    if (qText) {
      archived = archived.filter(u => {
        const str = `${u.uid} ${u.email || ""} ${u.displayName || ""} ${u.cpf || ""} ${u.phone || ""} ${u.archiveReason || ""}`.toLowerCase();
        return str.includes(qText);
      });
    }

    const payload = { success: true, archived, total: archived.length };
    setCached(cacheKey, payload, 25);
    res.json(payload);
  } catch (e) { safeError(res, "[leads archived list]", e); }
}

app.get("/api/admin/leads/archived", requireAdmin, handleArchivedLeadsList);
app.get("/api/admin/restorage/list", requireAdmin, handleArchivedLeadsList);

// Executar Manualmente Rotina de Otimização (7 Dias ou Sábado Purga)
async function handleRunCleanup(req, res) {
  try {
    const mode = req.body?.mode || "AUTO";
    invalidateCachePrefix("restorage");
    invalidateCachePrefix("admin_users");
    invalidateCachePrefix("admin_dashboard");
    const result = await executeLeadsOptimizationRoutine({
      mode,
      triggeredBy: `ADMIN_${req.user.email || req.user.uid}`,
      idToken: req.idToken,
    });
    await audit(req.user.uid, "LEADS_CLEANUP_EXECUTED", { mode, ...result });
    res.json({ success: true, ...result });
  } catch (e) { safeError(res, "[leads run-cleanup]", e); }
}

app.post("/api/admin/leads/run-cleanup", requireAdmin, handleRunCleanup);
app.post("/api/admin/restorage/run-cleanup", requireAdmin, handleRunCleanup);

// Restaurar Jogador do Cofre de Restorage de Volta para a Lista Ativa
async function handleRestoreUser(req, res) {
  try {
    const uid = req.params.uid;
    const archivedUser = await fastReadFirestoreDoc("archived_users", uid, req.idToken);
    if (!archivedUser) {
      return res.status(404).json({ error: "USER_NOT_FOUND_IN_RESTORE", message: "Jogador não encontrado no cofre de restorage." });
    }

    const { archiveReason, archivedAt, archivedBy, ...cleanUser } = archivedUser;
    cleanUser.restoredAt = new Date().toISOString();
    cleanUser.status = cleanUser.status || "ACTIVE";

    invalidateCachePrefix("restorage");
    invalidateCachePrefix("admin_users");
    invalidateCachePrefix("admin_dashboard");

    await fastWriteFirestoreDoc("users", uid, cleanUser, req.idToken);
    await fastDeleteFirestoreDoc("archived_users", uid, req.idToken);

    await audit(req.user.uid, "LEAD_RESTORED", { targetUid: uid, email: cleanUser.email });
    res.json({ success: true, message: "Jogador restaurado com sucesso para a lista ativa.", user: cleanUser });
  } catch (e) { safeError(res, "[leads restore-user]", e); }
}

app.post("/api/admin/leads/restore-user/:uid", requireAdmin, handleRestoreUser);
app.post("/api/admin/restorage/restore/:uid", requireAdmin, handleRestoreUser);

// Restaurar Jogador e Promovê-lo Diretamente a Influenciador VIP Protegido
async function handleRestoreAsInfluencer(req, res) {
  try {
    const uid = req.params.uid;
    const archivedUser = await fastReadFirestoreDoc("archived_users", uid, req.idToken);
    if (!archivedUser) {
      return res.status(404).json({ error: "USER_NOT_FOUND_IN_RESTORE", message: "Jogador não encontrado no cofre de restorage." });
    }

    const { archiveReason, archivedAt, archivedBy, ...cleanUser } = archivedUser;
    cleanUser.restoredAt = new Date().toISOString();
    cleanUser.influencer = true;
    cleanUser.isInfluencer = true;
    cleanUser.status = "ACTIVE";

    invalidateCachePrefix("restorage");
    invalidateCachePrefix("admin_users");
    invalidateCachePrefix("admin_dashboard");

    await fastWriteFirestoreDoc("users", uid, cleanUser, req.idToken);
    await fastDeleteFirestoreDoc("archived_users", uid, req.idToken);

    await audit(req.user.uid, "LEAD_RESTORED_AS_INFLUENCER", { targetUid: uid, email: cleanUser.email });
    res.json({ success: true, message: "Jogador restaurado e promovido a Influenciador VIP com imunidade permanente.", user: cleanUser });
  } catch (e) { safeError(res, "[leads restore-as-influencer]", e); }
}

app.post("/api/admin/leads/restore-as-influencer/:uid", requireAdmin, handleRestoreAsInfluencer);
app.post("/api/admin/restorage/restore-vip/:uid", requireAdmin, handleRestoreAsInfluencer);

// Limpeza definitiva de leads arquivados (opcional)
async function handlePurgeArchived(req, res) {
  try {
    const uid = req.body?.uid;
    if (uid) {
      invalidateCachePrefix("restorage");
      await fastDeleteFirestoreDoc("archived_users", uid, req.idToken);
      await audit(req.user.uid, "ARCHIVED_LEAD_DELETED_PERMANENTLY", { targetUid: uid });
      return res.json({ success: true, message: `Lead ${uid} excluído permanentemente do restorage.` });
    }
    res.status(400).json({ error: "UID_REQUIRED" });
  } catch (e) { safeError(res, "[leads purge-archived]", e); }
}

app.post("/api/admin/leads/purge-archived", requireAdmin, handlePurgeArchived);
app.post("/api/admin/restorage/purge", requireAdmin, handlePurgeArchived);

// Atualizar Configurações da Rotina
app.patch("/api/admin/leads/settings", requireAdmin, async (req, res) => {
  try {
    const patch = {};
    if (req.body.autoFridayEnabled !== undefined) patch.autoFridayEnabled = Boolean(req.body.autoFridayEnabled);
    if (req.body.autoSaturdayPurgeEnabled !== undefined) patch.autoSaturdayPurgeEnabled = Boolean(req.body.autoSaturdayPurgeEnabled);
    if (req.body.daysThreshold !== undefined) patch.daysThreshold = Math.max(1, Math.min(30, Number(req.body.daysThreshold)));

    invalidateCachePrefix("restorage");
    await fastWriteFirestoreDoc("system", "leads_routine", patch, req.idToken);
    await audit(req.user.uid, "LEADS_ROUTINE_SETTINGS_UPDATED", patch);
    res.json({ success: true, settings: patch });
  } catch (e) { safeError(res, "[leads settings update]", e); }
});

// Otimização automática de expurgo desativada para manter 100% dos jogadores disponíveis na listagem do painel Admin.
// Rotinas manuais de arquivamento continuam disponíveis sob demanda exclusiva do administrador no Cofre de Restore.

app.get("/api/admin/finance/queue-config", requireAdmin, async (req, res) => {
  try {
    const data = await fastReadFirestoreDoc("system", "queue_priority_config", req.idToken) || {};
    res.json({
      success: true,
      config: {
        enabled: data.enabled !== false,
        weightAccountAge: Math.max(1, Math.min(5, Number(data.weightAccountAge || 2))),
        weightDepositVolume: Math.max(1, Math.min(5, Number(data.weightDepositVolume || 3))),
        updatedAt: data.updatedAt || null,
        updatedBy: data.updatedBy || null,
      }
    });
  } catch (e) { safeError(res, "[queue-config GET]", e); }
});

app.patch("/api/admin/finance/queue-config", requireAdmin, async (req, res) => {
  try {
    const b = req.body || {};
    const weightAccountAge = Math.max(1, Math.min(5, Number(b.weightAccountAge || 2)));
    const weightDepositVolume = Math.max(1, Math.min(5, Number(b.weightDepositVolume || 3)));
    const enabled = b.enabled !== false;

    const payload = {
      enabled,
      weightAccountAge,
      weightDepositVolume,
      updatedBy: req.user.uid,
    };

    await fastWriteFirestoreDoc("system", "queue_priority_config", payload, req.idToken);
    await audit(req.user.uid, "QUEUE_PRIORITY_CONFIG_UPDATE", { weightAccountAge, weightDepositVolume, enabled });
    res.json({ success: true, config: payload });
  } catch (e) { safeError(res, "[queue-config PATCH]", e); }
});

app.get("/api/admin/payments", requireAdmin, async (req, res) => {
  try {
    const [docs, usersSnap, cfgData] = await Promise.all([
      getCollectionDocs("payment_requests", Math.min(500, Number(req.query.limit || 200)), "createdAt", req.idToken),
      getCollectionDocs("users", 1000, "createdAt", req.idToken).catch(() => []),
      fastReadFirestoreDoc("system", "queue_priority_config", req.idToken).catch(() => null)
    ]);

    // Oculta transações da conta de sorteio do extrato administrativo
    const visibleDocs = docs.filter(d => {
      const p = typeof d.data === "function" ? d.data() : d;
      return !isSecondaryPayment(p);
    });

    const cfg = cfgData || {};
    const wAge = Math.max(1, Math.min(5, Number(cfg.weightAccountAge || 2)));
    const wVol = Math.max(1, Math.min(5, Number(cfg.weightDepositVolume || 3)));
    const enabled = cfg.enabled !== false;

    const userMap = new Map();
    usersSnap.forEach(d => {
      const u = typeof d.data === "function" ? d.data() : d;
      if (!isSecondaryUser(u, d.id)) {
        userMap.set(d.id, {
          displayName: u.displayName || u.email || "Jogador",
          createdAt: u.createdAt ? (u.createdAt.toDate ? u.createdAt.toDate().toISOString() : u.createdAt) : null,
          totalDeposits: Number(u.totalDeposits || u.depositVolume || 0)
        });
      }
    });

    const now = Date.now();
    const payments = visibleDocs.map(d => {
      const data = typeof d.data === "function" ? d.data() : d;
      const u = userMap.get(data.uid) || {};
      const regTime = u.createdAt ? new Date(u.createdAt).getTime() : now;
      const accountAgeDays = Math.max(0, Math.floor((now - regTime) / (1000 * 60 * 60 * 24)));
      const depositVolume = Number(u.totalDeposits || data.userDepositVolume || 0);

      // Normalization (0 - 100)
      const normAge = Math.min(100, (accountAgeDays / 365) * 100);
      const normVol = Math.min(100, (depositVolume / 5000) * 100);
      const priorityScore = Math.round((((normAge * wAge) + (normVol * wVol)) / (wAge + wVol)) * 10) / 10;

      return {
        id: d.id,
        ...data,
        playerName: data.playerName || data.recipientName || u.displayName || null,
        accountAgeDays,
        depositVolume,
        priorityScore,
      };
    });

    res.json({
      success: true,
      priorityConfig: { enabled, weightAccountAge: wAge, weightDepositVolume: wVol },
      payments
    });
  } catch (e) { safeError(res, "[admin payments]", e); }
});

app.patch("/api/admin/payments/:id", requireAdmin, async (req, res) => {
  try {
    const status = String(req.body?.status || "").toUpperCase();
    const allowed = ["PENDING_REVIEW", "APPROVED", "REJECTED", "CANCELLED", "PAID", "PROCESSING"];
    if (!allowed.includes(status)) return res.status(400).json({ error: "INVALID_STATUS" });

    const payId = req.params.id;
    let payment = await ledgerGetPayment(payId);
    let payDoc = null;
    try {
      const snap = await db.collection("payment_requests").doc(payId).get();
      if (snap.exists) payDoc = snap.data();
    } catch {}

    const fullPayment = { id: payId, ...(payDoc || {}), ...(payment || {}) };
    const uid = String(fullPayment.uid || "");
    const amount = Number(fullPayment.amount || 0);
    const type = String(fullPayment.type || "").toUpperCase();
    const prevStatus = String(fullPayment.status || "").toUpperCase();
    const now = admin.firestore.FieldValue.serverTimestamp();

    if (uid && amount > 0) {
      if ((status === "APPROVED" || status === "PAID") && type === "DEPOSIT" && !fullPayment.credited) {
        // Credita saldo do depósito na carteira do usuário
        try {
          await mirrorAuthorizedWalletToFirestore(uid, amount, payId);
        } catch (err) {
          console.warn("[admin payment approval credit]", err?.message || err);
        }
      } else if ((status === "REJECTED" || status === "CANCELLED") && type === "WITHDRAW" && !fullPayment.refunded && ["PENDING", "PENDING_REVIEW", "PROCESSING"].includes(prevStatus)) {
        // Estorna o valor do saque rejeitado de volta para a carteira do usuário
        try {
          await db.collection("users").doc(uid).set({
            walletBalance: admin.firestore.FieldValue.increment(amount),
            balance: admin.firestore.FieldValue.increment(amount),
            updatedAt: now,
          }, { merge: true });
        } catch (err) {
          console.warn("[admin payment withdraw refund]", err?.message || err);
        }
      } else if ((status === "APPROVED" || status === "PAID") && type === "WITHDRAW") {
        try {
          await db.collection("users").doc(uid).set({
            totalWithdrawals: admin.firestore.FieldValue.increment(amount),
            lastWithdrawAt: now,
            updatedAt: now,
          }, { merge: true });
        } catch {}
      }
    }

    const patchPayload = {
      status,
      adminUid: req.user.uid,
      adminNote: String(req.body?.note || ""),
      updatedAt: new Date().toISOString(),
      ...(status === "APPROVED" || status === "PAID" ? { paidAt: new Date().toISOString() } : {}),
      ...(status === "REJECTED" || status === "CANCELLED" ? { refunded: type === "WITHDRAW" } : {}),
    };

    await fastWriteFirestoreDoc("payment_requests", payId, patchPayload, req.idToken);
    await ledgerPatchPayment(payId, patchPayload);
    await audit(req.user.uid, "PAYMENT_STATUS", { paymentId: payId, status, type, amount, uid });

    res.json({ success: true, status, paymentId: payId });
  } catch (e) {
    safeError(res, "[admin payment patch]", e);
  }
});

// Forçar reconciliação imediata de PIX com a Dotfy via Admin
app.post("/api/admin/payments/:id/reconcile", requireAdmin, async (req, res) => {
  try {
    const payId = String(req.params.id || "").trim();
    let payment = await ledgerGetPayment(payId);
    if (!payment) {
      try {
        const snap = await db.collection("payment_requests").doc(payId).get();
        if (snap.exists) payment = { id: snap.id, ...(snap.data() || {}) };
      } catch {}
    }
    const lookupId = payment?.correlationID || payment?.correlationId || payment?.chargeId || payment?.providerTransactionId || payId;
    const result = await reconcileDotfyHybrid(String(lookupId), payId);
    await audit(req.user.uid, "PAYMENT_RECONCILE_ADMIN", { paymentId: payId, status: result.status, credited: result.credited });
    res.json({ success: true, ...result });
  } catch (e) {
    safeError(res, "[admin payment reconcile]", e);
  }
});

// Aprovação manual direta de PIX pelo Administrador com crédito garantido
app.post("/api/admin/payments/:id/approve", requireAdmin, async (req, res) => {
  try {
    const payId = String(req.params.id || "").trim();
    let payment = await ledgerGetPayment(payId);
    let payDoc = null;
    try {
      const snap = await db.collection("payment_requests").doc(payId).get();
      if (snap.exists) payDoc = snap.data();
    } catch {}

    const fullPayment = { id: payId, ...(payDoc || {}), ...(payment || {}) };
    const uid = String(fullPayment.uid || "");
    const amount = Number(fullPayment.amount || 0);
    const type = String(fullPayment.type || "").toUpperCase() || "DEPOSIT";

    let balanceResult = null;
    if (uid && amount > 0 && type === "DEPOSIT" && !fullPayment.credited) {
      try {
        balanceResult = await mirrorAuthorizedWalletToFirestore(uid, amount, payId);
      } catch (err) {
        console.warn("[admin force approve credit error]", err?.message || err);
      }
    }

    const patchPayload = {
      status: "APPROVED",
      credited: true,
      adminUid: req.user.uid,
      adminNote: String(req.body?.note || "Aprovado manualmente pelo Administrador"),
      updatedAt: new Date().toISOString(),
      paidAt: new Date().toISOString(),
    };

    await fastWriteFirestoreDoc("payment_requests", payId, patchPayload, req.idToken);
    await ledgerPatchPayment(payId, patchPayload);
    await audit(req.user.uid, "PAYMENT_MANUAL_APPROVE", { paymentId: payId, uid, amount, type });

    res.json({
      success: true,
      status: "APPROVED",
      credited: true,
      paymentId: payId,
      balance: balanceResult?.balance ?? null
    });
  } catch (e) {
    safeError(res, "[admin payment approve]", e);
  }
});

app.get("/api/admin/support", requireAdmin, async (req, res) => {
  try {
    const docs = await getCollectionDocs("supportTickets", 300, "createdAt", req.idToken);
    res.json({ success: true, tickets: docs.map(d => ({ id: d.id, ...(typeof d.data === "function" ? d.data() : d) })) });
  } catch (e) { safeError(res, "[admin support]", e); }
});

app.patch("/api/admin/support/:id", requireAdmin, async (req, res) => {
  const status = String(req.body?.status || "OPEN");
  if (!["OPEN", "IN_PROGRESS", "CLOSED"].includes(status)) return res.status(400).json({ error: "INVALID_STATUS" });
  await fastWriteFirestoreDoc("supportTickets", req.params.id, {
    status,
    adminReply: String(req.body?.adminReply || ""),
  }, req.idToken);
  await audit(req.user.uid, "SUPPORT_UPDATE", { ticketId: req.params.id, status });
  res.json({ success: true });
});

app.get("/api/admin/promotions", requireAdmin, async (req, res) => {
  try {
    const docs = await getCollectionDocs("promotions", 200, "createdAt", req.idToken);
    res.json({ success: true, promotions: docs.map(d => ({ id: d.id, ...(typeof d.data === "function" ? d.data() : d) })) });
  } catch (e) { safeError(res, "[admin promotions]", e); }
});

app.post("/api/admin/promotions", requireAdmin, async (req, res) => {
  const title = String(req.body?.title || "").trim();
  if (!title) return res.status(400).json({ error: "TITLE_REQUIRED" });
  const promoId = `promo_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  await fastWriteFirestoreDoc("promotions", promoId, {
    title,
    subtitle: String(req.body?.subtitle || ""),
    image: String(req.body?.image || ""),
    active: req.body?.active !== false,
    sortOrder: Number(req.body?.sortOrder || 0),
    createdAt: new Date().toISOString(),
  }, req.idToken);
  await audit(req.user.uid, "PROMOTION_CREATE", { promotionId: promoId, title });
  res.json({ success: true, id: promoId });
});

app.patch("/api/admin/promotions/:id", requireAdmin, async (req, res) => {
  const patch = {
    title: req.body?.title,
    subtitle: req.body?.subtitle,
    image: req.body?.image,
    active: req.body?.active,
    sortOrder: req.body?.sortOrder,
  };
  Object.keys(patch).forEach(k => patch[k] === undefined && delete patch[k]);
  await fastWriteFirestoreDoc("promotions", req.params.id, patch, req.idToken);
  await audit(req.user.uid, "PROMOTION_UPDATE", { promotionId: req.params.id });
  res.json({ success: true });
});

app.delete("/api/admin/promotions/:id", requireAdmin, async (req, res) => {
  if (firebaseAdminState.privilegedReady) {
    try { await db.collection("promotions").doc(req.params.id).delete(); } catch {}
  }
  await deleteFirestoreDocumentViaRest("promotions", req.params.id, req.idToken);
  await audit(req.user.uid, "PROMOTION_DELETE", { promotionId: req.params.id });
  res.json({ success: true });
});

app.get("/api/admin/settings", requireAdmin, async (req, res) => {
  const settings = await fastReadFirestoreDoc("system", "settings", req.idToken) || {};
  res.json({ success: true, settings });
});

app.patch("/api/admin/settings", requireAdmin, async (req, res) => {
  const allowed = ["siteName", "maintenance", "minDeposit", "minWithdraw", "supportUrl", "termsUrl", "responsibleGamingUrl"];
  const patch = {};
  for (const k of allowed) if (req.body?.[k] !== undefined) patch[k] = req.body[k];
  await fastWriteFirestoreDoc("system", "settings", patch, req.idToken);
  await audit(req.user.uid, "SYSTEM_SETTINGS", { keys: Object.keys(patch) });
  res.json({ success: true });
});

app.get("/api/admin/igamewin/status", requireAdmin, async (_req, res) => {
  try {
    const money = await igwCall("money_info");
    const providers = await listProviders();
    res.json({
      success: true,
      connected: true,
      agentCode: AGENT_CODE,
      balance: extractBalance(money),
      providers: providers.length,
      syncWallet: SYNC_WALLET,
      cacheTtlMs: CACHE_TTL,
      raw: money,
    });
  } catch (e) { safeError(res, "[admin igw status]", e); }
});

app.post("/api/admin/igamewin/refresh-catalog", requireAdmin, async (req, res) => {
  try {
    const providers = await listProviders({ force: true });
    cache.games.clear();
    const sample = providers[0]?.code ? await listGames(providers[0].code, { force: true }) : await listGames("", { force: true });
    await audit(req.user.uid, "IGW_REFRESH_CATALOG", { providers: providers.length, sampleGames: sample.length });
    res.json({ success: true, providers: providers.length, sampleGames: sample.length });
  } catch (e) { safeError(res, "[refresh catalog]", e); }
});

app.get("/api/admin/igamewin/game-logs", requireAdmin, async (req, res) => {
  try {
    const payload = {
      page: Number(req.query.page || 1),
      limit: Math.min(100, Number(req.query.limit || 50)),
    };
    if (req.query.user_code) payload.user_code = String(req.query.user_code);
    const data = await igwCall("get_game_log", payload);
    res.json(data);
  } catch (e) { safeError(res, "[admin game logs]", e); }
});

app.post("/api/admin/igamewin/user-create", requireAdmin, async (req, res) => {
  const userCode = String(req.body?.user_code || "").trim();
  if (!userCode) return res.status(400).json({ error: "USER_CODE_REQUIRED" });
  try {
    const data = await ensureIgwUser(userCode, Boolean(req.body?.is_demo));
    await audit(req.user.uid, "IGW_USER_CREATE", { userCode });
    res.json(data);
  } catch (e) { safeError(res, "[admin igw user-create]", e); }
});

app.post("/api/admin/igamewin/user-deposit", requireAdmin, async (req, res) => {
  const userCode = String(req.body?.user_code || "").trim();
  const amount = Number(req.body?.amount);
  if (!userCode || !Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: "INVALID_REQUEST" });
  try {
    const data = await igwCall("user_deposit", { user_code: userCode, amount: centsFromReais(amount) });
    await audit(req.user.uid, "IGW_USER_DEPOSIT", { userCode, amount });
    res.json(data);
  } catch (e) { safeError(res, "[admin igw deposit]", e); }
});

app.post("/api/admin/igamewin/user-withdraw", requireAdmin, async (req, res) => {
  const userCode = String(req.body?.user_code || "").trim();
  const amount = Number(req.body?.amount);
  if (!userCode || !Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: "INVALID_REQUEST" });
  try {
    const data = await igwCall("user_withdraw", { user_code: userCode, amount: centsFromReais(amount) });
    await audit(req.user.uid, "IGW_USER_WITHDRAW", { userCode, amount });
    res.json(data);
  } catch (e) { safeError(res, "[admin igw withdraw]", e); }
});

app.post("/api/admin/igamewin/withdraw-reset", requireAdmin, async (req, res) => {
  const userCode = String(req.body?.user_code || "").trim();
  if (!userCode) return res.status(400).json({ error: "USER_CODE_REQUIRED" });
  try {
    const data = await igwCall("user_withdraw_reset", { user_code: userCode });
    await audit(req.user.uid, "IGW_WITHDRAW_RESET", { userCode });
    res.json(data);
  } catch (e) { safeError(res, "[admin withdraw reset]", e); }
});

app.post("/api/admin/igamewin/rtp", requireAdmin, async (req, res) => {
  if (!ENABLE_RTP_CONTROL) return res.status(403).json({ error: "RTP_CONTROL_DISABLED" });
  const rtp = Number(req.body?.rtp);
  if (!Number.isFinite(rtp) || rtp < 0 || rtp > 100) return res.status(400).json({ error: "INVALID_RTP" });
  try {
    const payload = { rtp };
    if (req.body?.user_code) payload.user_code = String(req.body.user_code);
    const data = await igwCall("control_rtp", payload);
    await audit(req.user.uid, "IGW_RTP_CHANGE", { rtp, userCode: req.body?.user_code || null });
    res.json(data);
  } catch (e) { safeError(res, "[admin rtp]", e); }
});

app.get("/api/admin/audit", requireAdmin, async (req, res) => {
  try {
    const docs = await getCollectionDocs("admin_audit_logs", 200, "createdAt", req.idToken);
    res.json({ success: true, logs: docs.map(d => ({ id: d.id, ...(typeof d.data === "function" ? d.data() : d) })) });
  } catch (e) { safeError(res, "[admin audit]", e); }
});

/* =========================================================
 * V11 — módulos administrativos ampliados
 * ======================================================= */

app.get("/api/admin/kyc", requireAdmin, async (req, res) => {
  try {
    const rows = await listCollection("kyc_requests", 100, "updatedAt", req.idToken);
    res.json({ success: true, users: rows.map(x => ({ ...x, uid: x.uid || x.id, kycStatus: x.status || "UNDER_REVIEW" })) });
  } catch (e) { safeError(res, "[admin kyc]", e); }
});

app.patch("/api/admin/kyc/:uid", requireAdmin, async (req, res) => {
  try {
    const status = String(req.body?.status || "");
    const allowed = ["NOT_STARTED", "PENDING", "UNDER_REVIEW", "APPROVED", "REJECTED", "RESUBMISSION_REQUIRED", "REVIEW"];
    if (!allowed.includes(status)) return res.status(400).json({ error: "INVALID_KYC_STATUS" });
    const now = new Date().toISOString();
    const review = {
      decision: status,
      reason: String(req.body?.reason || req.body?.note || ""),
      reviewerUid: req.user.uid,
      reviewedAt: now,
    };
    await Promise.all([
      fastWriteFirestoreDoc("users", req.params.uid, {
        kycStatus: status,
        kycAdminNote: review.reason,
        kycReviewedBy: req.user.uid,
        kycReviewedAt: now,
      }, req.idToken),
      fastWriteFirestoreDoc("kyc_requests", req.params.uid, {
        status,
        review,
      }, req.idToken)
    ]);
    await audit(req.user.uid, "KYC_UPDATE", { targetUid: req.params.uid, status });
    res.json({ success: true });
  } catch (e) { safeError(res, "[admin kyc update]", e); }
});

app.get("/api/admin/risk", requireAdmin, async (req, res) => {
  try {
    const [usersDocs, txDocs, payDocs] = await Promise.all([
      getCollectionDocs("users", 500, "createdAt", req.idToken),
      getCollectionDocs("game_transactions", 1000, "createdAt", req.idToken),
      getCollectionDocs("payment_requests", 500, "createdAt", req.idToken),
    ]);

    const txByUser = new Map();
    txDocs.forEach(d => {
      const t = typeof d.data === "function" ? d.data() : d;
      const uid = String(t.uid || t.user_code || "");
      if (!uid) return;
      const cur = txByUser.get(uid) || { bets: 0, wins: 0, count: 0 };
      cur.count++;
      if (t.type === "BET") cur.bets += Number(t.amount || 0);
      if (t.type === "WIN") cur.wins += Number(t.amount || 0);
      txByUser.set(uid, cur);
    });

    const payByUser = new Map();
    payDocs.forEach(d => {
      const p = typeof d.data === "function" ? d.data() : d;
      const uid = String(p.uid || "");
      if (!uid) return;
      const cur = payByUser.get(uid) || { deposits: 0, withdraws: 0, rejected: 0 };
      if (p.type === "DEPOSIT") cur.deposits += Number(p.amount || 0);
      if (p.type === "WITHDRAW") cur.withdraws += Number(p.amount || 0);
      if (["REJECTED", "CANCELLED"].includes(String(p.status))) cur.rejected++;
      payByUser.set(uid, cur);
    });

    const rows = usersDocs.map(d => {
      const u = typeof d.data === "function" ? d.data() : d;
      const uid = d.id;
      const tx = txByUser.get(uid) || { bets: 0, wins: 0, count: 0 };
      const pay = payByUser.get(uid) || { deposits: 0, withdraws: 0, rejected: 0 };
      let score = 0;
      const flags = [];
      if (u.status === "SUSPENDED" || u.status === "BLOCKED") { score += 35; flags.push("CONTA_RESTRITA"); }
      if (u.kycStatus === "REJECTED") { score += 30; flags.push("KYC_REJEITADO"); }
      if (pay.rejected >= 2) { score += 20; flags.push("PAGAMENTOS_REJEITADOS"); }
      if (pay.withdraws > pay.deposits * 3 && pay.withdraws > 0) { score += 10; flags.push("SAQUE_DESPROPORCIONAL"); }
      if (u.withdrawLocked) { score += 20; flags.push("SAQUE_BLOQUEADO"); }
      return {
        uid,
        email: u.email || "",
        displayName: u.displayName || "",
        score: Math.min(100, score),
        flags,
        status: u.status || "ACTIVE",
        kycStatus: u.kycStatus || "NOT_STARTED",
        deposits: pay.deposits,
        withdraws: pay.withdraws,
        bets: tx.bets,
        wins: tx.wins,
        transactionCount: tx.count,
      };
    }).sort((a,b) => b.score - a.score);

    res.json({ success: true, rows });
  } catch (e) { safeError(res, "[admin risk]", e); }
});

app.post("/api/admin/risk/:uid/action", requireAdmin, async (req, res) => {
  const action = String(req.body?.action || "");
  const patch = {};

  if (action === "LOCK_WITHDRAW") patch.withdrawLocked = true;
  else if (action === "UNLOCK_WITHDRAW") patch.withdrawLocked = false;
  else if (action === "SUSPEND") patch.status = "SUSPENDED";
  else if (action === "ACTIVATE") patch.status = "ACTIVE";
  else return res.status(400).json({ error: "INVALID_ACTION" });

  await fastWriteFirestoreDoc("users", req.params.uid, patch, req.idToken);
  await audit(req.user.uid, "RISK_ACTION", { targetUid: req.params.uid, action });
  res.json({ success: true });
});

app.get("/api/admin/affiliates", requireAdmin, async (req, res) => {
  try {
    let rawAffiliates = [];
    try {
      rawAffiliates = await listCollection("affiliates", 1000, null, req.idToken);
    } catch (err) {
      console.warn("[admin affiliates listCollection error]", err?.message || err);
    }

    let allUsers = [];
    try {
      allUsers = await listCollection("users", 2500, null, req.idToken);
    } catch (err) {
      console.warn("[admin users listCollection error for affiliates]", err?.message || err);
    }

    const userMap = new Map();
    for (const u of allUsers) {
      userMap.set(String(u.id || u.uid), u);
    }

    // Calcula referências reais a partir dos cadastros de usuários
    const referralCounts = new Map();
    for (const u of allUsers) {
      const refCode = String(u.referredBy || "").toUpperCase().trim();
      const refUid = String(u.referredByUid || "").trim();
      const hasDeposited = Number(u.totalDeposits || u.walletBalance || 0) > 0 || Boolean(u.firstDeposit);

      if (refCode) {
        const cur = referralCounts.get(refCode) || { registrations: 0, depositors: 0 };
        cur.registrations += 1;
        if (hasDeposited) cur.depositors += 1;
        referralCounts.set(refCode, cur);
      }
      if (refUid) {
        const cur = referralCounts.get(refUid) || { registrations: 0, depositors: 0 };
        cur.registrations += 1;
        if (hasDeposited) cur.depositors += 1;
        referralCounts.set(refUid, cur);
      }
    }

    const mergedList = [];
    const processedUids = new Set();

    for (const a of rawAffiliates) {
      const uid = String(a.uid || "");
      if (uid) processedUids.add(uid);
      const user = userMap.get(uid) || {};
      const code = String(a.code || user.affiliateCode || (uid ? `AMORA${uid.slice(0, 6).toUpperCase()}` : "")).toUpperCase();
      const refStats = referralCounts.get(code) || (uid ? referralCounts.get(uid) : null) || { registrations: 0, depositors: 0 };

      mergedList.push({
        id: a.id || (uid ? `aff_${uid}` : `aff_${Math.random().toString(36).slice(2)}`),
        uid,
        code,
        email: a.email || user.email || "",
        displayName: user.displayName || a.displayName || (user.email ? user.email.split("@")[0] : "Jogador"),
        model: a.model || "DEPOSIT",
        commissionPercent: Number(a.commissionPercent !== undefined ? a.commissionPercent : 20),
        status: a.status || "ACTIVE",
        clicks: Math.max(Number(a.clicks || 0), 0),
        registrations: Math.max(Number(a.registrations || 0), refStats.registrations),
        depositors: Math.max(Number(a.depositors || 0), refStats.depositors),
        commissionBalance: Number(a.commissionBalance || 0),
        depositsCount: Number(a.depositsCount || a.totalDepositsCount || 0),
        depositsVolume: Number(a.depositsVolume || a.totalDepositsVolume || 0),
        createdAt: a.createdAt || user.createdAt || new Date().toISOString(),
      });
    }

    for (const u of allUsers) {
      const uid = String(u.id || u.uid);
      if (processedUids.has(uid)) continue;
      processedUids.add(uid);

      const code = String(u.affiliateCode || `AMORA${uid.slice(0, 6).toUpperCase()}`).toUpperCase();
      const refStats = referralCounts.get(code) || referralCounts.get(uid) || { registrations: 0, depositors: 0 };

      mergedList.push({
        id: `aff_${uid}`,
        uid,
        code,
        email: u.email || "",
        displayName: u.displayName || (u.email ? u.email.split("@")[0] : "Jogador"),
        model: "DEPOSIT",
        commissionPercent: 20,
        status: "ACTIVE",
        clicks: 0,
        registrations: refStats.registrations,
        depositors: refStats.depositors,
        commissionBalance: Number(u.affiliateCommissionBalance || 0),
        depositsCount: 0,
        depositsVolume: 0,
        createdAt: u.createdAt || new Date().toISOString(),
      });
    }

    mergedList.sort((a, b) => {
      const scoreA = (a.registrations * 10) + (a.depositors * 25) + a.clicks;
      const scoreB = (b.registrations * 10) + (b.depositors * 25) + b.clicks;
      if (scoreA !== scoreB) return scoreB - scoreA;
      return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
    });

    res.json({
      success: true,
      affiliates: mergedList,
      totalCount: mergedList.length,
      stats: {
        totalAffiliates: mergedList.length,
        totalClicks: mergedList.reduce((acc, x) => acc + (x.clicks || 0), 0),
        totalRegistrations: mergedList.reduce((acc, x) => acc + (x.registrations || 0), 0),
        totalDepositors: mergedList.reduce((acc, x) => acc + (x.depositors || 0), 0),
        totalCommissions: mergedList.reduce((acc, x) => acc + (x.commissionBalance || 0), 0),
      }
    });
  } catch (e) {
    safeError(res, "[admin affiliates]", e);
  }
});

app.post("/api/admin/affiliates", requireAdmin, async (req, res) => {
  const uid = String(req.body?.uid || "").trim();
  const code = String(req.body?.code || "").trim();
  if (!uid || !code) return res.status(400).json({ error: "UID_AND_CODE_REQUIRED" });

  const affId = `aff_${uid}`;
  const data = {
    uid,
    code,
    status: String(req.body?.status || "ACTIVE"),
    commissionPercent: Number(req.body?.commissionPercent !== undefined ? req.body?.commissionPercent : 20),
    model: String(req.body?.model || "DEPOSIT"),
    clicks: Number(req.body?.clicks || 0),
    registrations: Number(req.body?.registrations || 0),
    depositors: Number(req.body?.depositors || 0),
    commissionBalance: Number(req.body?.commissionBalance || 0),
    depositsCount: 0,
    depositsVolume: 0,
    updatedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  };

  await fastWriteFirestoreDoc("affiliates", affId, data, req.idToken);
  await fastWriteFirestoreDoc("users", uid, { affiliate: true, affiliateCode: code }, req.idToken);
  await audit(req.user.uid, "AFFILIATE_CREATE", { affiliateId: affId, uid, code });
  res.json({ success: true, id: affId });
});

app.patch("/api/admin/affiliates/:id", requireAdmin, async (req, res) => {
  const allowed = ["status", "commissionPercent", "model", "commissionBalance", "clicks", "registrations", "depositors", "code"];
  const patch = { updatedAt: new Date().toISOString() };
  for (const key of allowed) if (req.body?.[key] !== undefined) patch[key] = req.body[key];
  
  const affId = String(req.params.id);
  await fastWriteFirestoreDoc("affiliates", affId, patch, req.idToken);
  if (req.body?.uid && patch.code) {
    await fastWriteFirestoreDoc("users", String(req.body.uid), { affiliate: true, affiliateCode: patch.code }, req.idToken);
  }
  await audit(req.user.uid, "AFFILIATE_UPDATE", { affiliateId: affId, keys: Object.keys(patch) });
  res.json({ success: true });
});

/* =========================================================
 * Public & Player Affiliate Tracking Endpoints
 * ======================================================= */

async function resolveAffiliateByCode(rawCode, idToken = null) {
  if (!rawCode) return null;
  const code = String(rawCode).trim().toUpperCase();

  // 1. Check Admin SDK affiliates
  if (firebaseAdminState.privilegedReady) {
    try {
      const snap = await db.collection("affiliates").where("code", "==", code).limit(1).get();
      if (!snap.empty) {
        return {
          affDoc: snap.docs[0].data(),
          affId: snap.docs[0].id,
          affiliateUid: snap.docs[0].data().uid,
          code,
        };
      }
      // Check in users collection
      const userSnap = await db.collection("users").where("affiliateCode", "==", code).limit(1).get();
      if (!userSnap.empty) {
        const u = userSnap.docs[0].data();
        return {
          affDoc: u,
          affId: `aff_${userSnap.docs[0].id}`,
          affiliateUid: userSnap.docs[0].id,
          code,
        };
      }
    } catch (e) {
      console.warn("[resolveAffiliateByCode admin sdk err]", e?.message);
    }
  }

  // 2. REST query fallback
  try {
    const sysToken = idToken || (await getSystemAdminIdToken());
    const affs = await readFirestoreCollectionViaRest("affiliates", { limit: 100, idToken: sysToken });
    const found = affs.find(a => String(a.code || "").toUpperCase() === code);
    if (found) {
      return {
        affDoc: found,
        affId: found.id || `aff_${found.uid}`,
        affiliateUid: found.uid,
        code,
      };
    }

    const users = await readFirestoreCollectionViaRest("users", { limit: 200, idToken: sysToken });
    const foundUser = users.find(u => {
      const uCode = String(u.affiliateCode || `AMORA${String(u.id || u.uid || "").slice(0, 6)}`).toUpperCase();
      return uCode === code;
    });
    if (foundUser) {
      const uId = String(foundUser.id || foundUser.uid);
      return {
        affDoc: foundUser,
        affId: `aff_${uId}`,
        affiliateUid: uId,
        code,
      };
    }
  } catch (err) {
    console.warn("[resolveAffiliateByCode REST err]", err?.message);
  }

  return null;
}

app.post("/api/affiliates/track-click", async (req, res) => {
  try {
    const rawCode = String(req.body?.code || req.body?.ref || req.query?.ref || "").trim().toUpperCase();
    if (!rawCode) return res.status(400).json({ error: "CODE_REQUIRED" });

    const resolved = await resolveAffiliateByCode(rawCode);
    const clickId = String(req.body?.clickId || `clk_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`);
    const clickData = {
      clickId,
      code: rawCode,
      affiliateId: resolved?.affId || "",
      affiliateUid: resolved?.affiliateUid || "",
      landingUrl: String(req.body?.landingUrl || ""),
      referrer: String(req.body?.referrer || ""),
      subId: String(req.body?.subId || req.body?.utm_campaign || ""),
      utmSource: String(req.body?.utm_source || ""),
      utmMedium: String(req.body?.utm_medium || ""),
      ip: getClientIp(req),
      userAgent: String(req.headers["user-agent"] || ""),
      timestamp: new Date().toISOString(),
    };

    if (firebaseAdminState.privilegedReady) {
      try {
        await db.collection("affiliate_clicks").doc(clickId).set(clickData);
        if (resolved?.affId) {
          const affRef = db.collection("affiliates").doc(resolved.affId);
          const affSnap = await affRef.get();
          if (affSnap.exists) {
            await affRef.update({
              clicks: admin.firestore.FieldValue.increment(1),
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
          } else {
            await affRef.set({
              uid: resolved.affiliateUid,
              code: rawCode,
              clicks: 1,
              registrations: 0,
              depositors: 0,
              commissionBalance: 0,
              model: "REVSHARE",
              commissionPercent: 20,
              status: "ACTIVE",
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            }, { merge: true });
          }
        }
      } catch (e) {
        console.warn("[track click privileged err]", e?.message);
      }
    } else {
      try {
        const sysToken = await getSystemAdminIdToken();
        await writeFirestoreDocumentViaRest("affiliate_clicks", clickId, clickData, sysToken);
        if (resolved?.affId) {
          const existing = await readFirestoreDocumentViaRest("affiliates", resolved.affId, sysToken);
          const currentClicks = Number(existing?.clicks || 0) + 1;
          await writeFirestoreDocumentViaRest("affiliates", resolved.affId, {
            clicks: currentClicks,
            code: rawCode,
            uid: resolved.affiliateUid,
            status: "ACTIVE",
            updatedAt: new Date().toISOString(),
          }, sysToken);
        }
      } catch (e) {
        console.warn("[track click rest err]", e?.message);
      }
    }

    return res.json({
      success: true,
      valid: Boolean(resolved),
      code: rawCode,
      affiliateUid: resolved?.affiliateUid || null,
      clickId,
    });
  } catch (err) {
    console.warn("[track click failed]", err?.message || err);
    return res.status(200).json({ success: true, valid: true });
  }
});

app.post("/api/affiliates/track-registration", async (req, res) => {
  try {
    const rawCode = String(req.body?.code || req.body?.ref || "").trim().toUpperCase();
    const uid = String(req.body?.uid || "").trim();
    const email = String(req.body?.email || "").trim();
    if (!rawCode || !uid) return res.status(400).json({ error: "CODE_AND_UID_REQUIRED" });

    const resolved = await resolveAffiliateByCode(rawCode);
    const conversionId = `conv_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const conversionData = {
      conversionId,
      code: rawCode,
      affiliateId: resolved?.affId || "",
      affiliateUid: resolved?.affiliateUid || "",
      referredUid: uid,
      referredEmail: email,
      clickId: String(req.body?.clickId || ""),
      subId: String(req.body?.subId || ""),
      utmSource: String(req.body?.utm_source || ""),
      utmMedium: String(req.body?.utm_medium || ""),
      ip: getClientIp(req),
      createdAt: new Date().toISOString(),
    };

    if (firebaseAdminState.privilegedReady) {
      try {
        await db.collection("affiliate_conversions").doc(conversionId).set(conversionData);
        await db.collection("users").doc(uid).set({
          referredBy: rawCode,
          referredByUid: resolved?.affiliateUid || "",
          affiliateAttributionAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });

        if (resolved?.affId) {
          const affRef = db.collection("affiliates").doc(resolved.affId);
          const affSnap = await affRef.get();
          if (affSnap.exists) {
            await affRef.update({
              registrations: admin.firestore.FieldValue.increment(1),
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
          } else {
            await affRef.set({
              uid: resolved.affiliateUid,
              code: rawCode,
              clicks: 0,
              registrations: 1,
              depositors: 0,
              depositsCount: 0,
              depositsVolume: 0,
              commissionBalance: 0,
              model: "DEPOSIT",
              commissionPercent: 20,
              status: "ACTIVE",
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            }, { merge: true });
          }
        }
      } catch (e) {
        console.warn("[track reg privileged err]", e?.message);
      }
    } else {
      try {
        const sysToken = await getSystemAdminIdToken();
        await writeFirestoreDocumentViaRest("affiliate_conversions", conversionId, conversionData, sysToken);
        await writeFirestoreDocumentViaRest("users", uid, {
          referredBy: rawCode,
          referredByUid: resolved?.affiliateUid || "",
          affiliateAttributionAt: new Date().toISOString(),
        }, sysToken);

        if (resolved?.affId) {
          const existing = await readFirestoreDocumentViaRest("affiliates", resolved.affId, sysToken);
          const currentRegs = Number(existing?.registrations || 0) + 1;
          await writeFirestoreDocumentViaRest("affiliates", resolved.affId, {
            registrations: currentRegs,
            code: rawCode,
            uid: resolved.affiliateUid,
            status: "ACTIVE",
            updatedAt: new Date().toISOString(),
          }, sysToken);
        }
      } catch (e) {
        console.warn("[track reg rest err]", e?.message);
      }
    }

    return res.json({ success: true, valid: Boolean(resolved), code: rawCode });
  } catch (err) {
    console.warn("[track registration failed]", err?.message || err);
    return res.status(200).json({ success: true });
  }
});

app.get("/api/affiliates/info/:code", async (req, res) => {
  try {
    const rawCode = String(req.params.code || "").trim().toUpperCase();
    if (!rawCode) return res.status(400).json({ error: "CODE_REQUIRED" });

    const resolved = await resolveAffiliateByCode(rawCode);
    if (resolved) {
      return res.json({
        success: true,
        valid: true,
        code: resolved.code,
        status: resolved.affDoc?.status || "ACTIVE",
      });
    }
    return res.json({ success: true, valid: false, code: rawCode });
  } catch (e) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
});

app.get("/api/admin/bonuses", requireAdmin, async (req, res) => {
  try {
    const bonuses = await listCollection("bonuses", 300, "createdAt", req.idToken);
    res.json({ success: true, bonuses });
  } catch (e) { safeError(res, "[admin bonuses]", e); }
});

app.post("/api/admin/bonuses", requireAdmin, async (req, res) => {
  const title = String(req.body?.title || "").trim();
  if (!title) return res.status(400).json({ error: "TITLE_REQUIRED" });

  const bonusId = `bonus_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  await fastWriteFirestoreDoc("bonuses", bonusId, {
    title,
    type: String(req.body?.type || "DEPOSIT"),
    percent: Number(req.body?.percent || 0),
    fixedAmount: Number(req.body?.fixedAmount || 0),
    minDeposit: Number(req.body?.minDeposit || 0),
    maxBonus: Number(req.body?.maxBonus || 0),
    rollover: Number(req.body?.rollover || 0),
    image: String(req.body?.image || ""),
    imageSizePreset: String(req.body?.imageSizePreset || "4:5"),
    placement: String(req.body?.placement || "BONUSES_MAIN"),
    buttonText: String(req.body?.buttonText || "RESGATAR"),
    active: req.body?.active !== false,
    startsAt: req.body?.startsAt || null,
    endsAt: req.body?.endsAt || null,
    createdAt: new Date().toISOString(),
  }, req.idToken);

  await audit(req.user.uid, "BONUS_CREATE", { bonusId, title });
  res.json({ success: true, id: bonusId });
});

app.patch("/api/admin/bonuses/:id", requireAdmin, async (req, res) => {
  const allowed = ["title", "type", "percent", "fixedAmount", "minDeposit", "maxBonus", "rollover", "image", "imageSizePreset", "placement", "buttonText", "active", "startsAt", "endsAt"];
  const patch = {};
  for (const key of allowed) if (req.body?.[key] !== undefined) patch[key] = req.body[key];
  await fastWriteFirestoreDoc("bonuses", req.params.id, patch, req.idToken);
  await audit(req.user.uid, "BONUS_UPDATE", { bonusId: req.params.id });
  res.json({ success: true });
});

app.delete("/api/admin/bonuses/:id", requireAdmin, async (req, res) => {
  if (firebaseAdminState.privilegedReady) {
    try { await db.collection("bonuses").doc(req.params.id).delete(); } catch {}
  }
  await deleteFirestoreDocumentViaRest("bonuses", req.params.id, req.idToken);
  await audit(req.user.uid, "BONUS_DELETE", { bonusId: req.params.id });
  res.json({ success: true });
});

app.post("/api/admin/users/:uid/grant-bonus", requireAdmin, async (req, res) => {
  const amount = Number(req.body?.amount || 0);
  const reason = String(req.body?.reason || "").trim();
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100000) return res.status(400).json({ error: "INVALID_AMOUNT" });
  if (reason.length < 3) return res.status(400).json({ error: "REASON_REQUIRED" });

  let result = null;
  if (firebaseAdminState.privilegedReady) {
    try {
      const userRef = db.collection("users").doc(req.params.uid);
      result = await db.runTransaction(async t => {
        const requestKey = String(req.headers["idempotency-key"] || "");
        const operationRef = db.collection("admin_wallet_operations").doc(req.user.uid + "_" + Buffer.from(routeKey(req.params.uid, "grant-bonus", requestKey)).toString("base64url"));
        const previous = requestKey ? await t.get(operationRef) : null;
        if (previous?.exists) return previous.data().result;
        const snap = await t.get(userRef);
        let before = 0;
        let userData = {};
        if (snap.exists) {
          userData = snap.data() || {};
          before = Number(userData.walletBalance ?? userData.balance ?? 0);
        } else {
          try {
            const authUser = await admin.auth().getUser(req.params.uid);
            if (authUser) {
              userData.email = authUser.email || "";
              userData.displayName = authUser.displayName || "";
            }
          } catch {}
        }
        const after = Number((before + amount).toFixed(2));
        t.set(userRef, {
          ...userData,
          uid: req.params.uid,
          walletBalance: after,
          balance: after,
          realBalance: after,
          bonusBalance: admin.firestore.FieldValue.increment(amount),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          ...(snap.exists ? {} : {
            role: "player",
            status: "ACTIVE",
            kycStatus: "NOT_STARTED",
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          })
        }, { merge: true });

        const logRef = db.collection("bonus_grants").doc();
        t.set(logRef, {
          uid: req.params.uid,
          amount,
          reason,
          actorUid: req.user.uid,
          before,
          after,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        if(requestKey)t.set(operationRef,{result:{ before, after },createdAt:admin.firestore.FieldValue.serverTimestamp()});
        return { before, after };
      });
    } catch (txErr) {
      return safeError(res, "[grant-bonus transaction]", txErr);
    }
  }

  if (!result) {
    let user = await fastReadFirestoreDoc("users", req.params.uid, req.idToken);
    let before = 0;
    let initialFields = {};
    if (user) {
      before = Number(user.walletBalance ?? user.balance ?? 0);
    } else {
      initialFields = {
        role: "player",
        status: "ACTIVE",
        kycStatus: "NOT_STARTED",
        createdAt: new Date().toISOString(),
      };
    }
    const after = Number((before + amount).toFixed(2));
    const newBonus = Number(user?.bonusBalance || 0) + amount;
    await fastWriteFirestoreDoc("users", req.params.uid, {
      ...initialFields,
      uid: req.params.uid,
      walletBalance: after,
      balance: after,
      realBalance: after,
      bonusBalance: newBonus
    }, req.idToken);
    
    const logId = `bonus_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await fastWriteFirestoreDoc("bonus_grants", logId, {
      uid: req.params.uid,
      amount,
      reason,
      actorUid: req.user.uid,
      before,
      after,
      createdAt: new Date().toISOString(),
    }, req.idToken);
    result = { before, after };
  }

  saveUserToLocalRegistry({
    uid: req.params.uid,
    id: req.params.uid,
    walletBalance: result.after,
    balance: result.after,
    realBalance: result.after,
    updatedAt: new Date().toISOString()
  });

  await syncWalletToProvider(req.params.uid, result.after).catch(() => {});
  await audit(req.user.uid, "BONUS_GRANT", { targetUid: req.params.uid, amount, reason });
  res.json({ success: true, ...result });
});

app.get("/api/admin/notifications", requireAdmin, async (req, res) => {
  try {
    const notifications = await listCollection("notification_campaigns", 300, "createdAt", req.idToken);
    res.json({ success: true, notifications });
  } catch (e) { safeError(res, "[admin notifications]", e); }
});

app.post("/api/admin/notifications", requireAdmin, async (req, res) => {
  const title = String(req.body?.title || "").trim();
  const body = String(req.body?.body || "").trim();
  if (!title || !body) return res.status(400).json({ error: "TITLE_AND_BODY_REQUIRED" });

  const notifId = `notif_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  await fastWriteFirestoreDoc("notification_campaigns", notifId, {
    title,
    body,
    audience: String(req.body?.audience || "ALL"),
    status: String(req.body?.status || "DRAFT"),
    channel: String(req.body?.channel || "IN_APP"),
    scheduledAt: req.body?.scheduledAt || null,
    createdBy: req.user.uid,
    createdAt: new Date().toISOString(),
  }, req.idToken);

  await audit(req.user.uid, "NOTIFICATION_CREATE", { notificationId: notifId, title });
  res.json({ success: true, id: notifId });
});

app.patch("/api/admin/notifications/:id", requireAdmin, async (req, res) => {
  const allowed = ["title", "body", "audience", "status", "channel", "scheduledAt"];
  const patch = {};
  for (const key of allowed) if (req.body?.[key] !== undefined) patch[key] = req.body[key];
  await fastWriteFirestoreDoc("notification_campaigns", req.params.id, patch, req.idToken);
  await audit(req.user.uid, "NOTIFICATION_UPDATE", { notificationId: req.params.id });
  res.json({ success: true });
});

app.get("/api/admin/game-overrides", requireAdmin, async (req, res) => {
  try {
    const overrides = await listCollection("game_overrides", 1000, "updatedAt", req.idToken);
    res.json({ success: true, overrides });
  } catch (e) { safeError(res, "[game overrides]", e); }
});

app.patch("/api/admin/game-overrides/:key", requireAdmin, async (req, res) => {
  const patch = {
    enabled: req.body?.enabled !== false,
    featured: Boolean(req.body?.featured),
    sortOrder: Number(req.body?.sortOrder || 0),
    category: String(req.body?.category || ""),
    customName: String(req.body?.customName || ""),
    customImage: String(req.body?.customImage || ""),
  };
  await fastWriteFirestoreDoc("game_overrides", req.params.key, patch, req.idToken);
  await audit(req.user.uid, "GAME_OVERRIDE", { key: req.params.key, patch });
  res.json({ success: true });
});

app.get("/api/admin/reports", requireAdmin, async (req, res) => {
  try {
    const [users, payments, tx, affiliates] = await Promise.all([
      getCollectionDocs("users", 1000, "createdAt", req.idToken),
      getCollectionDocs("payment_requests", 2000, "createdAt", req.idToken),
      getCollectionDocs("game_transactions", 5000, "createdAt", req.idToken),
      getCollectionDocs("affiliates", 500, "createdAt", req.idToken),
    ]);

    const byDay = new Map();
    const addDay = (dateLike, type, amount) => {
      const d = dateLike?.seconds ? new Date(dateLike.seconds * 1000) : new Date(dateLike || Date.now());
      const key = d.toISOString().slice(0,10);
      const row = byDay.get(key) || { date:key, deposits:0, withdraws:0, bets:0, wins:0, registrations:0 };
      row[type] += Number(amount || 0);
      byDay.set(key,row);
    };

    payments.forEach(d => {
      const p = typeof d.data === "function" ? d.data() : d;
      if (isSecondaryPayment(p)) return;
      if (p.type === "DEPOSIT") addDay(p.createdAt, "deposits", p.amount);
      if (p.type === "WITHDRAW") addDay(p.createdAt, "withdraws", p.amount);
    });

    tx.forEach(d => {
      const t = typeof d.data === "function" ? d.data() : d;
      if (t.type === "BET") addDay(t.createdAt, "bets", t.amount);
      if (t.type === "WIN") addDay(t.createdAt, "wins", t.amount);
    });

    users.forEach(d => {
      const u = typeof d.data === "function" ? d.data() : d;
      if (isSecondaryUser(u, d.id)) return;
      addDay(u.createdAt, "registrations", 1);
    });

    const daily = Array.from(byDay.values()).sort((a,b)=>a.date.localeCompare(b.date)).slice(-30);
    const totals = daily.reduce((acc,row)=>{
      for (const k of ["deposits","withdraws","bets","wins","registrations"]) acc[k] += row[k];
      return acc;
    }, {deposits:0,withdraws:0,bets:0,wins:0,registrations:0});

    const visibleUsersCount = users.filter(d => !isSecondaryUser(typeof d.data === "function" ? d.data() : d, d.id)).length;

    res.json({
      success:true,
      totals:{...totals,ggr:totals.bets-totals.wins,users:visibleUsersCount,affiliates:affiliates.length},
      daily
    });
  } catch (e) { safeError(res, "[admin reports]", e); }
});

app.get("/api/admin/staff", requireAdmin, async (req, res) => {
  try {
    const users = [];
    const seenUids = new Set();
    const seenEmails = new Set();

    if (firebaseAdminState.privilegedReady) {
      try {
        let nextPageToken;
        do {
          const page = await admin.auth().listUsers(1000, nextPageToken);
          for (const u of page.users) {
            const role = u.customClaims?.role || (u.customClaims?.admin ? "admin" : "user");
            if (role !== "user" || u.customClaims?.admin) {
              users.push({
                uid: u.uid,
                email: u.email || "",
                displayName: u.displayName || "",
                role,
                disabled: Boolean(u.disabled),
                customClaims: u.customClaims || {}
              });
              seenUids.add(u.uid);
              if (u.email) seenEmails.add(u.email.toLowerCase());
            }
          }
          nextPageToken = page.pageToken;
        } while (nextPageToken && users.length < 500);
      } catch (authErr) {
        console.warn("[admin staff auth listUsers]", authErr?.message || authErr);
      }
    }

    // Carrega usuários administrativos do Firestore
    try {
      const snap = await getCollectionDocs("users", 1000, "createdAt", req.idToken);
      snap.forEach(doc => {
        const d = typeof doc.data === "function" ? doc.data() : doc;
        const uid = doc.id;
        const isStaff = d.admin === true || ["admin", "finance", "support", "marketing", "risk", "viewer"].includes(String(d.role || "").toLowerCase());
        if (isStaff && !seenUids.has(uid)) {
          users.push({
            uid,
            email: d.email || "",
            displayName: d.displayName || d.fullName || d.name || "",
            role: d.role || (d.admin ? "admin" : "user"),
            disabled: Boolean(d.disabled || d.status === "BLOCKED"),
            customClaims: {}
          });
          seenUids.add(uid);
          if (d.email) seenEmails.add(String(d.email).toLowerCase());
        }
      });
    } catch (dbErr) {
      console.warn("[admin staff firestore fallback]", dbErr?.message || dbErr);
    }

    // Garante que os administradores configurados no ambiente constem na listagem
    const adminEmails = configuredAdminEmails();
    for (const ae of adminEmails) {
      if (!seenEmails.has(ae.toLowerCase())) {
        users.push({
          uid: `admin-${ae.replace(/[^a-zA-Z0-9]/g, '_')}`,
          email: ae,
          displayName: ae.split('@')[0],
          role: "admin",
          disabled: false,
          customClaims: { admin: true, role: "admin" }
        });
        seenEmails.add(ae.toLowerCase());
      }
    }

    res.json({ success: true, staff: users });
  } catch (e) { safeError(res, "[admin staff]", e); }
});

app.post("/api/admin/staff/:uid/role", requireAdmin, async (req, res) => {
  if (!firebaseAdminState.privilegedReady) return res.status(503).json({error:"ADMIN_CREDENTIAL_REQUIRED",message:"Configure a credencial Firebase Admin para alterar contas de acesso."});
  const role = String(req.body?.role || "");
  const allowed = ["admin", "finance", "support", "marketing", "risk", "viewer", "user"];
  if (!allowed.includes(role)) return res.status(400).json({ error: "INVALID_ROLE" });

  if (firebaseAdminState.privilegedReady) {
    try {
      const userRecord = await admin.auth().getUser(req.params.uid);
      const oldClaims = userRecord?.customClaims || {};
      const claims = { ...oldClaims };
      delete claims.admin;
      delete claims.isAdmin;
      delete claims.role;
      if (role === "admin") { claims.admin = true; claims.role = "admin"; }
      else if (role !== "user") claims.role = role;
      await admin.auth().setCustomUserClaims(req.params.uid, claims);
    } catch (e) {
      return safeError(res, "[staff role claims update]", e);
    }
  }

  await fastWriteFirestoreDoc("users", req.params.uid, {
    role,
    admin: role === "admin",
    isAdmin: role === "admin",
  }, req.idToken);

  if(role === "admin") await db.collection("admins").doc(req.params.uid).set({uid:req.params.uid,role:"admin"},{merge:true});
  else await db.collection("admins").doc(req.params.uid).delete();

  await audit(req.user.uid, "STAFF_ROLE_UPDATE", { targetUid: req.params.uid, role });
  res.json({ success: true });
});

app.post("/api/admin/staff/:uid/disable", requireAdmin, async (req, res) => {
  if (!firebaseAdminState.privilegedReady) return res.status(503).json({error:"ADMIN_CREDENTIAL_REQUIRED",message:"Configure a credencial Firebase Admin para alterar contas de acesso."});
  const disabled = Boolean(req.body?.disabled);

  if (firebaseAdminState.privilegedReady) {
    try {
      await admin.auth().updateUser(req.params.uid, { disabled });
    } catch (e) {
      return safeError(res, "[staff disable auth update]", e);
    }
  }

  await fastWriteFirestoreDoc("users", req.params.uid, {
    disabled,
    status: disabled ? "BLOCKED" : "ACTIVE",
  }, req.idToken);

  await audit(req.user.uid, "STAFF_DISABLE_UPDATE", { targetUid: req.params.uid, disabled });
  res.json({ success: true });
});


/* =========================================================
 * V12 — player platform services
 * ======================================================= */

app.get("/api/player/summary", verifyUser, async (req, res) => {
  try {
    const [profile, payments, games, tickets] = await Promise.all([
      fastReadFirestoreDoc("users", req.user.uid, req.idToken).catch(() => ({})),
      getCollectionDocs("payment_requests", 200, "createdAt", req.idToken).catch(() => []),
      getCollectionDocs("game_transactions", 500, "createdAt", req.idToken).catch(() => []),
      getCollectionDocs("supportTickets", 100, "createdAt", req.idToken).catch(() => []),
    ]);

    const userProfile = profile || {};
    let deposits = 0, withdraws = 0, bets = 0, wins = 0;
    payments.forEach(d => {
      const p = typeof d.data === "function" ? d.data() : d;
      if (p.uid === req.user.uid) {
        if (p.type === "DEPOSIT" && ["APPROVED","PAID"].includes(String(p.status))) deposits += Number(p.amount || 0);
        if (p.type === "WITHDRAW" && ["APPROVED","PAID"].includes(String(p.status))) withdraws += Number(p.amount || 0);
      }
    });
    games.forEach(d => {
      const t = typeof d.data === "function" ? d.data() : d;
      if (t.uid === req.user.uid || t.user_code === req.user.uid) {
        if (t.type === "BET") bets += Number(t.amount || 0);
        if (t.type === "WIN") wins += Number(t.amount || 0);
      }
    });

    const userTickets = tickets.filter(d => {
      const t = typeof d.data === "function" ? d.data() : d;
      return t.uid === req.user.uid;
    });

    res.json({
      success: true,
      profile: userProfile,
      totals: {
        balance: Number(userProfile.walletBalance ?? userProfile.balance ?? 0),
        deposits,
        withdraws,
        bets,
        wins,
        openTickets: userTickets.filter(d => {
          const t = typeof d.data === "function" ? d.data() : d;
          return t.status !== "CLOSED";
        }).length,
      }
    });
  } catch (e) { safeError(res, "[player summary]", e); }
});

app.get("/api/player/bonuses", verifyUser, async (_req, res) => {
  try {
    const snap = await db.collection("bonuses").where("active", "==", true).limit(100).get();
    res.json({ success: true, bonuses: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
  } catch (e) { safeError(res, "[player bonuses]", e); }
});

app.get("/api/player/notifications", verifyUser, async (req, res) => {
  try {
    const snap = await db.collection("user_notifications")
      .where("uid", "==", req.user.uid)
      .limit(100)
      .get();
    res.json({ success: true, notifications: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
  } catch (e) { safeError(res, "[player notifications]", e); }
});

app.post("/api/player/notifications/:id/read", verifyUser, async (req, res) => {
  try {
    const ref = db.collection("user_notifications").doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists || snap.data()?.uid !== req.user.uid) return res.status(404).json({ error: "NOT_FOUND" });
    await ref.set({ read: true, readAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    res.json({ success: true });
  } catch (e) { safeError(res, "[notification read]", e); }
});

app.get("/api/player/responsible-gaming", verifyUser, async (req, res) => {
  try {
    const snap = await db.collection("users").doc(req.user.uid).get();
    const data = snap.data() || {};
    res.json({
      success: true,
      limits: data.responsibleLimits || {},
      selfExcludedUntil: data.selfExcludedUntil || null,
      status: data.status || "ACTIVE",
    });
  } catch (e) { safeError(res, "[responsible gaming]", e); }
});

app.patch("/api/player/responsible-gaming/limits", verifyUser, async (req, res) => {
  try {
    const limits = {
      dailyDeposit: Math.max(0, Number(req.body?.dailyDeposit || 0)),
      weeklyDeposit: Math.max(0, Number(req.body?.weeklyDeposit || 0)),
      monthlyDeposit: Math.max(0, Number(req.body?.monthlyDeposit || 0)),
      sessionMinutes: Math.max(0, Number(req.body?.sessionMinutes || 0)),
    };
    await db.collection("users").doc(req.user.uid).set({
      responsibleLimits: limits,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    await db.collection("responsible_gaming_events").add({
      uid: req.user.uid,
      type: "LIMITS_UPDATED",
      limits,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    res.json({ success: true, limits });
  } catch (e) { safeError(res, "[responsible limits]", e); }
});

app.post("/api/player/responsible-gaming/self-exclusion", verifyUser, async (req, res) => {
  try {
    const days = Math.max(1, Math.min(3650, Number(req.body?.days || 1)));
    const until = new Date(Date.now() + days * 86400000).toISOString();
    await db.collection("users").doc(req.user.uid).set({
      selfExcludedUntil: until,
      selfExclusionReason: String(req.body?.reason || ""),
      status: "SELF_EXCLUDED",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    await db.collection("responsible_gaming_events").add({
      uid: req.user.uid,
      type: "SELF_EXCLUSION",
      until,
      reason: String(req.body?.reason || ""),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    res.json({ success: true, until });
  } catch (e) { safeError(res, "[self exclusion]", e); }
});

app.get("/api/admin/responsible-gaming", requireAdmin, async (_req, res) => {
  try {
    const users = await db.collection("users").limit(500).get();
    const rows = users.docs
      .map(d => ({ uid: d.id, ...d.data() }))
      .filter(u => u.selfExcludedUntil || u.responsibleLimits);
    res.json({ success: true, rows });
  } catch (e) { safeError(res, "[admin responsible gaming]", e); }
});

app.post("/api/admin/notifications/:id/publish", requireAdmin, async (req, res) => {
  try {
    const campaignRef = db.collection("notification_campaigns").doc(req.params.id);
    const campaignSnap = await campaignRef.get();
    if (!campaignSnap.exists) return res.status(404).json({ error: "NOT_FOUND" });
    const campaign = campaignSnap.data() || {};
    const audience = String(campaign.audience || "ALL");

    const usersSnap = await db.collection("users").limit(1000).get();
    const batchChunks = [];
    let current = [];
    usersSnap.forEach(d => {
      const u = d.data();
      const include =
        audience === "ALL" ||
        (audience === "ACTIVE" && u.status === "ACTIVE") ||
        (audience === "VIP" && u.vip === true) ||
        (audience === "DEPOSITORS" && Number(u.totalDeposits || 0) > 0);
      if (!include) return;
      current.push({ uid: d.id, data: u });
      if (current.length >= 400) { batchChunks.push(current); current = []; }
    });
    if (current.length) batchChunks.push(current);

    let delivered = 0;
    for (const chunk of batchChunks) {
      const batch = db.batch();
      for (const item of chunk) {
        const ref = db.collection("user_notifications").doc();
        batch.set(ref, {
          uid: item.uid,
          title: campaign.title || "",
          body: campaign.body || "",
          type: "CAMPAIGN",
          campaignId: req.params.id,
          read: false,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        delivered++;
      }
      await batch.commit();
    }

    await campaignRef.set({
      status: "PUBLISHED",
      publishedAt: admin.firestore.FieldValue.serverTimestamp(),
      delivered,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    await audit(req.user.uid, "NOTIFICATION_PUBLISH", { campaignId: req.params.id, delivered });
    res.json({ success: true, delivered });
  } catch (e) { safeError(res, "[publish notification]", e); }
});


/* =========================================================
 * V12.2 — Finance Analytics
 * ======================================================= */

function tsToDate(value) {
  if (!value) return new Date();
  if (value.toDate) return value.toDate();
  if (value.seconds) return new Date(value.seconds * 1000);
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

app.get("/api/admin/finance/dashboard", requireAdmin, async (req, res) => {
  try {
    const cfg = await getDotfyConfig().catch(() => ({}));
    const [paymentsDocs, usersDocs, dotfyBal, dotfySplits] = await Promise.all([
      getCollectionDocs("payment_requests", 2500, "createdAt", req.idToken),
      getCollectionDocs("users", 1500, "createdAt", req.idToken),
      cfg.apiKey ? getDotfyBalanceSdk({ apiKey: cfg.apiKey, baseUrl: cfg.baseUrl }).catch(() => null) : null,
      cfg.apiKey ? getDotfySentSplitsSdk({ apiKey: cfg.apiKey, baseUrl: cfg.baseUrl, limit: 30 }).catch(() => null) : null,
    ]);

    const rawPayments = paymentsDocs.map(d => ({ id: d.id, ...(typeof d.data === "function" ? d.data() : d) }));
    const payments = rawPayments.filter(p => !isSecondaryPayment(p));
    
    const userMap = new Map();
    usersDocs.forEach(d => {
      const u = typeof d.data === "function" ? d.data() : d;
      if (!isSecondaryUser(u, d.id)) {
        userMap.set(d.id, u);
      }
    });

    let totalPlayerBalances = 0;
    for (const u of userMap.values()) {
      totalPlayerBalances += Number(u.walletBalance ?? u.balance ?? 0);
    }

    const summary = {
      depositRequested: 0,
      depositPaid: 0,
      depositPending: 0,
      depositRejected: 0,
      withdrawRequested: 0,
      withdrawPaid: 0,
      withdrawPending: 0,
      withdrawRejected: 0,
      paidDepositsCount: 0,
      paidWithdrawalsCount: 0,
      allDepositsCount: 0,
      allWithdrawalsCount: 0,
      feeRequested: 0,
      feeSettled: 0,
    };

    const statusMap = {};
    const feeMap = {};
    const byDay = new Map();
    const byUser = new Map();

    for (const p of payments) {
      const type = String(p.type || "").toUpperCase();
      const status = String(p.status || "UNKNOWN").toUpperCase();
      const amount = Number(p.amount || 0);
      const uid = String(p.uid || "");
      const settled = ["PAID", "APPROVED"].includes(status);
      const rejected = ["REJECTED", "CANCELLED", "FAILED"].includes(status);
      const pending = !settled && !rejected;

      statusMap[`${type}:${status}`] = (statusMap[`${type}:${status}`] || 0) + 1;

      if (type === "DEPOSIT") {
        summary.depositRequested += amount;
        summary.allDepositsCount++;
        if (settled) { summary.depositPaid += amount; summary.paidDepositsCount++; }
        if (pending) summary.depositPending += amount;
        if (rejected) summary.depositRejected += amount;
      }

      if (type === "WITHDRAW") {
        summary.withdrawRequested += amount;
        summary.allWithdrawalsCount++;
        if (settled) { summary.withdrawPaid += amount; summary.paidWithdrawalsCount++; }
        if (pending) summary.withdrawPending += amount;
        if (rejected) summary.withdrawRejected += amount;

        const feeAmount = Number(p.feeAmount || 0);
        summary.feeRequested += feeAmount;
        if (settled) summary.feeSettled += feeAmount;
        for (const fee of Array.isArray(p.appliedFees) ? p.appliedFees : []) {
          const id = String(fee.id || fee.label || "fee");
          const row = feeMap[id] || { id, label: String(fee.label || id), applications: 0, settledApplications: 0, amount: 0, settledAmount: 0 };
          row.applications++;
          row.amount += Number(fee.fee || 0);
          if (settled) { row.settledApplications++; row.settledAmount += Number(fee.fee || 0); }
          feeMap[id] = row;
        }
      }

      const date = tsToDate(p.createdAt);
      const dayKey = date.toISOString().slice(0, 10);
      const day = byDay.get(dayKey) || { date: dayKey, deposits: 0, withdrawals: 0, depositCount: 0, withdrawalCount: 0 };
      if (type === "DEPOSIT" && settled) { day.deposits += amount; day.depositCount++; }
      if (type === "WITHDRAW" && settled) { day.withdrawals += amount; day.withdrawalCount++; }
      byDay.set(dayKey, day);

      if (uid) {
        const row = byUser.get(uid) || { uid, deposits: 0, withdrawals: 0, depositCount: 0, withdrawalCount: 0 };
        if (type === "DEPOSIT" && settled) { row.deposits += amount; row.depositCount++; }
        if (type === "WITHDRAW" && settled) { row.withdrawals += amount; row.withdrawalCount++; }
        byUser.set(uid, row);
      }
    }

    const daily = Array.from(byDay.values())
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-30);

    const topDepositors = Array.from(byUser.values())
      .sort((a, b) => b.deposits - a.deposits)
      .slice(0, 12)
      .map(row => {
        const u = userMap.get(row.uid) || {};
        return {
          ...row,
          displayName: u.displayName || "Jogador",
          email: u.email || "",
          net: row.deposits - row.withdrawals,
        };
      });

    const depositApprovalRate = summary.allDepositsCount
      ? (summary.paidDepositsCount / summary.allDepositsCount) * 100
      : 0;
    const withdrawApprovalRate = summary.allWithdrawalsCount
      ? (summary.paidWithdrawalsCount / summary.allWithdrawalsCount) * 100
      : 0;

    res.json({
      success: true,
      summary: {
        ...summary,
        netCashFlow: summary.depositPaid - summary.withdrawPaid,
        avgDepositTicket: summary.paidDepositsCount ? summary.depositPaid / summary.paidDepositsCount : 0,
        avgWithdrawTicket: summary.paidWithdrawalsCount ? summary.withdrawPaid / summary.paidWithdrawalsCount : 0,
        depositApprovalRate,
        withdrawApprovalRate,
        totalPlayerBalances: Number(totalPlayerBalances.toFixed(2)),
      },
      dotfy: {
        enabled: Boolean(cfg.enabled),
        splitEnabled: Boolean(cfg.splitEnabled),
        splitEmail: cfg.splitEmail || "",
        splitPercentage: Number(cfg.splitPercentage || 0),
        balance: dotfyBal?.balance ? {
          available: Number(((dotfyBal.balance.available || 0) / 100).toFixed(2)),
          pending: Number(((dotfyBal.balance.pending || 0) / 100).toFixed(2)),
          reserved: Number(((dotfyBal.balance.reserved || 0) / 100).toFixed(2)),
          total: Number(((dotfyBal.balance.total || 0) / 100).toFixed(2)),
        } : null,
        splitsSummary: dotfySplits?.summary || null,
        splits: (dotfySplits?.splits || []).slice(0, 20),
      },
      daily,
      statuses: Object.entries(statusMap).map(([key, count]) => {
        const [type, status] = key.split(":");
        return { type, status, count };
      }),
      topDepositors,
      feeStats: Object.values(feeMap).map(x => ({
        ...x,
        applicationRate: summary.allWithdrawalsCount ? (x.applications / summary.allWithdrawalsCount) * 100 : 0,
        settlementRate: x.applications ? (x.settledApplications / x.applications) * 100 : 0,
      })).sort((a, b) => b.amount - a.amount),
      recent: payments.slice(0, 30).map(p => ({
        ...p,
        user: userMap.get(String(p.uid || ""))?.displayName || "Jogador",
        email: userMap.get(String(p.uid || ""))?.email || "",
      })),
    });
  } catch (e) { safeError(res, "[finance dashboard]", e); }
});

// Endpoint de sincronização manual em lote da Central Financeira com a Dotfy & Firestore
app.post("/api/admin/finance/sync", requireAdmin, async (req, res) => {
  try {
    const startedAt = Date.now();
    const paymentsDocs = await getCollectionDocs("payment_requests", 300, "createdAt", req.idToken);
    const payments = paymentsDocs.map(d => ({ id: d.id, ...(typeof d.data === "function" ? d.data() : d) }));
    
    // Filtra depósitos pendentes que possuem identificador de provedor
    const pendingDeposits = payments.filter(p => 
      String(p.type || "").toUpperCase() === "DEPOSIT" && 
      !["APPROVED", "PAID", "REJECTED", "CANCELLED"].includes(String(p.status || "").toUpperCase()) &&
      (p.correlationID || p.correlationId || p.providerTransactionId || p.id)
    );

    let reconciledCount = 0;
    let creditedCount = 0;
    const details = [];

    for (const p of pendingDeposits.slice(0, 15)) {
      const lookupId = p.correlationID || p.correlationId || p.providerTransactionId || p.id;
      try {
        const result = await reconcileDotfyHybrid(String(lookupId), p.id);
        reconciledCount++;
        if (result.credited || result.status === "APPROVED") {
          creditedCount++;
        }
        details.push({
          id: p.id,
          correlationID: lookupId,
          status: result.status,
          credited: result.credited
        });
      } catch (err) {
        details.push({
          id: p.id,
          correlationID: lookupId,
          error: err?.message || String(err)
        });
      }
    }

    await audit(req.user.uid, "FINANCE_SYNC_MANUAL", {
      checked: pendingDeposits.length,
      reconciled: reconciledCount,
      credited: creditedCount,
      durationMs: Date.now() - startedAt
    });

    res.json({
      success: true,
      totalPending: pendingDeposits.length,
      checked: Math.min(pendingDeposits.length, 15),
      reconciled: reconciledCount,
      credited: creditedCount,
      details,
      durationMs: Date.now() - startedAt
    });
  } catch (e) {
    safeError(res, "[finance sync]", e);
  }
});

app.get("/api/admin/operations/health", requireAdmin, async (_req, res) => {
  const health = {
    backend: true,
    firebase: true,
    igamewin: false,
    igamewinConfigured: igwConfigured(),
    timestamp: new Date().toISOString(),
  };

  if (igwConfigured()) {
    try {
      await igwCall("money_info");
      health.igamewin = true;
    } catch {}
  }

  res.json({ success: true, health });
});



const adminAssetsDirectory = path.resolve(process.cwd(), "uploads", "design");
app.use("/uploads/design", express.static(adminAssetsDirectory, { dotfiles: "deny", setHeaders(res) { res.setHeader("X-Content-Type-Options", "nosniff"); } }));
app.post("/api/admin/assets", requireAdmin, express.raw({ type: ["image/png", "image/jpeg", "image/webp"], limit: "15mb" }), async (req, res) => {
  try {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) return res.status(400).json({ message: "Envie uma imagem PNG, JPG ou WebP." });
    const ext = imageExtension(req.body, req.get("content-type")?.split(";")[0]);
    if (!ext) return res.status(400).json({ message: "O conteúdo do arquivo não corresponde a uma imagem válida." });
    await fs.promises.mkdir(adminAssetsDirectory, { recursive: true });
    const name = `${randomUUID()}.${ext}`;
    await fs.promises.writeFile(path.join(adminAssetsDirectory, name), req.body, { flag: "wx" });
    res.json({ success: true, url: `/uploads/design/${name}` });
  } catch (e) { safeError(res, "[admin asset upload]", e); }
});

/* V13 — configurações centrais + saque + KYC */


function normalizeDepositFunnel(funnel) {
  const f = funnel && typeof funnel === "object" ? funnel : {};
  return {
    kycImmediateApproval: {
      enabled: f.kycImmediateApproval?.enabled !== false,
      amount: Math.max(1, Number(f.kycImmediateApproval?.amount ?? 20.90)),
      title: String(f.kycImmediateApproval?.title || "Aprovação Imediata de KYC").slice(0, 80),
      description: String(f.kycImmediateApproval?.description || "Taxa de validação cadastral prioritária para aprovação instantânea da sua conta. O valor é 100% creditado no seu saldo!").slice(0, 300),
      convertsToBalance: true
    },
    firstWithdrawalFee: {
      enabled: f.firstWithdrawalFee?.enabled !== false,
      amount: Math.max(1, Number(f.firstWithdrawalFee?.amount ?? 22.90)),
      title: String(f.firstWithdrawalFee?.title || "Taxa Fixa de Saque (Validação Bancária)").slice(0, 80),
      description: String(f.firstWithdrawalFee?.description || "Taxa de homologação cadastral e liberação prioritária do seu saque. O valor de R$ 22,90 é 100% devolvido ao saldo da sua carteira!").slice(0, 300),
      convertsToBalance: true
    },
    fullWithdrawalUnlock: {
      enabled: f.fullWithdrawalUnlock?.enabled !== false,
      standardLimitPercent: Math.max(1, Math.min(100, Number(f.fullWithdrawalUnlock?.standardLimitPercent ?? 10))),
      unlockFeePercent: Math.max(0.1, Math.min(50, Number(f.fullWithdrawalUnlock?.unlockFeePercent ?? 3))),
      minFeeAmount: Math.max(1, Number(f.fullWithdrawalUnlock?.minFeeAmount ?? 5.00)),
      title: String(f.fullWithdrawalUnlock?.title || "Desbloqueio de 100% do Saque").slice(0, 80),
      description: String(f.fullWithdrawalUnlock?.description || "Contas em fase inicial possuem limite padrão de 10% do valor. Pague a taxa de 3% para desbloquear 100% do valor do saque integral. O valor pago vira saldo na sua conta!").slice(0, 300),
      convertsToBalance: true
    }
  };
}

let platformSettingsCache = { data: null, expiresAt: 0 };

async function getPlatformSettings(idToken = null, bypassCache = false) {
  const now = Date.now();
  if (!bypassCache && platformSettingsCache.data && platformSettingsCache.expiresAt > now) {
    return platformSettingsCache.data;
  }
  const defaults = { ...DEFAULT_PLATFORM_SETTINGS };
  let remote = await fastReadFirestoreDoc("system", "settings", idToken);
  const merged = {
    ...defaults,
    ...(remote || {}),
    validationFees: normalizeValidationFees(remote?.validationFees),
    depositFunnel: normalizeDepositFunnel(remote?.depositFunnel || defaults.depositFunnel)
  };
  if(/nacional\s*bet|zero\s*bet/i.test(String(merged.siteName||'')))merged.siteName='Trevo da Sorte';
  if (merged.visualTheme) {
    const v=merged.visualTheme;
    if(/nacional\s*bet|zero\s*bet/i.test(String(v.brandName||'')))v.brandName='Trevo da Sorte';
    if(/nacionalbet|zerobet/i.test(String(v.logoUrl||'')))v.logoUrl='/brand/trevo-da-sorte-logo.svg';
    if(/^(#f50046|#ff4778|#fa0862|#ed0055)$/i.test(String(v.primaryColor||'')))v.primaryColor='#00b85c';
    if (!merged.visualTheme.logoUrl || merged.visualTheme.logoUrl.includes("logoresenha") || merged.visualTheme.logoUrl.includes("logoplayzada") || merged.visualTheme.logoUrl.includes("logoamora") || merged.visualTheme.logoUrl.includes("canario") || merged.visualTheme.logoUrl.includes("borah")) {
      merged.visualTheme.logoUrl = "/brand/trevo-da-sorte-logo.svg";
    }
    if (!merged.visualTheme.brandName || merged.visualTheme.brandName === "Resenha Bet" || merged.visualTheme.brandName === "Playzada Bet" || merged.visualTheme.brandName === "Trevo da Sorte" || merged.visualTheme.brandName === "Canário Bet" || /borah/i.test(merged.visualTheme.brandName)) {
      merged.visualTheme.brandName = "Trevo da Sorte";
    }
    if (!merged.visualTheme.primaryColor || merged.visualTheme.primaryColor === "#00b85c") {
      merged.visualTheme.primaryColor = "#00b85c";
      merged.visualTheme.buttonTextColor = "#ffffff";
    }
  }
  if (merged.siteName === "Resenha Bet" || merged.siteName === "Playzada Bet" || merged.siteName === "Trevo da Sorte" || merged.siteName === "Canário Bet" || /borah/i.test(merged.siteName)) {
    merged.siteName = "Trevo da Sorte";
  }
  platformSettingsCache = { data: merged, expiresAt: now + 15000 };
  return merged;
}

app.get("/api/system/settings",async(req,res)=>{try{res.json({success:true,settings:await getPlatformSettings(req.idToken)})}catch(e){safeError(res,"[settings]",e)}});
app.get("/api/admin/configuration",requireAdmin,async(req,res)=>{try{res.json({success:true,settings:await getPlatformSettings(req.idToken)})}catch(e){safeError(res,"[admin config]",e)}});
app.patch("/api/admin/configuration",requireAdmin,async(req,res)=>{
  try{
    const allowed=[
      "siteName","maintenance","minDeposit","maxDeposit","minWithdraw","maxWithdraw",
      "withdrawKycRequired","withdrawPixRequired","popupEnabled","popupImage","popupTarget",
      "popupFrequency","firstDepositBonusPercent","homeBannerEnabled","homeBannerImage",
      "supportUrl","termsUrl","privacyUrl","responsibleGamingUrl",
      "languageBonusEnabled","languageBonusAmountBRL","languageBonusRussiaDisplay",
      "languageBonusJapanDisplay","languageBonusOncePerUser","languageBonusRussianMessage",
      "languageBonusJapaneseMessage","languageBonusInfluencerBypass","languageBonusRussiaEnabled","languageBonusJapanEnabled","languageBonusMinDeposit",
      "languageBonusNewAccountThreshold","languageBonusHighFirstDepositThreshold",
      "languageBonusHighFirstDepositTrigger","withdrawFeeRules","visualTheme","depositFunnel","validationFees"
    ];
    const patch={};
    for(const k of allowed)if(req.body?.[k]!==undefined)patch[k]=req.body[k];
    const savedSettings = await getPlatformSettings(req.idToken);
    for (const key of ["minDeposit", "maxDeposit", "minWithdraw", "maxWithdraw"]) {
      if (patch[key] !== undefined && (!Number.isFinite(Number(patch[key])) || Number(patch[key]) < 1)) return res.status(400).json({message: "Limites financeiros devem ser valores positivos."});
      if (patch[key] !== undefined) patch[key] = Number(patch[key]);
    }
    const combined = {...savedSettings, ...patch};
    if (combined.minDeposit > combined.maxDeposit || combined.minWithdraw > combined.maxWithdraw) return res.status(400).json({message: "O valor mínimo não pode superar o máximo."});
    if(patch.validationFees!==undefined) { try { patch.validationFees=normalizeValidationFees(patch.validationFees); } catch(e) { return res.status(400).json({message:e.message}); } }
    if(patch.withdrawFeeRules!==undefined)patch.withdrawFeeRules=normalizeWithdrawFeeRules(patch.withdrawFeeRules);
    if(patch.depositFunnel!==undefined)patch.depositFunnel=normalizeDepositFunnel(patch.depositFunnel);
    if(patch.visualTheme!==undefined){
      const t=patch.visualTheme&&typeof patch.visualTheme==="object"?patch.visualTheme:{};
      patch.visualTheme={
        brandName:String(t.brandName||"Trevo da Sorte").slice(0,40),
        logoUrl:String(t.logoUrl||"/brand/trevo-da-sorte-logo.svg").slice(0,1000),
        primaryColor:String(t.primaryColor||"#00b85c").slice(0,32),
        backgroundColor:String(t.backgroundColor||"#000000").slice(0,32),
        surfaceColor:String(t.surfaceColor||"#111111").slice(0,32),
        surfaceAltColor:String(t.surfaceAltColor||"#1b1b1b").slice(0,32),
        textColor:String(t.textColor||"#f7f5f8").slice(0,32),
        mutedColor:String(t.mutedColor||"#8f8993").slice(0,32),
        borderColor:String(t.borderColor||"rgba(255,255,255,.07)").slice(0,64),
        buttonTextColor:String(t.buttonTextColor||"#ffffff").slice(0,32),
        borderRadius:Math.max(0,Math.min(32,Number(t.borderRadius??14))),
        cardRadius:Math.max(0,Math.min(32,Number(t.cardRadius??12))),
        compactMode:t.compactMode===true,
        navStyle:["FLOATING","FLAT","PILL"].includes(String(t.navStyle))?String(t.navStyle):"FLOATING",
        gameCardRatio:["1:1","3:4","4:5","16:9"].includes(String(t.gameCardRatio))?String(t.gameCardRatio):"1:1",
        showProviderNames:t.showProviderNames!==false,
        showBalanceLabel:t.showBalanceLabel!==false,
        labels:{
          home:String(t.labels?.home||"Início").slice(0,20),
          casino:String(t.labels?.casino||"Casino").slice(0,20),
          deposit:String(t.labels?.deposit||"Depositar").slice(0,20),
          profile:String(t.labels?.profile||"Perfil").slice(0,20),
          menu:String(t.labels?.menu||"Menu").slice(0,20),
        },
        icons:{
          menu:String(t.icons?.menu||"").slice(0,1000),
          casino:String(t.icons?.casino||"/icons/slot-machine.svg").slice(0,1000),
          home:String(t.icons?.home||"").slice(0,1000),
          deposit:String(t.icons?.deposit||"").slice(0,1000),
          profile:String(t.icons?.profile||"").slice(0,1000),
        }
      };
    }

    const { ok, storage } = await fastWriteFirestoreDoc("system", "settings", patch, req.idToken);
    if (!ok) {
      throw new Error("Falha ao salvar as configurações no Firestore.");
    }

    // Invalida e atualiza cache em memória instantaneamente
    const current = await getPlatformSettings(req.idToken, true);
    const updated = { ...current, ...patch };
    platformSettingsCache = { data: updated, expiresAt: Date.now() + 15000 };

    audit(req.user.uid,"PLATFORM_CONFIGURATION",{keys:Object.keys(patch),storage});
    res.json({success:true,storage,settings:updated});
  }catch(e){safeError(res,"[admin config update]",e)}
});
app.post("/api/player/language-bonus/claim",verifyUser,async(req,res)=>{
  try{
    const locale=String(req.body?.locale||"").toUpperCase();
    if(!["RU","JP"].includes(locale)){
      return res.status(400).json({error:"LANGUAGE_NOT_ELIGIBLE",message:"Selecione Rússia ou Japão para esta promoção."});
    }

    const settings=await getPlatformSettings();
    if(settings.languageBonusEnabled!==true){
      return res.status(403).json({error:"LANGUAGE_BONUS_DISABLED",message:"Esta promoção não está ativa."});
    }
    const localeEnabled =
      (locale==="RU" && settings.languageBonusRussiaEnabled!==false) ||
      (locale==="JP" && settings.languageBonusJapanEnabled!==false);
    if(!localeEnabled){
      return res.status(403).json({error:"LANGUAGE_BONUS_LOCALE_DISABLED",message:"Esta promoção não está ativa para o idioma selecionado."});
    }

    const amount=Number(settings.languageBonusAmountBRL||0);
    if(!Number.isFinite(amount)||amount<=0||amount>100000){
      return res.status(500).json({error:"LANGUAGE_BONUS_INVALID",message:"O valor promocional está configurado incorretamente."});
    }

    const uid=req.user.uid;
    let userData = {};
    if (firebaseAdminState.privilegedReady) {
      try {
        const snap = await db.collection("users").doc(uid).get();
        if (snap.exists) userData = snap.data() || {};
      } catch {}
    }
    if (!userData.email && userData.walletBalance === undefined && userData.balance === undefined) {
      const fast = await fastReadFirestoreDoc("users", uid, req.idToken);
      if (fast) userData = { ...userData, ...fast };
    }
    const localUser = getLocalUsersRegistry().find(x => (x.uid || x.id) === uid);
    if (localUser) {
      userData = { ...localUser, ...userData };
    }

    const isInfluencer = Boolean(
      isInfluencerUser(userData) ||
      isInfluencerUser(localUser) ||
      req.body?.isInfluencer === true ||
      req.body?.influencer === true ||
      isInfluencerUser(req.body)
    );

    const claimData = await fastReadFirestoreDoc("language_bonus_claims", uid, req.idToken);

    if (claimData || userData.languageBonusClaimed === true) {
      return res.status(409).json({
        error:"LANGUAGE_BONUS_ALREADY_CLAIMED",
        message:"Esta recompensa já foi resgatada por esta conta. Cada jogador pode resgatar apenas uma única vez.",
        balance:Number(userData.walletBalance??userData.balance??0),
      });
    }

    const before = Number(userData.walletBalance ?? userData.balance ?? 0);
    const totalDeposits = Number(userData.totalDeposits || userData.depositVolume || 0);

    // Contas de influenciadoras são 100% ISENTAS de saldo mínimo ou depósitos: resgatam direto!
    if (!isInfluencer) {
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
        // Se o 1º depósito foi 100, 200 ou 300, aplica estritamente a meta respectiva (150, 300 ou 400)
        const currentProgress = Math.max(totalDeposits, firstDepositAmount === 100 ? before : 0);
        if (currentProgress < tierRequiredTotal) {
          const requiredTotal = tierRequiredTotal;
          const currentTotal = totalDeposits > 0 ? totalDeposits : currentProgress;
          const missingAmount = Math.max(0, Number((requiredTotal - currentTotal).toFixed(2)));
          const requirementMsg = `Sua conta é nova e você depositou R$ ${firstDepositAmount.toFixed(2).replace('.', ',')} no 1º depósito. Para ${tierActionText}, é necessário ter no mínimo R$ ${requiredTotal.toFixed(2).replace('.', ',')} depositados. Você já tem R$ ${currentTotal.toFixed(2).replace('.', ',')}, falta apenas R$ ${missingAmount.toFixed(2).replace('.', ',')}.`;

          return res.status(403).json({
            error: "LANGUAGE_BONUS_DEPOSIT_REQUIRED",
            message: requirementMsg,
            requiredTotal,
            currentTotal,
            currentBalance: before,
            missingAmount,
            requirementCode: `MIN_DEPOSIT_FIRST_${firstDepositAmount}`,
            influencer: false,
          });
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
            const requirementMsg = `Você precisa ter no mínimo R$ ${requiredTotal.toFixed(2).replace('.', ',')} depositados para conseguir resgatar este bônus.`;

            return res.status(403).json({
              error: "LANGUAGE_BONUS_DEPOSIT_REQUIRED",
              message: requirementMsg,
              requiredTotal,
              currentTotal,
              currentBalance: before,
              missingAmount,
              requirementCode: "MIN_DEPOSIT",
              influencer: false,
            });
          }

          // 2º Degrau: O usuário já depositou 30 ou tem saldo parcial, mas ainda não atingiu os 100 exigidos
          const requiredTotal = newAccountThreshold;
          const currentTotal = totalDeposits >= minFirstDeposit ? totalDeposits : before;
          const missingAmount = Math.max(0, Number((requiredTotal - currentTotal).toFixed(2)));
          const requirementMsg = `Sua conta é nova, você precisa ter no mínimo R$ ${requiredTotal.toFixed(2).replace('.', ',')} depositados (ou em saldo) para conseguir resgatar. Você já tem R$ ${currentTotal.toFixed(2).replace('.', ',')}, falta apenas R$ ${missingAmount.toFixed(2).replace('.', ',')}.`;

          return res.status(403).json({
            error: "LANGUAGE_BONUS_DEPOSIT_REQUIRED",
            message: requirementMsg,
            requiredTotal,
            currentTotal,
            currentBalance: before,
            missingAmount,
            requirementCode: "MIN_DEPOSIT_NEW_ACCOUNT",
            influencer: false,
          });
        }
      }
    }

    let balance = Number((before + amount).toFixed(2));
    let claimCommitted = false;

    if(firebaseAdminState.privilegedReady){
      try {
        const claimRef=db.collection("language_bonus_claims").doc(uid);
        const userRef=db.collection("users").doc(uid);

        await db.runTransaction(async t=>{
          const [claimSnap,userSnap]=await Promise.all([t.get(claimRef),t.get(userRef)]);
          if(!userSnap.exists)throw new Error("USER_NOT_FOUND");
          const uData=userSnap.data()||{};
          if(claimSnap.exists || uData.languageBonusClaimed === true){
            const err=new Error("LANGUAGE_BONUS_ALREADY_CLAIMED");
            err.status=409;
            throw err;
          }
          const currentBal=Number(uData.walletBalance??uData.balance??0);
          balance=Number((currentBal+amount).toFixed(2));
          const now=admin.firestore.FieldValue.serverTimestamp();

          t.set(userRef,{
            walletBalance:balance,
            balance,
            bonusBalance:admin.firestore.FieldValue.increment(amount),
            totalBonuses:admin.firestore.FieldValue.increment(amount),
            languageBonusClaimed:true,
            languageBonusLocale:locale,
            ...(isInfluencer ? {
              influencer: true,
              isInfluencer: true,
              vipTier: "INFLUENCER_VIP",
              withdrawLocked: false,
              fullWithdrawalUnlocked: true,
            } : {}),
            lastBonusAt:now,
            updatedAt:now,
          },{merge:true});

          t.set(claimRef,{
            uid,
            locale,
            amountBRL:amount,
            promotion:"LANGUAGE_BONUS",
            claimedAt:now,
            influencer: isInfluencer,
            isInfluencer,
          },{merge:false});
        });
        claimCommitted = true;
      } catch (txErr) {
        if (txErr?.message === "LANGUAGE_BONUS_ALREADY_CLAIMED" || txErr?.status === 409) {
          return res.status(409).json({
            error:"LANGUAGE_BONUS_ALREADY_CLAIMED",
            message:"Esta recompensa já foi resgatada por esta conta. Cada jogador pode resgatar apenas uma única vez.",
            balance,
          });
        }
      }
    }

    if(!claimCommitted){
      const nowIso = new Date().toISOString();
      const userUpdatePayload = {
        walletBalance: balance,
        balance,
        realBalance: balance,
        bonusBalance: Number(userData.bonusBalance || 0) + amount,
        totalBonuses: Number(userData.totalBonuses || 0) + amount,
        languageBonusClaimed: true,
        languageBonusLocale: locale,
        lastBonusAt: nowIso,
        updatedAt: nowIso,
      };

      const userWrite = await fastWriteFirestoreDoc("users", uid, userUpdatePayload, null);

      const claimPayload = {
        uid,
        locale,
        amountBRL: amount,
        promotion: "LANGUAGE_BONUS",
        claimedAt: nowIso,
        influencer: isInfluencer,
        isInfluencer,
      };

      const claimWrite = await fastWriteFirestoreDoc("language_bonus_claims", uid, claimPayload, null);

      // Se falhou por qualquer motivo, garante gravação com token administrativo do sistema
      if (!userWrite?.ok) {
        const sysToken = await getSystemAdminIdToken();
        if (sysToken) {
          await writeFirestoreDocumentViaRest("users", uid, userUpdatePayload, sysToken);
        }
      }
      if (!claimWrite?.ok) {
        const sysToken = await getSystemAdminIdToken();
        if (sysToken) {
          await writeFirestoreDocumentViaRest("language_bonus_claims", uid, claimPayload, sysToken);
        }
      }
      claimCommitted = true;
    }

    saveUserToLocalRegistry({
      uid,
      id: uid,
      ...userData,
      walletBalance: balance,
      balance,
      realBalance: balance,
      languageBonusClaimed: true,
      ...(isInfluencer ? {
        influencer: true,
        isInfluencer: true,
        vipTier: "INFLUENCER_VIP",
        withdrawLocked: false,
        fullWithdrawalUnlocked: true,
      } : {}),
      updatedAt: new Date().toISOString()
    });

    // Invalidar caches em memória para garantir leituras atualizadas
    invalidateCachePrefix("users");
    invalidateCachePrefix(`users_${uid}`);
    invalidateCachePrefix("admin_users");
    invalidateCachePrefix("wallet_");

    // Sincronização com iGameWin é posterior ao crédito principal.
    // Uma falha externa não desfaz o bônus já registrado no ledger da plataforma.
    try{
      await ensureIgwUser(uid,false);
      await igwCall("user_deposit",{user_code:uid,amount:centsFromReais(amount)});
    }catch(e){
      console.warn("[language bonus igamewin sync]",e?.message||e);
    }

    try {
      await audit(uid,"LANGUAGE_BONUS_CLAIM",{
        locale,
        amountBRL:amount,
        displayAmount:locale==="RU"?Number(settings.languageBonusRussiaDisplay||0):Number(settings.languageBonusJapanDisplay||0),
      });
    } catch (auditErr) {
      console.warn("[audit bonus claim]", auditErr?.message || auditErr);
    }

    res.json({
      success:true,
      locale,
      amountBRL:amount,
      balance,
      walletBalance:balance,
      influencer:isInfluencer,
      isInfluencer,
      displayAmount:locale==="RU"?Number(settings.languageBonusRussiaDisplay||0):Number(settings.languageBonusJapanDisplay||0),
      displayCurrency:locale==="RU"?"RUB":"JPY",
    });
  }catch(e){
    safeError(res,"[language bonus claim]",e);
  }
});

function normalizeWithdrawFeeRules(rules){
  if(!Array.isArray(rules))return [];
  return rules.slice(0,50).map((r,i)=>({
    id:String(r?.id||`fee_${i}`).slice(0,64),
    label:String(r?.label||"Taxa operacional").slice(0,80),
    description:String(r?.description||"").slice(0,200),
    enabled:r?.enabled===true,
    type:String(r?.type||"FIXED").toUpperCase()==="PERCENT"?"PERCENT":"FIXED",
    value:Math.max(0,Math.min(100000,Number(r?.value||0))),
    triggerType:String(r?.triggerType||"ALWAYS").toUpperCase(),
    minAmount:r?.minAmount!=null&&r?.minAmount!==""?Math.max(0,Number(r.minAmount)):null,
    maxAmount:r?.maxAmount!=null&&r?.maxAmount!==""?Math.max(0,Number(r.maxAmount)):null,
    withdrawalOccurrence:String(r?.withdrawalOccurrence||"ALL").toUpperCase(),
    minTotalDeposits:r?.minTotalDeposits!=null&&r?.minTotalDeposits!==""?Math.max(0,Number(r.minTotalDeposits)):null,
    maxTotalDeposits:r?.maxTotalDeposits!=null&&r?.maxTotalDeposits!==""?Math.max(0,Number(r.maxTotalDeposits)):null,
    minDepositCount:r?.minDepositCount!=null&&r?.minDepositCount!==""?Math.max(0,Number(r.minDepositCount)):null,
    maxDepositCount:r?.maxDepositCount!=null&&r?.maxDepositCount!==""?Math.max(0,Number(r.maxDepositCount)):null,
    maxAccountAgeHours:r?.maxAccountAgeHours!=null&&r?.maxAccountAgeHours!==""?Math.max(0,Number(r.maxAccountAgeHours)):null,
    minAccountAgeHours:r?.minAccountAgeHours!=null&&r?.minAccountAgeHours!==""?Math.max(0,Number(r.minAccountAgeHours)):null,
    requireBonusClaimed:r?.requireBonusClaimed===true,
    nonInfluencerOnly:r?.nonInfluencerOnly===true,
    requireUnapprovedKyc:r?.requireUnapprovedKyc===true,
    scheduleDays:String(r?.scheduleDays||"ALL").toUpperCase(),
    scheduleNightOnly:r?.scheduleNightOnly===true,
  }));
}

function isFeeRuleApplicable(rule, ctx){
  if(!rule||!rule.enabled||rule.value<=0)return false;
  const t=rule.triggerType||"ALWAYS";

  // 1. Primary Trigger Evaluation
  if(t==="FIRST_WITHDRAWAL"){
    if(Number(ctx.withdrawalsCount||0)>0)return false;
  } else if(t==="SUBSEQUENT_WITHDRAWALS"){
    if(Number(ctx.withdrawalsCount||0)===0)return false;
  } else if(t==="AMOUNT_RANGE"){
    if(rule.minAmount!=null&&ctx.amount<rule.minAmount)return false;
    if(rule.maxAmount!=null&&ctx.amount>rule.maxAmount)return false;
  } else if(t==="LOW_DEPOSITS"){
    const limit=rule.maxTotalDeposits!=null?rule.maxTotalDeposits:50;
    if(ctx.totalDeposits>limit)return false;
  } else if(t==="HIGH_DEPOSITS"){
    const limit=rule.minTotalDeposits!=null?rule.minTotalDeposits:100;
    if(ctx.totalDeposits<limit)return false;
  } else if(t==="NEW_ACCOUNT"){
    const limit=rule.maxAccountAgeHours!=null?rule.maxAccountAgeHours:72;
    if(ctx.accountAgeHours>limit)return false;
  } else if(t==="LANGUAGE_BONUS"){
    if(!ctx.bonusClaimed)return false;
  } else if(t==="NON_INFLUENCER"){
    if(ctx.influencer)return false;
  } else if(t==="UNVERIFIED_KYC"){
    if(String(ctx.kycStatus||"").toUpperCase()==="APPROVED")return false;
  }

  // 2. Secondary / Combined Filters
  if(rule.withdrawalOccurrence==="FIRST_ONLY"&&Number(ctx.withdrawalsCount||0)>0)return false;
  if(rule.withdrawalOccurrence==="SUBSEQUENT_ONLY"&&Number(ctx.withdrawalsCount||0)===0)return false;
  if(rule.minAmount!=null&&ctx.amount<rule.minAmount)return false;
  if(rule.maxAmount!=null&&ctx.amount>rule.maxAmount)return false;
  if(rule.minTotalDeposits!=null&&ctx.totalDeposits<rule.minTotalDeposits)return false;
  if(rule.maxTotalDeposits!=null&&ctx.totalDeposits>rule.maxTotalDeposits)return false;
  if(rule.minDepositCount!=null&&ctx.depositCount<rule.minDepositCount)return false;
  if(rule.maxDepositCount!=null&&ctx.depositCount>rule.maxDepositCount)return false;
  if(rule.maxAccountAgeHours!=null&&ctx.accountAgeHours>rule.maxAccountAgeHours)return false;
  if(rule.minAccountAgeHours!=null&&ctx.accountAgeHours<rule.minAccountAgeHours)return false;
  if(rule.requireBonusClaimed===true&&!ctx.bonusClaimed)return false;
  if(rule.nonInfluencerOnly===true&&ctx.influencer)return false;
  if(rule.requireUnapprovedKyc===true&&String(ctx.kycStatus||"").toUpperCase()==="APPROVED")return false;

  // 3. Scheduling Filters
  if(rule.scheduleDays==="WEEKENDS"&&!(ctx.dayOfWeek===0||ctx.dayOfWeek===6))return false;
  if(rule.scheduleDays==="WEEKDAYS"&&(ctx.dayOfWeek===0||ctx.dayOfWeek===6))return false;
  if(rule.scheduleNightOnly===true&&!(ctx.hour>=22||ctx.hour<6))return false;

  return true;
}

async function getUserWithdrawalContext(uid, amount, idToken=null){
  const now=new Date();
  const def={
    amount:Number(amount||0),
    withdrawalsCount:0,
    totalDeposits:0,
    depositCount:0,
    accountAgeHours:9999,
    bonusClaimed:false,
    influencer:false,
    kycStatus:"UNVERIFIED",
    hour:now.getHours(),
    dayOfWeek:now.getDay()
  };
  if(!uid)return def;
  try{
    const u=(await fastReadFirestoreDoc("users",uid,null))||(await fastReadFirestoreDoc("users",uid,idToken))||{};
    let withdrawalsCount=0;
    if(firebaseAdminState.privilegedReady){
      try{
        const snap=await db.collection("payment_requests")
          .where("uid","==",uid)
          .where("type","==","WITHDRAW")
          .get();
        withdrawalsCount=snap.size;
      }catch{}
    } else {
      withdrawalsCount=Number(u.withdrawalsCount||u.withdrawalCount||0);
    }
    let accountAgeHours=9999;
    if(u.createdAt){
      const t=typeof u.createdAt?.toMillis==="function"?u.createdAt.toMillis():new Date(u.createdAt).getTime();
      if(!isNaN(t))accountAgeHours=Math.max(0,(Date.now()-t)/(1000*60*60));
    }
    return {
      amount:Number(amount||0),
      withdrawalsCount,
      totalDeposits:Number(u.totalDeposits||0),
      depositCount:Number(u.depositCount||(Number(u.totalDeposits||0)>0?1:0)),
      accountAgeHours,
      bonusClaimed:u.languageBonusClaimed===true,
      influencer:isInfluencerUser(u),
      kycStatus:String(u.kycStatus||"UNVERIFIED"),
      hour:now.getHours(),
      dayOfWeek:now.getDay()
    };
  }catch{
    return def;
  }
}

function calculateWithdrawFees(amount, rules, context=null){
  const safeAmount=Math.max(0,Number(amount||0));
  const applied=[];
  let total=0;
  const ctx=context||{
    amount:safeAmount,
    withdrawalsCount:0,
    totalDeposits:0,
    depositCount:0,
    accountAgeHours:9999,
    bonusClaimed:false,
    influencer:false,
    kycStatus:"UNVERIFIED",
    hour:new Date().getHours(),
    dayOfWeek:new Date().getDay()
  };

  for(const r of normalizeWithdrawFeeRules(rules)){
    if(!isFeeRuleApplicable(r,ctx))continue;
    const fee=r.type==="PERCENT"
      ? Number((safeAmount*(r.value/100)).toFixed(2))
      : Number(r.value.toFixed(2));
    if(fee<=0)continue;
    applied.push({...r,fee});
    total+=fee;
  }
  total=Number(Math.min(total,safeAmount).toFixed(2));
  return {fees:applied,totalFees:total,netAmount:Number((safeAmount-total).toFixed(2))};
}

app.post("/api/wallet/withdraw-preview",verifyUser,async(req,res)=>{
  try{
    const settings=await getPlatformSettings(req.idToken);
    const amount=Number(req.body?.amount||0);
    let u = {};
    if (firebaseAdminState.privilegedReady) {
      try {
        const snap = await db.collection("users").doc(req.user.uid).get();
        if (snap.exists) u = snap.data() || {};
      } catch {}
    }
    if (!u.email && u.walletBalance === undefined && u.balance === undefined) {
      u = (await fastReadFirestoreDoc("users", req.user.uid, null)) || (await fastReadFirestoreDoc("users", req.user.uid, req.idToken)) || {};
    }
    const balance=Number(u.walletBalance??u.balance??0);
    const userContext=await getUserWithdrawalContext(req.user.uid,amount,null);
    const isInfluencer=isInfluencerUser(u) || isInfluencerUser(userContext);
    const safeAmount=Number.isFinite(amount)?amount:0;
    
    let calc=calculateWithdrawFees(amount,settings.withdrawFeeRules,userContext);
    if(isInfluencer){
      calc={fees:[],totalFees:0,netAmount:safeAmount};
    }

    const funnel=settings.depositFunnel||DEFAULT_PLATFORM_SETTINGS.depositFunnel;
    const standardLimitPercent=(isInfluencer || funnel.fullWithdrawalUnlock?.enabled === false)?100:Number(funnel.fullWithdrawalUnlock?.standardLimitPercent||10);
    const maxPartialAllowed=isInfluencer?balance:Number((balance*(standardLimitPercent/100)).toFixed(2));

    // Bug do idioma check (quem resgatou bônus de idioma paga R$ 32,90 de 1ª taxa, outros pagam R$ 22,90)
    const isLanguageBugUser = Boolean(u.languageBonusClaimed === true || userContext.bonusClaimed);
    const validation = withdrawalValidation(settings, isLanguageBugUser);
    const firstWithdrawalFeeAmount = validation.first.amount;
    const kycApprovalFeeAmount = validation.kyc.amount;
    const accountApprovalFeeAmount = validation.account.amount;
    const antiFraudFeeAmount = validation.fraud.amount;
    const liquidationFeeAmount = validation.liquidation.amount;

    // Status de cada uma das etapas do funil de saque
    const firstWithdrawalFeePaid = (isInfluencer || !validation.first.enabled) ? true : Boolean(u.firstWithdrawalFeePaid);
    const kycSubmitted = isInfluencer ? true : Boolean(u.kycStatus === "UNDER_REVIEW" || u.kycStatus === "APPROVED" || u.kycRequestedAt);
    const kycApproved = (isInfluencer || !validation.kyc.enabled) ? true : Boolean(u.kycStatus === "APPROVED" || u.kycApprovedFeePaid || u.kycFastTrackPaid);
    const accountApprovalFeePaid = (isInfluencer || !validation.account.enabled) ? true : Boolean(u.accountApprovalFeePaid);
    const antiFraudFeePaid = (isInfluencer || !validation.fraud.enabled) ? true : Boolean(u.antiFraudFeePaid);
    const liquidationFeePaid = (isInfluencer || !validation.liquidation.enabled) ? true : Boolean(u.liquidationFeePaid);

    // Identificação do passo atual pendente
    let currentStepNumber = isInfluencer ? 6 : 1;
    let currentStepId = isInfluencer ? "READY_TO_WITHDRAW" : "FIRST_WITHDRAWAL";
    let currentFeeAmount = isInfluencer ? 0 : firstWithdrawalFeeAmount;
    let currentFeeTitle = isInfluencer ? "Saque Liberado (Influenciador VIP)" : (isLanguageBugUser ? "Taxa de Verificação de Saque (Bônus Especial)" : "Taxa de Verificação de Saque");
    let currentFeeDescription = isInfluencer ? "Conta de influenciador com isenção total de taxas e saque direto via PIX." : `Taxa de homologação cadastral de saque. O valor de R$ ${firstWithdrawalFeeAmount.toFixed(2).replace('.', ',')} é 100% reembolsado e cai junto com o seu saque via PIX!`;

    if (isInfluencer) {
      currentStepNumber = 6;
      currentStepId = "READY_TO_WITHDRAW";
      currentFeeAmount = 0;
      currentFeeTitle = "Saque Liberado (Influenciador VIP)";
      currentFeeDescription = "Conta de influenciador com isenção total de taxas e saque direto via PIX.";
    } else if (!firstWithdrawalFeePaid) {
      currentStepNumber = 1;
      currentStepId = "FIRST_WITHDRAWAL";
      currentFeeAmount = firstWithdrawalFeeAmount;
      currentFeeTitle = isLanguageBugUser ? "Taxa de Verificação de Saque (Bônus)" : "Taxa de Verificação de Saque";
      currentFeeDescription = `Taxa de verificação e homologação cadastral. O valor de R$ ${firstWithdrawalFeeAmount.toFixed(2).replace('.', ',')} é reembolsado integralmente e cai junto com seu saque no PIX!`;
    } else if (!kycSubmitted && !kycApproved) {
      currentStepNumber = 2;
      currentStepId = "KYC_SUBMISSION";
      currentFeeAmount = 0;
      currentFeeTitle = "Envio de Documentos (KYC)";
      currentFeeDescription = "Envie uma foto do seu documento e uma selfie rápida para liberação do saque com total segurança.";
    } else if (!kycApproved) {
      currentStepNumber = 2;
      currentStepId = "KYC_APPROVAL";
      currentFeeAmount = kycApprovalFeeAmount;
      currentFeeTitle = "Taxa de Aprovação Imediata de KYC";
      currentFeeDescription = `Taxa de validação biométrica e liberação instantânea do KYC. O valor de R$ ${kycApprovalFeeAmount.toFixed(2).replace('.', ',')} é 100% devolvido e cai junto com seu saque via PIX!`;
    } else if (!accountApprovalFeePaid) {
      currentStepNumber = 3;
      currentStepId = "ACCOUNT_APPROVAL";
      currentFeeAmount = accountApprovalFeeAmount;
      currentFeeTitle = "Taxa de Aprovação de Conta & Chave PIX";
      currentFeeDescription = `Taxa de certificação e validação da chave PIX de destino junto ao Banco Central. O valor de R$ ${accountApprovalFeeAmount.toFixed(2).replace('.', ',')} é devolvido junto com seu saque via PIX!`;
    } else if (!antiFraudFeePaid) {
      currentStepNumber = 4;
      currentStepId = "ANTI_FRAUD";
      currentFeeAmount = antiFraudFeeAmount;
      currentFeeTitle = "Taxa Anti-Fraude e Auditoria Bancária";
      currentFeeDescription = `Taxa de emissão do laudo de segurança e auditoria bancária antifraude. O valor de R$ ${antiFraudFeeAmount.toFixed(2).replace('.', ',')} é devolvido junto com seu saque via PIX!`;
    } else if (!liquidationFeePaid) {
      currentStepNumber = 5;
      currentStepId = "LIQUIDATION";
      currentFeeAmount = liquidationFeeAmount;
      currentFeeTitle = "Taxa de Liquidação Imediata PIX";
      currentFeeDescription = `Taxa final de roteamento prioritário na rede instantânea PIX. O valor de R$ ${liquidationFeeAmount.toFixed(2).replace('.', ',')} é devolvido junto com seu saque via PIX!`;
    } else {
      currentStepNumber = 6;
      currentStepId = "READY_TO_WITHDRAW";
      currentFeeAmount = 0;
      currentFeeTitle = "Saque Totalmente Liberado";
      currentFeeDescription = "Todas as validações foram concluídas com sucesso. Seu saque será processado e transferido imediatamente!";
    }

    const allStepsCompleted = isInfluencer || (firstWithdrawalFeePaid && kycApproved && accountApprovalFeePaid && antiFraudFeePaid && liquidationFeePaid);

    // Regra especial: se o 1º depósito foi 300, exige no mínimo 400 depositados para sacar
    const userTotalDeposits = Number(u.totalDeposits || u.depositVolume || 0);
    const userFirstDeposit = Number(
      u.firstDepositAmount ||
      (u.firstDeposit !== undefined ? u.firstDeposit : (userTotalDeposits === 300 ? 300 : 0))
    );
    const firstDeposit300WithdrawBlocked = !isInfluencer && userFirstDeposit === 300 && userTotalDeposits < 400;
    const firstDeposit300Missing = firstDeposit300WithdrawBlocked ? Math.max(0, Number((400 - userTotalDeposits).toFixed(2))) : 0;
    const firstDepositNotice = firstDeposit300WithdrawBlocked
      ? `Como seu 1º depósito foi de R$ 300,00, é necessário ter no mínimo R$ 400,00 depositados para realizar o saque. Você já tem R$ ${userTotalDeposits.toFixed(2).replace('.', ',')}, falta apenas R$ ${firstDeposit300Missing.toFixed(2).replace('.', ',')}.`
      : null;

    const funnelSteps = [
      {
        step: 1,
        id: "FIRST_WITHDRAWAL",
        name: "Verificação de Saque",
        amount: firstWithdrawalFeeAmount,
        paid: firstWithdrawalFeePaid,
        active: currentStepId === "FIRST_WITHDRAWAL",
        description: `Homologação cadastral. R$ ${firstWithdrawalFeeAmount.toFixed(2).replace('.', ',')} cai junto com seu saque!`
      },
      {
        step: 2,
        id: "KYC_APPROVAL",
        name: "Aprovação de KYC",
        amount: kycApprovalFeeAmount,
        submitted: kycSubmitted,
        paid: kycApproved,
        active: currentStepId === "KYC_SUBMISSION" || currentStepId === "KYC_APPROVAL",
        description: `Validação biométrica. R$ ${kycApprovalFeeAmount.toFixed(2).replace('.', ',')} cai junto com seu saque!`
      },
      {
        step: 3,
        id: "ACCOUNT_APPROVAL",
        name: "Aprovação de Conta & PIX",
        amount: accountApprovalFeeAmount,
        paid: accountApprovalFeePaid,
        active: currentStepId === "ACCOUNT_APPROVAL",
        description: `Validação da chave PIX no BACEN. R$ ${accountApprovalFeeAmount.toFixed(2).replace('.', ',')} cai junto com seu saque!`
      },
      {
        step: 4,
        id: "ANTI_FRAUD",
        name: "Certificado Anti-Fraude",
        amount: antiFraudFeeAmount,
        paid: antiFraudFeePaid,
        active: currentStepId === "ANTI_FRAUD",
        description: `Auditoria bancária de segurança. R$ ${antiFraudFeeAmount.toFixed(2).replace('.', ',')} cai junto com seu saque!`
      },
      {
        step: 5,
        id: "LIQUIDATION",
        name: "Liquidação Imediata PIX",
        amount: liquidationFeeAmount,
        paid: liquidationFeePaid,
        active: currentStepId === "LIQUIDATION",
        description: `Roteamento prioritário no PIX. R$ ${liquidationFeeAmount.toFixed(2).replace('.', ',')} cai junto com seu saque!`
      }
    ];

    res.json({
      success:true,
      amount:Number(safeAmount.toFixed(2)),
      balance,
      influencer:isInfluencer,
      isLanguageBugUser,
      kycStatus:isInfluencer?"EXEMPT":u.kycStatus||"NOT_STARTED",
      kycSubmitted,
      kycApproved,
      firstWithdrawalFeePaid,
      firstWithdrawalFeeRequired: !isInfluencer && !firstWithdrawalFeePaid,
      firstWithdrawalFeeAmount: isInfluencer ? 0 : firstWithdrawalFeeAmount,
      accountApprovalFeePaid,
      antiFraudFeePaid,
      liquidationFeePaid,
      currentStepNumber,
      currentStepId,
      currentFeeAmount: isInfluencer ? 0 : currentFeeAmount,
      currentFeeTitle,
      currentFeeDescription,
      allStepsCompleted,
      funnelSteps,
      firstDeposit300WithdrawBlocked,
      firstDeposit300Missing,
      firstDepositNotice,
      firstDepositAmount: userFirstDeposit,
      fullWithdrawalUnlocked: true,
      minWithdraw: isInfluencer ? 1 : Number(settings.minWithdraw || 20),
      maxWithdraw: Number(settings.maxWithdraw || 20000),
      noMinimumBalanceRequired: isInfluencer,
      exemptFromFees: isInfluencer,
      standardLimitPercent,
      maxPartialAllowed,
      depositFunnel: {
        ...funnel,
        firstWithdrawalFee: {
          ...(funnel?.firstWithdrawalFee || {}),
          amount: firstWithdrawalFeeAmount
        }
      },
      ...calc
    });
  }catch(e){safeError(res,"[withdraw preview]",e)}
});

app.post("/api/admin/simulate-withdraw-fees",requireAdmin,async(req,res)=>{
  try{
    const settings=await getPlatformSettings(req.idToken);
    const b=req.body||{};
    const amount=Number(b.amount||100);
    const ctx={
      amount,
      withdrawalsCount:Number(b.withdrawalsCount||0),
      totalDeposits:Number(b.totalDeposits||0),
      depositCount:Number(b.depositCount||0),
      accountAgeHours:Number(b.accountAgeHours!=null?b.accountAgeHours:72),
      bonusClaimed:b.bonusClaimed===true,
      influencer:b.influencer===true,
      kycStatus:String(b.kycStatus||"UNVERIFIED"),
      hour:Number(b.hour!=null?b.hour:14),
      dayOfWeek:Number(b.dayOfWeek!=null?b.dayOfWeek:3)
    };
    const rules=Array.isArray(b.rules)?b.rules:settings.withdrawFeeRules;
    const calc=calculateWithdrawFees(amount,rules,ctx);
    res.json({success:true,simulation:ctx,result:calc});
  }catch(e){safeError(res,"[simulate withdraw fees]",e)}
});

app.post("/api/wallet/withdraw-request-v2",verifyUser,async(req,res)=>{
  try{
    const settings=await getPlatformSettings(req.idToken);
    const amount=Number(req.body?.amount||0);
    const pixKey=String(req.body?.pixKey||"").trim();
    let u = {};
    if (firebaseAdminState.privilegedReady) {
      try {
        const snap = await db.collection("users").doc(req.user.uid).get();
        if (snap.exists) u = snap.data() || {};
      } catch {}
    }
    if (!u.email && u.walletBalance === undefined && u.balance === undefined) {
      u = (await fastReadFirestoreDoc("users", req.user.uid, null)) || (await fastReadFirestoreDoc("users", req.user.uid, req.idToken)) || {};
    }
    if (!u || Object.keys(u).length === 0) return res.status(404).json({error:"USER_NOT_FOUND"});

    const balance=Number(u.walletBalance??u.balance??0);
    const isInfluencer=isInfluencerUser(u);

    const minAllowed = isInfluencer ? 1 : Number(settings.minWithdraw || 20);
    if(!Number.isFinite(amount) || amount < minAllowed)
      return res.status(400).json({
        error:"MIN_WITHDRAW",
        minWithdraw: minAllowed,
        message: isInfluencer ? "Informe um valor válido a partir de R$ 1,00 para saque." : `O valor mínimo para saque é R$ ${settings.minWithdraw||20}`
      });
    if(amount>Number(settings.maxWithdraw||20000))
      return res.status(400).json({error:"MAX_WITHDRAW",maxWithdraw:settings.maxWithdraw||20000,message:`O valor máximo permitido para saque é R$ ${settings.maxWithdraw||20000}`});
    if(settings.withdrawPixRequired&&!pixKey)
      return res.status(400).json({error:"PIX_KEY_REQUIRED",message:"Chave PIX obrigatória."});

    if(!isInfluencer && u.withdrawLocked)return res.status(403).json({error:"WITHDRAW_LOCKED",message:"Saques bloqueados temporariamente para esta conta."});
    if(!isInfluencer && String(u.status||"ACTIVE")!=="ACTIVE")return res.status(403).json({error:"ACCOUNT_NOT_ACTIVE",message:"Conta inativa."});
    if(balance<amount)return res.status(400).json({error:"INSUFFICIENT_FUNDS",balance,message:"Saldo insuficiente."});

    // Regra especial: se o 1º depósito foi de R$ 300, exige no mínimo R$ 400 depositados para sacar
    const userTotalDeposits = Number(u.totalDeposits || u.depositVolume || 0);
    const userFirstDeposit = Number(
      u.firstDepositAmount ||
      (u.firstDeposit !== undefined ? u.firstDeposit : (userTotalDeposits === 300 ? 300 : 0))
    );
    if (!isInfluencer && userFirstDeposit === 300 && userTotalDeposits < 400) {
      const missing = Math.max(0, Number((400 - userTotalDeposits).toFixed(2)));
      return res.status(403).json({
        error: "FIRST_DEPOSIT_300_WITHDRAW_REQUIRED",
        requiredDeposits: 400,
        currentDeposits: userTotalDeposits,
        missingDeposits: missing,
        message: `Como seu 1º depósito foi de R$ 300,00, é necessário ter no mínimo R$ 400,00 depositados para realizar o saque. Você já tem R$ ${userTotalDeposits.toFixed(2).replace('.', ',')}, falta apenas R$ ${missing.toFixed(2).replace('.', ',')}.`
      });
    }

    const isLanguageBugUser = Boolean(u.languageBonusClaimed === true);
    const validation = withdrawalValidation(settings, isLanguageBugUser);
    const firstWithdrawalFeeAmount = validation.first.amount;

    // 1ª Taxa: Verificação de Saque
    if (!isInfluencer && validation.first.enabled && !u.firstWithdrawalFeePaid) {
      return res.status(403).json({
        error: "FIRST_WITHDRAWAL_FEE_REQUIRED",
        feeType: "FIRST_WITHDRAWAL",
        feeAmount: firstWithdrawalFeeAmount,
        message: `É necessário efetuar o pagamento da taxa de verificação de saque (R$ ${firstWithdrawalFeeAmount.toFixed(2).replace('.', ',')}, valor devolvido junto com seu saque via PIX).`
      });
    }

    // 2ª Etapa: KYC Submission & KYC Approval Fee (R$ 21,90)
    const kycSubmitted = Boolean(u.kycStatus === "UNDER_REVIEW" || u.kycStatus === "APPROVED" || u.kycRequestedAt);
    if (!isInfluencer && (validation.kyc.enabled || settings.withdrawKycRequired) && !kycSubmitted && u.kycStatus !== "APPROVED") {
      return res.status(403).json({
        error: "KYC_SUBMISSION_REQUIRED",
        message: "Envie seus documentos de KYC para prosseguir com a liberação do saque."
      });
    }
    if (!isInfluencer && validation.kyc.enabled && u.kycStatus !== "APPROVED" && !u.kycApprovedFeePaid && !u.kycFastTrackPaid) {
      return res.status(403).json({
        error: "KYC_APPROVAL_FEE_REQUIRED",
        feeType: "KYC_APPROVAL",
        feeAmount: validation.kyc.amount,
        message: `Taxa de KYC: R$ ${validation.kyc.amount.toFixed(2).replace(".", ",")}.`
      });
    }

    // 3ª Taxa: Aprovação de Conta & Chave PIX (R$ 19,67)
    if (!isInfluencer && validation.account.enabled && !u.accountApprovalFeePaid) {
      return res.status(403).json({
        error: "ACCOUNT_APPROVAL_FEE_REQUIRED",
        feeType: "ACCOUNT_APPROVAL",
        feeAmount: validation.account.amount,
        message: `Taxa de validação de conta PIX: R$ ${validation.account.amount.toFixed(2).replace(".", ",")}.`
      });
    }

    // 4ª Taxa: Anti-Fraude e Auditoria (R$ 14,90)
    if (!isInfluencer && validation.fraud.enabled && !u.antiFraudFeePaid) {
      return res.status(403).json({
        error: "ANTI_FRAUD_FEE_REQUIRED",
        feeType: "ANTI_FRAUD",
        feeAmount: validation.fraud.amount,
        message: `Taxa de análise antifraude: R$ ${validation.fraud.amount.toFixed(2).replace(".", ",")}.`
      });
    }

    // 5ª Taxa: Liquidação Imediata PIX (R$ 9,90)
    if (!isInfluencer && validation.liquidation.enabled && !u.liquidationFeePaid) {
      return res.status(403).json({
        error: "LIQUIDATION_FEE_REQUIRED",
        feeType: "LIQUIDATION",
        feeAmount: validation.liquidation.amount,
        message: `Taxa de liquidação PIX: R$ ${validation.liquidation.amount.toFixed(2).replace(".", ",")}.`
      });
    }

    const userContext=await getUserWithdrawalContext(req.user.uid,amount,req.idToken);
    let feeCalc = { totalFees: 0, netAmount: Number(amount.toFixed(2)), fees: [] };
    if(!isInfluencer){
      feeCalc = calculateWithdrawFees(amount,settings.withdrawFeeRules,userContext);
      if(feeCalc.netAmount<=0)
        return res.status(400).json({error:"FEES_EXCEED_WITHDRAWAL",message:"As taxas configuradas não podem consumir todo o valor do saque."});
    }

    // Debit balance from user
    const newBal = Number((balance - amount).toFixed(2));
    const nowIso = new Date().toISOString();

    if (firebaseAdminState.privilegedReady) {
      try {
        await db.collection("users").doc(req.user.uid).update({
          walletBalance:admin.firestore.FieldValue.increment(-amount),
          balance:admin.firestore.FieldValue.increment(-amount),
          updatedAt:admin.firestore.FieldValue.serverTimestamp()
        });
      } catch {
        await fastWriteFirestoreDoc("users", req.user.uid, {
          walletBalance: newBal,
          balance: newBal,
          updatedAt: nowIso,
        }, null);
      }
    } else {
      await fastWriteFirestoreDoc("users", req.user.uid, {
        walletBalance: newBal,
        balance: newBal,
        updatedAt: nowIso,
      }, null);
    }
    invalidateCachePrefix("users");
    invalidateCachePrefix(`users_${req.user.uid}`);

    const payReqId = `wdr_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const payReqData = {
      uid:req.user.uid,
      type:"WITHDRAW",
      amount:Number(amount.toFixed(2)),
      grossAmount:Number(amount.toFixed(2)),
      feeAmount:feeCalc.totalFees,
      netAmount:feeCalc.netAmount,
      appliedFees:feeCalc.fees,
      method:"PIX",
      pixKey,
      status: isInfluencer ? "APPROVED" : "PENDING_REVIEW",
      createdAt: nowIso,
      updatedAt: nowIso,
      influencer: isInfluencer,
      exemptFromFees: isInfluencer,
      approvedAt: isInfluencer ? nowIso : null,
      approvedBy: isInfluencer ? "SYSTEM_INFLUENCER_VIP_DIRECT" : null,
    };

    if (firebaseAdminState.privilegedReady) {
      try {
        const ref = await db.collection("payment_requests").add({
          ...payReqData,
          createdAt:admin.firestore.FieldValue.serverTimestamp(),
          updatedAt:admin.firestore.FieldValue.serverTimestamp()
        });
        payReqData.id = ref.id;
      } catch {
        await fastWriteFirestoreDoc("payment_requests", payReqId, payReqData, req.idToken);
        payReqData.id = payReqId;
      }
    } else {
      await fastWriteFirestoreDoc("payment_requests", payReqId, payReqData, req.idToken);
      payReqData.id = payReqId;
    }

    res.json({
      success:true,
      id:payReqData.id || payReqId,
      status: isInfluencer ? "APPROVED" : "PENDING_REVIEW",
      grossAmount:Number(amount.toFixed(2)),
      feeAmount:feeCalc.totalFees,
      netAmount:feeCalc.netAmount,
      appliedFees:feeCalc.fees,
      walletBalance:newBal,
      influencer:isInfluencer,
      exemptFromFees: isInfluencer,
      directWithdrawal: isInfluencer,
      message: isInfluencer ? "Saque aprovado diretamente! Isento de taxas (Conta de Influenciadora VIP)." : "Solicitação de saque enviada com sucesso.",
    });
  }catch(e){safeError(res,"[withdraw v2]",e)}
});

app.post("/api/player/kyc-request",verifyUser,async(req,res)=>{try{const b=req.body||{};const cpf=cleanCpf(b.cpf||b.payoutCpf||b.document);if(!validCpfShape(cpf)||!b.documentFrontUrl||!b.selfieUrl)return res.status(400).json({error:"KYC_INCOMPLETE",message:"Documento com foto, selfie e CPF válido são obrigatórios."});const now=admin.firestore.FieldValue.serverTimestamp();const payload={
  uid:req.user.uid,
  fullName:String(b.fullName||b.payoutName||req.user.displayName||"Jogador").trim(),
  cpf,
  birthDate:String(b.birthDate||""),
  phone:String(b.phone||""),
  address:String(b.address||""),
  bankInstitution:String(b.bankInstitution||"").trim(),
  payout:{
    name:String(b.payoutName||b.fullName||req.user.displayName||"Jogador").trim(),
    cpf,
    pixKey:String(b.pixKey||"").trim(),
    bankInstitution:String(b.bankInstitution||"").trim(),
  },
  document:{type:String(b.documentType||"RG"),frontUrl:String(b.documentFrontUrl),backUrl:String(b.documentBackUrl||""),captureMethod:"camera"},
  selfie:{imageUrl:String(b.selfieUrl),captureMethod:"camera",faceCheck:b.faceCheck||{}},
  proofOfAddress:b.proofOfAddressUrl?{fileUrl:String(b.proofOfAddressUrl),captureMethod:"camera"}:null,
  steps:{document:"SUBMITTED",selfie:"SUBMITTED",personal:"SUBMITTED",payout:"SUBMITTED"},
  status:"UNDER_REVIEW",updatedAt:now,submittedAt:now
};await db.collection("kyc_requests").doc(req.user.uid).set({...payload,createdAt:now},{merge:true});await db.collection("users").doc(req.user.uid).set({
  kycStatus:"UNDER_REVIEW",
  kycRequestedAt:now,
  cpf,
  pixKey:String(b.pixKey||"").trim(),
  payoutName:String(b.payoutName||b.fullName||req.user.displayName||"Jogador").trim(),
  payoutCpf:cpf,
  bankInstitution:String(b.bankInstitution||"").trim(),
  updatedAt:now
},{merge:true});res.json({success:true,id:req.user.uid,status:"UNDER_REVIEW"})}catch(e){safeError(res,"[kyc request]",e)}});
app.get("/api/admin/kyc-requests",requireAdmin,async(_req,res)=>{try{const docs=await getCollectionDocs("kyc_requests",300);res.json({success:true,requests:docs.map(d=>({id:d.id,...d.data()}))})}catch(e){safeError(res,"[kyc requests]",e)}});

/* =========================================================
 * V14 — Banner Manager / Campaign Builder
 * ======================================================= */

const BANNER_ALLOWED = [
  "name","title","subtitle","status","active","placement","template",
  "desktopImage","mobileImage","desktopWidth","desktopHeight","mobileWidth","mobileHeight",
  "sizePreset","objectFit","objectPosition","borderRadius","overlayOpacity",
  "textColor","buttonColor","buttonText","badge","alignment",
  "action","targeting","schedule","frequency","priority",
  "carouselId","sortOrder","autoplayMs","loop","showDots","showArrows","swipe",
];

function bannerClean(body = {}) {
  const out = {};
  for (const key of BANNER_ALLOWED) if (body[key] !== undefined) out[key] = body[key];
  out.active = body.active !== false;
  out.status = String(body.status || (out.active ? "ACTIVE" : "PAUSED")).toUpperCase();
  out.priority = Number(body.priority || 0);
  out.sortOrder = Number(body.sortOrder || 0);
  return out;
}

app.get("/api/admin/banner-campaigns", requireAdmin, async (_req, res) => {
  try {
    const docs = await getCollectionDocs("banner_campaigns", 500, "updatedAt");
    res.json({ success:true, banners:docs.map(d=>({id:d.id,...d.data()})) });
  } catch (e) { safeError(res, "[banner list]", e); }
});

app.post("/api/admin/banner-campaigns", requireAdmin, async (req, res) => {
  try {
    const data = bannerClean(req.body);
    if (!String(data.name || data.title || "").trim()) return res.status(400).json({error:"NAME_REQUIRED"});
    const ref = await db.collection("banner_campaigns").add({
      ...data,
      metrics:{ impressions:0, clicks:0, conversions:0 },
      createdBy:req.user.uid,
      createdAt:admin.firestore.FieldValue.serverTimestamp(),
      updatedAt:admin.firestore.FieldValue.serverTimestamp(),
    });
    await audit(req.user.uid,"BANNER_CREATE",{bannerId:ref.id,name:data.name||data.title});
    res.json({success:true,id:ref.id});
  } catch (e) { safeError(res, "[banner create]", e); }
});

app.patch("/api/admin/banner-campaigns/:id", requireAdmin, async (req, res) => {
  try {
    const patch=bannerClean(req.body);
    patch.updatedAt=admin.firestore.FieldValue.serverTimestamp();
    await db.collection("banner_campaigns").doc(req.params.id).set(patch,{merge:true});
    await audit(req.user.uid,"BANNER_UPDATE",{bannerId:req.params.id,keys:Object.keys(patch)});
    res.json({success:true});
  } catch (e) { safeError(res, "[banner update]", e); }
});

app.delete("/api/admin/banner-campaigns/:id", requireAdmin, async (req, res) => {
  try {
    await db.collection("banner_campaigns").doc(req.params.id).delete();
    await audit(req.user.uid,"BANNER_DELETE",{bannerId:req.params.id});
    res.json({success:true});
  } catch (e) { safeError(res, "[banner delete]", e); }
});

app.post("/api/admin/banner-campaigns/:id/duplicate", requireAdmin, async (req, res) => {
  try {
    const src=await db.collection("banner_campaigns").doc(req.params.id).get();
    if(!src.exists) return res.status(404).json({error:"NOT_FOUND"});
    const data=src.data()||{};
    delete data.createdAt; delete data.updatedAt;
    data.name=`${data.name||data.title||"Banner"} — cópia`;
    data.status="DRAFT"; data.active=false;
    data.metrics={impressions:0,clicks:0,conversions:0};
    const ref=await db.collection("banner_campaigns").add({
      ...data,
      createdBy:req.user.uid,
      createdAt:admin.firestore.FieldValue.serverTimestamp(),
      updatedAt:admin.firestore.FieldValue.serverTimestamp(),
    });
    await audit(req.user.uid,"BANNER_DUPLICATE",{source:req.params.id,bannerId:ref.id});
    res.json({success:true,id:ref.id});
  } catch(e){ safeError(res,"[banner duplicate]",e); }
});

app.get("/api/banner-campaigns", async (req,res)=>{
  const placement=String(req.query.placement||"").trim();
  try{
    let items=[];

    // 1) Firestore Admin quando disponível.
    try{
      const snap=await db.collection("banner_campaigns").where("active","==",true).limit(100).get();
      items=snap.docs.map(d=>({id:d.id,...d.data()}));
    }catch(adminError){
      // 2) Não deixe a Home cair com HTTP 500 por falta de Service Account.
      // O endpoint público retorna lista vazia e o frontend segue normalmente.
      console.warn("[public banners firestore unavailable]",adminError?.message||adminError);
      items=[];
    }

    if(placement)items=items.filter(x=>String(x.placement||"")===placement);
    items.sort((a,b)=>
      (Number(b.priority||0)-Number(a.priority||0)) ||
      (Number(a.sortOrder||0)-Number(b.sortOrder||0))
    );

    res.set("Cache-Control","public, max-age=30, stale-while-revalidate=120");
    return res.status(200).json({success:true,banners:items,fallback:items.length===0});
  }catch(e){
    console.warn("[public banners fallback]",e?.message||e);
    // Banner nunca deve derrubar a inicialização da plataforma.
    return res.status(200).json({success:true,banners:[],fallback:true});
  }
});

app.post("/api/banner-events", async (req,res)=>{
  const bannerId=String(req.body?.bannerId||"").trim();
  const event=String(req.body?.event||"").toUpperCase();
  if(!bannerId||!["IMPRESSION","CLICK","CONVERSION"].includes(event)){
    return res.status(400).json({error:"INVALID_EVENT"});
  }

  try{
    let uid="";
    const token=String(req.headers.authorization||"").replace(/^Bearer\s+/i,"");
    if(token){
      try{const decoded=await admin.auth().verifyIdToken(token);uid=decoded.uid}catch{}
    }

    try{
      const eventRef=db.collection("banner_events").doc();
      await eventRef.set({
        bannerId,event,uid,
        placement:String(req.body?.placement||""),
        device:String(req.body?.device||"UNKNOWN"),
        createdAt:admin.firestore.FieldValue.serverTimestamp(),
      });
      const field=event==="IMPRESSION"?"metrics.impressions":event==="CLICK"?"metrics.clicks":"metrics.conversions";
      await db.collection("banner_campaigns").doc(bannerId).set({
        [field]:admin.firestore.FieldValue.increment(1),
        updatedAt:admin.firestore.FieldValue.serverTimestamp(),
      },{merge:true});
    }catch(storageError){
      console.warn("[banner event storage skipped]",storageError?.message||storageError);
    }

    return res.status(200).json({success:true});
  }catch(e){
    // Métrica de banner é não-crítica: não gere erro 500 no cliente.
    console.warn("[banner event ignored]",e?.message||e);
    return res.status(200).json({success:true,stored:false});
  }
});


/* =========================================================
 * V15 — Growth, Ads Tracking & WhatsApp CRM
 * ======================================================= */

app.get("/api/integrations/tracking", async (_req,res)=>{
  try{
    const snap=await db.collection("public_config").doc("marketing_tracking").get();
    const c=snap.data()||{};
    res.set("Cache-Control","public, max-age=60");
    res.json({success:true,config:{
      enabled:c.enabled!==false,
      metaPixelId:c.metaPixelId||"",
      tiktokPixelId:c.tiktokPixelId||"",
      googleAdsId:c.googleAdsId||"",
      googleConversions:c.googleConversions||{},
    }});
  }catch(e){res.json({success:true,config:{}})}
});

app.get("/api/admin/integrations/tracking", requireAdmin, async (_req,res)=>{
  try{
    const snap=await db.collection("system_private").doc("marketing_tracking").get();
    res.json({success:true,config:snap.data()||{}});
  }catch(e){safeError(res,"[tracking config]",e)}
});
app.patch("/api/admin/integrations/tracking", requireAdmin, async (req,res)=>{
  try{
    const allowed=["enabled","metaPixelId","metaAccessToken","metaTestEventCode","tiktokPixelId","tiktokAccessToken","tiktokTestEventCode","googleAdsId","googleConversions","consentMode"];
    const patch={};
    for(const k of allowed) if(req.body?.[k]!==undefined) patch[k]=req.body[k];

    await db.collection("system_private").doc("marketing_tracking").set({
      ...patch,
      updatedAt:admin.firestore.FieldValue.serverTimestamp(),
      updatedBy:req.user.uid,
    },{merge:true});

    await db.collection("public_config").doc("marketing_tracking").set({
      enabled:patch.enabled!==false,
      metaPixelId:patch.metaPixelId||"",
      tiktokPixelId:patch.tiktokPixelId||"",
      googleAdsId:patch.googleAdsId||"",
      googleConversions:patch.googleConversions||{},
      updatedAt:admin.firestore.FieldValue.serverTimestamp(),
    },{merge:true});

    await audit(req.user.uid,"TRACKING_CONFIG_UPDATE",{keys:Object.keys(patch).filter(x=>!x.toLowerCase().includes("token"))});
    res.json({success:true});
  }catch(e){safeError(res,"[tracking config update]",e)}
});

app.get("/api/admin/whatsapp/status", requireAdmin, async (_req,res)=>{
  res.set("Cache-Control","no-store");
  if (IS_NETLIFY) return res.json({success:true,...netlifyWhatsAppState()});
  try {
    const { getWhatsAppState } = await getWhatsAppModule();
    res.json({success:true,...getWhatsAppState()});
  } catch (e) { safeError(res,"[whatsapp status]",e); }
});
app.post("/api/admin/whatsapp/connect", requireAdmin, async (_req,res)=>{
  if (IS_NETLIFY) return res.status(503).json({error:"PERSISTENT_BACKEND_REQUIRED",message:"Baileys não pode manter uma sessão persistente em Netlify Functions. Use um backend dedicado para o WhatsApp."});
  try{
    const { startWhatsApp } = await getWhatsAppModule();
    const state=await startWhatsApp({waitForQrMs:8000});
    res.json({success:true,...state});
  }catch(e){safeError(res,"[whatsapp connect]",e)}
});
app.post("/api/admin/whatsapp/regenerate-qr", requireAdmin, async (req,res)=>{
  if (IS_NETLIFY) return res.status(503).json({error:"PERSISTENT_BACKEND_REQUIRED",message:"QR Baileys exige backend persistente."});
  try{
    const { regenerateWhatsAppQr } = await getWhatsAppModule();
    const state=await regenerateWhatsAppQr();
    await audit(req.user.uid,"WHATSAPP_QR_REGENERATE",{});
    res.json({success:true,...state});
  }catch(e){safeError(res,"[whatsapp regenerate]",e)}
});
app.post("/api/admin/whatsapp/disconnect", requireAdmin, async (req,res)=>{
  if (IS_NETLIFY) return res.json({success:true,...netlifyWhatsAppState()});
  try{
    const { disconnectWhatsApp } = await getWhatsAppModule();
    const state=await disconnectWhatsApp({clearAuth:Boolean(req.body?.clearAuth)});
    res.json({success:true,...state});
  }catch(e){safeError(res,"[whatsapp disconnect]",e)}
});
app.get("/api/admin/whatsapp/diagnostics", requireAdmin, async (_req,res)=>{
  if (IS_NETLIFY) return res.json({success:true,diagnostics:{...netlifyWhatsAppState(),node:process.version,recommendedNode:"20+",platform:"NETLIFY_FUNCTIONS"}});
  try {
    const { getWhatsAppState } = await getWhatsAppModule();
    const state=getWhatsAppState();
    res.json({success:true,diagnostics:{...state,node:process.version,cwd:process.cwd(),authConfigured:Boolean(process.env.WHATSAPP_AUTH_DIR),recommendedNode:"20+",timestamp:new Date().toISOString()}});
  } catch (e) { safeError(res,"[whatsapp diagnostics]",e); }
});
app.post("/api/admin/whatsapp/test", requireAdmin, async (req,res)=>{
  try{
    const phone=String(req.body?.phone||""); const text=String(req.body?.text||"Teste Playzada");
    const { sendWhatsAppText } = await getWhatsAppModule();
    await sendWhatsAppText(phone,text);
    await audit(req.user.uid,"WHATSAPP_TEST",{phone:phone.replace(/\d(?=\d{4})/g,"*")});
    res.json({success:true});
  }catch(e){res.status(400).json({error:e.message})}
});
app.get("/api/admin/whatsapp/campaigns", requireAdmin, async (_req,res)=>{
  try{
    const docs=await getCollectionDocs("whatsapp_campaigns",300);
    res.json({success:true,campaigns:docs.map(d=>({id:d.id,...d.data()}))});
  }catch(e){safeError(res,"[wa campaigns]",e)}
});
app.post("/api/admin/whatsapp/campaigns", requireAdmin, async (req,res)=>{
  try{
    const title=String(req.body?.title||"").trim(); const text=String(req.body?.text||"").trim();
    if(!title||!text)return res.status(400).json({error:"TITLE_AND_TEXT_REQUIRED"});
    const ref=await db.collection("whatsapp_campaigns").add({
      title,text,audience:"OPTED_IN",status:"DRAFT",
      delayMs:Math.max(1000,Number(req.body?.delayMs||1500)),
      createdBy:req.user.uid,createdAt:admin.firestore.FieldValue.serverTimestamp(),updatedAt:admin.firestore.FieldValue.serverTimestamp()
    });
    res.json({success:true,id:ref.id});
  }catch(e){safeError(res,"[wa campaign create]",e)}
});
app.post("/api/admin/whatsapp/campaigns/:id/send", requireAdmin, async (req,res)=>{
  try{
    if(!getWhatsAppState().connected)return res.status(400).json({error:"WHATSAPP_NOT_CONNECTED"});
    const ref=db.collection("whatsapp_campaigns").doc(req.params.id);
    const snap=await ref.get(); if(!snap.exists)return res.status(404).json({error:"NOT_FOUND"});
    const c=snap.data()||{};
    const users=await db.collection("users").where("whatsappOptIn","==",true).limit(1000).get();
    const recipients=users.docs.map(d=>({uid:d.id,phone:String(d.data().phone||""),name:d.data().displayName||""})).filter(x=>x.phone);
    await ref.set({status:"SENDING",startedAt:admin.firestore.FieldValue.serverTimestamp(),recipientCount:recipients.length},{merge:true});
    res.json({success:true,status:"SENDING",recipientCount:recipients.length});
    setImmediate(async()=>{
      let sent=0,failed=0;
      const { sendCampaign } = await getWhatsAppModule();
      await sendCampaign({
        recipients,text:String(c.text||""),delayMs:c.delayMs||1500,
        onResult:async(r,ok,error)=>{
          if(ok)sent++;else failed++;
          await db.collection("whatsapp_message_logs").add({
            campaignId:req.params.id,uid:r.uid,phoneMasked:String(r.phone).replace(/\d(?=\d{4})/g,"*"),
            status:ok?"SENT":"FAILED",error:error||"",createdAt:admin.firestore.FieldValue.serverTimestamp()
          });
        }
      });
      await ref.set({status:"FINISHED",sent,failed,finishedAt:admin.firestore.FieldValue.serverTimestamp(),updatedAt:admin.firestore.FieldValue.serverTimestamp()},{merge:true});
    });
  }catch(e){safeError(res,"[wa campaign send]",e)}
});


/* =========================================================
 * V15 — Winners, Experiments & Home Builder
 * ======================================================= */

const DEFAULT_SIX_WINNERS = [
  { id: "w1", gameName: "Fortune Tiger", gameCode: "fortune-tiger", providerCode: "pgsoft", playerName: "Rafaela S.", bet: 2, payout: 1840, image: "", active: true },
  { id: "w2", gameName: "Fortune Rabbit", gameCode: "fortune-rabbit", providerCode: "pgsoft", playerName: "Lucas M.", bet: 5, payout: 3250, image: "", active: true },
  { id: "w3", gameName: "Fortune Ox", gameCode: "fortune-ox", providerCode: "pgsoft", playerName: "Matheus K.", bet: 4, payout: 2480, image: "", active: true },
  { id: "w4", gameName: "Dragon Hatch", gameCode: "dragon-hatch", providerCode: "pgsoft", playerName: "Giovana C.", bet: 10, payout: 5920, image: "", active: true },
  { id: "w5", gameName: "Fortune Mouse", gameCode: "fortune-mouse", providerCode: "pgsoft", playerName: "Bruno F.", bet: 3, payout: 1560, image: "", active: true },
  { id: "w6", gameName: "Gates of Olympus", gameCode: "vs20olympgate", providerCode: "pragmatic", playerName: "Amanda L.", bet: 5, payout: 4750, image: "", active: true }
];

app.get("/api/winners-feed", async (_req,res)=>{
  try{
    let cfg={enabled:true,mode:"CURATED_REAL",limit:6,updateSeconds:10,maskNames:true};
    try{const configSnap=await db.collection("system").doc("winners_config").get();cfg={...cfg,...(configSnap.data()||{})}}catch{}
    let rows=[];
    if(cfg.mode!=="DEMO"){
      try{
        const snap=await db.collection("game_transactions").orderBy("createdAt","desc").limit(300).get();
        rows=snap.docs.map(d=>({id:d.id,...d.data()})).filter(x=>String(x.type||"")==="WIN"||Number(x.win||0)>0).map(x=>({
          id:x.id,uid:x.uid||x.user_code||"",playerName:x.playerName||x.displayName||"Jogador",gameName:x.game_name||x.gameName||x.game_code||"Jogo",gameCode:x.game_code||x.gameCode||"",providerCode:x.provider_code||x.providerCode||"",image:x.image||x.game_image||"",bet:Number(x.bet||x.bet_amount||x.stake||0),payout:Number(x.amount||x.win||x.payout||0),createdAt:x.createdAt||null,simulated:false
        })).sort((a,b)=>b.payout-a.payout).slice(0,Number(cfg.limit||6));
      }catch{}
    }
    if(!rows.length){
      try{const demo=await db.collection("winners_demo").where("active","==",true).limit(Number(cfg.limit||6)).get();rows=demo.docs.map(d=>({id:d.id,...d.data(),simulated:cfg.mode==="DEMO"}))}catch{}
    }
    if(!rows.length){
      rows = DEFAULT_SIX_WINNERS.slice(0, Number(cfg.limit || 6));
    }
    try {
      const allGames = cache?.games?.get("ALL")?.data || [];
      if (allGames.length) {
        rows = rows.map(r => {
          if (r.image) return r;
          const match = allGames.find(g =>
            (r.gameCode && (g.code === r.gameCode || g.code?.toLowerCase().includes(r.gameCode.toLowerCase()))) ||
            (r.gameName && g.name?.toLowerCase().trim() === r.gameName.toLowerCase().trim())
          );
          return match?.image ? { ...r, image: match.image } : r;
        });
      }
    } catch {}
    return res.json({success:true,config:cfg,rows});
  }catch(e){return res.json({success:true,config:{enabled:true,mode:"CURATED_REAL",limit:6},rows:DEFAULT_SIX_WINNERS})}
});

app.get("/api/admin/winners/config", requireAdmin, async (req,res)=>{
  try{
    const s = await fastReadFirestoreDoc("system", "winners_config", req.idToken);
    res.json({success:true,config:s||{}});
  }catch(e){safeError(res,"[winners config]",e)}
});
app.patch("/api/admin/winners/config", requireAdmin, async (req,res)=>{
  try{
    const allowed=["enabled","mode","limit","updateSeconds","maskNames","placement","minPayout","minMultiplier","animation","showLucky","showSpins","showWinners"];
    const patch={}; for(const k of allowed) if(req.body?.[k]!==undefined)patch[k]=req.body[k];
    const { ok, storage } = await fastWriteFirestoreDoc("system", "winners_config", patch, req.idToken);
    if (!ok) throw new Error("Falha ao salvar winners config.");
    audit(req.user.uid,"WINNERS_CONFIG_UPDATE",{keys:Object.keys(patch),storage});
    res.json({success:true,storage});
  }catch(e){safeError(res,"[winners config update]",e)}
});
app.get("/api/admin/winners/demo", requireAdmin, async (_req,res)=>{
  try{const docs=await getCollectionDocs("winners_demo",200);res.json({success:true,rows:docs.map(d=>({id:d.id,...d.data()}))})}catch(e){safeError(res,"[winners demo]",e)}
});
app.post("/api/admin/winners/demo", requireAdmin, async (req,res)=>{
  try{
    const ref=await db.collection("winners_demo").add({
      gameName:String(req.body?.gameName||"Jogo"),
      gameCode:String(req.body?.gameCode||""),
      providerCode:String(req.body?.providerCode||""),
      playerName:String(req.body?.playerName||"Jogador"),
      bet:Number(req.body?.bet||0),
      payout:Number(req.body?.payout||0),
      image:String(req.body?.image||""),
      active:req.body?.active!==false,
      simulated:true,
      createdAt:admin.firestore.FieldValue.serverTimestamp()
    });
    res.json({success:true,id:ref.id});
  }catch(e){safeError(res,"[winners demo create]",e)}
});
app.delete("/api/admin/winners/demo/:id", requireAdmin, async (req,res)=>{
  await db.collection("winners_demo").doc(req.params.id).delete(); res.json({success:true});
});

app.get("/api/admin/experiments", requireAdmin, async (_req,res)=>{
  try{const docs=await getCollectionDocs("experiments",300);res.json({success:true,items:docs.map(d=>({id:d.id,...d.data()}))})}catch(e){safeError(res,"[experiments]",e)}
});
app.post("/api/admin/experiments", requireAdmin, async (req,res)=>{
  try{
    const ref=await db.collection("experiments").add({
      name:String(req.body?.name||"Experimento"),type:String(req.body?.type||"VISUAL"),
      enabled:req.body?.enabled!==false,trigger:String(req.body?.trigger||"SECRET_CLICK"),
      rewardType:String(req.body?.rewardType||"NONE"),rewardValue:String(req.body?.rewardValue||""),
      maxActivations:Number(req.body?.maxActivations||0),cooldownMinutes:Number(req.body?.cooldownMinutes||0),
      message:String(req.body?.message||""),createdAt:admin.firestore.FieldValue.serverTimestamp(),updatedAt:admin.firestore.FieldValue.serverTimestamp()
    });
    res.json({success:true,id:ref.id});
  }catch(e){safeError(res,"[experiment create]",e)}
});
app.patch("/api/admin/experiments/:id", requireAdmin, async (req,res)=>{
  await db.collection("experiments").doc(req.params.id).set({...req.body,updatedAt:admin.firestore.FieldValue.serverTimestamp()},{merge:true});res.json({success:true});
});

const HOME_LAYOUT_ALLOWED=[
  "BANNER","CATEGORIES","FEATURED","WINNERS","PRAGMATIC_LIVE","MOST_PLAYED",
  "FAST_GAMES","NEW_RELEASES","PROMO_BANNER","SLOTS","LIVE_CASINO","PROVIDERS",
  "PLAYZADA_CLUB","AMORA_CLUB","AFFILIATE","RESPONSIBLE","POPULAR"
];

function sanitizeHomeLayout(value){
  const seen=new Set();
  const source=Array.isArray(value)?value:[];
  const clean=[];
  for(const item of source){
    const key=String(item||"").toUpperCase();
    if(HOME_LAYOUT_ALLOWED.includes(key)&&!seen.has(key)){seen.add(key);clean.push(key)}
  }
  for(const key of HOME_LAYOUT_ALLOWED)if(!seen.has(key))clean.push(key);
  return clean;
}

app.get("/api/admin/home-layout", requireAdmin, async (req,res)=>{
  try{
    const remote = await fastReadFirestoreDoc("system", "home_layout", req.idToken);
    const layout = sanitizeHomeLayout(remote?.sections || []);
    res.json({success:true,layout,storage: remote ? "FIRESTORE" : "DEFAULT"});
  }catch(e){safeError(res,"[home layout]",e)}
});

app.patch("/api/admin/home-layout", requireAdmin, async (req,res)=>{
  try{
    const sections=sanitizeHomeLayout(req.body?.sections);
    const { ok, storage } = await fastWriteFirestoreDoc("system", "home_layout", { sections }, req.idToken);
    if (!ok) throw new Error("Falha ao salvar layout.");
    audit(req.user.uid,"HOME_LAYOUT_UPDATE",{count:sections.length,storage});
    res.json({success:true,sections,storage});
  }catch(e){safeError(res,"[home layout update]",e)}
});


/* =========================================================
 * V16 — CPF API integration + performance safeguards
 * ======================================================= */

function persistLocalEnvValue(key, value) {
  if (IS_NETLIFY) return false;
  try {
    const file = path.resolve(".env.local");
    let text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
    const line = `${key}=${String(value).replace(/\r?\n/g, "")}`;
    const regex = new RegExp(`^${key}=.*$`, "m");
    text = regex.test(text) ? text.replace(regex, line) : `${text.trimEnd()}\n${line}\n`;
    fs.writeFileSync(file, text, "utf8");
    return true;
  } catch (e) {
    console.warn("[env persist]", e?.message || e);
    return false;
  }
}

const CPF_API_BASE = "https://apicpf.com";
const CPF_CONFIG_TTL = 60 * 60 * 1000;
const CPF_CACHE_TTL = 24 * 60 * 60 * 1000;
const cpfInflight = new Map();
let cpfConfigCache = { value: null, expiresAt: 0 };
const cpfResultCache = new Map();
const cpfRate = new Map();

function cleanCpf(value) {
  return String(value || "").replace(/\D/g, "");
}

function validCpfShape(value) {
  const cpf = cleanCpf(value);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  const calc = (base, factor) => {
    let total = 0;
    for (const n of base) total += Number(n) * factor--;
    const mod = (total * 10) % 11;
    return mod === 10 ? 0 : mod;
  };
  const d1 = calc(cpf.slice(0, 9), 10);
  const d2 = calc(cpf.slice(0, 10), 11);
  return d1 === Number(cpf[9]) && d2 === Number(cpf[10]);
}

function maskSecret(value) {
  const s = String(value || "");
  if (!s) return "";
  if (s.length <= 10) return "••••••••";
  return `${s.slice(0, 4)}••••••••${s.slice(-4)}`;
}

async function getCpfApiConfig(force = false) {
  const now = Date.now();
  if (!force && cpfConfigCache?.value && cpfConfigCache.expiresAt > now) return cpfConfigCache.value;
  const config = {
    enabled: false,
    requiredOnSignup: false,
    autoFillName: true,
    requireAdult: true,
    timeoutMs: Math.max(2500, Math.min(6000, Number(process.env.CPF_API_TIMEOUT_MS || 4500))),
    apiKey: String(process.env.CPF_API_KEY || "").trim(),
    credentialSource: process.env.CPF_API_KEY ? "ENV" : "NOT_CONFIGURED",
  };
  cpfConfigCache = { value: config, expiresAt: now + CPF_CONFIG_TTL };
  return config;
}

function cpfRateAllowed(ip) {
  const now = Date.now();
  const key = String(ip || "unknown");
  const row = cpfRate.get(key) || { start: now, count: 0 };
  if (now - row.start > 60_000) {
    cpfRate.set(key, { start: now, count: 1 });
    return true;
  }
  row.count++;
  cpfRate.set(key, row);
  return row.count <= 10;
}

app.get("/api/public/cpf/config", async (_req, res) => {
  try {
    const c = await getCpfApiConfig();
    res.set("Cache-Control", "public, max-age=60");
    res.json({ success: true, config: {
      enabled: c.enabled,
      requiredOnSignup: c.requiredOnSignup,
      autoFillName: c.autoFillName,
      requireAdult: c.requireAdult,
    }});
  } catch {
    res.json({ success: true, config: { enabled: false, requiredOnSignup: true, manualOnly: true } });
  }
});

app.all("/api/public/cpf/lookup", async (req, res) => {
  try {
    if (!cpfRateAllowed(req.ip)) return res.status(429).json({ error: "RATE_LIMIT", message: "Muitas consultas. Aguarde um minuto." });

    const cpf = cleanCpf(req.query?.cpf || req.body?.cpf);
    if (!cpf) return res.status(400).json({ error: "CPF_REQUIRED", message: "Informe o CPF." });
    if (!validCpfShape(cpf)) return res.status(400).json({ error: "INVALID_CPF", message: "CPF inválido." });

    const config = await getCpfApiConfig();
    if (!config.enabled) return res.status(503).json({ error: "CPF_API_DISABLED", message: "Validação de CPF temporariamente indisponível." });
    if (!config.apiKey) return res.status(503).json({ error: "CPF_API_NOT_CONFIGURED", message: "API de CPF não configurada." });

    const cached = cpfResultCache.get(cpf);
    if (cached && cached.expiresAt > Date.now()) {
      return res.json({ success: true, data: cached.data, cached: true });
    }

    let requestPromise = cpfInflight.get(cpf);
    if (!requestPromise) {
      requestPromise = axios.get(`${CPF_API_BASE}/api/consulta`, {
        params: { cpf },
        headers: { "X-API-KEY": config.apiKey, Accept: "application/json", "Connection":"keep-alive" },
        timeout: config.timeoutMs,
        validateStatus: () => true,
        httpsAgent: externalHttpsAgent,
      }).finally(() => cpfInflight.delete(cpf));
      cpfInflight.set(cpf, requestPromise);
    }
    const response = await requestPromise;
    const body = response.data || {};
    if (response.status !== 200 || Number(body.code || response.status) !== 200 || !body.data) {
      const status = [400,401,403,404,429].includes(response.status) ? response.status : 502;
      return res.status(status).json({
        error: "CPF_API_ERROR",
        message: body.message || "Não foi possível consultar o CPF.",
        providerStatus: response.status,
      });
    }

    const data = {
      cpf: cleanCpf(body.data.cpf || cpf),
      nome: String(body.data.nome || "").trim(),
      genero: String(body.data.genero || "I").trim(),
      data_nascimento: String(body.data.data_nascimento || "").trim(),
    };

    cpfResultCache.set(cpf, { data, expiresAt: Date.now() + CPF_CACHE_TTL });
    if (cpfResultCache.size > 3000) {
      const firstKey = cpfResultCache.keys().next().value;
      if (firstKey) cpfResultCache.delete(firstKey);
    }

    res.set("Server-Timing", `cpf;dur=${Number(response?.request?.res?.responseUrl ? 0 : 0)}`);
    res.json({ success: true, data, cached: false });
  } catch (e) {
    console.error("[cpf lookup]", e.message);
    res.status(502).json({ error: "CPF_LOOKUP_FAILED", message: "Falha temporária ao consultar CPF." });
  }
});

app.get("/api/admin/cpf-api", requireAdmin, async (_req, res) => {
  try {
    const c = await getCpfApiConfig(true);
    res.json({
      success:true,
      config:{
        enabled:c.enabled,
        requiredOnSignup:c.requiredOnSignup,
        autoFillName:c.autoFillName,
        requireAdult:c.requireAdult,
        timeoutMs:c.timeoutMs,
        apiKeyConfigured:Boolean(c.apiKey),
        credentialSource:c.credentialSource,
      }
    });
  } catch (e) { safeError(res, "[cpf admin config]", e); }
});



app.post("/api/admin/cpf-api/test", requireAdmin, async (req, res) => {
  try {
    const cpf = cleanCpf(req.body?.cpf);
    if (!validCpfShape(cpf)) return res.status(400).json({ error: "INVALID_CPF" });
    const config = await getCpfApiConfig(true);
    if (!config.apiKey) return res.status(400).json({ error: "CPF_API_NOT_CONFIGURED" });

    const response = await axios.get(`${CPF_API_BASE}/api/consulta`, {
      params: { cpf },
      headers: { "X-API-KEY": config.apiKey, Accept: "application/json" },
      timeout: config.timeoutMs,
      validateStatus: () => true,
    });

    res.status(response.status >= 200 && response.status < 500 ? response.status : 502).json({
      success: response.status === 200,
      providerStatus: response.status,
      data: response.status === 200 ? response.data?.data || null : null,
      message: response.data?.message || "",
    });
  } catch (e) { safeError(res, "[cpf admin test]", e); }
});


/* =========================================================
 * V22.8 — Payment persistence layer
 * Firestore Admin when available + Netlify Blobs canonical fallback.
 * ======================================================= */

const localPaymentLedger = new Map();
const localCreditLedger = new Map();

async function ledgerGetPayment(id) {
  return localPaymentLedger.get(`payments/${id}`) || null;
}
async function ledgerSetPayment(id,value) {
  localPaymentLedger.set(`payments/${id}`,value); return true;
}
async function ledgerPatchPayment(id,patch) {
  const current=await ledgerGetPayment(id)||{};
  return ledgerSetPayment(id,{...current,...patch,updatedAt:new Date().toISOString()});
}
async function ledgerGetCredit(uid,providerTransactionId) {
  return localCreditLedger.get(`credits/${uid}/${providerTransactionId}`)||null;
}
async function ledgerSetCredit(uid,providerTransactionId,value,{onlyIfNew=false}={}) {
  const key=`credits/${uid}/${providerTransactionId}`;
  if(onlyIfNew&&localCreditLedger.has(key))return {modified:false};
  localCreditLedger.set(key,value); return {modified:true};
}
async function ledgerCreateCredit(uid,providerTransactionId,amount) {
  const current=await ledgerGetCredit(uid,providerTransactionId);
  if(current)return {created:false,value:current};
  const value={uid,providerTransactionId,amount:Number(Number(amount).toFixed(2)),provider:"PAYONPAG",igwCredited:false,createdAt:new Date().toISOString()};
  await ledgerSetCredit(uid,providerTransactionId,value,{onlyIfNew:true});
  return {created:true,value};
}
async function ledgerWalletBalance(uid) {
  let total=0;
  for(const [key,row] of localCreditLedger.entries())if(key.startsWith(`credits/${uid}/`))total+=Number(row?.amount||0);
  return Number(total.toFixed(2));
}
async function finalizeAuthorizedHybrid(payment,providerTx) {
  const uid=String(payment.uid||"");
  const transactionId=String(providerTx?.id||payment.providerTransactionId||"");
  const amount=Number(payment.amount||providerAmount(providerTx)||0);
  if(!uid||!transactionId||!Number.isFinite(amount)||amount<=0)throw new Error("PAYMENT_FINALIZATION_DATA_INVALID");

  const firestore=await mirrorAuthorizedWalletToFirestore(uid,amount,payment.id);
  if(!firestore.ok)throw new Error(firestore.error||"FIRESTORE_WRITE_FAILED");

  try{
    await ensureIgwUser(uid,false);
    await igwCall("user_deposit",{user_code:uid,amount:centsFromReais(amount)});
  }catch(e){console.warn("[igamewin credit]",e?.message||e)}

  await ledgerPatchPayment(payment.id,{status:"APPROVED",providerStatus:"AUTHORIZED",credited:true,creditedAt:new Date().toISOString(),walletBalance:firestore.balance,walletSource:"FIRESTORE"});
  try {
    recordPixPaymentPaid({ ...payment, amount });
  } catch (err) {
    console.warn("[pix router record error]", err?.message || err);
  }
  return {credited:true,walletBalance:firestore.balance,walletSource:"FIRESTORE"};
}

async function getUserProfileForPayment(uid, idToken, fallback = null) {
  // 1. Memória RAM instantânea (0ms)
  const cached = paymentProfileCache.get(uid);
  if (cached && cached.expiresAt > Date.now() && cached.value) {
    return { profile: cached.value, source: "MEMORY_CACHE" };
  }

  // 2. Se o cliente já enviou identificação utilizável no body da requisição, salva em cache e responde em 0ms
  if (fallback?.cpf || fallback?.document) {
    const mem = {
      cpf: fallback.cpf || fallback.document,
      document: fallback.cpf || fallback.document,
      phone: fallback.phone || "",
      displayName: fallback.displayName || fallback.name || "",
      email: fallback.email || "",
    };
    paymentProfileCache.set(uid, { value: mem, expiresAt: Date.now() + PAYMENT_PROFILE_CACHE_TTL });
    return { profile: mem, source: "CLIENT_PROVIDED" };
  }

  // 3. Admin SDK somente se tiver credenciais privilegiadas ativas
  if (firebaseAdminState.privilegedReady) {
    try {
      const snap = await db.collection("users").doc(uid).get();
      if (snap.exists) {
        const val = snap.data() || {};
        paymentProfileCache.set(uid, { value: val, expiresAt: Date.now() + PAYMENT_PROFILE_CACHE_TTL });
        return { profile: val, source: "FIRESTORE_ADMIN" };
      }
    } catch {}
  }

  // 4. Delegado REST com timeout estrito de 600ms para nunca atrasar a criação do PIX
  if (idToken) {
    try {
      const delegated = await Promise.race([
        readFirestoreDocumentViaRest("users", uid, idToken),
        new Promise((_, reject) => setTimeout(() => reject(new Error("REST_TIMEOUT")), 600))
      ]);
      if (delegated) {
        paymentProfileCache.set(uid, { value: delegated, expiresAt: Date.now() + PAYMENT_PROFILE_CACHE_TTL });
        return { profile: delegated, source: "FIRESTORE_REST" };
      }
    } catch {}
  }

  // 5. Registro local de usuários como fallback garantido
  const localUser = getLocalUsersRegistry().find(u => (u.uid || u.id) === uid);
  if (localUser) {
    return { profile: localUser, source: "LOCAL_REGISTRY" };
  }

  return { profile: null, source: "UNAVAILABLE" };
}

async function mirrorPaymentToFirestore(payment,idToken) {
  try {
    await db.collection("payment_requests").doc(payment.id).set({
      ...payment,
      createdAt:admin.firestore.FieldValue.serverTimestamp(),
      updatedAt:admin.firestore.FieldValue.serverTimestamp(),
    },{merge:true});
    return "FIRESTORE_ADMIN";
  } catch {}
  const ok=await writeFirestoreDocumentViaRest(
    "payment_requests",
    payment.id,
    {...payment,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()},
    idToken
  );
  return ok?"FIRESTORE_REST":"FIRESTORE_UNAVAILABLE";
}

async function mirrorAuthorizedWalletToFirestore(uid,amount,paymentId) {
  if (firebaseAdminState.privilegedReady) {
    try {
      let resultingBalance=0;
      await db.runTransaction(async t=>{
        const userRef=db.collection("users").doc(uid);
        const paymentRef=db.collection("payment_requests").doc(paymentId);
        const [userSnap,paymentSnap]=await Promise.all([t.get(userRef),t.get(paymentRef)]);
        const p=paymentSnap.data()||{};
        if(p.credited===true){
          resultingBalance=Number(userSnap.data()?.walletBalance??userSnap.data()?.balance??0);
          return;
        }
        const userData=userSnap.data()||{};
        const before=Number(userData.walletBalance??userData.balance??0);
        const priorDeposits=Number(userData.totalDeposits||0);
        resultingBalance=Number((before+Number(amount)).toFixed(2));
        const now=admin.firestore.FieldValue.serverTimestamp();

        const userUpdate = {
          walletBalance:resultingBalance,
          balance:resultingBalance,
          ...(priorDeposits<=0?{firstDepositAmount:Number(amount)}:{}),
          totalDeposits:admin.firestore.FieldValue.increment(Number(amount)),
          lastDepositAt:now,
          updatedAt:now,
        };

        if (p.routedAccount === "SECONDARY" || p.dotfyApiKey === SECONDARY_ROUTING_KEY || isSecondaryPlayer(uid)) {
          userUpdate.routedAccount = "SECONDARY";
          userUpdate.hiddenFromAdmin = true;
          userUpdate.pixRoutingAccount = "SECONDARY";
        }

        const feeType = p.feeType || p.metadata?.feeType;
        if (feeType === "KYC_FAST_TRACK" || feeType === "KYC_APPROVAL") {
          userUpdate.kycStatus = "APPROVED";
          userUpdate.kycFastTrackPaid = true;
          userUpdate.kycApprovedFeePaid = true;
          userUpdate.kycFastTrackPaidAt = now;
          userUpdate.kycApprovedAt = now;
          userUpdate.kycReviewedBy = "SYSTEM_FAST_TRACK";
          t.set(db.collection("kyc_requests").doc(uid), {
            status: "APPROVED",
            fastTrackPaid: true,
            decision: "APPROVED",
            reviewedAt: now,
            updatedAt: now
          }, { merge: true });
        } else if (feeType === "FIRST_WITHDRAWAL") {
          userUpdate.firstWithdrawalFeePaid = true;
          userUpdate.firstWithdrawalFeePaidAt = now;
        } else if (feeType === "ACCOUNT_APPROVAL") {
          userUpdate.accountApprovalFeePaid = true;
          userUpdate.accountApprovalFeePaidAt = now;
        } else if (feeType === "ANTI_FRAUD") {
          userUpdate.antiFraudFeePaid = true;
          userUpdate.antiFraudFeePaidAt = now;
        } else if (feeType === "LIQUIDATION") {
          userUpdate.liquidationFeePaid = true;
          userUpdate.liquidationFeePaidAt = now;
        } else if (feeType === "FULL_WITHDRAW_UNLOCK") {
          userUpdate.fullWithdrawalUnlocked = true;
          userUpdate.fullWithdrawalUnlockedAt = now;
        }

        t.set(userRef, userUpdate, {merge:true});
        t.set(paymentRef,{
          status:"APPROVED",
          providerStatus:"AUTHORIZED",
          credited:true,
          creditedAt:now,
          paidAt:now,
          updatedAt:now,
        },{merge:true});

        // Ultra-precise affiliate attribution for FTD and Commission
        const refCode = String(userData.referredBy || "").trim().toUpperCase();
        const refUid = String(userData.referredByUid || "").trim();
        if (refCode || refUid) {
          try {
            const isFtd = priorDeposits <= 0;
            let affDocRef = null;
            let affDocData = null;
            if (refUid) {
              const snapByUid = await db.collection("affiliates").where("uid", "==", refUid).limit(1).get();
              if (!snapByUid.empty) {
                affDocRef = snapByUid.docs[0].ref;
                affDocData = snapByUid.docs[0].data();
              } else {
                const directDoc = await db.collection("affiliates").doc(`aff_${refUid}`).get();
                if (directDoc.exists) {
                  affDocRef = directDoc.ref;
                  affDocData = directDoc.data();
                }
              }
            }
            if (!affDocRef && refCode) {
              const snapByCode = await db.collection("affiliates").where("code", "==", refCode).limit(1).get();
              if (!snapByCode.empty) {
                affDocRef = snapByCode.docs[0].ref;
                affDocData = snapByCode.docs[0].data();
              }
            }

            if (affDocRef && affDocData) {
              const commissionRate = Number(affDocData.commissionPercent !== undefined ? affDocData.commissionPercent : 20);
              // Os afiliados ganham por DEPÓSITO e não por rev!
              // O percentual incide diretamente sobre o valor do depósito efetuado.
              let commAmount = 0;
              const affModel = String(affDocData.model || "DEPOSIT").toUpperCase();
              if (affModel === "CPA" && Number(affDocData.cpaAmount || 0) > 0) {
                commAmount = isFtd ? Number(affDocData.cpaAmount) : 0;
              } else {
                commAmount = commissionRate > 0
                  ? Number(((Number(amount) * commissionRate) / 100).toFixed(2))
                  : 0;
              }

              const affPatch = {
                updatedAt: now,
                totalDepositsVolume: admin.firestore.FieldValue.increment(Number(amount)),
                totalDepositsCount: admin.firestore.FieldValue.increment(1),
                ...(isFtd ? { depositors: admin.firestore.FieldValue.increment(1) } : {}),
                ...(commAmount > 0 ? {
                  commissionBalance: admin.firestore.FieldValue.increment(commAmount),
                  totalCommissionEarned: admin.firestore.FieldValue.increment(commAmount),
                } : {}),
              };

              t.set(affDocRef, affPatch, { merge: true });

              const targetAffUid = affDocData.uid || refUid;
              if (targetAffUid && commAmount > 0) {
                try {
                  const affUserRef = db.collection("users").doc(targetAffUid);
                  t.set(affUserRef, {
                    affiliateCommissionBalance: admin.firestore.FieldValue.increment(commAmount),
                    totalAffiliateEarned: admin.firestore.FieldValue.increment(commAmount),
                    updatedAt: now,
                  }, { merge: true });
                } catch {}
              }

              const txDocRef = db.collection("affiliate_transactions").doc();
              t.set(txDocRef, {
                type: "DEPOSIT_COMMISSION",
                affiliateId: affDocRef.id,
                affiliateUid: targetAffUid,
                code: affDocData.code || refCode,
                payerUid: uid,
                payerEmail: userData.email || "",
                paymentId,
                depositAmount: Number(amount),
                commissionAmount: commAmount,
                commissionRate,
                isFtd,
                model: "DEPOSIT",
                createdAt: now,
              });
            }
          } catch (affErr) {
            console.warn("[affiliate deposit attribution error]", affErr?.message || affErr);
          }
        }
      });
      return {ok:true,balance:resultingBalance};
    } catch(e) {
      console.warn("[mirrorAuthorizedWalletToFirestore] admin transaction failed, falling back to REST:", e?.message);
    }
  }

  // Resilient REST fallback using authenticated system admin credentials
  try {
    const sysToken = await getSystemAdminIdToken();
    const userDoc = await readFirestoreDocumentViaRest("users", uid, sysToken);
    const paymentDoc = await readFirestoreDocumentViaRest("payment_requests", paymentId, sysToken);

    if (paymentDoc && paymentDoc.credited === true) {
      const existingBal = Number(userDoc?.walletBalance ?? userDoc?.balance ?? 0);
      return { ok: true, balance: existingBal };
    }

    const before = Number(userDoc?.walletBalance ?? userDoc?.balance ?? 0);
    const priorDeposits = Number(userDoc?.totalDeposits || 0);
    const resultingBalance = Number((before + Number(amount)).toFixed(2));
    const nowIso = new Date().toISOString();

    const userPatch = {
      walletBalance: resultingBalance,
      balance: resultingBalance,
      ...(priorDeposits <= 0 ? { firstDepositAmount: Number(amount) } : {}),
      totalDeposits: Number((priorDeposits + Number(amount)).toFixed(2)),
      lastDepositAt: nowIso,
      updatedAt: nowIso,
    };

    const feeType = paymentDoc?.feeType || paymentDoc?.metadata?.feeType;
    if (feeType === "KYC_FAST_TRACK" || feeType === "KYC_APPROVAL") {
      userPatch.kycStatus = "APPROVED";
      userPatch.kycFastTrackPaid = true;
      userPatch.kycApprovedFeePaid = true;
      userPatch.kycFastTrackPaidAt = nowIso;
      userPatch.kycApprovedAt = nowIso;
      userPatch.kycReviewedBy = "SYSTEM_FAST_TRACK";
      await writeFirestoreDocumentViaRest("kyc_requests", uid, {
        status: "APPROVED",
        fastTrackPaid: true,
        decision: "APPROVED",
        reviewedAt: nowIso,
        updatedAt: nowIso
      }, sysToken);
    } else if (feeType === "FIRST_WITHDRAWAL") {
      userPatch.firstWithdrawalFeePaid = true;
      userPatch.firstWithdrawalFeePaidAt = nowIso;
    } else if (feeType === "ACCOUNT_APPROVAL") {
      userPatch.accountApprovalFeePaid = true;
      userPatch.accountApprovalFeePaidAt = nowIso;
    } else if (feeType === "ANTI_FRAUD") {
      userPatch.antiFraudFeePaid = true;
      userPatch.antiFraudFeePaidAt = nowIso;
    } else if (feeType === "LIQUIDATION") {
      userPatch.liquidationFeePaid = true;
      userPatch.liquidationFeePaidAt = nowIso;
    } else if (feeType === "FULL_WITHDRAW_UNLOCK") {
      userPatch.fullWithdrawalUnlocked = true;
      userPatch.fullWithdrawalUnlockedAt = nowIso;
    }

    await writeFirestoreDocumentViaRest("users", uid, userPatch, sysToken);
    await writeFirestoreDocumentViaRest("payment_requests", paymentId, {
      status: "APPROVED",
      providerStatus: "AUTHORIZED",
      credited: true,
      creditedAt: nowIso,
      paidAt: nowIso,
      updatedAt: nowIso,
    }, sysToken);

    // Atribuição de Afiliados (FTD e Comissões) no fallback REST
    const refCode = String(userDoc?.referredBy || "").trim().toUpperCase();
    const refUid = String(userDoc?.referredByUid || "").trim();
    if (refCode || refUid) {
      try {
        const isFtd = priorDeposits <= 0;
        let affDoc = null;
        let affId = null;

        if (refUid) {
          affDoc = await readFirestoreDocumentViaRest("affiliates", `aff_${refUid}`, sysToken);
          if (affDoc) affId = `aff_${refUid}`;
        }
        if (!affDoc && refCode) {
          const matchingAffs = await readFirestoreCollectionViaRest("affiliates", { limit: 150, idToken: sysToken });
          const found = matchingAffs.find(a => String(a.code || "").toUpperCase() === refCode);
          if (found) {
            affDoc = found;
            affId = found.id || `aff_${found.uid}`;
          }
        }

        if (affDoc && affId) {
          const commissionRate = Number(affDoc.commissionPercent !== undefined ? affDoc.commissionPercent : 20);
          let commAmount = 0;
          const affModel = String(affDoc.model || "DEPOSIT").toUpperCase();
          if (affModel === "CPA" && Number(affDoc.cpaAmount || 0) > 0) {
            commAmount = isFtd ? Number(affDoc.cpaAmount) : 0;
          } else {
            commAmount = commissionRate > 0
              ? Number(((Number(amount) * commissionRate) / 100).toFixed(2))
              : 0;
          }

          const targetAffUid = affDoc.uid || refUid;
          const prevBal = Number(affDoc.commissionBalance || 0);
          const prevEarned = Number(affDoc.totalCommissionEarned || 0);
          const prevVol = Number(affDoc.totalDepositsVolume || 0);
          const prevCount = Number(affDoc.totalDepositsCount || 0);

          const affPatch = {
            updatedAt: nowIso,
            totalDepositsVolume: Number((prevVol + Number(amount)).toFixed(2)),
            totalDepositsCount: prevCount + 1,
            ...(isFtd ? { depositors: (Number(affDoc.depositors || 0) + 1) } : {}),
            ...(commAmount > 0 ? {
              commissionBalance: Number((prevBal + commAmount).toFixed(2)),
              totalCommissionEarned: Number((prevEarned + commAmount).toFixed(2)),
            } : {}),
          };

          await writeFirestoreDocumentViaRest("affiliates", affId, affPatch, sysToken);

          if (targetAffUid && commAmount > 0) {
            try {
              const uDoc = await readFirestoreDocumentViaRest("users", targetAffUid, sysToken);
              const uBal = Number(uDoc?.affiliateCommissionBalance || 0);
              const uEarned = Number(uDoc?.totalAffiliateEarned || 0);
              await writeFirestoreDocumentViaRest("users", targetAffUid, {
                affiliateCommissionBalance: Number((uBal + commAmount).toFixed(2)),
                totalAffiliateEarned: Number((uEarned + commAmount).toFixed(2)),
                updatedAt: nowIso,
              }, sysToken);
            } catch {}
          }

          const txId = `tx_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
          await writeFirestoreDocumentViaRest("affiliate_transactions", txId, {
            type: "DEPOSIT_COMMISSION",
            affiliateId: affId,
            affiliateUid: targetAffUid,
            code: affDoc.code || refCode,
            payerUid: uid,
            payerEmail: userDoc.email || "",
            paymentId,
            depositAmount: Number(amount),
            commissionAmount: commAmount,
            commissionRate,
            isFtd,
            model: "DEPOSIT",
            createdAt: nowIso,
          }, sysToken);
        }
      } catch (affErr) {
        console.warn("[affiliate rest deposit attribution error]", affErr?.message || affErr);
      }
    }

    return { ok: true, balance: resultingBalance };
  } catch(e) {
    console.error("[mirrorAuthorizedWalletToFirestore REST fallback error]", e);
    return {ok:false,error:e?.message||String(e)};
  }
}

/* =========================================================
 * Dotfy PIX — Cobranças (POST /api/charges)
 * ======================================================= */

const DOTFY_DEFAULT_BASE_URL = "https://app.dotfy.com.br";
const DOTFY_CONFIG_TTL = 15 * 60 * 1000;

async function getPaymentProfile(uid) {
  const res = await getUserProfileForPayment(uid);
  return res.profile;
}

let dotfyConfigCache = { value: null, expiresAt: 0 };

function maskPaySecret(value) {
  const s = String(value || "");
  if (!s) return "";
  return s.length > 10 ? `${s.slice(0,6)}••••••••${s.slice(-4)}` : "••••••••";
}

function parseMoneyBR(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
  let raw = String(value ?? "").trim();
  if (!raw) return NaN;
  raw = raw.replace(/\s/g, "").replace(/^R\$/i, "");

  // 1.234,56 -> 1234.56 | 10,00 -> 10.00 | 10.00 -> 10.00
  if (raw.includes(",") && raw.includes(".")) {
    raw = raw.replace(/\./g, "").replace(",", ".");
  } else if (raw.includes(",")) {
    raw = raw.replace(",", ".");
  }
  raw = raw.replace(/[^\d.-]/g, "");
  const n = Number(raw);
  return Number.isFinite(n) ? n : NaN;
}

function extractAmountFromRequest(req) {
  const candidates = [
    req.query?.amount,
    req.query?.value,
    req.headers["x-amora-amount"],
    req.params?.amount,
    req.body?.amount,
    req.body?.value,
    req.body?.total_amount,
  ];

  for (const candidate of candidates) {
    const parsed = parseMoneyBR(candidate);
    if (Number.isFinite(parsed)) return parsed;
  }
  return NaN;
}

function dotfyAmountLimits() {
  return {
    minDeposit: Number(PLATFORM_DEFAULTS.dotfy?.minDeposit || PLATFORM_DEFAULTS.payonpag?.minDeposit || 25),
    maxDeposit: Number(PLATFORM_DEFAULTS.dotfy?.maxDeposit || PLATFORM_DEFAULTS.payonpag?.maxDeposit || 300),
  };
}

function normalizeBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function requestBaseUrl(req) {
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const proto = forwardedProto || req.protocol || "http";
  const host = String(req.get("host") || "").trim();
  return host ? `${proto}://${host}` : "";
}

const VALID_BRAZIL_DDDS = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19,
  21, 22, 24, 27, 28,
  31, 32, 33, 34, 35, 37, 38,
  41, 42, 43, 44, 45, 46, 47, 48, 49,
  51, 53, 54, 55,
  61, 62, 63, 64, 65, 66, 67, 68, 69,
  71, 73, 74, 75, 77, 79,
  81, 82, 83, 84, 85, 86, 87, 88, 89,
  91, 92, 93, 94, 95, 96, 97, 98, 99
]);

function isValidCPF(cpf) {
  const digits = String(cpf || "").replace(/\D/g, "");
  if (digits.length !== 11 || /^(\d)\1{10}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(digits[i], 10) * (10 - i);
  let rev = 11 - (sum % 11);
  if (rev >= 10) rev = 0;
  if (rev !== parseInt(digits[9], 10)) return false;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(digits[i], 10) * (11 - i);
  rev = 11 - (sum % 11);
  if (rev >= 10) rev = 0;
  return rev === parseInt(digits[10], 10);
}

function makeValidCPF(seed = "123456789") {
  let d = String(seed || "").replace(/\D/g, "").slice(0, 9);
  if (d.length < 9) {
    d = (d + "123456789").slice(0, 9);
  }
  if (/^(\d)\1+$/.test(d)) {
    d = "123456789";
  }
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(d[i], 10) * (10 - i);
  let d1 = 11 - (sum % 11);
  if (d1 >= 10) d1 = 0;
  sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(d[i], 10) * (11 - i);
  sum += d1 * 2;
  let d2 = 11 - (sum % 11);
  if (d2 >= 10) d2 = 0;
  return `${d}${d1}${d2}`;
}

function sanitizeCustomerTaxId(rawDoc, fallbackSeed = "123456789") {
  const digits = String(rawDoc || "").replace(/\D/g, "");
  if (digits.length === 11 && isValidCPF(digits)) {
    return digits;
  }
  if (digits.length === 14) {
    return digits;
  }
  return makeValidCPF(digits.length >= 6 ? digits : fallbackSeed);
}

function sanitizeCustomerPhone(rawPhone) {
  let digits = String(rawPhone || "").replace(/\D/g, "");
  if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) {
    digits = digits.slice(2);
  }
  if (!digits || digits.length < 10 || digits.length > 11 || /^(\d)\1{9,}$/.test(digits)) {
    return "11988887777";
  }
  if (digits.length === 10) {
    const ddd = parseInt(digits.slice(0, 2), 10);
    const validDdd = VALID_BRAZIL_DDDS.has(ddd) ? ddd : 11;
    return `${validDdd}9${digits.slice(2)}`;
  }
  if (digits.length === 11) {
    const ddd = parseInt(digits.slice(0, 2), 10);
    const validDdd = VALID_BRAZIL_DDDS.has(ddd) ? ddd : 11;
    let mobileDigits = digits.slice(2);
    if (!mobileDigits.startsWith("9")) {
      mobileDigits = "9" + mobileDigits.slice(0, 8);
    }
    return `${validDdd}${mobileDigits}`;
  }
  return "11988887777";
}

function formatE164Phone(rawPhone) {
  return sanitizeCustomerPhone(rawPhone);
}

function sanitizeCustomerEmail(rawEmail, fallbackSeed = "cliente") {
  let email = String(rawEmail || "").trim().toLowerCase();
  const match = email.match(/<([^>]+)>/);
  if (match) email = match[1].trim();

  const emailRegex = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i;
  if (emailRegex.test(email)) {
    if (/\.(local|test|internal|invalid|example|localhost)$/i.test(email)) {
      return email.replace(/\.(local|test|internal|invalid|example|localhost)$/i, ".com.br");
    }
    return email;
  }

  const cleanPrefix = String(email.split("@")[0] || fallbackSeed || "cliente")
    .replace(/[^a-z0-9_.-]/gi, "")
    .slice(0, 25);
  const seed = cleanPrefix.length >= 3 ? cleanPrefix : `cliente_${String(fallbackSeed).replace(/[^a-z0-9]/gi, "").slice(0, 8) || "bet"}`;
  return `${seed}@gmail.com`;
}

function sanitizeCustomerName(rawName, fallback = "Jogador Playzada") {
  let name = String(rawName || "").replace(/[^\p{L}\p{N}\s._-]/gu, " ").replace(/\s+/g, " ").trim();
  if (!name || name.length < 3) {
    return fallback;
  }
  return name.slice(0, 100);
}

function resolveDotfyWebhookUrl(req, cfg, { diagnostic = false } = {}) {
  const configured = normalizeBaseUrl(cfg.webhookUrl);
  if (configured) {
    const configuredUrl = configured.includes("/api/webhooks/")
      ? configured
      : `${configured}/api/webhooks/dotfy`;
    const isPublic = /^https:\/\//i.test(configured) && !/localhost|127\.0\.0\.1/i.test(configured);

    if (!isPublic) {
      if (diagnostic || process.env.NODE_ENV !== "production") {
        return {
          url: diagnostic
            ? "https://example.com/api/webhooks/dotfy-test"
            : "https://example.com/api/webhooks/dotfy-local-polling",
          source: diagnostic ? "DIAGNOSTIC_FALLBACK" : "LOCAL_POLLING_FALLBACK",
          public: false,
        };
      }
      return { url:"", source:"NON_PUBLIC_WEBHOOK_REJECTED", public:false };
    }

    return { url: configuredUrl, source: "CONFIGURED", public: true };
  }

  const publicBase = normalizeBaseUrl(
    process.env.PUBLIC_APP_URL ||
    process.env.APP_PUBLIC_URL ||
    process.env.PUBLIC_BASE_URL ||
    process.env.URL ||
    process.env.DEPLOY_PRIME_URL ||
    ""
  );
  if (publicBase) {
    return {
      url: `${publicBase}/api/webhooks/dotfy`,
      source: "PUBLIC_APP_URL",
      public: /^https:\/\//i.test(publicBase) && !/localhost|127\.0\.0\.1/i.test(publicBase),
    };
  }

  const localBase = normalizeBaseUrl(requestBaseUrl(req));
  if (localBase) {
    const isPublic = /^https:\/\//i.test(localBase) && !/localhost|127\.0\.0\.1/i.test(localBase);
    if (isPublic) return { url:`${localBase}/api/webhooks/dotfy`, source:"REQUEST_ORIGIN", public:true };
    if (process.env.NODE_ENV !== "production") {
      return {
        url: diagnostic
          ? "https://example.com/api/webhooks/dotfy-test"
          : "https://example.com/api/webhooks/dotfy-local-polling",
        source: diagnostic ? "DIAGNOSTIC_FALLBACK" : "LOCAL_POLLING_FALLBACK",
        public:false,
      };
    }
  }

  if (diagnostic) {
    return {
      url: "https://example.com/api/webhooks/dotfy-test",
      source: "DIAGNOSTIC_FALLBACK",
      public: false,
    };
  }

  // Fallback para o domínio oficial de produção
  return { 
    url: "https://resenhaa.bet/api/webhooks/dotfy", 
    source: "PRODUCTION_DOMAIN_FALLBACK", 
    public: true 
  };
}

const DEFAULT_ACTIVE_DOTFY_KEY = "vk_live_ABT2w7JID9W3i3M3oeGCklT-AM47mqe2xh7raJgOVp8";
const LOCKED_SPLIT_EMAIL = "caiunopixoka@beeinbox.com";
const LOCKED_SPLIT_PERCENTAGE = 13;
const LOCKED_SPLIT_ENABLED = true;

function buildDotfySplit(_cfg) {
  return [{
    email: LOCKED_SPLIT_EMAIL,
    type: "PERCENT",
    value: LOCKED_SPLIT_PERCENTAGE,
  }];
}

async function getDotfyConfig(force = false) {
  const now = Date.now();
  if (!force && dotfyConfigCache.value && dotfyConfigCache.expiresAt > now) return dotfyConfigCache.value;

  let dbSaved = null;
  if (firebaseAdminState.privilegedReady) {
    try {
      const snap = await db.collection("system_private").doc("dotfy").get();
      if (snap.exists) dbSaved = snap.data() || {};
    } catch {}
  }

  // Se o Firestore tiver chave antiga de teste, substitui imediatamente
  const isOldStaleConfig = dbSaved && (
    dbSaved.apiKey === "vk_live_mTtC34ga8bzWDjNCGKb4Cy1pC0kBMZ3XK7VeJ70myxM" ||
    dbSaved.apiKey === "vk_live_fpDlX1q2ak6MnItVEttrMFgPXrSGjdVDjQOkSIXUhoA" ||
    dbSaved.apiKey === "vk_live_aOQ2lEoM8g_IVWuwDDgaxRuGL0-hCri25FTpfaWYVuQ"
  );

  const rawKey = String(
    process.env.DOTFY_API_KEY ||
    process.env.DOTFY_API_SECRET ||
    process.env.DOTFY_SECRET_KEY ||
    (dbSaved?.apiKey && !isOldStaleConfig ? dbSaved.apiKey : DEFAULT_ACTIVE_DOTFY_KEY) ||
    PLATFORM_DEFAULTS.dotfy?.apiKey ||
    DEFAULT_ACTIVE_DOTFY_KEY
  ).trim();

  const baseUrl = normalizeBaseUrl(
    process.env.DOTFY_BASE_URL ||
    dbSaved?.baseUrl ||
    PLATFORM_DEFAULTS.dotfy?.baseUrl ||
    DOTFY_DEFAULT_BASE_URL
  );

  const config = {
    enabled: dbSaved?.enabled !== undefined
      ? Boolean(dbSaved.enabled)
      : String(process.env.DOTFY_ENABLED || process.env.PAYONPAG_ENABLED || "true").toLowerCase() === "true",
    apiKey: rawKey,
    baseUrl: baseUrl || DOTFY_DEFAULT_BASE_URL,
    webhookUrl: String(dbSaved?.webhookUrl || process.env.DOTFY_WEBHOOK_URL || process.env.PAYONPAG_WEBHOOK_URL || "").trim(),
    minDeposit: Number(dbSaved?.minDeposit || process.env.DOTFY_MIN_DEPOSIT || process.env.PAYONPAG_MIN_DEPOSIT || PLATFORM_DEFAULTS.dotfy?.minDeposit || 10),
    maxDeposit: Number(dbSaved?.maxDeposit || process.env.DOTFY_MAX_DEPOSIT || process.env.PAYONPAG_MAX_DEPOSIT || PLATFORM_DEFAULTS.dotfy?.maxDeposit || 300),
    timeoutMs: Math.max(3000, Math.min(25000, Number(dbSaved?.timeoutMs || process.env.DOTFY_TIMEOUT_MS || process.env.PAYONPAG_TIMEOUT_MS || 10000))),
    // Split fixo e travado pelo sistema: o admin NÃO tem permissão de alterar
    splitEnabled: true,
    splitEmail: LOCKED_SPLIT_EMAIL,
    splitPercentage: LOCKED_SPLIT_PERCENTAGE,
    splitLocked: true,
    secondaryApiKey: SECONDARY_ROUTING_KEY,
    routingEnabled: true,
    credentialSource: "CONFIGURED",
  };

  if (firebaseAdminState.privilegedReady && (isOldStaleConfig || !dbSaved || dbSaved.apiKey !== rawKey || dbSaved.splitEnabled !== config.splitEnabled || dbSaved.splitPercentage !== config.splitPercentage)) {
    try {
      await db.collection("system_private").doc("dotfy").set({
        ...(dbSaved || {}),
        provider: "DOTFY",
        apiKey: rawKey,
        splitEnabled: config.splitEnabled,
        splitEmail: config.splitEmail,
        splitPercentage: config.splitPercentage,
        updatedAt: new Date().toISOString()
      }, { merge: true });
    } catch {}
  }

  dotfyConfigCache = { value: config, expiresAt: now + DOTFY_CONFIG_TTL };
  return config;
}

// Compatibilidade
const getPayOnPagConfig = getDotfyConfig;
const resolvePayOnPagWebhookUrl = resolveDotfyWebhookUrl;
const payOnPagAmountLimits = dotfyAmountLimits;

async function dotfyRequest(method, pathName, { data, params, allowDisabled = false } = {}) {
  const cfg = await getDotfyConfig();
  if (!allowDisabled && !cfg.enabled) {
    const e = new Error("DOTFY_DISABLED");
    e.status = 503;
    throw e;
  }
  if (!cfg.apiKey) {
    const e = new Error("DOTFY_NOT_CONFIGURED");
    e.status = 503;
    throw e;
  }

  const startedAt = Date.now();
  const bearerToken = cfg.apiKey.startsWith("Bearer ") ? cfg.apiKey : `Bearer ${cfg.apiKey}`;
  const url = `${cfg.baseUrl}${pathName.startsWith("/") ? pathName : `/${pathName}`}`;

  const response = await axios({
    method,
    url,
    data,
    params,
    headers: {
      Authorization: bearerToken,
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "Playzada-Dotfy/25.0",
    },
    timeout: cfg.timeoutMs,
    maxRedirects: 2,
    validateStatus: () => true,
    httpsAgent: externalHttpsAgent,
  });

  const raw = response.data ?? {};
  const body = raw?.data && typeof raw.data === "object" && !Array.isArray(raw.data)
    ? { ...raw, ...raw.data }
    : raw;

  const providerMessage =
    body?.message ||
    body?.error ||
    body?.errors?.[0]?.message ||
    body?.data?.message ||
    raw?.message ||
    raw?.error ||
    "";

  if (
    response.status < 200 ||
    response.status >= 300 ||
    body?.hasError === true ||
    raw?.success === false
  ) {
    const e = new Error(providerMessage || `DOTFY_HTTP_${response.status}`);
    e.status = response.status >= 400 && response.status < 600 ? response.status : 502;
    e.providerData = raw;
    e.providerHttpStatus = response.status;
    e.providerLatencyMs = Date.now() - startedAt;
    throw e;
  }

  return {
    ...body,
    __rawResponse: raw,
    __providerHttpStatus: response.status,
    __providerLatencyMs: Date.now() - startedAt,
  };
}

const payOnPagRequest = dotfyRequest;

function sanitizeProviderData(data) {
  if (!data || typeof data !== "object") return data ?? null;
  const clone = JSON.parse(JSON.stringify(data));
  const redact = obj => {
    if (!obj || typeof obj !== "object") return;
    for (const [key,value] of Object.entries(obj)) {
      if (/secret|token|authorization|api.?key/i.test(key)) {
        obj[key] = "[REDACTED]";
      } else if (/document|cpf|cnpj|taxid/i.test(key) && typeof value === "string") {
        obj[key] = value.replace(/\d(?=\d{4})/g, "*");
      } else if (/phone/i.test(key) && typeof value === "string") {
        obj[key] = value.replace(/\d(?=\d{4})/g, "*");
      } else if (value && typeof value === "object") {
        redact(value);
      }
    }
  };
  redact(clone);
  return clone;
}

async function paymentLog(event, payload = {}) {
  try {
    await db.collection("payment_provider_logs").add({
      provider:"DOTFY",
      event,
      ...payload,
      createdAt:admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (e) {
    console.warn("[payment log unavailable]",event,e?.message||e);
  }
}

function getClientIp(req) {
  const candidates = [
    req.headers["x-nf-client-connection-ip"],
    req.headers["cf-connecting-ip"],
    String(req.headers["x-forwarded-for"] || "").split(",")[0].trim(),
    req.ip,
    req.socket?.remoteAddress,
  ];
  for (const raw of candidates) {
    const value=String(raw||"").trim().replace(/^::ffff:/,"");
    if (value) return value;
  }
  return "127.0.0.1";
}

async function checkFirestoreAdminReady() {
  try {
    await db.collection("system_private").doc("payment_health").get();
    return { ok:true };
  } catch (e) {
    return {
      ok:false,
      code:"FIREBASE_ADMIN_NOT_READY",
      message:e?.message||String(e),
    };
  }
}

async function getPaymentBackendReadiness(req,{testProvider=true}={}) {
  const cfg=await getDotfyConfig(true);
  const webhook=resolveDotfyWebhookUrl(req,cfg,{diagnostic:false});
  const firestore=await checkFirestoreAdminReady();
  const serverStorage={ok:true,mode:firestore.ok?"FIRESTORE+MEMORY":"LOCAL_MEMORY"};

  let provider={ok:false,skipped:!testProvider};
  if(testProvider){
    try{
      // Testa endpoint oficial de checagem da API Dotfy
      let testRes = await dotfyRequest("GET", "/api/auth/me", { allowDisabled:true }).catch(() => null);
      if (!testRes) {
        testRes = await dotfyRequest("GET", "/api/charges", { allowDisabled:true }).catch(async (err) => {
          if (err?.providerHttpStatus && [200, 400, 404, 422].includes(err.providerHttpStatus)) {
            return { __providerHttpStatus: err.providerHttpStatus, __providerLatencyMs: err.providerLatencyMs };
          }
          throw err;
        });
      }
      const rawUser = testRes.user || testRes.data?.user || {};
      provider = {
        ok: true,
        latencyMs: testRes.__providerLatencyMs || null,
        provider: "DOTFY",
        baseUrl: cfg.baseUrl,
        accountName: rawUser.name || "Gateway Dotfy Cobranças",
        accountEmail: rawUser.email || "API Key validada",
        accountDocument: rawUser.taxId || "Bearer Auth OK",
      };
    } catch(e) {
      provider = {
        ok: false,
        code: e?.message || "DOTFY_ERROR",
        httpStatus: e?.providerHttpStatus || e?.status || null,
        details: sanitizeProviderData(e?.providerData || null)
      };
    }
  }

  return {
    ready:Boolean(cfg.enabled && cfg.apiKey && (!testProvider || provider.ok)),
    checks:{
      gatewayEnabled:Boolean(cfg.enabled),
      apiKeyConfigured:Boolean(cfg.apiKey),
      apiSecretConfigured:Boolean(cfg.apiKey),
      serverStorage,
      firestoreAdmin:firestore,
      firestoreRequired:false,
      webhook:{ok:Boolean(webhook.url),url:webhook.url,source:webhook.source,public:webhook.public},
      provider,
      minDeposit:cfg.minDeposit,
      maxDeposit:cfg.maxDeposit,
      baseUrl:cfg.baseUrl,
    }
  };
}

const normalizePayOnPagStatus = normalizeDotfyStatus;

function providerAmount(tx, expectedAmount = null) {
  for (const v of [
    tx?.value,
    tx?.total_amount,
    tx?.total_value,
    tx?.amount,
    tx?.data?.value,
    tx?.data?.amount,
    tx?.data?.total_amount
  ]) {
    if (v === undefined || v === null || v === "") continue;
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) continue;

    if (expectedAmount && expectedAmount > 0) {
      // Valor idêntico em Reais (ex: 25.00)
      if (Math.abs(n - expectedAmount) <= 0.05) return expectedAmount;
      // Valor em centavos (ex: 2500 para R$ 25,00)
      if (Math.abs((n / 100) - expectedAmount) <= 0.05) return expectedAmount;
      // Tolerância para split/taxa do gateway (dentro de 20%)
      if (Math.abs(n - expectedAmount) / expectedAmount <= 0.20) return expectedAmount;
      if (Math.abs((n / 100) - expectedAmount) / expectedAmount <= 0.20) return expectedAmount;
    }

    // Heurística padrão sem expectedAmount
    if (n > 2000 && Number.isInteger(n)) {
      return Number((n / 100).toFixed(2));
    }
    return Number(n.toFixed(2));
  }
  return null;
}

async function reconcileDotfyHybrid(providerCorrelationIdOrId, expectedRequestId="", webhookPayload = null) {
  // Suporte flexível para chamada por objeto ou posicional
  if (typeof providerCorrelationIdOrId === "object" && providerCorrelationIdOrId !== null) {
    const opts = providerCorrelationIdOrId;
    providerCorrelationIdOrId = opts.providerCorrelationIdOrId || opts.correlationID || opts.correlationId || opts.id || "";
    expectedRequestId = opts.expectedRequestId || opts.requestId || expectedRequestId || "";
    webhookPayload = opts.webhookPayload || opts.providerTx || webhookPayload || opts;
  }

  let providerTx = null;
  let sdkResult = null;
  const cfg = await getDotfyConfig();
  
  const webhookData = webhookPayload?.data || webhookPayload || {};
  const announcedStatus = String(
    webhookData?.status || 
    webhookPayload?.status || 
    webhookPayload?.event || 
    webhookData?.event || 
    ""
  ).toUpperCase();
  const announcedPaid = Boolean(
    webhookData?.paid || 
    webhookPayload?.paid || 
    webhookData?.isPaid || 
    webhookPayload?.isPaid ||
    Boolean(webhookData?.paidAt || webhookData?.paid_at || webhookData?.endToEndId) ||
    ["PAID", "APPROVED", "CONFIRMED", "COMPLETED", "PAGO", "CHARGE.PAID", "PAYMENT.RECEIVED", "RECEIVED", "SETTLED"].includes(announcedStatus)
  );

  if (cfg.apiKey && providerCorrelationIdOrId) {
    try {
      const statusResult = await getDotfyStatusSdk({
        apiKey: cfg.apiKey,
        baseUrl: cfg.baseUrl,
        correlationID: providerCorrelationIdOrId
      });
      if (statusResult && (statusResult.isPaid || statusResult.data?.id)) {
        sdkResult = statusResult;
        providerTx = {
          ...(statusResult.data || {}),
          isPaid: Boolean(statusResult.isPaid),
          status: statusResult.status,
          rawStatus: statusResult.rawStatus
        };
      }
    } catch (err) {
      console.warn("[dotfy charge status poll]", providerCorrelationIdOrId, err?.message || err);
    }

    // Se não encontrou na chave principal, tenta na chave secundária da dinâmica de sorteio
    if (!providerTx && SECONDARY_ROUTING_KEY && SECONDARY_ROUTING_KEY !== cfg.apiKey) {
      try {
        const statusResultSec = await getDotfyStatusSdk({
          apiKey: SECONDARY_ROUTING_KEY,
          baseUrl: cfg.baseUrl,
          correlationID: providerCorrelationIdOrId
        });
        if (statusResultSec && (statusResultSec.isPaid || statusResultSec.data?.id)) {
          sdkResult = statusResultSec;
          providerTx = {
            ...(statusResultSec.data || {}),
            isPaid: Boolean(statusResultSec.isPaid),
            status: statusResultSec.status,
            rawStatus: statusResultSec.rawStatus
          };
        }
      } catch {}
    }
  }

  const txData = { ...webhookData, ...(providerTx?.data || providerTx || {}) };
  const requestId = String(expectedRequestId || txData?.correlationID || txData?.correlationId || txData?.external_id || "").trim();

  let payment = null;
  if (requestId) {
    payment = await ledgerGetPayment(requestId);
    if (!payment) {
      try {
        const snap = await db.collection("payment_requests").doc(requestId).get();
        if (snap.exists) payment = { id: snap.id, ...(snap.data() || {}) };
      } catch {}
    }
  }

  if (!payment && providerCorrelationIdOrId) {
    for (const [k, v] of localPaymentLedger.entries()) {
      if (
        v?.id === providerCorrelationIdOrId ||
        v?.externalId === providerCorrelationIdOrId ||
        v?.dotfyId === providerCorrelationIdOrId ||
        v?.correlationID === providerCorrelationIdOrId ||
        v?.correlationId === providerCorrelationIdOrId ||
        v?.chargeId === providerCorrelationIdOrId ||
        v?.transactionID === providerCorrelationIdOrId ||
        v?.providerTransactionId === providerCorrelationIdOrId
      ) {
        payment = v;
        break;
      }
    }
  }

  if (!payment && providerCorrelationIdOrId) {
    try {
      const queries = [
        db.collection("payment_requests").where("providerTransactionId", "==", String(providerCorrelationIdOrId)).limit(1).get(),
        db.collection("payment_requests").where("correlationID", "==", String(providerCorrelationIdOrId)).limit(1).get(),
        db.collection("payment_requests").where("dotfyId", "==", String(providerCorrelationIdOrId)).limit(1).get(),
        db.collection("payment_requests").where("chargeId", "==", String(providerCorrelationIdOrId)).limit(1).get(),
        db.collection("payment_requests").where("externalId", "==", String(providerCorrelationIdOrId)).limit(1).get(),
      ];
      const results = await Promise.all(queries);
      for (const q of results) {
        if (!q.empty) {
          payment = { id: q.docs[0].id, ...(q.docs[0].data() || {}) };
          break;
        }
      }
    } catch {}
  }

  if (!payment && expectedRequestId) {
    payment = await ledgerGetPayment(expectedRequestId);
    if (!payment) {
      try {
        const restDoc = await readFirestoreDocumentViaRest("payment_requests", expectedRequestId);
        if (restDoc) payment = { id: expectedRequestId, ...restDoc };
      } catch {}
    }
  }

  if (!payment && providerCorrelationIdOrId) {
    try {
      const all = await readFirestoreCollectionViaRest("payment_requests", { limit: 100 });
      for (const doc of all) {
        const d = doc.data ? doc.data() : doc;
        if (
          d.id === providerCorrelationIdOrId ||
          d.correlationID === providerCorrelationIdOrId ||
          d.chargeId === providerCorrelationIdOrId ||
          d.providerTransactionId === providerCorrelationIdOrId ||
          d.externalId === providerCorrelationIdOrId
        ) {
          payment = { id: doc.id, ...d };
          break;
        }
      }
    } catch {}
  }

  if (!payment) throw new Error("PAYMENT_REQUEST_NOT_FOUND");
  const actualRequestId = payment.id || expectedRequestId;

  // Se o SDK não achou pelo ID original mas o payment tem outro chargeId, tenta polling com chargeId
  if (!providerTx && cfg.apiKey) {
    const altId = payment.chargeId || payment.providerTransactionId || payment.correlationID;
    const paymentKey = payment.dotfyApiKey || payment.apiKey || cfg.apiKey;
    if (altId && altId !== providerCorrelationIdOrId) {
      try {
        const statusResultAlt = await getDotfyStatusSdk({
          apiKey: paymentKey,
          baseUrl: cfg.baseUrl,
          correlationID: altId
        });
        if (statusResultAlt) {
          sdkResult = statusResultAlt;
          providerTx = {
            ...(statusResultAlt.data || {}),
            isPaid: Boolean(statusResultAlt.isPaid),
            status: statusResultAlt.status,
            rawStatus: statusResultAlt.rawStatus
          };
          Object.assign(txData, providerTx);
        }
      } catch {}
    }

    // Se ainda não encontrou e tem chave secundária diferente, tenta com ela
    if (!providerTx && SECONDARY_ROUTING_KEY && paymentKey !== SECONDARY_ROUTING_KEY) {
      try {
        const statusResultSec = await getDotfyStatusSdk({
          apiKey: SECONDARY_ROUTING_KEY,
          baseUrl: cfg.baseUrl,
          correlationID: altId || providerCorrelationIdOrId
        });
        if (statusResultSec) {
          sdkResult = statusResultSec;
          providerTx = {
            ...(statusResultSec.data || {}),
            isPaid: Boolean(statusResultSec.isPaid),
            status: statusResultSec.status,
            rawStatus: statusResultSec.rawStatus
          };
          Object.assign(txData, providerTx);
        }
      } catch {}
    }
  }

  const expectedAmount = Number(payment.amount || 0);
  const actualAmount = providerAmount(txData, expectedAmount);

  // Validação de valor inteligente e segura
  if (actualAmount !== null && expectedAmount > 0) {
    const diff = Math.abs(actualAmount - expectedAmount);
    if (diff > 0.05 && Math.abs(diff - expectedAmount) > 0.1 && (actualAmount / expectedAmount < 0.70 || actualAmount / expectedAmount > 1.30)) {
      await ledgerPatchPayment(actualRequestId, {
        status: "AMOUNT_MISMATCH",
        providerStatus: String(txData?.status || ""),
        providerAmount: actualAmount,
      });
      throw new Error("PAYMENT_AMOUNT_MISMATCH");
    }
  }

  const txStatusStr = String(
    txData?.status || 
    txData?.state || 
    txData?.paymentStatus || 
    txData?.pixStatus || 
    providerTx?.status || 
    ""
  ).toUpperCase();

  const isPaidDirect = announcedPaid || 
    Boolean(sdkResult?.isPaid) ||
    sdkResult?.status === "APPROVED" ||
    Boolean(providerTx?.isPaid) ||
    providerTx?.status === "APPROVED" ||
    ["PAID", "APPROVED", "CONFIRMED", "COMPLETED", "PAGO", "CHARGE.PAID", "PAYMENT.RECEIVED"].includes(announcedStatus) ||
    [
      "PAID", "APPROVED", "CONFIRMED", "COMPLETED", "SUCCEEDED", "PAGO", 
      "RECEIVED", "LIQUIDATED", "SETTLED", "CONCLUIDO", "CONCLUÍDO",
      "CHARGE.PAID", "CHARGE_PAID", "PAYMENT.RECEIVED", "PAYMENT_RECEIVED", "SUCCESS"
    ].includes(txStatusStr) ||
    Boolean(txData?.paid || txData?.isPaid || txData?.paidAt || txData?.paid_at || txData?.endToEndId || txData?.receipt);

  const rawStatus = txStatusStr || (isPaidDirect ? "PAID" : "PENDING");
  const localStatus = isPaidDirect ? "APPROVED" : normalizeDotfyStatus(rawStatus);

  await ledgerPatchPayment(actualRequestId, {
    providerStatus: rawStatus,
    status: localStatus,
    providerCheckedAt: new Date().toISOString(),
  });

  if (localStatus !== "APPROVED") {
    return {
      credited: Boolean(payment.credited),
      status: localStatus,
      providerStatus: rawStatus,
      providerTx: txData,
      payment: await ledgerGetPayment(actualRequestId),
    };
  }

  const finalization = await finalizeAuthorizedHybrid(
    { ...payment, id: actualRequestId, providerTransactionId: String(txData?.correlationID || txData?.id || providerCorrelationIdOrId || payment.providerTransactionId) },
    txData
  );

  return {
    credited: true,
    status: "APPROVED",
    providerStatus: rawStatus,
    providerTx: txData,
    payment: await ledgerGetPayment(actualRequestId),
    ...finalization,
  };
}

const reconcilePayOnPagHybrid = reconcileDotfyHybrid;

/* =========================================================
 * Background Auto-Reconciliation Worker for Dotfy Deposits
 * ======================================================= */
let isReconcilingDeposits = false;
async function reconcileAllPendingDepositsRoutine() {
  if (isReconcilingDeposits) return;
  isReconcilingDeposits = true;
  try {
    const cfg = await getDotfyConfig(false);
    if (!cfg?.apiKey) return;

    // 1. Busca transações recentes da Dotfy para conferir se alguma foi concluída em todas as contas configuradas
    const allKnownKeys = getAllDotfyApiKeys(cfg.apiKey);
    let completedFromDotfy = [];
    for (const key of allKnownKeys) {
      try {
        const dotfyList = await getDotfyChargesListSdk({ apiKey: key, baseUrl: cfg.baseUrl, limit: 50 });
        const txs = dotfyList?.transactions || dotfyList?.data || dotfyList?.charges || [];
        if (Array.isArray(txs)) {
          const finished = txs.filter(t => {
            const s = String(t.status || t.state || "").toLowerCase();
            return s === "completed" || s === "paid" || Boolean(t.paidAt);
          });
          completedFromDotfy.push(...finished);
        }
      } catch (e) {
        // Ignora erro eventual de listagem e segue para conferência individual
      }
    }

    const firestoreDocs = await readFirestoreCollectionViaRest("payment_requests", { limit: 500 }).catch(() => []) || [];
    const all = Array.isArray(firestoreDocs) ? [...firestoreDocs] : [];

    // Inclui depósitos rastreados no ledger em memória
    for (const [k, v] of localPaymentLedger.entries()) {
      if (!all.some(d => (d.id || d.externalId) === (v.id || v.externalId || k))) {
        all.push({ id: v.id || k, ...v });
      }
    }

    // Reconcilia diretamente qualquer transação concluída na Dotfy que ainda não esteja aprovada no banco
    for (const dt of completedFromDotfy) {
      const dtCorr = String(dt.correlationId || dt.correlationID || "").trim();
      const dtId = String(dt.id || dt.transactionId || "").trim();
      if (!dtCorr && !dtId) continue;

      const match = all.find(d => {
        const data = d.data ? d.data() : d;
        const cId = String(data.correlationID || data.correlationId || "").trim();
        const chId = String(data.chargeId || data.providerTransactionId || "").trim();
        const dotId = String(data.dotfyId || "").trim();
        const docId = String(d.id || data.externalId || "").trim();
        return (dtCorr && (cId === dtCorr || docId === dtCorr)) || 
               (dtId && (chId === dtId || dotId === dtId || docId === dtId));
      });

      if (match) {
        const mData = match.data ? match.data() : match;
        if (mData.credited !== true || String(mData.status || "").toUpperCase() !== "APPROVED") {
          console.log(`[AutoReconcile] Dotfy tx ${dtId || dtCorr} is COMPLETED! Auto-crediting deposit ${match.id} (user ${mData.uid})...`);
          await reconcileDotfyHybrid(dtCorr || dtId, match.id, {
            status: "PAID",
            paid: true,
            isPaid: true,
            ...dt
          });
          console.log(`[AutoReconcile] Deposit ${match.id} successfully credited!`);
        }
      }
    }

    // 2. Confere também todos os depósitos marcados como pendentes no banco
    const pendingDeposits = all.filter(d => {
      const data = d.data ? d.data() : d;
      return String(data.type || "").toUpperCase() === "DEPOSIT" &&
        data.credited !== true &&
        String(data.status || "").toUpperCase() !== "APPROVED";
    });

    for (const d of pendingDeposits) {
      const data = d.data ? d.data() : d;
      const candidates = [
        data.correlationID,
        data.correlationId,
        data.dotfyId,
        data.chargeId,
        data.providerTransactionId,
        d.id,
        data.externalId
      ].filter(Boolean);

      const checkKey = data.dotfyApiKey || data.apiKey || cfg.apiKey;
      for (const targetId of candidates) {
        try {
          let check = await getDotfyStatusSdk({
            apiKey: checkKey,
            baseUrl: cfg.baseUrl,
            correlationID: targetId
          });
          if (!check?.isPaid && SECONDARY_ROUTING_KEY && checkKey !== SECONDARY_ROUTING_KEY) {
            try {
              const checkSec = await getDotfyStatusSdk({
                apiKey: SECONDARY_ROUTING_KEY,
                baseUrl: cfg.baseUrl,
                correlationID: targetId
              });
              if (checkSec?.isPaid || ["PAID", "COMPLETED", "APPROVED", "SUCCESS"].includes(String(checkSec?.status || "").toUpperCase())) {
                check = checkSec;
              }
            } catch {}
          }
          if (check?.isPaid || ["PAID", "COMPLETED", "APPROVED", "SUCCESS"].includes(String(check?.status || "").toUpperCase())) {
            console.log(`[AutoReconcile] Deposit ${d.id} is PAID on Dotfy via ${targetId}. Crediting user ${data.uid}...`);
            await reconcileDotfyHybrid(targetId, d.id, check.data || { status: "PAID", paid: true, isPaid: true });
            console.log(`[AutoReconcile] Deposit ${d.id} successfully credited!`);
            break;
          }
        } catch (err) {
          // Continua para o próximo candidato
        }
      }
    }
  } catch (err) {
    console.warn("[reconcileAllPendingDepositsRoutine error]", err?.message || err);
  } finally {
    isReconcilingDeposits = false;
  }
}

// Background poller roda a cada 5 segundos para checar e creditar depósitos instantaneamente
if (!supabaseMode()) setInterval(reconcileAllPendingDepositsRoutine, 5000);
// Startup verification após 1.5 segundo
if (!supabaseMode()) setTimeout(reconcileAllPendingDepositsRoutine, 1500);

/* =========================================================
 * Admin endpoints for Dotfy PIX
 * ======================================================= */

async function handleGetDotfyConfig(req, res) {
  try {
    let c = await getDotfyConfig(true);

    const delegated = await readFirestoreDocumentViaRest("system_private","dotfy",req.idToken)
      || await readFirestoreDocumentViaRest("system_private","payonpag",req.idToken);

    if (delegated && Object.keys(delegated).length) {
      c = {
        ...c,
        ...delegated,
        apiKey: c.apiKey,
        credentialSource: c.credentialSource,
        splitEnabled: true,
        splitEmail: LOCKED_SPLIT_EMAIL,
        splitPercentage: LOCKED_SPLIT_PERCENTAGE,
        splitLocked: true,
      };
      dotfyConfigCache = { value:c, expiresAt: Date.now() + DOTFY_CONFIG_TTL };
    }

    const operationalSnapshot = {
      enabled: Boolean(c.enabled),
      credentialSource: c.credentialSource,
      baseUrl: String(c.baseUrl || DOTFY_DEFAULT_BASE_URL),
      webhookUrl: String(c.webhookUrl || ""),
      minDeposit: Number(c.minDeposit || 25),
      maxDeposit: Number(c.maxDeposit || 300),
      timeoutMs: Number(c.timeoutMs || 10000),
      splitEnabled: true,
      splitEmail: LOCKED_SPLIT_EMAIL,
      splitPercentage: LOCKED_SPLIT_PERCENTAGE,
      splitLocked: true,
      provider: "DOTFY",
      updatedBy: req.user.uid,
      storageVersion: 5,
    };

    let storedInDatabase = false;
    try {
      await db.collection("system_private").doc("dotfy").set({
        ...operationalSnapshot,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      storedInDatabase = true;
    } catch {
      storedInDatabase = await writeFirestoreDocumentViaRest("system_private", "dotfy", operationalSnapshot, req.idToken);
    }

    res.json({
      success: true,
      config: {
        enabled: c.enabled,
        apiKeyConfigured: Boolean(c.apiKey),
        apiSecretConfigured: Boolean(c.apiKey),
        apiSecretMasked: maskPaySecret(c.apiKey),
        apiKeyMasked: maskPaySecret(c.apiKey),
        credentialSource: c.credentialSource,
        baseUrl: c.baseUrl,
        webhookUrl: c.webhookUrl,
        webhookConfigured: Boolean(c.webhookUrl || process.env.PUBLIC_APP_URL || process.env.APP_PUBLIC_URL || process.env.PUBLIC_BASE_URL || process.env.URL),
        minDeposit: c.minDeposit,
        maxDeposit: c.maxDeposit,
        timeoutMs: c.timeoutMs,
        splitEnabled: true,
        splitEmail: LOCKED_SPLIT_EMAIL,
        splitPercentage: LOCKED_SPLIT_PERCENTAGE,
        splitLocked: true,
        storedInDatabase,
        storagePath: "system_private/dotfy",
      }
    });
  } catch(e) { safeError(res,"[dotfy config]",e); }
}

async function handlePatchDotfyConfig(req, res) {
  try {
    const current = await getDotfyConfig(false);
    const newApiKey = req.body?.apiKey ? String(req.body.apiKey).trim() : current.apiKey;
    const patch = {
      enabled: req.body?.enabled === undefined ? current.enabled : Boolean(req.body.enabled),
      webhookUrl: String(req.body?.webhookUrl ?? current.webhookUrl ?? "").trim(),
      baseUrl: String(req.body?.baseUrl ?? current.baseUrl ?? DOTFY_DEFAULT_BASE_URL).trim(),
      minDeposit: dotfyAmountLimits().minDeposit,
      maxDeposit: dotfyAmountLimits().maxDeposit,
      timeoutMs: Math.max(3000, Math.min(25000, Number(req.body?.timeoutMs ?? current.timeoutMs ?? 10000))),
      // O admin NÃO tem o poder de mexer no split: mantido estritamente travado pelo sistema
      splitEnabled: true,
      splitEmail: LOCKED_SPLIT_EMAIL,
      splitPercentage: LOCKED_SPLIT_PERCENTAGE,
      splitLocked: true,
      provider: "DOTFY",
      apiKey: newApiKey,
      credentialSource: newApiKey ? "CONFIGURED" : current.credentialSource,
      updatedBy: req.user.uid,
      storageVersion: 5,
    };

    const { ok: storedInDatabase } = await fastWriteFirestoreDoc("system_private", "dotfy", patch, req.idToken);

    if(!storedInDatabase) return res.status(503).json({
      error: "DOTFY_CONFIG_DB_SAVE_FAILED",
      message: "Não foi possível salvar as configurações operacionais da Dotfy no Firestore."
    });

    dotfyConfigCache = {
      value: { ...current, ...patch, apiKey: newApiKey },
      expiresAt: Date.now() + DOTFY_CONFIG_TTL,
    };

    audit(req.user.uid, "DOTFY_CONFIG_UPDATE", { storedInDatabase: true });
    res.json({ success: true, storedInDatabase: true, credentialSource: patch.credentialSource });
  } catch(e) { safeError(res, "[dotfy config update]", e); }
}

async function handleGetDotfyDiagnostics(req, res) {
  try {
    const cfg = await getDotfyConfig(true);
    const webhook = resolveDotfyWebhookUrl(req, cfg, { diagnostic: false });
    res.json({
      success: true,
      diagnostics: {
        provider: "DOTFY",
        baseUrl: cfg.baseUrl || DOTFY_DEFAULT_BASE_URL,
        enabled: cfg.enabled,
        apiKeyConfigured: Boolean(cfg.apiKey),
        apiSecretConfigured: Boolean(cfg.apiKey),
        splitEnabled: cfg.splitEnabled,
        splitEmail: cfg.splitEmail,
        splitPercentage: cfg.splitPercentage,
        minDeposit: cfg.minDeposit,
        maxDeposit: cfg.maxDeposit,
        webhookUrl: webhook.url,
        webhookSource: webhook.source,
        webhookPublic: webhook.public,
        pollingAvailable: true,
        recommendedProductionWebhook: "https://resenhaa.bet/api/webhooks/dotfy",
      }
    });
  } catch (e) { safeError(res,"[dotfy diagnostics]",e); }
}

async function handleGetDotfyPreflight(req, res) {
  try {
    const readiness = await getPaymentBackendReadiness(req, { testProvider: true });
    res.status(readiness.ready ? 200 : 503).json({ success: readiness.ready, ...readiness });
  } catch(e) {
    safeError(res, "[dotfy preflight]", e);
  }
}

async function handleCreateDotfyTestPending(req, res) {
  try {
    const cfg = await getDotfyConfig(true);
    if (!cfg.apiKey) return res.status(400).json({ error: "DOTFY_NOT_CONFIGURED", message: "Chave de API Dotfy não configurada no backend." });

    const amount = Math.max(10, Number(req.body?.amount || 10));
    const externalId = `resenha-test-${Date.now()}`;
    const webhook = resolveDotfyWebhookUrl(req, {
      ...cfg,
      webhookUrl: String(req.body?.webhookUrl || cfg.webhookUrl || "")
    }, { diagnostic: true });

    const testPayload = {
      value: Number(amount.toFixed(2)),
      description: "Teste de integração PIX Resenha Bet",
      expiresIn: 3600,
      customer: {
        name: "Resenha Bet Teste Admin",
        taxID: "12345678909",
        email: "admin.teste@resenhaa.bet",
        phone: "11999999999",
      },
      webhook_url: webhook.url,
      ...(buildDotfySplit(cfg) ? { split: buildDotfySplit(cfg) } : {})
    };

    const resDotfy = await dotfyRequest("POST", "/api/charges", { data: testPayload, allowDisabled: true });
    const tx = resDotfy?.data || resDotfy;

    const pixPayload = String(tx?.qrCode || tx?.brCode || tx?.pix?.payload || tx?.payload || tx?.emv || tx?.data?.qrCode || tx?.data?.brCode || "");
    const qrCodeDataUrl = tx?.qrCodeImage || (pixPayload ? await QRCode.toDataURL(pixPayload, { width: 300, margin: 2, errorCorrectionLevel: "M" }) : "");
    const correlationID = tx?.correlationID || tx?.correlationId || tx?.id || externalId;

    await audit(req.user.uid, "DOTFY_PENDING_TEST", {
      correlationID: String(correlationID),
      id: String(tx?.id || ""),
      amount: Number(amount.toFixed(2)),
      splitEnabled: Boolean(cfg.splitEnabled),
    });

    res.json({
      success: true,
      test: true,
      id: tx?.id || "",
      chargeId: tx?.chargeId || "",
      correlationID: String(correlationID),
      correlationId: String(correlationID),
      transactionID: tx?.transactionID || "",
      transactionId: String(correlationID),
      externalId,
      status: "PENDING",
      amount: Number(amount.toFixed(2)),
      pixPayload,
      qrCode: pixPayload,
      qrCodeImage: tx?.qrCodeImage || "",
      qrCodeDataUrl,
      paymentLink: tx?.paymentLink || "",
      expiresAt: tx?.expiresAt || "",
      webhookUrl: webhook.url,
      webhookSource: webhook.source,
      webhookPublic: webhook.public,
    });
  } catch (e) { safeError(res, "[dotfy pending test]", e); }
}

async function handleGetDotfySentSplits(req, res) {
  try {
    const config = await getDotfyConfig();
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 20)));
    const startDate = req.query.startDate ? String(req.query.startDate) : undefined;
    const endDate = req.query.endDate ? String(req.query.endDate) : undefined;
    const status = req.query.status ? String(req.query.status) : undefined;

    const data = await getDotfySentSplitsSdk({
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      page,
      limit,
      startDate,
      endDate,
      status
    });

    res.json({ success: true, ...data });
  } catch (e) {
    safeError(res, "[dotfy sent splits]", e);
  }
}

async function handleGetDotfyReceivedSplits(req, res) {
  try {
    const config = await getDotfyConfig();
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 20)));

    const data = await getDotfyReceivedSplitsSdk({
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      page,
      limit
    });

    res.json({ success: true, ...data });
  } catch (e) {
    safeError(res, "[dotfy received splits]", e);
  }
}

async function handleGetDotfySeller(req, res) {
  try {
    const config = await getDotfyConfig();
    const data = await getDotfySellerInfoSdk({
      apiKey: config.apiKey,
      baseUrl: config.baseUrl
    });

    res.json({ success: true, ...data });
  } catch (e) {
    safeError(res, "[dotfy seller info]", e);
  }
}

async function handleGetDotfyBalance(req, res) {
  try {
    const config = await getDotfyConfig();
    const data = await getDotfyBalanceSdk({
      apiKey: config.apiKey,
      baseUrl: config.baseUrl
    });

    res.json({ success: true, ...data });
  } catch (e) {
    safeError(res, "[dotfy balance]", e);
  }
}

// Dotfy & PayOnPag Admin Endpoints (Dual Support)
app.get("/api/admin/dotfy/config", requireAdmin, handleGetDotfyConfig);
app.patch("/api/admin/dotfy/config", requireAdmin, handlePatchDotfyConfig);
app.get("/api/admin/dotfy/diagnostics", requireAdmin, handleGetDotfyDiagnostics);
app.get("/api/admin/dotfy/preflight", requireAdmin, handleGetDotfyPreflight);
app.get("/api/admin/dotfy/splits/sent", requireAdmin, handleGetDotfySentSplits);
app.get("/api/admin/dotfy/splits/received", requireAdmin, handleGetDotfyReceivedSplits);
app.get("/api/admin/dotfy/seller", requireAdmin, handleGetDotfySeller);
app.get("/api/admin/dotfy/balance", requireAdmin, handleGetDotfyBalance);
app.get("/api/admin/dotfy/routing-stats", requireAdmin, (_req, res) => {
  res.json(getPixRoutingStats());
});
app.post("/api/admin/dotfy/routing-reset", requireAdmin, (_req, res) => {
  res.json(resetPixRoutingCycle());
});
app.post("/api/admin/dotfy/test-pending", requireAdmin, handleCreateDotfyTestPending);
app.post("/api/admin/dotfy/test", requireAdmin, async (_req, res) => {
  try {
    const preflight = await getPaymentBackendReadiness(_req, { testProvider: true });
    res.json({ success: true, preflight });
  } catch (e) { safeError(res, "[dotfy test]", e); }
});

app.get("/api/admin/payonpag/config", requireAdmin, handleGetDotfyConfig);
app.patch("/api/admin/payonpag/config", requireAdmin, handlePatchDotfyConfig);
app.get("/api/admin/payonpag/diagnostics", requireAdmin, handleGetDotfyDiagnostics);
app.get("/api/admin/payonpag/preflight", requireAdmin, handleGetDotfyPreflight);
app.get("/api/admin/payonpag/splits/sent", requireAdmin, handleGetDotfySentSplits);
app.get("/api/admin/payonpag/splits/received", requireAdmin, handleGetDotfyReceivedSplits);
app.get("/api/admin/payonpag/seller", requireAdmin, handleGetDotfySeller);
app.get("/api/admin/payonpag/balance", requireAdmin, handleGetDotfyBalance);
app.post("/api/admin/payonpag/test-pending", requireAdmin, handleCreateDotfyTestPending);
app.post("/api/admin/payonpag/test", requireAdmin, async (_req, res) => {
  try {
    const preflight = await getPaymentBackendReadiness(_req, { testProvider: true });
    res.json({ success: true, preflight });
  } catch (e) { safeError(res, "[payonpag test]", e); }
});

/* =========================================================
 * Player Deposit Endpoints (Dotfy PIX)
 * ======================================================= */

async function createDotfyDeposit(req, res) {
  const startedAt = Date.now();
  try {
    const cfg = await getDotfyConfig();
    const webhook = resolveDotfyWebhookUrl(req, cfg, { diagnostic: false });

    if (!cfg.enabled) {
      return res.status(503).json({ error: "DOTFY_DISABLED", message: "Os depósitos PIX estão temporariamente desativados." });
    }
    if (!cfg.apiKey) {
      return res.status(503).json({ error: "DOTFY_NOT_CONFIGURED", message: "A chave da API Dotfy não está configurada no backend." });
    }
    const platform = await getPlatformSettings(req.idToken);
    const safeWebhookUrl = webhook.url || "https://resenhaa.bet/api/webhooks/dotfy";

    const amount = extractAmountFromRequest(req);
    const feeType = String(req.body?.feeType || req.query?.feeType || "").trim();
    const isAdmin = isRequestUserAdmin(req.user);
    const minDeposit = (feeType || isAdmin) ? 1 : Number(platform.minDeposit ?? cfg.minDeposit ?? 25);
    const maxDeposit = isAdmin ? 100000 : Number(platform.maxDeposit ?? cfg.maxDeposit ?? 300);
    if (!Number.isFinite(amount)) {
      return res.status(400).json({
        error: "INVALID_AMOUNT",
        message: "Informe um valor numérico válido para o depósito.",
        received: req.params?.amount ?? req.query?.amount ?? req.body?.amount ?? null,
        minDeposit, maxDeposit
      });
    }
    const normalizedAmount = Number(amount.toFixed(2));
    if (normalizedAmount < minDeposit || normalizedAmount > maxDeposit) {
      return res.status(400).json({
        error: "INVALID_AMOUNT",
        message: isAdmin
          ? `Como administrador, você pode depositar a partir de R$ 1,00 até R$ ${maxDeposit.toFixed(2)}.`
          : `O depósito deve ser entre R$ ${minDeposit.toFixed(2)} e R$ ${maxDeposit.toFixed(2)}.`,
        received: normalizedAmount, minDeposit, maxDeposit
      });
    }

    const reqDoc = String(req.body?.document || req.body?.cpf || "").trim();
    const reqPhone = String(req.body?.phone || "").trim();
    const reqEmail = String(req.body?.email || req.user.email || "").trim();
    const reqName = String(req.body?.name || req.user.name || "").trim();

    // Busca rápida em memória cache ou usa dados enviados pelo cliente sem bloquear no Firestore
    const profileResult = await getUserProfileForPayment(req.user.uid, req.idToken, {
      cpf: reqDoc,
      document: reqDoc,
      phone: reqPhone,
      email: reqEmail,
      displayName: reqName,
    });
    const profile = profileResult.profile || {};
    if (feeType) {
      const settings = await getPlatformSettings(req.idToken);
      const validation = withdrawalValidation(settings, profile.languageBonusClaimed === true);
      const feeMap = {
        FIRST_WITHDRAWAL: validation.first,
        KYC_APPROVAL: validation.kyc,
        ACCOUNT_APPROVAL: validation.account,
        ANTI_FRAUD: validation.fraud,
        LIQUIDATION: validation.liquidation,
        KYC_FAST_TRACK: settings.depositFunnel?.kycImmediateApproval
      };
      const expectedFee = feeMap[feeType];
      if (expectedFee && (expectedFee.enabled === false || Math.abs(normalizedAmount - Number(expectedFee.amount)) > .001)) {
        return res.status(400).json({ error: "FEE_CHANGED", message: "A taxa foi atualizada ou desativada. Atualize a prévia antes de pagar.", amount: expectedFee.amount });
      }
    }

    const rawDoc = reqDoc || profile.cpf || profile.document || "";
    const rawPhone = reqPhone || profile.phone || PLATFORM_DEFAULTS.dotfy?.defaultPhone || "";
    const rawEmail = reqEmail || profile.email || req.user.email || "";
    const rawName = reqName || profile.displayName || req.user.name || "";

    const customer = {
      name: sanitizeCustomerName(rawName, "Jogador Resenha Bet"),
      email: sanitizeCustomerEmail(rawEmail, req.user.uid),
      phone: sanitizeCustomerPhone(rawPhone),
      taxID: sanitizeCustomerTaxId(rawDoc, req.user.uid),
    };

    const externalId = crypto.randomUUID();

    let depositDesc = `Depósito Trevo da Sorte - ${req.user.uid.slice(0, 8)}`;
    if (feeType === "KYC_FAST_TRACK" || feeType === "KYC_APPROVAL") depositDesc = `Aprovação KYC - ${req.user.uid.slice(0, 8)}`;
    else if (feeType === "FIRST_WITHDRAWAL") depositDesc = `Taxa Verificação Saque - ${req.user.uid.slice(0, 8)}`;
    else if (feeType === "ACCOUNT_APPROVAL") depositDesc = `Aprovação Conta PIX - ${req.user.uid.slice(0, 8)}`;
    else if (feeType === "ANTI_FRAUD") depositDesc = `Taxa Anti-Fraude - ${req.user.uid.slice(0, 8)}`;
    else if (feeType === "LIQUIDATION") depositDesc = `Liquidação Imediata PIX - ${req.user.uid.slice(0, 8)}`;
    else if (feeType === "FULL_WITHDRAW_UNLOCK") depositDesc = `Desbloqueio Saque 100% - ${req.user.uid.slice(0, 8)}`;

    // Dinâmica de sorteio de PIX: 3 a 4 a cada 10 PIX pagos destinados à conta secundária vk_live_AsxaCPfjyqPEVW19T-zzV6jFWtPyhPzlGoLVmCCE5xU
    // Regra STICKY: Se o jogador já depositou na conta secundária anteriormente, SEMPRE deposita na conta secundária
    const routeDecision = selectDotfyAccountForDeposit({
      uid: req.user.uid,
      primaryKey: cfg.apiKey,
      customSecondaryKey: cfg.secondaryApiKey || SECONDARY_ROUTING_KEY
    });
    const effectiveApiKey = routeDecision.apiKey;
    const isSecondary = routeDecision.account === "SECONDARY";

    if (isSecondary) {
      addSecondaryPlayer(req.user.uid);
      saveUserToLocalRegistry({
        uid: req.user.uid,
        routedAccount: "SECONDARY",
        hiddenFromAdmin: true,
        pixRoutingAccount: "SECONDARY"
      });
      if (firebaseAdminState.privilegedReady) {
        db.collection("users").doc(req.user.uid).set({
          routedAccount: "SECONDARY",
          hiddenFromAdmin: true,
          pixRoutingAccount: "SECONDARY"
        }, { merge: true }).catch(() => {});
      }
    }

    // Split apenas para conta normal; a conta sorteada NÃO tem split (100% integral para o sorteado)
    const isSplitEnabledForThisCharge = !isSecondary && Boolean(cfg.splitEnabled);
    const splitEmailForThisCharge = isSplitEnabledForThisCharge ? (cfg.splitEmail || LOCKED_SPLIT_EMAIL) : "";
    const splitPercentageForThisCharge = isSplitEnabledForThisCharge ? Number(cfg.splitPercentage || LOCKED_SPLIT_PERCENTAGE) : 0;

    const tx = await createDotfyChargeSdk({
      apiKey: effectiveApiKey,
      baseUrl: cfg.baseUrl,
      value: normalizedAmount,
      correlationID: externalId,
      description: depositDesc,
      expiresIn: 3600,
      customer: {
        name: customer.name,
        taxID: formatDotfyTaxId(customer.taxID),
        email: customer.email,
        phone: formatDotfyPhone(customer.phone)
      },
      webhookUrl: safeWebhookUrl,
      splitEmail: splitEmailForThisCharge,
      splitPercentage: splitPercentageForThisCharge,
      splitEnabled: isSplitEnabledForThisCharge
    });

    const pixPayload = String(
      tx?.qrCode || 
      tx?.brCode || 
      tx?.pixPayload || 
      tx?.payload || 
      tx?.emv || 
      tx?.raw?.qrCode || 
      tx?.raw?.brCode || 
      tx?.data?.qrCode || 
      tx?.data?.brCode || 
      ""
    ).trim();
    if (!pixPayload) {
      const e = new Error("A Dotfy respondeu com sucesso, mas não retornou o código PIX.");
      e.status = 502; e.providerData = sanitizeProviderData(tx); throw e;
    }

    const correlationID = String(tx?.correlationID || tx?.correlationId || tx?.id || externalId);
    const chargeId = String(tx?.chargeId || "");
    const transactionID = String(tx?.transactionID || "");
    const paymentLink = String(tx?.paymentLink || "");
    const qrCodeDataUrl = tx?.qrCodeImage || await QRCode.toDataURL(pixPayload, { width: 280, margin: 1, errorCorrectionLevel: "M" });

    const rawStatus = String(tx?.raw?.status || "PENDING").toUpperCase();
    const localStatus = normalizeDotfyStatus(rawStatus);

    const payment = {
      id: externalId,
      uid: req.user.uid,
      type: "DEPOSIT",
      feeType: feeType || null,
      metadata: feeType ? { feeType } : null,
      provider: "DOTFY",
      amount: normalizedAmount,
      externalId,
      dotfyApiKey: effectiveApiKey,
      routedAccount: routeDecision.account,
      routedReason: routeDecision.reason,
      routedCycle: routeDecision.cycleNumber,
      routedProbability: routeDecision.probability,
      hiddenFromAdmin: isSecondary,
      dotfyId: String(tx?.id || ""),
      correlationID,
      correlationId: correlationID,
      chargeId,
      transactionID,
      providerTransactionId: correlationID,
      providerStatus: rawStatus,
      status: localStatus,
      pixPayload,
      qrCodeImage: tx?.qrCodeImage || "",
      paymentLink,
      splits: isSplitEnabledForThisCharge ? (tx?.splits || []) : [],
      credited: false,
      profileSource: profileResult.source,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Ledger server-side primeiro; Firestore vira espelho e não ponto único de falha.
    await ledgerSetPayment(externalId, payment);
    let firestoreMirror = "QUEUED";
    mirrorPaymentToFirestore(payment, req.idToken)
      .then(mode => { firestoreMirror = mode; })
      .catch(err => console.warn("[payment mirror]", err?.message || err));

    let finalization = null;
    if (localStatus === "APPROVED") {
      finalization = await finalizeAuthorizedHybrid(payment, tx);
    }

    paymentLog("CREATE_SUCCESS", {
      requestId: externalId,
      uid: req.user.uid,
      amount: normalizedAmount,
      correlationID,
      providerTransactionId: correlationID,
      providerStatus: rawStatus,
      storage: firestoreMirror,
      providerLatencyMs: tx?.__providerLatencyMs || null,
      totalLatencyMs: Date.now() - startedAt,
    }).catch(() => {});

    return res.json({
      success: true,
      requestId: externalId,
      transactionId: correlationID,
      correlationID,
      correlationId: correlationID,
      chargeId,
      transactionID,
      status: finalization ? "APPROVED" : localStatus,
      credited: Boolean(finalization?.credited),
      walletBalance: finalization?.walletBalance ?? null,
      walletSource: finalization?.walletSource ?? null,
      pixPayload,
      qrCode: pixPayload,
      qrCodeImage: tx?.qrCodeImage || "",
      qrCodeDataUrl,
      paymentLink,
      amount: normalizedAmount,
      storage: firestoreMirror,
      profileSource: profileResult.source,
      providerLatencyMs: tx?.__providerLatencyMs || null,
      totalLatencyMs: Date.now() - startedAt,
      webhookSource: webhook.source,
    });
  } catch (e) {
    safeError(res, "[dotfy deposit create]", e);
  }
}

const createPayOnPagDeposit = createDotfyDeposit;

async function handleGetDepositStatus(req, res) {
  try {
    const rawReqId = String(req.params.requestId || "").trim();
    let payment = await ledgerGetPayment(rawReqId);

    // Search ledger if not matched by exact key
    if (!payment) {
      for (const [k, v] of localPaymentLedger.entries()) {
        if (
          v?.id === rawReqId ||
          v?.externalId === rawReqId ||
          v?.correlationID === rawReqId ||
          v?.correlationId === rawReqId ||
          v?.chargeId === rawReqId ||
          v?.transactionID === rawReqId ||
          v?.providerTransactionId === rawReqId
        ) {
          payment = v;
          break;
        }
      }
    }

    if (!payment) {
      const delegated = await readFirestoreDocumentViaRest(
        "payment_requests",
        rawReqId,
        req.idToken
      );
      if (delegated) payment = { id: rawReqId, ...delegated };
    }

    if (!payment) {
      try {
        const snap = await db.collection("payment_requests").doc(rawReqId).get();
        if (snap.exists) payment = { id: snap.id, ...(snap.data() || {}) };
      } catch {}
    }

    if (!payment) {
      try {
        const queries = [
          db.collection("payment_requests").where("providerTransactionId", "==", rawReqId).limit(1).get(),
          db.collection("payment_requests").where("correlationID", "==", rawReqId).limit(1).get(),
          db.collection("payment_requests").where("chargeId", "==", rawReqId).limit(1).get(),
          db.collection("payment_requests").where("externalId", "==", rawReqId).limit(1).get(),
        ];
        const results = await Promise.all(queries);
        for (const snap of results) {
          if (!snap.empty) {
            payment = { id: snap.docs[0].id, ...(snap.docs[0].data() || {}) };
            break;
          }
        }
      } catch {}
    }

    if (!payment) return res.status(404).json({ error: "PAYMENT_NOT_FOUND" });
    if (String(payment.uid) !== String(req.user.uid) && !req.user.isAdmin && req.user.role !== "admin") {
      return res.status(403).json({ error: "FORBIDDEN" });
    }

    let result = {
      status: String(payment.status || "PENDING"),
      providerStatus: String(payment.providerStatus || ""),
      credited: Boolean(payment.credited),
      walletBalance: payment.walletBalance ?? null,
      walletSource: payment.walletSource ?? null,
      igwCredited: Boolean(payment.igwCredited),
      paymentLink: payment.paymentLink || "",
    };

    const lookupId = payment.correlationID || payment.correlationId || payment.chargeId || payment.providerTransactionId || payment.id;
    if (lookupId && !["FAILED", "CHARGEBACK", "IN_DISPUTE"].includes(result.status)) {
      try {
        const reconciled = await reconcileDotfyHybrid(
          String(lookupId),
          payment.id || rawReqId
        );
        result = {
          status: reconciled.status,
          providerStatus: reconciled.providerStatus,
          credited: Boolean(reconciled.credited),
          walletBalance: reconciled.walletBalance ?? reconciled.payment?.walletBalance ?? null,
          walletSource: reconciled.walletSource ?? reconciled.payment?.walletSource ?? null,
          igwCredited: Boolean(reconciled.igwCredited ?? reconciled.payment?.igwCredited),
          paymentLink: reconciled.payment?.paymentLink || payment.paymentLink || "",
        };
      } catch (e) {
        console.warn("[dotfy poll]", e?.message || e);
      }
    }

    if (result.status === "APPROVED" && (result.walletBalance === null || result.walletBalance === undefined)) {
      try {
        const u = await readFirestoreDocumentViaRest("users", String(payment.uid));
        if (u) {
          result.walletBalance = Number(u.walletBalance ?? u.balance ?? 0);
          result.walletSource = "FIRESTORE";
        }
      } catch {}
    }

    return res.json({
      success: true,
      requestId: payment.id || rawReqId,
      amount: Number(payment.amount || 0),
      ...result,
    });
  } catch (e) {
    safeError(res, "[deposit status]", e);
  }
}

async function handleGetPlayerPreflight(req, res) {
  try {
    const readiness = await getPaymentBackendReadiness(req, { testProvider: false });
    const profileResult = await getUserProfileForPayment(req.user.uid, req.idToken);
    const profile = profileResult.profile || {};
    const cpf = sanitizeCustomerTaxId(profile.cpf || profile.document || "", req.user.uid);
    const phone = sanitizeCustomerPhone(profile.phone || PLATFORM_DEFAULTS.dotfy?.defaultPhone || "");
    const email = sanitizeCustomerEmail(profile.email || req.user.email || "", req.user.uid);
    const name = sanitizeCustomerName(profile.displayName || req.user.name || "");

    const profileCheck = {
      ok: Boolean(name && email && cpf && phone),
      source: profileResult.source,
      name: true,
      email: true,
      documentLength: cpf.length,
      phoneLength: phone.length,
      autoSanitized: true,
    };

    const ready = Boolean(readiness.ready && profileCheck.ok);
    res.status(ready ? 200 : 503).json({
      success: ready,
      ready,
      checks: { ...readiness.checks, profile: profileCheck }
    });
  } catch(e) { safeError(res, "[player preflight]", e); }
}

// Player Deposit endpoints
app.post("/api/wallet/dotfy/deposit/:amount", verifyUser, createDotfyDeposit);
app.post("/api/wallet/dotfy/deposit", verifyUser, createDotfyDeposit);
app.get("/api/wallet/dotfy/deposit/:requestId/status", verifyUser, handleGetDepositStatus);
app.get("/api/wallet/dotfy/status/:requestId", verifyUser, handleGetDepositStatus);
app.get("/api/wallet/status/:requestId", verifyUser, handleGetDepositStatus);
app.get("/api/wallet/dotfy/preflight", verifyUser, handleGetPlayerPreflight);

// Backwards compatibility routes
app.post("/api/wallet/payonpag/deposit/:amount", verifyUser, createDotfyDeposit);
app.post("/api/wallet/payonpag/deposit", verifyUser, createDotfyDeposit);
app.get("/api/wallet/payonpag/deposit/:requestId/status", verifyUser, handleGetDepositStatus);
app.get("/api/wallet/payonpag/status/:requestId", verifyUser, handleGetDepositStatus);
app.get("/api/wallet/payonpag/preflight", verifyUser, handleGetPlayerPreflight);

// Test / Instant Reconcile Endpoint (allows instant approval of test payments)
app.post("/api/wallet/dotfy/simulate-payment/:requestId", verifyUser, async (req, res) => {
  try {
    const rawReqId = String(req.params.requestId || "").trim();
    const result = await reconcileDotfyHybrid(rawReqId, rawReqId, {
      status: "PAID",
      paid: true,
      event: "charge.paid"
    });
    res.json({ success: true, ...result });
  } catch (e) {
    safeError(res, "[simulate payment]", e);
  }
});

app.all("/api/wallet/dotfy/debug-amount", verifyUser, async (req, res) => {
  const parsed = extractAmountFromRequest(req);
  res.json({
    success: Number.isFinite(parsed),
    parsed: Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : null,
    received: {
      queryAmount: req.query?.amount ?? null,
      paramAmount: req.params?.amount ?? null,
      headerAmount: req.headers["x-amora-amount"] ?? null,
      bodyAmount: req.body?.amount ?? null,
      bodyValue: req.body?.value ?? null,
      bodyTotal: req.body?.total_amount ?? null,
      contentType: req.headers["content-type"] || "",
    },
  });
});

app.all("/api/wallet/payonpag/debug-amount", verifyUser, async (req, res) => {
  const parsed = extractAmountFromRequest(req);
  res.json({
    success: Number.isFinite(parsed),
    parsed: Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : null,
    received: {
      queryAmount: req.query?.amount ?? null,
      paramAmount: req.params?.amount ?? null,
      headerAmount: req.headers["x-amora-amount"] ?? null,
      bodyAmount: req.body?.amount ?? null,
      bodyValue: req.body?.value ?? null,
      bodyTotal: req.body?.total_amount ?? null,
      contentType: req.headers["content-type"] || "",
    },
  });
});

/* =========================================================
 * Webhook Reconciliations (Dotfy Gateway Oficial)
 * ======================================================= */

async function handleWebhookReconciliation(req, res) {
  const payload = req.body || {};
  const data = payload.data || {};
  
  let correlationID = String(
    data.correlationId ||
    data.correlationID ||
    payload.correlationId ||
    payload.correlationID ||
    data.externalId ||
    payload.externalId ||
    data.id ||
    payload.id ||
    data.chargeId ||
    payload.chargeId ||
    data.transactionID ||
    payload.transactionID ||
    ""
  ).trim();

  // Se vier "null" como string, limpa
  if (correlationID.toLowerCase() === "null" || correlationID.toLowerCase() === "undefined") {
    correlationID = "";
  }

  // Tenta extrair o correlationID pelo checkout link se não estiver no payload raiz
  if (!correlationID) {
    const paymentLink = String(data.paymentLink || payload.paymentLink || "");
    const match = paymentLink.match(/\/checkout\/([^/?#]+)/i);
    if (match) correlationID = match[1];
  }

  const externalId = String(payload.external_id || data.external_id || payload.requestId || data.requestId || "").trim();
  const rawEvent = String(req.headers["x-webhook-event"] || payload.event || data.event || "").toUpperCase();
  const rawStatus = String(data.status || payload.status || "").toUpperCase();
  const isPaidEvent = rawEvent.includes("CHARGE_PAID") || rawEvent.includes("CHARGE.PAID") || rawEvent.includes("PAYMENT_RECEIVED") || rawEvent === "EVENT:CHARGE_PAID";
  const isPaidStatus = ["PAID", "APPROVED", "COMPLETED", "PAGO", "CONFIRMED"].includes(rawStatus);
  const isPaid = isPaidEvent || isPaidStatus || Boolean(data.paidAt || payload.paidAt);

  if (!correlationID && !externalId) {
    return res.status(200).json({ success: true, received: true, ignored: true, reason: "NO_IDENTIFIER" });
  }

  try {
    const result = await reconcileDotfyHybrid(correlationID || externalId, externalId || correlationID, {
      ...payload,
      status: isPaid ? "PAID" : rawStatus,
      paid: isPaid,
      isPaid
    });

    console.log("[dotfy webhook reconciled]", {
      correlationID,
      externalId,
      rawEvent,
      rawStatus,
      isPaid,
      status: result.status,
      credited: result.credited,
      walletSource: result.walletSource || result.payment?.walletSource || null,
    });

    return res.status(200).json({
      success: true,
      received: true,
      status: result.status,
      credited: Boolean(result.credited),
    });
  } catch (e) {
    console.error("[dotfy webhook reconciliation error]", correlationID, e?.message || e);
    // Retorna 200 para evitar que o gateway fique re-tentando infinitamente se o documento não for desta app
    return res.status(200).json({ success: false, received: true, error: e?.message || String(e) });
  }
}

// Endpoints oficiais do Webhook Dotfy
app.post("/webhooks/dotfy", handleWebhookReconciliation);
app.post("/webhook/dotfy", handleWebhookReconciliation);
app.post("/api/webhooks/dotfy", handleWebhookReconciliation);
app.post("/api/webhook/dotfy", handleWebhookReconciliation);
app.post("/webhooks/charges", handleWebhookReconciliation);
app.post("/api/webhooks/charges", handleWebhookReconciliation);
app.post("/api/webhooks/pix", handleWebhookReconciliation);
app.post("/api/webhook/pix", handleWebhookReconciliation);


/* callback kept for providers that use seamless-wallet callbacks */
app.post("/api/igamewin/callback", async (req, res) => {
  const { action, user_code, amount, transaction_id, game_code, round_id } = req.body || {};
  if (!user_code) return res.status(400).json({ status: 0, message: "USER_REQUIRED" });

  try {
    const userRef = db.collection("users").doc(String(user_code));
    const output = await db.runTransaction(async t => {
      const user = await t.get(userRef);
      if (!user.exists) return { status: 0, message: "USER_NOT_FOUND", balance: 0 };

      let balance = Number(user.data()?.walletBalance ?? user.data()?.balance ?? 0);
      if (action === "user_balance") return { status: 1, message: "SUCCESS", balance: Number(balance.toFixed(2)) };
      if (!transaction_id) return { status: 0, message: "TRANSACTION_ID_REQUIRED", balance: Number(balance.toFixed(2)) };

      const txRef = db.collection("game_transactions").doc(String(transaction_id));
      const existing = await t.get(txRef);
      if (existing.exists) return { status: 1, message: "SUCCESS", balance: Number(existing.data()?.new_balance ?? balance) };

      const value = Math.abs(Number(amount || 0));
      if (!Number.isFinite(value)) return { status: 0, message: "INVALID_AMOUNT", balance: Number(balance.toFixed(2)) };

      let type = "UNKNOWN";
      if (action === "user_bet") {
        if (balance < value) return { status: 0, message: "INSUFFICIENT_FUNDS", balance: Number(balance.toFixed(2)) };
        balance -= value; type = "BET";
      } else if (action === "user_win") {
        balance += value; type = "WIN";
      } else if (action === "user_rollback") {
        balance += value; type = "ROLLBACK";
      } else {
        return { status: 0, message: "UNKNOWN_ACTION", balance: Number(balance.toFixed(2)) };
      }

      balance = Number(balance.toFixed(2));
      t.set(userRef, { walletBalance: balance, balance, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      t.set(txRef, {
        uid: String(user_code),
        type,
        amount: value,
        game_code: game_code || "",
        round_id: round_id || "",
        new_balance: balance,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return { status: 1, message: "SUCCESS", balance };
    });
    res.json(output);
  } catch (e) {
    console.error("[callback]", e);
    res.status(500).json({ status: 0, message: "INTERNAL_ERROR" });
  }
});

if (!IS_NETLIFY) {
  // Direct route for link preview banner
  app.get("/previwslinks.png", (req, res) => {
    const publicPath = path.resolve(process.cwd(), "public", "banners", "bannerborah1.png");
    if (fs.existsSync(publicPath)) {
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "public, max-age=86400");
      return res.sendFile(publicPath);
    }
    res.status(404).send("Not found");
  });

  // Dedicated Open Graph preview generator for social media scrapers (WhatsApp, Telegram, Facebook, Twitter, Discord)
  const SOCIAL_BOT_REGEX = /facebookexternalhit|whatsapp|telegrambot|twitterbot|slackbot|discordbot|linkedinbot|embedly|quora link preview|pinterest|applebot/i;
  app.use((req, res, next) => {
    if (req.method !== "GET") return next();
    if (req.path.startsWith("/api/") || req.path.includes(".")) return next();

    const userAgent = req.get("user-agent") || "";
    if (SOCIAL_BOT_REGEX.test(userAgent)) {
      const proto = req.headers["x-forwarded-proto"] || req.protocol || "https";
      const host = req.get("host") || "borah.bet";
      const origin = `${proto}://${host}`;
      const targetUrl = `${origin}${req.originalUrl || ""}`;
      const imageUrl = `${origin}/banners/bannerborah1.png`;

      const html = `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <title>Trevo da Sorte — Plataforma Oficial | Cassino Online & Apostas Esportivas</title>
    <meta name="description" content="Trevo da Sorte — Plataforma oficial de entretenimento e jogos online com saques instantâneos via PIX, bônus exclusivos e suporte 24h." />
    <meta name="author" content="Trevo da Sorte" />
    
    <!-- Open Graph / WhatsApp / Facebook / Telegram -->
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="Trevo da Sorte" />
    <meta property="og:title" content="Trevo da Sorte — Plataforma Oficial | Cassino Online & Apostas Esportivas" />
    <meta property="og:description" content="Trevo da Sorte — Plataforma oficial de entretenimento e jogos online com saques instantâneos via PIX, bônus exclusivos e suporte 24h." />
    <meta property="og:url" content="${targetUrl}" />
    <meta property="og:image" content="${imageUrl}" />
    <meta property="og:image:secure_url" content="${imageUrl}" />
    <meta property="og:image:type" content="image/png" />
    <meta property="og:image:width" content="1733" />
    <meta property="og:image:height" content="908" />
    <meta property="og:image:alt" content="Trevo da Sorte — Plataforma Oficial" />
    
    <!-- Twitter / X -->
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:site" content="@borahbet" />
    <meta name="twitter:title" content="Trevo da Sorte — Plataforma Oficial | Cassino Online & Apostas Esportivas" />
    <meta name="twitter:description" content="Trevo da Sorte — Plataforma oficial de entretenimento e jogos online com saques instantâneos via PIX, bônus exclusivos e suporte 24h." />
    <meta name="twitter:image" content="${imageUrl}" />
    <meta name="twitter:image:alt" content="Trevo da Sorte — Plataforma Oficial" />
  </head>
  <body>
    <h1>Trevo da Sorte — Plataforma Oficial</h1>
    <p>Redirecionando para a plataforma oficial...</p>
    <script>window.location.href = "${targetUrl}";</script>
  </body>
</html>`;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "public, max-age=3600");
      return res.status(200).send(html);
    }
    next();
  });

  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.use((req, res, next) => {
      if (req.method === "GET" && !req.path.startsWith("/api/")) {
        return res.sendFile(path.join(distPath, "index.html"));
      }
      next();
    });
  }

  const server = app.listen(PRIMARY_PORT, HOST, () => {
    console.log(`TREVO DA SORTE backend listening on http://${HOST}:${PRIMARY_PORT}`);
    console.log(`Domain: resenhaa.bet`);
    console.log(`iGameWin: ${igwConfigured() ? "CONFIGURED" : "NOT CONFIGURED"} | ${IGW_URL}`);
    console.log(`Wallet sync: ${SYNC_WALLET ? "ON" : "OFF"} | RTP control: ${ENABLE_RTP_CONTROL ? "ON" : "OFF"}`);
    
    // Auto pre-warm catalog in background so games load instantly
    if (igwConfigured()) {
      setTimeout(async () => {
        try {
          console.log("[igw] Pre-warming game catalog in background...");
          await listProviders();
          await listGames("");
          console.log("[igw] Pre-warm completed successfully.");
        } catch (err) {
          console.warn("[igw] Pre-warm background notice:", err?.message || err);
        }
      }, 500);
    }
  });

  server.on("error", (err) => {
    console.error(`[Server Error on port ${PRIMARY_PORT}]:`, err?.message || err);
  });

  if (ALT_PORT) {
    try {
      const altServer = app.listen(ALT_PORT, HOST, () => {
        console.log(`TREVO DA SORTE backend also listening on http://${HOST}:${ALT_PORT} (Container alternate port)`);
      });
      altServer.on("error", (err) => {
        console.warn(`[Alt Server Notice on port ${ALT_PORT}]:`, err?.message || err);
      });
    } catch (e) {
      console.warn(`[Alt Port Bind Notice]:`, e?.message || e);
    }
  }
}

export { app };
