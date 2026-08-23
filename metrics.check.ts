/**
 * Hand-computed checks for the analytics added alongside the session system.
 *
 * Not a test suite — the project has no runner — but every figure below was
 * worked out on paper first, so a change that quietly alters a formula has
 * something to fail against. Run with `npx tsx metrics.check.ts`.
 */
import {
  attachmentPairs, breakEven, costSummary, deadStock, foodCost, inventoryTurnover,
  queueBands, resolveRange, stockoutStats, totalsFor, voidStats,
} from './src/app/analytics/metrics';
import {
  endSession, pauseSession, resumeSession, sessionTradingHours, startSession,
} from './src/app/lib/sessions';
import { resolveScope } from './src/app/analytics/scope';
import {
  categoryIndex, matchesSearch, parseSearch, searchHaystack, sessionIndex,
} from './src/app/analytics/search';
import type {
  CostEntry, InventorySnapshot, Order, OversellEvent, StockItem, StockMovement,
} from './src/app/types';

let failures = 0;
const near = (a: number | null, b: number, tol = 0.01) =>
  a !== null && Math.abs(a - b) <= tol;

function check(label: string, actual: unknown, expected: unknown) {
  const ok = typeof actual === 'number' && typeof expected === 'number'
    ? near(actual, expected)
    : JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label.padEnd(46)} ${JSON.stringify(actual)}${ok ? '' : `  expected ${JSON.stringify(expected)}`}`);
}

const HOUR = 3_600_000;
const T = 1_700_000_000_000;
const ALL = resolveRange('all', undefined, T + 100 * HOUR);

function order(over: Partial<Order>): Order {
  return {
    id: 'o', seq: 1, orderNumber: '01', customerName: 'C', items: [], notes: '',
    status: 'completed', subtotal: 0, discountAmount: 0, taxRate: 0, taxAmount: 0,
    total: 0, timestamp: T, ...over,
  };
}
const line = (id: string, name: string, qty: number, price: number, unitCost?: number) =>
  ({ menuItemId: id, name, quantity: qty, price, unitCost });

/* ------------------------------------------------------------- break-even */
// 10 units at Rs 100 with a Rs 40 ingredient cost: revenue 1000, COGS 400.
// Gross ratio 0.6; variable costs of 200 are 0.2 of revenue; contribution 0.4.
// Break-even revenue = 1000 / 0.4 = 2500. Contribution per unit = 100 × 0.4 = 40,
// so break-even units = 1000 / 40 = 25.
console.log('\nBreak-even');
const beOrders = [order({ items: [line('a', 'Burger', 10, 100, 40)], subtotal: 1000, total: 1000 })];
const beTotals = totalsFor(beOrders);
const beCosts = costSummary([
  { id: 'c1', amount: 1000, note: 'pitch', kind: 'fixed', timestamp: T },
  { id: 'c2', amount: 200, note: 'boxes', kind: 'variable', timestamp: T },
] as CostEntry[]);
const be = breakEven(beTotals, beCosts);
check('contribution ratio', be.contributionRatio, 0.4);
check('contribution per unit', be.contributionPerUnit, 40);
check('break-even revenue', be.revenue, 2500);
check('break-even units', be.units, 25);
check('progress towards it', be.progress, 0.4);

// Nothing logged is not the same as breaking even at zero.
const noCosts = breakEven(beTotals, costSummary([]));
check('blocked without fixed costs', noCosts.blocked, 'No fixed costs logged');
check('and reports no revenue figure', noCosts.revenue, null);

// Costs that exceed the margin have no break-even at any volume.
const drowning = breakEven(beTotals, costSummary([
  { id: 'c1', amount: 500, note: 'pitch', kind: 'fixed', timestamp: T },
  { id: 'c2', amount: 900, note: 'staff', kind: 'variable', timestamp: T },
] as CostEntry[]));
check('blocked when margin is negative', drowning.revenue, null);

/* ------------------------------------------------------------- void rate */
// Three live orders worth 1000 and one voided worth 200.
console.log('\nVoid rate');
const voidOrders = [
  order({ id: '1', items: [line('a', 'Burger', 5, 100)], subtotal: 500 }),
  order({ id: '2', items: [line('a', 'Burger', 5, 100)], subtotal: 500 }),
  order({ id: '3', items: [line('a', 'Burger', 0, 100)], subtotal: 0 }),
  order({ id: '4', items: [line('a', 'Burger', 2, 100)], subtotal: 200, voidedAt: T + 1 }),
];
const v = voidStats(voidOrders);
check('voided count', v.voided, 1);
check('by count %', v.byCountPct, 25);
check('voided value', v.voidedValue, 200);
check('by value %', v.byValuePct, (200 / 1200) * 100);

/* -------------------------------------------------------- attachment rate */
// A appears in all four baskets, B in two of them, both together twice.
// Expected co-occurrence by chance = (4/4)(2/4)×4 = 2, and they occur together
// twice — so lift is exactly 1: B rides along with A, it is not drawn by it.
console.log('\nAttachment');
const basket = (id: string, ids: string[]) =>
  order({ id, items: ids.map(i => line(i, i.toUpperCase(), 1, 100)) });
const pairs = attachmentPairs(
  [basket('1', ['a', 'b']), basket('2', ['a', 'b']), basket('3', ['a', 'c']), basket('4', ['a'])],
  [{ id: 'a', name: 'A', price: 100, showInOrderMode: true, category: 'Food' },
   { id: 'b', name: 'B', price: 100, showInOrderMode: true, category: 'Food' },
   { id: 'c', name: 'C', price: 100, showInOrderMode: true, category: 'Food' }],
  ALL,
);
check('one pair clears the threshold', pairs.length, 1);
check('orders together', pairs[0].together, 2);
check('A → B attachment %', pairs[0].attachmentPct, 50);
check('B → A attachment %', pairs[0].reverseAttachmentPct, 100);
check('lift is coincidence', pairs[0].lift, 1);

/* --------------------------------------------------------------- food cost */
// Opening 5000 + purchases 2000 − closing 4000 = 3000 actually consumed,
// against 400 the recipes account for: 2600 unexplained.
console.log('\nFood cost');
const snapshots: InventorySnapshot[] = [
  { date: new Date(T - 48 * HOUR).toISOString().slice(0, 10), stockItemId: 's1', quantity: 100, unitCost: 50, value: 5000 },
];
const movements: StockMovement[] = [
  { id: 'm1', stockItemId: 's1', delta: 40, resulting: 140, reason: 'added', totalCost: 2000, timestamp: T + HOUR },
];
const stock: StockItem[] = [
  { id: 's1', name: 'Mince', quantity: 80, unit: 'kg', lowStockThreshold: 10, costPerUnit: 50 },
];
// The window opens before the ledger's only line — a +40 that left 140 behind,
// so 100 was already on the shelf. Reconstructed rather than assumed empty.
const window = { start: T - 24 * HOUR, end: T + 100 * HOUR, label: 'window' };
const fc = foodCost(beTotals, movements, snapshots, stock, window, T + 50 * HOUR);
check('opening reconstructed from the ledger', fc.openingValue, 5000);
check('purchases', fc.purchases, 2000);
check('closing value (on the shelf)', fc.closingValue, 4000);
check('actual food cost', fc.actual, 3000);
check('theoretical food cost', fc.theoretical, 400);
check('variance', fc.variance, 2600);
check('estimated until stock is counted', fc.basis, 'ledger');

// All time reaches back past every record, and still answers: the same
// reconstruction applies, so the figure does not collapse to a nonsense
// negative just because the scope is wide.
const allTime = foodCost(beTotals, movements, snapshots, stock, ALL, T + 100 * HOUR);
check('all-time opening', allTime.openingValue, 5000);
check('all-time actual is available', allTime.actual, 5000 + 2000 - 4000);

// A ledger that starts from nothing reconstructs a genuinely empty shelf.
const fromScratch = foodCost(
  beTotals,
  [{ id: 'z', stockItemId: 's1', delta: 100, resulting: 100, reason: 'added', totalCost: 5000, timestamp: T }],
  [], stock, ALL, T + 100 * HOUR);
check('an empty shelf stays empty', fromScratch.openingValue, 0);

// Neither ledger nor snapshot reaches the window: no figure, and it says why.
const orphan = foodCost(
  beTotals, [], [], stock,
  { start: T + 2 * HOUR, end: T + 100 * HOUR, label: 'orphan' }, T + 50 * HOUR);
check('no anchor, no figure', orphan.actual, null);
check('and it says why', typeof orphan.blocked, 'string');

/* -------------------------------------- food cost — the ledger beats a snapshot */
// Mince ran 100 → 60 before the window opened. The morning's snapshot still
// claims 100 on the shelf; the ledger knows better, and is used.
console.log('\nFood cost — ledger anchoring');
const shelf: StockMovement[] = [
  { id: 'a', stockItemId: 's1', delta: -40, resulting: 60, reason: 'sold', timestamp: T - 2 * HOUR },
  { id: 'b', stockItemId: 's1', delta: 40, resulting: 100, reason: 'added', totalCost: 2000, timestamp: T + HOUR },
  { id: 'c', stockItemId: 's1', delta: -20, resulting: 80, reason: 'sold', timestamp: T + 2 * HOUR },
];
const session = { start: T - HOUR, end: T + 3 * HOUR, label: 'session' };
const replayed = foodCost(beTotals, shelf, snapshots, stock, session, T + 50 * HOUR);
check('opening replayed from the ledger', replayed.openingValue, 60 * 50);
check('closing replayed from the ledger', replayed.closingValue, 80 * 50);
check('purchases inside the window', replayed.purchases, 2000);
check('actual', replayed.actual, 3000 + 2000 - 4000);
check('still an estimate', replayed.basis, 'ledger');

// An item whose ledger begins after the window opened started from the level
// its first movement stepped away from — not from nothing.
const early = foodCost(
  beTotals, shelf, [], stock,
  { start: T - 3 * HOUR, end: T + 3 * HOUR, label: 'early' }, T + 50 * HOUR);
check('level before the first movement', early.openingValue, (60 + 40) * 50);

// Counting stock changes nothing about the arithmetic and everything about the
// confidence: the count writes a correcting movement already inside the sum.
const counted = foodCost(
  beTotals,
  [...shelf, { id: 'd', stockItemId: 's1', delta: -2, resulting: 78, reason: 'stocktake', timestamp: T + 2.5 * HOUR }],
  snapshots, stock, session, T + 50 * HOUR,
);
check('basis upgrades to counted', counted.basis, 'counted');
check('and records when', counted.countedAt, T + 2.5 * HOUR);
check('the count lands in closing stock', counted.closingValue, 78 * 50);
check('and moves the variance', counted.variance, (3000 + 2000 - 3900) - 400);

/* --------------------------------------------------------------- turnover */
// COGS 400 over an average stock value of 2000 is a fifth of a turn.
console.log('\nInventory turnover');
const day = (offset: number) => new Date(T + offset * 24 * HOUR).toISOString().slice(0, 10);
const turn = inventoryTurnover(
  beTotals,
  [
    { date: day(0), stockItemId: 's1', quantity: 20, unitCost: 50, value: 1000 },
    { date: day(1), stockItemId: 's1', quantity: 60, unitCost: 50, value: 3000 },
  ],
  stock,
  { start: T - HOUR, end: T + 72 * HOUR, label: 'window' },
);
check('average inventory', turn.averageInventory, 2000);
check('turns', turn.turns, 0.2);

/* -------------------------------------------------------------- stockouts */
// The ledger dips to zero twice. The run of zeroes in between is one stockout,
// not three — only the crossing counts.
console.log('\nStockouts');
const ledger: StockMovement[] = [
  { id: '1', stockItemId: 's1', delta: -5, resulting: 5, reason: 'sold', timestamp: T + 1 },
  { id: '2', stockItemId: 's1', delta: -5, resulting: 0, reason: 'sold', timestamp: T + 2 },
  { id: '3', stockItemId: 's1', delta: 0, resulting: 0, reason: 'sold', timestamp: T + 3 },
  { id: '4', stockItemId: 's1', delta: 10, resulting: 10, reason: 'added', timestamp: T + 4 },
  { id: '5', stockItemId: 's1', delta: -10, resulting: 0, reason: 'sold', timestamp: T + 5 },
  { id: '6', stockItemId: 's2', delta: -1, resulting: 9, reason: 'sold', timestamp: T + 6 },
];
const outs = stockoutStats(ledger, [
  ...stock,
  { id: 's2', name: 'Buns', quantity: 9, unit: 'pcs', lowStockThreshold: 2, costPerUnit: 10 },
], [{ id: 'e1', menuItemId: 'a', menuItemName: 'Burger', quantity: 3, timestamp: T + 2 }] as OversellEvent[], ALL);
check('items that ran out', outs.itemsOut, 1);
check('items that moved at all', outs.itemsTracked, 2);
check('stockout rate %', outs.ratePct, 50);
check('crossings, not zero rows', outs.occasions, 2);
check('units sold beyond stock', outs.oversoldUnits, 3);

/* ------------------------------------------------------------- dead stock */
console.log('\nDead stock');
const dead = deadStock(
  [...stock, { id: 's2', name: 'Buns', quantity: 9, unit: 'pcs', lowStockThreshold: 2, costPerUnit: 10 }],
  [
    { id: '1', stockItemId: 's1', delta: -1, resulting: 5, reason: 'sold', timestamp: T - 30 * 24 * HOUR },
    { id: '2', stockItemId: 's2', delta: -1, resulting: 9, reason: 'sold', timestamp: T - 2 * 24 * HOUR },
  ],
  T,
  2,
);
check('idle longest comes first', dead[0].stockItem.name, 'Mince');
check('idle days', Math.round(dead[0].idleDays ?? 0), 30);
check('value held', dead[0].value, 4000);

/* ------------------------------------------------------------ queue bands */
console.log('\nQueue time');
const timed = [
  order({ id: '1', timestamp: T, readyAt: T + 60_000 }),           // 1 min
  order({ id: '2', timestamp: T, readyAt: T + 4 * 60_000 }),       // 4 min
  order({ id: '3', timestamp: T, readyAt: T + 25 * 60_000 }),      // 25 min
  order({ id: '4', timestamp: T, readyAt: T + 25 * 60_000 }),      // 25 min
];
const bands = queueBands(timed, ALL);
check('under 2 minutes', bands[0].orders, 1);
check('2 to 5 minutes', bands[1].orders, 1);
check('20 and over', bands[4].orders, 2);
check('share of the slow band', bands[4].share, 0.5);

/* ---------------------------------------------------------- session clock */
// Four hours open, twelve hours paused overnight, four hours open again is an
// eight hour session — not twenty.
console.log('\nSession clock');
let s = startSession([], T, 'Market');
s = pauseSession(s, T + 4 * HOUR);
s = resumeSession(s, T + 16 * HOUR);
s = endSession(s, T + 20 * HOUR);
check('trading hours exclude the pause', sessionTradingHours(s, T + 20 * HOUR), 8);
check('paused time is banked', s.pausedMs / HOUR, 12);
check('ticket counter untouched by pausing', s.ticketCounter, 0);

/* ----------------------------------------------------- the clock is a value */
// A live session's trading hours are a function of the moment they are read
// at, and every call site now passes that moment in rather than reaching for
// Date.now() itself. Read the same session an hour later and the figure must
// have moved by an hour — that is precisely what was broken: the time was
// captured once when the screen opened, was in no dependency array, and so
// never advanced while a service ran.
console.log('\nLive session clock');
const running = startSession([], T, 'Live');
const twoHoursIn = sessionTradingHours(running, T + 2 * HOUR);
const threeHoursIn = sessionTradingHours(running, T + 3 * HOUR);
check('two hours in', twoHoursIn, 2);
check('an hour later', threeHoursIn, 3);
check('the figure moved', threeHoursIn - twoHoursIn, 1);

// A paused session's clock does not move, however far `now` advances. Pausing
// banks the moment, which is what keeps a night between two market days out of
// revenue per trading hour.
const held = pauseSession(running, T + 2 * HOUR);
check('paused at two hours', sessionTradingHours(held, T + 2 * HOUR), 2);
check('and still two an hour later', sessionTradingHours(held, T + 3 * HOUR), 2);

// The same holds one layer up. `resolveScope` used to default `now` to
// Date.now(), so a session scope's trading hours and its resolved window were
// both frozen at whatever time the screen was opened.
const scopeAt = (at: number) => resolveScope(
  { kind: 'session', id: running.id },
  { orders: [], costs: [], sessions: [running], events: [], now: at },
);
check('scope hours at T+2h', scopeAt(T + 2 * HOUR).tradingHours, 2);
check('scope hours at T+3h', scopeAt(T + 3 * HOUR).tradingHours, 3);
// A running session has no end but the moment it is being read at, so the
// window it resolves to grows with the clock.
check(
  'the window follows the clock',
  scopeAt(T + 3 * HOUR).range.end - scopeAt(T + 2 * HOUR).range.end,
  HOUR,
);

// And a date preset is a function of the clock too — "Today" is a different
// window tomorrow, which a frozen `now` could never notice.
check(
  'today moves on',
  resolveRange('today', undefined, T + 24 * HOUR).start
    > resolveRange('today', undefined, T).start,
  true,
);

/* ---------------------------------------------------------------- search */
console.log('\nSearch grammar');
check('comma means both', parseSearch('burgers, cash'), [['burgers', 'cash']]);
check('ampersand means both', parseSearch('burgers & cash'), [['burgers', 'cash']]);
check('a space means both', parseSearch('burgers cash'), [['burgers', 'cash']]);
check('slash means either', parseSearch('burgers/cash'), [['burgers'], ['cash']]);
check('the word or means either', parseSearch('burger or cash'), [['burger'], ['cash']]);
check('and binds tighter than or', parseSearch('burgers, cash / wraps'), [['burgers', 'cash'], ['wraps']]);
check('quotes keep a name whole', parseSearch('"chicken burger", cash'), [['chicken burger', 'cash']]);
check('an empty query matches everything', parseSearch('   '), []);

// A market's name should find that market's orders, the same way "cash" finds
// cash ones — without anyone learning which field it lives in.
const sessionNames = sessionIndex(
  [{ id: 'ses1', name: 'Saturday', status: 'ended', startedAt: T, ticketCounter: 3, pausedMs: 0, eventId: 'evt1' }],
  [{ id: 'evt1', name: 'Winter Market', createdAt: T }],
);
const inSession = order({
  id: 'x', sessionId: 'ses1', sessionTicket: 4, paid: 'cash',
  items: [line('a', 'Chicken Burger', 1, 100)],
});
const hay = searchHaystack(inSession, categoryIndex(
  [{ id: 'a', name: 'Chicken Burger', price: 100, showInOrderMode: true, category: 'Food' }]), sessionNames);
check('finds by event name', matchesSearch(hay, parseSearch('winter')), true);
check('finds by session name', matchesSearch(hay, parseSearch('saturday')), true);
check('event and payment together', matchesSearch(hay, parseSearch('winter, cash')), true);
check('event and the wrong payment', matchesSearch(hay, parseSearch('winter, transfer')), false);
check('either side of a slash', matchesSearch(hay, parseSearch('summer/winter')), true);
check('category still matches', matchesSearch(hay, parseSearch('food')), true);

console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) FAILED.`}`);
process.exit(failures === 0 ? 0 : 1);
