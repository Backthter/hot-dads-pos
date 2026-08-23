# Phase 0 — Foundations

**Status:** complete · 2026-08

## Goal

Put three things in place before any feature work continues.

First, a written record. The program has an unusual amount of reasoning encoded
in it — the ledger is append-only for a reason, costs are optional for a reason,
sessions store their membership for a reason — and almost all of that reasoning
lived only in doc comments next to the code it constrained. That is the right
place to read it from, and the wrong place to discover it from: it means a
person or an AI picking up a later phase has to read the whole tree before they
know which of their instincts would corrupt data. `docs/` exists so that a
later session with no memory of this one can make correct decisions from a
standing start.

Second, a live data-loss bug in sync, fixed as narrowly as it can be fixed.

Third, structural room. `App.tsx` owned every mutation in the program across
3,533 lines. Every later phase would have edited that one file.

Everything else was deferred by design: row versioning, the mutation log, the
`channel` field on orders, and any change to the cost model or break-even maths.

---

## What changed

### Step 1 — `docs/`

Five documents. `00-ARCHITECTURE.md` maps the tree, states the dependency rules
that hold it up, says where state is owned, and traces one mutation from a
button press to SQLite — voiding an order, because it is the most involved path
in the program and every rule shows up in it. `01-DOMAIN.md` consolidates the
vocabulary, mostly from the doc comments already on `types.ts`, and says where
each concept is defined in code. `03-INVARIANTS.md` writes down the six rules
with, for each, why it exists, what breaks without it, and the specific
functions that hold it up.

`02-DECISIONS.md` is eleven ADRs. Eight were recovered from the code and from
`CHANGES.md` rather than written at the time, and the file says so — their dates
are inferred and approximate. Three (009, 010, 011) were written as this phase
made them. Entries are never edited once written, only superseded.

The doc comments in the code were left where they are. Several of them record
reasoning that is not recoverable from the code alone, and moving them into
`docs/` would have meant a reader of `types.ts` no longer sees why a field is
optional at the moment they are deciding whether to make it required.

### Step 2 — The sync tables

`SYNC_TABLES` was missing `stock_movements`, `inventory_snapshots` and
`oversell_events`. A synced device received stock *levels* but not the ledger
that produced them, so `foodCost`, `stockPurchasesValue`, `shrinkageValue`,
`inventoryTurnover`, `deadStock` and `consumptionRate` were all wrong or empty
on any device that was not the one doing the stocking.

Adding the three tables to the array turned out not to be enough on its own, and
that is worth reading before touching this code again. Both directions were
hard-coded to `INSERT OR REPLACE`, and the *download* path additionally ran
`DELETE FROM [table]` before inserting the cloud rows. Listing the ledger while
that was true would not have been a partial fix — it would have handed a lagging
device the power to delete ledger rows it had never seen, which is invariant 1
broken outright, and it would have introduced a data-loss path where none exists
today. Changing only the insert verb would have made no difference on download,
because the table had already been emptied.

So the strategy became per table rather than global. Each entry in `SYNC_TABLES`
declares itself:

- **`Replace`** — current-state tables. `DELETE` then `INSERT OR REPLACE`,
  exactly as before. The cloud copy is authoritative for them.
- **`Append`** — the immutable logs. Never cleared, never replaced; both
  directions use `INSERT OR IGNORE`, so the copies converge by union. That is
  the correct semantics for an append-only log and it needs no conflict
  resolution at all.

Ordering is now documented in the array and asserted in `#[cfg(test)]` tests,
because it is silent when wrong: these rows carry foreign keys that are not
declared as constraints, so a child arriving before its parent simply points at
nothing afterwards.

`src/db/SyncSettings.tsx` gained a **Resend everything** action, armed before it
fires. It is needed because append-only tables merge by union: rows nobody sends
are rows nobody gets, so a device that has been syncing for months still holds
no ledger in the cloud and nothing will ever push it there on its own. It is
deliberately manual — automatic backfill would mean every till re-uploading its
entire history on the next launch after an update, over a market's phone
connection.

