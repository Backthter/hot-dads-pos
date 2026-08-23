import React, { useCallback, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Banknote, Pencil, Plus, ShoppingBag, Smartphone, Trash2 } from 'lucide-react';
import { Navigation, NavSlotHost } from '../components/Navigation';
import { Section } from '../components/Section';
import { ParkedSidebar } from '../components/ParkedSidebar';
import { DiscountField } from '../components/DiscountField';
import { LowStockNotice, SoldOutPrompt } from '../components/StockNotices';
import {
  Button, DANGER, DURATION, EASE, GLIDE, HINT, SECTION_COLOR, SNAP, STATUS_COLOR,
  SectionTheme, Tooltip, alpha, capitalizeFirst, useReducedMotion,
} from '../ui';
import { withDisplayNumbers } from '../lib/sessions';
import type { MenuHandle, OrdersHandle } from '../state';
import type { MenuItem, Order, StockItem } from '../types';

/**
 * Order Mode: the board on the left, the parked orders beside it, the menu and
 * the cart on the right.
 *
 * This is the screen the shop spends its day in, so everything here is sized
 * and spaced for a finger on a counter-top screen rather than for a mouse.
 */

export interface OrderModeScreenProps {
  orders: OrdersHandle;
  menu: MenuHandle;
  /** The whole shelf, filtered to what is running low, for the notice. */
  lowStockItems: StockItem[];
  /** The session taking orders, for ticket numbering. */
  liveSessionId: string | null;
  grillCapacity: number;
  activeTaxRate: number;
  tapToExpandParked: boolean;
  discountRequiresPin: boolean;
  onLogOversell: (menuItem: MenuItem, bottleneckStockItemId: string | undefined) => void;
  onOtherBoard: () => void;
  onOpenInventory: () => void;
}

