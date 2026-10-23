# Enshrouded Mod Studio

Windows-Oberfläche für lokale Profile und geprüfte Datenpatches für Enshrouded.

**[Aktuelle Windows-Version herunterladen](https://github.com/Priestkiller/Enshrouded-Mod-Studio/releases/latest)**

## Zum ersten Mal starten

1. Das vollständige Studio-ZIP in einen neuen, beschreibbaren Ordner entpacken.
2. `Enshrouded Mod Studio.exe` starten. Benötigt Windows x64 mit .NET Framework 4.8.
3. **Altes Setup übernehmen** wählen und den bisherigen vollständigen Mod-Studio-Ordner auswählen. Profile, passende aktive Archivbasen und fehlende geprüfte Laufzeitdateien werden übernommen. Der alte Ordner bleibt erhalten.
4. Den richtigen Spielclient- oder Dedicated-Serverordner wählen.
5. Optionen einstellen, Spiel bzw. Server schließen und **Patch anwenden / aktualisieren** drücken.

Das öffentliche Paket enthält die Studio-Anwendung und unseren Quellcode. Die Laufzeitdateien des ursprünglichen Patchers 1.2.3 werden aus einer vorhandenen Installation übernommen und anhand ihrer erwarteten Prüfsummen kontrolliert. Sie liegen diesem öffentlichen Download nicht bei. Ohne passende Laufzeit kann die Oberfläche geöffnet, aber kein Spielpatch angewendet werden.

## Von 0.4.9 auf 0.4.10 wechseln

Version 0.4.9 besitzt noch keine automatische Installation. Dort **Update prüfen** verwenden, das ZIP im Browser herunterladen und das Studio schließen. Version 0.4.10 vollständig in einen neuen Ordner entpacken und **Altes Setup übernehmen** ausführen. Den alten Ordner mit seinen Sicherungen behalten. Alte Engine-Ordner nicht über die neue Version kopieren.

## Automatische Tool-Updates ab 0.4.10

Ab 0.4.10 kann eine angebotene neuere Studio-Version nach Bestätigung automatisch übernommen werden. Das Tool prüft die neueste stabile GitHub-Veröffentlichung und das passende vollständige ZIP. Es richtet die neue Version in einem eigenen Nachbarordner ein, übernimmt die vorhandenen Daten und startet sie. Erst wenn die neue Anwendung ihre geladenen Profile bestätigt, schließt das bisherige Studio.

Profile, das gesamte `Data`-Verzeichnis, Archivbasen, Sicherungen und die bereits vorhandene geprüfte private Laufzeit werden übernommen. Der alte Ordner bleibt als Rückfall erhalten. Ein alter Startlink leitet nach erfolgreicher Übergabe auf die neuere Anwendung weiter, sofern deren gespeicherte Prüfsumme noch stimmt. Eine Tool-Aktualisierung wendet kein Modprofil an und ändert keine Spielarchive. Bei einem Fehler sind Wiederherstellung und Protokoll maßgeblich; eine fehlgeschlagene Prüfung bedeutet nicht, dass die installierte Version aktuell ist. Einzelheiten: [UPDATES.txt](UPDATES.txt).

## Fertigkeitspunkte nur über den Server

**Eine automatische Vergabe an alle Spieler ausschließlich durch einen Serverpatch ist mit diesem Tool nicht unterstützt.** Der Archivwert ist keine bestätigte globale Spielwirkung. Die vorhandene Server-Settings-Struktur bietet dafür keinen Wert. [Offizielle FAQ](https://enshrouded.zendesk.com/hc/en-us/articles/16056312924957-Dedicated-Server-FAQ): Charakterfortschritt wird auf Clients gespeichert. Ein neuer nativer Synchronisationsmechanismus wäre gesondert zu entwickeln und im Mehrspieler zu prüfen.

## Funktionen

- 44 Optionen mit Erklärungen, Beispielen und Grenzen direkt an der Einstellung.
- Profile, Suche, Schalter und Validierung von Zahlenwerten.
- Fertigkeitspunkte: den tatsächlichen Wert der gewählten Clientdateien prüfen; ein Serverpatch verändert keine entfernte Clientinstallation.
- **Tiere beim ersten Erfolg zähmen** unter **Welt & Bauen** setzt die benötigte Zahl erfolgreicher Zähmungsschritte auf einen. Passender Köder, Annäherung und ein vollständiger erfolgreicher Vorgang bleiben erforderlich.
- Vorbereitung aus einer gespeicherten Ausgangsbasis, Rücklesen der gepackten Änderungen und geführter Basiswechsel nach einem Enshrouded-Spielupdate.

Die Prüfhinweise jeder Option sind maßgeblich. Archivprüfungen, Berechnungen und automatische Oberflächentests ersetzen keine Spieltests. Die tatsächliche Zähmung samt Besitzübertragung und Multiplayer-Abgleich bleibt ungeprüft.

## Bauen

```powershell
./source/build.ps1
```

Der Build verwendet den Windows-Compiler für .NET Framework 4.8. Auch für einen selbst erstellten Build ist die externe Patcher-Laufzeit separat erforderlich. Private Profile, Spielarchive, Sicherungen und exportierte Spielressourcen werden nicht im Repository gespeichert.

## Hinweise

- **Speichern** sichert das Profil. **Patch anwenden / aktualisieren** ändert die ausgewählte Spielinstallation.
- Ein Server auf einem anderen Rechner muss dort gepatcht werden. Ein lokaler Clientpatch verändert keine entfernten Serverdateien.
- Ein Tool-Update und ein Enshrouded-Spielupdate sind getrennte Vorgänge. Bei einer neuen Spielversion weiterhin eine passende Ausgangsbasis wählen.
- Dies ist ein unabhängiges Projekt. Enshrouded und die Fremdwerkzeuge gehören ihren jeweiligen Rechteinhabern.
- Für fremde EXE-/Bytecode-Dateien wird keine Weitergabe- oder Lizenzberechtigung behauptet. Herkunft und Grenzen: [THIRD-PARTY.md](THIRD-PARTY.md).
