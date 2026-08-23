import { useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertTriangle, BarChart3, ChevronLeft, ChevronRight, Clock, Coins, Search, ShoppingBag, Timer,
} from 'lucide-react';
import {
  ACCENT, BarChart, DANGER, GOOD, KpiCard, Panel, RankedRows, money, compactMoney,
} from './AnalyticsUI';
import { NavActions, NavSlot, NavTab, NavTabs } from '../components/Navigation';
import { useStickyState } from '../lib/screenState';
import { IconButton, SegmentedControl, Toggle, Tooltip, useNow, useReducedMotion, useSection } from '../ui';
import { useTabStep } from '../lib/navigation';
import { LockedRevenue } from './RevenueLock';
import { OrdersExplorer } from './OrdersExplorer';
import { CostsPanel } from './CostsPanel';
import { ScopePicker } from './ScopePicker';
import { ExportMenu } from './ExportMenu';
import { DEFAULT_SCOPE, resolveScope, trendBuckets, type Scope } from './scope';
import {
  BREAK_EVEN_BLOCKED,
  attachmentPairs, breakEven, breakEvenByItem, bucketsFor, categoryPerformance, costSummary,
  dataQuality, itemMargins, stockPurchasesValue,
  deadStock, eventPerformance, foodCost, grainFor, inventoryTurnover, inventoryValue,
  itemPerformance, popularityTrend, queueBands, sessionPerformance, shrinkageValue,
  stockoutStats, throughput, totalsFor, tradingHours, voidStats,
} from './metrics';
import { eventGroups } from '../lib/sessions';
import type { CostScope, DateRange, ItemBreakEven } from './metrics';
import type {
  CostBasis, CostEntry, InventorySnapshot, MenuItem, MenuItemStockAssignment, Order,
  OversellEvent, StockItem, StockMovement, TradingEvent, TradingSession,
} from '../types';

type Tab = 'overview' | 'sales' | 'orders' | 'costs';

const TAB_LABEL: Record<Tab, string> = {
  overview: 'Overview',
  sales: 'Sales',
  orders: 'Orders',
  costs: 'Costs',
};

export interface AnalyticsViewProps {
  orders: Order[];
  menuItems: MenuItem[];
  stockItems: StockItem[];
  assignments: MenuItemStockAssignment[];
  movements: StockMovement[];
  snapshots: InventorySnapshot[];
  oversells: OversellEvent[];
  sessions: TradingSession[];
  events: TradingEvent[];
  costs: CostEntry[];
  onAddCost: (amount: number, note: string, basis: CostBasis, target?: { sessionId?: string; eventId?: string }) => void;
  /** Changes what a cost is charged per. The migration notice is its one caller. */
  onRefileCost: (id: string, basis: CostBasis) => void;
  onDeleteCost: (id: string) => void;
  /** Whether the fixed/variable migration notice has been dealt with already. */
  costBasisNoticeDismissed: boolean;
  onDismissCostBasisNotice: () => void;
  taxEnabled: boolean;
  revenueLocked: boolean;
  onUnlockRevenue: () => void;
  onOpenInventory: () => void;
}

const minutes = (ms: number | null) => (ms === null ? '—' : `${Math.round(ms / 60000)} min`);
const pct = (n: number) => `${n.toFixed(1)}%`;

/** One shared empty array, so "no previous period" is a stable reference. */
const EMPTY_ORDERS: Order[] = [];

/**
 * Holds a list steady while its contents are unchanged.
 *
 * The scope is re-resolved on every clock tick, and it builds fresh arrays each
 * time — so a screen full of `useMemo` keyed on those arrays would recompute
 * everything every few seconds, including the two or three things on it that
 * are genuinely expensive and have nothing to do with the time.
 *
 * The comparison is by reference, element by element. Every list here is
 * derived by filtering the same underlying rows, so an element that has not
 * changed is the same object; a deep comparison would cost more than the
 * recomputation it saves.
 */
function useStableList<T>(next: readonly T[]): T[] {
  const held = useRef(next as T[]);
  const previous = held.current;
  if (previous !== next && !sameMembers(previous, next)) {
    held.current = next as T[];
  }
  return held.current;
}

function sameMembers<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * The same idea for the date window, which is three primitives in a fresh
 * object. A "Today" range is rebuilt on every tick and is identical all day.
 */
function useStableRange(next: DateRange): DateRange {
  const held = useRef(next);
  const previous = held.current;
  if (
    previous.start !== next.start
    || previous.end !== next.end
    || previous.label !== next.label
  ) {
    held.current = next;
  }
  return held.current;
}

