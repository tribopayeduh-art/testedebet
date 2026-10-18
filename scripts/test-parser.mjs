function listFromResponse(value, depth = 0) {
  if (depth > 7 || value == null) return [];
  if (Array.isArray(value)) return value;
  if (typeof value !== 'object') return [];
  const preferred = ['data','result','items','games','game_list','gameList','providers','provider_list','providerList','list','rows'];
  for (const key of preferred) {
    if (value[key] !== undefined) {
      const out = listFromResponse(value[key], depth + 1);
      if (out.length) return out;
    }
  }
  const values = Object.values(value);
  const objectRows = values.filter(v => v && typeof v === 'object' && !Array.isArray(v));
  if (objectRows.length >= 2 && objectRows.length === values.length) return objectRows;
  for (const v of values) {
    const out = listFromResponse(v, depth + 1);
    if (out.length) return out;
  }
  return [];
}
const fixtures=[
  {name:'providers.data',data:{status:1,data:[{provider_code:'PGSOFT'},{provider_code:'PRAGMATIC'}]},want:2},
  {name:'providers.provider_list',data:{status:1,provider_list:[{code:'PGSOFT'}]},want:1},
  {name:'games.nested',data:{status:1,data:{games:[{game_code:'fortune-tiger'}]}},want:1},
  {name:'games.object-map',data:{data:{a:{game_code:'a'},b:{game_code:'b'}}},want:2},
];
let failed=0;
for(const f of fixtures){const got=listFromResponse(f.data).length; const ok=got===f.want; console.log(`${ok?'PASS':'FAIL'} ${f.name}: ${got}`);if(!ok)failed++}
process.exitCode=failed?1:0;
