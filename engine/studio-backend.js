'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto'),cp=require('child_process');
const ENGINE_SHA='9c9a5911dfe1b87a7c155dc9ba4c95fc4a40b2cdf98eb8b1cebde16c106d8872';
const PARSER_SHA='b65d0558d09c1f0793e70ec50a76d9a06c3cc1a177b3185895b2c2ba1150250f';
const TYPES=['keen::ItemInfo','keen::ecs::TemplateResource','keen::RecipeRegistryResource','keen::BalancingTable','keen::BaseAttributeResource','keen::GameKnowledgeResource','keen::MapMarkerRegistryResource','keen::actor::ActorSequenceResource','keen::TerraformingEfficiencyRegistryResource','keen::GameSettingsPresetsResource','keen::SceneResource','keen::FbUiBundle','keen::VolumetricFog3Resource','keen::LootableItemsResource','keen::LootDistributionTreeResource','keen::ecs::DefaultInventoryResource'];
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const stableHash=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));
function write(p,value){fs.mkdirSync(path.dirname(p),{recursive:true});const tmp=p+'.'+crypto.randomBytes(5).toString('hex')+'.tmp';fs.writeFileSync(tmp,JSON.stringify(value,null,2));fs.renameSync(tmp,p);}
function within(root,p){const rel=path.relative(path.resolve(root),path.resolve(p));if(rel.startsWith('..')||path.isAbsolute(rel))throw Error('Pfad außerhalb des Arbeitsordners.');return p;}
function progress(options,stage,message,value){if(typeof options.progress==='function')options.progress({stage,message,progress:value});}
function files(dir){if(!fs.existsSync(dir))return [];return fs.readdirSync(dir,{withFileTypes:true}).flatMap(d=>d.isDirectory()?files(path.join(dir,d.name)):d.isFile()?[path.join(dir,d.name)]:[]);}
function verifyEngine(root){if(hash(path.join(root,'enshrouded-patcher.exe'))!==ENGINE_SHA||hash(path.join(root,'bin','kfc-parser.exe'))!==PARSER_SHA)throw Error('Engine/Parser-Prüfsumme stimmt nicht. Bitte das vollständige Mod-Studio-Paket erneut entpacken.');const m=read(path.join(root,'engine-manifest.json'));for(const [f,sha]of Object.entries(m.files)){within(root,path.join(root,f));if(hash(path.join(root,f))!==sha)throw Error('Beschädigte Engine-Datei: '+f);}}
function target(config){const dir=path.resolve(config.gameDirectory||'');if(!config.gameDirectory||!fs.statSync(dir).isDirectory())throw Error('Installationsordner fehlt.');const server=fs.existsSync(path.join(dir,'enshrouded_server.exe'))&&fs.existsSync(path.join(dir,'enshrouded_server.kfc'));const client=fs.existsSync(path.join(dir,'enshrouded.exe'))&&fs.existsSync(path.join(dir,'enshrouded.kfc'));if(server&&client)throw Error('Client und Server im gleichen Ordner: bitte getrennte Installationen verwenden.');if(!server&&!client)throw Error('Passende Spiel-EXE und KFC fehlen.');const name=server?'enshrouded_server':'enshrouded';const archives=[name+'.kfc',name+'.kfc_resources'].filter(n=>fs.existsSync(path.join(dir,n)));if(archives.length!==2)throw Error('Die zugehörige .kfc_resources-Datei fehlt.');return {dir,name,server,exe:name+'.exe',archives,id:stableHash(dir.toLowerCase()).slice(0,20)};}
function fingerprint(t){return {exe:hash(path.join(t.dir,t.exe)),archives:Object.fromEntries(t.archives.map(n=>[n,hash(path.join(t.dir,n))]))};}
function noGameRunning(){if(process.platform!=='win32')return;let result=cp.spawnSync('tasklist.exe',['/FO','CSV','/NH'],{encoding:'utf8',windowsHide:true,timeout:10000});if(result.error||result.status!==0){const ps=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');result=cp.spawnSync(ps,['-NoProfile','-NonInteractive','-Command',"if (Get-Process -Name enshrouded,enshrouded_server -ErrorAction SilentlyContinue) { 'RUNNING' } else { 'CLEAR' }"],{encoding:'utf8',windowsHide:true,timeout:15000});if(result.error||result.status!==0)throw Error('Laufende Spielprozesse konnten nicht geprüft werden.');if(String(result.stdout).trim()==='RUNNING')throw Error('Spiel oder Dedicated Server läuft. Bitte vor dem Patchen schließen.');if(String(result.stdout).trim()!=='CLEAR')throw Error('Laufende Spielprozesse konnten nicht geprüft werden.');return;}if(/"enshrouded(?:_server)?\.exe"/i.test(String(result.stdout)))throw Error('Spiel oder Dedicated Server läuft. Bitte vor dem Patchen schließen.');}
function validate(config,root){const schema=read(path.join(root,'..','assets','schema.json'));for(const c of schema)for(const m of c.Mods){const v=config[c.Key]?.[m.Key];if(!v||typeof v.enabled!=='boolean')throw Error('Ungültige Option: '+m.Key);for(const f of m.Fields){const n=v[f.Key];if(f.Boolean){if(typeof n!=='boolean')throw Error('Schalter fehlt: '+f.Key);}else if(typeof n!=='number'||!Number.isFinite(n)||n<f.Minimum||n>f.Maximum||(f.Integer&&!Number.isInteger(n)))throw Error('Ungültiger Wert: '+m.Key+'.'+f.Key);}}
 const g=config.gameplay,w=config.world;
 if(g.adjustChestRandomSlots.min>g.adjustChestRandomSlots.max)throw Error('Truhen-Minimum ist größer als Maximum.');
 if(g.enableGatherLootMultipliers.enabled&&(g.enableGatherLootMultipliers.enemyLootMultiplier!==1||g.enableGatherLootMultipliers.chestLootMultiplier!==1))throw Error('Die alten Gegner-/Truhen-Mengenmultiplikatoren sind unter 1.0 wirkungslos. Werte auf 1 setzen und bei Bedarf die separate Zufallsbeuteplatz-Option verwenden.');
 if(g.enableSourceLootSlots.enabled&&g.enableSourceLootSlots.chestMultiplier!==1&&g.adjustChestRandomSlots.enabled)throw Error('Absolute Truhenplätze und Truhenplatz-Multiplikator dürfen nicht gleichzeitig aktiv sein.');
 for(const [key,min,max]of [['enableUncapDedicatedServerSettings','uncapServerFactorMin','uncapServerFactorMax'],['enableUncapClientSettings','clientFactorMin','clientFactorMax']])if(g[key].enabled&&(g[key][min]>=g[key][max]||g[key][max]<1||g[key][max]>5))throw Error('Faktorgrenzen müssen aufsteigend sein und mindestens 1 bis höchstens 5 einschließen.');
 if(g.enableUncapClientSettings.enabled&&g.enableUncapClientSettings.clientFactorMin>=Math.min(g.enableUncapClientSettings.clientFactorMax,g.enableUncapDedicatedServerSettings.enabled?g.enableUncapDedicatedServerSettings.uncapServerFactorMax:g.enableUncapClientSettings.clientFactorMax,4))throw Error('Die Client-Untergrenze muss unter der wirksamen Obergrenze liegen; für Gesundheit, Mana und Ausdauer gilt höchstens Faktor 4.');
 if(w.adjustAltarLimit.enabled&&w.adjustAltarLimit.cap>16&&!w.adjustAltarLimit.unlockSafeAltarCap)throw Error('Mehr als 16 Altäre erfordert den experimentellen Bypass.');
}
function parser(binary,command,t,out,log,types=TYPES){const args=[command,'--game-directory',t.dir,'--file-name',t.name,command==='unpack'?'--output':'--input',out];if(command==='unpack')args.push('--filter',types.map(x=>'t'+x).join(','));const r=cp.spawnSync(binary,args,{encoding:'utf8',windowsHide:true,maxBuffer:32*1024*1024});const result=String(r.stdout||'')+String(r.stderr||'');if(r.error||r.status!==0)throw Error('Parser '+command+' fehlgeschlagen: '+String(r.error?.message||result).slice(-6000));if(/\b[1-9]\d* failed\b|error:/i.test(result))throw Error('Parser meldet Fehler: '+result.slice(-6000));log(result.trim());return result;}
function nearlyEqual(a,b){if(typeof a==='number'&&typeof b==='number')return Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=Math.max(1e-6,Math.abs(a)*1e-6);if(a===b)return true;if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;const aa=Object.keys(a),bb=Object.keys(b);return aa.length===bb.length&&aa.every(k=>Object.prototype.hasOwnProperty.call(b,k)&&nearlyEqual(a[k],b[k]));}
function applyMods(config,input,output,log,role='unknown',reflection=null){
 if(config.inventory?.adjustStackSize?.enabled)require('./stack-check').assertSchema(reflection);
 if(config.player?.adjustSkillPointsPerLevel?.enabled)require('./skill-points-check').assertSchema(reflection);
 const clientLimits=config.gameplay?.enableUncapClientSettings,skipClientLimits=role==='server'&&clientLimits?.enabled===true;
 const sharedStorageEnabled=config.world?.adjustFactoryInventoryAccess?.enabled===true;
 const singleStepTamingEnabled=config.world?.enableSingleStepTaming?.enabled===true;
 let effectiveConfig=skipClientLimits?{...config,gameplay:{...config.gameplay,enableUncapClientSettings:{...clientLimits,enabled:false}}}:config;
 // The guarded supplement owns this option, including ordinary chests and
 // component-based station detection. Do not also run the narrower vendor scan.
 if(sharedStorageEnabled)effectiveConfig={...effectiveConfig,world:{...effectiveConfig.world,adjustFactoryInventoryAccess:{...effectiveConfig.world.adjustFactoryInventoryAccess,enabled:false}}};
 const {load}=require('./vendor-loader'),{ModProcessor}=load('mod/processor');
 const p=ModProcessor.fromConfig(effectiveConfig);
 const result=require('./processor-fixes').apply(p,effectiveConfig,input,output);
 if(result&&result.success===false)throw Error(result.error||'Engine konnte Mods nicht anwenden.');
 const changes=[],warnings=[];
 const ctx={config:{...p.getConfig()},role,logger:{warn:s=>{warnings.push(String(s));log('HINWEIS: '+s);},info:log,debug:()=>{},success:log},track:(...args)=>changes.push(args)};
 if(skipClientLimits)Object.assign(ctx.config,{enableUncapClientSettings:true,clientFactorMin:clientLimits.clientFactorMin,clientFactorMax:clientLimits.clientFactorMax});
 const extra=config.gameplay.enableSourceLootSlots;Object.assign(ctx.config,{enableEnemyRandomSlotMultiplier:extra.enabled&&extra.enemyMultiplier!==1,enemyRandomSlotMultiplier:extra.enemyMultiplier,enableChestRandomSlotMultiplier:extra.enabled&&extra.chestMultiplier!==1,chestRandomSlotMultiplier:extra.chestMultiplier});
 const loot=require('./loot-source-slots').apply(ctx,input,output),limits=require('./limits-fix').apply(ctx,input,output);
 const sharedStorage=require('./shared-crafting-storage').apply({enabled:sharedStorageEnabled,reflection,role,logger:ctx.logger,track:ctx.track},input,output);
 if(sharedStorageEnabled)log('Herstellungsbestand: '+sharedStorage.normalChests+' normale Kisten und '+sharedStorage.stations+' Stationsinventare erkannt; '+sharedStorage.added+' neue Kennzeichnungen, '+sharedStorage.alreadyPresent+' bereits vorhanden. Materialtransfer im Spiel noch ungeprüft.');
 const taming=require('./single-step-taming').apply({enabled:singleStepTamingEnabled,reflection,role,logger:ctx.logger,track:ctx.track},input,output);
 if(singleStepTamingEnabled)log('Zähmung: '+taming.targets+' zähmbare Vorlagen geprüft; '+taming.filesChanged+' Dateien geändert. Benötigte erfolgreiche Schritte: 1. Zähmung und Besitzübernahme im Spiel noch ungeprüft.');
 const skillPoints=require('./skill-points-check').check({config,role,reflection,logger:ctx.logger},input,output);
 const stacks=require('./stack-check').check({config,role,reflection,logger:ctx.logger},input,output);
 return {vendor:result,loot,limits,sharedStorage,taming,skillPoints,stacks,extraChanges:changes.length,warnings};
}
function currentState(data,t){const dir=path.join(data,'targets',t.id);const active=path.join(dir,'state.json');return {dir,active,state:fs.existsSync(active)?read(active):null};}
function checkedBasis(st){const dir=within(st.dir,path.join(st.dir,st.state.basis));if(!st.state.basisArchives)throw Error('Basis-Metadaten fehlen. Eine neue passende Basis auswählen.');for(const[n,sha]of Object.entries(st.state.basisArchives)){if(path.basename(n)!==n||hash(path.join(dir,n))!==sha)throw Error('Gespeicherte Basis beschädigt: '+n);}return dir;}
function validArtifact(t,name){if(path.basename(name)!==name||(!t.archives.includes(name)&&!new RegExp('^'+t.name+'_\\d+\\.dat$').test(name)))throw Error('Ungültiger Artefaktname.');return within(t.dir,path.join(t.dir,name));}
function lockTarget(data,t){const dir=path.join(data,'targets',t.id);fs.mkdirSync(dir,{recursive:true});const file=path.join(dir,'operation.lock');let fd;try{fd=fs.openSync(file,'wx');}catch(e){if(e.code!=='EEXIST')throw e;let pid;try{pid=read(file).pid;process.kill(pid,0);throw Error('Für diese Installation läuft bereits ein Mod-Studio-Vorgang.');}catch(check){if(check.code!=='ESRCH')throw check;}fs.unlinkSync(file);fd=fs.openSync(file,'wx');}fs.writeFileSync(fd,JSON.stringify({pid:process.pid}));fs.closeSync(fd);return ()=>{if(fs.existsSync(file))fs.unlinkSync(file);};}
function unfinished(data,t){const jobs=path.join(data,'jobs');if(!fs.existsSync(jobs))return [];return fs.readdirSync(jobs).map(n=>path.join(jobs,n,'transaction.json')).filter(p=>fs.existsSync(p)).filter(p=>{const j=read(p);return ['running','recovery-required'].includes(j.status)&&j.entries.some(e=>path.dirname(e.destination).toLowerCase()===t.dir.toLowerCase());});}
function basisRecoveryError(message,details){const error=Error(message||'Ein Basiswechsel ist unvollständig. Im erweiterten Menü zuerst „Unterbrochenen Dateitausch zurücknehmen“ wählen.');error.actionCode='basis_recovery_required';error.reason='basis_renewal_incomplete';error.mismatchDetails=details||null;return error;}
function pendingBasisRenewals(data,t){
 const directory=path.join(data,'targets',t.id,'basis-renewals');if(!fs.existsSync(directory))return [];
 const result=[];
 for(const entry of fs.readdirSync(directory,{withFileTypes:true}).filter(e=>e.isDirectory()).sort((a,b)=>a.name.localeCompare(b.name))){
  const file=path.join(directory,entry.name,'journal.json');if(!fs.existsSync(file))continue;
  let journal;try{journal=read(file);}catch(error){throw basisRecoveryError('Das Basiswechsel-Protokoll ist beschädigt. Erweiterte Wiederherstellung erforderlich.',{targetDir:t.dir,journal:file});}
  if(['running','recovery-required'].includes(journal.status))result.push({file,journal});
 }
 return result;
}
function ensureNoUnfinished(data,t){const renewals=pendingBasisRenewals(data,t);if(renewals.length)throw basisRecoveryError(undefined,{targetDir:t.dir,journals:renewals.map(r=>r.file)});if(unfinished(data,t).length)throw Error('Ein früherer Dateitausch wurde unterbrochen. Im Menü zuerst „Unterbrochenen Dateitausch zurücknehmen“ wählen.');}
function sameArchiveHashes(a,b){if(!a||!b||typeof a!=='object'||typeof b!=='object')return false;const keys=Object.keys(a).sort(),other=Object.keys(b).sort();return keys.length===other.length&&keys.every((key,index)=>key===other[index]&&a[key]===b[key]);}
function basisDescription(t,st,fp){
 const previous=st.state?{exe:st.state.exeHash,archives:st.state.currentArchives}:null;
 const kind=!previous?'first_basis':previous.exe!==fp.exe?'version_changed':!sameArchiveHashes(previous.archives,fp.archives)?'archives_changed':'ready';
 const warnings=[];
 if(kind==='version_changed')warnings.push('Die gespeicherte Basis gehört zu einer anderen Spielversion. Alte Archive nicht auf die aktuelle Version zurückspielen.');
 if(kind==='archives_changed')warnings.push('Die Archive weichen vom zuletzt angewendeten Stand ab. Steam oder andere Mods können die Ursache sein. Vor einer neuen Basis die aktuellen Dateien prüfen.');
 if(kind==='first_basis')warnings.push('Noch keine gespeicherte Basis. Bereits enthaltene Mods würden Bestandteil der ersten Basis.');
 return {operation:'inspect-basis',kind,targetDir:t.dir,targetId:t.id,targetRole:t.server?'server':'client',currentFingerprint:fp,previousFingerprint:previous,fingerprintToken:stableHash({targetId:t.id,fingerprint:fp}),savedBasis:!!st.state,basis:typeof st.state?.basis==='string'?st.state.basis:null,warnings,renewed:false};
}
function requireCurrent(st,fp,t){if(!st.state)return;const details=basisDescription(t,st,fp);if(['version_changed','archives_changed'].includes(details.kind)){const error=Error(details.kind==='version_changed'?'Spielversion geändert. Zuerst die aktuellen Dateien über Steam prüfen und danach eine neue Basis freigeben; keine alte Sicherung zurückspielen.':'Die Spielarchive wurden außerhalb dieses Tools geändert. Aktuelle Dateien prüfen und danach eine neue, passende Basis freigeben.');error.actionCode='basis_required';error.reason=details.kind;error.mismatchDetails=details;throw error;}}
function inspectBasis(options){verifyEngine(path.resolve(options.root));const config=read(options.configPath),t=target(config);ensureNoUnfinished(options.data,t);return basisDescription(t,currentState(options.data,t),fingerprint(t));}
function inspectStacks(options){
 const root=path.resolve(options.root),data=path.resolve(options.data),config=read(options.configPath),t=target(config),option=config.inventory?.adjustStackSize;
 if(!option||typeof option.enabled!=='boolean'||!Number.isInteger(option.value)||option.value<2||option.value>65535)throw Error('Stapelprüfung: Der Profilwert muss eine Ganzzahl von 2 bis 65535 sein.');
 verifyEngine(root);const unlock=lockTarget(data,t);let work=null;
 try{
  ensureNoUnfinished(data,t);progress(options,'inspect-stacks','Aktuelle Installationsdateien für die Stapelprüfung kopieren …',8);
  const fp=fingerprint(t),checks=path.join(data,'jobs','checks');
  work=within(checks,path.join(checks,Date.now()+'-'+crypto.randomBytes(6).toString('hex')));
  const stage=path.join(work,'game'),bin=path.join(work,'bin'),input=path.join(work,'unpacked');
  for(const dir of [stage,bin,input])fs.mkdirSync(dir,{recursive:true});
  const log=message=>{fs.appendFileSync(path.join(work,'parser.log'),String(message)+'\n');if(options.log)options.log(message);};
  for(const name of [t.exe,...t.archives])fs.copyFileSync(path.join(t.dir,name),path.join(stage,name));
  fs.copyFileSync(path.join(root,'bin','kfc-parser.exe'),path.join(bin,'kfc-parser.exe'));
  const staged={...t,dir:stage};
  if(stableHash(fingerprint(staged))!==stableHash(fp)||stableHash(fingerprint(t))!==stableHash(fp))throw Error('Stapelprüfung: Die aktuellen Spieldateien wurden beim Kopieren verändert. Erneut prüfen.');
  progress(options,'inspect-stacks','Item-Stapel mit frischer Spielversion aus der Kopie lesen …',30);
  parser(path.join(bin,'kfc-parser.exe'),'unpack',staged,input,log,['keen::ItemInfo']);
  const reflection=read(path.join(bin,'reflection_data.json'));
  require('./stack-check').assertSchema(reflection);
  const summary=require('./stack-check').inspect({requested:option.value,role:t.server?'server':'client',reflection},input);
  if(stableHash(fingerprint(staged))!==stableHash(fp)||stableHash(fingerprint(t))!==stableHash(fp))throw Error('Stapelprüfung: EXE oder Archive wurden während der Prüfung verändert. Das Ergebnis wurde verworfen; erneut prüfen.');
  const result={operation:'inspect-stacks',targetDir:t.dir,targetId:t.id,targetRole:t.server?'server':'client',build:reflection.version,currentFingerprint:fp,enabled:option.enabled,requested:option.value,stackableCount:summary.stackableItems,singletonCount:summary.singletonItems,matchingRequested:summary.matchingItems,allMatch:summary.stackableItems>0&&summary.matchingItems===summary.stackableItems,distribution:Object.entries(summary.distribution).map(([value,count])=>({value:Number(value),count})).sort((a,b)=>a.value-b.value),samples:summary.samples,warnings:summary.warnings||[]};
  write(path.join(work,'report.json'),result);progress(options,'inspected-stacks','Aktuelle Stapelwerte gelesen; die Spieldateien wurden nicht verändert.',95);return result;
 }finally{
  if(work)for(const name of ['game','bin','unpacked']){const directory=within(work,path.join(work,name));try{if(fs.existsSync(directory))fs.rmSync(directory,{recursive:true,force:true});}catch(error){if(options.log)options.log('Stapelprüfung: Arbeitskopie konnte nicht vollständig aufgeräumt werden: '+error.message);}}
  unlock();
 }
}

function inspectSkillPoints(options){
 const root=path.resolve(options.root),data=path.resolve(options.data),config=read(options.configPath),t=target(config),option=config.player?.adjustSkillPointsPerLevel;
 if(!option||typeof option.enabled!=='boolean'||!require('./skill-points-check').positiveUint32(option.value))throw Error('Skillpunkte-Prüfung: Der Profilwert muss eine positive uint32-Ganzzahl sein.');
 verifyEngine(root);const unlock=lockTarget(data,t);let work=null;
 try{
  ensureNoUnfinished(data,t);progress(options,'inspect-skill-points','Aktuelle Installationsdateien für die Punkteprüfung kopieren …',8);
  const fp=fingerprint(t),checks=path.join(data,'jobs','checks');
  work=within(checks,path.join(checks,Date.now()+'-'+crypto.randomBytes(6).toString('hex')));
  const stage=path.join(work,'game'),bin=path.join(work,'bin'),input=path.join(work,'unpacked');
  for(const dir of [stage,bin,input])fs.mkdirSync(dir,{recursive:true});
  const log=message=>{fs.appendFileSync(path.join(work,'parser.log'),String(message)+'\n');if(options.log)options.log(message);};
  for(const name of [t.exe,...t.archives])fs.copyFileSync(path.join(t.dir,name),path.join(stage,name));
  fs.copyFileSync(path.join(root,'bin','kfc-parser.exe'),path.join(bin,'kfc-parser.exe'));
  const staged={...t,dir:stage};
  if(stableHash(fingerprint(staged))!==stableHash(fp)||stableHash(fingerprint(t))!==stableHash(fp))throw Error('Skillpunkte-Prüfung: Die aktuellen Spieldateien wurden beim Kopieren verändert. Erneut prüfen.');
  progress(options,'inspect-skill-points','Punktewert mit frischer Spielstruktur aus der Archivkopie lesen …',30);
  parser(path.join(bin,'kfc-parser.exe'),'unpack',staged,input,log,['keen::BalancingTable']);
  const reflection=read(path.join(bin,'reflection_data.json'));
  const summary=require('./skill-points-check').inspect({requested:option.value,role:t.server?'server':'client',reflection},input);
  if(stableHash(fingerprint(staged))!==stableHash(fp)||stableHash(fingerprint(t))!==stableHash(fp))throw Error('Skillpunkte-Prüfung: EXE oder Archive wurden während der Prüfung verändert. Das Ergebnis wurde verworfen; erneut prüfen.');
  const result={operation:'inspect-skill-points',targetDir:t.dir,targetId:t.id,targetRole:t.server?'server':'client',build:reflection.version,currentFingerprint:fp,enabled:option.enabled,requested:option.value,tableCount:summary.tableCount,matchingRequested:summary.matchingRequested,allMatch:summary.allMatch,distribution:summary.distribution,resources:summary.resources,warnings:summary.warnings,applied:false,readOnly:true,gameplayVerified:false};
  write(path.join(work,'report.json'),result);progress(options,'inspected-skill-points','Installierten Punktewert gelesen; die Spieldateien wurden nicht verändert.',95);return result;
 }finally{
  if(work)for(const name of ['game','bin','unpacked']){const directory=within(work,path.join(work,name));try{if(fs.existsSync(directory))fs.rmSync(directory,{recursive:true,force:true});}catch(error){if(options.log)options.log('Skillpunkte-Prüfung: Arbeitskopie konnte nicht vollständig aufgeräumt werden: '+error.message);}}
  unlock();
 }
}

function validateRenewalJournal(data,t,file,journal){
 const st=currentState(data,t),directory=path.join(st.dir,'basis-renewals');within(directory,file);
 if(path.basename(file)!=='journal.json'||!/^\d+-[a-f0-9]+$/.test(path.basename(path.dirname(file)))||journal.format!==1||journal.kind!=='basis-renewal'||journal.targetId!==t.id||typeof journal.targetDir!=='string'||path.resolve(journal.targetDir).toLowerCase()!==t.dir.toLowerCase()||!/^[a-f0-9]{64}$/i.test(journal.oldStateHash)||!(journal.oldLatestHash===null||/^[a-f0-9]{64}$/i.test(journal.oldLatestHash)))throw basisRecoveryError('Ungültiges Basiswechsel-Protokoll. Metadaten wurden nicht verändert.',{targetDir:t.dir,journal:file});
 const directoryOfJournal=path.dirname(file),stateBackup=path.join(directoryOfJournal,'state.json'),latestBackup=path.join(directoryOfJournal,'latest.json'),latestFile=path.join(data,'latest-'+t.id+'.json');
 if(!fs.existsSync(stateBackup)||hash(stateBackup)!==journal.oldStateHash||(journal.oldLatestHash!==null&&(!fs.existsSync(latestBackup)||hash(latestBackup)!==journal.oldLatestHash)))throw basisRecoveryError('Die Sicherung eines unterbrochenen Basiswechsels fehlt oder ist beschädigt.',{targetDir:t.dir,journal:file});
 for(const [destination,expected]of [[st.active,journal.oldStateHash],[latestFile,journal.oldLatestHash]])if(fs.existsSync(destination)&&(expected===null||hash(destination)!==expected))throw basisRecoveryError('Basis-Metadaten wurden außerhalb dieses Vorgangs verändert. Automatische Wiederherstellung gestoppt.',{targetDir:t.dir,journal:file});
 return {st,stateBackup,latestBackup,latestFile};
}
function restoreRenewalMetadata(data,t,file,journal){const paths=validateRenewalJournal(data,t,file,journal);if(!fs.existsSync(paths.st.active))atomicCopy(paths.stateBackup,paths.st.active);if(journal.oldLatestHash!==null&&!fs.existsSync(paths.latestFile))atomicCopy(paths.latestBackup,paths.latestFile);}
function recoverBasisRenewals(data,t){const pending=pendingBasisRenewals(data,t);for(const entry of pending)validateRenewalJournal(data,t,entry.file,entry.journal);for(const entry of pending){restoreRenewalMetadata(data,t,entry.file,entry.journal);entry.journal.status='rolled-back-recovered';entry.journal.recoveredAt=new Date().toISOString();write(entry.file,entry.journal);}return pending.length;}
function renewBasis(options){
 if(typeof options.expectedFingerprint!=='string'||!/^[a-f0-9]{64}$/i.test(options.expectedFingerprint))throw Error('Neue Basis benötigt den Fingerprint-Token der vorherigen Prüfung.');
 if(options.steamFilesVerified!==true)throw Error('Neue Basis benötigt die ausdrückliche Bestätigung der abgeschlossenen Steam-Dateiprüfung.');
 verifyEngine(path.resolve(options.root));const config=read(options.configPath),t=target(config);noGameRunning();const unlock=lockTarget(options.data,t);
 try{
  ensureNoUnfinished(options.data,t);const st=currentState(options.data,t),inspection=basisDescription(t,st,fingerprint(t));
  if(inspection.fingerprintToken!==options.expectedFingerprint.toLowerCase())throw Error('Die überprüften Dateien oder der Zielordner wurden inzwischen geändert. Basis erneut prüfen.');
  if(['ready','first_basis'].includes(inspection.kind))return {...inspection,operation:'renew-basis',renewed:false,retiredStatePath:null};
  const latestFile=path.join(options.data,'latest-'+t.id+'.json'),id=Date.now()+'-'+crypto.randomBytes(6).toString('hex'),directory=path.join(st.dir,'basis-renewals',id),file=path.join(directory,'journal.json');
  const oldStateHash=hash(st.active),oldLatestHash=fs.existsSync(latestFile)?hash(latestFile):null;
  fs.mkdirSync(directory,{recursive:true});fs.copyFileSync(st.active,path.join(directory,'state.json'),fs.constants.COPYFILE_EXCL);if(oldLatestHash!==null)fs.copyFileSync(latestFile,path.join(directory,'latest.json'),fs.constants.COPYFILE_EXCL);
  const journal={format:1,kind:'basis-renewal',status:'running',targetId:t.id,targetDir:t.dir,oldStateHash,oldLatestHash,currentFingerprint:inspection.currentFingerprint,fingerprintToken:inspection.fingerprintToken,steamFilesVerifiedAcknowledged:true,createdAt:new Date().toISOString()};
  let mutated=false;
  try{
   validateRenewalJournal(options.data,t,file,journal);write(file,journal);noGameRunning();
   if(basisDescription(t,st,fingerprint(t)).fingerprintToken!==inspection.fingerprintToken)throw Error('Die überprüften Spieldateien wurden während der Freigabe geändert. Basis erneut prüfen.');
   validateRenewalJournal(options.data,t,file,journal);
   if(oldLatestHash!==null){fs.unlinkSync(latestFile);mutated=true;}
   fs.unlinkSync(st.active);mutated=true;journal.status='committed';journal.committedAt=new Date().toISOString();write(file,journal);
  }catch(error){
   let rollbackError;try{if(mutated)restoreRenewalMetadata(options.data,t,file,journal);}catch(e){rollbackError=e;}
   journal.status=rollbackError?'recovery-required':'rolled-back';journal.error=error.message;if(rollbackError)journal.rollbackError=rollbackError.message;
   let journalError;try{write(file,journal);}catch(e){journalError=e;}
   if(rollbackError||(journalError&&fs.existsSync(file)))throw basisRecoveryError('Basiswechsel unvollständig. Im erweiterten Menü die Wiederherstellung ausführen. '+error.message,{targetDir:t.dir,journal:file});
   throw Error(error.message+' Die vorherigen Basis-Metadaten bleiben erhalten.');
  }
  const warnings=[...inspection.warnings,'Die Steam-Dateiprüfung wurde vom Benutzer bestätigt. Das Tool kann daraus keinen unabhängigen Originaldatei-Nachweis ableiten.'];
  if(st.state.addedFiles?.length)warnings.push('Zusatzdateien des alten Setups bleiben unverändert. Ihre Besitzmetadaten sind im archivierten Zustand erhalten.');
  return {...inspection,operation:'renew-basis',kind:'renewed',renewed:true,savedBasis:false,basis:null,retiredBasis:inspection.basis,retiredStatePath:path.join(directory,'state.json'),warnings};
 }finally{unlock();}
}
function checkedAdded(st,t){
 const result=new Map();
 for(const entry of st.state?.addedFiles||[]){
  if(!entry||typeof entry.name!=='string'||typeof entry.sha256!=='string'||!/^[a-f0-9]{64}$/i.test(entry.sha256)||t.archives.includes(entry.name)||result.has(entry.name))throw Error('Ungültige Metadaten einer zusätzlich angelegten Datei.');
  const destination=validArtifact(t,entry.name);
  if(fs.existsSync(destination)&&hash(destination)!==entry.sha256)throw Error('Zusätzlich angelegte Datei wurde außerhalb des Tools verändert: '+entry.name);
  result.set(entry.name,entry);
 }
 return result;
}
async function prepare(options){progress(options,'validate','Profil und Installation prüfen …',2);const root=path.resolve(options.root),data=path.resolve(options.data),config=read(options.configPath),log=options.log||console.log;verifyEngine(root);validate(config,root);noGameRunning();const t=target(config),unlock=lockTarget(data,t);try{ensureNoUnfinished(data,t);const fp=fingerprint(t),st=currentState(data,t);requireCurrent(st,fp,t);const managed=checkedAdded(st,t);progress(options,'basis',st.state?'Gespeicherte unveränderte Basis verwenden …':'Aktuellen Archivstand als erste Basis vorbereiten …',7);
 const job=path.join(data,'jobs',Date.now()+'-'+crypto.randomBytes(4).toString('hex'));fs.mkdirSync(job,{recursive:true});const stage=path.join(job,'game'),input=path.join(job,'unpacked'),modified=path.join(job,'modified'),verify=path.join(job,'verify'),bin=path.join(job,'bin');for(const d of [stage,input,modified,bin])fs.mkdirSync(d,{recursive:true});
 const base=st.state?checkedBasis(st):t.dir;
 log(st.state?'Ausgangsbasis: gespeicherte Basis dieser Spielversion.':'ERSTE BASIS: aktueller Datenstand. Vorhandene Mods sind darin enthalten. Für einen sauberen Anfang vorher Steam-Dateiprüfung durchführen.');
 for(const n of t.archives)fs.copyFileSync(path.join(base,n),path.join(stage,n));fs.copyFileSync(path.join(t.dir,t.exe),path.join(stage,t.exe));fs.copyFileSync(path.join(root,'bin','kfc-parser.exe'),path.join(bin,'kfc-parser.exe'));
 for(const n of t.archives)if(hash(path.join(stage,n))!==hash(path.join(base,n)))throw Error('Die Ausgangsbasis wurde während des Kopierens geändert.');if(hash(path.join(stage,t.exe))!==fp.exe)throw Error('Spielversion wurde während der Vorbereitung geändert.');
 progress(options,'unpack','Ressourcen aus der Archivkopie lesen …',18);const staged={...t,dir:stage};log('1/4 Relevante Ressourcen aus der Kopie entpacken …');parser(path.join(bin,'kfc-parser.exe'),'unpack',staged,input,log);
 const ref=read(path.join(bin,'reflection_data.json'));log('Spielversion: '+ref.version);log('2/4 Profil auf die Arbeitsdaten anwenden …');progress(options,'modify','Profil auf die unveränderte Basis anwenden …',40);const mods=applyMods(config,input,modified,log,t.server?'server':'client',ref);const outputs=files(modified).filter(p=>p.endsWith('.json'));let verified=0;
 if(outputs.length){progress(options,'repack','Geänderte Daten in die Archivkopie packen …',58);log('3/4 Geänderte Daten in die Archivkopie packen …');parser(path.join(bin,'kfc-parser.exe'),'repack',staged,modified,log);log('4/4 Archivkopie erneut auslesen und Änderungen vergleichen …');progress(options,'verify','Gepackte Archive erneut lesen und alle Änderungen prüfen …',72);parser(path.join(bin,'kfc-parser.exe'),'unpack',staged,verify,log);for(const original of files(input).filter(p=>p.endsWith('.json'))){const rel=path.relative(input,original),change=within(modified,path.join(modified,rel)),actual=within(verify,path.join(verify,rel));const desired=fs.existsSync(change)?change:original;if(!fs.existsSync(actual)||!nearlyEqual(read(desired),read(actual)))throw Error('Archivprüfung fehlgeschlagen: '+rel+'. Spielarchive wurden nicht geändert.');if(fs.existsSync(change))verified++;}if(verified!==outputs.length)throw Error('Die Zahl der erneut gelesenen Änderungen stimmt nicht.');}
 else log('Keine geänderten Ressourcendateien: die gespeicherte Basis wird vorbereitet.');
 if(mods.taming?.enabled){mods.taming.archiveReadbackValidated=outputs.length>0&&verified===outputs.length;if(mods.taming.archiveReadbackValidated)log('Zähmung nach Archiv-Readback bestätigt: ein benötigter Erfolg in '+mods.taming.targets+' geprüften zähmbaren Vorlagen. Spieltest offen.');}
 if(config.player.adjustSkillPointsPerLevel.enabled){
  if(!outputs.length){progress(options,'verify-skill-points','Punktewert erneut aus der Archivkopie prüfen …',75);parser(path.join(bin,'kfc-parser.exe'),'unpack',staged,verify,log,['keen::BalancingTable']);}
  mods.skillPoints=require('./skill-points-check').check({config,role:t.server?'server':'client',reflection:ref},input,verify);
  mods.skillPoints.archiveReadbackValidated=true;
  log('Fertigkeitspunkte nach Archiv-Readback: '+mods.skillPoints.requested+' in '+mods.skillPoints.tablesChecked+' geprüften BalancingTable-Ressourcen. Spieltest offen.');
 }
 if(config.inventory.adjustStackSize.enabled){
  if(!outputs.length){progress(options,'verify-stacks','Unveränderte Stapelwerte erneut aus der Archivkopie prüfen …',75);parser(path.join(bin,'kfc-parser.exe'),'unpack',staged,verify,log,['keen::ItemInfo']);}
  mods.stacks=require('./stack-check').check({config,role:t.server?'server':'client',reflection:ref,complete:true,logger:{warn:message=>{mods.warnings.push(String(message));log('HINWEIS: '+message);},info:log,debug:()=>{},success:log}},input,verify);
  mods.stacks.archiveReadbackValidated=true;
  log('Stapelprüfung nach Archiv-Readback: '+mods.stacks.stackableItems+' stapelbare Items mit Zielwert '+mods.stacks.requested+'.');
 }
 const artifactFiles=[...t.archives,...fs.readdirSync(stage).filter(n=>new RegExp('^'+t.name+'_\\d+\\.dat$').test(n))];const artifacts=artifactFiles.map(n=>{const destination=validArtifact(t,n),previous=fs.existsSync(destination)?hash(destination):null,nextHash=hash(path.join(stage,n));if(!t.archives.includes(n)&&previous!==null&&previous!==nextHash&&!managed.has(n))throw Error('Datendatei-Kollision mit einer fremden Datei: '+n);return {name:n,sha256:nextHash,previous};});
 const removedArtifacts=[...managed.values()].filter(entry=>!artifacts.some(a=>a.name===entry.name));
 const plan={format:2,id:path.basename(job),job,target:t,configHash:stableHash(config),config,source:fp,firstBasis:!st.state,baseHashes:Object.fromEntries(t.archives.map(n=>[n,hash(path.join(base,n))])),build:ref.version,mods,modifiedFiles:outputs.length,verifiedFiles:verified,artifacts,removedArtifacts,createdAt:new Date().toISOString(),applied:false};write(path.join(job,'plan.json'),plan);write(path.join(data,'latest-'+t.id+'.json'),{job:plan.id});log('Vorschau geprüft: '+outputs.length+' Ressourcendateien. Noch keine Spieländerung.');progress(options,'prepared','Vorschau und Archivprüfung erfolgreich.',88);return plan;}finally{unlock();}
}
function atomicCopy(source,destination){const tmp=destination+'.studio-'+crypto.randomBytes(5).toString('hex')+'.tmp';try{fs.copyFileSync(source,tmp,fs.constants.COPYFILE_EXCL);if(hash(source)!==hash(tmp))throw Error('Kopierprüfung fehlgeschlagen.');fs.renameSync(tmp,destination);}finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}}
function commitFiles(changes,rollback,journal,settings={}){if(typeof settings==='number')settings={failAfter:settings};fs.mkdirSync(rollback,{recursive:true});const entries=changes.map((c,i)=>({...c,old:fs.existsSync(c.destination),backup:path.join(rollback,String(i)),done:false}));for(const e of entries)if(e.old)fs.copyFileSync(e.destination,e.backup);const record={status:'running',entries,metadata:settings.metadata||null};write(journal,record);try{for(const e of entries){if(e.source)atomicCopy(e.source,e.destination);else if(fs.existsSync(e.destination))fs.unlinkSync(e.destination);e.done=true;write(journal,record);if(settings.failAfter&&entries.filter(x=>x.done).length===settings.failAfter)throw Error('INJECTED_TEST_FAILURE');}if(settings.finalize)settings.finalize();record.status='committed';write(journal,record);}catch(error){let rollbackError;for(const e of entries.slice().reverse())if(e.done){try{if(e.old)atomicCopy(e.backup,e.destination);else if(fs.existsSync(e.destination))fs.unlinkSync(e.destination);}catch(e){rollbackError=e;}}try{if(settings.rollbackMeta)settings.rollbackMeta();}catch(e){rollbackError=e;}record.status=rollbackError?'recovery-required':'rolled-back';record.error=error.message;record.rollbackError=rollbackError?.message;write(journal,record);throw Error(error.message+(rollbackError?' Wiederherstellung unvollständig; Protokoll '+journal:' Vorheriger Zustand wurde wiederhergestellt.'));}return entries;}
function applyPlan(options,plan){progress(options,'apply','Geprüfte Änderungen anwenden …',92);const root=path.resolve(options.root),data=path.resolve(options.data),log=options.log||console.log;verifyEngine(root);noGameRunning();const config=read(options.configPath);validate(config,root);if(stableHash(config)!==plan.configHash)throw Error('Das Profil wurde nach der Vorschau geändert. Neue Vorschau erstellen.');const t=target(config),unlock=lockTarget(data,t);try{ensureNoUnfinished(data,t);if(t.id!==plan.target.id)throw Error('Installationsordner geändert.');const currentFingerprint=fingerprint(t),st=currentState(data,t);requireCurrent(st,currentFingerprint,t);if(stableHash(currentFingerprint)!==stableHash(plan.source))throw Error('Spiel- oder Archivdateien wurden seit der Vorschau geändert. Neue Vorschau erstellen.');if(plan.applied)throw Error('Diese Vorschau wurde bereits angewendet.');within(path.join(data,'jobs'),plan.job);const managed=checkedAdded(st,t);let state=st.state;
 if(!state){const basis='basis-'+Date.now();fs.mkdirSync(path.join(st.dir,basis),{recursive:true});for(const n of t.archives){fs.copyFileSync(path.join(t.dir,n),path.join(st.dir,basis,n));if(hash(path.join(st.dir,basis,n))!==plan.source.archives[n])throw Error('Basis-Sicherung fehlgeschlagen.');}state={basis,exeHash:plan.source.exe,currentArchives:plan.source.archives,basisArchives:plan.source.archives,addedFiles:[],basisWasCurrentData:true};write(st.active,state);}else checkedBasis(st);
 const previousState=JSON.parse(JSON.stringify(state)),previousPlan=JSON.parse(JSON.stringify(plan)),planFile=path.join(plan.job,'plan.json');const rollbackMeta=()=>{write(st.active,previousState);write(planFile,previousPlan);};
 const changes=[],artifactNames=new Set();
 for(const a of plan.artifacts){
  if(artifactNames.has(a.name))throw Error('Doppeltes Vorschauartefakt: '+a.name);artifactNames.add(a.name);
  const dest=validArtifact(t,a.name),source=within(plan.job,path.join(plan.job,'game',a.name));
  if(hash(source)!==a.sha256)throw Error('Vorschauartefakt beschädigt: '+a.name);
  const previous=fs.existsSync(dest)?hash(dest):null;
  if(previous!==a.previous)throw Error('Datei wurde seit der Vorschau verändert: '+a.name);
  if(!t.archives.includes(a.name)&&previous!==null&&previous!==a.sha256&&!managed.has(a.name))throw Error('Datendatei-Kollision mit einer fremden Datei: '+a.name);
  if(previous!==a.sha256)changes.push({source,destination:dest});
 }
 if(t.archives.some(name=>!artifactNames.has(name)))throw Error('Die Vorschau enthält nicht alle Spielarchive.');
 const removed=[...managed.values()].filter(entry=>!artifactNames.has(entry.name));
 if(plan.removedArtifacts&&stableHash(plan.removedArtifacts)!==stableHash(removed))throw Error('Zusätzliche Dateimetadaten wurden seit der Vorschau verändert. Neue Vorschau erstellen.');
 for(const entry of removed){const destination=validArtifact(t,entry.name);if(fs.existsSync(destination))changes.push({source:null,destination});}
 commitFiles(changes,path.join(plan.job,'rollback'),path.join(plan.job,'transaction.json'),{metadata:{stateFile:st.active,previousState,planFile,previousPlan},rollbackMeta,finalize:()=>{for(const a of plan.artifacts){if(hash(path.join(t.dir,a.name))!==a.sha256)throw Error('Angewendete Datei konnte nicht verifiziert werden: '+a.name);}for(const entry of removed)if(fs.existsSync(validArtifact(t,entry.name)))throw Error('Überholte Zusatzdatei konnte nicht entfernt werden: '+entry.name);state.addedFiles=plan.artifacts.filter(a=>!t.archives.includes(a.name)&&(managed.has(a.name)||a.previous===null)).map(a=>({name:a.name,sha256:a.sha256}));state.currentArchives=Object.fromEntries(t.archives.map(n=>[n,hash(path.join(t.dir,n))]));state.lastJob=plan.id;state.updatedAt=new Date().toISOString();write(st.active,state);plan.applied=true;write(planFile,plan);}});
 try{if(config.settings.keepModdedFiles){const outputRoot=path.resolve(root,config.outputDirectory||'./output'),exportDir=path.join(outputRoot,'studio-'+plan.id);fs.mkdirSync(exportDir,{recursive:true});for(const f of files(path.join(plan.job,'modified'))){const destination=within(exportDir,path.join(exportDir,path.relative(path.join(plan.job,'modified'),f)));fs.mkdirSync(path.dirname(destination),{recursive:true});fs.copyFileSync(f,destination);}log('Geänderte Daten zusätzlich gespeichert: '+exportDir);}if(!config.settings.keepTempFiles)for(const name of ['unpacked','verify','game','bin']){const dir=within(plan.job,path.join(plan.job,name));if(fs.existsSync(dir))fs.rmSync(dir,{recursive:true,force:true});}}catch(error){log('Archive wurden angewendet. Zusatzexport/Aufräumen fehlgeschlagen: '+error.message);}
 log('Geprüfte Archivdateien angewendet. Ein Test im Spiel steht noch aus.');return state;}finally{unlock();}
}
function latest(options){const t=target(read(options.configPath)),link=path.join(options.data,'latest-'+t.id+'.json');if(!fs.existsSync(link))return null;const id=read(link).job;if(!/^[0-9]+-[a-f0-9]+$/.test(id))throw Error('Ungültige Vorschau-ID.');return read(path.join(options.data,'jobs',id,'plan.json'));}
function restore(options){progress(options,'restore','Gespeicherte Basis prüfen und wiederherstellen …',10);const config=read(options.configPath),t=target(config),unlock=lockTarget(options.data,t);try{ensureNoUnfinished(options.data,t);const st=currentState(options.data,t);if(!st.state)throw Error('Keine durch Mod Studio gespeicherte Basis vorhanden.');noGameRunning();const fp=fingerprint(t);requireCurrent(st,fp,t);checkedAdded(st,t);const base=checkedBasis(st),previousState=JSON.parse(JSON.stringify(st.state));const changes=t.archives.map(n=>({source:path.join(base,n),destination:path.join(t.dir,n)}));for(const f of st.state.addedFiles){const dest=validArtifact(t,f.name);if(fs.existsSync(dest)){if(hash(dest)!==f.sha256)throw Error('Zusätzlich angelegte Datei wurde verändert: '+f.name);changes.push({source:null,destination:dest});}}const job=path.join(options.data,'jobs','restore-'+Date.now());commitFiles(changes,path.join(job,'rollback'),path.join(job,'transaction.json'),{metadata:{stateFile:st.active,previousState},rollbackMeta:()=>write(st.active,previousState),finalize:()=>{st.state.currentArchives=Object.fromEntries(t.archives.map(n=>[n,hash(path.join(t.dir,n))]));st.state.lastJob=null;st.state.addedFiles=[];write(st.active,st.state);}});return st.state;}finally{unlock();}}
function resetBasis(options){return renewBasis(options);}
function recover(options){const t=target(read(options.configPath)),unlock=lockTarget(options.data,t);try{noGameRunning();const renewed=recoverBasisRenewals(options.data,t),pending=unfinished(options.data,t);for(const file of pending){const j=read(file),job=path.dirname(file);within(path.join(options.data,'jobs'),job);const m=j.metadata;if(m){within(path.join(options.data,'targets',t.id),m.stateFile);if(!m.previousState||typeof m.previousState!=='object')throw Error('Vorherige Zustandsdaten fehlen.');if(m.planFile){within(job,m.planFile);if(!m.previousPlan||typeof m.previousPlan!=='object')throw Error('Vorherige Vorschaudaten fehlen.');}}for(const e of j.entries){validArtifact(t,path.basename(e.destination));if(path.resolve(e.destination)!==path.join(t.dir,path.basename(e.destination)))throw Error('Ungültiges Wiederherstellungsziel.');within(job,e.backup);if(e.old&&!fs.existsSync(e.backup))throw Error('Wiederherstellungskopie fehlt.');if(e.source)within(job,e.source);if(fs.existsSync(e.destination)){const current=hash(e.destination),old=e.old?hash(e.backup):null,newHash=e.source&&fs.existsSync(e.source)?hash(e.source):null;if(current!==old&&current!==newHash)throw Error('Extern veränderte Datei: '+e.destination);}}
 for(const e of j.entries.slice().reverse()){if(e.old)atomicCopy(e.backup,e.destination);else if(fs.existsSync(e.destination))fs.unlinkSync(e.destination);}if(m){write(m.stateFile,m.previousState);if(m.planFile)write(m.planFile,m.previousPlan);}j.status='rolled-back-recovered';write(file,j);}return renewed+pending.length;}finally{unlock();}}
async function update(options){const plan=await prepare(options);const state=applyPlan(options,plan);return {plan,state};}
module.exports={update,progress,checkedAdded,ENGINE_SHA,PARSER_SHA,TYPES,hash,read,write,files,within,target,fingerprint,validate,verifyEngine,nearlyEqual,applyMods,prepare,latest,applyPlan,restore,resetBasis,recover,atomicCopy,commitFiles,lockTarget,noGameRunning,inspectBasis,inspectStacks,inspectSkillPoints,renewBasis,pendingBasisRenewals,basisDescription,recoverBasisRenewals};
