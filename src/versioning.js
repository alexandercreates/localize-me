import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { exec, execFile } from "node:child_process";
import { FILE_KINDS } from "./outputs.js";
import { serialize } from "./store.js";

// Was nach einem Export passiert: Commit (+ Push) und/oder ein eigener Befehl.
// Wird nur über die CLI konfiguriert, nie über localize.json – sonst könnte jeder,
// der die Textdatei ändern darf, Befehle auf dem Server ausführen oder auf beliebige Branches pushen.

export const DEFAULT_MESSAGE = "Texte aktualisiert (localize-me)";
const OUTPUT_TAIL = 2000;

function tail(text) {
  const trimmed = text.trim();
  return trimmed.length > OUTPUT_TAIL ? "…" + trimmed.slice(-OUTPUT_TAIL) : trimmed;
}

// Gemountete Volumes (Docker, Azure Files) gehören oft einem anderen Benutzer als dem Prozess,
// dann bricht Git mit "dubious ownership" ab. Freigegeben wird nur das Repo, in dem die
// exportierten Dateien liegen – nur für diesen Aufruf, ohne die globale Git-Konfiguration zu ändern.
function git(cwd, args, trusted = cwd, env) {
  return new Promise((resolve, reject) => {
    execFile("git", ["-c", `safe.directory=${trusted}`, ...args], { cwd, env: env && { ...process.env, ...env }, timeout: 120_000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (!err) return resolve(stdout.trim());
      if (err.code === "ENOENT") return reject(new Error("git ist nicht installiert."));
      reject(new Error(tail(stderr || stdout || err.message)));
    });
  });
}

/** Nächster Ordner mit `.git` oberhalb von `dir` – dort sucht auch Git das Repository. */
function nearestRepo(dir) {
  for (let d = dir; ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, ".git"))) return d;
    if (path.dirname(d) === d) return dir;
  }
}

/** Ordnet Dateien ihrem Git-Repository zu – iOS und Android dürfen in verschiedenen Repos liegen. */
async function groupByRepo(files, base) {
  const repos = new Map();
  for (const file of files) {
    const real = fs.realpathSync(file);
    const dir = path.dirname(real);
    let root;
    try {
      root = await git(dir, ["rev-parse", "--show-toplevel"], nearestRepo(dir));
    } catch {
      throw new Error(`${(base && path.relative(base, file)) || file} liegt in keinem Git-Repository.`);
    }
    if (!repos.has(root)) repos.set(root, []);
    repos.get(root).push(path.relative(root, real));
  }
  return repos;
}

async function commitRepo(root, paths, { message, push }) {
  const result = { repo: root, commit: null, files: [], pushed: false };
  try {
    await git(root, ["add", "--", ...paths]);
    const staged = await git(root, ["diff", "--cached", "--name-only", "--", ...paths]);
    if (staged) {
      // Nur diese Pfade committen – was sonst im Index liegt, bleibt unberührt.
      await git(root, ["commit", "-m", message, "--", ...paths]);
      result.commit = await git(root, ["rev-parse", "--short", "HEAD"]);
      result.files = staged.split("\n");
    }
  } catch (e) {
    return { ...result, error: e.message };
  }
  if (!push) return result;

  // Ab hier ist der Commit sicher – Fehler beim Push lassen ihn lokal liegen.
  const local = () => (result.commit ? ` (Commit ${result.commit} liegt lokal)` : "");
  try {
    await git(root, ["pull", "--rebase", "--autostash"]);
  } catch (e) {
    await git(root, ["rebase", "--abort"]).catch(() => {});
    return { ...result, error: `Push abgebrochen, git pull --rebase ist fehlgeschlagen${local()}:\n${e.message}` };
  }
  // Nach dem Rebase hat der eigene Commit einen neuen Hash.
  if (result.commit) result.commit = await git(root, ["rev-parse", "--short", "HEAD"]).catch(() => result.commit);
  try {
    await git(root, ["push"]);
  } catch (e) {
    return { ...result, error: `Push fehlgeschlagen${local()}:\n${e.message}` };
  }
  return { ...result, pushed: true };
}

/** Committet (und pusht) die Dateien. Fehler pro Repository, damit ein Repo das andere nicht blockiert. */
export async function commitFiles(files, { message = DEFAULT_MESSAGE, push = false, base } = {}) {
  const results = [];
  for (const [root, paths] of await groupByRepo(files, base)) results.push(await commitRepo(root, paths, { message, push }));
  return results;
}

// ---------- Arbeitsbranches ----------

/** Etwas strenger als Git. Vor allem: Der Name landet in Git-Aufrufen und darf dort nie als Option gelesen werden. */
export function checkBranchName(name) {
  const valid = /^[A-Za-z0-9][A-Za-z0-9._\/-]*$/.test(name) && !/\.\.|\/\/|\/\.|\.lock(\/|$)|[/.]$/.test(name) && name !== "HEAD";
  if (!valid) throw new Error(`Ungültiger Branch-Name „${name}“. Erwartet wird etwas wie texte oder feature/tracking.`);
}

