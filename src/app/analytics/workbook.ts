import * as XLSX from 'xlsx';
import {
  activeTradingHours, attachmentPairs, breakEven, categoryPerformance, costSummary, dataQuality,
  deadStock, eventPerformance, foodCost, inventoryTurnover, inventoryValue, itemPerformance,
  orderMoney, sessionPerformance, shrinkageValue, stockoutStats, throughput, totalsFor,
  tradingHours, voidStats, type DateRange,
} from './metrics';
import { eventGroups, sessionTradingHours } from '../lib/sessions';
import { MOVEMENT_LABELS, consumptionRate, reorderList } from '../lib/inventory';
import type {
  CostEntry, InventorySnapshot, MenuItem, MenuItemStockAssignment, Order, OversellEvent,
  StockItem, StockMovement, TradingEvent, TradingSession,
} from '../types';

/**
 * The Excel export.
 *
 * Two workbooks rather than one, deliberately. The **data** workbook is
 * normalised, one row per record, no merged cells and no formatting cleverness
 * — the shape PivotTables and Power Query want. The **summary** workbook is the
 * readable one, with the figures already computed. Cramming both into a single
 * file gives you a spreadsheet that is awkward to pivot and tiring to read.
 *
 * Two conventions run through the data sheets:
 *
 *  - Money columns are numbers, never strings with "Rs" in them, or Excel
 *    cannot sum them.
 *  - An unknown cost is an empty cell, not a zero. Zero is a claim.
 */

export interface WorkbookInput {
  range: DateRange;
  orders: Order[];
  menuItems: MenuItem[];
  stockItems: StockItem[];
  assignments: MenuItemStockAssignment[];
  movements: StockMovement[];
  snapshots: InventorySnapshot[];
  oversells: OversellEvent[];
  sessions: TradingSession[];
  events: TradingEvent[];
  costs: CostEntry[];
  taxEnabled: boolean;
  generatedAt: number;
}

const iso = (ms: number) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Column widths, computed from the content so nothing arrives as ####. */
function fit(rows: Record<string, unknown>[]): XLSX.ColInfo[] {
  if (rows.length === 0) return [];
  return Object.keys(rows[0]).map(key => {
    const longest = rows.reduce(
      (max, row) => Math.max(max, String(row[key] ?? '').length),
      key.length,
    );
    return { wch: Math.min(42, Math.max(10, longest + 2)) };
  });
}

function addSheet(wb: XLSX.WorkBook, name: string, rows: Record<string, unknown>[]) {
  const sheet = XLSX.utils.json_to_sheet(rows);
  if (rows.length > 0) {
    sheet['!cols'] = fit(rows);
    // Freeze the header and turn on filters, so the sheet is usable on open.
    sheet['!freeze'] = { xSplit: 0, ySplit: 1 } as never;
    sheet['!autofilter'] = { ref: sheet['!ref'] as string };
  }
  XLSX.utils.book_append_sheet(wb, sheet, name.slice(0, 31));
}

/* ----------------------------------------------------------- data workbook */

