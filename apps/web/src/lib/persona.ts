import type { TripMemberProfile } from "@tc/contracts";

// In `lib` rather than beside `personasOf` in `components/pages/people.tsx`, so
// a lib module (the landing's snapshot types) can name it without an edge from
// `lib` to `components`, which closes a folder cycle (`pnpm arch`).

/**
 * What a person surface draws for one member (M38): the name to print, the
 * avatar they chose, the colour this trip shows them in — already clash-resolved
 * by the server (D3), so a chip renders it as given — and whether they are going,
 * which is what `trip.people` reads (`WidgetContext.personas`).
 */
export type Persona = { name: string; travelling: boolean } & Pick<TripMemberProfile, "avatar" | "color" | "colorShifted">;
