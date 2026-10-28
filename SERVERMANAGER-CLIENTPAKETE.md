# Ressourcenrezepte ab Studio 0.4.27

Standard: Studio 0.4.27, Manager 0.15.29 und Spielerclient 0.16.14. Es wird keine
Clientinstallation auf dem Server und kein Upload von Clientoriginalen benötigt.
Nach erfolgreichem Serverpatch exportiert Studio erlaubte Ressourcenidentitäten
mit ihren geprüften Vorher-/Nachherdaten und bereinigten Optionswerten. Der feste
Spielerclient-Worker führt die Änderungen auf der eigenen gesicherten Basis aus.
Clientfelder bleiben erhalten; unbekannte Identitäten, Altwerte oder Spielbuilds
stoppen den Lauf vor einer Installation. Die fest eingebauten Begleiterdefinitionen
ergänzen die nur lokal vorhandenen Menü-, Bild- und Sprachdaten.

Das äußere Manifest bleibt `enshrouded-studio-client-package`, mit
`formatVersion:2` und `requiredCapability:enshrouded-resource-recipe-v1`.
`recipe` enthält Format/Version, `encoding:gzip-json`, Größe und SHA256 des
kanonischen ungepackten Rezepts sowie ein bestehendes `base:null`-Blockdelta für
die komprimierten Bytes. `blobs` ist dessen vollständiges Inhaltsinventar.
Es werden keine Client-EXE- oder Ergebnisarchivhashes aus Serverdateien behauptet.
Diese ermittelt und prüft der lokale Worker vor der vorhandenen Transaktion.
Grenzen: Manifest 4 MiB, komprimiertes Rezept 64 MiB, ungepackt 256 MiB,
10000 Ressourcen, Inhaltsblöcke höchstens 64 KiB. Es wird genau ein gzip-Member
akzeptiert. Das Paket enthält Daten und keine heruntergeladenen Programme oder
Skripte; Werkzeuge und Worker kommen ausschließlich aus dem geprüften Clientupdate.

Einrichtungsschlüssel: `transportMode:resource-recipe` ist der neue Standard.
`transportMode:client-archive-delta` aktiviert ausdrücklich die folgende ältere
Methode. Die bisherigen vollständigen V1-Ausgangs-/Ergebnishashprüfungen bleiben
erhalten. Alte Clients erhalten bei V2 eine klare Aufforderung zum Clientupdate.

# Bisherige automatische Übergabe und V1-Paketmethode ab 0.4.25

Der vom Manager verwaltete Server-Installationsordner enthält `.ugsm-studio.json`. Studio validiert diese Bindung und verwendet ausschließlich `.ugsm-studio-transfer/output` als reservierte Paketablage. Nach dem erfolgreichen Patch folgen minimale Plan-/Zustandsbelege unter `snapshots/<planId>/proofs/patches`, deren SHA-256-Werte in der atomaren `handoff.json` stehen. Die Quelle der Clientdaten ist eine vorhandene getrennte lokale Clientbasis desselben Spielbuilds; es gibt keine Spieler-Uploads und keine Serverarchiv-Umbenennung.

Manager 0.15.28 liest die gemeinsame Ablage, prüft weiterhin den angewendeten Serverplan und die aktuellen Serverdateien und übernimmt bestätigte Clientpakete. Der Manager benötigt dafür keinen privaten Studio-Datenpfad oder Desktop-Zugriff. Nicht vom Manager verwaltete Installationen können weiterhin den älteren manuellen Vertrag verwenden.

## Bisheriger manueller Vertrag

# Mod-Studio-Clientpakete: Übergabe an den Servermanager

Stand: Mod Studio 0.4.25. Dieser Abschnitt beschreibt den weiterhin unterstützten manuellen Übergabevertrag. UGSM Manager 0.15.28 übernimmt und veröffentlicht bestätigte Pakete; Spielerclient 0.16.13 lädt, prüft und installiert sie über die bestehende Synchronisation. Die automatische lokale Bindung ist im vorigen Abschnitt beschrieben.

