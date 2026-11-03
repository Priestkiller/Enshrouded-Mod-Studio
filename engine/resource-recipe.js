'use strict';
// Data-only recipes derived from the independently read-back server resources.
// Never opens a client installation, starts a game or installs an archive.
const fs=require('fs'),path=require('path'),crypto=require('crypto'),zlib=require('zlib');
const FORMAT='enshrouded-resource-recipe',VERSION=1,CAPABILITY='enshrouded-resource-recipe-v1';
const MAX_BYTES=256*1024*1024,MAX_COMPRESSED=64*1024*1024,MAX_RESOURCES=10000;
const GUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const SHA=/^[a-f0-9]{64}$/;
const TYPES=new Set(['keen::ItemInfo','keen::enemy::EnemyArsenalRegistryResource','keen::ecs::TemplateResource','keen::ecs::TemplateCollectionResource','keen::RecipeRegistryResource','keen::ItemRegistryResource','keen::BalancingTable','keen::BaseAttributeResource','keen::AttributeContainerResource','keen::GameKnowledgeResource','keen::MapMarkerRegistryResource','keen::actor::ActorSequenceResource','keen::TerraformingEfficiencyRegistryResource','keen::GameSettingsPresetsResource','keen::SceneResource','keen::VolumetricFog3Resource','keen::LootableItemsResource','keen::LootDistributionTreeResource','keen::ecs::DefaultInventoryResource']);
const DRAK_REGISTRIES=Object.freeze({'keen::NpcCollection':'377f61dc-c7b8-4e4f-830f-7d2c3e8b7fd8','keen::WorkshopRegistryResource':'3baba1c2-bc82-4ab7-b20e-16dec28208af'});
for(const type of Object.keys(DRAK_REGISTRIES))TYPES.add(type);
function fail(message){throw Error('Änderungsrezept: '+message);}
const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
function plain(v){return !!v&&typeof v==='object'&&!Array.isArray(v);}
function exact(v,keys){return plain(v)&&Object.keys(v).sort().join('|')===keys.slice().sort().join('|');}
function identity(doc){if(!plain(doc)||!TYPES.has(doc.$type)||!GUID.test(doc.$guid||'')||!Number.isInteger(doc.$part)||doc.$part<0||doc.$part>0xffffffff)fail('Unbekannte Ressourcenidentität.');return doc.$type+'|'+doc.$guid+'|'+doc.$part;}
function noLinks(file){let current=path.resolve(file);for(;;){if(fs.existsSync(current)&&fs.lstatSync(current).isSymbolicLink())fail('Verknüpfte Rezeptpfade sind nicht erlaubt.');const parent=path.dirname(current);if(parent===current)break;current=parent;}return path.resolve(file);}
function within(root,file){root=noLinks(root);file=noLinks(file);const rel=path.relative(root,file);if(!rel||rel==='..'||rel.startsWith('..'+path.sep)||path.isAbsolute(rel))fail('Dateipfad liegt außerhalb des Auftrags.');return file;}
function read(file){const s=fs.lstatSync(noLinks(file));if(!s.isFile()||s.size>MAX_BYTES)fail('Ungültige Ressourcendatei.');return JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));}
function files(root){noLinks(root);if(!fs.existsSync(root))return [];return fs.readdirSync(root,{withFileTypes:true}).flatMap(e=>{const f=path.join(root,e.name);if(e.isSymbolicLink())fail('Verknüpfte Ressourcendatei.');return e.isDirectory()?files(f):e.isFile()&&e.name.endsWith('.json')?[f]:[];});}
function safeData(value,depth=0){if(depth>96)fail('JSON-Verschachtelung überschreitet die Grenze.');if(typeof value==='number'&&!Number.isFinite(value))fail('Ungültiger Zahlenwert.');if(value&&typeof value==='object')for(const key of Object.keys(value)){if(['__proto__','prototype','constructor'].includes(key))fail('Unzulässiger Datenschlüssel.');safeData(value[key],depth+1);}}
// This is a closed feature catalog, not an extension/plugin loader. Definition
// files and adapters are local release-owned inputs; none come from a recipe.
const FEATURES=Object.freeze([
 Object.freeze({id:'companions',option:'enableSkeletonSummoningSpells',file:'skeleton-spell-definitions.json',sha256:'9f4136e439ba8c5a674300e24e3fc2adbba0b7f0fd5556daea0c6e3a36a36a32'}),
 Object.freeze({id:'night-plants',option:'enableNightPlantCultivation',file:'night-plant-definitions.json',adapter:'night-plants',sha256:'1c7d16af6d66de8c06982e6f4416dde80eb1d392ea3230189b9fddccc88f586f',counts:{'keen::ItemInfo':7,'keen::ecs::TemplateResource':28,'keen::ecs::DefaultInventoryResource':14}}),
 Object.freeze({id:'drak-merchant',option:'enableDrakMerchant',file:'drak-definitions.json',adapter:'drak-merchant',sha256:'87988e877c00d0b9f2fa1a02664d7e23846047188fde7277923b2e68270b8f33',counts:{'keen::ItemInfo':4,'keen::ecs::TemplateResource':4}})
]);
function featureDescriptors(options,definitions){
 const result=[],identities=new Set();
 for(const spec of FEATURES){
  if(options?.world?.[spec.option]?.enabled!==true)continue;
  const definition=spec.id==='companions'&&definitions?definitions:read(path.join(__dirname,spec.file));
  if(definition.formatVersion!==1||definition.sourceBuild!=='1283531'||digest(canonical(definition))!==spec.sha256)fail('Unbekannte feste Featuredefinition: '+spec.id);
  let resources,templates;
  if(spec.id==='companions'){
   if(!Array.isArray(definition.items)||definition.items.length!==6||definition.items.filter(i=>i.sourceTemplateGuid).length!==3)fail('Feste Begleiterdefinitionen fehlen.');
   resources=[...definition.items.map(i=>({type:'keen::ItemInfo',guid:i.guid,part:0})),...definition.items.filter(i=>i.sourceTemplateGuid).map(i=>({type:'keen::ecs::TemplateResource',guid:i.target,part:0}))];
   templates=definition.items.filter(i=>i.sourceTemplateGuid).map(i=>({guid:i.target,name:i.targetName,kind:'companion'}));
  }else{
   const adapter=require('./'+spec.adapter);
   if(!Array.isArray(adapter.CREATED_RESOURCES)||typeof adapter.registrationTargets!=='function'||typeof adapter.validateRecipeRows!=='function')fail('Geprüfter Featureadapter fehlt: '+spec.id);
   resources=adapter.CREATED_RESOURCES.map(r=>({type:r.type,guid:r.guid,part:r.part}));templates=adapter.registrationTargets();
   const counts={};for(const r of resources)counts[r.type]=(counts[r.type]||0)+1;
   if(canonical(counts)!==canonical(spec.counts))fail('Unbekanntes neues Ressourceninventar: '+spec.id);
  }
  const own=new Set();for(const r of resources){const key=identity({$type:r.type,$guid:r.guid,$part:r.part});if(r.part!==0||own.has(key)||identities.has(key))fail('Doppelte oder abweichende Feature-Ressource.');own.add(key);identities.add(key);}
  if(!Array.isArray(templates)||templates.length!==resources.filter(r=>r.type==='keen::ecs::TemplateResource').length)fail('Feature-Vorlagenliste ist unvollständig.');
  const seen=new Set();templates=templates.map(t=>{if(!plain(t)||!GUID.test(t.guid||'')||typeof t.name!=='string'||!/^EMS_[A-Za-z0-9_]+$/.test(t.name)||seen.has(t.guid)||!own.has('keen::ecs::TemplateResource|'+t.guid+'|0'))fail('Unbekannte Feature-Vorlage.');seen.add(t.guid);let kind=spec.id==='companions'?'companion':spec.id;if(spec.id==='drak-merchant'){const item=definition.items.find(i=>i.templateGuid===t.guid&&i.templateName===t.name);if(!item)fail('Unbekannte Drak-Vorlagenart.');kind=item.key==='merchant'?'merchant':'companion';}return {guid:t.guid,name:t.name,kind};});
  result.push({id:spec.id,option:spec.option,definitionSha256:spec.sha256,resources,templates});
 }
 return result;
}
function allowedCreates(definitions,options={world:{enableSkeletonSummoningSpells:{enabled:true}}}){return new Set(featureDescriptors(options,definitions).flatMap(f=>f.resources.map(r=>r.type+'|'+r.guid+'|'+r.part)));}
function validate(recipe,definitions){
 if(!exact(recipe,['format','formatVersion','gameBuild','engineFingerprint','options','resources'])||recipe.format!==FORMAT||recipe.formatVersion!==VERSION||typeof recipe.gameBuild!=='string'||!recipe.gameBuild||recipe.gameBuild.length>512||!SHA.test(recipe.engineFingerprint||'')||!plain(recipe.options)||!Array.isArray(recipe.resources)||recipe.resources.length>MAX_RESOURCES)fail('Unbekanntes Rezeptformat.');
 const features=featureDescriptors(recipe.options,definitions),creates=new Set(features.flatMap(f=>f.resources.map(r=>r.type+'|'+r.guid+'|'+r.part))),seen=new Set();let previous='';
 if(recipe.gameBuild !== require('./build-contract').BUILD)fail('Feature-Rezept gehört nicht zum geprüften Spielbuild.');
 for(const row of recipe.resources){if(!exact(row,['type','guid','part','mode','before','after']))fail('Unbekannte Rezeptfelder.');const key=identity(row.after);if(key!==row.type+'|'+row.guid+'|'+row.part||seen.has(key)||(previous&&previous>=key))fail('Doppelte, unsortierte oder abweichende Ressourcenidentität.');seen.add(key);previous=key;
  if(Object.hasOwn(DRAK_REGISTRIES,row.type)&&(recipe.options.world?.enableDrakMerchant?.enabled!==true||row.guid!==DRAK_REGISTRIES[row.type]||row.part!==0||row.mode!=='modify'))fail('Nicht freigegebene Drak-Katalogänderung.');
  if(row.mode==='modify'){if(identity(row.before)!==key||canonical(row.before)===canonical(row.after))fail('Ungültige oder wirkungslose Änderung.');}
  else if(row.mode==='create'){if(row.before!==null||!creates.has(key))fail('Nicht freigegebene neue Ressource.');}
  else fail('Unbekannte Änderungsart.');
  if(row.type==='keen::ecs::TemplateCollectionResource')require('./template-collection-registration').validateAppendRecipe(row,recipe.options);
 }
 if(features.some(f=>f.id!=='companions')&&recipe.resources.filter(r=>r.type==='keen::ecs::TemplateCollectionResource').length!==1)fail('Globale Registrierung der neuen Feature-Vorlagen fehlt.');
 for(const feature of features){const spec=FEATURES.find(f=>f.id===feature.id);if(spec.adapter)require('./'+spec.adapter).validateRecipeRows(recipe.resources,recipe.options);}
 safeData(recipe);return recipe;
}
function prepare({engineRoot,job,plan,options}){
 if(plan.target?.server!==true||plan.modifiedFiles!==plan.verifiedFiles)fail('Bestätigte Server-Ressourcenprüfung fehlt.');
 const input=within(job,path.join(job,'unpacked')),output=within(job,path.join(job,'modified'));
 const resources=[];
 // The backend already verified the complete original and packed inventory.
 // Read only preimages of changed files here instead of retaining every
 // unmodified server descriptor in the exporter's heap a second time.
 for(const file of files(output)){const after=read(file),key=identity(after),originalFile=within(input,path.join(input,path.relative(output,file))),before=fs.existsSync(originalFile)?read(originalFile):null;if(before&&identity(before)!==key)fail('Ressourcenidentität der Ausgangsdatei stimmt nicht.');if(before&&canonical(before)===canonical(after))continue;resources.push({type:after.$type,guid:after.$guid,part:after.$part,mode:before?'modify':'create',before,after});}
 resources.sort((a,b)=>{const x=identity(a.after),y=identity(b.after);return x<y?-1:x>y?1:0;});
 const recipe=validate({format:FORMAT,formatVersion:VERSION,gameBuild:String(plan.build),engineFingerprint:digest(canonical(read(path.join(engineRoot,'engine-manifest.json')))),options,resources},read(path.join(engineRoot,'skeleton-spell-definitions.json')));
 const bytes=Buffer.from(canonical(recipe));if(bytes.length>MAX_BYTES)fail('Rezept überschreitet 256 MiB.');
 const packed=zlib.gzipSync(bytes,{level:9,mtime:0});if(packed.length>MAX_COMPRESSED)fail('Komprimiertes Rezept überschreitet 64 MiB.');
 const file=within(job,path.join(job,'client-recipe.json.gz'));fs.writeFileSync(file,packed,{flag:'wx'});
 return {file,sha256:digest(bytes),size:bytes.length,compressedSha256:digest(packed),compressedSize:packed.length,resources:resources.length};
}
function load(preparation,job,engineRoot){
 if(!exact(preparation,['file','sha256','size','compressedSha256','compressedSize','resources'])||!SHA.test(preparation.sha256||'')||!SHA.test(preparation.compressedSha256||'')||!Number.isInteger(preparation.size)||preparation.size<1||preparation.size>MAX_BYTES||!Number.isInteger(preparation.compressedSize)||preparation.compressedSize<1||preparation.compressedSize>MAX_COMPRESSED)fail('Rezeptnachweis fehlt.');
 const file=within(job,preparation.file),stat=fs.lstatSync(file);if(!stat.isFile()||stat.size!==preparation.compressedSize)fail('Komprimierte Rezeptgröße wurde verändert.');const packed=fs.readFileSync(file);if(digest(packed)!==preparation.compressedSha256)fail('Komprimiertes Rezept wurde verändert.');
 const bytes=zlib.gunzipSync(packed,{maxOutputLength:MAX_BYTES});if(bytes.length!==preparation.size||digest(bytes)!==preparation.sha256)fail('Rezept wurde verändert.');const recipe=JSON.parse(bytes.toString('utf8'));if(canonical(recipe)!==bytes.toString('utf8'))fail('Rezept ist nicht kanonisch.');validate(recipe,read(path.join(engineRoot,'skeleton-spell-definitions.json')));if(recipe.resources.length!==preparation.resources)fail('Ressourcenanzahl wurde verändert.');return {recipe,file};
}
module.exports={FORMAT,VERSION,CAPABILITY,MAX_BYTES,MAX_COMPRESSED,MAX_RESOURCES,TYPES,canonical,digest,validate,prepare,load,allowedCreates,featureDescriptors};
