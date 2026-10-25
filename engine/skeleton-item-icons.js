'use strict';
// The native UI requests UiTextureResource under each item's own GUID. An
// ItemInfo.iconImage reference does not register that required resource.
const nativeFs=require('fs'),path=require('path'),crypto=require('crypto');
const definitions=require('./skeleton-spell-definitions.json');
const customIcon=require('./custom-summon-icon');
const TYPE='keen::UiTextureResource',DIRECTORY='UiTextureResource',HASH='f9e86997';
const SOURCE='4147dce3-27fd-406f-9937-29b478a94046';
const fail=message=>{throw Error('Skelettzauber-Icons: '+message);};
const clone=value=>JSON.parse(JSON.stringify(value));
function canonical(value){if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';return JSON.stringify(value);}
const equal=(a,b)=>canonical(a)===canonical(b);
const digest=value=>crypto.createHash('sha256').update(canonical(value)).digest('hex');
const sourceTexture={data:{hash:{size:349552,hash0:4263327717,hash1:2711692084,hash2:845575656},category:{value:1171473418},bundleId:0,sortKey:0},debugName:'Ammo_T5_Spell_Skeleton_lvl28_Eternal_icon',size:{x:512,y:512},type:'Texture2D',format:'BC7_unorm_block',levelCount:10,isTiled:false,$type:TYPE,$guid:SOURCE,$part:0};
const filename=guid=>guid+'_'+HASH+'_0.json';
const CREATED_RESOURCES=definitions.items.map(item=>({guid:item.guid,type:TYPE,part:0,directory:DIRECTORY,file:filename(item.guid)}));
function assertSchema(reflection){
 if(typeof reflection?.version!=='string'||!reflection.version.startsWith('1273043|')||!Array.isArray(reflection.types))fail('Frische Reflection für Build 1273043 erforderlich.');
 const types=reflection.types,found=types.filter(t=>t.qualifiedName===TYPE);if(found.length!==1)fail('UI-Texturtyp fehlt oder ist mehrdeutig.');
 const t=found[0];if(t.primitiveType!=='STRUCT'||t.size!==56||t.qualifiedHash!==0xf9e86997)fail('UI-Texturschema geändert.');
 for(const [name,offset,target]of [['data',0,'keen::ResourceContentReference'],['debugName',32,'keen::string'],['size',40,'keen::uint2'],['type',48,'keen::TextureType'],['format',49,'keen::PixelFormat'],['levelCount',50,'keen::uint8'],['isTiled',51,'keen::bool']]){
  const f=t.structFields?.[name];if(!f||f.dataOffset!==offset||types[f.type]?.qualifiedName!==target)fail('UI-Texturfeld geändert: '+name);
 }
 if(definitions.sourceItem?.guid!==SOURCE||definitions.items?.length!==6||new Set(definitions.items.map(item=>item.guid)).size!==6)fail('Eigene Itemdefinitionen stimmen nicht.');
 return reflection.version;
}
function read(fs,file){try{return JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));}catch{fail('Texturressource fehlt oder ist unlesbar: '+path.basename(file));}}
function texture(fs,root,guid){const folder=path.join(root,DIRECTORY);if(!fs.existsSync(folder))fail('Frischer UI-Texturexport fehlt.');const names=fs.readdirSync(folder).filter(name=>name.startsWith(guid+'_')&&name.endsWith('.json'));if(names.length!==1||names[0]!==filename(guid))fail('Texturressource fehlt oder besitzt unerwartete Parts.');const doc=read(fs,path.join(folder,names[0]));if(doc.$guid!==guid||doc.$type!==TYPE||doc.$part!==0)fail('Texturidentität stimmt nicht.');return doc;}
function expected(source,item){if(item.key==='sabertooth')return customIcon.expectedTexture(item,source);const doc=clone(source);doc.$guid=item.guid;return doc;}
function within(a,b){const r=path.relative(a,b);return r===''||(!path.isAbsolute(r)&&r!=='..'&&!r.startsWith('..'+path.sep));}
function apply(ctx,inputRoot,outputRoot){
 const summary={enabled:ctx?.enabled===true,role:ctx?.role||'unknown',filesChanged:0,resources:[],createdResources:[],gameplayVerified:false};if(!summary.enabled)return summary;
 if(ctx.role!=='client')fail('Nur für den lokalen Spielclient-Test freigegeben.');summary.build=assertSchema(ctx.reflection);
 const fs=ctx.fs||nativeFs,input=path.resolve(inputRoot),output=path.resolve(outputRoot);if(within(input,output)||within(output,input))fail('Original und Ausgabe müssen getrennt sein.');
 const source=texture(fs,input,SOURCE);if(!equal(source,sourceTexture))fail('Die native Skelettsymbol-Vorlage hat sich geändert.');
 const pending=[];
 for(const item of definitions.items){
  if(fs.readdirSync(path.join(input,DIRECTORY)).some(name=>name.startsWith(item.guid+'_')))fail('Eigene Textur kollidiert mit der Ausgangsbasis.');
  const doc=expected(source,item),destination=path.join(output,DIRECTORY,filename(item.guid));
  if(fs.existsSync(destination)){if(!equal(read(fs,destination),doc))fail('Vorhandene eigene Textur widerspricht der nativen Vorlage.');}
  else pending.push({destination,doc});
  summary.resources.push({...CREATED_RESOURCES.find(row=>row.guid===item.guid),created:true,sha256:digest(doc)});
 }
 summary.createdResources=clone(CREATED_RESOURCES);summary.icons=6;summary.sourceSha256=digest(source);summary.content=clone(source.data.hash);
 for(const row of pending){fs.mkdirSync(path.dirname(row.destination),{recursive:true});fs.writeFileSync(row.destination,JSON.stringify(row.doc,null,2),'utf8');summary.filesChanged++;if(typeof ctx.track==='function')ctx.track(row.destination,'/','create');}
 return summary;
}
function verify(summary,reflection,root,fs=nativeFs){
 if(summary?.enabled!==true)return {enabled:false,checked:0,gameplayVerified:false};
 if(summary.role!=='client'||summary.build!==assertSchema(reflection)||summary.icons!==6||summary.sourceSha256!==digest(sourceTexture)||!equal(summary.content,sourceTexture.data.hash)||!equal(summary.createdResources,CREATED_RESOURCES)||summary.resources?.length!==6)fail('Icon-Prüfliste ist unvollständig.');
 const source=texture(fs,root,SOURCE);if(!equal(source,sourceTexture))fail('Native Symbolvorlage wurde verändert.');
 for(const item of definitions.items){const doc=texture(fs,root,item.guid),rows=summary.resources.filter(row=>row.guid===item.guid);if(rows.length!==1||!equal(rows[0],{...CREATED_RESOURCES.find(row=>row.guid===item.guid),created:true,sha256:digest(doc)})||!equal(doc,expected(source,item)))fail('Gepackte Item-Textur fehlt oder ist beschädigt: '+item.guid);}
 return {enabled:true,checked:6,icons:6,allItemsHaveTexture:true,customTigerIcon:true,nativeTemplatesPreserved:true,gameplayVerified:false};
}
function nativeContentProof(summary,sourceDirectory,stageDirectory,name){
 if(summary?.enabled!==true)return {enabled:false};
 if(!equal(summary.content,sourceTexture.data.hash))fail('Unbekannter nativer Bildinhalt.');
 const locate=require('./skeleton-spell-localization').contentLocation;
 const source=locate(path.join(sourceDirectory,name+'.kfc'),summary.content),staged=locate(path.join(stageDirectory,name+'.kfc'),summary.content);
 if(!equal(source,staged)||source.flags!==0||source.size!==349552)fail('Native Bildbytes sind nicht unverändert erreichbar.');
 const file=path.join(sourceDirectory,name+'_'+String(source.index).padStart(3,'0')+'.dat'),stat=nativeFs.lstatSync(file);
 if(!stat.isFile()||stat.isSymbolicLink()||stat.size<source.offset+source.size)fail('Natives Symbolarchiv fehlt oder ist unvollständig.');
 const bytes=Buffer.alloc(source.size),fd=nativeFs.openSync(file,'r');try{if(nativeFs.readSync(fd,bytes,0,bytes.length,source.offset)!==bytes.length)fail('Symbolbytes unvollständig.');}finally{nativeFs.closeSync(fd);}
 const sha256=crypto.createHash('sha256').update(bytes).digest('hex');
 if(sha256!=='87d036223fb6edff72cc99d364800bad82d3aa70766e6eba62a65f9026388fa5')fail('Die nativen Symbolbytes stimmen nicht mit der geprüften Vorlage überein.');
 return {enabled:true,verified:true,archive:path.basename(file),bytes:bytes.length,sha256,originalContentMappingPreserved:true};
}
function contentProof(summary,sourceDirectory,stageDirectory,name){
 if(summary?.enabled!==true)return {enabled:false};
 const native=nativeContentProof(summary,sourceDirectory,stageDirectory,name),custom=customIcon.contentProof(stageDirectory,name);
 if(!custom.verified)fail('Eigenes Tigerbild ist nicht geprüft.');
 return {...native,custom,verified:true};
}
module.exports={apply,verify,assertSchema,contentProof,nativeContentProof,CREATED_RESOURCES,sourceTexture,filename,digest};
