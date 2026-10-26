'use strict';
// Local, data-only handoff. No network, game launches, impersonation or ACL changes.
const fs = require('fs'), path = require('path'), crypto = require('crypto'), cp = require('child_process');
const BINDING = '.ugsm-studio.json', TRANSFER = '.ugsm-studio-transfer', OWNER = '.studio-handoff-owned.json';
const PROFILE = /^[a-f0-9]{32}$/, TARGET = /^[a-f0-9]{20}$/, JOB = /^\d+-[a-f0-9]+$/, SHA = /^[a-f0-9]{64}$/;
const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' : value && typeof value === 'object' ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}' : JSON.stringify(value);
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const hashFile = file => hash(fs.readFileSync(file));
const targetId = directory => hash(JSON.stringify(path.resolve(directory).toLowerCase())).slice(0, 20);
const samePath = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
function exists(file) { try { fs.lstatSync(file); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } }
function noLinks(file) {
  let cursor = path.resolve(file);
  while (true) {
    if (exists(cursor) && fs.lstatSync(cursor).isSymbolicLink()) throw Error('Verknüpfte Manager-Übergabepfade sind nicht erlaubt.');
    const parent = path.dirname(cursor); if (parent === cursor) break; cursor = parent;
  }
}
function read(file, limit = 65536) {
  noLinks(file); const st = fs.lstatSync(file);
  if (!st.isFile() || st.size > limit) throw Error('Ungültige Manager-Übergabedatei.');
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}
function absolute(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || value.startsWith('\\\\') || /[\r\n\0]/.test(value) || value.split(/[\\/]/).some(p => p === '.' || p === '..')) throw Error('Ungültiger lokaler Managerpfad.');
  noLinks(value); return path.resolve(value);
}
function bindingFor(target) {
  if (!target?.server) return null;
  const directory = absolute(target.dir), file = path.join(directory, BINDING);
  if (!exists(file)) return null;
  const b = read(file, 16384), keys = ['format', 'profileId', 'sourceDirectory', 'targetId', 'automaticClientPackages'];
  if (!b || typeof b !== 'object' || Array.isArray(b) || Object.keys(b).length !== keys.length || !keys.every(k => Object.hasOwn(b, k)) || b.format !== 1 || !PROFILE.test(b.profileId) || !TARGET.test(b.targetId) || b.automaticClientPackages !== true || !samePath(absolute(b.sourceDirectory), directory) || b.targetId !== targetId(directory) || b.targetId !== target.id)
    throw Error('Die Managerbindung gehört nicht zu dieser Serverinstallation.');
  return { ...b, sourceDirectory: directory };
}
const transferDirectory = binding => path.join(binding.sourceDirectory, TRANSFER);
const outputDirectory = binding => path.join(transferDirectory(binding), 'output');
function allowedOutput(output, plan) { const b = bindingFor(plan.target); return b !== null && samePath(output, outputDirectory(b)); }
function atomicJson(file, value) {
  noLinks(file); fs.mkdirSync(path.dirname(file), { recursive: true }); noLinks(path.dirname(file));
  const temporary = file + '.' + crypto.randomBytes(8).toString('hex') + '.tmp';
  try { fs.writeFileSync(temporary, canonical(value) + '\n', { flag: 'wx' }); fs.renameSync(temporary, file); }
  finally { if (exists(temporary)) fs.unlinkSync(temporary); }
}
function owner(binding, kind, id) { return { format: 1, kind, profileId: binding.profileId, targetId: binding.targetId, ...(id ? { sourcePlanId: id } : {}) }; }
function ownedDirectory(directory, marker, create) {
  noLinks(directory);
  if (!exists(directory)) { if (!create) return false; fs.mkdirSync(directory, { recursive: true }); }
  if (!fs.lstatSync(directory).isDirectory()) throw Error('Die reservierte Managerablage ist kein Ordner.');
  const file = path.join(directory, OWNER);
  if (exists(file)) { if (canonical(read(file)) !== canonical(marker)) throw Error('Die reservierte Managerablage gehört zu einer anderen Bindung.'); return true; }
  if (!create || fs.readdirSync(directory).length) throw Error('Unbekannte Daten in der reservierten Managerablage bleiben erhalten.');
  atomicJson(file, marker); return true;
}
function ensureTransfer(binding) { const root = transferDirectory(binding); ownedDirectory(root, owner(binding, 'enshrouded-studio-transfer'), true); return root; }
function validClient(directory, source) {
  try {
    directory = absolute(directory);
    for (const a of [directory, source]) for (const b of [directory, source]) if (a !== b) { const r = path.relative(a, b); if (!r || (!r.startsWith('..' + path.sep) && r !== '..' && !path.isAbsolute(r))) return false; }
    if (samePath(directory, source)) return false;
    for (const name of ['enshrouded_server.exe', 'enshrouded_server.kfc']) if (exists(path.join(directory, name))) return false;
    return ['enshrouded.exe', 'enshrouded.kfc', 'enshrouded.kfc_resources'].every(name => { const file = path.join(directory, name); noLinks(file); const s = fs.lstatSync(file); return s.isFile() && s.size > 0; });
  } catch { return false; }
}
function boundedText(file, limit = 1048576) {
  try { noLinks(file); const s = fs.lstatSync(file); if (!s.isFile() || s.size > limit) return ''; return fs.readFileSync(file, 'utf8'); } catch { return ''; }
}
function steamRoots(options) {
  if (Array.isArray(options.steamRoots)) return options.steamRoots;
  const roots = [];
  if (process.platform === 'win32') {
    for (const key of ['HKCU\\SOFTWARE\\Valve\\Steam', 'HKLM\\SOFTWARE\\Valve\\Steam', 'HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam']) {
      const result = cp.spawnSync('reg.exe', ['query', key], { encoding: 'utf8', windowsHide: true, timeout: 3000, maxBuffer: 65536 });
      if (!result.error && result.status === 0) for (const line of String(result.stdout).split(/\r?\n/)) { const m = line.match(/^\s*(?:SteamPath|InstallPath)\s+REG_SZ\s+(.+?)\s*$/i); if (m) roots.push(m[1]); }
    }
    for (const env of ['ProgramFiles(x86)', 'ProgramFiles']) if (process.env[env]) roots.push(path.join(process.env[env], 'Steam'));
  }
  return roots;
}
function discoveredCandidates(options, source) {
  // Injection is a read-only seam: isolated tests never enumerate personal games.
  if (Array.isArray(options.clientBasisCandidates)) return options.clientBasisCandidates;
  const found = [], profiles = path.join(path.dirname(path.resolve(options.data)), 'profiles');
  try {
    noLinks(profiles); for (const name of fs.readdirSync(profiles).filter(n => /^[a-f0-9]{32}\.json$/.test(n)).sort().slice(0, 256)) {
      try { const value = read(path.join(profiles, name), 2 * 1048576); if (typeof value.config?.gameDirectory === 'string') found.push(value.config.gameDirectory); } catch {}
    }
  } catch {}
  const roots = steamRoots(options), libraries = roots.slice();
  for (const root of roots) {
    const text = boundedText(path.join(root, 'steamapps', 'libraryfolders.vdf'));
    for (const m of text.matchAll(/"path"\s*"((?:\\.|[^"\\])*)"/g)) { if (libraries.length >= 128) break; libraries.push(m[1].replace(/\\\\/g, '\\').replace(/\\"/g, '"')); }
  }
  if (process.platform === 'win32' && !Array.isArray(options.steamRoots)) for (const drive of 'CDEFGHIJKLMNOPQRSTUVWXYZ') libraries.push(drive + ':\\SteamLibrary');
  for (const library of libraries.slice(0, 160)) {
    const text = boundedText(path.join(library, 'steamapps', 'appmanifest_1203620.acf')), match = text.match(/"installdir"\s*"([^"\\\/:<>|?*\x00-\x1f]+)"/);
    if (match && match[1] !== '.' && match[1] !== '..') found.push(path.join(library, 'steamapps', 'common', match[1]));
    found.push(path.join(library, 'steamapps', 'common', 'Enshrouded'));
  }
  return found;
}
function managedSettings(options, plan, legacy) {
  const b = bindingFor(plan.target); if (!b) return legacy;
  let client = null;
  if (legacy.clientBasisDirectory && validClient(legacy.clientBasisDirectory, b.sourceDirectory)) client = path.resolve(legacy.clientBasisDirectory);
  else {
    const candidates = [...new Map(discoveredCandidates(options, b.sourceDirectory).filter(p => validClient(p, b.sourceDirectory)).map(p => [path.resolve(p).toLowerCase(), path.resolve(p)])).values()];
    if (candidates.length === 1) client = candidates[0];
  }
  return { format: 1, enabled: true, clientBasisDirectory: client, outputDirectory: outputDirectory(b) };
}
function engineIdentity(options) {
  const e = read(path.join(options.root, 'engine-manifest.json'), 1048576);
  if (typeof e.studio !== 'string' || typeof e.version !== 'string') throw Error('Engineversion fehlt für die Managerübergabe.');
  return { studioVersion: e.studio, engineVersion: e.version, engineFingerprint: hash(canonical(e)) };
}
function receipt(options, plan, status, message, details = {}) {
  const b = bindingFor(plan.target); if (!b) return null;
  if (!['ready', 'preparing', 'waiting-client-basis', 'failed', 'invalidated'].includes(status)) throw Error('Unbekannter Managerstatus.');
  const root = ensureTransfer(b);
  const value = { format: 1, profileId: b.profileId, sourceDirectory: b.sourceDirectory, targetId: b.targetId, status,
    sourcePlanId: JOB.test(plan.id || '') ? plan.id : null, ...engineIdentity(options), gameBuild: plan.build == null ? null : String(plan.build),
    message, planSha256: null, stateSha256: null, packageRevision: null, ...details, updatedAt: new Date().toISOString() };
  atomicJson(path.join(root, 'handoff.json'), value); return value;
}
function minimalPlan(plan) {
  const spells = plan.mods?.skeletonSpells;
  return { id: plan.id, applied: true, build: String(plan.build), target: { dir: path.resolve(plan.target.dir), server: true }, source: { exe: plan.source.exe },
    artifacts: plan.artifacts.map(a => ({ name: a.name, sha256: a.sha256 })), mods: { skeletonSpells: { enabled: spells?.enabled === true,
      multiplayer: spells?.enabled ? { id: spells.multiplayer?.id, shortId: spells.multiplayer?.shortId } : {} } } };
}
function assertApplied(options, plan, state) {
  if (plan.applied !== true || !JOB.test(plan.id || '') || state.lastJob !== plan.id || !plan.target.server || !SHA.test(plan.source?.exe) || !Array.isArray(plan.artifacts) || plan.artifacts.length < 2 || plan.artifacts.length > 256) throw Error('Angewendeter Serverpatch fehlt für die Managerübergabe.');
  const persistedState = read(path.join(options.data, 'targets', plan.target.id, 'state.json'), 1048576), persistedPlan = read(path.join(options.data, 'jobs', plan.id, 'plan.json'), 8 * 1048576);
  if (persistedState.lastJob !== plan.id || persistedPlan.applied !== true || canonical(minimalPlan(persistedPlan)) !== canonical(minimalPlan(plan))) throw Error('Gespeicherter Serverplan bestätigt die Managerübergabe nicht.');
  noLinks(path.join(plan.target.dir, 'enshrouded_server.exe'));
  if (hashFile(path.join(plan.target.dir, 'enshrouded_server.exe')) !== plan.source.exe) throw Error('Serverversion wurde vor der Managerübergabe geändert.');
  const names = new Set();
  for (const a of plan.artifacts) {
    if (!/^(?:enshrouded_server\.kfc(?:_resources)?|enshrouded_server_\d+\.dat)$/.test(a.name) || names.has(a.name) || !SHA.test(a.sha256)) throw Error('Ungültiges Serverinventar für die Managerübergabe.');
    names.add(a.name); const file = path.join(plan.target.dir, a.name); noLinks(file);
    if (hashFile(file) !== a.sha256) throw Error('Serverdateien wurden vor der Managerübergabe geändert.');
  }
  for (const name of ['enshrouded_server.kfc', 'enshrouded_server.kfc_resources']) if (!names.has(name) || persistedState.currentArchives?.[name] !== plan.artifacts.find(a => a.name === name).sha256) throw Error('Serverzustand bestätigt die Archivdateien nicht.');
}
function immutableJson(file, value) {
  const bytes = canonical(value) + '\n'; noLinks(file);
  if (exists(file)) { if (fs.readFileSync(file, 'utf8') !== bytes) throw Error('Unveränderlicher Managernachweis wurde verändert.'); }
  else { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes, { flag: 'wx' }); }
  return hash(bytes);
}
function pruneSnapshots(binding, keep) {
  const snapshots = path.join(transferDirectory(binding), 'snapshots'); noLinks(snapshots);
  for (const name of fs.readdirSync(snapshots)) {
    if (!JOB.test(name) || keep.includes(name)) continue;
    const directory = path.join(snapshots, name);
    try { if (!ownedDirectory(directory, owner(binding, 'enshrouded-studio-proof', name), false)) continue; }
    catch { continue; }
    // Only self-produced trees, after rejecting every linked descendant.
    const files = [], visit = p => { noLinks(p); const s = fs.lstatSync(p); if (s.isDirectory()) for (const n of fs.readdirSync(p)) visit(path.join(p, n)); else if (!s.isFile()) throw Error('Unbekannte Datei im Nachweisordner.'); else files.push(path.relative(directory, p)); };
    visit(directory);
    const expected = [OWNER, path.join('proofs', 'patches', 'jobs', name, 'plan.json'), path.join('proofs', 'patches', 'targets', binding.targetId, 'state.json')].sort();
    if (canonical(files.sort()) !== canonical(expected)) continue;
    fs.rmSync(directory, { recursive: true });
  }
}
function complete(options, plan, state, packageResult) {
  const b = bindingFor(plan.target); if (!b) return null;
  if (packageResult.status !== 'ready') return receipt(options, plan, packageResult.status === 'waiting-client-basis' ? 'waiting-client-basis' : 'failed', packageResult.status === 'waiting-client-basis' ? 'Serverpatch angewendet. Eine passende lokale Clientinstallation fehlt; es werden keine Dateien von Spielern hochgeladen.' : 'Serverpatch angewendet. Das passende Clientpaket konnte nicht erstellt werden; Studio-Protokoll prüfen.');
  assertApplied(options, plan, state);
  const root = ensureTransfer(b), pointer = read(path.join(outputDirectory(b), b.targetId, 'current.json'));
  if (pointer.status !== 'ready' || pointer.sourceRole !== 'server' || pointer.sourcePlanId !== plan.id || pointer.targetId !== b.targetId || pointer.revision !== packageResult.revision || !SHA.test(pointer.revision) || canonical(pointer.sourceArchiveHashes) !== canonical(Object.fromEntries(plan.artifacts.map(a => [a.name, a.sha256]))) || pointer.manifest !== 'packages/' + pointer.revision + '/manifest.json') throw Error('Clientzeiger bestätigt das Managerpaket nicht.');
  const manifestFile = path.join(outputDirectory(b), b.targetId, ...pointer.manifest.split('/')), manifest = read(manifestFile, 4 * 1048576), { revision, ...identity } = manifest;
  if (hashFile(manifestFile) !== pointer.manifestSha256 || revision !== pointer.revision || hash(canonical(identity)) !== revision || manifest.targetRole !== 'client' || manifest.gameBuild !== String(plan.build)) throw Error('Clientmanifest bestätigt das Managerpaket nicht.');
  const snapshot = path.join(root, 'snapshots', plan.id); ownedDirectory(snapshot, owner(b, 'enshrouded-studio-proof', plan.id), true);
  const proofs = path.join(snapshot, 'proofs', 'patches'), planSha256 = immutableJson(path.join(proofs, 'jobs', plan.id, 'plan.json'), minimalPlan(plan)), stateSha256 = immutableJson(path.join(proofs, 'targets', b.targetId, 'state.json'), { lastJob: plan.id });
  const indexFile = path.join(root, '.studio-snapshot-index.json'); let previous = [];
  if (exists(indexFile)) { const index = read(indexFile); if (!Array.isArray(index.snapshots) || index.snapshots.length > 2 || index.snapshots.some(id => !JOB.test(id))) throw Error('Ungültiger Nachweisindex.'); previous = index.snapshots; }
  const keep = [plan.id, ...previous.filter(id => id !== plan.id)].slice(0, 2); atomicJson(indexFile, { format: 1, snapshots: keep });
  const published = receipt(options, plan, 'ready', 'Serverpatch und passendes Clientpaket sind geprüft. Spieler können synchronisieren.', { planSha256, stateSha256, packageRevision: revision });
  try { pruneSnapshots(b, keep); } catch (e) { if (options.log) options.log('Alte Manager-Nachweise konnten nicht bereinigt werden: ' + e.message); }
  return published;
}
module.exports = { bindingFor, targetId, transferDirectory, outputDirectory, allowedOutput, ensureTransfer, validClient, managedSettings, receipt, complete, assertApplied, minimalPlan,
  _test: { canonical, hash, noLinks, discoveredCandidates, pruneSnapshots } };
