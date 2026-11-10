import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Store, ValidationError } from "./store.js";
import { buildCsv, csvFilename } from "./csv.js";
import { PLATFORMS } from "./placeholders.js";
import { exportTargets, writeTargets } from "./outputs.js";
import { afterExport, DEFAULT_MESSAGE } from "./versioning.js";
import { createSync } from "./sync.js";
import { internalOrigins, isRedirectStatus, publicOrigins, renderIndexHtml, resolvePublicConfig, resolveRedirect } from "./public-url.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const UI_DIR = path.join(here, "..", "ui");
const MAX_BODY = 1024 * 1024;
const MAX_IMPORT_BODY = 20 * 1024 * 1024; // ganze localize.json mit vielen Sprachen
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
};
const LOOPBACK = ["127.0.0.1", "localhost", "::1"];
const LOOPBACK_HOSTNAMES = ["localhost", "127.0.0.1", "[::1]"];

// Für jede Antwort. Die Oberfläche lädt nur eigene Dateien und darf nicht eingebettet werden
// (sonst ließe sich „Dateien schreiben“ samt Commit/Push per Clickjacking auslösen).
const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; " +
    "connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
};

/**
 * `uiDir: null` startet nur die API (Entwicklung mit Vite).
 * `versioning`: was nach „Dateien schreiben“ passiert – { commit, push, message, hook, branches }, siehe versioning.js.
 * `sync`: { interval } hält localize.json auf dem Stand des Remotes, siehe sync.js. Ohne bleibt alles wie gehabt.
 * `host`: Adresse, auf der der Server lauscht. Bei 127.0.0.1/localhost werden nur Anfragen an localhost
 * angenommen – das schützt vor DNS-Rebinding (fremde Domain, die auf 127.0.0.1 zeigt).
 * `allowedHosts`: weitere Hostnamen, z. B. hinter einem Reverse Proxy auf demselben Rechner.
 * `publicBasePath`, `publicOrigin`, `trustedProxies`: Betrieb hinter einem Reverse Proxy, der den Präfix entfernt,
 * siehe public-url.js und README. Ungültige Werte werfen ConfigError, bevor etwas angelegt wird. Mit
 * `lenientPublicConfig` startet der Server stattdessen ohne diese Einstellung und meldet sie unter /api/setup.
 * `extraRoutes(req, res, { url, redirect })`: eigene Routen hinter denselben Sicherheitsprüfungen. Liefert sie
 * true, gilt die Anfrage als beantwortet. `redirect(ziel, status = 302)` berücksichtigt den öffentlichen Präfix.
 */
