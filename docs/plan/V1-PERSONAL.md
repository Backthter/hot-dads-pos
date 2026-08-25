# Hot Dads POS — V1, the personal build

*The version that has to work for your stall first. Everything commercial is
downstream of this being correct.*

---

## Where this starts

I read the codebase before writing this. It is worth being clear about what is
already good, because the plan below is mostly not a rewrite — it is a set of
corrections to a structure that is largely sound.

**What is already right, and should not be disturbed:**

- `types.ts` is a genuinely well-specified domain model. The distinctions it
  draws — missing cost is not zero cost, voiding is not deletion, session
  membership is stored rather than derived, `orderNumber` versus `sessionTicket`
  — are the distinctions that most POS systems get wrong and then cannot fix.
- The stock ledger is append-only and every movement records `resulting`, which
  means historical stock is reconstructable by lookup rather than accumulation.
  `ledgerLevelsAt` is exactly right, including the trick of reading backwards
  from a later movement for items whose ledger starts after the mark.
- `OversellEvent` is a direct measurement of censored demand. Almost nothing at
  this price point records that. It is the single most valuable row type in the
  schema for forecasting and it is currently barely used.
- The design system pass worked. `ui/tokens.ts` + `SectionTheme` means the
  visual overhaul in Phase 7 is a token edit, not a component sweep.

**What is structurally in the way:**

- `App.tsx` is 3,533 lines and owns every mutation in the program. Every phase
  below has to touch it, which means every phase below is riskier than it needs
  to be. This is the first thing to fix.
- Analytics captures `Date.now()` at render and never ticks. That is the whole
  of the "statistics don't update live" problem.
- Undo writes `reason: 'correction'` for every reversal, and `foodCost` counts
  positive corrections as purchases. That is the whole of the "undo confuses the
  statistics" problem, and it is a four-line bug with a large blast radius.
- Sync pushes whole tables with `INSERT OR REPLACE` and omits `stock_movements`
  entirely. Not a V1 problem, but a V1 decision — see Phase 0.3.

---

## The decision that shapes everything else: one codebase, two editions

You framed this as "make the personal version, then strip it down." Do not strip
it down. Stripping means a fork, and a fork means every bug you fix after the
split has to be fixed twice, by hand, forever — while you are also running a
business and supporting paying customers.

Build the seam in V1 instead. It costs roughly a day now and saves the entire
V2 project later.

```ts
// src/app/edition.ts
export type Edition = 'personal' | 'standard' | 'connected';

export interface Capabilities {
  /** Burger-shop specifics. Personal only, permanently. */
  grillBoard: boolean;
  portionUnits: boolean;
  /** Sessions and events. Personal + commercial — stalls need these. */
  sessions: boolean;
  /** Multi-user, roles, hashed credentials. V2. */
  accounts: boolean;
  cloudSync: boolean;
  deliveryChannels: boolean;
  payments: boolean;
}

export const EDITION: Edition = (import.meta.env.VITE_EDITION ?? 'personal');
export const can: Capabilities = CAPABILITIES[EDITION];
```

Two rules make this work rather than rot:

1. **Capabilities gate features, never data.** A commercial build must still be
   able to *open* a database that has portion units in it without crashing. Gate
   the UI and the behaviour; never gate the parser.
2. **The flag is read at the edge, not threaded through.** `can.grillBoard` is
   checked where the Grill section renders and where the ticket action menu
   builds its options. It does not become a prop that every component passes
   down, or you have re-invented the fork with extra steps.

Everything in Phase 0 below is written for the commercial build's benefit and
paid for by V1's own needs. That is the test I applied: if a piece of V2
groundwork does not *also* fix something you are complaining about today, it is
not in this document.

---

## Phase 0 — Foundations (prepone from V2)

### 0.1 Break up `App.tsx`

Not cosmetic. Every subsequent phase edits this file, and a 3,500-line file with
~40 handlers closing over `dataSnapshotRef` is where merge pain and subtle state
bugs come from.

Extract along the lines the domain already suggests:

| New module | Owns |
|---|---|
| `state/useOrders.ts` | cart, checkout, board moves, void, edit sessions |
| `state/useStock.ts` | `applyStockChanges`, `buildMovement`, reversal, stocktake, drain |
| `state/useMenu.ts` | menu items, categories, assignments, deals |
| `state/useSessions.ts` | start/pause/resume/end, events, cost entries |
| `state/useSettings.ts` | tax, PIN, grill capacity, scale, theme |

Each returns `{ state, actions }` and records its own undo entries. `App.tsx`
becomes composition and layout. Target: under 400 lines.

Do this first. It is boring and it makes everything after it cheaper.

### 0.2 A clock, so live numbers are live

Add `ui/useNow.ts`:

```ts
/** Shared ticking clock. One interval for the whole app, not one per screen. */
export function useNow(intervalMs = 30_000): number
```

Then thread `now` into `resolveScope`, `foodCost`, `sessionTradingHours`, and
every `useMemo` that currently calls `Date.now()` implicitly. Tick at 30s
normally; 5s while a session is active and the Analytics screen is mounted.

This alone fixes:
- "Today" ranges freezing at whatever time you opened the screen
- Revenue-per-trading-hour not moving during a live session
- Break-even progress not advancing as sales come in

### 0.3 Row versioning and soft delete, from day one

Every syncable table gets three columns now, used by nothing in V1:

```sql
updated_at  INTEGER NOT NULL,   -- ms, set on every write
deleted_at  INTEGER,            -- soft delete; NULL means live
origin      TEXT NOT NULL       -- device id that last wrote this row
```

Why now rather than in V2: backfilling `updated_at` onto rows that already exist
is a guess. Rows written from today forward carry a true timestamp. Given the
personal build will have a year of real data in it before the commercial build
ships, that year is either syncable or it isn't, and the decision is being made
now whether you make it deliberately or not.

