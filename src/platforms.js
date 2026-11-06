// Plattformen und Namen. Läuft in Node und im Browser.
//
// Texte, die nur eine App braucht, stehen in localize.json unter "only":
//   "only": { "settings.face_id": "ios", "widget.title": "android" }
// Sie fehlen dann im Export der anderen Plattform. Neutral (raw) enthält immer alle Keys.

export const ONLY_PLATFORMS = ["ios", "android"];

/** Plattform, auf die ein Key beschränkt ist, oder "" für beide. */
export const onlyOf = (project, key) => project.only?.[key] || "";

/** Gehört der Key in den Export für `platform` (ios, android, raw)? */
export function exportsTo(project, key, platform) {
  const only = onlyOf(project, key);
  return !only || platform === "raw" || only === platform;
}

/** `login.title` → `login_title`. Android erlaubt nur Java-Bezeichner als Namen. */
export function resourceName(key) {
  return key.replace(/[.\-]/g, "_");
}

/** `pt_BR` → `pt-BR.lproj`. */
export function lprojName(code) {
  return code.replace(/_/g, "-") + ".lproj";
}

/** Text zwischen den Anführungszeichen einer .strings-Datei. */
export function escapeStrings(text) {
  return text.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t");
}

/** Inhalt von <string> in einer Android-Ressource. */
export function escapeXml(text) {
  let out = text
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/'/g, "\\'")
    .replace(/\n/g, "\\n").replace(/\t/g, "\\t");
  if (/^[@?]/.test(out)) out = "\\" + out;
  // Android kürzt Leerzeichen am Rand und fasst mehrere zusammen – in Anführungszeichen bleiben sie erhalten.
  if (/^\s|\s$|\s\s/.test(text)) out = `"${out}"`;
  return out;
}
