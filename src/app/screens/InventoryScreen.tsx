import { ScreenShell } from '../components/ScreenShell';
import { InventoryView } from '../inventory/InventoryView';
import type { MenuHandle, StockHandle } from '../state';

/**
 * Inventory.
 *
 * The recipe editor writes to `useMenu` while everything else writes to
 * `useStock`, which is the split described in `useMenu`'s own note: an
 * assignment is a fact about a menu item, not about the shelf.
 */
export interface InventoryScreenProps {
  menu: MenuHandle;
  stock: StockHandle;
  onPrintReorder: (lines: string[]) => void;
  onOtherBoard: () => void;
}

export function InventoryScreen({ menu, stock, onPrintReorder, onOtherBoard }: InventoryScreenProps) {
  return (

  <ScreenShell section="inventory" onOtherBoard={onOtherBoard}>
    <InventoryView
      stockItems={stock.state.stockItems}
      menuItems={menu.state.menuItems}
      assignments={menu.state.stockAssignments}
      movements={stock.state.stockMovements}
      onAdjustStock={stock.actions.adjustStock}
      onSaveStockItem={stock.actions.saveStockItem}
      onDeleteStockItem={stock.actions.deleteStockItem}
      onSetPacket={stock.actions.setPacket}
      onSaveAssignments={menu.actions.saveAssignments}
      onUndoMovement={stock.actions.undoMovement}
      onStockTake={stock.actions.stockTake}
      onPrintReorder={onPrintReorder}
      onDrainStock={stock.actions.drainStock}
    />
  </ScreenShell>
  );
}
