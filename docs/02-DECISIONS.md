# Decisions

Numbered records of choices that shaped the data model and are expensive to
revisit. An entry is never edited once written. If a decision is later changed,
a new entry is added that supersedes the old one, and the old one stays exactly
as it was — the point of the record is that a future reader can see what was
believed at the time, not a tidied version of it.

Entries ADR-001 through ADR-008 were recovered from the code and from
`CHANGES.md` during Phase 0, rather than written when the decisions were taken.
Their dates are inferred from where the reasoning appears in the tree and are
approximate. Everything from ADR-009 onward was written at the time.

---

## ADR-001 — The stock ledger is append-only

**Status:** accepted · 2026-08

**Context:** Stock was originally a single `quantity` per item, edited in place.
That number could be right or wrong, but it could never be explained: nothing
recorded why it had moved, so there was no way to tell over-portioning from
waste from a mis-keyed delivery, and no way to say what had been on the shelf at
any past moment. Adding a `StockMovement` row per change fixed the explanation.
The open question was what undo should do with those rows.

**Decision:** Nothing deletes or edits a movement. Reversing one appends a
compensating movement pointing back at the original through `referenceId`, and
marks both `reversed` so the pair can be hidden from the activity list without
either row leaving the ledger. Every movement also records `resulting`, the
level it left behind, so a past level is read off the last line at or before the
mark rather than accumulated.

**Rejected:** Deleting the movement on undo, which is what a snapshot-based undo
would naturally do. It rewrites history silently, and — worse — leaves the count
on the shelf disagreeing with the sum of the lines that produced it, with no way
to tell which of the two is wrong. Also rejected: keeping only a rolling window
of recent movements with no other record, which makes historical stock
unreconstructable the moment the window slides.

**Consequences:** Makes historical stock value, food cost variance, shrinkage
and consumption rate all answerable from one table, exactly. Makes the ledger
grow without bound — mitigated by a 20,000-line cap in `applyStockChanges`,
which is only safe because a daily `InventorySnapshot` sits behind it. Makes
undo asymmetric, which forces the design in ADR-004. Makes every replication
path (sync, backup, restore) responsible for not deleting rows, which turned out
to be a real hole; see ADR-010.

---

## ADR-002 — Voiding replaces deletion for orders

**Status:** accepted · 2026-08

**Context:** Cancelling a mistaken ticket deleted its row. Three things went
wrong with that. Yesterday's takings changed whenever somebody tidied the board.
The stock ledger kept a `sold` deduction whose order no longer existed. And the
void rate — how often orders are cancelled, which is a genuine operational
signal — could not be measured at all, because the evidence had been destroyed.

**Decision:** The row stays. `voidedAt` and `voidReason` are set, the ticket
leaves the board, the ingredients go back on the shelf as a `returned` movement,
and every money aggregate skips it. `renumberOrders` closes the gap in the live
sequence without touching the voided row's own number, so a printed receipt
quoting it stays readable.

**Rejected:** A soft-delete flag with no reason field, which loses the *why* and
makes the void rate uninterpretable. Also rejected: leaving voided orders on the
board greyed out, which was tried and made the kitchen's board unusable during
service — the board has to show only what is being cooked.

**Consequences:** Revenue is reconcilable. Order numbers develop gaps in the
stored rows, which is correct but surprising if you read the table by hand. Undo
of a void has to move three things at once — the row, the numbering, and the
stock — or none of them mean anything, which is why it is one action rather than
three.

---

## ADR-003 — Session membership is stored on the order

**Status:** accepted · 2026-08

**Context:** A trading session is one service. The business works events: a
market on Saturday, nothing for a fortnight. A session has to be pausable and
resumable, because a two-day market pauses overnight and picks up in the
morning. That means a session's start-to-end span covers hours that do not
belong to it.

**Decision:** `Order.sessionId` is stamped at checkout and stored. Membership is
read from that field and never inferred. `Order.sessionTicket` is stamped
alongside it — a second, parallel number, so the kitchen counts from 1 each
service while `orderNumber` remains the true lifetime sequence. Ending a session
simply stops preferring the session number for display; nothing is rewritten.

**Rejected:** Deriving membership from `timestamp` against the session's span.
It gets the second morning of any two-day market wrong, and on a quiet stall the
orders it wrongly sweeps in are a real set rather than an empty one. Also
rejected: renumbering orders when a session starts, which destroys the lifetime
sequence that receipts and ledger notes quote.

**Consequences:** Orders taken before sessions existed carry no session id, and
are excluded from session-scoped figures rather than guessed into one — correct,
and it means early history simply does not appear on the session screens. Every
path that constructs an `Order` must carry the two fields through; `commitEdit`
has lost them before, and the failure was quiet.

---

## ADR-004 — Undo stores actions, not snapshots

**Status:** accepted · 2026-08

**Context:** Undo was a stack of snapshots of the orders array. It could take
back a ticket move and nothing else: adding a stock item, renaming a category,
changing the tax rate and emptying a cart were all one-way doors. That is a bad
property for software operated at speed by somebody who is also cooking. The
obvious fix — snapshot more of the state — collides directly with ADR-001,
because restoring a snapshot of the ledger would delete rows.

**Decision:** The stack stores *actions*: each entry carries the two functions
that put the world back and forward again, captured at the moment it happened
with the values it needs already closed over.

**Rejected:** Snapshotting the whole application state. It cannot express an
asymmetric reversal, so undoing a delivery would delete the line that recorded
it. Also rejected: a per-domain undo stack, which means Ctrl+Z does something
different depending on where the focus happens to be.

**Consequences:** Different kinds of state share one stack and undo in the order
they were done. An undo can be asymmetric — taking back a delivery appends a
correcting line, exactly as a person fixing a stocktake by hand would. An action
can refuse, or ask first, which is what ADR-005's confirmations are built on.
The cost is that every mutation site is responsible for recording its own
reversal correctly; there is no central mechanism that can do it for them, and
the extraction in Phase 0 deliberately kept it that way.

---

## ADR-005 — Missing cost is not zero cost

**Status:** accepted · 2026-08

**Context:** Ingredient costing arrived after the app was already ringing up
real sales, so a large body of historical lines genuinely have no cost on file.
The type system wants a `number`. The path of least resistance is `?? 0`.

**Decision:** `undefined` and `0` stay distinguishable at every layer — the
type, the column, the parser, and every aggregate. `unitCostFor` returns a
`complete` flag beside the number and names what is `missing`, and callers store
the figure only when it is complete.

**Rejected:** Defaulting to zero. It is the most flattering possible answer —
a 100% margin — produced automatically, on exactly the data nobody can check.
Also rejected: refusing to show any margin until every item is costed, which
would have meant the analytics screens showed nothing for months; instead
`costedRevenue` and `costCoverage` let margin be taken over a like-for-like base
and the coverage stated honestly beside it.

**Consequences:** Optional numbers propagate through the model, and every
consumer has to decide what it means. Margin figures are correct on partial
data. `dataQuality` can report what is uncosted, which turns the gap into a
to-do list rather than a silent distortion.

---

## ADR-006 — Deal components are referenced by id, not name

**Status:** accepted · 2026-08

