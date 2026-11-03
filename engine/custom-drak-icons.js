'use strict';
// Four original generated Drak illustrations, imported by the shared language/
// icon writer. Fixed RGBA bytes and EMM-derived content identities only.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const DIRECTORY=path.join(__dirname,'assets','drak-icons');
const EMM_SHA='b1133f6b8ea7000596cc7710901bd8307b48165b0e650c0487a611d90ea49305';
const SOURCE='f1958762-1a8c-4bbc-9ebb-1176dfbb6020',SOURCE_SHA='407dbbbcf5ab24820fa6715ed6f9fbe396104e4fd9e0812eb77c1c8cf4d17bc3';
const PINS=[
 {key:'merchant',definitionKey:'merchant',itemGuid:'10c84674-9497-5eb2-a8fe-a5b7fb4a7ec6',debugName:'EMS_Drak_Craftsman_icon',rawSha256:'39b55951e800cf82b4b5b0903b6b91339e33f9a7c7319252c377befe7ae40dfe',contentHash:{size:1048576,hash0:1405427821,hash1:2138078578,hash2:44613709}},
 {key:'spear',definitionKey:'melee',itemGuid:'00ccd737-8fa1-58f9-a25f-17ae21373e4e',debugName:'EMS_Summon_Drak_melee_icon',rawSha256:'37a6ee867147da342f9d6c0b308d1fbd415e3c37a25b2daa4e678527738cc65f',contentHash:{size:1048576,hash0:2410775628,hash1:1579936025,hash2:1586878688}},
 {key:'chakram',definitionKey:'ranger',itemGuid:'e16b5fa4-f91d-5195-9c00-cfe52b8600d5',debugName:'EMS_Summon_Drak_ranger_icon',rawSha256:'aeadb3cf49525fe7cbe8faae0c0357cd64b0902d4a75682e846430754647795b',contentHash:{size:1048576,hash0:4201232624,hash1:3966130767,hash2:2699181671}},
 {key:'mystic',definitionKey:'mage',itemGuid:'93fcf2df-d07c-59ee-9192-fd638b77dab2',debugName:'EMS_Summon_Drak_mage_icon',rawSha256:'29c600ce2ba62b3dc8e3ea3887992a329b3455cb4671061aad5a09a22e163564',contentHash:{size:1048576,hash0:1383072000,hash1:114927761,hash2:2840422156}}
];
const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
const equal=(a,b)=>canonical(a)===canonical(b),sha=b=>crypto.createHash('sha256').update(b).digest('hex'),clone=v=>JSON.parse(JSON.stringify(v));
const fail=s=>{throw Error('Eigene Drak-Symbole: '+s);};
function hasItem(item){return PINS.some(p=>p.itemGuid===item?.guid);}
function metadata(){
 const definitions=require('./drak-definitions.json');
 return PINS.map(pin=>{
  const file=path.join(DIRECTORY,'drak-'+pin.key+'.json'),d=JSON.parse(fs.readFileSync(file,'utf8')),item=definitions.items.find(i=>i.key===pin.definitionKey);
  if(!item||item.guid!==pin.itemGuid||item.debugName+'_icon'!==pin.debugName||d.formatVersion!==1||d.key!==pin.key||d.definitionKey!==pin.definitionKey||d.itemGuid!==pin.itemGuid||d.debugName!==pin.debugName||d.width!==512||d.height!==512||d.format!=='R8G8B8A8_unorm'||d.levelCount!==1||d.rawFile!=='drak-'+pin.key+'.rgba'||d.rawSize!==1048576||d.rawSha256!==pin.rawSha256||!equal(d.contentHash,pin.contentHash)||d.bootstrapEmmSha256!==EMM_SHA)fail('Unbekannte feste Bildmetadaten: '+pin.key);
  const raw=fs.readFileSync(path.join(DIRECTORY,d.rawFile));if(raw.length!==1048576||sha(raw)!==pin.rawSha256)fail('Geprüfte RGBA-Bildbytes verändert: '+pin.key);
  return d;
 });
}
function configurations(required=true){return metadata().map(d=>({key:d.key,itemGuid:d.itemGuid,hash:clone(d.contentHash),width:512,height:512,format:d.format,levelCount:1,debugName:d.debugName,rawSize:d.rawSize,rawFile:d.rawFile,exportName:'custom-drak-'+d.key,required}));}
function expectedTexture(item,source){
 const d=metadata().find(d=>d.itemGuid===item?.guid);
 if(!d||source?.$type!=='keen::UiTextureResource'||source.$guid!==SOURCE||source.$part!==0||sha(canonical(source))!==SOURCE_SHA)fail('Unbekannte Item-/Texturbasis.');
 const out=clone(source);out.$guid=d.itemGuid;out.data.hash=clone(d.contentHash);out.debugName=d.debugName;out.size={x:512,y:512};out.type='Texture2D';out.format=d.format;out.levelCount=1;out.isTiled=false;return out;
}
function copyToMod(src){for(const d of metadata())fs.copyFileSync(path.join(DIRECTORY,d.rawFile),path.join(src,d.rawFile));}
function exportProof(root,required=true){
 const items=metadata().map(d=>{
  const file=path.join(root,'custom-drak-'+d.key+'.json');if(!fs.existsSync(file))fail('Textur-Exportnachweis fehlt: '+d.key);
  const v=JSON.parse(fs.readFileSync(file,'utf8'));
  if(v.guid!==d.itemGuid||v.width!==512||v.height!==512||v.format!==d.format||v.levelCount!==1||v.debugName!==d.debugName||!equal(v.hash,d.contentHash))fail('Gepackte Texturmetadaten stimmen nicht: '+d.key);
  if(!required)return {key:d.key,itemGuid:d.itemGuid,metadataVerified:true,contentVerified:false};
  const raw=fs.readFileSync(path.join(root,'custom-drak-'+d.key+'.rgba'));if(raw.length!==d.rawSize||sha(raw)!==d.rawSha256)fail('Zurückgelesene Bildbytes stimmen nicht: '+d.key);
  return {key:d.key,itemGuid:d.itemGuid,verified:true,contentHash:clone(d.contentHash),bytes:raw.length,sha256:d.rawSha256,format:d.format,levelCount:1,alphaPreserved:true};
 });
 return {enabled:true,icons:4,verified:required,items,gameplayVerified:false};
}
function contentProof(stageDirectory,name='enshrouded'){
 if(!/^enshrouded(?:_server)?$/.test(name))fail('Unbekannter Archivname.');
 const locate=require('./skeleton-spell-localization').contentLocation;
 const items=metadata().map(d=>{
  const loc=locate(path.join(stageDirectory,name+'.kfc'),d.contentHash),file=path.join(stageDirectory,name+'_'+String(loc.index).padStart(3,'0')+'.dat'),stat=fs.lstatSync(file);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size<loc.offset+d.rawSize)fail('Bildarchiv fehlt oder ist unvollständig: '+d.key);
  const bytes=Buffer.alloc(d.rawSize),fd=fs.openSync(file,'r');try{if(fs.readSync(fd,bytes,0,bytes.length,loc.offset)!==bytes.length)fail('Bildarchiv ist unvollständig.');}finally{fs.closeSync(fd);}
  if(sha(bytes)!==d.rawSha256)fail('Gepackte Bildbytes sind beschädigt: '+d.key);
  return {key:d.key,itemGuid:d.itemGuid,archive:path.basename(file),offset:loc.offset,bytes:bytes.length,sha256:d.rawSha256,contentHash:clone(d.contentHash),format:d.format,levelCount:1};
 });
 return {enabled:true,verified:true,icons:4,items,gameplayVerified:false};
}
module.exports={metadata,configurations,expectedTexture,copyToMod,exportProof,contentProof,hasItem,DIRECTORY,EMM_SHA};
