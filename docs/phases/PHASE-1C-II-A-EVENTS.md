# Phase 1C-ii-a — The model and the manager

**Depends on:** 1A (ADR-012–015), 1B (ADR-016–017), 1C-i (ADR-018–019)
**Introduces:** ADR-020, ADR-021
**Followed by:** 1C-ii-b (the scope picker and the cost form), 1C-iii (Finance)

Phase 1C-ii is the money half of the Analytics rebuild, split across two
sessions. This is the first, and it is the data model: what an event is, when it
can exist, and how a session gets into one. 1C-ii-b builds the picker and the
cost form on top of it. Nothing in this phase touches `resolveCosts`, the
`ScopePicker` hierarchy, or the Finance table.

---

## Goal

Make `per-event` usable at the moment it is needed.

`per-event` exists for one stated cost, from `01-DOMAIN.md`: *"the pitch fee for
a three-day market is paid once, for the market, and splitting it across three
days by hand is both tedious and wrong."*

That cost could not be logged. An event could be brought into existence exactly
one way — tick two or more already-traded sessions and name them — so an event
existed only after two days had been traded and grouped by hand. The pitch fee
is paid on Saturday morning, before Sunday and Monday exist. At that moment
`per-event` is correctly disabled by ADR-018, and it stays disabled until the
market is two-thirds over. Day three could not be added to a group made on
Sunday without ungrouping every day and grouping them again, during the market.

The basis was unusable at the only time anyone would want it, and the shop's
two options were both wrong: type the fee as `per-session` against Saturday,
which charges one day for three days' pitch and makes Saturday look
unprofitable; or wait until Monday night and re-file it, which nobody does.

So: an event can be created before its sessions, an event of one is legitimate
when a person declares it, sessions can join and leave events at any point, and
nothing is deleted behind the shop's back.

---

## What changed

### 1. Events carry a plan, and a status that is derived

`TradingEvent` gains `plannedStart`, `plannedEnd` and `venue`, all optional,
alongside the `notes` it already had.

**The planned dates are a plan and never the record.** What an event actually
spans still comes from its sessions — `eventGroups` reads the members'
timestamps, `spanOf` measures the members, and every event-scoped figure
resolves through them. Nothing consults the planned dates for any of that. They
exist so an event can be created on Thursday for Saturday, and so the manager
can sort and label something that has not traded. This is said at length on the
type, in the schema, in the migration and in `01-DOMAIN.md`, because the next
reader will assume they are authoritative and derive a window from them — which
is invariant 4's mistake reached by a different route.

`eventStatus(event, sessions)` returns `planned` (no sessions), `active` (at
least one session active **or paused**) or `ended` (has sessions, all ended).
Paused counts as active: a market that stops at dusk and picks up in the morning
is still running.

**Derived, never stored.** A `status` column would be a second source of truth
about a fact the sessions already hold, and it would disagree the first time
somebody resumed a session inside an ended event. `metrics.check.ts` asserts
that transition, and asserts that no such column exists.

### 2. An event of one is legitimate — when a person declares it

The two-session minimum is gone from `group`. Three ways in:

- `group(sessionIds, name)` — the bulk path, now accepting one session.
- `makeSessionAnEvent(sessionId, name?)` — one session, named separately
  because 1C-ii-b's cost form links to it.
- `addEvent(name, details?)` — an event with nothing in it yet.

**ADR-020 complements ADR-018 and does not supersede it.** What ADR-018 forbids
is *the program* inventing an event so a basis stops being disabled; every route
above is a person naming one. ADR-020 states the distinction at length and cites
ADR-018 by number, specifically so a later session reading them side by side can
see that both stand.

### 3. Sessions join and leave events

`startSession(sessions, now, name?, eventId?)` takes an optional event, and the
handler takes a `StartTarget` — an existing event, a new one named on the spot,
or none. **None is the default.** Most days are just days, and a picker that
demands an answer every morning is dismissed every morning, after which the
session carries whatever the dismissal happened to mean. A new event named at
start is created in the same tick, so the session never points at an id with no
row behind it.

