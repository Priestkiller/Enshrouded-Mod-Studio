'use strict';
// Register the own recipes in the game's compiled crafting menu as well as its
// recipe registry. The existing Alden group/set and all other UI data stay intact.
const nativeFs=require('fs'),path=require('path'),crypto=require('crypto');
const definitions=require('./skeleton-spell-definitions.json');
const TYPE='keen::FbUiBundle',GUID='46e14df6-fb8f-4f66-9463-e23b9e19e48e',HASH='fef918b8';
const DIRECTORY='FbUiBundle',FILE=GUID+'_'+HASH+'_0.json';
const fail=message=>{throw Error('Skelettzauber-Herstellungsmenü: '+message);};
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const uint=value=>Number.isInteger(value)&&value>0&&value<=0xffffffff;
const clone=value=>JSON.parse(JSON.stringify(value));
function canonical(value){if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(object(value))return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';return JSON.stringify(value);}
const digest=value=>crypto.createHash('sha256').update(canonical(value)).digest('hex');
const equal=(a,b)=>canonical(a)===canonical(b);
function assertSchema(reflection){
 if(typeof reflection?.version!=='string'||!reflection.version.startsWith('1273043|')||!Array.isArray(reflection.types))fail('Frische Reflection für Build 1273043 erforderlich.');
 const types=reflection.types,byName=new Map();for(const type of types){if(byName.has(type.qualifiedName))fail('Doppelter Reflection-Typ.');byName.set(type.qualifiedName,type);}
 function structure(name,size,fields){const type=byName.get(name);if(type?.primitiveType!=='STRUCT'||type.size!==size)fail('Geänderte Struktur: '+name);for(const [key,offset,target]of fields){const field=type.structFields?.[key];if(!field||field.dataOffset!==offset||types[field.type]?.qualifiedName!==target)fail('Geändertes Feld: '+name+'.'+key);}return type;}
 const root=structure(TYPE,81544,[['menu',59488,'keen::FbUiMenu']]);if(root.qualifiedHash!==4277737656)fail('Geänderte UI-Ressourcenkennung.');
 structure('keen::FbUiMenu',5928,[['crafting',1600,'keen::FbUiCrafting']]);
 structure('keen::FbUiCrafting',120,[['recipeCollection',56,'keen::ObjectReference<keen::RecipeList>'],['recipes',72,'keen::FbUiCraftingRecipeCollection']]);
 structure('keen::FbUiCraftingRecipeCollection',24,[['workshops',0,'keen::BlobArray<keen::WorkshopId>'],['trees',8,'keen::BlobArray<keen::FbUiCraftingRecipeTree>'],['maxRecipeGroupCount',16,'keen::uint32'],['maxRecipeSetCount',20,'keen::uint32']]);
 structure('keen::FbUiCraftingRecipeTree',8,[['groups',0,'keen::BlobArray<keen::FbUiCraftingRecipeGroup>']]);
 structure('keen::FbUiCraftingRecipeGroup',56,[['sets',48,'keen::BlobArray<keen::FbUiCraftingRecipeSet>']]);
 structure('keen::FbUiCraftingRecipeSet',40,[['entries',32,'keen::BlobArray<keen::RecipeId>']]);
 if(definitions.sourceRecipe?.recipeId!==2933402986||definitions.workshop?.id!==2906865252||definitions.registries?.recipes!=='5e57de0f-280c-4559-8191-f02c1ba656e2'||!Array.isArray(definitions.items)||definitions.items.length!==6)fail('Unbekannte eigene Rezeptdefinitionen.');
 const ids=definitions.items.map(row=>row.recipeId);if(ids.some(id=>!uint(id)||id===2933402986)||new Set(ids).size!==6)fail('Ungültige eigene Rezeptkennungen.');return reflection.version;
}
function read(fs,file){let doc;try{doc=JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));}catch{fail('UI-Export nicht lesbar: '+path.basename(file));}if(!object(doc))fail('UI-Objekt fehlt.');return doc;}
function inspect(doc){
 if(doc.$type!==TYPE||doc.$guid!==GUID||doc.$part!==0)fail('UI-Ressourcenidentität stimmt nicht.');
 const crafting=doc.menu?.crafting,collection=crafting?.recipes,ids=definitions.items.map(row=>row.recipeId),occurrences=new Map(ids.map(id=>[id,[]])),sources=[];
 if(crafting?.recipeCollection!==definitions.registries.recipes||!object(collection)||!Array.isArray(collection.workshops)||!Array.isArray(collection.trees)||collection.workshops.length!==collection.trees.length||!uint(collection.maxRecipeGroupCount)||!uint(collection.maxRecipeSetCount))fail('Kompilierter Herstellungsbaum ist unbekannt.');
 const workshops=new Set();let alden=-1;
 for(let w=0;w<collection.workshops.length;w++){
  const workshop=collection.workshops[w],id=workshop?.value;if(!object(workshop)||Object.keys(workshop).join('|')!=='value'||!Number.isInteger(id)||id<0||id>0xffffffff||workshops.has(id))fail('Ungültige/doppelte UI-Werkstatt.');workshops.add(id);if(id===definitions.workshop.id)alden=w;
  const tree=collection.trees[w];if(!object(tree)||!Array.isArray(tree.groups))fail('UI-Werkstattbaum fehlt.');
  for(let g=0;g<tree.groups.length;g++){const group=tree.groups[g];if(!object(group)||!Array.isArray(group.sets))fail('UI-Rezeptgruppe fehlt.');
   for(let s=0;s<group.sets.length;s++){const set=group.sets[s];if(!object(set)||!Array.isArray(set.entries))fail('UI-Rezeptliste fehlt.');
    for(let e=0;e<set.entries.length;e++){const entry=set.entries[e];if(!object(entry)||Object.keys(entry).join('|')!=='value'||!uint(entry.value))fail('Ungültiger UI-Rezepteintrag.');const location={w,g,s,e};if(entry.value===definitions.sourceRecipe.recipeId)sources.push(location);if(occurrences.has(entry.value))occurrences.get(entry.value).push(location);}
   }
  }
 }
 if(alden<0||sources.length!==1||sources[0].w!==alden)fail('Ursprüngliches Skelettrezept ist nicht eindeutig bei Alden eingetragen.');
 const source=sources[0],entries=collection.trees[source.w].groups[source.g].sets[source.s].entries;
 const counts=ids.map(id=>occurrences.get(id).length),present=counts.some(Boolean);
 if(present){for(let i=0;i<ids.length;i++){const found=occurrences.get(ids[i]);if(found.length!==1||!equal(found[0],{w:source.w,g:source.g,s:source.s,e:source.e+1+i}))fail('Eigene Rezepte sind unvollständig, doppelt oder am falschen Menüplatz.');}}
 const pointer='/menu/crafting/recipes/trees/'+source.w+'/groups/'+source.g+'/sets/'+source.s+'/entries';
 return {source,entries,present,pointer,ids,workshops:collection.workshops.length};
}
function stripped(doc){const result=clone(doc),where=inspect(result);if(where.present)where.entries.splice(where.source.e+1,6);return result;}
function locate(fs,root){const folder=path.join(root,DIRECTORY);if(!fs.existsSync(folder))fail('Frischer FbUiBundle-Export fehlt.');const matches=fs.readdirSync(folder).filter(file=>file.startsWith(GUID+'_')&&file.endsWith('.json'));if(matches.length!==1||matches[0]!==FILE)fail('UI-Ressource fehlt oder ist mehrdeutig.');return path.join(folder,FILE);}
function within(a,b){const relative=path.relative(a,b);return relative===''||(!path.isAbsolute(relative)&&relative!=='..'&&!relative.startsWith('..'+path.sep));}
function apply(ctx,inputRoot,outputRoot){
 const summary={enabled:ctx?.enabled===true,role:ctx?.role||'unknown',filesChanged:0,resources:[],gameplayVerified:false,prototype:true};if(!summary.enabled)return summary;if(ctx.role!=='client')fail('Nur für den lokalen Spielclient-Test freigegeben.');summary.build=assertSchema(ctx.reflection);
 const fs=ctx.fs||nativeFs,input=path.resolve(inputRoot),output=path.resolve(outputRoot);if(within(input,output)||within(output,input))fail('Original und Ausgabe müssen getrennte Ordner sein.');
 const baseline=read(fs,locate(fs,input));inspect(baseline);const destination=path.join(output,DIRECTORY,FILE),doc=fs.existsSync(destination)?read(fs,destination):clone(baseline),where=inspect(doc),before=digest(doc);
 summary.baselineSha256=digest(stripped(doc));summary.pointer=where.pointer;summary.recipeIds=where.ids.slice();summary.sourceRecipeId=definitions.sourceRecipe.recipeId;summary.workshopId=definitions.workshop.id;summary.workshopsChecked=where.workshops;
 if(!where.present)where.entries.splice(where.source.e+1,0,...where.ids.map(value=>({value})));
 const checked=inspect(doc);if(!checked.present||digest(stripped(doc))!==summary.baselineSha256)fail('Andere UI-Daten würden verändert.');
 const sha256=digest(doc);summary.resources=[{directory:DIRECTORY,file:FILE,guid:GUID,type:TYPE,part:0,created:false,sha256}];summary.registeredRecipes=6;
 if(before!==sha256){fs.mkdirSync(path.dirname(destination),{recursive:true});fs.writeFileSync(destination,JSON.stringify(doc,null,2),'utf8');summary.filesChanged=1;if(typeof ctx.track==='function')ctx.track(destination,where.pointer,'update');}
 return summary;
}
function verify(summary,reflection,root,fs=nativeFs){
 if(summary?.enabled!==true)return {enabled:false,checked:0,gameplayVerified:false};if(summary.role!=='client')fail('Verifikation nur für den lokalen Spielclient-Test freigegeben.');const build=assertSchema(reflection),row=summary.resources?.[0];
 if(summary.build!==build||summary.resources?.length!==1||row?.directory!==DIRECTORY||row.file!==FILE||row.guid!==GUID||row.type!==TYPE||row.part!==0||row.created!==false||summary.sourceRecipeId!==definitions.sourceRecipe.recipeId||summary.workshopId!==definitions.workshop.id||summary.registeredRecipes!==6||!equal(summary.recipeIds,definitions.items.map(item=>item.recipeId))||!/^[a-f0-9]{64}$/.test(summary.baselineSha256||''))fail('Ungültige UI-Prüfliste.');
 const doc=read(fs,locate(fs,root)),where=inspect(doc);if(!where.present||where.pointer!==summary.pointer||where.workshops!==summary.workshopsChecked||digest(doc)!==row.sha256||digest(stripped(doc))!==summary.baselineSha256)fail('Gepacktes Herstellungsmenü stimmt nicht mit den sechs geprüften Einträgen überein.');
 return {enabled:true,checked:1,registeredRecipes:6,workshopId:definitions.workshop.id,pointer:where.pointer,otherUiDataPreserved:true,gameplayVerified:false,prototype:true};
}
module.exports={apply,verify,assertSchema,inspect,digest,FILE,GUID,DIRECTORY};
