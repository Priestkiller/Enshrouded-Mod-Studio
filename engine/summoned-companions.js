'use strict';
/* Local prototype for dedicated servers or a single-player client test. Own source. Changes existing skeleton-spell
 * companions and the native spell-count attribute; never world-enemy factions,
 * savegames, new resource GUIDs or rendering assets. Live multiplayer untested.
 */
const fsDefault = require('fs');
const path = require('path');
const P = 'keen::ecs::';
const TEMPLATE = P + 'TemplateResource';
const ATTRIBUTES = 'keen::AttributeContainerResource';
const ITEM = 'keen::ItemInfo';
const SEQUENCE = 'keen::actor::ActorSequenceResource';
const RESOURCE_TYPES = { TemplateResource: TEMPLATE, AttributeContainerResource: ATTRIBUTES, ItemInfo: ITEM, ActorSequenceResource: SEQUENCE };
const SPELL_NAME = /^Player_Companion_Lesser_Skeleton_Weakling_Necromancy_Spell_([1-4])$/;
const SPELLS = [
  ['3fce9d9b-fc72-4400-afbe-d966a062b27d', 'Player_Companion_Lesser_Skeleton_Weakling_Necromancy_Spell_1'],
  ['ed3aba0e-fafd-4a93-9e73-337769e4eb2f', 'Player_Companion_Lesser_Skeleton_Weakling_Necromancy_Spell_2'],
  ['cf35302f-2c90-44f7-ad07-1032de0a513b', 'Player_Companion_Lesser_Skeleton_Weakling_Necromancy_Spell_3'],
  ['d6d858ec-8df0-40e1-9aac-250558ff304e', 'Player_Companion_Lesser_Skeleton_Weakling_Necromancy_Spell_4']
];
const VARIANTS = [null, ['10f892be-2374-4d31-ae27-85e0a36f3853', 'Player_Companion_Skeleton_Melee_GemOfNecromancy', 'GemOfNecromancy'], ['ef0c170d-0653-4517-88a7-0c4c9aba8139', 'Player_Companion_Skeleton_Elite_Melee_GemOfGreaterNecromancy', 'GemOfGreaterNecromancy']];
const OWNED_SPELLS = [SPELLS[0], VARIANTS[1], VARIANTS[2]];
const PLAYERS = [['3fcbbfd9-56da-4acf-9592-0a1fc41ecef1', '1_Player_AG2'], ['c3db66d6-89a5-4a6c-a8e3-d9a1f6009812', '1_Player']];
const SPELL_ITEMS = [
  ['c7cd5bb4-4da1-4302-8268-5ee60a461720', 'Ammo_T3_Spell_Skeleton_lvl17', SPELLS[0][0]],
  ['4147dce3-27fd-406f-9937-29b478a94046', 'Ammo_T5_Spell_Skeleton_lvl28_Eternal', SPELLS[1][0]],
  ['73cab824-138c-4b3e-a67e-1e6e3f2b0037', 'Ammo_T6_Spell_Skeleton_lvl44', SPELLS[2][0]],
  ['21e6d418-7981-40a1-90a6-ba1b69f4a4fa', 'Ammo_T7_Spell_Skeleton_lvl45_Eternal', SPELLS[3][0]]
];
const SPAWN_SEQUENCE = '11c073c0-9978-44cc-b0bc-f1628cfc55ed';
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAMAGE_NAMES = ['DamageMod', 'DamageMod_Base', 'DamageMod_Multiplier', 'DamageMod_Adder'];
const DAMAGE_IDS = [3093706425, 2917236167, 2447571903, 2487278625];
const WARNING = 'Prototyp für vorhandene Skelettzauber. Dauer und Anzahl werden in den Spieldaten hinterlegt; Stärke verändert die HP-Levelskalierung und den benannten Schadensmultiplikator. Der native Zauber kopiert außerdem Kampfattribute des Zaubernden. Effektive Kampfwerte und laufende Beschwörungen sind nicht im Spiel bestätigt.';
function roleWarning(role, ownedSpells = false) { if (ownedSpells) return 'Mehrspieler-Testfunktion: Server und alle teilnehmenden Clients müssen dieselben Begleiterzauber und Einstellungen erhalten. ' + WARNING; return role === 'server' ? 'Dedicated-Server-Test. ' + WARNING + ' Das Zusammenspiel mit unveränderten Clients ist ebenfalls nicht im Spiel bestätigt.' : 'Lokaler Einzelspieler-Test im Spielclient. ' + WARNING + ' Diese Clientdaten sind kein Nachweis einer Wirkung auf einem entfernten Dedicated Server.'; }
function fail(message) { throw Error('Beschwörungen: ' + message); }
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function exactKeys(value, keys) { return object(value) && Object.keys(value).sort().join('|') === keys.slice().sort().join('|'); }
function equal(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => equal(v, b[i]));
  if (!object(a) || !object(b)) return false;
  return exactKeys(a, Object.keys(b)) && Object.keys(a).every(k => equal(a[k], b[k]));
}
function validGuid(value) { return typeof value === 'string' && GUID.test(value) && value !== '00000000-0000-0000-0000-000000000000'; }
function integer(value, name, min, max) { if (!Number.isInteger(value) || value < min || value > max) fail(name + ' muss eine ganze Zahl von ' + min + ' bis ' + max + ' sein.'); return value; }
function settings(ctx) {
  return { maxCompanions: integer(ctx.maxCompanions ?? 4, 'Grundlimit', 1, 8), durationSeconds: integer(ctx.durationSeconds ?? 120, 'Dauer in Sekunden', 1, 3600), strengthFactor: integer(ctx.strengthFactor ?? 1, 'Stärkefaktor', 1, 20), companionVariant: integer(ctx.companionVariant ?? 0, 'Begleitertyp', 0, 3) };
}
// One existing item route per spell. Mode3 lets players select the companion
// through their equipped spell; it adds no resources or client-side selector.
function companionRoutes(variant) {
  if (variant === 0) return SPELLS;
  if (variant === 1 || variant === 2) return SPELL_ITEMS.map(() => VARIANTS[variant]);
  if (variant === 3) return [SPELLS[0], VARIANTS[1], SPELLS[2], VARIANTS[2]];
  fail('Unbekannter Begleitertyp.');
}
function targetCompanions(variant) { return [...new Map(companionRoutes(variant).map(descriptor => [descriptor[0], descriptor])).values()]; }
function assertSchema(reflection) {
  if (!reflection || typeof reflection.version !== 'string' || !reflection.version || !Array.isArray(reflection.types)) fail('Frische Reflection mit Spielversion fehlt.');
  const types = reflection.types;
  function type(name) { const found = types.filter(t => t && t.qualifiedName === name); if (found.length !== 1) fail('Reflection-Typ ist nicht eindeutig: ' + name); return found[0]; }
  function field(owner, name, offset, target) { const f = owner.structFields?.[name]; if (!object(f) || f.dataOffset !== offset || !Number.isInteger(f.type) || types[f.type] !== type(target)) fail('Unbekannte Feldstruktur: ' + owner.qualifiedName + '.' + name); }
  function struct(name, size, alignment, fields) {
    const t = type(name);
    if (t.primitiveType !== 'STRUCT' || t.size !== size || t.alignment !== alignment || t.fieldCount !== Object.keys(fields).length || !exactKeys(t.structFields, Object.keys(fields))) fail('Unbekannte Struktur: ' + name);
    for (const [n, [offset, target]] of Object.entries(fields)) field(t, n, offset, target);
    return t;
  }
  function serverOnly(t) { if (t.attributes?.server_only?.name !== 'server_only') fail('Native server_only-Klassifikation fehlt: ' + t.qualifiedName); }
  struct('keen::Time', 8, 8, { value: [0, 'keen::sint64'] });
  if (type('keen::sint64').primitiveType !== 'SINT64' || type('keen::float32').primitiveType !== 'FLOAT32') fail('Unbekannter Zeit-/Skalierungstyp.');
  const life = struct(P + 'LifeTime', 24, 8, { lifeTime: [0, 'keen::Time'], endOfLife: [8, 'keen::Time'], enforceDestroy: [16, 'keen::bool'], preventDestroy: [17, 'keen::bool'], triggeredDestroy: [18, 'keen::bool'] }); serverOnly(life);
  const scaling = struct(P + 'EnemyScaling', 40, 8, { updateInterval: [0, 'keen::Time'], playerCountScaling: [8, P + 'PlayerCountScaling'], enemyLevelScaling: [28, P + 'EnemyLevelScaling'] }); serverOnly(scaling);
  const level = struct(P + 'EnemyLevelScaling', 8, 4, { healthScaleFactor: [0, 'keen::float32'], staminaScaleFactor: [4, 'keen::float32'] });
  if (level.structFields.healthScaleFactor.attributes?.tooltip?.value !== 'Scaling factor for Health used by level scaling.') fail('Bedeutung der HP-Levelskalierung ist nicht mehr bestätigt.');
  const damage = struct(P + 'DamageMod', 24, 4, { dataStorage: [8, 'keen::StaticArray<keen::float32,4>'] }); serverOnly(damage);
  const count = struct(P + 'MaxSkeletonSpellCount', 12, 4, { dataStorage: [8, 'keen::StaticArray<keen::uint32,1>'] }); serverOnly(count);
  const floatArray = type('keen::StaticArray<keen::float32,4>'), countArray = type('keen::StaticArray<keen::uint32,1>');
  if (floatArray.primitiveType !== 'STATIC_ARRAY' || floatArray.fieldCount !== 4 || types[floatArray.innerType] !== type('keen::float32') || countArray.primitiveType !== 'STATIC_ARRAY' || countArray.fieldCount !== 1 || types[countArray.innerType] !== type('keen::uint32')) fail('Attributspeicher passt nicht zur Definition.');
  const behavior = type(P + 'Enemy01BehaviorState');
  if (behavior.primitiveType !== 'STRUCT' || behavior.size !== 2504 || behavior.alignment !== 8) fail('Unbekannte Kampf-KI-Struktur.');
  field(behavior, 'guardSetup', 1416, 'keen::enemy01::GuardSetup');
  field(type('keen::enemy01::GuardSetup'), 'guardParent', 12, 'keen::bool');
  field(type(P + 'Faction'), 'faction', 0, 'keen::FactionType');
  const limited = struct(P + 'LimitedEntitySpawn', 48, 4, { spawnedEntities: [0, 'keen::StaticArray<keen::ecs::EntityId,12>'] }); serverOnly(limited);
  const slots = type('keen::StaticArray<keen::ecs::EntityId,12>');
  if (slots.primitiveType !== 'STATIC_ARRAY' || slots.fieldCount !== 12 || slots.size !== 48) fail('Nativer Beschwörungsspeicher hat nicht die belegten zwölf Plätze.');
  field(type(ITEM), 'equipment', 260, 'keen::EquipmentSetup');
  field(type('keen::EquipmentSetup'), 'placedEntity', 700, P + 'TemplateReference');
  const spawn = type('keen::actor::SpawnEntityBaseEvent');
  field(spawn, 'templateReference', 128, P + 'TemplateReference');
  field(spawn, 'minSpawnCount', 300, 'keen::uint8'); field(spawn, 'maxSpawnCount', 301, 'keen::uint8');
  field(spawn, 'copyCombatAttributes', 318, 'keen::bool'); field(spawn, 'copyFaction', 319, 'keen::bool');
  if (type('keen::FactionType').enumFields?.PlayerAlly?.value !== 11 || type('keen::AttributeOps').enumFields?.Load?.value !== 2 || type('keen::AttributeOps').enumFields?.Multiply?.value !== 8 || type('keen::AttributeOps').enumFields?.Add?.value !== 6) fail('Fraktions- oder Attributoperationen haben sich geändert.');
  const hashes = {};
  for (const [dir, name] of Object.entries(RESOURCE_TYPES)) {
    const t = type(name);
    if (t.primitiveType !== 'STRUCT' || !Number.isInteger(t.qualifiedHash) || t.qualifiedHash < 0 || t.qualifiedHash > 0xffffffff) fail('Ressourcenkennung fehlt: ' + name);
    hashes[dir] = t.qualifiedHash.toString(16).padStart(8, '0');
  }
  return { build: reflection.version, hashes };
}
function read(fs, file) {
  try { const d = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); if (!object(d)) fail('JSON-Objekt fehlt.'); return d; }
  catch (error) { fail('JSON nicht lesbar: ' + path.basename(file) + '. ' + error.message); }
}
function identity(doc, file, directory, schema) {
  if (doc.$type !== RESOURCE_TYPES[directory] || !validGuid(doc.$guid) || !Number.isInteger(doc.$part) || doc.$part < 0 || path.basename(file).toLowerCase() !== doc.$guid.toLowerCase() + '_' + schema.hashes[directory] + '_' + doc.$part + '.json') fail('Dateiname, Typ, GUID oder Part passen nicht zusammen: ' + path.basename(file));
  if (directory === 'TemplateResource' && (typeof doc.name !== 'string' || typeof doc.family !== 'string')) fail('Template-Identität fehlt: ' + path.basename(file));
  return doc.$guid.toLowerCase();
}
function assertAttributes(fs, inputRoot, schema) {
  const directory = path.join(inputRoot, 'AttributeContainerResource');
  if (!fs.existsSync(directory)) fail('Frischer AttributeContainerResource-Export fehlt.');
  const files = fs.readdirSync(directory).filter(f => f.endsWith('.json')).sort();
  let result = null;
  for (const name of files) {
    const file = path.join(directory, name), doc = read(fs, file); identity(doc, file, 'AttributeContainerResource', schema);
    if (!Array.isArray(doc.attributes)) fail('Attributdefinitionen fehlen.');
    const damageRows = doc.attributes.map((value, index) => ({ value, index })).filter(r => r.value?.debugNames?.[0] === 'DamageMod');
    const countRows = doc.attributes.map((value, index) => ({ value, index })).filter(r => r.value?.debugNames?.[0] === 'MaxSkeletonSpellCount');
    if (!damageRows.length && !countRows.length) continue;
    if (result || damageRows.length !== 1 || countRows.length !== 1) fail('Schadens-/Anzahldefinition ist nicht eindeutig.');
    const damage = damageRows[0].value, count = countRows[0].value;
    if (damage.type?.value !== 3902764048 || !equal(damage.debugNames, DAMAGE_NAMES) || !equal(damage.ids?.map(v => v.value), DAMAGE_IDS) || damage.structure?.length !== 4 || !equal(damage.structure[0].calculation, [131073, 131074, 589823, 131075, 458751]) || damage.structure.slice(1).some(v => !Array.isArray(v.calculation) || v.calculation.length)) fail('DamageMod-Speicher ist nicht mehr Base * Multiplier + Adder.');
    if (count.type?.value !== 848563180 || !equal(count.debugNames, ['MaxSkeletonSpellCount']) || !equal(count.ids?.map(v => v.value), [4015464702]) || count.structure?.length !== 1 || !equal(count.structure[0].calculation, [])) fail('MaxSkeletonSpellCount ist nicht das geprüfte direkte uint32-Attribut.');
    result = { file: name, guid: doc.$guid, damagePointer: '/attributes/' + damageRows[0].index, countPointer: '/attributes/' + countRows[0].index, damage: clone(damage), count: clone(count) };
  }
  if (!result) fail('Frische DamageMod-/MaxSkeletonSpellCount-Definition fehlt.');
  return result;
}
function components(doc, file) {
  if (!Array.isArray(doc.components) || doc.components.some(c => !object(c) || typeof c.$type !== 'string' || !object(c.$value))) fail('Ungültige Template-Komponenten: ' + file);
  const map = new Map();
  doc.components.forEach((c, i) => { if (map.has(c.$type)) fail('Doppelte Komponente ' + c.$type + ': ' + file); map.set(c.$type, { index: i, value: c.$value }); });
  return map;
}
function requireComponent(map, name, file) { const c = map.get(P + name); if (!c) fail('Erforderliche Komponente ' + name + ' fehlt: ' + file); return c; }
function attribute(value, length, file) {
  if (!exactKeys(value, ['rootId', 'storageOffset', 'flags', 'storageCount', 'dataStorage']) || !exactKeys(value.rootId, ['value']) || value.rootId.value !== 0 || value.storageOffset !== 0 || value.storageCount !== 0 || !Array.isArray(value.flags) || value.flags.length || !Array.isArray(value.dataStorage) || value.dataStorage.length !== length || value.dataStorage.some(x => typeof x !== 'number' || !Number.isFinite(x))) fail('Unbekannter oder bereits initialisierter Attributspeicher: ' + file);
}
function companion(doc, file, descriptor, allowPatched = false) {
  if (doc.$guid !== descriptor[0] || doc.name !== descriptor[1] || doc.family !== 'None') fail('Keine bestätigte verbündete Beschwörungsvorlage: ' + file);
  const map = components(doc, file);
  if (requireComponent(map, 'Faction', file).value.faction !== 'PlayerAlly' || requireComponent(map, 'Enemy01BehaviorState', file).value.guardSetup?.guardParent !== true || !map.has(P + 'DoNotSave') || !map.has(P + 'NetworkEnemy')) fail('Verbündeten-/Folge-KI-Klassifikation stimmt nicht: ' + file);
  if (map.has(P + 'IsPlayer') || map.has(P + 'NetworkPlayer')) fail('Spielervorlage darf kein Beschwörungsziel sein.');
  const life = map.get(P + 'LifeTime'), scaling = requireComponent(map, 'EnemyScaling', file), damage = requireComponent(map, 'DamageMod', file), pool = requireComponent(map, 'SpawnLimit', file);
  if ((!life && !descriptor[2]) || (life && (!exactKeys(life.value, ['lifeTime', 'endOfLife', 'enforceDestroy', 'preventDestroy', 'triggeredDestroy']) || !exactKeys(life.value.lifeTime, ['value']) || !Number.isSafeInteger(life.value.lifeTime.value) || life.value.lifeTime.value < 1 || life.value.endOfLife?.value !== 0 || life.value.enforceDestroy !== false || life.value.preventDestroy !== false || life.value.triggeredDestroy !== false)) || ![descriptor[2] || 'Skeleton', ...(allowPatched ? ['Skeleton'] : [])].includes(pool.value.spawnLimitPool)) fail('Unbekannte Lebensdauer oder falscher Beschwörungspool: ' + file);
  const health = scaling.value.enemyLevelScaling?.healthScaleFactor;
  if (typeof health !== 'number' || !Number.isFinite(health) || health <= 0 || Math.fround(health) !== health) fail('HP-Levelskalierung ist kein positiver float32-Wert: ' + file);
  attribute(damage.value, 4, file);
  if (damage.value.dataStorage[2] <= 0 || Math.fround(damage.value.dataStorage[2]) !== damage.value.dataStorage[2]) fail('Schadensmultiplikator ist kein positiver float32-Wert: ' + file);
  return { life, scaling, damage, pool, map };
}
function inside(a, b) { const rel = path.relative(a, b); return !rel || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel)); }
function getPointer(doc, pointer) { return pointer.split('/').slice(1).reduce((v, k) => v?.[k.replace(/~1/g, '/').replace(/~0/g, '~')], doc); }
function setPointer(doc, pointer, value) { const pieces = pointer.split('/').slice(1).map(k => k.replace(/~1/g, '/').replace(/~0/g, '~')); let target = doc; for (const piece of pieces.slice(0, -1)) target = target[piece]; target[pieces[pieces.length - 1]] = value; }
function loadResource(fs, root, directory, guid, schema) {
  const folder = path.join(root, directory);
  if (!fs.existsSync(folder)) fail('Frischer Export fehlt: ' + directory);
  const names = fs.readdirSync(folder).filter(n => n.toLowerCase().startsWith(guid.toLowerCase() + '_') && n.endsWith('.json'));
  if (names.length !== 1) fail('Ressourcen-GUID fehlt oder ist mehrdeutig: ' + guid);
  const file = names[0], doc = read(fs, path.join(folder, file));
  identity(doc, file, directory, schema);
  return { file, doc, directory };
}
function player(doc, file, descriptor) {
  if (doc.$guid !== descriptor[0] || doc.name !== descriptor[1] || doc.family !== 'None') fail('Keine bestätigte aktive Spielervorlage: ' + file);
  const map = components(doc, file);
  if (requireComponent(map, 'Faction', file).value.faction !== 'Player') fail('Spielerfraktion wurde verändert: ' + file);
  const limit = requireComponent(map, 'MaxSkeletonSpellCount', file), slots = requireComponent(map, 'LimitedEntitySpawn', file);
  attribute(limit.value, 1, file);
  if (!Number.isInteger(limit.value.dataStorage[0]) || limit.value.dataStorage[0] < 1 || limit.value.dataStorage[0] > 12 || !Array.isArray(slots.value.spawnedEntities) || slots.value.spawnedEntities.length !== 12 || slots.value.spawnedEntities.some(v => !exactKeys(v, ['id']) || v.id !== 0)) fail('Unbekanntes Grundlimit oder initialisierter Beschwörungspool: ' + file);
  return limit;
}
function spellItem(doc, file, descriptor, expectedGuid) {
  if (doc.$guid !== descriptor[0] || doc.debugName !== descriptor[1] || doc.objectId !== doc.$guid || !Number.isInteger(doc.itemId?.value) || doc.itemId.value < 1 || doc.category !== 'Ammunition' || doc.equipment?.slot !== 'Spell' || doc.equipment.placedEntity !== expectedGuid || !Array.isArray(doc.sequences) || doc.sequences.filter(v => v.sequence === SPAWN_SEQUENCE && v.triggeredBy === 'Primary').length !== 1) fail('Keine bestätigte aktive Skelettzauber-Verknüpfung: ' + file);
}
function assertSpawn(fs, root, schema) {
  const row = loadResource(fs, root, 'ActorSequenceResource', SPAWN_SEQUENCE, schema), event = row.doc.subSequences?.[0]?.events?.[15];
  const value = event?.$value;
  if (event?.$type !== 'keen::actor::SpawnEntityEvent' || !value || value.templateReference !== null || value.minSpawnCount !== 1 || value.maxSpawnCount !== 1 || value.copyCombatAttributes !== true || value.copyFaction !== false || value.isProjectile !== false || value.applyRandomLoot !== false || value.despawnAfterSequence !== false || value.destroySpawnerWhenEntityIsDead !== false) fail('Nativer Item-Spawnpfad für die Skelettzauber hat sich verändert.');
  return { file: row.file, guid: row.doc.$guid, pointer: '/subSequences/0/events/15', copyCombatAttributes: true, copyFaction: false, minSpawnCount: 1, maxSpawnCount: 1, templateReference: null };
}
function lifeValue(seconds) { return { lifeTime: { value: seconds * 1000000000 }, endOfLife: { value: 0 }, enforceDestroy: false, preventDestroy: false, triggeredDestroy: false }; }
function apply(ctx, inputRoot, outputRoot) {
  const summary = { enabled: ctx?.enabled === true, role: ctx?.role || 'unknown', ownedSpells: ctx?.ownedSpells === true, build: null, targets: 0, playerTargets: 0, spellItems: 0, filesChanged: 0, fieldsChanged: 0, resources: [], warnings: [], gameplayVerified: false, prototype: true };
  if (!summary.enabled) return summary;
  if (!['server', 'client'].includes(ctx.role)) fail('Für diese Prototypfunktion muss ein Spielclient für den lokalen Einzelspieler-Test oder ein Dedicated Server eindeutig erkannt sein.');
  Object.assign(summary, settings(ctx));
  if (summary.ownedSpells && summary.companionVariant !== 0) fail('Eigene Begleiterzauber benötigen ihre festen Vorlagen.');
  const schema = assertSchema(ctx.reflection), fs = ctx.fs || fsDefault; summary.build = schema.build;
  const input = path.resolve(inputRoot), output = path.resolve(outputRoot);
  if (inside(input, output) || inside(output, input)) fail('Original- und Ausgabeordner müssen getrennt sein und dürfen nicht ineinander liegen.');
  summary.attributeEvidence = assertAttributes(fs, inputRoot, schema);
  summary.spawnEvidence = assertSpawn(fs, inputRoot, schema);
  const currentSpawnRoot = { existsSync: f => fs.existsSync(f), readdirSync: f => fs.readdirSync(f), readFileSync: (f, enc) => {
    const destination = path.join(outputRoot, 'ActorSequenceResource', path.basename(f));
    return fs.readFileSync(fs.existsSync(destination) ? destination : f, enc);
  } };
  assertSpawn(currentSpawnRoot, inputRoot, schema);
  const pending = [];
  function current(row) {
    const destination = path.join(outputRoot, row.directory, row.file), doc = fs.existsSync(destination) ? read(fs, destination) : row.doc;
    identity(doc, row.file, row.directory, schema);
    if (['$guid', '$part', '$type'].some(k => doc[k] !== row.doc[k]) || (row.directory === 'TemplateResource' && ['name', 'family'].some(k => doc[k] !== row.doc[k]))) fail('Ausgabeidentität wurde verändert: ' + row.file);
    return { destination, doc };
  }
  function plan(row, live, kind, edits, source) {
    const patched = clone(live.doc), changed = [];
    for (const edit of edits) {
      const value = getPointer(live.doc, edit.pointer), matchesBefore = edit.beforeMissing ? value === undefined : equal(value, edit.before);
      if (!matchesBefore && !equal(value, edit.after)) fail('Widersprüchliche Änderung eines Beschwörungsfelds: ' + row.file + ' ' + edit.pointer);
      if (!equal(value, edit.after)) { setPointer(patched, edit.pointer, clone(edit.after)); changed.push(edit.pointer); }
    }
    summary.resources.push({ directory: row.directory, file: row.file, guid: row.doc.$guid, name: row.directory === 'ItemInfo' ? row.doc.debugName : row.doc.name, ...(row.directory === 'TemplateResource' ? { family: row.doc.family } : {}), kind, source, edits });
    if (changed.length) pending.push({ destination: live.destination, doc: patched, changed });
  }
  // Always validate all four original spell targets and item routes. A selected
  // shared friendly variant is changed only when explicitly selected.
  const originals = SPELLS.map(descriptor => {
    const row = loadResource(fs, inputRoot, 'TemplateResource', descriptor[0], schema);
    companion(row.doc, row.file, descriptor); return { row, descriptor };
  });
  const originalByGuid = new Map(originals.map(entry => [entry.descriptor[0], entry]));
  const selected = (summary.ownedSpells ? OWNED_SPELLS : targetCompanions(summary.companionVariant)).map(descriptor => originalByGuid.get(descriptor[0]) || { row: loadResource(fs, inputRoot, 'TemplateResource', descriptor[0], schema), descriptor });
  for (const { row, descriptor } of selected) {
    const base = companion(row.doc, row.file, descriptor), live = current(row), existing = companion(live.doc, row.file, descriptor, true);
    const hp = base.scaling.value.enemyLevelScaling.healthScaleFactor, damage = base.damage.value.dataStorage[2];
    const afterHp = Math.fround(hp * summary.strengthFactor), afterDamage = Math.fround(damage * summary.strengthFactor);
    if (!Number.isFinite(afterHp) || !Number.isFinite(afterDamage) || afterHp <= 0 || afterDamage <= 0) fail('Stärkefaktor überschreitet den float32-Bereich.');
    const edits = [
      { pointer: '/components/' + existing.scaling.index + '/$value/enemyLevelScaling/healthScaleFactor', before: hp, after: afterHp, meaning: 'healthLevelScale' },
      { pointer: '/components/' + existing.damage.index + '/$value/dataStorage/2', before: damage, after: afterDamage, meaning: 'damageMultiplier' },
      { pointer: '/components/' + existing.pool.index + '/$value/spawnLimitPool', before: base.pool.value.spawnLimitPool, after: 'Skeleton', meaning: 'spawnPool' }
    ];
    if (base.life) {
      if (!existing.life) fail('Vorhandene Lebensdauer fehlt in der Ausgabe: ' + row.file);
      edits.push({ pointer: '/components/' + existing.life.index + '/$value/lifeTime/value', before: base.life.value.lifeTime.value, after: summary.durationSeconds * 1000000000, meaning: 'lifeTime' });
    } else {
      const index = existing.life ? existing.life.index : live.doc.components.length;
      edits.push({ pointer: '/components/' + index, before: null, beforeMissing: true, after: { $type: P + 'LifeTime', $value: lifeValue(summary.durationSeconds) }, meaning: 'addLifeTime' });
    }
    plan(row, live, 'companion', edits, { descriptor, healthScale: hp, damageMultiplier: damage, lifeTime: base.life ? base.life.value.lifeTime.value : null, nativePool: base.pool.value.spawnLimitPool });
    summary.targets++;
  }
  for (const descriptor of PLAYERS) {
    const row = loadResource(fs, inputRoot, 'TemplateResource', descriptor[0], schema), base = player(row.doc, row.file, descriptor), live = current(row), existing = player(live.doc, row.file, descriptor);
    plan(row, live, 'player', [{ pointer: '/components/' + existing.index + '/$value/dataStorage/0', before: base.value.dataStorage[0], after: summary.maxCompanions, meaning: 'maxCompanions' }], { descriptor });
    summary.playerTargets++;
  }
  const routes = companionRoutes(summary.companionVariant);
  for (const [index, descriptor] of (summary.ownedSpells ? [] : SPELL_ITEMS).entries()) {
    const row = loadResource(fs, inputRoot, 'ItemInfo', descriptor[0], schema), live = current(row), targetGuid = routes[index][0];
    spellItem(row.doc, row.file, descriptor, descriptor[2]);
    if (![descriptor[2], targetGuid].includes(live.doc.equipment?.placedEntity)) fail('Andere Änderung setzt einen widersprüchlichen Begleitertyp: ' + row.file);
    spellItem(live.doc, row.file, descriptor, live.doc.equipment.placedEntity);
    plan(row, live, 'item', [{ pointer: '/equipment/placedEntity', before: descriptor[2], after: targetGuid, meaning: 'placedEntity' }], { descriptor });
    summary.spellItems++;
  }
  summary.warnings.push(roleWarning(summary.role, summary.ownedSpells), 'Maximale Anzahl ist das Grundlimit des Skeleton-Pools. Talente und der gemeinsame native Speicher mit zwölf Einträgen können die tatsächlich gleichzeitig vorhandenen Begleiter begrenzen. Ein Zauber beschwört weiterhin genau einen Begleiter.');
  if (summary.companionVariant !== 0 || summary.ownedSpells) summary.warnings.push('Der ausgewählte Skeletttyp verwendet eine bereits vorhandene verbündete Gem-Vorlage. Auch durch denselben Nekromantie-Edelstein erzeugte Begleiter erhalten deshalb Dauer, Stärke und Skeleton-Pool. Andere Gegnervorlagen und Weltfraktionen bleiben unverändert.');
  if (summary.ownedSpells) summary.warnings.push('Die drei Grundskelettzauber verwenden vorhandene verbündete Vorlagen. Die vier ursprünglichen Zaubergegenstände werden nicht umgeleitet. Alle Begleitertypen teilen den Skeleton-Pool und dessen Grundlimit. Gemischte Gruppen und das Bestehenbleiben vorhandener Begleiter beim Zauberwechsel sind noch nicht im Spiel geprüft.');
  if (summary.companionVariant === 3) summary.warnings.push('Auswahl durch vorhandene Zauber: T3 und T6 behalten ihre ursprünglichen Begleiter; der ewige T5-Zauber beschwört den Skelettkrieger, der ewige T7-Zauber das Eliteskelett. Beide verwendeten Gem-Vorlagen erhalten dieselben Einstellungen. Alle Typen teilen den gemeinsamen Skeleton-Pool und dessen Grundlimit. Eine gemischte Gruppe und das Bestehenbleiben vorhandener Begleiter beim Wechsel des Zaubers sind noch nicht im Spiel geprüft.');
  if (ctx.logger && typeof ctx.logger.warn === 'function') for (const warning of summary.warnings) ctx.logger.warn(warning);
  for (const row of pending) {
    fs.mkdirSync(path.dirname(row.destination), { recursive: true });
    fs.writeFileSync(row.destination, JSON.stringify(row.doc, null, 2), 'utf8');
    summary.filesChanged++; summary.fieldsChanged += row.changed.length;
    if (typeof ctx.track === 'function') for (const pointer of row.changed) ctx.track(row.destination, pointer);
  }
  return summary;
}
function verify(summary, reflection, verifyRoot, fs = fsDefault) {
  if (summary?.enabled !== true) return { enabled: false, checked: 0, gameplayVerified: false };
  if (!['server', 'client'].includes(summary.role)) fail('Für die Verifikation muss ein Spielclient für den lokalen Einzelspieler-Test oder ein Dedicated Server eindeutig erkannt sein.');
  const schema = assertSchema(reflection), config = settings(summary), owned = summary.ownedSpells === true, allowedCompanions = owned ? OWNED_SPELLS : targetCompanions(config.companionVariant), routes = companionRoutes(config.companionVariant), count = allowedCompanions.length, itemCount = owned ? 0 : 4;
  if (owned && config.companionVariant !== 0) fail('Eigene Begleiterzauber benötigen ihre festen Vorlagen.');
  if (summary.gameplayVerified !== false || summary.prototype !== true || summary.build !== schema.build || summary.targets !== count || summary.playerTargets !== 2 || summary.spellItems !== itemCount || !Array.isArray(summary.resources) || summary.resources.length !== count + 2 + itemCount) fail('Prüfliste oder Spielversion des Beschwörungsprototyps stimmt nicht.');
  if (!equal(assertAttributes(fs, verifyRoot, schema), summary.attributeEvidence) || !equal(assertSpawn(fs, verifyRoot, schema), summary.spawnEvidence)) fail('Attributdefinition oder nativer Spawnpfad wurde beim Packen verändert.');
  const seen = new Set(), counts = { companion: 0, player: 0, item: 0 }; let fieldsChecked = 0;
  for (const row of summary.resources) {
    if (!object(row) || typeof row.file !== 'string' || path.basename(row.file) !== row.file || !validGuid(row.guid) || !['TemplateResource', 'ItemInfo'].includes(row.directory) || seen.has(row.guid)) fail('Ungültige Ressourcenidentität in der Prüfliste.');
    seen.add(row.guid);
    const file = path.join(verifyRoot, row.directory, row.file), doc = read(fs, file); identity(doc, file, row.directory, schema);
    if (doc.$guid !== row.guid || (row.directory === 'ItemInfo' ? doc.debugName : doc.name) !== row.name || (row.directory === 'TemplateResource' && doc.family !== row.family) || !Array.isArray(row.edits) || !row.edits.length) fail('Prüfidentität stimmt nicht: ' + row.file);
    const desired = new Map();
    if (row.kind === 'companion') {
      const descriptor = allowedCompanions.find(v => v[0] === doc.$guid);
      if (!descriptor || !equal(row.source?.descriptor, descriptor)) fail('Unbekannte Begleitervorlage in der Prüfliste.');
      const selected = companion(doc, row.file, descriptor, true);
      if (!selected.life) fail('Lebensdauer fehlt nach dem Packen.');
      desired.set('healthLevelScale', { pointer: '/components/' + selected.scaling.index + '/$value/enemyLevelScaling/healthScaleFactor', value: Math.fround(row.source.healthScale * config.strengthFactor) });
      desired.set('damageMultiplier', { pointer: '/components/' + selected.damage.index + '/$value/dataStorage/2', value: Math.fround(row.source.damageMultiplier * config.strengthFactor) });
      desired.set('spawnPool', { pointer: '/components/' + selected.pool.index + '/$value/spawnLimitPool', value: 'Skeleton' });
      if (row.source.lifeTime === null) desired.set('addLifeTime', { pointer: '/components/' + selected.life.index, value: { $type: P + 'LifeTime', $value: lifeValue(config.durationSeconds) } });
      else desired.set('lifeTime', { pointer: '/components/' + selected.life.index + '/$value/lifeTime/value', value: config.durationSeconds * 1000000000 });
    } else if (row.kind === 'player') {
      const descriptor = PLAYERS.find(v => v[0] === doc.$guid);
      if (!descriptor || !equal(row.source?.descriptor, descriptor)) fail('Unbekannte Spielervorlage in der Prüfliste.');
      const selected = player(doc, row.file, descriptor);
      desired.set('maxCompanions', { pointer: '/components/' + selected.index + '/$value/dataStorage/0', value: config.maxCompanions });
    } else if (row.kind === 'item') {
      const descriptor = SPELL_ITEMS.find(v => v[0] === doc.$guid);
      if (!descriptor || !equal(row.source?.descriptor, descriptor)) fail('Unbekannter Zaubergegenstand in der Prüfliste.');
      const target = routes[SPELL_ITEMS.indexOf(descriptor)][0];
      spellItem(doc, row.file, descriptor, target);
      desired.set('placedEntity', { pointer: '/equipment/placedEntity', value: target });
    } else fail('Unbekannte Zielklasse in der Prüfliste.');
    if (row.edits.length !== desired.size) fail('Sollwertfelder fehlen oder sind doppelt: ' + row.file);
    for (const edit of row.edits) {
      const expected = desired.get(edit.meaning);
      if (!expected || edit.pointer !== expected.pointer || !equal(edit.after, expected.value) || !equal(getPointer(doc, edit.pointer), expected.value)) fail('Beschwörungsfeld stimmt nach dem Packen nicht: ' + row.file + ' ' + edit.pointer);
      desired.delete(edit.meaning); fieldsChecked++;
    }
    counts[row.kind]++;
  }
  if (counts.companion !== count || counts.player !== 2 || counts.item !== itemCount) fail('Anzahl der Zielklassen ist inkonsistent.');
  return { enabled: true, role: summary.role, checked: seen.size, fieldsChecked, targets: count, playerTargets: 2, spellItems: itemCount, gameplayVerified: false, prototype: true };
}
function applyOwnedSpells(ctx, input, output) { return apply({ ...ctx, ownedSpells: true, companionVariant: 0 }, input, output); }
module.exports = { apply, applyOwnedSpells, verify, assertSchema, assertAttributes, companionRoutes, targetCompanions, OWNED_SPELLS, WARNING, SPELL_NAME, TEMPLATE, ATTRIBUTES, ITEM, SEQUENCE, SPELLS, PLAYERS, SPELL_ITEMS, VARIANTS, SPAWN_SEQUENCE };