Also: **stop hard-deleting anything.** Orders already void rather than delete.
Extend the same treatment to stock items, menu items, categories, and cost
entries. A deleted menu item still has to resolve for historical orders that
reference it — which is already a latent bug in `resolveDealComponent`.

### 0.4 The mutation log

Every write goes through one function that appends to an ordered log before
touching state:

```ts
interface Mutation {
  id: string;
  at: number;
  origin: string;
  entity: 'order' | 'stock' | 'menu' | 'session' | 'cost' | 'settings';
  op: string;              // 'order.void', 'stock.receive', ...
  payload: unknown;
  /** Set when this mutation exists to reverse another one. */
  reverses?: string;
}
```

This is the piece that pays for itself three times:

- **Undo becomes a first-class record** rather than a closure held in memory.
  Undo history survives a restart. More importantly, a reversal is *identifiable
  as a reversal* by every consumer, which is the fix for Phase 1.6.
- **Sync in V2 becomes a log-shipping problem**, which is tractable, instead of
  a table-diffing problem, which is not.
- **Audit** — "who changed the price of the burger and when" — falls out for
  free, and that is a real commercial feature.

`history.tsx` keeps its current action-based API. It just gains a persistent
backing store.

### 0.5 Order channel

Add to `Order`:

```ts
/** Where the order came from. Walk-in is the default and always will be. */
channel?: 'walkin' | 'phone' | 'foodpanda' | 'other';
/** Commission taken by the channel, in rupees, resolved at checkout. */
channelFeeAmount?: number;
```

You are not building the foodpanda integration in V1 (see the V2 doc for why it
is architecturally impossible in a desktop-only build). But a delivery order and
a walk-in order have different economics, and if you don't record which is which
now, every historical comparison you'd want in V2 is unavailable. One optional
field, a segmented control in the ticket, and a column in analytics.

### 0.6 The sync tables are incomplete — fix this early

Since sync is actually in use, this is a live bug rather than a V2 note.

`src-tauri/src/sync.rs` declares:

```rust
const SYNC_TABLES: &[&str] = &[
    "menu_items", "app_categories", "trading_events", "trading_sessions",
    "cost_entries", "orders", "order_items", "parked_sessions",
    "parked_session_cart_items", "stock_items", "stock_assignments", "app_state",
];
```

Three tables are missing: **`stock_movements`**, **`inventory_snapshots`**, and
**`oversell_events`**.

The consequence is not subtle. A synced device receives stock *levels* but not
the ledger that produced them, so on any machine that wasn't the one doing the
stocking:

- `foodCost` reports no purchases and a wrong opening value
- `stockPurchasesValue` returns zero
- `shrinkageValue`, `inventoryTurnover`, `deadStock` and `consumptionRate` are
  all empty or wrong
- The forecasting in Phase 1.7 would have nothing to work from
- Stock history is blank

If you have ever compared analytics between two machines and found they
disagreed, this is why.

**The fix is three lines and a migration**, and it should go in before anything
in Phase 1 — otherwise you'll spend Phase 1 debugging analytics against a device
that's missing a third of its inputs.

Order matters in that array (the comment about sessions preceding orders is
correct and deliberate). Insert stock movements *after* `stock_items` and before
`stock_assignments`; snapshots and oversells last, since nothing references them.

Two follow-ups while you're in there:

- **`INSERT OR REPLACE` on an append-only ledger is wrong even when the table is
  listed.** For `stock_movements`, `oversell_events` and `order_items`, use
  `INSERT OR IGNORE` — the row is immutable once written, and REPLACE risks
  overwriting a good row with a stale copy from a device that hasn't caught up.
- **A first sync after this change needs a full backfill**, not an incremental
  push, or the second device will have movements from today forward and nothing
  before. Add a one-time "resend everything" action to `SyncSettings.tsx`.

This is a patch, not a rebuild. The append-only redesign is V2 Phase C.

### 0.7 Documentation that survives a context window

From here on, each phase writes a markdown file into `docs/` as part of the work,
not after it. The purpose is specific: so that a future session — yours or an
AI's — can pick up a phase with no memory of the previous ones and still make
correct decisions.

```
docs/
  00-ARCHITECTURE.md      the map: what lives where, what depends on what
  01-DOMAIN.md            what a session, a cost, a movement, a portion mean
  02-DECISIONS.md         numbered decision records — the why, and what was rejected
  03-INVARIANTS.md        rules code must never break
  phases/
    PHASE-0-FOUNDATIONS.md
    PHASE-1-ANALYTICS.md
    ...
```

**`02-DECISIONS.md` is the important one.** One entry per decision, numbered,
never edited once written — superseded instead:

```markdown
## ADR-004 — Cost entries carry a basis, not a fixed/variable kind
**Status:** accepted · 2026-08 · supersedes ADR-002
**Context:** `CostKind: 'fixed' | 'variable'` forced break-even to derive a rate
by dividing a typed total by revenue-so-far, making the break-even target move
as sales came in.
**Decision:** `CostBasis` with five explicit bases. Amount means rupees for four
of them, percentage points for `per-revenue`.
**Rejected:** keeping `variable` and documenting the behaviour — the behaviour is
wrong, not merely undocumented.
**Consequences:** migration required; `breakEvenByItem` and `breakEven` rewritten;
foodpanda commission has a natural home in V2.
```

**`03-INVARIANTS.md` is what stops a fresh session from breaking something
subtle.** Rules like:

- The stock ledger is append-only. Nothing is ever deleted or edited. Reversals
  append a paired compensating row.
- Missing cost is not zero cost. `undefined` and `0` are different claims and
  must stay distinguishable through every layer.
- Historical figures never move. A cost snapshot frozen at checkout is not
  recomputed when a price or recipe changes.
- Session membership is stored, never derived from timestamps.
- Capabilities gate features, never parsers. Any edition must open any database.

Each phase file follows one shape: **Goal · What changed · Files touched ·
Invariants introduced · How to verify · What the next phase can now assume.**
That last section is what makes the chain work — it's the handoff.

