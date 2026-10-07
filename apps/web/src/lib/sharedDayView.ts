import type { SavedDay, SavedDayModeration, TripCover } from "@tc/contracts";
import type { PublicAuthor } from "./playbooks";

/**
 * Everything the shared-day screen reads, as one value: the day, whether the
 * reader wrote it, the author's public numbers, and the facts about this read.
 * The server page builds it in-process and the screen's own re-read builds it
 * from two API calls; both must produce this shape.
 */
export type SharedDayView = {
  day: SavedDay;
  isAuthor: boolean;
  author: PublicAuthor;
  pinning: boolean;
  publishedAt?: string | null;
  /** An operator hid it (KI-2026-09-23-i). Only ever non-null on the author's own read. */
  moderation: SavedDayModeration | null;
  /**
   * The cover its author picked (M37 part 5), or null. Beside the day rather
   * than on `SavedDay`, `publishedAt`'s way: `SavedDay` is the library's
   * content and every owner read, and this is one read's picture of it.
   */
  cover: TripCover | null;
};
