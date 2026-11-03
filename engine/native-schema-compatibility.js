'use strict';
// A release-owned layout contract. Native build labels are not layout proofs.
const crypto=require('crypto');
const profileData=require('./native-compatibility-profiles.json');
const PROFILE_ID='native1283531-schema-v1';
const BASELINE_BUILD='1283531|^/game38/branches/release_1.0|2026-10-30T09:15:50.868196Z';
const PROFILE_FILE_SHA256='eca06d83cd9ce6f92ccfd67ada81d10ec8a354269187d37cfa451987cd95b516';
const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}':JSON.stringify(value);
const digest=value=>crypto.createHash('sha256').update(typeof value==='string'?value:canonical(value)).digest('hex');
function invalid(message,details={}){
 const error=Error('Spielstruktur nicht kompatibel: '+message);
 error.actionCode='game_schema_unsupported';error.reason='schema_changed';
 error.mismatchDetails={baselineBuild:BASELINE_BUILD,gameFilesChanged:false,...details};throw error;
}
function isBuildIdentity(build){
 if(typeof build!=='string'||build.length>160)return false;
 const match=/^([1-9][0-9]{5,11})\|\^\/game38\/branches\/release_1\.0\|(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{1,9}Z)$/.exec(build);
 if(!match)return false;
 const time=Date.parse(match[2]);return Number.isFinite(time)&&new Date(time).toISOString().slice(0,19)===match[2].slice(0,19);
}
function assertBuild(build){
 if(!isBuildIdentity(build)){
  const error=Error('Unbekannte Enshrouded-Buildkennung. Erwartet wird eine vollständige native Kennung der release_1.0-Reihe; erkannt: '+String(build||'unbekannt').slice(0,160)+'.');
  error.actionCode='game_build_unsupported';error.reason='update_required';error.mismatchDetails={expectedBranch:'^/game38/branches/release_1.0',actualBuild:typeof build==='string'?build.slice(0,160):null,gameFilesChanged:false};throw error;
 }
 return build;
}
function indexReflection(reflection){
 assertBuild(reflection?.version);
 if(!Array.isArray(reflection.types)||reflection.types.length<1||reflection.types.length>50000)invalid('Frische native Reflection fehlt oder überschreitet die Grenze.',{actualBuild:reflection.version});
 const map=new Map();
 for(let index=0;index<reflection.types.length;index++){
  const type=reflection.types[index];
  if(!type||typeof type!=='object'||Array.isArray(type)||type.index!==index||typeof type.qualifiedName!=='string'||!type.qualifiedName||type.qualifiedName.length>4096||/[\r\n\0]/.test(type.qualifiedName)||map.has(type.qualifiedName))invalid('Ungültige oder doppelte Reflection-Identität.',{actualBuild:reflection.version});
  map.set(type.qualifiedName,type);
 }
 return map;
}
function shape(reflection,type){
 const reference=index=>{
  if(!Number.isInteger(index)||index<0||index>=reflection.types.length)invalid('Ungültiger Verweis im Typ '+type.qualifiedName+'.');
  return reflection.types[index].qualifiedName;
 };
 const row={name:type.qualifiedName,primitive:type.primitiveType,qualifiedHash:type.qualifiedHash,size:type.size,alignment:type.alignment,elementAlignment:type.elementAlignment,flags:type.flags};
 for(const key of ['primitiveType','flags'])if(typeof type[key]!=='string')invalid('Unvollständige Typbeschreibung: '+type.qualifiedName+'.');
 for(const key of ['qualifiedHash','size','alignment','elementAlignment','fieldCount'])if(!Number.isInteger(type[key])||type[key]<0||type[key]>0xffffffff)invalid('Ungültiges Layoutfeld '+type.qualifiedName+'.'+key+'.');
 // The variant count is a census of all known subclasses, not its byte layout.
 // New classes remain unusable in modified documents until independently known.
 if(type.primitiveType!=='BLOB_VARIANT'&&type.primitiveType!=='DS_VARIANT')row.fieldCount=type.fieldCount;
 if(Object.hasOwn(type,'innerType'))row.innerType=reference(type.innerType);
 if(Object.hasOwn(type,'structFields')){
  if(!type.structFields||typeof type.structFields!=='object'||Array.isArray(type.structFields))invalid('Ungültige Strukturfelder: '+type.qualifiedName+'.');
  row.fields=Object.fromEntries(Object.entries(type.structFields).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([key,field])=>{
   if(!field||typeof field!=='object'||field.name!==key||!Number.isInteger(field.dataOffset)||field.dataOffset<0||field.dataOffset>type.size)invalid('Ungültiges Strukturfeld '+type.qualifiedName+'.'+key+'.');
   return [key,{type:reference(field.type),offset:field.dataOffset}];
  }));
 }
 if(Object.hasOwn(type,'enumFields')){
  if(!type.enumFields||typeof type.enumFields!=='object'||Array.isArray(type.enumFields))invalid('Ungültige Enumwerte: '+type.qualifiedName+'.');
  row.enumFields=Object.fromEntries(Object.entries(type.enumFields).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([key,field])=>{
   if(!field||field.name!==key||!Number.isSafeInteger(field.value))invalid('Ungültiger Enumwert '+type.qualifiedName+'.'+key+'.');
   return [key,field.value];
  }));
 }
 if(Object.hasOwn(type,'defaultValue')){
  if(!Array.isArray(type.defaultValue)||type.defaultValue.length>1048576||type.defaultValue.some(value=>!Number.isInteger(value)||value<0||value>255))invalid('Ungültige native Vorgabe: '+type.qualifiedName+'.');
  row.defaultValueSha256=crypto.createHash('sha256').update(Buffer.from(type.defaultValue)).digest('hex');
 }
 return row;
}
let profilesChecked=false;
const documentTypeSets=new Map();
function profiles(){
 if(!profilesChecked){
  if(digest(profileData)!==PROFILE_FILE_SHA256||profileData.format!==1||profileData.id!==PROFILE_ID||profileData.baselineBuild!==BASELINE_BUILD)invalid('Freigegebenes Strukturprofil wurde verändert.');
  for(const role of ['server','client']){
   const profile=profileData.profiles?.[role];
   if(!profile||!Array.isArray(profile.types)||profile.types.length<1||digest(profile.types)!==profile.schemaSha256||new Set(profile.types.map(type=>type.name)).size!==profile.types.length)invalid('Freigegebenes Rollenprofil ist ungültig.');
  }
  profilesChecked=true;
 }
 return profileData.profiles;
}
function compatibility(reflection,role){
 const map=indexReflection(reflection);
 if(role===undefined)role=map.has('keen::UiTextureResource')?'client':'server';
 if(!['server','client'].includes(role))invalid('Unbekannte Archivrolle.');
 const profile=profiles()[role];
 for(const expected of profile.types){
  const actual=map.get(expected.name);
  if(!actual)invalid('Benötigter Typ fehlt: '+expected.name+'.',{actualBuild:reflection.version,role,type:expected.name});
  const actualShape=shape(reflection,actual);
  if(canonical(actualShape)!==canonical(expected)){
   const field=Object.keys({...expected,...actualShape}).sort().find(key=>canonical(expected[key])!==canonical(actualShape[key]));
   invalid('Benötigter Typ geändert: '+expected.name+(field?' ('+field+')':'')+'.',{actualBuild:reflection.version,role,type:expected.name,field:field||null});
  }
 }
 return {profile:PROFILE_ID,role,gameBuild:reflection.version,baselineBuild:BASELINE_BUILD,schemaSha256:profile.schemaSha256,checked:true,typesChecked:profile.types.length};
}
function assertReflection(reflection,role){compatibility(reflection,role);return reflection;}
function assertDocumentTypes(document,role){
 if(!['server','client'].includes(role))invalid('Dokumentprüfung benötigt eine eindeutige Archivrolle.');
 if(!documentTypeSets.has(role))documentTypeSets.set(role,new Set(profiles()[role].types.map(type=>type.name)));
 const allowed=documentTypeSets.get(role);
 let nodes=0;
 function visit(value,depth){
  if(depth>96||++nodes>2000000)invalid('Geänderte Ressource überschreitet die Strukturgrenze.');
  if(!value||typeof value!=='object')return;
  if(!Array.isArray(value)&&Object.hasOwn(value,'$type')&&(typeof value.$type!=='string'||!allowed.has(value.$type)))invalid('Neuer Typ in einer geänderten Ressource: '+String(value.$type).slice(0,200)+'.',{role,type:typeof value.$type==='string'?value.$type.slice(0,200):null});
  for(const child of Object.values(value))visit(child,depth+1);
 }
 visit(document,0);return document;
}
module.exports={PROFILE_ID,BASELINE_BUILD,canonical,digest,shape,isBuildIdentity,assertBuild,assertReflection,compatibility,assertDocumentTypes};
