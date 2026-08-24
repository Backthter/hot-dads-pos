import type {
  DealItem,
  MenuItem,
  MenuItemStockAssignment,
  StockItem,
  StockMovement,
  StockMovementReason,
} from '../types';

/* ------------------------------------------------------------------ units */

export type UnitFamily = 'count' | 'mass' | 'volume';

interface UnitDef {
  family: UnitFamily;
  /** How many base units one of these is worth. */
  factor: number;
}

/**
 * Everything is stored in a base unit — pcs, g or ml — so the arithmetic never
 * has to reason about mixed units. Larger units exist only for typing in and
 * for display.
 */
export const UNITS: Record<string, UnitDef> = {
  pcs: { family: 'count', factor: 1 },
  g: { family: 'mass', factor: 1 },
  kg: { family: 'mass', factor: 1000 },
  ml: { family: 'volume', factor: 1 },
  L: { family: 'volume', factor: 1000 },
};

export const BASE_UNIT: Record<UnitFamily, string> = {
  count: 'pcs',
  mass: 'g',
  volume: 'ml',
};

export const UNIT_CHOICES = ['pcs', 'g', 'kg', 'ml', 'L'] as const;

export function familyOf(unit: string): UnitFamily {
  return UNITS[unit]?.family ?? 'count';
}

export function baseUnitFor(unit: string): string {
  return BASE_UNIT[familyOf(unit)];
}

/** Convert an amount typed in `unit` into the item's base unit. */
export function toBase(amount: number, unit: string): number {
  const def = UNITS[unit];
  return def ? amount * def.factor : amount;
}

/**
 * Display a base-unit quantity in the friendliest unit of its family:
 * 6750 g reads as 6.75 kg, 900 g stays in g.
 */
export function formatQuantity(quantity: number, baseUnit: string): { value: string; unit: string } {
  const family = familyOf(baseUnit);
  if (family === 'count') {
    return { value: trimNumber(quantity), unit: 'pcs' };
  }
  const big = family === 'mass' ? 'kg' : 'L';
  if (Math.abs(quantity) >= 1000) {
    return { value: trimNumber(quantity / 1000, 2), unit: big };
  }
  return { value: trimNumber(quantity), unit: family === 'mass' ? 'g' : 'ml' };
}

export function formatQuantityLabel(quantity: number, baseUnit: string): string {
  const { value, unit } = formatQuantity(quantity, baseUnit);
  return `${value} ${unit}`;
}

function trimNumber(n: number, maxDecimals = 1): string {
  if (!Number.isFinite(n)) return '0';
  const rounded = Math.round(n * 10 ** maxDecimals) / 10 ** maxDecimals;
  return String(rounded);
}

/* ------------------------------------------------------- requirements tree */

/**
 * Finds the menu item a deal component refers to.
 *
 * Prefers the id. Names are only a fallback for rows written before deals
 * carried ids — matching on name alone meant renaming a menu item silently
 * emptied every deal that contained it, retroactively.
 */
export function resolveDealComponent(
  component: DealItem,
  menuItems: MenuItem[],
): MenuItem | undefined {
  if (component.menuItemId) {
    const byId = menuItems.find(mi => mi.id === component.menuItemId);
    if (byId) return byId;
  }
  return menuItems.find(mi => mi.name === component.name);
}

/**
 * How much of each stock item one unit of a product consumes. Deals are
 * flattened through their components, so a deal of 2 burgers requires twice
 * everything a burger does.
 */
export function requirementsFor(
  menuItem: MenuItem,
  menuItems: MenuItem[],
  assignments: MenuItemStockAssignment[],
  seen: Set<string> = new Set(),
): Map<string, number> {
  const out = new Map<string, number>();
  if (seen.has(menuItem.id)) return out;   // guards a deal that contains itself
  seen.add(menuItem.id);

  const isDeal = Boolean(menuItem.dealItems && menuItem.dealItems.length > 0);

  if (isDeal) {
    for (const component of menuItem.dealItems!) {
      const sub = resolveDealComponent(component, menuItems);
      if (!sub) continue;
      const subReq = requirementsFor(sub, menuItems, assignments, new Set(seen));
      for (const [stockId, qty] of subReq) {
        out.set(stockId, (out.get(stockId) ?? 0) + qty * component.quantity);
      }
    }
  }

  // A deal can also carry assignments of its own (packaging, a bag, a napkin).
  for (const assignment of assignments) {
    if (assignment.menuItemId !== menuItem.id) continue;
    out.set(assignment.stockItemId, (out.get(assignment.stockItemId) ?? 0) + assignment.quantityPerItem);
  }

  return out;
}

/* ------------------------------------------------------------------ cost */