export function AnalyticsView(props: AnalyticsViewProps) {
  const {
    orders, menuItems, stockItems, assignments, movements, snapshots, oversells,
    sessions, events, costs, revenueLocked, onUnlockRevenue,
  } = props;

  // Sticky, so leaving for Inventory and coming back returns you to the tab
  // and period you had set up rather than resetting to Overview / last 30 days.
  const [tab, setTabRaw] = useStickyState<Tab>('analytics.tab', 'overview');
  const [scope, setScope] = useStickyState<Scope>('analytics.scope', DEFAULT_SCOPE);

  // Changing tab is a navigation step, so back walks Costs → Sales → Overview
  // rather than leaving the section outright.
  const setTab = useTabStep(tab, setTabRaw, t => TAB_LABEL[t]);

  /**
   * The clock this screen reads from.
   *
   * Faster while a service is running, because that is when somebody is
   * standing at the till watching revenue per trading hour move. Slower
   * otherwise: nothing on a screen looking at last month changes faster than
   * the orders behind it, and every tick costs a recomputation of the figures
   * that genuinely depend on the time.
   */
  const sessionIsLive = sessions.some(s => s.status === 'active');
  const now = useNow(sessionIsLive ? 5_000 : 30_000);

  const resolved = useMemo(
    () => resolveScope(scope, { orders, costs, sessions, events, now }),
    [scope, orders, costs, sessions, events, now],
  );

  /*
   * `resolveScope` builds a fresh range object and a fresh order list every
   * time it runs, so with `now` in its dependencies their *identity* changes on
   * every tick even when neither has actually moved. Nearly everything below
   * keys on identity, and most of it does not depend on the current time at all
   * — the item and category tables least of all, and they are the two most
   * expensive things on the screen.
   *
   * So the scope's outputs are held steady by value before anything else reads
   * them. A tick then recomputes the figures that are genuinely live and
   * nothing else, which is the whole point of having a clock rather than a
   * re-render.
   */
  const range = useStableRange(resolved.range);
  const scopedOrders = useStableList(resolved.orders);
  const scopedEntries = useStableList(resolved.costs);
  const scopedSessions = useStableList(resolved.sessions);
  const priorOrders = useStableList(resolved.previous?.orders ?? EMPTY_ORDERS);

  const current = useMemo(() => totalsFor(scopedOrders), [scopedOrders]);
  const prior = useMemo(() => totalsFor(priorOrders), [priorOrders]);

  // Item and category tables read from the scoped orders, but still take a range
  // because deals and discounts are resolved per order and the helpers filter
  // by it. For a session scope the range is the session's own span, so the two
  // agree by construction.
  //
  // Neither depends on the current time, so neither takes `now`. Adding it here
  // would rebuild both tables on every tick to produce the same answer.
  const items = useMemo(
    () => itemPerformance(scopedOrders, menuItems, range), [scopedOrders, menuItems, range]);
  const categories = useMemo(() => categoryPerformance(items), [items]);
  const buckets = useMemo(
    () => bucketsFor(scopedOrders, range, grainFor(range)), [scopedOrders, range]);
  const hours = useMemo(() => tradingHours(scopedOrders, range), [scopedOrders, range]);
  const tp = useMemo(() => throughput(scopedOrders, range), [scopedOrders, range]);
  const bands = useMemo(() => queueBands(scopedOrders, range), [scopedOrders, range]);
  const stock = useMemo(() => inventoryValue(stockItems), [stockItems]);
  const shrink = useMemo(
    () => shrinkageValue(movements, stockItems, range), [movements, stockItems, range]);
  // Live: a period running up to now closes on the shelf itself, and whether
  // the period is still open is decided against `now`.
  const food = useMemo(
    () => foodCost(current, movements, snapshots, stockItems, range, now),
    [current, movements, snapshots, stockItems, range, now]);
  const issues = useMemo(
    () => dataQuality(scopedOrders, stockItems, assignments, menuItems, range, food),
    [scopedOrders, stockItems, assignments, menuItems, range, food]);

  const groups = useMemo(() => eventGroups(events, sessions), [events, sessions]);
  // Both carry a trading-hours figure taken from the session clock, which runs
  // while a session is live.
  const byEvent = useMemo(
    () => eventPerformance(orders, groups, now).slice(-14), [orders, groups, now]);
  const bySession = useMemo(
    () => sessionPerformance(orders, scopedSessions, now), [orders, scopedSessions, now]);

  /**
   * Counting stock bought before the period started.
   *
   * Gross profit only ever deducts the ingredients that were actually eaten,
   * which is correct accounting and not what somebody running a stall means by
   * "did today pay for itself". Buying twenty thousand rupees of stock the
   * night before a market leaves the till whether or not it all sells, and with
   * this off none of it appears anywhere in the market's figures.
   *
   * On, it counts everything bought since the *last* time you traded — which is
   * the honest window, because that is the stock bought for this trade — and
   * folds it in as a fixed cost, so break-even reflects what actually has to be
   * earned back.
   */
  const [includeEarlierStock, setIncludeEarlierStock] = useStickyState(
    'analytics.includeEarlierStock', false);

  const earlierStockCost = useMemo(() => {
    if (!includeEarlierStock || !resolved.sessionScoped) return 0;
    const ordered = groups
      .filter(g => g.sessions.length > 0)
      .sort((a, b) => a.startedAt - b.startedAt);
    const index = ordered.findIndex(g => g.sessions.some(
      member => scopedSessions.some(inScope => inScope.id === member.id)));
    const previous = index > 0 ? ordered[index - 1] : null;
    // From the end of the last trading you did, or from the very beginning if
    // this is the first — anything earlier belongs to a period already reported.
    const from = previous?.endedAt ?? 0;
    if (from >= range.start) return 0;
    return stockPurchasesValue(movements, stockItems, from, range.start);
    // Keyed on the fields actually read rather than on `resolved` itself, whose
    // identity changes on every clock tick.
  }, [includeEarlierStock, resolved.sessionScoped, scopedSessions, groups, movements, stockItems, range.start]);

  const scopedCosts = useMemo(() => {
    const base = costSummary(scopedEntries);
    if (earlierStockCost <= 0) return base;
    // Stock bought before this event started is money already committed to it,
    // so it joins the per-session total rather than any of the rates — it does
    // not scale with what sells, it was spent before anything did.
    return {
      ...base,
      byBasis: { ...base.byBasis, 'per-session': base.byBasis['per-session'] + earlierStockCost },
      total: base.total + earlierStockCost,
      entries: base.entries + 1,
    };
  }, [scopedEntries, earlierStockCost]);

  /**
   * Which kind of period the costs are being resolved against.
   *
   * The only figure this changes is what happens to a `per-event` cost. Looking
   * at one session out of an event, it is held back rather than shared out —
   * apportioning it would make this session's break-even move when a *later*
   * session trades well, which is the same moving target ADR-012 removed. The
   * event carries it, and the panel offers the event as somewhere to go.
   */
  const costScope: CostScope = resolved.scope.kind === 'session'
    ? 'session'
    : resolved.scope.kind === 'event' ? 'event' : 'range';

  /** The event this session belongs to, when it belongs to a real one. */
  const containingEvent = useMemo(() => {
    if (resolved.scope.kind !== 'session') return null;
    const id = resolved.scope.id;
    return groups.find(g => g.grouped && g.sessions.some(s => s.id === id)) ?? null;
  }, [resolved.scope, groups]);

  const be = useMemo(
    () => breakEven(current, scopedCosts, costScope), [current, scopedCosts, costScope]);
  /**
   * Margin today and realised margin, per item.
   *
   * Deliberately outside the clock — neither figure depends on the time, and
   * this walks the recipe for every item in scope (ADR-009). It does depend on
   * the menu, the recipes and the stock costs, because "margin today" is the
   * figure that has to respond the moment any of the three is edited.
   */
  const margins = useMemo(
    () => itemMargins(items, menuItems, assignments, stockItems, scopedCosts, current, costScope),
    [items, menuItems, assignments, stockItems, scopedCosts, current, costScope]);
  const beByItem = useMemo(
    () => breakEvenByItem(margins, scopedCosts, current, costScope),
    [margins, scopedCosts, current, costScope]);
  const voids = useMemo(() => voidStats(scopedOrders), [scopedOrders]);
  const pairs = useMemo(
    () => attachmentPairs(scopedOrders, menuItems, range).slice(0, 8),
    [scopedOrders, menuItems, range]);
  const trendPoints = useMemo(
    () => trendBuckets(resolved, sessions, events),
    // `trendBuckets` reads only these three fields of the resolved scope, and
    // none of them is a clock. Keying on the whole object would rebuild the
    // popularity trend — which walks every order ever taken — on every tick.
    [resolved.sessionScoped, scopedSessions, range, sessions, events],
  );
  const trend = useMemo(
    () => popularityTrend(orders, menuItems, trendPoints), [orders, menuItems, trendPoints]);
  const stockouts = useMemo(
    () => stockoutStats(movements, stockItems, oversells, range),
    [movements, stockItems, oversells, range]);
  const turnover = useMemo(
    () => inventoryTurnover(current, snapshots, stockItems, range),
    [current, snapshots, stockItems, range]);
  // Idle days are measured from now, so a screen left open overnight has to
  // move. Cheap enough to take the tick: one pass over the ledger.
  const dead = useMemo(() => deadStock(stockItems, movements, now), [stockItems, movements, now]);

  const revenuePerHour = resolved.tradingHours > 0
    ? current.netRevenue / resolved.tradingHours : null;
  const busiestHour = hours.reduce((best, h) => (h.orders > best.orders ? h : best), hours[0]);
  const comparisonLabel = resolved.previous?.label ?? 'previous';

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* The screen's own tabs live in the permanent bar rather than under it,
          so no screen costs a second row of chrome. */}
      <NavSlot>
        <NavTabs>
          {([
            { id: 'overview', label: 'Overview', icon: BarChart3, hint: 'The headline figures — what you took, what it cost, and what you made.' },
            { id: 'sales', label: 'Sales', icon: ShoppingBag, hint: 'What sold, when, and what people bought together.' },
            { id: 'orders', label: 'Orders', icon: Search, hint: 'Search every order you have ever taken.' },
            { id: 'costs', label: 'Costs', icon: Coins, hint: 'The costs the till cannot see — the pitch fee, staff, fuel, packaging.' },
          ] as const).map(t => (
            <NavTab
              key={t.id}
              active={tab === t.id}
              onClick={() => setTab(t.id)}
              icon={<t.icon size={19} />}
              label={t.label}
              hint={t.hint}
              groupId="analytics"
              data-ana-tab={t.id}
            />
          ))}
        </NavTabs>

        <NavActions>
          <ExportMenu
            orders={orders}
            menuItems={menuItems}
            stockItems={stockItems}
            assignments={assignments}
            movements={movements}
            snapshots={snapshots}
            oversells={oversells}
            sessions={sessions}
            events={events}
            costs={costs}
            taxEnabled={props.taxEnabled}
          />
          {resolved.sessionScoped && (
            <Tooltip label="Count the stock you bought since you last traded as a cost of this one. Off, only the ingredients actually eaten are counted.">
              <span className="flex items-center gap-[8px] pl-[12px] pr-[13px] h-[46px] rounded-[11px] border border-[var(--app-border)] bg-[var(--app-bg-darker)]">
                <span className="text-[var(--app-text-secondary)] text-[13px] font-semibold whitespace-nowrap">
                  Earlier stock
                </span>
                <Toggle
                  size="sm"
                  checked={includeEarlierStock}
                  onChange={setIncludeEarlierStock}
                  label="Include stock bought before this period"
                />
              </span>
            </Tooltip>
          )}
          <ScopePicker
            resolved={resolved}
            sessions={sessions}
            events={events}
            onChange={setScope}
          />
        </NavActions>
      </NavSlot>

      <div className="flex-1 min-h-0 bg-[var(--app-bg)] border-t border-[var(--app-border)] p-[18px] overflow-auto">
        {revenueLocked && tab !== 'orders' ? (
          <LockedRevenue onUnlock={onUnlockRevenue} />
        ) : (
          <AnimatePresence mode="wait" initial={false}>
            {tab === 'overview' && (
              <Screen key="overview">
                {issues.length > 0 && (
                  <div className="flex flex-col gap-[6px]" data-data-quality>
                    {issues.map(issue => (
                      <div
                        key={issue.id}
                        className="flex items-start gap-[11px] rounded-[12px] border px-[15px] py-[12px]"
                        style={{
                          borderColor: issue.severity === 'warn' ? `${DANGER}66` : 'var(--app-border)',
                          background: issue.severity === 'warn' ? `${DANGER}12` : 'var(--app-bg-darker)',
                        }}
                      >
                        <AlertTriangle
                          size={17}
                          className="shrink-0 mt-[1px]"
                          style={{ color: issue.severity === 'warn' ? DANGER : 'var(--app-text-muted)' }}
                        />
                        <span className="text-[var(--app-text-secondary)] text-[14px] leading-[19px]">
                          {issue.message}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {/*
                  Overview answers "how did the day run"; Sales answers "what did
                  it make". The money used to be here, which meant the first
                  screen anybody opened was a wall of accounting — and the
                  operational numbers that actually change what you do during
                  service were scattered between the two.
                */}
                <div className="grid gap-[12px]" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
                  <KpiCard
                    label="Orders" value={current.orders} previous={prior.orders}
                    format={n => String(Math.round(n))}
                    definition="How many orders you took, not counting any that were cancelled."
                  />
                  <KpiCard
                    label="Average order" value={current.averageOrderValue}
                    previous={prior.averageOrderValue} format={money}
                    definition="What an average customer spends — your takings divided by the number of orders."
                  />
                  <KpiCard
                    label="Queue time" value={tp.medianToReadyMs ?? 0}
                    format={n => `${Math.round(n / 60000)} min`}
                    unavailable={tp.medianToReadyMs === null ? 'No timed tickets' : undefined}
                    definition={`How long a typical order waits between being rung up and being called ready, across ${tp.measured} timed ticket${tp.measured === 1 ? '' : 's'}. The slowest one in ten waited ${minutes(tp.p90ToReadyMs)}.`}
                  />
                  <KpiCard
                    label="Busiest hour" value={tp.peakOrdersPerHour}
                    format={n => `${Math.round(n)}/h`}
                    definition="The most orders you took in any single hour of this period. What the kitchen has to be able to clear at the peak, not on average."
                  />

                  <KpiCard
                    label="Stockout rate" value={stockouts.ratePct} format={pct}
                    tone={stockouts.itemsOut > 0 ? DANGER : undefined}
                    definition={`${stockouts.itemsOut} of ${stockouts.itemsTracked} things you actually move ran out completely, on ${stockouts.occasions} occasion${stockouts.occasions === 1 ? '' : 's'}. ${Math.round(stockouts.oversoldUnits)} ${stockouts.oversoldUnits === 1 ? 'sale was' : 'sales were'} rung up beyond what the shelf could support — demand you could not meet.`}
                  />
                  <KpiCard
                    label="Inventory value" value={stock.total} format={money}
                    unavailable={stock.total === 0 && stock.uncosted > 0 ? 'Needs cost data' : undefined}
                    definition={`What everything on the shelf is worth at what it cost you.${stock.uncosted > 0 ? ` ${stock.uncosted} item${stock.uncosted === 1 ? ' has' : 's have'} no cost recorded and count as nothing here.` : ''}`}
                    onClick={props.onOpenInventory}
                  />
                  <KpiCard
                    label="Inventory turnover" value={turnover.turns ?? 0}
                    format={n => `${n.toFixed(2)}×`}
                    unavailable={turnover.blocked}
                    definition={`How many times over you sold through your whole shelf${turnover.averageInventory ? `, against an average of ${money(turnover.averageInventory)} held` : ''}${turnover.daysOfStock ? ` — about ${turnover.daysOfStock.toFixed(0)} days of stock on hand` : ''}.`}
                  />
                  <KpiCard
                    label="Waste + variance" value={shrink.waste + shrink.variance} format={money}
                    tone={shrink.waste + shrink.variance > 0 ? DANGER : undefined}
                    definition="Anything written off as waste, drained at the end of a market, or come up short at a stock take — valued at what it cost you. This is money that left without a sale."
                  />
                </div>

                <div className="grid gap-[16px]" style={{ gridTemplateColumns: '1.35fr 1fr' }}>
                  <Panel title="Kitchen" subtitle={`${tp.measured} timed ticket${tp.measured === 1 ? '' : 's'}`}>
                    <div className="grid grid-cols-3 gap-[11px]">
                      <Stat icon={<Timer size={15} />} label="Median queue" value={minutes(tp.medianToReadyMs)} />
                      <Stat icon={<Timer size={15} />} label="Slowest 10%" value={minutes(tp.p90ToReadyMs)} />
                      {/*
                        Average, not median.
                        A queue time is about experience, where the median is
                        right: it describes what a typical customer waits and
                        ignores the ticket that sat forgotten. Grill time is
                        being read as capacity — how long a slot is tied up, and
                        so how many tickets an hour the grill can clear. That is
                        a question about the total, and only the mean multiplies
                        back out to the total.
                      */}
                      <Stat icon={<Clock size={15} />} label="Average on grill" value={minutes(tp.averageOnGrillMs)} />
                      <Stat icon={<ShoppingBag size={15} />} label="Peak orders/hour" value={String(tp.peakOrdersPerHour)} />
                      <Stat
                        icon={<Clock size={15} />}
                        label="Trading hours"
                        value={resolved.tradingHours.toFixed(resolved.sessionScoped ? 1 : 0)}
                      />
                      <Stat
                        icon={<ShoppingBag size={15} />}
                        label="Orders per hour"
                        value={resolved.tradingHours > 0 ? (current.orders / resolved.tradingHours).toFixed(1) : '—'}
                      />
                    </div>

                    {tp.measured > 0 && (
                      <div className="mt-[12px]">
                        <span className="text-[var(--app-text-muted)] text-[11px] uppercase tracking-[0.5px] font-semibold">
                          Wait distribution
                        </span>
                        <div className="flex flex-col gap-[3px] mt-[6px]">
                          {bands.map(band => (
                            <div key={band.label} className="flex items-center gap-[8px]">
                              <span className="text-[var(--app-text-muted)] text-[11px] w-[52px] shrink-0">
                                {band.label}
                              </span>
                              <span className="flex-1 h-[7px] rounded-full bg-[var(--app-surface)] overflow-hidden">
                                <motion.span
                                  className="block h-full rounded-full"
                                  initial={{ width: 0 }}
                                  animate={{ width: `${band.share * 100}%` }}
                                  transition={{ type: 'spring', stiffness: 260, damping: 30 }}
                                  style={{ background: band.from >= 10 ? DANGER : ACCENT }}
                                />
                              </span>
                              <span className="text-[var(--app-text-secondary)] text-[11px] tabular-nums w-[34px] text-right">
                                {band.orders}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {tp.measured === 0 && (
                      <p className="text-[var(--app-text-muted)] text-[13px] mt-[11px] leading-[17px]">
                        Kitchen times are recorded as tickets move through the board. Nothing in
                        this period was moved with timings on, so there is nothing to measure yet.
                      </p>
                    )}
                  </Panel>

                  <Panel title="Dead stock" subtitle="Things you are holding that have not sold in a long time">
                    {dead.length === 0 ? (
                      <p className="text-[var(--app-text-muted)] text-[12px] py-[12px]">
                        Nothing in the stock history yet.
                      </p>
                    ) : (
                      <div className="flex flex-col gap-[8px]">
                        {dead.map(row => (
                          <div
                            key={row.stockItem.id}
                            className="rounded-[10px] border border-[var(--app-border)] bg-[var(--app-surface)] px-[12px] py-[10px]"
                            data-dead-stock={row.stockItem.name}
                          >
                            <span className="flex items-baseline gap-[8px]">
                              <span className="text-[var(--app-text)] text-[14px] font-semibold truncate">
                                {row.stockItem.name}
                              </span>
                              <span className="text-[var(--app-text-muted)] text-[11px] ml-auto tabular-nums">
                                {money(row.value)} held
                              </span>
                            </span>
                            <span className="block text-[var(--app-text-muted)] text-[11.5px] mt-[2px]">
                              {row.lastSoldAt === null
                                ? `Never sold · logged ${Math.round(row.idleDays ?? 0)} days ago`
                                : `Last sold ${Math.round(row.idleDays ?? 0)} days ago`}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </Panel>
                </div>

                {bySession.length > 1 && (
                  <Panel title="Sessions in scope" subtitle="What each session took for every hour it was open">
                    <RankedRows
                      rows={bySession.map(s => ({
                        label: s.name,
                        value: s.revenuePerHour ?? 0,
                        sub: `${money(s.totals.netRevenue)} over ${s.tradingHours.toFixed(1)}h · ${s.totals.orders} orders`,
                      }))}
                      format={n => `${money(n)}/h`}
                      emptyLabel="No sessions in this scope."
                    />
                  </Panel>
                )}
              </Screen>
            )}

            {tab === 'sales' && (
              <Screen key="sales">
                <div className="grid gap-[12px]" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
                  <KpiCard
                    label="Net revenue" value={current.netRevenue} previous={prior.netRevenue}
                    format={money}
                    definition={`What you sold, after discounts and with tax taken out — tax is collected on the state's behalf and is not yours. Compared against ${comparisonLabel}.`}
                  />
                  <KpiCard
                    label="Revenue per trading hour" value={revenuePerHour ?? 0}
                    format={money}
                    unavailable={revenuePerHour === null ? 'No trading time yet' : undefined}
                    definition={resolved.sessionScoped
                      ? `What you took for each of the ${resolved.tradingHours.toFixed(1)} hours the session was actually open, with any pause taken off. Quiet hours still count — the pitch is paid for either way.`
                      : `What you took for each of the ${resolved.tradingHours} hours in which anything sold at all. Pick a session above for a figure based on the hours you were actually open.`}
                  />
                  <KpiCard
                    label="Gross profit" value={current.grossProfit} previous={prior.grossProfit}
                    format={money} tone={GOOD}
                    unavailable={current.costCoverage === 0 ? 'No costed sales yet' : undefined}
                    definition={`What you took, less what the ingredients cost you. Only the ${Math.round(current.costCoverage * 100)}% of items you have costed are counted — the rest are left out of both sides rather than treated as free.`}
                  />
                  <KpiCard
                    label="Gross margin" value={current.grossMarginPct ?? 0}
                    previous={prior.grossMarginPct ?? undefined}
                    format={pct}
                    unavailable={current.grossMarginPct === null ? 'Needs cost data' : undefined}
                    definition="Profit as a share of takings. Only the items you have costed are compared, so the percentage is like for like."
                  />

                  <KpiCard label="Gross" value={current.gross} previous={prior.gross} format={money}
                    definition="What everything came to at full price, before any discount and before tax." />
                  <KpiCard
                    label="Discount rate" value={current.discountRatePct}
                    previous={prior.discountRatePct} format={pct}
                    tone={current.discountRatePct > 0 ? DANGER : undefined}
                    definition={`How much of your full price you gave away. ${money(current.discount)} came off in this period.`}
                  />
                  <KpiCard
                    label="Void rate" value={voids.byCountPct} format={pct}
                    tone={voids.voided > 0 ? DANGER : undefined}
                    definition={`${voids.voided} of ${voids.voided + voids.live} orders were cancelled after being rung up, worth ${money(voids.voidedValue)} — ${pct(voids.byValuePct)} of the money. Cancellations are recorded whether or not any money had changed hands.`}
                  />
                  <KpiCard label="Collected" value={current.collected} previous={prior.collected}
                    format={money}
                    definition="What customers actually handed over, tax included. This is what should be in the till and the bank." />

                  <KpiCard
                    label="Food cost" value={food.theoreticalPct ?? 0} format={pct}
                    unavailable={food.theoreticalPct === null ? 'Needs costed sales' : undefined}
                    definition={`What your recipes say these sales should have used up (${money(food.theoretical)}), as a share of what you took.`}
                  />
                  <KpiCard
                    label={food.basis === 'counted' ? 'Actual food cost' : 'Actual food cost (est.)'}
                    value={food.actualPct ?? 0} format={pct}
                    unavailable={food.actual === null ? (food.blocked ?? 'Unavailable') : undefined}
                    definition={`Opening stock ${money(food.openingValue ?? 0)} + purchases ${money(food.purchases)} − closing stock ${money(food.closingValue ?? 0)}, as a share of net revenue. ${food.countedAt !== null
                      ? `Closing stock was counted on ${new Date(food.countedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}, so this is measured rather than inferred.`
                      : 'Closing stock here is worked out from your deliveries and recipes rather than counted. Do a stock take to turn this from an estimate into a measurement.'}`}
                  />
                  <KpiCard
                    label="Food cost variance" value={food.variance ?? 0} format={money}
                    tone={food.variance !== null && food.variance > 0 ? DANGER : GOOD}
                    unavailable={food.variance === null ? (food.blocked ?? 'Unavailable') : undefined}
                    definition={`The gap between what you actually used and what the recipes say you should have. A positive figure means more went than the recipes account for — waste, heavy portions, or a delivery that came in dearer than expected. ${food.basis === 'counted' ? '' : 'Until you count the shelf this only catches losses you have already written down, so a figure near zero means nothing has been logged rather than nothing has gone missing.'}`}
                  />
                  <KpiCard
                    label="Break-even revenue" value={be.revenue ?? 0} format={money}
                    unavailable={be.blocked}
                    tone={be.progress !== null && be.progress >= 1 ? GOOD : undefined}
                    definition={`How much you need to take before the day starts making money. ${be.contributionRatio !== null ? `${(be.contributionRatio * 100).toFixed(0)}p of every rupee is left after ingredients and per-sale costs. ` : ''}Add your pitch fee, staff and fuel on the Costs tab to make this accurate.`}
                  />
                </div>

                <BreakEvenByItem
                  rows={beByItem}
                  blocked={be.blocked}
                  fixedCosts={be.fixedCosts}
                  heldEventCosts={be.heldEventCosts}
                  eventName={containingEvent?.name ?? null}
                  onOpenEvent={containingEvent
                    ? () => setScope({ kind: 'event', id: containingEvent.id })
                    : undefined}
                />

                <RevenueChart
                  buckets={buckets}
                  grainLabel={grainFor(range)}
                  hours={hours}
                  byEvent={byEvent}
                  busiestHour={busiestHour}
                />

                <div className="grid gap-[16px]" style={{ gridTemplateColumns: '1fr 1fr' }}>
                  <Panel title="Payment mix" subtitle="By how much money came in each way">
                    <RankedRows
                      rows={[
                        { label: 'Cash', value: current.cash },
                        { label: 'Transfer', value: current.transfer },
                      ].filter(r => r.value > 0)}
                      format={money}
                      emptyLabel="No payments recorded in this period."
                    />
                  </Panel>

                  <Panel
                    title="Bought together"
                    subtitle="Pairs that sell together more often than chance alone would explain"
                  >
                    {pairs.length === 0 ? (
                      <p className="text-[var(--app-text-muted)] text-[12px] py-[12px]">
                        No pair has appeared in two orders yet.
                      </p>
                    ) : (
                      <div className="flex flex-col gap-[2px]" data-attachment-pairs>
                        {pairs.map(pair => (
                          <div
                            key={`${pair.aId}|${pair.bId}`}
                            className="flex items-baseline gap-[8px] py-[6px] border-b border-[var(--app-border)] last:border-0"
                          >
                            <span className="text-[var(--app-text)] text-[13px] truncate">
                              {pair.aName} <span className="text-[var(--app-text-muted)]">+</span> {pair.bName}
                            </span>
                            <span className="flex-1" />
                            <span className="text-[var(--app-text-secondary)] text-[12px] tabular-nums whitespace-nowrap">
                              {pair.together}×
                            </span>
                            <span
                              className="text-[12px] tabular-nums font-semibold w-[54px] text-right"
                              style={{ color: pair.lift >= 1.2 ? GOOD : 'var(--app-text-muted)' }}
                            >
                              {pair.lift.toFixed(2)}×
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </Panel>
                </div>

                <div className="grid gap-[16px]" style={{ gridTemplateColumns: '1fr 1fr' }}>
                  <Panel title="Items by revenue" subtitle="A deal carries its whole price here; the things inside it carry the units">
                    <RankedRows
                      rows={items.filter(i => i.netRevenue > 0).slice(0, 10).map(i => ({
                        label: i.name,
                        value: i.netRevenue,
                        sub: `${Math.round(i.units)} units${i.marginPct !== null ? ` · ${i.marginPct.toFixed(0)}% margin` : ''}`,
                      }))}
                      format={money}
                    />
                  </Panel>

                  <Panel title="Items by units" subtitle="How many of each thing the kitchen actually made">
                    <RankedRows
                      rows={items.filter(i => i.units > 0)
                        .sort((a, b) => b.units - a.units).slice(0, 10)
                        .map(i => ({
                          label: i.name,
                          value: i.units,
                          sub: i.oversold > 0 ? `${Math.round(i.oversold)} sold beyond stock` : undefined,
                        }))}
                      format={n => `${Math.round(n)}`}
                    />
                  </Panel>
                </div>

                <div className="grid gap-[16px]" style={{ gridTemplateColumns: '1fr 1fr' }}>
                  <Panel title="Categories" subtitle="How much of your takings each category brought in">
                    <RankedRows
                      rows={categories.map(c => ({
                        label: c.category,
                        value: c.netRevenue,
                        sub: `${(c.share * 100).toFixed(0)}% · ${Math.round(c.units)} units`,
                      }))}
                      format={money}
                    />
                  </Panel>

                  <Panel
                    title="Popularity trend"
                    subtitle={trendPoints.length > 1
                      ? `Across the last ${trendPoints.length} sessions`
                      : 'Needs two sessions to compare'}
                  >
                    {trend.length === 0 || trendPoints.length < 2 ? (
                      <p className="text-[var(--app-text-muted)] text-[12px] py-[12px]">
                        Run a second session and this fills in: how many of each thing sold, and
                        where it ranked, side by side — so a quiet market is not mistaken for
                        something falling out of favour.
                      </p>
                    ) : (
                      <div className="flex flex-col gap-[2px]" data-popularity-trend>
                        {trend.map(row => (
                          <div
                            key={row.menuItemId}
                            className="flex items-baseline gap-[8px] py-[6px] border-b border-[var(--app-border)] last:border-0"
                          >
                            <span className="text-[var(--app-text)] text-[13px] truncate">{row.name}</span>
                            <span className="flex-1" />
                            <Sparkline points={row.points.map(p => p.units)} />
                            <span className="text-[var(--app-text-secondary)] text-[12px] tabular-nums w-[46px] text-right">
                              {Math.round(row.latestUnits)}
                            </span>
                            <span
                              className="text-[12px] tabular-nums font-semibold w-[58px] text-right"
                              style={{
                                color: row.changePct === null ? 'var(--app-text-muted)'
                                  : row.changePct > 0 ? GOOD : row.changePct < 0 ? DANGER : 'var(--app-text-muted)',
                              }}
                            >
                              {row.changePct === null ? 'new' : `${row.changePct > 0 ? '+' : ''}${row.changePct.toFixed(0)}%`}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </Panel>
                </div>
              </Screen>
            )}

            {tab === 'orders' && (
              <motion.div key="orders" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ type: 'spring', stiffness: 420, damping: 34 }} className="h-full min-h-0">
                <OrdersExplorer
                  orders={orders}
                  menuItems={menuItems}
                  sessions={sessions}
                  events={events}
                  revenueLocked={revenueLocked}
                />
              </motion.div>
            )}

            {tab === 'costs' && (
              <Screen key="costs">
                <CostsPanel
                  costs={costs}
                  sessions={sessions}
                  events={events}
                  onAdd={props.onAddCost}
                  onRefile={props.onRefileCost}
                  onDelete={props.onDeleteCost}
                  scopeLabel={resolved.label}
                  scopedCosts={scopedEntries}
                  noticeDismissed={props.costBasisNoticeDismissed}
                  onDismissNotice={props.onDismissCostBasisNotice}
                />
              </Screen>
            )}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}

function Screen({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
      transition={{ type: 'spring', stiffness: 420, damping: 34 }}
      className="flex flex-col gap-[16px]"
    >
      {children}
    </motion.div>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-[11px] border border-[var(--app-border)] bg-[var(--app-surface)] px-[13px] py-[11px]">
      <span className="flex items-center gap-[6px] text-[var(--app-text-muted)] text-[11px] uppercase tracking-[0.5px] font-semibold">
        {icon} {label}
      </span>
      <span className="block text-[var(--app-text)] text-[21px] font-bold leading-[26px] tabular-nums mt-[3px]">
        {value}
      </span>
    </div>
  );
}

/**
 * A trend line small enough to sit inside a table row.
 *
 * Drawn rather than charted for the same reason as the bars: at this size a
 * library brings axes, margins and a tooltip nobody asked for.
 */
function Sparkline({ points }: { points: number[] }) {
  if (points.length < 2) return <span className="w-[62px]" />;
  const max = Math.max(1, ...points);
  const step = 60 / (points.length - 1);
  const path = points
    .map((value, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${(16 - (value / max) * 14).toFixed(1)}`)
    .join(' ');
  const last = points[points.length - 1];
  const previous = points[points.length - 2];
  const tone = last > previous ? GOOD : last < previous ? DANGER : 'var(--app-text-muted)';

  return (
    <svg width={62} height={18} className="shrink-0" aria-hidden>
      <path d={path} fill="none" stroke={tone} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={60} cy={16 - (last / max) * 14} r={2} fill={tone} />
    </svg>
  );
}

/* ------------------------------------------------------- break-even by item */

/**
 * Break-even, said in things rather than in units.
 *
 * "You need to sell 61 units" was not an actionable sentence: units of what, at
 * an average price that nothing is actually sold at? Every item has its own
 * answer — the expensive one covers the day in half the sales of the cheap one
 * — so this steps through them one at a time rather than averaging the
 * difference away. One item on screen at once, because the number is only
 * useful if you can hold it in your head on the way back to the grill.
 */
function BreakEvenByItem({
  rows, blocked, fixedCosts, heldEventCosts, eventName, onOpenEvent,
}: {
  rows: ItemBreakEven[];
  blocked?: string;
  fixedCosts: number;
  /** Per-event rupees this figure deliberately leaves to the event (ADR-013). */
  heldEventCosts: number;
  eventName: string | null;
  onOpenEvent?: () => void;
}) {
  const theme = useSection();
  const reduced = useReducedMotion();
  const [index, setIndex] = useState(0);

  /**
   * What the event is carrying that this session is not.
   *
   * Said outright rather than folded in. A three-day market's pitch fee is paid
   * once for the market; charging each day a share of it would make Saturday's
   * break-even change after Sunday traded, which is the moving target ADR-012
   * removed and ADR-013 keeps removed.
   */
  const eventNote = heldEventCosts > 0 ? (
    <p className="text-[var(--app-text-muted)] text-[12px] leading-[17px] pt-[10px]">
      {eventName ?? 'The event'} carries {money(heldEventCosts)} of its own on top of this, paid
      once for the whole event rather than by this session.
      {onOpenEvent && (
        <button
          type="button"
          onClick={onOpenEvent}
          className="ml-[6px] underline underline-offset-2 font-semibold"
          style={{ color: theme.color }}
          data-open-event-scope
        >
          See the whole event
        </button>
      )}
    </p>
  ) : null;

  if (rows.length === 0) {
    return (
      <Panel title="Break-even" subtitle="How much you have to sell before the day pays for itself">
        <p className="text-[var(--app-text-muted)] text-[13px] leading-[18px] py-[8px]">
          {blocked === BREAK_EVEN_BLOCKED.noFixedCosts
            ? 'Log what the day costs you — the pitch fee, staff, fuel — on the Costs tab, and this will say how many of each thing you need to sell to cover it.'
            : blocked === BREAK_EVEN_BLOCKED.noBasket
              ? 'You have costs charged per ticket, but no tickets in this period to spread them over. The figure comes back as soon as something sells.'
              : blocked ?? 'Needs costed items. Assign stock to your menu items so the app knows what each one costs to make.'}
        </p>
        {eventNote}
      </Panel>
    );
  }

  const safe = Math.min(index, rows.length - 1);
  const row = rows[safe];
  const needed = Math.ceil(row.units);
  const progress = needed > 0 ? Math.min(1, row.sold / needed) : 0;
  const step = (delta: number) => setIndex((safe + delta + rows.length) % rows.length);

  return (
    <Panel
      title="Break-even"
      subtitle={`${money(fixedCosts)} to cover — here is what that is in each thing you sell`}
      actions={
        <span className="flex items-center gap-[4px]">
          <IconButton
            variant="quiet" size="sm" aria-label="Previous item"
            onClick={() => step(-1)} icon={<ChevronLeft size={17} />}
          />
          <span className="text-[var(--app-text-muted)] text-[11px] tabular-nums w-[42px] text-center">
            {safe + 1}/{rows.length}
          </span>
          <IconButton
            variant="quiet" size="sm" aria-label="Next item"
            onClick={() => step(1)} icon={<ChevronRight size={17} />}
          />
        </span>
      }
    >
      <div className="flex items-center gap-[20px] flex-wrap" data-break-even-item={row.name}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={row.menuItemId}
            initial={reduced ? false : { opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, x: -12 }}
            transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
            className="flex items-baseline gap-[12px] min-w-[260px]"
          >
            <span className="text-[38px] font-bold leading-none tabular-nums" style={{ color: theme.color }}>
              {needed}
            </span>
            <span className="flex flex-col">
              <span className="text-[var(--app-text)] text-[17px] font-bold leading-[21px]">{row.name}</span>
              <span className="text-[var(--app-text-muted)] text-[12px]">
                {money(row.contributionPerUnit)} left over on each, at today&rsquo;s price
              </span>
              {/*
                The two margins side by side, and only when they have parted
                company. This is the figure the old blended average could never
                show: a price that has moved, or a supplier cost that has, is
                invisible from either number on its own.
              */}
              {row.margin.diverged && row.margin.realised && row.margin.today && (
                <span className="text-[11.5px] leading-[16px] mt-[3px]" style={{ color: DANGER }}>
                  {row.margin.today.marginPct.toFixed(0)}% today against{' '}
                  {row.margin.realised.marginPct.toFixed(0)}% on what actually sold
                </span>
              )}
            </span>
          </motion.div>
        </AnimatePresence>

        <div className="flex-1 min-w-[220px]">
          <div className="flex items-baseline justify-between mb-[5px]">
            <span className="text-[var(--app-text-muted)] text-[11px] uppercase tracking-[0.6px] font-bold">
              Sold so far
            </span>
            <span className="text-[var(--app-text-secondary)] text-[12px] tabular-nums">
              {Math.round(row.sold)} of {needed}
            </span>
          </div>
          <span className="block h-[9px] rounded-full bg-[var(--app-surface)] overflow-hidden">
            <motion.span
              className="block h-full rounded-full"
              initial={reduced ? false : { width: 0 }}
              animate={{ width: `${progress * 100}%` }}
              transition={{ type: 'spring', stiffness: 240, damping: 30 }}
              style={{ background: progress >= 1 ? GOOD : theme.color }}
            />
          </span>
          <span className="block text-[var(--app-text-muted)] text-[11.5px] mt-[6px] leading-[16px]">
            {progress >= 1
              ? `Covered — everything past ${needed} is profit.`
              : `On ${row.name} alone. Selling anything else counts towards the same total.`}
          </span>
        </div>
      </div>
      {eventNote}
    </Panel>
  );
}

/* ----------------------------------------------------------- revenue chart */

type RevenueDimension = 'hour' | 'period' | 'event';

/**
 * One revenue chart with a switcher, instead of three charts in three places.
 *
 * Revenue by hour, by day and by event were separate panels on two different
 * tabs, which made comparing them a matter of scrolling and remembering. They
 * are the same measurement cut three ways, so they belong in the same frame
 * with a control that says which cut you are looking at.
 */
function RevenueChart({
  buckets, grainLabel, hours, byEvent, busiestHour,
}: {
  buckets: { key: number; label: string; totals: { netRevenue: number } }[];
  grainLabel: string;
  hours: { hour: number; netRevenue: number; orders: number }[];
  byEvent: { eventId: string; name: string; totals: { netRevenue: number } }[];
  busiestHour: { hour: number; orders: number } | undefined;
}) {
  const [dimension, setDimension] = useStickyState<RevenueDimension>(
    'analytics.revenueDimension', 'period');

  const data = dimension === 'hour'
    ? hours.map(h => ({ label: String(h.hour).padStart(2, '0'), key: h.hour, value: h.netRevenue }))
    : dimension === 'event'
      ? byEvent.map(e => ({ label: e.name, key: e.eventId, value: e.totals.netRevenue }))
      : buckets.map(b => ({ label: b.label, key: b.key, value: b.totals.netRevenue }));

  const subtitle = dimension === 'hour'
    ? 'Every trading day added together, hour by hour'
    : dimension === 'event'
      ? 'A session you have not grouped is shown on its own'
      : 'Days you did not trade are left out, so a closed Monday is not read as a bad Monday';

  return (
    <Panel
      title="Revenue"
      subtitle={subtitle}
      actions={
        <SegmentedControl
          size="sm"
          value={dimension}
          onChange={setDimension}
          options={[
            { value: 'hour' as const, label: 'Hour' },
            { value: 'period' as const, label: grainLabel === 'hour' ? 'Hour of day' : `By ${grainLabel}` },
            { value: 'event' as const, label: 'Event' },
          ]}
        />
      }
    >
      <BarChart
        data={data}
        format={compactMoney}
        height={190}
        highlight={dimension === 'hour'
          ? i => busiestHour !== undefined && i === busiestHour.hour && busiestHour.orders > 0
          : undefined}
      />
      {data.length === 0 && dimension === 'event' && (
        <p className="text-[var(--app-text-muted)] text-[12px] mt-[10px] leading-[16px]">
          No sessions recorded yet. Start one from All Orders and everything sold during it
          becomes reportable as an event.
        </p>
      )}
    </Panel>
  );
}
