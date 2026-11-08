// Plurals: ein Key, dessen Werte statt eines Textes ein Objekt mit Pluralformen sind.
// Läuft in Node und im Browser (nur Import aus placeholders.js).
//
//   "tasks.open": {
//     "de": { "one": "Eine offene Aufgabe", "other": "#count:int offene Aufgaben" },
//     "en": { "one": "One open task", "other": "#count:int open tasks" }
//   }
//
// Welche Formen eine Sprache braucht, kommt aus den CLDR-Regeln (Intl.PluralRules):
// Deutsch/Englisch one + other, Französisch one + many + other, Russisch one + few + many + other …
// Die Zahl, nach der sich die Form richtet, ist der Platzhalter mit :plural in der other-Form des
// Basistextes, sonst der erste mit :int. Andere Formen dürfen sie weglassen („Eine offene Aufgabe“).
//
//   "#count:int von #required:plural Plätzen belegt"   → Form richtet sich nach #required

import { check, NAME, specOf } from "./placeholders.js";
import { exportsTo } from "./platforms.js";

export const CATEGORIES = ["zero", "one", "two", "few", "many", "other"];

export const CATEGORY_LABELS = { zero: "null", one: "eins", two: "zwei", few: "wenige", many: "viele", other: "andere" };

/** Benötigte Pluralformen einer Sprache, in fester Reihenfolge. */
export function categoriesFor(lang) {
  let found = ["one", "other"];
  try {
    found = new Intl.PluralRules(String(lang).replace(/_/g, "-")).resolvedOptions().pluralCategories;
  } catch {}
  return CATEGORIES.filter((c) => found.includes(c));
}

export const isPluralValue = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/** Ein Key ist Plural, sobald irgendeine Sprache Formen statt eines Textes hat. */
export const isPluralKey = (values) => Object.values(values || {}).some(isPluralValue);

/** Text zum Suchen und Anzeigen: bei Plurals die other-Form. */
export function textOf(value) {
  if (isPluralValue(value)) return value.other || Object.values(value).find(Boolean) || "";
  return typeof value === "string" ? value : "";
}

/** Gilt eine Sprache als übersetzt? Bei Plurals reicht eine Form – Lücken meldet `checkPlural`. */
export function isFilled(value) {
  if (isPluralValue(value)) return Object.values(value).some((t) => String(t).trim());
  return typeof value === "string" && !!value.trim();
}

/** Name des Zähl-Platzhalters (ohne #) oder "" – :plural, sonst der erste :int in der other-Form des Basistextes. */
export function countOf(baseForms) {
  const list = specOf(baseForms?.other || "").list;
  return (list.find((p) => p.plural) || list.find((p) => p.type === "int"))?.name || "";
}

/** Zahlen-Platzhalter der other-Form, zur Auswahl, wonach sich die Form richtet. */
export const countCandidates = (baseForms) => specOf(baseForms?.other || "").list.filter((p) => p.type === "int").map((p) => p.name);

/**
 * Setzt in `text` fest, nach welcher Zahl sich die Form richtet: `#name:plural` statt `#name:int`,
 * alle anderen `:plural` werden wieder `:int`.
 */
export function withCount(text, name) {
  let done = false;
  return String(text).replace(new RegExp(`#(${NAME}):(int|plural)\\b`, "gu"), (m, n) => {
    if (n !== name || done) return `#${n}:int`;
    done = true;
    return `#${n}:plural`;
  });
}

/**
 * Prüft die Formen einer Sprache gegen die other-Form des Basistextes.
 * Mit `isBase` zusätzlich die Probleme des Basistextes selbst (fehlende other-Form, keine Zahl).
 */
export function checkPlural(baseForms, forms, lang, { isBase = false } = {}) {
  const problems = [];
  const baseOther = baseForms?.other || "";
  if (isBase) {
    if (!baseOther.trim()) return ["Die Form „andere“ fehlt im Basistext."];
    if (!countOf(baseForms)) problems.push("Für Plurals braucht die Form „andere“ einen Zahl-Platzhalter, z. B. #count:int.");
    problems.push(...check(baseOther, ""));
    forms = baseForms;
  }
  if (!isFilled(forms)) return problems;

  const required = categoriesFor(lang);
  const missing = required.filter((c) => !String(forms[c] || "").trim());
  if (missing.length) problems.push("Form fehlt: " + missing.map((c) => CATEGORY_LABELS[c]).join(", "));

  const optional = [countOf(baseForms)];
  const baseProblems = check(baseOther, "");
  for (const c of required) {
    const text = forms[c];
    if (!String(text || "").trim() || (isBase && c === "other")) continue;
    for (const p of check(baseOther, text, { optional })) {
      if (!baseProblems.includes(p)) problems.push(`${CATEGORY_LABELS[c]}: ${p}`);
    }
  }
  return problems;
}

/**
 * Platzhalter-Fehler aller Texte, die für `platform` exportiert werden, als lesbare Zeilen.
 * Nur was die Formatierung betrifft: Fehlende Texte oder Pluralformen sind kein Fehler, dafür gibt es den Rückfall auf die Basissprache.
 */
export function placeholderProblems(project, platform, languages = project.languages.map((l) => l.code)) {
  const out = [];
  for (const key of Object.keys(project.keys).filter((k) => exportsTo(project, k, platform)).sort((a, b) => a.localeCompare(b))) {
    const values = project.keys[key];
    const plural = isPluralKey(values);
    const baseText = (plural ? values[project.base]?.other : values[project.base]) || "";
    const optional = plural ? [countOf(values[project.base])] : [];
    const baseProblems = check(baseText, "");
    for (const lang of languages) {
      const forms = plural ? (isPluralValue(values[lang]) ? values[lang] : {}) : { text: values[lang] };
      // Plurals ohne Form „andere“ werden gar nicht exportiert.
      if (plural && (!baseText.trim() || !forms.other)) continue;
      for (const form of plural ? categoriesFor(lang) : ["text"]) {
        const found = check(baseText, forms[form], { optional }).filter((p) => lang === project.base || !baseProblems.includes(p));
        if (found.length) out.push(`„${key}“ (${lang}${plural ? `, ${CATEGORY_LABELS[form]}` : ""}): ${found.join("; ")}`);
      }
    }
  }
  return out;
}

/** Bricht ab, wenn Platzhalter nicht zum Basistext passen – sonst entstünden Formate, die zur Laufzeit falsch einsetzen oder abstürzen. */
export function assertPlaceholders(project, platform, languages) {
  const problems = placeholderProblems(project, platform, languages);
  if (!problems.length) return;
  const shown = problems.slice(0, 20);
  if (problems.length > shown.length) shown.push(`… und ${problems.length - shown.length} weitere`);
  throw new Error(`Export abgebrochen, Platzhalter passen nicht zum Basistext:\n${shown.join("\n")}`);
}