**Context:** A deal listed what it contained by name: `{ name: 'Beef',
quantity: 2 }`. Renaming the menu item "Beef" broke every deal containing it —
retroactively, and silently, including for the stock estimates that decide
whether the till warns you an item is sold out.

**Decision:** `DealItem.menuItemId` is the link. `name` is kept as a display
snapshot and as the legacy fallback. `resolveDealComponent` prefers the id and
falls back to the name. A one-time repair in `linkDealItems` fills in the id
wherever the name still resolves on load, and leaves anything that no longer
matches alone rather than guessing.

**Rejected:** A migration that rewrites all rows at once and drops the name.
Rows whose name no longer resolves would have been silently emptied, which is
the exact failure being fixed. Also rejected: forbidding renames, which is a
reasonable database answer and an unreasonable answer for a stall that renames
"Burger" to "Classic Burger" on a whim.

**Consequences:** `menuItemId` is optional forever, and resolution is two-step.
In exchange, renaming a menu item is free, which is what people actually do.

---

## ADR-007 — The deals category is structural and cannot be deleted

**Status:** accepted · 2026-08

**Context:** The editor for a deal's contents only appeared for items sitting in
a category literally named "Deals". Renaming that category made the editor
vanish; deleting it left no route back to the feature at all, because creating a
category with the right name is not an obvious thing to try.

**Decision:** `Category.system` marks the one category the program depends on.
It can be renamed to whatever the shop calls them; it cannot be removed.
`ensureSystemCategories` runs on load and adopts an existing category rather
than adding a second one — first whichever is already flagged, then whichever
holds items that are actually deals, then one named after them.

**Rejected:** Identifying deals purely by whether an item has contents, which
leaves no way to create the first one. Also rejected: a hidden, uneditable
category, which shows up in the order-mode tabs as something the user cannot
name.

**Consequences:** An established menu is never given a duplicate. `isDealItem`
has to consider both the category and whether the item already has contents, so
moving a deal elsewhere does not make its contents uneditable while still
charging for them.

---

## ADR-008 — Rates are per trading hour, not per calendar day

**Status:** accepted · 2026-08

**Context:** This business does not trade continuously. It works event days: a
pop-up on Saturday, then nothing for a fortnight. A per-day consumption rate
divides real consumption by the dead days in between, so the busiest item in the
van looks like it lasts a month.

**Decision:** The denominator is trading time. `consumptionRate` divides by the
number of distinct clock hours in which something was actually sold or wasted.
`sessionTradingHours` measures elapsed session time with pauses deducted.
`activeTradingHours` is the date-scope fallback: distinct hours in which
anything sold at all.

**Rejected:** Elapsed hours, which has the same flaw as per-day at finer grain.
Also rejected: a fixed assumed service length, which is wrong for a three-hour
farmers' market and a ten-hour festival in different directions.

**Consequences:** "Hours left" means hours of trading, which is what has to be
planned for. Session scopes and date scopes use different denominators on
purpose — a session counts its quiet hours, because the pitch is paid for either
way, while a date scope has nothing better to go on than the hours in which
something sold. The two are labelled differently on screen for that reason.

---

## ADR-009 — One shared clock for live figures

**Status:** accepted · 2026-08

**Context:** Analytics captured `Date.now()` at render time — `resolveScope`
defaulted `now` to it, `foodCost` took it as a default parameter — but no
`useMemo` dependency array contained it. Nothing recomputed unless the orders or
the scope changed. A "Today" range froze at whatever time the screen was opened,
and revenue per trading hour did not move during a live service, which is
exactly when somebody is watching it.

**Decision:** A single module-level clock store in `src/app/ui/useNow.ts` with
subscribers, exposed as `useNow(intervalMs?)`. `now` is threaded explicitly into
`resolveScope`, `foodCost`, `sessionTradingHours` and `resolveRange`, and added
to the dependency arrays of the memos that genuinely depend on the current time.
The interval is 5s while a session is active and 30s otherwise. The store pauses
while the document is hidden and resyncs on the way back.

**Rejected:** A `setInterval` per hook call, which multiplies timers by the
number of consumers and drifts them out of step, so two figures on one screen
can disagree about what time it is. Also rejected: forcing a re-render of the
whole view on a timer without threading `now`, which recomputes everything on
every tick including the expensive item and category tables — those do not
depend on the current time and are deliberately left out of the tick.

**Consequences:** Live figures move. The cost is one shared timer and a small
amount of discipline about which memos take `now`: adding it to a dependency
array is a decision about whether that computation is time-dependent, not a
formality. A laptop lid closed for six hours wakes to one resync rather than 720
missed ticks.

---

## ADR-010 — The sync write strategy is per table, not global

**Status:** accepted · 2026-08

**Context:** `SYNC_TABLES` did not include `stock_movements`,
`inventory_snapshots` or `oversell_events`. A synced device therefore received
stock *levels* but not the ledger that produced them, so `foodCost`,
`stockPurchasesValue`, `shrinkageValue`, `inventoryTurnover`, `deadStock` and
`consumptionRate` all returned wrong or empty results on any device that was not
the one doing the stocking. Adding the three tables to the list was necessary
but not sufficient: both the upload and download paths were hard-coded to
`INSERT OR REPLACE`, and the download path additionally cleared each table
before inserting.

**Decision:** Each entry in `SYNC_TABLES` declares its own write strategy.
Tables that model current state keep `DELETE` then `INSERT OR REPLACE` — the
cloud copy is authoritative for them, which is what it was already doing.
Append-only tables are neither cleared nor replaced: their rows are immutable
once written, so a download merges with `INSERT OR IGNORE` and a stale copy from
a lagging device cannot overwrite or remove a good row.

**Rejected:** Keeping the global strategy and only changing the verb. With the
`DELETE` still in place, `INSERT OR IGNORE` would have made no difference on
download, and adding the ledger tables to the list would have *introduced* a
data-loss path where none exists today — a direct breach of ADR-001. Also
rejected: a wider sync redesign with row versioning and a mutation log. That is
real work with its own design questions and belongs in its own phase; this is a
patch to stop a live bug.

**Consequences:** Append-only tables converge by union, which is the correct
semantics for an immutable log and needs no conflict resolution. Ordering within
`SYNC_TABLES` still matters and is now documented in the array itself.
Existing devices need one explicit backfill after this change, or they will hold
movements from today forward and nothing before — hence the "Resend everything"
action in Settings, which is deliberately manual and confirmed. Genuine
last-writer-wins conflicts on the state tables are unchanged and still
unresolved; that is what a later phase's row versioning is for.

---

## ADR-011 — Domain state lives in hooks; persistence stays coordinated

**Status:** accepted · 2026-08

**Context:** `App.tsx` was about 3,500 lines and owned every mutation in the
program. Every later phase would have had to edit it, in the same file, in the
same functions, which makes changes hard to review and merges hard to trust.

