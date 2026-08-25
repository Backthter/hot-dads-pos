import { orderMoney } from './metrics';
import { COST_BASIS_LABEL } from '../lib/sessions';
import type { MoneyRow } from './metrics';
import type {
  CostBasis, MenuItem, Order, StockItem, TradingEvent, TradingSession,
} from '../types';

/**
 * One filter language, used by the dashboards, the Orders Explorer and the
 * money ledger.
 *
 * Conditions are data, not code: they can be serialised into a saved search,
 * round-tripped through storage, and rendered as a sentence — none of which is
 * possible once a filter is a closure.
 *
 * **The row type is a parameter** (1C-iii-b). Everything that makes the
 * language work — the operators, the comparison, the tree, the sentence —
 * never knew what an order was; only the *field list* did. Making that explicit
 * is what let History · Money have the same builder rather than a second, worse
 * one written against a different set of dropdowns. Each screen supplies its
 * own `FieldDef[]` and gets the rest.
 */

export type Operator =
  | 'eq' | 'neq' | 'contains' | 'notContains' | 'startsWith'
  | 'gt' | 'gte' | 'lt' | 'lte' | 'between'
  | 'in' | 'notIn' | 'exists' | 'notExists';

export type FieldKind = 'text' | 'number' | 'money' | 'date' | 'enum' | 'itemRef';

export interface FieldDef<Row> {
  id: string;
  label: string;
  group: string;
  kind: FieldKind;
  /** Options for enum fields. */
  options?: { value: string; label: string }[];
  /**
   * Pulls the comparable value out of a row.
   *
   * A field closes over whatever lookups it needs when the list is built, so
   * there is no context argument threaded through the tree. There used to be
   * one, and it existed only so `applyFilter` could rebuild the field list it
   * had already been handed.
   */
  value: (row: Row) => unknown;
  /** Human sentence fragment, e.g. "total is more than". */
  describe?: string;
}

export interface Condition {
  id: string;
  field: string;
  operator: Operator;
  value?: string | number;
  /** Second operand for `between`. */
  value2?: string | number;
}

export interface Group {
  id: string;
  combinator: 'and' | 'or';
  children: (Condition | Group)[];
}

export const isGroup = (node: Condition | Group): node is Group =>
  (node as Group).children !== undefined;

