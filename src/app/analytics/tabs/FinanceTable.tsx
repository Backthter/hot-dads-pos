import { useMemo } from 'react';
import { DANGER, GOOD, Panel, money } from '../AnalyticsUI';
import { DataTable, type DataColumn } from '../DataTable';
import { formatTicket } from '../../lib/sessions';
import type { FinanceRow } from '../metrics';

/**
 * Finance, as a table — *did this pay, and when?*
 *
 * The KPI cards above it answer "how is the period doing" for one period. This
 * answers "which of these paid", which is a different question and the one a
 * shop asks after a market: Saturday against Sunday, this market against the
 * last, with the pitch fee sitting where it belongs rather than smeared across
 * both days.
 *
 * Every figure arrives as a prop. `financeRows` did the arithmetic upstairs in
 * `AnalyticsView`'s memo wall, because a tab that resolves its own scope
 * recomputes on every clock tick and undoes ADR-009 — which 1C-i calls the
 * single most important line in its handoff.
 */

const clock = (ms: number) =>
  new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const day = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

/**
 * What the crossing column says.
 *
 * Four different sentences, because "—" for all four would collapse *has not
 * happened yet*, *cannot happen*, *nothing to happen* and *no data to tell*
 * into one shrug — and the shop needs to act differently on each.
 */
export function crossingLabel(row: FinanceRow): string {
  const { crossing } = row;
  if (crossing.order) {
    const ticket = crossing.order.sessionTicket !== undefined
      ? formatTicket(crossing.order.sessionTicket)
      : crossing.order.number;
    return `#${ticket} · ${clock(crossing.order.at)}`;
  }
  if (crossing.blocked === undefined) return '—';
  // `notYet` is the live case and is the one worth a number: how much more has
  // to be taken is actionable, and an em dash is not.
  return crossing.remaining > 0 && crossing.contribution > 0
    ? `${money(crossing.remaining)} to go`
    : crossing.blocked;
}

/**
 * The caveat under the crossing, when there is one.
 *
 * A crossing computed over a partly costed period is never *earlier* than the
 * truth — an uncosted ticket contributes nothing rather than contributing its
 * whole revenue — so the honest thing to say is that it may have happened
 * sooner. Saying nothing would present a floor as an exact answer.
 */
export function crossingCaveat(row: FinanceRow): string | null {
  if (!row.crossing.order || row.crossing.coverage >= 1) return null;
  const missing = Math.round((1 - row.crossing.coverage) * 100);
  return `or earlier · ${missing}% uncosted`;
}

export function FinanceTable({
  rows, moneyHidden, onPickRow,
}: {
  rows: FinanceRow[];
  moneyHidden: boolean;
  onPickRow?: (row: FinanceRow) => void;
}) {
  const columns = useMemo((): DataColumn<FinanceRow>[] => [
    { id: 'sales', label: 'Sales', value: r => r.totals.gross, format: v => money(Number(v)), money: true },
    {
      id: 'discounts',
      label: 'Discounts',
      value: r => r.totals.discount,
      format: v => money(Number(v)),
      money: true,
    },
    { id: 'net', label: 'Net', value: r => r.totals.netRevenue, format: v => money(Number(v)), money: true },
    {
      id: 'cogs',
      label: 'COGS',
      // Null rather than zero when nothing in the row carries a cost: an
      // ingredient bill of zero and an unknown one are opposite claims, and the
      // table is the last place that distinction can be lost (invariant 2).
      value: r => (r.totals.costedRevenue > 0 || r.totals.cogs > 0 ? r.totals.cogs : null),
      format: v => money(Number(v)),
      money: true,
    },
    {
      id: 'gross',
      label: 'Gross profit',
      value: r => (r.totals.grossMarginPct === null ? null : r.totals.grossProfit),
      format: v => money(Number(v)),
      money: true,
    },
    {
      id: 'opcosts',
      label: 'Op. costs',
      value: r => r.operatingCosts,
      format: v => money(Number(v)),
      money: true,
      // The held figure belongs to the event, and saying so here is what stops
      // the session row reading as though the market were free (ADR-013).
      detail: r => (r.heldEventCosts > 0 ? `+ ${money(r.heldEventCosts)} held by the event` : null),
    },
    {
      id: 'netprofit',
      label: 'Net profit',
      value: r => r.netProfit,
      format: v => money(Number(v)),
      money: true,
      tone: r => (r.netProfit !== null && r.netProfit < 0 ? DANGER : undefined),
    },
    {
      id: 'margin',
      label: 'Margin',
      value: r => r.netMarginPct,
      format: v => `${Number(v).toFixed(1)}%`,
      money: true,
      tone: r => (r.netMarginPct !== null && r.netMarginPct < 0 ? DANGER : undefined),
    },
    {
      id: 'breakeven',
      label: 'Break-even',
      value: r => r.breakEven.revenue,
      format: v => money(Number(v)),
      money: true,
      detail: r => r.breakEven.blocked ?? null,
    },
    {
      id: 'crossing',
      label: 'Passed B/E at',
      // A ticket number and a clock time do not sort as a quantity, and sorting
      // by the moment a day paid for itself across unrelated days means nothing.
      value: r => crossingLabel(r),
      align: 'left',
      sortable: false,
      money: true,
      detail: crossingCaveat,
      tone: r => (r.crossing.order ? GOOD : undefined),
    },
  ], []);

  return (
    <Panel
      title="Did this pay?"
      subtitle="One row per session, and the market they belong to"
    >
      <DataTable
        rows={rows}
        columns={columns}
        keyOf={r => r.id}
        headerLabel="Period"
        header={r => (
          <span className="flex flex-col">
            <span>{r.name}</span>
            {r.startedAt !== null && (
              <span className="text-[10.5px] font-normal text-[var(--app-text-muted)]">
                {r.kind === 'event' ? 'Whole event' : day(r.startedAt)}
              </span>
            )}
          </span>
        )}
        defaultSort="net"
        moneyHidden={moneyHidden}
        onPickRow={onPickRow}
        isSummary={r => r.kind === 'event'}
        emptyLabel="Nothing traded in this period."
      />
    </Panel>
  );
}
