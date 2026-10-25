import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildIosStrings, buildIosStringsdict, buildAndroidXml, nativeFiles } from "../src/native.js";
import { buildCsv } from "../src/csv.js";
import { categoriesFor, checkPlural, countCandidates, countOf, withCount } from "../src/plurals.js";
import { normalize, Store } from "../src/store.js";

const project = normalize({
  base: "de",
  languages: [{ code: "de", name: "Deutsch" }, { code: "en", name: "Englisch" }, { code: "ru", name: "Russisch" }],
  keys: {
    "tasks.open": {
      de: { other: "#count:int offene Aufgaben", one: "Eine offene Aufgabe" },
      en: { one: "One open task", other: "#count open tasks" },
    },
    "slots": { de: { one: "#name hat #count:int Platz", other: "#name hat #count:int Plätze" } },
    "rate": { de: { one: "Ein Kind, 100 %", other: "#count:int Kinder, 100 %" } },
    "title": { de: "Start" },
  },
});

test("Pluralformen kommen aus den CLDR-Regeln", () => {
  assert.deepEqual(categoriesFor("de"), ["one", "other"]);
  assert.deepEqual(categoriesFor("ru"), ["one", "few", "many", "other"]);
  assert.deepEqual(categoriesFor("pt_BR"), categoriesFor("pt-BR"));
});

test("normalize: Formen sortiert, Text neben Formen wird zur Form other", () => {
  assert.deepEqual(Object.keys(project.keys["tasks.open"].de), ["one", "other"]);
  const mixed = normalize({ base: "de", keys: { k: { de: { other: "#n:int Tage" }, en: "#n days", fr: {} } } });
  assert.deepEqual(mixed.keys.k, { de: { other: "#n:int Tage" }, en: { other: "#n days" } });
  // Leerer Basistext bleibt als Plural erhalten.
  assert.deepEqual(normalize({ base: "de", keys: { k: { de: {} } } }).keys.k, { de: {} });
});

