# Enshrouded Mod Studio 0.4.33

Enshrouded Mod Studio 0.4.33

PROGRAMM INSTALLIEREN UND AUTOMATISCH AKTUALISIEREN
- Das neue Setup installiert Studio als normales Programm mit Startmenueintrag
  und einem Eintrag zum Deinstallieren in Windows. Administratorrechte sind
  nicht erforderlich. Der Installationsordner kann ausgewaehlt werden.
- Beim ersten Setup kannst du den bisherigen portablen Studioordner auswaehlen.
  Profile, Auswahl, Einstellungen, Sicherungen, gepruefte Originalbasen und
  passende private Patcherdateien werden uebernommen. Das Original bleibt
  erhalten. Ohne bisheriges Setup ist weiterhin eine frische Einrichtung moeglich.
- Beim Start prueft Studio automatisch auf eine neuere stabile Version und
  installiert sie nach Anzeige der Aenderungen. Die kurze Wartezeit laesst
  sich anhalten; mit Spaeter wird fuer diesen Start verschoben.
- Unter Werkzeuge koennen automatische Programmupdates ausgeschaltet werden.
  Update pruefen und Aenderungen dieser Version anzeigen bleiben verfuegbar.
- Installierte Programme behalten beim Update denselben Ordner. Die bestehenden
  Profile und Einstellungen bleiben dort erhalten. Portable ZIPs nutzen weiter
  die gepruefte Datenuebernahme mit Rueckfall auf den bisherigen Ordner.

KORREKTUREN UND PRUEFUNG
- Die erkannte installierte Version stammt jetzt aus der laufenden Anwendung.
  Die bisher fest eingetragene 0.4.30 konnte neuere vorhandene Versionen falsch
  erkennen. Falls dein bisheriges Update deshalb abbricht: dieses Setup einmal
  direkt herunterladen, das alte Studio schliessen und im Setup uebernehmen.
- Laufende Patches und ungespeicherte Aenderungen werden nicht durch ein
  automatisches Programmupdate unterbrochen. Fehlgeschlagene automatische
  Versuche werden fuer dieselbe Version 30 Minuten verschoben.
- Downloadadresse, Groesse und SHA-256 werden vor dem Installieren geprueft.
  Bei Fehlern bleibt die bisherige Anwendung nutzbar.
- Eigene Hintergrundtests pruefen Update-Metadaten, Einstellungen,
  Datenuebernahme und Installer-Ruecknahme mit kuenstlichen Dateien.
  Es wurden keine produktiven Profile, Spielstaende oder Spiele veraendert.

SYNCHRONISATION
Zuerst Manager 0.15.40 und Spielerclient 0.16.24 aktualisieren, danach Studio
0.4.33 verwenden. Der neue Studio-Programmstand wird von beiden erkannt.
Vorhandene aeltere Clientpakete bleiben unterstuetzt. Die Patch-Engine und
die Spieloptionen wurden in dieser Programmversion nicht veraendert.