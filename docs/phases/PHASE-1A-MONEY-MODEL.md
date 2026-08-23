# Phase 1A — The money model

**Status:** complete · 2026-08 · **1A-i** is tasks 1 and 2, **1A-ii** is tasks 3
to 6. The two parts wrote this document in turn; 1A-ii appended from *Task 3*
onwards and finished *What the next phase can now assume* for the whole of 1A.

## Goal

Make a cost say what it is charged *per*, and store the two things about a cost
that were being thrown away.

The program had one word for every cost that was not fixed: `variable`. Bags
vary with tickets, portions vary with items sold, a delivery commission varies
with revenue, and a staff shift varies with nothing — and all four were the same
word, which meant every figure downstream had to guess. `breakEven` guessed by
dividing the typed rupee total of the variable costs by revenue-so-far and
treating the answer as a rate, so the break-even target moved as sales came in:
one number at ten o'clock, another at four, on identical facts. A target that
depends on when it is read is not a target.

The second thing is smaller and worse. `CostEntry.eventId` had no column. It was
read by `resolveScope`'s `costsOf` and by `costsForEvent`, written by
`useSessions.addCost`, and ignored by `persistence.ts`. Event-level costs — the
pitch fee for a three-day market, which is the entire reason the field exists —
worked until the app restarted and then reappeared as costs belonging to
nothing. Every event-level profit figure has been missing its event-level costs
since the field was added, silently, while the type went on claiming otherwise.
Phase 0 found it and left it alone, correctly: it needed a schema migration, and
the cost model was out of scope for that phase.

1A-i put the basis in place. 1A-ii is what consumes it: break-even resolved
against the period's own volumes rather than against revenue-so-far, the two
per-item margins pulled apart from the blend that could not serve either, the
menu's cost override removed, and the two purchase figures that disagreed about
the same delivery merged into one.

---

## What changed

### Task 1 — The migration

`cost_entries` gains two columns, through the existing `add_column_if_missing`
in `src-tauri/src/lib.rs`, which checks `PRAGMA table_info` first and is
therefore idempotent by construction — it runs against databases that already
have it applied. The `CREATE TABLE IF NOT EXISTS` for a fresh database declares
the same columns, and `idx_costs_event` joins the two indexes already on the
table.

- **`event_id TEXT`**, nullable.
- **`basis TEXT NOT NULL DEFAULT 'per-session'`**. `ALTER TABLE ... ADD COLUMN`
  with a non-null default fills existing rows with it, so the migration of
  historical data is the default itself — no backfill pass, nothing to re-run.

**`kind` is retained.** It is marked deprecated in `schema.ts` with a pointer to
this phase, and nothing writes a value to it any more. Dropping a column that
historical rows carry makes the pre-migration interpretation unrecoverable, and
keeping it costs nothing.

One thing about retaining it is not obvious and is load-bearing. `runSave` uses
`INSERT OR REPLACE`, which replaces the whole row — so simply leaving `kind` out
of the statement would have let SQLite fill it with its `'fixed'` default on the
next save, quietly restating every historical `variable` as `fixed` the first
time the app wrote anything. That is precisely the loss the column was kept to
prevent, and it would have happened within seconds of the migration shipping. So
the column is still written, carrying through whatever the row already said.
Rows written from here on store an empty string, which is how a row created
after the migration stays distinguishable from one that predates it.

`persistence.ts` reads and writes both new columns and follows the existing
differential-write pattern in `runSave` unchanged: the ids that have gone are
deleted, the rest are `INSERT OR REPLACE`d.

The row mapping itself moved to **`src/db/costEntryRows.ts`**. `persistence.ts`
opens a SQLite handle at import time, so nothing that runs without Tauri can
touch it — and the round trip is exactly what was broken here. A mapping that
runs under `tsx` is a mapping `metrics.check.ts` can hold to its word. Both
directions live in that one file on purpose: they are a single statement about
which columns a cost is stored in, and splitting them across two places is how
the write side gained a column the read side never learned about.

Sync needs no change. `sync.rs` reads a table's columns dynamically
(`SELECT *` and `PRAGMA table_info`), so the two new columns replicate as soon
as both devices have run the migration. `cost_entries` remains a `Replace`
table, which is unchanged and correct — it is current state, not a log.

### Task 2 — `CostBasis` replaces `CostKind`

