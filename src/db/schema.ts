import { sqliteTable, text, integer, real, primaryKey } from "drizzle-orm/sqlite-core";

export const items = sqliteTable("items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  price: real("price").notNull().default(0),
  createdAt: text("created_at").default("datetime('now')"),
});

export const oldCategories = sqliteTable("categories", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  createdAt: text("created_at").default("datetime('now')"),
});

export const menuItems = sqliteTable("menu_items", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  price: real("price").notNull().default(0),
  showInOrderMode: integer("show_in_order_mode").notNull().default(1),
  category: text("category").notNull().default(""),
  dealItems: text("deal_items").default("[]"),
});

export const categoryTable = sqliteTable("app_categories", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  order: integer("category_order").notNull().default(0),
});

export const orders = sqliteTable("orders", {
  id: text("id").primaryKey(),
  seq: integer("seq").notNull().default(0),
  orderNumber: text("order_number").notNull(),
  customerName: text("customer_name").notNull().default("Customer"),
  notes: text("notes").default(""),
  status: text("status").notNull().default("preparing"),
  subtotal: real("subtotal").notNull().default(0),
  discountKind: text("discount_kind"),
  discountValue: real("discount_value"),
  discountAmount: real("discount_amount").notNull().default(0),
  taxRate: real("tax_rate").notNull().default(0),
  taxAmount: real("tax_amount").notNull().default(0),
  total: real("total").notNull().default(0),
  timestamp: integer("timestamp").notNull(),
  editedAt: integer("edited_at"),
  editCount: integer("edit_count").notNull().default(0),
  paid: text("paid"),
  // Voiding replaces deletion, so history stays reconcilable.
  voidedAt: integer("voided_at"),
  voidReason: text("void_reason"),
  // Stage timestamps — what makes kitchen throughput measurable.
  grilledAt: integer("grilled_at"),
  readyAt: integer("ready_at"),
  completedAt: integer("completed_at"),
  /** Stored, not derived: a session pauses overnight and its span is not its contents. */
  sessionId: text("session_id"),
  sessionTicket: integer("session_ticket"),
});

/**
 * A container for sessions. Holds no orders of its own.
 *
 * There is deliberately no `status` column. What an event is doing is derived
 * from its sessions by `eventStatus`; a column would be a second source of
 * truth and would disagree the first time a session inside an ended event was
 * resumed.
 */
export const tradingEvents = sqliteTable("trading_events", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  /**
   * When the market is *meant* to run. A plan, never the record — what an event
   * actually spans comes from its sessions, and nothing reads these to work
   * that out. They exist so an event can be created on Thursday for Saturday.
   */
  plannedStart: integer("planned_start"),
  plannedEnd: integer("planned_end"),
  venue: text("venue"),
  notes: text("notes"),
  createdAt: integer("created_at").notNull(),
});

/** One service. Saveable and resumable, because a market day is not a calendar day. */
export const tradingSessions = sqliteTable("trading_sessions", {
  id: text("id").primaryKey(),
  eventId: text("event_id"),
  name: text("name").notNull(),
  /** 'active' | 'paused' | 'ended'. */
  status: text("status").notNull().default("active"),
  startedAt: integer("started_at").notNull(),
  endedAt: integer("ended_at"),
  /** Highest ticket issued. Resuming continues from here rather than restarting. */
  ticketCounter: integer("ticket_counter").notNull().default(0),
  /** Time spent paused, excluded from trading hours. */
  pausedMs: integer("paused_ms").notNull().default(0),
  pausedAt: integer("paused_at"),
  notes: text("notes"),
});

/** Costs the POS cannot observe. Ingredients come from the stock ledger instead. */
export const costEntries = sqliteTable("cost_entries", {
  id: text("id").primaryKey(),
  sessionId: text("session_id"),
  /**
   * An event this cost belongs to as a whole — one pitch fee for a three-day
   * market. A row carries a session id or an event id, never both.
   *
   * Added in Phase 1A. The field existed on `CostEntry` from the beginning and
   * had no column, so event-level costs worked in memory and vanished on
   * reload, reappearing as costs belonging to nothing.
   */
  eventId: text("event_id"),
  /** Rupees, except when basis is 'per-revenue', where it is percentage points. */
  amount: real("amount").notNull().default(0),
  note: text("note").notNull().default(""),
  /**
   * @deprecated Superseded by `basis` in Phase 1A — see ADR-012 and
   * `docs/phases/PHASE-1A-MONEY-MODEL.md`.
   *
   * Retained, not dropped. Historical rows carry it, and it is the only record
   * of how they were filed under the old fixed/variable model; dropping the
   * column would make that interpretation unrecoverable, and keeping it costs
   * nothing. Nothing writes a value here any more: rows written since the
   * migration carry an empty string, which is how a new row is told apart from
   * one that predates it.
   */
  kind: text("kind").notNull().default("fixed"),
  /**
   * What the amount is charged per: 'per-session' | 'per-event' | 'per-order' |
   * 'per-unit' | 'per-revenue'. Defaults to 'per-session', which is also what
   * every pre-migration row becomes — including the ones filed as 'variable',
   * because inferring a basis from a cost's name would invent information and
   * change a historical figure.
   */
  basis: text("basis").notNull().default("per-session"),
  /**
   * Which menu items a `per-unit` cost is charged against, as JSON. Null means
   * every item, which is what every row written before Phase 1C-ii-b means.
   *
   * Added in Phase 1C-ii-b (ADR-022). One JSON column rather than a kind column
   * and an ids column, which would each be null on the other's rows — the shape
   * ADR-012 rejected for the amount, for invariant 2's reason.
   *
   * Nullable with no default, and only ever written on a `per-unit` row. A
   * target on any other basis names nothing the amount is divided by, so it is
   * refused at the write sites and dropped on load.
   */
  appliesTo: text("applies_to"),
  timestamp: integer("timestamp").notNull(),
});