export function OrderModeScreen({
  orders, menu, lowStockItems, liveSessionId, grillCapacity, activeTaxRate,
  tapToExpandParked, discountRequiresPin, onLogOversell, onOtherBoard, onOpenInventory,
}: OrderModeScreenProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [grillMinimized, setGrillMinimized] = useState(false);
  const boardScrollRef = useRef<HTMLDivElement | null>(null);
  const grillSectionRef = useRef<HTMLDivElement | null>(null);
  const grillExpandedHeightRef = useRef(0);

  /**
   * Collapsing the grill removes its own height from the scrollable area, which
   * can drop the container back to scrollTop 0 and expand it again — a loop that
   * feels like the board is fighting you. So it only collapses when there will
   * still be room to stay scrolled past the threshold afterwards, and only
   * expands again near the very top.
   */
  const handleBoardScroll = useCallback((el: HTMLDivElement) => {
    const COLLAPSE_AT = 48;
    const EXPAND_AT = 10;
    const COLLAPSED_HEIGHT = 84;

    setGrillMinimized(prev => {
      const section = grillSectionRef.current;
      if (!prev && section) grillExpandedHeightRef.current = section.offsetHeight;

      if (prev) return el.scrollTop > EXPAND_AT;

      const savings = Math.max(0, grillExpandedHeightRef.current - COLLAPSED_HEIGHT);
      const maxScrollAfter = el.scrollHeight - el.clientHeight - savings;
      return el.scrollTop > COLLAPSE_AT && maxScrollAfter > COLLAPSE_AT;
    });
  }, []);

  const numbered = useCallback(
    (list: Order[]) => withDisplayNumbers(list, liveSessionId),
    [liveSessionId],
  );

  const grillIsFull = orders.state.grill.length >= grillCapacity;
  const sortedCategories = [...menu.state.categories].sort((a, b) => a.order - b.order);
  const visibleMenuItems = menu.state.menuItems.filter(
    item => item.showInOrderMode && item.category === menu.state.selectedCategory);

  const { subtotal, discountAmount, taxAmount, total } = orders.state.cartTotals;
  const change = orders.state.change;

  return (
    <SectionTheme section="order" className="screen-h screen-w bg-[var(--app-bg)] flex overflow-hidden">
      {/* Left + Sidebar wrapper — flex:1 so it absorbs all space the right panel doesn't take.
          The right panel is a stable flex item at fixed width; this wrapper never changes its
          outer size from the right panel's perspective, so the right panel never shifts. */}
      <div className="flex flex-1 h-full overflow-hidden relative">
        {/* Left Panel - Tickets */}
        <div className="bg-[var(--app-bg)] flex flex-col h-full pr-px border-r border-[var(--app-border)]" style={{ flex: 1, minWidth: 0 }}>
          <NavSlotHost>
            <Navigation section="order" onOtherBoard={onOtherBoard} isOrderMode />
          </NavSlotHost>

          <div
            className="flex-1 overflow-auto"
            ref={boardScrollRef}
            onScroll={e => handleBoardScroll(e.currentTarget)}
          >
            <div className="p-[20px] flex flex-col gap-[12px]">
              <Section title="ON THE GRILL" status="grill" orders={numbered(orders.state.grill)} capacity={grillCapacity} editingOrderIds={orders.state.editingOrderIds} grillIsFull={grillIsFull} onEditOrder={orders.actions.startEditingOrder} showDelete={false}
                sticky minimized={grillMinimized} sectionRef={grillSectionRef}
                onExpand={() => boardScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })} />
              <Section title="PREPARING" status="preparing" orders={numbered(orders.state.preparing)} editingOrderIds={orders.state.editingOrderIds} grillIsFull={grillIsFull} onEditOrder={orders.actions.startEditingOrder} showDelete={false} />
              <Section title="READY" status="ready" orders={numbered(orders.state.ready)} editingOrderIds={orders.state.editingOrderIds} grillIsFull={grillIsFull} onEditOrder={orders.actions.startEditingOrder} showDelete={false} />
            </div>
          </div>
        </div>

        {/* Parked Sidebar */}
        <ParkedSidebar
          open={sidebarOpen}
          setOpen={setSidebarOpen}
          sessions={orders.state.parkedSessions}
          activeSessionId={orders.state.activeSessionId}
          onSwitchSession={orders.actions.switchToSession}
          onNewSession={orders.actions.createNewSession}
          onDeleteSession={orders.actions.deleteSession}
          onMove={orders.actions.moveOrder}
          onCheckoutParked={orders.actions.checkoutParkedSession}
          tapToExpandParked={tapToExpandParked}
          taxRate={activeTaxRate}
        />
      </div>

      {/*
        Right Panel — Menu & Cart.

        This panel is a light surface inside an otherwise dark app, which the
        shared controls know nothing about: a `secondary` button reads
        `--app-surface` and would come out charcoal on white. Rather than give
        every control in here a special case, the panel restates those variables
        for its own subtree, so a shared button dropped in here is simply right.
      */}
      <div
        className="w-[496px] bg-[var(--app-order-bg)] flex flex-col h-full shrink-0 border-l border-[var(--app-order-border)]"
        style={{
          '--app-surface': 'var(--app-order-card)',
          '--app-bg-darker': 'var(--app-order-card)',
          '--app-border': 'var(--app-order-border)',
          '--app-text': 'var(--app-order-text)',
        } as React.CSSProperties}
      >
        <div className="flex-1 flex flex-col gap-[10px] p-[16px] overflow-hidden min-h-0">
            <LowStockNotice
              items={lowStockItems}
              dismissedKey={orders.state.dismissedLowStock}
              onDismiss={orders.actions.setDismissedLowStock}
              onOpenInventory={onOpenInventory}
            />

            {/* Category tabs */}
            <div className="flex gap-[6px] h-[36px] shrink-0">
              {sortedCategories.map(category => {
                const active = menu.state.selectedCategory === category.name;
                return (
                  <motion.button
                    key={category.id}
                    onClick={() => menu.actions.setSelectedCategory(category.name)}
                    whileTap={{ scale: 0.97 }}
                    transition={SNAP}
                    data-category-tab={category.name}
                    className="relative rounded-[9px] px-[15px] flex items-center justify-center overflow-hidden"
                    style={{
                      background: active ? ORDER_ACCENT : 'var(--app-order-card)',
                      border: `1px solid ${active ? ORDER_ACCENT : 'var(--app-order-border)'}`,
                      color: active ? '#FFFFFF' : 'var(--app-text-secondary)',
                      boxShadow: active ? `0 2px 10px -3px ${alpha(ORDER_ACCENT, 0.7)}` : 'none',
                      transition: `background ${DURATION.fast}s, border-color ${DURATION.fast}s, color ${DURATION.fast}s, box-shadow ${DURATION.fast}s`,
                    }}
                  >
                    <span className="font-['Segoe_UI',sans-serif] text-[13px] font-bold leading-[18px] whitespace-nowrap">
                      {category.name}
                    </span>
                  </motion.button>
                );
              })}
            </div>

            {/* Menu items grid */}
            <div className="grid grid-cols-4 gap-[8px] auto-rows-[100px] shrink-0">
              {visibleMenuItems.map(item => {
                const soldOut = Boolean(orders.actions.soldOutEstimate(item));
                return (
                  <MenuTile
                    key={item.id}
                    name={item.name}
                    soldOut={soldOut}
                    onPress={() => orders.actions.addToCart(item)}
                  />
                );
              })}
            </div>

            {/* Cart area */}
            <div
              className="bg-[var(--app-order-card)] rounded-[12px] border flex flex-col shadow-sm min-h-0"
              style={{
                flex: 1,
                borderColor: orders.state.isEditingSession ? STATUS_COLOR.editing : 'var(--app-order-border)',
                transition: `border-color ${DURATION.base}s`,
              }}
            >
              <AnimatePresence initial={false}>
                {orders.state.isEditingSession && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: DURATION.fast, ease: EASE }}
                    className="overflow-hidden"
                  >
                    <div
                      className="flex items-center gap-[8px] px-[14px] py-[9px] rounded-t-[11px]"
                      style={{ background: alpha(STATUS_COLOR.editing, 0.14) }}
                    >
                      <Pencil size={14} style={{ color: STATUS_COLOR.editing }} />
                      <span className="font-['Segoe_UI',sans-serif] text-[12px] font-bold" style={{ color: STATUS_COLOR.editing }}>
                        Editing order #{orders.state.activeSession?.label} — it keeps its number
                      </span>
                      <span className="ml-auto">
                        <Button
                          variant="quiet"
                          size="sm"
                          tone={STATUS_COLOR.editing}
                          onClick={() => orders.actions.cancelEdit(orders.state.activeSessionId)}
                        >
                          Cancel edit
                        </Button>
                      </span>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="px-[12px] pt-[11px] pb-[10px] flex justify-between items-center gap-[8px] border-b border-[var(--app-order-border)]">
                {/*
                  No hover text on the ordering panel.
                  Every control here is labelled, pressed constantly, and
                  operated at speed — an explanation that appears each time the
                  pointer crosses a button is in the way rather than in aid.
                  Analytics keeps its hover text, because a figure genuinely
                  needs its basis explained; a button marked "Clear" does not.
                */}
                <Button
                  variant="danger"
                  size="sm"
                  icon={<Trash2 size={14} />}
                  onClick={orders.actions.clearCart}
                  disabled={orders.state.cart.length === 0}
                  data-clear-cart
                >
                  Clear
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  tone={ORDER_ACCENT}
                  icon={<Plus size={14} />}
                  onClick={orders.actions.createNewSession}
                  data-new-order
                >
                  New order
                </Button>
              </div>

              <div className="flex-1 overflow-auto px-[14px] py-[10px] scrollbar-light">
                {orders.state.cart.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full gap-[8px] text-center px-[20px]">
                    <ShoppingBag size={26} className="text-[var(--app-text-muted)] opacity-60" />
                    <p className="font-['Segoe_UI',sans-serif] text-[var(--app-text-muted)] text-[14px]">
                      Nothing on this order yet
                    </p>
                    <p className="font-['Segoe_UI',sans-serif] text-[var(--app-text-muted)] text-[12px] opacity-75">
                      Tap an item above to add it.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-[8px]">
                    <AnimatePresence initial={false} mode="popLayout">
                      {orders.state.cart.map(item => (
                        <motion.div
                          key={item.menuItemId}
                          layout
                          initial={{ opacity: 0, x: 14 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: -14 }}
                          transition={GLIDE}
                          className="flex flex-col group"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-[var(--app-order-text)] text-[17px] font-medium">
                              {item.name} <span className="text-[var(--app-text-muted)]">×{item.quantity}</span>
                            </span>
                            <div className="flex items-center gap-[8px]">
                              <span className="text-[var(--app-text-secondary)] text-[17px] font-medium tabular-nums">
                                Rs {(item.price * item.quantity).toFixed(0)}
                              </span>
                              <button
                                onClick={() => orders.actions.removeFromCart(item.menuItemId)}
                                aria-label={`Remove ${item.name}`}
                                className="p-[5px] rounded-[7px] text-[var(--app-text-muted)] opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-[#fff1f0] hover:text-[#F9624E] transition-all"
                              >
                                <Trash2 size={16} />
                              </button>
                            </div>
                          </div>
                          {item.dealItems && item.dealItems.length > 0 && (
                            <div className="pl-3 mt-[2px] space-y-[1px]">
                              {item.dealItems.map((dealItem, idx) => (
                                <div key={idx} className="text-[var(--app-text-muted)] text-[14px]">
                                  · {dealItem.quantity * item.quantity}x {dealItem.name}
                                </div>
                              ))}
                            </div>
                          )}
                        </motion.div>
                      ))}
                    </AnimatePresence>
                  </div>
                )}
              </div>

              <div className="h-px bg-[var(--app-order-border)]" />

              <div className="px-[14px] py-[12px]">
                {/* Breakdown — only the lines that actually apply */}
                {(discountAmount > 0 || taxAmount > 0 || orders.state.pendingDiscountAmount > 0) && (
                  <div className="flex flex-col gap-[3px] mb-[9px] pb-[9px] border-b border-[var(--app-order-border)]">
                    <TotalsRow label="Subtotal" value={`Rs ${subtotal.toFixed(0)}`} />
                    {discountAmount > 0 ? (
                      <TotalsRow
                        label={`Discount${orders.state.activeSession?.discount?.kind === 'percent' ? ` ${orders.state.activeSession.discount.value}%` : ''}`}
                        value={`− Rs ${discountAmount.toFixed(0)}`}
                        tone="#0fa88a"
                      />
                    ) : orders.state.pendingDiscountAmount > 0 ? (
                      <TotalsRow
                        label="Discount — press ✓ to apply"
                        value={`− Rs ${orders.state.pendingDiscountAmount.toFixed(0)}`}
                        muted
                      />
                    ) : null}
                    {taxAmount > 0 && (
                      <TotalsRow label={`Tax ${activeTaxRate}%`} value={`+ Rs ${taxAmount.toFixed(0)}`} />
                    )}
                  </div>
                )}
                <div className="flex items-center justify-between gap-[10px]">
                  <div className="flex flex-col gap-[1px] min-w-0">
                    <p className="font-['Segoe_UI',sans-serif] text-[var(--app-text-muted)] text-[11px] uppercase tracking-[0.6px]">Total</p>
                    <p className="font-['Inter',sans-serif] font-bold text-[var(--app-order-text)] text-[32px] leading-[36px] tabular-nums">
                      Rs {total.toFixed(0)}
                    </p>
                  </div>
                  <div className="flex items-center gap-[6px] shrink-0">
                    <DiscountField
                      subtotal={subtotal}
                      discount={orders.state.activeSession?.discount}
                      discountAmount={discountAmount}
                      onApply={orders.actions.applyDiscount}
                      onClear={orders.actions.clearDiscount}
                      onPreviewChange={orders.actions.setPendingDiscountAmount}
                      requirePin={discountRequiresPin}
                      onRequestPin={orders.actions.requestDiscountPin}
                    />
                    <div className="flex items-center rounded-[9px] overflow-hidden border border-[var(--app-order-border)] bg-[var(--app-order-card)]">
                        <div className="flex flex-col items-center justify-center px-[12px] py-[8px] border-r border-[var(--app-order-border)]">
                          <p className="text-[var(--app-text-muted)] text-[8px] uppercase tracking-[0.5px] leading-[10px] mb-[3px]">Given</p>
                          <input
                            type="number"
                            value={orders.state.cashReceived}
                            onChange={(e) => orders.actions.setCashReceived(e.target.value)}
                            placeholder="0"
                            className="bg-transparent text-[var(--app-order-text)] text-[15px] font-semibold text-center w-[48px] focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                          />
                        </div>
                        <div className="flex flex-col items-center justify-center px-[12px] py-[8px]">
                          <p className="text-[var(--app-text-muted)] text-[8px] uppercase tracking-[0.5px] leading-[10px] mb-[3px]">Change</p>
                          <p className={`text-[15px] font-semibold text-center w-[48px] tabular-nums ${change > 0 ? 'text-[#0fa88a]' : 'text-[var(--app-text-muted)]'}`}>
                            {change > 0 ? change.toFixed(0) : '—'}
                          </p>
                        </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Notes */}
            <div className="bg-[var(--app-order-card)] border border-[var(--app-order-border)] rounded-[10px] h-[42px] relative shadow-sm shrink-0 focus-within:border-[color:var(--sec)]">
              <input
                type="text"
                value={orders.state.notes}
                onChange={(e) => orders.actions.updateNotes(capitalizeFirst(e.target.value))}
                placeholder="Notes for the kitchen"
                className="absolute inset-0 bg-transparent text-[var(--app-order-text)] placeholder:text-[var(--app-text-muted)] font-['Segoe_UI',sans-serif] text-[14px] px-[14px] py-[8px] focus:outline-none rounded-[10px]"
              />
            </div>

            {/* Payment buttons — an edit session writes back to its original order */}
            <div className="grid grid-cols-2 gap-[8px] shrink-0">
              <PayButton
                label={orders.state.isEditingSession ? 'Save · Cash' : 'Cash'}
                icon={<Banknote size={19} />}
                disabled={orders.state.cart.length === 0}
                onClick={() => orders.state.isEditingSession ? orders.actions.checkoutParkedSession(orders.state.activeSessionId, 'cash') : orders.actions.checkout('cash')}
              />
              <PayButton
                label={orders.state.isEditingSession ? 'Save · Transfer' : 'Transfer'}
                icon={<Smartphone size={19} />}
                disabled={orders.state.cart.length === 0}
                onClick={() => orders.state.isEditingSession ? orders.actions.checkoutParkedSession(orders.state.activeSessionId, 'transfer') : orders.actions.checkout('transfer')}
              />
            </div>
          </div>
        </div>

        <SoldOutPrompt
          prompt={orders.state.soldOutPrompt}
          onCancel={() => orders.actions.setSoldOutPrompt(null)}
          onConfirm={() => {
            const prompt = orders.state.soldOutPrompt;
            if (prompt) {
              onLogOversell(prompt.menuItem, prompt.estimate.bottleneck?.stockItem.id);
              orders.actions.addToCartUnchecked(prompt.menuItem);
            }
            orders.actions.setSoldOutPrompt(null);
          }}
        />
      </SectionTheme>  );
}

