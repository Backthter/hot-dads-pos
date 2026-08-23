export interface DealItem {
  /**
   * The component this line refers to. Names used to be the only link, which
   * broke every deal — retroactively, including for stock estimates — the moment
   * a menu item was renamed. Optional only so pre-migration rows still parse;
   * resolution always prefers the id and falls back to the name.
   */
  menuItemId?: string;
  /** Snapshot of the component's name, for display and as the legacy fallback. */
  name: string;
  quantity: number;
}

export interface MenuItem {
  id: string;
  name: string;
  price: number;
  showInOrderMode: boolean;
  category: string;
  dealItems?: DealItem[]; // For deals category - what the deal comprises of
  /**
   * An ingredient cost typed in by hand, used instead of the one the recipe
   * implies.
   *
   * Needed for anything the stock ledger cannot see the whole of — a deal that
   * includes something bought in ready-made, or an item whose components are
   * only partly tracked. Undefined means "work it out from the recipe", which
   * is the normal case and stays the default; zero would mean "this costs
   * nothing", which is a different claim entirely.
   */
  unitCostOverride?: number;
}

export interface Category {
  id: string;
  name: string;
  order: number;
  /**
   * Marks a category the program itself depends on.
   *
   * Only one exists: `deals`. Deleting it used to take the ability to build a
   * deal with it — the editor for a deal's contents only appeared for items
   * sitting in a category called "Deals", so once it was gone there was no
   * route back to the feature. It can be renamed to whatever the shop calls
   * them; it simply cannot be removed.
   */
  system?: 'deals';
}

export interface CartItem {
  menuItemId: string;
  name: string;
  price: number;
  quantity: number;
  dealItems?: DealItem[]; // For deals - what the deal comprises of
  /**
   * Ingredient cost of ONE of this line, resolved from the recipe and the stock
   * costs in force at the moment the order was taken. Written once at checkout
   * and never recomputed, so historical margin cannot drift when a supplier
   * price or a recipe changes. Undefined on carts and on orders taken before
   * costing existed — which is not the same as zero, and must not be read as it.
   */
  unitCost?: number;
  /** Units the kitchen could not actually make. Demand that exceeded stock. */
  oversoldQuantity?: number;
}

export type OrderStatus = 'preparing' | 'grill' | 'ready' | 'completed' | 'parked';

/** Board statuses a ticket can be moved between via the ticket action menu. */
export type BoardStatus = 'preparing' | 'grill' | 'ready' | 'completed';

export type DiscountKind = 'flat' | 'percent';

export interface Discount {
  kind: DiscountKind;
  /** Rupees when kind === 'flat', percentage points when kind === 'percent'. */
  value: number;
}

export interface Order {
  /** Immutable identity. Never renumbered — used as the order_items foreign key. */
  id: string;
  /** 1..N display sequence, recomputed whenever an order is deleted. */
  seq: number;
  orderNumber: string;
  customerName: string;
  items: CartItem[];
  notes: string;
  status: OrderStatus;
  /** Pre-discount sum of line items. */
  subtotal: number;
  discount?: Discount;
  /** Resolved rupee value of the discount. */
  discountAmount: number;
  /** Percentage rate in force when the order was taken, 0 when tax is off. */
  taxRate: number;
  /** Resolved rupee value of the tax. */
  taxAmount: number;
  /** subtotal - discountAmount + taxAmount */
  total: number;
  timestamp: number;
  editedAt?: number;
  /** How many times this order has been edited after being taken. */
  editCount?: number;
  paid?: 'cash' | 'transfer';

  /**
   * The trading session this order was taken in, stamped at checkout.
   *
   * Membership is stored rather than derived from the timestamp, because a
   * session can pause overnight: everything between last night and this morning
   * falls inside the session's span without belonging to it. Orders taken
   * before sessions existed carry nothing, and are excluded from session-scoped
   * figures rather than guessed into one.
   */
  sessionId?: string;
  /**
   * 1..N within the session, assigned once at checkout and never recomputed.
   * The kitchen's number. `orderNumber` remains the true lifetime sequence.
   */
  sessionTicket?: number;

  /**
   * Voiding replaces deletion. The row stays — it is a historical fact that a
   * sale was rung up and then cancelled — but it leaves the board, is excluded
   * from every revenue figure, and returns its stock. Without this, yesterday's
   * takings change whenever someone tidies the board, and the stock ledger keeps
   * a deduction whose order no longer exists.
   */
  voidedAt?: number;
  voidReason?: string;

  /**
   * When the ticket entered each stage. Nullable because they are stamped going
   * forward only — nothing can be back-filled — and because a ticket can skip
   * stages. These are what make kitchen throughput measurable at all.
   */
  grilledAt?: number;
  readyAt?: number;
  completedAt?: number;
}

