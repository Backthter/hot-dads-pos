import { useMemo, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { alpha, useSection } from '../ui';

/**
 * The table the three analytics tables are made of.
 *
 * Phase 1C-iii-a builds it for Finance; 1C-iv builds Inventory and Business on
 * the same component. It is written against that from the start, because a
 * table shaped around one screen and then generalised twice is how three tables
 * end up with three ideas of what a money column is.
 *
 * Three rules, all of them from `PHASE-1.md`'s C5 and ADR-019:
 *
 * 1. **Columns are data, and declare what they are.** A money column says so,
 *    and the table blanks it under the revenue lock. That is the same
 *    "declare it, do not check it" rule 1C-i set for tab locks: a screen that
 *    remembers to hide its own money is a screen that will one day forget.
 * 2. **An unknown is `—`, never `0`.** `null` is the signal, and it is the whole
 *    of invariant 2 at the last layer it can be broken at. The engine keeps
 *    "no cost on file" and "cost of nothing" apart all the way here; a table
 *    that renders `null` as `0` throws that away in the final inch.
 * 3. **No sparklines, no donuts, no chart in a cell.** A table with a good
 *    default sort beats a dashboard for somebody who already knows their
 *    business.
 */

export interface DataColumn<Row> {
  id: string;
  label: string;
  /**
   * The cell's value. `null` means *not known*, and renders as `—`.
   *
   * Return a number wherever the column is sortable — `format` is what makes it
   * readable, and sorting formatted strings puts "Rs 1,000" before "Rs 900".
   */
  value: (row: Row) => number | string | null;
  format?: (value: number | string) => string;
  /** Numbers right, words left. Defaults from the first non-null value's type. */
  align?: 'left' | 'right';
  /**
   * True when this column shows money.
   *
   * The table blanks it when `moneyHidden` is set, so no caller has to remember
   * (ADR-019). Quantities, counts and durations are not money — the whole point
   * of `money-columns` is that a locked till still answers "how many".
   */
  money?: boolean;
  /** A second line under the value, for a caveat the number needs. */
  detail?: (row: Row) => string | null;
  /** Held out of the sort cycle where ordering by it would mean nothing. */
  sortable?: boolean;
  /** Column-specific tone, e.g. a loss in red. */
  tone?: (row: Row) => string | undefined;
}

export interface DataTableProps<Row> {
  rows: Row[];
  columns: DataColumn<Row>[];
  /** Stable identity per row. */
  keyOf: (row: Row) => string;
  /** The first column, which names the row and does not scroll away. */
  header: (row: Row) => ReactNode;
  headerLabel: string;
  /** Column id to sort by initially. Omit to keep the order given. */
  defaultSort?: string;
  /** Hides every column marked `money`. Resolved by `AnalyticsView` (ADR-019). */
  moneyHidden?: boolean;
  onPickRow?: (row: Row) => void;
  /** Rows that total the ones above them, drawn apart. */
  isSummary?: (row: Row) => boolean;
  emptyLabel?: string;
}

/** What a column shows once the lock has had its say. Pure, and checked. */
export function visibleColumns<Row>(
  columns: DataColumn<Row>[],
  moneyHidden: boolean,
): DataColumn<Row>[] {
  return moneyHidden ? columns.filter(c => !c.money) : columns;
}

/**
 * `—` for an unknown, the column's own formatting for everything else.
 *
 * Separated out and exported so the rule can be checked without rendering. It
 * is one line and it is the line invariant 2 dies on.
 */
export function renderCell(value: number | string | null, format?: (v: number | string) => string): string {
  if (value === null) return '—';
  return format ? format(value) : String(value);
}

export function DataTable<Row>({
  rows, columns, keyOf, header, headerLabel, defaultSort,
  moneyHidden = false, onPickRow, isSummary, emptyLabel = 'Nothing to show for this period.',
}: DataTableProps<Row>) {
  const theme = useSection();
  const [sort, setSort] = useState<{ id: string; descending: boolean } | null>(
    defaultSort ? { id: defaultSort, descending: true } : null);

  const shown = useMemo(() => visibleColumns(columns, moneyHidden), [columns, moneyHidden]);

  /*
   * Summary rows never sort. They are a total of the rows above them, and a
   * total that has drifted into the middle of what it totals is worse than an
   * unsorted table — so they are held out and appended.
   */
  const ordered = useMemo(() => {
    const body = isSummary ? rows.filter(r => !isSummary(r)) : rows;
    const summaries = isSummary ? rows.filter(r => isSummary(r)) : [];
    const column = sort ? shown.find(c => c.id === sort.id) : undefined;
    if (!column) return [...body, ...summaries];

    const sorted = [...body].sort((a, b) => {
      const left = column.value(a);
      const right = column.value(b);
      // An unknown sorts last whichever way the column is pointing. It is not a
      // small value; it is the absence of one, and letting it float to the top
      // of an ascending sort would put the rows you know least about first.
      if (left === null && right === null) return 0;
      if (left === null) return 1;
      if (right === null) return -1;
      const gap = typeof left === 'number' && typeof right === 'number'
        ? left - right
        : String(left).localeCompare(String(right));
      return sort!.descending ? -gap : gap;
    });
    return [...sorted, ...summaries];
  }, [rows, shown, sort, isSummary]);

  if (rows.length === 0) {
    return <p className="text-[var(--app-text-muted)] text-[13px] py-[14px]">{emptyLabel}</p>;
  }

  const toggle = (column: DataColumn<Row>) => {
    if (column.sortable === false) return;
    setSort(prev => (prev?.id === column.id
      ? { id: column.id, descending: !prev.descending }
      : { id: column.id, descending: true }));
  };

  return (
    /* The table scrolls inside its own box. A page that scrolls sideways
       because of one wide table takes every other panel with it. */
    <div className="overflow-x-auto -mx-[4px] px-[4px]" data-table>
      <table className="w-full border-collapse" style={{ minWidth: 640 }}>
        <thead>
          <tr>
            <th
              className="sticky left-0 z-10 text-left px-[10px] py-[7px] text-[11px] uppercase tracking-[0.6px] font-bold whitespace-nowrap"
              style={{ background: 'var(--app-bg-darker)', color: 'var(--app-text-muted)' }}
            >
              {headerLabel}
            </th>
            {shown.map(column => {
              const active = sort?.id === column.id;
              return (
                <th
                  key={column.id}
                  onClick={() => toggle(column)}
                  data-table-column={column.id}
                  className="px-[10px] py-[7px] text-[11px] uppercase tracking-[0.6px] font-bold whitespace-nowrap select-none"
                  style={{
                    textAlign: column.align ?? 'right',
                    color: active ? theme.color : 'var(--app-text-muted)',
                    cursor: column.sortable === false ? 'default' : 'pointer',
                  }}
                >
                  <span className="inline-flex items-center gap-[4px]">
                    {column.label}
                    {active && (
                      <ChevronDown
                        size={12}
                        style={{ transform: sort!.descending ? 'none' : 'rotate(180deg)' }}
                      />
                    )}
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {ordered.map(row => {
            const summary = isSummary?.(row) ?? false;
            return (
              <tr
                key={keyOf(row)}
                data-table-row={keyOf(row)}
                data-table-summary={summary ? '' : undefined}
                onClick={onPickRow ? () => onPickRow(row) : undefined}
                className="group"
                style={{
                  cursor: onPickRow ? 'pointer' : 'default',
                  borderTop: `1px solid ${summary ? theme.line : 'var(--app-border)'}`,
                  background: summary ? alpha(theme.color, 0.06) : undefined,
                }}
              >
                <td
                  className="sticky left-0 z-10 px-[10px] py-[8px] text-[13px] font-semibold whitespace-nowrap"
                  style={{
                    background: summary ? 'var(--app-bg)' : 'var(--app-bg-darker)',
                    color: 'var(--app-text)',
                  }}
                >
                  {header(row)}
                </td>
                {shown.map(column => {
                  const detail = column.detail?.(row) ?? null;
                  return (
                    <td
                      key={column.id}
                      data-table-cell={column.id}
                      className="px-[10px] py-[8px] text-[13px] tabular-nums whitespace-nowrap"
                      style={{
                        textAlign: column.align ?? 'right',
                        color: column.tone?.(row) ?? 'var(--app-text-secondary)',
                        fontWeight: summary ? 600 : 400,
                      }}
                    >
                      <span className="flex flex-col" style={{ alignItems: (column.align ?? 'right') === 'right' ? 'flex-end' : 'flex-start' }}>
                        <span>{renderCell(column.value(row), column.format)}</span>
                        {detail && (
                          <span className="text-[10.5px] text-[var(--app-text-muted)] leading-[14px]">
                            {detail}
                          </span>
                        )}
                      </span>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
