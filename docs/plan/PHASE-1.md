# Phase 1 — Plan

**Status:** planned · supersedes the "Phase 1" section of the V1 development plan
**Depends on:** Phase 0 (complete)

Phase 1 is the analytics rebuild. It is too large for one session, so it is
split into five sub-phases with hard boundaries. Each one is independently
shippable, leaves the program working, and writes its own phase document.

---

## What Phase 0 changed about this plan

Three findings from `phases/PHASE-0-FOUNDATIONS.md` alter what Phase 1 has to do.

### `MenuItem.unitCostOverride` is never persisted — and this settles an open question

Phase 0 found that the field has no column, is never written and never read
back. Every hand-typed override is lost on reload.

The V1 plan already called for removing this field, on the grounds that a menu
screen should not invite the thought that price follows cost, and that overriding
belongs at the ingredient (`StockItem.costPerUnit`, which is editable) rather
than at the menu item. The persistence gap makes that decision cheaper and
lower-risk than planned, in a specific way worth stating:

**There are no historical overrides on disk.** So the migration banner the plan
called for — listing items carrying an override, offering to convert them into
stock items — is unnecessary. There is nothing to migrate. The feature has never
actually worked across a restart.

One nuance, and it cuts the other way: `costCart` in `useOrders` freezes
`unitCost` at checkout using `unitCostFor`, which *does* read the override
in-memory. So any sales rung up between typing an override and the next reload
carry a cost snapshot that reflects it. Those stay exactly as they are —
invariant 3 — and no action is needed. But it means the field has been quietly
influencing some historical margins in a way nobody could have reproduced
afterwards, which is its own argument for removing it.

**Consequence for sequencing:** removing the override is a change to the cost
model, not a menu-screen tidy-up. It moves out of Phase 4 and into **Phase 1A**,
alongside the rest of the cost work.

### `CostEntry.eventId` is never persisted — this is a blocker, not a nuisance

Same shape of bug, but the consequence is worse. `eventId` is the entire reason
event-level costs exist: a pitch fee paid once for a three-day market attaches
to the event rather than to one afternoon of it. `resolveScope`'s `costsOf` and
`sessions.ts`'s `costsForEvent` both read it. `useSessions.addCost` writes it.
The column does not exist.

So an event-level cost works until the app restarts, and then reappears as a
cost belonging to nothing — excluded from event-scoped figures, counted only in
date-scoped ones. Every event-level profit or break-even figure that has ever
been looked at was missing its event-level costs.

This must be fixed before anything else in Phase 1, because every table in 1C
and every figure in 1A reads costs. It is one column plus three lines in
`persistence.ts`, and it lands in the same migration as the `CostBasis` change,
so bundling is cheaper than fixing it twice.

> **If you are trading before Phase 1A starts:** the `event_id` column on its own
> is a twenty-minute standalone fix and composes fine with the later migration.
> Worth doing now if you have an event running, because the data is being lost
> every restart in the meantime.

### The ledger is capped at 20,000 lines — which constrains how reversals are filtered

`applyStockChanges` trims the ledger, and ADR-001 records that this is only safe
because a daily `InventorySnapshot` sits behind it.

That cap interacts badly with any reversal filter that works by *pairing* rows.
If the trim drops an original but keeps its reversal — or the reverse — a
pair-matching filter leaves an orphan it cannot classify, and the orphan gets
counted as a real movement. This would surface as a slow, unreproducible drift
in food cost variance on the oldest data, which is the worst possible failure
shape.

The fix is to make the filter not depend on pairing. See 1B below.

---

## Sub-phases

| | Name | Touches | Independent? |
|---|---|---|---|
| **1A** | The money model | schema, `metrics.ts`, cost form, menu row | — |
| **1B** | Truthful ledger reads | `useStock`, `metrics.ts`, history displays | independent of 1A |
| **1C** | The three tables | `AnalyticsView`, new table components | needs 1A + 1B |
| **1D** | History and the money ledger | Analytics, Inventory | needs 1B |
| **1E** | Forecasting | new `forecast.ts`, prep screen | needs 1B, benefits from 1D |

