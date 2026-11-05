"use client";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { Check } from "lucide-react";
import { FORMER_MEMBER, formatShortDate, type PollPayload, type PollResults } from "@tc/pages";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { closePoll, fetchPoll, reopenPoll, votePoll, type ApiResult } from "@/lib/apiClient";
import { cn } from "@/lib/cn";
import { usePersonas } from "../people";

// "Poll" (M58 decision 8): a question and its options, for the people going.
//
// **Three readers, one card.** A member's is live: it reads the poll route,
// shows who picked what and who has not voted, and each option is a button that
// votes (a vote can be changed until the poll closes). A stranger's, and the
// author's while editing, is static (`interactive` false): the payload's counts
// and no control, no read of the votes. A stranger's payload has no poll id and
// no `counts` for the live path to use, so there is nothing here to send a vote
// to even if a control were drawn.
//
// Spans rather than `<div>`s, `TripStripBlock`'s reason: a widget node is an
// inline atom and renders inside a paragraph.

const SECTION_LEVEL = 2;

/** A poll: the question, the options with their counts, and for a member the way to vote. */
export function PollBlock({ payload, tripId, interactive = true }: { payload: PollPayload; tripId: string; interactive?: boolean }) {
  if (!interactive || payload.pollId === null) return <PollCard payload={payload} results={null} />;
  return <LivePoll payload={payload} pollId={payload.pollId} tripId={tripId} />;
}

function LivePoll({ payload, pollId, tripId }: { payload: PollPayload; pollId: string; tripId: string }) {
  const [results, setResults] = useState<PollResults | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // What a screen reader is told after a close or a reopen: the card's text
  // changes, but a change nobody is looking at is not announced by itself.
  const [announcement, setAnnouncement] = useState("");
  // Close and Reopen swap one button for the other, so the pressed one unmounts
  // and focus would drop to the page; the heading stays and takes it instead.
  const headingRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchPoll(tripId, pollId).then((r) => {
      if (cancelled) return;
      if (r.ok) setResults(r.value);
      else setProblem("The votes couldn't be loaded.");
    });
    return () => {
      cancelled = true;
    };
  }, [tripId, pollId]);

  const settle = useCallback(async (call: Promise<ApiResult<PollResults>>, announce = "") => {
    const r = await call;
    if (r.ok) {
      setResults(r.value);
      setProblem(null);
      setAnnouncement(announce);
      if (announce !== "") headingRef.current?.focus();
    } else if (r.error.code === "poll-closed" || r.error.code === "poll-date-passed") {
      // Closed, or its date passed, under this reader's feet: read it again so the card says so.
      const again = await fetchPoll(tripId, pollId);
      if (again.ok) setResults(again.value);
      setProblem(r.error.code === "poll-closed" ? "This poll just closed." : r.error.message);
    } else {
      setProblem(r.error.message);
    }
  }, [tripId, pollId]);

  const vote = (optionId: string) => {
    if (results === null) return;
    const mine = results.mine;
    // One pick replaces; on a multiple poll a tap toggles, and the last pick stays (a vote has at least one).
    const next = !payload.multi ? [optionId] : mine.includes(optionId) ? mine.filter((id) => id !== optionId) : [...mine, optionId];
    if (next.length === 0) return;
    void settle(votePoll(tripId, pollId, next));
  };
  const close = () => void settle(closePoll(tripId, pollId), "You closed the poll.");
  const reopen = () => void settle(reopenPoll(tripId, pollId), "You reopened the poll.");
  const mayClose = results?.canClose === true;

  return (
    <PollCard
      payload={payload}
      results={results}
      onVote={vote}
      onClose={mayClose ? close : undefined}
      onReopen={mayClose ? reopen : undefined}
      problem={problem}
      announcement={announcement}
      headingRef={headingRef}
    />
  );
}

