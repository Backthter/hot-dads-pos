# Phase 1C-iii-b — History · Money, the money ledger

**Status:** complete · 2026-08
**Base commit:** `380b4c0` — "Task 6b: the Phase 1C-iii-a report"
**Branch:** `phase-1c-iii-b-money`, off `master`
**ADRs:** 025–026
**Checks:** 402 → 493 in `metrics.check.ts`

---

## Goal

A shop that has traded for a season can find out what any one afternoon took,
what any one item costs to make, and what any one delivery did to the shelf. It
cannot find out **where the money went**.

The facts are all there and they are in three different shapes. Deliveries are
lines in the stock ledger, with a price attached to some of them. Costs are
`CostEntry` rows, five bases, listed nowhere except the form that creates them.
Sales are four hundred tickets. Nothing has ever put the three in one column in
the order they happened, so the question a stall owner actually asks at the end
of a month — *I know what I took, so why is there no money* — has had no screen.

`PHASE-1.md` named this gap in D3 and sketched the answer. History has carried a
**Money** selector since 1C-i with an empty state under it promising a phase.
This is that phase, and it is also the outlay half of the split the costs
explainer has been teaching since 1C-i without anything on screen to point at:
Finance measures what the things you sold cost to make, this measures what left
the till, and a Rs 8,000 mince delivery beside Rs 900 of mince eaten stops
looking like a contradiction once both are labelled.

Two things made it awkward enough to need decisions rather than just a table. A
cost logged as a rate — Rs 4 a ticket, 18% of sales — is not a payment and has
no amount until a period is named. And a market's pitch fee is deliberately
*held back* from a single day's profit (ADR-013), which is right for profit and
wrong for a ledger of what actually left the till.

## What changed

### Task 1 — `moneyLedger`, and the reconciliation that keeps it honest

```ts
export function moneyLedger(input: {
  orders: Order[]; costs: CostEntry[]; movements: StockMovement[];
  stockItems: StockItem[]; sessions: TradingSession[];
  mix: SalesMixEntry[] | null; range: DateRange;
}): MoneyLedgerResult;
```

Three sources into one chronological column: receipts, cost entries, and sales
**rolled up per session** rather than per ticket — four hundred rows for one
Saturday is the order log again, and History already has that. Orders belonging
to no session roll up per calendar day, never swept into a session whose span
happens to contain them (invariant 4).

**`resolveEntryAmount` is the phase's actual content.** `CostEntry.amount` is
the only field in the program whose unit depends on another field: rupees under
two bases, a rate under two more, and percentage points under `per-revenue`. So
the money column can never show `amount`:

```ts
export function resolveEntryAmount(entry, totals, mix):
  { amount: number; charge: EntryCharge | null };
```

`charge` is `{ rate, base, covered }` — numbers, not a sentence, because the
engine does no formatting and because a derivation stated as numbers can be
checked arithmetically. The defect being guarded against is invisible in a
sentence and obvious in a number.

The reconciliation was written **before** any of it reached a screen, and it is
the check that matters: summing `resolveEntryAmount` per basis reproduces
exactly what `resolveCosts` produces for the same period, in both the with-mix
and no-mix branches. Two functions answering one question is how `foodCost` and
`stockPurchasesValue` came to disagree about a single delivery (ADR-014).

Two small extractions came out of the same work. `isReceipt` is now the only
copy of ADR-014's definition of a purchase, and `receiptValue` the only copy of
the three places a delivery's price can come from. `stockPurchasesValue` calls
both; its behaviour is unchanged, **including** reading an unpriced delivery as
zero — see *Bugs found*.

**No `now`.** A live session's sales row sits at its last order, which is a fact
rather than a reading of the clock. That removes the whole table from the tick
(ADR-009) at the cost of nothing: a session that has not traded has no sales
row, which is correct — a row of zero would claim it took nothing.

### Task 2 — the filter language stops being about orders

You asked for the full condition tree on Money rather than a search box. Most of
`filters.ts` turned out never to have known what an order was: `Condition`,
`Group`, `Operator`, `compare`, `operatorsFor`, `OPERATOR_LABELS` and
`emptyGroup` are all row-agnostic already. Four things were not, and now take
the row type as a parameter:

```ts
export interface FieldDef<Row> { …; value: (row: Row) => unknown }
export function applyFilter<Row>(rows: Row[], group: Group, fields: FieldDef<Row>[]): Row[];
export function matchesGroup<Row>(row: Row, group: Group, fields: FieldDef<Row>[]): boolean;
export function describeGroup<Row>(group: Group, fields: FieldDef<Row>[]): string;
```

`FilterContext` is gone. It existed only so `applyFilter` could rebuild the
field list it had already been handed; a field closes over its own lookups when
the list is built, and `OrdersExplorer` already had that list in a memo, so the
three call sites got shorter rather than longer.