/* ------------------------------------------------------------------ fields */

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function fieldsFor(
  menuItems: MenuItem[],
  sessions: TradingSession[] = [],
  events: TradingEvent[] = [],
): FieldDef<Order>[] {
  const categories = [...new Set(menuItems.map(m => m.category).filter(Boolean))];
  const sessionName = new Map(sessions.map(s => [s.id, s.name]));
  const eventOf = new Map(sessions.map(s => [s.id, s.eventId]));
  const eventName = new Map(events.map(e => [e.id, e.name]));

  return [
    // -- identity
    { id: 'orderNumber', label: 'Order number', group: 'Order', kind: 'text',
      value: o => o.orderNumber },
    { id: 'notes', label: 'Notes', group: 'Order', kind: 'text', value: o => o.notes },

    // -- where it was taken
    //
    // Matched on the name rather than the id, so a saved search survives being
    // read by a human and reads as a sentence: "Session is Winter Market".
    { id: 'session', label: 'Session', group: 'Session', kind: 'enum',
      options: sessions
        .slice()
        .sort((a, b) => b.startedAt - a.startedAt)
        .map(s => ({ value: s.name, label: s.name })),
      value: o => (o.sessionId ? sessionName.get(o.sessionId) ?? '' : '') },
    { id: 'event', label: 'Event', group: 'Session', kind: 'enum',
      options: events.map(e => ({ value: e.name, label: e.name })),
      value: o => {
        if (!o.sessionId) return '';
        const eventId = eventOf.get(o.sessionId);
        return eventId ? eventName.get(eventId) ?? '' : '';
      } },
    { id: 'sessionTicket', label: 'Session ticket', group: 'Session', kind: 'number',
      value: o => o.sessionTicket ?? null },
    { id: 'inSession', label: 'Taken in a session', group: 'Session', kind: 'enum',
      options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }],
      value: o => (o.sessionId ? 'yes' : 'no') },

    // -- time
    { id: 'date', label: 'Date', group: 'Time', kind: 'date', value: o => o.timestamp },
    { id: 'hour', label: 'Hour of day', group: 'Time', kind: 'number',
      value: o => new Date(o.timestamp).getHours() },
    { id: 'weekday', label: 'Weekday', group: 'Time', kind: 'enum',
      options: WEEKDAYS.map(d => ({ value: d, label: d })),
      value: o => WEEKDAYS[new Date(o.timestamp).getDay()] },

    // -- state
    { id: 'status', label: 'Status', group: 'State', kind: 'enum',
      options: ['preparing', 'grill', 'ready', 'completed'].map(s => ({ value: s, label: s })),
      value: o => o.status },
    { id: 'voided', label: 'Voided', group: 'State', kind: 'enum',
      options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }],
      value: o => (o.voidedAt ? 'yes' : 'no') },
    { id: 'edited', label: 'Edited', group: 'State', kind: 'enum',
      options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }],
      value: o => (o.editedAt ? 'yes' : 'no') },

    // -- money
    { id: 'total', label: 'Total paid', group: 'Money', kind: 'money', value: o => o.total },
    { id: 'netRevenue', label: 'Net revenue', group: 'Money', kind: 'money',
      value: o => orderMoney(o).netRevenue },
    { id: 'discount', label: 'Discount', group: 'Money', kind: 'money',
      value: o => o.discountAmount ?? 0 },
    { id: 'tax', label: 'Tax', group: 'Money', kind: 'money', value: o => o.taxAmount ?? 0 },
    { id: 'cogs', label: 'Cost of goods', group: 'Money', kind: 'money',
      value: o => orderMoney(o).cogs },
    { id: 'grossProfit', label: 'Gross profit', group: 'Money', kind: 'money',
      value: o => { const m = orderMoney(o); return m.costedRevenue - m.cogs; } },
    { id: 'payment', label: 'Payment method', group: 'Money', kind: 'enum',
      options: [{ value: 'cash', label: 'Cash' }, { value: 'transfer', label: 'Transfer' }],
      value: o => o.paid ?? '' },

    // -- contents
    { id: 'item', label: 'Contains item', group: 'Contents', kind: 'itemRef',
      options: menuItems.map(m => ({ value: m.name, label: m.name })),
      value: o => o.items.map(i => i.name) },
    { id: 'category', label: 'Contains category', group: 'Contents', kind: 'enum',
      options: categories.map(c => ({ value: c, label: c })),
      value: o => o.items
        .map(i => menuItems.find(m => m.id === i.menuItemId)?.category ?? '')
        .filter(Boolean) },
    { id: 'units', label: 'Total units', group: 'Contents', kind: 'number',
      value: o => o.items.reduce((n, i) => n + i.quantity, 0) },
    { id: 'distinctItems', label: 'Distinct items', group: 'Contents', kind: 'number',
      value: o => o.items.length },
    { id: 'oversold', label: 'Sold beyond stock', group: 'Contents', kind: 'number',
      value: o => o.items.reduce((n, i) => n + (i.oversoldQuantity ?? 0), 0) },
  ];
}

/**
 * The same language, over the money ledger's rows.
 *
 * Deliberately a separate list rather than a superset of `fieldsFor`: a money
 * row and an order have almost nothing in common, and a single list covering
 * both would be mostly fields that are null on half the rows — which is the
 * shape invariant 2 is about, arriving through a filter instead of a figure.
 *
 * Enums are matched on names, like the order fields, so a saved query reads as
 * a sentence rather than as a row of ids.
 */
