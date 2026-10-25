# Externe Laufzeitdateien

## Ursprünglicher Patcher und Legacy-Parser

Das Repository und das öffentliche Studio-ZIP enthalten weder `engine/enshrouded-patcher.exe` noch die ursprünglichen Module unter `engine/vendor/`. Auch der bisher verwendete `engine/bin/kfc-parser.exe` und seine Kompatibilitätsdatei werden nicht mitgeliefert. Spielarchive, exportierte Spielressourcen, Profile, aktive Einstellungen und Sicherungen sind ausgeschlossen.

Der Studio-Code verwendet diese Werkzeuge als getrennte Prozesse. **Altes Setup übernehmen** und die automatische Updateübernahme kopieren fehlende passende Laufzeitdateien aus einer vorhandenen vollständigen Installation und prüfen die erwarteten Dateihashes. Eigene aktuelle Studio-Module werden dadurch nicht mit älteren Dateien überschrieben. Die Vendor-Prüfsummen bleiben im Manifest enthalten, damit die übernommene Laufzeit geprüft werden kann.

Dem vorliegenden Original-Patcher-Paket lag kein Lizenztext für dessen EXE oder Bytecode bei. Deshalb wird für diese Dateien keine Lizenz oder allgemeine Weitergabeerlaubnis behauptet und keine öffentliche Kopie bereitgestellt.

Der vorhandene Legacy-Parser kennzeichnet sich als `cli-legacy 0.1.2 (KFC4 compat f9d45d8)`. Das unten beigelegte Quellarchiv für EMM 0.2.0 wird nicht als zugehöriger Quelltext dieses älteren Parser-Binaries ausgegeben. Der Legacy-Parser bleibt daher ebenfalls außerhalb des öffentlichen Pakets.

## Mitgeliefertes Offline-Sprachwerkzeug EMM

Das öffentliche Studio-ZIP enthält das unveränderte `engine/bin/emm.exe` aus dem Projekt [Brabb3l/kfc-parser](https://github.com/Brabb3l/kfc-parser), Veröffentlichung [v0.2.0](https://github.com/Brabb3l/kfc-parser/releases/tag/v0.2.0), Commit `16708594d686b030d909f2d835b199d879ea9ad8`.

Die zugehörige Workspace-Metadatei nennt `GPL-3.0-or-later`. Der Lizenztext liegt unter `ThirdParty/kfc-parser-GPL-3.0.txt`; der unveränderte zugehörige Quellstand mit Cargo.lock und Builddateien liegt daneben als `ThirdParty/kfc-parser-source-1670859.zip`. Die EMM-Binärdatei wird durch `crates/mod-manager-cli` gebaut. Herkunft und SHA256 sind zusätzlich in [ThirdParty/EMM-HERKUNFT.txt](ThirdParty/EMM-HERKUNFT.txt) festgehalten.

EMM dient ausschließlich als separater Offline-Prozess auf Arbeitskopien für Sprachinhalte. Aus diesem Projekt wird keine Runtime-DLL ins Spiel installiert. Diese Beigabe ändert die oben beschriebenen Ausschlüsse für den ursprünglichen Patcher und den Legacy-Parser nicht.

Die Hinweise übertragen keine Rechte an Enshrouded, dem ursprünglichen Patcher oder anderen Fremdkomponenten.
