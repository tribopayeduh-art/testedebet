import {
  addDoc, collection, deleteDoc, doc, documentId, getDoc, getDocs, limit, orderBy, query, startAfter,
  runTransaction, serverTimestamp, setDoc, updateDoc, writeBatch
} from "firebase/firestore";
import { auth, db } from "./firebase";

type AnyObj = Record<string, any>;

function ensureDb() {
  if (!db) throw new Error("Firebase/Firestore não configurado.");
  return db;
}
function bodyOf(init: RequestInit = {}) {
  if (!init.body) return {};
  if (typeof init.body === "string") {
    try { return JSON.parse(init.body); } catch { return {}; }
  }
  return init.body as any;
}
function tsMs(v: any) {
  if (!v) return 0;
  if (typeof v?.toMillis === "function") return v.toMillis();
  if (v?.seconds) return Number(v.seconds) * 1000;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : 0;
}
async function listCol(name: string, max = 0): Promise<AnyObj[]> {
  try {
    const colRef = collection(ensureDb(), name);
    const snap = max > 0 ? await getDocs(query(colRef, limit(max))) : await getDocs(colRef);
    return snap.docs.map(d => ({ id: d.id, ...(d.data() as AnyObj) })) as AnyObj[];
  } catch (err) {
    console.warn(`[adminLocalFallback listCol ${name}]`, err);
    return [];
  }
}
async function audit(action: string, metadata: AnyObj = {}) {
  try {
    const uid = auth?.currentUser?.uid || "";
    await addDoc(collection(ensureDb(), "admin_audit_logs"), {
      action, actorUid: uid, metadata, createdAt: serverTimestamp(),
    });
  } catch {}
}
function sortRecent(rows: any[]) {
  return [...rows].sort((a,b) => tsMs(b.createdAt || b.updatedAt) - tsMs(a.createdAt || a.updatedAt));
}
function params(path: string) {
  const u = new URL(path, location.origin);
  return { pathname: u.pathname, search: u.searchParams };
}
function response(data: any) {
  return { __localFallback: true, ...data };
}

