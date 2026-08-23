import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronDown, Plus, Save, Search, SlidersHorizontal, Trash2, X } from 'lucide-react';
import { ACCENT, DANGER, money } from './AnalyticsUI';
import { orderMoney, totalsFor } from './metrics';
import {
  OPERATOR_LABELS, applyFilter, describeGroup, emptyGroup, fieldsFor, isGroup, newId,
  operatorsFor, type Condition, type Group,
} from './filters';
import {
  categoryIndex, describeSearch, matchesSearch, parseSearch, searchHaystack, sessionIndex,
} from './search';
import { eventGroups } from '../lib/sessions';
import type { MenuItem, Order, TradingEvent, TradingSession } from '../types';

/**
 * Search over every order ever taken.
 *
 * The filter is a tree of conditions rather than a fixed set of dropdowns, so
 * "cash orders over Rs 2,000 that contained a burger, excluding voids" is one
 * query rather than a feature request. The same tree drives the description,
 * the saved searches and — because it is plain data — anything later built on
 * top of it.
 */
export function OrdersExplorer({
  orders, menuItems, sessions, events, revenueLocked,
}: {
  orders: Order[];
  menuItems: MenuItem[];
  sessions: TradingSession[];
  events: TradingEvent[];
  revenueLocked: boolean;
}) {
  const [group, setGroup] = useState<Group>(() => emptyGroup());
  const [saved, setSaved] = useState<{ id: string; name: string; group: Group; text: string }[]>([]);
  const [selected, setSelected] = useState<Order | null>(null);
  const [sort, setSort] = useState<'newest' | 'oldest' | 'largest' | 'event'>('newest');
  const [text, setText] = useState('');
  const [showBuilder, setShowBuilder] = useState(false);

  const fields = useMemo(
    () => fieldsFor(menuItems, sessions, events), [menuItems, sessions, events]);
  const query = useMemo(() => parseSearch(text), [text]);
  const categories = useMemo(() => categoryIndex(menuItems), [menuItems]);
  const sessionNames = useMemo(() => sessionIndex(sessions, events), [sessions, events]);

  /** Session id → the event and session it sits under, for grouping and labels. */
  const placement = useMemo(() => {
    const map = new Map<string, { eventName: string; eventStart: number; sessionStart: number; label: string }>();
    for (const group of eventGroups(events, sessions)) {
      for (const session of group.sessions) {
        map.set(session.id, {
          eventName: group.name,
          eventStart: group.startedAt,
          sessionStart: session.startedAt,
          label: group.grouped && group.name !== session.name
            ? `${group.name} · ${session.name}`
            : session.name,
        });
      }
    }
    return map;
  }, [sessions, events]);

  const results = useMemo(() => {
    // Free text narrows first: it is a string scan and throws out most of the
    // list, so the condition tree — which resolves fields per order — runs over
    // far fewer rows.
    const searched = query.length === 0
      ? orders
      : orders.filter(o => matchesSearch(searchHaystack(o, categories, sessionNames), query));
    const matched = applyFilter(searched, group, menuItems, sessions, events);
    const sorted = [...matched];
    if (sort === 'newest') sorted.sort((a, b) => b.timestamp - a.timestamp);
    if (sort === 'oldest') sorted.sort((a, b) => a.timestamp - b.timestamp);
    if (sort === 'largest') sorted.sort((a, b) => b.total - a.total);
    if (sort === 'event') {
      // Newest event first, then its sessions in the order they ran, then each
      // session's tickets in the order they were called. Orders taken before
      // sessions existed have nothing to group under and sink to the bottom
      // rather than being scattered through the events they never belonged to.
      sorted.sort((a, b) => {
        const pa = a.sessionId ? placement.get(a.sessionId) : undefined;
        const pb = b.sessionId ? placement.get(b.sessionId) : undefined;
        if (!pa && !pb) return b.timestamp - a.timestamp;
        if (!pa) return 1;
        if (!pb) return -1;
        return (pb.eventStart - pa.eventStart)
          || (pa.sessionStart - pb.sessionStart)
          || ((a.sessionTicket ?? 0) - (b.sessionTicket ?? 0));
      });
    }
    return sorted;
  }, [orders, group, menuItems, sessions, events, sort, query, categories, sessionNames, placement]);

  const totals = useMemo(() => totalsFor(results), [results]);

  const update = (fn: (draft: Group) => void) => {
    setGroup(prev => {
      const copy: Group = JSON.parse(JSON.stringify(prev));
      fn(copy);
      return copy;
    });
  };

  const findGroup = (root: Group, id: string): Group | null => {
    if (root.id === id) return root;
    for (const child of root.children) {
      if (isGroup(child)) {
        const found = findGroup(child, id);
        if (found) return found;
      }
    }
    return null;
  };

  const addCondition = (groupId: string) => update(draft => {
    const target = findGroup(draft, groupId);
    target?.children.push({ id: newId('c'), field: 'total', operator: 'gt', value: 0 });
  });

  const addSubGroup = (groupId: string) => update(draft => {
    const target = findGroup(draft, groupId);
    target?.children.push({ id: newId('g'), combinator: 'or', children: [] });
  });

  const removeNode = (nodeId: string) => update(draft => {
    const strip = (g: Group) => {
      g.children = g.children.filter(c => c.id !== nodeId);
      g.children.forEach(c => { if (isGroup(c)) strip(c); });
    };
    strip(draft);
  });

  const patchCondition = (id: string, patch: Partial<Condition>) => update(draft => {
    const walk = (g: Group) => {
      g.children = g.children.map(c => {
        if (isGroup(c)) { walk(c); return c; }
        return c.id === id ? { ...c, ...patch } : c;
      });
    };
    walk(draft);
  });

  return (
    <div className="flex flex-col h-full min-h-0 gap-[12px]">
      <div className="flex items-center gap-[9px]">
        <div className="relative flex-1">
          <Search
            size={16}
            className="absolute left-[13px] top-1/2 -translate-y-1/2 pointer-events-none"
            style={{ color: text ? ACCENT : 'var(--app-text-muted)' }}
          />
          <input
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="burgers, cash — comma or space for both, slash or “or” for either"
            data-order-search
            className="w-full bg-[var(--app-bg-darker)] border rounded-[11px] pl-[38px] pr-[34px] h-[42px] text-[var(--app-text)] text-[14px] focus:outline-none transition-colors"
            style={{ borderColor: text ? ACCENT : 'var(--app-border)' }}
          />
          {text && (
            <button
              onClick={() => setText('')}
              className="absolute right-[11px] top-1/2 -translate-y-1/2 text-[var(--app-text-muted)]"
              aria-label="Clear search"
            >
              <X size={15} />
            </button>
          )}
        </div>
        <button
          onClick={() => setShowBuilder(o => !o)}
          data-toggle-builder
          className="flex items-center gap-[7px] px-[13px] h-[42px] rounded-[11px] text-[13px] font-semibold border transition-colors"
          style={{
            borderColor: showBuilder ? ACCENT : 'var(--app-border)',
            color: showBuilder ? ACCENT : 'var(--app-text-secondary)',
            background: showBuilder ? `${ACCENT}12` : 'transparent',
          }}
        >
          <SlidersHorizontal size={15} />
          Filters
          {group.children.length > 0 && (
            <span className="text-[11px] tabular-nums">{group.children.length}</span>
          )}
        </button>
      </div>

      <AnimatePresence initial={false}>
        {(showBuilder || group.children.length > 0) && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ type: 'spring', stiffness: 460, damping: 38 }}
            className="overflow-hidden"
          >
            <GroupEditor
              group={group}
              fields={fields}
              depth={0}
              onAddCondition={addCondition}
              onAddGroup={addSubGroup}
              onRemove={removeNode}
              onPatch={patchCondition}
              onToggleCombinator={id => update(draft => {
                const target = findGroup(draft, id);
                if (target) target.combinator = target.combinator === 'and' ? 'or' : 'and';
              })}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex items-center gap-[10px] flex-wrap">
        <span className="text-[var(--app-text-secondary)] text-[13px]" data-explorer-summary>
          <strong style={{ color: 'var(--app-text)' }}>{results.length}</strong> order
          {results.length === 1 ? '' : 's'}
          {query.length > 0 ? ` · matching ${describeSearch(query)}` : ''}
          {group.children.length > 0 ? ` · ${describeGroup(group, menuItems, sessions, events)}` : ''}
        </span>
        {!revenueLocked && (
          <span className="text-[var(--app-text-muted)] text-[13px]" data-explorer-total>
            {money(totals.netRevenue)} net · {Math.round(totals.units)} units
            {totals.voided > 0 ? ` · ${totals.voided} voided` : ''}
          </span>
        )}
        <div className="ml-auto flex items-center gap-[6px]">
          {(['newest', 'oldest', 'largest', 'event'] as const).map(s => (
            <button
              key={s}
              onClick={() => setSort(s)}
              data-sort={s}
              title={s === 'event' ? 'Group by event, then session, then ticket order' : undefined}
              className="px-[10px] h-[28px] rounded-[7px] text-[11px] font-semibold border"
              style={{
                background: sort === s ? `${ACCENT}22` : 'transparent',
                borderColor: sort === s ? ACCENT : 'var(--app-border)',
                color: sort === s ? ACCENT : 'var(--app-text-muted)',
              }}
            >
              {s}
            </button>
          ))}
          <button
            onClick={() => {
              const described = [describeSearch(query), group.children.length > 0 ? describeGroup(group, menuItems, sessions, events) : '']
                .filter(Boolean).join(' · ');
              const name = (described || 'Everything').slice(0, 48);
              setSaved(prev => [...prev, { id: newId('s'), name, group, text }]);
            }}
            data-save-search
            className="flex items-center gap-[6px] px-[11px] h-[28px] rounded-[7px] text-[11px] font-semibold border border-[var(--app-border)] text-[var(--app-text-secondary)]"
          >
            <Save size={12} /> Save search
          </button>
        </div>
      </div>

      {saved.length > 0 && (
        <div className="flex items-center gap-[6px] flex-wrap">
          {saved.map(s => (
            <span key={s.id} className="flex items-center gap-[6px] rounded-[8px] border border-[var(--app-border)] pl-[10px] pr-[6px] h-[28px]">
              <button
                onClick={() => { setGroup(s.group); setText(s.text); }}
                className="text-[var(--app-text-secondary)] text-[11px] font-semibold truncate max-w-[220px]"
                data-saved-search={s.name}
              >
                {s.name}
              </button>
              <button onClick={() => setSaved(prev => prev.filter(x => x.id !== s.id))}
                className="text-[var(--app-text-muted)]">
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Results */}
      <div className="flex-1 min-h-0 overflow-auto rounded-[12px] border border-[var(--app-border)]">
        <table className="w-full text-[12px] border-collapse">
          <thead className="sticky top-0 z-10">
            <tr style={{ background: 'var(--app-bg-darker)' }}>
              {['#', 'When', 'Event / session', 'Status', 'Items', 'Units', 'Net', 'Tax', 'Paid', 'Method', 'Profit']
                .map(h => (
                  <th key={h} className="text-left font-semibold text-[var(--app-text-muted)] uppercase tracking-[0.4px] text-[10px] px-[10px] py-[8px] border-b border-[var(--app-border)]">
                    {h}
                  </th>
                ))}
            </tr>
          </thead>
          <tbody>
            {results.slice(0, 400).map(order => {
              const m = orderMoney(order);
              return (
                <tr
                  key={order.id}
                  onClick={() => setSelected(order)}
                  data-order-row={order.orderNumber}
                  className="cursor-pointer hover:bg-[var(--app-bg-tertiary)]"
                  style={{ opacity: order.voidedAt ? 0.5 : 1 }}
                >
                  <td className="px-[10px] py-[7px] font-semibold text-[var(--app-text)]">
                    {order.orderNumber}
                  </td>
                  <td className="px-[10px] py-[7px] text-[var(--app-text-secondary)] whitespace-nowrap">
                    {new Date(order.timestamp).toLocaleString(undefined, {
                      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                    })}
                  </td>
                  <td className="px-[10px] py-[7px] text-[var(--app-text-muted)] max-w-[170px] truncate">
                    {order.sessionId
                      ? placement.get(order.sessionId)?.label ?? 'Deleted session'
                      : '—'}
                  </td>
                  <td className="px-[10px] py-[7px]">
                    <span style={{ color: order.voidedAt ? DANGER : 'var(--app-text-secondary)' }}>
                      {order.voidedAt ? 'voided' : order.status}
                    </span>
                  </td>
                  <td className="px-[10px] py-[7px] text-[var(--app-text-secondary)] max-w-[240px] truncate">
                    {order.items.map(i => `${i.quantity}× ${i.name}`).join(', ')}
                  </td>
                  <td className="px-[10px] py-[7px] tabular-nums text-[var(--app-text-secondary)]">{m.units}</td>
                  <td className="px-[10px] py-[7px] tabular-nums text-[var(--app-text)]">
                    {revenueLocked ? '—' : money(m.netRevenue)}
                  </td>
                  <td className="px-[10px] py-[7px] tabular-nums text-[var(--app-text-muted)]">
                    {revenueLocked ? '—' : money(m.tax)}
                  </td>
                  <td className="px-[10px] py-[7px] tabular-nums text-[var(--app-text-secondary)]">
                    {revenueLocked ? '—' : money(m.collected)}
                  </td>
                  <td className="px-[10px] py-[7px] text-[var(--app-text-muted)]">{order.paid ?? '—'}</td>
                  <td className="px-[10px] py-[7px] tabular-nums text-[var(--app-text-muted)]">
                    {revenueLocked || m.costCoverage === 0 ? '—' : money(m.costedRevenue - m.cogs)}
                  </td>
                </tr>
              );
            })}
            {results.length === 0 && (
              <tr>
                <td colSpan={11} className="px-[14px] py-[26px] text-center text-[var(--app-text-muted)]">
                  {query.length > 1
                    ? 'No orders match every term. A slash between them — burgers/cash — matches either instead.'
                    : query.length === 1 && query[0].length > 1
                      ? 'No order contains all of those. Try a slash between them to match either.'
                      : 'No orders match. Loosen a condition, or switch the group to “any”.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {results.length > 400 && (
          <p className="text-[var(--app-text-muted)] text-[11px] px-[12px] py-[8px]">
            Showing the first 400 of {results.length}. Narrow the filter to see the rest.
          </p>
        )}
      </div>

      <AnimatePresence>
        {selected && (
          <OrderDetail order={selected} revenueLocked={revenueLocked} onClose={() => setSelected(null)} />
        )}
      </AnimatePresence>
    </div>
  );
}

/* ------------------------------------------------------------ filter tree */

function GroupEditor({
  group, fields, depth, onAddCondition, onAddGroup, onRemove, onPatch, onToggleCombinator,
}: {
  group: Group;
  fields: ReturnType<typeof fieldsFor>;
  depth: number;
  onAddCondition: (groupId: string) => void;
  onAddGroup: (groupId: string) => void;
  onRemove: (nodeId: string) => void;
  onPatch: (id: string, patch: Partial<Condition>) => void;
  onToggleCombinator: (groupId: string) => void;
}) {
  return (
    <div
      className="rounded-[12px] border p-[10px] flex flex-col gap-[7px]"
      style={{
        borderColor: depth === 0 ? 'var(--app-border)' : `${ACCENT}55`,
        background: depth === 0 ? 'var(--app-bg-darker)' : 'transparent',
      }}
      data-filter-group={group.id}
    >
      <div className="flex items-center gap-[8px]">
        <button
          onClick={() => onToggleCombinator(group.id)}
          data-combinator={group.id}
          className="px-[10px] h-[26px] rounded-[7px] text-[11px] font-bold border"
          style={{ borderColor: ACCENT, color: ACCENT, background: `${ACCENT}18` }}
          title="Right now every condition has to match. Tap to switch to matching any one of them."
        >
          {group.combinator === 'and' ? 'ALL of' : 'ANY of'}
        </button>
        <button
          onClick={() => onAddCondition(group.id)}
          data-add-condition
          className="flex items-center gap-[5px] px-[10px] h-[26px] rounded-[7px] text-[11px] font-semibold border border-[var(--app-border)] text-[var(--app-text-secondary)]"
        >
          <Plus size={11} /> Condition
        </button>
        {depth < 2 && (
          <button
            onClick={() => onAddGroup(group.id)}
            data-add-group
            className="flex items-center gap-[5px] px-[10px] h-[26px] rounded-[7px] text-[11px] font-semibold border border-[var(--app-border)] text-[var(--app-text-secondary)]"
          >
            <Plus size={11} /> Group
          </button>
        )}
        {depth > 0 && (
          <button onClick={() => onRemove(group.id)} className="ml-auto text-[var(--app-text-muted)]">
            <Trash2 size={13} />
          </button>
        )}
      </div>

      {group.children.map(child => (
        isGroup(child) ? (
          <div key={child.id} className="pl-[14px]">
            <GroupEditor
              group={child} fields={fields} depth={depth + 1}
              onAddCondition={onAddCondition} onAddGroup={onAddGroup}
              onRemove={onRemove} onPatch={onPatch} onToggleCombinator={onToggleCombinator}
            />
          </div>
        ) : (
          <ConditionRow
            key={child.id} condition={child} fields={fields}
            onPatch={onPatch} onRemove={onRemove}
          />
        )
      ))}
    </div>
  );
}

function ConditionRow({
  condition, fields, onPatch, onRemove,
}: {
  condition: Condition;
  fields: ReturnType<typeof fieldsFor>;
  onPatch: (id: string, patch: Partial<Condition>) => void;
  onRemove: (id: string) => void;
}) {
  const field = fields.find(f => f.id === condition.field) ?? fields[0];
  const operators = operatorsFor(field.kind);
  const needsValue = condition.operator !== 'exists' && condition.operator !== 'notExists';

  const select = "bg-[var(--app-surface)] border border-[var(--app-border)] rounded-[7px] px-[8px] h-[30px] text-[var(--app-text)] text-[12px] focus:outline-none";

  return (
    <div className="flex items-center gap-[6px] pl-[4px]" data-condition={condition.id}>
      <select
        value={condition.field}
        onChange={e => {
          const next = fields.find(f => f.id === e.target.value)!;
          onPatch(condition.id, {
            field: next.id,
            operator: operatorsFor(next.kind)[0],
            value: next.kind === 'number' || next.kind === 'money' ? 0 : '',
          });
        }}
        className={select}
        data-condition-field
      >
        {[...new Set(fields.map(f => f.group))].map(groupName => (
          <optgroup key={groupName} label={groupName}>
            {fields.filter(f => f.group === groupName).map(f => (
              <option key={f.id} value={f.id}>{f.label}</option>
            ))}
          </optgroup>
        ))}
      </select>

      <select
        value={condition.operator}
        onChange={e => onPatch(condition.id, { operator: e.target.value as Condition['operator'] })}
        className={select}
        data-condition-operator
      >
        {operators.map(op => <option key={op} value={op}>{OPERATOR_LABELS[op]}</option>)}
      </select>

      {needsValue && (field.options ? (
        <select
          value={String(condition.value ?? '')}
          onChange={e => onPatch(condition.id, { value: e.target.value })}
          className={select}
          data-condition-value
        >
          <option value="">choose…</option>
          {field.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      ) : (
        <input
          value={String(condition.value ?? '')}
          onChange={e => onPatch(condition.id, { value: e.target.value })}
          placeholder={field.kind === 'money' ? 'amount' : 'value'}
          className={`${select} w-[120px]`}
          data-condition-value
        />
      ))}

      {condition.operator === 'between' && (
        <input
          value={String(condition.value2 ?? '')}
          onChange={e => onPatch(condition.id, { value2: e.target.value })}
          placeholder="and"
          className={`${select} w-[100px]`}
          data-condition-value2
        />
      )}

      <button onClick={() => onRemove(condition.id)} className="text-[var(--app-text-muted)]">
        <X size={13} />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------- drill-down */

function OrderDetail({
  order, revenueLocked, onClose,
}: { order: Order; revenueLocked: boolean; onClose: () => void }) {
  const m = orderMoney(order);
  const stage = (label: string, at?: number) =>
    at ? `${label} ${new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}` : null;
  const timeline = [
    stage('Taken', order.timestamp),
    stage('On the grill', order.grilledAt),
    stage('Ready', order.readyAt),
    stage('Completed', order.completedAt),
    order.voidedAt ? `Voided ${new Date(order.voidedAt).toLocaleTimeString()}` : null,
  ].filter(Boolean);

  return (
    <motion.div
      className="fixed inset-0 z-[110] flex items-center justify-center p-[24px]"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      transition={{ duration: 0.12 }}
      style={{ background: 'rgba(6,6,8,0.6)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
      data-order-detail
    >
      <motion.div
        initial={{ scale: 0.95, y: 10 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.97, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 480, damping: 34 }}
        onClick={e => e.stopPropagation()}
        className="bg-[var(--app-bg-darker)] border border-[var(--app-border)] rounded-[16px] p-[20px] w-full max-w-[520px] sheet-max-h flex flex-col"
      >
        <div className="flex items-baseline gap-[10px] mb-[12px]">
          <h3 className="text-[var(--app-text)] text-[18px] font-bold">Order {order.orderNumber}</h3>
          <span className="text-[var(--app-text-muted)] text-[12px]">
            {new Date(order.timestamp).toLocaleString()}
          </span>
          <button onClick={onClose} className="ml-auto text-[var(--app-text-muted)]"><X size={17} /></button>
        </div>

        {order.voidedAt && (
          <div className="rounded-[9px] px-[11px] py-[7px] mb-[12px] text-[12px] font-semibold"
            style={{ background: `${DANGER}18`, color: DANGER }}>
            Voided — excluded from every revenue figure. Its stock was returned.
          </div>
        )}

        <div className="flex flex-col gap-[4px] mb-[12px]">
          {order.items.map((item, i) => (
            <div key={i} className="flex items-baseline gap-[8px] text-[13px]">
              <span className="text-[var(--app-text)]">{item.quantity}× {item.name}</span>
              {item.oversoldQuantity ? (
                <span className="text-[11px]" style={{ color: DANGER }}>
                  {item.oversoldQuantity} beyond stock
                </span>
              ) : null}
              <span className="flex-1 border-b border-dotted border-[var(--app-border)]" />
              <span className="tabular-nums text-[var(--app-text-secondary)]">
                {revenueLocked ? '—' : money(item.price * item.quantity)}
              </span>
              <span className="tabular-nums text-[var(--app-text-muted)] text-[11px] w-[74px] text-right">
                {item.unitCost === undefined ? 'no cost' : `cost ${money(item.unitCost * item.quantity)}`}
              </span>
            </div>
          ))}
        </div>

        {!revenueLocked && (
          <div className="rounded-[10px] border border-[var(--app-border)] bg-[var(--app-surface)] p-[11px] flex flex-col gap-[3px] text-[12px]">
            <Row label="Gross" value={money(m.gross)} />
            {m.discount > 0 && <Row label="Discount" value={`− ${money(m.discount)}`} tone={DANGER} />}
            <Row label="Net revenue" value={money(m.netRevenue)} />
            {m.tax > 0 && <Row label={`Tax (${order.taxRate}%)`} value={money(m.tax)} />}
            <Row label="Collected" value={money(m.collected)} strong />
            {m.costCoverage > 0 && (
              <>
                <Row label="Cost of goods" value={money(m.cogs)} />
                <Row label="Gross profit" value={money(m.costedRevenue - m.cogs)} tone="#63D07F" strong />
              </>
            )}
            {m.costCoverage < 1 && (
              <span className="text-[var(--app-text-muted)] text-[11px] mt-[4px]">
                {m.costCoverage === 0
                  ? 'No line on this order carries a cost, so profit cannot be shown.'
                  : `Only ${Math.round(m.costCoverage * 100)}% of lines are costed; profit covers those.`}
              </span>
            )}
          </div>
        )}

        <div className="flex items-center gap-[8px] flex-wrap mt-[12px]">
          {timeline.map(entry => (
            <span key={entry as string}
              className="rounded-[7px] border border-[var(--app-border)] px-[9px] h-[26px] flex items-center text-[11px] text-[var(--app-text-secondary)]">
              {entry}
            </span>
          ))}
          {order.editCount ? (
            <span className="text-[11px] text-[var(--app-text-muted)]">
              edited {order.editCount}×
            </span>
          ) : null}
        </div>

        {order.notes && (
          <p className="text-[var(--app-text-secondary)] text-[12px] mt-[10px] italic">“{order.notes}”</p>
        )}
      </motion.div>
    </motion.div>
  );
}

function Row({ label, value, tone, strong }: { label: string; value: string; tone?: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline">
      <span className="text-[var(--app-text-muted)]">{label}</span>
      <span className="flex-1" />
      <span
        className="tabular-nums"
        style={{ color: tone ?? 'var(--app-text)', fontWeight: strong ? 700 : 500 }}
      >
        {value}
      </span>
    </div>
  );
}
