import { useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, ChevronRight, PackageX, X } from 'lucide-react';
import { formatQuantityLabel } from '../lib/inventory';
import type { ProductEstimate } from '../lib/inventory';
import type { MenuItem, StockItem } from '../types';
import { HINT, Tooltip, WARNING } from '../ui';

const DANGER = '#F9624E';
/** A warning, not an accent — this colour means the same everywhere. */
const WARN = WARNING;

/**
 * A strip along the top of the ordering panel naming what is running out.
 *
 * It is dismissible, but the dismissal is keyed to *which* items are low rather
 * than to a moment in time — so acknowledging "Buns are low" does not also
 * silence beef going low ten minutes later.
 */
export function LowStockNotice({
  items, dismissedKey, onDismiss, onOpenInventory,
}: {
  items: StockItem[];
  dismissedKey: string;
  onDismiss: (key: string) => void;
  onOpenInventory: () => void;
}) {
  const key = items.map(i => i.id).sort().join('|');
  const visible = items.length > 0 && key !== dismissedKey;

  // Clear a stale acknowledgement once everything is stocked again, so the next
  // shortage starts from a clean slate.
  useEffect(() => {
    if (items.length === 0 && dismissedKey) onDismiss('');
  }, [items.length, dismissedKey, onDismiss]);

  return (
    <AnimatePresence initial={false}>
      {visible && (
        <motion.div
          key="low-stock"
          data-low-stock-notice
          initial={{ opacity: 0, height: 0, marginBottom: 0 }}
          animate={{ opacity: 1, height: 'auto', marginBottom: 0 }}
          exit={{ opacity: 0, height: 0, marginBottom: 0 }}
          transition={{ type: 'spring', stiffness: 460, damping: 38 }}
          className="overflow-hidden shrink-0"
        >
          <div
            className="flex items-center gap-[10px] rounded-[10px] border px-[12px] h-[42px]"
            style={{ borderColor: `${WARN}66`, background: `${WARN}1a` }}
          >
            <motion.span
              animate={{ scale: [1, 1.12, 1] }}
              transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
              className="shrink-0 flex"
            >
              <AlertTriangle size={16} style={{ color: WARN }} />
            </motion.span>

            <button
              onClick={onOpenInventory}
              className="flex items-baseline gap-[7px] min-w-0 flex-1 text-left"
              data-low-stock-open
            >
              <span className="text-[13px] font-bold shrink-0" style={{ color: WARN }}>
                {items.length === 1 ? 'Running low' : `${items.length} running low`}
              </span>
              <span className="text-[12px] truncate" style={{ color: 'var(--app-order-text)' }}>
                {items.slice(0, 3).map(i => `${i.name} ${formatQuantityLabel(i.quantity, i.unit)}`).join(' · ')}
                {items.length > 3 ? ` · +${items.length - 3} more` : ''}
              </span>
              <ChevronRight size={13} style={{ color: WARN }} className="shrink-0" />
            </button>

            <Tooltip label="Hide this until something else runs low.">
              <motion.button
                whileTap={{ scale: 0.9 }}
                onClick={() => onDismiss(key)}
                data-low-stock-dismiss
                aria-label="Hide this notice"
                className="shrink-0 w-[26px] h-[26px] rounded-[7px] flex items-center justify-center"
                style={{ color: WARN }}
              >
                <X size={14} />
              </motion.button>
            </Tooltip>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * Asks before adding something the kitchen cannot make. Never refuses — the
 * shelf count can be wrong and a sale should not be blocked by bookkeeping —
 * but it names the ingredient that ran out.
 */
export function SoldOutPrompt({
  prompt, onCancel, onConfirm,
}: {
  prompt: { menuItem: MenuItem; estimate: ProductEstimate } | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    if (!prompt) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
      if (e.key === 'Enter') onConfirm();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [prompt, onCancel, onConfirm]);

  const bottleneck = prompt?.estimate.bottleneck;
  const short = prompt?.estimate.ingredients.filter(i => i.available < i.required) ?? [];

  return (
    <AnimatePresence>
      {prompt && (
        <motion.div
          key="sold-out"
          data-sold-out-prompt
          className="fixed inset-0 z-[120] flex items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.14 }}
        >
          <div
            className="absolute inset-0"
            style={{ background: 'rgba(6,6,8,0.5)', backdropFilter: 'blur(4px)' }}
            onClick={onCancel}
          />

          <motion.div
            initial={{ scale: 0.94, y: 10 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.96, y: 6 }}
            transition={{ type: 'spring', stiffness: 520, damping: 34 }}
            className="relative w-[420px] rounded-[16px] border p-[20px]"
            style={{ background: 'var(--app-bg-darker)', borderColor: 'var(--app-border)' }}
          >
            <div className="flex items-center gap-[11px] mb-[14px]">
              <motion.span
                className="flex items-center justify-center rounded-[11px] shrink-0"
                style={{ width: 40, height: 40, background: `${DANGER}22` }}
                animate={{ scale: [1, 1.06, 1] }}
                transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
              >
                <PackageX size={20} style={{ color: DANGER }} />
              </motion.span>
              <div className="min-w-0">
                <h3 className="text-[var(--app-text)] text-[18px] font-bold leading-[22px] truncate">
                  {prompt.menuItem.name} is out of stock
                </h3>
                <p className="text-[var(--app-text-muted)] text-[12px] leading-[16px]">
                  {bottleneck
                    ? `${bottleneck.stockItem.name} has ${formatQuantityLabel(
                        Math.max(0, bottleneck.available), bottleneck.stockItem.unit,
                      )} left — one needs ${formatQuantityLabel(
                        bottleneck.required, bottleneck.stockItem.unit,
                      )}.`
                    : 'There is not enough stock left to make another one.'}
                </p>
              </div>
            </div>

            {short.length > 1 && (
              <div
                className="rounded-[10px] border px-[12px] py-[9px] mb-[14px] flex flex-col gap-[5px]"
                style={{ borderColor: 'var(--app-border)', background: 'var(--app-surface)' }}
              >
                {short.slice(0, 4).map(ingredient => (
                  <div key={ingredient.stockItem.id} className="flex items-center text-[12px]">
                    <span className="text-[var(--app-text-secondary)] truncate">
                      {ingredient.stockItem.name}
                    </span>
                    <span className="flex-1" />
                    <span className="tabular-nums font-semibold" style={{ color: DANGER }}>
                      {formatQuantityLabel(Math.max(0, ingredient.available), ingredient.stockItem.unit)}
                      {' / '}
                      {formatQuantityLabel(ingredient.required, ingredient.stockItem.unit)}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div className="grid grid-cols-2 gap-[10px]">
              <motion.button
                whileTap={{ scale: 0.97 }}
                onClick={onCancel}
                data-sold-out-cancel
                className="h-[46px] rounded-[10px] text-[14px] font-semibold border"
                style={{
                  borderColor: 'var(--app-border)',
                  background: 'var(--app-surface)',
                  color: 'var(--app-text-secondary)',
                }}
              >
                Cancel
              </motion.button>
              <motion.button
                whileTap={{ scale: 0.97 }}
                onClick={onConfirm}
                data-sold-out-confirm
                className="h-[46px] rounded-[10px] text-[14px] font-bold"
                style={{ background: DANGER, color: '#1B0805' }}
              >
                Add anyway
              </motion.button>
            </div>

            <p className="text-[var(--app-text-muted)] text-[11px] text-center mt-[10px]">
              Adding anyway still deducts the stock. It will sit at zero until it is topped up.
            </p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
