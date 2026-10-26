# Sicherheit

## Lücke melden

Bitte melde Sicherheitslücken **nicht** als öffentliches Issue, sondern vertraulich über
[GitHub → Security → Report a vulnerability](https://github.com/alexandercreates/localize-me/security/advisories/new).

Beschreib kurz, was passiert und wie es sich nachstellen lässt. Du bekommst in der Regel innerhalb
einer Woche eine Antwort. Behoben wird in der jeweils neuesten Version.

## Unterstützte Versionen

Sicherheitsupdates gibt es nur für die neueste veröffentlichte Version auf npm.

## Was localize-me schützt – und was nicht

- **Kein Login.** Wer die Oberfläche erreicht, kann alle Texte lesen und ändern und – falls mit
  `--commit`, `--push` oder `--after-export` gestartet – Commits, Pushes und den eigenen Befehl auslösen.
  Lokal lauscht localize-me deshalb nur auf `127.0.0.1`. Im Netzwerk (`--host 0.0.0.0`) nur intern
  oder hinter einem Reverse Proxy mit Anmeldung betreiben, siehe README.
- **Fremde Webseiten** können über den Browser nichts ändern: Schreibende Anfragen müssen von der
  eigenen Oberfläche kommen, lokal werden nur Anfragen an `localhost` angenommen (Schutz vor
  DNS-Rebinding), und die Oberfläche lässt sich nicht in fremde Seiten einbetten.
- **Befehle** (`--commit`, `--push`, `--after-export`) lassen sich nur über die Kommandozeile setzen,
  nie über `localize.json`.
- **`localize.json`** bestimmt mit `output`, wohin der Export schreibt. Behandle Änderungen daran
  wie Code-Änderungen (Review im Pull Request).
- **Veröffentlichung** auf npm nur aus GitHub Actions per Trusted Publishing mit Provenance –
  `npm view @alexandercreates/localize-me --json` bzw. `npm audit signatures` zeigt die Herkunft.
