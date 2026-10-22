'use strict';
/* Read-only postcondition for the existing vendor handler. Build1269579
 * reflection declares BalancingTable.skillPointsPerLevel as uint32 @0xB4.
 * This module never changes resources or character saves.
 */
const fsDefault = require('fs');
const path = require('path');
const TYPE = 'keen::BalancingTable';
const FIELD = 'skillPointsPerLevel';
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SERVER_WARNING = 'Nur Serverdaten geändert; die Clientdateien wurden nicht angepasst. Für den nächsten kontrollierten Test ein Client-Profil mit demselben Punktewert erstellen und auch den Client patchen. Die vollständige Wirkung muss im Spiel geprüft werden.';
function positiveUint32(value) { return Number.isInteger(value) && value > 0 && value <= 0xffffffff; }
function readDocument(fs, file) {
  let value;
  try { value = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
  catch (error) { throw Error('Skillpunkte-Prüfung: BalancingTable-JSON konnte nicht gelesen werden: ' + path.basename(file) + '. ' + error.message); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Skillpunkte-Prüfung: Ungültiges BalancingTable-JSON-Objekt: ' + path.basename(file));
  return value;
}
function check(ctx, inputRoot, outputRoot) {
  const option = ctx?.config?.player?.adjustSkillPointsPerLevel;
  const summary = { enabled: option?.enabled === true, role: ['server', 'client'].includes(ctx?.role) ? ctx.role : 'unknown', field: FIELD, valueType: 'uint32', requested: null, tablesChecked: 0, resources: [], warnings: [] };
  if (!summary.enabled) return summary;
  const requested = option.value;
  if (!positiveUint32(requested)) throw Error('Skillpunkte-Prüfung: Der gewünschte Wert muss eine positive uint32-Ganzzahl sein.');
  summary.requested = requested;
  const fs = ctx.fs || fsDefault;
  const input = path.join(inputRoot, 'BalancingTable'), output = path.join(outputRoot, 'BalancingTable');
  if (!fs.existsSync(input)) throw Error('Skillpunkte-Prüfung: Die BalancingTable-Ausgangsressource fehlt.');
  const names = fs.readdirSync(input).filter(name => name.endsWith('.json')).sort();
  if (!names.length) throw Error('Skillpunkte-Prüfung: Keine BalancingTable-Ausgangsressource gefunden.');
  if (!fs.existsSync(output)) throw Error('Skillpunkte-Prüfung: Der Patcher hat keine BalancingTable-Ausgabe erstellt.');
  const outputNames = fs.readdirSync(output).filter(name => name.endsWith('.json')).sort();
  if (names.length !== outputNames.length || names.some((name, index) => name !== outputNames[index])) throw Error('Skillpunkte-Prüfung: BalancingTable-Ausgaben fehlen oder passen nicht zur Ausgangsbasis.');
  const guids = new Set();
  for (const name of names) {
    const before = readDocument(fs, path.join(input, name));
    const after = readDocument(fs, path.join(output, name));
    if (before.$type !== TYPE || typeof before.$guid !== 'string' || !GUID.test(before.$guid) || guids.has(before.$guid.toLowerCase()) || !Object.prototype.hasOwnProperty.call(before, FIELD) || !positiveUint32(before[FIELD])) throw Error('Skillpunkte-Prüfung: Unbekannte oder ungültige BalancingTable-Ausgangsressource: ' + name);
    guids.add(before.$guid.toLowerCase());
    if (after.$type !== before.$type || after.$guid !== before.$guid) throw Error('Skillpunkte-Prüfung: Die Identität der BalancingTable-Ausgabe wurde verändert: ' + name);
    if (!Object.prototype.hasOwnProperty.call(after, FIELD) || !positiveUint32(after[FIELD]) || after[FIELD] !== requested) throw Error('Skillpunkte-Prüfung fehlgeschlagen: ' + name + ' enthält nicht den gewünschten Wert ' + requested + '. Der Patch wird nicht angewendet.');
    summary.resources.push({ file: name, guid: before.$guid, field: FIELD, before: before[FIELD], after: after[FIELD] });
  }
  summary.tablesChecked = summary.resources.length;
  if (summary.role === 'server') {
    summary.warnings.push(SERVER_WARNING);
    if (ctx.logger && typeof ctx.logger.warn === 'function') ctx.logger.warn(SERVER_WARNING);
  }
  return summary;
}
module.exports = { check, positiveUint32, TYPE, FIELD, SERVER_WARNING };
