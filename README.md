# localize-me

Schlanke Übersetzungsverwaltung für iOS- und Android-Apps. Keys anlegen, Texte übersetzen, als `Localizable.strings`/`strings.xml` oder CSV exportieren – ohne Account, ohne Cloud, ohne Abhängigkeiten. Die Texte liegen als `localize.json` in deinem Projekt und lassen sich ganz normal mit Git versionieren.

Läuft lokal auf deinem Rechner oder zentral fürs ganze Team auf einem Server. Auf Wunsch wird jeder Export automatisch ein Git-Commit.

- [Schnellstart](#schnellstart)
- [Platzhalter](#platzhalter) und [Plurals](#plurals)
- [Export](#export) ins App-Projekt oder als CSV
- [Optionen für die Oberfläche](#optionen-für-die-oberfläche)
- [Beim Export versionieren](#beim-export-versionieren) (Commit, Push, eigener Befehl)
- [Im Team auf einem Server (Docker)](#im-team-auf-einem-server-docker)

## Schnellstart

```bash
mkdir texte && cd texte
npm i @alexandercreates/localize-me
npm run dev
```

Die Oberfläche öffnet sich unter `http://localhost:4848`.

`npm i` trägt das Start-Skript automatisch in die `package.json` ein:

- Gibt es noch kein `dev`-Skript, heißt es `dev` → `npm run dev`
- Gibt es schon eins (z. B. in einem bestehenden Web-Projekt), heißt es `localize` → `npm run localize`

Bestehende Skripte werden nie überschrieben. Falls dein Paketmanager Install-Skripte blockiert (pnpm, Yarn Berry, `--ignore-scripts`), richte es einmalig von Hand ein:

```bash
npx localize-me init
```

Oder starte ohne Installation direkt mit `npx @alexandercreates/localize-me`.

Der Befehl selbst heißt kurz `localize-me`, sobald das Paket im Projekt installiert ist.

## Platzhalter

Schreib Platzhalter neutral. Beim Export werden sie ins Format der Plattform umgewandelt.

| Eingabe        | Bedeutung     | iOS    | Android |
| -------------- | ------------- | ------ | ------- |
| `#name`        | Text          | `%@`   | `%s`    |
| `#anzahl:int`  | ganze Zahl    | `%lld` | `%d`    |
| `#preis:float` | Kommazahl     | `%f`   | `%f`    |
| `#plätze:plural` | ganze Zahl, nach der sich ein [Plural](#plurals) richtet | `%lld` | `%d` |
| `##`           | ein echtes #  | `#`    | `#`     |

```
Hallo #name, schön dich zu sehen
→ iOS:      Hallo %@, schön dich zu sehen
→ Android:  Hallo %s, schön dich zu sehen
```

- **Mehrere Platzhalter** werden positionsbezogen exportiert (`%1$@ hat %2$lld Artikel` / `%1$s hat %2$d Artikel`). Reihenfolge und Typ legt der Basistext fest, Übersetzungen dürfen die Platzhalter also umstellen.
- **Typ nur einmal angeben:** Steht im Basistext `#count:int`, reicht in der Übersetzung `#count`.
- **Prozentzeichen** werden zu `%%`, sobald ein Text Platzhalter enthält.
- Die Oberfläche warnt bei fehlenden, zusätzlichen oder abweichend typisierten Platzhaltern.

## Plurals

Für Texte, die von einer Anzahl abhängen („Eine Aufgabe“ / „3 Aufgaben“), setzt du beim Anlegen das Häkchen **Plural** oder klickst bei einem bestehenden Key auf **Plural**. Dann gibt es pro Sprache genau die Formen, die sie braucht: Deutsch und Englisch `one` + `other`, Französisch zusätzlich `many`, Russisch `one`, `few`, `many`, `other` (Regeln aus CLDR).

```json
"tasks.open": {
  "de": { "one": "Eine offene Aufgabe", "other": "#count:int offene Aufgaben" },
  "en": { "one": "One open task", "other": "#count open tasks" }
}
```

- Die Zahl, nach der sich die Form richtet, ist der erste `:int`-Platzhalter in der Form `other` des Basistextes. Die übrigen Formen dürfen ihn weglassen („Eine offene Aufgabe“).
- Gehört das Wort zu einer anderen Zahl, markier sie mit `:plural` statt `:int`: `#count:int von #required:plural Plätzen belegt` richtet sich nach `#required` („1 von 1 Platz“, „1 von 3 Plätzen“). Bei mehreren Zahlen gibt es dafür in der Oberfläche die Auswahl **Form richtet sich nach**. Übersetzungen dürfen weiter `:int` oder gar keinen Typ schreiben.
- Weitere Platzhalter gehen wie gewohnt: `#name hat #count:int Plätze`.
- Fehlende Formen und Platzhalter zeigt die Oberfläche als **Prüfen** an. Ohne Form `other` fehlt die Übersetzung in der exportierten Datei, die App zeigt dann die Basissprache.

| Plattform | Datei                                         | Im Code                                                        |
| --------- | --------------------------------------------- | -------------------------------------------------------------- |
| iOS       | `<sprache>.lproj/Localizable.stringsdict`     | `String(format: NSLocalizedString("tasks.open", comment: ""), count)` |
| Android   | `<plurals>` in `strings.xml`                  | `pluralStringResource(R.plurals.tasks_open, count, count)`     |

Unter Android übergibst du zuerst die Zahl, nach der sich die Form richtet, danach wie gewohnt alle Platzhalter – z. B. `pluralStringResource(R.plurals.task_spots_of, required, count, required)`. In der CSV bekommt jede Form eine eigene Zeile (`tasks.open[one]`, `tasks.open[other]`).

### Und die Null?

Eine Form `zero` bekommen nur Sprachen, deren Grammatik eine eigene Null-Form hat, z. B. Arabisch oder Lettisch. Dort zeigt die Oberfläche das Feld **null** automatisch an. Im Deutschen und Englischen gehört 0 grammatisch zu `other` („0 offene Aufgaben“), deshalb gibt es dort kein Null-Feld. Steht trotzdem ein `zero` in der `localize.json`, wird es für diese Sprachen nicht exportiert.

Der Grund sind die Plattformen, die eine Null-Form unterschiedlich behandeln:

- **Android** nutzt `quantity="zero"` nur in Sprachen, die laut CLDR eine Null-Form haben. Im Deutschen wird der Eintrag stillschweigend ignoriert, die App zeigt die Form `other`.
- **iOS** nutzt einen `zero`-Eintrag in der `.stringsdict` bei 0 in jeder Sprache.

Ein deutsches „Keine offenen Aufgaben“ als Pluralform stünde also auf dem iPhone, auf Android käme „0 offene Aufgaben“. localize-me exportiert nur, was auf beiden Plattformen gleich herauskommt.

Willst du für 0 einen eigenen Text, leg einen eigenen Key an und entscheide im Code. Das verhält sich überall gleich und passt meist ohnehin besser, weil ein leerer Zustand oft anders aussieht (anderer Satz, ausgeblendete Zeile, Hinweis statt Zahl):

```swift
// iOS
let text = count == 0 ? NSLocalizedString("tasks.open_none", comment: "")
                      : String(format: NSLocalizedString("tasks.open", comment: ""), count)
```

```kotlin
// Android
val text = if (count == 0) stringResource(R.string.tasks_open_none)
           else pluralStringResource(R.plurals.tasks_open, count, count)
```

## Export

### Direkt ins App-Projekt

Trag in der `localize.json` ein, wohin die Dateien sollen (relativ zur `localize.json`):

```json
{
  "output": {
    "ios": "../ios/MeineApp/Resources",
    "android": "../android/app/src/main/res"
  }
}
```

Dann schreibt **Exportieren → Dateien schreiben** in der Oberfläche oder auf der Kommandozeile

```bash
npx localize-me export
```

| Plattform | Datei                                                        |
| --------- | ------------------------------------------------------------ |
| iOS       | `<ziel>/<sprache>.lproj/Localizable.strings`                 |
| Android   | `<ziel>/values/strings.xml` (Basissprache), `values-<sprache>/strings.xml` |

- Platzhalter werden wie unten umgewandelt, Sonderzeichen passend escaped.
- Android-Namen entstehen aus dem Key: `login.title` → `R.string.login_title`. Ergeben zwei Keys denselben Namen, bricht der Export mit einer Meldung ab.
- Fehlt eine Übersetzung, fehlt sie auch in der Datei – die App zeigt dann den Text der Basissprache.
- Unveränderte Dateien werden nicht angefasst, Xcode und Gradle bauen also nicht unnötig neu.

Ohne `output` geht es auch einmalig: `npx localize-me export --platform ios --format native --out ios/App/Resources`.

Soll dabei gleich ein Commit entstehen, siehe [Beim Export versionieren](#beim-export-versionieren).

### CSV

In der Oberfläche über **Exportieren**, oder auf der Kommandozeile, z. B. im Build:

```bash
npx localize-me export --format csv --platform ios
npx localize-me export --format csv --platform android --langs de,en --delimiter , --out app/strings.csv
```

Ohne `output` in der `localize.json` ist CSV der Standard, `--format csv` kann dann entfallen.

| Option        | Werte                       | Standard                              |
| ------------- | --------------------------- | ------------------------------------- |
| `--format`    | `native`, `csv`             | `native` mit `output`, sonst `csv`    |
| `--platform`  | `ios`, `android`, `raw`     | native: alle aus `output`, csv: `raw` |
| `--langs`     | Sprachcodes, kommagetrennt  | alle, Basissprache zuerst             |
| `--delimiter` | `;` oder `,`                | `;` (öffnet sauber in deutschem Excel) |
| `--out`       | Pfad                        | native: aus `output`, csv: `strings_<sprachen>_<plattform>.csv` |
| `--file`      | Pfad zur Textdatei          | `localize.json`                       |

Die CSV ist UTF-8 mit BOM, alle Werte stehen in Anführungszeichen. Mit `--platform android` steht in der Spalte `key` der Android-Name (`onboarding.first.some_text` → `onboarding_first_some_text`), bei `ios` und `raw` der Key unverändert.

## Optionen für die Oberfläche

```bash
localize-me dev [optionen]      # bzw. npm run dev -- [optionen]
```

| Option                   | Wirkung                                                                 | Standard                  |
| ------------------------ | ----------------------------------------------------------------------- | ------------------------- |
| `--port <n>`             | Port der Oberfläche. Ist er belegt, nimmt localize-me den nächsten freien. | `4848` bzw. `$PORT`    |
| `--host <adresse>`       | Netzwerk-Adresse. `0.0.0.0` macht die Oberfläche im Netzwerk erreichbar, siehe [Server](#im-team-auf-einem-server-docker). | `127.0.0.1` (nur dieser Rechner) |
| `--allowed-host <namen>` | Weitere Hostnamen, kommagetrennt. Lokal nimmt localize-me nur Anfragen an `localhost` an (Schutz vor DNS-Rebinding) – hinter einem Reverse Proxy auf demselben Rechner hier dessen Namen eintragen. | – |
| `--file <pfad>`          | Datei mit den Texten                                                    | `localize.json`           |
| `--no-open`              | Browser nicht automatisch öffnen                                        | –                         |
| `--commit`               | Jeder Export erzeugt einen Commit, siehe [Versionieren](#beim-export-versionieren). | –             |
| `--push`                 | Wie `--commit`, danach `git pull --rebase` und `git push`               | –                         |
| `--message <text>`       | Commit-Nachricht, wenn in der Oberfläche keine eingegeben wird          | `Texte aktualisiert (localize-me)` |
| `--after-export <befehl>`| Befehl, der nach jedem Export läuft                                     | –                         |

`--commit`, `--push`, `--message` und `--after-export` funktionieren genauso mit `localize-me export --format native`.

## Beim Export versionieren

localize-me kann bei jedem Export automatisch einen Git-Commit anlegen. So ist jeder Stand der Texte nachvollziehbar, und die App-Projekte bekommen die neuen Strings über ganz normale Commits.

```bash
localize-me dev --commit                  # Oberfläche: jeder Export ein Commit
localize-me dev --push                    # … und gleich pushen
localize-me export --commit --message "Texte für Release 2.3"   # dasselbe ohne Oberfläche, z. B. im Build
```

### Voraussetzungen

- `localize.json` und die Zielordner aus `output` liegen in einem Git-Repository (oder in mehreren, siehe unten).
- Git kennt einen Namen und eine E-Mail für Commits (`git config user.name`/`user.email` oder die Umgebungsvariablen `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`, `GIT_COMMITTER_NAME`, `GIT_COMMITTER_EMAIL`).
- Für `--push`: Der Branch hat einen Upstream (`git push -u origin <branch>` wurde einmal ausgeführt), und Git darf ohne Rückfrage pushen (SSH-Key oder gespeicherter Token).

### Ablauf

In der Oberfläche heißt der Button unter **Exportieren** dann **Schreiben und committen**, darüber steht ein Feld **Commit-Nachricht**. Nach dem Klick passiert:

1. **Dateien schreiben**, wie ohne Versionierung.
2. **Commit:** `localize.json` und die exportierten Dateien werden committet, sonst nichts. Andere Änderungen im Repo und bereits Gestagtes bleiben unberührt. Hat sich nichts geändert, entsteht kein leerer Commit.
3. **Push** (nur mit `--push`): Zuerst holt `git pull --rebase` neue Commits vom Remote, dann folgt `git push`. Was andere inzwischen an `localize.json` geändert haben, erscheint danach sofort in der Oberfläche.
4. **Eigener Befehl** (nur mit `--after-export`), siehe unten.

Das Ergebnis steht direkt im Export-Fenster, z. B. „Commit 3f2a91c erstellt und gepusht.“, bei Fehlern mit der Meldung von Git. Auf der Kommandozeile endet `localize-me export` bei einem Fehler mit Exit-Code 1, damit Pipelines ihn bemerken.

**Mehrere Repos:** Liegen iOS- und Android-Projekt in verschiedenen Repos, bekommt jedes seinen eigenen Commit (und Push).

### Wenn etwas schiefgeht

| Situation | Was localize-me tut | Was du tust |
| --------- | ------------------- | ----------- |
| Datei liegt in keinem Git-Repo | Dateien sind geschrieben, es gibt keinen Commit | `output` bzw. `--file` prüfen oder `git init` |
| Name/E-Mail fehlt | Je nach System kein Commit („Author identity unknown“) oder ein Commit mit automatisch erzeugtem Absender wie `user@rechner` | Name und E-Mail setzen (siehe Voraussetzungen) |
| Remote hat widersprüchliche Änderungen an denselben Dateien | Rebase wird abgebrochen, der Commit bleibt **lokal**, das Repo ist sauber | Im Repo `git pull --rebase` ausführen, Konflikt lösen, `git push`. Danach funktioniert der Export wieder normal. |
| Push abgelehnt (keine Rechte, geschützter Branch, kein Upstream) | Der Commit bleibt lokal | Rechte, Branch-Richtlinien bzw. Upstream klären. Der nächste Export mit `--push` schickt den liegengebliebenen Commit mit. |

### Eigener Befehl nach dem Export

Mit `--after-export` läuft nach dem Export (und nach Commit und Push) ein beliebiger Shell-Befehl, z. B. um eine Pipeline zu starten oder jemanden zu benachrichtigen. Er läuft im Ordner der `localize.json` und bekommt diese Umgebungsvariablen:

| Variable              | Inhalt                                                     |
| --------------------- | ---------------------------------------------------------- |
| `LOCALIZE_ME_FILE`    | absoluter Pfad zur `localize.json`                         |
| `LOCALIZE_ME_FILES`   | alle exportierten Dateien, absolute Pfade, eine pro Zeile  |
| `LOCALIZE_ME_CHANGED` | nur die Dateien, die sich geändert haben                   |
| `LOCALIZE_ME_COMMITS` | Hashes der neuen Commits, durch Leerzeichen getrennt (leer ohne Commit) |

```bash
localize-me dev --push --after-export "sh pipeline.sh"
```

```sh
# pipeline.sh – startet eine Azure-Pipeline, aber nur, wenn es einen neuen Commit gibt
[ -z "$LOCALIZE_ME_COMMITS" ] && exit 0
curl -sf -u ":$AZURE_DEVOPS_TOKEN" -H "Content-Type: application/json" -d '{}' \
  "https://dev.azure.com/firma/projekt/_apis/pipelines/42/runs?api-version=7.1"
```

- Schlägt der Befehl fehl (Exit-Code ungleich 0), zeigt die Oberfläche seine Ausgabe an. Nach 5 Minuten wird er abgebrochen.
- Schlägt schon Git fehl, wird der Befehl übersprungen.
- Oft geht es auch ohne eigenen Befehl: Eine Pipeline mit Trigger auf den Branch startet nach jedem Push von selbst.

> **Warum nur über die Kommandozeile?** `--commit`, `--push` und `--after-export` lassen sich bewusst nicht in der `localize.json` einstellen. Sonst könnte jeder, der die Textdatei ändern darf, Befehle auf dem Rechner bzw. Server ausführen.

## Im Team auf einem Server (Docker)

Statt dass jeder localize-me lokal startet, kann es zentral in einem Container laufen. Das Team arbeitet dann im Browser auf demselben Stand.

```
Browser (VPN) ──► Container: localize-me ──► Volume /data/repo ──push──► Azure Repos ──► Pipeline baut die Apps
```

> **Es gibt keinen Login.** Wer die Adresse erreicht, kann alle Texte lesen und ändern. Betreib den Container nur intern (Firmennetz, VPN) oder setz einen Reverse Proxy mit Anmeldung davor (z. B. Entra ID bei Azure App Service / Container Apps, nginx mit Basic Auth). Nicht öffentlich ins Internet stellen.

### Variante A: mit Git (empfohlen)

Jeder Export wird ein Commit im App-Repo. Damit sind die Texte versioniert und liegen nicht nur auf dem Server.

**1. Repo vorbereiten.** Leg die `localize.json` ins App-Repo, `output` zeigt relativ dazu auf die Ressourcen-Ordner:

```json
{
  "base": "de",
  "languages": [{ "code": "de", "name": "Deutsch" }],
  "output": { "ios": "ios/MeineApp/Resources", "android": "android/app/src/main/res" },
  "keys": {}
}
```

Leg außerdem den Branch an, auf den localize-me pushen soll (z. B. `texte`), falls er noch nicht existiert.

**2. `entrypoint.sh` und `Dockerfile`** in einen Ordner legen.

`entrypoint.sh`:

```sh
#!/bin/sh
set -e
# Token kommt aus der Umgebung und landet nicht in .git/config.
git config --global credential.helper '!f() { echo username=localize-me; echo "password=$GIT_TOKEN"; }; f'
if [ ! -d /data/repo/.git ]; then
  git clone ${GIT_BRANCH:+-b "$GIT_BRANCH"} "$GIT_REPO" /data/repo
fi
exec ./node_modules/.bin/localize-me dev --host 0.0.0.0 --no-open --push \
  --file "/data/repo/${LOCALIZE_FILE:-localize.json}"
```

`Dockerfile`:

```dockerfile
FROM node:20-alpine
RUN apk add --no-cache git
WORKDIR /app
RUN npm i @alexandercreates/localize-me
COPY entrypoint.sh .
ENV GIT_AUTHOR_NAME="localize-me" GIT_AUTHOR_EMAIL="localize-me@firma.de" \
    GIT_COMMITTER_NAME="localize-me" GIT_COMMITTER_EMAIL="localize-me@firma.de"
EXPOSE 4848
CMD ["sh", "entrypoint.sh"]
```

**3. Bauen und starten:**

```bash
docker build -t localize-me .
docker run -d --name localize-me --restart unless-stopped -p 4848:4848 -v localize-data:/data \
  -e GIT_REPO=https://dev.azure.com/firma/projekt/_git/app \
  -e GIT_BRANCH=texte \
  -e GIT_TOKEN=<PAT> \
  localize-me
```

| Variable        | Bedeutung                                                         | Pflicht |
| --------------- | ----------------------------------------------------------------- | ------- |
| `GIT_REPO`      | HTTPS-Adresse des App-Repos                                       | ja      |
| `GIT_TOKEN`     | Zugangstoken, bei Azure Repos ein PAT mit „Code (Read & Write)“   | ja (bei HTTPS mit Anmeldung) |
| `GIT_BRANCH`    | Branch, auf dem gearbeitet wird; muss im Remote schon existieren  | nein (Standard-Branch des Repos) |
| `LOCALIZE_FILE` | Pfad der `localize.json` im Repo                                  | nein (`localize.json`) |

Beim ersten Start klont der Container das Repo auf das Volume. Bei späteren Starts nutzt er den vorhandenen Klon weiter. Neue Commits holt er bei jedem Export mit `git pull --rebase`.

**Hinweise für den Betrieb:**

- **Token:** Am besten von einem eigenen Service-Account. Als Secret übergeben (Container Apps: Secret → Umgebungsvariable), nie ins Image schreiben.
- **Geschützte Branches:** Ist `main` per Richtlinie geschützt, lehnt Azure Repos den Push ab. Dann auf einem eigenen Branch arbeiten (`GIT_BRANCH=texte`) und per Pull Request mergen, oder dem Service-Account den direkten Push erlauben.
- **Konflikte lösen** (siehe [Wenn etwas schiefgeht](#wenn-etwas-schiefgeht)): `docker exec -it localize-me sh`, dann `cd /data/repo && git pull --rebase`, Konflikt lösen, `git push`.
- **Pipeline:** Eine Azure-Pipeline mit Trigger auf den Branch (bzw. auf die Pfade der String-Dateien) baut nach jedem Export automatisch. Alternativ startest du sie per [`--after-export`](#eigener-befehl-nach-dem-export). Braucht dein Skript `curl`, ergänze im Dockerfile `apk add --no-cache git curl`.

### Variante B: ohne Git

Nur die Oberfläche, die Texte liegen ausschließlich auf dem Volume.

```dockerfile
FROM node:20-alpine
WORKDIR /app
RUN npm i @alexandercreates/localize-me
EXPOSE 4848
CMD ["./node_modules/.bin/localize-me", "dev", "--host", "0.0.0.0", "--file", "/data/localize.json", "--no-open"]
```

```bash
docker build -t localize-me .
docker run -d --restart unless-stopped -p 4848:4848 -v localize-data:/data localize-me
```

Sicher das Volume dann regelmäßig per Backup, sonst gibt es keine Kopie der Texte. Die Dateien für die Apps holst du dir als CSV aus der Oberfläche.

### Für beide Varianten

- **Persistenter Speicher:** `/data` muss ein Volume sein (bei Azure z. B. Azure Files), sonst sind die Texte nach einem Neustart oder Redeploy weg. Bei Variante B gibt es dann gar keine Kopie mehr, bei Variante A fehlen die nicht gepushten Änderungen.
- **Neustarts:** Mit `--restart unless-stopped` (bzw. als Azure Container App oder App Service) startet der Container nach einem Absturz oder Server-Neustart von selbst wieder.
- **Reverse Proxy:** Der Proxy muss den ursprünglichen `Host`-Header durchreichen (nginx: `proxy_set_header Host $host;`). Sonst lehnt localize-me Änderungen als fremde Herkunft ab. Läuft localize-me auf `127.0.0.1` und der Proxy auf demselben Rechner, trag dessen Hostnamen mit `--allowed-host` ein.
- **Mehrere Personen gleichzeitig** können arbeiten, alle offenen Tabs sehen Änderungen sofort. Bearbeiten zwei Leute denselben Text, gilt der zuletzt gespeicherte. Zwei Exporte gleichzeitig verhindert localize-me.
- **Netzlaufwerke:** Auf eingebundenen Freigaben (SMB/NFS) bemerkt localize-me oft nicht, wenn *andere Rechner* die Datei ändern. Dann den Container neu starten, sonst überschreibt die nächste Bearbeitung in der Oberfläche diese Änderung. Wenn ihr die Datei nur über die Oberfläche ändert, betrifft euch das nicht.

## Dateiformat

```json
{
  "base": "de",
  "languages": [
    { "code": "de", "name": "Deutsch" },
    { "code": "en", "name": "Englisch" }
  ],
  "output": { "ios": "../ios/MeineApp/Resources", "android": "../android/app/src/main/res" },
  "keys": {
    "home.greeting": {
      "de": "Hallo #name, schön dich zu sehen.",
      "en": "Hi #name, nice to see you."
    }
  }
}
```

Keys werden alphabetisch gespeichert, damit Git-Diffs klein bleiben. Änderst du die Datei von außen (z. B. durch `git pull`), aktualisiert sich die offene Oberfläche automatisch.

Entfernst du eine Zielsprache, bleiben ihre Texte in der Datei. Legst du die Sprache später wieder an, sind sie sofort wieder da.

## Entwicklung

```bash
git clone https://github.com/alexandercreates/localize-me.git
cd localize-me
npm install
npm run dev     # Oberfläche mit Hot Reload, Texte aus example/localize.json
npm run build   # baut die Oberfläche nach ui/
npm start       # gebaute Version so starten, wie Nutzer sie bekommen
npm test
```

Die Oberfläche ist mit Svelte 5 und Vite gebaut, der Quellcode liegt in `web/`. Svelte und Vite sind nur Entwicklungs-Abhängigkeiten: `npm pack` bzw. `npm publish` baut vorher automatisch nach `ui/`, das veröffentlichte Paket hat keine Abhängigkeiten. Platzhalter-Logik und CSV-Aufbau (`src/placeholders.js`, `src/csv.js`) teilen sich Server, CLI und Oberfläche.

Voraussetzung: Node.js 18.18 oder neuer zum Benutzen, Node.js 20.19 oder neuer zum Entwickeln (wegen Vite).

## Lizenz

[MIT](LICENSE) – du darfst localize-me frei nutzen, auch in kommerziellen Projekten, solange der Lizenzhinweis erhalten bleibt.

Die Oberfläche bringt Schriften (Geist, Geist Mono, Bricolage Grotesque – SIL Open Font License 1.1), Icons (Lucide – ISC) und die Svelte-Laufzeit (MIT) mit. Deren Lizenztexte stehen in [THIRD_PARTY_LICENSES](THIRD_PARTY_LICENSES) und werden mit dem npm-Paket ausgeliefert.
