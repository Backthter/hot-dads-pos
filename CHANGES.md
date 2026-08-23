# PosV3 — visual and interaction overhaul

## What changed in this pass

### One design system, instead of three
`src/app/ui/`

The program was carrying three parallel palettes: one written inline through
`App.tsx`, one in `inventory/InventoryUI.tsx`, one in `analytics/AnalyticsUI.tsx`.
That is why Analytics — a purple section, opened from a purple tile — drew every
bar, every ranked row and every highlighted figure in amber. Nothing picks a
colour by hand any more; it asks the section it is mounted in.

- `ui/tokens.ts` holds every colour, radius, hit-target size and elevation in the
  app, and derives each section's full palette from one hex value.
- `ui/SectionTheme.tsx` puts that palette into the tree. A screen that wants to
  look like its section now does nothing at all — it inherits. A `tone` prop can
  be forgotten; a wrapper cannot.
- `ui/primitives.tsx` is the shared vocabulary: Button (six variants), Panel,
  SettingRow, TextInput, Select, Toggle, NumberStepper, SegmentedControl, Badge,
  EmptyState, ScreenHeading, LiftCard. Every one responds to hover, to focus and
  to the press itself, so "everything reacts" is true by construction rather
  than by remembering.
- `ui/Popover.tsx` replaces four hand-rolled dropdowns that agreed on nothing —
  two blurred, two not, three corner radii, one that could not be closed from
  the keyboard.
- `ui/Dialog.tsx` replaces five hand-rolled modals.
- `ui/motion.ts` is one set of springs and durations, honouring
  `prefers-reduced-motion` everywhere rather than in some screens.

Sections keep their signature colour throughout — Order teal, All Orders blue,
Analytics purple, Inventory orange, Settings graphite, taken from the sketch —
while the button that *commits* stays the app's amber in every section, so the
confirm button is never a colour you have to work out. Meanings never move:
danger, warning and the kitchen's four ticket colours are identical everywhere.

### Undo and redo now cover the whole program
`src/app/lib/history.tsx`

The old implementation kept snapshots of the orders array, so Ctrl+Z could take
back a ticket move and nothing else. Adding stock, renaming a category, changing
the tax rate and emptying a cart were all one-way doors.

It now stores *actions* — each carrying the two functions that put the world
back and forward again, captured at the moment it happened. That buys three
things a snapshot stack could not have:

- **Different kinds of state share one stack.** A stock adjustment and a menu
  rename sit next to each other and undo in the order they were done.
- **Undo can be asymmetric, which the stock ledger requires.** Taking back a
  delivery does not delete the line that recorded it; it appends a correcting
  line, exactly as a person fixing a stocktake by hand would. The ledger stays
  append-only, so historical stock levels stay reconstructable and the shelf
  never disagrees with the lines that produced it.
- **An action can refuse, or ask first.** Anything money-adjacent — voiding an
  order, undoing a stock count, writing off waste — says what it is about to do
  and waits.

Runs of the same edit collapse into one step, so taking back the word
"Cheeseburger" is one press rather than twelve.

Three things stay deliberately outside it: ringing an order up, saving an edit
to a rung-up order, and starting or ending a session. Those settle money or hand
out kitchen ticket numbers. Each one now says so, once, and names the supported
way to reverse it — voiding the ticket, which keeps the record, returns the
stock and leaves the day's history true.

The controls moved out of the parked-orders sidebar, where they were 22 pixels
wide and only existed in Order Mode, into the permanent bar. Their tooltips name
the step they will take back.

### Back means one thing everywhere
`src/app/lib/navigation.tsx`

The bar's back arrow only knew about top-level screens, so pressing it from the
stock take threw you out of Inventory entirely instead of closing what you had
open. Every section had therefore grown a back button of its own, and the app
ended up with two arrows on screen meaning two different things.

Screens with depth now register what "one step back" means while they are open,
and the deepest one wins. Only when nothing is open does back leave the section.
`ScreenHeader` registers on behalf of every sub-screen that already passed an
`onBack`, so they were all fixed without being touched — and none of them draws
its own arrow any more. Alt+Left works too.

### The ticket action menu's outline
`src/app/components/TicketActionMenu.tsx` · `src/app/ui/geometry.ts`

The armed-state stroke sat off the bottom and far off the right of the ticket it
was meant to trace. Two causes, both now fixed:

- The whole interface is zoomed by `--ui-scale`, and `getBoundingClientRect()`
  reports the *zoomed* box. Feeding that straight into an overlay that is itself
  inside the zoom multiplied it a second time — 12% too large at the default
  scale, and drifting further from the ticket the further across the screen it
  sat. Everything that measures the page and then paints on it now goes through
  `ui/geometry`. The drag ghost had the same bug and is fixed with it.
- The ring was an *inset* box-shadow, which cannot work: the ticket face is an
  SVG that fills its box, and an inset shadow paints beneath an element's
  children. It only showed at all where the oversized wrapper overhung — which
  is exactly the two edges that were reported. It is now a sibling ring drawn
  outside the ticket, the same distance on every side, painted over the artwork.

Measured at 1.0, 1.12 and 1.4 zoom, the gap is now identical on all four sides.

### The main menu is a pinwheel
`src/app/components/HomeScreen.tsx`

Five identical rectangles told you nothing beyond their names: the screen you
open two hundred times a day looked exactly like the one you open twice a month.
Taking an order now sits in the middle, largest and nearest the thumb, with
everything else orbiting it in its own colour. The petals are thick arcs with
round caps, so the shape is exactly repeatable at any window size, and the whole
ring is four `<path>` elements rather than a pile of divs. Low stock and a live
session surface as badges on the tiles themselves.

### Every section's menus are in the permanent bar
Settings had its own tab strip underneath the bar, looking like something
unrelated; Inventory and Analytics were already in the bar but styled
differently. All three now use `NavTabs`/`NavTab` with a sliding pill, tinted by
the section, with a plain-language explanation on each. Settings itself moved out
of `App.tsx` into `src/app/settings/SettingsView.tsx` — it was some seven hundred
lines of markup in the middle of the component that also runs the till, with nine
near-identical setting rows written nine different ways.

