import { useCallback, useMemo, useState, type MutableRefObject } from 'react';
import { restoreAction, useHistory } from '../lib/history';
import { displayNumber } from '../lib/sessions';
import { estimateProduct, unitCostFor, type ProductEstimate } from '../lib/inventory';
import {
  stockUsageForCart,
  computeTotals,
  formatOrderNumber,
  newOrderId,
  renumberOrders,
  liveOrderCount,
} from '../lib/orders';
import type { StateCore } from './core';
import type { StockChange } from './useStock';
import type { ExplainNotUndoable } from './useNotUndoable';
import type { View } from '../lib/navigation';
import type {
  BoardStatus, CartItem, Discount, MenuItem, MenuItemStockAssignment, Order, OrderStatus,
  ParkedSession, StockItem, TradingSession,
} from '../types';
import type { TicketAction } from '../components/TicketActionMenu';

/**
 * The till: what is in the cart, what has been rung up, and where each ticket
 * is on the board.
 *
 * This is where the invariants bite hardest. Costs are frozen at checkout and
 * never restated (invariant 3), session membership is stamped rather than
 * derived (invariant 4), cancelling voids rather than deletes (invariant 5),
 * and neither checkout nor an edit to a rung-up order goes on the undo stack at
 * all — both settle money, and the supported reversal is a different action
 * that keeps the record.
 */

export interface OrdersDeps {
  menuItems: MenuItem[];
  assignments: MenuItemStockAssignment[];
  stockItems: StockItem[];

  /** Stock. Every one of these appends to the ledger rather than editing it. */
  applyStockChanges: (changes: StockChange[]) => void;
  deductStockForCart: (cart: CartItem[], orderId: string, note?: string) => void;
  returnStockForCart: (cart: CartItem[], orderId: string, note?: string) => void;
  logOversell: (menuItem: MenuItem, bottleneckStockItemId: string | undefined) => void;
  claimPendingOversells: (orderId: string) => Map<string, number>;

  /** Sessions. The ref is read synchronously; see `claimTicket`. */
  claimTicket: () => Pick<Order, 'sessionId' | 'sessionTicket'>;
  sessionsRef: MutableRefObject<TradingSession[]>;

  /** Settings. */
  activeTaxRate: number;
  grillCapacityRef: MutableRefObject<number>;
  revenuePin: string;
  printOrderIfNeeded: (order: Order) => Promise<void>;
  printEditedOrder: (order: Order) => Promise<void>;

  explainNotUndoable: ExplainNotUndoable;

  /** Navigation, because opening an order for editing moves you to the till. */
  currentView: View;
  navigateTo: (view: View) => void;
}

/** How long the void button stays armed after the first press. */
const VOID_ARM_MS = 3000;

