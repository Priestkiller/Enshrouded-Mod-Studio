'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const TYPE = 'keen::ItemInfo';
const FIELD = 'maxStackSize';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function fail(message) { throw Error('Stapelprüfung: ' + message); }
function read(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
  catch (error) { fail('Datei nicht lesbar: ' + path.basename(file) + '. ' + error.message); }
}
function assertSchema(reflection) {
  if (!reflection || typeof reflection.version !== 'string' || !reflection.version.trim() || !Array.isArray(reflection.types))
    fail('Frisch erzeugte Reflection mit Spielversion fehlt.');
  const matches = reflection.types.filter(type => type && type.qualifiedName === TYPE);
  if (matches.length !== 1) fail('Die aktuelle Spielversion enthält keine eindeutige ItemInfo-Struktur.');
  const item = matches[0], field = item.structFields && item.structFields[FIELD];
  if (!field || !Number.isInteger(field.type) || !reflection.types[field.type]) fail('Das Stapelfeld fehlt in der aktuellen Spielversion.');
  let primitive = reflection.types[field.type], hops = 0;
  while (primitive.primitiveType === 'TYPEDEF' && Number.isInteger(primitive.innerType) && hops++ < 16)
    primitive = reflection.types[primitive.innerType] || {};
  if (primitive.primitiveType !== 'UINT16' || primitive.size !== 2)
    fail('Der Datentyp des Stapelfelds wurde geändert. Erwartet wird uint16; diese Spielversion benötigt eine Anpassung.');
  if (!Number.isInteger(item.size) || !Number.isInteger(field.dataOffset) || field.dataOffset < 0 || field.dataOffset + 2 > item.size)
    fail('Die Feldposition der aktuellen ItemInfo-Struktur ist ungültig.');
  if (!Number.isInteger(item.qualifiedHash) || item.qualifiedHash < 0 || item.qualifiedHash > 0xffffffff)
    fail('Die Ressourcenkennung der aktuellen ItemInfo-Struktur fehlt.');
  return { build: reflection.version, resourceType: TYPE, resourceTypeHash: item.qualifiedHash.toString(16).padStart(8, '0'), field: FIELD, valueType: 'uint16', minimum: 2, maximum: 65535, offset: field.dataOffset };
}
function requestedValue(value) {
  if (!Number.isInteger(value) || value < 2 || value > 65535)
    fail('Die gewünschte Stapelgröße muss eine ganze Zahl zwischen 2 und 65535 sein. Die aktuelle Spielstruktur speichert uint16.');
  return value;
}
function jsonFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name)).flatMap(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? jsonFiles(file) : entry.isFile() && entry.name.endsWith('.json') ? [file] : [];
  });
}
function identity(document, file, schema) {
  if (!document || typeof document !== 'object' || Array.isArray(document) || document.$type !== TYPE || !UUID.test(document.$guid || '') || !Number.isInteger(document.$part) || document.$part < 0)
    fail('Ungültige ItemInfo-Identität: ' + path.basename(file));
  const expected = document.$guid.toLowerCase() + '_' + schema.resourceTypeHash + '_' + document.$part + '.json';
  if (path.basename(file).toLowerCase() !== expected) fail('Dateiname und Ressourcenkennung stimmen nicht überein: ' + path.basename(file));
  if (!Number.isInteger(document[FIELD]) || document[FIELD] < 1 || document[FIELD] > 65535)
    fail('Fehlendes oder ungültiges uint16-Stapelfeld: ' + path.basename(file));
  if (!Array.isArray(document.flags) || document.flags.some(flag => typeof flag !== 'string'))
    fail('Die Item-Flags der aktuellen Spielversion können nicht geprüft werden: ' + path.basename(file));
  return document.$guid.toLowerCase() + ':' + document.$part;
}
function items(directory, schema, required) {
  const result = new Map();
  for (const file of jsonFiles(path.join(directory, 'ItemInfo'))) {
    const document = read(file), id = identity(document, file, schema);
    if (result.has(id)) fail('Doppelte ItemInfo-Ressource: ' + path.basename(file));
    result.set(id, { document, file });
  }
  if (required && !result.size) fail('Keine ItemInfo-Ressourcen gefunden. Die aktuelle Spielversion kann nicht geprüft werden.');
  return result;
}
function roleOf(role) { return role === 'client' || role === 'server' ? role : 'unknown'; }
function isStackable(document) { return document[FIELD] > 1; }
function rejectPersistentStack(document, file) {
  if (isStackable(document) && Array.isArray(document.flags) && document.flags.includes('HasPIDE'))
    fail('Ein stapelbarer Gegenstand besitzt individuelle Instanzdaten (HasPIDE). Diese Spielversion benötigt eine gezielte Anpassung: ' + path.basename(file));
}
function distribution(documents) {
  const counts = {};
  for (const document of documents) counts[document[FIELD]] = (counts[document[FIELD]] || 0) + 1;
  return counts;
}
function sampleRows(rows) {
  const preferred = ['Material_T1_Wood_Logs', 'Material_T1_Resin', 'Material_T2_Wood_Hardwood'];
  return rows.slice().sort((a,b) => {
    const ai = preferred.indexOf(a.name), bi = preferred.indexOf(b.name);
    return (ai < 0 ? 100 : ai) - (bi < 0 ? 100 : bi) || a.name.localeCompare(b.name);
  }).slice(0, 10);
}
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
function createdSpellItems(options, schema, originals, modified) {
  const proof = options.skeletonSpells;
  if (!proof || proof.enabled !== true) return new Map();
  const itemsProof = proof.items, role = roleOf(options.role);
  if (options.config?.world?.enableSkeletonSummoningSpells?.enabled !== true || role === 'unknown' || proof.role !== role || proof.prototype !== true || proof.gameplayVerified !== false ||
      itemsProof?.enabled !== true || itemsProof.role !== role || itemsProof.build !== schema.build || itemsProof.prototype !== true || itemsProof.gameplayVerified !== false || itemsProof.itemCount !== 6 ||
      !Array.isArray(itemsProof.resources) || itemsProof.resources.length !== 9)
    fail('Die Prüfliste der neu angelegten Begleiterzauber ist unvollständig oder gehört zu einer anderen Rolle/Spielversion.');
  const own = require('./custom-skeleton-items');
  const definitions = own.assertDefinitions();
  if (canonical(itemsProof.createdResources) !== canonical(own.CREATED_RESOURCES)) fail('Die neuen Begleiter-Itemidentitäten sind nicht freigegeben.');
  const createdRows = itemsProof.resources.filter(row => row?.created === true);
  if (createdRows.length !== definitions.items.length) fail('Die Prüfliste enthält nicht genau die sechs neuen Begleitergegenstände.');
  const sourceId = definitions.sourceItem.guid + ':0', native = modified.get(sourceId) || originals.get(sourceId);
  if (!native || native.document[FIELD] !== 1) fail('Die ewige Itembasis der Begleiter ist nicht als Einzelgegenstand bestätigt.');
  const originalsByGuid = new Set([...originals.values()].map(row => row.document.$guid.toLowerCase()));
  const originalIds = new Set([...originals.values()].map(row => row.document.itemId?.value));
  const created = new Map();
  for (const definition of definitions.items) {
    const id = definition.guid + ':0', row = modified.get(id), expectedFile = definition.guid + '_' + schema.resourceTypeHash + '_0.json';
    const claims = createdRows.filter(claim => claim.guid === definition.guid);
    if (originalsByGuid.has(definition.guid) || originalIds.has(definition.itemId)) fail('Eine neue Begleiteridentität kollidiert mit der Ausgangsbasis.');
    if (claims.length !== 1 || !row) fail('Ein freigegebener neuer Begleitergegenstand fehlt oder ist doppelt.');
    const claim = claims[0], document = row.document;
    if (claim.directory !== 'ItemInfo' || claim.type !== TYPE || claim.part !== 0 || claim.file !== expectedFile || !/^[a-f0-9]{64}$/.test(claim.sha256 || '') ||
        document.objectId !== definition.guid || document.itemId?.value !== definition.itemId || document.debugName !== definition.debugName || document[FIELD] !== 1 ||
        canonical(document.flags) !== canonical(native.document.flags) || crypto.createHash('sha256').update(canonical(document)).digest('hex') !== claim.sha256)
      fail('Ein neuer Begleitergegenstand widerspricht seiner geprüften Einzelgegenstand-Ausgabe: ' + path.basename(row.file));
    created.set(id, row);
  }
  return created;
}
function inspect(options, directory) {
  const schema = assertSchema(options.reflection), requested = requestedValue(options.requested);
  const source = items(directory, schema, true), rows = [];
  for (const { document, file } of source.values()) {
    rejectPersistentStack(document, file);
    if (isStackable(document)) rows.push({ file: path.basename(file), guid: document.$guid.toLowerCase(), name: document.debugName || document.$guid, value: document[FIELD], maxStackSize: document[FIELD], expected: requested, matches: document[FIELD] === requested });
  }
  if (!rows.length) fail('Keine stapelbaren Gegenstände gefunden. Die aktuelle Spielversion benötigt eine Prüfung.');
  const matching = rows.filter(row => row.matches).length;
  return {
    operation: 'inspect-stacks', enabled: true, validated: true, role: roleOf(options.role), requested,
    build: schema.build, schema, totalItems: source.size, stackableItems: rows.length, singletonItems: source.size - rows.length,
    matchingItems: matching, mismatchingItems: rows.length - matching,
    distribution: distribution([...source.values()].map(row => row.document).filter(isStackable)), samples: sampleRows(rows),
    warnings: ['Diese Prüfung liest Archivwerte. Sie bestätigt weder das verwendete Profil anderer Rechner noch die Wirkung im laufenden Spiel.']
  };
}
function check(options, input, output) {
  const option = options.config && options.config.inventory && options.config.inventory.adjustStackSize;
  if (!option || option.enabled !== true) return { enabled: false, role: roleOf(options.role), validated: false, warnings: [] };
  const schema = assertSchema(options.reflection), requested = requestedValue(option.value);
  const originals = items(input, schema, true), modified = items(output, schema, false), rows = [];
  const created = createdSpellItems(options, schema, originals, modified);
  for (const [id, row] of modified) if (!originals.has(id) && !created.has(id)) fail('Ausgabe enthält eine unbekannte ItemInfo-Ressource: ' + path.basename(row.file));
  if (options.complete === true && (modified.size !== originals.size + created.size || [...originals.keys()].some(id => !modified.has(id))))
    fail('Der erneute Export enthält nicht alle ursprünglichen ItemInfo-Ressourcen.');
  let changed = 0, singletonItems = created.size;
  for (const [id, { document: before, file }] of originals) {
    rejectPersistentStack(before, file);
    const change = modified.get(id), after = change ? change.document : before;
    if (before.flags.includes('HasPIDE') !== after.flags.includes('HasPIDE'))
      fail('Der Instanzschutz eines Gegenstands wurde verändert: ' + path.basename(file));
    rejectPersistentStack(after, file);
    if (before[FIELD] === 1) {
      singletonItems++;
      if (after[FIELD] !== 1) fail('Ein nicht stapelbarer Gegenstand wurde verändert: ' + path.basename(file));
      continue;
    }
    if (!change && before[FIELD] !== requested) fail('Erwartete Stapel-Ausgabe fehlt: ' + path.basename(file));
    if (after[FIELD] !== requested) fail('Stapelwert stimmt nicht mit dem Profil überein: ' + path.basename(file) + ' (' + after[FIELD] + ' statt ' + requested + ').');
    if (before[FIELD] !== after[FIELD]) changed++;
    rows.push({ file: path.basename(file), guid: before.$guid.toLowerCase(), name: before.debugName || before.$guid, before: before[FIELD], after: after[FIELD], value: after[FIELD], expected: requested, matches: true });
  }
  if (!rows.length) fail('Keine stapelbaren Gegenstände gefunden. Die aktuelle Spielversion benötigt eine Prüfung.');
  const result = {
    enabled: true, validated: true, role: roleOf(options.role), requested, build: schema.build, schema,
    totalItems: originals.size + created.size, checkedItems: originals.size + created.size, stackableItems: rows.length, singletonItems,
    matchingItems: rows.length, mismatchingItems: 0, changedItems: changed, samples: sampleRows(rows), warnings: []
  };
  if (options.logger && typeof options.logger.info === 'function')
    options.logger.info('Stapelwerte (' + result.role + '): ' + rows.length + ' stapelbare Gegenstände auf ' + requested + ' geprüft; ' + singletonItems + ' Einzelgegenstände bleiben nicht stapelbar.');
  return result;
}
module.exports = { assertSchema, check, inspect, requestedValue };
