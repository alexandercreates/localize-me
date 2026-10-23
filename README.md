# localize-me

Schlanke Übersetzungsverwaltung für iOS- und Android-Apps. Keys anlegen, Texte übersetzen, als CSV exportieren – ohne Account, ohne Cloud, ohne Abhängigkeiten. Die Texte liegen als `localize.json` in deinem Projekt und lassen sich ganz normal mit Git versionieren.

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

In der Oberfläche über **CSV exportieren**, oder auf der Kommandozeile, z. B. im Build:

```bash
npx localize-me export --platform ios
npx localize-me export --platform android --langs de,en --delimiter , --out app/strings.csv
```

| Option        | Werte                       | Standard                              |
| ------------- | --------------------------- | ------------------------------------- |
| `--platform`  | `ios`, `android`, `raw`     | `raw`                                 |
| `--langs`     | Sprachcodes, kommagetrennt  | alle, Basissprache zuerst             |
| `--delimiter` | `;` oder `,`                | `;` (öffnet sauber in deutschem Excel) |
| `--out`       | Pfad                        | `strings_<sprachen>_<plattform>.csv`  |
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
npm run dev     # startet mit example/localize.json
npm test
```

Voraussetzung: Node.js 18.18 oder neuer.

## Lizenz

MIT
