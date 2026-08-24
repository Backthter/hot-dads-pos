import { useCallback, useEffect, useState } from 'react';
import { restoreAction, useHistory } from '../lib/history';
import { buildMovement, formatQuantityLabel, postMovements } from '../lib/inventory';
import { stockUsageForCart } from '../lib/orders';
import type { StateCore } from './core';
import type { StockTakeLine } from '../inventory/StockTakeScreen';
import type {
  CartItem, InventorySnapshot, MenuItem, MenuItemStockAssignment, OversellEvent,
  StockItem, StockMovement, StockMovementReason,
} from '../types';

/**
 * The shelf, and the ledger that explains it.
 *
 * Every function here that changes a quantity also writes the line that
 * accounts for it, and nothing here deletes a line — see docs/03-INVARIANTS.md,
 * invariant 1. That is not a convention this hook could relax: historical stock
 * value, food cost variance, shrinkage and consumption rate are all read back
 * out of this table by replay, and none of them survives a hole in it.
 */

/** One requested change to one stock item, with what caused it. */
export interface StockChange {
  itemId: string;
  delta: number;
  reason: StockMovementReason;
  note?: string;
  referenceType?: StockMovement['referenceType'];
  /** Always an immutable id — an order id, never a display order number. */
  referenceId?: string;
  /** What the whole delivery cost, when this change is a receipt. */
  totalCost?: number;
  /**
   * Cost of one base unit, when the caller already knows it.
   *
   * Used by a restore, which duplicates the original line's cost rather than
   * re-deriving it. Left unset everywhere else, where it is worked out from
   * `totalCost` and what actually landed.
   */
  unitCost?: number;
}

/** One row to reverse: the change it made, and the line that recorded it. */
export interface StockReversal {
  itemId: string;
  /** The delta of the original line. The reversal posts its opposite. */
  delta: number;
  /**
   * The row being reversed, so both halves can be marked. Optional only
   * because a caller may be reversing a change no line survives for; without
   * it the reversal is still excluded from every economic figure, but its
   * original is not, which is the defect ADR-016 exists to prevent.
   */
  movementId?: string;
}

export interface StockDeps {
  /** Recipes. Read to resolve a cart, and cleared when an item is deleted. */
  assignments: MenuItemStockAssignment[];
  setAssignments: (next: MenuItemStockAssignment[]) => void;
  menuItems: MenuItem[];
  /** Gates the daily snapshot: nothing is written before the load has finished. */
  dataLoaded: boolean;
}

