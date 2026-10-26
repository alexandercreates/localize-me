import fs from "node:fs";
import path from "node:path";
import { CATEGORIES, isPluralKey, isPluralValue } from "./plurals.js";
import { ONLY_PLATFORMS } from "./platforms.js";

// localize.json – eine Datei, git-freundlich: Keys alphabetisch, eine Zeile pro Sprache.
//
// {
//   "base": "de",
//   "languages": [{ "code": "de", "name": "Deutsch" }],
//   "output": { "ios": "../ios/App/Resources", "android": "../android/app/src/main/res" },
//   "only": { "settings.face_id": "ios" },
//   "keys": {
//     "onboarding.title": { "de": "Willkommen!" },
//     "tasks.open": { "de": { "one": "Eine Aufgabe", "other": "#count:int Aufgaben" } }
//   }
// }
//
// `output` ist optional: Zielordner für `localize-me export`, relativ zu localize.json.
// `only` ist optional: Keys, die nur eine Plattform braucht (siehe platforms.js).
// Plurals (siehe plurals.js): Hat eine Sprache Formen, wird der ganze Key zum Plural.

export const KEY_PATTERN = /^[A-Za-z0-9_.\-]+$/;
export const LANG_PATTERN = /^[a-z]{2,3}([-_][A-Za-z0-9]{2,4})?$/;
// Würde als Objekt-Schlüssel den Prototyp ersetzen statt einen Eintrag anzulegen.
const RESERVED = "__proto__";

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
    if (name === RESERVED) continue;
    const values = data.keys[name] || {};
    const plural = isPluralKey(values);
    keys[name] = {};
    for (const code of Object.keys(values).sort()) {
      if (code === RESERVED) continue;
      const value = values[code];
      if (!plural) {
        if (typeof value === "string") keys[name][code] = value;
        continue;
      }
      const forms = normalizeForms(isPluralValue(value) ? value : typeof value === "string" && value ? { other: value } : {});
      // Leere Formen nur in der Basissprache behalten, damit der Key ein Plural bleibt.
      if (Object.keys(forms).length || code === base) keys[name][code] = forms;
    }
    if (plural && !isPluralKey(keys[name])) keys[name][base] = {};
  }
  const output = {};
  for (const platform of ["ios", "android"]) {
    const dir = data?.output?.[platform];
    if (typeof dir === "string" && dir.trim()) output[platform] = dir.trim();
  }
  const only = {};
  for (const name of Object.keys(data?.only || {}).sort((a, b) => a.localeCompare(b))) {
    if (Object.hasOwn(keys, name) && ONLY_PLATFORMS.includes(data.only[name])) only[name] = data.only[name];
  }
  return {
    base,
    languages,
    ...(Object.keys(output).length && { output }),
    ...(Object.keys(only).length && { only }),
    keys,
  };
}

/** Nur bekannte Pluralformen mit Text, in fester Reihenfolge. */
function normalizeForms(value) {
  const forms = {};
  for (const c of CATEGORIES) if (typeof value[c] === "string" && value[c] !== "") forms[c] = value[c];
  return forms;
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

  addKey(name, values = {}, { plural = false, only = "" } = {}) {
    name = String(name || "").trim();
    if (!name) throw new ValidationError("Gib einen Key ein, zum Beispiel settings.title.");
    this.#checkKeyName(name);
    if (Object.hasOwn(this.project.keys, name)) throw new ValidationError(`„${name}“ gibt es schon.`);
    this.#checkOnly(only);
    this.project.keys[name] = this.#cleanValues(values);
    if (only) this.project.only = { ...this.project.only, [name]: only };
    if (plural) this.project.keys[name] = Object.fromEntries(
      Object.entries(this.project.keys[name]).map(([code, v]) => [code, isPluralValue(v) ? v : { other: v }]));
    if (plural && !this.project.keys[name][this.project.base]) this.project.keys[name][this.project.base] = {};
    this.save();
  }

  renameKey(name, next) {
    next = String(next || "").trim();
    this.#requireKey(name);
    if (next === name) return;
    this.#checkKeyName(next);
    if (Object.hasOwn(this.project.keys, next)) throw new ValidationError(`„${next}“ gibt es schon.`);
    this.project.keys[next] = this.project.keys[name];
    delete this.project.keys[name];
    if (this.project.only?.[name]) {
      this.project.only[next] = this.project.only[name];
      delete this.project.only[name];
    }
    this.save();
  }

  /** Setzt einen Text. Bei Plural-Keys gehört `form` dazu (one, other, …). */
  setValue(name, lang, value, form) {
    this.#requireKey(name);
    if (!LANG_PATTERN.test(lang)) throw new ValidationError(`Ungültiger Sprachcode: ${lang}`);
    if (typeof value !== "string") throw new ValidationError("Der Text muss eine Zeichenkette sein.");
    const values = this.project.keys[name];
    if (isPluralKey(values)) {
      if (!CATEGORIES.includes(form)) throw new ValidationError(`„${name}“ ist ein Plural – gib die Form an (${CATEGORIES.join(", ")}).`);
      const forms = isPluralValue(values[lang]) ? values[lang] : (values[lang] = {});
      if (value === "") delete forms[form];
      else forms[form] = value;
    } else {
      if (form) throw new ValidationError(`„${name}“ ist kein Plural.`);
      if (value === "") delete values[lang];
      else values[lang] = value;
    }
    this.save();
  }

  /** Macht aus einem Text einen Plural (Text wird zur Form „other“) oder umgekehrt (Form „other“ bleibt). */
  setPlural(name, plural) {
    this.#requireKey(name);
    const values = this.project.keys[name];
    if (isPluralKey(values) === !!plural) return;
    for (const code of Object.keys(values)) {
      if (plural) values[code] = values[code] ? { other: values[code] } : {};
      else if (values[code].other) values[code] = values[code].other;
      else delete values[code];
    }
    if (plural && !values[this.project.base]) values[this.project.base] = {};
    this.save();
  }

  /** Beschränkt einen Key auf eine Plattform ("ios", "android") oder gibt ihn mit "" für beide frei. */
  setOnly(name, only) {
    this.#requireKey(name);
    this.#checkOnly(only);
    this.project.only = { ...this.project.only };
    if (only) this.project.only[name] = only;
    else delete this.project.only[name];
    this.save();
  }

  deleteKey(name) {
    this.#requireKey(name);
    delete this.project.keys[name];
    if (this.project.only) delete this.project.only[name];
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

  #checkKeyName(name) {
    if (!KEY_PATTERN.test(name) || name === RESERVED) {
      throw new ValidationError("Keys dürfen nur Buchstaben, Ziffern, Punkt, Unterstrich und Bindestrich enthalten.");
    }
  }

  #checkOnly(only) {
    if (only !== "" && !ONLY_PLATFORMS.includes(only)) {
      throw new ValidationError(`Unbekannte Plattform: ${only}. Erlaubt: ${ONLY_PLATFORMS.join(", ")} oder leer für beide.`);
    }
  }

  #requireKey(name) {
    if (!Object.hasOwn(this.project.keys, name)) throw new ValidationError(`Den Key „${name}“ gibt es nicht.`);
  }

  #cleanValues(values) {
    const out = {};
    for (const [code, v] of Object.entries(values || {})) {
      if (!LANG_PATTERN.test(code)) continue;
      if (typeof v === "string" && v !== "") out[code] = v;
      else if (isPluralValue(v)) out[code] = normalizeForms(v);
    }
    return out;
  }
}
