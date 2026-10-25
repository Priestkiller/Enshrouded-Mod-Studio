'use strict';
// A reproducible configuration/build identifier. It does not contact peers or
// certify a successful network/gameplay test; each player must patch locally.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const FILES=['skeleton-spells.js','custom-skeleton-items.js','summoned-companions.js','advanced-companions.js','skeleton-spell-definitions.json'];
function canonical(v){if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';if(v&&typeof v==='object')return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';return JSON.stringify(v);}
const sha=v=>crypto.createHash('sha256').update(v).digest('hex');
const fail=s=>{throw Error('Begleiter-Mehrspieler: '+s);};
function create(options){
 if(!['client','server'].includes(options?.role))fail('Getrennte Client-/Serverrolle fehlt.');
 if(typeof options.build!=='string'||!options.build.startsWith('1273043|'))fail('Unbekannte Spielversion.');
 const settings={maxCompanions:options.maxCompanions??4,durationSeconds:options.durationSeconds??120,strengthFactor:options.strengthFactor??1};
 for(const [k,max]of [['maxCompanions',8],['durationSeconds',3600],['strengthFactor',20]])if(!Number.isInteger(settings[k])||settings[k]<1||settings[k]>max)fail('Ungültige Einstellung: '+k);
 const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'engine-manifest.json'),'utf8'));
 if(typeof manifest.studio!=='string'||!/^\d+\.\d+\.\d+$/.test(manifest.studio))fail('Toolversion fehlt.');
 const sharedCodeHash=sha(canonical(FILES.map(file=>({file,sha256:sha(fs.readFileSync(path.join(__dirname,file)))}))));
 const payload={protocol:'ems-six-companions/1',studio:manifest.studio,build:options.build,settings,sharedCodeHash};
 const id=sha(canonical(payload));
 return {enabled:true,role:options.role,...payload,id,shortId:id.slice(0,16).toUpperCase(),requiresPatchedServer:true,requiresPatchedClients:true,automaticDistribution:false,gameplayVerified:false};
}
function verify(proof,options){const expected=create(options);if(canonical(proof)!==canonical(expected))fail('Die MP-Kennung passt nicht zu Spielbuild, Einstellungen und gemeinsamem Datenpatch. Neue Vorschau erstellen.');return {verified:true,id:expected.id,shortId:expected.shortId,gameplayVerified:false};}
function assertCompatible(left,right){if(!left||!right||left.role!=='server'||right.role!=='client'||left.id!==right.id||left.protocol!=='ems-six-companions/1'||right.protocol!==left.protocol||left.gameplayVerified!==false||right.gameplayVerified!==false)fail('Server und Spielclient benötigen dieselbe MP-Kennung.');return {compatibleConfiguration:true,id:left.id,gameplayVerified:false};}
module.exports={create,verify,assertCompatible,FILES};
