import type {
  Category, CostEntry, DealItem, InventorySnapshot, MenuItem, MenuItemStockAssignment,
  Order, OversellEvent, StockItem, StockMovement, TradingEvent, TradingSession,
} from '../src/app/types';
import type { DataSnapshot } from '../src/app/state/core';

/**
 * A burger stall with six weeks of history, generated rather than recorded.
 *
 * This exists so that a change can be *looked at*. Most of what `docs/` argues
 * about is invisible on an empty database: a held event cost needs a market
 * with three days in it, a break-even crossing needs a session that actually
 * crossed, `—` versus `0` needs a delivery somebody forgot to price. Reading
 * the ADR and reading the screen are different kinds of understanding and the
 * second one has not been available.
 *
 * Three properties it is built to have:
 *
 * 1. **Deterministic.** Same `now`, same database, down to the ticket. Two
 *    people looking at "the demo data" are looking at the same thing, and a
 *    figure that changed means the code changed.
 * 2. **Anchored to today.** Everything is relative to local midnight, so *Last
 *    7 days* and *This month* always have something in them. A fixture with
 *    hard-coded 2024 dates answers no question about a date filter.
 * 3. **Deliberately imperfect.** A delivery with no price on it, a week of
 *    orders taken before costing existed, an undone delivery, a stocktake that
 *    found less than the book said, oversells, voids. The awkward cases are the
 *    point — a tidy dataset demonstrates nothing, because every screen in this
 *    program has a branch for the untidy one and that branch is where the bugs
 *    live.
 *
 * Pure, and it imports only types. It is used by `demo/build.ts` to write the
 * seed file and by the browser dev build, which has no SQLite at all.
 */

/* ------------------------------------------------------------------ random */

/**
 * mulberry32 — small, fast, and good enough for deciding how many burgers a
 * Tuesday sold. Written out rather than pulled in, because a dependency that
 * exists to make a demo reproducible is a dependency in the lockfile forever.
 */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HOUR = 3_600_000;
const MINUTE = 60_000;
const DAY = 24 * HOUR;

/* -------------------------------------------------------------- the menu */

const CATEGORIES: Category[] = [
  { id: 'cat-food', name: 'Food', order: 0 },
  { id: 'cat-drinks', name: 'Drinks', order: 1 },
  { id: 'cat-deals', name: 'Deals', order: 2, system: 'deals' },
];

const MENU: MenuItem[] = [
  { id: 'm-classic', name: 'Classic Burger', price: 500, showInOrderMode: true, category: 'Food' },
  { id: 'm-chicken', name: 'Chicken Burger', price: 600, showInOrderMode: true, category: 'Food' },
  { id: 'm-deluxe', name: 'Beef Deluxe', price: 750, showInOrderMode: true, category: 'Food' },
  { id: 'm-fries', name: 'Loaded Fries', price: 300, showInOrderMode: true, category: 'Food' },
  { id: 'm-water', name: 'Water', price: 60, showInOrderMode: true, category: 'Drinks' },
  { id: 'm-coke', name: 'Coke', price: 120, showInOrderMode: true, category: 'Drinks' },
  { id: 'm-sprite', name: 'Sprite', price: 120, showInOrderMode: true, category: 'Drinks' },
  {
    id: 'm-meal',
    name: 'Meal Deal',
    price: 1200,
    showInOrderMode: true,
    category: 'Deals',
    // Components carry their id as well as their name — a deal referenced by
    // name alone breaks retroactively when an item is renamed, which is the
    // repair `linkDealItems` exists to do for older databases.
    dealItems: [
      { menuItemId: 'm-deluxe', name: 'Beef Deluxe', quantity: 2 },
      { menuItemId: 'm-coke', name: 'Coke', quantity: 2 },
    ],
  },
];

/* ------------------------------------------------------------- the shelf */

interface StockSeed {
  id: string;
  name: string;
  unit: string;
  cost: number;
  threshold: number;
  packetSize?: number;
  packetLabel?: string;
  packetCost?: number;
}

