import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createServer } from "../src/server.js";
import { mergeProjects } from "../src/sync.js";
import { normalize } from "../src/store.js";

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" }).trim();
const identity = (cwd) => {
  git(cwd, "config", "user.name", "Test");
  git(cwd, "config", "user.email", "test@example.com");
  git(cwd, "config", "commit.gpgsign", "false");
};
const languages = [{ code: "de", name: "Deutsch" }, { code: "en", name: "English" }];
const project = (keys, extra = {}) => ({ base: "de", languages, keys, ...extra });
const json = (keys) => JSON.stringify(project(keys), null, 2) + "\n";
const norm = (keys, extra) => normalize(project(keys, extra));

/** Remote mit main und texte, `box` ist der Container auf `branch`, `col` der Kollege. */
function setup(branch = "texte", keys = { a: { de: "a1" }, m: { de: "m1" }, z: { de: "z1" } }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "localize-sync-test-"));
  const remote = path.join(tmp, "remote.git");
  const col = path.join(tmp, "col");
  const box = path.join(tmp, "box");
  git(tmp, "init", "-q", "--bare", "-b", "main", remote);
  git(tmp, "clone", "-q", remote, col);
  identity(col);
  git(col, "checkout", "-q", "-b", "main");
  fs.writeFileSync(path.join(col, "localize.json"), json(keys));
  fs.writeFileSync(path.join(col, "app.txt"), "code\n");
  git(col, "add", ".");
  git(col, "commit", "-q", "-m", "init");
  git(col, "push", "-q", "-u", "origin", "main");
  git(col, "push", "-q", "origin", "main:texte");
  git(tmp, "clone", "-q", "-b", branch, remote, box);
  identity(box);
  return { tmp, col, box };
}

function pushAs(col, branch, keys) {
  git(col, "fetch", "-q", "origin");
  git(col, "checkout", "-q", "-B", branch, `origin/${branch}`);
  fs.writeFileSync(path.join(col, "localize.json"), json(keys));
  git(col, "commit", "-qam", `update ${branch}`);
  git(col, "push", "-q", "origin", branch);
}

function serve(box, options = {}) {
  const created = createServer({ file: path.join(box, "localize.json"), uiDir: null, sync: { interval: 0 }, ...options });
  created.server.unref?.();
  return created;
}

const onDisk = (box) => JSON.parse(fs.readFileSync(path.join(box, "localize.json"), "utf8"));

test("mergeProjects: Änderungen auf beiden Seiten kommen zusammen, sogar innerhalb eines Keys", () => {
  const base = norm({ a: { de: "1", en: "1" }, b: { de: "b" } });
  const ours = norm({ a: { de: "hier", en: "1" }, b: { de: "b" } });
  const theirs = norm({ a: { de: "1", en: "dort" }, b: { de: "b" }, c: { de: "neu" } });
  const { project: merged, conflicts } = mergeProjects(base, ours, theirs);
  assert.deepEqual(merged.keys, { a: { de: "hier", en: "dort" }, b: { de: "b" }, c: { de: "neu" } });
  assert.deepEqual(conflicts, []);
});

test("mergeProjects: Löschen drüben kommt an, Konflikt behält den eigenen Wert", () => {
  const base = norm({ a: { de: "1" }, b: { de: "b" } });
  const ours = norm({ a: { de: "hier" }, b: { de: "b" } });
  const theirs = norm({ a: { de: "dort" } });
  const { project: merged, conflicts } = mergeProjects(base, ours, theirs);
  assert.deepEqual(merged.keys, { a: { de: "hier" } });
  assert.deepEqual(conflicts, [{ path: ["keys", "a", "de"], theirs: "dort" }]);
});

test("mergeProjects: Key namens constructor ist kein geerbter Wert", () => {
  const base = norm({});
  const ours = norm({ a: { de: "1" } });
  const theirs = norm({ constructor: { de: "neu" } });
  const { project: merged, conflicts } = mergeProjects(base, ours, theirs);
  assert.equal(merged.keys.constructor.de, "neu");
  assert.equal(merged.keys.a.de, "1");
  assert.deepEqual(conflicts, []);
});

