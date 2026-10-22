'use strict';
/*
 * Enshrouded Mod Studio source-specific random-loot slots.
 * Own source code; does not alter or redistribute vendor bytecode.
 * Build1269579 reflection: RandomLootSlotCount.slotsMin/slotsMax are uint8,
 * editor range1..16. This changes random loot SLOT COUNTS, not item quantities.
 * Only exported resource JSON is accepted; archive installation belongs to caller.
 */
const fsDefault = require('fs');
const path = require('path');
const PREFIX = 'keen::ecs::';
const BAD_NAME = /(?:^|_)(?:test(?:ing)?|cheat|dummy|deprecated|donotplace|donotuse|placement|helper|fakeplayer|player|companion|old)(?:_|$)|automatedtesting/i;
const ENEMY_NAME = /^(?:Base_)?Enemy_/i;
const CHEST_NAME = /^(?:Base_)?LootChest_Random_/i;
function componentEntries(doc, shortName) {
  return doc.components.map((component, index) => ({ component, index }))
    .filter(entry => entry.component && entry.component.$type === PREFIX + shortName);
}
function single(doc, shortName) {
  const entries = componentEntries(doc, shortName);
  return entries.length === 1 && entries[0].component.$value && typeof entries[0].component.$value === 'object' ? entries[0] : null;
}
function classify(doc) {
  if (!doc || !Array.isArray(doc.components)) return null;
  const name = typeof doc.debugName === 'string' ? doc.debugName : doc.name;
  if (typeof name !== 'string' || BAD_NAME.test(name)) return null;
  const loot = single(doc, 'RandomLoot');
  const container = single(doc, 'RandomLootContainer');
  const slots = single(doc, 'RandomLootSlotCount');
  if (!loot || loot.component.$value.disableRandomLoot !== false || !container || !slots) return null;
  if (ENEMY_NAME.test(name) && componentEntries(doc, 'NetworkEnemy').length === 1) return { kind: 'enemy', name, slots };
  if (CHEST_NAME.test(name) && single(doc, 'InventorySetup')) return { kind: 'chest', name, slots };
  return null;
}
function enabledConfig(config) {
  const result = {};
  for (const kind of ['enemy', 'chest']) {
    const title = kind[0].toUpperCase() + kind.slice(1);
    const enabled = config['enable' + title + 'RandomSlotMultiplier'] === true;
    const value = config[kind + 'RandomSlotMultiplier'];
    if (enabled && (typeof value !== 'number' || !Number.isFinite(value) || value < 1 || value > 16)) {
      throw new Error(title + ' random loot slot multiplier must be a finite number between 1 and 16.');
    }
    result[kind] = enabled && value !== 1 ? value : null;
  }
  if (result.chest !== null && config.adjustChestRandomSlots === true) {
    throw new Error('Chest slot multiplier conflicts with adjustChestRandomSlots. Enable either the absolute chest slots or the multiplier.');
  }
  return result;
}
function supportedSlots(value) {
  return value && Number.isInteger(value.slotsMin) && Number.isInteger(value.slotsMax) &&
    value.slotsMin >= 1 && value.slotsMax >= value.slotsMin && value.slotsMax <= 16;
}
function inventoryCap(doc) {
  const caps = [16];
  for (const name of ['InventorySetup', 'InventorySetupOverwrite']) {
    const entries = componentEntries(doc, name);
    if (entries.length > 1) return null;
    if (!entries.length) continue;
    const value = entries[0].component.$value;
    if (!value || typeof value !== 'object') return null;
    const keys = name === 'InventorySetup' ? ['genericSlotCount', 'availableSlotCount'] : ['genericSlotCount'];
    for (const key of keys) {
      if (!Number.isInteger(value[key]) || value[key] <= 0) return null;
      caps.push(value[key]);
    }
  }
  return Math.min(...caps);
}
function apply(ctx, inputRoot, outputRoot) {
  if (!ctx || !ctx.config) throw new Error('Patch context with config is required.');
  const factors = enabledConfig(ctx.config);
  const summary = { filesChanged: 0, fieldsChanged: 0, eligible: { enemy: 0, chest: 0 }, changed: { enemy: 0, chest: 0 }, clampedFiles: 0, skippedFiles: 0, warnings: [], samples: [] };
  if (factors.enemy === null && factors.chest === null) return summary;
  const fs = ctx.fs || fsDefault;
  const inputDirectory = path.join(inputRoot, 'TemplateResource');
  const outputDirectory = path.join(outputRoot, 'TemplateResource');
  if (path.resolve(inputDirectory).toLowerCase() === path.resolve(outputDirectory).toLowerCase()) throw new Error('Input and output export directories must be different.');
  if (!fs.existsSync(inputDirectory)) throw new Error('TemplateResource export is missing; source-specific loot slots cannot be applied.');
  const pending = [];
  function warn(code, file, source, details) {
    const entry = { code, file, source, ...details };
    summary.warnings.push(entry);
    if (ctx.logger && typeof ctx.logger.warn === 'function') ctx.logger.warn('[Source loot slots] ' + JSON.stringify(entry));
  }
  for (const filename of fs.readdirSync(inputDirectory).filter(name => name.endsWith('.json')).sort()) {
    const original = JSON.parse(fs.readFileSync(path.join(inputDirectory, filename), 'utf8'));
    const source = classify(original);
    if (!source || factors[source.kind] === null) continue;
    summary.eligible[source.kind]++;
    const before = { slotsMin: source.slots.component.$value.slotsMin, slotsMax: source.slots.component.$value.slotsMax };
    if (!supportedSlots(before)) {
      summary.skippedFiles++;
      warn('unsupported-or-zero-slots', filename, source.kind, { name: source.name, slotsMin: before.slotsMin, slotsMax: before.slotsMax });
      continue;
    }
    const targetFile = path.join(outputDirectory, filename);
    const hasVendorOutput = fs.existsSync(targetFile);
    const current = hasVendorOutput ? JSON.parse(fs.readFileSync(targetFile, 'utf8')) : original;
    const currentSource = classify(current);
    if (!currentSource || currentSource.kind !== source.kind || currentSource.name !== source.name || current.$guid !== original.$guid) {
      throw new Error('Output resource classification differs from original: ' + filename);
    }
    const currentSlots = currentSource.slots.component.$value;
    // This handler owns these two fields. Unknown competing edits fail closed.
    const intendedFactor = factors[source.kind];
    const cap = inventoryCap(current);
    if (cap === null || cap < before.slotsMax) {
      summary.skippedFiles++;
      warn('invalid-or-insufficient-inventory-capacity', filename, source.kind, { name: source.name, cap, slotsMax: before.slotsMax });
      continue;
    }
    const wantedMin = Math.max(1, Math.round(before.slotsMin * intendedFactor));
    const wantedMax = Math.max(wantedMin, Math.round(before.slotsMax * intendedFactor));
    const after = { slotsMin: Math.min(cap, wantedMin), slotsMax: Math.min(cap, wantedMax) };
    if ((currentSlots.slotsMin !== before.slotsMin || currentSlots.slotsMax !== before.slotsMax) &&
        (currentSlots.slotsMin !== after.slotsMin || currentSlots.slotsMax !== after.slotsMax)) {
      throw new Error('Another patch changed random loot slots in ' + filename + '; refusing to combine incompatible values.');
    }
    if (wantedMin > cap || wantedMax > cap) {
      summary.clampedFiles++;
      warn('slot-count-clamped', filename, source.kind, { name: source.name, cap, requested: { slotsMin: wantedMin, slotsMax: wantedMax }, applied: after });
    }
    let fields = 0;
    for (const field of ['slotsMin', 'slotsMax']) {
      if (currentSlots[field] === after[field]) continue;
      const oldValue = currentSlots[field];
      currentSlots[field] = after[field];
      fields++;
      if (typeof ctx.track === 'function') ctx.track(filename, 'enableSourceLootSlots', 'components[' + currentSource.slots.index + '].$value.' + field, oldValue, after[field]);
    }
    if (!fields) continue;
    summary.fieldsChanged += fields;
    summary.changed[source.kind]++;
    if (summary.samples.length < 12) summary.samples.push({ file: filename, name: source.name, source: source.kind, factor: intendedFactor, before: { slotsMin: before.slotsMin, slotsMax: before.slotsMax }, after, cap, mergedVendorOutput: hasVendorOutput });
    pending.push({ file: targetFile, text: JSON.stringify(current, null, 2) });
  }
  // Parse/classification/conflict checks finish before the first output write.
  if (pending.length) fs.mkdirSync(outputDirectory, { recursive: true });
  for (const entry of pending) fs.writeFileSync(entry.file, entry.text, 'utf8');
  summary.filesChanged = pending.length;
  return summary;
}
module.exports = { apply, classify, enabledConfig };


