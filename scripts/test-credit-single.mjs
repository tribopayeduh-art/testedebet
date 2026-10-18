import axios from 'axios';
import { PLATFORM_DEFAULTS } from '../server/platform-defaults.mjs';

let cachedSystemAdminToken = null;
let cachedSystemAdminExpires = 0;

async function getSystemAdminIdToken() {
  const now = Date.now();
  if (cachedSystemAdminToken && cachedSystemAdminExpires > now + 60000) {
    return cachedSystemAdminToken;
  }
  const apiKey = PLATFORM_DEFAULTS.firebase.apiKey;
  const res = await axios.post(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`, {
    email: "system.service.admin@resenhabet.internal",
    password: "SystemAdminPasswordSecret2026!",
    returnSecureToken: true
  });
  cachedSystemAdminToken = res.data.idToken;
  cachedSystemAdminExpires = now + (Number(res.data.expiresIn || 3600) * 1000);
  return cachedSystemAdminToken;
}

function firestoreValueToJs(val) {
  if (!val || typeof val !== 'object') return val;
  if ('stringValue' in val) return val.stringValue;
  if ('integerValue' in val) return Number(val.integerValue);
  if ('doubleValue' in val) return Number(val.doubleValue);
  if ('booleanValue' in val) return val.booleanValue;
  if ('timestampValue' in val) return val.timestampValue;
  if ('nullValue' in val) return null;
  if ('mapValue' in val) {
    const obj = {};
    for (const [k, v] of Object.entries(val.mapValue.fields || {})) obj[k] = firestoreValueToJs(v);
    return obj;
  }
  if ('arrayValue' in val) {
    return (val.arrayValue.values || []).map(firestoreValueToJs);
  }
  return val;
}

function jsToFirestoreValue(val) {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === 'boolean') return { booleanValue: val };
  if (typeof val === 'number') {
    if (Number.isInteger(val)) return { integerValue: String(val) };
    return { doubleValue: val };
  }
  if (typeof val === 'string') return { stringValue: val };
  if (Array.isArray(val)) return { arrayValue: { values: val.map(jsToFirestoreValue) } };
  if (typeof val === 'object') {
    const fields = {};
    for (const [k, v] of Object.entries(val)) {
      if (v !== undefined) fields[k] = jsToFirestoreValue(v);
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}

async function creditDeposit(paymentId, uid, amount, paidAt) {
  const token = await getSystemAdminIdToken();
  const dbId = PLATFORM_DEFAULTS.firebase.firestoreDatabaseId;
  const projectId = PLATFORM_DEFAULTS.firebase.projectId;

  // 1. Get user doc
  const userUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${dbId}/documents/users/${uid}`;
  const userRes = await axios.get(userUrl, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (userRes.status !== 200) {
    throw new Error(`Failed to fetch user ${uid}`);
  }

  const uFields = userRes.data.fields || {};
  const currentBalance = firestoreValueToJs(uFields.walletBalance ?? uFields.balance) || 0;
  const priorDeposits = firestoreValueToJs(uFields.totalDeposits) || 0;
  const newBalance = Number((currentBalance + Number(amount)).toFixed(2));
  const newTotalDeposits = Number((priorDeposits + Number(amount)).toFixed(2));

  console.log(`User ${uid}: balance ${currentBalance} -> ${newBalance}, totalDeposits ${priorDeposits} -> ${newTotalDeposits}`);

  // 2. Patch user doc
  const userPatch = {
    walletBalance: newBalance,
    balance: newBalance,
    totalDeposits: newTotalDeposits,
    lastDepositAt: paidAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  if (priorDeposits <= 0) {
    userPatch.firstDepositAmount = Number(amount);
  }

  const userPatchFields = {};
  const userMask = [];
  for (const [k, v] of Object.entries(userPatch)) {
    userPatchFields[k] = jsToFirestoreValue(v);
    userMask.push(`updateMask.fieldPaths=${encodeURIComponent(k)}`);
  }

  const userPatchRes = await axios.patch(`${userUrl}?${userMask.join('&')}`, {
    fields: userPatchFields
  }, {
    headers: { Authorization: `Bearer ${token}` }
  });
  console.log(`User patch result:`, userPatchRes.status);

  // 3. Patch payment doc
  const payUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${dbId}/documents/payment_requests/${paymentId}`;
  const payPatch = {
    status: 'APPROVED',
    providerStatus: 'COMPLETED',
    credited: true,
    creditedAt: new Date().toISOString(),
    paidAt: paidAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  const payPatchFields = {};
  const payMask = [];
  for (const [k, v] of Object.entries(payPatch)) {
    payPatchFields[k] = jsToFirestoreValue(v);
    payMask.push(`updateMask.fieldPaths=${encodeURIComponent(k)}`);
  }

  const payPatchRes = await axios.patch(`${payUrl}?${payMask.join('&')}`, {
    fields: payPatchFields
  }, {
    headers: { Authorization: `Bearer ${token}` }
  });
  console.log(`Payment patch result:`, payPatchRes.status);

  return { ok: true, newBalance };
}

async function testSingle() {
  const result = await creditDeposit(
    '79293f5b-5b39-4740-91ab-0bdfeaf48470',
    '2zFghdu8DEger2VTTs90OLa3lJg1',
    50,
    '2026-09-02T22:17:55.371Z'
  );
  console.log('Single credit test result:', result);
}

testSingle();
