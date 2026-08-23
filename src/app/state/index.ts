/**
 * Domain state.
 *
 * One hook per domain, each returning `{ state, actions }` and each recording
 * its own undo entries through `useHistory()`. `App.tsx` composes them and owns
 * nothing itself.
 *
 * Two things are shared rather than split up, and `core.ts` explains why: the
 * snapshot ref, which lets a handler read the latest state synchronously, and
 * the save coordinator, which keeps a multi-table write in one transaction's
 * worth of work.
 */
export { useDataCore, useDataPersistence } from './core';
export type { DataSnapshot, StateCore } from './core';
export { useNotUndoable } from './useNotUndoable';
export type { ExplainNotUndoable } from './useNotUndoable';
export { useSettings, useSettingsPersistence } from './useSettings';
export type { SettingsHandle } from './useSettings';
export { useMenu } from './useMenu';
export type { MenuHandle } from './useMenu';
export { useStock } from './useStock';
export type { StockHandle, StockChange } from './useStock';
export { useSessions } from './useSessions';
export type { SessionsHandle, CompletedFilter } from './useSessions';
export { useOrders } from './useOrders';
export type { OrdersHandle } from './useOrders';
export { useDesktopShell } from './useDesktopShell';
export {
  INITIAL_CATEGORIES, INITIAL_CATEGORY, INITIAL_MENU_ITEMS, INITIAL_SNAPSHOT,
} from './initial';
