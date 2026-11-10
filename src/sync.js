import fs from "node:fs";
import path from "node:path";
import { normalize, serialize } from "./store.js";
import { git, isAncestor, nearestRepo, remoteOf, revision } from "./versioning.js";

// Hält die localize.json eines laufenden Servers auf dem Stand des Remotes (--sync).
//
// Abgeglichen wird nicht per git pull, sondern pro Text: Was sich auf einem Branch geändert hat, wird in den aktuellen
// Stand übernommen. So bekommt ein Container auf `texte` die Texte von `main`, aber keinen App-Code, und Bearbeitungen
// aus der Oberfläche, die noch nicht exportiert sind, stehen dem Abgleich nicht im Weg.
//
// Quellen: der ausgecheckte Branch, die Arbeitsbranches aus der CLI und der Standard-Branch des Remotes.

export const DEFAULT_SYNC_INTERVAL = 60;

// Ohne das wartet Git bei fehlenden Zugangsdaten für immer auf eine Eingabe.
const NO_PROMPT = { GIT_TERMINAL_PROMPT: "0" };

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const own = (object, key) => (isObject(object) && Object.hasOwn(object, key) ? object[key] : undefined);

/** Sprachen als Objekt, damit sie sich wie alles andere pro Eintrag zusammenführen lassen. */
function lift(project) {
  if (!project) return {};
  const { languages, ...rest } = project;
  return { ...rest, languages: Object.fromEntries(languages.map((l) => [l.code, l.name])) };
}

function lower({ languages, ...rest }) {
  return normalize({ ...rest, languages: Object.entries(languages ?? {}).map(([code, name]) => ({ code, name })) });
}

function merge3(base, ours, theirs, known, at, conflicts) {
  if (same(ours, theirs) || same(base, theirs)) return ours;
  if (same(base, ours)) return theirs;
  if (isObject(ours) && isObject(theirs) && (isObject(base) || base === undefined)) {
    const merged = {};
    for (const key of new Set([...Object.keys(ours), ...Object.keys(theirs)])) {
      const value = merge3(own(base, key), own(ours, key), own(theirs, key), own(known, key), [...at, key], conflicts);
      if (value !== undefined) merged[key] = value;
    }
    return merged;
  }
  // Steht auf dem Remote nur ein älterer eigener Stand, z. B. nach dem Merge von texte nach main.
  if (known !== undefined && same(known, theirs)) return ours;
  conflicts.push({ path: at, theirs });
  return ours;
}

/**
 * Überträgt die Änderungen von `base` nach `theirs` auf `ours`. Im Konflikt bleibt `ours` stehen und der Remote-Wert
 * landet in `conflicts`. `known`: eigener committeter Stand, zählt nicht als Konflikt. `base` darf null sein.
 */
export function mergeProjects(base, ours, theirs, known = null) {
  const conflicts = [];
  const merged = merge3(lift(base), lift(ours), lift(theirs), lift(known), [], conflicts);
  return { project: lower(merged), conflicts };
}

function valueAt(lifted, at) {
  return at.reduce((value, key) => own(value, key), lifted);
}

function setValueAt(lifted, at, value) {
  let parent = lifted;
  for (const key of at.slice(0, -1)) {
    if (!isObject(own(parent, key))) parent[key] = {};
    parent = parent[key];
  }
  const last = at[at.length - 1];
  if (value === undefined) delete parent[last];
  else parent[last] = value;
}

/** Inhalt der Datei in einem Commit, null wenn sie dort fehlt. */
const show = (root, rev, rel) => git(root, ["show", `${rev}:${rel}`]).catch(() => null);

function parse(text) {
  if (text === null) return null;
  try { return normalize(JSON.parse(text)); } catch { return null; }
}

const mergeBase = (root, a, b) => git(root, ["merge-base", a, b]).catch(() => null);

