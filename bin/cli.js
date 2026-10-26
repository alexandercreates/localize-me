#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { createServer, listen } from "../src/server.js";
import { Store } from "../src/store.js";
import { buildCsv, csvFilename } from "../src/csv.js";
import { PLATFORMS } from "../src/placeholders.js";
import { NATIVE_PLATFORMS, configuredOutputs, writeNative } from "../src/native.js";
import { addScripts } from "../src/project.js";
import { isPluralValue } from "../src/plurals.js";
import { afterExport, failed } from "../src/versioning.js";

const pkg = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "package.json"), "utf8"));

const HELP = `localize-me ${pkg.version}

Verwendung:
  localize-me [dev]        Oberfläche starten (Standard)
  localize-me export       Dateien für iOS/Android schreiben bzw. CSV exportieren
  localize-me init         Start-Skript in package.json eintragen und localize.json anlegen

Optionen für dev:
  --port <n>               Port (Standard: 4848, belegt → nächster freier)
  --host <adresse>         Netzwerk-Adresse (Standard: 127.0.0.1, nur dieser Rechner;
                           0.0.0.0 für Docker/Server – ohne Login, siehe README)
  --allowed-host <namen>   Weitere Hostnamen, unter denen die Oberfläche lokal erreichbar ist,
                           z. B. hinter einem Reverse Proxy (kommagetrennt)
  --file <pfad>            Datei mit den Texten (Standard: localize.json)
  --no-open                Browser nicht automatisch öffnen

Optionen für export:
  --format <native|csv>    native: Localizable.strings / strings.xml, csv: Tabelle
                           (Standard: native, wenn localize.json "output" enthält, sonst csv)
  --platform <ios|android|raw>   Plattform (native: Standard alle aus "output"; csv: Standard raw)
  --langs <de,en>          CSV: Sprachen in Spaltenreihenfolge (Standard: alle, Basis zuerst)
  --delimiter <;|,>        CSV: Trennzeichen (Standard: ;)
  --out <pfad>             native: Zielordner (Standard: aus "output")
                           csv: Zieldatei (Standard: strings_<sprachen>_<plattform>.csv)
  --file <pfad>            Datei mit den Texten (Standard: localize.json)

Nach dem Export (dev: Button „Dateien schreiben“, export: nur --format native):
  --commit                 localize.json und exportierte Dateien committen
  --push                   wie --commit, danach pull --rebase und push
  --message <text>         Commit-Nachricht (Standard: „Texte aktualisiert (localize-me)“)
  --after-export <befehl>  Befehl ausführen, z. B. "sh push.sh" (Umgebung: LOCALIZE_ME_FILE,
                           LOCALIZE_ME_FILES, LOCALIZE_ME_CHANGED, LOCALIZE_ME_COMMITS)
`;

function fail(message) {
  console.error(`localize-me: ${message}`);
  process.exit(1);
}

