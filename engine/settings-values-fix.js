'use strict';
// Own-source, JSON-only correction for integer counts and paired fall limits.
// Every expected result is derived from the original export, never a prior patch.
const fsDefault=require('fs'),path=require('path');
const BALANCE='keen::BalancingTable',TEMPLATE='keen::ecs::TemplateResource',FALL='keen::ecs::FallDamage';
const INVENTORY_FIELDS={'keen::ecs::InventorySetup':['genericSlotCount','availableSlotCount'],'keen::ecs::InventorySetupOverwrite':['genericSlotCount']};
const UINT8=255,UINT32=0xffffffff,GUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k),clone=v=>JSON.parse(JSON.stringify(v));
function fail(message){throw Error('Einstellungswerte: '+message);}
function number(value,name){if(typeof value!=='number'||!Number.isFinite(value)||value<=0)fail(name+' muss eine positive endliche Zahl sein.');return value;}
function integer(value,min,max,name){if(!Number.isInteger(value)||value<min||value>max)fail(name+' muss eine ganze Zahl von '+min+' bis '+max+' sein (erhalten: '+value+').');return value;}
function scaleCount(before,factor,maximum,cap=maximum,name='Zählwert'){
 integer(before,0,maximum,name+' Ausgangswert');number(factor,name+' Faktor');integer(cap,1,maximum,name+' Höchstzahl');
 const product=before*factor,result=Math.min(cap,Math.round(product));
 if(!Number.isFinite(product)||!Number.isSafeInteger(result)||result<0||result>maximum)fail(name+': berechneter Wert '+product+' überschreitet den unterstützten Bereich 0 bis '+maximum+'.');
 return result;
}
function musicCount(before,factor,name){integer(before,0,UINT32,name+' Ausgangswert');number(factor,name+' Faktor');const result=Math.round(before*factor);if(!Number.isSafeInteger(result)||result<0||result>UINT32)fail(name+': berechneter Wert '+result+' überschreitet uint32 (höchstens '+UINT32+'). Kleineren Faktor wählen.');return result;}
function fallPair(before,option,name='Spieler'){
 const start=Math.fround(number(before.start,name+' ursprünglicher Fallschadenbeginn')*number(option.factorStart,'Fallschadenbeginn-Faktor'));
 const lethal=Math.fround(number(before.lethal,name+' ursprüngliche tödliche Fallgrenze')*number(option.factorLethal,'Tödliche-Fallgrenze-Faktor'));
 if(!Number.isFinite(start)||!Number.isFinite(lethal)||start<0||lethal<=start)fail(name+': Fallschadenbeginn '+start+' muss unter der tödlichen Fallgrenze '+lethal+' liegen. Die beiden Faktoren anpassen.');
 return {start,lethal};
}
function options(config){const world=config.world||{},gameplay=config.gameplay||{},inventory=config.inventory||{};return {altar:world.adjustAltarLimit?.enabled===true?clone(world.adjustAltarLimit):null,water:gameplay.adjustWaterSourcePerFlameLevel?.enabled===true?clone(gameplay.adjustWaterSourcePerFlameLevel):null,instruments:gameplay.adjustMusicInstruments?.enabled===true?clone(gameplay.adjustMusicInstruments):null,music:gameplay.adjustMusicBuff?.enabled===true?clone(gameplay.adjustMusicBuff):null,fall:gameplay.adjustFallDistance?.enabled===true?clone(gameplay.adjustFallDistance):null,slots:inventory.adjustSlotCount?.enabled===true?clone(inventory.adjustSlotCount):null};}
function schema(reflection,selected){
 if(!reflection||typeof reflection.version!=='string'||!Array.isArray(reflection.types))fail('Frische Reflection fehlt.');
 const types=reflection.types;
 function type(name){const found=types.filter(t=>t?.qualifiedName===name);if(found.length!==1)fail('Reflection-Typ fehlt oder ist mehrdeutig: '+name);return found[0];}
 function field(owner,name,primitive){const definition=type(owner),f=definition.structFields?.[name],value=f&&types[f.type];if(!f||!value||value.primitiveType!==primitive)fail('Unbekannter Zahlentyp für '+owner+'.'+name);return value;}
 const result={};
 if(selected.altar||selected.water||selected.instruments||selected.music){
  const t=type(BALANCE);if(t.primitiveType!=='STRUCT'||!Number.isInteger(t.qualifiedHash))fail('BalancingTable-Ressourcenstruktur fehlt.');result.balance=t;
  for(const name of [selected.altar?'altarsPerFlameLevel':null,selected.water?'waterSourcesPerFlameLevel':null].filter(Boolean)){const array=field(BALANCE,name,'BLOB_ARRAY'),inner=types[array.innerType];if(!inner||inner.primitiveType!=='UINT8'||inner.size!==1)fail(name+' ist kein uint8-Zählfeld.');}
  for(const name of [selected.instruments?'maximumInstrumentsCountedForComfort':null,selected.music?'maximumTotalMusicComfortBuff':null].filter(Boolean))if(field(BALANCE,name,'UINT32').size!==4)fail(name+' ist kein uint32-Zählfeld.');
 }
 if(selected.fall||selected.slots){const t=type(TEMPLATE);if(t.primitiveType!=='STRUCT'||!Number.isInteger(t.qualifiedHash))fail('TemplateResource-Ressourcenstruktur fehlt.');result.template=t;}
 if(selected.fall)for(const name of ['fallDamageStartDistance','fallDamageLethalDistance'])if(field(FALL,name,'FLOAT32').size!==4)fail('Fallschadengrenze ist kein float32-Feld.');
 if(selected.slots)for(const [type,names]of Object.entries(INVENTORY_FIELDS))for(const name of names)if(field(type,name,'UINT8').size!==1)fail(type+'.'+name+' ist kein uint8-Zählfeld.');
 return result;
}
function read(fs,file){try{return JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));}catch(e){fail('Ressource nicht lesbar: '+path.basename(file)+'. '+e.message);}}
function identity(doc,file,type){if(doc?.$type!==type.qualifiedName||!GUID.test(doc.$guid)||!Number.isInteger(doc.$part)||doc.$part<0||path.basename(file).toLowerCase()!==doc.$guid+'_'+type.qualifiedHash.toString(16).padStart(8,'0')+'_'+doc.$part+'.json')fail('Ressourcenidentität stimmt nicht: '+path.basename(file));}
function resources(fs,root,type){const dir=path.join(root,type.name);if(!fs.existsSync(dir))fail(type.name+'-Export fehlt.');return fs.readdirSync(dir).filter(n=>n.endsWith('.json')).sort().map(name=>{const file=path.join(dir,name),doc=read(fs,file);identity(doc,file,type);return {file,name,doc};});}
function expectedCounts(before,selected){const result={};
 if(selected.altar){const cap=integer(selected.altar.cap,1,32,'Altar-Höchstzahl');if(cap>16&&selected.altar.unlockSafeAltarCap!==true)fail('Mehr als 16 Altäre erfordert die experimentelle Freigabe.');if(!Array.isArray(before.altarsPerFlameLevel))fail('Altar-Stufentabelle fehlt.');result.altarsPerFlameLevel=before.altarsPerFlameLevel.map((v,index)=>index===0?integer(v,0,UINT8,'Altar-Vorstufenwert'):scaleCount(v,selected.altar.factor,UINT8,cap,'Altarzahl'));}
 if(selected.water){const cap=integer(selected.water.cap,1,UINT8,'Wasserquellen-Höchstzahl');if(!Array.isArray(before.waterSourcesPerFlameLevel))fail('Wasserquellen-Stufentabelle fehlt.');result.waterSourcesPerFlameLevel=before.waterSourcesPerFlameLevel.map(v=>scaleCount(v,selected.water.factor,UINT8,cap,'Wasserquellenzahl'));}
 if(selected.instruments)result.maximumInstrumentsCountedForComfort=musicCount(before.maximumInstrumentsCountedForComfort,selected.instruments.factorInstruments,'Berücksichtigte Instrumente');
 if(selected.music)result.maximumTotalMusicComfortBuff=musicCount(before.maximumTotalMusicComfortBuff,selected.music.factorBuff,'Musik-Komfortbonus');
 return result;
}
function nativeEqual(a,b){if(typeof a==='number'&&typeof b==='number')return a===b||(!Number.isInteger(a)||!Number.isInteger(b))&&Math.fround(a)===Math.fround(b);if(a===b)return true;if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;const keys=Object.keys(a);return keys.length===Object.keys(b).length&&keys.every(k=>own(b,k)&&nativeEqual(a[k],b[k]));}
function apply(ctx,inputRoot,outputRoot){
 const selected=options(ctx?.config||{}),summary={enabled:Object.values(selected).some(Boolean),build:null,selected,resources:[],types:[],filesChanged:0,fieldsChanged:0,gameplayVerified:false};if(!summary.enabled)return summary;
 if(path.resolve(inputRoot).toLowerCase()===path.resolve(outputRoot).toLowerCase())fail('Original- und Ausgabeordner müssen getrennt sein.');
 const checked=schema(ctx.reflection,selected),fs=ctx.fs||fsDefault,pending=[];summary.build=ctx.reflection.version;
 function current(row,type){const file=path.join(outputRoot,type.name,row.name),doc=fs.existsSync(file)?read(fs,file):clone(row.doc);identity(doc,file,type);if(doc.$guid!==row.doc.$guid||doc.$part!==row.doc.$part)fail('Ausgabeidentität verändert.');return {file,doc};}
 function queue(row,type,live,fields){let changed=0;for(const [key,value]of Object.entries(fields)){if(!nativeEqual(live.doc[key],value)){live.doc[key]=clone(value);changed++;}}if(changed){pending.push(live);summary.filesChanged++;summary.fieldsChanged+=changed;}summary.resources.push({kind:'counts',type:type.qualifiedName,file:row.name,guid:row.doc.$guid,part:row.doc.$part,before:Object.fromEntries(Object.keys(fields).map(k=>[k,clone(row.doc[k])])),expected:clone(fields)});}
 if(checked.balance){summary.types.push(BALANCE);const rows=resources(fs,inputRoot,checked.balance);if(!rows.length)fail('BalancingTable-Export ist leer.');for(const row of rows){const expected=expectedCounts(row.doc,selected);queue(row,checked.balance,current(row,checked.balance),expected);}}
 if(selected.fall){
  summary.types.push(TEMPLATE);let targets=0;
  for(const row of resources(fs,inputRoot,checked.template)){
   if(!Array.isArray(row.doc.components)||!row.doc.components.some(c=>c.$type==='keen::ecs::NetworkPlayerAttributes'))continue;
   const original=row.doc.components.filter(c=>c.$type===FALL);if(!original.length)continue;if(original.length!==1)fail('Mehrdeutige Fallschaden-Komponente in '+row.name);
   const before={start:original[0].$value?.fallDamageStartDistance,lethal:original[0].$value?.fallDamageLethalDistance},expected=fallPair(before,selected.fall,row.doc.name||row.name),live=current(row,checked.template),components=live.doc.components?.filter(c=>c.$type===FALL);
   if(components?.length!==1)fail('Fallschaden-Komponente fehlt in der Ausgabe: '+row.name);
   let changed=0;for(const [key,value]of Object.entries({fallDamageStartDistance:expected.start,fallDamageLethalDistance:expected.lethal}))if(!nativeEqual(components[0].$value[key],value)){components[0].$value[key]=value;changed++;}
   if(changed){pending.push(live);summary.filesChanged++;summary.fieldsChanged+=changed;}summary.resources.push({kind:'fall',type:TEMPLATE,file:row.name,guid:row.doc.$guid,part:row.doc.$part,before,expected});targets++;
  }
  if(!targets)fail('Keine eindeutigen Spieler-Fallschadengrenzen gefunden.');
 }
 if(selected.slots){
  if(!summary.types.includes(TEMPLATE))summary.types.push(TEMPLATE);integer(selected.slots.cap,1,UINT8,'Inventarplatz-Höchstzahl');number(selected.slots.factor,'Inventarplatz-Faktor');
  let targets=0;for(const row of resources(fs,inputRoot,checked.template)){
   // Recognize the audited vendor chest prototype names. Do not expand this setting to
   // player inventories, backpacks, stations, NPCs or unrelated containers.
   if(row.doc.family!=='Container'||!/^(?:Base_Chest_Player_Storage|Base_Container_Skinned_PlayerStorage|Prop_Decoration_T\d+_Storage_\d+(?:_Chest|_Magic)?)$/.test(row.doc.name||''))continue;
   const live=current(row,checked.template),before={},expected={};let changed=0;
   for(const [component,names]of Object.entries(INVENTORY_FIELDS)){
    const source=row.doc.components?.filter(c=>c.$type===component)||[],target=live.doc.components?.filter(c=>c.$type===component)||[];
    if(source.length>1||target.length>1)fail('Mehrdeutige Inventar-Komponente: '+row.name+' '+component);if(!source.length||!target.length)continue;
    for(const name of names){const initial=source[0].$value?.[name],currentValue=target[0].$value?.[name];
     integer(initial,0,UINT8,'Inventarplätze Ausgangswert');const raw=Math.min(initial*selected.slots.factor,selected.slots.cap),wanted=scaleCount(initial,selected.slots.factor,UINT8,selected.slots.cap,'Inventarplätze');
     if(currentValue!==initial&&!nativeEqual(currentValue,raw)&&currentValue!==wanted)fail('Konkurrierende Inventarplatz-Änderung in '+row.name+' '+name+'.');
     if(!before[component]){before[component]={};expected[component]={};}before[component][name]=initial;expected[component][name]=wanted;
     if(currentValue!==wanted){target[0].$value[name]=wanted;changed++;}
    }
   }
   if(!Object.keys(expected).length)continue;targets++;
   if(changed){pending.push(live);summary.filesChanged++;summary.fieldsChanged+=changed;}summary.resources.push({kind:'slots',type:TEMPLATE,file:row.name,guid:row.doc.$guid,part:row.doc.$part,before,expected});
  }
  if(!targets)fail('Keine belegten Lagerkisten-Inventare für die Platzanpassung gefunden.');
 }
 for(const entry of pending){fs.mkdirSync(path.dirname(entry.file),{recursive:true});fs.writeFileSync(entry.file,JSON.stringify(entry.doc,null,2),'utf8');if(typeof ctx.track==='function')ctx.track(entry.file,'settings-values-fix');}
 return summary;
}
function verify(summary,reflection,root,fs=fsDefault){
 if(summary?.enabled!==true)return {enabled:false,checked:0,gameplayVerified:false};
 if(summary.build!==reflection?.version||!Array.isArray(summary.resources))fail('Die Werte-Prüfliste passt nicht zur Spielversion.');const checked=schema(reflection,summary.selected);let count=0;
 for(const row of summary.resources){const type=row.type===BALANCE?checked.balance:checked.template;if(!type)fail('Unerwarteter Ressourcentyp in der Werte-Prüfliste.');const file=path.join(root,type.name,row.file),doc=read(fs,file);identity(doc,file,type);if(doc.$guid!==row.guid||doc.$part!==row.part)fail('Identität nach Archiv-Readback verändert: '+row.file);
  const expected=row.kind==='counts'?expectedCounts(row.before,summary.selected):row.kind==='fall'?fallPair(row.before,summary.selected.fall,row.file):row.kind==='slots'?Object.fromEntries(Object.entries(row.before).map(([component,fields])=>[component,Object.fromEntries(Object.entries(fields).map(([name,value])=>[name,scaleCount(value,summary.selected.slots.factor,UINT8,summary.selected.slots.cap,'Inventarplätze')]))])):fail('Unbekannter Prüflistentyp.');if(!nativeEqual(expected,row.expected))fail('Berechnung der Werte-Prüfliste stimmt nicht: '+row.file);
  if(row.kind==='counts'){for(const [key,value]of Object.entries(expected))if(!nativeEqual(doc[key],value))fail('Archivwert weicht vom gewählten Profil ab: '+row.file+' '+key);}
  else if(row.kind==='fall'){const all=doc.components?.filter(c=>c.$type===FALL);if(all?.length!==1||!nativeEqual(all[0].$value.fallDamageStartDistance,expected.start)||!nativeEqual(all[0].$value.fallDamageLethalDistance,expected.lethal))fail('Fallschadengrenzen nach Archiv-Readback abweichend: '+row.file);}
  else{for(const [component,fields]of Object.entries(expected)){const all=doc.components?.filter(c=>c.$type===component);if(all?.length!==1)fail('Inventarkomponente nach Archiv-Readback abweichend: '+row.file);for(const [name,value]of Object.entries(fields))if(all[0].$value[name]!==value)fail('Inventarplätze nach Archiv-Readback abweichend: '+row.file+' '+name);}}
  count++;
 }
 if((checked.balance||summary.selected.fall)&&!count)fail('Leere Werte-Prüfliste.');return {enabled:true,checked:count,gameplayVerified:false};
}
module.exports={apply,verify,scaleCount,musicCount,fallPair,expectedCounts,options,schema,UINT8,UINT32};
