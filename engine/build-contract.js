'use strict';
// This release was inspected against this complete native reflection identity.
// A different game revision needs its own reviewed schema and source contract.
const BUILD = '1283531|^/game38/branches/release_1.0|2026-10-30T09:15:50.868196Z';
const REVISION = '1283531';
function assertBuild(build) {
  if (build !== BUILD) {
    const error = Error('Spielbuild wird von Mod Studio 0.4.36 nicht unterstützt. Ein passendes Studio-Update ist erforderlich. Geprüfter Build: ' + BUILD + '; erkannt: ' + String(build || 'unbekannt') + '.');
    error.actionCode = 'game_build_unsupported';
    error.reason = 'update_required';
    error.mismatchDetails = { expectedBuild: BUILD, actualBuild: build || null, gameFilesChanged: false };
    throw error;
  }
  return build;
}
function assertReflection(reflection) {
  assertBuild(reflection?.version);
  if (!Array.isArray(reflection.types)) throw Error('Frische Reflection für Spielbuild 1283531 fehlt.');
  return reflection;
}
module.exports = { BUILD, REVISION, assertBuild, assertReflection };
