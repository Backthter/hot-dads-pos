# Phase 1C — Analytics, rebuilt (revised)

**Status:** revised after 1C-i · supersedes the previous 1C plan
**Done:** 1C-i (ADR-018, ADR-019)
**Depends on:** 1A (ADR-012–015), 1B (ADR-016–017)

---

## Why this plan changed

1C-i shipped the shell as specified. Two things came out of it and out of
reviewing the event model that change what should happen next.

### The event model has an ordering contradiction

`per-event` exists for one reason, stated in `01-DOMAIN.md`: *"the pitch fee for
a three-day market is paid once, for the market, and splitting it across three
days by hand is both tedious and wrong."*

You cannot log that cost.

- `handleGroupSessions` refuses fewer than two sessions: `if (sessionIds.length
  < 2) return;`
- It always calls `createEvent` — there is **no way to attach a session to an
  event that already exists**.
- `handleStartSession` takes a name and nothing else. A session cannot be
  started into an event.

So an event comes into being only *after* at least two sessions have been traded
and then grouped by hand. But the pitch fee is paid on Saturday morning, before
Sunday and Monday exist. At the moment you would enter it, `per-event` is
correctly disabled by ADR-018, and it stays disabled until the market is
two-thirds over.

The basis is unusable at the only time anyone would want it. That is not a
labelling problem and no amount of clearer copy fixes it.

### Events are invisible, which is why the basis reads as meaningless

An event *is* a container of sessions — that is the whole of it. But nothing on
the cost form says which event, or what it contains. `per-event` attaches to
`ResolvedScope.eventId`, derived from whatever scope happens to be selected. The
user picks a basis and the target is implicit.

`ScopePicker` presents events and sessions as parallel flat lists, so even there
the containment is not visible. Nothing in the app ever shows that Winter Market
*is* Saturday, Sunday and Monday.

### 1C-i's own finding

`AnalyticsView.tsx` was 1,119 lines, not the 919 the plan assumed. Both remaining
sessions were sized against a number a third too small.

---

## Resequenced

| | Name | Status |
|---|---|---|
| 1C-i | The shell | **done** |
| **1C-ii** | **Events made real** | new — inserted |
| 1C-iii | Money | was 1C-ii |
| 1C-iv | Things | was 1C-iii |

Events must come before Money. The Finance table groups rows by session and
event, the money ledger attributes costs to them, and `breakEvenCrossing` has to
know whether held event costs are in or out. Building all three on a model that
cannot represent a single-day market means building them twice.

---

## 1C-ii — Events made real

**Goal.** Make the container a thing you can see, create, and put a session into.

### E1 — An event can exist before its sessions do

Drop the two-session minimum. Add direct creation, with real properties:

```ts
export interface TradingEvent {
  id: string;
  name: string;
  createdAt: number;
  /** Optional, and only ever a plan — the sessions are the record. */
  plannedStart?: number;
  plannedEnd?: number;
  venue?: string;
  note?: string;
}
```

`plannedStart` / `plannedEnd` are deliberately *not* authoritative. What the
event actually spans comes from its sessions, as it does now. The planned dates
exist so an event can be created on Thursday for Saturday, and so the manager can
sort sensibly before anything has traded.

**Status is derived, never stored:** `planned` (no sessions yet), `active` (has
an active or paused session), `ended` (all sessions ended). Storing it would
create a second source of truth that drifts the first time somebody resumes a
session — the same class of problem invariant 4 exists to prevent.

### E2 — An event of one is legitimate, when a person says so

This is the fix for a single-day market's pitch fee, and it needs care because it
looks like it contradicts ADR-018.

It does not. ADR-018 forbids **the program** inventing an event to make a basis
available — auto-creating an event of one so `per-event` stops being disabled.
That would make `heldEventCosts` report a cost the session already owes, because
the event and the session would be the same period.

A **person** deliberately declaring "this Saturday is the Winter Market, and the
pitch fee is the market's not the day's" is a different act. The event is then a
fact about the business, entered by someone who knows whether it is one.

The ADR for this must say so explicitly, and must cite ADR-018 as complemented
rather than superseded — otherwise a later session reads the two and concludes
one of them is wrong.

**Consequence worth stating:** an event of one and a lone ungrouped session look
identical on screen and are not. The manager must distinguish them visibly, and
`ResolvedScope.eventId` remains the honest test.

### E3 — Sessions can join and leave events

Three operations that do not exist today:

- **Start a session into an event.** `handleStartSession` gains an optional
  event: an existing one, a new one, or none. Default is none — most days are
  just days, and a picker that demands an answer every morning will be dismissed
  every morning.
