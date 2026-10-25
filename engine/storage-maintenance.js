'use strict';
// Own storage guard. No game execution and no deletion outside Data/patches/jobs.
const fs=require('fs'),path=require('path'),cp=require('child_process');
const MiB=1024*1024,GiB=1024*MiB,RESERVE=64*MiB;
const JOB=/^\d+-[a-f0-9]+$/i;
const SCRATCH=['game','unpacked','verify','localization','bin'];
const TERMINAL=new Set(['committed','rolled-back','rolled-back-recovered']);
const read=p=>JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));
const size=p=>fs.existsSync(p)?fs.statSync(p).size:0;
function inside(root,file){const relative=path.relative(path.resolve(root),path.resolve(file));if(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw Error('Bereinigungspfad liegt außerhalb der Arbeitsdaten.');return path.resolve(file);}
function regularDirectory(dir){const s=fs.lstatSync(dir);if(!s.isDirectory()||s.isSymbolicLink())throw Error('Verknüpfte oder unbekannte Arbeitsordner werden nicht bereinigt.');}
function alive(pid){if(!Number.isInteger(pid)||pid<1)throw Error('Ungültige Prozesskennung in den Arbeitsdaten.');try{process.kill(pid,0);return true;}catch(e){return e.code!=='ESRCH';}}
function diskInfo(directory){
 if(process.platform==='win32'){
  const shell=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
  const command='$p=[IO.Path]::GetFullPath($env:STUDIO_STORAGE_CHECK_PATH);$r=[IO.Path]::GetPathRoot($p);$d=[IO.DriveInfo]::new($r);if(-not $d.IsReady){throw "Laufwerk nicht bereit"};@{volume=$r.ToLowerInvariant();label=$r;freeBytes=$d.AvailableFreeSpace}|ConvertTo-Json -Compress';
  const r=cp.spawnSync(shell,['-NoProfile','-NonInteractive','-Command',command],{encoding:'utf8',windowsHide:true,timeout:15000,env:{...process.env,STUDIO_STORAGE_CHECK_PATH:path.resolve(directory)}});
  if(r.error||r.status!==0)throw Error('Freier Speicher konnte nicht geprüft werden: '+directory+'. '+String(r.error?.message||r.stderr||'').trim());
  const value=JSON.parse(String(r.stdout).replace(/^\uFEFF/,'').trim());if(!Number.isSafeInteger(value.freeBytes)||value.freeBytes<0||typeof value.volume!=='string')throw Error('Unbekannte Antwort der Speicherprüfung.');return value;
 }
 if(typeof fs.statfsSync!=='function')throw Error('Diese Laufzeit unterstützt die Speicherprüfung nicht.');
 let existing=path.resolve(directory);while(!fs.existsSync(existing)){const parent=path.dirname(existing);if(parent===existing)throw Error('Datenlaufwerk fehlt.');existing=parent;}
 const info=fs.statfsSync(existing),stat=fs.statSync(existing);return{volume:String(stat.dev),label:existing,freeBytes:Number(info.bavail)*Number(info.bsize)};
}
function gib(bytes){return (bytes/GiB).toLocaleString('de-DE',{minimumFractionDigits:2,maximumFractionDigits:2})+' GiB';}
function assertSpace(requirements,options={}){
 const probe=options.probe||diskInfo,cache=new Map(),volumes=new Map();
 for(const row of requirements){if(!Number.isSafeInteger(row.bytes)||row.bytes<0)throw Error('Ungültiger Speicherbedarf.');const drive=path.parse(path.resolve(row.path)).root.toLowerCase();let info=cache.get(drive);if(!info){info=probe(row.path);cache.set(drive,info);}if(!Number.isSafeInteger(info.freeBytes)||info.freeBytes<0)throw Error('Freier Speicher ist unbekannt.');let group=volumes.get(info.volume);if(!group){group={...info,requiredBytes:0,reasons:[]};volumes.set(info.volume,group);}group.requiredBytes+=row.bytes;group.reasons.push(row.reason);}
 for(const group of volumes.values()){group.requiredBytes+=options.reserveBytes??RESERVE;if(group.freeBytes<group.requiredBytes){const error=Error('Nicht genügend freier Speicher auf '+group.label+': benötigt mindestens '+gib(group.requiredBytes)+', verfügbar '+gib(group.freeBytes)+'. Bitte alte Arbeitsdaten bereinigen oder das vollständige Mod Studio samt Data auf ein Laufwerk mit mehr Platz verschieben. Der Dateitausch wurde nicht begonnen.');error.code='STUDIO_INSUFFICIENT_SPACE';error.storage=group;throw error;}}
 return [...volumes.values()];
}
function prepareRequirements({data,target,config,firstBasis}){
 const archives=target.archives.reduce((n,file)=>n+size(path.join(target.dir,file)),0),clone=archives+size(path.join(target.dir,target.exe));
 let bytes=clone+2*Math.max(512*MiB,archives*4)+Math.max(256*MiB,archives)+archives+(firstBasis?archives:0);
 if(config.world?.enableSkeletonSummoningSpells?.enabled){let largest=0;for(const name of fs.readdirSync(target.dir))if(new RegExp('^'+target.name+'_\\d+\\.dat$').test(name))largest=Math.max(largest,size(path.join(target.dir,name)));bytes+=4*clone+largest+128*MiB;}
 return[{path:data,bytes,reason:'Archivkopien, Auslesen, Vorschau, Sicherung und gegebenenfalls Sprachdaten'}];
}
function assertPrepareSpace(context,options={}){return assertSpace(prepareRequirements(context),options);}
function commitRequirements(changes,rollback,extraBackupBytes=0){
 let backups=extraBackupBytes;const targets=new Map();
 for(const row of changes){const previous=size(row.destination),next=row.source?size(row.source):0;backups+=previous;const directory=path.dirname(path.resolve(row.destination)),drive=path.parse(directory).root.toLowerCase();let target=targets.get(drive);if(!target){target={path:directory,growth:0,peak:0};targets.set(drive,target);}target.peak=Math.max(target.peak,target.growth+next);target.growth+=Math.max(0,next-previous);}
 return[{path:rollback,bytes:backups,reason:'Vollständige Sicherung aller bisherigen Zieldateien'},...[...targets.values()].map(row=>({path:row.path,bytes:Math.max(row.peak,row.growth),reason:'Zielzuwachs und atomarer temporärer Spitzenbedarf; freizugebende Dateien werden nicht vorab gutgeschrieben'}))];
}
function assertCommitSpace(changes,rollback,options={}){return assertSpace(commitRequirements(changes,rollback,options.extraBackupBytes||0),options);}
function spaceError(error,context){if(error?.code==='STUDIO_INSUFFICIENT_SPACE')return error;if(error?.code==='ENOSPC'||/\bENOSPC\b/.test(String(error?.message))){const result=Error('Nicht genügend freier Speicher bei '+context+'. Bitte Speicher auf dem Daten- und Ziellaufwerk freigeben und danach den Vorgang erneut prüfen. '+String(error.message));result.code='STUDIO_INSUFFICIENT_SPACE';return result;}return error;}
function jobPath(data,job){const jobs=path.resolve(data,'jobs'),directory=path.resolve(job);if(path.dirname(directory)!==jobs||!JOB.test(path.basename(directory)))throw Error('Nur numerische Studio-Arbeitsordner dürfen bereinigt werden.');regularDirectory(jobs);regularDirectory(directory);return directory;}
function markJobRunning(data,job,targetId){const directory=jobPath(data,job),file=path.join(directory,'.studio-running.json');if(fs.existsSync(file)){const old=read(file);if(old.pid!==process.pid&&alive(old.pid))throw Error('Dieser Arbeitsordner wird noch verwendet.');}fs.writeFileSync(file,JSON.stringify({pid:process.pid,targetId,startedAt:new Date().toISOString()}));}
function clearJobRunning(data,job){if(!job||!fs.existsSync(job))return;const file=path.join(jobPath(data,job),'.studio-running.json');if(fs.existsSync(file)&&read(file).pid===process.pid)fs.unlinkSync(file);}
function noLinks(directory){regularDirectory(directory);for(const entry of fs.readdirSync(directory,{withFileTypes:true})){if(entry.isSymbolicLink())throw Error('Verknüpfung in Arbeitsdaten: '+entry.name);if(entry.isDirectory())noLinks(path.join(directory,entry.name));}}
function removePart(data,job,part){if(![...SCRATCH,'rollback'].includes(part))throw Error('Nicht freigegebener Bereinigungsteil.');const directory=jobPath(data,job),target=inside(directory,path.join(directory,part));if(!fs.existsSync(target))return false;noLinks(target);if(!fs.realpathSync(target).startsWith(fs.realpathSync(directory)+path.sep))throw Error('Aufgelöster Bereinigungspfad ist ungültig.');fs.rmSync(target,{recursive:true,force:false});return true;}
function references(value,jobs,protectedJobs){
 if(typeof value==='string'){if(JOB.test(value))protectedJobs.add(value);else if(path.isAbsolute(value)){const rel=path.relative(jobs,path.resolve(value)),id=rel.split(path.sep)[0];if(!rel.startsWith('..')&&!path.isAbsolute(rel)&&JOB.test(id))protectedJobs.add(id);}return;}
 if(value&&typeof value==='object')for(const child of Object.values(value))references(child,jobs,protectedJobs);
}
function journals(directory,visit){regularDirectory(directory);for(const entry of fs.readdirSync(directory,{withFileTypes:true})){if(entry.isSymbolicLink())throw Error('Verknüpfte Arbeitsdaten werden nicht automatisch bereinigt.');const file=path.join(directory,entry.name);if(entry.isDirectory())journals(file,visit);else if(entry.isFile()&&['transaction.json','journal.json'].includes(entry.name))visit(read(file));}}
function cleanupJobs(data,options={}){
 const result={removed:[],protected:[],warnings:[]},root=path.resolve(data),jobs=path.join(root,'jobs');if(!fs.existsSync(jobs))return result;
 let maintenance=null,ownsLock=false;
 try{
  regularDirectory(root);regularDirectory(jobs);maintenance=path.join(root,'maintenance.lock');
  if(fs.existsSync(maintenance)){const lock=read(maintenance);if(alive(lock.pid)){result.skipped='Andere Bereinigung läuft.';return result;}fs.unlinkSync(maintenance);}
  fs.writeFileSync(maintenance,JSON.stringify({pid:process.pid}),{flag:'wx'});ownsLock=true;
  const protectedJobs=new Set(),directories=fs.readdirSync(jobs,{withFileTypes:true}).filter(row=>row.isDirectory()&&!row.isSymbolicLink()).map(row=>row.name);
  const numeric=directories.filter(name=>JOB.test(name)).sort((a,b)=>Number(b.split('-')[0])-Number(a.split('-')[0])||b.localeCompare(a));
  for(const name of numeric.slice(0,2))protectedJobs.add(name);
  if(options.currentJob)protectedJobs.add(path.basename(options.currentJob));
  for(const entry of fs.readdirSync(root,{withFileTypes:true}))if(entry.isFile()&&/^latest-.+\.json$/.test(entry.name)){const value=read(path.join(root,entry.name));if(typeof value.job!=='string')throw Error('Vorschauverweis ist beschädigt.');references(value,jobs,protectedJobs);}
  let liveLocks=0;const targets=path.join(root,'targets');
  if(fs.existsSync(targets)){regularDirectory(targets);for(const entry of fs.readdirSync(targets,{withFileTypes:true})){if(!entry.isDirectory())continue;const target=path.join(targets,entry.name);regularDirectory(target);const state=path.join(target,'state.json');if(fs.existsSync(state)){const value=read(state);references(value.lastJob,jobs,protectedJobs);}const lock=path.join(target,'operation.lock');if(fs.existsSync(lock)){const value=read(lock);if(alive(value.pid)){liveLocks++;if(value.pid!==process.pid)throw Error('Ein anderer Studio-Vorgang läuft; alte Arbeitsdaten bleiben erhalten.');}}const renewals=path.join(target,'basis-renewals');if(fs.existsSync(renewals)){regularDirectory(renewals);for(const r of fs.readdirSync(renewals,{withFileTypes:true}).filter(r=>r.isDirectory())){const file=path.join(renewals,r.name,'journal.json');if(fs.existsSync(file)){const value=read(file);if(!TERMINAL.has(value.status))references(value,jobs,protectedJobs);}}}}}
  if(liveLocks>1)throw Error('Mehrere Studio-Vorgänge laufen; Bereinigung wird ausgelassen.');
  for(const name of directories){const directory=path.join(jobs,name);journals(directory,value=>{if(!TERMINAL.has(value.status)){if(JOB.test(name))protectedJobs.add(name);references(value,jobs,protectedJobs);}});const marker=path.join(directory,'.studio-running.json');if(fs.existsSync(marker)){try{if(alive(read(marker).pid)&&JOB.test(name))protectedJobs.add(name);}catch{if(JOB.test(name))protectedJobs.add(name);}}}
  for(const name of [...protectedJobs]){const planFile=path.join(jobs,name,'plan.json');if(fs.existsSync(planFile))references(read(planFile).clientPackagePreparation?.clientPlanFile,jobs,protectedJobs);}
  result.protected=[...protectedJobs];
  for(const name of numeric){if(protectedJobs.has(name))continue;const directory=path.join(jobs,name),parts=[];for(const part of [...SCRATCH,'rollback'])if(removePart(root,directory,part))parts.push(part);if(parts.length)result.removed.push({job:name,parts,metadataKept:true});}
 }catch(error){result.skipped=error.message;result.warnings.push(error.message);}
 finally{if(ownsLock&&maintenance&&fs.existsSync(maintenance))try{fs.unlinkSync(maintenance);}catch(error){result.warnings.push(error.message);}}
 if(typeof options.log==='function'&&result.removed.length)options.log('Alte Arbeitsdaten bereinigt: '+result.removed.length+' unbenutzte Jobs; Profile, Basen und aktive Vorgänge bleiben erhalten.');return result;
}
function cleanupAppliedJob(data,job,options={}){
 const directory=jobPath(data,job),plan=read(path.join(directory,'plan.json')),journal=read(path.join(directory,'transaction.json'));if(plan.applied!==true||journal.status!=='committed')throw Error('Nicht vollständig bestätigter Job wird nicht bereinigt.');const removed=[];for(const part of SCRATCH)if(removePart(data,directory,part))removed.push(part);if(typeof options.log==='function'&&removed.length)options.log('Temporäre Arbeitsdaten einschließlich Sprachkopien entfernt.');return removed;
}
module.exports={diskInfo,assertSpace,prepareRequirements,assertPrepareSpace,commitRequirements,assertCommitSpace,spaceError,markJobRunning,clearJobRunning,cleanupJobs,cleanupAppliedJob,RESERVE,SCRATCH};
