# The domain

What the words mean, and where each one is defined in code.

Most of this already existed as doc comments on the types themselves. Those
comments are the primary source and stay where they are — they are read at the
point of use, which is where they do the most good. This file consolidates them
so that a reader who has never opened the tree can follow a conversation about
it, and so that concepts which live across several files have somewhere to be
described whole.

Every type in this document is declared in **`src/app/types.ts`** unless stated
otherwise. The SQLite shape of each is in **`src/db/schema.ts`**, and the
translation between the two is **`src/db/persistence.ts`**.

---

## Order

`Order` · `src/app/types.ts` · table `orders` + `order_items`

A completed sale. It is created at checkout and never deleted (ADR-002).

It carries three different numbers, and they are not interchangeable:

- **`id`** — immutable identity, never renumbered, used as the `order_items`
  foreign key and as `referenceId` on the stock movements the order caused.
- **`seq` / `orderNumber`** — the lifetime sequence, 1..N across all trading.
  Recomputed by `renumberOrders` when an order is voided, so the live orders run
  without gaps. Voided orders keep whatever number they had.
- **`sessionTicket`** — the kitchen's number within the current service, 1..N,
  assigned once at checkout and never recomputed.

An order's money fields record what was in force at the time: `taxRate`,
`discountAmount` and each line's `unitCost` are frozen (invariant 3). `total` is
`subtotal − discountAmount + taxAmount`. Tax is not revenue; `orderMoney` in
`src/app/analytics/metrics.ts` keeps `netRevenue` and `collected` apart for
exactly that reason.

`grilledAt`, `readyAt` and `completedAt` are stamped the *first* time a ticket
reaches each stage. First, not last — a ticket bounced back to Preparing and
forward again should not read as having been cooked twice as fast. They are
nullable because they are stamped going forward only and nothing can be
back-filled, and they are what makes kitchen throughput measurable at all.

`OrderStatus` is where the ticket sits: `preparing`, `grill`, `ready`,
`completed`, or `parked`. `BoardStatus` is the subset a ticket can be dragged
between.

**Voiding** sets `voidedAt` and `voidReason`. The row stays, the ticket leaves
the board, the ingredients go back, and every money figure excludes it.

---

## Cart item

`CartItem` · `src/app/types.ts` · table `order_items`

One line: a menu item, a quantity, the price it was sold at. The same shape
serves a cart being built and a line on a finished order — which is what lets an
order be pulled back into the ordering panel for editing without a second type.

`unitCost` is the ingredient cost of **one** of this line, resolved from the
recipe and the stock costs in force at the moment the order was taken. Written
once, never recomputed (invariant 3). `undefined` on carts, and on orders taken
before costing existed — which is not the same as zero and must not be read as
it (invariant 2).

`oversoldQuantity` is how many of this line the kitchen could not actually make.

---

## Parked session

`ParkedSession` · `src/app/types.ts` · tables `parked_sessions` +
`parked_session_cart_items`

An order in progress. The stall runs several at once — labelled A, B, C — so a
customer who is still deciding does not block the queue. A parked session owns
its cart, its notes and its discount together, which is why one snapshot of the
parked list covers every change that can be made in the ordering panel.

`editingOrderId` is set when this session is an in-progress **edit** of an
already rung-up order. The order keeps its own status and board position
throughout; this field is the only marker that it is being edited, so the two
can never disagree. Deleting an edit session cancels the edit — it never deletes
the order behind it.

Note the collision of vocabulary: a *parked* session is an unfinished order, and
a *trading* session is a service. They are unrelated, and both are called
"session" in the code. Trading sessions are always `TradingSession`.

---

## Trading session

`TradingSession` · `src/app/types.ts` · table `trading_sessions` ·
logic in `src/app/lib/sessions.ts`

One service. Starting a session renumbers the kitchen's tickets from 1 and — far
more usefully — gives every order, cost and stock movement taken during it a
common key, which is what makes per-event analytics possible.

Status is `active`, `paused` or `ended`. Only one session can be active at a
time; starting a second pauses the first rather than refusing, because the till
must never be blocked by a session somebody forgot to close.

Sessions are pausable and resumable because a market day is not a calendar day:
it stops at dusk and picks up in the morning. `pausedMs` banks the total time
spent paused, and `sessionTradingMs` deducts it, so a session that ran four
hours on Saturday and four on Sunday traded for eight and not for thirty-two.

`ticketCounter` is the highest ticket issued so far. Resuming continues from
there rather than restarting, so no two tickets in one session share a number.

Membership is stored on the order, never derived from the session's span
(invariant 4).

---

## Trading event

`TradingEvent` · `src/app/types.ts` · table `trading_events`

A container for sessions: a market, a festival, a private booking. It holds no
orders of its own. Most events are a single session; a three-day market run as
three services is one event and three sessions.

The grouping is stored rather than guessed, because dates cannot tell three days
of one market apart from three unrelated markets in the same week.

