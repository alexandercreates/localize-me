#!/usr/bin/env node
// Trägt nach `npm i localize-me` ein Start-Skript in die package.json des Projekts ein.
// - Gibt es noch kein "dev"-Skript, wird "dev": "localize-me" gesetzt  →  npm run dev
// - Gibt es schon ein "dev"-Skript, wird stattdessen "localize": "localize-me" gesetzt  →  npm run localize
// Bestehende Skripte werden nie überschrieben. Fehler hier brechen die Installation nie ab.
import { addScripts } from "../src/project.js";

try {
  if (process.env.LOCALIZE_ME_SKIP_POSTINSTALL) process.exit(0);
  if (process.env.npm_config_global === "true") process.exit(0);

  // npm_config_local_prefix ist das Projekt, in das npm installiert (auch aus Unterordnern heraus).
  const projectDir = process.env.npm_config_local_prefix || process.env.INIT_CWD;
  if (!projectDir) process.exit(0);

  const result = addScripts(projectDir, { create: true });
  if (result.added) {
    console.log(`\n  localize-me: Skript hinzugefügt → npm run ${result.script}\n`);
  }
} catch {
  // Absichtlich still: Ein fehlgeschlagener Komfort-Schritt darf die Installation nicht stören.
}