- **Move an existing session into an existing event.** The gap that makes a
  three-day market ungroupable as it happens.
- **Detach**, which exists.

**The auto-delete rule needs revisiting.** Today, detaching the last session
deletes the event, on the reasoning that an event with no sessions is a leftover
label. That was right when events could only be created by grouping. It is wrong
once they can be created ahead: a planned event with no sessions yet is exactly
what "created on Thursday for Saturday" produces, and auto-delete would erase it
the moment someone corrected a mis-grouping.

Replace with: **events are never auto-deleted; they are deleted explicitly.** An
event with no sessions appears in the manager and **not** in `ScopePicker` —
there is nothing to report on. That keeps the picker clean, which was the
original point, without destroying a plan. Needs an ADR; it supersedes part of
the current documented behaviour.

### E4 — One place to manage them

Contained, as you asked — not a fifth menu, which would work against Phase 5's
five-to-four reduction.

`SessionBar`'s panel becomes a proper **Sessions & Events** manager:

```
┌ Sessions & Events ─────────────────────────────── [+ New event] ┐
│                                                                  │
│  ▾ Winter Market            planned · 14–16 Aug   [edit] [⋯]     │
│      no sessions yet                          [start a session]  │
│                                                                  │
│  ▾ Autumn Fair              ended · 3 sessions · 8–10 Aug        │
│      Fri 8 Aug   4h 10m · 47 orders · Rs 22,180      [⋯]         │
│      Sat 9 Aug   5h 02m · 52 orders · Rs 24,900      [⋯]         │
│      Sun 10 Aug  3h 40m · 31 orders · Rs 14,200      [⋯]         │
│                                                                  │
│  ── Not in an event ──────────────────────────────────────       │
│      Tue 19 Aug  2h 15m · 22 orders · Rs 9,400       [⋯]         │
│        └ [make this an event] [move into…]                       │
└──────────────────────────────────────────────────────────────────┘
```

The `⋯` menu on a session: rename, move into an event, detach, resume, end.
The `⋯` on an event: rename, edit dates and venue, delete.

Keep the existing multi-select-and-group flow — it is the fastest way to fix a
week's worth of ungrouped sessions and it should not be lost. It becomes one
route in rather than the only one.

### E5 — `ScopePicker` shows the containment

This is your second question, and the answer is yes. One hierarchical list
replacing the parallel flat ones:

```
  Date range                                    [last 7 days ▾]
  ─────────────────────────────────────────────────────────────
  ▾ Winter Market              3 sessions · 14–16 Aug      ← selects the event
      Sat 14 Aug     47 orders · Rs 22,180                 ← selects the session
      Sun 15 Aug     52 orders · Rs 24,900
      Mon 16 Aug     31 orders · Rs 14,200
    Tue 19 Aug       22 orders · Rs 9,400        not in an event
```

Selecting the header scopes to the event; selecting a child scopes to that
session. Nothing about `Scope`'s three shapes changes — the reasoning in
`01-DOMAIN.md` about two filters that disagree still holds, and this is a
presentation change, not a model one.

The point is that the shape of the data becomes visible. Once you can see that
Winter Market *is* those three days, "charged once for the whole event" stops
being a phrase and becomes a thing you are looking at.

An event with no sessions does not appear here (E3).

### E6 — The cost form names its target

Currently the form offers a basis and attaches silently. Instead, state the
attachment in words, under the basis:

- `per-session` → *Charged once for this service — **Sat 14 Aug***
- `per-event` → *Charged once for the whole event — **Winter Market**, 3 sessions,
  14–16 Aug*
- `per-order` → *Charged with every ticket in this session*
- `per-unit` → *Charged with every item sold* (see E7)
- `per-revenue` → *Taken as a share of this period's sales*

And when `perEvent.available` is false, replace the disabled chip with an
**action**: *"This session isn't part of an event. **Make it one** — then this
cost can belong to the market rather than to the day."* One press creates a real
event of one containing this session (E2) and enables the basis.

That turns ADR-018's dead end into the thing the user was trying to do. The
explanation stays; it now ends in a button rather than in a shrug.

### E7 — Costs can target specific items

This is your third question. There are two readings and only one of them is a
good idea.

**Scoping analytics to an item** — "show me everything for the Burger" — is a
filter on a different axis from the scope. Putting it in `ScopePicker` recreates
exactly the two-filters-that-disagree problem the scope model was designed to
avoid. It belongs as drill-through in the Business table, which 1C-iv builds.
Not here.