/**
 * A trading event — a market, a festival, a private booking.
 *
 * An event is a container for one or more sessions and nothing else: it holds
 * no orders of its own. Most events are a single session, but a three-day
 * market run as three separate services needs one event and three sessions, and
 * the alternative — inferring the grouping from dates — cannot tell that apart
 * from three unrelated markets in the same week.
 */
export interface TradingEvent {
  id: string;
  name: string;
  notes?: string;
  createdAt: number;
}

export type TradingSessionStatus = 'active' | 'paused' | 'ended';

/**
 * One service. Starting a session renumbers its tickets from 1 for the kitchen,
 * and — far more usefully — gives every order, cost and stock movement taken
 * during it a common key, which is what makes per-event analytics possible.
 *
 * Sessions are saveable and resumable because a market day is not a calendar
 * day: it pauses overnight and picks up in the morning, and any model that
 * derives membership from a start timestamp gets the second morning wrong.
 */
export interface TradingSession {
  id: string;
  /** Set when this session has been grouped into an event. */
  eventId?: string;
  name: string;
  status: TradingSessionStatus;
  startedAt: number;
  /** Set when the session was ended for good. Paused sessions have no end. */
  endedAt?: number;
  /**
   * Highest ticket number issued so far. Resuming continues from here rather
   * than restarting, so no two tickets in one session share a number.
   */
  ticketCounter: number;
  /**
   * Total milliseconds the session spent paused. Subtracted from elapsed time
   * so revenue per trading hour is not diluted by the night in between.
   */
  pausedMs: number;
  /** When the current pause began. Only set while status is `paused`. */
  pausedAt?: number;
  notes?: string;
}

/**
 * @deprecated Superseded by `CostBasis` in Phase 1A (ADR-012).
 *
 * Kept because rows written before that phase carry it, and it is the only
 * record of how a cost was filed under the old model. Nothing new is filed as
 * a kind; the migration reads it once to offer those rows for re-filing.
 */
export type CostKind = 'fixed' | 'variable';

/**
 * How a cost scales — what it is charged *per*.
 *
 * The old model had two answers, fixed and variable, and neither said what a
 * variable cost varied with. Break-even then divided a typed rupee total by
 * revenue-so-far and treated the result as a rate, so the target moved as sales
 * came in: log Rs 200 of boxes in the morning and the day's break-even was one
 * number at ten o'clock and another at four, on identical facts. A basis says
 * what the amount is charged per, and that is what makes it resolvable to money
 * for a period rather than guessed from whatever has sold so far. See ADR-012.
 */
export type CostBasis =
  | 'per-session'   // paid once per service: pitch fee, a staff shift
  | 'per-event'     // paid once for the whole event: a three-day market pitch
  | 'per-order'     // scales with tickets: bags, receipt roll, cutlery
  | 'per-unit'      // scales with items sold
  | 'per-revenue';  // a true percentage: delivery commission, card fees

/**
 * A cost the POS cannot observe: stall fee, staff, fuel, packaging.
 *
 * Ingredient cost comes from the stock ledger and needs no typing. Everything
 * else has to be logged by hand, so this is deliberately a short form.
 *
 * The basis is not bookkeeping pedantry — break-even revenue is committed costs
 * ÷ contribution margin, and filing a per-ticket cost as a flat one inflates
 * both sides of that division silently.
 */
export interface CostEntry {
  id: string;
  /** The session in force when it was logged. Undefined for out-of-session costs. */
  sessionId?: string;
  /**
   * An event this cost belongs to as a whole.
   *
   * Some costs are not a session's: the pitch fee for a three-day market is
   * paid once, for the market, and splitting it across the three days by hand
   * is both tedious and wrong. Attaching it to the event lets event-level
   * profit be worked out without pretending it happened on a particular
   * afternoon. A cost carries a session id or an event id, never both.
   */
  eventId?: string;
  /**
   * Always positive — this is a cost, the sign is implied.
   *
   * **The unit depends on `basis`, and this is the only field in the app whose
   * meaning does.** Rupees for `per-session`, `per-event`, `per-order` and
   * `per-unit`; percentage points for `per-revenue`.
   *
   * It is not two fields because the four rupee bases would then need a rate
   * column that is null on all of them, and the one percentage basis a rupee
   * column that is null on it — a shape where every row has a hole in it, and
   * where "no amount recorded" and "an amount of zero" stop being tellable
   * apart for whichever column happens to be the empty one. Invariant 2 is
   * about exactly that distinction, so the field stays single and the basis
   * says how to read it. Nothing may total these amounts across bases: Rs 4 a
   * ticket and 18% of sales are not addable, and code that adds them produces a
   * plausible number that is not money.
   */
  amount: number;
  note: string;
  /**
   * What the amount is charged per. Required — an amount with no basis cannot
   * be resolved to money for a period.
   *
   * `per-event` requires `eventId` to be set: the amount is paid once for the
   * whole event, so a per-event cost with no event is an amount attached to
   * nothing. That is asserted at the write sites rather than assumed, in
   * `assertCostEntry` (`src/app/lib/sessions.ts`).
   */
  basis: CostBasis;
  /**
   * @deprecated The pre-Phase-1A fixed/variable model (ADR-012).
   *
   * Present only on rows written before the migration. Never set on a new
   * entry, never read by any figure: it survives so the migration can show a
   * shop what a row used to say while asking where it really belongs, and so
   * that the pre-migration interpretation of historical rows stays recoverable.
   */
  kind?: CostKind;
  timestamp: number;
}

