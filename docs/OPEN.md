# Open

Everything found and deliberately not fixed, in one place.

Phase documents record a finding **in context**, at the moment it was found.
This register is where it lives afterwards. A phase document should say
*"Carried forward: see `docs/OPEN.md`"* rather than re-listing what earlier
phases found — by 1C-ii-a the same five items had been restated across five
documents, which is duplication waiting to drift.

**Every phase updates this file.** Add what you found and left alone; remove
what you closed, and say so in your report so the register is not quietly
shorter by accident.

Ordered by what happens if nobody fixes it.

---

> **Verified against the tree at `d969b9b`** by the docs-scaffold session, and
> maintained since. The register was seeded by the planner from phase reports
> rather than from the code; every entry was checked against the file it names,
> six were added from phase documents that had never reached the register, one
> entry's stated consequence was wrong, and two rows of the Closed table were
> attributed to the wrong phase.
>
> **Line numbers are as at the phase that last touched the entry.** They are
> given because "somewhere in `useStock.ts`" costs the next reader ten minutes,
> not because they are guaranteed current — check the name, not the number.

---

## The whole nav slot is outside the revenue lock, and the export menu is in it

**Found:** 1C-i · **Take it:** Phase 6, first thing
**Where:** `src/app/analytics/ExportMenu.tsx`, `src/app/analytics/workbook.ts`;
mounted at `AnalyticsView.tsx:403` inside `NavActions`. The `lock.hidden` branch
begins at `AnalyticsView.tsx:441`, after the nav slot has closed — so **nothing
rendered in that slot is locked**, not just the export.

**What happens if it is not fixed:** a user with no revenue PIN presses Export
and receives a workbook containing every figure the lock hides. The lock becomes
decoration.

**Why it was deferred:** 1C-i was structural and the export belongs to Phase 6.
ADR-019 made the lock per-tab; the export sits outside the tab system entirely,
so it inherited nothing.

**The wider form of it, found in 1C-ii-b:** the gap is the slot, not the button.
`ScopePicker` lives there too, and the obvious way to draw a hierarchical scope
list is with each session's takings beside it — which would put revenue in front
of a user with no PIN without anybody noticing they had done it. 1C-ii-b left
money out of that list for this reason and said so in the component. Whoever
closes this should close it at the slot, so the next control added there
inherits the lock instead of having to remember it.

**Urgent when:** anyone but the owner uses the program. This is a **V2 blocker** —
the whole point of roles is that a cashier cannot see margins, and an export
button defeats it in one press.

---

## `sync_now` uploads whenever the local database has any rows at all

**Found:** Phase 0 · **Take it:** V2, Phase C
**Where:** `src-tauri/src/sync.rs`, `sync_now` — the `local_has_data` loop and
the branch on it.

**What happens if it is not fixed:** the direction is not a comparison of row
counts. It is a boolean: the loop breaks on the **first** table with a non-zero
count, so a device holding a single menu item uploads, and only a genuinely
empty database downloads. A second device that has been offline and has diverged
will therefore always push its state over the cloud's, never reconcile with it,
and it will do so without reading what is on the other side first.

**Why it was deferred:** the sync layer is replaced wholesale in V2 and patching
its heuristic now means writing code that gets deleted. Phase 0 fixed the part
that was losing data outright — the three missing tables — and left the rest.

**Urgent when:** a second device is used in earnest. Today this is one person on
one machine with a backup, and the failure mode is bounded by that.

---

## Undoing a costed receipt leaves the averaged cost where the delivery moved it

**Found:** 1B · **Take it:** unassigned — a cost-model decision
**Where:** `src/app/state/useStock.ts:127`, the weighted average inside
`applyStockChanges`.

**What happens if it is not fixed:** receive mince at a higher price, undo the
receipt, and `StockItem.costPerUnit` stays at the blended figure rather than
returning to what it was. Every subsequent recipe cost is slightly wrong until
the next real delivery re-averages it.

**Why it was deferred:** bounded and self-correcting, and reversing an average
properly means deciding what a historical unit cost *is* — whether the ledger
should carry the pre-receipt cost so it can be restored, which is a change to
the cost model rather than a fix.

