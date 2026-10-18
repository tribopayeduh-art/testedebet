import { supabaseEnabled, supabaseToken, requireSupabase } from './supabase';
import { auth } from "./firebase";
import { adminLocalFallback } from "./adminLocalFallback";

const adminGetCache = new Map<string, { data:any; expiresAt:number }>();
const GET_CACHE_TTL = 30_000;

export function invalidateAdminCache(prefix = "") {
  for (const key of adminGetCache.keys()) if (!prefix || key.startsWith(prefix)) adminGetCache.delete(key);
}

export type ApiError = Error & { code?: string; status?: number; payload?: any };

function statusMessage(status:number, data:any) {
  const serverMessage = data?.message || data?.details?.message || data?.details?.msg;
  if (serverMessage) return String(serverMessage);
  switch (status) {
    case 400: return "A solicitação contém dados inválidos.";
    case 401: return "Sua sessão expirou ou não é válida. Entre novamente.";
    case 403: return "Sua conta está autenticada, mas não possui permissão para esta operação.";
    case 404: return "A rota solicitada não foi encontrada no backend.";
    case 405: return "O servidor recebeu a rota, mas o método HTTP não é permitido. Verifique o proxy /api do Nginx.";
    case 429: return "Muitas solicitações em pouco tempo. Aguarde alguns instantes.";
    case 500: return "O backend encontrou um erro interno.";
    case 502: return "Uma integração externa não respondeu corretamente.";
    case 503: return "O serviço necessário ainda não está configurado ou está temporariamente indisponível.";
    default: return data?.error ? String(data.error) : `Erro HTTP ${status}.`;
  }
}

async function idToken(forceRefresh = false) {
  if(supabaseEnabled)return supabaseToken(forceRefresh);
  const user = auth?.currentUser;
  if (!user) {
    const e = new Error("Você precisa estar logado.") as ApiError;
    e.code = "AUTH_REQUIRED";
    e.status = 401;
    throw e;
  }
  return user.getIdToken(forceRefresh);
}