Die maßgeblichen Implementierungen sind `engine/client-packages.js`, `engine/client-delta.js` und deren Einbindung in `engine/studio-backend.js`. Bei einer Weiterentwicklung muss der Adapter bekannte Formate ausdrücklich unterstützen; unbekannte Pflichtfähigkeiten dürfen nicht stillschweigend ignoriert werden.

## 1. Ablauf und Zuständigkeiten

1. Das Mod Studio bereitet und prüft den normalen Patch auf Arbeitskopien.
2. Bei einem Serverziel erzeugt es zusätzlich eine Clientvorschau gegen die eingerichtete Clientbasis. Der Client wird dabei nicht installiert oder verändert. `ServerOnly`-Optionen sind im abgeleiteten Clientprofil ausgeschaltet; bekannte Clientoptionen werden anhand des Schemas projiziert.
3. Client- und Serverbuild müssen übereinstimmen. Bei eigenen Begleiterzaubern muss auch die vorhandene Multiplayer-Kennung übereinstimmen.
4. Erst nach dem erfolgreichen Dateitausch und dessen Bestätigung wird das Clientpaket fertiggestellt, geprüft und über `current.json` freigegeben.
5. Der implementierte Servermanager-Adapter ordnet diese Übergabe einem UGSM-Serverprofil zu, veröffentlicht das benötigte Paket und erhöht gegebenenfalls dessen Veröffentlichungsrevision.
6. Der implementierte Spielerclient-Adapter lädt es, rekonstruiert die passenden Clientdateien in einem Arbeitsordner, prüft sie und installiert sie transaktional.

Ein gespeichertes Profil oder eine Vorschau ist keine Bestätigung eines angewendeten Serverpatches. Ein Paketfehler nach erfolgreichem Spielpatch wird separat gemeldet; der bereits angewendete Spielpatch wird dadurch nicht als ungepatcht behandelt.

## 2. Lokale Einrichtung

Datei: `Data/client-packages.json`, wobei `Data` den tatsächlichen Datenordner des Tools bezeichnet. Bei Aufruf der Engine ist dies der Elternordner von `options.data` (`Data/patches`).

```json
{
  "format": 1,
  "enabled": true,
  "clientBasisDirectory": null,
  "outputDirectory": "H:\\Codex\\Enshrouded-Mod-Studio\\Data\\client-packages"
}
```

`enabled` ist standardmäßig `true`. Für Serverpatches wird `clientBasisDirectory` einmalig auf eine getrennte, vollständige Spielclient-Installation gesetzt. Diese muss zum Serverbuild passen. Der Ausgabeordner ist unabhängig einstellbar und darf nicht in den Spielinstallationen oder im automatisch bereinigten Patch-Jobs-Verzeichnis liegen. Die Oberfläche speichert die Einrichtung getrennt von exportierbaren Modprofilen und erhält unbekannte Einrichtungsfelder.

Bei einem Clientpatch wird dessen passende gespeicherte Archivbasis verwendet. Bei der ersten Basis können bereits vorhandene Änderungen Bestandteil des Ausgangsstands sein. Der Paketvertrag kennzeichnet daher ausdrücklich nur einen Nachweis über Dateiprüfsummen, keinen unabhängig bewiesenen Vanilla-Ursprung.

## 3. Verzeichnislayout

```text
<outputDirectory>/
  <targetId>/
    current.json
    previous-current.json           # lokaler vorheriger Zeiger, kein aktueller Stand
    packages/
      <revision>/
        .studio-owned.json          # Besitzmarkierung für lokale Bereinigung
        manifest.json
        blobs/
          <sha256>

Data/
  client-package-status/
    <targetId>.json                  # lokale Anzeige/Diagnose
```

`targetId` ist die vorhandene 20-stellige hexadezimale Installationskennung des Mod Studios. Sie wird aus dem lokalen Zielpfad abgeleitet und ist **keine UGSM-Serverprofil-ID**. Der Servermanager muss die Zuordnung ausdrücklich speichern. Weder ein ähnlicher Profilname noch eine zufällige Ordnerauswahl reicht als Bindung aus.

