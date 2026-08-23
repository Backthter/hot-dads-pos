import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Boxes, ChevronRight, ClipboardCheck, ClipboardList, Droplet, History, Package, Plus, Printer,
  Search, Settings2, X,
} from 'lucide-react';
import { StockIcon } from './icons';
import {
  ACCENT, ACCENT_WARM, DANGER, GOOD, GhostButton, PrimaryButton, QuantityDisplay, ScreenHeader,
  StockTile,
} from './InventoryUI';

import { QuickAddPanel } from './QuickAddPanel';
import { PacketsScreen } from './PacketsScreen';
import { StockEditor } from './StockEditor';
import { AssignScreen } from './AssignScreen';
import { NavActions, NavSlot, NavTab, NavTabs } from '../components/Navigation';
import { useBackHandler, useTabStep } from '../lib/navigation';
import { useStickyState } from '../lib/screenState';
import { Button, EmptyState, HINT, TextInput, Tooltip, alpha, useSection } from '../ui';
import { StockTakeScreen, type StockTakeLine } from './StockTakeScreen';
import {
  MOVEMENT_LABELS, estimateAll, formatQuantityLabel, isLowStock, reorderList, scarcityColor,
} from '../lib/inventory';
import type {
  MenuItem, MenuItemStockAssignment, StockItem, StockMovement, StockMovementReason,
} from '../types';

type Tab = 'add' | 'assign' | 'history';

const TAB_LABEL: Record<Tab, string> = {
  add: 'Add Stock',
  assign: 'Assign Stock',
  history: 'History',
};
type Screen =
  | { kind: 'grid' }
  | { kind: 'quickAdd'; itemId: string }
  | { kind: 'packets' }
  | { kind: 'manage' }
  | { kind: 'stocktake' }
  | { kind: 'editor'; itemId?: string };

export interface InventoryViewProps {
  stockItems: StockItem[];
  menuItems: MenuItem[];
  assignments: MenuItemStockAssignment[];
  movements: StockMovement[];
  onAdjustStock: (itemId: string, delta: number, reason: StockMovementReason, note?: string, totalCost?: number) => void;
  onSaveStockItem: (item: StockItem) => void;
  onDeleteStockItem: (id: string) => void;
  onSetPacket: (itemId: string, size: number | null, label?: string, cost?: number) => void;
  onSaveAssignments: (menuItemId: string, rows: { stockItemId: string; quantityPerItem: number }[]) => void;
  onUndoMovement: (movementId: string) => void;
  onStockTake: (lines: StockTakeLine[], note: string) => void;
  onPrintReorder?: (lines: string[]) => void;
  onDrainStock: (itemIds: string[], note?: string) => void;
}

