'use strict';
// Item UI looks up UiTextureResource by the item's own GUID. Reuse exact
// native descriptors and payload mappings; no texture bytes are generated.
const nativeFs=require('fs'),path=require('path'),crypto=require('crypto');
const definitions=require('./native-item-texture-definitions.json');
const TYPE='keen::UiTextureResource',DIRECTORY='UiTextureResource',HASH='f9e86997';
const DEFINITIONS_SHA256='8caca6e97fdb7753c2eb6ad07a3c42d206f21b57bd15baf13175f2b5f4e52a9e';
const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
const digest=v=>crypto.createHash('sha256').update(canonical(v)).digest('hex'),clone=v=>JSON.parse(JSON.stringify(v)),equal=(a,b)=>canonical(a)===canonical(b);
const filename=guid=>guid+'_'+HASH+'_0.json';
const fail=message=>{throw Error('Eigene Item-Texturen: '+message);};
function assertDefinitions(){
 if(digest(definitions)!==DEFINITIONS_SHA256||definitions.format!==1||definitions.sourceBuild!=='1283531'||definitions.nativeBuild!==require('./build-contract').BUILD||definitions.sources.length!==8||definitions.items.length!==11)fail('Geprüfte native Texturdefinitionen verändert.');
 for(const s of definitions.sources)if(s.type!==TYPE||s.part!==0||s.directory!==DIRECTORY||s.file!==filename(s.guid)||s.document.$guid!==s.guid||s.document.$type!==TYPE||s.document.$part!==0||digest(s.document)!==s.sha256||!equal(s.document.data.hash,s.contentHash)||s.contentLocation.flags!==0||s.contentLocation.size!==s.contentHash.size)fail('Native Texturidentität verändert.');
 return definitions;
}
function selection(options={}){return {world:{enableDrakMerchant:{enabled:options.world?.enableDrakMerchant?.enabled===true},enableNightPlantCultivation:{enabled:options.world?.enableNightPlantCultivation?.enabled===true}}};}
function selectedItems(options){assertDefinitions();const selected=selection(options);return definitions.items.filter(item=>selected.world[item.optionKey]?.enabled);}
const resource=item=>({guid:item.guid,type:TYPE,part:0,directory:DIRECTORY,file:filename(item.guid)});
const CREATED_RESOURCES=definitions.items.map(resource);
const createdResources=options=>selectedItems(options).map(resource);
function assertSchema(reflection){
 require('./build-contract').assertReflection(reflection);
 const types=reflection.types,rows=types.filter(t=>t.qualifiedName===TYPE),t=rows[0];
 if(rows.length!==1||t.primitiveType!=='STRUCT'||t.size!==56||t.alignment!==8||t.fieldCount!==7||t.qualifiedHash!==0xf9e86997)fail('UI-Texturschema geändert.');
 for(const [name,offset,target]of [['data',0,'keen::ResourceContentReference'],['debugName',32,'keen::string'],['size',40,'keen::uint2'],['type',48,'keen::TextureType'],['format',49,'keen::PixelFormat'],['levelCount',50,'keen::uint8'],['isTiled',51,'keen::bool']]){const f=t.structFields?.[name];if(!f||f.dataOffset!==offset||types[f.type]?.qualifiedName!==target)fail('UI-Texturfeld geändert: '+name);}
 return reflection.version;
}
function separate(input,output){const rel=path.relative(path.resolve(input),path.resolve(output)),reverse=path.relative(path.resolve(output),path.resolve(input));if(!rel||![rel,reverse].every(r=>path.isAbsolute(r)||r==='..'||r.startsWith('..'+path.sep)))fail('Original und Ausgabe müssen getrennt sein.');}
function read(fs,file){try{return JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));}catch(error){fail('Erforderliche Ressource fehlt oder ist unlesbar: '+path.basename(file)+'. '+error.message);}}
function matching(fs,root,guid){const folder=path.join(root,DIRECTORY);return fs.existsSync(folder)?fs.readdirSync(folder).filter(n=>n.startsWith(guid+'_')&&n.endsWith('.json')):[];}
function sourceTexture(fs,root,s){const names=matching(fs,root,s.guid);if(names.length!==1||names[0]!==s.file)fail('Nativer Texturspender fehlt oder ist mehrdeutig: '+s.guid);const doc=read(fs,path.join(root,DIRECTORY,s.file));if(digest(doc)!==s.sha256)fail('Nativer Texturspender verändert: '+s.guid);return doc;}
function itemInfo(fs,root,item){const doc=read(fs,path.join(root,'ItemInfo',item.guid+'_b5ce8765_0.json'));if(doc.$type!=='keen::ItemInfo'||doc.$guid!==item.guid||doc.$part!==0||doc.objectId!==item.guid||doc.debugName!==item.debugName)fail('Eigener Gegenstand fehlt oder besitzt eine andere Identität: '+item.guid);return doc;}
function expected(item){const source=definitions.sources.find(s=>s.guid===item.sourceGuid);if(!source)fail('Unbekannter Texturspender.');const doc=clone(source.document);doc.$guid=item.guid;return doc;}
function checkedSummary(summary,options){
 if(summary?.enabled!==true)return [];
 const items=selectedItems(summary.options);if(summary.role!=='client'||summary.build!==require('./build-contract').BUILD||!items.length||summary.icons!==items.length||!equal(summary.createdResources,items.map(resource))||summary.resources?.length!==items.length||(options&&!equal(selection(options),summary.options)))fail('Textur-Prüfliste ist unvollständig.');
 const rows=items.map(item=>({...resource(item),created:true,sourceGuid:item.sourceGuid,sha256:digest(expected(item))}));
 if(!equal(rows,summary.resources))fail('Textur-Prüfidentitäten wurden verändert.');return items;
}
function apply(ctx,inputRoot,outputRoot){
 const options=ctx?.config||ctx?.options||{},items=selectedItems(options),summary={enabled:ctx?.role==='client'&&items.length>0,role:ctx?.role||'unknown',resources:[],createdResources:[],icons:0,filesChanged:0,gameplayVerified:false};
 if(!items.length||ctx?.role==='server')return summary;if(ctx?.role!=='client')fail('Getrennte Clientrolle erforderlich.');
 const fs=ctx.fs||nativeFs,input=path.resolve(inputRoot),output=path.resolve(outputRoot);separate(input,output);summary.build=assertSchema(ctx.reflection);summary.options=selection(options);
 const sources=new Set(items.map(i=>i.sourceGuid));for(const s of definitions.sources.filter(s=>sources.has(s.guid)))sourceTexture(fs,input,s);
 const pending=[];
 for(const item of items){itemInfo(fs,output,item);if(matching(fs,input,item.guid).length)fail('Eigene Item-Textur bereits in der Ausgangsbasis: '+item.guid);const doc=expected(item),names=matching(fs,output,item.guid),file=path.join(output,DIRECTORY,filename(item.guid));if(names.length&&(names.length!==1||names[0]!==filename(item.guid)||!equal(read(fs,file),doc)))fail('Andere Ausgabe belegt die Item-Textur: '+item.guid);summary.resources.push({...resource(item),created:true,sourceGuid:item.sourceGuid,sha256:digest(doc)});if(!names.length)pending.push({file,doc});}
 summary.createdResources=items.map(resource);summary.icons=items.length;
 for(const row of pending){fs.mkdirSync(path.dirname(row.file),{recursive:true});fs.writeFileSync(row.file,JSON.stringify(row.doc,null,2));ctx.track?.(row.file,'data.hash','create');}summary.filesChanged=pending.length;return summary;
}
function verify({summary,reflection,verifyRoot,options,fs=nativeFs}){
 if(summary?.enabled!==true){if(selectedItems(options).length)fail('Erforderliche Item-Texturprüfung fehlt.');return {enabled:false,checked:0};}assertSchema(reflection);const items=checkedSummary(summary,options),sources=new Set(items.map(i=>i.sourceGuid));
 for(const s of definitions.sources.filter(s=>sources.has(s.guid)))sourceTexture(fs,verifyRoot,s);
 for(const item of items){itemInfo(fs,verifyRoot,item);const names=matching(fs,verifyRoot,item.guid);if(names.length!==1||names[0]!==filename(item.guid)||!equal(read(fs,path.join(verifyRoot,DIRECTORY,names[0])),expected(item)))fail('Angeforderte Item-Textur fehlt oder ist nach Rücklesen verändert: '+item.guid);}
 return {enabled:true,checked:items.length,allItemsHaveTexture:true,nativeDonorsPreserved:true,gameplayVerified:false};
}
function contentProof(summary,sourceDirectory,stageDirectory,name='enshrouded'){
 if(summary?.enabled!==true)return {enabled:false};const items=checkedSummary(summary),sources=new Set(items.map(i=>i.sourceGuid)),locate=require('./skeleton-spell-localization').contentLocation,payloads=[];
 for(const s of definitions.sources.filter(s=>sources.has(s.guid))){const before=locate(path.join(sourceDirectory,name+'.kfc'),s.contentHash),after=locate(path.join(stageDirectory,name+'.kfc'),s.contentHash);if(!equal(before,s.contentLocation)||!equal(after,before))fail('Nativer Bildinhalt ist nicht unverändert erreichbar: '+s.guid);const archive=name+'_'+String(before.index).padStart(3,'0')+'.dat',file=path.join(sourceDirectory,archive),stat=nativeFs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size<before.offset+before.size)fail('Natives Symbolarchiv fehlt oder ist unvollständig: '+archive);const bytes=Buffer.alloc(before.size),fd=nativeFs.openSync(file,'r');try{if(nativeFs.readSync(fd,bytes,0,bytes.length,before.offset)!==bytes.length)fail('Native Symbolbytes unvollständig.');}finally{nativeFs.closeSync(fd);}const sha256=crypto.createHash('sha256').update(bytes).digest('hex');if(sha256!==s.payloadSha256)fail('Native Symbolbytes verändert: '+s.guid);payloads.push({sourceGuid:s.guid,archive,sourcePath:file,bytes:bytes.length,sha256,contentMappingPreserved:true});}
 return {enabled:true,verified:true,icons:items.length,sources:payloads.length,payloads,gameplayVerified:false};
}
// Audit the actual created ItemInfo inventory, including other feature producers.
// It must not depend on this module's fixed eleven-item catalog.
function auditCreatedItems(input,output,verifyRoot=null,fs=nativeFs){
 const folder=path.join(output,'ItemInfo'),guids=[];
 if(!fs.existsSync(folder))return {checked:0,newItemGuids:[],allItemsHaveTexture:true};
 for(const name of fs.readdirSync(folder).filter(n=>n.endsWith('.json')).sort()){
  const item=read(fs,path.join(folder,name));
  if(item.$type!=='keen::ItemInfo'||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(item.$guid||'')||item.$part!==0||name!==item.$guid+'_b5ce8765_0.json')fail('Unbekannte ItemInfo-Ausgabeidentität.');
  if(fs.existsSync(path.join(input,'ItemInfo',name)))continue;
  const relative=path.join(DIRECTORY,filename(item.$guid)),roots=verifyRoot?[verifyRoot]:[output,input],root=roots.find(r=>fs.existsSync(path.join(r,relative)));
  if(!root)fail('Neu erstellter Gegenstand hat keine eigene UiTextureResource'+(verifyRoot?' nach Archiv-Rücklesen':'')+': '+item.$guid);
  const texture=read(fs,path.join(root,relative)),hash=texture.data?.hash;
  if(texture.$type!==TYPE||texture.$guid!==item.$guid||texture.$part!==0||!hash||!['size','hash0','hash1','hash2'].every(k=>Number.isInteger(hash[k])&&hash[k]>=0&&hash[k]<=0xffffffff)||hash.size<1||!Number.isInteger(texture.size?.x)||texture.size.x<1||!Number.isInteger(texture.size?.y)||texture.size.y<1||typeof texture.format!=='string'||!texture.format||!Number.isInteger(texture.levelCount)||texture.levelCount<1)fail('Eigene UiTextureResource besitzt keine gültige Bildidentität: '+item.$guid);
  guids.push(item.$guid);
 }
 return {checked:guids.length,newItemGuids:guids,allItemsHaveTexture:true,readback:!!verifyRoot};
}
module.exports={apply,verify,contentProof,auditCreatedItems,CREATED_RESOURCES,createdResources,selectedItems,assertSchema,assertDefinitions,DEFINITIONS_SHA256,TYPE,DIRECTORY,HASH,filename,expected,digest};
