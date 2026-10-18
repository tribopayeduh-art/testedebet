import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { spawnSync } from "node:child_process";

for (const file of [".env.local",".env"]) {
  const full=path.join(process.cwd(),file);
  if(fs.existsSync(full)) dotenv.config({path:full,override:false});
}

const expected="amorabet-f4405";
const configured=process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID;
if(configured!==expected) {
  console.error(`Firebase project mismatch. Expected ${expected}, got ${configured||"<missing>"}`);
  process.exit(2);
}

const cred=String(process.env.GOOGLE_APPLICATION_CREDENTIALS||"").trim();
if(!cred) {
  console.error("GOOGLE_APPLICATION_CREDENTIALS is required for database bootstrap.");
  process.exit(3);
}
const resolved=path.isAbsolute(cred)?cred:path.join(process.cwd(),cred);
if(!fs.existsSync(resolved)) {
  console.error(`Service account file not found: ${resolved}`);
  process.exit(4);
}
const sa=JSON.parse(fs.readFileSync(resolved,"utf8"));
if(sa.project_id!==expected) {
  console.error(`WRONG SERVICE ACCOUNT PROJECT: ${sa.project_id}. Expected ${expected}.`);
  process.exit(5);
}

console.log("PASS Firebase project");
console.log("PASS Service Account project");
console.log("Seeding clean database structure...");
const r=spawnSync(process.execPath,["scripts/seed-database.mjs"],{cwd:process.cwd(),stdio:"inherit",env:process.env});
process.exit(r.status||0);