async function revision(root, ref) {
  try { return await git(root, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]); } catch { return null; }
}

async function isAncestor(root, older, newer) {
  try { await git(root, ["merge-base", "--is-ancestor", older, newer]); return true; } catch { return false; }
}

/** Remote des Branches, sonst der Standard fürs Pushen, sonst origin. */
async function remoteOf(root, branch) {
  const setting = async (key) => { try { return await git(root, ["config", "--get", key]); } catch { return ""; } };
  const remote = (await setting(`branch.${branch}.remote`)) || (await setting("remote.pushDefault")) || "origin";
  if (!(await git(root, ["remote"])).split("\n").includes(remote)) throw new Error(`Das Repository hat kein Remote „${remote}“.`);
  return remote;
}

/**
 * localize.json für einen Arbeitsbranch: Nur der eigene Teil kommt aus der aktuellen Datei, der Rest bleibt, wie er
 * auf dem Branch steht. So enthält der Tracking-Branch keine Textänderungen und umgekehrt, und beide lassen sich sauber mergen.
 */
function sourceForBranch(current, onBranch, sections) {
  if (!onBranch || FILE_KINDS.every((kind) => sections.includes(kind))) return current;
  try {
    const { tracking: myTracking, ...myRest } = JSON.parse(current);
    const { tracking: branchTracking, ...branchRest } = JSON.parse(onBranch);
    return serialize(sections.includes("tracking") ? { ...branchRest, tracking: myTracking } : { ...myRest, tracking: branchTracking });
  } catch {
    return current; // Auf dem Branch steht kein gültiges JSON – dann gilt die aktuelle Datei ganz.
  }
}

/**
 * Committet auf einen Branch, der gerade nicht ausgecheckt ist: Baut den neuen Stand über einen eigenen Index.
 * Arbeitsordner, aktueller Branch und Index des Nutzers bleiben dabei unberührt.
 */
