import { effectiveMovements, resolveDealComponent, unitCostFor } from '../lib/inventory';
import {
  costsForEvent, ordersForSession, ordersForSessions, sessionTradingHours,
} from '../lib/sessions';
import type {
  CartItem, Category, CostAppliesTo, CostBasis, CostEntry, InventorySnapshot, MenuItem,
  MenuItemStockAssignment, Order, OversellEvent, StockItem, StockMovement, TradingSession,
} from '../types';

/**
 * The analytics engine. No React, no formatting decisions — just facts derived
 * from stored records, so every number on screen can be traced back to rows.
 *
 * Two rules run through all of it:
 *
 *  - **Voided orders are not revenue.** They stay in the data because a
 *    cancelled sale is a fact worth keeping, but every money figure excludes
 *    them.
 *  - **Missing cost is not zero cost.** A line with no `unitCost` was never
 *    costed; counting it as free would report a 100% margin. Those lines are
 *    counted separately and surfaced as a coverage figure, so profit is either
 *    trustworthy or visibly incomplete.
 */

/* ------------------------------------------------------------------ ranges */

export interface DateRange {
  /** Inclusive start, ms. */
  start: number;
  /** Exclusive end, ms. */
  end: number;
  label: string;
}

export type RangePreset =
  | 'today' | 'yesterday' | 'last7' | 'last30' | 'thisMonth' | 'lastMonth'
  | 'thisQuarter' | 'thisYear' | 'all' | 'custom';

const DAY = 24 * 60 * 60 * 1000;

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

export function resolveRange(
  preset: RangePreset,
  custom?: { start: number; end: number },
  now = Date.now(),
): DateRange {
  const today = startOfDay(new Date(now));
  const d = new Date(now);

  switch (preset) {
    case 'today': return { start: today, end: today + DAY, label: 'Today' };
    case 'yesterday': return { start: today - DAY, end: today, label: 'Yesterday' };
    case 'last7': return { start: today - 6 * DAY, end: today + DAY, label: 'Last 7 days' };
    case 'last30': return { start: today - 29 * DAY, end: today + DAY, label: 'Last 30 days' };
    case 'thisMonth':
      return {
        start: new Date(d.getFullYear(), d.getMonth(), 1).getTime(),
        end: new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime(),
        label: 'This month',
      };
    case 'lastMonth':
      return {
        start: new Date(d.getFullYear(), d.getMonth() - 1, 1).getTime(),
        end: new Date(d.getFullYear(), d.getMonth(), 1).getTime(),
        label: 'Last month',
      };
    case 'thisQuarter': {
      const q = Math.floor(d.getMonth() / 3) * 3;
      return {
        start: new Date(d.getFullYear(), q, 1).getTime(),
        end: new Date(d.getFullYear(), q + 3, 1).getTime(),
        label: 'This quarter',
      };
    }
    case 'thisYear':
      return {
        start: new Date(d.getFullYear(), 0, 1).getTime(),
        end: new Date(d.getFullYear() + 1, 0, 1).getTime(),
        label: 'This year',
      };
    case 'custom':
      return { start: custom?.start ?? today, end: custom?.end ?? today + DAY, label: 'Custom' };
    case 'all':
    default:
      return { start: 0, end: now + DAY, label: 'All time' };
  }
}

/** The equivalent window immediately before this one, for comparisons. */
export function previousRange(range: DateRange): DateRange {
  const span = range.end - range.start;
  return { start: range.start - span, end: range.start, label: 'Previous period' };
}

/* ------------------------------------------------------------------ totals */

export interface OrderMoney {
  /** Sum of line prices before discount. */
  gross: number;
  discount: number;
  tax: number;
  /** gross − discount. Tax is a pass-through and is not revenue. */
  netRevenue: number;
  /** What the customer actually paid, tax included. */
  collected: number;
  /** Cost of the lines that have one. */
  cogs: number;
  /** netRevenue of the lines that have a cost — the comparable part of it. */
  costedRevenue: number;
  /** Lines with a cost ÷ all lines, 0..1. */
  costCoverage: number;
  units: number;
  lines: number;
}

/**
 * Money for one order.
 *
 * Tax is excluded from revenue: it is collected on behalf of the state and
 * passing it through the profit line would flatter every figure. `collected` is
 * kept separately for reconciling the till.
 *
 * COGS only counts lines that carry a cost snapshot, and `costedRevenue` is the
 * revenue of exactly those lines — so margin is computed over a like-for-like
 * base rather than dividing a partial cost by a complete revenue.
 */
export function orderMoney(order: Order): OrderMoney {
  let gross = 0;
  let units = 0;
  let cogs = 0;
  let costedGross = 0;
  let costedLines = 0;

  for (const item of order.items) {
    const lineGross = item.price * item.quantity;
    gross += lineGross;
    units += item.quantity;
    if (item.unitCost !== undefined) {
      cogs += item.unitCost * item.quantity;
      costedGross += lineGross;
      costedLines += 1;
    }
  }

  const discount = order.discountAmount ?? 0;
  const netRevenue = gross - discount;
  // Spread the discount over the costed lines in proportion to their price.
  const costedShare = gross > 0 ? costedGross / gross : 0;

  return {
    gross,
    discount,
    tax: order.taxAmount ?? 0,
    netRevenue,
    collected: netRevenue + (order.taxAmount ?? 0),
    cogs,
    costedRevenue: netRevenue * costedShare,
    costCoverage: order.items.length > 0 ? costedLines / order.items.length : 0,
    units,
    lines: order.items.length,
  };
}

export interface Totals {
  orders: number;
  voided: number;
  units: number;
  gross: number;
  discount: number;
  tax: number;
  netRevenue: number;
  collected: number;
  cogs: number;
  costedRevenue: number;
  grossProfit: number;
  /** Null when no line in the period carries a cost — not zero. */
  grossMarginPct: number | null;
  /** Share of lines that carry a cost, 0..1. Drives the honesty banner. */
  costCoverage: number;
  averageOrderValue: number;
  averageUnitsPerOrder: number;
  discountRatePct: number;
  cash: number;
  transfer: number;
}

export function emptyTotals(): Totals {
  return {
    orders: 0, voided: 0, units: 0, gross: 0, discount: 0, tax: 0, netRevenue: 0,
    collected: 0, cogs: 0, costedRevenue: 0, grossProfit: 0, grossMarginPct: null,
    costCoverage: 0, averageOrderValue: 0, averageUnitsPerOrder: 0, discountRatePct: 0,
    cash: 0, transfer: 0,
  };
}

/** Aggregates a set of orders. Voids are counted but contribute no money. */
export function totalsFor(orders: Order[]): Totals {
  const t = emptyTotals();
  let costedLines = 0;
  let allLines = 0;

  for (const order of orders) {
    if (order.voidedAt) { t.voided += 1; continue; }
    const m = orderMoney(order);
    t.orders += 1;
    t.units += m.units;
    t.gross += m.gross;
    t.discount += m.discount;
    t.tax += m.tax;
    t.netRevenue += m.netRevenue;
    t.collected += m.collected;
    t.cogs += m.cogs;
    t.costedRevenue += m.costedRevenue;
    allLines += m.lines;
    costedLines += m.lines * m.costCoverage;
    if (order.paid === 'cash') t.cash += m.collected;
    if (order.paid === 'transfer') t.transfer += m.collected;
  }

  t.grossProfit = t.costedRevenue - t.cogs;
  t.grossMarginPct = t.costedRevenue > 0 ? (t.grossProfit / t.costedRevenue) * 100 : null;
  t.costCoverage = allLines > 0 ? costedLines / allLines : 0;
  t.averageOrderValue = t.orders > 0 ? t.netRevenue / t.orders : 0;
  t.averageUnitsPerOrder = t.orders > 0 ? t.units / t.orders : 0;
  t.discountRatePct = t.gross > 0 ? (t.discount / t.gross) * 100 : 0;
  return t;
}

export function inRange(order: Order, range: DateRange): boolean {
  return order.timestamp >= range.start && order.timestamp < range.end;
}

export function ordersInRange(orders: Order[], range: DateRange): Order[] {
  return orders.filter(o => inRange(o, range));
}

/* -------------------------------------------------------------- item level */

export interface ItemPerformance {
  menuItemId: string;
  name: string;
  category: string;
  units: number;
  netRevenue: number;
  cogs: number;
  grossProfit: number;
  marginPct: number | null;
  orders: number;
  costed: boolean;
  /** Units customers asked for that could not be made. */
  oversold: number;
}

/**
 * Per-item performance.
 *
 * Deals are counted twice on purpose, in two different senses: the deal itself
 * carries the revenue, and its components are credited with the units, because
 * "how many burgers went out" has to include the ones inside deals. Revenue is
 * never double-counted — components get units and no money.
 */
export function itemPerformance(
  orders: Order[],
  menuItems: MenuItem[],
  range: DateRange,
): ItemPerformance[] {
  const rows = new Map<string, ItemPerformance>();
  const key = (id: string, name: string) => {
    if (!rows.has(id)) {
      rows.set(id, {
        menuItemId: id,
        name,
        category: menuItems.find(m => m.id === id)?.category ?? '',
        units: 0, netRevenue: 0, cogs: 0, grossProfit: 0, marginPct: null,
        orders: 0, costed: true, oversold: 0,
      });
    }
    return rows.get(id)!;
  };

  for (const order of orders) {
    if (order.voidedAt || !inRange(order, range)) continue;
    const money = orderMoney(order);
    // Discounts are order-level; share them across lines by value.
    const discountShare = money.gross > 0 ? money.discount / money.gross : 0;

    for (const item of order.items) {
      const row = key(item.menuItemId, item.name);
      const lineGross = item.price * item.quantity;
      row.netRevenue += lineGross * (1 - discountShare);
      row.orders += 1;
      row.oversold += item.oversoldQuantity ?? 0;
      if (item.unitCost !== undefined) row.cogs += item.unitCost * item.quantity;
      else row.costed = false;

      const isDeal = Boolean(item.dealItems?.length);
      if (!isDeal) {
        row.units += item.quantity;
      } else {
        // Credit the components with the units they actually represent.
        for (const component of item.dealItems!) {
          const sub = resolveDealComponent(component, menuItems);
          if (!sub) continue;
          key(sub.id, sub.name).units += component.quantity * item.quantity;
        }
      }
    }
  }

  for (const row of rows.values()) {
    row.grossProfit = row.costed ? row.netRevenue - row.cogs : 0;
    row.marginPct = row.costed && row.netRevenue > 0
      ? (row.grossProfit / row.netRevenue) * 100
      : null;
  }

  return [...rows.values()].sort((a, b) => b.netRevenue - a.netRevenue);
}

export interface CategoryPerformance {
  category: string;
  units: number;
  netRevenue: number;
  share: number;
}

export function categoryPerformance(items: ItemPerformance[]): CategoryPerformance[] {
  const totals = new Map<string, CategoryPerformance>();
  let revenue = 0;
  for (const item of items) {
    const name = item.category || 'Uncategorised';
    const row = totals.get(name) ?? { category: name, units: 0, netRevenue: 0, share: 0 };
    row.units += item.units;
    row.netRevenue += item.netRevenue;
    revenue += item.netRevenue;
    totals.set(name, row);
  }
  for (const row of totals.values()) row.share = revenue > 0 ? row.netRevenue / revenue : 0;
  return [...totals.values()].sort((a, b) => b.netRevenue - a.netRevenue);
}

