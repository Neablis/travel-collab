// MapLibre v6 loads its tile-decoding worker as a SEPARATE module worker,
// where v5 inlined it as a blob. It resolves that worker at runtime with
//
//   new URL(`./${isDev ? "maplibre-gl-worker-dev" : "maplibre-gl-worker"}.mjs`, import.meta.url)
//
// — both the filename and the base are variables, so no bundler can rewrite
// it statically. That helper also bails to an EMPTY string unless
// `import.meta.url` is an http(s) url, which after bundling it is not: prod
// therefore called `new Worker("")`, the empty specifier resolved against the
// document, and the browser was handed the PAGE HTML as a module script and
// refused it on MIME type. (Observed on prod as a second GET of the page
// itself, and reproduced here by removing the fix: no request for a worker
// script is made at all.) The map then rendered its chrome over a basemap
// that never decoded a tile (bump #158, 5.24.0 -> 6.x).
//
// Turbopack does emit the worker, content-hashed under
// `_next/static/immutable/media/`, but that copy is no use as a target
// either — see below.
//
// Pointing `setWorkerUrl` at Turbopack's emitted copy does NOT work:
// it is copied as a raw asset with its own `import "./maplibre-gl-shared.mjs"`
// left unrewritten, and only the HASHED sibling sits beside it. The worker and
// its shared chunk have to travel together under their ORIGINAL names, which
// is what this script arranges and why it copies two files rather than one.
//
// Copied from node_modules at build time rather than committed, so the shipped
// worker can never drift from the installed maplibre-gl version.
import { createRequire } from "node:module";
import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Keep in sync with MAPLIBRE_WORKER_URL in src/components/lenses/MapLens.tsx.
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "maplibre");

// maplibre-gl-worker.mjs imports maplibre-gl-shared.mjs by relative path, so
// both names must land in the same directory, unchanged.
const FILES = ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"];

const require = createRequire(import.meta.url);
const distDir = dirname(require.resolve("maplibre-gl/dist/maplibre-gl.mjs"));

await mkdir(OUT_DIR, { recursive: true });
for (const file of FILES) {
  await copyFile(join(distDir, file), join(OUT_DIR, file));
}
console.log(`[maplibre] copied ${FILES.length} worker files from ${distDir} -> ${OUT_DIR}`);
