## Sechs Begleiterzauber für passend gepatchten Multiplayer

Die bisherige Singleplayer-Sperre ist aufgehoben. Dedicated Server erhalten Gegenstände, Rezepte und Begleiterdaten; Spielclients zusätzlich Herstellungsmenü, Namen und Icons. **Server und ALLE Spielclients müssen dieselbe passende Version und dieselben Begleiterwerte anwenden.** Der Server verteilt keine Dateien. Die neue MP-Kennung hilft beim Vergleich.

Bei Alden Crowley: Zauberskelett, Skelettkrieger, Eliteskelett, erloschener Magier, Skeletthund und Säbelzahntiger. Jeweils 5 Knochen und 1 Ektoplasma-Fragment; Wechsel über die normale Zauberauswahl. Anzahl, Dauer und Stärke einstellbar. Der Magier nutzt zunächst Eisgeschosse, keine eigenen Totenkopf-Beschwörungen. Der Tiger hat ein eigenes Inventarsymbol.

## Weitere Änderungen seit 0.4.10

- Tierproduktion mit getrennten Mengen- und Tempofaktoren.
- Nutztier-Zucht mit einstellbarem Prüfungsabstand und optionaler Basischance. Die beschleunigte Zucht wurde vom Benutzer im Spiel bestätigt. Fische und vorerst Wüstengürteltiere sind ausgeschlossen.
- Korrigierte Registrierung der Item-Texturen und Alden-Rezepte; ausführlichere Beschreibungen.
- Archivprüfung, sichere Basis-/Updateverwaltung und Bereinigung temporärer Arbeitsdaten.

## Installation und Update

ZIP vollständig entpacken. Bestehende Installationen können über den Update-Button aktualisieren oder **Altes Setup übernehmen** verwenden; Profile und passende Einstellungen/Basen werden übernommen. **Danach den Spielpatch auf Server und allen Clients erneut anwenden.**

Das öffentliche Paket enthält das Studio, eigene Quellen/Assets sowie EMM mit GPL-Lizenz und zugehörigem Quelltext. Die ursprüngliche Patcher-EXE, deren Bytecode und der bisherige Parser bleiben ausgenommen und werden aus einer vorhandenen vollständigen Studio-Installation anhand ihrer Prüfsummen übernommen. Details in `THIRD-PARTY.md`.

## Prüfstatus und Grenzen

88 gezielte Modul-, Rollen-, Profil-, UI-Modell- und Kennungsprüfungen bestanden. Echte Backend-Vorschauen auf nativen Server- und Clientarchiven: 18 beziehungsweise 26 geänderte Ressourcen gepackt und erneut gelesen; alle neun gemeinsamen neuen Ressourcen identisch. Quellen und Benutzerprofile blieben unverändert.

**Ein echter Multiplayer-Spieltest mit mehreren verbundenen Spielern steht noch aus.** Archivtests bestätigen keine Netzwerksynchronisierung, Besitzerzuordnung, Kampf-KI oder gemischte Gruppen. Es wurden weder Spiel noch Server automatisch gestartet.

Lagerzugriff aus allen normalen Kisten/Werkbänken bleibt ungelöst. Eine zusätzliche Fähigkeitspunktevergabe an alle Spieler ausschließlich über den Server ist weiterhin nicht unterstützt. Profile, Sicherungen, Spielarchive und persönliche Prüfberichte sind nicht Bestandteil der Veröffentlichung.
