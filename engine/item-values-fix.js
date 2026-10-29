'use strict';
// Own-source native integer fields; values are always derived from original JSON.
const fsDefault=require('fs'),path=require('path');
const UINT32=0xffffffff,ITEM='keen::ItemInfo',BALANCE='keen::BalancingTable';
const clone=v=>JSON.parse(JSON.stringify(v));
function fail(message){throw Error('Gegenstandswerte: '+message);}
function uint(value,name){if(!Number.isInteger(value)||value<0||value>UINT32)fail(name+' muss eine ganze Zahl von 0 bis '+UINT32+' sein.');return value;}
function woodValue(before,factor){uint(before,'Ursprünglicher Holzschaden');if(typeof factor!=='number'||!Number.isFinite(factor)||factor<=0)fail('Holzschaden-Faktor muss positiv und endlich sein.');const value=Math.round(before*factor);return uint(value,'Berechneter Holzschaden');}
function selections(config){return {wood:config?.gameplay?.adjustWoodDamage?.enabled===true?config.gameplay.adjustWoodDamage:null,level:config?.gameplay?.adjustItemMaxLevel?.enabled===true?config.gameplay.adjustItemMaxLevel:null};}
function schema(reflection,selected){
 const types=reflection?.types;if(!Array.isArray(types))fail('Frische Reflection fehlt.');
 function type(name){const rows=types.filter(t=>t.qualifiedName===name);if(rows.length!==1)fail('Reflection-Typ fehlt oder ist mehrdeutig: '+name);return rows[0];}
 function integerField(owner,name){const f=type(owner).structFields?.[name],primitive=f&&types[f.type];if(!primitive||primitive.primitiveType!=='UINT32'||primitive.size!==4)fail('Unbekannter UINT32-Feldtyp: '+owner+'.'+name);}
 if(selected.wood)integerField('keen::impact::DamageDistribution','woodDamage');
 if(selected.level){integerField('keen::ItemLevelRange','minLevel');integerField('keen::ItemLevelRange','maxLevel');integerField(BALANCE,'itemLevelCap');}
 return {item:type(ITEM),balance:selected.level?type(BALANCE):null};
}
function apply(ctx,input,output){
 const selected=selections(ctx.config),summary={enabled:!!(selected.wood||selected.level),woodTargets:0,levelTargets:0,balanceTargets:0,resources:[],gameplayVerified:false};if(!summary.enabled)return summary;
 if(selected.wood)woodValue(0,selected.wood.factor);
 if(selected.level&&(uint(selected.level.value,'Gegenstandsstufe')<1))fail('Gegenstandsstufe muss mindestens 1 sein.');
 const fs=ctx.fs||fsDefault,checked=schema(ctx.reflection,selected),pending=[];
 function read(file){return JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));}
 function rows(type){const folder=path.join(input,type.name);if(!fs.existsSync(folder))fail('Originalexport fehlt: '+type.name);return fs.readdirSync(folder).filter(n=>n.endsWith('.json')).sort().map(name=>{const file=path.join(folder,name),before=read(file);if(before.$type!==type.qualifiedName||typeof before.$guid!=='string'||!Number.isInteger(before.$part)||name.toLowerCase()!==(before.$guid+'_'+type.qualifiedHash.toString(16).padStart(8,'0')+'_'+before.$part+'.json').toLowerCase())fail('Ressourcenidentität passt nicht zum Originalexport: '+name);const destination=path.join(output,type.name,name),current=fs.existsSync(destination)?read(destination):clone(before);if(current.$type!==before.$type||current.$guid!==before.$guid||current.$part!==before.$part)fail('Ausgabeidentität stimmt nicht: '+name);return {file:destination,relative:path.join(type.name,name),before,current,edits:[]};});}
 for(const row of rows(checked.item)){
  const {before,current}=row;
  if(selected.wood&&before.category==='Tools'&&before.equipment?.slot==='Tool'&&/^Tool_.*_Axe_/.test(before.debugName||'')){
   const value=woodValue(before.damageSetup?.distribution?.woodDamage,selected.wood.factor);
   if(!current.damageSetup?.distribution)fail('Holzschaden-Ausgabestruktur fehlt.');current.damageSetup.distribution.woodDamage=value;row.edits.push({path:['damageSetup','distribution','woodDamage'],value});summary.woodTargets++;
  }
  if(selected.level&&before.itemLevelRange){
   const range=before.itemLevelRange;uint(range.minLevel,'Ursprüngliche Mindeststufe');uint(range.maxLevel,'Ursprüngliche Höchststufe');
   if(range.minLevel>0||range.maxLevel>0){if(selected.level.value<range.minLevel)fail('Gewünschte Höchststufe '+selected.level.value+' liegt unter der ursprünglichen Mindeststufe '+range.minLevel+' von '+before.debugName+'. Höhere ganze Stufe wählen.');if(!current.itemLevelRange)fail('Gegenstandsstufen-Ausgabestruktur fehlt.');current.itemLevelRange.maxLevel=selected.level.value;row.edits.push({path:['itemLevelRange','maxLevel'],value:selected.level.value});summary.levelTargets++;}
  }
  if(row.edits.length)pending.push(row);
 }
 if(selected.level)for(const row of rows(checked.balance)){uint(row.before.itemLevelCap,'Ursprüngliche globale Gegenstandsstufe');row.current.itemLevelCap=selected.level.value;row.edits.push({path:['itemLevelCap'],value:selected.level.value});pending.push(row);summary.balanceTargets++;}
 if(selected.wood&&summary.woodTargets===0)fail('Keine bestätigten Axt-Holzschadenwerte im Originalexport.');
 if(selected.level&&(!summary.levelTargets||summary.balanceTargets!==1))fail('Gegenstandsstufen oder eindeutige globale Stufentabelle fehlen im Originalexport.');
 // Validate every selected result first; reject bad profiles without partial writes.
 for(const row of pending){fs.mkdirSync(path.dirname(row.file),{recursive:true});fs.writeFileSync(row.file,JSON.stringify(row.current,null,2));summary.resources.push({file:row.relative,edits:row.edits});if(typeof ctx.track==='function')for(const edit of row.edits)ctx.track(row.file,edit.path.join('.'));}
 return summary;
}
function verify({fs=fsDefault,verifyRoot,summary}){if(!summary?.enabled)return {enabled:false};let fields=0;for(const row of summary.resources){const doc=JSON.parse(fs.readFileSync(path.join(verifyRoot,row.file),'utf8').replace(/^\uFEFF/,''));for(const edit of row.edits){const actual=edit.path.reduce((o,k)=>o?.[k],doc);if(actual!==edit.value)fail('Wert nach Archiv-Rücklesen abweichend: '+row.file+' '+edit.path.join('.'));fields++;}}return {enabled:true,resources:summary.resources.length,fields,gameplayVerified:false};}
module.exports={apply,verify,woodValue,selections,schema,UINT32};
