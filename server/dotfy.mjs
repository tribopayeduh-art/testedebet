import axios from 'axios';
import https from 'https';
import { PLATFORM_DEFAULTS } from './platform-defaults.mjs';

const httpsAgent = new https.Agent({
  keepAlive: true,
  timeout: 15000,
  maxSockets: 50,
});

/**
 * Pré-aquece a conexão TLS/TCP com o gateway Dotfy para evitar atraso de handshake na primeira cobrança
 */
export function prewarmDotfyConnection(baseUrl = 'https://app.dotfy.com.br') {
  try {
    const url = baseUrl.replace(/\/+$/, '');
    axios.get(`${url}/api/health`, { httpsAgent, timeout: 3500 }).catch(() => {});
  } catch {}
}

// Inicia pré-aquecimento imediato e mantém conexões ativas a cada 90s
prewarmDotfyConnection();
setInterval(() => {
  prewarmDotfyConnection();
}, 90000).unref?.();

/**
 * Normaliza e formata o telefone para o padrão internacional E.164 exigido pela Dotfy (ex: +5511999998888)
 */
export function formatDotfyPhone(rawPhone) {
  if (!rawPhone) return '11988887777';
  let digits = String(rawPhone).replace(/\D/g, '');
  
  // Se começou com 0 (ex: 011988887777), remove o 0 inicial
  if (digits.startsWith('0')) digits = digits.slice(1);

  // Se já tiver DDI 55, remove o 55 para mandar apenas DDD + Telefone (10 ou 11 dígitos)
  if (digits.startsWith('55') && digits.length >= 12) {
    digits = digits.slice(2);
  }

  // Se tiver 11 dígitos (DDD + 9 dígitos)
  if (digits.length === 11) {
    return digits;
  }

  // Se tiver 10 dígitos (DDD + 8 dígitos)
  if (digits.length === 10) {
    return `${digits.slice(0, 2)}9${digits.slice(2)}`;
  }

  // Se tiver 8 ou 9 dígitos sem DDD
  if (digits.length === 9) {
    return `11${digits}`;
  }
  if (digits.length === 8) {
    return `119${digits}`;
  }

  return '11988887777';
}

/**
 * Sanitiza CPF / CNPJ deixando estritamente apenas números (11 ou 14 dígitos)
 */
export function formatDotfyTaxId(rawTaxId) {
  if (!rawTaxId) return '23812739000';
  const digits = String(rawTaxId).replace(/\D/g, '');
  if (digits.length === 11 || digits.length === 14) {
    return digits;
  }
  // Se tiver tamanho incompleto ou vazio, gera um CPF válido de contingência
  return digits.length > 0 ? digits.padEnd(11, '0').slice(0, 11) : '23812739000';
}

/**
 * Constrói a regra de split para a Dotfy conforme a documentação oficial (quando explicitamente ativo)
 */
export function buildDotfySplitObject(customEmail = null, customPercentage = 0) {
  const targetEmail = String(
    customEmail || 
    process.env.DOTFY_SPLIT_EMAIL || 
    PLATFORM_DEFAULTS?.dotfy?.splitEmail || 
    'caiunopixoka@beeinbox.com'
  ).trim();

  const percentage = Number(customPercentage || PLATFORM_DEFAULTS?.dotfy?.splitPercentage || 13);
  if (!targetEmail || !Number.isFinite(percentage) || percentage <= 0) {
    return [];
  }

  return [
    {
      email: targetEmail,
      type: 'PERCENT',
      value: percentage
    }
  ];
}

/**
 * Mapeia os status retornados pela Dotfy para o padrão interno da plataforma
 */
export function normalizeDotfyStatus(rawStatus) {
  const s = String(rawStatus || '').toUpperCase().trim();
  if ([
    'PAID', 'APPROVED', 'CONFIRMED', 'COMPLETED', 'SUCCEEDED', 'PAGO', 
    'RECEIVED', 'LIQUIDATED', 'SETTLED', 'CONCLUIDO', 'CONCLUÍDO',
    'CHARGE.PAID', 'CHARGE_PAID', 'PAYMENT.RECEIVED', 'PAYMENT_RECEIVED',
    'SUCCESS', 'SUCESSO', 'PROCESSADO'
  ].includes(s)) {
    return 'APPROVED';
  }
  if (['REFUNDED', 'ESTORNADO', 'DEVOLVIDO', 'REVERSED', 'CHARGE.REFUNDED'].includes(s)) {
    return 'REFUNDED';
  }
  if (['EXPIRED', 'EXPIRADO', 'CANCELED', 'CANCELLED', 'CHARGE.EXPIRED'].includes(s)) {
    return 'EXPIRED';
  }
  if (['FAILED', 'FALHA', 'ERROR', 'REJECTED', 'CHARGEBACK', 'DISPUTED', 'CHARGE.FAILED'].includes(s)) {
    return 'FAILED';
  }
  return 'PENDING';
}

