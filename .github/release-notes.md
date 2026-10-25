## Stapelgr��en und eigene Begleiterzauber gemeinsam patchen

Die Stapelpr�fung hat die sechs vom Studio neu angelegten Begleiterzauber als unbekannte Gegenst�nde abgewiesen. Dadurch wurde der gesamte Vorgang gestoppt. Version 0.4.23 erkennt ausschlie�lich die nachweislich von dieser Funktion erzeugten Zaubergegenst�nde. Die Pr�fungen f�r normale Gegenst�nde, Stapellimits und ver�nderte Archivdateien bleiben aktiv.

Nach einem erfolgreichen Patch wird das passende Clientpaket weiterhin automatisch erstellt. F�r die Verteilung **UGSM Manager 0.15.24** und **Spielerclient 0.16.9** verwenden; Studio 0.4.22 bleibt im Manager und Client unterst�tzt.

1. Die beteiligten Programme aktualisieren und das Spiel schlie�en.
2. Im Studio **Patch anwenden / aktualisieren** ausf�hren und die Fertigstellung des Clientpakets abwarten.
3. Im Spielerclient **Synchronisieren & Spielen** w�hlen.

Getestet im Hintergrund: 35 gezielte Regressionstests und 103 Pr�fungen mit echten Server-/Clientdateien auf isolierten Kopien, einschlie�lich Stapelgr��e 65.000, sechs eigenen Begleiterzaubern, Archivpr�fung und Clientpaket. Der Go-Client hat anschlie�end alle 75 erzeugten Dateien aus 260 gepr�ften Datenbl�cken exakt rekonstruiert. Kein Spiel oder Desktopfenster wurde gestartet.

## Download und Update

Windows x64 mit .NET Framework 4.8. Ab Studio 0.4.10 **Update pr�fen** verwenden. Profile und Einstellungen werden �bernommen. F�r eine manuelle Installation das vollst�ndige ZIP entpacken und **Altes Setup �bernehmen** w�hlen.

Das �ffentliche Paket enth�lt Anwendung, eigene Quellen und EMM mit Lizenz und zugeh�rigem Quelltext. Die urspr�ngliche Patcher-Laufzeit und der Legacy-Parser werden aus einer vorhandenen vollst�ndigen Installation �bernommen.

Die Pr�fungen best�tigen die installierten Dateien. Zus�tzliche F�higkeitspunkte ausschlie�lich �ber den Server, Lagerzugriff aus normalen Kisten/Werkb�nken und der echte Multiplayer-Spieltest der Begleiter sind dadurch weiterhin nicht als gel�st nachgewiesen.