**Decision:** State moves into one hook per domain under `src/app/state/` —
`useOrders`, `useStock`, `useMenu`, `useSessions`, `useSettings` — each
returning `{ state, actions }` and recording its own undo entries through the
existing `useHistory()` API. Two things stay central. The `dataSnapshotRef`
pattern remains: handlers read the latest state synchronously through a ref
rather than through a closure, because two orders can be rung up inside a single
React tick and a stale closure hands both the same ticket number. And saving
stays coordinated behind one `saveImmediate`, which every hook calls, because
several handlers write more than one table in a single action.

**Rejected:** Centralising undo recording in the composition layer. Undo is
asymmetric per ADR-004, and only the site that made a change knows how to
reverse it properly; a central recorder would have to be told, which is the same
thing with more indirection. Also rejected: giving each hook its own save. That
produces partial writes — voiding an order touches orders, the counter and the
ledger, and a device that crashed between two of those saves would hold a
ticket that had returned its stock twice, or not at all.

**Consequences:** `App.tsx` becomes composition and layout. Each domain is
editable without reading the others. The coordinator is a shared dependency that
every hook takes as an argument, which is explicit but slightly awkward to read;
that is the price of not having partial writes. A reducer or store library would
be the conventional next step and was not taken, because the ref pattern is
doing real work that a naive migration would break at exactly the moment it
matters — rapid input at a till.

---

## ADR-012 — Cost entries carry a basis, not a fixed/variable kind

**Status:** accepted · 2026-08

**Context:** A cost entry carried `kind: 'fixed' | 'variable'`. The split was
never given an ADR, so this supersedes nothing — it is the first record of a
model that was in the program from the beginning.

The problem is that "variable" does not say what the cost varies *with*. Bags
vary with tickets, portions vary with items sold, a delivery commission varies
with revenue, and a staff shift varies with nothing at all, and all four were
one word. `breakEven` had to guess, and the guess it made is the reason this is
being changed: it took the typed rupee total of the variable costs, divided it
by revenue-so-far, and treated the result as a rate. So a shop that logged Rs
200 of boxes in the morning had a break-even target that *moved as sales came
in* — one number at ten o'clock, another at four, on identical facts. Early in
a service the ratio is enormous and break-even is unreachable; late in a good
one it shrinks towards nothing and the target flatters itself. The figure was
not merely imprecise, it was a function of when you looked at it, which is the
one thing a target must never be.

`breakEvenByItem` shares the flaw through the same `variableRatio`.

**Decision:** `CostEntry.basis: CostBasis` replaces `kind`, with five values
that each name a denominator: `per-session`, `per-event`, `per-order`,
`per-unit`, `per-revenue`. `amount` is rupees for the first four and percentage
points for the last — the only field in the app whose meaning depends on a
sibling field, documented on the type and beside the input that types it.

`costSummary` returns a total per basis and adds nothing across bases. Its
`total` is the rupees genuinely committed for a period — `per-session` plus
`per-event` — because a rate becomes money only once the period's tickets, units
or revenue are known, and that resolution belongs in `breakEven` rather than in
a summary.

`per-event` requires an `eventId`. It is asserted at the write sites rather than
assumed: an entry with the basis and no event is an amount attached to nothing,
findable by no event figure, and correct-looking on the form that made it.

**Rejected:** *Inferring a basis from the cost's name during the migration.* A
row noted "fuel" or "boxes" reads like a rate, and a rule that turned those into
`per-order` or `per-revenue` would have placed most rows correctly. It was
rejected because the ones it placed wrongly would be indistinguishable from the
ones it placed rightly, and because the output is a change to a historical
figure: a shop that has already read, discussed and acted on last month's
break-even would find it different, with nothing on screen saying why or that
anything had been assumed. Inventing information is worse than admitting there
is none — every pre-existing row becomes `per-session`, the rows that said
`variable` are listed for the shop to re-file, and the shop is the only party
that actually knows what it bought.

Also rejected: *dropping the `kind` column* once nothing read it. Historical
rows carry it, and it is the only surviving record of how they were filed under
the old model; dropping it makes the pre-migration interpretation
unrecoverable, and keeping a column nothing writes costs nothing. It is still
written back on save, because `INSERT OR REPLACE` replaces the whole row and a
statement that omitted the column would let SQLite quietly restate every
historical `variable` as the default `fixed`.

Also rejected: *two amount columns*, one rupee and one rate. Every row would
then have a hole in it, and "no amount recorded" would stop being tellable apart
from "an amount of zero" for whichever column happened to be empty — which is
invariant 2, in the one place the app is least able to notice.

**Consequences:** Break-even stops depending on when it is read, once 1A-ii
rewrites it to resolve each basis against the period's own volumes. Until then
`breakEven` is unchanged and takes the deprecated `fixed`/`variable` fields
`costSummary` still carries: `fixed` is the committed rupees, and `variable` is
0 rather than a rate misread as an amount.

Break-even therefore moves for any shop that had logged variable costs: those
amounts now count as committed rather than as a share of revenue, so the target
rises. That is not a regression to be smoothed over — it is the old figure's
error becoming visible — but it is a visible change to a number people rely on,
and the migration notice is what explains it at the moment it happens.

Nothing may total amounts across bases. Code that adds Rs 4 a ticket to 18% of
sales produces a plausible number that is not money, and the shape of
`CostSummary` is deliberately awkward to misuse in that direction.

---

## ADR-013 — Event costs are not allocated across a session's figures

**Status:** accepted · 2026-08

**Context:** A cost carries a session id or an event id, never both (ADR-012).
`resolveScope` picks up both for a session scope: the costs of that session, plus
anything attached to the event containing it — which is correct, because
otherwise an event-level cost is invisible from every screen a person actually
looks at. The question this leaves is what break-even should then *do* with the
event's rupees when the scope is one session out of three.

The obvious answer is to apportion: give each session a share of the pitch fee
in proportion to what it took. It is the answer accountancy would give, and it
is wrong here for a reason specific to this figure. Saturday's break-even would
be computed from a denominator that includes Sunday's revenue — so Saturday's
target would *change on Monday*, downwards, because Sunday traded well. That is
the same defect ADR-012 was written to remove, arriving through a different
door: a target that depends on facts that did not exist when the day it
describes was traded.

Splitting evenly across sessions is no better. It is stable, but it is a fact
about how many days the market ran rather than about what any of them cost, and
the first thing it does is make a rained-off Sunday look like it owed a third of
a pitch fee it had nothing to do with.

**Decision:** From a session scope, `breakEven` covers the session's own costs
only. `per-event` rupees in scope are reported separately, on
`BreakEven.heldEventCosts`, and the panel states plainly that the event carries
Rs X on top of this, with a control that switches the scope to the event. From
an event or date scope they are simply part of the committed rupees, because
there the period genuinely does owe them.

The mechanism is one parameter, `CostScope`, and the only thing it changes is
where the `per-event` total goes. It is a parameter rather than a flag read off
`ResolvedScope` because `sessionScoped` is already true for both a session and
an event scope — it means "membership rather than timestamps", which is a
different question.

**Rejected:** *Apportioning by revenue share*, for the reason above — it makes a
past target move. *Splitting evenly across the event's sessions*, which is
stable but describes the calendar rather than the business. *Excluding
event-level costs from the session screen altogether*, which is the tidiest code
and the worst outcome: the shop is then never told that Rs 3,000 is outstanding
against a market it is in the middle of trading, which is exactly when knowing
would change something.

