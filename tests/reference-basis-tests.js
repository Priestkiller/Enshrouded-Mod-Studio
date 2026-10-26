'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto'), assert = require('assert');
const api = require('../engine/reference-basis');
const root = fs.mkdtempSync(path.join(__dirname, '.reference-basis-test-')), reports = [];
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const archives = ['enshrouded_server.kfc', 'enshrouded_server.kfc_resources'];
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value)); };
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const check = (name, fn) => { fn(); reports.push(name); console.log('PASS ' + name); };
function fixture(name) {
  const work = path.join(root, name), engineRoot = path.join(work, 'studio', 'engine'), data = path.join(work, 'studio', 'Data', 'patches'), dir = path.join(work, 'game');
  const target = { dir, id: hash(name).slice(0, 20), name: 'enshrouded_server', server: true, archives: archives.slice() };
  const reference = path.join(path.dirname(engineRoot), 'RecoveryBases', target.name), referenceFile = path.join(reference, 'reference.json');
  fs.mkdirSync(engineRoot, { recursive: true });
  write(path.join(dir, 'enshrouded_server.exe'), 'same approved server exe');
  const fingerprint = { exe: hash('same approved server exe'), archives: {} }, original = {};
  for (const name of archives) { write(path.join(dir, name), JSON.stringify({ factorValue: 8, name })); write(path.join(reference, name), JSON.stringify({ factorValue: 2, name })); fingerprint.archives[name] = api._test.hashFile(path.join(dir, name)); original[name] = api._test.hashFile(path.join(reference, name)); }
  const description = { format: 1, name: target.name, exeHash: fingerprint.exe, build: '1273043|synthetic-original', archives: original };
  write(referenceFile, description);
  const targetRoot = path.join(data, 'targets', target.id), stateFile = path.join(targetRoot, 'state.json');
  return { engineRoot, data, target, fingerprint, reference, referenceFile, description, targetRoot, stateFile, log: () => {}, liveBefore: Object.fromEntries(['enshrouded_server.exe', ...archives].map(n => [n, fs.readFileSync(path.join(dir, n), 'utf8')])) };
}
function unchanged(f) { for (const [name, bytes] of Object.entries(f.liveBefore)) assert.equal(fs.readFileSync(path.join(f.target.dir, name), 'utf8'), bytes); }
function noAdoption(f) { assert(!fs.existsSync(f.stateFile)); if (fs.existsSync(f.targetRoot)) assert(!fs.readdirSync(f.targetRoot).some(n => /^basis-|^\.reference-/.test(n))); }
function patch(object, name, replacement, action) { const original = object[name]; object[name] = replacement(original); try { return action(); } finally { object[name] = original; } }
try {
  check('private original reference is copied into metadata without changing live archives', () => {
    const f = fixture('success'), result = api.adopt(f); assert.equal(result.adopted, true); assert(/^basis-\d+$/.test(result.basis));
    const state = json(f.stateFile); assert.equal(state.exeHash, f.fingerprint.exe); assert.equal(state.basisWasCurrentData, false); assert.deepEqual(state.currentArchives, f.fingerprint.archives); assert.deepEqual(state.basisArchives, f.description.archives); assert.deepEqual(state.addedFiles, []); assert.equal(state.referenceBasis.build, f.description.build);
    for (const name of archives) assert.equal(fs.readFileSync(path.join(f.targetRoot, state.basis, name), 'utf8'), fs.readFileSync(path.join(f.reference, name), 'utf8'));
    unchanged(f);
  });
  check('subsequent factor processing reads original value 2 rather than patched value 8', () => {
    const f = fixture('factor'); api.adopt(f); const state = json(f.stateFile), base = path.join(f.targetRoot, state.basis, archives[0]);
    assert.equal(json(base).factorValue * 2, 4); assert.equal(json(path.join(f.target.dir, archives[0])).factorValue * 2, 16); unchanged(f);
  });
  check('existing Studio state is never replaced and does not require reference or fingerprint', () => {
    const f = fixture('existing'); write(f.stateFile, 'preserve existing state exactly'); fs.unlinkSync(f.referenceFile); f.fingerprint = null;
    assert.equal(api.adopt(f).reason, 'state-exists'); assert.equal(fs.readFileSync(f.stateFile, 'utf8'), 'preserve existing state exactly'); unchanged(f);
  });
  check('client roles never adopt server data', () => {
    const f = fixture('client'); f.target.server = false; f.target.name = 'enshrouded'; assert.equal(api.adopt(f).adopted, false); noAdoption(f); unchanged(f);
  });
  check('missing private reference remains an ignored optional source', () => {
    const f = fixture('missing'); fs.unlinkSync(f.referenceFile); assert.equal(api.adopt(f).reason, 'reference-unavailable'); noAdoption(f); unchanged(f);
  });
  check('reference EXE mismatch fails explicitly without using already modified live data', () => {
    const f = fixture('exe-mismatch'); write(f.referenceFile, { ...f.description, exeHash: 'a'.repeat(64) }); assert.throws(() => api.adopt(f), e => e.code === 'REFERENCE_BASIS_VERSION_MISMATCH'); noAdoption(f); unchanged(f);
  });
  check('corrupt or empty reference archive is rejected before any metadata', () => {
    for (const value of ['corrupt', '']) { const f = fixture('corrupt-' + value); write(path.join(f.reference, archives[0]), value); assert.throws(() => api.adopt(f)); noAdoption(f); unchanged(f); }
  });
  check('manifest schema, names, extra keys, build and hashes are strict', () => {
    const variants = [{ format: 2 }, { name: 'enshrouded' }, { surprise: true }, { build: '' }, { build: 'invalid\nline' }, { archives: { [archives[0]]: 'a'.repeat(64) } }, { archives: { ...fixture('schema-other').description.archives, '../outside': 'a'.repeat(64) } }];
    variants.forEach((change, i) => { const f = fixture('schema-' + i); write(f.referenceFile, { ...f.description, ...change }); assert.throws(() => api.adopt(f)); noAdoption(f); unchanged(f); });
  });
  check('target identity and archive inventory cannot escape metadata root', () => {
    for (const [i, change] of [{ id: '../escape' }, { name: '../enshrouded_server' }, { archives: [archives[0], archives[0]] }, { archives: [...archives, 'extra.dat'] }].entries()) { const f = fixture('target-' + i); Object.assign(f.target, change); assert.throws(() => api.adopt(f)); assert(!fs.existsSync(path.join(f.data, 'targets', 'escape'))); unchanged(f); }
  });
  check('metadata inside live game folder is refused', () => {
    const f = fixture('live-data'); f.data = path.join(f.target.dir, 'Data'); assert.throws(() => api.adopt(f)); assert(!fs.existsSync(f.data)); unchanged(f);
  });
  check('current live fingerprint must match before metadata creation', () => {
    const f = fixture('stale-live'); f.fingerprint.archives[archives[0]] = 'a'.repeat(64); assert.throws(() => api.adopt(f), e => e.code === 'REFERENCE_BASIS_SOURCE_CHANGED'); noAdoption(f); unchanged(f);
  });
  check('copy failure rolls back only its owned stage and preserves unrelated files', () => {
    const f = fixture('rollback-copy'); write(path.join(f.targetRoot, 'keep.txt'), 'foreign target file');
    patch(fs, 'copyFileSync', original => function(from, to, flags) { original(from, to, flags); throw Error('injected copy failure'); }, () => assert.throws(() => api.adopt(f), /injected/));
    noAdoption(f); assert.equal(fs.readFileSync(path.join(f.targetRoot, 'keep.txt'), 'utf8'), 'foreign target file'); unchanged(f);
  });
  check('ownership-marker write failure cleans only its newly allocated empty stage', () => {
    const f = fixture('owner-write');
    patch(fs, 'writeFileSync', original => function(file, ...args) { if (String(file).endsWith('.reference-basis-owned.json')) { fs.closeSync(fs.openSync(file, 'wx')); throw Error('injected marker failure'); } return original.call(fs, file, ...args); }, () => assert.throws(() => api.adopt(f), /injected/));
    noAdoption(f); unchanged(f);
  });
  check('copy readback corruption is rejected and rolled back', () => {
    const f = fixture('rollback-corruption');
    patch(fs, 'copyFileSync', original => function(from, to, flags) { original(from, to, flags); fs.appendFileSync(to, 'corrupt'); }, () => assert.throws(() => api.adopt(f), e => e.code === 'REFERENCE_BASIS_COPY_MISMATCH'));
    noAdoption(f); unchanged(f);
  });
  check('state created during copy is preserved and adoption files are rolled back', () => {
    const f = fixture('concurrent-state'); let written = false;
    patch(fs, 'copyFileSync', original => function(from, to, flags) { original(from, to, flags); if (!written) { written = true; write(f.stateFile, 'concurrent state'); } }, () => assert.throws(() => api.adopt(f), e => e.code === 'REFERENCE_BASIS_STATE_CHANGED'));
    assert.equal(fs.readFileSync(f.stateFile, 'utf8'), 'concurrent state'); assert.deepEqual(fs.readdirSync(f.targetRoot), ['state.json']); unchanged(f);
  });
  check('atomic state publication cannot overwrite a last-moment concurrent state', () => {
    const f = fixture('atomic-collision');
    patch(fs, 'linkSync', original => function(from, to) { write(to, 'last-moment state'); return original(from, to); }, () => assert.throws(() => api.adopt(f), e => e.code === 'REFERENCE_BASIS_STATE_CHANGED'));
    assert.equal(fs.readFileSync(f.stateFile, 'utf8'), 'last-moment state'); assert.deepEqual(fs.readdirSync(f.targetRoot), ['state.json']); unchanged(f);
  });
  check('state publication failure removes owned basis and temp but leaves existing folders', () => {
    const f = fixture('publish-failure'); write(path.join(f.targetRoot, 'basis-1', 'foreign.txt'), 'keep');
    patch(fs, 'linkSync', () => function() { throw Error('injected publication failure'); }, () => assert.throws(() => api.adopt(f), /injected/));
    assert(!fs.existsSync(f.stateFile)); assert.deepEqual(fs.readdirSync(f.targetRoot), ['basis-1']); assert.equal(fs.readFileSync(path.join(f.targetRoot, 'basis-1', 'foreign.txt'), 'utf8'), 'keep'); unchanged(f);
  });
  check('state serialization failure after promotion removes its owned basis and temp', () => {
    const f = fixture('state-write');
    patch(fs, 'writeFileSync', original => function(file, ...args) { if (typeof file === 'number') throw Error('injected state write failure'); return original.call(fs, file, ...args); }, () => assert.throws(() => api.adopt(f), /injected/));
    noAdoption(f); unchanged(f);
  });
  check('unrelated files injected into an owned stage prevent broad rollback deletion', () => {
    const f = fixture('foreign-stage'); let foreign;
    patch(fs, 'copyFileSync', () => function(from, to) { foreign = path.join(path.dirname(to), 'foreign.txt'); fs.writeFileSync(foreign, 'preserve'); throw Error('injected'); }, () => assert.throws(() => api.adopt(f), /injected/));
    assert.equal(fs.readFileSync(foreign, 'utf8'), 'preserve'); assert(!fs.existsSync(f.stateFile)); unchanged(f);
  });
  check('reparse reference paths are refused before copying (stat seam)', () => {
    const f = fixture('reparse');
    patch(fs, 'lstatSync', original => function(file, ...args) { if (path.resolve(file) === path.resolve(f.reference)) return { isSymbolicLink: () => true }; return original.call(fs, file, ...args); }, () => assert.throws(() => api.adopt(f), /Verkn/));
    noAdoption(f); unchanged(f);
  });
  check('logger failures cannot undo an atomically adopted valid state', () => {
    const f = fixture('logger'); f.log = () => { throw Error('log unavailable'); }; assert.equal(api.adopt(f).adopted, true); assert(fs.existsSync(f.stateFile)); unchanged(f);
  });
  const result = { passed: true, checks: reports.length, tests: reports, parserStarted: false, desktopStarted: false, gameStarted: false };
  fs.writeFileSync(path.join(__dirname, 'reference-basis-results.json'), JSON.stringify(result, null, 2) + '\n'); console.log(JSON.stringify({ passed: true, checks: reports.length }));
} finally {
  if (path.dirname(root) !== path.resolve(__dirname) || !path.basename(root).startsWith('.reference-basis-test-')) throw Error('Unexpected test cleanup path');
  fs.rmSync(root, { recursive: true, force: true });
}