export function InventoryView({
  stockItems, menuItems, assignments, movements,
  onAdjustStock, onSaveStockItem, onDeleteStockItem, onSetPacket, onSaveAssignments,
  onUndoMovement, onStockTake, onPrintReorder, onDrainStock,
}: InventoryViewProps) {
  const theme = useSection();
  const [tab, setTabRaw] = useStickyState<Tab>('inventory.tab', 'add');
  const [screen, setScreen] = useState<Screen>({ kind: 'grid' });
  /**
   * Whether Assign Stock is editing one item rather than showing its grid.
   *
   * The detail editor has a consequence panel of its own, and stacking the
   * shelf sidebar beside that made three columns out of a screen that only
   * ever needed two. The flag comes back up from the child so the sidebar can
   * step out of the way for as long as the editor is open.
   */
  const [assignDetail, setAssignDetail] = useState(false);
  const setTab = useTabStep(tab, setTabRaw, t => TAB_LABEL[t]);
  const [search, setSearch] = useState('');
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [pulse, setPulse] = useState<{ id: string; delta: number; key: number } | null>(null);
  const [expandedEstimate, setExpandedEstimate] = useState<string | null>(null);
  const [showReorder, setShowReorder] = useState(false);
  /** Manage stock doubles as the place stock is emptied, behind a mode. */
  const [draining, setDraining] = useState(false);

  const estimates = useMemo(
    () => estimateAll(menuItems, assignments, stockItems),
    [menuItems, assignments, stockItems],
  );
  const reorder = useMemo(() => reorderList(stockItems, movements), [stockItems, movements]);
  const lowCount = stockItems.filter(isLowStock).length;

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const sorted = [...stockItems].sort((a, b) => {
      const lowDiff = Number(isLowStock(b)) - Number(isLowStock(a));
      return lowDiff !== 0 ? lowDiff : a.name.localeCompare(b.name);
    });
    return q ? sorted.filter(s => s.name.toLowerCase().includes(q)) : sorted;
  }, [stockItems, search]);

  // The quick-add panel and the reorder sheet are the two things here that do
  // not have a ScreenHeader to register a back step for them.
  useBackHandler(screen.kind === 'quickAdd', 'this stock item', () => setScreen({ kind: 'grid' }));
  useBackHandler(showReorder, 'the reorder list', () => setShowReorder(false));
  useBackHandler(draining, 'draining', () => setDraining(false));

  const activeItem = screen.kind === 'quickAdd'
    ? stockItems.find(s => s.id === screen.itemId) ?? null
    : null;

  const adjust = (
    itemId: string, delta: number, reason: StockMovementReason, note?: string, totalCost?: number,
  ) => {
    onAdjustStock(itemId, delta, reason, note, totalCost);
    setPulse({ id: itemId, delta, key: Date.now() });
    window.setTimeout(() => setPulse(p => (p && p.id === itemId ? null : p)), 1400);
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* The screen's tabs live in the permanent bar, not on a row of their own. */}
      <NavSlot>
        <NavTabs>
          {([
            { id: 'add', label: 'Add Stock', icon: Package, hint: HINT.addStock },
            { id: 'assign', label: 'Assign Stock', icon: Settings2, hint: HINT.assignStock },
            { id: 'history', label: 'History', icon: History, hint: HINT.stockHistory },
          ] as const).map(t => (
            <NavTab
              key={t.id}
              active={tab === t.id}
              onClick={() => { setTab(t.id); setScreen({ kind: 'grid' }); }}
              icon={<t.icon size={19} />}
              label={t.label}
              hint={t.hint}
              groupId="inventory"
              data-inv-tab={t.id}
            />
          ))}
        </NavTabs>

        <NavActions>
          {lowCount > 0 && (
            <Tooltip label={HINT.reorderList}>
              <motion.button
                layout
                onClick={() => setShowReorder(true)}
                data-open-reorder
                className="flex items-center gap-[8px] px-[15px] h-[46px] rounded-[11px] text-[14px] font-bold border"
                style={{ borderColor: DANGER, background: alpha(DANGER, 0.13), color: DANGER }}
                animate={{ opacity: [0.78, 1] }}
                transition={{ duration: 1.6, repeat: Infinity, repeatType: 'mirror' }}
              >
                <ClipboardList size={17} />
                {lowCount} low · reorder
              </motion.button>
            </Tooltip>
          )}
        </NavActions>
      </NavSlot>

      <div className="flex-1 min-h-0 bg-[var(--app-bg)] border-t border-[var(--app-border)] p-[18px]">
        {tab === 'assign' ? (
          /*
            Assign Stock gets the same sidebar as Add Stock.
            Deciding how much of something a burger uses is a question about
            what is on the shelf, and the answer was one tab away — so it was
            being done from memory, or by flipping back and forth. The panel is
            the same component, so the two screens cannot drift apart.
          */
          <div className="flex gap-[16px] h-full min-h-0">
            <div className="flex-1 min-w-0 flex flex-col">
              <AssignScreen
                menuItems={menuItems}
                stockItems={stockItems}
                assignments={assignments}
                onSave={onSaveAssignments}
                onDetailChange={setAssignDetail}
              />
            </div>
            {!assignDetail && (
              <StockSidebar
                stockItems={stockItems}
                visible={visible}
                lowCount={lowCount}
                hoveredId={hoveredId}
                pulse={pulse}
                estimates={estimates}
                expandedEstimate={expandedEstimate}
                reorderCount={reorder.length}
                onHoverChange={setHoveredId}
                onPick={id => { setTab('add'); setScreen({ kind: 'quickAdd', itemId: id }); }}
                onOpenReorder={() => setShowReorder(true)}
                onToggleEstimate={id => setExpandedEstimate(prev => (prev === id ? null : id))}
              />
            )}
          </div>
        ) : tab === 'history' ? (
          <HistoryPanel movements={movements} stockItems={stockItems} onUndo={onUndoMovement} />
        ) : (
          <div className="flex gap-[16px] h-full min-h-0">
            {/* Left — grid and its sub-screens */}
            <div className="flex-1 min-w-0 flex flex-col">
              <AnimatePresence mode="wait" initial={false}>
                {screen.kind === 'grid' && (
                  <motion.div
                    key="grid"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0, pointerEvents: 'none' }}
                    transition={{ duration: 0.12 }}
                    className="flex flex-col h-full min-h-0"
                  >
                    {/*
                      The search box and the three sub-screens used to be a bare
                      row of controls with nothing above them: the one stock
                      screen without a title, while its own sub-screens all had
                      one. They now sit in the same header every other screen in
                      the section uses, with a rule separating the field that
                      filters this screen from the buttons that leave it.
                    */}
                    <ScreenHeader
                      title="Add stock"
                      subtitle="Tap what came in."
                      icon={<Package size={22} />}
                      actions={
                        <>
                          <div className="w-[186px]">
                            <TextInput
                              value={search}
                              onChange={e => setSearch(e.target.value)}
                              placeholder="Search stock"
                              capitalize={false}
                              icon={<Search size={18} />}
                            />
                          </div>
                          <span
                            className="w-px h-[30px] shrink-0"
                            style={{ background: 'var(--app-border)' }}
                          />
                          <GhostButton onClick={() => setScreen({ kind: 'packets' })} title={HINT.packets}>
                            <Boxes size={19} /> Packets
                          </GhostButton>
                          <GhostButton onClick={() => setScreen({ kind: 'stocktake' })} data-open-stocktake title={HINT.stockTake}>
                            <ClipboardCheck size={19} /> Stock take
                          </GhostButton>
                          <GhostButton
                            onClick={() => setScreen({ kind: 'manage' })}
                            data-open-manage
                            title={HINT.manageStock}
                          >
                            <Settings2 size={19} /> Manage stock
                          </GhostButton>
                        </>
                      }
                    />

                    <div
                      className="grid gap-[10px] overflow-auto content-start flex-1"
                      style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(196px, 1fr))' }}
                    >
                      <AnimatePresence initial={false}>
                        {visible.map(item => (
                          <StockTile
                            key={item.id}
                            item={item}
                            highlighted={hoveredId === item.id}
                            onHoverChange={h => setHoveredId(h ? item.id : null)}
                            onPress={() => setScreen({ kind: 'quickAdd', itemId: item.id })}
                            subtitle={item.packetSize
                              ? `1 ${item.packetLabel || 'packet'} = ${formatQuantityLabel(item.packetSize, item.unit)}`
                              : undefined}
                          />
                        ))}
                      </AnimatePresence>
                      {visible.length === 0 && (
                        <div className="col-span-full py-[30px]">
                          <EmptyState
                            icon={<Package size={30} />}
                            title={search ? `Nothing on the shelf matches "${search}"` : 'Nothing on the shelf yet'}
                            description={search
                              ? 'Try a shorter word, or clear the search to see everything.'
                              : 'Add the things you buy in — buns, patties, cups — and the app can work out what you can still make, what a sale costs you, and when to reorder. New items are created in Manage stock.'}
                            action={!search && (
                              <PrimaryButton onClick={() => setScreen({ kind: 'manage' })}>
                                <Settings2 size={16} /> Open Manage stock
                              </PrimaryButton>
                            )}
                          />
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}

                {screen.kind === 'quickAdd' && activeItem && (
                  <QuickAddPanel
                    key={`quick-${activeItem.id}`}
                    item={activeItem}
                    others={stockItems.filter(s => s.id !== activeItem.id).slice(0, 6)}
                    movements={movements}
                    onAdd={(delta, reason, note, totalCost) => adjust(activeItem.id, delta, reason, note, totalCost)}
                    onUndo={onUndoMovement}
                    onSwap={id => setScreen({ kind: 'quickAdd', itemId: id })}
                    onClose={() => setScreen({ kind: 'grid' })}
                  />
                )}

                {screen.kind === 'packets' && (
                  <motion.div key="packets" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, pointerEvents: 'none' }}
                    transition={{ duration: 0.12 }} className="h-full min-h-0">
                    <PacketsScreen
                      stockItems={stockItems}
                      onSetPacket={onSetPacket}
                      onBack={() => setScreen({ kind: 'grid' })}
                    />
                  </motion.div>
                )}

                {screen.kind === 'manage' && (
                  <motion.div key="manage" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6, pointerEvents: 'none' }}
                    transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                    /*
                      Managing the list is a mode, so it is framed — but framed
                      in the section's own colour. It used to be violet, which
                      made the one screen in an orange section that looked like
                      it belonged to another part of the program.
                    */
                    className="flex flex-col h-full min-h-0 rounded-[16px] border p-[16px] -m-[2px]"
                    style={{
                      borderColor: draining ? alpha(DANGER, 0.34) : alpha(theme.color, 0.28),
                      background: draining ? alpha(DANGER, 0.05) : alpha(theme.color, 0.05),
                      transition: 'background-color 160ms, border-color 160ms',
                    }}
                  >
                    <ScreenHeader
                      title="Manage stock"
                      subtitle={draining
                        ? 'Emptying: tap an item to take everything on the shelf off it.'
                        : 'Add, rename, empty or remove the things you keep on the shelf.'}
                      icon={draining ? <Droplet size={22} /> : <Settings2 size={22} />}
                      onBack={() => setScreen({ kind: 'grid' })}
                      tone={draining ? DANGER : undefined}
                      actions={
                        <>
                          <GhostButton
                            onClick={() => setDraining(d => !d)}
                            active={draining}
                            tone={DANGER}
                            data-drain-mode
                          >
                            <Droplet size={16} /> {draining ? 'Done' : 'Drain'}
                          </GhostButton>
                          {!draining && (
                            <PrimaryButton onClick={() => setScreen({ kind: 'editor' })} className="!h-[42px]">
                              <Plus size={16} /> New item
                            </PrimaryButton>
                          )}
                        </>
                      }
                    />

                    <AnimatePresence initial={false}>
                      {draining && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          className="overflow-hidden shrink-0"
                        >
                          <div
                            className="flex items-center gap-[12px] rounded-[12px] px-[14px] py-[11px] mb-[12px] flex-wrap"
                            style={{ background: alpha(DANGER, 0.1), border: `1px solid ${alpha(DANGER, 0.34)}` }}
                          >
                            {/* The instruction moved up into the subtitle when
                                the mode got its own heading; what is left here
                                is the part that is not obvious — where the
                                stock goes. */}
                            <span className="text-[13px] leading-[18px] flex-1 min-w-[280px]" style={{ color: 'var(--app-text-secondary)' }}>
                              What was on the shelf is recorded as drained, so it still counts as
                              a loss rather than quietly disappearing.
                            </span>
                            <GhostButton
                              onClick={() => { onDrainStock(stockItems.map(s => s.id), 'Drained everything'); setDraining(false); }}
                              tone={DANGER}
                              data-drain-all
                            >
                              <Droplet size={15} /> Drain everything
                            </GhostButton>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    <div className="grid gap-[10px] overflow-auto content-start flex-1"
                      style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(196px, 1fr))' }}>
                      <AnimatePresence initial={false}>
                        {stockItems.map(item => (
                          <StockTile
                            key={item.id}
                            item={item}
                            tone={draining && item.quantity > 0 ? DANGER : undefined}
                            subtitle={draining
                              ? (item.quantity > 0 ? 'Tap to empty' : 'Already empty')
                              : undefined}
                            onPress={() => {
                              if (draining) {
                                if (item.quantity > 0) onDrainStock([item.id], `Drained ${item.name}`);
                                return;
                              }
                              setScreen({ kind: 'editor', itemId: item.id });
                            }}
                          />
                        ))}
                      </AnimatePresence>
                      {/* Hidden while emptying: the mode is about taking things
                          off the shelf, and an inviting "Add new" in the middle
                          of it is one mis-tap from the wrong screen. */}
                      {!draining && (
                      <motion.button
                        layout
                        whileTap={{ scale: 0.97 }}
                        onClick={() => setScreen({ kind: 'editor' })}
                        data-add-new-stock
                        className="rounded-[16px] border border-dashed flex flex-col items-center justify-center gap-[8px]"
                        style={{
                          borderColor: alpha(theme.color, 0.42),
                          background: alpha(theme.color, 0.06),
                          minHeight: 146,
                        }}
                      >
                        <Plus size={26} style={{ color: theme.color }} />
                        <span className="text-[var(--app-text-secondary)] text-[15px] font-bold">Add new</span>
                      </motion.button>
                      )}
                    </div>
                  </motion.div>
                )}

                {screen.kind === 'stocktake' && (
                  <motion.div key="stocktake" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, pointerEvents: 'none' }}
                    transition={{ duration: 0.12 }} className="h-full min-h-0">
                    <StockTakeScreen
                      stockItems={stockItems}
                      onCommit={(lines, note) => { onStockTake(lines, note); }}
                      onBack={() => setScreen({ kind: 'grid' })}
                    />
                  </motion.div>
                )}

                {screen.kind === 'editor' && (
                  <motion.div key="editor" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, pointerEvents: 'none' }}
                    transition={{ duration: 0.12 }} className="h-full min-h-0">
                    <StockEditor
                      item={screen.itemId ? stockItems.find(s => s.id === screen.itemId) : undefined}
                      onSave={item => { onSaveStockItem(item); setScreen({ kind: 'manage' }); }}
                      onDelete={id => { onDeleteStockItem(id); setScreen({ kind: 'manage' }); }}
                      onSubtract={(id, amount, reason) => adjust(id, -amount, reason)}
                      onBack={() => setScreen({ kind: 'manage' })}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <StockSidebar
              stockItems={stockItems}
              visible={visible}
              lowCount={lowCount}
              hoveredId={hoveredId}
              pulse={pulse}
              estimates={estimates}
              expandedEstimate={expandedEstimate}
              reorderCount={reorder.length}
              onHoverChange={setHoveredId}
              onPick={id => setScreen({ kind: 'quickAdd', itemId: id })}
              onOpenReorder={() => setShowReorder(true)}
              onToggleEstimate={id => setExpandedEstimate(prev => (prev === id ? null : id))}
            />
          </div>
        )}
      </div>

      <AnimatePresence>
        {showReorder && (
          <ReorderSheet
            suggestions={reorder}
            onClose={() => setShowReorder(false)}
            onPrint={onPrintReorder}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

/* ---------------------------------------------------------------- sidebar */

/**
 * What is on the shelf, beside whatever you are doing to it.
 *
 * Extracted so Add Stock and Assign Stock show exactly the same thing rather
 * than two versions of it that drift.
 */
function StockSidebar({
  stockItems, visible, lowCount, hoveredId, pulse, estimates, expandedEstimate, reorderCount,
  onHoverChange, onPick, onOpenReorder, onToggleEstimate,
}: {
  stockItems: StockItem[];
  visible: StockItem[];
  lowCount: number;
  hoveredId: string | null;
  pulse: { id: string; delta: number; key: number } | null;
  estimates: ReturnType<typeof estimateAll>;
  expandedEstimate: string | null;
  reorderCount: number;
  onHoverChange: (id: string | null) => void;
  onPick: (id: string) => void;
  onOpenReorder: () => void;
  onToggleEstimate: (id: string) => void;
}) {
  return (
    <div className="w-[380px] shrink-0 flex flex-col gap-[12px] min-h-0">
      <StockSummaryStrip stockItems={stockItems} lowCount={lowCount} />
      <TotalStockPanel
        stockItems={visible}
        hoveredId={hoveredId}
        pulse={pulse}
        onHoverChange={onHoverChange}
        onPick={onPick}
        onOpenReorder={onOpenReorder}
        reorderCount={reorderCount}
      />
      <ProductEstimatePanel
        estimates={estimates}
        expandedId={expandedEstimate}
        onToggle={onToggleEstimate}
      />
    </div>
  );
}

/* ----------------------------------------------------------- summary strip */

/**
 * Three numbers that are otherwise buried: what the shelf is worth, how many
 * lines it holds, and how many of them are running out.
 */
function StockSummaryStrip({ stockItems, lowCount }: { stockItems: StockItem[]; lowCount: number }) {
  const value = stockItems.reduce((sum, item) => sum + item.quantity * (item.costPerUnit || 0), 0);
  const cells: { label: string; value: string; tone?: string }[] = [
    { label: 'Stock value', value: value > 0 ? `Rs ${Math.round(value).toLocaleString()}` : '—' },
    { label: 'Items', value: String(stockItems.length) },
    { label: 'Running low', value: String(lowCount), tone: lowCount > 0 ? DANGER : undefined },
  ];
  return (
    <div className="shrink-0 grid grid-cols-3 gap-[8px]">
      {cells.map(cell => (
        <div
          key={cell.label}
          className="rounded-[12px] border border-[var(--app-border)] bg-[var(--app-bg-darker)] px-[12px] py-[10px]"
        >
          <span className="block text-[var(--app-text-muted)] text-[10px] uppercase tracking-[0.5px] font-semibold">
            {cell.label}
          </span>
          <span
            className="block text-[17px] font-bold leading-[22px] tabular-nums truncate"
            style={{ color: cell.tone ?? 'var(--app-text)' }}
          >
            {cell.value}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------- total stock */

function TotalStockPanel({
  stockItems, hoveredId, pulse, onHoverChange, onPick, onOpenReorder, reorderCount,
}: {
  stockItems: StockItem[];
  hoveredId: string | null;
  pulse: { id: string; delta: number; key: number } | null;
  onHoverChange: (id: string | null) => void;
  onPick: (id: string) => void;
  onOpenReorder: () => void;
  reorderCount: number;
}) {
  return (
    <div className="flex flex-col rounded-[14px] border border-[var(--app-border)] bg-[var(--app-bg-darker)] p-[14px] flex-1 min-h-0">
      <div className="flex items-center mb-[10px]">
        <span className="text-[var(--app-text-muted)] text-[11px] uppercase tracking-[0.6px] font-semibold">
          Total stock
        </span>
        {reorderCount > 0 && (
          <button
            onClick={onOpenReorder}
            className="ml-auto text-[11px] font-semibold flex items-center gap-[5px]"
            style={{ color: ACCENT_WARM }}
          >
            <ClipboardList size={12} /> Reorder {reorderCount}
          </button>
        )}
      </div>

      <div className="flex-1 overflow-auto flex flex-col gap-[2px]">
        <AnimatePresence initial={false}>
          {stockItems.map(item => {
            const active = hoveredId === item.id;
            const low = isLowStock(item);
            const pulsing = pulse?.id === item.id;
            return (
              <motion.button
                key={item.id}
                layout
                onClick={() => onPick(item.id)}
                onHoverStart={() => onHoverChange(item.id)}
                onHoverEnd={() => onHoverChange(null)}
                data-total-row={item.id}
                className="relative flex items-center gap-[9px] rounded-[9px] px-[10px] h-[40px] text-left overflow-hidden"
                animate={{
                  backgroundColor: pulsing
                    ? 'rgba(21,210,178,0.22)'
                    : active ? 'var(--app-bg-tertiary)' : 'rgba(0,0,0,0)',
                }}
                transition={{ duration: pulsing ? 0.25 : 0.15 }}
              >
                <StockIcon id={item.iconId} size={15} color={low ? DANGER : 'var(--app-text-muted)'} />
                <span className="text-[var(--app-text)] text-[14px] font-medium truncate max-w-[150px]">
                  {item.name}
                </span>
                <span
                  className="flex-1 border-b border-dotted mx-[2px]"
                  style={{ borderColor: 'var(--app-border)' }}
                />
                <QuantityDisplay quantity={item.quantity} unit={item.unit} size={14} />

                <AnimatePresence>
                  {pulsing && (
                    <motion.span
                      key={pulse!.key}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: -10 }}
                      exit={{ opacity: 0, y: -18 }}
                      transition={{ duration: 0.7 }}
                      className="absolute right-[10px] text-[12px] font-bold pointer-events-none"
                      style={{ color: pulse!.delta >= 0 ? GOOD : DANGER }}
                    >
                      {pulse!.delta >= 0 ? '+' : '−'}
                      {formatQuantityLabel(Math.abs(pulse!.delta), item.unit)}
                    </motion.span>
                  )}
                </AnimatePresence>
              </motion.button>
            );
          })}
        </AnimatePresence>
        {stockItems.length === 0 && (
          <p className="text-[var(--app-text-muted)] text-[12px] py-[8px]">Nothing to show.</p>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------- product estimate */

function ProductEstimatePanel({
  estimates, expandedId, onToggle,
}: {
  estimates: ReturnType<typeof estimateAll>;
  expandedId: string | null;
  onToggle: (id: string) => void;
}) {
  const expanded = estimates.find(e => e.menuItemId === expandedId) ?? null;

  return (
    <div className="rounded-[14px] border border-[var(--app-border)] bg-[var(--app-bg-darker)] p-[14px] shrink-0">
      <span className="text-[var(--app-text-muted)] text-[11px] uppercase tracking-[0.6px] font-semibold">
        Product estimate
      </span>

      {estimates.length === 0 ? (
        <p className="text-[var(--app-text-muted)] text-[12px] mt-[8px]">
          Assign stock to a menu item to see how many you can make.
        </p>
      ) : (
        <>
          <div className="flex gap-[8px] overflow-x-auto mt-[10px] pb-[2px]">
            {estimates.map(est => {
              const open = expandedId === est.menuItemId;
              return (
                <motion.button
                  key={est.menuItemId}
                  layout
                  onClick={() => onToggle(est.menuItemId)}
                  data-estimate={est.menuItemId}
                  whileTap={{ scale: 0.97 }}
                  className="shrink-0 flex items-center gap-[10px] rounded-[11px] border px-[13px] h-[58px]"
                  style={{
                    background: open ? 'var(--app-bg-tertiary)' : 'var(--app-surface)',
                    borderColor: open ? ACCENT : 'var(--app-border)',
                  }}
                >
                  <span className="flex flex-col items-start">
                    <span className="text-[var(--app-text-muted)] text-[11px] leading-[13px]">{est.name}</span>
                    <span className="text-[var(--app-text)] text-[21px] font-bold leading-[24px] tabular-nums">
                      {est.count}
                    </span>
                  </span>
                  <motion.span animate={{ rotate: open ? 90 : 0 }}>
                    <ChevronRight size={15} className="text-[var(--app-text-muted)]" />
                  </motion.span>
                </motion.button>
              );
            })}
          </div>

          <AnimatePresence initial={false}>
            {expanded && (
              <motion.div
                key={expanded.menuItemId}
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="pt-[12px] mt-[12px] border-t border-[var(--app-border)]">
                  <div className="flex flex-wrap gap-[6px] mb-[10px]">
                    {expanded.ingredients.map((ing, index) => {
                      const color = scarcityColor(index, expanded.ingredients.length);
                      return (
                        <motion.span
                          key={ing.stockItem.id}
                          layout
                          initial={{ opacity: 0, scale: 0.85 }}
                          animate={{ opacity: 1, scale: 1 }}
                          transition={{ type: 'spring', stiffness: 460, damping: 30 }}
                          className="flex flex-col items-center rounded-[10px] px-[11px] py-[5px]"
                          style={{ background: `${color}26`, border: `1px solid ${color}` }}
                          title={`${ing.stockItem.name}: enough for ${Math.floor(ing.ratio)}`}
                        >
                          <span className="text-[13px] font-bold leading-[16px]" style={{ color }}>
                            {formatQuantityLabel(ing.available, ing.stockItem.unit)}
                          </span>
                          <span className="text-[10px] leading-[12px] text-[var(--app-text-muted)]">
                            {ing.stockItem.name}
                          </span>
                        </motion.span>
                      );
                    })}
                  </div>

                  {expanded.bottleneck && (
                    <motion.p
                      key={`b-${expanded.bottleneck.stockItem.id}`}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="text-[var(--app-text-secondary)] text-[12px] leading-[17px]"
                    >
                      Held back by <strong style={{ color: DANGER }}>{expanded.bottleneck.stockItem.name}</strong>
                      {' — '}
                      {formatQuantityLabel(expanded.bottleneck.available, expanded.bottleneck.stockItem.unit)} left.
                      {expanded.topUp !== undefined && expanded.nextTarget !== undefined && (
                        <>
                          {' '}Add{' '}
                          <strong style={{ color: GOOD }}>
                            {formatQuantityLabel(expanded.topUp, expanded.bottleneck.stockItem.unit)}
                          </strong>
                          {' '}to reach {expanded.nextTarget}.
                        </>
                      )}
                    </motion.p>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- history */

function HistoryPanel({
  movements, stockItems, onUndo,
}: { movements: StockMovement[]; stockItems: StockItem[]; onUndo: (id: string) => void }) {
  const [filter, setFilter] = useState<string>('all');

  const rows = useMemo(() => {
    const sorted = [...movements].sort((a, b) => b.timestamp - a.timestamp);
    return filter === 'all' ? sorted : sorted.filter(m => m.stockItemId === filter);
  }, [movements, filter]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-[10px] mb-[12px]">
        <div>
          <h2 className="text-[var(--app-text)] text-[19px] font-bold leading-[23px]">Stock history</h2>
          <p className="text-[var(--app-text-muted)] text-[12px]">
            Every change, including what orders consumed
          </p>
        </div>
        <select
          value={filter}
          onChange={e => setFilter(e.target.value)}
          className="ml-auto bg-[var(--app-bg-darker)] border border-[var(--app-border)] rounded-[9px] px-[10px] h-[36px] text-[var(--app-text)] text-[13px] focus:outline-none"
        >
          <option value="all">All items</option>
          {stockItems.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>

      <div className="flex-1 overflow-auto flex flex-col gap-[4px]">
        {rows.length === 0 ? (
          <p className="text-[var(--app-text-muted)] text-[13px]">Nothing recorded yet.</p>
        ) : (
          rows.map(m => {
            const item = stockItems.find(s => s.id === m.stockItemId);
            const undoable = m.reason === 'added' || m.reason === 'packet';
            return (
              <motion.div
                key={m.id}
                layout
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-center gap-[10px] rounded-[10px] border border-[var(--app-border)] bg-[var(--app-bg-darker)] px-[12px] h-[46px]"
              >
                <StockIcon id={item?.iconId} size={16} color="var(--app-text-muted)" />
                <span className="text-[var(--app-text)] text-[13px] font-medium w-[140px] truncate">
                  {item?.name ?? 'Removed item'}
                </span>
                <span
                  className="text-[13px] font-bold tabular-nums w-[92px]"
                  style={{ color: m.delta >= 0 ? GOOD : DANGER }}
                >
                  {m.delta >= 0 ? '+' : '−'}{formatQuantityLabel(Math.abs(m.delta), item?.unit ?? 'pcs')}
                </span>
                <span className="text-[var(--app-text-secondary)] text-[12px] truncate">
                  {MOVEMENT_LABELS[m.reason]}{m.note ? ` · ${m.note}` : ''}
                </span>
                <span className="ml-auto text-[var(--app-text-muted)] text-[11px] shrink-0">
                  {new Date(m.timestamp).toLocaleString([], {
                    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                  })}
                </span>
                {undoable && (
                  <button
                    onClick={() => onUndo(m.id)}
                    className="text-[11px] font-semibold shrink-0"
                    style={{ color: ACCENT }}
                  >
                    Undo
                  </button>
                )}
              </motion.div>
            );
          })
        )}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- reorder */

/** Spells out where an "hours left" figure came from, for the row's tooltip. */
function workingOut(s: ReturnType<typeof reorderList>[number]): string {
  if (!s.rate) return 'Nothing sold yet, so this is on the low-stock threshold alone.';
  const { perHour, tradingHours, samples, spanDays, reliable } = s.rate;
  const basis = `${samples} movement${samples === 1 ? '' : 's'} across `
    + `${tradingHours} trading hour${tradingHours === 1 ? '' : 's'}`
    + `${spanDays >= 1 ? `, spread over ${spanDays.toFixed(0)} days` : ''}`;
  if (!reliable) {
    return `Too little trading to forecast — ${basis}. Listed because it is under its threshold.`;
  }
  return `${basis} → ${perHour.toFixed(1)} ${s.stockItem.unit} per trading hour. `
    + `Stock ÷ that rate is the hours left. Closed time is not counted.`;
}

function ReorderSheet({
  suggestions, onClose, onPrint,
}: {
  suggestions: ReturnType<typeof reorderList>;
  onClose: () => void;
  onPrint?: (lines: string[]) => void;
}) {
  const lines = suggestions.map(s => {
    const amount = formatQuantityLabel(s.shortfall, s.stockItem.unit);
    const packets = s.packets
      ? `${s.packets} × ${s.stockItem.packetLabel || 'packet'} (${amount})`
      : amount;
    return `${s.stockItem.name}: ${packets}`;
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <motion.div
      data-reorder-sheet
      className="fixed inset-0 z-[95] flex items-center justify-center p-[24px]"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      transition={{ duration: 0.12 }}
      style={{ background: 'rgba(6,6,8,0.6)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.94, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 480, damping: 34 }}
        onClick={e => e.stopPropagation()}
        className="bg-[var(--app-bg-darker)] border border-[var(--app-border)] rounded-[16px] p-[20px] w-full max-w-[520px] sheet-max-h flex flex-col"
      >
        <div className="flex items-center mb-[6px]">
          <h3 className="text-[var(--app-text)] text-[17px] font-bold">Reorder list</h3>
          <button onClick={onClose} className="ml-auto text-[var(--app-text-muted)] hover:text-[var(--app-text)]">
            <X size={18} />
          </button>
        </div>
        <p className="text-[var(--app-text-muted)] text-[12px] mb-[14px]">
          What is under its threshold or about to run out, rounded up to whole packets.
        </p>

        <div className="flex-1 overflow-auto flex flex-col gap-[6px]">
          {suggestions.length === 0 ? (
            <p className="text-[var(--app-text-secondary)] text-[13px]">Nothing needs reordering.</p>
          ) : suggestions.map(s => (
            <div
              key={s.stockItem.id}
              className="flex items-center gap-[10px] rounded[10px] rounded-[10px] border border-[var(--app-border)] bg-[var(--app-surface)] px-[12px] h-[52px]"
            >
              <StockIcon id={s.stockItem.iconId} size={17} color={DANGER} />
              <div className="min-w-0">
                <p className="text-[var(--app-text)] text-[13px] font-semibold truncate">{s.stockItem.name}</p>
                <p className="text-[var(--app-text-muted)] text-[11px] truncate" title={workingOut(s)}>
                  {formatQuantityLabel(s.stockItem.quantity, s.stockItem.unit)} left
                  {s.hoursLeft !== undefined
                    ? ` · about ${s.hoursLeft < 1 ? 'under an hour' : `${s.hoursLeft.toFixed(1)} hours`} of trading at ${
                        formatQuantityLabel(Math.round(s.rate!.perHour), s.stockItem.unit)}/hr`
                    : ' · under its threshold'}
                </p>
              </div>
              <span className="ml-auto text-right">
                <span className="block text-[13px] font-bold" style={{ color: ACCENT }}>
                  {s.packets ? `${s.packets} × ${s.stockItem.packetLabel || 'packet'}` : formatQuantityLabel(s.shortfall, s.stockItem.unit)}
                </span>
                {s.packets && (
                  <span className="block text-[var(--app-text-muted)] text-[10px]">
                    {formatQuantityLabel(s.shortfall, s.stockItem.unit)} needed
                  </span>
                )}
              </span>
            </div>
          ))}
        </div>

        {suggestions.length > 0 && onPrint && (
          <PrimaryButton onClick={() => onPrint(lines)} className="mt-[14px] self-end">
            <Printer size={16} /> Print list
          </PrimaryButton>
        )}
      </motion.div>
    </motion.div>
  );
}
