import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeBannerPatch,bannerWriteRoute,writeSupabaseBanner} from '../server/supabase-banners.mjs';
test('banner links and activation reject invalid input',()=>{
 for(const desktopImage of ['javascript:alert(1)','//evil.test/a','https://example.test/\\bad'])assert.throws(()=>normalizeBannerPatch({desktopImage}));
 assert.throws(()=>normalizeBannerPatch({active:'true'}));
 assert.throws(()=>normalizeBannerPatch({schedule:{startsAt:'2026-10-10',endsAt:'2026-10-09'}}));
 assert.deepEqual(normalizeBannerPatch({desktopImage:'/banners/a.png',role:'admin',active:true}),{desktopImage:'/banners/a.png',active:true});
});
test('duplicate uses stored id and does not forward body',async()=>{
 const id='12345678-1234-1234-1234-123456789abc';let args;
 const path=`/api/admin/banner-campaigns/${id}/duplicate`;
 assert.equal(bannerWriteRoute(path,'POST'),true);
 const result=await writeSupabaseBanner({path,method:'POST',body:{active:true}},{rpc:async(name,params)=>{args={name,params};return {data:{id:'new-id'}};}});
 assert.equal(args.name,'zerobet_manage_banner');assert.deepEqual(args.params,{p_operation:'DUPLICATE',p_id:id,p_patch:{}});assert.equal(result.id,'new-id');
});
test('missing database migration reports actionable error',async()=>{
 await assert.rejects(writeSupabaseBanner({path:'/api/admin/banner-campaigns',method:'POST',body:{name:'Teste'}},{rpc:async()=>({error:{code:'PGRST202'}})}),e=>e.status===503&&e.message.includes('SQL'));
});
