import { convert } from "./placeholders.js";

/**
 * Baut die CSV-Datei.
 * @param {object} project  normalisiertes Projekt aus localize.json
 * @param {object} options
 * @param {"ios"|"android"|"raw"} [options.platform="raw"]
 * @param {string[]} [options.languages]  Sprachcodes in Spaltenreihenfolge; Standard: alle, Basis zuerst
 * @param {string} [options.delimiter=";"]
 * @param {boolean} [options.bom=true]  UTF-8-BOM, damit Excel Umlaute richtig zeigt
 */
export function buildCsv(project, { platform = "raw", languages, delimiter = ";", bom = true } = {}) {
  const base = project.base;
  const all = [base, ...project.languages.map((l) => l.code).filter((c) => c !== base)];
  const langs = languages && languages.length ? languages : all;
  for (const l of langs) {
    if (!project.languages.some((x) => x.code === l)) throw new Error(`Unbekannte Sprache: ${l}`);
  }

  const q = (s) => '"' + String(s ?? "").replace(/"/g, '""') + '"';
  const lines = [["key", ...langs].map(q).join(delimiter)];
  for (const name of Object.keys(project.keys).sort((a, b) => a.localeCompare(b))) {
    const values = project.keys[name];
    const baseText = values[base] || "";
    lines.push([name, ...langs.map((l) => convert(values[l] || "", platform, baseText))].map(q).join(delimiter));
  }
  return (bom ? "﻿" : "") + lines.join("\r\n") + "\r\n";
}

export function csvFilename(languages, platform) {
  return `strings_${languages.join("_")}${platform && platform !== "raw" ? "_" + platform : ""}.csv`;
}
