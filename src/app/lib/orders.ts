import { resolveDealComponent } from './inventory';
import type {
  CartItem,
  Discount,
  MenuItem,
  MenuItemStockAssignment,
  Order,
  StockItem,
} from '../types';

/** Pre-discount sum of a cart. */
export function cartSubtotal(cart: CartItem[]): number {
  return cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
}

/** Resolve a discount against a subtotal, clamped to [0, subtotal]. */
export function discountAmountFor(subtotal: number, discount?: Discount): number {
  if (!discount || subtotal <= 0) return 0;
  const raw = discount.kind === 'percent'
    ? (subtotal * discount.value) / 100
    : discount.value;
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.min(Math.round(raw * 100) / 100, subtotal);
}

export interface Totals {
  subtotal: number;
  discountAmount: number;
  taxRate: number;
  taxAmount: number;
  total: number;
}

/** Tax is charged on the discounted amount, which is the usual order of operations. */
export function taxAmountFor(taxableBase: number, taxRate?: number): number {
  if (!taxRate || taxRate <= 0 || taxableBase <= 0) return 0;
  return Math.round(((taxableBase * taxRate) / 100) * 100) / 100;
}

export function computeTotals(cart: CartItem[], discount?: Discount, taxRate = 0): Totals {
  const subtotal = cartSubtotal(cart);
  const discountAmount = discountAmountFor(subtotal, discount);
  const taxable = subtotal - discountAmount;
  const taxAmount = taxAmountFor(taxable, taxRate);
  return {
    subtotal,
    discountAmount,
    taxRate: taxAmount > 0 ? taxRate : 0,
    taxAmount,
    total: taxable + taxAmount,
  };
}

export type DiscountParse =
  | { ok: true; discount: Discount; amount: number }
  | { ok: false; reason: string }
  | { ok: 'empty' };

/**
 * Parse the discount field.
 *   "100"  -> Rs 100 off
 *   "%5"   -> 5% off   (leading % is the documented form)
 *   "5%"   -> 5% off   (trailing % accepted too)
 */
export function parseDiscount(input: string, subtotal: number): DiscountParse {
  const raw = input.trim();
  if (raw === '') return { ok: 'empty' };

  const isPercent = raw.startsWith('%') || raw.endsWith('%');
  const numberPart = raw.replace(/%/g, '').trim();

  if (numberPart === '' || !/^\d*\.?\d+$/.test(numberPart)) {
    return { ok: false, reason: 'Numbers only' };
  }

  const value = parseFloat(numberPart);
  if (!Number.isFinite(value) || value <= 0) {
    return { ok: false, reason: 'Must be over 0' };
  }

  if (isPercent) {
    if (value > 100) return { ok: false, reason: 'Max 100%' };
    const discount: Discount = { kind: 'percent', value };
    return { ok: true, discount, amount: discountAmountFor(subtotal, discount) };
  }

  if (subtotal > 0 && value > subtotal) {
    return { ok: false, reason: 'Over the total' };
  }
  const discount: Discount = { kind: 'flat', value };
  return { ok: true, discount, amount: discountAmountFor(subtotal, discount) };
}

export function formatDiscount(discount: Discount): string {
  return discount.kind === 'percent'
    ? `${discount.value}%`
    : `Rs ${discount.value.toFixed(0)}`;
}

/** Order numbers are the padded sequence number. */
export function formatOrderNumber(seq: number): string {
  return String(seq).padStart(2, '0');
}

/**
 * Reassign seq/orderNumber across the live orders so they run 1..N with no
 * gaps, in creation order. `id` is never touched.
 *
 * Voided orders keep whatever number they had and are skipped by the count.
 * They are history rather than a gap to close, and renumbering them would make
 * the ledger lines and receipts that quote their number unreadable.
 */
export function renumberOrders(orders: Order[]): Order[] {
  let live = 0;
  const numbered = new Map<string, number>();
  for (const order of [...orders].sort((a, b) => a.timestamp - b.timestamp || a.seq - b.seq)) {
    if (order.voidedAt) continue;
    live += 1;
    numbered.set(order.id, live);
  }
  return orders.map(order => {
    const seq = numbered.get(order.id);
    return seq === undefined ? order : { ...order, seq, orderNumber: formatOrderNumber(seq) };
  });
}

/** How many orders count towards the sequence. Voids do not. */
export function liveOrderCount(orders: Order[]): number {
  return orders.reduce((n, order) => (order.voidedAt ? n : n + 1), 0);
}

/** Unique, non-sequential order id — sequence lives in `seq` instead. */
export function newOrderId(): string {
  return `o-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Flatten a cart into stock deltas, expanding deals into their component items.
 * Returns a map of stockItemId -> quantity consumed.
 */
export function stockUsageForCart(
  cart: CartItem[],
  menuItems: MenuItem[],
  assignments: MenuItemStockAssignment[],
): Map<string, number> {
  const usage = new Map<string, number>();

  const consume = (menuItemId: string, multiplier: number) => {
    for (const assignment of assignments) {
      if (assignment.menuItemId !== menuItemId) continue;
      const prev = usage.get(assignment.stockItemId) ?? 0;
      usage.set(assignment.stockItemId, prev + assignment.quantityPerItem * multiplier);
    }
  };

  for (const cartItem of cart) {
    if (cartItem.dealItems && cartItem.dealItems.length > 0) {
      for (const dealItem of cartItem.dealItems) {
        const sub = resolveDealComponent(dealItem, menuItems);
        if (sub) consume(sub.id, dealItem.quantity * cartItem.quantity);
      }
    } else {
      consume(cartItem.menuItemId, cartItem.quantity);
    }
  }

  return usage;
}

/**
 * Apply the difference between two carts to stock levels. Items removed during
 * an edit are added back; items added are deducted.
 */
export function applyStockDelta(
  stockItems: StockItem[],
  previousCart: CartItem[],
  nextCart: CartItem[],
  menuItems: MenuItem[],
  assignments: MenuItemStockAssignment[],
): StockItem[] {
  const before = stockUsageForCart(previousCart, menuItems, assignments);
  const after = stockUsageForCart(nextCart, menuItems, assignments);

  const ids = new Set<string>([...before.keys(), ...after.keys()]);
  if (ids.size === 0) return stockItems;

  return stockItems.map(item => {
    if (!ids.has(item.id)) return item;
    const delta = (after.get(item.id) ?? 0) - (before.get(item.id) ?? 0);
    if (delta === 0) return item;
    return { ...item, quantity: Math.max(0, item.quantity - delta) };
  });
}

/*
 * Session display numbering used to live here, derived from a start timestamp.
 * It moved to `lib/sessions.ts` and became a stored `sessionTicket` on the
 * order, because a session that pauses overnight spans hours it does not own,
 * and a timestamp cannot tell the difference.
 */