**Consequences:** A session's break-even is a property of that session and
nothing else, and does not move afterwards. The figure is deliberately
incomplete for an event that has costs of its own, so it is never shown without
saying what it excludes and offering the scope where the answer is whole.
Anything else that resolves costs to money for a period has to take the same
parameter, or the screens will disagree about the same market.

---

## ADR-014 — A purchase is a receipt

**Status:** accepted · 2026-08

**Context:** Two functions counted purchases and did not agree.
`stockPurchasesValue` counted movements with reason `added` and `packet`.
`foodCost` kept a purchase loop of its own and counted `added`, `packet` **and**
`correction`. Both figures are shown on the Overview tab — one as "Stock
purchases", one inside the actual food cost calculation — so the same delivery
was two different numbers on the same screen, with nothing to say which was
which. A shop that tried to reconcile them had no way to find out.

**Decision:** One definition, in one place. `stockPurchasesValue` decides what a
purchase is and `foodCost` calls it. A purchase is a **receipt**: `added` and
`packet`. A `correction` is not a purchase — it carries no cost data and means
"the shelf disagreed with the book", which is a measurement of stock that was
already there rather than money leaving the till.

**Rejected:** *Counting `correction` in both.* A correction has no `unitCost` or
`totalCost`, so it can only be valued at today's cost per unit — an outlay that
never happened, invented from a number that describes a different question. It
also fails in one direction: it inflates purchases, which inflates actual food
cost, so a shop looks worse at controlling cost the more carefully it counts its
stock. Also rejected: *keeping the two definitions and labelling them
differently on screen.* The two names would have had to explain a distinction
that has no basis in the domain, and the reconciliation the shop was attempting
is a legitimate thing to attempt.

**Consequences:** `foodCost.purchases` and `stockPurchasesValue` agree by
construction over the same window, and `metrics.check.ts` asserts it over a
ledger that contains a correction. Actual food cost falls for any shop that had
positive corrections in the period — which is the previous figure's error
becoming visible, in the same shape as ADR-012's.

This exposes something adjacent that is **not** fixed here. Reversals are
written two ways: `undoMovement` appends its compensating line and marks both
rows `reversed`, while `reverseStockChanges` posts a plain negative `correction`
and marks nothing. Both purchase figures skip `reversed` rows, so a delivery
undone through the second path leaves its original `added` line still counted as
a purchase while the correction that cancels it counts as nothing. That is a
`reversed`-flag problem rather than a which-reasons-count problem, and belongs
with Phase 1B's `'reversal'` reason and `effectiveMovements`.

---

## ADR-015 — The menu carries no cost override

**Status:** accepted · 2026-08 · supersedes nothing; removes a feature that
never worked

**Context:** `MenuItem.unitCostOverride` was a hand-typed ingredient cost that
won outright over the recipe in `unitCostFor`. It was edited from a field beside
the price on every menu row, and it had **no column**: `menu_items` does not
declare `unit_cost_override` and `persistence.ts` neither selected nor wrote it.
Every override ever typed worked until the app was restarted and then vanished,
with the item quietly reverting to its recipe cost. Phase 0 found it; Phase 1A-i
left it as 1A-ii's.

So the choice was between adding the column and removing the feature, and the
bug is the smaller half of the question. The field was in the wrong place. An
override at the *dish* asserts a cost for one menu item; if a bought-in
component's price is wrong, every dish containing it is wrong the same way, and
the override fixes them one at a time and silently goes stale on all of them.
And a cost box sitting beside a price box on a menu screen invites the thought
that the price should follow the cost, which is not how a burger at a market is
priced.

**Decision:** Removed from the menu. The field on the row becomes a read-only
resolved cost — *"Rs 84 to make · 61% margin"*, or *"Rs 84 to make · no cost for
Buns"* when the recipe is incomplete — that taps through to Assign Stock for
that item. Overriding an ingredient cost happens at the ingredient:
`StockItem.costPerUnit` is editable in the Stock Editor and already carries the
"typed in by hand, or set by a receipt" model, with receipts winning. The
ready-made case the field existed for — a bottled drink, a packet of crisps — is
a `pcs` stock item with a cost per unit, assigned like any other ingredient; a
deal picks it up through its components.

**The field stays on the type**, marked deprecated, and `unitCostFor` goes on
reading it. Gate features, never parsers: an in-memory object or a legacy row
that still carries one must go on meaning what it says, and the read costs
nothing. It cannot arrive from disk, because it never had a column to arrive
from.

**No migration is written, and that is not an oversight.** There are no
overrides to migrate: the field was never persisted, so nothing on disk carries
one. Sales rung up while an override was live in memory carry a frozen
`CartItem.unitCost` that reflects it, and those stay exactly as they are —
invariant 3, and the reason a migration that "corrected" them would be the worse
answer.

**Rejected:** *Adding the column.* It is three lines and it would have made the
feature work, which is the problem — it would have made a costing model
permanent that puts the correction at the wrong level and quietly overrides
every future recipe change on that item. Also rejected: *keeping the field
editable but showing the resolved cost beside it*, which is two numbers claiming
to be the same thing and no indication of which one any figure used.

**Consequences:** Ingredient cost has one home, and correcting it there fixes
every item that uses it. The menu screen stops implying cost-plus pricing.
Margins on the menu row are read-outs, so a shop can see immediately which items
are not costed and go and fix them, which the writable field actively hid — a
typed override made an uncosted item look costed.

An item with an incomplete recipe shows what is missing rather than a figure
that leaves it out (invariant 2). Anything that genuinely cannot be expressed as
a recipe now needs a stock item to stand for it; that is one more row on the
shelf and it is the row that makes the cost visible to `foodCost`,
`stockPurchasesValue` and the reorder list, none of which an override was ever
part of.

---

## ADR-016 — A reversal is its own reason, and the flag is set centrally

**Status:** accepted · 2026-08

**Context:** Reversals were written two ways. `undoMovement` appended its
compensating line, marked it `reversed`, and marked the row it reversed.
`reverseStockChanges` posted a plain negative `correction` and marked nothing.
Both wrote the shelf correctly, so nothing looked wrong.

Every economic reader skips `reversed` rows. So a delivery undone through the
second path left its original `added` still counted as a purchase, while the
line cancelling it counted as nothing — and after ADR-014 made a correction
definitively *not* a purchase, that line **could** not cancel it. The two halves
of one event were read by different rules. Undo a Rs 8,000 delivery through the
order/stock path and the money still showed as spent: the shelf right, the books
wrong, in the direction that overstates outlay.

Underneath the marking was a naming problem. `correction` meant two opposite
things. A **correction** is a person saying the shelf disagrees with the book —
a measurement, carrying no cost, of stock that was already there. A **reversal**
is the program undoing itself — bookkeeping, which is neither a purchase nor a
count. One word for both is what let the second path look reasonable.

**Decision:** `'reversal'` joins `StockMovementReason`, distinct from
`'correction'`, labelled **"Undone"** because that is what the user did and the
ledger is read by someone standing at a counter.

