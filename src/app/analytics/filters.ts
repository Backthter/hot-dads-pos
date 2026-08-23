import { orderMoney } from './metrics';
import type { MenuItem, Order, TradingEvent, TradingSession } from '../types';

/**
 * One filter language, used by both the dashboards and the Orders Explorer.
 *
 * Conditions are data, not code: they can be serialised into a saved search,
 * round-tripped through storage, and rendered as a sentence — none of which is
 * possible once a filter is a closure.
 */

export type Operator =
  | 'eq' | 'neq' | 'contains' | 'notContains' | 'startsWith'
  | 'gt' | 'gte' | 'lt' | 'lte' | 'between'
  | 'in' | 'notIn' | 'exists' | 'notExists';

export type FieldKind = 'text' | 'number' | 'money' | 'date' | 'enum' | 'itemRef';

export interface FieldDef {
  id: string;
  label: string;
  group: string;
  kind: FieldKind;
  /** Options for enum fields. */
  options?: { value: string; label: string }[];
  /** Pulls the comparable value out of an order. */
  value: (order: Order, ctx: FilterContext) => unknown;
  /** Human sentence fragment, e.g. "total is more than". */
  describe?: string;
}

export interface FilterContext {
  menuItems: MenuItem[];
  sessions?: TradingSession[];
  events?: TradingEvent[];
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
): FieldDef[] {
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
      value: (o, ctx) => o.items
        .map(i => ctx.menuItems.find(m => m.id === i.menuItemId)?.category ?? '')
        .filter(Boolean) },
    { id: 'units', label: 'Total units', group: 'Contents', kind: 'number',
      value: o => o.items.reduce((n, i) => n + i.quantity, 0) },
    { id: 'distinctItems', label: 'Distinct items', group: 'Contents', kind: 'number',
      value: o => o.items.length },
    { id: 'oversold', label: 'Sold beyond stock', group: 'Contents', kind: 'number',
      value: o => o.items.reduce((n, i) => n + (i.oversoldQuantity ?? 0), 0) },
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

export function matchesCondition(order: Order, condition: Condition, ctx: FilterContext): boolean {
  const field = fieldsFor(ctx.menuItems, ctx.sessions, ctx.events)
    .find(f => f.id === condition.field);
  if (!field) return true;
  return compare(field.value(order, ctx), condition);
}

/** Evaluates a nested group. An empty group matches everything. */
export function matchesGroup(order: Order, group: Group, ctx: FilterContext): boolean {
  if (group.children.length === 0) return true;
  const results = group.children.map(child =>
    isGroup(child) ? matchesGroup(order, child, ctx) : matchesCondition(order, child, ctx));
  return group.combinator === 'and' ? results.every(Boolean) : results.some(Boolean);
}

/**
 * Applies a filter tree. Fields are resolved once rather than per order — with
 * a few hundred orders it hardly matters, but rebuilding the field list inside
 * the loop is the kind of thing that quietly becomes the bottleneck later.
 */
export function applyFilter(
  orders: Order[],
  group: Group,
  menuItems: MenuItem[],
  sessions: TradingSession[] = [],
  events: TradingEvent[] = [],
): Order[] {
  const fields = new Map(fieldsFor(menuItems, sessions, events).map(f => [f.id, f]));
  const ctx: FilterContext = { menuItems, sessions, events };

  const evaluate = (order: Order, node: Condition | Group): boolean => {
    if (isGroup(node)) {
      if (node.children.length === 0) return true;
      const results = node.children.map(child => evaluate(order, child));
      return node.combinator === 'and' ? results.every(Boolean) : results.some(Boolean);
    }
    const field = fields.get(node.field);
    if (!field) return true;
    return compare(field.value(order, ctx), node);
  };

  return orders.filter(order => evaluate(order, group));
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
export function describeGroup(
  group: Group,
  menuItems: MenuItem[],
  sessions: TradingSession[] = [],
  events: TradingEvent[] = [],
): string {
  const fields = fieldsFor(menuItems, sessions, events);
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