/** Order Mode's teal, named once so the right-hand panel and the bar agree. */
const ORDER_ACCENT = SECTION_COLOR.order;

/**
 * One item on the ordering grid.
 *
 * Pulled out of the render so it can hold its own hover state — the tiles are
 * the most-pressed control in the program and had no press feedback beyond a
 * border colour, which on a touchscreen means no feedback at all.
 */
const MenuTile = React.memo(function MenuTile({
  name, soldOut, onPress,
}: { name: string; soldOut: boolean; onPress: () => void }) {
  const [hover, setHover] = useState(false);
  const reduced = useReducedMotion();
  const accent = soldOut ? DANGER : ORDER_ACCENT;

  const tile = (
    <motion.button
      onClick={onPress}
      onHoverStart={() => setHover(true)}
      onHoverEnd={() => setHover(false)}
      whileTap={reduced ? undefined : { scale: 0.95 }}
      transition={reduced ? { duration: 0 } : SNAP}
      data-menu-tile={name}
      data-sold-out={soldOut ? 'true' : 'false'}
      className="relative rounded-[12px] flex items-center justify-center overflow-hidden shadow-sm"
      style={{
        background: hover
          ? `linear-gradient(135deg, ${alpha(accent, 0.16)} 0%, ${alpha(accent, 0.05)} 100%), var(--app-order-card)`
          : 'var(--app-order-card)',
        border: `1px solid ${soldOut ? DANGER : hover ? accent : 'var(--app-order-border)'}`,
        boxShadow: hover ? `0 4px 14px -6px ${alpha(accent, 0.8)}` : undefined,
        transition: `background ${DURATION.fast}s, border-color ${DURATION.fast}s, box-shadow ${DURATION.fast}s`,
      }}
    >
      <span
        className="font-['Segoe_UI',sans-serif] text-[15px] font-bold leading-[20px] px-[8px] text-center"
        style={{ color: soldOut ? DANGER : 'var(--app-order-text)' }}
      >
        {name}
      </span>
      {soldOut && (
        <span
          className="absolute bottom-[8px] text-[10px] font-bold uppercase tracking-[0.6px]"
          style={{ color: DANGER }}
        >
          Out of stock
        </span>
      )}
    </motion.button>
  );

  return soldOut ? <Tooltip label={HINT.soldOut}>{tile}</Tooltip> : tile;
});