test("iOS: Plurals landen in der stringsdict, nicht in der strings", () => {
  assert.doesNotMatch(buildIosStrings(project, "de"), /tasks\.open/);
  const de = buildIosStringsdict(project, "de");
  assert.match(de, /<key>tasks\.open<\/key>\s*<dict>\s*<key>NSStringLocalizedFormatKey<\/key>\s*<string>%#@count@<\/string>/);
  assert.match(de, /<key>NSStringFormatValueTypeKey<\/key>\s*<string>lld<\/string>\s*<key>one<\/key>\s*<string>Eine offene Aufgabe<\/string>\s*<key>other<\/key>\s*<string>%lld offene Aufgaben<\/string>/);
  // Mehrere Platzhalter: positionsbezogen, Zahl an zweiter Stelle.
  assert.match(de, /<string>%2\$#@count@<\/string>/);
  assert.match(de, /<string>%1\$@ hat %2\$lld Plätze<\/string>/);
  // % in einer Form ohne Platzhalter wird trotzdem verdoppelt.
  assert.match(de, /<string>Ein Kind, 100 %%<\/string>/);
});

test("fehlende Übersetzung eines Plurals fällt weg", () => {
  const en = buildIosStringsdict(project, "en");
  assert.match(en, /<string>%lld open tasks<\/string>/);
  assert.doesNotMatch(en, /slots/);
  assert.doesNotMatch(buildAndroidXml(project, "en"), /slots/);
});

test("Android: <plurals> mit item je Form", () => {
  const de = buildAndroidXml(project, "de");
  assert.match(de, /<plurals name="tasks_open">\n {8}<item quantity="one">Eine offene Aufgabe<\/item>\n {8}<item quantity="other">%d offene Aufgaben<\/item>\n {4}<\/plurals>/);
  assert.match(de, /<item quantity="other">%1\$s hat %2\$d Plätze<\/item>/);
  assert.match(de, /<string name="title">Start<\/string>/);
});

test("stringsdict nur, wenn es Plurals gibt", () => {
  assert.ok(nativeFiles(project, "ios").some((f) => f.path.endsWith("de.lproj/Localizable.stringsdict")));
  const plain = normalize({ base: "de", keys: { a: { de: "A" } } });
  assert.ok(!nativeFiles(plain, "ios").some((f) => f.path.endsWith(".stringsdict")));
});

test("Plural ohne Zahl-Platzhalter bricht den Export ab", () => {
  const bad = normalize({ base: "de", keys: { k: { de: { other: "Viele" } } } });
  assert.throws(() => nativeFiles(bad, "android"), /ohne Zahl/);
});

test("CSV: eine Zeile pro Form", () => {
  const csv = buildCsv(project, { platform: "ios", languages: ["de", "en"], bom: false });
  assert.match(csv, /"tasks\.open\[one\]";"Eine offene Aufgabe";"One open task"/);
  assert.match(csv, /"tasks\.open\[other\]";"%lld offene Aufgaben";"%lld open tasks"/);
});

test("Prüfung: Zahl darf in Formen fehlen, andere Platzhalter nicht", () => {
  const base = project.keys.slots.de;
  assert.equal(countOf(base), "count");
  assert.deepEqual(checkPlural(base, { one: "Ein Platz", other: "#name has #count places" }, "en"), ["eins: Fehlt: #name"]);
  assert.deepEqual(checkPlural(base, { one: "#name: one place" }, "en"), ["Form fehlt: andere"]);
  assert.deepEqual(checkPlural(base, { one: "a", few: "b", other: "c" }, "ru").slice(0, 1), ["Form fehlt: viele"]);
  assert.deepEqual(checkPlural({ other: "Viele" }, undefined, "de", { isBase: true }), ["Für Plurals braucht die Form „andere“ einen Zahl-Platzhalter, z. B. #count:int.", "Form fehlt: eins"]);
  assert.deepEqual(checkPlural(project.keys["tasks.open"].de, undefined, "de", { isBase: true }), []);
});

test("Store: Plural an- und ausschalten, Formen einzeln setzen", () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "lm-")), "localize.json");
  const store = new Store(file);
  store.addKey("days", { de: "#n:int Tage" });
  store.setPlural("days", true);
  assert.deepEqual(store.project.keys.days, { de: { other: "#n:int Tage" } });
  store.setValue("days", "de", "Ein Tag", "one");
  store.setValue("days", "en", "#n days", "other");
  assert.throws(() => store.setValue("days", "de", "x"), /Form/);
  assert.deepEqual(new Store(file).project.keys.days, { de: { one: "Ein Tag", other: "#n:int Tage" }, en: { other: "#n days" } });
  store.setValue("days", "en", "", "other");
  assert.deepEqual(store.project.keys.days.en, undefined);
  store.setPlural("days", false);
  assert.deepEqual(store.project.keys.days, { de: "#n:int Tage" });
  store.addKey("kids", {}, { plural: true });
  assert.deepEqual(new Store(file).project.keys.kids, { de: {} });
});

test(":plural legt fest, nach welcher Zahl sich die Form richtet", () => {
  const p = normalize({
    base: "de",
    languages: [{ code: "de", name: "Deutsch" }, { code: "en", name: "Englisch" }],
    keys: {
      spots: {
        de: { one: "#count von #required Platz belegt", other: "#count:int von #required:plural Plätzen belegt" },
        en: { one: "#count of #required spot taken", other: "#count of #required:int spots taken" },
      },
    },
  });
  const forms = p.keys.spots.de;
  assert.equal(countOf(forms), "required");
  assert.deepEqual(checkPlural(forms, undefined, "de", { isBase: true }), []);
  // :int in der Übersetzung passt zu :plural im Basistext.
  assert.deepEqual(checkPlural(forms, p.keys.spots.en, "en"), []);

  const ios = buildIosStringsdict(p, "de");
  assert.match(ios, /<string>%2\$#@required@<\/string>\s*<key>required<\/key>/);
  assert.match(ios, /<key>one<\/key>\s*<string>%1\$lld von %2\$lld Platz belegt<\/string>/);
  assert.match(buildAndroidXml(p, "de"), /<item quantity="other">%1\$d von %2\$d Plätzen belegt<\/item>/);
});

test("withCount schreibt :plural um", () => {
  assert.equal(withCount("#count:int von #required:int Plätzen", "required"), "#count:int von #required:plural Plätzen");
  assert.equal(withCount("#count:int von #required:plural Plätzen", "count"), "#count:plural von #required:int Plätzen");
  assert.deepEqual(countCandidates({ other: "#name hat #a:int und #b:plural" }), ["a", "b"]);
});
