import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowUpDown, Check, GripVertical, Layers, Lock, Monitor, Percent, Plus, Printer, RotateCcw,
  ShieldCheck, SlidersHorizontal, Trash2, UtensilsCrossed, X,
} from 'lucide-react';
import { NavActions, NavSlot, NavTab, NavTabs } from '../components/Navigation';
import { WipeDataPanel, type WipeScope } from '../components/WipeDataPanel';
import { SyncSettings } from '../../db/SyncSettings';
import { getAppSetting, setAppSetting } from '../../db/persistence';
import { useBackHandler, useTabStep } from '../lib/navigation';
import { useStickyState } from '../lib/screenState';
import {
  Button, DANGER, ELEVATION, HINT, IconButton, NumberStepper, Panel, ScreenHeading,
  SegmentedControl, Select, SettingRow, TextInput, Toggle, Tooltip, alpha, useSection, useToast,
  DURATION, EASE, GLIDE, SUCCESS, capitalizeFirst, useReducedMotion,
} from '../ui';
import { componentsTotal, isDealItem, isSystemCategory } from '../lib/menu';
import type { Category, MenuItem } from '../types';

/**
 * Settings, lifted out of App.tsx.
 *
 * It was some seven hundred lines of hand-written markup in the middle of the
 * component that also runs the till, and it showed: nine near-identical setting
 * rows written nine slightly different ways, four spellings of the same toggle,
 * its own tab strip that looked nothing like the tab strips in Inventory and
 * Analytics. All of that is now the shared primitives, and the tabs live in the
 * permanent bar like every other section's.
 */

type Tab = 'menu' | 'orders' | 'program';

export interface SettingsViewProps {
  categories: Category[];
  menuItems: MenuItem[];
  onAddCategory: (name: string) => void;
  onUpdateCategory: (id: string, patch: Partial<Category>) => void;
  onDeleteCategory: (id: string) => void;
  onReorderCategories: (draggedId: string, targetId: string) => void;
  onAddMenuItem: (name: string, price: number, category: string) => void;
  onUpdateMenuItem: (id: string, patch: Partial<MenuItem>) => void;
  onDeleteMenuItem: (id: string) => void;

  grillCapacity: string;
  onGrillCapacity: (value: string) => void;
  grillOnBoard: number;
  tapToExpandParked: boolean;
  onTapToExpandParked: (value: boolean) => void;
  taxEnabled: boolean;
  onTaxEnabled: (value: boolean) => void;
  taxRate: string;
  onTaxRate: (value: string) => void;
  discountRequiresPin: boolean;
  onDiscountRequiresPin: (value: boolean) => void;

  lightMode: boolean;
  onLightMode: (value: boolean) => void;
  uiScale: number;
  onUiScale: (value: number) => void;
  fullscreen: boolean;
  onFullscreen: (value: boolean) => void;
  autoPrint: boolean;
  onAutoPrint: (value: boolean) => void;
  printerName: string;
  onPrinterName: (value: string) => void;
  onTestPrint: () => Promise<void>;
  onWipe: (scope: WipeScope) => Promise<void>;
  onRevenuePinChanged: (pin: string) => void;
}

const TAB_LABEL: Record<Tab, string> = {
  menu: 'Menu',
  orders: 'Orders',
  program: 'Program',
};