/* -------------------------------------------------------------- over time */

export type Grain = 'hour' | 'day' | 'week' | 'month';

export interface Bucket {
  /** Start of the bucket, ms. */
  key: number;
  label: string;
  totals: Totals;
}

function bucketStart(ts: number, grain: Grain): number {
  const d = new Date(ts);
  switch (grain) {
    case 'hour': return new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()).getTime();
    case 'day': return startOfDay(d);
    case 'week': {
      const day = (d.getDay() + 6) % 7;   // Monday-first
      return startOfDay(new Date(d.getFullYear(), d.getMonth(), d.getDate() - day));
    }
    case 'month': return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  }
}

const LABELS: Record<Grain, Intl.DateTimeFormatOptions> = {
  hour: { hour: 'numeric' },
  day: { day: 'numeric', month: 'short' },
  week: { day: 'numeric', month: 'short' },
  month: { month: 'short', year: '2-digit' },
};

/**
 * Groups orders into time buckets.
 *
 * Only buckets that actually contain trading are returned. Filling in the empty
 * ones would be right for a shop that opens every day and wrong here: this
 * business trades on event days, and a chart padded with structural zeroes says
 * "sales collapsed" when it means "there was no market that week".
 */
export function bucketsFor(orders: Order[], range: DateRange, grain: Grain): Bucket[] {
  const map = new Map<number, Order[]>();
  for (const order of orders) {
    if (!inRange(order, range)) continue;
    const key = bucketStart(order.timestamp, grain);
    const list = map.get(key);
    if (list) list.push(order); else map.set(key, [order]);
  }
  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([key, list]) => ({
      key,
      label: new Date(key).toLocaleDateString(undefined, LABELS[grain]),
      totals: totalsFor(list),
    }));
}

/** Picks a sensible grain for the span, so a year is not charted by the hour. */
export function grainFor(range: DateRange): Grain {
  const span = range.end - range.start;
  if (span <= 2 * DAY) return 'hour';
  if (span <= 70 * DAY) return 'day';
  if (span <= 400 * DAY) return 'week';
  return 'month';
}

/* ----------------------------------------------------------- trading hours */

export interface TradingHour {
  /** 0–23. */
  hour: number;
  orders: number;
  netRevenue: number;
  units: number;
}

/**
 * Sales by hour of day, across whatever days traded.
 *
 * For a business that works events this is the most useful shape there is: the
 * within-service curve is far more stable than the day-to-day totals.
 */
export function tradingHours(orders: Order[], range: DateRange): TradingHour[] {
  const rows: TradingHour[] = Array.from({ length: 24 }, (_, hour) => ({
    hour, orders: 0, netRevenue: 0, units: 0,
  }));
  for (const order of orders) {
    if (order.voidedAt || !inRange(order, range)) continue;
    const money = orderMoney(order);
    const row = rows[new Date(order.timestamp).getHours()];
    row.orders += 1;
    row.netRevenue += money.netRevenue;
    row.units += money.units;
  }
  return rows;
}

/** Distinct clock hours in which anything was sold — the real trading time. */
export function activeTradingHours(orders: Order[], range: DateRange): number {
  const hours = new Set<number>();
  for (const order of orders) {
    if (order.voidedAt || !inRange(order, range)) continue;
    hours.add(Math.floor(order.timestamp / (60 * 60 * 1000)));
  }
  return hours.size;
}

/* -------------------------------------------------------------- kitchen */

