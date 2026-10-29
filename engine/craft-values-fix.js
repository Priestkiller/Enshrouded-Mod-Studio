'use strict';
// Normalize only original recipe quantities/times from their fresh preimages.
// Keep other processors' costs, unlocks, metadata and added recipe identities.
const fsDefault=require('fs'),path=require('path');
const TYPE='keen::RecipeRegistryResource',MAX_COUNT=0xffffffff,MAX_SAFE_TIME=Number.MAX_SAFE_INTEGER;
const clone=value=>JSON.parse(JSON.stringify(value));
function fail(message){throw Error('Herstellungswerte: '+message);}
function type(reflection,name){const result=reflection?.types?.find(t=>t.qualifiedName===name);if(!result)fail('Frische Typbeschreibung fehlt: '+name);return result;}
function fieldType(reflection,owner,key){const f=type(reflection,owner).structFields?.[key],result=Number.isInteger(f?.type)?reflection.types[f.type]:null;if(!result)fail('Frische Feldbeschreibung fehlt: '+owner+'.'+key);return result;}
function assertSchema(reflection,quantity,time){
 if(quantity){const t=fieldType(reflection,'keen::RecipeItemStackResource','count');if(t.primitiveType!=='UINT32'||t.size!==4)fail('Rezeptausgabe verwendet nicht das geprüfte uint32-Feld.');}
 if(time){if(fieldType(reflection,'keen::RecipeInfo','craftingDuration').qualifiedName!=='keen::Time')fail('Unbekanntes Zeitfeld im Herstellungsrezept.');const t=fieldType(reflection,'keen::Time','value');if(t.primitiveType!=='SINT64'||t.size!==8)fail('Rezeptdauer verwendet nicht das geprüfte sint64-Feld.');}
}
function separate(input,output){for(const [a,b]of [[input,output],[output,input]]){const r=path.relative(a,b);if(!r||r!=='..'&&!r.startsWith('..'+path.sep)&&!path.isAbsolute(r))fail('Original und Ausgabe müssen getrennte Ordner sein.');}}
function recipeKey(recipe){if(typeof recipe.recipeGuid!=='string'||!recipe.recipeGuid)fail('Rezept ohne stabile GUID.');return recipe.recipeGuid;}
function factor(option,key,label){const value=option?.[key];if(typeof value!=='number'||!Number.isFinite(value)||value<=0)fail('Ungültiger Faktor: '+label);return value;}
function apply(ctx,inputRoot,outputRoot){
 const q=ctx?.config?.gameplay?.enableCraftOutputMultiplier,t=ctx?.config?.gameplay?.enableAdjustCraftingTime,quantity=q?.enabled===true,time=t?.enabled===true;
 const summary={enabled:quantity||time,quantityEnabled:quantity,timeEnabled:time,filesChecked:0,filesChanged:0,outputsChecked:0,durationsChecked:0,newRecipesPreserved:0,nativeCountMaximum:MAX_COUNT,nativeTimeMaximum:'9223372036854775807',exactTimeMaximum:MAX_SAFE_TIME,proofs:[],gameplayVerified:false};
 if(!summary.enabled)return summary;
 const quantityFactor=quantity?factor(q,'globalMultiplier','Stückzahl'):1,timeFactor=time?factor(t,'factor','Dauer'):1;
 summary.quantityFactor=quantityFactor;summary.timeFactor=timeFactor;
 assertSchema(ctx.reflection,quantity,time);
 const fs=ctx.fs||fsDefault,input=path.resolve(inputRoot),output=path.resolve(outputRoot);separate(input,output);
 const folder=path.join(input,'RecipeRegistryResource');if(!fs.existsSync(folder))fail('Frischer RecipeRegistryResource-Export fehlt.');
 const pending=[];
 for(const name of fs.readdirSync(folder).filter(n=>n.endsWith('.json')).sort()){
  const original=JSON.parse(fs.readFileSync(path.join(folder,name),'utf8')),destination=path.join(output,'RecipeRegistryResource',name);
  const current=fs.existsSync(destination)?JSON.parse(fs.readFileSync(destination,'utf8')):clone(original);
  if(original.$type!==TYPE||current.$type!==TYPE||current.$guid!==original.$guid||current.$part!==original.$part||!Array.isArray(original.recipes)||!Array.isArray(current.recipes))fail('Rezeptkatalog oder Identität wurde verändert: '+name);
  summary.filesChecked++;const ids=new Map();for(const r of current.recipes){const key=recipeKey(r);if(ids.has(key))fail('Doppelte Rezept-GUID: '+key);ids.set(key,r);}
  const originals=new Set(),before=JSON.stringify(current);
  for(const base of original.recipes){const key=recipeKey(base),r=ids.get(key);if(originals.has(key)||!r)fail('Originalrezept fehlt oder ist doppelt: '+key);originals.add(key);const label=String(base.debugName||key).slice(0,160);
   if(quantity){if(!Array.isArray(base.output)||!Array.isArray(r.output)||base.output.length!==r.output.length)fail('Ausgabe-Inventar des Originalrezepts wurde verändert: '+label);
    for(let i=0;i<base.output.length;i++){const b=base.output[i],a=r.output[i];if(b.itemRef!==a.itemRef||b.item?.value!==a.item?.value)fail('Ausgabe-Itemidentität wurde verändert: '+label);if(!Number.isInteger(b.count)||b.count<0||b.count>MAX_COUNT)fail('Ungültige ursprüngliche Stückzahl: '+label);if(b.count===0)continue;
     const expected=Math.max(1,Math.round(b.count*quantityFactor));if(!Number.isSafeInteger(expected)||expected>MAX_COUNT)fail('Stückzahl für '+label+' überschreitet uint32 (maximal '+MAX_COUNT+'). Kleinen Mengenfaktor wählen.');
     a.count=expected;summary.outputsChecked++;summary.proofs.push({file:name,kind:'output',recipeGuid:key,debugName:label,outputIndex:i,before:b.count,expected,written:a.count});
    }
   }
   if(time&&base.craftingDuration?.value>0){const initial=base.craftingDuration.value;if(!Number.isSafeInteger(initial))fail('Ursprüngliche Rezeptdauer ist nicht exakt darstellbar: '+label);const expected=Math.round(initial*timeFactor);
    if(!Number.isSafeInteger(expected)||expected<0)fail('Rezeptdauer für '+label+' überschreitet die exakt darstellbare Nanosekundenzahl. Kleineren Zeitfaktor wählen.');if(!r.craftingDuration||typeof r.craftingDuration!=='object')fail('Dauer des Originalrezepts fehlt: '+label);
    r.craftingDuration.value=expected;summary.durationsChecked++;summary.proofs.push({file:name,kind:'duration',recipeGuid:key,debugName:label,before:initial,expected,written:r.craftingDuration.value});
   }
  }
  summary.newRecipesPreserved+=current.recipes.filter(r=>!originals.has(recipeKey(r))).length;
  if(JSON.stringify(current)!==before)pending.push({destination,doc:current});
 }
 if(!summary.filesChecked)fail('Frischer Rezeptkatalog ist leer.');
 // Validate every result before writing any resource, preserving prior outputs
 // when a later recipe exposes an unsupported count/time or identity conflict.
 for(const row of pending){fs.mkdirSync(path.dirname(row.destination),{recursive:true});fs.writeFileSync(row.destination,JSON.stringify(row.doc,null,2));summary.filesChanged++;}
 return summary;
}
function verify(summary,verifyRoot,ctx={}){
 if(!summary?.enabled)return {enabled:false,checked:0,gameplayVerified:false};
 const fs=ctx.fs||fsDefault,cache=new Map();let checked=0;
 for(const proof of summary.proofs){
  if(typeof proof.file!=='string'||path.basename(proof.file)!==proof.file||!proof.file.endsWith('.json'))fail('Ungültiger lokaler Rezept-Prüfnachweis.');
  if(!cache.has(proof.file)){const doc=JSON.parse(fs.readFileSync(path.join(verifyRoot,'RecipeRegistryResource',proof.file),'utf8'));if(doc.$type!==TYPE||!Array.isArray(doc.recipes))fail('Erneut gelesener Rezeptkatalog fehlt.');const recipes=new Map();for(const r of doc.recipes){const key=recipeKey(r);if(recipes.has(key))fail('Doppelte Rezept-GUID im erneut gelesenen Archiv.');recipes.set(key,r);}cache.set(proof.file,recipes);}
  const recipe=cache.get(proof.file).get(proof.recipeGuid),actual=proof.kind==='output'?recipe?.output?.[proof.outputIndex]?.count:proof.kind==='duration'?recipe?.craftingDuration?.value:undefined;
  if(actual!==proof.expected||!Number.isSafeInteger(actual))fail('Archivprüfung fehlgeschlagen: '+proof.debugName+' ('+proof.kind+'), erwartet '+proof.expected+', gelesen '+actual+'.');checked++;
 }
 return {enabled:true,checked,files:cache.size,gameplayVerified:false};
}
module.exports={apply,verify,assertSchema,MAX_COUNT,MAX_SAFE_TIME};