test("mergeProjects: Sprachen kommen pro Code zusammen", () => {
  const base = normalize({ base: "de", languages: [languages[0]], keys: {} });
  const ours = normalize({ base: "de", languages: [languages[0], { code: "fr", name: "Français" }], keys: {} });
  const theirs = normalize({ base: "de", languages: [languages[0], languages[1]], keys: {} });
  const { project: merged, conflicts } = mergeProjects(base, ours, theirs);
  assert.deepEqual(merged.languages.map((l) => l.code), ["de", "fr", "en"]);
  assert.deepEqual(conflicts, []);
});

test("mergeProjects: Eigener älterer Stand auf main ist kein Konflikt", () => {
  const base = norm({ a: { de: "1" } });
  const ours = norm({ a: { de: "3" } });
  const theirs = norm({ a: { de: "2" } });
  const known = norm({ a: { de: "2" } });
  const { project: merged, conflicts } = mergeProjects(base, ours, theirs, known);
  assert.equal(merged.keys.a.de, "3");
  assert.deepEqual(conflicts, []);
});

test("Container auf texte bekommt Änderungen von main, aber keinen App-Code", async () => {
  const { col, box } = setup();
  const { store, sync, server } = serve(box);
  await sync.run();
  git(col, "checkout", "-q", "main");
  fs.writeFileSync(path.join(col, "app.txt"), "neuer code\n");
  git(col, "add", "app.txt");
  git(col, "commit", "-qm", "code");
  git(col, "push", "-q", "origin", "main");
  pushAs(col, "main", { a: { de: "a1" }, m: { de: "von main" }, z: { de: "z1" } });

  await sync.run();

  assert.equal(store.project.keys.m.de, "von main");
  assert.equal(onDisk(box).keys.m.de, "von main");
  assert.equal(fs.readFileSync(path.join(box, "app.txt"), "utf8"), "code\n");
  assert.equal(git(box, "rev-parse", "--abbrev-ref", "HEAD"), "texte");
  assert.equal(sync.status().error, null);
  assert.deepEqual(sync.status().sources, ["texte", "main"]);
  server.close();
});

test("Beim ersten Abgleich kommt an, was auf main schon vorher geändert wurde", async () => {
  const { col, box } = setup();
  pushAs(col, "main", { a: { de: "a1" }, m: { de: "früher" }, z: { de: "z1" } });
  const { store, sync, server } = serve(box);
  await sync.run();
  assert.equal(store.project.keys.m.de, "früher");
  server.close();
});

test("Eigener Branch wird vorgespult, unexportierte Bearbeitungen bleiben", async () => {
  const { col, box } = setup();
  const { store, sync, server } = serve(box);
  await sync.run();
  store.setValue("a", "de", "aus der Oberfläche");
  pushAs(col, "texte", { a: { de: "a1" }, m: { de: "m1" }, z: { de: "von texte" } });

  await sync.run();

  assert.equal(git(box, "rev-parse", "HEAD"), git(box, "rev-parse", "origin/texte"));
  const disk = onDisk(box);
  assert.equal(disk.keys.a.de, "aus der Oberfläche");
  assert.equal(disk.keys.z.de, "von texte");
  assert.deepEqual(store.project.keys, disk.keys);
  assert.equal(git(box, "status", "--porcelain"), "M localize.json");
  server.close();
});

test("Bearbeitung während des Vorspulens geht nicht verloren", async () => {
  const { col, box } = setup();
  const { store, sync, server } = serve(box);
  await sync.run();
  pushAs(col, "texte", { a: { de: "a1" }, m: { de: "m1" }, z: { de: "von texte" } });
  await store.whileHeld(async () => {
    store.setValue("a", "de", "währenddessen");
    assert.equal(onDisk(box).keys.a.de, "a1");
    assert.equal(store.reload(), false);
  });
  assert.equal(onDisk(box).keys.a.de, "währenddessen");
  await sync.run();
  assert.equal(onDisk(box).keys.a.de, "währenddessen");
  assert.equal(onDisk(box).keys.z.de, "von texte");
  server.close();
});

test("Konflikt: eigener Text bleibt, Entscheidung übernimmt den vom Branch", async () => {
  const { col, box } = setup();
  const { store, sync, server } = serve(box);
  await sync.run();
  store.setValue("m", "de", "hier");
  pushAs(col, "main", { a: { de: "a1" }, m: { de: "dort" }, z: { de: "z1" } });

  await sync.run();
  const [conflict, ...rest] = sync.status().conflicts;
  assert.deepEqual(rest, []);
  assert.deepEqual([conflict.source, conflict.ours, conflict.theirs], ["main", "hier", "dort"]);
  assert.equal(onDisk(box).keys.m.de, "hier");

  assert.equal(sync.resolve(conflict.id, "remote"), true);
  assert.equal(onDisk(box).keys.m.de, "dort");
  assert.deepEqual(sync.status().conflicts, []);
  assert.equal(sync.resolve(conflict.id, "remote"), false);
  server.close();
});

