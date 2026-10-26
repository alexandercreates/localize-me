import fs from "node:fs";
import path from "node:path";
import { convert, parse, specOf } from "./placeholders.js";
import { categoriesFor, countOf, isPluralKey, isPluralValue } from "./plurals.js";
import { LANG_PATTERN } from "./store.js";

// Native Ressourcen-Dateien direkt fürs App-Projekt:
//
//   iOS      <ziel>/<sprache>.lproj/Localizable.strings
//            <ziel>/<sprache>.lproj/Localizable.stringsdict   (nur wenn es Plurals gibt)
//   Android  <ziel>/values[-<sprache>]/strings.xml   (Basissprache in values/, Plurals als <plurals>)
//
// Fehlende Übersetzungen fehlen auch in der Datei, damit die Plattform auf die Basissprache zurückfällt.

export const NATIVE_PLATFORMS = ["ios", "android"];

const HEADER = "Erzeugt von localize-me aus localize.json – nicht von Hand bearbeiten.";

/** Basissprache zuerst, dann die übrigen in Listenreihenfolge. */
function languageOrder(project) {
  return [project.base, ...project.languages.map((l) => l.code).filter((c) => c !== project.base)];
}

function sortedKeys(project) {
  return Object.keys(project.keys).sort((a, b) => a.localeCompare(b));
}

const pluralKeys = (project) => sortedKeys(project).filter((k) => isPluralKey(project.keys[k]));

/**
 * Pluralformen eines Keys für eine Sprache, fertig umgewandelt, oder null, wenn die Sprache ausgelassen wird.
 * Ohne Form „other“ fällt die Plattform auf die Basissprache zurück; ein Basistext ohne other wird ganz ausgelassen.
 */
function pluralEntry(project, key, lang, platform) {
  const values = project.keys[key];
  const baseOther = values[project.base]?.other || "";
  const forms = isPluralValue(values[lang]) ? values[lang] : {};
  if (!baseOther.trim() || !forms.other) return null;
  const count = countOf(values[project.base]);
  if (!count) throw new Error(`„${key}“ ist ein Plural ohne Zahl – schreib in die Form „andere“ einen Platzhalter wie #count:int.`);
  const spec = specOf(baseOther).list;
  // In Plurals wird jede Form formatiert – ein % ohne Platzhalter muss also auch %% werden.
  const items = categoriesFor(lang)
    .filter((c) => forms[c])
    .map((c) => {
      const text = convert(forms[c], platform, baseOther);
      return [c, parse(forms[c]).length ? text : text.replace(/%/g, "%%")];
    });
  return { items, count, index: spec.findIndex((p) => p.name === count) + 1, positional: spec.length > 1 };
}

// ---------- iOS ----------

export function lprojName(code) {
  return code.replace(/_/g, "-") + ".lproj";
}

function escapeStrings(text) {
  return text.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t");
}

export function buildIosStrings(project, lang) {
  const lines = [`/* ${HEADER} */`, ""];
  for (const key of sortedKeys(project)) {
    const values = project.keys[key];
    if (isPluralKey(values)) continue;
    const text = values[lang];
    if (!text && lang !== project.base) continue;
    lines.push(`"${escapeStrings(key)}" = "${escapeStrings(convert(text || "", "ios", values[project.base] || ""))}";`);
  }
  return lines.join("\n") + "\n";
}

const escapePlist = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Plurals als Localizable.stringsdict. Im Code wie gewohnt: String(format: NSLocalizedString(key), count, …). */
export function buildIosStringsdict(project, lang) {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    `<!-- ${HEADER} -->`,
    '<plist version="1.0">',
    "<dict>",
  ];
  for (const key of pluralKeys(project)) {
    const entry = pluralEntry(project, key, lang, "ios");
    if (!entry) continue;
    lines.push(
      `\t<key>${escapePlist(key)}</key>`,
      "\t<dict>",
      "\t\t<key>NSStringLocalizedFormatKey</key>",
      `\t\t<string>%${entry.positional ? entry.index + "$" : ""}#@${entry.count}@</string>`,
      `\t\t<key>${entry.count}</key>`,
      "\t\t<dict>",
      "\t\t\t<key>NSStringFormatSpecTypeKey</key>",
      "\t\t\t<string>NSStringPluralRuleType</string>",
      "\t\t\t<key>NSStringFormatValueTypeKey</key>",
      "\t\t\t<string>lld</string>",
      ...entry.items.flatMap(([c, text]) => [`\t\t\t<key>${c}</key>`, `\t\t\t<string>${escapePlist(text)}</string>`]),
      "\t\t</dict>",
      "\t</dict>",
    );
  }
  lines.push("</dict>", "</plist>");
  return lines.join("\n") + "\n";
}

// ---------- Android ----------

/** `login.title` → `login_title`. Android erlaubt nur Java-Bezeichner als Namen. */
export function resourceName(key) {
  return key.replace(/[.\-]/g, "_");
}

