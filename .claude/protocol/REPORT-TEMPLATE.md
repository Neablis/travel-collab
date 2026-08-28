# Report template

Write this to `<run-dir>/reports/<unit-id>.md`, and make your final message
the same content. Section headings are checked mechanically — keep them
exactly as written.

    ## Exit: DONE

    ## Unit
    <unit-id> — <the objective from your brief>

    ## Files touched
    - <path> — <what changed, one line>

    ## Acceptance checks
    - `<exact command>`
      <verbatim output, or the exit status>
      PASS | FAIL

    ## Evidence gaps
    <What you did NOT verify, and why. "none" is allowed. Absence is not.>

    ## Findings left alone
    <Noticed, deliberately not acted on, so it can be filed rather than lost.
    "none" is allowed.>

    ## Board entries written
    <paths, or "none">

    ## Teardown
    <what you created, and what you removed>

A **BLOCKED** report keeps every section above and adds these two:

    ## Blocker
    <reproduction; strikes used; what you tried; your best hypothesis>

    ## Tree state
    <what condition you left the working tree in>

A **DESCOPED** report keeps every section above, and its Evidence gaps
section carries the evidence that the unit was wrong.
