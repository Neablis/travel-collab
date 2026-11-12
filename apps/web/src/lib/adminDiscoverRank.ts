// The Discover rank tab's rows (M61 part 5), shared by the server read that
// produces them and the component that draws them, so neither imports the other.

/** One row of the operator's *Discover rank* tab: a ranked day and the parts of its score. */
export type DiscoverRankRow = {
  savedDayId: string;
  title: string;
  score: number;
  addsRecent: number;
  commentsRecent: number;
  quality: number;
  newDayLift: number;
  computedAt: string;
};
