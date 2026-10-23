import { test } from "node:test";
import assert from "node:assert/strict";
import { convert, check, specOf } from "../src/placeholders.js";

test("einzelner Text-Platzhalter", () => {
  const t = "Hallo #name, schön dich zu sehen";
  assert.equal(convert(t, "ios"), "Hallo %@, schön dich zu sehen");
  assert.equal(convert(t, "android"), "Hallo %s, schön dich zu sehen");
  assert.equal(convert(t, "raw"), t);
});

test("Zahlen-Typen", () => {
  assert.equal(convert("#count:int Einträge", "ios"), "%lld Einträge");
  assert.equal(convert("#count:int Einträge", "android"), "%d Einträge");
  assert.equal(convert("#preis:float €", "ios"), "%f €");
});

test("mehrere Platzhalter werden positionsbezogen", () => {
  const t = "#name hat #count:int Artikel";
  assert.equal(convert(t, "ios"), "%1$@ hat %2$lld Artikel");
  assert.equal(convert(t, "android"), "%1$s hat %2$d Artikel");
});

test("Übersetzung darf umstellen, Index kommt aus dem Basistext", () => {
  const base = "#name hat #count:int Artikel";
  assert.equal(convert("#count Artikel gehören #name", "ios", base), "%2$lld Artikel gehören %1$@");
  assert.equal(convert("#count Artikel gehören #name", "android", base), "%2$d Artikel gehören %1$s");
});

test("Prozent und Raute", () => {
  assert.equal(convert("100% sicher, #name", "ios"), "100%% sicher, %@");
  assert.equal(convert("100% sicher", "ios"), "100% sicher");
  assert.equal(convert("Nr. ##1 für #name", "android"), "Nr. #1 für %s");
  assert.equal(convert("Platz #1", "ios"), "Platz #1");
});

test("Prüfung findet fehlende, fremde und abweichende Platzhalter", () => {
  const base = "#name hat #count:int Artikel";
  assert.deepEqual(check(base, "#name has #count items"), []);
  assert.deepEqual(check(base, "#name has items"), ["Fehlt: #count"]);
  assert.deepEqual(check(base, "#name has #count #extra"), ["Nicht im Basistext: #extra"]);
  assert.deepEqual(check(base, "#name has #count:float"), ["Anderer Typ als im Basistext: #count"]);
  assert.equal(specOf("#a:int #a:float").conflict, "a");
});
