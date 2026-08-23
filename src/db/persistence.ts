import { getDb } from './database';
import type {
  MenuItem, Category, Order, CartItem, ParkedSession, StockItem, MenuItemStockAssignment,
  DealItem, Discount, StockMovement, InventorySnapshot, OversellEvent,
  TradingEvent, TradingSession, CostEntry,
} from '../app/types';

export interface PersistedData {
  menuItems: MenuItem[];
  categories: Category[];
  orders: Order[];
  parkedSessions: ParkedSession[];
  stockItems: StockItem[];
  stockAssignments: MenuItemStockAssignment[];
  stockMovements?: StockMovement[];
  inventorySnapshots?: InventorySnapshot[];
  oversellEvents?: OversellEvent[];
  /** Trading sessions and their event grouping. */
  tradingSessions?: TradingSession[];
  tradingEvents?: TradingEvent[];
  costEntries?: CostEntry[];
  orderCounter: number;
}

const DB_VERSION = '6';
let saveQueue: Promise<void> = Promise.resolve();

function parseDealItems(raw: string | null | undefined): DealItem[] {
  try {
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseCartItems(rows: Record<string, unknown>[]): CartItem[] {
  return rows.map(r => ({
    menuItemId: String(r.menu_item_id ?? ''),
    name: String(r.name ?? ''),
    price: Number(r.price ?? 0),
    quantity: Number(r.quantity ?? 1),
    dealItems: parseDealItems(r.deal_items as string | null | undefined),
    // NULL means the line was never costed. Reading it as 0 would silently
    // report a 100% margin on every order taken before costing existed.
    unitCost: r.unit_cost == null ? undefined : Number(r.unit_cost),
    oversoldQuantity: Number(r.oversold_quantity ?? 0) || undefined,
  }));
}

/**
 * One-time repair: deals used to reference their components by name only, so a
 * rename broke them retroactively. Fill in the id wherever the name still
 * resolves; anything that no longer matches is left alone rather than guessed.
 */
function linkDealItems(menuItems: MenuItem[]): MenuItem[] {
  const byName = new Map(menuItems.map(mi => [mi.name.toLowerCase(), mi.id]));
  return menuItems.map(item => {
    if (!item.dealItems?.length) return item;
    let changed = false;
    const linked = item.dealItems.map(component => {
      if (component.menuItemId) return component;
      const id = byName.get(component.name.toLowerCase());
      if (!id) return component;
      changed = true;
      return { ...component, menuItemId: id };
    });
    return changed ? { ...item, dealItems: linked } : item;
  });
}

function parseDiscount(kind: unknown, value: unknown): Discount | undefined {
  if (kind !== 'flat' && kind !== 'percent') return undefined;
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric) || numeric <= 0) return undefined;
  return { kind, value: numeric };
}

function parseOrders(rows: Record<string, unknown>[], itemsByOrderId: Record<string, Record<string, unknown>[]>): Order[] {
  return rows.map((r, index) => {
    const total = Number(r.total ?? 0);
    const subtotalRaw = Number(r.subtotal ?? 0);
    const discountAmount = Number(r.discount_amount ?? 0);
    const seqRaw = Number(r.seq ?? 0);
    const seq = seqRaw > 0 ? seqRaw : index + 1;
    return {
      id: String(r.id ?? ''),
      seq,
      orderNumber: String(r.order_number ?? String(seq).padStart(2, '0')),
      customerName: String(r.customer_name ?? 'Customer'),
      items: parseCartItems(itemsByOrderId[String(r.id)] || []),
      notes: String(r.notes ?? ''),
      status: (r.status as Order['status']) || 'preparing',
      subtotal: subtotalRaw > 0 ? subtotalRaw : total + discountAmount - Number(r.tax_amount ?? 0),
      discount: parseDiscount(r.discount_kind, r.discount_value),
      discountAmount,
      taxRate: Number(r.tax_rate ?? 0),
      taxAmount: Number(r.tax_amount ?? 0),
      total,
      timestamp: Number(r.timestamp ?? 0),
      editedAt: r.edited_at != null ? Number(r.edited_at) : undefined,
      editCount: Number(r.edit_count ?? 0) || undefined,
      paid: (r.paid as Order['paid']) || undefined,
      voidedAt: r.voided_at != null ? Number(r.voided_at) : undefined,
      voidReason: r.void_reason ? String(r.void_reason) : undefined,
      grilledAt: r.grilled_at != null ? Number(r.grilled_at) : undefined,
      readyAt: r.ready_at != null ? Number(r.ready_at) : undefined,
      completedAt: r.completed_at != null ? Number(r.completed_at) : undefined,
      sessionId: r.session_id ? String(r.session_id) : undefined,
      sessionTicket: r.session_ticket != null ? Number(r.session_ticket) : undefined,
    };
  });
}