1A and 1B can be done in either order. 1A first is recommended, because
`event_id` is losing data now.

---

## Phase 1A — The money model

**Goal.** Make every cost figure mean something specific, and make break-even
stop moving underfoot.

### A1 — The migration

One migration on `cost_entries`, doing three things at once:

```sql
ALTER TABLE cost_entries ADD COLUMN event_id TEXT;
ALTER TABLE cost_entries ADD COLUMN basis TEXT NOT NULL DEFAULT 'per-session';
-- `kind` is retained, not dropped. See below.
```

`persistence.ts` reads and writes both new columns. `event_id` is a
straightforward gap-fill. `basis` is the interesting one.

**Retain `kind` rather than dropping it.** Dropping a column that historical rows
carry means the pre-migration interpretation is unrecoverable. Keep it, stop
writing it, and mark it deprecated in `schema.ts`. Costs nothing; makes the
migration reversible.

### A2 — `CostBasis` replaces `CostKind`

The current model is circular. `breakEven` does:

```ts
const variableRatio = totals.netRevenue > 0 ? costs.variable / totals.netRevenue : 0;
const contributionRatio = grossRatio - variableRatio;
```

A typed rupee total is divided by revenue-so-far and treated as a rate. So the
break-even target moves as sales come in: at Rs 4,000 of sales a Rs 1,200 fuel
cost is a 30% drag and break-even looks unreachable; at Rs 20,000 it is a 6% drag
and break-even has already passed. A target that recedes as you approach it is
not a target.

Replace with an explicit basis:

```ts
export type CostBasis =
  | 'per-session'   // paid once per service: pitch fee, a staff shift
  | 'per-event'     // paid once for the whole event: a three-day market pitch
  | 'per-order'     // scales with tickets: bags, receipt roll, cutlery
  | 'per-unit'      // scales with items sold
  | 'per-revenue';  // a true percentage: delivery commission, card fees
```

`amount` means rupees for the first four and **percentage points** for
`per-revenue`. That ambiguity is deliberate and must be documented on the type,
because it is the one place the field changes meaning.

The input form then explains itself, because the unit follows the basis:

- `per-session` → *Rs [1200] for this session*
- `per-order` → *Rs [4] per ticket*
- `per-unit` → *Rs [12] per item sold*
- `per-revenue` → *[18] % of sales*

Note that `per-event` is now a **basis**, not just a target. Today a cost carries
either a `sessionId` or an `eventId` and the attachment is what makes it
event-level. Keeping both is redundant but harmless: `basis: 'per-event'`
requires `eventId` to be set, and that constraint should be asserted rather than
assumed.

**Migration of existing rows.** `kind: 'fixed'` → `basis: 'per-session'`.
`kind: 'variable'` → `basis: 'per-session'` **as well**, because that is the only
mapping that does not invent information. Do not attempt to infer that a cost
named "fuel" was per-revenue. Instead show a one-time, dismissible banner in the
Costs panel listing every migrated `variable` entry and inviting re-filing, with
the old `kind` shown so the user can see what it was. Silently reinterpreting a
historical cost changes a historical figure, which is invariant 3's territory
even though costs are not frozen the way line costs are.

### A3 — Break-even, non-circular

```
fixed         = Σ(per-session in scope) + Σ(per-event allocated to scope)
perUnitCost   = COGS per unit + Σ(per-unit)
perOrderCost  = Σ(per-order)
revenueRate   = Σ(per-revenue) / 100

contributionPerUnit = price × (1 − revenueRate) − perUnitCost − perOrderCost / avgBasket
breakEvenUnits      = fixed ÷ contributionPerUnit
breakEvenRevenue    = fixed ÷ contributionRatio
```

Every term is now known independently of the answer.

**Event cost allocation needs a stated rule.** A `per-event` cost inside a
session scope has to be divided somehow. Options, in order of preference:

1. **Do not allocate.** A session scope shows session costs only, and states
   plainly that the event carries Rs X separately, with a link to the event
   scope. Honest, and avoids inventing an apportionment nobody chose.
