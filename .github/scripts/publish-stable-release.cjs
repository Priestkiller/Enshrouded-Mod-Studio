'use strict';

// This publisher uses only Node built-ins and the runner's GitHub CLI. It never
// changes repository visibility and never edits an already published release.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const APPS = Object.freeze({
  studio: { repository: 'Priestkiller/Enshrouded-Mod-Studio', visibility: 'public', maxBytes: 128 * 1024 * 1024 },
  player: { repository: 'Priestkiller/UGSM-Player', visibility: 'public', maxBytes: 200 * 1024 * 1024 },
  manager: { repository: 'Priestkiller/Universal-Game-Server-Manager', visibility: 'private', maxBytes: 200 * 1024 * 1024 },
});
const DIGEST = /^[a-f0-9]{64}$/;
const VERSION = /^(0|[1-9][0-9]{0,4})\.(0|[1-9][0-9]{0,4})\.(0|[1-9][0-9]{0,4})$/;
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function check(condition, message) { if (!condition) throw new Error(message); }
function object(value, label) { check(value !== null && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`); }
function integer(value, maximum, label) { check(Number.isSafeInteger(value) && value > 0 && value <= maximum, `${label} must be a bounded positive integer`); }
function digest(value) { check(typeof value === 'string' && DIGEST.test(value) && value !== '0'.repeat(64), 'Invalid SHA256'); }
function namesFor(app, version) {
  if (app === 'studio') return [`Enshrouded-Mod-Studio-${version}.zip`, `Enshrouded-Mod-Studio-${version}-Setup.exe`];
  if (app === 'player') return [`UGSM-Player-${version}-Windows-x64.zip`, `UGSM-Player-${version}-Setup.exe`];
  return [`UGSM-Update-${version}.zip`, `UGSM-Setup-${version}.exe`];
}
function parseManifest(text, expectedRepository) {
  check(typeof text === 'string' && Buffer.byteLength(text) <= 2 * 1024 * 1024, 'Manifest exceeds limit');
  const manifest = JSON.parse(text); object(manifest, 'Manifest');
  check(manifest.schemaVersion === 1, 'Unsupported manifest schema');
  check(typeof manifest.app === 'string' && Object.hasOwn(APPS, manifest.app), 'Unknown application');
  const config = APPS[manifest.app];
  check(manifest.repository === expectedRepository && manifest.repository === config.repository, 'Repository does not match the event and application');
  check(manifest.visibility === config.visibility, 'Manifest visibility does not match the application');
  check(typeof manifest.version === 'string' && VERSION.test(manifest.version) && manifest.version.split('.').every(x => Number(x) <= 65535), 'Expected a numeric stable version');
  check(manifest.releaseTag === `v${manifest.version}`, 'Stable tag must exactly match the version');
  check(typeof manifest.sourceCommit === 'string' && /^[a-f0-9]{40}$/.test(manifest.sourceCommit) && manifest.sourceCommit !== '0'.repeat(40), 'A full source commit is required');
  check(typeof manifest.releaseName === 'string' && manifest.releaseName.length > 0 && manifest.releaseName.length <= 160 && !/[\x00-\x1f]/.test(manifest.releaseName), 'Invalid release title');
  check(typeof manifest.notes === 'string' && manifest.notes.trim().length > 0 && Buffer.byteLength(manifest.notes) <= 50000 && !manifest.notes.includes('<!-- stable-manifest-sha256:'), 'Invalid release notes');
  const required = namesFor(manifest.app, manifest.version);
  const allowed = new Set([...required, 'SHA256SUMS.txt', 'RELEASE-NOTES.txt']);
  if (manifest.bundledPlayerVersion !== undefined) {
    check(manifest.app === 'manager' && typeof manifest.bundledPlayerVersion === 'string' && VERSION.test(manifest.bundledPlayerVersion), 'Invalid bundled Player version');
    allowed.add(`UGSM-Player-${manifest.bundledPlayerVersion}-Windows-x64.zip`);
  }
  check(Array.isArray(manifest.assets) && manifest.assets.length >= required.length && manifest.assets.length <= allowed.size, 'Invalid asset count');
  const seen = new Set(); const parts = new Map();
  for (const asset of manifest.assets) {
    object(asset, 'Asset');
    check(typeof asset.name === 'string' && allowed.has(asset.name) && !seen.has(asset.name.toLowerCase()), 'Unexpected or duplicate asset name'); seen.add(asset.name.toLowerCase());
    integer(asset.size, config.maxBytes, 'Asset size'); digest(asset.sha256);
    check(Array.isArray(asset.parts) && asset.parts.length >= 1 && asset.parts.length <= 128, 'Invalid chunk count');
    let size = 0;
    for (const part of asset.parts) {
      object(part, 'Chunk'); integer(part.size, 8 * 1024 * 1024, 'Chunk size'); digest(part.sha256);
      check(part.path === `.github/stable-release-parts/${part.sha256}.bin`, 'Chunk path must match its SHA256');
      const previous = parts.get(part.path);
      check(!previous || previous.size === part.size, 'Shared chunk metadata conflicts');
      parts.set(part.path, part); size += part.size;
    }
    check(size === asset.size, 'Asset size differs from chunk total');
  }
  for (const name of required) check(seen.has(name.toLowerCase()), `Required updater asset missing: ${name}`);
  return manifest;
}
function safeInput(root, relative) {
  check(typeof relative === 'string' && /^[A-Za-z0-9._/-]+$/.test(relative) && !relative.split('/').some(x => !x || x === '.' || x === '..'), 'Invalid repository path');
  const full = path.resolve(root, relative); const resolvedRoot = path.resolve(root);
  check(full.startsWith(resolvedRoot + path.sep), 'Input escapes repository');
  let cursor = full;
  while (true) {
    const info = fs.lstatSync(cursor); check(!info.isSymbolicLink(), 'Linked repository inputs are forbidden');
    if (cursor === resolvedRoot) break;
    cursor = path.dirname(cursor);
  }
  check(fs.statSync(full).isFile(), 'Expected an ordinary file');
  return full;
}
function reconstructAssets(manifest, root, output) {
  const chunks = new Map();
  // All inputs are checked before creating outputs or contacting GitHub.
  for (const asset of manifest.assets) for (const part of asset.parts) if (!chunks.has(part.path)) {
    const file = safeInput(root, part.path); const bytes = fs.readFileSync(file);
    check(bytes.length === part.size && sha256(bytes) === part.sha256, `Chunk differs: ${part.path}`);
    chunks.set(part.path, file);
  }
  check(!fs.existsSync(output), 'Output directory must be new'); fs.mkdirSync(output, { recursive: true });
  for (const asset of manifest.assets) {
    const destination = path.join(output, asset.name); const fd = fs.openSync(destination, 'wx'); const hash = crypto.createHash('sha256'); let length = 0;
    try {
      for (const part of asset.parts) {
        const bytes = fs.readFileSync(chunks.get(part.path));
        // Check again at point of use, including a shared chunk.
        check(bytes.length === part.size && sha256(bytes) === part.sha256, 'Chunk changed during reconstruction');
        fs.writeFileSync(fd, bytes); hash.update(bytes); length += bytes.length;
      }
    } finally { fs.closeSync(fd); }
    check(length === asset.size && hash.digest('hex') === asset.sha256, `Reassembled asset differs: ${asset.name}`);
  }
  return output;
}
function assertRemoteAssets(release, manifest, complete) {
  check(Array.isArray(release.assets), 'Remote assets must be an array');
  check(!complete || release.assets.length === manifest.assets.length, 'Remote asset count differs');
  const seen = new Set();
  for (const remote of release.assets) {
    object(remote, 'Remote asset');
    const local = manifest.assets.find(x => x.name === remote.name);
    check(local && !seen.has(remote.name.toLowerCase()), 'Unexpected or duplicate remote asset'); seen.add(remote.name.toLowerCase());
    check(remote.state === 'uploaded' && remote.size === local.size && remote.digest === `sha256:${local.sha256}`, `Remote bytes differ: ${remote.name}`);
    check(Number.isSafeInteger(remote.id) && remote.id > 0, 'Remote asset ID is invalid');
    check(remote.url === `https://api.github.com/repos/${manifest.repository}/releases/assets/${remote.id}`, 'Remote API asset URL differs');
    check(remote.browser_download_url === `https://github.com/${manifest.repository}/releases/download/${manifest.releaseTag}/${remote.name}`, 'Remote browser asset URL differs');
  }
}
function releaseBody(manifest, manifestDigest) { return `${manifest.notes.trim()}\n\n<!-- stable-manifest-sha256:${manifestDigest} -->`; }
function assertReleaseIdentity(release, manifest, manifestDigest) {
  object(release, 'Release');
  check(Number.isSafeInteger(release.id) && release.id > 0, 'Invalid release ID');
  check(release.tag_name === manifest.releaseTag && release.target_commitish === manifest.sourceCommit && release.name === manifest.releaseName && release.body === releaseBody(manifest, manifestDigest), 'Release is not bound to this exact manifest');
}
function assertResumableDraft(release, manifest, manifestDigest) {
  assertReleaseIdentity(release, manifest, manifestDigest);
  check(release.draft === true && release.prerelease === false, 'Only the exact stable draft can be resumed; published versions are immutable');
  assertRemoteAssets(release, manifest, false);
}
function assertUpdaterRelease(release, manifest) {
  // Production postcondition matches the strict names, tags, booleans, URLs,
  // states, bounded sizes and SHA256 digests consumed by the shipped updaters.
  object(release, 'Updater release');
  check(release.draft === false && release.prerelease === false && release.tag_name === manifest.releaseTag, 'Updater requires a published numeric stable release');
  assertRemoteAssets(release, manifest, true);
  const expected = namesFor(manifest.app, manifest.version)[0];
  check(release.assets.filter(x => x.name === expected).length === 1, 'Updater ZIP must be unique');
  return release.assets.find(x => x.name === expected);
}
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', shell: false, maxBuffer: 16 * 1024 * 1024, ...options });
  check(!result.error && result.status === 0, `${command} ${args[0]} failed: ${(result.stderr || result.error?.message || '').trim()}`);
  return result.stdout;
}
function ghAPI(endpoint, method = 'GET', body) {
  const args = ['api', '--method', method, '-H', 'Accept: application/vnd.github+json', '-H', 'X-GitHub-Api-Version: 2022-11-28', endpoint];
  if (body !== undefined) args.push('--input', '-');
  const response = run('gh', args, body === undefined ? {} : { input: JSON.stringify(body) });
  return response.trim() ? JSON.parse(response) : null;
}
function readMatchingRelease(repository, tag) {
  const matches = [];
  for (let page = 1; ; page++) {
    check(page <= 1000, 'Release pagination limit exceeded');
    const releases = ghAPI(`repos/${repository}/releases?per_page=100&page=${page}`);
    check(Array.isArray(releases), 'Invalid release-list response');
    matches.push(...releases.filter(x => x.tag_name === tag));
    if (releases.length < 100) break;
  }
  check(matches.length <= 1, 'Ambiguous release tag'); return matches[0];
}
function checkExistingTag(manifest, api) {
  const ref = spawnSync('gh', ['api', `repos/${manifest.repository}/git/ref/tags/${manifest.releaseTag}`], { encoding: 'utf8', shell: false });
  if (ref.status === 0) check(api(`repos/${manifest.repository}/commits/${manifest.releaseTag}`).sha === manifest.sourceCommit, 'Existing tag points to other source');
  else check(/\b404\b/.test(ref.stderr || ''), 'Cannot inspect existing tag');
}
function publish(manifest, manifestDigest, root, output, api = ghAPI, readRelease = readMatchingRelease, upload = (asset, m) => run('gh', ['release', 'upload', m.releaseTag, path.join(output, asset.name), '--repo', m.repository]), inspectTag = checkExistingTag) {
  const info = api(`repos/${manifest.repository}`);
  check(info.full_name === manifest.repository && info.visibility === manifest.visibility && info.private === (manifest.visibility === 'private'), 'Remote repository visibility or identity differs; visibility will not be changed');
  let release = readRelease(manifest.repository, manifest.releaseTag);
  if (release) assertResumableDraft(release, manifest, manifestDigest);
  else {
    // A pre-existing tag must identify the exact reviewed source. GET commit
    // resolves annotated tags as well as lightweight tags; 404 is acceptable.
    inspectTag(manifest, api);
    release = api(`repos/${manifest.repository}/releases`, 'POST', {
      tag_name: manifest.releaseTag, target_commitish: manifest.sourceCommit, name: manifest.releaseName,
      body: releaseBody(manifest, manifestDigest), draft: true, prerelease: false, make_latest: 'false',
    });
    assertResumableDraft(release, manifest, manifestDigest);
  }
  const id = release.id;
  for (const asset of manifest.assets) if (!release.assets.some(x => x.name === asset.name)) upload(asset, manifest);
  release = api(`repos/${manifest.repository}/releases/${id}`);
  assertResumableDraft(release, manifest, manifestDigest); assertRemoteAssets(release, manifest, true);
  // No draft is published before every server-computed digest matches.
  api(`repos/${manifest.repository}/releases/${id}`, 'PATCH', { draft: false, prerelease: false, make_latest: 'true' });
  release = api(`repos/${manifest.repository}/releases/${id}`);
  assertReleaseIdentity(release, manifest, manifestDigest); assertUpdaterRelease(release, manifest);
  const latest = api(`repos/${manifest.repository}/releases/latest`);
  check(latest.id === id, 'Stable release is not the updater latest release'); assertUpdaterRelease(latest, manifest);
  return release;
}
function main(argv) {
  const verifyOnly = argv.includes('--verify-only'); const args = argv.filter(x => x !== '--verify-only');
  check(args.length === 1, 'Usage: node publish-stable-release.cjs <repository-relative-manifest.json> [--verify-only]');
  const root = path.resolve(__dirname, '../..');
  const manifestPath = safeInput(root, args[0]); const text = fs.readFileSync(manifestPath, 'utf8');
  const manifest = parseManifest(text, process.env.GITHUB_REPOSITORY); const manifestDigest = sha256(Buffer.from(text));
  const output = path.join(root, `stable-release-${crypto.randomUUID()}`);
  reconstructAssets(manifest, root, output);
  if (verifyOnly) { console.log(JSON.stringify({ passed: true, verifyOnly: true, repository: manifest.repository, tag: manifest.releaseTag, manifestSha256: manifestDigest, output, assets: manifest.assets.length })); return; }
  check(process.env.GITHUB_ACTIONS === 'true' && process.env.GITHUB_SHA && process.env.GH_TOKEN, 'Publishing requires the repository Actions context and token');
  check(run('git', ['rev-parse', 'HEAD'], { cwd: root }).trim() === process.env.GITHUB_SHA, 'Checkout is not the event commit');
  run('git', ['merge-base', '--is-ancestor', manifest.sourceCommit, 'HEAD'], { cwd: root });
  const release = publish(manifest, manifestDigest, root, output);
  console.log(JSON.stringify({ passed: true, repository: manifest.repository, visibility: manifest.visibility, tag: release.tag_name, url: release.html_url, assets: release.assets.length, latest: true, manifestSha256: manifestDigest }));
}
module.exports = { APPS, sha256, namesFor, parseManifest, safeInput, reconstructAssets, assertRemoteAssets, releaseBody, assertReleaseIdentity, assertResumableDraft, assertUpdaterRelease, publish };
if (require.main === module) { try { main(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; } }
