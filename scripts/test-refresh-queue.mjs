import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import ts from 'typescript';
const source=fs.readFileSync(new URL('../src/lib/refreshQueue.ts',import.meta.url),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2020}}).outputText;
const {createRefreshQueue}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('bursts during a refresh produce one follow-up without concurrent requests',async()=>{
 let calls=0,active=0,maxActive=0;const release=[];
 const q=createRefreshQueue(async()=>{calls++;active++;maxActive=Math.max(maxActive,active);await new Promise(r=>release.push(r));active--;},e=>assert.fail(String(e)));
 q.request();q.request();q.request();assert.equal(calls,1);
 release.shift()();await tick();assert.equal(calls,2);assert.equal(maxActive,1);
 release.shift()();await tick();q.stop();q.request();assert.equal(calls,2);
});
test('errors release the queue and allow a later refresh',async()=>{
 let calls=0,errors=0;const q=createRefreshQueue(async()=>{if(++calls===1)throw Error('offline');},()=>errors++);
 q.request();await tick();q.request();await tick();assert.equal(calls,2);assert.equal(errors,1);q.stop();
});
test('unsubscribe cancels a queued follow-up',async()=>{
 let calls=0,release;const q=createRefreshQueue(async()=>{calls++;await new Promise(r=>release=r);},()=>{});
 q.request();q.request();q.stop();release();await tick();assert.equal(calls,1);
});