The flag is set where the paths converge, not at each call site.
`buildMovement` marks the reversal line whenever the reason is `'reversal'`;
`postMovements` — the one function every ledger write goes through — marks the
row that line's `referenceId` points at. `reverseStockChanges` produces a
`'reversal'` carrying `referenceType: 'movement'` and the id of the row it
cancels, and `undoMovement` is now a caller of it rather than a second
implementation that happened to agree.

`reversed` remains the one mutable field on a movement, which invariant 1
permits explicitly and for exactly this.

**Rejected:** *Inferring reversals by pairing.* Matching a negative row against
a prior positive one of the same size needs no new field and no new reason, and
it fails silently in the one case that matters. The ledger caps at 20,000 lines
and a trim drops the oldest, so a reversal routinely outlives the row it
reverses. With nothing left to match, an inferring rule sees a live line and
counts it. A flag on **both** halves survives the trim: the orphan is still
marked and still excluded, and `metrics.check.ts` asserts exactly that.

Also rejected: *marking at each call site, and adding a test that both sites
agree.* That is what was already in place informally, and it had already
failed. The number of write paths is not fixed; the convergence point is.

Also rejected: *keeping `correction` and adding a `bookkeeping: true` flag
beside it.* A flag is not a reason, and the reason is what the activity list
shows the user. "Correction · Undone" describes two different events and reads
as one.

**Consequences:** An undone delivery reports zero outlay through either path,
and a restored one reports it exactly once. `MOVEMENT_LABELS` gains an entry, so
stock history and the workbook export both read "Undone" without further change.

Redo needed rethinking as a consequence, and the answer is in the same shape:
**a redo appends a line duplicating the original's semantics** — same reason,
same `unitCost` and `totalCost`, with `referenceType: 'movement'` pointing at
the original — rather than reversing the reversal. Reversing the reversal would
have appended a second bookkeeping line carrying no cost, so an
undone-then-restored delivery would have sat on the shelf and been invisible to
`stockPurchasesValue` and therefore to food cost. The original and its reversal
stay netted out; the new line is a live receipt. Append-only, no pairing,
survives a trim.

One consequence in the hooks is worth naming because it is easy to undo by
accident. Undo and redo now track the lines **currently standing** for a change,
not the lines written the first time. A redo appends a fresh line, so the next
undo must cancel *that* one; reversing the original a second time would mark a
row already marked and leave the redone line counted as a live purchase for
ever. `applyStockChanges` returns what it wrote so the call sites can hold it.

The stock side of an order void deliberately writes no reversal. Returning a
voided order's ingredients and taking them back off are real physical movements
with reasons of their own — `returned` and `sold` — not the program undoing its
own bookkeeping. Marking them would hide a sale that genuinely happened.

---

## ADR-017 — Effective for economics, every row for levels

**Status:** accepted · 2026-08

**Context:** ADR-016 makes `reversed` reliable on both halves of a pair. The
question it raises immediately is who reads it. Several consumers re-derived the
rule inline — `stockPurchasesValue` had `|| m.reversed` in its loop, others had
nothing at all — and they did not agree. That is the same failure ADR-014 fixed
for the definition of a purchase, one level down.

The obvious fix is one filter used everywhere. That fix is wrong, in a way that
is invisible on the screen and would be "tidied" into place by a later session
acting in good faith.

**Decision:** One filter, `effectiveMovements`, and a rule about where it goes.

**Economics reads effective rows.** `stockPurchasesValue`, `foodCost`'s
purchases and its `basis`, `shrinkageValue`, `deadStock` and `consumptionRate`.
A delivery that was undone is not an outlay; waste that was undone was never
thrown away; a count that was undone is not a finding; a sale that was undone
consumed nothing.

**Levels read every row.** `ledgerLevelsAt` must not filter, and the comment on
it says so at length. It reads `resulting` — the physical level a row left
behind — and a reversal genuinely moved the shelf. Filter it out and the last
surviving line at or before the mark is the wrong one, so every historical level
shifts by the reversed amount, and with it both ends of `foodCost`. Nothing
errors. The figures stay plausible and stop being true.

`inventoryTurnover` is named here because a reader will come looking for the
call that is not in it. It reads no movements at all: `totals.cogs` is the sum
of frozen line costs on live orders, and average inventory comes from the daily
snapshots, which are measurements of a shelf a reversal genuinely moved. Both
inputs are already effective by construction.

This is recorded as **convention 6** in `03-INVARIANTS.md`.

**Rejected:** *Filtering in `ledgerLevelsAt` too, for consistency.* This is the
decision the ADR exists to prevent. It is the tidier code and it silently breaks
historical stock, food cost, and every figure built on either. `metrics.check.ts`
now asserts the level at a moment inside an undone/restored cycle *and* asserts
what the filtered ledger would have said instead, so the difference is a failing
check rather than a judgement call.

Also rejected: *pushing the filter down into the callers of `foodCost` so it
receives an already-filtered ledger.* Then the levels inside it would have been
filtered too, arriving at the same corruption from further away, where the
comment explaining it could not be read.

**Consequences:** Six economic figures now agree about what happened, by
construction rather than by six loops that have to be kept in step. Purchases
and shrinkage fall for any shop that has undone anything, which is the previous
figures' error becoming visible — the same shape as ADR-012's and ADR-014's.

The distinction has to be carried by a comment at both sites, because the code
cannot express it: two functions reading the same table, one filtering and one
not, is exactly what looks like a bug to someone who has not read this.

---

## ADR-018 — `per-event` is unavailable when the scope has no grouped event

**Status:** accepted · 2026-08

**Context:** Phase 1A-ii recorded this as its bug 2 and left it, correctly: it
is scope behaviour, and the scope was not what that phase was changing.

A `per-event` cost requires an `eventId` (ADR-012), asserted at the write sites
because an entry with the basis and no event is an amount attached to nothing.
`resolveScope` honours that on the read side: it hands `costsOf` an event id
only when the group it resolved is a real one — `group?.grouped ? group.id :
undefined`.

The trouble is at the other end. `eventGroups` presents every ungrouped session
as an event of one, so that reporting "by event" covers the sessions nobody
bothered to group. That stand-in has a name, a span and an id which is the
*session's* id. Scope one of those and the screen says you are looking at an
event; the cost form offers `per-event` because it offers all five bases; and
the entry cannot be filed, because there is no event for it to belong to. The
form refuses it after the fact — "Pick the event this was paid for" — with
nothing on screen to pick.

So the basis was reachable from a scope where it could never succeed, and the
only feedback was a rejection that read like a bug in the form.

**Decision:** The resolver decides, and the form asks. `ResolvedScope` gains
`eventId` — the same id `costsOf` was given, said out loud — and
`perEvent: { available, reason? }`. `per-event` is offered only where it has
somewhere to go:

- **A session scope** — available when the session belongs to a real event.
  A lone session is not one, whatever it is drawn as.
- **An event scope** — always available; this is the case the basis exists for.
- **A date scope** — available when the shop has any real event at all. A date
  window belongs to no event, but a cost logged from one is picked up by its
  timestamp, so what matters is only whether there is an event to file against.

`CostsPanel` disables the button and shows the reason in the place the hint
would have been, which says what to do: group the sessions first. The submit
guard stays as the guard of last resort.

