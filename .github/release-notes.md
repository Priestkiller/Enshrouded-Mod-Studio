## Erstinstallation ohne alten Studioordner

Mod Studio 0.4.26 enthält den getrennten Weg **Patcher einrichten**. Das selbst beschaffte Originalpaket **1.2.3** von KenUaena als ZIP oder die EXE mit passendem Custom-Parser auswählen. Die Einrichtung liest den PKG-Snapshot als Daten und ergänzt ausschließlich die fest hashgeprüften Programmdateien. Sie führt das Originalprogramm nicht aus und übernimmt keine Profile, Archivbasen oder Spieldateien. Ein alter Studioordner ist nicht erforderlich. Eine bereits vollständig geprüfte Runtime meldet **Patcher ist bereits eingerichtet**.

**Altes Setup übernehmen** bleibt zum freiwilligen Umziehen vorhandener Profile und Archivbasen erhalten. Andere Original-Patcher-Versionen werden nicht ungeprüft akzeptiert. Die offizielle Downloadseite kann eine neuere, noch nicht unterstützte Version anbieten.

## Bereits gepatchte Serverarchive sicher behandeln

Eine neue Studioinstallation darf bereits veränderte Serverarchive nicht nochmals als Originalbasis verwenden. Ohne geeignete unveränderte Ausgangsbasis bricht Studio jetzt vor dem Modifizieren mit einem verständlichen Hinweis ab. Damit werden doppelte Faktoren und doppelte Begleiterregistrierungen verhindert.

Falls eine eigene private Originalreferenz für exakt denselben Dedicated-Serverstand vorhanden ist, kann Studio sie anhand von Server-EXE und Archivprüfsummen als Basis übernehmen. Vorhandener Studiozustand wird nicht ersetzt; eine Referenz für eine andere Serverversion wird abgelehnt. Das öffentliche Paket enthält **keine** solche Originalreferenz. Für einen frischen öffentlichen Aufbau unveränderte Spieldateien verwenden oder die eigene passende Basis übernehmen. Eine alte Basis niemals auf eine neue Spielversion zurückspielen.

## Studio → Manager → Spielerclient

Die automatische lokale Übergabe bleibt enthalten. Für diesen Stand **UGSM Manager 0.15.28** und **Spielerclient 0.16.13** verwenden:

1. Im Studio den vom Manager verwalteten Serverordner wählen und **Patch anwenden / aktualisieren** ausführen.
2. Der Manager prüft und übernimmt das passende Clientpaket. Den Server mit den neuen Daten neu starten.
3. Mitspieler wählen **Synchronisieren & Spielen**, um die geprüften Änderungen zu installieren.

Für Serverpakete benötigt Studio weiterhin eine bereits auf demselben Rechner vorhandene getrennte Clientinstallation desselben Spielbuilds. Eine gültige bisherige Einstellung hat Vorrang; ansonsten sucht Studio in gespeicherten Profilen und Steam-Bibliotheken. Fehlende oder mehrdeutige Treffer werden gemeldet. Es gibt keinen Upload von Spielerdateien und keine Verteilung umbenannter Serverarchive als Clientdaten.

## Geprüft und Paketinhalt

**80 native Hintergrundprüfungen** auf isolierten Kopien bestanden: Ohne Originalreferenz bleibt die bereits gepatchte Installation unverändert. Mit passender privater Referenz wurden alle **38 eingeschalteten Einstellungen**, **3661 Änderungen** und deren Kontrolllesen zweimal erfolgreich geprüft. Beide Läufe ergaben identische Inhalte aller **19141 gelesenen Ressourcen**; keine Faktorverdopplung und keine doppelten eigenen Items, Rezepte oder Magier-Arsenale. Alle 14 ursprünglichen Testeingaben blieben unverändert. Die Erstinstallation wurde zusätzlich mit synthetischen und echten lokalen Runtime-Dateien im Hintergrund geprüft. Kein Spiel, produktiver Server oder Desktopfenster wurde gestartet.

Das bestätigt den Dateipatch und seine Wiederholbarkeit. Ungeprüfte Spielmechaniken, der gemeldete Lagerzugriff und eine rein serverseitige Vergabe zusätzlicher Fähigkeitspunkte werden dadurch nicht als gelöst behauptet.

Windows x64 mit .NET Framework 4.8. Das öffentliche ZIP enthält die Studio-Anwendung, eigene Quellen sowie EMM mit GPL-Lizenz und zugehörigem Quelltext. Original-Patcher, Vendor-Bytecode, Legacy-Parser, Profile, Archivbasen und Spieldaten bleiben ausgeschlossen. Profile und Einstellungen bestehender Installationen bleiben beim Tool-Update erhalten; erst **Patch anwenden / aktualisieren** wendet das Modprofil an.