const STOCK: StockSeed[] = [
  { id: 's-patty', name: 'Beef patty', unit: 'pcs', cost: 130, threshold: 40, packetSize: 24, packetLabel: 'Box', packetCost: 3000 },
  { id: 's-fillet', name: 'Chicken fillet', unit: 'pcs', cost: 150, threshold: 30, packetSize: 20, packetLabel: 'Box', packetCost: 2900 },
  { id: 's-bun', name: 'Burger bun', unit: 'pcs', cost: 35, threshold: 60, packetSize: 12, packetLabel: 'Pack', packetCost: 400 },
  { id: 's-cheese', name: 'Cheese slice', unit: 'pcs', cost: 18, threshold: 80 },
  { id: 's-potato', name: 'Potatoes', unit: 'g', cost: 0.14, threshold: 5000 },
  { id: 's-coke', name: 'Coke can', unit: 'pcs', cost: 55, threshold: 48, packetSize: 24, packetLabel: 'Crate', packetCost: 1300 },
  { id: 's-sprite', name: 'Sprite can', unit: 'pcs', cost: 55, threshold: 48, packetSize: 24, packetLabel: 'Crate', packetCost: 1300 },
  // Deliberately uncosted: `inventoryValue` reports it as an unknown rather
  // than as worthless, and the Inventory table has to show that.
  { id: 's-napkin', name: 'Napkins', unit: 'pcs', cost: 0, threshold: 200 },
];

const RECIPES: MenuItemStockAssignment[] = [
  { menuItemId: 'm-classic', stockItemId: 's-patty', quantityPerItem: 1 },
  { menuItemId: 'm-classic', stockItemId: 's-bun', quantityPerItem: 1 },
  { menuItemId: 'm-classic', stockItemId: 's-cheese', quantityPerItem: 1 },
  { menuItemId: 'm-chicken', stockItemId: 's-fillet', quantityPerItem: 1 },
  { menuItemId: 'm-chicken', stockItemId: 's-bun', quantityPerItem: 1 },
  { menuItemId: 'm-deluxe', stockItemId: 's-patty', quantityPerItem: 2 },
  { menuItemId: 'm-deluxe', stockItemId: 's-bun', quantityPerItem: 1 },
  { menuItemId: 'm-deluxe', stockItemId: 's-cheese', quantityPerItem: 2 },
  { menuItemId: 'm-fries', stockItemId: 's-potato', quantityPerItem: 200 },
  { menuItemId: 'm-fries', stockItemId: 's-cheese', quantityPerItem: 1 },
  { menuItemId: 'm-coke', stockItemId: 's-coke', quantityPerItem: 1 },
  { menuItemId: 'm-sprite', stockItemId: 's-sprite', quantityPerItem: 1 },
  // Water and Napkins have no recipe on purpose: `dataQuality` flags a menu
  // item with no assignment, and that warning needs something to point at.
];

/* --------------------------------------------------------------- helpers */