`moveSessionToEvent(sessionId, eventId?)` is the operation the model was
missing. Passing `undefined` takes the session out, so the manager's "move
into…" control has a "none" entry rather than a second control beside it.
`ungroup` is now a call to it, so detaching has one implementation rather than
two that can drift.

It refuses a destination that does not exist: a session pointing at a missing
event reads as ungrouped to `eventGroups` and grouped to everything that reads
the field, and the two would never be reconciled.

Undo is recorded at the mutation site with `restoreAction` (convention 3) —
only the session array changes, the events being untouched either way. Starting
a session stays not-undoable, for the reason `explainNotUndoable` already gives:
it hands out kitchen ticket numbers.

### 4. Events are never auto-deleted

`ungroup` no longer drops the event when its last session leaves. That was right
while events could only be created by grouping, because then a session-less
event could only be a leftover. It is wrong now, and it destroys a plan.

`deleteEvent(eventId)` is the explicit removal — undoable, and confirmed on undo
because it is the only deletion here and its label does not say which sessions
came out with it (invariant 6). It **refuses while a cost is filed against the
event itself**, returning the reason to the caller rather than throwing.

The concern the auto-delete served is served by the `eventGroups` / `allEvents`
split; see *What the next phase can now assume*.

### 5. The Sessions & Events manager

`SessionBar`'s panel is a manager rather than a list with a grouping form
stapled to it. It is **contained in the panel and deliberately not a fifth
top-level destination** — sessions and events are administration, touched at the
start of a market and at the end of one, and a fifth menu would work against the
five-to-four navigation reduction planned later.

- Events come from `allEvents`, so a planned event is in the list with its
  status, its plan and its venue.
- A `planned` event with no sessions offers **"start a session"** inline. That
  hands the gesture back to the bar with the event pre-selected rather than
  starting a session from behind a modal: starting one is not undoable, so it
  happens where the shop can see the till.
- Ungrouped sessions are in a section headed **"Not in an event"**, which is the
  presentational half of ADR-020's consequence.
- `⋯` on a session: rename, resume, end, make this an event, move into… (every
  other event, by name and status), take out of its event.
- `⋯` on an event: rename / dates / venue, and delete. A refused deletion says
  why, in the panel, where the person who pressed it is.
- The checkbox multi-select survives as the bulk path, with its threshold
  dropped to one.

### 6. The strip names its event

`Sat 14 Aug · Winter Market`. The person at the till knows which market they are
in, and this is where somebody notices that today's session never got attached
to one — the failure that leaves a pitch fee filed against a market missing one
of its days. Drawn from the events array rather than from a field on the
session, so it cannot say something the grouping does not.

---

## Files touched

| File | What |
|---|---|
| `src/app/types.ts` | `TradingEvent` gains three fields, and the reasoning on them |
| `src/app/lib/sessions.ts` | `eventStatus`, `allEvents`, `ungroupedSessions`, `EventDetails`, `costsFiledAgainstEvent`; `createEvent` and `startSession` take more; `eventGroups` excludes session-less events explicitly |
| `src/app/state/useSessions.ts` | `moveSessionToEvent`, `makeSessionAnEvent`, `addEvent`, `editEvent`, `deleteEvent`; `start` takes a `StartTarget`; `group` drops the minimum; `ungroup` stops deleting |
| `src/app/components/SessionBar.tsx` | the manager, the start form's event control, the strip's event name |
| `src/app/screens/BoardScreen.tsx` | five new props wired through |
| `src/db/tradingEventRows.ts` | **new** — the row mapping, both directions, runnable under `tsx` |
| `src/db/persistence.ts` | reads and writes through it; the delete comment now says what reaches it |
| `src/db/schema.ts` | three columns, and why there is no `status` |
| `src-tauri/src/lib.rs` | the `CREATE TABLE` and three `add_column_if_missing` calls |
| `src-tauri/src/sync.rs` | one comment: the position is load-bearing and columns are read per table |
| `metrics.check.ts` | 208 checks to 255 |
| `docs/01-DOMAIN.md`, `docs/02-DECISIONS.md` | Trading event rewritten; ADR-020, ADR-021 |