### Information hovers, rewritten
`src/app/ui/hints.ts` · `src/app/ui/Tooltip.tsx`

The explanations were `title=""` attributes, which have three problems: the delay
belongs to the operating system and is far too long behind a counter, the styling
belongs to the operating system and matched nothing, and they never appear at all
on a touchscreen — so on the hardware this runs on, every explanation in the app
was invisible. They now show quickly on hover, on keyboard focus, and after a
short press with a finger.

The wording was rewritten throughout, away from describing the implementation and
towards describing the situation. "Voided orders are kept in history" became what
voiding actually does to your takings, your stock and the board. "Lift above 1
means more than coincidence" became what to do about it. Every KPI definition,
every data-quality banner and every empty state was gone through.

### Consistency and motion
- Sections cross-dissolve rather than swapping outright, with the outgoing page
  held at full opacity underneath so no frame is ever empty.
- A baseline of hover, focus and press behaviour in `src/styles/index.css` for
  anything interactive, so a plain `<button>` written in passing still behaves
  like part of the same program. Keyboard focus draws a ring in the section's
  colour; the pointer does not.
- Toggles and chosen segments read as *on* rather than as their section colour —
  Settings' graphite made a switch that was on look like one that was off.
- Inventory and Analytics were using `--app-surface` as their page background,
  which is also what a resting button uses, so every secondary button in those
  two sections was invisible against the page.
- The right-hand ordering panel is a light surface inside a dark app; it now
  restates the surface variables for its own subtree, so a shared control
  dropped into it is simply right rather than charcoal on white.

### Removed
`components/InventoryManager.tsx` (665 lines) and `components/DropZone.tsx` were
dead — nothing had imported either for some time. They were also two more
independent takes on what a panel and a button look like, which is part of how
the design drifted in the first place.


---

# PosV3 — sessions and events, cost ledger, analytics rebuild

## Follow-up

### Actual food cost now reads the ledger, and upgrades when stock is counted

Both ends of the calculation are replayed from the stock ledger rather than read off a daily
snapshot. A snapshot is written once, at the first launch of the day, so it describes the shelf at
breakfast — asking it what a session that ran from noon to eight closed on gets an answer a whole
trading day stale. Every movement already records the level it left behind, so replaying to an
instant is exact and nothing accumulates or drifts.

The ledger answers even for a window that opens before its first line: that line's
`resulting − delta` is the level it stepped away from, which is the level throughout everything
earlier. Stock whose arrival was never recorded is therefore measured rather than assumed away.

A `basis` of `ledger` or `counted` now travels with the figure, and the card is labelled
**Actual food cost (est.)** until a stock take falls inside the period. A count writes a correcting
movement that is already inside the sum, so nothing about the arithmetic changes when one runs —
only how much it can be trusted, which is exactly what the label says. An informational line in the
data-quality banner makes the same point without nagging.

### Events are reachable from everywhere they should be

- The scope picker shows the **Events and sessions** section even when it is empty, explaining how
  to fill it. Hiding it made scoping by event look like a missing feature rather than an empty list.
- **Session**, **Event**, **Session ticket** and **Taken in a session** are now fields in the order
  filter builder, matched on names so a saved search still reads as a sentence.
- Free text matches session and event names too — typing `winter` finds that market's orders, and
  `winter, cash` narrows to the cash ones.
- The orders table gained an **event** sort and an **Event / session** column: newest event first,
  its sessions in the order they ran, each session's tickets in the order they were called. Orders
  taken before sessions existed sink to the bottom rather than scattering through events they never
  belonged to.

## What changed

### Sessions are now saved, resumable and grouped into events
`src/app/lib/sessions.ts` · `src/app/components/SessionBar.tsx` · `src-tauri/src/lib.rs`

A session used to be two values in `app_state` — a boolean and a start timestamp — and nothing
survived ending one. It is now a row, and every order taken during it carries its id.

- **Start, pause, resume, end.** A market day is not a calendar day: it stops at dusk and picks up
  in the morning. Paused time is banked and deducted, so a session that ran four hours on Saturday
  and four on Sunday traded for eight, not for thirty-two.
- **Membership is stored, not derived.** `orders.session_id` is stamped at checkout. Inferring it
  from the start timestamp would sweep up the whole night in between.
- **Resuming continues the count.** Day one ends at #47 and day two starts at #48, so no two
  tickets in one session ever share a number.
- **True numbers are never overwritten.** `orderNumber` remains the lifetime sequence throughout;
  `sessionTicket` is a second, parallel number. Ending a session simply stops preferring it — no
  row is rewritten, so nothing can be lost.
- **Events group sessions.** A three-day market run as three services is one event and three
  sessions. Ungrouped sessions are still reported as an event of one, so the chart is complete
  without anyone having to group anything.
- Starting a session while another is live pauses the other rather than refusing. The till should
  never be blocked by a session someone forgot to close.

Orders taken before any of this existed keep no session and are excluded from session-scoped
figures rather than guessed into one. A session left open at upgrade time is adopted as a real row
and its orders back-stamped — the one case where the old timestamp rule was ever correct.

### Costs
`src/app/analytics/CostsPanel.tsx`

Ingredient cost comes out of the stock ledger on its own. The pitch fee, the staff, the gas and
the packaging are invisible to a till, so they are logged by hand: amount, note, and a fixed or
variable toggle. Entries attach to whichever session is live.

The toggle is not bookkeeping pedantry. Break-even revenue is fixed costs ÷ contribution margin,
and filing a per-unit cost as fixed inflates both sides of that division silently.

### Fifteen metrics across Overview and Sales
`src/app/analytics/metrics.ts`

