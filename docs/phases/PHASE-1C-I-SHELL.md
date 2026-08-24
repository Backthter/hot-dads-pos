# Phase 1C-i — The shell

**Depends on:** 1A (ADR-012–015), 1B (ADR-016–017)
**Introduces:** ADR-018, ADR-019
**Followed by:** 1C-ii (money), 1C-iii (things)

Phase 1C rebuilds the Analytics screen over three sessions. This is the first
and it is structural: it decides the shape the next two build inside, and it
ships with every figure that was reachable before still reachable now. It builds
no new tables — those are 1C-ii and 1C-iii.

---

## Goal

Turn four tabs that were named after the app's own vocabulary into four tabs
named after questions a shop asks, split the 1,119-line screen so that two more
sessions can be added to it without it becoming unreadable, and settle two rules
before anything is built on top of them: what the revenue PIN hides, and where a
`per-event` cost may be filed.

The old tabs were `Overview / Sales / Orders / Costs`. Three of those describe
the program rather than the business, and the fourth — Costs — was a
destination, which is the wrong shape for it entirely. Nobody opens an app to
look at Costs. They look at what the day made, find it disappointing, and *then*
want to know what the day cost; the costs form is a thing you arrive at from a
figure, not a place you go.

The new set is four questions:

| Tab | Question | Absorbs |
|---|---|---|
| **Finance** | Did this pay? | Overview, Costs |
| **Inventory** | What do I have, and what is it doing? | — |
| **Business** | What's working? | Sales |
| **History** | What happened? | Orders |

---

## What changed

### Task 1 — The tab set

`src/app/analytics/tabs/model.ts` is new and holds the tab set as data: the four
ids and labels, the three History sources, the lock capability, and the
migration from the old ids. It is deliberately pure — no React, no icons — so
`metrics.check.ts` can run the parts of it worth checking. Icons are attached in
`AnalyticsView`, where the tab bar is actually drawn.

**History carries a source selector: Orders · Stock · Money.** Only Orders has
content this session; it is `OrdersExplorer`, moved and otherwise untouched.
Stock (1C-iii) and Money (1C-ii) are empty states that name the phase that fills
them, and the selector is shown with them on it rather than hidden until they
work. A control that grows options later is a control nobody knows to look for,
and being told a thing is coming is more use than being shown a selector that
appears to have one option by design.

**Costs stops being a destination.** `CostsPanel` is unchanged; only its entry
point moved. It is now a page reached from a button on Finance, pushed as a
navigation step through `useTabStep`, so the app's Back leaves the page and
returns to the tab it was opened from rather than leaving the section. The
costs explainer (task 4) is reached the same way.

**Nothing was lost.** Every figure that was on Overview is on Finance and every
figure that was on Sales is on Business, in the arrangement each already had.
Nothing was moved to Inventory, which is empty this session. 1C-ii and 1C-iii
replace this content with tables; this task was navigation.

**The sticky tab migrates rather than falling back.** `useStickyState` remembers
the tab by id, so a remembered `sales` would have matched nothing. Falling back
to the default would be correct and would also quietly throw away where somebody
was, which is the one thing sticky state exists to prevent. `migrateTabId` is a
pure function — `overview` and `costs` → Finance, `sales` → Business, `orders` →
History — applied on read, so a stored legacy id resolves to its new home every
time until something writes.

### Task 2 — The file split

`AnalyticsView.tsx` was 1,119 lines. The **rendering** moved out:

```
src/app/analytics/tabs/FinanceTab.tsx
src/app/analytics/tabs/InventoryTab.tsx
src/app/analytics/tabs/BusinessTab.tsx
src/app/analytics/tabs/HistoryTab.tsx
```

`BreakEvenByItem`, `RevenueChart` and `Sparkline` went with Business, which is
the only thing that renders them; `Stat` went with Finance for the same reason.
`Screen` — the motion wrapper every tab is drawn inside — went to
`AnalyticsUI.tsx` rather than being copied four times, which is where the
section's other shared presentational pieces already live. That is one more file
than the brief listed, and it is the alternative to four identical copies of a
transition.

**The memo layer stayed put, and that is the point of the task rather than an
omission.** `AnalyticsView` resolves the scope once, holds its outputs steady by
value with `useStableList` and `useStableRange`, and derives every figure from
those stabilised values. A tab component that resolved its own scope would
rebuild the item and category tables — the two most expensive things in the
section — on every clock tick, and undo ADR-009's work. So a tab takes computed
figures as props and computes nothing for itself.

Two deliberate details in what a tab receives:

