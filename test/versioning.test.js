import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterExport, commitFiles, failed } from "../src/versioning.js";

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

/** Remote (bare) + Arbeitskopie mit erstem Commit. */
function setup() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "localize-git-"));
  const remote = path.join(tmp, "remote.git");
  const work = path.join(tmp, "work");
  git(tmp, "init", "-q", "--bare", "-b", "main", remote);
  git(tmp, "clone", "-q", remote, work);
  git(work, "config", "user.name", "Test");
  git(work, "config", "user.email", "test@example.com");
  git(work, "config", "commit.gpgsign", "false");
  git(work, "checkout", "-q", "-b", "main");
  fs.writeFileSync(path.join(work, "README"), "x\n");
  git(work, "add", "README");
  git(work, "commit", "-q", "-m", "init");
  git(work, "push", "-q", "-u", "origin", "main");
  return { tmp, remote, work };
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}

test("Commit enthält nur localize.json und die exportierten Dateien", async () => {
  const { work } = setup();
  const json = write(path.join(work, "localize.json"), "{}\n");
  const strings = write(path.join(work, "ios", "de.lproj", "Localizable.strings"), '"a" = "b";\n');
  write(path.join(work, "other.txt"), "nicht mitnehmen\n");

  const [r] = await commitFiles([json, strings], { message: "Neue Texte" });
  assert.equal(r.error, undefined);
  assert.ok(r.commit);
  assert.equal(r.pushed, false);
  assert.deepEqual(git(work, "show", "--name-only", "--format=%s", "HEAD").split("\n").filter(Boolean),
    ["Neue Texte", "ios/de.lproj/Localizable.strings", "localize.json"]);
  assert.match(git(work, "status", "--porcelain"), /\?\? other\.txt/);
});

test("Ohne Änderung entsteht kein leerer Commit", async () => {
  const { work } = setup();
  const json = write(path.join(work, "localize.json"), "{}\n");
  await commitFiles([json]);
  const head = git(work, "rev-parse", "HEAD");
  const [r] = await commitFiles([json]);
  assert.equal(r.commit, null);
  assert.equal(git(work, "rev-parse", "HEAD"), head);
});

test("Push holt vorher neue Commits vom Remote", async () => {
  const { tmp, remote, work } = setup();
  // Jemand anderes hat inzwischen gepusht.
  const other = path.join(tmp, "other");
  git(tmp, "clone", "-q", remote, other);
  git(other, "config", "user.name", "Other");
  git(other, "config", "user.email", "other@example.com");
  git(other, "config", "commit.gpgsign", "false");
  write(path.join(other, "app.swift"), "// neu\n");
  git(other, "add", "app.swift");
  git(other, "commit", "-q", "-m", "App-Änderung");
  git(other, "push", "-q");

  const json = write(path.join(work, "localize.json"), "{}\n");
  const [r] = await commitFiles([json], { push: true });
  assert.equal(r.error, undefined);
  assert.equal(r.pushed, true);
  assert.equal(git(remote, "log", "-1", "--format=%s", "main"), "Texte aktualisiert (localize-me)");
  assert.equal(r.commit, git(remote, "rev-parse", "--short", "main"), "Hash nach dem Rebase");
  assert.ok(fs.existsSync(path.join(work, "app.swift")));
});

test("iOS und Android in getrennten Repos bekommen je einen Commit", async () => {
  const ios = setup().work;
  const android = setup().work;
  const json = write(path.join(ios, "localize.json"), "{}\n");
  const xml = write(path.join(android, "res", "values", "strings.xml"), "<resources/>\n");
  const results = await commitFiles([json, xml]);
  assert.equal(results.length, 2);
  assert.ok(results.every((r) => r.commit && !r.error));
});

test("Datei außerhalb eines Repos meldet einen Fehler statt zu werfen", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "localize-nogit-"));
  const json = write(path.join(dir, "localize.json"), "{}\n");
  const result = await afterExport({ commit: true }, { file: json, written: [] });
  assert.match(result.git[0].error, /keinem Git-Repository/);
  assert.equal(failed(result), true);
});

