import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  CalendarDays, Check, Layers, MapPin, MoreHorizontal, Pause, Play, Plus, Square, Tag, X,
} from 'lucide-react';
import {
  allEvents, resumableSessions, sessionTradingHours, ungroupedSessions,
  type EventDetails, type EventListing, type EventStatus,
} from '../lib/sessions';
import {
  Button, HINT, Popover, PopoverItem, SECTION_COLOR, Tooltip, capitalizeFirst, useNow,
} from '../ui';
import type { StartTarget } from '../state/useSessions';
import type { Order, TradingEvent, TradingSession } from '../types';

/**
 * Session controls for the All Orders screen, and the Sessions & Events
 * manager behind them.
 *
 * The bar answers three questions without being asked: whether a session is
 * live, how long it has actually traded, and how many tickets it has taken.
 * Everything else — resuming, renaming, making and editing events, moving
 * sessions between them — lives behind one button, because those are things you
 * do between services, not during one.
 *
 * **The manager is contained here rather than promoted to a screen.** Sessions
 * and events are administration: they are touched at the start of a market and
 * at the end of one, and a fifth top-level destination for them would work
 * against the five-to-four navigation reduction planned later. A panel opened
 * from the bar that already reports the session is the right size for it.
 */

/**
 * The session bar lives in All Orders, so its chrome is All Orders' blue. The
 * buttons that actually commit something stay the app's amber — see `PRIMARY`.
 */
const ACCENT = SECTION_COLOR.orders;
const DANGER = '#F9624E';
const GOOD = '#63D07F';

export interface SessionBarProps {
  sessions: TradingSession[];
  events: TradingEvent[];
  orders: Order[];
  onStart: (name: string, into?: StartTarget) => void;
  onPause: () => void;
  onResume: (sessionId: string) => void;
  onEnd: () => void;
  onRename: (sessionId: string, name: string) => void;
  onGroup: (sessionIds: string[], eventName: string) => void;
  onUngroup: (sessionId: string) => void;
  /** Into an existing event, or out of every event when the id is omitted. */
  onMoveSession: (sessionId: string, eventId?: string) => void;
  /** Makes one session into a real event of its own. 1C-ii-b links to this. */
  onMakeEvent: (sessionId: string, eventName?: string) => void;
  onCreateEvent: (name: string, details?: EventDetails) => void;
  onEditEvent: (eventId: string, changes: { name?: string } & EventDetails) => void;
  /** Refused, with a reason, while costs are filed against the event. */
  onDeleteEvent: (eventId: string) => { ok: true } | { ok: false; reason: string };
}

