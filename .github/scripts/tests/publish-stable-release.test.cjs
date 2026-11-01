'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const publisher = require('../publish-stable-release.cjs');
const { APPS, sha256, namesFor, parseManifest, reconstructAssets, assertRemoteAssets, releaseBody, assertResumableDraft, assertUpdaterRelease, publish } = publisher;
const clone = value => JSON.parse(JSON.stringify(value));
const digest = 'a'.repeat(64);
function fixture(app = 'studio') {
  const version = { studio: '0.4.34', player: '0.16.27', manager: '0.15.45' }[app];
  const bytes = Buffer.from(`fixture for ${app}`); const hash = sha256(bytes);
  return { schemaVersion: 1, app, repository: APPS[app].repository, visibility: APPS[app].visibility, version, releaseTag: `v${version}`, releaseName: `${app} ${version}`, sourceCommit: 'b'.repeat(40), notes: 'Release fixture notes.', assets: namesFor(app, version).map(name => ({ name, size: bytes.length, sha256: hash, parts: [{ path: `.github/stable-release-parts/${hash}.bin`, size: bytes.length, sha256: hash }] })) };
}
function parse(manifest) { return parseManifest(JSON.stringify(manifest), manifest.repository); }
function remoteAsset(asset, manifest, id = 1) {
  return { id, name: asset.name, size: asset.size, digest: `sha256:${asset.sha256}`, state: 'uploaded', url: `https://api.github.com/repos/${manifest.repository}/releases/assets/${id}`, browser_download_url: `https://github.com/${manifest.repository}/releases/download/${manifest.releaseTag}/${asset.name}` };
}
function release(manifest, draft = false) {
  return { id: 101, tag_name: manifest.releaseTag, target_commitish: manifest.sourceCommit, name: manifest.releaseName, body: releaseBody(manifest, digest), draft, prerelease: false, html_url: `https://github.com/${manifest.repository}/releases/tag/${manifest.releaseTag}`, assets: manifest.assets.map((asset, index) => remoteAsset(asset, manifest, index + 1)) };
}
for (const app of Object.keys(APPS)) test(`${app}: manifest and updater response parse with standard asset names`, () => {
  const manifest = parse(fixture(app)); const response = release(manifest);
  assert.equal(assertUpdaterRelease(response, manifest).name, namesFor(app, manifest.version)[0]);
});
test('manifest binds repository to event, application and fixed visibility', () => {
  const manifest = fixture();
  assert.throws(() => parseManifest(JSON.stringify(manifest), APPS.player.repository), /Repository/);
  for (const change of [{ repository: 'Somewhere/Other' }, { visibility: 'private' }, { app: '__proto__' }]) assert.throws(() => parse({ ...manifest, ...change }));
});
test('numeric version/tag parser rejects test tags, leading zeroes, mismatches and wrong types', () => {
  for (const change of [{ version: '0.4.34-Test' }, { version: '00.4.34' }, { version: 34 }, { version: '65536.0.0' }, { releaseTag: 'v0.4.34-test' }, { releaseTag: '0.4.34' }, { releaseTag: 34 }]) assert.throws(() => parse({ ...fixture(), ...change }));
});
test('manifest asset allowlist rejects wrong filename, wrong app and duplicates', () => {
  for (const bad of ['Enshrouded-Mod-Studio-0.4.34-Test.zip', 'Enshrouded-Mod-Studio-0.4.33.zip', '../Enshrouded-Mod-Studio-0.4.34.zip', 'UGSM-Update-0.4.34.zip']) {
    const manifest = fixture(); manifest.assets[0].name = bad; assert.throws(() => parse(manifest), /asset name/);
  }
  const manifest = fixture(); manifest.assets[1] = clone(manifest.assets[0]); assert.throws(() => parse(manifest), /duplicate/);
});
test('manifest parser rejects invalid asset types, sizes and digests', () => {
  for (const change of [{ size: '18' }, { size: 1.5 }, { size: 0 }, { size: 201 * 1024 * 1024 }, { sha256: '0'.repeat(64) }, { sha256: 'A'.repeat(64) }, { parts: {} }]) {
    const manifest = fixture(); Object.assign(manifest.assets[0], change); assert.throws(() => parse(manifest));
  }
});
test('chunk parser rejects escape paths, type errors, conflicts and wrong totals', () => {
  for (const change of [{ path: '.github/stable-release-parts/../evil.bin' }, { path: '/tmp/evil.bin' }, { size: '18' }, { size: 9 * 1024 * 1024 }, { size: 1 }, { sha256: '0'.repeat(64) }]) {
    const manifest = fixture(); Object.assign(manifest.assets[0].parts[0], change); assert.throws(() => parse(manifest));
  }
});
test('manager optionally includes the declared bundled Player archive', () => {
  const manifest = fixture('manager'); manifest.bundledPlayerVersion = '0.16.27';
  const asset = clone(manifest.assets[0]); asset.name = 'UGSM-Player-0.16.27-Windows-x64.zip'; manifest.assets.push(asset); assert.equal(parse(manifest).assets.length, 3);
  manifest.assets[2].name = 'UGSM-Player-0.16.26-Windows-x64.zip'; assert.throws(() => parse(manifest));
});
test('reconstruction checks chunks and full asset digest before publication', t => {
  const base = fs.realpathSync(os.tmpdir()); const root = fs.mkdtempSync(path.join(base, 'stable-release-fixture-'));
  t.after(() => { assert.equal(path.dirname(root), base); assert.match(path.basename(root), /^stable-release-fixture-/); fs.rmSync(root, { recursive: true }); });
  const manifest = parse(fixture()); const chunk = manifest.assets[0].parts[0];
  const chunkPath = path.join(root, chunk.path); fs.mkdirSync(path.dirname(chunkPath), { recursive: true }); fs.writeFileSync(chunkPath, Buffer.from('fixture for studio'));
  const output = reconstructAssets(manifest, root, path.join(root, 'verified'));
  for (const asset of manifest.assets) assert.equal(sha256(fs.readFileSync(path.join(output, asset.name))), asset.sha256);
  const fullDigestMismatch = clone(manifest); fullDigestMismatch.assets[0].sha256 = 'c'.repeat(64);
  assert.throws(() => reconstructAssets(fullDigestMismatch, root, path.join(root, 'bad-asset')), /Reassembled/);
  fs.writeFileSync(chunkPath, 'corrupted fixture!');
  assert.throws(() => reconstructAssets(manifest, root, path.join(root, 'bad-chunk')), /Chunk differs/);
  assert.equal(fs.existsSync(path.join(root, 'bad-chunk')), false);
});
test('updater parser rejects wrong tag and non-boolean or prerelease/draft states', () => {
  const manifest = parse(fixture());
  for (const change of [{ tag_name: 'v0.4.34-test' }, { tag_name: 34 }, { draft: true }, { draft: 'false' }, { prerelease: true }, { prerelease: 'false' }]) assert.throws(() => assertUpdaterRelease({ ...release(manifest), ...change }, manifest));
});
test('remote parser rejects changed names, size types, state, digests and URLs', () => {
  const manifest = parse(fixture());
  for (const change of [{ name: 'wrong.zip' }, { size: '18' }, { size: 0 }, { state: 'new' }, { digest: `sha256:${'f'.repeat(64)}` }, { digest: null }, { id: '1' }, { url: 'https://github.evil.test/1' }, { browser_download_url: `https://github.com/${manifest.repository}/releases/download/${manifest.releaseTag}/wrong.zip` }]) {
    const response = release(manifest); Object.assign(response.assets[0], change); assert.throws(() => assertUpdaterRelease(response, manifest));
  }
  const response = release(manifest); response.assets.push(clone(response.assets[0])); assert.throws(() => assertRemoteAssets(response, manifest, false), /duplicate/);
});
test('resume accepts only the exact bound draft and never a published release', () => {
  const manifest = parse(fixture()); const draft = release(manifest, true); draft.assets.pop(); assert.doesNotThrow(() => assertResumableDraft(draft, manifest, digest));
  for (const change of [{ draft: false }, { prerelease: true }, { target_commitish: 'c'.repeat(40) }, { body: 'Other publisher' }, { name: 'Other title' }]) assert.throws(() => assertResumableDraft({ ...draft, ...change }, manifest, digest));
  draft.assets[0].digest = `sha256:${'f'.repeat(64)}`; assert.throws(() => assertResumableDraft(draft, manifest, digest), /Remote bytes differ/);
});
function publicationHarness(manifest, initial, corrupt = false) {
  let current = initial && clone(initial); let writes = 0; const uploads = []; const calls = [];
  const api = (endpoint, method = 'GET', body) => {
    calls.push({ endpoint, method, body });
    if (endpoint === `repos/${manifest.repository}`) return { full_name: manifest.repository, visibility: manifest.visibility, private: manifest.visibility === 'private' };
    if (method === 'POST') { writes++; current = { ...release(manifest, true), ...body, assets: [] }; return clone(current); }
    if (method === 'PATCH') { writes++; assert.equal(body.make_latest, 'true'); assert.equal(current.assets.length, manifest.assets.length); current.draft = false; current.prerelease = false; return clone(current); }
    return clone(current);
  };
  const upload = asset => { uploads.push(asset.name); const remote = remoteAsset(asset, manifest, current.assets.length + 1); if (corrupt) remote.digest = `sha256:${'f'.repeat(64)}`; current.assets.push(remote); };
  return { api, read: () => initial, upload, calls, uploads, writes: () => writes };
}
test('publication creates a draft, verifies all digests, then publishes as latest stable', () => {
  const manifest = parse(fixture()); const harness = publicationHarness(manifest);
  const result = publish(manifest, digest, '.', '.', harness.api, harness.read, harness.upload, () => {});
  assert.equal(result.draft, false); assert.equal(result.prerelease, false); assert.equal(harness.uploads.length, 2); assert.equal(harness.writes(), 2);
  assert.deepEqual(harness.calls.find(x => x.method === 'POST').body.make_latest, 'false');
});
test('publication resumes exact draft without re-uploading verified existing asset', () => {
  const manifest = parse(fixture()); const draft = release(manifest, true); draft.assets.pop(); const harness = publicationHarness(manifest, draft);
  publish(manifest, digest, '.', '.', harness.api, harness.read, harness.upload, () => {});
  assert.deepEqual(harness.uploads, [manifest.assets[1].name]); assert.equal(harness.writes(), 1);
});
test('publication stops without any write when the version is already published', () => {
  const manifest = parse(fixture()); const harness = publicationHarness(manifest, release(manifest));
  assert.throws(() => publish(manifest, digest, '.', '.', harness.api, harness.read, harness.upload), /published versions are immutable/);
  assert.equal(harness.writes(), 0); assert.equal(harness.uploads.length, 0);
});
test('publication keeps draft unpublished on remote digest mismatch', () => {
  const manifest = parse(fixture()); const harness = publicationHarness(manifest, undefined, true);
  assert.throws(() => publish(manifest, digest, '.', '.', harness.api, harness.read, harness.upload, () => {}), /Remote bytes differ/);
  assert.equal(harness.calls.filter(x => x.method === 'PATCH').length, 0);
});
test('publication refuses visibility mismatch without modifying repository or release', () => {
  const manifest = parse(fixture()); let writes = 0;
  assert.throws(() => publish(manifest, digest, '.', '.', (_endpoint, method) => { if (method) writes++; return { full_name: manifest.repository, visibility: 'private', private: true }; }), /visibility/);
  assert.equal(writes, 0);
});