let parsed;
try {
  parsed = parseArgs({
    allowPositionals: true,
    options: {
      port: { type: "string" },
      host: { type: "string" },
      "allowed-host": { type: "string" },
      file: { type: "string" },
      "no-open": { type: "boolean" },
      platform: { type: "string" },
      format: { type: "string" },
      langs: { type: "string" },
      delimiter: { type: "string" },
      out: { type: "string" },
      commit: { type: "boolean" },
      push: { type: "boolean" },
      message: { type: "string" },
      "after-export": { type: "string" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
  });
} catch (e) {
  fail(e.message + "\n\n" + HELP);
}

const { values: opts, positionals } = parsed;
const command = positionals[0] || "dev";
const file = path.resolve(opts.file || "localize.json");
const versioning = { commit: !!opts.commit, push: !!opts.push, message: opts.message, hook: opts["after-export"] };

if (opts.help) { console.log(HELP); process.exit(0); }
if (opts.version) { console.log(pkg.version); process.exit(0); }

switch (command) {
  case "dev":
    await dev();
    break;
  case "export":
    await exportCommand();
    break;
  case "init":
    init();
    break;
  default:
    fail(`Unbekannter Befehl „${command}“.\n\n${HELP}`);
}

async function dev() {
  const port = Number(opts.port || process.env.PORT || 4848);
  if (!Number.isInteger(port) || port < 1 || port > 65535) fail(`Ungültiger Port: ${opts.port}`);
  const host = opts.host || "127.0.0.1";
  const allowedHosts = (opts["allowed-host"] || "").split(",").map((h) => h.trim()).filter(Boolean);

  let server;
  try {
    ({ server } = createServer({ file, versioning, host, allowedHosts }));
  } catch (e) {
    fail(e.message);
  }
  let actual;
  try {
    actual = await listen(server, { port, host });
  } catch (e) {
    fail(`Server konnte nicht starten: ${e.message}`);
  }
  const url = `http://localhost:${actual}`;
  console.log(`\n  localize-me läuft auf ${url}`);
  console.log(`  Texte: ${path.relative(process.cwd(), file) || file}`);
  if (!["127.0.0.1", "localhost", "::1"].includes(host)) console.log(`  Erreichbar im Netzwerk über ${host} – ohne Login, nur intern betreiben.`);
  const steps = [versioning.push ? "Commit + Push" : versioning.commit && "Commit", versioning.hook && `„${versioning.hook}“`].filter(Boolean);
  if (steps.length) console.log(`  Nach dem Export: ${steps.join(", danach ")}`);
  console.log("");
  if (!opts["no-open"] && !process.env.CI) openBrowser(url);

  const stop = () => { server.close(); process.exit(0); };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

async function exportCommand() {
  if (!fs.existsSync(file)) fail(`${path.relative(process.cwd(), file)} gibt es nicht. Starte zuerst die Oberfläche oder nutze --file.`);
  let store;
  try { store = new Store(file); } catch (e) { fail(e.message); }
  const outputs = configuredOutputs(store.project, file);
  const format = opts.format || (outputs.length ? "native" : "csv");
  if (format === "native") await exportNative(store.project, outputs);
  else if (format === "csv") {
    if (versioning.commit || versioning.push || versioning.hook) console.warn("localize-me: --commit, --push und --after-export gelten nur für --format native.");
    exportCsv(store.project);
  }
  else fail(`Unbekanntes Format „${format}“. Erlaubt: native, csv`);
}

async function exportNative(project, outputs) {
  if (opts.platform && !NATIVE_PLATFORMS.includes(opts.platform)) fail(`Unbekannte Plattform „${opts.platform}“. Erlaubt: ${NATIVE_PLATFORMS.join(", ")}`);
  const platforms = opts.platform ? [opts.platform] : outputs.map((o) => o.platform);
  if (!platforms.length) fail('Kein Ziel: --platform ios|android und --out <ordner> angeben oder "output" in localize.json eintragen.');
  if (opts.out && platforms.length > 1) fail("--out braucht --platform, weil jede Plattform einen eigenen Ordner hat.");

  const empty = Object.keys(project.keys).filter((k) => {
    const value = project.keys[k][project.base];
    return !((isPluralValue(value) ? value.other : value) || "").trim();
  });
  if (empty.length) console.warn(`localize-me: ${empty.length} Keys ohne Text in der Basissprache ${project.base}: ${empty.slice(0, 5).join(", ")}${empty.length > 5 ? " …" : ""}`);

  const all = [];
  for (const platform of platforms) {
    const dir = opts.out ? path.resolve(opts.out) : outputs.find((o) => o.platform === platform)?.dir;
    if (!dir) fail(`Kein Zielordner für ${platform}: --out angeben oder output.${platform} in localize.json eintragen.`);
    let written;
    try { written = writeNative(project, platform, dir); } catch (e) { fail(e.message); }
    for (const { file: out, changed } of written) {
      console.log(`localize-me: ${platform} → ${path.relative(process.cwd(), out)}${changed ? "" : " (unverändert)"}`);
    }
    all.push(...written);
  }

  if (!versioning.commit && !versioning.push && !versioning.hook) return;
  const result = await afterExport(versioning, { file, written: all });
  for (const r of result.git || []) {
    const where = r.repo ? path.relative(process.cwd(), r.repo) || "." : "";
    if (r.error) console.error(`localize-me: git${where ? ` (${where})` : ""} fehlgeschlagen:\n${r.error}`);
    else if (r.commit) console.log(`localize-me: git (${where}) → Commit ${r.commit}${r.pushed ? " erstellt und gepusht" : " erstellt"}`);
    else console.log(`localize-me: git (${where}) → nichts Neues zu committen${r.pushed ? ", Repo ist auf dem Stand des Remotes" : ""}`);
  }
  if (result.hook) {
    if (result.hook.output) console.log(result.hook.output);
    if (!result.hook.ok) console.error(`localize-me: ${result.hook.error}`);
  }
  if (failed(result)) process.exit(1);
}

function exportCsv(project) {
  const platform = opts.platform || "raw";
  if (!PLATFORMS.includes(platform)) fail(`Unbekannte Plattform „${platform}“. Erlaubt: ${PLATFORMS.join(", ")}`);
  const delimiter = opts.delimiter === "," ? "," : ";";

  const langs = opts.langs
    ? opts.langs.split(",").map((s) => s.trim()).filter(Boolean)
    : [project.base, ...project.languages.map((l) => l.code).filter((c) => c !== project.base)];

  let csv;
  try { csv = buildCsv(project, { platform, languages: langs, delimiter }); } catch (e) { fail(e.message); }
  const out = path.resolve(opts.out || csvFilename(langs, platform));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, csv);
  console.log(`localize-me: ${Object.keys(project.keys).length} Keys → ${path.relative(process.cwd(), out)}`);
}

function init() {
  const result = addScripts(process.cwd());
  if (result.added) console.log(`localize-me: Skript hinzugefügt → npm run ${result.script}`);
  else if (result.reason === "exists") console.log(`localize-me: Skript ist schon da → npm run ${result.script}`);
  else if (result.reason === "no-package-json") console.log("localize-me: Keine package.json gefunden – starte direkt mit npx localize-me.");
  else if (result.reason === "taken") console.log('localize-me: "dev" und "localize" sind schon belegt – trage "localize-me" selbst als Skript ein.');

  const store = new Store(file);
  const existed = fs.existsSync(file);
  store.ensureFile();
  if (!existed) console.log(`localize-me: ${path.relative(process.cwd(), file)} angelegt`);
}

function openBrowser(url) {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    const child = spawn(cmd, args, { stdio: "ignore", detached: true });
    child.on("error", () => {});
    child.unref();
  } catch {
    // Kein Browser verfügbar – die URL steht in der Konsole.
  }
}