export interface ThroughputStats {
  /** Orders that reached Ready and can therefore be measured. */
  measured: number;
  medianToReadyMs: number | null;
  p90ToReadyMs: number | null;
  medianOnGrillMs: number | null;
  /**
   * The mean time a ticket spends on the grill.
   *
   * Shown in place of the median, which was the figure here before. For a queue
   * time the median is the better statistic — it describes what a typical
   * customer waits and ignores the one ticket that sat forgotten. Grill time is
   * being read as a capacity number rather than an experience one: how long a
   * slot is occupied, and therefore how many tickets an hour the grill can
   * clear. That is a question about the total, and the mean is the figure that
   * multiplies back out to the total. The median does not.
   */
  averageOnGrillMs: number | null;
  /** Orders per hour of trading, at the busiest hour of the period. */
  peakOrdersPerHour: number;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

/**
 * How fast the kitchen actually turns tickets around.
 *
 * Only orders with the relevant stamps are measured — these were added part-way
 * through the app's life and cannot be back-filled, so `measured` says how much
 * of the period the figures actually cover.
 */
export function throughput(orders: Order[], range: DateRange): ThroughputStats {
  const toReady: number[] = [];
  const onGrill: number[] = [];
  const perHour = new Map<number, number>();

  for (const order of orders) {
    if (order.voidedAt || !inRange(order, range)) continue;
    const hour = Math.floor(order.timestamp / (60 * 60 * 1000));
    perHour.set(hour, (perHour.get(hour) ?? 0) + 1);

    const ready = order.readyAt ?? order.completedAt;
    if (ready && ready > order.timestamp) toReady.push(ready - order.timestamp);
    if (order.grilledAt && ready && ready > order.grilledAt) onGrill.push(ready - order.grilledAt);
  }

  return {
    measured: toReady.length,
    medianToReadyMs: median(toReady),
    p90ToReadyMs: percentile(toReady, 90),
    medianOnGrillMs: median(onGrill),
    averageOnGrillMs: mean(onGrill),
    peakOrdersPerHour: perHour.size > 0 ? Math.max(...perHour.values()) : 0,
  };
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * How many of one particular thing you would have to sell to break even.
 *
 * "You need to sell 61 units" is not a sentence anybody can act on: units of
 * what? At an average price nothing is actually sold at? This answers the
 * question in things that exist — 34 burgers, or 51 cokes — because the number
 * that matters is different for every item, and the cheap one is a much longer
 * day than the expensive one.
 */
/** One side of an item's margin: a price, what one costs, and what is left. */
export interface ItemMarginSide {
  /** What one is sold at. */
  price: number;
  /** Ingredient cost of one. */
  unitCost: number;
  /** Price less ingredients, before the costs that are not ingredients. */
  grossPerUnit: number;
  /** `grossPerUnit` ÷ price, as a percentage. */
  marginPct: number;
  /** What one leaves behind after every cost that scales with a sale. */
  contributionPerUnit: number;
}

/** How much margin ten percent is, for the divergence indicator. */
const DIVERGENCE_THRESHOLD_PCT = 10;

export interface ItemMargin {
  menuItemId: string;
  name: string;
  /**
   * The menu's current price against a live recipe lookup. Responds to a price
   * change or a supplier price the moment either is edited.
   *
   * Null when the recipe is incomplete — a margin taken from a partial cost is
   * the flattering answer produced automatically on the data nobody can check,
   * which is what invariant 2 exists to prevent.
   */
  today: ItemMarginSide | null;
  /** The ingredients with no cost on file, which is why `today` is null. */
  missing: string[];
  /**
   * What actually sold, at the costs frozen onto those lines at checkout.
   *
   * This must not move when a price changes (invariant 3): it is a fact about
   * past transactions, and re-pricing it at today's menu would rewrite last
   * month's profit every time somebody edited a recipe.
   */
  realised: ItemMarginSide | null;
  /** How many sold in this period. */
  sold: number;
  /** |today − realised| ÷ realised on gross margin, as a percentage. */
  divergencePct: number | null;
  /** True when the two are more than 10% apart. */
  diverged: boolean;
}

/**
 * Two margins per item, deliberately kept apart.
 *
 * They used to be one figure, and the way it was derived made it useless for
 * either job: price came out as `item.netRevenue / item.units`, the realised
 * historical average. That figure cannot respond to a price change by
 * construction — put the burger up by Rs 20 and it says exactly what it said
 * before — and after a handful of sales at the new price it reports a blend
 * that is neither the old price nor the new one, so it is not a good historical
 * record either.
 *
 * So: **margin today** is the menu's price against a live `unitCostFor`, and
 * answers "what does this earn me now". **Realised margin** is what actually
 * sold at the costs frozen onto those lines, and answers "what did this earn
 * me". The first moves when the menu is edited; the second must never.
 *
 * When they diverge by more than 10% something is worth looking at — usually a
 * price that has moved, or a supplier cost that has, and neither is visible
 * from either figure alone.
 */
export function itemMargins(
  items: ItemPerformance[],
  menuItems: MenuItem[],
  assignments: MenuItemStockAssignment[],
  stockItems: StockItem[],
  costs: CostSummary,
  totals: Totals,
  scope: CostScope = 'range',
  mix: SalesMixEntry[] | null = null,
): ItemMargin[] {
  const resolved = resolveCosts(costs, totals, scope, mix);
  // A per-ticket cost becomes a per-unit one through the basket, exactly as in
  // `breakEven`. Both sides carry it, so it cannot create a divergence.
  const perOrderPerUnit = resolved.averageBasket && resolved.averageBasket > 0
    ? resolved.perOrderCost / resolved.averageBasket
    : 0;

  /*
   * `perUnitRate` is this item's own, not the shop's blend (ADR-022): a burger
   * carries its box and a drink does not. Both sides of the margin are given
   * the same rate for the same reason `perOrderPerUnit` is — a cost that
   * appeared on one side only would read as a divergence between today's margin
   * and the realised one, when nothing about the item had changed.
   */
  const side = (price: number, unitCost: number, perUnitRate: number): ItemMarginSide => {
    const grossPerUnit = price - unitCost;
    return {
      price,
      unitCost,
      grossPerUnit,
      marginPct: price > 0 ? (grossPerUnit / price) * 100 : 0,
      contributionPerUnit: grossPerUnit
        - price * resolved.revenueRate - perUnitRate - perOrderPerUnit,
    };
  };

  return items.map(item => {
    const menuItem = menuItems.find(m => m.id === item.menuItemId);
    const live = menuItem
      ? unitCostFor(menuItem, menuItems, assignments, stockItems)
      : null;
    const perUnitRate = resolved.perUnitCostFor(item.menuItemId);

    // A cost you can resolve does not make an ingredient cost you cannot: a
    // targeted cost lands on this item, and the recipe is still incomplete, so
    // the margin is still null rather than taken from a partial cost
    // (invariant 2).
    const today = menuItem && live?.complete && menuItem.price > 0
      ? side(menuItem.price, live.cost, perUnitRate)
      : null;

    const realised = item.costed && item.units > 0 && item.netRevenue > 0
      ? side(item.netRevenue / item.units, item.cogs / item.units, perUnitRate)
      : null;

    const divergencePct = today && realised && realised.grossPerUnit !== 0
      ? Math.abs(today.grossPerUnit - realised.grossPerUnit) / Math.abs(realised.grossPerUnit) * 100
      : null;

    return {
      menuItemId: item.menuItemId,
      name: item.name,
      today,
      missing: live?.missing ?? [],
      realised,
      sold: item.units,
      divergencePct,
      diverged: divergencePct !== null && divergencePct > DIVERGENCE_THRESHOLD_PCT,
    };
  });
}

export interface ItemBreakEven {
  menuItemId: string;
  name: string;
  /**
   * What one of these leaves behind after ingredients and every cost that
   * scales with a sale — per ticket, per item, and any share of takings — at
   * **today's** price and today's recipe — because a target is about what to do
   * next, and a target computed from last month's prices is not actionable.
   */
  contributionPerUnit: number;
  /** How many you would have to sell, on their own, to cover the fixed costs. */
  units: number;
  /** How many have sold in this period already. */
  sold: number;
  /** The two margins behind the figure, so the screen can show the divergence. */
  margin: ItemMargin;
}

/**
 * How many of one thing covers the day, from the margin it earns *today*.
 *
 * Items whose recipe is incomplete are absent rather than estimated: there is
 * no honest number to put on the tile, and a wrong one here is a wrong
 * instruction to somebody standing at a grill.
 */
export function breakEvenByItem(
  margins: ItemMargin[],
  costs: CostSummary,
  totals: Totals,
  scope: CostScope = 'range',
): ItemBreakEven[] {
  const resolved = resolveCosts(costs, totals, scope);
  if (resolved.fixed <= 0) return [];

  return margins
    .filter(margin => margin.today !== null && margin.today.contributionPerUnit > 0)
    .map(margin => ({
      menuItemId: margin.menuItemId,
      name: margin.name,
      contributionPerUnit: margin.today!.contributionPerUnit,
      units: resolved.fixed / margin.today!.contributionPerUnit,
      sold: margin.sold,
      margin,
    }))
    .filter(row => Number.isFinite(row.units))
    // Best earner first: the shortest route to covering the day.
    .sort((a, b) => a.units - b.units);
}

/**
 * What was spent on stock in a window, at what it actually cost.
 *
 * Separate from `foodCost`, which measures what was *consumed*. Money spent
 * stocking up for a market leaves the till whether or not it all sells, and a
 * stall owner asking "did today pay for itself" usually means the outlay, not
 * the portion that happened to be eaten.
 *
 * **A purchase is a receipt** (ADR-014): `added` and `packet`, and nothing
 * else. A `correction` is somebody reconciling the shelf with the book — it
 * carries no cost data and represents no money leaving the till. This is the
 * only definition of a purchase in the program; `foodCost` calls straight into
 * it rather than keeping a second one, which is how the two came to disagree
 * about the same delivery.
 *
 * **Effective rows only** (ADR-017). A delivery that was undone is not an
 * outlay, and both halves of the reversal carry `reversed`, so excluding them
 * needs no pairing and survives a ledger trim.
 */
export function stockPurchasesValue(
  movements: StockMovement[],
  stockItems: StockItem[],
  from: number,
  to: number,
): number {
  let total = 0;
  for (const m of effectiveMovements(movements)) {
    if (m.timestamp < from || m.timestamp >= to) continue;
    if (m.delta <= 0) continue;
    if (m.reason !== 'added' && m.reason !== 'packet') continue;
    const unit = m.unitCost ?? stockItems.find(s => s.id === m.stockItemId)?.costPerUnit ?? 0;
    total += m.totalCost ?? unit * m.delta;
  }
  return total;
}

export interface QueueBand {
  label: string;
  /** Inclusive lower bound in minutes. */
  from: number;
  /** Exclusive upper bound, or null for the open-ended top band. */
  to: number | null;
  orders: number;
  share: number;
}

/**
 * The spread of queue times, not just the middle of it.
 *
 * A median of six minutes with a long tail of twenty-minute waits is a different
 * service from a median of six minutes and nothing over ten, and no single
 * number distinguishes them. The bands are fixed rather than computed so the
 * shape stays comparable between sessions.
 */
export function queueBands(orders: Order[], range: DateRange): QueueBand[] {
  const edges: { label: string; from: number; to: number | null }[] = [
    { label: '<2 min', from: 0, to: 2 },
    { label: '2–5', from: 2, to: 5 },
    { label: '5–10', from: 5, to: 10 },
    { label: '10–20', from: 10, to: 20 },
    { label: '20+', from: 20, to: null },
  ];
  const bands: QueueBand[] = edges.map(e => ({ ...e, orders: 0, share: 0 }));
  let measured = 0;

  for (const order of orders) {
    if (order.voidedAt || !inRange(order, range)) continue;
    const ready = order.readyAt ?? order.completedAt;
    if (!ready || ready <= order.timestamp) continue;
    const minutes = (ready - order.timestamp) / 60000;
    measured += 1;
    const band = bands.find(b => minutes >= b.from && (b.to === null || minutes < b.to));
    if (band) band.orders += 1;
  }

  for (const band of bands) band.share = measured > 0 ? band.orders / measured : 0;
  return bands;
}

/* ------------------------------------------------------------- inventory */

export interface InventoryValue {
  total: number;
  /** Items with no cost recorded, so their stock is worth an unknown amount. */
  uncosted: number;
  items: { item: StockItem; value: number }[];
}

export function inventoryValue(stockItems: StockItem[]): InventoryValue {
  const items = stockItems.map(item => ({ item, value: item.quantity * (item.costPerUnit || 0) }));
  return {
    total: items.reduce((sum, r) => sum + r.value, 0),
    uncosted: stockItems.filter(s => !(s.costPerUnit > 0)).length,
    items: items.sort((a, b) => b.value - a.value),
  };
}

/**
 * Waste and stock-take shrinkage, valued at the item's cost.
 *
 * Economics, so it reads `effectiveMovements` (ADR-017): waste that was undone
 * was never thrown away, and an undone count is not a finding. A genuine
 * correction is not a reversal and still reaches this — that distinction is the
 * point of the two reasons being separate.
 */
export function shrinkageValue(
  movements: StockMovement[],
  stockItems: StockItem[],
  range: DateRange,
): { waste: number; variance: number } {
  let waste = 0;
  let variance = 0;
  for (const m of effectiveMovements(movements)) {
    if (m.timestamp < range.start || m.timestamp >= range.end) continue;
    if (m.delta >= 0) continue;
    const item = stockItems.find(s => s.id === m.stockItemId);
    const value = -m.delta * (item?.costPerUnit ?? 0);
    // Drained stock left without being sold, exactly like waste — counting it
    // anywhere else would make the end of a market look like free money.
    if (m.reason === 'waste' || m.reason === 'drained') waste += value;
    if (m.reason === 'stocktake') variance += value;
  }
  return { waste, variance };
}

/* ------------------------------------------------------------- sessions */

export interface SessionPerformance {
  sessionId: string;
  name: string;
  startedAt: number;
  totals: Totals;
  /** Wall-clock hours the session traded, pauses excluded. */
  tradingHours: number;
  /** Net revenue ÷ trading hours. Null when the session has not traded yet. */
  revenuePerHour: number | null;
}

/**
 * Per-session figures.
 *
 * Trading hours come from the session's own clock rather than from the hours in
 * which something happened to sell. A quiet hour in the middle of a market is
 * still an hour of standing there paying for the pitch, and counting only the
 * hours with sales in them would report a slow day as an efficient one.
 */
export function sessionPerformance(
  orders: Order[],
  sessions: TradingSession[],
  now = Date.now(),
): SessionPerformance[] {
  const byId = new Map<string, Order[]>();
  for (const order of orders) {
    if (!order.sessionId) continue;
    const list = byId.get(order.sessionId);
    if (list) list.push(order); else byId.set(order.sessionId, [order]);
  }

  return sessions
    .map(session => {
      const totals = totalsFor(byId.get(session.id) ?? []);
      const tradingHours = sessionTradingHours(session, now);
      return {
        sessionId: session.id,
        name: session.name,
        startedAt: session.startedAt,
        totals,
        tradingHours,
        revenuePerHour: tradingHours > 0 ? totals.netRevenue / tradingHours : null,
      };
    })
    .sort((a, b) => a.startedAt - b.startedAt);
}

export interface EventPerformance {
  eventId: string;
  name: string;
  startedAt: number;
  sessions: number;
  totals: Totals;
  tradingHours: number;
  revenuePerHour: number | null;
}

/**
 * Revenue by event.
 *
 * `groups` comes from `eventGroups`, which already presents an ungrouped
 * session as an event of one — so a business that never bothers grouping still
 * gets a complete chart rather than an empty one.
 */
export function eventPerformance(
  orders: Order[],
  groups: { id: string; name: string; sessions: TradingSession[]; startedAt: number }[],
  now = Date.now(),
): EventPerformance[] {
  return groups
    .map(group => {
      const ids = new Set(group.sessions.map(s => s.id));
      const members = orders.filter(o => o.sessionId !== undefined && ids.has(o.sessionId));
      const tradingHours = group.sessions.reduce(
        (sum, s) => sum + sessionTradingHours(s, now), 0);
      const totals = totalsFor(members);
      return {
        eventId: group.id,
        name: group.name,
        startedAt: group.startedAt,
        sessions: group.sessions.length,
        totals,
        tradingHours,
        revenuePerHour: tradingHours > 0 ? totals.netRevenue / tradingHours : null,
      };
    })
    .sort((a, b) => a.startedAt - b.startedAt);
}

/* ------------------------------------------------------------ break-even */

export interface CostSummary {
  /**
   * The total of `amount` within each basis, and only within it.
   *
   * Amounts are commensurable inside a basis and nowhere else: two per-ticket
   * costs of Rs 4 and Rs 2 are Rs 6 a ticket, while Rs 6 a ticket and 18% of
   * sales have no sum at all. Turning the four scaling bases into money for a
   * period needs the period's tickets, units and revenue, which is
   * `breakEven`'s job and is 1A-ii's work.
   */
  byBasis: Record<CostBasis, number>;
  /**
   * Rupees committed for the period whatever sells: `per-session` plus
   * `per-event`.
   *
   * The rate bases are deliberately absent. Adding Rs 4 a ticket in here as if
   * it were Rs 4 is the error the basis exists to stop — it produces a number
   * that looks like money, is not, and gets divided by revenue downstream.
   */
  total: number;
  entries: number;
  /**
   * The `per-unit` entries that name what they are charged against, kept apart
   * from the total so `resolveCosts` can spread each one over its own items.
   *
   * A summary carrying entry-level detail looks like a leak, and it is the
   * smaller of two evils: the alternative is a second path from entries to
   * money, and 1A-ii made `resolveCosts` the single place a `CostSummary` plus
   * a period's `Totals` becomes rupees precisely so the headline figure and the
   * per-item one cannot drift apart on how a rate is spread. Only the targeted
   * ones are here — an untargeted per-unit cost is fully described by
   * `byBasis['per-unit']` and needs no spreading.
   */
  perUnitTargets: { amount: number; appliesTo: CostAppliesTo }[];
}

const ZERO_BY_BASIS = (): Record<CostBasis, number> => ({
  'per-session': 0, 'per-event': 0, 'per-order': 0, 'per-unit': 0, 'per-revenue': 0,
});

/**
 * Totals a set of costs, one total per basis.
 *
 * Nothing is added across bases. The old summary returned `{ fixed, variable }`
 * and both were rupees, which is why a per-unit cost filed as variable could be
 * divided by revenue and treated as a rate — see ADR-012.
 */
export function costSummary(costs: CostEntry[]): CostSummary {
  const byBasis = ZERO_BY_BASIS();
  const perUnitTargets: { amount: number; appliesTo: CostAppliesTo }[] = [];
  for (const c of costs) {
    byBasis[c.basis] += c.amount;
    // A target only means anything on per-unit; `assertCostEntry` refuses it
    // elsewhere and the load path drops it, so reading the basis here is belt
    // and braces rather than a second rule (ADR-022).
    if (c.basis === 'per-unit' && c.appliesTo) {
      perUnitTargets.push({ amount: c.amount, appliesTo: c.appliesTo });
    }
  }
  const total = byBasis['per-session'] + byBasis['per-event'];
  return { byBasis, total, entries: costs.length, perUnitTargets };
}

/* ------------------------------------------------- resolving a cost to money */

/**
 * Which kind of period a figure is being taken over.
 *
 * The only thing this changes is what happens to a `per-event` cost, and it
 * changes it for one reason: a session inside an event must not be charged a
 * share of the event's own costs. See ADR-013.
 */
export type CostScope = 'range' | 'event' | 'session';

/**
 * A period's costs, resolved against that period's own volumes.
 *
 * This is the step ADR-012 said belonged here rather than in `costSummary`. An
 * amount only becomes money once the basis has something to be charged per, and
 * the period is what supplies it: tickets for `per-order`, units for
 * `per-unit`, revenue for `per-revenue`.
 *
 * Every one of these is a *rate*, taken from the cost entries themselves.
 * Nothing here is derived by dividing a rupee total by revenue-so-far, which is
 * the whole of what was wrong before — see ADR-012 and the note on `breakEven`.
 */
export interface ResolvedCosts {
  /** Rupees committed whatever sells, and the numerator of break-even. */
  fixed: number;
  /**
   * `per-event` rupees in scope that this figure deliberately does **not**
   * spread, because the scope is one session out of an event (ADR-013). Zero in
   * every other scope, where the event's costs are simply part of `fixed`.
   */
  heldEventCosts: number;
  /**
   * Rupees charged on every item sold, from `per-unit`, **blended** across the
   * period's sales mix. Ingredients are separate.
   *
   * This is the shop-level figure and the one `breakEven` divides by. A cost
   * that names particular items (ADR-022) contributes only the share of units
   * it actually reaches — a Rs 12 box on an item that is half of what sold adds
   * Rs 6 here — because the headline is about the average sale, and the average
   * sale is half a box.
   *
   * With nothing targeted this is exactly `byBasis['per-unit']`, unchanged from
   * before ADR-022. Per item, use `perUnitCostFor`.
   */
  perUnitCost: number;
  /**
   * The part of `perUnitCost` that every item carries regardless of target.
   *
   * Exposed because it is the floor `perUnitCostFor` builds on, and because a
   * blend is much easier to trust when the two halves it is made of can be read
   * separately.
   */
  perUnitCostUntargeted: number;
  /**
   * What one unit of a given menu item carries in `per-unit` costs: the
   * untargeted floor plus every targeted cost that names it.
   *
   * This is what `itemMargins` uses, so a burger carries its box and a drink
   * does not. Returns the blended figure for every item when the caller passed
   * no mix — see the note in `resolveCosts` on why that is the pessimistic
   * reading rather than the convenient one.
   */
  perUnitCostFor: (menuItemId: string) => number;
  /** Rupees charged on every ticket, from `per-order`. */
  perOrderCost: number;
  /** A true fraction of each rupee taken, from `per-revenue`. 0.18, not 18. */
  revenueRate: number;
  /**
   * Units per ticket, which is what turns a per-ticket cost into a per-unit
   * one. Null when there are no tickets to divide by — and null rather than
   * zero, because a per-order cost divided by zero is not a large number, it is
   * an unanswerable question (invariant 2's distinction, one layer up).
   */
  averageBasket: number | null;
}

/**
 * What sold, per menu item, with the category each item is in **now**.
 *
 * This is what lets a targeted `per-unit` cost be spread over the items it is
 * actually charged against. `categoryId` is resolved here and nowhere else:
 * `MenuItem.category` holds a category's *name* while `CostAppliesTo` stores
 * its *id*, and doing that join in one documented place is what stops a second
 * site from joining them the other way round and quietly matching nothing.
 */
export interface SalesMixEntry {
  menuItemId: string;
  /** The item's category by id, or undefined when it names none that exists. */
  categoryId?: string;
  units: number;
}

/**
 * Builds the mix from a period's item performance.
 *
 * Deals are already handled by `itemPerformance`, which credits a deal's
 * components with the units they represent — so a box charged to burgers is
 * charged to the burgers inside a meal deal too, which is what actually
 * happened at the grill.
 */
export function salesMix(
  items: ItemPerformance[],
  menuItems: MenuItem[],
  categories: Category[],
): SalesMixEntry[] {
  const idOfCategoryNamed = new Map(categories.map(c => [c.name, c.id]));
  return items.map(item => {
    const menuItem = menuItems.find(m => m.id === item.menuItemId);
    const categoryId = menuItem ? idOfCategoryNamed.get(menuItem.category) : undefined;
    return {
      menuItemId: item.menuItemId,
      ...(categoryId ? { categoryId } : {}),
      units: item.units,
    };
  });
}

/** Whether a targeted cost is charged against this item. */
function targetCovers(appliesTo: CostAppliesTo, entry: SalesMixEntry): boolean {
  return appliesTo.kind === 'items'
    ? appliesTo.ids.includes(entry.menuItemId)
    : entry.categoryId === appliesTo.id;
}

export function resolveCosts(
  costs: CostSummary,
  totals: Totals,
  scope: CostScope = 'range',
  mix: SalesMixEntry[] | null = null,
): ResolvedCosts {
  const eventCosts = costs.byBasis['per-event'];
  const allocated = scope !== 'session';

  /*
   * Per-unit costs, split into the part every item carries and the part that
   * only some do (ADR-022).
   *
   * `untargeted` is every per-unit cost that names nothing, which before this
   * phase was all of them — so with no targets anywhere, `blended` below is
   * exactly the old `byBasis['per-unit']` and the headline cannot move. That
   * equality is the regression this phase is most at risk of, and it holds by
   * construction rather than by arithmetic that happens to agree.
   */
  const targeted = costs.perUnitTargets;
  const untargeted = costs.byBasis['per-unit']
    - targeted.reduce((sum, t) => sum + t.amount, 0);

  const byItem = new Map<string, number>();
  let blendedExtra = 0;

  /*
   * A mix of `null` means the caller does not know what sold, which is not the
   * same as nothing having sold. A targeted cost is then charged in full, to
   * every item — the pre-ADR-022 reading, and the pessimistic one. Spreading it
   * to zero instead would be the flattering answer produced automatically on
   * data nobody looked at, which is invariant 2's failure one layer up.
   */
  if (mix === null) {
    for (const t of targeted) blendedExtra += t.amount;
  } else {
    const totalUnits = mix.reduce((sum, e) => sum + e.units, 0);
    for (const t of targeted) {
      let coveredUnits = 0;
      for (const entry of mix) {
        if (!targetCovers(t.appliesTo, entry)) continue;
        coveredUnits += entry.units;
        byItem.set(entry.menuItemId, (byItem.get(entry.menuItemId) ?? 0) + t.amount);
      }
      // Weighted by the share of units it actually reaches. A cost on an item
      // that is half of what sold contributes half its rate to the headline.
      //
      // This is the same kind of quantity as `averagePrice` and
      // `averageBasket` — a property of the average sale — and not the circular
      // rate ADR-012 removed, which divided a fixed rupee total by revenue so
      // far and so had no bound. A blend of per-item rates never leaves the
      // range of those rates, whatever the day does.
      if (totalUnits > 0) blendedExtra += t.amount * (coveredUnits / totalUnits);
    }
  }

  const perUnitCost = untargeted + blendedExtra;

  return {
    fixed: costs.byBasis['per-session'] + (allocated ? eventCosts : 0),
    heldEventCosts: allocated ? 0 : eventCosts,
    perUnitCost,
    perUnitCostUntargeted: untargeted,
    perUnitCostFor: (menuItemId: string) => mix === null
      ? perUnitCost
      : untargeted + (byItem.get(menuItemId) ?? 0),
    perOrderCost: costs.byBasis['per-order'],
    revenueRate: costs.byBasis['per-revenue'] / 100,
    averageBasket: totals.orders > 0 ? totals.units / totals.orders : null,
  };
}

/**
 * Why a break-even figure is unavailable.
 *
 * Exported because the screen branches on them and `metrics.check.ts` asserts
 * each one is reachable; a string compared in three places is a string that
 * eventually gets a comma moved in one of them.
 */
export const BREAK_EVEN_BLOCKED = {
  noCostedSales: 'Needs costed sales',
  noFixedCosts: 'No fixed costs logged',
  negativeContribution: 'Costs exceed the margin — no volume breaks even',
  noBasket: 'Needs a ticket count to spread the per-order costs',
  // Only `breakEvenCrossing` uses this one. Break-even revenue is a target and
  // is always answerable; a crossing is a measurement, and "it has not happened
  // yet" is a real answer rather than a missing one. `remaining` carries how far
  // there is to go, so the column reads "Rs 4,300 to go" and not an em dash.
  notYet: 'Not yet — the period has not covered its costs',
} as const;

export interface BreakEven {
  /** Rupees to cover: `per-session` plus, unless held back, `per-event`. */
  fixedCosts: number;
  /**
   * `per-event` rupees in scope that this figure does not cover, because the
   * scope is one session out of an event. The event carries them (ADR-013).
   */
  heldEventCosts: number;
  /** Net revenue ÷ units. The average thing sold, which is what is priced. */
  averagePrice: number | null;
  /** Ingredients plus `per-unit` costs, for one of that average thing. */
  perUnitCost: number | null;
  /** `per-order` rupees, charged once a ticket. */
  perOrderCost: number;
  /** `per-revenue` costs as a fraction of each rupee taken. */
  revenueRate: number;
  /** Units per ticket, which is what spreads `perOrderCost` over units. */
  averageBasket: number | null;
  /** Share of each rupee of revenue left after every cost that scales with it. */
  contributionRatio: number | null;
  /** Rupees of contribution per unit sold. */
  contributionPerUnit: number | null;
  revenue: number | null;
  units: number | null;
  /** Net revenue ÷ break-even revenue, 0..n. Null when break-even is unknown. */
  progress: number | null;
  /** Why the figure is unavailable, when it is. */
  blocked?: string;
}

/**
 * What has to be sold before the day pays for itself.
 *
 * Break-even is committed rupees ÷ contribution. Contribution is what one sale
 * leaves behind after every cost that scales with it, and each of those costs
 * is resolved against the volume its own basis names:
 *
 * ```
 * fixed               = Σ per-session + Σ per-event
 * perUnitCost         = ingredients per unit + Σ per-unit
 * perOrderCost        = Σ per-order
 * revenueRate         = Σ per-revenue ÷ 100
 * contributionPerUnit = price × (1 − revenueRate) − perUnitCost
 *                                                 − perOrderCost ÷ avgBasket
 * breakEvenUnits      = fixed ÷ contributionPerUnit
 * breakEvenRevenue    = fixed ÷ contributionRatio
 * ```
 *
 * **What this replaces, and why it mattered.** The previous version had no
 * rates to work from — every non-fixed cost was one word, `variable` — so it
 * manufactured one: it took the typed rupee total of those costs and divided it
 * by *revenue so far*. That is a circle. At Rs 4,000 of sales a Rs 1,200 fuel
 * bill is a 30% drag and break-even is unreachable; at Rs 20,000 the same bill
 * is 6% and break-even has already been passed. The target therefore moved as
 * the day went on, on identical facts, and moved in the flattering direction. A
 * number that depends on when you read it is not a target. Every ratio above is
 * a property of the cost entries and the average sale, so the target holds
 * still while the day fills up underneath it — which is what
 * `metrics.check.ts`'s "the target does not move" case exists to hold.
 *
 * Ingredient cost per unit is taken over the *costed* lines and then applied to
 * the average price, rather than dividing total COGS by total units. Dividing
 * by all units would charge the uncosted ones at zero, which is invariant 2's
 * exact failure and reports the flattering answer.
 *
 * Four things can make this unanswerable, and each is reported rather than
 * papered over with a zero:
 *
 *  - no costed sales, so contribution cannot be measured at all;
 *  - no fixed costs logged, so there is nothing to break even against;
 *  - contribution at or below zero, where no volume ever breaks even;
 *  - contribution otherwise positive, but no tickets to divide the per-order
 *    costs by. Left alone that division is an infinity, which would surface as
 *    "costs exceed the margin" — a wrong explanation for a missing denominator.
 */
export function breakEven(
  totals: Totals,
  costs: CostSummary,
  scope: CostScope = 'range',
  mix: SalesMixEntry[] | null = null,
): BreakEven {
  const resolved = resolveCosts(costs, totals, scope, mix);
  const base: BreakEven = {
    fixedCosts: resolved.fixed,
    heldEventCosts: resolved.heldEventCosts,
    averagePrice: null,
    perUnitCost: null,
    perOrderCost: resolved.perOrderCost,
    revenueRate: resolved.revenueRate,
    averageBasket: resolved.averageBasket,
    contributionRatio: null,
    contributionPerUnit: null,
    revenue: null,
    units: null,
    progress: null,
  };

  if (totals.costedRevenue <= 0 || totals.units <= 0) {
    return { ...base, blocked: BREAK_EVEN_BLOCKED.noCostedSales };
  }

  const averagePrice = totals.netRevenue / totals.units;
  // The share of a costed rupee that goes on ingredients, applied to the
  // average price. Over the costed lines on both sides, so an uncosted line
  // neither raises nor lowers it.
  const cogsRatio = totals.cogs / totals.costedRevenue;
  const perUnitCost = averagePrice * cogsRatio + resolved.perUnitCost;
  const contributionBeforeTickets = averagePrice * (1 - resolved.revenueRate) - perUnitCost;
  const withPrice = { ...base, averagePrice, perUnitCost };

  if (resolved.fixed <= 0) {
    return { ...withPrice, blocked: BREAK_EVEN_BLOCKED.noFixedCosts };
  }

  // A per-ticket cost with no tickets to spread over is unanswerable, not
  // enormous. Reported on its own so it cannot be read as a margin problem.
  if (resolved.perOrderCost > 0 && !(resolved.averageBasket !== null && resolved.averageBasket > 0)) {
    return {
      ...withPrice,
      blocked: contributionBeforeTickets > 0
        ? BREAK_EVEN_BLOCKED.noBasket
        : BREAK_EVEN_BLOCKED.negativeContribution,
    };
  }

  const perOrderPerUnit = resolved.perOrderCost > 0
    ? resolved.perOrderCost / resolved.averageBasket!
    : 0;
  const contributionPerUnit = contributionBeforeTickets - perOrderPerUnit;
  const contributionRatio = contributionPerUnit / averagePrice;

  if (contributionPerUnit <= 0) {
    return {
      ...withPrice,
      contributionRatio,
      contributionPerUnit,
      blocked: BREAK_EVEN_BLOCKED.negativeContribution,
    };
  }

  const units = resolved.fixed / contributionPerUnit;
  const revenue = resolved.fixed / contributionRatio;
  return {
    ...withPrice,
    contributionRatio,
    contributionPerUnit,
    revenue,
    units,
    progress: revenue > 0 ? totals.netRevenue / revenue : null,
  };
}

/* ------------------------------------- when the period paid for itself */

/**
 * What one ticket's `per-unit` costs come to (ADR-022).
 *
 * A **deal** charges its components, not itself. `itemPerformance` credits a
 * deal's components with the units they represent, and `salesMix` is built from
 * that — so a box charged to burgers has to reach the burger inside a meal deal
 * here too, or the crossing and the blended rate would disagree about the same
 * deal while both claiming to be about per-unit costs.
 *
 * Exported so it can be checked on its own; nothing else should need it.
 */
export function perUnitChargeOf(
  order: Order,
  menuItems: MenuItem[],
  rateFor: (menuItemId: string) => number,
): number {
  let charge = 0;
  for (const item of order.items) {
    if (item.dealItems?.length) {
      for (const component of item.dealItems) {
        const sub = resolveDealComponent(component, menuItems);
        if (!sub) continue;
        charge += rateFor(sub.id) * component.quantity * item.quantity;
      }
    } else {
      charge += rateFor(item.menuItemId) * item.quantity;
    }
  }
  return charge;
}

export interface BreakEvenCrossing {
  /**
   * The ticket that took the period past its costs, or `null` if it has not got
   * there. No display decision is made here — the lifetime number and the
   * kitchen's number are both returned, because which one a screen wants
   * depends on whether it is showing a live session (see `displayNumber`).
   */
  order: {
    id: string;
    /** The lifetime sequence, which is what History · Orders shows. */
    number: string;
    /** The kitchen's number within its session, when it has one. */
    sessionTicket?: number;
    at: number;
  } | null;
  /** Contribution banked by the end of that ticket. Null when not crossed. */
  contributionAt: number | null;
  /** Rupees that had to be covered — `ResolvedCosts.fixed`. */
  fixedCosts: number;
  /** Contribution banked across the whole period. */
  contribution: number;
  /** Still to cover. Zero once crossed. */
  remaining: number;
  /**
   * Share of the period's tickets that carried a complete ingredient cost,
   * 0..1. Below 1 the true crossing may be **earlier** than the one reported —
   * see the note on uncosted tickets below.
   */
  coverage: number;
  /** Per-event rupees left out of `fixedCosts` in a session scope (ADR-013). */
  heldEventCosts: number;
  /** Why there is no crossing to report, when there is not. */
  blocked?: string;
}

/**
 * The ticket and the moment a period covered its costs.
 *
 * Break-even revenue says *how much* has to be taken. This says *when it was*,
 * which is the question a shop actually asks at the end of a market — and it is
 * the one figure on the Finance table that is a fact about the past rather than
 * a target for the future.
 *
 * **Each ticket is charged on its own terms, and that is the whole design.**
 * Contribution for one order is
 *
 * ```
 *   netRevenue
 *     − cogs                                  frozen at checkout (invariant 3)
 *     − netRevenue × revenueRate               per-revenue
 *     − perOrderCost                           per-order, one ticket
 *     − Σ lines: perUnitCostFor(item) × qty    per-unit, deals credited
 * ```
 *
 * Every term is a property of *that ticket* and of the **cost rates**, which
 * come from the cost entries. Nothing here divides by a period average — not
 * `averagePrice`, not `averageBasket`, not `cogsRatio`. So the running total
 * after ticket *N* depends on tickets 1..N and nothing else, and ringing up
 * ticket *N+1* cannot move a crossing that has already happened.
 *
 * That is stronger than `breakEven` manages. Break-even revenue is a target and
 * is allowed to shift as the day's average sale changes; a crossing is a
 * measurement, and a measurement that slid backwards as the afternoon went on
 * would be the ADR-012 defect wearing a different hat. It does still move when
 * the shop **logs a cost later** — the day genuinely cost more than was
 * recorded — which is correct, and is the only thing that may move it. See
 * ADR-024.
 *
 * **An uncosted ticket contributes nothing.** A line with no `unitCost` has no
 * knowable margin, and reading the missing cost as zero would make that ticket's
 * contribution too large and the crossing too early — invariant 2's failure, in
 * the flattering direction, on exactly the data nobody can check. Skipping the
 * ticket errs the other way: the crossing reported is never earlier than the
 * truth, so a screen can honestly say *"passed at ticket 34 — or earlier; 6% of
 * tickets carry no ingredient cost"*. `coverage` is returned so it can say that
 * without walking the orders again.
 *
 * Voided orders are skipped outright (invariant 5), so voiding the ticket that
 * caused the crossing correctly moves it on to the next one.
 */
export function breakEvenCrossing(
  orders: Order[],
  menuItems: MenuItem[],
  costs: CostSummary,
  totals: Totals,
  scope: CostScope = 'range',
  mix: SalesMixEntry[] | null = null,
): BreakEvenCrossing {
  const resolved = resolveCosts(costs, totals, scope, mix);
  const base: BreakEvenCrossing = {
    order: null,
    contributionAt: null,
    fixedCosts: resolved.fixed,
    contribution: 0,
    remaining: resolved.fixed,
    coverage: 0,
    heldEventCosts: resolved.heldEventCosts,
  };

  if (resolved.fixed <= 0) {
    return { ...base, blocked: BREAK_EVEN_BLOCKED.noFixedCosts };
  }

  // Oldest first, and sorted here rather than trusted from the caller: a
  // crossing read off an arbitrary sequence is not a fact about anything.
  const chronological = orders
    .filter(o => !o.voidedAt)
    .sort((a, b) => a.timestamp - b.timestamp);

  let running = 0;
  let costedTickets = 0;
  let crossing: BreakEvenCrossing['order'] = null;
  let contributionAt: number | null = null;

  for (const order of chronological) {
    const money = orderMoney(order);
    // Every line, or the ticket sits this out. A partly costed ticket has no
    // honest contribution and is not worth guessing at.
    if (money.costCoverage < 1) continue;
    costedTickets += 1;

    const contribution = money.netRevenue
      - money.cogs
      - money.netRevenue * resolved.revenueRate
      - resolved.perOrderCost
      - perUnitChargeOf(order, menuItems, id => resolved.perUnitCostFor(id));

    running += contribution;
    if (crossing === null && running >= resolved.fixed) {
      crossing = {
        id: order.id,
        number: order.orderNumber,
        ...(order.sessionTicket !== undefined ? { sessionTicket: order.sessionTicket } : {}),
        at: order.timestamp,
      };
      contributionAt = running;
    }
  }

  const settled: BreakEvenCrossing = {
    ...base,
    order: crossing,
    contributionAt,
    contribution: running,
    remaining: Math.max(0, resolved.fixed - running),
    coverage: chronological.length > 0 ? costedTickets / chronological.length : 0,
  };

  if (costedTickets === 0) {
    return { ...settled, blocked: BREAK_EVEN_BLOCKED.noCostedSales };
  }
  if (crossing !== null) return settled;
  // Not crossed, and the two reasons are worth telling apart: one is a day that
  // has not sold enough yet, the other is a menu that never will.
  return {
    ...settled,
    blocked: running > 0
      ? BREAK_EVEN_BLOCKED.notYet
      : BREAK_EVEN_BLOCKED.negativeContribution,
  };
}

/* ------------------------------------------------------- the finance table */

export interface FinanceRow {
  /** The session or event id. Unique within the table. */
  id: string;
  /**
   * What the row is about.
   *
   * `event` rows total the sessions above them and are the only place a
   * `per-event` cost is charged rather than held (ADR-013). `unassigned` is
   * orders taken before sessions existed, or outside one — never guessed into a
   * session by timestamp (invariant 4).
   */
  kind: 'session' | 'event' | 'unassigned';
  name: string;
  /** When the row's trading started. Null for `unassigned`, which has no span. */
  startedAt: number | null;
  totals: Totals;
  /**
   * Rupees committed for this row whatever sells: `per-session`, plus
   * `per-event` only on an event row.
   */
  operatingCosts: number;
  /** Per-event rupees this row leaves to its event (ADR-013). Zero on an event row. */
  heldEventCosts: number;
  /**
   * Net revenue less ingredients less operating costs.
   *
   * **Null when nothing in the row carries a cost.** Subtracting a known
   * operating cost from a revenue whose ingredients are unknown produces a
   * number that looks like profit and is not — invariant 2, one layer up from
   * the line it protects.
   */
  netProfit: number | null;
  /** `netProfit` over net revenue, as a percentage. Null for the same reason. */
  netMarginPct: number | null;
  breakEven: BreakEven;
  crossing: BreakEvenCrossing;
}

/**
 * One row per session, and an event row that totals them.
 *
 * The row axis is the caller's decision, because only the caller knows the
 * scope: a date window rows the sessions that traded in it, an event rows its
 * members and then itself, and a single session rows itself and then the market
 * it belongs to. What this function owns is what a row *says* once it exists,
 * so that all three cases produce the same arithmetic.
 *
 * **Each row resolves its own costs at its own scope.** A session row is
 * `'session'`, so the market's pitch fee is held rather than shared out and
 * lands in `heldEventCosts`; the event row is `'event'`, where the period
 * genuinely does owe it. That is ADR-013 as a table: the held figure stops
 * being a footnote under a KPI and becomes a cell you can read next to the
 * session's own costs. Neither row double-counts, because the session's
 * `operatingCosts` never includes the event's.
 */
export function financeRows(input: {
  /** The sessions to draw a row for, in the order they should appear. */
  sessions: TradingSession[];
  /** An event to total them with, when the scope has one. */
  event?: { id: string; name: string; sessions: TradingSession[] } | null;
  /** Every order in scope, including those belonging to no session. */
  orders: Order[];
  /** Every cost entry in scope. */
  costs: CostEntry[];
  menuItems: MenuItem[];
  mix: SalesMixEntry[] | null;
  /** True on a date scope, where orders outside any session get their own row. */
  includeUnassigned?: boolean;
  now: number;
}): FinanceRow[] {
  const { sessions, event, orders, costs, menuItems, mix, now } = input;

  const build = (
    id: string,
    kind: FinanceRow['kind'],
    name: string,
    startedAt: number | null,
    rowOrders: Order[],
    rowCosts: CostEntry[],
    scope: CostScope,
  ): FinanceRow => {
    const totals = totalsFor(rowOrders);
    const summary = costSummary(rowCosts);
    const resolved = resolveCosts(summary, totals, scope, mix);
    const be = breakEven(totals, summary, scope, mix);
    const crossing = breakEvenCrossing(rowOrders, menuItems, summary, totals, scope, mix);

    // Ingredients are only known for the costed part of the period. Reporting a
    // profit over a revenue whose cost is partly unknown is the flattering
    // answer produced automatically, so it is withheld instead.
    const known = totals.costedRevenue > 0 || totals.cogs > 0;
    const netProfit = known
      ? totals.netRevenue - totals.cogs - resolved.fixed
      : null;

    return {
      id,
      kind,
      name,
      startedAt,
      totals,
      operatingCosts: resolved.fixed,
      heldEventCosts: resolved.heldEventCosts,
      netProfit,
      netMarginPct: netProfit !== null && totals.netRevenue > 0
        ? (netProfit / totals.netRevenue) * 100
        : null,
      breakEven: be,
      crossing,
    };
  };

  const rows: FinanceRow[] = sessions.map(session => build(
    session.id,
    'session',
    session.name,
    session.startedAt,
    ordersForSession(orders, session.id),
    // A session's costs are its own, plus the event's so that `'session'` scope
    // can hold them back and report them. Without the second half the row would
    // not know there was anything to hold.
    costs.filter(c => (
      c.sessionId === session.id
      || (session.eventId !== undefined && c.eventId === session.eventId)
    )),
    'session',
  ));

  if (input.includeUnassigned) {
    const loose = orders.filter(o => o.sessionId === undefined);
    if (loose.length > 0) {
      rows.push(build(
        'unassigned',
        'unassigned',
        'Not in a session',
        null,
        loose,
        // Dated costs: logged outside any session and belonging to no event.
        costs.filter(c => c.sessionId === undefined && c.eventId === undefined),
        'range',
      ));
    }
  }

  if (event) {
    const ids = new Set(event.sessions.map(s => s.id));
    rows.push(build(
      event.id,
      'event',
      event.name,
      event.sessions.length > 0 ? event.sessions[0].startedAt : null,
      ordersForSessions(orders, ids),
      costsForEvent(costs, event.id, ids),
      'event',
    ));
  }

  // `now` is taken and unused on purpose: every figure above is a fact about a
  // period that has already been fixed by the scope, and a finance row that
  // moved with the clock would put ADR-009's tick back into the memo wall. It
  // stays in the signature so a later column that genuinely needs it — a live
  // session's elapsed hours — does not have to change every call site.
  void now;
  return rows;
}

/* ------------------------------------------------------------ void rate */

export interface VoidStats {
  voided: number;
  live: number;
  /** Voided ÷ all tickets rung up, as a percentage. */
  byCountPct: number;
  /** Value that was rung up and then cancelled. */
  voidedValue: number;
  /** Voided value ÷ (voided value + net revenue), as a percentage. */
  byValuePct: number;
}

/**
 * How much of what was rung up did not stay sold.
 *
 * Reported by count and by value, because they answer different questions: a
 * 2% void rate made of the day's three largest orders is not a small problem,
 * and a count alone hides that. The app has no separate refund concept — a
 * cancelled sale is a void whether or not money had changed hands — so this is
 * the whole of it.
 */
export function voidStats(orders: Order[]): VoidStats {
  let voided = 0;
  let live = 0;
  let voidedValue = 0;
  let liveValue = 0;

  for (const order of orders) {
    if (order.voidedAt) {
      voided += 1;
      voidedValue += Math.max(0, (order.subtotal ?? 0) - (order.discountAmount ?? 0));
    } else {
      live += 1;
      liveValue += orderMoney(order).netRevenue;
    }
  }

  const tickets = voided + live;
  const value = voidedValue + liveValue;
  return {
    voided,
    live,
    byCountPct: tickets > 0 ? (voided / tickets) * 100 : 0,
    voidedValue,
    byValuePct: value > 0 ? (voidedValue / value) * 100 : 0,
  };
}

/* ------------------------------------------------------- attachment rate */

export interface ItemPair {
  aId: string;
  bId: string;
  aName: string;
  bName: string;
  /** Orders containing both. */
  together: number;
  /** Orders containing A that also contain B, as a percentage. */
  attachmentPct: number;
  /** Reverse direction, for reading the pair the other way round. */
  reverseAttachmentPct: number;
  /**
   * How much more often they appear together than they would by chance. 1.0 is
   * coincidence; above 1 is a real association.
   */
  lift: number;
}

/**
 * Which products get bought together.
 *
 * Attachment is directional — 90% of chips orders include a burger, while 20%
 * of burger orders include chips — so both directions are kept and the caller
 * decides which reads better.
 *
 * Lift is what stops the table filling up with the two bestsellers. Two popular
 * items co-occur constantly without being related at all; lift divides that out
 * by asking whether they appear together more often than their individual
 * popularity would predict.
 */
export function attachmentPairs(
  orders: Order[],
  menuItems: MenuItem[],
  range: DateRange,
  minTogether = 2,
): ItemPair[] {
  const names = new Map(menuItems.map(m => [m.id, m.name]));
  const single = new Map<string, number>();
  const pairs = new Map<string, number>();
  let baskets = 0;

  for (const order of orders) {
    if (order.voidedAt || !inRange(order, range)) continue;
    const ids = [...new Set(order.items.map(i => i.menuItemId))].sort();
    if (ids.length === 0) continue;
    baskets += 1;
    for (const id of ids) single.set(id, (single.get(id) ?? 0) + 1);
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        const key = `${ids[i]}|${ids[j]}`;
        pairs.set(key, (pairs.get(key) ?? 0) + 1);
      }
    }
  }

