'use strict';
// Original mod fiction, encoded through the native compiled NPC dialogue data.
// Retain the existing Talk opener; add no quest records or unlock operations.
const nativeFs=require('fs'),path=require('path'),crypto=require('crypto');
const definitions=require('./drak-dialogue-definitions.json'),items=require('./custom-skeleton-items');
const DEFINITIONS_SHA256='5fcf14213f9aae0e3dd04fb2b9f2ddcd3410bf46963b3ba169dfe88b234363ae';
const COMPONENT='keen::ecs::NpcDialog',TEMPLATE='keen::ecs::TemplateResource';
const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
const digest=v=>crypto.createHash('sha256').update(canonical(v)).digest('hex'),clone=v=>JSON.parse(JSON.stringify(v)),equal=(a,b)=>canonical(a)===canonical(b),id=items.guidHash;
const fail=s=>{throw Error('Ssarikk-Dialog: '+s);};
const SOURCE_RESOURCES=[{guid:definitions.silentPattern.templateGuid,directory:'TemplateResource',type:TEMPLATE,part:0,file:definitions.silentPattern.templateGuid+'_39768775_0.json'},{guid:definitions.defaultSequence.guid,directory:'ActorSequenceResource',type:'keen::actor::ActorSequenceResource',part:0,file:definitions.defaultSequence.guid+'_9fd4a561_0.json'}];
function assertDefinitions(){
 if(digest(definitions)!==DEFINITIONS_SHA256||definitions.format!==1||definitions.nativeBuild!==require('./build-contract').BUILD||definitions.sourceBuild!=='1283531'||definitions.topics.length!==4||definitions.ambient!==false)fail('Feste Dialogdefinitionen verändert.');
 const p=definitions.silentPattern.document;
 if(digest(p)!==definitions.silentPattern.sha256||p.overrideSequence!==false||p.sequence!==null||p.knowledgeUnlockOperations.length||p.voiceovers.length!==1||p.voiceovers[0]!==null||!equal(p.knowledgeRequirement,{knowledgeOrQueryId:{value:0},compareValue:0,compareOperator:'GreaterThan',type:'Extern',isExplicitPlayerKnowledgeQuery:false}))fail('Native stille Textvorlage verändert.');
 const s=definitions.defaultSequence.document;
 if(digest(s)!==definitions.defaultSequence.sha256||s.$guid!==definitions.defaultSequence.guid||s.subSequences.length!==1||s.subSequences[0].events.length||s.subSequences[0].loop!==false)fail('Native animationsfreie Dialogsequenz verändert.');
 const guids=[definitions.intro.optionGuid,definitions.farewell.optionGuid,...definitions.topics.map(t=>t.optionGuid)],ids=guids.map(id);
 if(new Set(ids).size!==6||ids.includes(0)||definitions.topics.filter(t=>t.uiHintType==='Hint').length!==1)fail('Eigene Dialogkennungen sind nicht eindeutig.');
 return definitions;
}
function assertSchema(reflection){
 require('./build-contract').assertReflection(reflection);assertDefinitions();
 for(const [name,want]of Object.entries(definitions.schema)){const rows=reflection.types.filter(t=>t.qualifiedName===name),t=rows[0];if(rows.length!==1||['primitiveType','size','alignment','qualifiedHash','fieldCount'].some(k=>t[k]!==want[k]))fail('Natives Dialogschema geändert: '+name);const inner=Number.isInteger(t.innerType)?reflection.types[t.innerType]?.qualifiedName:null;if(inner!==want.innerType)fail('Dialog-Vererbung geändert: '+name);for(const[k,f]of Object.entries(want.fields)){const actual=t.structFields?.[k];if(!actual||actual.dataOffset!==f.offset||reflection.types[actual.type]?.qualifiedName!==f.type)fail('Dialogfeld geändert: '+name+'.'+k);}if(want.enums)for(const[k,value]of Object.entries(want.enums))if(t.enumFields?.[k]?.value!==value)fail('Dialogkennung geändert: '+name+'.'+k);}
 return reflection.version;
}
function read(fs,file){try{return JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));}catch(e){fail('Native Dialogquelle fehlt: '+path.basename(file)+'. '+e.message);}}
function component(doc,type){const rows=doc.components?.filter(c=>c.$type===type);if(rows?.length!==1)fail('Eindeutige Komponente fehlt: '+type);return rows[0];}
function assertNativeSources(input,reflection,fs=nativeFs){
 assertSchema(reflection);
 const template=read(fs,path.join(input,SOURCE_RESOURCES[0].directory,SOURCE_RESOURCES[0].file));
 if(template.$type!==TEMPLATE||template.$guid!==definitions.silentPattern.templateGuid||template.$part!==0||digest(component(template,COMPONENT).$value.dialogResource.initLines[1])!==definitions.silentPattern.sha256)fail('Native stille Dialogzeile geändert.');
 const sequence=read(fs,path.join(input,SOURCE_RESOURCES[1].directory,SOURCE_RESOURCES[1].file));if(digest(sequence)!==definitions.defaultSequence.sha256)fail('Native animationsfreie Sequenz geändert.');
 return {silentLineSha256:definitions.silentPattern.sha256,defaultSequenceSha256:definitions.defaultSequence.sha256,animationEvents:0};
}
function tags(){return [definitions.intro.body,definitions.farewell.body,...definitions.topics.flatMap(t=>[t.label,t.body])];}
function localizationTags(){assertDefinitions();const rows=tags().map(t=>({guid:t.guid,id:id(t.guid),de:t.de,en:t.en}));if(rows.length!==10||new Set(rows.map(t=>t.id)).size!==10)fail('Dialogtexte fehlen oder kollidieren.');return rows;}
function line(optionGuid,body,kind='option',hint='None'){
 const row=clone(definitions.silentPattern.document);delete row.isWakeup;row.optionId={value:id(optionGuid)};row.bodyTexts=[{value:id(body.guid)}];row.uiHintType=hint;
 if(kind==='init')row.isWakeup=false;return row;
}
function buildDialog(base){
 assertDefinitions();if(base?.isFlame!==false||base.dialog!==null)fail('Eigene unabhängige Dialogbasis erforderlich.');
 const dialog=clone(base),r=dialog.dialogResource;if(!r)fail('Kompilierte Dialogbasis fehlt.');
 for(const[key,value]of Object.entries(definitions.baseLabels))if(r[key]?.value!==value)fail('Eigene Dialog-/Handwerksbeschriftung geändert: '+key);
 r.defaultSequence=definitions.defaultSequence.guid;r.missingRequirementSequence=null;
 r.initLines=[line(definitions.intro.optionGuid,definitions.intro.body,'init')];r.transitionLines=[];
 r.farewellLines=[line(definitions.farewell.optionGuid,definitions.farewell.body,'farewell')];
 r.dialogOptions=definitions.topics.map(t=>({...line(t.optionGuid,t.body,'option',t.uiHintType),optionText:{value:id(t.label.guid)}}));
 return dialog;
}
function applyToTemplate(doc){
 if(doc?.$type!==TEMPLATE||doc.$guid!==definitions.merchantTemplateGuid||doc.$part!==0)fail('Dialog darf nur die eigene Handwerkervorlage ändern.');
 const result=clone(doc),row=component(result,COMPONENT);row.$value=buildDialog(row.$value);return result;
}
function verifyTemplate(doc){
 if(doc?.$type!==TEMPLATE||doc.$guid!==definitions.merchantTemplateGuid||doc.$part!==0)fail('Eigene Handwerkervorlage fehlt.');
 const actual=component(doc,COMPONENT).$value;if(!equal(actual,buildDialog(actual)))fail('Dialog nach Rücklesen verändert.');
 const opener=component(doc,'keen::ecs::InteractionOfferRuntime').$value;if(opener.defaultSequence?.value!==23213376||opener.defaultVerbId?.value!==3649444939||opener.isDisabled!==false)fail('Nativer Talk-Einstieg wurde verändert.');
 component(doc,'keen::ecs::NpcDialogClientSync');
 return {enabled:true,verified:true,npcGuid:doc.$guid,topics:4,introLines:1,farewellLines:1,hintOptions:1,voiceoverCount:0,customKnowledgeWrites:0,defaultSequence:definitions.defaultSequence.guid,nativeTalkOpenerPreserved:true,ambient:false,speechBubbleRuntimeVerified:false,gameplayVerified:false};
}
module.exports={applyToTemplate,verifyTemplate,buildDialog,assertDefinitions,assertSchema,assertNativeSources,localizationTags,SOURCE_RESOURCES,definitions,DEFINITIONS_SHA256,digest};