The decision lives in the resolver rather than in the panel because the panel
and the figures must not be able to disagree about the same market. `costsOf`
and the form now read one answer.

**Rejected:** *Auto-creating an event of one when a lone session is scoped.*
This is the fix a later session will otherwise reach for, and it is why this ADR
exists. It would make ADR-013's held-cost distinction meaningless: the "event"
and the session would be the same period, so a cost filed against the event
would be reported by `heldEventCosts` as something the event carries *on top of*
the session — a cost the session already owes, stated twice, once as its own and
once as outstanding. The panel would then offer to switch to "the whole event"
and land on the same figures it was already showing.

It also invents a row nobody asked for. An event is a name a shop gives to a
market it ran over several days; creating one silently, as a side effect of
opening a cost form, puts a thing in the picker that the shop did not make and
cannot explain.

Also rejected: *letting the session id stand in for the event id* — the same
thing without the row. Every event figure would then match on an id that is a
session's, `costsForEvent` would return costs for something that is not an
event, and the two ids would be indistinguishable at every site that takes
either.

Also rejected: *offering the basis everywhere and improving the error message.*
The error is not the problem. A control that is offered, pressed, and then
refused has already cost the shop the decision; and the amount typed against it
is lost when the basis falls back.

**Consequences:** A cost can no longer be filed against nothing. The number of
things the form offers now depends on the scope, which is a new idea in that
panel — the basis is derived rather than held in state, so a scope change under
an open form cannot leave an illegal basis selected.

A shop that has never grouped anything sees four bases rather than five, and is
told why. That is the honest answer: until there is an event, there is no such
thing as a cost for the whole of one.

---

## ADR-019 — The revenue lock is per-tab, and may hide columns rather than screens

**Status:** accepted · 2026-08

**Context:** The revenue PIN was one condition, written where the analytics
screen was drawn: `revenueLocked && tab !== 'orders'`. It was correct while
there were four tabs and exactly one of them had no money on it, and it stated
the rule as an exception — everything is hidden, except the one that is not.

Phase 1C-i makes that untenable in two directions at once. There are now four
tabs and one of them, History, is three screens behind a source selector, so
"which tab" stops being enough to answer with. And Inventory is the first screen
in the app that is *partly* money: how much of a thing is on the shelf, and how
many days that covers, are answers a cashier needs during service; what it is
worth and what it cost are not. Locking the tab entirely makes the revenue PIN
the price of checking whether the mince is running low, which is the wrong
trade — the PIN exists so a till operator can work, not so they cannot.

Written as a condition, that becomes `revenueLocked && tab !== 'orders' && tab
!== 'inventory' && !(tab === 'history' && source !== 'money')`, in the file that
draws the screen, re-derived by every tab added after it.

**Decision:** The lock is a **capability the tab declares**, in
`src/app/analytics/tabs/model.ts`:

```
locked: 'all' | 'money-columns' | 'none'
```

`all` replaces the tab with the lock screen. `money-columns` draws the tab with
the money on it withheld. `none` is unaffected. History declares `none` and
delegates: each source declares its own, because History's answer depends on
which records are being read — Orders and Stock are open, Money is not.

Two pure functions resolve it, and they are the only place in the section that
turns a declaration into a rendering decision: `lockFor(tab, source)` says which
lock is in force, and `resolveLock(locked, revenueLocked)` says what that means
now. `AnalyticsView` calls them once and hands each tab the answer. Nothing
below reads `revenueLocked` to decide whether to draw itself.

Inventory has no table until 1C-iii, so the capability is defined, applied, and
its column list left for that phase. That is deliberate: the rule is the part
that has to be settled before two sessions build inside it.

**Rejected:** *Keeping the condition and extending it.* It works, and it is
correct until the next screen, at which point it is correct only if whoever adds
that screen finds it. The number of tabs is not fixed; the place the lock is
resolved is.

Also rejected: *each tab checking `revenueLocked` for itself.* Then the rule is
stated four times, and the fourth statement is the one that is wrong — and it is
wrong in the direction that shows money, which is the failure nobody notices
until it matters.

Also rejected: *a boolean `hidesMoney` beside the existing check.* Two booleans
express four states, three of which are meaningful and one of which — hidden and
money-hidden together — is not. A closed set of three names cannot be put into
the meaningless state.

Also rejected: *hiding the Inventory tab's money by omitting the figures from
its props.* The tab would then be unable to say that anything is being withheld,
and a column that silently disappears reads as a missing feature rather than as
a lock. The tab is told, and says so.

**Consequences:** Adding a tab is declaring a value rather than remembering a
rule, and `metrics.check.ts` asserts the whole table — including that `hidden`
and `moneyHidden` are alternatives, never both.

**V2's roles are the eventual consumer, and this is the shape they need.** "May
see stock levels, may not see what stock cost" is the same statement as
`money-columns`, made about a person instead of about a PIN. When roles arrive,
what changes is where the second argument comes from — a role rather than one
global flag — and not what a tab has to declare. That is the reason this is a
capability now, while there is exactly one tab that needs it, rather than an
`if` that would have to be found again and turned into one.

---

## ADR-020 — An event may exist before its sessions, and an event of one is legitimate when a person declares it

**Status:** accepted · 2026-08

**Context:** `per-event` exists for one stated cost, from `01-DOMAIN.md`: *"the
pitch fee for a three-day market is paid once, for the market, and splitting it
across three days by hand is both tedious and wrong."*

That cost could not be logged, at the only moment anyone would want to log it.

An event could be brought into existence exactly one way: by ticking two or more
already-traded sessions in the session panel and naming them. `handleGroupSessions`
refused fewer than two, it always called `createEvent`, and there was no way to
attach a session to an event that already existed. `handleStartSession` took a
name and nothing else.

So the sequence for a three-day market ran: trade Saturday; trade Sunday; group
them; and only then does `per-event` become available, correctly disabled by
ADR-018 until that moment. The pitch fee is paid on Saturday morning, before
Sunday and Monday exist as anything at all. And day three could not be added to
a group made on Sunday without ungrouping every day and grouping them again —
during the market, between customers.

The basis was unusable at the only time it was needed, and the shop's options
were to type the fee as `per-session` against Saturday, which charges one day
for three days' pitch and makes Saturday look unprofitable, or to wait until
Monday night and re-file it, which nobody does.

**Decision:** Three things, which are one thing.

An event **may exist with no sessions**. `addEvent` creates one directly, with
an optional planned start, planned end and venue. Those are a plan and never the
record: what an event actually spans still comes from its sessions, exactly as
before, and nothing derives membership or a reporting window from them. They
exist so an event can be created on Thursday for Saturday, and so the manager
can sort and label something that has not traded.

An event **of one session is legitimate**. The two-session minimum is gone. A
Saturday market that runs one service is one event and one session, and saying
so is a statement about the business.

A session **may start into an event**, and may be moved into or out of one
afterwards. `startSession` takes an optional event — an existing one, a new one,
or none — and **none is the default**, because most days are just days and a
picker that demands an answer every morning gets dismissed every morning.
`moveSessionToEvent` is the operation that was missing, and its absence is what
made a three-day market ungroupable while it was happening.

