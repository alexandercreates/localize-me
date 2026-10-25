import { check } from "@shared/placeholders.js";
import { checkPlural, isFilled, isPluralKey, isPluralValue, textOf } from "@shared/plurals.js";

// Einstellungen pro Browser (Zielsprache, Export-Optionen). Fehlt localStorage, gelten die Standards.
export const prefs = {
  get(key, fallback) {
    try { return localStorage.getItem("lm." + key) ?? fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem("lm." + key, value); } catch {}
  },
};

export const namespaceOf = (key) => (key.includes(".") ? key.slice(0, key.indexOf(".")) : "");

class Model {
  project = $state(null);
  connection = $state("connecting"); // connecting | ok | lost
  chosenTarget = $state(prefs.get("target", ""));
  search = $state("");
  filter = $state("all"); // all | missing | review | done
  namespace = $state(null); // null = alle Bereiche, "" = ohne Präfix
  exportOpen = $state(false);
  addLangOpen = $state(false);
  toast = $state(null);

  base = $derived(this.project?.base ?? "");
  languages = $derived(this.project?.languages ?? []);
  others = $derived(this.languages.filter((l) => l.code !== this.base));
  target = $derived(this.others.some((l) => l.code === this.chosenTarget) ? this.chosenTarget : (this.others[0]?.code ?? ""));
  keyNames = $derived(this.project ? Object.keys(this.project.keys).sort((a, b) => a.localeCompare(b)) : []);

  // Bei Plurals sind `base`/`target` die Form „other“ (für Vorschau), `baseForms`/`targetForms` alle Formen.
  rows = $derived(this.keyNames.map((key) => {
    const values = this.project.keys[key];
    const plural = isPluralKey(values);
    const base = textOf(values[this.base]);
    const target = this.target ? textOf(values[this.target]) : "";
    const filled = this.target && isFilled(values[this.target]);
    let baseProblems, problems;
    if (plural) {
      const baseForms = isPluralValue(values[this.base]) ? values[this.base] : {};
      baseProblems = checkPlural(baseForms, undefined, this.base, { isBase: true });
      problems = filled ? checkPlural(baseForms, values[this.target], this.target) : [];
    } else {
      baseProblems = check(base, "");
      problems = filled ? check(base, target).filter((p) => !baseProblems.includes(p)) : [];
    }
    let status = "base";
    if (this.target) status = !filled ? "missing" : problems.length ? "review" : "done";
    const forms = (code) => (isPluralValue(values[code]) ? Object.values(values[code]) : [values[code] || ""]);
    const searchText = [...forms(this.base), ...(this.target ? forms(this.target) : [])].join("\n").toLowerCase();
    return { key, values, plural, base, target, baseProblems, problems, status, searchText, ns: namespaceOf(key) };
  }));

  namespaces = $derived.by(() => {
    const counts = new Map();
    for (const r of this.rows) counts.set(r.ns, (counts.get(r.ns) || 0) + 1);
    return [...counts].sort(([a], [b]) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)));
  });

  // Suche und Bereich eingrenzen; die Filter-Chips zählen innerhalb dieser Auswahl.
  scoped = $derived.by(() => {
    const q = this.search.trim().toLowerCase();
    return this.rows.filter((r) =>
      (this.namespace === null || r.ns === this.namespace) &&
      (!q || r.key.toLowerCase().includes(q) || r.searchText.includes(q)));
  });
  counts = $derived(countStatus(this.scoped));
  totals = $derived(countStatus(this.rows));
  visible = $derived(this.filter === "all" ? this.scoped : this.scoped.filter((r) => r.status === this.filter));

  langName(code) {
    return this.languages.find((l) => l.code === code)?.name || code;
  }

  progress(code) {
    const total = this.keyNames.length;
    const done = this.keyNames.filter((k) => isFilled(this.project.keys[k][code])).length;
    return { done, total, ratio: total ? done / total : 0 };
  }

  setTarget(code) {
    this.chosenTarget = code;
    prefs.set("target", code);
  }

  resetFilters() {
    this.search = "";
    this.filter = "all";
    this.namespace = null;
  }

  notify(text, kind = "ok") {
    clearTimeout(this.toastTimer);
    this.toast = { text, kind, id: Date.now() };
    this.toastTimer = setTimeout(() => (this.toast = null), kind === "error" ? 6000 : 3500);
  }

  // ---------- Server ----------

  async request(method, url, body) {
    let res;
    try {
      res = await fetch(url, {
        method,
        headers: body ? { "Content-Type": "application/json" } : {},
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      this.connection = "lost";
      throw new Error("Keine Verbindung zum Server. Läuft localize-me noch im Terminal?");
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Anfrage fehlgeschlagen (${res.status}).`);
    this.connection = "ok";
    return data;
  }

  async load() {
    try {
      this.project = await this.request("GET", "/api/project");
    } catch (e) {
      this.notify(e.message, "error");
    }
  }

  /** Schreibt eine Änderung. Liefert null bei Erfolg, sonst die Fehlermeldung (für Anzeige direkt am Feld). */
  async mutate(method, url, body) {
    try {
      this.project = await this.request(method, url, body);
      return null;
    } catch (e) {
      return e.message;
    }
  }

  /** Wie mutate, zeigt Fehler aber als Hinweis unten an. */
  async run(method, url, body, success) {
    const error = await this.mutate(method, url, body);
    if (error) this.notify(error, "error");
    else if (success) this.notify(success);
    return !error;
  }

  connect() {
    const events = new EventSource("/api/events");
    events.addEventListener("change", () => this.load());
    events.addEventListener("open", () => {
      if (this.connection === "lost") this.load();
      this.connection = "ok";
    });
    events.addEventListener("error", () => (this.connection = "lost"));
    return () => events.close();
  }
}

function countStatus(rows) {
  const c = { all: rows.length, missing: 0, review: 0, done: 0 };
  for (const r of rows) if (r.status in c) c[r.status]++;
  return c;
}

export const app = new Model();
export const keyUrl = (key) => "/api/keys/" + encodeURIComponent(key);