function PollCard({ payload, results, onVote, onClose, onReopen, problem = null, announcement = "", headingRef }: {
  payload: PollPayload;
  /** A member's live read; `null` for the static card. */
  results: PollResults | null;
  onVote?: (optionId: string) => void;
  onClose?: () => void;
  onReopen?: () => void;
  problem?: string | null;
  announcement?: string;
  headingRef?: RefObject<HTMLSpanElement | null>;
}) {
  const personas = usePersonas();
  const counts = results?.counts ?? payload.counts;
  const closed = results?.closed ?? payload.closed ?? false;
  const total = payload.options.reduce((sum, o) => sum + (counts?.[o.id] ?? 0), 0);
  const nameOf = (userId: string) => personas?.[userId]?.name ?? FORMER_MEMBER;
  const votersOf = (optionId: string) => (results?.votes ?? []).filter((v) => v.optionIds.includes(optionId)).map((v) => nameOf(v.userId));
  const voted = new Set((results?.votes ?? []).map((v) => v.userId));
  const waiting = results === null || personas === null ? [] : Object.keys(personas).filter((id) => !voted.has(id)).map(nameOf);
  const canVote = onVote !== undefined && results !== null && !closed;
  const closes = payload.closesAt === null ? null : formatShortDate(payload.closesAt);

  return (
    <span role="group" aria-label={payload.question} aria-busy={onVote !== undefined && results === null ? true : undefined} className="my-1 flex w-full flex-col gap-3 rounded-md border border-hairline bg-surface p-3 text-left">
      <span ref={headingRef} tabIndex={-1} role="heading" aria-level={SECTION_LEVEL} className="text-sm font-semibold text-ink">
        {payload.question}
      </span>
      <span role="list" className="flex flex-col gap-2">
        {payload.options.map((option) => {
          const count = counts?.[option.id] ?? null;
          const mine = results?.mine.includes(option.id) === true;
          const voters = votersOf(option.id);
          const body = (
            <>
              <span className="flex w-full items-baseline justify-between gap-3">
                <span className="flex items-center gap-1.5 text-sm text-ink">
                  {mine && <Check aria-hidden className="size-4 shrink-0 text-brand" />}
                  <span>{option.label}</span>
                </span>
                {count !== null && <span className="text-sm font-medium text-ink">{count}</span>}
              </span>
              {count !== null && (
                <span aria-hidden className="block h-1.5 w-full overflow-hidden rounded-full bg-moss">
                  {/* eslint-disable-next-line no-restricted-syntax -- a bar's length is the vote share: data, not a style a token could name (`budget-meter`'s fill) */}
                  <span className="block h-full rounded-full bg-brand" style={{ width: `${total === 0 ? 0 : Math.round((count / total) * 100)}%` }} />
                </span>
              )}
              {voters.length > 0 && <span className="text-xs text-slate">{voters.map((name) => <span key={name} className="mr-2 inline-block">{name}</span>)}</span>}
            </>
          );
          return (
            <span key={option.id} role="listitem" className="flex">
              {onVote !== undefined ? (
                <Button
                  variant="ghost"
                  aria-pressed={mine}
                  disabled={!canVote}
                  onClick={() => onVote(option.id)}
                  className={cn("h-auto w-full flex-col items-stretch justify-start gap-1 rounded-md border border-hairline p-2 text-left font-normal whitespace-normal", mine && "border-brand")}
                >
                  {body}
                </Button>
              ) : (
                <span className="flex w-full flex-col gap-1 p-2">{body}</span>
              )}
            </span>
          );
        })}
      </span>
      {waiting.length > 0 && !closed && (
        <Text as="span" variant="muted">{`Not voted yet: ${waiting.join(", ")}`}</Text>
      )}
      <span className="flex flex-wrap items-center justify-between gap-2">
        <Text as="span" variant="muted">
          {closed ? "Poll closed" : closes === null ? (payload.multi ? "Pick as many as you like" : "Pick one") : `Open until ${closes}`}
        </Text>
        {onClose !== undefined && !closed && (
          <Button variant="secondary" size="sm" onClick={onClose}>
            Close poll
          </Button>
        )}
        {/* Reopening never edits the notebook, so a passed date is the editor's to move, not a button's. */}
        {onReopen !== undefined && closed && results?.datePassed !== true && (
          <Button variant="secondary" size="sm" onClick={onReopen}>
            Reopen poll
          </Button>
        )}
        {onReopen !== undefined && closed && results?.datePassed === true && (
          <Text as="span" variant="muted">
            The close date has passed — move it to reopen the poll.
          </Text>
        )}
      </span>
      {onVote !== undefined && (
        <span role="status" className="sr-only">
          {announcement}
        </span>
      )}
      {problem !== null && (
        <Text as="span" variant="muted" role="alert">
          {problem}
        </Text>
      )}
    </span>
  );
}
