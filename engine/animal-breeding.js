'use strict';
/* Own source. Changes existing adult farm-animal reproduction checks only.
 * All source/classification/output conflicts are checked before the first
 * write. Existing output resources are merged at the owned leaves, so other
 * mods (including production/taming) retain their fields. No save edits.
 */
const fsDefault = require('fs'), path = require('path');
const P = 'keen::ecs::';
const TEMPLATE = P + 'TemplateResource', ANIMAL = P + 'Animal', WILDLIFE = P + 'Wildlife', BABY = P + 'BabyAnimal';
const REPRODUCTION = 'keen::animal::ReproductionSetup';
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Placement helpers are real tamed prototypes, unlike Base/Test/Enemy resources.
const EXCLUDED_NAME = /(?:^|_)(?:Base|Baby|Babies|Enemy|Player|Npc|DEPRECATED|NOTFINISHED|DONOTUSE|DONOTPLACE|Test|Testing|Dummy)(?:_|$)/i;
const FARM_TYPES = new Set(['FarmAnimal', 'Bunny', 'Catdeer', 'Goat', 'SandDigger', 'Turkey', 'Yak', 'Capybara', 'Panda']);
const FORBIDDEN_COMPONENTS = ['NetworkPlayer', 'NetworkNpc', 'NetworkEnemy', 'Enemy', 'EnemyAI', 'Enemy01BehaviorState', 'EnemyArsenalReference', 'Gravestone', 'ItemCollection', 'ItemCollectionComponent'].map(n => P + n);
const WARNING = 'Tiervermehrung verändert das Prüfintervall vorhandener züchtbarer Nutztiere, keine garantierte Geburtsrate. Eine optionale Basischance gilt pro Prüfung; Abstand, Weltlimit, Futter und Bett bleiben erforderlich. Animal ist server_only: Solo/Host nutzt die Client-Daten, auf Dedicated Servern müssen die Server-Daten geändert sein; ein reiner Client-Mod erzwingt dort keine Vermehrung. Bereits gespeicherte Timer und Tiere können verzögert reagieren. Saves und Wachstum werden nicht bearbeitet; Verhalten und gemischte Clients sind nicht im Spiel geprüft.';
const fail = message => { throw Error('Tiervermehrung: ' + message); };
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const clone = v => JSON.parse(JSON.stringify(v));
const exactKeys = (v, keys) => object(v) && Object.keys(v).sort().join('|') === keys.slice().sort().join('|');
const validGuid = v => typeof v === 'string' && GUID.test(v) && !/^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(v);
const uint32 = v => Number.isInteger(v) && v >= 0 && v <= 0xffffffff;
function integer(value, min, max, name) { if (!Number.isInteger(value) || value < min || value > max) fail(name + ' muss eine ganze Zahl von ' + min + ' bis ' + max + ' sein.'); return value; }
function role(value) { if (!['client', 'server'].includes(value)) fail('Client-/Server-Rolle fehlt.'); return value; }
function assertSchema(reflection) {
  if (!reflection?.version?.startsWith('1273043|') || !Array.isArray(reflection.types)) fail('Frische Reflection für Build1273043 erforderlich.');
  const types = reflection.types;
  function type(name) {
    const matches = types.filter(t => t?.qualifiedName === name);
    if (matches.length !== 1) fail('Reflection-Typ ist nicht eindeutig: ' + name);
    return matches[0];
  }
  function field(owner, name, offset, target) {
    const f = owner.structFields?.[name];
    if (!object(f) || f.dataOffset !== offset || !Number.isInteger(f.type) || types[f.type] !== type(target)) fail('Unbekannte Feldstruktur: ' + owner.qualifiedName + '.' + name);
    return f;
  }
  function struct(name, size, alignment, count) {
    const t = type(name);
    if (t.primitiveType !== 'STRUCT' || t.size !== size || t.alignment !== alignment || t.fieldCount !== count) fail('Unbekannte Struktur: ' + name);
    return t;
  }
  const repro = struct(REPRODUCTION, 16, 8, 3);
  if (!exactKeys(repro.structFields, ['maxReproductionDistance', 'baseReproductionChance', 'reproductionRate'])) fail('Unbekannte ReproductionSetup-Felder.');
  const distance = field(repro, 'maxReproductionDistance', 0, 'keen::float32');
  const chance = field(repro, 'baseReproductionChance', 4, 'keen::float32');
  field(repro, 'reproductionRate', 8, 'keen::Time');
  if (distance.attributes?.min?.value !== '0.0f' || chance.attributes?.min?.value !== '0.0f' || chance.attributes?.max?.value !== '1.0f') fail('Unbekannte Reproduktionsgrenzen.');
  const time = struct('keen::Time', 8, 8, 1), f32 = type('keen::float32'), s64 = type('keen::sint64');
  if (!exactKeys(time.structFields, ['value']) || f32.primitiveType !== 'FLOAT32' || f32.size !== 4 || f32.alignment !== 4 || s64.primitiveType !== 'SINT64' || s64.size !== 8 || s64.alignment !== 8) fail('Unbekannte Chance-/Zeit-Zahlentypen.');
  field(time, 'value', 0, 'keen::sint64');
  const animal = struct(ANIMAL, 656, 8, 25), wildlife = struct(WILDLIFE, 736, 8, 30), baby = struct(BABY, 40, 8, 4);
  if (animal.attributes?.server_only?.name !== 'server_only' || animal.attributes?.do_not_save?.name !== 'do_not_save' || baby.attributes?.server_only?.name !== 'server_only') fail('Geprüfte server_only-/do_not_save-Klassifikation fehlt.');
  field(animal, 'type', 188, 'keen::animal::Type');
  field(animal, 'reproductionSetup', 544, REPRODUCTION);
  field(animal, 'babyAnimalVersion', 608, P + 'TemplateReference');
  field(wildlife, 'enabledFeatures', 128, 'keen::wildlife::FeatureMask');
  field(baby, 'grownUpEntity', 8, P + 'TemplateReference');
  const reference = type(P + 'TemplateReference');
  if (reference.primitiveType !== 'TYPEDEF' || reference.size !== 16 || reference.alignment !== 4) fail('Unbekannte Baby-Template-Referenz.');
  const mask = type('keen::wildlife::FeatureMask'), bits = type('keen::Bitmask16<keen::wildlife::Feature>'), feature = type('keen::wildlife::Feature');
  const features = ['Roaming', 'Flee', 'ShowSpawnSequence', 'Tameable', 'RunAway'];
  if (mask.primitiveType !== 'TYPEDEF' || mask.size !== 2 || types[mask.innerType] !== bits || bits.primitiveType !== 'BITMASK16' || bits.size !== 2 || types[bits.innerType] !== feature || feature.primitiveType !== 'ENUM' || feature.size !== 1 || !exactKeys(feature.enumFields, features)) fail('Unbekannte Tameable-Featuremaske.');
  features.forEach((name, value) => { if (feature.enumFields[name]?.value !== value) fail('Tameable-Featurewerte wurden verändert.'); });
  const animalType = type('keen::animal::Type'), animals = ['None', 'Fish', 'FarmAnimal', 'Bunny', 'Catdeer', 'Goat', 'SandDigger', 'Turkey', 'Yak', 'Capybara', 'Pet', 'Cat', 'Dog', 'Panda'];
  if (animalType.primitiveType !== 'ENUM' || animalType.size !== 1 || !exactKeys(animalType.enumFields, animals)) fail('Unbekannte Tierarten-Klassifikation.');
  animals.forEach((name, value) => { if (animalType.enumFields[name]?.value !== value) fail('Tierartenwerte wurden verändert.'); });
  const template = struct(TEMPLATE, 24, 4, 7);
  if (!uint32(template.qualifiedHash) || template.qualifiedHash.toString(16).padStart(8, '0') !== '39768775') fail('TemplateResource-Ressourcenkennung fehlt.');
  return { build: reflection.version, templateHash: '39768775', features: new Set(features), animals: new Set(animals), serverOnly: true };
}
function read(fs, file) {
  try { const doc = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); if (!object(doc)) fail('JSON-Objekt fehlt.'); return doc; }
  catch (error) { fail('JSON nicht lesbar: ' + path.basename(file) + '. ' + error.message); }
}
function identity(doc, file, schema) {
  if (!object(doc) || doc.$type !== TEMPLATE || !validGuid(doc.$guid) || !Number.isSafeInteger(doc.$part) || doc.$part < 0 || typeof doc.name !== 'string' || !doc.name || typeof doc.family !== 'string') fail('Ungültige Template-Identität: ' + path.basename(file));
  const guid = doc.$guid.toLowerCase();
  if (path.basename(file).toLowerCase() !== guid + '_' + schema.templateHash + '_' + doc.$part + '.json') fail('Dateiname, GUID und Typ passen nicht zusammen: ' + path.basename(file));
  return guid;
}
function component(doc, type) { return doc.components.find(c => c.$type === type); }
function validateComponents(doc, file) {
  if (!Array.isArray(doc.components) || doc.components.some(c => !object(c) || typeof c.$type !== 'string' || !object(c.$value))) fail('Ungültige Template-Komponenten: ' + path.basename(file));
  for (const type of [ANIMAL, WILDLIFE, BABY, P + 'IsTame', ...FORBIDDEN_COMPONENTS]) if (doc.components.filter(c => c.$type === type).length > 1) fail('Doppelte Komponente ' + type + ': ' + path.basename(file));
}
function validateReproduction(value, file) {
  if (!exactKeys(value, ['maxReproductionDistance', 'baseReproductionChance', 'reproductionRate']) || typeof value.maxReproductionDistance !== 'number' || !Number.isFinite(value.maxReproductionDistance) || value.maxReproductionDistance < 0 || !Number.isFinite(Math.fround(value.maxReproductionDistance)) || typeof value.baseReproductionChance !== 'number' || !Number.isFinite(value.baseReproductionChance) || value.baseReproductionChance < 0 || value.baseReproductionChance > 1 || !exactKeys(value.reproductionRate, ['value']) || !Number.isSafeInteger(value.reproductionRate.value) || value.reproductionRate.value < 1) fail('Ungültiges ReproductionSetup oder nicht sicher darstellbares positives Zeitintervall: ' + path.basename(file));
}
function candidate(doc, file, schema, native) {
  validateComponents(doc, file);
  const animal = component(doc, ANIMAL);
  if (!animal || EXCLUDED_NAME.test(doc.name) || component(doc, BABY) || doc.components.some(c => FORBIDDEN_COMPONENTS.includes(c.$type))) return null;
  const type = animal.$value.type;
  if (!schema.animals.has(type)) fail('Unbekannte Tierart: ' + path.basename(file));
  if (!FARM_TYPES.has(type)) return null;
  if (!['Animal', 'None'].includes(doc.family)) fail('Nutztier außerhalb der belegten Animal-/None-Familien: ' + path.basename(file));
  const wildlife = component(doc, WILDLIFE);
  if (!wildlife) return null;
  const features = wildlife.$value.enabledFeatures;
  if (!Array.isArray(features) || features.some(f => !schema.features.has(f)) || new Set(features).size !== features.length) fail('Unbekannte Wildlife-Features: ' + path.basename(file));
  if (!features.includes('Tameable') || !validGuid(animal.$value.babyAnimalVersion)) return null;
  validateReproduction(animal.$value.reproductionSetup, file);
  // A zero native chance is disabled breeding, never a new breeding species.
  if (native && animal.$value.reproductionSetup.baseReproductionChance === 0) return null;
  return { index: doc.components.indexOf(animal), value: animal.$value.reproductionSetup, animalType: type, babyGuid: animal.$value.babyAnimalVersion.toLowerCase(), isTame: Boolean(component(doc, P + 'IsTame')) };
}
function calculate(value, speedFactor, chancePercent, file = 'ReproductionSetup') {
  integer(speedFactor, 1, 20, 'Tempofaktor'); integer(chancePercent, 0, 100, 'Basischance'); validateReproduction(value, file);
  const after = clone(value);
  after.reproductionRate.value = Math.ceil(value.reproductionRate.value / speedFactor);
  if (chancePercent > 0) after.baseReproductionChance = Math.fround(chancePercent / 100);
  validateReproduction(after, file); return after;
}
function isInside(a, b) { const rel = path.relative(a, b); return !rel || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel)); }
function realTarget(fs, target) {
  const tail = []; let current = path.resolve(target);
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) fail('Realer Ausgabeordner kann nicht aufgelöst werden.');
    tail.unshift(path.basename(current)); current = parent;
  }
  return path.resolve(fs.realpathSync(current), ...tail);
}
function sameChance(a, b) { return Math.fround(a) === Math.fround(b); }
function apply(ctx, inputRoot, outputRoot) {
  const summary = { enabled: ctx?.enabled === true, build: null, role: ctx?.role ?? 'unknown', serverOnly: true, speedFactor: ctx?.speedFactor === undefined ? 2 : ctx.speedFactor, chancePercent: ctx?.chancePercent === undefined ? 0 : ctx.chancePercent, targets: 0, tamedPrototypes: 0, tameablePrototypes: 0, filesChanged: 0, fieldsChanged: 0, resources: [], warnings: [], gameplayVerified: false };
  if (!summary.enabled) return summary;
  role(summary.role);
  const speedFactor = integer(summary.speedFactor, 1, 20, 'Tempofaktor'), chancePercent = integer(summary.chancePercent, 0, 100, 'Basischance');
  const schema = assertSchema(ctx.reflection), fs = ctx.fs || fsDefault;
  summary.build = schema.build;
  const input = path.resolve(inputRoot), output = path.resolve(outputRoot);
  if (isInside(input, output) || isInside(output, input)) fail('Ausgangs- und Ausgabeordner müssen getrennt sein und dürfen nicht ineinander liegen.');
  const directory = path.join(inputRoot, 'TemplateResource'), outputDirectory = path.join(outputRoot, 'TemplateResource');
  if (!fs.existsSync(directory)) fail('TemplateResource-Export fehlt.');
  // Resolve existing ancestors too: an output subdirectory/junction or a
  // not-yet-created output under an alias must never point into the sources.
  function guardDestination(target) {
    if (typeof fs.realpathSync !== 'function') return;
    const realOutput = realTarget(fs, target);
    for (const source of [input, directory]) {
      const realInput = realTarget(fs, source);
      if (isInside(realInput, realOutput) || isInside(realOutput, realInput)) fail('Ausgangs- und Ausgabeordner verweisen auf überlappende reale Pfade.');
    }
  }
  guardDestination(output); guardDestination(outputDirectory);
  const names = fs.readdirSync(directory).filter(n => /\.json$/i.test(n)).sort(), resources = new Map();
  if (!names.length) fail('TemplateResource-Export ist leer.');
  for (const name of names) {
    const file = path.join(directory, name), text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    if (!text.includes(ANIMAL)) continue;
    const doc = read(fs, file), guid = identity(doc, file, schema);
    if (resources.has(guid)) fail('Doppelte oder mehrteilige Tier-Template-GUID: ' + name);
    resources.set(guid, { name, file, doc, selected: candidate(doc, file, schema, true) });
  }
  const outputNames = fs.existsSync(outputDirectory) ? fs.readdirSync(outputDirectory).filter(n => /\.json$/i.test(n)) : [];
  const pending = [];
  for (const [guid, row] of resources) {
    const selected = row.selected;
    if (!selected) continue;
    const baby = resources.get(selected.babyGuid);
    if (!baby || baby.doc.family !== 'Animal' || !component(baby.doc, BABY) || component(baby.doc, ANIMAL)?.$value.type !== selected.animalType || !component(baby.doc, P + 'IsTame')) fail('Passendes gezähmtes BabyAnimal-Template fehlt: ' + row.name);
    if (outputNames.filter(n => n.toLowerCase().startsWith(guid + '_')).some(n => n.toLowerCase() !== row.name.toLowerCase()) || outputNames.filter(n => n.toLowerCase() === row.name.toLowerCase()).length > 1) fail('Kollidierende Ausgabe-GUID oder Ressourcenteile: ' + row.name);
    const desired = calculate(selected.value, speedFactor, chancePercent, row.name), destination = path.join(outputDirectory, row.name);
    guardDestination(destination);
    const current = fs.existsSync(destination) ? read(fs, destination) : row.doc;
    identity(current, destination, schema);
    if (['$guid', '$part', '$type', 'name', 'family'].some(k => current[k] !== row.doc[k])) fail('Ausgabeidentität wurde verändert: ' + row.name);
    const live = candidate(current, destination, schema, false);
    if (!live || live.animalType !== selected.animalType || live.isTame !== selected.isTame || live.babyGuid !== selected.babyGuid) fail('Nutztierklassifikation wurde in der Ausgabe verändert: ' + row.name);
    if (![selected.value.reproductionRate.value, desired.reproductionRate.value].includes(live.value.reproductionRate.value)) fail('Andere Änderung setzt ein widersprüchliches Reproduktionsintervall: ' + row.name);
    if (chancePercent > 0 && !sameChance(live.value.baseReproductionChance, selected.value.baseReproductionChance) && !sameChance(live.value.baseReproductionChance, desired.baseReproductionChance)) fail('Andere Änderung setzt eine widersprüchliche Reproduktionschance: ' + row.name);
    const patched = clone(current), value = patched.components[live.index].$value.reproductionSetup, pointer = '/components/' + live.index + '/$value/reproductionSetup', pointers = [];
    if (value.reproductionRate.value !== desired.reproductionRate.value) { value.reproductionRate.value = desired.reproductionRate.value; pointers.push(pointer + '/reproductionRate/value'); }
    if (chancePercent > 0 && !sameChance(value.baseReproductionChance, desired.baseReproductionChance)) { value.baseReproductionChance = desired.baseReproductionChance; pointers.push(pointer + '/baseReproductionChance'); }
    summary.targets++; summary[selected.isTame ? 'tamedPrototypes' : 'tameablePrototypes']++;
    summary.resources.push({ file: row.name, guid, name: row.doc.name, family: row.doc.family, animalType: selected.animalType, isTame: selected.isTame, babyGuid: selected.babyGuid, componentIndex: live.index, pointer, before: clone(selected.value), after: clone(desired) });
    if (pointers.length) pending.push({ destination, doc: patched, pointers });
  }
  if (!summary.targets) fail('Keine belegten erwachsenen, züchtbaren und zähmbaren Nutztiere gefunden; neue Spieldaten müssen geprüft werden.');
  summary.warnings.push(WARNING);
  if (typeof ctx.logger?.warn === 'function') ctx.logger.warn(WARNING);
  for (const row of pending) {
    fs.mkdirSync(path.dirname(row.destination), { recursive: true });
    fs.writeFileSync(row.destination, JSON.stringify(row.doc, null, 2), 'utf8');
    summary.filesChanged++; summary.fieldsChanged += row.pointers.length;
    if (typeof ctx.track === 'function') for (const pointer of row.pointers) ctx.track(row.destination, pointer);
  }
  return summary;
}
function verify(summary, reflection, verifyRoot, fs = fsDefault) {
  if (summary?.enabled !== true) return { enabled: false, checked: 0, resourcesChecked: 0, gameplayVerified: false };
  const schema = assertSchema(reflection), checkedRole = role(summary.role);
  const speedFactor = integer(summary.speedFactor, 1, 20, 'Tempofaktor'), chancePercent = integer(summary.chancePercent, 0, 100, 'Basischance');
  if (summary.build !== schema.build || summary.serverOnly !== true) fail('Spielversion oder server_only-Prüfliste stimmt nicht mit der frischen Reflection überein.');
  if (!Array.isArray(summary.resources) || !summary.resources.length || summary.targets !== summary.resources.length) fail('Prüfliste der Tiervermehrung fehlt oder ist inkonsistent.');
  const seen = new Set(); let fieldsChecked = 0;
  for (const row of summary.resources) {
    if (!object(row) || typeof row.file !== 'string' || path.basename(row.file) !== row.file || !validGuid(row.guid) || seen.has(row.guid.toLowerCase())) fail('Ungültige oder doppelte Ressourcenidentität in der Prüfliste.');
    seen.add(row.guid.toLowerCase());
    const expected = calculate(row.before, speedFactor, chancePercent, row.file);
    if (row.before.baseReproductionChance <= 0 || !object(row.after) || row.after.reproductionRate?.value !== expected.reproductionRate.value || (chancePercent > 0 && !sameChance(row.after.baseReproductionChance, expected.baseReproductionChance))) fail('Berechnete Sollwerte stimmen nicht mit der Prüfliste überein: ' + row.file);
    const file = path.join(verifyRoot, 'TemplateResource', row.file), doc = read(fs, file), guid = identity(doc, file, schema), selected = candidate(doc, file, schema, false);
    if (guid !== row.guid.toLowerCase() || doc.name !== row.name || doc.family !== row.family || !selected || selected.animalType !== row.animalType || selected.isTame !== row.isTame || selected.babyGuid !== row.babyGuid || selected.value.reproductionRate.value !== expected.reproductionRate.value || (chancePercent > 0 && !sameChance(selected.value.baseReproductionChance, expected.baseReproductionChance))) fail('Tiervermehrungswerte oder Klassifikation nach dem Packen stimmen nicht: ' + row.file);
    fieldsChecked += chancePercent > 0 ? 2 : 1;
  }
  return { enabled: true, role: checkedRole, serverOnly: true, checked: seen.size, resourcesChecked: seen.size, fieldsChecked, gameplayVerified: false };
}
module.exports = { apply, verify, assertSchema, calculate, WARNING, TEMPLATE, ANIMAL, WILDLIFE, BABY, REPRODUCTION, EXCLUDED_NAME };
