# Where this is

**Now:** Phase 1C-iv — the Inventory and Business tables, and History · Stock
**Default branch:** `master`
**Checks:** 493 in `metrics.check.ts`, all passing — verified at the end of
1C-iii-b. `pnpm typecheck` is clean. **This repository uses pnpm**; `npm i`
writes a `package-lock.json` and flattens the layout.
**Next ADR:** 027 — `02-DECISIONS.md` ends at ADR-026

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
| **1C-ii-b** | Both pickers show what an event contains; the cost form names its target in words and offers to make an event of a lone session; `per-unit` costs target items or a category; `resolveCosts` returns a blended rate beside a per-item one | 022–023 |
| **1C-iii-a** | The Finance table, one row per session with the event that totals them; `breakEvenCrossing` — the ticket that paid for the day, measured per ticket so it cannot move; the table primitive 1C-iv reuses | 024 |
| **1C-iii-b** | History · Money — receipts, cost entries and sales in one column; a cash ledger shows a per-event cost where it was paid while Finance holds it back; one row per cost entry with the amount always resolved to rupees; the query language and its builder stop being about orders | 025–026 |

## Next

| | | |
|---|---|---|
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
