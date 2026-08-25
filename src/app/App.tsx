import { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Lock } from 'lucide-react';
import { HomeScreen } from './components/HomeScreen';
import { DragProvider } from './components/DragContext';
import LoginPage from './components/LoginPage';
import { ErrorBoundary } from './components/ErrorBoundary';
import { TicketMenuProvider } from './components/TicketActionMenu';
import { OrderModeScreen } from './screens/OrderModeScreen';
import { BoardScreen } from './screens/BoardScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { AnalyticsScreen } from './screens/AnalyticsScreen';
import { InventoryScreen } from './screens/InventoryScreen';
import { NavigationProvider, useNavigation } from './lib/navigation';
import { HistoryProvider, useHistory } from './lib/history';
import { clearScreenState } from './lib/screenState';
import { ensureSystemCategories } from './lib/menu';
import { isLowStock } from './lib/inventory';
import {
  Button, ConfirmDialog, Dialog, SectionTheme, ToastProvider,
  DANGER, DURATION, EASE, useReducedMotion,
} from './ui';
import {
  useDataCore, useDataPersistence, useDesktopShell, useMenu, useNotUndoable, useOrders,
  useSessions, useSettings, useSettingsPersistence, useStock, type DataSnapshot,
} from './state';
import {
  INITIAL_CATEGORIES, INITIAL_CATEGORY, INITIAL_MENU_ITEMS, INITIAL_SNAPSHOT,
} from './state/initial';
import type { WipeScope } from './components/WipeDataPanel';
import {
  loadAllData, saveAllData, clearAllData, clearTransactionalData,
} from '../db/persistence';
import type { PersistedData } from '../db/persistence';

/**
 * Composition.
 *
 * Every mutation in the program lives in one of the five hooks below; this
 * function decides which screen is on, wires the hooks to each other, and owns
 * nothing of its own beyond the two dialogs that belong to the window rather
 * than to any screen.
 *
 * The order the hooks are called in is a dependency order and is not
 * arbitrary — see docs/00-ARCHITECTURE.md.
 */
