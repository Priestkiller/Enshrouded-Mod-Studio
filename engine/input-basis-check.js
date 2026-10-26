'use strict';
// Detect a lost original basis before composing new patches. Existing generated
// resources are evidence of a modified input, not evidence of its old factors.
const fs = require('fs'), path = require('path');
const GEM_IDS = ['10f892be-2374-4d31-ae27-85e0a36f3853', 'ef0c170d-0653-4517-88a7-0c4c9aba8139'];
function required(resource, role) {
  const error = Error('Die Ausgangsbasis enthält bereits Mod-Studio-Beschwörungen (' + resource + '). Eine unveränderte Originalbasis fehlt; sonst würden einige Faktoren erneut angewendet. Verwende eine zur Spielversion passende Originalbasis oder lasse die Spieldateien über Steam prüfen. Es wurden keine Spieldateien geändert.');
  error.actionCode = 'unmodified_basis_required';
  error.reason = 'modified_input_without_original_basis';
  error.mismatchDetails = { resource, role, gameFilesChanged: false };
  return error;
}
function assertUnmodified({ input, reflection, role, config, createdKeys, fileSystem = fs }) {
  if (!['server', 'client'].includes(role)) return { checked: false };
  const types = new Map((reflection?.types || []).map(t => [t.qualifiedName, t]));
  const groups = new Map();
  for (const key of createdKeys) {
    const [type, id] = key.split('|');
    const folder = types.get(type)?.name || type.split('::').pop();
    if (!groups.has(folder)) groups.set(folder, new Set());
    groups.get(folder).add(id.toLowerCase());
  }
  for (const [folder, ids] of groups) {
    const directory = path.join(input, folder);
    if (!fileSystem.existsSync(directory)) continue;
    for (const file of fileSystem.readdirSync(directory)) {
      if (file.endsWith('.json') && ids.has(file.split('_')[0].toLowerCase())) throw required(file, role);
    }
  }
  if (config.world?.adjustSummonedCompanions?.enabled || config.world?.enableSkeletonSummoningSpells?.enabled) {
    const directory = path.join(input, types.get('keen::ecs::TemplateResource')?.name || 'TemplateResource');
    if (fileSystem.existsSync(directory)) {
      for (const file of fileSystem.readdirSync(directory).filter(f => GEM_IDS.some(id => f.toLowerCase().startsWith(id + '_')) && f.endsWith('.json'))) {
        const doc = JSON.parse(fileSystem.readFileSync(path.join(directory, file), 'utf8').replace(/^\uFEFF/, ''));
        if (doc.components?.some(c => c.$type === 'keen::ecs::SpawnLimit' && c.$value?.spawnLimitPool === 'Skeleton')) throw required(file, role);
      }
    }
  }
  return { checked: true, unmodifiedManagedResources: true };
}
module.exports = { assertUnmodified };