Five values, each naming a denominator: `per-session`, `per-event`, `per-order`,
`per-unit`, `per-revenue`. `CostEntry.amount` is **rupees for the first four and
percentage points for `per-revenue`** — the only field in the app whose meaning
depends on a sibling field, documented on the type with why it is one field
rather than two (two would leave a hole in every row, and "no amount recorded"
would stop being tellable apart from "an amount of zero", which is invariant 2's
distinction in the place the app can least afford to lose it).

`per-event` requires `eventId`, asserted rather than assumed: `assertCostEntry`
in `lib/sessions.ts` throws, and `useSessions.addCost` and `refileCost` are its
callers. The load path does not assert — a shop with one malformed row still has
to be able to open its till — and demotes such a row to `per-session`, which
keeps the amount visible in dated figures where it can be found and re-filed.

**Migrating existing rows.** `kind: 'fixed'` → `basis: 'per-session'`, and
`kind: 'variable'` → `basis: 'per-session'` as well. Nothing is inferred from a
cost's name. A row noted "fuel" reads like a rate, and a rule that turned it
into one would place most rows correctly — but the ones it placed wrongly would
be indistinguishable from the ones it placed rightly, and the output is a change
to a figure the shop has already read and acted on.

So the `variable` rows are listed instead. `CostsPanel` shows a one-time notice
naming every entry that used to say `variable`, with what it said and a control
to re-file each one; a row that has been re-filed drops out of the list, because
its basis is no longer the one the migration handed it. Dismissing is a real
answer — "they were all per-session" is true for most stalls, whose variable
costs were packaging bought in one go for the day — and it is persisted as an
`app_state` row (`cost_basis_notice_dismissed`) through `useSettings`, so the
question is asked once and a restart does not make it look as though the answer
had not been taken.

**A figure moves, and it is meant to.** A shop that had logged variable costs
will see break-even rise: those amounts now count as committed rupees rather
than as a share of revenue. That is the old figure's error becoming visible
rather than a regression — but it is a visible change to a number people rely
on, and the notice is what explains it at the moment it happens.

**The form derives its unit from the basis**, so an amount is never shown
without saying what it is per:

```
per-session   Rs [1200] for this session
per-event     Rs [3000] for this event
per-order     Rs [4] per ticket
per-unit      Rs [12] per item sold
per-revenue   [18] % of sales
```

The wording lives in one table (`COST_BASIS_UNIT` in `lib/sessions.ts`) because
the form, the history list and the undo label all have to say the same thing
about the same number. Picking `per-event` narrows the "counts against" list to
events, rather than offering a session and then refusing it.

**`costSummary` returns per-basis totals.** Nothing is added across bases. Its
`total` is the rupees genuinely committed for the period — `per-session` plus
`per-event` — because a rate becomes money only once the period's tickets, units
or revenue are known, and that resolution is `breakEven`'s job.

`breakEven` and `breakEvenByItem` are **not** rewritten; that is 1A-ii. They
still compile because `CostSummary` keeps `fixed` and `variable` as an
explicitly deprecated bridge: `fixed` is the committed rupees, and `variable` is
**0** and says why. Anything else would have to put a rate into a field that
wants rupees — Rs 4 a ticket read as Rs 4 — which understates by a factor of the
ticket count while looking entirely reasonable. Zero understates too, but
visibly and in a way a shop can see; and since every row that existed before this
phase migrated to `per-session`, on historical data the two agree exactly.

### Task 3 — `breakEven`, rewritten

The old implementation was circular:

```ts
const variableRatio = totals.netRevenue > 0 ? costs.variable / totals.netRevenue : 0;
const contributionRatio = grossRatio - variableRatio;
```

A typed rupee total divided by revenue-so-far, and the answer used as a rate. At
Rs 4,000 of sales a Rs 1,200 fuel bill is a 30% drag and break-even is
unreachable; at Rs 20,000 the same bill is 6% and break-even has already been
passed. The target moved through the day, on identical facts, in the flattering
direction. It had to work that way, because before 1A-i there were no rates in
the data to work from — every non-fixed cost was one word.

Now each cost is charged against the volume its own basis names:

```
fixed               = Σ per-session + Σ per-event
perUnitCost         = ingredients per unit + Σ per-unit
perOrderCost        = Σ per-order
revenueRate         = Σ per-revenue ÷ 100
contributionPerUnit = price × (1 − revenueRate) − perUnitCost
                                                − perOrderCost ÷ avgBasket
breakEvenUnits      = fixed ÷ contributionPerUnit
breakEvenRevenue    = fixed ÷ contributionRatio
```