export interface ParkedSession {
  id: string;
  label: string; // A, B, C, etc. — or the order number for edit sessions
  cart: CartItem[];
  notes: string;
  lastModified: number;
  discount?: Discount;
  /**
   * Set when this session is an in-progress edit of an existing order. The order
   * keeps its own status and board position throughout; this is the only marker
   * that it is being edited, so the two can never disagree.
   */
  editingOrderId?: string;
}

export interface StockItem {
  id: string;
  name: string;
  /** Held in the item's base unit: pcs, g or ml. */
  quantity: number;
  unit: string;
  lowStockThreshold: number;
  /**
   * Cost of one base unit. Maintained two ways, deliberately: it can still be
   * typed in by hand from the item editor, and it is recalculated as a moving
   * average whenever stock is received with a delivery cost attached. Receipts
   * win, because they are measured rather than remembered.
   */
  costPerUnit: number;
  /** Set when costPerUnit last came from a receipt rather than being typed in. */
  costUpdatedAt?: number;
  /** 1 packet = this many base units. Undefined when the item has no packet. */
  packetSize?: number;
  /** What a packet is called for this item — Packet, Crate, Tray. */
  packetLabel?: string;
  /**
   * What one packet costs.
   *
   * Receiving N packets then implies the delivery cost without anyone typing
   * it, which is the ordinary case. The per-lot cost field stays as a manual
   * override for the delivery that came in at a different price.
   */
  packetCost?: number;
  /** Key into the stock icon library. */
  iconId?: string;
}

export type StockMovementReason =
  | 'added'       // typed in by hand
  | 'packet'      // added as N packets
  | 'sold'        // consumed by an order
  | 'returned'    // given back when an order was edited down
  | 'waste'       // spillage, spoilage
  | 'correction'  // manual fix
  | 'edit'        // amount changed from the stock editor
  | 'drained'     // deliberately emptied — end of a market, a spoiled batch
  | 'stocktake';  // set during a count

/** What a movement was caused by. `referenceId` is always an immutable id. */
export type MovementReferenceType = 'order' | 'movement' | 'stocktake';

/**
 * One line in a stock item's ledger. Every change to `quantity` writes one.
 *
 * The ledger is append-only. Nothing ever deletes a row: reversing a movement
 * appends a compensating one pointing back at it via `referenceId`. Historical
 * stock levels cannot be reconstructed if lines can vanish, and undo/redo is
 * free to be reworked as long as it respects that.
 */
export interface StockMovement {
  id: string;
  stockItemId: string;
  /** Signed change in base units. */
  delta: number;
  /** Level after the change, so history reads correctly even if items are edited later. */
  resulting: number;
  reason: StockMovementReason;
  /** Order number, packet count, or a short free note. Display only. */
  note?: string;
  /** What caused this — never a display string like an order number. */
  referenceType?: MovementReferenceType;
  /** The immutable id of the cause: order.id, or the movement being reversed. */
  referenceId?: string;
  /** Cost of one base unit for a receipt. Absent on consumption. */
  unitCost?: number;
  /** What the whole delivery cost, as typed in. */
  totalCost?: number;
  /** Set on the reversal, and on the line it reverses, so both can be hidden. */
  reversed?: boolean;
  timestamp: number;
}

/**
 * End-of-day stock level per item. Written on the first launch of each day so
 * historical inventory value never depends on replaying the entire ledger.
 */
export interface InventorySnapshot {
  /** Local date, YYYY-MM-DD. One row per item per day. */
  date: string;
  stockItemId: string;
  quantity: number;
  unitCost: number;
  value: number;
}

/**
 * A sale that the stock on hand could not support, recorded at the moment it
 * happened. This is a direct measurement of censored demand — normally it has
 * to be inferred from suspicious runs of zeroes.
 */
export interface OversellEvent {
  id: string;
  menuItemId: string;
  menuItemName: string;
  quantity: number;
  /** The ingredient that had run out, when one was identifiable. */
  bottleneckStockItemId?: string;
  orderId?: string;
  timestamp: number;
}

export interface MenuItemStockAssignment {
  menuItemId: string;
  stockItemId: string;
  quantityPerItem: number;
}