| Metric | Basis |
|---|---|
| Revenue by event | grouped by event, then session; ungrouped sessions count as one |
| Revenue per trading hour | session clock where available, so quiet hours still count |
| Break-even revenue / units | fixed costs ÷ contribution margin, and ÷ contribution per unit |
| Discount rate | promoted from a caption to a KPI |
| Void rate | by count *and* by value — 2% made of the three biggest orders is not small |
| Attachment rate | co-occurring pairs, ranked with lift so bestsellers do not dominate |
| Popularity trend | session over session, with rank alongside units |
| Stockout rate | crossings to zero from the ledger, plus oversells from the till |
| Inventory turnover | COGS ÷ average stock value from the daily snapshots |
| Dead stock | the two items longest without a sale |
| Food cost | frozen line costs — what the recipes say went out |
| Actual food cost | opening stock + purchases − closing stock |
| Food cost variance | the gap, labelled *estimated* when no stock count backs it |
| Queue time | median and p90, with a distribution — a long tail is not an average |

Every figure that cannot be computed says why instead of showing a zero. Zero is a claim.

### One scope control instead of a corner date picker
`src/app/analytics/scope.ts` · `src/app/analytics/ScopePicker.tsx`

Events first, dates second, and picking either replaces the other outright — two filters that can
disagree are worse than one that cannot. Comparisons follow: a session is measured against the
previous session, not against the preceding calendar window, because markets are fortnightly and
"the 30 days before this one" is mostly days nobody traded.

### Free-text order search
`src/app/analytics/search.ts`

    burgers, cash     both     — a comma is "and", as in a shopping list
    burgers & cash    both
    burgers cash      both
    burgers/cash      either   — a slash is "or", as in and/or
    burger or cash    either
    "chicken burger"  phrase

"Or" binds looser than "and". Terms match across order number, status, items, categories and
payment method. The condition builder is still there behind a Filters toggle, and the two combine.

### Export moved into a dropdown
`src/app/analytics/ExportMenu.tsx`

The Export tab is gone. Export now sits beside the numbers it describes, in a blurred dropdown,
and always writes everything regardless of the current scope — a workbook is opened weeks later,
by which point nobody remembers which filter was on when it was made. The workbooks gained
Sessions, Events, Costs, Event/Session performance, Attachment pairs, Dead stock and Stockouts.

### Fixed along the way

- The debounced autosave listed its tables by hand and had drifted: inventory snapshots and
  oversell events were missing from it, so they only reached disk when something else forced an
  immediate save. It now saves the same snapshot the immediate path does.
- Snapshots were compared as midnight timestamps against ranges that start mid-morning, so a
  session beginning at 9am saw no snapshots at all. They are whole-day facts and are now compared
  by day.
- "All time" could never report an actual food cost, because it starts before every snapshot
  exists. A window that predates the ledger now opens on a known empty shelf.
- Sessions, events and costs were added to `SYNC_TABLES`. Syncing orders without them would leave
  a second till holding tickets that point at nothing.

### Checks
`metrics.check.ts` — `npm run check:metrics`

Every new formula is checked against figures worked out on paper: break-even at a 40% contribution
margin, lift of exactly 1.0 for an item that merely rides along with a bestseller, a pause that
turns twenty elapsed hours into eight traded ones, and the search grammar in full.

---

# PosV3 — ticket workflow, inventory rehaul, display scale, analytics

## What changed

### Ticket action menu (new)
`src/app/components/TicketActionMenu.tsx`

Pressing a ticket no longer drags it. After a **35 ms beat** the ticket lifts *where it already
sits* and four targets fan out around it, with the rest of the board dimmed. It is a held ticket,
not a menu: nothing travels, nothing takes over the screen.

| Gesture | Target | Colour | Result |
|---|---|---|---|
| Swipe **up** | Completed | green | leaves the board, counts in analytics |
| Swipe **right** | On the Grill | `#f79634` | stays visible in the On the Grill section |
| Swipe **down** | Ready | cyan | as before |
| Swipe **left** | Edit | purple | opens the order in the ordering panel |

- Up and down are labelled pills; left and right are compact discs, so all four fit around a ticket
  sitting hard against the left edge of the board — which is where most tickets are.
- Drag past **34 px** lights a direction (target fills, ticket tints and nudges toward it, short
  vibration). Releasing while lit performs it and the ticket flies into the target.
- **The menu is a held state, not a toggle.** Letting go always ends it: whatever is lit at that
  moment happens, and if nothing is lit it simply closes. One threshold means what you can see is
  exactly what you will get.
- Moving more than 10 px before the beat elapses cancels, so the board still scrolls.
- The ticket normally does not move at all. Only when a target would fall off-screen does the whole
  cluster slide inward, by the smallest amount that works (capped at 170 px). Commit is decided by
  direction and distance, never by pointing at a target, so a shifted layout behaves identically.
- Escape or a tap outside dismisses; arrow keys commit. `prefers-reduced-motion` is respected.
- The slot matching the ticket's own section has nothing useful to offer, so it becomes
  **Preparing** instead of sitting there greyed out — a grill ticket's right slot sends it back to
  Preparing, a ready ticket's bottom slot does the same, and so on. Only a full grill actually
  disables a target, and that one reads "Full".

### On the Grill replaces Completed on the board
Completed is no longer a board section. The top slot is now **ON THE GRILL** (`#f79634`), which
keeps its tickets visible indefinitely. Completed orders still appear in All Orders and in analytics.

When the board is scrolled, the grill section **collapses into a sticky strip** pinned to the top —
the header plus a chip per ticket showing its number and first item (`01 ×1 Burger`, with `+2 more`
when there are others) — so what is cooking stays in view while you work further down. Tapping the
strip scrolls back to the top and restores the full section.

Collapsing removes the grill's own height from the scrollable area, which can drop the container
back to the top and expand it again — a loop that feels like the board is fighting you. So it only
collapses past 48px **and** when there will still be room to stay scrolled past that afterwards, and
only expands again within 10px of the top. With just a little overflow it simply stays expanded.

