import { motion } from 'motion/react';
import { Panel } from '../AnalyticsUI';
import { Button, SegmentedControl } from '../../ui';
import { OrdersExplorer } from '../OrdersExplorer';
import { HISTORY_SOURCES, type HistorySource } from './model';
import type { MenuItem, Order, TradingEvent, TradingSession } from '../../types';

/**
 * History — what happened?
 *
 * One tab over three record sets, chosen by a selector rather than by three
 * tabs. They answer the same question about different rows, and the shop is
 * more likely to want "what happened on Saturday" than "the orders screen".
 *
 * Only Orders has content in Phase 1C-i — `OrdersExplorer`, moved and otherwise
 * unchanged. Stock and Money are shown as empty states naming the phase that
 * fills them rather than hidden until they work: a selector that grows options
 * later is a selector nobody knows to look for, and being told a thing is
 * coming is more use than being shown a control with one option on it.
 *
 * The lock is per source, not per tab. Orders and Stock are open with the
 * revenue PIN set — Stock because it is quantities, Orders because it always
 * was — and Money is closed entirely. `AnalyticsView` resolves that before this
 * renders; nothing here reads `revenueLocked` to decide, only to pass it on to
 * `OrdersExplorer`, which hides the money *inside* its own rows.
 */
export function HistoryTab({
  source, onChangeSource, orders, menuItems, sessions, events, revenueLocked, onOpenExplainer,
}: {
  source: HistorySource;
  onChangeSource: (next: HistorySource) => void;
  orders: Order[];
  menuItems: MenuItem[];
  sessions: TradingSession[];
  events: TradingEvent[];
  revenueLocked: boolean;
  /** Money is where "which of these is what stock cost me" gets asked. */
  onOpenExplainer: () => void;
}) {
  return (
    <motion.div
      key="history"
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
      transition={{ type: 'spring', stiffness: 420, damping: 34 }}
      className="flex flex-col gap-[14px] h-full min-h-0"
    >
      <span className="shrink-0" data-history-source={source}>
        <SegmentedControl
          size="sm"
          value={source}
          onChange={onChangeSource}
          options={HISTORY_SOURCES.map(s => ({
            value: s.id,
            label: s.label,
            hint: s.arriving
              ? `${s.label} history arrives in Phase ${s.arriving}.`
              : undefined,
          }))}
        />
      </span>

      {source === 'orders' && (
        <div className="flex-1 min-h-0">
          <OrdersExplorer
            orders={orders}
            menuItems={menuItems}
            sessions={sessions}
            events={events}
            revenueLocked={revenueLocked}
          />
        </div>
      )}

      {source === 'stock' && (
        <Panel title="Stock history" subtitle="Every delivery, sale, waste line and count — arriving in Phase 1C-iii">
          <div className="flex flex-col gap-[10px] py-[10px]" data-history-empty="stock">
            <p className="text-[var(--app-text-secondary)] text-[14px] leading-[21px] max-w-[620px]">
              The stock ledger already records every movement — what arrived, what a sale
              took off the shelf, what was thrown away and what a count found. This is
              where it becomes searchable the way orders are.
            </p>
            <p className="text-[var(--app-text-muted)] text-[13px] leading-[19px] max-w-[620px]">
              Until then you can see a single item&rsquo;s movements from the Inventory
              section.
            </p>
          </div>
        </Panel>
      )}

      {source === 'money' && (
        <Panel title="Money" subtitle="The costs you have logged, and what stock has cost you — arriving in Phase 1C-ii">
          <div className="flex flex-col gap-[10px] py-[10px]" data-history-empty="money">
            <p className="text-[var(--app-text-secondary)] text-[14px] leading-[21px] max-w-[620px]">
              This is where the money that is not a sale gets listed: what you logged
              yourself — the pitch fee, staff, fuel — beside what left the till for stock.
              One ledger, in the order it happened.
            </p>
            <p className="text-[var(--app-text-muted)] text-[13px] leading-[19px] max-w-[620px]">
              Until then, the costs you have logged are listed under Log a cost on Finance.
            </p>
            <span>
              <Button variant="quiet" size="sm" onClick={onOpenExplainer} data-open-costs-explainer>
                What each of these costs means
              </Button>
            </span>
          </div>
        </Panel>
      )}
    </motion.div>
  );
}
