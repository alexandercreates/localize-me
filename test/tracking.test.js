import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildTrackingStrings, buildTrackingXml, checkTracking, trackingFiles, trackingResourceName, trackingStringsKey } from "../src/tracking.js";
import { exportTargets, writeTargets } from "../src/outputs.js";
import { normalize, serialize, Store, ValidationError } from "../src/store.js";
import { createServer, listen } from "../src/server.js";

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "cli.js");
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "localize-tracking-"));

const project = normalize({
  base: "de",
  keys: {},
  tracking: {
    screens: { startseite: { value: "app/startseite", description: "Nach dem Login" }, "item.detail": { value: "app/detail" } },
    events: { kauf: { value: "Order Completed" } },
    parameters: { item_id: { value: "item_id", description: "Artikelnummer" } },
  },
});

test("Präfix je Typ: auf iOS mit Punkt, auf Android mit Unterstrich", () => {
  assert.equal(trackingStringsKey("screens", "startseite"), "screen.startseite");
  assert.equal(trackingStringsKey("events", "kauf"), "event.kauf");
  assert.equal(trackingResourceName("screens", "startseite"), "screen_startseite");
  assert.equal(trackingResourceName("events", "kauf"), "event_kauf");
  assert.equal(trackingResourceName("parameters", "item.id-top"), "parameter_item_id_top");
});

test("iOS: einfache .strings-Datei", () => {
  assert.equal(buildTrackingStrings(project), [
    "/* Erzeugt von localize-me aus localize.json – nicht von Hand bearbeiten. */",
    "",
    '"screen.item.detail" = "app/detail";',
    "/* Nach dem Login */",
    '"screen.startseite" = "app/startseite";',
    "",
    '"event.kauf" = "Order Completed";',
    "",
    "/* Artikelnummer */",
    '"parameter.item_id" = "item_id";',
    "",
  ].join("\n"));
});

test("Android: Datei wie strings.xml, nicht übersetzbar", () => {
  assert.equal(buildTrackingXml(project), [
    '<?xml version="1.0" encoding="utf-8"?>',
    "<!-- Erzeugt von localize-me aus localize.json – nicht von Hand bearbeiten. -->",
    "<resources>",
    '    <string name="screen_item_detail" translatable="false">app/detail</string>',
    "    <!-- Nach dem Login -->",
    '    <string name="screen_startseite" translatable="false">app/startseite</string>',
    "",
    '    <string name="event_kauf" translatable="false">Order Completed</string>',
    "",
    "    <!-- Artikelnummer -->",
    '    <string name="parameter_item_id" translatable="false">item_id</string>',
    "</resources>",
    "",
  ].join("\n"));
});

test("Value darf alles sein und wird je Format escaped", () => {
  const value = `a/b "c" 'd' \\e & <f> 100% @g\nh`;
  const p = normalize({ keys: {}, tracking: { events: { x: { value } } } });
  assert.match(buildTrackingStrings(p), /"event\.x" = "a\/b \\"c\\" 'd' \\\\e & <f> 100% @g\\nh";/);
  assert.match(buildTrackingXml(p), /<string name="event_x" translatable="false" formatted="false">a\/b \\"c\\" \\'d\\' \\\\e &amp; &lt;f&gt; 100% @g\\nh<\/string>/);
  assert.equal(p.tracking.events.x.value, value);
});

test("Value bleibt Zeichen für Zeichen, Android bewahrt Leerzeichen und führendes @", () => {
  const p = normalize({ keys: {}, tracking: { events: { a: { value: " a  b " }, b: { value: "@x" } } } });
  assert.equal(p.tracking.events.a.value, " a  b ");
  assert.match(buildTrackingStrings(p), /"event\.a" = " a {2}b ";/);
  assert.match(buildTrackingXml(p), />" a {2}b "<\/string>/);
  assert.match(buildTrackingXml(p), />\\@x<\/string>/);
});