**Targeting a cost at specific items** is a real modelling gap and it should be
fixed before 1C-iv builds anything on top of margins.

A `per-unit` cost currently applies to every unit sold. Most real per-unit costs
do not: a burger box is a burger cost, a portion cup is a fries cost, a lid is a
drink cost. Log *"packaging, Rs 12 per item"* today and it is charged against
drinks as well, which understates drink margin and overstates burger margin — in
the two columns 1C-iv is about to build.

```ts
/**
 * Which menu items this cost is charged against. Absent means all of them.
 * Only meaningful for `per-unit`; a period cost has no item to attach to.
 */
appliesTo?:
  | { kind: 'items'; ids: string[] }
  | { kind: 'category'; id: string };
```

**Keep it to `per-unit`.** `per-order` targeting reads as "Rs 4 per ticket that
contains a burger", which is a rule nobody wants to reason about. `per-revenue`
targeting is really a *channel* question — delivery commission applies to
delivery orders, not to burgers — and the `channel` field on orders is where that
belongs, later.

**The engine change is smaller than it sounds**, because 1A-ii already made
`resolveCosts` the single resolution point. It returns two things instead of one:

- a **blended** per-unit rate for the headline break-even, weighted by the actual
  sales mix — which is correct, and is what the shop-level figure should use;
- a **per-item** lookup for `itemMargins`, so a burger carries its box and a
  drink does not.

Both come out of one pass. `breakEven` keeps its scalar; `itemMargins` gains
precision it should always have had.

### E8 — Where sessions surface elsewhere

Your fourth question: contained, but present where it matters.

- **Order mode** shows the session *and its event* — "Sat 14 Aug · Winter Market"
  — so the person at the till knows which market they are in. Today it shows only
  the session name.
- **The cost form** names its target (E6).
- **`ScopePicker`** shows the hierarchy (E5).
- **Finance rows** (1C-iii) are sessions and events; a row should offer the same
  `⋯` actions as the manager, so grouping can be fixed from where the problem is
  visible.

**One candidate deliberately deferred: the session summary.** Ending a session is
the natural moment to show what it did — orders, revenue, whether break-even was
passed, costs logged, anything that ran out. It is a good feature and it is the
moment a shop would notice a cost they forgot to enter. But it wants Finance's
figures, so it belongs after 1C-iii rather than in this session. Raised, not
scheduled.

---

## 1C-iii — Money

Unchanged from the previous plan, minus the cost-targeting work now in 1C-ii.

- **Finance table** — one row per session, event or day depending on scope.
- **`breakEvenCrossing`** — the ticket and clock time the period covered its
  costs. A historical fact that never moves once passed; held event costs
  excluded in a session scope, and the row says so.
- **History · Money** — the money ledger, unioning receipts (via
  `effectiveMovements`), cost entries by basis, and sales rolled up per session.
- The explainer stays reachable from both.

Now that events can be created ahead, one thing gets easier: a Finance row for a
`planned` event with no sessions is simply absent, and an event of one is a real
row rather than a special case.

---

## 1C-iv — Things

Unchanged.

- **Inventory table** — with `Days cover` labelled as a projection.
- **Business table** — both margins from `itemMargins`, which after E7 correctly
  charges item-specific per-unit costs.
- **History · Stock** — the cross-item ledger, reusing 1B's Show-undone toggle
  and `referenceId` adjacency.
- 1C-i left the Inventory column list to this session; the rule is ADR-019's:
  quantities and days of cover without the PIN, money with it.

---

## Carried forward, still open

- **The export menu is outside the lock** — 1C-i's finding. A user with no
  revenue PIN can export a workbook containing everything the lock hides. It
  predates the phase and the export is out of scope until Phase 6, but it is a
  real hole and Phase 6 must close it.
- **Sticky state is in-memory**, so the tab migration cannot fire in production.
  Correct and checked; becomes load-bearing if sticky state is ever given disk.
- **`HINT.costFixed` / `HINT.costVariable`** describe the pre-ADR-012 model.
  Nothing reads them. 1C-ii is touching the cost form and should delete them.
- **1B's cost-averaging drift** — undoing a costed receipt leaves
  `StockItem.costPerUnit` where the delivery moved it. Bounded, self-correcting,
  and a cost-model decision about historical unit costs.
- **`useSettings.hydrate`'s first-failure behaviour** — from Phase 0.

---

## If it has to stop

Stop after 1C-iii. Events and Money together make 1A's cost work legible and fix
a basis that currently cannot be used. Inventory and Business are additive on top
of an engine that already computes most of what they show.