`packages/<revision>` enthält ein unveränderliches Inhaltsobjekt. `current.json` ist der maßgebliche Zeiger, nicht das Änderungsdatum eines Paketordners. Die lokale Statusdatei kann absolute Ausgabepfade enthalten und gehört nicht in den Download für Spieler.

## 4. `current.json`: lokale Freigabe

Nur `status: "ready"` bezeichnet eine fertige lokale Übergabe. Die aktuelle Implementierung verwendet außerdem `building`, `blocked`, `disabled`, `failed` und `invalidated`. Jeder dieser anderen Zustände verhindert eine neue Veröffentlichung dieses Stands. Ein vorhandenes altes Paket darf nicht als Ersatz für die aktuelle Revision ausgegeben werden.

Relevante Felder eines fertigen Zeigers:

| Feld | Bedeutung |
| --- | --- |
| `format` | Zeigerformat, aktuell `1`. |
| `status` | Muss für die Freigabe `ready` sein. |
| `targetId` | Lokale Installationskennung der angewendeten Quelle. |
| `sourceRole` | `server` oder `client`. Ein Clientexport beweist keinen angewendeten Dedicated-Serverstand. |
| `sourcePlanId` | Bestätigter Patchauftrag, aus dem diese Übergabe entstand. |
| `sourceArchiveHashes` | Dateiname → SHA-256 der angewendeten Quelldateien, einschließlich erzeugter Datendateien. |
| `revision` | 64-stellige Inhaltsrevision des Clientmanifests. |
| `manifest` | Relativer Pfad `packages/<revision>/manifest.json`. |
| `manifestSha256` | SHA-256 der tatsächlich geschriebenen Manifestdatei. |
| `gameBuild` | Build der passenden Clientdateien als Zeichenfolge. |
| `downloadBytes` | Größe der Manifestdatei plus aller einmalig aufgeführten Payloadblobs. |
| `previousRevision` | Gegebenenfalls vorherige eigene Paketrevision. |
| `requiresManagerAdapter` | Aktuell `true`: Der implementierte UGSM-Adapter und ein kompatibler Spielerclient bleiben erforderlich. |
| `published` | Aktuell `false`: lokale Erstellung hat nichts hochgeladen. |
| `updatedAt` | Lokaler Erstellungs-/Aktualisierungszeitpunkt. |

Bei einem neuen erfolgreichen Spielpatch wird der bisherige fertige Zeiger vor dem potenziell fehlschlagenden Paketbau zurückgelegt. Basiswechsel, Wiederherstellung und eine abgeschlossene Reparatur unterbrochener Vorgänge invalidieren die Übergabe.

Für die serverseitige Veröffentlichung prüft der implementierte Adapter zusätzlich:

- Das zugeordnete Serverprofil ist wirklich das konfigurierte Quellziel.
- `sourceRole` und die gewünschte Veröffentlichung passen zusammen.
- `sourcePlanId` stimmt mit dem bestätigten angewendeten Mod-Studio-Zustand überein.
- Die Quelldateien entsprechen noch `sourceArchiveHashes`.
- Die aktuelle Spielversion und gegebenenfalls der erforderliche Serverneustart passen zum aktiven Betrieb. Eine Dateiprüfsumme beweist nicht, dass ein bereits laufender Server diese Dateien schon neu geladen hat.
- `current.json` ist nach Paketübernahme weiterhin dieselbe fertige Übergabe. Bei einer zwischenzeitlichen Änderung muss die Veröffentlichung abgebrochen und wiederholt werden.

## 5. Übertragbares `manifest.json`

Das Manifest enthält die Clientänderungen, bekannte Optionswerte und Prüfsummen, aber keine lokalen Installationspfade, Serverzugangsdaten oder beliebigen Profilfelder. `sourcePlanId` und `sourceArchiveHashes` gehören zum lokalen Übergabezeiger; sie sind keine Felder des übertragbaren Paketmanifests.

