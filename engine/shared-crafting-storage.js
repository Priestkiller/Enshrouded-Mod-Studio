'use strict';
/* Own source: export-only crafting-stock extension. This module does not
 * implement queue automation or alter inventories, recipes or saved entities.
 * All identities and pending outputs are checked before the first write.
 */
const fsDefault = require('fs');
const path = require('path');
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PREFIX = 'keen::ecs::';
const STOCK = PREFIX + 'InventoryCraftingStock';
const DYNAMIC = PREFIX + 'DynamicInventoryCraftingStock';
const TYPES = { TemplateResource: PREFIX + 'TemplateResource', ItemInfo: 'keen::ItemInfo', RecipeRegistryResource: 'keen::RecipeRegistryResource' };
const BASE_FACTORY = /^Base_Craftingstation_Factory(?:_Animated|_VFX)?$/;
const FACTORY_NAME = /^T\d+_.+_Factory$/i;
const NORMAL_CHEST = /^Prop_Decoration_T\d+_Storage_\d+(?:_Chest)?$/;
const EXCLUDED_NAME = /(?:^|_)(?:Base|Test|Testing|Cheat|Dummy|Deprecated|DONOTPLACE|DONOTUSE|Grave|Gravestone|Player|NPC|Enemy|LootChest|ItemCollection|Display|Showcase|WeaponRack|FeedingTrough|Fodder|Planted)(?:_|$)/i;
const EXCLUDED_COMPONENTS = new Set(['NetworkPlayer', 'NetworkNpc', 'NetworkEnemy', 'RandomLoot', 'RandomLootContainer', 'ItemCollection', 'ItemCollectionComponent', 'Gravestone'].map(name => PREFIX + name));
const WARNING = 'Die Freigabe erweitert mögliche Materialquellen und erlaubt bei neu ergänzten Quellen auch Umgebungseinlagerung. Reichweite, Zugriffsrechte, gespeicherte Objekte und die Wirkung im Spiel sind nicht geprüft. Eine automatische Nachversorgung laufender Stationswarteschlangen wird nicht zugesichert.';
function fail(message) { throw Error('Materialquellen: ' + message); }
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function uint32(value) { return Number.isInteger(value) && value >= 0 && value <= 0xffffffff; }
function exactKeys(value, keys) { return object(value) && Object.keys(value).sort().join('|') === keys.slice().sort().join('|'); }
function read(fs, file) {
  try {
    const doc = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    if (!object(doc)) fail('JSON-Objekt fehlt: ' + path.basename(file));
    return doc;
  } catch (error) { fail('JSON nicht lesbar: ' + path.basename(file) + '. ' + error.message); }
}
function assertSchema(reflection) {
  if (!reflection || typeof reflection.version !== 'string' || !reflection.version.trim() || !Array.isArray(reflection.types)) fail('Frische Reflection mit Spielversion fehlt.');
  function type(name) {
    const matches = reflection.types.filter(entry => entry && entry.qualifiedName === name);
    if (matches.length !== 1) fail('Struktur nicht eindeutig: ' + name);
    return matches[0];
  }
  const stock = type(STOCK), fields = stock.structFields;
  if (stock.primitiveType !== 'STRUCT' || stock.size !== 1 || stock.alignment !== 1 || stock.fieldCount !== 1 || !exactKeys(fields, ['canReceiveAreaDeposit'])) fail('InventoryCraftingStock entspricht nicht der geprüften Struktur mit genau einem bool-Feld.');
  const field = fields.canReceiveAreaDeposit;
  if (!object(field) || field.dataOffset !== 0 || !Number.isInteger(field.type)) fail('canReceiveAreaDeposit ist kein bool an Position 0.');
  const bool = reflection.types[field.type];
  if (!bool || bool.primitiveType !== 'BOOL' || bool.size !== 1) fail('canReceiveAreaDeposit ist kein bool an Position 0.');
  const hashes = {};
  for (const [directory, name] of Object.entries(TYPES)) {
    const definition = type(name);
    if (definition.primitiveType !== 'STRUCT' || !uint32(definition.qualifiedHash)) fail('Ressourcenkennung fehlt: ' + name);
    hashes[directory] = definition.qualifiedHash.toString(16).padStart(8, '0');
  }
  return { build: reflection.version, hashes };
}
function identity(doc, file, directory, schema) {
  if (doc.$type !== TYPES[directory] || typeof doc.$guid !== 'string' || !GUID.test(doc.$guid) || !Number.isInteger(doc.$part) || doc.$part < 0) fail('Ungültige Ressourcenidentität: ' + path.basename(file));
  const expected = doc.$guid.toLowerCase() + '_' + schema.hashes[directory] + '_' + doc.$part + '.json';
  if (path.basename(file).toLowerCase() !== expected) fail('Dateiname, Typ und GUID passen nicht zusammen: ' + path.basename(file));
  return doc.$guid.toLowerCase();
}
function resources(fs, inputRoot, directory, schema) {
  const root = path.join(inputRoot, directory);
  if (!fs.existsSync(root)) fail('Export fehlt: ' + directory);
  const names = fs.readdirSync(root).filter(name => name.endsWith('.json')).sort();
  if (!names.length) fail('Keine Ressourcen gefunden: ' + directory);
  const map = new Map();
  for (const name of names) {
    const file = path.join(root, name), doc = read(fs, file), guid = identity(doc, file, directory, schema);
    if (map.has(guid)) fail('Doppelte oder mehrteilige Ressourcen-GUID kann nicht eindeutig zugeordnet werden: ' + name);
    map.set(guid, { guid, file, name, doc });
  }
  return map;
}
function components(doc, type) { return doc.components.filter(entry => entry.$type === type); }
function validateComponents(doc, file) {
  if (typeof doc.name !== 'string' || !doc.name || !Array.isArray(doc.components) || doc.components.some(entry => !object(entry) || typeof entry.$type !== 'string' || !object(entry.$value))) fail('Ungültige Template-Komponenten: ' + file);
  for (const type of [STOCK, DYNAMIC, PREFIX + 'FactoryStation', PREFIX + 'Inventory', PREFIX + 'InventorySetup']) {
    if (components(doc, type).length > 1) fail('Doppelte Komponente ' + type + ' in ' + file);
  }
  const stock = components(doc, STOCK)[0];
  if (stock && (!exactKeys(stock.$value, ['canReceiveAreaDeposit']) || typeof stock.$value.canReceiveAreaDeposit !== 'boolean')) fail('Unbekannter Stock-Wert in ' + file);
  const dynamic = components(doc, DYNAMIC)[0];
  if (dynamic && (!exactKeys(dynamic.$value, ['canReceiveAreaDepositOverrideIsSet', 'canReceiveAreaDepositOverride']) || Object.values(dynamic.$value).some(value => typeof value !== 'boolean'))) fail('Ungültige dynamische Einlagerungseinstellung in ' + file);
}
function inventory(doc, file, requireInventory) {
  const setups = components(doc, PREFIX + 'InventorySetup');
  if (setups.length !== 1 || !Number.isInteger(setups[0].$value.genericSlotCount) || setups[0].$value.genericSlotCount < 1 || setups[0].$value.genericSlotCount > 255 || !Array.isArray(setups[0].$value.inventoryFlags) || setups[0].$value.inventoryFlags.some(flag => typeof flag !== 'string')) fail('Kein gültiges InventorySetup für ' + file);
  if (requireInventory && components(doc, PREFIX + 'Inventory').length !== 1) fail('Stationsinventar fehlt: ' + file);
  if (setups[0].$value.inventoryFlags.includes('IsPlayer') || setups[0].$value.inventoryFlags.includes('IsNpc')) fail('Spieler-/NPC-Inventar darf keine gemeinsame Materialquelle werden: ' + file);
  return setups[0].$value;
}
function excluded(doc) { return EXCLUDED_NAME.test(doc.name) || doc.components.some(entry => EXCLUDED_COMPONENTS.has(entry.$type)); }
function recipeLinks(registries, items) {
  const byId = new Map(), links = new Map(), recipeGuids = new Set();
  for (const row of items.values()) {
    const item = row.doc;
    if (!object(item.itemId) || !uint32(item.itemId.value) || item.itemId.value === 0 || typeof item.objectId !== 'string' || item.objectId.toLowerCase() !== row.guid) fail('ItemInfo-ID/ObjectID ist ungültig: ' + row.name);
    if (byId.has(item.itemId.value)) fail('Doppelte ItemId: ' + item.itemId.value);
    byId.set(item.itemId.value, row);
  }
  for (const registry of registries.values()) {
    if (!Array.isArray(registry.doc.recipes)) fail('Rezeptliste fehlt: ' + registry.name);
    registry.doc.recipes.forEach((recipe, recipeIndex) => {
      if (!object(recipe) || !GUID.test(recipe.recipeGuid || '') || !object(recipe.recipeId) || !uint32(recipe.recipeId.value) || recipe.recipeId.value === 0 || !Array.isArray(recipe.output)) fail('Unbekannte Rezeptform: ' + registry.name + ' #' + recipeIndex);
      const recipeGuid = recipe.recipeGuid.toLowerCase();
      if (recipeGuids.has(recipeGuid)) fail('Doppelte Rezept-GUID: ' + recipe.recipeGuid);
      recipeGuids.add(recipeGuid);
      recipe.output.forEach((output, outputIndex) => {
        if (!object(output) || !object(output.item) || !uint32(output.item.value) || !Number.isInteger(output.count) || output.count < 0 || (output.itemRef !== null && !GUID.test(output.itemRef || ''))) fail('Unbekannte Rezeptausgabe: ' + registry.name + ' #' + recipeIndex + '/' + outputIndex);
        if (output.count === 0 || output.itemRef === null) return;
        const item = items.get(output.itemRef.toLowerCase()), sameId = byId.get(output.item.value);
        if (!item || sameId !== item) fail('ItemRef und ItemId einer Rezeptausgabe passen nicht zusammen: ' + registry.name + ' #' + recipeIndex + '/' + outputIndex);
        if (!links.has(item.guid)) links.set(item.guid, []);
        links.get(item.guid).push({ registry: registry.name, recipeGuid, recipeId: recipe.recipeId.value, pointer: '/recipes/' + recipeIndex + '/output/' + outputIndex });
      });
    });
  }
  return links;
}
function apply(ctx, inputRoot, outputRoot) {
  const summary = { enabled: ctx?.enabled === true, build: null, role: ['client', 'server'].includes(ctx?.role) ? ctx.role : 'unknown', targets: 0, normalChests: 0, stations: 0, added: 0, alreadyPresent: 0, filesChanged: 0, fieldsChanged: 0, classificationSources: { 'recipe-placed-chest': 0, 'factory-components': 0 }, samples: [], warnings: [], gameplayVerified: false };
  if (!summary.enabled) return summary;
  const schema = assertSchema(ctx.reflection), fs = ctx.fs || fsDefault;
  summary.build = schema.build;
  if (path.resolve(inputRoot).toLowerCase() === path.resolve(outputRoot).toLowerCase()) fail('Ausgangs- und Ausgabeordner müssen getrennt sein.');
  const templates = resources(fs, inputRoot, 'TemplateResource', schema);
  const items = resources(fs, inputRoot, 'ItemInfo', schema);
  const registries = resources(fs, inputRoot, 'RecipeRegistryResource', schema);
  for (const row of templates.values()) validateComponents(row.doc, row.name);
  const links = recipeLinks(registries, items), placed = new Map();
  for (const item of items.values()) {
    if (!links.has(item.guid)) continue;
    const entity = item.doc.equipment?.placedEntity;
    if (entity === null || entity === undefined) continue;
    if (typeof entity !== 'string' || !GUID.test(entity)) fail('Ungültige Platzierungs-GUID: ' + item.name);
    const target = templates.get(entity.toLowerCase());
    if (!target) fail('Platzierbares Rezept verweist auf fehlendes Template: ' + item.name);
    if (!placed.has(target.guid)) placed.set(target.guid, []);
    placed.get(target.guid).push({ itemGuid: item.guid, itemId: item.doc.itemId.value, itemFile: item.name, itemName: item.doc.debugName, category: item.doc.category, slot: item.doc.equipment.slot, recipes: links.get(item.guid) });
  }
  const pending = [];
  for (const row of templates.values()) {
    const doc = row.doc, factory = components(doc, PREFIX + 'FactoryStation').length === 1;
    if (BASE_FACTORY.test(doc.name)) continue;
    let kind, classificationSource, proof = [];
    if (factory) {
      if (excluded(doc)) continue;
      if (!FACTORY_NAME.test(doc.name)) fail('Unbekanntes FactoryStation-Endtemplate: ' + row.name + ' (' + doc.name + ')');
      if (doc.family !== 'Factory') fail('FactoryStation-Endtemplate hat eine unbekannte Familie: ' + row.name);
      inventory(doc, row.name, true);
      kind = 'station'; classificationSource = 'factory-components'; proof = placed.get(row.guid) || [];
    } else if (NORMAL_CHEST.test(doc.name)) {
      if (excluded(doc)) fail('Widersprüchliche Kistenklassifikation: ' + row.name);
      proof = placed.get(row.guid) || [];
      if (!proof.length) continue; // e.g. the disabled, non-craftable T0 chest.
      if (doc.family !== 'Container' || proof.some(item => item.category !== 'BuildTools' || item.slot !== 'BuildTool')) fail('Kein eindeutiger Rezept-/Item-/Platzierungsbeleg für normale Kiste: ' + row.name);
      inventory(doc, row.name, false);
      kind = 'normalChest'; classificationSource = 'recipe-placed-chest';
    } else {
      // Magic chests, world loot, displays, player/NPC inventories and planted
      // stocks are deliberately not promoted by a general inventory predicate.
      continue;
    }
    const destination = path.join(outputRoot, 'TemplateResource', row.name);
    const current = fs.existsSync(destination) ? read(fs, destination) : doc;
    identity(current, destination, 'TemplateResource', schema);
    if (current.$guid !== doc.$guid || current.$part !== doc.$part || current.$type !== doc.$type || current.name !== doc.name || current.family !== doc.family) fail('Ausgabeidentität verändert: ' + row.name);
    validateComponents(current, row.name);
    inventory(current, row.name, kind === 'station');
    if ((components(current, PREFIX + 'FactoryStation').length === 1) !== factory || excluded(current)) fail('Ausgabeklassifikation verändert: ' + row.name);
    const originalStock = components(doc, STOCK)[0], stock = components(current, STOCK)[0];
    if (originalStock && (!stock || JSON.stringify(stock) !== JSON.stringify(originalStock))) fail('Bestehender Stock-Marker wurde von einer anderen Änderung ersetzt: ' + row.name);
    const oldDynamic = components(doc, DYNAMIC)[0], currentDynamic = components(current, DYNAMIC)[0];
    if (oldDynamic && JSON.stringify(oldDynamic) !== JSON.stringify(currentDynamic)) fail('Bestehende dynamische Einlagerungsoption wurde verändert: ' + row.name);
    summary.targets++; summary[kind === 'station' ? 'stations' : 'normalChests']++; summary.classificationSources[classificationSource]++;
    const sample = { file: row.name, guid: row.guid, name: doc.name, kind, classificationSource, recipeProven: proof.length > 0, itemGuids: proof.map(item => item.itemGuid), recipeGuids: [...new Set(proof.flatMap(item => item.recipes.map(recipe => recipe.recipeGuid)))], before: stock ? stock.$value : null, after: stock ? stock.$value : { canReceiveAreaDeposit: true }, added: !stock };
    summary.samples.push(sample);
    if (stock) { summary.alreadyPresent++; continue; }
    const patched = JSON.parse(JSON.stringify(current));
    patched.components.push({ $type: STOCK, $value: { canReceiveAreaDeposit: true } });
    pending.push({ destination, document: patched, sample });
  }
  if (!summary.normalChests || !summary.stations) fail('Die belegten normalen Kisten oder Produktionsstationen fehlen; diese Spielversion benötigt eine Prüfung.');
  summary.warnings.push(WARNING);
  if (ctx.logger && typeof ctx.logger.warn === 'function') ctx.logger.warn(WARNING);
  for (const entry of pending) {
    fs.mkdirSync(path.dirname(entry.destination), { recursive: true });
    fs.writeFileSync(entry.destination, JSON.stringify(entry.document, null, 2), 'utf8');
    summary.added++; summary.filesChanged++; summary.fieldsChanged++;
    if (typeof ctx.track === 'function') ctx.track(entry.destination, 'components.InventoryCraftingStock');
  }
  return summary;
}
module.exports = { apply, assertSchema, STOCK, DYNAMIC, WARNING, TYPES };