export function useStock(core: StateCore, deps: StockDeps) {
  const { snapshot, saveImmediate } = core;
  const history = useHistory();
  const { assignments, setAssignments, menuItems, dataLoaded } = deps;

  const [stockItems, setStockItems] = useState<StockItem[]>([]);
  const [stockMovements, setStockMovements] = useState<StockMovement[]>([]);
  const [inventorySnapshots, setInventorySnapshots] = useState<InventorySnapshot[]>([]);
  const [oversellEvents, setOversellEvents] = useState<OversellEvent[]>([]);

  /* ------------------------------------------------------- the primitives */

  /**
   * The hook's one door to the ledger.
   *
   * Every write goes through `postMovements`, which appends and marks whatever
   * a reversal points back at. The rule lives in `lib/inventory` rather than
   * here so that it is pure and `metrics.check.ts` can hold it to its word —
   * and so that a third write path in this file cannot reintroduce the
   * disagreement ADR-016 fixes.
   */
  const appendMovements = useCallback((lines: StockMovement[]) => {
    if (lines.length === 0) return;
    setStockMovements(prev => postMovements(prev, lines));
  }, []);

  /**
   * Applies a set of stock changes and records one ledger line per item.
   *
   * A receipt that carries `totalCost` also re-averages the item's cost per
   * unit: what is on the shelf at the old cost, plus what just arrived at the
   * new one, over the combined quantity. That is the only way a cost figure
   * stays true without anyone remembering to maintain it — and every margin in
   * the analytics layer depends on it.
   *
   * Returns the lines it wrote. A caller that may later have to reverse itself
   * needs their ids: reversing by matching a negative row against a prior
   * positive one is the inference ADR-016 rejects, because a ledger trim can
   * leave nothing to match against.
   */
  const applyStockChanges = useCallback((changes: StockChange[]): StockMovement[] => {
    if (changes.length === 0) return [];
    const current = snapshot.current.stockItems;
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

        let unitCost: number | undefined = change.unitCost;
        if (change.totalCost !== undefined && change.totalCost > 0 && applied > 0) {
          unitCost ??= change.totalCost / applied;
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
    appendMovements(movements);
    return movements;
  }, [snapshot, appendMovements]);

  /**
   * Puts the shelf back where it was by appending reversing lines.
   *
   * This is the whole reason undo stores actions rather than snapshots. The
   * stock ledger is append-only on purpose: every line records the level it
   * left behind, which is what makes it possible to say what was on the shelf
   * at any past moment. Undoing a delivery by deleting the line that recorded
   * it would quietly rewrite that history — and worse, would leave the count on
   * the shelf disagreeing with the sum of the lines that produced it. So an
   * undo posts the opposite movement.
   *
   * What it posts is a `reversal`, not a `correction` (ADR-016). A correction
   * is a person saying the shelf disagrees with the book — a measurement, and
   * under ADR-014 definitively not a purchase. The program undoing itself is
   * neither, and using the same word for both is what let an undone delivery
   * go on being counted as money spent: the original stayed a purchase and the
   * line cancelling it counted as nothing.
   */
  const reverseStockChanges = useCallback((
    changes: StockReversal[],
    note = 'Undone',
  ): StockMovement[] => {
    return applyStockChanges(changes
      .filter(c => c.delta !== 0)
      .map(c => ({
        itemId: c.itemId,
        delta: -c.delta,
        reason: 'reversal' as StockMovementReason,
        note,
        // Points at the row this cancels, so `appendMovements` can mark it.
        referenceType: c.movementId ? ('movement' as const) : undefined,
        referenceId: c.movementId,
      })));
  }, [applyStockChanges]);

  /**
   * Replaces the item list outright and posts the ledger lines that account for
   * however much the counts moved.
   *
   * Used where more than the quantity changed — an item renamed and recounted
   * in the same edit, say. `reverseStockChanges` cannot serve here because it
   * works out the new list from the old one, so it would faithfully undo the
   * count while leaving the rename in place.
   *
   * `reason` is the caller's, because this is a third write path and the two
   * cases it serves are opposite ones. Undoing an edit is a `reversal` and
   * carries the id of the line it cancels; redoing one is an `edit` again,
   * which is a live event. Both go through `appendMovements`, so the marking
   * rule is the same one every other path uses (ADR-016).
   */
  const applyItemsWithCorrection = useCallback((
    nextItems: StockItem[],
    corrections: { itemId: string; delta: number; movementId?: string }[],
    note: string,
    reason: StockMovementReason = 'correction',
  ): StockMovement[] => {
    const previous = snapshot.current.stockItems;
    setStockItems(nextItems);
    const lines = corrections
      .filter(c => c.delta !== 0)
      .map(c => {
        const from = previous.find(s => s.id === c.itemId);
        if (!from) return null;
        const line: StockMovement = {
          ...buildMovement(from, c.delta, reason, note),
          referenceType: c.movementId ? 'movement' : undefined,
          referenceId: c.movementId,
        };
        return line;
      })
      .filter((m): m is StockMovement => m !== null);
    appendMovements(lines);
    return lines;
  }, [snapshot, appendMovements]);

  /* --------------------------------------------------------- carts & orders */

  /** Consumes a cart's ingredients, linked to the order by its immutable id. */
  const deductStockForCart = useCallback((cart: CartItem[], orderId: string, note?: string) => {
    const usage = stockUsageForCart(cart, menuItems, assignments);
    applyStockChanges([...usage].map(([itemId, used]) => ({
      itemId,
      delta: -used,
      reason: 'sold' as StockMovementReason,
      note,
      referenceType: 'order' as const,
      referenceId: orderId,
    })));
  }, [applyStockChanges, menuItems, assignments]);

  /** Gives a voided order's ingredients back, linked to the same order. */
  const returnStockForCart = useCallback((cart: CartItem[], orderId: string, note?: string) => {
    const usage = stockUsageForCart(cart, menuItems, assignments);
    applyStockChanges([...usage].map(([itemId, used]) => ({
      itemId,
      delta: used,
      reason: 'returned' as StockMovementReason,
      note,
      referenceType: 'order' as const,
      referenceId: orderId,
    })));
  }, [applyStockChanges, menuItems, assignments]);

  /* ------------------------------------------------------------- the items */

  const addStockItem = useCallback(async (item: StockItem) => {
    setStockItems(prev => [...prev, item]);
    await saveImmediate({ stockItems: [...snapshot.current.stockItems, item] });
  }, [snapshot, saveImmediate]);

  const updateStockItem = useCallback(async (id: string, patch: Partial<StockItem>) => {
    setStockItems(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s));
    await saveImmediate({
      stockItems: snapshot.current.stockItems.map(s => s.id === id ? { ...s, ...patch } : s),
    });
  }, [snapshot, saveImmediate]);

  const deleteStockItem = useCallback(async (id: string) => {
    const beforeItems = snapshot.current.stockItems;
    const beforeAssignments = snapshot.current.stockAssignments;
    const removed = beforeItems.find(s => s.id === id);
    const afterItems = beforeItems.filter(s => s.id !== id);
    const afterAssignments = beforeAssignments.filter(a => a.stockItemId !== id);

    setStockItems(afterItems);
    setAssignments(afterAssignments);

    // Removing an item takes its recipe links with it, so putting it back has
    // to restore both or the menu items that used it stay silently uncosted.
    history.record({
      label: `Removed ${removed?.name ?? 'a stock item'}`,
      scope: 'stock',
      undo: () => { setStockItems(beforeItems); setAssignments(beforeAssignments); },
      redo: () => { setStockItems(afterItems); setAssignments(afterAssignments); },
    });

    await saveImmediate({ stockItems: afterItems, stockAssignments: afterAssignments });
  }, [snapshot, saveImmediate, history, setAssignments]);

  /**
   * Manual add, packet add, waste, correction or stock take from the inventory
   * screen. `totalCost` is what the delivery cost, and only applies to receipts.
   */
  const adjustStock = useCallback(async (
    itemId: string, delta: number, reason: StockMovementReason, note?: string, totalCost?: number,
  ) => {
    const item = snapshot.current.stockItems.find(s => s.id === itemId);
    /**
     * The lines currently standing for this change.
     *
     * Undo reverses whatever is standing, not whatever was written the first
     * time. A redo appends a fresh live line, so the next undo has to cancel
     * *that* one — reversing the original a second time would mark a row that
     * is already marked and leave the redo counted as a live purchase for ever.
     */
    let standing = applyStockChanges([{ itemId, delta, reason, note, totalCost }]);

    if (item && delta !== 0) {
      const amount = formatQuantityLabel(Math.abs(delta), item.unit);
      history.record({
        label: `${delta > 0 ? 'Added' : 'Took out'} ${amount} of ${item.name}`,
        scope: 'stock',
        confirm: reason === 'waste'
          ? `This will put ${amount} of ${item.name} back on the shelf, as though the waste had never been written off.`
          : undefined,
        undo: () => {
          reverseStockChanges(
            standing.map(m => ({ itemId: m.stockItemId, delta: m.delta, movementId: m.id })));
          standing = [];
        },
        // A redo restores the original's meaning: same reason, same cost, a
        // live line of its own (ADR-016). The undone pair stays netted out.
        redo: () => {
          standing = applyStockChanges([{ itemId, delta, reason, note, totalCost }]);
        },
      });
    }
    await saveImmediate();
  }, [snapshot, saveImmediate, history, applyStockChanges, reverseStockChanges]);

  const saveStockItem = useCallback(async (item: StockItem) => {
    const before = snapshot.current.stockItems;
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
    // The line standing for the count, so undo can cancel the one that is
    // actually there rather than the one written first. See `adjustStock`.
    let standing: StockMovement[] = [];
    if (delta !== 0) {
      standing = [buildMovement(existing, delta, 'edit')];
      appendMovements(standing);
    }
    history.record({
      label: `Edited ${item.name}`,
      scope: 'stock',
      // Fields and count go back together in one step: the list is set
      // outright and the ledger is told about the count on its own.
      undo: () => {
        applyItemsWithCorrection(
          before,
          standing.map(m => ({ itemId: m.stockItemId, delta: -m.delta, movementId: m.id })),
          'Edit undone',
          'reversal',
        );
        standing = [];
      },
      redo: () => {
        standing = applyItemsWithCorrection(
          next, [{ itemId: item.id, delta }], 'Edit redone', 'edit');
      },
    });
    await saveImmediate({ stockItems: next });
  }, [snapshot, saveImmediate, history, applyItemsWithCorrection, appendMovements]);

  const setPacket = useCallback(async (
    itemId: string, size: number | null, label?: string, cost?: number,
  ) => {
    const before = snapshot.current.stockItems;
    const target = before.find(s => s.id === itemId);
    const next = snapshot.current.stockItems.map(s => (
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
  }, [snapshot, saveImmediate, history]);

  /* ------------------------------------------------------------ the ledger */

  /**
   * Undo appends a compensating line rather than deleting the original.
   *
   * The screen still reads as though the mistake never happened — both lines
   * are marked and hidden from the activity list — but the ledger stays
   * append-only, which is what lets historical stock be reconstructed at all.
   * Whatever undo/redo becomes later has to keep that property.
   *
   * This used to hand-roll the reversal and the marking, and
   * `reverseStockChanges` hand-rolled a different one. They happened to agree
   * about the shelf and disagreed about the books. There is now one path, and
   * this is a caller of it (ADR-016).
   */
  const undoMovement = useCallback(async (movementId: string) => {
    const movement = snapshot.current.stockMovements.find(m => m.id === movementId);
    if (!movement || movement.reversed) return;
    const item = snapshot.current.stockItems.find(s => s.id === movement.stockItemId);
    if (!item) return;

    reverseStockChanges(
      [{ itemId: movement.stockItemId, delta: movement.delta, movementId: movement.id }],
      'Undone',
    );

    /**
     * Restoring the delivery must restore what it *meant*, not merely its
     * quantity.
     *
     * Posting the opposite of the reversal would append a second `reversal`
     * carrying no cost, so an undone-then-restored Rs 8,000 delivery would sit
     * on the shelf and be invisible to `stockPurchasesValue` and therefore to
     * food cost. Instead this appends a line duplicating the original's
     * semantics — the same reason and the same cost — pointing back at it. The
     * original and its reversal stay netted out and the new line is a live
     * receipt, counted exactly once. Append-only, no pairing, survives a trim.
     */
    const restoreChange: StockChange = {
      itemId: movement.stockItemId,
      delta: movement.delta,
      reason: movement.reason,
      note: 'Restored',
      referenceType: 'movement',
      referenceId: movement.id,
      unitCost: movement.unitCost,
      totalCost: movement.totalCost,
    };

    // What is standing for this delivery right now. Nothing, until a restore.
    let standing: StockMovement[] = [];
    const named = item;
    history.record({
      label: `Undid a stock change to ${named.name}`,
      scope: 'stock',
      undo: () => { standing = applyStockChanges([restoreChange]); },
      redo: () => {
        reverseStockChanges(
          standing.map(m => ({ itemId: m.stockItemId, delta: m.delta, movementId: m.id })),
          'Undone',
        );
        standing = [];
      },
    });

    await saveImmediate();
  }, [snapshot, saveImmediate, history, reverseStockChanges, applyStockChanges]);

  /**
   * Records a count. Each line writes the difference between what was counted
   * and what the books said, as a `stocktake` movement — the books are never
   * silently overwritten, because the variance *is* the finding: waste, theft,
   * over-portioning and mis-keyed deliveries all show up here and nowhere else.
   */
  const stockTake = useCallback(async (lines: StockTakeLine[], note: string) => {
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
    let standing = applyStockChanges(changes);

    history.record({
      label: `Recorded a stock count of ${changes.length} item${changes.length === 1 ? '' : 's'}`,
      scope: 'stock',
      confirm:
        'A count is a measurement of what was really on the shelf, and the difference against what the app expected is where waste and over-portioning show up. Undoing it throws that finding away.',
      undo: () => {
        reverseStockChanges(
          standing.map(m => ({ itemId: m.stockItemId, delta: m.delta, movementId: m.id })),
          'Count undone');
        standing = [];
      },
      // A recounted count is a count again, not a reversal: it reaches
      // shrinkage variance, which is the whole finding.
      redo: () => { standing = applyStockChanges(changes); },
    });

    await saveImmediate();
  }, [saveImmediate, history, applyStockChanges, reverseStockChanges]);

  /**
   * Empties stock deliberately — one item, or the whole shelf.
   *
   * Written as ordinary movements rather than by setting quantities to zero, so
   * what left is still visible in the history and still valued as a loss in the
   * shrinkage figure. A market that ends with thirty buns thrown away has lost
   * the price of thirty buns, and silently zeroing them would report that as
   * costing nothing.
   */
  const drainStock = useCallback(async (itemIds: string[], note = 'Drained') => {
    const items = snapshot.current.stockItems.filter(
      s => itemIds.includes(s.id) && s.quantity > 0,
    );
    if (items.length === 0) return;

    const changes = items.map(item => ({
      itemId: item.id,
      delta: -item.quantity,
      reason: 'drained' as StockMovementReason,
      note,
    }));
    let standing = applyStockChanges(changes);

    history.record({
      label: items.length === 1
        ? `Drained ${items[0].name}`
        : `Drained ${items.length} stock items`,
      scope: 'stock',
      confirm: items.length === 1
        ? `This puts ${formatQuantityLabel(items[0].quantity, items[0].unit)} of ${items[0].name} back on the shelf, as though it had never been emptied.`
        : `This puts everything back on the shelf across ${items.length} items, as though the shelf had never been emptied.`,
      undo: () => {
        reverseStockChanges(
          standing.map(m => ({ itemId: m.stockItemId, delta: m.delta, movementId: m.id })),
          'Drain undone');
        standing = [];
      },
      // Draining again is a real write-off again, and still valued as a loss.
      redo: () => { standing = applyStockChanges(changes); },
    });

    await saveImmediate();
  }, [snapshot, saveImmediate, history, applyStockChanges, reverseStockChanges]);

  /* ---------------------------------------------------------- oversells */

  /**
   * Records a sale the stock could not support, at the moment it happened.
   *
   * This is demand that exceeded supply — normally it has to be inferred from
   * suspicious runs of zero sales, and a forecast trained on the raw numbers
   * systematically under-predicts exactly the items that keep running out.
   * Here it is measured directly.
   */
  const logOversell = useCallback((
    menuItem: MenuItem, bottleneckStockItemId: string | undefined,
  ) => {
    setOversellEvents(prev => [...prev, {
      id: `os-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      menuItemId: menuItem.id,
      menuItemName: menuItem.name,
      quantity: 1,
      bottleneckStockItemId,
      timestamp: Date.now(),
    }]);
  }, []);

  /**
   * Claims every oversell logged while a cart was being built for the order
   * that resulted, and reports how many of each menu item they came to.
   *
   * Without the link they are free-floating events that cannot be drilled into.
   */
  const claimPendingOversells = useCallback((orderId: string): Map<string, number> => {
    const pending = snapshot.current.oversellEvents.filter(e => !e.orderId);
    const byMenuItem = new Map<string, number>();
    if (pending.length === 0) return byMenuItem;
    for (const event of pending) {
      byMenuItem.set(event.menuItemId, (byMenuItem.get(event.menuItemId) ?? 0) + event.quantity);
    }
    setOversellEvents(prev => prev.map(e => (e.orderId ? e : { ...e, orderId })));
    return byMenuItem;
  }, [snapshot]);

  /* ---------------------------------------------------------- bulk changes */

  const hydrate = useCallback((next: {
    stockItems: StockItem[];
    stockMovements: StockMovement[];
    inventorySnapshots: InventorySnapshot[];
    oversellEvents: OversellEvent[];
  }) => {
    setStockItems(next.stockItems);
    setStockMovements(next.stockMovements);
    setInventorySnapshots(next.inventorySnapshots);
    setOversellEvents(next.oversellEvents);
  }, []);

  /** After a history wipe. The items themselves survive unless everything goes. */
  const clearHistory = useCallback(() => {
    setStockMovements([]);
    setInventorySnapshots([]);
    setOversellEvents([]);
  }, []);

  const clearItems = useCallback(() => {
    setStockItems([]);
  }, []);

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

  return {
    state: { stockItems, stockMovements, inventorySnapshots, oversellEvents },
    actions: {
      hydrate,
      clearHistory,
      clearItems,
      applyStockChanges,
      reverseStockChanges,
      applyItemsWithCorrection,
      deductStockForCart,
      returnStockForCart,
      addStockItem,
      updateStockItem,
      deleteStockItem,
      adjustStock,
      saveStockItem,
      setPacket,
      undoMovement,
      stockTake,
      drainStock,
      logOversell,
      claimPendingOversells,
    },
  };
}

export type StockHandle = ReturnType<typeof useStock>;