export function useOrders(core: StateCore, deps: OrdersDeps) {
  const { snapshot, saveImmediate } = core;
  const history = useHistory();
  const {
    menuItems, assignments, stockItems,
    applyStockChanges, deductStockForCart, returnStockForCart,
    logOversell, claimPendingOversells,
    claimTicket, sessionsRef,
    activeTaxRate, grillCapacityRef, revenuePin,
    printOrderIfNeeded, printEditedOrder,
    explainNotUndoable, currentView, navigateTo,
  } = deps;

  const [orders, setOrders] = useState<Order[]>([]);
  const [orderCounter, setOrderCounter] = useState(1);
  const [parkedSessions, setParkedSessions] = useState<ParkedSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>('');
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [cashReceived, setCashReceived] = useState('');

  /** Set while a sold-out item is waiting for "add anyway" or "cancel". */
  const [soldOutPrompt, setSoldOutPrompt] = useState<
    { menuItem: MenuItem; estimate: ProductEstimate } | null
  >(null);
  /** Low-stock names the user has already acknowledged in Order Mode. */
  const [dismissedLowStock, setDismissedLowStock] = useState<string>('');

  const [discountPinPrompt, setDiscountPinPrompt] = useState<{ onGranted: () => void } | null>(null);
  const [discountPinInput, setDiscountPinInput] = useState('');
  const [discountPinError, setDiscountPinError] = useState(false);
  /** Live, unconfirmed discount value — shown greyed in the totals breakdown. */
  const [pendingDiscountAmount, setPendingDiscountAmount] = useState(0);

  // Derived state from the active parked order.
  const activeSession = parkedSessions.find(s => s.id === activeSessionId) || null;
  const cart = activeSession?.cart ?? [];
  const notes = activeSession?.notes ?? '';

  /* ------------------------------------------------------------- estimates */

  /**
   * Stock as it will stand once this cart is paid for. Estimates are taken
   * against this rather than against the shelf, so ringing up the last three
   * burgers warns on the fourth rather than after the money is taken.
   */
  const projectedStock = useMemo(() => {
    const usage = stockUsageForCart(cart, menuItems, assignments);
    if (usage.size === 0) return stockItems;
    return stockItems.map(item => {
      const used = usage.get(item.id) ?? 0;
      return used ? { ...item, quantity: item.quantity - used } : item;
    });
  }, [cart, menuItems, assignments, stockItems]);

  /** How many *more* of each menu item the remaining stock allows. */
  const remainingEstimates = useMemo(() => {
    const map = new Map<string, ProductEstimate>();
    for (const item of menuItems) {
      map.set(item.id, estimateProduct(item, menuItems, assignments, projectedStock));
    }
    return map;
  }, [menuItems, assignments, projectedStock]);

  /** The estimate for a menu item that cannot be made any more, else null. */
  const soldOutEstimate = useCallback((menuItem: MenuItem): ProductEstimate | null => {
    const estimate = remainingEstimates.get(menuItem.id);
    if (!estimate || estimate.unassigned || estimate.count > 0) return null;
    return estimate;
  }, [remainingEstimates]);

  /* -------------------------------------------------------- parked orders */

  const updateSessionById = useCallback((
    sessionId: string, updater: (session: ParkedSession) => ParkedSession,
  ) => {
    setParkedSessions(prev => prev.map(s =>
      s.id === sessionId ? { ...updater(s), lastModified: Date.now() } : s
    ).sort((a, b) => b.lastModified - a.lastModified));
  }, []);

  const updateActiveSession = useCallback((updater: (session: ParkedSession) => ParkedSession) => {
    updateSessionById(activeSessionId, updater);
  }, [updateSessionById, activeSessionId]);

  const nextSessionLabel = useCallback(() => {
    const usedLabels = new Set(parkedSessions.map(s => s.label));
    let nextLabel = 'A';
    while (usedLabels.has(nextLabel)) {
      nextLabel = String.fromCharCode(nextLabel.charCodeAt(0) + 1);
    }
    return nextLabel;
  }, [parkedSessions]);

  /**
   * Returns the id of the session to write into, creating an empty one first if
   * nothing is active. Lets notes and discounts be entered before any menu item.
   */
  const ensureActiveSession = useCallback((): string => {
    if (activeSessionId) return activeSessionId;
    const label = nextSessionLabel();
    const newSession: ParkedSession = {
      id: label,
      label,
      cart: [],
      notes: '',
      lastModified: Date.now(),
    };
    setParkedSessions(prev => [newSession, ...prev]);
    setActiveSessionId(label);
    return label;
  }, [activeSessionId, nextSessionLabel]);

  /**
   * Records a change to the parked orders.
   *
   * The cart, the notes, the discount and the parked list are all one array, so
   * one snapshot covers every change that can be made in the ordering panel.
   */
  const recordCart = useCallback((label: string, before: ParkedSession[]) => {
    // Read back on the next tick: the setters above have queued but not yet
    // applied, and the "after" state has to be the one that actually results.
    window.setTimeout(() => {
      const after = snapshot.current.parkedSessions;
      if (after === before) return;
      history.record(restoreAction(label, 'cart', before, after, setParkedSessions));
    }, 0);
  }, [snapshot, history]);

  const addToCartUnchecked = useCallback((menuItem: MenuItem) => {
    const before = snapshot.current.parkedSessions;
    const sessionId = ensureActiveSession();
    updateSessionById(sessionId, session => {
      const existing = session.cart.find(item => item.menuItemId === menuItem.id);
      if (existing) {
        return {
          ...session,
          cart: session.cart.map(item =>
            item.menuItemId === menuItem.id ? { ...item, quantity: item.quantity + 1 } : item
          )
        };
      }
      return {
        ...session,
        cart: [...session.cart, {
          menuItemId: menuItem.id,
          name: menuItem.name,
          price: menuItem.price,
          quantity: 1,
          dealItems: menuItem.dealItems
        }]
      };
    });
    recordCart(`Added ${menuItem.name} to the order`, before);
  }, [snapshot, ensureActiveSession, updateSessionById, recordCart]);

  /**
   * Tapping a menu item the kitchen cannot make asks first. It never blocks —
   * the shop may well have stock the app does not know about — but it says what
   * ran out so the choice is informed.
   */
  const addToCart = useCallback((menuItem: MenuItem) => {
    const soldOut = soldOutEstimate(menuItem);
    if (soldOut) {
      setSoldOutPrompt({ menuItem, estimate: soldOut });
      return;
    }
    addToCartUnchecked(menuItem);
  }, [soldOutEstimate, addToCartUnchecked]);

  const removeFromCart = useCallback((menuItemId: string) => {
    const before = snapshot.current.parkedSessions;
    const name = cart.find(i => i.menuItemId === menuItemId)?.name ?? 'an item';
    updateActiveSession(session => {
      const existing = session.cart.find(item => item.menuItemId === menuItemId);
      if (existing && existing.quantity > 1) {
        return {
          ...session,
          cart: session.cart.map(item =>
            item.menuItemId === menuItemId ? { ...item, quantity: item.quantity - 1 } : item
          )
        };
      }
      return {
        ...session,
        cart: session.cart.filter(item => item.menuItemId !== menuItemId)
      };
    });
    recordCart(`Took ${name} off the order`, before);
  }, [snapshot, cart, updateActiveSession, recordCart]);

  const updateNotes = useCallback((newNotes: string) => {
    // Notes can be typed before any item exists — spin up a session if needed.
    const sessionId = ensureActiveSession();
    updateSessionById(sessionId, session => ({ ...session, notes: newNotes }));
  }, [ensureActiveSession, updateSessionById]);

  const applyDiscount = useCallback((discount: Discount) => {
    const before = snapshot.current.parkedSessions;
    const sessionId = ensureActiveSession();
    updateSessionById(sessionId, session => ({ ...session, discount }));
    recordCart(
      discount.kind === 'percent'
        ? `Took ${discount.value}% off the order`
        : `Took Rs ${discount.value} off the order`,
      before,
    );
  }, [snapshot, ensureActiveSession, updateSessionById, recordCart]);

  const clearDiscount = useCallback(() => {
    if (!activeSessionId) return;
    const before = snapshot.current.parkedSessions;
    updateActiveSession(session => ({ ...session, discount: undefined }));
    recordCart('Removed the discount', before);
  }, [snapshot, activeSessionId, updateActiveSession, recordCart]);

  const requestDiscountPin = useCallback((onGranted: () => void) => {
    setDiscountPinInput('');
    setDiscountPinError(false);
    setDiscountPinPrompt({ onGranted });
  }, []);

  const submitDiscountPin = useCallback(() => {
    if (discountPinInput === revenuePin) {
      const granted = discountPinPrompt?.onGranted;
      setDiscountPinPrompt(null);
      setDiscountPinInput('');
      setDiscountPinError(false);
      granted?.();
    } else {
      setDiscountPinError(true);
    }
  }, [discountPinInput, revenuePin, discountPinPrompt]);

  const dismissDiscountPin = useCallback(() => {
    setDiscountPinPrompt(null);
    setDiscountPinInput('');
    setDiscountPinError(false);
  }, []);

  const clearCart = useCallback(() => {
    const before = snapshot.current.parkedSessions;
    updateActiveSession(session => ({ ...session, cart: [], notes: '', discount: undefined }));
    setCashReceived('');
    if (cart.length > 0) recordCart('Emptied the order', before);
  }, [snapshot, updateActiveSession, cart.length, recordCart]);

  const createNewSession = useCallback(() => {
    const before = snapshot.current.parkedSessions;
    const label = nextSessionLabel();
    const newSession: ParkedSession = {
      id: label,
      label,
      cart: [],
      notes: '',
      lastModified: Date.now()
    };
    setParkedSessions(prev => [newSession, ...prev]);
    setActiveSessionId(label);
    setCashReceived('');
    recordCart(`Started order ${label}`, before);
  }, [snapshot, nextSessionLabel, recordCart]);

  const switchToSession = useCallback((sessionId: string) => {
    setActiveSessionId(sessionId);
    setCashReceived('');
  }, []);

  const cancelEdit = useCallback((sessionId: string) => {
    const session = parkedSessions.find(s => s.id === sessionId);
    if (!session?.editingOrderId) return;

    setParkedSessions(prev => prev.filter(s => s.id !== sessionId));
    if (activeSessionId === sessionId) {
      const remaining = parkedSessions.filter(s => s.id !== sessionId);
      setActiveSessionId(remaining.length > 0 ? remaining[0].id : '');
    }
    setCashReceived('');
  }, [parkedSessions, activeSessionId]);

  /** Drops a session. An edit session is cancelled, never deleting the order behind it. */
  const deleteSession = useCallback((sessionId: string) => {
    const session = parkedSessions.find(s => s.id === sessionId);
    if (session?.editingOrderId) {
      cancelEdit(sessionId);
      return;
    }
    const before = snapshot.current.parkedSessions;
    setParkedSessions(prev => prev.filter(s => s.id !== sessionId));
    if (activeSessionId === sessionId) {
      const remaining = parkedSessions.filter(s => s.id !== sessionId);
      setActiveSessionId(remaining.length > 0 ? remaining[0].id : '');
    }
    recordCart(`Threw away parked order ${session?.label ?? sessionId}`, before);
  }, [snapshot, parkedSessions, activeSessionId, cancelEdit, recordCart]);

  /* ---------------------------------------------------------------- money */

  /**
   * Freezes each line's ingredient cost at the moment of sale.
   *
   * Historical margin has to be a fact, not a recalculation — otherwise editing
   * a recipe or a supplier price silently rewrites last month's profit. Lines
   * whose ingredients are not all costed are left undefined rather than being
   * given a partial figure, so "not costed" never masquerades as "free".
   */
  const costCart = useCallback((items: CartItem[]): CartItem[] => items.map(item => {
    if (item.unitCost !== undefined) return item;   // already frozen; never restate
    const menuItem = menuItems.find(mi => mi.id === item.menuItemId);
    if (!menuItem) return item;
    const resolved = unitCostFor(menuItem, menuItems, assignments, stockItems);
    return resolved.complete ? { ...item, unitCost: resolved.cost } : item;
  }), [menuItems, assignments, stockItems]);

  /**
   * Attaches the oversells logged while this cart was being built to the order
   * that resulted, and stamps the count on the line.
   */
  const linkOversellsToOrder = useCallback((order: Order): Order => {
    const byMenuItem = claimPendingOversells(order.id);
    if (byMenuItem.size === 0) return order;
    return {
      ...order,
      items: order.items.map(item => {
        const oversold = byMenuItem.get(item.menuItemId);
        return oversold ? { ...item, oversoldQuantity: oversold } : item;
      }),
    };
  }, [claimPendingOversells]);

  const checkout = useCallback(async (paymentType: 'cash' | 'transfer') => {
    if (cart.length === 0) return;
    const totals = computeTotals(cart, activeSession?.discount, activeTaxRate);
    const built: Order = {
      id: newOrderId(),
      seq: orderCounter,
      orderNumber: formatOrderNumber(orderCounter),
      ...claimTicket(),
      customerName: 'Customer',
      items: costCart(cart),
      notes,
      status: 'preparing',
      subtotal: totals.subtotal,
      discount: activeSession?.discount,
      discountAmount: totals.discountAmount,
      taxRate: totals.taxRate,
      taxAmount: totals.taxAmount,
      total: totals.total,
      timestamp: Date.now(),
      paid: paymentType,
    };

    const order = linkOversellsToOrder(built);
    deductStockForCart(order.items, order.id, `Order #${order.orderNumber}`);
    // Deliberately not on the undo stack. Taking money is the one thing in the
    // app that has a consequence outside it, and the supported way to reverse
    // a sale is to void the ticket — which keeps the record that it happened,
    // gives the stock back, and leaves the day's history true.
    setOrders(prev => [...prev, order]);
    setOrderCounter(c => c + 1);
    explainNotUndoable(
      `Order #${order.orderNumber} rung up`,
      'Rung-up orders are not undone with Ctrl+Z. Void it from All Orders if it was a mistake.',
      'checkout',
    );
    clearCart();
    if (activeSessionId) {
      setParkedSessions(prev => prev.filter(s => s.id !== activeSessionId));
      setActiveSessionId('');
    }
    printOrderIfNeeded(order);
    await saveImmediate();
  }, [
    cart, activeSession, activeTaxRate, orderCounter, claimTicket, costCart, notes,
    linkOversellsToOrder, deductStockForCart, explainNotUndoable, clearCart,
    activeSessionId, printOrderIfNeeded, saveImmediate,
  ]);

  /** Writes an edit back onto the original order, keeping its number and sequence. */
  const commitEdit = useCallback(async (
    session: ParkedSession, paymentType: 'cash' | 'transfer',
  ) => {
    const original = orders.find(o => o.id === session.editingOrderId);
    const totals = computeTotals(session.cart, session.discount, activeTaxRate);

    // Stock moves by the difference, so items removed during an edit come back.
    const before = stockUsageForCart(original?.items ?? [], menuItems, assignments);
    const after = stockUsageForCart(session.cart, menuItems, assignments);
    const touched = new Set([...before.keys(), ...after.keys()]);
    applyStockChanges([...touched].map(itemId => {
      const delta = (before.get(itemId) ?? 0) - (after.get(itemId) ?? 0);
      return {
        itemId,
        delta,
        reason: (delta >= 0 ? 'returned' : 'sold') as StockChange['reason'],
        note: `Edit of order #${original?.orderNumber ?? session.label}`,
        referenceType: 'order' as const,
        referenceId: original?.id ?? session.editingOrderId!,
      };
    }).filter(c => c.delta !== 0));

    const updated: Order = {
      id: original?.id ?? session.editingOrderId!,
      seq: original?.seq ?? orderCounter,
      orderNumber: original?.orderNumber ?? session.label,
      customerName: original?.customerName ?? 'Customer',
      items: costCart(session.cart),
      notes: session.notes,
      status: original?.status ?? 'preparing',
      subtotal: totals.subtotal,
      discount: session.discount,
      discountAmount: totals.discountAmount,
      taxRate: totals.taxRate,
      taxAmount: totals.taxAmount,
      total: totals.total,
      timestamp: original?.timestamp ?? Date.now(),
      editedAt: Date.now(),
      editCount: (original?.editCount ?? 0) + 1,
      paid: paymentType,
      /**
       * The session the order was taken in, carried through the edit.
       *
       * This object is rebuilt field by field rather than spread from the
       * original, and these two were simply missing from the list. The visible
       * symptom was that editing a ticket mid-service made it fall back to its
       * lifetime number — but the real damage was quieter: an order with no
       * session id is excluded from every session-scoped figure, so each edit
       * silently subtracted a sale from the session's takings, its ticket
       * count and its revenue per hour. An edit changes what was ordered. It
       * does not change which service it was ordered in.
       */
      sessionId: original?.sessionId,
      sessionTicket: original?.sessionTicket,
      // An edit is not a new ticket: whatever stages it already reached stand.
      voidedAt: original?.voidedAt,
      voidReason: original?.voidReason,
      grilledAt: original?.grilledAt,
      readyAt: original?.readyAt,
      completedAt: original?.completedAt,
    };

    // Not on the undo stack, for the same reason a checkout is not: it settles
    // money and it has already moved stock both ways. Editing it again is the
    // way to change it back.
    setOrders(prev => {
      const exists = prev.some(o => o.id === updated.id);
      // The order may have been deleted mid-edit; put it back rather than losing it.
      return exists ? prev.map(o => (o.id === updated.id ? updated : o)) : [...prev, updated];
    });
    explainNotUndoable(
      `Order #${updated.orderNumber} saved`,
      'Changes to a rung-up order are not undone with Ctrl+Z. Open it for editing again to change it further.',
      'edit',
    );

    await printEditedOrder(updated);

    setParkedSessions(prev => prev.filter(s => s.id !== session.id));
    if (activeSessionId === session.id) setActiveSessionId('');
    setCashReceived('');
    await saveImmediate();
  }, [
    orders, activeTaxRate, menuItems, assignments, applyStockChanges, orderCounter,
    costCart, explainNotUndoable, printEditedOrder, activeSessionId, saveImmediate,
  ]);

  const checkoutParkedSession = useCallback(async (
    sessionId: string, paymentType: 'cash' | 'transfer',
  ) => {
    const session = parkedSessions.find(s => s.id === sessionId);
    if (!session || session.cart.length === 0) return;

    if (session.editingOrderId) {
      await commitEdit(session, paymentType);
      return;
    }

    const totals = computeTotals(session.cart, session.discount, activeTaxRate);
    const draft: Order = {
      id: newOrderId(),
      seq: orderCounter,
      orderNumber: formatOrderNumber(orderCounter),
      ...claimTicket(),
      customerName: 'Customer',
      items: costCart(session.cart),
      notes: session.notes,
      status: 'preparing',
      subtotal: totals.subtotal,
      discount: session.discount,
      discountAmount: totals.discountAmount,
      taxRate: totals.taxRate,
      taxAmount: totals.taxAmount,
      total: totals.total,
      timestamp: Date.now(),
      paid: paymentType,
    };

    const newOrder = linkOversellsToOrder(draft);
    deductStockForCart(newOrder.items, newOrder.id, `Order #${newOrder.orderNumber}`);
    setOrders(prev => [...prev, newOrder]);
    setOrderCounter(c => c + 1);
    explainNotUndoable(
      `Order #${newOrder.orderNumber} rung up`,
      'Rung-up orders are not undone with Ctrl+Z. Void it from All Orders if it was a mistake.',
      'checkout',
    );

    printOrderIfNeeded(newOrder);

    setParkedSessions(prev => prev.filter(s => s.id !== sessionId));
    if (activeSessionId === sessionId) {
      setActiveSessionId('');
    }
    await saveImmediate();
  }, [
    parkedSessions, commitEdit, activeTaxRate, orderCounter, claimTicket, costCart,
    linkOversellsToOrder, deductStockForCart, explainNotUndoable, printOrderIfNeeded,
    activeSessionId, saveImmediate,
  ]);

  /* ---------------------------------------------------------------- board */

  /**
   * Records a change to the board and how to take it back.
   *
   * The board is pure status — nothing here moves stock or money — so the
   * reversal really is "put the old array back", and the previous value is
   * captured here at the moment of the change rather than reconstructed later.
   */
  const updateOrders = useCallback((
    label: string,
    updater: (prev: Order[]) => Order[],
    options?: { confirm?: string; silent?: boolean },
  ) => {
    const before = orders;
    const after = updater(before);
    setOrders(after);
    if (!options?.silent) {
      history.record(restoreAction(label, 'board', before, after, setOrders, options?.confirm));
    }
  }, [orders, history]);

  const moveOrder = useCallback((
    orderId: string, status: OrderStatus, paid?: 'cash' | 'transfer',
  ) => {
    // Frozen while being edited — the edit session owns it until commit or cancel.
    if (parkedSessions.some(s => s.editingOrderId === orderId)) return;
    // The grill has a fixed number of slots.
    if (status === 'grill' && !orders.some(o => o.id === orderId && o.status === 'grill')
        && orders.filter(o => o.status === 'grill').length >= grillCapacityRef.current) {
      return;
    }
    let movedOrder: Order | undefined;
    const now = Date.now();
    const moving = orders.find(o => o.id === orderId);
    const STAGE_NAME: Record<OrderStatus, string> = {
      preparing: 'Preparing',
      grill: 'the grill',
      ready: 'Ready',
      completed: 'Completed',
      parked: 'Parked',
    };
    updateOrders(`Moved #${moving?.orderNumber ?? '—'} to ${STAGE_NAME[status]}`, prev => {
      const order = prev.find(o => o.id === orderId);
      if (order && status === 'preparing') {
        movedOrder = { ...order, status, paid: paid ?? order.paid };
      }
      return prev.map(o => {
        if (o.id !== orderId) return o;
        // Stamp the first time a ticket reaches each stage. First, not last:
        // a ticket bounced back to Preparing and forward again should not read
        // as having been cooked twice as fast.
        return {
          ...o,
          status,
          paid: paid ?? o.paid,
          grilledAt: status === 'grill' ? o.grilledAt ?? now : o.grilledAt,
          readyAt: status === 'ready' ? o.readyAt ?? now : o.readyAt,
          completedAt: status === 'completed' ? o.completedAt ?? now : o.completedAt,
        };
      });
    });
    if (movedOrder) {
      printOrderIfNeeded(movedOrder);
    }
  }, [parkedSessions, orders, grillCapacityRef, updateOrders, printOrderIfNeeded]);

  /**
   * Pulls an order back into the ordering area as an edit session. The order
   * stays on the board, frozen and marked, so the kitchen never loses sight of it.
   */
  const startEditingOrder = useCallback((orderId: string) => {
    // Already open for editing — just jump to that session.
    const existing = parkedSessions.find(s => s.editingOrderId === orderId);
    if (existing) {
      setActiveSessionId(existing.id);
      if (currentView !== 'orderMode') navigateTo('orderMode');
      return;
    }

    const order = orders.find(o => o.id === orderId);
    if (!order) return;

    const sessionId = `edit-${order.id}`;
    const editSession: ParkedSession = {
      id: sessionId,
      // The number the kitchen is calling right now, not the lifetime one —
      // otherwise the chip in the sidebar and the ticket on the board disagree
      // about which order is being edited.
      label: displayNumber(
        order,
        sessionsRef.current.find(s => s.status === 'active')?.id ?? null,
      ),
      cart: order.items.map(item => ({ ...item })),
      notes: order.notes,
      lastModified: Date.now(),
      discount: order.discount,
      editingOrderId: order.id,
    };

    // The order keeps its status and stays where the kitchen expects it.
    setParkedSessions(prev => [editSession, ...prev.filter(s => s.id !== sessionId)]);
    setActiveSessionId(sessionId);
    setCashReceived('');
    if (currentView !== 'orderMode') navigateTo('orderMode');
  }, [parkedSessions, orders, sessionsRef, currentView, navigateTo]);

  /**
   * Cancels an order without erasing it.
   *
   * The row stays — that a sale was rung up and then cancelled is itself a fact
   * worth keeping — but it leaves the board, stops counting towards revenue,
   * gives its ingredients back, and is skipped when the live orders are
   * resequenced. Deleting instead meant yesterday's takings changed whenever
   * someone tidied the board, and left the stock ledger holding a deduction
   * whose order no longer existed.
   */
  const voidOrder = useCallback(async (orderId: string, reason?: string) => {
    if (pendingDeleteId === orderId) {
      const target = snapshot.current.orders.find(o => o.id === orderId);
      if (!target || target.voidedAt) {
        setPendingDeleteId(null);
        return;
      }
      const beforeOrders = snapshot.current.orders;
      const beforeCounter = orderCounter;

      returnStockForCart(target.items, target.id, `Void of order #${target.orderNumber}`);
      const voided: Order = { ...target, voidedAt: Date.now(), voidReason: reason };
      const remaining = renumberOrders(
        snapshot.current.orders.map(o => (o.id === orderId ? voided : o))
      );
      const nextCounter = liveOrderCount(remaining) + 1;
      setOrders(remaining);
      setOrderCounter(nextCounter);
      setPendingDeleteId(null);

      /**
       * Undoing a void is not simply putting the row back. Voiding gave the
       * ingredients to the shelf, so restoring the sale has to take them off
       * again — and the numbering, which was closed up when the ticket left the
       * board, has to open back out. All three move together or none of them
       * mean anything.
       *
       * That is also what keeps `voidStats` honest, and it was checked rather
       * than assumed in Phase 1B. The undo restores the whole order list from
       * before the void, so `voidedAt` and `voidReason` go with it and the
       * ticket counts as live again — there is no separate flag to forget.
       * `metrics.check.ts` asserts it.
       *
       * The stock side needs no `reversal` line. Returning a voided order's
       * ingredients and taking them back off are both real physical movements
       * with reasons of their own (`returned`, `sold`), not the program undoing
       * its own bookkeeping. Marking them `reversed` would hide a sale that
       * genuinely happened from consumption and food cost.
       */
      history.record({
        label: `Voided order #${target.orderNumber}`,
        scope: 'board',
        confirm: `This puts order #${target.orderNumber} back on the board as a live sale, counts it towards your takings again, and takes its ingredients back off the shelf.`,
        undo: () => {
          setOrders(beforeOrders);
          setOrderCounter(beforeCounter);
          deductStockForCart(target.items, target.id, `Void of #${target.orderNumber} undone`);
        },
        redo: () => {
          setOrders(remaining);
          setOrderCounter(nextCounter);
          returnStockForCart(target.items, target.id, `Void of order #${target.orderNumber}`);
        },
      });

      await saveImmediate({ orders: remaining, orderCounter: nextCounter });
    } else {
      setPendingDeleteId(orderId);
      setTimeout(() => {
        setPendingDeleteId(curr => (curr === orderId ? null : curr));
      }, VOID_ARM_MS);
    }
  }, [
    pendingDeleteId, snapshot, orderCounter, returnStockForCart, deductStockForCart,
    history, saveImmediate,
  ]);

  /** Routes a ticket action-menu gesture to the right handler. */
  const handleTicketAction = useCallback((orderId: string, action: TicketAction) => {
    if (action === 'edit') {
      startEditingOrder(orderId);
      return;
    }
    const statusFor: Record<Exclude<TicketAction, 'edit'>, BoardStatus> = {
      completed: 'completed',
      grill: 'grill',
      ready: 'ready',
      preparing: 'preparing',
    };
    moveOrder(orderId, statusFor[action]);
  }, [startEditingOrder, moveOrder]);

  /* ---------------------------------------------------------- bulk changes */

  const hydrate = useCallback((next: {
    orders: Order[];
    parkedSessions: ParkedSession[];
    orderCounter: number;
  }) => {
    setOrders(next.orders);
    setParkedSessions(next.parkedSessions);
    setOrderCounter(next.orderCounter);
  }, []);

  const clear = useCallback(() => {
    setOrders([]);
    setParkedSessions([]);
    setActiveSessionId('');
    setOrderCounter(1);
  }, []);

  /* ------------------------------------------------------------- derived */

  // Voided orders leave the board entirely; they live on only in history.
  const liveOrders = orders.filter(o => !o.voidedAt);
  const byStatus = (status: OrderStatus) => liveOrders.filter(o => o.status === status);

  const cartTotals = computeTotals(cart, activeSession?.discount, activeTaxRate);
  const cashReceivedNum = parseFloat(cashReceived) || 0;
  const change = cashReceivedNum - cartTotals.total;

  // An order is "being edited" purely because a session claims it — no second
  // source of truth to drift, and it keeps its place on the board throughout.
  const editingOrderIds = new Set(
    parkedSessions.map(s => s.editingOrderId).filter((id): id is string => Boolean(id))
  );

  return {
    state: {
      orders,
      orderCounter,
      parkedSessions,
      activeSessionId,
      activeSession,
      cart,
      notes,
      cartTotals,
      cashReceived,
      change,
      isEditingSession: Boolean(activeSession?.editingOrderId),
      pendingDeleteId,
      soldOutPrompt,
      dismissedLowStock,
      discountPinPrompt,
      discountPinInput,
      discountPinError,
      pendingDiscountAmount,
      remainingEstimates,
      editingOrderIds,
      preparing: byStatus('preparing'),
      grill: byStatus('grill'),
      ready: byStatus('ready'),
      completed: byStatus('completed'),
    },
    actions: {
      hydrate,
      clear,
      soldOutEstimate,
      addToCart,
      addToCartUnchecked,
      removeFromCart,
      updateNotes,
      clearCart,
      applyDiscount,
      clearDiscount,
      requestDiscountPin,
      submitDiscountPin,
      dismissDiscountPin,
      setDiscountPinInput,
      setDiscountPinError,
      setPendingDiscountAmount,
      setCashReceived,
      setSoldOutPrompt,
      setDismissedLowStock,
      createNewSession,
      switchToSession,
      deleteSession,
      cancelEdit,
      checkout,
      checkoutParkedSession,
      moveOrder,
      startEditingOrder,
      voidOrder,
      handleTicketAction,
    },
  };
}

export type OrdersHandle = ReturnType<typeof useOrders>;