const midnight = (ms: number) => {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

const dateKey = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Flattens a menu item into the stock it consumes, deals included. */
function ingredientsOf(menuItemId: string, menu: MenuItem[]): { stockItemId: string; qty: number }[] {
  const item = menu.find(m => m.id === menuItemId);
  const out: { stockItemId: string; qty: number }[] = [];

  const add = (id: string, multiplier: number) => {
    for (const r of RECIPES) {
      if (r.stockItemId && r.menuItemId === id) {
        out.push({ stockItemId: r.stockItemId, qty: r.quantityPerItem * multiplier });
      }
    }
  };

  if (item?.dealItems?.length) {
    // A deal consumes what its components consume. `itemPerformance` credits
    // the components with these units, so the ledger has to spend them the same
    // way or the two would disagree about the same meal.
    for (const component of item.dealItems as DealItem[]) {
      if (component.menuItemId) add(component.menuItemId, component.quantity);
    }
    return out;
  }
  add(menuItemId, 1);
  return out;
}

/* ------------------------------------------------------------ the timeline */

type Kind = 'delivery' | 'waste' | 'stocktake' | 'correction';

interface ShelfEvent {
  at: number;
  kind: Kind;
  stockItemId: string;
  qty: number;
  /** What the delivery cost, as typed in. Undefined leaves it unpriced. */
  totalCost?: number;
  note?: string;
  /** Marks both halves of a reversal pair (ADR-017). */
  undone?: boolean;
}

interface SessionSeed {
  id: string;
  name: string;
  eventId?: string;
  /** Days before today that it traded. */
  daysAgo: number;
  startHour: number;
  hours: number;
  /** Roughly how many tickets. */
  tickets: number;
  /** Left running, for the live-figure paths. */
  live?: boolean;
}

/**
 * What the stall did, and when.
 *
 * Laid out as data rather than generated from a rule, because the interesting
 * shapes — a three-day market, an event of one, a market planned but not yet
 * traded — are exactly the ones a rule would smooth away.
 */
const SESSIONS: SessionSeed[] = [
  // Six weeks back: regular evenings, before events were used at all.
  { id: 'ses-01', name: 'Thursday evening', daysAgo: 38, startHour: 17, hours: 4, tickets: 22 },
  { id: 'ses-02', name: 'Friday evening', daysAgo: 37, startHour: 17, hours: 5, tickets: 31 },
  { id: 'ses-03', name: 'Saturday evening', daysAgo: 31, startHour: 17, hours: 5, tickets: 35 },
  { id: 'ses-04', name: 'Thursday evening', daysAgo: 24, startHour: 17, hours: 4, tickets: 19 },
  { id: 'ses-05', name: 'Friday evening', daysAgo: 23, startHour: 17, hours: 5, tickets: 28 },

  // Riverside Market — one event, three days. This is the ADR-013 case: the
  // pitch fee is paid once, for the market, and is held out of each day's row.
  { id: 'ses-riv-1', name: 'Riverside · Friday', eventId: 'evt-riverside', daysAgo: 17, startHour: 11, hours: 7, tickets: 44 },
  { id: 'ses-riv-2', name: 'Riverside · Saturday', eventId: 'evt-riverside', daysAgo: 16, startHour: 10, hours: 9, tickets: 71 },
  { id: 'ses-riv-3', name: 'Riverside · Sunday', eventId: 'evt-riverside', daysAgo: 15, startHour: 10, hours: 7, tickets: 52 },

  { id: 'ses-06', name: 'Thursday evening', daysAgo: 10, startHour: 17, hours: 4, tickets: 24 },

  // An event of one — legitimate when a person declares it (ADR-020).
  { id: 'ses-truck', name: 'Food Truck Friday', eventId: 'evt-truck', daysAgo: 9, startHour: 12, hours: 6, tickets: 38 },

  { id: 'ses-07', name: 'Saturday evening', daysAgo: 3, startHour: 17, hours: 5, tickets: 33 },
  { id: 'ses-08', name: 'Sunday lunch', daysAgo: 2, startHour: 11, hours: 4, tickets: 26 },

  // Today, still running. Gives the live figures — revenue per trading hour,
  // the "Rs 4,300 to go" break-even case — something to be live about.
  { id: 'ses-live', name: 'Tonight', daysAgo: 0, startHour: 17, hours: 2, tickets: 11, live: true },
];

const EVENTS = (today: number): TradingEvent[] => [
  {
    id: 'evt-riverside',
    name: 'Riverside Market',
    plannedStart: today - 17 * DAY,
    plannedEnd: today - 15 * DAY,
    venue: 'Riverside Park',
    notes: 'Three days. Pitch paid up front for the whole run.',
    createdAt: today - 24 * DAY,
  },
  {
    id: 'evt-truck',
    name: 'Food Truck Friday',
    plannedStart: today - 9 * DAY,
    plannedEnd: today - 9 * DAY,
    venue: 'Tech park forecourt',
    createdAt: today - 14 * DAY,
  },
  {
    // Planned, no sessions, has not traded. `eventGroups` drops it so the scope
    // picker does not offer an empty period; `allEvents` keeps it so the cost
    // form can file next weekend's pitch fee against it today. That difference
    // is invisible without an event in exactly this state.
    id: 'evt-winter',
    name: 'Winter Fair',
    plannedStart: today + 5 * DAY,
    plannedEnd: today + 6 * DAY,
    venue: 'Town square',
    notes: 'Booked. Pitch fee already paid.',
    createdAt: today - 4 * DAY,
  },
];

/* ----------------------------------------------------------------- basket */

interface BasketLine {
  menuItemId: string;
  qty: number;
}

/** What one ticket contains. Weighted so the mix is not uniform. */
function basket(random: () => number): BasketLine[] {
  const lines: BasketLine[] = [];
  const roll = random();

  if (roll < 0.12) {
    lines.push({ menuItemId: 'm-meal', qty: 1 });
  } else {
    const mains: [string, number][] = [
      ['m-classic', 0.42], ['m-deluxe', 0.28], ['m-chicken', 0.2], ['m-fries', 0.1],
    ];
    let pick = random();
    let chosen = 'm-classic';
    for (const [id, weight] of mains) {
      if (pick < weight) { chosen = id; break; }
      pick -= weight;
    }
    lines.push({ menuItemId: chosen, qty: random() < 0.22 ? 2 : 1 });
    if (random() < 0.3) lines.push({ menuItemId: 'm-fries', qty: 1 });
  }

  const drink = random();
  if (drink < 0.4) lines.push({ menuItemId: 'm-coke', qty: random() < 0.2 ? 2 : 1 });
  else if (drink < 0.58) lines.push({ menuItemId: 'm-sprite', qty: 1 });
  else if (drink < 0.72) lines.push({ menuItemId: 'm-water', qty: 1 });

  return lines;
}

/* ------------------------------------------------------------------ build */

export interface DemoOptions {
  /** The moment the dataset is anchored to. Defaults to now. */
  now?: number;
}

export function buildDemoSnapshot(options: DemoOptions = {}): DataSnapshot {
  const now = options.now ?? Date.now();
  const today = midnight(now);
  const random = rng(20260825);

  const orders: Order[] = [];
  const movements: StockMovement[] = [];
  const oversells: OversellEvent[] = [];
  const snapshots: InventorySnapshot[] = [];
  const sessions: TradingSession[] = [];

  /* -- the shelf, simulated forward so every `resulting` is a real level -- */

  const level = new Map<string, number>(STOCK.map(s => [s.id, 0]));
  const unitCost = new Map<string, number>(STOCK.map(s => [s.id, s.cost]));
  const costUpdatedAt = new Map<string, number>();
  let movementSeq = 0;

  const post = (
    at: number,
    stockItemId: string,
    delta: number,
    reason: StockMovement['reason'],
    extra: Partial<StockMovement> = {},
  ): StockMovement => {
    const next = (level.get(stockItemId) ?? 0) + delta;
    level.set(stockItemId, next);
    const m: StockMovement = {
      id: `mv-${String((movementSeq += 1)).padStart(5, '0')}`,
      stockItemId,
      delta,
      resulting: next,
      reason,
      timestamp: at,
      ...extra,
    };
    movements.push(m);
    return m;
  };

  /* -- orders ------------------------------------------------------------ */

  interface PendingOrder { at: number; session: SessionSeed | null; lines: BasketLine[] }
  const pending: PendingOrder[] = [];

  for (const s of SESSIONS) {
    const start = today - s.daysAgo * DAY + s.startHour * HOUR;
    for (let i = 0; i < s.tickets; i += 1) {
      // Spread across the service with a lunchtime-ish clump rather than evenly.
      const through = (i + random() * 0.6) / s.tickets;
      const shaped = through ** 0.85;
      pending.push({ at: Math.round(start + shaped * s.hours * HOUR), session: s, lines: basket(random) });
    }
  }

  // Orders taken before sessions were used. Never guessed into one (invariant
  // 4), so Finance gives them a "Not in a session" row and the money ledger
  // rolls them up per day.
  for (const daysAgo of [41, 41, 40]) {
    const start = today - daysAgo * DAY + 18 * HOUR;
    for (let i = 0; i < 7; i += 1) {
      pending.push({ at: Math.round(start + i * 22 * MINUTE), session: null, lines: basket(random) });
    }
  }

  pending.sort((a, b) => a.at - b.at);

  /* -- deliveries, sized from what is actually about to be eaten -------- */

  /*
   * The stall buys for the service in front of it, plus a margin for a good
   * night. Derived from the baskets rather than guessed at, because a guess is
   * wrong in one of two ways and both of them ruin the dataset: buy too little
   * and every screen is a wall of oversells, buy too much and six weeks of
   * trading ends with more money on the shelf than went through the till, which
   * makes the cash view say the shop is failing when it is not.
   */
  const BUFFER = 1.04;

  const needFor = (from: number, to: number) => {
    const need = new Map<string, number>();
    for (const p of pending) {
      if (p.at < from || p.at >= to) continue;
      for (const line of p.lines) {
        for (const ing of ingredientsOf(line.menuItemId, MENU)) {
          need.set(ing.stockItemId, (need.get(ing.stockItemId) ?? 0) + ing.qty * line.qty);
        }
      }
    }
    return need;
  };

  const shelfEvents: ShelfEvent[] = [];

  /*
   * Ingredient prices drift upward across the six weeks.
   *
   * Not decoration. `unitCost` is frozen onto every line at checkout, so a
   * rising wholesale price is what makes *realised margin* — what the things
   * actually sold for against what they actually cost — differ from *margin
   * today*. Those are two different figures for a reason (ADR-015), and on a
   * dataset with flat prices they are the same number and the distinction
   * cannot be seen.
   */
  const priceAt = (base: number, daysAgo: number) => base * (1 + 0.09 * (1 - daysAgo / 42));

  const restocks = [
    ...SESSIONS.map(s => ({ daysAgo: s.daysAgo, at: today - (s.daysAgo + 2) * DAY + 9 * HOUR })),
    // The loose orders, before sessions were used, were fed by their own runs.
    { daysAgo: 41, at: today - 43 * DAY + 9 * HOUR },
    { daysAgo: 40, at: today - 42 * DAY + 9 * HOUR },
  ].sort((a, b) => a.at - b.at);

  /*
   * One run where the stall got it wrong.
   *
   * The Riverside weekend was busier than the order, and the patties went
   * before the Sunday queue did. That is what an `OversellEvent` records — a
   * direct measurement of demand the shelf could not meet, which normally has
   * to be inferred from a suspicious run of zeroes — and the Business table's
   * *Ran out* column has nothing to say without it.
   */
  const SHORT: Record<string, { id: string; factor: number }> = {
    '17': { id: 's-patty', factor: 0.78 },
  };

  restocks.forEach((r, i) => {
    // Everything that will be sold between this restock and the next one.
    const until = restocks[i + 1]?.at ?? now + DAY;
    const need = needFor(r.at, until);
    let offset = 0;
    for (const item of STOCK) {
      if (item.id === 's-napkin') continue;
      const want = need.get(item.id) ?? 0;
      if (want <= 0) continue;
      // Round to something a wholesaler would actually hand over.
      const step = item.unit === 'g' ? 500 : item.packetSize ?? 1;
      const short = SHORT[String(r.daysAgo)];
      const buffer = short && short.id === item.id ? short.factor : BUFFER;
      const qty = Math.max(step, Math.round((want * buffer) / step) * step);
      const per = priceAt(item.cost, r.daysAgo);
      shelfEvents.push({
        at: r.at + (offset += 4) * MINUTE,
        kind: 'delivery',
        stockItemId: item.id,
        qty,
        totalCost: Math.round(qty * per),
        ...(item.packetSize && qty % item.packetSize === 0
          ? { note: `${qty / item.packetSize} × ${item.packetLabel ?? 'pack'}` }
          : {}),
      });
    }
  });

  // Napkins, bought in bulk and never priced. This is the delivery the money
  // ledger has to show as `—`, and the reason its running total is a floor.
  shelfEvents.push(
    { at: today - 34 * DAY + 10 * HOUR, kind: 'delivery', stockItemId: 's-napkin', qty: 2000, note: 'Cash and carry — receipt lost' },
    { at: today - 12 * DAY + 10 * HOUR, kind: 'delivery', stockItemId: 's-napkin', qty: 1500 },
  );

  // A delivery that was entered and then undone. Both halves carry `reversed`,
  // so no economic figure counts it and no pairing logic is needed (ADR-017).
  shelfEvents.push({
    at: today - 20 * DAY + 11 * HOUR,
    kind: 'delivery',
    stockItemId: 's-patty',
    qty: 24,
    totalCost: 3100,
    note: 'Entered twice',
    undone: true,
  });

  // Waste, a count that found less than the book said, and a correction — which
  // looks like a delivery on the shelf and is not a purchase (ADR-014).
  shelfEvents.push(
    { at: today - 30 * DAY + 22 * HOUR, kind: 'waste', stockItemId: 's-bun', qty: 14, note: 'Stale' },
    { at: today - 16 * DAY + 21 * HOUR, kind: 'waste', stockItemId: 's-patty', qty: 6, note: 'Dropped a tray' },
    { at: today - 15 * DAY + 20 * HOUR, kind: 'waste', stockItemId: 's-potato', qty: 1200, note: 'Went soft' },
    { at: today - 9 * DAY + 21 * HOUR, kind: 'stocktake', stockItemId: 's-cheese', qty: -11, note: 'End of month count' },
    { at: today - 9 * DAY + 21 * HOUR + MINUTE, kind: 'stocktake', stockItemId: 's-coke', qty: 4, note: 'End of month count' },
    { at: today - 22 * DAY + 9 * HOUR, kind: 'correction', stockItemId: 's-bun', qty: 12, note: 'Miscounted on Friday' },
  );

  /* -- walk the whole timeline in order --------------------------------- */

  const shelfQueue = [...shelfEvents].sort((a, b) => a.at - b.at);
  const ticketCounters = new Map<string, number>();
  let seq = 0;
  let shelfIndex = 0;

  const drainShelfUntil = (at: number) => {
    while (shelfIndex < shelfQueue.length && shelfQueue[shelfIndex].at <= at) {
      const e = shelfQueue[shelfIndex];
      shelfIndex += 1;
      if (e.kind === 'delivery') {
        const priced = e.totalCost !== undefined;
        const per = priced ? e.totalCost! / e.qty : undefined;
        const delivery = post(e.at, e.stockItemId, e.qty, 'added', {
          ...(e.note ? { note: e.note } : {}),
          ...(priced ? { unitCost: per, totalCost: e.totalCost } : {}),
          ...(e.undone ? { reversed: true } : {}),
        });
        if (priced && !e.undone) {
          unitCost.set(e.stockItemId, per!);
          costUpdatedAt.set(e.stockItemId, e.at);
        }
        if (e.undone) {
          // The compensating line points back at the original by immutable id
          // and marks itself. `reason: 'reversal'` is bookkeeping, never an
          // event — which is exactly what ADR-016 separates it from.
          post(e.at + 4 * HOUR, e.stockItemId, -e.qty, 'reversal', {
            note: 'Undone',
            referenceType: 'movement',
            referenceId: delivery.id,
            reversed: true,
          });
        }
      } else if (e.kind === 'waste') {
        post(e.at, e.stockItemId, -e.qty, 'waste', e.note ? { note: e.note } : {});
      } else if (e.kind === 'stocktake') {
        post(e.at, e.stockItemId, e.qty, 'stocktake', {
          ...(e.note ? { note: e.note } : {}),
          referenceType: 'stocktake',
        });
      } else {
        post(e.at, e.stockItemId, e.qty, 'correction', e.note ? { note: e.note } : {});
      }
    }
  };

  for (const p of pending) {
    drainShelfUntil(p.at);

    const menuOf = (id: string) => MENU.find(m => m.id === id)!;
    seq += 1;
    const orderId = `ord-${String(seq).padStart(5, '0')}`;

    // The first fortnight predates costing. `unitCost` is left undefined, which
    // is not zero and must never be read as it — invariant 2, and what makes
    // the coverage figure and the "or earlier" crossing caveat visible.
    const costed = p.at >= today - 33 * DAY;

    const items = p.lines.map(line => {
      const item = menuOf(line.menuItemId);
      const ingredients = ingredientsOf(line.menuItemId, MENU);

      // Take the stock, and record what could not be taken as censored demand.
      let short = 0;
      for (const ing of ingredients) {
        const want = ing.qty * line.qty;
        const have = level.get(ing.stockItemId) ?? 0;
        if (have < want && ing.stockItemId !== 's-napkin') {
          short = Math.max(short, Math.ceil((want - have) / ing.qty));
        }
      }
      for (const ing of ingredients) {
        post(p.at, ing.stockItemId, -(ing.qty * line.qty), 'sold', {
          referenceType: 'order',
          referenceId: orderId,
        });
      }
      if (short > 0) {
        oversells.push({
          id: `ovs-${orderId}-${line.menuItemId}`,
          menuItemId: item.id,
          menuItemName: item.name,
          quantity: short,
          bottleneckStockItemId: ingredients[0]?.stockItemId,
          orderId,
          timestamp: p.at,
        });
      }

      const frozen = ingredients.reduce(
        (sum, ing) => sum + ing.qty * (unitCost.get(ing.stockItemId) ?? 0), 0);

      return {
        menuItemId: item.id,
        name: item.name,
        price: item.price,
        quantity: line.qty,
        ...(item.dealItems ? { dealItems: item.dealItems } : {}),
        ...(costed ? { unitCost: Math.round(frozen * 100) / 100 } : {}),
        ...(short > 0 ? { oversoldQuantity: short } : {}),
      };
    });

    const subtotal = items.reduce((sum, i) => sum + i.price * i.quantity, 0);

    // A discount on roughly one ticket in fourteen, so the Discounts column and
    // the discount-rate figure have something in them.
    const discounted = random() < 0.07;
    const discount = discounted
      ? (random() < 0.5
        ? { kind: 'percent' as const, value: 10 }
        : { kind: 'flat' as const, value: 100 })
      : undefined;
    const discountAmount = !discount
      ? 0
      : discount.kind === 'percent'
        ? Math.round(subtotal * discount.value) / 100
        : Math.min(discount.value, subtotal);

    const ticket = p.session
      ? (ticketCounters.set(p.session.id, (ticketCounters.get(p.session.id) ?? 0) + 1),
        ticketCounters.get(p.session.id)!)
      : undefined;

    // Voided about one ticket in fifty. The row stays — a cancelled sale is a
    // fact worth keeping — and every money figure excludes it (invariant 5).
    const voided = random() < 0.02;

    orders.push({
      id: orderId,
      seq,
      orderNumber: String(seq).padStart(2, '0'),
      customerName: 'Customer',
      items,
      notes: '',
      status: 'completed',
      subtotal,
      ...(discount ? { discount } : {}),
      discountAmount,
      taxRate: 0,
      taxAmount: 0,
      total: subtotal - discountAmount,
      timestamp: p.at,
      paid: random() < 0.62 ? 'cash' : 'transfer',
      grilledAt: p.at + Math.round(60_000 + random() * 90_000),
      readyAt: p.at + Math.round(3 * MINUTE + random() * 9 * MINUTE),
      completedAt: p.at + Math.round(4 * MINUTE + random() * 11 * MINUTE),
      ...(p.session ? { sessionId: p.session.id, sessionTicket: ticket } : {}),
      ...(voided ? { voidedAt: p.at + 6 * MINUTE, voidReason: 'Customer left' } : {}),
    });
  }

  drainShelfUntil(now);

  /* -- sessions ---------------------------------------------------------- */

  for (const s of SESSIONS) {
    const startedAt = today - s.daysAgo * DAY + s.startHour * HOUR;
    sessions.push({
      id: s.id,
      name: s.name,
      status: s.live ? 'active' : 'ended',
      startedAt,
      ...(s.live ? {} : { endedAt: startedAt + s.hours * HOUR }),
      ticketCounter: ticketCounters.get(s.id) ?? 0,
      // A real service stops for twenty minutes. `sessionTradingHours` excludes
      // it, and revenue per trading hour is wrong if it does not.
      pausedMs: s.live ? 0 : 20 * MINUTE,
      ...(s.eventId ? { eventId: s.eventId } : {}),
    });
  }

  /* -- costs, one of every basis ---------------------------------------- */

  const costEntries: CostEntry[] = [];
  let costSeq = 0;
  const cost = (c: Omit<CostEntry, 'id'>): void => {
    costEntries.push({ id: `cost-${String((costSeq += 1)).padStart(4, '0')}`, ...c });
  };

  /*
   * What a service costs to stand up, before anything is sold.
   *
   * Sized so break-even lands somewhere in the middle of a service rather than
   * on the fifth ticket. A dataset where every day pays for itself before the
   * queue forms demonstrates the column exists and nothing else; the figure is
   * only interesting when it is genuinely in doubt for a while.
   */
  for (const s of SESSIONS) {
    const startedAt = today - s.daysAgo * DAY + s.startHour * HOUR;
    const hands = s.tickets > 40 ? 2 : 1;
    cost({
      sessionId: s.id,
      amount: 900 * s.hours * hands,
      note: hands > 1 ? 'Staff — two on' : 'Staff — one shift',
      basis: 'per-session',
      timestamp: startedAt + 15 * MINUTE,
    });
    cost({
      sessionId: s.id,
      amount: 1200,
      note: 'Gas and fuel',
      basis: 'per-session',
      timestamp: startedAt + 20 * MINUTE,
    });
    if (s.eventId) {
      cost({
        sessionId: s.id,
        amount: 2500,
        note: 'Van hire and setup',
        basis: 'per-session',
        timestamp: startedAt + 25 * MINUTE,
      });
    }
  }

  // The ADR-013 case: paid once, for the market. Held out of each day's row on
  // Finance, and shown on the day it was paid in the money ledger (ADR-025).
  cost({
    eventId: 'evt-riverside',
    amount: 9000,
    note: 'Riverside pitch — whole weekend',
    basis: 'per-event',
    timestamp: today - 17 * DAY + 9 * HOUR,
  });
  cost({
    eventId: 'evt-truck',
    amount: 2500,
    note: 'Food Truck Friday pitch',
    basis: 'per-event',
    timestamp: today - 9 * DAY + 11 * HOUR,
  });
  // Filed against a market that has not traded yet — the case `allEvents`
  // exists for, and the reason the cost target picker and the scope picker
  // deliberately offer different things.
  cost({
    eventId: 'evt-winter',
    amount: 12000,
    note: 'Winter Fair pitch — paid in advance',
    basis: 'per-event',
    timestamp: today - 4 * DAY + 14 * HOUR,
  });

  // The three rate bases. Amounts here are rates, not rupees — which is the
  // whole of what `resolveEntryAmount` and ADR-026 are about.
  cost({
    sessionId: 'ses-riv-2',
    amount: 15,
    note: 'Packaging per ticket',
    basis: 'per-order',
    timestamp: today - 16 * DAY + 10 * HOUR,
  });
  cost({
    sessionId: 'ses-riv-2',
    amount: 8,
    note: 'Napkins and cutlery',
    basis: 'per-unit',
    timestamp: today - 16 * DAY + 10 * HOUR + MINUTE,
  });
  // Targeted at a category (ADR-022): burger boxes are a Food cost and a can of
  // Coke does not carry one. Stored by category **id**, never by name.
  cost({
    sessionId: 'ses-riv-2',
    amount: 25,
    note: 'Burger boxes',
    basis: 'per-unit',
    appliesTo: { kind: 'category', id: 'cat-food' },
    timestamp: today - 16 * DAY + 10 * HOUR + 2 * MINUTE,
  });
  cost({
    sessionId: 'ses-truck',
    amount: 12,
    note: 'Delivery app commission',
    basis: 'per-revenue',
    timestamp: today - 9 * DAY + 12 * HOUR,
  });


  // Logged outside any session and against no event: the dated case, which
  // belongs to the range and to nothing narrower.
  cost({
    amount: 4500,
    note: 'Gas cylinder refill',
    basis: 'per-session',
    timestamp: today - 27 * DAY + 12 * HOUR,
  });

  /* -- daily snapshots, so historical value never replays the ledger ----- */

  const byDay = new Map<string, Map<string, number>>();
  const running = new Map<string, number>(STOCK.map(s => [s.id, 0]));
  for (const m of [...movements].sort((a, b) => a.timestamp - b.timestamp)) {
    running.set(m.stockItemId, m.resulting);
    byDay.set(dateKey(m.timestamp), new Map(running));
  }
  for (const [date, levels] of byDay) {
    for (const s of STOCK) {
      const quantity = levels.get(s.id) ?? 0;
      const unit = unitCost.get(s.id) ?? s.cost;
      snapshots.push({ date, stockItemId: s.id, quantity, unitCost: unit, value: quantity * unit });
    }
  }

  /* -- the shelf as it stands now ---------------------------------------- */

  const stockItems: StockItem[] = STOCK.map(s => ({
    id: s.id,
    name: s.name,
    quantity: Math.round((level.get(s.id) ?? 0) * 100) / 100,
    unit: s.unit,
    lowStockThreshold: s.threshold,
    costPerUnit: Math.round((unitCost.get(s.id) ?? s.cost) * 100) / 100,
    ...(costUpdatedAt.has(s.id) ? { costUpdatedAt: costUpdatedAt.get(s.id) } : {}),
    ...(s.packetSize ? { packetSize: s.packetSize } : {}),
    ...(s.packetLabel ? { packetLabel: s.packetLabel } : {}),
    ...(s.packetCost ? { packetCost: s.packetCost } : {}),
  }));

  return {
    menuItems: MENU,
    categories: CATEGORIES,
    orders,
    parkedSessions: [],
    stockItems,
    stockAssignments: RECIPES,
    stockMovements: movements,
    inventorySnapshots: snapshots,
    oversellEvents: oversells,
    orderCounter: seq + 1,
    tradingSessions: sessions,
    tradingEvents: EVENTS(today),
    costEntries,
  };
}

/** A one-line description of what was built, for the script and the console. */
export function describeDemo(data: DataSnapshot): string {
  const traded = data.orders.filter(o => !o.voidedAt).length;
  return [
    `${data.orders.length} orders (${data.orders.length - traded} voided)`,
    `${data.tradingSessions.length} sessions`,
    `${data.tradingEvents.length} events`,
    `${data.costEntries.length} costs`,
    `${data.stockMovements.length} stock movements`,
    `${data.inventorySnapshots.length} snapshots`,
  ].join(' · ');
}
