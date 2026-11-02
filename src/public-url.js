// Öffentliche Adresse hinter einem Reverse Proxy, der einen Pfadpräfix vor der Weiterleitung entfernt:
// Der Browser sieht /praefix/…, dieser Server nur /…. Hier liegen Prüfung der Konfiguration, Herkunftsvergleich
// und die Umrechnung von Redirect-Zielen. Nichts davon merkt sich Zustand zwischen Anfragen.
import net from "node:net";
import { ValidationError } from "./store.js";

export class ConfigError extends Error {}

// Nur Zeichen, die in Pfad, HTML-Attribut und Location-Header ohne Escaping sicher sind.
const BASE_PATH = /^(\/[A-Za-z0-9._~-]+)+$/;
const REDIRECT_STATUS = [301, 302, 303, 307, 308];
// Platzhalter-Herkunft zum Auflösen relativer Ziele; .invalid ist per RFC 2606 nie ein echter Host.
const LOCAL = "http://localize-me.invalid";

function text(value, name) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new ConfigError(`${name} muss ein Text sein.`);
  return value.trim();
}

/** "/tools/app/" → "/tools/app", leer oder "/" → "" (Root-Betrieb). Ungültiges wirft ConfigError. */
export function normalizeBasePath(value) {
  const raw = text(value, "PUBLIC_BASE_PATH");
  const path = raw.replace(/\/+$/, "");
  if (!path) return "";
  if (!BASE_PATH.test(path) || path.split("/").some((s) => s === "." || s === "..")) {
    throw new ConfigError(
      `Ungültiger PUBLIC_BASE_PATH „${raw}“. Erwartet wird ein Pfad wie /tools/app: beginnt mit /, ` +
      "ohne Host, Query, Fragment, %-Kodierung, // oder Segmente wie “..”.",
    );
  }
  return path;
}

