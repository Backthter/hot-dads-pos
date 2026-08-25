# Phase &lt;n&gt; — &lt;title&gt;

**Status:** complete · &lt;YYYY-MM&gt;
**Base commit:** &lt;sha&gt; — "&lt;subject&gt;"
**Branch:** &lt;name&gt;, off `master`
**ADRs:** &lt;first&gt;–&lt;last&gt;
**Checks:** &lt;before&gt; → &lt;after&gt; in `metrics.check.ts`

---

## Goal

What this phase was for, in a paragraph or two. Write the *problem*, not the task
list — the symptom a shop would have seen, and why it mattered enough to spend a
session on.

The task list is the next section. If this section reads as a summary of that
one, it is not doing its job.

## What changed

One heading per task, in the order they were done. For each: what it does now,
what it did before, and any decision made inside the task that is not big enough
for an ADR but would be surprising to a reader.

Code excerpts where a signature or a shape is the clearest way to say it.

## Files touched

A table: path, and what changed in it. Include files that were *read* and
deliberately not changed where that is informative — "checked, already correct"
is a finding.

## Invariants introduced

Anything a future session must not break, that was not already in
`03-INVARIANTS.md`. If the phase added a convention, say so here and add it there
— this section is the argument, that file is the list.

If none, say so explicitly rather than omitting the heading.

## How to verify

Two parts.

**Checked** — what `metrics.check.ts` now asserts, named. Say which check is the
*regression* — the one that fails if the defect this phase fixed comes back.

**By hand** — what cannot be checked here, as numbered steps someone can follow
against a copy of the real database. Include what the *wrong* answer would look
like, so a reader knows what they are watching for.

State plainly what was not run: `cargo test`, `npm run build` and
`smoke.check.mjs` do not run in the implementation sandbox.

## Bugs found and deliberately not fixed

What **this** phase found and left alone. For each: what it is, where, why it was
left, and what happens if nobody fixes it.

Add each one to `docs/OPEN.md` as well — this section is the finding in context,
that register is where it lives afterwards.

Include bugs introduced and fixed within the phase. They are the most useful
entries, because they say what is easy to get wrong here.

## Carried forward

> See `docs/OPEN.md`.

Do not re-list what earlier phases found. If this phase **closed** an item in the
register, say which, and remove it there.

## What the next phase can now assume

The handoff, and the part that makes the chain work. Written for a session with
no memory of this one.

- The interfaces it will build on — signatures, what they return, what they
  exclude and why.
- Things it must **not** do, that would look reasonable. These are the valuable
  lines: "do not merge these two functions", "do not use this filter there".
- Questions this phase deliberately did not settle, and who settles them.
- Anything in the prompt that turned out to be wrong, so the next planner does
  not repeat it.
