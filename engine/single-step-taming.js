'use strict';
// Own source. Changes the required successful taming rounds, not bait,
// approach behaviour, failure conditions or existing saved animal progress.
const fsDefault = require('fs');
const path = require('path');
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ZERO_GUID = '00000000-0000-0000-0000-000000000000';
const TEMPLATE = 'keen::ecs::TemplateResource';
const WILDLIFE = 'keen::ecs::Wildlife';
const IS_TAME = 'keen::ecs::IsTame';
const FOOD_BAIT = 'keen::ecs::FoodBait';
const TAMING = 'keen::wildlife::TamingSetup';
const EXCLUDED_NAME = /(?:^|_)(?:Base|PLACEMENT_HELPER|DEPRECATED|NOTFINISHED|DONOTUSE|DONOTPLACE|Test|Testing|Dummy)(?:_|$)/i;
const WARNING = 'Ein erfolgreicher Zähmungsdurchgang wird in den Tierdaten als ausreichend hinterlegt. Passender Köder, Annäherung und die übrigen Zähmungsbedingungen bleiben erforderlich. Bereits gespeicherter Fortschritt und das Zusammenspiel von Client und Dedicated Server sind nicht im Spiel geprüft.';
const SETUP_FIELDS = {
  isWildlifeBehaviorActiveWhileTamed: [0, 'keen::bool'], favoriteFood: [4, 'keen::ecs::TemplateReference'],
  necessaryTamingSteps: [20, 'keen::uint8'], foodBaitSensorRange: [24, 'keen::float32'],
  foodBaitAngleCheckMinDistance: [28, 'keen::float32'], foodBaitEatMaxDuration: [32, 'keen::Time'],
  alertDurationHigh: [40, 'keen::Time'], alertDurationMediumFoodEat: [48, 'keen::Time'],
  foodBaitEatAdaptFleeRadiusDistance: [56, 'keen::float32'], tamingApproachFinishedFleeRadius: [60, 'keen::float32'],
  foodBaitEatSnoutPivotDistance: [64, 'keen::float32']
};
function fail(text) { throw Error('Einfaches Zähmen: ' + text); }
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function exactKeys(value, keys) { return object(value) && Object.keys(value).sort().join('|') === keys.slice().sort().join('|'); }
function validGuid(value) { return typeof value === 'string' && GUID.test(value) && value.toLowerCase() !== ZERO_GUID; }
function assertSchema(reflection) {
  if (!reflection || typeof reflection.version !== 'string' || !reflection.version.trim() || !Array.isArray(reflection.types)) fail('Frische Reflection mit Spielversion fehlt.');
  const types = reflection.types;
  function type(name) {
    const found = types.filter(t => t && t.qualifiedName === name);
    if (found.length !== 1) fail('Reflection-Typ nicht eindeutig: ' + name);
    return found[0];
  }
  function field(owner, name, offset, target) {
    const f = owner.structFields?.[name];
    if (!object(f) || f.dataOffset !== offset || !Number.isInteger(f.type) || types[f.type] !== type(target)) fail('Unbekannte Feldstruktur: ' + owner.qualifiedName + '.' + name);
    return f;
  }
  const setup = type(TAMING), wildlife = type(WILDLIFE), template = type(TEMPLATE), u8 = type('keen::uint8');
  if (type(FOOD_BAIT).primitiveType !== 'STRUCT') fail('FoodBait-Klassifikation fehlt in der Reflection.');
  if (setup.primitiveType !== 'STRUCT' || setup.size !== 72 || setup.alignment !== 8 || setup.fieldCount !== 11 || !exactKeys(setup.structFields, Object.keys(SETUP_FIELDS))) fail('TamingSetup entspricht nicht der geprüften Struktur.');
  for (const [name, [offset, target]] of Object.entries(SETUP_FIELDS)) field(setup, name, offset, target);
  const steps = setup.structFields.necessaryTamingSteps;
  if (u8.primitiveType !== 'UINT8' || u8.size !== 1 || u8.alignment !== 1 || steps.attributes?.min?.value !== '1u.0f' || steps.attributes?.max?.value !== '5u.0f') fail('necessaryTamingSteps ist nicht das geprüfte uint8-Feld mit Grenzen 1 bis 5.');
  if (wildlife.primitiveType !== 'STRUCT' || wildlife.size !== 736 || wildlife.alignment !== 8 || wildlife.fieldCount !== 30) fail('Wildlife entspricht nicht der geprüften Struktur.');
  field(wildlife, 'tamingSetup', 448, TAMING);
  field(wildlife, 'enabledFeatures', 128, 'keen::wildlife::FeatureMask');
  field(wildlife, 'tamingPetInteractionSequence', 704, 'keen::actor::ActorSequenceReference');
  const mask = type('keen::wildlife::FeatureMask'), bits = type('keen::Bitmask16<keen::wildlife::Feature>'), feature = type('keen::wildlife::Feature');
  if (mask.primitiveType !== 'TYPEDEF' || mask.size !== 2 || !Number.isInteger(mask.innerType) || types[mask.innerType] !== bits || bits.primitiveType !== 'BITMASK16' || bits.size !== 2 || !Number.isInteger(bits.innerType) || types[bits.innerType] !== feature || feature.primitiveType !== 'ENUM' || feature.size !== 1 || !exactKeys(feature.enumFields, ['Roaming', 'Flee', 'ShowSpawnSequence', 'Tameable', 'RunAway'])) fail('Unbekannte Tameable-Featuremaske.');
  ['Roaming', 'Flee', 'ShowSpawnSequence', 'Tameable', 'RunAway'].forEach((name, value) => { if (feature.enumFields[name]?.value !== value) fail('Tameable-Featurewerte wurden verändert.'); });
  if (template.primitiveType !== 'STRUCT' || !Number.isInteger(template.qualifiedHash) || template.qualifiedHash < 0 || template.qualifiedHash > 0xffffffff) fail('Ressourcenkennung von TemplateResource fehlt.');
  return { build: reflection.version, templateHash: template.qualifiedHash.toString(16).padStart(8, '0'), features: new Set(Object.keys(feature.enumFields)) };
}
function read(fs, file) {
  try {
    const doc = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    if (!object(doc)) fail('JSON-Objekt fehlt.');
    return doc;
  } catch (error) { fail('JSON nicht lesbar: ' + path.basename(file) + '. ' + error.message); }
}
function identity(doc, file, schema) {
  if (doc.$type !== TEMPLATE || !validGuid(doc.$guid) || !Number.isInteger(doc.$part) || doc.$part < 0 || typeof doc.name !== 'string' || !doc.name || typeof doc.family !== 'string') fail('Ungültige Template-Identität: ' + path.basename(file));
  const expected = doc.$guid.toLowerCase() + '_' + schema.templateHash + '_' + doc.$part + '.json';
  if (path.basename(file).toLowerCase() !== expected) fail('Dateiname, GUID und Typ passen nicht zusammen: ' + path.basename(file));
  return doc.$guid.toLowerCase();
}
function wildlife(doc, file, schema) {
  if (!Array.isArray(doc.components) || doc.components.some(c => !object(c) || typeof c.$type !== 'string' || !object(c.$value))) fail('Ungültige Template-Komponenten: ' + path.basename(file));
  const matches = doc.components.filter(c => c.$type === WILDLIFE);
  if (matches.length > 1 || doc.components.filter(c => c.$type === IS_TAME).length > 1) fail('Doppelte Wildlife-/IsTame-Komponente: ' + path.basename(file));
  if (!matches.length) return null;
  const value = matches[0].$value, setup = value.tamingSetup;
  if (!Array.isArray(value.enabledFeatures) || value.enabledFeatures.some(f => typeof f !== 'string' || !schema.features.has(f)) || new Set(value.enabledFeatures).size !== value.enabledFeatures.length) fail('Unbekannte Wildlife-Features: ' + path.basename(file));
  if (!exactKeys(setup, Object.keys(SETUP_FIELDS)) || typeof setup.isWildlifeBehaviorActiveWhileTamed !== 'boolean' || (setup.favoriteFood !== null && !validGuid(setup.favoriteFood)) || !Number.isInteger(setup.necessaryTamingSteps) || setup.necessaryTamingSteps < 1 || setup.necessaryTamingSteps > 5) fail('Ungültiges TamingSetup oder Schritte außerhalb 1 bis 5: ' + path.basename(file));
  return { value, setup, index: doc.components.indexOf(matches[0]), tameable: value.enabledFeatures.includes('Tameable'), alreadyTame: doc.components.some(c => c.$type === IS_TAME) };
}
function apply(ctx, inputRoot, outputRoot) {
  const summary = { enabled: ctx?.enabled === true, build: null, role: ['client', 'server'].includes(ctx?.role) ? ctx.role : 'unknown', wildlifeTemplates: 0, tameableTemplates: 0, targets: 0, filesChanged: 0, fieldsChanged: 0, alreadySingleStep: 0, excluded: { notTameable: 0, baseOrUnused: 0, alreadyTame: 0, noFavoriteFood: 0 }, samples: [], warnings: [], gameplayVerified: false };
  if (!summary.enabled) return summary;
  const schema = assertSchema(ctx.reflection), fs = ctx.fs || fsDefault;
  summary.build = schema.build;
  const input = path.resolve(inputRoot), output = path.resolve(outputRoot);
  function inside(a, b) { const rel = path.relative(a, b); return !rel || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel)); }
  if (inside(input, output) || inside(output, input)) fail('Ausgangs- und Ausgabeordner müssen getrennt sein und dürfen nicht ineinander liegen.');
  const directory = path.join(inputRoot, 'TemplateResource');
  if (!fs.existsSync(directory)) fail('TemplateResource-Export fehlt.');
  const names = fs.readdirSync(directory).filter(name => name.endsWith('.json')).sort(), resources = new Map();
  if (!names.length) fail('TemplateResource-Export ist leer.');
  for (const name of names) {
    const file = path.join(directory, name), doc = read(fs, file), guid = identity(doc, file, schema);
    if (resources.has(guid)) fail('Doppelte oder mehrteilige Template-GUID: ' + name);
    resources.set(guid, { name, file, doc, wildlife: wildlife(doc, file, schema) });
  }
  const pending = [];
  function isBait(guid) {
    const bait = resources.get(guid.toLowerCase());
    return bait && bait.doc.components.filter(c => c.$type === FOOD_BAIT).length === 1;
  }
  for (const row of resources.values()) {
    const original = row.wildlife;
    if (!original) continue;
    summary.wildlifeTemplates++;
    if (!original.tameable) { summary.excluded.notTameable++; continue; }
    summary.tameableTemplates++;
    if (EXCLUDED_NAME.test(row.doc.name)) { summary.excluded.baseOrUnused++; continue; }
    if (original.alreadyTame) { summary.excluded.alreadyTame++; continue; }
    if (original.setup.favoriteFood === null) { summary.excluded.noFavoriteFood++; continue; }
    if (!isBait(original.setup.favoriteFood)) fail('Köder-Template mit FoodBait fehlt: ' + row.name);
    if (!validGuid(original.value.tamingPetInteractionSequence)) fail('Native Zähmungsinteraktion fehlt: ' + row.name);
    const destination = path.join(outputRoot, 'TemplateResource', row.name);
    const current = fs.existsSync(destination) ? read(fs, destination) : row.doc;
    identity(current, destination, schema);
    if (['$guid', '$part', '$type', 'name', 'family'].some(key => current[key] !== row.doc[key])) fail('Ausgabeidentität wurde verändert: ' + row.name);
    const live = wildlife(current, destination, schema);
    if (!live || !live.tameable || live.alreadyTame || !validGuid(live.setup.favoriteFood) || !isBait(live.setup.favoriteFood)) fail('Ausgabeklassifikation wurde verändert: ' + row.name);
    if (live.value.tamingPetInteractionSequence !== original.value.tamingPetInteractionSequence) fail('Native Zähmungsinteraktion wurde in der Ausgabe verändert: ' + row.name);
    const before = live.setup.necessaryTamingSteps;
    if (before !== original.setup.necessaryTamingSteps && before !== 1) fail('Andere Änderung setzt eine widersprüchliche Zähmungszahl: ' + row.name);
    const pointer = '/components/' + live.index + '/$value/tamingSetup/necessaryTamingSteps';
    summary.targets++;
    summary.samples.push({ file: row.name, guid: row.doc.$guid, name: row.doc.name, pointer, sourceBefore: original.setup.necessaryTamingSteps, before, after: 1, favoriteFood: live.setup.favoriteFood, tamingPetInteractionSequence: live.value.tamingPetInteractionSequence });
    if (before === 1) { summary.alreadySingleStep++; continue; }
    const patched = JSON.parse(JSON.stringify(current));
    patched.components[live.index].$value.tamingSetup.necessaryTamingSteps = 1;
    pending.push({ destination, doc: patched, pointer });
  }
  if (!summary.targets) fail('Keine belegten ungezähmten Tiere mit Tameable und Köder gefunden; diese Daten müssen geprüft werden.');
  summary.warnings.push(WARNING);
  if (ctx.logger && typeof ctx.logger.warn === 'function') ctx.logger.warn(WARNING);
  for (const row of pending) {
    fs.mkdirSync(path.dirname(row.destination), { recursive: true });
    fs.writeFileSync(row.destination, JSON.stringify(row.doc, null, 2), 'utf8');
    summary.filesChanged++; summary.fieldsChanged++;
    if (typeof ctx.track === 'function') ctx.track(row.destination, row.pointer);
  }
  return summary;
}
module.exports = { apply, assertSchema, TEMPLATE, WILDLIFE, IS_TAME, FOOD_BAIT, TAMING, SETUP_FIELDS, WARNING };
