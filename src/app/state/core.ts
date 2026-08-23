import { useCallback, useEffect, useRef, type MutableRefObject } from 'react';
import { saveAllData, type PersistedData } from '../../db/persistence';
import type {
  Category, CostEntry, InventorySnapshot, MenuItem, MenuItemStockAssignment, Order,
  OversellEvent, ParkedSession, StockItem, StockMovement, TradingEvent, TradingSession,
} from '../types';

/**
 * Everything durable, in one shape.
 *
 * This is `PersistedData` with nothing optional: the running program always has
 * a value for each of these, even if it is an empty array, and the optionality
 * on the persisted type exists only for databases written before a table did.
 */
export interface DataSnapshot {
  menuItems: MenuItem[];
  categories: Category[];
  orders: Order[];
  parkedSessions: ParkedSession[];
  stockItems: StockItem[];
  stockAssignments: MenuItemStockAssignment[];
  stockMovements: StockMovement[];
  inventorySnapshots: InventorySnapshot[];
  oversellEvents: OversellEvent[];
  orderCounter: number;
  tradingSessions: TradingSession[];
  tradingEvents: TradingEvent[];
  costEntries: CostEntry[];
}

/**
 * What every domain hook is handed.
 *
 * Two things, and they are the two things that cannot be split up per domain.
 *
 * `snapshot` is the latest value of all durable state, readable synchronously.
 * Handlers read from it rather than from their own closures, and that is
 * correctness rather than optimisation: two orders can be rung up inside a
 * single React tick, and a handler reading the session list from a stale
 * closure would hand both of them the same ticket number — the one thing
 * session numbering exists to prevent. The same reasoning covers the rest of
 * it. A till is operated fast enough that "the state as of the last render" is
 * routinely not the state.
 *
 * `saveImmediate` is one coordinator, not one per hook. Several handlers write
 * more than one table in a single action — voiding an order touches the orders,
 * the counter and the stock ledger — and independent saves would let a device
 * that stopped between two of them keep a ticket that had returned its stock
 * twice, or not at all.
 */
export interface StateCore {
  snapshot: MutableRefObject<DataSnapshot>;
  saveImmediate: (override?: Partial<PersistedData>) => Promise<void>;
}

/**
 * Creates the core. Called before any domain hook, because they all take it.
 *
 * The ref starts on the initial state and is filled in from the real state by
 * `useDataPersistence` below, which necessarily runs after the domain hooks
 * have produced that state. The ref's *identity* is stable from the first
 * render, which is what lets the hooks close over it safely.
 */
export function useDataCore(initial: DataSnapshot): StateCore {
  const snapshot = useRef<DataSnapshot>(initial);

  const saveImmediate = useCallback(async (override?: Partial<PersistedData>) => {
    try {
      const data = override ? { ...snapshot.current, ...override } : snapshot.current;
      await saveAllData(data);
    } catch (e) {
      console.error('Failed to save data:', e);
    }
  }, []);

  return { snapshot, saveImmediate };
}

/** How long a change waits before the background save picks it up. */
const SAVE_DEBOUNCE_MS = 300;

/**
 * Keeps the snapshot in step with state, and saves in the background.
 *
 * Called after the domain hooks, with the state they produced. The two effects
 * are separate on purpose: the ref has to catch up on *every* change, while the
 * save is debounced, and merging them would either save on every keystroke or
 * leave handlers reading a stale ref for 300ms.
 */
export function useDataPersistence(
  core: StateCore,
  current: DataSnapshot,
  dataLoaded: boolean,
): void {
  const { snapshot } = core;
  const saveTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    snapshot.current = current;
    // The dependency list is the snapshot's fields rather than the object,
    // which is rebuilt on every render.
  }, [
    snapshot, current,
    current.menuItems, current.categories, current.orders, current.parkedSessions,
    current.stockItems, current.stockAssignments, current.stockMovements,
    current.inventorySnapshots, current.oversellEvents, current.orderCounter,
    current.tradingSessions, current.tradingEvents, current.costEntries,
  ]);

  useEffect(() => {
    if (!dataLoaded) return;
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = window.setTimeout(async () => {
      try {
        // Save the whole snapshot rather than a hand-listed subset. The list had
        // already drifted — inventory snapshots and oversell events were absent
        // from it, so they only reached disk when something else forced an
        // immediate save. One source of truth cannot drift from itself.
        await saveAllData(snapshot.current);
      } catch (e) {
        console.error('Failed to save data:', e);
      }
    }, SAVE_DEBOUNCE_MS);
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, [
    snapshot, dataLoaded,
    current.menuItems, current.categories, current.orders, current.parkedSessions,
    current.stockItems, current.stockAssignments, current.stockMovements,
    current.inventorySnapshots, current.oversellEvents, current.orderCounter,
    current.tradingSessions, current.tradingEvents, current.costEntries,
  ]);
}
