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

async function fetchAllPaymentRequests() {
  const token = await getSystemAdminIdToken();
  const dbId = PLATFORM_DEFAULTS.firebase.firestoreDatabaseId;
  const projectId = PLATFORM_DEFAULTS.firebase.projectId;

  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${dbId}/documents:runQuery`;
  const res = await axios.post(url, {
    structuredQuery: {
      from: [{ collectionId: 'payment_requests' }],
      limit: 300
    }
  }, {
    headers: { Authorization: `Bearer ${token}` }
  });

  const docs = [];
  for (const item of res.data) {
    if (!item.document) continue;
    const id = item.document.name.split('/').pop();
    const f = item.document.fields || {};
    const d = { id };
    for (const [k, v] of Object.entries(f)) {
      d[k] = firestoreValueToJs(v);
    }
    docs.push(d);
  }
  return docs;
}

async function run() {
  const dotfyKey = PLATFORM_DEFAULTS.dotfy.apiKey;
  const list = await fetchAllPaymentRequests();
  console.log(`Total payment_requests in Firestore: ${list.length}`);

  const deposits = list.filter(p => p.type === 'DEPOSIT');
  console.log(`Deposits found: ${deposits.length}`);

  const paidOnDotfy = [];

  for (const dep of deposits) {
    const queryId = dep.correlationID || dep.correlationId || dep.chargeId || dep.id;
    if (!queryId) continue;
    try {
      const res = await axios.get(`https://app.dotfy.com.br/api/charges/${queryId}`, {
        headers: { Authorization: `Bearer ${dotfyKey}`, Accept: 'application/json' },
        validateStatus: () => true
      });
      const data = res.data?.data || res.data || {};
      const status = data.status;
      const isPaid = data.isPaid;
      const credited = dep.credited === true;
      const isActuallyPaid = isPaid || ['PAID', 'APPROVED', 'CONFIRMED', 'COMPLETED'].includes(status);

      if (isActuallyPaid) {
        paidOnDotfy.push({
          depId: dep.id,
          uid: dep.uid,
          amount: dep.amount,
          firestoreStatus: dep.status,
          credited,
          dotfyStatus: status,
          dotfyPaidAt: data.paidAt || data.paid_at,
          correlationID: dep.correlationID
        });
      }
    } catch (e) {
      console.log(`Error checking ${queryId}:`, e.message);
    }
  }

  console.log('--- RESULTS OF DOTFY CHECK ---');
  console.log(`Total paid on Dotfy: ${paidOnDotfy.length}`);
  console.table(paidOnDotfy);
}

run();
