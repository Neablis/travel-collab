import type { FullResult, Reporter, TestCase, TestResult } from "@playwright/test/reporter";

/**
 * Prints, after a failing LOCAL run, the one thing the failure output does not
 * say for itself: which lane produced it, and that this lane is not the one a
 * result may be reported from.
 *
 * Registered only when `process.env.CI` is unset (see `playwright.config.ts`),
 * because in CI the lane *is* authoritative and this would be noise.
 *
 * Why a reporter rather than another paragraph in the guidelines: KI-27 and
 * `docs/guidelines/quality-enforcement.md` already carried this rule, in
 * detail, before the mistake it describes was made a second time (2026-08-26,
 * PR #55 — a dev-lane failure investigated for a day and then reported to
 * Mitchell as a hardware problem, when `test:e2e:ci-like` passed the same spec
 * in 17.9s). Prose that has to be read at exactly the right moment is not a
 * control. The failing output is the one thing that is always read, so the
 * warning belongs there.
 */
class LaneReporter implements Reporter {
  private failed = 0;
  private timedOut = 0;

  onTestEnd(_test: TestCase, result: TestResult): void {
    if (result.status === "failed") this.failed += 1;
    if (result.status === "timedOut") {
      this.failed += 1;
      this.timedOut += 1;
    }
  }

  onEnd(_result: FullResult): void {
    if (this.failed === 0) return;

    const rule = "─".repeat(72);
    const lines = [
      "",
      rule,
      `  ${this.failed} failing test${this.failed === 1 ? "" : "s"} — from the DEV-SERVER lane (\`pnpm dev\`).`,
      "",
      "  This is not yet a real failure. `next dev` compiles each route on its",
      "  first hit, so a cold compile can spend a test's whole budget before the",
      "  test does anything interesting (KI-27, measured at 3.8s cold / 0.2s warm).",
      "",
      "  Re-run in the lane CI uses before believing this, reporting it, or",
      "  updating a PR:",
      "",
      "      pnpm --filter web test:e2e:ci-like",
      "",
      "  Telling the two apart: a failure whose LOCATION MOVES between runs is",
      "  the lane. A real defect fails in the same place every time.",
      rule,
      "",
    ];

    if (this.timedOut > 0) {
      lines.splice(
        lines.length - 2,
        0,
        `  (${this.timedOut} of these ${this.timedOut === 1 ? "was a" : "were"} timeout${this.timedOut === 1 ? "" : "s"} — the signature above applies directly.)`,
      );
    }

    process.stdout.write(lines.join("\n"));
  }
}

export default LaneReporter;