**Urgent when:** someone undoes a receipt at a materially different price and
then reads margins before the next delivery. Low frequency, small magnitude.

---

## `useSettings.hydrate` gives up on the first failure

**Found:** Phase 0 · **Take it:** unassigned
**Where:** `src/app/state/useSettings.ts:77` — a flat sequence of awaited
`getAppSetting` calls with no `try`/`catch` around any of them.

**What happens if it is not fixed:** one unreadable settings key stops every
later key from loading. The program starts with defaults for things the user set,
silently. The keys are read in source order, so *which* settings survive depends
on where in that list the failure lands.

**Why it was deferred:** Phase 0 was a pure refactor and changing failure
behaviour is not refactoring.

**Urgent when:** a settings key is ever written malformed — which is most likely
during a migration, i.e. exactly when the user is least able to diagnose it.

---

## `useMenu.addAssignment` and `removeAssignment` record no undo entry

**Found:** 1A-ii · **Take it:** whichever phase first calls them
**Where:** `src/app/state/useMenu.ts:205` and `:220`. Both are exported on
`actions`; neither has a caller anywhere in `src/`.

**What happens if it is not fixed:** nothing today — nothing calls them. Both
mutate a single assignment and save immediately, and neither touches
`history.record`. A screen that wired its per-row controls through them would
make every recipe change silently un-undoable, against ADR-004 and against
Phase 0's rule that the site of a change records its own reversal.

**Why it was deferred:** 1A-ii was briefed to wire them into the new Assign Stock
navigation and found that doing so would be a regression — `AssignDetail` is a
draft-then-save editor that commits through `saveAssignments`, which records one
undo entry for the whole recipe change. The bulk save was kept and these were
left alone.

**Urgent when:** anything calls them. Whoever does must give them an undo entry
**first**, not afterwards.

---

## `deleteEvent` returns a refusal that only the manager reads

**Found:** 1C-ii-a · **Take it:** whichever phase adds a second caller
**Where:** `src/app/state/useSessions.ts:349`. The one caller is
`src/app/components/SessionBar.tsx:592`, which surfaces the reason.

**What happens if it is not fixed:** nothing today — the manager is the only
caller and it surfaces the refusal. A second caller that discards the result is
a deletion that silently does nothing, and the user presses the button again.

**Why it was deferred:** correct as written; the risk is in the next call site,
not this one.

**Urgent when:** anything else calls it. Whoever adds that caller owns this.

---

## `adjustStock` reports nothing when the item id is not on the shelf

**Found:** 1B · **Take it:** unassigned
**Where:** `src/app/state/useStock.ts:305` — `applyStockChanges` runs
unconditionally, two lines above the `if (item && delta !== 0)` guard that wraps
`history.record`.

**What happens if it is not fixed:** a call with an id that is not in
`stockItems` writes no movement, records no undo entry, and returns without
error. The caller cannot tell a change that was applied from one that was
dropped.

**Why it was deferred:** not reachable from the UI, which always passes an id it
has just rendered. Pre-existing and unrelated to the phase that found it.

**Urgent when:** anything calls `adjustStock` with an id it did not just render —
an import, a sync reconciliation, or a scripted correction.

---

## `plannedEnd` is the start of the last day, not the end of it

**Found:** 1C-ii-a · **Take it:** whichever phase first computes on it
**Where:** `src/app/types.ts:197` (`TradingEvent`); parsed by `fromDateInput` at
`src/app/components/SessionBar.tsx:382`, which builds the date from a
`T00:00:00` string — local midnight.

**What happens if it is not fixed:** the value **is** read today — `rangeLabel`
at `SessionBar.tsx:703` renders it as a plan on the event row — but nothing
sorts, filters or ranges on it, so nothing is wrong yet. The first thing that
does will treat a three-day market as ending at midnight on day three, i.e.
excluding day three.

**Why it was deferred:** the field is a plan, not a measurement, and 1C-ii-a was
explicit that the sessions remain the record. No computing consumer exists.

**Urgent when:** any computing consumer exists.

---

## Convention 3's undo recording is repeated at five sites in `useStock`