2. Allocate by share of event revenue. Defensible, but it means a session's
   break-even changes retroactively when a later session in the same event
   trades well, which is the same class of moving-target problem being fixed.

**Take option 1.** Write it as an ADR, because it is the kind of thing a later
session will otherwise "fix" by adding allocation.

The existing three `blocked` reasons in `breakEven` are good and should survive:
no fixed costs logged, no costed sales, contribution at or below zero. Add a
fourth: contribution positive but `avgBasket` zero, which makes `perOrderCost`
undefined.

### A4 — Item break-even splits in two

`breakEvenByItem` currently reads `item.netRevenue / item.units` — the realised
historical price. It cannot respond to a menu price change by construction, and
after a few sales at a new price it reports a blend that is neither price. That
is the "break-even doesn't update when I change the price" complaint and the
"conflicting information after sales are made" complaint, and they are the same
bug.

Split into two figures, both shown, both labelled:

- **Margin today** — from the current `menuItem.price` and the current recipe
  cost via `unitCostFor`. Responds instantly to a price or recipe change. This is
  the planning number.
- **Realised margin** — from what actually sold at what it actually cost, from
  the frozen `unitCost` snapshots. Never moves when a price changes, because
  history didn't (invariant 3).

Flag a divergence over ~10% — that is usually either a price change that has not
worked through, or a recipe that has drifted from what is being made.

**A note on `unitCostFor` and invariant 2.** Margin today is computed from a live
recipe lookup, which returns `complete: false` when an ingredient has no cost.
When incomplete, show `—` and name the missing ingredient. Do not show a margin
computed from a partial cost; that is exactly the flattering-answer failure
invariant 2 exists to prevent.

### A5 — Remove `unitCostOverride`

- Delete `CostField` from `MenuItemRow` in `SettingsView.tsx`. Stop writing the
  field.
- **Keep the field on the type and keep `unitCostFor` reading it** — gate
  features, never parsers, and in-memory rows may still carry it during a
  session. Mark it deprecated in `types.ts` with a pointer to this phase.
- Replace it on the menu row with **read-only** resolved cost:
  *"Rs 84 to make · 61% margin"*, or when incomplete, *"Rs 84 to make · no cost
  for Buns"*. Tap to jump to Assign Stock. It is a fact about the item, not a
  control.
- **The ready-made case gets solved properly.** The original justification was a
  deal containing something bought in finished — a bottled drink, a packet of
  crisps. The right model is a `pcs` stock item with a cost, assigned like
  anything else. It costs one stock row and the drink then appears in stock
  levels, reorder lists and the money ledger, none of which happen when its cost
  is typed into a menu field. Document this in `01-DOMAIN.md` where the current
  override paragraph sits.

`useMenu.addAssignment` and `removeAssignment` — kept but unreferenced after
Phase 0 — are the handlers this needs. They were kept for exactly this.

### A6 — Merge the two purchase figures

`stockPurchasesValue` and `foodCost`'s internal purchase loop compute the same
thing with different rules: the former counts `added` and `packet`; the latter
counts `added`, `packet` **and** `correction`. So the two disagree about the same
delivery, which is a direct cause of "conflicting information."

Make `foodCost` call `stockPurchasesValue`. One function, one rule: **a purchase
is a receipt.** A correction is not a purchase — it carries no cost data and
means "the shelf disagreed with the book." If stock was received, it should be
logged as a receipt.

This is a behaviour change to a historical figure and needs an ADR.

### A7 — Verification

- `metrics.check.ts` gains: break-even with each basis in isolation; break-even
  invariance under increasing revenue with a fixed cost set (the property that
  was broken); margin-today changing when a menu price changes and realised
  margin not changing; each `blocked` reason reachable.
- `smoke.check.mjs` gains a cost-entry step.
- ADRs: **012** cost basis, **013** event costs are not allocated across
  sessions, **014** purchases are receipts only, **015** the menu carries no cost
  override.

---

