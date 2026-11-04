import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildTrackingStrings, buildTrackingXml, checkTracking, trackingFiles, trackingResourceName } from "../src/tracking.js";
import { exportTargets, writeTargets } from "../src/outputs.js";
import { normalize, serialize, Store, ValidationError } from "../src/store.js";
import { createServer, listen } from "../src/server.js";

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "cli.js");
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "localize-tracking-"));

const project = normalize({
  base: "de",
  keys: {},
  tracking: {
    screens: { home: { description: "Startseite" }, "item.detail": {} },
    events: { "Order Completed": {} },
    parameters: { item_id: { description: "Artikelnummer" }, in: {} },
  },
});

test("Android-Namen entstehen aus Bereich und Name", () => {
  assert.equal(trackingResourceName("parameters", "item_id"), "parameter_item_id");
  assert.equal(trackingResourceName("events", "Order Completed"), "event_Order_Completed");
  assert.equal(trackingResourceName("screens", "item.detail-top"), "screen_item_detail_top");
});

test("iOS: einfache .strings-Datei mit Präfix je Bereich", () => {
  assert.equal(buildTrackingStrings(project), [
    "/* Erzeugt von localize-me aus localize.json – nicht von Hand bearbeiten. */",
    "",
    "/* Startseite */",
    '"screen.home" = "home";',
    '"screen.item.detail" = "item.detail";',
    "",
    '"event.Order Completed" = "Order Completed";',
    "",
    '"parameter.in" = "in";',
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
    "    <!-- Startseite -->",
    '    <string name="screen_home" translatable="false">home</string>',
    '    <string name="screen_item_detail" translatable="false">item.detail</string>',
    "",
    '    <string name="event_Order_Completed" translatable="false">Order Completed</string>',
    "",
    '    <string name="parameter_in" translatable="false">in</string>',
    "    <!-- Artikelnummer -->",
    '    <string name="parameter_item_id" translatable="false">item_id</string>',
    "</resources>",
    "",
  ].join("\n"));
});

test("Mehrere Leerzeichen bleiben auf Android erhalten", () => {
  const p = normalize({ keys: {}, tracking: { events: { "a  b": {} } } });
  assert.match(buildTrackingXml(p), /<string name="event_a__b" translatable="false">"a {2}b"<\/string>/);
});

test("Eine Beschreibung kann nichts in die Datei schmuggeln", () => {
  const separator = String.fromCharCode(0x2028);
  const description = `x */ "evil" = "1"; /* y --> <string name="evil">1</string> <!-- z\n"evil2" = "2";\r\n${separator}<evil3/>---`;
  const p = normalize({ keys: {}, tracking: { events: { a: { description } } } });
  const strings = buildTrackingStrings(p).split("\n").filter((l) => /evil/.test(l));
  assert.equal(strings.length, 1);
  assert.doesNotMatch(strings[0].replace(/^\/\*/, "").replace(/\*\/$/, ""), /\*\/|\/\*/);
  const xml = buildTrackingXml(p).split("\n").filter((l) => /evil/.test(l));
  assert.equal(xml.length, 1);
  assert.doesNotMatch(xml[0].trim().replace(/^<!--/, "").replace(/-->$/, ""), /--/);
});

test("Prüfung: doppelte Android-Namen und ungültige Namen aus einer bearbeiteten Datei", () => {
  const p = normalize({ keys: {}, tracking: { parameters: { item_id: {}, "item.id": {} }, screens: { 'x"; drop': {} } } });
  const problems = checkTracking(p).join("\n");
  assert.match(problems, /ergeben beide den Android-Namen parameter_item_id/);
  assert.match(problems, /Namen beginnen mit einem Buchstaben/);
  assert.throws(() => trackingFiles(p, "ios"), /parameter_item_id/);
});

test("Gleicher Name in verschiedenen Bereichen ist erlaubt", () => {
  assert.deepEqual(checkTracking(normalize({ keys: {}, tracking: { screens: { home: {} }, events: { home: {} } } })), []);
});

