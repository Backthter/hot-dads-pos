import {
  Apple, Banana, Beef, Beer, Bean, CakeSlice, Candy, Carrot, Cherry, Citrus, Coffee, Cookie,
  Croissant, CupSoda, Donut, Drumstick, Egg, Fish, GlassWater, Grape, Ham, IceCreamCone,
  LeafyGreen, Martini, Milk, Nut, Package, Pizza, Popcorn, Salad, Sandwich, Soup, Utensils,
  Wheat, Wine, Droplet, Snowflake, Boxes,
} from 'lucide-react';

export interface StockIconProps {
  size?: number;
  color?: string;
  strokeWidth?: number;
}

type IconComponent = (props: StockIconProps) => JSX.Element;

/** A few glyphs the icon set does not carry, drawn to match its weight. */
const Taco: IconComponent = ({ size = 24, color = 'currentColor', strokeWidth = 2 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color}
    strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 18c0-6.1 4.5-11 10-11s10 4.9 10 11z" />
    <path d="M6 18c1.4-2 3-3.2 4.6-3.4M13 14.8c1.7.4 3.2 1.6 4.4 3.2" />
  </svg>
);

const Bun: IconComponent = ({ size = 24, color = 'currentColor', strokeWidth = 2 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color}
    strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 14a9 6 0 0 1 18 0z" />
    <path d="M3 17.5h18" />
    <path d="M8.5 11.2h.01M12 10.4h.01M15.5 11.2h.01" />
  </svg>
);

const CheeseSlice: IconComponent = ({ size = 24, color = 'currentColor', strokeWidth = 2 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color}
    strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 19 20 5v14z" />
    <circle cx="14" cy="14" r="1.3" />
    <circle cx="9.5" cy="16.5" r="1" />
  </svg>
);

const Patty: IconComponent = ({ size = 24, color = 'currentColor', strokeWidth = 2 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color}
    strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
    <ellipse cx="12" cy="12" rx="9" ry="5.2" />
    <path d="M6.5 10.6c1.2.8 2.6 1.2 4 1.2M13.6 13.6c1.3 0 2.6-.3 3.7-.9" />
  </svg>
);

const SauceBottle: IconComponent = ({ size = 24, color = 'currentColor', strokeWidth = 2 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color}
    strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 2h4v3l2 3v11a3 3 0 0 1-3 3h-2a3 3 0 0 1-3-3V8l2-3z" />
    <path d="M8 13h8" />
  </svg>
);

const Fries: IconComponent = ({ size = 24, color = 'currentColor', strokeWidth = 2 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color}
    strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 10h12l-1.4 9.2a2 2 0 0 1-2 1.8H9.4a2 2 0 0 1-2-1.8z" />
    <path d="M9 10V4.5M12 10V3M15 10V5.5" />
  </svg>
);

const wrap = (Component: typeof Beef): IconComponent =>
  ({ size = 24, color = 'currentColor', strokeWidth = 2 }) =>
    <Component size={size} color={color} strokeWidth={strokeWidth} />;

export interface StockIconDef {
  id: string;
  label: string;
  /** Extra words matched when searching or auto-picking from an item name. */
  keywords: string[];
  render: IconComponent;
}

/**
 * The icon library. Grouped roughly by kitchen section so the picker reads in a
 * sensible order rather than alphabetically.
 */