## Phase 1B — Truthful ledger reads

**Goal.** Make undo stop changing the statistics.

### B1 — The defect

`useStock.reverseStockChanges` writes every reversal as `reason: 'correction'`
with **no `reversed` flag**, while `undoMovement` sets the flag on both rows.
Two paths, two behaviours, and the analytics layer cannot tell a reversal from a
genuine correction.

Combined with A6's finding, the observable symptoms are: undo a delivery and
redo it, and food cost and stock purchases now report different numbers for the
same event; undo an order and food cost reads a phantom purchase that never
happened.

### B2 — A distinct reason, and a flag on both rows

Add `'reversal'` to `StockMovementReason`, separate from `'correction'`.

- A **correction** is a human saying the shelf disagrees with the book.
- A **reversal** is the program undoing itself.

They are not the same event and must not share a bucket. `MOVEMENT_LABELS` gains
an entry; the display label should be "Undone" rather than "Reversal", because
that is what the user did.

**Set `reversed` on both rows, in `buildMovement`, not at each call site.** The
current split — one path sets it, the other doesn't — is the actual defect, and
enforcing it centrally is what stops it recurring.

### B3 — The filter must not depend on pairing

Because of the 20,000-line cap, a pair can be split by trimming. So:

```ts
/**
 * Movements that represent real events.
 *
 * `reversed` is set on both rows of a reversal pair, so this needs no pairing
 * logic — which matters, because the ledger cap can trim one half of a pair and
 * leave the other. An orphaned half is still marked and still excluded.
 */
export function effectiveMovements(all: StockMovement[]): StockMovement[] {
  return all.filter(m => !m.reversed);
}
```

Route **every** consumer through it: `stockPurchasesValue`, `foodCost`,
`shrinkageValue`, `inventoryTurnover`, `deadStock`, `consumptionRate`. There are
six and they currently disagree.

**One caution.** `ledgerLevelsAt` must **not** use this filter. It reads
`resulting`, which is the physical level after the row was written, and a
reversal genuinely did move the shelf. Excluding it there would make historical
levels wrong. This distinction — *effective for economics, all rows for levels* —
is subtle enough that it needs a comment at both sites and a line in
`03-INVARIANTS.md`.

### B4 — Redo must restore the original's meaning

Currently `undoMovement`'s redo calls `reverseStockChanges` with the original
delta, appending a generic `correction`. So after undo→redo, a Rs 8,000 delivery
exists on the shelf but is invisible to `stockPurchasesValue`, which only counts
`added` and `packet`.

**Redo appends a row that duplicates the original's semantics** — same `reason`,
same `unitCost` and `totalCost`, with `referenceType: 'movement'` and
`referenceId` pointing at the original. The original and its reversal stay
netted out; the new row is a live receipt and counts correctly.

This preserves append-only, needs no pairing, and is cap-safe.

### B5 — Orders

An undone void must not leave the order in `voidStats`. `voidedAt` and
`voidReason` are cleared on reversal. The fact that it happened is recoverable
from the undo stack and, later, from the mutation log.

Check `useOrders.voidOrder`'s undo path against this — Phase 0 reports it moves
all three things together, so this may already be correct. Verify rather than
assume.

### B6 — Display

Stock history hides reversal pairs by default, with a **Show undone** toggle.
The ledger being append-only is correct; the display showing add / remove / add
as three equal events is what makes it read as confusing.

### B7 — Verification

- `metrics.check.ts`: receive → undo → redo, and assert `stockPurchasesValue`
  and `foodCost.purchases` both report the delivery exactly once at every step.
- The orphan case: construct a ledger with a reversal whose original has been
  trimmed, and assert the orphan is excluded.
- ADRs: **016** reversal is a distinct reason with a flag on both rows;
  **017** effective-for-economics versus all-rows-for-levels.

---

## Phase 1C — The three tables

**Goal.** Replace `Overview / Sales / Orders / Costs` with three screens that
each answer one question.

### C1 — First, the frame

The reason the numbers feel incoherent is not that they are wrong — most of them
are right. It is that four different money-shaped things are presented adjacently
with nothing saying which is which:

