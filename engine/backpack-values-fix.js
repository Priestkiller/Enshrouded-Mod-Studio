'use strict';
// Extra backpack space must agree in the PIDE inventory and item tooltip.
// A low addition cap never removes any capacity of the original backpack.
const fsDefault=require('fs'),path=require('path'),LOCA=496430443;
const ITEM='keen::ItemInfo',TEMPLATE='keen::ecs::TemplateResource',INVENTORY='keen::ecs::InventorySetup';
const clone=v=>JSON.parse(JSON.stringify(v)),GUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
function fail(message){throw Error('Rucksackplätze: '+message);}
function type(reflection,name){const t=reflection?.types?.find(t=>t.qualifiedName===name);if(!t)fail('Frische Typbeschreibung fehlt: '+name);return t;}
function assertSchema(reflection){const t=type(reflection,INVENTORY);for(const key of ['genericSlotCount','availableSlotCount']){const f=t.structFields?.[key],value=Number.isInteger(f?.type)?reflection.types[f.type]:null;if(value?.primitiveType!=='UINT8'||value.size!==1)fail('Ungeprüftes natives Inventarplatzfeld: '+key);}for(const name of [ITEM,TEMPLATE])if(!Number.isInteger(type(reflection,name).qualifiedHash))fail('Ressourcentypkennung fehlt.');}
function nameFor(reflection,kind,guid){const t=type(reflection,kind);return path.join(t.name,guid+'_'+t.qualifiedHash.toString(16).padStart(8,'0')+'_0.json');}
function inventory(doc){const list=doc.components?.filter(c=>c.$type===INVENTORY);if(list?.length!==1)fail('Original-Rucksackinventar fehlt oder ist mehrdeutig.');return list[0].$value;}
function ui(doc){const list=doc.uiValues?.filter(v=>v.locaId?.value===LOCA);if(list?.length!==1)fail('Rucksack-Platzanzeige fehlt oder ist mehrdeutig.');return list[0];}
function capacity(before,bonus,cap){if(!Number.isInteger(before)||before<8||before>248||before%8!==0)fail('Ursprüngliche Rucksackgröße muss aus vollständigen Achterreihen bestehen.');if(!Number.isInteger(bonus)||bonus<0||bonus>40||!Number.isInteger(cap)||cap<8||cap>96)fail('Ungültiger Bonus oder Platzdeckel.');return Math.max(before,Math.min(Math.floor(cap/8)*8,Math.ceil((before+bonus)/8)*8));}
function apply(ctx,inputRoot,outputRoot){
 const option=ctx?.config?.inventory?.enableHigherBackpackSlot,summary={enabled:option?.enabled===true,targets:0,filesChanged:0,baseCapacityPreserved:0,proofs:[],gameplayVerified:false};if(!summary.enabled)return summary;
 if(!Number.isInteger(option.bonus)||option.bonus<0||option.bonus>40||!Number.isInteger(option.cap)||option.cap<8||option.cap>96)fail('Ungültiger Bonus oder Platzdeckel.');assertSchema(ctx.reflection);
 const fs=ctx.fs||fsDefault,input=path.resolve(inputRoot),output=path.resolve(outputRoot);for(const[a,b]of[[input,output],[output,input]]){const r=path.relative(a,b);if(!r||r!=='..'&&!r.startsWith('..'+path.sep)&&!path.isAbsolute(r))fail('Original und Ausgabe müssen getrennt sein.');}
 const folder=path.join(input,type(ctx.reflection,ITEM).name);if(!fs.existsSync(folder))fail('Frischer ItemInfo-Export fehlt.');const pending=new Map();
 function current(relative,original){const dest=path.join(output,relative);if(pending.has(relative))return pending.get(relative).doc;const doc=fs.existsSync(dest)?JSON.parse(fs.readFileSync(dest,'utf8')):clone(original);pending.set(relative,{doc,before:JSON.stringify(doc),dest});return doc;}
 for(const name of fs.readdirSync(folder).filter(n=>n.endsWith('.json')).sort()){
  const item=JSON.parse(fs.readFileSync(path.join(folder,name),'utf8'));if(item.$type!==ITEM||item.equipment?.slot!=='Backpack')continue;
  if(item.$part!==0||!GUID.test(item.$guid)||!GUID.test(item.pidEntity||'')||!item.flags?.includes('HasPIDE')||!item.flags?.includes('IsContainer'))fail('Ungeprüfte Rucksack-/PIDE-Verbindung.');
  const itemRelative=nameFor(ctx.reflection,ITEM,item.$guid);if(path.basename(itemRelative)!==name)fail('Nicht kanonischer Rucksack-Itemexport.');const templateRelative=nameFor(ctx.reflection,TEMPLATE,item.pidEntity),templateFile=path.join(input,templateRelative);if(!fs.existsSync(templateFile))fail('Frischer Rucksack-PIDE-Export fehlt: '+item.pidEntity);
  const template=JSON.parse(fs.readFileSync(templateFile,'utf8'));if(template.$type!==TEMPLATE||template.$guid!==item.pidEntity||template.$part!==0)fail('Rucksack-PIDE-Identität stimmt nicht.');const base=inventory(template),display=ui(item);
  if(!Number.isInteger(base.genericSlotCount)||base.genericSlotCount<1||base.genericSlotCount>255||base.availableSlotCount!==base.genericSlotCount||display.value!==base.genericSlotCount)fail('Ungeprüfte ursprüngliche Rucksack-Platzstruktur.');
  const expected=capacity(base.genericSlotCount,option.bonus,option.cap),outItem=current(itemRelative,item),outTemplate=current(templateRelative,template);
  if(outItem.$guid!==item.$guid||outItem.pidEntity!==item.pidEntity||outItem.equipment?.slot!=='Backpack'||outTemplate.$guid!==template.$guid)fail('Rucksackidentität wurde durch eine andere Änderung verändert.');
  const destination=inventory(outTemplate);destination.genericSlotCount=expected;destination.availableSlotCount=expected;ui(outItem).value=expected;summary.targets++;if(option.cap<base.genericSlotCount)summary.baseCapacityPreserved++;
  summary.proofs.push({itemRelative,templateRelative,itemGuid:item.$guid,pidEntity:item.pidEntity,before:base.genericSlotCount,bonus:option.bonus,cap:option.cap,expected,writtenSlots:destination.genericSlotCount,writtenAvailable:destination.availableSlotCount,writtenUI:ui(outItem).value});
 }
 if(!summary.targets)fail('Keine vollständig zugeordneten Rucksack-Item-/PIDE-Paare gefunden.');
 for(const row of pending.values())if(JSON.stringify(row.doc)!==row.before){fs.mkdirSync(path.dirname(row.dest),{recursive:true});fs.writeFileSync(row.dest,JSON.stringify(row.doc,null,2));summary.filesChanged++;}
 return summary;
}
function verify(summary,verifyRoot,ctx={}){if(!summary?.enabled)return {enabled:false,checked:0,gameplayVerified:false};const fs=ctx.fs||fsDefault;let checked=0;for(const proof of summary.proofs){for(const rel of[proof.itemRelative,proof.templateRelative])if(path.isAbsolute(rel)||path.normalize(rel).startsWith('..'))fail('Ungültiger lokaler Rucksack-Prüfpfad.');const item=JSON.parse(fs.readFileSync(path.join(verifyRoot,proof.itemRelative),'utf8')),template=JSON.parse(fs.readFileSync(path.join(verifyRoot,proof.templateRelative),'utf8')),slots=inventory(template);if(item.$guid!==proof.itemGuid||template.$guid!==proof.pidEntity||item.pidEntity!==proof.pidEntity||slots.genericSlotCount!==proof.expected||slots.availableSlotCount!==proof.expected||ui(item).value!==proof.expected)fail('Archivprüfung: Rucksackinventar und Platzanzeige stimmen nicht mit dem erwarteten Wert überein.');checked++;}return {enabled:true,checked,gameplayVerified:false};}
module.exports={apply,verify,assertSchema,capacity,LOCA};