async function dashboard() {
  const [users, payments, gameTx, tickets] = await Promise.all([
    listCol("users", 500), listCol("payment_requests", 600),
    listCol("game_transactions", 800), listCol("supportTickets", 250),
  ]);
  let totalWallet=0,activePlayers=0,depositsPending=0,withdrawalsPending=0,depositVolume=0,withdrawVolume=0,betVolume=0,winVolume=0;
  for (const u of users) {
    totalWallet += Number(u.walletBalance ?? u.balance ?? 0);
    if (!["BLOCKED","SUSPENDED"].includes(String(u.status||"ACTIVE"))) activePlayers++;
  }
  for (const p of payments) {
    if (p.type==="DEPOSIT") { if(["APPROVED","PAID"].includes(p.status))depositVolume+=Number(p.amount||0); if(!["APPROVED","PAID","REJECTED","CANCELLED"].includes(p.status)) depositsPending++; }
    if (p.type==="WITHDRAW") { if(["APPROVED","PAID"].includes(p.status))withdrawVolume+=Number(p.amount||0); if(!["APPROVED","PAID","REJECTED","CANCELLED"].includes(p.status)) withdrawalsPending++; }
  }
  for (const t of gameTx) { if(t.type==="BET") betVolume+=Number(t.amount||0); if(t.type==="WIN") winVolume+=Number(t.amount||0); }
  return response({
    success:true,
    metrics:{users:users.length,activePlayers,totalWallet,depositsPending,withdrawalsPending,depositVolume,withdrawVolume,betVolume,winVolume,ggrApprox:betVolume-winVolume,openTickets:tickets.filter(x=>x.status!=="CLOSED").length},
    recentPayments:sortRecent(payments).slice(0,8),
    recentGameTransactions:sortRecent(gameTx).slice(0,8),
  });
}
async function financeDashboard() {
  const [payments, users] = await Promise.all([listCol("payment_requests",800), listCol("users",500)]);
  const userMap = new Map(users.map((u:any)=>[u.id,u]));
  const s:any={depositRequested:0,depositPaid:0,depositPending:0,depositRejected:0,withdrawRequested:0,withdrawPaid:0,withdrawPending:0,withdrawRejected:0,paidDepositsCount:0,paidWithdrawalsCount:0,allDepositsCount:0,allWithdrawalsCount:0};
  const byDay=new Map<string,any>(), byUser=new Map<string,any>(), statuses:any={};
  for(const p of payments){
    const type=String(p.type||"").toUpperCase(), status=String(p.status||"UNKNOWN").toUpperCase(), amount=Number(p.amount||0), uid=String(p.uid||"");
    const settled=["PAID","APPROVED"].includes(status), rejected=["REJECTED","CANCELLED","FAILED"].includes(status), pending=!settled&&!rejected;
    statuses[`${type}:${status}`]=(statuses[`${type}:${status}`]||0)+1;
    if(type==="DEPOSIT"){s.depositRequested+=amount;s.allDepositsCount++;if(settled){s.depositPaid+=amount;s.paidDepositsCount++;}if(pending)s.depositPending+=amount;if(rejected)s.depositRejected+=amount;}
    if(type==="WITHDRAW"){s.withdrawRequested+=amount;s.allWithdrawalsCount++;if(settled){s.withdrawPaid+=amount;s.paidWithdrawalsCount++;}if(pending)s.withdrawPending+=amount;if(rejected)s.withdrawRejected+=amount;}
    const d=new Date(tsMs(p.createdAt)||Date.now()), key=d.toISOString().slice(0,10);
    const day=byDay.get(key)||{date:key,deposits:0,withdrawals:0,depositCount:0,withdrawalCount:0};
    if(type==="DEPOSIT"&&settled){day.deposits+=amount;day.depositCount++;}if(type==="WITHDRAW"&&settled){day.withdrawals+=amount;day.withdrawalCount++;}byDay.set(key,day);
    if(uid){const row=byUser.get(uid)||{uid,deposits:0,withdrawals:0,depositCount:0,withdrawalCount:0};if(type==="DEPOSIT"&&settled){row.deposits+=amount;row.depositCount++;}if(type==="WITHDRAW"&&settled){row.withdrawals+=amount;row.withdrawalCount++;}byUser.set(uid,row);}
  }
  s.netCashFlow=s.depositPaid-s.withdrawPaid;s.avgDepositTicket=s.paidDepositsCount?s.depositPaid/s.paidDepositsCount:0;s.avgWithdrawTicket=s.paidWithdrawalsCount?s.withdrawPaid/s.paidWithdrawalsCount:0;s.depositApprovalRate=s.allDepositsCount?s.paidDepositsCount/s.allDepositsCount*100:0;s.withdrawApprovalRate=s.allWithdrawalsCount?s.paidWithdrawalsCount/s.allWithdrawalsCount*100:0;
  const topDepositors=[...byUser.values()].sort((a:any,b:any)=>b.deposits-a.deposits).slice(0,12).map((r:any)=>({...r,displayName:(userMap.get(r.uid) as any)?.displayName||"Jogador",email:(userMap.get(r.uid) as any)?.email||"",net:r.deposits-r.withdrawals}));
  return response({success:true,summary:s,daily:[...byDay.values()].sort((a:any,b:any)=>a.date.localeCompare(b.date)).slice(-30),statuses:Object.entries(statuses).map(([key,count])=>{const [type,status]=key.split(":");return{type,status,count}}),topDepositors,recent:sortRecent(payments).slice(0,30)});
}

