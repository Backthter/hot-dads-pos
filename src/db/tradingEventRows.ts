import type { TradingEvent } from '../app/types';

/**
 * The translation between a `trading_events` row and a `TradingEvent`, on its
 * own.
 *
 * It sits outside `persistence.ts` for the same reason `costEntryRows.ts` does:
 * `persistence.ts` opens a SQLite handle at import time, so nothing that runs
 * without Tauri can touch it, and a mapping that can be run under `tsx` is a
 * mapping `metrics.check.ts` can hold to its word. The SQL around it still
 * needs a device.
 *
 * The failure this guards against has already happened once in this codebase,
 * to `CostEntry.eventId`: the field existed on the type, the write side never
 * learned about the column, and every event-level cost was silently lost on
 * reload while the type went on claiming it was there. Phase 1C-ii-a adds three
 * columns to this table at once, so both directions live here together — they
 * are one statement, the columns an event is stored in, and splitting them
 * across two files is exactly how the write side gains a column the read side
 * never hears about.
 *
 * Note what is *not* here: there is no `status` column, because status is
 * derived from the sessions by `eventStatus`. See `TradingEvent`.
 */

/** A stored timestamp, or nothing. Zero is not a plan; null and 0 both mean none. */
function optionalTime(raw: unknown): number | undefined {
  if (raw == null) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** A stored string, or nothing. Blank is not a venue. */
function optionalText(raw: unknown): string | undefined {
  if (raw == null) return undefined;
  const s = String(raw).trim();
  return s.length > 0 ? s : undefined;
}

export function tradingEventFromRow(r: Record<string, unknown>): TradingEvent {
  const plannedStart = optionalTime(r.planned_start);
  const plannedEnd = optionalTime(r.planned_end);
  return {
    id: String(r.id ?? ''),
    name: String(r.name ?? ''),
    ...(plannedStart !== undefined ? { plannedStart } : {}),
    ...(plannedEnd !== undefined ? { plannedEnd } : {}),
    ...(optionalText(r.venue) !== undefined ? { venue: optionalText(r.venue) } : {}),
    ...(optionalText(r.notes) !== undefined ? { notes: optionalText(r.notes) } : {}),
    createdAt: Number(r.created_at ?? 0),
  };
}

/**
 * The column list, in the order `tradingEventToRow` returns values.
 *
 * Every column is named in the `INSERT OR REPLACE`, including the ones that are
 * usually null. `INSERT OR REPLACE` replaces the whole row, so a column left
 * out of the statement is a column SQLite refills from its default on the next
 * save — which for a plan typed in on Thursday means it is gone by Friday, with
 * nothing to show that it ever existed.
 */
export const TRADING_EVENT_COLUMNS = [
  'id', 'name', 'planned_start', 'planned_end', 'venue', 'notes', 'created_at',
] as const;

export function tradingEventToRow(e: TradingEvent): (string | number | null)[] {
  return [
    e.id,
    e.name,
    e.plannedStart ?? null,
    e.plannedEnd ?? null,
    e.venue ?? null,
    e.notes ?? null,
    e.createdAt,
  ];
}