No wider redesign. Row versioning and the mutation log stay out.

### Step 3 — A shared clock

Analytics captured `Date.now()` at render time and never looked again.
`resolveScope` defaulted `now` to it and `foodCost` took it as a default
parameter, but no dependency array contained it, so nothing recomputed unless
the orders or the scope changed. A "Today" range froze at whatever time the
screen was opened, and revenue per trading hour did not move during a live
service — which is precisely when somebody is watching it. `SessionBar` had the
same bug in simpler form: it read the clock once per render, so the hours-traded
figure sat still until the next order happened to re-render the bar.

`src/app/ui/useNow.ts` is one clock for the whole program — a module-level store
with subscribers, running at the shortest interval anybody has asked for. A
timer per hook call would drift, so two figures on one screen could disagree
about the time, and the number of timers would grow with the number of
consumers. It stops while the document is hidden and resyncs on the way back, so
a lid closed for six hours wakes to one read rather than seven hundred queued
ticks.

`now` is threaded explicitly into `resolveScope` (which covers `resolveRange`,
`sessionTradingHours` and `activeTradingHours` underneath it), `foodCost`,
`sessionPerformance`, `eventPerformance` and `deadStock`, and added to the
dependency arrays of the memos that genuinely depend on it. It is deliberately
absent from item and category performance, which do not.

One thing that had to be dealt with and was not obvious: because the scope is
re-resolved on every tick, it hands back a *fresh* range object and a *fresh*
order array each time, and almost every memo on that screen keys on identity. As
written, adding `now` would have rebuilt the item table, the category table, the
attachment pairs and the popularity trend every few seconds to produce the same
answer. Both outputs are now held steady by value before anything else reads
them (`useStableList`, `useStableRange` in `AnalyticsView.tsx`), so a tick
recomputes what is live and leaves the expensive tables alone.

### Step 4 — `App.tsx`

3,533 lines to 368.

State moved into `src/app/state/`, one hook per domain, each returning
`{ state, actions }` and each recording its own undo entries through
`useHistory()`:

| Module | Owns |
|---|---|
| `useOrders.ts` | cart, checkout, board status moves, voiding, edit sessions, parked orders |
| `useStock.ts` | the shelf, the ledger, snapshots, oversells, stocktake, drain, packets |
| `useMenu.ts` | menu items, categories, deals, recipes |
| `useSessions.ts` | trading sessions, events, cost entries |
| `useSettings.ts` | tax, PINs, grill capacity, UI scale, theme, printing |

Two things stayed shared, and `state/core.ts` explains why at the point of use.
The **snapshot ref** is preserved exactly: handlers read the latest state
synchronously rather than through their own closures, which is correctness and
not tidiness — two orders can be rung up inside a single React tick, and a
handler reading the session list from a stale closure hands both of them the
same ticket number. And **saving stays coordinated** behind one `saveImmediate`
that every hook calls, because several handlers write more than one table in one
action; independent saves would let a device that stopped between two of them
keep a ticket that had returned its stock twice, or not at all.

The presentational pieces moved out verbatim — `ScreenShell`, `Section`,
`ParkedSidebar`, `ErrorBoundary` — and the six screens became files of their
own under `src/app/screens/`. `App.tsx` is now imports, five hook calls in
dependency order, the assembled snapshot, the startup effect, a screen switch,
and the two dialogs that belong to the window rather than to any screen.

Recipes (`stockAssignments`) live in `useMenu` rather than `useStock`, because an
assignment is a fact about a menu item — it changes when the menu changes, not
when the shelf does. `useStock` is handed the setter for the one case that has
to reach across: deleting a stock item takes its recipe links with it, or the
menu items that used it stay silently uncosted.

---

## Files touched

**Added**