| Feld | Aktueller Vertrag |
| --- | --- |
| `format` | `enshrouded-studio-client-package` |
| `formatVersion` | `1` |
| `requiredCapability` | `enshrouded-studio-client-package-v1` |
| `targetRole` | `client` |
| `game` | `enshrouded` |
| `gameBuild` | Exakter benötigter Spielbuild als Zeichenfolge. |
| `studioVersion` | Erzeugende Mod-Studio-Version. |
| `engineVersion` | Zugehörige Engine-Version. |
| `engineFingerprint` | SHA-256 über das kanonische Engine-Manifest. |
| `requiredClientExeSha256` | Benötigte Prüfsumme der lokalen `enshrouded.exe`; die EXE selbst wird nicht übertragen. |
| `basisProvenance` | `hash-bound-files-not-independently-proven-vanilla` |
| `options` | Schema-projizierte Clientoptionen; keine lokalen Laufzeit-/Ausgabepfade. |
| `mods` | Aktivierte Einträge mit `id`, `name`, `archiveVerified: true`, `gameplayVerified: false`. |
| `gameplayVerified` | Aktuell `false`. |
| `multiplayerId` | Kennung der eigenen Begleiterzauber oder `null`; ersetzt nicht die Prüfung des gesamten Pakets. |
| `managedFilePolicy` | `complete-inventory-remove-only-files-owned-by-previous-package` |
| `files` | Vollständiges Ergebnisinventar der vom Paket verwalteten Clientdateien. |
| `blobs` | Nach SHA-256 sortierte, deduplizierte Liste aller im Paket benötigten neuen Datenblöcke. |
| `revision` | Inhaltskennung des gesamten Manifests, siehe unten. |

Die `revision` ist SHA-256 des kanonischen JSON-Dokuments **ohne das Feld `revision`**. Objektfelder werden rekursiv lexikografisch sortiert; die Reihenfolge von Arrays bleibt erhalten. Das Hashmaterial ist UTF-8 ohne BOM und ohne zusätzliche Leerzeichen oder Zeilenumbruch. Die tatsächliche Manifestdatei wird anschließend mit einem abschließenden Zeilenumbruch geschrieben; `manifestSha256` im Zeiger bindet genau diese Datei. Beide Prüfungen haben unterschiedliche Aufgaben und müssen getrennt verstanden werden.

Gleicher Paketinhalt ergibt dieselbe Revision. Zeitstempel, lokale Pfade und der Patchauftragsname sind bewusst kein Teil der Inhaltsrevision. Die Veröffentlichungsrevision des UGSM-Serverprofils ist ein eigener bestehender Mechanismus; sie darf nicht mit dieser Inhaltskennung verwechselt werden.

Zulässige Ergebnisdateien sind ausschließlich:

- `enshrouded.kfc`
- `enshrouded.kfc_resources`
- `enshrouded_<Ziffern>.dat`

Die beiden Archive sind immer im Inventar enthalten, auch wenn sie vollständig aus der Basis kopiert werden können. Serverdateien, ausführbare Programme, beliebige Zusatzskripte und freie Zielpfade gehören nicht zum Vertrag.

## 6. Deltaformat und Payload

Jeder Eintrag von `files` hat `path` und `delta`. Das Delta enthält exakt:

| Feld | Bedeutung |
| --- | --- |
| `format` | `enshrouded-block-delta` |
| `version` | `1` |
| `blockSize` | `65536` Byte, also 64 KiB. |
| `base` | `{sha256, size}` für das passende Ausgangsarchiv; bei neu erzeugten Datendateien `null`. |
| `result` | Erwartete Ergebnisidentität `{sha256, size}`. |
| `operations` | Geordnete Operationen zur lückenlosen Rekonstruktion der Ergebnisdatei. |
| `blobs` | Die von diesem Dateidelta benötigten neuen Blöcke. |

Es gibt nur zwei Operationsarten:

```json
{ "copy": 131072, "length": 65536 }
```

Kopiert `length` Bytes ab dem nullbasierten Byteoffset `copy` aus der geprüften Basisdatei.

```json
{ "blob": "<64-stelliger SHA-256-Wert>", "length": 65536 }
```

