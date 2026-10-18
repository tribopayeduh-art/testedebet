import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {transform} from 'esbuild';
const {code}=await transform(fs.readFileSync(new URL('../src/lib/authObserver.ts',import.meta.url),'utf8'),{loader:'ts',format:'esm'});
const {createDistinctAuthObserver}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
test('initial logged-out state is delivered exactly once',()=>{const events=[];const notify=createDistinctAuthObserver(u=>JSON.stringify(u?.id||null),u=>events.push(u));notify(null);notify(null);assert.deepEqual(events,[null]);});
test('token refresh and repeated sign-in for the same identity do not restart authorization',()=>{let validations=0;const notify=createDistinctAuthObserver(u=>u.id,()=>validations++);notify({id:'admin',token:'first'});for(let n=0;n<10;n++)notify({id:'admin',token:'refreshed-'+n});assert.equal(validations,1);});
test('account switch and logout are delivered; returning to a previous account is revalidated',()=>{const events=[];const notify=createDistinctAuthObserver(u=>u?.id||'signed-out',u=>events.push(u?.id||null));notify({id:'a'});notify({id:'b'});notify(null);notify({id:'a'});assert.deepEqual(events,['a','b',null,'a']);});