test("Befehl nach dem Export bekommt Dateien und Commits als Umgebung", async () => {
  const { work } = setup();
  const json = write(path.join(work, "localize.json"), "{}\n");
  const xml = write(path.join(work, "values", "strings.xml"), "<resources/>\n");
  const result = await afterExport(
    { commit: true, hook: 'echo "$LOCALIZE_ME_CHANGED|$LOCALIZE_ME_COMMITS"' },
    { file: json, written: [{ file: xml, changed: true }], message: "  Eigene Nachricht " },
  );
  assert.equal(failed(result), false);
  assert.equal(result.hook.output, `${xml}|${result.git[0].commit}`);
  assert.equal(git(work, "log", "-1", "--format=%s"), "Eigene Nachricht");
});

test("Befehl wird übersprungen, wenn Git fehlschlägt, und meldet Exit-Codes", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "localize-nogit-"));
  const json = write(path.join(dir, "localize.json"), "{}\n");
  const skipped = await afterExport({ commit: true, hook: "touch ran" }, { file: json, written: [] });
  assert.equal(skipped.hook.skipped, true);
  assert.equal(fs.existsSync(path.join(dir, "ran")), false);

  const broken = await afterExport({ hook: "echo kaputt >&2; exit 3" }, { file: json, written: [] });
  assert.equal(broken.hook.ok, false);
  assert.match(broken.hook.error, /Exit-Code 3/);
  assert.equal(broken.hook.output, "kaputt");
});

test("Konflikt beim Pull: Rebase wird abgebrochen, Commit bleibt lokal", async () => {
  const { tmp, remote, work } = setup();
  const json = write(path.join(work, "localize.json"), '{"a":1}\n');
  await commitFiles([json], { push: true });

  const other = path.join(tmp, "other");
  git(tmp, "clone", "-q", remote, other);
  git(other, "config", "user.name", "Other");
  git(other, "config", "user.email", "other@example.com");
  git(other, "config", "commit.gpgsign", "false");
  write(path.join(other, "localize.json"), '{"a":"remote"}\n');
  git(other, "commit", "-qam", "Remote-Änderung");
  git(other, "push", "-q");

  write(json, '{"a":"lokal"}\n');
  const [r] = await commitFiles([json], { push: true });
  assert.match(r.error, /Push abgebrochen.*liegt lokal/);
  assert.equal(r.pushed, false);
  assert.equal(git(work, "log", "-1", "--format=%s"), "Texte aktualisiert (localize-me)");
  assert.equal(fs.readFileSync(json, "utf8"), '{"a":"lokal"}\n');
  assert.equal(fs.existsSync(path.join(work, ".git", "rebase-merge")), false);
  assert.equal(git(remote, "log", "-1", "--format=%s", "main"), "Remote-Änderung");
});

test("Push ohne Upstream meldet den Fehler von Git", async () => {
  const { work } = setup();
  git(work, "checkout", "-q", "-b", "lokal");
  const json = write(path.join(work, "localize.json"), "{}\n");
  const [r] = await commitFiles([json], { push: true });
  assert.ok(r.commit);
  assert.match(r.error, /git pull --rebase ist fehlgeschlagen/);
});

test("API: Export aus der Oberfläche committet mit eigener Nachricht", async () => {
  const { createServer, listen } = await import("../src/server.js");
  const { remote, work } = setup();
  const file = write(path.join(work, "localize.json"), JSON.stringify({ base: "de", languages: [{ code: "de", name: "Deutsch" }], output: { android: "app/res" }, keys: {} }));
  const { server } = createServer({ file, uiDir: null, versioning: { push: true, message: "Standard" } });
  const port = await listen(server, { port: 0 });
  const api = (method, url, body) => fetch(`http://127.0.0.1:${port}${url}`, {
    method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined,
  }).then(async (res) => ({ status: res.status, data: await res.json() }));
  try {
    const { data: project } = await api("GET", "/api/project");
    assert.deepEqual(project.versioning, { commit: true, push: true, hook: false, message: "Standard" });

    await api("POST", "/api/keys", { key: "home.title", values: { de: "Hallo" } });
    const first = await api("POST", "/api/export/native", { message: "Startseite" });
    assert.equal(first.status, 200);
    assert.equal(first.data.after.git[0].pushed, true);
    assert.equal(git(remote, "log", "-1", "--format=%s", "main"), "Startseite");

    await api("PATCH", "/api/keys/home.title", { lang: "de", value: "Hallo!" });
    await api("POST", "/api/export/native"); // ohne Body → Standard-Nachricht
    assert.equal(git(remote, "log", "-1", "--format=%s", "main"), "Standard");
  } finally {
    server.close();
  }
});