async function commitToBranch(root, branch, paths, { source, sections, message, push }) {
  const result = { repo: root, branch, commit: null, files: [], pushed: false };
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "localize-branch-"));
  try {
    // Einen dort ausgecheckten Branch zu verschieben, ließe den anderen Arbeitsordner scheinbar alles rückgängig machen.
    const worktrees = await git(root, ["worktree", "list", "--porcelain"]);
    if (worktrees.split("\n").includes(`branch refs/heads/${branch}`)) throw new Error(`Der Branch ${branch} ist in einem anderen Arbeitsordner ausgecheckt.`);

    const remote = push ? await remoteOf(root, branch) : null;
    let remoteTip = null;
    if (remote && (await git(root, ["ls-remote", "--heads", remote, `refs/heads/${branch}`]))) {
      await git(root, ["fetch", "--quiet", "--no-tags", remote, `refs/heads/${branch}`]);
      remoteTip = await git(root, ["rev-parse", "FETCH_HEAD"]);
    }
    const localTip = await revision(root, `refs/heads/${branch}`);
    const remoteAhead = localTip && remoteTip && (await isAncestor(root, localTip, remoteTip));
    const diverged = localTip && remoteTip && !remoteAhead && !(await isAncestor(root, remoteTip, localTip));
    // Ein neuer Branch beginnt beim aktuellen Stand.
    const parent = remoteAhead ? remoteTip : localTip || remoteTip || (await revision(root, "HEAD"));

    const env = { GIT_INDEX_FILE: path.join(scratch, "index") };
    if (parent) await git(root, ["read-tree", parent], root, env);
    for (const rel of paths) {
      const gitPath = rel.split(path.sep).join("/");
      let from = path.join(root, rel);
      if (from === source) {
        const onBranch = parent ? await git(root, ["show", `${parent}:${gitPath}`]).catch(() => "") : "";
        from = path.join(scratch, "source");
        fs.writeFileSync(from, sourceForBranch(fs.readFileSync(source, "utf8"), onBranch, sections));
      }
      const blob = await git(root, ["hash-object", "-w", `--path=${gitPath}`, "--", from]);
      await git(root, ["update-index", "--add", "--cacheinfo", `100644,${blob},${gitPath}`], root, env);
    }
    const tree = await git(root, ["write-tree"], root, env);

    let tip = parent;
    if (!parent || tree !== (await git(root, ["rev-parse", `${parent}^{tree}`]))) {
      tip = await git(root, ["commit-tree", tree, ...(parent ? ["-p", parent] : []), "-m", message]);
      result.commit = await git(root, ["rev-parse", "--short", tip]);
      const changed = await git(root, ["diff-tree", "-r", "--root", "--no-commit-id", "--name-only", tip]);
      result.files = changed ? changed.split("\n") : [];
    }
    if (tip && tip !== localTip) await git(root, ["update-ref", `refs/heads/${branch}`, tip, localTip || ""]);
    if (!push) return result;

    const local = result.commit ? ` (Commit ${result.commit} liegt lokal auf ${branch})` : "";
    if (diverged) return { ...result, error: `Push abgebrochen, ${branch} und ${remote}/${branch} sind auseinandergelaufen${local}. Führe auf diesem Branch git pull --rebase aus und danach git push.` };
    try {
      await git(root, ["push", "--quiet", remote, `refs/heads/${branch}:refs/heads/${branch}`]);
    } catch (e) {
      return { ...result, error: `Push fehlgeschlagen${local}:\n${e.message}` };
    }
    return { ...result, pushed: true };
  } catch (e) {
    return { ...result, error: e.message };
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

/** Jede Dateiart auf ihren Branch. Dateiarten ohne eigenen Branch gehen wie gewohnt auf den aktuellen. */
async function commitByKind(options, { file, written, kinds, message, push }) {
  const groups = new Map();
  for (const kind of kinds) {
    const branch = options.branches?.[kind] || "";
    groups.set(branch, [...(groups.get(branch) ?? []), kind]);
  }
  const base = path.dirname(file);
  const results = [];
  // Arbeitsbranches zuerst: Ein neuer beginnt beim aktuellen Stand und soll nicht erben, was gleich dort committet wird.
  for (const [branch, sections] of [...groups].sort(([a], [b]) => Number(!a) - Number(!b))) {
    try {
      if (branch) checkBranchName(branch);
      const files = [file, ...written.filter((w) => sections.includes(w.kind)).map((w) => w.file)];
      for (const [root, paths] of await groupByRepo(files, base)) {
        const current = await git(root, ["symbolic-ref", "--quiet", "--short", "HEAD"]).catch(() => "");
        if (!branch || branch === current) {
          results.push({ ...(await commitRepo(root, paths, { message, push })), branch: current || null });
        } else {
          results.push(await commitToBranch(root, branch, paths, { source: fs.realpathSync(file), sections, message, push }));
        }
      }
    } catch (e) {
      results.push({ repo: null, branch: branch || null, commit: null, files: [], pushed: false, error: e.message });
    }
  }
  return results;
}

/** Führt den Befehl aus `--after-export` in einer Shell aus. */
export function runHook(command, { cwd, env }) {
  return new Promise((resolve) => {
    exec(command, { cwd, env: { ...process.env, ...env }, timeout: 300_000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      const output = tail([stdout, stderr].filter(Boolean).join("\n"));
      if (!err) return resolve({ ok: true, output });
      const reason = err.killed ? "nach 5 Minuten abgebrochen" : `Exit-Code ${err.code}`;
      resolve({ ok: false, output, error: `Befehl nach dem Export fehlgeschlagen (${reason}).` });
    });
  });
}

/**
 * Läuft nach einem erfolgreichen Export: erst Commit/Push, dann der eigene Befehl.
 * `written` sind die exportierten Dateien ({kind, file, changed}), `file` ist localize.json.
 * `kinds`: welche Dateiarten dieser Export umfasst, wichtig für `options.branches` ({ localizable, tracking }).
 */
export async function afterExport(options, { file, written, message, kinds = FILE_KINDS }) {
  const result = {};
  if (options.commit || options.push) {
    const text = message?.trim() || options.message || DEFAULT_MESSAGE;
    if (Object.values(options.branches ?? {}).some(Boolean)) {
      result.git = await commitByKind(options, { file, written, kinds, message: text, push: !!options.push });
    } else {
      const files = [file, ...written.map((w) => w.file)];
      try {
        result.git = await commitFiles(files, { message: text, push: !!options.push, base: path.dirname(file) });
      } catch (e) {
        result.git = [{ repo: null, commit: null, files: [], pushed: false, error: e.message }];
      }
    }
  }
  if (options.hook) {
    if (result.git?.some((r) => r.error)) {
      result.hook = { ok: false, skipped: true, error: "Befehl nach dem Export übersprungen, weil Git fehlgeschlagen ist." };
    } else {
      result.hook = await runHook(options.hook, {
        cwd: path.dirname(file),
        env: {
          LOCALIZE_ME_FILE: file,
          LOCALIZE_ME_FILES: written.map((w) => w.file).join("\n"),
          LOCALIZE_ME_CHANGED: written.filter((w) => w.changed).map((w) => w.file).join("\n"),
          LOCALIZE_ME_COMMITS: (result.git || []).filter((r) => r.commit).map((r) => r.commit).join(" "),
        },
      });
    }
  }
  return result;
}

export function failed(result) {
  return !!(result.git?.some((r) => r.error) || (result.hook && !result.hook.ok));
}
