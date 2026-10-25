#!/usr/bin/env node
// Entwicklung der Oberfläche: startet den API-Server mit example/localize.json
// und davor Vite mit Hot Reload. Aufrufe an /api leitet Vite an den Server weiter.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createApi, listen } from "../src/server.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = path.join(root, "example", "localize.json");

const { server } = createApi({ file, uiDir: null });
const port = await listen(server, { port: 4848 });
process.env.LOCALIZE_ME_API = `http://127.0.0.1:${port}`;

const { createServer } = await import("vite");
const vite = await createServer({ configFile: path.join(root, "vite.config.js"), server: { open: true } });
await vite.listen();
console.log(`\n  API:  http://127.0.0.1:${port}  (Texte: example/localize.json)`);
vite.printUrls();

const stop = async () => { await vite.close(); server.close(); process.exit(0); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