`moneyFields(sessions, events, stockItems)` is the money ledger's list —
deliberately a **separate list, not a superset** of `fieldsFor`. A money row and
an order share almost nothing, and one list covering both would be mostly fields
that are null on half the rows, which is invariant 2's shape arriving through a
filter instead of a figure. It carries one field neither list shares: *Has an
amount*, because "Out is less than 1" and "Out is not known" are different
questions and only one of them has an operator.

### Task 3 — the builder comes out of `OrdersExplorer`

`FilterBuilder.tsx`: `GroupEditor` and `ConditionRow` moved out with a type
parameter, plus `useFilterTree` for the five recursive tree mutations that were
inline in `OrdersExplorer`. Leaving those behind would have meant retyping them
from memory in the money screen — the same problem one layer down.

One decision worth naming. `useFilterTree` takes a `newCondition` factory rather
than deriving the opening condition from `fields[0]`. Orders opens on *Total
paid is more than 0*, which is a statement about orders and would be nonsense
over a money row; deriving it would have quietly changed this screen, and the
move is supposed to change nothing. `OrdersExplorer` 656 → 444 lines, same
behaviour.

### Task 4 — the screen

`MoneyLedger.tsx`, on the `DataTable` primitive 1C-iii-a built. Six columns —
When · What · Kind · In · Out · Running. All three money columns declare
`money: true`, which is moot today because `HISTORY_SOURCES` locks Money at
`'all'`, and is the right declaration anyway: declare it, do not check it
(ADR-019).

The Kind column says what a cost is charged *per* — "Cost · Share of sales"
against "Cost · Per session" — because those two behave completely differently
over a period and the reader has no other way to tell them apart. Under a rate's
amount sits what it resolved from: *18% of Rs 22,180 taken*, *Rs 12 × 47 of 118
items*. A flat fee explains nothing, because there is nothing to explain.

Two sentences at the top rather than annotations on every row: that this is a
cash view and Finance is not, with the explainer one tap away; and that a rate
cost's figure moves when the period does while a one-off fee's never will. A
ledger whose rows normally look immutable is a bad place to hide the second.

**`accumulate` was extracted during this task**, not planned. The running
balance had to mean the same thing filtered as unfiltered — filter to *stock
bought* and a balance that still included every sale is arithmetic the reader
cannot check against the rows in front of them. It is now the one place the
column is worked out, and the screen runs it again over whatever survives the
filter. `MoneyRow` gained `cash`/`transfer` on sales rows in the same change, so
the footer's till split is derived from the rows shown rather than computed a
second way.

The **Show everything** toggle defaults off, so the nav period picker drives
Money like every other table. Widened, the sales mix is recomputed over every
order — a targeted per-unit cost spread over the wrong denominator is a wrong
number, not a conservative one, so the `null` shortcut was not taken.

`HISTORY_SOURCES` drops Money's `arriving` label. Stock keeps its, naming 1C-iv.

### Task 5 — the Finance row drills through

`onPickRow`, wired and unused since 1C-iii-a, gets its destination. Three
navigation steps in one callback — scope, tab, source — because a row that set
two of the three would land somebody on the right screen showing the wrong
period.

An `unassigned` row leaves the scope alone rather than inventing one. Its orders
belong to no session and guessing one from timestamps is what invariant 4
forbids; the current period already contains them, so the ledger it opens
answers a slightly wider question rather than a wrong one.

### Task 6 — the query language gets the regression it never had

The plan said the existing filter checks were the regression for task 2. **There
were none.** `filters.ts` is 300 lines of query language driving the one screen
a shop uses to answer *what happened*, and nothing would have failed if an
operator had been edited. That was found while generalising it, which is exactly
the kind of change that needs a regression and did not have one.

Nineteen checks over the orders path, so the generalisation is provably
behaviour-preserving: every operator kind, the array-valued asymmetry between
"contains" and "does not contain", a nested group binding its own way, an
unknown field matching rather than excluding, and the sentence a saved search is
stored under. Then the same language over money rows.

### Task 7 — documentation

ADR-025 and ADR-026, a *Money ledger* section in the domain, the three analytics
primitives in the architecture, the roadmap, and two new entries in `OPEN.md`.

## Files touched

