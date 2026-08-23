import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Check, Plus, Settings2, X } from 'lucide-react';
import { StockIcon } from './icons';
import { ACCENT, DANGER, GhostButton, PrimaryButton, ScreenHeader } from './InventoryUI';
import { Select, TextInput, alpha, useSection } from '../ui';
import { estimateProduct, formatQuantityLabel, toBase, UNIT_CHOICES, familyOf } from '../lib/inventory';
import type { MenuItem, MenuItemStockAssignment, StockItem } from '../types';

interface AssignScreenProps {
  menuItems: MenuItem[];
  stockItems: StockItem[];
  assignments: MenuItemStockAssignment[];
  onSave: (menuItemId: string, rows: { stockItemId: string; quantityPerItem: number }[]) => void;
  /** Told to the section so the shelf sidebar can stand down while editing. */
  onDetailChange?: (open: boolean) => void;
  /**
   * A menu item to open the editor on straight away, for arrivals from another
   * screen — the cost read-out on the Settings menu row is the one caller.
   */
  openOn?: string | null;
  /** Called once `openOn` has been acted on, so it is not acted on twice. */
  onOpened?: () => void;
}

/**
 * Deals are deliberately absent: their requirements come from the items they
 * contain, so assigning stock to them directly would double-count.
 */
export function AssignScreen({
  menuItems, stockItems, assignments, onSave, onDetailChange, openOn, onOpened,
}: AssignScreenProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const theme = useSection();

  const assignable = useMemo(
    () => menuItems.filter(mi => !(mi.dealItems && mi.dealItems.length > 0)),
    [menuItems],
  );

  const item = assignable.find(mi => mi.id === selected) ?? null;

  /**
   * Opening straight onto one item, because somebody arrived here asking about
   * that item and not about the grid.
   *
   * A deal is deliberately not assignable — its requirements come from what it
   * contains — so a request for one is dropped rather than opening an editor
   * that would double-count. The request is cleared either way: it has been
   * dealt with, and leaving it set would re-open the editor on the next render.
   */
  useEffect(() => {
    if (!openOn) return;
    if (assignable.some(mi => mi.id === openOn)) setSelected(openOn);
    onOpened?.();
  }, [openOn, assignable, onOpened]);

  useEffect(() => { onDetailChange?.(Boolean(item)); }, [item, onDetailChange]);
  useEffect(() => () => onDetailChange?.(false), [onDetailChange]);

  if (item) {
    return (
      <AssignDetail
        key={item.id}
        menuItem={item}
        menuItems={menuItems}
        stockItems={stockItems}
        assignments={assignments}
        onBack={() => setSelected(null)}
        onSave={rows => { onSave(item.id, rows); setSelected(null); }}
      />
    );
  }

  return (
    <div className="flex flex-col h-full">
      <ScreenHeader
        title="Assign stock"
        subtitle="How much of each ingredient one of these uses up. A deal works it out from the items inside it."
        icon={<Settings2 size={22} />}
      />
      {/*
        Same column width, same tile height and the same hover as the shelf
        grid one tab across. These were narrower and shorter and lit amber on
        hover — a hard-coded colour that belonged to no section — so the two
        grids read as two different screens built by two different people.
      */}
      <div
        className="grid gap-[10px] overflow-auto flex-1 content-start"
        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(196px, 1fr))' }}
      >
        {assignable.map(mi => {
          const rows = assignments.filter(a => a.menuItemId === mi.id);
          const est = estimateProduct(mi, menuItems, assignments, stockItems);
          return (
            <AssignTile
              key={mi.id}
              name={mi.name}
              rowCount={rows.length}
              makes={est.count}
              accent={theme.color}
              onPress={() => setSelected(mi.id)}
              id={mi.id}
            />
          );
        })}
        {assignable.length === 0 && (
          <p className="text-[var(--app-text-muted)] text-[13px] col-span-full">
            Nothing on the menu to assign stock to yet.
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * One menu item on the assign grid.
 *
 * Lit rather than lifted, for the same reason the stock tiles are: the grid
 * scrolls inside a clipped box, and anything that rises leaves part of itself
 * on the other side of the edge.
 */
function AssignTile({
  name, rowCount, makes, accent, onPress, id,
}: {
  name: string;
  rowCount: number;
  makes: number;
  accent: string;
  onPress: () => void;
  id: string;
}) {
  const [hover, setHover] = useState(false);
  return (
    <motion.button
      layout
      whileTap={{ scale: 0.97 }}
      onHoverStart={() => setHover(true)}
      onHoverEnd={() => setHover(false)}
      onClick={onPress}
      data-assign-tile={id}
      className="rounded-[16px] border p-[16px] text-left flex flex-col gap-[7px] overflow-hidden"
      style={{
        minHeight: 146,
        background: hover
          ? `linear-gradient(135deg, ${alpha(accent, 0.14)} 0%, ${alpha(accent, 0.03)} 100%), var(--app-bg-darker)`
          : 'var(--app-bg-darker)',
        borderColor: hover ? accent : 'var(--app-border)',
        boxShadow: hover ? `inset 0 0 0 1px ${alpha(accent, 0.45)}` : 'none',
        transitionProperty: 'background-image, border-color, box-shadow',
        transitionDuration: '150ms',
      }}
    >
      <span className="text-[var(--app-text)] text-[17px] font-semibold truncate w-full">{name}</span>
      {rowCount === 0 ? (
        <span className="text-[var(--app-text-muted)] text-[14px]">No stock assigned</span>
      ) : (
        <>
          <span className="text-[var(--app-text-secondary)] text-[14px]">
            {rowCount} ingredient{rowCount === 1 ? '' : 's'}
          </span>
          <span className="text-[15px] font-semibold mt-auto" style={{ color: accent }}>
            makes {makes}
          </span>
        </>
      )}
    </motion.button>
  );
}

interface Row { stockItemId: string; quantity: string; unit: string }

function AssignDetail({
  menuItem, menuItems, stockItems, assignments, onBack, onSave,
}: {
  menuItem: MenuItem;
  menuItems: MenuItem[];
  stockItems: StockItem[];
  assignments: MenuItemStockAssignment[];
  onBack: () => void;
  onSave: (rows: { stockItemId: string; quantityPerItem: number }[]) => void;
}) {
  const [rows, setRows] = useState<Row[]>(() =>
    assignments
      .filter(a => a.menuItemId === menuItem.id)
      .map(a => {
        const stock = stockItems.find(s => s.id === a.stockItemId);
        return { stockItemId: a.stockItemId, quantity: String(a.quantityPerItem), unit: stock?.unit ?? 'pcs' };
      }),
  );

  const resolved = rows
    .filter(r => r.stockItemId && parseFloat(r.quantity) > 0)
    .map(r => ({ stockItemId: r.stockItemId, quantityPerItem: toBase(parseFloat(r.quantity), r.unit) }));

  // Live estimate from the rows being edited, not from what is saved.
  const previewAssignments = [
    ...assignments.filter(a => a.menuItemId !== menuItem.id),
    ...resolved.map(r => ({ menuItemId: menuItem.id, ...r })),
  ];
  const estimate = estimateProduct(menuItem, menuItems, previewAssignments, stockItems);

  const unused = stockItems.filter(s => !rows.some(r => r.stockItemId === s.id));
  const [saved, setSaved] = useState(false);
  useEffect(() => { setSaved(false); }, [rows]);

  const addRow = () => {
    const next = unused[0];
    setRows(r => [...r, { stockItemId: next?.id ?? '', quantity: '', unit: next?.unit ?? 'pcs' }]);
  };

  return (
    <div className="flex flex-col h-full">
      <ScreenHeader
        title={menuItem.name}
        subtitle="What one of these uses up"
        icon={<Settings2 size={22} />}
        onBack={onBack}
      />

      <div className="flex gap-[16px] flex-1 min-h-0">
        {/*
          The rows are capped, not the column. With the shelf sidebar out of
          the way a row had the whole window to spread across and the delete
          button ended up a hand's width from the field it deletes — but
          narrowing the column would have pulled the consequence panel in off
          the right edge, where every other screen in the section keeps it.
        */}
        <div className="flex-1 min-w-0 flex flex-col gap-[8px] overflow-auto">
          <AnimatePresence initial={false}>
            {rows.map((row, index) => {
              const stock = stockItems.find(s => s.id === row.stockItemId);
              return (
                <motion.div
                  key={`${row.stockItemId}-${index}`}
                  layout
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, height: 0 }}
                  className="flex items-center gap-[12px] rounded-[14px] border border-[var(--app-border)] bg-[var(--app-bg-darker)] px-[15px] py-[11px] w-full max-w-[680px]"
                  data-assign-row={index}
                >
                  {stock && <StockIcon id={stock.iconId} size={23} color={ACCENT} />}
                  {/* The last two native selects in the app, brought onto the
                      shared dropdown so this screen stops being the one place
                      that shows the operating system's own menu. */}
                  <div className="min-w-[196px]">
                    <Select
                      value={row.stockItemId}
                      placeholder="Choose stock item…"
                      onChange={value => {
                        const nextStock = stockItems.find(s => s.id === value);
                        setRows(rs => rs.map((r, i) =>
                          i === index ? { ...r, stockItemId: value, unit: nextStock?.unit ?? r.unit } : r));
                      }}
                      options={stockItems.map(s => ({ value: s.id, label: s.name }))}
                    />
                  </div>

                  <span className="text-[var(--app-text-muted)] text-[14px]">per item</span>

                  {/* The last bare input in the section. It was a different
                      height from the dropdowns either side of it and had no
                      focus ring at all, so the row stepped up and down as the
                      eye crossed it. */}
                  <div className="w-[108px]">
                    <TextInput
                      value={row.quantity}
                      onChange={e => setRows(rs => rs.map((r, i) =>
                        i === index ? { ...r, quantity: e.target.value.replace(/[^\d.]/g, '') } : r))}
                      placeholder="0"
                      inputMode="decimal"
                      className="text-[17px] font-semibold tabular-nums text-right"
                    />
                  </div>

                  <div className="w-[104px]">
                    <Select
                      value={row.unit}
                      onChange={value => setRows(rs => rs.map((r, i) => i === index ? { ...r, unit: value } : r))}
                      options={UNIT_CHOICES
                        .filter(u => !stock || familyOf(u) === familyOf(stock.unit))
                        .map(u => ({ value: u, label: u }))}
                    />
                  </div>

                  <motion.button
                    whileTap={{ scale: 0.9 }}
                    onClick={() => setRows(rs => rs.filter((_, i) => i !== index))}
                    title="Remove"
                    className="flex items-center justify-center rounded-[8px] shrink-0"
                    style={{ width: 40, height: 40, background: `${DANGER}1a`, color: DANGER }}
                  >
                    <X size={19} />
                  </motion.button>
                </motion.div>
              );
            })}
          </AnimatePresence>

          <div className="flex items-center gap-[12px] pt-[4px] w-full max-w-[680px]">
            <GhostButton onClick={addRow}>
              <Plus size={19} /> Assign new stock item
            </GhostButton>

            {/* Save sits with the rows it saves. In the header's far-right
                corner it read as part of the title bar — a different section
                the eye had already skipped past. */}
            <PrimaryButton onClick={() => { onSave(resolved); setSaved(true); }} className="ml-auto">
              <AnimatePresence mode="wait" initial={false}>
                {saved ? (
                  <motion.span key="ok" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                    exit={{ opacity: 0 }} className="flex items-center gap-[9px]">
                    <Check size={19} /> Saved
                  </motion.span>
                ) : (
                  <motion.span key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    className="flex items-center gap-[9px]">
                    <Check size={19} /> Save recipe
                  </motion.span>
                )}
              </AnimatePresence>
            </PrimaryButton>
          </div>
        </div>

        {/* Consequence of what is being edited, right beside it */}
        <div className="w-[300px] shrink-0 flex flex-col gap-[11px]">
          <span className="text-[var(--app-text-muted)] text-[12px] uppercase tracking-[0.6px] font-semibold">
            With current stock
          </span>
          <div className="rounded-[14px] border border-[var(--app-border)] bg-[var(--app-bg-darker)] p-[16px] text-center">
            <motion.p
              key={estimate.count}
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 480, damping: 26 }}
              className="text-[var(--app-text)] text-[42px] font-bold leading-[46px] tabular-nums"
            >
              {estimate.count}
            </motion.p>
            <p className="text-[var(--app-text-muted)] text-[14px]">
              {menuItem.name}{estimate.count === 1 ? '' : 's'} can be made
            </p>
          </div>

          {estimate.bottleneck && (
            <div className="rounded-[12px] border p-[12px]" style={{ borderColor: `${DANGER}44`, background: `${DANGER}0d` }}>
              <p className="text-[11px] uppercase tracking-[0.5px] font-semibold mb-[3px]" style={{ color: DANGER }}>
                Limited by
              </p>
              <p className="text-[var(--app-text)] text-[15px] font-semibold">
                {estimate.bottleneck.stockItem.name}
              </p>
              <p className="text-[var(--app-text-muted)] text-[13px]">
                {formatQuantityLabel(estimate.bottleneck.available, estimate.bottleneck.stockItem.unit)} left
              </p>
            </div>
          )}

          {resolved.length === 0 && (
            <p className="text-[var(--app-text-muted)] text-[13px] leading-[17px]">
              With nothing assigned, this item is never blocked by stock and does not appear in the
              product estimate.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
