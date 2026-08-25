# Phase 1C-ii-b — Scope, costs and targeting

**Status:** complete · 2026-08
**Base commit:** `325a661` — "docs: file the planning scaffold, and correct it against the tree"
**Branch:** `phase-1c-ii-b-costs`, off `master`
**ADRs:** 022–023
**Checks:** 255 → 334 in `metrics.check.ts`

---

## Goal

Two things a shop could not see, and one it was told wrongly.

**Containment was invisible.** Events and sessions were two parallel flat lists.
Nothing anywhere in the program showed that Winter Market *is* Saturday, Sunday
and Monday — so "charged once for the whole event", which is the sentence the
whole `per-event` basis exists for, read as a phrase rather than as a thing you
were looking at. 1C-ii-a built the model that makes a market a real object; this
is the phase where it appears on screen.

**A per-unit cost was charged to everything.** *"Packaging, Rs 12 per item"* came
off drinks as well as burgers. On a menu spanning a Rs 350 burger and a Rs 50
bottle of water that is 3% of one and 24% of the other, so the item most likely
to be dropped from the menu was the one carrying a cost it never incurred — and
1C-iv is about to build two margin columns on exactly that figure.

**The cost form stated its attachment as a dropdown value.** "Whole event" and
"Winter Market" are both true and neither says that Rs 3,000 is about to be paid
once for three days of trading. A shop that misreads that files a pitch fee three
times.

Behind all three sits the thing this phase was most at risk of: `breakEven` is
the figure ADR-012 was written to stop moving, and every change here touches what
it divides by.

## What changed

### Task 9a — the basis-switch rule becomes a function

Done **first**, before anything touched the component.

`CostsPanel` held its target as one string and cleared a `session:` target when
the basis became `per-event`, because only events are offered there. That rule
was one statement inside an `onClick`, on a `.map` over the five bases, checked
by nothing:

```ts
if (b === 'per-event' && !target.startsWith('event:')) setTarget('');
```

It is now:

```ts
/** The target that survives a basis change. Empty when the old one cannot. */
export function targetAfterBasisChange(basis: CostBasis, target: string): string
```

in `src/app/lib/sessions.ts`, with twelve checks — including the case that was
actually broken, and a switch away and back, which must not resurrect what was
dropped.

This mattered more than it looks. The rule was added in **1A-ii** by `4fd29c2`
and a review four phases later re-reported it as an open defect, because nothing
in the tree said it had ever been absent or that anything depended on it staying.
This phase then rewrote that whole control. A line in a handler has no history; a
function with a check does.

### Task 5a — `CostEntry.appliesTo`

```ts
appliesTo?:
  | { kind: 'items'; ids: string[] }
  | { kind: 'category'; id: string };
```

One nullable JSON column on `cost_entries`, added through the same
`add_column_if_missing` path 1A-i used, so re-running is safe. Null means every
item, which is what every row written before this phase means — nothing to
backfill.

Three decisions inside the task:

- **A category is stored by id, not by name**, even though `MenuItem.category`
  holds a *name*. The join happens in `salesMix` and nowhere else. Storing the
  name would read more naturally and break silently: `useMenu.renameCategory`
  rewrites every item's category and would not rewrite the cost, so the cost
  would stop matching and the items it paid for would get cheaper overnight.
- **Absent is not empty.** Absent is every item; `{ kind: 'items', ids: [] }` is
  these items, of which there are none. Everything unreadable — an older build's
  row, malformed JSON, an unknown `kind` — reads as *absent*, because that is the
  only reading which cannot silently shrink a figure.
- **`assertCostEntry` refuses it on the other four bases**, where the amount is
  divided by the period, the ticket or the rupee and there is no item to name.
  The load path drops it instead of throwing, exactly as it already demotes a
  per-event cost with no event.

### Task 6 — `resolveCosts` returns a blend and a per-item rate

The signature gains a mix, and the return gains two members:

```ts
resolveCosts(costs, totals, scope, mix: SalesMixEntry[] | null = null): ResolvedCosts

perUnitCost: number;                                  // blended, for the headline
perUnitCostFor: (menuItemId: string) => number;       // per item, for itemMargins
```

Both from one pass. `resolveCosts` stays the single place a `CostSummary` plus a
period's `Totals` becomes rupees — that is what keeps the headline figure and the
per-item column from drifting apart on how a rate is spread, and it is why this
change is small.

