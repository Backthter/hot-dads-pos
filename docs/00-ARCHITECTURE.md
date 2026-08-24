# Architecture

PosV3 is an offline-first point of sale. It runs a real burger stall today and
is being developed toward something sellable.

- **React 18 + TypeScript + Vite** for the interface.
- **Tauri v2** for the desktop shell, the printer, the window, and the sync
  transport. The Rust side is small and deliberately so.
- **SQLite**, through `@tauri-apps/plugin-sql`, as the only durable store. The
  schema is declared with drizzle but almost all reads and writes go through
  hand-written SQL in one file.

Offline-first is not a feature here, it is the operating condition. The stall
trades at markets with no connection at all. Nothing in the ordering path may
await the network, and the sync layer is a thing that happens later, to a
database that was already correct without it.

---

## The tree

```
src/
  main.tsx              entry; mounts <App />
  app/
    App.tsx             composition and layout only
    types.ts            every domain type, with the reasoning on it
    state/              one hook per domain — where every mutation lives
    screens/            one file per screen: what is shown, not what it does
    components/         shared presentational pieces
    lib/                pure domain logic; no React except history/navigation
    analytics/          the reporting layer, and its own screens
      tabs/             the four analytics tabs, and the tab set as data
    inventory/          the stock screens
    settings/           the settings screen
    ui/                 the design system: tokens, primitives, motion, clock
    imports/            Figma-exported SVG artwork
  db/
    schema.ts           drizzle table declarations
    persistence.ts      load and save the whole world
    database.ts         the SQLite handle
    sync-client.ts      typed wrappers over the Tauri sync commands
    SyncSettings.tsx    the sync panel in Settings
  print/printTicket.ts  receipt formatting
  styles/               CSS variables and fonts
src-tauri/src/
  lib.rs                Tauri setup, commands, DB bootstrap
  sync.rs               the SCSP client and the table replication
  print.rs              raw printing
docs/                   this directory
metrics.check.ts        hand-computed checks for the analytics
smoke.check.mjs         a scripted run through the till, for refactors
```

---

## What depends on what

```
                    ┌──────────────┐
                    │   types.ts   │   no dependencies at all
                    └──────┬───────┘
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
   ┌────▼────┐      ┌──────▼──────┐    ┌──────▼──────┐
   │   lib/  │◄─────┤  analytics/ │    │    db/      │
   │  pure   │      │   metrics   │    │ persistence │
   └────┬────┘      └──────┬──────┘    └──────┬──────┘
        │                  │                  │
        │            ┌─────▼──────┐           │
        │            │ analytics/ │           │
        │            │   scope    │           │
        │            └─────┬──────┘           │
        │                  │                  │
   ┌────▼──────────────────▼──────────────────▼────┐
   │                 app/state/                    │
   │   useOrders  useStock  useMenu                │
   │   useSessions  useSettings                    │
   └───────────────────────┬───────────────────────┘
                           │
                    ┌──────▼───────┐
                    │   App.tsx    │  composition
                    └──────┬───────┘
                           │
        ┌──────────────────┼──────────────────┐
   ┌────▼─────┐     ┌──────▼──────┐    ┌──────▼──────┐
   │ screens/ │     │ components/ │    │  */ views   │
   └────┬─────┘     └──────┬──────┘    └──────┬──────┘
        └──────────────────┴──────────────────┘
                           │
                     ┌─────▼─────┐
                     │    ui/    │   used by everything above
                     └───────────┘
```

The rules that hold this up:

- **`types.ts` imports nothing.** It is the vocabulary, and everything else
  agrees with it.
- **`lib/` is pure.** `orders.ts`, `inventory.ts`, `sessions.ts` and `menu.ts`
  are plain functions over plain data, with no React and no I/O. That is what
  makes `metrics.check.ts` able to run them under `tsx` with no DOM. Two files
  in `lib/` are exceptions and are React by nature: `history.tsx` and
  `navigation.tsx` are context providers.
- **`analytics/` reads, it never writes.** `metrics.ts` and `scope.ts` are pure.
  The one thing the analytics screens mutate is cost entries, and they do that
  through callbacks handed down from `App.tsx`.
- **`state/` is the only place mutations happen.** Nothing below it calls a
  setter.
- **`ui/` depends on nothing but React.** No screen may reach into another
  screen's directory; anything two screens share moves to `ui/` or `components/`.

---

## Where state is owned

All durable state lives in `AppInner` (`App.tsx`), created by the five domain
hooks and passed down as props. There is no store library, no context for
application data, and no server state.

