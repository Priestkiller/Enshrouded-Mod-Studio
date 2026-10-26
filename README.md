# Enshrouded Mod Studio 0.4.25

Windows-Oberfläche für lokale Profile und geprüfte Datenpatches für Enshrouded.

**[Aktuelle Windows-Version herunterladen](https://github.com/Priestkiller/Enshrouded-Mod-Studio/releases/latest)**

## In drei Schritten zu allen Spielern

1. **Studio patcht:** Den vom UGSM Manager verwalteten Server-Installationsordner wählen, Einstellungen prüfen, Spiel bzw. Server schließen und **Patch anwenden / aktualisieren** ausführen.
2. **Manager übernimmt:** Studio erkennt die lokale Managerbindung und erstellt das passende Clientpaket. Manager **0.15.26** prüft und übernimmt die Übergabe automatisch. Den Server danach mit den neuen Daten neu starten.
3. **Spieler synchronisieren:** Mit Spielerclient **0.16.11** **Synchronisieren & Spielen** wählen. Der Client lädt geprüfte Änderungen, sichert den bisherigen Modstand und installiert die passenden Daten.

Studio benötigt für Serverpakete eine **bereits auf demselben Rechner vorhandene, getrennte Enshrouded-Clientinstallation desselben Spielbuilds**. Es verwendet zuerst eine gültige bisherige Studio-Einstellung und sucht ansonsten in gespeicherten Profilen sowie Steam-Bibliotheken. Bei fehlenden oder mehreren möglichen Installationen meldet Studio den Grund; die passende Basis kann weiterhin unter **Werkzeuge → Clientpaket für Servermanager** ausgewählt werden. Es werden keine Spieldateien von Spielern hochgeladen.

Die Übergabe liegt in einer festen reservierten Ablage des verwalteten Installationsordners. Der Manager benötigt keinen Zugriff auf den Desktop- oder privaten Studio-Datenordner. Er erhält minimale gehashte Prüfnachweise und veröffentlicht nur bestätigte Clientpakete. Serverarchive werden nicht als Clientarchive verteilt. Ältere manuelle Verbindungen bleiben unterstützt. [Einrichtung](CLIENTPAKETE.txt) · [Schnittstelle](SERVERMANAGER-CLIENTPAKETE.md).

## Installieren und aktualisieren

Das vollständige öffentliche ZIP in einen neuen beschreibbaren Ordner entpacken. Benötigt werden Windows x64 und .NET Framework 4.8. **Altes Setup übernehmen** importiert Profile, passende aktive Archivbasen und fehlende geprüfte Runtime-Dateien aus einer vorhandenen vollständigen Mod-Studio-Installation. Die ursprüngliche Patcher-EXE, deren Bytecode und der Legacy-Parser sind im öffentlichen Paket nicht enthalten. EMM liegt mit GPL-Lizenz und zugehörigem Quelltext separat bei. [Herkunft und Paketgrenzen](THIRD-PARTY.md).

Ab Studio 0.4.10 kann **Update prüfen** die angebotene Version installieren und vorhandene Daten übernehmen. Von 0.4.9 das ZIP manuell entpacken und **Altes Setup übernehmen** verwenden. Alte Engine-Ordner nicht über die neue Version kopieren. Ein Tool-Update speichert oder übernimmt Einstellungen; den Spielpatch startet **Patch anwenden / aktualisieren**. [Updateanleitung](UPDATES.txt).

## Funktionen und Prüfstand

Profile enthalten Spieler- und Gegenstandswerte, Tierproduktion, Zähmung, Nutztierzucht und sechs eigene Begleiterzauber bei Alden Crowley. Die Begleiterwerte müssen auf Server und allen Clients zueinander passen. Clientpakete können diese Dateistände verteilen. Erklärungen und Grenzen stehen an den Optionen und in [EINSTELLUNGEN.txt](EINSTELLUNGEN.txt).

Die Korrekturen aus 0.4.23 und 0.4.24 bleiben enthalten: Stapelgrößen können zusammen mit den sechs eigenen Begleitern verarbeitet werden; native 32-Bit-Gleitkommazahlen werden beim Kontrolllesen korrekt berücksichtigt. Hintergrundtests bestätigen erzeugte Archive und ihre exakte Rekonstruktion. Sie ersetzen keine Prüfung von Besitzerzuordnung, Folge-KI, Schaden oder anderen bislang unbestätigten Mechaniken im laufenden Mehrspieler. [Prüfbericht](PRUEFBERICHT.txt).

Der gemeldete Materialzugriff aus normalen Kisten und Stationsinventaren wird durch die Synchronisation nicht repariert. Ein Servermod, der ohne passende Clientänderungen allen Spielern automatisch vier Fähigkeitspunkte je Level gibt, ist nicht enthalten. [Lagerbefund](LAGERZUGRIFF.txt) · [Fähigkeitspunkte](PUNKTE-SERVERMOD.txt).

## Selbst bauen und Hintergrundtests

```powershell
./source/build.ps1
node tests/manager-handoff-tests.js
node tests/float-summon-tests.js
node tests/stack-summon-tests.js
```

Der Build verwendet den Windows-Compiler für .NET Framework 4.8. Die portablen Tests verwenden synthetische Dateien; sie benötigen keine laufende Spielinstallation. Eigene Profile, Runtime-Dateien, Spielarchive, Spielstände und Sicherungen gehören nicht ins öffentliche Repository oder ZIP.

Dies ist ein unabhängiges Projekt. Enshrouded und Fremdwerkzeuge gehören ihren jeweiligen Rechteinhabern. Nach Spielupdates weiterhin den geführten Basiswechsel verwenden; eine alte Archivbasis nicht auf eine neue Spielversion zurückspielen.
