# Plans

The long-range plans for this project. **These are historical.** They record what
was decided and when, including things that were later changed.

> **Where a plan file and a phase document disagree, the phase document wins.**
> The plan is what was intended; the phase document is what was built, written by
> the session that built it after reading the code. Editing a plan retroactively
> to match what happened is the same mistake as editing an ADR — it destroys the
> record of the decision.

Where something changed materially, a **v2** plan supersedes rather than
overwrites, and says at the top what changed and why.

---

| File | What it is |
|---|---|
| `V1-PERSONAL.md` | The personal build, whole — foundations through the visual pass. Written before Phase 0. |
| `V2-COMMERCIAL.md` | The commercial build, whole — accounts, sync, web and phone, payments, foodpanda, packaging. Chronologically after V1. |
| `PHASE-1.md` | The analytics rebuild, split into 1A–1E. Written after Phase 0's report. |
| `PHASE-1C.md` | The current phase, revised after 1C-i. Absorbs what was planned as 1D, and inserts 1C-ii after finding the event model could not represent a single-day market. |
| `PLANNING-CONTINUITY.md` | How this project survives its planner being replaced. The reason `ROADMAP.md`, `OPEN.md` and `PLANNING-BRIEF.md` exist. |

## Known divergences

Recorded here rather than by editing the plans.

Checked against the tree at `d969b9b` by the docs-scaffold session. Three of the
five originally listed here were not divergences at all — the plans already said
what was built — and have been removed rather than left to send a reader looking
for a disagreement that is not there. What they claimed, and why each was wrong,
is under *Claimed and withdrawn* below.

- **`PHASE-1.md` describes a Phase 1D** (history and the money ledger, its D1–D3).
  It was absorbed into 1C — see `PHASE-1C.md`'s *Resequenced* table. The number is
  not reused.
- **`V1-PERSONAL.md`'s Phase 4.1** placed the removal of the menu cost override
  in the menu-settings phase. It moved to 1A-ii (ADR-015), because it is a
  cost-model change rather than a UI tidy-up.
- **`PHASE-1.md` plans 1C as "the three tables"** — a single sub-phase, C1–C6,
  needing 1A and 1B. What was built is a four-tab shell (1C-i) with events
  inserted before the tables (1C-ii). `PHASE-1C.md` records the resequencing;
  `PHASE-1.md` does not, and its sub-phase table still reads as if 1C were one
  piece of work.
- **`PHASE-1C.md` plans 1C-ii as one sub-phase**, E1–E8. It was split: 1C-ii-a
  built the model and the manager (E1–E4, E8), and E5 (`ScopePicker` shows the
  containment), E6 (the cost form names its target) and E7 (costs target items)
  were carried to 1C-ii-b. The plan has no 1C-ii-a/1C-ii-b distinction anywhere.
- **`PHASE-1C.md` asks 1C-ii to delete `HINT.costFixed` / `HINT.costVariable`**
  under *Carried forward, still open*. 1C-ii-a did not, and did not say why. They
  are still at `src/app/ui/hints.ts:90`–`:91`, still describing the pre-ADR-012
  model, still unreferenced. Registered in `../OPEN.md`.

### Claimed and withdrawn

Kept so the list is not silently shorter, and so nobody re-adds them.

- ~~*`PHASE-1.md`'s 1.8 proposed consolidating all history into Analytics.*~~
  It did not. `PHASE-1.md` has no section 1.8; its D1 is headed **"All Orders
  stays where it is"**, and `V1-PERSONAL.md`'s 1.8 — the only 1.8 in the plans —
  opens with the same sentence. Both plans already say only stock history moves.
- ~~*`V1-PERSONAL.md` assumes sync is unused in the personal build.*~~ It assumes
  the opposite. Line 205: *"Since sync is actually in use, this is a live bug
  rather than a V2 note"*, and its 0.6 is what asked for the three-table fix that
  Phase 0 delivered.
- ~~*Both plan files say `PosV3`, and one says `main`.*~~ No plan file contains
  the string `PosV3`. `main` appears once, in `PLANNING-CONTINUITY.md:57`, where
  it is already recorded as a **briefing** error the planner made about itself —
  not a plan asserting the wrong branch. (The baseline *commit* `744e457` is
  titled "PosV3 as received", which is probably what this was remembering.)
