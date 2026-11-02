'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path'),os=require('os');
const icons=require('../engine/native-item-textures'),defs=require('../engine/native-item-texture-definitions.json');
const plants=require('../engine/night-plants'),drak=require('../engine/drak-merchant'),backend=require('../engine/studio-backend');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'ems-native-item-textures-'));
const options={world:{enableSkeletonSummoningSpells:{enabled:false},enableDrakMerchant:{enabled:true},enableNightPlantCultivation:{enabled:true}}};
const names=['keen::ResourceContentReference','keen::string','keen::uint2','keen::TextureType','keen::PixelFormat','keen::uint8','keen::bool'];
const fields=['data','debugName','size','type','format','levelCount','isTiled'],offsets=[0,32,40,48,49,50,51];
const reflection={version:require('../engine/build-contract').BUILD,types:[{qualifiedName:icons.TYPE,primitiveType:'STRUCT',size:56,alignment:8,fieldCount:7,qualifiedHash:0xf9e86997,structFields:Object.fromEntries(fields.map((k,i)=>[k,{dataOffset:offsets[i],type:i+1}]))},...names.map(qualifiedName=>({qualifiedName}))]};
let checks=0;const check=(value,message)=>{checks++;assert(value,message);},reject=(fn,pattern)=>{checks++;assert.throws(fn,pattern);};
const write=(root,relative,doc)=>{const f=path.join(root,relative);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,JSON.stringify(doc));};
function setup(label,selected=options){const input=path.join(root,label,'input'),output=path.join(root,label,'output');fs.mkdirSync(input,{recursive:true});fs.mkdirSync(output,{recursive:true});for(const s of defs.sources)write(input,path.join(s.directory,s.file),s.document);for(const doc of [...plants.buildCreatedResources(selected),...drak.buildCreatedResources(selected)].filter(d=>d.$type==='keen::ItemInfo'))write(output,path.join('ItemInfo',doc.$guid+'_b5ce8765_0.json'),doc);return {input,output,selected};}
function apply(f){return icons.apply({role:'client',reflection,options:f.selected},f.input,f.output);}
const fixture=setup('all'),summary=apply(fixture),fatal='10c84674-9497-5eb2-a8fe-a5b7fb4a7ec6';
check(summary.icons===11&&summary.filesChanged===11,'all eleven requested item GUIDs have textures');
const before=path.join(root,'before'),after=path.join(root,'after');fs.cpSync(fixture.input,before,{recursive:true});fs.cpSync(fixture.output,after,{recursive:true});fs.cpSync(path.join(fixture.input,'UiTextureResource'),path.join(after,'UiTextureResource'),{recursive:true});fs.cpSync(path.join(fixture.output,'ItemInfo'),path.join(before,'ItemInfo'),{recursive:true});
reject(()=>icons.verify({summary,reflection,verifyRoot:before,options}),new RegExp(fatal));
check(icons.verify({summary,reflection,verifyRoot:after,options}).checked===11,'readback requires every own GUID');
for(const item of defs.items){const actual=JSON.parse(fs.readFileSync(path.join(after,'UiTextureResource',icons.filename(item.guid)))),source=defs.sources.find(s=>s.guid===item.sourceGuid);check(icons.digest({...actual,$guid:source.guid})===source.sha256,'full native encoding and source payload preserved: '+item.guid);}
check(apply(fixture).filesChanged===0,'exact existing output is idempotent');
check(icons.auditCreatedItems(fixture.input,fixture.output).checked===11,'generic audit sees all new ItemInfo outputs');
const extra=JSON.parse(JSON.stringify(drak.buildCreatedResources(options).find(d=>d.$type==='keen::ItemInfo')));extra.$guid='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';extra.objectId=extra.$guid;write(fixture.output,path.join('ItemInfo',extra.$guid+'_b5ce8765_0.json'),extra);reject(()=>icons.auditCreatedItems(fixture.input,fixture.output),new RegExp(extra.$guid));fs.unlinkSync(path.join(fixture.output,'ItemInfo',extra.$guid+'_b5ce8765_0.json'));
const missing=path.join(after,'UiTextureResource',icons.filename(fatal));fs.unlinkSync(missing);reject(()=>icons.verify({summary,reflection,verifyRoot:after,options}),new RegExp(fatal));
const corrupt=setup('bad-donor'),donor=defs.sources[0],bad=JSON.parse(JSON.stringify(donor.document));bad.format='R8G8B8A8_unorm';write(corrupt.input,path.join(donor.directory,donor.file),bad);reject(()=>apply(corrupt),/Texturspender verändert/);check(!fs.existsSync(path.join(corrupt.output,'UiTextureResource')),'source validation precedes all writes');
const collision=setup('collision');write(collision.input,path.join('UiTextureResource',icons.filename(fatal)),icons.expected(defs.items.find(i=>i.guid===fatal)));reject(()=>apply(collision),/bereits in der Ausgangsbasis/);
const noItem=setup('missing-item');fs.unlinkSync(path.join(noItem.output,'ItemInfo',fatal+'_b5ce8765_0.json'));reject(()=>apply(noItem),/Ressource fehlt/);check(!fs.existsSync(path.join(noItem.output,'UiTextureResource')),'missing owning ItemInfo prevents icon creation');
for(const [key,count]of [['enableDrakMerchant',4],['enableNightPlantCultivation',7]]){const selected={world:{[key]:{enabled:true}}},f=setup(key,selected);check(apply(f).icons===count,'feature works without skeleton option: '+key);check(icons.createdResources(selected).length===count,'finite selected create inventory');}
check(icons.apply({role:'server',options},'not-read','not-written').enabled===false,'dedicated server creates no UI resources');
check(icons.createdResources({}).length===0,'disabled features create no icons');
check(backend.managedCreateKeys(options,'client').filter(k=>k.startsWith(icons.TYPE+'|')).length===11,'client allowlist includes exact eleven icons');
check(!backend.managedCreateKeys(options,'server').some(k=>k.startsWith(icons.TYPE+'|')),'server recipe inventory stays unchanged');
reject(()=>icons.verify({summary:{enabled:false},reflection,verifyRoot:after,options}),/prüfung fehlt/);
console.log(JSON.stringify({passed:true,checks,crashResource:fatal+':f9e86997:0',textures:summary.icons,gameStarted:false}));
// The temporary fixture root is process-owned, never a game installation.
if(!path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep)||!path.basename(root).startsWith('ems-native-item-textures-'))throw Error('Unsafe fixture cleanup path');
fs.rmSync(root,{recursive:true,force:true});
