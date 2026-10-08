import { within, type ByRoleMatcher } from "@testing-library/react";

/**
 * The accessible names of every `role` element in `container`, in document
 * order — what a reader hears each one called.
 *
 * Not `textContent`: since M38 a person's pill leads with their `PersonChip`,
 * which is `aria-hidden` and may hold their initials, so the text reads
 * "AAlice" where the name is "Alice". Read through the query layer — the
 * `name` matcher is handed each candidate's computed name, in order — rather
 * than by walking nodes, which the test-quality wall forbids.
 */
export function accessibleNames(container: HTMLElement, role: ByRoleMatcher): string[] {
  const names: string[] = [];
  within(container).queryAllByRole(role, {
    name: (name) => {
      names.push(name);
      return true;
    },
  });
  return names;
}
