'use strict';
// Physical, single-item random drops only. Never opens a corpse/container inventory.
const fsDefault=require('fs'),path=require('path');
const P='keen::ecs::',TEMPLATE=P+'TemplateResource',PICKUP=P+'PickupItem',SLOT=P+'PickupLootSlot',ZONE=P+'PickupItemZone',RANGE=P+'IsPlayerInRange',TRIGGER=P+'TriggerShape';
const TARGET=Object.freeze({guid:'c15a5c9d-4956-49ff-9d72-9f522229cf1c',name:'Base_LootPickup_RandomLoot_Generic',family:'Prop'});
const ORB=Object.freeze({guid:'a6e24539-f509-4cc3-afa3-1aaa7ebce522',name:'Base_LootTouch_Orb',family:'None'});
const SPAWNERS=Object.freeze([{guid:'75dd7078-8c8b-422f-a76f-1357e573a9fd',name:'Base_LootPickup_RandomLoot_Spawner',family:'Prop'},{guid:'02db30b3-3a8f-4e2b-9881-f1a4e52c19e9',name:'LootPickup_RandomLoot_Spawner_empty',family:'Prop'}]);
const ADDED=Object.freeze([ZONE,RANGE,TRIGGER]);
const OFFSET={localOffset:{x:0,y:0,z:0},worldOffset:{x:0,y:0,z:0},orientationOffset:{x:0,y:0,z:0,w:1}};
const NATIVE=Object.freeze({[ZONE]:{lastAttempt:{value:0}},[RANGE]:{checkAgainstPlayerCollider:false,onlyPlayer:true,ignoreStates:[],updateDelay:{value:100000000},deactivateRange:0,minRange:0},[TRIGGER]:{shape:'Range',rangeX:1,rangeY:0,rangeZ:0,offset:OFFSET}});
const PLACEHOLDER={itemId:{value:0},item:null,level:0,rarity:'Common',pickupAmount:1};
const clone=v=>JSON.parse(JSON.stringify(v));
function fail(message){throw Error('Generische Bodenbeute: '+message);}
function equal(a,b){if(a===b)return true;if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;const keys=Object.keys(a);return keys.length===Object.keys(b).length&&keys.every(k=>Object.prototype.hasOwnProperty.call(b,k)&&equal(a[k],b[k]));}
function parameters(selected){const radius=selected.pickupRadiusMeters,ms=selected.pickupUpdateDelayMs;if(typeof radius!=='number'||!Number.isFinite(radius)||radius<.001||radius>1e9||!Number.isFinite(Math.fround(radius)))fail('Reichweitenwert muss zwischen 0,001 und 1000000000 liegen und in float32 passen.');if(!Number.isSafeInteger(ms)||ms<0||ms>1e9||!Number.isSafeInteger(ms*1e6))fail('Wartezeit muss eine sicher darstellbare ganze Millisekundenzahl sein.');return {radius:Math.fround(radius),delayNs:ms*1e6};}
function schema(reflection){
 if(typeof reflection?.version!=='string'||!reflection.version.startsWith('1273043|')||!Array.isArray(reflection.types))fail('Reflection für den bestätigten Build1273043 fehlt.');const types=reflection.types;
 function type(name){const found=types.filter(t=>t.qualifiedName===name);if(found.length!==1)fail('Reflection-Typ fehlt oder ist mehrdeutig: '+name);return found[0];}
 function struct(name,size,alignment,fields){const t=type(name);if(t.primitiveType!=='STRUCT'||t.size!==size||t.alignment!==alignment||t.fieldCount!==fields.length||Object.keys(t.structFields||{}).length!==fields.length)fail('Unbekannte Komponentenstruktur: '+name);for(const [key,offset,expected,primitive]of fields){const f=t.structFields[key],v=f&&types[f.type];if(!f||f.dataOffset!==offset||v?.qualifiedName!==expected||(primitive&&v.primitiveType!==primitive))fail('Unbekanntes Komponentenfeld: '+name+'.'+key);}return t;}
 const template=type(TEMPLATE);if(template.name!=='TemplateResource'||template.qualifiedHash!==0x39768775)fail('Unbekannte Ressourcenkennung.');
 struct('keen::Time',8,8,[['value',0,'keen::sint64','SINT64']]);
 struct(ZONE,8,8,[['lastAttempt',0,'keen::Time','STRUCT']]);
 struct(RANGE,32,8,[['checkAgainstPlayerCollider',0,'keen::bool','BOOL'],['onlyPlayer',1,'keen::bool','BOOL'],['ignoreStates',8,'keen::actor::StateMask','TYPEDEF'],['updateDelay',16,'keen::Time','STRUCT'],['deactivateRange',24,'keen::float32','FLOAT32'],['minRange',28,'keen::float32','FLOAT32']]);
 struct(TRIGGER,56,4,[['shape',0,P+'TriggerShapeType','ENUM'],['rangeX',4,'keen::float32','FLOAT32'],['rangeY',8,'keen::float32','FLOAT32'],['rangeZ',12,'keen::float32','FLOAT32'],['offset',16,P+'Offset','STRUCT']]);
 const shape=type(P+'TriggerShapeType');if(shape.size!==1||shape.enumFields?.Range?.value!==0||shape.enumFields?.Box?.value!==1||Object.keys(shape.enumFields||{}).length!==2)fail('Unbekannte Range-/Box-Formkennungen.');
 struct(PICKUP,28,4,[['itemId',0,'keen::ItemId','TYPEDEF'],['item',4,'keen::ItemReference','TYPEDEF'],['level',20,'keen::uint32','UINT32'],['rarity',24,'keen::ItemRarity','ENUM'],['pickupAmount',26,'keen::uint16','UINT16']]);
 struct(SLOT,32,4,[['genericPickupItem',0,P+'TemplateReference','TYPEDEF'],['spawnedPickupEntity',16,P+'EntityId','STRUCT'],['shouldSpawnItem',20,'keen::bool','BOOL'],['spawnItem',24,'keen::ItemId','TYPEDEF'],['spawnItemLevel',28,'keen::uint8','UINT8'],['spawnItemRarity',29,'keen::ItemRarity','ENUM'],['spawnItemAmount',30,'keen::uint16','UINT16']]);return template;
}
function relative(target){return path.join('TemplateResource',target.guid+'_39768775_0.json');}
function read(fs,file){try{return JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));}catch(e){fail('Original-/Ausgabedatei fehlt oder ist ungültig: '+path.basename(file)+'. '+e.message);}}
function identity(doc,target){if(doc.$type!==TEMPLATE||doc.$guid!==target.guid||doc.$part!==0||doc.name!==target.name||doc.family!==target.family||!Array.isArray(doc.components))fail('Bestätigte Vorlagenidentität stimmt nicht: '+target.name);const types=doc.components.map(c=>c.$type);if(new Set(types).size!==types.length)fail('Doppelte Komponenten in '+target.name);}
function component(doc,type){const rows=doc.components.filter(c=>c.$type===type);if(rows.length!==1||!rows[0].$value||typeof rows[0].$value!=='object')fail('Eindeutige Komponente fehlt: '+type);return rows[0].$value;}
function generic(doc){identity(doc,TARGET);if(doc.components.some(c=>c.$type===P+'Inventory'||c.$type===P+'InventorySetup'))fail('Generische Einzelbeute wurde durch ein Inventar ersetzt.');if(!equal(component(doc,PICKUP),PLACEHOLDER))fail('Dynamischer Einzelgegenstand-Platzhalter stimmt nicht.');if(doc.components.some(c=>ADDED.includes(c.$type)))fail('Aufhebe-Komponenten sind bereits verändert; unveränderte Originalbasis verwenden.');}
function apply(ctx,input,output){
 const selected=ctx?.config?.gameplay?.enableAutoLoot,summary={enabled:selected?.enabled===true&&selected.autoCollectGravityLoot===true,resources:[],gameplayVerified:false};if(!summary.enabled)return summary;
 const values=parameters(selected);schema(ctx.reflection);const fs=ctx.fs||fsDefault,before=read(fs,path.join(input,relative(TARGET)));generic(before);
 const orb=read(fs,path.join(input,relative(ORB)));identity(orb,ORB);for(const type of ADDED)if(!equal(component(orb,type),NATIVE[type]))fail('Nativer Aufhebe-Komponentenspender weicht ab: '+type);
 const slotExpected={genericPickupItem:TARGET.guid,spawnedPickupEntity:{id:0},shouldSpawnItem:false,spawnItem:{value:0},spawnItemLevel:0,spawnItemRarity:'Common',spawnItemAmount:0};
 for(const spawner of SPAWNERS){const doc=read(fs,path.join(input,relative(spawner)));identity(doc,spawner);if(!equal(component(doc,SLOT),slotExpected)||component(doc,P+'RandomLoot').disableRandomLoot!==false)fail('Bestätigte Spawner-Verbindung zur generischen Bodenbeute fehlt: '+spawner.name);component(doc,P+'RandomLootContainer');component(doc,P+'RandomLootProbability');}
 const file=path.join(output,relative(TARGET)),current=fs.existsSync(file)?read(fs,file):clone(before);generic(current);const expected=clone(current);
 for(const type of ADDED){const value=clone(component(orb,type));if(type===RANGE)value.updateDelay.value=values.delayNs;if(type===TRIGGER)value.rangeX=values.radius;expected.components.push({$type:type,$value:value});}
 summary.resources.push({guid:TARGET.guid,file:relative(TARGET),expected});Object.assign(summary,values,{filesChanged:1,spawnerGuids:SPAWNERS.map(s=>s.guid),sourceGuid:ORB.guid});
 fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(expected,null,2));if(typeof ctx.track==='function')for(const type of ADDED)ctx.track(file,'components.'+type);return summary;
}
function verify({fs=fsDefault,verifyRoot,summary}){
 if(!summary?.enabled)return {enabled:false};const row=summary.resources?.[0];if(summary.resources?.length!==1||row.guid!==TARGET.guid||row.file!==relative(TARGET)||summary.sourceGuid!==ORB.guid||!equal(summary.spawnerGuids,SPAWNERS.map(s=>s.guid)))fail('Unvollständige Einzelbeute-Prüfliste.');
 const actual=read(fs,path.join(verifyRoot,row.file));identity(actual,TARGET);if(!equal(actual,row.expected))fail('Aufhebe-Komponenten oder unveränderte Einzelbeute-Felder nach Rücklesen abweichend.');const zone=component(actual,ZONE),range=component(actual,RANGE),trigger=component(actual,TRIGGER);if(!equal(zone,NATIVE[ZONE])||!equal(range,{...NATIVE[RANGE],updateDelay:{value:summary.delayNs}})||!equal(trigger,{...NATIVE[TRIGGER],rangeX:summary.radius})||!equal(component(actual,PICKUP),PLACEHOLDER))fail('Reichweite, Wartezeit oder dynamischer Gegenstand wurden abweichend installiert.');return {enabled:true,checked:1,componentsChecked:3,spawnerReferencesChecked:2,unrelatedFieldsPreserved:true,corpseInventoriesSupported:false,gameplayVerified:false};
}
module.exports={apply,verify,schema,parameters,TARGET,ORB,SPAWNERS,ADDED,NATIVE,PLACEHOLDER,PICKUP,SLOT,ZONE,RANGE,TRIGGER};
