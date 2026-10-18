import axios from 'axios';
import fs from 'fs';
import { PLATFORM_DEFAULTS } from '../server/platform-defaults.mjs';

const token = PLATFORM_DEFAULTS.dotfy.apiKey;
console.log('Dotfy token available:', Boolean(token));

const deposits = [
  { id: '485df925-5f8c-48ff-9d1b-792676ce0a1b', correlationID: 'dotfyc-1788279267096-910b7be5', uid: 'RUqxeUL7zbOJUWAOgD568idRNcj2', amount: 100 },
  { id: '7380b6d6-8c80-4c65-ac1b-0db2641910b9', correlationID: 'dotfyc-1788382523369-5e12b4d6', uid: 'al4CFgsfNQN0BEFJczQYjAe1ZyG3', amount: 30 },
  { id: '14b309a4-8c03-41d7-b470-8581fc391a70', correlationID: 'dotfyc-1788306179172-fc8d9df5', uid: 'GxkhhQKaEoZfGkmXPlkzumel5Ty1', amount: 22.9 },
  { id: 'd76f9c3e-d9d9-4427-94b2-805ceffcb1fe', correlationID: 'dotfyc-1788305485048-eeec2324', uid: 'GxkhhQKaEoZfGkmXPlkzumel5Ty1', amount: 22.9 },
  { id: '0f2b3da7-7884-4356-991f-103f1ba40085', correlationID: 'dotfyc-1788384315153-166621a8', uid: '5cZqPuo6ewTq9ZdhA7KeHYABzyy2', amount: 30 },
  { id: '77a39041-b8c3-46a4-8eae-b58a88923c98', correlationID: 'dotfyc-1788377839449-d0cb33f6', uid: 'pNsqUwgWruXoxjnbFqb4maujp1n2', amount: 300 },
  { id: '50e32038-6603-487c-9d7a-d780c89b97ab', correlationID: 'dotfyc-1788386915326-10482836', uid: 'BK8Q3jeQ0nYk65PlKcqNc9CgI2n2', amount: 30 },
  { id: '303d4ed9-bfbb-46dd-b975-c89ca5cb1ce8', correlationID: 'dotfyc-1788384637741-3d01fbca', uid: '5cZqPuo6ewTq9ZdhA7KeHYABzyy2', amount: 30 },
  { id: '1732feb5-7313-435a-bceb-9666c55b432e', correlationID: 'dotfyc-1788386568631-e6bdbabe', uid: 'd16Bi0PLEXSUCd7sPiraLlbAr4Q2', amount: 30 },
  { id: 'a15784da-7cb4-46fe-bcf9-82b59245ec5d', correlationID: 'dotfyc-1788385531545-b4a19bd5', uid: 'SUkceUnRgzWUk0diVTx3Ob9LI6D2', amount: 26 },
  { id: '95fc0d91-be5d-4c3a-a75a-1f849a429e73', correlationID: 'dotfyc-1788367300885-c8b51333', uid: 'RUqxeUL7zbOJUWAOgD568idRNcj2', amount: 25 },
  { id: '94184a76-8c9b-4e98-af9d-147c52584e27', correlationID: 'dotfyc-1788383841134-07f55f02', uid: 'SUkceUnRgzWUk0diVTx3Ob9LI6D2', amount: 26 },
  { id: 'ca73754f-234c-4e8d-a44d-ef9786a568ac', correlationID: 'dotfyc-1788386388270-1398c816', uid: 'al4CFgsfNQN0BEFJczQYjAe1ZyG3', amount: 30 },
  { id: '79293f5b-5b39-4740-91ab-0bdfeaf48470', correlationID: 'dotfyc-1788387404654-9bae10c5', uid: '2zFghdu8DEger2VTTs90OLa3lJg1', amount: 50 },
  { id: '637a999b-f30e-486f-a51a-8df29a3b563a', correlationID: 'dotfyc-1788278488902-cb1c40f0', uid: 'RUqxeUL7zbOJUWAOgD568idRNcj2', amount: 150 },
  { id: '1fac161c-a075-46e0-8905-1912b10d688a', correlationID: 'dotfyc-1788306647521-6a888bcb', uid: 'GxkhhQKaEoZfGkmXPlkzumel5Ty1', amount: 22.9 }
];

async function checkAll() {
  const paid = [];
  const notPaid = [];
  for (const dep of deposits) {
    try {
      const res = await axios.get(`https://app.dotfy.com.br/api/charges/${dep.correlationID}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        validateStatus: () => true
      });
      const data = res.data?.data || res.data || {};
      const status = data.status;
      const isPaid = data.isPaid;
      console.log(`[${status}] ID:${dep.id.slice(0, 8)} Corr:${dep.correlationID} isPaid:${isPaid} val:${dep.amount} uid:${dep.uid.slice(0, 8)}`);
      if (isPaid || ['PAID', 'APPROVED', 'CONFIRMED', 'COMPLETED'].includes(status)) {
        paid.push({ ...dep, data });
      } else {
        notPaid.push({ ...dep, status });
      }
    } catch(e) {
      console.log(`Dep ${dep.id} error:`, e.message);
    }
  }

  console.log(`\nSummary: Total ${deposits.length} checked. Paid: ${paid.length}, Unpaid: ${notPaid.length}`);
  if (paid.length > 0) {
    console.log('PAID DEPOSITS FOUND:', JSON.stringify(paid, null, 2));
  }
}

checkAll();
