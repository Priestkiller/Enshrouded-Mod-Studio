# Enshrouded Mod Studio 0.4.38

Windows-Programm für lokale Profile, geprüfte Datenpatches und die automatische Verteilung an Enshrouded-Spielerclients. Unterstützter Spielbuild: **1283531 / Enshrouded 1.0.1.0**.

## Neu: Ssarikk und eigene Draki-Bilder

Der Drak-Handwerker **Ssarikk**, der Speerkrieger, der Chakramjäger und der Magier erhalten vier unterschiedliche Bilder. Ssarikk verwendet das native Gesprächsmenü mit vier Themen: Herkunft, Beschwörung, Gefährten und Herstellung. Die Texte erzählen eine eigene Mod-Geschichte: Ssarikk hilft freiwillig, und das Rufzeichen im Beschwörungsstab weist ihm den Weg zum Flammenaltar. Die Geschichte ist keine offizielle Enshrouded-Lore.

Die Gesprächsanzeige über dem Kopf ist eine Testfunktion. Dialog, Anzeige und neue Bilder werden anhand der erzeugten Archive geprüft; ihr Verhalten im Spiel muss separat getestet werden. Es gibt keine neue Sprachausgabe. Der vorherige Absturz beim Beschwören ist nach erneutem Synchronisieren laut Spieltest des Nutzers behoben.

**Für die neuen Bilder und Gespräche:** Manager **0.15.52** und Spielerclient **0.16.32** installieren, den Server mit Studio **0.4.38** erneut patchen und neu starten. Anschließend synchronisieren alle Spieler bei geschlossenem Spiel. Ein vorheriges Paket enthält die neuen Inhalte noch nicht.

[Aktuelle Windows-Version herunterladen](https://github.com/Priestkiller/Enshrouded-Mod-Studio/releases/latest)

## In drei Schritten zu allen Spielern

1. **Studio patcht:** Den vom UGSM Manager verwalteten Server-Installationsordner wählen. Einstellungen prüfen, Server stoppen und **Patch anwenden / aktualisieren** ausführen.
2. **Manager übernimmt:** Studio erstellt aus der vorhandenen Serverbasis das Änderungsrezept. Der Manager prüft die Übergabe und stellt sie den Spielern bereit. Den Server mit den neuen Daten neu starten.
3. **Spieler synchronisieren:** Bei geschlossenem Spiel **Synchronisieren** wählen. Der Spielerclient verarbeitet seine eigenen Originaldateien auf Arbeitskopien und installiert erst nach erfolgreicher Prüfung. Danach separat **Spiel starten** anklicken.

Auf dem Server ist keine zusätzliche Spielclientinstallation erforderlich. Clientoriginale werden nicht hochgeladen. Server und Spieler müssen denselben unterstützten Spielbuild verwenden. Ältere freigegebene Pakete behalten ihre eigenen Prüfverträge; sie werden durch ein Programmupdate nicht zu neuen Paketen umgedeutet.

[Einrichtung](CLIENTPAKETE.txt) · [Schnittstelle](SERVERMANAGER-CLIENTPAKETE.md)

## Installieren und aktualisieren

Für eine normale Windows-Installation die **Enshrouded-Mod-Studio-0.4.38-Setup.exe** verwenden. Das Setup erstellt Startmenü-Eintrag und Deinstallation. Ein vorhandener portabler Studioordner kann zur Übernahme von Profilen und Einstellungen gewählt werden. Das vollständige ZIP bleibt als portable Variante verfügbar. Benötigt werden Windows x64 und .NET Framework 4.8.

Beim Start prüft Studio auf Programmupdates und zeigt die Änderungen vor der Installation an. Updates können verschoben oder in den Werkzeugen abgeschaltet werden. Ein Programmupdate übernimmt Einstellungen; den Spielpatch startet weiterhin **Patch anwenden / aktualisieren**. [Updateanleitung](UPDATES.txt)

Bei einer frischen Einrichtung **Patcher einrichten** wählen und das selbst beschaffte Original-Patcher-ZIP 1.2.3 oder dessen EXE mit passendem Parser auswählen. **Altes Setup übernehmen** ist nur für den Umzug vorhandener Daten gedacht. Die ursprüngliche Patcher-EXE, ihr Bytecode und der Legacy-Parser sind im öffentlichen Paket nicht enthalten. EMM liegt mit GPL-Lizenz und zugehörigem Quelltext separat bei. [Herkunft](THIRD-PARTY.md)

Nach einem Spielupdate zuerst die aktuellen Dateien über Steam prüfen und die neue Basis freigeben. Alte Archive nicht auf einen neuen Spielbuild zurückspielen. Bereits gepatchte Dateien werden ohne passende Originalbasis vor dem Modifizieren abgewiesen. [Basiswechsel](ERSTINSTALLATION.txt)

## Funktionen und Prüfstand

Profile enthalten Spieler- und Gegenstandswerte, Herstellungsmenge und Zeiten, Tierproduktion, Zähmung, Nutztierzucht, Begleiterzauber, Nachtpflanzen und den Drak-Handwerker. Erklärungen und Grenzen stehen direkt an den Optionen und in [EINSTELLUNGEN.txt](EINSTELLUNGEN.txt).

Hintergrundtests prüfen berechnete Werte, unveränderte Nachbarfelder, Archiv-Readback und die Rekonstruktion im Spielerclient. Sie bestätigen keine unbeobachtete Spielwirkung. Ein erfolgreicher Herstellungstest des Nutzers bestätigt die Ausgabe von vier Rüstungsteilen bei Faktor 4; daraus folgt keine Bestätigung aller anderen Optionen.

Die Punkteoption bewertet den Levelanteil als **(Level − 1) × Punktewert**. Ein geänderter Wurzelfaktor kann bekannte Belohnungen neu bewerten. Der erste tatsächliche Punktezuwachs nach einem Patch kann deshalb größer ausfallen als der eingestellte Wert pro weiterem Level. [Punkte erklären und prüfen](SKILLPUNKTE.txt)

Der Materialzugriff aus normalen Kisten und Stationsinventaren sowie das tatsächliche Aufsammeln durch Autoloot bleiben gesondert im Spiel zu prüfen. Leichen- und Behälterinventare werden durch die Bodenbeute-Option nicht automatisch geleert. [Lagerbefund](LAGERZUGRIFF.txt) · [Prüfbericht](PRUEFBERICHT.txt)

## Selbst bauen

Der Build über source/build.ps1 verwendet den Windows-Compiler für .NET Framework 4.8. Portable Tests benötigen keine laufende Spielinstallation. Eigene Profile, Runtime-Dateien, Spielarchive, Spielstände und Sicherungen gehören nicht ins öffentliche Repository oder ZIP.

Unabhängiges Projekt. Enshrouded und Fremdwerkzeuge gehören ihren jeweiligen Rechteinhabern.