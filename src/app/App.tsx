import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Ticket } from './components/Ticket';
import { Navigation, NavActions, NavSlot, NavSlotHost, NavTab, NavTabs } from './components/Navigation';
import { HomeScreen } from './components/HomeScreen';
import { SettingsView } from './settings/SettingsView';
import { DragProvider, useDropTarget, useDrag, type DragOrigin } from './components/DragContext';
import { InventoryView } from './inventory/InventoryView';
import { AnalyticsView } from './analytics/AnalyticsView';
import { RevenuePinPad } from './analytics/RevenueLock';
import LoginPage from './components/LoginPage';
import { NavigationProvider, useNavigation, type View } from './lib/navigation';
import { HistoryProvider, restoreAction, useHistory } from './lib/history';
import { clearScreenState } from './lib/screenState';
import { componentsTotal, ensureSystemCategories, isSystemCategory } from './lib/menu';
import {
  Button, ConfirmDialog, Dialog, EmptyState, HINT, IconButton, Panel as UiPanel, SectionTheme,
  SECTION_COLOR, SegmentedControl, STATUS_COLOR, Toggle, ToastProvider, Tooltip, alpha,
  capitalizeFirst, measure, useToast,
  DANGER, DURATION, EASE, GLIDE, SETTLE, SNAP, useReducedMotion, type SectionId,
} from './ui';
import { ChevronLeft, ChevronRight, Trash2, Plus, Lock, Banknote, Smartphone, CheckCircle2, XCircle, Flame, BellRing, Pencil, Inbox, ShoppingBag } from 'lucide-react';
import type { MenuItem, CartItem, Order, OrderStatus, BoardStatus, ParkedSession, Category, DealItem, StockItem, MenuItemStockAssignment, Discount, StockMovement, StockMovementReason, InventorySnapshot, OversellEvent, TradingSession, TradingEvent, CostEntry } from './types';
import { SessionBar } from './components/SessionBar';
import {
  createEvent,
  displayNumber,
  endSession as closeSession,
  newCostId,
  pauseSession,
  resumeSession,
  startSession,
  withDisplayNumbers,
} from './lib/sessions';
import { TicketMenuProvider, type TicketAction } from './components/TicketActionMenu';
import { DiscountField } from './components/DiscountField';
import { LowStockNotice, SoldOutPrompt } from './components/StockNotices';
import { WipeDataPanel, type WipeScope } from './components/WipeDataPanel';
import type { StockTakeLine } from './inventory/StockTakeScreen';
import { buildMovement, estimateProduct, formatQuantityLabel, isLowStock, unitCostFor } from './lib/inventory';
import type { ProductEstimate } from './lib/inventory';
import {
  applyStockDelta,
  stockUsageForCart as usageForCart,
  cartSubtotal,
  computeTotals,
  discountAmountFor,
  formatOrderNumber,
  newOrderId,
  renumberOrders,
  liveOrderCount,
} from './lib/orders';
import { SyncSettings } from '../db/SyncSettings';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { loadAllData, saveAllData, getAppSetting, setAppSetting, clearAllData, clearTransactionalData, type PersistedData } from '../db/persistence';
import { initSyncTables, hasUnsentChanges, sendChanges } from '../db/sync-client';
import { printOrder, formatTicket } from '../print/printTicket';

/** Which colour and identity each screen carries. */
const VIEW_SECTION: Record<View, SectionId> = {
  home: 'home',
  orderMode: 'order',
  allOrders: 'orders',
  settings: 'settings',
  analytics: 'analytics',
  inventory: 'inventory',
};

const initialCategories: Category[] = [
  { id: 'cat-1', name: 'Food', order: 0 },
  { id: 'cat-2', name: 'Drinks', order: 1 },
  { id: 'cat-deals', name: 'Deals', order: 2, system: 'deals' },
];

const initialMenuItems: MenuItem[] = [
  { id: '1', name: 'Burger', price: 500, showInOrderMode: true, category: 'Food' },
  { id: '2', name: 'Chicken', price: 600, showInOrderMode: true, category: 'Food' },
  { id: '3', name: 'Beef', price: 700, showInOrderMode: true, category: 'Food' },
  {
    id: '4',
    name: 'Deal 1',
    price: 1200,
    showInOrderMode: true,
    category: 'Deals',
    dealItems: [
      { name: 'Beef', quantity: 2 },
      { name: 'Coke', quantity: 2 }
    ]
  },
  { id: '5', name: 'Water', price: 50, showInOrderMode: true, category: 'Drinks' },
  { id: '6', name: 'Coke', price: 100, showInOrderMode: true, category: 'Drinks' },
  { id: '7', name: 'Sprite', price: 100, showInOrderMode: true, category: 'Drinks' },
  { id: '8', name: 'Custom', price: 150, showInOrderMode: true, category: 'Food' },
];

const initialOrders: Order[] = [];

