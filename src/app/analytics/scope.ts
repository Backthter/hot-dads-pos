import { eventGroups, sessionTradingHours, spanOf, type EventGroup } from '../lib/sessions';
import {
  activeTradingHours, ordersInRange, previousRange, resolveRange, type DateRange,
  type RangePreset,
} from './metrics';
import type { CostEntry, Order, TradingEvent, TradingSession } from '../types';

/**
 * What the analytics screens are currently looking at.
 *
 * There used to be one control — a date range in the corner — and adding events
 * to it would have meant two filters that disagree: pick "Winter Market" and
 * "last 7 days" and the screen either shows nothing or quietly ignores one of
 * them. So scope is a single choice with three shapes, and only one is ever in
 * force.
 *
 * Dates still matter underneath. Stock movements and snapshots are timestamped
 * rather than session-stamped, so every scope resolves to a window as well —
 * for a session that window is simply the session's own span.
 */

export type Scope =
  | { kind: 'range'; preset: RangePreset }
  | { kind: 'event'; id: string }
  | { kind: 'session'; id: string };

export const DEFAULT_SCOPE: Scope = { kind: 'range', preset: 'last30' };

export interface ResolvedScope {
  scope: Scope;
  label: string;
  /** Second line for the picker — dates, session count, that sort of thing. */
  detail: string;
  /** Orders in scope, voids included. Every aggregate here excludes them itself. */
  orders: Order[];
  costs: CostEntry[];
  /** Sessions in scope. Empty for a pure date scope. */
  sessions: TradingSession[];
  /** The window to filter timestamped records by. */
  range: DateRange;
  /**
   * Hours actually traded.
   *
   * Session scopes use the session clock, which counts the quiet hours too — an
   * empty hour at a market is still an hour of standing there paying for the
   * pitch. Date scopes fall back to the hours in which something sold, since
   * there is nothing better to go on.
   */
  tradingHours: number;
  /** True when the figures come from session membership rather than timestamps. */
  sessionScoped: boolean;
  /** The comparable previous period: the prior session, event, or window. */
  previous: { label: string; orders: Order[] } | null;
  /**
   * The grouped event this scope resolves to, when it resolves to a real one.
   *
   * `undefined` for a lone session, which is *presented* as an event of one but
   * has no event id and therefore nothing a `per-event` cost could attach to.
   * This is the same value `costsOf` is given, said out loud so that the screens
   * can agree with what the resolver actually did.
   */
  eventId?: string;
  /** Whether a `per-event` cost has anywhere to go from here (ADR-018). */
  perEvent: PerEventAvailability;
}

/**
 * Whether the cost form may offer `per-event`, and what to say when it may not.
 *
 * See ADR-018. A `per-event` cost requires an event id, and there are two
 * scopes that cannot supply one: a lone session, which looks like an event of
 * one and is not, and a date window in a shop that has never grouped anything.
 * Offering the basis in either case produces an amount attached to nothing —
 * refused by the form at best, and invisible to every figure at worst.
 */
export interface PerEventAvailability {
  available: boolean;
  /** Plain-language reason, and what to do about it. Absent when available. */
  reason?: string;
}

const NO_EVENT_HERE =
  'This session is not part of an event yet. Group it with the other days of '
  + 'the market first, and a cost can then be charged once for all of them.';

const NO_EVENTS_AT_ALL =
  'You have no events yet. Group the days of a market together and a cost can '
  + 'then be charged once for the whole thing rather than to one of the days.';

export interface ScopeInput {
  orders: Order[];
  costs: CostEntry[];
  sessions: TradingSession[];
  events: TradingEvent[];
  now?: number;
}

/** Every scope the picker can offer, newest first, dates last. */
export function scopeOptions(sessions: TradingSession[], events: TradingEvent[]): {
  groups: EventGroup[];
} {
  return { groups: eventGroups(events, sessions) };
}

function ordersOf(orders: Order[], sessions: TradingSession[]): Order[] {
  const ids = new Set(sessions.map(s => s.id));
  return orders.filter(o => o.sessionId !== undefined && ids.has(o.sessionId));
}

/**
 * The costs belonging to a set of sessions, plus any attached to the event
 * containing them.
 *
 * An event-level cost — one pitch fee for a three-day market — has no session
 * of its own, so matching on session id alone silently dropped it out of every
 * figure it should have been in.
 */
function costsOf(
  costs: CostEntry[],
  sessions: TradingSession[],
  eventId?: string,
): CostEntry[] {
  const ids = new Set(sessions.map(s => s.id));
  return costs.filter(c => (
    (eventId !== undefined && c.eventId === eventId)
    || (c.sessionId !== undefined && ids.has(c.sessionId))
  ));
}

const dayLabel = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

