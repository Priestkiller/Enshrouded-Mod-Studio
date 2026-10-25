# Enshrouded Mod Studio 0.4.21

Windows-Oberfläche für lokale Profile und geprüfte Datenpatches für Enshrouded.

**[Aktuelle Windows-Version herunterladen](https://github.com/Priestkiller/Enshrouded-Mod-Studio/releases/latest)**

## Start und Einrichtung

1. Das vollständige Studio-ZIP in einen neuen, beschreibbaren Ordner entpacken. Benötigt Windows x64 mit .NET Framework 4.8.
2. `Enshrouded Mod Studio.exe` starten und **Altes Setup übernehmen** wählen. Den bisherigen vollständigen Mod-Studio-Ordner angeben; Profile, passende aktive Archivbasen und fehlende geprüfte Laufzeitdateien werden übernommen. Den alten Ordner mit seinen Sicherungen behalten.
3. Den richtigen Spielclient- oder Dedicated-Serverordner wählen, die Einstellungen prüfen und Spiel bzw. Server schließen.
4. **Patch anwenden / aktualisieren** ausführen. **Speichern** allein sichert nur das Profil.

Das öffentliche Paket enthält die Studio-Anwendung, eigene Quellen und das getrennte Offline-Sprachwerkzeug EMM samt Lizenz und zugehörigem Quelltext. Die ursprüngliche Patcher-EXE, deren Bytecode und der bisher verwendete Legacy-Parser werden aus einer vorhandenen vollständigen Installation übernommen und anhand erwarteter Dateihashes kontrolliert. Ohne diese passende Laufzeit lässt sich die Oberfläche öffnen, aber kein Spielpatch anwenden. Herkunft und Paketgrenzen: [THIRD-PARTY.md](THIRD-PARTY.md).

## Auf 0.4.21 aktualisieren

Ab Version 0.4.10 **Update prüfen** wählen und die angebotene Installation bestätigen. Das Studio prüft ZIP-Größe und SHA256, richtet die neue Version in einem eigenen Nachbarordner ein und übernimmt Profile mit IDs, Auswahl und Einstellungen sowie das gesamte `Data`-Verzeichnis mit Archivbasen, Sicherungen und Historie. Erst nach bestätigtem Start der neuen Anwendung schließt die bisherige Version. Der alte Ordner bleibt als Rückfall erhalten; bestehende Startlinks können nach erfolgreicher Übergabe zur neuen Version weiterleiten.

Version 0.4.9 lädt das ZIP über den Browser. Das alte Studio schließen, 0.4.21 vollständig in einen neuen Ordner entpacken und **Altes Setup übernehmen** ausführen. Alte Engine-Ordner nicht über die neue Version kopieren. Neue Optionen werden bei übernommenen Profilen ausgeschaltet ergänzt. Ein Tool-Update wendet kein Modprofil an und verändert keine Spielarchive. Nach dem Update die gewünschten neuen Optionen einstellen und erneut patchen. Einzelheiten: [UPDATES.txt](UPDATES.txt).

## Neu seit 0.4.11

- **Sechs Begleiterzauber hinzufügen**: Zauberskelett, Skelettkrieger, Eliteskelett, erloschener Magier, Skeletthund und Säbelzahntiger bei Alden Crowley. Gemeinsames Grundlimit, Dauer und Stärke; eigenes Tiger-Symbol. Für Mehrspieler müssen der Server und **alle** Spielclients denselben Spielbuild, Toolstand und dieselben Begleiterwerte anwenden. MP-Kennungen vergleichen. Der Server verteilt keine Dateien. Ein echter Mehrspielertest mit verbundenen Spielern steht aus. [Anleitung](MEHRSPIELER-BEGLEITER.txt).
- **Nutztier-Zucht beschleunigen**: Zuchttempo von 1 bis 20 und getrennte Basischance von 0 bis 100 Prozent; 0 behält die Originalchance. Die Funktion wurde vom Benutzer im Spiel bestätigt. Partner, Futter, Betten, Weltlimit und sonstige Zuchtregeln bleiben erforderlich. [Details](TIERZUCHT.txt).
- Speicherprüfung vor Vorbereitung und Archivtausch sowie Bereinigung großer abgeschlossener Arbeitskopien. Aktive Vorschauen und Wiederherstellungsdaten bleiben geschützt. [Details](SPEICHERPLATZ.txt).
- Rein lesende Lagerdiagnose für Serverarchive. Die Diagnose behebt den gemeldeten Materialzugriff nicht. [Anleitung](LAGER-DIAGNOSE-ANLEITUNG.txt).

## Prüfstand und offene Punkte

88 gezielte Prüfungen zur Begleiteränderung bestanden. Zusätzlich wurden echte Client- und Serverarchive auf eigenen Arbeitskopien gepackt und zurückgelesen: neun gemeinsame neue Ressourcen sind auf beiden Rollen identisch; Clientmenü, Texte und Symbole sind separat geprüft. Das bestätigt den erstellten Datenstand. Besitzerzuordnung, Folge-KI, Zielwahl, Schaden, Gruppenlimit und Reconnect mit mehreren Spielern bleiben im laufenden Mehrspieler zu prüfen. [Prüfbericht](PRUEFBERICHT.txt).

Der gemeldete **Lagerzugriff aus normalen Kisten und Stationsinventaren ist weiterhin nicht behoben**. Vorhandene Archivmarker beweisen keinen funktionierenden Materialverbrauch. [Befund](LAGERZUGRIFF.txt).

**Ein Servermod, der allen Spielern mit unveränderten Clients automatisch vier Fertigkeitspunkte je Level vergibt, ist nicht enthalten.** Die bestehende Archivoption und ihre Prüffunktionen bleiben verfügbar. Ein Serverarchivwert belegt keine Verteilung an entfernte Clients. [Fertigkeitsbefund](PUNKTE-SERVERMOD.txt).

Weitere Profiloptionen umfassen Tierproduktion, einen erfolgreichen Zähmungsschritt, Spieler- und Gegenstandswerte sowie Komforteinstellungen. Erklärungen, Beispiele und Grenzen stehen an den Einstellungen und in [EINSTELLUNGEN.txt](EINSTELLUNGEN.txt). Prüfhinweise jeder Option gelten weiterhin; Archivprüfungen ersetzen keine Spieltests.

## Selbst bauen

```powershell
./source/build.ps1
```

Der Build verwendet den Windows-Compiler für .NET Framework 4.8. Auch ein selbst erstellter Build benötigt die getrennte Patcher-Laufzeit. Profile, Spielarchive, Spielstände, Sicherungen und exportierte Spielressourcen gehören nicht in das Repository oder öffentliche Paket.

Dies ist ein unabhängiges Projekt. Enshrouded und die Fremdwerkzeuge gehören ihren jeweiligen Rechteinhabern. Nach einem Enshrouded-Spielupdate weiterhin den geführten Basiswechsel verwenden; eine frühere Archivbasis nicht auf eine neue Spielversion spielen.