export interface UnitCost {
  /** Ingredient cost of one of this menu item, in rupees. */
  cost: number;
  /** True only when every ingredient it needs has a cost recorded. */
  complete: boolean;
  /** Ingredients with no cost on file, which is why `complete` is false. */
  missing: string[];
}

/**
 * What one of a menu item costs to make, from the recipe and the stock costs in
 * force right now.
 *
 * `complete` matters more than `cost`. A burger whose beef has a cost and whose
 * bun does not would otherwise report a cheerfully understated cost and an
 * inflated margin. Callers should store the figure only when it is complete, so
 * that "no cost recorded" stays distinguishable from "costs nothing".
 */
export function unitCostFor(
  menuItem: MenuItem,
  menuItems: MenuItem[],
  assignments: MenuItemStockAssignment[],
  stockItems: StockItem[],
): UnitCost {
  // A hand-entered cost wins outright. It is the only figure a person has
  // asserted directly, and the recipe is an inference by comparison.
  //
  // Nothing writes this any more — the field is deprecated and the menu row
  // that used to set it is gone (ADR-015). The read stays because gating a
  // feature and breaking a parser are different things: an in-memory or legacy
  // row that still carries one has to go on meaning what it says. It cannot
  // arrive from disk, because it never had a column to arrive from.
  if (menuItem.unitCostOverride !== undefined && menuItem.unitCostOverride >= 0) {
    return { cost: menuItem.unitCostOverride, complete: true, missing: [] };
  }

  const requirements = requirementsFor(menuItem, menuItems, assignments);
  let cost = 0;
  const missing: string[] = [];

  for (const [stockId, required] of requirements) {
    const stockItem = stockItems.find(s => s.id === stockId);
    if (!stockItem || required <= 0) continue;
    if (!(stockItem.costPerUnit > 0)) {
      missing.push(stockItem.name);
      continue;
    }
    cost += stockItem.costPerUnit * required;
  }

  return { cost, complete: requirements.size > 0 && missing.length === 0, missing };
}

/* ------------------------------------------------------------- estimates */

export interface EstimateIngredient {
  stockItem: StockItem;
  /** Required per one unit of the product. */
  required: number;
  /** How much is in stock. */
  available: number;
  /** available / required — how many products this ingredient alone allows. */
  ratio: number;
}

export interface ProductEstimate {
  menuItemId: string;
  name: string;
  /** How many can be made right now. */
  count: number;
  /** Most constrained first. */
  ingredients: EstimateIngredient[];
  bottleneck?: EstimateIngredient;
  /** What the count would rise to if the bottleneck were topped up. */
  nextTarget?: number;
  /** How much of the bottleneck to add to reach nextTarget, in base units. */
  topUp?: number;
  /** No stock has been assigned, so nothing can be said. */
  unassigned: boolean;
}

export function estimateProduct(
  menuItem: MenuItem,
  menuItems: MenuItem[],
  assignments: MenuItemStockAssignment[],
  stockItems: StockItem[],
): ProductEstimate {
  const requirements = requirementsFor(menuItem, menuItems, assignments);

  const ingredients: EstimateIngredient[] = [];
  for (const [stockId, required] of requirements) {
    const stockItem = stockItems.find(s => s.id === stockId);
    if (!stockItem || required <= 0) continue;
    ingredients.push({
      stockItem,
      required,
      available: stockItem.quantity,
      ratio: stockItem.quantity / required,
    });
  }

  if (ingredients.length === 0) {
    return { menuItemId: menuItem.id, name: menuItem.name, count: 0, ingredients: [], unassigned: true };
  }

  ingredients.sort((a, b) => a.ratio - b.ratio);
  const bottleneck = ingredients[0];
  const count = Math.max(0, Math.floor(bottleneck.ratio));

  // The next ingredient to bind is what topping up the bottleneck would buy you.
  const second = ingredients[1];
  const nextTarget = second ? Math.max(0, Math.floor(second.ratio)) : undefined;
  const topUp = nextTarget !== undefined && nextTarget > count
    ? Math.max(0, bottleneck.required * nextTarget - bottleneck.available)
    : undefined;

  return {
    menuItemId: menuItem.id,
    name: menuItem.name,
    count,
    ingredients,
    bottleneck,
    nextTarget: topUp !== undefined ? nextTarget : undefined,
    topUp,
    unassigned: false,
  };
}

export function estimateAll(
  menuItems: MenuItem[],
  assignments: MenuItemStockAssignment[],
  stockItems: StockItem[],
): ProductEstimate[] {
  return menuItems
    .filter(mi => mi.showInOrderMode)
    .map(mi => estimateProduct(mi, menuItems, assignments, stockItems))
    .filter(e => !e.unassigned)
    .sort((a, b) => a.count - b.count);
}

/** Rank colour for an ingredient chip: most constrained red, least green. */
export const SCARCITY_COLORS = ['#F9624E', '#f79634', '#e7c94a', '#9ccb5a', '#63D07F'];