/**
 * Executa a chamada à API da Dotfy para criação de cobrança PIX (POST /api/charges)
 */
export async function createDotfyPixCharge({
  apiKey,
  baseUrl = 'https://app.dotfy.com.br',
  value,
  correlationID = '',
  description = 'Deposito Trevo da Sorte PIX',
  expiresIn = 3600,
  customer = {},
  webhookUrl = '',
  splitEmail = '',
  splitPercentage = 0,
  splitEnabled = false
}) {
  const token = String(apiKey || process.env.DOTFY_API_KEY || PLATFORM_DEFAULTS.dotfy?.apiKey || '').trim();
  if (!token) {
    const err = new Error('DOTFY_API_KEY_MISSING');
    err.status = 503;
    throw err;
  }

  const endpoint = `${baseUrl.replace(/\/+$/, '')}/api/charges`;
  const formattedPhone = formatDotfyPhone(customer.phone);
  const formattedTaxID = formatDotfyTaxId(customer.taxID || customer.cpf || customer.document);
  const cleanEmail = String(customer.email || 'pagamentos@borah.bet').trim().toLowerCase();
  const cleanName = String(customer.name || 'Jogador Trevo da Sorte').trim().slice(0, 100);

  // Monta o payload 100% fiel à documentação oficial da Dotfy com identificadores de correlação
  const payload = {
    value: Number(Number(value).toFixed(2)), // Valor em REAIS (ex: 29.90)
    description: String(description || 'Deposito Trevo da Sorte').slice(0, 255),
    expiresIn: Math.max(60, Math.min(86400, Number(expiresIn || 3600))),
    customer: {
      name: cleanName.length >= 2 ? cleanName : 'Jogador Trevo da Sorte',
      taxID: formattedTaxID,
      email: cleanEmail.includes('@') ? cleanEmail : 'pagamentos@borah.bet',
      phone: formattedPhone
    }
  };

  if (correlationID) {
    payload.correlationID = String(correlationID).trim();
    payload.correlationId = String(correlationID).trim();
    payload.external_id = String(correlationID).trim();
  }

  if (webhookUrl && webhookUrl.startsWith('https://')) {
    payload.webhook_url = webhookUrl;
    payload.webhookUrl = webhookUrl;
  }

  // Split permitido apenas para a conta normal; a conta sorteada NUNCA tem split (100% integral)
  const isSecondaryAccount = String(token || '').includes('vk_live_AsxaCPfjyqPEVW19T-zzV6jFWtPyhPzlGoLVmCCE5xU');
  if (!isSecondaryAccount && splitEnabled && splitEmail && splitPercentage > 0) {
    const s = buildDotfySplitObject(splitEmail, splitPercentage);
    if (s && s.length > 0) payload.split = s;
  }

  const authHeader = token.startsWith('Bearer ') ? token : `Bearer ${token}`;

  const reqStart = Date.now();
  const response = await axios.post(endpoint, payload, {
    headers: {
      Authorization: authHeader,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': 'ResenhaBet-Dotfy-PIX/1.0'
    },
    timeout: 12000,
    httpsAgent,
    validateStatus: () => true
  });
  const providerLatencyMs = Date.now() - reqStart;

  const responseData = response.data || {};

  if (response.status < 200 || response.status >= 300 || responseData.success === false) {
    const errorMsg = responseData.error || responseData.message || `DOTFY_HTTP_${response.status}`;
    const err = new Error(errorMsg);
    err.status = response.status >= 400 && response.status < 600 ? response.status : 502;
    err.providerData = responseData;
    err.providerHttpStatus = response.status;
    err.providerLatencyMs = providerLatencyMs;
    throw err;
  }

  const chargeData = responseData.data || responseData;

  const qrCode = chargeData.qrCode || 
    chargeData.brCode || 
    chargeData.pixPayload || 
    chargeData.payload || 
    chargeData.emv || 
    chargeData.charge?.qrCode || 
    chargeData.charge?.brCode || 
    '';
  const qrCodeImage = chargeData.qrCodeImage || chargeData.charge?.qrCodeImage || '';
  const paymentLink = chargeData.paymentLink || chargeData.charge?.paymentLink || '';
  const expiresAt = chargeData.expiresAt || chargeData.charge?.expiresAt || '';

  return {
    success: true,
    id: chargeData.id || '',
    chargeId: chargeData.chargeId || chargeData.id || '',
    correlationID: chargeData.correlationID || chargeData.correlationId || correlationID || '',
    correlationId: chargeData.correlationID || chargeData.correlationId || correlationID || '',
    transactionID: chargeData.transactionID || chargeData.chargeId || chargeData.id || '',
    qrCode,
    qrCodeImage,
    paymentLink,
    expiresAt,
    valueCentavos: chargeData.value || Math.round(Number(value) * 100),
    splits: chargeData.splits || payload.split || [],
    __providerLatencyMs: providerLatencyMs,
    raw: chargeData
  };
}

