import type { Category, MenuItem } from '../types';

/**
 * The menu's structural rules, in one place.
 *
 * Deals used to be identified by a category *called* "Deals". That made a
 * feature of the program depend on a piece of text anybody could edit: rename
 * the category and the deal editor vanished, delete it and there was no way
 * back to deals at all, because the only thing that offered the editor was a
 * category with that name and creating one was not an obvious thing to try.
 */

export const DEALS_CATEGORY_ID = 'cat-deals';

/**
 * Guarantees exactly one deals category exists, without disturbing anything
 * the user has set up.
 *
 * Run on load. It adopts an existing category rather than adding a second one
 * where possible — first whichever is already flagged, then whichever holds
 * items that are actually deals, then one named after them. Only when none of
 * those exist does it create one, so an established menu is never given a
 * duplicate.
 */
export function ensureSystemCategories(
  categories: Category[],
  menuItems: MenuItem[],
): Category[] {
  if (categories.some(c => c.system === 'deals')) return categories;

  const dealItemCategories = new Set(
    menuItems.filter(m => m.dealItems && m.dealItems.length > 0).map(m => m.category),
  );

  const adopt =
    categories.find(c => dealItemCategories.has(c.name))
    ?? categories.find(c => c.name.trim().toLowerCase().startsWith('deal'));

  if (adopt) {
    return categories.map(c => (c.id === adopt.id ? { ...c, system: 'deals' as const } : c));
  }

  return [
    ...categories,
    {
      id: DEALS_CATEGORY_ID,
      name: 'Deals',
      order: categories.length,
      system: 'deals' as const,
    },
  ];
}

/** The category deals live in. Present after `ensureSystemCategories`. */
export function dealsCategory(categories: Category[]): Category | undefined {
  return categories.find(c => c.system === 'deals');
}

/**
 * Whether this item should be edited as a deal.
 *
 * Being in the deals category is the usual reason, but an item that already has
 * contents counts wherever it sits — otherwise moving a deal to another
 * category would quietly make its contents uneditable while still charging for
 * them.
 */
export function isDealItem(item: MenuItem, categories: Category[]): boolean {
  if (item.dealItems && item.dealItems.length > 0) return true;
  const deals = dealsCategory(categories);
  return Boolean(deals && item.category === deals.name);
}

/** A category the program depends on, which may be renamed but not removed. */
export function isSystemCategory(category: Category): boolean {
  return category.system !== undefined;
}

/** What the components of a deal add up to at their own menu prices. */
export function componentsTotal(item: MenuItem, menuItems: MenuItem[]): number {
  if (!item.dealItems?.length) return 0;
  return item.dealItems.reduce((sum, line) => {
    const match = line.menuItemId
      ? menuItems.find(m => m.id === line.menuItemId) ?? menuItems.find(m => m.name === line.name)
      : menuItems.find(m => m.name === line.name);
    return sum + (match ? match.price * line.quantity : 0);
  }, 0);
}
