import path from "node:path";
import { NATIVE_PLATFORMS, nativeFiles, writeFiles } from "./native.js";
import { trackingFiles } from "./tracking.js";

// Welche Dateien localize-me erzeugt. Eine neue Dateiart braucht hier nur einen Eintrag:
// wo ihre Zielordner stehen und wie aus dem Projekt Dateien werden.
const KINDS = {
  localizable: {
    folders: (project) => project.output,
    files: (project, platform) => nativeFiles(project, platform),
  },
  tracking: {
    folders: (project) => project.output?.tracking,
    files: (project, platform) => trackingFiles(project, platform),
  },
};

export const FILE_KINDS = Object.keys(KINDS);

/** Alle in `output` eingetragenen Ziele als [{ kind, platform, dir }], relativ zu localize.json aufgelöst. */
export function exportTargets(project, file) {
  const base = path.dirname(path.resolve(file));
  return FILE_KINDS.flatMap((kind) => {
    const folders = KINDS[kind].folders(project) ?? {};
    return NATIVE_PLATFORMS
      .filter((platform) => typeof folders[platform] === "string" && folders[platform].trim())
      .map((platform) => ({ kind, platform, dir: path.resolve(base, folders[platform]) }));
  });
}

/**
 * Schreibt alle Ziele. Erst wenn jede Datei erzeugt werden konnte, wird die erste geschrieben –
 * ein Fehler im Tracking lässt die Texte also nicht halb exportiert zurück.
 * @returns {{kind: string, platform: string, file: string, changed: boolean}[]}
 */
export function writeTargets(project, targets) {
  const planned = targets.map((target) => ({ target, files: KINDS[target.kind].files(project, target.platform) }));
  return planned.flatMap(({ target, files }) =>
    writeFiles(files, target.dir).map((written) => ({ kind: target.kind, platform: target.platform, ...written })));
}