| Path | What changed |
|---|---|
| `src/app/analytics/metrics.ts` | `moneyLedger`, `MoneyRow`, `MoneyLedgerResult`, `accumulate`, `resolveEntryAmount`, `EntryCharge`, `isReceipt`, `receiptValue`; `stockPurchasesValue` rewired through the last two |
| `src/app/analytics/filters.ts` | row type is a parameter; `FilterContext` removed; `moneyFields` added |
| `src/app/analytics/FilterBuilder.tsx` | **new** — the builder and `useFilterTree`, moved out of `OrdersExplorer` |
| `src/app/analytics/MoneyLedger.tsx` | **new** — the screen, plus `kindLabel`, `chargeDetail`, `moneyHaystack` |
| `src/app/analytics/OrdersExplorer.tsx` | uses the extracted builder; 656 → 444 lines, no behaviour change |
| `src/app/analytics/AnalyticsView.tsx` | the ledger memo, the widen state, the widened mix, `openMoneyFor` |
| `src/app/analytics/tabs/HistoryTab.tsx` | renders `MoneyLedger` where the empty state was |
| `src/app/analytics/tabs/FinanceTab.tsx` | passes `onPickFinanceRow` through to the table |
| `src/app/analytics/tabs/model.ts` | Money loses its `arriving` label |
| `metrics.check.ts` | 402 → 493 |
| `src/app/analytics/DataTable.tsx` | **read, unchanged.** The primitive took a fourth caller with no modification, which is the thing 1C-iii-a was trying to find out |
| `src/app/analytics/search.ts` | **read, unchanged.** Already generic over a haystack string; `moneyHaystack` supplies one |
| `src/app/analytics/CostsExplainer.tsx` | **read, unchanged.** Already says it is reachable from History · Money; now it is |
| `src-tauri/`, `src/db/` | **untouched.** No schema change this phase |

## Invariants introduced

**None.** Nothing here needed a new rule that corrupts data silently when
broken.

One thing came close and was written as an ADR instead. *A cash ledger and a
profit table may disagree about the same cost in the same scope* is a rule a
future session must not "fix", but it is a statement about two screens rather
than about data integrity, and `03-INVARIANTS.md` is not the place for it. It is
ADR-025, and the check asserts both sides in one place so the reason is attached
to the disagreement wherever somebody finds it.

## How to verify

**Checked** — 493, all passing. `pnpm typecheck` clean.

The **regression** is *entry by entry, the fixed costs agree* and its three
siblings: the cost rows summed per basis against what `resolveCosts` produces
for the same period, with and without a mix. If the ledger and the Finance tab
ever start reporting different money for the same costs, these fail.

The one that guards the phase's headline defect is *a percentage is never shown
as rupees* — 18 percentage points over Rs 1,000 is Rs 180, and if it ever reads
18 somebody has put `entry.amount` in a money column. *A rate reaches the column
as money* is the ledger's half of it.

Also asserted: a correction is not a purchase; an undone delivery leaves no row;
an unpriced delivery has no amount, is counted, and does not move the running
total; sales roll up per session and session-less orders per day; a live session
sits at its last order; a whole-market cost appears in the ledger **and** is
still held out of the Finance row, in one check; a filtered ledger runs its own
balance; and nineteen over the orders filter that had nothing before.

**By hand**, against a copy of the real database:

1. Scope to a market day with a delivery, a pitch fee and a commission logged.
   Money lists all three plus one sales row, oldest first, running total ending
   at money in minus money out. **Wrong answer:** the commission row reads the
   percentage as rupees.
2. Turn on **Show everything**. The fixed-fee rows keep their amounts exactly;
   the rate rows grow. **Wrong answer:** a pitch fee changes.
3. Scope to one day of a multi-day market whose pitch fee was paid that day. The
   fee appears here, and is still held out of that session's row on Finance.
   That is ADR-025. **Wrong answer:** they agree.
4. Click a Finance row. History · Money opens, already scoped to that session.
5. Undo a delivery. Its row disappears and the running total closes over it.
   **Wrong answer:** it stays, or a second cancelling row appears.
6. A delivery entered with no cost shows `—`, and the panel says the running
   total is a floor. **Wrong answer:** it shows `Rs 0`.
7. Filter to *Kind is Cost logged*. The Running column re-runs over just those
   rows. **Wrong answer:** it keeps the whole ledger's balance.
8. Set a revenue PIN and lock. Money is replaced by the lock screen entirely,
   while Orders and Stock stay open.
9. Open History · Orders and use the filter builder as before — nested groups,
   saved searches, the description line. **Wrong answer:** anything at all
   differs from before this phase.

**Not run:** `cargo test`, the Tauri build and `smoke.check.mjs` — no Rust
toolchain and no browser in the implementation sandbox. There was **no Rust or
schema change this phase**, so nothing is unverified on that side. Both new
components were confirmed to transform under esbuild.

## Bugs found and deliberately not fixed

**`filters.ts` had no checks at all.** Not deferred — closed. Three hundred
lines of query language with no regression, found while changing it. Nineteen
checks now cover the orders path. Recorded here because the *shape* of the
finding is what matters: the plan asserted a safety net that did not exist, and
the only reason to look was that the refactor felt risky.