Hängt den vollständigen gleichnamigen Payloadblock an. Das zweite Beispiel ist eine Formatvorlage, kein verwendbarer Hashwert. Jeder Blobdeskriptor besteht aus `sha256`, `size` und `path: "blobs/<sha256>"`. Die Blobgröße ist 1 bis 65536 Byte; der letzte Block einer Datei kann kürzer sein. Benachbarte Kopierbereiche können zu einer längeren Operation zusammengefasst sein.

Jede Operation muss innerhalb ihrer Quelle liegen. Die Summe aller Operationslängen muss exakt `result.size` ergeben. Das Blobinventar darf weder fehlende noch unbenutzte Einträge enthalten. Für dasselbe Hashobjekt müssen die Größen übereinstimmen. Die Gesamtblobliste im Manifest ist die deduplizierte Vereinigung der Dateiinventare.

Aktuelle Obergrenzen: höchstens 1.000.000 Operationen beziehungsweise Blöcke pro Delta und höchstens 65.536.000.000 Byte pro Datei. Der Manager und der Spielerclient dürfen zusätzliche engere Ressourcenlimits setzen und müssen diese verständlich melden.

Das Format ist ein einfacher fester Blockvergleich, kein garantiert minimaler Binärpatch. Verschobene Inhalte können mehr neue Blöcke erfordern. Es wird nicht versprochen, dass jeder Patch nur einen winzigen Download benötigt. Identische neue Blöcke werden innerhalb eines Pakets dedupliziert; der Clientcache kann dieselben Hashobjekte auch über Revisionen hinweg wiederverwenden.

## 7. Anforderungen an den Servermanager-Adapter

Die bestehende HTTPS-/Einladungs-/Token-/Zertifikatsinfrastruktur soll weiterverwendet werden. Es wird hier kein konkreter neuer Endpunkt vorgegeben oder als vorhanden behauptet.

- Dieses Format als eigenen erlaubten Pakettyp anbinden; die allgemeine Enshrouded-Dateifreigabe nicht global auf beliebige Rootdateien öffnen.
- Ausschließlich fertige, vollständig validierte Übergaben veröffentlichen. Manifestdatei, kanonische Revision, Deltaformate, Zielinventar und alle Blobs prüfen.
- Pfade strikt auf die erwartete Paketstruktur begrenzen, keine Verknüpfungen oder Traversierung zulassen.
- Lokale Besitzmarkierungen, Diagnoseberichte, Einrichtung und Patchkonfigurationen mit lokalen Pfaden nicht an Spieler verteilen.
- Die konkrete veröffentlichte Manifestidentität und ihre erforderliche Fähigkeit im Serverprofil festhalten. Ein älterer Spielerclient muss mit „Clientupdate erforderlich“ stoppen.
- Paket und Blobs zuerst vollständig bereitstellen, dann atomar die Serverprofilrevision freigeben. Kein gemischtes Inventar aus zwei Paketständen ausliefern.
- Unveränderte Inhaltsrevisionen nicht als neue Modänderung veröffentlichen.
- Den bisherigen gültigen veröffentlichten Stand bei einem neuen Paketfehler nicht durch einen unvollständigen Stand ersetzen. Zugleich darf der Manager keine Übereinstimmung mit einem inzwischen anders gepatchten Server behaupten.

Die vorhandene Multiplayer-Kennung umfasst die Begleiterkonfiguration und ist keine allgemeine Paket- oder Netzwerkauthentifizierung. Für das Gesamtpaket ist die Manifestrevision maßgeblich. SHA-256 schützt die Bindung der Daten; die Vertrauenswürdigkeit der Quelle kommt weiterhin aus der vorhandenen geprüften Serververbindung.

## 8. Anforderungen an den Spielerclient-Adapter

Vor einer Installation müssen Paketfähigkeit, Spielbuild, `requiredClientExeSha256`, passende Basisgrößen und Basishashes stimmen. Bei einem bereits verwalteten Modstand darf nicht das aktuell gepatchte Archiv als Originalbasis ausgegeben werden. Eine geeignete, bekannte Basis muss getrennt erhalten beziehungsweise über einen vorgesehenen Wiederherstellungsweg beschafft werden.