/** "https://Tools.Example.org:443/" → "https://tools.example.org", leer → "". Ungültiges wirft ConfigError. */
export function normalizePublicOrigin(value) {
  const raw = text(value, "PUBLIC_ORIGIN");
  if (!raw) return "";
  const invalid = (why) => new ConfigError(`Ungültiger PUBLIC_ORIGIN „${raw}“: ${why}`);
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw invalid("erwartet wird z. B. https://tools.example.org.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw invalid("nur http und https sind erlaubt.");
  if (!/^https?:\/\//i.test(raw) || url.hostname.includes("*")) throw invalid("erwartet wird ein einzelner Host ohne Platzhalter.");
  if (url.username || url.password) throw invalid("Zugangsdaten sind nicht erlaubt.");
  if (url.pathname !== "/" || /[?#]/.test(raw)) throw invalid("nur die Origin ohne Pfad, Query und Fragment – der Pfad gehört in PUBLIC_BASE_PATH.");
  return url.origin;
}

/** Proxy-Vertrauensgrenze: IP-Adressen und CIDR-Bereiche, als Liste oder kommagetrennt. */
export function parseTrustedProxies(value) {
  const entries = Array.isArray(value) ? value : text(value, "PUBLIC_TRUSTED_PROXIES").split(",");
  const list = new net.BlockList();
  const normalized = [];
  for (const entry of entries.map((e) => text(e, "PUBLIC_TRUSTED_PROXIES")).filter(Boolean)) {
    const [address, prefix, extra] = entry.split("/");
    const family = net.isIP(address);
    const max = family === 4 ? 32 : 128;
    if (!family || extra !== undefined || (prefix !== undefined && !(/^\d+$/.test(prefix) && Number(prefix) <= max))) {
      throw new ConfigError(`Ungültiger Eintrag in PUBLIC_TRUSTED_PROXIES: „${entry}“. Erwartet wird eine IP-Adresse oder ein CIDR-Bereich.`);
    }
    const type = family === 4 ? "ipv4" : "ipv6";
    if (prefix === undefined) list.addAddress(address, type);
    else list.addSubnet(address, Number(prefix), type);
    normalized.push(entry);
  }
  return { list, entries: normalized };
}

/**
 * Prüft die Einstellungen beim Start. Ohne Angaben ändert sich am Verhalten des Servers nichts.
 * Standardmäßig wirft ein ungültiger Wert ConfigError. Mit `lenient` gilt die Einstellung stattdessen als nicht
 * gesetzt und landet in `problems`. Das ist immer die sichere Seite: kein Präfix, keine zusätzliche Origin, kein
 * vertrauenswürdiger Proxy.
 */
export function resolvePublicConfig({ publicBasePath, publicOrigin, trustedProxies } = {}, { lenient = false } = {}) {
  const problems = [];
  const read = (variable, parse, value, fallback) => {
    try {
      return parse(value);
    } catch (e) {
      if (!lenient || !(e instanceof ConfigError)) throw e;
      problems.push({ variable, message: e.message });
      return fallback;
    }
  };
  const { list, entries } = read("PUBLIC_TRUSTED_PROXIES", parseTrustedProxies, trustedProxies, parseTrustedProxies(""));
  return {
    basePath: read("PUBLIC_BASE_PATH", normalizeBasePath, publicBasePath, ""),
    origin: read("PUBLIC_ORIGIN", normalizePublicOrigin, publicOrigin, ""),
    trustedProxies: entries,
    problems,
    isTrustedPeer(address) {
      if (!entries.length || !address) return false;
      const ip = address.split("%")[0];
      const family = net.isIP(ip);
      return !!family && list.check(ip, family === 4 ? "ipv4" : "ipv6");
    },
  };
}

/** Optionen für createServer() aus der Umgebung. createServer selbst liest bewusst keine Umgebungsvariablen. */
export function publicConfigFromEnv(env = process.env) {
  return {
    publicBasePath: env.PUBLIC_BASE_PATH,
    publicOrigin: env.PUBLIC_ORIGIN,
    trustedProxies: env.PUBLIC_TRUSTED_PROXIES,
  };
}

/** Herkunft aus Schema und Host-Angabe; null, wenn die Angabe mehr als Host und Port enthält. */
function originOf(protocol, host) {
  if (!host) return null;
  try {
    const url = new URL(`${protocol}://${host}`);
    return url.username || url.password || url.pathname !== "/" || url.search || url.hash ? null : url.origin;
  } catch {
    return null;
  }
}

// Der letzte Listeneintrag stammt vom Proxy direkt vor uns; weiter links könnte der Browser ihn vorgegeben haben.
const lastValue = (header) => (typeof header === "string" ? header.split(",").pop().trim() : "");

/**
 * Herkünfte, die diese Anfrage über explizite Konfiguration oder einen vertrauenswürdigen Proxy belegt.
 * X-Forwarded-* gilt nur, wenn die direkte Gegenstelle in `trustedProxies` steht. RFC-7239-`Forwarded` wird
 * nicht ausgewertet: Viele Proxys setzen nur X-Forwarded-* und reichen ein vom Browser gesendetes `Forwarded` durch.
 */
export function publicOrigins(req, config) {
  const origins = config.origin ? [config.origin] : [];
  if (config.isTrustedPeer(req.socket.remoteAddress)) {
    const forwardedProto = lastValue(req.headers["x-forwarded-proto"]).toLowerCase();
    const protocol = forwardedProto === "http" || forwardedProto === "https" ? forwardedProto : requestProtocol(req);
    const forwarded = originOf(protocol, lastValue(req.headers["x-forwarded-host"]) || req.headers.host);
    if (forwarded) origins.push(forwarded);
  }
  return origins;
}

const requestProtocol = (req) => (req.socket.encrypted ? "https" : "http");

/** Alle Herkünfte, unter denen diese Anfrage intern ist – wird je Anfrage neu aus deren Headern bestimmt. */
export function internalOrigins(req, config) {
  const backend = originOf(requestProtocol(req), req.headers.host);
  return [...(backend ? [backend] : []), ...publicOrigins(req, config)];
}

/** Stellt den Präfix genau einmal voran; "/praefix-2/x" zählt nicht als bereits präfixiert. */
export function withBasePath(pathname, basePath) {
  if (!basePath) return pathname;
  if (pathname === basePath) return `${basePath}/`;
  return pathname.startsWith(`${basePath}/`) ? pathname : basePath + pathname;
}

/**
 * Rechnet ein Redirect-Ziel in die öffentliche Sicht um. Interne Ziele werden zu einem Pfad ohne Host, der
 * Backend-Host erreicht den Browser also nie. Externe, protokollrelative externe und Nicht-HTTP-Ziele bleiben
 * Zeichen für Zeichen erhalten – das ist kein Filter gegen Open Redirects: Rücksprungziele aus Nutzereingaben
 * muss die aufrufende Route selbst prüfen.
 */
export function resolveRedirect(target, { basePath = "", requestPath = "/", internal = [] } = {}) {
  // Browser entfernen Steuerzeichen vor dem Parsen, ein Vergleich hier sähe also ein anderes Ziel als sie.
  if (typeof target !== "string" || !target || /[\u0000-\u001f\u007f]/.test(target) || target !== target.trim()) {
    throw new ValidationError("Ungültiges Redirect-Ziel.");
  }
  let url;
  try {
    url = new URL(target, LOCAL + requestPath.replace(/^\/{2,}/, "/"));
  } catch {
    throw new ValidationError("Ungültiges Redirect-Ziel.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return target;
  if (url.origin !== LOCAL) {
    // "//host/x" übernimmt das Schema der Seite, das hier nicht bekannt ist; beides passt dann als intern.
    const candidates = /^[/\\]{2}/.test(target) ? [`http://${url.host}`, `https://${url.host}`] : [url.origin];
    if (!candidates.some((c) => internal.includes(c))) return target;
  }
  // Ein Pfad mit // am Anfang wäre als Location-Wert ein protokollrelatives Ziel auf einen fremden Host.
  const pathname = url.pathname.replace(/^\/{2,}/, "/");
  return withBasePath(pathname, basePath) + url.search + url.hash;
}

export const isRedirectStatus = (status) => REDIRECT_STATUS.includes(status);

/**
 * Macht aus der gebauten index.html (Verweise relativ per Vite `base: "./"`) die Seite für diese Konfiguration.
 * Nur dieses HTML kennt den Präfix – die unveränderlich gecachten Dateien unter /assets/ bleiben überall gleich.
 */
export function renderIndexHtml(html, basePath) {
  // Ohne Präfix bleiben die Verweise relativ: Unter / ist das gleichwertig, und hinter einem Proxy mit Präfix, dem
  // PUBLIC_BASE_PATH fehlt, lädt die Oberfläche trotzdem und kann sagen, was fehlt.
  if (!basePath) return html;
  const rendered = html.replace(/\b(src|href)="\.\/([^"]*)"/g, (_, attr, rest) => `${attr}="${basePath}/${rest}"`);
  return rendered.replace("<head>", () => `<head>\n<meta name="localize-me-base-path" content="${basePath}">`);
}
