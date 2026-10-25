'use strict';
// Fixed-block, content-addressed file changes. This module never installs into a game.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FORMAT = 'enshrouded-block-delta';
const BLOCK_SIZE = 65536;
const MAX_BLOCKS = 1000000;
const MAX_SIZE = BLOCK_SIZE * MAX_BLOCKS;
const SHA = /^[a-f0-9]{64}$/;

function fail(message) { throw Error('Clientdelta: ' + message); }
function validPath(file) {
  if (typeof file !== 'string' || !file || file.includes('\0')) fail('Ungültiger Dateipfad.');
  return path.resolve(file);
}
function noLinks(file, allowMissing = false) {
  const resolved = validPath(file), parts = [];
  let current = resolved;
  while (true) {
    parts.push(current);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  for (const part of parts.reverse()) {
    let stat;
    try { stat = fs.lstatSync(part); }
    catch (error) { if (allowMissing && error.code === 'ENOENT') continue; throw error; }
    if (stat.isSymbolicLink()) fail('Verknüpfte Pfade sind nicht erlaubt: ' + part);
    if (part !== resolved && !stat.isDirectory()) fail('Ein Pfadbestandteil ist kein Ordner.');
  }
  return resolved;
}
function regularFile(file) {
  const resolved = noLinks(file), stat = fs.lstatSync(resolved);
  if (!stat.isFile() || !Number.isSafeInteger(stat.size) || stat.size < 0 || stat.size > MAX_SIZE) fail('Ungültige Datei oder Größenlimit überschritten.');
  return { file: resolved, size: stat.size };
}
function directory(dir) {
  const resolved = noLinks(dir, true);
  fs.mkdirSync(resolved, { recursive: true });
  noLinks(resolved);
  if (!fs.lstatSync(resolved).isDirectory()) fail('Payloadpfad ist kein Ordner.');
  return resolved;
}
function readBlock(fd, buffer, position, length = buffer.length) {
  let count = 0;
  while (count < length) {
    const got = fs.readSync(fd, buffer, count, length - count, position + count);
    if (!got) break;
    count += got;
  }
  return count;
}
function digest(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }
function hashFile(file) {
  const info = regularFile(file), fd = fs.openSync(info.file, 'r');
  const hash = crypto.createHash('sha256'), buffer = Buffer.allocUnsafe(BLOCK_SIZE);
  let position = 0;
  try {
    for (;;) {
      const count = readBlock(fd, buffer, position);
      if (!count) break;
      position += count;
      if (position > MAX_SIZE) fail('Datei überschreitet das Größenlimit.');
      hash.update(buffer.subarray(0, count));
    }
    if (position !== info.size || fs.fstatSync(fd).size !== info.size) fail('Datei wurde beim Lesen geändert.');
    return hash.digest('hex');
  } finally { fs.closeSync(fd); }
}
function fileIdentity(file) { const info = regularFile(file); return { sha256: hashFile(info.file), size: info.size }; }
function sameIdentity(file, expected) {
  const actual = fileIdentity(file);
  if (actual.size !== expected.size || actual.sha256 !== expected.sha256) fail('Ausgangs- oder Ergebnisdatei wurde geändert.');
}
function putBlob(root, bytes, sha256) {
  const file = path.join(root, 'blobs', sha256);
  if (fs.existsSync(file)) {
    const info = regularFile(file);
    if (info.size !== bytes.length || hashFile(file) !== sha256) fail('Vorhandener Inhaltsblock ist beschädigt.');
  } else {
    noLinks(file, true);
    let owned = false, fd = null;
    try {
      fd = fs.openSync(file, 'wx');
      owned = true;
      fs.writeFileSync(fd, bytes);
      fs.fsyncSync(fd);
      fs.closeSync(fd); fd = null;
      if (hashFile(file) !== sha256) fail('Inhaltsblock konnte nicht geprüft werden.');
    } catch (error) {
      if (fd !== null) { fs.closeSync(fd); fd = null; }
      if (owned && fs.existsSync(file)) fs.unlinkSync(file);
      if (error.code === 'EEXIST') {
        const info = regularFile(file);
        if (info.size !== bytes.length || hashFile(file) !== sha256) fail('Gleichzeitig angelegter Inhaltsblock ist beschädigt.');
      } else throw error;
    }
  }
  return { sha256, size: bytes.length, path: 'blobs/' + sha256 };
}
function createDelta(baseFile, resultFile, payloadDirectory) {
  const root = directory(payloadDirectory);
  directory(path.join(root, 'blobs'));
  const resultInfo = regularFile(resultFile), result = fileIdentity(resultInfo.file);
  const baseInfo = baseFile === null ? null : regularFile(baseFile);
  const base = baseInfo ? fileIdentity(baseInfo.file) : null;
  const sourceIndex = new Map(), buffer = Buffer.allocUnsafe(BLOCK_SIZE);
  if (baseInfo) {
    const fd = fs.openSync(baseInfo.file, 'r'), observedBase = crypto.createHash('sha256');
    try {
      for (let position = 0, blocks = 0; position < base.size; position += BLOCK_SIZE) {
        if (++blocks > MAX_BLOCKS) fail('Zu viele Ausgangsblöcke.');
        const count = readBlock(fd, buffer, position, Math.min(BLOCK_SIZE, base.size - position));
        if (count !== Math.min(BLOCK_SIZE, base.size - position)) fail('Ausgangsdatei wurde beim Indizieren geändert.');
        observedBase.update(buffer.subarray(0, count));
        const key = count + ':' + digest(buffer.subarray(0, count));
        if (!sourceIndex.has(key)) sourceIndex.set(key, position);
      }
      if (fs.fstatSync(fd).size !== base.size || observedBase.digest('hex') !== base.sha256) fail('Ausgangsdatei wurde beim Indizieren geändert.');
    } finally { fs.closeSync(fd); }
  }
  const operations = [], blobs = new Map(), observed = crypto.createHash('sha256');
  const resultFd = fs.openSync(resultInfo.file, 'r');
  let total = 0;
  try {
    for (;;) {
      const count = readBlock(resultFd, buffer, total);
      if (!count) break;
      if (total + count > result.size) fail('Ergebnisdatei wurde beim Lesen vergrößert.');
      const bytes = buffer.subarray(0, count), sha256 = digest(bytes), offset = sourceIndex.get(count + ':' + sha256);
      observed.update(bytes);
      if (offset !== undefined) {
        const last = operations[operations.length - 1];
        if (last && Object.hasOwn(last, 'copy') && last.copy + last.length === offset) last.length += count;
        else operations.push({ copy: offset, length: count });
      } else {
        if (!blobs.has(sha256)) blobs.set(sha256, putBlob(root, bytes, sha256));
        operations.push({ blob: sha256, length: count });
      }
      total += count;
      if (operations.length > MAX_BLOCKS) fail('Zu viele Deltaoperationen.');
    }
  } finally { fs.closeSync(resultFd); }
  if (total !== result.size || observed.digest('hex') !== result.sha256) fail('Ergebnisdatei wurde beim Lesen geändert.');
  if (baseInfo) sameIdentity(baseInfo.file, base);
  sameIdentity(resultInfo.file, result);
  return { format: FORMAT, version: 1, blockSize: BLOCK_SIZE, base, result, operations, blobs: [...blobs.values()].sort((a, b) => a.sha256.localeCompare(b.sha256)) };
}

function integer(value, min, max) { return Number.isSafeInteger(value) && value >= min && value <= max; }
function keys(value, expected) {
  return !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join('|') === expected.slice().sort().join('|');
}
function identity(value) { return keys(value, ['sha256', 'size']) && typeof value.sha256 === 'string' && SHA.test(value.sha256) && integer(value.size, 0, MAX_SIZE); }
function validate(delta) {
  if (!keys(delta, ['format', 'version', 'blockSize', 'base', 'result', 'operations', 'blobs']) || delta.format !== FORMAT || delta.version !== 1 || delta.blockSize !== BLOCK_SIZE || !identity(delta.result) || !(delta.base === null || identity(delta.base)) || !Array.isArray(delta.operations) || delta.operations.length > MAX_BLOCKS || !Array.isArray(delta.blobs) || delta.blobs.length > MAX_BLOCKS) fail('Ungültiges Deltaformat.');
  const blobs = new Map();
  for (const blob of delta.blobs) {
    if (!keys(blob, ['sha256', 'size', 'path']) || typeof blob.sha256 !== 'string' || !SHA.test(blob.sha256) || !integer(blob.size, 1, BLOCK_SIZE) || blob.path !== 'blobs/' + blob.sha256 || blobs.has(blob.sha256)) fail('Ungültiger Inhaltsblock.');
    blobs.set(blob.sha256, blob);
  }
  let total = 0;
  const used = new Set();
  for (const operation of delta.operations) {
    if (keys(operation, ['copy', 'length'])) {
      if (!delta.base || !integer(operation.copy, 0, delta.base.size) || !integer(operation.length, 1, delta.base.size) || operation.copy + operation.length > delta.base.size) fail('Kopierbereich außerhalb der Ausgangsdatei.');
    } else if (keys(operation, ['blob', 'length'])) {
      if (typeof operation.blob !== 'string' || !SHA.test(operation.blob) || !blobs.has(operation.blob) || operation.length !== blobs.get(operation.blob).size) fail('Ungültiger Blockverweis.');
      used.add(operation.blob);
    } else fail('Unbekannte Deltaoperation.');
    total += operation.length;
    if (!Number.isSafeInteger(total) || total > delta.result.size) fail('Delta überschreitet die Ergebnisgröße.');
  }
  if (total !== delta.result.size || used.size !== blobs.size) fail('Unvollständiges Deltainventar.');
  return blobs;
}
function reconstructDelta(delta, baseFile, payloadDirectory, outputFile) {
  const blobs = validate(delta), root = noLinks(payloadDirectory), output = noLinks(outputFile, true);
  if (!fs.lstatSync(root).isDirectory()) fail('Payloadordner fehlt.');
  if (fs.existsSync(output)) fail('Ergebnisdatei existiert bereits.');
  noLinks(path.dirname(output));
  if (delta.base === null) { if (baseFile !== null) fail('Unerwartete Ausgangsdatei.'); }
  else { if (baseFile === null) fail('Ausgangsdatei fehlt.'); sameIdentity(baseFile, delta.base); }
  for (const blob of blobs.values()) {
    const file = path.join(root, 'blobs', blob.sha256), info = regularFile(file);
    if (info.size !== blob.size || hashFile(file) !== blob.sha256) fail('Inhaltsblock ist beschädigt.');
  }
  let outputFd = null, baseFd = null, ownIdentity = null, completed = false;
  try {
    if (delta.base) baseFd = fs.openSync(regularFile(baseFile).file, 'r');
    outputFd = fs.openSync(output, 'wx');
    ownIdentity = fs.fstatSync(outputFd);
    const buffer = Buffer.allocUnsafe(BLOCK_SIZE), hash = crypto.createHash('sha256');
    for (const operation of delta.operations) {
      let fd = baseFd, offset = operation.copy;
      if (Object.hasOwn(operation, 'blob')) { fd = fs.openSync(path.join(root, 'blobs', operation.blob), 'r'); offset = 0; }
      const chunkHash = Object.hasOwn(operation, 'blob') ? crypto.createHash('sha256') : null;
      try {
        for (let consumed = 0; consumed < operation.length;) {
          const wanted = Math.min(buffer.length, operation.length - consumed), count = readBlock(fd, buffer, offset + consumed, wanted);
          if (count !== wanted) fail('Datei wurde während der Rekonstruktion verkürzt.');
          const bytes = buffer.subarray(0, count); hash.update(bytes); if (chunkHash) chunkHash.update(bytes);
          let written = 0;
          while (written < count) {
            const actual = fs.writeSync(outputFd, bytes, written, count - written);
            if (!actual) fail('Schreiben der Ergebnisdatei fehlgeschlagen.');
            written += actual;
          }
          consumed += count;
        }
        if (chunkHash && chunkHash.digest('hex') !== operation.blob) fail('Inhaltsblock wurde während der Rekonstruktion geändert.');
      } finally { if (Object.hasOwn(operation, 'blob')) fs.closeSync(fd); }
    }
    fs.fsyncSync(outputFd);
    if (fs.fstatSync(outputFd).size !== delta.result.size || hash.digest('hex') !== delta.result.sha256) fail('Ergebnisprüfsumme stimmt nicht.');
    if (delta.base) sameIdentity(baseFile, delta.base);
    sameIdentity(output, delta.result);
    completed = true;
    return { ...delta.result };
  } finally {
    if (baseFd !== null) fs.closeSync(baseFd);
    if (outputFd !== null) fs.closeSync(outputFd);
    if (!completed && ownIdentity) {
      try {
        const current = fs.lstatSync(output);
        if (!current.isSymbolicLink() && current.isFile() && current.dev === ownIdentity.dev && current.ino === ownIdentity.ino) fs.unlinkSync(output);
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
}
module.exports = { FORMAT, BLOCK_SIZE, MAX_SIZE, MAX_BLOCKS, hashFile, createDelta, reconstructDelta, validate };