/**
 * Consulta o status de uma cobrança na Dotfy (GET /api/charges/:correlationID)
 */
export async function getDotfyChargeStatus({
  apiKey,
  baseUrl = 'https://app.dotfy.com.br',
  correlationID
}) {
  const token = String(apiKey || process.env.DOTFY_API_KEY || PLATFORM_DEFAULTS.dotfy?.apiKey || '').trim();
  if (!token) {
    const err = new Error('DOTFY_API_KEY_MISSING');
    err.status = 503;
    throw err;
  }

  const cleanId = encodeURIComponent(String(correlationID).trim());
  const endpoint = `${baseUrl.replace(/\/+$/, '')}/api/charges/${cleanId}`;
  const authHeader = token.startsWith('Bearer ') ? token : `Bearer ${token}`;

  const response = await axios.get(endpoint, {
    headers: {
      Authorization: authHeader,
      Accept: 'application/json',
      'User-Agent': 'Playzada-Dotfy-PIX/1.0'
    },
    timeout: 10000,
    httpsAgent,
    validateStatus: () => true
  });

  const responseData = response.data || {};
  if (response.status < 200 || response.status >= 300) {
    // Se a consulta direta por ID/correlationID retornar 404, tenta buscar na lista recente de cobranças
    if (response.status === 404 || response.status === 400) {
      try {
        const listEndpoint = `${baseUrl.replace(/\/+$/, '')}/api/charges`;
        const listRes = await axios.get(listEndpoint, {
          headers: {
            Authorization: authHeader,
            Accept: 'application/json',
            'User-Agent': 'Playzada-Dotfy-PIX/1.0'
          },
          params: { limit: 50 },
          timeout: 8000,
          httpsAgent,
          validateStatus: () => true
        });
        if (listRes.status >= 200 && listRes.status < 300) {
          const listPayload = listRes.data || {};
          const listItems = Array.isArray(listPayload) 
            ? listPayload 
            : (listPayload.transactions || listPayload.data || listPayload.charges || listPayload.items || []);
          
          if (Array.isArray(listItems)) {
            const cleanTarget = String(correlationID).trim().toLowerCase();
            const match = listItems.find(c => {
              const id = String(c.id || '').toLowerCase();
              const corr = String(c.correlationID || c.correlationId || '').toLowerCase();
              const ext = String(c.external_id || '').toLowerCase();
              const txId = String(c.transactionId || c.transactionID || '').toLowerCase();
              const chId = String(c.chargeId || '').toLowerCase();
              const desc = String(c.description || '').toLowerCase();
              return id === cleanTarget || 
                corr === cleanTarget || 
                ext === cleanTarget || 
                txId === cleanTarget || 
                chId === cleanTarget ||
                (cleanTarget.length >= 6 && desc.includes(cleanTarget));
            });

            if (match) {
              const mData = match;
              const mStatus = String(mData.status || mData.state || mData.paymentStatus || '').toUpperCase().trim();
              const mPaid = Boolean(
                mData.paid === true || 
                mData.isPaid === true || 
                Boolean(mData.paidAt || mData.paid_at || mData.endToEndId || mData.paymentDate || mData.receipt) ||
                ['PAID', 'APPROVED', 'CONFIRMED', 'COMPLETED', 'SUCCEEDED', 'PAGO', 'RECEIVED', 'LIQUIDATED', 'SETTLED', 'CONCLUIDO'].includes(mStatus)
              );
              return {
                success: true,
                rawStatus: mStatus || (mPaid ? 'PAID' : 'PENDING'),
                status: mPaid ? 'APPROVED' : normalizeDotfyStatus(mStatus),
                isPaid: mPaid,
                data: mData
              };
            }
          }
        }
      } catch (listErr) {
        // Silently continue to error throw
      }
    }

    const err = new Error(responseData.error || responseData.message || `DOTFY_HTTP_${response.status}`);
    err.status = response.status;
    err.providerData = responseData;
    throw err;
  }

  const data = responseData.data || responseData.charge || responseData.transaction || responseData;
  const rawStatusCandidate = String(
    data.status || 
    data.state || 
    data.paymentStatus || 
    data.pixStatus || 
    data.charge?.status || 
    data.transaction?.status || 
    ''
  ).toUpperCase().trim();

  const isExplicitPaid = Boolean(
    data.paid === true || 
    data.isPaid === true || 
    Boolean(data.paidAt || data.paid_at || data.paymentDate || data.endToEndId || data.receipt) ||
    [
      'PAID', 'APPROVED', 'CONFIRMED', 'COMPLETED', 'SUCCEEDED', 'PAGO', 
      'RECEIVED', 'LIQUIDATED', 'SETTLED', 'CONCLUIDO', 'CONCLUÍDO',
      'CHARGE.PAID', 'CHARGE_PAID', 'PAYMENT.RECEIVED', 'PAYMENT_RECEIVED'
    ].includes(rawStatusCandidate) ||
    data.event === 'charge.paid' ||
    data.event === 'charge:paid' ||
    data.event === 'pix.received'
  );

  const rawStatus = rawStatusCandidate || (isExplicitPaid ? 'PAID' : 'PENDING');
  const normalized = isExplicitPaid ? 'APPROVED' : normalizeDotfyStatus(rawStatus);

  return {
    success: true,
    rawStatus,
    status: normalized,
    isPaid: normalized === 'APPROVED',
    data
  };
}

