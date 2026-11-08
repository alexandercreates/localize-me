// Zerlegt Texte für die Anzeige in normale Teile und hervorgehobene Platzhalter.
import { NAME } from "@shared/placeholders.js";

const NEUTRAL = new RegExp(`##|#${NAME}(?::(?:int|float|text|plural))?`, "gu");
const PRINTF = /%%|%(?:\d+\$)?(?:@|lld|d|s|f)/g;

function split(text, re) {
  const out = [];
  let last = 0;
  for (const m of String(text ?? "").matchAll(re)) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    out.push({ text: m[0], token: m[0] !== "##" && m[0] !== "%%" });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

export const neutralSegments = (text) => split(text, NEUTRAL);
export const printfSegments = (text) => split(text, PRINTF);
const TOKEN_START = new RegExp(`#${NAME}|##`, "u");
export const hasTokens = (text) => TOKEN_START.test(text);
