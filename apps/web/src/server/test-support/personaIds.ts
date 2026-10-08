import { randomUUID } from "node:crypto";
import type { PersonColor } from "@tc/contracts";
import { defaultPersonColor } from "@tc/domain";

/**
 * A fresh user id whose default colour (`defaultPersonColor`) is none of
 * `taken` (M38 D3). For a test asserting a member who chose no colour shows
 * their default: with a random id, one run in a few would land on a colour
 * someone else holds and be shifted, and the expectation would flap.
 */
export function idAvoidingColors(prefix: string, taken: readonly PersonColor[]): string {
  for (;;) {
    const id = `${prefix}-${randomUUID()}`;
    if (!taken.includes(defaultPersonColor(id))) return id;
  }
}