/** Welche Branches abgeglichen werden. Der ausgecheckte steht vorn, er wird zusätzlich vorgespult. */
async function sourcesOf(root, branches) {
  const current = await git(root, ["symbolic-ref", "--quiet", "--short", "HEAD"]).catch(() => "");
  const remote = await remoteOf(root, current || "HEAD");
  const sources = new Map();
  if (current) {
    const merge = await git(root, ["config", "--get", `branch.${current}.merge`]).catch(() => "");
    sources.set(merge.replace(/^refs\/heads\//, "") || current, { own: true });
  }
  const remoteDefault = async () => {
    const known = await git(root, ["symbolic-ref", "--quiet", "--short", `refs/remotes/${remote}/HEAD`]).catch(() => "");
    if (known.startsWith(`${remote}/`)) return known.slice(remote.length + 1);
    const out = await git(root, ["ls-remote", "--symref", remote, "HEAD"], root, NO_PROMPT).catch(() => "");
    return out.match(/^ref: refs\/heads\/(\S+)\s+HEAD/m)?.[1] ?? "";
  };
  for (const branch of [...Object.values(branches ?? {}), await remoteDefault()]) {
    if (branch && !sources.has(branch)) sources.set(branch, { own: false });
  }
  return { remote, sources };
}

/** Holt die Branches, die sich bewegt haben. Liefert ihren aktuellen Commit, Branches ohne Remote-Stand fehlen. */
async function fetchTips(root, remote, names) {
  const out = await git(root, ["ls-remote", "--heads", remote, ...names.map((b) => `refs/heads/${b}`)], root, NO_PROMPT);
  const tips = new Map();
  for (const line of out.split("\n").filter(Boolean)) {
    const [sha, ref] = line.split(/\s+/);
    tips.set(ref.replace(/^refs\/heads\//, ""), sha);
  }
  for (const [branch, sha] of tips) {
    if ((await revision(root, `refs/remotes/${remote}/${branch}`)) === sha) continue;
    await git(root, ["fetch", "--quiet", "--no-tags", remote, `+refs/heads/${branch}:refs/remotes/${remote}/${branch}`], root, NO_PROMPT);
  }
  return tips;
}

/**
 * `interval`: Sekunden zwischen zwei Abgleichen, 0 nur auf Anfrage über `run()`.
 * `isBusy`: Solange das gilt (Export läuft), fällt der regelmäßige Abgleich aus.
 * `onChange`: Texte oder Status haben sich geändert.
 */
export function createSync({ store, branches, interval = DEFAULT_SYNC_INTERVAL, isBusy = () => false, onChange = () => {} }) {
  let timer = null;
  let running = null;
  let root = null;
  let rel = null;
  let stateFile = null;
  let state = { seen: {}, conflicts: [] };
  let error = null;
  let lastSync = null;
  let sourceNames = [];

  const fingerprint = () => JSON.stringify([error, sourceNames, state.conflicts]);

  function saveState() {
    if (stateFile) fs.writeFileSync(stateFile, JSON.stringify(state, null, 2) + "\n");
  }

  async function locate() {
    if (root) return;
    const real = fs.realpathSync(store.file);
    const dir = path.dirname(real);
    let top;
    try {
      top = await git(dir, ["rev-parse", "--show-toplevel"], nearestRepo(dir));
    } catch {
      throw new Error(`${path.basename(store.file)} liegt in keinem Git-Repository.`);
    }
    rel = path.relative(top, real).split(path.sep).join("/");
    // Im .git-Ordner: gehört nicht ins Repo und übersteht Neustarts des Containers.
    stateFile = path.resolve(top, await git(top, ["rev-parse", "--git-path", `localize-me-sync.${rel.replace(/[^\w.-]/g, "_")}.json`]));
    try {
      const saved = JSON.parse(fs.readFileSync(stateFile, "utf8"));
      state = { seen: saved.seen ?? {}, conflicts: saved.conflicts ?? [] };
    } catch {
      // Noch kein Abgleich gelaufen.
    }
    root = top;
  }

  /** Bringt die Änderungen eines Branches in den aktuellen Stand. Liefert true, wenn sich Texte geändert haben. */
  function apply(branch, baseText, theirsText, knownText) {
    if (theirsText === null) return false; // Auf dem Branch gibt es die Datei nicht, das ist kein Löschen.
    const theirs = parse(theirsText);
    if (!theirs) throw new Error(`${rel} auf ${branch} ist kein gültiges JSON.`);
    const { project, conflicts } = mergeProjects(parse(baseText), store.project, theirs, parse(knownText));
    for (const conflict of conflicts) {
      const id = JSON.stringify(conflict.path);
      state.conflicts = [...state.conflicts.filter((c) => c.id !== id), { id, source: branch, ...conflict }];
    }
    if (serialize(project) === serialize(store.project)) return false;
    store.project = project;
    store.save();
    return true;
  }

  async function syncCheckedOut(branch, tip) {
    const head = await revision(root, "HEAD");
    if (head === tip || (head && (await isAncestor(root, tip, head)))) return false;
    const behind = !!head && (await isAncestor(root, head, tip));
    const base = behind ? head : head && (await mergeBase(root, head, tip));
    const changed = apply(branch, base ? await show(root, base, rel) : null, await show(root, tip, rel), null);
    if (!behind) return changed; // Lokale Commits, die noch nicht gepusht sind: Das erledigt der nächste Export.
    // Der Branch selbst rückt auch vor, sonst käme beim Export ein Rebase auf die eben übernommenen Zeilen.
    const tracked = (await show(root, head, rel)) !== null;
    await store.whileHeld(async () => {
      if (tracked) await git(root, ["checkout", "-q", "HEAD", "--", rel]);
      else fs.rmSync(path.join(root, rel), { force: true });
      await git(root, ["merge", "--ff-only", "-q", tip]);
    });
    return changed;
  }

  async function syncOther(branch, tip) {
    if (state.seen[branch] === tip) return false;
    const seen = state.seen[branch] && (await revision(root, state.seen[branch]));
    const head = await revision(root, "HEAD");
    const base = seen || (head && (await mergeBase(root, head, tip)));
    const known = head ? await show(root, head, rel) : null;
    const changed = apply(branch, base ? await show(root, base, rel) : null, await show(root, tip, rel), known);
    state.seen[branch] = tip;
    return changed;
  }

  async function once() {
    const before = fingerprint();
    let changed = false;
    const errors = [];
    try {
      await locate();
      const { remote, sources } = await sourcesOf(root, branches);
      sourceNames = [...sources.keys()];
      const tips = await fetchTips(root, remote, sourceNames);
      for (const [branch, { own: isOwn }] of sources) {
        if (!tips.has(branch)) continue;
        try {
          if (await (isOwn ? syncCheckedOut : syncOther)(branch, tips.get(branch))) changed = true;
        } catch (e) {
          errors.push(`${branch}: ${e.message}`);
        }
      }
      // Hat sich ein Konflikt von selbst erledigt, muss niemand mehr entscheiden.
      const lifted = lift(store.project);
      state.conflicts = state.conflicts.filter((c) => !same(valueAt(lifted, c.path), c.theirs));
      saveState();
      if (!errors.length) lastSync = new Date().toISOString();
    } catch (e) {
      errors.push(e.message);
    }
    error = errors.join("\n") || null;
    if (error && error !== JSON.parse(before)[0]) console.error(`localize-me: Abgleich mit Git fehlgeschlagen:\n${error}`);
    if (changed || fingerprint() !== before) onChange();
  }

  /** Startet einen Abgleich oder hängt sich an den laufenden. Schlägt nie fehl, Fehler stehen in status(). */
  function run() {
    running ??= once().catch((e) => { error = e.message; }).finally(() => { running = null; });
    return running;
  }

  return {
    run,

    start() {
      run();
      if (interval > 0) {
        timer = setInterval(() => { if (!isBusy()) run(); }, interval * 1000);
        timer.unref();
      }
    },

    stop() {
      clearInterval(timer);
    },

    status() {
      const lifted = lift(store.project);
      return {
        enabled: true,
        lastSync,
        error,
        sources: sourceNames,
        conflicts: state.conflicts.map((c) => ({ id: c.id, source: c.source, path: c.path, ours: valueAt(lifted, c.path), theirs: c.theirs })),
      };
    },

    /** `use`: "remote" übernimmt den Wert vom Branch, "local" lässt den aktuellen stehen. */
    resolve(id, use) {
      const conflict = state.conflicts.find((c) => c.id === id);
      if (!conflict) return false;
      if (use === "remote") {
        const lifted = lift(store.project);
        setValueAt(lifted, conflict.path, conflict.theirs);
        store.project = lower(lifted);
        store.save();
      }
      state.conflicts = state.conflicts.filter((c) => c !== conflict);
      saveState();
      return true;
    },

    /** Eigene Pushes auf Arbeitsbranches sind keine Änderungen von außen. */
    async exported(results = []) {
      if (!root) return;
      for (const result of results) {
        if (!result.pushed || !result.branch || result.repo !== root) continue;
        const tip = await revision(root, `refs/heads/${result.branch}`);
        if (tip) state.seen[result.branch] = tip;
      }
      saveState();
    },
  };
}