Keep `CHANGES.md` as the human-facing narrative. It's genuinely well written and
does a different job. `docs/` is the machine-facing reference.

---

## Phase 1 — The analytics rebuild

This is the largest phase and the one you're most frustrated by. Your diagnosis
was right; here is what's actually causing each symptom.

### 1.1 First, decide what a cost *is*

The reason the sessions system made costs unclear is that there are four
different money-shaped things in the app and no document says which is which:

| Thing | Where it lives | What question it answers |
|---|---|---|
| **Revenue** | `Order` lines, net of discount, ex-tax | What did we sell? |
| **COGS (consumed)** | `CartItem.unitCost` snapshots | What did what we sold cost to make? |
| **Outlay (purchased)** | `StockMovement` receipts | What money left the till for stock? |
| **Operating costs** | `CostEntry` | What did trading cost, other than ingredients? |

And the rule that resolves the confusion:

> **Profit is measured on consumption. Cash is measured on outlay.**
> They are different questions and they get different screens. Neither is wrong;
> mixing them in one table is what makes the numbers feel incoherent.

Concretely — `stockPurchasesValue` and `foodCost.theoretical` are both currently
surfaced near each other with no framing, so a Rs 8,000 mince delivery and Rs 900
of mince eaten appear as competing answers to "what did stock cost me." They are
answers to different questions. Label them as such and the incoherence
disappears without changing a single calculation.

Write this as a short in-app explainer, reachable from each screen. Not a
tooltip — a page. The reason your metrics "have the illusion of being helpful"
is that they are stated without a frame, and a number with no frame is decoration.

### 1.2 Replace `CostKind` — this is what's wrong with variable costs

You said you don't understand what the program calculates when you enter a
variable cost. Here is what it does, and it's fair enough that it's confusing:

```ts
// metrics.ts, breakEven()
const variableRatio = totals.netRevenue > 0 ? costs.variable / totals.netRevenue : 0;
const contributionRatio = grossRatio - variableRatio;
```

You type "Fuel — Rs 1,200, variable." The program divides 1,200 by however much
revenue exists *so far in the current scope* and treats the result as a
percentage drag on every future sale. So:

- At Rs 4,000 of sales, fuel is a 30% drag and break-even looks unreachable.
- At Rs 20,000 of sales, fuel is a 6% drag and break-even has already passed.
- The break-even target therefore **moves as you sell**, which defeats the point
  of a break-even target.

It is circular. A variable cost is supposed to be a rate that generates a total;
here a total is being back-solved into a rate against the very revenue it is
meant to be predicting.

**Replace `CostKind` with an explicit basis:**

```ts
export type CostBasis =
  | 'per-session'   // paid once per service: pitch fee, a staff shift
  | 'per-event'     // paid once for the whole event: a three-day market pitch
  | 'per-order'     // scales with tickets: bags, receipt roll, cutlery
  | 'per-unit'      // scales with items sold
  | 'per-revenue';  // a true percentage: delivery commission, card fees

export interface CostEntry {
  // ...
  basis: CostBasis;
  /** Rupees for the first four. Percentage points for 'per-revenue'. */
  amount: number;
}
```

Now the input form explains itself, because the unit changes with the basis:

- `per-session` → "Rs [1200] for this session"
- `per-order` → "Rs [4] per ticket"
- `per-unit` → "Rs [12] per item sold"
- `per-revenue` → "[18] % of sales" ← this is where foodpanda's commission goes,
  and it's the only place a percentage belongs

And break-even stops being circular:

```
fixed        = Σ(per-session) + Σ(per-event allocated to this session)
perUnitCost  = COGS/unit + Σ(per-unit)
perOrderCost = Σ(per-order)
revenueRate  = Σ(per-revenue) / 100

contribution/unit = price × (1 − revenueRate) − perUnitCost − perOrderCost/avgBasket
break-even units  = fixed ÷ contribution/unit
```

Every term is now known independently of the answer. The target stops moving.

**Migration:** existing `kind: 'fixed'` → `basis: 'per-session'`. Existing
`kind: 'variable'` → `basis: 'per-session'` too, with a one-time banner listing
those entries and asking you to re-file the ones that are genuinely per-order or
per-revenue. Do not guess. Silently reinterpreting historical costs is exactly
the class of thing that makes the numbers untrustworthy.

### 1.3 The three tables

You want three screens, each one large digestible table. Agreed — and the
current tab set (`Overview / Sales / Orders / Costs`) is not that. Replace with:

**Finance** — "did this pay?"

One table, one row per session/event/day depending on scope, columns:

| Sales | Discounts | Net | COGS | Gross profit | Op. costs | Net profit | Margin | Break-even | Past B/E at |
|---|---|---|---|---|---|---|---|---|---|

With a totals row, and a "Past break-even at" column that names the ticket number
and clock time at which the session covered its costs. That single column is the
most useful thing on the screen and doesn't exist yet. Below the table: cash vs
transfer reconciliation, and cost coverage as an honesty bar.

**Inventory** — "what do I have and what is it doing?"

One row per stock item:

| Item | On hand | Value | Used (period) | Bought (period) | Waste | Count variance | Days cover | Reorder at | Status |
|---|---|---|---|---|---|---|---|---|---|

`Days cover` = on hand ÷ consumption per trading hour × expected trading hours.
`consumptionPerHour` already exists in `lib/inventory.ts` and is barely surfaced.
This is the table that tells you what to buy, so it needs to be sortable by
`Days cover` ascending and that should be the default.

**Business** — "what's working?"

One row per menu item:

| Item | Sold | Revenue | Cost | Margin/unit | Margin % | Share of profit | Trend | Ran out |
|---|---|---|---|---|---|---|---|---|

`Share of profit` rather than share of revenue, because the highest-revenue item
is frequently not the one paying for the day. `Ran out` comes from
`OversellEvent` and is the column that tells you what you're leaving on the table.

**Three rules for all three tables:**

1. Every number is traceable — click a cell, see the rows behind it.
2. An unknown is `—`, never `0`. The existing engine already respects this
   (`grossMarginPct: number | null`); the UI must not paper over it.
