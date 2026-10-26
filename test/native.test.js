import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildIosStrings, buildAndroidXml, checkAndroidNames, valuesDir, lprojName, writeNative, configuredOutputs } from "../src/native.js";
import { normalize, Store, ValidationError } from "../src/store.js";
import { buildCsv } from "../src/csv.js";

const project = normalize({
  base: "de",
  languages: [{ code: "de", name: "Deutsch" }, { code: "en", name: "Englisch" }],
  keys: {
    "home.greeting": { de: "Hallo #name, du hast #count:int Aufgaben", en: "Hi #name, you have #count tasks" },
    "home.title": { de: "Start" },
    "quote": { de: 'Sag "Hallo" & tschüss\nbis bald' },
    "apostrophe": { de: "Kita's Liste", en: "Kita's list" },
    "percent": { de: "100 % dabei" },
    "at": { de: "@kita" },
  },
});

test("iOS: positionsbezogene Platzhalter und Escaping", () => {
  const de = buildIosStrings(project, "de");
  assert.match(de, /^"home\.greeting" = "Hallo %1\$@, du hast %2\$lld Aufgaben";$/m);
  assert.match(de, /^"quote" = "Sag \\"Hallo\\" & tschüss\\nbis bald";$/m);
  assert.match(de, /^"percent" = "100 % dabei";$/m);
});

test("fehlende Übersetzungen fallen weg", () => {
  const en = buildIosStrings(project, "en");
  assert.match(en, /"home\.greeting" = "Hi %1\$@, you have %2\$lld tasks";/);
  assert.doesNotMatch(en, /home\.title/);
  assert.doesNotMatch(buildAndroidXml(project, "en"), /home_title/);
});

test("Android: Namen, Escaping und formatted", () => {
  const de = buildAndroidXml(project, "de");
  assert.match(de, /<string name="home_greeting">Hallo %1\$s, du hast %2\$d Aufgaben<\/string>/);
  assert.match(de, /<string name="quote">Sag \\"Hallo\\" &amp; tschüss\\nbis bald<\/string>/);
  assert.match(de, /<string name="apostrophe">Kita\\'s Liste<\/string>/);
  assert.match(de, /<string name="percent" formatted="false">100 % dabei<\/string>/);
  assert.match(de, /<string name="at">\\@kita<\/string>/);
});

test("Android: Leerzeichen am Rand bleiben erhalten", () => {
  const p = normalize({ base: "de", keys: { pad: { de: " · mehr" } } });
  assert.match(buildAndroidXml(p, "de"), /<string name="pad">" · mehr"<\/string>/);
});

test("Android: Namenskonflikte und ungültige Namen", () => {
  const p = normalize({ base: "de", keys: { "a.b": { de: "x" }, "a_b": { de: "y" }, "1st": { de: "z" } } });
  const problems = checkAndroidNames(p);
  assert.equal(problems.length, 2);
});

test("Ordnernamen je Sprache", () => {
  assert.equal(valuesDir("de", "de"), "values");
  assert.equal(valuesDir("en", "de"), "values-en");
  assert.equal(valuesDir("pt-BR", "de"), "values-pt-rBR");
  assert.equal(valuesDir("zh-Hans", "de"), "values-b+zh+Hans");
  assert.equal(lprojName("pt_BR"), "pt-BR.lproj");
});

test("writeNative schreibt nur Geändertes", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "localize-me-"));
  try {
    const first = writeNative(project, "android", dir);
    assert.deepEqual(first.map((f) => path.relative(dir, f.file)), [path.join("values", "strings.xml"), path.join("values-en", "strings.xml")]);
    assert.ok(first.every((f) => f.changed));
    assert.ok(writeNative(project, "android", dir).every((f) => !f.changed));
    assert.ok(fs.existsSync(path.join(dir, "de.lproj")) === false);
    writeNative(project, "ios", dir);
    assert.ok(fs.existsSync(path.join(dir, "de.lproj", "Localizable.strings")));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("output wird relativ zu localize.json aufgelöst und bleibt beim Normalisieren erhalten", () => {
  const p = normalize({ base: "de", output: { ios: "../ios/Res", android: " ", web: "x" }, keys: {} });
  assert.deepEqual(p.output, { ios: "../ios/Res" });
  assert.deepEqual(configuredOutputs(p, "/a/texte/localize.json"), [{ platform: "ios", dir: path.resolve("/a/ios/Res") }]);
  assert.equal(normalize({ keys: {} }).output, undefined);
});

test("Android: Punkte im Key werden zu Unterstrichen, auch in der CSV", () => {
  const p = normalize({ base: "de", keys: { "onboarding.first.some_text": { de: "Los geht's" } } });
  assert.match(buildAndroidXml(p, "de"), /<string name="onboarding_first_some_text">/);
  assert.match(buildIosStrings(p, "de"), /^"onboarding\.first\.some_text" = /m);
  assert.match(buildCsv(p, { platform: "android", bom: false }), /^"onboarding_first_some_text";/m);
  assert.match(buildCsv(p, { platform: "ios", bom: false }), /^"onboarding\.first\.some_text";/m);
  assert.match(buildCsv(p, { bom: false }), /^"onboarding\.first\.some_text";/m);
});

test("Keys nur für eine Plattform fehlen im Export der anderen", () => {
  const p = normalize({
    base: "de",
    only: { "face.id": "ios", "1widget": "android", "gone": "ios", "both": "web" },
    keys: { "face.id": { de: "Face ID" }, "1widget": { de: "Widget" }, "both": { de: "Beide" } },
  });
  assert.deepEqual(p.only, { "1widget": "android", "face.id": "ios" });
  assert.match(buildIosStrings(p, "de"), /"face\.id"/);
  assert.doesNotMatch(buildIosStrings(p, "de"), /1widget/);
  assert.doesNotMatch(buildAndroidXml(p, "de"), /face_id/);
  assert.match(buildAndroidXml(p, "de"), /<string name="both">/);
  // Nur-iOS-Keys müssen keinen gültigen Android-Namen ergeben.
  const ios = normalize({ base: "de", only: { "1face": "ios" }, keys: { "1face": { de: "x" } } });
  assert.deepEqual(checkAndroidNames(ios), []);
  assert.doesNotMatch(buildCsv(p, { platform: "android", bom: false }), /face_id/);
  assert.doesNotMatch(buildCsv(p, { platform: "ios", bom: false }), /1widget/);
  assert.match(buildCsv(p, { bom: false }), /"face\.id".*\r\n.*/s);
  assert.match(buildCsv(p, { bom: false }), /"1widget"/);
});

test("Store: only beim Anlegen, Ändern, Umbenennen und Löschen", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-only-"));
  try {
    const store = new Store(path.join(dir, "localize.json"));
    store.addKey("face.id", { de: "Face ID" }, { only: "ios" });
    assert.deepEqual(store.project.only, { "face.id": "ios" });
    assert.throws(() => store.addKey("x", {}, { only: "web" }), ValidationError);
    store.renameKey("face.id", "touch.id");
    assert.deepEqual(store.project.only, { "touch.id": "ios" });
    store.setOnly("touch.id", "android");
    assert.deepEqual(store.project.only, { "touch.id": "android" });
    store.setOnly("touch.id", "");
    assert.equal(store.project.only, undefined);
    assert.doesNotMatch(fs.readFileSync(store.file, "utf8"), /"only"/);
    store.setOnly("touch.id", "ios");
    store.deleteKey("touch.id");
    assert.equal(store.project.only, undefined);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
