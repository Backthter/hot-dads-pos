import { useCallback, useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { ACCENT } from './AnalyticsUI';
import {
  OPERATOR_LABELS, emptyGroup, isGroup, newId, operatorsFor,
  type Condition, type FieldDef, type Group,
} from './filters';

/**
 * The condition-tree builder, as a component rather than as part of a screen.
 *
 * It was inside `OrdersExplorer` until 1C-iii-b, which is where it belonged
 * while there was one filterable table. There are now two, and the alternative
 * to moving it was retyping two hundred lines of nested selects from memory —
 * which is how two screens end up with two ideas of what "is between" does.
 *
 * Nothing here knows what a row is. It renders `FieldDef<Row>` and emits
 * `Condition` patches; the screen owns the rows, the field list and what
 * happens to the result.
 *
 * The tree *mutations* moved with it, in `useFilterTree`. They are five small
 * recursive functions, and leaving them behind would have been the same
 * problem one layer down.
 */

/** What a builder can do to its tree. Passed as a unit; there are five of them. */
export interface FilterTreeActions {
  onAddCondition: (groupId: string) => void;
  onAddGroup: (groupId: string) => void;
  onRemove: (nodeId: string) => void;
  onPatch: (id: string, patch: Partial<Condition>) => void;
  onToggleCombinator: (groupId: string) => void;
}

export interface FilterTree {
  group: Group;
  setGroup: (next: Group) => void;
  actions: FilterTreeActions;
  /** True when the tree would filter anything out. */
  active: boolean;
}

/**
 * A condition tree, and the five ways to change it.
 *
 * `newCondition` is the caller's, not a default, because the sensible first
 * condition differs per screen — Orders opens on *Total paid is more than 0*,
 * which is a statement about orders and would be nonsense over a money row.
 * Guessing it from `fields[0]` would have quietly changed the orders filter,
 * and this move is supposed to change nothing.
 */
export function useFilterTree(newCondition: () => Omit<Condition, 'id'>): FilterTree {
  const [group, setGroup] = useState<Group>(() => emptyGroup());

  // Every mutation goes through a deep copy. The tree is nested and is held in
  // state, so mutating a node in place would leave React with the same object
  // it already rendered.
  const update = useCallback((fn: (draft: Group) => void) => {
    setGroup(prev => {
      const copy: Group = JSON.parse(JSON.stringify(prev));
      fn(copy);
      return copy;
    });
  }, []);

  const actions: FilterTreeActions = {
    onAddCondition: groupId => update(draft => {
      findGroup(draft, groupId)?.children.push({ id: newId('c'), ...newCondition() });
    }),
    onAddGroup: groupId => update(draft => {
      findGroup(draft, groupId)?.children.push({ id: newId('g'), combinator: 'or', children: [] });
    }),
    onRemove: nodeId => update(draft => {
      const strip = (g: Group) => {
        g.children = g.children.filter(c => c.id !== nodeId);
        g.children.forEach(c => { if (isGroup(c)) strip(c); });
      };
      strip(draft);
    }),
    onPatch: (id, patch) => update(draft => {
      const walk = (g: Group) => {
        g.children = g.children.map(c => {
          if (isGroup(c)) { walk(c); return c; }
          return c.id === id ? { ...c, ...patch } : c;
        });
      };
      walk(draft);
    }),
    onToggleCombinator: groupId => update(draft => {
      const target = findGroup(draft, groupId);
      if (target) target.combinator = target.combinator === 'and' ? 'or' : 'and';
    }),
  };

  return { group, setGroup, actions, active: group.children.length > 0 };
}

function findGroup(root: Group, id: string): Group | null {
  if (root.id === id) return root;
  for (const child of root.children) {
    if (isGroup(child)) {
      const found = findGroup(child, id);
      if (found) return found;
    }
  }
  return null;
}

export function FilterBuilder<Row>({
  group, fields, actions,
}: {
  group: Group;
  fields: FieldDef<Row>[];
  actions: FilterTreeActions;
}) {
  return <GroupEditor group={group} fields={fields} depth={0} {...actions} />;
}

function GroupEditor<Row>({
  group, fields, depth, onAddCondition, onAddGroup, onRemove, onPatch, onToggleCombinator,
}: {
  group: Group;
  fields: FieldDef<Row>[];
  depth: number;
} & FilterTreeActions) {
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

function ConditionRow<Row>({
  condition, fields, onPatch, onRemove,
}: {
  condition: Condition;
  fields: FieldDef<Row>[];
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