The grill has a **capacity**, 8 by default and set in Order Settings. The header counts against it
(`ON THE GRILL 03/08`), turns orange and reads `FULL` at the limit, and the Grill action is
unavailable while full. Aiming at it does not silently do nothing: the target **refuses visibly** —
it turns red, swaps its flame for a no-entry icon, reads "Full", gives a small shake, buzzes a short
double pulse, and the ticket itself gets a red ring and stops short instead of sliding toward it. Lowering
the capacity below the number already on the grill never removes anything; the action just stays
unavailable until the count drops back.
Board sections are no longer drop zones; parked sessions still drag to the sidebar's
Cash / Transfer / Delete zones exactly as before.

### Editing a ticket
Swipe left opens the order as a parked session labelled with its **order number**. The order stays
in its own section on the board, ringed in purple and badged `EDITING`, and is frozen — it cannot
be moved until the edit is committed or cancelled.

The ring is drawn *inside* the ticket and inside the parked card, so it never bleeds into
neighbouring tickets. In the collapsed parked strip an edit session shows a slowly pulsing pencil
instead of its letter. (Trade-off: you can see *that* something is being edited but not which
order, until you expand the sidebar.)

- **Save · Cash / Save · Transfer** writes back onto the same order: same id, same order number,
  no counter increment. Stock is adjusted by the **difference**, so items removed during an edit
  are returned to inventory. Reprints marked `*** EDITED ***` if auto-print is on.