**`stockPurchasesValue` counts an unpriced delivery as Rs 0.** Invariant 2 in
the flattering direction — *not known* read as *free* — and it reaches
break-even through `earlierStockCost`. Behaviour is unchanged from before this
phase; extracting `receiptValue` only made the unknown *expressible*, which is
what let the ledger report it honestly. Fixing it means returning a coverage
figure beside the total the way `Totals.costCoverage` sits beside `cogs`, not
changing the number. In `OPEN.md`.

**`financeRows` takes `now`, never reads it, and is memoised on it.** The whole
Finance table, including a `breakEvenCrossing` per row, rebuilds every five
seconds during a live session to produce an identical answer. Nothing wrong on
screen; wasted work in exactly the place ADR-009 was written about, at the time
the machine is busiest. Removing `now` from the array is one line and makes the
dependency array deliberately disagree with the signature, so the clean fix is a
signature change to a function 1C-iv is about to add columns to. In `OPEN.md`.

**Introduced and fixed within the phase:** the first cut had the screen render
`moneyLedger`'s rows directly, keeping the whole ledger's `running` under a
filter. It looked right — the numbers were real numbers, monotonic, and derived
from real rows — and it was unreadable in the one case the filter exists for.
Caught by asking what the column means rather than by a check, which is why
`accumulate` now exists and has one.

## Carried forward

> See `docs/OPEN.md`.

Nothing in the register was closed this phase. Two entries were added.

## What the next phase can now assume

### Interfaces

```ts
moneyLedger({ orders, costs, movements, stockItems, sessions, mix, range }): MoneyLedgerResult
accumulate(rows: MoneyRow[]): MoneyLedgerResult
resolveEntryAmount(entry, totals, mix): { amount: number; charge: EntryCharge | null }
isReceipt(m: StockMovement): boolean
receiptValue(m: StockMovement, stockItems: StockItem[]): number | null
```

`moneyLedger` takes **no `now`**, and that is load-bearing rather than an
oversight. It is the worked example for 1C-iv's History · Stock, which has the
same choice to make and the same right answer: a movement's timestamp is a fact,
so nothing on that screen needs the clock either.

`accumulate` is the only place a running balance is computed. Anything that
filters money rows must run it again over what it kept.

The filter language is generic. **History · Stock should supply a
`stockFields()` list and reuse `FilterBuilder` and `useFilterTree` rather than
building a third tree** — that is what tasks 2 and 3 were for, and the checks
now protect it.

`DataTable` took a fourth caller unmodified. 1C-iv's two tables should need
nothing from it but column definitions.

### Things not to do

- **Do not put `CostEntry.amount` in a money column.** ADR-026, and there is a
  check named for it.
- **Do not "fix" the ledger and the Finance table into agreeing** about a
  per-event cost in a session scope. ADR-025, and the check asserts both sides.
- **Do not merge `fieldsFor` and `moneyFields`** into one list. Half the fields
  would be null on half the rows.
- **Do not give `moneyLedger` a `now`.** A live session's row sits at its last
  order.
- **Do not compare cumulative revenue against `BreakEven.revenue`** (ADR-024,
  still true).
- **Do not put money in the analytics nav slot** — still outside the lock.

### Settled, and not

**Settled:** what a money row is, where a per-event cost appears on each screen,
how a rate becomes rupees, what the Running column means under a filter, and
where a Finance row drills to.

**Not settled, and 1C-iv's:** whether revenue per trading hour becomes a Finance
column and the *Sessions in scope* panel goes (`OPEN.md`, unchanged since
1C-iii-a). Which Inventory columns are `money`. Whether saved searches should be
shared between the two filterable screens — `OrdersExplorer` keeps its own and
Money has none, which is fine while sticky state is in-memory and becomes a
decision the moment it is given disk.

**Not settled, and Phase 6's:** the export still resolves costs with no sales
mix, and the export menu is still outside the lock.

### What the prompt got wrong

- **The plan said the existing filter checks in `metrics.check.ts` were the
  regression for the generalisation. There were none.** That is the one thing in
  the plan that was not merely optimistic but false, and it was load-bearing —
  the whole argument for doing task 2 as a separate no-behaviour-change commit
  rested on a safety net that did not exist. Task 6 built it.
- The plan's `MoneyRow` had a `from: string | null` display sentence built in
  the engine. It became `charge: EntryCharge | null` — numbers, assembled into a
  sentence where it is drawn — because `metrics.ts` does no formatting and
  because the derivation is then checkable arithmetically.
- The plan did not anticipate `accumulate`. The running column under a filter is
  a question the plan asked nothing about and the screen could not avoid.
- The plan's footer sketch duplicated `FinanceTab`'s cash/transfer split. Putting
  the split on the sales rows themselves gives the footer for free and adds a
  per-session figure Finance does not show.
