import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
test('legacy Firebase startup and background reconciliation are gated in Supabase mode',()=>{
 const source=fs.readFileSync(new URL('../server/index.mjs',import.meta.url),'utf8');
 assert.match(source,/if \(!supabaseMode\(\)\) initFirebaseAdmin\(\);/);
 assert.match(source,/const db = supabaseMode\(\) \? null/);
 for(const timer of ['setInterval','setTimeout'])assert.match(source,new RegExp(`if \\(!supabaseMode\\(\\)\\) ${timer}\\(reconcileAllPendingDepositsRoutine`));
});