- **Tabs are given `tradingHours` and `sessionScoped` as values, not `resolved`
  as an object.** `ResolvedScope`'s identity changes on every tick by
  construction; passing it down would hand every tab a prop that is new every
  five seconds, which is exactly the thing the stabilised values exist to avoid.
- **Tabs still own their own presentation state** — which item break-even is
  showing, which cut the revenue chart is on. That is not scope and does not
  belong upstairs.

This was a pure refactor. No figure changed. Two pieces of user-facing copy did,
because task 1 made them false: see *Bugs found* below.

### Task 3 — The revenue lock is per-tab

The rule was `revenueLocked && tab !== 'orders'`, written where the screen is
drawn. It is now a capability the tab declares — `locked: 'all' |
'money-columns' | 'none'` — resolved in one place. History declares `none` and
delegates to its source, because its answer depends on which records are being
read. ADR-019 has the reasoning; the table it produces is:

| Tab | Locked |
|---|---|
| Finance | entirely |
| Business | entirely |
| Inventory | **partially** — quantities and days of cover visible, money hidden |
| History · Orders | not locked |
| History · Stock | not locked — quantities, not money |
| History · Money | entirely |

Two pure functions do the work. `lockFor(tab, source)` says which lock is in
force; `resolveLock(locked, revenueLocked)` says what that means now, returning
`{ hidden, moneyHidden }`. `AnalyticsView` calls them once. **Nothing else in
the section reads `revenueLocked` to decide whether to draw itself.**

Inventory has no table yet, so the capability is defined, applied and visible —
the tab draws with a line saying that value and cost are withheld — and the
column list is left to 1C-iii. The rule is the part that had to be settled
before two sessions build inside it.

### Task 4 — The costs explainer

`src/app/analytics/CostsExplainer.tsx`. A page, not a tooltip, reachable from
Finance and from History · Money. It states the four money-shaped things —
revenue, what the things sold cost to make, what left the till for stock, and
the running costs the till cannot see — each with its source and the question it
answers, and then the rule that separates them:

> **Profit is measured on what you used. Cash is measured on what you bought.**

Written for somebody who runs a stall: a Rs 8,000 mince delivery and Rs 900 of
mince eaten are not competing answers to "what did stock cost me". Rs 900 is
what the day cost; the rest is in the freezer and will be somebody's burger next
week. Rs 8,000 is what left the till, and it is the number that decides whether
the pitch fee can be paid this week. A profit figure will never say that,
because profit does not know when you paid.

It is a page rather than a hover because this is the frame the whole rebuild
rests on, and a frame that only appears when the pointer crosses something is a
frame most people never see.

### Task 5 — The scope fix (1A-ii's bug 2)

`resolveScope` gains `eventId` and `perEvent: { available, reason? }`, and
`CostsPanel` disables `per-event` where it has nothing to attach to, with the
reason in the place the hint would have been. ADR-018 records what was rejected:
auto-creating an event of one, and letting a session id stand in for an event
id. The first is the fix a later session will otherwise reach for, and it would
make ADR-013's held-cost distinction meaningless.

The basis in `CostsPanel` is now derived rather than held in state, so a scope
change under an open form cannot leave an illegal basis selected.

### Task 6 — Verification

`metrics.check.ts` goes from 181 checks to **208**. What was added is only what
can be checked purely:

- **Per-event availability**, across all five cases: a lone session refuses it
  and says why, a grouped session and an event scope allow it and carry the
  event id, a date scope refuses it with no events and allows it with one. Plus
  the assertion that matters most for the next session: a session id never
  becomes an event id.
- **The tab-id migration**, each legacy id to its new home, and a round-trip
  check over every current id — so renaming a tab without updating the migration
  fails here rather than quietly resetting somebody's screen.
- **The lock table** above, stated as checks, including that nothing is withheld
  when the PIN is not set and that `hidden` and `moneyHidden` are alternatives
  rather than a pair.

### Task 7 — Documentation

ADR-018 and ADR-019. `00-ARCHITECTURE.md`'s Analytics section now states the tab
split, what `tabs/` holds, and where the memo layer lives and why.
`01-DOMAIN.md` gains *The two order screens*, and a note on `Scope` for the two
new fields.

---

## Files touched

