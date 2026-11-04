// Tracking-Namen: Screens, Events und Parameter als einfache String-Dateien. Läuft in Node und im Browser.
//
// In localize.json:
//   "tracking": {
//     "screens": { "home": { "description": "Startseite" } },
//     "events": { "purchase_completed": {} },
//     "parameters": { "item_id": {} }
//   }
//
// Der Name ist der Wert, der beim Analytics-Dienst ankommt.
//   iOS      Tracking.strings      "screen.home" = "home";
//   Android  values/tracking.xml   <string name="screen_home" translatable="false">home</string>

import { exportsTo, resourceName } from "./platforms.js";

export const TRACKING_SECTIONS = ["screens", "events", "parameters"];
// Nur Zeichen, die in beiden Formaten nichts bedeuten, und immer ein Buchstabe am Anfang.
export const TRACKING_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_.\- ]*$/;
export const TRACKING_FILENAMES = { ios: "Tracking.strings", android: "values/tracking.xml" };

const HEADER = "Erzeugt von localize-me aus localize.json – nicht von Hand bearbeiten.";
const LABELS = { screens: "Screen", events: "Event", parameters: "Parameter" };
const PREFIX = { screens: "screen", events: "event", parameters: "parameter" };

/** Name in R.string: `item_id` → `parameter_item_id`, `Order Completed` → `event_Order_Completed`. */
export const trackingResourceName = (section, name) => resourceName(`${PREFIX[section]}.${name}`).replace(/ /g, "_");

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
    for (const name of Object.keys(items).sort((a, b) => a.localeCompare(b))) {
      if (name === "__proto__") continue;
      const description = typeof items[name]?.description === "string" ? items[name].description.trim() : "";
      out[section][name] = description ? { description } : {};
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
    for (const name of Object.keys(tracking[section])) {
      if (!TRACKING_NAME_PATTERN.test(name)) {
        problems.push(`${LABELS[section]} „${name}“: Namen beginnen mit einem Buchstaben und enthalten nur Buchstaben, Ziffern, Leerzeichen, Punkt, Unterstrich und Bindestrich.`);
        continue;
      }
      const id = trackingResourceName(section, name);
      if (seen.has(id)) problems.push(`${LABELS[section]} „${seen.get(id)}“ und „${name}“ ergeben beide den Android-Namen ${id}.`);
      else seen.set(id, name);
      if (keys.has(id)) problems.push(`${LABELS[section]} „${name}“ und der Key „${keys.get(id)}“ ergeben beide den Android-Namen ${id}.`);
    }
  }
  return problems;
}

// Beschreibungen sind frei getippt und landen in der Datei: immer eine Zeile, und sie dürfen keinen Kommentar beenden.
const commentText = (text) => text
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, "")
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
    for (const [name, item] of items) {
      if (item.description) lines.push(`/* ${commentText(item.description).replace(/\*\//g, "* /").replace(/\/\*/g, "/ *")} */`);
      lines.push(`"${PREFIX[section]}.${name}" = "${name}";`);
    }
  }
  return lines.join("\n") + "\n";
}

/** Android: wie strings.xml, aber translatable="false", weil Tracking-Namen nicht übersetzt werden. */
export function buildTrackingXml(project) {
  const tracking = trackingOf(project);
  const lines = ['<?xml version="1.0" encoding="utf-8"?>', `<!-- ${HEADER} -->`, "<resources>"];
  let first = true;
  for (const section of TRACKING_SECTIONS) {
    const items = sorted(tracking[section]);
    if (!items.length) continue;
    if (!first) lines.push("");
    first = false;
    for (const [name, item] of items) {
      // In XML-Kommentaren ist „--“ verboten, auch direkt vor dem Ende.
      if (item.description) lines.push(`    <!-- ${commentText(item.description).replace(/-(?=-)/g, "- ")} -->`);
      // Android fasst mehrere Leerzeichen zusammen, in Anführungszeichen bleiben sie erhalten.
      const value = /\s\s/.test(name) ? `"${name}"` : name;
      lines.push(`    <string name="${trackingResourceName(section, name)}" translatable="false">${value}</string>`);
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