export const orderItems = sqliteTable("order_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  orderId: text("order_id").notNull(),
  menuItemId: text("menu_item_id").notNull(),
  name: text("name").notNull(),
  price: real("price").notNull().default(0),
  quantity: integer("quantity").notNull().default(1),
  dealItems: text("deal_items").default("[]"),
  /** Ingredient cost of one, frozen at the moment of sale. NULL ≠ zero. */
  unitCost: real("unit_cost"),
  oversoldQuantity: real("oversold_quantity").notNull().default(0),
});

export const parkedSessions = sqliteTable("parked_sessions", {
  id: text("id").primaryKey(),
  label: text("label").notNull(),
  notes: text("notes").default(""),
  lastModified: integer("last_modified").notNull(),
  discountKind: text("discount_kind"),
  discountValue: real("discount_value"),
  editingOrderId: text("editing_order_id"),
});

export const parkedSessionCartItems = sqliteTable("parked_session_cart_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sessionId: text("session_id").notNull(),
  menuItemId: text("menu_item_id").notNull(),
  name: text("name").notNull(),
  price: real("price").notNull().default(0),
  quantity: integer("quantity").notNull().default(1),
  dealItems: text("deal_items").default("[]"),
});

export const stockItems = sqliteTable("stock_items", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  quantity: real("quantity").notNull().default(0),
  unit: text("unit").notNull().default("pcs"),
  lowStockThreshold: real("low_stock_threshold").notNull().default(0),
  costPerUnit: real("cost_per_unit").notNull().default(0),
  packetSize: real("packet_size"),
  packetLabel: text("packet_label"),
  packetCost: real("packet_cost"),
  iconId: text("icon_id"),
  costUpdatedAt: integer("cost_updated_at"),
});

/** Append-only. Reversals are new rows pointing back, never deletions. */
export const stockMovements = sqliteTable("stock_movements", {
  id: text("id").primaryKey(),
  stockItemId: text("stock_item_id").notNull(),
  delta: real("delta").notNull().default(0),
  resulting: real("resulting").notNull().default(0),
  reason: text("reason").notNull().default("added"),
  note: text("note"),
  /** 'order' | 'movement' | 'stocktake' — what caused this line. */
  referenceType: text("reference_type"),
  /** The immutable id of the cause. Never a display order number. */
  referenceId: text("reference_id"),
  unitCost: real("unit_cost"),
  totalCost: real("total_cost"),
  reversed: integer("reversed").notNull().default(0),
  timestamp: integer("timestamp").notNull(),
});

/** One row per item per day, so historical value never replays the ledger. */
export const inventorySnapshots = sqliteTable("inventory_snapshots", {
  date: text("snapshot_date").notNull(),
  stockItemId: text("stock_item_id").notNull(),
  quantity: real("quantity").notNull().default(0),
  unitCost: real("unit_cost").notNull().default(0),
  value: real("value").notNull().default(0),
}, (table) => ({
  pk: primaryKey({ columns: [table.date, table.stockItemId] }),
}));

/** Demand that exceeded stock, measured rather than inferred. */
export const oversellEvents = sqliteTable("oversell_events", {
  id: text("id").primaryKey(),
  menuItemId: text("menu_item_id").notNull(),
  menuItemName: text("menu_item_name").notNull().default(""),
  quantity: real("quantity").notNull().default(1),
  bottleneckStockItemId: text("bottleneck_stock_item_id"),
  orderId: text("order_id"),
  timestamp: integer("timestamp").notNull(),
});

export const stockAssignments = sqliteTable("stock_assignments", {
  menuItemId: text("menu_item_id").notNull(),
  stockItemId: text("stock_item_id").notNull(),
  quantityPerItem: real("quantity_per_item").notNull().default(1),
}, (table) => ({
  pk: primaryKey({ columns: [table.menuItemId, table.stockItemId] }),
}));

export const appState = sqliteTable("app_state", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});
