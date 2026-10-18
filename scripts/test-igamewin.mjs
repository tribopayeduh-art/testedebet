import fs from 'node:fs';
import path from 'node:path';

function loadEnv(file='.env') {
  const p=path.resolve(process.cwd(),file);
  if(!fs.existsSync(p)) return;
  for(const line of fs.readFileSync(p,'utf8').split(/\r?\n/)){
    const clean=line.trim();
    if(!clean||clean.startsWith('#')||!clean.includes('=')) continue;
    const i=clean.indexOf('=');
    const key=clean.slice(0,i).trim();
    let value=clean.slice(i+1).trim();
    if((value.startsWith('"')&&value.endsWith('"'))||(value.startsWith("'")&&value.endsWith("'"))) value=value.slice(1,-1);
    if(process.env[key]===undefined) process.env[key]=value;
  }
}
loadEnv();

const url=(process.env.IGAMEWIN_API_URL||'https://igamewin.com/api/v1').replace(/\/$/,'');
const agent_code=process.env.IGAMEWIN_AGENT_CODE||'';
const agent_token=process.env.IGAMEWIN_AGENT_TOKEN||'';
if(!agent_code||!agent_token){console.error('ERRO: configure IGAMEWIN_AGENT_CODE e IGAMEWIN_AGENT_TOKEN no .env');process.exit(1)}

async function call(method,payload={}){
  const started=Date.now();
  const ctrl=new AbortController();
  const timer=setTimeout(()=>ctrl.abort(),20000);
  try{
    const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify({method,agent_code,agent_token,...payload}),signal:ctrl.signal});
    const text=await r.text();
    let data; try{data=JSON.parse(text)}catch{data={raw:text}}
    return {http:r.status,ms:Date.now()-started,data};
  } finally {clearTimeout(timer)}
}
function rows(v,depth=0){if(depth>7||v==null)return[];if(Array.isArray(v))return v;if(typeof v!=='object')return[];for(const k of ['data','result','items','providers','provider_list','providerList','games','game_list','gameList','list','rows']){if(v[k]!==undefined){const out=rows(v[k],depth+1);if(out.length)return out}}const vals=Object.values(v);const objs=vals.filter(x=>x&&typeof x==='object'&&!Array.isArray(x));if(objs.length>=2&&objs.length===vals.length)return objs;for(const x of vals){const out=rows(x,depth+1);if(out.length)return out}return[]}
const first=(o,ks)=>{for(const k of ks){if(o?.[k]!==undefined&&o[k]!==null&&String(o[k]).trim())return String(o[k]).trim()}return''};
const providerCode=o=>first(o,['provider_code','providerCode','code','provider','id','slug']);
const gameImage=o=>first(o,['game_image','game_img','gameImage','image','image_url','imageUrl','thumbnail','thumbnail_url','thumbnailUrl','thumb','thumb_url','icon','icon_url','banner','banner_url','cover','cover_url','game_icon','game_banner']);

console.log('=== iGameWin integration test ===');
console.log('Endpoint:',url);
console.log('Agent:',`${agent_code.slice(0,4)}***${agent_code.slice(-2)}`);
try{
  const money=await call('money_info');
  console.log('\n[money_info]','HTTP',money.http,`${money.ms}ms`,'status=',money.data?.status??money.data?.success??'?');
  if(money.data?.msg)console.log('msg=',money.data.msg);
  const pr=await call('provider_list');
  const providers=rows(pr.data);
  console.log('\n[provider_list]','HTTP',pr.http,`${pr.ms}ms`,'providers=',providers.length);
  if(!providers.length){console.dir(pr.data,{depth:4});process.exitCode=2}
  let total=0,withImages=0,okProviders=0;
  for(const provider of providers.slice(0,5)){
    const code=providerCode(provider); if(!code)continue;
    try{
      const gr=await call('game_list',{provider_code:code});
      const games=rows(gr.data),images=games.filter(g=>Boolean(gameImage(g))).length;
      total+=games.length;withImages+=images;okProviders++;
      console.log(`[game_list:${code}] HTTP ${gr.http} ${gr.ms}ms games=${games.length} images=${images}`);
      if(games[0])console.log(' sample=',first(games[0],['game_name','gameName','name','title']),'| code=',first(games[0],['game_code','gameCode','code','id']),'| image=',gameImage(games[0])?'YES':'NO');
    }catch(e){console.log(`[game_list:${code}] ERROR`,e.cause?.code||e.message)}
  }
  console.log('\nRESULT:',{providers:providers.length,providersTested:okProviders,gamesInSample:total,gamesWithImages:withImages});
  if(!total){console.error('FALHA: nenhum jogo retornou nos providers testados.');process.exitCode=3}else console.log('OK: a API está retornando catálogo de jogos.');
}catch(e){console.error('FALHA DE CONEXÃO:',e.cause?.code||e.message);process.exitCode=1}
