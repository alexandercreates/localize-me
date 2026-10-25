import fs from "node:fs";
import path from "node:path";
import { convert, specOf } from "./placeholders.js";

// Native Ressourcen-Dateien direkt fürs App-Projekt:
//
//   iOS      <ziel>/<sprache>.lproj/Localizable.strings
//   Android  <ziel>/values[-<sprache>]/strings.xml   (Basissprache in values/)
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
    const text = values[lang];
    if (!text && lang !== project.base) continue;
    lines.push(`"${escapeStrings(key)}" = "${escapeStrings(convert(text || "", "ios", values[project.base] || ""))}";`);
  }
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
  if (platform === "ios") {
    return languageOrder(project).map((code) => ({ path: path.join(lprojName(code), "Localizable.strings"), content: buildIosStrings(project, code) }));
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
