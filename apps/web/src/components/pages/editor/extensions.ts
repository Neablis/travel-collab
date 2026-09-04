import { getSchema, type Extensions } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { MacroNodeExtension } from "./MacroNodeExtension";

// The editor's extension set, in one place.
//
// It used to be an inline array literal inside `PageEditor`'s `useEditor` call,
// which was fine while nothing else needed to know what the editor understands.
// ADR-038 decision 4 needs exactly that: the guard's whole job is to compare a
// stored document's vocabulary against the editor's, and a guard built from a
// SECOND, hand-written list of node types would drift from the editor silently
// — in the one direction that loses pages (guard says yes, editor says no).
//
// Macro AUTHORING left the primary surface in M8 (seven macros is not a
// vocabulary; the block renderers never had a design pass). RENDERING stays
// registered on purpose: page content is stored ProseMirror JSON, so
// unregistering this extension would silently DROP existing macro nodes on the
// next save. The authoring vocabulary returns in M14.
export const PAGE_EDITOR_EXTENSIONS: Extensions = [StarterKit, MacroNodeExtension];

// Every node type the editor can mount AT A CONTENT POSITION, derived from the
// extension set above rather than listed (AGENTS.md invariant 5, and the drift
// argument above).
//
// `getSchema` is what TipTap itself calls when it builds an editor, so this is
// the same ProseMirror schema `useEditor` produces — read for its node names
// instead of mounted. Doing it this way costs no browser and no DOM, which is
// what lets the guard be a pure function that unit tests can drive.
//
// **The top node is excluded, and leaving it in was a real hole.** The guard
// compares against the types found INSIDE a document, and `doc` is the one type
// that can only ever be the document itself. A stored `{ type: "doc" }` nested
// in the content is not a parse error — `PageDoc` wraps it as an unknown node,
// and `collectPageDocNodeTypes` reports it by the type it wrapped, which is
// `"doc"`. With `doc` in this set that document reads as mountable, and TipTap
// discards the whole page: exactly the failure this module exists to catch,
// walking straight through it. Taken from `topNodeType` rather than by
// filtering the string "doc", so a schema with a different top node stays
// correct.
const schema = getSchema(PAGE_EDITOR_EXTENSIONS);

export const PAGE_EDITOR_NODE_TYPES: ReadonlySet<string> = new Set(
  Object.keys(schema.nodes).filter((name) => name !== schema.topNodeType.name),
);
