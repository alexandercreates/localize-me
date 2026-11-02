import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer } from "../src/server.js";
import {
  ConfigError,
  normalizeBasePath,
  normalizePublicOrigin,
  parseTrustedProxies,
  publicConfigFromEnv,
  renderIndexHtml,
  resolvePublicConfig,
  resolveRedirect,
  withBasePath,
} from "../src/public-url.js";

test("PUBLIC_BASE_PATH: abschließende Slashes werden normalisiert, leer heißt Root", () => {
  for (const [input, expected] of [
    [undefined, ""], ["", ""], ["  ", ""], ["/", ""], ["///", ""],
    ["/app", "/app"], ["/app/", "/app"], ["/app///", "/app"], ["/tools/app/", "/tools/app"],
    ["/a.b_c~d-e", "/a.b_c~d-e"],
  ]) assert.equal(normalizeBasePath(input), expected, String(input));
});

test("PUBLIC_BASE_PATH: Ungültiges wird abgelehnt", () => {
  for (const input of ["app", "//evil.example", "/a//b", "/a/../b", "/..", "/a/.", "/a?b", "/a#b", "/a b", "/a%2Fb", "/a\\b", 'x"><script>', '/a"b', "https://x/y", 42]) {
    assert.throws(() => normalizeBasePath(input), ConfigError, String(input));
  }
});

test("PUBLIC_ORIGIN: wird normalisiert, Pfad und Wildcards werden abgelehnt", () => {
  assert.equal(normalizePublicOrigin(""), "");
  assert.equal(normalizePublicOrigin("https://Tools.Example.org"), "https://tools.example.org");
  assert.equal(normalizePublicOrigin("https://tools.example.org/"), "https://tools.example.org");
  assert.equal(normalizePublicOrigin("https://tools.example.org:443/"), "https://tools.example.org");
  assert.equal(normalizePublicOrigin("http://tools.example.org:8443"), "http://tools.example.org:8443");
  for (const input of ["tools.example.org", "//tools.example.org", "ftp://x", "https://x/app", "https://x/?a", "https://x/#a", "https://u:p@x", "https://*.example.org", "https:x", "javascript:alert(1)"]) {
    assert.throws(() => normalizePublicOrigin(input), ConfigError, input);
  }
});

test("Vertrauensgrenze: nur IP/CIDR, Vergleich über die direkte Gegenstelle", () => {
  for (const input of ["*", "proxy.intern", "10.0.0.0/33", "::1/129", "10.0.0.1/8/8", "10.0.0.0/x"]) {
    assert.throws(() => parseTrustedProxies(input), ConfigError, input);
  }
  const config = resolvePublicConfig({ trustedProxies: "127.0.0.1, 10.0.0.0/8,fd00::/8" });
  for (const ip of ["127.0.0.1", "::ffff:127.0.0.1", "10.2.3.4", "fd00::1"]) assert.equal(config.isTrustedPeer(ip), true, ip);
  for (const ip of ["127.0.0.2", "11.0.0.1", "fe80::1", "", undefined]) assert.equal(config.isTrustedPeer(ip), false, String(ip));
  assert.equal(resolvePublicConfig().isTrustedPeer("127.0.0.1"), false);
  assert.equal(resolvePublicConfig({ trustedProxies: ["127.0.0.1"] }).isTrustedPeer("127.0.0.1"), true);
});

test("createServer: ungültige Konfiguration bricht ab, bevor eine Datei entsteht", () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "localize-cfg-")), "localize.json");
  assert.throws(() => createServer({ file, uiDir: null, publicBasePath: "kein-pfad" }), ConfigError);
  assert.throws(() => createServer({ file, uiDir: null, publicOrigin: "https://x/app" }), ConfigError);
  assert.throws(() => createServer({ file, uiDir: null, trustedProxies: "*" }), ConfigError);
  assert.equal(fs.existsSync(file), false);
});

test("createServer mit lenientPublicConfig: startet auf der sicheren Seite und meldet das Problem", (t) => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "localize-cfg-")), "localize.json");
  const { server, publicConfig } = createServer({ file, uiDir: null, lenientPublicConfig: true, publicBasePath: "kaputt", publicOrigin: "https://x/app", trustedProxies: "*" });
  t.after(() => server.close());
  assert.equal(publicConfig.basePath, "");
  assert.equal(publicConfig.origin, "");
  assert.deepEqual(publicConfig.trustedProxies, []);
  assert.equal(publicConfig.isTrustedPeer("127.0.0.1"), false);
  assert.deepEqual(publicConfig.problems.map((p) => p.variable).sort(), ["PUBLIC_BASE_PATH", "PUBLIC_ORIGIN", "PUBLIC_TRUSTED_PROXIES"]);
  assert.deepEqual(resolvePublicConfig({}, { lenient: true }).problems, []);
});

test("publicConfigFromEnv liest genau die dokumentierten Variablen", () => {
  assert.deepEqual(publicConfigFromEnv({ PUBLIC_BASE_PATH: "/a", PUBLIC_ORIGIN: "https://x", PUBLIC_TRUSTED_PROXIES: "10.0.0.1", OTHER: "y" }), {
    publicBasePath: "/a", publicOrigin: "https://x", trustedProxies: "10.0.0.1",
  });
});

test("withBasePath: Präfix genau einmal und nur an Segmentgrenzen", () => {
  assert.equal(withBasePath("/x", ""), "/x");
  assert.equal(withBasePath("/", "/app"), "/app/");
  assert.equal(withBasePath("/x", "/app"), "/app/x");
  assert.equal(withBasePath("/app", "/app"), "/app/");
  assert.equal(withBasePath("/app/x", "/app"), "/app/x");
  assert.equal(withBasePath("/app-2/x", "/app"), "/app/app-2/x");
  assert.equal(withBasePath("/application", "/app"), "/app/application");
});

test("resolveRedirect: wird nie zu einem protokollrelativen Ziel auf einen fremden Host", () => {
  for (const basePath of ["", "/app"]) {
    for (const target of ["/a/..//evil.example/x", "/.//evil.example/x", "http://h:1//evil.example/x", "/%2e%2e//evil.example/x"]) {
      const location = resolveRedirect(target, { basePath, internal: ["http://h:1"] });
      assert.equal(location, `${basePath}/evil.example/x`, target);
    }
  }
});

test("resolveRedirect: Steuerzeichen und Müll werden abgewiesen", () => {
  for (const target of ["", " /x", "/x ", "/x\r\nSet-Cookie: a=b", "\thttps://evil.example", "/\tx", "http://", undefined]) {
    assert.throws(() => resolveRedirect(target, {}), /Redirect-Ziel/, JSON.stringify(target));
  }
});

test("renderIndexHtml: Präfix nur im HTML, Root ohne Meta-Angabe", () => {
  const html = '<head>\n<link rel="icon" href="./favicon.svg"><script src="./assets/a.js"></script><a href="https://x/./y"></a></head>';
  assert.equal(renderIndexHtml(html, ""), html);
  const prefixed = renderIndexHtml(html, "/app");
  assert.match(prefixed, /<meta name="localize-me-base-path" content="\/app">/);
  assert.match(prefixed, /href="\/app\/favicon\.svg"/);
  assert.match(prefixed, /src="\/app\/assets\/a\.js"/);
  assert.match(prefixed, /href="https:\/\/x\/\.\/y"/);
});