```
docs/00-ARCHITECTURE.md  01-DOMAIN.md  02-DECISIONS.md  03-INVARIANTS.md
docs/phases/PHASE-0-FOUNDATIONS.md
src/app/ui/useNow.ts
src/app/state/          core.ts  initial.ts  index.ts  useNotUndoable.ts
                        useDesktopShell.ts  useSettings.ts  useMenu.ts
                        useStock.ts  useSessions.ts  useOrders.ts
src/app/screens/        OrderModeScreen.tsx  BoardScreen.tsx  SettingsScreen.tsx
                        AnalyticsScreen.tsx  InventoryScreen.tsx
src/app/components/     ScreenShell.tsx  Section.tsx  ParkedSidebar.tsx
                        ErrorBoundary.tsx
smoke.check.mjs
```

**Changed**

```
src-tauri/src/sync.rs             per-table write strategy, three tables added, tests
src/db/sync-client.ts             resendEverything
src/db/SyncSettings.tsx           the Resend everything action
src/app/analytics/AnalyticsView.tsx  useNow, threaded now, value-stable scope outputs
src/app/components/SessionBar.tsx    useNow
src/app/ui/index.ts               exports useNow
src/app/App.tsx                   3,533 → 368 lines
metrics.check.ts                  the live-clock cases
package.json                      check:smoke
```

Nothing was changed in `types.ts`, `schema.ts`, `persistence.ts`, `metrics.ts`,
`scope.ts` or `lib/`.

---

## Invariants introduced

None. Phase 0 wrote down six invariants that already existed and did not add a
seventh. Two of them are now enforced in a place they were not before:

- **Invariant 1** is now enforced in `sync.rs`, which previously had no concept
  of it. Append-only tables are neither cleared nor replaced in either
  direction.
- **Invariant 6** is unchanged in substance but easier to audit: every `confirm`
  string in the program is now in `src/app/state/`, four of them, and they can
  be listed with one grep.

Three conventions were established that a later phase should keep:

1. **`now` is a parameter, never a call.** Anything that needs the current time
   takes it. `useNow` is the only subscriber to a timer.
2. **A hook reads the snapshot ref, not its closure**, for anything it is about
   to write back.
3. **ADRs are append-only**, like the ledger they describe.

---

## How to verify

**Typecheck and the metrics checks.**

```
npm run typecheck        # passes
npm run check:metrics    # all checks pass, including the new clock cases
npm run build            # clean
cd src-tauri && cargo test   # the sync ordering and strategy tests
```

`metrics.check.ts` gained a section that computes a session's trading hours at
T and again at T + 1 hour and asserts the figure moved by exactly an hour; that
a *paused* session's clock does not move however far `now` advances; that
`resolveScope` carries the same property one layer up, both for the hours and
for the window a running session resolves to; and that a `today` preset resolves
to a different window tomorrow.

**The behavioural check.** `smoke.check.mjs` drives a browser through a service
— build a cart, take 10% off, ring it up cash, ring a second up on transfer,
start a session and watch the third ticket be numbered from 1 for the kitchen,
void one and watch the board renumber around it, press Ctrl+Z, end the session —
and prints what the screen says at each step. It asserts nothing. Diff its
output across two builds and anything that differs is a behaviour change.

Run against the commit before this work and against the finished tree, its
output is identical line for line once wall-clock times are normalised. That is
the evidence behind "no behaviour changes" in step 4; a typecheck cannot see a
handler wired to the wrong setter, and neither can a build.

**The two-device sync test**, which has not been run and needs real hardware.
What it should look like:

*Setup.* Two tills, A and B, both connected to the same managed database. A has
been trading for a while and has stock items, a movement ledger, at least one
inventory snapshot and ideally one oversell. B is fresh, or has been syncing
under the old code and therefore holds stock levels with no ledger behind them.