`CostSummary` gained `perUnitTargets`, the targeted entries kept aside from the
total. A summary carrying entry-level detail looks like a leak and is the smaller
of two evils; the alternative is a second path from entries to money.

**The blend looks like the circular rate ADR-012 removed, and is not.** That is
the one thing worth reading twice here. The old defect divided a *fixed rupee
total* by revenue-so-far, so it had no bound — a Rs 1,200 cost was a 30% drag at
Rs 4,000 of sales and 6% at Rs 20,000, and the target moved all day in the
flattering direction. A blend of per-item rates never leaves the range of those
rates whatever the day does, and it is the same kind of quantity as
`averagePrice` and `averageBasket`, which `breakEven` has been a function of
since 1A-ii. Convention 5 is untouched. ADR-022 records the argument.

A caller that passes **no** mix charges a targeted cost in full rather than
spreading it to nothing — the pessimistic reading, because spreading to zero is
the flattering answer produced automatically on data nobody looked at.

### Task 1 — `ScopePicker` shows containment

One hierarchical list. An event draws its sessions indented under it; selecting
the header scopes to the event, selecting a child scopes to that session.
`Scope` keeps its three shapes and only one is ever in force — this is
presentation, and the two-filters-that-disagree reasoning is untouched.

A real event of one draws as an event with one child; a lone ungrouped session
draws flat and says *"not in an event"*. They scope to different things, and only
the first can carry a per-event cost, so they must not look alike. `grouped` on
`EventGroup` is the distinction and was already there.

Events are expanded by default and collapsible, held as the set that has been
*collapsed*. An event that must be opened before it shows what it contains has
not shown it. Expanding is not selecting: the chevron stops propagation, so a
shop can look inside a market without changing what the screen is reporting.

**Deliberately no money in these rows.** See *Invariants introduced*.

### Tasks 2–5b — the cost form

**Task 2.** The target picker reads `allEvents(events, sessions)` rather than the
raw `events` prop. Membership is unchanged — a session-less event is still
offerable, and must be, because the pitch fee is paid on Saturday morning before
Sunday exists (ADR-021) — but the raw list carried only a name, so the picker
could not say whether an event had traded or when. It now shows
`planned` / `active` / `ended` and the real span or *"no sessions yet"*, and it
is hierarchical, matching task 1.

**On the truncation**, which the brief asked to decide: the old list offered the
last twelve sessions newest-first. Under a hierarchy that reads wrongly — day
four of a market could fall outside the window while days one to three showed, so
*"Winter Market · 3 sessions"* would sit above a market that ran four. An event's
sessions are the thing the hierarchy exists to show, so **they are never
truncated**; every session of a listed event is listed. The bound moved to the
two lists with no containment to break: twelve events, and twelve sessions
belonging to none. The blank first entry keeps its per-basis distinction —
*"Pick an event"* under `per-event`, and the live session or *"No session — dated
only"* otherwise.

**Task 3.** The attachment is stated in a sentence under the basis:

```ts
describeCostTarget({ basis, event?, session? }): string
describeCostItems(appliesTo, names): string
```

Both pure, both in `lib/sessions.ts`, both checked — sixteen cases. This is the
only place the money model is explained to the person typing the number, and copy
that drifts from the code is precisely the debris task 8 cleared up.

**Task 4.** Where `perEvent.available` is false and the scope is one session, the
disabled chip gains a button that makes that session an event. The session is
named by the **resolver**, on a new `PerEventAvailability.makeable`, rather than
worked out in the panel — ADR-018's principle is that the resolver decides and
the form asks, and a panel that found the session itself would be a second answer
to the same question. ADR-018 stands: the program is not inventing the event, a
person presses a button that says what it will make.

**Task 5b.** `per-unit` gains a *Charged on* select — every item, a category, or
one item. Offered on that basis alone.

*A shape worth noting.* The target is cleared through state on a basis change
(`targetAfterBasisChange`), while the item target is **derived** — `appliesTo`
returns `undefined` unless the basis is `per-unit`, so a stale selection can
never be submitted under another basis. Two techniques for the same class of
problem, adjacent, which is exactly the confusion this component already invites
between the derived `basis` fallback and the handler-driven target guard. The
difference is deliberate: the target is a *choice the shop made* that stays
meaningful under most bases and must visibly go when it stops being an option,
while the item target is meaningless off `per-unit` and simply has nowhere to be
sent. Keeping the stale value lets a shop flip to `per-order` and back without
retyping.

### Task 7 — the held cost on an event of one

