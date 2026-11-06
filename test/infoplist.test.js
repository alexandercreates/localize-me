import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildInfoPlistStrings, checkInfoPlist, INFO_PLIST_KNOWN } from "../src/infoplist.js";
import { nativeFiles } from "../src/native.js";
import { normalize, serialize, Store, ValidationError } from "../src/store.js";
import { createServer, listen } from "../src/server.js";

const project = normalize({
  base: "de",
  languages: [{ code: "de", name: "Deutsch" }, { code: "en", name: "Englisch" }, { code: "pt-BR", name: "Portugiesisch" }],
  keys: { "home.title": { de: "Start" } },
  infoPlist: {
    NSCameraUsageDescription: { de: 'Zum Scannen von "Belegen".\nGanz sicher.', en: "To scan receipts." },
    NSFaceIDUsageDescription: { de: "Zum Entsperren" },
    MySdkUsageDescription: { de: "Für das SDK", en: "" },
  },
});

function tmpFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-infoplist-"));
  return path.join(dir, "localize.json");
}

test("normalize: sortiert, leere Texte fallen weg, ohne Einträge kein Feld", () => {
  assert.deepEqual(Object.keys(project.infoPlist), ["MySdkUsageDescription", "NSCameraUsageDescription", "NSFaceIDUsageDescription"]);
  assert.deepEqual(project.infoPlist.MySdkUsageDescription, { de: "Für das SDK" });
  const plain = normalize({ base: "de", keys: {}, infoPlist: { NSCameraUsageDescription: { de: "" } } });
  assert.equal("infoPlist" in plain, false);
  assert.doesNotMatch(serialize(plain), /infoPlist/);
});

test("InfoPlist.strings: Escaping, Kommentar aus dem Katalog, fehlende Übersetzungen fehlen", () => {
  const de = buildInfoPlistStrings(project, "de");
  assert.match(de, /^\/\* Kamera \*\/\n"NSCameraUsageDescription" = "Zum Scannen von \\"Belegen\\"\.\\nGanz sicher\.";$/m);
  assert.match(de, /^"MySdkUsageDescription" = "Für das SDK";$/m);
  const en = buildInfoPlistStrings(project, "en");
  assert.match(en, /"NSCameraUsageDescription" = "To scan receipts\.";/);
  assert.doesNotMatch(en, /NSFaceIDUsageDescription|MySdk/);
});

test("Platzhalter werden nicht umgewandelt, % bleibt", () => {
  const p = normalize({ base: "de", keys: {}, infoPlist: { NSCameraUsageDescription: { de: "#name braucht 100 %" } } });
  assert.match(buildInfoPlistStrings(p, "de"), /= "#name braucht 100 %";/);
});

test("iOS-Export: InfoPlist.strings je Sprache neben Localizable.strings, Android unverändert", () => {
  const files = nativeFiles(project, "ios").map((f) => f.path);
  assert.deepEqual(files, [
    path.join("de.lproj", "Localizable.strings"), path.join("de.lproj", "InfoPlist.strings"),
    path.join("en.lproj", "Localizable.strings"), path.join("en.lproj", "InfoPlist.strings"),
    path.join("pt-BR.lproj", "Localizable.strings"), path.join("pt-BR.lproj", "InfoPlist.strings"),
  ]);
  assert.ok(nativeFiles(project, "android").every((f) => f.path.endsWith("strings.xml")));
  const without = normalize({ base: "de", keys: { a: { de: "x" } } });
  assert.ok(!nativeFiles(without, "ios").some((f) => f.path.endsWith("InfoPlist.strings")));
});

test("Export bricht ab, wenn die Basissprache fehlt oder ein Key ungültig ist", () => {
  const p = normalize({ base: "de", languages: [{ code: "de" }, { code: "en" }], keys: {}, infoPlist: { NSCameraUsageDescription: { en: "Camera" }, "1bad": { de: "x" } } });
  assert.equal(checkInfoPlist(p).length, 2);
  assert.throws(() => nativeFiles(p, "ios"), /Basissprache de fehlt/);
});

test("Store: setzen, leeren und entfernen", () => {
  const store = new Store(tmpFile());
  store.setInfoPlistValue("NSCameraUsageDescription", "de", "Kamera");
  store.setInfoPlistValue("NSCameraUsageDescription", "en", "Camera");
  assert.deepEqual(store.read().infoPlist, { NSCameraUsageDescription: { de: "Kamera", en: "Camera" } });
  store.setInfoPlistValue("NSCameraUsageDescription", "en", "");
  assert.deepEqual(store.read().infoPlist, { NSCameraUsageDescription: { de: "Kamera" } });
  store.setInfoPlistValue("NSCameraUsageDescription", "de", "");
  assert.equal(store.read().infoPlist, undefined);
  assert.throws(() => store.setInfoPlistValue("__proto__", "de", "x"), ValidationError);
  assert.throws(() => store.setInfoPlistValue("Kein Key", "de", "x"), ValidationError);
  assert.throws(() => store.setInfoPlistValue("NSCameraUsageDescription", "../x", "x"), ValidationError);
  store.setInfoPlistValue("MyKey", "de", "x");
  store.deleteInfoPlistKey("MyKey");
  assert.equal(store.read().infoPlist, undefined);
  assert.throws(() => store.deleteInfoPlistKey("MyKey"), ValidationError);
});

test("Store: Sprache mit purge entfernt auch Info.plist-Texte", () => {
  const store = new Store(tmpFile());
  store.addLanguage("en", "Englisch");
  store.setInfoPlistValue("NSCameraUsageDescription", store.project.base, "Kamera");
  store.setInfoPlistValue("NSCameraUsageDescription", "en", "Camera");
  store.removeLanguage("en", { purge: true });
  assert.deepEqual(store.read().infoPlist.NSCameraUsageDescription, { de: "Kamera" });
});

test("Katalog: eindeutige, gültige Keys", () => {
  for (const key of INFO_PLIST_KNOWN.keys()) assert.match(key, /^[A-Za-z][A-Za-z0-9]*$/);
  assert.ok(INFO_PLIST_KNOWN.has("NSCameraUsageDescription"));
});

test("API: PUT und DELETE /api/infoplist/:key", async () => {
  const { server } = createServer({ file: tmpFile(), uiDir: null });
  const port = await listen(server, { port: 0 });
  const base = `http://127.0.0.1:${port}`;
  try {
    const put = await fetch(`${base}/api/infoplist/NSCameraUsageDescription`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lang: "de", value: "Kamera" }),
    });
    assert.equal(put.status, 200);
    assert.deepEqual((await put.json()).infoPlist, { NSCameraUsageDescription: { de: "Kamera" } });
    const bad = await fetch(`${base}/api/infoplist/${encodeURIComponent("a b")}`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lang: "de", value: "x" }),
    });
    assert.equal(bad.status, 400);
    const del = await fetch(`${base}/api/infoplist/NSCameraUsageDescription`, { method: "DELETE" });
    assert.equal(del.status, 200);
    assert.equal((await del.json()).infoPlist, undefined);
  } finally {
    server.close();
  }
});
