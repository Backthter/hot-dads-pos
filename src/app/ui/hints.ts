/**
 * Every explanation the interface offers, in one place.
 *
 * These were scattered through the components as `title=""` strings and had
 * drifted into describing the implementation rather than the situation:
 * "voided orders are kept in history", "ungrouped sessions count as an event of
 * one", "lift above 1 means more than coincidence". All of those are true, and
 * none of them is what somebody standing at a counter needs to read.
 *
 * The rules used when rewriting them:
 *  · Say what pressing this does, or what this number means for the business.
 *  · Name the consequence, especially when it cannot be taken back.
 *  · No internal vocabulary — no ledgers, no rows, no scopes, no basis.
 *  · Short enough to read without stopping work.
 */

export const HINT = {
  /* --------------------------------------------------------------- global */
  back: 'Go back one step. Closes whatever you have open before leaving the section.',
  home: 'Back to the main menu.',
  toOrderMode: 'Take a new order.',
  toAllOrders: 'See every ticket on the board, including completed ones.',
  undo: 'Undo the last thing you did.',
  redo: 'Redo what you just undid.',
  nothingToUndo: 'Nothing to undo yet.',
  nothingToRedo: 'Nothing to redo.',
  logOut: 'Sign out. Nothing is lost — all your orders and stock stay saved.',

  /* ------------------------------------------------------------- ordering */
  clearCart: 'Empty this order and start it again. The order has not been rung up yet, so nothing is lost.',
  newOrder: 'Park this order and start a fresh one. You can switch back to it any time.',
  cancelEdit: 'Stop editing and leave the original order exactly as it was.',
  payCash: 'Ring the order up as paid in cash.',
  payTransfer: 'Ring the order up as paid by transfer.',
  saveEditCash: 'Save your changes to this order and mark it paid in cash.',
  saveEditTransfer: 'Save your changes to this order and mark it paid by transfer.',
  discount: 'Take money off this order. Type an amount in rupees, or start with % for a percentage.',
  clearDiscount: 'Remove the discount and go back to the full price.',
  cashGiven: 'What the customer handed over. The change is worked out for you.',
  notes: 'Anything the kitchen needs to know — no onions, extra sauce, a name to call out.',
  parkedTicket: 'An order you have set aside. Tap to carry on with it, or drag it onto Cash or Transfer to ring it up.',
  deleteParked: 'Drag a parked order here to throw it away.',
  soldOut: 'Stock says this cannot be made. You can still add it — the shop may have more than the app knows about.',

  /* ---------------------------------------------------------------- board */
  voidOrder:
    'Cancel this order. It stops counting towards your takings, its ingredients go back into stock, and it leaves the board — but it stays in your records, so the day\'s history is still true.',
  ticketPress: 'Press and hold a ticket, then push towards the stage you want to move it to.',
  grillFull: 'The grill is full. Move something off it before adding another.',
  editingTicket: 'This ticket is open for editing in the ordering panel. Finish or cancel the edit to move it again.',
  collapsedGrill: 'Tap to scroll back to the top and see the grill in full.',
  completedThisSession: 'Show only the orders completed since this session started.',
  completedAll: 'Show every completed order, whichever session it came from.',

  /* -------------------------------------------------------------- session */
  startSession: 'Start a service. Tickets are numbered from 1 again for the kitchen, and everything sold gets grouped under this session.',
  pauseSession: 'Pause until you trade again. Time spent paused is not counted as trading time, so an overnight break will not flatten your hourly takings.',
  resumeSession: 'Carry on with this session. Ticket numbers continue where they left off.',
  endSession: 'Close this session for good. Nothing is deleted — the board goes back to showing your lifetime order numbers.',
  groupSessions: 'Put several sessions under one name — a three-day market run as one event.',
  ungroupSession: 'Take this session out of its event. It will still be reported on its own.',

  /* ------------------------------------------------------------ inventory */
  addStock: 'Add what has arrived. Enter it by hand, or by the packet if you have set a packet size.',
  assignStock: 'Say what each menu item uses up, so selling it takes the right amount off the shelf.',
  stockHistory: 'Everything that has gone in or out, newest first.',
  undoMovement: 'Put this back the way it was. The correction is recorded rather than the original being erased, so the shelf and the history always agree.',
  stockTake: 'Count what is actually on the shelf. The difference against what the app expected is the useful part — it is where waste and over-portioning show up.',
  packets: 'How much comes in one box, crate or tray, so a delivery can be added by the packet instead of counted out.',
  reorderList: 'Everything that has run low, ready to print or take to the wholesaler.',
  lowStockBadge: 'These have fallen to or below the level you set as low.',
  manageStock: 'Add, rename or remove the things you keep on the shelf.',
  costPerUnit: 'What one unit costs you. Updated automatically whenever you record what a delivery cost, so your margins stay honest without anyone maintaining them.',
  packetCost: 'What one whole packet costs. Receiving three packets then works out the delivery cost on its own.',
  lowStockThreshold: 'Warn me when this drops to here.',

  /* ------------------------------------------------------------ analytics */
  revenueLocked: 'Money figures are hidden. Enter the PIN to show them.',
  lockRevenue: 'Hide the money figures again.',
  scopePicker: 'Choose the period, session or event these figures cover.',
  exportData: 'Save these figures as a spreadsheet.',
  filterMatchAll: 'Right now an order has to match every condition. Tap to switch to matching any one of them.',
  filterMatchAny: 'Right now an order only has to match one condition. Tap to switch to needing all of them.',
  boughtTogether: 'Pairs that sell together more often than chance would explain — worth putting side by side on the menu, or turning into a deal.',
  revenueByEvent: 'What each event took. A session you have not grouped is shown on its own.',
  salesTrend: 'Periods where you did not trade are left out rather than drawn as zero, so a closed Monday does not look like a bad Monday.',
  itemsByRevenue: 'A deal carries its whole price here, while the things inside it carry the units. That way neither is double-counted.',
  deadStock: 'Things you are holding that have not sold in a long time. Money sitting on a shelf.',
  costsPanel: 'The costs the till cannot see — the pitch fee, staff, fuel, packaging. Ingredients are worked out from stock on their own.',
  costFixed: 'A cost that does not change with how much you sell — the pitch fee, a day of staff.',
  costVariable: 'A cost that rises with every sale — packaging, a bag, a lid.',
  breakEven: 'How much you need to take before the day starts making money.',

  /* ------------------------------------------------------------- settings */
  grillCapacity: 'How many tickets fit on the grill at once. Once it is full, the Grill action stops being offered until something comes off.',
  tapToExpandParked: 'Let a tap on a parked order open its buttons, instead of only being able to drag it.',
  salesTax: 'Adds tax on top of the discounted price. Each order remembers the rate it was sold at, so changing this never rewrites the past.',
  discountPin: 'Ask for the manager PIN before any discount can be applied.',
  lightMode: 'A light theme, for working in bright daylight.',
  displayScale: 'Sizes the whole program, including how big everything is to press. Bigger is easier to hit but fits less on screen.',
  fullscreen: 'Fill the whole screen and hide the window bar.',
  changeCredentials: 'Change the username and password used to sign in.',
  changePin: 'Change the PIN that unlocks money figures in Analytics.',
  printer: 'Print a ticket automatically as soon as an order is taken.',
  printerName: 'Leave this empty to use whichever printer the computer treats as default.',
  testPrint: 'Send a sample ticket, to check the printer is working before service.',
  wipeData: 'Permanently deletes data. This cannot be undone, and there is no copy kept.',
  showInOrderMode: 'Show this item on the ordering screen. Turn it off to retire something without losing its sales history.',
  dealContents: 'What the customer gets in this deal. The price is worked out from the items inside it.',
  reorderCategories: 'Drag to change the order the categories appear in on the ordering screen.',
} as const;

export type HintKey = keyof typeof HINT;
