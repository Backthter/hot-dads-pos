import { useCallback, useState } from 'react';
import { restoreAction, useHistory } from '../lib/history';
import { isSystemCategory } from '../lib/menu';
import { useToast } from '../ui';
import type { StateCore } from './core';
import type { Category, MenuItem, MenuItemStockAssignment } from '../types';

/**
 * What is for sale, and what each thing is made of.
 *
 * Recipes live here rather than with the stock they consume, because an
 * assignment is a fact about a menu item — it changes when the menu changes,
 * not when the shelf does. `useStock` reads them and is handed the setter for
 * the one case that has to reach across: deleting a stock item takes its recipe
 * links with it, or the menu items that used it stay silently uncosted.
 */

export interface MenuInitialState {
  menuItems: MenuItem[];
  categories: Category[];
  /** The tab Order Mode opens on. */
  selectedCategory: string;
}

export function useMenu(core: StateCore, initial: MenuInitialState) {
  const { snapshot, saveImmediate } = core;
  const history = useHistory();
  const toast = useToast();

  const [menuItems, setMenuItems] = useState<MenuItem[]>(initial.menuItems);
  const [categories, setCategories] = useState<Category[]>(initial.categories);
  const [stockAssignments, setStockAssignments] = useState<MenuItemStockAssignment[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>(initial.selectedCategory);

  /* ------------------------------------------------------------ menu items */

  const addMenuItem = useCallback(async (name: string, price: number, category: string) => {
    if (!name.trim() || !(price > 0)) return;
    const before = snapshot.current.menuItems;
    const newItem: MenuItem = {
      id: String(Date.now()),
      name: name.trim(),
      price,
      showInOrderMode: true,
      category,
    };
    const next = [...before, newItem];
    setMenuItems(next);
    history.record(restoreAction(`Added ${newItem.name} to the menu`, 'menu', before, next, setMenuItems));
    await saveImmediate({ menuItems: next });
  }, [snapshot, saveImmediate, history]);

  const updateMenuItem = useCallback((id: string, patch: Partial<MenuItem>) => {
    const before = snapshot.current.menuItems;
    const target = before.find(mi => mi.id === id);
    /**
     * A deal's price is no longer recalculated whenever its contents change.
     *
     * It used to be, which meant a deal could not be priced at all: typing a
     * price and then adjusting what was in the deal silently overwrote it with
     * the sum of the components — which is the one price a deal is never sold
     * at. The components total is still offered, as a button, so the common
     * case stays one tap.
     */
    const next = before.map(mi => (mi.id === id ? { ...mi, ...patch } : mi));
    setMenuItems(next);
    history.record(restoreAction(
      `Edited ${target?.name ?? 'a menu item'}`,
      'menu', before, next, setMenuItems, undefined,
      // A run of keystrokes in one field is one step, not one per letter.
      `menu:${id}:${Object.keys(patch).join(',')}`,
    ));
  }, [snapshot, history]);

  const deleteMenuItem = useCallback(async (id: string) => {
    const before = snapshot.current.menuItems;
    const target = before.find(mi => mi.id === id);
    const next = before.filter(mi => mi.id !== id);
    setMenuItems(next);
    history.record(restoreAction(
      `Removed ${target?.name ?? 'an item'} from the menu`, 'menu', before, next, setMenuItems,
    ));
    await saveImmediate({ menuItems: next });
  }, [snapshot, saveImmediate, history]);

  /* ------------------------------------------------------------ categories */

  const addCategory = useCallback(async (name: string) => {
    if (!name.trim()) return;
    const before = snapshot.current.categories;
    const newCategory: Category = {
      id: `cat-${Date.now()}`,
      name: name.trim(),
      order: before.length,
    };
    const next = [...before, newCategory];
    setCategories(next);
    history.record(restoreAction(`Added the ${newCategory.name} category`, 'menu', before, next, setCategories));
    await saveImmediate({ categories: next });
  }, [snapshot, saveImmediate, history]);

  const updateCategory = useCallback((id: string, patch: Partial<Category>) => {
    const beforeCategories = snapshot.current.categories;
    const beforeItems = snapshot.current.menuItems;
    const oldCategory = beforeCategories.find(c => c.id === id);
    if (!oldCategory) return;

    // Renaming a category renames it on every item that belongs to it, so the
    // two can never fall out of step.
    const renaming = Boolean(patch.name && patch.name !== oldCategory.name);
    const afterItems = renaming
      ? beforeItems.map(item => (item.category === oldCategory.name ? { ...item, category: patch.name! } : item))
      : beforeItems;
    const afterCategories = beforeCategories.map(cat => (cat.id === id ? { ...cat, ...patch } : cat));

    if (renaming) {
      setMenuItems(afterItems);
      if (selectedCategory === oldCategory.name) setSelectedCategory(patch.name!);
    }
    setCategories(afterCategories);

    history.record({
      label: `Renamed a category`,
      scope: 'menu',
      coalesceKey: `category:${id}:${Object.keys(patch).join(',')}`,
      undo: () => { setCategories(beforeCategories); setMenuItems(beforeItems); },
      redo: () => { setCategories(afterCategories); setMenuItems(afterItems); },
    });
  }, [snapshot, history, selectedCategory]);

  const deleteCategory = useCallback(async (id: string) => {
    if (categories.length <= 1) return; // Keep at least one category

    const beforeCategories = snapshot.current.categories;
    const beforeItems = snapshot.current.menuItems;
    const category = beforeCategories.find(c => c.id === id);
    if (!category) return;

    // Deals is structural. Removing it took the deal editor with it and left no
    // route back to the feature, so it is renameable and nothing more.
    if (isSystemCategory(category)) {
      toast.show(`${category.name} cannot be removed`, {
        kind: 'warning',
        detail: 'The program builds deals from this category. You can rename it to whatever you call them.',
      });
      return;
    }

    // Items in a deleted category move to the first remaining one rather than
    // being deleted with it. Losing a menu item to a tidy-up would also lose
    // whatever it is linked to in stock.
    const remainingCategories = beforeCategories.filter(c => c.id !== id);
    const targetCategory = remainingCategories[0].name;
    const updatedMenuItems = beforeItems.map(item =>
      item.category === category.name ? { ...item, category: targetCategory } : item
    );
    setMenuItems(updatedMenuItems);
    setCategories(remainingCategories);

    if (selectedCategory === category.name) setSelectedCategory(targetCategory);

    history.record({
      label: `Removed the ${category.name} category`,
      scope: 'menu',
      undo: () => { setCategories(beforeCategories); setMenuItems(beforeItems); },
      redo: () => { setCategories(remainingCategories); setMenuItems(updatedMenuItems); },
    });

    await saveImmediate({ menuItems: updatedMenuItems, categories: remainingCategories });
  }, [snapshot, saveImmediate, history, toast, categories, selectedCategory]);

  const reorderCategory = useCallback((draggedId: string, targetId: string) => {
    const before = snapshot.current.categories;
    const sorted = [...before].sort((a, b) => a.order - b.order);
    const idx = sorted.findIndex(c => c.id === draggedId);
    const targetIdx = sorted.findIndex(c => c.id === targetId);
    if (idx === -1 || targetIdx === -1) return;
    const [removed] = sorted.splice(idx, 1);
    sorted.splice(targetIdx, 0, removed);
    const next = sorted.map((c, i) => ({ ...c, order: i }));
    setCategories(next);
    history.record(restoreAction('Reordered the categories', 'menu', before, next, setCategories));
  }, [snapshot, history]);

  /* ----------------------------------------------------------- assignments */

  /** Replaces every assignment for one menu item in a single step. */
  const saveAssignments = useCallback(async (
    menuItemId: string, rows: { stockItemId: string; quantityPerItem: number }[],
  ) => {
    const before = snapshot.current.stockAssignments;
    const menuItem = snapshot.current.menuItems.find(m => m.id === menuItemId);
    const next = [
      ...before.filter(a => a.menuItemId !== menuItemId),
      ...rows.map(r => ({ menuItemId, ...r })),
    ];
    setStockAssignments(next);
    history.record(restoreAction(
      `Changed what ${menuItem?.name ?? 'a menu item'} uses`,
      'stock', before, next, setStockAssignments,
    ));
    await saveImmediate({ stockAssignments: next });
  }, [snapshot, saveImmediate, history]);

  const addAssignment = useCallback(async (assignment: MenuItemStockAssignment) => {
    const existing = snapshot.current.stockAssignments.find(
      a => a.menuItemId === assignment.menuItemId && a.stockItemId === assignment.stockItemId
    );
    const newAssignments = existing
      ? snapshot.current.stockAssignments.map(a =>
          a.menuItemId === assignment.menuItemId && a.stockItemId === assignment.stockItemId
            ? { ...a, quantityPerItem: assignment.quantityPerItem }
            : a
        )
      : [...snapshot.current.stockAssignments, assignment];
    setStockAssignments(newAssignments);
    await saveImmediate({ stockAssignments: newAssignments });
  }, [snapshot, saveImmediate]);

  const removeAssignment = useCallback(async (menuItemId: string, stockItemId: string) => {
    setStockAssignments(prev => prev.filter(
      a => !(a.menuItemId === menuItemId && a.stockItemId === stockItemId)
    ));
    await saveImmediate({
      stockAssignments: snapshot.current.stockAssignments.filter(
        a => !(a.menuItemId === menuItemId && a.stockItemId === stockItemId)
      ),
    });
  }, [snapshot, saveImmediate]);

  /* ---------------------------------------------------------- bulk changes */

  const hydrate = useCallback((next: {
    menuItems: MenuItem[];
    categories: Category[];
    stockAssignments: MenuItemStockAssignment[];
  }) => {
    setMenuItems(next.menuItems);
    setCategories(next.categories);
    setStockAssignments(next.stockAssignments);
  }, []);

  /** After a full wipe. The menu survives a history-only wipe untouched. */
  const clear = useCallback(() => {
    setMenuItems([]);
    setCategories([]);
    setStockAssignments([]);
  }, []);

  return {
    state: { menuItems, categories, stockAssignments, selectedCategory },
    actions: {
      hydrate,
      clear,
      setSelectedCategory,
      setStockAssignments,
      addMenuItem,
      updateMenuItem,
      deleteMenuItem,
      addCategory,
      updateCategory,
      deleteCategory,
      reorderCategory,
      saveAssignments,
      addAssignment,
      removeAssignment,
    },
  };
}

export type MenuHandle = ReturnType<typeof useMenu>;
