# Phase 1C-iii-a — The Finance table, and when the day paid for itself

**Status:** complete · 2026-08
**Base commit:** `9a818d1` — "Task 10d: the Phase 1C-ii-b report"
**Branch:** `phase-1c-iii-a-finance`, off `master`
**ADRs:** 024
**Checks:** 334 → 402 in `metrics.check.ts`

---

## Goal

Finance is the tab that asks *did this pay?* and until now it answered with the
KPI cards 1C-i inherited from the old Overview. The figures were right — 1A made
the money model honest, 1C-ii-b made per-item costs land on the right items — but
there was no **table**: no row per session, no way to hold Saturday against
Sunday, and no answer to the question `PHASE-1.md` has called the most useful
column on the screen since before Phase 1A ran.

> **Passed break-even at** — naming the ticket number and clock time the session
> covered its costs — is the most useful column on the screen and does not exist
> yet.

That column is the phase. The table is the frame it needs; the table primitive is
what 1C-iv will build Inventory and Business on.

The second thing this phase is for is quieter. ADR-013 holds a market's pitch fee
back from a session's break-even, and until now that held figure existed only as
a sentence under a KPI card. A table row is where it becomes a **cell** — a
number you can read next to the session's own costs, with the market's row
beneath showing where it actually landed.

**Scope.** Planned 1C-iii covered both this and the money ledger. It was split,
as 1C-ii was. History · Money is **1C-iii-b**.

## What changed

### Task 1 — `breakEvenCrossing`

```ts
breakEvenCrossing(orders, menuItems, costs, totals, scope, mix): BreakEvenCrossing
```

Walks the period's orders oldest first, skipping voids, accumulating each
ticket's own contribution:

```
netRevenue
  − cogs                                    frozen at checkout (invariant 3)
  − netRevenue × revenueRate                 per-revenue
  − perOrderCost                             per-order, one ticket
  − Σ lines: perUnitCostFor(item) × qty      per-unit, deals crediting components
```

The crossing is the first ticket at which the running total reaches
`ResolvedCosts.fixed`.

**The design is what is *not* in that list.** No `averagePrice`, no
`averageBasket`, no `cogsRatio`. Every term is a property of that ticket and of
the cost entries, so the running total after ticket *N* is a function of tickets
1..N alone — and ticket *N+1* cannot move a crossing that has already happened.

The obvious construction is cumulative revenue against `BreakEven.revenue`, and
it is wrong in a way that only shows up during service: both sides move, so a
crossing found at two o'clock can be **un-found** at four. ADR-024 has the
argument.

An uncosted ticket contributes **nothing** rather than counting at zero cost. In
the check fixture, counting at zero puts the crossing at ticket 3 when the truth
is ticket 5 — too early, in the flattering direction, on the data nobody can
check. Skipping errs the other way, so the reported crossing is never earlier
than the truth and the column can say *"or earlier — 17% uncosted"*.

`BREAK_EVEN_BLOCKED` gains `notYet`, which `breakEven` has no use for: a target
is always answerable, a measurement of something that has not happened is not.

`perUnitChargeOf` is extracted and exported so the deal rule can be checked on
its own. A deal charges its **components**, because `itemPerformance` credits
them with the units they represent and `salesMix` is built from that — the
crossing and the blended rate had to agree about the same meal deal.

### Task 2 — `DataTable`

Written against 1C-iv from the start rather than shaped around Finance and
generalised twice, which is how three tables end up with three ideas of what a
money column is.

- **Columns are data and declare what they are.** A money column says so and the
  table blanks it under the lock. That is 1C-i's "declare it, do not check it"
  rule for tab locks applied one level down: a screen that has to remember to
  hide its own money is a screen that will one day forget.
- **An unknown renders `—`, never `0`.** `null` is the signal. This is the last
  layer invariant 2 can be broken at — the engine keeps *no cost on file* and
  *cost of nothing* apart the whole way here, and rendering `null` as `0` throws
  it away in the final inch.
- **An unknown sorts last** whichever way a column points. It is not a small
  value, it is the absence of one, and floating it to the top of an ascending
  sort puts the rows you know least about first.
- Summary rows are held out of the sort and appended. A total that has drifted
  into the middle of what it totals is worse than an unsorted table.

