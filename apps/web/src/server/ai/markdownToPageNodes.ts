// A deliberately SMALL markdown reader, for `insert_text` (ADR-035 decision 5).
//
// ADR-035 says the tool takes markdown. It does not say "all of it", and a full
// parser here would be a second document format living beside `PageDoc` — the
// exact duplication invariant 5 exists to stop. So this reads the subset a page
// of prose actually needs and is explicit about the edge:
//
//   `#`..`######`   headings
//   `- ` / `* `     bullet lists
//   `1. `           ordered lists
//   anything else   a paragraph, verbatim
//
// **Inline marks are NOT parsed**, and that is a decision rather than an
// omission. `**bold**` inserts the asterisks as text. Half-parsing marks is how
// a page ends up with a literal `**` in one place and bold in another, and the
// AST already refuses to carry a mark the editor cannot produce. When marks are
// wanted they belong in the vocabulary first, not in this reader.
//
// A blank line separates blocks. Consecutive list lines join into ONE list,
// because that is what a reader means by a list — emitting one list per line
// would render as N single-item lists, which looks like a bug and is one.
import type {
  PageBulletListNode,
  PageHeadingNode,
  PageListItemNode,
  PageNode,
  PageOrderedListNode,
  PageParagraphNode,
} from "@tc/contracts";

const HEADING = /^(#{1,6})\s+(.*)$/;
const BULLET = /^\s*[-*]\s+(.*)$/;
const ORDERED = /^\s*(\d+)[.)]\s+(.*)$/;

const para = (text: string): PageParagraphNode => ({
  type: "paragraph",
  content: text === "" ? [] : [{ type: "text", text }],
});

const item = (text: string): PageListItemNode => ({ type: "listItem", content: [para(text)] });

export function markdownToPageNodes(markdown: string): PageNode[] {
  const nodes: PageNode[] = [];
  // Buffers for the two things that span lines: a paragraph's wrapped lines and
  // a run of list items.
  let paragraph: string[] = [];
  let bullets: PageListItemNode[] = [];
  let ordered: PageListItemNode[] = [];
  let orderedStart = 1;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    nodes.push(para(paragraph.join(" ").trim()));
    paragraph = [];
  };
  const flushBullets = () => {
    if (bullets.length === 0) return;
    nodes.push({ type: "bulletList", content: bullets } satisfies PageBulletListNode);
    bullets = [];
  };
  const flushOrdered = () => {
    if (ordered.length === 0) return;
    // `type: null` is what the editor writes for a plain ordered list; `start`
    // honours the first number the author used, so "3. …" starts at three.
    nodes.push({ type: "orderedList", attrs: { start: orderedStart, type: null }, content: ordered } satisfies PageOrderedListNode);
    ordered = [];
    orderedStart = 1;
  };
  const flushAll = () => {
    flushParagraph();
    flushBullets();
    flushOrdered();
  };

  for (const raw of markdown.split("\n")) {
    const line = raw.trimEnd();

    if (line.trim() === "") {
      flushAll();
      continue;
    }

    const headingMatch = HEADING.exec(line);
    if (headingMatch) {
      flushAll();
      const level = headingMatch[1]!.length as PageHeadingNode["attrs"]["level"];
      const text = headingMatch[2]!.trim();
      nodes.push({ type: "heading", attrs: { level }, content: text === "" ? [] : [{ type: "text", text }] });
      continue;
    }

    const bulletMatch = BULLET.exec(line);
    if (bulletMatch) {
      // A list interrupts a paragraph and the other list kind, but not itself.
      flushParagraph();
      flushOrdered();
      bullets.push(item(bulletMatch[1]!.trim()));
      continue;
    }

    const orderedMatch = ORDERED.exec(line);
    if (orderedMatch) {
      flushParagraph();
      flushBullets();
      if (ordered.length === 0) orderedStart = Number(orderedMatch[1]);
      ordered.push(item(orderedMatch[2]!.trim()));
      continue;
    }

    // A plain line. It joins the paragraph being built rather than starting a
    // new one: markdown treats a single newline as a soft wrap, and a page that
    // broke every wrapped line into its own paragraph would reflow someone's
    // prose into confetti.
    flushBullets();
    flushOrdered();
    paragraph.push(line.trim());
  }

  flushAll();
  return nodes;
}
