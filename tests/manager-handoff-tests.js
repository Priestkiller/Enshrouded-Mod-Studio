'use strict';
// Synthetic local fixtures only. No registry, game folders, UI, network or ACL changes.
const fs = require('fs'), path = require('path'), assert = require('assert');
const engine = fs.existsSync(path.join(__dirname, '..', 'engine', 'manager-handoff.js')) ? path.join(__dirname, '..', 'engine') : path.join(__dirname, '..', 'tool', 'engine');
const manager = require(path.join(engine, 'manager-handoff')), packages = require(path.join(engine, 'client-packages'));
const { canonical, hash } = manager._test;
const base = path.resolve(__dirname), root = fs.mkdtempSync(path.join(base, '.manager-handoff-'));
let checks = 0, nativeJunctionSkipped = 0;
const passedChecks = [];
const check = (name, fn) => { fn(); checks++; passedChecks.push(name); console.log('PASS ' + name); };
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof value === 'string' ? value : canonical(value) + '\n'); };
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
function fixture(name) {
  const folder = path.join(root, name), source = path.join(folder, 'server', 'install'), engine = path.join(folder, 'engine'), data = path.join(folder, 'private-studio', 'patches');
  const target = { dir: source, id: manager.targetId(source), server: true, name: 'enshrouded_server', archives: ['enshrouded_server.kfc', 'enshrouded_server.kfc_resources'] };
  const options = { root: engine, data, clientBasisCandidates: [], log: () => {} };
  write(path.join(engine, 'engine-manifest.json'), { studio: '0.4.25', version: '1.2.3', files: {} });
  for (const file of ['enshrouded_server.exe', ...target.archives]) write(path.join(source, file), 'synthetic-' + file);
  const binding = { format: 1, profileId: 'a'.repeat(32), sourceDirectory: source, targetId: target.id, automaticClientPackages: true };
  write(path.join(source, '.ugsm-studio.json'), binding);
  const legacy = { format: 1, enabled: false, clientBasisDirectory: null, outputDirectory: path.join(folder, 'old-output') };
  const plan = { id: '100-abcd', applied: true, build: '1273043|synthetic', target, source: { exe: hash(fs.readFileSync(path.join(source, 'enshrouded_server.exe'))) }, artifacts: target.archives.map(name => ({ name, sha256: hash(fs.readFileSync(path.join(source, name))) })), mods: {}, config: { privatePath: 'DO NOT COPY', privateToken: 'SECRET' } };
  const state = { lastJob: plan.id, currentArchives: Object.fromEntries(plan.artifacts.map(a => [a.name, a.sha256])), basis: 'PRIVATE BASIS PATH' };
  const persist = () => { state.lastJob = plan.id; write(path.join(data, 'targets', target.id, 'state.json'), state); write(path.join(data, 'jobs', plan.id, 'plan.json'), plan); };
  persist();
  const preparePackage = () => {
    manager.ensureTransfer(binding);
    const identity = { format: packages.FORMAT, formatVersion: 1, targetRole: 'client', gameBuild: plan.build, files: [], blobs: [] }, revision = hash(canonical(identity));
    const manifestFile = path.join(manager.outputDirectory(binding), target.id, 'packages', revision, 'manifest.json'); write(manifestFile, { ...identity, revision });
    write(path.join(manager.outputDirectory(binding), target.id, 'current.json'), { format: 1, status: 'ready', targetId: target.id, sourceRole: 'server', sourcePlanId: plan.id, sourceArchiveHashes: Object.fromEntries(plan.artifacts.map(a => [a.name, a.sha256])), revision, manifest: 'packages/' + revision + '/manifest.json', manifestSha256: hash(fs.readFileSync(manifestFile)) });
    return { status: 'ready', revision };
  };
  return { folder, source, target, options, binding, legacy, plan, state, persist, preparePackage, handoff: () => path.join(manager.transferDirectory(binding), 'handoff.json') };
}
function client(folder) { for (const file of ['enshrouded.exe', 'enshrouded.kfc', 'enshrouded.kfc_resources']) write(path.join(folder, file), 'original-' + file); return folder; }
async function run() {
  check('unmanaged and singleplayer settings stay unchanged', () => {
    const f = fixture('manual'); fs.unlinkSync(path.join(f.source, '.ugsm-studio.json'));
    assert.strictEqual(manager.managedSettings(f.options, f.plan, f.legacy), f.legacy);
    f.plan.target.server = false; assert.strictEqual(manager.receipt(f.options, f.plan, 'preparing', 'test'), null);
    assert(!fs.existsSync(manager.transferDirectory(f.binding)));
  });
  check('managed binding enables packages and fixes output without changing manual configuration', () => {
    const f = fixture('settings'), c = client(path.join(f.folder, 'client')); f.legacy.clientBasisDirectory = c;
    const original = canonical(f.legacy), s = manager.managedSettings(f.options, f.plan, f.legacy);
    assert.equal(s.enabled, true); assert.equal(s.clientBasisDirectory, c); assert.equal(s.outputDirectory, manager.outputDirectory(f.binding)); assert.equal(canonical(f.legacy), original);
    assert(!fs.existsSync(manager.transferDirectory(f.binding)));
  });
  check('explicit valid local client basis takes precedence over discovery', () => {
    const f = fixture('explicit'), c = client(path.join(f.folder, 'explicit-client')), other = client(path.join(f.folder, 'other-client'));
    f.legacy.clientBasisDirectory = c; f.options.clientBasisCandidates = [other];
    assert.equal(manager.managedSettings(f.options, f.plan, f.legacy).clientBasisDirectory, c);
  });
  check('missing explicit path falls back to one existing client and deduplicates it', () => {
    const f = fixture('discover'), c = client(path.join(f.folder, 'client')); f.legacy.clientBasisDirectory = path.join(f.folder, 'missing'); f.options.clientBasisCandidates = [f.source, c, c];
    assert.equal(manager.managedSettings(f.options, f.plan, f.legacy).clientBasisDirectory, c);
  });
  check('ambiguous discoveries wait instead of choosing a guessed client', () => {
    const f = fixture('ambiguous'); f.options.clientBasisCandidates = [client(path.join(f.folder, 'one')), client(path.join(f.folder, 'two'))];
    assert.equal(manager.managedSettings(f.options, f.plan, f.legacy).clientBasisDirectory, null);
  });
  check('Steam libraryfolders and client appmanifest are read in user context', () => {
    const f = fixture('steam'), steam = path.join(f.folder, 'Steam'), library = path.join(f.folder, 'GameLibrary'), c = client(path.join(library, 'steamapps', 'common', 'DifferentName'));
    delete f.options.clientBasisCandidates; f.options.steamRoots = [steam];
    write(path.join(steam, 'steamapps', 'libraryfolders.vdf'), '"libraryfolders" { "0" { "path" ' + JSON.stringify(library) + ' } }');
    write(path.join(library, 'steamapps', 'appmanifest_1203620.acf'), '"AppState" { "installdir" "DifferentName" }');
    assert.equal(manager.managedSettings(f.options, f.plan, f.legacy).clientBasisDirectory, c);
  });
  check('saved Studio profiles can supply an existing client basis', () => {
    const f = fixture('profile'), c = client(path.join(f.folder, 'profile-client')); delete f.options.clientBasisCandidates; f.options.steamRoots = [];
    write(path.join(path.dirname(f.options.data), 'profiles', 'b'.repeat(32) + '.json'), { config: { gameDirectory: c } });
    assert.equal(manager.managedSettings(f.options, f.plan, f.legacy).clientBasisDirectory, c);
  });
  check('binding rejects mismatched target, profile, source, disabled automatic mode and extra keys', () => {
    const f = fixture('bad-binding'), file = path.join(f.source, '.ugsm-studio.json');
    for (const change of [{ targetId: '0'.repeat(20) }, { profileId: '../bad' }, { sourceDirectory: path.dirname(f.source) }, { automaticClientPackages: false }, { arbitrary: true }]) { write(file, { ...f.binding, ...change }); assert.throws(() => manager.bindingFor(f.target)); }
  });
  check('reserved output exception is exact and never permits another server subfolder', () => {
    const f = fixture('output'); packages.restrictedOutput(manager.outputDirectory(f.binding), f.plan, null, f.options.data);
    for (const output of [f.source, path.join(f.source, '.ugsm-studio-transfer'), path.join(manager.outputDirectory(f.binding), 'nested'), path.join(f.source, 'custom-output')]) assert.throws(() => packages.restrictedOutput(output, f.plan, null, f.options.data));
    fs.unlinkSync(path.join(f.source, '.ugsm-studio.json')); assert.throws(() => packages.restrictedOutput(manager.outputDirectory(f.binding), f.plan, null, f.options.data));
  });
  check('unknown reserved directory data is preserved', () => {
    const f = fixture('foreign'), file = path.join(manager.transferDirectory(f.binding), 'personal.txt'); write(file, 'keep');
    assert.throws(() => manager.receipt(f.options, f.plan, 'preparing', 'test')); assert.equal(fs.readFileSync(file, 'utf8'), 'keep'); assert(!fs.existsSync(f.handoff()));
  });
  check('foreign ownership marker is never taken over', () => {
    const f = fixture('wrong-owner'); manager.ensureTransfer(f.binding); const file = path.join(manager.transferDirectory(f.binding), '.studio-handoff-owned.json'); write(file, { format: 1, profileId: 'foreign' });
    assert.throws(() => manager.receipt(f.options, f.plan, 'preparing', 'test')); assert.equal(read(file).profileId, 'foreign');
  });
  check('ready receipt contains hashes of minimal immutable proof bytes and excludes private setup', () => {
    const f = fixture('ready'), result = manager.complete(f.options, f.plan, f.state, f.preparePackage()), receipt = read(f.handoff());
    const proofRoot = path.join(manager.transferDirectory(f.binding), 'snapshots', f.plan.id, 'proofs', 'patches'), planFile = path.join(proofRoot, 'jobs', f.plan.id, 'plan.json'), stateFile = path.join(proofRoot, 'targets', f.target.id, 'state.json');
    assert.equal(receipt.status, 'ready'); assert.equal(result.packageRevision, receipt.packageRevision); assert.equal(receipt.planSha256, hash(fs.readFileSync(planFile))); assert.equal(receipt.stateSha256, hash(fs.readFileSync(stateFile)));
    assert(!fs.readFileSync(planFile, 'utf8').includes('SECRET')); assert(!fs.readFileSync(planFile, 'utf8').includes('privatePath')); assert.deepEqual(read(stateFile), { lastJob: f.plan.id });
    const before = fs.readFileSync(planFile, 'utf8'); manager.complete(f.options, f.plan, f.state, f.preparePackage()); assert.equal(fs.readFileSync(planFile, 'utf8'), before);
  });
  check('ready publication requires persisted applied plan, state and live server hashes', () => {
    for (const change of ['applied', 'state', 'exe', 'archive', 'plan']) {
      const f = fixture('guard-' + change), pkg = f.preparePackage();
      if (change === 'applied') f.plan.applied = false;
      if (change === 'state') write(path.join(f.options.data, 'targets', f.target.id, 'state.json'), { lastJob: 'other' });
      if (change === 'exe') write(path.join(f.source, 'enshrouded_server.exe'), 'changed');
      if (change === 'archive') write(path.join(f.source, 'enshrouded_server.kfc'), 'changed');
      if (change === 'plan') write(path.join(f.options.data, 'jobs', f.plan.id, 'plan.json'), { ...f.plan, build: 'changed' });
      assert.throws(() => manager.complete(f.options, f.plan, f.state, pkg)); assert(!fs.existsSync(f.handoff()));
    }
  });
  check('client pointer and manifest must belong to this applied server patch', () => {
    const f = fixture('wrong-pointer'), pkg = f.preparePackage(), pointer = path.join(manager.outputDirectory(f.binding), f.target.id, 'current.json'), original = read(pointer);
    for (const change of [{ sourcePlanId: '200-beef' }, { sourceRole: 'client' }, { targetId: 'f'.repeat(20) }, { manifest: '../manifest.json' }, { sourceArchiveHashes: {} }]) { write(pointer, { ...original, ...change }); assert.throws(() => manager.complete(f.options, f.plan, f.state, pkg)); }
    assert(!fs.existsSync(f.handoff()));
  });
  check('tampered immutable proof cannot be replaced by another receipt', () => {
    const f = fixture('immutable'), pkg = f.preparePackage(); manager.complete(f.options, f.plan, f.state, pkg);
    const file = path.join(manager.transferDirectory(f.binding), 'snapshots', f.plan.id, 'proofs', 'patches', 'targets', f.target.id, 'state.json'); write(file, { lastJob: 'tampered' });
    assert.throws(() => manager.complete(f.options, f.plan, f.state, pkg)); assert.equal(read(file).lastJob, 'tampered');
  });
  check('only current and previous owned proof snapshots remain', () => {
    const f = fixture('prune');
    for (const id of ['100-abcd', '200-beef', '300-cafe']) { f.plan.id = id; f.persist(); manager.complete(f.options, f.plan, f.state, f.preparePackage()); }
    const snapshots = path.join(manager.transferDirectory(f.binding), 'snapshots'); assert.deepEqual(fs.readdirSync(snapshots).sort(), ['200-beef', '300-cafe']);
    const foreign = path.join(snapshots, '400-feed', 'personal.txt'); write(foreign, 'keep');
    f.plan.id = '500-dead'; f.persist(); manager.complete(f.options, f.plan, f.state, f.preparePackage()); assert.equal(fs.readFileSync(foreign, 'utf8'), 'keep');
    const extra = path.join(snapshots, '300-cafe', 'personal-extra.txt'); write(extra, 'keep extra');
    f.plan.id = '600-cafe'; f.persist(); manager.complete(f.options, f.plan, f.state, f.preparePackage()); assert.equal(fs.readFileSync(extra, 'utf8'), 'keep extra');
  });
  check('waiting/failed/invalidation replace readiness with clear receipts and no download revision', () => {
    const f = fixture('statuses'); manager.complete(f.options, f.plan, f.state, f.preparePackage());
    manager.complete(f.options, f.plan, f.state, { status: 'waiting-client-basis' }); assert.equal(read(f.handoff()).status, 'waiting-client-basis'); assert.equal(read(f.handoff()).packageRevision, null);
    manager.complete(f.options, f.plan, f.state, { status: 'failed', message: 'PRIVATE SECRET PATH' }); assert.equal(read(f.handoff()).status, 'failed'); assert(!fs.readFileSync(f.handoff(), 'utf8').includes('SECRET'));
    manager.receipt(f.options, { target: f.target, id: null }, 'invalidated', 'Basis geändert.'); assert.equal(read(f.handoff()).sourcePlanId, null); assert.equal(read(f.handoff()).stateSha256, null);
  });
  check('junctions cannot redirect the reserved transfer directory', () => {
    const f = fixture('junction'), external = path.join(f.folder, 'external'); fs.mkdirSync(external);
    try {
      fs.symlinkSync(external, manager.transferDirectory(f.binding), process.platform === 'win32' ? 'junction' : 'dir');
      assert.throws(() => manager.receipt(f.options, f.plan, 'preparing', 'test'));
    } catch (e) {
      if (e.code !== 'EPERM') throw e;
      nativeJunctionSkipped++; console.log('SKIP native junction creation: environment denied EPERM; exercising rejection through stat seam');
      const original = fs.lstatSync, location = manager.transferDirectory(f.binding); fs.mkdirSync(location);
      fs.lstatSync = function(file, ...args) { if (path.resolve(file) === location) return { isSymbolicLink: () => true }; return original.call(fs, file, ...args); };
      try { assert.throws(() => manager.receipt(f.options, f.plan, 'preparing', 'test')); } finally { fs.lstatSync = original; }
    }
    assert.deepEqual(fs.readdirSync(external), []);
  });
  const f = fixture('waiting-flow'); write(path.join(path.dirname(f.options.data), 'client-packages.json'), f.legacy);
  const preparation = await packages.prepareForPlan(f.options, f.plan, async () => { throw Error('must not run'); });
  check('registered server without client basis waits without invoking native client preparation', () => { assert.equal(preparation.status, 'waiting-client-basis'); assert.equal(preparation.setup.enabled, true); });
  check('real package completion and invalidation propagate waiting state and retire old pointers', () => {
    manager.receipt(f.options, { ...f.plan, id: null }, 'preparing', 'Vorbereitung.');
    f.plan.clientPackagePreparation = preparation;
    const result = packages.completeForPlan(f.options, f.plan, f.state);
    assert.equal(result.status, 'waiting-client-basis'); assert.equal(read(f.handoff()).status, 'waiting-client-basis');
    const pointer = path.join(manager.outputDirectory(f.binding), f.target.id, 'current.json'); assert.equal(read(pointer).status, 'waiting-client-basis');
    assert.equal(packages.invalidate(f.options, f.target, 'Basis zurückgesetzt.').status, 'invalidated'); assert.equal(read(f.handoff()).status, 'invalidated'); assert.equal(read(pointer).status, 'invalidated');
  });
  const result = { passed: true, checks, nativeJunctionSkipped, passedChecks };
  write(path.join(base, 'manager-handoff-results.json'), result);
  console.log(JSON.stringify({ passed: true, checks, nativeJunctionSkipped }));
}
run().catch(error => { console.error(error.stack); process.exitCode = 1; }).finally(() => {
  if (path.dirname(root) !== base || !path.basename(root).startsWith('.manager-handoff-')) throw Error('Unexpected test cleanup path');
  fs.rmSync(root, { recursive: true, force: true });
});
