import { z } from "zod";
import type { MacroDef, WidgetContext } from "../registry-types";
import { inlineOf, text } from "../registry-types";
import { ok, empty, type MacroResult } from "../result";

const NoParams = z.object({}).strip();
type NoParams = z.infer<typeof NoParams>;

// The first account-scope widget, and the proof that `WidgetContext.user`
// actually arrives rather than merely being typed (ADR-037 open question 2:
// *"Account widgets are in scope now. Your name, your email, home airport and
// tier all become buildable"*).
//
// It takes no inputs: the account is not something you point a widget at, it is
// the scope the notebook is always in. So this inserts immediately, which is
// what `inputs: []` means (ADR-035 decision 2).
//
// **It renders the chosen name and nothing else — no fallback chain.** The app
// has one, `apps/web/src/lib/displayName.ts`, which ends at the provider name,
// then the email, then a derived handle; that file's whole point is that nobody
// writes a second copy of it. This widget does not want it, for a reason beyond
// package boundaries: a notebook page is a SHARED document, and a fallback that
// reaches an email address would print one into a page a collaborator can read.
// An unset name is "not set up" (ADR-037 decision 6) — legible, inert, and not a
// confident wrong answer.
export const accountName: MacroDef<NoParams, string> = {
  name: "account.name",
  kind: "inline",
  params: NoParams,
  inputs: [],
  description: "The name on your account.",
  emptyText: "no name set",
  resolve: ({ user }: WidgetContext): MacroResult<string> => {
    // `null` is "preferences did not load", `displayName: null` is "never set".
    // Both render the same thing, and neither guesses.
    const name = user?.displayName;
    return name == null || name.trim() === "" ? empty() : ok(name);
  },
  render: (value) => inlineOf(text(value)),
};

// Home airport, which M17 shipped as a real field (`UserPreferences.homeAirport`
// — a validated three-letter IATA code or null). It is the second thing ADR-037
// open question 2 names as unblocked, and it costs one more object because the
// context now carries the account.
export const accountHomeAirport: MacroDef<NoParams, string> = {
  name: "account.homeAirport",
  kind: "inline",
  params: NoParams,
  inputs: [],
  description: "Your home airport, as a three-letter code.",
  emptyText: "no home airport set",
  resolve: ({ user }: WidgetContext): MacroResult<string> => {
    const code = user?.homeAirport;
    return code == null || code === "" ? empty() : ok(code);
  },
  render: (value) => inlineOf(text(value)),
};
