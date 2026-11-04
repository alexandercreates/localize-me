import { check } from "@shared/placeholders.js";
import { checkPlural, isFilled, isPluralKey, isPluralValue, textOf } from "@shared/plurals.js";
import { onlyOf } from "@shared/platforms.js";
import { TRACKING_FILENAMES, trackingOf } from "@shared/tracking.js";
import { publicUrl, unconfiguredPrefix } from "./urls.js";

// Einstellungen pro Browser (Zielsprache, Export-Optionen). Fehlt localStorage, gelten die Standards.
export const prefs = {
  get(key, fallback) {
    try { return localStorage.getItem("lm." + key) ?? fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem("lm." + key, value); } catch {}
  },
};

export const ONLY_LABELS = { "": "iOS + Android", ios: "Nur iOS", android: "Nur Android" };

export const namespaceOf = (key) => (key.includes(".") ? key.slice(0, key.indexOf(".")) : "");

class Model {
  project = $state(null);
  connection = $state("connecting"); // connecting | ok | lost
  view = $state(prefs.get("view", "localizable")); // localizable | tracking
  trackingSection = $state(prefs.get("trackingSection", "events")); // screens | events | parameters
  trackingSearch = $state("");
  chosenTarget = $state(prefs.get("target", ""));
  search = $state("");
  filter = $state("all"); // all | missing | review | done
  namespace = $state(null); // null = alle Bereiche, "" = ohne Präfix
  exportOpen = $state(false);
  addLangOpen = $state(false);
  toast = $state(null);
  setupNotices = $state([]); // { variable, message } – was an der Serverkonfiguration fehlt

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
    return { key, values, plural, only: onlyOf(this.project, key), base, target, baseProblems, problems, status, searchText, ns: namespaceOf(key) };
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

  tracking = $derived(this.project ? trackingOf(this.project) : { screens: {}, events: {}, parameters: {} });
  trackingCount = $derived(Object.values(this.tracking).reduce((n, items) => n + Object.keys(items).length, 0));

  // Zielordner aus "output" in localize.json, gleiche Reihenfolge wie beim Schreiben auf dem Server.
  targets = $derived.by(() => {
    const output = this.project?.output ?? {};
    const hasPlurals = this.keyNames.some((k) => isPluralKey(this.project.keys[k]));
    const list = [];
    for (const platform of ["ios", "android"]) {
      if (!output[platform]) continue;
      const file = platform === "android" ? "strings.xml" : hasPlurals ? "Localizable.strings + .stringsdict" : "Localizable.strings";
      list.push({ kind: "localizable", platform, dir: output[platform], file });
    }
    for (const platform of ["ios", "android"]) {
      if (output.tracking?.[platform]) list.push({ kind: "tracking", platform, dir: output.tracking[platform], file: TRACKING_FILENAMES[platform] });
    }
    return list;
  });

  setView(view) {
    this.view = view;
    prefs.set("view", view);
  }

  setTrackingSection(section) {
    this.trackingSection = section;
    prefs.set("trackingSection", section);
  }

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
      res = await fetch(publicUrl(url), {
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

  /** Sammelt, was die Konfiguration verhindert. Schlägt die Abfrage fehl, meldet das schon die Verbindungsanzeige. */
  async checkSetup() {
    const prefix = unconfiguredPrefix();
    if (prefix) {
      // API-Aufrufe erreichen den Server ohne Präfix nicht, mehr lässt sich hier also nicht herausfinden.
      this.setupNotices = [{ variable: "PUBLIC_BASE_PATH", message: `Diese Seite läuft unter ${prefix}, dem Server fehlt aber der Präfix. Deshalb lassen sich keine Texte laden.`, fix: `PUBLIC_BASE_PATH=${prefix}` }];
      return;
    }
    try {
      const res = await fetch(publicUrl("/api/setup?" + new URLSearchParams({ origin: location.origin })));
      if (!res.ok) return;
      const { problems, originAccepted } = await res.json();
      const notices = [...problems];
      if (!originAccepted && !problems.some((p) => p.variable === "PUBLIC_ORIGIN")) {
        notices.push({ variable: "PUBLIC_ORIGIN", message: `Der Server kennt die Adresse ${location.origin} nicht. Du kannst Texte lesen, aber Änderungen werden nicht gespeichert.`, fix: `PUBLIC_ORIGIN=${location.origin}` });
      }
      this.setupNotices = notices;
    } catch {}
  }

  connect() {
    const events = new EventSource(publicUrl("/api/events"));
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
export const trackingUrl = (section, name) => `/api/tracking/${section}` + (name === undefined ? "" : "/" + encodeURIComponent(name));
