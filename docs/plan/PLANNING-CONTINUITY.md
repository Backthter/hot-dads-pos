# Planning continuity

*How this project survives its planner being replaced.*

---

## The risk, stated plainly

The implementation sessions are already disposable by design. Each one clones,
reads `docs/`, does one phase, writes its findings back, and is never heard from
again. That works — 1C-ii-a caught a `note`/`notes` collision that would have
silently destroyed data, and it caught it by reading `types.ts`, not by
remembering anything.

The planning role is not disposable in the same way, and that is an accident
rather than a design. What lives only in a planning conversation right now:

- **The long-range plan.** `V1-PERSONAL.md`, `V2-COMMERCIAL.md`,
  `PHASE-1-PLAN.md`, `PHASE-1C-PLAN-v2.md` are files, but they are *outside the
  repository*. Nothing in the repo points at them.
- **Sequencing rationale.** Why 1B before 1C, why events before money, why the
  visual pass is last. Some is in the plan files; some was argued in chat and
  never written down.
- **The commercial frame.** Pricing structure, the Zoho positioning, why
  foodpanda is a Connected-tier feature. In `V2-COMMERCIAL.md`, outside the repo.
- **What was considered and rejected at the plan level** — as opposed to the
  code level, which is what ADRs capture.
- **Cross-phase pattern recognition.** Noticing that the same class of bug keeps
  appearing, or that a convention is about to collide with a future feature.

The last one is the only item that is genuinely hard to write down, and it is
also the one that degrades first as context fills.

## What degradation actually looks like

Not a cliff. The observable signs, in rough order of appearance:

1. **Restating settled decisions** — re-arguing something an ADR already closed.
2. **Vaguer prompts.** The prompts have been specific — file names, function
   names, ADR numbers, line-level references. When a prompt starts saying
   "update the analytics layer" instead of "`resolveCosts` in `metrics.ts`",
   that is the signal.
3. **Losing the out-of-scope discipline.** The out-of-scope list is what keeps
   each phase's diff readable. It is also the first thing to get shorter.
4. **Contradicting a phase report.** Specifying something that a previous report
   explicitly said was already done, or already decided otherwise.

**Your test:** does the new prompt cite specific files, functions and ADR
numbers? If it has gone generic, rotate the planner.

## Two errors already worth noting

Both from the 1C-ii-a brief, and both are the *right* kind of evidence:

- I specified `note?: string` when `TradingEvent` already carried
  `notes?: string`. The implementation session caught it by reading the type.
- I specified `main` in the bundle command when the default branch is `master`.

Neither came from context exhaustion — they came from planning against memory of
a codebase rather than against the codebase. That is the failure mode the
planning role has *by default*, and the mitigation is the same either way: the
plan is a proposal, the implementation session reads the code, and disagreements
get flagged rather than assumed. That has worked three times now.

---

## The mitigation, in five parts

### 1. Move the plan into the repository

```
docs/
  plan/
    ROADMAP.md              ← where we are, what's next (living)
    V1-PERSONAL.md          ← the personal build, whole
    V2-COMMERCIAL.md        ← the commercial build, whole
    PHASE-1.md              ← the analytics rebuild, whole
  OPEN.md                   ← the carry-forward register (living)
  PLANNING-BRIEF.md         ← what a fresh planner reads first
```

Once these are in the repo, a fresh planning session receives the same thing an
implementation session does: a clone, or a zip of `docs/`. Nothing lives in a
chat log.

### 2. `ROADMAP.md` — the living index

One page. Not a plan, an index of plans:

```markdown
# Where this is

**Now:** Phase 1C-ii-b — scope, costs, targeting
**Branch:** phase-1c-ii-b-costs, off master
**Checks:** 255 in metrics.check.ts

## Done
| Phase | What it settled | ADRs |
|---|---|---|
| 0 | domain hooks, the clock, sync tables | 001–011 |
| 1A | cost basis, non-circular break-even, one purchase rule | 012–015 |
| 1B | reversals are their own reason; effective vs levels | 016–017 |
| 1C-i | four tabs, per-tab lock, the explainer | 018–019 |
| 1C-ii-a | events are real, creatable ahead, never auto-deleted | 020–021 |

## Next
1C-ii-b → 1C-iii (money) → 1C-iv (things) → 1E (forecasting) → 2 (units) …

## Principle
Numbers true → numbers legible → shop floor → shell → look.
Do not reorder. A table built on a wrong figure gets built twice.
```