Copy, not arithmetic. Where the containing event has exactly one session:

> **Winter Market · Rs 1,200 held** — this is the event's only session, so the
> whole of it applies to this trading. [See the event]

`breakEven` is untouched, and three checks now pin that. ADR-023 records why
allocating on `sessions.length === 1` is not the narrow special case it looks
like: add a second day to the market later and the first day's break-even moves
retroactively, which is exactly what ADR-013 forbids.

### Task 8 — the ADR-012 debris

`HINT.costFixed` and `HINT.costVariable` deleted, with a note in their place
saying where per-basis wording now lives. The break-even KPI's *"per-sale costs"*
now names the three scaling bases. A **fourth** instance of the phrase, in the
doc comment on `ItemBreakEven.contributionPerUnit`, went with them — same debris,
found while removing the other three.

## Files touched

| Path | What changed |
|---|---|
| `src/app/types.ts` | `CostAppliesTo`; `CostEntry.appliesTo` |
| `src/app/lib/sessions.ts` | `targetAfterBasisChange`, `describeCostTarget`, `describeCostItems`; `assertCostEntry` split around `costEntryIncoherence` |
| `src/app/analytics/metrics.ts` | `SalesMixEntry`, `salesMix`, `targetCovers`; `resolveCosts` rewritten; `CostSummary.perUnitTargets`; `itemMargins` takes a per-item rate; `breakEven` takes a mix |
| `src/app/analytics/ScopePicker.tsx` | hierarchical list, collapse state, `spanLabel` |
| `src/app/analytics/CostsPanel.tsx` | targets from `allEvents`, hierarchy, attachment sentence, item picker, make-an-event action |
| `src/app/analytics/scope.ts` | `PerEventAvailability.makeable` |
| `src/app/analytics/AnalyticsView.tsx` | `menuCategories` prop, the `mix` memo, `eventSessionCount` |
| `src/app/analytics/tabs/BusinessTab.tsx` | event-of-one held-cost copy; the KPI definition string |
| `src/app/screens/AnalyticsScreen.tsx` | passes `menu.state.categories` and `makeSessionAnEvent` |
| `src/app/state/useSessions.ts` | `addCost` takes `appliesTo` |
| `src/app/ui/primitives.tsx` | `SelectOption.depth` |
| `src/app/ui/hints.ts` | two hints deleted |
| `src/db/schema.ts`, `src/db/costEntryRows.ts` | the `applies_to` column and `parseCostAppliesTo` |
| `src-tauri/src/lib.rs` | `add_column_if_missing(… "applies_to" …)` — **not compiled here** |
| `metrics.check.ts` | 79 new checks |
| `BUG-FIXES.md` | correction note appended, section 2 left standing |

Read and deliberately not changed:

| Path | Finding |
|---|---|
| `src/app/lib/sessions.ts` · `eventGroups` | Correct as written; still drops session-less events, which is what keeps them out of `ScopePicker`. Not merged with `allEvents` — 1C-ii-a's instruction holds |
| `src/db/persistence.ts` | Placeholders derive from `COST_ENTRY_COLUMNS`, so both the read and the write picked the new column up with no edit. Checked, already correct |
| `src-tauri/src/sync.rs` | Columns are enumerated at runtime by `get_all_columns`, so `applies_to` replicates without a change. Checked, already correct |
| `src/app/analytics/workbook.ts` | Left alone — and it is now a finding. See below |

## Invariants introduced

No new entry in `03-INVARIANTS.md`, and no new convention. What ADR-022 and
ADR-023 add are decisions about the cost model, not rules that corrupt data
silently when broken — the existing six already cover what this phase leans on
(invariant 2 for absent-versus-empty, invariant 3 for what `appliesTo` is *not*,
convention 5 for the blend).

One rule that belongs to a phase rather than the file, recorded here because it
will otherwise be broken by someone acting reasonably:

> **Nothing rendered in the analytics nav slot may show money.**

`NavSlot` closes at `AnalyticsView.tsx:441`, before the `lock.hidden` branch — so
`ExportMenu`, `ScopePicker` and the earlier-stock toggle are all outside the
revenue lock. The obvious way to draw a hierarchical scope list is with each
session's takings beside its name, and doing so would hand every figure the lock
hides to a user with no PIN, without anybody noticing they had done it. Task 1
left money out for this reason. ADR-019 keeps order counts unlocked; takings are
Phase 6's to let out, if ever.

## How to verify

**Checked** — 334 in `metrics.check.ts`, 79 of them new.

