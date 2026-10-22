'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');
const backend = require('./studio-backend');
const options = { root: __dirname, data: path.resolve(__dirname, '../Data/patches'), configPath: path.join(__dirname, 'config.json'), log: console.log };

function parseArgs(argv) {
  let mode = null, statusFile = null, expectedFingerprint = null, steamFilesVerified = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (['--update', '--preview', '--restore', '--inspect-basis', '--renew-basis', '--inspect-stacks'].includes(arg)) {
      if (mode) throw Error('Nur einen Vorgang angeben: --update, --preview, --restore, --inspect-basis, --renew-basis oder --inspect-stacks.');
      mode = arg.slice(2);
    } else if (arg === '--status-file') {
      if (statusFile !== null || !argv[i + 1] || argv[i + 1].startsWith('--')) throw Error('--status-file benötigt genau einen absoluten JSON-Dateipfad.');
      statusFile = argv[++i];
      if (!path.isAbsolute(statusFile) || path.extname(statusFile).toLowerCase() !== '.json') throw Error('--status-file muss ein absoluter Pfad zu einer JSON-Datei sein.');
    } else if (arg === '--expected-fingerprint') {
      if (expectedFingerprint !== null || !argv[i + 1] || !/^[a-f0-9]{64}$/i.test(argv[i + 1])) throw Error('--expected-fingerprint benötigt genau einen 64-stelligen SHA-256-Prüftoken.');
      expectedFingerprint = argv[++i].toLowerCase();
    } else if (arg === '--steam-files-verified') {
      if (steamFilesVerified) throw Error('--steam-files-verified wurde mehrfach angegeben.');
      steamFilesVerified = true;
    } else throw Error('Unbekanntes Argument: ' + arg);
  }
  if (statusFile && !mode) throw Error('--status-file benötigt einen Vorgang.');
  if (mode !== 'renew-basis' && (expectedFingerprint !== null || steamFilesVerified)) throw Error('Prüftoken und Steam-Bestätigung gelten nur zusammen mit --renew-basis.');
  if (mode === 'renew-basis' && (!expectedFingerprint || !steamFilesVerified)) throw Error('--renew-basis benötigt --expected-fingerprint und --steam-files-verified nach der vorherigen Prüfung.');
  return mode === 'renew-basis' ? { mode, statusFile, expectedFingerprint, steamFilesVerified } : { mode, statusFile };
}
function createStatusReporter(statusFile, emit) {
  const output = emit || (line => process.stdout.write(line + '\n'));
  return status => {
    const doc = { stage: status.stage, message: String(status.message), progress: Math.max(0, Math.min(100, status.progress || 0)), outcome: status.outcome || 'running', result: status.result || null, updatedAt: new Date().toISOString() };
    const encoded = JSON.stringify(doc);
    if (statusFile) {
      fs.mkdirSync(path.dirname(statusFile), { recursive: true });
      const temporary = statusFile + '.studio-' + crypto.randomBytes(6).toString('hex') + '.tmp';
      try {
        fs.writeFileSync(temporary, encoded, { encoding: 'utf8', flag: 'wx' });
        for (let attempt = 0; ; attempt++) {
          try { fs.renameSync(temporary, statusFile); break; }
          catch (error) {
            if (attempt >= 5 || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code)) throw error;
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 15);
          }
        }
      } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
    }
    output(encoded);
    return doc;
  };
}
function planSummary(plan, operation, applied) {
  const firstBasisInfo = plan.firstBasis ? 'Die erste Basis entspricht den aktuellen Archivdateien. Bereits enthaltene Mods sind Teil dieser Basis.' : 'Die unveränderte gespeicherte Basis dieser Spielversion wurde verwendet.';
  const warnings = [...(plan.mods?.warnings || [])];
  if (plan.firstBasis) warnings.unshift(firstBasisInfo);
  return { operation, applied, planId: plan.id, job: plan.job, target: plan.target.dir, build: plan.build, modifiedFiles: plan.modifiedFiles, verifiedFiles: plan.verifiedFiles, removedDataFiles: (plan.removedArtifacts || []).length, firstBasis: plan.firstBasis, firstBasisInfo, skillPoints: plan.mods?.skillPoints || null, stacks: plan.mods?.stacks || null, sharedStorage: plan.mods?.sharedStorage || null, taming: plan.mods?.taming || null, warnings };
}
async function runAutomatic(parsed, configuredOptions = options, api = backend, emit) {
  if (parsed.statusFile && path.resolve(parsed.statusFile).toLowerCase() === path.resolve(configuredOptions.configPath).toLowerCase()) throw Error('Die Statusdatei darf nicht die Profilkonfiguration überschreiben.');
  const rawStdout = process.stdout.write.bind(process.stdout);
  const report = createStatusReporter(parsed.statusFile, emit || (line => rawStdout(line + '\n')));
  const originalWrite = process.stdout.write;
  let applicationConfirmed = false;
  let finalResult = null;
  // Vendor diagnostics go to stderr; stdout is a stream of JSON status records.
  process.stdout.write = function (chunk, encoding, callback) { return process.stderr.write(chunk, encoding, callback); };
  const operationOptions = { ...configuredOptions, log: line => process.stderr.write(String(line) + '\n'), progress: event => report({ ...event, outcome: 'running' }) };
  try {
    report({ stage: 'starting', message: parsed.mode === 'update' ? 'Einstellungen prüfen und Spiel aktualisieren …' : 'Vorgang vorbereiten …', progress: 0 });
    if (parsed.mode === 'update') {
      const { plan, state } = await api.update(operationOptions);
      if (!plan.applied || state.lastJob !== plan.id) throw Error('Das Anwenden wurde nicht vollständig bestätigt. Prüfprotokoll kontrollieren.');
      applicationConfirmed = true;
      finalResult = planSummary(plan, 'update', true);
      const points = finalResult.skillPoints;
      const pointsInfo = points?.enabled && points.resources?.length ? ' Fertigkeitspunkte-Tabelle (' + (points.role === 'server' ? 'Server' : points.role === 'client' ? 'Client' : 'gewählter Ordner') + '): ' + points.resources.map(resource => resource.before + ' → ' + resource.after).join(', ') + ' im Archiv bestätigt.' : '';
      const stacks = finalResult.stacks;
      const stackInfo = stacks?.enabled && stacks.validated === true && stacks.archiveReadbackValidated === true ? ' Stapelgrößen (' + (stacks.role === 'server' ? 'Server' : stacks.role === 'client' ? 'Client' : 'gewählter Ordner') + '): ' + stacks.requested + ' je Stapel bei ' + stacks.stackableItems + ' stapelbaren Items im Archiv bestätigt.' : '';
      const taming = finalResult.taming;
      const tamingInfo = taming?.enabled && taming.archiveReadbackValidated === true ? ' Zähmung: 1 benötigter Erfolg bei ' + taming.targets + ' Tier-Vorlagen im Archiv bestätigt.' : '';
      report({ stage: 'complete', message: 'Geprüfte Archivdateien angewendet.' + pointsInfo + stackInfo + tamingInfo + ' Ein Test im Spiel steht noch aus.' + (plan.firstBasis ? ' ' + finalResult.firstBasisInfo : ''), progress: 100, outcome: 'success', result: finalResult });
    } else if (parsed.mode === 'preview') {
      const plan = await api.prepare(operationOptions);
      finalResult = planSummary(plan, 'preview', false);
      report({ stage: 'complete', message: 'Vorschau geprüft. Die Spielarchive wurden nicht geändert.', progress: 100, outcome: 'success', result: finalResult });
    } else if (parsed.mode === 'restore') {
      const state = await api.restore(operationOptions);
      applicationConfirmed = true;
      finalResult = { operation: 'restore', restored: true, basis: state.basis };
      report({ stage: 'complete', message: 'Gespeicherte Basis wiederhergestellt.', progress: 100, outcome: 'success', result: finalResult });
    } else if (parsed.mode === 'inspect-stacks') {
      finalResult = await api.inspectStacks(operationOptions);
      const role = finalResult.targetRole === 'server' ? 'Server' : 'Client';
      const comparison = finalResult.allMatch ? 'Alle ' + finalResult.stackableCount + ' stapelbaren Items entsprechen dem Profilwert ' + finalResult.requested + '.' : finalResult.matchingRequested + ' von ' + finalResult.stackableCount + ' stapelbaren Items entsprechen dem Profilwert ' + finalResult.requested + '.';
      report({ stage: 'complete', message: 'Aktuelle Stapelwerte (' + role + ', Build ' + finalResult.build + ') gelesen. ' + comparison + ' Spieldateien wurden nicht verändert.', progress: 100, outcome: 'success', result: finalResult });
    } else if (parsed.mode === 'inspect-basis') {
      finalResult = await api.inspectBasis(operationOptions);
      const messages = { version_changed: 'Spielupdate erkannt. Die alte Basis gehört zu einer anderen Version.', archives_changed: 'Geänderte Archive erkannt. Vor einer neuen Basis die aktuellen Dateien prüfen.', ready: 'Gespeicherte Basis und aktuelle Dateien passen zusammen.', first_basis: 'Für diesen Ordner ist noch keine Basis gespeichert.' };
      report({ stage: 'complete', message: messages[finalResult.kind] || 'Basisprüfung abgeschlossen.', progress: 100, outcome: 'success', result: finalResult });
    } else if (parsed.mode === 'renew-basis') {
      finalResult = await api.renewBasis({ ...operationOptions, expectedFingerprint: parsed.expectedFingerprint, steamFilesVerified: parsed.steamFilesVerified });
      applicationConfirmed = finalResult.renewed === true;
      report({ stage: 'complete', message: applicationConfirmed ? 'Neue Basis für die nächste Vorbereitung freigegeben. Alte Sicherungen bleiben erhalten; Spielarchive wurden nicht geändert.' : 'Eine neue Basisfreigabe ist nicht erforderlich. Keine Basis-Metadaten wurden zurückgesetzt.', progress: 100, outcome: 'success', result: finalResult });
    } else throw Error('Automatischer Vorgang fehlt.');
    return 0;
  } catch (error) {
    const message = (applicationConfirmed ? parsed.mode === 'renew-basis' ? 'Die neue Basis wurde freigegeben, aber die Abschlussmeldung ist fehlgeschlagen: ' : 'Änderungen wurden angewendet, aber die Abschlussmeldung ist fehlgeschlagen: ' : '') + error.message;
    const action = error.actionCode ? { actionCode: error.actionCode, reason: error.reason || null, mismatchDetails: error.mismatchDetails || null } : {};
    try { report({ stage: 'error', message, progress: applicationConfirmed ? 100 : 0, outcome: 'error', result: { operation: parsed.mode, applicationConfirmed, ...(finalResult || {}), ...action } }); }
    catch (statusError) { process.stderr.write('Status konnte nicht geschrieben werden: ' + statusError.message + '\n'); }
    process.stderr.write('FEHLER / VORGANG GESTOPPT: ' + message + '\n');
    return 1;
  } finally { process.stdout.write = originalWrite; }
}
async function interactive(configuredOptions = options) {
  console.log('\nENSHROUDED MOD STUDIO 0.4.9 · Engine 1.2.3\n');
  backend.verifyEngine(configuredOptions.root);
  const config = backend.read(configuredOptions.configPath), target = backend.target(config);
  backend.validate(config, configuredOptions.root);
  console.log((target.server ? 'Dedicated Server: ' : 'Client: ') + target.dir);
  console.log('Vorschau: arbeitet ausschließlich an Kopien. Anwenden: ersetzt geprüfte Spielarchive.');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = question => new Promise(resolve => rl.question(question, resolve));
  try {
    while (true) {
      console.log('\n1  Vorschau erstellen und Archive prüfen\n2  Geprüfte Vorschau ANWENDEN\n3  Gespeicherte Basis wiederherstellen\n4  Neue Basis aus aktuellen Dateien wählen (nach Spielupdate/Steam-Prüfung)\n5  Unterbrochenen Dateitausch zurücknehmen\n6  Aktuelle Stapelgrößen lesen (ohne Spieländerung)\n0  Beenden');
      const choice = (await ask('\nAuswahl: ')).trim();
      try {
        if (choice === '0') break;
        if (choice === '1') {
          const plan = await backend.prepare(configuredOptions);
          console.log('Ergebnis: ' + plan.modifiedFiles + ' geänderte / ' + plan.verifiedFiles + ' geprüfte Ressourcendateien.');
          console.log('Prüfprotokoll: ' + path.join(plan.job, 'plan.json'));
        } else if (choice === '2') {
          const plan = backend.latest(configuredOptions);
          if (!plan) throw Error('Zuerst eine Vorschau erstellen.');
          console.log('Vorschau ' + plan.id + ' · ' + plan.modifiedFiles + ' Dateien · ' + plan.build);
          if (plan.firstBasis) console.log('Die erste Basis entspricht dem aktuellen Datenstand. Enthaltene ältere Mods werden Teil dieser Basis.');
          if ((await ask('Diese geprüften Änderungen jetzt auf den gewählten Ordner anwenden? [ja/nein]: ')).trim().toLowerCase() === 'ja') backend.applyPlan(configuredOptions, plan);
        } else if (choice === '3') {
          if ((await ask('Gespeicherte Basis dieser Spielversion wiederherstellen? [ja/nein]: ')).trim().toLowerCase() === 'ja') { backend.restore(configuredOptions); console.log('Gespeicherte Basis wiederhergestellt.'); }
        } else if (choice === '4') {
          const inspection = backend.inspectBasis(configuredOptions);
          console.log('Geprüfter Zielordner: ' + inspection.targetDir + '\nErgebnis: ' + inspection.kind + '\nAktuelle EXE: ' + inspection.currentFingerprint.exe);
          for (const warning of inspection.warnings) console.log('HINWEIS: ' + warning);
          if (['ready', 'first_basis'].includes(inspection.kind)) { console.log('Keine neue Basisfreigabe erforderlich.'); continue; }
          console.log('Alte Sicherungen bleiben erhalten. Eine saubere Basis muss zuvor über Steam hergestellt werden. Das Tool kann diese Herkunft nicht unabhängig beweisen.');
          if ((await ask('Steam-Dateiprüfung für genau diesen Ordner abgeschlossen und neue Basis jetzt freigeben? [ja/nein]: ')).trim().toLowerCase() === 'ja') { backend.renewBasis({ ...configuredOptions, expectedFingerprint: inspection.fingerprintToken, steamFilesVerified: true }); console.log('Neue Basis freigegeben. Jetzt eine neue Vorschau erstellen.'); }
        } else if (choice === '5') console.log(backend.recover(configuredOptions) + ' unterbrochene Vorgänge zurückgenommen.');
        else if (choice === '6') { const result = backend.inspectStacks(configuredOptions); console.log(JSON.stringify(result, null, 2)); }
        else console.log('Bitte eine Zahl von 0 bis 6 eingeben.');
      } catch (error) { console.error('\nFEHLER / VORGANG GESTOPPT: ' + error.message); }
    }
  } finally { rl.close(); }
}
async function main(argv = process.argv.slice(2)) {
  const parsed = parseArgs(argv);
  return parsed.mode ? runAutomatic(parsed) : interactive();
}
if (require.main === module) main().then(code => { if (code) process.exitCode = code; }).catch(error => { console.error('FEHLER / VORGANG GESTOPPT: ' + error.message); process.exitCode = 1; });
module.exports = { parseArgs, createStatusReporter, planSummary, runAutomatic, interactive, main };