3. No sparklines, no donuts, no KPI card grid. You asked for tables. A table with
   a good sort order beats a dashboard for someone who already knows their
   business.

### 1.4 Break-even that tracks the menu

You noticed break-even by item doesn't update when you change a menu price. It's
this, in `breakEvenByItem`:

```ts
const price = item.netRevenue / item.units;   // realised historical price
```

It reads the average price things *actually sold at* in the period, which by
definition cannot respond to a price change until new sales come in at the new
price. And after a few sales at the new price you get a blended average that is
neither the old price nor the new one — which is your "conflicting information
after sales are made."

**Split it into two figures, both shown, both labelled:**

- **Margin today** — from the *current* `menuItem.price` and the *current*
  recipe cost via `unitCostFor`. Responds the instant you change either. This is
  the planning number: "if I sell 40 of these tomorrow, what do I make?"
- **Realised margin** — from what actually sold at what it actually cost, from
  the frozen `unitCost` snapshots. This is the historical number and it must
  *not* move when you change a price, because history didn't.

Showing one of these and calling it "break-even" is what makes the screen feel
like it's lying. Showing both, side by side, with a divergence flag when they
differ by more than ~10%, turns a bug into the most informative thing on the page.

### 1.5 Live updates

Covered by Phase 0.2 — but audit specifically:

- `resolveScope` (captures `now` for session spans)
- `foodCost` (the `range.end > now` branch chooses a different closing basis)
- `sessionTradingHours`
- `breakEven` progress
- Anything reading `activeTradingHours`

Add a `metrics.check.ts` case that renders at T, advances a fake clock by an
hour, re-renders, and asserts the trading-hours figure moved. There's already a
check harness; extend it rather than starting one.

### 1.6 Stop undo from lying to the statistics

This is a real bug with a small fix and a large effect.

**What happens now:** `reverseStockChanges` writes every reversal as
`reason: 'correction'` with no `reversed` flag. And in `foodCost`:

```ts
if (m.reason !== 'added' && m.reason !== 'packet' && m.reason !== 'correction') continue;
purchases += m.totalCost ?? unit * m.delta;
```

Positive corrections count as purchases. So:

- Add a delivery, undo it, redo it → the redo writes a *fresh* positive
  correction. Original is flagged `reversed` and excluded; the redo is counted.
  Net effect on `stockPurchasesValue`: the purchase vanishes (it only counts
  `added`/`packet`). Net effect on `foodCost.purchases`: counted once. **The two
  screens now disagree about the same delivery.**
- Undo an order → stock is returned via a positive `correction` → `foodCost`
  reads a phantom purchase that never happened.

**The fix, in three parts:**

1. **A distinct reason.** Add `'reversal'` to `StockMovementReason`, separate
   from `'correction'`. A correction is a human saying "the shelf disagrees with
   the book." A reversal is the program undoing itself. They are not the same
   event and must not share a bucket.
2. **Pair them explicitly.** Every reversal carries `referenceId` pointing at
   what it reverses, and *both* rows get `reversed: true`. Enforce this in
   `buildMovement` rather than at each call site — right now `handleUndoMovement`
   sets it and `reverseStockChanges` doesn't, which is the actual defect.
3. **One filter, used everywhere.** Add to `metrics.ts`:
   ```ts
   /** Movements that represent real events. Reversal pairs net to nothing. */
   export function effectiveMovements(all: StockMovement[]): StockMovement[]
   ```
   and route `stockPurchasesValue`, `foodCost`, `shrinkageValue`,
   `inventoryTurnover`, `deadStock`, and `consumptionRate` through it. No
   consumer should be re-deriving this rule; there are six of them and they
   currently disagree.

Same treatment for orders: an undone void must not leave the order counted in
`voidStats`. `voidedAt` should be cleared on reversal, and the mutation log
(0.4) keeps the fact that it happened.

**And in the UI:** stock history and order history hide reversal pairs by
default, with a "Show undone" toggle. Right now the ledger reads as a confusing
sequence of add/remove/add, which is your complaint, and the ledger being
append-only is *correct* — it's the display that's wrong, not the storage.

### 1.7 Forecasting

Two different horizons, two different mechanisms. Don't try to make one model do
both.

**Within-day pacing** — "am I on track, and where will I finish?"

Build a **session pace curve**: for each past session, the cumulative share of
final revenue reached at each 15-minute mark of elapsed *trading* time (pauses
excluded, which `sessionTradingMs` already handles correctly). Average across
sessions of the same shape — group by weekday and by event, since a Saturday
market and a Tuesday evening are not the same curve.