  if (baskets === 0) return [];

  const rows: ItemPair[] = [];
  for (const [key, together] of pairs) {
    if (together < minTogether) continue;
    const [aId, bId] = key.split('|');
    const aCount = single.get(aId) ?? 0;
    const bCount = single.get(bId) ?? 0;
    if (aCount === 0 || bCount === 0) continue;
    const expected = (aCount / baskets) * (bCount / baskets) * baskets;
    rows.push({
      aId,
      bId,
      aName: names.get(aId) ?? aId,
      bName: names.get(bId) ?? bId,
      together,
      attachmentPct: (together / aCount) * 100,
      reverseAttachmentPct: (together / bCount) * 100,
      lift: expected > 0 ? together / expected : 0,
    });
  }

  return rows.sort((a, b) => b.together - a.together);
}

/* ------------------------------------------------------ popularity trend */

export interface TrendPoint {
  bucketId: string;
  label: string;
  units: number;
  rank: number | null;
}

export interface PopularityTrend {
  menuItemId: string;
  name: string;
  points: TrendPoint[];
  latestUnits: number;
  previousUnits: number;
  /** Change in units from the previous bucket to the latest, as a percentage. */
  changePct: number | null;
  /** Positive means the item climbed the table. Null when it is new. */
  rankDelta: number | null;
}

