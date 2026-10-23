import fs from "node:fs";
import path from "node:path";

const COMMAND = "localize-me";

/**
 * Trägt ein Start-Skript in die package.json in `dir` ein.
 * Setzt "dev", wenn es das noch nicht gibt, sonst "localize". Überschreibt nie etwas.
 * @returns {{added: boolean, script?: string, reason?: string}}
 */
export function addScripts(dir, { create = false } = {}) {
  const file = path.join(dir, "package.json");
  if (!fs.existsSync(file)) {
    if (!create) return { added: false, reason: "no-package-json" };
    // Leerer Ordner: npm legt die package.json erst nach dem postinstall an und übernimmt dann unsere.
    const name = path.basename(dir).toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[._-]+/, "") || "app";
    fs.writeFileSync(file, JSON.stringify({ name, private: true, scripts: { dev: COMMAND } }, null, 2) + "\n");
    return { added: true, script: "dev", created: true };
  }

  const raw = fs.readFileSync(file, "utf8");
  const pkg = JSON.parse(raw);
  if (pkg.name === "localize-me" || pkg.name === "@alexandercreates/localize-me") return { added: false, reason: "self" };

  const scripts = pkg.scripts || {};
  const existing = Object.entries(scripts).find(([, cmd]) => typeof cmd === "string" && /(^|\s)localize-me(\s|$)/.test(cmd));
  if (existing) return { added: false, script: existing[0], reason: "exists" };

  const name = scripts.dev ? "localize" : "dev";
  if (scripts[name]) return { added: false, reason: "taken" };

  pkg.scripts = { ...scripts, [name]: COMMAND };

  const indent = (raw.match(/^[ \t]+(?=")/m) || ["  "])[0];
  const eol = raw.includes("\r\n") ? "\r\n" : "\n";
  let out = JSON.stringify(pkg, null, indent);
  if (eol !== "\n") out = out.replace(/\n/g, eol);
  if (/\r?\n$/.test(raw)) out += eol;
  fs.writeFileSync(file, out);
  return { added: true, script: name };
}