Then today's projection is: `revenue so far ÷ expected cumulative share at this
point`. Show it as a band, not a point: p25 / p50 / p75 from the past curves.

The honest thing to display, and the thing that makes it feel like a real tool:

> Rs 14,200 so far, 2h 40m in. Similar sessions were 61% done at this point.
> **Projected: Rs 20,000 – 26,500.** Break-even at Rs 18,400 — likely passed
> around 4:40pm.

Needs 4–5 comparable sessions before it says anything. Below that it says so,
explicitly, rather than extrapolating from one Saturday.

**Prep forecasting** — "how much do I take next time?"

This is the one that actually saves money, and this is where your oversell data
earns its keep.

For each menu item, over the last N comparable sessions, take **demand**, not
sales:

```
demand = unitsSold + oversoldQuantity
```

That distinction matters enormously. If you brought 40 patties and sold 40, mean
sales says stock 40 — but you may have turned away 15 people. `CartItem.
oversoldQuantity` and `OversellEvent` already record this. Almost nothing at this
scale does. Use it.

Then stock to a **quantile, not a mean.** The costs are asymmetric: leftover
mince goes in the freezer, a stockout is a lost sale plus a customer who walks
past next time. Default to the 80th percentile of demand across comparable
sessions, with a slider from p50 ("run lean") to p95 ("never run out") so you can
set your own appetite.

Output is a **prep list**, not a chart:

| Item | Typical demand | Suggested prep (p80) | Ingredients needed | Have | Short by |
|---|---|---|---|---|---|

with the ingredient roll-up computed by `requirementsFor`, which already
flattens deals correctly. That table is the thing you'd actually print and take
shopping, and it's about two days of work on top of machinery that exists.

Keep the existing by-event trend — it's genuinely useful for "is this item
growing" — but it is not a forecast and should be labelled *Trend*, not
prediction.

### 1.8 History: three kinds, two homes

There are two different audiences for history and conflating them is what makes
this confusing. Split on audience, not on data type.

**All Orders stays where it is, and stays operational.**

It is the cashier's screen. Someone taking orders needs to find ticket 34 to
correct it, check whether the family in the corner has been served, reprint a
receipt. That is a live-service tool, not a reporting tool, and it belongs in the
Orders section next to Order Mode — which is exactly what the merge in Phase 5
gives it. It should be usable by a cashier with no analytics access at all, which
after V2's roles means it must not depend on anything cost- or margin-shaped.

Keep it fast, keep it recent-first, keep it filterable by status and ticket
number. Do not add cost columns to it.

Analytics already has `OrdersExplorer` for the reporting view of the same rows.
That duplication is correct — same data, two purposes, two access levels.

**Stock history moves into Analytics.**

Right now the movement ledger lives inside Inventory, next to the item it belongs
to, which is the right place to answer "what happened to the mince" and the wrong
place to answer "what happened last Saturday." Move the cross-item, cross-time
view into Analytics as a tab; keep the per-item ledger where it is in the Quick
Add panel, since that one is genuinely item-scoped.

The Analytics view wants: one row per movement, all items, filterable by item,
reason, and date, with reversal pairs hidden by default (Phase 1.6) and a
"Show undone" toggle. Reuse the `OrdersExplorer` shell — the search, range and
export machinery in `analytics/search.ts` is already right for this.

**Financial history does not exist yet and needs building.**

This is the gap. There is no single place that answers "where did the money go
this month." `CostsPanel` lists cost entries and nothing else — no purchases, no
revenue events, no running position.

Build a **money ledger**: one chronological table that unions four sources, each
tagged by kind:

| When | Kind | Description | In | Out | Running |
|---|---|---|---|---|---|
| 14 Aug 09:20 | Purchase | Beef mince — 5 kg | | 4,250 | −4,250 |
| 14 Aug 11:00 | Cost · per-session | Stall pitch fee | | 1,200 | −5,450 |
| 14 Aug 18:40 | Sales | Session · 14 Aug — 47 orders | 22,180 | | 16,730 |
| 14 Aug 18:40 | Cost · per-revenue | Delivery commission 18% | | 640 | 16,090 |

Sources: stock receipts from `StockMovement` (`added` / `packet`, via
`effectiveMovements`), cost entries by basis, and sales rolled up per session
rather than per order — an itemised list of 400 tickets is not a financial
history, it's the order log again.

Two rules that make it useful rather than decorative:

1. **It is a cash view, not a profit view.** Money in and money out, when it
   moved. This is the outlay side of the Phase 1.1 split and it should say so at
   the top: *"This is cash movement. For profit, see Finance."*
2. **Every row drills through** to whatever produced it — the delivery, the cost
   entry, the session's orders.

This is the screen a spreadsheet-minded owner will actually live in, and it maps
almost one-to-one onto the Sales report export in Phase 6.

---

## Phase 2 — Inventory and units

### 2.1 Units that behave like one continuous scale

`toBase`, `familyOf` and `UNIT_CHOICES` are already correct — the conversion
math works. The problem is entirely presentational: a row of five chips
(`pcs / g / kg / ml / L`) reads as five unrelated things rather than two scales
with a convenient shorthand.

Replace with a single smart field:

- **Type the unit and it's parsed.** `1.5kg` → 1500 g. `250 ml` → 250 ml.
  `2 L` → 2000 ml. `12` → 12 of whatever the item already is. Suffix parsing
  runs on every keystroke and the resolved base amount shows underneath as
  live confirmation: *= 1,500 g*.
- **`pcs` is inferred from context, not typed.** A bare number on a `pcs` item
  is pieces. A bare number on a `g` item is grams. The user never picks "pcs"
  from a list.
- **Chips shrink to two, not five** — `weight / volume / count` — and only
  appear when creating a *new* item, where the family genuinely is a choice.
  Once an item is grams, kg is a way of typing, not a different unit.
- **Display auto-scales.** `formatQuantityLabel` already does this; make sure
  every surface uses it. 4,300 g reads as *4.3 kg*, 800 g reads as *800 g*.

Apply identically in Stock Editor, Quick Add, Stock Take, and Assign. Right now
they each present it slightly differently, which is half the reason it feels
disconnected.

### 2.2 Drain → Delete

Rename in `InventoryView.tsx`: the mode toggle, the `Droplet` icon (use `Trash2`),
the button label, and the confirm copy. Keep the underlying
`StockMovementReason: 'drained'` — historical rows already carry it and the
analytics comment about drained stock being economically identical to waste is
correct. Add a display label mapping so `MOVEMENT_LABELS.drained` reads
"Deleted" going forward.

One thing worth preserving in the copy: deleting stock to zero and deleting the
*item* are different, and the current UI blurs them. "Empty to zero" vs "Remove
item" as two distinct actions.

### 2.3 The unassigned-stock warning

Menu items with no `MenuItemStockAssignment` currently just silently produce no
cost, which is how you end up with a cost coverage below 100% and no idea which
item caused it.

Add a `!` badge on the menu item row — in Menu Settings *and* in Order Mode's
item grid — that navigates straight to Assign Stock for that item. `estimateAll`
already computes `unassigned: true` per item; it's a matter of surfacing it.

Also add a count to the Inventory home tile: *"3 menu items have no recipe."*

### 2.4 Portions — the grams/patty problem

You need "one patty" as a countable thing while ground beef is stocked in grams.
The clean way is a named sub-unit on the stock item, not a new stock item:

```ts
export interface StockItem {
  // ...
  /**
   * A named portion of this item, for things counted in the kitchen but bought
   * by weight. Beef mince held in grams, portioned as 130 g patties.
   *
   * The base unit does not change — stock is still grams, cost is still per
   * gram, the ledger is unaffected. This is a lens for entry and display.
   */
  portion?: { label: string; size: number };
}
```

What it buys:

- **Assignment** — "1 Burger uses [1] patty" instead of "uses 130 g", with the
  grams shown underneath. Change the patty size from 130 g to 145 g and every
  recipe follows, which is the actual thing you want.
- **Display** — the shelf reads *"4.2 kg — about 32 patties"*.
- **Receiving** — enter a delivery in kg, as you do now; nothing changes.
- **Forecasting** — the prep list can say "prep 46 patties (6.0 kg)".

This is `packetSize` pointing the other way: a packet is how it *arrives*, a
portion is how it *leaves*. Same idea, opposite direction, and the existing
packet code is a good template.

Gate behind `can.portionUnits`. It ships personal-only in V1, and it's a strong
candidate for the commercial build later — any bakery or juice bar has the same
problem — but let it prove itself on your own burgers first.

---

## Phase 3 — The grill, in patties

Currently `grillCapacity` counts **tickets** on the grill:

```ts
orders.filter(o => o.status === 'grill').length >= grillCapacityRef.current
```

A one-burger ticket and a six-burger ticket occupy one slot each, which is not
how a grill works.

**Change it to count portions.** Add to `MenuItem`:

```ts
/** How much grill space one of these occupies. Deals sum their components. */
grillLoad?: number;
```

Then:

```ts
const grillLoad = (order: Order, menuItems: MenuItem[]) =>
  order.items.reduce((n, line) => n + (loadOf(line, menuItems) * line.quantity), 0);
