import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Search, SlidersHorizontal } from 'lucide-react';
import { ACCENT, DANGER, GOOD, Panel, money } from './AnalyticsUI';
import { DataTable, type DataColumn } from './DataTable';
import { FilterBuilder, useFilterTree } from './FilterBuilder';
import { applyFilter, describeGroup, moneyFields } from './filters';
import { describeSearch, matchesSearch, parseSearch } from './search';
import { accumulate, type MoneyLedgerResult, type MoneyRow } from './metrics';
import { COST_BASIS_LABEL } from '../lib/sessions';
import { Button, Toggle } from '../ui';
import type { StockItem, TradingEvent, TradingSession } from '../types';

/**
 * History · Money — *where did the money go?*
 *
 * This is a **cash** view, and that is the whole reason it exists beside
 * Finance rather than inside it. Finance measures consumption: what the things
 * you sold cost to make. This measures outlay: what actually left the till, on
 * the day it left. A Rs 8,000 mince delivery and Rs 900 of mince eaten are not
 * competing answers to "what did stock cost me" — the costs explainer names
 * both, and is one tap away from here for exactly that reason.
 *
 * Every figure arrives as a prop. `moneyLedger` did the arithmetic in
 * `AnalyticsView`'s memo wall, because a tab that resolves its own scope
 * recomputes on every clock tick and undoes ADR-009.
 */

const when = (ms: number) => new Date(ms).toLocaleString(undefined, {
  day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
});

const KIND_LABEL: Record<MoneyRow['kind'], string> = {
  purchase: 'Stock bought',
  cost: 'Cost',
  sales: 'Sales',
};

/**
 * What a row is, in one phrase.
 *
 * A cost says what it is charged per, because "Cost · Share of sales" and
 * "Cost · Per session" behave completely differently over a period and the
 * reader has no other way to tell which they are looking at.
 */
export function kindLabel(row: MoneyRow): string {
  if (row.kind !== 'cost') return KIND_LABEL[row.kind];
  return row.basis ? `Cost · ${COST_BASIS_LABEL[row.basis]}` : 'Cost';
}

/**
 * The line under an amount that says where it came from.
 *
 * Only rates have one. A pitch fee is the number that was typed and explaining
 * it would be noise; a commission is 18% of something, and the something is the
 * part the shop cannot reconstruct from the rupee figure alone.
 */
export function chargeDetail(row: MoneyRow): string | null {
  const c = row.charge;
  if (!c) return null;
  if (row.basis === 'per-revenue') return `${c.rate}% of ${money(c.base)} taken`;
  if (row.basis === 'per-order') return `${money(c.rate)} × ${c.base} tickets`;
  // A targeted per-item cost reached only some of what sold (ADR-022), and
  // saying "× 47" when 118 units went out would look like a mistake.
  if (c.covered !== null && c.covered !== c.base) {
    return `${money(c.rate)} × ${c.covered} of ${c.base} items`;
  }
  return `${money(c.rate)} × ${c.base} items`;
}

/** Everything about a money row that free text is allowed to match. */
export function moneyHaystack(row: MoneyRow): string {
  return [row.label, kindLabel(row), row.wholeEvent ? 'whole event' : '']
    .join('   ')
    .toLowerCase();
}