export function buildDataWorkbook(input: WorkbookInput): Uint8Array {
  const { range, orders, menuItems, stockItems, movements, snapshots, oversells } = input;
  const inWindow = orders.filter(o => o.timestamp >= range.start && o.timestamp < range.end);
  const wb = XLSX.utils.book_new();

  addSheet(wb, 'Orders', inWindow.map(order => {
    const m = orderMoney(order);
    return {
      Order_ID: order.id,
      Order_Number: order.orderNumber,
      Created_At: iso(order.timestamp),
      Grilled_At: order.grilledAt ? iso(order.grilledAt) : '',
      Ready_At: order.readyAt ? iso(order.readyAt) : '',
      Completed_At: order.completedAt ? iso(order.completedAt) : '',
      Minutes_To_Ready: order.readyAt ? round2((order.readyAt - order.timestamp) / 60000) : '',
      Status: order.status,
      Voided: order.voidedAt ? 'yes' : 'no',
      Voided_At: order.voidedAt ? iso(order.voidedAt) : '',
      Edited: order.editedAt ? 'yes' : 'no',
      Edit_Count: order.editCount ?? 0,
      Payment_Method: order.paid ?? '',
      Session_ID: order.sessionId ?? '',
      Session_Name: input.sessions.find(s => s.id === order.sessionId)?.name ?? '',
      Session_Ticket: order.sessionTicket ?? '',
      Gross: round2(m.gross),
      Discount: round2(m.discount),
      Net_Revenue: round2(m.netRevenue),
      Tax: round2(m.tax),
      Collected: round2(m.collected),
      // Blank rather than 0 where the lines were never costed.
      COGS: m.costCoverage > 0 ? round2(m.cogs) : '',
      Gross_Profit: m.costCoverage > 0 ? round2(m.costedRevenue - m.cogs) : '',
      Cost_Coverage_Pct: round2(m.costCoverage * 100),
      Item_Count: m.lines,
      Unit_Count: m.units,
      Notes: order.notes ?? '',
    };
  }));

  addSheet(wb, 'Order_Items', inWindow.flatMap(order =>
    order.items.map((item, index) => ({
      Order_Item_ID: `${order.id}-${index + 1}`,
      Order_ID: order.id,
      Order_Number: order.orderNumber,
      Created_At: iso(order.timestamp),
      Voided: order.voidedAt ? 'yes' : 'no',
      Item_ID: item.menuItemId,
      Item_Name_Snapshot: item.name,
      Category: menuItems.find(m => m.id === item.menuItemId)?.category ?? '',
      Is_Deal: item.dealItems?.length ? 'yes' : 'no',
      Quantity: item.quantity,
      Unit_Price: round2(item.price),
      Line_Gross: round2(item.price * item.quantity),
      Unit_Cost_Snapshot: item.unitCost === undefined ? '' : round2(item.unitCost),
      Line_COGS: item.unitCost === undefined ? '' : round2(item.unitCost * item.quantity),
      Line_Gross_Profit: item.unitCost === undefined
        ? '' : round2((item.price - item.unitCost) * item.quantity),
      Oversold_Quantity: item.oversoldQuantity ?? 0,
    }))));

  // Payments are derived: one row per order until split payments exist, so the
  // schema is already right on the day they do.
  addSheet(wb, 'Payments', inWindow.filter(o => !o.voidedAt && o.paid).map(order => ({
    Payment_ID: `${order.id}-p1`,
    Order_ID: order.id,
    Timestamp: iso(order.timestamp),
    Payment_Method: order.paid ?? '',
    Amount: round2(orderMoney(order).collected),
    Status: 'captured',
  })));

  addSheet(wb, 'Inventory_Movements', movements
    .filter(m => m.timestamp >= range.start && m.timestamp < range.end)
    .map(m => {
      const item = stockItems.find(s => s.id === m.stockItemId);
      return {
        Movement_ID: m.id,
        Timestamp: iso(m.timestamp),
        Item_ID: m.stockItemId,
        Item_Name: item?.name ?? '',
        Unit: item?.unit ?? '',
        Movement_Type: MOVEMENT_LABELS[m.reason] ?? m.reason,
        Quantity_Delta: round2(m.delta),
        Resulting_Quantity: round2(m.resulting),
        Unit_Cost: m.unitCost === undefined ? '' : round2(m.unitCost),
        Total_Cost: m.totalCost === undefined ? '' : round2(m.totalCost),
        Reference_Type: m.referenceType ?? '',
        Reference_ID: m.referenceId ?? '',
        Reversed: m.reversed ? 'yes' : 'no',
        Note: m.note ?? '',
      };
    }));

  addSheet(wb, 'Inventory_Snapshot', snapshots.map(s => ({
    Snapshot_Date: s.date,
    Item_ID: s.stockItemId,
    Item_Name: stockItems.find(i => i.id === s.stockItemId)?.name ?? '',
    Quantity_On_Hand: round2(s.quantity),
    Unit_Cost: s.unitCost > 0 ? round2(s.unitCost) : '',
    Inventory_Value: s.unitCost > 0 ? round2(s.value) : '',
  })));

  addSheet(wb, 'Items', menuItems.map(item => ({
    Item_ID: item.id,
    Name: item.name,
    Category: item.category,
    Price: round2(item.price),
    Shown_In_Order_Mode: item.showInOrderMode ? 'yes' : 'no',
    Is_Deal: item.dealItems?.length ? 'yes' : 'no',
  })));

  addSheet(wb, 'Deals', menuItems.filter(m => m.dealItems?.length).flatMap(deal =>
    deal.dealItems!.map(component => ({
      Deal_ID: deal.id,
      Deal_Name: deal.name,
      Component_Item_ID: component.menuItemId ?? '',
      Component_Name: component.name,
      Component_Quantity: component.quantity,
    }))));

  addSheet(wb, 'Stock_Items', stockItems.map(item => ({
    Item_ID: item.id,
    Name: item.name,
    Quantity_On_Hand: round2(item.quantity),
    Base_Unit: item.unit,
    Low_Stock_Threshold: round2(item.lowStockThreshold),
    Cost_Per_Unit: item.costPerUnit > 0 ? round2(item.costPerUnit) : '',
    Stock_Value: item.costPerUnit > 0 ? round2(item.quantity * item.costPerUnit) : '',
    Packet_Size: item.packetSize ?? '',
    Packet_Label: item.packetLabel ?? '',
  })));

  addSheet(wb, 'Recipes', input.assignments.map(a => ({
    Menu_Item_ID: a.menuItemId,
    Menu_Item_Name: menuItems.find(m => m.id === a.menuItemId)?.name ?? '',
    Stock_Item_ID: a.stockItemId,
    Stock_Item_Name: stockItems.find(s => s.id === a.stockItemId)?.name ?? '',
    Quantity_Per_Item: round2(a.quantityPerItem),
    Unit: stockItems.find(s => s.id === a.stockItemId)?.unit ?? '',
  })));

  addSheet(wb, 'Oversells', oversells
    .filter(e => e.timestamp >= range.start && e.timestamp < range.end)
    .map(e => ({
      Oversell_ID: e.id,
      Timestamp: iso(e.timestamp),
      Item_ID: e.menuItemId,
      Item_Name: e.menuItemName,
      Quantity: e.quantity,
      Bottleneck_Stock_Item: stockItems.find(s => s.id === e.bottleneckStockItemId)?.name ?? '',
      Order_ID: e.orderId ?? '',
    })));

  addSheet(wb, 'Sessions', input.sessions.map(s => ({
    Session_ID: s.id,
    Session_Name: s.name,
    Event_ID: s.eventId ?? '',
    Event_Name: input.events.find(e => e.id === s.eventId)?.name ?? '',
    Status: s.status,
    Started_At: iso(s.startedAt),
    Ended_At: s.endedAt ? iso(s.endedAt) : '',
    // Pauses are deducted: a market that ran Saturday and Sunday traded eight
    // hours, not the thirty-two between opening and closing.
    Trading_Hours: round2(sessionTradingHours(s, input.generatedAt)),
    Paused_Hours: round2(s.pausedMs / 3_600_000),
    Tickets_Issued: s.ticketCounter,
    Notes: s.notes ?? '',
  })));

  addSheet(wb, 'Events', input.events.map(e => ({
    Event_ID: e.id,
    Event_Name: e.name,
    Created_At: iso(e.createdAt),
    Sessions: input.sessions.filter(s => s.eventId === e.id).length,
    Notes: e.notes ?? '',
  })));

  addSheet(wb, 'Costs', input.costs.map(c => ({
    Cost_ID: c.id,
    Timestamp: iso(c.timestamp),
    Amount: round2(c.amount),
    Kind: c.kind,
    Session_ID: c.sessionId ?? '',
    Session_Name: input.sessions.find(s => s.id === c.sessionId)?.name ?? '',
    Note: c.note,
  })));

  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
}