```

resolving deals through `resolveDealComponent` so a "2 Burgers + Fries" deal
correctly loads 2. Capacity is now "how many patties fit," default 8.

**The interaction that matters** is what happens when a ticket doesn't fit. Do
not just disable the Grill button — that's the current behaviour and it's
opaque. Instead:

- The Grill section header shows **6 / 8 patties**, with a fill bar.
- A ticket that would overflow shows *"needs 3, room for 2"* on the action.
- Offer **partial grill**: put 2 patties of the ticket on now, and the ticket
  displays as `2/3 on` until the rest goes on. This is what actually happens at
  the grill and modelling it is the difference between the feature being used
  and being switched off.

That last part means a ticket's grill state is a count, not a boolean:

```ts
/** Portions of this ticket currently on the grill. */
grillLoaded?: number;
```

Gate the whole section behind `can.grillBoard`. When off, the board is three
columns (Preparing / Ready / Completed) and nothing else changes.

---

## Phase 4 — Menu settings repair

Each of these is small and independent. Grouped for one sitting.

**4.1 Remove "Costs me" — the menu is not where costs are set.**

The field is `unitCostOverride`, and it means *ignore the recipe, this is what one
costs*. It should not be there. Two reasons:

1. **Nothing on the menu screen should invite the thought that price follows
   cost.** A menu price is set by what the market will pay. Putting an editable
   cost field on the same row as the price implies a relationship that does not
   exist and never will, and that is the actual source of the confusion — not the
   label.
2. **Override already exists, in the right place.** `StockItem.costPerUnit` is
   directly editable in the Stock Editor. If a cost is wrong, it is wrong at the
   ingredient, and fixing it there fixes every item that uses it. Fixing it at
   the menu item fixes one row and silently diverges from the ledger.

**What to do instead:**

- **Delete `CostField` from `MenuItemRow`.** Stop writing `unitCostOverride`.
  Keep the field in `types.ts` and the parser so historical rows still load —
  gate features, never data — and add a deprecation note.
- **Show the recipe cost as read-only information** on the menu row, because the
  number itself is useful: *"Rs 84 to make · 61% margin"*, or when incomplete,
  *"Rs 84 to make · no cost for Buns"* using `unitCostFor`'s `complete` and
  `missing`. Tap it to jump to Assign Stock. It is a fact about the item, not a
  control.
- **The ready-made problem gets solved properly.** The original justification for
  the override was a deal containing something bought in finished — a bottled
  drink, a packet of crisps. The right answer is that this is a stock item with
  `unit: 'pcs'` and a cost per unit, assigned to the menu item like anything
  else. It costs one extra stock row and it means the drink appears in stock
  levels, reorder lists, and the money ledger, none of which happen when its cost
  is typed into a menu field.
- **One-time migration banner** listing items that currently carry an override,
  with a button to create the corresponding stock item and assignment. Do not
  silently drop the overrides — that would change historical margins.

**Where the cost data lives after this:** ingredient cost is set in Stock,
recipes are set in Assign, resolved unit cost is displayed (read-only) on the
menu row and in the Business table, and realised cost is frozen onto
`CartItem.unitCost` at checkout as it is now. One source, three views, no
divergent second source of truth.

**4.2 Deals show components inline.** Remove the expand toggle. A deal's contents
are the deal — hiding them behind a press means you have to open every deal to
find the one you meant.

**4.3 Remove "Components total Rs X — use it".** It writes the sum of component
*prices* into the deal's price, which is the one number a deal is definitionally
not. Delete the button. Keep the figure as plain text — *"Sold separately: Rs
650"* — next to the deal price, since the discount is the useful comparison.

**4.4 Remove the `× n` after the quantity stepper.** Redundant with the stepper's
own value.

**4.5 Make `+` in a category obviously do something.** Currently it opens an
inline input with no transition, so it reads as a dead button. Fix: the new row
animates in with a height transition, autofocuses, gets a lit border in the
section colour, and the `+` becomes an `×` while open. Escape cancels, Enter
commits and opens the next one — adding six items should not need six clicks on
`+`.

**4.6 New category and new item auto-close on commit.** Enter commits and closes.
Enter-with-shift, or a "add another" affordance, keeps it open.

**4.7 Category reorder: defer the commit, lift the drag.** Two separate bugs.

The commit problem, in `CategoryReorderList`:
```ts
const onMove = (me: PointerEvent) => {
  const over = rowAt(me.clientY);
  if (over && over !== id) onReorder(id, over);   // writes to real state, live
};
```
Every pointer move mutates the real category order. Fix: hold a local `draft`
order during the drag, reorder the draft, and call `onReorder` once on
`pointerup` — or once on **Done** if you want the whole reorder session to be one
undo step, which is better.

The clunkiness problem: the dragged row stays in the flow at `scale: 1.02`, so
nothing visibly lifts and the gap you're dropping into never opens. Fix:

- Render a **floating proxy** — a `position: fixed` copy of the row following
  the pointer at `scale: 1.04`, `ELEVATION.high`, slight rotation, ~92% opacity.
- Leave a **gap** in the list where it came from, animated open at the current
  drop target so the destination is visibly reserved.
- The origin row becomes a dashed outline at low opacity rather than vanishing.
- Snap on release with the existing `GLIDE` spring.

The framework is already there — `motion` and `layoutId` are in use. It needs the
proxy and the gap, which is maybe 60 lines.

---

## Phase 5 — Five menus to four

**Merge Order Mode and All Orders into one section, two screens.**

They are the same section — taking orders and looking at orders — and they
already have a quick-swap button. Formalise it:

- One home tile: **Orders**.
- Inside, the standard `NavTabs` pattern every other section uses:
  `[ Take order ]  [ All orders ]`. Consistent with Analytics and Inventory,
  which is what you asked for.
- Section colour: keep both. The tab pill carries `SECTION_COLOR.order` (teal)
  or `SECTION_COLOR.orders` (blue) depending on which is active, so the identity
  survives the merge and you still know at a glance which screen you're on.
- Home becomes: **Orders · Inventory · Analytics · Settings**.

**Rebuild the bar.** Target layout, left to right:

```
[ ‹ back ]  [ ⌂ HOME ]  ··· [ section tabs / actions ] ···  │  [ ↶ ][ ↷ ]  [ ANALYTICS ]
```

The divider sits **to the left of the undo/redo pair**, separating them from the
section's own tabs and actions. Undo/redo and the section title then read as one
right-hand group — which is correct, because they belong to the same thing:
undo/redo act on the section you're currently in, and the title says which that
is.

- **Remove** the second quick-access button (`data-nav-orders`). The Orders
  section now contains both screens, so it has nothing to jump between.
- **Enlarge Home** — 56px target, up from the current 46px, icon at 28px. It's
  the most-pressed control in the bar and currently the same size as everything
  else.
- **Section title moves right**, to the far end. Keep the existing pill
  treatment (`theme.soft` background, `theme.color` border and text) — it's
  good, it's just in the wrong place.
- **Undo/redo sit immediately left of the title**, as a pair, with the vertical
  divider immediately to *their* left — so the order is
  `… tabs │ ↶ ↷ TITLE`. Move the existing `<span className="w-px h-[30px]">`
  so it precedes the `data-history-controls` group and nothing follows the group
  except the title pill.
- **In Order Mode, the title sits flush against the sidebar edge**, not the
  window edge — so it aligns with the sidebar's inner column rather than
  floating over the cart. `NavSlotTarget` needs a right-inset prop that Order
  Mode sets to the sidebar width.
- **Kill the bar's gradient.** Remove the
  `linear-gradient(180deg, alpha(theme.color, 0.07) ...)` background; flat
  `var(--app-bg)`. Keep the coloured hairline underneath — that's cheap and
  effective. See Phase 7 for where the gradient feeling goes instead.

**Export button when collapsed:** icon only, no label. In `ExportMenu.tsx`, drop
the `Export` text below the `lg` breakpoint and keep the `Download` icon with an
`aria-label`. Same treatment for any other labelled nav action.

---

## Phase 6 — The Excel export

You haven't tested it; here's what it currently does. `workbook.ts` produces two
files: a **data** workbook (normalised, one row per record, pivot-ready) and a
**summary** workbook (pre-computed figures). Both are competently built —
numbers are numbers not strings, unknowns are blank not zero, column widths are
fitted. The conventions are right.

What's missing is the thing you described: **chronological sheets**.

Add a third output — **Sales report** — that is the one a spreadsheet-native
owner would actually keep:

- **Summary** sheet: the period at a glance, and an index of the sheets below.
- **One sheet per month** (or per event, when the scope is event-shaped), named
  `2026-08`, each containing that month's orders as rows with daily subtotals
  and a month total.
- **By item** sheet: one row per menu item per month, so year-on-year comparison
  is a pivot away.
- **Stock** sheet: receipts and consumption per item per month.
- **Costs** sheet: cost entries grouped by basis, which after Phase 1.2 will
  actually mean something.

Three specifics that make it feel finished:

1. **Real Excel formulas for the totals**, not baked values — `=SUM(D2:D48)`.
   Someone who deletes a row expects the total to move. This is the entire point
   of exporting to Excel rather than to PDF.
2. **A frozen header row and an autofilter** on every data sheet.
   `sheet['!freeze']` and `sheet['!autofilter']`.
3. **Currency number format** applied to money columns (`0.00` / `#,##0`), so
   the file opens looking like a report rather than a dump.

