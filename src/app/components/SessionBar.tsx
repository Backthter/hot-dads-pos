import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  CalendarDays, Check, Layers, Pause, Play, Square, Tag, X,
} from 'lucide-react';
import {
  eventGroups, resumableSessions, sessionTradingHours,
} from '../lib/sessions';
import { Button, HINT, SECTION_COLOR, Tooltip, capitalizeFirst } from '../ui';
import type { Order, TradingEvent, TradingSession } from '../types';

/**
 * Session controls for the All Orders screen.
 *
 * The bar answers three questions without being asked: whether a session is
 * live, how long it has actually traded, and how many tickets it has taken.
 * Everything else — resuming, renaming, grouping into events — lives behind one
 * button, because those are things you do between services, not during one.
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
  onStart: (name: string) => void;
  onPause: () => void;
  onResume: (sessionId: string) => void;
  onEnd: () => void;
  onRename: (sessionId: string, name: string) => void;
  onGroup: (sessionIds: string[], eventName: string) => void;
  onUngroup: (sessionId: string) => void;
}

export function SessionBar(props: SessionBarProps) {
  const { sessions, events, orders, onStart, onPause, onResume, onEnd } = props;
  const [managing, setManaging] = useState(false);
  const [naming, setNaming] = useState(false);
  const [draftName, setDraftName] = useState('');

  const live = sessions.find(s => s.status === 'active') ?? null;
  const paused = sessions.filter(s => s.status === 'paused');

  const ticketCount = useMemo(
    () => (live ? orders.filter(o => o.sessionId === live.id && !o.voidedAt).length : 0),
    [orders, live],
  );

  const hours = live ? sessionTradingHours(live, Date.now()) : 0;

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
              <form
                onSubmit={e => {
                  e.preventDefault();
                  onStart(draftName);
                  setDraftName('');
                  setNaming(false);
                }}
                className="flex items-center gap-[8px]"
              >
                <input
                  autoFocus
                  value={draftName}
                  onChange={e => setDraftName(capitalizeFirst(e.target.value))}
                  placeholder="Session name (optional)"
                  data-session-name-input
                  className="bg-[var(--app-surface)] border border-[var(--app-border)] rounded-[9px] px-[12px] h-[38px] text-[var(--app-text)] text-[13px] w-[240px] focus:outline-none"
                  style={{ borderColor: ACCENT }}
                />
                <Button type="submit" variant="primary" size="sm" data-session-start-confirm>
                  Start
                </Button>
                <button
                  type="button"
                  onClick={() => { setNaming(false); setDraftName(''); }}
                  className="text-[var(--app-text-muted)] px-[6px]"
                >
                  <X size={16} />
                </button>
              </form>
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
          <SessionManager {...props} onClose={() => setManaging(false)} />
        )}
      </AnimatePresence>
    </>
  );
}

/* ------------------------------------------------------------------ manager */

