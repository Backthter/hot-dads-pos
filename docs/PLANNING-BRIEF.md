# Planning brief

`00-ARCHITECTURE.md` says what the code is. `01-DOMAIN.md` says what the words
mean. This says what the **project** is, and how to work on it.

Read this first, then `ROADMAP.md`, then the phase documents in order.

---

## What this is

A point-of-sale system that runs a real burger stall today, being developed
toward something that can be sold to small food businesses and event stalls.

It is offline-first by construction, not by preference. A stall at an outdoor
market has no reliable signal, and a till that stops when the connection does is
not a till.

## Who it is for

**Now:** one burger operation, with specific needs — a grill board, patties
portioned out of mince bought by weight, sessions that pause overnight and resume.

**Commercially:** mom-and-pop food businesses, home operations, event stalls.
People who need structure without needing a project to get it, and who should be
able to grow into a serious operation without changing software.

## What it competes on

Not the feature list. Zoho POS has more engineers on their onboarding flow than
this project has hours in a week, and a feature comparison is a permanent loss.

The advantages are structural:

1. **It works with no internet.** For an outdoor market this is not a preference,
   it is the whole decision.
2. **Setup is minutes, not a project.** No onboarding call, no chart of accounts.
3. **It knows about ingredients.** The stock-ledger-to-recipe-to-margin chain is
   better than most SMB systems, because most treat stock as a count of finished
   goods. A burger stall has no finished goods; it has mince.
4. **The stall model.** Sessions, events, pitch fees, per-event break-even.
   Nobody at this price point models a trading day that pauses overnight.
5. **One price, no seats.**

Every feature request should be measured against whether it costs one of those.
Most will.

## Two editions, one codebase

A capability seam, not a fork. A fork means fixing every bug twice, by hand,
forever, while also running a business.

Two rules keep it from rotting:

- **Capabilities gate features, never data.** A commercial build must still
  *open* a database containing personal-edition data without crashing. Gate the
  UI and the behaviour; never gate the parser.
- **The flag is read at the edge**, where a feature renders — not threaded down
  through props, which is a fork with extra steps.

## The commercial constraint

A one-time fee cannot fund a recurring cost. Hosting, backups, domain, TLS,
webhooks, monitoring and the support inbox all cost money every month for as long
as a customer stays — so the better the product is, the longer they stay, and the
worse the loss. This is the failure mode that kills small software businesses
that price this way, and it kills them slowly enough not to be noticed until the
hosting bill is the business.

Whatever the pricing ends up being: **the local edition must never phone home.**
Not for licence checks, not for telemetry. A licence check that fails closed at a
market on a Saturday ends a software business by word of mouth.

See `plan/V2-COMMERCIAL.md`.

## The ordering principle

> **Numbers true → numbers legible → shop floor → shell → look.**

Not negotiable. A table built on a wrong figure gets built twice, and the second
time it is built on top of screens that already trusted the first.

This is why the visual pass is last despite being the most visible, and why the
reversal defect was fixed before any table was drawn.

---

## How to write a prompt for this project

This section is the transferable part of the planning role. It is derived from
what worked across Phases 0, 1A, 1B, 1C-i and 1C-ii-a.

**Sizing.** One phase per session, and be pessimistic. 1C-i reported that
`AnalyticsView.tsx` was 1,119 lines rather than the 919 the plan assumed, and
every downstream estimate was a third light. When a session runs out of room, the
thing it drops is the checks — which is the thing worth most.

**Structure that has worked:**

1. Clone, branch, record the base commit.
2. **Working conditions.** Which checks run in the sandbox and which do not
   (`cargo test`, the Tauri build and the smoke check never do). Read only the
   listed files. Commit after each task.
3. **Read first**, as an explicit list. `docs/` in full, then the specific source
   files. A session that explores spends its context on files it does not need.
4. **The problem**, stated concretely, usually quoting the previous phase's
   report. Give the symptom a shop would see, not just the code defect.
5. **Tasks, in order**, each citing files and functions by name.
6. **Verification**, naming the regression that matters.
7. **Documentation**, with the next ADR number given explicitly.
8. **Out of scope**, itemised, with the phase each item belongs to.
9. **The conventions**, restated.
10. **Finish by** — the bundle commands, and what to report.

**Cite files and functions, never layers.** "`resolveCosts` in `metrics.ts`", not
"the analytics layer". When a prompt goes generic, the planner has lost the
thread and should be replaced.

**Always state what is out of scope and why.** This is what keeps a diff
readable, and it is the first thing to erode.

**Give the next ADR number.** ADRs are append-only and numbering collisions are
annoying to unpick.

**Ask for the phase document in the established shape** — `phases/TEMPLATE.md`.
The handoff section is what makes the chain work.

**Say what to do when the code disagrees with the prompt.** Flag it, do not work
around it. That instruction has caught a planner error in three of the last four
phases: a `note`/`notes` collision that would have destroyed data silently, an
instruction to wire up handlers that would have made recipe edits un-undoable,
and a branch named wrong.

## Standing conventions

Implementation sessions are held to the six invariants and six conventions in
`03-INVARIANTS.md`, plus:

- **Flag a disagreement rather than working around it.**
- **A pure function is worth an awkward refactor**, because it can be checked.
  1B extracted the movement-marking rule so the rule is *tested* rather than
  asserted about; that is the pattern.
- **Check the wrong answer too.** 1B's levels check asserts what
  `ledgerLevelsAt` must *not* return, so a later "tidy-up" fails a test rather
  than passing review.
- **Never edit an ADR.** Supersede, and cite what is superseded.
- **Preserve doc comments.** Several record reasoning not recoverable from code.

---

## What I care about most

*<Owner: write this yourself. A fresh planner can reconstruct the architecture
from documents but cannot reconstruct your priorities. What would you rather
have — a correct number or a pretty one? What is worth a week and what is worth
an afternoon? What frustrates you when you are actually using it at the stall?>*

## What I do not want built

*<Owner: also yours. The plans record what was chosen; they record less about the
things that were not chosen because they were not worth the trouble. Without this
section a fresh planner will re-propose them, plausibly and at length.>*
