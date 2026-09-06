// Installs ./ts-resolve.mjs as a resolve hook for the current process.
// Used as `node --import ./scripts/lib/ts-resolve-register.mjs script.ts`.
import { register } from "node:module";
register("./ts-resolve.mjs", import.meta.url);
