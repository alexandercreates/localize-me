// Neutrale Platzhalter und ihre Umwandlung für iOS und Android.
// Läuft in Node und im Browser (keine Imports).
//
//   #name          Text           iOS %@     Android %s
//   #anzahl:int    ganze Zahl     iOS %lld   Android %d
//   #preis:float   Kommazahl      iOS %f     Android %f
//   ##             echtes "#"
//
// Reihenfolge und Typ legt der Basistext fest. Bei mehr als einem Platzhalter wird
// positionsbezogen exportiert (%1$@ / %1$s), damit Übersetzungen umstellen dürfen.

export const PLATFORMS = ["ios", "android", "raw"];

const FORMATS = {
  ios: { text: "@", int: "lld", float: "f" },
  android: { text: "s", int: "d", float: "f" },
};

const TOKEN = /##|#([A-Za-z_][A-Za-z0-9_]*)(?::(int|float|text))?/g;
const TOKEN_OR_PERCENT = /##|#([A-Za-z_][A-Za-z0-9_]*)(?::(int|float|text))?|%/g;

/** Alle Platzhalter eines Textes in Reihenfolge, `type` ist null ohne explizite Angabe. */
export function parse(text) {
  const out = [];
  String(text ?? "").replace(TOKEN, (m, name, type) => {
    if (m !== "##") out.push({ name, type: type || null });
    return m;
  });
  return out;
}

/**
 * Eindeutige Platzhalter in Reihenfolge des ersten Auftretens.
 * Typ = erste explizite Angabe, sonst "text". `conflict` nennt einen Namen mit zwei Typen.
 */
export function specOf(text) {
  const spec = [];
  let conflict = "";
  for (const p of parse(text)) {
    const s = spec.find((x) => x.name === p.name);
    if (!s) spec.push({ name: p.name, type: p.type || "text", explicit: !!p.type });
    else if (p.type) {
      if (!s.explicit) { s.type = p.type; s.explicit = true; }
      else if (s.type !== p.type) conflict = p.name;
    }
  }
  return { list: spec, conflict };
}

/** Wandelt einen Text für eine Plattform um. `baseText` liefert Reihenfolge und Typen. */
export function convert(text, platform, baseText = text) {
  text = String(text ?? "");
  if (platform === "raw" || !text) return text;
  const formats = FORMATS[platform];
  if (!formats) throw new Error(`Unbekannte Plattform: ${platform}`);

  const spec = specOf(baseText).list;
  const formatted = parse(text).length > 0;
  const positional = spec.length > 1;

  return text.replace(TOKEN_OR_PERCENT, (m, name, type) => {
    if (m === "##") return "#";
    if (m === "%") return formatted ? "%%" : "%";
    let idx = spec.findIndex((p) => p.name === name);
    const t = idx >= 0 ? spec[idx].type : type || "text";
    if (idx < 0) idx = spec.length;
    return "%" + (positional ? `${idx + 1}$` : "") + formats[t];
  });
}

/** Prüft eine Übersetzung gegen den Basistext. Liefert eine Liste lesbarer Probleme. */
export function check(baseText, text) {
  const problems = [];
  const base = specOf(baseText);
  if (base.conflict) problems.push(`#${base.conflict} hat im Basistext zwei verschiedene Typen`);
  if (!String(text ?? "").trim()) return problems;

  const target = specOf(text).list;
  const has = (list, n) => list.some((p) => p.name === n);
  const missing = base.list.filter((p) => !has(target, p.name)).map((p) => "#" + p.name);
  const extra = target.filter((p) => !has(base.list, p.name)).map((p) => "#" + p.name);
  const typed = target
    .filter((q) => {
      const p = base.list.find((x) => x.name === q.name);
      return p && q.explicit && p.type !== q.type;
    })
    .map((q) => "#" + q.name);

  if (missing.length) problems.push("Fehlt: " + missing.join(", "));
  if (extra.length) problems.push("Nicht im Basistext: " + extra.join(", "));
  if (typed.length) problems.push("Anderer Typ als im Basistext: " + typed.join(", "));
  return problems;
}