Also: grain should follow scope. A single-session export should be one sheet per
day, not one per month.

---

## Phase 7 — Visual direction

You want time before committing. This is the direction, held loosely, in
token-level terms so it can be tried without touching components.

### 7.1 Blacker blacks, more saturated accents

The dark theme is currently mid-grey and reads as unconfident. Push:

- `--app-bg`: toward true black (`#08080A`), not `#18181B`.
- `--app-surface`: a genuine step above it (`#131316`), so elevation is legible
  without borders doing all the work.
- `--app-bg-darker` (input wells): below the background (`#050506`), so a field
  reads as recessed. Currently it's barely distinguishable.
- Section accents: raise saturation ~15% and lift luminance slightly. Against
  near-black, the current teal and purple go muddy. `tokens.ts` derives each
  section's whole palette from one hex, so this is six values.
- Keep contrast honest: body text ≥ 7:1 on background. In a kitchen, in daylight,
  with grease on the screen, this is a functional requirement rather than a
  compliance one.

### 7.2 The bloom

Replace the flat navbar gradient with a gradient that appears *under interactive
things when they're touched*, which is what you described as more organic.

```css
/* Bloom: a soft radial glow beneath a control, in the section's colour. */
.bloom::before {
  content: '';
  position: absolute;
  inset: -40% -20%;
  border-radius: inherit;
  background: radial-gradient(
    60% 120% at 50% 100%,
    color-mix(in oklch, var(--sec) 34%, transparent) 0%,
    transparent 70%
  );
  opacity: 0;
  filter: blur(14px);
  transform: translateY(6px) scale(0.9);
  transition: opacity 180ms ease, transform 220ms cubic-bezier(.2,.8,.25,1);
  pointer-events: none;
  z-index: -1;
}
.bloom:hover::before  { opacity: .55; transform: translateY(0) scale(1); }
.bloom:active::before { opacity: .85; transform: translateY(2px) scale(.97); }
```

