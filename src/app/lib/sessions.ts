import type { CostBasis, CostEntry, Order, TradingEvent, TradingSession } from '../types';

/**
 * Trading sessions and the events that group them.
 *
 * A session is one service. It can be paused and resumed, because a market day
 * is not a calendar day: it stops at dusk and picks up in the morning, and
 * anything that infers membership from a start timestamp gets the second
 * morning wrong. Orders therefore carry their session id, stamped at checkout.
 *
 * An event is nothing but a container for sessions. Most are a single session;
 * a three-day market run as three services is one event and three sessions. The
 * grouping is stored rather than guessed, because dates cannot tell three days
 * of one market apart from three unrelated markets in the same week.
 *
 * Two rules run through all of it:
 *
 *  - **A session's true numbers are never overwritten.** `orderNumber` remains
 *    the lifetime sequence; `sessionTicket` is a second, parallel number. Ending
 *    a session reveals the former by no longer preferring the latter — nothing
 *    is rewritten, so nothing can be lost.
 *  - **Resuming continues the count.** Restarting at 1 would let two tickets in
 *    one session share a number, which makes a session's own records ambiguous.
 */

let seq = 0;
const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(seq += 1)}`;

export const newSessionId = () => newId('ses');
export const newEventId = () => newId('evt');
export const newCostId = () => newId('cost');

/** The session currently taking orders, if any. Only one can be active. */
export function activeSession(sessions: TradingSession[]): TradingSession | null {
  return sessions.find(s => s.status === 'active') ?? null;
}

/** Sessions that can be picked up again — paused, or the live one. */
export function resumableSessions(sessions: TradingSession[]): TradingSession[] {
  return sessions
    .filter(s => s.status !== 'ended')
    .sort((a, b) => b.startedAt - a.startedAt);
}

/** `Session · 17 Aug` — enough to recognise, short enough for a button. */
export function defaultSessionName(at: number, existing: TradingSession[]): string {
  const date = new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  const sameDay = existing.filter(s =>
    new Date(s.startedAt).toDateString() === new Date(at).toDateString()).length;
  return sameDay > 0 ? `Session ${sameDay + 1} · ${date}` : `Session · ${date}`;
}

/**
 * A new session, optionally starting straight into an event.
 *
 * `eventId` is optional and defaults to nothing, which is the case that matters
 * most: most days are just days. A picker that demands an answer every morning
 * is a picker that gets dismissed every morning, and the session then carries
 * whatever the dismissal meant. The three-day market is the exception, and the
 * exception is the one worth typing.
 *
 * The caller is responsible for the event existing. Nothing here creates one —
 * a session pointing at an event id with no row behind it is treated as
 * ungrouped by `eventGroups`, which is the safe reading but not a useful one.
 */
export function startSession(
  sessions: TradingSession[],
  now: number,
  name?: string,
  eventId?: string,
): TradingSession {
  return {
    id: newSessionId(),
    name: name?.trim() || defaultSessionName(now, sessions),
    status: 'active',
    startedAt: now,
    ticketCounter: 0,
    pausedMs: 0,
    ...(eventId ? { eventId } : {}),
  };
}

/**
 * Pauses a session, banking the moment so the gap can be deducted later.
 *
 * Paused time is excluded from trading hours: a session that ran four hours on
 * Saturday and four on Sunday traded for eight, not for thirty-two, and revenue
 * per trading hour is meaningless if the night counts as trading.
 */
export function pauseSession(session: TradingSession, now: number): TradingSession {
  if (session.status !== 'active') return session;
  return { ...session, status: 'paused', pausedAt: now };
}

export function resumeSession(session: TradingSession, now: number): TradingSession {
  if (session.status !== 'paused') return session;
  const banked = session.pausedAt ? Math.max(0, now - session.pausedAt) : 0;
  return { ...session, status: 'active', pausedAt: undefined, pausedMs: session.pausedMs + banked };
}

export function endSession(session: TradingSession, now: number): TradingSession {
  const banked = session.pausedAt ? Math.max(0, now - session.pausedAt) : 0;
  return {
    ...session,
    status: 'ended',
    endedAt: now,
    pausedAt: undefined,
    pausedMs: session.pausedMs + banked,
  };
}

/**
 * Wall-clock milliseconds the session actually traded, pauses removed.
 *
 * A live session is measured up to `now`; an ended one to its end. Either way
 * this is elapsed time, not the distinct-hours figure used elsewhere — a
 * session that took one order an hour traded all of it, and pretending
 * otherwise would flatter revenue per hour on a slow day.
 */
export function sessionTradingMs(session: TradingSession, now: number): number {
  const end = session.endedAt ?? now;
  const paused = session.pausedMs + (session.pausedAt ? Math.max(0, now - session.pausedAt) : 0);
  return Math.max(0, end - session.startedAt - paused);
}

export function sessionTradingHours(session: TradingSession, now: number): number {
  return sessionTradingMs(session, now) / (60 * 60 * 1000);
}

/* ------------------------------------------------------------------ events */

/** What an event can be given when it is made, beyond its name. */
export interface EventDetails {
  /** A plan, never the record. See the doc comment on `TradingEvent`. */
  plannedStart?: number;
  plannedEnd?: number;
  venue?: string;
  notes?: string;
}

export function createEvent(
  name: string,
  now: number,
  details?: EventDetails,
): TradingEvent {
  return {
    id: newEventId(),
    name: name.trim() || 'Event',
    createdAt: now,
    ...(details?.plannedStart !== undefined ? { plannedStart: details.plannedStart } : {}),
    ...(details?.plannedEnd !== undefined ? { plannedEnd: details.plannedEnd } : {}),
    ...(details?.venue?.trim() ? { venue: details.venue.trim() } : {}),
    ...(details?.notes?.trim() ? { notes: details.notes.trim() } : {}),
  };
}

/**
 * Where an event is in its life, worked out from its sessions.
 *
 * - `planned` — no sessions. Either it has not started, or its last session was
 *   taken out of it. Both are things the shop did on purpose.
 * - `active` — at least one session is active or paused. A paused session is
 *   mid-market, not finished: a market that stops at dusk and picks up in the
 *   morning is still running, and calling it ended overnight is the same
 *   calendar-day mistake invariant 4 was written against.
 * - `ended` — it has sessions and every one of them has ended.
 *
 * **Derived, never stored.** A `status` column on `trading_events` would be a
 * second source of truth about the same fact, and the first thing that would
 * break it is somebody resuming a session inside an `ended` event: the sessions
 * would say active and the column would say ended, with nothing to say which
 * was right. That is the shape of problem invariant 4 exists to prevent, so the
 * same answer applies — read it off the rows that actually know.
 */
export type EventStatus = 'planned' | 'active' | 'ended';

export function eventStatus(event: TradingEvent, sessions: TradingSession[]): EventStatus {
  const members = sessions.filter(s => s.eventId === event.id);
  if (members.length === 0) return 'planned';
  return members.some(s => s.status !== 'ended') ? 'active' : 'ended';
}

/**
 * Sessions belonging to an event, oldest first.
 *
 * An ungrouped session stands alone and is reported as its own event, so the
 * common case — one market, one service — needs no ceremony to appear on an
 * event chart.
 */
export function sessionsForEvent(sessions: TradingSession[], eventId: string): TradingSession[] {
  return sessions.filter(s => s.eventId === eventId).sort((a, b) => a.startedAt - b.startedAt);
}

export interface EventGroup {
  /** Event id, or the session's own id when it is ungrouped. */
  id: string;
  name: string;
  sessions: TradingSession[];
  startedAt: number;
  endedAt?: number;
  /** False when this group is a lone session standing in for an event. */
  grouped: boolean;
}

/**
 * Every event **that has sessions**, plus each ungrouped session presented as
 * an event of one.
 *
 * Reporting "by event" has to cover sessions nobody bothered to group, or the
 * chart silently omits most of the year's trading.
 *
 * **Session-less events are excluded, and that is the contract.** Since ADR-021
 * an event can exist with no sessions — created on Thursday for Saturday, or
 * left behind when its last session was detached — and there is nothing to
 * report on one. Every consumer here indexes `group.sessions[0]` or measures
 * `spanOf(group.sessions)`, both of which are wrong on an empty group rather
 * than merely empty; and `scopeOptions` feeds the analytics picker, which
 * should not offer a period with no orders, no costs and no hours in it. Use
 * `allEvents` for a list that includes them — the manager wants them and
 * nothing else does.
 */
export function eventGroups(
  events: TradingEvent[],
  sessions: TradingSession[],
): EventGroup[] {
  const groups: EventGroup[] = events.flatMap(ev => {
    const members = sessionsForEvent(sessions, ev.id);
    if (members.length === 0) return [];
    return [{
      id: ev.id,
      name: ev.name,
      sessions: members,
      startedAt: members[0].startedAt,
      endedAt: members.every(s => s.endedAt)
        ? members.reduce((max, s) => Math.max(max, s.endedAt ?? 0), 0) || undefined
        : undefined,
      grouped: true,
    }];
  });

  for (const s of sessions) {
    if (s.eventId && events.some(e => e.id === s.eventId)) continue;
    groups.push({
      id: s.id,
      name: s.name,
      sessions: [s],
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      grouped: false,
    });
  }

  return groups.sort((a, b) => b.startedAt - a.startedAt);
}

/** An event and everything the manager needs to draw a row for it. */
export interface EventListing {
  event: TradingEvent;
  /** Members, oldest first. Empty for a `planned` event. */
  sessions: TradingSession[];
  status: EventStatus;
  /**
   * When this event actually ran, from its sessions. `null` while it has none —
   * *not* the planned dates, which are a plan and would read as a measurement
   * sitting in the column a measurement belongs in.
   */
  span: { start: number; end?: number } | null;
}

/**
 * Every event the shop has, session-less ones included, each with its derived
 * status. The manager's list.
 *
 * This is the deliberate counterpart to `eventGroups`, and the split is the
 * whole of ADR-021's mechanism. `eventGroups` answers "what can be reported
 * on", so an event with no sessions is not in it. `allEvents` answers "what
 * events exist", so it is — otherwise a plan made on Thursday is invisible
 * until it has traded, which is the one moment it needed to be visible.
 *
 * Ungrouped sessions are **not** here. They are not events, and the manager
 * shows them in a section of their own precisely so that a real event of one
 * and a lone session are told apart on screen (ADR-020). `ungroupedSessions`
 * is that list.
 *
 * Sorted newest first, on the sessions where there are any and on the plan
 * where there are not — a planned event has to sort somewhere, and its planned
 * start is the only date it has.
 */
export function allEvents(
  events: TradingEvent[],
  sessions: TradingSession[],
): EventListing[] {
  return events
    .map(event => {
      const members = sessionsForEvent(sessions, event.id);
      return {
        event,
        sessions: members,
        status: eventStatus(event, sessions),
        span: members.length === 0 ? null : {
          start: members[0].startedAt,
          end: members.every(s => s.endedAt)
            ? members.reduce((max, s) => Math.max(max, s.endedAt ?? 0), 0) || undefined
            : undefined,
        },
      };
    })
    .sort((a, b) => sortKeyOf(b) - sortKeyOf(a));
}

const sortKeyOf = (listing: EventListing) =>
  listing.span?.start ?? listing.event.plannedStart ?? listing.event.createdAt;

/**
 * Sessions belonging to no event, newest first.
 *
 * A session whose `eventId` names an event that is not in the list counts as
 * ungrouped, matching `eventGroups` — a dangling id is a broken link, and
 * hiding the session because of it would lose it from both lists at once.
 */
export function ungroupedSessions(
  events: TradingEvent[],
  sessions: TradingSession[],
): TradingSession[] {
  const known = new Set(events.map(e => e.id));
  return sessions
    .filter(s => !s.eventId || !known.has(s.eventId))
    .sort((a, b) => b.startedAt - a.startedAt);
}

/* ---------------------------------------------------------------- numbering */

/** Zero-padded, matching the lifetime order number format. */
export function formatTicket(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * The number to show on a ticket.
 *
 * While a session is live its own count is what the kitchen calls out. Once it
 * ends the true lifetime number surfaces again — the same rows, read
 * differently, with nothing rewritten in between.
 */
export function displayNumber(order: Order, liveSessionId: string | null): string {
  if (liveSessionId && order.sessionId === liveSessionId && order.sessionTicket !== undefined) {
    return formatTicket(order.sessionTicket);
  }
  return order.orderNumber;
}

/** Re-labels a list for display. Pure — the stored orders are untouched. */
export function withDisplayNumbers(orders: Order[], liveSessionId: string | null): Order[] {
  if (!liveSessionId) return orders;
  return orders.map(o => {
    const shown = displayNumber(o, liveSessionId);
    return shown === o.orderNumber ? o : { ...o, orderNumber: shown };
  });
}

/* ----------------------------------------------------------------- scoping */

export function ordersForSession(orders: Order[], sessionId: string): Order[] {
  return orders.filter(o => o.sessionId === sessionId);
}

export function ordersForSessions(orders: Order[], sessionIds: Set<string>): Order[] {
  return orders.filter(o => o.sessionId !== undefined && sessionIds.has(o.sessionId));
}

export function costsForSessions(costs: CostEntry[], sessionIds: Set<string>): CostEntry[] {
  return costs.filter(c => c.sessionId !== undefined && sessionIds.has(c.sessionId));
}

/**
 * Every cost belonging to an event: those logged against its sessions, plus
 * those attached to the event itself.
 */
export function costsForEvent(
  costs: CostEntry[],
  eventId: string,
  sessionIds: Set<string>,
): CostEntry[] {
  return costs.filter(c => (
    c.eventId === eventId
    || (c.sessionId !== undefined && sessionIds.has(c.sessionId))
  ));
}

/* ------------------------------------------------------------------- costs */

/**
 * A per-event cost has to name its event.
 *
 * `per-event` means "paid once for the whole market", and the only thing that
 * makes such a cost findable is the event id — `costsForEvent` and
 * `resolveScope`'s `costsOf` both match on it. An entry with the basis and no
 * event is an amount attached to nothing: it is counted in no event figure, and
 * it looks correct on the form that created it.
 *
 * Checked rather than assumed, because the failure is silent. The call sites
 * are the writes — where a bad entry can still be refused — not the load, which
 * has to stay openable; `costEntryFromRow` demotes instead.
 */
export function costEntryIsCoherent(entry: CostEntry): boolean {
  return entry.basis !== 'per-event' || Boolean(entry.eventId);
}

/** Throws on an incoherent entry. Returns it unchanged so it can wrap a write. */
export function assertCostEntry(entry: CostEntry): CostEntry {
  if (!costEntryIsCoherent(entry)) {
    throw new Error(
      `Cost ${entry.id} is filed per-event with no event. A per-event cost is paid once `
      + 'for the whole event, so without one it belongs to nothing and appears in no figure.',
    );
  }
  return entry;
}

/**
 * How each basis reads around the amount.
 *
 * One table, because the form, the history list and the undo label all have to
 * say the same thing about the same number. `prefix` is empty for the one basis
 * whose amount is not money — a percentage with "Rs" in front of it is a lie
 * the eye reads faster than the label that would correct it.
 */
export const COST_BASIS_UNIT: Record<CostBasis, { prefix: string; suffix: string }> = {
  'per-session': { prefix: 'Rs', suffix: 'for this session' },
  'per-event': { prefix: 'Rs', suffix: 'for this event' },
  'per-order': { prefix: 'Rs', suffix: 'per ticket' },
  'per-unit': { prefix: 'Rs', suffix: 'per item sold' },
  'per-revenue': { prefix: '', suffix: '% of sales' },
};

/** What a basis is called on screen. */
export const COST_BASIS_LABEL: Record<CostBasis, string> = {
  'per-session': 'Per session',
  'per-event': 'Whole event',
  'per-order': 'Per ticket',
  'per-unit': 'Per item',
  'per-revenue': 'Share of sales',
};

/** `Rs 1,200 for this session`, `18 % of sales`. Amount and unit, never apart. */
export function describeCostAmount(entry: Pick<CostEntry, 'amount' | 'basis'>): string {
  const { prefix, suffix } = COST_BASIS_UNIT[entry.basis];
  const amount = Math.round(entry.amount * 100) / 100;
  return `${prefix ? `${prefix} ` : ''}${amount.toLocaleString()} ${suffix}`;
}

/**
 * Entries the fixed/variable migration could not place, and is not going to
 * guess at.
 *
 * Everything written before Phase 1A became `per-session`, including the rows
 * filed as `variable` — deciding from a cost's name that "fuel" was really
 * per-revenue would invent information and change a figure the shop has already
 * seen. So the ones that said `variable` are marked instead, and the shop is
 * asked where they belong. A row that has since been re-filed no longer answers
 * to this, because its basis is no longer the one the migration handed it.
 */
export function needsRefiling(entry: CostEntry): boolean {
  return entry.kind === 'variable' && entry.basis === 'per-session';
}

/**
 * The window a set of sessions covers, for anything that still needs a date
 * range — stock movements and snapshots are timestamped, not session-stamped.
 *
 * Returns null for an empty set rather than a zero-width range, so callers have
 * to decide what "no sessions" means instead of silently reporting nothing.
 */
export function spanOf(sessions: TradingSession[], now: number): { start: number; end: number } | null {
  if (sessions.length === 0) return null;
  return {
    start: sessions.reduce((min, s) => Math.min(min, s.startedAt), Infinity),
    end: sessions.reduce((max, s) => Math.max(max, s.endedAt ?? now), 0) + 1,
  };
}