export function SettingsView(props: SettingsViewProps) {
  const [tab, setTabRaw] = useStickyState<Tab>('settings.tab', 'menu');
  const setTab = useTabStep(tab, setTabRaw, t => TAB_LABEL[t]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <NavSlot>
        <NavTabs>
          <NavTab active={tab === 'menu'} onClick={() => setTab('menu')} groupId="settings"
            icon={<UtensilsCrossed size={18} />} label="Menu" data-settings-tab="menu"
            hint="The categories, items and deals that appear on the ordering screen." />
          <NavTab active={tab === 'orders'} onClick={() => setTab('orders')} groupId="settings"
            icon={<SlidersHorizontal size={18} />} label="Orders" data-settings-tab="orders"
            hint="How orders are priced and how they move through the kitchen." />
          <NavTab active={tab === 'program'} onClick={() => setTab('program')} groupId="settings"
            icon={<Monitor size={18} />} label="Program" data-settings-tab="program"
            hint="How the program looks and behaves on this machine." />
        </NavTabs>
      </NavSlot>

      <div className="flex-1 min-h-0 overflow-auto p-[24px]">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: DURATION.fast, ease: EASE }}
          >
            {tab === 'menu' && <MenuSettings {...props} />}
            {tab === 'orders' && <OrderSettings {...props} />}
            {tab === 'program' && <ProgramSettings {...props} />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------- menu */

function MenuSettings({
  categories, menuItems, onAddCategory, onUpdateCategory, onDeleteCategory, onReorderCategories,
  onAddMenuItem, onUpdateMenuItem, onDeleteMenuItem,
}: SettingsViewProps) {
  const [addingCategory, setAddingCategory] = useState(false);
  const [categoryName, setCategoryName] = useState('');
  const [addingItem, setAddingItem] = useState(false);
  const [itemName, setItemName] = useState('');
  const [itemPrice, setItemPrice] = useState('');
  const [itemCategory, setItemCategory] = useState(categories[0]?.name ?? 'Food');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [reordering, setReordering] = useState(false);

  // Back closes whichever form is open before it leaves Settings.
  useBackHandler(addingCategory, 'the new category form', () => setAddingCategory(false));
  useBackHandler(addingItem, 'the new item form', () => setAddingItem(false));
  useBackHandler(reordering, 'category reordering', () => setReordering(false));

  const sorted = [...categories].sort((a, b) => a.order - b.order);

  /**
   * Items grouped under the category they belong to.
   *
   * The list used to be flat, with every item repeating its own category in a
   * dropdown — which is the same word written thirty times down the page, and
   * gives no sense of the menu's shape. Grouped, the page answers the question
   * you actually arrive with: what is on the menu, and where.
   */
  const grouped = sorted.map(category => ({
    category,
    items: menuItems.filter(m => m.category === category.name),
  }));
  const orphans = menuItems.filter(m => !categories.some(c => c.name === m.category));

  const submitCategory = () => {
    if (!categoryName.trim()) return;
    onAddCategory(categoryName.trim());
    setCategoryName('');
    setAddingCategory(false);
  };

  const submitItem = () => {
    const price = parseFloat(itemPrice);
    if (!itemName.trim() || !Number.isFinite(price) || price <= 0) return;
    onAddMenuItem(itemName.trim(), price, itemCategory);
    setItemName('');
    setItemPrice('');
    setAddingItem(false);
  };

  return (
    <div className="max-w-[1240px] mx-auto flex flex-col gap-[18px]">
      <ScreenHeading
        title="Menu"
        subtitle="What the ordering screen offers, and what each thing costs."
        icon={<UtensilsCrossed size={22} />}
        actions={
          <>
            <Button
              variant="secondary"
              icon={<ArrowUpDown size={17} />}
              onClick={() => setReordering(v => !v)}
              active={reordering}
            >
              {reordering ? 'Done' : 'Reorder'}
            </Button>
            <Button variant="secondary" icon={<Plus size={17} />} onClick={() => setAddingCategory(v => !v)}
              active={addingCategory}>
              Category
            </Button>
            <Button variant="primary" icon={<Plus size={17} />} onClick={() => setAddingItem(v => !v)}>
              Menu item
            </Button>
          </>
        }
      />

      <AnimatePresence initial={false}>
        {addingCategory && (
          <Collapse key="add-category">
            <Panel title="New category">
              <div className="flex items-end gap-[10px]">
                <TextInput
                  autoFocus
                  label="Name"
                  value={categoryName}
                  placeholder="Sides"
                  onChange={e => setCategoryName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') submitCategory(); }}
                />
                <Button variant="primary" onClick={submitCategory} disabled={!categoryName.trim()}>Add</Button>
                <Button variant="ghost" onClick={() => { setAddingCategory(false); setCategoryName(''); }}>Cancel</Button>
              </div>
            </Panel>
          </Collapse>
        )}

        {addingItem && (
          <Collapse key="add-item">
            <Panel title="New menu item">
              <div className="flex items-end gap-[10px] flex-wrap">
                <div className="flex-1 min-w-[180px]">
                  <TextInput autoFocus label="Name" value={itemName} placeholder="Cheeseburger"
                    onChange={e => setItemName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') submitItem(); }} />
                </div>
                <div className="w-[150px]">
                  <TextInput label="Price" inputMode="numeric" capitalize={false} value={itemPrice} placeholder="500"
                    onChange={e => setItemPrice(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') submitItem(); }} />
                </div>
                <div className="w-[190px]">
                  <Select label="Category" value={itemCategory} onChange={value => setItemCategory(value)}
                    options={categories.map(c => ({ value: c.name, label: c.name }))} />
                </div>
                <Button variant="primary" onClick={submitItem}
                  disabled={!itemName.trim() || !(parseFloat(itemPrice) > 0)}>Add item</Button>
                <Button variant="ghost" onClick={() => setAddingItem(false)}>Cancel</Button>
              </div>
            </Panel>
          </Collapse>
        )}

        {reordering && (
          <Collapse key="reorder">
            <Panel title="Category order" subtitle="Drag a category to move it. The others step aside as it passes.">
              <CategoryReorderList categories={sorted} onReorder={onReorderCategories} />
            </Panel>
          </Collapse>
        )}
      </AnimatePresence>

      {/*
        Two columns of categories, each a panel of its own.

        The constraint worth holding onto is that the rows stay big: this is
        edited on the same touchscreen the orders are taken on, and a dense
        table would be the wrong trade. Two columns buy back the width the old
        single 900px column was wasting on a wide screen without shrinking
        anything, and the layout collapses to one column when there is not room.
      */}
      <div className="grid gap-[16px] items-start" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(430px, 1fr))' }}>
        {grouped.map(({ category, items }) => (
          <CategoryPanel
            key={category.id}
            category={category}
            items={items}
            categories={categories}
            menuItems={menuItems}
            confirmDelete={confirmDelete}
            onConfirmDelete={setConfirmDelete}
            onUpdateCategory={onUpdateCategory}
            onDeleteCategory={onDeleteCategory}
            onUpdateMenuItem={onUpdateMenuItem}
            onDeleteMenuItem={onDeleteMenuItem}
            onAddItem={() => { setItemCategory(category.name); setAddingItem(true); }}
            canDeleteCategory={categories.length > 1 && !isSystemCategory(category)}
          />
        ))}

        {orphans.length > 0 && (
          <Panel title="Not in any category" subtitle="Their category was renamed or removed">
            <div className="flex flex-col gap-[10px]">
              {orphans.map(item => (
                <MenuItemRow
                  key={item.id}
                  item={item}
                  categories={categories}
                  menuItems={menuItems}
                  confirming={confirmDelete === item.id}
                  onConfirmDelete={() => setConfirmDelete(item.id)}
                  onCancelDelete={() => setConfirmDelete(null)}
                  onUpdate={patch => onUpdateMenuItem(item.id, patch)}
                  onDelete={() => { onDeleteMenuItem(item.id); setConfirmDelete(null); }}
                  showCategory
                />
              ))}
            </div>
          </Panel>
        )}
      </div>
    </div>
  );
}

/** A height animation used for every form that opens in place. */
function Collapse({ children }: { children: React.ReactNode }) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={reduced ? { duration: 0 } : { duration: DURATION.base, ease: EASE }}
      style={{ overflow: 'hidden' }}
    >
      <div className="pb-[2px]">{children}</div>
    </motion.div>
  );
}

/** One category and everything in it. */
function CategoryPanel({
  category, items, categories, menuItems, confirmDelete, onConfirmDelete,
  onUpdateCategory, onDeleteCategory, onUpdateMenuItem, onDeleteMenuItem, onAddItem,
  canDeleteCategory,
}: {
  category: Category;
  items: MenuItem[];
  categories: Category[];
  menuItems: MenuItem[];
  confirmDelete: string | null;
  onConfirmDelete: (id: string | null) => void;
  onUpdateCategory: (id: string, patch: Partial<Category>) => void;
  onDeleteCategory: (id: string) => void;
  onUpdateMenuItem: (id: string, patch: Partial<MenuItem>) => void;
  onDeleteMenuItem: (id: string) => void;
  onAddItem: () => void;
  canDeleteCategory: boolean;
}) {
  const theme = useSection();
  const system = isSystemCategory(category);

  return (
    <Panel padded={false} className="p-[16px]">
      <div className="flex items-center gap-[8px] pb-[11px] mb-[12px] border-b" style={{ borderColor: theme.line }}>
        <input
          value={category.name}
          onChange={e => onUpdateCategory(category.id, { name: capitalizeFirst(e.target.value) })}
          className="min-w-0 flex-1 bg-transparent text-[var(--app-text)] text-[17px] font-bold px-[6px] py-[5px] rounded-[8px] focus:outline-none focus:bg-[var(--app-bg-darker)]"
          aria-label={`Rename ${category.name}`}
        />
        <span className="text-[var(--app-text-muted)] text-[12px] tabular-nums shrink-0">
          {items.length} item{items.length === 1 ? '' : 's'}
        </span>
        {system && (
          <Tooltip label="Deals are built from this category, so it cannot be removed. Rename it to whatever you call them.">
            <span
              className="flex items-center gap-[5px] px-[8px] h-[24px] rounded-full text-[11px] font-bold shrink-0"
              style={{ background: theme.soft, color: theme.color }}
            >
              <Lock size={11} /> Built in
            </span>
          </Tooltip>
        )}
        <IconButton
          variant="quiet" size="sm" onClick={onAddItem}
          aria-label={`Add an item to ${category.name}`} icon={<Plus size={18} />}
        />
        {!system && (
          <IconButton
            variant="quiet" size="sm" tone={DANGER}
            disabled={!canDeleteCategory}
            onClick={() => onDeleteCategory(category.id)}
            aria-label={`Delete ${category.name}`}
            icon={<Trash2 size={17} />}
          />
        )}
      </div>

      {items.length === 0 ? (
        <p className="text-[var(--app-text-muted)] text-[13px] py-[10px]">
          Nothing in here yet.
        </p>
      ) : (
        <div className="flex flex-col gap-[10px]">
          {items.map(item => (
            <MenuItemRow
              key={item.id}
              item={item}
              categories={categories}
              menuItems={menuItems}
              confirming={confirmDelete === item.id}
              onConfirmDelete={() => onConfirmDelete(item.id)}
              onCancelDelete={() => onConfirmDelete(null)}
              onUpdate={patch => onUpdateMenuItem(item.id, patch)}
              onDelete={() => { onDeleteMenuItem(item.id); onConfirmDelete(null); }}
            />
          ))}
        </div>
      )}
    </Panel>
  );
}

/**
 * Dragging a category to a new position.
 *
 * The old version tracked the pointer with `elementFromPoint` and only committed
 * on release, so nothing moved until you let go and there was no way to see
 * where the thing would land. Here the list reorders live as the dragged row
 * passes each neighbour, and every other row animates into its new place — so
 * the destination is not something to be indicated, it is simply where the row
 * already is.
 */
function CategoryReorderList({
  categories, onReorder,
}: {
  categories: Category[];
  onReorder: (draggedId: string, targetId: string) => void;
}) {
  const theme = useSection();
  const [dragging, setDragging] = useState<string | null>(null);
  const rowsRef = useRef<Map<string, HTMLElement>>(new Map());

  /** Which row the pointer is currently over, by its live on-screen position. */
  const rowAt = (clientY: number): string | null => {
    for (const [id, el] of rowsRef.current) {
      const rect = el.getBoundingClientRect();
      if (clientY >= rect.top && clientY <= rect.bottom) return id;
    }
    return null;
  };

  const startDrag = (e: React.PointerEvent, id: string) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    setDragging(id);

    const onMove = (me: PointerEvent) => {
      const over = rowAt(me.clientY);
      // Reordering as it passes is what makes the destination visible. The
      // list is the preview.
      if (over && over !== id) onReorder(id, over);
    };
    const stop = () => {
      setDragging(null);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
  };

  return (
    <div className="flex flex-col gap-[6px]">
      {categories.map(category => {
        const isDragging = dragging === category.id;
        return (
          <motion.div
            key={category.id}
            layout
            layoutId={`cat-${category.id}`}
            transition={GLIDE}
            ref={el => {
              if (el) rowsRef.current.set(category.id, el);
              else rowsRef.current.delete(category.id);
            }}
            data-cat-id={category.id}
            className="flex items-center gap-[10px] rounded-[11px] px-[10px] h-[52px] select-none"
            animate={{
              scale: isDragging ? 1.02 : 1,
              zIndex: isDragging ? 2 : 1,
            }}
            style={{
              background: isDragging ? theme.soft : 'var(--app-surface)',
              border: `1px solid ${isDragging ? theme.color : 'transparent'}`,
              boxShadow: isDragging ? ELEVATION.mid : 'none',
              position: 'relative',
              touchAction: 'none',
            }}
            onPointerDown={e => startDrag(e, category.id)}
          >
            <GripVertical size={20} className="text-[var(--app-text-muted)] shrink-0 cursor-grab active:cursor-grabbing" />
            <span className="text-[var(--app-text)] text-[16px] font-semibold truncate">{category.name}</span>
            {isSystemCategory(category) && (
              <Lock size={13} className="text-[var(--app-text-muted)] shrink-0" />
            )}
          </motion.div>
        );
      })}
    </div>
  );
}

function MenuItemRow({
  item, categories, menuItems, confirming, onConfirmDelete, onCancelDelete, onUpdate, onDelete,
  showCategory = false,
}: {
  item: MenuItem;
  categories: Category[];
  menuItems: MenuItem[];
  confirming: boolean;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
  onUpdate: (patch: Partial<MenuItem>) => void;
  onDelete: () => void;
  showCategory?: boolean;
}) {
  const theme = useSection();
  const [openDeal, setOpenDeal] = useState(false);
  const isDeal = isDealItem(item, categories);
  const components = menuItems.filter(mi => mi.id !== item.id && !mi.dealItems?.length);
  const suggested = componentsTotal(item, menuItems);

  return (
    <motion.div
      layout
      transition={GLIDE}
      className="rounded-[13px] p-[13px] flex flex-col gap-[11px]"
      style={{
        background: 'var(--app-surface)',
        border: `1px solid ${item.showInOrderMode ? 'var(--app-border)' : alpha(DANGER, 0.22)}`,
      }}
    >
      <div className="flex items-center gap-[10px]">
        <input
          value={item.name}
          onChange={e => onUpdate({ name: capitalizeFirst(e.target.value) })}
          className="flex-1 min-w-0 bg-transparent text-[var(--app-text)] text-[17px] font-bold px-[7px] py-[6px] rounded-[8px] focus:outline-none focus:bg-[var(--app-bg-darker)]"
          aria-label={`Rename ${item.name}`}
        />

        <span className="flex items-center gap-[5px] shrink-0">
          <span className="text-[var(--app-text-muted)] text-[13px] font-semibold">Rs</span>
          <input
            inputMode="decimal"
            value={item.price}
            onChange={e => onUpdate({ price: parseFloat(e.target.value) || 0 })}
            className="w-[86px] bg-[var(--app-bg-darker)] text-[var(--app-text)] text-[15px] font-bold text-right px-[10px] h-[38px] rounded-[9px] border border-[var(--app-border)] focus:outline-none focus:border-[color:var(--sec)]"
            aria-label={`Price of ${item.name}`}
          />
        </span>

        <Tooltip label={HINT.showInOrderMode}>
          <Toggle
            size="sm"
            checked={item.showInOrderMode}
            onChange={v => onUpdate({ showInOrderMode: v })}
            label={`Show ${item.name} on the till`}
          />
        </Tooltip>

        {confirming ? (
          <span className="flex items-center gap-[6px] shrink-0">
            <Button variant="danger" size="sm" onClick={onDelete}>Delete</Button>
            <Button variant="ghost" size="sm" onClick={onCancelDelete}>Keep</Button>
          </span>
        ) : (
          <IconButton
            variant="quiet" size="sm" tone={DANGER}
            onClick={onConfirmDelete}
            aria-label={`Delete ${item.name}`}
            icon={<Trash2 size={17} />}
          />
        )}
      </div>

      <div className="flex items-center gap-[8px] flex-wrap">
        {showCategory && (
          <div className="w-[170px]">
            <Select
              value={item.category}
              onChange={value => onUpdate({ category: value })}
              options={categories.map(c => ({ value: c.name, label: c.name }))}
            />
          </div>
        )}

        <CostField item={item} onUpdate={onUpdate} />

        {isDeal && (
          <Button
            variant="quiet"
            size="sm"
            active={openDeal}
            icon={<Layers size={15} />}
            onClick={() => setOpenDeal(v => !v)}
            data-deal-toggle={item.id}
          >
            {item.dealItems?.length
              ? `${item.dealItems.length} item${item.dealItems.length === 1 ? '' : 's'} inside`
              : 'Set what is inside'}
          </Button>
        )}
      </div>

      <AnimatePresence initial={false}>
        {isDeal && openDeal && (
          <Collapse key="deal">
            <div className="pt-[11px] border-t" style={{ borderColor: theme.line }}>
              <div className="flex items-center justify-between mb-[10px] gap-[8px] flex-wrap">
                <span className="text-[var(--app-text-muted)] text-[11px] font-bold uppercase tracking-[0.7px]">
                  What is in this deal
                </span>
                <span className="flex items-center gap-[6px]">
                  {suggested > 0 && (
                    <Button
                      variant="quiet"
                      size="sm"
                      onClick={() => onUpdate({ price: suggested })}
                      data-use-components-total
                    >
                      Components total Rs {suggested.toFixed(0)} — use it
                    </Button>
                  )}
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={<Plus size={15} />}
                    onClick={() => onUpdate({ dealItems: [...(item.dealItems ?? []), { name: '', quantity: 1 }] })}
                  >
                    Add
                  </Button>
                </span>
              </div>

              {!item.dealItems || item.dealItems.length === 0 ? (
                <p className="text-[var(--app-text-muted)] text-[13px]">
                  Nothing in it yet. Add what the customer gets, then set the price you sell it at.
                </p>
              ) : (
                <div className="flex flex-col gap-[8px]">
                  {item.dealItems.map((line, index) => (
                    <div key={index} className="flex items-center gap-[9px]">
                      <NumberStepper
                        value={line.quantity}
                        min={1}
                        width={52}
                        onChange={quantity => onUpdate({
                          dealItems: item.dealItems!.map((d, i) => (i === index ? { ...d, quantity } : d)),
                        })}
                      />
                      <span className="text-[var(--app-text-muted)] text-[14px]">×</span>
                      <div className="flex-1 min-w-0">
                        <Select
                          value={line.name}
                          placeholder="Choose an item…"
                          onChange={value => {
                            const picked = components.find(c => c.name === value);
                            onUpdate({
                              dealItems: item.dealItems!.map((d, i) => (
                                i === index ? { ...d, name: value, menuItemId: picked?.id } : d
                              )),
                            });
                          }}
                          options={components.map(mi => ({ value: mi.name, label: mi.name }))}
                        />
                      </div>
                      <IconButton
                        variant="quiet" size="sm" tone={DANGER}
                        aria-label="Remove from deal"
                        onClick={() => onUpdate({ dealItems: item.dealItems!.filter((_, i) => i !== index) })}
                        icon={<X size={17} />}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Collapse>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/**
 * The ingredient cost, worked out or typed in.
 *
 * Left alone it says "from the recipe", which is the honest default and what
 * keeps margins truthful without anyone maintaining them. Typing a figure here
 * overrides it — needed for anything the stock ledger cannot see all of, such
 * as a deal containing something bought in ready-made.
 */
function CostField({
  item, onUpdate,
}: { item: MenuItem; onUpdate: (patch: Partial<MenuItem>) => void }) {
  const overridden = item.unitCostOverride !== undefined;
  const [draft, setDraft] = useState(overridden ? String(item.unitCostOverride) : '');

  return (
    <span className="flex items-center gap-[6px] shrink-0">
      <span className="text-[var(--app-text-muted)] text-[12px] font-semibold whitespace-nowrap">
        Costs me
      </span>
      <input
        inputMode="decimal"
        value={draft}
        placeholder="auto"
        onChange={e => {
          const next = e.target.value.replace(/[^\d.]/g, '');
          setDraft(next);
          const parsed = parseFloat(next);
          onUpdate({ unitCostOverride: Number.isFinite(parsed) ? parsed : undefined });
        }}
        className="w-[78px] bg-[var(--app-bg-darker)] text-[var(--app-text)] text-[14px] font-semibold text-right px-[9px] h-[34px] rounded-[8px] border border-[var(--app-border)] focus:outline-none focus:border-[color:var(--sec)] placeholder:text-[var(--app-text-muted)] placeholder:font-normal"
        aria-label={`Ingredient cost of one ${item.name}`}
      />
      {overridden && (
        <IconButton
          variant="quiet" size="sm"
          aria-label="Go back to working the cost out from the recipe"
          onClick={() => { setDraft(''); onUpdate({ unitCostOverride: undefined }); }}
          icon={<RotateCcw size={15} />}
        />
      )}
    </span>
  );
}
/* ------------------------------------------------------------------ orders */

function OrderSettings({
  grillCapacity, onGrillCapacity, grillOnBoard, tapToExpandParked, onTapToExpandParked,
  taxEnabled, onTaxEnabled, taxRate, onTaxRate, discountRequiresPin, onDiscountRequiresPin,
}: SettingsViewProps) {
  const capacity = Math.max(1, parseInt(grillCapacity) || 8);
  const rate = Math.max(0, parseFloat(taxRate) || 0);

  return (
    <div className="max-w-[860px] mx-auto flex flex-col gap-[14px]">
      <ScreenHeading
        title="Orders"
        subtitle="How orders are priced, and how they move through the kitchen."
        icon={<SlidersHorizontal size={22} />}
      />

      <SettingRow
        title="Grill capacity"
        description={HINT.grillCapacity}
        control={<NumberStepper value={capacity} min={1} max={99} onChange={v => onGrillCapacity(String(v))} />}
        footer={grillOnBoard > capacity ? (
          <p className="text-[13px] mt-[14px] pt-[14px] border-t border-[var(--app-border)]" style={{ color: '#F79634' }}>
            There are {grillOnBoard} tickets on the grill right now, which is over this limit. Nothing has
            been moved — the Grill action simply stays unavailable until it drops back.
          </p>
        ) : undefined}
      />

      <SettingRow
        title="Tap to open a parked order"
        description={HINT.tapToExpandParked}
        control={<Toggle checked={tapToExpandParked} onChange={onTapToExpandParked} label="Tap to open a parked order" />}
      />

      <SettingRow
        title="Sales tax"
        description={HINT.salesTax}
        control={<Toggle checked={taxEnabled} onChange={onTaxEnabled} label="Sales tax" />}
      >
        {taxEnabled && (
          <div className="flex items-center gap-[12px] flex-wrap">
            <div className="w-[130px]">
              <TextInput
                inputMode="decimal"
                value={taxRate}
                onChange={e => onTaxRate(e.target.value)}
                icon={<Percent size={15} />}
              />
            </div>
            <span className="text-[var(--app-text-muted)] text-[13px]">
              An order coming to Rs 1,000 after any discount would collect Rs {(1000 * rate / 100).toFixed(0)} in tax.
            </span>
          </div>
        )}
      </SettingRow>

      <SettingRow
        title="Ask for a PIN before discounts"
        description={HINT.discountPin}
        control={<Toggle checked={discountRequiresPin} onChange={onDiscountRequiresPin} label="Ask for a PIN before discounts" />}
      />
    </div>
  );
}

/* ----------------------------------------------------------------- program */

const SCALE_OPTIONS = [
  { value: 1, label: 'Compact' },
  { value: 1.12, label: 'Default' },
  { value: 1.25, label: 'Large' },
  { value: 1.4, label: 'Largest' },
];

function ProgramSettings({
  lightMode, onLightMode, uiScale, onUiScale, fullscreen, onFullscreen,
  autoPrint, onAutoPrint, printerName, onPrinterName, onTestPrint, onWipe, onRevenuePinChanged,
}: SettingsViewProps) {
  const toast = useToast();
  const [printing, setPrinting] = useState<'idle' | 'busy' | 'done' | 'failed'>('idle');

  return (
    <div className="max-w-[860px] mx-auto flex flex-col gap-[14px]">
      <ScreenHeading
        title="Program"
        subtitle="How the app looks and behaves on this machine."
        icon={<Monitor size={22} />}
      />

      <SettingRow
        title="Light mode"
        description={HINT.lightMode}
        control={<Toggle checked={lightMode} onChange={onLightMode} label="Light mode" />}
      />

      <SettingRow
        title="Display scale"
        description={HINT.displayScale}
        control={
          <SegmentedControl
            value={SCALE_OPTIONS.find(o => Math.abs(o.value - uiScale) < 0.001)?.value ?? 1.12}
            options={SCALE_OPTIONS.map(o => ({ value: o.value, label: o.label }))}
            onChange={onUiScale}
          />
        }
      />

      <SettingRow
        title="Fullscreen"
        description={HINT.fullscreen}
        control={<Toggle checked={fullscreen} onChange={onFullscreen} label="Fullscreen" />}
      />

      <SettingRow
        title="Receipt printer"
        description={HINT.printer}
        control={<Toggle checked={autoPrint} onChange={onAutoPrint} label="Print automatically" />}
      >
        {autoPrint && (
          <div className="flex items-end gap-[12px] flex-wrap">
            <div className="flex-1 min-w-[240px]">
              <TextInput
                label="Printer name"
                hint={HINT.printerName}
                value={printerName}
                placeholder="EPSON TM-T82"
                icon={<Printer size={15} />}
                onChange={e => onPrinterName(e.target.value)}
              />
            </div>
            <Button
              variant={printing === 'failed' ? 'danger' : 'secondary'}
              disabled={printing === 'busy'}
              hint={HINT.testPrint}
              icon={printing === 'done' ? <Check size={16} /> : <Printer size={16} />}
              onClick={async () => {
                setPrinting('busy');
                try {
                  await onTestPrint();
                  setPrinting('done');
                  toast.show('Test ticket sent', { kind: 'success' });
                } catch {
                  setPrinting('failed');
                  toast.show('Could not reach the printer', {
                    kind: 'danger',
                    detail: 'Check it is switched on, and that the name above matches exactly.',
                  });
                }
                window.setTimeout(() => setPrinting('idle'), 2600);
              }}
            >
              {printing === 'busy' ? 'Printing…' : printing === 'done' ? 'Printed' : printing === 'failed' ? 'Failed' : 'Test print'}
            </Button>
          </div>
        )}
      </SettingRow>

      <CredentialsPanel />
      <RevenuePinPanel onChanged={onRevenuePinChanged} />

      <WipeDataPanel onWipe={onWipe} />

      <SyncSettings />
    </div>
  );
}

/** Both credential forms share a shape, so they share a component. */
function SecretForm({
  title, description, icon, fields, onSubmit, submitLabel,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  fields: { key: string; label: string; type?: string; maxLength?: number }[];
  onSubmit: (values: Record<string, string>) => Promise<string | null>;
  submitLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useBackHandler(open, `the ${title.toLowerCase()} form`, () => setOpen(false));

  const reset = () => { setValues({}); setError(null); setDone(false); };

  return (
    <SettingRow
      title={title}
      description={description}
      control={
        <Button variant={open ? 'ghost' : 'secondary'} icon={icon} onClick={() => { setOpen(v => !v); reset(); }}>
          {open ? 'Cancel' : 'Change'}
        </Button>
      }
    >
      {open && (
        <div className="flex flex-col gap-[12px] max-w-[420px]">
          {fields.map(field => (
            <TextInput
              key={field.key}
              label={field.label}
              type={field.type ?? 'password'}
              maxLength={field.maxLength}
              value={values[field.key] ?? ''}
              onChange={e => { setValues(v => ({ ...v, [field.key]: e.target.value })); setError(null); }}
            />
          ))}
          {error && <p className="text-[13px]" style={{ color: DANGER }}>{error}</p>}
          {done && (
            <p className="text-[13px] flex items-center gap-[6px]" style={{ color: SUCCESS }}>
              <Check size={15} /> Saved.
            </p>
          )}
          <Button
            variant="primary"
            onClick={async () => {
              const message = await onSubmit(values);
              if (message) { setError(message); setDone(false); return; }
              setError(null);
              setDone(true);
              setValues({});
            }}
          >
            {submitLabel}
          </Button>
        </div>
      )}
    </SettingRow>
  );
}

function CredentialsPanel() {
  return (
    <SecretForm
      title="Sign-in details"
      description={HINT.changeCredentials}
      icon={<ShieldCheck size={17} />}
      submitLabel="Save sign-in details"
      fields={[
        { key: 'oldUser', label: 'Current username', type: 'text' },
        { key: 'oldPass', label: 'Current password' },
        { key: 'newUser', label: 'New username', type: 'text' },
        { key: 'newPass', label: 'New password' },
        { key: 'confirm', label: 'Repeat the new password' },
      ]}
      onSubmit={async values => {
        try {
          const currentUser = await getAppSetting('login_username');
          const currentPass = await getAppSetting('login_password');
          if (values.oldUser !== currentUser || values.oldPass !== currentPass) {
            return 'That username and password do not match the ones in use.';
          }
          if (!values.newUser?.trim() || !values.newPass?.trim()) {
            return 'Both a new username and a new password are needed.';
          }
          if (values.newPass !== values.confirm) return 'The two new passwords are not the same.';
          await setAppSetting('login_username', values.newUser.trim());
          await setAppSetting('login_password', values.newPass);
          return null;
        } catch {
          return 'Could not save. The program cannot reach its database right now.';
        }
      }}
    />
  );
}

function RevenuePinPanel({ onChanged }: { onChanged: (pin: string) => void }) {
  return (
    <SecretForm
      title="Money PIN"
      description={HINT.changePin}
      icon={<ShieldCheck size={17} />}
      submitLabel="Save PIN"
      fields={[
        { key: 'old', label: 'Current PIN', maxLength: 6 },
        { key: 'next', label: 'New PIN', maxLength: 6 },
        { key: 'confirm', label: 'Repeat the new PIN', maxLength: 6 },
      ]}
      onSubmit={async values => {
        try {
          const current = await getAppSetting('revenue_pin');
          if (values.old !== current) return 'That is not the PIN currently in use.';
          if (!values.next?.trim() || values.next.length < 4) return 'A PIN needs to be at least four characters.';
          if (values.next !== values.confirm) return 'The two new PINs are not the same.';
          await setAppSetting('revenue_pin', values.next);
          onChanged(values.next);
          return null;
        } catch {
          return 'Could not save. The program cannot reach its database right now.';
        }
      }}
    />
  );
}