| Thing | Source | Question |
|---|---|---|
| **Revenue** | orders, net of discount, ex-tax | What did we sell? |
| **COGS (consumed)** | frozen `CartItem.unitCost` | What did what we sold cost to make? |
| **Outlay (purchased)** | stock receipts | What money left the till for stock? |
| **Operating costs** | `CostEntry` | What did trading cost, other than ingredients? |

And the rule:

> **Profit is measured on consumption. Cash is measured on outlay.**

A Rs 8,000 mince delivery and Rs 900 of mince eaten are not competing answers to
"what did stock cost me" — they answer different questions. Label them and the
incoherence goes without changing a calculation.

Write this as a short explainer page reachable from each table. Not a tooltip; a
page. A number with no frame is decoration.

### C2 — Finance — *did this pay?*

One row per session, event or day depending on scope:

| Sales | Discounts | Net | COGS | Gross profit | Op. costs | Net profit | Margin | Break-even | Passed B/E at |
|---|---|---|---|---|---|---|---|---|---|

**Passed break-even at** — naming the ticket number and clock time the session
covered its costs — is the most useful column on the screen and does not exist
yet. Below the table: cash versus transfer reconciliation, and cost coverage as
an honesty bar.

### C3 — Inventory — *what do I have and what is it doing?*

One row per stock item:

| Item | On hand | Value | Used | Bought | Waste | Count variance | Days cover | Reorder at | Status |
|---|---|---|---|---|---|---|---|---|---|

`Days cover` = on hand ÷ consumption per trading hour × expected trading hours.
`consumptionPerHour` exists in `lib/inventory.ts` and is barely surfaced. Default
sort is `Days cover` ascending — this is the table that tells you what to buy.

### C4 — Business — *what's working?*

One row per menu item:

| Item | Sold | Revenue | Cost | Margin today | Realised margin | Share of profit | Trend | Ran out |
|---|---|---|---|---|---|---|---|---|---|

Both margins from A4. **Share of profit** rather than share of revenue, because
the highest-revenue item is frequently not the one paying for the day.
**Ran out** from `OversellEvent` — the column that says what you are leaving on
the table.

### C5 — Three rules for all three

1. Every number is traceable. Click a cell, see the rows behind it.
2. An unknown is `—`, never `0`. The engine already respects this; the UI must
   not paper over it.
3. No sparklines, no donuts, no KPI grid. A table with a good default sort beats
   a dashboard for someone who already knows their business.

### C6 — Respect the Phase 0 memo discipline

`AnalyticsView` holds scope outputs steady by value (`useStableList`,
`useStableRange`) so the clock tick does not rebuild the expensive tables. Three
new tables are three new expensive consumers. Any new memo must key on the
stabilised values, and must not take `now` unless it genuinely depends on it —
`Passed break-even at` does; the item table does not.

---

## Phase 1D — History and the money ledger

### D1 — All Orders stays where it is

It is the cashier's screen: find ticket 34, check whether the family in the
corner has been served, reprint a receipt. That is a live-service tool. It
belongs in the Orders section (which Phase 5 merges), must stay usable by someone
with no analytics access, and must not grow cost or margin columns.

`OrdersExplorer` in Analytics is the reporting view of the same rows. Same data,
two purposes, two access levels. The duplication is correct.

### D2 — Stock history moves into Analytics

The per-item ledger stays in the Quick Add panel, where it answers "what happened
to the mince." The cross-item, cross-time view moves to Analytics, where it
answers "what happened last Saturday."

One row per movement, all items, filterable by item, reason and date, reversal
pairs hidden by default (B6). Reuse the `OrdersExplorer` shell — the search,
range and export machinery in `analytics/search.ts` already fits.

### D3 — Financial history — the gap

Nothing currently answers "where did the money go this month." `CostsPanel` lists
cost entries and nothing else.

Build a **money ledger**: one chronological table unioning four sources.

