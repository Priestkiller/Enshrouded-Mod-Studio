'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert'),crypto=require('crypto');
const root=path.dirname(__dirname),engine=fs.existsSync(path.join(root,'tool','engine'))?path.join(root,'tool','engine'):path.join(root,'engine');
const stacks=require(path.join(engine,'stack-check')),own=require(path.join(engine,'custom-skeleton-items'));
const defs=own.assertDefinitions(),TYPE='keen::ItemInfo',hash='b5ce8765';
const reflection={version:'1273043|stack-summon-fixture',types:[{qualifiedName:TYPE,qualifiedHash:0xb5ce8765,size:2,structFields:{maxStackSize:{type:1,dataOffset:0}}},{primitiveType:'UINT16',size:2}]};
const working=path.join(__dirname,'stack-fixtures-'+crypto.randomBytes(6).toString('hex'));
const input=path.join(working,'input'),output=path.join(working,'output'),checks=[];
const clone=v=>JSON.parse(JSON.stringify(v));
function canonical(v){return Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);}
const digest=v=>crypto.createHash('sha256').update(canonical(v)).digest('hex');
const filename=d=>d.$guid+'_'+hash+'_'+d.$part+'.json';
const stackable={$type:TYPE,$guid:'11111111-2222-4333-8444-555555555555',$part:0,objectId:'11111111-2222-4333-8444-555555555555',debugName:'Material_T1_Wood_Logs',itemId:{value:100},maxStackSize:100,flags:[]};
const singleton={$type:TYPE,$guid:'22222222-3333-4444-8555-666666666666',$part:0,objectId:'22222222-3333-4444-8555-666666666666',debugName:'Equipment_Fixture',itemId:{value:101},maxStackSize:1,flags:['HasPIDE']};
const source={$type:TYPE,$guid:defs.sourceItem.guid,$part:0,objectId:defs.sourceItem.guid,debugName:defs.sourceItem.debugName,itemId:{value:defs.sourceItem.itemId},maxStackSize:1,flags:['HasPIDE','IsSalvageable'],equipment:{placedEntity:'ed3aba0e-fafd-4a93-9e73-337769e4eb2f'},sequences:[{sequence:'11c073c0-9978-44cc-b0bc-f1628cfc55ed'}]};
function write(directory,doc){fs.mkdirSync(path.join(directory,'ItemInfo'),{recursive:true});fs.writeFileSync(path.join(directory,'ItemInfo',filename(doc)),JSON.stringify(doc));}
function setup(role='server',complete=false){
  for(const dir of [input,output])if(fs.existsSync(dir))fs.rmSync(dir,{recursive:true});
  for(const doc of [stackable,singleton,source])write(input,doc);
  write(output,{...clone(stackable),maxStackSize:65000});
  if(complete){write(output,singleton);write(output,source);}
  const created=defs.items.map(def=>({...clone(source),$guid:def.guid,objectId:def.guid,itemId:{value:def.itemId},debugName:def.debugName,name:def.nameGuid,description:def.descriptionGuid,equipment:{placedEntity:def.target},iconImage:def.iconImage,itemLevelRange:{minLevel:1,maxLevel:1}}));
  for(const doc of created)write(output,doc);
  const resources=[...created.map(doc=>({directory:'ItemInfo',type:TYPE,file:filename(doc),guid:doc.$guid,part:0,created:true,sha256:digest(doc)})),...Object.entries(defs.registries).map(([name,guid])=>({directory:name,type:'registry',guid,part:0,created:false,sha256:'1'.repeat(64)}))];
  const proof={enabled:true,role,prototype:true,gameplayVerified:false,items:{enabled:true,role,prototype:true,gameplayVerified:false,build:reflection.version,itemCount:6,resources,createdResources:clone(own.CREATED_RESOURCES)}};
  return {config:{inventory:{adjustStackSize:{enabled:true,value:65000}},world:{enableSkeletonSummoningSpells:{enabled:true}}},role,reflection,complete,skeletonSpells:proof,created};
}
function editOwn(options,index,mutate,updateProof=false){const file=path.join(output,'ItemInfo',filename(options.created[index])),doc=JSON.parse(fs.readFileSync(file,'utf8'));mutate(doc);fs.writeFileSync(file,JSON.stringify(doc));if(updateProof)options.skeletonSpells.items.resources[index].sha256=digest(doc);}
function test(name,run){try{run();checks.push({name,passed:true});}catch(error){checks.push({name,passed:false,error:error.stack});throw error;}}
try{
  fs.mkdirSync(working);
  test('Known regression rejects own ItemInfo when no creation proof is supplied',()=>{const o=setup();delete o.skeletonSpells;assert.throws(()=>stacks.check(o,input,output),/unbekannte ItemInfo/);});
  for(const role of ['server','client'])for(const complete of [false,true])test(role+' '+(complete?'archive readback':'modified output')+' accepts exactly six proven singleton spells and checks 65000 stacks',()=>{const o=setup(role,complete),r=stacks.check(o,input,output);assert.equal(r.validated,true);assert.equal(r.stackableItems,1);assert.equal(r.singletonItems,8);assert.equal(r.totalItems,9);assert.equal(r.checkedItems,9);assert.equal(r.samples[0].after,65000);for(const doc of o.created)assert.equal(JSON.parse(fs.readFileSync(path.join(output,'ItemInfo',filename(doc)))).maxStackSize,1);});
  test('Stacks-only and disabled stack options preserve original behavior',()=>{const o=setup('server',true);for(const d of o.created)fs.unlinkSync(path.join(output,'ItemInfo',filename(d)));delete o.skeletonSpells;const r=stacks.check(o,input,output);assert.equal(r.totalItems,3);assert.equal(r.singletonItems,2);o.config.inventory.adjustStackSize.enabled=false;assert.equal(stacks.check(o,input,output).enabled,false);});
  const bad=[
    ['feature disabled',o=>{o.config.world.enableSkeletonSummoningSpells.enabled=false;}],
    ['root role mismatch',o=>{o.skeletonSpells.role='client';}],
    ['item role mismatch',o=>{o.skeletonSpells.items.role='client';}],
    ['unknown role',o=>{o.role='unknown';}],
    ['wrong build',o=>{o.skeletonSpells.items.build='other';}],
    ['wrong prototype',o=>{o.skeletonSpells.prototype=false;}],
    ['forged gameplay proof',o=>{o.skeletonSpells.items.gameplayVerified=true;}],
    ['wrong item count',o=>{o.skeletonSpells.items.itemCount=5;}],
    ['missing creation identity',o=>{o.skeletonSpells.items.createdResources.pop();}],
    ['extra creation identity',o=>{o.skeletonSpells.items.createdResources.push(clone(o.skeletonSpells.items.createdResources[0]));}],
    ['wrong creation identity',o=>{o.skeletonSpells.items.createdResources[0].guid=stackable.$guid;}],
    ['duplicate creation claim',o=>{o.skeletonSpells.items.resources[1]=clone(o.skeletonSpells.items.resources[0]);}],
    ['missing ItemInfo',o=>{fs.unlinkSync(path.join(output,'ItemInfo',filename(o.created[0])));}],
    ['changed ItemInfo payload',o=>{editOwn(o,0,d=>{d.equipment.placedEntity=stackable.$guid;});}],
    ['stackable custom spell despite matching hash',o=>{editOwn(o,0,d=>{d.maxStackSize=65000;},true);}],
    ['changed persistent flags despite matching hash',o=>{editOwn(o,0,d=>{d.flags=[];},true);}],
    ['wrong item ID despite matching hash',o=>{editOwn(o,0,d=>{d.itemId.value=987;},true);}],
    ['wrong debug name despite matching hash',o=>{editOwn(o,0,d=>{d.debugName='Other';},true);}],
    ['wrong object ID despite matching hash',o=>{editOwn(o,0,d=>{d.objectId=stackable.$guid;},true);}],
    ['wrong proof resource type',o=>{o.skeletonSpells.items.resources[0].type='keen::Other';}],
    ['wrong proof filename',o=>{o.skeletonSpells.items.resources[0].file='../arbitrary.json';}],
    ['wrong proof hash',o=>{o.skeletonSpells.items.resources[0].sha256='a'.repeat(64);}],
    ['unknown seventh item',o=>{write(output,{...clone(singleton),$guid:'33333333-4444-4555-8666-777777777777'});}],
    ['creation GUID collision with original',o=>{write(input,o.created[0]);}],
    ['creation item ID collision with original',o=>{write(input,{...clone(singleton),itemId:{value:defs.items[0].itemId}});}],
    ['wrong original stack size',o=>{write(output,{...clone(stackable),maxStackSize:64000});}],
    ['changed original singleton',o=>{write(output,{...clone(singleton),maxStackSize:2});}],
    ['missing original resource in complete export',o=>{fs.unlinkSync(path.join(output,'ItemInfo',filename(singleton)));}]
  ];
  for(const[name,mutate]of bad)test('Rejects '+name,()=>{const o=setup('server',true);mutate(o);assert.throws(()=>stacks.check(o,input,output),/Stapelprüfung:/);});
  const backend=fs.readFileSync(path.join(engine,'studio-backend.js'),'utf8');
  test('Backend passes the creation proof to both modified and complete readback checks',()=>{assert(backend.includes('reflection,skeletonSpells,logger:ctx.logger'));assert(backend.includes('complete:true,skeletonSpells:mods.skeletonSpells'));});
}finally{
  if(path.dirname(working)!==__dirname||!/^stack-fixtures-[a-f0-9]{12}$/.test(path.basename(working)))throw Error('Unsafe cleanup target');
  if(fs.existsSync(working))fs.rmSync(working,{recursive:true});
  const report={passed:checks.filter(c=>c.passed).length,failed:checks.filter(c=>!c.passed).length,node:process.version,checks,gameStarted:false};
  fs.writeFileSync(path.join(__dirname,'stack-summon-results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,failed:report.failed,node:report.node}));
}
