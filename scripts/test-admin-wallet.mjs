import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const source=fs.readFileSync('src/lib/adminLocalFallback.ts','utf8');
const part=source.slice(source.indexOf('async function walletAdjust('),source.indexOf('\nasync function reports()'));
const js=ts.transpileModule(part,{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
function fixture(){
 const records=new Map([['users/u',{walletBalance:100,bonusBalance:5}]]);
 const doc=(_,col,id)=>`${col}/${id}`;
 const runTransaction=async(_,fn)=>{const writes=[];const result=await fn({get:async ref=>({exists:()=>records.has(ref),data:()=>records.get(ref)}),set:(ref,data,options)=>writes.push([ref,data,options])});for(const [ref,data,options]of writes)records.set(ref,options?.merge?{...records.get(ref),...data}:data);return result;};
 const adjust=new Function('ensureDb','doc','runTransaction','serverTimestamp','auth','audit','response',js+';return walletAdjust')(()=>({}),doc,runTransaction,()=>0,{currentUser:{uid:'admin'}},async()=>{},x=>x);
 return {records,adjust};
}
test('credit and history commit once for repeated key',async()=>{const {records,adjust}=fixture();await adjust('u',25,'teste',false,'CREDIT','one');await adjust('u',25,'teste',false,'CREDIT','one');assert.equal(records.get('users/u').walletBalance,125);assert.equal(records.get('wallet_adjustments/one').delta,25);});
test('insufficient debit commits neither wallet nor history',async()=>{const {records,adjust}=fixture();await assert.rejects(adjust('u',101,'teste',false,'DEBIT','two'));assert.equal(records.size,1);assert.equal(records.get('users/u').walletBalance,100);});
test('zero clears real and bonus balances and records actual debit',async()=>{const {records,adjust}=fixture();await adjust('u',0,'teste',false,'SET','zero',true);assert.equal(records.get('users/u').bonusBalance,0);assert.equal(records.get('users/u').realBalance,0);assert.equal(records.get('wallet_adjustments/zero').amount,-100);});
test('bonus increments wallet and bonus exactly once',async()=>{const {records,adjust}=fixture();await adjust('u',20,'teste',true,'CREDIT','bonus');await adjust('u',20,'teste',true,'CREDIT','bonus');assert.equal(records.get('users/u').walletBalance,120);assert.equal(records.get('users/u').bonusBalance,25);});
test('invalid modes and negative target are rejected',async()=>{const {adjust}=fixture();await assert.rejects(adjust('u',5,'teste',false,'BAD'));await assert.rejects(adjust('u',-1,'teste',false,'SET'));});