/** The two buttons that take the money. Deliberately the largest on the panel. */
function PayButton({
  label, icon, disabled, onClick,
}: {
  label: string;
  icon: React.ReactNode;
  disabled: boolean;
  onClick: () => void;
}) {
  const [hover, setHover] = useState(false);
  const reduced = useReducedMotion();
  return (
      <motion.button
        onClick={onClick}
        disabled={disabled}
        onHoverStart={() => setHover(true)}
        onHoverEnd={() => setHover(false)}
        whileTap={disabled || reduced ? undefined : { scale: 0.98 }}
        transition={reduced ? { duration: 0 } : SNAP}
        data-pay={label}
        className="h-[64px] rounded-[11px] flex items-center justify-center gap-[10px] shadow-sm"
        style={{
          background: hover && !disabled
            ? 'linear-gradient(135deg, #FFB33D 0%, #FE9A00 60%, #E58A00 100%)'
            : 'var(--app-order-card)',
          border: `1px solid ${hover && !disabled ? '#FE9A00' : 'var(--app-order-border)'}`,
          color: hover && !disabled ? '#1B1206' : 'var(--app-text-muted)',
          opacity: disabled ? 0.3 : 1,
          cursor: disabled ? 'not-allowed' : 'pointer',
          boxShadow: hover && !disabled ? '0 6px 18px -8px rgba(254,154,0,0.9)' : undefined,
          transition: `background ${DURATION.fast}s, border-color ${DURATION.fast}s, color ${DURATION.fast}s, box-shadow ${DURATION.fast}s`,
        }}
      >
        {icon}
        <span className="font-['Segoe_UI',sans-serif] text-[16px] font-bold">{label}</span>
      </motion.button>
  );
}

/** One right-aligned line in the totals breakdown above the big total. */
function TotalsRow({
  label, value, tone, muted = false,
}: { label: string; value: string; tone?: string; muted?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-[10px]">
      <span
        className="font-['Segoe_UI',sans-serif] text-[11px] tracking-[0.3px]"
        style={{ color: tone ?? 'var(--app-text-muted)', opacity: muted ? 0.7 : 1 }}
      >
        {label}
      </span>
      <span
        className="font-['Segoe_UI',sans-serif] text-[12px] font-semibold tabular-nums"
        style={{ color: tone ?? 'var(--app-text-secondary)', opacity: muted ? 0.7 : 1 }}
      >
        {value}
      </span>
    </div>
  );
}
