import { useCallback, useMemo, useRef } from 'react';
import { AnimatePresence } from 'motion/react';
import { Boxes, Coins, History as HistoryIcon, ShoppingBag } from 'lucide-react';
import { Screen } from './AnalyticsUI';
import { NavActions, NavSlot, NavTab, NavTabs } from '../components/Navigation';
import { useStickyState } from '../lib/screenState';
import { Toggle, Tooltip, useNow } from '../ui';
import { useTabStep } from '../lib/navigation';
import { LockedRevenue } from './RevenueLock';
import { CostsPanel } from './CostsPanel';
import { CostsExplainer } from './CostsExplainer';
import { ScopePicker } from './ScopePicker';
import { ExportMenu } from './ExportMenu';
import { FinanceTab } from './tabs/FinanceTab';
import { InventoryTab } from './tabs/InventoryTab';
import { BusinessTab } from './tabs/BusinessTab';
import { HistoryTab } from './tabs/HistoryTab';
import {
  DEFAULT_HISTORY_SOURCE, DEFAULT_TAB, TABS, TAB_LABEL, lockFor, migrateTabId, resolveLock,
  type HistorySource, type TabId,
} from './tabs/model';
import { DEFAULT_SCOPE, resolveScope, trendBuckets, type Scope } from './scope';
import {
  attachmentPairs, breakEven, breakEvenByItem, bucketsFor, categoryPerformance, costSummary,
  dataQuality, itemMargins, stockPurchasesValue,
  deadStock, eventPerformance, foodCost, grainFor, inventoryTurnover, inventoryValue,
  itemPerformance, popularityTrend, queueBands, salesMix, sessionPerformance, shrinkageValue,
  stockoutStats, throughput, totalsFor, tradingHours, voidStats,
} from './metrics';
import { eventGroups } from '../lib/sessions';
import type { CostScope, DateRange } from './metrics';
import type {
  Category, CostBasis, CostEntry, InventorySnapshot, MenuItem, MenuItemStockAssignment, Order,
  OversellEvent, StockItem, StockMovement, TradingEvent, TradingSession,
} from '../types';

/**
 * A page inside Analytics that is not a tab.
 *
 * Costs stopped being a destination in Phase 1C-i. Logging a cost is something
 * you do *because* of a figure that prompted it, so `CostsPanel` is reached
 * from Finance rather than from the tab bar, and the costs explainer — the four
 * money-shaped things and the rule that separates them — is reached from
 * Finance and from History · Money.
 *
 * Both are pushed as navigation steps, so the app's Back leaves the page and
 * returns to the tab it was opened from rather than leaving the section.
 */
type SubPage = 'costs' | 'explainer';

const SUB_LABEL: Record<SubPage, string> = {
  costs: 'Costs',
  explainer: 'What costs mean',
};

const TAB_ICON: Record<TabId, typeof Coins> = {
  finance: Coins,
  inventory: Boxes,
  business: ShoppingBag,
  history: HistoryIcon,
};

export interface AnalyticsViewProps {
  orders: Order[];
  menuItems: MenuItem[];
  /**
   * The menu's categories, for resolving a targeted `per-unit` cost.
   *
   * A cost stores a category by id and `MenuItem.category` holds a name, so the
   * two are joined through this list — see `salesMix` (ADR-022).
   */
  menuCategories: Category[];
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

/**
 * The analytics screen: the scope, the tab bar, the lock, and the memo wall.
 *
 * The four tabs are rendering only, in `./tabs/`. **The memo layer stays here**
 * and that is load-bearing rather than tidy: the scope is resolved once, its
 * outputs are held steady by value, and every figure is derived from those
 * stabilised values before a tab sees it. A tab component that resolved its own
 * scope would rebuild the item and category tables on every clock tick and undo
 * ADR-009's work — so a tab takes computed figures as props and computes
 * nothing for itself.
 */
export function AnalyticsView(props: AnalyticsViewProps) {
  const {
    orders, menuItems, menuCategories, stockItems, assignments, movements, snapshots, oversells,
    sessions, events, costs, revenueLocked, onUnlockRevenue,
  } = props;

  // Sticky, so leaving for Inventory and coming back returns you to the tab
  // and period you had set up rather than resetting to Finance / last 30 days.
  //
  // Read through `migrateTabId`, because the tab set changed in 1C-i and a
  // remembered `sales` should land on Business rather than falling back to the
  // default — falling back would quietly throw away where somebody was, which
  // is the one thing sticky state exists to prevent.
  const [storedTab, setStoredTab] = useStickyState<string>('analytics.tab', DEFAULT_TAB);
  const tab = migrateTabId(storedTab);
  const [historySource, setHistorySource] = useStickyState<HistorySource>(
    'analytics.history.source', DEFAULT_HISTORY_SOURCE);
  const [sub, setSubRaw] = useStickyState<SubPage | null>('analytics.page', null);
  const [scope, setScope] = useStickyState<Scope>('analytics.scope', DEFAULT_SCOPE);

  // Changing tab is a navigation step, so back walks History → Business →
  // Finance rather than leaving the section outright.
  const tabLabel = useCallback((t: TabId) => TAB_LABEL[t], []);
  const setTabStep = useTabStep(tab, setStoredTab as (next: TabId) => void, tabLabel);
  const setTab = useCallback((next: TabId) => {
    // A page belongs to the tab it was opened from. Carrying it across would
    // leave Costs on screen with Business's tab lit.
    setSubRaw(null);
    setTabStep(next);
  }, [setSubRaw, setTabStep]);

  const subLabel = useCallback(
    (page: SubPage | null) => (page === null ? TAB_LABEL[tab] : SUB_LABEL[page]), [tab]);
  const setSub = useTabStep(sub, setSubRaw, subLabel);

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
  /**
   * What sold, per item, with each item's current category.
   *
   * Built once and handed to both `breakEven` and `itemMargins` so the headline
   * rate and the per-item ones are spread from the same mix. Two sites deriving
   * it separately is how the blended figure and the per-item column would come
   * to disagree about the same box (ADR-022).
   */
  const mix = useMemo(
    () => salesMix(items, menuItems, menuCategories), [items, menuItems, menuCategories]);
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
    () => breakEven(current, scopedCosts, costScope, mix), [current, scopedCosts, costScope, mix]);
  /**
   * Margin today and realised margin, per item.
   *
   * Deliberately outside the clock — neither figure depends on the time, and
   * this walks the recipe for every item in scope (ADR-009). It does depend on
   * the menu, the recipes and the stock costs, because "margin today" is the
   * figure that has to respond the moment any of the three is edited.
   */
  const margins = useMemo(
    () => itemMargins(items, menuItems, assignments, stockItems, scopedCosts, current, costScope, mix),
    [items, menuItems, assignments, stockItems, scopedCosts, current, costScope, mix]);
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

