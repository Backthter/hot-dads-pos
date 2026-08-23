import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Check, Plus, Trash2, X } from 'lucide-react';
import { StockIcon } from './icons';
import { ACCENT, DANGER, GhostButton, PrimaryButton, ScreenHeader } from './InventoryUI';
import { formatQuantityLabel, familyOf, UNIT_CHOICES, toBase } from '../lib/inventory';
import type { StockItem } from '../types';
import { capitalizeFirst } from '../ui';

interface PacketsScreenProps {
  stockItems: StockItem[];
  onSetPacket: (itemId: string, size: number | null, label?: string, cost?: number) => void;
  onBack: () => void;
}

/**
 * One packet per stock item: "1 Packet = 24 pcs". Items without one are offered
 * in the add sheet.
 */
export function PacketsScreen({ stockItems, onSetPacket, onBack }: PacketsScreenProps) {
  const [deleteMode, setDeleteMode] = useState(false);
  const [adding, setAdding] = useState(false);

  const withPackets = stockItems.filter(s => s.packetSize && s.packetSize > 0);
  const without = stockItems.filter(s => !s.packetSize || s.packetSize <= 0);

  return (
    <div className="flex flex-col h-full">
      <ScreenHeader
        title="Packets"
        subtitle="How much comes in one box, crate or tray — so a delivery can be added by the packet instead of counted out"
        onBack={onBack}
        actions={
          <>
            <GhostButton
              onClick={() => setDeleteMode(d => !d)}
              active={deleteMode}
              tone={DANGER}
              title="Stop counting this by the packet. Deliveries would then be entered in whole units instead."
            >
              <Trash2 size={14} /> {deleteMode ? 'Done' : 'Delete'}
            </GhostButton>
            <PrimaryButton onClick={() => setAdding(true)} className="!h-[38px]">
              <Plus size={16} /> Add packet
            </PrimaryButton>
          </>
        }
      />

      <div className="flex-1 overflow-auto">
        {withPackets.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center gap-[6px]">
            <p className="text-[var(--app-text-secondary)] text-[14px]">No packets defined yet.</p>
            <p className="text-[var(--app-text-muted)] text-[12px] max-w-[320px]">
              A packet lets you add stock by the box — one packet of buns being 50 pieces, say.
            </p>
          </div>
        ) : (
          <motion.div layout className="flex flex-col gap-[8px]">
            <AnimatePresence initial={false}>
              {withPackets.map(item => (
                <PacketRow
                  key={item.id}
                  item={item}
                  deleteMode={deleteMode}
                  onChange={(size, label, cost) => onSetPacket(item.id, size, label, cost)}
                  onRemove={() => onSetPacket(item.id, null)}
                />
              ))}
            </AnimatePresence>
          </motion.div>
        )}
      </div>

      <AnimatePresence>
        {adding && (
          <AddPacketSheet
            candidates={without}
            onCancel={() => setAdding(false)}
            onSave={(itemId, size, label, cost) => {
              onSetPacket(itemId, size, label, cost);
              setAdding(false);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function PacketRow({
  item, deleteMode, onChange, onRemove,
}: {
  item: StockItem;
  deleteMode: boolean;
  onChange: (size: number, label?: string, cost?: number) => void;
  onRemove: () => void;
}) {
  const [draft, setDraft] = useState(String(item.packetSize ?? 0));
  const [label, setLabel] = useState(item.packetLabel || 'Packet');
  const [cost, setCost] = useState(item.packetCost ? String(item.packetCost) : '');
  const [saved, setSaved] = useState(false);

  const commit = () => {
    const size = parseFloat(draft);
    if (!Number.isFinite(size) || size <= 0) {
      setDraft(String(item.packetSize ?? 0));
      return;
    }
    const packetCost = parseFloat(cost);
    const nextCost = Number.isFinite(packetCost) && packetCost > 0 ? packetCost : undefined;
    if (size === item.packetSize
      && label === (item.packetLabel || 'Packet')
      && nextCost === item.packetCost) return;
    onChange(size, label, nextCost);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 900);
  };

  /*
   * The row used to carry a fixed `h-[76px]` while its exit animated `height`
   * to zero. A hard height wins, so the collapse did nothing and the row simply
   * vanished at the end of the fade — and on the way in, `layout` and an entry
   * offset fought each other for the same frames, which is the jump that showed
   * when a packet was added. The height is content-derived now, so it has
   * something to animate, and entry is left to the layout animation alone.
   */
  return (
    <motion.div
      layout
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, height: 0, paddingTop: 0, paddingBottom: 0, marginTop: 0 }}
      transition={{ type: 'spring', stiffness: 460, damping: 36 }}
      className="flex items-center gap-[13px] rounded-[14px] border border-[var(--app-border)] bg-[var(--app-bg-darker)] px-[16px] py-[16px] overflow-hidden"
      data-packet-row={item.id}
    >
      <StockIcon id={item.iconId} size={26} color={ACCENT} />
      <span className="text-[var(--app-text)] text-[17px] font-semibold w-[160px] truncate">{item.name}</span>

      <div className="flex items-center gap-[9px] text-[var(--app-text-secondary)] text-[15px]">
        <span>1</span>
        <input
          value={label}
          onChange={e => setLabel(capitalizeFirst(e.target.value))}
          onBlur={commit}
          className="bg-[var(--app-surface)] rounded-[9px] px-[10px] h-[40px] w-[104px] text-[var(--app-text)] text-[15px] focus:outline-none border border-transparent focus:border-[#FE9A00]"
        />
        <span>=</span>
        <input
          value={draft}
          onChange={e => setDraft(e.target.value.replace(/[^\d.]/g, ''))}
          onBlur={commit}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          className="bg-[var(--app-surface)] rounded-[9px] px-[10px] h-[40px] w-[88px] text-[var(--app-text)] text-[16px] font-semibold tabular-nums text-right focus:outline-none border border-transparent focus:border-[#FE9A00]"
        />
        <span className="text-[var(--app-text-muted)] w-[34px]">{item.unit}</span>

        <span className="text-[var(--app-text-muted)] ml-[8px]">costs Rs</span>
        <input
          value={cost}
          onChange={e => setCost(e.target.value.replace(/[^\d.]/g, ''))}
          onBlur={commit}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          placeholder="—"
          data-packet-cost={item.id}
          className="bg-[var(--app-surface)] rounded-[9px] px-[10px] h-[40px] w-[92px] text-[var(--app-text)] text-[16px] font-semibold tabular-nums text-right focus:outline-none border border-transparent focus:border-[#FE9A00]"
        />
      </div>

      <AnimatePresence>
        {saved && (
          <motion.span
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            style={{ color: '#15D2B2' }}
          >
            <Check size={16} />
          </motion.span>
        )}
      </AnimatePresence>

      <span className="ml-auto text-[var(--app-text-muted)] text-[13px] text-right">
        adds {formatQuantityLabel(item.packetSize ?? 0, item.unit)} per packet
        {item.packetCost && item.packetSize
          ? <><br />Rs {(item.packetCost / item.packetSize).toFixed(2)} per {item.unit}</>
          : null}
      </span>

      <AnimatePresence>
        {deleteMode && (
          <motion.button
            initial={{ opacity: 0, scale: 0.6, width: 0 }}
            animate={{ opacity: 1, scale: 1, width: 34 }}
            exit={{ opacity: 0, scale: 0.6, width: 0 }}
            onClick={onRemove}
            title={`Remove the packet for ${item.name}`}
            className="flex items-center justify-center rounded-[8px] shrink-0"
            style={{ height: 34, background: `${DANGER}22`, color: DANGER }}
          >
            <X size={16} />
          </motion.button>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/** Pick an item, then its quantity appears in place on that tile. */
function AddPacketSheet({
  candidates, onCancel, onSave,
}: {
  candidates: StockItem[];
  onCancel: () => void;
  onSave: (itemId: string, size: number, label: string, cost?: number) => void;
}) {
  const [picked, setPicked] = useState<StockItem | null>(null);
  const [size, setSize] = useState('');
  const [unit, setUnit] = useState<string>('');
  const [label, setLabel] = useState('Packet');
  const [cost, setCost] = useState('');

  const chooseItem = (item: StockItem) => {
    setPicked(item);
    setUnit(item.unit);
    setSize('');
  };

  const base = picked ? toBase(parseFloat(size) || 0, unit || picked.unit) : 0;
  const valid = picked !== null && base > 0;

  return (
    <motion.div
      className="fixed inset-0 z-[90] flex items-center justify-center p-[24px]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.12 }}
      style={{ background: 'rgba(6,6,8,0.6)', backdropFilter: 'blur(4px)' }}
      onClick={onCancel}
    >
      <motion.div
        initial={{ scale: 0.94, y: 12 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.96, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 480, damping: 34 }}
        onClick={e => e.stopPropagation()}
        className="bg-[var(--app-bg-darker)] border border-[var(--app-border)] rounded-[16px] p-[20px] w-full max-w-[640px] sheet-max-h flex flex-col"
      >
        <div className="flex items-center mb-[14px]">
          <h3 className="text-[var(--app-text)] text-[17px] font-bold">Add packet</h3>
          <button onClick={onCancel} className="ml-auto text-[var(--app-text-muted)] hover:text-[var(--app-text)]">
            <X size={18} />
          </button>
        </div>

        {candidates.length === 0 ? (
          <p className="text-[var(--app-text-secondary)] text-[13px] py-[20px]">
            Every stock item already has a packet.
          </p>
        ) : (
          <div className="grid gap-[10px] overflow-auto" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}>
            {candidates.map(item => {
              const active = picked?.id === item.id;
              return (
                <motion.button
                  key={item.id}
                  layout
                  onClick={() => chooseItem(item)}
                  whileTap={{ scale: 0.97 }}
                  className="rounded-[12px] border p-[12px] flex flex-col items-start gap-[6px] text-left"
                  style={{
                    background: active ? 'var(--app-bg-tertiary)' : 'var(--app-surface)',
                    borderColor: active ? ACCENT : 'var(--app-border)',
                    gridColumn: active ? 'span 2' : undefined,
                  }}
                >
                  <div className="flex items-center gap-[8px] w-full">
                    <StockIcon id={item.iconId} size={18} color={ACCENT} />
                    <span className="text-[var(--app-text)] text-[13px] font-semibold truncate">{item.name}</span>
                  </div>

                  <AnimatePresence>
                    {active && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="w-full overflow-hidden"
                        onClick={e => e.stopPropagation()}
                      >
                        <div className="flex items-center gap-[6px] pt-[8px]">
                          <span className="text-[var(--app-text-muted)] text-[12px]">1</span>
                          <input
                            value={label}
                            onChange={e => setLabel(capitalizeFirst(e.target.value))}
                            className="bg-[var(--app-bg-darker)] rounded-[8px] px-[8px] h-[38px] w-[92px] text-[var(--app-text)] text-[14px] focus:outline-none"
                          />
                          <span className="text-[var(--app-text-muted)] text-[14px]">=</span>
                          <input
                            autoFocus
                            value={size}
                            onChange={e => setSize(e.target.value.replace(/[^\d.]/g, ''))}
                            placeholder="0"
                            className="bg-[var(--app-bg-darker)] rounded-[8px] px-[8px] h-[38px] w-[76px] text-[var(--app-text)] text-[16px] font-semibold tabular-nums text-right focus:outline-none"
                          />
                          <select
                            value={unit}
                            onChange={e => setUnit(e.target.value)}
                            className="bg-[var(--app-bg-darker)] rounded-[8px] px-[8px] h-[38px] text-[var(--app-text)] text-[14px] focus:outline-none"
                          >
                            {UNIT_CHOICES.filter(u => familyOf(u) === familyOf(item.unit)).map(u => (
                              <option key={u} value={u}>{u}</option>
                            ))}
                          </select>
                          <span className="text-[var(--app-text-muted)] text-[14px] ml-[6px]">costs Rs</span>
                          <input
                            value={cost}
                            onChange={e => setCost(e.target.value.replace(/[^\d.]/g, ''))}
                            placeholder="—"
                            data-new-packet-cost
                            className="bg-[var(--app-bg-darker)] rounded-[8px] px-[8px] h-[38px] w-[84px] text-[var(--app-text)] text-[15px] font-semibold tabular-nums text-right focus:outline-none"
                          />
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.button>
              );
            })}
          </div>
        )}

        <div className="flex items-center gap-[10px] mt-[16px]">
          {picked && base > 0 && (
            <span className="text-[var(--app-text-muted)] text-[14px]">
              1 {label.toLowerCase()} of {picked.name} = {formatQuantityLabel(base, picked.unit)}
              {parseFloat(cost) > 0
                ? ` · Rs ${(parseFloat(cost) / base).toFixed(2)} per ${picked.unit}`
                : ''}
            </span>
          )}
          <PrimaryButton
            onClick={() => picked && onSave(picked.id, base, label, parseFloat(cost) > 0 ? parseFloat(cost) : undefined)}
            disabled={!valid}
            className="ml-auto"
          >
            <Check size={19} /> Save packet
          </PrimaryButton>
        </div>
      </motion.div>
    </motion.div>
  );
}