The **regression** is `Targeted per-unit costs · break-even · untargeted,
unchanged by the mix` and its three siblings. They compute `breakEven` with a
sales mix and without one over a cost set that targets nothing, and assert the
units, contribution, revenue and per-unit cost are identical. If that fails,
ADR-022 has changed a number for every shop that never used it.

The other groups:

- **`The target that survives a basis change`** (12) — the rule task 9a
  extracted, including the case that was broken and a switch away and back.
- **`Targeted per-unit costs`** (31) — the mix; the blend hand-computed at half
  the units; the per-item lookup; the no-mix fallback charging in full; a
  category, and an item that has changed category; a category id nothing answers
  to charging nothing rather than everything; and invariant 2 holding through a
  targeted cost on an incomplete recipe.
- **`Cost target round trip`** (17) — both `appliesTo` shapes field by field and
  then whole; absent versus an empty id list; `assertCostEntry` refusing a target
  on each of the four other bases; the load path demoting rather than throwing;
  unparseable and unknown JSON reading as absent.
- **`The form names its target`** (16) — every basis, a planned event, an event
  of one, a deleted category, an empty list.
- **Event of one** (3, added to the existing break-even group) — the arithmetic
  ADR-023 promises not to change.

**By hand**, against a copy of the real database:

1. Open Analytics, open the scope picker. A market with several days shows its
   sessions indented beneath it; a session you never grouped sits flat and says
   *not in an event*. **Wrong answer:** the two draw identically, or an event's
   fourth day is missing while the first three show.
2. Scope to one day of a market. Finance → Costs. The `per-event` basis is
   offered, and the sentence under the bases names the market, its session count
   and its span. **Wrong answer:** the sentence names the session.
3. Scope to a session in **no** event. `per-event` is disabled with its reason,
   and beneath it a button offers to make that session an event. Press it. The
   basis becomes available and the event appears in both pickers. Undo. It goes
   away again. **Wrong answer:** the event appears without anyone pressing
   anything — that is ADR-018 broken.
4. Create an event **for next Saturday** with no sessions. It is absent from the
   scope picker and present in the cost target picker, marked *Planned · no
   sessions yet*. File the pitch fee against it. **Wrong answer:** it is missing
   from the cost form — the Saturday-morning case is the whole point of 1C-ii-a.
5. Log *"boxes, Rs 12 per item"* charged on your burger category. Business →
   item break-even: the burger's contribution falls by Rs 12 and a drink's does
   not move. The headline break-even rises by less than it would have. **Wrong
   answer:** every item falls by Rs 12, or the drink moves at all.
6. Restart the app. The cost still says *charged on Burgers*. **Wrong answer:**
   it reverts to every item — that is `event_id`'s Phase 0 failure repeating.
7. Scope to a single-day market that carries a per-event cost. The note names it
   and says the whole of it applies to this trading. **Wrong answer:** the cost
   has been folded into the break-even figure — see ADR-023.

**Not run here.** `cargo test`, the Tauri build and `smoke.check.mjs` need a Rust
toolchain and a browser, and neither is in this sandbox. The one Rust change is a
single `add_column_if_missing` line in `lib.rs`, following the two directly above
it; it is unverified and step 6 above is what would catch it being wrong.

## Bugs found and deliberately not fixed

**1 — The exported workbook resolves costs without a sales mix.**
`workbook.ts:286` calls `breakEven(totals, costs)`, so a targeted `per-unit` cost
is charged in full there. For a shop that targets one, the break-even in the
export is **higher** than the one on screen. Nothing is invented — the fallback
is the pessimistic one by design — but two numbers with the same name disagree
across two surfaces, which is the shape ADR-014 was written about. The file
already computes `items`; it would need the category list threading in. Left
because the export is Phase 6's and is the same file that has to grow the revenue
lock, and opening it twice is worse than opening it once.

**2 — A `per-unit` cost can only be pointed at one item at a time.**
`CostAppliesTo` holds `ids: string[]` and `resolveCosts` walks all of them, but
the *Charged on* select sets one. A cost riding on three items has to be logged
three times, or as a category that also catches things it does not ride on.
Neither is wrong in the figures — three entries of Rs 12 at one item each resolve
exactly as one entry at three — but the ledger then reads as three purchases of
the same thing. The storage and the arithmetic are the parts that are expensive
to change later and both already take a list; the control is cheap to add once
somebody knows whether the shop wants one.

