# Enshrouded Mod Studio 0.4.31

Windows-Oberfläche für lokale Profile und geprüfte Datenpatches für Enshrouded.

Version 0.4.31 korrigiert zusätzliche Wertepfade: Ausdauerregeneration ändert den ursprünglichen Regenerationswert und dessen passende Begrenzung; Herstellungszahlen und Zeiten beachten ihre tatsächlichen nativen Zahlentypen. Axt-Holzschaden wird als ganze Zahl aus dem Originalwert berechnet. Eine Gegenstandshöchststufe unter der ursprünglichen Mindeststufe eines betroffenen Gegenstands wird vor der Anwendung abgewiesen. Die zugehörigen Hintergrundtests prüfen geänderte Werte, ausgeschaltete Optionen, unberührte Nachbarfelder und kombinierte Einstellungen. Sie bestätigen Datenberechnungen und Dateiprüfungen, keine unbeobachtete Spielwirkung.

Neu und zunächst ausgeschaltet: **Abladestationen: horizontalen Bereich vergrößern**. Der Faktor skaliert die vorhandene halbe Breite und Länge der bestätigten 16x16- und 24x24-Stationen aus deren Originaldaten. Faktor 2 ergibt rechnerisch die vierfache Grundfläche; Höhe, Versatz und Spieleraktivierung bleiben unverändert. Der native Ablauf ist dem AreaDepositEvent zugeordnet. Die tatsächliche Ablage und mögliche Laufzeitgrenzen sind noch im Spiel zu prüfen. Diese Option verändert weder Auto-Loot noch die Materialsuche magischer Kisten.

**Auto-Loot: generische Bodenbeute ergänzt.** Die bisher ausgelassene Vorlage für physisch ausgeworfene einzelne Zufallsgegenstände erhält bei eingeschalteter „Fallender und generischer Bodenbeute“ die drei bestehenden Aufhebe-Komponenten des nativen Beutefunkens. Radius und Zeitabstand stammen aus dem Profil. Die Gegenstandszuordnung, manuelle Interaktion und alle anderen Komponenten bleiben erhalten; beide nativen Spawner-Verbindungen und das Rücklesen werden geprüft. Die zusätzlichen 21 Hintergrundprüfungen bestätigen diese begrenzte Datenkorrektur. Das tatsächliche Aufsammeln bleibt im Spiel zu prüfen. **Leichen und Behälterinventare werden nicht automatisch geleert.** Die bereits unterstützten anderen Bodenbeutegruppen behalten ihre bisherigen Regeln.

