// Tracking: Screens, Events und Parameter als einfache String-Dateien. Läuft in Node und im Browser.
//
// In localize.json:
//   "tracking": {
//     "screens": { "startseite": { "value": "app/startseite", "description": "Nach dem Login" } },
//     "events": { "kauf": { "value": "Order Completed" } },
//     "parameters": { "item_id": { "value": "item_id" } }
//   }
//
// Der Key benennt den Eintrag, der Bereich kommt als Präfix davor. Der Value ist Pflicht, ein beliebiger Text und
// kommt genau so beim Analytics-Dienst an.
//   iOS      Tracking.strings      "screen.startseite" = "app/startseite";
//   Android  values/tracking.xml   <string name="screen_startseite" translatable="false">app/startseite</string>

import { escapeStrings, escapeXml, exportsTo, resourceName } from "./platforms.js";

export const TRACKING_SECTIONS = ["screens", "events", "parameters"];
export const TRACKING_PREFIX = { screens: "screen", events: "event", parameters: "parameter" };
export const TRACKING_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_.\-]*$/;
export const TRACKING_KEY_RULE = "Keys beginnen mit einem Buchstaben und enthalten nur Buchstaben, Ziffern, Punkt, Unterstrich und Bindestrich.";
export const TRACKING_FILENAMES = { ios: "Tracking.strings", android: "values/tracking.xml" };

const HEADER = "Erzeugt von localize-me aus localize.json – nicht von Hand bearbeiten.";
const LABELS = { screens: "Screen", events: "Event", parameters: "Parameter" };
// Solche Zeichen kann XML nicht darstellen, auch nicht escaped.
const XML_INVALID = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/;

/** Pflicht und mehr als nur Leerzeichen, sonst ist jeder Text erlaubt. */
export const isTrackingValue = (value) => typeof value === "string" && value.trim() !== "";

/** Key in Tracking.strings: `startseite` → `screen.startseite`. */
export const trackingStringsKey = (section, key) => `${TRACKING_PREFIX[section]}.${key}`;

/** Name in R.string: `startseite` → `screen_startseite`. */
export const trackingResourceName = (section, key) => resourceName(trackingStringsKey(section, key));

/** Wer das Präfix mittippt, soll es nicht doppelt bekommen: `screen.startseite` → `startseite`. */
export const withoutTrackingPrefix = (section, key) => key.replace(new RegExp(`^${TRACKING_PREFIX[section]}[._]`), "");

export const trackingOf = (project) => ({
  screens: project.tracking?.screens ?? {},
  events: project.tracking?.events ?? {},
  parameters: project.tracking?.parameters ?? {},
});

/** Macht aus der Datei eine feste Form. Liefert undefined, solange es nichts gibt, damit reine Text-Projekte unverändert bleiben. */
export function normalizeTracking(data) {
  const out = { screens: {}, events: {}, parameters: {} };
  for (const section of TRACKING_SECTIONS) {
    const items = data?.[section];
    if (!items || typeof items !== "object") continue;
    for (const key of Object.keys(items).sort((a, b) => a.localeCompare(b))) {
      if (key === "__proto__") continue;
      const { value, description } = items[key] ?? {};
      const text = typeof description === "string" ? description.trim() : "";
      // Der Value bleibt Zeichen für Zeichen erhalten, auch mit Leerzeichen am Rand. Fehlt er, meldet das checkTracking.
      out[section][key] = { ...(value !== undefined && { value }), ...(text && { description: text }) };
    }
  }
  return TRACKING_SECTIONS.some((s) => Object.keys(out[s]).length) ? out : undefined;
}