export function moneyFields(
  sessions: TradingSession[] = [],
  events: TradingEvent[] = [],
  stockItems: StockItem[] = [],
): FieldDef<MoneyRow>[] {
  const sessionName = new Map(sessions.map(s => [s.id, s.name]));
  const eventOf = new Map(sessions.map(s => [s.id, s.eventId]));
  const eventName = new Map(events.map(e => [e.id, e.name]));
  const stockName = new Map(stockItems.map(i => [i.id, i.name]));

  const eventFor = (row: MoneyRow): string => {
    // A cost filed against the event names it directly; a sales row or a
    // session's own cost inherits it from the session it belongs to.
    const id = row.eventId ?? (row.sessionId ? eventOf.get(row.sessionId) : undefined);
    return id ? eventName.get(id) ?? '' : '';
  };

  return [
    { id: 'kind', label: 'Kind', group: 'Row', kind: 'enum',
      options: [
        { value: 'purchase', label: 'Stock bought' },
        { value: 'cost', label: 'Cost logged' },
        { value: 'sales', label: 'Sales' },
      ],
      value: r => r.kind },
    { id: 'description', label: 'Description', group: 'Row', kind: 'text',
      value: r => r.label },
    { id: 'basis', label: 'Charged', group: 'Row', kind: 'enum',
      options: (Object.keys(COST_BASIS_LABEL) as CostBasis[])
        .map(b => ({ value: COST_BASIS_LABEL[b], label: COST_BASIS_LABEL[b] })),
      value: r => (r.basis ? COST_BASIS_LABEL[r.basis] : '') },
    // Whether a figure is on file at all, which is the one thing about a row
    // that a rupee comparison cannot express: `Out is less than 1` and `Out is
    // not known` are different questions and only one of them has an operator.
    { id: 'priced', label: 'Has an amount', group: 'Row', kind: 'enum',
      options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }],
      value: r => (r.moneyIn === null && r.moneyOut === null ? 'no' : 'yes') },

    { id: 'out', label: 'Money out', group: 'Money', kind: 'money', value: r => r.moneyOut },
    { id: 'in', label: 'Money in', group: 'Money', kind: 'money', value: r => r.moneyIn },
    { id: 'running', label: 'Running total', group: 'Money', kind: 'money',
      value: r => r.running },

    { id: 'date', label: 'Date', group: 'Time', kind: 'date', value: r => r.at },
    { id: 'hour', label: 'Hour of day', group: 'Time', kind: 'number',
      value: r => new Date(r.at).getHours() },
    { id: 'weekday', label: 'Weekday', group: 'Time', kind: 'enum',
      options: WEEKDAYS.map(d => ({ value: d, label: d })),
      value: r => WEEKDAYS[new Date(r.at).getDay()] },

    { id: 'session', label: 'Session', group: 'Where', kind: 'enum',
      options: sessions
        .slice()
        .sort((a, b) => b.startedAt - a.startedAt)
        .map(s => ({ value: s.name, label: s.name })),
      value: r => (r.sessionId ? sessionName.get(r.sessionId) ?? '' : '') },
    { id: 'event', label: 'Event', group: 'Where', kind: 'enum',
      options: events.map(e => ({ value: e.name, label: e.name })),
      value: eventFor },
    { id: 'item', label: 'Stock item', group: 'Where', kind: 'enum',
      options: stockItems.map(i => ({ value: i.name, label: i.name })),
      value: r => (r.stockItemId ? stockName.get(r.stockItemId) ?? '' : '') },
  ];
}

/* --------------------------------------------------------------- matching */

function compare(actual: unknown, condition: Condition): boolean {
  const { operator, value, value2 } = condition;

  if (operator === 'exists') return actual !== undefined && actual !== null && actual !== '';
  if (operator === 'notExists') return actual === undefined || actual === null || actual === '';

  // Array-valued fields (the items in an order) match if any element matches.
  if (Array.isArray(actual)) {
    const anyMatch = actual.some(entry => compare(entry, condition));
    // "does not contain" has to hold for every element, not any.
    if (operator === 'neq' || operator === 'notContains' || operator === 'notIn') {
      return actual.length === 0 ? true : !actual.some(entry => compare(entry, { ...condition, operator: invert(operator) }));
    }
    return anyMatch;
  }

  const asNumber = typeof actual === 'number' ? actual : parseFloat(String(actual));
  const target = typeof value === 'number' ? value : parseFloat(String(value ?? ''));
  const text = String(actual ?? '').toLowerCase();
  const targetText = String(value ?? '').toLowerCase();

  switch (operator) {
    case 'eq': return typeof actual === 'number' ? asNumber === target : text === targetText;
    case 'neq': return typeof actual === 'number' ? asNumber !== target : text !== targetText;
    case 'contains': return text.includes(targetText);
    case 'notContains': return !text.includes(targetText);
    case 'startsWith': return text.startsWith(targetText);
    case 'gt': return asNumber > target;
    case 'gte': return asNumber >= target;
    case 'lt': return asNumber < target;
    case 'lte': return asNumber <= target;
    case 'between': {
      const upper = typeof value2 === 'number' ? value2 : parseFloat(String(value2 ?? ''));
      return asNumber >= Math.min(target, upper) && asNumber <= Math.max(target, upper);
    }
    case 'in': return String(value ?? '').split(',').map(s => s.trim().toLowerCase()).includes(text);
    case 'notIn': return !String(value ?? '').split(',').map(s => s.trim().toLowerCase()).includes(text);
    default: return true;
  }
}

