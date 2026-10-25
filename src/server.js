import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Store, ValidationError } from "./store.js";
import { buildCsv, csvFilename } from "./csv.js";
import { PLATFORMS } from "./placeholders.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const UI_DIR = path.join(here, "..", "ui");
const MAX_BODY = 1024 * 1024;
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

/** `uiDir: null` startet nur die API (Entwicklung mit Vite). */
export function createServer({ file, uiDir = UI_DIR }) {
  const store = new Store(file);
  store.ensureFile();
  const clients = new Set();

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
      "Content-Type": isText ? "text/plain; charset=utf-8" : "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers,
    });
    res.end(isText ? body : JSON.stringify(body));
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
      "Content-Type": MIME[path.extname(target)] || "application/octet-stream",
      "Cache-Control": rel.startsWith("assets/") ? "public, max-age=31536000, immutable" : "no-store",
    });
    res.end(body);
  }

  function projectPayload() {
    return { ...store.project, file: store.file };
  }

  async function readJson(req) {
    if (!/^application\/json\b/.test(req.headers["content-type"] || "")) {
      throw new ValidationError("Erwarte JSON (Content-Type: application/json).");
    }
    let size = 0;
    const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY) throw new ValidationError("Anfrage ist zu groß.");
      chunks.push(chunk);
    }
    try {
      return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
    } catch {
      throw new ValidationError("Ungültiges JSON.");
    }
  }

  // Schreibende Anfragen nur von der eigenen Oberfläche, nicht von fremden Webseiten.
  function sameOrigin(req) {
    const origin = req.headers.origin;
    if (!origin) return true;
    try {
      return new URL(origin).host === req.headers.host;
    } catch {
      return false;
    }
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    const method = req.method;

    try {
      if (method !== "GET" && method !== "HEAD" && !sameOrigin(req)) {
        return send(res, 403, { error: "Fremde Herkunft abgelehnt." });
      }

      if (parts[0] !== "api") {
        if ((method === "GET" || method === "HEAD") && uiDir) return serveUi(res, url.pathname);
        return send(res, 404, { error: "Nicht gefunden." });
      }

      // GET /api/project
      if (method === "GET" && parts[1] === "project" && parts.length === 2) {
        return send(res, 200, projectPayload());
      }

      // GET /api/events  (Server-Sent Events)
      if (method === "GET" && parts[1] === "events") {
        res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
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
          csv = buildCsv(store.project, { platform, languages: langs, delimiter });
        } catch (e) {
          throw new ValidationError(e.message);
        }
        const used = langs.length ? langs : [store.project.base, ...store.project.languages.map((l) => l.code).filter((c) => c !== store.project.base)];
        return send(res, 200, csv, {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${csvFilename(used, platform)}"`,
        });
      }

      // POST /api/keys {key, values}
      if (method === "POST" && parts[1] === "keys" && parts.length === 2) {
        const body = await readJson(req);
        store.addKey(body.key, body.values);
        broadcast("change");
        return send(res, 201, projectPayload());
      }

      // PATCH /api/keys/:key {lang, value} | {rename}
      if (method === "PATCH" && parts[1] === "keys" && parts.length === 3) {
        const body = await readJson(req);
        if (typeof body.rename === "string") store.renameKey(parts[2], body.rename);
        else store.setValue(parts[2], String(body.lang || ""), body.value);
        broadcast("change");
        return send(res, 200, projectPayload());
      }

      // DELETE /api/keys/:key
      if (method === "DELETE" && parts[1] === "keys" && parts.length === 3) {
        store.deleteKey(parts[2]);
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
    for (const res of clients) res.end();
  });

  return { server, store };
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
