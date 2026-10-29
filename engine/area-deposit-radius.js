'use strict';
// Existing authored station trigger only. No runtime components are injected.
const fsDefault=require('fs'),path=require('path');
const TEMPLATE='keen::ecs::TemplateResource',SEQUENCE='keen::actor::ActorSequenceResource',TRIGGER='keen::ecs::TriggerShape',INTERACTION='keen::ecs::InteractionOfferRuntime',CHECK='keen::ecs::CheckPlayerInRange',EVENT='keen::actor::AreaDepositEvent';
const TARGETS=Object.freeze([{guid:'f535f8e8-49f5-413e-819d-1db473286521',name:'Prop_Storage_Loot_Drop_Station_16x16',originalHalfExtent:8},{guid:'89fddfce-08ed-4ceb-8592-8f6597e3b154',name:'Prop_Storage_Loot_Drop_Station_24x24',originalHalfExtent:12}]);
const SEQUENCE_GUID='99747fd8-7319-4234-92af-1d10f4fb56c8',SEQUENCE_ID=2217063924;
const clone=v=>JSON.parse(JSON.stringify(v));
function fail(message){throw Error('Abladestationsbereich: '+message);}
function equal(a,b){if(a===b)return true;if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;const keys=Object.keys(a);return keys.length===Object.keys(b).length&&keys.every(k=>Object.prototype.hasOwnProperty.call(b,k)&&equal(a[k],b[k]));}
function factor(value){if(typeof value!=='number'||!Number.isFinite(value)||value<1||value>16)fail('Horizontaler Faktor muss zwischen 1 und 16 liegen.');return value;}
function scaled(value,multiplier){if(typeof value!=='number'||!Number.isFinite(value)||value<=0||!Number.isFinite(Math.fround(value)))fail('Ursprüngliche horizontale Ausdehnung ist ungültig.');const result=Math.fround(value*multiplier);if(!Number.isFinite(result)||result<=0)fail('Berechnete Ausdehnung passt nicht in float32.');return result;}
function schema(reflection){
 if(typeof reflection?.version!=='string'||!reflection.version.startsWith('1273043|')||!Array.isArray(reflection.types))fail('Frische Reflection für den bestätigten Build1273043 fehlt.');const types=reflection.types;
 function type(name){const found=types.filter(t=>t.qualifiedName===name);if(found.length!==1)fail('Reflection-Typ fehlt oder ist mehrdeutig: '+name);return found[0];}
 const trigger=type(TRIGGER);if(trigger.primitiveType!=='STRUCT'||trigger.size!==56||trigger.alignment!==4||trigger.fieldCount!==5||Object.keys(trigger.structFields||{}).sort().join('|')!=='offset|rangeX|rangeY|rangeZ|shape')fail('Unbekannte TriggerShape-Struktur.');
 const shape=types[trigger.structFields.shape.type];if(trigger.structFields.shape.dataOffset!==0||shape?.qualifiedName!=='keen::ecs::TriggerShapeType'||shape.primitiveType!=='ENUM'||shape.size!==1||shape.enumFields?.Range?.value!==0||shape.enumFields?.Box?.value!==1||Object.keys(shape.enumFields).length!==2)fail('Unbekannte Box-/Range-Formkennungen.');
 for(const [name,offset]of [['rangeX',4],['rangeY',8],['rangeZ',12]]){const f=trigger.structFields[name],t=types[f.type];if(f.dataOffset!==offset||t?.primitiveType!=='FLOAT32'||t.size!==4)fail('Unbekannter TriggerShape-Zahlentyp: '+name);}
 const template=type(TEMPLATE),sequence=type(SEQUENCE);if(template.qualifiedHash!==0x39768775||sequence.qualifiedHash!==0x9fd4a561)fail('Unbekannte Ressourcenkennungen.');
 type(INTERACTION);type(CHECK);type(EVENT);return {template,sequence};
}
function component(doc,type){const rows=doc.components?.filter(c=>c.$type===type);if(rows?.length!==1||!rows[0].$value||typeof rows[0].$value!=='object')fail('Benötigte eindeutige Komponente fehlt: '+type);return rows[0].$value;}
function filename(type,guid){return guid+'_'+type.qualifiedHash.toString(16).padStart(8,'0')+'_0.json';}
function read(fs,file){try{return JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));}catch(e){fail('Original-/Ausgabedatei fehlt oder ist ungültig: '+path.basename(file)+'. '+e.message);}}
function identity(doc,target){if(doc.$type!==TEMPLATE||doc.$guid!==target.guid||doc.$part!==0||doc.name!==target.name||doc.family!=='Prop'||!Array.isArray(doc.components))fail('Abladestation stimmt nicht mit der bestätigten Vorlage überein: '+target.name);}
function apply(ctx,input,output){
 const selected=ctx?.config?.world?.adjustAreaDepositRadius,summary={enabled:selected?.enabled===true,resources:[],gameplayVerified:false};if(!summary.enabled)return summary;
 const multiplier=factor(selected.factor),checked=schema(ctx.reflection),fs=ctx.fs||fsDefault;
 const sequenceFile=path.join(input,checked.sequence.name,filename(checked.sequence,SEQUENCE_GUID)),sequence=read(fs,sequenceFile);
 const events=sequence.subSequences?.flatMap(s=>s.events||[]).filter(e=>e.$type===EVENT);
 if(sequence.$type!==SEQUENCE||sequence.$guid!==SEQUENCE_GUID||sequence.resourceId!==SEQUENCE_GUID||sequence.$part!==0||events?.length!==1)fail('Bestätigter Abladestations-Ablauf mit AreaDepositEvent fehlt.');
 const pending=[];
 for(const target of TARGETS){
  const relative=path.join(checked.template.name,filename(checked.template,target.guid)),before=read(fs,path.join(input,relative));identity(before,target);
  const trigger=component(before,TRIGGER),interaction=component(before,INTERACTION),activation=component(before,CHECK);
  if(trigger.shape!=='Box'||interaction.defaultSequence?.value!==SEQUENCE_ID||!Number.isFinite(trigger.rangeY)||trigger.rangeY<=0||!trigger.offset||!Number.isFinite(activation.distanceInMeter))fail('Abladestations-Form, Sequenz oder unveränderte Zusatzdaten stimmen nicht.');
  if(trigger.rangeX!==target.originalHalfExtent||trigger.rangeZ!==target.originalHalfExtent)fail('Horizontale Ausgangsausdehnung ist bereits verändert oder gehört zu einer anderen Stationsversion. Unveränderte Originalbasis prüfen.');
  const file=path.join(output,relative),current=fs.existsSync(file)?read(fs,file):clone(before);identity(current,target);
  const outputTrigger=component(current,TRIGGER);if(!equal(outputTrigger,trigger))fail('Eine andere Änderung hat die Abladestations-Ausdehnung bereits verändert.');
  const expected=clone(current),expectedTrigger=component(expected,TRIGGER);expectedTrigger.rangeX=scaled(trigger.rangeX,multiplier);expectedTrigger.rangeZ=scaled(trigger.rangeZ,multiplier);
  summary.resources.push({guid:target.guid,file:relative,name:target.name,before:{rangeX:trigger.rangeX,rangeZ:trigger.rangeZ},after:{rangeX:expectedTrigger.rangeX,rangeZ:expectedTrigger.rangeZ},expected});
  if(!equal(current,expected))pending.push({file,expected});
 }
 summary.factor=multiplier;summary.filesChanged=pending.length;summary.sequenceGuid=SEQUENCE_GUID;summary.horizontalAreaFactor=multiplier*multiplier;
 for(const item of pending){fs.mkdirSync(path.dirname(item.file),{recursive:true});fs.writeFileSync(item.file,JSON.stringify(item.expected,null,2));if(typeof ctx.track==='function')for(const key of ['rangeX','rangeZ'])ctx.track(item.file,'components.TriggerShape.'+key);}
 return summary;
}
function verify({fs=fsDefault,verifyRoot,summary}){
 if(!summary?.enabled)return {enabled:false};if(summary.resources?.length!==2||summary.sequenceGuid!==SEQUENCE_GUID)fail('Unvollständige Abladestations-Prüfliste.');const seen=new Set();
 for(const row of summary.resources){const target=TARGETS.find(t=>t.guid===row.guid);if(!target||seen.has(row.guid)||row.file!==path.join('TemplateResource',target.guid+'_39768775_0.json'))fail('Fremde oder doppelte Abladestations-Prüfressource.');seen.add(row.guid);const actual=read(fs,path.join(verifyRoot,row.file));identity(actual,target);if(!equal(actual,row.expected))fail('Ausdehnung oder unbeteiligte Stationsfelder nach Rücklesen abweichend: '+target.name);}
 return {enabled:true,checked:2,fieldsChecked:4,otherStationFieldsPreserved:true,gameplayVerified:false};
}
module.exports={apply,verify,schema,scaled,factor,TARGETS,SEQUENCE_GUID,SEQUENCE_ID,TRIGGER,INTERACTION,CHECK,EVENT};
