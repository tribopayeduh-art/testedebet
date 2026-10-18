import { initAdmin } from "./database-common.mjs";
import { spawnSync } from "node:child_process";

const REQUIRED = "DELETE-AMORABET-DATABASE";
const provided = process.argv.find(x=>x.startsWith("--confirm="))?.slice("--confirm=".length) || "";
if (provided !== REQUIRED) {
  console.error(`ABORTED. To erase Firestore + Realtime Database use: npm run db:reset -- --confirm=${REQUIRED}`);
  process.exit(2);
}

const admin = initAdmin();
const db = admin.firestore();

console.log("DANGER CONFIRMED: deleting all Firestore documents...");
const collections = await db.listCollections();
for (const col of collections) {
  const snap = await col.get();
  for (const doc of snap.docs) {
    await db.recursiveDelete(doc.ref);
  }
  console.log(`DELETED Firestore collection: ${col.id}`);
}

console.log("Deleting all Realtime Database data...");
try {
  await admin.database().ref("/").remove();
  console.log("DELETED Realtime Database root");
} catch (error) {
  console.warn("RTDB deletion warning:", error?.code || error?.message || error);
}

console.log("Database is empty. Seeding clean schema...");
const child = spawnSync(process.execPath, ["scripts/seed-database.mjs"], {
  cwd: process.cwd(),
  stdio:"inherit",
  env:process.env,
});
if (child.status !== 0) process.exit(child.status || 1);

console.log("RESET COMPLETE.");
console.log("Firebase Authentication users and Storage files were intentionally preserved.");