function AppInner({ onLogout }: { onLogout: () => void }) {
  const { view: currentView, navigate: navigateTo } = useNavigation();
  const history = useHistory();
  const toast = useToast();
  const reduceMotion = useReducedMotion();
  const [stockItems, setStockItems] = useState<StockItem[]>([]);
  const [stockAssignments, setStockAssignments] = useState<MenuItemStockAssignment[]>([]);
  const [stockMovements, setStockMovements] = useState<StockMovement[]>([]);
  const [inventorySnapshots, setInventorySnapshots] = useState<InventorySnapshot[]>([]);
  const [oversellEvents, setOversellEvents] = useState<OversellEvent[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>(initialMenuItems);
  const [categories, setCategories] = useState<Category[]>(initialCategories);
  const [orders, setOrders] = useState<Order[]>(initialOrders);
  const [orderCounter, setOrderCounter] = useState(1);
  const [tradingSessions, setTradingSessions] = useState<TradingSession[]>([]);
  const [tradingEvents, setTradingEvents] = useState<TradingEvent[]>([]);
  const [costEntries, setCostEntries] = useState<CostEntry[]>([]);
  const [completedFilter, setCompletedFilter] = useState<'all' | 'session'>('all');

  const [parkedSessions, setParkedSessions] = useState<ParkedSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>('');

  /**
   * Live mirror of the session list, so ticket numbers can be claimed without
   * waiting for a re-render. Kept in step with state on every render below.
   */
  const tradingSessionsRef = useRef<TradingSession[]>(tradingSessions);

  const [dataLoaded, setDataLoaded] = useState(false);
  const saveTimeoutRef = useRef<number | null>(null);
  const dataSnapshotRef = useRef({ menuItems, categories, orders, parkedSessions, stockItems, stockAssignments, stockMovements, inventorySnapshots, oversellEvents, orderCounter, tradingSessions, tradingEvents, costEntries });
  const [autoPrint, setAutoPrint] = useState(false);
  const [printerName, setPrinterName] = useState('');
  const [discountRequiresPin, setDiscountRequiresPin] = useState(false);
  const [taxEnabled, setTaxEnabled] = useState(false);
  const [taxRateInput, setTaxRateInput] = useState('0');
  const [grillCapacityInput, setGrillCapacityInput] = useState('8');
  const [tapToExpandParked, setTapToExpandParked] = useState(false);
  const [lightMode, setLightMode] = useState(false);
  /** Whole-interface zoom. Larger is easier to hit on a counter-top screen. */
  const [uiScale, setUiScale] = useState(1.12);
  const grillCapacityRef = useRef(8);
  const [grillMinimized, setGrillMinimized] = useState(false);
  const boardScrollRef = useRef<HTMLDivElement | null>(null);
  const grillSectionRef = useRef<HTMLDivElement | null>(null);
  const grillExpandedHeightRef = useRef(0);

  /**
   * Collapsing the grill removes its own height from the scrollable area, which
   * can drop the container back to scrollTop 0 and expand it again — a loop that
   * feels like the board is fighting you. So it only collapses when there will
   * still be room to stay scrolled past the threshold afterwards, and only
   * expands again near the very top.
   */
  const handleBoardScroll = useCallback((el: HTMLDivElement) => {
    const COLLAPSE_AT = 48;
    const EXPAND_AT = 10;
    const COLLAPSED_HEIGHT = 84;

    setGrillMinimized(prev => {
      const section = grillSectionRef.current;
      if (!prev && section) grillExpandedHeightRef.current = section.offsetHeight;

      if (prev) return el.scrollTop > EXPAND_AT;

      const savings = Math.max(0, grillExpandedHeightRef.current - COLLAPSED_HEIGHT);
      const maxScrollAfter = el.scrollHeight - el.clientHeight - savings;
      return el.scrollTop > COLLAPSE_AT && maxScrollAfter > COLLAPSE_AT;
    });
  }, []);
  const [discountPinPrompt, setDiscountPinPrompt] = useState<{ onGranted: () => void } | null>(null);
  const [discountPinInput, setDiscountPinInput] = useState('');
  const [discountPinError, setDiscountPinError] = useState(false);
  /** Live, unconfirmed discount value — shown greyed in the totals breakdown. */
  const [pendingDiscountAmount, setPendingDiscountAmount] = useState(0);

  useEffect(() => {
    (async () => {
      try {
        const saved = await loadAllData();
        if (saved) {
          setMenuItems(saved.menuItems);
          // Adopts or creates the deals category if this menu predates it, so
          // an existing shop keeps working without anyone having to notice.
          setCategories(ensureSystemCategories(saved.categories, saved.menuItems));
          setOrders(saved.orders);
          setParkedSessions(saved.parkedSessions);
          setStockItems(saved.stockItems);
          setStockAssignments(saved.stockAssignments);
          setStockMovements(saved.stockMovements ?? []);
          setInventorySnapshots(saved.inventorySnapshots ?? []);
          setOversellEvents(saved.oversellEvents ?? []);
          setOrderCounter(saved.orderCounter);
          setTradingSessions(saved.tradingSessions ?? []);
          setTradingEvents(saved.tradingEvents ?? []);
          setCostEntries(saved.costEntries ?? []);
          if ((saved.tradingSessions ?? []).some(s => s.status === 'active')) {
            setCompletedFilter('session');
          }
        } else {
          try {
            await saveAllData({
              menuItems, categories, orders, parkedSessions,
              stockItems, stockAssignments, stockMovements,
              inventorySnapshots, oversellEvents, orderCounter,
              tradingSessions, tradingEvents, costEntries,
            });
          } catch (e) {
            console.error('Failed to seed initial data:', e);
          }
        }

        const pin = await getAppSetting('revenue_pin');
        if (pin) {
          setCurrentRevenuePin(pin);
        } else {
          await setAppSetting('revenue_pin', '1234');
        }

        const savedAutoPrint = await getAppSetting('auto_print');
        if (savedAutoPrint !== null) {
          setAutoPrint(savedAutoPrint === 'true');
        }
        const savedPrinterName = await getAppSetting('printer_name');
        if (savedPrinterName !== null) {
          setPrinterName(savedPrinterName);
        }
        const savedDiscountPin = await getAppSetting('discount_requires_pin');
        if (savedDiscountPin !== null) {
          setDiscountRequiresPin(savedDiscountPin === 'true');
        }
        const savedTaxEnabled = await getAppSetting('tax_enabled');
        if (savedTaxEnabled !== null) {
          setTaxEnabled(savedTaxEnabled === 'true');
        }
        const savedTaxRate = await getAppSetting('tax_rate');
        if (savedTaxRate !== null) {
          setTaxRateInput(savedTaxRate);
        }
        const savedLightMode = await getAppSetting('light_mode');
        if (savedLightMode !== null) {
          setLightMode(savedLightMode === 'true');
        }
        const savedGrillCapacity = await getAppSetting('grill_capacity');
        if (savedGrillCapacity !== null) {
          setGrillCapacityInput(savedGrillCapacity);
        }
        const savedTapToExpand = await getAppSetting('tap_to_expand_parked');
        if (savedTapToExpand !== null) {
          setTapToExpandParked(savedTapToExpand === 'true');
        }
        const savedUiScale = await getAppSetting('ui_scale');
        if (savedUiScale !== null) {
          const parsed = parseFloat(savedUiScale);
          if (Number.isFinite(parsed) && parsed >= 0.9 && parsed <= 1.5) setUiScale(parsed);
        }
      } catch (e) {
        console.error('Persistence unavailable, running in-memory:', e);
      }
      setDataLoaded(true);
    })();
  }, []);

  useEffect(() => {
    if (!dataLoaded) return;
    (async () => {
      await setAppSetting('auto_print', String(autoPrint));
      await setAppSetting('printer_name', printerName);
      await setAppSetting('discount_requires_pin', String(discountRequiresPin));
      await setAppSetting('tax_enabled', String(taxEnabled));
      await setAppSetting('tax_rate', taxRateInput);
      await setAppSetting('light_mode', String(lightMode));
      await setAppSetting('grill_capacity', grillCapacityInput);
      await setAppSetting('tap_to_expand_parked', String(tapToExpandParked));
      await setAppSetting('ui_scale', String(uiScale));
    })();
  }, [autoPrint, printerName, discountRequiresPin, taxEnabled, taxRateInput,
      lightMode, grillCapacityInput, tapToExpandParked, uiScale, dataLoaded]);

  useEffect(() => {
    dataSnapshotRef.current = { menuItems, categories, orders, parkedSessions, stockItems, stockAssignments, stockMovements, inventorySnapshots, oversellEvents, orderCounter, tradingSessions, tradingEvents, costEntries };
  }, [menuItems, categories, orders, parkedSessions, stockItems, stockAssignments, stockMovements, inventorySnapshots, oversellEvents, orderCounter, tradingSessions, tradingEvents, costEntries]);

  useEffect(() => {
    if (!dataLoaded) return;
    let syncTimer: number | null = null;
    (async () => {
      try {
        await initSyncTables();
        console.log('SQLite Sync: tables initialized');
      } catch (e) {
        console.log('SQLite Sync: not available yet (configure in Settings > Program Settings)', e);
        return;
      }
      syncTimer = window.setInterval(async () => {
        try {
          const hasChanges = await hasUnsentChanges().catch(() => false);
          if (hasChanges) {
            const result = await sendChanges();
            console.log('SQLite Sync: auto-sync result', result);
          }
        } catch {
          // sync not configured yet, skip
        }
      }, 30000);
    })();
    return () => {
      if (syncTimer !== null) clearInterval(syncTimer);
    };
  }, [dataLoaded]);

  useEffect(() => {
    if (!dataLoaded) return;
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = window.setTimeout(async () => {
      try {
        // Save the whole snapshot rather than a hand-listed subset. The list had
        // already drifted — inventory snapshots and oversell events were absent
        // from it, so they only reached disk when something else forced an
        // immediate save. One source of truth cannot drift from itself.
        await saveAllData(dataSnapshotRef.current);
      } catch (e) {
        console.error('Failed to save data:', e);
      }
    }, 300);
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, [menuItems, categories, orders, parkedSessions, stockItems, stockAssignments, stockMovements, inventorySnapshots, oversellEvents, orderCounter, tradingSessions, tradingEvents, costEntries, dataLoaded]);

  useEffect(() => {
    if (!dataLoaded) return;
    let unlisten: (() => void) | undefined;
    (async () => {
      try {
        unlisten = await listen<null>('close-requested-ui', () => {
          setShowCloseConfirm(true);
        });
      } catch {
        // Not in Tauri environment
      }
    })();
    return () => {
      if (unlisten) unlisten();
    };
  }, [dataLoaded]);

  const handleCloseConfirm = useCallback(async () => {
    setShowCloseConfirm(false);
    try {
      await saveAllData(dataSnapshotRef.current);
      await invoke('close_app');
    } catch {
      // fallback
    }
  }, []);

  const handleCloseCancel = useCallback(() => {
    setShowCloseConfirm(false);
  }, []);

  const [parkedSidebarOpen, setParkedSidebarOpen] = useState(false);
  const [cashReceived, setCashReceived] = useState('');
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>('Food');
  const [fullscreen, setFullscreen] = useState(false);

  const [revenueLocked, setRevenueLocked] = useState(true);
  const [showRevenuePin, setShowRevenuePin] = useState(false);
  const [revenuePinInput, setRevenuePinInput] = useState('');
  const [currentRevenuePin, setCurrentRevenuePin] = useState('1234');
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);

  const saveImmediate = useCallback(async (override?: Partial<PersistedData>) => {
    try {
      const data = override ? { ...dataSnapshotRef.current, ...override } : dataSnapshotRef.current;
      await saveAllData(data);
    } catch (e) {
      console.error('Failed to save data:', e);
    }
  }, []);

  const handleRevenueLock = () => {
    setRevenueLocked(true);
    setShowRevenuePin(false);
    setRevenuePinInput('');
  };

  useEffect(() => {
    if (currentView !== 'analytics') {
      setRevenueLocked(true);
      setShowRevenuePin(false);
      setRevenuePinInput('');
    }
  }, [currentView]);

  // Inventory management
  const handleAddStockItem = async (item: StockItem) => {
    setStockItems(prev => [...prev, item]);
    await saveImmediate({ stockItems: [...dataSnapshotRef.current.stockItems, item] });
  };

  const handleUpdateStockItem = async (id: string, patch: Partial<StockItem>) => {
    setStockItems(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s));
    await saveImmediate({ stockItems: dataSnapshotRef.current.stockItems.map(s => s.id === id ? { ...s, ...patch } : s) });
  };

  const handleDeleteStockItem = async (id: string) => {
    const beforeItems = dataSnapshotRef.current.stockItems;
    const beforeAssignments = dataSnapshotRef.current.stockAssignments;
    const removed = beforeItems.find(s => s.id === id);
    const afterItems = beforeItems.filter(s => s.id !== id);
    const afterAssignments = beforeAssignments.filter(a => a.stockItemId !== id);

    setStockItems(afterItems);
    setStockAssignments(afterAssignments);

    // Removing an item takes its recipe links with it, so putting it back has
    // to restore both or the menu items that used it stay silently uncosted.
    history.record({
      label: `Removed ${removed?.name ?? 'a stock item'}`,
      scope: 'stock',
      undo: () => { setStockItems(beforeItems); setStockAssignments(beforeAssignments); },
      redo: () => { setStockItems(afterItems); setStockAssignments(afterAssignments); },
    });

    await saveImmediate({ stockItems: afterItems, stockAssignments: afterAssignments });
  };

  /**
   * Manual add, packet add, waste, correction or stock take from the inventory
   * screen. `totalCost` is what the delivery cost, and only applies to receipts.
   */
  const handleAdjustStock = async (
    itemId: string, delta: number, reason: StockMovementReason, note?: string, totalCost?: number,
  ) => {
    const item = dataSnapshotRef.current.stockItems.find(s => s.id === itemId);
    applyStockChanges([{ itemId, delta, reason, note, totalCost }]);

    if (item && delta !== 0) {
      const amount = formatQuantityLabel(Math.abs(delta), item.unit);
      history.record({
        label: `${delta > 0 ? 'Added' : 'Took out'} ${amount} of ${item.name}`,
        scope: 'stock',
        confirm: reason === 'waste'
          ? `This will put ${amount} of ${item.name} back on the shelf, as though the waste had never been written off.`
          : undefined,
        undo: () => reverseStockChanges([{ itemId, delta }]),
        redo: () => applyStockChanges([{ itemId, delta, reason, note, totalCost }]),
      });
    }
    await saveImmediate();
  };

  const handleSaveStockItem = async (item: StockItem) => {
    const before = dataSnapshotRef.current.stockItems;
    const existing = before.find(s => s.id === item.id);

    if (!existing) {
      const next = [...before, item];
      setStockItems(next);
      if (item.quantity > 0) {
        setStockMovements(prev => [...prev, buildMovement({ ...item, quantity: 0 }, item.quantity, 'added', 'Opening amount')]);
      }
      history.record({
        label: `Added ${item.name} to the shelf`,
        scope: 'stock',
        // The opening line stays in the ledger either way. It describes an item
        // that is not on the shelf right now, which is exactly what it did
        // before the item was created, and is the honest record of what
        // happened.
        undo: () => setStockItems(before),
        redo: () => setStockItems(next),
      });
      await saveImmediate({ stockItems: next });
      return;
    }

    // An amount changed by hand from the editor is still a stock movement.
    const delta = item.quantity - existing.quantity;
    const next = before.map(s => (s.id === item.id ? item : s));
    setStockItems(next);
    if (delta !== 0) {
      setStockMovements(prev => [...prev, buildMovement(existing, delta, 'edit')]);
    }
    history.record({
      label: `Edited ${item.name}`,
      scope: 'stock',
      // Fields and count go back together in one step: the list is set
      // outright and the ledger is told about the count on its own.
      undo: () => applyItemsWithCorrection(before, [{ itemId: item.id, delta: -delta }], 'Edit undone'),
      redo: () => applyItemsWithCorrection(next, [{ itemId: item.id, delta }], 'Edit redone'),
    });
    await saveImmediate({ stockItems: next });
  };

  const handleSetPacket = async (
    itemId: string, size: number | null, label?: string, cost?: number,
  ) => {
    const before = dataSnapshotRef.current.stockItems;
    const target = before.find(s => s.id === itemId);
    const next = dataSnapshotRef.current.stockItems.map(s => (
      s.id === itemId
        ? {
            ...s,
            packetSize: size ?? undefined,
            packetLabel: size ? (label || s.packetLabel || 'Packet') : undefined,
            packetCost: size ? cost : undefined,
          }
        : s
    ));
    setStockItems(next);
    history.record(restoreAction(
      size ? `Set the packet size for ${target?.name ?? 'an item'}` : `Removed packets from ${target?.name ?? 'an item'}`,
      'stock', before, next, setStockItems,
    ));
    await saveImmediate({ stockItems: next });
  };

  /** Replaces every assignment for one menu item in a single step. */
  const handleSaveAssignments = async (
    menuItemId: string, rows: { stockItemId: string; quantityPerItem: number }[],
  ) => {
    const before = dataSnapshotRef.current.stockAssignments;
    const menuItem = dataSnapshotRef.current.menuItems.find(m => m.id === menuItemId);
    const next = [
      ...before.filter(a => a.menuItemId !== menuItemId),
      ...rows.map(r => ({ menuItemId, ...r })),
    ];
    setStockAssignments(next);
    history.record(restoreAction(
      `Changed what ${menuItem?.name ?? 'a menu item'} uses`,
      'stock', before, next, setStockAssignments,
    ));
    await saveImmediate({ stockAssignments: next });
  };

  /**
   * Undo appends a compensating line rather than deleting the original.
   *
   * The screen still reads as though the mistake never happened — both lines
   * are marked and hidden from the activity list — but the ledger stays
   * append-only, which is what lets historical stock be reconstructed at all.
   * Whatever undo/redo becomes later has to keep that property.
   */
  const handleUndoMovement = async (movementId: string) => {
    const movement = dataSnapshotRef.current.stockMovements.find(m => m.id === movementId);
    if (!movement || movement.reversed) return;
    const item = dataSnapshotRef.current.stockItems.find(s => s.id === movement.stockItemId);
    if (!item) return;

    const quantity = Math.max(0, item.quantity - movement.delta);
    const items = dataSnapshotRef.current.stockItems.map(s => (
      s.id === movement.stockItemId ? { ...s, quantity } : s
    ));
    const reversal: StockMovement = {
      ...buildMovement(item, -movement.delta, 'correction', 'Undone'),
      referenceType: 'movement',
      referenceId: movement.id,
      reversed: true,
    };
    const movements = dataSnapshotRef.current.stockMovements
      .map(m => (m.id === movementId ? { ...m, reversed: true } : m))
      .concat(reversal);

    setStockItems(items);
    setStockMovements(movements);

    const item2 = item;
    history.record({
      label: `Undid a stock change to ${item2.name}`,
      scope: 'stock',
      // Redoing this is itself another correction, appended like any other.
      undo: () => reverseStockChanges([{ itemId: movement.stockItemId, delta: -movement.delta }], 'Restored'),
      redo: () => reverseStockChanges([{ itemId: movement.stockItemId, delta: movement.delta }], 'Undone'),
    });

    await saveImmediate({ stockItems: items, stockMovements: movements });
  };

  /**
   * Records a count. Each line writes the difference between what was counted
   * and what the books said, as a `stocktake` movement — the books are never
   * silently overwritten, because the variance *is* the finding: waste, theft,
   * over-portioning and mis-keyed deliveries all show up here and nowhere else.
   */
  const handleStockTake = async (lines: StockTakeLine[], note: string) => {
    const changes = lines
      .filter(l => Math.abs(l.variance) > 0.0001)
      .map(l => ({
        itemId: l.stockItemId,
        delta: l.variance,
        reason: 'stocktake' as StockMovementReason,
        note,
        referenceType: 'stocktake' as const,
      }));
    if (changes.length === 0) return;
    applyStockChanges(changes);

    history.record({
      label: `Recorded a stock count of ${changes.length} item${changes.length === 1 ? '' : 's'}`,
      scope: 'stock',
      confirm:
        'A count is a measurement of what was really on the shelf, and the difference against what the app expected is where waste and over-portioning show up. Undoing it throws that finding away.',
      undo: () => reverseStockChanges(changes.map(c => ({ itemId: c.itemId, delta: c.delta })), 'Count undone'),
      redo: () => applyStockChanges(changes),
    });

    await saveImmediate();
  };

  /**
   * Clears history, then resets the in-memory state to match rather than
   * relying on a reload — the app has to be usable the moment it returns.
   */
  const handleWipeData = async (scope: WipeScope) => {
    if (scope === 'everything') {
      await clearAllData();
      setMenuItems([]);
      setCategories([]);
      setStockItems([]);
      setStockAssignments([]);
    } else {
      await clearTransactionalData();
    }
    setOrders([]);
    setParkedSessions([]);
    setActiveSessionId('');
    setStockMovements([]);
    setInventorySnapshots([]);
    setOversellEvents([]);
    setOrderCounter(1);
    setTradingSessions([]);
    setTradingEvents([]);
    setCostEntries([]);
    // Nothing on the undo stack can mean anything once the data it refers to
    // has gone, and offering to "take back" a wipe that genuinely cannot be
    // taken back would be a lie. Remembered screen positions go with it — a
    // saved period or filter over data that no longer exists is worse than none.
    history.reset();
    clearScreenState();
  };

  const handlePrintReorder = async (lines: string[]) => {
    try {
      const body = [
        '='.repeat(42),
        '              REORDER LIST',
        '='.repeat(42),
        '',
        new Date().toLocaleString(),
        '',
        ...lines.map(l => `  ${l}`),
        '',
        '='.repeat(42),
        '',
        '',
      ].join('\n');
      await invoke('print_ticket', { printerName: printerName || '', ticketText: body });
    } catch {
      // no printer configured — the list stays on screen
    }
  };

  /**
   * Empties stock deliberately — one item, or the whole shelf.
   *
   * Written as ordinary movements rather than by setting quantities to zero, so
   * what left is still visible in the history and still valued as a loss in the
   * shrinkage figure. A market that ends with thirty buns thrown away has lost
   * the price of thirty buns, and silently zeroing them would report that as
   * costing nothing.
   */
  const handleDrainStock = async (itemIds: string[], note = 'Drained') => {
    const items = dataSnapshotRef.current.stockItems.filter(
      s => itemIds.includes(s.id) && s.quantity > 0,
    );
    if (items.length === 0) return;

    const changes = items.map(item => ({
      itemId: item.id,
      delta: -item.quantity,
      reason: 'drained' as StockMovementReason,
      note,
    }));
    applyStockChanges(changes);

    history.record({
      label: items.length === 1
        ? `Drained ${items[0].name}`
        : `Drained ${items.length} stock items`,
      scope: 'stock',
      confirm: items.length === 1
        ? `This puts ${formatQuantityLabel(items[0].quantity, items[0].unit)} of ${items[0].name} back on the shelf, as though it had never been emptied.`
        : `This puts everything back on the shelf across ${items.length} items, as though the shelf had never been emptied.`,
      undo: () => reverseStockChanges(changes.map(c => ({ itemId: c.itemId, delta: c.delta })), 'Drain undone'),
      redo: () => applyStockChanges(changes),
    });

    await saveImmediate();
  };

  /**
   * Fullscreen through Tauri where it exists, through the browser where it does
   * not. The state is set either way, so the switch never reads as stuck.
   */
  const handleFullscreen = useCallback(async (next: boolean) => {
    try {
      await getCurrentWindow().setFullscreen(next);
    } catch {
      try {
        if (next) await document.documentElement.requestFullscreen();
        else await document.exitFullscreen();
      } catch {
        // Neither route is available — the setting still reflects the intent.
      }
    }
    setFullscreen(next);
  }, []);

  /** Sends one sample ticket so the printer can be proved before service. */
  const handleTestPrint = useCallback(async () => {
    const testOrder: Order = {
      id: 'test',
      seq: 0,
      orderNumber: 'TEST',
      customerName: 'Test',
      items: [{ menuItemId: 'test', name: 'Test Item', price: 100, quantity: 1 }],
      notes: 'Printer test — please ignore',
      status: 'preparing',
      subtotal: 100,
      discountAmount: 0,
      taxRate: 0,
      taxAmount: 0,
      total: 100,
      timestamp: Date.now(),
      paid: 'cash',
    };
    await invoke('print_ticket', {
      printerName: printerName || '',
      ticketText: formatTicket(testOrder, { storeName: 'Hot Dads POS — Test' }),
    });
  }, [printerName]);

  const handleAddAssignment = async (assignment: MenuItemStockAssignment) => {
    const existing = dataSnapshotRef.current.stockAssignments.find(
      a => a.menuItemId === assignment.menuItemId && a.stockItemId === assignment.stockItemId
    );
    const newAssignments = existing
      ? dataSnapshotRef.current.stockAssignments.map(a =>
          a.menuItemId === assignment.menuItemId && a.stockItemId === assignment.stockItemId
            ? { ...a, quantityPerItem: assignment.quantityPerItem }
            : a
        )
      : [...dataSnapshotRef.current.stockAssignments, assignment];
    setStockAssignments(newAssignments);
    await saveImmediate({ stockAssignments: newAssignments });
  };

  const handleRemoveAssignment = async (menuItemId: string, stockItemId: string) => {
    setStockAssignments(prev => prev.filter(
      a => !(a.menuItemId === menuItemId && a.stockItemId === stockItemId)
    ));
    await saveImmediate({ stockAssignments: dataSnapshotRef.current.stockAssignments.filter(a => !(a.menuItemId === menuItemId && a.stockItemId === stockItemId)) });
  };

  /** One requested change to one stock item, with what caused it. */
  interface StockChange {
    itemId: string;
    delta: number;
    reason: StockMovementReason;
    note?: string;
    referenceType?: StockMovement['referenceType'];
    /** Always an immutable id — an order id, never a display order number. */
    referenceId?: string;
    /** What the whole delivery cost, when this change is a receipt. */
    totalCost?: number;
  }

  /**
   * Applies a set of stock changes and records one ledger line per item.
   *
   * A receipt that carries `totalCost` also re-averages the item's cost per
   * unit: what is on the shelf at the old cost, plus what just arrived at the
   * new one, over the combined quantity. That is the only way a cost figure
   * stays true without anyone remembering to maintain it — and every margin in
   * the analytics layer depends on it.
   */
  const applyStockChanges = useCallback((changes: StockChange[]) => {
    if (changes.length === 0) return;
    const current = dataSnapshotRef.current.stockItems;
    const movements: StockMovement[] = [];

    const next = current.map(item => {
      const mine = changes.filter(c => c.itemId === item.id);
      if (mine.length === 0) return item;
      let quantity = item.quantity;
      let costPerUnit = item.costPerUnit;
      let costUpdatedAt = item.costUpdatedAt;

      for (const change of mine) {
        if (change.delta === 0) continue;
        const applied = change.delta < 0 ? -Math.min(quantity, -change.delta) : change.delta;

        let unitCost: number | undefined;
        if (change.totalCost !== undefined && change.totalCost > 0 && applied > 0) {
          unitCost = change.totalCost / applied;
          // Weighted average of what is already here and what just arrived.
          const combined = quantity + applied;
          costPerUnit = combined > 0
            ? (quantity * costPerUnit + change.totalCost) / combined
            : unitCost;
          costUpdatedAt = Date.now();
        }

        movements.push({
          ...buildMovement({ ...item, quantity }, applied, change.reason, change.note),
          referenceType: change.referenceType,
          referenceId: change.referenceId,
          unitCost,
          totalCost: change.totalCost,
        });
        quantity = Math.max(0, quantity + applied);
      }
      return { ...item, quantity, costPerUnit, costUpdatedAt };
    });

    setStockItems(next);
    if (movements.length > 0) {
      // Bounded, but far above a year of trading. Trimming is only safe at all
      // because a daily snapshot exists behind it — without one, dropping old
      // lines would make historical stock unreconstructable.
      setStockMovements(prev => [...prev, ...movements].slice(-20000));
    }
  }, []);

  /** Consumes a cart's ingredients, linked to the order by its immutable id. */
  const deductStockForCart = useCallback((cart: CartItem[], orderId: string, note?: string) => {
    const usage = usageForCart(cart, menuItems, stockAssignments);
    applyStockChanges([...usage].map(([itemId, used]) => ({
      itemId,
      delta: -used,
      reason: 'sold' as StockMovementReason,
      note,
      referenceType: 'order' as const,
      referenceId: orderId,
    })));
  }, [applyStockChanges, menuItems, stockAssignments]);

  /** Gives a voided order's ingredients back, linked to the same order. */
  const returnStockForCart = useCallback((cart: CartItem[], orderId: string, note?: string) => {
    const usage = usageForCart(cart, menuItems, stockAssignments);
    applyStockChanges([...usage].map(([itemId, used]) => ({
      itemId,
      delta: used,
      reason: 'returned' as StockMovementReason,
      note,
      referenceType: 'order' as const,
      referenceId: orderId,
    })));
  }, [applyStockChanges, menuItems, stockAssignments]);

  const printOrderIfNeeded = useCallback(async (order: Order) => {
    if (!autoPrint) return;
    if (order.status !== 'preparing') return;
    try {
      await printOrder(order, printerName || undefined);
    } catch {
      // print unavailable or failed silently
    }
  }, [autoPrint, printerName]);

  /* ------------------------------------------------------------------ undo */

  /**
   * Records a change to the board and how to take it back.
   *
   * The board is pure status — nothing here moves stock or money — so the
   * reversal really is "put the old array back", and the previous value is
   * captured here at the moment of the change rather than reconstructed later.
   */
  const updateOrders = useCallback((
    label: string,
    updater: (prev: Order[]) => Order[],
    options?: { confirm?: string; silent?: boolean },
  ) => {
    const before = orders;
    const after = updater(before);
    setOrders(after);
    if (!options?.silent) {
      history.record(restoreAction(label, 'board', before, after, setOrders, options?.confirm));
    }
  }, [orders, history]);

  /**
   * Puts the shelf back where it was by appending correcting lines.
   *
   * This is the whole reason undo stores actions rather than snapshots. The
   * stock ledger is append-only on purpose: every line records the level it
   * left behind, which is what makes it possible to say what was on the shelf
   * at any past moment. Undoing a delivery by deleting the line that recorded
   * it would quietly rewrite that history — and worse, would leave the count on
   * the shelf disagreeing with the sum of the lines that produced it. So an
   * undo posts the opposite movement, exactly as a person correcting a
   * stocktake by hand would.
   */
  const reverseStockChanges = useCallback((
    changes: { itemId: string; delta: number }[],
    note = 'Undone',
  ) => {
    applyStockChanges(changes
      .filter(c => c.delta !== 0)
      .map(c => ({ itemId: c.itemId, delta: -c.delta, reason: 'correction' as StockMovementReason, note })));
  }, [applyStockChanges]);

  /**
   * Replaces the item list outright and posts the ledger lines that account for
   * however much the counts moved.
   *
   * Used where more than the quantity changed — an item renamed and recounted
   * in the same edit, say. `reverseStockChanges` cannot serve here because it
   * works out the new list from the old one, so it would faithfully undo the
   * count while leaving the rename in place.
   */
  const applyItemsWithCorrection = useCallback((
    nextItems: StockItem[],
    corrections: { itemId: string; delta: number }[],
    note: string,
  ) => {
    const previous = dataSnapshotRef.current.stockItems;
    setStockItems(nextItems);
    const lines = corrections
      .filter(c => c.delta !== 0)
      .map(c => {
        const from = previous.find(s => s.id === c.itemId);
        return from ? buildMovement(from, c.delta, 'correction', note) : null;
      })
      .filter((m): m is StockMovement => m !== null);
    if (lines.length > 0) setStockMovements(prev => [...prev, ...lines]);
  }, []);

  /** Wraps a setting change so it can be taken back like anything else. */
  const recordSetting = useCallback(<T,>(
    label: string, before: T, after: T, apply: (value: T) => void,
  ) => {
    apply(after);
    if (before !== after) history.record(restoreAction(label, 'settings', before, after, apply));
  }, [history]);

  /**
   * Says why something cannot be taken back, and what to do instead.
   *
   * Silence would be worse than the limitation: pressing Ctrl+Z after ringing
   * an order up and having the *previous* action disappear instead is how
   * somebody loses a ticket move they had not noticed was still on the stack.
   */
  const explainedOnce = useRef(new Set<string>());
  const explainNotUndoable = useCallback((what: string, instead: string, topic = what) => {
    // The explanation is worth saying, but not on every ticket. After the first
    // time it becomes nagging, so what remains is a plain confirmation that the
    // thing happened.
    const first = !explainedOnce.current.has(topic);
    explainedOnce.current.add(topic);
    toast.show(what, {
      kind: first ? 'warning' : 'success',
      detail: first ? instead : undefined,
      duration: first ? 4600 : 1800,
    });
  }, [toast]);

  /** Tax rate in force right now; 0 whenever the setting is switched off. */
  const activeTaxRate = taxEnabled ? Math.max(0, parseFloat(taxRateInput) || 0) : 0;

  // Derived state from active session
  const activeSession = parkedSessions.find(s => s.id === activeSessionId) || null;
  const cart = activeSession?.cart ?? [];
  const notes = activeSession?.notes ?? '';

  /**
   * Stock as it will stand once this cart is paid for. Estimates are taken
   * against this rather than against the shelf, so ringing up the last three
   * burgers warns on the fourth rather than after the money is taken.
   */
  const projectedStock = useMemo(() => {
    const usage = usageForCart(cart, menuItems, stockAssignments);
    if (usage.size === 0) return stockItems;
    return stockItems.map(item => {
      const used = usage.get(item.id) ?? 0;
      return used ? { ...item, quantity: item.quantity - used } : item;
    });
  }, [cart, menuItems, stockAssignments, stockItems]);

  /** How many *more* of each menu item the remaining stock allows. */
  const remainingEstimates = useMemo(() => {
    const map = new Map<string, ProductEstimate>();
    for (const item of menuItems) {
      map.set(item.id, estimateProduct(item, menuItems, stockAssignments, projectedStock));
    }
    return map;
  }, [menuItems, stockAssignments, projectedStock]);

  /** The estimate for a menu item that cannot be made any more, else null. */
  const soldOutEstimate = (menuItem: MenuItem): ProductEstimate | null => {
    const estimate = remainingEstimates.get(menuItem.id);
    if (!estimate || estimate.unassigned || estimate.count > 0) return null;
    return estimate;
  };

  /** Set while a sold-out item is waiting for "add anyway" or "cancel". */
  const [soldOutPrompt, setSoldOutPrompt] = useState<
    { menuItem: MenuItem; estimate: ProductEstimate } | null
  >(null);
  /** Low-stock names the user has already acknowledged in Order Mode. */
  const [dismissedLowStock, setDismissedLowStock] = useState<string>('');

  const handleOrdersNavigation = () => {
    // When on order mode, go to all orders. Otherwise, go to order mode.
    if (currentView === 'orderMode') {
      navigateTo('allOrders');
    } else {
      navigateTo('orderMode');
    }
  };

  const updateSessionById = (sessionId: string, updater: (session: ParkedSession) => ParkedSession) => {
    setParkedSessions(prev => prev.map(s =>
      s.id === sessionId ? { ...updater(s), lastModified: Date.now() } : s
    ).sort((a, b) => b.lastModified - a.lastModified));
  };

  const updateActiveSession = (updater: (session: ParkedSession) => ParkedSession) => {
    updateSessionById(activeSessionId, updater);
  };

  const nextSessionLabel = () => {
    const usedLabels = new Set(parkedSessions.map(s => s.label));
    let nextLabel = 'A';
    while (usedLabels.has(nextLabel)) {
      nextLabel = String.fromCharCode(nextLabel.charCodeAt(0) + 1);
    }
    return nextLabel;
  };

  /**
   * Returns the id of the session to write into, creating an empty one first if
   * nothing is active. Lets notes and discounts be entered before any menu item.
   */
  const ensureActiveSession = (): string => {
    if (activeSessionId) return activeSessionId;
    const label = nextSessionLabel();
    const newSession: ParkedSession = {
      id: label,
      label,
      cart: [],
      notes: '',
      lastModified: Date.now(),
    };
    setParkedSessions(prev => [newSession, ...prev]);
    setActiveSessionId(label);
    return label;
  };

  /**
   * Tapping a menu item the kitchen cannot make asks first. It never blocks —
   * the shop may well have stock the app does not know about — but it says what
   * ran out so the choice is informed.
   */
  const addToCart = (menuItem: MenuItem) => {
    const soldOut = soldOutEstimate(menuItem);
    if (soldOut) {
      setSoldOutPrompt({ menuItem, estimate: soldOut });
      return;
    }
    addToCartUnchecked(menuItem);
  };

  /**
   * Records a sale the stock could not support, at the moment it happened.
   *
   * This is demand that exceeded supply — normally it has to be inferred from
   * suspicious runs of zero sales, and a forecast trained on the raw numbers
   * systematically under-predicts exactly the items that keep running out.
   * Here it is measured directly.
   */
  const logOversell = (menuItem: MenuItem, estimate: ProductEstimate) => {
    setOversellEvents(prev => [...prev, {
      id: `os-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      menuItemId: menuItem.id,
      menuItemName: menuItem.name,
      quantity: 1,
      bottleneckStockItemId: estimate.bottleneck?.stockItem.id,
      timestamp: Date.now(),
    }]);
  };

  /**
   * Attaches the oversells logged while this cart was being built to the order
   * that resulted, and stamps the count on the line. Without the link they are
   * free-floating events that cannot be drilled into.
   */
  const linkOversellsToOrder = (order: Order): Order => {
    const pending = dataSnapshotRef.current.oversellEvents.filter(e => !e.orderId);
    if (pending.length === 0) return order;
    const byMenuItem = new Map<string, number>();
    for (const event of pending) {
      byMenuItem.set(event.menuItemId, (byMenuItem.get(event.menuItemId) ?? 0) + event.quantity);
    }
    setOversellEvents(prev => prev.map(e => (e.orderId ? e : { ...e, orderId: order.id })));
    return {
      ...order,
      items: order.items.map(item => {
        const oversold = byMenuItem.get(item.menuItemId);
        return oversold ? { ...item, oversoldQuantity: oversold } : item;
      }),
    };
  };

  /**
   * Records a change to the parked orders.
   *
   * The cart, the notes, the discount and the parked list are all one array, so
   * one snapshot covers every change that can be made in the ordering panel.
   */
  const recordCart = useCallback((label: string, before: ParkedSession[]) => {
    // Read back on the next tick: the setters above have queued but not yet
    // applied, and the "after" state has to be the one that actually results.
    window.setTimeout(() => {
      const after = dataSnapshotRef.current.parkedSessions;
      if (after === before) return;
      history.record(restoreAction(label, 'cart', before, after, setParkedSessions));
    }, 0);
  }, [history]);

  const addToCartUnchecked = (menuItem: MenuItem) => {
    const before = dataSnapshotRef.current.parkedSessions;
    const sessionId = ensureActiveSession();
    updateSessionById(sessionId, session => {
      const existing = session.cart.find(item => item.menuItemId === menuItem.id);
      if (existing) {
        return {
          ...session,
          cart: session.cart.map(item =>
            item.menuItemId === menuItem.id ? { ...item, quantity: item.quantity + 1 } : item
          )
        };
      }
      return {
        ...session,
        cart: [...session.cart, {
          menuItemId: menuItem.id,
          name: menuItem.name,
          price: menuItem.price,
          quantity: 1,
          dealItems: menuItem.dealItems
        }]
      };
    });
    recordCart(`Added ${menuItem.name} to the order`, before);
  };

  const removeFromCart = (menuItemId: string) => {
    const before = dataSnapshotRef.current.parkedSessions;
    const name = cart.find(i => i.menuItemId === menuItemId)?.name ?? 'an item';
    updateActiveSession(session => {
      const existing = session.cart.find(item => item.menuItemId === menuItemId);
      if (existing && existing.quantity > 1) {
        return {
          ...session,
          cart: session.cart.map(item =>
            item.menuItemId === menuItemId ? { ...item, quantity: item.quantity - 1 } : item
          )
        };
      }
      return {
        ...session,
        cart: session.cart.filter(item => item.menuItemId !== menuItemId)
      };
    });
    recordCart(`Took ${name} off the order`, before);
  };

  const updateNotes = (newNotes: string) => {
    // Notes can be typed before any item exists — spin up a session if needed.
    const sessionId = ensureActiveSession();
    updateSessionById(sessionId, session => ({ ...session, notes: newNotes }));
  };

  const applyDiscount = (discount: Discount) => {
    const before = dataSnapshotRef.current.parkedSessions;
    const sessionId = ensureActiveSession();
    updateSessionById(sessionId, session => ({ ...session, discount }));
    recordCart(
      discount.kind === 'percent'
        ? `Took ${discount.value}% off the order`
        : `Took Rs ${discount.value} off the order`,
      before,
    );
  };

  const clearDiscount = () => {
    if (!activeSessionId) return;
    const before = dataSnapshotRef.current.parkedSessions;
    updateActiveSession(session => ({ ...session, discount: undefined }));
    recordCart('Removed the discount', before);
  };

  const requestDiscountPin = (onGranted: () => void) => {
    setDiscountPinInput('');
    setDiscountPinError(false);
    setDiscountPinPrompt({ onGranted });
  };

  const submitDiscountPin = () => {
    if (discountPinInput === currentRevenuePin) {
      const granted = discountPinPrompt?.onGranted;
      setDiscountPinPrompt(null);
      setDiscountPinInput('');
      setDiscountPinError(false);
      granted?.();
    } else {
      setDiscountPinError(true);
    }
  };

  const clearCart = () => {
    const before = dataSnapshotRef.current.parkedSessions;
    updateActiveSession(session => ({ ...session, cart: [], notes: '', discount: undefined }));
    setCashReceived('');
    if (cart.length > 0) recordCart('Emptied the order', before);
  };

  const createNewSession = () => {
    const before = dataSnapshotRef.current.parkedSessions;
    const label = nextSessionLabel();
    const newSession: ParkedSession = {
      id: label,
      label,
      cart: [],
      notes: '',
      lastModified: Date.now()
    };
    setParkedSessions(prev => [newSession, ...prev]);
    setActiveSessionId(label);
    setCashReceived('');
    recordCart(`Started order ${label}`, before);
  };

  const switchToSession = (sessionId: string) => {
    setActiveSessionId(sessionId);
    setCashReceived('');
  };

  /** Drops a session. An edit session is cancelled, never deleting the order behind it. */
  const deleteSession = (sessionId: string) => {
    const session = parkedSessions.find(s => s.id === sessionId);
    if (session?.editingOrderId) {
      cancelEdit(sessionId);
      return;
    }
    const before = dataSnapshotRef.current.parkedSessions;
    setParkedSessions(prev => prev.filter(s => s.id !== sessionId));
    if (activeSessionId === sessionId) {
      const remaining = parkedSessions.filter(s => s.id !== sessionId);
      setActiveSessionId(remaining.length > 0 ? remaining[0].id : '');
    }
    recordCart(`Threw away parked order ${session?.label ?? sessionId}`, before);
  };

  /**
   * Freezes each line's ingredient cost at the moment of sale.
   *
   * Historical margin has to be a fact, not a recalculation — otherwise editing
   * a recipe or a supplier price silently rewrites last month's profit. Lines
   * whose ingredients are not all costed are left undefined rather than being
   * given a partial figure, so "not costed" never masquerades as "free".
   */
  const costCart = (items: CartItem[]): CartItem[] => items.map(item => {
    if (item.unitCost !== undefined) return item;   // already frozen; never restate
    const menuItem = menuItems.find(mi => mi.id === item.menuItemId);
    if (!menuItem) return item;
    const resolved = unitCostFor(menuItem, menuItems, stockAssignments, stockItems);
    return resolved.complete ? { ...item, unitCost: resolved.cost } : item;
  });

  /**
   * Takes the next ticket number in the live session, or nothing when none is
   * running.
   *
   * The counter is read from a ref rather than from state because two orders
   * can be rung up inside a single React tick, and a stale closure would hand
   * both of them the same number — the one thing session numbering exists to
   * prevent. The ref is written here and mirrored from state on every render,
   * so it is never behind.
   */
  const claimSessionTicket = (): Pick<Order, 'sessionId' | 'sessionTicket'> => {
    const live = tradingSessionsRef.current.find(s => s.status === 'active');
    if (!live) return {};
    const ticket = live.ticketCounter + 1;
    tradingSessionsRef.current = tradingSessionsRef.current.map(s =>
      s.id === live.id ? { ...s, ticketCounter: ticket } : s);
    setTradingSessions(prev => prev.map(s =>
      s.id === live.id ? { ...s, ticketCounter: Math.max(s.ticketCounter, ticket) } : s));
    return { sessionId: live.id, sessionTicket: ticket };
  };

  const buildOrder = (status: OrderStatus, paid?: 'cash' | 'transfer'): Order | null => {
    if (cart.length === 0) return null;
    const totals = computeTotals(cart, activeSession?.discount, activeTaxRate);
    return {
      id: newOrderId(),
      seq: orderCounter,
      orderNumber: formatOrderNumber(orderCounter),
      ...claimSessionTicket(),
      customerName: 'Customer',
      items: costCart(cart),
      notes,
      status,
      subtotal: totals.subtotal,
      discount: activeSession?.discount,
      discountAmount: totals.discountAmount,
      taxRate: totals.taxRate,
      taxAmount: totals.taxAmount,
      total: totals.total,
      timestamp: Date.now(),
      paid,
    };
  };

  const checkout = async (paymentType: 'cash' | 'transfer') => {
    const built = buildOrder('preparing', paymentType);
    if (!built) return;
    const order = linkOversellsToOrder(built);
    deductStockForCart(order.items, order.id, `Order #${order.orderNumber}`);
    // Deliberately not on the undo stack. Taking money is the one thing in the
    // app that has a consequence outside it, and the supported way to reverse
    // a sale is to void the ticket — which keeps the record that it happened,
    // gives the stock back, and leaves the day's history true.
    setOrders(prev => [...prev, order]);
    setOrderCounter(c => c + 1);
    explainNotUndoable(
      `Order #${order.orderNumber} rung up`,
      'Rung-up orders are not undone with Ctrl+Z. Void it from All Orders if it was a mistake.',
      'checkout',
    );
    clearCart();
    if (activeSessionId) {
      setParkedSessions(prev => prev.filter(s => s.id !== activeSessionId));
      setActiveSessionId('');
    }
    printOrderIfNeeded(order);
    await saveImmediate();
  };

  const moveOrder = (orderId: string, status: OrderStatus, paid?: 'cash' | 'transfer') => {
    // Frozen while being edited — the edit session owns it until commit or cancel.
    if (parkedSessions.some(s => s.editingOrderId === orderId)) return;
    // The grill has a fixed number of slots.
    if (status === 'grill' && !orders.some(o => o.id === orderId && o.status === 'grill')
        && orders.filter(o => o.status === 'grill').length >= grillCapacityRef.current) {
      return;
    }
    let movedOrder: Order | undefined;
    const now = Date.now();
    const moving = orders.find(o => o.id === orderId);
    const STAGE_NAME: Record<OrderStatus, string> = {
      preparing: 'Preparing',
      grill: 'the grill',
      ready: 'Ready',
      completed: 'Completed',
      parked: 'Parked',
    };
    updateOrders(`Moved #${moving?.orderNumber ?? '—'} to ${STAGE_NAME[status]}`, prev => {
      const order = prev.find(o => o.id === orderId);
      if (order && status === 'preparing') {
        movedOrder = { ...order, status, paid: paid ?? order.paid };
      }
      return prev.map(o => {
        if (o.id !== orderId) return o;
        // Stamp the first time a ticket reaches each stage. First, not last:
        // a ticket bounced back to Preparing and forward again should not read
        // as having been cooked twice as fast.
        return {
          ...o,
          status,
          paid: paid ?? o.paid,
          grilledAt: status === 'grill' ? o.grilledAt ?? now : o.grilledAt,
          readyAt: status === 'ready' ? o.readyAt ?? now : o.readyAt,
          completedAt: status === 'completed' ? o.completedAt ?? now : o.completedAt,
        };
      });
    });
    if (movedOrder) {
      printOrderIfNeeded(movedOrder);
    }
  };

  /**
   * Pulls an order back into the ordering area as an edit session. The order
   * stays on the board, frozen and marked, so the kitchen never loses sight of it.
   */
  const startEditingOrder = (orderId: string) => {
    // Already open for editing — just jump to that session.
    const existing = parkedSessions.find(s => s.editingOrderId === orderId);
    if (existing) {
      setActiveSessionId(existing.id);
      if (currentView !== 'orderMode') navigateTo('orderMode');
      return;
    }

    const order = orders.find(o => o.id === orderId);
    if (!order) return;

    const sessionId = `edit-${order.id}`;
    const editSession: ParkedSession = {
      id: sessionId,
      // The number the kitchen is calling right now, not the lifetime one —
      // otherwise the chip in the sidebar and the ticket on the board disagree
      // about which order is being edited.
      label: displayNumber(
        order,
        tradingSessionsRef.current.find(s => s.status === 'active')?.id ?? null,
      ),
      cart: order.items.map(item => ({ ...item })),
      notes: order.notes,
      lastModified: Date.now(),
      discount: order.discount,
      editingOrderId: order.id,
    };

    // The order keeps its status and stays where the kitchen expects it.
    setParkedSessions(prev => [editSession, ...prev.filter(s => s.id !== sessionId)]);
    setActiveSessionId(sessionId);
    setCashReceived('');
    if (currentView !== 'orderMode') navigateTo('orderMode');
  };

  const cancelEdit = (sessionId: string) => {
    const session = parkedSessions.find(s => s.id === sessionId);
    if (!session?.editingOrderId) return;

    setParkedSessions(prev => prev.filter(s => s.id !== sessionId));
    if (activeSessionId === sessionId) {
      const remaining = parkedSessions.filter(s => s.id !== sessionId);
      setActiveSessionId(remaining.length > 0 ? remaining[0].id : '');
    }
    setCashReceived('');
  };

  /** Writes an edit back onto the original order, keeping its number and sequence. */
  const commitEdit = async (session: ParkedSession, paymentType: 'cash' | 'transfer') => {
    const original = orders.find(o => o.id === session.editingOrderId);
    const totals = computeTotals(session.cart, session.discount, activeTaxRate);

    // Stock moves by the difference, so items removed during an edit come back.
    const before = usageForCart(original?.items ?? [], menuItems, stockAssignments);
    const after = usageForCart(session.cart, menuItems, stockAssignments);
    const touched = new Set([...before.keys(), ...after.keys()]);
    applyStockChanges([...touched].map(itemId => {
      const delta = (before.get(itemId) ?? 0) - (after.get(itemId) ?? 0);
      return {
        itemId,
        delta,
        reason: (delta >= 0 ? 'returned' : 'sold') as StockMovementReason,
        note: `Edit of order #${original?.orderNumber ?? session.label}`,
        referenceType: 'order' as const,
        referenceId: original?.id ?? session.editingOrderId!,
      };
    }).filter(c => c.delta !== 0));

    const updated: Order = {
      id: original?.id ?? session.editingOrderId!,
      seq: original?.seq ?? orderCounter,
      orderNumber: original?.orderNumber ?? session.label,
      customerName: original?.customerName ?? 'Customer',
      items: costCart(session.cart),
      notes: session.notes,
      status: original?.status ?? 'preparing',
      subtotal: totals.subtotal,
      discount: session.discount,
      discountAmount: totals.discountAmount,
      taxRate: totals.taxRate,
      taxAmount: totals.taxAmount,
      total: totals.total,
      timestamp: original?.timestamp ?? Date.now(),
      editedAt: Date.now(),
      editCount: (original?.editCount ?? 0) + 1,
      paid: paymentType,
      /**
       * The session the order was taken in, carried through the edit.
       *
       * This object is rebuilt field by field rather than spread from the
       * original, and these two were simply missing from the list. The visible
       * symptom was that editing a ticket mid-service made it fall back to its
       * lifetime number — but the real damage was quieter: an order with no
       * session id is excluded from every session-scoped figure, so each edit
       * silently subtracted a sale from the session's takings, its ticket
       * count and its revenue per hour. An edit changes what was ordered. It
       * does not change which service it was ordered in.
       */
      sessionId: original?.sessionId,
      sessionTicket: original?.sessionTicket,
      // An edit is not a new ticket: whatever stages it already reached stand.
      voidedAt: original?.voidedAt,
      voidReason: original?.voidReason,
      grilledAt: original?.grilledAt,
      readyAt: original?.readyAt,
      completedAt: original?.completedAt,
    };

    // Not on the undo stack, for the same reason a checkout is not: it settles
    // money and it has already moved stock both ways. Editing it again is the
    // way to change it back.
    setOrders(prev => {
      const exists = prev.some(o => o.id === updated.id);
      // The order may have been deleted mid-edit; put it back rather than losing it.
      return exists ? prev.map(o => (o.id === updated.id ? updated : o)) : [...prev, updated];
    });
    explainNotUndoable(
      `Order #${updated.orderNumber} saved`,
      'Changes to a rung-up order are not undone with Ctrl+Z. Open it for editing again to change it further.',
      'edit',
    );

    if (autoPrint) {
      try {
        await printOrder(updated, printerName || undefined, { edited: true });
      } catch {
        // print unavailable or failed silently
      }
    }

    setParkedSessions(prev => prev.filter(s => s.id !== session.id));
    if (activeSessionId === session.id) setActiveSessionId('');
    setCashReceived('');
    await saveImmediate();
  };

  const checkoutParkedSession = async (sessionId: string, paymentType: 'cash' | 'transfer') => {
    const session = parkedSessions.find(s => s.id === sessionId);
    if (!session || session.cart.length === 0) return;

    if (session.editingOrderId) {
      await commitEdit(session, paymentType);
      return;
    }

    const totals = computeTotals(session.cart, session.discount, activeTaxRate);
    const draft: Order = {
      id: newOrderId(),
      seq: orderCounter,
      orderNumber: formatOrderNumber(orderCounter),
      ...claimSessionTicket(),
      customerName: 'Customer',
      items: costCart(session.cart),
      notes: session.notes,
      status: 'preparing',
      subtotal: totals.subtotal,
      discount: session.discount,
      discountAmount: totals.discountAmount,
      taxRate: totals.taxRate,
      taxAmount: totals.taxAmount,
      total: totals.total,
      timestamp: Date.now(),
      paid: paymentType,
    };

    const newOrder = linkOversellsToOrder(draft);
    deductStockForCart(newOrder.items, newOrder.id, `Order #${newOrder.orderNumber}`);
    setOrders(prev => [...prev, newOrder]);
    setOrderCounter(c => c + 1);
    explainNotUndoable(
      `Order #${newOrder.orderNumber} rung up`,
      'Rung-up orders are not undone with Ctrl+Z. Void it from All Orders if it was a mistake.',
      'checkout',
    );

    printOrderIfNeeded(newOrder);

    setParkedSessions(prev => prev.filter(s => s.id !== sessionId));
    if (activeSessionId === sessionId) {
      setActiveSessionId('');
    }
    await saveImmediate();
  };

  /* ------------------------------------------------------------- sessions */

  /**
   * Only one session takes orders at a time.
   *
   * Starting one while another is live would leave two claims on the same
   * ticket number, so any live session is paused first rather than refused —
   * the till should never be blocked by a session someone forgot to close.
   */
  const handleStartSession = (name: string) => {
    const now = Date.now();
    setTradingSessions(prev => {
      const parkedFirst = prev.map(s => (s.status === 'active' ? pauseSession(s, now) : s));
      return [...parkedFirst, startSession(prev, now, name)];
    });
    setCompletedFilter('session');
    explainNotUndoable(
      `${name || 'Session'} started`,
      'Starting a session is not undone with Ctrl+Z — it hands out kitchen ticket numbers. End it instead if it was a mistake.',
    );
  };

  const handlePauseSession = () => {
    const now = Date.now();
    setTradingSessions(prev => prev.map(s => (s.status === 'active' ? pauseSession(s, now) : s)));
    setCompletedFilter('all');
  };

  const handleResumeSession = (sessionId: string) => {
    const now = Date.now();
    setTradingSessions(prev => prev.map(s => {
      if (s.id === sessionId) return resumeSession(s, now);
      return s.status === 'active' ? pauseSession(s, now) : s;
    }));
    setCompletedFilter('session');
  };

  /**
   * Ends the live session. Its orders keep their session id and their session
   * ticket — the numbers simply stop being preferred for display, so the board
   * shows true order numbers again without a single row being rewritten.
   */
  const handleEndSession = () => {
    const now = Date.now();
    setTradingSessions(prev => prev.map(s => (s.status === 'active' ? closeSession(s, now) : s)));
    setCompletedFilter('all');
    explainNotUndoable(
      'Session ended',
      'Nothing has been deleted — every order keeps its session. Resume it from the session bar if you meant to carry on.',
    );
  };

  const handleRenameSession = (sessionId: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const before = dataSnapshotRef.current.tradingSessions;
    const next = before.map(s => (s.id === sessionId ? { ...s, name: trimmed } : s));
    setTradingSessions(next);
    history.record(restoreAction(
      `Renamed a session to ${trimmed}`, 'session', before, next, setTradingSessions,
      undefined, `session:${sessionId}:name`,
    ));
  };

  /** Groups sessions under one event, creating the event as a side effect. */
  const handleGroupSessions = (sessionIds: string[], eventName: string) => {
    if (sessionIds.length < 2) return;
    const picked = tradingSessions.filter(s => sessionIds.includes(s.id));
    const fallback = picked.length > 0
      ? `${picked[0].name.split('·')[0].trim() || 'Event'} run`
      : 'Event';
    const beforeEvents = dataSnapshotRef.current.tradingEvents;
    const beforeSessions = dataSnapshotRef.current.tradingSessions;
    const event = createEvent(eventName || fallback, Date.now());
    const afterEvents = [...beforeEvents, event];
    const afterSessions = beforeSessions.map(s =>
      sessionIds.includes(s.id) ? { ...s, eventId: event.id } : s);
    setTradingEvents(afterEvents);
    setTradingSessions(afterSessions);
    history.record({
      label: `Grouped ${sessionIds.length} sessions into ${event.name}`,
      scope: 'session',
      undo: () => { setTradingEvents(beforeEvents); setTradingSessions(beforeSessions); },
      redo: () => { setTradingEvents(afterEvents); setTradingSessions(afterSessions); },
    });
  };

  /**
   * Detaches a session from its event, and drops the event once it is empty.
   *
   * An event with no sessions is not a fact about the business, only a leftover
   * label, and leaving them behind fills the analytics scope picker with
   * nothing.
   */
  const handleUngroupSession = (sessionId: string) => {
    const target = tradingSessions.find(s => s.id === sessionId);
    if (!target?.eventId) return;
    const eventId = target.eventId;
    const beforeSessions = dataSnapshotRef.current.tradingSessions;
    const beforeEvents = dataSnapshotRef.current.tradingEvents;
    const remaining = beforeSessions.filter(s => s.eventId === eventId && s.id !== sessionId);
    const afterSessions = beforeSessions.map(s =>
      s.id === sessionId ? { ...s, eventId: undefined } : s);
    const afterEvents = remaining.length === 0
      ? beforeEvents.filter(e => e.id !== eventId)
      : beforeEvents;
    setTradingSessions(afterSessions);
    if (afterEvents !== beforeEvents) setTradingEvents(afterEvents);
    history.record({
      label: `Took ${target.name} out of its event`,
      scope: 'session',
      undo: () => { setTradingSessions(beforeSessions); setTradingEvents(beforeEvents); },
      redo: () => { setTradingSessions(afterSessions); setTradingEvents(afterEvents); },
    });
  };

  /* ----------------------------------------------------------------- costs */

  /**
   * Logs a cost against whichever session is live.
   *
   * Costs entered outside a session carry no session id and count only towards
   * date-scoped figures — better than attaching them to the nearest session by
   * time, which would put Monday's gas bill inside Sunday's break-even.
   */
  const handleAddCost = (
    amount: number,
    note: string,
    kind: CostEntry['kind'],
    target?: { sessionId?: string; eventId?: string },
  ) => {
    if (!(amount > 0)) return;
    const live = tradingSessions.find(s => s.status === 'active');
    const before = dataSnapshotRef.current.costEntries;
    // An explicit target wins; otherwise it lands on whatever is trading now.
    // A cost carries one or the other, never both — an entry that belonged to a
    // session *and* to its event would be counted twice at event level.
    const attach = target?.eventId
      ? { eventId: target.eventId }
      : target?.sessionId
        ? { sessionId: target.sessionId }
        : { sessionId: live?.id };
    const next = [...before, {
      id: newCostId(),
      ...attach,
      amount,
      note: note.trim(),
      kind,
      timestamp: Date.now(),
    }];
    setCostEntries(next);
    history.record(restoreAction(
      `Logged a cost of Rs ${Math.round(amount)}`, 'costs', before, next, setCostEntries,
    ));
  };

  const handleDeleteCost = (id: string) => {
    const before = dataSnapshotRef.current.costEntries;
    const removed = before.find(c => c.id === id);
    const next = before.filter(c => c.id !== id);
    setCostEntries(next);
    history.record(restoreAction(
      `Removed a cost of Rs ${Math.round(removed?.amount ?? 0)}`, 'costs', before, next, setCostEntries,
    ));
  };

  /**
   * Cancels an order without erasing it.
   *
   * The row stays — that a sale was rung up and then cancelled is itself a fact
   * worth keeping — but it leaves the board, stops counting towards revenue,
   * gives its ingredients back, and is skipped when the live orders are
   * resequenced. Deleting instead meant yesterday's takings changed whenever
   * someone tidied the board, and left the stock ledger holding a deduction
   * whose order no longer existed.
   */
  const voidOrder = async (orderId: string, reason?: string) => {
    if (pendingDeleteId === orderId) {
      const target = dataSnapshotRef.current.orders.find(o => o.id === orderId);
      if (!target || target.voidedAt) {
        setPendingDeleteId(null);
        return;
      }
      const beforeOrders = dataSnapshotRef.current.orders;
      const beforeCounter = orderCounter;

      returnStockForCart(target.items, target.id, `Void of order #${target.orderNumber}`);
      const voided: Order = { ...target, voidedAt: Date.now(), voidReason: reason };
      const remaining = renumberOrders(
        dataSnapshotRef.current.orders.map(o => (o.id === orderId ? voided : o))
      );
      const nextCounter = liveOrderCount(remaining) + 1;
      setOrders(remaining);
      setOrderCounter(nextCounter);
      setPendingDeleteId(null);

      /**
       * Undoing a void is not simply putting the row back. Voiding gave the
       * ingredients to the shelf, so restoring the sale has to take them off
       * again — and the numbering, which was closed up when the ticket left the
       * board, has to open back out. All three move together or none of them
       * mean anything.
       */
      history.record({
        label: `Voided order #${target.orderNumber}`,
        scope: 'board',
        confirm: `This puts order #${target.orderNumber} back on the board as a live sale, counts it towards your takings again, and takes its ingredients back off the shelf.`,
        undo: () => {
          setOrders(beforeOrders);
          setOrderCounter(beforeCounter);
          deductStockForCart(target.items, target.id, `Void of #${target.orderNumber} undone`);
        },
        redo: () => {
          setOrders(remaining);
          setOrderCounter(nextCounter);
          returnStockForCart(target.items, target.id, `Void of order #${target.orderNumber}`);
        },
      });

      await saveImmediate({ orders: remaining, orderCounter: nextCounter });
    } else {
      setPendingDeleteId(orderId);
      setTimeout(() => {
        setPendingDeleteId(curr => (curr === orderId ? null : curr));
      }, 3000);
    }
  };

  /** Routes a ticket action-menu gesture to the right handler. */
  const handleTicketAction = (orderId: string, action: TicketAction) => {
    if (action === 'edit') {
      startEditingOrder(orderId);
      return;
    }
    const statusFor: Record<Exclude<TicketAction, 'edit'>, BoardStatus> = {
      completed: 'completed',
      grill: 'grill',
      ready: 'ready',
      preparing: 'preparing',
    };
    moveOrder(orderId, statusFor[action]);
  };

  const handleAddMenuItem = async (name: string, price: number, category: string) => {
    if (!name.trim() || !(price > 0)) return;
    const before = dataSnapshotRef.current.menuItems;
    const newItem: MenuItem = {
      id: String(Date.now()),
      name: name.trim(),
      price,
      showInOrderMode: true,
      category,
    };
    const next = [...before, newItem];
    setMenuItems(next);
    history.record(restoreAction(`Added ${newItem.name} to the menu`, 'menu', before, next, setMenuItems));
    await saveImmediate({ menuItems: next });
  };

  const calcDealPrice = (dealItems: DealItem[]) =>
    dealItems.reduce((sum, di) => {
      const match = menuItems.find(mi => mi.name === di.name);
      return sum + (match ? match.price * di.quantity : 0);
    }, 0);

  const updateMenuItem = (id: string, patch: Partial<MenuItem>) => {
    const before = dataSnapshotRef.current.menuItems;
    const target = before.find(mi => mi.id === id);
    /**
     * A deal's price is no longer recalculated whenever its contents change.
     *
     * It used to be, which meant a deal could not be priced at all: typing a
     * price and then adjusting what was in the deal silently overwrote it with
     * the sum of the components — which is the one price a deal is never sold
     * at. The components total is still offered, as a button, so the common
     * case stays one tap.
     */
    const next = before.map(mi => (mi.id === id ? { ...mi, ...patch } : mi));
    setMenuItems(next);
    history.record(restoreAction(
      `Edited ${target?.name ?? 'a menu item'}`,
      'menu', before, next, setMenuItems, undefined,
      // A run of keystrokes in one field is one step, not one per letter.
      `menu:${id}:${Object.keys(patch).join(',')}`,
    ));
  };

  const deleteMenuItem = async (id: string) => {
    const before = dataSnapshotRef.current.menuItems;
    const target = before.find(mi => mi.id === id);
    const next = before.filter(mi => mi.id !== id);
    setMenuItems(next);
    history.record(restoreAction(
      `Removed ${target?.name ?? 'an item'} from the menu`, 'menu', before, next, setMenuItems,
    ));
    await saveImmediate({ menuItems: next });
  };

  const handleAddCategory = async (name: string) => {
    if (!name.trim()) return;
    const before = dataSnapshotRef.current.categories;
    const newCategory: Category = {
      id: `cat-${Date.now()}`,
      name: name.trim(),
      order: before.length,
    };
    const next = [...before, newCategory];
    setCategories(next);
    history.record(restoreAction(`Added the ${newCategory.name} category`, 'menu', before, next, setCategories));
    await saveImmediate({ categories: next });
  };

  const updateCategory = (id: string, patch: Partial<Category>) => {
    const beforeCategories = dataSnapshotRef.current.categories;
    const beforeItems = dataSnapshotRef.current.menuItems;
    const oldCategory = beforeCategories.find(c => c.id === id);
    if (!oldCategory) return;

    // Renaming a category renames it on every item that belongs to it, so the
    // two can never fall out of step.
    const renaming = Boolean(patch.name && patch.name !== oldCategory.name);
    const afterItems = renaming
      ? beforeItems.map(item => (item.category === oldCategory.name ? { ...item, category: patch.name! } : item))
      : beforeItems;
    const afterCategories = beforeCategories.map(cat => (cat.id === id ? { ...cat, ...patch } : cat));

    if (renaming) {
      setMenuItems(afterItems);
      if (selectedCategory === oldCategory.name) setSelectedCategory(patch.name!);
    }
    setCategories(afterCategories);

    history.record({
      label: `Renamed a category`,
      scope: 'menu',
      coalesceKey: `category:${id}:${Object.keys(patch).join(',')}`,
      undo: () => { setCategories(beforeCategories); setMenuItems(beforeItems); },
      redo: () => { setCategories(afterCategories); setMenuItems(afterItems); },
    });
  };

  const deleteCategory = async (id: string) => {
    if (categories.length <= 1) return; // Keep at least one category

    const beforeCategories = dataSnapshotRef.current.categories;
    const beforeItems = dataSnapshotRef.current.menuItems;
    const category = beforeCategories.find(c => c.id === id);
    if (!category) return;

    // Deals is structural. Removing it took the deal editor with it and left no
    // route back to the feature, so it is renameable and nothing more.
    if (isSystemCategory(category)) {
      toast.show(`${category.name} cannot be removed`, {
        kind: 'warning',
        detail: 'The program builds deals from this category. You can rename it to whatever you call them.',
      });
      return;
    }

    // Items in a deleted category move to the first remaining one rather than
    // being deleted with it. Losing a menu item to a tidy-up would also lose
    // whatever it is linked to in stock.
    const remainingCategories = beforeCategories.filter(c => c.id !== id);
    const targetCategory = remainingCategories[0].name;
    const updatedMenuItems = beforeItems.map(item =>
      item.category === category.name ? { ...item, category: targetCategory } : item
    );
    setMenuItems(updatedMenuItems);
    setCategories(remainingCategories);

    if (selectedCategory === category.name) setSelectedCategory(targetCategory);

    history.record({
      label: `Removed the ${category.name} category`,
      scope: 'menu',
      undo: () => { setCategories(beforeCategories); setMenuItems(beforeItems); },
      redo: () => { setCategories(remainingCategories); setMenuItems(updatedMenuItems); },
    });

    await saveImmediate({ menuItems: updatedMenuItems, categories: remainingCategories });
  };

  const reorderCategory = (draggedId: string, targetId: string) => {
    const before = dataSnapshotRef.current.categories;
    const sorted = [...before].sort((a, b) => a.order - b.order);
    const idx = sorted.findIndex(c => c.id === draggedId);
    const targetIdx = sorted.findIndex(c => c.id === targetId);
    if (idx === -1 || targetIdx === -1) return;
    const [removed] = sorted.splice(idx, 1);
    sorted.splice(targetIdx, 0, removed);
    const next = sorted.map((c, i) => ({ ...c, order: i }));
    setCategories(next);
    history.record(restoreAction('Reordered the categories', 'menu', before, next, setCategories));
  };

  // Voided orders leave the board entirely; they live on only in history.
  const liveOrders = orders.filter(o => !o.voidedAt);
  const getOrdersByStatus = (status: OrderStatus) => liveOrders.filter(o => o.status === status);
  const cartTotals = computeTotals(cart, activeSession?.discount, activeTaxRate);
  const cartSubtotalValue = cartTotals.subtotal;
  const cartDiscountAmount = cartTotals.discountAmount;
  const cartTaxAmount = cartTotals.taxAmount;
  const cartTotal = cartTotals.total;
  const cashReceivedNum = parseFloat(cashReceived) || 0;
  const change = cashReceivedNum - cartTotal;
  const sortedCategories = [...categories].sort((a, b) => a.order - b.order);
  const lowStockItems = stockItems.filter(isLowStock);
  const lowStockCount = lowStockItems.length;
  const isEditingSession = Boolean(activeSession?.editingOrderId);

  // ----- VIEWS -----
  const preparingOrders = getOrdersByStatus('preparing');
  const grillOrders = getOrdersByStatus('grill');
  const grillCapacity = Math.max(1, parseInt(grillCapacityInput) || 8);
  grillCapacityRef.current = grillCapacity;
  const grillIsFull = grillOrders.length >= grillCapacity;
  const readyOrders = getOrdersByStatus('ready');
  const allCompletedOrders = getOrdersByStatus('completed');
  // An order is "being edited" purely because a session claims it — no second
  // source of truth to drift, and it keeps its place on the board throughout.
  const editingOrderIds = new Set(
    parkedSessions.map(s => s.editingOrderId).filter((id): id is string => Boolean(id))
  );
  // Mirror for synchronous ticket claims. Assigned during render, like grillCapacityRef.
  tradingSessionsRef.current = tradingSessions;

  const liveSession = tradingSessions.find(s => s.status === 'active') ?? null;
  const sessionActive = liveSession !== null;
  const sessionCompletedOrders = allCompletedOrders.filter(o =>
    liveSession !== null && o.sessionId === liveSession.id);
  const completedOrders = completedFilter === 'session' && sessionActive ? sessionCompletedOrders : allCompletedOrders;
  const visibleMenuItems = menuItems.filter(item => item.showInOrderMode && item.category === selectedCategory);

  /**
   * Re-labels a section with session ticket numbers while a session is live.
   * Display only — the stored orders keep their lifetime numbers throughout,
   * which is what lets ending a session reveal them again for free.
   */
  const withSessionNumbers = (list: Order[]) =>
    withDisplayNumbers(list, liveSession?.id ?? null);

  const section = VIEW_SECTION[currentView];

  let pageContent: React.ReactNode;

  if (currentView === 'home') {
    pageContent = (
      <SectionTheme section="home" className="contents">
        <HomeScreen
          onNavigate={navigateTo}
          onLogout={onLogout}
          lowStockCount={lowStockCount}
          liveSessionName={liveSession?.name ?? null}
          openOrderCount={preparingOrders.length + grillOrders.length + readyOrders.length}
        />
      </SectionTheme>
    );
  } else if (currentView === 'settings') {
    pageContent = (
      <ScreenShell section="settings" onOtherBoard={handleOrdersNavigation}>
        <SettingsView
          categories={categories}
          menuItems={menuItems}
          onAddCategory={handleAddCategory}
          onUpdateCategory={updateCategory}
          onDeleteCategory={deleteCategory}
          onReorderCategories={reorderCategory}
          onAddMenuItem={handleAddMenuItem}
          onUpdateMenuItem={updateMenuItem}
          onDeleteMenuItem={deleteMenuItem}
          grillCapacity={grillCapacityInput}
          onGrillCapacity={value => recordSetting('Changed the grill capacity', grillCapacityInput, value, setGrillCapacityInput)}
          grillOnBoard={grillOrders.length}
          tapToExpandParked={tapToExpandParked}
          onTapToExpandParked={value => recordSetting('Changed how parked orders open', tapToExpandParked, value, setTapToExpandParked)}
          taxEnabled={taxEnabled}
          onTaxEnabled={value => recordSetting(value ? 'Switched sales tax on' : 'Switched sales tax off', taxEnabled, value, setTaxEnabled)}
          taxRate={taxRateInput}
          onTaxRate={value => recordSetting('Changed the tax rate', taxRateInput, value, setTaxRateInput)}
          discountRequiresPin={discountRequiresPin}
          onDiscountRequiresPin={value => recordSetting('Changed whether discounts need a PIN', discountRequiresPin, value, setDiscountRequiresPin)}
          lightMode={lightMode}
          onLightMode={value => recordSetting(value ? 'Switched to light mode' : 'Switched to dark mode', lightMode, value, setLightMode)}
          uiScale={uiScale}
          onUiScale={value => recordSetting('Changed the display scale', uiScale, value, setUiScale)}
          fullscreen={fullscreen}
          onFullscreen={handleFullscreen}
          autoPrint={autoPrint}
          onAutoPrint={value => recordSetting(value ? 'Switched automatic printing on' : 'Switched automatic printing off', autoPrint, value, setAutoPrint)}
          printerName={printerName}
          onPrinterName={setPrinterName}
          onTestPrint={handleTestPrint}
          onWipe={handleWipeData}
          onRevenuePinChanged={setCurrentRevenuePin}
        />
      </ScreenShell>
    );
  } else if (currentView === 'analytics') {
    pageContent = (
      <ScreenShell section="analytics" onOtherBoard={handleOrdersNavigation}>
        <AnalyticsView
          orders={orders}
          menuItems={menuItems}
          stockItems={stockItems}
          assignments={stockAssignments}
          movements={stockMovements}
          snapshots={inventorySnapshots}
          oversells={oversellEvents}
          sessions={tradingSessions}
          events={tradingEvents}
          costs={costEntries}
          onAddCost={handleAddCost}
          onDeleteCost={handleDeleteCost}
          taxEnabled={taxEnabled}
          revenueLocked={revenueLocked}
          onUnlockRevenue={() => setShowRevenuePin(true)}
          onOpenInventory={() => navigateTo('inventory')}
        />
        <RevenuePinPad
          open={showRevenuePin}
          expected={currentRevenuePin}
          onSuccess={() => { setRevenueLocked(false); setShowRevenuePin(false); setRevenuePinInput(''); }}
          onClose={handleRevenueLock}
        />
      </ScreenShell>
    );
  } else if (currentView === 'inventory') {
    pageContent = (
      <ScreenShell section="inventory" onOtherBoard={handleOrdersNavigation}>
        <InventoryView
          stockItems={stockItems}
          menuItems={menuItems}
          assignments={stockAssignments}
          movements={stockMovements}
          onAdjustStock={handleAdjustStock}
          onSaveStockItem={handleSaveStockItem}
          onDeleteStockItem={handleDeleteStockItem}
          onSetPacket={handleSetPacket}
          onSaveAssignments={handleSaveAssignments}
          onUndoMovement={handleUndoMovement}
          onStockTake={handleStockTake}
          onPrintReorder={handlePrintReorder}
          onDrainStock={handleDrainStock}
        />
      </ScreenShell>
    );
  } else if (currentView === 'allOrders') {
    pageContent = (
      <ScreenShell section="orders" onOtherBoard={handleOrdersNavigation}>
        {sessionActive && (
          <NavSlot>
            <NavTabs>
              <span className="ml-[2px]">
                <SegmentedControl
                  value={completedFilter}
                  onChange={setCompletedFilter}
                  options={[
                    { value: 'session' as const, label: 'This session', hint: HINT.completedThisSession },
                    { value: 'all' as const, label: 'Everything', hint: HINT.completedAll },
                  ]}
                />
              </span>
            </NavTabs>
          </NavSlot>
        )}

        <div className="flex-1 overflow-auto p-[20px] flex flex-col gap-[12px]">
          <SessionBar
            sessions={tradingSessions}
            events={tradingEvents}
            orders={orders}
            onStart={handleStartSession}
            onPause={handlePauseSession}
            onResume={handleResumeSession}
            onEnd={handleEndSession}
            onRename={handleRenameSession}
            onGroup={handleGroupSessions}
            onUngroup={handleUngroupSession}
          />
          <Section title="PREPARING" status="preparing" orders={withSessionNumbers(preparingOrders)} editingOrderIds={editingOrderIds} grillIsFull={grillIsFull} onEditOrder={startEditingOrder} showDelete={true} pendingDeleteId={pendingDeleteId} onDelete={voidOrder} showTimestamp={true} />
          <Section title="ON THE GRILL" status="grill" orders={withSessionNumbers(grillOrders)} capacity={grillCapacity} editingOrderIds={editingOrderIds} grillIsFull={grillIsFull} onEditOrder={startEditingOrder} showDelete={true} pendingDeleteId={pendingDeleteId} onDelete={voidOrder} showTimestamp={true} />
          <Section title="READY" status="ready" orders={withSessionNumbers(readyOrders)} editingOrderIds={editingOrderIds} grillIsFull={grillIsFull} onEditOrder={startEditingOrder} showDelete={true} pendingDeleteId={pendingDeleteId} onDelete={voidOrder} showTimestamp={true} />
          <Section
            title="COMPLETED"
            status="completed"
            orders={withSessionNumbers(completedOrders)}
            editingOrderIds={editingOrderIds}
            grillIsFull={grillIsFull}
            onEditOrder={startEditingOrder}
            showDelete={true}
            pendingDeleteId={pendingDeleteId}
            onDelete={voidOrder}
            showTimestamp={true}
            note={sessionActive && completedFilter === 'session' ? 'Showing this session only' : undefined}
          />
        </div>
      </ScreenShell>
    );
  } else {
    pageContent = (
    <SectionTheme section="order" className="screen-h screen-w bg-[var(--app-bg)] flex overflow-hidden">
      {/* Left + Sidebar wrapper — flex:1 so it absorbs all space the right panel doesn't take.
          The right panel is a stable flex item at fixed width; this wrapper never changes its
          outer size from the right panel's perspective, so the right panel never shifts. */}
      <div className="flex flex-1 h-full overflow-hidden relative">
        {/* Left Panel - Tickets */}
        <div className="bg-[var(--app-bg)] flex flex-col h-full pr-px border-r border-[var(--app-border)]" style={{ flex: 1, minWidth: 0 }}>
          <NavSlotHost>
            <Navigation section="order" onOtherBoard={handleOrdersNavigation} isOrderMode />
          </NavSlotHost>

          <div
            className="flex-1 overflow-auto"
            ref={boardScrollRef}
            onScroll={e => handleBoardScroll(e.currentTarget)}
          >
            <div className="p-[20px] flex flex-col gap-[12px]">
              <Section title="ON THE GRILL" status="grill" orders={withSessionNumbers(grillOrders)} capacity={grillCapacity} editingOrderIds={editingOrderIds} grillIsFull={grillIsFull} onEditOrder={startEditingOrder} showDelete={false}
                sticky minimized={grillMinimized} sectionRef={grillSectionRef}
                onExpand={() => boardScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })} />
              <Section title="PREPARING" status="preparing" orders={withSessionNumbers(preparingOrders)} editingOrderIds={editingOrderIds} grillIsFull={grillIsFull} onEditOrder={startEditingOrder} showDelete={false} />
              <Section title="READY" status="ready" orders={withSessionNumbers(readyOrders)} editingOrderIds={editingOrderIds} grillIsFull={grillIsFull} onEditOrder={startEditingOrder} showDelete={false} />
            </div>
          </div>
        </div>

        {/* Parked Sidebar */}
        <ParkedSidebar
          open={parkedSidebarOpen}
          setOpen={setParkedSidebarOpen}
          sessions={parkedSessions}
          activeSessionId={activeSessionId}
          onSwitchSession={switchToSession}
          onNewSession={createNewSession}
          onDeleteSession={deleteSession}
          onMove={moveOrder}
          onCheckoutParked={checkoutParkedSession}
          tapToExpandParked={tapToExpandParked}
          taxRate={activeTaxRate}
        />
      </div>

      {/*
        Right Panel — Menu & Cart.

        This panel is a light surface inside an otherwise dark app, which the
        shared controls know nothing about: a `secondary` button reads
        `--app-surface` and would come out charcoal on white. Rather than give
        every control in here a special case, the panel restates those variables
        for its own subtree, so a shared button dropped in here is simply right.
      */}
      <div
        className="w-[496px] bg-[var(--app-order-bg)] flex flex-col h-full shrink-0 border-l border-[var(--app-order-border)]"
        style={{
          '--app-surface': 'var(--app-order-card)',
          '--app-bg-darker': 'var(--app-order-card)',
          '--app-border': 'var(--app-order-border)',
          '--app-text': 'var(--app-order-text)',
        } as React.CSSProperties}
      >
        <div className="flex-1 flex flex-col gap-[10px] p-[16px] overflow-hidden min-h-0">
            <LowStockNotice
              items={lowStockItems}
              dismissedKey={dismissedLowStock}
              onDismiss={setDismissedLowStock}
              onOpenInventory={() => navigateTo('inventory')}
            />

            {/* Category tabs */}
            <div className="flex gap-[6px] h-[36px] shrink-0">
              {sortedCategories.map(category => {
                const active = selectedCategory === category.name;
                return (
                  <motion.button
                    key={category.id}
                    onClick={() => setSelectedCategory(category.name)}
                    whileTap={{ scale: 0.97 }}
                    transition={SNAP}
                    data-category-tab={category.name}
                    className="relative rounded-[9px] px-[15px] flex items-center justify-center overflow-hidden"
                    style={{
                      background: active ? ORDER_ACCENT : 'var(--app-order-card)',
                      border: `1px solid ${active ? ORDER_ACCENT : 'var(--app-order-border)'}`,
                      color: active ? '#FFFFFF' : 'var(--app-text-secondary)',
                      boxShadow: active ? `0 2px 10px -3px ${alpha(ORDER_ACCENT, 0.7)}` : 'none',
                      transition: `background ${DURATION.fast}s, border-color ${DURATION.fast}s, color ${DURATION.fast}s, box-shadow ${DURATION.fast}s`,
                    }}
                  >
                    <span className="font-['Segoe_UI',sans-serif] text-[13px] font-bold leading-[18px] whitespace-nowrap">
                      {category.name}
                    </span>
                  </motion.button>
                );
              })}
            </div>

            {/* Menu items grid */}
            <div className="grid grid-cols-4 gap-[8px] auto-rows-[100px] shrink-0">
              {visibleMenuItems.map(item => {
                const soldOut = Boolean(soldOutEstimate(item));
                return (
                  <MenuTile
                    key={item.id}
                    name={item.name}
                    soldOut={soldOut}
                    onPress={() => addToCart(item)}
                  />
                );
              })}
            </div>

            {/* Cart area */}
            <div
              className="bg-[var(--app-order-card)] rounded-[12px] border flex flex-col shadow-sm min-h-0"
              style={{
                flex: 1,
                borderColor: isEditingSession ? STATUS_COLOR.editing : 'var(--app-order-border)',
                transition: `border-color ${DURATION.base}s`,
              }}
            >
              <AnimatePresence initial={false}>
                {isEditingSession && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: DURATION.fast, ease: EASE }}
                    className="overflow-hidden"
                  >
                    <div
                      className="flex items-center gap-[8px] px-[14px] py-[9px] rounded-t-[11px]"
                      style={{ background: alpha(STATUS_COLOR.editing, 0.14) }}
                    >
                      <Pencil size={14} style={{ color: STATUS_COLOR.editing }} />
                      <span className="font-['Segoe_UI',sans-serif] text-[12px] font-bold" style={{ color: STATUS_COLOR.editing }}>
                        Editing order #{activeSession?.label} — it keeps its number
                      </span>
                      <span className="ml-auto">
                        <Button
                          variant="quiet"
                          size="sm"
                          tone={STATUS_COLOR.editing}
                          onClick={() => cancelEdit(activeSessionId)}
                        >
                          Cancel edit
                        </Button>
                      </span>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="px-[12px] pt-[11px] pb-[10px] flex justify-between items-center gap-[8px] border-b border-[var(--app-order-border)]">
                {/*
                  No hover text on the ordering panel.
                  Every control here is labelled, pressed constantly, and
                  operated at speed — an explanation that appears each time the
                  pointer crosses a button is in the way rather than in aid.
                  Analytics keeps its hover text, because a figure genuinely
                  needs its basis explained; a button marked "Clear" does not.
                */}
                <Button
                  variant="danger"
                  size="sm"
                  icon={<Trash2 size={14} />}
                  onClick={clearCart}
                  disabled={cart.length === 0}
                  data-clear-cart
                >
                  Clear
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  tone={ORDER_ACCENT}
                  icon={<Plus size={14} />}
                  onClick={createNewSession}
                  data-new-order
                >
                  New order
                </Button>
              </div>

              <div className="flex-1 overflow-auto px-[14px] py-[10px] scrollbar-light">
                {cart.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full gap-[8px] text-center px-[20px]">
                    <ShoppingBag size={26} className="text-[var(--app-text-muted)] opacity-60" />
                    <p className="font-['Segoe_UI',sans-serif] text-[var(--app-text-muted)] text-[14px]">
                      Nothing on this order yet
                    </p>
                    <p className="font-['Segoe_UI',sans-serif] text-[var(--app-text-muted)] text-[12px] opacity-75">
                      Tap an item above to add it.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-[8px]">
                    <AnimatePresence initial={false} mode="popLayout">
                      {cart.map(item => (
                        <motion.div
                          key={item.menuItemId}
                          layout
                          initial={{ opacity: 0, x: 14 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: -14 }}
                          transition={GLIDE}
                          className="flex flex-col group"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-[var(--app-order-text)] text-[17px] font-medium">
                              {item.name} <span className="text-[var(--app-text-muted)]">×{item.quantity}</span>
                            </span>
                            <div className="flex items-center gap-[8px]">
                              <span className="text-[var(--app-text-secondary)] text-[17px] font-medium tabular-nums">
                                Rs {(item.price * item.quantity).toFixed(0)}
                              </span>
                              <button
                                onClick={() => removeFromCart(item.menuItemId)}
                                aria-label={`Remove ${item.name}`}
                                className="p-[5px] rounded-[7px] text-[var(--app-text-muted)] opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-[#fff1f0] hover:text-[#F9624E] transition-all"
                              >
                                <Trash2 size={16} />
                              </button>
                            </div>
                          </div>
                          {item.dealItems && item.dealItems.length > 0 && (
                            <div className="pl-3 mt-[2px] space-y-[1px]">
                              {item.dealItems.map((dealItem, idx) => (
                                <div key={idx} className="text-[var(--app-text-muted)] text-[14px]">
                                  · {dealItem.quantity * item.quantity}x {dealItem.name}
                                </div>
                              ))}
                            </div>
                          )}
                        </motion.div>
                      ))}
                    </AnimatePresence>
                  </div>
                )}
              </div>

              <div className="h-px bg-[var(--app-order-border)]" />

              <div className="px-[14px] py-[12px]">
                {/* Breakdown — only the lines that actually apply */}
                {(cartDiscountAmount > 0 || cartTaxAmount > 0 || pendingDiscountAmount > 0) && (
                  <div className="flex flex-col gap-[3px] mb-[9px] pb-[9px] border-b border-[var(--app-order-border)]">
                    <TotalsRow label="Subtotal" value={`Rs ${cartSubtotalValue.toFixed(0)}`} />
                    {cartDiscountAmount > 0 ? (
                      <TotalsRow
                        label={`Discount${activeSession?.discount?.kind === 'percent' ? ` ${activeSession.discount.value}%` : ''}`}
                        value={`− Rs ${cartDiscountAmount.toFixed(0)}`}
                        tone="#0fa88a"
                      />
                    ) : pendingDiscountAmount > 0 ? (
                      <TotalsRow
                        label="Discount — press ✓ to apply"
                        value={`− Rs ${pendingDiscountAmount.toFixed(0)}`}
                        muted
                      />
                    ) : null}
                    {cartTaxAmount > 0 && (
                      <TotalsRow label={`Tax ${activeTaxRate}%`} value={`+ Rs ${cartTaxAmount.toFixed(0)}`} />
                    )}
                  </div>
                )}
                <div className="flex items-center justify-between gap-[10px]">
                  <div className="flex flex-col gap-[1px] min-w-0">
                    <p className="font-['Segoe_UI',sans-serif] text-[var(--app-text-muted)] text-[11px] uppercase tracking-[0.6px]">Total</p>
                    <p className="font-['Inter',sans-serif] font-bold text-[var(--app-order-text)] text-[32px] leading-[36px] tabular-nums">
                      Rs {cartTotal.toFixed(0)}
                    </p>
                  </div>
                  <div className="flex items-center gap-[6px] shrink-0">
                    <DiscountField
                      subtotal={cartSubtotalValue}
                      discount={activeSession?.discount}
                      discountAmount={cartDiscountAmount}
                      onApply={applyDiscount}
                      onClear={clearDiscount}
                      onPreviewChange={setPendingDiscountAmount}
                      requirePin={discountRequiresPin}
                      onRequestPin={requestDiscountPin}
                    />
                    <div className="flex items-center rounded-[9px] overflow-hidden border border-[var(--app-order-border)] bg-[var(--app-order-card)]">
                        <div className="flex flex-col items-center justify-center px-[12px] py-[8px] border-r border-[var(--app-order-border)]">
                          <p className="text-[var(--app-text-muted)] text-[8px] uppercase tracking-[0.5px] leading-[10px] mb-[3px]">Given</p>
                          <input
                            type="number"
                            value={cashReceived}
                            onChange={(e) => setCashReceived(e.target.value)}
                            placeholder="0"
                            className="bg-transparent text-[var(--app-order-text)] text-[15px] font-semibold text-center w-[48px] focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                          />
                        </div>
                        <div className="flex flex-col items-center justify-center px-[12px] py-[8px]">
                          <p className="text-[var(--app-text-muted)] text-[8px] uppercase tracking-[0.5px] leading-[10px] mb-[3px]">Change</p>
                          <p className={`text-[15px] font-semibold text-center w-[48px] tabular-nums ${change > 0 ? 'text-[#0fa88a]' : 'text-[var(--app-text-muted)]'}`}>
                            {change > 0 ? change.toFixed(0) : '—'}
                          </p>
                        </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Notes */}
            <div className="bg-[var(--app-order-card)] border border-[var(--app-order-border)] rounded-[10px] h-[42px] relative shadow-sm shrink-0 focus-within:border-[color:var(--sec)]">
              <input
                type="text"
                value={notes}
                onChange={(e) => updateNotes(capitalizeFirst(e.target.value))}
                placeholder="Notes for the kitchen"
                className="absolute inset-0 bg-transparent text-[var(--app-order-text)] placeholder:text-[var(--app-text-muted)] font-['Segoe_UI',sans-serif] text-[14px] px-[14px] py-[8px] focus:outline-none rounded-[10px]"
              />
            </div>

            {/* Payment buttons — an edit session writes back to its original order */}
            <div className="grid grid-cols-2 gap-[8px] shrink-0">
              <PayButton
                label={isEditingSession ? 'Save · Cash' : 'Cash'}
                icon={<Banknote size={19} />}
                disabled={cart.length === 0}
                onClick={() => isEditingSession ? checkoutParkedSession(activeSessionId, 'cash') : checkout('cash')}
              />
              <PayButton
                label={isEditingSession ? 'Save · Transfer' : 'Transfer'}
                icon={<Smartphone size={19} />}
                disabled={cart.length === 0}
                onClick={() => isEditingSession ? checkoutParkedSession(activeSessionId, 'transfer') : checkout('transfer')}
              />
            </div>
          </div>
        </div>

        <SoldOutPrompt
          prompt={soldOutPrompt}
          onCancel={() => setSoldOutPrompt(null)}
          onConfirm={() => {
            if (soldOutPrompt) {
              logOversell(soldOutPrompt.menuItem, soldOutPrompt.estimate);
              addToCartUnchecked(soldOutPrompt.menuItem);
            }
            setSoldOutPrompt(null);
          }}
        />
      </SectionTheme>
    );
  }

  useEffect(() => {
    // The theme lives in a `.light` class on <html> — setting only the inline
    // background left every CSS variable on its dark value.
    document.documentElement.classList.toggle('light', lightMode);
    const bg = lightMode ? '#fafafa' : '#09090b';
    document.documentElement.style.backgroundColor = bg;
    document.body.style.backgroundColor = bg;
  }, [lightMode]);

  useEffect(() => {
    document.documentElement.style.setProperty('--ui-scale', String(uiScale));
  }, [uiScale]);

  /**
   * Writes one stock snapshot per item per day, on the first launch of that day.
   *
   * Historical inventory value is otherwise obtainable only by replaying the
   * whole ledger, which stops being reliable the moment old lines are trimmed.
   * This is what makes "what was my stock worth in March" answerable at all.
   */
  useEffect(() => {
    if (!dataLoaded || stockItems.length === 0) return;
    const now = new Date();
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    if (inventorySnapshots.some(s => s.date === date)) return;

    setInventorySnapshots(prev => ([
      ...prev,
      ...stockItems.map(item => ({
        date,
        stockItemId: item.id,
        quantity: item.quantity,
        unitCost: item.costPerUnit,
        value: item.quantity * item.costPerUnit,
      })),
    ]));
  }, [dataLoaded, stockItems, inventorySnapshots]);

  useEffect(() => {
    const onChange = () => {
      setFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  return (
    <TicketMenuProvider onAction={handleTicketAction}>
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
        open={discountPinPrompt !== null}
        onClose={() => { setDiscountPinPrompt(null); setDiscountPinInput(''); setDiscountPinError(false); }}
        title="Manager PIN"
        description="Discounts are protected on this till. Enter the money PIN to take the amount off."
        icon={<Lock size={22} />}
        tone="#FE9A00"
        actions={
          <>
            <Button
              variant="secondary"
              block
              onClick={() => { setDiscountPinPrompt(null); setDiscountPinInput(''); setDiscountPinError(false); }}
            >
              Cancel
            </Button>
            <Button variant="primary" block onClick={submitDiscountPin}>Apply discount</Button>
          </>
        }
      >
        <input
          type="password"
          autoFocus
          value={discountPinInput}
          onChange={e => { setDiscountPinInput(e.target.value); setDiscountPinError(false); }}
          onKeyDown={e => { if (e.key === 'Enter') submitDiscountPin(); }}
          className="w-full bg-[var(--app-surface)] text-[var(--app-text)] text-center text-2xl tracking-[8px] rounded-xl px-4 py-3 focus:outline-none border"
          style={{ borderColor: discountPinError ? DANGER : 'transparent' }}
        />
        {discountPinError && (
          <p className="text-center text-[13px] -mt-[8px]" style={{ color: DANGER }}>
            That is not the PIN. Try again, or cancel and ring the order up at full price.
          </p>
        )}
      </Dialog>

      <ConfirmDialog
        open={showCloseConfirm}
        onCancel={handleCloseCancel}
        onConfirm={handleCloseConfirm}
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
 * A section's frame: its colour, its bar, and room underneath for the screen.
 *
 * Every section repeated this by hand and drifted apart doing it — different
 * paddings, one of them missing `min-h-0` so its content could not scroll.
 */
function ScreenShell({
  section, onOtherBoard, isOrderMode = false, children,
}: {
  section: SectionId;
  onOtherBoard: () => void;
  isOrderMode?: boolean;
  children: React.ReactNode;
}) {
  return (
    <SectionTheme
      section={section}
      className="screen-h screen-w overflow-hidden bg-[var(--app-bg)] text-[var(--app-text)] flex flex-col"
    >
      {/* The host scopes the tab slot to this page. Two pages are briefly on
          screen together during a section change, and without it the incoming
          page's tabs could be portalled into the outgoing page's bar — which is
          why coming back to Analytics used to arrive with its tabs missing. */}
      <NavSlotHost>
        <Navigation section={section} onOtherBoard={onOtherBoard} isOrderMode={isOrderMode} />
        <div className="flex-1 min-h-0 flex flex-col">{children}</div>
      </NavSlotHost>
    </SectionTheme>
  );
}

/** Order Mode's teal, named once so the right-hand panel and the bar agree. */
const ORDER_ACCENT = SECTION_COLOR.order;

/**
 * One item on the ordering grid.
 *
 * Pulled out of the render so it can hold its own hover state — the tiles are
 * the most-pressed control in the program and had no press feedback beyond a
 * border colour, which on a touchscreen means no feedback at all.
 */
const MenuTile = React.memo(function MenuTile({
  name, soldOut, onPress,
}: { name: string; soldOut: boolean; onPress: () => void }) {
  const [hover, setHover] = useState(false);
  const reduced = useReducedMotion();
  const accent = soldOut ? DANGER : ORDER_ACCENT;

  const tile = (
    <motion.button
      onClick={onPress}
      onHoverStart={() => setHover(true)}
      onHoverEnd={() => setHover(false)}
      whileTap={reduced ? undefined : { scale: 0.95 }}
      transition={reduced ? { duration: 0 } : SNAP}
      data-menu-tile={name}
      data-sold-out={soldOut ? 'true' : 'false'}
      className="relative rounded-[12px] flex items-center justify-center overflow-hidden shadow-sm"
      style={{
        background: hover
          ? `linear-gradient(135deg, ${alpha(accent, 0.16)} 0%, ${alpha(accent, 0.05)} 100%), var(--app-order-card)`
          : 'var(--app-order-card)',
        border: `1px solid ${soldOut ? DANGER : hover ? accent : 'var(--app-order-border)'}`,
        boxShadow: hover ? `0 4px 14px -6px ${alpha(accent, 0.8)}` : undefined,
        transition: `background ${DURATION.fast}s, border-color ${DURATION.fast}s, box-shadow ${DURATION.fast}s`,
      }}
    >
      <span
        className="font-['Segoe_UI',sans-serif] text-[15px] font-bold leading-[20px] px-[8px] text-center"
        style={{ color: soldOut ? DANGER : 'var(--app-order-text)' }}
      >
        {name}
      </span>
      {soldOut && (
        <span
          className="absolute bottom-[8px] text-[10px] font-bold uppercase tracking-[0.6px]"
          style={{ color: DANGER }}
        >
          Out of stock
        </span>
      )}
    </motion.button>
  );

  return soldOut ? <Tooltip label={HINT.soldOut}>{tile}</Tooltip> : tile;
});

/** The two buttons that take the money. Deliberately the largest on the panel. */
function PayButton({
  label, icon, disabled, onClick,
}: {
  label: string;
  icon: React.ReactNode;
  disabled: boolean;
  onClick: () => void;
}) {
  const [hover, setHover] = useState(false);
  const reduced = useReducedMotion();
  return (
      <motion.button
        onClick={onClick}
        disabled={disabled}
        onHoverStart={() => setHover(true)}
        onHoverEnd={() => setHover(false)}
        whileTap={disabled || reduced ? undefined : { scale: 0.98 }}
        transition={reduced ? { duration: 0 } : SNAP}
        data-pay={label}
        className="h-[64px] rounded-[11px] flex items-center justify-center gap-[10px] shadow-sm"
        style={{
          background: hover && !disabled
            ? 'linear-gradient(135deg, #FFB33D 0%, #FE9A00 60%, #E58A00 100%)'
            : 'var(--app-order-card)',
          border: `1px solid ${hover && !disabled ? '#FE9A00' : 'var(--app-order-border)'}`,
          color: hover && !disabled ? '#1B1206' : 'var(--app-text-muted)',
          opacity: disabled ? 0.3 : 1,
          cursor: disabled ? 'not-allowed' : 'pointer',
          boxShadow: hover && !disabled ? '0 6px 18px -8px rgba(254,154,0,0.9)' : undefined,
          transition: `background ${DURATION.fast}s, border-color ${DURATION.fast}s, color ${DURATION.fast}s, box-shadow ${DURATION.fast}s`,
        }}
      >
        {icon}
        <span className="font-['Segoe_UI',sans-serif] text-[16px] font-bold">{label}</span>
      </motion.button>
  );
}

/** One right-aligned line in the totals breakdown above the big total. */
function TotalsRow({
  label, value, tone, muted = false,
}: { label: string; value: string; tone?: string; muted?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-[10px]">
      <span
        className="font-['Segoe_UI',sans-serif] text-[11px] tracking-[0.3px]"
        style={{ color: tone ?? 'var(--app-text-muted)', opacity: muted ? 0.7 : 1 }}
      >
        {label}
      </span>
      <span
        className="font-['Segoe_UI',sans-serif] text-[12px] font-semibold tabular-nums"
        style={{ color: tone ?? 'var(--app-text-secondary)', opacity: muted ? 0.7 : 1 }}
      >
        {value}
      </span>
    </div>
  );
}

// ----- Section -----
const SECTION_CONFIG: Record<string, {
  bg: string;
  border: string;
  accent: string;
  icon: React.ReactNode;
  empty: string;
}> = {
  preparing: {
    bg: 'var(--dropzone-preparing-bg)',
    border: 'var(--dropzone-preparing-border)',
    accent: 'var(--dropzone-preparing-icon)',
    icon: <Inbox size={22} style={{ color: 'var(--dropzone-preparing-icon)' }} />,
    empty: 'No tickets preparing',
  },
  grill: {
    bg: 'var(--dropzone-grill-bg)',
    border: 'var(--dropzone-grill-border)',
    accent: 'var(--dropzone-grill-icon)',
    icon: <Flame size={22} style={{ color: 'var(--dropzone-grill-icon)' }} />,
    empty: 'Nothing on the grill',
  },
  ready: {
    bg: 'var(--dropzone-ready-bg)',
    border: 'var(--dropzone-ready-border)',
    accent: 'var(--dropzone-ready-icon)',
    icon: <BellRing size={22} style={{ color: 'var(--dropzone-ready-icon)' }} />,
    empty: 'Nothing ready yet',
  },
  completed: {
    bg: 'var(--dropzone-completed-bg)',
    border: 'var(--dropzone-completed-border)',
    accent: 'var(--dropzone-completed-icon)',
    icon: <CheckCircle2 size={22} style={{ color: 'var(--dropzone-completed-icon)' }} />,
    empty: 'No completed orders',
  },
};

function Section({
  title, status, orders, editingOrderIds, capacity, grillIsFull, onEditOrder,
  showDelete = true, pendingDeleteId, onDelete, showTimestamp = false,
  sticky = false, minimized = false, onExpand, sectionRef, note,
}: {
  title: string;
  /** A short aside beside the count — what is being filtered, for instance. */
  note?: string;
  status: OrderStatus;
  orders: Order[];
  editingOrderIds?: Set<string>;
  /** Shown as "03/08" in the header. Only the grill has one. */
  capacity?: number;
  grillIsFull?: boolean;
  onEditOrder?: (orderId: string) => void;
  showDelete?: boolean;
  pendingDeleteId?: string | null;
  onDelete?: (id: string) => void;
  showTimestamp?: boolean;
  /** Pins the section to the top of the board while it is scrolled. */
  sticky?: boolean;
  /** Collapses to a single strip of order numbers. */
  minimized?: boolean;
  onExpand?: () => void;
  sectionRef?: React.MutableRefObject<HTMLDivElement | null>;
}) {
  const cfg = SECTION_CONFIG[status] ?? SECTION_CONFIG.preparing;
  // Nothing is greyed out for being redundant any more — that slot offers
  // "Preparing" instead. Only a full grill actually blocks an action.
  const disabledActions = grillIsFull && status !== 'grill' ? ['grill' as TicketAction] : undefined;
  const atCapacity = capacity !== undefined && orders.length >= capacity;
  const collapsed = sticky && minimized;

  return (
    <div
      ref={sectionRef}
      className="flex flex-col gap-[5px]"
      data-section={status}
      data-collapsed={collapsed ? 'true' : 'false'}
      style={sticky ? {
        position: 'sticky',
        top: 0,
        zIndex: 20,
        background: 'var(--app-bg)',
        paddingTop: collapsed ? 8 : 0,
        paddingBottom: collapsed ? 8 : 0,
        marginTop: collapsed ? -8 : 0,
        boxShadow: collapsed ? '0 8px 16px -8px rgba(0,0,0,0.7)' : 'none',
      } : undefined}>
      <div className="flex items-center gap-[7px] font-['Segoe_UI',sans-serif] text-[var(--app-text-muted)] text-[14px] leading-[20px] not-italic">
        <span style={{ color: cfg.accent, display: 'flex' }}>
          {React.isValidElement(cfg.icon)
            ? React.cloneElement(cfg.icon as React.ReactElement<{ size?: number }>, { size: 14 })
            : cfg.icon}
        </span>
        <span className="font-bold tracking-[0.6px]">
          {title} {String(orders.length).padStart(2, '0')}
          {capacity !== undefined && (
            <span style={{ color: atCapacity ? cfg.accent : undefined }}>
              /{String(capacity).padStart(2, '0')}
            </span>
          )}
          {atCapacity && (
            <span className="ml-[8px] text-[12px] font-bold uppercase" style={{ color: cfg.accent }}>
              Full
            </span>
          )}
        </span>
        {note && (
          <span className="text-[12px] font-medium opacity-80 normal-case">· {note}</span>
        )}
        <span
          aria-hidden
          className="flex-1 h-px ml-[4px]"
          style={{ background: `linear-gradient(90deg, ${cfg.border} 0%, rgba(0,0,0,0) 100%)` }}
        />
      </div>
      {collapsed ? (
        <button
          onClick={onExpand}
          title={HINT.collapsedGrill}
          className="flex items-center gap-[8px] w-full overflow-x-auto py-[4px] text-left"
        >
          {orders.length === 0 ? (
            <span className="text-[var(--app-text-muted)] text-[12px]">{cfg.empty}</span>
          ) : (
            orders.map(order => (
              <motion.span
                key={order.id}
                layout
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                className="shrink-0 flex items-center gap-[9px] rounded-[9px] px-[11px] py-[7px] font-['Segoe_UI',sans-serif]"
                style={{ background: cfg.bg, border: `1px solid ${cfg.border}`, minWidth: 132 }}
              >
                <span className="text-[19px] font-bold leading-none" style={{ color: cfg.accent }}>
                  {order.orderNumber}
                </span>
                <span className="flex flex-col leading-[13px] min-w-0">
                  <span className="text-[12px] font-semibold text-[var(--app-text)] truncate max-w-[132px]">
                    ×{order.items[0]?.quantity ?? 0} {order.items[0]?.name ?? '—'}
                  </span>
                  {order.items.length > 1 && (
                    <span className="text-[10px] text-[var(--app-text-muted)]">
                      +{order.items.length - 1} more
                    </span>
                  )}
                </span>
              </motion.span>
            ))
          )}
        </button>
      ) : (
      <div className="relative w-full">
        {orders.length === 0 ? (
          <div
            className="flex flex-col items-center justify-center py-[26px] rounded-[12px] w-full border border-dashed transition-colors"
            style={{ backgroundColor: cfg.bg, borderColor: cfg.border }}
          >
            {cfg.icon}
            <p className="text-[var(--app-text-secondary)] text-[13px] mt-[8px] font-semibold">{cfg.empty}</p>
          </div>
        ) : (
          <div className="flex flex-wrap gap-[14px] py-[14px] content-start w-full">
            <AnimatePresence mode="popLayout">
              {orders.map(order => (
                <motion.div
                  key={order.id}
                  layout
                  className="relative group"
                  initial={{ opacity: 0, scale: 0.85, y: 8 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.8, y: -6 }}
                  transition={{ type: 'spring', stiffness: 380, damping: 28 }}
                >
                  <Ticket
                    orderId={order.id}
                    orderNumber={order.orderNumber}
                    items={order.items}
                    notes={order.notes}
                    status={order.status}
                    total={order.total}
                    timestamp={order.timestamp}
                    showTimestamp={showTimestamp}
                    disabledActions={disabledActions}
                    frozen={editingOrderIds?.has(order.id) ?? false}
                    onFrozenPress={() => onEditOrder?.(order.id)}
                  />
                  {showDelete && onDelete && (
                    <Tooltip label={HINT.voidOrder}>
                      <button
                        onClick={() => onDelete(order.id)}
                        data-void-order={order.orderNumber}
                        className={`absolute top-2 right-2 px-[11px] h-[26px] rounded-[8px] text-[12px] font-bold transition-all duration-150 ${
                          pendingDeleteId === order.id
                            ? 'opacity-100'
                            : 'opacity-0 group-hover:opacity-100 focus:opacity-100'
                        }`}
                        style={pendingDeleteId === order.id
                          ? { background: DANGER, color: '#fff', boxShadow: `0 3px 12px -3px ${alpha(DANGER, 0.9)}` }
                          : { background: 'rgba(9,9,12,0.72)', color: '#fff', border: '1px solid rgba(255,255,255,0.14)' }}
                      >
                        {pendingDeleteId === order.id ? 'Void it?' : 'Void'}
                      </button>
                    </Tooltip>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
      )}
    </div>
  );
}

  // ----- Parked Ticket -----
const ParkedTicketInline = React.memo(function ParkedTicketInline({
  session,
  total,
  isDragging,
  isActive,
  expanded,
  onSwitchSession,
  onDeleteSession,
  onCheckoutParked,
  startDragFn,
  onToggleExpand,
  tapToExpandParked,
}: {
  session: ParkedSession;
  total: number;
  isDragging: boolean;
  isActive: boolean;
  expanded: boolean;
  onSwitchSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  onCheckoutParked: (sessionId: string, paymentType: 'cash' | 'transfer') => void;
  startDragFn: (orderId: string, x: number, y: number, label: string, origin?: DragOrigin) => void;
  onToggleExpand: () => void;
  tapToExpandParked: boolean;
}) {
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    startDragFn(`parked-${session.id}`, e.clientX, e.clientY, session.label, {
      rect: measure(e.currentTarget)!,
      editing: Boolean(session.editingOrderId),
    });
  }, [session.id, session.label, session.editingOrderId, startDragFn]);

  const handleClick = useCallback((e: React.MouseEvent) => {
    if (tapToExpandParked) {
      onToggleExpand();
    } else {
      onSwitchSession(session.id);
    }
  }, [session.id, onSwitchSession, tapToExpandParked, onToggleExpand]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const t = e.touches[0];
    if (!t) return;
    e.stopPropagation();
    startDragFn(`parked-${session.id}`, t.clientX, t.clientY, session.label, {
      rect: measure(e.currentTarget)!,
      editing: Boolean(session.editingOrderId),
    });
  }, [session.id, session.label, session.editingOrderId, startDragFn]);

  const handleDeleteClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onDeleteSession(session.id);
  }, [session.id, onDeleteSession]);

  const handleCashClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onCheckoutParked(session.id, 'cash');
  }, [session.id, onCheckoutParked]);

  const handleTransferClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onCheckoutParked(session.id, 'transfer');
  }, [session.id, onCheckoutParked]);

  const isEditing = Boolean(session.editingOrderId);

  return (
    <motion.div
      layout
      onMouseDown={expanded ? undefined : handleMouseDown}
      onClick={handleClick}
      onTouchStart={expanded ? undefined : handleTouchStart}
      className={`rounded-[9px] p-[3px] flex flex-col relative group select-none ${
        tapToExpandParked ? 'cursor-pointer' : expanded ? 'cursor-default' : 'cursor-grab active:cursor-grabbing'
      } ${
        isActive
          ? 'bg-[#d9d9d9] ring-inset ring-3 ring-[#15d2b2]'
          : 'bg-[#d9d9d9] hover:bg-[#e9e9e9]'
      }`}
      style={{ touchAction: 'none', boxShadow: isEditing ? 'inset 0 0 0 2px #7c3fb0' : undefined }}
      // Hands off to the drag chip: the card recedes as the chip grows out of it.
      animate={{ opacity: isDragging ? 0.25 : 1, scale: isDragging ? 0.94 : 1 }}
      transition={{ type: 'spring', stiffness: 500, damping: 35 }}
    >
      {isEditing && (
        <div className="flex items-center gap-[3px] px-[3px] pb-[2px]">
          <Pencil size={9} style={{ color: '#7c3fb0' }} />
          <span className="font-['Segoe_UI',sans-serif] text-[8px] font-bold uppercase tracking-[0.6px]" style={{ color: '#7c3fb0' }}>
            Editing
          </span>
        </div>
      )}
      <div className="flex items-start justify-between gap-[6px] px-[2px]" style={{ minHeight: '59px' }}>
        <div className="font-['Barlow_Semi_Condensed',sans-serif] font-semibold text-[12px] uppercase tracking-[0.3px] leading-[13px] text-black flex-1 pt-[6px] overflow-hidden min-w-0">
          {session.cart.map(item => (
            <div key={item.menuItemId}>
              <p className="truncate">X{item.quantity} {item.name}</p>
              {item.dealItems && item.dealItems.length > 0 && (
                <div className="pl-2 text-[10px] text-[#3f3f46]">
                  {item.dealItems.map((dealItem, idx) => (
                    <p key={idx} className="truncate">• {dealItem.quantity * item.quantity}x {dealItem.name}</p>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="flex flex-col items-end justify-between pt-[5px] pb-[3px] shrink-0" style={{ minHeight: '53px' }}>
          <p
            className={`font-['Barlow_Semi_Condensed',sans-serif] font-bold uppercase tracking-[0.2px] leading-[12px] text-right ${isEditing ? 'text-[18px]' : 'text-[24px]'}`}
            style={{ color: isEditing ? '#7c3fb0' : '#000' }}
          >
            {isEditing ? `#${session.label}` : session.label}
          </p>
          <p className="font-['Barlow_Semi_Condensed',sans-serif] font-bold leading-[12px] text-black text-right whitespace-nowrap">
            <span className="text-[5px]">rs</span>
            <span className="text-[18px]">{total.toFixed(0)}</span>
          </p>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="actions"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            className="overflow-hidden"
          >
            <div className="flex gap-[4px] px-[2px] pb-[3px] pt-[4px] border-t border-[#b0b0b0] mt-[2px]">
              <button
                onClick={handleDeleteClick}
                className="flex-1 bg-[#3d1f1f] hover:bg-[#F9624E] text-white text-[10px] font-semibold uppercase tracking-[0.5px] rounded-[6px] py-[5px] transition-colors"
              >
                {isEditing ? 'Cancel' : 'Delete'}
              </button>
              <button
                onClick={handleCashClick}
                className="flex-1 bg-[#504040] hover:bg-[#5BBFB6] hover:text-black text-white text-[10px] font-semibold uppercase tracking-[0.5px] rounded-[6px] py-[5px] transition-colors"
              >
                {isEditing ? 'Save·Cash' : 'Cash'}
              </button>
              <button
                onClick={handleTransferClick}
                className="flex-1 bg-[#3d4c58] hover:bg-[#5BBFB6] hover:text-black text-white text-[10px] font-semibold uppercase tracking-[0.5px] rounded-[6px] py-[5px] transition-colors"
              >
                {isEditing ? 'Save·Trf' : 'Transfer'}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
});

// ----- Parked Sidebar -----
function ParkedSidebar({
  open, setOpen, sessions, activeSessionId, onSwitchSession, onNewSession, onDeleteSession, onMove, onCheckoutParked, tapToExpandParked, taxRate
}: {
  open: boolean;
  setOpen: (b: boolean) => void;
  sessions: ParkedSession[];
  activeSessionId: string;
  onSwitchSession: (id: string) => void;
  onNewSession: () => void;
  onDeleteSession: (id: string) => void;
  onMove: (orderId: string, status: OrderStatus, paid?: 'cash' | 'transfer') => void;
  onCheckoutParked: (sessionId: string, paymentType: 'cash' | 'transfer') => void;
  tapToExpandParked: boolean;
  taxRate: number;
}) {
  const [cashDropSuccess, setCashDropSuccess] = useState(false);
  const [transferDropSuccess, setTransferDropSuccess] = useState(false);
  const [deleteDropSuccess, setDeleteDropSuccess] = useState(false);
  const [cashDropDenied, setCashDropDenied] = useState(false);
  const [transferDropDenied, setTransferDropDenied] = useState(false);
  const [expandedParkedId, setExpandedParkedId] = useState<string | null>(null);

  const triggerDropEffect = (setter: (v: boolean) => void) => {
    setter(true);
    setTimeout(() => setter(false), 700);
  };

  const isSessionEmpty = useCallback((id: string) => {
    if (!id.startsWith('parked-')) return false;
    const sessionId = id.replace('parked-', '');
    const session = sessions.find(s => s.id === sessionId);
    return !session || session.cart.length === 0;
  }, [sessions]);

  const handleDrop = useCallback((id: string, paymentType: 'cash' | 'transfer') => {
    if (id.startsWith('parked-')) {
      if (isSessionEmpty(id)) {
        triggerDropEffect(paymentType === 'cash' ? setCashDropDenied : setTransferDropDenied);
        return;
      }
      const sessionId = id.replace('parked-', '');
      onCheckoutParked(sessionId, paymentType);
    } else {
      onMove(id, 'completed', paymentType);
    }
    triggerDropEffect(paymentType === 'cash' ? setCashDropSuccess : setTransferDropSuccess);
  }, [onCheckoutParked, onMove, isSessionEmpty]);

  // Always call hooks unconditionally — never inside conditional branches
  const cashZone = useDropTarget('paid-cash', useCallback((id) => handleDrop(id, 'cash'), [handleDrop]));
  const transferZone = useDropTarget('paid-transfer', useCallback((id) => handleDrop(id, 'transfer'), [handleDrop]));
  const handleDeleteDrop = useCallback((id: string) => {
    if (id.startsWith('parked-')) {
      const sessionId = id.replace('parked-', '');
      onDeleteSession(sessionId);
    }
    triggerDropEffect(setDeleteDropSuccess);
  }, [onDeleteSession]);
  const deleteZone = useDropTarget('delete-parked', handleDeleteDrop);
  const { startDrag, draggingId } = useDrag();

  return (
    <div
      className="bg-[var(--sidebar-bg)] h-full flex flex-col shrink-0 overflow-hidden relative"
      style={{
        width: open ? '197px' : '35px',
        transition: 'width 200ms ease',
      }}
    >
      {/* Collapsed strip — always rendered, hidden when open */}
      <div
        className="absolute flex flex-col items-center justify-between py-[24px] px-[5px] h-full"
        style={{
          width: '35px',
          opacity: open ? 0 : 1,
          pointerEvents: open ? 'none' : 'auto',
          transition: 'opacity 150ms ease',
        }}
      >
        <button
          onClick={() => setOpen(true)}
          className="w-full h-[52px] shrink-0 flex items-center justify-center bg-[var(--app-surface)] hover:bg-[#FE9A00] rounded-[10px] transition-colors group"
        >
          <ChevronLeft size={18} className="text-[#FE9A00] group-hover:text-black transition-colors" />
        </button>
        <div className="flex-1 flex flex-col gap-[8px] items-center overflow-auto py-[8px]">
          <AnimatePresence mode="popLayout">
            {sessions.map(session => (
              <motion.div
                key={session.id}
                layout
                initial={{ opacity: 0, scale: 0.5, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.5, y: -10 }}
                transition={{ type: 'spring', stiffness: 400, damping: 25 }}
              >
                <button
                  onClick={() => onSwitchSession(session.id)}
                  title={session.editingOrderId ? `Editing order #${session.label}` : `Order ${session.label}`}
                  className={`rounded-[9px] w-[25px] h-[35px] flex items-center justify-center font-['Barlow_Semi_Condensed',sans-serif] font-bold text-[28px] uppercase tracking-[0.6px] leading-[16px] transition-all ${
                    session.editingOrderId
                      ? 'bg-[#f0e2ff]'
                      : session.id === activeSessionId
                        ? 'bg-[#15D2B2] text-black'
                        : 'bg-[#d9d9d9] text-black hover:bg-[#e9e9e9]'
                  }`}
                  style={session.editingOrderId
                    ? { boxShadow: session.id === activeSessionId ? 'inset 0 0 0 2px #7c3fb0' : undefined }
                    : undefined}
                >
                  {session.editingOrderId ? (
                    <motion.span
                      className="flex items-center justify-center"
                      // A slow float, mirrored so the loop has no seam.
                      initial={{ y: -2.5 }}
                      animate={{ y: 2.5 }}
                      transition={{
                        duration: 1.4,
                        repeat: Infinity,
                        repeatType: 'mirror',
                        ease: 'easeInOut',
                      }}
                    >
                      <Pencil size={13} style={{ color: '#7c3fb0' }} strokeWidth={2.6} />
                    </motion.span>
                  ) : (
                    session.label
                  )}
                </button>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>

      {/* Expanded panel — always rendered, hidden when collapsed */}
      <div
        className="flex flex-col h-full w-[197px]"
        style={{
          opacity: open ? 1 : 0,
          pointerEvents: open ? 'auto' : 'none',
          transition: 'opacity 150ms ease',
        }}
      >
        <div className="flex flex-col items-start px-[10px] py-[24px] gap-[18px] flex-1 overflow-hidden">
          <div className="flex items-center gap-[10px] w-full">
            <button
              onClick={() => setOpen(false)}
              className="w-[44px] h-[44px] shrink-0 flex items-center justify-center bg-[var(--app-surface)] hover:bg-[#FE9A00] rounded-[10px] transition-colors group"
            >
              <ChevronRight size={18} className="text-[#FE9A00] group-hover:text-black transition-colors" />
            </button>
            <p className="text-white text-[13px] font-semibold uppercase tracking-[0.6px] leading-[16px]">Parked</p>
            <div
              ref={deleteZone.ref}
              className="ml-auto rounded-[8px] w-[44px] h-[44px] flex items-center justify-center transition-all cursor-pointer relative overflow-hidden"
              style={{
                background: deleteDropSuccess ? '#F9624E' : deleteZone.isOver ? '#F9624E' : '#3d1f1f',
                outline: deleteZone.isActive && !deleteZone.isOver ? '2px dashed rgba(249,98,78,0.4)' : 'none',
              }}
            >
              {deleteDropSuccess ? (
                <motion.span
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 15 }}
                >
                  <CheckCircle2 size={16} className="text-white" />
                </motion.span>
              ) : (
                <Trash2 size={16} className="text-[#b7b7b7]" />
              )}
            </div>
          </div>

          <div className="flex gap-[4px] justify-center w-full">
            <div
              ref={cashZone.ref}
              className="rounded-[8px] w-[84px] h-[67px] flex flex-col items-center justify-center transition-all gap-[4px] relative overflow-hidden"
              style={{
                background: cashDropDenied ? '#8B3A3A' : cashDropSuccess ? '#5BBFB6' : cashZone.isOver ? '#5BBFB6' : '#504040',
                outline: cashZone.isActive && !cashZone.isOver ? '2px dashed rgba(91,191,182,0.4)' : 'none',
              }}
            >
              {cashDropDenied ? (
                <motion.span
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 15 }}
                >
                  <XCircle size={22} className="text-white" />
                </motion.span>
              ) : cashDropSuccess ? (
                <motion.span
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 15 }}
                >
                  <CheckCircle2 size={22} className="text-black" />
                </motion.span>
              ) : (
                <>
                  <Banknote size={18} className={cashZone.isOver ? 'text-black' : 'text-[#b7b7b7]'} />
                  <p className={`text-[10px] uppercase text-center leading-[12px] tracking-[0.6px] font-semibold ${cashZone.isOver ? 'text-black' : 'text-[#b7b7b7]'}`}>Cash</p>
                </>
              )}
            </div>
            <div
              ref={transferZone.ref}
              className="rounded-[8px] w-[84px] h-[67px] flex flex-col items-center justify-center transition-all gap-[4px] relative overflow-hidden"
              style={{
                background: transferDropDenied ? '#8B3A3A' : transferDropSuccess ? '#5BBFB6' : transferZone.isOver ? '#5BBFB6' : '#3d4c58',
                outline: transferZone.isActive && !transferZone.isOver ? '2px dashed rgba(91,191,182,0.4)' : 'none',
              }}
            >
              {transferDropDenied ? (
                <motion.span
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 15 }}
                >
                  <XCircle size={22} className="text-white" />
                </motion.span>
              ) : transferDropSuccess ? (
                <motion.span
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 15 }}
                >
                  <CheckCircle2 size={22} className="text-black" />
                </motion.span>
              ) : (
                <>
                  <Smartphone size={18} className={transferZone.isOver ? 'text-black' : 'text-[#b7b7b7]'} />
                  <p className={`text-[10px] uppercase text-center leading-[12px] tracking-[0.6px] font-semibold ${transferZone.isOver ? 'text-black' : 'text-[#b7b7b7]'}`}>Transfer</p>
                </>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto overflow-x-hidden w-full">
            <div className="flex flex-col gap-[8px]">
              <AnimatePresence mode="popLayout">
                {sessions.map(session => {
                  // Matches what the order will actually come to, discount and tax included.
                  const total = computeTotals(session.cart, session.discount, taxRate).total;
                  const isDragging = draggingId === `parked-${session.id}`;

                  return (
                    <motion.div
                      key={session.id}
                      layout
                      initial={{ opacity: 0, x: 40, scale: 0.9 }}
                      animate={{ opacity: 1, x: 0, scale: 1 }}
                      exit={{ opacity: 0, x: -40, scale: 0.9 }}
                      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                    >
                      <ParkedTicketInline
                        session={session}
                        total={total}
                        isDragging={isDragging}
                        isActive={session.id === activeSessionId}
                        expanded={tapToExpandParked && expandedParkedId === session.id}
                        onSwitchSession={onSwitchSession}
                        onDeleteSession={onDeleteSession}
                        onCheckoutParked={onCheckoutParked}
                        startDragFn={startDrag}
                        onToggleExpand={() => {
                          setExpandedParkedId(prev => prev === session.id ? null : session.id);
                        }}
                        tapToExpandParked={tapToExpandParked}
                      />
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          </div>
        </div>

        {/* Undo and redo used to live down here, 22 pixels wide, which meant
            they existed only in Order Mode and were barely reachable with a
            finger. They are in the top bar now, where every screen can see
            them. This slot goes to the thing that genuinely belongs to the
            parked list. */}
        <div className="px-[10px] py-[10px] border-t border-[rgba(255,255,255,0.1)]">
          <Button
            variant="secondary"
            block
            tone={SECTION_COLOR.order}
            icon={<Plus size={17} />}
            onClick={onNewSession}
            hint={HINT.newOrder}
            data-park-new-order
          >
            New order
          </Button>
        </div>
      </div>
    </div>
  );
}


class ErrorBoundary extends React.Component<{children: React.ReactNode}, {error: Error | null}> {
  constructor(props: {children: React.ReactNode}) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{padding: 40, background: '#09090b', color: '#F9624E', height: '100vh'}}>
          <h1 style={{fontSize: 24, marginBottom: 16}}>Error</h1>
          <pre style={{color: '#9f9fa9', whiteSpace: 'pre-wrap'}}>
            {this.state.error.message}
            {'\n\n'}
            {this.state.error.stack}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
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
