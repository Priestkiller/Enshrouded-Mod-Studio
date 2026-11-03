'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert'),crypto=require('crypto');
const recipe=require('../engine/resource-recipe'),packages=require('../engine/client-packages');
const root=path.resolve(__dirname,'..','engine'),scratch=path.resolve(__dirname,'..','..','recipe-export-tests-'+Date.now());
fs.mkdirSync(scratch);const checks=[];
function check(name,run){run();checks.push(name);}
function write(file,doc){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(doc));}
const defs=require('../engine/skeleton-spell-definitions.json'),schema=require('../assets/schema.json');
const config={world:{},inventory:{},gameplay:{},player:{}};
for(const c of schema)for(const m of c.Mods){config[c.Key]??={};config[c.Key][m.Key]={enabled:false};for(const f of m.Fields||[])config[c.Key][m.Key][f.Key]=f.Boolean?false:f.Integer?Math.ceil(f.Minimum):f.Minimum;}
config.inventory.adjustStackSize.enabled=true;
config.inventory.adjustStackSize.value=500;
const options=packages.publicOptions(config,schema);
const game=path.join(scratch,'server'),job=path.join(scratch,'job');fs.mkdirSync(game);fs.mkdirSync(job);
const source={$type:'keen::ItemInfo',$guid:'11111111-2222-3333-4444-555555555555',$part:0,maxStackSize:20,untouched:'keep'};
const after={...source,maxStackSize:500};
write(path.join(job,'unpacked','ItemInfo','item.json'),source);write(path.join(job,'modified','ItemInfo','item.json'),after);
const plan={id:'1793000000000-abcdef12',job,target:{id:'a'.repeat(20),dir:game,server:true,name:'enshrouded_server',archives:['enshrouded_server.kfc','enshrouded_server.kfc_resources']},build:require('../engine/build-contract').BUILD,config,modifiedFiles:1,verifiedFiles:1,mods:{}};
plan.nativeCompatibility=require('./native-compatibility-fixture').writeJob(job,plan.build);
const engineOptions={root,data:path.join(scratch,'data','patches'),spaceReserveBytes:0,spaceProbe:()=>({freeBytes:10*1024*1024*1024,volume:'test-volume'})};
let prepared,built;
check('New default uses resource recipes without a client directory',()=>{const settings=packages.settings(engineOptions);assert.equal(settings.transportMode,'resource-recipe');assert.equal(settings.clientBasisDirectory,null);});
check('A verified server export creates a compressed data-only recipe',()=>{prepared=recipe.prepare({engineRoot:root,job,plan,options});assert.equal(prepared.resources,1);assert(prepared.compressedSize<prepared.size);});
function boundaryFixture(name){
 const boundaryJob=path.join(scratch,name),boundaryPlan={...plan,job:boundaryJob};
 write(path.join(boundaryJob,'unpacked/ItemInfo/item.json'),source);write(path.join(boundaryJob,'modified/ItemInfo/item.json'),after);
 boundaryPlan.nativeCompatibility=require('./native-compatibility-fixture').writeJob(boundaryJob,boundaryPlan.build);
 return {job:boundaryJob,plan:boundaryPlan,file:path.join(boundaryJob,'bin/reflection_data.json')};
}
check('A claimed compatibility proof cannot replace fresh native reflection',()=>{
 const f=boundaryFixture('missing-fresh-reflection');fs.unlinkSync(f.file);
 assert.throws(()=>recipe.prepare({engineRoot:root,job:f.job,plan:f.plan,options}),error=>error.code==='ENOENT');
 assert.equal(fs.existsSync(path.join(f.job,'client-recipe.json.gz')),false);
});
check('Changed fresh field offsets are rejected before any recipe is exported',()=>{
 const f=boundaryFixture('changed-fresh-layout'),reflection=JSON.parse(fs.readFileSync(f.file,'utf8'));
 reflection.types.find(type=>type.qualifiedName==='keen::ItemInfo').structFields.maxStackSize.dataOffset++;write(f.file,reflection);
 assert.throws(()=>recipe.prepare({engineRoot:root,job:f.job,plan:f.plan,options}),error=>error.actionCode==='game_schema_unsupported');
 assert.equal(fs.existsSync(path.join(f.job,'client-recipe.json.gz')),false);
});
check('Compatible fresh reflection from a different game build cannot certify this plan',()=>{
 const f=boundaryFixture('different-fresh-build'),reflection=JSON.parse(fs.readFileSync(f.file,'utf8'));
 reflection.version='1285601|^/game38/branches/release_1.0|2026-11-03T10:13:01.005543Z';write(f.file,reflection);
 assert.throws(()=>recipe.prepare({engineRoot:root,job:f.job,plan:f.plan,options}),/Frische Spielversion/);
 assert.equal(fs.existsSync(path.join(f.job,'client-recipe.json.gz')),false);
});
check('Recipe binds the exact game build and preserves the original preimage',()=>{const loaded=recipe.load(prepared,job,root);assert.equal(loaded.recipe.gameBuild,plan.build);assert.deepEqual(loaded.recipe.resources[0].before,source);assert.deepEqual(loaded.recipe.resources[0].after,after);assert.equal(loaded.recipe.resources[0].mode,'modify');});
check('No client installation or client archive is created',()=>assert.deepEqual(fs.readdirSync(game),[]));
check('Recipe SHA256 is the canonical uncompressed data identity',()=>{const r=recipe.load(prepared,job,root).recipe;assert.equal(crypto.createHash('sha256').update(recipe.canonical(r)).digest('hex'),prepared.sha256);});
check('Full V2 package exports only compressed data blobs',()=>{plan.clientPackagePreparation={recipe:prepared};built=packages.buildResourcePackage(engineOptions,plan,{outputDirectory:path.join(scratch,'packages')});const m=JSON.parse(fs.readFileSync(path.join(built.packageDirectory,'manifest.json')));assert.equal(m.formatVersion,2);assert.equal(m.requiredCapability,recipe.CAPABILITY);assert(!Object.hasOwn(m,'requiredClientExeSha256'));assert(!Object.hasOwn(m,'files'));assert.equal(m.recipe.delta.base,null);assert.equal(m.recipe.sha256,prepared.sha256);assert.equal(packages.verifyPayload(built.packageDirectory,m),true);});
const canonicalRecipe=recipe.load(prepared,job,root).recipe;
const clone=()=>JSON.parse(JSON.stringify(canonicalRecipe));
check('Resource identity changes are rejected',()=>{const r=clone();r.resources[0].after.$guid='22222222-2222-3333-4444-555555555555';assert.throws(()=>recipe.validate(r,defs));});
check('Duplicate resources are rejected',()=>{const r=clone();r.resources.push(r.resources[0]);assert.throws(()=>recipe.validate(r,defs));});
check('Unknown resources cannot be created',()=>{const r=clone();r.resources[0].mode='create';r.resources[0].before=null;assert.throws(()=>recipe.validate(r,defs));});
check('An unchanged row is rejected',()=>{const r=clone();r.resources[0].after=r.resources[0].before;assert.throws(()=>recipe.validate(r,defs));});
check('Unknown row fields are rejected',()=>{const r=clone();r.resources[0].script='run';assert.throws(()=>recipe.validate(r,defs));});
check('Unknown top-level instructions are rejected',()=>{const r=clone();r.executable='game.exe';assert.throws(()=>recipe.validate(r,defs));});
check('Prototype-mutating JSON keys are rejected',()=>{const r=clone();r.resources[0].after.data=JSON.parse('{"__proto__":{"polluted":true}}');assert.throws(()=>recipe.validate(r,defs));});
check('Client-only resources cannot be supplied by server recipes',()=>{const r=clone();r.resources[0].type='keen::FbUiBundle';r.resources[0].before.$type=r.resources[0].after.$type='keen::FbUiBundle';assert.throws(()=>recipe.validate(r,defs));});
check('Changed compressed recipe is rejected before package creation',()=>{const bytes=fs.readFileSync(prepared.file);fs.writeFileSync(prepared.file,Buffer.from(bytes).fill(0,10,11));assert.throws(()=>recipe.load(prepared,job,root));fs.writeFileSync(prepared.file,bytes);});
check('A recipe outside its owned job is rejected',()=>assert.throws(()=>recipe.load({...prepared,file:path.join(scratch,'unowned.gz')},job,root)));
check('Mismatched uncompressed size is rejected',()=>assert.throws(()=>recipe.load({...prepared,size:prepared.size+1},job,root)));
check('Unverified server resources cannot be exported',()=>assert.throws(()=>recipe.prepare({engineRoot:root,job,plan:{...plan,verifiedFiles:0},options})));
check('A client target cannot masquerade as a server-derived recipe',()=>assert.throws(()=>recipe.prepare({engineRoot:root,job,plan:{...plan,target:{...plan.target,server:false}},options})));
check('unchanged options grant no new resource identities',()=>assert.strictEqual(recipe.allowedCreates(defs,{world:{}}).size,0));
check('unknown feature names cannot introduce resource permissions',()=>assert.strictEqual(recipe.allowedCreates(defs,{world:{enableArbitraryResources:{enabled:true}}}).size,0));
check('legacy companion definitions are bound to their complete descriptor digest',()=>{const changed=JSON.parse(JSON.stringify(defs));changed.items[0].guid='11111111-2222-3333-4444-555555555555';assert.throws(()=>recipe.allowedCreates(changed),/Featuredefinition/);});
check('new feature permissions have exact independent identity and type counts',()=>{for(const [key,total,templates,inventories]of [['enableNightPlantCultivation',49,28,14],['enableDrakMerchant',8,4,0]]){const fspec=recipe.featureDescriptors({world:{[key]:{enabled:true}}})[0];assert.strictEqual(fspec.resources.length,total);assert.strictEqual(fspec.templates.length,templates);assert.strictEqual(fspec.resources.filter(r=>r.type==='keen::ecs::DefaultInventoryResource').length,inventories);assert(/^[a-f0-9]{64}$/.test(fspec.definitionSha256));}});
check('Drak native registries cannot be changed while its option is disabled',()=>{const r=clone(),d={$type:'keen::NpcCollection',$guid:'377f61dc-c7b8-4e4f-830f-7d2c3e8b7fd8',$part:0,npcs:[]};r.resources=[{type:d.$type,guid:d.$guid,part:0,mode:'modify',before:d,after:{...d,npcs:[{}]}}];assert.throws(()=>recipe.validate(r,defs),/Drak-Katalogänderung/);});
const nativeCollection=process.env.EMS_NATIVE_COLLECTION;
if(nativeCollection){
 const N=require('../engine/night-plants'),K=require('../engine/custom-skeleton-items'),D=N.definitions,copy=v=>JSON.parse(JSON.stringify(v));
 const flag=(t,id)=>{const v=copy(t);v.id.id.value=id;return v;},empty=()=>({entries:[{start:0,count:0}],keys:[],values:[]});
 const doc=(type,guid,data)=>({$type:type,$guid:guid,$part:0,...data});
 const nativeItems=Object.values(D.sources).filter(r=>r.directory==='ItemInfo').map(r=>r.document);
 const catalog=doc(D.types.ItemRegistryResource,D.registries.items,{itemRefs:nativeItems.map(d=>d.$guid),dbgNames:nativeItems.map(d=>d.debugName)}),recipes=doc(D.types.RecipeRegistryResource,D.registries.recipes,{inputCategories:[],recipes:[copy(D.sourceRecipe)]});
 const player=[D.knowledgeTemplates.playerItem,D.knowledgeTemplates.playerRecipe].map(v=>[v.id.id.value,copy(v)]),world=[copy(D.knowledgeTemplates.worldItem),...D.plants.map(p=>flag(D.knowledgeTemplates.worldItem,D.sources[p.key+'Item'].document.itemId.value))].map(v=>[v.id.id.value,v]);
 const knowledge=doc(D.types.GameKnowledgeResource,D.registries.knowledge,{playerKnowledge:K.rebuildMap(empty(),player),worldKnowledge:K.rebuildMap(empty(),world)}),afterCatalog=copy(catalog),afterRecipes=copy(recipes),afterKnowledge=copy(knowledge),pAdds=[],wAdds=[];
 for(const p of D.plants){afterCatalog.itemRefs.push(p.itemGuid);afterCatalog.dbgNames.push(p.debugName);afterRecipes.recipes.push(N.ownRecipe(p));pAdds.push([p.itemId,flag(D.knowledgeTemplates.playerItem,p.itemId)],[p.recipeId,flag(D.knowledgeTemplates.playerRecipe,p.recipeId)]);wAdds.push([p.itemId,flag(D.knowledgeTemplates.worldItem,p.itemId)]);}
 afterKnowledge.playerKnowledge=K.rebuildMap(afterKnowledge.playerKnowledge,pAdds);afterKnowledge.worldKnowledge=K.rebuildMap(afterKnowledge.worldKnowledge,wAdds);
 const selected=copy(options);selected.world.enableNightPlantCultivation={enabled:true,growthMinutes:20,harvestCount:2};const beforeCollection=JSON.parse(fs.readFileSync(nativeCollection,'utf8'));
 const featureRecipe={...clone(),gameBuild:plan.build,options:selected,resources:[...N.buildCreatedResources(selected).map(after=>({type:after.$type,guid:after.$guid,part:0,mode:'create',before:null,after})),...[catalog,recipes,knowledge,beforeCollection].map((before,i)=>({type:before.$type,guid:before.$guid,part:0,mode:'modify',before,after:i===0?afterCatalog:i===1?afterRecipes:i===2?afterKnowledge:{...copy(before),templates:[...before.templates,...N.registrationTargets().map(t=>t.guid)]}}))]};
 featureRecipe.resources.sort((a,b)=>{const x=a.type+'|'+a.guid+'|'+a.part,y=b.type+'|'+b.guid+'|'+b.part;return x<y?-1:x>y?1:0;});
 check('native pinned collection permits the complete exact plant transfer',()=>assert.strictEqual(recipe.validate(featureRecipe,defs),featureRecipe));
 for(const [name,mutate,pattern]of [
  ['missing creation',r=>r.resources.splice(r.resources.findIndex(x=>x.mode==='create'),1),/Pflanzenressource/],
  ['descriptor payload change',r=>r.resources.find(x=>x.type==='keen::ItemInfo'&&x.mode==='create').after.maxStackSize++,/Pflanzenressource/],
  ['unknown creation',r=>r.resources.find(x=>x.mode==='create').after.$guid='11111111-2222-3333-4444-555555555555',/Ressourcenidentität/],
  ['missing collection',r=>r.resources=r.resources.filter(x=>x.type!=='keen::ecs::TemplateCollectionResource'),/Registrierung/],
  ['foreign template append',r=>r.resources.find(x=>x.type==='keen::ecs::TemplateCollectionResource').after.templates.push('11111111-2222-3333-4444-555555555555'),/Originalsammlung/],
  ['disabled plant option',r=>r.options.world.enableNightPlantCultivation.enabled=false,/freigegebene/],
  ['unapproved native build',r=>r.gameBuild='future-build',/Spielbuild/]
 ])check('strict plant transfer rejects '+name,()=>{const r=copy(featureRecipe);mutate(r);assert.throws(()=>recipe.validate(r,defs),pattern);});
}
const report={passed:true,checks,gameStarted:false,desktopStarted:false,clientDirectoryRequired:false,scratch};
write(path.join(__dirname,'resource-recipe-results.json'),report);console.log(JSON.stringify({passed:true,checks:checks.length,recipeBytes:prepared.size,compressedBytes:prepared.compressedSize,manifestVersion:2}));
