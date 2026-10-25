// **Every fast-check property in this lane draws from one pinned seed**
// (KI-2026-10-14-c). Without it, each run drew fresh cases, and a witness floor
// counting a branch only some cases reach (`rolled.atLeast(8)`, `refused`,
// the weather table's six modes) sat on a count with a long low tail. The
// properties held on every case; the COUNT came up short about once a week, and
// `test / unit` went red on a PR that touched none of it: PR 552 at `10f7222`
// ran 6 rolled settlements against a floor of 8. A floor checked after
// `fc.assert` returns prints no seed, so nobody could replay it.
//
// Pinned, each property draws the same cases on every run and every machine,
// so a floor measured against this seed holds or fails for a reason. Change
// the seed, or a generator, and the counts move: re-measure the floors then.
//
// Exploring is still one variable away, and so is replaying:
//   FC_SEED=random  fresh seed per file, printed so a red can be replayed;
//   FC_SEED=<int>   that seed, e.g. the one a random run printed.
// A floor that trips under FC_SEED=random is the low tail, not a defect — the
// assertion failures fast-check reports inside a property are the defects.
//
// The same file in `apps/web`, `packages/domain`, `packages/pages` and
// `packages/contracts` (each lane's setupFiles), duplicated for the reason
// `witness.ts` is: a few dependency-free lines are not worth a package.
import fc from "fast-check";

export const FAST_CHECK_SEED = 20_261_024;

const requested = process.env.FC_SEED;
const seed =
  requested === "random"
    ? Math.floor(Math.random() * 0x7fffffff)
    : requested !== undefined && requested !== ""
      ? Number.parseInt(requested, 10)
      : FAST_CHECK_SEED;
if (!Number.isSafeInteger(seed)) throw new Error(`FC_SEED must be an integer or "random", got ${requested}`);
if (requested === "random") console.info(`fast-check seed ${seed} (replay with FC_SEED=${seed})`);

fc.configureGlobal({ ...fc.readConfigureGlobal(), seed });