**[Aktuelle Windows-Version herunterladen](https://github.com/Priestkiller/Enshrouded-Mod-Studio/releases/latest)**

## In drei Schritten zu allen Spielern

1. **Studio patcht:** Den vom UGSM Manager verwalteten Server-Installationsordner wählen, Einstellungen prüfen, Spiel bzw. Server schließen und **Patch anwenden / aktualisieren** ausführen.
2. **Manager übernimmt:** Studio erstellt das Änderungsrezept aus der vorhandenen Serverbasis. Manager **0.15.38** prüft und übernimmt die Übergabe automatisch. Den Server danach mit den neuen Daten neu starten und die Spielerfreigabe aktivieren.
3. **Spieler synchronisieren:** Mit Spielerclient **0.16.21** zuerst **Synchronisieren** wählen. Der Client lädt die Änderungen, verarbeitet seine eigenen Originaldateien auf Arbeitskopien und installiert erst nach erfolgreicher Prüfung. Danach **Spiel starten** anklicken. Der vorherige Modstand wird gesichert.

**Auf dem Server ist keine zusätzliche Spielclientinstallation erforderlich.** Die neue Standardmethode verwendet ausschließlich die vorhandene Serverbasis. Die Originaldateien der Spieler bleiben auf deren PCs; sie werden nicht hochgeladen. Server und Clients müssen denselben unterstützten Spielstand verwenden. Die bisherige Methode mit vorgefertigten Clientarchiven bleibt unter der eingeklappten erweiterten Einrichtung verfügbar.

Die Oberfläche trennt **Serverpatch**, **Änderungen bereitstellen** und **Spieler synchronisieren**. Ein erfolgreicher Serverpatch allein meldet keine fertige Verteilung. Der Manager erhält die geprüfte Übergabe über die reservierte Ablage im verwalteten Installationsordner; Desktop-Zugriffsrechte sind dafür nicht nötig. [Einrichtung](CLIENTPAKETE.txt) · [Schnittstelle](SERVERMANAGER-CLIENTPAKETE.md).

Die Punkteoption berechnet den gesamten Levelanteil als **(Level - 1) × Punktewert**. Auch bereits bekannte Wurzel- und Brunnenbelohnungen können mit einem geänderten Wurzelfaktor neu bewertet werden. Deshalb kann die erste Neuberechnung nach dem Patch einen größeren tatsächlichen Punktezuwachs ergeben; sie misst nicht allein den Zuwachs eines neuen Levels. Studio 0.4.30 berichtigt die bisherige irreführende Erklärung, dass nur künftige Wurzelbelohnungen betroffen seien. Die Archivwerte und Berechnungslogik bleiben gegenüber 0.4.28 unverändert. [Punkte erklären und prüfen](SKILLPUNKTE.txt).

Teilweise importierte Profile aktivieren keine fehlenden Mods automatisch. Vorhandene Zahlenwerte bleiben sichtbar und bearbeitbar. Eine neue native Obergrenze gilt beim Einschalten der betreffenden Option; ausgeschaltete Altwerte blockieren andere Patches nicht.

## Installieren und aktualisieren

Das vollständige öffentliche ZIP in einen neuen beschreibbaren Ordner entpacken. Benötigt werden Windows x64 und .NET Framework 4.8. Für die **Erstinstallation** zuerst **Patcher einrichten** wählen. Das selbst beschaffte Original-Patcher-ZIP 1.2.3 oder dessen EXE mit passendem Custom-Parser auswählen. Die Einrichtung prüft und ergänzt die Programmdateien; ein alter Studioordner, alte Profile oder Archivbasen sind nicht erforderlich. Ist die Runtime bereits vollständig und hashgeprüft eingerichtet, ist kein Originalpaket mehr nötig. **Altes Setup übernehmen** bleibt eine getrennte, optionale Funktion zum Umziehen vorhandener Profile und Archivbasen. Die ursprüngliche Patcher-EXE, deren Bytecode und der Legacy-Parser sind im öffentlichen Paket nicht enthalten. EMM liegt mit GPL-Lizenz und zugehörigem Quelltext separat bei. [Herkunft und Paketgrenzen](THIRD-PARTY.md).

Ab Studio 0.4.10 kann **Update prüfen** die angebotene Version installieren und vorhandene Daten übernehmen. Von 0.4.9 das ZIP manuell entpacken und **Altes Setup übernehmen** verwenden. Alte Engine-Ordner nicht über die neue Version kopieren. Ein Tool-Update speichert oder übernimmt Einstellungen; den Spielpatch startet **Patch anwenden / aktualisieren**. [Updateanleitung](UPDATES.txt).

Beim ersten Patch werden unveränderte aktuelle Spielarchive nach Bestätigung als Basis gesichert. Bereits gepatchte Archive werden ohne geeignete Originalbasis vor dem Modifizieren abgelehnt. Eine eigene private Originalreferenz für denselben Dedicated-Serverstand kann anhand von Server-EXE und Archivprüfsummen übernommen werden; vorhandener Studiozustand bleibt geschützt. Solche Spieldateien liegen nicht im öffentlichen Paket. Für eine frische Einrichtung saubere Dateien dieser Spielversion verwenden oder die eigene passende Basis übernehmen. [Erstinstallation und Basis](ERSTINSTALLATION.txt).

## Funktionen und Prüfstand

Profile enthalten Spieler- und Gegenstandswerte, Tierproduktion, Zähmung, Nutztierzucht und sechs eigene Begleiterzauber bei Alden Crowley. Die Begleiterwerte müssen auf Server und allen Clients zueinander passen. Clientpakete können diese Dateistände verteilen. Erklärungen und Grenzen stehen an den Optionen und in [EINSTELLUNGEN.txt](EINSTELLUNGEN.txt).

Die Korrekturen aus 0.4.23 und 0.4.24 bleiben enthalten: Stapelgrößen können zusammen mit den sechs eigenen Begleitern verarbeitet werden; native 32-Bit-Gleitkommazahlen werden beim Kontrolllesen korrekt berücksichtigt. Hintergrundtests bestätigen erzeugte Archive und ihre exakte Rekonstruktion. Sie ersetzen keine Prüfung von Besitzerzuordnung, Folge-KI, Schaden oder anderen bislang unbestätigten Mechaniken im laufenden Mehrspieler. [Prüfbericht](PRUEFBERICHT.txt).

Für 0.4.27 bestand der vollständige Transfer eines echten Serverprofils mit **38 eingeschalteten Optionen**: 3661 Serverressourcen wurden in ein Datenrezept übernommen. Der fest gebündelte Spielerclient-Worker erzeugte und kontrollierte 3669 Clientänderungen einschließlich Namen, Bildern und Herstellungsmenü der sechs Begleiterzauber. Alle 91827 KFC-Ressourcenidentitäten wurden geprüft; die Clientoriginale blieben unverändert. Sicherung, Wiederherstellung, Profilwechsel und die Kompatibilität mit bisherigen Paketen wurden zusätzlich geprüft. Kein Spiel oder produktiver Server wurde gestartet.

Der gemeldete Materialzugriff aus normalen Kisten und Stationsinventaren wird durch die Synchronisation nicht repariert. Ein Servermod, der ohne passende Clientänderungen allen Spielern automatisch vier Fähigkeitspunkte je Level gibt, ist nicht enthalten. [Lagerbefund](LAGERZUGRIFF.txt) · [Fähigkeitspunkte](PUNKTE-SERVERMOD.txt).

## Selbst bauen und Hintergrundtests

```powershell
./source/build.ps1
node tests/manager-handoff-tests.js
node tests/float-summon-tests.js
node tests/stack-summon-tests.js
node tests/input-basis-check-tests.js
```

Der Build verwendet den Windows-Compiler für .NET Framework 4.8. Die portablen Tests verwenden synthetische Dateien; sie benötigen keine laufende Spielinstallation. Eigene Profile, Runtime-Dateien, Spielarchive, Spielstände und Sicherungen gehören nicht ins öffentliche Repository oder ZIP.

Dies ist ein unabhängiges Projekt. Enshrouded und Fremdwerkzeuge gehören ihren jeweiligen Rechteinhabern. Nach Spielupdates weiterhin den geführten Basiswechsel verwenden; eine alte Archivbasis nicht auf eine neue Spielversion zurückspielen.

Update-Pfadfehler: Die Arbeitsdaten-Übernahme ist korrigiert. Details und die einmalige Abhilfe für alte Updater stehen in UPDATE-PFADHILFE.txt.