`resolveCosts` does the resolution and is shared with `itemMargins`, so the
headline figure and the per-item one cannot drift apart on how a rate is spread.

**Ingredient cost per unit is taken over the costed lines**, as the ratio
`cogs ÷ costedRevenue` applied to the average price — not `cogs ÷ units`.
Dividing by all units charges the uncosted ones at zero, which is invariant 2's
exact failure and produces the flattering answer automatically.

**Event costs are not apportioned.** From a session scope, `per-event` rupees
are held back on `BreakEven.heldEventCosts` and the panel says outright that the
event carries Rs X separately, with a control that switches the scope to the
event. Sharing them out by revenue would make Saturday's break-even fall on
Monday because Sunday traded well — the same moving target, arriving through a
different door. ADR-013 has the reasoning and what was rejected.

The three existing `blocked` reasons are kept and a fourth added: contribution
otherwise positive, but no tickets to divide the per-order costs by. Left alone
that division is an infinity, which surfaced as "costs exceed the margin" — a
wrong explanation for a missing denominator. The strings live in
`BREAK_EVEN_BLOCKED` because the screen branches on them and the checks assert
each one is reachable.

`CostSummary` loses `fixed` and `variable`, which 1A-i left as an explicitly
deprecated bridge with a note saying they came off here.

### Task 4 — `breakEvenByItem`, split in two

Price was derived as `item.netRevenue / item.units`: the realised historical
average. It cannot respond to a price change by construction — put the burger up
by Rs 20 and it says exactly what it said yesterday — and after a few sales at
the new price it reports a blend that is neither price, so it is not a good
record of the past either. One figure, failing at both jobs.

Two figures now, from `itemMargins`:

- **Margin today** — the menu's current `price` against a live `unitCostFor`
  lookup. Moves the moment a price, a recipe or a supplier cost is edited.
- **Realised margin** — the frozen `CartItem.unitCost` snapshots against what
  actually sold. Does **not** move when a price changes (invariant 3).

When `unitCostFor` returns `complete: false`, margin today is `null` and the
missing ingredients are named. No margin is computed from a partial cost: that
is the cheerfully understated cost and inflated margin invariant 2 exists to
prevent, on exactly the data nobody can check.

The two are shown together when they are more than 10% apart, which is the case
neither number could show on its own — usually a price that has moved or a
supplier cost that has.

`breakEvenByItem` then takes the margins and uses **today's**, because a target
is about what to do next and a target computed from last month's prices is not
actionable. An item whose recipe is incomplete is absent from the list rather
than estimated: there is no honest number for the tile, and a wrong one is a
wrong instruction to somebody standing at a grill.

### Task 5 — `MenuItem.unitCostOverride` removed from the menu

Phase 0's first finding. The field had no column, `persistence.ts` neither read
nor wrote it, and every hand-typed override was lost on reload — silently, with
the item reverting to its recipe cost.

Resolved by removing the feature rather than by adding the column, for reasons
that are mostly not about the bug. A cost box beside a price box on a menu
screen invites the thought that price follows cost, and it does not. And an
override at the *dish* is the wrong level: if a bought-in component's price is
wrong then every dish containing it is wrong the same way, so the correction
belongs once, at `StockItem.costPerUnit`, which the Stock Editor already edits
and which receipts already maintain. ADR-015.

- `CostField` is gone from `MenuItemRow`. Nothing writes the field anywhere.
- The row now shows a **read-only** resolved cost — *"Rs 84 to make · 61%
  margin"*, or *"Rs 84 to make · no cost for Buns"* — which taps through to
  Assign Stock for that item.
- **The field stays on the type and `unitCostFor` still reads it**, marked
  deprecated with why. Gate features, never parsers: an in-memory or legacy
  object carrying one has to go on meaning what it says. It cannot arrive from
  disk, because it never had a column to arrive from.

**No data migration**, and not as an oversight: there are no overrides on disk
to migrate. Sales rung up while one was live in memory carry a frozen
`unitCost` reflecting it, and those stay exactly as they are (invariant 3).

The navigation is one piece of state in `App.tsx` — `assignTarget`, set by the
read-out and cleared by Inventory the moment it has been read, so returning to
Inventory later by any other route lands on the grid as before. `AssignScreen`
is handed the id rather than reading a shared variable, and drops a request for
a deal, which is deliberately not assignable.