/* -------------------------------------------------------- summary workbook */

export function buildSummaryWorkbook(input: WorkbookInput): Uint8Array {
  const {
    range, orders, menuItems, stockItems, assignments, movements, oversells, generatedAt,
  } = input;
  const inWindow = orders.filter(o => o.timestamp >= range.start && o.timestamp < range.end);
  const totals = totalsFor(inWindow);
  const items = itemPerformance(orders, menuItems, range);
  const stock = inventoryValue(stockItems);
  const shrink = shrinkageValue(movements, stockItems, range);
  const tp = throughput(orders, range);
  const costs = costSummary(input.costs);
  const be = breakEven(totals, costs);
  const voids = voidStats(inWindow);
  const food = foodCost(totals, movements, input.snapshots, stockItems, range, generatedAt);
  const turnover = inventoryTurnover(totals, input.snapshots, stockItems, range);
  const outs = stockoutStats(movements, stockItems, oversells, range);
  const groups = eventGroups(input.events, input.sessions);
  const wb = XLSX.utils.book_new();

  addSheet(wb, 'README', [
    { Field: 'Exported at', Value: iso(generatedAt) },
    { Field: 'Reporting period', Value: `${iso(range.start)} to ${iso(range.end)}` },
    { Field: 'Period label', Value: range.label },
    { Field: 'Currency', Value: 'Rs' },
    { Field: 'Revenue basis', Value: 'Net of discounts, excluding tax (tax is a pass-through)' },
    { Field: 'Tax collected in period', Value: round2(totals.tax) },
    { Field: 'Tax currently charged', Value: input.taxEnabled ? 'yes' : 'no' },
    { Field: 'Voided orders', Value: `${totals.voided} (excluded from all money figures)` },
    { Field: 'Cost coverage', Value: `${Math.round(totals.costCoverage * 100)}% of sold lines carry a recorded cost` },
    { Field: 'Profit caveat', Value: 'Gross profit and margin cover only the costed lines. Uncosted lines are excluded from both sides rather than assumed free.' },
    { Field: 'Kitchen timings', Value: `${tp.measured} orders carry stage timestamps. These are recorded going forward only and cannot be back-filled.` },
    ...dataQuality(orders, stockItems, assignments, menuItems, range)
      .map(issue => ({ Field: `Data quality — ${issue.id}`, Value: issue.message })),
  ]);

  addSheet(wb, 'KPIs', [
    { Metric: 'Net revenue', Value: round2(totals.netRevenue), Definition: 'Gross line value less discounts, excluding tax' },
    { Metric: 'Collected', Value: round2(totals.collected), Definition: 'What the customer paid, tax included' },
    { Metric: 'Gross profit', Value: round2(totals.grossProfit), Definition: 'Costed revenue less cost of goods, over costed lines only' },
    { Metric: 'Gross margin %', Value: totals.grossMarginPct === null ? '' : round2(totals.grossMarginPct), Definition: 'Gross profit ÷ costed revenue' },
    { Metric: 'Cost coverage %', Value: round2(totals.costCoverage * 100), Definition: 'Share of sold lines with a recorded cost' },
    { Metric: 'Orders', Value: totals.orders, Definition: 'Non-voided orders in the period' },
    { Metric: 'Voided orders', Value: totals.voided, Definition: 'Cancelled after being rung up' },
    { Metric: 'Units sold', Value: totals.units, Definition: 'Sum of line quantities' },
    { Metric: 'Average order value', Value: round2(totals.averageOrderValue), Definition: 'Net revenue ÷ orders' },
    { Metric: 'Average units per order', Value: round2(totals.averageUnitsPerOrder), Definition: 'Units ÷ orders' },
    { Metric: 'Discount rate %', Value: round2(totals.discountRatePct), Definition: 'Discounts ÷ gross line value' },
    { Metric: 'Cash collected', Value: round2(totals.cash), Definition: 'Collected on cash orders' },
    { Metric: 'Transfer collected', Value: round2(totals.transfer), Definition: 'Collected on transfer orders' },
    { Metric: 'Trading hours', Value: activeTradingHours(orders, range), Definition: 'Distinct clock hours in which anything sold' },
    { Metric: 'Peak orders per hour', Value: tp.peakOrdersPerHour, Definition: 'Busiest single hour in the period' },
    { Metric: 'Median minutes to ready', Value: tp.medianToReadyMs === null ? '' : round2(tp.medianToReadyMs / 60000), Definition: 'Order taken to ticket ready' },
    { Metric: '90th percentile minutes to ready', Value: tp.p90ToReadyMs === null ? '' : round2(tp.p90ToReadyMs / 60000), Definition: 'The slow tail, not the average' },
    { Metric: 'Inventory value', Value: round2(stock.total), Definition: 'Stock on hand × cost per unit' },
    { Metric: 'Uncosted stock items', Value: stock.uncosted, Definition: 'Items whose stock is worth an unknown amount' },
    { Metric: 'Waste value', Value: round2(shrink.waste), Definition: 'Movements logged as waste, at cost' },
    { Metric: 'Stock take variance', Value: round2(shrink.variance), Definition: 'Counted less expected, at cost' },
    { Metric: 'Void rate % by count', Value: round2(voids.byCountPct), Definition: 'Tickets cancelled after being rung up ÷ all tickets' },
    { Metric: 'Void rate % by value', Value: round2(voids.byValuePct), Definition: 'Cancelled value ÷ cancelled plus live value' },
    { Metric: 'Voided value', Value: round2(voids.voidedValue), Definition: 'Revenue that was rung up and then cancelled' },
    { Metric: 'Fixed costs logged', Value: round2(costs.fixed), Definition: 'Costs that do not move with volume' },
    { Metric: 'Variable costs logged', Value: round2(costs.variable), Definition: 'Costs that rise with every unit sold' },
    { Metric: 'Contribution margin %', Value: be.contributionRatio === null ? '' : round2(be.contributionRatio * 100), Definition: 'Share of each rupee left after ingredients and variable costs' },
    { Metric: 'Break-even revenue', Value: be.revenue === null ? '' : round2(be.revenue), Definition: be.blocked ?? 'Fixed costs ÷ contribution margin' },
    { Metric: 'Break-even units', Value: be.units === null ? '' : Math.ceil(be.units), Definition: be.blocked ?? 'Fixed costs ÷ contribution per unit' },
    { Metric: 'Food cost (theoretical)', Value: round2(food.theoretical), Definition: 'What the recipes say the sold lines consumed' },
    { Metric: 'Food cost % (theoretical)', Value: food.theoreticalPct === null ? '' : round2(food.theoreticalPct), Definition: 'Theoretical ingredient cost ÷ net revenue' },
    { Metric: 'Food cost (actual)', Value: food.actual === null ? '' : round2(food.actual), Definition: food.blocked ?? 'Opening stock + purchases − closing stock, both replayed from the ledger' },
    { Metric: 'Food cost basis', Value: food.basis, Definition: food.basis === 'counted' ? `Closing stock was counted on ${iso(food.countedAt ?? 0)}` : 'Closing stock is what the ledger implies. A stock take turns this into a measurement' },
    { Metric: 'Food cost variance', Value: food.variance === null ? '' : round2(food.variance), Definition: food.basis === 'counted' ? 'Actual less theoretical, backed by a stock count in the period' : 'Actual less theoretical. Until stock is counted this catches only losses already logged' },
    { Metric: 'Inventory turnover', Value: turnover.turns === null ? '' : round2(turnover.turns), Definition: turnover.blocked ?? 'COGS ÷ average stock value' },
    { Metric: 'Days of stock', Value: turnover.daysOfStock === null ? '' : round2(turnover.daysOfStock), Definition: 'How long stock on hand lasts at this rate' },
    { Metric: 'Stockout rate %', Value: round2(outs.ratePct), Definition: 'Moving stock items that hit zero ÷ moving stock items' },
    { Metric: 'Stockout occasions', Value: outs.occasions, Definition: 'Distinct times an item crossed to zero' },
  ]);

  addSheet(wb, 'Event_Performance', eventPerformance(orders, groups, generatedAt).map(e => ({
    Event: e.name,
    Started: iso(e.startedAt),
    Sessions: e.sessions,
    Orders: e.totals.orders,
    Units: round2(e.totals.units),
    Net_Revenue: round2(e.totals.netRevenue),
    Gross_Profit: e.totals.costCoverage > 0 ? round2(e.totals.grossProfit) : '',
    Trading_Hours: round2(e.tradingHours),
    Revenue_Per_Trading_Hour: e.revenuePerHour === null ? '' : round2(e.revenuePerHour),
  })));

  addSheet(wb, 'Session_Performance', sessionPerformance(orders, input.sessions, generatedAt).map(s => ({
    Session: s.name,
    Started: iso(s.startedAt),
    Orders: s.totals.orders,
    Units: round2(s.totals.units),
    Net_Revenue: round2(s.totals.netRevenue),
    Discount_Rate_Pct: round2(s.totals.discountRatePct),
    Trading_Hours: round2(s.tradingHours),
    Revenue_Per_Trading_Hour: s.revenuePerHour === null ? '' : round2(s.revenuePerHour),
  })));

  addSheet(wb, 'Attachment_Pairs', attachmentPairs(orders, menuItems, range).slice(0, 60).map(p => ({
    Item_A: p.aName,
    Item_B: p.bName,
    Orders_Together: p.together,
    Attachment_Pct_A_To_B: round2(p.attachmentPct),
    Attachment_Pct_B_To_A: round2(p.reverseAttachmentPct),
    // Above 1 means they appear together more than their popularity predicts.
    Lift: round2(p.lift),
  })));

  addSheet(wb, 'Dead_Stock', deadStock(stockItems, movements, generatedAt, 25).map(d => ({
    Item: d.stockItem.name,
    On_Hand: round2(d.stockItem.quantity),
    Unit: d.stockItem.unit,
    Value_Held: round2(d.value),
    Last_Sold: d.lastSoldAt === null ? '' : iso(d.lastSoldAt),
    First_Logged: d.knownSince === null ? '' : iso(d.knownSince),
    Idle_Days: d.idleDays === null ? '' : round2(d.idleDays),
  })));

  addSheet(wb, 'Stockouts', outs.worst.map(w => ({
    Item: w.name,
    Occasions_At_Zero: w.occasions,
  })));

  addSheet(wb, 'Item_Performance', items.map(item => ({
    Item: item.name,
    Category: item.category,
    Units: round2(item.units),
    Net_Revenue: round2(item.netRevenue),
    COGS: item.costed ? round2(item.cogs) : '',
    Gross_Profit: item.costed ? round2(item.grossProfit) : '',
    Margin_Pct: item.marginPct === null ? '' : round2(item.marginPct),
    Oversold_Units: round2(item.oversold),
    Fully_Costed: item.costed ? 'yes' : 'no',
  })));

  addSheet(wb, 'Category_Performance', categoryPerformance(items).map(c => ({
    Category: c.category,
    Units: round2(c.units),
    Net_Revenue: round2(c.netRevenue),
    Share_Pct: round2(c.share * 100),
  })));

  addSheet(wb, 'Hourly_Pattern', tradingHours(orders, range).map(h => ({
    Hour: `${String(h.hour).padStart(2, '0')}:00`,
    Orders: h.orders,
    Units: h.units,
    Net_Revenue: round2(h.netRevenue),
  })));

  addSheet(wb, 'Stock_Position', stockItems.map(item => {
    const rate = consumptionRate(movements, item.id);
    return {
      Item: item.name,
      On_Hand: round2(item.quantity),
      Unit: item.unit,
      Low_Stock_Threshold: round2(item.lowStockThreshold),
      Cost_Per_Unit: item.costPerUnit > 0 ? round2(item.costPerUnit) : '',
      Stock_Value: item.costPerUnit > 0 ? round2(item.quantity * item.costPerUnit) : '',
      Per_Trading_Hour: rate.reliable ? round2(rate.perHour) : '',
      Hours_Left: rate.reliable && rate.perHour > 0 ? round2(item.quantity / rate.perHour) : '',
      Trading_Hours_Observed: rate.tradingHours,
      Rate_Reliable: rate.reliable ? 'yes' : 'no',
    };
  }));

  addSheet(wb, 'Reorder', reorderList(stockItems, movements).map(s => ({
    Item: s.stockItem.name,
    On_Hand: round2(s.stockItem.quantity),
    Unit: s.stockItem.unit,
    Shortfall: round2(s.shortfall),
    Packets: s.packets ?? '',
    Packet_Label: s.stockItem.packetLabel ?? '',
    Hours_Left: s.hoursLeft === undefined ? '' : round2(s.hoursLeft),
    Reason: s.reason === 'low' ? 'under threshold' : 'running out',
  })));

  addSheet(wb, 'Oversell_Summary', Object.values(
    oversells
      .filter(e => e.timestamp >= range.start && e.timestamp < range.end)
      .reduce<Record<string, { Item: string; Occasions: number; Units: number }>>((acc, e) => {
        const row = acc[e.menuItemId] ?? { Item: e.menuItemName, Occasions: 0, Units: 0 };
        row.Occasions += 1;
        row.Units += e.quantity;
        acc[e.menuItemId] = row;
        return acc;
      }, {})));

  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
}

/** `pos-data-2026-08-17.xlsx` — sortable, and obvious in a folder listing. */
export function exportFileName(kind: 'data' | 'summary', at: number): string {
  const d = new Date(at);
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const time = `${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
  return `pos-${kind}-${stamp}-${time}.xlsx`;
}
