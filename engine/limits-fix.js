'use strict';
/* Own-source limits supplement for Enshrouded Mod Studio. Operates on exported
 * JSON only; leaves preset/active settings unchanged. Never accesses server JSON.
 * Selected UI slider names map explicitly to numeric game-rule fields.
 */
const fsDefault = require('fs');
const path = require('path');
const CLIENT_TO_SERVER = Object.freeze({
 enemyDamage:'enemyDamageFactor', enemyHealth:'enemyHealthFactor', enemyStamina:'enemyStaminaFactor', enemyPerceptionRange:'enemyPerceptionRangeFactor', enemyAttackFrequency:'threatBonus',
 bossDamage:'bossDamageFactor', bossHealth:'bossHealthFactor', miningXp:'experienceMiningFactor', questXp:'experienceExplorationQuestsFactor', combatXp:'experienceCombatFactor',
 playerHealth:'playerHealthFactor', playerStamina:'playerStaminaFactor', playerMana:'playerManaFactor', playerDivingTime:'playerDivingTimeFactor', shroudTime:'shroudTimeFactor', foodDuration:'foodBuffDurationFactor',
 productionTime:'factoryProductionSpeedFactor', plantGrowTime:'plantGrowthSpeedFactor', weaponUpgradeCost:'perkCostFactor', miningDamage:'miningDamageFactor', dropAmount:'resourceDropStackAmountFactor', bodyHeat:'playerBodyHeatFactor'
});
const PLAYER = new Set(['playerHealth', 'playerStamina', 'playerMana']);
const SERVER_TO_CLIENT = Object.freeze(Object.fromEntries(Object.entries(CLIENT_TO_SERVER).map(([client,server])=>[server,client])));
const clone = value => JSON.parse(JSON.stringify(value));
const equal = (a,b) => JSON.stringify(a) === JSON.stringify(b);
function readBounds(config, prefix) {
 const minKey = prefix === 'server' ? 'uncapServerFactorMin' : 'clientFactorMin';
 const maxKey = prefix === 'server' ? 'uncapServerFactorMax' : 'clientFactorMax';
 const min = config[minKey] === undefined ? 0.1 : config[minKey];
 const max = config[maxKey] === undefined ? 5 : config[maxKey];
 if (typeof min !== 'number' || typeof max !== 'number' || !Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || max < 1 || min > max || max > 5) throw new Error(prefix + ' limits require finite values: min > 0, max >= 1, min <= max <= 5.');
 return {min,max};
}
function enabledConfig(config, role='unknown') {
 const dedicated = config.enableUncapDedicatedServerSettings === true;
 const clientRequested = config.enableUncapClientSettings === true;
 // Still validate requested bounds; an explicit server role only skips the
 // client operation, never malformed configuration or unknown resource schemas.
 const requestedClientBounds = clientRequested ? readBounds(config,'client') : null;
 const clientSkipped = clientRequested && role === 'server';
 const client = clientRequested && !clientSkipped;
 const serverBounds = dedicated ? readBounds(config,'server') : null;
 const clientBounds = client ? requestedClientBounds : null;
 const effectiveServer = serverBounds || clientBounds;
 if (client && clientBounds.min >= Math.min(clientBounds.max, effectiveServer.max, 4)) throw new Error('Client minimum must be below the effective maximum for capped player sliders.');
 return {dedicated,client,clientRequested,clientSkipped,serverBounds,clientBounds,effectiveServer};
}
function generateSteps(baseline, requestedMin, cap) {
 if (!Array.isArray(baseline) || !baseline.length || baseline.some(v=>typeof v!=='number'||!Number.isFinite(v)||v<0)) throw new Error('Numeric slider steps must be a nonempty finite nonnegative array.');
 const descending = baseline[0] > baseline[baseline.length-1];
 const values = [];
 const put = (value,exact=false) => {
  const index = values.findIndex(v=>Math.abs(v-value)<1e-7 && !(v===0&&value!==0) && !(value===0&&v!==0));
  if (index < 0) values.push(value); else if (exact) values[index]=value;
 };
 baseline.filter(value=>value<=cap).forEach(value=>put(value));
 put(1,true);
 for(let quarter=Math.ceil(requestedMin*4);quarter/4<=cap;quarter++) put(quarter/4);
 put(requestedMin,true);put(cap,true);
 if(values.length>256)throw new Error('Slider would exceed the 256-step limit.');
 return values.sort((a,b)=>descending?b-a:a-b);
}
function apply(ctx,inputRoot,outputRoot) {
 if(!ctx||!ctx.config)throw new Error('Patch context with config is required.');
 const role=ctx.role==='server'?'server':ctx.role==='client'?'client':'unknown';
 const settings=enabledConfig(ctx.config,role);
 const summary={filesChanged:0,serverFieldsChanged:0,clientSlidersChanged:0,restoredVendorExclusions:0,warnings:[],serverBounds:settings.effectiveServer,clientBounds:settings.clientBounds,role,clientOptionSkipped:settings.clientSkipped,samples:[]};
 if(settings.clientSkipped){const message='Client-Menügrenzen übersprungen: Ein Dedicated Server besitzt kein Client-Menü. Servergrenzen werden ausschließlich durch den separaten Servergrenzen-Schalter geändert.';summary.warnings.push({code:'client-limits-skipped-on-server',message});if(ctx.logger&&typeof ctx.logger.warn==='function')ctx.logger.warn(message);}
 if(!settings.dedicated&&!settings.client)return summary;
 if(path.resolve(inputRoot).toLowerCase()===path.resolve(outputRoot).toLowerCase())throw new Error('Input and output export roots must differ.');
 const fs=ctx.fs||fsDefault,pending=[],tracks=[];
 const warn=(code,details)=>summary.warnings.push({code,...details});
 function loadResources(type,required) {
  const directory=path.join(inputRoot,type);
  if(!fs.existsSync(directory)){if(required)throw new Error(type+' export is required for consistent limits.');return [];}
  const names=fs.readdirSync(directory).filter(name=>name.endsWith('.json')).sort();
  if(required&&!names.length)throw new Error(type+' export is empty.');
  return names.map(filename=>{
   const source=JSON.parse(fs.readFileSync(path.join(directory,filename),'utf8'));
   const outputPath=path.join(outputRoot,type,filename);
   const current=fs.existsSync(outputPath)?JSON.parse(fs.readFileSync(outputPath,'utf8')):clone(source);
   if(current.$guid!==source.$guid||current.$type!==source.$type)throw new Error('Resource identity differs in vendor output: '+filename);
   return {type,filename,source,current,outputPath,changed:false};
  });
 }
 const serverResources=loadResources('GameSettingsPresetsResource',true);
 const supportedServerCounts={};
 const clientResources=settings.client?loadResources('FbUiBundle',true):[];
 function set(resource,target,key,value,field,kind) {
  if(equal(target[key],value))return;
  const old=target[key];target[key]=clone(value);resource.changed=true;
  tracks.push([resource.filename,'studioLimitsFix',field,old,value]);
  summary[kind]++;
 }
 for(const resource of serverResources){
  const {source,current}=resource;
  for(const group of ['minValues','maxValues'])if(!source[group]||typeof source[group]!=='object'||Array.isArray(source[group])||!current[group]||typeof current[group]!=='object'||Array.isArray(current[group]))throw new Error('Invalid '+group+' in '+resource.filename);
  // Vendor1.2.3 extends every *Factor, including recycling probability. Restore
  // unowned bound fields from baseline; retain unrelated resource metadata.
  for(const group of ['minValues','maxValues'])for(const [key,value]of Object.entries(source[group]))if(!Object.prototype.hasOwnProperty.call(SERVER_TO_CLIENT,key))set(resource,current[group],key,value,group+'.'+key,'restoredVendorExclusions');
  for(const [server,client]of Object.entries(SERVER_TO_CLIENT)){
   const baseMin=source.minValues[server],baseMax=source.maxValues[server];
   if(typeof baseMin!=='number'||!Number.isFinite(baseMin)||typeof baseMax!=='number'||!Number.isFinite(baseMax)){warn('missing-or-nonnumeric-server-bound',{file:resource.filename,field:server});continue;}
   supportedServerCounts[server]=(supportedServerCounts[server]||0)+1;
   const cap=Math.min(settings.effectiveServer.max,PLAYER.has(client)?4:5);
   let requestedMin=settings.effectiveServer.min;
   if(settings.client)requestedMin=Math.min(requestedMin,settings.clientBounds.min);
   if(requestedMin>cap)throw new Error('Requested minimum exceeds effective cap for '+server+'.');
   const min=baseMin>=0&&baseMin<=cap?Math.min(baseMin,requestedMin):requestedMin;
   set(resource,current.minValues,server,min,'minValues.'+server,'serverFieldsChanged');
   set(resource,current.maxValues,server,cap,'maxValues.'+server,'serverFieldsChanged');
   if(summary.samples.length<30)summary.samples.push({type:'server',field:server,before:{min:baseMin,max:baseMax},after:{min,max:cap}});
  }
  // Warn about saved preset values, without rewriting or claiming a repair.
  const presets=Array.isArray(current.presets)?current.presets:Object.entries(current.presets||{}).map(([key,v])=>({presetId:key,...v}));
  for(const preset of presets)for(const server of Object.keys(SERVER_TO_CLIENT)){
   const value=preset&&preset.settings&&preset.settings[server];
   if(typeof value==='number'&&Number.isFinite(value)&&value>=10)warn('saved-preset-factor-unchanged',{file:resource.filename,preset:preset.presetId||'unknown',field:server,value});
  }
 }
 for(const resource of clientResources){
  const baseline=resource.source.difficultySettings&&resource.source.difficultySettings.settingValues;
  const current=resource.current.difficultySettings&&resource.current.difficultySettings.settingValues;
  if(!baseline||!current||typeof baseline!=='object'||typeof current!=='object')throw new Error('Difficulty settingValues missing in '+resource.filename);
  for(const [client,definition]of Object.entries(baseline)){
   if(!definition||!Array.isArray(definition.steps))continue;
   if(!current[client]||!Array.isArray(current[client].steps))throw new Error('Vendor slider schema differs for '+client+'.');
   if(!Object.prototype.hasOwnProperty.call(CLIENT_TO_SERVER,client)){
    set(resource,current[client],'steps',definition.steps,'difficultySettings.settingValues.'+client+'.steps','restoredVendorExclusions');continue;
   }
   if(supportedServerCounts[CLIENT_TO_SERVER[client]]!==serverResources.length)throw new Error('Matching numeric server bounds missing for client slider '+client+'.');
   const cap=Math.min(settings.clientBounds.max,settings.effectiveServer.max,PLAYER.has(client)?4:5);
   if(settings.clientBounds.min>=cap)throw new Error('Client minimum must be below the effective maximum for '+client+'.');
   if(cap<settings.clientBounds.max)warn('client-cap-limited',{file:resource.filename,slider:client,requested:settings.clientBounds.max,applied:cap});
   const steps=generateSteps(definition.steps,settings.clientBounds.min,cap);
   set(resource,current[client],'steps',steps,'difficultySettings.settingValues.'+client+'.steps','clientSlidersChanged');
   summary.samples.push({type:'client',slider:client,before:{min:Math.min(...definition.steps),max:Math.max(...definition.steps),count:definition.steps.length},after:{min:Math.min(...steps),max:Math.max(...steps),count:steps.length},endpoints:{min:settings.clientBounds.min,max:cap}});
  }
 }
 // Resolve all errors and build final JSON before writing any output.
 for(const resource of [...serverResources,...clientResources])if(resource.changed)pending.push({file:resource.outputPath,text:JSON.stringify(resource.current,null,2)});
 for(const entry of pending){fs.mkdirSync(path.dirname(entry.file),{recursive:true});fs.writeFileSync(entry.file,entry.text,'utf8');}
 for(const args of tracks)if(typeof ctx.track==='function')ctx.track(...args);
 if(ctx.logger&&typeof ctx.logger.warn==='function')for(const item of summary.warnings)if(item.code!=='client-limits-skipped-on-server')ctx.logger.warn('[Limits fix] '+JSON.stringify(item));
 summary.filesChanged=pending.length;
 return summary;
}
module.exports={apply,generateSteps,enabledConfig,CLIENT_TO_SERVER,SERVER_TO_CLIENT};


