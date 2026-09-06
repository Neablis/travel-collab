// An ESM resolve hook that lets a plain `node scripts/foo.ts` import the app's
// server modules.
//
// `apps/web/src/**` writes relative imports WITHOUT extensions ("./db/client"),
// because Next's bundler resolves them. Node's own resolver does not, so a
// script importing anything under src/server dies on the first hop with
// ERR_MODULE_NOT_FOUND. The alternatives were rewriting several hundred imports
// across the app, or running production code through a test runner; this is
// twenty lines and leaves app source alone.
//
// Also resolves the "@/..." alias, for the same reason and to the same place
// tsconfig points it.
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve as resolvePath } from "node:path";

const SRC = fileURLToPath(new URL("../../src/", import.meta.url));
const CANDIDATES = [".ts", ".tsx", "/index.ts", "/index.tsx"];

export async function resolve(specifier, context, nextResolve) {
  let target = null;
  if (specifier.startsWith("@/")) {
    target = resolvePath(SRC, specifier.slice(2));
  } else if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
    target = resolvePath(dirname(fileURLToPath(context.parentURL)), specifier);
  }
  if (target) {
    for (const ext of CANDIDATES) {
      if (existsSync(target + ext)) {
        return nextResolve(pathToFileURL(target + ext).href, context);
      }
    }
  }
  return nextResolve(specifier, context);
}
