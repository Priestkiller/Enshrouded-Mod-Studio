'use strict';
// Validate changed native numeric fields before packing/exporting.
// The guard never clamps a requested value or rewrites any resource.
const fsDefault=require('fs'),path=require('path');
function fail(file,pointer,message){throw Error('Nativer Einstellungswert passt nicht: '+file+' '+pointer+'. '+message);}
function assertValue(value,type,file,pointer){
 const bits=Number(type.primitiveType.match(/^(?:UINT|SINT)(\d+)$/)?.[1]);
 if(bits){
  if(!Number.isInteger(value))fail(file,pointer,'Das Spielfeld '+type.primitiveType+' benötigt eine ganze Zahl.');
  if(bits>=64&&!Number.isSafeInteger(value))fail(file,pointer,'Das Ergebnis ist für eine verlustfreie Ganzzahlberechnung zu groß. Kleineren Faktor wählen.');
  const signed=type.primitiveType.startsWith('SINT'),width=BigInt(bits),minimum=signed?-(1n<<(width-1n)):0n,maximum=signed?(1n<<(width-1n))-1n:(1n<<width)-1n,integer=BigInt(value);
  if(integer<minimum||integer>maximum)fail(file,pointer,'Ergebnis '+value+' liegt außerhalb '+type.primitiveType+' ('+minimum+' bis '+maximum+'). Kleineren Faktor wählen.');
 }else if(type.primitiveType==='FLOAT32'&&!Number.isFinite(Math.fround(value)))fail(file,pointer,'Das Ergebnis passt nicht in ein endliches float32-Spielfeld.');
}
function inspect({reflection,before,after,file,selectedPaths=null}){
 if(!Array.isArray(reflection?.types))fail(file,'/','Frische Reflection fehlt.');const types=reflection.types,byName=new Map(types.map(t=>[t.qualifiedName,t]));let checked=0;
 function walk(value,original,type,pointer,depth=0){
  if(depth>128)fail(file,pointer,'Verschachtelungsgrenze überschritten.');if(value===undefined||value===null||!type)return;
  if(value&&typeof value==='object'&&typeof value.$type==='string'&&Object.prototype.hasOwnProperty.call(value,'$value')){const dynamic=byName.get(value.$type);if(!dynamic)fail(file,pointer,'Unbekannter nativer Variantentyp '+value.$type+'.');walk(value.$value,original?.$type===value.$type?original.$value:undefined,dynamic,pointer+'/$value',depth+1);return;}
  if(type.primitiveType==='TYPEDEF'){walk(value,original,types[type.innerType],pointer,depth+1);return;}
  if(['BLOB_ARRAY','INLINE_ARRAY','STATIC_ARRAY'].includes(type.primitiveType)&&Array.isArray(value)){value.forEach((v,i)=>walk(v,Array.isArray(original)?original[i]:undefined,types[type.innerType],pointer+'/'+i,depth+1));return;}
  if(type.primitiveType==='STRUCT'&&typeof value==='object'){for(const[key,field]of Object.entries(type.structFields||{}))walk(value[key],original?.[key],types[field.type],pointer+'/'+key,depth+1);return;}
  if(typeof value==='number'&&value!==original&&(!selectedPaths||selectedPaths.has(pointer))){try{assertValue(value,type,file,pointer);}catch(error){if(selectedPaths?.get(pointer))error.message=selectedPaths.get(pointer)+': '+error.message;throw error;}checked++;}
 }
 const root=byName.get(after?.$type);if(!root)fail(file,'/','Unbekannter Ressourcentyp.');walk(after,before,root,'');return {checked};
}
function apply({reflection,config,fs=fsDefault},input,output){
 const mana=config?.gameplay?.adjustManaCost?.enabled===true,music=config?.gameplay?.adjustMusicTime?.enabled===true,cast=config?.gameplay?.adjustSpellCastTime?.enabled===true,bow=config?.gameplay?.adjustBowChargeTime?.enabled===true,gather=config?.gameplay?.enableGatherLootMultipliers?.enabled===true,summary={enabled:mana||music||cast||bow||gather,resources:0,changedNumericFields:0,gameplayVerified:false};if(!summary.enabled)return summary;
 const types=reflection?.types;if(!Array.isArray(types))fail('Reflection','/','Frische Reflection fehlt.');
 function field(owner,name,primitive){const t=types.find(t=>t.qualifiedName===owner),f=t?.structFields?.[name],p=f&&types[f.type];if(p?.primitiveType!==primitive)fail(owner,'/'+name,'Unbekannter nativer Feldtyp; erwartet '+primitive+'.');return p;}
 if(mana)field('keen::impact::Sint32ImpactConfig','value','SINT32');
 if(mana||cast||bow){const a=field('keen::ItemInfo','uiValues','BLOB_ARRAY'),element=types[a.innerType];if(!element)fail('ItemInfo','/uiValues','Unbekannter Anzeigewerttyp.');field(element.qualifiedName,'value','SINT32');}
 if(cast||bow)field('keen::impact::FloatImpactConfig','value','FLOAT32');
 if(gather){const a=field('keen::ecs::ResourceNodePickupDrops','drops','BLOB_ARRAY'),element=types[a.innerType];if(element?.qualifiedName!=='keen::ecs::ResourceNodeDropInfo')fail('ResourceNodePickupDrops','/drops','Unbekannter Drop-Datentyp.');const count=field(element.qualifiedName,'stackAmount','UINT8');if(count.size!==1)fail(element.qualifiedName,'/stackAmount','Unbekannte native Stückzahlbreite.');}
 if(music){field('keen::Time','value','SINT64');const balance=types.find(t=>t.qualifiedName==='keen::BalancingTable'),f=balance?.structFields?.timePerInstrumentUntilMaxBuff;if(types[f?.type]?.qualifiedName!=='keen::Time')fail('BalancingTable','/timePerInstrumentUntilMaxBuff','Unbekannter Zeitwerttyp.');}
 if(!fs.existsSync(output))return summary;
 function walk(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory()){walk(file);continue;}if(!entry.isFile()||!entry.name.endsWith('.json'))continue;const relative=path.relative(output,file),original=path.join(input,relative),after=JSON.parse(fs.readFileSync(file,'utf8')),before=fs.existsSync(original)?JSON.parse(fs.readFileSync(original,'utf8')):null,selectedPaths=new Map();
  if(after.$type==='keen::ItemInfo'){
   const ui=after.uiValues||[],durationOwner=cast&&ui.some(v=>v.locaId?.value===1551270780)?'gameplay.adjustSpellCastTime.factor':bow&&ui.some(v=>v.locaId?.value===2372276042)?'gameplay.adjustBowChargeTime.factor':null;
   for(const[value,i]of(after.impactValues?.simple||[]).map((v,i)=>[v,i])){if(mana&&value.$type==='keen::impact::Sint32ImpactConfig'&&(value.$value?.id==='3f6a0d25-f602-40b7-ae13-c2bd9672917e'||value.$value?.configGuid==='3f6a0d25-f602-40b7-ae13-c2bd9672917e'))selectedPaths.set('/impactValues/simple/'+i+'/$value/value','gameplay.adjustManaCost.factor');if(durationOwner&&value.$type==='keen::impact::FloatImpactConfig'&&(value.$value?.id==='0750bfea-b306-4452-9cec-05bca19e1e33'||value.$value?.configGuid==='0750bfea-b306-4452-9cec-05bca19e1e33'))selectedPaths.set('/impactValues/simple/'+i+'/$value/value',durationOwner);}
   for(const[value,i]of ui.map((v,i)=>[v,i])){if(mana&&value.locaId?.value===3193644544)selectedPaths.set('/uiValues/'+i+'/value','gameplay.adjustManaCost.factor');if(cast&&value.locaId?.value===1551270780)selectedPaths.set('/uiValues/'+i+'/value','gameplay.adjustSpellCastTime.factor');if(bow&&value.locaId?.value===2372276042)selectedPaths.set('/uiValues/'+i+'/value','gameplay.adjustBowChargeTime.factor');}
  }
  if(gather&&after.$type==='keen::ecs::TemplateResource')for(const[component,i]of(after.components||[]).map((v,i)=>[v,i]))if(component.$type==='keen::ecs::ResourceNodePickupDrops')for(let j=0;j<(component.$value?.drops||[]).length;j++)selectedPaths.set('/components/'+i+'/$value/drops/'+j+'/stackAmount','gameplay.enableGatherLootMultipliers');
  if(music&&after.$type==='keen::BalancingTable')selectedPaths.set('/timePerInstrumentUntilMaxBuff/value','gameplay.adjustMusicTime.factorTime');
  if(!selectedPaths.size)continue;const r=inspect({reflection,before,after,file:relative,selectedPaths});summary.resources++;summary.changedNumericFields+=r.checked;
 }}
 walk(output);return summary;
}
module.exports={apply,inspect,assertValue};
