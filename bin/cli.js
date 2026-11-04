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
import { NATIVE_PLATFORMS } from "../src/native.js";
import { FILE_KINDS, exportTargets, writeTargets } from "../src/outputs.js";
import { addScripts } from "../src/project.js";
import { isPluralValue } from "../src/plurals.js";
import { afterExport, checkBranchName, failed } from "../src/versioning.js";
import { publicConfigFromEnv } from "../src/public-url.js";

const pkg = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "package.json"), "utf8"));

const HELP = `localize-me ${pkg.version}

Verwendung:
  localize-me [dev]        Oberfläche starten (Standard)
  localize-me export       Texte und Tracking-Namen für iOS/Android schreiben bzw. CSV exportieren
  localize-me init         Start-Skript in package.json eintragen und localize.json anlegen

Optionen für dev:
  --port <n>               Port (Standard: 4848, belegt → nächster freier)
  --host <adresse>         Netzwerk-Adresse (Standard: 127.0.0.1, nur dieser Rechner;
                           0.0.0.0 für Docker/Server – ohne Login, siehe README)
  --allowed-host <namen>   Weitere Hostnamen, unter denen die Oberfläche lokal erreichbar ist,
                           z. B. hinter einem Reverse Proxy (kommagetrennt)
  --public-base-path <pfad>  Öffentlicher Pfadpräfix, den ein Reverse Proxy entfernt, z. B. /tools/app
                           (Umgebung: PUBLIC_BASE_PATH)
  --public-origin <origin>   Öffentliche Origin ohne Pfad, z. B. https://tools.example.org
                           (Umgebung: PUBLIC_ORIGIN)
  --trusted-proxy <ips>    IP-Adressen/CIDR-Bereiche, deren X-Forwarded-Host/-Proto gelten (kommagetrennt,
                           Umgebung: PUBLIC_TRUSTED_PROXIES; Standard: keinem Proxy vertrauen)
  --file <pfad>            Datei mit den Texten (Standard: localize.json)
  --no-open                Browser nicht automatisch öffnen

Optionen für export:
  --format <native|csv>    native: Dateien fürs App-Projekt, csv: Tabelle mit den Texten
                           (Standard: native, wenn localize.json "output" enthält, sonst csv)
  --kind <localizable|tracking>  native: nur diese Dateiart (Standard: alle aus "output",
                           mit --out: localizable)
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
  --localizable-branch <name>  Arbeitsbranch für die Texte (schließt --commit ein)
  --tracking-branch <name>     Arbeitsbranch fürs Tracking (schließt --commit ein)
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
      "public-base-path": { type: "string" },
      "public-origin": { type: "string" },
      "trusted-proxy": { type: "string" },
      file: { type: "string" },
      "no-open": { type: "boolean" },
      platform: { type: "string" },
      format: { type: "string" },
      kind: { type: "string" },
      langs: { type: "string" },
      delimiter: { type: "string" },
      out: { type: "string" },
      commit: { type: "boolean" },
      push: { type: "boolean" },
      message: { type: "string" },
      "localizable-branch": { type: "string" },
      "tracking-branch": { type: "string" },
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
const branches = {
  ...(opts["localizable-branch"] && { localizable: opts["localizable-branch"] }),
  ...(opts["tracking-branch"] && { tracking: opts["tracking-branch"] }),
};
const hasBranches = Object.keys(branches).length > 0;
const versioning = {
  commit: !!opts.commit || hasBranches,
  push: !!opts.push,
  message: opts.message,
  hook: opts["after-export"],
  ...(hasBranches && { branches }),
};

if (opts.help) { console.log(HELP); process.exit(0); }
if (opts.version) { console.log(pkg.version); process.exit(0); }

try {
  Object.values(branches).forEach(checkBranchName);
} catch (e) {
  fail(e.message);
}

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

  const fromEnv = publicConfigFromEnv();
  const publicOptions = {
    publicBasePath: opts["public-base-path"] ?? fromEnv.publicBasePath,
    publicOrigin: opts["public-origin"] ?? fromEnv.publicOrigin,
    trustedProxies: opts["trusted-proxy"] ?? fromEnv.trustedProxies,
  };

  let server, publicConfig;
  try {
    // Ein falscher Wert soll den Dienst nicht stoppen: Die Oberfläche zeigt, was zu tun ist (siehe /api/setup).
    ({ server, publicConfig } = createServer({ file, versioning, host, allowedHosts, ...publicOptions, lenientPublicConfig: true }));
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
  for (const { message } of publicConfig.problems) console.error(`localize-me: ${message} Die Einstellung wird ignoriert.`);
  if (publicConfig.basePath || publicConfig.origin) console.log(`  Öffentlich: ${publicConfig.origin}${publicConfig.basePath}/`);
  console.log(`  Texte: ${path.relative(process.cwd(), file) || file}`);
  if (!["127.0.0.1", "localhost", "::1"].includes(host)) console.log(`  Erreichbar im Netzwerk über ${host} – ohne Login, nur intern betreiben.`);
  const steps = [versioning.push ? "Commit + Push" : versioning.commit && "Commit", versioning.hook && `„${versioning.hook}“`].filter(Boolean);
  if (steps.length) console.log(`  Nach dem Export: ${steps.join(", danach ")}`);
  for (const [kind, branch] of Object.entries(branches)) console.log(`  Arbeitsbranch ${kind}: ${branch}`);
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
  const configured = exportTargets(store.project, file);
  const format = opts.format || (configured.length || opts.kind ? "native" : "csv");
  if (format === "native") await exportNative(store.project, configured);
  else if (format === "csv") {
    if (opts.kind) fail("--kind gilt nur für --format native.");
    if (versioning.commit || versioning.push || versioning.hook) console.warn("localize-me: --commit, --push und --after-export gelten nur für --format native.");
    exportCsv(store.project);
  }
  else fail(`Unbekanntes Format „${format}“. Erlaubt: native, csv`);
}

/** Was geschrieben werden soll: alles aus "output", eingegrenzt über --kind und --platform, oder genau ein Ordner mit --out. */
function chooseTargets(configured) {
  if (opts.out) {
    // --out meint einen Ordner, deshalb ohne --kind wie bisher nur die Texte.
    const kind = opts.kind || "localizable";
    const platforms = opts.platform ? [opts.platform] : configured.filter((t) => t.kind === kind).map((t) => t.platform);
    if (!platforms.length) fail('Kein Ziel: --platform ios|android und --out <ordner> angeben oder "output" in localize.json eintragen.');
    if (platforms.length > 1) fail("--out braucht --platform, weil jede Plattform einen eigenen Ordner hat.");
    return [{ kind, platform: platforms[0], dir: path.resolve(opts.out) }];
  }
  const kinds = configured.filter((t) => !opts.kind || t.kind === opts.kind);
  const targets = kinds.filter((t) => !opts.platform || t.platform === opts.platform);
  if (targets.length) return targets;
  const where = opts.kind === "tracking" ? "output.tracking" : "output";
  if (opts.platform) fail(`Kein Zielordner für ${opts.platform}: --out angeben oder ${where}.${opts.platform} in localize.json eintragen.`);
  fail(`Kein Ziel: --platform ios|android und --out <ordner> angeben oder "${where}" in localize.json eintragen.`);
}

async function exportNative(project, configured) {
  if (opts.kind && !FILE_KINDS.includes(opts.kind)) fail(`Unbekannte Dateiart „${opts.kind}“. Erlaubt: ${FILE_KINDS.join(", ")}`);
  if (opts.platform && !NATIVE_PLATFORMS.includes(opts.platform)) fail(`Unbekannte Plattform „${opts.platform}“. Erlaubt: ${NATIVE_PLATFORMS.join(", ")}`);
  const targets = chooseTargets(configured);

  if (targets.some((t) => t.kind === "localizable")) {
    const empty = Object.keys(project.keys).filter((k) => {
      const value = project.keys[k][project.base];
      return !((isPluralValue(value) ? value.other : value) || "").trim();
    });
    if (empty.length) console.warn(`localize-me: ${empty.length} Keys ohne Text in der Basissprache ${project.base}: ${empty.slice(0, 5).join(", ")}${empty.length > 5 ? " …" : ""}`);
  }

  let all;
  try { all = writeTargets(project, targets); } catch (e) { fail(e.message); }
  for (const { kind, platform, file: out, changed } of all) {
    console.log(`localize-me: ${kind === "localizable" ? platform : `${kind} ${platform}`} → ${path.relative(process.cwd(), out)}${changed ? "" : " (unverändert)"}`);
  }

  if (!versioning.commit && !versioning.push && !versioning.hook) return;
  // Mit --kind oder --out umfasst der Export nur einen Teil, nur der soll auf seinen Branch.
  const kinds = opts.kind || opts.out ? [...new Set(targets.map((t) => t.kind))] : undefined;
  const result = await afterExport(versioning, { file, written: all, kinds });
  for (const r of result.git || []) {
    const where = r.repo ? path.relative(process.cwd(), r.repo) || "." : "";
    if (r.error) console.error(`localize-me: git${where ? ` (${where})` : ""} fehlgeschlagen:\n${r.error}`);
    else if (r.commit) console.log(`localize-me: git (${where}) → Commit ${r.commit}${r.branch ? ` auf ${r.branch}` : ""}${r.pushed ? " erstellt und gepusht" : " erstellt"}`);
    else console.log(`localize-me: git (${where}) → nichts Neues zu committen${r.branch ? ` auf ${r.branch}` : ""}${r.pushed ? ", Repo ist auf dem Stand des Remotes" : ""}`);
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
