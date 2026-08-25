import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  BarChart, DANGER, GOOD, KpiCard, Panel, RankedRows, Screen, compactMoney, money,
} from '../AnalyticsUI';
import { IconButton, SegmentedControl, useReducedMotion, useSection } from '../../ui';
import { useStickyState } from '../../lib/screenState';
import { BREAK_EVEN_BLOCKED } from '../metrics';
import type {
  BreakEven, Bucket, CategoryPerformance, EventPerformance, FoodCost, Grain, ItemBreakEven,
  ItemPair, ItemPerformance, PopularityTrend, Totals, TradingHour, VoidStats,
} from '../metrics';

/**
 * Business — what's working?
 *
 * This is what the Sales tab held, unchanged and in the arrangement it had.
 * Phase 1C-i moves it; 1C-iv replaces it with the item and category tables.
 *
 * Everything arrives as a prop. In particular the item and category tables are
 * deliberately *not* recomputed here: they are the two most expensive things in
 * the section and neither depends on the clock, so they are resolved once in
 * `AnalyticsView` outside the tick (ADR-009).
 */
export interface BusinessTabProps {
  current: Totals;
  prior: Totals;
  comparisonLabel: string;
  revenuePerHour: number | null;
  tradingHours: number;
  sessionScoped: boolean;
  food: FoodCost;
  be: BreakEven;
  beByItem: ItemBreakEven[];
  voids: VoidStats;
  items: ItemPerformance[];
  categories: CategoryPerformance[];
  buckets: Bucket[];
  grainLabel: Grain;
  hours: TradingHour[];
  byEvent: EventPerformance[];
  busiestHour: TradingHour | undefined;
  pairs: ItemPair[];
  trend: PopularityTrend[];
  trendPoints: { id: string; label: string; sessionIds: string[] }[];
  /** The event a session scope belongs to, when it belongs to a real one. */
  eventName: string | null;
  /** Sessions in the containing event, for the event-of-one wording (ADR-023). */
  eventSessionCount: number;
  onOpenEvent?: () => void;
  /** Costs are logged from Finance now, so break-even points there. */
  onOpenCosts: () => void;
}

const pct = (n: number) => `${n.toFixed(1)}%`;

export function BusinessTab({
  current, prior, comparisonLabel, revenuePerHour, tradingHours, sessionScoped,
  food, be, beByItem, voids, items, categories, buckets, grainLabel, hours, byEvent,
  busiestHour, pairs, trend, trendPoints, eventName, eventSessionCount, onOpenEvent, onOpenCosts,
}: BusinessTabProps) {
  return (
    <Screen>
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
          definition={sessionScoped
            ? `What you took for each of the ${tradingHours.toFixed(1)} hours the session was actually open, with any pause taken off. Quiet hours still count — the pitch is paid for either way.`
            : `What you took for each of the ${tradingHours} hours in which anything sold at all. Pick a session above for a figure based on the hours you were actually open.`}
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
          definition={`How much you need to take before the day starts making money. ${be.contributionRatio !== null ? `${(be.contributionRatio * 100).toFixed(0)}p of every rupee is left after ingredients and the costs that scale with a sale — per ticket, per item and any share of takings. ` : ''}Log your pitch fee, staff and fuel from Finance to make this accurate.`}
        />
      </div>

      <BreakEvenByItem
        rows={beByItem}
        blocked={be.blocked}
        fixedCosts={be.fixedCosts}
        heldEventCosts={be.heldEventCosts}
        eventName={eventName}
        eventSessionCount={eventSessionCount}
        onOpenEvent={onOpenEvent}
        onOpenCosts={onOpenCosts}
      />

      <RevenueChart
        buckets={buckets}
        grainLabel={grainLabel}
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
  rows, blocked, fixedCosts, heldEventCosts, eventName, eventSessionCount,
  onOpenEvent, onOpenCosts,
}: {
  rows: ItemBreakEven[];
  blocked?: string;
  fixedCosts: number;
  /** Per-event rupees this figure deliberately leaves to the event (ADR-013). */
  heldEventCosts: number;
  eventName: string | null;
  /** How many sessions the containing event has. One is the case ADR-023 is about. */
  eventSessionCount: number;
  onOpenEvent?: () => void;
  onOpenCosts: () => void;
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
  /*
   * An event of one is the case where holding the cost back reads as though the
   * figure were hiding money from itself: both scopes cover the same trading,
   * so the session appears to break even while its pitch fee sits outside the
   * number (ADR-023).
   *
   * The arithmetic is right and is deliberately not special-cased. Allocating
   * when `sessions.length === 1` sounds like a narrow exception and is not: add
   * a second session to the market later and this session's break-even would
   * move retroactively, which is precisely what ADR-013 forbids. So the fix is
   * in what this says, not in what it computes.
   */
  const onlySession = eventSessionCount === 1;
  const eventNote = heldEventCosts > 0 ? (
    <p className="text-[var(--app-text-muted)] text-[12px] leading-[17px] pt-[10px]">
      {onlySession ? (
        <>
          <span className="font-semibold" style={{ color: 'var(--app-text-secondary)' }}>
            {eventName ?? 'The event'} · {money(heldEventCosts)} held
          </span>
          {' — '}this is the event&rsquo;s only session, so the whole of it applies to this
          trading. It is held back rather than folded in so the figure cannot move if another
          day joins the market later.
        </>
      ) : (
        <>
          {eventName ?? 'The event'} carries {money(heldEventCosts)} of its own on top of this,
          paid once for the whole event rather than by this session.
        </>
      )}
      {onOpenEvent && (
        <button
          type="button"
          onClick={onOpenEvent}
          className="ml-[6px] underline underline-offset-2 font-semibold"
          style={{ color: theme.color }}
          data-open-event-scope
          data-event-of-one={onlySession ? '' : undefined}
        >
          {onlySession ? 'See the event' : 'See the whole event'}
        </button>
      )}
    </p>
  ) : null;

  if (rows.length === 0) {
    return (
      <Panel title="Break-even" subtitle="How much you have to sell before the day pays for itself">
        <p className="text-[var(--app-text-muted)] text-[13px] leading-[18px] py-[8px]">
          {blocked === BREAK_EVEN_BLOCKED.noFixedCosts
            ? (
              <>
                Log what the day costs you — the pitch fee, staff, fuel — from{' '}
                <button
                  type="button"
                  onClick={onOpenCosts}
                  className="underline underline-offset-2 font-semibold"
                  style={{ color: theme.color }}
                  data-open-costs-from-break-even
                >
                  Finance
                </button>
                , and this will say how many of each thing you need to sell to cover it.
              </>
            )
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
