'use strict';
// Stamina storage and its Push literals are signed integers. Scale using a
// bounded integer ratio, then clamp to the uint16 network representation.
const fsDefault = require('fs'), path = require('path');
const TYPE = 'keen::BaseAttributeResource';
const GUID = '0a0eabad-6094-4ba2-8dc5-614d500d0a34';
const CONTAINER = 'keen::AttributeContainerResource';
const CONTAINER_GUID = '8f1fd455-a5bf-4184-a77c-7123955d6e04';
const RECHARGE_ID = 2959910128, INDEX = 5, ONE = 65536;
const PRECISION = 1000, MAX_NUMERATOR = 10000, NETWORK_MAX = 65535;
const BASELINE = [131077,393215,0,393215,65536,851967];
const OPERATIONS = {Load:2,Push:5,Multiply:8,Divide:9,Clamp:12};
const clone = value => JSON.parse(JSON.stringify(value));
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
function fail(message) { throw Error('Spielerwerte: ' + message); }
function factor(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0.1 || value > 10) fail('Ausdauerregeneration benötigt einen Faktor von 0,1 bis 10.');
  return value;
}
function scaleRatio(value) {
  const selected=factor(value),numerator=Math.round(selected*PRECISION);
  if (!Number.isInteger(numerator) || numerator<1 || numerator>MAX_NUMERATOR || ONE*numerator>0x7fffffff) fail('Ausdauerfaktor überschreitet die sichere Ganzzahlberechnung.');
  let a=numerator,b=PRECISION;while(b){const r=a%b;a=b;b=r;}
  return {numerator:numerator/a,denominator:PRECISION/a,effectiveFactor:numerator/PRECISION,precision:1/PRECISION};
}
function expectedCalculation(value) {
  const selected = factor(value),ratio=scaleRatio(selected);
  if (selected === 1) return BASELINE.slice();
  const push=(OPERATIONS.Push<<16)|0xffff;
  const result=[...BASELINE,push,ratio.numerator,(OPERATIONS.Multiply<<16)|0xffff];
  if(ratio.denominator!==1)result.push(push,ratio.denominator,(OPERATIONS.Divide<<16)|0xffff);
  result.push(push,0,push,NETWORK_MAX,(OPERATIONS.Clamp<<16)|0xffff);
  return result;
}
function schema(reflection) {
  if (!reflection || typeof reflection.version !== 'string' || !Array.isArray(reflection.types)) fail('Frische Reflection fehlt.');
  const types = reflection.types;
  function named(name) { const all = types.filter(t=>t?.qualifiedName===name); if (all.length!==1) fail('Reflection-Typ fehlt oder ist mehrdeutig: '+name); return all[0]; }
  function field(owner,key,primitive) {
    const definition=named(owner),entry=definition.structFields?.[key],type=entry&&types[entry.type];
    if (!type || type.primitiveType!==primitive) fail('Unbekannter Formeltyp: '+owner+'.'+key);
    return type;
  }
  const resource=named(TYPE),structure=field(TYPE,'structure','BLOB_ARRAY');
  if (resource.primitiveType!=='STRUCT' || !Number.isInteger(resource.qualifiedHash) || types[structure.innerType]?.qualifiedName!=='keen::AttributeStructure') fail('BaseAttributeResource-Struktur ist nicht unterstützt.');
  const commands=field('keen::AttributeStructure','calculation','BLOB_ARRAY');
  let command=types[commands.innerType];
  if (command?.qualifiedName!=='keen::AttributeCommand' || command.primitiveType!=='TYPEDEF' || command.size!==4) fail('AttributeCommand ist kein bekanntes 32-Bit-Formelwort.');
  command=types[command.innerType];
  if (command?.primitiveType!=='UINT32' || command.size!==4) fail('AttributeCommand ist kein uint32-Formelwort.');
  const ops=named('keen::AttributeOps');
  if (ops.primitiveType!=='ENUM' || ops.size!==2 || Object.entries(OPERATIONS).some(([key,value])=>ops.enumFields?.[key]?.value!==value)) fail('Attribute-Operatoren für Load/Push/Clamp/Multiply/Divide haben sich geändert.');
  const ids=field(TYPE,'ids','BLOB_ARRAY');
  if (types[ids.innerType]?.qualifiedName!=='keen::HashKey32') fail('Attribut-IDs sind nicht unterstützt.');
  const container=named(CONTAINER),attributes=field(CONTAINER,'attributes','BLOB_ARRAY');
  if (container.primitiveType!=='STRUCT' || !Number.isInteger(container.qualifiedHash) || types[attributes.innerType]?.qualifiedName!==TYPE) fail('AttributeContainerResource enthält keine bekannten Attributdefinitionen.');
  return {base:resource,container};
}
function read(fs,file) { try { return JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'')); } catch(e) { fail('Ressource nicht lesbar: '+path.basename(file)+'. '+e.message); } }
function identity(doc,file,type,guid) {
  const name=guid+'_'+type.qualifiedHash.toString(16).padStart(8,'0')+'_0.json';
  if (doc?.$type!==type.qualifiedName || doc.$guid!==guid || doc.$part!==0 || path.basename(file).toLowerCase()!==name) fail('Ausdauer-Ressourcenidentität stimmt nicht.');
}
function node(doc) {
  if (doc.type?.value!==2556031774 || !Array.isArray(doc.ids) || !Array.isArray(doc.structure) || doc.ids.length!==8 || doc.structure.length!==8 || doc.ids[INDEX]?.value!==RECHARGE_ID || doc.ids.filter(x=>x?.value===RECHARGE_ID).length!==1 || doc.debugNames?.[INDEX]!=='Stamina_Recharge') fail('Eindeutiges ganzzahliges Stamina_Recharge-Attribut fehlt.');
  const result=doc.structure[INDEX];
  if (!result || result.parentIndex!==0 || result.childIndex!==65535 || result.siblingIndex!==6 || !Array.isArray(result.calculation)) fail('Stamina_Recharge-Struktur hat sich geändert.');
  return result;
}
function attribute(doc,container) {
  if (!container) return {value:doc,index:null};
  if (!Array.isArray(doc.attributes)) fail('Kompilierte Attributdefinitionen fehlen.');
  const selected=doc.attributes.map((value,index)=>({value,index})).filter(entry=>entry.value?.ids?.some(id=>id?.value===RECHARGE_ID));
  if (selected.length!==1 || selected[0].value.type?.value!==2556031774) fail('Kompilierte Stamina_Recharge-Definition fehlt oder ist mehrdeutig.');
  return selected[0];
}
function apply(ctx,inputRoot,outputRoot) {
  const option=ctx?.config?.player?.adjustStaminaRegen;
  if (option?.enabled!==true) return {enabled:false,resources:[],types:[],filesChanged:0,gameplayVerified:false};
  const selected=factor(option.factor),expected=expectedCalculation(selected),types=schema(ctx.reflection),fs=ctx.fs||fsDefault;
  if (path.resolve(inputRoot).toLowerCase()===path.resolve(outputRoot).toLowerCase()) fail('Original- und Ausgabeordner müssen getrennt sein.');
  const pending=[],resources=[];
  for (const [kind,guid] of [['base',GUID],['container',CONTAINER_GUID]]) {
    const type=types[kind],name=guid+'_'+type.qualifiedHash.toString(16).padStart(8,'0')+'_0.json';
    const originalFile=path.join(inputRoot,type.name,name),outputFile=path.join(outputRoot,type.name,name);
    const original=read(fs,originalFile); identity(original,originalFile,type,guid);
    const initial=attribute(original,kind==='container');
    if (!same(node(initial.value).calculation,BASELINE)) fail('Die ursprüngliche Ausdauerformel ist unbekannt. Keine ungeprüfte Formel überschreiben.');
    const current=fs.existsSync(outputFile)?read(fs,outputFile):clone(original); identity(current,outputFile,type,guid);
    const live=attribute(current,kind==='container');
    if (initial.index!==live.index) fail('Kompilierte Attributreihenfolge wurde verändert.');
    const currentNode=node(live.value),legacy=BASELINE.slice();legacy[4]=Math.round(ONE*selected);
    const brokenQ16=[...BASELINE,(OPERATIONS.Push<<16)|0xffff,Math.round(ONE*selected),(OPERATIONS.Multiply<<16)|0xffff];
    if (![BASELINE,legacy,brokenQ16,expected].some(known=>same(currentNode.calculation,known))) fail('Konkurrierende Änderung der Ausdauerformel.');
    if (!same(currentNode.calculation,expected)) { currentNode.calculation=expected.slice();pending.push({file:outputFile,doc:current}); }
    resources.push({type:type.qualifiedName,file:name,guid,part:0,attributeId:RECHARGE_ID,attributeIndex:initial.index,before:BASELINE.slice(),expected:expected.slice()});
  }
  // Check both linked definitions completely before writing either one.
  for (const row of pending) { fs.mkdirSync(path.dirname(row.file),{recursive:true});fs.writeFileSync(row.file,JSON.stringify(row.doc,null,2),'utf8');if (typeof ctx.track==='function') ctx.track(row.file,'player-values-fix'); }
  return {enabled:true,build:ctx.reflection.version,selected:{factor:selected},scale:scaleRatio(selected),networkMaximum:NETWORK_MAX,types:[TYPE,CONTAINER],filesChanged:pending.length,resources,gameplayVerified:false};
}
function verify(summary,reflection,root,fs=fsDefault) {
  if (summary?.enabled!==true) return {enabled:false,checked:0,gameplayVerified:false};
  const types=schema(reflection),expected=expectedCalculation(summary.selected?.factor);
  if (summary.build!==reflection.version || summary.resources?.length!==2 || !same(summary.scale,scaleRatio(summary.selected.factor)) || summary.networkMaximum!==NETWORK_MAX) fail('Ausdauer-Prüfliste passt nicht zur Spielversion.');
  for (const [index,kind,guid] of [[0,'base',GUID],[1,'container',CONTAINER_GUID]]) {
    const type=types[kind],entry=summary.resources[index],name=guid+'_'+type.qualifiedHash.toString(16).padStart(8,'0')+'_0.json';
    if (entry.type!==type.qualifiedName || entry.file!==name || entry.guid!==guid || entry.part!==0 || entry.attributeId!==RECHARGE_ID || !same(entry.before,BASELINE) || !same(entry.expected,expected)) fail('Ausdauer-Prüfliste enthält eine abweichende Berechnung.');
    const file=path.join(root,type.name,name),doc=read(fs,file);identity(doc,file,type,guid);
    const selected=attribute(doc,kind==='container');
    if (selected.index!==entry.attributeIndex || !same(node(selected.value).calculation,expected)) fail('Ausdauerformel nach Archiv-Readback weicht vom Profil ab.');
  }
  return {enabled:true,checked:2,scale:scaleRatio(summary.selected.factor),networkMaximum:NETWORK_MAX,gameplayVerified:false};
}
module.exports={apply,verify,schema,expectedCalculation,scaleRatio,TYPE,GUID,CONTAINER,CONTAINER_GUID,RECHARGE_ID,BASELINE,ONE,PRECISION,MAX_NUMERATOR,NETWORK_MAX};