`visibleColumns` and `renderCell` are pure and exported, so 1C-iv inherits both
rules rather than reimplementing them per table.

### Task 3 — the Finance table

`financeRows` in `metrics.ts` builds a row per session and one that totals them.
**Each row resolves its own costs at its own scope**: a session row is
`'session'`, so the market's pitch fee is held and reported on
`heldEventCosts`; the event row is `'event'`, where the period genuinely owes it.

That is ADR-013 as a table, and two checks pin that the fee is charged once — the
session rows sum to their own costs alone, and the event row exceeds that sum by
exactly the pitch fee.

**The row axis is decided in `AnalyticsView`**, because only that level knows the
scope. `financeRows` owns what a row *says* once it exists, so all three shapes
produce the same arithmetic:

| Scope | Rows |
|---|---|
| date | the sessions that traded, newest first, plus *Not in a session* |
| event | its members, then the event totalling them |
| session | itself, then the market it belongs to |

`netProfit` and `netMarginPct` are **null** when nothing in the row carries an
ingredient cost. Subtracting a known operating cost from a revenue whose
ingredients are unknown produces a number that looks like profit and is not —
invariant 2, one layer up from the line it protects.

Orders taken outside a session get their own row on a date scope rather than
being guessed into one by timestamp (invariant 4), and are absent where nothing
asked for them.

Two decisions inside the task, neither big enough for an ADR:

- **Rows are newest first, and there is no default sort.** A Finance table is
  read as *how did Sunday go* before *which paid best*, and sorting by takings
  out of the gate loses the sequence a market ran in. Every column is still
  sortable.
- **The crossing column is marked `money`.** A ticket number is not money, but
  *the day covered its costs at 4:52* is a statement about profit, and under
  `money-columns` it has to go with the rest.

### Task 4 — the stale phase promises

The brief named two strings. There were **five**, all from one cause:
`PHASE-1C.md` resequenced the work when 1C-ii was inserted — Money to 1C-iii,
Stock and the two tables to 1C-iv — and none of the copy followed.

| Where | Said | Now |
|---|---|---|
| `tabs/model.ts` · Stock | 1C-iii | 1C-iv |
| `tabs/model.ts` · Money | 1C-ii | 1C-iii-b |
| `HistoryTab.tsx` · Stock | 1C-iii | 1C-iv |
| `HistoryTab.tsx` · Money | 1C-ii | 1C-iii-b |
| `InventoryTab.tsx` | 1C-iii | 1C-iv |
| `BusinessTab.tsx` (doc comment) | 1C-iii | 1C-iv |
| `FinanceTab.tsx` (doc comment) | 1C-ii brings the table | 1C-iii-a did |

History · Money was promising a screen in a phase that had already been and gone.
The other three were found by grepping for the shape the first two turned out to
be an instance of.

This is the **second** time a resequencing has left copy behind; the first was
the fixed/variable hints 1C-ii-b removed. A note beside `HISTORY_SOURCES` now
says that whoever moves a phase moves the strings naming it.

## Files touched

| Path | What changed |
|---|---|
| `src/app/analytics/metrics.ts` | `breakEvenCrossing`, `perUnitChargeOf`, `financeRows`, `FinanceRow`; `BREAK_EVEN_BLOCKED.notYet` |
| `src/app/analytics/DataTable.tsx` | **new** — the primitive, `visibleColumns`, `renderCell` |
| `src/app/analytics/tabs/FinanceTable.tsx` | **new** — the columns, `crossingLabel`, `crossingCaveat` |
| `src/app/analytics/tabs/FinanceTab.tsx` | renders the table; takes `financeRows` and `moneyHidden` |
| `src/app/analytics/AnalyticsView.tsx` | the `financeTableRows` memo and the row-axis decision |
| `src/app/analytics/tabs/model.ts` | the two `arriving` values, and a note on why they were wrong |
| `src/app/analytics/tabs/HistoryTab.tsx`, `InventoryTab.tsx`, `BusinessTab.tsx` | stale phase copy |
| `src/app/ui/primitives.tsx` | — untouched; `SelectOption.depth` from 1C-ii-b was enough |
| `metrics.check.ts` | 68 new checks |

