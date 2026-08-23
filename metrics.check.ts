/**
 * Hand-computed checks for the analytics added alongside the session system.
 *
 * Not a test suite — the project has no runner — but every figure below was
 * worked out on paper first, so a change that quietly alters a formula has
 * something to fail against. Run with `npx tsx metrics.check.ts`.
 */
import {
  BREAK_EVEN_BLOCKED, attachmentPairs, breakEven, breakEvenByItem, costSummary, deadStock,
  foodCost, inventoryTurnover, itemMargins, itemPerformance, queueBands, resolveRange,
  stockoutStats, totalsFor, voidStats,
} from './src/app/analytics/metrics';
import {
  costEntryIsCoherent, costsForEvent, endSession, needsRefiling, pauseSession, resumeSession,
  sessionTradingHours, startSession,
} from './src/app/lib/sessions';
import {
  COST_ENTRY_COLUMNS, costEntryFromRow, costEntryToRow,
} from './src/db/costEntryRows';
import { resolveScope } from './src/app/analytics/scope';
import {
  categoryIndex, matchesSearch, parseSearch, searchHaystack, sessionIndex,
} from './src/app/analytics/search';
import type { CostSummary } from './src/app/analytics/metrics';
import type {
  CostBasis, CostEntry, InventorySnapshot, MenuItem, MenuItemStockAssignment, Order,
  OversellEvent, StockItem, StockMovement,
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
const cost = (over: Partial<CostEntry>): CostEntry => ({
  id: 'c', amount: 0, note: '', basis: 'per-session', timestamp: T, ...over,
});

/* ------------------------------------------------------------- break-even */
// Two tickets of 5 burgers at Rs 100 with a Rs 40 ingredient cost each:
// revenue 1000, COGS 400, 10 units, a basket of 5, an average price of 100.
//
// Every case below sets exactly one basis against a Rs 1,000 per-session cost,
// so a rate leaking into the wrong denominator shows up as a wrong figure
// rather than a right one reached by accident.
console.log('\nBreak-even');
const beOrders = [
  order({ id: 'be1', items: [line('a', 'Burger', 5, 100, 40)], subtotal: 500, total: 500 }),
  order({ id: 'be2', items: [line('a', 'Burger', 5, 100, 40)], subtotal: 500, total: 500 }),
];
const beTotals = totalsFor(beOrders);
const costsOf = (over: Partial<Record<CostBasis, number>>): CostSummary => costSummary(
  (Object.entries(over) as [CostBasis, number][])
    .map(([basis, amount], i) => cost({
      id: `k${i}`, amount, basis, eventId: basis === 'per-event' ? 'e1' : undefined,
    })),
);

// Per-session alone. 100 − 40 = 60 left on each, so 0.6 of every rupee, and
// 1000 ÷ 0.6 = 1666.67 to take.
const beSession = breakEven(beTotals, costsOf({ 'per-session': 1000 }));
check('per-session · contribution per unit', beSession.contributionPerUnit, 60);
check('per-session · contribution ratio', beSession.contributionRatio, 0.6);
check('per-session · break-even revenue', beSession.revenue, 1000 / 0.6);
check('per-session · break-even units', beSession.units, 1000 / 60);
check('per-session · progress', beSession.progress, 1000 / (1000 / 0.6));

// Per-unit is charged on every item: Rs 10 an item takes contribution to 50.
const beUnit = breakEven(beTotals, costsOf({ 'per-session': 1000, 'per-unit': 10 }));
check('per-unit · contribution per unit', beUnit.contributionPerUnit, 50);
check('per-unit · break-even revenue', beUnit.revenue, 2000);
check('per-unit · break-even units', beUnit.units, 20);

// Per-order is charged on every ticket, and a ticket here is 5 units: Rs 20 a
// ticket is Rs 4 an item. This is the one that has a denominator of its own.
const beOrder = breakEven(beTotals, costsOf({ 'per-session': 1000, 'per-order': 20 }));
check('per-order · basket size', beOrder.averageBasket, 5);
check('per-order · contribution per unit', beOrder.contributionPerUnit, 56);
check('per-order · break-even revenue', beOrder.revenue, 1000 / 0.56);

// Per-revenue is a true rate: 20% of a Rs 100 sale is Rs 20, leaving 40.
const beRate = breakEven(beTotals, costsOf({ 'per-session': 1000, 'per-revenue': 20 }));
check('per-revenue · rate is a fraction', beRate.revenueRate, 0.2);
check('per-revenue · contribution per unit', beRate.contributionPerUnit, 40);
check('per-revenue · break-even revenue', beRate.revenue, 2500);

// Per-event joins the committed rupees in a date or event scope...
const beEvent = breakEven(beTotals, costsOf({ 'per-session': 1000, 'per-event': 500 }), 'event');
check('per-event · committed rupees', beEvent.fixedCosts, 1500);
check('per-event · break-even revenue', beEvent.revenue, 1500 / 0.6);
check('per-event · nothing held back', beEvent.heldEventCosts, 0);

// ...and is held back from a single session out of that event (ADR-013).
// Apportioning it would make this session's target move when a later session
// trades well, which is the moving target this whole part exists to remove.
const beInSession = breakEven(beTotals, costsOf({ 'per-session': 1000, 'per-event': 500 }), 'session');
check('a session is not charged the event', beInSession.fixedCosts, 1000);
check('and is told what the event carries', beInSession.heldEventCosts, 500);
check('so its target is the session alone', beInSession.revenue, 1000 / 0.6);

/* ------------------------- the property that was broken: the target holds still */
// This is the regression that matters. The old formula divided the typed rupee
// total of the variable costs by revenue-so-far and called the answer a rate,
// so a Rs 1,200 cost was a 30% drag at Rs 4,000 of sales and a 6% drag at
// Rs 20,000 — one break-even figure in the morning and another in the
// afternoon, on identical facts, drifting in the flattering direction.
//
// Same mix, same prices, same costs; only the volume differs. The target must
// not move by a rupee.
console.log('\nBreak-even does not move with volume');
const ticket = (id: string) =>
  order({ id, items: [line('a', 'Burger', 5, 100, 40)], subtotal: 500, total: 500 });
const heldCosts = costsOf({ 'per-session': 1200, 'per-order': 20, 'per-revenue': 20 });
const atFourThousand = totalsFor(Array.from({ length: 8 }, (_, i) => ticket(`s${i}`)));
const atTwentyThousand = totalsFor(Array.from({ length: 40 }, (_, i) => ticket(`l${i}`)));
check('the smaller day took', atFourThousand.netRevenue, 4000);
check('the larger day took', atTwentyThousand.netRevenue, 20000);
const beSmall = breakEven(atFourThousand, heldCosts);
const beLarge = breakEven(atTwentyThousand, heldCosts);
check('break-even revenue at Rs 4,000', beSmall.revenue, 1200 / 0.36);
check('break-even revenue at Rs 20,000', beLarge.revenue, 1200 / 0.36);
check('the target did not move', (beLarge.revenue ?? 0) - (beSmall.revenue ?? 0), 0);
check('nor did contribution', (beLarge.contributionRatio ?? 0) - (beSmall.contributionRatio ?? 0), 0);
// Progress is the figure that is *supposed* to move with the day.
check('progress did move', (beLarge.progress ?? 0) > (beSmall.progress ?? 0), true);

/* ------------------------------------------------- all four blocked reasons */
// Each is reported rather than papered over with a zero, and each says
// something different, because they are different problems.
console.log('\nBreak-even · blocked');
const noCosts = breakEven(beTotals, costSummary([]));
check('nothing logged is not breaking even at zero', noCosts.blocked, BREAK_EVEN_BLOCKED.noFixedCosts);
check('and reports no revenue figure', noCosts.revenue, null);

const uncosted = totalsFor([order({ items: [line('a', 'Burger', 5, 100)], subtotal: 500 })]);
check('no costed sales, no contribution',
  breakEven(uncosted, costsOf({ 'per-session': 1000 })).blocked, BREAK_EVEN_BLOCKED.noCostedSales);

const drowning = breakEven(beTotals, costsOf({ 'per-session': 1000, 'per-unit': 200 }));
check('costs past the margin never break even', drowning.blocked, BREAK_EVEN_BLOCKED.negativeContribution);
check('and offer no volume that would', drowning.revenue, null);

// A per-ticket cost with no tickets to spread it over is unanswerable, not
// enormous: left alone the division is an infinity and the screen would report
// a margin problem, which is the wrong explanation for a missing denominator.
const ticketless = breakEven(
  { ...beTotals, orders: 0 }, costsOf({ 'per-session': 1000, 'per-order': 20 }));
check('no tickets to spread a per-ticket cost', ticketless.blocked, BREAK_EVEN_BLOCKED.noBasket);
check('and the basket is unknown, not zero', ticketless.averageBasket, null);

/* ------------------------------------------- margin today vs realised margin */
// One burger, Rs 100 on the menu, made of Rs 30 of beef and Rs 10 of bun. The
// two tickets above sold ten of them with Rs 40 frozen onto each line.
//
// These two figures used to be one, derived as netRevenue ÷ units — the
// realised historical average, which cannot respond to a price change by
// construction and reports a blend of the two prices after a few sales at the
// new one. Each half is checked here for the property the blend could not have.
console.log('\nMargin today vs realised');
const burger: MenuItem = {
  id: 'a', name: 'Burger', price: 100, showInOrderMode: true, category: 'Food',
};
const recipe: MenuItemStockAssignment[] = [
  { menuItemId: 'a', stockItemId: 'st-beef', quantityPerItem: 1 },
  { menuItemId: 'a', stockItemId: 'st-bun', quantityPerItem: 1 },
];
const kitchen = (bunCost: number): StockItem[] => [
  { id: 'st-beef', name: 'Beef', quantity: 500, unit: 'pcs', lowStockThreshold: 0, costPerUnit: 30 },
  { id: 'st-bun', name: 'Buns', quantity: 500, unit: 'pcs', lowStockThreshold: 0, costPerUnit: bunCost },
];
const perItem = itemPerformance(beOrders, [burger], ALL);
const marginsAt = (menuItem: MenuItem, bunCost = 10) =>
  itemMargins(perItem, [menuItem], recipe, kitchen(bunCost), costsOf({ 'per-session': 1000 }), beTotals);

const atOldPrice = marginsAt(burger)[0];
check('margin today · price', atOldPrice.today?.price, 100);
check('margin today · cost from the recipe', atOldPrice.today?.unitCost, 40);
check('margin today · %', atOldPrice.today?.marginPct, 60);
check('realised margin · price actually got', atOldPrice.realised?.price, 100);
check('realised margin · cost frozen on the line', atOldPrice.realised?.unitCost, 40);
check('the two agree', atOldPrice.diverged, false);

// Put the burger up by Rs 50. Margin today moves at once — that is the whole
// point of it. Realised margin must not: it is a fact about sales that already
// happened, and re-pricing it would rewrite last month's profit (invariant 3).
const dearer = marginsAt({ ...burger, price: 150 })[0];
check('a price rise moves margin today', dearer.today?.marginPct, (110 / 150) * 100);
check('and does not move realised margin', dearer.realised?.marginPct, 60);
check('realised price is still what was charged', dearer.realised?.price, 100);
check('the gap is flagged', dearer.diverged, true);
check('and quantified', dearer.divergencePct, (Math.abs(110 - 60) / 60) * 100);

// A recipe that is only partly costed produces no margin at all. A cost taken
// over the ingredients that happen to have one is the flattering answer, on
// exactly the data nobody can check — invariant 2, in the place it matters.
const partly = marginsAt(burger, 0)[0];
check('no margin from a partial cost', partly.today, null);
check('and it names what is missing', partly.missing, ['Buns']);
check('while realised margin stands', partly.realised?.marginPct, 60);

// Break-even per item follows today's margin, because a target is about what to
// do next. Rs 1,000 to cover at Rs 110 a burger is ten burgers, not sixteen.
const beItems = breakEvenByItem(marginsAt({ ...burger, price: 150 }), costsOf({ 'per-session': 1000 }), beTotals);
check('break-even by item uses today', beItems[0].contributionPerUnit, 110);
check('and so it moved with the price', beItems[0].units, 1000 / 110);
check('an uncosted item is absent, not estimated',
  breakEvenByItem(marginsAt(burger, 0), costsOf({ 'per-session': 1000 }), beTotals).length, 0);

/* ------------------------------------------------------------ cost basis */
// Each basis totals on its own and touches no other. The amounts are chosen so
// that any leak between them shows up as a wrong figure rather than a right one
// reached by accident: 100, 200, 4, 12 and 18 share no sums.
console.log('\nCost basis');
const eachBasis = costSummary([
  cost({ id: 'c1', amount: 100, basis: 'per-session' }),
  cost({ id: 'c2', amount: 200, basis: 'per-event', eventId: 'e1' }),
  cost({ id: 'c3', amount: 4, basis: 'per-order' }),
  cost({ id: 'c4', amount: 12, basis: 'per-unit' }),
  cost({ id: 'c5', amount: 18, basis: 'per-revenue' }),
]);
check('per-session in isolation', eachBasis.byBasis['per-session'], 100);
check('per-event in isolation', eachBasis.byBasis['per-event'], 200);
check('per-order in isolation', eachBasis.byBasis['per-order'], 4);
check('per-unit in isolation', eachBasis.byBasis['per-unit'], 12);
check('per-revenue in isolation', eachBasis.byBasis['per-revenue'], 18);
// The rates are not money yet, so they are not in the money total: 100 + 200.
check('committed rupees exclude the rates', eachBasis.total, 300);
check('every entry counted', eachBasis.entries, 5);

// Two costs on the same basis do add — within a basis the unit is the same.
const sameBasis = costSummary([
  cost({ id: 'c1', amount: 4, basis: 'per-order' }),
  cost({ id: 'c2', amount: 2, basis: 'per-order' }),
]);
check('same basis adds', sameBasis.byBasis['per-order'], 6);
check('and still is not rupees committed', sameBasis.total, 0);

/* -------------------------------------------------- the fixed/variable migration */
// Everything written before Phase 1A becomes per-session, including the rows
// filed as `variable` — inferring a basis from a cost's name would invent
// information and change a figure the shop has already read. The `variable`
// ones are marked for re-filing instead.
console.log('\nCost migration');
const migratedRow = costEntryFromRow({
  id: 'c-old', session_id: 's1', event_id: null, amount: 200, note: 'boxes',
  kind: 'variable', basis: 'per-session', timestamp: T,
});
check('a variable row lands on per-session', migratedRow.basis, 'per-session');
check('and keeps what it used to say', migratedRow.kind, 'variable');
check('and is flagged for re-filing', needsRefiling(migratedRow), true);

const fixedRow = costEntryFromRow({
  id: 'c-old2', session_id: 's1', amount: 1000, note: 'pitch',
  kind: 'fixed', basis: 'per-session', timestamp: T,
});
check('a fixed row lands on per-session too', fixedRow.basis, 'per-session');
check('and is left alone', needsRefiling(fixedRow), false);

// Re-filed, it stops asking: the basis is no longer the one it was handed.
check('re-filing clears the flag', needsRefiling({ ...migratedRow, basis: 'per-order' }), false);
// A row written since the migration carries no kind at all.
check('a new row has no kind', costEntryFromRow({
  id: 'c-new', amount: 4, note: 'bags', kind: '', basis: 'per-order', timestamp: T,
}).kind, undefined);
check('and is never flagged', needsRefiling(costEntryFromRow({
  id: 'c-new', amount: 4, note: 'bags', kind: '', basis: 'per-order', timestamp: T,
})), false);

/* --------------------------------------------- costs through save and load */
// `CostEntry.eventId` had no column: it was written to state, never to SQLite,
// and every event-level cost came back after a restart as a cost belonging to
// nothing. This is the mapping both directions use, so a column that only one
// side knows about fails here.
console.log('\nCost round trip');
const eventCost = cost({
  id: 'c-evt', eventId: 'evt-1', amount: 3000, note: 'pitch for the market',
  basis: 'per-event',
});
const columns = [...COST_ENTRY_COLUMNS];
const written = costEntryToRow(eventCost);
const readBack = costEntryFromRow(
  Object.fromEntries(columns.map((name, i) => [name, written[i]])),
);
check('event id survives the round trip', readBack.eventId, 'evt-1');
check('basis survives it', readBack.basis, 'per-event');
check('amount survives it', readBack.amount, 3000);
check('note survives it', readBack.note, 'pitch for the market');
check('session id stays absent', readBack.sessionId, undefined);
// Field by field above, then the whole thing, so a column added to one side
// and not the other is caught even when nobody thought to check it by name.
// Keys are sorted because `check` compares JSON and the two are built in
// different orders, which is not a difference about the data.
const sortKeys = (o: object) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined).sort(
    ([a], [b]) => a.localeCompare(b)));
check('the whole entry is unchanged', sortKeys(readBack), sortKeys(eventCost));
// And it is still findable as the event's, which is the point of storing it.
check('and it is found by its event', costsForEvent([readBack], 'evt-1', new Set()).length, 1);

// A per-event cost whose event went missing is demoted rather than thrown at —
// the app has to open. The write side refuses it instead.
const eventless = costEntryFromRow({
  id: 'c-orphan', event_id: null, amount: 3000, note: 'pitch',
  kind: '', basis: 'per-event', timestamp: T,
});
check('an eventless per-event row is demoted', eventless.basis, 'per-session');
check('per-event without an event is incoherent',
  costEntryIsCoherent({ ...eventCost, eventId: undefined }), false);
check('and with one it is fine', costEntryIsCoherent(eventCost), true);

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
