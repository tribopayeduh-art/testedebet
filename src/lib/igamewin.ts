import { getBrandedGameCover } from "./gameArtwork";
import { apiErrorMessage } from "./apiError";

export type IGameWinGame = {
  id: string;
  code: string;
  name: string;
  providerCode: string;
  providerName: string;
  image: string;
  category?: string;
  rtp?: string;
  featured?: boolean;
  sortOrder?: number;
  demo?: boolean;
};

export type IGameWinProvider = {
  id: string;
  code: string;
  name: string;
  image: string;
};

const CACHE_KEY_GAMES = "amora_catalog_games_v2";
const CACHE_KEY_PROVIDERS = "amora_catalog_providers_v2";

const brandGames = (games: IGameWinGame[]) => games.map(g => ({ ...g, image: getBrandedGameCover(g.name, g.code) || g.image }));

export function getCachedGames(): IGameWinGame[] {
  try {
    const raw = localStorage.getItem(CACHE_KEY_GAMES);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return brandGames(parsed);
    }
  } catch {}
  return [];
}

export function getCachedProviders(): IGameWinProvider[] {
  try {
    const raw = localStorage.getItem(CACHE_KEY_PROVIDERS);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {}
  return [];
}

export function saveCachedGames(games: IGameWinGame[]) {
  try {
    if (Array.isArray(games) && games.length > 0) {
      localStorage.setItem(CACHE_KEY_GAMES, JSON.stringify(games));
    }
  } catch {}
}

export function saveCachedProviders(providers: IGameWinProvider[]) {
  try {
    if (Array.isArray(providers) && providers.length > 0) {
      localStorage.setItem(CACHE_KEY_PROVIDERS, JSON.stringify(providers));
    }
  } catch {}
}

async function requestJson<T>(url: string, timeoutMs = 15000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(apiErrorMessage(r.status, data, "Falha ao consultar iGameWin"));
    return data as T;
  } finally {
    clearTimeout(timer);
  }
}

const pendingJson=new Map<string,Promise<unknown>>();
function getJson<T>(url:string):Promise<T>{
 const existing=pendingJson.get(url);if(existing)return existing as Promise<T>;
 const request=requestJson<T>(url).finally(()=>{pendingJson.delete(url);});pendingJson.set(url,request);return request;
}

export async function fetchIgamewinGames(provider?: string, maxAttempts = 1): Promise<IGameWinGame[]> {
  const qs = provider ? `?provider=${encodeURIComponent(provider)}` : "";
  let lastError: any = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const data = await getJson<{ games: IGameWinGame[] }>(`/api/igamewin/games${qs}`);
      if (Array.isArray(data?.games) && data.games.length > 0) {
        if (!provider) saveCachedGames(data.games);
        return brandGames(data.games);
      }
    } catch (err: any) {
      lastError = err;
    }
    if (attempt < maxAttempts) {
      await new Promise(res => setTimeout(res, 800 * attempt));
    }
  }

  // Fallback to cache if available
  const cached = getCachedGames();
  if (cached.length > 0 && !provider) {
    return cached;
  }

  if (lastError) throw lastError;
  return cached;
}

export async function fetchIgamewinProviders(maxAttempts = 1): Promise<IGameWinProvider[]> {
  let lastError: any = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const data = await getJson<{ providers: IGameWinProvider[] }>("/api/igamewin/providers");
      if (Array.isArray(data?.providers) && data.providers.length > 0) {
        saveCachedProviders(data.providers);
        return data.providers;
      }
    } catch (err: any) {
      lastError = err;
    }
    if (attempt < maxAttempts) {
      await new Promise(res => setTimeout(res, 800 * attempt));
    }
  }

  const cached = getCachedProviders();
  if (cached.length > 0) return cached;
  if (lastError) throw lastError;
  return [];
}