function AppInner({ onLogout }: { onLogout: () => void }) {
  const { view: currentView, navigate: navigateTo } = useNavigation();
  const history = useHistory();
  const reduceMotion = useReducedMotion();
  const explainNotUndoable = useNotUndoable();

  const [dataLoaded, setDataLoaded] = useState(false);

  const core = useDataCore(INITIAL_SNAPSHOT);

  const settings = useSettings(currentView);
  const menu = useMenu(core, {
    menuItems: INITIAL_MENU_ITEMS,
    categories: INITIAL_CATEGORIES,
    selectedCategory: INITIAL_CATEGORY,
  });
  const stock = useStock(core, {
    assignments: menu.state.stockAssignments,
    setAssignments: menu.actions.setStockAssignments,
    menuItems: menu.state.menuItems,
    dataLoaded,
  });
  const sessions = useSessions(core, explainNotUndoable);
  const orders = useOrders(core, {
    menuItems: menu.state.menuItems,
    assignments: menu.state.stockAssignments,
    stockItems: stock.state.stockItems,
    applyStockChanges: stock.actions.applyStockChanges,
    deductStockForCart: stock.actions.deductStockForCart,
    returnStockForCart: stock.actions.returnStockForCart,
    logOversell: stock.actions.logOversell,
    claimPendingOversells: stock.actions.claimPendingOversells,
    claimTicket: sessions.actions.claimTicket,
    sessionsRef: sessions.state.sessionsRef,
    activeTaxRate: settings.state.activeTaxRate,
    grillCapacityRef: settings.state.grillCapacityRef,
    revenuePin: settings.state.currentRevenuePin,
    printOrderIfNeeded: settings.actions.printOrderIfNeeded,
    printEditedOrder: settings.actions.printEditedOrder,
    explainNotUndoable,
    currentView,
    navigateTo,
  });

  /* ------------------------------------------------------------ the world */

  const snapshot: DataSnapshot = {
    menuItems: menu.state.menuItems,
    categories: menu.state.categories,
    stockAssignments: menu.state.stockAssignments,
    orders: orders.state.orders,
    parkedSessions: orders.state.parkedSessions,
    orderCounter: orders.state.orderCounter,
    stockItems: stock.state.stockItems,
    stockMovements: stock.state.stockMovements,
    inventorySnapshots: stock.state.inventorySnapshots,
    oversellEvents: stock.state.oversellEvents,
    tradingSessions: sessions.state.tradingSessions,
    tradingEvents: sessions.state.tradingEvents,
    costEntries: sessions.state.costEntries,
  };

  useDataPersistence(core, snapshot, dataLoaded);
  useSettingsPersistence(settings, dataLoaded);
  const shell = useDesktopShell(core, dataLoaded);

  /* -------------------------------------------------------------- startup */

  useEffect(() => {
    (async () => {
      try {
        // `demoFallback` is a no-op unless this is a demo build, and even
        // then only fires when the database had nothing — which in practice
        // means the browser, where there is no SQLite to talk to at all.
        const saved = (await loadAllData()) ?? (await demoFallback());
        if (saved) {
          menu.actions.hydrate({
            menuItems: saved.menuItems,
            // Adopts or creates the deals category if this menu predates it, so
            // an existing shop keeps working without anyone having to notice.
            categories: ensureSystemCategories(saved.categories, saved.menuItems),
            stockAssignments: saved.stockAssignments,
          });
          orders.actions.hydrate({
            orders: saved.orders,
            parkedSessions: saved.parkedSessions,
            orderCounter: saved.orderCounter,
          });
          stock.actions.hydrate({
            stockItems: saved.stockItems,
            stockMovements: saved.stockMovements ?? [],
            inventorySnapshots: saved.inventorySnapshots ?? [],
            oversellEvents: saved.oversellEvents ?? [],
          });
          sessions.actions.hydrate({
            tradingSessions: saved.tradingSessions ?? [],
            tradingEvents: saved.tradingEvents ?? [],
            costEntries: saved.costEntries ?? [],
          });
        } else {
          try {
            await saveAllData(core.snapshot.current);
          } catch (e) {
            console.error('Failed to seed initial data:', e);
          }
        }

        await settings.actions.hydrate();
      } catch (e) {
        console.error('Persistence unavailable, running in-memory:', e);
      }
      setDataLoaded(true);
    })();
    // Runs once. The hydrate actions are stable and the effect is a bootstrap,
    // not a subscription.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Clears history, then resets the in-memory state to match rather than
   * relying on a reload — the app has to be usable the moment it returns.
   *
   * Cross-domain by nature, which is why it lives here rather than in a hook:
   * every one of them has something to forget.
   */
  const handleWipeData = useCallback(async (scope: WipeScope) => {
    if (scope === 'everything') {
      await clearAllData();
      menu.actions.clear();
      stock.actions.clearItems();
    } else {
      await clearTransactionalData();
    }
    orders.actions.clear();
    stock.actions.clearHistory();
    sessions.actions.clear();
    // Nothing on the undo stack can mean anything once the data it refers to
    // has gone, and offering to "take back" a wipe that genuinely cannot be
    // taken back would be a lie. Remembered screen positions go with it — a
    // saved period or filter over data that no longer exists is worse than none.
    history.reset();
    clearScreenState();
  }, [menu.actions, stock.actions, orders.actions, sessions.actions, history]);

  /**
   * A menu item to open Assign Stock on, set by the cost read-out in Settings.
   *
   * It lives here rather than in either screen because it crosses between them,
   * and it is cleared the moment Inventory has taken it: left set, coming back
   * to Inventory later by any other route would drop you into an editor you did
   * not ask for.
   */
  const [assignTarget, setAssignTarget] = useState<string | null>(null);

  const handleAssignStock = useCallback((menuItemId: string) => {
    setAssignTarget(menuItemId);
    navigateTo('inventory');
  }, [navigateTo]);

  // Stable, because Inventory reads it from an effect: a fresh arrow every
  // render would re-run that effect and could re-open the editor somebody had
  // just backed out of.
  const handleAssignTargetTaken = useCallback(() => setAssignTarget(null), []);

  const handleOrdersNavigation = useCallback(() => {
    // From Order Mode, the other board is All Orders. From anywhere else it is
    // Order Mode — one control, two destinations, never both on screen.
    navigateTo(currentView === 'orderMode' ? 'allOrders' : 'orderMode');
  }, [currentView, navigateTo]);

  /* --------------------------------------------------------------- screens */

  const lowStockItems = stock.state.stockItems.filter(isLowStock);
  const openOrderCount =
    orders.state.preparing.length + orders.state.grill.length + orders.state.ready.length;

  let pageContent: React.ReactNode;

  if (currentView === 'home') {
    pageContent = (
      <SectionTheme section="home" className="contents">
        <HomeScreen
          onNavigate={navigateTo}
          onLogout={onLogout}
          lowStockCount={lowStockItems.length}
          liveSessionName={sessions.state.live?.name ?? null}
          openOrderCount={openOrderCount}
        />
      </SectionTheme>
    );
  } else if (currentView === 'settings') {
    pageContent = (
      <SettingsScreen
        menu={menu}
        settings={settings}
        stock={stock}
        grillOnBoard={orders.state.grill.length}
        onWipe={handleWipeData}
        onOtherBoard={handleOrdersNavigation}
        onAssignStock={handleAssignStock}
      />
    );
  } else if (currentView === 'analytics') {
    pageContent = (
      <AnalyticsScreen
        menu={menu}
        stock={stock}
        sessions={sessions}
        settings={settings}
        orders={orders.state.orders}
        onOtherBoard={handleOrdersNavigation}
        onOpenInventory={() => navigateTo('inventory')}
      />
    );
  } else if (currentView === 'inventory') {
    pageContent = (
      <InventoryScreen
        menu={menu}
        stock={stock}
        onPrintReorder={settings.actions.printReorderList}
        onOtherBoard={handleOrdersNavigation}
        assignTarget={assignTarget}
        onAssignTargetTaken={handleAssignTargetTaken}
      />
    );
  } else if (currentView === 'allOrders') {
    pageContent = (
      <BoardScreen
        orders={orders}
        sessions={sessions}
        grillCapacity={settings.state.grillCapacity}
        onOtherBoard={handleOrdersNavigation}
      />
    );
  } else {
    pageContent = (
      <OrderModeScreen
        orders={orders}
        menu={menu}
        lowStockItems={lowStockItems}
        liveSessionId={sessions.state.live?.id ?? null}
        grillCapacity={settings.state.grillCapacity}
        activeTaxRate={settings.state.activeTaxRate}
        tapToExpandParked={settings.state.tapToExpandParked}
        discountRequiresPin={settings.state.discountRequiresPin}
        onLogOversell={stock.actions.logOversell}
        onOtherBoard={handleOrdersNavigation}
        onOpenInventory={() => navigateTo('inventory')}
      />
    );
  }

  return (
    <TicketMenuProvider onAction={orders.actions.handleTicketAction}>
      {/* Sections cross-dissolve rather than swapping outright.
          The old code swapped instantly, on the reasoning that fading two
          full-screen pages let the background flash through between them. That
          is true of a symmetric fade; here the outgoing page holds full opacity
          and sits underneath while the incoming one paints over it, so there is
          never a frame with nothing on it. */}
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div
          key={currentView}
          style={{ position: 'fixed', inset: 0 }}
          initial={reduceMotion ? false : { opacity: 0, scale: 0.99 }}
          animate={{ opacity: 1, scale: 1, zIndex: 2 }}
          exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 1.004, zIndex: 1 }}
          transition={reduceMotion ? { duration: 0 } : { duration: DURATION.base, ease: EASE }}
        >
          {pageContent}
        </motion.div>
      </AnimatePresence>

      <Dialog
        open={orders.state.discountPinPrompt !== null}
        onClose={orders.actions.dismissDiscountPin}
        title="Manager PIN"
        description="Discounts are protected on this till. Enter the money PIN to take the amount off."
        icon={<Lock size={22} />}
        tone="#FE9A00"
        actions={
          <>
            <Button variant="secondary" block onClick={orders.actions.dismissDiscountPin}>
              Cancel
            </Button>
            <Button variant="primary" block onClick={orders.actions.submitDiscountPin}>
              Apply discount
            </Button>
          </>
        }
      >
        <input
          type="password"
          autoFocus
          value={orders.state.discountPinInput}
          onChange={e => {
            orders.actions.setDiscountPinInput(e.target.value);
            orders.actions.setDiscountPinError(false);
          }}
          onKeyDown={e => { if (e.key === 'Enter') orders.actions.submitDiscountPin(); }}
          className="w-full bg-[var(--app-surface)] text-[var(--app-text)] text-center text-2xl tracking-[8px] rounded-xl px-4 py-3 focus:outline-none border"
          style={{ borderColor: orders.state.discountPinError ? DANGER : 'transparent' }}
        />
        {orders.state.discountPinError && (
          <p className="text-center text-[13px] -mt-[8px]" style={{ color: DANGER }}>
            That is not the PIN. Try again, or cancel and ring the order up at full price.
          </p>
        )}
      </Dialog>

      <ConfirmDialog
        open={shell.closeRequested}
        onCancel={shell.cancelClose}
        onConfirm={shell.confirmClose}
        title="Close the till?"
        description="Everything is saved before the program closes, so nothing on the board or in stock will be lost."
        confirmLabel="Close the till"
        cancelLabel="Keep working"
        destructive
      />
    </TicketMenuProvider>
  );
}