export async function loadAllData(): Promise<PersistedData | null> {
  try {
    console.log("[PERSIST] loadAllData start");
    const db = await getDb();

    const versionRows = await db.select<Record<string, unknown>[]>(
      "SELECT value FROM app_state WHERE key = 'db_version'"
    );
    console.log("[PERSIST] db_version rows:", versionRows.length);
    if (versionRows.length === 0) {
      console.log("[PERSIST] no db_version found, returning null");
      return null;
    }
    console.log("[PERSIST] db_version found, loading data");

    const categoryRows = await db.select<Record<string, unknown>[]>('SELECT id, name, category_order FROM app_categories ORDER BY category_order');
    const categories: Category[] = categoryRows.map(r => ({
      id: String(r.id ?? ''),
      name: String(r.name ?? ''),
      order: Number(r.category_order ?? 0),
    }));

    const menuItemRows = await db.select<Record<string, unknown>[]>('SELECT id, name, price, show_in_order_mode, category, deal_items FROM menu_items');
    const rawMenuItems: MenuItem[] = menuItemRows.map(r => ({
      id: String(r.id ?? ''),
      name: String(r.name ?? ''),
      price: Number(r.price ?? 0),
      showInOrderMode: Boolean(Number(r.show_in_order_mode ?? 1)),
      category: String(r.category ?? ''),
      dealItems: parseDealItems(r.deal_items as string | null | undefined),
    }));
    const menuItems = linkDealItems(rawMenuItems);

    const orderRows = await db.select<Record<string, unknown>[]>('SELECT id, seq, order_number, customer_name, notes, status, subtotal, discount_kind, discount_value, discount_amount, tax_rate, tax_amount, total, timestamp, edited_at, edit_count, paid, voided_at, void_reason, grilled_at, ready_at, completed_at, session_id, session_ticket FROM orders ORDER BY timestamp');
    const orderItemRows = await db.select<Record<string, unknown>[]>('SELECT order_id, menu_item_id, name, price, quantity, deal_items, unit_cost, oversold_quantity FROM order_items');
    const itemsByOrderId: Record<string, Record<string, unknown>[]> = {};
    for (const item of orderItemRows) {
      const oid = String(item.order_id ?? '');
      if (!itemsByOrderId[oid]) itemsByOrderId[oid] = [];
      itemsByOrderId[oid].push(item);
    }
    const orders = parseOrders(orderRows, itemsByOrderId);

    const sessionRows = await db.select<Record<string, unknown>[]>('SELECT id, label, notes, last_modified, discount_kind, discount_value, editing_order_id FROM parked_sessions ORDER BY last_modified DESC');
    const sessionItemRows = await db.select<Record<string, unknown>[]>('SELECT session_id, menu_item_id, name, price, quantity, deal_items FROM parked_session_cart_items');
    const itemsBySessionId: Record<string, Record<string, unknown>[]> = {};
    for (const item of sessionItemRows) {
      const sid = String(item.session_id ?? '');
      if (!itemsBySessionId[sid]) itemsBySessionId[sid] = [];
      itemsBySessionId[sid].push(item);
    }
    const parkedSessions: ParkedSession[] = sessionRows.map(r => ({
      id: String(r.id ?? ''),
      label: String(r.label ?? ''),
      cart: parseCartItems(itemsBySessionId[String(r.id)] || []),
      notes: String(r.notes ?? ''),
      lastModified: Number(r.last_modified ?? Date.now()),
      discount: parseDiscount(r.discount_kind, r.discount_value),
      editingOrderId: r.editing_order_id ? String(r.editing_order_id) : undefined,
    }));

    const stockRows = await db.select<Record<string, unknown>[]>('SELECT id, name, quantity, unit, low_stock_threshold, cost_per_unit, packet_size, packet_label, packet_cost, icon_id, cost_updated_at FROM stock_items');
    const stockItemsList: StockItem[] = stockRows.map(r => ({
      id: String(r.id ?? ''),
      name: String(r.name ?? ''),
      quantity: Number(r.quantity ?? 0),
      unit: String(r.unit ?? 'pcs'),
      lowStockThreshold: Number(r.low_stock_threshold ?? 0),
      costPerUnit: Number(r.cost_per_unit ?? 0),
      packetSize: Number(r.packet_size ?? 0) > 0 ? Number(r.packet_size) : undefined,
      packetLabel: r.packet_label ? String(r.packet_label) : undefined,
      packetCost: r.packet_cost != null ? Number(r.packet_cost) : undefined,
      iconId: r.icon_id ? String(r.icon_id) : undefined,
      costUpdatedAt: r.cost_updated_at != null ? Number(r.cost_updated_at) : undefined,
    }));

    const movementRows = await db.select<Record<string, unknown>[]>(
      'SELECT id, stock_item_id, delta, resulting, reason, note, reference_type, reference_id, unit_cost, total_cost, reversed, timestamp FROM stock_movements ORDER BY timestamp'
    );
    const stockMovements: StockMovement[] = movementRows.map(r => ({
      id: String(r.id ?? ''),
      stockItemId: String(r.stock_item_id ?? ''),
      delta: Number(r.delta ?? 0),
      resulting: Number(r.resulting ?? 0),
      reason: (r.reason as StockMovement['reason']) || 'added',
      note: r.note ? String(r.note) : undefined,
      referenceType: (r.reference_type as StockMovement['referenceType']) || undefined,
      referenceId: r.reference_id ? String(r.reference_id) : undefined,
      unitCost: r.unit_cost != null ? Number(r.unit_cost) : undefined,
      totalCost: r.total_cost != null ? Number(r.total_cost) : undefined,
      reversed: Number(r.reversed ?? 0) === 1 ? true : undefined,
      timestamp: Number(r.timestamp ?? 0),
    }));

    const snapshotRows = await db.select<Record<string, unknown>[]>(
      'SELECT snapshot_date, stock_item_id, quantity, unit_cost, value FROM inventory_snapshots ORDER BY snapshot_date'
    );
    const inventorySnapshots: InventorySnapshot[] = snapshotRows.map(r => ({
      date: String(r.snapshot_date ?? ''),
      stockItemId: String(r.stock_item_id ?? ''),
      quantity: Number(r.quantity ?? 0),
      unitCost: Number(r.unit_cost ?? 0),
      value: Number(r.value ?? 0),
    }));

    const oversellRows = await db.select<Record<string, unknown>[]>(
      'SELECT id, menu_item_id, menu_item_name, quantity, bottleneck_stock_item_id, order_id, timestamp FROM oversell_events ORDER BY timestamp'
    );
    const oversellEvents: OversellEvent[] = oversellRows.map(r => ({
      id: String(r.id ?? ''),
      menuItemId: String(r.menu_item_id ?? ''),
      menuItemName: String(r.menu_item_name ?? ''),
      quantity: Number(r.quantity ?? 1),
      bottleneckStockItemId: r.bottleneck_stock_item_id ? String(r.bottleneck_stock_item_id) : undefined,
      orderId: r.order_id ? String(r.order_id) : undefined,
      timestamp: Number(r.timestamp ?? 0),
    }));

    const assignRows = await db.select<Record<string, unknown>[]>('SELECT menu_item_id, stock_item_id, quantity_per_item FROM stock_assignments');
    const stockAssignments: MenuItemStockAssignment[] = assignRows.map(r => ({
      menuItemId: String(r.menu_item_id ?? ''),
      stockItemId: String(r.stock_item_id ?? ''),
      quantityPerItem: Number(r.quantity_per_item ?? 1),
    }));

    const eventRows = await db.select<Record<string, unknown>[]>(
      'SELECT id, name, notes, created_at FROM trading_events ORDER BY created_at'
    );
    const tradingEvents: TradingEvent[] = eventRows.map(r => ({
      id: String(r.id ?? ''),
      name: String(r.name ?? ''),
      notes: r.notes ? String(r.notes) : undefined,
      createdAt: Number(r.created_at ?? 0),
    }));

    const tradingSessionRows = await db.select<Record<string, unknown>[]>(
      'SELECT id, event_id, name, status, started_at, ended_at, ticket_counter, paused_ms, paused_at, notes FROM trading_sessions ORDER BY started_at'
    );
    const tradingSessions: TradingSession[] = tradingSessionRows.map(r => ({
      id: String(r.id ?? ''),
      eventId: r.event_id ? String(r.event_id) : undefined,
      name: String(r.name ?? ''),
      status: (r.status as TradingSession['status']) || 'ended',
      startedAt: Number(r.started_at ?? 0),
      endedAt: r.ended_at != null ? Number(r.ended_at) : undefined,
      ticketCounter: Number(r.ticket_counter ?? 0),
      pausedMs: Number(r.paused_ms ?? 0),
      pausedAt: r.paused_at != null ? Number(r.paused_at) : undefined,
      notes: r.notes ? String(r.notes) : undefined,
    }));

    const costRows = await db.select<Record<string, unknown>[]>(
      'SELECT id, session_id, amount, note, kind, timestamp FROM cost_entries ORDER BY timestamp'
    );
    const costEntries: CostEntry[] = costRows.map(r => ({
      id: String(r.id ?? ''),
      sessionId: r.session_id ? String(r.session_id) : undefined,
      amount: Number(r.amount ?? 0),
      note: String(r.note ?? ''),
      kind: r.kind === 'variable' ? 'variable' : 'fixed',
      timestamp: Number(r.timestamp ?? 0),
    }));

    const stateRows = await db.select<Record<string, unknown>[]>("SELECT value FROM app_state WHERE key = 'order_counter'");
    const orderCounter = stateRows.length > 0 ? Number((stateRows[0] as Record<string, unknown>).value ?? 1) : 1;

    const loaded = { menuItems: menuItems.length, categories: categories.length, orders: orders.length, parkedSessions: parkedSessions.length, stockItems: stockItemsList.length, tradingSessions: tradingSessions.length, orderCounter };
    console.log("[PERSIST] loadAllData complete:", loaded);
    return {
      menuItems, categories, orders, parkedSessions, stockItems: stockItemsList,
      stockAssignments, stockMovements, inventorySnapshots, oversellEvents,
      tradingSessions, tradingEvents, costEntries, orderCounter,
    };
  } catch (err) {
    console.error('[PERSIST] loadAllData failed:', err);
    return null;
  }
}

