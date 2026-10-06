// **The Library tab's notebook shape** (M36 link 5), on the UI side of the lint
// wall — `adminOverview.ts`'s pattern and its reason: components may not reach
// `@/server/*`, so the shape is restated here and pinned to
// `server/savedNotebooks.ts` by the compile-time identity check in
// `adminWireShape.test.ts`. A field added on one side only fails `tsc`.
//
// No share count, no trips-started count and no page count (M36 D5): nothing
// records the first two, and a saved notebook is one page.

/** Mirrors `AdminNotebookRow`. */
export interface AdminNotebookRow {
  savedNotebookId: string;
  title: string;
  ownerId: string;
  ownerEmail: string | null;
  savedAt: string;
}

/** Mirrors `AdminNotebooksReport`. */
export interface AdminNotebooksReport {
  windowDays: number;
  saved: number;
  savedInWindow: number;
  recent: AdminNotebookRow[];
}
