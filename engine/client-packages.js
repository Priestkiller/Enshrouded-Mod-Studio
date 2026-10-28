'use strict';
// Local export only. A manager must explicitly support this format before serving it.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const delta = require('./client-delta');
const storage = require('./storage-maintenance');
const manager = require('./manager-handoff');
const resourceRecipe = require('./resource-recipe');
const FORMAT = 'enshrouded-studio-client-package', VERSION = 1;
const ID = /^[a-f0-9]{20}$/, SHA = /^[a-f0-9]{64}$/;
const ARCHIVES = ['enshrouded.kfc', 'enshrouded.kfc_resources'];
const read = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
const digest = value => crypto.createHash('sha256').update(canonical(value)).digest('hex');
function atomicJson(file, doc) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.' + crypto.randomBytes(6).toString('hex') + '.tmp';
  try { fs.writeFileSync(tmp, canonical(doc) + '\n', { flag: 'wx' }); fs.renameSync(tmp, file); }
  finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
}
function noLinks(directory) {
  if (!fs.existsSync(directory)) return;
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('Verknüpfte Paketordner sind nicht erlaubt.');
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw Error('Verknüpfung im Paketordner.');
    if (entry.isDirectory()) noLinks(path.join(directory, entry.name));
  }
}
function safePath(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || /[\r\n\0]/.test(value)) throw Error('Für Clientpakete einen absoluten lokalen Ordnerpfad verwenden.');
  return path.resolve(value);
}
function settings(options, plan = null) {
  const dataRoot = path.dirname(path.resolve(options.data));
  const file = path.join(dataRoot, 'client-packages.json');
  const value = fs.existsSync(file) ? read(file) : { format: 1, enabled: true, clientBasisDirectory: null, outputDirectory: path.join(dataRoot, 'client-packages') };
  if (value.format !== 1 || typeof value.enabled !== 'boolean') throw Error('Ungültige Einrichtung für Clientpakete.');
  const transportMode = value.transportMode || 'resource-recipe';
  if (!['resource-recipe', 'client-archive-delta'].includes(transportMode)) throw Error('Unbekannte Methode für die Spieler-Synchronisation.');
  const legacy = { format: 1, enabled: value.enabled, transportMode, clientBasisDirectory: transportMode === 'client-archive-delta' && value.clientBasisDirectory ? safePath(value.clientBasisDirectory) : null,
    outputDirectory: safePath(value.outputDirectory || path.join(dataRoot, 'client-packages')) };
  return plan ? manager.managedSettings(options, plan, legacy) : legacy;
}
function statusFile(options, targetId) {
  if (!ID.test(targetId)) throw Error('Ungültige Paket-Zielkennung.');
  return path.join(path.dirname(path.resolve(options.data)), 'client-package-status', targetId + '.json');
}
function report(options, plan, doc) {
  const value = { format: 1, targetId: plan.target.id, sourcePlanId: plan.id, ...doc, updatedAt: new Date().toISOString() };
  atomicJson(statusFile(options, plan.target.id), value);
  return value;
}
function clientConfiguration(config, schema, clientDirectory) {
  // Explicit projection: no names, descriptions, server paths, settings or unknown keys.
  const projected = { gameDirectory: clientDirectory, outputDirectory: './output', settings: { keepTempFiles: false, keepModdedFiles: false }, kfcParserVersion: '' };
  for (const category of schema) {
    if (!Array.isArray(category.Mods)) continue;
    projected[category.Key] = {};
    for (const mod of category.Mods) {
      const source = config[category.Key]?.[mod.Key];
      if (!source || typeof source.enabled !== 'boolean') throw Error('Clientprofil unvollständig: ' + mod.Key);
      const values = { enabled: !mod.ServerOnly && source.enabled };
      for (const field of mod.Fields || []) values[field.Key] = source[field.Key];
      projected[category.Key][mod.Key] = values;
    }
  }
  return projected;
}
function publicOptions(config, schema) {
  const projected = clientConfiguration(config, schema, '');
  delete projected.gameDirectory; delete projected.outputDirectory; delete projected.settings; delete projected.kfcParserVersion;
  return projected;
}
function restrictedOutput(output, plan, clientDirectory, data) {
  // Only a validated manager binding permits its exact reserved output folder.
  const managedOutput = manager.allowedOutput(output, plan);
  for (const root of [plan.target.dir, clientDirectory, path.join(data, 'jobs')].filter(Boolean)) {
    if (managedOutput && path.resolve(root) === path.resolve(plan.target.dir)) continue;
    const rel = path.relative(path.resolve(root), output);
    if (!rel || (rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel))) throw Error('Paketordner muss außerhalb von Spielinstallation und temporären Patch-Jobs liegen.');
  }
  // Reject linked ancestors before writing or cleaning any export.
  let cursor = output;
  while (true) { if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink()) throw Error('Verknüpfter Paketpfad ist nicht erlaubt.'); const parent = path.dirname(cursor); if (parent === cursor) break; cursor = parent; }
}
function describeClientBasis(options, directory) {
  const targetId = crypto.createHash('sha256').update(JSON.stringify(path.resolve(directory).toLowerCase())).digest('hex').slice(0, 20);
  const exeFile = path.join(directory, 'enshrouded.exe'), exeHash = delta.hashFile(exeFile);
  const stateFile = path.join(options.data, 'targets', targetId, 'state.json');
  let base = directory;
  if (fs.existsSync(stateFile)) {
    const state = read(stateFile);
    if (state.exeHash !== exeHash || !/^basis-\d+$/.test(state.basis || '') || !ARCHIVES.every(name => delta.hashFile(path.join(directory, name)) === state.currentArchives?.[name])) throw Error('Clientbasis wurde außerhalb des Tools geändert.');
    base = path.join(options.data, 'targets', targetId, state.basis);
    if (!ARCHIVES.every(name => delta.hashFile(path.join(base, name)) === state.basisArchives?.[name])) throw Error('Gespeicherte Clientbasis ist beschädigt.');
  }
  return { directory: base, exeFile, exeHash, archives: Object.fromEntries(ARCHIVES.map(name => [name, delta.hashFile(path.join(base, name))])) };
}
function reusablePackage(options, plan, setup, config, basis) {
  const packages = path.join(setup.outputDirectory, plan.target.id, 'packages');
  if (!fs.existsSync(packages)) return null;
  noLinks(packages);
  const expectedOptions = publicOptions(config, read(path.join(options.root, '..', 'assets', 'schema.json')));
  const engineFingerprint = digest(read(path.join(options.root, 'engine-manifest.json')));
  for (const name of fs.readdirSync(packages).filter(name => SHA.test(name))) {
    const directory = path.join(packages, name), ownerFile = path.join(directory, '.studio-owned.json');
    if (!fs.existsSync(ownerFile) || read(ownerFile).format !== FORMAT) continue;
    const manifest = read(path.join(directory, 'manifest.json'));
    if (manifest.gameBuild !== String(plan.build) || manifest.engineFingerprint !== engineFingerprint || manifest.requiredClientExeSha256 !== basis.exeHash || canonical(manifest.options) !== canonical(expectedOptions)) continue;
    // A client patch already has verified concrete output. Reuse only those exact
    // bytes; server preparation can avoid a redundant client repack altogether.
    if (!plan.target.server && (manifest.files.length !== plan.artifacts.length || !plan.artifacts.every(artifact => manifest.files.some(file => file.path === artifact.name && file.delta.result.sha256 === artifact.sha256)))) continue;
    if (!ARCHIVES.every(archive => manifest.files.find(file => file.path === archive)?.delta.base?.sha256 === basis.archives[archive])) continue;
    verifyPayload(directory, manifest);
    if (manifest.revision !== name) throw Error('Gespeicherte Paketrevision passt nicht zum Verzeichnis.');
    return { directory, basis, revision: manifest.revision };
  }
  return null;
}
function reusePackage(options, sourcePlan, cached, setup) {
  const expectedRoot = path.join(setup.outputDirectory, sourcePlan.target.id, 'packages');
  if (path.dirname(path.resolve(cached.directory)) !== path.resolve(expectedRoot) || !SHA.test(path.basename(cached.directory))) throw Error('Gespeichertes Clientpaket liegt außerhalb dieses Exports.');
  noLinks(cached.directory);
  if (delta.hashFile(cached.basis.exeFile) !== cached.basis.exeHash || !ARCHIVES.every(name => delta.hashFile(path.join(cached.basis.directory, name)) === cached.basis.archives[name])) throw Error('Clientbasis des wiederverwendeten Pakets wurde verändert.');
  const manifest = read(path.join(cached.directory, 'manifest.json')); verifyPayload(cached.directory, manifest);
  if (manifest.revision !== cached.revision || manifest.revision !== path.basename(cached.directory)) throw Error('Gespeichertes Clientpaket wurde seit der Vorschau ausgetauscht.');
  if (manifest.engineFingerprint !== digest(read(path.join(options.root, 'engine-manifest.json'))) || manifest.gameBuild !== String(sourcePlan.build)) throw Error('Version des gespeicherten Clientpakets passt nicht mehr.');
  if (manifest.requiredClientExeSha256 !== cached.basis.exeHash || !ARCHIVES.every(name => manifest.files.find(file => file.path === name)?.delta.base?.sha256 === cached.basis.archives[name]) || canonical(manifest.options) !== canonical(publicOptions(sourcePlan.config, read(path.join(options.root, '..', 'assets', 'schema.json'))))) throw Error('Gespeichertes Clientpaket passt nicht zum angewendeten Profil.');
  const manifestFile = path.join(cached.directory, 'manifest.json');
  return { targetRoot: path.dirname(path.dirname(cached.directory)), packageDirectory: cached.directory, revision: manifest.revision,
    manifestSha256: delta.hashFile(manifestFile), downloadBytes: manifest.blobs.reduce((n, blob) => n + blob.size, fs.statSync(manifestFile).size),
    gameBuild: manifest.gameBuild, studioVersion: manifest.studioVersion, multiplayerId: manifest.multiplayerId, reused: true };
}
async function prepareForPlan(options, plan, prepare) {
  let setup, clientPlanFile = null;
  try {
    setup = settings(options, plan);
    restrictedOutput(setup.outputDirectory, plan, setup.clientBasisDirectory, options.data);
    if (!setup.enabled) return { status: 'disabled', message: 'Automatische Clientpakete sind ausgeschaltet.', setup };
    if (!plan.target.server) {
      const cached = reusablePackage(options, plan, setup, plan.config, describeClientBasis(options, plan.target.dir));
      return { status: 'prepared', role: 'client', setup, cached };
    }
    if (setup.transportMode === 'resource-recipe') {
      const schema = read(path.join(options.root, '..', 'assets', 'schema.json'));
      const recipe = resourceRecipe.prepare({engineRoot: options.root, job: plan.job, plan, options: publicOptions(plan.config, schema)});
      return {status: 'prepared', role: 'server', setup, recipe};
    }
    if (!setup.clientBasisDirectory) return { status: manager.bindingFor(plan.target) ? 'waiting-client-basis' : 'blocked', message: manager.bindingFor(plan.target) ? 'Keine eindeutige passende lokale Clientinstallation gefunden. Clientbasis im Studio einmal auswählen; es werden keine Dateien von Spielern hochgeladen.' : 'Clientpaket fehlt: Unter Werkzeuge einmal eine passende Clientbasis wählen.', setup };
    const source = setup.clientBasisDirectory;
    if (!ARCHIVES.every(name => fs.existsSync(path.join(source, name))) || !fs.existsSync(path.join(source, 'enshrouded.exe')) || fs.existsSync(path.join(source, 'enshrouded_server.exe')))
      throw Error('Clientbasis muss eine vollständige, getrennte Spielclient-Installation enthalten.');
    const schema = read(path.join(options.root, '..', 'assets', 'schema.json'));
    const config = clientConfiguration(plan.config, schema, source);
    const cached = reusablePackage(options, plan, setup, config, describeClientBasis(options, source));
    if (cached) return { status: 'prepared', role: 'server', setup, cached };
    const configPath = path.join(plan.job, 'client-package-config.json');
    atomicJson(configPath, config);
    if (options.progress) options.progress({ stage: 'client-package-prepare', message: 'Passende Clientänderungen auf einer getrennten Kopie vorbereiten …', progress: 89 });
    const clientPlan = await prepare({ ...options, configPath, skipClientPackage: true,
      progress: event => { if (options.progress) options.progress({ ...event, stage: 'client-package-prepare', message: 'Clientpaket: ' + event.message, progress: 89 }); } });
    // A marker makes later cleanup exclusive to this explicitly generated preview.
    atomicJson(path.join(clientPlan.job, '.client-package-preview.json'), { sourcePlanId: plan.id });
    clientPlanFile = path.join(clientPlan.job, 'plan.json');
    if (String(clientPlan.build) !== String(plan.build)) throw Error('Clientbasis und Server haben unterschiedliche Spielbuilds.');
    if (clientPlan.target.server) throw Error('Für Clientpakete dürfen keine Serverarchive verwendet werden.');
    const serverMP = plan.mods?.skeletonSpells?.multiplayer?.shortId;
    if (serverMP && serverMP !== clientPlan.mods?.skeletonSpells?.multiplayer?.shortId) throw Error('Server- und Client-Beschwörungsdaten passen nicht zusammen.');
    return { status: 'prepared', role: 'server', setup, clientPlanFile };
  } catch (error) { return { status: 'blocked', message: 'Clientpaket nicht vorbereitet: ' + error.message, setup: setup || null, clientPlanFile }; }
}
function validatePlan(plan) {
  if (!plan || plan.target?.server !== false || plan.target.name !== 'enshrouded' || !ID.test(plan.target.id) || !SHA.test(plan.source?.exe)) throw Error('Geprüfter Clientplan fehlt.');
  if (typeof plan.build !== 'string' && typeof plan.build !== 'number') throw Error('Client-Spielbuild fehlt.');
  if (!Array.isArray(plan.artifacts) || !ARCHIVES.every(name => plan.artifacts.some(row => row.name === name))) throw Error('Clientplan enthält nicht beide Archive.');
  const names = new Set();
  for (const row of plan.artifacts) {
    if (!(ARCHIVES.includes(row.name) || /^enshrouded_\d+\.dat$/.test(row.name)) || !SHA.test(row.sha256) || names.has(row.name)) throw Error('Ungültige Clientdatei im Paketplan.');
    names.add(row.name);
  }
  if (plan.modifiedFiles !== plan.verifiedFiles) throw Error('Clientänderungen wurden nicht vollständig zurückgelesen.');
}
function baseDirectory(options, plan) {
  const stateFile = path.join(options.data, 'targets', plan.target.id, 'state.json');
  if (!fs.existsSync(stateFile)) return plan.target.dir;
  const state = read(stateFile);
  if (state.exeHash !== plan.source.exe || typeof state.basis !== 'string' || !/^basis-\d+$/.test(state.basis)) throw Error('Passende gespeicherte Clientbasis fehlt.');
  return path.join(options.data, 'targets', plan.target.id, state.basis);
}
function verifyPayload(directory, manifest) {
  if (manifest.formatVersion === 2) return verifyResourcePayload(directory, manifest);
  if (manifest.format !== FORMAT || manifest.formatVersion !== VERSION || manifest.targetRole !== 'client') throw Error('Unbekanntes Clientpaket.');
  const { revision, ...identity } = manifest;
  if (!SHA.test(revision) || digest(identity) !== revision) throw Error('Clientpaket-Manifest beschädigt.');
  const expectedBlobs = new Map(), names = new Set();
  for (const file of manifest.files) {
    if (!(ARCHIVES.includes(file.path) || /^enshrouded_\d+\.dat$/.test(file.path)) || names.has(file.path)) throw Error('Ungültiges Client-Dateiinventar.');
    names.add(file.path); delta.validate(file.delta);
    for (const blob of file.delta.blobs) {
      const previous = expectedBlobs.get(blob.sha256);
      if (previous && canonical(previous) !== canonical(blob)) throw Error('Widersprüchlicher Paketblock.');
      expectedBlobs.set(blob.sha256, blob);
    }
  }
  if (!ARCHIVES.every(name => names.has(name)) || canonical([...expectedBlobs.values()].sort((a,b)=>a.sha256.localeCompare(b.sha256))) !== canonical(manifest.blobs)) throw Error('Unvollständiges Paket-Dateiinventar.');
  for (const blob of manifest.blobs) {
    if (!SHA.test(blob.sha256) || blob.path !== 'blobs/' + blob.sha256) throw Error('Ungültiger Paketinhalt.');
    const file = path.join(directory, 'blobs', blob.sha256);
    if (fs.statSync(file).size !== blob.size || delta.hashFile(file) !== blob.sha256) throw Error('Clientpaket-Payload beschädigt.');
  }
  return true;
}
function verifyResourcePayload(directory, manifest) {
  const {revision,...identity}=manifest;
  if(manifest.format!==FORMAT||manifest.formatVersion!==2||manifest.requiredCapability!==resourceRecipe.CAPABILITY||manifest.targetRole!=='client'||!SHA.test(revision||'')||digest(identity)!==revision||Object.hasOwn(manifest,'requiredClientExeSha256')||Object.hasOwn(manifest,'files'))throw Error('Unbekanntes Ressourcenpaket.');
  const descriptor=manifest.recipe;
  if(!descriptor||Object.keys(descriptor).sort().join('|')!==['format','formatVersion','encoding','size','sha256','delta'].sort().join('|')||descriptor.format!==resourceRecipe.FORMAT||descriptor.formatVersion!==1||descriptor.encoding!=='gzip-json'||!SHA.test(descriptor.sha256||'')||!Number.isSafeInteger(descriptor.size)||descriptor.size<1||descriptor.size>resourceRecipe.MAX_BYTES)throw Error('Ungültiger Rezeptnachweis.');
  const blocks=delta.validate(descriptor.delta);
  if(descriptor.delta.base!==null||descriptor.delta.result.size>resourceRecipe.MAX_COMPRESSED||canonical([...blocks.values()].sort((a,b)=>a.sha256.localeCompare(b.sha256)))!==canonical(manifest.blobs))throw Error('Ungültiges Rezeptinventar.');
  const chunks=[];
  for(const op of descriptor.delta.operations){if(!Object.hasOwn(op,'blob'))throw Error('Ressourcenpakete dürfen keine fremden Archivbereiche kopieren.');const block=blocks.get(op.blob),file=path.join(directory,'blobs',op.blob);if(fs.lstatSync(file).isSymbolicLink()||fs.statSync(file).size!==block.size)throw Error('Ungültiger Rezeptblock.');const bytes=fs.readFileSync(file);if(resourceRecipe.digest(bytes)!==block.sha256)throw Error('Rezeptblock wurde verändert.');chunks.push(bytes);}
  const packed=Buffer.concat(chunks);
  if(packed.length!==descriptor.delta.result.size||resourceRecipe.digest(packed)!==descriptor.delta.result.sha256)throw Error('Komprimiertes Rezept ist beschädigt.');
  const bytes=require('zlib').gunzipSync(packed,{maxOutputLength:resourceRecipe.MAX_BYTES});
  if(bytes.length!==descriptor.size||resourceRecipe.digest(bytes)!==descriptor.sha256)throw Error('Rezept ist beschädigt.');
  const recipe=JSON.parse(bytes.toString('utf8'));
  if(canonical(recipe)!==bytes.toString('utf8')||recipe.gameBuild!==manifest.gameBuild||recipe.engineFingerprint!==manifest.engineFingerprint||canonical(recipe.options)!==canonical(manifest.options))throw Error('Rezept und Paketstand stimmen nicht überein.');
  resourceRecipe.validate(recipe,require('./skeleton-spell-definitions.json'));
  return true;
}
function buildResourcePackage(options,plan,setup) {
  const prepared=plan.clientPackagePreparation?.recipe;
  const loaded=resourceRecipe.load(prepared,plan.job,options.root),recipe=loaded.recipe;
  const engine=read(path.join(options.root,'engine-manifest.json')),schema=read(path.join(options.root,'..','assets','schema.json'));
  const config=publicOptions(plan.config,schema);
  if(recipe.gameBuild!==String(plan.build)||recipe.engineFingerprint!==digest(engine)||canonical(recipe.options)!==canonical(config))throw Error('Änderungsrezept passt nicht zum angewendeten Serverpatch.');
  restrictedOutput(setup.outputDirectory,plan,null,options.data);
  const targetRoot=path.join(setup.outputDirectory,plan.target.id),packages=path.join(targetRoot,'packages');
  fs.mkdirSync(packages,{recursive:true});noLinks(targetRoot);
  atomicJson(path.join(targetRoot,'.studio-export.json'),{format:FORMAT,targetId:plan.target.id});
  const work=path.join(packages,'.building-'+crypto.randomBytes(8).toString('hex'));fs.mkdirSync(work);
  atomicJson(path.join(work,'.studio-owned.json'),{format:FORMAT,version:2});let retained=false;
  try {
    storage.assertSpace([{path:setup.outputDirectory,bytes:prepared.compressedSize+8*1024*1024,reason:'Änderungsrezept und atomare Paketmetadaten'}],{probe:options.spaceProbe,reserveBytes:options.spaceReserveBytes});
    const patch=delta.createDelta(null,loaded.file,work);
    const mods=schema.flatMap(category=>category.Mods.filter(mod=>config[category.Key]?.[mod.Key]?.enabled).map(mod=>({id:category.Key+'.'+mod.Key,name:mod.Title,archiveVerified:true,gameplayVerified:false})));
    const identity={format:FORMAT,formatVersion:2,requiredCapability:resourceRecipe.CAPABILITY,targetRole:'client',game:'enshrouded',gameBuild:recipe.gameBuild,studioVersion:engine.studio,engineVersion:engine.version,engineFingerprint:recipe.engineFingerprint,basisProvenance:'local-client-basis-resource-checked',options:config,mods,gameplayVerified:false,multiplayerId:plan.mods?.skeletonSpells?.multiplayer?.shortId||null,managedFilePolicy:'complete-inventory-remove-only-files-owned-by-previous-package',recipe:{format:resourceRecipe.FORMAT,formatVersion:1,encoding:'gzip-json',size:prepared.size,sha256:prepared.sha256,delta:patch},blobs:patch.blobs};
    const manifest={...identity,revision:digest(identity)};
    atomicJson(path.join(work,'manifest.json'),manifest);verifyPayload(work,manifest);
    const final=path.join(packages,manifest.revision);
    if(fs.existsSync(final)){noLinks(final);const saved=read(path.join(final,'manifest.json'));verifyPayload(final,saved);if(canonical(saved)!==canonical(manifest))throw Error('Rezept-Revisionskonflikt.');}
    else {fs.renameSync(work,final);retained=true;}
    const manifestFile=path.join(final,'manifest.json');
    return {targetRoot,packageDirectory:final,revision:manifest.revision,manifestSha256:delta.hashFile(manifestFile),downloadBytes:manifest.blobs.reduce((sum,b)=>sum+b.size,fs.statSync(manifestFile).size),gameBuild:manifest.gameBuild,studioVersion:manifest.studioVersion,multiplayerId:manifest.multiplayerId,requiredCapability:resourceRecipe.CAPABILITY,packageFormatVersion:2,recipeRevision:prepared.sha256};
  } finally {if(!retained&&fs.existsSync(work)){noLinks(work);fs.rmSync(work,{recursive:true});}}
}
function buildPackage(options, sourcePlan, clientPlan, setup) {
  validatePlan(clientPlan);
  if (delta.hashFile(path.join(clientPlan.target.dir, 'enshrouded.exe')) !== clientPlan.source.exe) throw Error('Client-Spielversion wurde seit der Vorbereitung verändert.');
  restrictedOutput(setup.outputDirectory, sourcePlan, clientPlan.target.dir, options.data);
  const targetRoot = path.join(setup.outputDirectory, sourcePlan.target.id);
  const packages = path.join(targetRoot, 'packages');
  fs.mkdirSync(packages, { recursive: true }); noLinks(targetRoot);
  atomicJson(path.join(targetRoot, '.studio-export.json'), { format: FORMAT, targetId: sourcePlan.target.id });
  const work = path.join(packages, '.building-' + crypto.randomBytes(8).toString('hex'));
  fs.mkdirSync(work); atomicJson(path.join(work, '.studio-owned.json'), { format: FORMAT, version: VERSION });
  let retained = false;
  try {
    const base = baseDirectory(options, clientPlan);
    const results = clientPlan.artifacts.map(row => ({ row, file: path.join(clientPlan.job, 'game', row.name) }));
    const estimate = results.reduce((n, item) => n + fs.statSync(item.file).size, 0);
    storage.assertSpace([{ path: setup.outputDirectory, bytes: estimate + 8 * 1024 * 1024, reason: 'Clientpaket und atomare Paketmetadaten' }], { probe: options.spaceProbe, reserveBytes: options.spaceReserveBytes });
    const files = [], allBlobs = new Map();
    for (const { row, file } of results.sort((a, b) => a.row.name.localeCompare(b.row.name))) {
      if (delta.hashFile(file) !== row.sha256) throw Error('Client-Vorschauartefakt wurde verändert: ' + row.name);
      const original = ARCHIVES.includes(row.name) ? path.join(base, row.name) : null;
      if (original && delta.hashFile(original) !== clientPlan.baseHashes[row.name]) throw Error('Client-Ausgangsarchiv wurde verändert: ' + row.name);
      const patch = delta.createDelta(original, file, work);
      if (patch.result.sha256 !== row.sha256) throw Error('Paket-Ergebnisprüfung fehlgeschlagen: ' + row.name);
      for (const blob of patch.blobs) allBlobs.set(blob.sha256, blob);
      files.push({ path: row.name, delta: patch });
    }
    const schema = read(path.join(options.root, '..', 'assets', 'schema.json'));
    const engine = read(path.join(options.root, 'engine-manifest.json'));
    const config = publicOptions(clientPlan.config, schema);
    const mods = schema.flatMap(category => category.Mods.filter(mod => config[category.Key]?.[mod.Key]?.enabled)
      .map(mod => ({ id: category.Key + '.' + mod.Key, name: mod.Title, archiveVerified: true, gameplayVerified: false })));
    const identity = { format: FORMAT, formatVersion: VERSION, requiredCapability: 'enshrouded-studio-client-package-v1', targetRole: 'client', game: 'enshrouded',
      gameBuild: String(clientPlan.build), studioVersion: engine.studio, engineVersion: engine.version,
      engineFingerprint: digest(engine), requiredClientExeSha256: clientPlan.source.exe,
      basisProvenance: 'hash-bound-files-not-independently-proven-vanilla',
      options: config, mods, gameplayVerified: false,
      multiplayerId: clientPlan.mods?.skeletonSpells?.multiplayer?.shortId || null,
      managedFilePolicy: 'complete-inventory-remove-only-files-owned-by-previous-package',
      files, blobs: [...allBlobs.values()].sort((a, b) => a.sha256.localeCompare(b.sha256)) };
    const manifest = { ...identity, revision: digest(identity) };
    atomicJson(path.join(work, 'manifest.json'), manifest);
    verifyPayload(work, manifest);
    const final = path.join(packages, manifest.revision);
    if (fs.existsSync(final)) {
      noLinks(final); verifyPayload(final, read(path.join(final, 'manifest.json')));
      if (canonical(read(path.join(final, 'manifest.json'))) !== canonical(manifest)) throw Error('Paket-Revisionskonflikt.');
    } else { fs.renameSync(work, final); retained = true; }
    const manifestFile = path.join(final, 'manifest.json');
    return { targetRoot, packageDirectory: final, revision: manifest.revision, manifestSha256: delta.hashFile(manifestFile),
      downloadBytes: manifest.blobs.reduce((n, blob) => n + blob.size, fs.statSync(manifestFile).size), gameBuild: manifest.gameBuild,
      studioVersion: manifest.studioVersion, multiplayerId: manifest.multiplayerId };
  } finally { if (!retained && fs.existsSync(work)) { noLinks(work); fs.rmSync(work, { recursive: true }); } }
}
function cleanupPreview(options, sourcePlan) {
  const file = sourcePlan.clientPackagePreparation?.clientPlanFile;
  if (!file) return;
  const job = path.dirname(file), jobs = path.resolve(options.data, 'jobs');
  if (path.dirname(path.resolve(job)) !== jobs || !/^\d+-[a-f0-9]+$/.test(path.basename(job))) throw Error('Unbekannter Client-Arbeitsordner.');
  const marker = read(path.join(job, '.client-package-preview.json'));
  if (marker.sourcePlanId !== sourcePlan.id || read(file).applied !== false || fs.existsSync(path.join(job, 'transaction.json'))) throw Error('Client-Arbeitskopie ist nicht für die Paketbereinigung freigegeben.');
  noLinks(job);
  for (const name of ['game', 'bin', 'unpacked', 'modified', 'verify', 'localization']) {
    const directory = path.join(job, name);
    if (fs.existsSync(directory)) fs.rmSync(directory, { recursive: true });
  }
  // It must not remain the user's interactive preview after its scratch was removed.
  const plan = read(file), link = path.join(options.data, 'latest-' + plan.target.id + '.json');
  if (fs.existsSync(link) && read(link).job === plan.id) fs.unlinkSync(link);
}
function prunePackages(targetRoot, current, previous) {
  const directory = path.join(targetRoot, 'packages'); noLinks(directory);
  for (const name of fs.readdirSync(directory)) {
    if (!SHA.test(name) || name === current || name === previous) continue;
    const folder = path.join(directory, name), owner = path.join(folder, '.studio-owned.json');
    if (!fs.existsSync(owner) || read(owner).format !== FORMAT) continue;
    const manifest = read(path.join(folder, 'manifest.json'));
    if (manifest.revision !== name) continue;
    // Only exact immutable directories produced by this exporter are removed.
    noLinks(folder); fs.rmSync(folder, { recursive: true });
  }
}
function retireKnownExport(options, plan) {
  const file = statusFile(options, plan.target.id);
  if (!fs.existsSync(file)) return null;
  const previous = read(file);
  if (!previous.targetRoot || typeof previous.targetRoot !== 'string') return null;
  const root = safePath(previous.targetRoot);
  if (path.basename(root) !== plan.target.id) throw Error('Gespeicherter Paketordner passt nicht zur Installation.');
  restrictedOutput(path.dirname(root), plan, null, options.data); noLinks(root);
  const ownerFile = path.join(root, '.studio-export.json');
  if (!fs.existsSync(ownerFile)) return null;
  const owner = read(ownerFile);
  if (owner.format !== FORMAT || owner.targetId !== plan.target.id) throw Error('Gespeicherter Paketordner gehört nicht zu diesem Export.');
  const pointer = path.join(root, 'current.json');
  if (!fs.existsSync(pointer)) return null;
  const old = read(pointer);
  fs.renameSync(pointer, path.join(root, 'previous-current.json'));
  return old;
}
function completeForPlan(options, plan, state) {
  const preparation = plan.clientPackagePreparation;
  let value, priorIndex = null, previous = null;
  try {
    if (plan.applied !== true || state.lastJob !== plan.id || !plan.target.archives.every(name => state.currentArchives[name] === plan.artifacts.find(row => row.name === name)?.sha256))
      throw Error('Patchanwendung für die Paketerstellung nicht bestätigt.');
    priorIndex = retireKnownExport(options, plan);
    // Remove the previous ready pointer before any potentially failing export work.
    // The immutable package remains available as a fallback, never as the new state.
    const oldSetup = preparation?.setup;
    if (oldSetup) {
      restrictedOutput(oldSetup.outputDirectory, plan, oldSetup.clientBasisDirectory, options.data);
      const oldRoot = path.join(oldSetup.outputDirectory, plan.target.id), oldFile = path.join(oldRoot, 'current.json');
      if (fs.existsSync(oldFile)) {
        noLinks(oldRoot); priorIndex = read(oldFile);
        fs.renameSync(oldFile, path.join(oldRoot, 'previous-current.json'));
      }
    }
    const currentSetup = settings(options, plan);
    restrictedOutput(currentSetup.outputDirectory, plan, currentSetup.clientBasisDirectory, options.data);
    if (!preparation || digest(currentSetup) !== digest(preparation.setup)) throw Error('Paketeinrichtung wurde seit der Vorschau geändert. Erneut patchen.');
    const targetRoot = path.join(currentSetup.outputDirectory, plan.target.id), currentFile = path.join(targetRoot, 'current.json');
    if (priorIndex?.status === 'ready' && SHA.test(priorIndex.revision)) previous = priorIndex.revision;
    // Fail closed immediately after commit; an old package is never advertised as current.
    atomicJson(currentFile, { format: 1, status: 'building', sourcePlanId: plan.id, targetId: plan.target.id });
    for (const artifact of plan.artifacts) {
      if (delta.hashFile(path.join(plan.target.dir, artifact.name)) !== artifact.sha256) throw Error('Angewendete Datei wurde vor dem Paketexport verändert: ' + artifact.name);
    }
    if (preparation.status !== 'prepared') {
      value = report(options, plan, { status: preparation.status, message: preparation.message, revision: null, packageDirectory: null });
      atomicJson(currentFile, { format: 1, ...value }); manager.complete(options, plan, state, value); return value;
    }
    if (options.progress) options.progress({ stage: 'client-package', message: 'Clientpaket aus den geprüften Clientdateien erstellen …', progress: 97 });
    const useRecipe=plan.target.server&&currentSetup.transportMode==='resource-recipe';
    const clientPlan = useRecipe||preparation.cached ? null : plan.target.server ? read(preparation.clientPlanFile) : plan;
    if (clientPlan && String(clientPlan.build) !== String(plan.build)) throw Error('Spielbuild des Clientpakets passt nicht zum angewendeten Patch.');
    const built = useRecipe ? buildResourcePackage(options,plan,currentSetup) : preparation.cached ? reusePackage(options, plan, preparation.cached, currentSetup) : buildPackage(options, plan, clientPlan, currentSetup);
    if (previous === built.revision) previous = SHA.test(priorIndex?.previousRevision || '') ? priorIndex.previousRevision : null;
    const index = { format: 1, status: 'ready', targetId: plan.target.id, sourceRole: plan.target.server ? 'server' : 'client', sourcePlanId: plan.id,
      sourceArchiveHashes: Object.fromEntries(plan.artifacts.map(row => [row.name, row.sha256])), revision: built.revision,
      manifest: 'packages/' + built.revision + '/manifest.json', manifestSha256: built.manifestSha256, gameBuild: built.gameBuild,
      downloadBytes: built.downloadBytes, previousRevision: previous,
      ...(built.requiredCapability?{requiredCapability:built.requiredCapability,packageFormatVersion:built.packageFormatVersion}:{}),
      requiresManagerAdapter: true, published: false, updatedAt: new Date().toISOString() };
    atomicJson(currentFile, index);
    value = report(options, plan, { status: 'ready', message: built.reused ? 'Unverändertes Clientpaket wiederverwendet; Revision bleibt gleich. Noch nicht veröffentlicht.' : 'Clientpaket lokal erstellt; bereit für den Servermanager. Noch nicht veröffentlicht.', ...built, published: false });
    manager.complete(options, plan, state, value);
    try { prunePackages(built.targetRoot, built.revision, previous); } catch (error) { if (options.log) options.log('Alte Clientpakete konnten nicht bereinigt werden: ' + error.message); }
    return value;
  } catch (error) {
    value = { status: 'failed', message: 'Patch angewendet, Clientpaket fehlgeschlagen: ' + error.message, revision: null, packageDirectory: null, published: false };
    try {
      const setup = settings(options, plan); restrictedOutput(setup.outputDirectory, plan, setup.clientBasisDirectory, options.data);
      atomicJson(path.join(setup.outputDirectory, plan.target.id, 'current.json'), { format: 1, targetId: plan.target.id, sourcePlanId: plan.id, ...value });
    } catch (failure) { value.message += ' Paketstatus konnte nicht aktualisiert werden: ' + failure.message; }
    try { manager.complete(options, plan, state, value); } catch (failure) { if (options.log) options.log('Manager-Fehlerstatus konnte nicht geschrieben werden: ' + failure.message); }
    try { return report(options, plan, value); } catch (failure) { value.message += ' Statusdatei konnte nicht geschrieben werden: ' + failure.message; return value; }
  } finally {
    if (value?.status === 'ready' && preparation?.recipe) {
      try {
        const owned=preparation.recipe.file, relative=path.relative(path.resolve(plan.job),path.resolve(owned));
        if(relative!=='client-recipe.json.gz')throw Error('Unbekannte Rezept-Arbeitsdatei bleibt erhalten.');
        if(fs.existsSync(owned)) {
          if(fs.lstatSync(owned).isSymbolicLink()||delta.hashFile(owned)!==preparation.recipe.compressedSha256)throw Error('Veränderte Rezept-Arbeitsdatei bleibt erhalten.');
          fs.unlinkSync(owned);
        }
      } catch(error) {if(options.log)options.log('Rezept-Arbeitskopie konnte nicht bereinigt werden: '+error.message);}
    }
    try { cleanupPreview(options, plan); } catch (error) { if (options.log) options.log('Client-Arbeitskopie konnte nicht bereinigt werden: ' + error.message); }
  }
}
function invalidate(options, target, reason) {
  const plan = { target, id: null };
  try {
    manager.receipt(options, plan, 'invalidated', 'Serverbasis geändert oder wiederhergestellt. Ein neuer erfolgreicher Patch ist erforderlich.');
    retireKnownExport(options, plan);
    const setup = settings(options, plan); restrictedOutput(setup.outputDirectory, plan, setup.clientBasisDirectory, options.data);
    const value = report(options, plan, { status: 'invalidated', message: reason, revision: null, packageDirectory: null, published: false });
    atomicJson(path.join(setup.outputDirectory, target.id, 'current.json'), value);
    return value;
  } catch (error) { if (options.log) options.log('Clientpaket-Status konnte nicht zurückgesetzt werden: ' + error.message); return { status: 'failed', message: error.message }; }
}
module.exports = { FORMAT, VERSION, canonical, digest, settings, statusFile, report, clientConfiguration, publicOptions, prepareForPlan, validatePlan,
  verifyPayload, verifyResourcePayload, buildResourcePackage, buildPackage, completeForPlan, cleanupPreview, invalidate, atomicJson, restrictedOutput };