**3 — The whole nav slot is outside the revenue lock, not just the export.** The
existing register entry named `ExportMenu`; this phase found the gap is the slot.
Recorded there in its wider form, because whoever closes it should close it at
the slot so the next control added there inherits the lock rather than having to
remember it. This phase's own compliance is one comment in `ScopePicker`, which
is exactly the kind of protection that lasts until the next rewrite.

**Introduced and fixed inside this phase:** none. The one thing that came close
is worth naming: the first shape for the item picker resolved a category to menu
items *inside* `CostsPanel`, which would have made the panel a second site
performing the category-name-to-id join. That is the join whose only other home
is `salesMix`, and two of them would have drifted the first time either moved. It
was moved before it was committed.

## Carried forward

> See `docs/OPEN.md`.

**Closed by this phase**, and removed from the register:

- `HINT.costFixed` / `HINT.costVariable` — deleted (task 8).
- The break-even KPI's *"per-sale costs"* — reworded, along with a fourth
  instance in a doc comment (task 8).
- The event-of-one held cost reading oddly — ADR-023, in the panel's words
  (task 7).
- The basis-switch guard being unchecked — `targetAfterBasisChange`, twelve
  checks (task 9a). The defect itself closed in 1A-ii; see the correction note
  at the end of `BUG-FIXES.md`.

**Added:** the workbook's mix-less break-even, and the single-item picker.

## What the next phase can now assume

1C-iii builds the Finance table, `breakEvenCrossing` and the money ledger on top
of this.

### Resolving costs to money

```ts
resolveCosts(costs, totals, scope, mix): {
  fixed, heldEventCosts,
  perUnitCost,            // blended over the mix — the shop-level rate
  perUnitCostUntargeted,  // the floor every item carries
  perUnitCostFor(id),     // what one item carries
  perOrderCost, revenueRate, averageBasket,
}
```

**Anything new that resolves costs takes the mix**, or it will disagree with the
screens that do. `salesMix(items, menuItems, categories)` builds it; build it
once and hand it to everything, as `AnalyticsView` does — two sites deriving it
separately is how the headline and the per-item column come to disagree about the
same box.

**Use `perUnitCostFor` for anything per item and `perUnitCost` for anything
shop-level.** They are different numbers on purpose and both are right.

### Things not to do

- **Do not merge `eventGroups` and `allEvents`.** 1C-ii-a's instruction, still
  load-bearing, and now with a second consumer each: `ScopePicker` runs the
  first, the cost target picker runs the second. `docs/01-DOMAIN.md` has the
  reason written down so the difference does not read as an oversight.
- **Do not allocate a per-event cost when the event has one session.** ADR-023.
  There is a check that fails.
- **Do not put money in the analytics nav slot.** It is outside the lock.
- **Do not extend `appliesTo` to `per-order` or `per-revenue`.** ADR-022 says
  why for each: the first is an ambiguous rule, the second is a *channel*
  question and the `channel` field on orders is where it belongs.
- **Do not delete `targetAfterBasisChange` into its call site.** That is where it
  came from, and where it went unchecked for four phases.

### Settled, and not

**Settled:** what a per-unit cost may target, and how it resolves. How a held
event cost is explained. What both pickers offer, and why they differ.

**Not settled, and 1C-iii's:** whether the Finance table shows the per-item rate
as a column of its own or folds it into contribution. Whether `breakEvenCrossing`
takes the blended rate — it should, since it is a shop-level figure, but the
crossing point is a *time* and nothing here has computed one yet.

### What the prompt got wrong

Recorded so the next planner does not repeat it, in the spirit of
`plan/PLANNING-CONTINUITY.md`.

- **`src/app/lib/hints.ts:90`** — the file is `src/app/ui/hints.ts`. The line was
  right.
- **`{ kind: 'category'; id: string }` assumes a menu item carries a category
  id.** It does not: `MenuItem.category` holds the category's **name**, and
  `useMenu.renameCategory` rewrites every item when a category is renamed. The
  brief's shape is still the right one — an id survives a rename and a name does
  not — but it needs a join, which is why `salesMix` exists and why
  `AnalyticsView` gained a `menuCategories` prop. Anyone implementing this from
  the brief alone would have stored a name.
- Every other line number in the prompt was correct: `ScopePicker.tsx:45`,
  `AnalyticsView.tsx:403/434/449`, `CostsPanel.tsx:90/108–119/239`,
  `metrics.ts:1010`, `BusinessTab.tsx:131`, `sessions.ts:228`.
