'use strict';
// Synthetic data only: no game archives, vendor executable, or installed game.
const fs=require('fs'),path=require('path'),assert=require('assert'),crypto=require('crypto');
const root=path.join(__dirname,'..');
const engine=fs.existsSync(path.join(root,'engine','custom-skeleton-items.js'))?path.join(root,'engine'):path.join(root,'tool','engine');
const own=require(path.join(engine,'custom-skeleton-items'));
const stacks=require(path.join(engine,'stack-check'));
const defs=own.assertDefinitions(),clone=v=>JSON.parse(JSON.stringify(v));
const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
const digest=v=>crypto.createHash('sha256').update(canonical(v)).digest('hex');
const checks=[],working=path.join(__dirname,'float-fixtures-'+crypto.randomBytes(6).toString('hex'));
function reflectionFixture(){
 const types=[],byName=new Map();
 function type(name){if(!byName.has(name)){byName.set(name,types.length);types.push({qualifiedName:name});}return types[byName.get(name)];}
 function struct(name,size,fields,extra=[]){const t=type(name);Object.assign(t,{primitiveType:'STRUCT',size,structFields:{}});for(const [key,offset,target]of fields){type(target);t.structFields[key]={dataOffset:offset,type:byName.get(target)};}for(const key of extra)t.structFields[key]={dataOffset:0,type:0};return t;}
 struct('keen::ItemInfo',2088,[['itemId',0,'keen::ItemId'],['objectId',4,'keen::Guid'],['name',72,'keen::NameLocaTag'],['description',104,'keen::DescriptionLocaTag'],['equipment',260,'keen::EquipmentSetup'],['sequences',1348,'keen::BlobArray<keen::ItemSequence>'],['iconImage',1388,'keen::UiImageReference'],['itemLevelRange',1652,'keen::ItemLevelRange'],['debugName',2080,'keen::BlobString'],['maxStackSize',20,'keen::uint16']],['category','ammunitionType','generateKnowledge','overrideKnowledgeGeneration','impactValues','acquisitionHint','flags','unrelatedNumber']);
 struct('keen::ItemRegistryResource',72,[['itemRefs',0,'keen::BlobArray<keen::ItemReference>'],['dbgNames',56,'keen::BlobArray<keen::BlobString>']]);
 struct('keen::RecipeRegistryResource',16,[['inputCategories',0,'keen::BlobArray<keen::RecipeInputCategory>'],['recipes',8,'keen::BlobArray<keen::RecipeInfo>']]);
 struct('keen::GameKnowledgeResource',72,[['worldKnowledge',0,'keen::WorldKnowledgeMap'],['playerKnowledge',24,'keen::PlayerKnowledgeMap']]);
 struct('keen::ItemLevelRange',8,[['minLevel',0,'keen::uint32'],['maxLevel',4,'keen::uint32']]);
 struct('keen::impact::FloatImpactConfig',80,[['value',76,'keen::float32']]);
 Object.assign(type('keen::float32'),{primitiveType:'FLOAT32',size:4});
 Object.assign(type('keen::uint16'),{primitiveType:'UINT16',size:2});
 struct('keen::RecipeInfo',168,[['recipeGuid',0,'keen::Guid'],['recipeId',16,'keen::RecipeId'],['workshopId',36,'keen::WorkshopId'],['input',40,'keen::BlobArray<keen::RecipeInputResource>'],['output',48,'keen::BlobArray<keen::RecipeItemStackResource>'],['knowledgeRequirement',80,'keen::KnowledgeQueryData'],['completionRequirementQuery',92,'keen::KnowledgeQueryData'],['recipeName',104,'keen::NameLocaTag'],['debugName',120,'keen::BlobString']]);
 struct('keen::StaticHashMapEntry',8,[['start',0,'keen::uint32'],['count',4,'keen::uint32']]);
 for(const role of ['Player','World'])struct('keen::'+role+'KnowledgeMap',24,[['entries',0,'keen::BlobArray<keen::StaticHashMapEntry>'],['keys',8,'keen::BlobArray<keen::KnowledgeId>'],['values',16,'keen::BlobArray<keen::'+role+'KnowledgeObjectResource>']]);
 for(const[name,hash]of Object.entries({'keen::ItemInfo':0xb5ce8765,'keen::ItemRegistryResource':0x12345671,'keen::RecipeRegistryResource':0x12345672,'keen::GameKnowledgeResource':0x12345673}))type(name).qualifiedHash=hash;
 return {version:'1273043|synthetic-float32-regression',types};
}
function fixture(role='server'){
 const dir=path.join(working,String(checks.length)),input=path.join(dir,'input'),output=path.join(dir,'output'),verify=path.join(dir,'verify'),reflection=reflectionFixture(),schema=own.assertSchema(reflection);
 const sourceGuid=defs.sourceItem.guid;
 function document(folder,guid,values){const doc=Object.fromEntries(schema.fields[folder].map(k=>[k,null]));return Object.assign(doc,values,{$guid:guid,$part:0,$type:'keen::'+folder});}
 function file(folder,doc){return doc.$guid+'_'+schema.hashes[folder]+'_0.json';}
 function write(root,folder,doc){fs.mkdirSync(path.join(root,folder),{recursive:true});fs.writeFileSync(path.join(root,folder,file(folder,doc)),JSON.stringify(doc));}
 const source=document('ItemInfo',sourceGuid,{itemId:{value:defs.sourceItem.itemId},objectId:sourceGuid,debugName:defs.sourceItem.debugName,name:'11111111-2222-4333-8444-555555555555',category:'Ammunition',ammunitionType:'Spell',equipment:{slot:'Spell',placedEntity:'ed3aba0e-fafd-4a93-9e73-337769e4eb2f'},sequences:[{sequence:'11c073c0-9978-44cc-b0bc-f1628cfc55ed',triggeredBy:'Primary',sequenceEntityTag:'e924e8ae-d14f-4eed-a29c-bd257c555309'}],generateKnowledge:[],overrideKnowledgeGeneration:false,maxStackSize:1,flags:['HasPIDE','IsSalvageable'],impactValues:{simple:[{$type:'keen::impact::Sint32ImpactConfig',$value:{value:203,configId:{value:0xffffffff}}},{$type:'keen::impact::FloatImpactConfig',$value:{value:2,configId:{value:1469785687}}},{$type:'keen::impact::FloatImpactConfig',$value:{value:1}}]},unrelatedNumber:0.2});
 const ingredients=defs.ingredients.map((row,i)=>document('ItemInfo',row.guid,{itemId:{value:row.itemId},objectId:row.guid,debugName:row.debugName,name:['ab73dfa6-8291-4d8c-aecd-395c49d5c9f1','ef7323f4-c0f4-46be-85a6-9c1662c85f93'][i],maxStackSize:100,flags:[]}));
 for(const doc of [source,...ingredients])write(input,'ItemInfo',doc);
 write(input,'ItemRegistryResource',document('ItemRegistryResource',defs.registries.items,{itemRefs:[source,...ingredients].map(x=>x.$guid),dbgNames:[source,...ingredients].map(x=>x.debugName)}));
 const recipe={recipeGuid:defs.sourceRecipe.guid,recipeId:{value:defs.sourceRecipe.recipeId},debugName:defs.sourceRecipe.debugName,workshopGuid:null,workshopId:{value:defs.workshop.id},input:[{itemStack:{itemRef:defs.ingredients[1].guid,item:{value:defs.ingredients[1].itemId},count:20},inputItemCategory:{categoryRef:null,category:{value:0},count:0}},{itemStack:{itemRef:defs.ingredients[0].guid,item:{value:defs.ingredients[0].itemId},count:50},inputItemCategory:{categoryRef:null,category:{value:0},count:0}}],output:[],knowledgeRequirement:{knowledgeOrQueryId:{value:2185886291},compareValue:0,compareOperator:'Equals',type:'Extern',isExplicitPlayerKnowledgeQuery:false},requiresSheltered:true,level:0,comfortLevel:0,serverProgressLevel:0,levelRequirement:'None',comfortLevelRequirement:'None',serverProgressLevelRequirement:'None'};
 write(input,'RecipeRegistryResource',document('RecipeRegistryResource',defs.registries.recipes,{inputCategories:[],recipes:[recipe]}));
 const flag=(id,isPlayerKnowledge,expectedFlags,isAdditionalPlayerKnowledgePerFlag=0)=>({id:{id:{value:id}},type:'Flags',expectedFlags,isPlayerKnowledge,isAdditionalPlayerKnowledgePerFlag,unlockedSkillPoints:0,experienceGainId:{value:0}});
 const bool=isPlayerKnowledge=>({id:{id:{value:146824705}},type:'Bool',expectedFlags:0,isPlayerKnowledge});
 const map=values=>({entries:[{start:0,count:values.length}],keys:values.map(v=>clone(v.id)),values});
 write(input,'GameKnowledgeResource',document('GameKnowledgeResource',defs.registries.knowledge,{playerKnowledge:map([flag(defs.sourceItem.itemId,true,65535,1),flag(4011487061,true,3),bool(true)]),worldKnowledge:map([flag(defs.sourceItem.itemId,false,1),bool(false)])}));
 const changed=clone(source);changed.impactValues.simple[1].$value.value=0.4;write(output,'ItemInfo',changed);
 const ctx={enabled:true,role,reflection};
 function apply(){return own.apply(ctx,input,output);}
 function readback(){fs.mkdirSync(verify,{recursive:true});fs.cpSync(input,verify,{recursive:true});fs.cpSync(output,verify,{recursive:true});for(const name of fs.readdirSync(path.join(verify,'ItemInfo'))){const location=path.join(verify,'ItemInfo',name),doc=JSON.parse(fs.readFileSync(location,'utf8'));for(const impact of doc.impactValues?.simple||[])if(impact.$type==='keen::impact::FloatImpactConfig')impact.$value.value=Math.fround(impact.$value.value);fs.writeFileSync(location,JSON.stringify(doc));}}
 function ownFile(index=0){return path.join(verify,'ItemInfo',defs.items[index].guid+'_'+schema.hashes.ItemInfo+'_0.json');}
 function editOwn(mutate,summary,rehash=false){const location=ownFile(),doc=JSON.parse(fs.readFileSync(location,'utf8'));mutate(doc);fs.writeFileSync(location,JSON.stringify(doc));if(rehash)summary.resources.find(r=>r.guid===doc.$guid).sha256=digest(doc);}
 return {input,output,verify,reflection,schema,source,changed,write,apply,readback,ownFile,editOwn};
}
function test(name,run){try{run();checks.push({name,passed:true});}catch(error){checks.push({name,passed:false,error:error.stack});throw error;}}
try{
 fs.mkdirSync(working,{recursive:true});
 for(const role of ['server','client'])test(role+': fractional cast time is normalized before hashing and survives exact item/stack verification',()=>{
  const f=fixture(role),summary=f.apply();
  for(const row of defs.items){const file=path.join(f.output,'ItemInfo',row.guid+'_'+f.schema.hashes.ItemInfo+'_0.json'),doc=JSON.parse(fs.readFileSync(file,'utf8'));assert.strictEqual(doc.impactValues.simple[1].$value.value,Math.fround(0.4));assert.strictEqual(doc.impactValues.simple[0].$value.value,203);assert.strictEqual(doc.impactValues.simple[0].$value.configId.value,0xffffffff);assert.strictEqual(doc.unrelatedNumber,0.2);assert.strictEqual(doc.itemId.value,row.itemId);assert.strictEqual(summary.resources.find(r=>r.guid===row.guid).sha256,digest(doc));}
  assert.strictEqual(f.changed.impactValues.simple[1].$value.value,0.4);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(f.output,'ItemInfo',defs.sourceItem.guid+'_'+f.schema.hashes.ItemInfo+'_0.json'),'utf8')).impactValues.simple[1].$value.value,0.4);
  f.readback();assert.strictEqual(own.verify(summary,f.reflection,f.verify).checked,9);
  for(const ingredient of defs.ingredients){const location=path.join(f.verify,'ItemInfo',ingredient.guid+'_'+f.schema.hashes.ItemInfo+'_0.json'),doc=JSON.parse(fs.readFileSync(location,'utf8'));doc.maxStackSize=65000;fs.writeFileSync(location,JSON.stringify(doc));}
  const checked=stacks.check({config:{inventory:{adjustStackSize:{enabled:true,value:65000}},world:{enableSkeletonSummoningSpells:{enabled:true}}},role,reflection:f.reflection,complete:true,skeletonSpells:{enabled:true,role,prototype:true,gameplayVerified:false,items:summary}},f.input,f.verify);
  assert.strictEqual(checked.validated,true);assert.strictEqual(checked.totalItems,9);
 });
 for(const value of [null,'0.4',true,{},[],1e100,-1e100])test('Rejects invalid/overflow FloatImpactConfig value '+JSON.stringify(value)+' before creating files',()=>{const f=fixture();f.changed.impactValues.simple[1].$value.value=value;f.write(f.output,'ItemInfo',f.changed);assert.throws(()=>f.apply(),/endlichen Float32-Wert/);assert.strictEqual(fs.existsSync(path.join(f.output,'ItemRegistryResource')),false);assert.strictEqual(fs.readdirSync(path.join(f.output,'ItemInfo')).length,1);});
 test('Rejects missing FloatImpactConfig payload',()=>{const f=fixture();delete f.changed.impactValues.simple[1].$value;f.write(f.output,'ItemInfo',f.changed);assert.throws(()=>f.apply(),/endlichen Float32-Wert/);});
 const schemaCases=[['primitive',r=>{r.types.find(t=>t.qualifiedName==='keen::float32').primitiveType='FLOAT64';}],['primitive size',r=>{r.types.find(t=>t.qualifiedName==='keen::float32').size=8;}],['impact size',r=>{r.types.find(t=>t.qualifiedName==='keen::impact::FloatImpactConfig').size=84;}],['value offset',r=>{r.types.find(t=>t.qualifiedName==='keen::impact::FloatImpactConfig').structFields.value.dataOffset=72;}],['value type',r=>{r.types.find(t=>t.qualifiedName==='keen::impact::FloatImpactConfig').structFields.value.type=0;}]];
 for(const[name,mutate]of schemaCases)test('Rejects changed native '+name,()=>{const reflection=reflectionFixture();mutate(reflection);assert.throws(()=>own.assertSchema(reflection),/Skelettzauber:/);});
 for(const[name,mutate,rehash]of [['nearby float tampering',d=>{d.impactValues.simple[1].$value.value+=1e-8;},false],['unrounded value restored',d=>{d.impactValues.simple[1].$value.value=0.4;},false],['integer payload changed',d=>{d.impactValues.simple[0].$value.value=204;},true],['native integer ID changed',d=>{d.itemId.value+=1;},true],['unrelated float changed',d=>{d.unrelatedNumber=Math.fround(d.unrelatedNumber);},true],['GUID changed',d=>{d.objectId=defs.items[1].guid;},true]])test('Exact verifier rejects '+name,()=>{const f=fixture(),summary=f.apply();f.readback();f.editOwn(mutate,summary,rehash);assert.throws(()=>own.verify(summary,f.reflection,f.verify),/Skelettzauber:/);});
}finally{
 if(path.dirname(working)!==__dirname||!/^float-fixtures-[a-f0-9]{12}$/.test(path.basename(working)))throw Error('Unsafe fixture cleanup path');
 if(fs.existsSync(working))fs.rmSync(working,{recursive:true});
 const report={passed:checks.filter(c=>c.passed).length,failed:checks.filter(c=>!c.passed).length,node:process.version,syntheticOnly:true,gameStarted:false,checks};fs.writeFileSync(path.join(__dirname,'float-summon-results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,failed:report.failed,node:report.node}));
}
