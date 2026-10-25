#!/usr/bin/env node
// prepublishOnly: Veröffentlicht wird nur aus dem Release-Workflow für den passenden Tag,
// damit jede npm-Version genau einem Git-Tag entspricht.
// Notfall: LOCALIZE_ME_LOCAL_PUBLISH=1 npm publish
import fs from "node:fs";

const { version } = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const env = process.env;

if (env.npm_config_dry_run === "true" || env.LOCALIZE_ME_LOCAL_PUBLISH === "1") process.exit(0);

if (env.GITHUB_ACTIONS !== "true") {
  console.error(`
  localize-me wird nicht von Hand veröffentlicht.
  Neue Version:  npm version patch | minor | major
  Das pusht Commit und Tag v<version>, GitHub Actions veröffentlicht dann auf npm.
`);
  process.exit(1);
}
if (env.GITHUB_REF_NAME !== `v${version}`) {
  console.error(`Tag ${env.GITHUB_REF_NAME} passt nicht zu package.json (${version}).`);
  process.exit(1);
}