test("Konflikt und Stand überstehen einen Neustart, nichts wird doppelt angewendet", async () => {
  const { col, box } = setup();
  const first = serve(box);
  await first.sync.run();
  first.store.setValue("m", "de", "hier");
  pushAs(col, "main", { a: { de: "a1" }, m: { de: "dort" }, z: { de: "z1" } });
  await first.sync.run();
  first.server.close();

  const second = serve(box);
  await second.sync.run();
  assert.equal(second.sync.status().conflicts.length, 1);
  second.store.setValue("z", "de", "später");
  await second.sync.run();
  assert.equal(second.store.project.keys.z.de, "später");
  second.server.close();
});

test("Konflikt erledigt sich, wenn beide Seiten gleich werden", async () => {
  const { col, box } = setup();
  const { store, sync, server } = serve(box);
  await sync.run();
  store.setValue("m", "de", "hier");
  pushAs(col, "main", { a: { de: "a1" }, m: { de: "dort" }, z: { de: "z1" } });
  await sync.run();
  store.setValue("m", "de", "dort");
  await sync.run();
  assert.deepEqual(sync.status().conflicts, []);
  server.close();
});

test("Export nach Abgleich pusht den zusammengeführten Stand auf den eigenen Branch", async () => {
  const { col, box } = setup();
  const { store, sync, server } = serve(box, { versioning: { commit: true, push: true } });
  await sync.run();
  pushAs(col, "main", { a: { de: "a1" }, m: { de: "von main" }, z: { de: "z1" } });
  pushAs(col, "texte", { a: { de: "von texte" }, m: { de: "m1" }, z: { de: "z1" } });
  store.setValue("z", "de", "aus der Oberfläche");
  await sync.run();

  const { commitFiles } = await import("../src/versioning.js");
  const [result] = await commitFiles([path.join(box, "localize.json")], { push: true });
  assert.equal(result.error, undefined);
  const pushed = JSON.parse(git(box, "show", "origin/texte:localize.json"));
  assert.deepEqual([pushed.keys.a.de, pushed.keys.m.de, pushed.keys.z.de], ["von texte", "von main", "aus der Oberfläche"]);
  server.close();
});

test("Fehler stehen im Status, der Server läuft weiter und erholt sich", async () => {
  const { box, tmp } = setup();
  const { sync, server } = serve(box);
  fs.renameSync(path.join(tmp, "remote.git"), path.join(tmp, "weg.git"));
  await sync.run();
  assert.match(sync.status().error, /./);
  fs.renameSync(path.join(tmp, "weg.git"), path.join(tmp, "remote.git"));
  await sync.run();
  assert.equal(sync.status().error, null);
  server.close();
});

test("Ungültiges JSON auf einem Branch wird gemeldet und ändert nichts", async () => {
  const { col, box } = setup();
  const { store, sync, server } = serve(box);
  await sync.run();
  git(col, "checkout", "-q", "main");
  fs.writeFileSync(path.join(col, "localize.json"), "{ kaputt");
  git(col, "commit", "-qam", "kaputt");
  git(col, "push", "-q", "origin", "main");
  await sync.run();
  assert.match(sync.status().error, /main: .*kein gültiges JSON/);
  assert.equal(store.project.keys.a.de, "a1");
  server.close();
});

test("Ohne Git-Repository meldet der Abgleich das, statt abzustürzen", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "localize-sync-norepo-"));
  fs.writeFileSync(path.join(tmp, "localize.json"), json({ a: { de: "a1" } }));
  const { sync, server } = serve(tmp);
  await sync.run();
  assert.match(sync.status().error, /in keinem Git-Repository/);
  server.close();
});

test("Ohne --sync gibt es keinen Abgleich und keine Route dafür", async () => {
  const { box } = setup();
  const { sync, server } = createServer({ file: path.join(box, "localize.json"), uiDir: null });
  assert.equal(sync, null);
  server.close();
});
