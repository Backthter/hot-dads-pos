import type { CostEntry, Order, TradingEvent, TradingSession } from '../types';

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

export function startSession(sessions: TradingSession[], now: number, name?: string): TradingSession {
  return {
    id: newSessionId(),
    name: name?.trim() || defaultSessionName(now, sessions),
    status: 'active',
    startedAt: now,
    ticketCounter: 0,
    pausedMs: 0,
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

export function createEvent(name: string, now: number, notes?: string): TradingEvent {
  return { id: newEventId(), name: name.trim() || 'Event', notes, createdAt: now };
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
 * Every event, plus each ungrouped session presented as an event of one.
 *
 * Reporting "by event" has to cover sessions nobody bothered to group, or the
 * chart silently omits most of the year's trading.
 */
export function eventGroups(
  events: TradingEvent[],
  sessions: TradingSession[],
): EventGroup[] {
  const groups: EventGroup[] = events.map(ev => {
    const members = sessionsForEvent(sessions, ev.id);
    return {
      id: ev.id,
      name: ev.name,
      sessions: members,
      startedAt: members[0]?.startedAt ?? ev.createdAt,
      endedAt: members.every(s => s.endedAt)
        ? members.reduce((max, s) => Math.max(max, s.endedAt ?? 0), 0) || undefined
        : undefined,
      grouped: true,
    };
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