1. On A, open Settings → Cloud Sync and press **Resend everything**. Confirm.
   The result line should report a row count noticeably larger than a normal
   Sync Now, and should name 15 tables rather than 12.
2. On B, press **Sync Now**. It should report `stock_movements`,
   `inventory_snapshots` and `oversell_events` among the tables downloaded, with
   row counts matching A's.
3. On B, open Analytics with a scope covering A's trading. `Food cost`,
   `Stock purchases`, `Shrinkage`, `Inventory turnover` and `Dead stock` should
   now show figures rather than dashes, and should match what A shows for the
   same scope. Before this change they were empty or wrong on B.
4. **The append-only check, which is the one that matters.** On B, add stock to
   an item — a movement that A has never seen. Then press **Sync Now** on B
   *without* A having sent anything since. B's new movement must still be there
   afterwards. Under the old code the download would have cleared the table
   first and taken it with it.
5. Repeat in the other direction: adjust stock on A, sync A, then sync B. Both
   devices should end holding the union of the two ledgers, and no row should
   have vanished from either.
6. **The stale-copy check.** Take B offline, adjust stock on A, sync A. Bring B
   back and sync. B should gain A's new lines and keep its own; nothing should
   be overwritten, because `INSERT OR IGNORE` leaves an existing row alone.

What it does *not* cover, and should not be expected to: two devices editing the
same menu item offline still resolve last-writer-wins, silently. That is what a
later phase's row versioning is for.

---

## What I found that contradicts the invariants

**One, and it is the reason step 2 grew.** `write_cloud_data_to_local` in
`sync.rs` ran `DELETE FROM [table]` before inserting the cloud rows, for every
table in `SYNC_TABLES`. That is invariant 1 broken for any append-only table
listed there. It was harmless only because the three append-only tables were not
listed — the bug and the invariant violation were the same omission. Fixing one
without the other would have turned a missing-data bug into a destroying-data
bug. This was raised before any code was changed and the decision to skip the
`DELETE` for append-only tables was taken deliberately; it is ADR-010.

Nothing else contradicts the six. The other five hold everywhere I looked, and
the code is unusually careful about them.

---

## Bugs found and deliberately not fixed

**1. `MenuItem.unitCostOverride` is never persisted.** The field exists on the
type, is edited in `SettingsView`, and is read by `unitCostFor` — where it wins
outright over the recipe. But `menu_items` has no `unit_cost_override` column,
and `persistence.ts` neither selects nor writes it. Every hand-typed cost
override is lost on reload, silently, and the item quietly reverts to its recipe
cost. This is invariant 2's territory: a shop that typed an override for a deal
containing a bought-in component will find that deal's margin changing on its
own. Not fixed because "any change to cost model" is explicitly out of scope for
this phase, and because it needs a schema migration. It is a one-column change
plus three lines in `runSave` and `loadAllData`.

**2. `CostEntry.eventId` is never persisted.** Same shape of bug. The type
carries it, `resolveScope`'s `costsOf` and `sessions.ts`'s `costsForEvent` both
read it, and `useSessions.addCost` writes it when a cost is attached to an event
rather than a session. But `cost_entries` has no `event_id` column and
`persistence.ts` ignores it. An event-level cost — the pitch fee for a three-day
market, which is the entire reason the field exists — works until the app is
restarted and then reappears as a cost belonging to nothing, counted only in
date-scoped figures. Not fixed for the same reasons.

Note that both of these have a second consequence: because the columns do not
exist, sync cannot carry them either.

**3. `useSettings.hydrate` gives up on the first failure.** It is a sequence of
awaited `getAppSetting` calls, so if the database is unavailable partway through
— which is what happens when the Tauri APIs are absent — the remaining settings
keep their defaults. It fails the same way it did before this phase, in the same
place; the extraction moved it verbatim.

**4. `sync_now` chooses its direction by whether the local database has any rows
at all.** A device with one menu item uploads; a genuinely empty one downloads.
That is a reasonable heuristic for first contact and a poor one for anything
else, but it is unchanged and out of scope.