**Found:** 1B · **Take it:** unassigned — a judgement call, not a defect
**Where:** `src/app/state/useStock.ts` — `adjustStock` (:293), `saveStockItem`
(:330), `undoMovement` (:425), `stockTake` (:484), `drainStock` (:525). Each
holds its own mutable `standing` list and is responsible for reversing it.

**What happens if it is not fixed:** nothing today; all five are correct. But the
correctness of undo now depends on every *future* ledger-writing site
remembering the same pattern, and nothing enforces it.

**Why it was deferred:** convention 3 says a central recorder would be worse, and
that is still true. This is the kind of repetition that eventually earns a
helper — but a helper designed against six call sites in one file usually turns
out wrong, so it was named rather than built.

**Urgent when:** a sixth site is added, or one of the five is copied.

---

## Sticky state is in-memory, so the tab migration cannot fire in production

**Found:** 1C-i · **Take it:** whoever gives sticky state a disk
**Where:** `src/app/lib/screenState.ts:20` — the store is a module-level `Map`.
The migration it would feed is `migrateTabId` at
`src/app/analytics/tabs/model.ts:187`, consumed in
`src/app/analytics/AnalyticsView.tsx:161`.

**What happens if it is not fixed:** nothing — the old tab ids cannot survive a
restart, so there is nothing to migrate. The migration is correct and checked,
and is dead code.

**Why it was deferred:** it is not a defect. It is recorded because it becomes
load-bearing the moment sticky state persists, and at that point a *silently*
dead migration would be a real bug.

**Urgent when:** sticky state is persisted. Whoever does that must check this.

---




## The exported workbook's break-even ignores per-unit targeting

**Found:** 1C-ii-b · **Take it:** Phase 6, with the export
**Where:** `src/app/analytics/workbook.ts:286` — `breakEven(totals, costs)`,
with no sales mix.

**What happens if it is not fixed:** for a shop that targets a `per-unit` cost
at some items (ADR-022), the break-even in the exported workbook is **higher**
than the one on screen. `resolveCosts` charges a targeted cost in full when it
is given no mix, which is the deliberate pessimistic fallback — so the export is
conservative rather than flattering, and no figure in it is invented. But two
numbers with the same name disagree across two surfaces, which is the shape of
problem ADR-014 was written about.

**Why it was deferred:** the fix is three lines — `workbook.ts` already computes
`items` at `:281` and would need the category list threading in — but the export
is Phase 6's, it is the same file that has to grow the revenue lock, and doing
one without the other means opening it twice.

**Urgent when:** anyone targets a per-unit cost and then reconciles the export
against the screen. Not before: with nothing targeted the two are identical.

---

## A `per-unit` cost can only be pointed at one item at a time

**Found:** 1C-ii-b · **Take it:** whichever phase next touches the cost form
**Where:** `src/app/analytics/CostsPanel.tsx` — the `Charged on` select. The
type and the resolver both take a list: `CostAppliesTo` is
`{ kind: 'items'; ids: string[] }` and `resolveCosts` walks every id.

**What happens if it is not fixed:** a cost that genuinely rides on three items
has to be logged as three costs, or as a category that also catches things it
does not ride on. Neither is wrong in the figures — three entries of Rs 12 each
targeted at one item resolve exactly as one entry targeting three — but the
ledger reads as three purchases of the same thing.

**Why it was deferred:** the storage and the arithmetic are the part that is
hard to change later, and both handle the list already; a multi-select is a
control, and the control is cheap to add once somebody knows whether the shop
wants one. Building the picker first and finding the shape wrong is the more
expensive order.

**Urgent when:** the shop asks for it. There is no correctness pressure here.

---

## Finance computes its per-session figures twice

**Found:** 1C-iii-a · **Take it:** 1C-iv, with the tab's layout
**Where:** `src/app/analytics/tabs/FinanceTab.tsx` — the *Sessions in scope*
panel, fed by `sessionPerformance`, sitting under the table fed by
`financeRows`.

**What happens if it is not fixed:** both walk the same orders and both produce
a per-session `Totals`. Today they cannot disagree — each calls `totalsFor` over
`ordersForSession` — but the screen now shows a session's takings and ticket
count twice, from two computations, and that is the exact shape of the defect
ADR-014 was written about: two functions answering one question until the day
one of them is edited.

