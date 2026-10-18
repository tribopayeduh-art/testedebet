import fs from "node:fs";
import path from "node:path";

const requiredPublic = [
  "VITE_FIREBASE_API_KEY",
  "VITE_FIREBASE_AUTH_DOMAIN",
  "VITE_FIREBASE_PROJECT_ID",
  "VITE_FIREBASE_STORAGE_BUCKET",
  "VITE_FIREBASE_MESSAGING_SENDER_ID",
  "VITE_FIREBASE_APP_ID",
];

const requiredServer = [
  "FIREBASE_PROJECT_ID",
  "ADMIN_EMAILS",
];

let failed = false;

for (const key of requiredPublic) {
  const ok = Boolean(process.env[key]);
  console.log(`${ok ? "PASS" : "FAIL"} ${key}`);
  if (!ok) failed = true;
}

for (const key of requiredServer) {
  const ok = Boolean(process.env[key]);
  console.log(`${ok ? "PASS" : "FAIL"} ${key}`);
  if (!ok) failed = true;
}

const forbidden = Object.keys(process.env).filter(k =>
  /^VITE_/.test(k) &&
  /(SECRET|TOKEN|PRIVATE|SERVICE_ACCOUNT|PASSWORD|PAYON|IGAMEWIN)/i.test(k)
);

if (forbidden.length) {
  failed = true;
  console.error("FAIL server secrets exposed through VITE_*:", forbidden.join(", "));
} else {
  console.log("PASS no server secrets in VITE_*");
}

const port = Number(process.env.PORT || 8080);
console.log(`INFO Cloud Run port: ${port}`);

process.exit(failed ? 1 : 0);
