'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path'),os=require('os'),crypto=require('crypto');
const art=require('../engine/custom-drak-icons'),defs=require('../engine/native-item-texture-definitions.json'),localization=require('../engine/skeleton-spell-localization');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'ems-custom-drak-art-'));
let checks=0;const check=(value,message)=>{checks++;assert(value,message);},reject=(fn,pattern)=>{checks++;assert.throws(fn,pattern);};
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const rows=art.metadata(),configurations=art.configurations();
check(rows.length===4&&new Set(rows.map(r=>r.rawSha256)).size===4,'merchant, spear, chakram and mystic have separate images');
check(new Set(rows.map(r=>JSON.stringify(r.contentHash))).size===4,'four independent EMM content identities');
for(const row of rows){
 const raw=fs.readFileSync(path.join(art.DIRECTORY,row.rawFile));let transparent=0,visible=0;for(let i=3;i<raw.length;i+=4){if(raw[i]===0)transparent++;if(raw[i]>0)visible++;}
 check(raw.length===512*512*4&&hash(raw)===row.rawSha256&&transparent>1000&&visible>1000,'RGBA image preserves visible subject and transparent background: '+row.key);
 const native=defs.sources.find(s=>s.guid==='f1958762-1a8c-4bbc-9ebb-1176dfbb6020').document,item=defs.items.find(i=>i.guid===row.itemGuid),texture=art.expectedTexture(item,native);
 check(texture.$guid===row.itemGuid&&texture.debugName===row.debugName&&texture.format==='R8G8B8A8_unorm'&&texture.levelCount===1&&texture.size.x===512&&texture.size.y===512,'native image descriptor belongs to correct item: '+row.key);
 const configuration=configurations.find(c=>c.itemGuid===row.itemGuid);fs.writeFileSync(path.join(root,configuration.exportName+'.json'),JSON.stringify({guid:row.itemGuid,width:512,height:512,format:row.format,levelCount:1,debugName:row.debugName,hash:row.contentHash}));fs.copyFileSync(path.join(art.DIRECTORY,row.rawFile),path.join(root,configuration.exportName+'.rgba'));
}
check(art.exportProof(root).items.every(i=>i.verified&&i.alphaPreserved),'exported native bytes match all four reviewed raw assets');
const corrupt=path.join(root,'custom-drak-merchant.rgba'),bytes=fs.readFileSync(corrupt);bytes[0]^=1;fs.writeFileSync(corrupt,bytes);reject(()=>art.exportProof(root),/Bildbytes stimmen nicht/);
fs.unlinkSync(corrupt);check(art.exportProof(root,false).items.every(i=>i.metadataVerified&&!i.contentVerified),'pre-import descriptor inspection does not pretend image bytes already exist');reject(()=>art.exportProof(root),/ENOENT/);
const drakOnly={world:{enableDrakMerchant:{enabled:true}}},tags=localization.tagsForOptions(drakOnly);
check(tags.length===19&&tags.every(t=>t.de&&t.en),'Drak-only selection supplies names and ten dialogue lines without skeleton spells');
check(localization.tagsForOptions({}).length===0,'disabled custom features add no language tags');
const copied=path.join(root,'copied');fs.mkdirSync(copied);art.copyToMod(copied);check(rows.every(r=>hash(fs.readFileSync(path.join(copied,r.rawFile)))===r.rawSha256),'single shared writer receives all exact raw assets');
const metadataFile=path.join(root,'custom-drak-spear.json'),metadata=JSON.parse(fs.readFileSync(metadataFile));metadata.hash.hash0^=1;fs.writeFileSync(metadataFile,JSON.stringify(metadata));reject(()=>art.exportProof(root,false),/Texturmetadaten stimmen nicht/);
console.log(JSON.stringify({passed:true,checks,icons:rows.length,drakOnlyTags:tags.length,gameStarted:false,gameplayVerified:false}));
if(!path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep)||!path.basename(root).startsWith('ems-custom-drak-art-'))throw Error('Unsafe fixture cleanup path');
fs.rmSync(root,{recursive:true,force:true});