/**
 * Consulta o extrato analítico de Splits da Dotfy (GET /api/splits/analytics)
 */
export async function getDotfySentSplitsAnalytics({
  apiKey,
  baseUrl = 'https://app.dotfy.com.br',
  page = 1,
  limit = 20,
  startDate,
  endDate,
  status
} = {}) {
  const token = String(apiKey || process.env.DOTFY_API_KEY || PLATFORM_DEFAULTS.dotfy?.apiKey || '').trim();
  if (!token) {
    const err = new Error('DOTFY_API_KEY_MISSING');
    err.status = 503;
    throw err;
  }

  const authHeader = token.startsWith('Bearer ') ? token : `Bearer ${token}`;
  const params = { page: Number(page || 1), limit: Number(limit || 20) };
  if (startDate) params.startDate = startDate;
  if (endDate) params.endDate = endDate;
  if (status) params.status = status;

  const endpoint = `${baseUrl.replace(/\/+$/, '')}/api/splits/analytics`;
  const response = await axios.get(endpoint, {
    headers: {
      Authorization: authHeader,
      Accept: 'application/json',
      'User-Agent': 'Playzada-Dotfy-PIX/1.0'
    },
    params,
    timeout: 12000,
    httpsAgent,
    validateStatus: () => true
  });

  const responseData = response.data || {};
  if (response.status < 200 || response.status >= 300) {
    const err = new Error(responseData.error || responseData.message || `DOTFY_HTTP_${response.status}`);
    err.status = response.status;
    err.providerData = responseData;
    throw err;
  }

  // Normaliza o retorno contendo summary, splits (history) e pagination
  return {
    success: true,
    summary: responseData.summary || {},
    splits: responseData.history || responseData.splits || [],
    pagination: responseData.pagination || { totalItems: responseData.history?.length || 0, page: Number(page), limit: Number(limit) },
    period: responseData.period || null,
    raw: responseData
  };
}

/**
 * Consulta lista de cobranças na Dotfy (GET /api/charges)
 */
export async function getDotfyChargesList({
  apiKey,
  baseUrl = 'https://app.dotfy.com.br',
  page = 1,
  limit = 50
} = {}) {
  const token = String(apiKey || process.env.DOTFY_API_KEY || PLATFORM_DEFAULTS.dotfy?.apiKey || '').trim();
  if (!token) {
    const err = new Error('DOTFY_API_KEY_MISSING');
    err.status = 503;
    throw err;
  }

  const authHeader = token.startsWith('Bearer ') ? token : `Bearer ${token}`;
  const params = { page: Number(page || 1), limit: Number(limit || 50) };
  const endpoint = `${baseUrl.replace(/\/+$/, '')}/api/charges`;

  const response = await axios.get(endpoint, {
    headers: {
      Authorization: authHeader,
      Accept: 'application/json',
      'User-Agent': 'Playzada-Dotfy-PIX/1.0'
    },
    params,
    timeout: 12000,
    httpsAgent,
    validateStatus: () => true
  });

  const responseData = response.data || {};
  if (response.status < 200 || response.status >= 300) {
    const err = new Error(responseData.error || responseData.message || `DOTFY_HTTP_${response.status}`);
    err.status = response.status;
    err.providerData = responseData;
    throw err;
  }

  return responseData;
}