Use `oklch` for the mix — interpolating accents through sRGB is what makes
gradients go grey in the middle.

### 7.3 Lift

Hovers should read as rising off the surface, and the bloom is the shadow that
makes that legible:

```
rest:  translateY(0)      ELEVATION.low
hover: translateY(-2px)   ELEVATION.mid   + bloom .55
press: translateY(1px)    ELEVATION.low   + bloom .85
```

Press going *below* rest matters — a button that only ever rises never feels
clicked. Spring in on hover (`GLIDE`), ease out fast on leave; asymmetric timing
is what makes it feel responsive rather than floaty.

Both go into `ui/primitives.tsx` at the `Button` / `LiftCard` / `NavTab` level,
so every control inherits. Honour `useReducedMotion` throughout — bloom opacity
stays, transform doesn't.

### 7.4 One thing to be careful about

Bloom on *everything* is worse than bloom on nothing. Restrict it to controls
that commit something — primary buttons, nav tabs, menu item tiles, ticket
actions. Rows, list items, and toggles get lift only. The glow should mean "this
does something," and if it's everywhere it means nothing.

---

## What V1 deliberately does not do

Recorded so it doesn't creep in:

- **No foodpanda integration.** It requires a publicly-reachable webhook
  endpoint. A Tauri app on a laptop behind a home router cannot receive one. This
  is not a scheduling decision, it's an architectural one — see the V2 document.
  V1 ships the `channel` field and nothing more.
- **No accounts or roles.** The current login is a plaintext username and
  password in `app_state` with a hardcoded fallback. For a single-operator
  personal build on your own machine that is a lock on a door you own. It is
  unshippable commercially and gets rebuilt properly in V2 — not patched now.
- **No sync *rewrite*.** The existing Rust sync layer stays. It is in use, it
  works for someone who knows the program, and rebuilding it is a V2 project.
  It does get one targeted fix — see Phase 0.6 — because it currently loses data
  you rely on.
- **No payments.** Cash and transfer, marked by hand, as now.
- **No multi-device.** Row versioning goes in (0.3) so it's *possible* later.
  Nothing consumes it.

---

## A working order

Roughly sequenced by dependency, and by what unblocks the most.

**Block A — make the ground stable**
1. `docs/` scaffold: architecture, domain, decisions, invariants (0.7)
2. Sync tables patch — the three missing tables plus backfill (0.6)
3. `App.tsx` split into domain hooks (0.1)
4. `useNow` clock, threaded into analytics (0.2) — immediately visible payoff
5. `edition.ts` capability seam (the decision above)

**Block B — make the numbers true**
6. `'reversal'` reason + `effectiveMovements` filter + `foodCost` purchase bug (1.6)
7. `CostBasis` replacing `CostKind`, with migration banner (1.2)
8. Break-even split into *margin today* / *realised margin* (1.4)
9. Row versioning + soft delete + `updated_at` (0.3)
10. Mutation log behind the existing history API (0.4)

**Block C — make the numbers legible**
11. Finance / Inventory / Business tables (1.3)
12. The costs explainer page (1.1)
13. Stock history into Analytics; financial history built (1.8)
14. Sales report workbook with monthly sheets (6)

**Block D — the shop floor**
15. Continuous unit entry with suffix parsing (2.1)
16. `portion` on stock items (2.4)
17. Grill capacity in patties, with partial loading (3)
18. Drain → Delete (2.2), unassigned `!` badge (2.3)

**Block E — the shell**
19. Orders section merge, five menus to four (5)
20. Navbar rebuild (5)
21. Menu settings fixes, all of Phase 4 in one sitting — including removing
    the menu cost override (4.1)
22. `channel` field on orders (0.5)

**Block F — forecasting**
23. Session pace curves and within-day projection (1.7)
24. Prep forecasting from demand quantiles (1.7)

**Block G — the look**
25. Token pass: blacks, saturation, wells (7.1)
26. Bloom + lift in primitives (7.2, 7.3)

Blocks A and B are the ones worth doing carefully and not in a hurry. Everything
after them is additive. If you only get through A and B, the program is already
substantially more trustworthy than it is now, and *trustworthy* is the thing
standing between this and something you could sell.

---

## One note on scope

There is a real risk in this plan, and it's worth naming: it is a lot, and you
have a business to run. The forecasting work in 1.7 and the visual pass in 7 are
the two most exciting parts and the two most deferrable. The unglamorous items —
the reversal bug, the cost basis, the clock — are what make the difference
between a program that produces numbers and a program you'd act on.

If the plan slips, let it slip from the bottom.
