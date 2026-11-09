// Refuses a production container build that does not know its public origin.
// Why, and what it checks: lib/public-origin-check.mjs. Run by
// `build:container` before `next build`.
import { checkPublicOrigin } from "./lib/public-origin-check.mjs";

const result = checkPublicOrigin(process.env);
if ("fail" in result) {
  console.error(result.fail);
  process.exit(1);
}
if ("warn" in result) console.warn(result.warn);
else console.log(result.ok);
