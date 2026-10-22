# Enshrouded Mod Studio

Windows-Oberfläche für lokale Modprofile und geprüfte Datenpatches für Enshrouded.

**[Aktuelle Windows-Version herunterladen](https://github.com/Priestkiller/Enshrouded-Mod-Studio/releases/latest)**

## Starten

1. Das Studio-ZIP vollständig in einen neuen, beschreibbaren Ordner entpacken.
2. `Enshrouded Mod Studio.exe` starten. Benötigt Windows x64 mit .NET Framework 4.8.
3. **Altes Setup übernehmen** wählen und den bisherigen Mod-Studio-Ordner auswählen. Dabei werden Profile, passende Ausgangsbasen und fehlende, anhand ihrer Prüfsummen kontrollierte Laufzeitdateien übernommen.
4. Den richtigen Spielclient- oder Dedicated-Serverordner wählen.
5. Optionen einstellen, Spiel bzw. Server schließen und **Patch anwenden / aktualisieren** drücken.

Das öffentliche Paket enthält unseren Studio-Code und die Studio-Anwendung. Die Laufzeitdateien des ursprünglichen Patchers 1.2.3 werden aus einer vorhandenen Installation übernommen. Sie sind nicht Bestandteil dieses öffentlichen Downloads. Ohne diese Laufzeitdateien kann die Oberfläche geöffnet, aber kein Spielpatch angewendet werden.

## Funktionen

- 44 Optionen mit Erklärungen, Beispielen und Grenzen direkt an der Einstellung.
- Profile, Suche, Ein-/Ausschalten und Validierung von Zahlenwerten.
- **Tiere beim ersten Erfolg zähmen** unter **Welt & Bauen**: setzt die benötigte Zahl erfolgreicher Zähmungsschritte auf einen. Köder, Annäherung und erfolgreiches Streicheln bleiben nötig.
- **Update prüfen · 0.4.9** prüft die neueste stabile Veröffentlichung dieses Repositorys. Ein Update öffnet das passende Studio-ZIP im Browser. Danach in einen neuen Ordner entpacken und das alte Setup übernehmen.
- Patches werden aus einer gespeicherten Ausgangsbasis vorbereitet und nach dem Packen erneut ausgelesen. Nach einem Spielupdate ist eine neue passende Basis nötig.

**Prüfumfang:** Die Zähmungsänderung ist für Revision 1273043 in Client- und Serverarchiven bestätigt: 18 passende Vorlagen, davon 15 geänderte und drei bereits auf einem Schritt. Der tatsächliche Abschluss samt Besitzübernahme und Multiplayer-Abgleich ist noch nicht im Spiel bestätigt. Für einen kontrollierten Mehrspielertest dieselbe Option auf Server und beteiligten Clients anwenden und neu starten.

Die sichtbaren Prüfhinweise jeder Option sind maßgeblich. Archivprüfungen und automatische Oberflächentests ersetzen keine Spieltests.

## Bauen

```powershell
./source/build.ps1
```

Der Build verwendet den Windows-Compiler für .NET Framework 4.8. Die externen Laufzeitdateien sind auch für einen selbst erstellten Build separat erforderlich. Eigene Profile, Spielarchive, Sicherungen und aus dem Spiel exportierte Ressourcen werden nicht im Repository gespeichert.

## Hinweise

- `Speichern` sichert nur das Profil. Erst `Patch anwenden / aktualisieren` ändert die gewählte Installation.
- Auf einem anderen Rechner betriebene Server benötigen dort den Patch; eine Clientänderung verändert keine entfernten Serverdateien.
- Daten und Sicherungen unter `Data` aufbewahren. Das Tool installiert Updates nicht selbst und überschreibt keine laufende Installation.
- Dies ist ein unabhängiges Projekt. Enshrouded und die genannten Fremdwerkzeuge gehören ihren jeweiligen Rechteinhabern.
- Herkunft und Grenzen der externen Laufzeit: [THIRD-PARTY.md](THIRD-PARTY.md).