/**
 * How each product's popularity moves from one session to the next.
 *
 * Bucketed by session rather than by calendar, because this business trades on
 * event days: two markets a fortnight apart are consecutive services, and a
 * weekly chart of them is mostly zeroes with two spikes in it.
 *
 * Rank is tracked alongside units because volume varies with footfall. An item
 * selling half as much at a quiet market has not fallen out of favour; one that
 * slid from second place to eighth has.
 */
export function popularityTrend(
  orders: Order[],
  menuItems: MenuItem[],
  buckets: { id: string; label: string; sessionIds: string[] }[],
  limit = 8,
): PopularityTrend[] {
  const names = new Map(menuItems.map(m => [m.id, m.name]));
  const perBucket: Map<string, number>[] = [];

  for (const bucket of buckets) {
    const ids = new Set(bucket.sessionIds);
    const units = new Map<string, number>();
    for (const order of orders) {
      if (order.voidedAt || !order.sessionId || !ids.has(order.sessionId)) continue;
      for (const item of order.items) {
        const isDeal = Boolean(item.dealItems?.length);
        if (!isDeal) {
          units.set(item.menuItemId, (units.get(item.menuItemId) ?? 0) + item.quantity);
          continue;
        }
        // A deal's units belong to what it is made of — "how many burgers went
        // out" has to include the ones inside deals.
        for (const component of item.dealItems!) {
          const sub = resolveDealComponent(component, menuItems);
          if (!sub) continue;
          units.set(sub.id, (units.get(sub.id) ?? 0) + component.quantity * item.quantity);
        }
      }
    }
    perBucket.push(units);
  }

  const ranks = perBucket.map(units => {
    const order = [...units.entries()].sort((a, b) => b[1] - a[1]);
    return new Map(order.map(([id], index) => [id, index + 1]));
  });

  const allIds = new Set<string>();
  perBucket.forEach(units => units.forEach((_, id) => allIds.add(id)));

  const rows: PopularityTrend[] = [...allIds].map(id => {
    const points: TrendPoint[] = buckets.map((bucket, index) => ({
      bucketId: bucket.id,
      label: bucket.label,
      units: perBucket[index].get(id) ?? 0,
      rank: ranks[index].get(id) ?? null,
    }));
    const latest = points[points.length - 1];
    const previous = points.length > 1 ? points[points.length - 2] : undefined;
    const latestRank = latest?.rank ?? null;
    const previousRank = previous?.rank ?? null;

    return {
      menuItemId: id,
      name: names.get(id) ?? id,
      points,
      latestUnits: latest?.units ?? 0,
      previousUnits: previous?.units ?? 0,
      changePct: previous && previous.units > 0
        ? (((latest?.units ?? 0) - previous.units) / previous.units) * 100
        : null,
      // A smaller rank number is a better position, so the sign is flipped to
      // make "positive means climbing" true.
      rankDelta: latestRank !== null && previousRank !== null ? previousRank - latestRank : null,
    };
  });

  return rows
    .sort((a, b) => b.latestUnits - a.latestUnits || b.previousUnits - a.previousUnits)
    .slice(0, limit);
}

