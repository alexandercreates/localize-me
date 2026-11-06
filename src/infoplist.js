// InfoPlist.strings: übersetzte Werte aus der Info.plist, vor allem die Texte der Berechtigungsabfragen. Läuft in Node und im Browser.
//
// In localize.json:
//   "infoPlist": {
//     "NSCameraUsageDescription": { "de": "Zum Scannen von Belegen.", "en": "To scan receipts." }
//   }
//
// Nur befüllte Keys landen in der Datei, eine pro Sprache neben Localizable.strings:
//   iOS  <ziel>/<sprache>.lproj/InfoPlist.strings   "NSCameraUsageDescription" = "Zum Scannen von Belegen.";
//
// Der Key muss zusätzlich in der Info.plist des Targets stehen – InfoPlist.strings übersetzt nur, es legt nichts an.
// Fehlt eine Übersetzung, zeigt iOS den Wert aus der Info.plist.

import { escapeStrings } from "./platforms.js";

export const INFO_PLIST_FILENAME = "InfoPlist.strings";
export const INFO_PLIST_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_.\-]*$/;
export const INFO_PLIST_KEY_RULE = "Info.plist-Keys beginnen mit einem Buchstaben und enthalten nur Buchstaben, Ziffern, Punkt, Unterstrich und Bindestrich.";

const HEADER = "Erzeugt von localize-me aus localize.json – nicht von Hand bearbeiten.";

// Bekannte Keys, deren Wert ein Text ist und sich übersetzen lässt. `legacy`: von Apple durch einen neueren Key ersetzt,
// für ältere iOS-Versionen aber noch nötig.
export const INFO_PLIST_GROUPS = [
  {
    id: "app",
    label: "App-Name",
    keys: [
      { key: "CFBundleDisplayName", title: "Name unter dem App-Icon", hint: "Höchstens etwa 12 Zeichen, sonst kürzt iOS ihn." },
      { key: "CFBundleName", title: "Kurzname der App", hint: "Wird genutzt, wenn kein Anzeigename gesetzt ist." },
      { key: "CFBundleSpokenName", title: "Gesprochener Name", hint: "So spricht VoiceOver und Siri den App-Namen aus." },
    ],
  },
  {
    id: "privacy",
    label: "Berechtigungen",
    keys: [
      { key: "NSCameraUsageDescription", title: "Kamera" },
      { key: "NSMicrophoneUsageDescription", title: "Mikrofon" },
      { key: "NSPhotoLibraryUsageDescription", title: "Fotos lesen", hint: "Für den vollen oder eingeschränkten Zugriff auf die Mediathek." },
      { key: "NSPhotoLibraryAddUsageDescription", title: "Fotos sichern", hint: "Nur hinzufügen, ohne die Mediathek zu lesen." },
      { key: "NSLocationWhenInUseUsageDescription", title: "Standort beim Verwenden" },
      { key: "NSLocationAlwaysAndWhenInUseUsageDescription", title: "Standort immer", hint: "Zusätzlich zu „beim Verwenden“ nötig." },
      { key: "NSLocationAlwaysUsageDescription", title: "Standort immer (vor iOS 11)", legacy: true },
      { key: "NSContactsUsageDescription", title: "Kontakte" },
      { key: "NSCalendarsFullAccessUsageDescription", title: "Kalender, voller Zugriff", hint: "Ab iOS 17." },
      { key: "NSCalendarsWriteOnlyAccessUsageDescription", title: "Kalender, nur hinzufügen", hint: "Ab iOS 17." },
      { key: "NSCalendarsUsageDescription", title: "Kalender (vor iOS 17)", legacy: true },
      { key: "NSRemindersFullAccessUsageDescription", title: "Erinnerungen", hint: "Ab iOS 17." },
      { key: "NSRemindersUsageDescription", title: "Erinnerungen (vor iOS 17)", legacy: true },
      { key: "NSFaceIDUsageDescription", title: "Face ID" },
      { key: "NSBluetoothAlwaysUsageDescription", title: "Bluetooth" },
      { key: "NSBluetoothPeripheralUsageDescription", title: "Bluetooth (vor iOS 13)", legacy: true },
      { key: "NSLocalNetworkUsageDescription", title: "Lokales Netzwerk" },
      { key: "NSUserTrackingUsageDescription", title: "App-Tracking (ATT)", hint: "Text der Abfrage „Darf diese App dich verfolgen?“." },
      { key: "NSMotionUsageDescription", title: "Bewegung & Fitness" },
      { key: "NSHealthShareUsageDescription", title: "Health lesen" },
      { key: "NSHealthUpdateUsageDescription", title: "Health schreiben" },
      { key: "NSHealthClinicalHealthRecordsShareUsageDescription", title: "Health-Akten lesen" },
      { key: "NSSpeechRecognitionUsageDescription", title: "Spracherkennung" },
      { key: "NSSiriUsageDescription", title: "Siri" },
      { key: "NSAppleMusicUsageDescription", title: "Mediathek & Apple Music" },
      { key: "NSHomeKitUsageDescription", title: "Home" },
      { key: "NFCReaderUsageDescription", title: "NFC" },
      { key: "NSNearbyInteractionUsageDescription", title: "Interaktion in der Nähe" },
      { key: "NSFocusStatusUsageDescription", title: "Fokus-Status" },
      { key: "NSSensorKitUsageDescription", title: "SensorKit" },
      { key: "NSGKFriendListUsageDescription", title: "Game Center-Freunde" },
      { key: "NSIdentityUsageDescription", title: "Ausweis in Wallet" },
      { key: "NSFinancialDataUsageDescription", title: "Finanzdaten (FinanceKit)" },
      { key: "NSAlarmKitUsageDescription", title: "Wecker & Timer (AlarmKit)" },
      { key: "NSVideoSubscriberAccountUsageDescription", title: "TV-Anbieter" },
    ],
  },
];

