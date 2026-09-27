// **The web addresses the asker typed in the message being answered** — the
// only addresses the assistant may put into a `link.external` (ADR-057).
//
// ADR-056 kept both link widgets away from the assistant for one reason: *"a
// link is an address somebody chose, and the text the assistant reads — a
// stop's notes, a page — is where one it should not plant would come from."*
// That reason is about PROVENANCE, not about links. A trip is shared, so a stop
// note, a Playbook day and a notebook's title are all written by people other
// than the asker (prompt.ts); an address the model found in one of them and
// planted in a notebook is a prompt injection with a click at the end of it.
//
// So the guard is provenance too: the address must appear in the asker's own
// latest message. Nothing the model read can put one there, the asker typed it
// knowing it was going in, and the check is a set lookup at the one door
// (`insert_widget`) rather than a sentence the model is asked to obey. An
// earlier message does not count, so a thread cannot be primed with an address
// that a later, innocent-looking turn is talked into inserting.

/** What `insert_widget` asks before it lets a web address into a document. */
export interface TypedAddresses {
  /** Whether this address, canonicalised, is one the asker typed this turn. */
  has(href: string): boolean;
  /** Every address found, canonical, in the order typed — for a refusal to name. */
  list(): readonly string[];
}

// A candidate: an explicit http(s) address, a `www.` one, or a bare host with a
// dotted, lettered top-level name (`jreast.co.jp/e/pass`). Deliberately
// generous — a false positive is a string the ASKER typed, which is the whole
// of what the set means, so over-matching widens nothing an attacker controls.
const CANDIDATE =
  /\bhttps?:\/\/[^\s<>"'`]+|\bwww\.[^\s<>"'`]+|\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?:\/[^\s<>"'`]*)?/gi;

// Sentence punctuation that follows an address rather than belonging to it:
// "see https://example.com." ends in a full stop, not in a path.
const TRAILING = /[.,;:!?)\]}]+$/;

/**
 * One address as a browser would read it — `URL.href` — or null when it is not
 * an http(s) address with a host. A missing scheme reads as https, the way the
 * notebook's own address field treats `www.…`.
 */
export function canonicalAddress(raw: string): string | null {
  const trimmed = raw.trim().replace(TRAILING, "");
  if (trimmed === "") return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (!url.hostname.includes(".")) return null;
    return url.href;
  } catch {
    return null;
  }
}

/** The addresses in one message the asker wrote. */
export function typedAddressesIn(text: string): TypedAddresses {
  const found: string[] = [];
  for (const [candidate] of text.matchAll(CANDIDATE)) {
    const canonical = canonicalAddress(candidate);
    if (canonical !== null && !found.includes(canonical)) found.push(canonical);
  }
  return {
    has: (href) => {
      const canonical = canonicalAddress(href);
      return canonical !== null && found.includes(canonical);
    },
    list: () => [...found],
  };
}