```
src/app/analytics/tabs/model.ts          new — the tab set, the lock, the migration
src/app/analytics/tabs/FinanceTab.tsx    new — the old Overview, plus the way into Costs
src/app/analytics/tabs/InventoryTab.tsx  new — empty, but carrying the lock
src/app/analytics/tabs/BusinessTab.tsx   new — the old Sales
src/app/analytics/tabs/HistoryTab.tsx    new — the source selector and OrdersExplorer
src/app/analytics/CostsExplainer.tsx     new — the four things and the rule
src/app/analytics/AnalyticsView.tsx      1,119 → 544; scope, tabs, lock, memos, pages
src/app/analytics/AnalyticsUI.tsx        gains Screen
src/app/analytics/scope.ts               eventId and perEvent on ResolvedScope
src/app/analytics/CostsPanel.tsx         per-event offered only where it can attach
src/app/analytics/RevenueLock.tsx        copy — the lock screen names the new tabs
metrics.check.ts                         181 → 208 checks
docs/02-DECISIONS.md                     ADR-018, ADR-019
docs/00-ARCHITECTURE.md                  the Analytics section
docs/01-DOMAIN.md                        the two order screens; Scope's new fields
```

Not touched, deliberately: `metrics.ts`, `OrdersExplorer.tsx`, `ExportMenu.tsx`,
`workbook.ts`, `filters.ts`, `search.ts`, `ScopePicker.tsx`, and everything
outside `analytics/`. No figure was recomputed and no export was extended.

---

## Invariants introduced

None. The six invariants are untouched; nothing here goes near the data model.

**One convention arrives**, and it belongs with the six in `03-INVARIANTS.md`
only if a later phase finds it needs restating outside this document:

> **A tab renders; the view resolves.** An analytics tab component takes
> computed figures as props. It does not resolve the scope, does not read the
> clock, and does not read `revenueLocked`. What it may own is its own
> presentation state.

It is a convention rather than an invariant because breaking it corrupts
nothing — it makes the screen slow, in the specific way ADR-009 was written to
prevent, and slowly enough that nobody connects the two.

---

## How to verify

`npm run typecheck` and `npm run check:metrics` pass. **`cargo test`,
`npm run build` and `smoke.check.mjs` were not run** — no Rust toolchain and no
browser in the session that made this change. They are outstanding.

`metrics.check.ts` cannot see React, so most of this phase has to be checked by
hand. In order of what would be worst to have got wrong:

1. **Nothing lost.** Walk every figure that was on Overview, Sales, Orders and
   Costs and find it. Overview's are on Finance in the same arrangement:
   the data-quality banners, the eight KPI cards, Kitchen, Dead stock, Sessions
   in scope. Sales' are on Business: the twelve KPI cards, break-even by item,
   the revenue chart with its three cuts, payment mix, bought together, items by
   revenue, items by units, categories, popularity trend. Orders is History ·
   Orders. Costs is the *Log a cost* button on Finance.

2. **The lock.** Set the revenue PIN, then check each tab as a locked user
   against the table above. Finance, Business and History · Money should show
   the lock screen. History · Orders and History · Stock should be open.
   Inventory should draw, with the line saying value and cost are withheld.

3. **The sticky tab.** The store is in-memory, so this is checked within one
   run: open Analytics, note that the default is Finance, and confirm that
   leaving for Inventory and coming back returns the tab and period you had.
   The legacy mapping itself is checked in `metrics.check.ts`; see *Bugs found*
   for why it cannot be checked by hand across a restart.

4. **Cost logging.** *Log a cost* on Finance opens `CostsPanel`. Adding a cost
   still writes what it wrote — the amount, the note, the basis, the target —
   and the migration notice still appears if the shop has un-refiled entries.
   Back returns to Finance rather than leaving Analytics.

5. **`per-event`.** With a lone ungrouped session in scope, the per-event button
   is dimmed and says to group the sessions first. Group two sessions into an
   event, scope to either the event or one of its days, and it is available
   again. With a date scope, it depends on whether any event exists at all.

6. **The explainer.** Reachable from Finance and from History · Money. Back
   returns to the tab it was opened from.

7. **Break-even's empty state.** With no costs logged, the break-even panel on
   Business now offers a link to Finance rather than naming the Costs tab.
   Pressing it should land on Finance with the costs page open.

---

## Bugs found and deliberately not fixed

**The brief said `AnalyticsView.tsx` was 919 lines. It was 1,119.** Nothing
turns on it, but the file was a third larger than the plan assumed, which is
worth knowing for the two sessions that were sized against the same number.

**`useStickyState` is an in-memory `Map`, not disk.** It is documented as such
and deliberately so — "it is where you were in the session, not a setting". The
consequence for this phase is that the tab-id migration can never actually fire
in production as described: a stored `sales` cannot survive the update that
removes the Sales tab, because the store does not survive the process. The
migration is still worth having and is still correct — it is one pure function,
it costs nothing, and it becomes load-bearing the moment sticky state is given a
durable backing — but the hand-check "open on the old Sales tab, update, reopen"
cannot be performed. It is checked in `metrics.check.ts` instead. Not fixed:
making the store durable is a decision about what sticky state *is*, and it is
not this phase's to make.