async function walletAdjust(uid:string, amount:number, reason:string, bonus=false, mode="SET", key="", zero=false) {
  if (!Number.isFinite(amount) || Math.abs(amount)>1000000 || !["SET","CREDIT","DEBIT","INCREMENT"].includes(mode) || (mode==="SET"&&amount<0) || (bonus&&(amount<=0||amount>100000))) throw new Error("Valor inválido.");
  const d=ensureDb(), userRef=doc(d,"users",uid);
  const logRef=doc(d,bonus?"bonus_grants":"wallet_adjustments",key||crypto.randomUUID());
  const result=await runTransaction(d,async tx=>{
    const previous=await tx.get(logRef);
    if(previous.exists())return previous.data();
    const snap=await tx.get(userRef);
    const before=Number(snap.data()?.walletBalance??snap.data()?.balance??0);
    const after=Number((mode==="SET"?amount:before+(mode==="DEBIT"?-Math.abs(amount):amount)).toFixed(2));
    if(!Number.isFinite(before)||after<0)throw new Error("Saldo insuficiente ou inválido.");
    const delta=Number((after-before).toFixed(2));
    tx.set(userRef,{uid,walletBalance:after,balance:after,realBalance:after,updatedAt:serverTimestamp(),...(zero?{bonusBalance:0}:{}),...(bonus?{bonusBalance:Number(snap.data()?.bonusBalance||0)+amount}:{}),...(snap.exists()?{}:{role:"player",status:"ACTIVE",kycStatus:"NOT_STARTED",createdAt:serverTimestamp()})},{merge:true});
    const result={uid,actorUid:auth?.currentUser?.uid||"",amount:delta,delta,mode,targetBalance:after,reason:reason||"Ajuste administrativo",before,after};
    tx.set(logRef,{...result,createdAt:serverTimestamp()});
    return result;
  });
  await audit(bonus?"BONUS_GRANT":"WALLET_ADJUSTMENT",result);
  return response({success:true,...result});
}

async function reports() {
  const [users,payments,tx,affiliates]=await Promise.all([listCol("users",1500),listCol("payment_requests",2500),listCol("game_transactions",5000),listCol("affiliates",700)]);
  const byDay=new Map<string,any>();
  const add=(v:any,type:string,amount:number)=>{const d=new Date(tsMs(v)||Date.now()),k=d.toISOString().slice(0,10),r=byDay.get(k)||{date:k,deposits:0,withdraws:0,bets:0,wins:0,registrations:0};r[type]+=Number(amount||0);byDay.set(k,r)};
  payments.forEach((p:any)=>{if(!["PAID","APPROVED"].includes(String(p.status).toUpperCase()))return;if(p.type==="DEPOSIT")add(p.createdAt,"deposits",p.amount);if(p.type==="WITHDRAW")add(p.createdAt,"withdraws",p.amount)});
  tx.forEach((t:any)=>{if(t.type==="BET")add(t.createdAt,"bets",t.amount);if(t.type==="WIN")add(t.createdAt,"wins",t.amount)});
  users.forEach((u:any)=>add(u.createdAt,"registrations",1));
  const daily=[...byDay.values()].sort((a:any,b:any)=>a.date.localeCompare(b.date)).slice(-30);
  const totals=daily.reduce((a:any,r:any)=>{for(const k of ["deposits","withdraws","bets","wins","registrations"])a[k]+=r[k];return a},{deposits:0,withdraws:0,bets:0,wins:0,registrations:0});
  return response({success:true,totals:{...totals,ggr:totals.bets-totals.wins,users:users.length,affiliates:affiliates.length},daily});
}