`useMenu.addAssignment` and `removeAssignment` are **still unreferenced**, and
that is a deliberate departure from the brief — see *Bugs found and deliberately
not fixed*, item 4.

### Task 6 — one definition of a purchase

`stockPurchasesValue` counted `added` and `packet`. `foodCost` kept a loop of
its own and counted `added`, `packet` **and** `correction`. Both figures appear
on the Overview tab, so the same delivery was two numbers on one screen with
nothing to say which was which.

`foodCost` now calls `stockPurchasesValue`. **A purchase is a receipt**
(ADR-014). A correction carries no cost data and means "the shelf disagreed with
the book"; it is a measurement of stock that was already there, not money
leaving the till. Counting it could only value it at today's cost per unit — an
outlay that never happened — and it failed in one direction, inflating actual
food cost the more carefully a shop counted.

Actual food cost falls for any shop that had positive corrections in the period.
That is the previous figure's error becoming visible, in the same shape as
ADR-012's, and it is smaller: a correction is an occasional line, not a standing
cost.

While doing this: reversals are written two ways. `undoMovement` appends its
compensating line and marks both rows `reversed`; `reverseStockChanges` posts a
plain negative `correction` and marks nothing. Both purchase figures skip
`reversed` rows, so a delivery undone through the second path leaves its
original `added` still counted while the line cancelling it counts as nothing.
**That is Phase 1B** — it belongs with the `'reversal'` reason and
`effectiveMovements` — and it is noted here and left alone.


---

## Files touched

**Added (1A-i)**

```
src/db/costEntryRows.ts             the cost row mapping, both directions
docs/phases/PHASE-1A-MONEY-MODEL.md
```

**Changed by 1A-i**

```
src-tauri/src/lib.rs                event_id, basis, idx_costs_event
src/db/schema.ts                    both columns; kind marked deprecated
src/db/persistence.ts               reads and writes both, through costEntryRows
src/app/types.ts                    CostBasis, CostEntry.basis, kind deprecated
src/app/lib/sessions.ts             assertCostEntry, needsRefiling, the unit table
src/app/state/useSessions.ts        addCost takes a basis; refileCost
src/app/state/useSettings.ts        the notice dismissal
src/app/analytics/metrics.ts        costSummary only
src/app/analytics/CostsPanel.tsx    the basis picker, units, the migration notice
src/app/analytics/AnalyticsView.tsx prop threading; the earlier-stock adjustment
src/app/analytics/workbook.ts       Basis, Amount_Unit, the event columns
src/app/screens/AnalyticsScreen.tsx wiring
docs/02-DECISIONS.md                ADR-012
docs/01-DOMAIN.md                   the Cost entry section
metrics.check.ts                    the basis, migration and round-trip cases
```

**Changed by 1A-ii**

```
src/app/analytics/metrics.ts        CostScope, resolveCosts, breakEven rewritten,
                                    itemMargins, breakEvenByItem, BREAK_EVEN_BLOCKED,
                                    foodCost calls stockPurchasesValue,
                                    CostSummary loses fixed/variable
src/app/analytics/AnalyticsView.tsx the cost scope, the held-event-costs note and
                                    its switch-to-event control, the divergence
                                    indicator, the margins memo
src/app/analytics/workbook.ts       one KPI row per basis; committed costs
src/app/types.ts                    unitCostOverride deprecated, with why
src/app/lib/inventory.ts            a note on why unitCostFor still reads it
src/app/settings/SettingsView.tsx   CostField removed; ResolvedCost read-out
src/app/screens/SettingsScreen.tsx  the shelf and the recipes, read only
src/app/screens/InventoryScreen.tsx the assign target passes through
src/app/inventory/InventoryView.tsx switches to Assign Stock for a target
src/app/inventory/AssignScreen.tsx  opens on one item when asked to
src/app/App.tsx                     assignTarget, and the two handlers for it
docs/02-DECISIONS.md                ADR-013, ADR-014, ADR-015
docs/01-DOMAIN.md                   unitCostOverride; what counts as a purchase
metrics.check.ts                    break-even per basis, the invariance property,
                                    the two margins, four blocked reasons, the
                                    purchase agreement
```

`scope.ts`, `lib/orders.ts`, `schema.ts`, `persistence.ts` and everything in
`src-tauri/` are untouched by 1A-ii. No migration, no schema change: the only
field it removes never had a column.

