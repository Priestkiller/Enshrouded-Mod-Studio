## Begleiterzauber mit geänderter Zauberzeit

Der Patch konnte beim Kontrolllesen eigener Skelettzauber abbrechen, wenn gleichzeitig die Zauberzeit verändert wurde. Beispiel: Faktor 0,2 erzeugt 0,4 Sekunden; das native Archiv speichert diesen Float32-Wert als 0,4000000059604645. Unsere exakte Inhaltsprüfung behandelte diese normale Rundung als Fehler.

Version 0.4.24 schreibt die betroffenen Werte neuer Begleiterzauber bereits vor dem Packen im nachgewiesenen nativen Format. Inhaltsprüfsummen, GUIDs, Ganzzahlen und Stapelprüfungen bleiben unverändert streng. Einstellungen müssen nicht zurückgesetzt werden.

Für die automatische Verteilung Manager 0.15.25 und Spielerclient 0.16.10 verwenden. Die bisherigen Studio-Versionen 0.4.22 und 0.4.23 bleiben unterstützt. Profile, Einstellungen und Einladungen bleiben erhalten.

Nach dem Update den bisherigen Patch erneut anwenden, die Clientpaketerstellung abwarten und im Spielerclient Synchronisieren & Spielen verwenden. Für diesen Fehler ist kein neuer Spielstand und kein Basiswechsel erforderlich.

Prüfungen: 21 gezielte Regressionstests unter Node 18 und Node 24 sowie 103 Prüfungen eines vollständigen Server-/Client-Patchlaufs auf isolierten Kopien. Das nach dem Protokoll rekonstruierte Profil umfasst 38 aktive Optionen einschließlich Dezimalfaktoren, Tieroptionen, Stapelgröße 65.000 und sechs Begleiterzaubern. Alle erzeugten Clientdateien wurden aus dem Paket exakt rekonstruiert; die Originaldateien blieben unverändert. Kein Spiel oder Desktopfenster wurde gestartet.

Windows x64 mit .NET Framework 4.8. Das öffentliche Paket übernimmt die ursprüngliche Patcher-Laufzeit aus einer vorhandenen vollständigen Installation. Die Korrektur bestätigt die verarbeiteten Dateien; bisher offene Spielmechaniken werden dadurch nicht als im Spiel funktionierend bestätigt.
