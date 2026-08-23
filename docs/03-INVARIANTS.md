# Invariants

These are properties the code already has and depends on. They are not
aspirations, and they are not style preferences. Each one exists because
breaking it corrupts data that cannot be recovered — not with an error, but
quietly, so that the figures on screen stay plausible while ceasing to be true.

A change that would violate one of these is not a change to be made carefully.
It is a change to stop and raise, because the invariant is almost certainly
load-bearing for something the change's author has not looked at yet.

Each entry says what the rule is, why it exists, what breaks without it, and
where in the code it is actually held up.

---

## 1 — The stock ledger is append-only

**The rule.** Nothing deletes or edits a `StockMovement`. Reversing a movement
appends a compensating row that points back at the original through
`referenceId`. The one field that may change on an existing row is `reversed`,
which is a marker for display and does not alter what the row says happened.

**Why it exists.** Every movement records `resulting` — the level it left
behind. That is what makes it possible to answer "what was on the shelf at 3pm
last Saturday" by finding the last line at or before that moment, with no
accumulation and no drift from summing rounded deltas. A ledger with holes in it
cannot answer that question at all, and every stock-derived figure in the
analytics layer is built on the ability to answer it.

**What breaks.** `foodCost` reconstructs opening and closing stock value by
replaying the ledger to an instant; delete lines and both ends move, silently.
`shrinkageValue`, `stockPurchasesValue`, `inventoryTurnover`, `deadStock` and
`consumptionRate` all read the ledger directly. Worse than any single wrong
figure: the count on the shelf stops agreeing with the sum of the lines that
produced it, and there is then no way to tell which of the two is lying.

**Where it is enforced.**

- `src/app/types.ts` — `StockMovement`, in the doc comment on the interface.
- `src/db/schema.ts` — `stockMovements`, same note on the table.
- `src/db/persistence.ts` — the `stock_movements` block in `runSave`. Rows
  already on disk are skipped entirely; the only write against an existing row
  is `UPDATE ... SET reversed = ?`.
- `src/app/state/useStock.ts` — `undoMovement` appends a `correction` line
  carrying `referenceType: 'movement'` rather than removing anything;
  `reverseStockChanges` posts the opposite movement.
- `src/app/lib/history.tsx` — the reason undo stores actions rather than
  snapshots at all. A snapshot restore would overwrite the ledger.
- `src-tauri/src/sync.rs` — `stock_movements`, `inventory_snapshots` and
  `oversell_events` are marked append-only in `SYNC_TABLES`: they are written
  with `INSERT OR IGNORE`, and the download path does not clear them first.

**Deliberate exceptions.** `clearTransactionalData` and `clearAllData` in
`persistence.ts` do delete the table. Those are the explicit "wipe my history"
actions, taken from a confirmed panel, and the user is told the data is gone.

---

## 2 — Missing cost is not zero cost

**The rule.** `undefined` and `0` are different claims about the world and must
stay distinguishable at every layer — in the type, in the column, in the parser,
and in every aggregate. Nothing is ever defaulted to `0` to satisfy a type.

**Why it exists.** "This line has no cost on file" and "this line cost nothing
to make" are opposite statements. Costing arrived after the app was already in
use, so a large number of real historical lines genuinely have no cost. Reading
those as zero reports a 100% margin on them, which is not a small error — it is
the most flattering possible answer, produced automatically, on exactly the data
nobody can check.

**What breaks.** Gross margin, food cost percentage, contribution margin and
break-even all divide cost by revenue. Fill the missing costs with zero and each
of them improves; nothing warns, because zero is a perfectly valid cost.

**Where it is enforced.**

- `src/app/types.ts` — `CartItem.unitCost`, `MenuItem.unitCostOverride`,
  `StockMovement.unitCost`, all optional and all documented as such.
- `src/db/schema.ts` — `order_items.unit_cost` is a nullable `real` with no
  default. The neighbouring `oversold_quantity` defaults to 0 because zero
  oversells is a true statement; a missing cost is not.
- `src/db/persistence.ts` — `parseCartItems`:
  `unitCost: r.unit_cost == null ? undefined : Number(r.unit_cost)`.
- `src/app/lib/inventory.ts` — `unitCostFor` returns a `complete` flag beside
  the number, and lists what is `missing`. A partial recipe still produces a
  `cost`, but it must not be stored.
- `src/app/state/useOrders.ts` — `costCart` writes `unitCost` only when
  `resolved.complete`.
- `src/app/analytics/metrics.ts` — `orderMoney` carries `costedRevenue` and
  `costCoverage` beside `cogs`, so margin is taken over a like-for-like base
  rather than dividing partial cost by complete revenue.

---

## 3 — Historical figures never move

**The rule.** `CartItem.unitCost` is frozen at checkout and never recomputed.
The same holds for `Order.taxRate` and `Order.discountAmount`: they record what
was in force at the moment of sale, not what is in force now.

**Why it exists.** Margin on a sale is a fact about a past transaction. If it is
recalculated from today's recipe and today's supplier prices, then correcting a
recipe rewrites last month's profit, and a supplier price rise makes a market
you already traded look as though it lost money. Nobody can reconcile a figure
that changes when they were not looking.

**What breaks.** Every historical comparison. Session-over-session and
event-over-event margin become meaningless, because the earlier period is being
re-priced at the later period's costs each time the screen is opened.

**Where it is enforced.**

