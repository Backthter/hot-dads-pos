import { useMemo } from 'react';
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

  const dayLabel = (ms: number) =>
    new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

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
              const selected = activeId === group.id
                || (!group.grouped && resolved.scope.kind === 'session' && resolved.scope.id === group.sessions[0]?.id);
              return (
                <PopoverItem
                  key={group.id}
                  data-scope-group={group.id}
                  selected={selected}
                  icon={group.grouped ? <Tag size={15} /> : <Layers size={15} />}
                  title={group.name}
                  detail={`${group.grouped ? `${group.sessions.length} sessions · ` : ''}${dayLabel(group.startedAt)}`}
                  onClick={() => pick(group.grouped
                    ? { kind: 'event', id: group.id }
                    : { kind: 'session', id: group.sessions[0].id })}
                />
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
