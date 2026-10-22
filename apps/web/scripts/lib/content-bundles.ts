// What both content importers read and the playbook days they write, kept
// apart from either so the landing's link test can ask the importer itself
// which days a preview holds (M51 part 7), not a model of it.

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolvePlaybook, type ContentBundleV1, type ResolvedPlaybook } from "@tc/fixtures";

/** `content/` at the repo root, which both importers read when no `--dir` is given. */
export const CONTENT_DIR = fileURLToPath(new URL("../../../../content/", import.meta.url));

/**
 * Every `*.json` under `dir`, at any depth, in a stable order — **skipping
 * dot-files and dot-directories.**
 *
 * That exclusion is not tidiness. `content/` is a working directory as well as
 * a source of truth: `scripts/geocode-content.py` writes its resume cache and
 * its review file there, and the moment it did, the importer tried to parse
 * `.geocode-review.json` as a bundle and the whole import refused. A stray
 * `.DS_Store.json` would have done the same. A tool's own scratch state living
 * beside the content it works on is normal; treating it as content is the bug.
 */
export function bundleFiles(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir).sort();
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    if (entry.startsWith(".")) return [];
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? bundleFiles(path) : path.endsWith(".json") ? [path] : [];
  });
}

/** A bundle's playbook days as the importer writes them, each under the id derived from `(bundle, key)`. */
export function contentDays(bundle: ContentBundleV1): ResolvedPlaybook[] {
  return bundle.playbooks.map((p) => resolvePlaybook(bundle.bundle.id, p, bundle.bundle.origin));
}
