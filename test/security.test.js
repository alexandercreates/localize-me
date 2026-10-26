import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer, listen } from "../src/server.js";
import { Store, ValidationError } from "../src/store.js";
import { nativeFiles } from "../src/native.js";

const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "localize-sec-")), "localize.json");

async function start(options = {}) {
  const { server } = createServer({ file: tmpFile(), uiDir: null, ...options });
  const port = await listen(server, { port: 0, tries: 0 });
  return { server, base: `http://127.0.0.1:${port}`, port };
}

/** fetch() setzt den Host-Header selbst – für fremde Hosts daher direkt über http. */
async function request(port, { method = "GET", path: p = "/api/project", headers = {}, body } = {}) {
  const http = await import("node:http");
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method, path: p, headers }, (res) => {
      res.resume();
      res.on("end", () => resolve(res));
    });
    req.on("error", reject);
    req.end(body);
  });
}

test("Lokal werden fremde Hosts abgewiesen (DNS-Rebinding)", async (t) => {
  const { server, port } = await start();
  t.after(() => server.close());
  assert.equal((await request(port, { headers: { Host: "evil.example:4848" } })).statusCode, 421);
  assert.equal((await request(port, { headers: { Host: `localhost:${port}` } })).statusCode, 200);
  assert.equal((await request(port, { headers: { Host: `127.0.0.1:${port}` } })).statusCode, 200);
  assert.equal((await request(port, { headers: { Host: `[::1]:${port}` } })).statusCode, 200);
});

test("--allowed-host erlaubt weitere Hostnamen, z. B. hinter einem Reverse Proxy", async (t) => {
  const { server, port } = await start({ allowedHosts: ["texte.firma.intern"] });
  t.after(() => server.close());
  assert.equal((await request(port, { headers: { Host: "texte.firma.intern" } })).statusCode, 200);
  assert.equal((await request(port, { headers: { Host: "evil.example" } })).statusCode, 421);
});

test("Im Netzwerk (--host 0.0.0.0) ist jeder Host erlaubt", async (t) => {
  const { server, port } = await start({ host: "0.0.0.0" });
  t.after(() => server.close());
  assert.equal((await request(port, { headers: { Host: "localize.firma.intern" } })).statusCode, 200);
});

test("Schreibende Anfragen von fremden Seiten werden abgelehnt", async (t) => {
  const { server, base } = await start();
  t.after(() => server.close());
  const post = (headers) => fetch(`${base}/api/languages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ code: "en", name: "Englisch" }),
  });
  assert.equal((await post({ Origin: "https://evil.example" })).status, 403);
  assert.equal((await post({ "Sec-Fetch-Site": "cross-site" })).status, 403);
  assert.equal((await post({ "Sec-Fetch-Site": "same-site" })).status, 403);
  assert.equal((await post({ "Sec-Fetch-Site": "same-origin", Origin: base })).status, 201);
});

test("Antworten tragen Sicherheits-Header", async (t) => {
  const { server, base } = await start();
  t.after(() => server.close());
  const res = await fetch(`${base}/api/project`);
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.equal(res.headers.get("x-frame-options"), "DENY");
  assert.match(res.headers.get("content-security-policy"), /frame-ancestors 'none'/);
});

test("__proto__ als Key oder Sprache verändert keine fremden Objekte", () => {
  const store = new Store(tmpFile());
  store.addKey("a", { de: "x" }, { plural: true });
  store.addKey("b", { de: "y" });
  assert.throws(() => store.setValue("a", "__proto__", "kaputt", "other"), ValidationError);
  assert.throws(() => store.setValue("__proto__", "de", "kaputt"), ValidationError);
  assert.throws(() => store.setValue("constructor", "de", "kaputt"), ValidationError);
  assert.throws(() => store.addKey("__proto__", { de: "kaputt" }), ValidationError);
  assert.throws(() => store.renameKey("b", "__proto__"), ValidationError);
  store.addKey("c", { __proto__: null, de: "ok", "../x": "weg" });
  assert.deepEqual(store.project.keys.c, { de: "ok" });
  assert.equal({}.other, undefined);
  assert.equal({}.de, undefined);
});

test("Sprachcodes aus localize.json führen beim Export nicht aus dem Zielordner", () => {
  const file = tmpFile();
  fs.writeFileSync(file, JSON.stringify({ base: "de", languages: [{ code: "de" }, { code: "../../evil" }], keys: { a: { de: "x" } } }));
  const { project } = new Store(file);
  assert.throws(() => nativeFiles(project, "ios"), /Ungültige Sprachcodes/);
  assert.throws(() => nativeFiles(project, "android"), /Ungültige Sprachcodes/);
});