test("Kollision mit strings.xml stoppt nur den Android-Export", () => {
  const p = normalize({ base: "de", keys: { "screen.home": { de: "Start" } }, tracking: { screens: { home: {} } } });
  assert.equal(trackingFiles(p, "ios").length, 1);
  assert.throws(() => trackingFiles(p, "android"), /„home“ und der Key „screen\.home“ ergeben beide den Android-Namen screen_home/);
  const onlyIos = normalize({ base: "de", only: { "screen.home": "ios" }, keys: { "screen.home": { de: "Start" } }, tracking: { screens: { home: {} } } });
  assert.equal(trackingFiles(onlyIos, "android").length, 1);
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
    const p = normalize({ keys: { a: { de: "x" } }, base: "de", tracking: { events: { a_b: {}, "a.b": {} } } });
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
    store.addTrackingItem("parameters", "item_id", { description: " Artikel " });
    assert.deepEqual(store.project.tracking.parameters.item_id, { description: "Artikel" });
    store.updateTrackingItem("parameters", "item_id", { name: "article_id" });
    assert.deepEqual(store.project.tracking.parameters, { article_id: { description: "Artikel" } });
    store.updateTrackingItem("parameters", "article_id", { description: "" });
    assert.deepEqual(store.project.tracking.parameters.article_id, {});
    store.deleteTrackingItem("parameters", "article_id");
    assert.equal(store.project.tracking, undefined);
    assert.doesNotMatch(fs.readFileSync(store.file, "utf8"), /tracking/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("Store weist ungültige Eingaben ab", () => {
  const dir = tmpDir();
  try {
    const store = new Store(path.join(dir, "localize.json"));
    store.addTrackingItem("parameters", "item_id");
    const rejected = [
      () => store.addTrackingItem("nope", "x"),
      () => store.addTrackingItem("__proto__", "x"),
      () => store.addTrackingItem("events", ""),
      () => store.addTrackingItem("events", "__proto__"),
      () => store.addTrackingItem("events", 'x"; evil()'),
      () => store.addTrackingItem("parameters", "item_id"),
      () => store.addTrackingItem("parameters", "item.id"),
      () => store.updateTrackingItem("events", "constructor", {}),
      () => store.updateTrackingItem("parameters", "item_id", { description: 1 }),
      () => store.deleteTrackingItem("events", "constructor"),
    ];
    for (const attempt of rejected) assert.throws(attempt, ValidationError);
    // Nur die Schreibweise ändern ist kein Konflikt mit sich selbst.
    store.updateTrackingItem("parameters", "item_id", { name: "item.id" });
    assert.ok(store.project.tracking.parameters["item.id"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("API: Namen anlegen und exportieren, Antwort nennt die Dateiart", async (t) => {
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

  assert.equal((await api("POST", "/api/tracking/parameters", { name: "item_id" })).status, 201);
  assert.equal((await api("POST", "/api/tracking/events", { name: "Order Completed" })).status, 201);
  assert.equal((await api("POST", "/api/tracking/nope", { name: "x" })).status, 400);
  const patched = await api("PATCH", `/api/tracking/events/${encodeURIComponent("Order Completed")}`, { description: "Kauf" });
  assert.equal(patched.data.tracking.events["Order Completed"].description, "Kauf");
  assert.equal((await api("DELETE", "/api/tracking/parameters/item_id")).status, 200);

  const { data } = await api("POST", "/api/export/native");
  assert.deepEqual(data.files.map((f) => [f.kind, f.file]), [
    ["localizable", path.join("res", "de.lproj", "Localizable.strings")],
    ["tracking", path.join("gen", "Tracking.strings")],
  ]);
  assert.match(fs.readFileSync(path.join(dir, "gen", "Tracking.strings"), "utf8"), /"event\.Order Completed" = "Order Completed";/);
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
    assert.match(fs.readFileSync(path.join(dir, "gen", "android", "values", "tracking.xml"), "utf8"), /name="parameter_item_id"/);
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

// plutil gibt es nur auf macOS. Es liest .strings-Dateien so streng wie der Build in Xcode.
const plutil = spawnSync("plutil", ["-help"]).status === 0;
test("iOS: Die Datei ist gültig und liefert die Namen", { skip: !plutil && "plutil fehlt" }, () => {
  const dir = tmpDir();
  try {
    const file = path.join(dir, "Tracking.strings");
    fs.writeFileSync(file, buildTrackingStrings(project));
    const json = execFileSync("plutil", ["-convert", "json", "-o", "-", file], { encoding: "utf8" });
    assert.deepEqual(JSON.parse(json), {
      "screen.home": "home",
      "screen.item.detail": "item.detail",
      "event.Order Completed": "Order Completed",
      "parameter.in": "in",
      "parameter.item_id": "item_id",
    });
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
    fs.writeFileSync(file, buildTrackingXml(normalize({ keys: {}, tracking: { screens: { home: { description } }, events: { "a  b": {} } } })));
    execFileSync("xmllint", ["--noout", file], { stdio: "pipe" });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