export const STOCK_ICONS: StockIconDef[] = [
  { id: 'bun', label: 'Bun', keywords: ['bun', 'buns', 'bread', 'roll', 'brioche'], render: Bun },
  { id: 'patty', label: 'Patty', keywords: ['patty', 'burger', 'mince'], render: Patty },
  { id: 'beef', label: 'Beef', keywords: ['beef', 'steak', 'meat', 'ground beef'], render: wrap(Beef) },
  { id: 'chicken', label: 'Chicken', keywords: ['chicken', 'drumstick', 'wing', 'poultry'], render: wrap(Drumstick) },
  { id: 'ham', label: 'Ham', keywords: ['ham', 'bacon', 'pork'], render: wrap(Ham) },
  { id: 'fish', label: 'Fish', keywords: ['fish', 'seafood', 'prawn'], render: wrap(Fish) },
  { id: 'egg', label: 'Egg', keywords: ['egg', 'eggs'], render: wrap(Egg) },
  { id: 'cheese', label: 'Cheese', keywords: ['cheese', 'cheddar', 'slice'], render: CheeseSlice },
  { id: 'taco', label: 'Taco shell', keywords: ['taco', 'shell', 'tortilla', 'wrap'], render: Taco },
  { id: 'sandwich', label: 'Sandwich', keywords: ['sandwich', 'sub', 'burger'], render: wrap(Sandwich) },
  { id: 'pizza', label: 'Pizza', keywords: ['pizza', 'dough', 'base'], render: wrap(Pizza) },
  { id: 'fries', label: 'Fries', keywords: ['fries', 'chips', 'potato'], render: Fries },
  { id: 'veg', label: 'Veg', keywords: ['veg', 'veggies', 'lettuce', 'salad', 'greens', 'onion', 'onions', 'tomato'], render: wrap(LeafyGreen) },
  { id: 'salad', label: 'Salad', keywords: ['salad', 'bowl', 'mixed'], render: wrap(Salad) },
  { id: 'carrot', label: 'Carrot', keywords: ['carrot', 'root'], render: wrap(Carrot) },
  { id: 'bean', label: 'Beans', keywords: ['bean', 'beans', 'legume'], render: wrap(Bean) },
  { id: 'citrus', label: 'Citrus', keywords: ['lemon', 'lime', 'citrus', 'orange'], render: wrap(Citrus) },
  { id: 'apple', label: 'Apple', keywords: ['apple', 'fruit'], render: wrap(Apple) },
  { id: 'banana', label: 'Banana', keywords: ['banana'], render: wrap(Banana) },
  { id: 'grape', label: 'Grapes', keywords: ['grape', 'grapes'], render: wrap(Grape) },
  { id: 'cherry', label: 'Cherry', keywords: ['cherry', 'berries'], render: wrap(Cherry) },
  { id: 'sauce', label: 'Sauce', keywords: ['sauce', 'ketchup', 'mayo', 'mustard', 'dressing'], render: SauceBottle },
  { id: 'oil', label: 'Oil', keywords: ['oil', 'liquid', 'vinegar'], render: wrap(Droplet) },
  { id: 'soup', label: 'Soup', keywords: ['soup', 'stock', 'broth', 'gravy'], render: wrap(Soup) },
  { id: 'wheat', label: 'Flour', keywords: ['flour', 'wheat', 'grain', 'dough'], render: wrap(Wheat) },
  { id: 'nut', label: 'Nuts', keywords: ['nut', 'nuts', 'peanut'], render: wrap(Nut) },
  { id: 'soda', label: 'Soft drink', keywords: ['coke', 'soda', 'cola', 'sprite', 'fizzy', 'drink'], render: wrap(CupSoda) },
  { id: 'water', label: 'Water', keywords: ['water', 'bottle', 'still'], render: wrap(GlassWater) },
  { id: 'milk', label: 'Milk', keywords: ['milk', 'dairy', 'cream'], render: wrap(Milk) },
  { id: 'coffee', label: 'Coffee', keywords: ['coffee', 'tea', 'hot'], render: wrap(Coffee) },
  { id: 'beer', label: 'Beer', keywords: ['beer', 'ale'], render: wrap(Beer) },
  { id: 'wine', label: 'Wine', keywords: ['wine'], render: wrap(Wine) },
  { id: 'cocktail', label: 'Cocktail', keywords: ['cocktail', 'spirit', 'mixer'], render: wrap(Martini) },
  { id: 'ice', label: 'Ice', keywords: ['ice', 'frozen'], render: wrap(Snowflake) },
  { id: 'cookie', label: 'Cookie', keywords: ['cookie', 'biscuit'], render: wrap(Cookie) },
  { id: 'cake', label: 'Cake', keywords: ['cake', 'dessert'], render: wrap(CakeSlice) },
  { id: 'donut', label: 'Donut', keywords: ['donut', 'doughnut'], render: wrap(Donut) },
  { id: 'icecream', label: 'Ice cream', keywords: ['ice cream', 'gelato'], render: wrap(IceCreamCone) },
  { id: 'candy', label: 'Sweets', keywords: ['candy', 'sweet', 'sugar'], render: wrap(Candy) },
  { id: 'popcorn', label: 'Popcorn', keywords: ['popcorn', 'snack'], render: wrap(Popcorn) },
  { id: 'croissant', label: 'Pastry', keywords: ['croissant', 'pastry', 'bakery'], render: wrap(Croissant) },
  { id: 'utensils', label: 'Cutlery', keywords: ['cutlery', 'fork', 'spoon', 'utensil'], render: wrap(Utensils) },
  { id: 'packaging', label: 'Packaging', keywords: ['box', 'bag', 'carton', 'packaging', 'container', 'cup', 'napkin'], render: wrap(Boxes) },
  { id: 'other', label: 'Other', keywords: ['other', 'misc', 'general'], render: wrap(Package) },
];

const BY_ID = new Map(STOCK_ICONS.map(i => [i.id, i]));

export function getStockIcon(id?: string): StockIconDef {
  return (id ? BY_ID.get(id) : undefined) ?? BY_ID.get('other')!;
}

/** Best guess from an item's name, used when creating an item. */
export function suggestIconId(name: string): string {
  const q = name.trim().toLowerCase();
  if (!q) return 'other';
  for (const icon of STOCK_ICONS) {
    if (icon.keywords.some(k => q === k)) return icon.id;
  }
  for (const icon of STOCK_ICONS) {
    if (icon.keywords.some(k => q.includes(k))) return icon.id;
  }
  return 'other';
}

export function searchIcons(query: string): StockIconDef[] {
  const q = query.trim().toLowerCase();
  if (!q) return STOCK_ICONS;
  return STOCK_ICONS.filter(
    i => i.label.toLowerCase().includes(q) || i.keywords.some(k => k.includes(q)),
  );
}

/** Renders an item's icon by id. */
export function StockIcon({ id, size = 24, color, strokeWidth = 2 }: { id?: string } & StockIconProps) {
  const def = getStockIcon(id);
  return <def.render size={size} color={color} strokeWidth={strokeWidth} />;
}