async function request<T>(path:string, init:RequestInit, forceRefresh=false) {
  if (!path.startsWith("/api/")) throw new Error("Admin API deve utilizar URL relativa /api/...");
  const token = await idToken(forceRefresh);
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(path, {
      ...init,
      signal: controller.signal,
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        "Content-Type":"application/json",
        Authorization:`Bearer ${token}`,
        "X-Amora-Client":"admin",
        ...(init.headers || {}),
      },
    });
    const data = await response.json().catch(() => ({}));
    return { response, data } as {response:Response;data:any};
  } catch (error:any) {
    const e = new Error(error?.name === "AbortError" ? "O backend demorou demais para responder." : "Não foi possível conectar ao backend.") as ApiError;
    e.code = error?.name === "AbortError" ? "API_TIMEOUT" : "API_NETWORK_ERROR";
    throw e;
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function adminApi<T = any>(path:string, init:RequestInit = {}):Promise<T> {
  const method = String(init.method || "GET").toUpperCase();
  if (method !== 'GET' && /\/(wallet-adjustment|zero-balance|grant-bonus)$/.test(path)) {
    const headers = new Headers(init.headers);
    if (!headers.has('Idempotency-Key')) headers.set('Idempotency-Key', crypto.randomUUID());
    init = {...init, headers: Object.fromEntries(headers.entries())};
  }
  const uid = supabaseEnabled
    ? (await requireSupabase().auth.getSession()).data.session?.user.id
    : auth?.currentUser?.uid;
  if (!uid) { const error = new Error('Você precisa estar logado.') as ApiError; error.code='AUTH_REQUIRED'; error.status=401; throw error; }
  // Never cache permission checks; other cached reads belong to a specific account.
  const cacheKey = method === "GET" && path !== '/api/admin/me' ? `${path}:user:${uid}` : "";

  if (cacheKey) {
    const cached = adminGetCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.data as T;
  } else {
    adminGetCache.clear();
  }

  let response: Response | null = null;
  let data: any = null;
  let networkError: any = null;

  try {
    const res = await request<T>(path, init, false);
    response = res.response;
    data = res.data;

    // One controlled refresh only.
    if (response.status === 401) {
      const refreshed = await request<T>(path, init, true);
      response = refreshed.response;
      data = refreshed.data;
    }
  } catch (err: any) {
    networkError = err;
  }

  // If the backend responded with success, return it directly or reconcile if empty
  if (response && response.ok) {
    if (!supabaseEnabled && path.startsWith("/api/admin/dashboard") && data?.metrics?.users === 0) {
      try {
        const fallbackResult = await adminLocalFallback(path, init);
        if (fallbackResult?.metrics && fallbackResult.metrics.users > 0) {
          data = fallbackResult;
        }
      } catch {}
    } else if (!supabaseEnabled && /^\/api\/admin\/users(?:\?|$)/.test(path)) {
      try {
        const fallbackResult = await adminLocalFallback(path, init);
        if (fallbackResult?.users && Array.isArray(fallbackResult.users)) {
          if (!data?.users || data.users.length === 0) {
            data = fallbackResult;
          } else {
            // Reconcilia sem duplicidade para garantir que TODOS os jogadores apareçam
            const userMap = new Map();
            for (const u of data.users) {
              const id = u.uid || u.id;
              if (id) userMap.set(id, u);
            }
            for (const u of fallbackResult.users) {
              const id = u.uid || u.id;
              if (id) {
                const existing = userMap.get(id);
                userMap.set(id, existing ? { ...u, ...existing } : u);
              }
            }
            const merged = Array.from(userMap.values());
            data = {
              ...data,
              users: merged,
              allUsers: merged,
              totalCount: merged.length,
              filteredCount: merged.length,
            };
          }
        }
      } catch {}
    } else if (!supabaseEnabled && path.startsWith("/api/admin/finance/dashboard") && data?.summary?.allDepositsCount === 0 && data?.summary?.allWithdrawalsCount === 0) {
      try {
        const fallbackResult = await adminLocalFallback(path, init);
        if (fallbackResult?.summary && (fallbackResult.summary.allDepositsCount > 0 || fallbackResult.summary.allWithdrawalsCount > 0)) {
          data = fallbackResult;
        }
      } catch {}
    } else if (!supabaseEnabled && path.startsWith("/api/admin/affiliates") && (!data?.affiliates || data.affiliates.length === 0)) {
      try {
        const fallbackResult = await adminLocalFallback(path, init);
        if (fallbackResult?.affiliates && fallbackResult.affiliates.length > 0) {
          data = fallbackResult;
        }
      } catch {}
    }
    if (cacheKey) adminGetCache.set(cacheKey, { data, expiresAt:Date.now() + GET_CACHE_TTL });
    return data as T;
  }

  // If server had 403/500/502/503/404 or network failed, try direct Firestore client fallback if available
  if (!supabaseEnabled && ((method === "GET" && (networkError || (response && [500, 502, 503, 404].includes(response.status)))) || (method !== "GET" && response?.status === 503 && data?.error === "ATOMIC_FIRESTORE_REQUIRED"))) {
    try {
      const fallbackResult = await adminLocalFallback(path, init);
      if (fallbackResult !== null && fallbackResult !== undefined) {
        if (cacheKey) adminGetCache.set(cacheKey, { data: fallbackResult, expiresAt: Date.now() + GET_CACHE_TTL });
        return fallbackResult as T;
      }
    } catch (fbErr: any) {
      console.warn("[Admin API Fallback Error]", fbErr);
    }
  }

  if (networkError) {
    throw networkError;
  }

  const error = new Error(statusMessage(response!.status, data)) as ApiError;
  error.status = response!.status;
  error.code = String(data?.error || `HTTP_${response!.status}`);
  error.payload = data;
  throw error;
}