  /*
   * The lock, resolved once (ADR-019).
   *
   * Each tab declares how much of it the revenue PIN hides, History delegates
   * to its source, and this is the only place in the section that turns a
   * declaration into a rendering decision. Nothing below reads `revenueLocked`
   * to decide whether to draw itself.
   */
  const lock = resolveLock(lockFor(tab, historySource), revenueLocked);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* The screen's own tabs live in the permanent bar rather than under it,
          so no screen costs a second row of chrome. */}
      <NavSlot>
        <NavTabs>
          {TABS.map(t => {
            const Icon = TAB_ICON[t.id];
            return (
              <NavTab
                key={t.id}
                active={tab === t.id}
                onClick={() => setTab(t.id)}
                icon={<Icon size={19} />}
                label={t.label}
                hint={t.hint}
                groupId="analytics"
                data-ana-tab={t.id}
              />
            );
          })}
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
        {lock.hidden ? (
          <LockedRevenue onUnlock={onUnlockRevenue} />
        ) : sub !== null ? (
          <Screen key={sub}>
            {sub === 'costs' ? (
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
                perEvent={resolved.perEvent}
              />
            ) : (
              <CostsExplainer onBack={() => setSub(null)} />
            )}
          </Screen>
        ) : (
          <AnimatePresence mode="wait" initial={false}>
            {tab === 'finance' && (
              <FinanceTab
                key="finance"
                issues={issues}
                current={current}
                prior={prior}
                tp={tp}
                bands={bands}
                stockouts={stockouts}
                stock={stock}
                turnover={turnover}
                shrink={shrink}
                dead={dead}
                bySession={bySession}
                tradingHours={resolved.tradingHours}
                sessionScoped={resolved.sessionScoped}
                onOpenInventory={props.onOpenInventory}
                onOpenCosts={() => setSub('costs')}
                onOpenExplainer={() => setSub('explainer')}
              />
            )}

            {tab === 'inventory' && (
              <InventoryTab
                key="inventory"
                moneyHidden={lock.moneyHidden}
                onOpenInventory={props.onOpenInventory}
              />
            )}

            {tab === 'business' && (
              <BusinessTab
                key="business"
                current={current}
                prior={prior}
                comparisonLabel={comparisonLabel}
                revenuePerHour={revenuePerHour}
                tradingHours={resolved.tradingHours}
                sessionScoped={resolved.sessionScoped}
                food={food}
                be={be}
                beByItem={beByItem}
                voids={voids}
                items={items}
                categories={categories}
                buckets={buckets}
                grainLabel={grainFor(range)}
                hours={hours}
                byEvent={byEvent}
                busiestHour={busiestHour}
                pairs={pairs}
                trend={trend}
                trendPoints={trendPoints}
                eventName={containingEvent?.name ?? null}
                onOpenEvent={containingEvent
                  ? () => setScope({ kind: 'event', id: containingEvent.id })
                  : undefined}
                onOpenCosts={() => { setTab('finance'); setSubRaw('costs'); }}
              />
            )}

            {tab === 'history' && (
              <HistoryTab
                key="history"
                source={historySource}
                onChangeSource={setHistorySource}
                orders={orders}
                menuItems={menuItems}
                sessions={sessions}
                events={events}
                revenueLocked={revenueLocked}
                onOpenExplainer={() => setSub('explainer')}
              />
            )}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}
