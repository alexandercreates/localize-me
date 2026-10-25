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
