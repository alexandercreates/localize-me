import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterExport, checkBranchName } from "../src/versioning.js";
import { createServer, listen } from "../src/server.js";

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "cli.js");
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" }).trim();
const identity = (cwd) => {
  git(cwd, "config", "user.name", "Test");
  git(cwd, "config", "user.email", "test@example.com");
  git(cwd, "config", "commit.gpgsign", "false");
};
const write = (file, content) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
};
const json = (keys, tracking) => JSON.stringify({ base: "de", languages: [{ code: "de", name: "Deutsch" }], keys, ...(tracking && { tracking }) }, null, 2) + "\n";
const onBranch = (work, branch, file) => git(work, "show", `${branch}:${file}`);
const filesIn = (work, branch) => git(work, "show", "--name-only", "--format=", branch).split("\n").filter(Boolean);

/** Remote (bare) + Arbeitskopie auf main, localize.json ist committet. */
function setup() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "localize-branch-test-"));
  const remote = path.join(tmp, "remote.git");
  const work = path.join(tmp, "work");
  git(tmp, "init", "-q", "--bare", "-b", "main", remote);
  git(tmp, "clone", "-q", remote, work);
  identity(work);
  git(work, "checkout", "-q", "-b", "main");
  const file = write(path.join(work, "localize.json"), json({ a: { de: "alt" } }));
  git(work, "add", "localize.json");
  git(work, "commit", "-q", "-m", "init");
  git(work, "push", "-q", "-u", "origin", "main");
  // Beide Teile geändert, wie nach einer Sitzung in der Oberfläche.
  write(file, json({ a: { de: "neu" } }, { screens: { home: { value: "app/home" } }, events: {}, parameters: {} }));
  const written = [
    { kind: "localizable", file: write(path.join(work, "res", "Localizable.strings"), '"a" = "neu";\n') },
    { kind: "tracking", file: write(path.join(work, "res", "Tracking.strings"), '"screen.home" = "home";\n') },
  ];
  return { tmp, remote, work, file, written };
}
const options = (extra = {}) => ({ commit: true, branches: { localizable: "texte", tracking: "tracking" }, ...extra });

test("Jeder Branch bekommt nur seinen Teil, der aktuelle bleibt unberührt", async () => {
  const { work, file, written } = setup();
  write(path.join(work, "staged.txt"), "x\n");
  git(work, "add", "staged.txt");
  const head = git(work, "rev-parse", "HEAD");
  const status = git(work, "status", "--porcelain");

  const { git: results } = await afterExport(options(), { file, written, message: "Stand" });

  assert.deepEqual(results.map((r) => [r.branch, r.error, !!r.commit]), [["texte", undefined, true], ["tracking", undefined, true]]);
  assert.deepEqual(filesIn(work, "texte"), ["localize.json", "res/Localizable.strings"]);
  assert.deepEqual(filesIn(work, "tracking"), ["localize.json", "res/Tracking.strings"]);
  assert.equal(git(work, "log", "-1", "--format=%s", "texte"), "Stand");

  const texte = JSON.parse(onBranch(work, "texte", "localize.json"));
  assert.equal(texte.keys.a.de, "neu");
  assert.equal(texte.tracking, undefined);
  const tracking = JSON.parse(onBranch(work, "tracking", "localize.json"));
  assert.equal(tracking.keys.a.de, "alt");
  assert.ok(tracking.tracking.screens.home);

  assert.equal(git(work, "rev-parse", "HEAD"), head);
  assert.equal(git(work, "symbolic-ref", "--short", "HEAD"), "main");
  assert.equal(git(work, "status", "--porcelain"), status);
});

test("Beide Branches lassen sich sauber zusammenführen", async () => {
  const { work, file, written } = setup();
  await afterExport(options(), { file, written });
  git(work, "stash", "-q", "--include-untracked");
  git(work, "merge", "-q", "--no-edit", "texte");
  git(work, "merge", "-q", "--no-edit", "tracking");
  const merged = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(merged.keys.a.de, "neu");
  assert.ok(merged.tracking.screens.home);
});

test("Ohne Änderung entsteht kein leerer Commit", async () => {
  const { work, file, written } = setup();
  await afterExport(options(), { file, written });
  const tip = git(work, "rev-parse", "tracking");
  const { git: results } = await afterExport(options(), { file, written });
  assert.ok(results.every((r) => r.commit === null && !r.error));
  assert.equal(git(work, "rev-parse", "tracking"), tip);
});

