import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Coins, Info, Plus, Trash2 } from 'lucide-react';
import { ACCENT, DANGER, Panel, money } from './AnalyticsUI';
import { Button, HINT, Select, TextInput, Tooltip, alpha } from '../ui';
import { costSummary } from './metrics';
import type { CostEntry, CostKind, TradingEvent, TradingSession } from '../types';

/**
 * The costs ledger.
 *
 * Ingredient cost comes out of the stock ledger on its own and needs no typing.
 * Everything else — the pitch fee, the staff, the gas, the packaging — is
 * invisible to a till, so the app runs perfectly well without it and simply
 * cannot answer certain questions until it is there. That is the trade this
 * screen makes explicit: log what you spent, get break-even back.
 *
 * Two fields and a toggle, deliberately. A form long enough to feel like
 * bookkeeping is a form nobody fills in at the end of a market day, and a cost
 * ledger with gaps in it is worse than none — it looks complete.
 */
export function CostsPanel({
  costs, sessions, events, onAdd, onDelete, scopeLabel, scopedCosts,
}: {
  costs: CostEntry[];
  sessions: TradingSession[];
  events: TradingEvent[];
  onAdd: (amount: number, note: string, kind: CostKind, target?: { sessionId?: string; eventId?: string }) => void;
  onDelete: (id: string) => void;
  scopeLabel: string;
  scopedCosts: CostEntry[];
}) {
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [kind, setKind] = useState<CostKind>('fixed');
  const [error, setError] = useState('');
  /** Empty means "whatever is trading now", which is the usual case. */
  const [target, setTarget] = useState('');

  const live = sessions.find(s => s.status === 'active') ?? null;
  const names = useMemo(() => new Map(sessions.map(s => [s.id, s.name])), [sessions]);
  const eventNames = useMemo(() => new Map(events.map(e => [e.id, e.name])), [events]);

  /**
   * Where a cost can be filed.
   *
   * Events come first because they are the reason this exists: a pitch fee for
   * a three-day market is paid once, for the market, and filing it against one
   * of the three days is a choice with no right answer.
   */
  const targets = useMemo(() => [
    { value: '', label: live ? `${live.name} (trading now)` : 'No session — dated only' },
    ...events.map(e => ({ value: `event:${e.id}`, label: e.name, detail: 'Whole event' })),
    ...[...sessions].reverse().slice(0, 12).map(s => ({
      value: `session:${s.id}`, label: s.name, detail: 'One session',
    })),
  ], [events, sessions, live]);
  const scoped = useMemo(() => costSummary(scopedCosts), [scopedCosts]);
  const history = useMemo(() => [...costs].sort((a, b) => b.timestamp - a.timestamp), [costs]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const value = parseFloat(amount.replace(/[^\d.]/g, ''));
    if (!Number.isFinite(value) || value <= 0) {
      setError('Enter an amount over 0');
      return;
    }
    const [kindOfTarget, id] = target.split(':');
    onAdd(value, note, kind, id
      ? (kindOfTarget === 'event' ? { eventId: id } : { sessionId: id })
      : undefined);
    setAmount('');
    setNote('');
    setError('');
  };

  return (
    <div className="flex flex-col gap-[16px]">
      <div className="grid gap-[16px]" style={{ gridTemplateColumns: '1fr 1.25fr' }}>
        <Panel title="Log a cost" subtitle={live ? `This will be counted against ${live.name}` : 'No session running — it will just be dated'}>
          <form onSubmit={submit} className="flex flex-col gap-[10px]">
            <TextInput
              value={amount}
              onChange={e => { setAmount(e.target.value); setError(''); }}
              inputMode="decimal"
              placeholder="0"
              data-cost-amount
              icon={<span className="text-[var(--app-text-muted)] text-[14px] font-bold">Rs</span>}
              error={error || undefined}
            />

            <TextInput
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="What was it for?"
              data-cost-note
            />

            <Select
              label="Counts against"
              value={target}
              onChange={setTarget}
              options={targets}
            />

            <div className="flex gap-[6px]">
              {(['fixed', 'variable'] as const).map(k => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  data-cost-kind={k}
                  className="flex-1 flex flex-col items-start gap-[2px] px-[11px] py-[9px] rounded-[10px] border text-left transition-colors duration-150"
                  title={k === 'fixed' ? HINT.costFixed : HINT.costVariable}
                  style={{
                    borderColor: kind === k ? ACCENT : 'var(--app-border)',
                    background: kind === k ? alpha(ACCENT, 0.13) : 'transparent',
                  }}
                >
                  <span
                    className="text-[13px] font-semibold capitalize"
                    style={{ color: kind === k ? ACCENT : 'var(--app-text)' }}
                  >
                    {k}
                  </span>
                  <span className="text-[10.5px] text-[var(--app-text-muted)] leading-[14px]">
                    {k === 'fixed'
                      ? 'Same whether you sell one or a thousand'
                      : 'Rises with every unit sold'}
                  </span>
                </button>
              ))}
            </div>

            <Button type="submit" variant="primary" block data-cost-add icon={<Plus size={16} />}>
              Add cost
            </Button>

            <p className="flex items-start gap-[7px] text-[var(--app-text-muted)] text-[11.5px] leading-[16px] mt-[2px]">
              <Info size={12} className="shrink-0 mt-[2px]" />
              Do not log ingredients here — those are already worked out from your stock, and
              entering them again would count them twice. Whether a cost is fixed or variable
              genuinely matters: it changes what you need to take before the day breaks even.
            </p>
          </form>
        </Panel>

        <Panel title={`Costs · ${scopeLabel}`} subtitle="What this period has cost you so far">
          <div className="grid grid-cols-3 gap-[10px]">
            <Figure label="Fixed" value={scoped.fixed} />
            <Figure label="Variable" value={scoped.variable} />
            <Figure label="Total" value={scoped.total} strong />
          </div>
          {scoped.entries === 0 && (
            <p className="text-[var(--app-text-muted)] text-[12px] leading-[17px] mt-[12px]">
              Nothing logged for this period yet. Until there is, break-even cannot be worked
              out — the app will not show it as zero, because zero would be a lie: it simply
              does not know what the day costs you.
            </p>
          )}
        </Panel>
      </div>

      <Panel title="History" subtitle={`${history.length} entr${history.length === 1 ? 'y' : 'ies'}, newest first`}>
        {history.length === 0 ? (
          <p className="text-[var(--app-text-muted)] text-[13px] py-[18px] text-center">
            No costs logged yet.
          </p>
        ) : (
          <div className="flex flex-col">
            <AnimatePresence initial={false}>
              {history.map(entry => (
                <motion.div
                  key={entry.id}
                  layout
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ type: 'spring', stiffness: 480, damping: 38 }}
                  className="overflow-hidden"
                >
                  <div
                    className="flex items-center gap-[11px] py-[9px] border-b border-[var(--app-border)]"
                    data-cost-row={entry.id}
                  >
                    <Coins size={15} style={{ color: entry.kind === 'variable' ? '#76DFDA' : ACCENT }} />
                    <span className="text-[var(--app-text)] text-[13px] font-semibold tabular-nums w-[92px]">
                      {money(entry.amount)}
                    </span>
                    <span
                      className="text-[10px] font-bold uppercase tracking-[0.4px] px-[7px] h-[19px] rounded-[5px] flex items-center"
                      style={{
                        color: entry.kind === 'variable' ? '#76DFDA' : ACCENT,
                        border: `1px solid ${entry.kind === 'variable' ? '#76DFDA55' : `${ACCENT}55`}`,
                      }}
                    >
                      {entry.kind}
                    </span>
                    <span className="text-[var(--app-text-secondary)] text-[13px] truncate flex-1">
                      {entry.note || <em className="text-[var(--app-text-muted)]">No note</em>}
                    </span>
                    <span className="text-[var(--app-text-muted)] text-[11px] shrink-0">
                      {entry.eventId
                        ? `${eventNames.get(entry.eventId) ?? 'Deleted event'} · whole event`
                        : entry.sessionId
                          ? names.get(entry.sessionId) ?? 'Deleted session'
                          : 'No session'}
                    </span>
                    <span className="text-[var(--app-text-muted)] text-[11px] shrink-0 w-[104px] text-right">
                      {new Date(entry.timestamp).toLocaleString(undefined, {
                        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                      })}
                    </span>
                    <button
                      onClick={() => onDelete(entry.id)}
                      data-cost-delete={entry.id}
                      className="text-[var(--app-text-muted)] hover:text-[#F9624E] transition-colors shrink-0"
                      title="Remove"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </Panel>
    </div>
  );
}

function Figure({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className="rounded-[11px] border border-[var(--app-border)] bg-[var(--app-surface)] px-[13px] py-[11px]">
      <span className="block text-[var(--app-text-muted)] text-[11px] uppercase tracking-[0.5px] font-semibold">
        {label}
      </span>
      <span
        className="block text-[21px] leading-[26px] tabular-nums mt-[3px]"
        style={{ color: strong ? ACCENT : 'var(--app-text)', fontWeight: strong ? 800 : 700 }}
      >
        {money(value)}
      </span>
    </div>
  );
}
