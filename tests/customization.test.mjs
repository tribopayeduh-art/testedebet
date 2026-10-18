import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeValidationFees, withdrawalValidation, imageExtension } from '../server/customization.mjs';
test('preserves current defaults and rounds custom monetary values',()=>{
  assert.equal(normalizeValidationFees().kycApproval.amount,21.90);
  assert.equal(normalizeValidationFees().languageFirstWithdrawal.amount,32.90);
  assert.equal(normalizeValidationFees({accountApproval:{amount:12.345}}).accountApproval.amount,12.35);
});
test('changed and disabled fees are used consistently in withdrawal policy',()=>{
  const cfg={validationFees:{antiFraud:{enabled:false,amount:18},languageFirstWithdrawal:{amount:40}},depositFunnel:{firstWithdrawalFee:{enabled:false,amount:28}}};
  const bonus=withdrawalValidation(cfg,true); assert.equal(bonus.first.amount,40); assert.equal(bonus.first.enabled,false); assert.equal(bonus.fraud.enabled,false);
  const regular=withdrawalValidation(cfg); assert.equal(regular.first.amount,28);
});
test('invalid monetary values cannot reach payments',()=>{
  for(const amount of [NaN,Infinity,-5,0,100001,'oops']) assert.throws(()=>normalizeValidationFees({kycApproval:{amount}}));
});
test('uploaded assets require real image signature and matching MIME',()=>{
  const png=Buffer.from([137,80,78,71,13,10,26,10]);
  assert.equal(imageExtension(png,'image/png'),'png');
  assert.equal(imageExtension(png,'image/jpeg'),null);
  assert.equal(imageExtension(Buffer.from('<script>alert(1)</script>'),'image/png'),null);
  assert.equal(imageExtension(Buffer.from('<svg/>'),'image/svg+xml'),null);
});
