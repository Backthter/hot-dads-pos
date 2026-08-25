import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { CalendarRange, ChevronDown, Layers, Tag } from 'lucide-react';
import {
  HINT, Popover, PopoverDivider, PopoverItem, PopoverNote, PopoverSection, Tooltip,
  alpha, useSection,
} from '../ui';
import { eventGroups } from '../lib/sessions';
import type { RangePreset } from './metrics';
import type { ResolvedScope, Scope } from './scope';
import type { TradingEvent, TradingSession } from '../types';

/**
 * The one control that says what the screen is looking at.
 *
 * It replaces a corner range picker that could only think in calendars. This
 * business does not trade in calendars — it trades in events — and "last 30
 * days" for a stall that works two markets a month is a window mostly made of
 * days when the van was parked.
 *
 * Events come first in the list and dates second, because that is the order
 * they are wanted in. Picking either replaces the other outright: two filters
 * that can disagree are worse than one that cannot.
 *
 * **The list is hierarchical, and `Scope` is not.** An event shows the sessions
 * it contains, indented under it, because two parallel flat lists never said
 * that Winter Market *is* Saturday, Sunday and Monday — which is what made
 * "charged once for the whole event" read as a phrase rather than as a thing on
 * screen. Selecting the header scopes to the event and selecting a child scopes
 * to that session; `Scope` still has its three shapes and only one is ever in
 * force. This is presentation, and the two-filters-that-disagree reasoning is
 * untouched.
 *
 * **No money here.** This control renders in the nav slot, which is outside the
 * revenue lock — the same hole the export menu sits in (`docs/OPEN.md`). Per
 * session takings in this list would put revenue in front of a user with no
 * PIN, so the rows carry dates and counts and nothing a lock would hide.
 * ADR-019 keeps order counts unlocked; takings are Phase 6's to let out, if
 * anyone ever should.
 */

const PRESETS: { id: RangePreset; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'last7', label: 'Last 7 days' },
  { id: 'last30', label: 'Last 30 days' },
  { id: 'thisMonth', label: 'This month' },
  { id: 'lastMonth', label: 'Last month' },
  { id: 'thisYear', label: 'This year' },
  { id: 'all', label: 'All time' },
];