test("Eigene Änderungen auf dem Branch bleiben erhalten", async () => {
  const { work, file, written } = setup();
  await afterExport(options(), { file, written });
  git(work, "stash", "-q", "--include-untracked");
  git(work, "checkout", "-q", "tracking");
  write(path.join(work, "notiz.txt"), "bleibt\n");
  git(work, "add", "notiz.txt");
  git(work, "commit", "-q", "-m", "Notiz");
  git(work, "checkout", "-q", "main");
  git(work, "stash", "pop", "-q");
  write(written[1].file, '"screen.home" = "start";\n');
  await afterExport(options(), { file, written });
  assert.equal(onBranch(work, "tracking", "notiz.txt"), "bleibt");
  assert.match(onBranch(work, "tracking", "res/Tracking.strings"), /start/);
});

test("Push: neuer Branch landet auf dem Remote, main bleibt, wo es ist", async () => {
  const { remote, work, file, written } = setup();
  const main = git(remote, "rev-parse", "main");
  const { git: results } = await afterExport(options({ push: true }), { file, written });
  assert.ok(results.every((r) => r.pushed && !r.error), JSON.stringify(results));
  assert.equal(git(remote, "rev-parse", "tracking"), git(work, "rev-parse", "tracking"));
  assert.equal(git(remote, "rev-parse", "texte"), git(work, "rev-parse", "texte"));
  assert.equal(git(remote, "rev-parse", "main"), main);
});

function otherClone(tmp, remote, branch, name, content) {
  const other = path.join(tmp, "other");
  git(tmp, "clone", "-q", "-b", branch, remote, other);
  identity(other);
  write(path.join(other, name), content);
  git(other, "add", name);
  git(other, "commit", "-q", "-m", `von anderen: ${name}`);
  git(other, "push", "-q", "origin", branch);
}

test("Push: Baut auf dem auf, was andere inzwischen gepusht haben", async () => {
  const { tmp, remote, work, file, written } = setup();
  await afterExport(options({ push: true }), { file, written });
  otherClone(tmp, remote, "tracking", "fremd.txt", "von anderen\n");

  write(written[1].file, '"screen.home" = "start";\n');
  const { git: results } = await afterExport(options({ push: true }), { file, written });
  assert.ok(results.every((r) => !r.error), JSON.stringify(results));
  assert.equal(onBranch(work, "tracking", "fremd.txt"), "von anderen");
  assert.equal(git(remote, "rev-parse", "tracking"), git(work, "rev-parse", "tracking"));
  assert.match(git(remote, "show", "tracking:res/Tracking.strings"), /start/);
});

test("Push: Auseinandergelaufene Branches bleiben lokal, der andere Branch läuft weiter", async () => {
  const { tmp, remote, work, file, written } = setup();
  await afterExport(options({ push: true }), { file, written });
  otherClone(tmp, remote, "tracking", "fremd.txt", "von anderen\n");
  const remoteTip = git(remote, "rev-parse", "tracking");
  // Lokal ohne Push weiter, dann läuft der Stand auseinander.
  write(written[1].file, '"screen.home" = "lokal";\n');
  await afterExport(options(), { file, written });

  write(written[0].file, '"a" = "neuer";\n');
  write(written[1].file, '"screen.home" = "noch lokaler";\n');
  const { git: results } = await afterExport(options({ push: true }), { file, written });
  const [texte, tracking] = results;
  assert.equal(texte.pushed, true);
  assert.match(tracking.error, /auseinandergelaufen/);
  assert.ok(tracking.commit);
  assert.equal(git(remote, "rev-parse", "tracking"), remoteTip);
  assert.match(onBranch(work, "tracking", "res/Tracking.strings"), /noch lokaler/);
});

test("Ist der Arbeitsbranch ausgecheckt, gilt der normale Ablauf", async () => {
  const { work, file, written } = setup();
  git(work, "checkout", "-q", "-b", "texte");
  const { git: results } = await afterExport(options(), { file, written });
  assert.equal(results[0].branch, "texte");
  assert.equal(results[0].error, undefined);
  assert.equal(git(work, "rev-parse", "--abbrev-ref", "HEAD"), "texte");
  assert.equal(git(work, "rev-parse", "--short", "HEAD"), results[0].commit);
  assert.doesNotMatch(git(work, "status", "--porcelain"), /Localizable/);
});

test("Ein Branch in einem anderen Arbeitsordner wird nicht verschoben", async () => {
  const { tmp, work, file, written } = setup();
  git(work, "branch", "tracking");
  git(work, "worktree", "add", "-q", path.join(tmp, "wt"), "tracking");
  const tip = git(work, "rev-parse", "tracking");
  const { git: results } = await afterExport(options(), { file, written });
  const tracking = results.find((r) => r.branch === "tracking");
  assert.match(tracking.error, /anderen Arbeitsordner/);
  assert.equal(git(work, "rev-parse", "tracking"), tip);
  assert.ok(results.find((r) => r.branch === "texte").commit);
});

