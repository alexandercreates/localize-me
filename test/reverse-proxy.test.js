// Abnahme gegen das echte Build (ui/) und den echten Server hinter einem lokalen Proxy, der den Präfix entfernt.
// Braucht `npm run build`; am einfachsten über `npm run test:e2e`. Ohne Build wird übersprungen, außer mit
// LOCALIZE_ME_REQUIRE_UI=1 (CI): Dann schlägt das fehl, damit die Abnahme nicht unbemerkt ausfällt.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, listen } from "../src/server.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const UI_DIR = path.join(root, "ui");
const CLI = path.join(root, "bin", "cli.js");
const PREFIX = "/localize-engagement";

const indexPath = path.join(UI_DIR, "index.html");
const built = fs.existsSync(indexPath) && fs.readFileSync(indexPath, "utf8").includes('"./assets/');
if (!built && process.env.LOCALIZE_ME_REQUIRE_UI) throw new Error("ui/ fehlt oder ist veraltet: erst `npm run build` ausführen.");
const skip = built ? false : "kein aktuelles Build in ui/ – `npm run test:e2e` ausführen";

const CHROME = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].find((p) => p && fs.existsSync(p));

const browserSkip = skip || (!CHROME && "Chrome nicht gefunden") || (typeof WebSocket === "undefined" && "WebSocket braucht Node 22+") || false;

const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), name));

function seededFile() {
  const file = path.join(tmp("localize-proxy-"), "localize.json");
  fs.writeFileSync(file, JSON.stringify({
    base: "de",
    languages: [{ code: "de", name: "Deutsch" }],
    keys: { "home.greeting": { de: "Hallo" } },
  }));
  return file;
}

function closeServer(server) {
  server.close();
  server.closeAllConnections?.();
}

function pipeProxy(proxy, { prefix, getBackendPort, hostMode, proxyHeaders }) {
  const seen = [];
  proxy.on("request", (req, res) => {
    const matches = req.url === prefix || req.url.startsWith(`${prefix}/`) || req.url.startsWith(`${prefix}?`);
    if (prefix && !matches) {
      seen.push({ url: req.url, status: 404 });
      res.writeHead(404);
      return res.end("Außerhalb des Präfix");
    }
    const stripped = req.url.slice(prefix.length);
    const forwardedPath = stripped.startsWith("/") ? stripped : `/${stripped}`;
    const backendPort = getBackendPort();
    const headers = { ...req.headers, ...proxyHeaders };
    if (hostMode === "backend") headers.host = `127.0.0.1:${backendPort}`;
    const entry = { url: req.url, forwardedPath };
    seen.push(entry);
    const upstream = http.request({ host: "127.0.0.1", port: backendPort, method: req.method, path: forwardedPath, headers }, (answer) => {
      entry.status = answer.statusCode;
      res.writeHead(answer.statusCode, answer.headers);
      answer.pipe(res);
    });
    upstream.on("error", () => res.destroy());
    req.pipe(upstream);
  });
  return seen;
}

/** Proxy und echter Server. hostMode "backend": Proxy ersetzt den Host, "preserve": er reicht ihn durch. */
async function stack(t, { prefix = PREFIX, hostMode = "backend", proxyHeaders = {}, options = {}, publicOrigin = "proxy", uiDir = UI_DIR, routes } = {}) {
  const proxy = http.createServer();
  let backendPort;
  const seenProxy = pipeProxy(proxy, { prefix, getBackendPort: () => backendPort, hostMode, proxyHeaders });
  const proxyPort = await listen(proxy, { port: 0, tries: 0 });
  const origin = `http://127.0.0.1:${proxyPort}`;

  const seenBackend = [];
  const { server, store } = createServer({
    file: seededFile(),
    uiDir,
    publicBasePath: prefix,
    publicOrigin: publicOrigin === "proxy" ? origin : publicOrigin,
    ...options,
    extraRoutes: (req, res, tools) => {
      seenBackend.push(req.url);
      return routes ? routes(req, res, tools) : false;
    },
  });
  backendPort = await listen(server, { port: 0, tries: 0 });
  t.after(() => { closeServer(server); closeServer(proxy); });
  return { origin, proxyPort, publicRoot: origin + prefix, backendPort, seenBackend, seenProxy, store, backendHost: `127.0.0.1:${backendPort}` };
}

async function direct(port, { method = "GET", path: p = "/", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method, path: p, headers }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.on("error", reject);
    req.end(body);
  });
}

const manual = (url, init) => fetch(url, { redirect: "manual", ...init });
const goRoute = (_req, res, { url, redirect }) => {
  if (url.pathname !== "/go") return false;
  redirect(url.searchParams.get("to"));
  return true;
};
const location = async (s, to) => {
  const res = await manual(`${s.publicRoot}/go?to=${encodeURIComponent(to)}`);
  assert.equal(res.status, 302, `Status für ${to}`);
  return res.headers.get("location");
};

