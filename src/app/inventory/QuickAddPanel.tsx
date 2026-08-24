import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Check, Eye, EyeOff, Minus, Plus, Undo2, X } from 'lucide-react';
import { StockIcon } from './icons';
import { ACCENT, GOOD, ON_ACCENT, PrimaryButton, GhostButton, QuantityDisplay } from './InventoryUI';
import {
  MOVEMENT_LABELS, UNIT_CHOICES, familyOf, formatQuantityLabel, isLowStock, toBase,
} from '../lib/inventory';
import type { StockItem, StockMovement } from '../types';

type Mode = 'amount' | 'packet';

interface QuickAddPanelProps {
  item: StockItem;
  others: StockItem[];
  movements: StockMovement[];
  onAdd: (delta: number, reason: 'added' | 'packet', note?: string, totalCost?: number) => void;
  onUndo: (movementId: string) => void;
  onSwap: (itemId: string) => void;
  onClose: () => void;
}

/**
 * One input, one Add button. The wireframe had a separate add for units and for
 * packets, which left it ambiguous which one a press would act on.
 */
export function QuickAddPanel({
  item, others, movements, onAdd, onUndo, onSwap, onClose,
}: QuickAddPanelProps) {
  const hasPacket = Boolean(item.packetSize && item.packetSize > 0);
  const [mode, setMode] = useState<Mode>(hasPacket ? 'packet' : 'amount');
  const [amount, setAmount] = useState('');
  const [unit, setUnit] = useState(item.unit);
  const [packets, setPackets] = useState(1);
  const [cost, setCost] = useState('');
  const [showUndone, setShowUndone] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setMode(hasPacket ? 'packet' : 'amount');
    setAmount('');
    setPackets(1);
    setCost('');
    setUnit(item.unit);
    // The toggle is about the item being looked at, not a preference. Switching
    // items should not silently carry a widened history across.
    setShowUndone(false);
  }, [item.id, hasPacket, item.unit]);

  useEffect(() => {
    if (mode === 'amount') inputRef.current?.focus();
  }, [mode]);

  const unitOptions = useMemo(
    () => UNIT_CHOICES.filter(u => familyOf(u) === familyOf(item.unit)),
    [item.unit],
  );

  const delta = mode === 'packet'
    ? packets * (item.packetSize ?? 0)
    : toBase(parseFloat(amount) || 0, unit);

  const canAdd = delta > 0;
  const after = item.quantity + delta;

  /**
   * What the ledger says, read as what happened.
   *
   * The ledger being append-only is right, and showing add / remove / add as
   * three equal events is what made it read as confusing — a delivery that was
   * received, undone and put back looks like three deliveries. So a reversed
   * pair is hidden by default and the toggle brings it back.
   *
   * When shown, the pair is placed adjacent. Time order alone does not do it:
   * the reversal is later than the row it cancels and anything can have
   * happened in between, which leaves the reader inferring the pairing from
   * two matching numbers some distance apart. `referenceId` already says it.
   */
  const { recent, live, undoneCount } = useMemo(() => {
    const mine = movements
      .filter(m => m.stockItemId === item.id)
      .sort((a, b) => b.timestamp - a.timestamp);
    const standing = mine.filter(m => !m.reversed);
    const hidden = mine.length - standing.length;

    if (!showUndone) return { recent: standing.slice(0, 4), live: standing, undoneCount: hidden };

    const byId = new Map(mine.map(m => [m.id, m]));
    const placed = new Set<string>();
    const ordered: StockMovement[] = [];
    for (const m of mine) {
      if (placed.has(m.id)) continue;
      ordered.push(m);
      placed.add(m.id);
      if (m.reason === 'reversal' && m.referenceType === 'movement' && m.referenceId) {
        const original = byId.get(m.referenceId);
        if (original && !placed.has(original.id)) {
          ordered.push(original);
          placed.add(original.id);
        }
      }
    }
    // Room for four events, where a shown pair is two lines of one event.
    return { recent: ordered.slice(0, 8), live: standing, undoneCount: hidden };
  }, [movements, item.id, showUndone]);

  // Only a line that still stands can be undone. Offering it on a reversed row
  // would post a reversal of a reversal, which is not what the button says.
  const undoable = live.slice(0, 4).find(m => m.reason === 'added' || m.reason === 'packet');

  /**
   * Receiving packets already implies what the lot cost, so the field is filled
   * in for you. Typing over it wins — a delivery that came at a different price
   * is exactly the case the manual field exists for.
   */
  const impliedFromPackets = mode === 'packet' && item.packetCost
    ? packets * item.packetCost
    : 0;
  const typed = parseFloat(cost) || 0;
  const totalCost = typed > 0 ? typed : impliedFromPackets;
  /** What this delivery implies per base unit — the figure that gets averaged in. */
  const impliedUnitCost = totalCost > 0 && delta > 0 ? totalCost / delta : 0;
  const usingPacketPrice = typed <= 0 && impliedFromPackets > 0;

  const commit = () => {
    if (!canAdd) return;
    onAdd(
      delta,
      mode === 'packet' ? 'packet' : 'added',
      mode === 'packet' ? `${packets} × ${item.packetLabel || 'packet'}` : undefined,
      totalCost > 0 ? totalCost : undefined,
    );
    setAmount('');
    setPackets(1);
    setCost('');
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 10 }}
      transition={{ type: 'spring', stiffness: 460, damping: 34 }}
      className="flex flex-col gap-[14px] h-full"
      data-quick-add={item.id}
    >
      {/* Item header */}
      <div className="flex items-center gap-[12px]">
        <span
          className="flex items-center justify-center rounded-[12px] shrink-0"
          style={{ width: 62, height: 62, background: 'var(--app-bg-darker)' }}
        >
          <StockIcon id={item.iconId} size={32} color={isLowStock(item) ? '#F9624E' : ACCENT} />
        </span>
        <div className="min-w-0">
          <h2 className="text-[var(--app-text)] text-[24px] font-bold leading-[29px] truncate">{item.name}</h2>
          <div className="flex items-baseline gap-[8px]">
            <QuantityDisplay quantity={item.quantity} unit={item.unit} size={16} muted />
            {isLowStock(item) && (
              <span className="text-[#F9624E] text-[11px] font-semibold uppercase tracking-[0.5px]">Low</span>
            )}
          </div>
        </div>
        <GhostButton onClick={onClose} title="Close" className="ml-auto !px-[12px]" data-quick-close="true">
          <X size={16} />
        </GhostButton>
      </div>

      {/* Mode switch — only offered when the item actually has a packet */}
      {hasPacket && (
        <div className="flex gap-[6px] p-[4px] rounded-[12px] bg-[var(--app-bg-darker)] w-fit relative">
          {(['packet', 'amount'] as Mode[]).map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              data-mode={m}
              className="relative px-[16px] h-[34px] rounded-[9px] text-[13px] font-semibold z-10"
              style={{ color: mode === m ? ON_ACCENT : 'var(--app-text-secondary)' }}
            >
              {mode === m && (
                <motion.span
                  layoutId="quick-add-mode"
                  className="absolute inset-0 rounded-[9px] -z-10"
                  style={{ background: ACCENT }}
                  transition={{ type: 'spring', stiffness: 520, damping: 34 }}
                />
              )}
              {m === 'packet' ? `${item.packetLabel || 'Packets'}` : 'Amount'}
            </button>
          ))}
        </div>
      )}

      {/* The input itself */}
      <div className="rounded-[16px] border border-[var(--app-border)] bg-[var(--app-bg-darker)] p-[18px]">
        <AnimatePresence mode="wait" initial={false}>
          {mode === 'packet' ? (
            <motion.div
              key="packet"
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 12 }}
              transition={{ duration: 0.14 }}
              className="flex items-center gap-[16px]"
            >
              <StepperButton onClick={() => setPackets(p => Math.max(1, p - 1))} label="One fewer packet">
                <Minus size={20} />
              </StepperButton>
              <div className="flex flex-col items-center min-w-[120px]">
                <motion.span
                  key={packets}
                  initial={{ scale: 0.7, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: 'spring', stiffness: 600, damping: 26 }}
                  className="text-[var(--app-text)] text-[46px] font-bold leading-[48px] tabular-nums"
                >
                  {packets}
                </motion.span>
                <span className="text-[var(--app-text-muted)] text-[12px]">
                  {item.packetLabel || 'packet'}{packets === 1 ? '' : 's'} · {formatQuantityLabel(item.packetSize ?? 0, item.unit)} each
                </span>
              </div>
              <StepperButton onClick={() => setPackets(p => Math.min(999, p + 1))} label="One more packet">
                <Plus size={20} />
              </StepperButton>
            </motion.div>
          ) : (
            <motion.div
              key="amount"
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -12 }}
              transition={{ duration: 0.14 }}
              className="flex items-center gap-[10px]"
            >
              <input
                ref={inputRef}
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={e => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
                onKeyDown={e => { if (e.key === 'Enter') commit(); }}
                placeholder="0"
                className="flex-1 min-w-0 bg-transparent text-[var(--app-text)] text-[46px] font-bold tabular-nums focus:outline-none placeholder:text-[var(--app-text-muted)]"
              />
              <div className="flex gap-[5px]">
                {unitOptions.map(u => (
                  <button
                    key={u}
                    onClick={() => setUnit(u)}
                    className="px-[15px] h-[46px] rounded-[11px] text-[15px] font-semibold border transition-colors duration-150"
                    style={{
                      background: unit === u ? ACCENT : 'transparent',
                      borderColor: unit === u ? ACCENT : 'var(--app-border)',
                      color: unit === u ? ON_ACCENT : 'var(--app-text-secondary)',
                    }}
                  >
                    {u}
                  </button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* What the delivery cost. Typed once here, it keeps every margin in the
            app honest — the alternative is a cost-per-unit nobody remembers to
            update, which quietly turns into fiction. */}
        <div className="flex items-center gap-[10px] mt-[14px] pt-[14px] border-t border-[var(--app-border)]">
          <span className="text-[var(--app-text-muted)] text-[14px] shrink-0">Cost of this lot</span>
          <div
            className="flex items-center gap-[6px] rounded-[11px] border px-[13px] h-[46px]"
            style={{ borderColor: totalCost > 0 ? ACCENT : 'var(--app-border)', background: 'var(--app-surface)' }}
          >
            <span className="text-[var(--app-text-muted)] text-[15px]">Rs</span>
            <input
              type="text"
              inputMode="decimal"
              value={cost}
              onChange={e => setCost(e.target.value.replace(/[^\d.]/g, ''))}
              onKeyDown={e => { if (e.key === 'Enter') commit(); }}
              placeholder={usingPacketPrice ? String(Math.round(impliedFromPackets)) : '—'}
              data-cost-input
              className="w-[86px] bg-transparent text-[var(--app-text)] text-[18px] font-semibold tabular-nums text-right focus:outline-none placeholder:text-[var(--app-text-muted)]"
            />
          </div>
          <AnimatePresence>
            {impliedUnitCost > 0 && (
              <motion.span
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
                className="text-[12px] truncate"
                style={{ color: 'var(--app-text-secondary)' }}
                data-implied-cost
              >
                Rs {impliedUnitCost < 1 ? impliedUnitCost.toFixed(2) : impliedUnitCost.toFixed(1)} per {item.unit}
              </motion.span>
            )}
          </AnimatePresence>
          <span className="text-[var(--app-text-muted)] text-[13px] ml-auto shrink-0 text-right">
            {usingPacketPrice
              ? `From the packet price — type over it to override`
              : `Optional — leave blank to keep Rs ${item.costPerUnit.toFixed(2)}/${item.unit}`}
          </span>
        </div>

        {/* Before → after, so the consequence is visible before committing */}
        <div className="flex items-center gap-[10px] mt-[14px] pt-[14px] border-t border-[var(--app-border)]">
          <span className="text-[var(--app-text-muted)] text-[12px]">
            {formatQuantityLabel(item.quantity, item.unit)}
          </span>
          <motion.span
            animate={{ x: canAdd ? [0, 4, 0] : 0, opacity: canAdd ? 1 : 0.35 }}
            transition={{ duration: 0.9, repeat: canAdd ? Infinity : 0, ease: 'easeInOut' }}
            style={{ color: 'var(--app-text-muted)' }}
          >
            →
          </motion.span>
          <span className="text-[13px] font-semibold" style={{ color: canAdd ? GOOD : 'var(--app-text-muted)' }}>
            {formatQuantityLabel(after, item.unit)}
          </span>
          <PrimaryButton onClick={commit} disabled={!canAdd} className="ml-auto !px-[28px]">
            <Plus size={16} /> Add
          </PrimaryButton>
        </div>
      </div>

      {/* Recent activity, with an undo for the last manual add */}
      <div className="rounded-[16px] border border-[var(--app-border)] bg-[var(--app-bg-darker)] p-[16px] min-h-[136px]">
        <div className="flex items-center justify-between mb-[8px]">
          <span className="text-[var(--app-text-muted)] text-[11px] uppercase tracking-[0.6px] font-semibold">
            Recent activity
          </span>
          <div className="flex items-center gap-[6px]">
            {undoneCount > 0 && (
              <GhostButton
                onClick={() => setShowUndone(v => !v)}
                className="!h-[30px] !px-[10px] !text-[11px]"
                title={showUndone
                  ? 'Hide changes that were undone, and the lines that cancelled them'
                  : 'Show changes that were undone, next to the lines that cancelled them'}
              >
                {showUndone ? <EyeOff size={12} /> : <Eye size={12} />}
                {showUndone ? 'Hide undone' : `Show undone (${undoneCount})`}
              </GhostButton>
            )}
            {undoable && (
              <GhostButton
                onClick={() => onUndo(undoable.id)}
                className="!h-[30px] !px-[10px] !text-[11px]"
                title="Put the shelf back the way it was before this was added"
              >
                <Undo2 size={12} /> Undo last
              </GhostButton>
            )}
          </div>
        </div>
        {recent.length === 0 ? (
          <p className="text-[var(--app-text-muted)] text-[12px]">Nothing recorded yet.</p>
        ) : (
          <div className="flex flex-col gap-[6px]">
            <AnimatePresence initial={false}>
              {recent.map(m => (
                <motion.div
                  key={m.id}
                  layout
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, height: 0 }}
                  className="flex items-center gap-[8px] text-[12px]"
                  // A cancelled line is shown as cancelled: struck through and
                  // dimmed, so the pair reads as one event that did not stand
                  // rather than as two more things that happened.
                  style={m.reversed
                    ? { opacity: 0.45, textDecoration: 'line-through' }
                    : undefined}
                >
                  <span
                    className="font-bold tabular-nums w-[74px] shrink-0"
                    style={{ color: m.reversed ? 'var(--app-text-muted)' : (m.delta >= 0 ? GOOD : '#F9624E') }}
                  >
                    {m.delta >= 0 ? '+' : '−'}{formatQuantityLabel(Math.abs(m.delta), item.unit)}
                  </span>
                  <span className="text-[var(--app-text-secondary)] truncate">
                    {MOVEMENT_LABELS[m.reason]}{m.note ? ` · ${m.note}` : ''}
                  </span>
                  <span className="ml-auto text-[var(--app-text-muted)] shrink-0">
                    {new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* Quick swap */}
      {others.length > 0 && (
        <div className="mt-auto">
          <p className="text-[var(--app-text-muted)] text-[11px] uppercase tracking-[0.6px] font-semibold mb-[7px]">
            Switch to
          </p>
          <div className="flex gap-[8px] overflow-x-auto pb-[2px]">
            {others.map(other => (
              <motion.button
                key={other.id}
                whileTap={{ scale: 0.96 }}
                onClick={() => onSwap(other.id)}
                className="shrink-0 flex items-center gap-[8px] rounded-[10px] border border-[var(--app-border)] bg-[var(--app-bg-darker)] px-[12px] h-[44px]"
              >
                <StockIcon id={other.iconId} size={16} color={ACCENT} />
                <span className="text-[var(--app-text)] text-[13px] font-medium">{other.name}</span>
                <span className="text-[var(--app-text-muted)] text-[11px]">
                  {formatQuantityLabel(other.quantity, other.unit)}
                </span>
              </motion.button>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
}

function StepperButton({
  children, onClick, label,
}: { children: React.ReactNode; onClick: () => void; label: string }) {
  return (
    <motion.button
      type="button"
      title={label}
      onClick={onClick}
      whileTap={{ scale: 0.88 }}
      transition={{ type: 'spring', stiffness: 700, damping: 26 }}
      className="flex items-center justify-center rounded-full border border-[var(--app-border)] bg-[var(--app-surface)] text-[var(--app-text)] shrink-0"
      style={{ width: 48, height: 48 }}
    >
      {children}
    </motion.button>
  );
}