export function ScopePicker({
  resolved, sessions, events, onChange,
}: {
  resolved: ResolvedScope;
  sessions: TradingSession[];
  events: TradingEvent[];
  onChange: (scope: Scope) => void;
}) {
  const theme = useSection();
  const groups = useMemo(() => eventGroups(events, sessions), [events, sessions]);

  const activeId = resolved.sessionScoped
    ? (resolved.scope.kind === 'event' || resolved.scope.kind === 'session' ? resolved.scope.id : '')
    : '';

  /*
   * Which events are showing their sessions.
   *
   * Held as the set of events that have been *collapsed*, so the default is
   * open: the containment is the thing this list gained, and an event that has
   * to be opened before it shows what it contains has not shown it. Local
   * presentation state, deliberately not sticky — it is which way a disclosure
   * happens to be pointing, not where the shop was.
   */
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const expanded = (id: string) => !collapsed.has(id);
  const toggle = (id: string) => setCollapsed(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  const dayLabel = (ms: number) =>
    new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

  /** `14–16 Aug` for a market that ran three days, `14 Aug` for one that ran one. */
  const spanLabel = (group: { startedAt: number; endedAt?: number }) => {
    const start = dayLabel(group.startedAt);
    if (group.endedAt === undefined) return start;
    const end = dayLabel(group.endedAt);
    return start === end ? start : `${start}–${end}`;
  };

  return (
    <Popover
      label="What these figures cover"
      width={330}
      trigger={({ open, toggle }) => (
        <Tooltip label={HINT.scopePicker}>
          <button
            onClick={toggle}
            data-scope-picker
            className="flex items-center gap-[10px] px-[15px] h-[46px] rounded-[11px] border transition-colors duration-150"
            style={{
              background: alpha(theme.color, 0.14),
              borderColor: open ? theme.color : alpha(theme.color, 0.5),
              color: theme.color,
              boxShadow: open ? `0 0 0 4px ${alpha(theme.color, 0.18)}` : 'none',
            }}
          >
            {resolved.sessionScoped ? <Layers size={18} /> : <CalendarRange size={18} />}
            <span className="flex flex-col items-start leading-none gap-[3px]">
              <span className="text-[15px] font-bold">{resolved.label}</span>
              <span className="text-[10.5px] opacity-75 font-medium">{resolved.detail}</span>
            </span>
            <motion.span animate={{ rotate: open ? 180 : 0 }} className="flex">
              <ChevronDown size={17} />
            </motion.span>
          </button>
        </Tooltip>
      )}
    >
      {close => {
        const pick = (scope: Scope) => { onChange(scope); close(); };
        return (
          <>
            <PopoverSection>Events and sessions</PopoverSection>
            {/* Shown even when empty. Hiding the section entirely made it look
                as though scoping by event was not a feature, when in fact
                there was simply nothing to scope by yet. */}
            {groups.length === 0 && (
              <PopoverNote>
                No sessions yet. Start one from All Orders and it will appear here — everything
                sold during it can then be reported on its own, and several sessions can be
                grouped together as one event.
              </PopoverNote>
            )}
            {groups.slice(0, 12).map(group => {
              /*
               * A real event and a lone session are two different things that
               * used to draw identically, and they scope to different things:
               * picking the event gives `{ kind: 'event' }`, picking the
               * session gives `{ kind: 'session' }`, and only the first can
               * carry a per-event cost (ADR-018). `grouped` is the distinction,
               * and an event of one is grouped — it is a market the shop named,
               * which is what ADR-020 made legitimate.
               */
              if (!group.grouped) {
                const session = group.sessions[0];
                const selected = resolved.scope.kind === 'session' && resolved.scope.id === session.id;
                return (
                  <PopoverItem
                    key={group.id}
                    data-scope-group={group.id}
                    data-scope-loose-session={session.id}
                    selected={selected}
                    icon={<Layers size={15} />}
                    title={group.name}
                    detail={`${dayLabel(group.startedAt)} · not in an event`}
                    onClick={() => pick({ kind: 'session', id: session.id })}
                  />
                );
              }

              const open = expanded(group.id);
              return (
                <div key={group.id} className="flex flex-col">
                  <PopoverItem
                    data-scope-group={group.id}
                    data-scope-event={group.id}
                    selected={activeId === group.id}
                    icon={<Tag size={15} />}
                    title={group.name}
                    detail={`${group.sessions.length} session${group.sessions.length === 1 ? '' : 's'} · ${spanLabel(group)}`}
                    onClick={() => pick({ kind: 'event', id: group.id })}
                    trailing={(
                      /*
                       * Expanding is not selecting. The header scopes to the
                       * whole event and the chevron only opens it, so a shop
                       * looking at what a market contained does not have to
                       * change what the screen is showing to find out.
                       */
                      <span
                        role="button"
                        tabIndex={0}
                        aria-label={open ? `Collapse ${group.name}` : `Expand ${group.name}`}
                        data-scope-expand={group.id}
                        className="flex p-[3px] -m-[3px] rounded-[6px]"
                        style={{ color: 'var(--app-text-muted)' }}
                        onClick={e => { e.stopPropagation(); toggle(group.id); }}
                        onKeyDown={e => {
                          if (e.key !== 'Enter' && e.key !== ' ') return;
                          e.preventDefault();
                          e.stopPropagation();
                          toggle(group.id);
                        }}
                      >
                        <motion.span animate={{ rotate: open ? 0 : -90 }} className="flex">
                          <ChevronDown size={15} />
                        </motion.span>
                      </span>
                    )}
                  />
                  {open && group.sessions.map(session => (
                    <div key={session.id} className="pl-[22px]">
                      <PopoverItem
                        data-scope-session={session.id}
                        selected={resolved.scope.kind === 'session' && resolved.scope.id === session.id}
                        icon={<Layers size={13} />}
                        title={session.name}
                        detail={dayLabel(session.startedAt)}
                        onClick={() => pick({ kind: 'session', id: session.id })}
                      />
                    </div>
                  ))}
                </div>
              );
            })}

            <PopoverDivider />
            <PopoverSection>Dates</PopoverSection>
            {PRESETS.map(p => (
              <PopoverItem
                key={p.id}
                data-range={p.id}
                title={p.label}
                selected={!resolved.sessionScoped
                  && resolved.scope.kind === 'range' && resolved.scope.preset === p.id}
                onClick={() => pick({ kind: 'range', preset: p.id })}
              />
            ))}
          </>
        );
      }}
    </Popover>
  );
}