export function resolveScope(scope: Scope, input: ScopeInput): ResolvedScope {
  const now = input.now ?? Date.now();
  const groups = eventGroups(input.events, input.sessions);

  if (scope.kind !== 'range') {
    const group = scope.kind === 'event'
      ? groups.find(g => g.id === scope.id)
      : groups.find(g => g.sessions.some(s => s.id === scope.id));
    const members = scope.kind === 'event'
      ? group?.sessions ?? []
      : input.sessions.filter(s => s.id === scope.id);

    if (members.length > 0) {
      // The one id a `per-event` cost can be filed against. A group that is not
      // `grouped` is a single session wearing an event's clothes: it has a
      // name and a span, and no event row behind it.
      const eventId = group?.grouped ? group.id : undefined;
      const span = spanOf(members, now)!;
      const range: DateRange = { start: span.start, end: span.end, label: group?.name ?? 'Session' };
      const tradingHours = members.reduce((sum, s) => sum + sessionTradingHours(s, now), 0);

      // The comparable period is the previous event or session, not the
      // preceding calendar window — markets are fortnightly, and "the 30 days
      // before this one" is mostly days nobody traded.
      const ordered = groups.filter(g => g.sessions.length > 0).sort((a, b) => a.startedAt - b.startedAt);
      const index = ordered.findIndex(g => g.id === (group?.id ?? ''));
      const prior = index > 0 ? ordered[index - 1] : null;

      const label = scope.kind === 'event'
        ? group?.name ?? 'Event'
        : members[0].name;
      const dates = members.length > 0
        ? `${dayLabel(span.start)}${dayLabel(span.start) === dayLabel(span.end - 1) ? '' : ` – ${dayLabel(span.end - 1)}`}`
        : '';

      return {
        scope,
        label,
        detail: scope.kind === 'event'
          ? `${members.length} session${members.length === 1 ? '' : 's'} · ${dates}`
          : dates,
        orders: ordersOf(input.orders, members),
        costs: costsOf(input.costs, members, eventId),
        sessions: members,
        range,
        tradingHours,
        sessionScoped: true,
        previous: prior
          ? { label: prior.name, orders: ordersOf(input.orders, prior.sessions) }
          : null,
        eventId,
        perEvent: eventId !== undefined
          ? { available: true }
          : { available: false, reason: NO_EVENT_HERE },
      };
    }
    // The session or event was deleted out from under the picker. Fall through
    // to the date scope rather than showing an empty screen with a live label.
  }

  const preset: RangePreset = scope.kind === 'range'
    ? scope.preset
    : (DEFAULT_SCOPE as { kind: 'range'; preset: RangePreset }).preset;
  const range = resolveRange(preset, undefined, now);
  const comparison = previousRange(range);
  const orders = ordersInRange(input.orders, range);

  return {
    scope: { kind: 'range', preset },
    label: range.label,
    detail: preset === 'all'
      ? 'Every order ever taken'
      : `${dayLabel(range.start)} – ${dayLabel(range.end - 1)}`,
    orders,
    costs: input.costs.filter(c => c.timestamp >= range.start && c.timestamp < range.end),
    sessions: input.sessions.filter(s =>
      s.startedAt < range.end && (s.endedAt ?? now) >= range.start),
    range,
    tradingHours: activeTradingHours(orders, range),
    sessionScoped: false,
    previous: {
      label: 'Previous period',
      orders: ordersInRange(input.orders, comparison),
    },
    // A date window belongs to no event, but a cost logged from one is picked
    // up by its timestamp — so the basis is offered as long as there is a real
    // event somewhere to file it against, and refused when there is not.
    perEvent: input.events.length > 0
      ? { available: true }
      : { available: false, reason: NO_EVENTS_AT_ALL },
  };
}

/**
 * Buckets for the popularity trend: the last few sessions or events in scope,
 * oldest first.
 *
 * When a single session is in scope there is nothing to trend against, so this
 * widens to the sessions around it — a trend of one point is not a trend.
 */
export function trendBuckets(
  resolved: ResolvedScope,
  sessions: TradingSession[],
  events: TradingEvent[],
  limit = 5,
): { id: string; label: string; sessionIds: string[] }[] {
  const groups = eventGroups(events, sessions)
    .filter(g => g.sessions.length > 0)
    .sort((a, b) => a.startedAt - b.startedAt);

  if (groups.length === 0) return [];

  if (resolved.sessionScoped) {
    const inScope = new Set(resolved.sessions.map(s => s.id));
    const index = groups.findIndex(g => g.sessions.some(s => inScope.has(s.id)));
    const upTo = index >= 0 ? index + 1 : groups.length;
    return groups.slice(Math.max(0, upTo - limit), upTo)
      .map(g => ({ id: g.id, label: g.name, sessionIds: g.sessions.map(s => s.id) }));
  }

  const within = groups.filter(g =>
    g.startedAt < resolved.range.end && g.startedAt >= resolved.range.start);
  const pool = within.length > 1 ? within : groups;
  return pool.slice(-limit)
    .map(g => ({ id: g.id, label: g.name, sessionIds: g.sessions.map(s => s.id) }));
}
