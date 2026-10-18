import test from 'node:test';import assert from 'node:assert/strict';
import {coreRoute,coreAction,playerStats} from '../server/supabase-core-actions.mjs';
import {supabaseMiddleware} from '../server/supabase-routes.mjs';
process.env.DATA_BACKEND='supabase';process.env.SUPABASE_URL='https://example.supabase.co';process.env.SUPABASE_PUBLISHABLE_KEY='sb_publishable_test';
const id='12345678-1234-1234-1234-123456789abc';
test('player counters and cash flow count only paid deposits and withdrawals',()=>{
 const stats=playerStats([{kind:'DEPOSIT',status:'PAID',amount_cents:7000},{kind:'DEPOSIT',status:'PENDING',amount_cents:5000},{kind:'WITHDRAWAL',status:'PAID',amount_cents:2000},{kind:'WITHDRAWAL',status:'PENDING',amount_cents:1500}],[{bet_cents:900,win_cents:1200}],{balance_cents:3000,bonus_cents:500});
 assert.equal(stats.depositCount,1);assert.equal(stats.withdrawalCount,1);assert.equal(stats.totalDeposits,70);assert.equal(stats.netProfit,50);assert.equal(stats.pendingWithdrawals,15);assert.equal(stats.currentBalance,30);assert.equal(stats.totalWins,12);
});
test('core actions match intended methods only',()=>{
 for(const [path,method] of [['/api/supabase/responsible-limits','POST'],['/api/supabase/self-exclusion','POST'],['/api/admin/configuration','PATCH'],['/api/admin/home-layout','PATCH'],[`/api/admin/support/${id}`,'PATCH'],[`/api/admin/bonuses/${id}`,'DELETE'],[`/api/admin/users/${id}/details`,'GET']])assert.equal(coreRoute(path,method),true,path);
 assert.equal(coreRoute(`/api/admin/users/${id}/wallet-adjustment`,'POST'),false);
});
test('ticket update invokes only authorized database RPC',async()=>{
 let call;await coreAction({path:`/api/admin/support/${id}`,method:'PATCH',body:{status:'CLOSED'}},{rpc:async(name,args)=>{call={name,args};return {data:{id}};}});
 assert.equal(call.name,'zerobet_core_action');assert.deepEqual(call.args,{p_operation:'SUPPORT_UPDATE',p_id:id,p_patch:{status:'CLOSED'}});
});
test('administrative core writes require login at middleware',async()=>{
 const res={status(n){this.code=n;return this;},json(v){this.body=v;return this;}};
 await supabaseMiddleware({path:`/api/admin/support/${id}`,method:'PATCH',headers:{},body:{status:'CLOSED'}},res,()=>assert.fail('must authenticate'));
 assert.equal(res.code,401);
});
test('missing migration exposes SQL prerequisite',async()=>{
 await assert.rejects(coreAction({path:'/api/supabase/responsible-limits',method:'POST',body:{}},{rpc:async()=>({error:{code:'PGRST202'}})}),e=>e.status===503&&e.message.includes('004'));
});