---

## Removed as dead

Named here so the removals are reviewable rather than buried in a diff.

- `calcDealPrice` in `App.tsx` — defined, never called, and a duplicate of
  `componentsTotal` in `lib/menu.ts`, which is the one actually used.
- `componentsTotal`'s import in `App.tsx` — imported, never referenced.
- `revenuePinInput` in `App.tsx` — a `useState` written in three places and read
  in none. `RevenuePinPad` keeps its own input state.
- `VIEW_SECTION` in `App.tsx` — a lookup whose only consumer assigned it to a
  local that was never used.

Four handlers were unreferenced but *kept*, because a domain hook is the right
home for them and a later phase is likely to reconnect them:
`useStock.addStockItem`, `useStock.updateStockItem`, `useMenu.addAssignment`,
`useMenu.removeAssignment`. They were dead in `App.tsx` as
`handleAddStockItem`, `handleUpdateStockItem`, `handleAddAssignment` and
`handleRemoveAssignment`.

## Deliberate small consistency changes

Two reads in `useSessions` (`group` and `ungroup`) previously mixed sources:
they took `before`/`after` from `dataSnapshotRef` but looked the target session
up in the state closure. They now use the ref for both. This can only differ
inside a single React tick, which is the case the ref exists for — so it is
strictly more correct, and it is called out here rather than left to be found.

---

## What the next phase can now assume

**About the documentation.** The six invariants are written down with their
enforcement points, and the ADRs record what was rejected and why. A change that
looks like it would violate one probably would; `03-INVARIANTS.md` says what
breaks. New decisions get a new ADR number — existing ones are never edited.

**About sync.** Every table the app persists now replicates. `SYNC_TABLES`
declares a write strategy per table, so adding a table is a one-line change that
forces the author to say which kind it is. Append-only tables converge by union
and cannot be damaged by a lagging device. Rust-side tests assert both the
ordering and the strategies, and will fail if a future edit reverts either.

What is *still* missing, and is the natural next piece of work: row versioning
(`updated_at` / `deleted_at` / `origin`), the mutation log, and therefore any
real conflict resolution on the `Replace` tables. Two devices editing the same
menu item offline still resolve last-writer-wins, silently. Nothing in this
phase makes that harder, and the per-table strategy gives it somewhere to hang.

**About time.** `Date.now()` is no longer called at render time anywhere that
displays a figure. Anything time-dependent takes `now` as a parameter, and
`useNow` is the single subscriber to a single timer. A new live figure should
take `now` explicitly and be added to the relevant dependency array — and a new
*expensive* computation should not be, unless it genuinely depends on the time.
The two stabilisers in `AnalyticsView` are the pattern for keeping a tick cheap;
if the scope grows another output that heavy consumers key on, it needs the same
treatment.

**About the structure.** `App.tsx` is composition. A new mutation belongs in one
of the five hooks, not in it. Each hook can be read and edited without reading
the others; the only shared surface is `StateCore`, which is two things.

Two rules to keep. **Do not centralise undo recording** — undo is asymmetric
(ADR-004), only the site of a change knows how to reverse it, and a central
recorder would have to be told, which is the same thing with more indirection.
**Do not give a hook its own save** — `saveImmediate` exists so that a
multi-table action is one write; splitting it produces partial writes, and the
ones that matter are exactly the money-adjacent ones.

The `dataSnapshotRef` pattern is load-bearing and is not an optimisation. A
future migration to a reducer or a store library has to preserve it or it will
introduce duplicate ticket numbers under rapid input, which is the normal
condition at a till and the hardest thing to reproduce anywhere else.

**About verification.** `smoke.check.mjs` is the tool for the next refactor:
diff its output before and after. It exercises the till path end to end and
needs no database. Extending it is cheap and worth doing whenever a phase adds
something to that path.