Read and deliberately not changed:

| Path | Finding |
|---|---|
| `src/app/analytics/scope.ts` | `resolveScope` already supplies everything the row axis needs. Checked, already correct |
| `src/app/analytics/OrdersExplorer.tsx` | Not the table primitive's ancestor — it is a search shell over one record set, and generalising it would have produced a worse `DataTable`. Left alone |
| `src/app/analytics/workbook.ts` | Untouched. It carries `breakEven` and now does not carry the crossing; that is Phase 6's, with the lock |
| `src/app/analytics/tabs/FinanceTab.tsx` · *Sessions in scope* | Now duplicates the table. See below |

## Invariants introduced

None, and no new convention.

The table's money-column rule is an application of ADR-019 rather than a new
rule, and the crossing's stability is convention 5 read in its strong form
(*does not move at all*, not merely *does not depend on when it is read*) —
which ADR-024 argues for rather than the invariants file asserting.

One thing worth stating that is not an invariant, because a future session will
otherwise reach for it:

> **Do not "fix" the crossing by costing uncosted lines at the period average.**

It looks like a small improvement that fills in the em dashes. It reintroduces
exactly the movement this phase removed, and it makes the crossing shift when an
*unrelated* item's recipe is costed later. ADR-024 rejects it explicitly.

## How to verify

**Checked** — 402 in `metrics.check.ts`, 68 of them new.

The **regression** is `Break-even crossing · the crossing does not move as the
day fills up`, with its three siblings. They compute the crossing over four
tickets and over six, and assert the same order, the same moment and the same
banked contribution while the period's totals move underneath. If that fails, a
period average has got back into the contribution.

The other groups:

- **`Break-even crossing`** (35) — the hand-computed crossing at ticket 4; the
  uncosted ticket landing at 5 rather than the flattering 3; each rate moving it
  one at a time; ADR-022 targeting reaching what sold and not what did not; the
  deal rule; ADR-013 in a session scope against an event scope; a void handing it
  on; and all four blocked reasons including `notYet` with its remaining figure.
- **`Finance rows`** (25) — a row per session plus the event; the pitch fee in no
  session row and the event row exceeding their sum by exactly it; net profit
  null where nothing is costed; orders outside a session getting their own row
  and only when asked for.
- **`Table columns`** (8) — money columns dropped under the lock and quantity
  columns kept; `—` for an unknown and `Rs 0` for a zero.

**By hand**, against a copy of the real database:

1. Scope to a finished market day with a pitch fee logged. The Finance table
   shows a row for the session with *Passed B/E at* naming a ticket and a time.
   Find that ticket in History · Orders; the takings to that point should cover
   the day. **Wrong answer:** the column reads `—` when costs and costed sales
   both exist.
2. With a session live, watch the column across several sales. Once it names a
   ticket, that ticket must **never change**. **Wrong answer:** it slides later,
   or disappears — a period average is back.
3. Scope to one day of a multi-day market. The session row's *Op. costs* is its
   own, with *+ Rs X held by the event* under it; the market's row beneath shows
   the fee in its own *Op. costs*. **Wrong answer:** the fee appears in both.
4. Void the order that caused the crossing. It moves to the next qualifying
   ticket. **Wrong answer:** it stays, or the column blanks.
5. Sell something whose recipe is incomplete. The crossing gains *or earlier ·
   N% uncosted*. **Wrong answer:** a crossing with no caveat.
6. Set a revenue PIN and lock. Finance is `locked: 'all'`, so the whole tab —
   table included — is behind `LockedRevenue`.

**Not run here.** `cargo test`, the Tauri build and `smoke.check.mjs` need a Rust
toolchain and a browser and are outside this sandbox. **No Rust or schema change
was made this phase**, so unlike 1C-ii-b there is nothing unverified on that
side; both new components were confirmed to transform under esbuild.

## Bugs found and deliberately not fixed

**1 — Finance computes its per-session figures twice.** The *Sessions in scope*
panel is fed by `sessionPerformance` and the table by `financeRows`; both walk
the same orders to produce a per-session `Totals`, and the screen now shows a
session's takings and ticket count twice from two computations. They cannot
disagree today — both go through `totalsFor(ordersForSession(...))` — but that is
precisely the shape ADR-014 was written about. The panel's one distinctive figure
is revenue per trading hour, which belongs in the table as a column; folding it
in means deleting a panel, which is a decision about the tab's layout that this
phase was not asked to make. In `docs/OPEN.md`.

