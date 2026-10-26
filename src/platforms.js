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
