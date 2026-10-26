'use strict';
// Adopts a private original SERVER reference into Studio metadata only. This
// module never patches a live installation, executes a tool or downloads data.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const NAME = 'enshrouded_server', ARCHIVES = [NAME + '.kfc', NAME + '.kfc_resources'];
const SHA = /^[a-f0-9]{64}$/, ID = /^[a-f0-9]{20}$/, MAX_ARCHIVE = 64 * 1024 * 1024 * 1024;
const OWNER = '.reference-basis-owned.json';
function fail(message, code = 'REFERENCE_BASIS_INVALID') { const e = Error(message); e.code = code; throw e; }
function present(file) { try { fs.lstatSync(file); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } }
function absolute(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || value.startsWith('\\\\') || /[\r\n\0]/.test(value) || value.split(/[\\/]/).some(p => p === '.' || p === '..')) fail('Ungültiger lokaler Pfad für die Originalreferenz.');
  return path.resolve(value);
}
function comparablePath(value) {
  if (process.platform !== 'win32') return value;
  if (/^\\\\\?\\UNC\\/i.test(value)) value = '\\\\' + value.slice(8);
  else if (value.startsWith('\\\\?\\')) value = value.slice(4);
  return path.normalize(value).toLowerCase();
}
function noLinks(file) {
  let current = path.resolve(file);
  while (true) {
    if (present(current)) {
      if (fs.lstatSync(current).isSymbolicLink()) fail('Verknüpfte Pfade sind für die Originalreferenz nicht erlaubt.');
      // Node 18's native Windows call needs the extended path spelling beyond
      // MAX_PATH. Keep the native check; normalizing its namespace is not a fallback.
      const resolved = fs.realpathSync.native(process.platform === 'win32' ? path.toNamespacedPath(current) : current), equal = comparablePath(resolved) === comparablePath(current);
      if (!equal) fail('Umgeleitete Pfade sind für die Originalreferenz nicht erlaubt.');
    }
    const parent = path.dirname(current); if (parent === current) return; current = parent;
  }
}
function inside(parent, child) { const r = path.relative(parent, child); return !r || r !== '..' && !r.startsWith('..' + path.sep) && !path.isAbsolute(r); }
function archiveMap(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 2 && ARCHIVES.every(n => Object.hasOwn(value, n) && typeof value[n] === 'string' && SHA.test(value[n]));
}
function regular(file, limit = MAX_ARCHIVE) {
  noLinks(file); const s = fs.lstatSync(file);
  if (!s.isFile() || !Number.isSafeInteger(s.size) || s.size <= 0 || s.size > limit) fail('Die Originalreferenz enthält eine fehlende, leere oder zu große Datei.');
  return s;
}
function hashFile(file) {
  regular(file); const h = crypto.createHash('sha256'), chunk = Buffer.alloc(1024 * 1024), fd = fs.openSync(file, 'r');
  try { let n; while ((n = fs.readSync(fd, chunk, 0, chunk.length, null))) h.update(chunk.subarray(0, n)); }
  finally { fs.closeSync(fd); }
  return h.digest('hex');
}
function jsonBytes(value) { return Buffer.from(JSON.stringify(value, null, 2) + '\n'); }
function manifest(file) {
  const stat = regular(file, 16384), bytes = fs.readFileSync(file);
  if (bytes.length !== stat.size) fail('Die Referenzbeschreibung wurde während des Lesens geändert.');
  let value; try { value = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, '')); } catch { fail('Die Referenzbeschreibung ist kein gültiges JSON-Dokument.'); }
  const keys = ['format', 'name', 'exeHash', 'build', 'archives'];
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length || !keys.every(k => Object.hasOwn(value, k)) || value.format !== 1 || value.name !== NAME || typeof value.exeHash !== 'string' || !SHA.test(value.exeHash) || typeof value.build !== 'string' || !value.build.trim() || value.build.length > 512 || /[\x00-\x1f\x7f]/.test(value.build) || !archiveMap(value.archives)) fail('Die Originalreferenz hat ein unbekanntes Format oder gehört nicht zum Dedicated Server.');
  return { value, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
}
function checkLive(target, fingerprint) {
  for (const [name, expected] of [[NAME + '.exe', fingerprint.exe], ...ARCHIVES.map(n => [n, fingerprint.archives[n]])]) if (hashFile(path.join(target.dir, name)) !== expected) fail('Die Serverdateien wurden während der Basisvorbereitung geändert. Vorgang erneut prüfen.', 'REFERENCE_BASIS_SOURCE_CHANGED');
}
function log(options, message) { if (typeof options.log === 'function') { try { options.log(message); } catch {} } }
function cleanupOwned(directory, targetRoot, token, options) {
  if (!directory || !present(directory)) return;
  if (path.dirname(directory) !== targetRoot || !/^(?:\.reference-stage-[0-9]+-[a-f0-9]+|basis-[0-9]+)$/.test(path.basename(directory))) fail('Unbekannter Rücknahmepfad der Originalreferenz.');
  noLinks(directory); const marker = path.join(directory, OWNER); noLinks(marker);
  if (!present(marker) || fs.readFileSync(marker, 'utf8') !== token) { log(options, 'Unbekannte Referenz-Arbeitsdaten bleiben erhalten.'); return; }
  const names = fs.readdirSync(directory);
  if (names.some(n => n !== OWNER && !ARCHIVES.includes(n))) { log(options, 'Zusätzliche fremde Referenz-Arbeitsdaten bleiben erhalten.'); return; }
  for (const name of names) { const file = path.join(directory, name); noLinks(file); if (!fs.lstatSync(file).isFile()) { log(options, 'Fremde Referenz-Arbeitsdaten bleiben erhalten.'); return; } }
  for (const name of names) fs.unlinkSync(path.join(directory, name));
  fs.rmdirSync(directory);
}
function adopt(options) {
  const { target, fingerprint } = options;
  if (!target || target.server !== true) return { adopted: false, reason: 'client-or-unknown-role' };
  if (target.name !== NAME || !ID.test(target.id || '') || !Array.isArray(target.archives) || target.archives.length !== 2 || new Set(target.archives).size !== 2 || !ARCHIVES.every(n => target.archives.includes(n))) fail('Die Originalreferenz unterstützt ausschließlich die zwei Dedicated-Serverarchive.');
  const engineRoot = absolute(options.engineRoot), data = absolute(options.data), live = absolute(target.dir), targetRoot = path.join(data, 'targets', target.id), stateFile = path.join(targetRoot, 'state.json');
  if (inside(live, data)) fail('Die Basis-Metadaten müssen außerhalb der Serverinstallation liegen.');
  noLinks(engineRoot); noLinks(live); noLinks(targetRoot); noLinks(stateFile);
  if (present(stateFile)) return { adopted: false, reason: 'state-exists' };
  const reference = path.join(path.dirname(engineRoot), 'RecoveryBases', NAME), referenceFile = path.join(reference, 'reference.json');
  noLinks(referenceFile);
  if (!present(referenceFile)) return { adopted: false, reason: 'reference-unavailable' };
  if (!fingerprint || typeof fingerprint.exe !== 'string' || !SHA.test(fingerprint.exe) || !archiveMap(fingerprint.archives)) fail('Der aktuelle Serverstand ist für die Basisübernahme nicht vollständig geprüft.');
  const description = manifest(referenceFile), original = description.value;
  if (original.exeHash !== fingerprint.exe) fail('Die private Originalreferenz gehört zu einer anderen Serverversion. Keine alte Basis übernehmen; eine passende Originalreferenz oder saubere Dateien dieser Version verwenden.', 'REFERENCE_BASIS_VERSION_MISMATCH');
  const sizes = {};
  for (const name of ARCHIVES) { const file = path.join(reference, name); sizes[name] = regular(file).size; if (hashFile(file) !== original.archives[name]) fail('Die private Originalreferenz ist beschädigt: ' + name + '. Keine Basis wurde übernommen.', 'REFERENCE_BASIS_HASH_MISMATCH'); }
  checkLive(target, fingerprint);
  // Validate all sources before creating any metadata. The caller holds the
  // target lock; the final state publication additionally refuses any existing file.
  noLinks(targetRoot); fs.mkdirSync(targetRoot, { recursive: true }); noLinks(targetRoot);
  if (present(stateFile)) fail('Während der Prüfung wurde bereits ein Studiozustand angelegt; vorhandene Daten bleiben erhalten.', 'REFERENCE_BASIS_STATE_CHANGED');
  let stamp = Date.now(); if (!Number.isSafeInteger(stamp) || stamp < 0) fail('Ungültiger Zeitpunkt für die Basisübernahme.');
  let final; for (let attempt = 0; attempt < 10000; attempt++, stamp++) { final = path.join(targetRoot, 'basis-' + stamp); if (!present(final)) break; final = null; }
  if (!final) fail('Für die Originalreferenz konnte kein eigener Basisordner angelegt werden.');
  const stage = path.join(targetRoot, '.reference-stage-' + stamp + '-' + crypto.randomBytes(8).toString('hex'));
  const temporary = path.join(targetRoot, '.reference-state-' + crypto.randomBytes(8).toString('hex') + '.tmp');
  const token = JSON.stringify({ format: 1, purpose: 'private-original-server-basis', targetId: target.id, token: crypto.randomBytes(16).toString('hex') }) + '\n';
  let stageCreated = false, ownerWritten = false, promoted = false, temporaryCreated = false, published = false;
  try {
    fs.mkdirSync(stage); stageCreated = true; fs.writeFileSync(path.join(stage, OWNER), token, { flag: 'wx' }); ownerWritten = true;
    for (const name of ARCHIVES) {
      const destination = path.join(stage, name); fs.copyFileSync(path.join(reference, name), destination, fs.constants.COPYFILE_EXCL);
      if (regular(destination).size !== sizes[name] || hashFile(destination) !== original.archives[name]) fail('Die Originalreferenz wurde beim Kopieren verändert. Keine Basis wurde übernommen.', 'REFERENCE_BASIS_COPY_MISMATCH');
    }
    checkLive(target, fingerprint);
    if (present(stateFile)) fail('Während der Basisübernahme wurde bereits ein Studiozustand angelegt; vorhandene Daten bleiben erhalten.', 'REFERENCE_BASIS_STATE_CHANGED');
    noLinks(final); fs.renameSync(stage, final); promoted = true;
    const state = { basis: path.basename(final), exeHash: fingerprint.exe, currentArchives: Object.fromEntries(ARCHIVES.map(n => [n, fingerprint.archives[n]])), basisArchives: Object.fromEntries(ARCHIVES.map(n => [n, original.archives[n]])), addedFiles: [], basisWasCurrentData: false,
      referenceBasis: { format: 1, name: NAME, build: original.build, manifestSha256: description.sha256, source: 'private-original-reference', adoptedAt: new Date().toISOString() } };
    const fd = fs.openSync(temporary, 'wx'); temporaryCreated = true;
    try { fs.writeFileSync(fd, jsonBytes(state)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    noLinks(stateFile);
    if (present(stateFile)) fail('Vorhandener Studiozustand wird nicht durch die Referenzbasis überschrieben.', 'REFERENCE_BASIS_STATE_CHANGED');
    // A same-volume hard link atomically publishes complete bytes with CREATE_NEW
    // semantics. renameSync alone could replace a concurrently created state.
    try { fs.linkSync(temporary, stateFile); }
    catch (error) { if (error.code === 'EEXIST') fail('Vorhandener Studiozustand wird nicht durch die Referenzbasis überschrieben.', 'REFERENCE_BASIS_STATE_CHANGED'); throw error; }
    published = true;
    try { fs.unlinkSync(temporary); temporaryCreated = false; } catch { log(options, 'Eigene temporäre Zustandsdatei konnte noch nicht entfernt werden.'); }
    log(options, 'Unveränderte private Serverreferenz als Ausgangsbasis übernommen; vorhandene Spielarchive wurden nicht geändert.');
    return { adopted: true, basis: state.basis, build: original.build, referenceManifestSha256: description.sha256 };
  } catch (error) {
    const cleanupErrors = [], attemptCleanup = action => { try { action(); } catch (failure) { cleanupErrors.push(failure); log(options, 'Eigene Basis-Arbeitsdaten konnten nicht vollständig zurückgenommen werden: ' + failure.message); } };
    if (!published) {
      attemptCleanup(() => { if (temporaryCreated && present(temporary)) { noLinks(temporary); fs.unlinkSync(temporary); } });
      if (promoted) attemptCleanup(() => cleanupOwned(final, targetRoot, token, options));
      else if (stageCreated && ownerWritten) attemptCleanup(() => cleanupOwned(stage, targetRoot, token, options));
      else if (stageCreated) attemptCleanup(() => {
        noLinks(stage); const names = fs.readdirSync(stage);
        if (!names.length) fs.rmdirSync(stage);
        else if (names.length === 1 && names[0] === OWNER) { const marker = path.join(stage, OWNER); noLinks(marker); if (fs.lstatSync(marker).isFile()) { fs.unlinkSync(marker); fs.rmdirSync(stage); } }
      });
    }
    if (cleanupErrors.length) { try { error.cleanupErrors = (Array.isArray(error.cleanupErrors) ? error.cleanupErrors : []).concat(cleanupErrors); } catch {} }
    throw error;
  }
}
module.exports = { adopt, _test: { hashFile, manifest, noLinks } };