export function createServer({
  file,
  uiDir = UI_DIR,
  versioning = {},
  sync: syncOptions,
  host = "127.0.0.1",
  allowedHosts = [],
  publicBasePath,
  publicOrigin,
  trustedProxies,
  lenientPublicConfig = false,
  extraRoutes,
}) {
  const publicConfig = resolvePublicConfig({ publicBasePath, publicOrigin, trustedProxies }, { lenient: lenientPublicConfig });
  const store = new Store(file);
  store.ensureFile();
  const clients = new Set();
  const versioned = !!(versioning.commit || versioning.push || versioning.hook);
  const localOnly = LOOPBACK.includes(host);
  const hostnames = [...LOOPBACK_HOSTNAMES, ...allowedHosts.map((h) => h.toLowerCase())];
  if (publicConfig.origin) hostnames.push(new URL(publicConfig.origin).hostname);
  let exporting = false;
  const sync = syncOptions
    ? createSync({ store, branches: versioning.branches, interval: syncOptions.interval, isBusy: () => exporting, onChange: () => broadcast("change") })
    : null;

  // Änderungen von außen (git pull, Editor) an alle offenen Tabs melden.
  let timer = null;
  const dir = path.dirname(store.file);
  const base = path.basename(store.file);
  let watcher = null;
  try {
    watcher = fs.watch(dir, (_event, name) => {
      if (name && name !== base) return;
      clearTimeout(timer);
      timer = setTimeout(() => { if (store.reload()) broadcast("change"); }, 120);
    });
  } catch {
    // Ohne Watcher funktioniert alles, nur ohne Live-Aktualisierung.
  }

  function broadcast(event) {
    for (const res of clients) res.write(`event: ${event}\ndata: {}\n\n`);
  }

  function send(res, status, body, headers = {}) {
    const isText = typeof body === "string";
    res.writeHead(status, {
      ...SECURITY_HEADERS,
      "Content-Type": isText ? "text/plain; charset=utf-8" : "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers,
    });
    res.end(isText ? body : JSON.stringify(body));
  }

  // Einzige Stelle, die Redirects erzeugt. Herkünfte werden je Anfrage bestimmt, damit wechselnde Hosts sich nicht mischen.
  function redirect(req, res, url, target, status = 302) {
    if (!isRedirectStatus(status)) throw new TypeError(`Kein Redirect-Status: ${status}`);
    const location = resolveRedirect(target, {
      basePath: publicConfig.basePath,
      requestPath: url.pathname + url.search,
      internal: internalOrigins(req, publicConfig),
    });
    res.writeHead(status, { ...SECURITY_HEADERS, "Cache-Control": "no-store", Location: location });
    res.end();
  }

  // Gebaute Oberfläche aus ui/. Dateien unter /assets/ tragen einen Hash im Namen und dürfen gecacht werden.
  function serveUi(res, pathname) {
    const rel = pathname === "/" ? "index.html" : decodeURIComponent(pathname).replace(/^\/+/, "");
    const target = path.resolve(uiDir, rel);
    if (!target.startsWith(path.resolve(uiDir) + path.sep)) return send(res, 404, "Nicht gefunden.");
    let body;
    try {
      body = fs.readFileSync(target);
    } catch {
      if (rel === "index.html") {
        return send(res, 500, "Die Oberfläche ist noch nicht gebaut. Führe im Paketordner `npm run build` aus.");
      }
      return send(res, 404, "Nicht gefunden.");
    }
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      "Content-Type": MIME[path.extname(target)] || "application/octet-stream",
      "Cache-Control": rel.startsWith("assets/") ? "public, max-age=31536000, immutable" : "no-store",
    });
    res.end(rel === "index.html" ? renderIndexHtml(body.toString("utf8"), publicConfig.basePath) : body);
  }

  function projectPayload() {
    return {
      ...store.project,
      file: store.file,
      versioning: {
        commit: !!(versioning.commit || versioning.push),
        push: !!versioning.push,
        hook: !!versioning.hook,
        message: versioning.message || DEFAULT_MESSAGE,
        ...(versioning.branches && { branches: versioning.branches }),
      },
      ...(sync && { sync: sync.status() }),
    };
  }

  async function readJson(req, limit = MAX_BODY) {
    if (!/^application\/json\b/.test(req.headers["content-type"] || "")) {
      throw new ValidationError("Erwarte JSON (Content-Type: application/json).");
    }
    let size = 0;
    const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > limit) throw new ValidationError("Anfrage ist zu groß.");
      chunks.push(chunk);
    }
    try {
      return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
    } catch {
      throw new ValidationError("Ungültiges JSON.");
    }
  }

  // Lokal nur unter localhost erreichbar – eine fremde Domain mit DNS auf 127.0.0.1 wird abgewiesen.
  function allowedHost(req) {
    if (!localOnly) return true;
    try {
      return hostnames.includes(new URL(`http://${req.headers.host}`).hostname);
    } catch {
      return false;
    }
  }

  // Schreibende Anfragen nur von der eigenen Oberfläche, nicht von fremden Webseiten.
  function sameOrigin(req) {
    const site = req.headers["sec-fetch-site"];
    if (site && site !== "same-origin" && site !== "none") return false;
    const origin = req.headers.origin;
    return !origin || originAllowed(req, origin);
  }

  function originAllowed(req, origin) {
    try {
      const parsed = new URL(origin);
      // Hinter einem Proxy zählt zusätzlich genau die konfigurierte öffentliche Herkunft, sonst keine fremde.
      return parsed.host === req.headers.host || publicOrigins(req, publicConfig).includes(parsed.origin);
    } catch {
      return false;
    }
  }

  const server = http.createServer(async (req, res) => {
    let url, parts;
    try {
      url = new URL(req.url, "http://localhost");
      parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    } catch {
      return send(res, 400, { error: "Ungültiger Pfad." });
    }
    const method = req.method;

    try {
      if (!allowedHost(req)) {
        return send(res, 421, { error: "Unbekannter Host. Öffne localize-me über http://localhost." });
      }
      if (method !== "GET" && method !== "HEAD" && !sameOrigin(req)) {
        return send(res, 403, { error: "Fremde Herkunft abgelehnt." });
      }

      const tools = { url, redirect: (target, status) => redirect(req, res, url, target, status) };
      if (extraRoutes && (await extraRoutes(req, res, tools))) return;

      if (parts[0] !== "api") {
        if ((method === "GET" || method === "HEAD") && uiDir) return serveUi(res, url.pathname);
        return send(res, 404, { error: "Nicht gefunden." });
      }

      // GET /api/project
      if (method === "GET" && parts[1] === "project" && parts.length === 2) {
        return send(res, 200, projectPayload());
      }

      // GET /api/setup?origin=<location.origin> – für den Hinweis in der Oberfläche, was an der Konfiguration fehlt.
      // Dieselbe Prüfung wie beim Schreiben, damit der Hinweis schon vor dem ersten fehlgeschlagenen Speichern kommt.
      if (method === "GET" && parts[1] === "setup" && parts.length === 2) {
        return send(res, 200, {
          problems: publicConfig.problems,
          originAccepted: originAllowed(req, url.searchParams.get("origin") || ""),
        });
      }

      // GET /api/events  (Server-Sent Events)
      if (method === "GET" && parts[1] === "events") {
        // X-Accel-Buffering: nginx soll Ereignisse sofort durchreichen statt sie zu puffern.
        res.writeHead(200, { ...SECURITY_HEADERS, "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive", "X-Accel-Buffering": "no" });
        res.write("retry: 2000\n\n");
        clients.add(res);
        req.on("close", () => clients.delete(res));
        return;
      }

      // GET /api/export?platform=ios&langs=de,en&delimiter=;
      if (method === "GET" && parts[1] === "export") {
        const platform = url.searchParams.get("platform") || "raw";
        if (!PLATFORMS.includes(platform)) throw new ValidationError(`Unbekannte Plattform: ${platform}`);
        const langs = (url.searchParams.get("langs") || "").split(",").filter(Boolean);
        const delimiter = url.searchParams.get("delimiter") === "," ? "," : ";";
        let csv;
        try {
          csv = buildCsv(store.project, { platform, languages: langs, delimiter, strict: true });
        } catch (e) {
          throw new ValidationError(e.message);
        }
        const used = langs.length ? langs : [store.project.base, ...store.project.languages.map((l) => l.code).filter((c) => c !== store.project.base)];
        return send(res, 200, csv, {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${csvFilename(used, platform)}"`,
        });
      }

      // POST /api/export/native {message?} – schreibt die Dateien in die Ordner aus "output",
      // danach ggf. Commit/Push und eigener Befehl (Ergebnis unter `after`).
      if (method === "POST" && parts[1] === "export" && parts[2] === "native") {
        const body = req.headers["content-type"] ? await readJson(req) : {};
        if (exporting) return send(res, 409, { error: "Ein Export läuft gerade schon. Bitte kurz warten." });
        exporting = true;
        try {
          // Vorher abgleichen, damit der Export den neuesten Stand schreibt und der Push nicht am Rebase scheitert.
          await sync?.run();
          const targets = exportTargets(store.project, store.file);
          if (!targets.length) throw new ValidationError('Trage in localize.json unter "output" die Zielordner für ios und android ein.');
          const root = path.dirname(store.file);
          let written;
          try {
            written = writeTargets(store.project, targets);
          } catch (e) {
            throw new ValidationError(e.message);
          }
          const files = written.map((f) => ({ kind: f.kind, platform: f.platform, file: path.relative(root, f.file), changed: f.changed }));
          if (!versioned) return send(res, 200, { files });
          const message = typeof body.message === "string" ? body.message : "";
          const after = await afterExport(versioning, { file: store.file, written, message });
          await sync?.exported(after.git);
          return send(res, 200, { files, after });
        } finally {
          exporting = false;
        }
      }

      // POST /api/sync/resolve {id, use: "local"|"remote"} – Entscheidung zu einem Konflikt aus dem Abgleich
      if (method === "POST" && parts[1] === "sync" && parts[2] === "resolve" && parts.length === 3) {
        if (!sync) return send(res, 404, { error: "Nicht gefunden." });
        const body = await readJson(req);
        if (body.use !== "local" && body.use !== "remote") throw new ValidationError('„use“ muss „local“ oder „remote“ sein.');
        if (!sync.resolve(body.id, body.use)) throw new ValidationError("Diesen Konflikt gibt es nicht mehr.");
        broadcast("change");
        return send(res, 200, projectPayload());
      }

      // POST /api/import[?preview=1] – Body ist der Inhalt einer localize.json. Mit preview nur die Übersicht der Änderungen.
      if (method === "POST" && parts[1] === "import" && parts.length === 2) {
        const data = await readJson(req, MAX_IMPORT_BODY);
        if (url.searchParams.get("preview") === "1") return send(res, 200, store.previewImport(data));
        if (exporting) return send(res, 409, { error: "Ein Export läuft gerade. Bitte kurz warten." });
        store.importProject(data);
        broadcast("change");
        return send(res, 200, projectPayload());
      }

      // POST /api/keys {key, values, plural?, only?}
      if (method === "POST" && parts[1] === "keys" && parts.length === 2) {
        const body = await readJson(req);
        store.addKey(body.key, body.values, { plural: body.plural === true, only: body.only ?? "" });
        broadcast("change");
        return send(res, 201, projectPayload());
      }

      // PATCH /api/keys/:key {lang, value, form?} | {rename} | {plural} | {only: "ios"|"android"|""}
      if (method === "PATCH" && parts[1] === "keys" && parts.length === 3) {
        const body = await readJson(req);
        if (typeof body.rename === "string") store.renameKey(parts[2], body.rename);
        else if (typeof body.plural === "boolean") store.setPlural(parts[2], body.plural);
        else if (Object.hasOwn(body, "only")) store.setOnly(parts[2], body.only);
        else store.setValue(parts[2], String(body.lang || ""), body.value, body.form || undefined);
        broadcast("change");
        return send(res, 200, projectPayload());
      }

      // DELETE /api/keys/:key
      if (method === "DELETE" && parts[1] === "keys" && parts.length === 3) {
        store.deleteKey(parts[2]);
        broadcast("change");
        return send(res, 200, projectPayload());
      }

      // PUT /api/infoplist/:key {lang, value} – leerer Text entfernt die Sprache
      if (method === "PUT" && parts[1] === "infoplist" && parts.length === 3) {
        const body = await readJson(req);
        store.setInfoPlistValue(parts[2], String(body.lang || ""), body.value);
        broadcast("change");
        return send(res, 200, projectPayload());
      }

      // DELETE /api/infoplist/:key
      if (method === "DELETE" && parts[1] === "infoplist" && parts.length === 3) {
        store.deleteInfoPlistKey(parts[2]);
        broadcast("change");
        return send(res, 200, projectPayload());
      }

      // POST /api/tracking/:section {key, value?, description?}
      if (method === "POST" && parts[1] === "tracking" && parts.length === 3) {
        const { key, ...fields } = await readJson(req);
        store.addTrackingItem(parts[2], key, fields);
        broadcast("change");
        return send(res, 201, projectPayload());
      }

      // PATCH /api/tracking/:section/:key {key?, value?, description?}
      if (method === "PATCH" && parts[1] === "tracking" && parts.length === 4) {
        store.updateTrackingItem(parts[2], parts[3], await readJson(req));
        broadcast("change");
        return send(res, 200, projectPayload());
      }

      // DELETE /api/tracking/:section/:key
      if (method === "DELETE" && parts[1] === "tracking" && parts.length === 4) {
        store.deleteTrackingItem(parts[2], parts[3]);
        broadcast("change");
        return send(res, 200, projectPayload());
      }

      // POST /api/languages {code, name}
      if (method === "POST" && parts[1] === "languages" && parts.length === 2) {
        const body = await readJson(req);
        store.addLanguage(body.code, body.name);
        broadcast("change");
        return send(res, 201, projectPayload());
      }

      // DELETE /api/languages/:code[?purge=1]
      if (method === "DELETE" && parts[1] === "languages" && parts.length === 3) {
        store.removeLanguage(parts[2], { purge: url.searchParams.get("purge") === "1" });
        broadcast("change");
        return send(res, 200, projectPayload());
      }

      // PUT /api/base {code}
      if (method === "PUT" && parts[1] === "base") {
        const body = await readJson(req);
        store.setBase(body.code);
        broadcast("change");
        return send(res, 200, projectPayload());
      }

      return send(res, 404, { error: "Nicht gefunden." });
    } catch (e) {
      if (e instanceof ValidationError) return send(res, 400, { error: e.message });
      console.error(e);
      return send(res, 500, { error: "Interner Fehler: " + e.message });
    }
  });

  server.on("close", () => {
    watcher?.close();
    sync?.stop();
    for (const res of clients) res.end();
  });

  sync?.start();

  return { server, store, publicConfig, sync };
}

/** Startet den Server; ist der Port belegt, wird der nächste probiert. */
export function listen(server, { port, host = "127.0.0.1", tries = 10 }) {
  return new Promise((resolve, reject) => {
    const attempt = (p, left) => {
      const onError = (err) => {
        server.off("listening", onListening);
        if (err.code === "EADDRINUSE" && left > 0) attempt(p + 1, left - 1);
        else reject(err);
      };
      const onListening = () => {
        server.off("error", onError);
        resolve(server.address().port);
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(p, host);
    };
    attempt(port, tries);
  });
}