**The export menu is outside the lock.** `ExportMenu` sits in `NavActions`,
which is in the nav slot rather than in the locked region, so a user with no
revenue PIN can export a workbook containing every figure the lock is hiding.
This predates the phase — the old condition guarded the same region — and the
export is out of scope here by the brief. It is a real hole in the lock and
should be closed by whichever phase next touches the export. Written down, not
fixed.

**`HINT.costFixed` and `HINT.costVariable` describe the pre-ADR-012 model.**
They still say "a cost that rises with every sale", which is the `variable` that
ADR-012 removed for not saying what it varied with. Nothing reads them. Left
alone: deleting hints is not this phase's business, and a hint nothing renders
is not a wrong figure.

**Two pieces of copy were changed rather than left**, because task 1 made them
false rather than merely stale, and a refactor that ships a screen telling the
user to visit a tab that no longer exists is not behaviour-preserving:

- Break-even's `noFixedCosts` empty state said "on the Costs tab". It now points
  at Finance, as a button that opens the costs page.
- The break-even KPI card's definition said the same thing.
- `LockedRevenue` said "Order counts and the Orders tab stay available". It now
  names History · Orders, History · Stock and Inventory's partial case.

---

## What the next phase can now assume

This section matters more than usual: 1C-ii and 1C-iii build inside what this
session decided, and both of them add screens to the shape below rather than
changing it.

### What a tab component receives

**Computed figures, as props, already resolved against the scope.** Every figure
on Finance and Business arrives from `AnalyticsView`'s memo wall. A new tab
follows the same rule: add the memo upstairs, pass the result down.

The scope itself is *not* passed. A tab receives `tradingHours` and
`sessionScoped` as values, because `ResolvedScope`'s identity changes on every
clock tick and handing it down would give every tab a prop that is new every
five seconds.

### What a tab must not compute for itself

- **The scope.** Calling `resolveScope` inside a tab recomputes on every tick
  and undoes ADR-009. This is the single most important line in this document.
- **Anything from the clock.** `useNow` has one subscriber on this screen and it
  is `AnalyticsView`. If a new figure is genuinely live, it takes `now` in a
  memo upstairs (convention 1).
- **The lock.** A tab does not read `revenueLocked`. It declares `locked` in
  `tabs/model.ts` and receives the answer.
- **Anything expensive.** The item and category tables are already resolved and
  handed down. Deriving a new table from `orders` inside a tab puts it back
  inside the tick.

What a tab *does* own is its own presentation state — a carousel index, a
segmented control's position — including anything sticky that belongs to it.

### How the lock capability is applied

Declare it, do not check it.

- A new tab adds an entry to `TABS` with a `locked` value.
- A new History source adds an entry to `HISTORY_SOURCES`, with its own `locked`.
- `lockFor` and `resolveLock` are the only two functions that interpret it, and
  `AnalyticsView` is the only caller.
- A tab that is `money-columns` receives `moneyHidden` and is responsible for
  *saying* that something is withheld. A column that silently disappears reads
  as a missing feature rather than as a lock.

**1C-iii owns the Inventory column list.** The capability is defined and applied
this session; which columns `money-columns` hides — `Value` and `Bought`, per
the brief, and whatever else the table gains — is that session's decision. The
rule it has to hold to is the one sentence in ADR-019: quantities and days of
cover are visible without the PIN, money is not.

**V2's roles are the eventual consumer.** "May see stock levels, may not see
what stock cost" is `money-columns` said about a person instead of about a PIN.
When roles arrive, the second argument to `resolveLock` comes from a role rather
than from one global flag; nothing a tab declares changes.

### Where the two new pages live

`CostsPanel` and `CostsExplainer` are pages inside Analytics, not tabs, held in
`analytics.page` sticky state and pushed as navigation steps. A page is cleared
when the tab changes, because a page belongs to the tab it was opened from. If
1C-ii adds the money ledger to History · Money, the explainer should stay
reachable from it — it is the frame that ledger is read through.

### `per-event` is settled

Do not auto-create an event of one. Do not let a session id stand in for an
event id. `ResolvedScope.perEvent` is the answer to "may this scope offer a
per-event cost", and `ResolvedScope.eventId` is the id `costsOf` was given. Both
are checked. ADR-018 says what was rejected and why, which is there specifically
so that a later session does not "fix" this by inventing the event.

### Still open, and still out of scope here

- **The export menu is outside the lock** (above). The first phase to touch the
  export should close it.
- **1B's cost-averaging drift**, its bug 1.
- **`useSettings.hydrate`'s first-failure behaviour**, from Phase 0.
- **Sticky state is in-memory**, which is a decision about what sticky state is
  rather than a defect.
