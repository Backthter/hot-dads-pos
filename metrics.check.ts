/**
 * Hand-computed checks for the analytics added alongside the session system.
 *
 * Not a test suite — the project has no runner — but every figure below was
 * worked out on paper first, so a change that quietly alters a formula has
 * something to fail against. Run with `npx tsx metrics.check.ts`.
 */
import {
  BREAK_EVEN_BLOCKED, attachmentPairs, breakEven, breakEvenByItem, breakEvenCrossing, costSummary,
  deadStock, financeRows, perUnitChargeOf,
  foodCost, inventoryTurnover, itemMargins, itemPerformance, ledgerLevelsAt, queueBands,
  resolveCosts, resolveRange, salesMix, shrinkageValue, stockPurchasesValue, stockoutStats,
  totalsFor, voidStats,
} from './src/app/analytics/metrics';
import { buildMovement, effectiveMovements, postMovements } from './src/app/lib/inventory';
import {
  allEvents, costEntryIsCoherent, costsFiledAgainstEvent, costsForEvent, describeCostItems,
  describeCostTarget, endSession, eventGroups, eventStatus, needsRefiling, pauseSession,
  resumeSession, sessionTradingHours, startSession, targetAfterBasisChange, ungroupedSessions,
} from './src/app/lib/sessions';
import {
  COST_ENTRY_COLUMNS, costEntryFromRow, costEntryToRow, parseCostAppliesTo,
} from './src/db/costEntryRows';
import {
  TRADING_EVENT_COLUMNS, tradingEventFromRow, tradingEventToRow,
} from './src/db/tradingEventRows';
import { renderCell, visibleColumns } from './src/app/analytics/DataTable';
import type { DataColumn } from './src/app/analytics/DataTable';
import { resolveScope, type Scope } from './src/app/analytics/scope';
import {
  DEFAULT_TAB, TABS, lockFor, migrateTabId, resolveLock, type HistorySource,
} from './src/app/analytics/tabs/model';
import {
  categoryIndex, matchesSearch, parseSearch, searchHaystack, sessionIndex,
} from './src/app/analytics/search';
import type { CostScope, CostSummary, SalesMixEntry } from './src/app/analytics/metrics';
import type {
  Category, CostBasis, CostEntry, InventorySnapshot, MenuItem, MenuItemStockAssignment, Order,
  OversellEvent, StockItem, StockMovement, TradingEvent, TradingSession,
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

// Snapshot dates are keyed by the app in *local* time (localDateKey in
// metrics.ts), so a fixture that builds them with toISOString() hands the
// aggregates UTC strings and drops rows whenever the two calendars disagree —
// which they do at T's hour of day for any zone east of about UTC+2. Format
// through the same local calendar the production code reads back.
const localDay = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

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

// An event of one is held back exactly like a market of three (ADR-023). The
// temptation is to allocate when there is only one session to allocate to,
// because both scopes then cover the same trading and the figure reads as
// though it were hiding money from itself. It is not a narrow special case: a
// second session joining the market later would move this session's break-even
// retroactively, which is what ADR-013 forbids. The difference is explained in
// the panel; the arithmetic below must be identical either way.
check('an event of one holds its cost back too', beInSession.heldEventCosts, 500);
check('and its fixed costs are the session\'s alone', beInSession.fixedCosts, 1000);
check('so the figure cannot move when a day joins',
  breakEven(beTotals, costsOf({ 'per-session': 1000, 'per-event': 500 }), 'session').revenue,
  beInSession.revenue ?? 0);

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

/* -------------------------------- a per-unit cost charged to some items only */
// ADR-022. Ten burgers at Rs 100 and ten drinks at Rs 50, so burgers are
// exactly half the units sold and the blend arithmetic can be read off by eye.
// Ingredients: burger 30 + 10 = 40, drink 20.
console.log('\nTargeted per-unit costs');

const drink: MenuItem = {
  id: 'd', name: 'Cola', price: 50, showInOrderMode: true, category: 'Drinks',
};
const foodCategory: Category = { id: 'cat-food', name: 'Food', order: 0 };
const drinkCategory: Category = { id: 'cat-drinks', name: 'Drinks', order: 1 };

const mixedOrders = [
  order({ id: 'm1', items: [line('a', 'Burger', 10, 100, 40)], subtotal: 1000, total: 1000 }),
  order({ id: 'm2', items: [line('d', 'Cola', 10, 50, 20)], subtotal: 500, total: 500 }),
];
const mixedTotals = totalsFor(mixedOrders);
const mixedItems = itemPerformance(mixedOrders, [burger, drink], ALL);
const bothRecipes: MenuItemStockAssignment[] = [
  { menuItemId: 'a', stockItemId: 'st-beef', quantityPerItem: 1 },
  { menuItemId: 'a', stockItemId: 'st-bun', quantityPerItem: 1 },
  { menuItemId: 'd', stockItemId: 'st-syrup', quantityPerItem: 1 },
];
const bothKitchens = (bunCost = 10): StockItem[] => [
  ...kitchen(bunCost),
  { id: 'st-syrup', name: 'Syrup', quantity: 500, unit: 'pcs', lowStockThreshold: 0, costPerUnit: 20 },
];

const theMix = salesMix(mixedItems, [burger, drink], [foodCategory, drinkCategory]);
check('the mix carries every item that sold', theMix.length, 2);
check('with the units it sold', theMix.find(m => m.menuItemId === 'a')?.units, 10);
check('and the category it is in now', theMix.find(m => m.menuItemId === 'a')?.categoryId, 'cat-food');

const boxOnBurgers = costSummary([
  cost({ id: 'k-fixed', amount: 1000, basis: 'per-session' }),
  cost({
    id: 'k-box', amount: 12, basis: 'per-unit',
    appliesTo: { kind: 'items', ids: ['a'] },
  }),
]);

// The blend: burgers are half the units, so a Rs 12 box on them is Rs 6 across
// the average sale. Hand-computed, because this is the number the headline
// break-even divides by.
const blended = resolveCosts(boxOnBurgers, mixedTotals, 'range', theMix);
check('a cost on half the units blends to half its rate', blended.perUnitCost, 6);
check('nothing is charged to every item', blended.perUnitCostUntargeted, 0);
check('the burger carries the whole box', blended.perUnitCostFor('a'), 12);
check('and the drink carries none of it', blended.perUnitCostFor('d'), 0);

// The same cost with no target is charged to everything, which is what every
// row written before ADR-022 means.
const boxOnEverything = costSummary([
  cost({ id: 'k-fixed', amount: 1000, basis: 'per-session' }),
  cost({ id: 'k-box', amount: 12, basis: 'per-unit' }),
]);
const flat = resolveCosts(boxOnEverything, mixedTotals, 'range', theMix);
check('an untargeted cost is the whole rate', flat.perUnitCost, 12);
check('and every item carries it', flat.perUnitCostFor('d'), 12);

/* --- the regression that matters: the headline must not move ------------- */
// Every figure below is computed with a mix and without one. For a cost set
// that targets nothing the two must be identical — if this ever fails, ADR-022
// has changed a number for every shop that never used it.
const withMix = breakEven(mixedTotals, boxOnEverything, 'range', theMix);
const withoutMix = breakEven(mixedTotals, boxOnEverything, 'range');
check('break-even · untargeted, unchanged by the mix', withMix.units, withoutMix.units ?? 0);
check('break-even · same contribution', withMix.contributionPerUnit, withoutMix.contributionPerUnit ?? 0);
check('break-even · same revenue', withMix.revenue, withoutMix.revenue ?? 0);
check('break-even · same per-unit cost', withMix.perUnitCost, withoutMix.perUnitCost ?? 0);

// And a caller that knows no mix charges a targeted cost in full rather than
// spreading it to nothing. Pessimistic on purpose: spreading to zero would be
// the flattering answer produced automatically on data nobody looked at.
const unknownMix = resolveCosts(boxOnBurgers, mixedTotals, 'range');
check('no mix charges a targeted cost in full', unknownMix.perUnitCost, 12);
check('to every item alike', unknownMix.perUnitCostFor('d'), 12);

/* --- the per-item column ------------------------------------------------- */
// A Rs 12 box on burgers moves the burger's margin today by exactly Rs 12 and
// leaves the drink's alone. Against no per-unit cost at all: burger 100 − 40 =
// 60, drink 50 − 20 = 30.
const marginsFor = (costs: CostSummary, bunCost = 10) =>
  itemMargins(mixedItems, [burger, drink], bothRecipes, bothKitchens(bunCost),
    costs, mixedTotals, 'range', theMix);

const noPerUnit = costSummary([cost({ id: 'k-fixed', amount: 1000, basis: 'per-session' })]);
const before = marginsFor(noPerUnit);
check('burger contribution before the box', before.find(m => m.menuItemId === 'a')?.today?.contributionPerUnit, 60);
check('drink contribution before the box', before.find(m => m.menuItemId === 'd')?.today?.contributionPerUnit, 30);

const after = marginsFor(boxOnBurgers);
check('the box comes off the burger', after.find(m => m.menuItemId === 'a')?.today?.contributionPerUnit, 48);
check('and not off the drink', after.find(m => m.menuItemId === 'd')?.today?.contributionPerUnit, 30);
// Both sides of the margin carry the same rate, so a targeted cost cannot read
// as a divergence between today's margin and the realised one.
check('realised margin carries it too', after.find(m => m.menuItemId === 'a')?.realised?.contributionPerUnit, 48);
check('and the item is not flagged as diverged', after.find(m => m.menuItemId === 'a')?.diverged, false);

/* --- a category, and an item that has moved out of it -------------------- */
const lidsOnDrinks = costSummary([
  cost({ id: 'k-fixed', amount: 1000, basis: 'per-session' }),
  cost({
    id: 'k-lid', amount: 3, basis: 'per-unit',
    appliesTo: { kind: 'category', id: 'cat-drinks' },
  }),
]);
const byCategory = resolveCosts(lidsOnDrinks, mixedTotals, 'range', theMix);
check('a category reaches the items in it', byCategory.perUnitCostFor('d'), 3);
check('and not the ones outside it', byCategory.perUnitCostFor('a'), 0);
check('blending over half the units', byCategory.perUnitCost, 1.5);

// Move the burger into Drinks. Resolution is against the category the item is
// in *now* — the shop saying "this is a drink" is the shop saying it takes a
// lid — so the cost reaches it, and the blend follows.
const burgerIsADrink = { ...burger, category: 'Drinks' };
const movedMix = salesMix(
  itemPerformance(mixedOrders, [burgerIsADrink, drink], ALL),
  [burgerIsADrink, drink], [foodCategory, drinkCategory]);
const afterMove = resolveCosts(lidsOnDrinks, mixedTotals, 'range', movedMix);
check('an item that changed category is reached', afterMove.perUnitCostFor('a'), 3);
check('and the blend follows it to every unit', afterMove.perUnitCost, 3);

// A category id nothing answers to reaches nothing, and is not read as "all".
const goneCategory = costSummary([
  cost({
    id: 'k-gone', amount: 9, basis: 'per-unit',
    appliesTo: { kind: 'category', id: 'cat-deleted' },
  }),
]);
const dangling = resolveCosts(goneCategory, mixedTotals, 'range', theMix);
check('a target that matches nothing charges nothing', dangling.perUnitCost, 0);
check('and no item picks it up', dangling.perUnitCostFor('a'), 0);

/* --- invariant 2 holds through a targeted cost --------------------------- */
// A cost you can resolve does not make an ingredient cost you cannot. The bun
// has no price, so margin today is null however cleanly the box resolves.
const incomplete = marginsFor(boxOnBurgers, 0).find(m => m.menuItemId === 'a');
check('a targeted cost does not complete a recipe', incomplete?.today, null);
check('and the missing ingredient is still named', incomplete?.missing, ['Buns']);
check('while the drink beside it is unaffected',
  marginsFor(boxOnBurgers, 0).find(m => m.menuItemId === 'd')?.today?.contributionPerUnit, 30);

/* ------------------------------- when the period paid for itself (ADR-024) */
// Six tickets, each five burgers at Rs 100 with Rs 40 frozen on every line:
// Rs 500 of revenue and Rs 200 of ingredients, so Rs 300 of contribution each.
// Against Rs 1,000 of fixed costs the running total is 300 / 600 / 900 / 1200,
// so ticket 4 is the one that pays for the day. Every figure below is chosen so
// the crossing lands on a nameable ticket rather than near a boundary.
console.log('\nBreak-even crossing');

const crossTicket = (n: number, over: Partial<Order> = {}) => order({
  id: `x${n}`,
  orderNumber: String(n).padStart(2, '0'),
  sessionTicket: n,
  timestamp: T + n * 60_000,
  items: [line('a', 'Burger', 5, 100, 40)],
  subtotal: 500,
  total: 500,
  ...over,
});
const crossOrders = [1, 2, 3, 4, 5, 6].map(n => crossTicket(n));
const crossTotals = totalsFor(crossOrders);
const crossMix = salesMix(
  itemPerformance(crossOrders, [burger, drink], ALL),
  [burger, drink], [foodCategory, drinkCategory]);
const crossingOf = (
  orders: Order[],
  costs: CostSummary,
  scope: CostScope = 'range',
  mix: SalesMixEntry[] | null = crossMix,
) => breakEvenCrossing(orders, [burger, drink], costs, totalsFor(orders), scope, mix);

const fixedOnly = costsOf({ 'per-session': 1000 });
const plain = crossingOf(crossOrders, fixedOnly);
check('the crossing names a ticket', plain.order?.number, '04');
check('and the kitchen number beside it', plain.order?.sessionTicket, 4);
check('and when it happened', plain.order?.at, T + 4 * 60_000);
check('with the contribution banked by then', plain.contributionAt, 1200);
check('nothing left to cover', plain.remaining, 0);
check('every ticket carried a cost', plain.coverage, 1);
check('and it is not blocked', plain.blocked, undefined);

/* --- the regression: a crossing is a measurement and does not move -------- */
// This is the check that fails if a period average gets back into the
// contribution. Break-even revenue is a target and may move as the day's
// average sale changes; a crossing is a fact about a moment that has already
// happened, and an afternoon of trading must not slide it.
const afterFour = crossingOf(crossOrders.slice(0, 4), fixedOnly);
const afterSix = crossingOf(crossOrders, fixedOnly);
check('the crossing does not move as the day fills up', afterSix.order?.id, afterFour.order?.id ?? '');
check('nor does the moment it happened', afterSix.order?.at, afterFour.order?.at ?? 0);
check('nor the contribution banked by then', afterSix.contributionAt, afterFour.contributionAt ?? 0);
// The same said the other way: two more tickets change the period's totals
// completely, and the answer is identical.
check('totals moved underneath it', afterSix.contribution !== afterFour.contribution, true);

/* --- an uncosted ticket contributes nothing ------------------------------ */
// Ticket 2 has no frozen cost. Counting it at zero cost would give it Rs 500 of
// contribution — 300 / 800 / 1100 — and put the crossing at ticket 3, earlier
// than the truth and in the flattering direction (invariant 2). Skipping it
// gives 300 / — / 600 / 900 / 1200 and puts it at ticket 5, which is never
// earlier than the truth, so the screen can say "or earlier".
const withUncosted = [
  crossTicket(1),
  crossTicket(2, { items: [line('a', 'Burger', 5, 100)] }),
  crossTicket(3), crossTicket(4), crossTicket(5), crossTicket(6),
];
const uncostedRun = crossingOf(withUncosted, fixedOnly);
check('an uncosted ticket is skipped, not counted at zero', uncostedRun.order?.number, '05');
check('and the flattering answer is not given', uncostedRun.order?.number !== '03', true);
check('coverage says how much was left out', uncostedRun.coverage, 5 / 6);

/* --- the rates each move it, one at a time ------------------------------- */
// Rs 60 a ticket: contribution 240, so 240 / 480 / 720 / 960 / 1200 → ticket 5.
check('a per-ticket cost moves the crossing',
  crossingOf(crossOrders, costsOf({ 'per-session': 1000, 'per-order': 60 })).order?.number, '05');
// 20% of takings: 500 − 200 − 100 = 200 a ticket, so ticket 5 exactly covers it.
check('a share of takings moves it',
  crossingOf(crossOrders, costsOf({ 'per-session': 1000, 'per-revenue': 20 })).order?.number, '05');
// Rs 12 an item across five burgers is Rs 60 a ticket: the same as above.
check('an untargeted per-item cost moves it',
  crossingOf(crossOrders, costsOf({ 'per-session': 1000, 'per-unit': 12 })).order?.number, '05');

/* --- ADR-022 flows through: a targeted cost reaches only its items -------- */
const boxOnBurger = costSummary([
  cost({ id: 'x-fixed', amount: 1000, basis: 'per-session' }),
  cost({
    id: 'x-box', amount: 12, basis: 'per-unit',
    appliesTo: { kind: 'items', ids: ['a'] },
  }),
]);
const boxOnDrink = costSummary([
  cost({ id: 'x-fixed', amount: 1000, basis: 'per-session' }),
  cost({
    id: 'x-lid', amount: 12, basis: 'per-unit',
    appliesTo: { kind: 'items', ids: ['d'] },
  }),
]);
check('a cost targeted at what sold moves the crossing',
  crossingOf(crossOrders, boxOnBurger).order?.number, '05');
check('a cost targeted at what did not sell does not',
  crossingOf(crossOrders, boxOnDrink).order?.number, '04');

/* --- a deal charges its components ---------------------------------------- */
// itemPerformance credits a deal's components with the units they represent and
// salesMix is built from that, so the crossing has to charge them the same way
// or the two would disagree about the same deal.
const mealDeal: MenuItem = {
  id: 'meal', name: 'Meal deal', price: 220, showInOrderMode: true, category: 'Deals',
  dealItems: [{ menuItemId: 'a', name: 'Burger', quantity: 2 }],
};
const dealOrder = order({
  id: 'deal1',
  items: [{ ...line('meal', 'Meal deal', 3, 220, 90), dealItems: mealDeal.dealItems }],
});
check('a deal charges the items inside it',
  perUnitChargeOf(dealOrder, [burger, mealDeal], id => (id === 'a' ? 12 : 0)), 12 * 2 * 3);
check('and a plain line charges itself',
  perUnitChargeOf(crossTicket(1), [burger], id => (id === 'a' ? 12 : 0)), 60);
check('an item the cost does not name is charged nothing',
  perUnitChargeOf(crossTicket(1), [burger], () => 0), 0);

/* --- ADR-013: what the session owes, and what the event does -------------- */
// From a session scope the event's Rs 500 is held back, so only Rs 1,000 has to
// be covered and ticket 4 does it. From the event's own scope all Rs 1,500 is
// owed, and that takes until ticket 5.
const withEvent = costsOf({ 'per-session': 1000, 'per-event': 500 });
const crossInSession = crossingOf(crossOrders, withEvent, 'session');
check('a session crosses on its own costs', crossInSession.order?.number, '04');
check('and is told what the event is holding', crossInSession.heldEventCosts, 500);
check('which is not in what it had to cover', crossInSession.fixedCosts, 1000);
const crossAsEvent = crossingOf(crossOrders, withEvent, 'event');
check('the event owes all of it', crossAsEvent.fixedCosts, 1500);
check('so it crosses later', crossAsEvent.order?.number, '05');
check('and holds nothing back', crossAsEvent.heldEventCosts, 0);

/* --- a void moves it on --------------------------------------------------- */
// Voiding the ticket that caused the crossing must hand it to the next one
// (invariant 5), not leave it pointing at an order that no longer counts.
const voidedFour = crossOrders.map(o =>
  (o.id === 'x4' ? { ...o, voidedAt: T + 9 * 60_000, voidReason: 'walked off' } : o));
check('voiding the crossing ticket moves it on',
  crossingOf(voidedFour, fixedOnly).order?.number, '05');

/* --- every blocked reason is reachable ------------------------------------ */
check('no fixed costs, nothing to cross',
  crossingOf(crossOrders, costsOf({ 'per-unit': 10 })).blocked, BREAK_EVEN_BLOCKED.noFixedCosts);
check('no costed ticket in the period',
  crossingOf(
    [crossTicket(1, { items: [line('a', 'Burger', 5, 100)] })], fixedOnly,
  ).blocked, BREAK_EVEN_BLOCKED.noCostedSales);
const notThereYet = crossingOf(crossOrders, costsOf({ 'per-session': 100_000 }));
check('a day that has not got there yet', notThereYet.blocked, BREAK_EVEN_BLOCKED.notYet);
check('and says how far there is to go', notThereYet.remaining, 100_000 - 1800);
check('with no ticket named', notThereYet.order, null);
// Rs 200 an item over five items is Rs 1,000 a ticket against Rs 300 of margin:
// the running total falls, and no volume ever covers anything.
check('a menu that never will',
  crossingOf(crossOrders, costsOf({ 'per-session': 1000, 'per-unit': 200 })).blocked,
  BREAK_EVEN_BLOCKED.negativeContribution);

/* ---------------------------------------------------- the finance table */
// Two days of one market. Saturday takes three tickets and Sunday two, each
// ticket five burgers at Rs 100 with Rs 40 frozen on the line — so Rs 500 of
// revenue and Rs 300 of contribution per ticket, as above.
//
// Costs: Rs 400 logged against Saturday, Rs 200 against Sunday, and a Rs 900
// pitch fee against the market itself.
console.log('\nFinance rows');

const satSession: TradingSession = {
  id: 'sat', name: 'Saturday', status: 'ended', startedAt: T, endedAt: T + 5 * HOUR,
  ticketCounter: 3, pausedMs: 0, eventId: 'mkt',
};
const sunSession: TradingSession = {
  id: 'sun', name: 'Sunday', status: 'ended', startedAt: T + 24 * HOUR,
  endedAt: T + 29 * HOUR, ticketCounter: 2, pausedMs: 0, eventId: 'mkt',
};
const marketEvent = { id: 'mkt', name: 'Winter Market', sessions: [satSession, sunSession] };

const finOrders = [
  ...[1, 2, 3].map(n => crossTicket(n, { id: `sat${n}`, sessionId: 'sat' })),
  ...[4, 5].map(n => crossTicket(n, { id: `sun${n}`, sessionId: 'sun' })),
];
const finCosts = [
  cost({ id: 'f-sat', amount: 400, basis: 'per-session', sessionId: 'sat' }),
  cost({ id: 'f-sun', amount: 200, basis: 'per-session', sessionId: 'sun' }),
  cost({ id: 'f-pitch', amount: 900, basis: 'per-event', eventId: 'mkt' }),
];
const finRows = financeRows({
  sessions: [satSession, sunSession],
  event: marketEvent,
  orders: finOrders,
  costs: finCosts,
  menuItems: [burger, drink],
  mix: null,
  now: T + 100 * HOUR,
});

check('a row per session, and one for the market', finRows.map(r => r.id), ['sat', 'sun', 'mkt']);
check('and each says what it is', finRows.map(r => r.kind), ['session', 'session', 'event']);

const sat = finRows[0];
const sun = finRows[1];
const market = finRows[2];

// Saturday: three tickets of Rs 500. Its own Rs 400 is what it has to cover;
// the pitch fee is the market's and is held (ADR-013).
check('Saturday takings', sat.totals.netRevenue, 1500);
check('Saturday covers its own costs only', sat.operatingCosts, 400);
check('and is told what the market holds', sat.heldEventCosts, 900);
check('Sunday covers its own', sun.operatingCosts, 200);
check('and is told the same', sun.heldEventCosts, 900);

// The market owes all three: 400 + 200 + 900.
check('the market takes both days', market.totals.netRevenue, 2500);
check('and owes every cost', market.operatingCosts, 1500);
check('holding nothing back', market.heldEventCosts, 0);

// The property that matters: the pitch fee is charged once. Summing the session
// rows and the event row would double it, which is why the sessions hold rather
// than share — and why heldEventCosts is a separate field and not an addend.
check('the pitch fee is in no session row',
  sat.operatingCosts + sun.operatingCosts, 600);
check('and the market row is not the sum of the sessions',
  market.operatingCosts - (sat.operatingCosts + sun.operatingCosts), 900);

// Net profit: Saturday 1500 − 600 ingredients − 400 = 500.
check('Saturday net profit', sat.netProfit, 500);
check('and its margin', sat.netMarginPct, (500 / 1500) * 100);
// The market: 2500 − 1000 − 1500 = 0.
check('the market barely covers itself', market.netProfit, 0);

// Each row crosses on its own costs. Saturday needs Rs 400 and banks Rs 300 a
// ticket, so ticket 2. The market needs Rs 1,500 and takes until ticket 5.
check('Saturday crosses at its second ticket', sat.crossing.order?.number, '02');
check('the market crosses at the fifth', market.crossing.order?.number, '05');
check('and the market crossing knows nothing is held', market.crossing.heldEventCosts, 0);

// Invariant 2 at the row level: a period whose ingredients are unknown has no
// profit, rather than a profit computed by subtracting a known cost from a
// revenue whose cost is not known.
const uncostedRows = financeRows({
  sessions: [satSession],
  orders: [crossTicket(1, { id: 'u1', sessionId: 'sat', items: [line('a', 'Burger', 5, 100)] })],
  costs: [cost({ id: 'f-sat', amount: 400, basis: 'per-session', sessionId: 'sat' })],
  menuItems: [burger],
  mix: null,
  now: T + 100 * HOUR,
});
check('no costed sale, no profit figure', uncostedRows[0].netProfit, null);
check('and no margin either', uncostedRows[0].netMarginPct, null);
check('though the takings are still reported', uncostedRows[0].totals.netRevenue, 500);

// A date scope gives orders outside any session a row of their own, rather than
// guessing them into one by timestamp (invariant 4).
const looseRows = financeRows({
  sessions: [satSession],
  orders: [...finOrders.slice(0, 3), crossTicket(9, { id: 'loose', sessionId: undefined })],
  costs: finCosts,
  menuItems: [burger],
  mix: null,
  includeUnassigned: true,
  now: T + 100 * HOUR,
});
check('orders in no session get their own row', looseRows.map(r => r.id), ['sat', 'unassigned']);
check('and are not swept into the session', looseRows[0].totals.orders, 3);
check('the loose row carries its own takings', looseRows[1].totals.netRevenue, 500);
// Without the flag they are simply absent — an event scope has no business
// showing orders that belong to no session in it.
check('and are absent when not asked for',
  financeRows({
    sessions: [satSession], orders: [...finOrders.slice(0, 3), crossTicket(9, { id: 'loose', sessionId: undefined })],
    costs: finCosts, menuItems: [burger], mix: null, now: T + 100 * HOUR,
  }).length, 1);

/* ---------------------------------------- what a table shows, and hides */
// The two rules the three analytics tables rest on, checked as functions so
// that 1C-iv inherits them rather than reimplementing them per table.
console.log('\nTable columns');

interface FauxRow { name: string; sold: number; takings: number | null }
const fauxColumns: DataColumn<FauxRow>[] = [
  { id: 'sold', label: 'Sold', value: r => r.sold },
  { id: 'takings', label: 'Takings', value: r => r.takings, money: true },
  { id: 'name', label: 'Name', value: r => r.name, align: 'left' },
];

// ADR-019: money is hidden, quantities are not. A locked till still has to
// answer "how many" — that is the whole difference between hiding a column and
// hiding the screen.
check('every column shows when nothing is hidden', visibleColumns(fauxColumns, false).length, 3);
const locked = visibleColumns(fauxColumns, true);
check('a money column is dropped under the lock', locked.map(c => c.id), ['sold', 'name']);
check('and a quantity column is not', locked.some(c => c.id === 'sold'), true);

// Invariant 2, at the last layer it can be broken at. The engine keeps "no cost
// on file" and "cost of nothing" apart the whole way here; a table that renders
// null as 0 throws that away in the final inch, and reports the flattering
// number on exactly the rows nobody can check.
check('an unknown renders as a dash', renderCell(null), '—');
check('and is not confused with zero', renderCell(0, n => `Rs ${n}`), 'Rs 0');
check('a known value is formatted', renderCell(1200, n => `Rs ${n}`), 'Rs 1200');
check('an unformatted value still prints', renderCell('Saturday'), 'Saturday');
check('and an unknown ignores the formatter', renderCell(null, n => `Rs ${n}`), '—');

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

/* ------------------------------------ a per-unit cost that names its items */
// ADR-022. Both shapes go through the same column, so both are checked whole
// as well as field by field — a column added to one side of the mapping and not
// the other is the exact failure `eventId` had for a whole phase.
console.log('\nCost target round trip');

const boxCost = cost({
  id: 'c-box', amount: 12, note: 'burger boxes', basis: 'per-unit',
  appliesTo: { kind: 'items', ids: ['burger', 'cheeseburger'] },
});
const boxBack = costEntryFromRow(
  Object.fromEntries(columns.map((name, i) => [name, costEntryToRow(boxCost)[i]])),
);
check('an items target survives the round trip', boxBack.appliesTo, { kind: 'items', ids: ['burger', 'cheeseburger'] });
check('with its basis', boxBack.basis, 'per-unit');
check('and the whole entry is unchanged', sortKeys(boxBack), sortKeys(boxCost));

const catCost = cost({
  id: 'c-cat', amount: 3, note: 'lids', basis: 'per-unit',
  appliesTo: { kind: 'category', id: 'cat-drinks' },
});
const catBack = costEntryFromRow(
  Object.fromEntries(columns.map((name, i) => [name, costEntryToRow(catCost)[i]])),
);
check('a category target survives the round trip', catBack.appliesTo, { kind: 'category', id: 'cat-drinks' });
check('and the whole entry is unchanged', sortKeys(catBack), sortKeys(catCost));

// Absent means every item and is the only reading that cannot silently shrink a
// figure. An empty id list is a different claim — these items, of which there
// are none — and is preserved rather than normalised into absence.
const untargeted = cost({ id: 'c-all', amount: 5, note: 'napkins', basis: 'per-unit' });
const untargetedBack = costEntryFromRow(
  Object.fromEntries(columns.map((name, i) => [name, costEntryToRow(untargeted)[i]])),
);
check('no target stays absent', untargetedBack.appliesTo, undefined);
const emptyIds = cost({
  id: 'c-none', amount: 5, note: 'nothing', basis: 'per-unit',
  appliesTo: { kind: 'items', ids: [] },
});
const emptyBack = costEntryFromRow(
  Object.fromEntries(columns.map((name, i) => [name, costEntryToRow(emptyIds)[i]])),
);
check('an empty id list is not absence', emptyBack.appliesTo, { kind: 'items', ids: [] });

// A target only means something on per-unit. The write side refuses it; the
// load path drops it, because a shop with one malformed row still has to open.
for (const basis of ['per-session', 'per-event', 'per-order', 'per-revenue'] as CostBasis[]) {
  check(`${basis} with a target is incoherent`, costEntryIsCoherent(cost({
    id: 'c-bad', basis, amount: 10,
    eventId: basis === 'per-event' ? 'evt-1' : undefined,
    appliesTo: { kind: 'items', ids: ['burger'] },
  })), false);
}
check('per-unit with a target is fine', costEntryIsCoherent(boxCost), true);
const demoted = costEntryFromRow({
  id: 'c-demote', session_id: null, event_id: null, amount: 10, note: 'bags',
  kind: '', basis: 'per-order', applies_to: '{"kind":"items","ids":["burger"]}', timestamp: T,
});
check('the load path drops it rather than throwing', demoted.appliesTo, undefined);
check('and keeps the basis it was filed under', demoted.basis, 'per-order');
// Rows an older build wrote, and rows a newer one did. Everything unreadable
// reads as absent, which means every item — never as a target of nothing.
check('unparseable JSON reads as absent', parseCostAppliesTo('{not json'), undefined);
check('an unknown kind reads as absent', parseCostAppliesTo('{"kind":"supplier","id":"x"}'), undefined);
check('a null column reads as absent', parseCostAppliesTo(null), undefined);

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
  { date: localDay(T - 48 * HOUR), stockItemId: 's1', quantity: 100, unitCost: 50, value: 5000 },
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

/* --------------------------------------------- one definition of a purchase */
// `stockPurchasesValue` counted `added` and `packet`; `foodCost` kept its own
// loop and counted `correction` as well. The same delivery was therefore two
// different numbers on the same screen, and nothing said which to believe.
//
// A purchase is a receipt (ADR-014). This ledger has both receipts and a
// correction, and the correction is the one that used to make them differ: it
// has no cost of its own, so it was valued at today's cost per unit — 5 × 50 =
// Rs 250 of outlay that never happened.
console.log('\nPurchases — a purchase is a receipt');
const withCorrection: StockMovement[] = [
  { id: 'p1', stockItemId: 's1', delta: 40, resulting: 140, reason: 'added', totalCost: 2000, timestamp: T + HOUR },
  { id: 'p2', stockItemId: 's1', delta: 20, resulting: 160, reason: 'packet', totalCost: 500, timestamp: T + 2 * HOUR },
  { id: 'p3', stockItemId: 's1', delta: 5, resulting: 165, reason: 'correction', timestamp: T + 3 * HOUR },
];
const purchaseWindow = { start: T, end: T + 10 * HOUR, label: 'purchases' };
const directly = stockPurchasesValue(withCorrection, stock, purchaseWindow.start, purchaseWindow.end);
const throughFoodCost = foodCost(
  beTotals, withCorrection, [], stock, purchaseWindow, T + 50 * HOUR).purchases;
check('receipts only', directly, 2500);
check('food cost agrees exactly', throughFoodCost, directly);
check('the correction is not an outlay', directly, 2500);

/* ------------------------------------------------- an undone delivery (1B) */
/*
 * The regression this phase exists for.
 *
 * Reversals used to be written two ways. `undoMovement` appended its
 * compensating line and marked both rows `reversed`; `reverseStockChanges`
 * posted a plain negative `correction` and marked nothing. Every purchase
 * figure skips `reversed` rows, so a delivery undone through the second path
 * left its original `added` still counted while the line cancelling it counted
 * as nothing — and after ADR-014 made a correction definitively not a purchase,
 * the compensating line *could* not cancel it. The shelf was right and the
 * books were wrong, in the direction that overstates outlay.
 *
 * Both paths now build the same line through `buildMovement` and post it
 * through `postMovements`, so what is checked below is the one thing they share
 * rather than two implementations that happen to agree.
 */
console.log('\nAn undone delivery — the regression');

const mince = stock[0];
const DELIVERY = 8000;
const stamp = (m: StockMovement, over: Partial<StockMovement>): StockMovement => ({ ...m, ...over });

// Rs 8,000 of mince arrives: 80 on the shelf becomes 180.
const delivery = stamp(buildMovement(mince, 100, 'added', 'Delivery'), {
  id: 'd1', totalCost: DELIVERY, timestamp: T + HOUR,
});
const received = postMovements([], [delivery]);

/** A reversal, as `reverseStockChanges` now builds one, whichever path called it. */
const reversalOf = (original: StockMovement, id: string, ts: number): StockMovement => stamp(
  buildMovement({ ...mince, quantity: original.resulting }, -original.delta, 'reversal', 'Undone'),
  { id, referenceType: 'movement', referenceId: original.id, timestamp: ts },
);

// Path one: the ledger's own undo, from stock history.
const undoneByLedger = postMovements(received, [reversalOf(delivery, 'r1', T + 2 * HOUR)]);
// Path two: the order/stock path, which used to post an unmarked correction.
const undoneByStock = postMovements(received, [reversalOf(delivery, 'r2', T + 2 * HOUR)]);

// Restoring it duplicates the original's meaning rather than reversing the
// reversal: same reason, same cost, a live line of its own. The undone pair
// stays netted out, so this is counted once and not twice.
const restored = postMovements(undoneByLedger, [stamp(
  buildMovement({ ...mince, quantity: 80 }, 100, delivery.reason, 'Restored'),
  {
    id: 'd2', referenceType: 'movement', referenceId: delivery.id,
    unitCost: delivery.unitCost, totalCost: delivery.totalCost, timestamp: T + 3 * HOUR,
  },
)]);

const led = { start: T, end: T + 10 * HOUR, label: 'ledger' };
const spent = (ms: StockMovement[]) => stockPurchasesValue(ms, stock, led.start, led.end);
const spentViaFoodCost = (ms: StockMovement[]) =>
  foodCost(beTotals, ms, [], stock, led, T + 50 * HOUR).purchases;

check('a reversal marks itself', buildMovement(mince, -100, 'reversal').reversed, true);
check('a correction does not', buildMovement(mince, 5, 'correction').reversed, undefined);
check('received: counted once', spent(received), DELIVERY);
check('received: food cost agrees', spentViaFoodCost(received), DELIVERY);
check('undone via the ledger: nothing', spent(undoneByLedger), 0);
check('undone via stock: nothing', spent(undoneByStock), 0);
check('both undo paths agree', spent(undoneByStock), spent(undoneByLedger));
check('undone: food cost agrees', spentViaFoodCost(undoneByLedger), 0);
check('the original is marked too', undoneByLedger.find(m => m.id === 'd1')?.reversed, true);
check('restored: counted once, not twice', spent(restored), DELIVERY);
check('restored: food cost agrees', spentViaFoodCost(restored), DELIVERY);

/* ----------------------------------------------------------- the orphan */
// The ledger caps at 20,000 lines (ADR-001), and a trim drops the oldest — so
// a reversal can outlive the row it reverses. This is why the filter reads a
// flag on both halves instead of matching a negative row against a prior
// positive one: with nothing left to match, an inferring rule sees a live line.
console.log('\nAn orphaned reversal');
const trimmed = [
  reversalOf(delivery, 'r3', T + 2 * HOUR),
  stamp(buildMovement(mince, 20, 'added', 'Later'), { id: 'd3', totalCost: 900, timestamp: T + 4 * HOUR }),
];
check('the orphan is still excluded', effectiveMovements(trimmed).length, 1);
check('and the live receipt survives', effectiveMovements(trimmed)[0].id, 'd3');
check('only the live receipt is spending', spent(trimmed), 900);

/* ------------------------------------------------- levels are unaffected */
// Convention 6 and ADR-017: effective for economics, every row for levels. A
// reversal genuinely moved the shelf, and `resulting` records where it left it.
console.log('\nLevels read every row');
const levelAt = (ms: StockMovement[], at: number) => ledgerLevelsAt(ms, at).get('s1') ?? null;
check('after the delivery', levelAt(received, T + 10 * HOUR), 180);
check('after the undo', levelAt(undoneByLedger, T + 10 * HOUR), 80);
check('after the restore', levelAt(restored, T + 10 * HOUR), 180);
check('a full cycle returns to where it was', levelAt(restored, T + 10 * HOUR), levelAt(received, T + 10 * HOUR));
// And the reason the filter must not be applied here: at 1.5h the shelf really
// held 180, and a filtered ledger would report the 80 it started from.
check('the shelf at 1.5h', levelAt(restored, T + 1.5 * HOUR), 180);
check('what the filter would have said', levelAt(effectiveMovements(restored), T + 1.5 * HOUR), 80);

/* --------------------------------------- a correction is still a correction */
// The two reasons exist to be told apart. A genuine count is not bookkeeping:
// it survives the filter and still reaches shrinkage, which is the finding.
console.log('\nA correction is still a correction');
const counting = [stamp(
  buildMovement({ ...mince, quantity: 80 }, -6, 'stocktake', 'Saturday count'),
  { id: 'sc1', timestamp: T + 4 * HOUR },
)];
check('the count is not marked', counting[0].reversed, undefined);
check('it survives the filter', effectiveMovements(counting).length, 1);
check('and reaches shrinkage', shrinkageValue(counting, stock, led).variance, 6 * 50);
// Undone, it is a finding thrown away, and stops being counted as one.
const countUndone = postMovements(counting, [reversalOf(counting[0], 'r4', T + 5 * HOUR)]);
check('an undone count is no longer a finding', shrinkageValue(countUndone, stock, led).variance, 0);
check('and the shelf still remembers it', levelAt(countUndone, T + 4.5 * HOUR), 74);

/* -------------------------------------------------------- an undone void */
// Voiding sets `voidedAt`; its undo restores the whole order list from before
// the void, so there is no separate flag to forget. Checked rather than assumed.
console.log('\nAn undone void');
const soldTicket = order({ id: 'v1', subtotal: 500, total: 500, items: [line('a', 'A', 1, 500)] });
const voidedTicket = order({ ...soldTicket, voidedAt: T + HOUR, voidReason: 'Wrong order' });
check('a void is counted', voidStats([voidedTicket]).voided, 1);
check('an undone void is not', voidStats([soldTicket]).voided, 0);
check('and the ticket is live again', voidStats([soldTicket]).live, 1);
check('leaving void stats where they started', voidStats([soldTicket]).byCountPct, 0);

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
const day = (offset: number) => localDay(T + offset * 24 * HOUR);
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

/* ------------------------------------------------- per-event availability */
// ADR-018. `per-event` needs an event id to attach to. A lone session is shown
// as an event of one and has none, so offering the basis there produced an
// amount belonging to nothing — 1A-ii's bug 2. The fix is not to offer it, and
// the decision is made by the resolver so that the form and the figures cannot
// disagree about the same market.
console.log('\nPer-event availability');

const lone: TradingSession = {
  id: 'lone', name: 'Saturday', status: 'ended', startedAt: T, endedAt: T + 4 * HOUR,
  ticketCounter: 3, pausedMs: 0,
};
const dayOne: TradingSession = {
  id: 'day1', name: 'Friday', status: 'ended', startedAt: T, endedAt: T + 4 * HOUR,
  ticketCounter: 3, pausedMs: 0, eventId: 'winter',
};
const dayTwo: TradingSession = {
  id: 'day2', name: 'Saturday', status: 'ended', startedAt: T + 24 * HOUR,
  endedAt: T + 28 * HOUR, ticketCounter: 3, pausedMs: 0, eventId: 'winter',
};
const winter: TradingEvent = { id: 'winter', name: 'Winter Market', createdAt: T };

const scopeOf = (scope: Scope, sessions: TradingSession[], events: TradingEvent[]) =>
  resolveScope(scope, { orders: [], costs: [], sessions, events, now: T + 100 * HOUR });

// A session that belongs to no event. The group it resolves to is a stand-in,
// so there is no id and the basis is refused rather than offered and rejected.
const loneScope = scopeOf({ kind: 'session', id: 'lone' }, [lone], []);
check('a lone session offers no per-event', loneScope.perEvent.available, false);
check('and says why', typeof loneScope.perEvent.reason === 'string', true);
check('and resolves to no event id', loneScope.eventId, undefined);

// One day of a real market. The event exists, so the pitch fee has somewhere
// to go — and it is the same id `costsOf` was given.
const dayScope = scopeOf({ kind: 'session', id: 'day1' }, [dayOne, dayTwo], [winter]);
check('a grouped session offers per-event', dayScope.perEvent.available, true);
check('with no reason to give', dayScope.perEvent.reason, undefined);
check('and carries the event id', dayScope.eventId, 'winter');

// The whole market, which is the case the basis was invented for.
const eventScope = scopeOf({ kind: 'event', id: 'winter' }, [dayOne, dayTwo], [winter]);
check('an event scope offers per-event', eventScope.perEvent.available, true);
check('and carries its own id', eventScope.eventId, 'winter');

// A date window belongs to no event, but a cost logged from one is picked up
// by its timestamp — so what matters is whether a real event exists at all.
const datedWithout = scopeOf({ kind: 'range', preset: 'all' }, [lone], []);
check('dates with no events refuse it', datedWithout.perEvent.available, false);
const datedWith = scopeOf({ kind: 'range', preset: 'all' }, [dayOne, dayTwo], [winter]);
check('dates with an event allow it', datedWith.perEvent.available, true);

// A session id is not an event id, and must never stand in for one. If this
// ever passes, something has started inventing an event of one — which would
// make ADR-013's held-cost distinction meaningless, because the "event" and the
// session would then be the same period.
check('a session id never becomes an event id', loneScope.eventId === lone.id, false);

/* ------------------------------- what the form says it is about to file as */
// The copy is checked because it is the only place the money model is
// explained to the person typing the number, and copy that drifts from the
// code is exactly the debris ADR-012 left in HINT.costVariable.
console.log('\nThe form names its target');

check('per-session names the service',
  describeCostTarget({ basis: 'per-session', session: { name: 'Sat 14 Aug' } }),
  'Charged once for this service — Sat 14 Aug');
check('per-session with nothing running says so',
  describeCostTarget({ basis: 'per-session' }),
  'Charged once — no session running, so it is dated only');
check('per-event names the market and its span',
  describeCostTarget({
    basis: 'per-event',
    event: { name: 'Winter Market', sessionCount: 3, span: '14–16 Aug' },
  }),
  'Charged once for the whole event — Winter Market, 3 sessions, 14–16 Aug');
// The case ADR-021 exists for: the pitch fee is paid on Saturday morning, and
// the event it belongs to has not traded yet.
check('a planned event says it has not traded',
  describeCostTarget({ basis: 'per-event', event: { name: 'Winter Market', sessionCount: 0 } }),
  'Charged once for the whole event — Winter Market, no sessions yet');
check('an event of one is singular',
  describeCostTarget({
    basis: 'per-event', event: { name: 'Sunday Fair', sessionCount: 1, span: '14 Aug' },
  }),
  'Charged once for the whole event — Sunday Fair, 1 session, 14 Aug');
check('per-event with nothing picked asks',
  describeCostTarget({ basis: 'per-event' }),
  'Charged once for the whole event — pick which one');
check('per-order names the session',
  describeCostTarget({ basis: 'per-order', session: { name: 'Sat 14 Aug' } }),
  'Charged with every ticket in Sat 14 Aug');
check('per-unit is about the items',
  describeCostTarget({ basis: 'per-unit' }), 'Charged with every item sold');
check('per-revenue is a share',
  describeCostTarget({ basis: 'per-revenue' }), "Taken as a share of this period's sales");

// And what a per-unit cost rides on (ADR-022).
check('no target means everything',
  describeCostItems(undefined, { items: [] }), 'Charged with every item sold');
check('one item reads as one item',
  describeCostItems({ kind: 'items', ids: ['a'] }, { items: ['Burger'] }),
  'Charged with every Burger sold');
check('two are joined with and',
  describeCostItems({ kind: 'items', ids: ['a', 'd'] }, { items: ['Burger', 'Cola'] }),
  'Charged with every Burger and Cola sold');
check('a long list is cut short honestly',
  describeCostItems({ kind: 'items', ids: ['1', '2', '3', '4', '5'] },
    { items: ['Burger', 'Cola', 'Fries', 'Wrap', 'Shake'] }),
  'Charged with every Burger, Cola and Fries sold, and 2 more');
check('a category names the category',
  describeCostItems({ kind: 'category', id: 'cat-drinks' }, { items: [], category: 'Drinks' }),
  'Charged with every item in Drinks');
// A category that has been deleted resolves to nothing, and the form says so
// rather than reading as "everything" — which is what the absent case means.
check('a deleted category is not read as everything',
  describeCostItems({ kind: 'category', id: 'gone' }, { items: [] }),
  'Charged with every item in a category that no longer exists');
check('an empty item list is not read as everything',
  describeCostItems({ kind: 'items', ids: [] }, { items: [] }),
  'Charged with nothing — no items picked');

/* --------------------------------- the target that survives a basis change */
// This rule lived as one statement inside an onClick, on a .map over the five
// bases, checked by nothing — added in 1A-ii (4fd29c2) and re-reported four
// phases later as though it were still broken, because nothing said otherwise.
// 1C-ii-b rewrote that whole control. Extracted first, then checked, so that a
// later rewrite that drops it fails here rather than shipping.
console.log('\nThe target that survives a basis change');

// The case that was actually broken: a session picked under another basis is
// not one of per-event's options, so leaving it selected shows a control whose
// value is not in its own list — and produces an entry the form then refuses.
check('per-event drops a session target', targetAfterBasisChange('per-event', 'session:s1'), '');
check('per-event keeps an event target', targetAfterBasisChange('per-event', 'event:e1'), 'event:e1');
check('per-event leaves empty empty', targetAfterBasisChange('per-event', ''), '');

// Every other basis keeps whatever was chosen. An event target is legitimate
// under all five — a cost logged against an event is still that event's,
// whatever it is charged per — so nothing is cleared on the way back out.
for (const basis of ['per-session', 'per-order', 'per-unit', 'per-revenue'] as CostBasis[]) {
  check(`${basis} keeps a session target`, targetAfterBasisChange(basis, 'session:s1'), 'session:s1');
  check(`${basis} keeps an event target`, targetAfterBasisChange(basis, 'event:e1'), 'event:e1');
}

// Switching away from per-event and back must not resurrect what was dropped.
check(
  'per-event → per-session → per-event stays empty',
  targetAfterBasisChange('per-event', targetAfterBasisChange('per-session', targetAfterBasisChange('per-event', 'session:s1'))),
  '');

/* --------------------------------------------- events, and what they are for */
// Phase 1C-ii-a. `per-event` existed for one cost — the pitch fee for a
// three-day market, paid once — and that cost could not be logged, because an
// event could only be made by grouping two sessions that had already traded.
// The fee is paid on Saturday morning. These are the properties that make it
// loggable then, and the ones every existing consumer already depends on.
console.log('\nEvents');

const aSession = (over: Partial<TradingSession> & { id: string }): TradingSession => ({
  name: over.id, status: 'ended', startedAt: T, endedAt: T + 4 * HOUR,
  ticketCounter: 0, pausedMs: 0, ...over,
});

// --- eventStatus, across all three states -----------------------------------
// Derived from the sessions and never stored, so that resuming one cannot leave
// a column saying something the rows disagree with.
const plan: TradingEvent = {
  id: 'plan', name: 'Winter Market', createdAt: T,
  plannedStart: T + 48 * HOUR, plannedEnd: T + 96 * HOUR, venue: 'The square',
};
check('no sessions is planned', eventStatus(plan, []), 'planned');

const dayA = aSession({ id: 'a', eventId: 'plan', status: 'ended' });
const dayB = aSession({ id: 'b', eventId: 'plan', status: 'ended', startedAt: T + 24 * HOUR });
check('all ended is ended', eventStatus(plan, [dayA, dayB]), 'ended');
check('one active is active',
  eventStatus(plan, [dayA, { ...dayB, status: 'active', endedAt: undefined }]), 'active');
// Paused is mid-market, not finished. A market that stops at dusk and picks up
// in the morning is still running, and calling it ended overnight is the
// calendar-day mistake invariant 4 exists against.
check('one paused is active',
  eventStatus(plan, [dayA, { ...dayB, status: 'paused', endedAt: undefined }]), 'active');
// The transition that a stored status would get wrong. An event whose only
// session has ended reads `ended`; resume that session and it reads `active`
// again, with nothing to migrate and nothing to disagree with.
const only = aSession({ id: 'only', eventId: 'plan', status: 'ended' });
check('an event of one, ended', eventStatus(plan, [only]), 'ended');
const revived = resumeSession(pauseSession(
  { ...only, status: 'active', endedAt: undefined }, T + 4 * HOUR), T + 8 * HOUR);
check('and active again once resumed', eventStatus(plan, [revived]), 'active');
// Sessions belonging to some other event are not this one's business.
check('another event\'s sessions do not count',
  eventStatus(plan, [aSession({ id: 'x', eventId: 'other', status: 'active', endedAt: undefined })]),
  'planned');

// --- an event of one is not a lone session ----------------------------------
// ADR-020 makes an event of one legitimate, and the consequence is that a real
// one and an ungrouped session are drawn alike. `grouped` is what tells them
// apart, and `ResolvedScope.eventId` is what the cost form reads.
const declared: TradingEvent = { id: 'declared', name: 'Saturday Market', createdAt: T };
const inside = aSession({ id: 'inside', eventId: 'declared' });
const alone = aSession({ id: 'alone', startedAt: T + 48 * HOUR, endedAt: T + 52 * HOUR });
const mixed = eventGroups([declared], [inside, alone]);
const declaredGroup = mixed.find(g => g.sessions.some(s => s.id === 'inside'));
const aloneGroup = mixed.find(g => g.sessions.some(s => s.id === 'alone'));
check('an event of one is grouped', declaredGroup?.grouped, true);
check('and carries the event id', declaredGroup?.id, 'declared');
check('a lone session is not grouped', aloneGroup?.grouped, false);
check('and carries only its own id', aloneGroup?.id, 'alone');
// Both hold exactly one session, which is the whole reason they look alike.
check('both are one session', [declaredGroup?.sessions.length, aloneGroup?.sessions.length], [1, 1]);
// The manager's two lists. An event of one is an event; a lone session is not.
check('allEvents holds only the event', allEvents([declared], [inside, alone]).length, 1);
check('and ungroupedSessions holds only the session',
  ungroupedSessions([declared], [inside, alone]).map(s => s.id), ['alone']);
// A session pointing at an event that is not there is ungrouped, in both lists
// and in eventGroups. A dangling id is a broken link, not a hidden session.
check('a dangling event id reads as ungrouped',
  ungroupedSessions([], [inside]).map(s => s.id), ['inside']);

// --- eventGroups excludes session-less events; allEvents includes them -------
// This is the property every existing consumer depends on, asserted out loud.
// `eventGroups` was excluding them only because auto-delete meant they could
// not occur; ADR-021 makes them occur, so the exclusion is now explicit.
// Several consumers index `group.sessions[0]` and `spanOf(group.sessions)`,
// which are wrong on an empty group rather than merely empty.
const empty: TradingEvent = { id: 'empty', name: 'Next month', createdAt: T, plannedStart: T + 300 * HOUR };
check('eventGroups omits a session-less event',
  eventGroups([declared, empty], [inside]).map(g => g.id), ['declared']);
check('no group is ever empty',
  eventGroups([declared, empty], [inside, alone]).every(g => g.sessions.length > 0), true);
check('allEvents keeps it', allEvents([declared, empty], [inside]).map(l => l.event.id).sort(),
  ['declared', 'empty']);
const emptyListing = allEvents([empty], [])[0];
check('with status planned', emptyListing.status, 'planned');
// Its span is null rather than the plan. A plan in the column a measurement
// belongs in is how a plan becomes a record.
check('and no span, because nothing traded', emptyListing.span, null);
check('the plan is still readable', emptyListing.event.plannedStart, T + 300 * HOUR);

// --- no auto-delete ---------------------------------------------------------
// Detaching the last session used to delete the event. It does not now: a
// planned event with no sessions is exactly what "created Thursday for
// Saturday" produces, and it is also what correcting a mis-grouping produces
// one keystroke before the session goes back (ADR-021).
const detached = { ...inside, eventId: undefined };
check('the event survives its last session leaving',
  allEvents([declared], [detached]).map(l => l.event.id), ['declared']);
check('with no sessions', allEvents([declared], [detached])[0].sessions.length, 0);
check('and status planned again', eventStatus(declared, [detached]), 'planned');
check('while dropping out of eventGroups', eventGroups([declared], [detached]).length, 1);
check('as a lone session, not as the event',
  eventGroups([declared], [detached])[0].grouped, false);
// And deleting one that a cost is charged to is refused rather than orphaning
// the cost. A per-event entry carries the event id and nothing else, so the
// amount would point at a row that is gone: invisible to costsForEvent, to
// every event figure, and correct-looking wherever it was typed.
const pitchFee = cost({ id: 'c-pitch', eventId: 'declared', amount: 3000, basis: 'per-event' });
check('a cost filed against the event blocks deleting it',
  costsFiledAgainstEvent([pitchFee], 'declared').length, 1);
check('a session cost does not', costsFiledAgainstEvent([cost({ sessionId: 'inside' })], 'declared').length, 0);

// --- the four new columns, through persistence -------------------------------
// The pattern 1A-i used for `cost_entries`, and for the same reason: `eventId`
// was on the type, had no column, was never written, and every event-level cost
// was lost on reload while the type went on claiming it was there. Field by
// field, then whole, so a column added on one side and not the other fails here
// even when nobody thought to check it by name.
console.log('\nEvent round trip');
const planned: TradingEvent = {
  id: 'evt-plan',
  name: 'Winter Market',
  plannedStart: T + 48 * HOUR,
  plannedEnd: T + 96 * HOUR,
  venue: 'Market Square',
  notes: 'Pitch 14, back row',
  createdAt: T,
};
const eventColumns = [...TRADING_EVENT_COLUMNS];
const eventWritten = tradingEventToRow(planned);
const eventRead = tradingEventFromRow(
  Object.fromEntries(eventColumns.map((name, i) => [name, eventWritten[i]])),
);
check('planned start survives the round trip', eventRead.plannedStart, T + 48 * HOUR);
check('planned end survives it', eventRead.plannedEnd, T + 96 * HOUR);
check('venue survives it', eventRead.venue, 'Market Square');
check('notes survive it', eventRead.notes, 'Pitch 14, back row');
check('name survives it', eventRead.name, 'Winter Market');
check('createdAt survives it', eventRead.createdAt, T);
check('the whole event is unchanged', sortKeys(eventRead), sortKeys(planned));

// An event made by grouping after the fact has no plan, and must come back with
// none rather than with zeros. A missing plan is not a plan of the epoch, and a
// blank venue is not a venue — the same distinction as invariant 2, applied to
// dates and text.
const unplanned: TradingEvent = { id: 'evt-bare', name: 'Autumn Fair', createdAt: T };
const bareRead = tradingEventFromRow(Object.fromEntries(
  eventColumns.map((name, i) => [name, tradingEventToRow(unplanned)[i]]),
));
check('an unplanned event round-trips as unplanned', sortKeys(bareRead), sortKeys(unplanned));
check('no planned start invented', bareRead.plannedStart, undefined);
check('no venue invented', bareRead.venue, undefined);
// A row written by an older build has none of the three columns at all. It has
// to load, and it has to load as an event with no plan.
const legacyRead = tradingEventFromRow({ id: 'evt-old', name: 'Old', notes: null, created_at: T });
check('a pre-migration row still loads', legacyRead.name, 'Old');
// Asserted as a boolean rather than as an array of undefineds: `check` compares
// through JSON, where undefined and null both serialise to null, so the array
// form would pass on a row that came back holding literal nulls.
check('and carries no plan',
  [legacyRead.plannedStart, legacyRead.plannedEnd, legacyRead.venue]
    .every(v => v === undefined),
  true);
// Zero is what a column filled by a default would hold, and it is not a plan.
check('a stored zero is not a date',
  tradingEventFromRow({ id: 'z', name: 'Z', planned_start: 0, created_at: T }).plannedStart,
  undefined);
// There is no status column, and there must not be one: it would be a second
// source of truth about a fact the sessions already hold, and the two would
// disagree the first time somebody resumed a session inside an ended event.
check('status is not stored', eventColumns.includes('status' as never), false);

// --- starting a session into an event ---------------------------------------
// Optional, and undefined by default. Most days are just days.
console.log('\nStarting into an event');
check('no event by default', startSession([], T, 'Tuesday').eventId, undefined);
check('and the field is absent, not null',
  Object.prototype.hasOwnProperty.call(startSession([], T, 'Tuesday'), 'eventId'), false);
const started = startSession([], T, 'Day one', 'declared');
check('an event when one is named', started.eventId, 'declared');
// Which means it is in the event from its first order, rather than after the
// market is over and somebody remembers to group it.
check('and it is the event\'s from the start',
  eventStatus(declared, [started]), 'active');
check('reported as the event, not as itself',
  eventGroups([declared], [started])[0].id, 'declared');

/* ----------------------------------------------------------- the tab set */
// ADR-019 and the 1C-i tab migration. Both are pure so that they can be held to
// their word here — the rest of the tab bar is React and invisible to this file.
console.log('\nTabs, and what the lock hides');

check('an old Overview lands on Finance', migrateTabId('overview'), 'finance');
check('an old Sales lands on Business', migrateTabId('sales'), 'business');
check('an old Orders lands on History', migrateTabId('orders'), 'history');
// Costs is not a tab any more at all — logging a cost is an action on Finance.
check('an old Costs lands on Finance', migrateTabId('costs'), 'finance');
check('a current id is left alone', migrateTabId('inventory'), 'inventory');
check('nonsense falls back to the default', migrateTabId('nope'), DEFAULT_TAB);
// Every tab that exists survives a round trip, so renaming one without updating
// the migration fails here rather than silently resetting somebody's screen.
check('every tab id survives itself', TABS.every(t => migrateTabId(t.id) === t.id), true);

// The table from the phase brief, stated as checks. The partial case is the
// point: quantities without the PIN, money with it.
const hides = (tab: Parameters<typeof lockFor>[0], source?: HistorySource) =>
  resolveLock(lockFor(tab, source), true);
check('Finance is hidden entirely', hides('finance').hidden, true);
check('Business is hidden entirely', hides('business').hidden, true);
check('Inventory is not hidden', hides('inventory').hidden, false);
check('Inventory hides its money', hides('inventory').moneyHidden, true);
check('History · Orders stays open', hides('history', 'orders').hidden, false);
check('History · Stock stays open', hides('history', 'stock').hidden, false);
check('History · Money is hidden', hides('history', 'money').hidden, true);
// Nothing is withheld from anyone without a PIN set. The capability is about
// what the lock covers, not about hiding things in general.
check(
  'unlocked hides nothing anywhere',
  TABS.every(t => {
    const state = resolveLock(lockFor(t.id), false);
    return !state.hidden && !state.moneyHidden;
  }),
  true,
);
// A tab is either replaced or redacted, never both — the two flags are
// alternatives, and code downstream reads them as such.
check(
  'hidden and money-hidden are exclusive',
  (['all', 'money-columns', 'none'] as const)
    .every(l => !(resolveLock(l, true).hidden && resolveLock(l, true).moneyHidden)),
  true,
);

console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) FAILED.`}`);
process.exit(failures === 0 ? 0 : 1);