/* ---------------------------------------------------------- stock health */

export interface StockoutStats {
  /** Items that ran to zero at least once in the period. */
  itemsOut: number;
  /** Items that moved at all, and so could have run out. */
  itemsTracked: number;
  /** Items out ÷ items tracked, as a percentage. */
  ratePct: number;
  /** Distinct times an item crossed to zero. */
  occasions: number;
  /** Sales the stock on hand could not support. */
  oversoldUnits: number;
  worst: { stockItemId: string; name: string; occasions: number }[];
}

/**
 * How often the kitchen ran out.
 *
 * Two independent measures, because they miss different things. Crossings to
 * zero come from the stock ledger and catch every run-out, including the ones
 * nobody tried to sell through. Oversells are recorded at the till and catch
 * demand that arrived anyway — the more expensive half, and the half that
 * inferring stockouts from flat sales curves never sees.
 */
export function stockoutStats(
  movements: StockMovement[],
  stockItems: StockItem[],
  oversells: OversellEvent[],
  range: DateRange,
): StockoutStats {
  const names = new Map(stockItems.map(s => [s.id, s.name]));
  const lastLevel = new Map<string, number>();
  const crossings = new Map<string, number>();
  const tracked = new Set<string>();

  // Replay in order: only a transition from positive to zero is a stockout.
  // Counting every line that sits at zero would report one run-out as a dozen.
  for (const m of [...movements].sort((a, b) => a.timestamp - b.timestamp)) {
    const previous = lastLevel.get(m.stockItemId);
    lastLevel.set(m.stockItemId, m.resulting);
    if (m.timestamp < range.start || m.timestamp >= range.end) continue;
    tracked.add(m.stockItemId);
    if (m.resulting <= 0 && (previous === undefined || previous > 0)) {
      crossings.set(m.stockItemId, (crossings.get(m.stockItemId) ?? 0) + 1);
    }
  }

  const oversoldUnits = oversells
    .filter(e => e.timestamp >= range.start && e.timestamp < range.end)
    .reduce((sum, e) => sum + e.quantity, 0);

  const worst = [...crossings.entries()]
    .map(([stockItemId, occasions]) => ({
      stockItemId,
      name: names.get(stockItemId) ?? stockItemId,
      occasions,
    }))
    .sort((a, b) => b.occasions - a.occasions)
    .slice(0, 5);

  return {
    itemsOut: crossings.size,
    itemsTracked: tracked.size,
    ratePct: tracked.size > 0 ? (crossings.size / tracked.size) * 100 : 0,
    occasions: [...crossings.values()].reduce((n, v) => n + v, 0),
    oversoldUnits,
    worst,
  };
}