/** Alle lokalen URLs aus HTML, CSS und JS einsammeln und über den Proxy abrufen. */
async function crawl(rootUrl) {
  const queue = [rootUrl];
  const fetched = new Map();
  const local = new URL(rootUrl).origin;
  while (queue.length) {
    const url = queue.shift();
    if (fetched.has(url)) continue;
    const res = await fetch(url);
    const type = res.headers.get("content-type") || "";
    fetched.set(url, { status: res.status, type, cache: res.headers.get("cache-control") });
    if (!/html|css|javascript/.test(type)) continue;
    const text = await res.text();
    const refs = [];
    if (type.includes("html")) refs.push(...[...text.matchAll(/\b(?:src|href)="([^"]+)"/g)].map((m) => m[1]));
    if (type.includes("css")) refs.push(...[...text.matchAll(/url\(["']?([^"')]+)["']?\)/g)].map((m) => m[1]).filter((r) => !r.startsWith("data:")));
    if (type.includes("javascript")) refs.push(...[...text.matchAll(/\bimport\(\s*["'`](\.[^"'`]+)["'`]\s*\)/g)].map((m) => m[1]));
    for (const ref of refs) {
      const next = new URL(ref, url);
      if (next.origin === local) queue.push(next.href);
    }
  }
  return fetched;
}

test("HTML unter dem Präfix, während das Backend / erhält", { skip }, async (t) => {
  const s = await stack(t);
  const res = await fetch(`${s.publicRoot}/`);
  assert.equal(res.status, 200);
  assert.equal(s.seenBackend.at(-1), "/");
  assert.equal(res.headers.get("cache-control"), "no-store");
  const html = await res.text();
  assert.match(html, new RegExp(`<meta name="localize-me-base-path" content="${PREFIX}">`));
  assert.match(html, new RegExp(`src="${PREFIX}/assets/index-[^"]+\\.js"`));
  assert.match(html, new RegExp(`href="${PREFIX}/assets/index-[^"]+\\.css"`));
  assert.match(html, new RegExp(`href="${PREFIX}/favicon\\.svg"`));
  assert.doesNotMatch(html, /(src|href)="\.?\/(assets|favicon)/);

  // Ohne abschließenden Slash im Browser: Die Verweise müssen trotzdem stimmen.
  const bare = await (await fetch(s.publicRoot)).text();
  assert.equal(s.seenBackend.at(-1), "/");
  assert.equal(bare, html);
});

test("Eingehende Routen bleiben präfixfrei", { skip }, async (t) => {
  const s = await stack(t);
  for (const p of [`${PREFIX}/`, `${PREFIX}/api/project`, `${PREFIX}/favicon.svg`]) {
    assert.equal((await direct(s.backendPort, { path: p })).status, 404, p);
  }
  assert.equal((await direct(s.backendPort, { path: "/api/project" })).status, 200);
  assert.ok((await manual(`${s.origin}/api/project`)).status === 404, "Proxy leitet nur den Präfix weiter");
});

test("Alle in HTML und CSS referenzierten Dateien sind erreichbar, nur Hash-Dateien sind unveränderlich", { skip }, async (t) => {
  const s = await stack(t);
  const found = await crawl(`${s.publicRoot}/`);
  const urls = [...found.keys()];
  assert.ok(urls.some((u) => u.endsWith(".js")), "JS gefunden");
  assert.ok(urls.some((u) => u.endsWith(".css")), "CSS gefunden");
  assert.ok(urls.filter((u) => u.endsWith(".woff2")).length >= 5, "Schriften aus dem CSS gefunden");
  assert.ok(urls.some((u) => u.endsWith("favicon.svg")), "Favicon gefunden");
  for (const [url, { status, type, cache }] of found) {
    assert.equal(status, 200, url);
    assert.ok(new URL(url).pathname.startsWith(`${PREFIX}/`), url);
    if (url.includes("/assets/")) assert.equal(cache, "public, max-age=31536000, immutable", url);
    if (url.endsWith(".woff2")) assert.equal(type, "font/woff2", url);
  }
  assert.ok(s.seenProxy.every((e) => e.status === 200), "keine Anfrage außerhalb des Präfix");
  assert.ok(s.seenBackend.every((u) => !u.startsWith(PREFIX)), "Backend sieht keinen Präfix");
});

test("Gleiche Asset-URL liefert bei jeder Konfiguration denselben Inhalt", { skip }, async (t) => {
  const a = await stack(t, { prefix: "/a/b" });
  const b = await stack(t, { prefix: "/ganz-anders" });
  const assets = fs.readdirSync(path.join(UI_DIR, "assets"));
  assert.ok(assets.length >= 7);
  for (const name of assets) {
    const fromA = Buffer.from(await (await fetch(`${a.publicRoot}/assets/${name}`)).arrayBuffer());
    const fromB = Buffer.from(await (await fetch(`${b.publicRoot}/assets/${name}`)).arrayBuffer());
    const direct_ = Buffer.from(await (await fetch(`http://127.0.0.1:${a.backendPort}/assets/${name}`)).arrayBuffer());
    assert.ok(fromA.equals(fromB) && fromA.equals(direct_), name);
    assert.equal(fromA.includes("/a/b/assets"), false, name);
    assert.equal(fromA.includes("ganz-anders"), false, name);
  }
});

test("Dynamische Imports lösen sich relativ zum Asset auf", { skip }, async (t) => {
  // Die Oberfläche selbst hat derzeit keinen Code-Split. Dieselbe `base`-Einstellung an einem Mini-Projekt prüft,
  // dass ein späterer dynamischer Import auch ohne Anpassung unter dem Präfix funktioniert.
  const { default: config } = await import("../vite.config.js");
  const { build } = await import("vite");
  const src = tmp("localize-fixture-");
  const out = path.join(src, "dist");
  fs.writeFileSync(path.join(src, "index.html"), '<!doctype html><html><head><title>wartet</title><link rel="icon" href="data:,"></head><body><script type="module" src="/main.js"></script></body></html>');
  fs.writeFileSync(path.join(src, "main.js"), 'import("./lazy.js").then((m) => { document.title = m.title; });');
  fs.writeFileSync(path.join(src, "lazy.js"), 'import "./lazy.css";\nexport const title = "nachgeladen";');
  fs.writeFileSync(path.join(src, "lazy.css"), "body { color: rgb(1, 2, 3); }");
  await build({ configFile: false, root: src, base: config.base, logLevel: "silent", build: { outDir: out, assetsInlineLimit: 0 } });

  const s = await stack(t, { uiDir: out });
  const found = await crawl(`${s.publicRoot}/`);
  const scripts = [...found.keys()].filter((u) => u.endsWith(".js"));
  assert.ok(scripts.some((u) => /\/lazy-[^/]+\.js$/.test(u)), `dynamischer Chunk gefunden: ${scripts}`);
  for (const [url, { status }] of found) assert.equal(status, 200, url);
  for (const file of fs.readdirSync(path.join(out, "assets")).filter((f) => f.endsWith(".js"))) {
    assert.doesNotMatch(fs.readFileSync(path.join(out, "assets", file), "utf8"), /["'`]\/assets\//, file);
  }

  if (browserSkip) return t.diagnostic(`Ausführung im Browser übersprungen: ${browserSkip}`);
  const browser = await openBrowser(t);
  await browser.navigate(`${s.publicRoot}/`);
  await browser.waitFor(`document.title === "nachgeladen"`, "dynamischer Import ausgeführt");
  assert.ok(s.seenBackend.some((u) => /^\/assets\/lazy-.+\.css$/.test(u)), "CSS des Chunks vom Browser geladen");
  assert.deepEqual(browser.problems, []);
});

/** Minimaler Zugriff auf Chrome über das DevTools-Protokoll; WebSocket gibt es in Node erst ab Version 22. */
async function openBrowser(t) {
  const proc = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-sandbox", "--no-first-run", "--remote-debugging-port=0", `--user-data-dir=${tmp("localize-chrome-")}`, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
  t.after(() => proc.kill("SIGKILL"));
  const wsUrl = await new Promise((resolve, reject) => {
    let err = "";
    proc.stderr.on("data", (d) => {
      err += d;
      const m = err.match(/DevTools listening on (ws:\S+)/);
      if (m) resolve(m[1]);
    });
    proc.on("exit", () => reject(new Error(`Chrome beendet: ${err}`)));
  });
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  t.after(() => ws.close());

  let id = 0;
  const pending = new Map();
  const problems = [];
  ws.onmessage = ({ data }) => {
    const msg = JSON.parse(data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    }
    if (msg.method === "Runtime.exceptionThrown") problems.push(msg.params.exceptionDetails.text);
    if (msg.method === "Log.entryAdded" && msg.params.entry.level === "error") problems.push(`${msg.params.entry.text} ${msg.params.entry.url || ""}`);
  };
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const callId = ++id;
    pending.set(callId, { resolve, reject });
    ws.send(JSON.stringify({ id: callId, method, params, sessionId }));
  });
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  for (const domain of ["Page", "Runtime", "Log"]) await send(`${domain}.enable`, {}, sessionId);

  const evaluate = async (expression) => {
    const { result, exceptionDetails } = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
    return result.value;
  };
  return {
    problems,
    evaluate,
    navigate: (url) => send("Page.navigate", { url }, sessionId),
    async waitFor(expression, what = expression) {
      const end = Date.now() + 10000;
      while (Date.now() < end) {
        if (await evaluate(expression).catch(() => false)) return;
        await new Promise((r) => setTimeout(r, 50));
      }
      assert.fail(`Im Browser nicht eingetreten: ${what}. Seite: ${await evaluate("document.body?.innerText").catch(() => "?")}. Probleme: ${problems}`);
    },
  };
}

test("Echter Browser: Oberfläche, Schreiben, SSE und Download unter dem Präfix", { skip: browserSkip }, async (t) => {
  const s = await stack(t);
  const browser = await openBrowser(t);
  await browser.navigate(`${s.publicRoot}/`);
  await browser.waitFor(`document.body.innerText.includes("home.greeting")`, "Texte aus /api/project gerendert");
  assert.equal(await browser.evaluate(`document.querySelector(".setup-notice")`), null, "kein Hinweis bei korrekter Konfiguration");
  await browser.evaluate("document.fonts.ready");
  assert.ok(await browser.evaluate(`[...document.fonts].some((f) => f.status === "loaded")`), "Schrift aus dem CSS geladen");

  // Schreiben über das echte Formular: Der Browser setzt Origin und Sec-Fetch-Site selbst.
  await browser.evaluate(`(() => {
    const form = document.querySelector("form.quick");
    const [key, text] = form.querySelectorAll("input[type=text], input:not([type]), textarea");
    const set = (el, v) => { el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); };
    set(key, "aus.browser");
    set(text, "Geschrieben");
    form.requestSubmit();
  })()`);
  await browser.waitFor(`document.body.innerText.includes("aus.browser")`, "neuer Key sichtbar");
  assert.equal(s.store.project.keys["aus.browser"].de, "Geschrieben");

  // SSE: Änderung von außen erscheint ohne Neuladen.
  const res = await fetch(`${s.publicRoot}/api/keys`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: s.origin },
    body: JSON.stringify({ key: "von.aussen", values: { de: "Live" } }),
  });
  assert.equal(res.status, 201);
  await browser.waitFor(`document.body.innerText.includes("von.aussen")`, "Änderung per SSE sichtbar");

  // Download: Der Link trägt den Präfix und liefert die Datei.
  await browser.evaluate(`[...document.querySelectorAll("button")].find((b) => b.textContent.includes("Exportieren")).click()`);
  await browser.waitFor(`document.querySelector("a[download]")`, "Download-Link");
  const href = await browser.evaluate(`document.querySelector("a[download]").getAttribute("href")`);
  assert.ok(href.startsWith(`${PREFIX}/api/export?`), href);
  const download = await browser.evaluate(`fetch(document.querySelector("a[download]").href).then(async (r) => ({ status: r.status, disposition: r.headers.get("content-disposition"), text: await r.text() }))`);
  assert.equal(download.status, 200);
  assert.match(download.disposition, /^attachment/);
  assert.match(download.text, /aus\.browser/);

  const paths = s.seenProxy.map((e) => e.url);
  assert.ok(paths.includes(`${PREFIX}/api/project`), `API-Aufruf: ${paths}`);
  assert.ok(paths.includes(`${PREFIX}/api/events`), `SSE: ${paths}`);
  assert.ok(paths.some((p) => p.startsWith(`${PREFIX}/assets/`) && p.endsWith(".woff2")), `Schrift: ${paths}`);
  assert.deepEqual(s.seenProxy.filter((e) => e.status !== 200 && e.status !== 201 && e.status !== undefined).map((e) => `${e.status} ${e.url}`), []);
  assert.ok(s.seenBackend.every((u) => !u.startsWith(PREFIX)), "Backend sieht keinen Präfix");
  assert.deepEqual(browser.problems, [], "keine Fehler im Browser (auch keine CSP-Verstöße)");

  // Aufruf ohne abschließenden Slash: Verweise und API stimmen trotzdem.
  await browser.navigate(s.publicRoot);
  await browser.waitFor(`document.body.innerText.includes("aus.browser")`, "App ohne abschließenden Slash");
  assert.deepEqual(browser.problems, []);
});

test("API-Schreibzugriffe, SSE und Download über den Proxy", { skip }, async (t) => {
  const s = await stack(t);
  const write = (method, p, body) => fetch(`${s.publicRoot}${p}`, {
    method,
    headers: { "Content-Type": "application/json", Origin: s.origin, "Sec-Fetch-Site": "same-origin" },
    body: body && JSON.stringify(body),
  });

  const events = await fetch(`${s.publicRoot}/api/events`);
  assert.equal(events.status, 200);
  assert.equal(events.headers.get("content-type"), "text/event-stream");
  const reader = events.body.getReader();
  const waitForChange = (async () => {
    let received = "";
    while (!received.includes("event: change")) {
      const { value, done } = await reader.read();
      if (done) return received;
      received += Buffer.from(value).toString();
    }
    return received;
  })();

  assert.equal((await write("POST", "/api/languages", { code: "en", name: "Englisch" })).status, 201);
  assert.match(await waitForChange, /event: change/);
  await reader.cancel();

  assert.equal((await write("POST", "/api/keys", { key: "a.b", values: { de: "x" } })).status, 201);
  assert.equal((await write("PATCH", "/api/keys/a.b", { lang: "en", value: "y" })).status, 200);
  assert.equal((await write("PUT", "/api/base", { code: "de" })).status, 200);
  assert.equal(s.store.project.keys["a.b"].en, "y");
  assert.equal((await write("DELETE", "/api/keys/a.b")).status, 200);
  assert.equal(s.store.project.keys["a.b"], undefined);

  const csv = await fetch(`${s.publicRoot}/api/export?platform=ios&langs=de,en&delimiter=,`);
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get("content-disposition"), /^attachment; filename="strings_de_en_ios\.csv"/);
  assert.match(await csv.text(), /home\.greeting/);
  assert.ok(s.seenBackend.includes("/api/export?platform=ios&langs=de,en&delimiter=,"), "Query kommt unverändert an");
});

test("Interne Ziele bekommen den Präfix genau einmal, Query und Fragment bleiben", { skip }, async (t) => {
  const s = await stack(t, { routes: goRoute });
  const cases = [
    ["/", `${PREFIX}/`],
    ["/x", `${PREFIX}/x`],
    ["/x?y=1&z=%2F#frag", `${PREFIX}/x?y=1&z=%2F#frag`],
    [`${PREFIX}/x?y=1#f`, `${PREFIX}/x?y=1#f`],
    [PREFIX, `${PREFIX}/`],
    [`${PREFIX}-2/x`, `${PREFIX}${PREFIX}-2/x`],
    ["x?y=1", `${PREFIX}/x?y=1`],
    ["./x", `${PREFIX}/x`],
    ["../../x", `${PREFIX}/x`],
    ["?a=1", `${PREFIX}/go?a=1`],
    ["#f", `${PREFIX}/go?to=%23f#f`],
    [`http://${s.backendHost}/x?y=1#f`, `${PREFIX}/x?y=1#f`],
    [`http://${s.backendHost}${PREFIX}/x`, `${PREFIX}/x`],
    [`//${s.backendHost}/x`, `${PREFIX}/x`],
    [`${s.origin}/x?y=1#f`, `${PREFIX}/x?y=1#f`],
    [`${s.origin}${PREFIX}/x`, `${PREFIX}/x`],
    [`//${s.origin.replace("http://", "")}/x`, `${PREFIX}/x`],
    [`http://${s.backendHost.toUpperCase()}/x`, `${PREFIX}/x`],
    ["/a/..//evil.example/x", `${PREFIX}/evil.example/x`],
  ];
  for (const [to, expected] of cases) assert.equal(await location(s, to), expected, to);
});

test("Externe Ziele, ähnliche Hosts und andere Ports bleiben unverändert", { skip }, async (t) => {
  const s = await stack(t, { routes: goRoute });
  const host = s.backendHost;
  const freePort = Math.max(s.backendPort, s.proxyPort) + 1;
  const cases = [
    "https://example.org/x?y=1#f",
    "//example.org/x?y=1#f",
    "/\\example.org/x",
    "\\\\example.org/x",
    "mailto:team@example.org?subject=a",
    "tel:+49123",
    "javascript:alert(1)",
    "custom-app://open/x",
    `http://${host.split(":")[0]}.evil.example:${s.backendPort}/x`,
    `http://evil.example/${host}/x`,
    `http://evil-localhost:${s.backendPort}/x`,
    `http://127.0.0.1:${freePort}/x`,
    "http://127.0.0.1/x",
    `https://${host}/x`,
    `http://${host}@evil.example/x`,
    `http://127.0.0.1.evil.example:${s.proxyPort}/x`,
  ];
  for (const to of cases) assert.equal(await location(s, to), to, to);
});

test("Redirect-Ketten: Login, Logout und verschachtelte Rücksprungziele", { skip }, async (t) => {
  // Keine echte Anmeldung: localize-me hat keine. Die Routen prüfen nur die Redirect-Verarbeitung im echten Server.
  const routes = (req, res, { url, redirect }) => {
    const next = url.searchParams.get("next");
    switch (url.pathname) {
      case "/geschuetzt":
        if (url.searchParams.has("ok")) {
          res.writeHead(200, { "Content-Type": "text/plain" });
          res.end("angekommen");
        } else {
          redirect("/login?next=" + encodeURIComponent(`${url.pathname}${url.search}&ok=1#oben`));
        }
        return true;
      case "/login":
      case "/logout":
        redirect(next || "/");
        return true;
      case "/absolut":
        redirect(`http://${req.headers.host}/login?next=${encodeURIComponent("/ziel?a=1&b=%2F")}`, 303);
        return true;
      case "/ziel":
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("angekommen");
        return true;
      default:
        return false;
    }
  };
  const s = await stack(t, { routes });

  async function follow(start) {
    const chain = [];
    let current = new URL(`${s.publicRoot}${start}`);
    for (let i = 0; i < 6; i++) {
      const res = await manual(current);
      if (res.status < 300 || res.status >= 400) return { chain, final: current, status: res.status, body: await res.text() };
      const next = res.headers.get("location");
      chain.push(next);
      assert.ok(!next.includes(String(s.backendPort)), `kein Backend-Port in ${next}`);
      const hash = new URL(next, current).hash;
      current = new URL(next, current);
      current.hash = hash;
    }
    assert.fail(`Zu viele Redirects: ${chain}`);
  }

  const first = await follow("/geschuetzt?tab=2");
  assert.deepEqual(first.chain, [
    `${PREFIX}/login?next=%2Fgeschuetzt%3Ftab%3D2%26ok%3D1%23oben`,
    `${PREFIX}/geschuetzt?tab=2&ok=1#oben`,
  ]);
  assert.equal(first.body, "angekommen");

  // Rücksprungziel kommt schon präfixiert aus der öffentlichen Sicht des Browsers: kein zweiter Präfix.
  const prefixedNext = await follow(`/login?next=${encodeURIComponent(`${PREFIX}/ziel?a=1#x`)}`);
  assert.deepEqual(prefixedNext.chain, [`${PREFIX}/ziel?a=1#x`]);
  assert.equal(prefixedNext.body, "angekommen");

  const nested = await follow(`/logout?next=${encodeURIComponent(`/login?next=${encodeURIComponent(`${PREFIX}/ziel?a=1`)}`)}`);
  assert.deepEqual(nested.chain, [
    `${PREFIX}/login?next=${encodeURIComponent(`${PREFIX}/ziel?a=1`)}`,
    `${PREFIX}/ziel?a=1`,
  ]);
  assert.equal(nested.body, "angekommen");

  const absolute = await follow("/absolut");
  assert.deepEqual(absolute.chain, [`${PREFIX}/login?next=%2Fziel%3Fa%3D1%26b%3D%252F`, `${PREFIX}/ziel?a=1&b=%2F`]);
  assert.equal(absolute.status, 200);
  assert.equal(new URL(absolute.final).search, "?a=1&b=%2F");
});

test("Ungültige Redirect-Ziele ergeben 400 ohne eingeschleuste Header", { skip }, async (t) => {
  const s = await stack(t, { routes: goRoute });
  const res = await manual(`${s.publicRoot}/go?to=${encodeURIComponent("/x\r\nSet-Cookie: a=b")}`);
  assert.equal(res.status, 400);
  assert.equal(res.headers.get("set-cookie"), null);
  assert.equal(res.headers.get("location"), null);
});

test("Wechselnde Backend-Hosts vermischen sich nicht zwischen Requests", { skip }, async (t) => {
  const s = await stack(t, { routes: goRoute, options: { host: "0.0.0.0" }, publicOrigin: "" });
  const ask = async (host, targetHost) => {
    const to = encodeURIComponent(`http://${targetHost}/x?h=${targetHost}`);
    const res = await direct(s.backendPort, { path: `/go?to=${to}`, headers: { Host: host } });
    return res.headers.location;
  };
  const jobs = [];
  for (let i = 0; i < 60; i++) {
    const [own, other] = i % 2 ? ["a.backend.test:8001", "b.backend.test:8002"] : ["b.backend.test:8002", "a.backend.test:8001"];
    jobs.push(ask(own, own).then((l) => assert.equal(l, `${PREFIX}/x?h=${own}`)));
    jobs.push(ask(own, other).then((l) => assert.equal(l, `http://${other}/x?h=${other}`)));
  }
  await Promise.all(jobs);
});

test("X-Forwarded-* gilt nur innerhalb der konfigurierten Vertrauensgrenze", { skip }, async (t) => {
  const target = "https://oeffentlich.test/x";
  const forwarded = { "X-Forwarded-Host": "oeffentlich.test", "X-Forwarded-Proto": "https" };
  const post = (port, headers) => direct(port, {
    method: "POST", path: "/api/languages",
    headers: { "Content-Type": "application/json", Origin: "https://oeffentlich.test", ...headers },
    body: JSON.stringify({ code: "fr", name: "Französisch" }),
  });
  const goPath = `/go?to=${encodeURIComponent(target)}`;

  const untrusted = await stack(t, { routes: goRoute, publicOrigin: "", options: {} });
  assert.equal((await direct(untrusted.backendPort, { path: goPath, headers: forwarded })).headers.location, target);
  assert.equal((await post(untrusted.backendPort, forwarded)).status, 403);

  const otherPeer = await stack(t, { routes: goRoute, publicOrigin: "", options: { trustedProxies: ["10.0.0.1"] } });
  assert.equal((await direct(otherPeer.backendPort, { path: goPath, headers: forwarded })).headers.location, target);
  assert.equal((await post(otherPeer.backendPort, forwarded)).status, 403);

  const trusted = await stack(t, { routes: goRoute, publicOrigin: "", options: { trustedProxies: "127.0.0.1" } });
  assert.equal((await direct(trusted.backendPort, { path: goPath, headers: forwarded })).headers.location, `${PREFIX}/x`);
  // Nur der letzte Listeneintrag zählt: Den setzt der Proxy, die davor könnte der Browser vorgeben.
  const spoofed = { "X-Forwarded-Host": "oeffentlich.test, anderer.test", "X-Forwarded-Proto": "https" };
  assert.equal((await direct(trusted.backendPort, { path: goPath, headers: spoofed })).headers.location, target);
  assert.equal((await post(trusted.backendPort, spoofed)).status, 403);
  // Falsches Schema oder RFC-7239-`Forwarded` öffnen nichts.
  assert.equal((await post(trusted.backendPort, { "X-Forwarded-Host": "oeffentlich.test", "X-Forwarded-Proto": "http" })).status, 403);
  assert.equal((await post(trusted.backendPort, { Forwarded: "host=oeffentlich.test;proto=https" })).status, 403);
  assert.equal((await post(trusted.backendPort, forwarded)).status, 201);
});

test("Sicherheitsprüfungen wirken unter öffentlicher Origin weiter", { skip }, async (t) => {
  const s = await stack(t);
  const post = (headers) => fetch(`${s.publicRoot}/api/languages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ code: "en", name: "Englisch" }),
  });
  for (const Origin of ["https://evil.example", "null", s.origin.replace("http:", "https:"), `http://127.0.0.1:${Math.max(s.backendPort, s.proxyPort) + 1}`, `http://127.0.0.1.evil.example:${s.proxyPort}`]) {
    assert.equal((await post({ Origin })).status, 403, Origin);
  }
  for (const site of ["cross-site", "same-site"]) {
    assert.equal((await post({ "Sec-Fetch-Site": site, Origin: s.origin })).status, 403, site);
  }
  assert.equal(s.store.project.languages.length, 1, "nichts geschrieben");
  assert.equal((await post({ "Sec-Fetch-Site": "same-origin", Origin: s.origin })).status, 201);

  // DNS-Rebinding: Lokal bleibt nur die ausdrücklich konfigurierte öffentliche Origin zusätzlich erlaubt.
  const preserved = await stack(t, { hostMode: "preserve", publicOrigin: "https://tools.example.org" });
  assert.equal((await direct(preserved.backendPort, { path: "/api/project", headers: { Host: "tools.example.org" } })).status, 200);
  assert.equal((await direct(preserved.backendPort, { path: "/api/project", headers: { Host: "evil.example" } })).status, 421);
  assert.equal((await direct(preserved.backendPort, { path: "/api/project", headers: { Host: "tools.example.org.evil.example" } })).status, 421);

  // Herkunft = öffentlicher Host beim durchgereichten Host, wie bisher.
  const res = await direct(preserved.backendPort, {
    method: "POST", path: "/api/languages",
    headers: { Host: "tools.example.org", Origin: "https://tools.example.org", "Content-Type": "application/json" },
    body: JSON.stringify({ code: "it", name: "Italienisch" }),
  });
  assert.equal(res.status, 201);

  const html = await fetch(`${s.publicRoot}/`);
  assert.match(html.headers.get("content-security-policy"), /base-uri 'none'/);
  assert.match(html.headers.get("content-security-policy"), /frame-ancestors 'none'/);
  assert.equal(html.headers.get("x-frame-options"), "DENY");
  assert.equal(html.headers.get("x-content-type-options"), "nosniff");
});

test("localize-me setzt keine Cookies", { skip }, async (t) => {
  const s = await stack(t, { routes: goRoute });
  for (const p of ["/", "/favicon.svg", "/api/project", "/api/export?platform=raw", "/go?to=/x", "/gibt-es-nicht"]) {
    const res = await manual(`${s.publicRoot}${p}`);
    assert.equal(res.headers.get("set-cookie"), null, p);
  }
});

test("Kaputte Pfade beenden den Prozess nicht", { skip }, async (t) => {
  const s = await stack(t);
  assert.equal((await direct(s.backendPort, { path: "/%E0%A4%A" })).status, 400);
  assert.equal((await direct(s.backendPort, { path: "//" })).status, 400);
  assert.equal((await fetch(`${s.publicRoot}/api/project`)).status, 200);
});

test("Root-Betrieb ohne Konfiguration bleibt wie bisher", { skip }, async (t) => {
  const { server } = createServer({
    file: seededFile(),
    uiDir: UI_DIR,
    extraRoutes: goRoute,
  });
  const port = await listen(server, { port: 0, tries: 0 });
  t.after(() => closeServer(server));
  const base = `http://127.0.0.1:${port}`;

  const html = await (await fetch(`${base}/`)).text();
  assert.doesNotMatch(html, /localize-me-base-path/);
  assert.match(html, /src="\.\/assets\/index-[^"]+\.js"/);
  assert.match(html, /href="\.\/favicon\.svg"/);
  for (const [url, { status }] of await crawl(`${base}/`)) assert.equal(status, 200, url);
  assert.equal((await fetch(`${base}/api/project`)).status, 200);

  const post = await fetch(`${base}/api/languages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: base, "Sec-Fetch-Site": "same-origin" },
    body: JSON.stringify({ code: "en", name: "Englisch" }),
  });
  assert.equal(post.status, 201);

  const to = (t_) => manual(`${base}/go?to=${encodeURIComponent(t_)}`).then((r) => r.headers.get("location"));
  assert.equal(await to("/x?y=1#f"), "/x?y=1#f");
  assert.equal(await to(`${base}/x`), "/x");
  assert.equal(await to("https://example.org/x"), "https://example.org/x");
  assert.equal(await to("/a/..//evil.example/x"), "/evil.example/x");
});

function runCli(args, env) {
  const cwd = tmp("localize-cli-");
  const child = spawn(process.execPath, [CLI, "dev", "--no-open", ...args], { cwd, env: { ...process.env, ...env, CI: "1" } });
  let output = "";
  child.stdout.on("data", (d) => (output += d));
  child.stderr.on("data", (d) => (output += d));
  const exited = new Promise((resolve) => child.on("exit", (code) => resolve({ code, output })));
  const ready = new Promise((resolve, reject) => {
    child.stdout.on("data", () => {
      const m = output.match(/localhost:(\d+)[\s\S]*Texte:/);
      if (m) resolve(Number(m[1]));
    });
    exited.then(() => reject(new Error(`CLI beendet: ${output}`)));
  });
  ready.catch(() => {});
  return { child, ready, exited, cwd, output: () => output };
}

test("CLI: Umgebungsvariablen konfigurieren denselben Server, Flags haben Vorrang", { skip }, async (t) => {
  const proxy = http.createServer();
  let backendPort;
  pipeProxy(proxy, { prefix: PREFIX, getBackendPort: () => backendPort, hostMode: "backend", proxyHeaders: {} });
  const proxyPort = await listen(proxy, { port: 0, tries: 0 });
  t.after(() => closeServer(proxy));

  const cli = runCli(["--port", "48700"], {
    PUBLIC_BASE_PATH: `${PREFIX}///`,
    PUBLIC_ORIGIN: `http://127.0.0.1:${proxyPort}/`,
  });
  t.after(() => cli.child.kill());
  backendPort = await cli.ready;
  assert.match(cli.output(), new RegExp(`Öffentlich: http://127\\.0\\.0\\.1:${proxyPort}${PREFIX}/`));

  const html = await (await fetch(`http://127.0.0.1:${proxyPort}${PREFIX}/`)).text();
  assert.match(html, new RegExp(`src="${PREFIX}/assets/`));
  const post = await fetch(`http://127.0.0.1:${proxyPort}${PREFIX}/api/languages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: `http://127.0.0.1:${proxyPort}` },
    body: JSON.stringify({ code: "en", name: "Englisch" }),
  });
  assert.equal(post.status, 201);

  const flagged = runCli(["--port", "48720", "--public-base-path", "/per-flag/"], { PUBLIC_BASE_PATH: "/per-env" });
  t.after(() => flagged.child.kill());
  const flaggedPort = await flagged.ready;
  assert.match(await (await fetch(`http://127.0.0.1:${flaggedPort}/`)).text(), /content="\/per-flag"/);
});

test("CLI: Ungültige Konfiguration stoppt den Dienst nicht, sondern wird gemeldet", { skip }, async (t) => {
  let port = 48740;
  for (const [args, env, variable] of [
    [[], { PUBLIC_BASE_PATH: "kein-pfad" }, "PUBLIC_BASE_PATH"],
    [[], { PUBLIC_ORIGIN: "https://tools.example.org/app" }, "PUBLIC_ORIGIN"],
    [[], { PUBLIC_TRUSTED_PROXIES: "*" }, "PUBLIC_TRUSTED_PROXIES"],
    [["--public-base-path", "//evil.example"], {}, "PUBLIC_BASE_PATH"],
  ]) {
    const cli = runCli(["--port", String(port), ...args], env);
    t.after(() => cli.child.kill());
    const actual = await cli.ready;
    port = actual + 1;
    assert.match(cli.output(), new RegExp(`${variable}.*ignoriert`), "steht in der Serverausgabe");
    const setup = await (await fetch(`http://127.0.0.1:${actual}/api/setup`)).json();
    assert.deepEqual(setup.problems.map((p) => p.variable), [variable]);
    assert.equal((await fetch(`http://127.0.0.1:${actual}/`)).status, 200);
    cli.child.kill();
  }
});

test("CLI: Ohne Variablen startet der Dienst ohne Meldung", { skip }, async (t) => {
  const cli = runCli(["--port", "48760"], { PUBLIC_BASE_PATH: "", PUBLIC_ORIGIN: "", PUBLIC_TRUSTED_PROXIES: "" });
  t.after(() => cli.child.kill());
  const port = await cli.ready;
  const setup = await (await fetch(`http://127.0.0.1:${port}/api/setup?origin=${encodeURIComponent(`http://127.0.0.1:${port}`)}`)).json();
  assert.deepEqual(setup, { problems: [], originAccepted: true });
  assert.doesNotMatch(cli.output(), /ignoriert/);
});

test("/api/setup urteilt wie die Schreibprüfung und lässt fremde Herkunft nicht zu", { skip }, async (t) => {
  const s = await stack(t);
  const accepted = async (origin) => (await (await fetch(`${s.publicRoot}/api/setup?origin=${encodeURIComponent(origin)}`)).json()).originAccepted;
  assert.equal(await accepted(s.origin), true);
  assert.equal(await accepted("https://evil.example"), false);
  assert.equal(await accepted(s.origin.replace("http:", "https:")), false);
  assert.equal(await accepted("null"), false);
  assert.equal((await (await fetch(`${s.publicRoot}/api/setup`)).json()).originAccepted, false);
});

async function noticeText(browser) {
  await browser.waitFor(`document.querySelector(".setup-notice")`, "Hinweis sichtbar");
  return browser.evaluate(`document.querySelector(".setup-notice").innerText`);
}

test("Browser: Fehlt PUBLIC_BASE_PATH, nennt die Seite den passenden Wert statt leer zu bleiben", { skip: browserSkip }, async (t) => {
  const s = await stack(t, { options: { publicBasePath: "" } });
  const browser = await openBrowser(t);
  await browser.navigate(`${s.publicRoot}/`);
  assert.match(await noticeText(browser), new RegExp(`PUBLIC_BASE_PATH=${PREFIX}`));

  // Ohne abschließenden Slash zeigen auch die relativen Verweise ins Leere: Dann greift der Hinweis im HTML.
  await browser.navigate(s.publicRoot);
  await browser.waitFor(`getComputedStyle(document.getElementById("boot-hint")).visibility === "visible"`, "Hinweis ohne JavaScript");
  assert.match(await browser.evaluate(`document.getElementById("boot-hint").innerText`), /PUBLIC_BASE_PATH/);
});

test("Browser: Fehlt PUBLIC_ORIGIN, kommt der Hinweis vor dem ersten fehlgeschlagenen Speichern", { skip: browserSkip }, async (t) => {
  const s = await stack(t, { publicOrigin: "" });
  const browser = await openBrowser(t);
  await browser.navigate(`${s.publicRoot}/`);
  assert.match(await noticeText(browser), new RegExp(`PUBLIC_ORIGIN=${s.origin}`));
  await browser.waitFor(`document.body.innerText.includes("home.greeting")`, "Lesen funktioniert weiter");
  const status = await browser.evaluate(`fetch(${JSON.stringify(`${PREFIX}/api/languages`)}, { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"code":"en","name":"Englisch"}' }).then((r) => r.status)`);
  assert.equal(status, 403, "Die Schreibprüfung bleibt wirksam");
});

test("Browser: Ungültiger Wert wird auf der Seite genannt", { skip: browserSkip }, async (t) => {
  const s = await stack(t, { prefix: "", publicOrigin: "https://tools.example.org/app", options: { lenientPublicConfig: true } });
  const browser = await openBrowser(t);
  await browser.navigate(`${s.origin}/`);
  const text = await noticeText(browser);
  assert.match(text, /PUBLIC_ORIGIN/);
  assert.match(text, /tools\.example\.org\/app/);
});

test("Browser: Im Root-Betrieb ohne Konfiguration erscheint kein Hinweis", { skip: browserSkip }, async (t) => {
  const { server } = createServer({ file: seededFile(), uiDir: UI_DIR });
  const port = await listen(server, { port: 0, tries: 0 });
  t.after(() => closeServer(server));
  const browser = await openBrowser(t);
  for (const p of ["/", "/index.html"]) {
    await browser.navigate(`http://127.0.0.1:${port}${p}`);
    await browser.waitFor(`document.body.innerText.includes("home.greeting")`, "App geladen");
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(await browser.evaluate(`document.querySelector(".setup-notice")`), null, p);
  }
  assert.deepEqual(browser.problems, []);
});

test("CLI: `export` wird von ungültiger Server-Konfiguration nicht berührt", { skip }, async () => {
  const cwd = tmp("localize-cli-");
  const file = seededFile();
  await new Promise((resolve, reject) => {
    execFile(process.execPath, [CLI, "export", "--format", "csv", "--file", file, "--out", "a.csv"], { cwd, env: { ...process.env, PUBLIC_BASE_PATH: "ungültig" } }, (err) => (err ? reject(err) : resolve()));
  });
  assert.match(fs.readFileSync(path.join(cwd, "a.csv"), "utf8"), /home\.greeting/);
});
