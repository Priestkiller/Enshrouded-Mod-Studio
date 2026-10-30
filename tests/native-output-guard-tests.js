'use strict';
// Owned reflection fixtures preserve the reviewed native primitive/variant shapes.
const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path'),guard=require('../engine/native-output-guard');
const reflection={types:[
 {qualifiedName:'keen::sint32',primitiveType:'SINT32',size:4},
 {qualifiedName:'keen::sint64',primitiveType:'SINT64',size:8},
 {qualifiedName:'keen::uint16',primitiveType:'UINT16',size:2},
 {qualifiedName:'keen::float32',primitiveType:'FLOAT32',size:4},
 {qualifiedName:'keen::ItemUiValue',primitiveType:'STRUCT',structFields:{value:{type:0}}},
 {qualifiedName:'keen::BlobArray<keen::ItemUiValue>',primitiveType:'BLOB_ARRAY',innerType:4},
 {qualifiedName:'keen::impact::Sint32ImpactConfig',primitiveType:'STRUCT',structFields:{value:{type:0}}},
 {qualifiedName:'keen::impact::ConfigBase',primitiveType:'STRUCT',structFields:{}},
 {qualifiedName:'keen::BlobArray<keen::impact::ConfigBase>',primitiveType:'BLOB_ARRAY',innerType:7},
 {qualifiedName:'keen::impact::Values',primitiveType:'STRUCT',structFields:{simple:{type:8}}},
 {qualifiedName:'keen::ItemInfo',primitiveType:'STRUCT',structFields:{impactValues:{type:9},uiValues:{type:5},maxStackSize:{type:2}}},
 {qualifiedName:'keen::Time',primitiveType:'STRUCT',structFields:{value:{type:1}}},
 {qualifiedName:'keen::BalancingTable',primitiveType:'STRUCT',structFields:{timePerInstrumentUntilMaxBuff:{type:11}}},
 {qualifiedName:'keen::impact::FloatImpactConfig',primitiveType:'STRUCT',structFields:{value:{type:3}}},
 {qualifiedName:'keen::uint8',primitiveType:'UINT8',size:1},
 {qualifiedName:'keen::ecs::ResourceNodeDropInfo',primitiveType:'STRUCT',structFields:{stackAmount:{type:14}}},
 {qualifiedName:'keen::BlobArray<keen::ecs::ResourceNodeDropInfo>',primitiveType:'BLOB_ARRAY',innerType:15},
 {qualifiedName:'keen::ecs::ResourceNodePickupDrops',primitiveType:'STRUCT',structFields:{drops:{type:16}}},
 {qualifiedName:'keen::ecs::TemplateResource',primitiveType:'STRUCT',structFields:{components:{type:8}}}
]};
const checks=[];function test(name,fn){fn();checks.push(name);}const type=name=>reflection.types.find(t=>t.qualifiedName===name);
test('reviewed mana field shape is SINT32',()=>assert.strictEqual(reflection.types[type('keen::impact::Sint32ImpactConfig').structFields.value.type].primitiveType,'SINT32'));
test('reviewed music-time field shape is SINT64',()=>assert.strictEqual(reflection.types[type('keen::Time').structFields.value.type].primitiveType,'SINT64'));
const before={$type:'keen::ItemInfo',$guid:'11111111-2222-4333-8444-555555555555',$part:0,impactValues:{simple:[{$type:'keen::impact::Sint32ImpactConfig',$value:{value:81}}],scaled:[]}};
for(const[name,wanted]of[['factor0.4',32],['factor1.7',138],['largestSINT32',2147483647]])test(name+' accepted through typed impact variant',()=>{const after=JSON.parse(JSON.stringify(before));after.impactValues.simple[0].$value.value=wanted;assert.strictEqual(guard.inspect({reflection,before,after,file:'owned-item.json'}).checked,1);});
for(const wanted of[81000000000,2147483648,-2147483649,1.25,Infinity])test('unsafe mana '+wanted+' rejected',()=>{const after=JSON.parse(JSON.stringify(before));after.impactValues.simple[0].$value.value=wanted;assert.throws(()=>guard.inspect({reflection,before,after,file:'owned-item.json'}),/Nativer Einstellungswert/);});
const original={$type:'keen::BalancingTable',$guid:'22222222-3333-4444-8555-666666666666',$part:0,timePerInstrumentUntilMaxBuff:{value:10000000000}};
test('music factor1.5 retains exact nanoseconds',()=>assert.strictEqual(guard.inspect({reflection,before:original,after:{...original,timePerInstrumentUntilMaxBuff:{value:15000000000}},file:'owned-balance.json'}).checked,1));
for(const value of[10000000000000000000,9007199254740992,15000000000.5])test('unsafe music nanoseconds '+value+' rejected',()=>assert.throws(()=>guard.inspect({reflection,before:original,after:{...original,timePerInstrumentUntilMaxBuff:{value}},file:'owned-balance.json'})));
test('unchanged large original fields are not rewritten or newly rejected',()=>assert.strictEqual(guard.inspect({reflection,before:{...original,timePerInstrumentUntilMaxBuff:{value:1e18}},after:{...original,timePerInstrumentUntilMaxBuff:{value:1e18}},file:'owned-balance.json'}).checked,0));
test('UINT16 stack boundary65535 accepted',()=>guard.assertValue(65535,{primitiveType:'UINT16'},'fixture','/maxStackSize'));
test('UINT16 stack65536 rejected',()=>assert.throws(()=>guard.assertValue(65536,{primitiveType:'UINT16'},'fixture','/maxStackSize')));
test('float32 infinity rejected',()=>assert.throws(()=>guard.assertValue(1e40,{primitiveType:'FLOAT32'},'fixture','/distance')));
function fixture(config,before,after,fn){const root=fs.mkdtempSync(path.join(os.tmpdir(),'ems-native-guard-')),input=path.join(root,'input'),output=path.join(root,'output'),name='owned.json';fs.mkdirSync(input);fs.mkdirSync(output);fs.writeFileSync(path.join(input,name),JSON.stringify(before));fs.writeFileSync(path.join(output,name),JSON.stringify(after));const bytes=fs.readFileSync(path.join(output,name),'utf8');try{fn(()=>guard.apply({config,reflection},input,output));assert.strictEqual(fs.readFileSync(path.join(output,name),'utf8'),bytes,'guard changed prepared bytes');}finally{fs.rmSync(root,{recursive:true,force:true});}}
function duration(loca,value=750,seconds=.75){return {$type:'keen::ItemInfo',uiValues:[{locaId:{value:loca},value}],impactValues:{simple:[{$type:'keen::impact::FloatImpactConfig',$value:{id:'0750bfea-b306-4452-9cec-05bca19e1e33',value:seconds}}]}};}
for(const[key,loca]of[['adjustSpellCastTime',1551270780],['adjustBowChargeTime',2372276042]]){
 test(key+' rejects overflowed duration UI in exact selected path',()=>fixture({gameplay:{[key]:{enabled:true}}},duration(loca),duration(loca,750000000000,750000000),apply=>assert.throws(apply,new RegExp(key+'\\.factor'))));
 test(key+' accepts normal0.2 without changing prepared bytes',()=>fixture({gameplay:{[key]:{enabled:true}}},duration(loca),duration(loca,150,.15),apply=>assert.strictEqual(apply().changedNumericFields,2)));
}
const drop=count=>({$type:'keen::ecs::TemplateResource',components:[{$type:'keen::ecs::ResourceNodePickupDrops',$value:{drops:[{stackAmount:count}]}}]});
test('gathering rejects vendor65535 into native UINT8 drop amount',()=>fixture({gameplay:{enableGatherLootMultipliers:{enabled:true}}},drop(1),drop(65535),apply=>assert.throws(apply,/enableGatherLootMultipliers.*stackAmount/)));
test('gathering accepts normal3 and retains exact output bytes',()=>fixture({gameplay:{enableGatherLootMultipliers:{enabled:true}}},drop(1),drop(3),apply=>assert.strictEqual(apply().changedNumericFields,1)));
test('gathering UINT8 boundary255 accepted unchanged',()=>fixture({gameplay:{enableGatherLootMultipliers:{enabled:true}}},drop(1),drop(255),apply=>assert.strictEqual(apply().changedNumericFields,1)));
test('disabled gathering leaves unrelated existing large drop field alone',()=>fixture({gameplay:{enableGatherLootMultipliers:{enabled:false}}},drop(65535),drop(65535),apply=>assert.strictEqual(apply().enabled,false)));
test('unselected duration label remains outside the scoped guard',()=>fixture({gameplay:{adjustSpellCastTime:{enabled:true}}},duration(42),duration(42,750000000000,750000000),apply=>assert.strictEqual(apply().changedNumericFields,0)));
console.log(JSON.stringify({passed:true,checks:checks.length,details:checks,ownedFixtures:true,gameStarted:false,liveWrites:false}));