function SessionManager({
  sessions, events, orders, onResume, onRename, onGroup, onUngroup, onClose,
}: SessionBarProps & { onClose: () => void }) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [eventName, setEventName] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');

  const groups = useMemo(() => eventGroups(events, sessions), [events, sessions]);
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

  const dateLabel = (s: TradingSession) => {
    const start = new Date(s.startedAt);
    const end = s.endedAt ? new Date(s.endedAt) : null;
    const day = start.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    const endDay = end?.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    return endDay && endDay !== day ? `${day} – ${endDay}` : day;
  };

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
        className="bg-[var(--app-bg-darker)] border border-[var(--app-border)] rounded-[16px] p-[20px] w-full max-w-[620px] max-h-[80vh] flex flex-col"
      >
        <div className="flex items-baseline gap-[10px] mb-[4px]">
          <h3 className="text-[var(--app-text)] text-[18px] font-bold">Sessions</h3>
          <button onClick={onClose} className="ml-auto text-[var(--app-text-muted)]"><X size={17} /></button>
        </div>
        <p className="text-[var(--app-text-muted)] text-[12px] leading-[17px] mb-[14px]">
          Tick two or more sessions to group them into one event — a three-day market run as
          three services is one event, and analytics will report it that way.
        </p>

        <div className="flex-1 min-h-0 overflow-auto flex flex-col gap-[8px]">
          {groups.length === 0 && (
            <p className="text-[var(--app-text-muted)] text-[13px] py-[20px] text-center">
              No sessions yet. Starting one numbers its tickets from 1 and gives every order,
              cost and stock movement taken during it a common key.
            </p>
          )}

          {groups.map(group => (
            <div
              key={group.id}
              className="rounded-[12px] border border-[var(--app-border)] bg-[var(--app-surface)] p-[11px]"
            >
              {group.grouped && (
                <div className="flex items-center gap-[7px] mb-[8px]">
                  <Tag size={13} style={{ color: ACCENT }} />
                  <span className="text-[var(--app-text)] text-[13px] font-semibold">{group.name}</span>
                  <span className="text-[var(--app-text-muted)] text-[11px]">
                    {group.sessions.length} session{group.sessions.length === 1 ? '' : 's'}
                  </span>
                </div>
              )}

              <div className="flex flex-col gap-[5px]">
                {group.sessions.map(s => {
                  const stat = counts.get(s.id) ?? { orders: 0, revenue: 0 };
                  return (
                    <div
                      key={s.id}
                      className="flex items-center gap-[9px] rounded-[9px] px-[9px] py-[7px]"
                      style={{ background: picked.has(s.id) ? `${ACCENT}14` : 'var(--app-bg-darker)' }}
                      data-session-row={s.id}
                    >
                      <button
                        onClick={() => toggle(s.id)}
                        className="w-[17px] h-[17px] rounded-[5px] border flex items-center justify-center shrink-0"
                        style={{
                          borderColor: picked.has(s.id) ? ACCENT : 'var(--app-border)',
                          background: picked.has(s.id) ? ACCENT : 'transparent',
                        }}
                        aria-label="Select session"
                      >
                        {picked.has(s.id) && <Check size={11} color="#1B1206" />}
                      </button>

                      {renaming === s.id ? (
                        <form
                          className="flex items-center gap-[6px] flex-1"
                          onSubmit={e => {
                            e.preventDefault();
                            onRename(s.id, renameDraft);
                            setRenaming(null);
                          }}
                        >
                          <input
                            autoFocus
                            value={renameDraft}
                            onChange={e => setRenameDraft(capitalizeFirst(e.target.value))}
                            className="flex-1 bg-[var(--app-surface)] border border-[var(--app-border)] rounded-[7px] px-[9px] h-[28px] text-[var(--app-text)] text-[12px] focus:outline-none"
                          />
                          <button type="submit" className="text-[12px] font-semibold" style={{ color: ACCENT }}>
                            Save
                          </button>
                        </form>
                      ) : (
                        <Tooltip label="Tap the name to change it.">
                          <button
                            onClick={() => { setRenaming(s.id); setRenameDraft(s.name); }}
                            className="text-left text-[var(--app-text)] text-[13px] font-semibold truncate"
                            aria-label="Rename this session"
                          >
                            {s.name}
                          </button>
                        </Tooltip>
                      )}

                      <span className="flex items-center gap-[5px] text-[var(--app-text-muted)] text-[11px] ml-auto shrink-0">
                        <CalendarDays size={11} /> {dateLabel(s)}
                      </span>
                      <span className="text-[var(--app-text-muted)] text-[11px] tabular-nums shrink-0 w-[68px] text-right">
                        {stat.orders} order{stat.orders === 1 ? '' : 's'}
                      </span>
                      <StatusPill status={s.status} />

                      {resumable.has(s.id) && s.status === 'paused' && (
                        <button
                          onClick={() => { onResume(s.id); onClose(); }}
                          data-session-resume-row={s.id}
                          className="text-[11px] font-semibold px-[9px] h-[24px] rounded-[6px] border shrink-0"
                          style={{ borderColor: ACCENT, color: ACCENT }}
                        >
                          Resume
                        </button>
                      )}
                      {group.grouped && (
                        <Tooltip label={HINT.ungroupSession}>
                          <button
                            onClick={() => onUngroup(s.id)}
                            className="text-[var(--app-text-muted)] hover:text-[var(--app-text)] shrink-0 p-[2px] rounded-[5px]"
                            aria-label="Take this session out of its event"
                          >
                            <X size={13} />
                          </button>
                        </Tooltip>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <AnimatePresence>
          {picked.size >= 2 && (
            <motion.form
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
              onSubmit={e => {
                e.preventDefault();
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
                  Group {picked.size} into event
                </Button>
              </div>
            </motion.form>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
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
