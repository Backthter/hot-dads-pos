# Phase 1A — The money model

**Status:** in progress · 2026-08 · this document covers **1A-i** (tasks 1 and
2). 1A-ii appends to it.

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

Out of scope here and deferred to 1A-ii: the `breakEven` and `breakEvenByItem`
rewrites, `MenuItem.unitCostOverride`, and the `foodCost` / `stockPurchasesValue`
merge.

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

---

## Files touched

**Added**

```
src/db/costEntryRows.ts             the cost row mapping, both directions
docs/phases/PHASE-1A-MONEY-MODEL.md
```

**Changed**

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

`breakEven`, `breakEvenByItem`, `scope.ts` and `lib/orders.ts` are unchanged.

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

---

## How to verify

```
npm run typecheck        # passes
npm run check:metrics    # all checks pass, including the new cost cases
cd src-tauri && cargo test   # NOT RUN — no Rust toolchain in the sandbox
npm run build            # NOT RUN — same
node smoke.check.mjs     # NOT RUN — needs a browser
```

`metrics.check.ts` gained three groups:

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

---

## Bugs found and deliberately not fixed

**1. `MenuItem.unitCostOverride` is still never persisted.** Phase 0's first
finding, unchanged: the field exists, is edited in `SettingsView`, and wins
outright in `unitCostFor`, but `menu_items` has no column and `persistence.ts`
neither selects nor writes it. It is the same shape of bug as `eventId` and is
1A-ii's, which is where the removal of the field is scheduled anyway.

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

---

## What the next phase can now assume

**A cost knows what it is charged per.** `basis` is required, `amount` means
what the basis says it means, and a `per-event` cost genuinely has an event.
Both columns are stored, replicate, and survive a restart.

**1A-ii's first job is `breakEven`.** It currently takes `fixed` and `variable`
off `CostSummary`, which are a deprecated bridge; `variable` is 0. The rewrite
has to resolve each rate basis against the period's own volumes — `per-order`
against the ticket count, `per-unit` against units sold, `per-revenue` against
net revenue — and then divide by contribution as before. `costSummary.byBasis`
is the input, `Totals` already carries `units` and `netRevenue`, and the ticket
count is `orders.length` less voids. When that lands, `fixed` and `variable`
come off `CostSummary` and the hand-written summary in `metrics.check.ts`'s
break-even section comes off with them.

**The migration notice is a one-shot.** Once a shop has dismissed it, it is
gone; `needsRefiling` still identifies the rows, so a later phase that wants to
surface them again can, but nothing should re-raise them automatically.

**Nothing totals across bases.** If a figure needs one number for "costs", it
has to say which volumes it used to get there.
