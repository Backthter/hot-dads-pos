import type { CostAppliesTo, CostBasis, CostEntry, CostKind } from '../app/types';

/**
 * The translation between a `cost_entries` row and a `CostEntry`, on its own.
 *
 * It sits outside `persistence.ts` for one reason: `persistence.ts` opens a
 * SQLite handle at import time, so nothing that runs without Tauri can touch
 * it, and the round trip this file describes is exactly the part that was
 * broken — `eventId` had no column, was neither read nor written, and every
 * event-level cost was lost on reload while the type went on claiming it was
 * there. A mapping that can be run under `tsx` is a mapping `metrics.check.ts`
 * can hold to its word. The SQL around it still needs a device.
 *
 * Both directions live here together on purpose. They are one statement — the
 * columns a cost is stored in — and splitting them across two files is how the
 * write side gained a column the read side never learned about.
 */

const BASES: readonly CostBasis[] = [
  'per-session', 'per-event', 'per-order', 'per-unit', 'per-revenue',
];

/**
 * Reads a stored basis, falling back to `per-session` for anything unknown.
 *
 * Unknown is a real possibility rather than a defensive flourish: a device
 * running an older build writes rows this one has to read, and sync merges them
 * both ways. `per-session` is the safe landing because it is what the migration
 * gives every pre-existing row anyway — it treats the amount as money already
 * spent for one service, which is the reading that neither invents a rate nor
 * drops the cost from a figure.
 */
export function parseCostBasis(raw: unknown): CostBasis {
  return BASES.includes(raw as CostBasis) ? raw as CostBasis : 'per-session';
}

/** The pre-1A kind, when the row carries one. Blank and unknown both mean none. */
export function parseCostKind(raw: unknown): CostKind | undefined {
  if (raw === 'fixed' || raw === 'variable') return raw;
  return undefined;
}

/**
 * Reads the stored target, or `undefined` for anything that is not one.
 *
 * Stored as JSON in one nullable column rather than as two — a kind column and
 * an ids column would be null on each other's rows, which is the every-row-has-
 * a-hole shape ADR-012 rejected for the amount and invariant 2 is about.
 *
 * Everything unrecognised reads as absent, and absent means "every item", which
 * is what a cost with no target has always meant and is the reading that cannot
 * silently shrink a figure. An older build writes rows this one has to read and
 * sync merges them both ways, so unknown is a real case and not a flourish.
 * An empty `ids` array is *not* absent — it resolves to nothing, deliberately —
 * so it is preserved rather than normalised away.
 */
export function parseCostAppliesTo(raw: unknown): CostAppliesTo | undefined {
  if (typeof raw !== 'string' || raw === '') return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== 'object') return undefined;
  const value = parsed as { kind?: unknown; ids?: unknown; id?: unknown };
  if (value.kind === 'items' && Array.isArray(value.ids)) {
    return { kind: 'items', ids: value.ids.filter(id => typeof id === 'string') as string[] };
  }
  if (value.kind === 'category' && typeof value.id === 'string' && value.id !== '') {
    return { kind: 'category', id: value.id };
  }
  return undefined;
}

export function costEntryFromRow(r: Record<string, unknown>): CostEntry {
  const eventId = r.event_id ? String(r.event_id) : undefined;
  const basis = parseCostBasis(r.basis);
  // A target only means anything on per-unit — on any other basis the amount is
  // divided by the period, the ticket or the rupee, and there is no item for it
  // to name (ADR-022). Dropped rather than fatal, for the same reason the
  // per-event demotion below is: loading must not throw.
  const appliesTo = basis === 'per-unit' ? parseCostAppliesTo(r.applies_to) : undefined;
  return {
    id: String(r.id ?? ''),
    sessionId: r.session_id ? String(r.session_id) : undefined,
    eventId,
    amount: Number(r.amount ?? 0),
    note: String(r.note ?? ''),
    // A per-event cost with no event is an amount attached to nothing, and the
    // screens that read it by event id would never find it again. Loading must
    // not throw — a shop with one malformed row still has to be able to open
    // its till — so the row is demoted to the basis it would have had before
    // the migration, which at least keeps it in the dated figures where it can
    // be seen and re-filed. Writes assert instead; see `assertCostEntry`.
    basis: basis === 'per-event' && !eventId ? 'per-session' : basis,
    ...(appliesTo ? { appliesTo } : {}),
    kind: parseCostKind(r.kind),
    timestamp: Number(r.timestamp ?? 0),
  };
}

/**
 * The values for the insert, in the column order below.
 *
 * `kind` is written back rather than skipped, and that is not an oversight.
 * `INSERT OR REPLACE` replaces the whole row, so leaving the column out of the
 * statement would let SQLite fill it with its default on every save — quietly
 * restating every historical 'variable' as 'fixed' the first time the app wrote
 * anything, which is the loss the column was retained to prevent. A row with no
 * pre-migration kind stores an empty string: nothing new is filed as a kind,
 * and a blank is how a row written since the migration stays distinguishable
 * from one written before it.
 */
export const COST_ENTRY_COLUMNS = [
  'id', 'session_id', 'event_id', 'amount', 'note', 'kind', 'basis', 'applies_to', 'timestamp',
] as const;

export function costEntryToRow(c: CostEntry): (string | number | null)[] {
  return [
    c.id,
    c.sessionId ?? null,
    c.eventId ?? null,
    c.amount,
    c.note,
    c.kind ?? '',
    c.basis,
    // Only written where it means something, so a row that was demoted on the
    // way in does not acquire a target on the way back out.
    c.appliesTo && c.basis === 'per-unit' ? JSON.stringify(c.appliesTo) : null,
    c.timestamp,
  ];
}
