# Where this is

**Now:** Phase 1C-ii-b — scope, costs, targeting
**Default branch:** `master`
**Checks:** 255 in `metrics.check.ts`, all passing — verified at `d969b9b`,
after the review fixes. `npm run typecheck` is clean.
**Next ADR:** 022 — confirmed against `02-DECISIONS.md`, which ends at ADR-021

This page is an index of plans, not a plan. One line per phase. If it takes ten
minutes to read, it has stopped doing its job.

Updated by every phase, as part of that phase's work.

---

## Done

| Phase | What it settled | ADRs |
|---|---|---|
| **0** | `App.tsx` split into domain hooks; a shared ticking clock so live figures are live; the three missing sync tables; `docs/` itself | 001–011 |
| **1A** | Costs carry a basis, not fixed/variable; break-even stopped moving as sales came in; margin-today separated from realised margin; one definition of a purchase; `eventId` and the menu cost override | 012–015 |
| **1B** | A reversal is its own movement reason, marked on both rows centrally; `effectiveMovements` for economics, every row for levels; redo restores the original's meaning | 016–017 |
| **1C-i** | Four tabs — Finance, Inventory, Business, History; the revenue lock is per-tab and can hide columns; the costs explainer; `per-event` availability is a resolved fact | 018–019 |
| **1C-ii-a** | Events carry a plan and a derived status; sessions can join and leave an existing event; an event of one is legitimate when a person declares it; events are never auto-deleted; the Sessions & Events manager | 020–021 |

## Next

| | | |
|---|---|---|
| **1C-ii-b** | Scope, costs, targeting | hierarchical scope picker; the cost form names its target; `per-unit` costs target items; `resolveCosts` returns blended and per-item |
| **1C-iii** | Money | the Finance table; `breakEvenCrossing`; History · Money, the money ledger |
| **1C-iv** | Things | the Inventory and Business tables; History · Stock |
| **1E** | Forecasting | session pace curves and within-day projection; prep forecasting from demand quantiles |
| **2** | Inventory and units | continuous unit entry; portions (grams per patty); Drain → Delete; the unassigned-recipe badge |
| **3** | The grill, in patties | capacity counts portions, not tickets; partial loading |
| **4** | Menu settings repair | deals inline; obvious add; deferred category reorder with a lifted drag |
| **5** | Five menus to four | Orders absorbs All Orders; the navbar rebuild |
| **6** | The Excel export | a sales report with chronological sheets, real formulas, and the revenue lock applied |
| **7** | Visual direction | blacker blacks; bloom under interactive controls; lift on hover |

Then V2 — see `plan/V2-COMMERCIAL.md`.

**There is no Phase 1D.** It was absorbed into 1C, because splitting the tables
from the history meant restructuring the same tab set twice. The gap is
deliberate; the number is not reused, because it meant something else in an
earlier plan and reusing it would make two documents disagree.

## The ordering principle

> **Numbers true → numbers legible → shop floor → shell → look.**

Do not reorder. A table built on a wrong figure gets built twice, and the second
time it is built on top of screens that already trusted the first.

This is why Phase 7 is last despite being the most visible, and why 1B came
before any table: the reversal defect meant food cost and stock purchases
disagreed about the same delivery, and three tables built on that would have
inherited the disagreement.

## Where the detail lives

| | |
|---|---|
| `PLANNING-BRIEF.md` | what this project is, and how to write a prompt for it |
| `OPEN.md` | everything found and deliberately not fixed, in one register |
| `plan/` | the long-range plans, historical |
| `phases/` | what each phase actually did |
| `phases/TEMPLATE.md` | the shape every phase document takes |
| `02-DECISIONS.md` | ADRs — append-only, never edited |
| `03-INVARIANTS.md` | rules that corrupt data silently when broken |
