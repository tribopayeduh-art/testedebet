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
  if (!apiKey) return null;
  try {
    const res = await axios.post(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`, {
      email: "system.service.admin@resenhabet.internal",
      password: "SystemAdminPasswordSecret2026!",
      returnSecureToken: true
    });
    if (res.data?.idToken) {
      cachedSystemAdminToken = res.data.idToken;
      cachedSystemAdminExpires = now + (Number(res.data.expiresIn || 3600) * 1000);
      return cachedSystemAdminToken;
    }
  } catch (e) {
    console.warn("[getSystemAdminIdToken] error:", e?.response?.data || e.message);
  }
  return null;
}

async function test() {
  const token = await getSystemAdminIdToken();
  console.log('System token obtained:', Boolean(token), 'Length:', token?.length);

  // Now test updating the Kauan deposit that was completed!
  const depId = '79293f5b-5b39-4740-91ab-0bdfeaf48470';
  const uid = '2zFghdu8DEger2VTTs90OLa3lJg1';
  const amount = 50;

  const dbId = PLATFORM_DEFAULTS.firebase.firestoreDatabaseId;
  const projectId = PLATFORM_DEFAULTS.firebase.projectId;

  // 1. Get current user document
  const userUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${dbId}/documents/users/${uid}`;
  const userRes = await axios.get(userUrl, {
    headers: { Authorization: `Bearer ${token}` }
  });
  console.log('User current doc exists:', userRes.status === 200, 'Fields:', userRes.data?.fields);

  // 2. Get payment doc
  const payUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${dbId}/documents/payment_requests/${depId}`;
  const payRes = await axios.get(payUrl, {
    headers: { Authorization: `Bearer ${token}` }
  });
  console.log('Payment doc status:', payRes.data?.fields?.status?.stringValue, 'credited:', payRes.data?.fields?.credited?.booleanValue);
}

test();
