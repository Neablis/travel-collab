"use client";

import { useSyncExternalStore } from "react";
import type { PaletteCommandRef } from "@tc/contracts";
import { notebookEditingCommand } from "@/components/palette/commands";
import { findPaletteCommand, type PaletteCommand } from "@/components/palette/paletteRegistry";

// **The assistant's client actions are palette commands** (ADR-072 §1). A
// reply names a command by id; this looks it up among the commands the page
// has registered and calls that command's own `run`, the function ⌘K would
// call. There is no second dispatcher here: an id the page does not offer
// does nothing, and the reply says so (§5).

/** What a reply's commands came to: what to say under the answer, and what waits for Approve. */
export type PaletteRun = { notes: string[]; awaiting: PaletteCommandRef[] };

/** The words for what a command would do, for a note that says it did not. */
function what(id: string): string {
  const onView = /:view:(\w+)$/.exec(id)?.[1];
  if (id.startsWith("view:")) return `switch to ${id.slice("view:".length)}`;
  if (id.startsWith("go:trip:")) return onView === undefined ? "open that trip" : `open the trip on ${onView}`;
  if (id.startsWith("go:day:")) return "go to that day";
  if (id.startsWith("go:stop:")) return "go to that stop";
  if (id.startsWith("go:notebook:")) return "open that notebook";
  if (id === "people") return "open People";
  return "change this notebook's editing";
}

/** Whether running `id` takes the person off this page, rather than somewhere on it. */
function leavesPage(id: string): boolean {
  return id.startsWith("go:notebook:") || id.startsWith("go:trip:");
}

/**
 * Runs the navigation a reply named, in order, and hands back the commands
 * that wait for Approve (§4). `cardWaiting` is whether a proposal on this page
 * is still undecided: a card is not kept across leaving the page
 * (`askThreadStore` drops it), so a command that leaves becomes a note saying
 * what it would have done, and one that stays on the page still runs.
 */
export function runPaletteCommands(commands: readonly PaletteCommandRef[], cardWaiting: boolean): PaletteRun {
  const notes: string[] = [];
  const awaiting: PaletteCommandRef[] = [];
  for (const ref of commands) {
    if (ref.needsApproval) {
      awaiting.push(ref);
      continue;
    }
    const command = findPaletteCommand(ref.id);
    if (command === undefined) notes.push(`I couldn't ${what(ref.id)} from this page.`);
    else if (cardWaiting && leavesPage(ref.id)) notes.push(`I didn't ${what(ref.id)}, because the change above is waiting for you to approve it.`);
    else command.run();
  }
  return { notes, awaiting };
}

// The editing toggle is named for what it will do, so the label it carries
// while editing is on is how a card tells which way the page is. Read off the
// page's own builder rather than written out again here.
const TURNS_EDITING_OFF = notebookEditingCommand(true, () => {}).target?.label;

/**
 * Whether the page is already where a toggle was asked to go (`on`), so that
 * Approve would undo the request rather than carry it out. False for a
 * command that names no direction.
 */
export function alreadyThere(command: PaletteCommand, on: boolean | undefined): boolean {
  return on !== undefined && (command.target?.label === TURNS_EDITING_OFF) === on;
}

// **An Approve card's decision, kept beside the registry rather than on the
// turn.** The card is drawn by the transcript, which every surface mounts
// without a handler for it, and its command is often a toggle, so a card that
// forgot it had been approved (the rail closed and reopened) would offer the
// opposite of what was asked. Kept for the page's lifetime: a card restored
// after a reload finds no offer under its key and says it has expired.

/** Where an Approve card's command is. */
export type OfferStatus = "pending" | "ran" | "declined" | "unavailable";

const offers = new Map<string, OfferStatus>();
const listeners = new Set<() => void>();

function settle(key: string, status: OfferStatus) {
  offers.set(key, status);
  listeners.forEach((listener) => listener());
}

/** Opens an offer for a command that waits for Approve, and returns the key its card holds. */
export function offerPaletteCommand(): string {
  const key = crypto.randomUUID();
  offers.set(key, "pending");
  return key;
}

/** Where the offer under `key` is, or undefined for one this page never made. */
export function offerStatus(key: string): OfferStatus | undefined {
  return offers.get(key);
}

/** Approve runs the page's registered command once; Not now runs nothing. Either settles it. */
export function decideOffer(key: string, id: string, approve: boolean): void {
  if (offers.get(key) !== "pending") return;
  if (!approve) return settle(key, "declined");
  const command = findPaletteCommand(id);
  if (command === undefined) return settle(key, "unavailable");
  command.run();
  settle(key, "ran");
}

/** `offerStatus`, re-rendering when a decision lands. */
export function useOfferStatus(key: string): OfferStatus | undefined {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => offers.get(key),
    () => offers.get(key),
  );
}