- `src/app/types.ts` — `CartItem.unitCost`, `Order.taxRate`, `Order.taxAmount`.
- `src/app/state/useOrders.ts` — `costCart` opens with
  `if (item.unitCost !== undefined) return item;`, so a line that already
  carries a cost is never restated, including on the edit path.
- `src/app/analytics/metrics.ts` — `foodCost`'s theoretical figure is the sum of
  the frozen line costs (`totals.cogs`), never a fresh recipe lookup.
- `src/app/analytics/metrics.ts` — `ledgerValueAt`'s neighbouring comment
  records the one place today's cost is deliberately used for a historical
  level, and why: so that this figure and the inventory value on the same screen
  do not disagree about what a kilo of mince is worth.

---

## 4 — Session membership is stored, not derived

**The rule.** An order belongs to the session stamped on it at checkout, in
`Order.sessionId`. Membership is never inferred from timestamps.

**Why it exists.** A session is one service, and a service is not a calendar
day. A market pauses at dusk and resumes in the morning, so the session's span
covers a whole night that does not belong to it. Any rule of the form "orders
between the session's start and end" sweeps in everything taken overnight — and
on a quiet stall, that is a genuinely different set of orders, not an empty one.

**What breaks.** Session and event analytics, entirely. Revenue per trading
hour, ticket counts, per-session cost attribution and the event comparisons all
read membership. Orders taken before sessions existed carry no session id at
all, and are correctly excluded rather than guessed into one.

**Where it is enforced.**

- `src/app/types.ts` — `Order.sessionId` and `Order.sessionTicket`.
- `src/db/schema.ts` — `orders.session_id`, with the same note.
- `src/app/state/useSessions.ts` — `claimTicket` stamps both at checkout,
  reading the counter from a ref so two orders rung up in one React tick cannot
  be handed the same number.
- `src/app/state/useOrders.ts` — `commitEdit` carries `sessionId` and
  `sessionTicket` through an edit explicitly. It has been lost here before; the
  visible symptom was a ticket falling back to its lifetime number, and the
  quiet one was a sale disappearing out of the session's takings.
- `src/app/lib/sessions.ts` — `ordersForSession`, `ordersForSessions`,
  `costsForSessions`, all matching on stored ids.
- `src/app/analytics/scope.ts` — `ordersOf` filters by session id set.
  `spanOf` exists only for the records that genuinely are timestamped — stock
  movements and snapshots — and its use is confined to those.

---

## 5 — Voiding replaces deletion for orders

**The rule.** A cancelled order keeps its row. `voidedAt` and `voidReason` are
set; the ticket leaves the board, its ingredients go back on the shelf, and
every money figure excludes it. Nothing removes the row.

**Why it exists.** That a sale was rung up and then cancelled is itself a fact
worth keeping, and it is the only record that the ingredients came back. Before
this, deleting a ticket changed yesterday's takings whenever somebody tidied the
board, and left the stock ledger holding a deduction whose order no longer
existed.

**What breaks.** Revenue reconciliation, the void rate — which is a real
operational signal, not bookkeeping — and the link between the ledger's `sold`
lines and the orders that caused them.

**Where it is enforced.**

- `src/app/types.ts` — `Order.voidedAt`, with the reasoning.
- `src/db/persistence.ts` — the orders block in `runSave` never issues a
  `DELETE`. Its comment says why: a row that disappears from state can only mean
  a bug, and deleting it would take the day's revenue with it.
- `src/app/state/useOrders.ts` — `voidOrder` returns the stock, renumbers the
  live orders around the gap, and records an undo entry that moves all three
  back together.
- `src/app/lib/orders.ts` — `renumberOrders` skips voids rather than closing
  over them, so the number on a printed receipt stays readable;
  `liveOrderCount` excludes them from the sequence.
- `src/app/analytics/metrics.ts` — every aggregate opens with
  `if (order.voidedAt) continue;`. `voidStats` is the one function that looks
  at them on purpose.

---

## 6 — Anything money-adjacent that can be undone must confirm first

**The rule.** An `UndoableAction` that moves money, stock value or a
measurement carries a `confirm` string. Undo and redo show it and wait, rather
than acting on a keystroke.

**Why it exists.** Undo is bound to Ctrl+Z, which is pressed reflexively. The
stack is shared across every kind of state, so the step at the top is not
necessarily the one the user is thinking about. Reversing a stock count or
un-voiding an order on a reflex is not a recoverable mistake; a stock count in
particular is a *measurement*, and the variance against the books is the entire
finding.

**What breaks.** Not the data model — the reversals are all correct. What breaks
is trust: a till operator who loses a count to a stray keystroke stops using
undo, and then stops using the count.

**Where it is enforced.**

- `src/app/lib/history.tsx` — `UndoableAction.confirm`, and the `ConfirmDialog`
  the provider renders. Cancelling puts the step back on the stack it came from,
  so declining once does not quietly lose the ability to undo it later.
- `src/app/state/useOrders.ts` — `voidOrder` confirms.
- `src/app/state/useStock.ts` — `stockTake`, `drainStock` and waste
  adjustments confirm.
- `src/app/state/useOrders.ts` — checkout and `commitEdit` are deliberately
  *not* on the stack at all, and say so once through
  `explainNotUndoable`. Taking money is the one thing in the app with a
  consequence outside it; the supported reversal is voiding the ticket, which
  keeps the record.
