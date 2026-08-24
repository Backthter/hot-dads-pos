# Phase 1B — Truthful ledger reads

**Depends on:** Phase 1A (complete, ADR-012 to ADR-015).
**Introduces:** ADR-016, ADR-017, convention 6.

---

## Goal

Make the stock ledger say the same thing to every reader.

1A-ii found this precisely and left it alone, correctly — it was a `reversed`
flag problem rather than a which-reasons-count problem, and 1A was about the
latter. Quoting its report:

> Reversals are written two ways. `undoMovement` appends its compensating line
> and marks both rows `reversed`; `reverseStockChanges` posts a plain negative
> `correction` and marks nothing. Both purchase figures skip `reversed` rows, so
> a delivery undone through the second path leaves its original `added` still
> counted while the line cancelling it counts as nothing.

So: undo a Rs 8,000 delivery through the order/stock path and the money still
showed as spent. The shelf was right and the books were wrong, in the direction
that overstates outlay — and because ADR-014 had just made a correction
definitively *not* a purchase, the compensating line **could not** cancel the
original. The two halves of one event were read by different rules.

Underneath the marking there was a naming problem. `correction` meant two
opposite things: a person measuring the shelf, and the program undoing itself.
One word for both is what made the unmarked path look reasonable.

---

## What changed

### Task 1 — `'reversal'` is its own reason

`'reversal'` joins `StockMovementReason`, distinct from `'correction'`, with the
distinction written into the type's doc comment because it is the kind of thing
a later reader will otherwise collapse back together.

- A **correction** is a person saying the shelf disagrees with the book. A
  measurement, carrying no cost, of stock that was already there.
- A **reversal** is the program undoing itself. Bookkeeping — never a purchase
  and never a count.

`MOVEMENT_LABELS` gains **"Undone"**, not "Reversal". That is what the user did,
and the ledger is read by someone standing at a counter. The label reaches stock
history and the workbook export with no further change at either site.

### Task 2 — The flag goes on both rows, set centrally

The defect was two paths disagreeing, so it is fixed where they converge.

**`buildMovement`** marks the reversal line itself whenever the reason is
`'reversal'`. A call site cannot forget, and a call site that has not been
written yet cannot forget either.

**`postMovements`** (new, `src/app/lib/inventory.ts`) marks the other half. It
takes a ledger and a batch of new lines, appends them, trims from the oldest
end, and sets `reversed` on any row a `'reversal'` line's `referenceId` points
at. Every write to the stock ledger in the program now goes through it.

It lives in `lib/inventory` rather than in the hook for two reasons: it is pure,
so `metrics.check.ts` can drive it directly and the marking rule is checked
rather than asserted about; and putting it beside `MOVEMENT_LIMIT` keeps the
trim and the marking in one place, which is the pairing they have to survive.

`useStock.appendMovements` is now a one-line caller of it. `reverseStockChanges`
produces `reason: 'reversal'` carrying `referenceType: 'movement'` and the id of
the row it cancels. **`undoMovement` is now a caller of `reverseStockChanges`**
rather than a second implementation that happened to agree about the shelf.

Two consequences fell out of routing everything through one door.

`applyStockChanges` and `applyItemsWithCorrection` now **return the lines they
wrote**. A caller that may later have to reverse itself needs those ids — the
alternative is inferring the pairing, which is what ADR-016 rejects.

Undo and redo now track the lines **currently standing** for a change rather
than the lines written the first time. A redo appends a fresh live line, so the
next undo has to cancel *that* one; reversing the original a second time would
mark a row already marked and leave the redone line counted as a live purchase
for ever. Every `history.record` in `useStock` holds a mutable `standing` list
for this, and each one says so.

`applyItemsWithCorrection` — the third write path, used by the stock editor
where more than the quantity changed — now takes the reason from its caller.
Undoing an edit is a `reversal` carrying the id of the line it cancels; redoing
one is an `edit` again, because that is a live event. It was posting an unmarked
`correction` in both directions. No money figure read it, so nothing was visibly
wrong, but leaving it would have made ADR-016's claim untrue the moment somebody
checked.

### Task 3 — `effectiveMovements`, and where it must not go

```ts
export function effectiveMovements(all: StockMovement[]): StockMovement[]
```

