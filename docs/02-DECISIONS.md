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