---

## Invariants introduced

None. The six stand as they are, and nothing here needed working around.

Two are touched in passing and worth naming:

- **Invariant 2** — missing is not zero — is the reason `amount` is one field
  and not a rupee column plus a rate column. Two columns would have made every
  row half-empty and the empty half indistinguishable from a zero.
- **Invariant 3** — historical figures never move — is what the migration is
  organised around. Inferring a basis would have rewritten past break-even
  figures from a guess. The one figure that does move, and is meant to, is
  documented above and in ADR-012.

One convention this part adds, in the spirit of Phase 0's three:

4. **Amounts are only comparable within their basis.** Nothing totals across
   them. A function that returns money must say which volumes it resolved the
   rates against.

1A-ii adds a fifth, which is the general form of what ADR-012 and ADR-013 are
both instances of:

5. **A target may not depend on when it is read.** Any figure a shop is meant to
   aim at has to be a function of the facts in force, not of how far through the
   period the reader happens to be, and not of anything that happened after the
   period it describes. Progress against a target moves; the target does not.

Two more invariants are touched in 1A-ii, neither needing to be worked around:

- **Invariant 2** — missing is not zero — is why margin today is `null` on an
  incomplete recipe and names what is missing, and why per-unit ingredient cost
  is taken over the costed lines on both sides rather than dividing COGS by all
  units.
- **Invariant 3** — historical figures never move — is what realised margin is
  for, and why removing `unitCostOverride` writes no migration: sales rung up
  while one was live keep the `unitCost` frozen onto them.

---

## How to verify

```
npm run typecheck        # passes
npm run check:metrics    # all checks pass, including the new cost cases
cd src-tauri && cargo test   # NOT RUN — no Rust toolchain in the sandbox
npm run build            # NOT RUN — same
node smoke.check.mjs     # NOT RUN — needs a browser
```

`metrics.check.ts` gained three groups in 1A-i:

- **Cost basis.** Five entries, one per basis, with amounts that share no sums
  (100, 200, 4, 12, 18) so a leak between bases shows up as a wrong figure
  rather than a right one reached by accident. Each basis totals on its own; the
  committed total is 300 and excludes the rates; two costs on the same basis do
  add.
- **Cost migration.** A `variable` row lands on `per-session`, keeps what it
  used to say, and is flagged for re-filing; a `fixed` row lands there too and
  is not flagged; re-filing clears the flag; a row written since the migration
  carries no kind and is never flagged.
- **Cost round trip.** An event-level cost through `costEntryToRow` and back
  through `costEntryFromRow`, field by field and then whole, so a column added
  to one side and not the other fails here even if nobody thought to check it by
  name. Plus: the round-tripped entry is still found by `costsForEvent`, an
  eventless `per-event` row is demoted on load, and `costEntryIsCoherent`
  refuses it on the way in.

This is the mapping both directions use, which is the part that was broken. The
SQL around it still needs a device.

And five more in 1A-ii:

- **Break-even, one basis at a time.** Two tickets of five burgers at Rs 100
  with Rs 40 of ingredients — revenue 1000, a basket of 5, an average price of
  100 — with a Rs 1,000 per-session cost and exactly one other basis set. Each
  case is worked out on paper: `per-unit` 10 takes contribution to 50 and
  break-even to Rs 2,000; `per-order` 20 is Rs 4 an item through the basket and
  takes it to 56; `per-revenue` 20 is a true fifth of the price and takes it to
  40. A rate landing on the wrong denominator fails one of these rather than
  quietly agreeing with another.
- **Per-event allocation.** The same costs read from an event scope commit
  Rs 1,500 and hold nothing back; read from a session scope they commit Rs 1,000
  and report Rs 500 as the event's (ADR-013).
- **The property that was broken**, named as such and the reason this part
  exists. A fixed cost set held constant, the same mix at Rs 4,000 of sales and
  at Rs 20,000: `breakEvenRevenue` must be *identical*, and the check asserts
  the difference is exactly zero rather than close. It also asserts that
  `progress` did move, because that is the figure that is supposed to.
- **The two margins.** A burger at Rs 100 made of Rs 30 of beef and Rs 10 of
  bun, sold ten times at Rs 40 frozen on each line. Put the menu price to
  Rs 150: margin today moves to 73%, realised margin stays at 60%, the realised
  price is still Rs 100, and the divergence is flagged at 83%. Take the bun's
  cost away: margin today is `null` and names `Buns`, while realised margin
  stands. Break-even by item follows today's figure and drops the uncosted item
  entirely.
