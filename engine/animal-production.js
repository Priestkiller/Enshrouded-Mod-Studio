'use strict';
/* Own source: adjusts existing productive, tameable animal prototypes only.
 * No kill loot, new production, feeding, breeding, inventory or saved entity
 * edits. Source values, identities and all planned outputs are checked before
 * the first write. Fresh reflection is required for both apply and verify.
 */
const fsDefault = require('fs');
const path = require('path');
const PREFIX = 'keen::ecs::';
const TEMPLATE = PREFIX + 'TemplateResource';
const ITEM = 'keen::ItemInfo';
const REFILL = PREFIX + 'InteractionLootRefill';
const ANIMAL = PREFIX + 'Animal';
const WILDLIFE = PREFIX + 'Wildlife';
const INVENTORY = PREFIX + 'Inventory';
const SETUP = PREFIX + 'InventorySetup';
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Placement helpers are real already-tamed prototypes and must be retained.
const EXCLUDED_NAME = /(?:^|_)(?:Base|DEPRECATED|NOTFINISHED|DONOTUSE|DONOTPLACE|Test|Testing|Dummy)(?:_|$)/i;
const WARNING = 'Ändert vorhandene Tierproduktionsdaten: Menge und Vorratsgrenze werden gemeinsam vervielfacht, die Wartezeit wird durch den Tempofaktor geteilt. Futter-, Schlaf- und Fortpflanzungsregeln bleiben unverändert. Laufende Timer, bereits gespeicherte Tiere sowie das Zusammenspiel mit unveränderten Clients sind nicht im Spiel geprüft.';
function fail(message) { throw Error('Tierproduktion: ' + message); }
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function equal(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => equal(v, b[i]));
  if (!object(a) || !object(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(k => Object.prototype.hasOwnProperty.call(b, k) && equal(a[k], b[k]));
}
function exactKeys(value, keys) { return object(value) && Object.keys(value).sort().join('|') === keys.slice().sort().join('|'); }
function uint32(value) { return Number.isInteger(value) && value >= 0 && value <= 0xffffffff; }
function validGuid(value) { return typeof value === 'string' && GUID.test(value) && value !== '00000000-0000-0000-0000-000000000000'; }
function factor(value, name) { if (!Number.isInteger(value) || value < 1 || value > 20) fail(name + ' muss eine ganze Zahl von 1 bis 20 sein.'); return value; }
function assertSchema(reflection) {
  if (!reflection || typeof reflection.version !== 'string' || !reflection.version.trim() || !Array.isArray(reflection.types)) fail('Frische Reflection mit Spielversion fehlt.');
  const types = reflection.types;
  function type(name) {
    const found = types.filter(t => t && t.qualifiedName === name);
    if (found.length !== 1) fail('Reflection-Typ ist nicht eindeutig: ' + name);
    return found[0];
  }
  function field(owner, name, offset, target) {
    const f = owner.structFields?.[name];
    if (!object(f) || f.dataOffset !== offset || !Number.isInteger(f.type) || types[f.type] !== type(target)) fail('Unbekannte Feldstruktur: ' + owner.qualifiedName + '.' + name);
  }
  function struct(name, size, alignment, fields) {
    const t = type(name);
    if (t.primitiveType !== 'STRUCT' || t.size !== size || t.alignment !== alignment || t.fieldCount !== Object.keys(fields).length || !exactKeys(t.structFields, Object.keys(fields))) fail('Unbekannte Struktur: ' + name);
    for (const [name, [offset, target]] of Object.entries(fields)) field(t, name, offset, target);
    return t;
  }
  const refill = struct(REFILL, 48, 8, { waitTime: [0, 'keen::Time'], verbLoca: [8, 'keen::LocaTagReference'], defaultSequence: [24, 'keen::actor::ActorSequenceReference'], items: [40, 'keen::BlobArray<keen::ecs::LootRefill>'] });
  if (refill.attributes?.server_only?.name !== 'server_only') fail('Die geprüfte server_only-Klassifikation der Tierproduktion fehlt.');
  const loot = struct(PREFIX + 'LootRefill', 24, 4, { lootableItemRef: [0, 'keen::ItemReference'], refillCount: [16, 'keen::uint32'], maxCount: [20, 'keen::uint32'] });
  const u32 = type('keen::uint32'), s64 = type('keen::sint64');
  if (u32.primitiveType !== 'UINT32' || u32.size !== 4 || s64.primitiveType !== 'SINT64' || s64.size !== 8) fail('Unbekannte Zähler- oder Zeit-Zahlentypen.');
  struct('keen::Time', 8, 8, { value: [0, 'keen::sint64'] });
  const array = type('keen::BlobArray<keen::ecs::LootRefill>'), itemRef = type('keen::ItemReference');
  if (array.primitiveType !== 'BLOB_ARRAY' || array.size !== 8 || types[array.innerType] !== loot || itemRef.primitiveType !== 'TYPEDEF' || itemRef.size !== 16) fail('Unbekannte Produktionsliste oder Gegenstandsreferenz.');
  const animal = type(ANIMAL), wildlife = type(WILDLIFE), setup = type(SETUP), animalType = type('keen::animal::Type');
  if (animal.primitiveType !== 'STRUCT' || animal.size !== 656 || animal.alignment !== 8 || wildlife.primitiveType !== 'STRUCT' || wildlife.size !== 736 || wildlife.alignment !== 8 || setup.primitiveType !== 'STRUCT' || setup.size !== 84 || setup.alignment !== 4) fail('Tier-/Inventarklassifikation entspricht nicht der geprüften Struktur.');
  field(animal, 'type', 188, 'keen::animal::Type');
  field(wildlife, 'enabledFeatures', 128, 'keen::wildlife::FeatureMask');
  field(setup, 'genericSlotCount', 81, 'keen::uint8');
  const mask = type('keen::wildlife::FeatureMask'), bits = type('keen::Bitmask16<keen::wildlife::Feature>'), feature = type('keen::wildlife::Feature');
  if (mask.primitiveType !== 'TYPEDEF' || mask.size !== 2 || types[mask.innerType] !== bits || bits.primitiveType !== 'BITMASK16' || bits.size !== 2 || types[bits.innerType] !== feature || feature.primitiveType !== 'ENUM' || feature.size !== 1 || !exactKeys(feature.enumFields, ['Roaming', 'Flee', 'ShowSpawnSequence', 'Tameable', 'RunAway'])) fail('Unbekannte Tameable-Featuremaske.');
  ['Roaming', 'Flee', 'ShowSpawnSequence', 'Tameable', 'RunAway'].forEach((name, value) => { if (feature.enumFields[name]?.value !== value) fail('Tameable-Featurewerte wurden verändert.'); });
  const animals = ['None', 'Fish', 'FarmAnimal', 'Bunny', 'Catdeer', 'Goat', 'SandDigger', 'Turkey', 'Yak', 'Capybara', 'Pet', 'Cat', 'Dog', 'Panda'];
  if (animalType.primitiveType !== 'ENUM' || animalType.size !== 1 || !exactKeys(animalType.enumFields, animals)) fail('Unbekannte Tierarten-Klassifikation.');
  animals.forEach((name, value) => { if (animalType.enumFields[name]?.value !== value) fail('Tierartenwerte wurden verändert.'); });
  const hashes = {};
  for (const [directory, name] of [['TemplateResource', TEMPLATE], ['ItemInfo', ITEM]]) {
    const definition = type(name);
    if (definition.primitiveType !== 'STRUCT' || !uint32(definition.qualifiedHash)) fail('Ressourcenkennung fehlt: ' + name);
    hashes[directory] = definition.qualifiedHash.toString(16).padStart(8, '0');
  }
  return { build: reflection.version, hashes, features: new Set(Object.keys(feature.enumFields)), animals: new Set(animals) };
}
function read(fs, file) {
  try {
    const doc = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    if (!object(doc)) fail('JSON-Objekt fehlt.');
    return doc;
  } catch (error) { fail('JSON nicht lesbar: ' + path.basename(file) + '. ' + error.message); }
}
function identity(doc, file, directory, schema) {
  const type = directory === 'TemplateResource' ? TEMPLATE : ITEM;
  if (doc.$type !== type || !validGuid(doc.$guid) || !Number.isInteger(doc.$part) || doc.$part < 0) fail('Ungültige Ressourcenidentität: ' + path.basename(file));
  const expected = doc.$guid.toLowerCase() + '_' + schema.hashes[directory] + '_' + doc.$part + '.json';
  if (path.basename(file).toLowerCase() !== expected) fail('Dateiname, GUID und Typ passen nicht zusammen: ' + path.basename(file));
  if (directory === 'TemplateResource' && (typeof doc.name !== 'string' || !doc.name || typeof doc.family !== 'string')) fail('Template-Name oder Familie fehlt: ' + path.basename(file));
  return doc.$guid.toLowerCase();
}
function component(doc, type) { return doc.components.find(c => c.$type === type); }
function validateComponents(doc, file) {
  if (!Array.isArray(doc.components) || doc.components.some(c => !object(c) || typeof c.$type !== 'string' || !object(c.$value))) fail('Ungültige Template-Komponenten: ' + path.basename(file));
  for (const type of [REFILL, ANIMAL, WILDLIFE, INVENTORY, SETUP, PREFIX + 'IsTame', PREFIX + 'BabyAnimal']) {
    if (doc.components.filter(c => c.$type === type).length > 1) fail('Doppelte Komponente ' + type + ': ' + path.basename(file));
  }
}
function candidate(doc, file, schema) {
  validateComponents(doc, file);
  const animal = component(doc, ANIMAL), refill = component(doc, REFILL);
  if (!animal || !refill) return null;
  if (EXCLUDED_NAME.test(doc.name) || component(doc, PREFIX + 'BabyAnimal')) return null;
  if (!['Animal', 'None'].includes(doc.family)) fail('Produktive Tierkomponente außerhalb der belegten Animal-/None-Familien: ' + path.basename(file));
  const wildlife = component(doc, WILDLIFE);
  if (!wildlife) return null;
  const features = wildlife.$value.enabledFeatures;
  if (!Array.isArray(features) || features.some(f => !schema.features.has(f)) || new Set(features).size !== features.length) fail('Unbekannte Wildlife-Features: ' + path.basename(file));
  if (!features.includes('Tameable')) return null;
  if (!schema.animals.has(animal.$value.type) || ['None', 'Fish', 'Pet', 'Cat', 'Dog'].includes(animal.$value.type)) fail('Unbekannte produktive Tierart: ' + path.basename(file));
  const setup = component(doc, SETUP)?.$value;
  if (!component(doc, INVENTORY) || !setup || !Number.isInteger(setup.genericSlotCount) || setup.genericSlotCount < 1 || setup.genericSlotCount > 255 || !Array.isArray(setup.inventoryFlags) || setup.inventoryFlags.some(f => typeof f !== 'string') || setup.inventoryFlags.some(f => f === 'IsPlayer' || f === 'IsNpc')) fail('Produktives Tier ohne gültiges eigenes Tierinventar: ' + path.basename(file));
  if (doc.components.some(c => [PREFIX + 'NetworkPlayer', PREFIX + 'NetworkNpc', PREFIX + 'Gravestone', PREFIX + 'ItemCollection', PREFIX + 'ItemCollectionComponent'].includes(c.$type))) fail('Nicht zulässige Spieler-/NPC-/Weltloot-Klassifikation: ' + path.basename(file));
  validateRefill(refill.$value, file);
  return { index: doc.components.indexOf(refill), value: refill.$value, animalType: animal.$value.type, isTame: Boolean(component(doc, PREFIX + 'IsTame')) };
}
function validateRefill(value, file) {
  if (!exactKeys(value, ['waitTime', 'verbLoca', 'defaultSequence', 'items']) || !exactKeys(value.waitTime, ['value']) || !Number.isSafeInteger(value.waitTime.value) || value.waitTime.value < 1 || !validGuid(value.verbLoca) || !validGuid(value.defaultSequence) || !Array.isArray(value.items) || !value.items.length) fail('Ungültige Produktionsstruktur oder nicht sicher darstellbare positive Wartezeit: ' + path.basename(file));
  const seen = new Set();
  for (const item of value.items) {
    if (!exactKeys(item, ['lootableItemRef', 'refillCount', 'maxCount']) || !validGuid(item.lootableItemRef) || !uint32(item.refillCount) || item.refillCount < 1 || !uint32(item.maxCount) || item.maxCount < item.refillCount || seen.has(item.lootableItemRef.toLowerCase())) fail('Ungültiger Produktionszähler oder doppelte Produktreferenz: ' + path.basename(file));
    seen.add(item.lootableItemRef.toLowerCase());
  }
}
function calculate(value, quantityFactor, speedFactor, file) {
  validateRefill(value, file);
  const after = clone(value);
  after.waitTime.value = Math.ceil(value.waitTime.value / speedFactor);
  for (const item of after.items) {
    item.refillCount *= quantityFactor; item.maxCount *= quantityFactor;
    if (!uint32(item.refillCount) || !uint32(item.maxCount) || item.refillCount < 1 || item.maxCount < item.refillCount) fail('Mengenfaktor überschreitet die uint32-Zählergrenze: ' + path.basename(file));
  }
  validateRefill(after, file);
  return after;
}
function isInside(a, b) { const rel = path.relative(a, b); return !rel || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel)); }
function apply(ctx, inputRoot, outputRoot) {
  const summary = { enabled: ctx?.enabled === true, build: null, role: ['client', 'server'].includes(ctx?.role) ? ctx.role : 'unknown', quantityFactor: ctx?.quantityFactor ?? 2, speedFactor: ctx?.speedFactor ?? 1, targets: 0, tamedPrototypes: 0, tameablePrototypes: 0, filesChanged: 0, fieldsChanged: 0, productTypes: 0, resources: [], warnings: [], gameplayVerified: false };
  if (!summary.enabled) return summary;
  const quantityFactor = factor(summary.quantityFactor, 'Mengenfaktor'), speedFactor = factor(summary.speedFactor, 'Tempofaktor');
  const schema = assertSchema(ctx.reflection), fs = ctx.fs || fsDefault;
  summary.build = schema.build;
  const input = path.resolve(inputRoot), output = path.resolve(outputRoot);
  if (isInside(input, output) || isInside(output, input)) fail('Ausgangs- und Ausgabeordner müssen getrennt sein und dürfen nicht ineinander liegen.');
  const directory = path.join(inputRoot, 'TemplateResource'), itemDirectory = path.join(inputRoot, 'ItemInfo');
  if (!fs.existsSync(directory) || !fs.existsSync(itemDirectory)) fail('TemplateResource- oder ItemInfo-Export fehlt.');
  const names = fs.readdirSync(directory).filter(n => n.endsWith('.json')).sort();
  const itemNames = fs.readdirSync(itemDirectory).filter(n => n.endsWith('.json')), productCache = new Map(), seen = new Set(), pending = [];
  if (!names.length || !itemNames.length) fail('Ressourcenexport ist leer.');
  function product(guid) {
    const key = guid.toLowerCase();
    if (productCache.has(key)) return productCache.get(key);
    const matches = itemNames.filter(n => n.toLowerCase().startsWith(key + '_'));
    if (matches.length !== 1) fail('Produkt-ItemInfo fehlt oder ist mehrdeutig: ' + guid);
    const file = path.join(itemDirectory, matches[0]), doc = read(fs, file);
    identity(doc, file, 'ItemInfo', schema);
    if (typeof doc.objectId !== 'string' || doc.objectId.toLowerCase() !== key || !object(doc.itemId) || !uint32(doc.itemId.value) || !doc.itemId.value || typeof doc.debugName !== 'string' || !doc.debugName || !['Materials', 'Consumables'].includes(doc.category) || !uint32(doc.maxStackSize) || !doc.maxStackSize) fail('Produkt verweist nicht auf einen gültigen Material-/Nahrungsgegenstand: ' + matches[0]);
    const result = { guid: key, file: matches[0], name: doc.debugName, category: doc.category, maxStackSize: doc.maxStackSize, itemId: doc.itemId.value };
    productCache.set(key, result); return result;
  }
  for (const name of names) {
    const sourceFile = path.join(directory, name);
    // Nonproductive world resources are never parsed or changed by this mod.
    const text = fs.readFileSync(sourceFile, 'utf8').replace(/^\uFEFF/, '');
    if (!text.includes(REFILL)) continue;
    let original;
    try { original = JSON.parse(text); } catch (error) { fail('JSON nicht lesbar: ' + name + '. ' + error.message); }
    const guid = identity(original, sourceFile, 'TemplateResource', schema);
    if (seen.has(guid)) fail('Doppelte oder mehrteilige produktive Template-GUID: ' + name);
    seen.add(guid);
    const selected = candidate(original, sourceFile, schema);
    if (!selected) continue;
    const desired = calculate(selected.value, quantityFactor, speedFactor, name);
    const products = selected.value.items.map(item => product(item.lootableItemRef));
    const destination = path.join(outputRoot, 'TemplateResource', name);
    const current = fs.existsSync(destination) ? read(fs, destination) : original;
    identity(current, destination, 'TemplateResource', schema);
    if (['$guid', '$part', '$type', 'name', 'family'].some(k => current[k] !== original[k])) fail('Ausgabeidentität wurde verändert: ' + name);
    const live = candidate(current, destination, schema);
    if (!live || live.animalType !== selected.animalType || live.isTame !== selected.isTame || live.value.items.length !== selected.value.items.length || live.value.verbLoca !== selected.value.verbLoca || live.value.defaultSequence !== selected.value.defaultSequence) fail('Tier-/Produktionsklassifikation wurde in der Ausgabe verändert: ' + name);
    for (let i = 0; i < live.value.items.length; i++) {
      const originalItem = selected.value.items[i], currentItem = live.value.items[i], desiredItem = desired.items[i];
      if (currentItem.lootableItemRef !== originalItem.lootableItemRef) fail('Produktreferenz wurde in der Ausgabe verändert: ' + name);
      for (const key of ['refillCount', 'maxCount']) if (currentItem[key] !== originalItem[key] && currentItem[key] !== desiredItem[key]) fail('Andere Änderung setzt einen widersprüchlichen Produktionszähler: ' + name);
    }
    if (live.value.waitTime.value !== selected.value.waitTime.value && live.value.waitTime.value !== desired.waitTime.value) fail('Andere Änderung setzt eine widersprüchliche Produktionswartezeit: ' + name);
    const patched = clone(current), pointer = '/components/' + live.index + '/$value';
    patched.components[live.index].$value = desired;
    const changedPointers = [];
    if (live.value.waitTime.value !== desired.waitTime.value) changedPointers.push(pointer + '/waitTime/value');
    for (let i = 0; i < desired.items.length; i++) for (const key of ['refillCount', 'maxCount']) if (live.value.items[i][key] !== desired.items[i][key]) changedPointers.push(pointer + '/items/' + i + '/' + key);
    summary.targets++;
    summary[selected.isTame ? 'tamedPrototypes' : 'tameablePrototypes']++;
    summary.resources.push({ file: name, guid, name: original.name, family: original.family, animalType: selected.animalType, isTame: selected.isTame, componentIndex: live.index, pointer, before: clone(selected.value), after: clone(desired), products: clone(products) });
    if (changedPointers.length) pending.push({ destination, doc: patched, changedPointers });
  }
  if (!summary.targets) fail('Keine belegten produktiven, zähmbaren Tierprototypen gefunden; die neuen Spieldaten müssen geprüft werden.');
  summary.productTypes = productCache.size;
  summary.warnings.push(WARNING);
  if (ctx.logger && typeof ctx.logger.warn === 'function') ctx.logger.warn(WARNING);
  for (const row of pending) {
    fs.mkdirSync(path.dirname(row.destination), { recursive: true });
    fs.writeFileSync(row.destination, JSON.stringify(row.doc, null, 2), 'utf8');
    summary.filesChanged++; summary.fieldsChanged += row.changedPointers.length;
    if (typeof ctx.track === 'function') for (const pointer of row.changedPointers) ctx.track(row.destination, pointer);
  }
  return summary;
}
function verify(summary, reflection, verifyRoot, fs = fsDefault) {
  if (summary?.enabled !== true) return { enabled: false, checked: 0, resourcesChecked: 0, gameplayVerified: false };
  const schema = assertSchema(reflection), quantityFactor = factor(summary.quantityFactor, 'Mengenfaktor'), speedFactor = factor(summary.speedFactor, 'Tempofaktor');
  if (summary.build !== schema.build) fail('Spielversion der Produktions-Prüfliste stimmt nicht mit der frischen Reflection überein.');
  if (!Array.isArray(summary.resources) || !summary.resources.length || summary.targets !== summary.resources.length) fail('Prüfliste der Tierproduktion fehlt oder ist inkonsistent.');
  const seen = new Set();
  let fieldsChecked = 0;
  for (const row of summary.resources) {
    if (!object(row) || typeof row.file !== 'string' || path.basename(row.file) !== row.file || !validGuid(row.guid) || seen.has(row.guid.toLowerCase())) fail('Ungültige oder doppelte Ressourcenidentität in der Prüfliste.');
    seen.add(row.guid.toLowerCase());
    const expected = calculate(row.before, quantityFactor, speedFactor, row.file);
    if (!equal(row.after, expected)) fail('Berechnete Sollwerte stimmen nicht mit der Prüfliste überein: ' + row.file);
    const file = path.join(verifyRoot, 'TemplateResource', row.file), doc = read(fs, file);
    const guid = identity(doc, file, 'TemplateResource', schema), selected = candidate(doc, file, schema);
    if (guid !== row.guid.toLowerCase() || doc.name !== row.name || doc.family !== row.family || !selected || selected.animalType !== row.animalType || selected.isTame !== row.isTame || !equal(selected.value, expected)) fail('Tierproduktionswerte oder Klassifikation nach dem Packen stimmen nicht: ' + row.file);
    fieldsChecked += 1 + 2 * expected.items.length;
  }
  return { enabled: true, checked: seen.size, resourcesChecked: seen.size, fieldsChecked, gameplayVerified: false };
}
module.exports = { apply, verify, assertSchema, calculate, WARNING, TEMPLATE, ITEM, REFILL, ANIMAL, WILDLIFE, EXCLUDED_NAME };
