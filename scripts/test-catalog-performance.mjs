import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import ts from 'typescript';
const compile=file=>ts.transpileModule(fs.readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2020}}).outputText;
const dataUrl=code=>'data:text/javascript;base64,'+Buffer.from(code).toString('base64');
const errorUrl=dataUrl(compile('../src/lib/apiError.ts'));
const {fetchIgamewinGames,saveCachedGames}=await import(dataUrl(compile('../src/lib/igamewin.ts').replace('from "./apiError"',`from "${errorUrl}"`)));
const originalFetch=globalThis.fetch,originalStorage=globalThis.localStorage;
const store=new Map();globalThis.localStorage={getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)};
test.after(()=>{globalThis.fetch=originalFetch;if(originalStorage)globalThis.localStorage=originalStorage;else delete globalThis.localStorage;});
test('simultaneous catalog loads share a single network request',async()=>{
 store.clear();let count=0,release;
 globalThis.fetch=async()=>{count++;await new Promise(r=>release=r);return new Response(JSON.stringify({games:[{code:'one',name:'One'}]}));};
 const first=fetchIgamewinGames(),second=fetchIgamewinGames();assert.equal(count,1);release();
 const result=await Promise.all([first,second]);assert.deepEqual(result[0],result[1]);assert.equal(count,1);
});
test('failure returns saved games and does not multiply retry delays',async()=>{
 store.clear();saveCachedGames([{code:'cached',name:'Cached'}]);let count=0;
 globalThis.fetch=async()=>{count++;return new Response(JSON.stringify({message:'offline'}),{status:503});};
 const result=await fetchIgamewinGames();assert.equal(result[0].code,'cached');assert.equal(count,1);
});