**Why it was deferred:** the panel is not wrong and its one distinctive figure —
revenue per trading hour — is not in the table. Folding it in means adding a
column and deleting a panel, which is a decision about the tab's layout, and
1C-iii-a was briefed to add a table rather than to rearrange what was already
there.

**Urgent when:** either figure is edited, or a third caller wants per-session
totals. Whoever adds the revenue-per-hour column should delete the panel in the
same change.

---

## Actual food cost fell for periods containing positive corrections

**Found:** 1A · **Take it:** nothing to take — recorded so it is not mistaken
for a regression
**Where:** `foodCost` at `src/app/analytics/metrics.ts:1754`.

**What this is:** ADR-014 made a purchase a receipt, so positive corrections
stopped counting as purchases. That was the fix. The consequence is that the
figure steps down at that commit for any historical period containing one.

**Why it matters:** if you have been tracking food cost across weeks, expect a
step change rather than a trend, and do not go looking for the cause. The old
number was the wrong one.

---

## Closed

Kept so that a later reading knows the register got shorter on purpose.

| | Found | Closed by |
|---|---|---|
| `CostEntry.eventId` was never persisted — event costs vanished on reload | Phase 0 | 1A-i, commit `86540af` — the `event_id` column, written at `db/persistence.ts:525` |
| `MenuItem.unitCostOverride` was never persisted | Phase 0 | 1A-ii, ADR-015, commit `879d475` — by removing the field **from the menu**. Nothing writes it and no column exists; `types.ts:43` and `lib/inventory.ts:173` still read it as a deprecated parser concern |
| `stock_movements`, `inventory_snapshots`, `oversell_events` missing from `SYNC_TABLES` | Phase 0 planning | Phase 0 — all three present as `append` at `sync.rs:83`–`:87`, with Rust tests on ordering and strategy |
| `foodCost` and `stockPurchasesValue` disagreed about the same delivery | 1A | 1A-ii, ADR-014, commit `b998577` |
| A delivery undone through `reverseStockChanges` stayed counted | 1A-ii | 1B, ADR-016 — `'reversal'` is its own reason at `types.ts:396` |
| `per-event` unavailable for a lone session with no route forward | 1A-ii | 1C-i (ADR-018) and 1C-ii-a (ADR-020) |
| The cost basis picker kept a stale session target across a switch to `per-event` | **1A-ii** | **1A-ii**, commit `4fd29c2` — the clear is in the basis button's `onClick` at `CostsPanel.tsx:239`. A later review re-reported this as a fresh finding; it had been fixed for four phases. See `BUG-FIXES.md` §2 |
| `editEvent` overwrote unsent details with empty — silent loss of notes | 1C-ii-a | the **review pass after** 1C-ii-a's phase document, commit `8dede70`. Not "the same session": `8dede70` lands after `2151f8b`, and 1C-ii-a's phase document does not mention it |
| `metrics.check.ts` fixtures built date labels from UTC against local-day logic | review | review, commit `8b3dbfd` — present since the baseline, genuinely found by the review |
| `HINT.costFixed` / `HINT.costVariable` described the pre-ADR-012 model | 1C-i | 1C-ii-b — deleted, with a note in their place saying where per-basis wording now lives |
| The break-even KPI definition said "per-sale costs", a category ADR-012 removed | 1A-ii | 1C-ii-b — it now names the three scaling bases. A fourth instance of the phrase, in a doc comment on `ItemBreakEven`, went with it |
| A per-event cost on an event of one read as though the figure were hiding money from itself | 1C-ii-a | 1C-ii-b, **ADR-023** — in the panel's words, not in `breakEven`. Three checks pin the arithmetic so a later session cannot fix the pedantry in the engine |
| The basis-switch guard was one line in an `onClick` that nothing checked | review (mis-reported as open) | 1C-ii-b — extracted as `targetAfterBasisChange` in `lib/sessions.ts`, twelve checks, **before** the component was rewritten. The defect itself closed in 1A-ii by `4fd29c2`; see the correction note at the end of `BUG-FIXES.md` |