async function runSave(data: PersistedData): Promise<void> {
  console.log("[PERSIST] runSave start, queue length:", data.menuItems.length, "items,", data.orders.length, "orders");
  try {
    const db = await getDb();

    // Use differential updates: DELETE only removed rows, INSERT OR REPLACE the rest.
    // This reduces noise in the sync extension's change tracking.

    // --- app_categories ---
    const oldCatIds = (await db.select<{id: string}[]>(
      "SELECT id FROM app_categories"
    )).map(r => r.id);
    const newCatIds = new Set(data.categories.map(c => c.id));
    for (const id of oldCatIds) {
      if (!newCatIds.has(id)) {
        await db.execute("DELETE FROM app_categories WHERE id = ?", [id]);
      }
    }
    for (const cat of data.categories) {
      await db.execute(
        'INSERT OR REPLACE INTO app_categories (id, name, category_order) VALUES (?, ?, ?)',
        [cat.id, cat.name, cat.order]
      );
    }

    // --- menu_items ---
    const oldMenuItemIds = (await db.select<{id: string}[]>(
      "SELECT id FROM menu_items"
    )).map(r => r.id);
    const newMenuItemIds = new Set(data.menuItems.map(i => i.id));
    for (const id of oldMenuItemIds) {
      if (!newMenuItemIds.has(id)) {
        await db.execute("DELETE FROM menu_items WHERE id = ?", [id]);
      }
    }
    for (const item of data.menuItems) {
      await db.execute(
        'INSERT OR REPLACE INTO menu_items (id, name, price, show_in_order_mode, category, deal_items) VALUES (?, ?, ?, ?, ?, ?)',
        [item.id, item.name, item.price, item.showInOrderMode ? 1 : 0, item.category, JSON.stringify(item.dealItems || [])]
      );
    }

    // --- orders + order_items ---
    // Orders are never removed here. Cancelling an order voids it, which is a
    // column, so a row that disappears from state can only mean a bug — and
    // deleting it would take yesterday's revenue with it.
    for (const order of data.orders) {
      await db.execute(
        'INSERT OR REPLACE INTO orders (id, seq, order_number, customer_name, notes, status, subtotal, discount_kind, discount_value, discount_amount, tax_rate, tax_amount, total, timestamp, edited_at, edit_count, paid, voided_at, void_reason, grilled_at, ready_at, completed_at, session_id, session_ticket) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          order.id, order.seq, order.orderNumber, order.customerName, order.notes, order.status,
          order.subtotal, order.discount?.kind ?? null, order.discount?.value ?? null,
          order.discountAmount ?? 0, order.taxRate ?? 0, order.taxAmount ?? 0,
          order.total, order.timestamp, order.editedAt ?? null, order.editCount ?? 0,
          order.paid ?? null,
          order.voidedAt ?? null, order.voidReason ?? null,
          order.grilledAt ?? null, order.readyAt ?? null, order.completedAt ?? null,
          order.sessionId ?? null, order.sessionTicket ?? null,
        ]
      );
      // Replace all items for this order
      await db.execute("DELETE FROM order_items WHERE order_id = ?", [order.id]);
      for (const item of order.items) {
        await db.execute(
          'INSERT OR REPLACE INTO order_items (order_id, menu_item_id, name, price, quantity, deal_items, unit_cost, oversold_quantity) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [
            order.id, item.menuItemId, item.name, item.price, item.quantity,
            JSON.stringify(item.dealItems || []),
            item.unitCost ?? null, item.oversoldQuantity ?? 0,
          ]
        );
      }
    }

    // --- parked_sessions + parked_session_cart_items ---
    const oldSessionIds = (await db.select<{id: string}[]>(
      "SELECT id FROM parked_sessions"
    )).map(r => r.id);
    const newSessionIds = new Set(data.parkedSessions.map(s => s.id));
    for (const id of oldSessionIds) {
      if (!newSessionIds.has(id)) {
        await db.execute("DELETE FROM parked_session_cart_items WHERE session_id = ?", [id]);
        await db.execute("DELETE FROM parked_sessions WHERE id = ?", [id]);
      }
    }
    for (const session of data.parkedSessions) {
      await db.execute(
        'INSERT OR REPLACE INTO parked_sessions (id, label, notes, last_modified, discount_kind, discount_value, editing_order_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [
          session.id, session.label, session.notes, session.lastModified,
          session.discount?.kind ?? null, session.discount?.value ?? null,
          session.editingOrderId ?? null,
        ]
      );
      await db.execute("DELETE FROM parked_session_cart_items WHERE session_id = ?", [session.id]);
      for (const item of session.cart) {
        await db.execute(
          'INSERT OR REPLACE INTO parked_session_cart_items (session_id, menu_item_id, name, price, quantity, deal_items) VALUES (?, ?, ?, ?, ?, ?)',
          [session.id, item.menuItemId, item.name, item.price, item.quantity, JSON.stringify(item.dealItems || [])]
        );
      }
    }

    // --- stock_items ---
    const oldStockIds = (await db.select<{id: string}[]>(
      "SELECT id FROM stock_items"
    )).map(r => r.id);
    const newStockIds = new Set(data.stockItems.map(i => i.id));
    for (const id of oldStockIds) {
      if (!newStockIds.has(id)) {
        await db.execute("DELETE FROM stock_assignments WHERE stock_item_id = ?", [id]);
        await db.execute("DELETE FROM stock_items WHERE id = ?", [id]);
      }
    }
    for (const item of data.stockItems) {
      await db.execute(
        'INSERT OR REPLACE INTO stock_items (id, name, quantity, unit, low_stock_threshold, cost_per_unit, packet_size, packet_label, packet_cost, icon_id, cost_updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          item.id, item.name, item.quantity, item.unit, item.lowStockThreshold, item.costPerUnit,
          item.packetSize ?? null, item.packetLabel ?? null, item.packetCost ?? null,
          item.iconId ?? null, item.costUpdatedAt ?? null,
        ]
      );
    }

    // --- stock_movements ---
    // Append-only: lines are inserted once and never deleted. The single
    // exception is `reversed`, which is set on the line a reversal points at —
    // so the pair can be hidden from the activity list without either row
    // leaving the ledger. Historical stock levels are reconstructed by replaying
    // this table, and that stops being possible the moment rows can vanish.
    const movements = data.stockMovements ?? [];
    const existing = await db.select<{id: string; reversed: number}[]>('SELECT id, reversed FROM stock_movements');
    const wasReversed = new Map(existing.map(r => [r.id, Number(r.reversed) === 1]));
    for (const m of movements) {
      if (wasReversed.has(m.id)) {
        if (Boolean(m.reversed) !== wasReversed.get(m.id)) {
          await db.execute('UPDATE stock_movements SET reversed = ? WHERE id = ?', [m.reversed ? 1 : 0, m.id]);
        }
        continue;
      }
      await db.execute(
        'INSERT OR REPLACE INTO stock_movements (id, stock_item_id, delta, resulting, reason, note, reference_type, reference_id, unit_cost, total_cost, reversed, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          m.id, m.stockItemId, m.delta, m.resulting, m.reason, m.note ?? null,
          m.referenceType ?? null, m.referenceId ?? null,
          m.unitCost ?? null, m.totalCost ?? null, m.reversed ? 1 : 0, m.timestamp,
        ]
      );
    }

    // --- inventory_snapshots (one row per item per day, written once) ---
    for (const snap of data.inventorySnapshots ?? []) {
      await db.execute(
        'INSERT OR REPLACE INTO inventory_snapshots (snapshot_date, stock_item_id, quantity, unit_cost, value) VALUES (?, ?, ?, ?, ?)',
        [snap.date, snap.stockItemId, snap.quantity, snap.unitCost, snap.value]
      );
    }

    // --- oversell_events (append-only) ---
    const knownOversell = new Set(
      (await db.select<{id: string}[]>('SELECT id FROM oversell_events')).map(r => r.id)
    );
    for (const e of data.oversellEvents ?? []) {
      if (knownOversell.has(e.id)) continue;
      await db.execute(
        'INSERT OR REPLACE INTO oversell_events (id, menu_item_id, menu_item_name, quantity, bottleneck_stock_item_id, order_id, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [e.id, e.menuItemId, e.menuItemName, e.quantity, e.bottleneckStockItemId ?? null, e.orderId ?? null, e.timestamp]
      );
    }

    // --- stock_assignments ---
    const oldAssn = (await db.select<{menu_item_id: string; stock_item_id: string}[]>(
      "SELECT menu_item_id, stock_item_id FROM stock_assignments"
    ));
    const newAssnSet = new Set(data.stockAssignments.map(a => `${a.menuItemId}:${a.stockItemId}`));
    for (const a of oldAssn) {
      if (!newAssnSet.has(`${a.menu_item_id}:${a.stock_item_id}`)) {
        await db.execute(
          "DELETE FROM stock_assignments WHERE menu_item_id = ? AND stock_item_id = ?",
          [a.menu_item_id, a.stock_item_id]
        );
      }
    }
    for (const assn of data.stockAssignments) {
      await db.execute(
        'INSERT OR REPLACE INTO stock_assignments (menu_item_id, stock_item_id, quantity_per_item) VALUES (?, ?, ?)',
        [assn.menuItemId, assn.stockItemId, assn.quantityPerItem]
      );
    }

    // --- trading_events ---
    const oldEventIds = (await db.select<{ id: string }[]>('SELECT id FROM trading_events')).map(r => r.id);
    const newEventIds = new Set((data.tradingEvents ?? []).map(e => e.id));
    for (const id of oldEventIds) {
      if (!newEventIds.has(id)) {
        // Detach rather than cascade: an event is only a grouping, and deleting
        // one must never take its sessions' orders with it.
        await db.execute('UPDATE trading_sessions SET event_id = NULL WHERE event_id = ?', [id]);
        await db.execute('DELETE FROM trading_events WHERE id = ?', [id]);
      }
    }
    for (const ev of data.tradingEvents ?? []) {
      await db.execute(
        'INSERT OR REPLACE INTO trading_events (id, name, notes, created_at) VALUES (?, ?, ?, ?)',
        [ev.id, ev.name, ev.notes ?? null, ev.createdAt]
      );
    }

    // --- trading_sessions ---
    // Sessions are never deleted here. Orders point at them, and a session that
    // vanishes takes the meaning of every figure scoped to it with it.
    for (const s of data.tradingSessions ?? []) {
      await db.execute(
        'INSERT OR REPLACE INTO trading_sessions (id, event_id, name, status, started_at, ended_at, ticket_counter, paused_ms, paused_at, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          s.id, s.eventId ?? null, s.name, s.status, s.startedAt, s.endedAt ?? null,
          s.ticketCounter, s.pausedMs, s.pausedAt ?? null, s.notes ?? null,
        ]
      );
    }

    // --- cost_entries ---
    const oldCostIds = (await db.select<{ id: string }[]>('SELECT id FROM cost_entries')).map(r => r.id);
    const newCostIds = new Set((data.costEntries ?? []).map(c => c.id));
    for (const id of oldCostIds) {
      if (!newCostIds.has(id)) {
        await db.execute('DELETE FROM cost_entries WHERE id = ?', [id]);
      }
    }
    for (const c of data.costEntries ?? []) {
      await db.execute(
        'INSERT OR REPLACE INTO cost_entries (id, session_id, amount, note, kind, timestamp) VALUES (?, ?, ?, ?, ?, ?)',
        [c.id, c.sessionId ?? null, c.amount, c.note, c.kind, c.timestamp]
      );
    }

    // --- app_state ---
    await db.execute(
      "INSERT OR REPLACE INTO app_state (key, value) VALUES ('order_counter', ?)",
      [String(data.orderCounter)]
    );

    await db.execute("INSERT OR REPLACE INTO app_state (key, value) VALUES ('db_version', ?)", [DB_VERSION]);
    console.log("[PERSIST] runSave complete");
  } catch (err) {
    console.error('[PERSIST] runSave error:', err);
  }
}