/**
 * Consulta Splits Recebidos da Dotfy (GET /api/splits/received)
 */
export async function getDotfyReceivedSplits({
  apiKey,
  baseUrl = 'https://app.dotfy.com.br',
  page = 1,
  limit = 20
} = {}) {
  const token = String(apiKey || process.env.DOTFY_API_KEY || PLATFORM_DEFAULTS.dotfy?.apiKey || '').trim();
  if (!token) {
    const err = new Error('DOTFY_API_KEY_MISSING');
    err.status = 503;
    throw err;
  }

  const authHeader = token.startsWith('Bearer ') ? token : `Bearer ${token}`;
  const params = { page: Number(page || 1), limit: Number(limit || 20) };

  const endpoint = `${baseUrl.replace(/\/+$/, '')}/api/splits/received`;
  const response = await axios.get(endpoint, {
    headers: {
      Authorization: authHeader,
      Accept: 'application/json',
      'User-Agent': 'Playzada-Dotfy-PIX/1.0'
    },
    params,
    timeout: 12000,
    httpsAgent,
    validateStatus: () => true
  });

  const responseData = response.data || {};
  if (response.status < 200 || response.status >= 300) {
    const err = new Error(responseData.error || responseData.message || `DOTFY_HTTP_${response.status}`);
    err.status = response.status;
    err.providerData = responseData;
    throw err;
  }

  return responseData;
}

/**
 * Consulta dados do Seller dono da API Key (GET /api/auth/me)
 */
export async function getDotfySellerInfo({
  apiKey,
  baseUrl = 'https://app.dotfy.com.br'
} = {}) {
  const token = String(apiKey || process.env.DOTFY_API_KEY || PLATFORM_DEFAULTS.dotfy?.apiKey || '').trim();
  if (!token) {
    const err = new Error('DOTFY_API_KEY_MISSING');
    err.status = 503;
    throw err;
  }

  const authHeader = token.startsWith('Bearer ') ? token : `Bearer ${token}`;
  const endpoint = `${baseUrl.replace(/\/+$/, '')}/api/auth/me`;
  const response = await axios.get(endpoint, {
    headers: {
      Authorization: authHeader,
      Accept: 'application/json',
      'User-Agent': 'Playzada-Dotfy-PIX/1.0'
    },
    timeout: 10000,
    httpsAgent,
    validateStatus: () => true
  });

  const responseData = response.data || {};
  if (response.status < 200 || response.status >= 300) {
    const err = new Error(responseData.error || responseData.message || `DOTFY_HTTP_${response.status}`);
    err.status = response.status;
    err.providerData = responseData;
    throw err;
  }

  return responseData;
}

/**
 * Consulta o Saldo da conta Dotfy (GET /api/balance)
 */
export async function getDotfyBalance({
  apiKey,
  baseUrl = 'https://app.dotfy.com.br'
} = {}) {
  const token = String(apiKey || process.env.DOTFY_API_KEY || PLATFORM_DEFAULTS.dotfy?.apiKey || '').trim();
  if (!token) {
    const err = new Error('DOTFY_API_KEY_MISSING');
    err.status = 503;
    throw err;
  }

  const authHeader = token.startsWith('Bearer ') ? token : `Bearer ${token}`;
  const endpoint = `${baseUrl.replace(/\/+$/, '')}/api/balance`;
  const response = await axios.get(endpoint, {
    headers: {
      Authorization: authHeader,
      Accept: 'application/json',
      'User-Agent': 'Playzada-Dotfy-PIX/1.0'
    },
    timeout: 10000,
    httpsAgent,
    validateStatus: () => true
  });

  const responseData = response.data || {};
  if (response.status < 200 || response.status >= 300) {
    const err = new Error(responseData.error || responseData.message || `DOTFY_HTTP_${response.status}`);
    err.status = response.status;
    err.providerData = responseData;
    throw err;
  }

  return responseData;
}

