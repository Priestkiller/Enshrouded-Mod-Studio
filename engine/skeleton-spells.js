'use strict';
// Six own spell items. Shared gameplay data on server/client; presentation on clients.
const fsDefault = require('fs'), path = require('path');
const stats = require('./summoned-companions');
function assertTarget(ctx) {
  if (ctx?.enabled !== true) return;
  if (!['server', 'client'].includes(ctx.role)) throw Error('Eigene Skelettzauber: Spielclient oder Dedicated Server muss eindeutig erkannt sein.');
  if (ctx.existingCompanionsEnabled === true) throw Error('Eigene Skelettzauber und die Änderung vorhandener Beschwörungen dürfen nicht gleichzeitig aktiv sein.');
}
function pendingFS(fs) {
  const pending = new Map(), directories = new Set(), key = p => path.resolve(p).toLowerCase();
  const api = {
    existsSync: p => pending.has(key(p)) || directories.has(key(p)) || fs.existsSync(p),
    readFileSync: (p, encoding) => pending.has(key(p)) ? (encoding ? pending.get(key(p)).text : Buffer.from(pending.get(key(p)).text)) : fs.readFileSync(p, encoding),
    readdirSync: p => [...new Set([...(fs.existsSync(p) ? fs.readdirSync(p) : []), ...[...pending.values()].filter(v => key(path.dirname(v.file)) === key(p)).map(v => path.basename(v.file))])],
    mkdirSync: p => { directories.add(key(p)); },
    writeFileSync: (p, text) => { pending.set(key(p), { file: p, text: String(text) }); directories.add(key(path.dirname(p))); }
  };
  return { api, flush() { for (const {file,text} of pending.values()) { fs.mkdirSync(path.dirname(file), {recursive:true}); fs.writeFileSync(file, text, 'utf8'); } }, count: () => pending.size };
}
function apply(ctx, input, output) {
  const summary = { enabled:ctx?.enabled===true, role:ctx?.role||'unknown', gameplayVerified:false, prototype:true, warnings:[] };
  if (!summary.enabled) return summary;
  assertTarget(ctx);
  const fs=ctx.fs||fsDefault, pending=pendingFS(fs), warnings=[], tracking=[];
  const nested={...ctx,fs:pending.api,logger:{warn:s=>warnings.push(String(s))},track:(...args)=>tracking.push(args)};
  summary.stats=stats.applyOwnedSpells(nested,input,output);
  summary.advanced=require('./advanced-companions').apply(nested,input,output);
  summary.items=require('./custom-skeleton-items').apply(nested,input,output);
  summary.presentation=ctx.role==='client'?'included':'client_only';
  summary.ui=ctx.role==='client'?require('./skeleton-recipe-ui').apply(nested,input,output):{enabled:false,reason:'client_only'};
  summary.icons=ctx.role==='client'?require('./skeleton-item-icons').apply(nested,input,output):{enabled:false,reason:'client_only'};
  summary.filesChanged=pending.count();
  summary.createdResources=[...summary.items.createdResources,...(summary.icons.createdResources||[]),...summary.advanced.createdResources];
  summary.warnings=[...new Set(warnings)];
  pending.flush();
  if(typeof ctx.track==='function') for(const args of tracking)ctx.track(...args);
  if(typeof ctx.logger?.warn==='function') for(const warning of summary.warnings)ctx.logger.warn(warning);
  return summary;
}
function verify(summary, reflection, root, fs=fsDefault) {
  if(summary?.enabled!==true)return {enabled:false,checked:0,gameplayVerified:false};
  assertTarget(summary);
  if(summary.gameplayVerified!==false||summary.prototype!==true||summary.stats?.ownedSpells!==true)throw Error('Eigene Skelettzauber: Unvollständige Prüfliste.');
  const shared=['stats','items','advanced'];
  for(const key of shared)if(summary[key]?.enabled!==true||summary[key].role!==summary.role||summary[key].gameplayVerified!==false)throw Error('Eigene Skelettzauber: Inkonsistente Rolle oder Teilprüfliste: '+key);
  if(summary.role==='client'){
    if(summary.presentation!=='included')throw Error('Eigene Skelettzauber: Clientdarstellung fehlt.');
    for(const key of ['ui','icons'])if(summary[key]?.enabled!==true||summary[key].role!=='client'||summary[key].gameplayVerified!==false)throw Error('Eigene Skelettzauber: Clientprüfliste fehlt: '+key);
  }else{
    if(summary.presentation!=='client_only')throw Error('Eigene Skelettzauber: Server enthält Clientdarstellung.');
    for(const key of ['ui','icons'])if(!summary[key]||Object.keys(summary[key]).sort().join('|')!=='enabled|reason'||summary[key].enabled!==false||summary[key].reason!=='client_only')throw Error('Eigene Skelettzauber: Ungültige Serverdarstellung: '+key);
  }
  const creates=[...summary.items.createdResources,...(summary.icons.createdResources||[]),...summary.advanced.createdResources];
  if(creates.length!==(summary.role==='client'?15:9)||JSON.stringify(summary.createdResources)!==JSON.stringify(creates))throw Error('Eigene Skelettzauber: Unvollständige neue Ressourcen.');
  const native=stats.verify(summary.stats,reflection,root,fs),items=require('./custom-skeleton-items').verify(summary.items,reflection,root,fs);
  const ui=summary.role==='client'?require('./skeleton-recipe-ui').verify(summary.ui,reflection,root,fs):{enabled:false,reason:'client_only'};
  const icons=summary.role==='client'?require('./skeleton-item-icons').verify(summary.icons,reflection,root,fs):{enabled:false,reason:'client_only'};
  const advanced=require('./advanced-companions').verify(summary.advanced,reflection,root,fs);
  return {enabled:true,role:summary.role,presentation:summary.presentation,stats:native,items,ui,icons,advanced,gameplayVerified:false,prototype:true};
}
module.exports={apply,verify,assertTarget};
