'use strict';

// The vendor dispatcher omits ItemInfo when backpack slots are the only active
// ItemInfo feature. Reuse its handler once, preserving all other dispatch paths.
function apply(processor, config, input, output) {
  if (!processor || typeof processor.applyMods !== 'function')
    throw Error('Die Patcher-API zum Verarbeiten des Profils fehlt.');
  const backpack = config?.inventory?.enableHigherBackpackSlot?.enabled === true;
  const original = processor.processItemInfo;
  if (backpack && typeof original !== 'function')
    throw Error('Die Patcher-API für die Rucksack-Itemdaten fehlt. Bitte das vollständige Tool-Paket verwenden.');
  let itemInfoCalls = 0, fallback = false;
  if (backpack) processor.processItemInfo = function (...args) {
    itemInfoCalls++;
    return original.apply(this, args);
  };
  try {
    const result = processor.applyMods(input, output);
    if (result && result.success === false)
      throw Error(result.error || 'Engine konnte Mods nicht anwenden.');
    if (backpack && itemInfoCalls === 0) {
      original.call(processor, input, output);
      itemInfoCalls++;
      fallback = true;
    }
    if (result && typeof result === 'object')
      result.studioProcessorFixes = { backpackItemInfoFallback: fallback, itemInfoCalls };
    return result;
  } finally {
    if (backpack) processor.processItemInfo = original;
  }
}
module.exports = { apply };