Drops rows marked `reversed`. No pairing logic, which is the point: the ledger
caps at 20,000 lines (ADR-001) and a trim drops the oldest, so a reversal
routinely outlives the row it reverses. Both halves carry the flag, so an
orphaned half is still marked and still excluded.

Routed through it: **`stockPurchasesValue`** (which had `|| m.reversed` inline),
**`shrinkageValue`**, **`deadStock`**, **`consumptionRate`**, and **`foodCost`**
— both its purchases, which come from `stockPurchasesValue`, and its `basis`,
because a count that was undone is not a count.

**`ledgerLevelsAt` deliberately does not**, and there is a long comment on it
saying so. It reads `resulting` — the physical level a row left behind — and a
reversal genuinely moved the shelf. Filtering there makes the last surviving
line at or before the mark the wrong one, so every historical level shifts by
the reversed amount, and both ends of `foodCost` go with it. Nothing errors.

`inventoryTurnover` is in the phase brief's list but reads no movements at all:
`totals.cogs` is the sum of frozen line costs on live orders, and average
inventory comes from the daily snapshots, which measure a shelf a reversal
genuinely moved. Both inputs are already effective by construction. Its doc
comment now says this, because ADR-017 lists it among the economic figures and a
reader will come looking for the call that is not there.

This is **ADR-017** and **convention 6**: *effective for economics, every row
for levels.*

### Task 4 — Redo restores the original's meaning

`undoMovement`'s restore used to call `reverseStockChanges` with the original
delta, appending a generic `correction`. After ADR-014 that row is not a
purchase, so an undone-then-restored Rs 8,000 delivery sat on the shelf and was
invisible to `stockPurchasesValue` and therefore to `foodCost`.

A restore now **appends a line duplicating the original's semantics** — the same
`reason`, the same `unitCost` and `totalCost`, with `referenceType: 'movement'`
and `referenceId` on the original. The original and its reversal stay netted
out; the new row is a live receipt and counts exactly once.

`StockChange` gains an optional `unitCost` for this, so a restore carries the
original's figure rather than re-deriving it from `totalCost` and whatever
happened to land.

This keeps the ledger append-only, needs no pairing, and survives a trim — the
same three properties the marking has, for the same reason.

### Task 5 — An undone void

**Verified, and it was already correct.** `voidOrder`'s undo restores the whole
order list from before the void, so `voidedAt` and `voidReason` go with it and
`voidStats` counts the ticket as live again. There is no separate flag to
forget, which is why it survived. A check now asserts it either way.

The stock side needs no reversal line, and the doc comment now says so:
returning a voided order's ingredients and taking them back off are real
physical movements with reasons of their own — `returned` and `sold` — not the
program undoing its own bookkeeping. Marking them `reversed` would hide a sale
that genuinely happened from consumption and food cost.

### Task 6 — The ledger reads as what happened

`QuickAddPanel`'s per-item activity list hides reversed pairs by default, with a
**Show undone (n)** toggle that appears only when there is something to show.

The ledger being append-only is correct; showing add / remove / add as three
equal events is what made it read as confusing. Shown, a cancelled line is
struck through and dimmed, and its partner is placed **adjacent by
`referenceId`**. Time order alone does not do it — the reversal is later than
the row it cancels and anything can have happened in between, which leaves the
reader inferring the pairing from two matching numbers some distance apart.

The **Undo last** button now reads the standing lines only. Offering it on a
reversed row would post a reversal of a reversal, which is not what the button
says. The toggle resets when the panel switches items: it is about the item
being looked at, not a preference.

The cross-item view stays where it is. Phase 1D moves it into Analytics.

### Task 7 — Verification

`metrics.check.ts` goes from **152 to 181 checks**. The new sections:

- **An undone delivery — the regression.** Receive Rs 8,000, undo through both
  paths, restore. `stockPurchasesValue` and `foodCost.purchases` report it
  exactly once at every step and zero after the undo, and the two undo paths are
  asserted to agree. Also: `buildMovement` marks a reversal and does not mark a
  correction, and the original row is marked too.
- **An orphaned reversal.** A ledger holding a reversal whose original a trim
  dropped, beside an unrelated live receipt. The orphan is excluded and the
  receipt is not — which is what proves the filter does not depend on pairing.
