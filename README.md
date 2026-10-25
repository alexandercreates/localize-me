# localize-me

Schlanke Übersetzungsverwaltung für iOS- und Android-Apps. Keys anlegen, Texte übersetzen, als `Localizable.strings`/`strings.xml` oder CSV exportieren – ohne Account, ohne Cloud, ohne Abhängigkeiten. Die Texte liegen als `localize.json` in deinem Projekt und lassen sich ganz normal mit Git versionieren.

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

Die CSV ist UTF-8 mit BOM, alle Werte stehen in Anführungszeichen.

## Weitere Optionen

```bash
localize-me dev --port 5000 --file texte/app.json --no-open
```

Ist der Port belegt, nimmt localize-me automatisch den nächsten freien.

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

MIT