/** `de` → `values`, `en` → `values-en`, `pt-BR` → `values-pt-rBR`, `zh-Hans` → `values-b+zh+Hans`. */
export function valuesDir(code, base) {
  if (code === base) return "values";
  const [lang, region] = code.split(/[-_]/);
  if (!region) return `values-${lang}`;
  if (/^([A-Za-z]{2}|\d{3})$/.test(region)) return `values-${lang}-r${region.toUpperCase()}`;
  return `values-b+${lang}+${region}`;
}

function escapeXml(text) {
  let out = text
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/'/g, "\\'")
    .replace(/\n/g, "\\n").replace(/\t/g, "\\t");
  if (/^[@?]/.test(out)) out = "\\" + out;
  // Android kürzt Leerzeichen am Rand und fasst mehrere zusammen – in Anführungszeichen bleiben sie erhalten.
  if (/^\s|\s$|\s\s/.test(text)) out = `"${out}"`;
  return out;
}

/** Prüft, dass jeder Key einen gültigen, eindeutigen Ressourcennamen ergibt. */
export function checkAndroidNames(project) {
  const seen = new Map();
  const problems = [];
  for (const key of sortedKeys(project)) {
    const name = resourceName(key);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) problems.push(`„${key}“ ergibt keinen gültigen Android-Namen (darf nicht mit einer Ziffer beginnen).`);
    else if (seen.has(name)) problems.push(`„${seen.get(name)}“ und „${key}“ ergeben beide ${name}.`);
    else seen.set(name, key);
  }
  return problems;
}

export function buildAndroidXml(project, lang) {
  const lines = ['<?xml version="1.0" encoding="utf-8"?>', `<!-- ${HEADER} -->`, "<resources>"];
  for (const key of sortedKeys(project)) {
    const values = project.keys[key];
    if (isPluralKey(values)) {
      const entry = pluralEntry(project, key, lang, "android");
      if (!entry) continue;
      lines.push(`    <plurals name="${resourceName(key)}">`);
      for (const [c, text] of entry.items) lines.push(`        <item quantity="${c}">${escapeXml(text)}</item>`);
      lines.push("    </plurals>");
      continue;
    }
    const text = values[lang];
    if (!text && lang !== project.base) continue;
    const baseText = values[project.base] || "";
    const converted = convert(text || "", "android", baseText);
    // Ein % ohne Platzhalter ist kein Format – sonst meckert aapt.
    const unformatted = converted.includes("%") && specOf(baseText).list.length === 0;
    lines.push(`    <string name="${resourceName(key)}"${unformatted ? ' formatted="false"' : ""}>${escapeXml(converted)}</string>`);
  }
  lines.push("</resources>");
  return lines.join("\n") + "\n";
}

// ---------- Schreiben ----------

/** Dateien einer Plattform als [{ path (relativ zum Ziel), content }]. */
export function nativeFiles(project, platform) {
  // Sprachcodes werden zu Ordnernamen – aus einer von Hand bearbeiteten localize.json dürfen sie nicht aus dem Ziel herausführen.
  const invalid = project.languages.map((l) => l.code).filter((c) => !LANG_PATTERN.test(c));
  if (invalid.length) throw new Error(`Ungültige Sprachcodes in localize.json: ${invalid.join(", ")} (erlaubt z. B. en, pt-BR, zh-Hans).`);
  if (platform === "ios") {
    const plurals = pluralKeys(project).length > 0;
    return languageOrder(project).flatMap((code) => [
      { path: path.join(lprojName(code), "Localizable.strings"), content: buildIosStrings(project, code) },
      ...(plurals ? [{ path: path.join(lprojName(code), "Localizable.stringsdict"), content: buildIosStringsdict(project, code) }] : []),
    ]);
  }
  if (platform === "android") {
    const problems = checkAndroidNames(project);
    if (problems.length) throw new Error(problems.join("\n"));
    return languageOrder(project).map((code) => ({ path: path.join(valuesDir(code, project.base), "strings.xml"), content: buildAndroidXml(project, code) }));
  }
  throw new Error(`Unbekannte Plattform: ${platform}. Erlaubt: ${NATIVE_PLATFORMS.join(", ")}`);
}

/**
 * Schreibt die Dateien nach `dir`. Unveränderte Dateien bleiben unangetastet, damit Xcode und Gradle nicht unnötig neu bauen.
 * @returns {{file: string, changed: boolean}[]}
 */
export function writeNative(project, platform, dir) {
  return nativeFiles(project, platform).map(({ path: rel, content }) => {
    const file = path.join(dir, rel);
    let current = null;
    try { current = fs.readFileSync(file, "utf8"); } catch {}
    if (current === content) return { file, changed: false };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    return { file, changed: true };
  });
}

/** Zielordner aus `output` in localize.json, relativ zur Datei aufgelöst. */
export function configuredOutputs(project, file) {
  const base = path.dirname(path.resolve(file));
  return NATIVE_PLATFORMS
    .filter((p) => typeof project.output?.[p] === "string" && project.output[p].trim())
    .map((platform) => ({ platform, dir: path.resolve(base, project.output[platform]) }));
}