| Hook | Owns |
|---|---|
| `state/useOrders.ts` | the cart, parked sessions, checkout, board status moves, voiding, edit sessions |
| `state/useStock.ts` | stock items, the movement ledger, snapshots, oversells, stocktake, drain, packets |
| `state/useMenu.ts` | menu items, categories, stock assignments |
| `state/useSessions.ts` | trading sessions, events, cost entries |
| `state/useSettings.ts` | tax, PINs, grill capacity, UI scale, theme, printing |

Each returns `{ state, actions }`. Each records its own undo entries through
`useHistory()` (ADR-004 and ADR-011).

Three cross-cutting pieces sit outside the domain hooks, in `state/core.ts` and
`lib/history.tsx`, because more than one hook needs them:

**The snapshot ref.** `StateCore.snapshot`, created by `useDataCore` and filled
in by `useDataPersistence`, holds the latest value of every piece of domain
state, updated in an effect on every change. Handlers read from it rather than
from their own closures. This is not an optimisation — it is correctness. Two
orders can be rung up inside a single React tick, and a handler reading the
session list from a stale closure would hand both of them the same ticket
number, which is the one thing session numbering exists to prevent. Two smaller
refs work the same way and are assigned during render rather than in an effect,
because they are read from event handlers that can fire before a commit:
`sessionsRef` in `useSessions` and `grillCapacityRef` in `useSettings`.

**The save coordinator.** One `saveImmediate(override?)`, on `StateCore`, which
every hook calls. Several handlers write more than one table in a single action — voiding
an order touches `orders`, the order counter and the stock ledger — and letting
each hook save independently produces partial writes. A debounced background
save runs alongside it, writing the whole snapshot rather than a hand-listed
subset, because that list had already drifted once.

**Undo.** `HistoryProvider` in `lib/history.tsx` is a context, mounted above
`AppInner`, holding one stack shared by every domain.

Screen-local state — which tab, which period, whether the grill is collapsed,
whether the parked sidebar is open — lives in the screen that draws it, under
`src/app/screens/`. `lib/screenState.ts`'s `useStickyState` persists the small
amount of it that should survive navigating away and back.

The screens take hook *handles* rather than three dozen individual props. These
are the app's own screens rather than reusable components, and a `SettingsScreen`
that receives `menu` and `settings` is easier to read and harder to miswire than
one that receives forty callbacks.

---

## How a mutation reaches SQLite

Take voiding an order, which is the most involved path in the app.

1. **The gesture.** A button in `components/Section` calls `onDelete(order.id)`,
   which is `useOrders`'s `voidOrder`. The first press arms it and sets a
   three-second timer; the second press within that window commits.

2. **Read the truth.** The handler reads `dataSnapshotRef.current.orders`, not
   its closure. Everything it needs for the reversal — the previous orders
   array, the previous counter — is captured here, at the moment of the change.

3. **Compute the new world.** The ingredients go back through
   `returnStockForCart`, which resolves the cart into stock deltas with
   `stockUsageForCart` and hands them to `applyStockChanges`. That appends one
   `returned` movement per item, each carrying `referenceType: 'order'` and the
   order's immutable id, and sets the items' new quantities. `renumberOrders`
   closes the gap in the live sequence without touching the voided row's number.

4. **Set state.** `setOrders`, `setOrderCounter`, `setStockItems`,
   `setStockMovements`. React re-renders; the effect that maintains
   `dataSnapshotRef` runs and the ref catches up.

5. **Record the reversal.** `history.record({ label, scope, confirm, undo,
   redo })`. All three things — the row, the numbering and the stock — move
   together in one action, because none of them mean anything on their own. The
   `confirm` string is present because this is money-adjacent (invariant 6).

6. **Persist.** `saveImmediate({ orders, orderCounter })` merges the override
   over the snapshot and calls `saveAllData`, which serialises through a
   promise queue so two saves cannot interleave. `runSave` writes every table
   differentially: `DELETE` only the rows that have gone, `INSERT OR REPLACE`
   the rest — except the append-only tables, which are only ever inserted.

7. **Sync, later and separately.** A 30-second timer in `App.tsx` asks Rust
   whether SQLite's `data_version` has moved and, if so, uploads. Nothing in
   steps 1–6 waits for it, or fails if it is not configured.

The shape generalises: **read the ref, compute the whole next world, set state,
record how to undo it, then save.** A handler that computes from its closure, or
records an undo that only restores part of what it changed, is the recurring
class of bug in this codebase.

---

## Persistence

`db/persistence.ts` is deliberately one file and deliberately hand-written SQL.

`loadAllData()` reads every table into a `PersistedData` object once, at
startup. There is no lazy loading and no query layer: the whole dataset is a few
thousand rows, it fits in memory comfortably, and every analytics figure wants
all of it anyway.

`saveAllData(data)` writes the whole object back. Saves are queued through a
single promise chain, so a debounced background save and an immediate one cannot
interleave. Each table is written differentially — the rows that disappeared are
deleted, the rest are `INSERT OR REPLACE`d — which keeps the sync layer's change
tracking quiet.

