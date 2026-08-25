# The demo dataset

Six weeks of a burger stall, generated. It exists so a change can be **looked
at** — most of what `docs/` argues about is invisible on an empty database.

```bash
pnpm demo:build
```

Then either:

```bash
pnpm dev:demo
```

for the browser, or

```bash
pnpm tauri:dev:demo
```

for the real desktop build. Both show the same shop.

---

## It cannot touch your real data

The app opens `hotdads.db`. A demo build opens **`hotdads-demo.db`** — a
different file, in the same directory, chosen in one place
(`src/db/database.ts`) and nowhere else. `demo/build.ts` refuses to write any
file with the real name, and prints the path it left alone.

Nothing in the normal `pnpm dev` / `pnpm tauri:dev` path is affected. There is
no flag to set and nothing to remember: without `--mode demo`, the demo code is
not in the bundle at all.

To throw the demo away, delete `hotdads-demo.db`. To reset it, run
`pnpm demo:build` again — it is regenerated from scratch each time.

## What is in it

| | |
|---|---|
| ~450 orders across six weeks | including 7 voided and a fortnight taken before costing existed |
| 13 trading sessions | one still running, so live figures are live |
| **Riverside Market** — 3 sessions, one event | the ADR-013 case: a pitch fee paid once, held out of each day |
| **Food Truck Friday** — 1 session, one event | an event of one, legitimate because a person declared it (ADR-020) |
| **Winter Fair** — 0 sessions, next weekend | planned, already paid for. The scope picker hides it; the cost form offers it |
| 21 session-less orders | never guessed into a session (invariant 4) |
| 38 cost entries | every basis, including a `per-unit` targeted at the Food category (ADR-022) |
| 8 stock items, 12 recipe lines | Water and Napkins have no recipe, so `dataQuality` has something to flag |
| ~1,850 stock movements | deliveries, sales, waste, a stocktake, a correction, and one reversed pair |
| 2 unpriced deliveries | napkins bought for cash. `—`, never `Rs 0` (invariant 2) |
| 8 oversells | the Riverside Saturday ran out of patties |

Ingredient prices drift upward across the six weeks, so **realised margin** and
**margin today** are genuinely different numbers (ADR-015) rather than the same
one twice.

## Things worth opening it to see

- **Finance, scoped to Riverside · Saturday.** *Passed B/E at* names ticket 45 of
  71 — a crossing genuinely in doubt for most of the service. Op. costs shows
  the day's own, with `+ Rs 9,000 held by the event` beneath.
- **Finance, scoped to Riverside Market.** The same pitch fee, now charged once,
  on the event's row. The session rows above it do not carry it.
- **History · Money.** The delivery commission logged as *12%* appears as what
  12% actually came to. The napkins appear as `—`. The Winter Fair pitch appears
  on the day it was paid, for a market that has not traded.
- **Finance and Money together.** Profit is **+Rs 45,000**; cash is
  **−Rs 20,000**. Both are right — the difference is stock on the shelf and a
  pitch paid in advance. That is the whole of what the costs explainer teaches,
  as two numbers that disagree.
- **A Finance row, clicked.** Drills through to the money behind it.
- **Inventory.** Four items are under their reorder threshold and one — napkins
  — has no cost on file at all, so its value is unknown rather than zero.

## How it is built

`demo/data.ts` is pure and generates a `DataSnapshot`. It is **deterministic**
given the day it runs on, and **anchored to today**, so *Last 7 days* always has
something in it.

`demo/build.ts` writes the file, and does two things worth knowing:

- **The schema is read out of `src-tauri/src/lib.rs`** rather than copied. The
  real database gets its tables from `run_migrations` at startup; the demo file
  never sees that function, so a copy of the DDL here would be right until the
  next column was added and then silently wrong.
- **The rows are written by the app's own `saveAllData`,** through a small
  `better-sqlite3` adapter, then read back with `loadAllData` and counted. The
  seed is therefore also a test of the persistence layer, which has none.

Finally it measures what the dataset demonstrates and **fails if the interesting
cases have gone** — no oversells, no crossing, no unpriced delivery, cash and
profit agreeing. A demo that has quietly stopped demonstrating anything is worse
than no demo, because it looks like evidence.

## Editing it

Change `demo/data.ts` and run `pnpm demo:build`. The knobs most worth turning
are `SESSIONS` (what traded and when), the cost block (what a service costs to
stand up, which is what moves the break-even crossing), and `BUFFER` (how much
the stall over-orders, which is what moves the gap between cash and profit).

`demo/data.ts` is covered by `pnpm typecheck`. `demo/build.ts` is not — it needs
Node globals, and `@types/node` changes `setTimeout`'s return type across the
app. It is exercised every time it runs.