export const INFO_PLIST_KNOWN = new Map(INFO_PLIST_GROUPS.flatMap((g) => g.keys.map((k) => [k.key, { ...k, group: g.id }])));

export const infoPlistOf = (project) => project.infoPlist ?? {};

/** Macht aus der Datei eine feste Form: Keys und Sprachen alphabetisch, leere Texte fallen weg. Ohne Einträge undefined. */
export function normalizeInfoPlist(data) {
  if (!data || typeof data !== "object") return undefined;
  const out = {};
  for (const key of Object.keys(data).sort((a, b) => a.localeCompare(b))) {
    if (key === "__proto__") continue;
    const values = data[key];
    if (!values || typeof values !== "object") continue;
    const clean = {};
    for (const code of Object.keys(values).sort()) {
      if (code !== "__proto__" && typeof values[code] === "string" && values[code] !== "") clean[code] = values[code];
    }
    if (Object.keys(clean).length) out[key] = clean;
  }
  return Object.keys(out).length ? out : undefined;
}

/** Alles, was die erzeugten Dateien kaputt machen würde. */
export function checkInfoPlist(project) {
  const problems = [];
  for (const [key, values] of Object.entries(infoPlistOf(project))) {
    if (!INFO_PLIST_KEY_PATTERN.test(key)) problems.push(`Info.plist „${key}“: ${INFO_PLIST_KEY_RULE}`);
    else if (!(values[project.base] ?? "").trim()) problems.push(`Info.plist „${key}“: Der Text in der Basissprache ${project.base} fehlt.`);
  }
  return problems;
}

/** InfoPlist.strings einer Sprache. Fehlende Übersetzungen fehlen, iOS nimmt dann den Wert aus der Info.plist. */
export function buildInfoPlistStrings(project, lang) {
  const lines = [`/* ${HEADER} */`, ""];
  for (const [key, values] of Object.entries(infoPlistOf(project)).sort(([a], [b]) => a.localeCompare(b))) {
    const text = values[lang];
    if (!text) continue;
    const title = INFO_PLIST_KNOWN.get(key)?.title;
    if (title) lines.push(`/* ${title} */`);
    lines.push(`"${escapeStrings(key)}" = "${escapeStrings(text)}";`);
  }
  return lines.join("\n") + "\n";
}

export const hasInfoPlist = (project) => Object.keys(infoPlistOf(project)).length > 0;