- **All four blocked reasons**, each reached by a different construction:
  nothing logged, nothing costed, a per-unit cost past the margin, and a
  per-ticket cost with no tickets to spread it over.
- **One definition of a purchase.** A ledger with an `added`, a `packet` and a
  `correction` in the same window. `foodCost.purchases` must equal
  `stockPurchasesValue` over that window, and both must be Rs 2,500 — the
  correction, which used to be valued at today's cost per unit and add Rs 250 of
  outlay that never happened, contributes nothing.

152 checks in all, and they run under `tsx` with no DOM and no database because
everything they call is pure.

**What still has to be run on your machine**, in order:

1. `cd src-tauri && cargo test` — the sync ordering and strategy tests. Nothing
   here changes `SYNC_TABLES`, so they should pass unchanged; run them because
   `lib.rs` was edited.
2. `npm run build` — a Tauri build.
3. `node smoke.check.mjs` — diff its output against the commit before this
   branch. It does not touch the costs screen, so the two should be identical;
   anything that differs is a behaviour change nobody intended.
4. **The migration itself, on a copy of the real database.** Open the app, then
   check by hand:
   - `PRAGMA table_info(cost_entries)` shows `event_id` and `basis`, and still
     shows `kind`.
   - Every existing row reads `basis = 'per-session'` and keeps its original
     `kind`.
   - The costs screen shows the notice, listing exactly the rows that were
     `variable`.
   - Log a cost against an event, restart the app, and confirm it is still on
     that event — this is the bug, and it is the one thing a typecheck cannot
     see.
   - Save once, then re-check `kind` on the historical rows. They must be
     unchanged. If a `variable` has become `fixed`, the write path has dropped
     the column and the pre-migration reading has been lost.
   - Close and reopen: the notice must stay dismissed.
5. **Two devices.** Sync a cost with an `event_id` from one to the other, both
   running this build. The columns replicate automatically; a device still on
   the old build will not have the columns and will not carry them.

1A-ii adds nothing to the SQL and no migration, so the database checks above are
unchanged. What it does add that only a running app can show:

6. **The break-even figure, watched through a service.** Log a per-session cost
   and a per-order cost, then trade. The break-even *target* must sit still all
   day; only the progress bar underneath it should move. This is the whole
   point, and it is the one thing that was visibly wrong before.
7. **A session inside a multi-session event.** Attach a pitch fee to the event,
   then open one of its sessions. Break-even must cover the session's costs
   only, the panel must name what the event carries, and the control beside it
   must switch the scope to the event, where the figure includes it.
8. **The menu row.** Every item shows what it costs to make and its margin;
   an item with an uncosted ingredient names it instead of showing a figure.
   Tapping either lands in Assign Stock on that item. Restart and confirm the
   read-out is the same — the point being that there is no longer anything on
   that row for a reload to lose.
9. **`smoke.check.mjs` again**, for a different reason from run 3 above: 1A-ii
   touches `App.tsx`, `SettingsView` and three inventory files, none of which
   the till path should notice. Any difference in its output is a behaviour
   change nobody asked for.

---

## Bugs found and deliberately not fixed

**1. `MenuItem.unitCostOverride` was never persisted.** ~~Phase 0's first
finding, unchanged.~~ **Fixed in 1A-ii, by removal** — see Task 5 and ADR-015.
Nothing writes the field, the menu row is a read-out, and the field survives on
the type as a deprecated parser concern. There was nothing on disk to migrate.

**2. `costsForSessions` and `costsOf` disagree about ungrouped sessions.** In
`resolveScope`, an event-level cost is only picked up when the group is a real
event (`group?.grouped ? group.id : undefined`). A lone ungrouped session is
presented as an event of one but has no event id, so a cost cannot be attached
to it as an event in the first place — which makes this consistent rather than
wrong, but it means "attach to the whole event" is unavailable until two
sessions have been grouped. Not changed: it is scope behaviour, and the
alternative (letting a session id stand in for an event id) blurs the one
distinction that keeps a cost from being counted twice.

**3. `useSettings.hydrate` still gives up on the first failure.** Unchanged from
Phase 0. The notice dismissal is now one of the settings that a partial hydrate
would leave at its default — the visible symptom being a notice that reappears
after a restart on a device whose database was slow to open. Worth fixing when
that function is fixed; not worth fixing separately.

