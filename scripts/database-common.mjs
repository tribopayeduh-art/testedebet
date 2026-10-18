import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import admin from "firebase-admin";

const ROOT = process.cwd();
for (const envFile of [".env.local", ".env"]) {
  const full = path.join(ROOT, envFile);
  if (fs.existsSync(full)) dotenv.config({ path: full, override: false });
}

let appletConfigFile = null;
try {
  const cfgPath = path.resolve(ROOT, "firebase-applet-config.json");
  if (fs.existsSync(cfgPath)) {
    appletConfigFile = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  }
} catch {}

function serviceAccountFromEnv() {
  const inline = String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "").trim();
  if (inline) {
    try { return JSON.parse(inline); }
    catch { throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON_INVALID"); }
  }

  const credentialPath = String(process.env.GOOGLE_APPLICATION_CREDENTIALS || "").trim();
  if (credentialPath) {
    const resolved = path.isAbsolute(credentialPath) ? credentialPath : path.join(ROOT, credentialPath);
    if (!fs.existsSync(resolved)) throw new Error(`GOOGLE_APPLICATION_CREDENTIALS_NOT_FOUND:${resolved}`);
    return JSON.parse(fs.readFileSync(resolved, "utf8"));
  }

  return null;
}

export function initAdmin() {
  if (!admin.apps.length) {
    const sa = serviceAccountFromEnv();
    const projectId = process.env.FIREBASE_PROJECT_ID || sa?.project_id || appletConfigFile?.projectId || "ai-studio-applet-webapp-6ac28";
    const databaseURL = process.env.FIREBASE_DATABASE_URL || (projectId ? `https://${projectId}-default-rtdb.firebaseio.com` : undefined);
    const storageBucket = process.env.FIREBASE_STORAGE_BUCKET || appletConfigFile?.storageBucket || `${projectId}.firebasestorage.app`;

    admin.initializeApp({
      ...(sa ? { credential: admin.credential.cert(sa) } : {}),
      projectId,
      databaseURL,
      storageBucket,
    });
  }
  return admin;
}

export function envAdminEmails() {
  return String(process.env.ADMIN_EMAILS || "nacional@gmail.com,admin1.eduh@gmail.com,tribopayeduh@gmail.com,admin.eduh1@gmail.com,bancoiproxy@gmail.com,administrador@gmail.com,admin.luis@gmail.com")
    .split(",").map(x=>x.trim().toLowerCase()).filter(Boolean);
}

export function serverTimestamp() {
  return admin.firestore.FieldValue.serverTimestamp();
}