function invert(operator: Operator): Operator {
  if (operator === 'neq') return 'eq';
  if (operator === 'notContains') return 'contains';
  if (operator === 'notIn') return 'in';
  return operator;
}

/** Evaluates a nested group against one row. An empty group matches everything. */
export function matchesGroup<Row>(row: Row, group: Group, fields: FieldDef<Row>[]): boolean {
  if (group.children.length === 0) return true;
  const results = group.children.map(child => {
    if (isGroup(child)) return matchesGroup(row, child, fields);
    const field = fields.find(f => f.id === child.field);
    // An unknown field matches rather than excludes. A saved search written
    // against a field that has since been renamed should return too much and
    // be obvious, not return nothing and look like an empty day.
    if (!field) return true;
    return compare(field.value(row), child);
  });
  return group.combinator === 'and' ? results.every(Boolean) : results.some(Boolean);
}

/**
 * Applies a filter tree. Fields are indexed once rather than per row — with a
 * few hundred rows it hardly matters, but looking a field up inside the loop is
 * the kind of thing that quietly becomes the bottleneck later.
 */
export function applyFilter<Row>(
  rows: Row[],
  group: Group,
  fields: FieldDef<Row>[],
): Row[] {
  const byId = new Map(fields.map(f => [f.id, f]));

  const evaluate = (row: Row, node: Condition | Group): boolean => {
    if (isGroup(node)) {
      if (node.children.length === 0) return true;
      const results = node.children.map(child => evaluate(row, child));
      return node.combinator === 'and' ? results.every(Boolean) : results.some(Boolean);
    }
    const field = byId.get(node.field);
    if (!field) return true;
    return compare(field.value(row), node);
  };

  return rows.filter(row => evaluate(row, group));
}

/* -------------------------------------------------------------- describing */

export const OPERATOR_LABELS: Record<Operator, string> = {
  eq: 'is', neq: 'is not', contains: 'contains', notContains: 'does not contain',
  startsWith: 'starts with', gt: 'is more than', gte: 'is at least',
  lt: 'is less than', lte: 'is at most', between: 'is between',
  in: 'is one of', notIn: 'is none of', exists: 'is set', notExists: 'is not set',
};

export function operatorsFor(kind: FieldKind): Operator[] {
  switch (kind) {
    case 'number':
    case 'money':
    case 'date':
      return ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between'];
    case 'enum':
      return ['eq', 'neq', 'in', 'notIn'];
    case 'itemRef':
      return ['eq', 'neq', 'contains', 'notContains'];
    case 'text':
    default:
      return ['contains', 'notContains', 'eq', 'neq', 'startsWith', 'exists', 'notExists'];
  }
}

/** Renders a filter tree as a readable sentence, for saved searches. */
export function describeGroup<Row>(group: Group, fields: FieldDef<Row>[]): string {
  const part = (node: Condition | Group): string => {
    if (isGroup(node)) {
      if (node.children.length === 0) return '';
      const inner = node.children.map(part).filter(Boolean);
      const joined = inner.join(node.combinator === 'and' ? ' and ' : ' or ');
      return inner.length > 1 ? `(${joined})` : joined;
    }
    const field = fields.find(f => f.id === node.field);
    if (!field) return '';
    const op = OPERATOR_LABELS[node.operator];
    if (node.operator === 'exists' || node.operator === 'notExists') return `${field.label} ${op}`;
    if (node.operator === 'between') return `${field.label} ${op} ${node.value} and ${node.value2}`;
    return `${field.label} ${op} ${node.value ?? ''}`.trim();
  };
  return part(group) || 'Everything';
}

let seq = 0;
export const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(seq += 1)}`;

export function emptyGroup(): Group {
  return { id: newId('g'), combinator: 'and', children: [] };
}