| When | Kind | Description | In | Out | Running |
|---|---|---|---|---|---|
| 14 Aug 09:20 | Purchase | Beef mince — 5 kg | | 4,250 | −4,250 |
| 14 Aug 11:00 | Cost · per-session | Stall pitch fee | | 1,200 | −5,450 |
| 14 Aug 18:40 | Sales | Session · 14 Aug — 47 orders | 22,180 | | 16,730 |
| 14 Aug 18:40 | Cost · per-revenue | Delivery commission 18% | | 640 | 16,090 |

Sources: receipts from `effectiveMovements`, cost entries by basis, and sales
rolled up **per session** rather than per order — an itemised list of 400 tickets
is the order log again, not a financial history.

Two rules:

1. **It is a cash view, not a profit view.** Say so at the top, with a link to
   Finance. This is the outlay half of C1's split.
2. Every row drills through to what produced it.

Maps almost one-to-one onto the Sales report export in Phase 6.

---

## Phase 1E — Forecasting

Two horizons, two mechanisms. Do not make one model serve both.

### E1 — Within-day pacing

Build a **session pace curve**: for each past session, the cumulative share of
final revenue reached at each 15-minute mark of elapsed *trading* time — pauses
excluded, which `sessionTradingMs` already handles. Group by comparable shape
(weekday, event) rather than averaging a Saturday market with a Tuesday evening.

Projection = revenue so far ÷ expected cumulative share at this point. Show a
band, not a point: p25 / p50 / p75 across past curves.

> Rs 14,200 so far, 2h 40m in. Similar sessions were 61% done at this point.
> **Projected: Rs 20,000 – 26,500.** Break-even at Rs 18,400 — likely passed
> around 4:40pm.

Requires 4–5 comparable sessions. Below that it says so rather than
extrapolating from one Saturday. This is a live figure and takes `now`
explicitly (ADR-009).

### E2 — Prep forecasting

The one that saves money, and where the oversell data earns its keep.

Use **demand**, not sales:

```
demand = unitsSold + oversoldQuantity
```

If you brought 40 patties and sold 40, mean sales says stock 40 — but you may
have turned away 15 people. `CartItem.oversoldQuantity` and `OversellEvent`
record this and almost nothing at this scale does.

Stock to a **quantile, not a mean.** The costs are asymmetric: leftover mince
goes in the freezer, a stockout is a lost sale and a customer who walks past next
time. Default p80, with a slider from p50 (run lean) to p95 (never run out).

Output is a **prep list**, not a chart:

| Item | Typical demand | Suggested prep (p80) | Ingredients needed | Have | Short by |
|---|---|---|---|---|---|

Ingredient roll-up via `requirementsFor`, which already flattens deals correctly.
That table is the thing you print and take shopping.

Keep the existing by-event popularity trend — it answers "is this item growing"
— but label it **Trend**, not prediction.

---

## What Phase 1 does not touch

Recorded so it does not creep in:

- Row versioning and the mutation log. Still deferred; still the natural next
  foundation piece after Phase 1.
- The `channel` field on orders.
- Navigation, the five-to-four merge, the navbar.
- Units, portions, the grill, Drain → Delete.
- Visual direction.
- `useSettings.hydrate`'s first-failure behaviour (Phase 0 bug 3) — unchanged,
  but worth a look while `useSettings` is open for any other reason.
- `sync_now`'s row-count direction heuristic (Phase 0 bug 4) — V2.

---

## Sequencing

```
1A  money model         ← start here; event_id is losing data now
1B  ledger reads        ← independent; could run first if preferred
1C  three tables        ← needs both
1D  history + money     ← needs 1B
1E  forecasting         ← needs 1B, better after 1D
```

1A and 1B are the ones worth doing slowly. They change what the numbers mean,
and every table in 1C is only as good as they are. 1C is the visible payoff and
will be tempting to start early; starting it before 1A lands means building three
tables on top of a break-even figure that is about to be rewritten.

If Phase 1 has to stop somewhere, stop after 1C. 1D and 1E are additive; 1A–1C
are the difference between a program that produces numbers and one you would act
on.