export function SessionBar(props: SessionBarProps) {
  const { sessions, events, orders, onStart, onPause, onResume, onEnd } = props;
  const [managing, setManaging] = useState(false);
  const [naming, setNaming] = useState(false);
  const [draftName, setDraftName] = useState('');
  /** Pre-selected event, set when the manager's "start a session" sends us here. */
  const [startInto, setStartInto] = useState<string | null>(null);

  const live = sessions.find(s => s.status === 'active') ?? null;
  const paused = sessions.filter(s => s.status === 'paused');

  const ticketCount = useMemo(
    () => (live ? orders.filter(o => o.sessionId === live.id && !o.voidedAt).length : 0),
    [orders, live],
  );

  /**
   * The bar's whole job is to say how long the session has actually traded, and
   * it was reading the clock once per render — so the figure sat still until
   * something unrelated happened to re-render the bar, typically the next
   * order. Half an hour of trading could pass without the number moving.
   *
   * 30s is ample: the figure is shown to one decimal place, so it cannot move
   * more often than every six minutes. When nothing is live there is no elapsed
   * time to report, and the request drops to something long enough to be
   * invisible — the clock is shared, so this costs no timer of its own either
   * way.
   */
  const now = useNow(live ? 30_000 : 3_600_000);
  const hours = live ? sessionTradingHours(live, now) : 0;

  return (
    <>
      <div className="flex items-center gap-[10px] flex-wrap">
        {live ? (
          <div
            className="flex items-center gap-[12px] flex-1 min-w-[320px] rounded-[10px] px-[13px] py-[10px] border"
            style={{ background: `${ACCENT}12`, borderColor: `${ACCENT}55` }}
            data-session-bar="active"
          >
            <span className="flex items-center gap-[7px] text-[var(--app-text)] text-[14px] font-semibold">
              <span
                className="w-[8px] h-[8px] rounded-full"
                style={{ background: GOOD, boxShadow: `0 0 8px ${GOOD}` }}
              />
              {live.name}
            </span>
            <span className="text-[var(--app-text-muted)] text-[12px]">
              {ticketCount} ticket{ticketCount === 1 ? '' : 's'} · {hours.toFixed(1)}h trading
              {live.ticketCounter > ticketCount ? ` · numbering from #${live.ticketCounter + 1}` : ''}
            </span>

            <span className="ml-auto flex items-center gap-[8px]">
              <Button
                variant="secondary"
                size="sm"
                onClick={onPause}
                data-session-pause
                hint={HINT.pauseSession}
                icon={<Pause size={14} />}
              >
                Pause
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={onEnd}
                data-session-end
                hint={HINT.endSession}
                icon={<Square size={13} />}
              >
                End session
              </Button>
            </span>
          </div>
        ) : (
          <>
            {naming ? (
              <StartForm
                // Remounted when the pre-selection changes, so the form picks
                // the event up as its initial value rather than needing an
                // effect to push it in after the fact.
                key={startInto ?? 'none'}
                events={events}
                sessions={sessions}
                initialEventId={startInto ?? undefined}
                name={draftName}
                onName={setDraftName}
                onCancel={() => { setNaming(false); setDraftName(''); setStartInto(null); }}
                onSubmit={into => {
                  onStart(draftName, into);
                  setDraftName('');
                  setNaming(false);
                  setStartInto(null);
                }}
              />
            ) : (
              <Button
                variant="primary"
                size="sm"
                onClick={() => setNaming(true)}
                data-session-start
                hint={HINT.startSession}
                icon={<Play size={14} />}
              >
                Start session
              </Button>
            )}

            {paused.length > 0 && !naming && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onResume(paused[0].id)}
                data-session-resume
                hint={HINT.resumeSession}
                icon={<Play size={14} />}
              >
                Resume {paused[0].name}
              </Button>
            )}
          </>
        )}

        <button
          onClick={() => setManaging(true)}
          data-session-manage
          className="flex items-center gap-[7px] px-4 py-2 rounded-lg text-[13px] font-semibold border border-[var(--app-border)] text-[var(--app-text-secondary)] hover:brightness-125 transition-all"
        >
          <Layers size={14} /> Sessions
          {sessions.length > 0 && (
            <span className="text-[var(--app-text-muted)] text-[11px]">{sessions.length}</span>
          )}
        </button>
      </div>

      <AnimatePresence>
        {managing && (
          <SessionManager
            {...props}
            onStartInto={eventId => {
              setStartInto(eventId);
              setNaming(true);
              setManaging(false);
            }}
            onClose={() => setManaging(false)}
          />
        )}
      </AnimatePresence>
    </>
  );
}

/* -------------------------------------------------------------- start form */

/**
 * Naming a session, and optionally the event it starts into.
 *
 * The event control is **closed by default and says "No event"**. Most days are
 * just days; a picker that demands an answer every morning is dismissed every
 * morning, and the session then carries whatever the dismissal happened to
 * mean. Opening it is one tap, and the shop that is starting day two of a
 * market is the shop that will take it.
 */