---

## Invariants introduced

None. Two conventions were leaned on rather than added:

- **Convention 3** — undo recording at the mutation site. `moveSessionToEvent`
  uses `restoreAction` because one array changes; `deleteEvent` and `group`
  write custom actions because two do.
- **Invariant 4** — the reason `eventStatus` is derived and the reason the
  planned dates are not authoritative. Both are the same mistake as inferring
  session membership from timestamps, arriving through a different door.

What this phase adds to the record is the **`eventGroups` / `allEvents` split**,
which is a rule rather than an invariant: two functions over the same data
answering different questions, and merging them breaks consumers that index
`group.sessions[0]`. It is asserted in `metrics.check.ts` in both directions.

---

## How to verify

**Runs here:**

```bash
npm run typecheck      # passes
npm run check:metrics  # 255 checks, all passing
```

The new checks are in two blocks, `Events` and `Event round trip`, plus
`Starting into an event`:

- `eventStatus` across all three states, paused reading as active, and the
  transition a stored status would get wrong — an event of one reads `ended`,
  its session is resumed, and it reads `active` again.
- An event of one against a lone ungrouped session: `grouped` true and false,
  only the first carrying an event id, and both holding exactly one session,
  which is why they look alike on screen.
- `eventGroups` excludes session-less events and `allEvents` includes them,
  asserted explicitly. Plus: no group anywhere is ever empty.
- No auto-delete: detaching the last session leaves the event, with no sessions
  and status `planned`, and the session it lost reappears in `eventGroups` as a
  lone one.
- The round trip of the four columns, field by field and then whole. With three
  cases that matter as much as the happy one: an event made by grouping after
  the fact comes back with **no** plan rather than with zeros; a pre-migration
  row with none of the columns still loads; and a stored zero is not a date.

**Does not run here, and is outstanding:**

- `cargo test` — no Rust toolchain in the session. The migration is three
  `add_column_if_missing` calls following the existing pattern and one widened
  `CREATE TABLE IF NOT EXISTS`; both are idempotent by construction, and neither
  has been executed.
- `npm run build` — not attempted.
- `smoke.check.mjs` — no browser. Every selector it uses
  (`[data-session-start]`, `[data-session-name-input]`,
  `[data-session-start-confirm]`, `[data-session-bar="active"]`,
  `[data-session-end]`) is preserved, and the start form it drives still has a
  name input and a submit button in the same shape. Unverified.

**By hand, on a device:** create an event with no sessions; confirm it appears
in the manager and **not** in the analytics scope picker; start a session into
it from its row; confirm the strip names it; take the session out and confirm
the event survives with status `planned`; file a `per-event` cost against it and
confirm deletion is then refused.

---

## Bugs found and deliberately not fixed

**`TradingEvent.notes` and the brief's `note`.** The brief's interface lists
`note?: string` as one of four new fields. `TradingEvent` already carries
`notes?: string`, with a column, read and written. Adding `note` beside it would
put two free-text fields with near-identical names on the same type — one
written by one call site and read by another is a matter of time, and the data
would be lost silently. The existing `notes` is what the brief's `note` means,
so three columns were added rather than four. Raised rather than assumed.

**A per-event cost on an event of one reads oddly, and correctly.** From that
session's scope the pitch fee is held back and reported as the event's, per
ADR-013 — for an event of one, the two scopes cover the same trading. This is
the reading ADR-018 identified as a reason not to *auto-create* an event of one,
and it is unchanged by ADR-020: the difference is that the shop asked for the
distinction and can see why it is drawn. Not worked around, because working
around it would mean special-casing single-session events in `breakEven`, and a
figure that behaves differently depending on how many days a market ran is worse
than one that is consistently a little pedantic. Written down so 1C-ii-b, which
draws that panel, decides what to *say* about it rather than rediscovering it.

**`deleteEvent` returns a result rather than throwing, and only the manager
reads it.** Nothing else calls it yet. If 1C-ii-b adds another caller, the
refusal has to be surfaced there too — a discarded result is a deletion that
silently did nothing.