export function MoneyLedger({
  ledger, sessions, events, stockItems, widened, onToggleWiden,
  onOpenExplainer, onPickRow,
}: {
  ledger: MoneyLedgerResult;
  sessions: TradingSession[];
  events: TradingEvent[];
  stockItems: StockItem[];
  /** True when the ledger is showing every row ever rather than the period. */
  widened: boolean;
  onToggleWiden: (next: boolean) => void;
  onOpenExplainer: () => void;
  onPickRow?: (row: MoneyRow) => void;
}) {
  const [text, setText] = useState('');
  const [showBuilder, setShowBuilder] = useState(false);
  // Money out is where the question usually starts — "what did I spend on" —
  // so that is what a new condition opens on.
  const { group, actions } = useFilterTree(
    () => ({ field: 'out', operator: 'gt', value: 0 }));

  const fields = useMemo(
    () => moneyFields(sessions, events, stockItems), [sessions, events, stockItems]);
  const query = useMemo(() => parseSearch(text), [text]);

  /*
   * The balance is run again over what survives the filter.
   *
   * `moneyLedger` already accumulated it over everything, and keeping that
   * would give a Running column the reader cannot check against the rows in
   * front of them: filter to *stock bought* and the balance would still include
   * every sale. `accumulate` is the one place the column is worked out, so the
   * filtered and unfiltered answers cannot disagree about what it means.
   */
  const shown = useMemo(() => {
    const searched = query.length === 0
      ? ledger.rows
      : ledger.rows.filter(r => matchesSearch(moneyHaystack(r), query));
    return accumulate(applyFilter(searched, group, fields));
  }, [ledger.rows, query, group, fields]);

  const columns = useMemo((): DataColumn<MoneyRow>[] => [
    {
      id: 'when',
      label: 'When',
      value: r => when(r.at),
      align: 'left',
      // A formatted date does not sort as a quantity, and the ledger is already
      // in the order it happened.
      sortable: false,
    },
    { id: 'kind', label: 'Kind', value: kindLabel, align: 'left' },
    {
      id: 'in',
      label: 'In',
      value: r => r.moneyIn,
      format: v => money(Number(v)),
      money: true,
      tone: r => (r.moneyIn !== null ? GOOD : undefined),
    },
    {
      id: 'out',
      label: 'Out',
      value: r => r.moneyOut,
      format: v => money(Number(v)),
      money: true,
      detail: chargeDetail,
    },
    {
      id: 'running',
      label: 'Running',
      value: r => r.running,
      format: v => money(Number(v)),
      money: true,
      // The balance is a property of position, not of the row, so ordering by
      // it against any other column would be meaningless.
      sortable: false,
      tone: r => (r.running < 0 ? DANGER : undefined),
    },
  ], []);

  const described = [
    describeSearch(query),
    group.children.length > 0 ? describeGroup(group, fields) : '',
  ].filter(Boolean).join(' · ');

  return (
    <div className="flex flex-col h-full min-h-0 gap-[12px]">
      <div className="flex items-center gap-[9px]">
        <div className="relative flex-1">
          <Search
            size={14}
            className="absolute left-[10px] top-1/2 -translate-y-1/2 text-[var(--app-text-muted)]"
          />
          <input
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="mince, pitch, commission…"
            data-money-search
            className="w-full h-[34px] pl-[30px] pr-[10px] rounded-[9px] bg-[var(--app-surface)] border border-[var(--app-border)] text-[var(--app-text)] text-[13px] focus:outline-none"
          />
        </div>
        <button
          onClick={() => setShowBuilder(v => !v)}
          data-money-builder-toggle
          className="flex items-center gap-[6px] px-[11px] h-[34px] rounded-[9px] border text-[12px] font-semibold"
          style={{
            borderColor: showBuilder ? ACCENT : 'var(--app-border)',
            color: showBuilder ? ACCENT : 'var(--app-text-secondary)',
            background: showBuilder ? `${ACCENT}12` : 'transparent',
          }}
        >
          <SlidersHorizontal size={13} /> Filter
          {group.children.length > 0 && (
            <span className="text-[11px] tabular-nums">{group.children.length}</span>
          )}
        </button>
      </div>

      <AnimatePresence initial={false}>
        {(showBuilder || group.children.length > 0) && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ type: 'spring', stiffness: 460, damping: 38 }}
            className="overflow-hidden"
          >
            <FilterBuilder group={group} fields={fields} actions={actions} />
          </motion.div>
        )}
      </AnimatePresence>

      <Panel
        title="Where the money went"
        subtitle={widened ? 'Everything on record' : 'The period you have selected'}
        className="flex-1 min-h-0 overflow-auto"
        actions={
          <span className="flex items-center gap-[8px]">
            <span className="text-[11px] text-[var(--app-text-muted)]">Show everything</span>
            <Toggle checked={widened} onChange={onToggleWiden} />
          </span>
        }
      >
        <div className="flex flex-col gap-[10px]">
          <p className="text-[var(--app-text-secondary)] text-[12.5px] leading-[19px] max-w-[680px]">
            This is what <strong>left the till</strong>, not what the things you sold cost
            to make. Finance answers the second question; the two do not agree, and
            both are right.{' '}
            <Button variant="quiet" size="sm" onClick={onOpenExplainer} data-open-costs-explainer>
              What each of these means
            </Button>
          </p>

          {/*
            * Said once, at the top, rather than on every row: a cost logged as a
            * rate — per ticket, per item, a share of sales — has no single
            * amount until a period is named, so its figure moves when the
            * period does. A pitch fee never moves. Both are on this table and
            * nothing else on screen would tell them apart.
            */}
          <p className="text-[var(--app-text-muted)] text-[11.5px] leading-[17px] max-w-[680px]">
            Costs you logged as a rate are shown as what they came to over this period.
            A one-off fee is shown exactly as you typed it.
            {ledger.unpriced > 0 && (
              <>
                {' '}
                <span style={{ color: DANGER }}>
                  {ledger.unpriced} {ledger.unpriced === 1 ? 'line carries' : 'lines carry'} no
                  amount, so the running total is a floor rather than a figure.
                </span>
              </>
            )}
          </p>

          {described && (
            <p className="text-[var(--app-text-muted)] text-[11.5px]">
              {shown.rows.length} of {ledger.rows.length} lines · {described}
            </p>
          )}

          <DataTable
            rows={shown.rows}
            columns={columns}
            keyOf={r => r.id}
            headerLabel="What"
            header={r => (
              <span className="flex flex-col">
                <span>{r.label}</span>
                {r.wholeEvent && (
                  <span className="text-[10.5px] font-normal text-[var(--app-text-muted)]">
                    Paid for the whole event
                  </span>
                )}
                {r.kind === 'sales' && r.cash !== undefined && (
                  <span className="text-[10.5px] font-normal text-[var(--app-text-muted)]">
                    {money(r.cash)} cash · {money(r.transfer ?? 0)} transfer
                  </span>
                )}
              </span>
            )}
            onPickRow={onPickRow}
            emptyLabel="No money moved in this period."
          />

          {shown.rows.length > 0 && (
            <div className="flex flex-wrap gap-x-[18px] gap-y-[4px] pt-[8px] border-t border-[var(--app-border)] text-[12px]">
              <Figure label="In" value={money(shown.moneyIn)} tone={GOOD} />
              <Figure label="Out" value={money(shown.moneyOut)} tone={DANGER} />
              <Figure
                label="Net"
                value={money(shown.moneyIn - shown.moneyOut)}
                tone={shown.moneyIn >= shown.moneyOut ? GOOD : DANGER}
              />
              <Figure label="Cash" value={money(shown.cash)} />
              <Figure label="Transfer" value={money(shown.transfer)} />
            </div>
          )}
        </div>
      </Panel>
    </div>
  );
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <span className="flex items-baseline gap-[6px]">
      <span className="text-[var(--app-text-muted)] text-[11px] uppercase tracking-[0.5px]">
        {label}
      </span>
      <span className="tabular-nums font-semibold" style={{ color: tone ?? 'var(--app-text)' }}>
        {value}
      </span>
    </span>
  );
}