Three tables are exceptions, and the exception is the point:

- **`stock_movements`** — rows already on disk are skipped entirely. The only
  write against an existing row is `UPDATE ... SET reversed = ?`.
- **`oversell_events`** — known ids are skipped.
- **`inventory_snapshots`** — keyed on (date, item) and written once a day.

`orders`, `trading_sessions` and `trading_events` are never deleted here either,
for the reasons in ADR-002 and ADR-003, though they are otherwise replaced
normally.

---

## Sync

Sync is a Rust-side full-table replication over SCSP to a SQLite Cloud database.
It is not a merge engine and does not pretend to be one.

`SYNC_TABLES` in `src-tauri/src/sync.rs` lists what replicates, **in order**, and
declares each table's write strategy:

- **`Replace`** — current-state tables. Download clears the table and
  `INSERT OR REPLACE`s the cloud rows; the cloud copy wins.
- **`Append`** — the immutable logs. Rows are never cleared and never replaced;
  both directions use `INSERT OR IGNORE`, so the two copies converge by union
  and a stale device cannot overwrite or remove a good row (ADR-010).

Order in the array matters, because rows carry foreign keys that are not
declared as constraints: sessions precede orders, because orders carry a
`session_id`; stock items precede movements and assignments.

`sync_now` decides direction by whether the local database has any rows at all —
a fresh device downloads, an established one uploads. `sync_send_changes` is a
full upload of every row in every synced table, which is what the "Resend
everything" button in `db/SyncSettings.tsx` calls.

What sync does **not** have, and what a later phase is for: row versioning
(`updated_at` / `deleted_at` / `origin`), a mutation log, and therefore any
genuine conflict resolution on the `Replace` tables. Two devices editing the
same menu item offline still resolve last-writer-wins, silently.

---

## Analytics

`analytics/metrics.ts` is a library of pure functions over orders, movements,
snapshots and stock items. It has no React, no state and no I/O, which is why
`metrics.check.ts` can run it directly.

`analytics/scope.ts` sits above it and resolves the one scope control into the
orders, costs, sessions, date window and trading-hours denominator that
everything else reads.

`analytics/AnalyticsView.tsx` is the screen, and is mostly a wall of `useMemo`.
The dependency arrays there are load-bearing: `now` from `useNow` belongs in the
memos that genuinely depend on the current time — the scope, food cost, trading
hours — and deliberately not in the item and category tables, which do not, and
which are expensive (ADR-009).

**The screen is four tabs, and the split between them is not the split between
the files.** Since Phase 1C-i the tabs are:

| Tab | Question | Absorbs |
|---|---|---|
| **Finance** | Did this pay? | the old Overview and Costs |
| **Inventory** | What do I have, and what is it doing? | — |
| **Business** | What's working? | the old Sales |
| **History** | What happened? | the old Orders |

History carries a source selector — **Orders · Stock · Money** — because those
are three record sets answering one question rather than three destinations.
Costs is no longer a tab at all: logging a cost is something done *because* of a
figure, so `CostsPanel` and the costs explainer are pages reached from Finance,
pushed as navigation steps so Back returns to the tab they were opened from.

`analytics/tabs/` holds the four tab components and one file that is not a
component. **`tabs/model.ts` is the tab set as data** — ids, labels, the History
sources, the lock capability and the id migration — and it is deliberately pure,
with no React and no icons, so `metrics.check.ts` can run the parts of the tab
bar that are worth checking. The icons are attached in `AnalyticsView`, where
the bar is drawn.

**The memo layer stays in `AnalyticsView` and the tabs render.** This is the
load-bearing half of the arrangement rather than a matter of taste. The scope is
resolved once, its outputs are held steady by value (`useStableList`,
`useStableRange`), and every figure is derived from those stabilised values
before a tab sees it. A tab that resolved its own scope would recompute on every
clock tick and undo ADR-009's work, so **a tab takes computed figures as props
and computes nothing for itself.** What a tab does own is its own presentation
state — which item break-even is showing, which cut the revenue chart is on.

The revenue PIN is a capability each tab declares — `'all' | 'money-columns' |
'none'` — resolved in one place by `lockFor` and `resolveLock` (ADR-019).
Nothing else in the section reads `revenueLocked` to decide whether to draw
itself.

---

## The Rust side

Kept small on purpose. `lib.rs` sets up Tauri, opens the database, and exposes
a handful of commands. `print.rs` writes raw bytes to a printer. `sync.rs` is
the only substantial piece, and it is a client for one protocol.

Nothing in Rust knows about the domain. It moves rows and bytes; every rule in
this document is enforced in TypeScript.
