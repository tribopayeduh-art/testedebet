import test from 'node:test';import assert from 'node:assert/strict';
import {moneyCents,playerAdminRoute,playerAdminAction} from '../server/supabase-player-admin.mjs';
import {supabaseMiddleware} from '../server/supabase-routes.mjs';
const id='12345678-1234-1234-1234-123456789abc';
test('money rejects negative/nonfinite/ambiguous amounts and accepts BRL cents',()=>{
 assert.equal(moneyCents('10,50'),1050);assert.equal(moneyCents(0),0);
 for(const x of [-1,NaN,Infinity,null,'','1.234,56','0.001',1000001])assert.throws(()=>moneyCents(x));
});
test('wallet and account writes cannot fall through to legacy handlers',async()=>{
 process.env.DATA_BACKEND='supabase';process.env.SUPABASE_URL='https://example.supabase.co';process.env.SUPABASE_PUBLISHABLE_KEY='test';
 for(const leaf of ['wallet-adjustment','zero-balance','grant-bonus']){
  const path=`/api/admin/users/${id}/${leaf}`;assert.equal(playerAdminRoute(path,'POST'),true);assert.equal(playerAdminRoute(path,'GET'),false);
  const res={status(s){this.code=s;return this},json(x){this.body=x;return this}};
  await supabaseMiddleware({path,method:'POST',headers:{},body:{}},res,()=>assert.fail('legacy handler'));assert.equal(res.code,401);
 }
});
test('request identity and exact amount reach the SQL transaction',async()=>{
 let args;await playerAdminAction({path:`/api/admin/users/${id}/wallet-adjustment`,headers:{'idempotency-key':'retry-key'},body:{amount:'12,35',mode:'CREDIT',reason:'Crédito'}},{rpc:async(n,a)=>{args=a;return {data:{after:12.35}}}});
 assert.equal(args.p_patch.amountCents,1235);assert.equal(args.p_patch.key,'retry-key');assert.equal(args.p_id,id);
});
test('missing SQL returns actionable prerequisite',async()=>{
 await assert.rejects(playerAdminAction({path:`/api/admin/users/${id}/zero-balance`,headers:{},body:{}},{rpc:async()=>({error:{code:'PGRST202'}})}),e=>e.status===503&&e.message.includes('005'));
});