`eventGroups` in `src/app/lib/sessions.ts` presents every event, *plus each
ungrouped session as an event of one*, so reporting "by event" covers sessions
nobody bothered to group. Detaching the last session from an event deletes the
event, because an event with no sessions is a leftover label rather than a fact
about the business.

---

## Cost entry

`CostEntry` · `src/app/types.ts` · table `cost_entries`

A cost the POS cannot observe: stall fee, staff, fuel, packaging. Ingredient
cost comes from the stock ledger and needs no typing, so this is deliberately a
short form.

`basis` says what the amount is charged **per**, and is the field the rest of
the money model turns on (ADR-012):

| Basis | Paid | Example |
|---|---|---|
| `per-session` | once per service | pitch fee, a staff shift |
| `per-event` | once for the whole event | a three-day market pitch |
| `per-order` | with every ticket | bags, receipt roll, cutlery |
| `per-unit` | with every item sold | a portion cup |
| `per-revenue` | as a true percentage | delivery commission, card fees |

`amount` is **rupees for the first four bases and percentage points for
`per-revenue`**. It is the only field in the app whose meaning depends on a
sibling field, and it is one field rather than two because a rupee column and a
rate column would each be null on most rows — which stops "no amount recorded"
from being tellable apart from "an amount of zero", and that distinction is
invariant 2.

Amounts are commensurable *within* a basis and nowhere else. Two per-ticket
costs of Rs 4 and Rs 2 are Rs 6 a ticket; Rs 6 a ticket and 18% of sales have no
sum. `costSummary` in `src/app/analytics/metrics.ts` therefore returns a total
per basis, and its `total` is the rupees actually committed — `per-session` plus
`per-event` — because a rate becomes money only once the period's tickets, units
or revenue are known.

The predecessor was `kind: 'fixed' | 'variable'`, which never said what a
variable cost varied with; ADR-012 records what that cost. The column is
retained on historical rows and the field survives on the type as deprecated, so
what a row used to say stays recoverable. Nothing writes it.

A cost carries a **session id or an event id, never both**. Some costs are not a
session's — the pitch fee for a three-day market is paid once, for the market,
and splitting it across three days by hand is both tedious and wrong. Attaching
it to the event lets event-level profit be worked out without pretending it
happened on a particular afternoon. A cost entered outside any session carries
neither, and counts only towards date-scoped figures.

`basis: 'per-event'` **requires** `eventId`. It is asserted at the write sites
by `assertCostEntry` in `src/app/lib/sessions.ts` rather than assumed: a
per-event cost with no event is an amount attached to nothing, invisible to
every event figure and correct-looking on the form that created it. The load
path demotes such a row to `per-session` instead of throwing, because a shop
with one malformed row still has to be able to open its till.

---

## Stock item

`StockItem` · `src/app/types.ts` · table `stock_items`

Something on the shelf. Quantity is always held in the item's **base unit** —
`pcs`, `g` or `ml` — so the arithmetic never has to reason about mixed units.
Larger units (`kg`, `L`) exist only for typing in and for display; `toBase` and
`formatQuantity` in `src/app/lib/inventory.ts` do the conversion at the edges.

`costPerUnit` is the cost of one base unit, maintained two ways on purpose. It
can be typed in by hand from the item editor, and it is recalculated as a moving
average whenever stock is received with a delivery cost attached: what is
already on the shelf at the old cost, plus what just arrived at the new one, over
the combined quantity. Receipts win, because they are measured rather than
remembered. `costUpdatedAt` records when a receipt last set it.

---

## Packet

`StockItem.packetSize` / `packetLabel` / `packetCost`

The unit stock actually arrives in — a crate of buns, a tray of eggs. One packet
is `packetSize` base units, and `packetLabel` is what this shop calls it.

`packetCost` is what one packet costs, which means receiving N packets implies
the delivery cost without anyone typing it — the ordinary case. The per-lot cost
field on the receipt form stays as a manual override for the delivery that came
in at a different price.

---

## Stock movement

`StockMovement` · `src/app/types.ts` · table `stock_movements`

One line in an item's ledger. Every change to `quantity` writes one. The ledger
is append-only (invariant 1).

- **`delta`** — signed change in base units.
- **`resulting`** — the level after the change. This is what makes a past level
  readable directly off the last line at or before a moment, with nothing to
  accumulate and no drift from summing rounded deltas.
- **`reason`** — `added`, `packet`, `sold`, `returned`, `waste`, `correction`,
  `edit`, `drained` or `stocktake`. The distinction matters: `consumptionRate`
  counts only `sold` and `waste`, or restocking would read as consumption, and
  a **purchase is a receipt** — `added` and `packet`, nothing else (ADR-014).
  `stockPurchasesValue` is the only place that decides this, and `foodCost`
  calls it rather than keeping a second list; when it kept its own, it counted
  `correction` too and the two figures disagreed about the same delivery.
- **`referenceType` / `referenceId`** — what caused this. `referenceId` is
  always an immutable id: `order.id`, or the id of the movement being reversed.
  Never a display string like an order number.
- **`unitCost` / `totalCost`** — present on receipts, absent on consumption.
- **`reversed`** — set on a reversal and on the line it reverses, so the pair
  can be hidden from the activity list without either row leaving the ledger.
  This is the one field that may change on a row already on disk.