export function scarcityColor(index: number, total: number): string {
  if (total <= 1) return SCARCITY_COLORS[SCARCITY_COLORS.length - 1];
  const step = (SCARCITY_COLORS.length - 1) / (total - 1);
  return SCARCITY_COLORS[Math.min(SCARCITY_COLORS.length - 1, Math.round(index * step))];
}

/* -------------------------------------------------------------- movements */

export function newMovementId(): string {
  return `mv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Builds one ledger line.
 *
 * A `reversal` is marked `reversed` here rather than at the call site, and that
 * placement is the whole point (ADR-016). Two write paths used to produce
 * reversals — one marked both rows, one marked nothing — and every economic
 * reader skipped `reversed`, so a delivery undone through the unmarked path
 * left its original still counted as money spent. Marking on the way in means a
 * new write path cannot forget.
 */
export function buildMovement(
  stockItem: StockItem,
  delta: number,
  reason: StockMovementReason,
  note?: string,
): StockMovement {
  return {
    id: newMovementId(),
    stockItemId: stockItem.id,
    delta,
    resulting: Math.max(0, stockItem.quantity + delta),
    reason,
    note,
    ...(reason === 'reversal' ? { reversed: true } : {}),
    timestamp: Date.now(),
  };
}

export const MOVEMENT_LABELS: Record<StockMovementReason, string> = {
  added: 'Added',
  packet: 'Packets added',
  sold: 'Used by order',
  returned: 'Returned from edit',
  waste: 'Waste',
  correction: 'Correction',
  // What the user did was undo something. "Reversal" is the bookkeeping word,
  // and the ledger is read by someone standing at a counter.
  reversal: 'Undone',
  edit: 'Edited',
  drained: 'Drained',
  stocktake: 'Stock take',
};

/**
 * Movements that represent real events.
 *
 * `reversed` is set on both rows of a reversal pair, so this needs no pairing
 * logic — which matters, because `applyStockChanges` caps the ledger at 20,000
 * lines (ADR-001) and a trim can drop one half of a pair. An orphaned half is
 * still marked and still excluded.
 *
 * **Economics only.** Every figure about money or usage reads through this:
 * purchases, food cost, shrinkage, dead stock, consumption rate. Historical
 * *levels* must not — a reversal genuinely moved the shelf, and `resulting`
 * records where it left it. See ADR-017, and convention 6 in
 * docs/03-INVARIANTS.md: effective for economics, every row for levels.
 */
export function effectiveMovements(all: StockMovement[]): StockMovement[] {
  return all.filter(m => !m.reversed);
}

/**
 * How many ledger lines are kept in memory.
 *
 * Bounded, but far above a year of trading. Trimming is only safe at all
 * because a daily snapshot exists behind it — without one, dropping old lines
 * would make historical stock unreconstructable.
 */
export const MOVEMENT_LIMIT = 20_000;

/**
 * Appends lines to a ledger, marking whatever a reversal points back at.
 *
 * Every write to the stock ledger goes through here. That is the fix ADR-016
 * describes: there used to be two write paths producing reversals, one marking
 * both rows and one marking nothing, and every economic reader skipped
 * `reversed` — so a delivery undone through the unmarked path left its original
 * still counted as money spent while the line cancelling it counted as nothing.
 *
 * The reversal line marks itself in `buildMovement`; this marks the other half.
 * `reversed` is the one field that may change on an existing row, which
 * invariant 1 permits explicitly and for exactly this.
 *
 * Pure, so `metrics.check.ts` can drive it without React.
 */
export function postMovements(
  ledger: StockMovement[],
  lines: StockMovement[],
): StockMovement[] {
  if (lines.length === 0) return ledger;
  const reversedIds = new Set(
    lines
      .filter(m => m.reason === 'reversal' && m.referenceType === 'movement' && m.referenceId)
      .map(m => m.referenceId!),
  );
  const marked = reversedIds.size === 0
    ? ledger
    : ledger.map(m => (reversedIds.has(m.id) ? { ...m, reversed: true } : m));
  return [...marked, ...lines].slice(-MOVEMENT_LIMIT);
}

/* --------------------------------------------------------- usage & reorder */

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

/** How far back the ledger is read. Long, because trading is sporadic. */
const WINDOW_DAYS = 60;
/** Only trust a rate once it has seen this many distinct trading hours... */
const MIN_TRADING_HOURS = 3;
/** ...and this many separate consuming movements. */
const MIN_SAMPLES = 2;

export interface ConsumptionRate {
  /** Base units used per hour of actual trading. */
  perHour: number;
  /** Distinct clock hours in which anything was sold or wasted. */
  tradingHours: number;
  /** How many movements went into it. */
  samples: number;
  /** Calendar span the observations are drawn from, for the explanation. */
  spanDays: number;
  /** False when there is too little history to say anything useful. */
  reliable: boolean;
}

/**
 * How fast an item is being used — per hour of trading, not per calendar day.
 *
 * This business does not trade continuously. It works event days: a pop-up on
 * Saturday, then nothing for a fortnight. A per-day rate divides real
 * consumption by the dead days in between, so the busiest item in the van looks
 * like it lasts a month; a per-hour rate divided by *elapsed* hours has the same
 * flaw. Both answer a question nobody asked, because stock is not consumed while
 * the shutters are down.
 *
 * So the denominator is the number of distinct clock hours in which something
 * actually sold. Fourteen units across three trading hours is 4.7 an hour,
 * whether those hours were yesterday or spread over a month of markets — and
 * "hours left" then means hours of trading, which is what has to be planned for.
 *
 * Only movements representing stock leaving — sales and waste — count.
 * Additions, corrections and stock takes are ignored, or restocking would read
 * as consumption.
 *
 * This is a figure about usage, so it reads `effectiveMovements`: a sale that
 * was undone did not consume anything, and counting it would make an item look
 * as though it were running out faster than it is.
 */
export function consumptionRate(
  movements: StockMovement[],
  stockItemId: string,
  windowDays = WINDOW_DAYS,
  now = Date.now(),
): ConsumptionRate {
  const since = now - windowDays * DAY;
  const hours = new Set<number>();
  let used = 0;
  let samples = 0;
  let earliest = now;

  for (const m of effectiveMovements(movements)) {
    if (m.stockItemId !== stockItemId) continue;
    if (m.timestamp < since) continue;
    if (m.delta >= 0) continue;
    if (m.reason !== 'sold' && m.reason !== 'waste') continue;
    used += -m.delta;
    samples += 1;
    hours.add(Math.floor(m.timestamp / HOUR));
    earliest = Math.min(earliest, m.timestamp);
  }

  if (used <= 0) {
    return { perHour: 0, tradingHours: 0, samples: 0, spanDays: 0, reliable: false };
  }

  const tradingHours = hours.size;
  return {
    perHour: used / Math.max(1, tradingHours),
    tradingHours,
    samples,
    spanDays: (now - earliest) / DAY,
    reliable: tradingHours >= MIN_TRADING_HOURS && samples >= MIN_SAMPLES,
  };
}

/** Base units consumed per hour of trading. */
export function consumptionPerHour(
  movements: StockMovement[],
  stockItemId: string,
  windowDays = WINDOW_DAYS,
  now = Date.now(),
): number {
  return consumptionRate(movements, stockItemId, windowDays, now).perHour;
}

export interface ReorderSuggestion {
  stockItem: StockItem;
  /** Base units to buy to clear the threshold and cover the horizon. */
  shortfall: number;
  packets?: number;
  /** Hours of *trading* the stock covers. Only set when the ledger supports it. */
  hoursLeft?: number;
  /** The rate behind `hoursLeft`, so the screen can show its working. */
  rate?: ConsumptionRate;
  reason: 'low' | 'running-out';
}

/**
 * What to buy. An item qualifies if it is under its threshold, or if usage says
 * it runs out within `horizonHours` of trading — roughly one service.
 */
export function reorderList(
  stockItems: StockItem[],
  movements: StockMovement[],
  horizonHours = 8,
  now = Date.now(),
): ReorderSuggestion[] {
  const out: ReorderSuggestion[] = [];

  for (const item of stockItems) {
    const rate = consumptionRate(movements, item.id, WINDOW_DAYS, now);
    // A forecast is only offered when the ledger can support one. Everything
    // else still qualifies on the threshold alone.
    const hoursLeft = rate.reliable && rate.perHour > 0 ? item.quantity / rate.perHour : undefined;
    const low = item.quantity <= item.lowStockThreshold;
    const runningOut = hoursLeft !== undefined && hoursLeft <= horizonHours;
    if (!low && !runningOut) continue;

    // Enough to clear the threshold and cover the horizon.
    const cover = rate.reliable ? rate.perHour * horizonHours : 0;
    const target = Math.max(item.lowStockThreshold, cover);
    const shortfall = Math.max(0, Math.ceil(target - item.quantity));
    if (shortfall <= 0) continue;

    out.push({
      stockItem: item,
      shortfall,
      packets: item.packetSize && item.packetSize > 0
        ? Math.ceil(shortfall / item.packetSize)
        : undefined,
      hoursLeft,
      rate: rate.perHour > 0 ? rate : undefined,
      reason: low ? 'low' : 'running-out',
    });
  }

  return out.sort((a, b) => (a.hoursLeft ?? Infinity) - (b.hoursLeft ?? Infinity));
}

export function isLowStock(item: StockItem): boolean {
  return item.lowStockThreshold > 0 && item.quantity <= item.lowStockThreshold;
}
