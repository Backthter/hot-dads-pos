import { Boxes, EyeOff } from 'lucide-react';
import { Panel, Screen } from '../AnalyticsUI';
import { Button } from '../../ui';

/**
 * Inventory — what do I have, and what is it doing?
 *
 * Empty this session, deliberately. Phase 1C-i decides the shape the next two
 * build inside; 1C-iii fills this tab with the stock table and the levels,
 * cover and movement figures that go with it. Nothing was moved here from
 * Overview: every figure that was on Overview is still on Finance, in the
 * arrangement it had, because this phase is navigation rather than content.
 *
 * What it does carry already is the lock. Inventory is the tab the partial case
 * exists for — a cashier checking whether the mince is running low should not
 * need the revenue PIN to read a quantity — so it receives `moneyHidden` from
 * the one place the capability is resolved and is drawn either way. 1C-iii
 * decides which *columns* that hides; the rule itself is settled here.
 */
export function InventoryTab({
  moneyHidden, onOpenInventory,
}: {
  /** True when the revenue PIN is set. Quantities stay; money does not. */
  moneyHidden: boolean;
  onOpenInventory: () => void;
}) {
  return (
    <Screen>
      <Panel
        title="Inventory"
        subtitle="Levels, cover and what is moving — arriving in Phase 1C-iii"
      >
        <div className="flex flex-col gap-[12px] py-[10px]" data-inventory-placeholder>
          <p className="text-[var(--app-text-secondary)] text-[14px] leading-[21px] max-w-[620px]">
            This is where what you are holding will be answered in one table: how much of
            each thing is on the shelf, how many days that covers at the rate you have been
            selling, what it is worth and what you last paid for it.
          </p>
          <p className="text-[var(--app-text-muted)] text-[13px] leading-[19px] max-w-[620px]">
            Until then the stock figures are on Finance — inventory value, turnover, waste
            and the dead stock list — and the shelf itself is in the Inventory section.
          </p>

          {moneyHidden && (
            <div
              className="flex items-start gap-[9px] rounded-[11px] border border-[var(--app-border)] bg-[var(--app-bg-darker)] px-[13px] py-[11px] max-w-[620px]"
              data-money-columns-hidden
            >
              <EyeOff size={15} className="shrink-0 mt-[2px] text-[var(--app-text-muted)]" />
              <span className="text-[var(--app-text-muted)] text-[12.5px] leading-[18px]">
                Revenue is locked, so what stock is worth and what it cost stay hidden here.
                Quantities and days of cover do not — this tab shows what is on the shelf
                without the PIN.
              </span>
            </div>
          )}

          <span>
            <Button
              variant="section"
              icon={<Boxes size={16} />}
              onClick={onOpenInventory}
              data-open-inventory
            >
              Open the shelf
            </Button>
          </span>
        </div>
      </Panel>
    </Screen>
  );
}
