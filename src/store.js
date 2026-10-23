import fs from "node:fs";
import path from "node:path";

// localize.json – eine Datei, git-freundlich: Keys alphabetisch, eine Zeile pro Sprache.
//
// {
//   "base": "de",
//   "languages": [{ "code": "de", "name": "Deutsch" }],
//   "keys": { "onboarding.title": { "de": "Willkommen!" } }
// }

export const KEY_PATTERN = /^[A-Za-z0-9_.\-]+$/;
export const LANG_PATTERN = /^[a-z]{2,3}([-_][A-Za-z0-9]{2,4})?$/;

const DEFAULT_PROJECT = {
  base: "de",
  languages: [{ code: "de", name: "Deutsch" }],
  keys: {},
};

export class ValidationError extends Error {}

export function normalize(data) {
  const languages = Array.isArray(data?.languages) && data.languages.length
    ? data.languages
        .filter((l) => l && typeof l.code === "string")
        .map((l) => ({ code: l.code, name: typeof l.name === "string" && l.name ? l.name : l.code }))
    : structuredClone(DEFAULT_PROJECT.languages);
  const base = languages.some((l) => l.code === data?.base) ? data.base : languages[0].code;
  const keys = {};
  for (const name of Object.keys(data?.keys || {}).sort((a, b) => a.localeCompare(b))) {
    const values = data.keys[name] || {};
    keys[name] = {};
    for (const code of Object.keys(values).sort()) {
      if (typeof values[code] === "string") keys[name][code] = values[code];
    }
  }
  return { base, languages, keys };
}

export function serialize(project) {
  return JSON.stringify(normalize(project), null, 2) + "\n";
}

export class Store {
  constructor(file) {
    this.file = path.resolve(file);
    this.lastWritten = null;
    this.project = this.read();
  }

  read() {
    if (!fs.existsSync(this.file)) return structuredClone(DEFAULT_PROJECT);
    const raw = fs.readFileSync(this.file, "utf8");
    try {
      return normalize(JSON.parse(raw));
    } catch (e) {
      throw new Error(`${this.file} ist kein gültiges JSON: ${e.message}`);
    }
  }

  /** Datei neu einlesen (z. B. nach git pull). Liefert true, wenn sich etwas geändert hat. */
  reload() {
    if (!fs.existsSync(this.file)) return false;
    const raw = fs.readFileSync(this.file, "utf8");
    if (raw === this.lastWritten) return false;
    try {
      const next = normalize(JSON.parse(raw));
      if (serialize(next) === serialize(this.project)) return false;
      this.project = next;
      return true;
    } catch {
      return false; // halb geschriebene Datei – beim nächsten Event erneut
    }
  }

  save() {
    const out = serialize(this.project);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + ".tmp";
    fs.writeFileSync(tmp, out);
    fs.renameSync(tmp, this.file);
    this.lastWritten = out;
    this.project = normalize(this.project);
  }

  ensureFile() {
    if (!fs.existsSync(this.file)) this.save();
  }

  // ---------- Änderungen ----------

  addKey(name, values = {}) {
    name = String(name || "").trim();
    if (!name) throw new ValidationError("Gib einen Key ein, zum Beispiel settings.title.");
    if (!KEY_PATTERN.test(name)) throw new ValidationError("Keys dürfen nur Buchstaben, Ziffern, Punkt, Unterstrich und Bindestrich enthalten.");
    if (this.project.keys[name]) throw new ValidationError(`„${name}“ gibt es schon.`);
    this.project.keys[name] = this.#cleanValues(values);
    this.save();
  }

  renameKey(name, next) {
    next = String(next || "").trim();
    this.#requireKey(name);
    if (next === name) return;
    if (!KEY_PATTERN.test(next)) throw new ValidationError("Keys dürfen nur Buchstaben, Ziffern, Punkt, Unterstrich und Bindestrich enthalten.");
    if (this.project.keys[next]) throw new ValidationError(`„${next}“ gibt es schon.`);
    this.project.keys[next] = this.project.keys[name];
    delete this.project.keys[name];
    this.save();
  }

  setValue(name, lang, value) {
    this.#requireKey(name);
    if (typeof value !== "string") throw new ValidationError("Der Text muss eine Zeichenkette sein.");
    if (value === "") delete this.project.keys[name][lang];
    else this.project.keys[name][lang] = value;
    this.save();
  }

  deleteKey(name) {
    this.#requireKey(name);
    delete this.project.keys[name];
    this.save();
  }

  addLanguage(code, name) {
    code = String(code || "").trim();
    if (!LANG_PATTERN.test(code)) throw new ValidationError("Nutze einen Sprachcode wie en, fr oder pt-BR.");
    if (this.project.languages.some((l) => l.code.toLowerCase() === code.toLowerCase())) {
      throw new ValidationError(`Die Sprache ${code} gibt es schon.`);
    }
    this.project.languages.push({ code, name: String(name || "").trim() || code });
    this.save();
  }

  /** Entfernt die Sprache aus der Liste. Vorhandene Texte bleiben in der Datei, bis `purge` gesetzt ist. */
  removeLanguage(code, { purge = false } = {}) {
    if (code === this.project.base) throw new ValidationError("Die Basissprache lässt sich nicht entfernen.");
    if (!this.project.languages.some((l) => l.code === code)) throw new ValidationError(`Die Sprache ${code} gibt es nicht.`);
    this.project.languages = this.project.languages.filter((l) => l.code !== code);
    if (purge) for (const values of Object.values(this.project.keys)) delete values[code];
    this.save();
  }

  setBase(code) {
    if (!this.project.languages.some((l) => l.code === code)) throw new ValidationError(`Die Sprache ${code} gibt es nicht.`);
    this.project.base = code;
    this.save();
  }

  #requireKey(name) {
    if (!this.project.keys[name]) throw new ValidationError(`Den Key „${name}“ gibt es nicht.`);
  }

  #cleanValues(values) {
    const out = {};
    for (const [code, v] of Object.entries(values || {})) {
      if (typeof v === "string" && v !== "") out[code] = v;
    }
    return out;
  }
}
