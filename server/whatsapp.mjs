import fs from "node:fs";
import path from "node:path";
import QRCode from "qrcode";

let sock = null;
let qrDataUrl = "";
let qrRaw = "";
let status = "DISCONNECTED";
let lastError = "";
let started = false;
let connectionAttempts = 0;
let qrUpdatedAt = null;
let connectedAt = null;
let baileysVersion = "";
let generation = 0;

const AUTH_DIR = path.resolve(process.env.WHATSAPP_AUTH_DIR || ".wa-auth");

function normalizePhone(value="") {
  const digits = String(value).replace(/\D/g,"");
  if (!digits) return "";
  return digits.startsWith("55") ? digits : `55${digits}`;
}

function authExists() {
  try {
    return fs.existsSync(path.join(AUTH_DIR, "creds.json"));
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function resetRuntimeState({ keepError = false } = {}) {
  sock = null;
  started = false;
  status = "DISCONNECTED";
  qrDataUrl = "";
  qrRaw = "";
  qrUpdatedAt = null;
  connectedAt = null;
  if (!keepError) lastError = "";
}

export function toJid(phone) {
  const digits = normalizePhone(phone);
  return digits ? `${digits}@s.whatsapp.net` : "";
}

export function getWhatsAppState() {
  return {
    status,
    qrDataUrl,
    hasQr: Boolean(qrDataUrl),
    qrUpdatedAt,
    lastError,
    connected: status === "CONNECTED",
    connectedAt,
    connectionAttempts,
    authDir: AUTH_DIR,
    authExists: authExists(),
    baileysVersion,
    generation,
  };
}

async function resolveBaileys() {
  const mod = await import("@whiskeysockets/baileys");
  const makeWASocket =
    (typeof mod.makeWASocket === "function" ? mod.makeWASocket : null) ||
    (typeof mod.default === "function" ? mod.default : null) ||
    (typeof mod.default?.makeWASocket === "function" ? mod.default.makeWASocket : null) ||
    (typeof mod.default?.default === "function" ? mod.default.default : null) ||
    (typeof mod === "function" ? mod : null);

  if (typeof makeWASocket !== "function") {
    throw new Error("BAILEYS_SOCKET_FACTORY_NOT_FOUND");
  }

  const useMultiFileAuthState =
    mod.useMultiFileAuthState ||
    mod.default?.useMultiFileAuthState;
  const DisconnectReason =
    mod.DisconnectReason ||
    mod.default?.DisconnectReason ||
    {};
  const Browsers =
    mod.Browsers ||
    mod.default?.Browsers;
  const fetchLatestBaileysVersion =
    mod.fetchLatestBaileysVersion ||
    mod.default?.fetchLatestBaileysVersion;

  return {
    mod,
    makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    Browsers,
    fetchLatestBaileysVersion,
  };
}

export async function startWhatsApp({ waitForQrMs = 7000 } = {}) {
  if (status === "CONNECTED" && sock) return getWhatsAppState();
  if (started && sock) {
    if (!qrDataUrl && waitForQrMs > 0) {
      const startedWaiting = Date.now();
      while (!qrDataUrl && status !== "CONNECTED" && status !== "ERROR" && Date.now() - startedWaiting < waitForQrMs) {
        await sleep(250);
      }
    }
    return getWhatsAppState();
  }

  generation++;
  const myGeneration = generation;
  started = true;
  connectionAttempts++;
  status = "STARTING";
  lastError = "";
  qrDataUrl = "";
  qrRaw = "";
  qrUpdatedAt = null;

  fs.mkdirSync(AUTH_DIR, { recursive: true });

  try {
    const {
      makeWASocket,
      useMultiFileAuthState,
      DisconnectReason,
      Browsers,
      fetchLatestBaileysVersion,
    } = await resolveBaileys();

    if (typeof useMultiFileAuthState !== "function") {
      throw new Error("BAILEYS_AUTH_STATE_NOT_FOUND");
    }

    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

    let version;
    try {
      if (typeof fetchLatestBaileysVersion === "function") {
        const latest = await fetchLatestBaileysVersion();
        version = latest?.version;
        baileysVersion = Array.isArray(version) ? version.join(".") : String(version || "");
      }
    } catch (e) {
      // Version discovery failure should not prevent QR generation.
      lastError = `Version warning: ${e?.message || e}`;
    }

    const socketConfig = {
      auth: state,
      printQRInTerminal: false,
      markOnlineOnConnect: false,
      syncFullHistory: false,
      generateHighQualityLinkPreview: false,
      connectTimeoutMs: Number(process.env.WHATSAPP_CONNECT_TIMEOUT_MS || 60_000),
      defaultQueryTimeoutMs: Number(process.env.WHATSAPP_QUERY_TIMEOUT_MS || 60_000),
      keepAliveIntervalMs: 20_000,
      retryRequestDelayMs: 250,
    };

    if (Array.isArray(version)) socketConfig.version = version;
    if (Browsers?.ubuntu) socketConfig.browser = Browsers.ubuntu("Resenha Bet");
    else if (Browsers?.macOS) socketConfig.browser = Browsers.macOS("Resenha Bet");

    const currentSock = makeWASocket(socketConfig);
    sock = currentSock;
    status = "CONNECTING";

    currentSock.ev.on("creds.update", saveCreds);

    currentSock.ev.on("connection.update", async update => {
      if (myGeneration !== generation) return;

      const { connection, lastDisconnect, qr, isNewLogin } = update || {};

      if (qr) {
        try {
          qrRaw = qr;
          qrDataUrl = await QRCode.toDataURL(qr, {
            margin: 2,
            width: 420,
            errorCorrectionLevel: "M",
          });
          qrUpdatedAt = new Date().toISOString();
          status = "QR_READY";
          lastError = "";
        } catch (e) {
          lastError = `QR_RENDER_FAILED: ${e?.message || e}`;
          status = "ERROR";
        }
      }

      if (connection === "connecting" && !qrDataUrl) {
        status = "CONNECTING";
      }

      if (connection === "open") {
        status = "CONNECTED";
        connectedAt = new Date().toISOString();
        qrDataUrl = "";
        qrRaw = "";
        qrUpdatedAt = null;
        lastError = "";
      }

      if (connection === "close") {
        const code =
          lastDisconnect?.error?.output?.statusCode ||
          lastDisconnect?.error?.statusCode ||
          lastDisconnect?.error?.data?.statusCode ||
          0;

        lastError = lastDisconnect?.error?.message || `Connection closed (${code || "unknown"})`;
        sock = null;
        started = false;

        const loggedOut = Number(code) === Number(DisconnectReason?.loggedOut || 401);
        const restartRequired = Number(code) === Number(DisconnectReason?.restartRequired || 515);

        if (loggedOut) {
          status = "LOGGED_OUT";
          qrDataUrl = "";
          qrRaw = "";
          return;
        }

        status = restartRequired ? "RESTARTING" : "DISCONNECTED";
        setTimeout(() => {
          if (myGeneration === generation) startWhatsApp({ waitForQrMs: 0 }).catch(() => {});
        }, restartRequired ? 800 : 2500);
      }

      if (isNewLogin && status !== "CONNECTED") {
        status = qrDataUrl ? "QR_READY" : "AUTHENTICATING";
      }
    });

    if (waitForQrMs > 0) {
      const startedWaiting = Date.now();
      while (!qrDataUrl && status !== "CONNECTED" && status !== "ERROR" && status !== "LOGGED_OUT" && Date.now() - startedWaiting < waitForQrMs) {
        await sleep(250);
      }
    }

    return getWhatsAppState();
  } catch (e) {
    status = "ERROR";
    lastError = e?.message || String(e);
    sock = null;
    started = false;
    throw e;
  }
}

export async function regenerateWhatsAppQr() {
  generation++;
  try {
    if (sock) {
      try { sock.end?.(new Error("QR_REGENERATE")); } catch {}
      try { sock.ws?.close?.(); } catch {}
    }
  } catch {}

  resetRuntimeState();

  // A stale auth folder commonly prevents a new QR from being emitted.
  try {
    if (fs.existsSync(AUTH_DIR)) fs.rmSync(AUTH_DIR, { recursive: true, force: true });
  } catch (e) {
    lastError = `AUTH_RESET_FAILED: ${e?.message || e}`;
  }

  fs.mkdirSync(AUTH_DIR, { recursive: true });
  return startWhatsApp({ waitForQrMs: 9000 });
}

export async function disconnectWhatsApp({ clearAuth = false } = {}) {
  generation++;
  try { await sock?.logout?.(); } catch {}
  try { sock?.ws?.close?.(); } catch {}

  resetRuntimeState();

  if (clearAuth) {
    try {
      if (fs.existsSync(AUTH_DIR)) fs.rmSync(AUTH_DIR, { recursive: true, force: true });
      fs.mkdirSync(AUTH_DIR, { recursive: true });
    } catch (e) {
      lastError = `AUTH_CLEAR_FAILED: ${e?.message || e}`;
    }
  }

  return getWhatsAppState();
}

export async function sendWhatsAppText(phone, text) {
  if (!sock || status !== "CONNECTED") throw new Error("WHATSAPP_NOT_CONNECTED");
  const jid = toJid(phone);
  if (!jid) throw new Error("INVALID_PHONE");
  return sock.sendMessage(jid, { text: String(text) });
}

export async function sendCampaign({ recipients, text, delayMs=1500, onResult }) {
  const delay = Math.max(1000, Number(delayMs || 1500));
  for (const recipient of recipients) {
    try {
      await sendWhatsAppText(recipient.phone, text);
      await onResult?.(recipient, true, null);
    } catch (e) {
      await onResult?.(recipient, false, e?.message || String(e));
    }
    await sleep(delay);
  }
}

export const connectToWhatsApp = startWhatsApp;

export async function initializeInstances() {
  try {
    console.log("Initializing WhatsApp instances cluster...");
    // Return status without throwing fatal exceptions to protect process lifecycle
    return await getWhatsAppState();
  } catch (err) {
    console.error("WhatsApp instance initialization warning:", err?.message || err);
    return null;
  }
}