Status is **derived, never stored**: `eventStatus(event, sessions)` returns
`planned` with no sessions, `active` while any session is active or paused, and
`ended` when it has sessions and all of them have ended. A column would be a
second source of truth about a fact the sessions already hold, and it would
disagree the first time somebody resumed a session inside an ended event — the
class of problem invariant 4 exists to prevent.

**ADR-018 is complemented by this, not superseded, and both stand.**

This matters enough to state twice, because the two entries read at a glance
like a reversal. ADR-018 forbids **the program** inventing an event so that a
basis stops being disabled. It gives two reasons and both survive intact:

- Auto-creating an event of one when a lone session is scoped would make
  ADR-013's held-cost distinction meaningless. The "event" and the session would
  be the same period, so a cost filed against the event would be reported by
  `heldEventCosts` as something the event carries *on top of* the session — a
  cost the session already owes, stated twice, once as its own and once as
  outstanding. The panel would then offer to switch to "the whole event" and
  land on the figures it was already showing.
- It invents a row nobody asked for, and puts a thing in the picker that the
  shop did not make and cannot explain.

**A person declaring an event is a different act.** "This Saturday is the Winter
Market, and the pitch fee is the market's, not the day's" is a fact about the
business, entered by someone who knows whether it is one. The shop that types it
has decided that the day and the market are different things worth telling
apart; the program deciding that on the shop's behalf, because a control was
greyed out, has decided nothing and knows nothing.

The held-cost reading is still slightly odd for an event of one — from that
session's scope the pitch fee is held back and reported as the event's — and
that is correct rather than a defect. It is the same statement ADR-013 makes for
a three-day market: *this session's break-even covers this session's costs, and
the market carries Rs X on top*. For an event of one the two scopes happen to
cover the same trading, and the figures on each are still true of what they
describe. The difference from the rejected auto-creation is that here the shop
asked for the distinction and can see why it is being drawn.

So the test is who acted, and `ResolvedScope.eventId` remains the honest one on
the read side. `eventGroups` still presents a lone ungrouped session as an event
of one with `grouped: false` and no event id, and every event figure still
matches on a real id.

**Rejected:** *Keeping the two-session minimum and telling people to group
retroactively.* This is the status quo, and it is what makes `per-event`
unusable at the time it is needed. It also asks the shop to hold a fact in their
head across three days of trading and act on it afterwards, which is precisely
the thing a point of sale is supposed to stop being necessary.

Also rejected: *allowing an event of one only for a session that has ended.*
It sounds like a safeguard and it removes the case the change exists for — the
pitch fee is paid before the first session starts, not after the last one
finishes.

Also rejected: *storing the status.* A column, kept in step by whichever handler
remembered to. See above; and note that `eventStatus` is pure and driven by
`metrics.check.ts`, which a column would not be.

Also rejected: *treating the planned dates as authoritative when an event has no
sessions* — so that a planned event has a span, and analytics can scope to it.
It reads as a convenience and it is a second definition of when an event
happened, which would then disagree with the first the moment the market ran a
day late. A plan is not a measurement. `EventListing.span` is `null` until
something trades.

**Consequences:** A shop can create the Winter Market on Thursday, start
Saturday's session into it, and file the pitch fee against it on Saturday
morning. Day three joins the same event while the market is running.

A real event of one and a lone ungrouped session are **presented similarly and
are not the same thing**. The manager distinguishes them visibly — events are
listed as events with a status, ungrouped sessions are in a section of their
own headed "Not in an event" — and `ResolvedScope.eventId` remains the test in
code. `metrics.check.ts` asserts the difference in both directions.

`makeSessionAnEvent(sessionId, name?)` is a handler on `useSessions` rather than
something buried in the manager component, because 1C-ii-b's cost form links to
it: a shop told that `per-event` is unavailable here needs one control that
makes it available, and that control is a person pressing it.

---

## ADR-021 — Events are never auto-deleted; a session-less event is hidden from the picker rather than destroyed

**Status:** accepted · 2026-08

**Context:** `handleUngroupSession` deleted the event once its last session left
it. The reasoning was written down and was right at the time: an event with no
sessions is a leftover label rather than a fact about the business, and leaving
them behind fills the analytics scope picker with periods that have nothing to
report.

That reasoning depended on a premise ADR-020 removes. While events could only be
created by grouping, a session-less event could only ever be a leftover — there
was no other way for one to come to exist. Now there are two others, and both
are things the shop did on purpose:

- An event created ahead of its sessions. "Created Thursday for Saturday"
  produces a session-less event by definition, and auto-delete would not fire on
  it only because nothing had been detached from it yet.
- A mis-grouping being corrected. Take the wrong session out of a two-session
  event, then the other, and the event is gone — one keystroke before the shop
  puts the right ones back in.

In both cases the shop loses something it made, silently, as a side effect of a
different action.

**Decision:** Nothing deletes an event on its own. `deleteEvent` is explicit and
undoable, and detaching the last session leaves the event standing with status
`planned`.

The concern the auto-delete was serving is real, and is served by hiding rather
than by destroying. The split is two functions over the same data:

- **`eventGroups(events, sessions)`** is unchanged in meaning: groups of
  sessions. It excludes session-less events, so `scopeOptions`, `resolveScope`,
  `trendBuckets`, the workbook and the orders explorer see exactly what they saw
  before. It was excluding them incidentally, because auto-delete meant they
  could not occur; the exclusion is now explicit and checked.
- **`allEvents(events, sessions)`** is new and is the manager's list: every
  event, session-less ones included, each with its sessions, its derived status
  and its real span or `null`.

`eventGroups` deliberately does **not** return groups with zero sessions. Several
consumers index `group.sessions[0]` or hand the list to `spanOf`, and an empty
group is wrong at those sites rather than merely empty — `spanOf` returns `null`
for an empty set on purpose, and the callers that index the first session would
read `undefined.startedAt`.

`deleteEvent` **refuses while any cost is filed against the event itself**. A
`per-event` cost carries the event id and nothing else (ADR-012), so deleting
the event leaves an amount pointing at a row that is not there: invisible to
`costsForEvent`, invisible to every event figure, and correct-looking wherever
it was typed. `costEntryFromRow` would demote it to `per-session` on the next
load, which keeps the till openable at the price of quietly restating a market's
pitch fee as one day's. The refusal names the count and says what to do.

**Rejected:** *Auto-delete, kept as it was.* It destroys a plan, and it does so
as a side effect of an unrelated action. Undo recovers it, which is not the same
as it not having happened — the shop has to notice first.

Also rejected: *showing session-less events in the scope picker.* This is the
tidy version — one list, no split — and it fills the picker with periods that
have no orders, no costs, no trading hours and nothing to report. The picker's
job is to choose what to look at, and a planned market is not something to look
at yet.

Also rejected: *auto-deleting only events that were created by grouping*, by
recording how each one came into being. It preserves both behaviours and it adds
a field whose only purpose is to make deletion conditional on history. An event
created by grouping and then emptied is just as likely to be a correction in
progress.

