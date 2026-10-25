## Automatische Clientpakete nach erfolgreichem Patch

Das Mod Studio erstellt jetzt nach einem erfolgreich angewendeten und überprüften Patch automatisch ein passendes Clientpaket für den Servermanager.

- Einmalige Einrichtung unter **Werkzeuge → Clientpaket für Servermanager**: Ausgabeordner und für Serverpatches eine vollständige Clientbasis mit demselben Spielbuild wählen. Diese Clientinstallation wird nur gelesen.
- Geprüfte Dateiänderungen mit SHA-256, Inhaltsrevision und dokumentierter Übergabedatei `current.json`.
- Passende vorhandene Server-Clientpakete werden erneut geprüft und wiederverwendet. Aktuelles Paket und ein vorheriger Stand bleiben erhalten; temporäre Kopien werden bereinigt.
- Fehlende/falsche Basis und Paketfehler werden getrennt vom bereits erfolgreichen Spielpatch gemeldet. Eine Wiederherstellung oder ein Basiswechsel sperrt den alten Export.
- **122 Hintergrundprüfungen bestanden**, einschließlich echter Client-/Serverpatches auf isolierten Kopien und exakter Rekonstruktion der erzeugten Clientdateien. Kein Spiel- oder Desktopstart.

**Noch nicht angeschlossen:** Der UGSM-Servermanager und Spielerclient benötigen den Adapter zum Einlesen, Bereitstellen und Anwenden dieser Pakete. Dieses Release verteilt noch keine Mods automatisch an Mitspieler.

[Einrichtung](https://github.com/Priestkiller/Enshrouded-Mod-Studio/blob/v0.4.22/CLIENTPAKETE.txt) · [Schnittstelle für den Servermanager](https://github.com/Priestkiller/Enshrouded-Mod-Studio/blob/v0.4.22/SERVERMANAGER-CLIENTPAKETE.md)

## Download und Update

Windows x64 mit .NET Framework 4.8. Auf dem Server das ZIP in einen neuen beschreibbaren Ordner entpacken und **Altes Setup übernehmen** wählen; den bisherigen vollständigen Mod-Studio-Ordner angeben. Ab Studio 0.4.10 ist alternativ **Update prüfen** verfügbar. Profile, Einstellungen und passende Sicherungen werden übernommen. Das Toolupdate selbst verändert keine Spielarchive.

Das öffentliche Paket enthält Anwendung, eigene Quellen und EMM mit Lizenz und zugehörigem Quelltext. Die ursprüngliche Patcher-Laufzeit und der Legacy-Parser werden aus einer vorhandenen vollständigen Installation übernommen. Ohne diese Runtime lässt sich die Oberfläche öffnen, aber kein Spielpatch anwenden.

Die Verteilung behebt keine bisher offenen Spielmechaniken: Lagerzugriff aus normalen Kisten/Werkbänken und zusätzliche Fähigkeitspunkte ausschließlich über den Server gelten weiterhin nicht als gelöst. Ein echter Mehrspieler-Spieltest der Begleiter bleibt offen.