test("Ein fehlender Value wird nicht ersetzt, der Export bricht ab und schreibt nichts", () => {
  const dir = tmpDir();
  try {
    const p = normalize({ keys: { t: { de: "x" } }, base: "de", tracking: { screens: { a: {}, b: { value: "" }, c: { value: " " }, d: { value: 1 }, ok: { value: "x" } } } });
    assert.deepEqual(p.tracking.screens, { a: {}, b: { value: "" }, c: { value: " " }, d: { value: 1 }, ok: { value: "x" } });
    assert.equal((checkTracking(p).join("\n").match(/Der Value fehlt/g) || []).length, 4);
    for (const platform of ["ios", "android"]) assert.throws(() => trackingFiles(p, platform), /Screen „a“: Der Value fehlt/);
    const targets = [{ kind: "localizable", platform: "ios", dir }, { kind: "tracking", platform: "ios", dir }];
    assert.throws(() => writeTargets(p, targets), /Der Value fehlt/);
    assert.deepEqual(fs.readdirSync(dir), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("Value und Beschreibung können nichts in die Datei schmuggeln", () => {
  const separator = String.fromCharCode(0x2028);
  const evil = `x */ "evil" = "1"; /* y --> <string name="evil">1</string> <!-- z\n"evil2" = "2";\r\n${separator}<evil3/>---`;
  const p = normalize({ keys: {}, tracking: { events: { a: { value: "x", description: evil } } } });
  const strings = buildTrackingStrings(p).split("\n").filter((l) => /evil/.test(l));
  assert.equal(strings.length, 1);
  assert.doesNotMatch(strings[0].replace(/^\/\*/, "").replace(/\*\/$/, ""), /\*\/|\/\*/);
  const xml = buildTrackingXml(p).split("\n").filter((l) => /evil/.test(l));
  assert.equal(xml.length, 1);
  assert.doesNotMatch(xml[0].trim().replace(/^<!--/, "").replace(/-->$/, ""), /--/);

  const asValue = normalize({ keys: {}, tracking: { events: { a: { value: `"; "evil" = "1"; </string><evil/>` } } } });
  assert.match(buildTrackingStrings(asValue), /= "\\"; \\"evil\\" = \\"1\\"; <\/string><evil\/>";/);
  assert.doesNotMatch(buildTrackingXml(asValue), /<evil\/>|<\/string>&|<\/string><evil/);
});

test("Prüfung: doppelte Android-Namen und ungültige Keys aus einer bearbeiteten Datei", () => {
  const p = normalize({ keys: {}, tracking: { parameters: { item_id: { value: "a" }, "item.id": { value: "b" } }, screens: { "app/start": { value: "a" }, 'x"; drop': { value: "b" }, "a b": { value: "c" } } } });
  const problems = checkTracking(p).join("\n");
  assert.match(problems, /ergeben beide den Android-Namen parameter_item_id/);
  assert.equal((problems.match(/Keys beginnen mit einem Buchstaben/g) || []).length, 3);
  assert.throws(() => trackingFiles(p, "ios"), /parameter_item_id/);
});

test("Gleicher Key in verschiedenen Bereichen ist erlaubt", () => {
  assert.deepEqual(checkTracking(normalize({ keys: {}, tracking: { screens: { home: { value: "a" } }, events: { home: { value: "a" } } } })), []);
});

test("Kollision mit strings.xml stoppt nur den Android-Export", () => {
  const p = normalize({ base: "de", keys: { "screen.home": { de: "Start" } }, tracking: { screens: { home: { value: "home" } } } });
  assert.equal(trackingFiles(p, "ios").length, 1);
  assert.throws(() => trackingFiles(p, "android"), /„home“ und der Text-Key „screen\.home“ ergeben beide den Android-Namen screen_home/);
  const onlyIos = normalize({ base: "de", only: { "screen.home": "ios" }, keys: { "screen.home": { de: "Start" } }, tracking: { screens: { home: { value: "home" } } } });
  assert.equal(trackingFiles(onlyIos, "android").length, 1);
});

test("Steuerzeichen im Value stoppen nur den Android-Export", () => {
  const p = normalize({ keys: {}, tracking: { events: { a: { value: `x${String.fromCharCode(1)}y` } } } });
  assert.equal(trackingFiles(p, "ios").length, 1);
  assert.throws(() => trackingFiles(p, "android"), /Steuerzeichen/);
});

test("Projekte ohne Tracking bleiben Zeichen für Zeichen gleich", () => {
  const plain = { base: "de", languages: [{ code: "de", name: "Deutsch" }], output: { ios: "x" }, keys: { a: { de: "b" } } };
  assert.equal(serialize(plain), JSON.stringify(plain, null, 2) + "\n");
  assert.equal(normalize({ keys: {}, tracking: { screens: {}, events: {} } }).tracking, undefined);
});

test("output.tracking wird zu eigenen Zielen, unabhängig von den Texten", () => {
  const p = normalize({ keys: {}, output: { ios: "res", tracking: { android: " gen ", web: "x" } } });
  assert.deepEqual(p.output, { ios: "res", tracking: { android: "gen" } });
  assert.deepEqual(exportTargets(p, "/a/texte/localize.json"), [
    { kind: "localizable", platform: "ios", dir: path.resolve("/a/texte/res") },
    { kind: "tracking", platform: "android", dir: path.resolve("/a/texte/gen") },
  ]);
});

test("Ein Fehler im Tracking schreibt auch die Texte nicht", () => {
  const dir = tmpDir();
  try {
    const p = normalize({ keys: { a: { de: "x" } }, base: "de", tracking: { events: { a_b: { value: "a" }, "a.b": { value: "b" } } } });
    const targets = [{ kind: "localizable", platform: "ios", dir }, { kind: "tracking", platform: "ios", dir }];
    assert.throws(() => writeTargets(p, targets), /event_a_b/);
    assert.deepEqual(fs.readdirSync(dir), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("Store: anlegen, ändern, umbenennen und löschen", () => {
  const dir = tmpDir();
  try {
    const store = new Store(path.join(dir, "localize.json"));
    store.addTrackingItem("screens", "startseite", { value: "app/startseite", description: " Start " });
    assert.deepEqual(store.project.tracking.screens.startseite, { value: "app/startseite", description: "Start" });
    store.addTrackingItem("events", "kauf", { value: "Order Completed" });

    store.updateTrackingItem("screens", "startseite", { key: "home" });
    assert.deepEqual(store.project.tracking.screens, { home: { value: "app/startseite", description: "Start" } });
    store.updateTrackingItem("screens", "home", { value: " a/b " });
    assert.equal(store.project.tracking.screens.home.value, " a/b ");
    store.updateTrackingItem("screens", "home", { description: "" });
    assert.deepEqual(store.project.tracking.screens.home, { value: " a/b " });

    store.deleteTrackingItem("screens", "home");
    store.deleteTrackingItem("events", "kauf");
    assert.equal(store.project.tracking, undefined);
    assert.doesNotMatch(fs.readFileSync(store.file, "utf8"), /tracking/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("Store: Ein mitgetipptes Präfix entsteht nicht doppelt", () => {
  const dir = tmpDir();
  try {
    const store = new Store(path.join(dir, "localize.json"));
    store.addTrackingItem("screens", "screen.start", { value: "start" });
    store.addTrackingItem("screens", "screen_profil", { value: "profil" });
    store.addTrackingItem("events", "screen.start", { value: "x" });
    assert.deepEqual(Object.keys(store.project.tracking.screens), ["profil", "start"]);
    assert.ok(store.project.tracking.events["screen.start"], "fremdes Präfix bleibt Teil des Keys");
    assert.equal(store.project.tracking.screens.start.value, "start");
    store.updateTrackingItem("screens", "start", { key: "screen.home" });
    assert.ok(store.project.tracking.screens.home);
    assert.throws(() => store.addTrackingItem("screens", "screen.home", { value: "x" }), /gibt es schon/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("Store weist ungültige Eingaben ab", () => {
  const dir = tmpDir();
  try {
    const store = new Store(path.join(dir, "localize.json"));
    store.addTrackingItem("parameters", "item_id", { value: "item_id" });
    const rejected = [
      () => store.addTrackingItem("nope", "x", { value: "x" }),
      () => store.addTrackingItem("__proto__", "x", { value: "x" }),
      () => store.addTrackingItem("events", "", { value: "x" }),
      () => store.addTrackingItem("events", "__proto__", { value: "x" }),
      () => store.addTrackingItem("events", 'x"; evil()', { value: "x" }),
      () => store.addTrackingItem("events", "app/start", { value: "x" }),
      () => store.addTrackingItem("events", "mit leerzeichen", { value: "x" }),
      () => store.addTrackingItem("parameters", "item_id", { value: "x" }),
      () => store.addTrackingItem("parameters", "item.id", { value: "x" }),
      () => store.addTrackingItem("events", "x"),
      () => store.addTrackingItem("events", "x", { value: "" }),
      () => store.addTrackingItem("events", "x", { value: "  " }),
      () => store.addTrackingItem("events", "x", { value: 1 }),
      () => store.updateTrackingItem("parameters", "item_id", { value: "" }),
      () => store.updateTrackingItem("parameters", "item_id", { value: "  " }),
      () => store.updateTrackingItem("events", "constructor", {}),
      () => store.updateTrackingItem("parameters", "item_id", { value: null }),
      () => store.updateTrackingItem("parameters", "item_id", { description: 1 }),
      () => store.updateTrackingItem("parameters", "item_id", { key: "a/b" }),
      () => store.deleteTrackingItem("events", "constructor"),
    ];
    for (const attempt of rejected) assert.throws(attempt, ValidationError);
    // Nur die Schreibweise ändern ist kein Konflikt mit sich selbst.
    store.updateTrackingItem("parameters", "item_id", { key: "item.id" });
    assert.ok(store.project.tracking.parameters["item.id"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("API: anlegen und exportieren, Antwort nennt die Dateiart", async (t) => {
  const dir = tmpDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "localize.json");
  fs.writeFileSync(file, JSON.stringify({ keys: { a: { de: "x" } }, base: "de", output: { ios: "res", tracking: { ios: "gen" } } }));
  const { server } = createServer({ file, uiDir: null });
  const port = await listen(server, { port: 0, tries: 0 });
  t.after(() => server.close());
  const api = async (method, url, body) => {
    const res = await fetch(`http://127.0.0.1:${port}${url}`, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body && JSON.stringify(body) });
    return { status: res.status, data: await res.json() };
  };

  assert.equal((await api("POST", "/api/tracking/screens", { key: "startseite", value: "app/startseite" })).status, 201);
  assert.equal((await api("POST", "/api/tracking/events", { key: "kauf", value: "Order Completed" })).status, 201);
  assert.equal((await api("POST", "/api/tracking/nope", { key: "x", value: "x" })).status, 400);
  assert.equal((await api("POST", "/api/tracking/screens", { key: "app/start", value: "x" })).status, 400);
  assert.equal((await api("POST", "/api/tracking/screens", { key: "ohne" })).status, 400);
  assert.equal((await api("PATCH", "/api/tracking/screens/startseite", { value: "" })).status, 400);
  const patched = await api("PATCH", "/api/tracking/events/kauf", { description: "Kauf" });
  assert.equal(patched.data.tracking.events.kauf.description, "Kauf");
  assert.equal((await api("DELETE", "/api/tracking/events/kauf")).status, 200);

  const { data } = await api("POST", "/api/export/native");
  assert.deepEqual(data.files.map((f) => [f.kind, f.file]), [
    ["localizable", path.join("res", "de.lproj", "Localizable.strings")],
    ["tracking", path.join("gen", "Tracking.strings")],
  ]);
  assert.match(fs.readFileSync(path.join(dir, "gen", "Tracking.strings"), "utf8"), /"screen\.startseite" = "app\/startseite";/);
});

test("CLI: --kind grenzt ein, --out schreibt ohne --kind weiter nur Texte", () => {
  const dir = tmpDir();
  try {
    const file = path.join(dir, "localize.json");
    fs.writeFileSync(file, serialize({
      ...project,
      keys: { a: { de: "x" } },
      output: { ios: "res", tracking: { ios: "gen/ios", android: "gen/android" } },
    }));
    const run = (...args) => spawnSync(process.execPath, [CLI, "export", "--file", file, ...args], { cwd: dir, encoding: "utf8" });

    assert.equal(run("--kind", "tracking", "--platform", "ios").status, 0);
    assert.ok(fs.existsSync(path.join(dir, "gen", "ios", "Tracking.strings")));
    assert.ok(!fs.existsSync(path.join(dir, "gen", "android")));
    assert.ok(!fs.existsSync(path.join(dir, "res")));

    assert.equal(run().status, 0);
    assert.match(fs.readFileSync(path.join(dir, "gen", "android", "values", "tracking.xml"), "utf8"), /name="screen_startseite"/);
    assert.ok(fs.existsSync(path.join(dir, "res", "de.lproj", "Localizable.strings")));

    assert.equal(run("--platform", "ios", "--out", "once").status, 0);
    assert.deepEqual(fs.readdirSync(path.join(dir, "once")), ["de.lproj"]);
    assert.equal(run("--kind", "tracking", "--platform", "android", "--out", "xml").status, 0);
    assert.ok(fs.existsSync(path.join(dir, "xml", "values", "tracking.xml")));

    assert.match(run("--kind", "nope").stderr, /Unbekannte Dateiart/);
    assert.match(run("--kind", "tracking", "--format", "csv").stderr, /gilt nur für --format native/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const nasty = `a/b "c" 'd' \\e & <f> 100% @g\nh`;

// plutil gibt es nur auf macOS. Es liest .strings-Dateien so streng wie der Build in Xcode.
const plutil = spawnSync("plutil", ["-help"]).status === 0;
test("iOS: Die Datei ist gültig und liefert die Values unverändert", { skip: !plutil && "plutil fehlt" }, () => {
  const dir = tmpDir();
  try {
    const file = path.join(dir, "Tracking.strings");
    fs.writeFileSync(file, buildTrackingStrings(normalize({ keys: {}, tracking: { screens: { startseite: { value: "app/startseite" } }, events: { x: { value: nasty, description: 'a */ b /* c' } } } })));
    const json = execFileSync("plutil", ["-convert", "json", "-o", "-", file], { encoding: "utf8" });
    assert.deepEqual(JSON.parse(json), { "screen.startseite": "app/startseite", "event.x": nasty });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// xmllint gibt es nicht überall. Eine Beschreibung mit „--“ würde die Datei sonst für aapt unlesbar machen.
const xmllint = spawnSync("xmllint", ["--version"]).status === 0;
test("Android: Die Datei ist wohlgeformtes XML", { skip: !xmllint && "xmllint fehlt" }, () => {
  const dir = tmpDir();
  try {
    const description = 'a -- b --- <c> & "d" --> -';
    const file = path.join(dir, "tracking.xml");
    fs.writeFileSync(file, buildTrackingXml(normalize({ keys: {}, tracking: { screens: { home: { value: nasty, description } }, events: { a: { value: " a  b " } } } })));
    execFileSync("xmllint", ["--noout", file], { stdio: "pipe" });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
