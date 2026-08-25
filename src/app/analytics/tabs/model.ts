/**
 * The analytics tab set, as data rather than as a switch statement.
 *
 * Four tabs, each of which is a question a shop actually asks:
 *
 *   Finance    Did this pay?
 *   Inventory  What do I have, and what is it doing?
 *   Business   What's working?
 *   History    What happened?
 *
 * This file is deliberately pure — no React, no icons, no JSX — so that
 * `metrics.check.ts` can run the two things on it that are worth checking: the
 * lock capability and the id migration. The icons are attached where the tab
 * bar is drawn, in `AnalyticsView`, because an icon is a rendering decision and
 * importing one here would put a component library between this file and `tsx`.
 */

export type TabId = 'finance' | 'inventory' | 'business' | 'history';

/** What History is a history *of*. Stock is the last one still empty. */
export type HistorySource = 'orders' | 'stock' | 'money';

/**
 * How much of a tab the revenue PIN hides.
 *
 * The lock used to be one condition stated at the point of rendering —
 * `revenueLocked && tab !== 'orders'` — which worked while there were four tabs
 * and exactly one of them was open. With four tabs, a source selector and a
 * tab that is *partly* money, the rule has to be declared by the thing it
 * applies to and resolved in one place, or every new screen re-derives it and
 * one of them eventually gets it wrong.
 *
 * - `all`           the tab is replaced by the lock screen.
 * - `money-columns` the tab is drawn, with the money on it withheld. This is
 *                   the case the split exists for: a cashier checking whether
 *                   the mince is running low should not need the revenue PIN
 *                   to see a quantity.
 * - `none`          the tab is unaffected.
 *
 * V2's roles want exactly this shape — "may see stock levels, may not see what
 * stock cost" is the same statement — so it is worth being a capability now
 * rather than an `if` that has to be found again later.
 */
export type TabLock = 'all' | 'money-columns' | 'none';

export const DEFAULT_TAB: TabId = 'finance';
export const DEFAULT_HISTORY_SOURCE: HistorySource = 'orders';

export interface TabDefinition {
  id: TabId;
  label: string;
  /** The question the tab answers, shown as its hover text. */
  hint: string;
  /**
   * The lock this tab declares. For History it is `none`, because History's
   * answer depends on which source is selected — see `HISTORY_SOURCES`.
   */
  locked: TabLock;
}

export const TABS: readonly TabDefinition[] = [
  {
    id: 'finance',
    label: 'Finance',
    hint: 'Did this pay? What you took, what it cost, and what was left.',
    locked: 'all',
  },
  {
    id: 'inventory',
    label: 'Inventory',
    hint: 'What do I have, and what is it doing?',
    locked: 'money-columns',
  },
  {
    id: 'business',
    label: 'Business',
    hint: "What's working? What sold, when, and what people bought together.",
    locked: 'all',
  },
  {
    id: 'history',
    label: 'History',
    hint: 'What happened? Every order, stock movement and cost you have recorded.',
    locked: 'none',
  },
];

export const TAB_LABEL: Record<TabId, string> = {
  finance: 'Finance',
  inventory: 'Inventory',
  business: 'Business',
  history: 'History',
};

export interface HistorySourceDefinition {
  id: HistorySource;
  label: string;
  locked: TabLock;
  /**
   * Set while the source has nothing to show, naming the phase that fills it.
   *
   * The selector is shown with the empty sources on it rather than hidden
   * until they work: a control that grows options later is a control nobody
   * knows to look for, and "Stock is not here yet" is a more useful thing to
   * read than a selector that appears to have one option by design.
   */
  arriving?: string;
}

export const HISTORY_SOURCES: readonly HistorySourceDefinition[] = [
  { id: 'orders', label: 'Orders', locked: 'none' },
  // Quantities, not money. A stock history is the one place a locked till
  // still needs a straight answer.
  //
  // This named the wrong phase until 1C-iii-a. `PHASE-1C.md` resequenced the
  // work when 1C-ii was inserted — Money moved to 1C-iii and Stock to 1C-iv —
  // and neither string followed, so the program was telling the shop to expect
  // a screen in a phase that had already been and gone. Whoever moves a phase
  // moves the strings that name it; 1C-iii-b cleared Money's by filling it.
  { id: 'stock', label: 'Stock', locked: 'none', arriving: '1C-iv' },
  // Closed entirely with the PIN set: every row on it is money, and unlike
  // Inventory there is no quantity underneath to leave visible.
  { id: 'money', label: 'Money', locked: 'all' },
];

/**
 * The lock in force, given where the reader is.
 *
 * History is the only tab whose answer depends on more than its id, and it
 * delegates rather than deciding: the source declares its own lock the same way
 * a tab does.
 */
export function lockFor(tab: TabId, source: HistorySource = DEFAULT_HISTORY_SOURCE): TabLock {
  // Read off the same definitions the selector and the tab bar are built from.
  // A second table here would be a second thing to keep in step, and the one
  // that fell behind would fall behind in the direction that shows money.
  if (tab === 'history') {
    return HISTORY_SOURCES.find(s => s.id === source)?.locked ?? 'all';
  }
  return TABS.find(t => t.id === tab)?.locked ?? 'all';
}

/** What a declared lock means once it is known whether the PIN is set. */
export interface LockState {
  /** The whole tab is replaced by the lock screen. */
  hidden: boolean;
  /** The tab draws, but every money figure on it is withheld. */
  moneyHidden: boolean;
}

/**
 * The one place a `TabLock` becomes a rendering decision.
 *
 * Every tab reads its answer from here. Nothing else in the analytics layer
 * looks at `revenueLocked` and decides for itself, which is the whole point of
 * the capability: adding a tab is declaring a value, not remembering a rule.
 */
export function resolveLock(locked: TabLock, revenueLocked: boolean): LockState {
  if (!revenueLocked) return { hidden: false, moneyHidden: false };
  return {
    hidden: locked === 'all',
    moneyHidden: locked === 'money-columns',
  };
}

/**
 * Where a tab id from before this phase now lives.
 *
 * The sticky tab is remembered by id, so a shop that left the screen on Sales
 * would come back to a tab that no longer exists. Falling back to the default
 * would be correct and would also silently throw away where they were, which
 * is the one thing sticky state exists to prevent — so an old id resolves to
 * the tab that absorbed it.
 *
 * Costs is the interesting entry. It is no longer a destination at all: logging
 * a cost is something you do *because* of what Finance shows, so somebody who
 * left the app on Costs is put on Finance rather than on a page.
 */
export const LEGACY_TAB: Readonly<Record<string, TabId>> = {
  overview: 'finance',
  costs: 'finance',
  sales: 'business',
  orders: 'history',
};

const IS_TAB = new Set<string>(TABS.map(t => t.id));

/**
 * A stored tab id, read as one of the four that exist.
 *
 * Pure on purpose. It is the only part of the tab bar `metrics.check.ts` can
 * see, and a migration nothing checks is a migration that quietly stops being
 * applied the next time somebody renames a tab.
 */
export function migrateTabId(stored: string): TabId {
  if (IS_TAB.has(stored)) return stored as TabId;
  return LEGACY_TAB[stored] ?? DEFAULT_TAB;
}
