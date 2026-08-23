import { ScreenShell } from '../components/ScreenShell';
import { SettingsView } from '../settings/SettingsView';
import type { MenuHandle, SettingsHandle, StockHandle } from '../state';
import type { WipeScope } from '../components/WipeDataPanel';

/**
 * Settings.
 *
 * Nothing but wiring: the menu editor reads and writes `useMenu`, everything
 * else reads and writes `useSettings`. Each setting goes through
 * `recordSetting`, which is what puts it on the undo stack alongside a ticket
 * move rather than making it a one-way door.
 */
export interface SettingsScreenProps {
  menu: MenuHandle;
  settings: SettingsHandle;
  /**
   * Read only, and only for the cost read-out on each menu row: what one of a
   * thing costs to make comes from the recipe and the shelf, and neither is
   * edited from here (ADR-015).
   */
  stock: StockHandle;
  /** Opens Assign Stock on one menu item, from that read-out. */
  onAssignStock: (menuItemId: string) => void;
  /** How many tickets are on the grill right now, so the capacity field can
   *  refuse to be set below it. */
  grillOnBoard: number;
  onWipe: (scope: WipeScope) => Promise<void>;
  onOtherBoard: () => void;
}

export function SettingsScreen({
  menu, settings, stock, grillOnBoard, onWipe, onOtherBoard, onAssignStock,
}: SettingsScreenProps) {
  return (

  <ScreenShell section="settings" onOtherBoard={onOtherBoard}>
    <SettingsView
      categories={menu.state.categories}
      menuItems={menu.state.menuItems}
      onAddCategory={menu.actions.addCategory}
      onUpdateCategory={menu.actions.updateCategory}
      onDeleteCategory={menu.actions.deleteCategory}
      onReorderCategories={menu.actions.reorderCategory}
      onAddMenuItem={menu.actions.addMenuItem}
      onUpdateMenuItem={menu.actions.updateMenuItem}
      onDeleteMenuItem={menu.actions.deleteMenuItem}
      stockAssignments={menu.state.stockAssignments}
      stockItems={stock.state.stockItems}
      onAssignStock={onAssignStock}
      grillCapacity={settings.state.grillCapacityInput}
      onGrillCapacity={value => settings.actions.recordSetting('Changed the grill capacity', settings.state.grillCapacityInput, value, settings.actions.setGrillCapacityInput)}
      grillOnBoard={grillOnBoard}
      tapToExpandParked={settings.state.tapToExpandParked}
      onTapToExpandParked={value => settings.actions.recordSetting('Changed how parked orders open', settings.state.tapToExpandParked, value, settings.actions.setTapToExpandParked)}
      taxEnabled={settings.state.taxEnabled}
      onTaxEnabled={value => settings.actions.recordSetting(value ? 'Switched sales tax on' : 'Switched sales tax off', settings.state.taxEnabled, value, settings.actions.setTaxEnabled)}
      taxRate={settings.state.taxRateInput}
      onTaxRate={value => settings.actions.recordSetting('Changed the tax rate', settings.state.taxRateInput, value, settings.actions.setTaxRateInput)}
      discountRequiresPin={settings.state.discountRequiresPin}
      onDiscountRequiresPin={value => settings.actions.recordSetting('Changed whether discounts need a PIN', settings.state.discountRequiresPin, value, settings.actions.setDiscountRequiresPin)}
      lightMode={settings.state.lightMode}
      onLightMode={value => settings.actions.recordSetting(value ? 'Switched to light mode' : 'Switched to dark mode', settings.state.lightMode, value, settings.actions.setLightMode)}
      uiScale={settings.state.uiScale}
      onUiScale={value => settings.actions.recordSetting('Changed the display scale', settings.state.uiScale, value, settings.actions.setUiScale)}
      fullscreen={settings.state.fullscreen}
      onFullscreen={settings.actions.applyFullscreen}
      autoPrint={settings.state.autoPrint}
      onAutoPrint={value => settings.actions.recordSetting(value ? 'Switched automatic printing on' : 'Switched automatic printing off', settings.state.autoPrint, value, settings.actions.setAutoPrint)}
      printerName={settings.state.printerName}
      onPrinterName={settings.actions.setPrinterName}
      onTestPrint={settings.actions.testPrint}
      onWipe={onWipe}
      onRevenuePinChanged={settings.actions.setCurrentRevenuePin}
    />
  </ScreenShell>
  );
}
