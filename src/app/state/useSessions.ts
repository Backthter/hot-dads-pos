import { useCallback, useRef, useState } from 'react';
import { restoreAction, useHistory } from '../lib/history';
import {
  assertCostEntry,
  costEntryIsCoherent,
  createEvent,
  describeCostAmount,
  endSession as closeSession,
  newCostId,
  pauseSession,
  resumeSession,
  startSession,
} from '../lib/sessions';
import type { StateCore } from './core';
import type { ExplainNotUndoable } from './useNotUndoable';
import type { CostBasis, CostEntry, Order, TradingEvent, TradingSession } from '../types';

/**
 * Trading sessions, the events that group them, and the costs logged against
 * either.
 *
 * A session is one service. Membership is stamped onto each order at checkout
 * and never inferred from timestamps — see docs/03-INVARIANTS.md, invariant 4.
 * The ticket counter is mirrored into a ref because two orders can be rung up
 * inside a single React tick, and a stale closure would hand both of them the
 * same number.
 */

/** Which completed orders the board shows while a session is running. */
export type CompletedFilter = 'all' | 'session';

export function useSessions(core: StateCore, explainNotUndoable: ExplainNotUndoable) {
  const { snapshot } = core;
  const history = useHistory();

  const [tradingSessions, setTradingSessions] = useState<TradingSession[]>([]);
  const [tradingEvents, setTradingEvents] = useState<TradingEvent[]>([]);
  const [costEntries, setCostEntries] = useState<CostEntry[]>([]);
  const [completedFilter, setCompletedFilter] = useState<CompletedFilter>('all');

  /**
   * Live mirror of the session list, so ticket numbers can be claimed without
   * waiting for a re-render. Kept in step with state on every render below.
   */
  const sessionsRef = useRef<TradingSession[]>(tradingSessions);

  /* --------------------------------------------------------- the lifecycle */

  /**
   * Only one session takes orders at a time.
   *
   * Starting one while another is live would leave two claims on the same
   * ticket number, so any live session is paused first rather than refused —
   * the till should never be blocked by a session someone forgot to close.
   */
  const start = useCallback((name: string) => {
    const now = Date.now();
    setTradingSessions(prev => {
      const parkedFirst = prev.map(s => (s.status === 'active' ? pauseSession(s, now) : s));
      return [...parkedFirst, startSession(prev, now, name)];
    });
    setCompletedFilter('session');
    explainNotUndoable(
      `${name || 'Session'} started`,
      'Starting a session is not undone with Ctrl+Z — it hands out kitchen ticket numbers. End it instead if it was a mistake.',
    );
  }, [explainNotUndoable]);

  const pause = useCallback(() => {
    const now = Date.now();
    setTradingSessions(prev => prev.map(s => (s.status === 'active' ? pauseSession(s, now) : s)));
    setCompletedFilter('all');
  }, []);

  const resume = useCallback((sessionId: string) => {
    const now = Date.now();
    setTradingSessions(prev => prev.map(s => {
      if (s.id === sessionId) return resumeSession(s, now);
      return s.status === 'active' ? pauseSession(s, now) : s;
    }));
    setCompletedFilter('session');
  }, []);

  /**
   * Ends the live session. Its orders keep their session id and their session
   * ticket — the numbers simply stop being preferred for display, so the board
   * shows true order numbers again without a single row being rewritten.
   */
  const end = useCallback(() => {
    const now = Date.now();
    setTradingSessions(prev => prev.map(s => (s.status === 'active' ? closeSession(s, now) : s)));
    setCompletedFilter('all');
    explainNotUndoable(
      'Session ended',
      'Nothing has been deleted — every order keeps its session. Resume it from the session bar if you meant to carry on.',
    );
  }, [explainNotUndoable]);

  const rename = useCallback((sessionId: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const before = snapshot.current.tradingSessions;
    const next = before.map(s => (s.id === sessionId ? { ...s, name: trimmed } : s));
    setTradingSessions(next);
    history.record(restoreAction(
      `Renamed a session to ${trimmed}`, 'session', before, next, setTradingSessions,
      undefined, `session:${sessionId}:name`,
    ));
  }, [snapshot, history]);

  /**
   * Takes the next ticket number in the live session, or nothing when none is
   * running.
   *
   * The counter is read from a ref rather than from state because two orders
   * can be rung up inside a single React tick, and a stale closure would hand
   * both of them the same number — the one thing session numbering exists to
   * prevent. The ref is written here and mirrored from state on every render,
   * so it is never behind.
   */
  const claimTicket = useCallback((): Pick<Order, 'sessionId' | 'sessionTicket'> => {
    const live = sessionsRef.current.find(s => s.status === 'active');
    if (!live) return {};
    const ticket = live.ticketCounter + 1;
    sessionsRef.current = sessionsRef.current.map(s =>
      s.id === live.id ? { ...s, ticketCounter: ticket } : s);
    setTradingSessions(prev => prev.map(s =>
      s.id === live.id ? { ...s, ticketCounter: Math.max(s.ticketCounter, ticket) } : s));
    return { sessionId: live.id, sessionTicket: ticket };
  }, []);

  /* ------------------------------------------------------------- grouping */

  /** Groups sessions under one event, creating the event as a side effect. */
  const group = useCallback((sessionIds: string[], eventName: string) => {
    if (sessionIds.length < 2) return;
    const picked = snapshot.current.tradingSessions.filter(s => sessionIds.includes(s.id));
    const fallback = picked.length > 0
      ? `${picked[0].name.split('·')[0].trim() || 'Event'} run`
      : 'Event';
    const beforeEvents = snapshot.current.tradingEvents;
    const beforeSessions = snapshot.current.tradingSessions;
    const event = createEvent(eventName || fallback, Date.now());
    const afterEvents = [...beforeEvents, event];
    const afterSessions = beforeSessions.map(s =>
      sessionIds.includes(s.id) ? { ...s, eventId: event.id } : s);
    setTradingEvents(afterEvents);
    setTradingSessions(afterSessions);
    history.record({
      label: `Grouped ${sessionIds.length} sessions into ${event.name}`,
      scope: 'session',
      undo: () => { setTradingEvents(beforeEvents); setTradingSessions(beforeSessions); },
      redo: () => { setTradingEvents(afterEvents); setTradingSessions(afterSessions); },
    });
  }, [snapshot, history]);

  /**
   * Detaches a session from its event, and drops the event once it is empty.
   *
   * An event with no sessions is not a fact about the business, only a leftover
   * label, and leaving them behind fills the analytics scope picker with
   * nothing.
   */
  const ungroup = useCallback((sessionId: string) => {
    const target = snapshot.current.tradingSessions.find(s => s.id === sessionId);
    if (!target?.eventId) return;
    const eventId = target.eventId;
    const beforeSessions = snapshot.current.tradingSessions;
    const beforeEvents = snapshot.current.tradingEvents;
    const remaining = beforeSessions.filter(s => s.eventId === eventId && s.id !== sessionId);
    const afterSessions = beforeSessions.map(s =>
      s.id === sessionId ? { ...s, eventId: undefined } : s);
    const afterEvents = remaining.length === 0
      ? beforeEvents.filter(e => e.id !== eventId)
      : beforeEvents;
    setTradingSessions(afterSessions);
    if (afterEvents !== beforeEvents) setTradingEvents(afterEvents);
    history.record({
      label: `Took ${target.name} out of its event`,
      scope: 'session',
      undo: () => { setTradingSessions(beforeSessions); setTradingEvents(beforeEvents); },
      redo: () => { setTradingSessions(afterSessions); setTradingEvents(afterEvents); },
    });
  }, [snapshot, history]);

  /* ---------------------------------------------------------------- costs */

  /**
   * Logs a cost against whichever session is live.
   *
   * Costs entered outside a session carry no session id and count only towards
   * date-scoped figures — better than attaching them to the nearest session by
   * time, which would put Monday's gas bill inside Sunday's break-even.
   */
  const addCost = useCallback((
    amount: number,
    note: string,
    basis: CostBasis,
    target?: { sessionId?: string; eventId?: string },
  ) => {
    if (!(amount > 0)) return;
    const live = snapshot.current.tradingSessions.find(s => s.status === 'active');
    const before = snapshot.current.costEntries;
    // An explicit target wins; otherwise it lands on whatever is trading now.
    // A cost carries one or the other, never both — an entry that belonged to a
    // session *and* to its event would be counted twice at event level.
    const attach = target?.eventId
      ? { eventId: target.eventId }
      : target?.sessionId
        ? { sessionId: target.sessionId }
        : { sessionId: live?.id };
    // Nothing is written as a `kind` any more. The field stays on the type for
    // the rows that predate the basis, and this is not one of them.
    const entry = assertCostEntry({
      id: newCostId(),
      ...attach,
      amount,
      note: note.trim(),
      basis,
      timestamp: Date.now(),
    });
    const next = [...before, entry];
    setCostEntries(next);
    history.record(restoreAction(
      `Logged a cost of ${describeCostAmount(entry)}`, 'costs', before, next, setCostEntries,
    ));
  }, [snapshot, history]);

  /**
   * Re-files a cost under a different basis.
   *
   * This exists for the fixed/variable migration: every row written before it
   * became `per-session`, and the ones that had said `variable` are offered
   * back to the shop to place properly. It changes what a cost *is*, not what
   * it cost, so the amount is left exactly as typed — and it is undoable like
   * any other cost change.
   *
   * Re-filing to `per-event` needs an event to file it against; a cost that
   * only ever had a session has none, so the basis is refused rather than
   * written as an entry pointing at nothing.
   */
  const refileCost = useCallback((id: string, basis: CostBasis) => {
    const before = snapshot.current.costEntries;
    const target = before.find(c => c.id === id);
    if (!target || target.basis === basis) return;
    const candidate = { ...target, basis };
    if (!costEntryIsCoherent(candidate)) return;
    const next = before.map(c => (c.id === id ? candidate : c));
    setCostEntries(next);
    history.record(restoreAction(
      `Re-filed a cost as ${basis}`, 'costs', before, next, setCostEntries,
      undefined, `cost:${id}:basis`,
    ));
  }, [snapshot, history]);

  const deleteCost = useCallback((id: string) => {
    const before = snapshot.current.costEntries;
    const removed = before.find(c => c.id === id);
    const next = before.filter(c => c.id !== id);
    setCostEntries(next);
    history.record(restoreAction(
      // Described through the basis, or a per-revenue cost reads as rupees.
      `Removed a cost of ${removed ? describeCostAmount(removed) : 'nothing'}`,
      'costs', before, next, setCostEntries,
    ));
  }, [snapshot, history]);

  /* ---------------------------------------------------------- bulk changes */

  const hydrate = useCallback((next: {
    tradingSessions: TradingSession[];
    tradingEvents: TradingEvent[];
    costEntries: CostEntry[];
  }) => {
    setTradingSessions(next.tradingSessions);
    setTradingEvents(next.tradingEvents);
    setCostEntries(next.costEntries);
    // A shop that was mid-service when it last closed comes back to its own
    // session's tickets rather than to every completed order it has ever taken.
    if (next.tradingSessions.some(s => s.status === 'active')) {
      setCompletedFilter('session');
    }
  }, []);

  const clear = useCallback(() => {
    setTradingSessions([]);
    setTradingEvents([]);
    setCostEntries([]);
  }, []);

  // Mirror for synchronous ticket claims. Assigned during render, so it is
  // never behind the state it shadows.
  sessionsRef.current = tradingSessions;

  const live = tradingSessions.find(s => s.status === 'active') ?? null;

  return {
    state: {
      tradingSessions,
      tradingEvents,
      costEntries,
      completedFilter,
      /** The session taking orders right now, or null. */
      live,
      sessionsRef,
    },
    actions: {
      hydrate,
      clear,
      setCompletedFilter,
      start,
      pause,
      resume,
      end,
      rename,
      group,
      ungroup,
      claimTicket,
      addCost,
      refileCost,
      deleteCost,
    },
  };
}

export type SessionsHandle = ReturnType<typeof useSessions>;