**Planned dates are parsed as local midnight**, so `plannedEnd` is the start of
the last day rather than the end of it. Nothing computes on these, so nothing is
wrong today. It becomes a real question the first time something sorts or
filters on them, which is not this phase.

**The export menu is outside the revenue lock** (1C-i's finding). Untouched;
Phase 6.

**1B's cost-averaging drift** and **`useSettings.hydrate`'s first-failure
behaviour** are untouched, as briefed.

---

## What the next phase can now assume

1C-ii-b builds the `ScopePicker` hierarchy and the cost form on top of this, so
this section is the interface.

### `allEvents(events, sessions)` returns

```ts
interface EventListing {
  event: TradingEvent;          // including plannedStart/plannedEnd/venue/notes
  sessions: TradingSession[];   // oldest first; empty for a planned event
  status: EventStatus;          // 'planned' | 'active' | 'ended'
  span: { start: number; end?: number } | null;   // null while it has no sessions
}
```

Sorted newest first, on the sessions where there are any and on
`plannedStart ?? createdAt` where there are not. `span` is the **real** span
from the sessions, and is `null` rather than the plan — a plan sitting in the
column a measurement belongs in is how a plan becomes a record. `end` is
`undefined` while any member is still running.

Ungrouped sessions are **not** in it. `ungroupedSessions(events, sessions)` is
that list, newest first, and it counts a session whose `eventId` names a missing
event as ungrouped — matching `eventGroups`, so the two never disagree.

### What a session-less event does and does not appear in

| | Session-less event |
|---|---|
| `allEvents` | **yes**, with status `planned` and `span: null` |
| `eventGroups` | **no** — and therefore not in `scopeOptions`, `ScopePicker`, `trendBuckets`, `workbook`, `OrdersExplorer` |
| `resolveScope({ kind: 'event', id })` | falls through to the date scope, as it does for a deleted one |
| `ResolvedScope.perEvent` on a **date** scope | **yes** — it reads `input.events.length`, so a plan made this morning makes the basis available today |
| The manager | yes, with "start a session" inline |

That last row is the point of the phase and is worth stating plainly: **a
planned event with no sessions makes `per-event` available from a date scope.**
That is ADR-018 working exactly as written — "what matters is only whether there
is an event to file against" — and it is what lets the pitch fee be logged on
Saturday morning.

### The "make this an event" handler

```ts
makeSessionAnEvent(sessionId: string, eventName?: string): void
```

On `useSessions().actions`. Creates a real event containing that one session and
attaches it, undoably. No-ops if the session is already in an event, or does not
exist. The name defaults to the session's own.

This is the control the cost form should link to when it has told the shop that
`per-event` is unavailable from a session scope. **Call it from a gesture, never
from a code path.** ADR-018 rejects the program creating an event so a basis
stops being disabled, and this function is exactly the thing that would do it —
what makes it legitimate is that a person pressed something.

### Do not merge `eventGroups` and `allEvents`

They answer different questions and the split is ADR-021's whole mechanism.
`eventGroups` never returns a group with zero sessions, and several consumers
index `group.sessions[0]` or hand the list to `spanOf`, which returns `null` for
an empty set on purpose. There are checks on both halves.

### `ResolvedScope.eventId` is still the honest test

`per-event` is settled and 1C-i's statement of it holds unchanged. A lone
ungrouped session is still presented as an event of one and is still not one;
its group has `grouped: false` and the *session's* id, and `resolveScope` still
hands `costsOf` an event id only for a real event. What is new is that the shop
now has a one-tap way to make it real when it should be.

### What is not settled here

- **Where the cost form names its target.** 1C-ii-b. This phase gives it
  `allEvents` to populate a picker from and `makeSessionAnEvent` to offer.
- **Per-unit item targeting** and `resolveCosts` — 1C-ii-b.
- **What the Finance panel says** about an event of one's held cost. See the
  second bug above; the model is right, the copy is that phase's.
- **Whether `plannedEnd` should be end-of-day.** Nothing reads it yet.
