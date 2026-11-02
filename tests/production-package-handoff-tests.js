'use strict';
// The real V2 prepare, export, snapshot and receipt path with inert local files.
// No game, network, external runtime, original archives or user data is used.
const fs=require('fs'),path=require('path'),assert=require('assert');
const engine=path.resolve(__dirname,'../engine'),packages=require(path.join(engine,'client-packages')),manager=require(path.join(engine,'manager-handoff'));
const base=fs.mkdtempSync(path.join(__dirname,'.production-package-handoff-')),checks=[];
const write=(file,value)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,typeof value==='string'?value:JSON.stringify(value,null,2));};
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const sha=file=>manager._test.hash(fs.readFileSync(file));
const check=(name,fn)=>{fn();checks.push(name);};
const schema=read(path.join(engine,'../assets/schema.json'));
const target={dir:path.join(base,'instance/install'),server:true,name:'enshrouded_server',exe:'enshrouded_server.exe',archives:['enshrouded_server.kfc','enshrouded_server.kfc_resources']};target.id=manager.targetId(target.dir);
const binding={format:1,profileId:'a'.repeat(32),sourceDirectory:target.dir,targetId:target.id,automaticClientPackages:true};
const options={root:engine,data:path.join(base,'studio/patches'),spaceReserveBytes:0,spaceProbe:()=>({freeBytes:10*1024*1024*1024,volume:'fixture'}),clientBasisCandidates:[],log:()=>{}};
const handoffFile=path.join(manager.transferDirectory(binding),'handoff.json'),pointerFile=path.join(manager.outputDirectory(binding),target.id,'current.json');
for(const name of [target.exe,...target.archives])write(path.join(target.dir,name),'inert-'+name);
write(path.join(target.dir,'.ugsm-studio.json'),binding);
function configuration(value){
 const config={gameDirectory:target.dir,outputDirectory:'./output',settings:{keepTempFiles:false,keepModdedFiles:false}};
 for(const c of schema){config[c.Key]={};for(const m of c.Mods){const v={enabled:false};for(const f of m.Fields||[])v[f.Key]=f.Boolean?false:f.Integer?Math.ceil(f.Minimum):f.Minimum;config[c.Key][m.Key]=v;}}
 config.inventory.adjustStackSize={enabled:true,value};return config;
}
async function prepare(id,value){
 const job=path.join(options.data,'jobs',id),config=configuration(value),source={$type:'keen::ItemInfo',$guid:'11111111-2222-3333-4444-555555555555',$part:0,maxStackSize:20};
 write(path.join(job,'unpacked/ItemInfo/item.json'),source);write(path.join(job,'modified/ItemInfo/item.json'),{...source,maxStackSize:value});
 const plan={format:2,id,job,target,config,applied:true,build:require('../engine/build-contract').BUILD,source:{exe:sha(path.join(target.dir,target.exe))},artifacts:target.archives.map(name=>({name,sha256:sha(path.join(target.dir,name))})),mods:{},modifiedFiles:1,verifiedFiles:1};
 const state={lastJob:id,currentArchives:Object.fromEntries(plan.artifacts.map(a=>[a.name,a.sha256]))};
 plan.clientPackagePreparation=await packages.prepareForPlan(options,plan,()=>{throw Error('A client installation must never be prepared');});
 assert.equal(plan.clientPackagePreparation.status,'prepared',plan.clientPackagePreparation.message);
 write(path.join(job,'plan.json'),plan);write(path.join(options.data,'targets',target.id,'state.json'),state);
 manager.receipt(options,{...plan,id:null},'preparing','Fixture server commit');
 return {plan,state};
}
function complete(f){return packages.completeForPlan(options,f.plan,f.state);}
function ready(f,result){assert.equal(result.status,'ready',result.message);const receipt=read(handoffFile),pointer=read(pointerFile);assert.equal(receipt.status,'ready');assert.equal(receipt.sourcePlanId,f.plan.id);assert.equal(pointer.sourcePlanId,f.plan.id);assert.equal(receipt.packageRevision,result.revision);assert.equal(pointer.revision,result.revision);assert.equal(packages.verifyPayload(result.packageDirectory,read(path.join(result.packageDirectory,'manifest.json'))),true);}
(async()=>{
 const first=await prepare('100-abcd',500),a=complete(first);
 check('production recipe export and bound receipt are ready without a client installation',()=>ready(first,a));
 const second=await prepare('200-abcd',750),b=complete(second);
 check('a subsequent changed patch replaces the exact previous package and snapshot',()=>{ready(second,b);assert.notEqual(a.revision,b.revision);assert.equal(read(pointerFile).previousRevision,a.revision);});
 const lower=await prepare('300-abcd',250),c=complete(lower);
 check('lowering a setting publishes the lower value as a new ready revision',()=>{ready(lower,c);assert.notEqual(c.revision,b.revision);assert.equal(read(path.join(c.packageDirectory,'manifest.json')).options.inventory.adjustStackSize.value,250);});
 const unchanged=await prepare('400-abcd',250),d=complete(unchanged);
 check('unchanged settings still complete a fresh patch and bind it to the current job',()=>{ready(unchanged,d);assert.equal(d.revision,c.revision);});
 const failed=await prepare('500-abcd',1000),recipeFile=failed.plan.clientPackagePreparation.recipe.file,original=fs.readFileSync(recipeFile);
 fs.writeFileSync(recipeFile,Buffer.from('broken fixture'));const rejected=complete(failed);
 check('a failed export keeps the server commit but revokes current readiness and stores its actual cause',()=>{assert.equal(failed.plan.applied,true);assert.equal(rejected.status,'failed');assert.equal(read(handoffFile).status,'failed');assert.equal(read(handoffFile).packageRevision,null);assert.equal(read(pointerFile).status,'failed');assert(read(pointerFile).message.includes('Rezept'));assert(fs.existsSync(recipeFile));});
 fs.writeFileSync(recipeFile,original);const repaired=complete(failed);
 check('retrying the same applied job after a corrected package input recovers without a server repatch',()=>ready(failed,repaired));
 const foreign=await prepare('600-abcd',1250);fs.writeFileSync(path.join(target.dir,target.archives[0]),'changed outside Studio');const stale=complete(foreign);
 check('an externally changed archive never receives a ready package',()=>{assert.equal(stale.status,'failed');assert.equal(read(handoffFile).status,'failed');assert.equal(read(pointerFile).status,'failed');});
 const report={passed:true,checks:checks.length,passedChecks:checks,gameStarted:false,syntheticFixturesOnly:true};write(path.join(__dirname,'production-package-handoff-results.json'),report);console.log(JSON.stringify(report,null,2));
})().catch(error=>{console.error(error.stack);process.exitCode=1;}).finally(()=>{if(path.dirname(base)!==__dirname||!path.basename(base).startsWith('.production-package-handoff-'))throw Error('Unexpected fixture cleanup path');fs.rmSync(base,{recursive:true,force:true});});
