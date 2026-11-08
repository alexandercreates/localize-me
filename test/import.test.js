import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer, listen } from "../src/server.js";
import { Store, ValidationError } from "../src/store.js";

const languages = [{ code: "de", name: "Deutsch" }, { code: "en", name: "Englisch" }];
const current = {
  base: "de",
  languages,
  output: { android: "../android/res" },
  keys: { same: { de: "Gleich" }, edit: { de: "Alt" }, gone: { de: "Weg" } },
};
const incoming = {
  base: "de",
  languages: [...languages, { code: "fr", name: "Französisch" }],
  output: { android: "../../../etc" },
  keys: { same: { de: "Gleich" }, edit: { de: "Neu" }, fresh: { de: "Dazu" } },
  tracking: { screens: { start: { value: "app/start" } } },
};

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "localize-import-"));
  const file = path.join(dir, "localize.json");
  fs.writeFileSync(file, JSON.stringify(current));
  return file;
}

test("Vorschau nennt die Änderungen und schreibt nichts", () => {
  const file = fixture();
  const before = fs.readFileSync(file, "utf8");
  const summary = new Store(file).previewImport(incoming);
  assert.deepEqual(summary, {
    unchanged: false,
    total: 3,
    added: 1,
    changed: 1,
    removed: ["gone"],
    languagesAdded: ["fr"],
    languagesRemoved: [],
    base: "",
    sections: ["Tracking"],
  });
  assert.equal(fs.readFileSync(file, "utf8"), before);
  assert.ok(!fs.existsSync(file + ".bak"));
});

test("Import ersetzt die Datei, sichert die alte und behält output", () => {
  const file = fixture();
  const before = fs.readFileSync(file, "utf8");
  const store = new Store(file);
  store.importProject(incoming);
  const saved = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(saved.keys.edit.de, "Neu");
  assert.ok(!saved.keys.gone);
  assert.deepEqual(saved.output, current.output);
  assert.equal(fs.readFileSync(file + ".bak", "utf8"), before);
  assert.deepEqual(store.project.keys, saved.keys);
});

test("Gleicher Stand schreibt nichts und lässt die Sicherung in Ruhe", () => {
  const file = fixture();
  const store = new Store(file);
  assert.equal(store.previewImport(current).unchanged, true);
  store.importProject(current);
  assert.ok(!fs.existsSync(file + ".bak"));
});

test("Ungültige Dateien werden abgelehnt und ändern nichts", () => {
  const file = fixture();
  const before = fs.readFileSync(file, "utf8");
  const store = new Store(file);
  const bad = [
    {},
    [],
    { base: "de", languages },
    { base: "de", keys: {} },
    { base: "de", languages: [], keys: {} },
    { base: "xx", languages, keys: {} },
    { base: "de", languages: [{ code: "../evil" }], keys: {} },
    { base: "de", languages: [languages[0], languages[0]], keys: {} },
    { base: "de", languages, keys: { "bad key": { de: "x" } } },
    { base: "de", languages, keys: JSON.parse('{"__proto__": {"de": "x"}}') },
    { base: "de", languages, keys: { a: "Text" } },
    { base: "de", languages, keys: { a: { de: 5 } } },
    { base: "de", languages, keys: { a: { de: { other: 5 } } } },
    { base: "de", languages, keys: {}, tracking: [] },
  ];
  for (const data of bad) assert.throws(() => store.importProject(data), ValidationError, JSON.stringify(data));
  assert.equal(fs.readFileSync(file, "utf8"), before);
});

test("Platzhalter-Fehler blockieren den Import nicht, sie lassen sich danach korrigieren", () => {
  const store = new Store(fixture());
  const data = { base: "de", languages, keys: { a: { de: "#count:int", en: "#anzahl" } } };
  assert.doesNotThrow(() => store.importProject(data));
});

test("API: Vorschau, Import, große Dateien und fremde Herkunft", async (t) => {
  const file = fixture();
  const { server } = createServer({ file, uiDir: null });
  t.after(() => server.close());
  const port = await listen(server, { port: 0, tries: 0 });
  const base = `http://127.0.0.1:${port}`;
  const post = (url, body, headers = {}) =>
    fetch(base + url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });

  const preview = await post("/api/import?preview=1", incoming);
  assert.equal(preview.status, 200);
  assert.equal((await preview.json()).added, 1);
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).keys.edit.de, "Alt");

  assert.equal((await post("/api/import", incoming, { Origin: "https://evil.example" })).status, 403);
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).keys.edit.de, "Alt");

  assert.equal((await post("/api/import", {})).status, 400);

  const done = await post("/api/import", incoming);
  assert.equal(done.status, 200);
  assert.equal((await done.json()).keys.edit.de, "Neu");

  const large = { base: "de", languages, keys: { big: { de: "x".repeat(2 * 1024 * 1024) } } };
  assert.equal((await post("/api/import", large)).status, 200);
  assert.equal((await post("/api/keys", { key: "big2", values: { de: "x".repeat(2 * 1024 * 1024) } })).status, 400);
});
