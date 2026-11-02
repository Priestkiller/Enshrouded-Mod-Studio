'use strict';
// Development-only fixture capture. Run with Studio's reviewed Node runtime:
// PKG_EXECPATH=PKG_INVOKE_NODEJS engine/enshrouded-patcher.exe <this file> <native-root>
// Public CI consumes the data, never this proprietary runtime or game archives.
const fs=require('fs'),path=require('path'),zlib=require('zlib'),crypto=require('crypto');
const engine=path.resolve(__dirname,'../engine'),native=path.resolve(process.argv[2]||''),input=path.join(native,'server-input'),reflectionFile=path.join(native,'server-bin/reflection_data.json');
if(!process.argv[2]||!fs.existsSync(reflectionFile)||!fs.existsSync(input))throw Error('Explicit inert native root with server-input and server-bin/reflection_data.json required');
const build=require(path.join(engine,'build-contract'));
const read=f=>JSON.parse(fs.readFileSync(f,'utf8')),clone=v=>JSON.parse(JSON.stringify(v));
const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
const sources=['summoned-companions','advanced-companions','custom-skeleton-items','night-plants','drak-merchant','template-collection-registration','item-values-fix'].map(n=>fs.readFileSync(path.join(engine,n+'.js'),'utf8')).join('\n');
const ids=new Set(sources.match(/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}/g));
const plant=require(path.join(engine,'night-plants')).definitions,drak=require(path.join(engine,'drak-merchant')).definitions,own=require(path.join(engine,'custom-skeleton-items')).definitions;
for(const row of [...Object.values(drak.sourceDocuments),...drak.combatEvidence,...drak.placementEvidence,drak.arsenalRegistry,...drak.playerSources,...Object.values(plant.sources)])ids.add(row.guid||row.document.$guid);
for(const row of [...own.ingredients,...Object.values(drak.reagents)])ids.add(row.guid);
const documents=[];
for(const directory of fs.readdirSync(input))for(const file of fs.readdirSync(path.join(input,directory))){
 if(!['ItemInfo','TemplateResource','ActorSequenceResource','EnemyArsenalRegistryResource','DefaultInventoryResource'].includes(directory))continue;
 if(!ids.has(file.slice(0,36)))continue;
 if(['ItemRegistryResource','RecipeRegistryResource','GameKnowledgeResource','NpcCollection','WorkshopRegistryResource','Game38ServerResources','TemplateCollectionResource'].includes(directory))continue;
 const doc=read(path.join(input,directory,file));documents.push({directory,file,document:doc});
}
// Keep only the two attribute definitions the public companion producer reads.
for(const file of fs.readdirSync(path.join(input,'AttributeContainerResource'))){const d=read(path.join(input,'AttributeContainerResource',file));const attributes=d.attributes.filter(a=>['DamageMod','MaxSkeletonSpellCount'].includes(a.debugNames?.[0]));if(attributes.length)documents.push({directory:'AttributeContainerResource',file,document:{...d,attributes}});}
const source=documents.find(r=>r.document.$guid===own.sourceItem.guid);
if(!source)throw Error('Original eternal spell source missing');
const originalRecipes=read(path.join(input,'RecipeRegistryResource',own.registries.recipes+'_5f5382cf_0.json'));
const alden=originalRecipes.recipes.find(r=>r.recipeGuid===own.sourceRecipe.guid);
if(!alden)throw Error('Original Alden recipe missing');
const catalog=documents.filter(r=>r.directory==='ItemInfo').map(r=>r.document);
const put=(directory,hash,document)=>documents.push({directory,file:document.$guid+'_'+hash+'_0.json',document});
put('ItemRegistryResource','72ab39b6',{$type:'keen::ItemRegistryResource',$guid:own.registries.items,$part:0,itemRefs:catalog.map(d=>d.$guid),dbgNames:catalog.map(d=>d.debugName)});
put('RecipeRegistryResource','5f5382cf',{$type:'keen::RecipeRegistryResource',$guid:own.registries.recipes,$part:0,inputCategories:[],recipes:[alden,clone(plant.sourceRecipe)]});
const flag=(base,id)=>{const d=clone(base);d.id.id.value=id;return d;};
const p=[clone(plant.knowledgeTemplates.playerItem),clone(plant.knowledgeTemplates.playerRecipe),flag(plant.knowledgeTemplates.playerItem,own.sourceItem.itemId),flag(plant.knowledgeTemplates.playerRecipe,4011487061)];
const rootReward=flag(plant.knowledgeTemplates.playerItem,123456789);rootReward.unlockedSkillPoints=3;p.push(rootReward);
const w=[clone(plant.knowledgeTemplates.worldItem),flag(plant.knowledgeTemplates.worldItem,own.sourceItem.itemId),...plant.plants.map(d=>flag(plant.knowledgeTemplates.worldItem,plant.sources[d.key+'Item'].document.itemId.value))];
for(const [rows,isPlayerKnowledge]of [[p,true],[w,false]])rows.push({id:{id:{value:146824705}},type:'Bool',expectedFlags:0,isPlayerKnowledge});
const map=rows=>({entries:[{start:0,count:rows.length}],keys:rows.map(d=>clone(d.id)),values:rows});
put('GameKnowledgeResource','bc47511c',{$type:'keen::GameKnowledgeResource',$guid:own.registries.knowledge,$part:0,playerKnowledge:map(p),worldKnowledge:map(w),achievements:[],skillPoints:[{knowledgeId:{id:{value:123456789}},amount:3}],flagKnowledgePatch:[]});
for(const key of ['npcs','workshops']){const row=drak.registries[key];put(row.directory,row.file.split('_')[1],read(path.join(input,row.directory,row.file)));}
const collection=read(path.join(input,'TemplateCollectionResource','377f61dc-c7b8-4e4f-830f-7d2c3e8b7fd8_d80fe371_0.json'));
put('TemplateCollectionResource','d80fe371',collection);
for(const file of fs.readdirSync(path.join(input,'BalancingTable')))documents.push({directory:'BalancingTable',file,document:read(path.join(input,'BalancingTable',file))});
// Retain real reflection layouts used by public assertions, with referenced
// types as stubs where their fields are never inspected. No generated outputs.
const full=read(reflectionFile);build.assertReflection(full);
for(const row of documents)if(['ItemRegistryResource','RecipeRegistryResource','GameKnowledgeResource'].includes(row.directory)){
 const layout=full.types.find(t=>t.qualifiedName===row.document.$type);for(const key of Object.keys(layout.structFields))if(!(key in row.document))row.document[key]=null;
}
const names=new Set([...sources.matchAll(/['"](keen::[^'"\n]+)['"]/g)].map(m=>m[1]));
for(const m of sources.matchAll(/P\s*\+\s*['"]([^'"]+)['"]/g))names.add('keen::ecs::'+m[1]);
for(const schema of [plant.schema])for(const [n,d]of Object.entries(schema)){names.add(n);for(const f of Object.values(d.fields))names.add(f.type);}
const selected=new Set(full.types.map((t,i)=>names.has(t.qualifiedName)?i:-1).filter(i=>i>=0));
const needed=new Set(selected);for(const i of selected){const t=full.types[i];if(Number.isInteger(t.innerType))needed.add(t.innerType);for(const f of Object.values(t.structFields||{}))needed.add(f.type);}
const indexes=[...needed].sort((a,b)=>a-b),remap=new Map(indexes.map((old,i)=>[old,i]));
const types=indexes.map(i=>{const t=clone(full.types[i]);if(!selected.has(i)){delete t.structFields;delete t.enumFields;delete t.attributes;delete t.innerType;}else{if(Number.isInteger(t.innerType))t.innerType=remap.get(t.innerType);for(const f of Object.values(t.structFields||{}))f.type=remap.get(f.type);}return t;});
const scratch=fs.mkdtempSync(path.join(__dirname,'.capture-matrix-')),vendor=require(path.join(engine,'vendor-loader')).load('mod/processor'),defaults=read(path.join(engine,'../assets/defaults.json'));
for(const c of ['world','gameplay','player','inventory'])for(const v of Object.values(defaults[c]))if(v&&typeof v==='object')v.enabled=false;
const variants=[],knowledgeVariants=[];
try{
 const sourceDir=path.join(scratch,'input',source.directory),dest=path.join(scratch,'output',source.directory,source.file);fs.mkdirSync(sourceDir,{recursive:true});fs.writeFileSync(path.join(sourceDir,source.file),JSON.stringify(source.document));
 for(const [name,mana,cast]of [['plain',null,null],['mana',0.2,null],['cast',null,0.2],['round-down',null,0.6675],['round-up',null,0.5625],['minimum',null,0.1025],['combined',0.2,0.6675]]){
  const config=clone(defaults);if(mana!==null)config.gameplay.adjustManaCost={enabled:true,factor:mana};if(cast!==null)config.gameplay.adjustSpellCastTime={enabled:true,factor:cast};
  if(fs.existsSync(dest))fs.unlinkSync(dest);vendor.ModProcessor.fromConfig(config).processItemInfo(path.join(scratch,'input'),path.join(scratch,'output'));
  variants.push({name,mana,cast,document:fs.existsSync(dest)?read(dest):clone(source.document)});
 }
 const knowledge=documents.find(r=>r.directory==='GameKnowledgeResource');const kd=path.join(scratch,'input',knowledge.directory);fs.mkdirSync(kd,{recursive:true});fs.writeFileSync(path.join(kd,knowledge.file),JSON.stringify(knowledge.document));
 for(const factor of [2,85]){const config=clone(defaults);config.player.adjustSkillPointsPerRoot={enabled:true,factor};vendor.ModProcessor.fromConfig(config).processGameKnowledgeResource(path.join(scratch,'input'),path.join(scratch,'output'));knowledgeVariants.push({factor,document:read(path.join(scratch,'output',knowledge.directory,knowledge.file))});}
 const fixture={format:1,sourceBuild:build.REVISION,documents,reflection:{version:full.version,types},variants,knowledgeVariants};
 const bytes=Buffer.from(JSON.stringify(fixture)),packed=zlib.gzipSync(bytes,{level:9});
 const output=path.join(__dirname,'fixtures/producer-matrix-inputs.json.gz');fs.writeFileSync(output,packed);
 fs.writeFileSync(path.join(__dirname,'fixtures/producer-matrix-provenance.json'),JSON.stringify({format:1,sourceBuild:build.REVISION,nativeBuild:full.version,sourceRole:'server',fixtureSha256:hash(packed),uncompressedSha256:hash(bytes),bytes:packed.length,documents:documents.length,reflectionTypes:types.length,vendorSourceVariants:variants.map(({document,...v})=>({...v,sourceSha256:hash(JSON.stringify(document))})),producerFiles:Object.fromEntries(['custom-skeleton-items.js','advanced-companions.js','night-plants.js','drak-merchant.js','vendor/mod/processor.js.bytecode'].map(n=>[n,hash(fs.readFileSync(path.join(engine,n)))])),capture:'Reviewed Studio Node 18 runtime processItemInfo over build1283531 inert native server sources; actual full build identity and minimal synthetic shared registries; no consumer expected-output code used',gameStarted:false},null,2)+'\n');
 console.log(JSON.stringify({bytes:packed.length,documents:documents.length,reflectionTypes:types.length,variants:variants.length}));
}finally{if(path.dirname(scratch)!==__dirname||!path.basename(scratch).startsWith('.capture-matrix-'))throw Error('Unexpected cleanup path');fs.rmSync(scratch,{recursive:true,force:true});}
