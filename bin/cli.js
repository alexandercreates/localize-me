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
import { addScripts } from "../src/project.js";

const pkg = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "package.json"), "utf8"));

const HELP = `localize-me ${pkg.version}

Verwendung:
  localize-me [dev]        Oberfläche starten (Standard)
  localize-me export       CSV exportieren
  localize-me init         Start-Skript in package.json eintragen und localize.json anlegen

Optionen für dev:
  --port <n>               Port (Standard: 4848, belegt → nächster freier)
  --file <pfad>            Datei mit den Texten (Standard: localize.json)
  --no-open                Browser nicht automatisch öffnen

Optionen für export:
  --platform <ios|android|raw>   Platzhalter umwandeln (Standard: raw)
  --langs <de,en>          Sprachen in Spaltenreihenfolge (Standard: alle, Basis zuerst)
  --delimiter <;|,>        Trennzeichen (Standard: ;)
  --out <pfad>             Zieldatei (Standard: strings_<sprachen>_<plattform>.csv)
  --file <pfad>            Datei mit den Texten (Standard: localize.json)
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
      file: { type: "string" },
      "no-open": { type: "boolean" },
      platform: { type: "string" },
      langs: { type: "string" },
      delimiter: { type: "string" },
      out: { type: "string" },
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

if (opts.help) { console.log(HELP); process.exit(0); }
if (opts.version) { console.log(pkg.version); process.exit(0); }

switch (command) {
  case "dev":
    await dev();
    break;
  case "export":
    exportCsv();
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

  let server;
  try {
    ({ server } = createServer({ file }));
  } catch (e) {
    fail(e.message);
  }
  let actual;
  try {
    actual = await listen(server, { port });
  } catch (e) {
    fail(`Server konnte nicht starten: ${e.message}`);
  }
  const url = `http://localhost:${actual}`;
  console.log(`\n  localize-me läuft auf ${url}`);
  console.log(`  Texte: ${path.relative(process.cwd(), file) || file}\n`);
  if (!opts["no-open"] && !process.env.CI) openBrowser(url);

  const stop = () => { server.close(); process.exit(0); };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

function exportCsv() {
  if (!fs.existsSync(file)) fail(`${path.relative(process.cwd(), file)} gibt es nicht. Starte zuerst die Oberfläche oder nutze --file.`);
  const platform = opts.platform || "raw";
  if (!PLATFORMS.includes(platform)) fail(`Unbekannte Plattform „${platform}“. Erlaubt: ${PLATFORMS.join(", ")}`);
  const delimiter = opts.delimiter === "," ? "," : ";";

  let store;
  try { store = new Store(file); } catch (e) { fail(e.message); }
  const project = store.project;
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