/**
 * `YYYY-MM-DD` in local time, matching how snapshots are written.
 *
 * Snapshots are whole-day facts, so they are compared by day rather than by
 * instant. Turning a date into a midnight timestamp and testing it against a
 * range that starts at nine in the morning is false precision: it drops the
 * very snapshot that describes the morning's opening stock.
 */
function localDateKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export interface TurnoverStats {
  /** Cost of goods sold in the period. */
  cogs: number;
  /** Mean inventory value across the period's daily snapshots. */
  averageInventory: number | null;
  /** COGS ÷ average inventory. Times the shelf emptied and refilled. */
  turns: number | null;
  /** How long the stock on hand lasts at this rate. */
  daysOfStock: number | null;
  blocked?: string;
}

/**
 * How fast stock moves.
 *
 * Average inventory comes from the daily snapshots rather than from opening and
 * closing alone: a stall that buys in on Friday and sells out on Sunday has an
 * opening and closing value that describe neither.
 *
 * It reads no stock movements, so there is nothing here for
 * `effectiveMovements` to filter. Both inputs are already effective by
 * construction: `totals.cogs` is the sum of frozen line costs on live orders,
 * and a snapshot is a measurement of the shelf, which a reversal genuinely
 * moved. Named because ADR-017 lists this among the economic figures and a
 * reader will come looking for the call that is not here.
 */
export function inventoryTurnover(
  totals: Totals,
  snapshots: InventorySnapshot[],
  stockItems: StockItem[],
  range: DateRange,
): TurnoverStats {
  const firstDay = localDateKey(range.start);
  const lastDay = localDateKey(Math.max(range.start, range.end - 1));
  const days = new Map<string, number>();
  for (const snap of snapshots) {
    if (snap.date < firstDay || snap.date > lastDay) continue;
    days.set(snap.date, (days.get(snap.date) ?? 0) + snap.value);
  }

  // No snapshot in the window is normal for a short scope; fall back to the
  // level on hand, which is at least a measurement of something real.
  const values = [...days.values()];
  const current = inventoryValue(stockItems).total;
  const averageInventory = values.length > 0
    ? values.reduce((a, b) => a + b, 0) / values.length
    : (current > 0 ? current : null);

  if (totals.cogs <= 0) {
    return { cogs: totals.cogs, averageInventory, turns: null, daysOfStock: null, blocked: 'Needs costed sales' };
  }
  if (!averageInventory || averageInventory <= 0) {
    return { cogs: totals.cogs, averageInventory, turns: null, daysOfStock: null, blocked: 'Needs stock values' };
  }

  const turns = totals.cogs / averageInventory;
  const spanDays = Math.max(1, (range.end - range.start) / DAY);
  return {
    cogs: totals.cogs,
    averageInventory,
    turns,
    daysOfStock: turns > 0 ? spanDays / turns : null,
  };
}

export interface DeadStockItem {
  stockItem: StockItem;
  /** Last time this item was consumed by a sale. Null if it never has been. */
  lastSoldAt: number | null;
  /** First time it appears in the ledger — how long we have known about it. */
  knownSince: number | null;
  idleDays: number | null;
  value: number;
}

/**
 * Stock that is not moving.
 *
 * Idleness is measured from the last sale, or from the day the item was first
 * logged if it has never sold at all — which is the worse case, and would be
 * invisible if items with no sales were skipped for having no date to measure
 * from.
 *
 * Reads `effectiveMovements` (ADR-017). A sale that was undone is not evidence
 * the item moved, and an undone receipt is not evidence we have known about it
 * since then — both would make dead stock look alive.
 */
export function deadStock(
  stockItems: StockItem[],
  movements: StockMovement[],
  now = Date.now(),
  limit = 2,
): DeadStockItem[] {
  const lastSold = new Map<string, number>();
  const firstSeen = new Map<string, number>();

  for (const m of effectiveMovements(movements)) {
    if (!firstSeen.has(m.stockItemId) || m.timestamp < firstSeen.get(m.stockItemId)!) {
      firstSeen.set(m.stockItemId, m.timestamp);
    }
    if (m.reason !== 'sold') continue;
    if (!lastSold.has(m.stockItemId) || m.timestamp > lastSold.get(m.stockItemId)!) {
      lastSold.set(m.stockItemId, m.timestamp);
    }
  }

  return stockItems
    .map(stockItem => {
      const lastSoldAt = lastSold.get(stockItem.id) ?? null;
      const knownSince = firstSeen.get(stockItem.id) ?? null;
      const since = lastSoldAt ?? knownSince;
      return {
        stockItem,
        lastSoldAt,
        knownSince,
        idleDays: since === null ? null : Math.max(0, (now - since) / DAY),
        value: stockItem.quantity * (stockItem.costPerUnit || 0),
      };
    })
    // Items with no ledger history at all are not dead stock, only unused
    // records — there is no evidence either way, and guessing would fill the
    // panel with rows nobody recognises.
    .filter(row => row.idleDays !== null)
    .sort((a, b) => (b.idleDays ?? 0) - (a.idleDays ?? 0))
    .slice(0, limit);
}

/* --------------------------------------------------------------- food cost */

/**
 * Where the closing stock figure came from.
 *
 * `ledger` is what the recipes and receipts imply is left. It is available
 * immediately and costs nobody a minute of their evening, but it can only ever
 * surface losses somebody already wrote down.
 *
 * `counted` is what was actually on the shelf. The moment a stock take runs,
 * its correcting movement flows into the same ledger and the figure below
 * stops being an estimate and starts being a measurement — with no change to
 * the arithmetic, only to how much it is worth trusting.
 */
export type FoodCostBasis = 'counted' | 'ledger';

export interface FoodCost {
  /** What the recipes say the period's sales should have consumed. */
  theoretical: number;
  /** What the stock actually did: opening + purchases − closing. */
  actual: number | null;
  /** Actual − theoretical. Positive means more went out than was sold. */
  variance: number | null;
  /** Theoretical as a share of net revenue. */
  theoreticalPct: number | null;
  actualPct: number | null;
  openingValue: number | null;
  closingValue: number | null;
  purchases: number;
  basis: FoodCostBasis;
  /** When stock was last counted inside the period, if it was. */
  countedAt: number | null;
  /** Convenience mirror of `basis === 'counted'`. */
  counted: boolean;
  blocked?: string;
}

