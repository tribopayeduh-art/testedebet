import {adminToolsRoute} from '../server/supabase-admin-tools.mjs';
import {playerAdminRoute} from '../server/supabase-player-admin.mjs';
import fs from 'node:fs';import path from 'node:path';import ts from 'typescript';
import {ADMIN_READS,CONFIG_READS} from '../server/supabase-admin-reads.mjs';
import {bannerWriteRoute} from '../server/supabase-banners.mjs';
import {coreRoute} from '../server/supabase-core-actions.mjs';
const files=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(x=>x.isDirectory()?files(path.join(dir,x.name)):[path.join(dir,x.name)]);
const calls=[],imports=[],assets=new Map();
const allowedReads=new Set([...Object.keys(ADMIN_READS),...Object.keys(CONFIG_READS),'/api/wallet/summary','/api/admin/me','/api/admin/users','/api/admin/dashboard','/api/admin/finance/dashboard','/api/system/settings']);
function classify(route,method){
 const p=route.split('?')[0].replace(/:[^/]+/g,'12345678-1234-1234-1234-123456789abc');
 if(p==='/api/winners-feed')return 'PLACEHOLDER_EMPTY';
 if(['/api/admin/operations/health','/api/admin/system-readiness'].includes(p))return 'PARTIAL_STATIC_RESPONSE';
 if(method==='GET'&&['/api/assets/game-image','/api/games','/api/providers','/api/igamewin/games','/api/igamewin/providers'].includes(p))return 'PUBLIC_PROVIDER_READ';
 if(bannerWriteRoute(p,method))return 'BANNER_IMPLEMENTED_AUTH_TEST_REQUIRED';
 if(playerAdminRoute(p,method)||adminToolsRoute(p,method))return 'ADMIN_IMPLEMENTED_AUTH_TEST_REQUIRED';
 if(coreRoute(p,method))return 'CORE_IMPLEMENTED_AUTH_TEST_REQUIRED';
 if(method==='GET'&&allowedReads.has(p))return 'READ_IMPLEMENTED_AUTH_TEST_REQUIRED';
 if(p==='/api/player/sync-profile'&&method==='POST')return 'PROFILE_TRIGGER_NOOP';
 return 'MIGRATION_PENDING_OR_REVIEW';
}
const sourceFiles=files('src').filter(x=>/\.[cm]?[jt]sx?$/.test(x));
for(const file of sourceFiles){
 const text=fs.readFileSync(file,'utf8'),source=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true);
 function visit(n){
  if(ts.isImportDeclaration(n)&&ts.isStringLiteral(n.moduleSpecifier)&&n.moduleSpecifier.text.startsWith('firebase/'))imports.push({file,module:n.moduleSpecifier.text});
  if(ts.isCallExpression(n)&&['adminApi','fetch','supabaseRequest'].includes(n.expression.getText(source))){
   const arg=n.arguments[0];let route=null;
   if(arg&&(ts.isStringLiteral(arg)||ts.isNoSubstitutionTemplateLiteral(arg)))route=arg.text;
   else if(arg&&ts.isTemplateExpression(arg))route=arg.head.text+arg.templateSpans.map((x,i)=>`:param${i}`+x.literal.text).join('');
   const options=n.arguments[1];let method=n.expression.getText(source)==='supabaseRequest'&&options?'POST':'GET';let dynamicMethod=false;
   if(options&&ts.isObjectLiteralExpression(options))for(const prop of options.properties){if(ts.isPropertyAssignment(prop)&&prop.name.getText(source)==='method'){if(ts.isStringLiteral(prop.initializer))method=prop.initializer.text;else dynamicMethod=true;}if(ts.isShorthandPropertyAssignment(prop)&&prop.name.text==='method')dynamicMethod=true;}
   const location=source.getLineAndCharacterOfPosition(n.getStart(source));
   if(!route||route.startsWith('/api/'))calls.push({file,line:location.line+1,call:n.expression.getText(source),route:route||arg?.getText(source)||'',method:dynamicMethod?'DYNAMIC':method,status:!route||dynamicMethod?'MANUAL_DYNAMIC_REVIEW':classify(route,method)});
  }
  ts.forEachChild(n,visit);
 }
 visit(source);
 for(const m of text.matchAll(/["'`]((?:\/(?:brand|banners|games|icons|providers|language)\/)[a-zA-Z0-9_./-]+)["'`]/g))assets.set(m[1],fs.existsSync('public'+m[1]));
}
const report={checkedAt:new Date().toISOString(),sourceFilesScanned:sourceFiles.length,limitations:['Static source inventory: variable URLs/methods require manual inspection.','Route presence does not prove authenticated behavior or external integration.'],calls,firebaseImports:imports,staticAssets:[...assets].map(([asset,exists])=>({asset,exists}))};
fs.writeFileSync('supabase/audit/TELAS-CONFERIDAS.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({filesScanned:sourceFiles.length,filesWithApiCalls:new Set(calls.map(x=>x.file)).size,calls:calls.length,statusCounts:calls.reduce((o,x)=>(o[x.status]=(o[x.status]||0)+1,o),{}),firebaseImports:imports.length,staticAssetReferences:assets.size,missingAssets:[...assets].filter(x=>!x[1]).map(x=>x[0])},null,2));
