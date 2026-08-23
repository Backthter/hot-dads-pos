import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Check, Minus, Search, Trash2 } from 'lucide-react';
import { StockIcon, searchIcons, suggestIconId } from './icons';
import { ACCENT, DANGER, ON_ACCENT, GhostButton, PrimaryButton, ScreenHeader } from './InventoryUI';
import { UNIT_CHOICES, familyOf, formatQuantityLabel, toBase } from '../lib/inventory';
import type { StockItem, StockMovementReason } from '../types';
import { capitalizeFirst } from '../ui';

interface StockEditorProps {
  /** Undefined when adding a new item. */
  item?: StockItem;
  onSave: (item: StockItem) => void;
  onDelete?: (id: string) => void;
  onSubtract?: (itemId: string, amount: number, reason: StockMovementReason, note?: string) => void;
  onBack: () => void;
}

const SUBTRACT_REASONS: { id: StockMovementReason; label: string }[] = [
  { id: 'waste', label: 'Waste' },
  { id: 'correction', label: 'Correction' },
  { id: 'stocktake', label: 'Stock take' },
];

export function StockEditor({ item, onSave, onDelete, onSubtract, onBack }: StockEditorProps) {
  const isNew = !item;
  const [name, setName] = useState(item?.name ?? '');
  const [amount, setAmount] = useState(item ? String(item.quantity) : '');
  const [unit, setUnit] = useState(item?.unit ?? 'pcs');
  /**
   * Blank, not "0".
   *
   * A zero sitting in the field is a value the app has asserted on your behalf,
   * and it has to be selected and deleted before a real number can be typed —
   * on a touchscreen, every single time. Empty means empty; it is read as zero
   * where a number is needed, which is the same result without the deleting.
   */
  const [threshold, setThreshold] = useState(item?.lowStockThreshold ? String(item.lowStockThreshold) : '');
  const [cost, setCost] = useState(item?.costPerUnit ? String(item.costPerUnit) : '');
  /**
   * What the whole lot cost.
   *
   * This is the figure that exists on the receipt — nobody is handed a price
   * per gram. Cost per unit is derived from it and stays editable, because the
   * two are the same fact stated two ways and either one can be the one you
   * happen to know.
   */
  const [lotCost, setLotCost] = useState('');
  const [lastCostEdit, setLastCostEdit] = useState<'lot' | 'unit'>('lot');
  const [packetSize, setPacketSize] = useState(item?.packetSize ? String(item.packetSize) : '');
  const [packetLabel, setPacketLabel] = useState(item?.packetLabel || 'Packet');
  const [packetCost, setPacketCost] = useState(item?.packetCost ? String(item.packetCost) : '');
  const [iconId, setIconId] = useState(item?.iconId ?? 'other');
  const [iconTouched, setIconTouched] = useState(Boolean(item?.iconId));
  const [iconQuery, setIconQuery] = useState('');
  const [subtracting, setSubtracting] = useState(false);
  const [subtractAmount, setSubtractAmount] = useState('');
  const [subtractReason, setSubtractReason] = useState<StockMovementReason>('waste');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const icons = useMemo(() => searchIcons(iconQuery), [iconQuery]);

  // Until the icon is chosen by hand, it follows the name.
  const effectiveIcon = iconTouched ? iconId : suggestIconId(name);

  const quantity = parseFloat(amount) || 0;
  const baseQuantity = toBase(quantity, unit);
  const valid = name.trim().length > 0;

  /**
   * Keeps the lot cost and the cost per unit agreeing with each other.
   *
   * Whichever was typed most recently is the one held fixed; the other follows,
   * and follows again if the amount changes. Without the memory of which came
   * last, changing the amount would have to guess which figure the person meant
   * to keep, and would get it wrong half the time.
   */
  const setLot = (raw: string) => {
    setLotCost(raw);
    setLastCostEdit('lot');
    const total = parseFloat(raw);
    if (Number.isFinite(total) && baseQuantity > 0) {
      setCost(trimCost(total / baseQuantity));
    } else if (raw === '') {
      setCost('');
    }
  };

  const setUnitCost = (raw: string) => {
    setCost(raw);
    setLastCostEdit('unit');
    const per = parseFloat(raw);
    if (Number.isFinite(per) && baseQuantity > 0) {
      setLotCost(trimCost(per * baseQuantity));
    } else if (raw === '') {
      setLotCost('');
    }
  };

  const setAmountSynced = (raw: string) => {
    setAmount(raw);
    const nextBase = toBase(parseFloat(raw) || 0, unit);
    if (nextBase <= 0) return;
    if (lastCostEdit === 'lot') {
      const total = parseFloat(lotCost);
      if (Number.isFinite(total)) setCost(trimCost(total / nextBase));
    } else {
      const per = parseFloat(cost);
      if (Number.isFinite(per)) setLotCost(trimCost(per * nextBase));
    }
  };

  const preview: StockItem = {
    id: item?.id ?? 'preview',
    name: name.trim() || 'New item',
    quantity: toBase(quantity, unit),
    unit: familyOf(unit) === 'count' ? 'pcs' : familyOf(unit) === 'mass' ? 'g' : 'ml',
    lowStockThreshold: toBase(parseFloat(threshold) || 0, unit),
    costPerUnit: parseFloat(cost) || 0,
    packetSize: parseFloat(packetSize) > 0 ? toBase(parseFloat(packetSize), unit) : undefined,
    packetLabel: parseFloat(packetSize) > 0 ? (packetLabel.trim() || 'Packet') : undefined,
    packetCost: parseFloat(packetSize) > 0 && parseFloat(packetCost) > 0 ? parseFloat(packetCost) : undefined,
    costUpdatedAt: item?.costUpdatedAt,
    iconId: effectiveIcon,
  };

  const save = () => {
    if (!valid) return;
    onSave({ ...preview, id: item?.id ?? `st-${Date.now().toString(36)}` });
  };

  const applySubtract = () => {
    const value = toBase(parseFloat(subtractAmount) || 0, unit);
    if (!item || value <= 0 || !onSubtract) return;
    onSubtract(item.id, value, subtractReason);
    setSubtractAmount('');
    setSubtracting(false);
    setAmount(String(Math.max(0, item.quantity - value)));
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <ScreenHeader
        title={isNew ? 'New stock item' : item!.name}
        subtitle={isNew ? 'Give it a name, a unit and a starting amount' : 'Edit this item'}
        onBack={onBack}
        actions={
          !isNew && onDelete ? (
            <GhostButton
              onClick={() => (confirmDelete ? onDelete(item!.id) : setConfirmDelete(true))}
              tone={DANGER}
              active={confirmDelete}
            >
              <Trash2 size={14} /> {confirmDelete ? 'Confirm?' : 'Delete'}
            </GhostButton>
          ) : undefined
        }
      />

      <div className="flex gap-[16px] flex-1 min-h-0">
        {/* Form */}
        <div className="flex-1 min-w-0 overflow-auto pr-[4px] flex flex-col gap-[12px]">
          <Field label="Name">
            <input
              autoFocus={isNew}
              value={name}
              onChange={e => setName(capitalizeFirst(e.target.value))}
              placeholder="Buns"
              className="w-full bg-transparent text-[var(--app-text)] text-[17px] font-semibold focus:outline-none placeholder:text-[var(--app-text-muted)]"
            />
          </Field>

          <div className="flex gap-[12px]">
            <Field label={isNew ? 'Starting amount' : 'Amount'} className="flex-1">
              <input
                value={amount}
                onChange={e => setAmountSynced(e.target.value.replace(/[^\d.]/g, ''))}
                placeholder="0"
                className="w-full bg-transparent text-[var(--app-text)] text-[17px] font-semibold tabular-nums focus:outline-none placeholder:text-[var(--app-text-muted)]"
              />
            </Field>
            <Field label="Unit" className="w-[190px]">
              <div className="flex gap-[5px] flex-wrap">
                {UNIT_CHOICES.map(u => (
                  <button
                    key={u}
                    onClick={() => setUnit(u)}
                    className="px-[10px] h-[30px] rounded-[7px] text-[14px] font-semibold border transition-colors"
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
            </Field>
          </div>

          {/* Subtract — a button rather than a mode, for wastage and miscounts */}
          {!isNew && onSubtract && (
            <div>
              <GhostButton onClick={() => setSubtracting(s => !s)} active={subtracting} tone={DANGER}>
                <Minus size={14} /> Subtract amount
              </GhostButton>
              <AnimatePresence>
                {subtracting && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="flex items-center gap-[8px] mt-[10px] p-[12px] rounded-[10px] border"
                      style={{ borderColor: `${DANGER}55`, background: `${DANGER}0f` }}>
                      <input
                        autoFocus
                        data-subtract-input="true"
                        value={subtractAmount}
                        onChange={e => setSubtractAmount(e.target.value.replace(/[^\d.]/g, ''))}
                        placeholder="0"
                        className="bg-[var(--app-bg-darker)] rounded-[8px] px-[10px] h-[46px] w-[110px] text-[var(--app-text)] text-[15px] font-semibold tabular-nums focus:outline-none"
                      />
                      <span className="text-[var(--app-text-muted)] text-[15px]">{unit}</span>
                      <div className="flex gap-[5px]">
                        {SUBTRACT_REASONS.map(r => (
                          <button
                            key={r.id}
                            onClick={() => setSubtractReason(r.id)}
                            className="px-[10px] h-[30px] rounded-[7px] text-[14px] font-semibold border"
                            style={{
                              background: subtractReason === r.id ? DANGER : 'transparent',
                              borderColor: subtractReason === r.id ? DANGER : 'var(--app-border)',
                              color: subtractReason === r.id ? '#fff' : 'var(--app-text-secondary)',
                            }}
                          >
                            {r.label}
                          </button>
                        ))}
                      </div>
                      <PrimaryButton
                        onClick={applySubtract}
                        tone={DANGER}
                        disabled={!(parseFloat(subtractAmount) > 0)}
                        className="ml-auto !h-[46px] !text-[15px]"
                      >
                        Subtract
                      </PrimaryButton>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          <div className="flex gap-[12px]">
            <Field
              label="Low stock threshold"
              className="flex-1"
              hint={`In ${unit} — warns at ${formatQuantityLabel(toBase(parseFloat(threshold) || 0, unit), preview.unit)}`}
            >
              <div className="flex items-baseline gap-[6px]">
                <input
                  data-threshold-input="true"
                  value={threshold}
                  onChange={e => setThreshold(e.target.value.replace(/[^\d.]/g, ''))}
                  placeholder="0"
                  className="w-full bg-transparent text-[var(--app-text)] text-[16px] font-semibold tabular-nums focus:outline-none"
                />
                <span className="text-[var(--app-text-muted)] text-[15px] shrink-0">{unit}</span>
              </div>
            </Field>
            <Field
              label="Cost of the lot"
              className="flex-1"
              hint={baseQuantity > 0
                ? `What you paid for all ${formatQuantityLabel(baseQuantity, preview.unit)}`
                : 'What you paid for this whole amount'}
            >
              <div className="flex items-baseline gap-[6px]">
                <span className="text-[var(--app-text-muted)] text-[15px]">Rs</span>
                <input
                  value={lotCost}
                  onChange={e => setLot(e.target.value.replace(/[^\d.]/g, ''))}
                  placeholder=""
                  data-lot-cost
                  className="w-full bg-transparent text-[var(--app-text)] text-[18px] font-semibold tabular-nums focus:outline-none"
                />
              </div>
            </Field>
          </div>

          <Field
            label="Cost per unit"
            hint={lastCostEdit === 'lot' && lotCost
              ? `Worked out from the lot. Type over it if the receipt says otherwise.`
              : `Rs per ${preview.unit}. This is what every margin in the app is built on.`}
          >
            <div className="flex items-baseline gap-[6px]">
              <span className="text-[var(--app-text-muted)] text-[15px]">Rs</span>
              <input
                value={cost}
                onChange={e => setUnitCost(e.target.value.replace(/[^\d.]/g, ''))}
                placeholder=""
                data-cost-per-unit
                className="w-full bg-transparent text-[var(--app-text)] text-[18px] font-semibold tabular-nums focus:outline-none"
              />
              <span className="text-[var(--app-text-muted)] text-[14px] shrink-0">per {preview.unit}</span>
            </div>
          </Field>

          {/*
            The packet is defined here, with its price, at the moment it is
            created. It used to be set up in one place and priced in another,
            which meant a packet existed for a while carrying no cost — and a
            packet with no cost silently teaches the app that deliveries are
            free.
          */}
          <Field
            label="Packet"
            hint={parseFloat(packetSize) > 0 && parseFloat(packetCost) > 0
              ? `Rs ${(parseFloat(packetCost) / toBase(parseFloat(packetSize), unit)).toFixed(2)} per ${preview.unit} — deliveries can be added by the packet`
              : 'Optional. How much arrives in one box, crate or tray, and what one costs.'}
          >
            <div className="flex items-center gap-[8px] flex-wrap">
              <span className="text-[var(--app-text-muted)] text-[14px]">1</span>
              <input
                value={packetLabel}
                onChange={e => setPacketLabel(capitalizeFirst(e.target.value))}
                className="bg-[var(--app-surface)] rounded-[8px] px-[9px] h-[38px] w-[104px] text-[var(--app-text)] text-[14px] focus:outline-none"
                aria-label="What a packet is called"
              />
              <span className="text-[var(--app-text-muted)] text-[14px]">=</span>
              <input
                value={packetSize}
                onChange={e => setPacketSize(e.target.value.replace(/[^\d.]/g, ''))}
                placeholder="0"
                data-packet-size
                className="bg-[var(--app-surface)] rounded-[8px] px-[9px] h-[38px] w-[84px] text-[var(--app-text)] text-[16px] font-semibold tabular-nums text-right focus:outline-none"
              />
              <span className="text-[var(--app-text-muted)] text-[14px]">{unit}</span>
              <span className="text-[var(--app-text-muted)] text-[14px] ml-[6px]">costing Rs</span>
              <input
                value={packetCost}
                onChange={e => setPacketCost(e.target.value.replace(/[^\d.]/g, ''))}
                placeholder="—"
                data-packet-cost-new
                className="bg-[var(--app-surface)] rounded-[8px] px-[9px] h-[38px] w-[92px] text-[var(--app-text)] text-[16px] font-semibold tabular-nums text-right focus:outline-none"
              />
            </div>
          </Field>

          {/* Icon picker */}
          <div className="rounded-[12px] border border-[var(--app-border)] bg-[var(--app-bg-darker)] p-[12px]">
            <div className="flex items-center gap-[8px] mb-[10px]">
              <span className="text-[var(--app-text-muted)] text-[13px] uppercase tracking-[0.6px] font-semibold">
                Icon
              </span>
              <div className="ml-auto flex items-center gap-[6px] bg-[var(--app-surface)] rounded-[8px] px-[8px] h-[30px]">
                <Search size={13} className="text-[var(--app-text-muted)]" />
                <input
                  value={iconQuery}
                  onChange={e => setIconQuery(e.target.value)}
                  placeholder="Search icons"
                  className="bg-transparent text-[var(--app-text)] text-[14px] w-[130px] focus:outline-none"
                />
              </div>
            </div>
            <div className="grid gap-[6px] max-h-[168px] overflow-auto"
              style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(52px, 1fr))' }}>
              {icons.map(icon => {
                const active = effectiveIcon === icon.id;
                return (
                  <motion.button
                    key={icon.id}
                    whileTap={{ scale: 0.9 }}
                    onClick={() => { setIconId(icon.id); setIconTouched(true); }}
                    title={icon.label}
                    className="flex items-center justify-center rounded-[9px] border"
                    style={{
                      height: 46,
                      background: active ? `${ACCENT}22` : 'var(--app-surface)',
                      borderColor: active ? ACCENT : 'transparent',
                    }}
                  >
                    <StockIcon id={icon.id} size={20} color={active ? ACCENT : 'var(--app-text-secondary)'} />
                  </motion.button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Live preview */}
        <div className="w-[236px] shrink-0 flex flex-col gap-[12px]">
          <span className="text-[var(--app-text-muted)] text-[13px] uppercase tracking-[0.6px] font-semibold">
            Preview
          </span>
          <motion.div
            layout
            className="rounded-[14px] border p-[14px] flex flex-col gap-[6px]"
            style={{ background: 'var(--app-bg-darker)', borderColor: 'var(--app-border)' }}
          >
            <span className="flex items-center justify-center rounded-[10px]"
              style={{ width: 34, height: 34, background: 'var(--app-surface)' }}>
              <StockIcon id={effectiveIcon} size={19} color={ACCENT} />
            </span>
            <span className="text-[var(--app-text)] text-[14px] font-semibold truncate">{preview.name}</span>
            <span className="text-[var(--app-text)] text-[19px] font-bold">
              {formatQuantityLabel(preview.quantity, preview.unit)}
            </span>
            {preview.packetSize ? (
              <span className="text-[var(--app-text-muted)] text-[13px]">
                1 {preview.packetLabel || 'packet'} = {formatQuantityLabel(preview.packetSize, preview.unit)}
              </span>
            ) : null}
          </motion.div>

          <p className="text-[var(--app-text-muted)] text-[13px] leading-[15px]">
            Amounts are stored in {preview.unit}. Entering kg or L converts automatically.
          </p>

          <PrimaryButton onClick={save} disabled={!valid} className="mt-auto">
            <Check size={16} /> {isNew ? 'Create item' : 'Save changes'}
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}

/** Two decimals at most, and no trailing noise. */
function trimCost(value: number): string {
  if (!Number.isFinite(value)) return '';
  return String(Math.round(value * 100) / 100);
}

function Field({
  label, hint, children, className = '',
}: { label: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block rounded-[12px] border border-[var(--app-border)] bg-[var(--app-bg-darker)] px-[14px] py-[10px] ${className}`}>
      <span className="block text-[var(--app-text-muted)] text-[10px] uppercase tracking-[0.6px] font-semibold mb-[5px]">
        {label}
      </span>
      {children}
      {hint && <span className="block text-[var(--app-text-muted)] text-[10px] mt-[4px]">{hint}</span>}
    </label>
  );
}