export async function saveAllData(data: PersistedData): Promise<void> {
  saveQueue = saveQueue.then(() => runSave(data));
  return saveQueue;
}

export async function getAppSetting(key: string): Promise<string | null> {
  try {
    const db = await getDb();
    const rows = await db.select<Record<string, unknown>[]>(
      "SELECT value FROM app_state WHERE key = ?", [key]
    );
    return rows.length > 0 ? String((rows[0] as Record<string, unknown>).value) : null;
  } catch {
    return null;
  }
}

export async function setAppSetting(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    "INSERT OR REPLACE INTO app_state (key, value) VALUES (?, ?)",
    [key, value]
  );
}

/**
 * Wipes trading history while keeping the setup: menu, categories, stock items,
 * recipes and packets all survive.
 *
 * This exists because several analytics facts — line costs, stage timestamps,
 * oversells — only start being recorded from the day they ship, and cannot be
 * back-filled. A shop that wants clean, complete figures needs a way to draw a
 * line without rebuilding its whole menu by hand.
 */
export async function clearTransactionalData(): Promise<void> {
  try {
    const db = await getDb();
    await db.execute('DELETE FROM order_items');
    await db.execute('DELETE FROM orders');
    await db.execute('DELETE FROM parked_session_cart_items');
    await db.execute('DELETE FROM parked_sessions');
    await db.execute('DELETE FROM stock_movements');
    await db.execute('DELETE FROM inventory_snapshots');
    await db.execute('DELETE FROM oversell_events');
    await db.execute('DELETE FROM cost_entries');
    await db.execute('DELETE FROM trading_sessions');
    await db.execute('DELETE FROM trading_events');
    await db.execute("DELETE FROM app_state WHERE key = 'order_counter'");
    await db.execute("DELETE FROM app_state WHERE key = 'session_active'");
    await db.execute("DELETE FROM app_state WHERE key = 'session_started_at'");
  } catch (err) {
    console.error('clearTransactionalData error:', err);
  }
}