- **Cancel edit** (or dropping the session on the sidebar's Delete zone) discards the changes and
  never deletes the underlying order.
- "Being edited" is derived from the session that claims the order, so the two can't drift apart,
  and an edit survives a restart.

### Renumbering on delete
Orders now carry a `seq` field separate from `id`. Deleting an order resequences **every** order
1..N by creation time and rolls the counter back, so numbers never leave gaps. `id` is immutable —
it is the `order_items` foreign key and the analytics grouping key, and renumbering it would
corrupt line items.

Session numbering no longer does arithmetic on ids. A session records the timestamp it started;
orders created since then are numbered by position, which survives both deletion and renumbering.

### Totals breakdown, discount and tax
A compact breakdown sits above the big total, showing only the lines that apply:

```
Subtotal        Rs 1,150
Discount  10%   − Rs 115
Tax       13%   + Rs 135
TOTAL           Rs 1,170
```

The discount field sits to the left of the change calculator.

- `100` → Rs 100 off · `%5` (or `5%`) → 5% off · the field itself just shows `–`
- The unconfirmed value previews in the breakdown as *"Discount — press ✓ to apply"* rather than
  floating under the box, and bad input names itself in the field's own label (`Max 100%`).
  Nothing applies until you press the green check or Enter.
- Once applied it collapses to a chip showing the resolved amount, with an × to clear.
- Stored on the parked session, so it survives parking and switching, and is copied onto the order
  at checkout. Parked cards show the real total, discount and tax included.
- **Settings → Order Settings → Require PIN for Discounts** (default off) gates applying a
  discount behind the revenue PIN.

**Tax** is a toggle plus a rate in Order Settings. It is charged on the already-discounted
amount, gets its own line on screen and on the printed ticket, and the rate is snapshotted onto
each order so historical orders keep the rate they were sold at. Analytics revenue includes tax,
matching what the drawer actually holds.

### Settings, reorganised
Settings now has three tabs. **Order Settings** collects everything about how an order is priced and
moved: grill capacity, tap-to-expand parked tickets, sales tax, and the discount PIN. **Program
Settings** keeps the machine-level things: theme, fullscreen, printer, sync, credentials and PIN.

### Smaller fixes
- **Light mode now works.** The theme lives in a `.light` class on `<html>`, and nothing ever added
  it — only the inline background colour changed, so every CSS variable stayed on its dark value.
  The class is applied properly and the choice is remembered between restarts, as are the grill
  capacity and the tap-to-expand setting (which were also not being saved).
- **The edit pencil floats** gently up and down in the collapsed parked strip — a mirrored y drift
  rather than a scale pulse, which read as stiff at any speed.
- **Dragging a parked ticket now has a middle.** The drag chip grows out of the card it came from —
  starting as an outline of the card and springing down into the chip — while the card itself
  recedes, instead of the chip simply appearing at the pointer. Edit sessions drag with a pencil.
- **No more flashing between states.** Two separate causes. Navigating between views cross-faded two
  full-screen pages, so for 150ms both sat at partial opacity and the page background showed through
  — views now swap instantly. And closing the action menu faded the ticket copy out along with the
  backdrop while the real ticket was still hidden, leaving a gap where neither was on screen; the
  backdrop is now its own layer, so the copy stays solid right up to the frame the real ticket
  returns.
- **Notes before any item** — typing a note now creates the session if none exists, instead of
  silently discarding the keystrokes.
- **Deal quantities** — a 2× deal containing 2 burgers now shows `4x Burger`, on the ticket, in the
  cart, in the parked sidebar and on the printed ticket. (Stock deduction was already correct, so
  display and inventory finally agree.)
- `pnpm-workspace.yaml` had `onlyBuiltDependencies` as a space-separated string where pnpm expects
  a list, which made `pnpm install` fail outright. Converted to a list.

---

# Inventory rehaul

`src/app/inventory/*`, `src/app/lib/inventory.ts`

Inventory is now a **top-level screen with its own home tile**, not a tab inside Analytics. The
Analytics tab that used to hold it is a link across to the new screen. The tile carries a pulsing
`N low` badge so you can see from the home screen that something needs reordering.

Three tabs: **Add Stock**, **Assign Stock**, **History**.

## Add Stock

The grid of stock tiles is the screen. Tapping a tile opens the **quick add panel** in place: one
big number field, one unit, one **Add** button, and a live `100 pcs → 150 pcs` preview underneath
so the result is visible before committing. A segmented **Packets / Amount** switch changes what the
number means rather than adding a second button — the wireframe's two add buttons are one.

- **Recent activity** sits under the field with **Undo last**, so a mistyped delivery is one tap to
  reverse. Undo reverses the amount *and* deletes the ledger line, rather than logging a correction.
- A **switch to** row along the bottom jumps to another item without going back to the grid — the
  common case is receiving several things at once.
- Subtract is **not** here. It lives in the item editor as a minus button, since it is rare.

Right rail: a three-cell strip (**stock value / items / running low**), the **Total stock** list
(hovering a tile highlights its row, and additions float a `+N` off it), and **Product estimate**.

**Product estimate** answers "how many burgers can I make right now". Expanding one names the
bottleneck — `Held back by Beef — 6 kg left.` — and suggests the top-up that would actually move the
number: `Add 4 kg to reach 100`, derived from the *second* tightest ingredient, because topping up
past that point buys nothing.

## Manage stock and the item editor

`Manage stock` opens the same grid in edit mode; a dashed **New item** tile also sits at the end of
the main grid. The editor has name, amount + unit, low-stock threshold, cost per unit, and an icon
picker over a **44-icon library** (buns, patties, cheese, taco shells, veg, drinks, sauce, etc.,
including six drawn for this app). Typing a name **suggests an icon by itself**.

- Amounts are held in a base unit (`pcs` / `g` / `ml`) and displayed back in the friendly one, so
  `6 kg` in and `6 kg` out while the maths stays in grams.
- **Subtract amount** is a minus button that asks *why* — waste, correction or stock-take — so the
  ledger stays honest.
- The threshold field states its unit and resolves it live (`In g — warns at 1 kg`). Without that it
  silently read `500` as 500 kg while the amount field was set to kg, which is how it was found.

## Packets

One packet per item, as intended: `1 Packet = 50 pcs`. Adding one opens a sheet of stock tiles, and
**picking a tile expands it in place to reveal the quantity input** rather than moving to a second
step. Removing packets is a **delete mode** — each row grows an X — instead of a per-row bin that is
easy to hit by accident.

## Assign Stock

What one of a menu item consumes. Deals are excluded, since a deal's requirement is the sum of its
contents and is computed by flattening. While editing, the panel shows **how many can be made** and
**what limits it**, live, before saving.

## History

Every movement, insert-only, filterable by item: additions, packets, sales (`Used by order ·
Order #01`), returns, waste, corrections and stock-takes. Manual additions can be undone from here.

## Reorder list

Items under threshold produce a printable list, rounded up to whole packets where a packet is
defined, reachable from the header when anything is low.

Each row can also carry a **"about N days left"** figure. It is measured, not guessed:

1. Read the stock ledger for that item over the last **7 days**.
2. Keep only movements that represent stock actually *leaving* — `sold` and `waste`. Additions,
   corrections and stock-takes are ignored, or restocking would read as consumption.
3. Add up what left, and divide by the time from the **earliest of those movements to now** — not by
   a flat seven days. A shop that has been open two days is not averaged across a week and made to
   look idle. That span is floored at half a day, so one busy hour cannot imply an absurd daily rate.
4. `days left = current stock ÷ that rate`.

The figure is only shown when the ledger can support it: at least **two** consuming movements spread
over at least **half a day** of real time. Below that the row says `under its threshold` instead of
inventing a forecast — which is what a fresh install or an afternoon of testing will show. Hovering a
row spells out the working: how many movements, over how long, and the resulting per-day rate.

The same rate sets how much to buy: enough to clear the threshold *and* cover the next two days.
Without a reliable rate it falls back to the threshold alone.

## Motion

Every action reports back: numbers roll rather than jump, tiles spring in and out, the low-stock
border breathes, the changed row pulses and floats its delta, buttons compress on tap, and the
add/undo pair confirms in place.

---

# Display scale and stock warnings at the till

## Display scale

`src/styles/index.css`, Settings → Program Settings

The whole interface is now sized by a single `--ui-scale` variable, applied as CSS `zoom` on
`<html>`, and it defaults to **112%**. Everything grows together — type, padding, buttons, icons —
so touch targets get larger without any control being re-tuned by hand. `zoom` participates in
layout (unlike `transform: scale`), so panels still reflow and text still wraps at the new size.

**Display Scale** in Program Settings offers Compact (100%), Default (112%), Large (125%) and
Largest (140%), applied instantly and remembered.

> The one trap: viewport units ignore zoom, so `100vh` under a 1.12 zoom paints 112% of the screen
> and pushes the bottom of the app off-view. Every viewport-relative size therefore divides the
> scale back out, via the `screen-h`, `screen-w` and `sheet-max-h` utilities. Use those instead of
> `h-screen` / `w-screen` / `max-h-[80vh]` in new code.

## Low stock, in Order Mode

A strip above the category tabs names what is running out — `Running low · Buns 2 pcs` — and links
straight to the inventory screen. It is dismissible, but the dismissal is keyed to *which* items are
low rather than to a moment in time, so acknowledging "buns are low" does not also silence beef going
low ten minutes later. Once everything is stocked again the acknowledgement resets.

## Out of stock, at the point of sale

Menu tiles for anything the kitchen cannot currently make are outlined in red and labelled
**OUT OF STOCK**, so it reads before it is tapped. Tapping one asks rather than silently adding:

> **Burger is out of stock** — Buns has 0 pcs left, one needs 1 pcs.
> [ Cancel ] [ Add anyway ]

It never refuses. The shelf count can be wrong and a sale should not be blocked by bookkeeping — but
it names the ingredient that ran out, lists the others if more than one is short, and says that
adding anyway still deducts the stock.

Crucially the check runs against **stock minus what is already in the cart**, not against the shelf.
Ringing up the last two burgers is silent; the third one asks. Enter confirms, Escape cancels.

---

# Analytics rehaul (phases 1–4)

`src/app/analytics/*`

`SelfServiceInsights.tsx` is gone. Analytics is now a service layer with a UI on top, rather than
1,285 lines of component doing both.

## The engine

`analytics/metrics.ts` and `analytics/filters.ts` contain every calculation. No React, no formatting
decisions — facts derived from stored records, covered by 24 headless assertions. Two rules run
through all of it:

- **Voided orders are not revenue.** They are counted, and excluded from every money figure.
- **Missing cost is not zero cost.** A line with no cost snapshot was never costed; treating it as
  free would report a 100% margin. Those lines are excluded from *both* sides of the margin, and the
  coverage percentage is shown on screen. With no costs at all, margin reads "Needs cost data"
  rather than 0%.

Tax is excluded from revenue, as you chose — it is collected for the state. `Collected` is kept
alongside it for reconciling the till.

## Overview

Eight KPI cards, each with its comparison against the previous equal-length period and a definition
you can open. Above them, a data-quality strip that says plainly what cannot currently be computed
and why. Beside the revenue chart, a **Kitchen** panel: median and 90th-percentile time to ready,
median time on the grill, peak orders per hour, trading hours, and orders per trading hour.

Charts omit periods with no trading rather than drawing them as zero — for an event-driven business,
a padded chart reads as a collapse when it means "there was no market that week".

## Sales

Gross, discounts, tax and collected; payment mix; sales by hour of day across every day that traded;
items by revenue and by units; categories by share. Deals hold the money and their components hold
the units, so "how many burgers went out" includes the ones inside deals without double-counting
revenue.

## Orders Explorer

A filter tree, not a row of dropdowns: conditions over 20 fields, `ALL of`/`ANY of` groups nested two
deep, and a plain-English readback (`(Contains item is Coke or Total paid is at least 1800)`).
Filters are data, so they save as searches and can be reused. Clicking a row opens the order with its
line costs, money breakdown and stage timeline.

## Export

Two workbooks written to an `exports/` folder beside the database:

- **Data** — Orders, Order_Items, Payments, Inventory_Movements, Inventory_Snapshot, Items, Deals,
  Stock_Items, Recipes, Oversells. One row per record, filters on, headers frozen, nothing merged.
  Money is numeric; an unknown cost is an empty cell, never a zero.
- **Summary** — README with definitions and caveats, KPIs, item and category performance, the hourly
  pattern, stock position with hours left, the reorder list, and an oversell summary.

## Demand rate: per trading hour

The reorder list no longer talks in days. Consumption is measured **per hour in which something
actually sold**, and the forecast reads `about 4.2 hours of trading at 20 pcs/hr`.

The reason is the shape of the business. A per-day rate divides real consumption by the dead days
between events, so the fastest-moving item in the van looks like it lasts a month. Dividing by
*elapsed* hours has the same flaw. Only hours that traded go in the denominator, so two market days a
fortnight apart give the same rate as two consecutive ones — and "hours left" means hours of service,
which is the thing that has to be planned for.

A rate still needs at least two consuming movements across at least three distinct trading hours
before any figure is published; below that the row says `under its threshold`.

---

# Interface pass — one bar, bigger targets

## The permanent bar absorbs each screen's tabs

Inventory and Analytics used to stack their own tab row *underneath* the app bar. That cost a second
line of chrome on every screen and made the bar above look like something unrelated to the page. Both
now portal their tabs into the permanent bar via `NavSlot`, so the top of the app is one continuous
strip whatever screen you are on — and each screen keeps its tab state next to the thing it controls.

The bar's icons were redrawn to match: a chevron for back, a basket or receipt for the other board,
and a grid for home, which is what the home screen actually is.

Analytics' eight date presets collapsed into **one picker**. As buttons they wrapped onto a second
line and undid the whole point of moving the tabs up.

## Scale

Inventory and Analytics were sized for a mouse. Everything is bigger: tabs and buttons are 46–52px
tall, stock tiles are 146px with 24px icons, form controls are 42–46px, and body text moved from
11–13px to 13–16px. Ghost buttons and menu tiles now **light up on hover** rather than doing nothing
until clicked.

## Save sits with the thing it saves

The Save button on a recipe was in the far-right corner of the header, which reads as a different
section — the eye has already moved past it. It now sits on the same row as *Assign new stock item*,
directly under the rows it commits, and confirms in place with a tick.

## Manage stock is visibly a different mode

It was the same grid with different behaviour, which is a good way to edit the wrong thing. It now
has a purple frame and tint, a purple back button, and a subtitle saying what it is for. The back
button itself grew across every inventory sub-screen: a labelled **← Back** in the screen's own
colour, on a tinted rule, rather than a bare arrow glyph.

A screen on its way out is now `pointer-events: none`, so a fast tap during the transition lands on
the screen arriving rather than the one leaving.

## Packets carry a price

Defining a packet now asks what it costs — `1 packet = 24 pcs, costs Rs 480` — and shows the implied
`Rs 20.00 per pcs`. Receiving packets then fills the lot cost in for you, and the field says *"From
the packet price — type over it to override"*. The per-lot field stays exactly as it was for the
delivery that came in at a different price.

## The revenue PIN

A text input and an Unlock button became a **keypad**. Dots fill as digits are entered, a wrong code
shakes and clears itself with *"Not that one"*, and the right one turns the panel green before
closing. The locked screen now says what is behind the lock and what stays available, rather than
showing a lone button in an empty page.

> The bug this exposed: the pad judged the code in an effect whose cleanup cancelled the very
> timeout that completed the unlock, because setting the result state re-ran the effect. The timer
> lives in a ref now.

## Analytics feedback

Tab bodies spring in and out along the y-axis instead of cross-fading, the range picker's chevron
rotates, KPI values roll, and bars grow from zero on a stagger.

## Database

`DB_VERSION` is now `4`. Migrations in `src-tauri/src/lib.rs` are additive `ALTER TABLE`s guarded by
a `PRAGMA table_info` check, so existing installs upgrade in place and the migration is safe to
re-run:

- `orders` → `seq`, `subtotal`, `discount_kind`, `discount_value`, `discount_amount`, `edited_at`,
  `tax_rate`, `tax_amount`
- `parked_sessions` → `discount_kind`, `discount_value`, `editing_order_id`
- `stock_items` → `packet_size`, `packet_label`, `icon_id`
- `stock_movements` → new table (`CREATE TABLE IF NOT EXISTS`), the append-only stock ledger

Existing rows are backfilled: `seq` assigned in timestamp order, `order_number` rewritten to match,
`subtotal` seeded from `total`. Sessions anchored to the old numeric order base are migrated to the
new timestamp anchor on first load.

> Renumbering rewrites every `orders` row on each delete, so the cloudsync change tracker sees N row
> updates instead of one deletion. Functionally fine, just noisier syncs.

## Verification

- `pnpm build` clean.
- **162 browser tests** against the production build, all passing: 67 ticket/order, 23 inventory,
  15 scale and till warnings, 18 data-foundation, 19 analytics, 20 interface.
- Interface coverage asserts the structure rather than the pixels: that exactly one nav slot exists
  and both screens' tabs are inside it, that the bar stays a single row, that tabs and back buttons
  clear 44px, that manage stock renders in its own colour, that a packet price reaches the cost per
  unit through a receipt, that a wrong PIN clears and a right one closes the pad, and that Save
  shares a row with the rows it saves.
- The analytics engine has **24 headless assertions** of its own: tax excluded from revenue,
  discounts deducted, voids earning nothing, uncosted lines not inflating margin, deals crediting
  components with units but not money, empty periods omitted from charts, throughput measured only
  where stamped, and the filter language across numeric, OR, nested and negated conditions.
- The inventory maths (`src/app/lib/inventory.ts`) has **23 headless assertions**: unit roll-up,
  deal flattening, self-reference guards, the bottleneck estimate, the second-smallest-ratio top-up
  suggestion (including the worked example from the wireframe), and the consumption rate — that a
  minute of sales is not published as a daily rate, that a single sale is not a trend, and that
  restocking is not counted as consumption.
- Scale and till coverage: the zoom is applied and a full-height screen still fits inside the
  viewport at that zoom; picking a larger scale takes effect immediately; the low-stock strip appears
  in Order Mode, names the item and its remaining amount, and dismisses; two burgers add silently
  against two buns while the tile already reads sold out; the third opens the prompt without touching
  the cart; cancel leaves the cart alone; "add anyway" goes through; and the oversold order still
  deducts what it used.
- Inventory browser coverage: home tile → screen, tab switching, icon suggested from a typed name,
  item creation, `kg` in stored as grams and shown back as `kg`, the quick-add preview, adding,
  recent activity, undo, packets (add-sheet revealing the quantity input in place, and the packet
  listed), deals excluded from assign, live "makes N" and `LIMITED BY` while editing, the tile
  estimate after saving, the bottleneck line and top-up suggestion, selling a burger consuming its
  ingredients, the ledger recording `Used by order · Order #01`, a subtract tripping `1 low ·
  reorder`, and the reorder sheet rounding to whole packets.
- The other 67 tests cover: notes before items, deal totals, discount
  preview / apply / invalid input, press-to-open, arming, all four gestures, tap-to-open and
  tap-to-commit, disabled targets, escape dismiss, edit open / save / cancel, ticket freezing,
  renumbering after deleting a middle order, tax maths (including tax charged on the discounted
  amount), the totals breakdown, that the discount chip and editing rings stay inside their boxes,
  release-to-act (including that releasing with nothing lit closes without acting), the Preparing
  slot replacing a ticket's own section, grill capacity blocking and its header, and that light mode
  actually swaps the theme variables, the sticky grill collapsing and restoring on scroll, the
  refusal state on a full grill, and pixel probes confirming a ticket is painted at its position on
  every frame of the menu's open/close cycle. The collapse rule is tested by growing the board one
  order at a time and, at each size, scrolling to the bottom and checking that both the collapsed
  state and the scroll position settle rather than flip-flopping.
- The SQLite migration was run against a synthetic pre-migration database (twice, to prove
  idempotence): columns added, `seq` backfilled 1..N in creation order, `subtotal` seeded.

Bugs found and fixed during those passes: `AnimatePresence` wrapping a portal rendered no overlay
at all; the overlay lingered invisibly after closing and swallowed the next press; an inset
ring on the board ticket was painted over by the ticket's own SVG, so it is now drawn as an
overlay element instead; and the low-stock threshold field silently converted its number with the
*amount* field's unit selector without saying so, so `500` grams became 500 kg.

The Rust code could not be fully compiled here — `src-tauri/.cargo/config.toml` targets
`x86_64-pc-windows-msvc`, which this Linux sandbox cannot link — so please run `pnpm tauri:build`
on the Windows machine to confirm.

## Known limitation

`SelfServiceInsights` attributes revenue per menu item at gross line price. Order-level revenue now
nets off discounts and adds tax, so those per-item figures will not reconcile exactly with order
totals once either is in play. Adding "discounts given" and "tax collected" stats to the overview is
probably better than pro-rating both across items, but that's a call to make.

Also: the inventory icon library is curated, not uploadable. User-supplied icons need a place to put
the file and a way to carry it into the SQLite row (base64 in `icon_id`, or a path plus an assets
folder) — worth deciding before building, so it is left out of this round.

Selling is never blocked by stock — an item whose estimate is `0` warns and then goes through if
confirmed. Stock is clamped at zero rather than allowed to go negative, so an oversold item reads
`0 pcs` rather than `-1 pcs`. The ledger still records the full deduction, so the two disagree by the
oversold amount until a stock-take reconciles them. Allowing negative stock would make the
discrepancy visible on the shelf figure itself, but every screen that formats a quantity would need
to handle it.

---

# Second pass — the 27-item list

## Performance

**The home screen was dropping frames.** Median frame time on hover was 50 ms
against a 16.7 ms budget. Three things were being animated that a compositor
cannot animate: a `background` gradient *string*, a `filter: drop-shadow()`, and
a blur radius. Each one forces a repaint of the whole tile every frame. The
tiles now paint both states up front — resting and lit — as two stacked layers,
and hover cross-fades their `opacity`. Re-measured: **16.7 ms median, zero
frames over budget.**

## Navigation

**Tab changes are now steps you can go back through.** Switching from Overview
to Sales to Costs and pressing back three times used to leave Analytics
entirely on the first press. `useTabStep` records the tab you left as a step
owned by the screen, so back walks Costs → Sales → Overview → Analytics.

**Returning to a section returns to where you were.** Analytics, Inventory and
Settings keep their tab and scope in `lib/screenState.ts` for the life of the
session, so leaving to check an order and coming back does not reset the screen.

**The section cross-fade no longer eats the navbar tabs.** Two screens are
mounted at once during the transition, and both were portalling their tabs into
the same element found by `document.getElementById`. It is a React context now,
so the outgoing screen's tabs cannot claim the incoming screen's slot.

## Money

**Edited orders were falling out of their session.** `commitEdit` rebuilt the
order without `sessionId` or `sessionTicket`, so an order edited during a
session silently stopped counting towards that session's revenue — the money was
in the lifetime totals and missing from the night's. Both fields now survive an
edit.

> **This one needs a decision from you.** Orders edited *before* this fix have
> already lost their session id. It cannot be recovered without inferring
> membership from timestamps, and this program deliberately refuses to do that:
> a session is paused overnight and resumed in the morning, so a timestamp range
> sweeps up the whole night in between. If some past session's revenue looks
> light, that is why, and the honest fix is to correct those orders by hand.

**Stock bought before the session can be counted against it.** Food cost was
already right — opening inventory covers stock bought earlier — but the *outlay*
was not shown anywhere. A toggle beside the scope picker folds purchases made
since the previous session ended into fixed costs, so break-even reflects money
actually spent on this market rather than only what was bought during it.

**Break-even now says which items, not just how many.** It used to forecast a
single number of units. `breakEvenByItem` works it out per menu item — how many
of *this* must sell, what each contributes, how many have gone so far — and the
panel is a carousel you swipe or step through, one item at a time.

## Analytics, split along the seam you named

Overview is now today's operation: tickets, times on the grill, throughput,
what is moving. Sales is the money: revenue, margin, break-even, costs. Nothing
was deleted — the money metrics moved out of Overview and into Sales, where a
person looking for a number about money now has one place to look.

The revenue chart gained Hour / By day / Event, so a three-day market reads as
three bars instead of seventy-two.

## Inventory — first pass, for you to react to

You asked for a first pass on Add Stock, Assign Stock and Manage Stock rather
than a finished redesign, so this is deliberately reversible.

**The three screens now share one frame.** Every one has the same header — a
mark in the section colour, a title, a line of plain English, and its actions on
the right. Add Stock had no header at all: it opened on a bare row of controls,
the only screen in the section without a title, while its own sub-screens all
had one. Its search field and the three doors out of it (Packets, Stock take,
Manage stock) now sit in that header, with a rule between the field that filters
this screen and the buttons that leave it.

**Manage stock is orange.** It was violet — `#A855F7`, hard-coded — which made
the one screen in an orange section that looked like it had been borrowed from
another program. The frame, the icon and the Add new tile all take the section's
colour now. This is the same complaint as amber in a purple Analytics, one
screen further in.

**Emptying looks like emptying.** Turning on Drain turns the frame, the heading
and every tile that still holds something red, swaps the subtitle for what the
mode does, and takes both New item and the Add new tile off the screen — a
mode whose every tap destroys something should not also be offering an inviting
amber button.

**Assign Stock stopped being a different screen.** Its tiles were narrower and
shorter than the shelf tiles one tab across and lit **amber** on hover, a colour
belonging to no section. Same column width, same tile height, same lit-in-place
hover as the stock grid.

**The assign editor gets the room it needs.** Opening one menu item used to make
three columns — the rows, its own consequence panel, and the shelf sidebar — on
a screen that needs two. The sidebar stands down while the editor is open. The
rows are capped in width so the delete button sits beside the field it deletes
rather than a hand's width away, and the last bare `<input>` in the section is
now the shared field, so a row no longer steps up and down in height as the eye
crosses it.

## Menus and settings

Deals are a built-in category: adopted if one already exists, created if not,
marked **Built in**, and not deletable — deleting it used to orphan every deal.
A deal's price is set by you and no longer silently recomputed on save, with
"Components total Rs X — use it" there when you want the arithmetic.

Categories reorder by passing rather than by dropping: rows displace live as you
drag, so where the row will land is visible before you let go.

Menu item prices are always editable, and cost per unit accepts an override with
"auto" shown as the placeholder when it is deriving the figure itself.

## Stock entry

A packet is priced when it is created. The Add Packet sheet did collect a cost,
but as an easy-to-miss inline field that was not required, so packets routinely
existed without one and every figure derived from them was wrong. Defining a
packet — label, size, cost — is now part of creating the item, with the
per-unit figure shown as you type.

The stock editor opens blank rather than pre-filled with zeroes, and cost can be
entered either way round: type what the lot cost and it derives the unit price,
or type the unit price and leave the lot alone.

Drained stock counts as waste in shrinkage rather than vanishing.

## Text fields capitalise themselves

Every ordinary text field lifts its first letter as you type, caret held where
you left it. Only the first character, and only upward, so "iPhone case" and
"pack of 6" survive. Passwords, usernames, search boxes and anything numeric opt
out — the login field capitalising a username is a rejected sign-in, which is
exactly what happened the first time this shipped.

*(The mechanism is worth knowing about if you touch `TextInput`: the props
spread has to come **before** the handlers on the `<input>`, not after. Spread
last, a caller's own `onChange` silently replaces the component's — which is
why this feature appeared to do nothing on every field that had one.)*