export async function adminLocalFallback(path:string, init:RequestInit={}):Promise<any|null>{
  if(!db || !auth?.currentUser) return null;
  const {pathname,search}=params(path), method=String(init.method||"GET").toUpperCase(), body=bodyOf(init);
  const d=ensureDb();

  if(pathname==="/api/admin/dashboard"&&method==="GET")return dashboard();
  if(pathname==="/api/admin/finance/dashboard"&&method==="GET")return financeDashboard();
  if(pathname==="/api/admin/operations/health"&&method==="GET")return response({success:true,health:{backend:false,firebase:true,igamewin:false,igamewinConfigured:true}});
  if(pathname==="/api/admin/reports"&&method==="GET")return reports();

  if(pathname==="/api/admin/users"&&method==="GET"){
    const limitParam = search.get("limit");
    const isAll = !limitParam || limitParam === "ALL" || limitParam === "all" || limitParam === "0";
    const rawLimit = isAll ? 0 : Number(limitParam);
    const pageSize = (!isNaN(rawLimit) && rawLimit > 0) ? rawLimit : 0;
    const qText = String(search.get("q")||"").trim().toLowerCase();
    let docs = await listCol("users", 0); // 0 = Sem limite artificial, carrega todos os jogadores
    if (!docs.length) {
      try {
        const arch = await listCol("archived_users", 0);
        if (arch.length) docs = arch;
      } catch {}
    }
    let rows = docs.map((data: any) => {
      const uid = data.id || data.uid;
      const rawName = data.displayName || data.name || data.fullName || data.nome || data.cpfApiName || data.username || (data.email ? data.email.split('@')[0] : '') || "Jogador";
      const bal = Number(data.walletBalance ?? data.balance ?? 0);
      return {
        uid,
        id: uid,
        ...data,
        displayName: rawName,
        name: rawName,
        walletBalance: bal,
        balance: bal,
        bonusBalance: Number(data.bonusBalance ?? 0),
        realBalance: Number(data.realBalance ?? bal),
        status: data.status || "ACTIVE",
        kycStatus: data.kycStatus || "NOT_STARTED",
        influencer: Boolean(data.influencer),
        withdrawLocked: Boolean(data.withdrawLocked),
      };
    });
    const totalCount = rows.length;
    if(qText) {
      const cleanQ = qText.replace(/^#/, "").trim();
      rows = rows.filter((u: any) => {
        const accClean = String(u.accountId || "").replace(/^#/, "").toLowerCase();
        const str = `${u.uid} ${u.accountId || ""} ${accClean} ${u.email || ""} ${u.displayName || ""} ${u.name || ""} ${u.cpf || ""} ${u.phone || ""}`.toLowerCase();
        return str.includes(qText) || (cleanQ && (str.includes(cleanQ) || accClean.includes(cleanQ)));
      });
    }
    rows.sort((a: any, b: any) => {
      const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return timeB - timeA;
    });
    const filteredCount = rows.length;
    const sliced = (pageSize > 0 && pageSize < rows.length) ? rows.slice(0, pageSize) : rows;
    return response({
      success: true,
      users: sliced,
      allUsers: rows,
      totalCount,
      filteredCount,
      limit: pageSize || totalCount,
      pageSize: sliced.length
    });
  }
  let m=pathname.match(/^\/api\/admin\/users\/([^/]+)$/);
  if(m&&method==="PATCH"){await setDoc(doc(d,"users",decodeURIComponent(m[1])),{...body,updatedAt:serverTimestamp()},{merge:true});await audit("USER_UPDATE",{targetUid:m[1]});return response({success:true})}
  m=pathname.match(/^\/api\/admin\/users\/([^/]+)\/wallet-adjustment$/);
  if(m&&method==="POST"){
    const adjMode = String(body.mode || (body.targetBalance !== undefined ? "SET" : "SET")).toUpperCase();
    const rawVal = Number(body.amount !== undefined ? body.amount : (body.targetBalance ?? 0));
    return walletAdjust(decodeURIComponent(m[1]), rawVal, String(body.reason||""), false, adjMode, new Headers(init.headers).get("Idempotency-Key")||"");
  }
  m=pathname.match(/^\/api\/admin\/users\/([^/]+)\/zero-balance$/);
  if(m&&method==="POST")return walletAdjust(decodeURIComponent(m[1]),0,"Saldo zerado pelo administrador",false,"SET",new Headers(init.headers).get("Idempotency-Key")||"",true);
  m=pathname.match(/^\/api\/admin\/users\/([^/]+)\/grant-bonus$/);
  if(m&&method==="POST")return walletAdjust(decodeURIComponent(m[1]),Number(body.amount||0),String(body.reason||"Bônus administrativo"),true,"CREDIT",new Headers(init.headers).get("Idempotency-Key")||"");

  if(pathname==="/api/admin/finance/queue-config"){
    if(method==="GET"){const snap=await getDoc(doc(d,"system","queue_priority_config"));return response({success:true,config:snap.data()||{enabled:true,weightAccountAge:2,weightDepositVolume:3}})}
    if(method==="PATCH"){await setDoc(doc(d,"system","queue_priority_config"),{...body,updatedAt:serverTimestamp()},{merge:true});return response({success:true})}
  }

  if(pathname==="/api/admin/payments"&&method==="GET"){
    const [payments, users, cfgSnap] = await Promise.all([
      listCol("payment_requests", 500),
      listCol("users", 800),
      getDoc(doc(d, "system", "queue_priority_config")).catch(() => null)
    ]);
    const cfg = (cfgSnap && cfgSnap.exists()) ? cfgSnap.data() || {} : {};
    const wAge = Math.max(1, Math.min(5, Number(cfg.weightAccountAge || 2)));
    const wVol = Math.max(1, Math.min(5, Number(cfg.weightDepositVolume || 3)));
    const userMap = new Map<string, any>();
    users.forEach((u: any) => userMap.set(u.id || u.uid, u));
    const now = Date.now();
    const enriched = payments.map((p: any) => {
      const u = userMap.get(p.uid) || {};
      const regTime = u.createdAt ? (u.createdAt.toDate ? u.createdAt.toDate().getTime() : new Date(u.createdAt).getTime()) : now;
      const accountAgeDays = Math.max(0, Math.floor((now - regTime) / (1000 * 60 * 60 * 24)));
      const depositVolume = Number(u.totalDeposits || p.userDepositVolume || 0);
      const normAge = Math.min(100, (accountAgeDays / 365) * 100);
      const normVol = Math.min(100, (depositVolume / 5000) * 100);
      const priorityScore = Math.round((((normAge * wAge) + (normVol * wVol)) / (wAge + wVol)) * 10) / 10;
      return { ...p, playerName: p.playerName || u.displayName || null, accountAgeDays, depositVolume, priorityScore };
    });
    return response({success:true, priorityConfig: { enabled: cfg.enabled !== false, weightAccountAge: wAge, weightDepositVolume: wVol }, payments:sortRecent(enriched)});
  }
  m=pathname.match(/^\/api\/admin\/payments\/([^/]+)$/);
  if(m&&method==="PATCH"){await setDoc(doc(d,"payment_requests",m[1]),{status:body.status,adminNote:String(body.note||""),adminUid:auth.currentUser.uid,updatedAt:serverTimestamp()},{merge:true});await audit("PAYMENT_STATUS",{paymentId:m[1],status:body.status});return response({success:true})}

  if(pathname==="/api/admin/support"&&method==="GET")return response({success:true,tickets:sortRecent(await listCol("supportTickets",500))});
  m=pathname.match(/^\/api\/admin\/support\/([^/]+)$/);
  if(m&&method==="PATCH"){await setDoc(doc(d,"supportTickets",m[1]),{status:body.status||"OPEN",adminReply:String(body.adminReply||""),updatedAt:serverTimestamp()},{merge:true});await audit("SUPPORT_UPDATE",{ticketId:m[1]});return response({success:true})}

  if (pathname === "/api/admin/affiliates" && method === "GET") {
    const [rawAffiliates, allUsers] = await Promise.all([
      listCol("affiliates", 1000).catch(() => []),
      listCol("users", 2000).catch(() => []),
    ]);
    const userMap = new Map<string, any>();
    allUsers.forEach((u: any) => userMap.set(String(u.id || u.uid), u));

    const referralCounts = new Map<string, { registrations: number; depositors: number }>();
    allUsers.forEach((u: any) => {
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
    });

    const mergedList: any[] = [];
    const processedUids = new Set<string>();

    rawAffiliates.forEach((a: any) => {
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
        createdAt: a.createdAt || user.createdAt || new Date().toISOString(),
      });
    });

    allUsers.forEach((u: any) => {
      const uid = String(u.id || u.uid);
      if (processedUids.has(uid)) return;
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
        commissionBalance: 0,
        createdAt: u.createdAt || new Date().toISOString(),
      });
    });

    mergedList.sort((a, b) => {
      const scoreA = (a.registrations * 10) + (a.depositors * 25) + a.clicks;
      const scoreB = (b.registrations * 10) + (b.depositors * 25) + b.clicks;
      if (scoreA !== scoreB) return scoreB - scoreA;
      return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
    });

    return response({
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
  }

  const simpleCrud:Record<string,{collection:string,key:string}> = {
    "/api/admin/promotions":{collection:"promotions",key:"promotions"},
    "/api/admin/bonuses":{collection:"bonuses",key:"bonuses"},
    "/api/admin/notifications":{collection:"notification_campaigns",key:"notifications"},
    "/api/admin/banner-campaigns":{collection:"banner_campaigns",key:"banners"},
    "/api/admin/winners/demo":{collection:"winners_demo",key:"rows"},
    "/api/admin/experiments":{collection:"experiments",key:"items"},
  };
  if(simpleCrud[pathname]){
    const spec=simpleCrud[pathname];
    if(method==="GET")return response({success:true,[spec.key]:sortRecent(await listCol(spec.collection,500))});
    if(method==="POST"){const ref=await addDoc(collection(d,spec.collection),{...body,createdAt:serverTimestamp(),updatedAt:serverTimestamp(),createdBy:auth.currentUser.uid});await audit(`${spec.collection.toUpperCase()}_CREATE`,{id:ref.id});return response({success:true,id:ref.id})}
  }
  for(const [base,spec] of Object.entries(simpleCrud)){
    const mm=pathname.match(new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}\\/([^/]+)$`));
    if(mm){
      if(method==="PATCH"){await setDoc(doc(d,spec.collection,mm[1]),{...body,updatedAt:serverTimestamp()},{merge:true});await audit(`${spec.collection.toUpperCase()}_UPDATE`,{id:mm[1]});return response({success:true})}
      if(method==="DELETE"){await deleteDoc(doc(d,spec.collection,mm[1]));await audit(`${spec.collection.toUpperCase()}_DELETE`,{id:mm[1]});return response({success:true})}
    }
  }

  m=pathname.match(/^\/api\/admin\/banner-campaigns\/([^/]+)\/duplicate$/);
  if(m&&method==="POST"){const snap=await getDoc(doc(d,"banner_campaigns",m[1]));if(!snap.exists())throw new Error("Banner não encontrado.");const src:any=snap.data();const ref=await addDoc(collection(d,"banner_campaigns"),{...src,name:`${src.name||src.title||"Banner"} — cópia`,active:false,status:"DRAFT",metrics:{impressions:0,clicks:0,conversions:0},createdAt:serverTimestamp(),updatedAt:serverTimestamp()});return response({success:true,id:ref.id})}

  if(pathname==="/api/admin/settings"||pathname==="/api/admin/configuration"){
    if(method==="GET"){const snap=await getDoc(doc(d,"system","settings"));return response({success:true,settings:snap.data()||{}})}
    if(method==="PATCH"){await setDoc(doc(d,"system","settings"),{...body,updatedAt:serverTimestamp()},{merge:true});await audit("PLATFORM_CONFIGURATION",{keys:Object.keys(body)});return response({success:true})}
  }

  if(pathname==="/api/admin/kyc"&&method==="GET"){const users=(await listCol("users",1000)).map((x:any)=>({uid:x.id,...x})).filter((u:any)=>u.kycStatus&&u.kycStatus!=="NOT_STARTED");return response({success:true,users})}
  m=pathname.match(/^\/api\/admin\/kyc\/([^/]+)$/);
  if(m&&method==="PATCH"){await setDoc(doc(d,"users",m[1]),{kycStatus:body.status,kycReviewedAt:serverTimestamp(),updatedAt:serverTimestamp()},{merge:true});await audit("KYC_UPDATE",{uid:m[1],status:body.status});return response({success:true})}

  if(pathname==="/api/admin/risk"&&method==="GET"){
    const [users,payments]=await Promise.all([listCol("users",1200),listCol("payment_requests",2000)]);
    const pending=new Map<string,number>();payments.filter((p:any)=>p.type==="WITHDRAW"&&!["PAID","APPROVED","REJECTED","CANCELLED"].includes(p.status)).forEach((p:any)=>pending.set(p.uid,(pending.get(p.uid)||0)+Number(p.amount||0)));
    const rows=users.map((u:any)=>({uid:u.id,...u,pendingWithdraw:pending.get(u.id)||0,riskScore:(u.withdrawLocked?40:0)+(u.status==="BLOCKED"?40:0)+(u.kycStatus==="REJECTED"?20:0)})).filter((u:any)=>u.riskScore>0||u.pendingWithdraw>0).sort((a:any,b:any)=>b.riskScore-a.riskScore);
    return response({success:true,rows});
  }
  m=pathname.match(/^\/api\/admin\/risk\/([^/]+)\/action$/);
  if(m&&method==="POST"){const action=String(body.action||"");const patch:any={updatedAt:serverTimestamp()};if(action==="LOCK_WITHDRAW")patch.withdrawLocked=true;if(action==="UNLOCK_WITHDRAW")patch.withdrawLocked=false;if(action==="SUSPEND")patch.status="SUSPENDED";if(action==="ACTIVATE")patch.status="ACTIVE";if(action==="BLOCK")patch.status="BLOCKED";await setDoc(doc(d,"users",m[1]),patch,{merge:true});await audit("RISK_ACTION",{uid:m[1],action});return response({success:true})}

  if(pathname==="/api/admin/game-overrides"&&method==="GET")return response({success:true,overrides:await listCol("game_overrides",1200)});
  m=pathname.match(/^\/api\/admin\/game-overrides\/(.+)$/);
  if(m&&method==="PATCH"){await setDoc(doc(d,"game_overrides",decodeURIComponent(m[1])),{...body,updatedAt:serverTimestamp()},{merge:true});return response({success:true})}

  if(pathname==="/api/admin/audit"&&method==="GET")return response({success:true,logs:sortRecent(await listCol("admin_audit_logs",600))});
  if(pathname==="/api/admin/responsible-gaming"&&method==="GET"){const rows=(await listCol("users",1000)).map((x:any)=>({uid:x.id,...x})).filter((u:any)=>u.selfExcludedUntil||u.responsibleLimits);return response({success:true,rows})}

  if(pathname==="/api/admin/notifications"&&method==="POST"){return null}
  m=pathname.match(/^\/api\/admin\/notifications\/([^/]+)\/publish$/);
  if(m&&method==="POST"){
    const cs=await getDoc(doc(d,"notification_campaigns",m[1]));if(!cs.exists())throw new Error("Campanha não encontrada.");const c:any=cs.data();const users=await listCol("users",1000);let delivered=0;const batch=writeBatch(d);
    for(const u of users){const include=c.audience==="ALL"||(c.audience==="ACTIVE"&&u.status==="ACTIVE")||(c.audience==="VIP"&&u.vip===true)||(c.audience==="DEPOSITORS"&&Number(u.totalDeposits||0)>0);if(!include)continue;const ref=doc(collection(d,"user_notifications"));batch.set(ref,{uid:u.id,title:c.title||"",body:c.body||"",type:"CAMPAIGN",campaignId:m[1],read:false,createdAt:serverTimestamp()});delivered++;if(delivered>=450)break;}
    await batch.commit();await setDoc(doc(d,"notification_campaigns",m[1]),{status:"PUBLISHED",delivered,publishedAt:serverTimestamp(),updatedAt:serverTimestamp()},{merge:true});return response({success:true,delivered});
  }

  if(pathname==="/api/admin/staff"&&method==="GET"){const rows=(await listCol("users",1000)).map((x:any)=>({uid:x.id,...x})).filter((u:any)=>["admin","finance","support","marketing","risk","viewer"].includes(String(u.role||"")));return response({success:true,staff:rows.map((u:any)=>({...u,disabled:["BLOCKED","SUSPENDED"].includes(u.status)}))})}
  m=pathname.match(/^\/api\/admin\/staff\/([^/]+)\/role$/);
  if(m&&method==="POST"){await setDoc(doc(d,"users",m[1]),{role:body.role,admin:body.role==="admin",updatedAt:serverTimestamp()},{merge:true});await audit("STAFF_ROLE_UPDATE",{targetUid:m[1],role:body.role});return response({success:true,firestoreOnly:true})}
  m=pathname.match(/^\/api\/admin\/staff\/([^/]+)\/disable$/);
  if(m&&method==="POST"){await setDoc(doc(d,"users",m[1]),{status:body.disabled?"BLOCKED":"ACTIVE",updatedAt:serverTimestamp()},{merge:true});await audit("STAFF_DISABLE_UPDATE",{targetUid:m[1],disabled:!!body.disabled});return response({success:true,firestoreOnly:true})}

  if(pathname==="/api/admin/integrations/tracking"){
    if(method==="GET"){const snap=await getDoc(doc(d,"system_private","marketing_tracking"));return response({success:true,config:snap.data()||{}})}
    if(method==="PATCH"){await setDoc(doc(d,"system_private","marketing_tracking"),{...body,updatedAt:serverTimestamp()},{merge:true});await setDoc(doc(d,"public_config","marketing_tracking"),{enabled:body.enabled!==false,metaPixelId:body.metaPixelId||"",tiktokPixelId:body.tiktokPixelId||"",googleAdsId:body.googleAdsId||"",googleConversions:body.googleConversions||{},updatedAt:serverTimestamp()},{merge:true});return response({success:true})}
  }

  if(pathname==="/api/admin/winners/config"){
    if(method==="GET"){const snap=await getDoc(doc(d,"system","winners_config"));return response({success:true,config:snap.data()||{}})}
    if(method==="PATCH"){await setDoc(doc(d,"system","winners_config"),{...body,updatedAt:serverTimestamp()},{merge:true});return response({success:true})}
  }
  if(pathname==="/api/admin/home-layout"){
    if(method==="GET"){const snap=await getDoc(doc(d,"system","home_layout"));return response({success:true,layout:snap.data()?.sections||[]})}
    if(method==="PATCH"){await setDoc(doc(d,"system","home_layout"),{sections:Array.isArray(body.sections)?body.sections:[],updatedAt:serverTimestamp()},{merge:true});return response({success:true})}
  }

  if(pathname==="/api/admin/whatsapp/campaigns"){
    if(method==="GET")return response({success:true,campaigns:sortRecent(await listCol("whatsapp_campaigns",400))});
    if(method==="POST"){const ref=await addDoc(collection(d,"whatsapp_campaigns"),{...body,audience:"OPTED_IN",status:"DRAFT",createdBy:auth.currentUser.uid,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});return response({success:true,id:ref.id})}
  }

  m=pathname.match(/^\/api\/admin\/whatsapp\/campaigns\/([^/]+)\/send$/);
  if(m&&method==="POST"){
    const campaignSnap=await getDoc(doc(d,"whatsapp_campaigns",m[1]));
    if(!campaignSnap.exists())throw new Error("Campanha não encontrada.");
    const campaign:any=campaignSnap.data();
    const users=(await listCol("users",1000)).filter((u:any)=>u.whatsappOptIn===true&&String(u.phone||"").trim());
    await setDoc(doc(d,"whatsapp_campaigns",m[1]),{status:"SENDING",recipientCount:users.length,startedAt:serverTimestamp(),updatedAt:serverTimestamp()},{merge:true});
    const token=await auth.currentUser.getIdToken();
    const delay=Math.max(1000,Number(campaign.delayMs||1500));

    void (async()=>{
      let sent=0,failed=0;
      for(const u of users){
        try{
          const r=await fetch("/api/admin/whatsapp/test",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},body:JSON.stringify({phone:u.phone,text:String(campaign.text||"")})});
          const payload=await r.json().catch(()=>({}));
          if(!r.ok)throw new Error(payload.error||payload.message||"Falha no envio");
          sent++;
          await addDoc(collection(d,"whatsapp_message_logs"),{campaignId:m![1],uid:u.id,phoneMasked:String(u.phone).replace(/\d(?=\d{4})/g,"*"),status:"SENT",createdAt:serverTimestamp()});
        }catch(e:any){
          failed++;
          try{await addDoc(collection(d,"whatsapp_message_logs"),{campaignId:m![1],uid:u.id,phoneMasked:String(u.phone).replace(/\d(?=\d{4})/g,"*"),status:"FAILED",error:e?.message||String(e),createdAt:serverTimestamp()})}catch{}
        }
        await new Promise(resolve=>setTimeout(resolve,delay));
      }
      await setDoc(doc(d,"whatsapp_campaigns",m![1]),{status:"FINISHED",sent,failed,finishedAt:serverTimestamp(),updatedAt:serverTimestamp()},{merge:true});
    })();

    return response({success:true,status:"SENDING",recipientCount:users.length,localFallback:true});
  }

  return null;
}