**4. `useMenu.addAssignment` and `removeAssignment` are still unreferenced, and
this is a departure from what 1A-ii was asked to do.** The brief said they were
what the new navigation into Assign Stock needed. They are not, and wiring them
in would have been a regression.

`AssignDetail` is a draft-then-save editor: rows are edited locally and
committed in one step through `saveAssignments`, which records **one undo
entry** for the recipe change. `addAssignment` and `removeAssignment` mutate a
single assignment and save immediately, and neither records anything on the
history stack. Routing the editor's per-row controls through them would have
made every recipe change silently un-undoable — against ADR-004, and against
Phase 0's rule that the site of a change is responsible for recording its
reversal.

So the navigation uses the existing bulk save, and the two handlers stay where
Phase 0 left them: kept because a domain hook is the right home for them, unused
because nothing yet needs a single-assignment mutation. A screen that wants one
— a quick "add this ingredient" from somewhere other than the recipe editor —
should use them **and** give them an undo entry first. Raised rather than done.

**5. The break-even KPI card's `definition` string still says "per-sale
costs".** It is accurate but no longer says which sale costs, now that there are
three kinds with different denominators. Cosmetic, and it belongs with whatever
pass rewrites the Overview tab's copy rather than as a stray edit here.

---

## What the next phase can now assume

**A cost knows what it is charged per.** `basis` is required, `amount` means
what the basis says it means, and a `per-event` cost genuinely has an event.
Both columns are stored, replicate, and survive a restart.

**Break-even is a target, not a reading.** It no longer depends on when it is
looked at. Every rate comes from the cost entries and the average sale, and the
one figure that moves with the day is `progress`, which is supposed to. The
regression check in `metrics.check.ts` is named for this and asserts the
difference between two volumes is exactly zero — anything that reintroduces a
revenue-so-far denominator fails there rather than on a screen six months later.
`fixed` and `variable` are off `CostSummary`, and so is the hand-written summary
1A-i left in the checks.

**Resolving a cost to money happens in one place.** `resolveCosts` turns a
`CostSummary` plus a period's `Totals` into committed rupees, a per-unit rate, a
per-ticket rate, a revenue fraction and a basket size. Anything new that needs
"what did the costs come to" should call it rather than reaching into `byBasis`
— that is what keeps the headline figure and the per-item one from drifting
apart on how a rate is spread.

**A figure that resolves costs takes a `CostScope`.** The only thing it changes
is whether `per-event` rupees are committed or held back (ADR-013), and it is a
parameter rather than something read off `ResolvedScope`, because
`sessionScoped` is true for both a session and an event scope and answers a
different question. A new figure that forgets to pass it gets `'range'` and will
charge a session for its event's pitch fee.

**Margin has two figures and they mean different things.** `itemMargins`
returns both: today's, which must respond to a price or recipe change, and
realised, which must not move at all (invariant 3). Anything that wants "the
margin" has to say which — and anything computing a *target* wants today's,
because a target is about what to do next.

**A purchase is a receipt, decided once.** `stockPurchasesValue` is the only
place that says which movement reasons count, and `foodCost` calls it. A new
figure about money spent on stock should call it too rather than writing a third
list; two lists is exactly how the last disagreement happened (ADR-014).

**Ingredient cost is overridden at the ingredient.** There is no per-item
override any more and nothing writes `MenuItem.unitCostOverride` (ADR-015). Cost
enters through `StockItem.costPerUnit`, by hand or by receipt, and reaches a
menu item through its recipe. Anything that cannot be expressed as a recipe
needs a stock item to stand for it — which is also what makes it visible to
`foodCost`, `stockPurchasesValue` and the reorder list.

**The migration notice is a one-shot.** Once a shop has dismissed it, it is
gone; `needsRefiling` still identifies the rows, so a later phase that wants to
surface them again can, but nothing should re-raise them automatically.

**Nothing totals across bases.** If a figure needs one number for "costs", it
has to say which volumes it used to get there.

**What 1B inherits.** The `reversed` flag is written by `undoMovement` and not
by `reverseStockChanges`, and both purchase figures read it — so a delivery
undone through the second path is still counted as a purchase. `'reversal'` as a
movement reason and an `effectiveMovements` helper are the shape of the fix, and
this is the concrete symptom to point them at. Nothing in 1A makes it worse and
nothing in 1A works around it.
