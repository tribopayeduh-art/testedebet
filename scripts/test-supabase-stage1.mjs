import test from 'node:test';
import assert from 'node:assert/strict';
import {supabaseMiddleware} from '../server/supabase-routes.mjs';
process.env.DATA_BACKEND='supabase';process.env.SUPABASE_URL='https://example.supabase.co';process.env.SUPABASE_PUBLISHABLE_KEY='sb_publishable_example';
function response(){return {code:200,body:null,status(n){this.code=n;return this;},json(x){this.body=x;return this;}};}
test('public game catalog and signed image proxy remain reachable in Supabase mode',async()=>{for(const path of ['/api/assets/game-image','/api/igamewin/games','/api/igamewin/providers','/api/games','/api/providers']){let next=false;await supabaseMiddleware({path,method:'GET',headers:{}},response(),()=>next=true);assert.equal(next,true,path);}});
test('catalog exception does not allow writes',async()=>{const res=response();let next=false;await supabaseMiddleware({path:'/api/igamewin/games',method:'POST',headers:{}},res,()=>next=true);assert.equal(next,false);assert.equal(res.code,503);});
test('unmigrated money endpoints cannot reach the Firebase handler',async()=>{for(const path of ['/api/wallet/dotfy/deposit','/api/wallet/withdraw-request-v2','/api/igamewin/callback','/webhooks/dotfy','/webhook/dotfy']){const res=response();let next=false;await supabaseMiddleware({path,method:'POST',headers:{}},res,()=>next=true);assert.equal(next,false);assert.equal(res.code,503);assert.equal(res.body.error,'SUPABASE_MIGRATION_PENDING');}});
test('wallet/admin endpoints require authentication before reading data',async()=>{for(const path of ['/api/wallet/summary','/api/admin/users','/api/admin/me']){const res=response();let next=false;await supabaseMiddleware({path,method:'GET',headers:{}},res,()=>next=true);assert.equal(next,false);assert.equal(res.code,401);}});
test('frontend routes continue to the app',async()=>{let next=false;await supabaseMiddleware({path:'/reset-password',headers:{}},response(),()=>next=true);assert.equal(next,true);});