/**
 * The demo dataset, when this is a demo build and nothing else can supply one.
 *
 * Reached only when the database had nothing to give: a `tauri dev` demo build
 * finds `hotdads-demo.db` and never gets here, so anything changed while poking
 * around survives a reload. The browser has no SQLite at all and always does.
 *
 * Dynamically imported and guarded by a build-time constant, so a production
 * bundle contains no part of it — `demo/data.ts` is six weeks of generated
 * trading and has no business being shipped to a till.
 */
async function demoFallback(): Promise<PersistedData | null> {
  // Written against `import.meta.env` directly rather than against the
  // `USING_DEMO_DB` constant beside it, and that is not a style choice: Vite
  // replaces this expression with a literal at build time, so Rollup can fold
  // the branch and drop the `import()` below with it. Testing an *imported*
  // boolean leaves the import reachable as far as the bundler is concerned, and
  // six weeks of invented trading is emitted as a lazy chunk that ships to a
  // real till and is never loaded. Checked by grepping `dist/`.
  if (import.meta.env.VITE_DEMO_DB !== '1') return null;
  const { buildDemoSnapshot } = await import('../../demo/data');
  console.info('[DEMO] no database available — generating the demo dataset in memory');
  return buildDemoSnapshot();
}

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  if (!isAuthenticated) {
    return <LoginPage onLogin={() => setIsAuthenticated(true)} />;
  }

  /**
   * The order matters. Toasts are how undo reports what it did, so the history
   * has to sit inside them; navigation and history are both read by the
   * permanent bar, so both have to sit outside everything that renders it.
   */
  return (
    <ErrorBoundary>
      <ToastProvider>
        <HistoryProvider>
          <NavigationProvider>
            <DragProvider>
              <AppInner onLogout={() => setIsAuthenticated(false)} />
            </DragProvider>
          </NavigationProvider>
        </HistoryProvider>
      </ToastProvider>
    </ErrorBoundary>
  );
}
