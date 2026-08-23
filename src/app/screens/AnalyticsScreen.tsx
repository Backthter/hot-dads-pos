import { ScreenShell } from '../components/ScreenShell';
import { AnalyticsView } from '../analytics/AnalyticsView';
import { RevenuePinPad } from '../analytics/RevenueLock';
import type { MenuHandle, SessionsHandle, SettingsHandle, StockHandle } from '../state';
import type { Order } from '../types';

/**
 * Analytics, plus the PIN pad that guards the money on it.
 *
 * Costs are the one thing the analytics screens mutate, and they do it through
 * `useSessions` — a cost belongs to a service, not to a report.
 */
export interface AnalyticsScreenProps {
  menu: MenuHandle;
  stock: StockHandle;
  sessions: SessionsHandle;
  settings: SettingsHandle;
  /** Every order ever taken. Scoping happens inside the view. */
  orders: Order[];
  onOtherBoard: () => void;
  onOpenInventory: () => void;
}

export function AnalyticsScreen({
  menu, stock, sessions, settings, orders, onOtherBoard, onOpenInventory,
}: AnalyticsScreenProps) {
  return (

  <ScreenShell section="analytics" onOtherBoard={onOtherBoard}>
    <AnalyticsView
      orders={orders}
      menuItems={menu.state.menuItems}
      stockItems={stock.state.stockItems}
      assignments={menu.state.stockAssignments}
      movements={stock.state.stockMovements}
      snapshots={stock.state.inventorySnapshots}
      oversells={stock.state.oversellEvents}
      sessions={sessions.state.tradingSessions}
      events={sessions.state.tradingEvents}
      costs={sessions.state.costEntries}
      onAddCost={sessions.actions.addCost}
      onDeleteCost={sessions.actions.deleteCost}
      taxEnabled={settings.state.taxEnabled}
      revenueLocked={settings.state.revenueLocked}
      onUnlockRevenue={() => settings.actions.setShowRevenuePin(true)}
      onOpenInventory={onOpenInventory}
    />
    <RevenuePinPad
      open={settings.state.showRevenuePin}
      expected={settings.state.currentRevenuePin}
      onSuccess={settings.actions.unlockRevenue}
      onClose={settings.actions.lockRevenue}
    />
  </ScreenShell>
  );
}
