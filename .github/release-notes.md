## Automatisch vom Studio zum Spielerclient

Mod Studio 0.4.25 übergibt passende Clientpakete direkt an UGSM Manager 0.15.26. Der Manager benötigt dafür keinen Zugriff auf den privaten Studio- oder Desktopordner. Spielerclient 0.16.11 übernimmt die veröffentlichten Änderungen über die bestehende Verbindung.

1. **Studio patcht:** Im Studio den vom Manager verwalteten Server-Installationsordner wählen und **Patch anwenden / aktualisieren** ausführen. Studio erkennt die Managerbindung und baut nach dem erfolgreichen Patch die passenden Clientdaten.
2. **Manager übernimmt:** Der Manager prüft die lokale Übergabe, den angewendeten Serverplan und die Paketdateien. Server anschließend mit den neuen Daten neu starten.
3. **Spieler synchronisieren:** Mitspieler wählen **Synchronisieren & Spielen**. Benötigte Clientänderungen werden geprüft, heruntergeladen und mit Sicherung des vorherigen Standes installiert.

Studio benötigt eine **bereits auf dem Serverrechner vorhandene, getrennte Clientinstallation desselben Spielbuilds**. Eine gültige bisherige Einstellung hat Vorrang; ansonsten sucht Studio im Benutzerkontext in gespeicherten Profilen und Steam-Bibliotheken. Fehlende oder mehrdeutige Treffer werden klar gemeldet. Es gibt keinen Upload von Spielerdateien zum Server und keine Verteilung umbenannter Serverarchive als Clientdaten.

Die feste Ablage im verwalteten Installationsordner enthält minimale gehashte Prüfnachweise. Vorbereitung, Fehler, fehlende Basis und Wiederherstellung haben getrennte Statusmeldungen. Aktuelle und vorherige eigene Pakete sowie zwei eigene Prüfnachweise werden aufbewahrt; unbekannte Daten bleiben geschützt. Bisherige manuelle Verbindungen bleiben möglich.

Profile, Einstellungen, Einladungen und Sicherungen bleiben erhalten. Das Tool-Update allein wendet kein Modprofil an. Für die automatische Übergabe alle drei Programme auf den genannten Stand bringen.

Hintergrundprüfung: 20 gezielte Studio-Prüfgruppen, vier portable Export-/Manager-/Client-Vertragstests für Studio 0.4.22 bis 0.4.25 und 107 Prüfungen des vollständigen Patchlaufs auf isolierten Spieldatenkopien. Die erzeugten Clientdateien wurden exakt rekonstruiert. Kein Spiel und kein Desktopfenster wurde gestartet. Eine echte Junction-Erzeugung war in der Testumgebung gesperrt; die Ablehnungslogik wurde über einen Testzugang geprüft. Dateiprüfungen bestätigen keine bislang unbestätigten Spielmechaniken.

Windows x64 mit .NET Framework 4.8. Das öffentliche ZIP enthält keine ursprüngliche Patcher-Runtime und keine Spieldaten. Die geprüfte Runtime wird über **Altes Setup übernehmen** aus einer vorhandenen vollständigen Installation übernommen. EMM liegt mit GPL-Lizenz und zugehörigem Quelltext separat bei.
