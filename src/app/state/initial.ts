import type { Category, MenuItem } from '../types';
import type { DataSnapshot } from './core';

/**
 * What a shop that has never been set up starts with.
 *
 * Written to disk once, on the first launch, and never consulted again — the
 * moment `app_state.db_version` exists, the database is the truth. It is a
 * plausible burger stall rather than an empty menu because an empty till gives
 * a new user nothing to press, and every one of these is renameable.
 */

export const INITIAL_CATEGORIES: Category[] = [
  { id: 'cat-1', name: 'Food', order: 0 },
  { id: 'cat-2', name: 'Drinks', order: 1 },
  // Structural: the deal editor is offered for whatever category carries this
  // flag. It can be renamed; it cannot be removed. See ADR-007.
  { id: 'cat-deals', name: 'Deals', order: 2, system: 'deals' },
];

export const INITIAL_MENU_ITEMS: MenuItem[] = [
  { id: '1', name: 'Burger', price: 500, showInOrderMode: true, category: 'Food' },
  { id: '2', name: 'Chicken', price: 600, showInOrderMode: true, category: 'Food' },
  { id: '3', name: 'Beef', price: 700, showInOrderMode: true, category: 'Food' },
  {
    id: '4',
    name: 'Deal 1',
    price: 1200,
    showInOrderMode: true,
    category: 'Deals',
    dealItems: [
      { name: 'Beef', quantity: 2 },
      { name: 'Coke', quantity: 2 }
    ]
  },
  { id: '5', name: 'Water', price: 50, showInOrderMode: true, category: 'Drinks' },
  { id: '6', name: 'Coke', price: 100, showInOrderMode: true, category: 'Drinks' },
  { id: '7', name: 'Sprite', price: 100, showInOrderMode: true, category: 'Drinks' },
  { id: '8', name: 'Custom', price: 150, showInOrderMode: true, category: 'Food' },
];

/** The tab Order Mode opens on before anyone has chosen otherwise. */
export const INITIAL_CATEGORY = 'Food';

/** What the snapshot ref holds before anything has been loaded. */
export const INITIAL_SNAPSHOT: DataSnapshot = {
  menuItems: INITIAL_MENU_ITEMS,
  categories: INITIAL_CATEGORIES,
  orders: [],
  parkedSessions: [],
  stockItems: [],
  stockAssignments: [],
  stockMovements: [],
  inventorySnapshots: [],
  oversellEvents: [],
  orderCounter: 1,
  tradingSessions: [],
  tradingEvents: [],
  costEntries: [],
};