Also rejected: *deleting the event and the costs filed against it together.*
Costs are money that was spent; removing a label is not a reason to forget an
outlay, and it would be the one place in the app where deleting a grouping
destroys a financial record.

Also rejected: *deleting the event and demoting its costs to `per-session`*,
which is what the load path does for a malformed row. There the demotion is a
last resort so the app can open. Here there is a person present who can be
asked, and demoting silently restates a market's pitch fee as one day's — the
exact misstatement `per-event` exists to prevent.

**Consequences:** A session-less event appears in the manager and not in the
`ScopePicker`. It can be started into, moved into, edited, and filed against;
what it cannot do is be reported on, because there is nothing to report.

`eventGroups` and `allEvents` answer different questions and a later phase must
not merge them. `metrics.check.ts` asserts both halves — that no group is ever
empty, and that `allEvents` keeps what `eventGroups` drops.

---

## ADR-022 — `per-unit` costs may target items or a category, and `resolveCosts` returns a blend beside a per-item rate

**Status:** accepted · 2026-08

**Context:** A `per-unit` cost is charged on every item sold. Most real ones are
not: a burger box is a burger cost, a portion cup is a chips cost, a lid is a
drink cost. Logging *"packaging, Rs 12 per item"* charged it against drinks too,
which understates drink margin and overstates burger margin in the same breath —
and does it in the two columns 1C-iv is about to build a table on.

The error is not small on a stall whose menu spans a Rs 350 burger and a Rs 50
bottle of water. Rs 12 is 3% of one and 24% of the other, so the item most
likely to be dropped from the menu is the one carrying a cost it never incurred.

**Decision:** `CostEntry.appliesTo?: { kind: 'items'; ids } | { kind: 'category';
id }`. Absent means every item, which is what every row written before this
phase means, so there is nothing to migrate.

`resolveCosts` — still the single place a `CostSummary` plus a period's `Totals`
becomes rupees — returns two things from one pass:

- `perUnitCost`, a **blended** rate weighted by the period's sales mix, which is
  what the headline `breakEven` divides by. A Rs 12 box on an item that is half
  of what sold contributes Rs 6, because the headline is about the average sale
  and the average sale is half a box.
- `perUnitCostFor(menuItemId)`, the rate one item actually carries, which is
  what `itemMargins` uses.

A **category is stored by id** while `MenuItem.category` holds a name; the join
happens in `salesMix` and nowhere else. Resolution is against the category the
item is in **now** — moving an item into Burgers is the shop saying it now takes
a box.

**Rejected:** *Targeting `per-order`.* "Rs 4 per ticket that contains a burger"
is a rule nobody wants to reason about, and it is ambiguous the moment a ticket
contains two burgers and a drink — is it charged once, twice, or pro rata? Each
answer is defensible and none is obvious, which is the signature of a feature
that will be read wrongly.

*Targeting `per-revenue`.* This looks like the same feature and is a different
question. A delivery commission applies to **delivery orders**, not to burgers —
it is a property of how the order arrived, not of what was in it. Building it as
item targeting would put the right number on screen for the wrong reason and
then be in the way when the real thing is wanted: the `channel` field on orders
is where that belongs, in V2's foodpanda work.

*Storing the category by name*, which would match how `MenuItem.category` reads
and would break silently. Renaming a category rewrites every item's category
(`useMenu.renameCategory`) and would not rewrite the cost, so the cost would
stop matching anything and the items it paid for would get cheaper overnight,
with nothing on screen to say why.

*Two columns, a kind and an ids list.* Every row would carry a hole in the one
it did not use — the shape ADR-012 rejected for the amount, for invariant 2's
reason.

*Treating an absent target as an empty one.* Absent means every item; empty
means these items, of which there are none. Collapsing them makes every
pre-existing row silently stop being charged, which is the flattering direction.

**Consequences:** With nothing targeted, `perUnitCost` is arithmetically the old
figure — by construction, not by agreement, because the untargeted total is
computed first and the blend adds to it. A regression check pins `breakEven`
both with a mix and without.

**The blend looks like the circular rate ADR-012 removed, and is not.** That one
divided a fixed rupee total by revenue-so-far, so it had no bound: a Rs 1,200
cost was a 30% drag at Rs 4,000 of sales and 6% at Rs 20,000, and the target
moved all day in the flattering direction. A blend of per-item rates never
leaves the range of those rates whatever the day does, and it is the same kind
of quantity as `averagePrice` and `averageBasket`, which `breakEven` has been a
function of since 1A-ii. Convention 5 is not touched.

A caller that passes no mix charges a targeted cost **in full**, to every item,
rather than spreading it to nothing. That is the pessimistic reading and it is
deliberate: spreading to zero would be the flattering answer produced
automatically on data nobody looked at, which is invariant 2's failure one layer
up. `workbook.ts` is such a caller today.

Invariant 2 is unaffected. An item with a targeted cost and an incomplete recipe
still has a `null` margin today — a cost you can resolve does not make an
ingredient cost you cannot.

---

## ADR-023 — A per-event cost on a single-session event is held back like any other, and the difference is explained rather than removed

**Status:** accepted · 2026-08 · Depends on ADR-013, ADR-020

**Context:** ADR-013 holds a `per-event` cost back from a session's break-even
and reports it on `heldEventCosts`, because apportioning it would make
Saturday's target change on Monday. ADR-020 then made an event of one
legitimate, so a shop can name a single-day market and file its pitch fee
against the market rather than the day.

Those two together produce a reading that looks wrong. From that session's
scope, the pitch fee is held back and reported as the event's — but for an event
of one the two scopes cover exactly the same trading. The session appears to
pass break-even while a cost it genuinely owes sits outside the figure, and the
panel offers to switch to "the whole event", which lands on the same trading with
one more cost in it. 1C-ii-a recorded this and left it; it is the last thing
1C-ii-b owed.

**Decision:** The arithmetic does not change. Where the containing event has
exactly one session, the panel says so:

> **Winter Market · Rs 1,200 held** — this is the event's only session, so the
> whole of it applies to this trading. [See the event]

The reader gets the true picture in one sentence and the whole figure in one tap.

**Rejected:** *Allocating the event's costs when `sessions.length === 1`.* This
is the fix a later session will reach for, which is why this ADR exists. It
sounds like a narrow special case and is not one: it makes break-even a function
of how many sessions the event has **at the moment it is read**. Trade Saturday
alone under a named market, read Saturday's break-even, then add Sunday to the
same market on Sunday morning — and Saturday's target silently drops, because
the cost that was charged to it in full is now shared. That is convention 5
broken exactly as ADR-013 describes, arriving through the door ADR-013 left
open.

*Auto-ungrouping a single-session event*, or refusing to let one carry costs.
Both undo ADR-020 to tidy a display problem, and ADR-018 already records why
inventing and destroying events under the shop is the wrong direction.

*Showing the held cost only when the event has two or more sessions.* The cost
is real and outstanding either way. Hiding it in the one case where it is
certainly owed by this session is the worst available answer.

**Consequences:** A figure that behaves the same however many days a market ran,
at the price of a sentence explaining the one case where the pedantry shows.
`metrics.check.ts` pins the arithmetic so that a later session tidying this
fails a check rather than passing review.