- **Levels read every row.** `ledgerLevelsAt` across a full undo/restore cycle
  returns the shelf to where it started, and the level *inside* the cycle is
  asserted alongside **the wrong answer the filter would have given**. Making
  `ledgerLevelsAt` "consistent" with the economic readers now fails a check
  rather than passing review.
- **A correction is still a correction.** A genuine stocktake is not marked,
  survives `effectiveMovements` and reaches `shrinkageValue`. Undone, it stops
  being a finding — and the shelf still remembers it.
- **An undone void** leaves `voidStats` where it started.

`postMovements` being pure is what makes the first two of these real checks of
the engine rather than assertions about a ledger written by hand.

### Task 8 — Documentation

ADR-016 and ADR-017 appended; `02-DECISIONS.md` remains append-only.
`01-DOMAIN.md`'s **Stock movement** section rewritten around the two reasons,
the central marking, and who reads what.

`03-INVARIANTS.md` gains a **Conventions** section. The five existing
conventions lived only in the phase documents, which is where a sixth would have
been unfindable; they are consolidated there with their phase of origin, and
invariant 1's *where it is enforced* list is updated for `postMovements`.

---

## Files touched

| File | What |
| --- | --- |
| `src/app/types.ts` | `'reversal'` reason; doc comments on the reason union and on `reversed` |
| `src/app/lib/inventory.ts` | `buildMovement` marks reversals; `MOVEMENT_LABELS`; `effectiveMovements`; `postMovements`; `MOVEMENT_LIMIT` moved here; `consumptionRate` reads effective rows |
| `src/app/state/useStock.ts` | `appendMovements`; `applyStockChanges` returns its lines and takes `unitCost`; `reverseStockChanges` posts reversals; `applyItemsWithCorrection` takes a reason; `undoMovement` routed and its restore rewritten; standing-line tracking at every `history.record` |
| `src/app/analytics/metrics.ts` | `effectiveMovements` in `stockPurchasesValue`, `shrinkageValue`, `deadStock`, `foodCost`'s `basis`; `ledgerLevelsAt` exported and commented as deliberately unfiltered; `inventoryTurnover` comment |
| `src/app/state/useOrders.ts` | comment only — why the void undo is correct and why its stock side is not a reversal |
| `src/app/inventory/QuickAddPanel.tsx` | Show undone toggle, pair adjacency, struck-through rows, `undoable` from standing lines |
| `metrics.check.ts` | five new sections, 152 → 181 checks |
| `docs/` | ADR-016, ADR-017, domain, invariants, this file |

No schema change. `stock_movements.reason` is a free-text column and
`persistence.ts` already had the only `UPDATE ... SET reversed` the model needs
— written for `undoMovement`, and now serving every path.

---

## Invariants introduced

None. The six stand as they are, and nothing here needed working around.

**Invariant 1** — the ledger is append-only — is the one this phase works
inside, and it is the reason for three of the decisions above rather than a
constraint any of them fought. Reversal by appending, redo by appending, and a
filter that reads a flag instead of matching rows all exist because the ledger
cannot be edited and can be trimmed.

**Convention 6** is added: *effective for economics, every row for levels.*

**Convention 5** is clarified rather than changed — see below.

---

## How to verify

```
npm run typecheck        # passes
npm run check:metrics    # 181 checks, all passing
npm run build            # not run this phase — see below
cd src-tauri && cargo test
node smoke.check.mjs     # diff against the previous commit
```

**Outstanding.** `npm run build`, `cargo test` and `smoke.check.mjs` were not
run — the session had no Rust toolchain and no browser. Nothing in this phase
touches Rust or the till path, so the risk is low, but they are unrun, not
passed.

Then by hand, on a copy of the real database — the thing the checks cannot see,
because `metrics.check.ts` drives the pure engine and not the React hooks:

1. Receive a delivery. Note stock purchases and actual food cost.
2. Undo it. Both figures must drop by the delivery's value, and the shelf must
   return to where it was.
3. Redo it. Both figures must return to their original values — **not double**.
4. Undo and redo it **again**. Still not double: this is the standing-line
   tracking, and it is the part with no automated coverage.
5. Do the same through the other undo path — undo an order that consumed stock —
   and confirm no phantom purchase appears.
6. Open stock history. The undone pair is hidden; **Show undone** reveals both
   halves, adjacent and visibly cancelled.
