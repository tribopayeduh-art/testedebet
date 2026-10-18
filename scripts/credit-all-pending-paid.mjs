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

const remainingDeposits = [
  { depId: '7380b6d6-8c80-4c65-ac1b-0db2641910b9', uid: 'al4CFgsfNQN0BEFJczQYjAe1ZyG3', amount: 30, paidAt: '2026-09-02T20:56:28.681Z' },
  { depId: '0f2b3da7-7884-4356-991f-103f1ba40085', uid: '5cZqPuo6ewTq9ZdhA7KeHYABzyy2', amount: 30, paidAt: '2026-09-02T21:25:43.297Z' },
  { depId: '50e32038-6603-487c-9d7a-d780c89b97ab', uid: 'BK8Q3jeQ0nYk65PlKcqNc9CgI2n2', amount: 30, paidAt: '2026-09-02T22:11:48.244Z' },
  { depId: '303d4ed9-bfbb-46dd-b975-c89ca5cb1ce8', uid: '5cZqPuo6ewTq9ZdhA7KeHYABzyy2', amount: 30, paidAt: '2026-09-02T21:31:17.404Z' },
  { depId: '1732feb5-7313-435a-bceb-9666c55b432e', uid: 'd16Bi0PLEXSUCd7sPiraLlbAr4Q2', amount: 30, paidAt: '2026-09-02T22:03:24.074Z' },
  { depId: '95fc0d91-be5d-4c3a-a75a-1f849a429e73', uid: 'RUqxeUL7zbOJUWAOgD568idRNcj2', amount: 25, paidAt: '2026-09-02T16:42:28.078Z' },
  { depId: '94184a76-8c9b-4e98-af9d-147c52584e27', uid: 'SUkceUnRgzWUk0diVTx3Ob9LI6D2', amount: 26, paidAt: '2026-09-02T21:19:00.200Z' }
];

async function creditRemaining() {
  const token = await getSystemAdminIdToken();
  const dbId = PLATFORM_DEFAULTS.firebase.firestoreDatabaseId;
  const projectId = PLATFORM_DEFAULTS.firebase.projectId;

  for (const item of remainingDeposits) {
    console.log(`Processing depId ${item.depId} for user ${item.uid}, amount: R$ ${item.amount}...`);

    // Check if payment already credited in firestore
    const payUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${dbId}/documents/payment_requests/${item.depId}`;
    const payCheck = await axios.get(payUrl, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (payCheck.data?.fields?.credited?.booleanValue === true) {
      console.log(`Payment ${item.depId} already credited. Skipping.`);
      continue;
    }

    // Get user document
    const userUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${dbId}/documents/users/${item.uid}`;
    const userRes = await axios.get(userUrl, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (userRes.status !== 200) {
      console.error(`User ${item.uid} not found!`);
      continue;
    }

    const uFields = userRes.data.fields || {};
    const currentBalance = firestoreValueToJs(uFields.walletBalance ?? uFields.balance) || 0;
    const priorDeposits = firestoreValueToJs(uFields.totalDeposits) || 0;
    const newBalance = Number((currentBalance + Number(item.amount)).toFixed(2));
    const newTotalDeposits = Number((priorDeposits + Number(item.amount)).toFixed(2));

    const userPatch = {
      walletBalance: newBalance,
      balance: newBalance,
      totalDeposits: newTotalDeposits,
      lastDepositAt: item.paidAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    if (priorDeposits <= 0) {
      userPatch.firstDepositAmount = Number(item.amount);
    }

    const userPatchFields = {};
    const userMask = [];
    for (const [k, v] of Object.entries(userPatch)) {
      userPatchFields[k] = jsToFirestoreValue(v);
      userMask.push(`updateMask.fieldPaths=${encodeURIComponent(k)}`);
    }

    await axios.patch(`${userUrl}?${userMask.join('&')}`, {
      fields: userPatchFields
    }, {
      headers: { Authorization: `Bearer ${token}` }
    });

    // Patch payment request
    const payPatch = {
      status: 'APPROVED',
      providerStatus: 'COMPLETED',
      credited: true,
      creditedAt: new Date().toISOString(),
      paidAt: item.paidAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const payPatchFields = {};
    const payMask = [];
    for (const [k, v] of Object.entries(payPatch)) {
      payPatchFields[k] = jsToFirestoreValue(v);
      payMask.push(`updateMask.fieldPaths=${encodeURIComponent(k)}`);
    }

    await axios.patch(`${payUrl}?${payMask.join('&')}`, {
      fields: payPatchFields
    }, {
      headers: { Authorization: `Bearer ${token}` }
    });

    console.log(`SUCCESS: Credited depId ${item.depId} (R$ ${item.amount}) to ${uFields.email?.stringValue || item.uid}. New balance: ${newBalance}`);
  }
}

creditRemaining();
