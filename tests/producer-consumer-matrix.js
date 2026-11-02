'use strict';
// Runtime production create/export code, independent from the Go consumer.
// Only source inputs are fixtures; created resources are never fixture outputs.
const fs=require('fs'),path=require('path'),os=require('os'),zlib=require('zlib'),assert=require('assert');
const engine=path.resolve(__dirname,'../engine'),R=require(path.join(engine,'resource-recipe')),P=require(path.join(engine,'client-packages'));
const fixtureFile=path.join(__dirname,'fixtures/producer-matrix-inputs.json.gz'),provenance=require('./fixtures/producer-matrix-provenance.json');
const packed=fs.readFileSync(fixtureFile);assert.equal(R.digest(packed),provenance.fixtureSha256,'source fixture digest');
const bytes=zlib.gunzipSync(packed);assert.equal(R.digest(bytes),provenance.uncompressedSha256,'source fixture identity');
const fixture=JSON.parse(bytes);assert.equal(fixture.format,1);assert.equal(fixture.sourceBuild,require(path.join(engine,'build-contract')).REVISION);require(path.join(engine,'build-contract')).assertReflection(fixture.reflection);
assert.equal(provenance.sourceBuild,fixture.sourceBuild);assert.equal(provenance.nativeBuild,fixture.reflection.version);assert.equal(provenance.sourceRole,'server');
for(const [file,expected]of Object.entries(provenance.producerFiles))assert.equal(R.digest(fs.readFileSync(path.join(engine,file))),expected,'Captured source variant producer changed: '+file);
const engineManifest=JSON.parse(fs.readFileSync(path.join(engine,'engine-manifest.json'))),engineFingerprint=R.digest(R.canonical(engineManifest));
const clone=v=>JSON.parse(JSON.stringify(v)),write=(file,value)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(value));};
const candidate=process.argv[2]==='--candidate-output';
const outputArgument=process.argv[candidate?3:2];
if(process.argv.length>(candidate?4:3)||(candidate&&!outputArgument))throw Error('Usage: node producer-consumer-matrix.js [new-output-directory] (review only: --candidate-output new-directory)');
const output=outputArgument?path.resolve(outputArgument):null;
if(output&&fs.existsSync(output))throw Error('Matrix output must be a new directory');
const scratchParent=output?path.dirname(output):path.resolve(process.env.EMS_MATRIX_TEMP_ROOT||os.tmpdir());
const scratch=fs.mkdtempSync(path.join(scratchParent,'ems-producer-matrix-'));
const profiles=[
 {name:'plain',variant:'plain'},
 {name:'mana',variant:'mana'},
 {name:'cast',variant:'cast'},
 {name:'round-down',variant:'round-down'},
 {name:'round-up',variant:'round-up'},
 {name:'minimum',variant:'minimum'},
 {name:'stack',variant:'plain',stack:65000},
 {name:'item-level',variant:'plain',level:100},
 {name:'root-rewards',variant:'plain',root:2},
 {name:'combined',variant:'combined',stack:65535,level:100,root:85,bounds:true}
];
const keys=['enableSkeletonSummoningSpells','enableNightPlantCultivation','enableDrakMerchant'];
const rows=[];
try{
 if(output)fs.mkdirSync(output);
 for(let mask=1;mask<8;mask++)for(const profile of profiles){
  const name=mask+'-'+profile.name,job=path.join(scratch,name),input=path.join(job,'unpacked'),modified=path.join(job,'modified');
  for(const row of fixture.documents)write(path.join(input,row.directory,row.file),row.document);
  const config=require('../assets/defaults.json');const cfg=clone(config);
  for(const c of ['world','gameplay','player','inventory'])for(const v of Object.values(cfg[c]))if(v&&typeof v==='object')v.enabled=false;
  for(const [i,key]of keys.entries())cfg.world[key]={...cfg.world[key],enabled:!!(mask&(1<<i))};
  cfg.world.enableSkeletonSummoningSpells.maxCompanions=4;cfg.world.enableDrakMerchant.maxCompanions=4;
  if(profile.bounds){Object.assign(cfg.world.enableSkeletonSummoningSpells,{maxCompanions:8,durationSeconds:3600,strengthFactor:20});Object.assign(cfg.world.enableNightPlantCultivation,{growthMinutes:1440,harvestCount:99});Object.assign(cfg.world.enableDrakMerchant,{maxCompanions:8,durationSeconds:3600,strengthFactor:20});}
  const source=fixture.documents.find(r=>r.document.$guid==='4147dce3-27fd-406f-9937-29b478a94046'),variant=fixture.variants.find(v=>v.name===profile.variant);
  assert(variant,'missing captured vendor input '+profile.variant);
  for(const [option,value]of [['adjustManaCost',variant.mana],['adjustSpellCastTime',variant.cast]])if(value!==null)cfg.gameplay[option]={enabled:true,factor:value};
  if(variant.mana!==null||variant.cast!==null)write(path.join(modified,source.directory,source.file),variant.document);
  if(profile.stack)cfg.inventory.adjustStackSize={enabled:true,value:profile.stack};
  if(profile.root){cfg.player.adjustSkillPointsPerRoot={enabled:true,factor:profile.root};const knowledge=fixture.documents.find(r=>r.directory==='GameKnowledgeResource');const captured=fixture.knowledgeVariants.find(v=>v.factor===profile.root);assert(captured);write(path.join(modified,knowledge.directory,knowledge.file),captured.document);}
  if(profile.level){cfg.gameplay.adjustItemMaxLevel={enabled:true,value:profile.level};require(path.join(engine,'item-values-fix')).apply({config:cfg,reflection:fixture.reflection},input,modified);}
  const ctx={role:'server',reflection:fixture.reflection,options:cfg};const own=cfg.world.enableSkeletonSummoningSpells;
  const skeleton=require(path.join(engine,'skeleton-spells'));
  skeleton.apply({...ctx,...own},input,modified);
  require(path.join(engine,'night-plants')).apply({...ctx,input,modified});
  // Drak's outer apply requires hashes of full original game registries. Keep
  // public CI small by calling its real create and registry mutation methods
  // against the same inert shared inputs; do not fabricate any created output.
  if(cfg.world.enableDrakMerchant.enabled){
   const drak=require(path.join(engine,'drak-merchant')),d=drak.definitions;
   for(const doc of drak.buildCreatedResources(cfg)){const row=drak.CREATED_RESOURCES.find(r=>r.guid===doc.$guid);write(path.join(modified,row.directory,row.file),doc);}
   for(const key of ['items','recipes','knowledge','npcs','workshops']){const row=d.registries[key],dest=path.join(modified,row.directory,row.file),before=JSON.parse(fs.readFileSync(fs.existsSync(dest)?dest:path.join(input,row.directory,row.file)));write(dest,drak.modifyResource(before,key,cfg.world.enableDrakMerchant));}
   for(const row of d.playerSources){const dest=path.join(modified,row.directory,row.file),before=JSON.parse(fs.readFileSync(fs.existsSync(dest)?dest:path.join(input,row.directory,row.file)));write(dest,drak.modifyResource(before,'player',cfg.world.enableDrakMerchant));}
  }
  if(own.enabled&&(mask&6))skeleton.apply({...ctx,...own},input,modified);
  // The production planner validates the actual create documents and the fixed
  // original collection. An archive inventory is unnecessary for this data gate.
  const registration=require(path.join(engine,'template-collection-registration'));
  const collection=fixture.documents.find(r=>r.directory==='TemplateCollectionResource'),created=registration.selectedTargets(cfg).map(t=>JSON.parse(fs.readFileSync(path.join(modified,'TemplateResource',t.guid+'_39768775_0.json'))));
  write(path.join(modified,collection.directory,collection.file),registration.plan(collection.document,collection.document,created,{originalSHA:registration.ORIGINAL_SHA,originalCount:registration.ORIGINAL_COUNT,options:cfg}));
  const countFiles=dir=>fs.readdirSync(dir,{withFileTypes:true}).reduce((n,e)=>n+(e.isDirectory()?countFiles(path.join(dir,e.name)):e.name.endsWith('.json')?1:0),0);
  const n=countFiles(modified),options=P.publicOptions(cfg,require('../assets/schema.json'));
  const plan={id:name,job,target:{server:true},build:fixture.reflection.version,modifiedFiles:n,verifiedFiles:n};
  const prepared=R.prepare({engineRoot:engine,job,plan,options}),loaded=R.load(prepared,job,engine),data=Buffer.from(R.canonical(loaded.recipe));
  assert.equal(loaded.recipe.engineFingerprint,engineFingerprint,'Producer identity changed during matrix generation');
  const creates=loaded.recipe.resources.filter(r=>r.mode==='create').length;
  assert.equal(creates,(mask&1?9:0)+(mask&2?49:0)+(mask&4?8:0));
  const filename=name+'.json.gz';if(output)fs.copyFileSync(prepared.file,path.join(output,filename));
  rows.push({name,featureMask:mask,profile:profile.name,file:filename,sha256:R.digest(data),compressedSha256:prepared.compressedSha256,size:data.length,resources:loaded.recipe.resources.length,creates});
 }
 assert.equal(R.digest(R.canonical(JSON.parse(fs.readFileSync(path.join(engine,'engine-manifest.json'))))),engineFingerprint,'Producer identity changed during matrix generation');
 const index={format:1,studioVersion:engineManifest.studio,engineVersion:engineManifest.version,engineFingerprint,sourceBuild:fixture.sourceBuild,nativeBuild:fixture.reflection.version,sourceFixtureSha256:provenance.fixtureSha256,profiles:profiles.map(p=>p.name),cases:rows,vendorRuntimeExecuted:false,nativeArchivePackingExecuted:false,gameStarted:false};
 assert.equal(rows.length,70);if(output)write(path.join(output,'index.json'),index);
 if(!candidate){
  const contract=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/producer-consumer-contract.json'),'utf8'));
  assert.equal(contract.format,1);assert.equal(contract.engineFingerprint,index.engineFingerprint,'Producer changed: review the paired consumer before certifying new output');assert.equal(contract.studioVersion,index.studioVersion);assert.equal(contract.engineVersion,index.engineVersion);assert.equal(contract.nativeBuild,index.nativeBuild);assert.equal(contract.sourceFixtureSha256,index.sourceFixtureSha256);
  assert.deepStrictEqual(rows.map(({name,sha256,resources,creates})=>({name,sha256,resources,creates})),contract.cases,'Actual producer output differs from the independently consumer-certified recipe contract');
 }
 console.log(JSON.stringify({passed:true,candidateOnly:candidate,cases:rows.length,features:keys,baseOptions:['gameplay.adjustManaCost','gameplay.adjustSpellCastTime','inventory.adjustStackSize','gameplay.adjustItemMaxLevel','player.adjustSkillPointsPerRoot'],vendorRuntimeExecuted:false,nativeArchivePackingExecuted:false,gameStarted:false}));
}finally{if(path.dirname(scratch)!==scratchParent||!path.basename(scratch).startsWith('ems-producer-matrix-'))throw Error('Unexpected fixture cleanup path');fs.rmSync(scratch,{recursive:true,force:true});}
