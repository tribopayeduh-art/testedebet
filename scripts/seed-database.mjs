import { initAdmin, envAdminEmails, serverTimestamp } from "./database-common.mjs";

const admin = initAdmin();
const db = admin.firestore();

const defaults = [
  ["system", "settings", {
    brandName:"Amora BET",
    currency:"BRL",
    locale:"pt-BR",
    minDeposit:Number(process.env.PAYONPAG_MIN_DEPOSIT || 10),
    maintenanceMode:false,
    registrationEnabled:true,
    depositsEnabled:true,
    withdrawalsEnabled:true,
    responsibleGamingEnabled:true,
    databaseSchemaVersion:1,
  }],
  ["system", "winners_config", {
    enabled:true,
    source:"MIXED",
    refreshSeconds:18,
    maxRows:8,
  }],
  ["system", "home_layout", {
    sections:[
      "BANNER","CATEGORIES","FEATURED","WINNERS","PRAGMATIC_LIVE",
      "MOST_PLAYED","FAST_GAMES","NEW_RELEASES","PROMO_BANNER",
      "SLOTS","LIVE_CASINO","PROVIDERS","AMORA_CLUB","AFFILIATE",
      "RESPONSIBLE","POPULAR"
    ],
  }],
  ["public_config", "marketing_tracking", {
    enabled:true,
    metaPixelId:"",
    tiktokPixelId:"",
    googleAdsId:"",
    googleConversions:{},
  }],
  ["system_private", "payonpag", {
    provider:"PAYONPAG",
    enabled:String(process.env.PAYONPAG_ENABLED || "true").toLowerCase()==="true",
    credentialSource:process.env.PAYONPAG_API_SECRET ? "ENV" : "NOT_CONFIGURED",
    recipientConfigured:Boolean(process.env.PAYONPAG_RECIPIENT_ID),
    webhookUrl:process.env.PAYONPAG_WEBHOOK_URL || "",
    minDeposit:Number(process.env.PAYONPAG_MIN_DEPOSIT || 10),
    maxDeposit:Number(process.env.PAYONPAG_MAX_DEPOSIT || 100000),
    timeoutMs:Number(process.env.PAYONPAG_TIMEOUT_MS || 10000),
    configured:Boolean(process.env.PAYONPAG_API_SECRET),
  }],
  ["system_private", "igamewin", {
    provider:"IGAMEWIN",
    enabled:true,
    apiUrl:process.env.IGAMEWIN_API_URL || "https://igamewin.com/api/v1",
    agentConfigured:Boolean(process.env.IGAMEWIN_AGENT_CODE && process.env.IGAMEWIN_AGENT_TOKEN),
    timeoutMs:Number(process.env.IGAMEWIN_TIMEOUT_MS || 20000),
    cacheTtlMs:Number(process.env.IGAMEWIN_CACHE_TTL_MS || 900000),
    syncWallet:String(process.env.IGAMEWIN_SYNC_WALLET || "false").toLowerCase()==="true",
    rtpControl:String(process.env.IGAMEWIN_ENABLE_RTP_CONTROL || "false").toLowerCase()==="true",
    configured:Boolean(process.env.IGAMEWIN_AGENT_CODE && process.env.IGAMEWIN_AGENT_TOKEN),
  }],
  ["system_private", "cpf_api", {
    provider:"MANUAL_CPF",
    enabled:false,
    requiredOnSignup:true,
    manualOnly:true,
    exactDigits:11,
    autoFillName:false,
    requireAdult:false,
    configured:false,
  }],
];

for (const [collection,id,data] of defaults) {
  await db.collection(collection).doc(id).set({
    ...data,
    createdAt:serverTimestamp(),
    updatedAt:serverTimestamp(),
    bootstrapVersion:"0.24.11.9",
  }, { merge:true });
  console.log(`SEEDED ${collection}/${id}`);
}

const adminEmails = envAdminEmails();
if (!adminEmails.length) throw new Error("ADMIN_EMAILS_EMPTY");

for (const email of adminEmails) {
  try {
    const user = await admin.auth().getUserByEmail(email);
    await db.collection("users").doc(user.uid).set({
      uid:user.uid,
      email:String(user.email || email).toLowerCase(),
      displayName:user.displayName || "",
      role:"admin",
      admin:true,
      status:"ACTIVE",
      cpf:"",
      cpfValidated:false,
      walletBalance:0,
      balance:0,
      totalDeposits:0,
      totalWithdrawals:0,
      databaseSchemaVersion:1,
      createdAt:serverTimestamp(),
      updatedAt:serverTimestamp(),
      adminGrantedBy:"ADMIN_EMAILS",
    }, { merge:true });
    console.log(`ADMIN SEEDED ${email} -> ${user.uid}`);
  } catch (error) {
    console.warn(`ADMIN NOT FOUND IN FIREBASE AUTH: ${email} (${error?.code || error?.message})`);
  }
}

console.log("DATABASE SEED COMPLETE");
process.exit(0);