test("Nur ein Branch gesetzt: Der Rest geht auf den aktuellen", async () => {
  const { work, file, written } = setup();
  const { git: results } = await afterExport({ commit: true, branches: { tracking: "tracking" } }, { file, written });
  assert.deepEqual(results.map((r) => r.branch).sort(), ["main", "tracking"]);
  assert.deepEqual(filesIn(work, "HEAD"), ["localize.json", "res/Localizable.strings"]);
  assert.deepEqual(filesIn(work, "tracking"), ["localize.json", "res/Tracking.strings"]);
});

test("kinds grenzt ein, was committet wird", async () => {
  const { work, file, written } = setup();
  const { git: results } = await afterExport(options(), { file, written: [written[1]], kinds: ["tracking"] });
  assert.deepEqual(results.map((r) => r.branch), ["tracking"]);
  assert.throws(() => git(work, "rev-parse", "--verify", "--quiet", "texte"));
});

test("Ungültige Branch-Namen werden abgewiesen, auch ohne CLI", async () => {
  for (const name of ["--upload-pack=evil", "-x", "a..b", "a b", "a//b", "a/.b", "a.lock", "a/", "a.", "HEAD", "", "a~1", "a^", "a:b", "@{1}"]) {
    assert.throws(() => checkBranchName(name), /Ungültiger Branch-Name/, name);
  }
  for (const name of ["texte", "feature/tracking", "release-2.3", "v1_x"]) checkBranchName(name);
  const { file, written, work } = setup();
  const { git: results } = await afterExport({ commit: true, branches: { tracking: "--evil" } }, { file, written });
  assert.match(results.find((r) => r.branch === "--evil").error, /Ungültiger Branch-Name/);
  assert.equal(git(work, "branch", "--list", "*evil*"), "");
});

test("Der Befehl nach dem Export läuft auch mit Arbeitsbranches", async () => {
  const { work, file, written } = setup();
  await afterExport(options(), { file, written });
  const tip = git(work, "rev-parse", "tracking");
  write(written[1].file, '"screen.home" = "x";\n');
  const hook = await afterExport({ ...options(), hook: "exit 0" }, { file, written: [written[1]], kinds: ["tracking"], message: "m" });
  assert.notEqual(git(work, "rev-parse", "tracking"), tip);
  assert.equal(hook.hook.ok, true);
});

test("CLI: Optionen schließen Commit ein und werden geprüft", () => {
  const { work } = setup();
  const file = path.join(work, "localize.json");
  const project = JSON.parse(fs.readFileSync(file, "utf8"));
  write(file, JSON.stringify({ ...project, output: { ios: "res", tracking: { ios: "res" } } }));
  const run = (...args) => spawnSync(process.execPath, [CLI, "export", "--file", file, ...args], { cwd: work, encoding: "utf8" });

  assert.match(run("--tracking-branch", "--evil").stderr, /--tracking-branch|Ungültiger/);
  assert.match(run("--tracking-branch=-evil").stderr, /Ungültiger Branch-Name/);

  const only = run("--kind", "tracking", "--tracking-branch", "tracking", "--localizable-branch", "texte");
  assert.equal(only.status, 0, only.stderr);
  assert.match(only.stdout, /Commit \w+ auf tracking erstellt/);
  assert.throws(() => git(work, "rev-parse", "--verify", "--quiet", "texte"));

  const both = run("--tracking-branch", "tracking", "--localizable-branch", "texte");
  assert.equal(both.status, 0, both.stderr);
  assert.match(both.stdout, /Commit \w+ auf texte erstellt/);
  assert.equal(git(work, "symbolic-ref", "--short", "HEAD"), "main");
});

test("API: Die Oberfläche kennt die Branches, die Datei legt sie nicht fest", async (t) => {
  const { remote, work } = setup();
  const file = path.join(work, "localize.json");
  const project = JSON.parse(fs.readFileSync(file, "utf8"));
  // Ein Eintrag in der Datei darf nichts bewirken.
  write(file, JSON.stringify({ ...project, branches: { tracking: "main" }, output: { tracking: { ios: "res" } } }));
  const { server } = createServer({ file, uiDir: null, versioning: { push: true, branches: { tracking: "tracking" } } });
  const port = await listen(server, { port: 0, tries: 0 });
  t.after(() => server.close());

  const payload = await (await fetch(`http://127.0.0.1:${port}/api/project`)).json();
  assert.deepEqual(payload.versioning.branches, { tracking: "tracking" });
  assert.equal(payload.branches, undefined);

  const res = await fetch(`http://127.0.0.1:${port}/api/export/native`, { method: "POST" });
  const { after } = await res.json();
  const tracking = after.git.find((r) => r.branch === "tracking");
  assert.equal(tracking.pushed, true, JSON.stringify(after));
  assert.match(git(remote, "show", "tracking:res/Tracking.strings"), /Erzeugt von localize-me/);
});
