# Enshrouded Mod Studio 0.4.32

Herstellung verständlich erklärt
- Die Rezeptanzeige enthält den Mengenfaktor bereits: Zeigt ein Rezept ×4,
  liefert eine Herstellung insgesamt vier Stück. Der Faktor wird aus der
  ursprünglichen Rezeptmenge berechnet.
- Im Spiel bestätigt: Das getestete Rüstungsrezept lieferte bei Faktor 4
  tatsächlich vier Teile. Weitere Rezepte und Herstellungszeiten bleiben
  getrennt zu prüfen.

Geprüfte Datenkorrekturen
- Kisten und Rucksäcke verwenden vollständige Inventarreihen mit acht Plätzen.
  Die eingestellte Grenze wird auf vollständige Reihen begrenzt; bestehende
  Rucksack-Grundkapazität wird durch die Zusatzplatz-Option nicht verkleinert.
- Herstellen ohne Rezeptkosten entfernt Material- und Wasserkosten und erhält
  die ursprünglichen Freischaltungen, Stationsgegenstände und Überdachung.
  Kochen bleibt ausgenommen; Altar-Upgrades sind optional und behalten ihre
  Stufen-, Weltfortschritts- und NPC-Voraussetzungen.
- Nicht darstellbare Mana-, Musikzeit-, Zauber-/Bogenanzeige- und Sammelwerte
  werden vor dem Packen mit Option, Ressource und Feld benannt und abgewiesen.
  Gültige Werte werden durch diese Prüfung nicht verändert.

Prüfumfang und Grenzen
- Eigene Hintergrundtests prüfen Berechnungen, Zusammenspiel und Archivdaten.
  Das bestätigt keine allgemeine Spielwirkung aller Einstellungen.
- Vorhandene gespeicherte Kisten oder Rucksackinstanzen können weiterhin ihre
  gespeicherte Größe verwenden; der Umgang damit ist im Spiel zu prüfen.
- Ausdauer je Attributpunkt ist kein automatischer Ausdauerbonus je Level.
  Fertigkeitspunkte verwenden den Levelanteil der Gesamtpunkteberechnung.


Die drei neuen Begleitervorlagen werden gezielt im globalen Vorlagenkatalog registriert. Bestehende Clientverweise bleiben bei der Synchronisierung erhalten.

**Update-Reihenfolge:** Manager 0.15.39 und Spielerclient 0.16.23 aktualisieren, dann Studio 0.4.32 verwenden, Serverprofil erneut anwenden und auf den Spieler-PCs synchronisieren. Profile und Einstellungen bleiben erhalten. Alte Studio-Pakete werden weiterhin unterstützt.