/**
 * Stock levels as at a moment, replayed from the ledger.
 *
 * Every movement records the level it left behind, so the most recent line at
 * or before the mark *is* the level — no accumulation, and no drift from
 * summing deltas that were rounded when they were written.
 *
 * An item whose ledger starts after the mark is handled from the other side:
 * its first movement's `resulting − delta` is exactly the level it started
 * from, which is the level at the mark. Treating it as zero instead would make
 * every stock item look as though it appeared out of nowhere.
 *
 * **This must NOT read `effectiveMovements`, and that is not an oversight.**
 * Convention 6 and ADR-017: *effective for economics, every row for levels.*
 * A reversal is bookkeeping to the money figures, but it genuinely moved the
 * shelf, and `resulting` is the level it left behind. Filter it out here and
 * the last surviving line at or before the mark is the wrong one, so every
 * historical level — and both ends of `foodCost` — silently shifts by the
 * reversed amount. The figures stay plausible; they stop being true. If you
 * came here to make this consistent with `stockPurchasesValue`, read ADR-017
 * first.
 *
 * Exported only so `metrics.check.ts` can hold this to its word.
 */
export function ledgerLevelsAt(movements: StockMovement[], at: number): Map<string, number> {
  const levels = new Map<string, number>();
  const resolved = new Set<string>();

  for (const m of [...movements].sort((a, b) => a.timestamp - b.timestamp)) {
    if (m.timestamp <= at) {
      levels.set(m.stockItemId, m.resulting);
      resolved.add(m.stockItemId);
    } else if (!resolved.has(m.stockItemId)) {
      levels.set(m.stockItemId, m.resulting - m.delta);
      resolved.add(m.stockItemId);
    }
  }
  return levels;
}

/**
 * Value of the stock on hand at a moment, from the ledger.
 *
 * Valued at today's cost per unit, as every other stock figure in the app is.
 * Historical unit costs are recorded on receipts and could be used instead, but
 * mixing them in would mean this number and the inventory value on the same
 * screen disagreed about what a kilo of mince is worth.
 */
function ledgerValueAt(movements: StockMovement[], stockItems: StockItem[], at: number): number {
  const levels = ledgerLevelsAt(movements, at);
  return stockItems.reduce(
    (sum, item) => sum + Math.max(0, levels.get(item.id) ?? 0) * (item.costPerUnit || 0), 0);
}

/** Total value of the latest snapshot on or before `at`'s day. Null when none exists. */
function snapshotValueAt(snapshots: InventorySnapshot[], at: number): number | null {
  const cutoff = localDateKey(at);
  const byDate = new Map<string, number>();
  for (const snap of snapshots) {
    if (snap.date > cutoff) continue;
    byDate.set(snap.date, (byDate.get(snap.date) ?? 0) + snap.value);
  }
  if (byDate.size === 0) return null;
  const latest = [...byDate.keys()].sort().pop()!;
  return byDate.get(latest) ?? null;
}

/**
 * Theoretical against actual ingredient cost, and the gap between them.
 *
 * Theoretical is the sum of the cost snapshots frozen onto each sold line — what
 * the recipes say went out. Actual is what the stock did: opening value, plus
 * everything received, less closing value.
 *
 * The gap is where the money goes missing: waste, over-portioning, theft, and
 * deliveries that came in dearer than the last one. It is only as honest as the
 * closing figure, so `counted` says whether a real count backs it.
 */
export function foodCost(
  totals: Totals,
  movements: StockMovement[],
  snapshots: InventorySnapshot[],
  stockItems: StockItem[],
  range: DateRange,
  now = Date.now(),
): FoodCost {
  const theoretical = totals.cogs;
  const theoreticalPct = totals.netRevenue > 0 ? (theoretical / totals.netRevenue) * 100 : null;

  /*
   * One definition of a purchase, in one place.
   *
   * This loop used to count `added`, `packet` **and** `correction`, while
   * `stockPurchasesValue` counted only the first two — so the same delivery was
   * two different numbers, on the same screen, with nothing saying which was
   * which. A shop reconciling "stock purchases" against the purchases line
   * inside actual food cost found they disagreed and had no way to tell which
   * one to believe.
   *
   * The rule that settles it: **a purchase is a receipt** (ADR-014). A
   * correction carries no cost data and means "the shelf disagreed with the
   * book" — it is a measurement of what was already there, not money going out
   * of the till. Costing one at today's cost per unit invents an outlay that
   * never happened, and does it in the direction that makes food cost look
   * worse the more carefully a shop counts.
   */
  const purchases = stockPurchasesValue(movements, stockItems, range.start, range.end);

  // A count that was undone is not a count. `basis` is a claim about how much
  // the closing figure can be trusted, so it reads effective rows (ADR-017).
  let countedAt: number | null = null;
  for (const m of effectiveMovements(movements)) {
    if (m.timestamp < range.start || m.timestamp >= range.end) continue;
    if (m.reason === 'stocktake' && (countedAt === null || m.timestamp > countedAt)) {
      countedAt = m.timestamp;
    }
  }

  const hasLedger = movements.length > 0;

  /*
   * Both ends come from the ledger first and snapshots only as a fallback.
   *
   * A snapshot is written once a day, at the first launch, so it describes the
   * shelf at breakfast. Asking it what a session that ran from noon to eight
   * closed on gets an answer a whole trading day stale. Replaying the ledger to
   * an instant is exact, and every movement already records the level it left
   * behind, so there is nothing to accumulate and nothing to drift.
   *
   * The ledger answers even for a window that opens before its first line: that
   * line's `resulting − delta` is the level it stepped away from, which is the
   * level throughout everything earlier. That is a real measurement of stock
   * whose arrival was never recorded — strictly better than assuming an empty
   * shelf, and it is what lets "All time" report an actual cost at all.
   *
   * Note which rule applies where. `purchases` above is money, so it reads
   * effective rows only. The two ends here are *levels*, so they read the whole
   * ledger — `ledgerValueAt` is deliberately unfiltered, and its comment says
   * why. Both halves of this calculation are correct for opposite reasons.
   */
  const openingValue = hasLedger
    ? ledgerValueAt(movements, stockItems, range.start)
    : snapshotValueAt(snapshots, range.start);

  const closingValue = range.end > now
    // A period running up to now closes on the shelf itself, which already
    // includes any count that has been done.
    ? inventoryValue(stockItems).total
    : hasLedger
      ? ledgerValueAt(movements, stockItems, range.end - 1)
      : snapshotValueAt(snapshots, range.end);

  // A stock take writes a correcting movement, so once one runs its result is
  // already inside the closing figure above. Nothing here changes when stock is
  // counted except how much the answer can be trusted — which is the whole
  // point of saying which basis it came from.
  const basis: FoodCostBasis = countedAt !== null ? 'counted' : 'ledger';

  if (openingValue === null || closingValue === null) {
    return {
      theoretical,
      actual: null,
      variance: null,
      theoreticalPct,
      actualPct: null,
      openingValue,
      closingValue,
      purchases,
      basis,
      countedAt,
      counted: basis === 'counted',
      blocked: 'No stock history reaches back this far',
    };
  }

  const actual = openingValue + purchases - closingValue;
  return {
    theoretical,
    actual,
    variance: actual - theoretical,
    theoreticalPct,
    actualPct: totals.netRevenue > 0 ? (actual / totals.netRevenue) * 100 : null,
    openingValue,
    closingValue,
    purchases,
    basis,
    countedAt,
    counted: basis === 'counted',
  };
}

/* --------------------------------------------------------- data quality */

export interface DataQualityIssue {
  id: string;
  severity: 'warn' | 'info';
  message: string;
  count: number;
}

/**
 * What analytics cannot currently answer, and why.
 *
 * Shown rather than hidden: a margin computed from 40% cost coverage is worse
 * than no margin at all, because it looks like an answer.
 */
export function dataQuality(
  orders: Order[],
  stockItems: StockItem[],
  assignments: MenuItemStockAssignment[],
  menuItems: MenuItem[],
  range: DateRange,
  food?: FoodCost,
): DataQualityIssue[] {
  const issues: DataQualityIssue[] = [];
  const live = orders.filter(o => !o.voidedAt && inRange(o, range));

  // Not a warning — an estimated food cost is a perfectly usable number, and
  // demanding a count at the end of a market day is how cost tracking gets
  // abandoned. It just must not be mistaken for a measurement.
  if (food && food.actual !== null && food.basis === 'ledger') {
    issues.push({
      id: 'food-cost-estimated',
      severity: 'info',
      count: 1,
      message: 'The actual food cost here is an estimate: nothing was counted in this period, so it only accounts for waste and corrections you already wrote down. Do a stock take and it becomes a real measurement.',
    });
  }

  const uncostedLines = live.reduce(
    (n, o) => n + o.items.filter((i: CartItem) => i.unitCost === undefined).length, 0);
  const allLines = live.reduce((n, o) => n + o.items.length, 0);
  if (uncostedLines > 0) {
    issues.push({
      id: 'uncosted-lines',
      severity: 'warn',
      count: uncostedLines,
      message: `${Math.round((uncostedLines / Math.max(1, allLines)) * 100)}% of what you sold has no cost recorded against it, so the profit figures only cover the rest. Assign stock to your menu items to close the gap.`,
    });
  }

  const noCost = stockItems.filter(s => !(s.costPerUnit > 0));
  if (noCost.length > 0) {
    issues.push({
      id: 'uncosted-stock',
      severity: 'warn',
      count: noCost.length,
      message: `${noCost.length} thing${noCost.length === 1 ? ' on the shelf has' : 's on the shelf have'} no cost recorded: ${noCost.slice(0, 3).map(s => s.name).join(', ')}${noCost.length > 3 ? '…' : ''}. Type in what a delivery cost when you add stock and this fills itself in.`,
    });
  }

  const unassigned = menuItems.filter(m =>
    m.showInOrderMode && !m.dealItems?.length && !assignments.some(a => a.menuItemId === m.id));
  if (unassigned.length > 0) {
    issues.push({
      id: 'unassigned-items',
      severity: 'info',
      count: unassigned.length,
      message: `${unassigned.length} menu item${unassigned.length === 1 ? ' has' : 's have'} nothing assigned to ${unassigned.length === 1 ? 'it' : 'them'}, so selling ${unassigned.length === 1 ? 'it takes' : 'them takes'} nothing off the shelf and ${unassigned.length === 1 ? 'it' : 'they'} cannot be costed. Set that up under Inventory → Assign Stock.`,
    });
  }

  const untimed = live.filter(o => !o.readyAt && !o.completedAt).length;
  if (untimed > 0 && untimed === live.length) {
    issues.push({
      id: 'no-stage-times',
      severity: 'info',
      count: untimed,
      message: 'No ticket in this period was moved through the board with timings recorded, so there are no kitchen times to show. They start being recorded from now on and cannot be filled in for the past.',
    });
  }

  return issues;
}