export async function clearAllData(): Promise<void> {
  try {
    const db = await getDb();
    await db.execute('DELETE FROM order_items');
    await db.execute('DELETE FROM orders');
    await db.execute('DELETE FROM menu_items');
    await db.execute('DELETE FROM app_categories');
    await db.execute('DELETE FROM parked_session_cart_items');
    await db.execute('DELETE FROM parked_sessions');
    await db.execute('DELETE FROM stock_assignments');
    await db.execute('DELETE FROM stock_items');
    await db.execute('DELETE FROM stock_movements');
    await db.execute('DELETE FROM inventory_snapshots');
    await db.execute('DELETE FROM oversell_events');
    await db.execute('DELETE FROM cost_entries');
    await db.execute('DELETE FROM trading_sessions');
    await db.execute('DELETE FROM trading_events');
    await db.execute("DELETE FROM app_state WHERE key = 'order_counter'");
    await db.execute("DELETE FROM app_state WHERE key = 'session_active'");
    await db.execute("DELETE FROM app_state WHERE key = 'session_order_base'");
    await db.execute("DELETE FROM app_state WHERE key = 'session_started_at'");
    await db.execute("DELETE FROM app_state WHERE key = 'db_version'");
  } catch (err) {
    console.error('clearAllData error:', err);
  }
}