function StartForm({
  events, sessions, initialEventId, name, onName, onSubmit, onCancel,
}: {
  events: TradingEvent[];
  sessions: TradingSession[];
  /** Set only when the manager sent us here from a planned event's row. */
  initialEventId?: string;
  name: string;
  onName: (value: string) => void;
  onSubmit: (into?: StartTarget) => void;
  onCancel: () => void;
}) {
  const [into, setInto] = useState<StartTarget | undefined>(
    initialEventId ? { kind: 'existing', eventId: initialEventId } : undefined,
  );
  const [newEventName, setNewEventName] = useState('');

  // Newest first, and a planned event is a first-class choice here — being
  // startable into is most of the reason for creating one ahead.
  const listings = useMemo(() => allEvents(events, sessions), [events, sessions]);
  const chosen = into?.kind === 'existing'
    ? events.find(e => e.id === into.eventId)
    : undefined;

  const label = into === undefined
    ? 'No event'
    : into.kind === 'new'
      ? (newEventName.trim() || 'New event')
      : chosen?.name ?? 'No event';

  return (
    <form
      onSubmit={e => {
        e.preventDefault();
        onSubmit(into?.kind === 'new' ? { ...into, name: newEventName } : into);
      }}
      className="flex items-center gap-[8px] flex-wrap"
    >
      <input
        autoFocus
        value={name}
        onChange={e => onName(capitalizeFirst(e.target.value))}
        placeholder="Session name (optional)"
        data-session-name-input
        className="bg-[var(--app-surface)] border border-[var(--app-border)] rounded-[9px] px-[12px] h-[38px] text-[var(--app-text)] text-[13px] w-[240px] focus:outline-none"
        style={{ borderColor: ACCENT }}
      />

      <Popover
        label="Event"
        width={280}
        trigger={({ toggle }) => (
          <button
            type="button"
            onClick={toggle}
            data-session-start-event
            className="flex items-center gap-[6px] h-[38px] px-[12px] rounded-[9px] border border-[var(--app-border)] text-[13px] shrink-0"
            style={{ color: into ? ACCENT : 'var(--app-text-muted)' }}
          >
            <Tag size={13} /> {label}
          </button>
        )}
      >
        {close => (
          <>
            <PopoverItem
              title="No event"
              detail="Just a day's trading. This is the usual answer."
              selected={into === undefined}
              onClick={() => { setInto(undefined); close(); }}
            />
            <PopoverItem
              title="New event…"
              detail="A market that starts today."
              icon={<Plus size={14} />}
              selected={into?.kind === 'new'}
              onClick={() => { setInto({ kind: 'new', name: '' }); close(); }}
            />
            {listings.map(({ event, status }) => (
              <PopoverItem
                key={event.id}
                title={event.name}
                detail={STATUS_WORD[status]}
                icon={<Tag size={14} />}
                selected={into?.kind === 'existing' && into.eventId === event.id}
                onClick={() => { setInto({ kind: 'existing', eventId: event.id }); close(); }}
              />
            ))}
          </>
        )}
      </Popover>

      {into?.kind === 'new' && (
        <input
          value={newEventName}
          onChange={e => setNewEventName(capitalizeFirst(e.target.value))}
          placeholder="Event name"
          data-session-start-new-event
          className="bg-[var(--app-surface)] border border-[var(--app-border)] rounded-[9px] px-[12px] h-[38px] text-[var(--app-text)] text-[13px] w-[180px] focus:outline-none"
        />
      )}

      <Button type="submit" variant="primary" size="sm" data-session-start-confirm>
        Start
      </Button>
      <button
        type="button"
        onClick={onCancel}
        className="text-[var(--app-text-muted)] px-[6px]"
      >
        <X size={16} />
      </button>
    </form>
  );
}

/* ------------------------------------------------------------------ manager */

const STATUS_WORD: Record<EventStatus, string> = {
  planned: 'planned',
  active: 'trading',
  ended: 'ended',
};