---

## Assignment (the recipe)

`MenuItemStockAssignment` · `src/app/types.ts` · table `stock_assignments`

"One of this menu item uses this much of this stock item." Together, the
assignments for a menu item are its recipe.

`requirementsFor` in `src/app/lib/inventory.ts` flattens a menu item into stock
requirements, expanding deals through their components — so a deal containing
two burgers requires twice everything a burger does. A deal can also carry
assignments of its own, for the things that belong to the deal rather than to
its contents: a bag, a napkin, a tray.

---

## Deal

`MenuItem.dealItems` / `DealItem` · `src/app/types.ts`

A menu item that is composed of other menu items. `DealItem.menuItemId` is the
link and `name` is a display snapshot plus the legacy fallback (ADR-006).

A deal's price is **not** the sum of its components, and is never recalculated
from them. The components total is offered as a button in the editor, because
that is the common starting point — but the sum of the parts is the one price a
deal is never actually sold at. `componentsTotal` in `src/app/lib/menu.ts`
computes the offer.

`MenuItem.unitCostOverride` was a hand-typed ingredient cost used instead of the
one the recipe implies. **It is gone from the menu** (ADR-015). Nothing writes
it, the field beside the price has been replaced by a read-only *"Rs 84 to make
· 61% margin"* that comes from the recipe and taps through to Assign Stock, and
the field itself survives on the type marked deprecated so that in-memory and
legacy rows still parse — features are gated, parsers are not.

It never worked. `menu_items` has no `unit_cost_override` column and
`persistence.ts` neither read nor wrote it, so every override typed in was lost
on the next reload and the item quietly reverted to its recipe cost. There is
nothing to migrate for the same reason: no override has ever been on disk. Sales
rung up while one was live in memory carry a frozen `CartItem.unitCost`
reflecting it, and those stay exactly as they are (invariant 3).

**Where an override belongs now.** At the ingredient, not at the dish:
`StockItem.costPerUnit` is editable in the Stock Editor, and correcting it there
fixes every menu item that uses it at once rather than one dish at a time. The
case the field existed for — something bought in ready-made, a bottled drink, a
packet of crisps — is a `pcs` stock item with a cost per unit, assigned to the
menu item like any other ingredient. A deal containing one inherits it through
its components.

---

## Oversell

`OversellEvent` · `src/app/types.ts` · table `oversell_events`

A sale the stock on hand could not support, recorded at the moment it happened.

This is a direct measurement of censored demand. Normally it has to be inferred
from suspicious runs of zero sales, and a forecast trained on the raw numbers
systematically under-predicts exactly the items that keep running out. Here it
is measured.

The till never blocks a sale — the shop may well have stock the app does not
know about — but tapping a sold-out item asks first, names the ingredient that
ran out, and logs the event if the sale goes ahead. `bottleneckStockItemId` is
that ingredient, when one was identifiable. Oversells logged while a cart was
being built are attached to the resulting order at checkout, and the count is
stamped onto the line as `CartItem.oversoldQuantity`.

---

## Inventory snapshot

`InventorySnapshot` · `src/app/types.ts` · table `inventory_snapshots`

End-of-day stock level and value, one row per item per day, written on the first
launch of each day.

Historical inventory value is otherwise obtainable only by replaying the whole
ledger, which stops being reliable the moment old lines are trimmed — and the
ledger *is* capped at 20,000 lines. The snapshot is what makes that cap safe,
and what makes "what was my stock worth in March" answerable at all.

A snapshot describes the shelf at breakfast, so it is the *fallback*, not the
primary source: asking it what a session that ran from noon to eight closed on
gets an answer a whole trading day stale. `foodCost` replays the ledger first
and falls back to snapshots only where the ledger cannot reach.

---

## Scope

`Scope` / `ResolvedScope` · `src/app/analytics/scope.ts`

What the analytics screens are currently looking at. One choice with three
shapes, and only one is ever in force: a date `range`, an `event`, or a
`session`.

There used to be one control — a date range in the corner — and adding events to
it would have meant two filters that disagree: pick "Winter Market" and "last 7
days" and the screen either shows nothing or quietly ignores one of them.

Dates still matter underneath, because stock movements and snapshots are
timestamped rather than session-stamped. Every scope therefore resolves to a
window as well; for a session scope that window is simply the session's own span.
`sessionScoped` says which kind of figure the screen is showing, and the
`tradingHours` denominator differs accordingly (ADR-008).

---

## Trading hours

`sessionTradingHours` · `src/app/lib/sessions.ts` ·
`activeTradingHours` · `src/app/analytics/metrics.ts`

Two different measurements, deliberately.

For a **session scope**, trading hours are elapsed session time with pauses
deducted. Quiet hours count — an empty hour at a market is still an hour of
standing there paying for the pitch.

For a **date scope**, trading hours are the number of distinct clock hours in
which anything sold at all, because there is nothing better to go on.

Both are live figures and both take `now` explicitly (ADR-009).
