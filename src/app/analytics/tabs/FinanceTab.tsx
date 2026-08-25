import { motion } from 'motion/react';
import { AlertTriangle, Clock, Coins, HelpCircle, ShoppingBag, Timer } from 'lucide-react';
import { ACCENT, DANGER, KpiCard, Panel, RankedRows, Screen, money } from '../AnalyticsUI';
import { Button } from '../../ui';
import { FinanceTable } from './FinanceTable';
import type {
  DataQualityIssue, DeadStockItem, FinanceRow, InventoryValue, QueueBand, SessionPerformance,
  StockoutStats, ThroughputStats, Totals, TurnoverStats,
} from '../metrics';

/**
 * Finance — did this pay?
 *
 * It absorbs what were the Overview and Costs tabs. 1C-i moved the figures
 * across unchanged, and 1C-iii-a put the table above them — the cards say how
 * one period is doing, the table says which of several paid, and those are
 * different questions.
 *
 * Nothing here computes anything: every figure arrives as a prop, resolved once
 * by `AnalyticsView` against a scope held steady by value (ADR-009). A tab that
 * resolved its own scope would recompute on every clock tick.
 *
 * Costs stopped being a destination in this phase. Logging a cost is something
 * you do *because* of what this screen says, so the way in is a button here
 * rather than a tab of its own.
 */
export interface FinanceTabProps {
  issues: DataQualityIssue[];
  current: Totals;
  prior: Totals;
  tp: ThroughputStats;
  bands: QueueBand[];
  stockouts: StockoutStats;
  stock: InventoryValue;
  turnover: TurnoverStats;
  shrink: { waste: number; variance: number };
  dead: DeadStockItem[];
  bySession: SessionPerformance[];
  /** One row per session, and the event that totals them (ADR-013). */
  financeRows: FinanceRow[];
  /** Opens the money ledger on the row's period. See `AnalyticsView`. */
  onPickFinanceRow?: (row: FinanceRow) => void;
  /**
   * Whether money columns are withheld.
   *
   * Finance declares `locked: 'all'`, so today this is always false when the
   * tab is reachable at all. It is passed rather than assumed because the table
   * is shared with Inventory, which is `money-columns` — a table that decided
   * for itself would be two rules for one lock (ADR-019).
   */
  moneyHidden: boolean;
  /** The scope's own two figures, taken as values rather than as the scope. */
  tradingHours: number;
  sessionScoped: boolean;
  onOpenInventory: () => void;
  onOpenCosts: () => void;
  onOpenExplainer: () => void;
}

const minutes = (ms: number | null) => (ms === null ? '—' : `${Math.round(ms / 60000)} min`);
const pct = (n: number) => `${n.toFixed(1)}%`;

export function FinanceTab({
  issues, current, prior, tp, bands, stockouts, stock, turnover, shrink, dead, bySession,
  financeRows, onPickFinanceRow, moneyHidden, tradingHours, sessionScoped,
  onOpenInventory, onOpenCosts, onOpenExplainer,
}: FinanceTabProps) {
  return (
    <Screen>
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
        The two ways out of this tab, together at the top.

        Costs was a tab and is now an action, because that is what it is: you
        arrive at it from a number that prompted it. The explainer sits beside
        it because the question it answers — "which of these is what stock cost
        me?" — is asked in exactly the same moment.
      */}
      <div className="flex items-center gap-[9px] flex-wrap">
        <Button
          variant="section"
          icon={<Coins size={16} />}
          onClick={onOpenCosts}
          data-open-costs
          hint="The costs the till cannot see — the pitch fee, staff, fuel, packaging."
        >
          Log a cost
        </Button>
        <Button
          variant="quiet"
          icon={<HelpCircle size={16} />}
          onClick={onOpenExplainer}
          data-open-costs-explainer
        >
          What each of these costs means
        </Button>
      </div>

      {/*
        The table first, because it answers the tab's own question.

        The cards below say how the *period* is doing, which is one number per
        thing. The table says which of several periods paid — Saturday against
        Sunday, the market against its days — and carries the column this phase
        was for: the ticket that covered the day's costs.
      */}
      <FinanceTable
        rows={financeRows}
        moneyHidden={moneyHidden}
        onPickRow={onPickFinanceRow}
      />

      {/*
        Finance answers "how did the day run" as well as "what did it make".
        The money used to be on a second tab, which meant the first screen
        anybody opened was a wall of accounting — and the operational numbers
        that actually change what you do during service were scattered between
        the two.
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
          onClick={onOpenInventory}
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
              A queue time is about experience, where the median is right: it
              describes what a typical customer waits and ignores the ticket
              that sat forgotten. Grill time is being read as capacity — how
              long a slot is tied up, and so how many tickets an hour the grill
              can clear. That is a question about the total, and only the mean
              multiplies back out to the total.
            */}
            <Stat icon={<Clock size={15} />} label="Average on grill" value={minutes(tp.averageOnGrillMs)} />
            <Stat icon={<ShoppingBag size={15} />} label="Peak orders/hour" value={String(tp.peakOrdersPerHour)} />
            <Stat
              icon={<Clock size={15} />}
              label="Trading hours"
              value={tradingHours.toFixed(sessionScoped ? 1 : 0)}
            />
            <Stat
              icon={<ShoppingBag size={15} />}
              label="Orders per hour"
              value={tradingHours > 0 ? (current.orders / tradingHours).toFixed(1) : '—'}
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
