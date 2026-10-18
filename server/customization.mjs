export const DEFAULT_VALIDATION_FEES = {
  languageFirstWithdrawal: { enabled: true, amount: 32.90 },
  kycApproval: { enabled: true, amount: 21.90 },
  accountApproval: { enabled: true, amount: 19.67 },
  antiFraud: { enabled: true, amount: 14.90 },
  liquidation: { enabled: true, amount: 9.90 }
};
export function normalizeValidationFees(input = {}) {
  return Object.fromEntries(Object.entries(DEFAULT_VALIDATION_FEES).map(([key, defaults]) => {
    const rule = input?.[key] || {};
    const amount = Number(rule.amount ?? defaults.amount);
    if (!Number.isFinite(amount) || amount < 1 || amount > 100000) throw new Error(`Valor inválido para ${key}: use entre R$ 1 e R$ 100.000.`);
    return [key, { enabled: rule.enabled !== false, amount: Math.round(amount * 100) / 100 }];
  }));
}
export function withdrawalValidation(settings, bonusClaimed = false) {
  const fees = normalizeValidationFees(settings.validationFees);
  const first = settings.depositFunnel?.firstWithdrawalFee || {};
  return {
    first: { enabled: first.enabled !== false && (!bonusClaimed || fees.languageFirstWithdrawal.enabled), amount: bonusClaimed ? fees.languageFirstWithdrawal.amount : Number(first.amount ?? 22.90) },
    kyc: fees.kycApproval, account: fees.accountApproval, fraud: fees.antiFraud, liquidation: fees.liquidation
  };
}
export function imageExtension(buffer, type) {
  if (type === 'image/png' && buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'png';
  if (type === 'image/jpeg' && buffer[0]===255 && buffer[1]===216 && buffer[2]===255) return 'jpg';
  if (type === 'image/webp' && buffer.subarray(0,4).toString()==='RIFF' && buffer.subarray(8,12).toString()==='WEBP') return 'webp';
  return null;
}
