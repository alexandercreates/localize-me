// Einzige Stelle, an der die Oberfläche den öffentlichen Pfadpräfix kennt. Der Server trägt ihn beim Ausliefern
// von index.html ein (PUBLIC_BASE_PATH), die gebauten Dateien selbst bleiben für jeden Präfix identisch.
export const basePath = document.querySelector('meta[name="localize-me-base-path"]')?.content ?? "";

/** "/api/project" → öffentliche URL dieses Pfads. */
export const publicUrl = (path) => basePath + path;

/**
 * Der Server liefert die Oberfläche nur unter / aus. Liegt die Seite im Browser woanders und der Server kennt
 * keinen Präfix, fehlt PUBLIC_BASE_PATH. Liefert den Präfix, den der Browser sieht, sonst "".
 */
export function unconfiguredPrefix() {
  if (basePath) return "";
  return location.pathname.replace(/\/index\.html$/, "").replace(/\/+$/, "");
}