7. Run a stocktake correction. It must still appear as a correction, still reach
   shrinkage, and must not be hidden by the toggle.

---

## Bugs found and deliberately not fixed

**1 — A reversal does not unwind the weighted average cost.**
`applyStockChanges` re-averages an item's `costPerUnit` when a receipt carries
`totalCost`: what is on the shelf at the old cost plus what just arrived at the
new one. Undoing that receipt puts the quantity back but leaves the average
where the delivery moved it, and restoring it re-averages a second time against
a shelf that already reflects the first.

The quantities are right and every ledger line is right; what drifts is a single
derived field on the stock item. It is bounded — a full undo/restore cycle at
the same cost converges rather than diverging — and it self-corrects on the next
costed delivery. Fixing it properly means either storing the pre-delivery
average on the movement or recomputing the average by replay, and both are cost
model decisions rather than ledger ones. It belongs with whatever phase takes up
historical unit costs; invariant 3's note on `ledgerValueAt` — today's cost per
unit used deliberately for a historical level — is the neighbouring question.

**2 — `adjustStock` writes its undo entry even when the item was not found.**
`history.record` is inside `if (item && delta !== 0)`, so this is already
guarded; but `applyStockChanges` above it runs unconditionally, and a change to
an id that is not on the shelf silently writes nothing and reports nothing. It
is not reachable from the UI, which always passes an id it just rendered.
Pre-existing, unrelated to this phase, and left alone.

**3 — Convention 3 is not fully held by `useStock`.** Undo recording is at the
mutation site, as it should be, but all five sites that write ledger lines and
record an undo — `adjustStock`, `saveStockItem`, `stockTake`, `drainStock`,
`undoMovement` — now hold a mutable `standing` list, and the correctness of undo
depends on every future site
remembering to. The convention says a central recorder would be worse, and that
is still true — but this is the kind of repetition that eventually earns a
helper. Named here rather than fixed, because a helper designed against six
call sites in one file usually turns out wrong.

---

## What the next phase can now assume

**A stock movement's reason means one thing.** `correction` is a measurement,
`reversal` is bookkeeping, and nothing has to guess which a negative row is. If
you need to know whether an event stood, read `reversed`; do not match rows.

**`effectiveMovements` is the economic reader.** Any new figure about money or
usage goes through it. Any new figure about *levels* does not, and if you find
yourself making `ledgerLevelsAt` consistent with the rest, read ADR-017 first —
there is a check that will fail, and it is failing on purpose.

**Every ledger write goes through `postMovements`.** A new path that appends
lines should call it rather than `setStockMovements` directly; it is what makes
the marking rule hold without each site knowing about it.

**`applyStockChanges` returns what it wrote.** If a new mutation records an undo
entry, hold those lines and reverse *them*, not the request you made.

### Convention 5 governs targets, not projections

This needs saying explicitly, because Phase 1E builds within-day forecasting and
convention 5 reads, at a glance, like a prohibition on exactly that.

Convention 5 — *a target may not depend on when it is read* — was added by 1A-ii
as the general form of the break-even defect: the target moved as sales came in,
so it read one number at ten o'clock and another at four on identical facts. A
figure a shop is meant to **aim at** must be a function of the facts in force.

A **projection** is the opposite kind of object. "At this rate you will finish
the day on Rs 84,000" *is* deliberately a function of how far through the
session the reader is — that is what makes it a projection rather than a guess,
and it is expected to move as the day proceeds. Convention 5 does not govern it.

The rule to hold instead:

- A projection must be **labelled as a projection**, on screen, wherever it
  appears.
- It must never be presented as a target, sit in a target's slot, or be compared
  against actuals as though it were one.
- A target on the same screen still obeys convention 5, and the two must be
  visually distinguishable without reading the numbers.

Recorded here so that a later session reading convention 5 does not either
refuse to build the forecaster or quietly break it by pinning a projection to
the period's opening facts.

### Still open, and still out of scope here

- **The ungrouped-session scope wrinkle** 1A-ii recorded as its bug 2. Scope
  behaviour, belongs with 1C.
- **`useSettings.hydrate`'s first-failure behaviour**, from Phase 0.
- The cost-averaging drift above, for whichever phase takes up historical unit
  costs.