/** Alles, was die erzeugten Dateien kaputt machen würde. Für android zählen auch Kollisionen mit strings.xml, beide landen in R.string. */
export function checkTracking(project, platform) {
  const tracking = trackingOf(project);
  const problems = [];
  const keys = new Map(platform === "android"
    ? Object.keys(project.keys ?? {}).filter((k) => exportsTo(project, k, "android")).map((k) => [resourceName(k), k])
    : []);
  for (const section of TRACKING_SECTIONS) {
    const seen = new Map();
    for (const [key, item] of Object.entries(tracking[section])) {
      if (!TRACKING_KEY_PATTERN.test(key)) {
        problems.push(`${LABELS[section]} „${key}“: ${TRACKING_KEY_RULE}`);
        continue;
      }
      const id = trackingResourceName(section, key);
      if (seen.has(id)) problems.push(`${LABELS[section]} „${seen.get(id)}“ und „${key}“ ergeben beide den Android-Namen ${id}.`);
      else seen.set(id, key);
      if (keys.has(id)) problems.push(`${LABELS[section]} „${key}“ und der Text-Key „${keys.get(id)}“ ergeben beide den Android-Namen ${id}.`);
      if (!isTrackingValue(item.value)) {
        problems.push(`${LABELS[section]} „${key}“: Der Value fehlt.`);
        continue;
      }
      if (platform === "android" && XML_INVALID.test(item.value)) problems.push(`${LABELS[section]} „${key}“: Der Value enthält Steuerzeichen, die Android-Ressourcen nicht erlauben.`);
    }
  }
  return problems;
}

// Beschreibungen sind frei getippt und landen in der Datei: immer eine Zeile, und sie dürfen keinen Kommentar beenden.
const commentText = (text) => text
  .replace(new RegExp(XML_INVALID.source, "g"), "")
  .replace(/\s+/g, " ")
  .trim();

const sorted = (items) => Object.entries(items).sort(([a], [b]) => a.localeCompare(b));

/** iOS: ein Eintrag pro Name, Abschnitte über das Präfix im Key getrennt. */
export function buildTrackingStrings(project) {
  const tracking = trackingOf(project);
  const lines = [`/* ${HEADER} */`];
  for (const section of TRACKING_SECTIONS) {
    const items = sorted(tracking[section]);
    if (!items.length) continue;
    lines.push("");
    for (const [key, item] of items) {
      if (item.description) lines.push(`/* ${commentText(item.description).replace(/\*\//g, "* /").replace(/\/\*/g, "/ *")} */`);
      lines.push(`"${trackingStringsKey(section, key)}" = "${escapeStrings(item.value)}";`);
    }
  }
  return lines.join("\n") + "\n";
}

/** Android: wie strings.xml, aber translatable="false", weil Tracking-Werte nicht übersetzt werden. */
export function buildTrackingXml(project) {
  const tracking = trackingOf(project);
  const lines = ['<?xml version="1.0" encoding="utf-8"?>', `<!-- ${HEADER} -->`, "<resources>"];
  let first = true;
  for (const section of TRACKING_SECTIONS) {
    const items = sorted(tracking[section]);
    if (!items.length) continue;
    if (!first) lines.push("");
    first = false;
    for (const [key, item] of items) {
      // In XML-Kommentaren ist „--“ verboten, auch direkt vor dem Ende.
      if (item.description) lines.push(`    <!-- ${commentText(item.description).replace(/-(?=-)/g, "- ")} -->`);
      // Ein % ist hier nie ein Platzhalter – sonst meckert aapt.
      const unformatted = item.value.includes("%") ? ' formatted="false"' : "";
      lines.push(`    <string name="${trackingResourceName(section, key)}" translatable="false"${unformatted}>${escapeXml(item.value)}</string>`);
    }
  }
  lines.push("</resources>");
  return lines.join("\n") + "\n";
}

/** Dateien einer Plattform als [{ path (relativ zum Ziel), content }]. */
export function trackingFiles(project, platform) {
  const problems = checkTracking(project, platform);
  if (problems.length) throw new Error(problems.join("\n"));
  if (platform === "ios") return [{ path: TRACKING_FILENAMES.ios, content: buildTrackingStrings(project) }];
  if (platform === "android") return [{ path: TRACKING_FILENAMES.android, content: buildTrackingXml(project) }];
  throw new Error(`Unbekannte Plattform: ${platform}. Erlaubt: ios, android`);
}
