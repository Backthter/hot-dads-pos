# Phase 0 — Foundations

**Status:** in progress.

## Goal

Put three things in place before any feature work continues.

First, a written record. The program has an unusual amount of reasoning encoded
in it — the ledger is append-only for a reason, costs are optional for a reason,
sessions store their membership for a reason — and almost all of that reasoning
lived only in doc comments next to the code it constrained. That is the right
place for it, but it means a person or an AI picking up a later phase has to
read the whole tree to discover which of their instincts would corrupt data.
`docs/` exists so that a later session with no memory of this one can make
correct decisions from a standing start.

Second, a live data-loss bug in sync, fixed as narrowly as it can be fixed.

Third, structural room. `App.tsx` owned every mutation in the program across
about 3,500 lines. Every later phase would have edited that one file.

Everything else is deferred by design: row versioning, the mutation log, the
`channel` field on orders, and any change to the cost model or break-even maths.

## What changed

*(written as each step lands)*

## Files touched

*(written as each step lands)*

## Invariants introduced

*(written as each step lands)*

## How to verify

*(written as each step lands)*

## What the next phase can now assume

*(written as each step lands)*