**2 — Five stale phase promises, where the brief named two.** Recorded under task
4 rather than here because they were fixed, but the *pattern* is the finding: a
resequencing moved four pieces of work and none of the user-facing copy naming
them followed, for the second time. Nothing checks that a phase name in a string
corresponds to a phase that exists.

**Introduced and fixed inside this phase:** one, worth naming. The first cut of
`financeRows` gave a session row only its own costs, which made `heldEventCosts`
zero everywhere and quietly deleted ADR-013 from the table — the row looked
right, the market looked free, and nothing errored. It was caught by writing the
double-counting checks before wiring the component. A session's costs have to
include the event's *so that* `'session'` scope has something to hold back.

## Carried forward

> See `docs/OPEN.md`.

**Closed by this phase:** nothing. No register entry was in scope.

**Added:** the duplicate per-session computation above.

## What the next phase can now assume

1C-iii-b builds History · Money on this; 1C-iv builds two more tables on the
primitive.

### The table

```ts
DataTable<Row>({ rows, columns, keyOf, header, headerLabel,
                 defaultSort?, moneyHidden?, onPickRow?, isSummary?, emptyLabel? })
```

- **Declare `money: true` on a column and stop thinking about the lock.** Do not
  filter columns in a caller; `visibleColumns` is the only place that happens.
- **Return `null` for an unknown, never `0`.** `renderCell` does the rest.
- `onPickRow` exists and **nothing passes it yet** — drill-through wants the
  money ledger to exist first. Wiring it is 1C-iii-b's, and the affordance is
  already there.
- 1C-iv should add columns to this component, not fork it. If Inventory needs
  something it cannot express — a unit suffix, a status pill — add a column
  capability rather than a second table.

### The crossing

```ts
breakEvenCrossing(orders, menuItems, costs, totals, scope, mix): BreakEvenCrossing
```

`totals` is taken **only** to feed `resolveCosts`, and the one thing it supplies
there — `averageBasket` — this function never reads. That is deliberate and is
what makes the crossing independent of the period's shape; do not start reading
it.

`financeRows` takes `now` and does not use it either, for the matching reason: a
finance row is a fact about a period the scope has already fixed, and a row that
moved with the clock would put ADR-009's tick back into the memo wall. It stays
in the signature so that a later column which genuinely needs it — a live
session's elapsed hours — does not have to change every call site.

### Things not to do

- **Do not compare cumulative revenue against `BreakEven.revenue`** to get a
  crossing. ADR-024, and there are checks.
- **Do not cost uncosted lines at the period average** to fill in the em dashes.
- **Do not allocate a per-event cost to a session row.** ADR-013, ADR-023, and
  two checks in `Finance rows`.
- **Do not put money in the analytics nav slot.** Still true, still outside the
  lock (1C-ii-b).

### Settled, and not

**Settled:** what a crossing is and how it is measured. What a Finance row says.
What a money column is and who decides it.

**Not settled, and 1C-iii-b's:** where a row drills through to. The natural
target is the money ledger filtered to that session, which is why `onPickRow` is
wired and unused.

**Not settled, and 1C-iv's:** whether revenue per trading hour becomes a Finance
column and the *Sessions in scope* panel goes. Which Inventory columns are
`money` — the rule is ADR-019's, the list is that phase's.

### What the prompt got wrong

Nothing material. Two notes for the next planner:

- The brief named **two** stale phase strings; there were five, plus a sixth in
  `FinanceTab`'s own doc comment that the brief could not have known about
  because this phase created the condition for it.
- The brief sketched `BreakEvenCrossing` as returning
  `BreakEvenCrossing | { blocked: string }`. It returns a single shape with an
  optional `blocked`, matching `BreakEven` beside it — which lets the `notYet`
  case carry `remaining`, so the column reads *"Rs 4,300 to go"* rather than an
  em dash. That was the brief's own stated intent; the union would have thrown
  the figure away.
