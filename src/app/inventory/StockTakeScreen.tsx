import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Check, ClipboardCheck, Equal, TrendingDown, TrendingUp } from 'lucide-react';
import { StockIcon } from './icons';
import { ACCENT, DANGER, GOOD, GhostButton, PrimaryButton, ScreenHeader } from './InventoryUI';
import { UNIT_CHOICES, familyOf, formatQuantityLabel, toBase } from '../lib/inventory';
import type { StockItem } from '../types';

export interface StockTakeLine {
  stockItemId: string;
  /** Counted amount, in the item's base unit. */
  counted: number;
  /** counted − expected. Negative means stock went missing. */
  variance: number;
}

/**
 * Counting the shelf and writing down the difference.
 *
 * This is the only thing that closes the inventory identity — opening plus
 * receipts minus consumption should equal what is actually there, and until
 * somebody counts, nobody knows whether it does. The variance is the interesting
 * number: it is waste, theft, over-portioning and mis-keyed deliveries, and it
 * is invisible without this screen.
 *
 * Counts are entered per item and committed together, so a half-finished count
 * never lands in the ledger.
 */
export function StockTakeScreen({
  stockItems, onCommit, onBack,
}: {
  stockItems: StockItem[];
  onCommit: (lines: StockTakeLine[], note: string) => void;
  onBack: () => void;
}) {
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [units, setUnits] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  const [committed, setCommitted] = useState(false);

  const lines = useMemo(() => {
    const out: (StockTakeLine & { item: StockItem })[] = [];
    for (const item of stockItems) {
      const raw = counts[item.id];
      if (raw === undefined || raw.trim() === '') continue;
      const parsed = parseFloat(raw);
      if (!Number.isFinite(parsed) || parsed < 0) continue;
      const counted = toBase(parsed, units[item.id] ?? item.unit);
      out.push({ stockItemId: item.id, counted, variance: counted - item.quantity, item });
    }
    return out;
  }, [counts, units, stockItems]);

  const changed = lines.filter(l => Math.abs(l.variance) > 0.0001);
  const shrinkage = changed
    .filter(l => l.variance < 0)
    .reduce((sum, l) => sum + -l.variance * (l.item.costPerUnit || 0), 0);

  const commit = () => {
    if (lines.length === 0) return;
    onCommit(lines, note.trim() || 'Stock take');
    setCommitted(true);
    window.setTimeout(() => { setCounts({}); setNote(''); setCommitted(false); }, 900);
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <ScreenHeader
        title="Stock take"
        subtitle="Count what is really on the shelf. Anything you leave blank is left exactly as it is."
        onBack={onBack}
        actions={
          <PrimaryButton onClick={commit} disabled={lines.length === 0} title="Save this count">
            <AnimatePresence mode="wait" initial={false}>
              {committed ? (
                <motion.span key="done" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                  exit={{ opacity: 0 }} className="flex items-center gap-[7px]">
                  <Check size={16} /> Recorded
                </motion.span>
              ) : (
                <motion.span key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  className="flex items-center gap-[7px]">
                  <ClipboardCheck size={16} /> Record {lines.length ? `${lines.length} count${lines.length === 1 ? '' : 's'}` : 'count'}
                </motion.span>
              )}
            </AnimatePresence>
          </PrimaryButton>
        }
      />

      <div className="flex items-center gap-[10px] mb-[12px]">
        <input
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder="What is this count for? (end of night, weekly, spot check)"
          data-stocktake-note
          className="flex-1 bg-[var(--app-bg-darker)] border border-[var(--app-border)] rounded-[10px] px-[12px] h-[46px] text-[var(--app-text)] text-[15px] focus:outline-none focus:border-[var(--app-text-muted)]"
        />
        <GhostButton onClick={() => setCounts({})} title="Clear everything you have typed and start the count again">
          Clear
        </GhostButton>
      </div>

      <div className="flex-1 overflow-auto flex flex-col gap-[6px] min-h-0">
        {stockItems.map(item => {
          const line = lines.find(l => l.stockItemId === item.id);
          const variance = line?.variance ?? 0;
          const material = Math.abs(variance) > 0.0001;
          const unitOptions = UNIT_CHOICES.filter(u => familyOf(u) === familyOf(item.unit));

          return (
            <motion.div
              key={item.id}
              layout
              data-stocktake-row={item.name}
              className="flex items-center gap-[10px] rounded-[11px] border bg-[var(--app-bg-darker)] px-[15px] h-[64px]"
              style={{
                borderColor: !line ? 'var(--app-border)'
                  : material ? (variance < 0 ? DANGER : GOOD) : 'var(--app-border)',
              }}
            >
              <StockIcon id={item.iconId} size={22} color={ACCENT} />
              <span className="text-[var(--app-text)] text-[16px] font-semibold truncate w-[168px]">
                {item.name}
              </span>

              <span className="text-[var(--app-text-muted)] text-[14px] w-[126px] shrink-0">
                expected {formatQuantityLabel(item.quantity, item.unit)}
              </span>

              <input
                value={counts[item.id] ?? ''}
                onChange={e => setCounts(c => ({ ...c, [item.id]: e.target.value.replace(/[^\d.]/g, '') }))}
                placeholder="count"
                data-stocktake-input={item.name}
                className="w-[104px] bg-[var(--app-surface)] border border-[var(--app-border)] rounded-[10px] px-[12px] h-[42px] text-[var(--app-text)] text-[16px] font-semibold tabular-nums text-right focus:outline-none focus:border-[var(--app-text-muted)]"
              />

              <div className="flex gap-[4px]">
                {unitOptions.map(u => {
                  const active = (units[item.id] ?? item.unit) === u;
                  return (
                    <button
                      key={u}
                      onClick={() => setUnits(m => ({ ...m, [item.id]: u }))}
                      className="px-[10px] h-[32px] rounded-[9px] text-[13px] font-semibold border transition-colors"
                      style={{
                        background: active ? `${ACCENT}22` : 'transparent',
                        borderColor: active ? ACCENT : 'var(--app-border)',
                        color: active ? ACCENT : 'var(--app-text-muted)',
                      }}
                    >
                      {u}
                    </button>
                  );
                })}
              </div>

              <div className="ml-auto flex items-center gap-[7px] w-[180px] justify-end">
                <AnimatePresence mode="wait" initial={false}>
                  {line && (
                    <motion.span
                      key={material ? (variance < 0 ? 'short' : 'over') : 'exact'}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      transition={{ duration: 0.16 }}
                      className="flex items-center gap-[6px] text-[13px] font-bold tabular-nums"
                      style={{ color: !material ? 'var(--app-text-muted)' : variance < 0 ? DANGER : GOOD }}
                      data-stocktake-variance={item.name}
                    >
                      {!material ? <Equal size={13} /> : variance < 0 ? <TrendingDown size={13} /> : <TrendingUp size={13} />}
                      {!material
                        ? 'matches'
                        : `${variance > 0 ? '+' : '−'}${formatQuantityLabel(Math.abs(variance), item.unit)}`}
                    </motion.span>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          );
        })}

        {stockItems.length === 0 && (
          <p className="text-[var(--app-text-secondary)] text-[13px] py-[20px]">
            No stock items to count yet.
          </p>
        )}
      </div>

      <AnimatePresence>
        {changed.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden shrink-0"
          >
            <div
              className="mt-[12px] flex items-center gap-[12px] rounded-[11px] border px-[14px] h-[48px]"
              style={{ borderColor: 'var(--app-border)', background: 'var(--app-bg-darker)' }}
            >
              <span className="text-[var(--app-text-secondary)] text-[13px]">
                {changed.length} item{changed.length === 1 ? '' : 's'} differ from the books
              </span>
              {shrinkage > 0 && (
                <span className="text-[13px] font-bold" style={{ color: DANGER }} data-stocktake-shrinkage>
                  Rs {Math.round(shrinkage).toLocaleString()} unaccounted for
                </span>
              )}
              <span className="ml-auto text-[var(--app-text-muted)] text-[11px]">
                Recording writes the difference to the ledger — nothing is overwritten.
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
