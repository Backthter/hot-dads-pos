import { useCallback, useRef, useState } from 'react';
import { restoreAction, useHistory } from '../lib/history';
import {
  assertCostEntry,
  costEntryIsCoherent,
  costsFiledAgainstEvent,
  createEvent,
  describeCostAmount,
  endSession as closeSession,
  newCostId,
  pauseSession,
  resumeSession,
  startSession,
  type EventDetails,
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

/**
 * The event a session is started into, if any.
 *
 * **Undefined is the default and the common case.** Most days are just days,
 * and a picker that demands an answer every morning is a picker that gets
 * dismissed every morning — after which the session carries whatever dismissing
 * it happened to mean. Naming an event is the exception, and the exception is
 * the one worth typing.
 */
export type StartTarget =
  | { kind: 'existing'; eventId: string }
  | { kind: 'new'; name: string; details?: EventDetails };

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
  const start = useCallback((name: string, into?: StartTarget) => {
    const now = Date.now();
    // An event named rather than picked is created here, in the same tick, so
    // the session is attached to a real row from the moment it exists rather
    // than to an id nothing is behind. A person typed the name — this is not
    // the program inventing one (ADR-018, ADR-020).
    const created = into?.kind === 'new'
      ? createEvent(into.name, now, into.details)
      : null;
    if (created) setTradingEvents(prev => [...prev, created]);
    const eventId = created?.id ?? (into?.kind === 'existing' ? into.eventId : undefined);
    setTradingSessions(prev => {
      const parkedFirst = prev.map(s => (s.status === 'active' ? pauseSession(s, now) : s));
      return [...parkedFirst, startSession(prev, now, name, eventId)];
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

  /**
   * Groups sessions under one event, creating the event as a side effect.
   *
   * **One session is enough** (ADR-020). The two-session minimum this used to
   * carry made an event something that could only exist after two days had been
   * traded and grouped by hand, which is the wrong way round for the cost the
   * basis exists for: the pitch fee for a three-day market is paid on Saturday
   * morning, before Sunday and Monday exist as anything at all.
   *
   * ADR-018 is untouched by this and still stands. What it forbids is the
   * *program* inventing an event so that a basis stops being disabled. Every
   * route into this function is a person naming one.
   */
  const group = useCallback((sessionIds: string[], eventName: string) => {
    if (sessionIds.length < 1) return;
    const picked = snapshot.current.tradingSessions.filter(s => sessionIds.includes(s.id));
    if (picked.length === 0) return;
    const fallback = `${picked[0].name.split('·')[0].trim() || 'Event'} run`;
    const beforeEvents = snapshot.current.tradingEvents;
    const beforeSessions = snapshot.current.tradingSessions;
    const event = createEvent(eventName || fallback, Date.now());
    const afterEvents = [...beforeEvents, event];
    const afterSessions = beforeSessions.map(s =>
      sessionIds.includes(s.id) ? { ...s, eventId: event.id } : s);
    setTradingEvents(afterEvents);
    setTradingSessions(afterSessions);
    history.record({
      label: sessionIds.length === 1
        ? `Made ${picked[0].name} into ${event.name}`
        : `Grouped ${sessionIds.length} sessions into ${event.name}`,
      scope: 'session',
      undo: () => { setTradingEvents(beforeEvents); setTradingSessions(beforeSessions); },
      redo: () => { setTradingEvents(afterEvents); setTradingSessions(afterSessions); },
    });
  }, [snapshot, history]);

  /**
   * Makes one session into an event of its own.
   *
   * This is `group` with one id, named separately because it is a different act
   * with a different reason, and because 1C-ii-b's cost form links to it: a
   * shop that has just been told `per-event` is unavailable here needs one
   * control that makes it available, and that control cannot live buried inside
   * a component. It is a handler on the hook so anything can call it.
   *
   * The distinction ADR-020 turns on is who is doing it. A person saying "this
   * Saturday is the Winter Market, and the pitch fee is the market's not the
   * day's" is stating a fact about their business. The program noticing that a
   * basis is disabled and creating an event so that it is not is the thing
   * ADR-018 rejected, and this must never be called from a code path that no
   * one asked for.
   */
  const makeSessionAnEvent = useCallback((sessionId: string, eventName?: string) => {
    const target = snapshot.current.tradingSessions.find(s => s.id === sessionId);
    if (!target || target.eventId) return;
    group([sessionId], eventName?.trim() || target.name);
  }, [snapshot, group]);

  /**
   * Creates an event with nothing in it yet — the Thursday-for-Saturday case.
   *
   * A session-less event is `planned`, is in `allEvents`, and is deliberately
   * not in `eventGroups`, so it appears in the manager and not in the analytics
   * scope picker: there is nothing to report on a period that has not traded
   * (ADR-021). What it *is* good for is being the thing a pitch fee is filed
   * against on the morning it is paid.
   */
  const addEvent = useCallback((name: string, details?: EventDetails) => {
    const beforeEvents = snapshot.current.tradingEvents;
    const event = createEvent(name, Date.now(), details);
    const afterEvents = [...beforeEvents, event];
    setTradingEvents(afterEvents);
    history.record(restoreAction(
      `Created ${event.name}`, 'session', beforeEvents, afterEvents, setTradingEvents,
    ));
    return event;
  }, [snapshot, history]);

  /** Renames an event, or edits its plan. The sessions are untouched either way. */
  const editEvent = useCallback((
    eventId: string,
    changes: { name?: string } & EventDetails,
  ) => {
    const before = snapshot.current.tradingEvents;
    const target = before.find(e => e.id === eventId);
    if (!target) return;
    const name = changes.name?.trim();
    const updated: TradingEvent = {
      ...target,
      ...(name ? { name } : {}),
      plannedStart: changes.plannedStart,
      plannedEnd: changes.plannedEnd,
      venue: changes.venue?.trim() || undefined,
      notes: changes.notes?.trim() || undefined,
    };
    const next = before.map(e => (e.id === eventId ? updated : e));
    setTradingEvents(next);
    history.record(restoreAction(
      `Edited ${updated.name}`, 'session', before, next, setTradingEvents,
      undefined, `event:${eventId}:details`,
    ));
  }, [snapshot, history]);

  /**
   * Moves a session into an event that already exists, or out of one.
   *
   * This is the operation the model was missing, and its absence is what made
   * `per-event` unusable at the time anyone would want it. `group` always
   * creates a new event, so day three of a market could not be added to the
   * group made on day two without ungrouping every day and grouping them all
   * again — during the market, on a phone, between customers.
   *
   * `eventId` of `undefined` takes the session out of whatever event it is in,
   * which is the same effect as `ungroup` and is here so the manager's "move
   * into…" control has a "none" entry rather than a second control beside it.
   *
   * Undoable, recorded here at the mutation site (convention 3) with
   * `restoreAction`, because only one array changes: the events are untouched
   * either way. Nothing is deleted when the session that leaves was the last
   * one — see `ungroup` and ADR-021.
   */
  const moveSessionToEvent = useCallback((sessionId: string, eventId?: string) => {
    const before = snapshot.current.tradingSessions;
    const target = before.find(s => s.id === sessionId);
    if (!target) return;
    if ((target.eventId ?? undefined) === eventId) return;
    // A move into an event that is not there would leave the session looking
    // ungrouped to `eventGroups` and grouped to everything reading the field.
    if (eventId && !snapshot.current.tradingEvents.some(e => e.id === eventId)) return;
    const destination = eventId
      ? snapshot.current.tradingEvents.find(e => e.id === eventId)
      : undefined;
    const next = before.map(s => (s.id === sessionId ? { ...s, eventId } : s));
    setTradingSessions(next);
    history.record(restoreAction(
      destination
        ? `Moved ${target.name} into ${destination.name}`
        : `Took ${target.name} out of its event`,
      'session', before, next, setTradingSessions,
    ));
  }, [snapshot, history]);

  /**
   * Detaches a session from its event. **The event stays**, however empty it
   * gets.
   *
   * This used to delete the event once its last session left, on the reasoning
   * that an event with no sessions is a leftover label rather than a fact about
   * the business. That was right while events could only be created by
   * grouping, because then a session-less event could only ever be a leftover.
   * It is wrong now (ADR-021): a planned event with no sessions is exactly what
   * "created on Thursday for Saturday" produces, and it is also what a
   * mis-grouping being corrected produces one keystroke before the session is
   * put back. Auto-delete destroys the plan in both cases, and undo is the only
   * way back from something the shop never asked for.
   *
   * The concern the auto-delete was serving is real and is served differently:
   * `eventGroups` excludes session-less events, so the analytics scope picker
   * stays clean without anything being destroyed. Deleting is now a thing a
   * person does, through `deleteEvent`.
   */
  const ungroup = useCallback((sessionId: string) => {
    moveSessionToEvent(sessionId, undefined);
  }, [moveSessionToEvent]);

  /**
   * Removes an event. Its sessions are detached, not deleted.
   *
   * Refused while any cost is filed against the event itself. A `per-event`
   * cost carries the event id and nothing else (ADR-012), so deleting the event
   * out from under it leaves an amount pointing at a row that is not there:
   * invisible to `costsForEvent` and to every event figure, and correct-looking
   * wherever it was typed. `costEntryFromRow` demotes such a row on the way
   * back in, which keeps the app openable at the price of quietly restating a
   * market's pitch fee as one day's. Better to say so and let the shop move the
   * cost first. The reason comes back to the caller so the manager can show it.
   *
   * Confirmed on undo and redo. It is the only deletion in this area, and what
   * it takes with it — which sessions a market contained — is not obvious from
   * the label alone (invariant 6).
   */
  const deleteEvent = useCallback((eventId: string): { ok: true } | { ok: false; reason: string } => {
    const beforeEvents = snapshot.current.tradingEvents;
    const target = beforeEvents.find(e => e.id === eventId);
    if (!target) return { ok: false, reason: 'That event is no longer here.' };

    const filed = costsFiledAgainstEvent(snapshot.current.costEntries, eventId);
    if (filed.length > 0) {
      return {
        ok: false,
        reason: `${target.name} has ${filed.length} cost${filed.length === 1 ? '' : 's'} `
          + 'charged to the whole event. Move or remove them first — deleting the event '
          + 'would leave them attached to nothing, and they would drop out of every figure.',
      };
    }

    const beforeSessions = snapshot.current.tradingSessions;
    const members = beforeSessions.filter(s => s.eventId === eventId);
    const afterEvents = beforeEvents.filter(e => e.id !== eventId);
    const afterSessions = members.length === 0
      ? beforeSessions
      : beforeSessions.map(s => (s.eventId === eventId ? { ...s, eventId: undefined } : s));
    setTradingEvents(afterEvents);
    if (afterSessions !== beforeSessions) setTradingSessions(afterSessions);
    history.record({
      label: `Deleted ${target.name}`,
      scope: 'session',
      confirm: members.length === 0
        ? `Put ${target.name} back?`
        : `Put ${target.name} back, with its ${members.length} session${members.length === 1 ? '' : 's'}?`,
      undo: () => { setTradingEvents(beforeEvents); setTradingSessions(beforeSessions); },
      redo: () => { setTradingEvents(afterEvents); setTradingSessions(afterSessions); },
    });
    return { ok: true };
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
      moveSessionToEvent,
      makeSessionAnEvent,
      addEvent,
      editEvent,
      deleteEvent,
      ungroup,
      claimTicket,
      addCost,
      refileCost,
      deleteCost,
    },
  };
}

export type SessionsHandle = ReturnType<typeof useSessions>;
