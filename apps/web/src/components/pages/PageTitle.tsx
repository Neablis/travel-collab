"use client";

import { useEffect, useRef } from "react";
import { Heading } from "@/components/ui/heading";
import { cn } from "@/lib/cn";

/**
 * A notebook's title, at the top of the notebook, edited in place.
 *
 * Mitchell, 2026-09-06 on a 411px phone, pointing at the Rename button in the
 * notebook index: *"rename shouldn't be a button here, the title should be at
 * the top of the notebook as a h1 and when you edit the title it does the
 * actual edit/rename"*.
 *
 * **`contentEditable` on the heading itself, not an input that looks like
 * one.** The title has to stay a heading: it is the document's `h1`, it is what
 * a screen reader lands on, and half this app's e2e walks find this page by
 * `getByRole("heading", { name: … })`. Swapping in an `<input>` would keep the
 * look and lose all of that; an `<input>` nested inside an `<h1>` gives the
 * heading an empty accessible name, which is worse than either.
 *
 * **React does not own the text while it is being edited.** The element's
 * content is set imperatively and only when the incoming `title` differs from
 * what is on screen AND the element is not focused — a re-render that rewrote
 * the child mid-word would collapse the caret to the start, which is the
 * classic way a `contentEditable` in React eats every second keystroke.
 * `suppressContentEditableWarning` is React asking to be told this was
 * deliberate.
 *
 * A rename is committed on blur or Enter, abandoned on Escape, and an empty
 * title is refused by restoring the old one rather than by an error: a
 * notebook with no name is not a state the rest of the app has a word for.
 */
export function PageTitle({
  title,
  editable,
  onRename,
}: {
  title: string;
  editable: boolean;
  onRename: (next: string) => void;
}) {
  const ref = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    if (el === document.activeElement) return;
    if (el.textContent === title) return;
    el.textContent = title;
  }, [title]);

  const commit = () => {
    const el = ref.current;
    if (el === null) return;
    const next = (el.textContent ?? "").trim();
    if (next === "" || next === title) {
      // Put the old name back rather than leaving a blank heading behind. The
      // caller is told nothing, because nothing happened.
      el.textContent = title;
      return;
    }
    el.textContent = next;
    onRename(next);
  };

  return (
    <Heading
      level={1}
      ref={ref}
      contentEditable={editable}
      suppressContentEditableWarning
      // A single line: a notebook title that accepts a newline stores one, and
      // the index list has nowhere to put it.
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
          return;
        }
        if (event.key === "Escape") {
          // `stopPropagation` for the same reason the old inline rename did it:
          // this heading can sit under an overlay whose own Escape would close
          // the surface out from under a half-typed name.
          event.stopPropagation();
          event.currentTarget.textContent = title;
          event.currentTarget.blur();
        }
      }}
      onBlur={commit}
      className={cn(
        // Editable-but-idle should look like a title, not like a field: the
        // affordance is the hover and focus ring, which is how the rest of this
        // document behaves too.
        editable && "-mx-1 cursor-text rounded-sm px-1 hover:bg-moss focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
      )}
    >
      {title}
    </Heading>
  );
}