Updated at the end of every phase, by the implementation session, as one more
line in its report.

### 3. `OPEN.md` — one carry-forward register

Right now every phase document ends with a "still open" list, and by 1C-ii-a the
same five items have been restated six times. That is duplication waiting to
drift — one of them will get fixed and four documents will still say it is open.

One list instead. Each entry: what, why it was deferred, which phase should take
it, and what makes it urgent.

```markdown
## The export menu is outside the revenue lock
Found: 1C-i. A user with no revenue PIN can export a workbook containing
every figure the lock hides.
Deferred because: the export is Phase 6's, and 1C-i was structural.
Take it: Phase 6, first thing.
Urgent when: anyone but the owner uses the program. This is a V2 blocker.
```

Phase documents then say *"see OPEN.md"* rather than re-listing.

### 4. `PLANNING-BRIEF.md` — what a fresh planner reads first

`00-ARCHITECTURE.md` says what the code is. `01-DOMAIN.md` says what the words
mean. Neither says what the *project* is. That page needs to exist:

- **Who it is for.** A burger stall today; small food businesses and event
  stalls commercially. Its advantages are offline operation, minutes-not-projects
  setup, ingredient-level costing, and the stall model — not the feature list.
- **The two editions**, and that they are one codebase with a capability seam.
- **The commercial constraint**: a one-time fee cannot fund recurring hosting.
- **The ordering principle**, and why it is not negotiable.
- **How to write a prompt for this project**: read `docs/` first; cite files and
  functions; state what is out of scope and why; give the next ADR number;
  specify what checks can and cannot run in the sandbox; ask for the phase
  document in the established shape; end with the bundle commands.
- **The standing conventions** an implementation session is held to.

That last section is most of what I actually do. Written down, it is
transferable.

### 5. Rotate planning sessions per phase

Same discipline as implementation. A new planning chat per phase, handed:

- a zip of `docs/` (including `plan/`)
- the previous phase's report
- your own notes on what feels wrong in use

That is enough. It is demonstrably enough, because it is exactly what the
implementation sessions get, and they have been catching my errors with it.

---

## What is genuinely lost on rotation

Being honest about this rather than claiming the docs cover everything:

- **Judgement about what is worth doing.** The plan files record what was chosen;
  they record less about the twenty things not chosen because they were not worth
  the trouble. A fresh planner may re-propose them.
- **Feel for your priorities.** That the burger-specific work is real but small,
  that you would rather have a correct number than a pretty one, that scope
  creep is the risk you are most exposed to.
- **Noticing collisions early.** Convention 5 versus forecasting was caught
  because both were held in mind at once. A fresh planner sees convention 5 in
  `03-INVARIANTS.md` and the forecaster in the plan, so it is *recoverable* — but
  it is recoverable by reading carefully rather than by remembering.

The first two are worth about a paragraph each in `PLANNING-BRIEF.md`. Write
them yourself; they are your priorities, not mine.

---

## The handover, concretely

When you start the next planning session, give it:

1. `docs/` as a zip — including `plan/`, `OPEN.md`, `PLANNING-BRIEF.md`
2. The most recent phase report
3. One line: *"You are the planner for this project. Read
   `docs/PLANNING-BRIEF.md` first, then `docs/plan/ROADMAP.md`, then the phase
   documents in order. Then tell me what you think the next phase should be, and
   what you would change about the plan."*

If it comes back with something close to what is already in `ROADMAP.md`, the
handover worked. If it comes back with something wildly different, that is worth
reading before dismissing — a fresh reading of the same documents is the cheapest
review this project can get.

---

## What to do about it right now

The next implementation prompt should carry one extra task: **create
`docs/plan/`, `docs/OPEN.md` and `docs/ROADMAP.md`**, seeded from the plan files,
and add a line to the phase-document template pointing at `OPEN.md` instead of
re-listing.

That is maybe an hour of an implementation session's time and it converts the
planning role from a person into a document.
