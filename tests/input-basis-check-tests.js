'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert');
const check=require('../engine/input-basis-check'),defs=require('../engine/skeleton-spell-definitions.json');
const root=path.join(__dirname,'basis-input-fixture-'+process.pid);fs.mkdirSync(root,{recursive:true});
const serverKeys=defs.items.map(x=>'keen::ItemInfo|'+x.guid+'|0');
const clientKeys=[...serverKeys,...defs.items.map(x=>'keen::UiTextureResource|'+x.guid+'|0')];
const tests=[];let id=0;
function fixture(){const folder=path.join(root,String(++id));fs.mkdirSync(folder);return folder;}
function put(input,type,guid,doc={}){const dir=path.join(input,type);fs.mkdirSync(dir,{recursive:true});const file=path.join(dir,guid+'_00000001_0.json');fs.writeFileSync(file,JSON.stringify(doc));return file;}
function run(input,role='server',enabled=true,config){return check.assertUnmodified({input,role,reflection:{types:[]},config:config||{world:{enableSkeletonSummoningSpells:{enabled}}},createdKeys:role==='client'?clientKeys:serverKeys});}
function reject(name,fn){assert.throws(fn,e=>e.actionCode==='unmodified_basis_required'&&e.mismatchDetails.gameFilesChanged===false);tests.push(name);}
try{
 let f=fixture();assert.strictEqual(run(f).checked,true);tests.push('Clean input remains supported');
 f=fixture();put(f,'ItemInfo',defs.items[0].guid);reject('Generated server item is rejected before patching',()=>run(f));
 reject('Disabling new spells cannot turn generated resources into original input',()=>run(f,'server',false));
 f=fixture();put(f,'UiTextureResource',defs.items[0].guid);reject('Client icon marker is detected in client input',()=>run(f,'client'));
 f=fixture();put(f,'TemplateResource','10f892be-2374-4d31-ae27-85e0a36f3853',{components:[{$type:'keen::ecs::SpawnLimit',$value:{spawnLimitPool:'Skeleton'}}]});
 reject('Previously changed Gem pool receives the actionable basis error',()=>run(f));
 assert.strictEqual(run(f,'server',false).checked,true);tests.push('Unrequested legacy Gem modification is left to normal enabled-feature checks');
 f=fixture();put(f,'TemplateResource','10f892be-2374-4d31-ae27-85e0a36f3853',{components:[{$type:'keen::ecs::SpawnLimit',$value:{spawnLimitPool:'GemOfNecromancy'}}]});assert(run(f).checked);tests.push('Native Gem pool is not classified as an EMS input');
 f=fixture();put(f,'ItemInfo','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');assert(run(f).checked);tests.push('Unrelated resource is not mistaken for our generated item');
 const proof={passed:true,checks:tests.length,tests,desktopStarted:false,gameStarted:false};
 fs.writeFileSync(path.join(__dirname,'input-basis-check-results.json'),JSON.stringify(proof,null,2));console.log(JSON.stringify(proof));
}finally{if(path.dirname(root)!==__dirname||!path.basename(root).startsWith('basis-input-fixture-'))throw Error('Cleanup guard');fs.rmSync(root,{recursive:true,force:true});}
