Mod Studio 0.4.30 behebt einen Fehler der automatischen Update-Übernahme: Lange erzeugte Ressourcen unter Data/patches/jobs/.../modified konnten das Update schon vor dem Download abbrechen.

Die neue Version übernimmt Profile, Auswahl, Einstellungen, unbekannte Nutzerdaten, Sicherungen, Originalbasen, Zielzustände, Vorgangsmetadaten und Rücknahmedaten. Nur die sechs neu erzeugbaren Arbeitsordner game, unpacked, modified, verify, localization und bin unter eindeutig erkannten Patch-Jobs werden beim Update nicht erneut kopiert. Im bisherigen Studio wird nichts gelöscht. Laufende oder unterbrochene Archivvorgänge bleiben gesperrt. Die neue Version erstellt vor dem nächsten Patch eine frische Vorschau.

Benötigte Zielpfade werden vor dem Download geprüft. Unbekannte lange Nutzerdaten werden ausdrücklich nicht stillschweigend ausgelassen.

Falls eine bisherige Version schon mit der Pfadlängenmeldung abbricht: Studio schließen, den vollständigen Ordner einschließlich Data einmalig an einen kurzen Pfad verschieben (zum Beispiel H:\EMS) und dort erneut aktualisieren. Der alte Updater erhält die Korrektur erst nach diesem Update. Data nicht löschen.

Die Spielregeln und das Schema bleiben gegenüber 0.4.29 unverändert. Manager 0.15.33 und Spielerclient 0.16.17 unterstützen auch die neue Studio-Versionskennung; ältere bestätigte Pakete bleiben unterstützt. Alle Prüfungen laufen mit Testdateien im Hintergrund, ohne Spiel-, Server- oder Installerstart.