/** A local date for `<input type="date">`, and back. Blank means no plan. */
const toDateInput = (ms?: number) => {
  if (ms === undefined) return '';
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const fromDateInput = (value: string): number | undefined => {
  if (!value) return undefined;
  const ms = new Date(`${value}T00:00:00`).getTime();
  return Number.isFinite(ms) ? ms : undefined;
};

const dayOf = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

/** `8–10 Aug`, or a single day. Used for both a real span and a plan. */
function rangeLabel(start?: number, end?: number): string {
  if (start === undefined) return '';
  if (end === undefined || dayOf(end) === dayOf(start)) return dayOf(start);
  return `${dayOf(start)} – ${dayOf(end)}`;
}

function SessionManager({
  sessions, events, orders, onResume, onEnd, onRename, onGroup, onUngroup,
  onMoveSession, onMakeEvent, onCreateEvent, onEditEvent, onDeleteEvent,
  onStartInto, onClose,
}: SessionBarProps & {
  /**
   * Hands the gesture back to the bar rather than starting a session from
   * behind a modal. Starting one is not undoable — it hands out kitchen ticket
   * numbers — so it happens where the shop can see the till, with the bar's own
   * name field in front of it and this event already chosen.
   */
  onStartInto: (eventId: string) => void;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [eventName, setEventName] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  /** `'new'`, or the id of the event being edited. Only one form at a time. */
  const [editing, setEditing] = useState<string | null>(null);
  /** Why the last deletion was refused. Cleared by the next action. */
  const [refusal, setRefusal] = useState<string | null>(null);

  const listings = useMemo(() => allEvents(events, sessions), [events, sessions]);
  const loose = useMemo(() => ungroupedSessions(events, sessions), [events, sessions]);
  const resumable = useMemo(() => new Set(resumableSessions(sessions).map(s => s.id)), [sessions]);

  const counts = useMemo(() => {
    const map = new Map<string, { orders: number; revenue: number }>();
    for (const o of orders) {
      if (!o.sessionId || o.voidedAt) continue;
      const row = map.get(o.sessionId) ?? { orders: 0, revenue: 0 };
      row.orders += 1;
      row.revenue += o.subtotal - (o.discountAmount ?? 0);
      map.set(o.sessionId, row);
    }
    return map;
  }, [orders]);

  const toggle = (id: string) => setPicked(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const sessionRow = (s: TradingSession, inEvent: boolean) => (
    <SessionRow
      key={s.id}
      session={s}
      stat={counts.get(s.id) ?? { orders: 0, revenue: 0 }}
      inEvent={inEvent}
      picked={picked.has(s.id)}
      onToggle={() => toggle(s.id)}
      renaming={renaming === s.id}
      renameDraft={renameDraft}
      onRenameDraft={setRenameDraft}
      onStartRename={() => { setRenaming(s.id); setRenameDraft(s.name); }}
      onCommitRename={() => { onRename(s.id, renameDraft); setRenaming(null); }}
      events={listings}
      resumable={resumable.has(s.id)}
      onResume={() => { onResume(s.id); onClose(); }}
      onEnd={() => { onEnd(); onClose(); }}
      onMove={eventId => { setRefusal(null); onMoveSession(s.id, eventId); }}
      onDetach={() => { setRefusal(null); onUngroup(s.id); }}
      onMakeEvent={() => { setRefusal(null); onMakeEvent(s.id); }}
    />
  );

  return (
    <motion.div
      className="fixed inset-0 z-[120] flex items-center justify-center p-[24px]"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      transition={{ duration: 0.12 }}
      style={{ background: 'rgba(6,6,8,0.6)', backdropFilter: 'blur(6px)' }}
      onClick={onClose}
      data-session-manager
    >
      <motion.div
        initial={{ scale: 0.96, y: 10 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.97, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 480, damping: 34 }}
        onClick={e => e.stopPropagation()}
        className="bg-[var(--app-bg-darker)] border border-[var(--app-border)] rounded-[16px] p-[20px] w-full max-w-[680px] max-h-[80vh] flex flex-col"
      >
        <div className="flex items-center gap-[10px] mb-[4px]">
          <h3 className="text-[var(--app-text)] text-[18px] font-bold">Sessions &amp; Events</h3>
          <button
            onClick={() => { setRefusal(null); setEditing(editing === 'new' ? null : 'new'); }}
            data-new-event
            className="ml-auto flex items-center gap-[6px] text-[12px] font-semibold px-[10px] h-[30px] rounded-[8px] border"
            style={{ borderColor: ACCENT, color: ACCENT }}
          >
            <Plus size={13} /> New event
          </button>
          <button onClick={onClose} className="text-[var(--app-text-muted)]"><X size={17} /></button>
        </div>
        <p className="text-[var(--app-text-muted)] text-[12px] leading-[17px] mb-[12px]">
          An event is a market, and its sessions are the days it ran. Make one ahead of time and
          the pitch fee has somewhere to go on the morning it is paid — you do not have to wait
          until the market is over to say it happened.
        </p>

        <AnimatePresence>
          {editing === 'new' && (
            <EventForm
              key="new"
              onCancel={() => setEditing(null)}
              onSubmit={(name, details) => { onCreateEvent(name, details); setEditing(null); }}
            />
          )}
        </AnimatePresence>

        {refusal && (
          <p
            className="text-[12px] leading-[17px] rounded-[9px] px-[11px] py-[8px] mb-[10px]"
            data-delete-refused
            style={{ background: `${DANGER}18`, color: DANGER }}
          >
            {refusal}
          </p>
        )}

        <div className="flex-1 min-h-0 overflow-auto flex flex-col gap-[8px]">
          {listings.length === 0 && loose.length === 0 && (
            <p className="text-[var(--app-text-muted)] text-[13px] py-[20px] text-center">
              No sessions yet. Starting one numbers its tickets from 1 and gives every order,
              cost and stock movement taken during it a common key.
            </p>
          )}

          {listings.map(listing => (
            <div
              key={listing.event.id}
              data-event-row={listing.event.id}
              className="rounded-[12px] border border-[var(--app-border)] bg-[var(--app-surface)] p-[11px]"
            >
              <div className="flex items-center gap-[7px] mb-[8px] flex-wrap">
                <Tag size={13} style={{ color: ACCENT }} />
                <span className="text-[var(--app-text)] text-[13px] font-semibold">
                  {listing.event.name}
                </span>
                <EventStatusPill status={listing.status} />
                <span className="text-[var(--app-text-muted)] text-[11px]">
                  {describeEvent(listing)}
                </span>
                {listing.event.venue && (
                  <span className="flex items-center gap-[4px] text-[var(--app-text-muted)] text-[11px]">
                    <MapPin size={11} /> {listing.event.venue}
                  </span>
                )}

                <span className="ml-auto flex items-center gap-[6px]">
                  <button
                    onClick={() => {
                      setRefusal(null);
                      setEditing(editing === listing.event.id ? null : listing.event.id);
                    }}
                    data-edit-event={listing.event.id}
                    className="text-[11px] font-semibold text-[var(--app-text-muted)] hover:text-[var(--app-text)] px-[6px] h-[22px] rounded-[5px]"
                  >
                    edit
                  </button>
                  <Popover
                    label={listing.event.name}
                    width={260}
                    trigger={({ toggle: openMenu }) => (
                      <button
                        onClick={openMenu}
                        data-event-menu={listing.event.id}
                        aria-label={`More for ${listing.event.name}`}
                        className="text-[var(--app-text-muted)] hover:text-[var(--app-text)] p-[2px] rounded-[5px]"
                      >
                        <MoreHorizontal size={15} />
                      </button>
                    )}
                  >
                    {close => (
                      <>
                        <PopoverItem
                          title="Rename, dates and venue"
                          onClick={() => {
                            setRefusal(null);
                            setEditing(listing.event.id);
                            close();
                          }}
                        />
                        <PopoverItem
                          title="Delete this event"
                          detail={
                            listing.sessions.length > 0
                              ? `Its ${listing.sessions.length} session${listing.sessions.length === 1 ? '' : 's'} stay, out of any event.`
                              : 'Nothing is in it.'
                          }
                          data-delete-event={listing.event.id}
                          onClick={() => {
                            const result = onDeleteEvent(listing.event.id);
                            setRefusal(result.ok ? null : result.reason);
                            close();
                          }}
                        />
                      </>
                    )}
                  </Popover>
                </span>
              </div>

              <AnimatePresence>
                {editing === listing.event.id && (
                  <EventForm
                    key={listing.event.id}
                    event={listing.event}
                    onCancel={() => setEditing(null)}
                    onSubmit={(name, details) => {
                      onEditEvent(listing.event.id, { name, ...details });
                      setEditing(null);
                    }}
                  />
                )}
              </AnimatePresence>

              {listing.sessions.length === 0 ? (
                // The whole point of creating an event ahead of time is that the
                // first day of the market starts *into* it, so the offer to do
                // that is here rather than three taps away in the strip.
                <div className="flex items-center gap-[10px] px-[9px] py-[8px] rounded-[9px] bg-[var(--app-bg-darker)]">
                  <span className="text-[var(--app-text-muted)] text-[12px]">no sessions yet</span>
                  <button
                    onClick={() => onStartInto(listing.event.id)}
                    data-start-into={listing.event.id}
                    className="ml-auto text-[11px] font-semibold px-[9px] h-[24px] rounded-[6px] border shrink-0"
                    style={{ borderColor: ACCENT, color: ACCENT }}
                  >
                    start a session
                  </button>
                </div>
              ) : (
                <div className="flex flex-col gap-[5px]">
                  {listing.sessions.map(s => sessionRow(s, true))}
                </div>
              )}
            </div>
          ))}

          {loose.length > 0 && (
            <>
              <div className="flex items-center gap-[9px] mt-[4px]">
                <span className="text-[var(--app-text-muted)] text-[11px] font-semibold uppercase tracking-[0.5px]">
                  Not in an event
                </span>
                <span className="flex-1 h-px" style={{ background: 'var(--app-border)' }} />
              </div>
              <div className="rounded-[12px] border border-[var(--app-border)] bg-[var(--app-surface)] p-[11px] flex flex-col gap-[5px]">
                {loose.map(s => sessionRow(s, false))}
              </div>
            </>
          )}
        </div>

        {/*
          The bulk path, kept. Ticking a week's worth of ungrouped sessions and
          naming them once is still the fastest way to fix a month nobody
          grouped; it is now one route in rather than the only one, and one
          session is enough (ADR-020).
        */}
        <AnimatePresence>
          {picked.size >= 1 && (
            <motion.form
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
              onSubmit={e => {
                e.preventDefault();
                setRefusal(null);
                onGroup([...picked], eventName);
                setPicked(new Set());
                setEventName('');
              }}
            >
              <div className="flex items-center gap-[8px] mt-[12px] pt-[12px] border-t border-[var(--app-border)]">
                <input
                  value={eventName}
                  onChange={e => setEventName(capitalizeFirst(e.target.value))}
                  placeholder="Event name"
                  data-event-name-input
                  className="flex-1 bg-[var(--app-surface)] border border-[var(--app-border)] rounded-[9px] px-[12px] h-[38px] text-[var(--app-text)] text-[13px] focus:outline-none"
                />
                <Button type="submit" variant="primary" size="sm" data-group-sessions hint={HINT.groupSessions}>
                  {picked.size === 1 ? 'Make this an event' : `Group ${picked.size} into event`}
                </Button>
              </div>
            </motion.form>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
}

/** What an event's row says after its status word. */
function describeEvent(listing: EventListing): string {
  const count = listing.sessions.length;
  const sessionWord = count === 1 ? '1 session' : `${count} sessions`;
  if (listing.span) {
    return `${sessionWord} · ${rangeLabel(listing.span.start, listing.span.end)}`;
  }
  const planned = rangeLabel(listing.event.plannedStart, listing.event.plannedEnd);
  // A plan reads as a plan. The dates column is where a measurement lives, and
  // putting an intention in it unlabelled is how a plan becomes a record.
  return planned ? `planned for ${planned}` : 'no dates set';
}

/* ------------------------------------------------------------- session row */

function SessionRow({
  session: s, stat, inEvent, picked, onToggle, renaming, renameDraft, onRenameDraft,
  onStartRename, onCommitRename, events, resumable, onResume, onEnd, onMove, onDetach,
  onMakeEvent,
}: {
  session: TradingSession;
  stat: { orders: number; revenue: number };
  inEvent: boolean;
  picked: boolean;
  onToggle: () => void;
  renaming: boolean;
  renameDraft: string;
  onRenameDraft: (value: string) => void;
  onStartRename: () => void;
  onCommitRename: () => void;
  events: EventListing[];
  resumable: boolean;
  onResume: () => void;
  onEnd: () => void;
  onMove: (eventId?: string) => void;
  onDetach: () => void;
  onMakeEvent: () => void;
}) {
  const dateLabel = rangeLabel(s.startedAt, s.endedAt);
  const elsewhere = events.filter(e => e.event.id !== s.eventId);

  return (
    <div
      className="flex items-center gap-[9px] rounded-[9px] px-[9px] py-[7px] flex-wrap"
      style={{ background: picked ? `${ACCENT}14` : 'var(--app-bg-darker)' }}
      data-session-row={s.id}
    >
      <button
        onClick={onToggle}
        className="w-[17px] h-[17px] rounded-[5px] border flex items-center justify-center shrink-0"
        style={{
          borderColor: picked ? ACCENT : 'var(--app-border)',
          background: picked ? ACCENT : 'transparent',
        }}
        aria-label="Select session"
      >
        {picked && <Check size={11} color="#1B1206" />}
      </button>

      {renaming ? (
        <form
          className="flex items-center gap-[6px] flex-1"
          onSubmit={e => { e.preventDefault(); onCommitRename(); }}
        >
          <input
            autoFocus
            value={renameDraft}
            onChange={e => onRenameDraft(capitalizeFirst(e.target.value))}
            className="flex-1 bg-[var(--app-surface)] border border-[var(--app-border)] rounded-[7px] px-[9px] h-[28px] text-[var(--app-text)] text-[12px] focus:outline-none"
          />
          <button type="submit" className="text-[12px] font-semibold" style={{ color: ACCENT }}>
            Save
          </button>
        </form>
      ) : (
        <Tooltip label="Tap the name to change it.">
          <button
            onClick={onStartRename}
            className="text-left text-[var(--app-text)] text-[13px] font-semibold truncate"
            aria-label="Rename this session"
          >
            {s.name}
          </button>
        </Tooltip>
      )}

      <span className="flex items-center gap-[5px] text-[var(--app-text-muted)] text-[11px] ml-auto shrink-0">
        <CalendarDays size={11} /> {dateLabel}
      </span>
      <span className="text-[var(--app-text-muted)] text-[11px] tabular-nums shrink-0 w-[68px] text-right">
        {stat.orders} order{stat.orders === 1 ? '' : 's'}
      </span>
      <StatusPill status={s.status} />

      {resumable && s.status === 'paused' && (
        <button
          onClick={onResume}
          data-session-resume-row={s.id}
          className="text-[11px] font-semibold px-[9px] h-[24px] rounded-[6px] border shrink-0"
          style={{ borderColor: ACCENT, color: ACCENT }}
        >
          Resume
        </button>
      )}

      <Popover
        label={s.name}
        width={280}
        trigger={({ toggle }) => (
          <button
            onClick={toggle}
            data-session-menu={s.id}
            aria-label={`More for ${s.name}`}
            className="text-[var(--app-text-muted)] hover:text-[var(--app-text)] shrink-0 p-[2px] rounded-[5px]"
          >
            <MoreHorizontal size={15} />
          </button>
        )}
      >
        {close => (
          <>
            <PopoverItem title="Rename" onClick={() => { onStartRename(); close(); }} />
            {s.status === 'paused' && (
              <PopoverItem title="Resume" onClick={() => { onResume(); close(); }} />
            )}
            {s.status === 'active' && (
              <PopoverItem
                title="End this session"
                detail="Nothing is deleted. Every order keeps its session."
                onClick={() => { onEnd(); close(); }}
              />
            )}
            {!inEvent && (
              // The action 1C-ii-b's cost form links to. A real event of one is
              // a fact a person stated; a lone session presented as an event of
              // one is not, and `ResolvedScope.eventId` is what tells them apart.
              <PopoverItem
                title="Make this an event"
                detail="A market of one day, named. A pitch fee can then be charged to it."
                data-make-event={s.id}
                onClick={() => { onMakeEvent(); close(); }}
              />
            )}
            {elsewhere.length > 0 && (
              <>
                <PopoverItem
                  title="Move into…"
                  detail="An event that already exists."
                  disabled
                />
                {elsewhere.map(({ event, status }) => (
                  <PopoverItem
                    key={event.id}
                    title={event.name}
                    detail={STATUS_WORD[status]}
                    icon={<Tag size={14} />}
                    data-move-into={event.id}
                    onClick={() => { onMove(event.id); close(); }}
                  />
                ))}
              </>
            )}
            {inEvent && (
              <PopoverItem
                title="Take out of its event"
                detail={HINT.ungroupSession}
                data-detach-session={s.id}
                onClick={() => { onDetach(); close(); }}
              />
            )}
          </>
        )}
      </Popover>
    </div>
  );
}

/* -------------------------------------------------------------- event form */

/**
 * Making an event, or editing one. The same fields either way, because they are
 * the same fields — an event created ahead and an event named after the fact
 * differ only in whether anything has traded yet.
 */
function EventForm({
  event, onSubmit, onCancel,
}: {
  event?: TradingEvent;
  onSubmit: (name: string, details: EventDetails) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(event?.name ?? '');
  const [start, setStart] = useState(toDateInput(event?.plannedStart));
  const [end, setEnd] = useState(toDateInput(event?.plannedEnd));
  const [venue, setVenue] = useState(event?.venue ?? '');

  return (
    <motion.form
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      className="overflow-hidden"
      data-event-form={event?.id ?? 'new'}
      onSubmit={e => {
        e.preventDefault();
        if (!name.trim() && !event) return;
        onSubmit(name, {
          plannedStart: fromDateInput(start),
          plannedEnd: fromDateInput(end),
          venue,
        });
      }}
    >
      <div className="flex flex-col gap-[8px] mb-[12px] p-[11px] rounded-[12px] border" style={{ borderColor: `${ACCENT}55` }}>
        <div className="flex items-center gap-[8px] flex-wrap">
          <input
            autoFocus
            value={name}
            onChange={e => setName(capitalizeFirst(e.target.value))}
            placeholder="Event name"
            data-event-form-name
            className="flex-1 min-w-[160px] bg-[var(--app-surface)] border border-[var(--app-border)] rounded-[9px] px-[12px] h-[34px] text-[var(--app-text)] text-[13px] focus:outline-none"
          />
          <input
            value={venue}
            onChange={e => setVenue(capitalizeFirst(e.target.value))}
            placeholder="Venue (optional)"
            data-event-form-venue
            className="flex-1 min-w-[140px] bg-[var(--app-surface)] border border-[var(--app-border)] rounded-[9px] px-[12px] h-[34px] text-[var(--app-text)] text-[13px] focus:outline-none"
          />
        </div>
        <div className="flex items-center gap-[8px] flex-wrap">
          <input
            type="date"
            value={start}
            onChange={e => setStart(e.target.value)}
            data-event-form-start
            className="bg-[var(--app-surface)] border border-[var(--app-border)] rounded-[9px] px-[10px] h-[34px] text-[var(--app-text)] text-[12px] focus:outline-none"
          />
          <span className="text-[var(--app-text-muted)] text-[12px]">to</span>
          <input
            type="date"
            value={end}
            onChange={e => setEnd(e.target.value)}
            data-event-form-end
            className="bg-[var(--app-surface)] border border-[var(--app-border)] rounded-[9px] px-[10px] h-[34px] text-[var(--app-text)] text-[12px] focus:outline-none"
          />
          <span className="text-[var(--app-text-muted)] text-[11px] leading-[15px] flex-1 min-w-[200px]">
            When it is meant to run. A plan — what the event actually spanned still
            comes from its sessions.
          </span>
          <Button type="submit" variant="primary" size="sm" data-event-form-save>
            {event ? 'Save' : 'Create event'}
          </Button>
          <button type="button" onClick={onCancel} className="text-[var(--app-text-muted)] px-[6px]">
            <X size={15} />
          </button>
        </div>
      </div>
    </motion.form>
  );
}

/* ---------------------------------------------------------------- the pills */

function EventStatusPill({ status }: { status: EventStatus }) {
  const tone = status === 'active' ? GOOD : status === 'planned' ? ACCENT : 'var(--app-text-muted)';
  return (
    <span
      className="text-[10px] font-bold uppercase tracking-[0.4px] px-[7px] h-[19px] rounded-[5px] flex items-center shrink-0"
      data-event-status={status}
      style={{ color: tone, border: `1px solid ${status === 'ended' ? 'var(--app-border)' : tone}` }}
    >
      {STATUS_WORD[status]}
    </span>
  );
}

function StatusPill({ status }: { status: TradingSession['status'] }) {
  const tone = status === 'active' ? GOOD : status === 'paused' ? ACCENT : 'var(--app-text-muted)';
  return (
    <span
      className="text-[10px] font-bold uppercase tracking-[0.4px] px-[7px] h-[20px] rounded-[5px] flex items-center shrink-0 w-[64px] justify-center"
      style={{ color: tone, border: `1px solid ${status === 'ended' ? 'var(--app-border)' : tone}` }}
    >
      {status}
    </span>
  );
}