Der Adapter rekonstruiert zunächst in einem neuen lokalen Arbeitsordner. Dabei werden sämtliche Blobgrößen/-hashes geprüft und anschließend jede Ergebnisdatei gegen `result` verglichen. Es wird kein vom Server geliefertes JavaScript ausgeführt. `client-delta.js` dokumentiert die Referenzrekonstruktion; der implementierte Installer verwendet den vorhandenen lokalen Transaktions-, Prozessprüfungs- und Wiederherstellungsablauf.

Erst danach darf der Client die geprüften Ergebnisse bei geschlossenem Spiel austauschen. Vorhandene fremde Dateien oder Mods dürfen nicht stillschweigend überschrieben werden. Die Serverprofilrevision muss vor dem eigentlichen Spielstart erneut geprüft werden.

Das Manifest ist ein **vollständiges Inventar**, keine lose Liste hinzugefügter Dateien. Fehlt beispielsweise eine alte `enshrouded_123.dat` im neuen Paket, darf sie nur dann entfernt werden, wenn der vorherige verwaltete Paketstand ihren Besitz dokumentiert und ihr aktueller Hash weiterhin dem verwalteten Stand entspricht. Fremde oder außerhalb des Clients geänderte Datendateien müssen einen Konflikt auslösen. Ausgeschaltete Mods dürfen nicht durch liegengebliebene Zusatzdateien weiterwirken.

## 9. Speicher und Bereinigung

Der native Archivpacker kann bei unabhängigen Packvorgängen dieselben Ressourcen
binär unterschiedlich anordnen. Ein Serverpatch verwendet deshalb ein vorhandenes,
erneut geprüftes Clientpaket wieder, wenn Spielbuild, Client-EXE, Clientbasis,
projizierte Optionen und Engine-Fingerprint übereinstimmen. Der neue Exportindex
enthält trotzdem die neue Quellplan-ID und die tatsächlichen aktuellen Serverhashes.
Bei einem Clientpatch müssen zusätzlich das vollständige Ergebnisinventar und alle
Ergebnishashes übereinstimmen. Bei unterschiedlichem Ergebnis entsteht eine neue
Inhaltsrevision. Unabhängig neu gepackte Clientpakete müssen nicht dieselbe
Binärrevision besitzen, auch wenn ihre Einstellungen gleich sind.

Der Exporter hält pro Quellziel das aktuelle und höchstens ein vorheriges eigenes Paket vor. Eine wiederholte Erstellung derselben Revision erhält den bisherigen Rückfallstand. Nur markierte eigene Revisionsverzeichnisse werden für die Paketbereinigung berücksichtigt. Clientarbeitskopien werden nach der Übergabe bereinigt; Profil-, Basis- und Wiederherstellungsdaten bleiben davon getrennt.

Der Paketbau prüft vorab Speicherplatz und verwendet dafür eine konservative Obergrenze aus den Ergebnisdateien. Kleiner Download bedeutet nicht automatisch kleinen Arbeits- oder Sicherungsbedarf. Für den Spielerclient sind Staging und Wiederherstellung zusätzlich zu berücksichtigen. Größere Verzeichnisse sollen auf dem gewählten Datenlaufwerk liegen und nicht ungefragt unter C: entstehen.

## 10. Nachweisgrenzen und Tests

`archiveVerified` bezeichnet die vom Mod Studio geprüften Archivänderungen. Es beweist weder eine Wirkung jeder Option im Spiel noch einen bereits abgeschlossenen Multiplayer-Test. Insbesondere gelten der Lagerzugriff aus normalen Kisten/Werkbänken und zusätzliche Fähigkeitspunkte ausschließlich auf dem Server durch diesen Export nicht als repariert.

Die aktuelle Aufgabe umfasst lokale Hintergrundtests. Der konkrete Testumfang und die Ergebnisse stehen im gesonderten Prüfbericht. Integrationsprüfungen umfassen zusätzlich serverseitige Veröffentlichung und Spielerclientinstallation über lokale TLS-Testverbindungen. Ein echter Multiplayer-Spieltest bleibt davon zu unterscheiden.

Es wurde durch die lokale Paketerstellung nichts veröffentlicht.
