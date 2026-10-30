import fs from "node:fs";
import path from "node:path";
import { exec, execFile } from "node:child_process";

// Was nach einem Export passiert: Commit (+ Push) und/oder ein eigener Befehl.
// Wird nur über die CLI konfiguriert, nie über localize.json – sonst könnte jeder,
// der die Textdatei ändern darf, Befehle auf dem Server ausführen.

export const DEFAULT_MESSAGE = "Texte aktualisiert (localize-me)";
const OUTPUT_TAIL = 2000;

function tail(text) {
  const trimmed = text.trim();
  return trimmed.length > OUTPUT_TAIL ? "…" + trimmed.slice(-OUTPUT_TAIL) : trimmed;
}

// Gemountete Volumes (Docker, Azure Files) gehören oft einem anderen Benutzer als dem Prozess,
// dann bricht Git mit "dubious ownership" ab. Freigegeben wird nur das Repo, in dem die
// exportierten Dateien liegen – nur für diesen Aufruf, ohne die globale Git-Konfiguration zu ändern.
function git(cwd, args, trusted = cwd) {
  return new Promise((resolve, reject) => {
    execFile("git", ["-c", `safe.directory=${trusted}`, ...args], { cwd, timeout: 120_000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
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
 * `written` sind die exportierten Dateien ({file, changed}), `file` ist localize.json.
 */
export async function afterExport(options, { file, written, message }) {
  const result = {};
  if (options.commit || options.push) {
    const files = [file, ...written.map((w) => w.file)];
    try {
      result.git = await commitFiles(files, { message: message?.trim() || options.message || DEFAULT_MESSAGE, push: !!options.push, base: path.dirname(file) });
    } catch (e) {
      result.git = [{ repo: null, commit: null, files: [], pushed: false, error: e.message }];
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
