# Externe Laufzeitdateien

Dieses Repository und das öffentliche Studio-ZIP enthalten keine ausführbaren Dateien oder Bytecode-Module des ursprünglichen Enshrouded Patchers 1.2.3. Auch Spielarchive, Spielressourcen, Profile und Sicherungen sind ausgeschlossen.

Der Studio-Code verwendet den ursprünglichen Patcher als getrennten Prozess. Die öffentliche Version übernimmt seine Laufzeitdateien über **Altes Setup übernehmen** aus einem vorhandenen Mod-Studio-Paket und prüft die erwarteten Dateihashes. Eigene aktuelle Studio-Module werden dabei nicht durch ältere Dateien ersetzt.

Dem vorliegenden Original-Patcher-ZIP lag kein Lizenztext für dessen EXE oder Bytecode bei. Deshalb wird für diese Dateien keine Lizenz oder allgemeine Erlaubnis zur Weitergabe behauptet und keine Kopie öffentlich bereitgestellt.

Der ursprüngliche Patcher verweist auf den getrennten KFC-Parser von Brabb3l:

- [KFC-Parser-Quellcode](https://github.com/Brabb3l/kfc-parser)
- [KFC-Parser-Veröffentlichungen](https://github.com/Brabb3l/kfc-parser/releases)
- [KFC-Parser-Lizenz: GPLv3](https://github.com/Brabb3l/kfc-parser/blob/main/LICENSE)

Diese Hinweise übertragen keine Rechte an Enshrouded, dem ursprünglichen Patcher oder anderen Fremdkomponenten. Die originale Laufzeit wird im öffentlichen Paket nicht mitgeliefert.
