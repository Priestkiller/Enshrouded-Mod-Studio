'use strict';
// Shared server/client prototype. Creates three companion templates and one
// internal arsenal; never changes native world-enemy templates or saved state.
const fsDefault = require('fs'), path = require('path'), crypto = require('crypto');
const definitions = require('./skeleton-spell-definitions.json');
const nativeCompanions = require('./summoned-companions');
const P = 'keen::ecs::';
const TYPES = { TemplateResource: P + 'TemplateResource', ActorSequenceResource: 'keen::actor::ActorSequenceResource', EnemyArsenalRegistryResource: 'keen::enemy::EnemyArsenalRegistryResource' };
const HASHES = { TemplateResource: '39768775', ActorSequenceResource: '9fd4a561', EnemyArsenalRegistryResource: 'f67d6fc3' };
const SOURCES = [
  { key: 'mage', guid: 'e092e507-3bc0-4538-8fdc-a73f96de95e6', name: 'Enemy_Skeleton_Mage01_Dungeon', target: 'a0599ff0-5c70-48e6-8d91-64c367870b26', faction: 'Skeleton', sha256: '259c41585a402fc4b51653f9dd8de40264c1e7d78c2a29233baca3038edd0961' },
  { key: 'hound', guid: 'cd8d28ed-0d6d-46ac-991e-a0480bf2d352', name: 'Enemy_Skeleton_Hound_Dungeon', target: 'bff03c68-c726-4f84-a515-94598f3c421d', faction: 'Skeleton', sha256: '067896355ee671a36f91245198132bf66800efc24b12c2d9f63bc328cc8b1023' },
  { key: 'sabertooth', guid: '50b96064-3ffc-47a2-8c7d-1d592a3c459c', name: 'Enemy_Wildbeast_Sabertooth', target: 'c9fcc4f8-de5c-4484-ac28-883b7f297b9b', faction: 'WildBeast', sha256: '74899701c68b0ff63c3f988cc3068db2b628b4d227587c1d5605eacc9a436276' }
];
const WEAKLING = { guid: '3fce9d9b-fc72-4400-afbe-d966a062b27d', sha256: '8965ee80d2e3fbba727bd22d88e20a506a01d4da5b8caaea5cc06b96de16d798' };
const ELITE = { guid: 'ef0c170d-0653-4517-88a7-0c4c9aba8139', sha256: '3b452a0d6cda2dd55c7ba83c90ce2892f6f458fe684c91e5b0829e9d61eedf34' };
const SPAWN = '11c073c0-9978-44cc-b0bc-f1628cfc55ed', FROST = '11393442-065e-424a-b076-d8038b68d8c7';
const PROJECTILE = '6761f22c-91c5-4b10-bb74-4559324ef870', EXPLOSION = 'f09f1a86-5908-48ad-9031-bd193da56414';
const PRESERVED = [
  ...SOURCES.map(s => ({ directory: 'TemplateResource', guid: s.guid, sha256: s.sha256 })),
  { directory: 'ActorSequenceResource', guid: SPAWN, sha256: '721debeca4b5f144c6dd9522cf0093737f3787a507882147e1cd70fc04735b3b' },
  { directory: 'ActorSequenceResource', guid: FROST, sha256: 'c2c8dc5ba110dbafec4b4ab7a81822d3ec4300477f28229954026c1530e9599c' },
  { directory: 'TemplateResource', guid: PROJECTILE, sha256: '2de4d7975759755cf9c2df1efdb18cdbb0fa652fcbfb8ef75552203bc67547a9' },
  { directory: 'TemplateResource', guid: EXPLOSION, sha256: '27ad849be5baf8b827fc4dce41e37cf65266a4e5f04610a1bb618276275b6f03' }
];
const REGISTRY = 'cd861d95-a79c-4c11-8b48-8fae34a4156c', REGISTRY_SHA = '752cc6df0401b7e17d38970a367e5f087849d9efe4405e7b620dc053c28f8943';
const MAGE_ARSENAL = 'ad77d7d0-0ce3-439c-b238-fc619418e15a', OWN_ARSENAL = 'ed729181-ac33-41bf-9ac4-44ce8627a3d4', OWN_ATTACK = 'd5ccbbf0-6eb6-43f9-98a0-c667b4170f8f';
const GUARD = { startDistance: 10, targetDistance: 3, maxArriveDistance: 2, guardParent: true, guardGroupLeader: false, canGuardPlayer: false, useMovementTarget: false, useTargetOffsetsWhileTargetIsMoving: true, predictTargetPosition: false, disableRunning: false };
const WARNING = 'Mehrspieler-Testfunktion: Server und alle teilnehmenden Clients müssen dieselben Begleiterzauber und Einstellungen erhalten. Magier, Knochenhund und Säbelzahntiger verwenden eigene Vorlagen mit nativer Eltern-Folge-KI und gemeinsamem Skeleton-Limit. Der Magier behält nur seinen Frostangriff; weitere Beschwörungen und Wiederbelebung sind entfernt. Folgen, Zielwahl, Frostschaden gegen Gegner, Lebensdauer und gemischte Gruppen sind noch nicht im Spiel bestätigt. Die nachgeschalteten nativen Frost-Impactprogramme wurden nicht semantisch geprüft.';
const fail = s => { throw Error('Zusätzliche Begleiter: ' + s); };
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const clone = v => JSON.parse(JSON.stringify(v));
function canonical(v) { if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']'; if (object(v)) return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}'; return JSON.stringify(v); }
const digest = v => crypto.createHash('sha256').update(canonical(v)).digest('hex');
const equal = (a, b) => canonical(a) === canonical(b);
const guid = v => typeof v === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v) && v !== '00000000-0000-0000-0000-000000000000';
function config(ctx) { const c = { durationSeconds: ctx.durationSeconds ?? 120, strengthFactor: ctx.strengthFactor ?? 1 }; for (const [key, max] of [['durationSeconds', 3600], ['strengthFactor', 20]]) if (!Number.isInteger(c[key]) || c[key] < 1 || c[key] > max) fail('Ungültige Einstellung: ' + key); return c; }
function assertDefinitions() {
  if (definitions.sourceBuild !== '1273043' || definitions.formatVersion !== 1 || !Array.isArray(definitions.items) || definitions.items.length !== 6) fail('Sechs eigene Zauber für Build1273043 erforderlich.');
  for (const [i, s] of SOURCES.entries()) { const d = definitions.items[i + 3]; if (d.key !== s.key || d.target !== s.target || d.sourceTemplateGuid !== s.guid || d.sourceTemplateName !== s.name || !guid(d.target) || typeof d.targetName !== 'string' || !d.targetName.startsWith('EMS_Companion_')) fail('Unbekannte isolierte Begleiterdefinition: ' + s.key); }
  return definitions.items.slice(3);
}
const CREATED_RESOURCES = definitions.items.slice(3).map(d => ({ guid: d.target, type: TYPES.TemplateResource, part: 0, directory: 'TemplateResource', file: d.target + '_' + HASHES.TemplateResource + '_0.json' }));
function assertSchema(reflection) {
  if (!reflection?.version?.startsWith('1273043|')) fail('Frische Reflection für Build1273043 erforderlich.');
  const schema = nativeCompanions.assertSchema(reflection), byName = new Map(reflection.types.map(t => [t.qualifiedName, t]));
  function field(name, key, offset, target) { const t = byName.get(name), f = t?.structFields?.[key]; if (!f || f.dataOffset !== offset || reflection.types[f.type] !== byName.get(target)) fail('Unbekanntes Schema: ' + name + '.' + key); }
  for (const [directory, type] of Object.entries(TYPES)) { const t = byName.get(type); if (t?.primitiveType !== 'STRUCT' || t.qualifiedHash?.toString(16).padStart(8, '0') !== HASHES[directory]) fail('Ressourcentyp geändert: ' + type); }
  field(TYPES.EnemyArsenalRegistryResource, 'arsenals', 0, 'keen::BlobArray<keen::enemy::EnemyArsenalResource>');
  field('keen::enemy::EnemyArsenalResource', 'guid', 0, 'keen::Guid'); field('keen::enemy::EnemyArsenalResource', 'attacks', 16, 'keen::BlobArray<keen::enemy01::AttackDesscriptionResource>'); field('keen::enemy::EnemyArsenalResource', 'behaviors', 24, 'keen::BlobArray<keen::enemy01::BehaviorDesscriptionResource>');
  field('keen::enemy01::AttackDesscriptionResource', 'description', 16, 'keen::enemy01::AttackDesscription'); field('keen::enemy01::Ability', 'actionSequence', 0, 'keen::actor::ActorSequenceReference');
  field(P + 'EnemyArsenalReference', 'arsenal', 0, 'keen::ObjectReference<keen::ecs::EnemyArsenal>');
  field(P + 'RandomLoot', 'disableRandomLoot', 0, 'keen::bool');
  return { ...schema, hashes: { ...schema.hashes, EnemyArsenalRegistryResource: HASHES.EnemyArsenalRegistryResource } };
}
function read(fs, file) { let d; try { d = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch (e) { fail('JSON nicht lesbar: ' + path.basename(file) + ': ' + e.message); } if (!object(d)) fail('JSON-Objekt fehlt.'); return d; }
function identity(doc, file, directory) { if (!Object.hasOwn(TYPES, directory) || doc.$type !== TYPES[directory] || !guid(doc.$guid) || doc.$part !== 0 || path.basename(file) !== doc.$guid + '_' + HASHES[directory] + '_0.json') fail('Datei-/Ressourcenidentität ist ungültig: ' + path.basename(file)); if (directory === 'TemplateResource' && (typeof doc.name !== 'string' || doc.family !== 'None')) fail('Vorlagenidentität ist ungültig.'); }
function load(fs, root, directory, id) { const folder = path.join(root, directory); if (!fs.existsSync(folder)) fail('Export fehlt: ' + directory); const files = fs.readdirSync(folder).filter(f => f.startsWith(id + '_') && f.endsWith('.json')); if (files.length !== 1) fail('Ressource fehlt oder ist doppelt: ' + id); const file = files[0], doc = read(fs, path.join(folder, file)); identity(doc, file, directory); return { directory, file, doc }; }
function components(doc) { if (!Array.isArray(doc.components)) fail('Komponenten fehlen.'); const map = new Map(); for (const [i, c] of doc.components.entries()) { if (typeof c?.$type !== 'string' || !object(c.$value) || map.has(c.$type)) fail('Ungültige/doppelte Komponente.'); map.set(c.$type, { i, value: c.$value }); } return map; }
function component(map, name) { const c = map.get(P + name); if (!c) fail('Komponente fehlt: ' + name); return c.value; }
function nativeSource(row, source) { if (row.doc.$guid !== source.guid || row.doc.name !== source.name || digest(row.doc) !== source.sha256) fail('Native Quellvorlage wurde verändert: ' + source.name); const m = components(row.doc); if (component(m, 'Faction').faction !== source.faction || component(m, 'Enemy01BehaviorState').guardSetup.guardParent !== false || !m.has(P + 'DoNotSave') || !m.has(P + 'NetworkEnemy') || m.has(P + 'IsPlayer') || m.has(P + 'NetworkPlayer') || m.has(P + 'OwnerRelationship') || m.has(P + 'LifeTime') || m.has(P + 'SpawnLimit')) fail('Quellvorlage ist keine bestätigte uninitialisierte Gegnervorlage.'); for (const name of ['EnemyScaling', 'DamageMod', 'RandomLoot', 'RandomLootSlotCount', 'ExperienceSource']) component(m, name); return m; }
function life(seconds) { return { lifeTime: { value: seconds * 1000000000 }, endOfLife: { value: 0 }, enforceDestroy: false, preventDestroy: false, triggeredDestroy: false }; }
function ownTemplate(source, d, settings) {
  nativeSource(source, SOURCES.find(s => s.guid === source.doc.$guid));
  const result = clone(source.doc); result.$guid = d.target; result.name = d.targetName;
  const m = components(result), behavior = component(m, 'Enemy01BehaviorState');
  component(m, 'Faction').faction = 'PlayerAlly'; behavior.guardSetup = clone(GUARD); behavior.deathSetup = { destroyAfterDeathSequenceDuration: true, reviveSequence: null }; behavior.behaviorSetup.executeBehaviorsDuringDeath = false;
  component(m, 'RandomLoot').disableRandomLoot = true; const slots = component(m, 'RandomLootSlotCount'); slots.slotsMin = 0; slots.slotsMax = 0;
  const scale = component(m, 'EnemyScaling').enemyLevelScaling, damage = component(m, 'DamageMod');
  if (!Array.isArray(damage.dataStorage) || damage.dataStorage.length !== 4 || damage.rootId?.value !== 0 || damage.storageOffset !== 0 || damage.storageCount !== 0 || !equal(damage.flags, [])) fail('Unbekannter Schadensspeicher.');
  scale.healthScaleFactor = Math.fround(scale.healthScaleFactor * settings.strengthFactor); damage.dataStorage[2] = Math.fround(damage.dataStorage[2] * settings.strengthFactor);
  if (![scale.healthScaleFactor, damage.dataStorage[2]].every(v => Number.isFinite(v) && v > 0)) fail('Stärkefaktor ist außerhalb des float32-Bereichs.');
  if (d.key === 'mage') component(m, 'EnemyArsenalReference').arsenal = OWN_ARSENAL;
  result.components = result.components.filter(c => c.$type !== P + 'ExperienceSource');
  result.components.push({ $type: P + 'LifeTime', $value: life(settings.durationSeconds) }, { $type: P + 'SpawnLimit', $value: { spawnLimitPool: 'Skeleton' } });
  return result;
}
function ownArsenal(registry) {
  if (!Array.isArray(registry.arsenals) || digest(registry) !== REGISTRY_SHA) fail('Native Arsenalliste wurde verändert.');
  const entries = registry.arsenals.filter(a => a.guid === MAGE_ARSENAL); if (entries.length !== 1) fail('Magierarsenal fehlt oder ist doppelt.'); const source = entries[0];
  if (source.attacks?.length !== 2 || source.behaviors?.length !== 1 || source.attacks[0].guid !== 'dfded71c-06f5-40b4-97b7-a8d262f5ab06' || source.attacks[0].description?.actionSequence !== FROST || source.attacks[1].description?.actionSequence !== 'e087e5bb-1cce-4bea-8cf4-76f204cad9d4' || source.attacks.some(a => !equal(a.commands, []) || a.description?.executionAttackSequence !== null)) fail('Unbekannte indirekte Magier-Angriffsfolge.');
  if (registry.arsenals.some(a => a.guid === OWN_ARSENAL || a.attacks?.some(v => v.guid === OWN_ATTACK))) fail('Neue interne Arsenalidentität kollidiert.');
  const result = clone(source); result.guid = OWN_ARSENAL; result.attacks = [clone(source.attacks[0])]; result.attacks[0].guid = OWN_ATTACK; result.behaviors = [];
  return result;
}
function evidence(fs, root, output) {
  const rows = PRESERVED.map(s => { const row = load(fs, root, s.directory, s.guid); if (digest(row.doc) !== s.sha256) fail('Native Spawn-/Kampfquelle verändert: ' + s.guid); if (output) { const f = path.join(output, row.directory, row.file); if (fs.existsSync(f) && digest(read(fs, f)) !== s.sha256) fail('Andere Änderung verändert eine Welt-/Kampfquelle: ' + s.guid); } return { ...s, file: row.file, doc: row.doc }; });
  const spawn = rows.find(r => r.guid === SPAWN).doc.subSequences?.[0]?.events?.[15], frost = rows.find(r => r.guid === FROST).doc.subSequences?.[0]?.events?.[12];
  if (spawn?.$type !== 'keen::actor::SpawnEntityEvent' || spawn.$value.templateReference !== null || spawn.$value.copyFaction !== false || spawn.$value.copyCombatAttributes !== true || spawn.$value.isProjectile !== false || spawn.$value.minSpawnCount !== 1 || spawn.$value.maxSpawnCount !== 1 || spawn.$value.breakImpactHierarchy !== true) fail('Nativer Eltern-/Item-Spawnpfad verändert.');
  if (frost?.$type !== 'keen::actor::SpawnEntityEvent' || frost.$value.templateReference !== PROJECTILE || frost.$value.copyFaction !== true || frost.$value.copyCombatAttributes !== true || frost.$value.isProjectile !== true) fail('Frostprojektil übernimmt die Verbündetenfraktion nicht.');
  return rows;
}
function within(a, b) { const r = path.relative(a, b); return !r || (!path.isAbsolute(r) && r !== '..' && !r.startsWith('..' + path.sep)); }
function apply(ctx, inputRoot, outputRoot) {
  const summary = { enabled: ctx?.enabled === true, role: ctx?.role || 'unknown', createdResources: [], resources: [], preservedSources: [], warnings: [], targets: 0, filesChanged: 0, createdFiles: 0, existingFilesChanged: 0, gameplayVerified: false, prototype: true, frostTargetingVerified: false };
  if (!summary.enabled) return summary; if (!['server', 'client'].includes(summary.role)) fail('Spielclient oder Dedicated Server muss eindeutig erkannt sein.');
  const defs = assertDefinitions(), schema = assertSchema(ctx.reflection), settings = config(ctx), fs = ctx.fs || fsDefault, input = path.resolve(inputRoot), output = path.resolve(outputRoot);
  if (within(input, output) || within(output, input)) fail('Original- und Ausgabeordner müssen getrennt sein.');
  const preserved = evidence(fs, input, output), sources = SOURCES.map(s => { const row = load(fs, input, 'TemplateResource', s.guid); nativeSource(row, s); return row; });
  for (const base of [WEAKLING, ELITE]) { const row = load(fs, input, 'TemplateResource', base.guid); if (digest(row.doc) !== base.sha256) fail('Native verbündete Vergleichsvorlage verändert.'); const m = components(row.doc); if (!equal(component(m, 'Enemy01BehaviorState').guardSetup, GUARD)) fail('Nativer Folgeaufbau verändert.'); if (base === WEAKLING && (!equal(component(m, 'LifeTime'), life(60)) || component(m, 'SpawnLimit').spawnLimitPool !== 'Skeleton')) fail('Native Lebensdauer-/Poolvorlage verändert.'); if (base === ELITE && component(m, 'Enemy01BehaviorState').behaviorSetup.executeBehaviorsDuringDeath !== false) fail('Native Todesbereinigung verändert.'); }
  const registry = load(fs, input, 'EnemyArsenalRegistryResource', REGISTRY), arsenal = ownArsenal(registry.doc), newRegistry = clone(registry.doc); newRegistry.arsenals.push(arsenal);
  const pending = [];
  function plan(directory, doc, created) {
    const file = doc.$guid + '_' + HASHES[directory] + '_0.json', destination = path.join(output, directory, file); identity(doc, file, directory);
    if (created && fs.readdirSync(path.join(input, directory)).some(f => f.startsWith(doc.$guid + '_'))) fail('Neue Vorlagen-GUID kollidiert mit Originaldaten.');
    const exists = fs.existsSync(destination), previous = exists ? read(fs, destination) : null;
    if (previous && !(equal(previous, doc) || (!created && equal(previous, registry.doc)))) fail('Andere Ausgabe belegt diese Ressourcenidentität: ' + file);
    summary.resources.push({ directory, file, guid: doc.$guid, type: doc.$type, part: 0, created, sha256: digest(doc) });
    if (!equal(previous, doc)) pending.push({ destination, doc, created, exists });
  }
  for (const [i, source] of sources.entries()) plan('TemplateResource', ownTemplate(source, defs[i], settings), true);
  plan('EnemyArsenalRegistryResource', newRegistry, false);
  Object.assign(summary, settings, { build: schema.build, targets: 3, createdResources: clone(CREATED_RESOURCES), preservedSources: preserved.map(({ doc, ...row }) => row), nativeRegistrySha256: REGISTRY_SHA, clonedArsenalGuid: OWN_ARSENAL, retainedAttackSequence: FROST, removedNestedSummons: true });
  summary.warnings.push(WARNING);
  // All native inputs, collisions and complete planned documents are validated
  // before any mutation. The caller may supply an in-memory pending-FS adapter.
  for (const row of pending) { fs.mkdirSync(path.dirname(row.destination), { recursive: true }); fs.writeFileSync(row.destination, JSON.stringify(row.doc, null, 2), 'utf8'); summary.filesChanged++; if (row.created && !row.exists) summary.createdFiles++; if (!row.created) summary.existingFilesChanged++; if (typeof ctx.track === 'function') ctx.track(row.destination, '/', row.created ? 'create' : 'update'); }
  if (typeof ctx.logger?.warn === 'function') ctx.logger.warn(WARNING);
  return summary;
}
function verify(summary, reflection, verifyRoot, fs = fsDefault) {
  if (summary?.enabled !== true) return { enabled: false, checked: 0, gameplayVerified: false };
  if (!['server', 'client'].includes(summary.role)) fail('Spielclient oder Dedicated Server muss eindeutig erkannt sein.');
  const defs = assertDefinitions(), schema = assertSchema(reflection), settings = config(summary);
  if (summary.build !== schema.build || summary.targets !== 3 || !equal(summary.createdResources, CREATED_RESOURCES) || !Array.isArray(summary.resources) || summary.resources.length !== 4 || summary.nativeRegistrySha256 !== REGISTRY_SHA || summary.clonedArsenalGuid !== OWN_ARSENAL || summary.retainedAttackSequence !== FROST || summary.removedNestedSummons !== true || summary.frostTargetingVerified !== false || summary.gameplayVerified !== false) fail('Prüfliste oder Build ist ungültig.');
  const preserved = evidence(fs, verifyRoot), list = preserved.map(({ doc, ...row }) => row); if (!equal(list, summary.preservedSources)) fail('Quellenprüfliste ist ungültig.');
  const registry = load(fs, verifyRoot, 'EnemyArsenalRegistryResource', REGISTRY), ownEntries = registry.doc.arsenals?.filter(a => a.guid === OWN_ARSENAL); if (ownEntries?.length !== 1) fail('Isoliertes Magierarsenal fehlt oder ist doppelt.');
  const nativeRegistry = clone(registry.doc); nativeRegistry.arsenals = nativeRegistry.arsenals.filter(a => a.guid !== OWN_ARSENAL); const expectedArsenal = ownArsenal(nativeRegistry); if (!equal(ownEntries[0], expectedArsenal)) fail('Isoliertes Magierarsenal enthält andere Angriffe oder Verhalten.');
  const expected = new Map(); for (const [i, s] of SOURCES.entries()) { const row = load(fs, verifyRoot, 'TemplateResource', s.guid); nativeSource(row, s); expected.set(defs[i].target, ownTemplate(row, defs[i], settings)); }
  const expectedRegistry = clone(nativeRegistry); expectedRegistry.arsenals.push(expectedArsenal); expected.set(REGISTRY, expectedRegistry);
  const seen = new Set(); for (const r of summary.resources) { const directory = r.guid === REGISTRY ? 'EnemyArsenalRegistryResource' : 'TemplateResource'; if (!expected.has(r.guid) || seen.has(r.guid) || r.directory !== directory || r.type !== TYPES[directory] || r.part !== 0 || r.created !== (r.guid !== REGISTRY) || r.file !== r.guid + '_' + HASHES[directory] + '_0.json') fail('Ungültige Ressourcen-Prüfidentität.'); seen.add(r.guid); const doc = read(fs, path.join(verifyRoot, directory, r.file)); identity(doc, r.file, directory); if (digest(doc) !== r.sha256 || !equal(doc, expected.get(r.guid))) fail('Begleiter-/Arsenalinhalt stimmt nach Archiv-Rücklesen nicht: ' + r.file); }
  if (seen.size !== 4) fail('Begleiter-Prüfung ist unvollständig.');
  return { enabled: true, role: summary.role, checked: 4, targets: 3, originalSourcesChecked: preserved.length, clonedArsenalGuid: OWN_ARSENAL, frostTargetingVerified: false, gameplayVerified: false, prototype: true };
}
module.exports = { apply, verify, assertSchema, assertDefinitions, CREATED_RESOURCES, SOURCES, OWN_ARSENAL, OWN_ATTACK, WARNING };
