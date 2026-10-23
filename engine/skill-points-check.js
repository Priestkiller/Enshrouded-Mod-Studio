'use strict';
/* Own read-only schema, identity and value checks. No resource or save writes.
 * Current1269579/1273043 reflection: BalancingTable.skillPointsPerLevel u32@180.
 */
const fsDefault = require('fs');
const path = require('path');
const TYPE = 'keen::BalancingTable';
const FIELD = 'skillPointsPerLevel';
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SERVER_WARNING = 'Dieser Lauf bestätigt nur den Serverwert. Die Clientdateien wurden nicht angepasst. Im Spielclient den installierten Punktewert prüfen und dort denselben gewünschten Wert anwenden; ein separates Punkte-Profil genügt. Die tatsächliche Punkteberechnung im Spiel ist damit noch nicht bestätigt.';
function positiveUint32(value) { return Number.isInteger(value) && value > 0 && value <= 0xffffffff; }
function fail(message) { throw Error('Skillpunkte-Prüfung: ' + message); }
function assertSchema(reflection) {
  if (!reflection || typeof reflection.version !== 'string' || !reflection.version.trim() || !Array.isArray(reflection.types)) fail('Frische Reflection mit Spielversion fehlt.');
  const matches = reflection.types.filter(type => type && type.qualifiedName === TYPE);
  if (matches.length !== 1) fail('BalancingTable ist in der aktuellen Reflection nicht eindeutig.');
  const table = matches[0], field = table.structFields?.[FIELD], primitive = Number.isInteger(field?.type) ? reflection.types[field.type] : null;
  if (table.primitiveType !== 'STRUCT' || table.size !== 688 || table.alignment !== 8 || table.fieldCount !== 88 || !field || field.dataOffset !== 180 || !primitive || primitive.qualifiedName !== 'keen::uint32' || primitive.primitiveType !== 'UINT32' || primitive.size !== 4 || primitive.alignment !== 4) fail('Die Struktur von skillPointsPerLevel wurde verändert; erwartet wird uint32 an Position180 in der geprüften BalancingTable.');
  if (!Number.isInteger(table.qualifiedHash) || table.qualifiedHash < 0 || table.qualifiedHash > 0xffffffff) fail('Die Ressourcenkennung der BalancingTable fehlt.');
  return { build: reflection.version, type: TYPE, resourceTypeHash: table.qualifiedHash.toString(16).padStart(8, '0'), field: FIELD, offset: field.dataOffset, valueType: 'uint32' };
}
function readDocument(fs, file) {
  let value;
  try { value = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
  catch (error) { throw Error('Skillpunkte-Prüfung: BalancingTable-JSON konnte nicht gelesen werden: ' + path.basename(file) + '. ' + error.message); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Skillpunkte-Prüfung: Ungültiges BalancingTable-JSON-Objekt: ' + path.basename(file));
  return value;
}
function resources(fs, root, schema) {
  const directory = path.join(root, 'BalancingTable');
  if (!fs.existsSync(directory)) fail('Die BalancingTable-Ressource fehlt.');
  const names = fs.readdirSync(directory).filter(name => name.endsWith('.json')).sort();
  if (!names.length) fail('Keine BalancingTable-Ressource gefunden.');
  const result = new Map(), guids = new Set();
  for (const name of names) {
    const doc = readDocument(fs, path.join(directory, name));
    if (doc.$type !== TYPE || typeof doc.$guid !== 'string' || !GUID.test(doc.$guid) || doc.$guid === '00000000-0000-0000-0000-000000000000' || !Number.isInteger(doc.$part) || doc.$part < 0 || !positiveUint32(doc[FIELD])) fail('Ungültige BalancingTable-Identität oder Punktezahl: ' + name);
    const guid = doc.$guid.toLowerCase();
    if (name.toLowerCase() !== guid + '_' + schema.resourceTypeHash + '_' + doc.$part + '.json') fail('Dateiname, GUID, Typ und Teilnummer passen nicht zusammen: ' + name);
    if (guids.has(guid)) fail('Doppelte oder mehrteilige BalancingTable ist nicht eindeutig: ' + name);
    guids.add(guid); result.set(name, doc);
  }
  return result;
}
function inspect(ctx, inputRoot) {
  const schema = assertSchema(ctx?.reflection);
  if (!positiveUint32(ctx?.requested)) fail('Der Vergleichswert muss eine positive uint32-Ganzzahl sein.');
  const source = resources(ctx.fs || fsDefault, inputRoot, schema), distribution = {}, rows = [];
  for (const [file, doc] of source) {
    distribution[doc[FIELD]] = (distribution[doc[FIELD]] || 0) + 1;
    rows.push({ file, guid: doc.$guid, part: doc.$part, value: doc[FIELD], expected: ctx.requested, matches: doc[FIELD] === ctx.requested });
  }
  const matching = rows.filter(row => row.matches).length;
  return { operation: 'inspect-skill-points', role: ['server', 'client'].includes(ctx.role) ? ctx.role : 'unknown', build: schema.build, schema, requested: ctx.requested, tableCount: rows.length, matchingRequested: matching, allMatch: matching === rows.length, distribution: Object.entries(distribution).map(([value, count]) => ({ value: Number(value), count })).sort((a, b) => a.value - b.value), resources: rows, warnings: ['Diese Prüfung liest den installierten Archivwert. Sie bestätigt keine Werte anderer Rechner und keinen tatsächlichen Punktegewinn im laufenden Spiel.'], gameplayVerified: false };
}
function check(ctx, inputRoot, outputRoot) {
  const option = ctx?.config?.player?.adjustSkillPointsPerLevel;
  const summary = { enabled: option?.enabled === true, role: ['server', 'client'].includes(ctx?.role) ? ctx.role : 'unknown', field: FIELD, valueType: 'uint32', requested: null, tablesChecked: 0, resources: [], warnings: [], validated: false, archiveReadbackValidated: false, gameplayVerified: false };
  if (!summary.enabled) return summary;
  const requested = option.value;
  if (!positiveUint32(requested)) throw Error('Skillpunkte-Prüfung: Der gewünschte Wert muss eine positive uint32-Ganzzahl sein.');
  summary.requested = requested;
  const schema = assertSchema(ctx.reflection), fs = ctx.fs || fsDefault;
  summary.build = schema.build; summary.schema = schema;
  const source = resources(fs, inputRoot, schema), output = resources(fs, outputRoot, schema);
  const names = [...source.keys()], outputNames = [...output.keys()];
  if (names.length !== outputNames.length || names.some((name, index) => name !== outputNames[index])) throw Error('Skillpunkte-Prüfung: BalancingTable-Ausgaben fehlen oder passen nicht zur Ausgangsbasis.');
  for (const name of names) {
    const before = source.get(name), after = output.get(name);
    if (after.$type !== before.$type || after.$guid !== before.$guid || after.$part !== before.$part) throw Error('Skillpunkte-Prüfung: Die Identität der BalancingTable-Ausgabe wurde verändert: ' + name);
    if (!Object.prototype.hasOwnProperty.call(after, FIELD) || !positiveUint32(after[FIELD]) || after[FIELD] !== requested) throw Error('Skillpunkte-Prüfung fehlgeschlagen: ' + name + ' enthält nicht den gewünschten Wert ' + requested + '. Der Patch wird nicht angewendet.');
    summary.resources.push({ file: name, guid: before.$guid, part: before.$part, field: FIELD, before: before[FIELD], after: after[FIELD] });
  }
  summary.tablesChecked = summary.resources.length;
  summary.validated = true;
  if (summary.role === 'server') {
    summary.warnings.push(SERVER_WARNING);
    if (ctx.logger && typeof ctx.logger.warn === 'function') ctx.logger.warn(SERVER_WARNING);
  }
  return summary;
}
module.exports = { check, inspect, assertSchema, positiveUint32, TYPE, FIELD, SERVER_WARNING };
