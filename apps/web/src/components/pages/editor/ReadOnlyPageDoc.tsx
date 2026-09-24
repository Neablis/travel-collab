"use client";
import { Fragment, type ReactNode } from "react";
import type {
  PageDoc,
  PageInlineNode,
  PageListContentNode,
  PageNode,
} from "@tc/contracts";
import { getMacro, repeatLabel, repeatOver } from "@tc/pages";

// The read half of ADR-038 decision 4: what a page looks like when this build
// is not allowed to mount an editor over it.
//
// "Opens read-only" has to mean the reader can still SEE their notebook. A
// banner over an empty canvas would reproduce, in the UI, exactly the anxiety
// the ADR is about — a page that looks like it lost everything. So this walks
// the parsed `PageDoc` and renders it without TipTap, which is the only way to
// render it at all: TipTap is the thing that cannot cope with the document.
//
// It is deliberately NOT a second editor. No node views, no macro resolution,
// no marks beyond what the text already carries — a widget renders as what a
// person calls it (`title`), because resolving one needs `MacroEditorContext`
// and a live trip, and a read-only fallback that can fail is not a fallback.
// It printed the STORED name (`day.detail`) until the M14 syntax guard
// (`noRawSyntax.test.tsx`) found it: stored identifiers are never shown. The nodes
// this build has no definition for render as decision 3's inert placeholder.
//
// It shares `.tc-page-editor` with the editor on purpose: the same typography
// rules apply, so a read-only page looks like the page rather than like an
// error state.

const PLACEHOLDER_LABEL = "Something newer is here";

// A node the editor's schema has no definition for — either a genuinely
// unrecognised type (decision 3's `unknown`) or a known-to-us type with no
// extension behind it, which is the `repeat` case that made this necessary.
function Placeholder({ label }: { label: string }) {
  return (
    <p className="my-2 rounded border border-dashed border-border-strong px-2 py-1 text-sm text-slate">
      {PLACEHOLDER_LABEL} <span className="opacity-70">({label})</span>
    </p>
  );
}

function unknownLabel(raw: unknown): string {
  return typeof raw === "object" && raw !== null && typeof (raw as { type?: unknown }).type === "string"
    ? (raw as { type: string }).type
    : "unrecognised";
}

function InlineNodes({ nodes }: { nodes: readonly PageInlineNode[] }) {
  return (
    <>
      {nodes.map((node, i) => (
        <Fragment key={i}>{renderInline(node)}</Fragment>
      ))}
    </>
  );
}

function renderInline(node: PageInlineNode): ReactNode {
  switch (node.type) {
    case "text":
      return node.text;
    case "hardBreak":
      return <br />;
    case "macro":
      // A name this build does not register gets the same words the unknown
      // node below does, not its identifier.
      return <span className="rounded bg-moss px-1 text-sm">{getMacro(node.attrs.name)?.title ?? PLACEHOLDER_LABEL}</span>;
    case "unknown":
      return <span className="text-sm text-slate">[{PLACEHOLDER_LABEL}]</span>;
    default: {
      // `ReactNode` admits `undefined` and the repo does not set
      // `noImplicitReturns`, so a node type with no case would render as
      // nothing and still compile. This line makes it fail to compile
      // (KI-2026-09-05-h), the same as `BlockView`.
      const exhaustive: never = node;
      return exhaustive;
    }
  }
}

function ListItems({ nodes }: { nodes: readonly PageListContentNode[] }) {
  return (
    <>
      {nodes.map((node, i) =>
        node.type === "unknown" ? (
          <li key={i}>
            <Placeholder label={unknownLabel(node.raw)} />
          </li>
        ) : (
          <li key={i}>
            <Blocks nodes={node.content} />
          </li>
        ),
      )}
    </>
  );
}

function Blocks({ nodes }: { nodes: readonly PageNode[] }) {
  return (
    <>
      {nodes.map((node, i) => (
        <Fragment key={i}>{renderBlock(node)}</Fragment>
      ))}
    </>
  );
}

function renderBlock(node: PageNode): ReactNode {
  switch (node.type) {
    case "paragraph":
      return (
        <p>
          <InlineNodes nodes={node.content} />
        </p>
      );
    case "heading": {
      // `h1`…`h6` by level. A switch rather than `` `h${level}` `` because the
      // levels are a closed set in the contract and a computed tag name would
      // hide a widening of it from the type checker.
      const Tag = (["h1", "h2", "h3", "h4", "h5", "h6"] as const)[node.attrs.level - 1] ?? "h6";
      return (
        <Tag>
          <InlineNodes nodes={node.content} />
        </Tag>
      );
    }
    case "macro":
      return <p>{renderInline(node)}</p>;
    // An authored repeat, unresolved like every widget here: what it repeats
    // over, then its template once. It printed the STORED name (`day.rows`)
    // while no editor could mount one; that is raw syntax on the screen.
    case "repeat": {
      const over = repeatOver(node.attrs.name);
      return (
        <div className="my-2 rounded border border-dashed border-border-strong px-2 py-1">
          <p className="text-sm text-slate">{over ? repeatLabel(over, null) : PLACEHOLDER_LABEL}</p>
          <p>
            <InlineNodes nodes={node.content} />
          </p>
        </div>
      );
    }
    case "blockquote":
      return (
        <blockquote>
          <Blocks nodes={node.content} />
        </blockquote>
      );
    case "bulletList":
      return (
        <ul>
          <ListItems nodes={node.content} />
        </ul>
      );
    case "orderedList":
      return (
        <ol start={node.attrs.start}>
          <ListItems nodes={node.content} />
        </ol>
      );
    case "codeBlock":
      return (
        <pre>
          <code>{node.content.map((child) => (child.type === "text" ? child.text : "")).join("")}</code>
        </pre>
      );
    case "horizontalRule":
      return <hr />;
    case "unknown":
      return <Placeholder label={unknownLabel(node.raw)} />;
    default: {
      // As in `renderInline`: a new `PageNode` member fails to compile here
      // rather than rendering blank.
      const exhaustive: never = node;
      return exhaustive;
    }
  }
}

export function ReadOnlyPageDoc({ doc }: { doc: PageDoc }) {
  return (
    <div className="tc-page-editor" data-testid="read-only-page">
      <Blocks nodes={doc.content} />
    </div>
  );
}
