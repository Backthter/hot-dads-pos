/**
 * The single source of colour, shape and depth for the whole app.
 *
 * Before this file the program carried three parallel palettes — one inline in
 * App.tsx, one in `inventory/InventoryUI.tsx`, one in `analytics/AnalyticsUI.tsx`
 * — which is why Analytics was drawn in amber while its own section colour was
 * purple. Anything that needs a colour now asks here, and a screen that wants to
 * look like its section asks for nothing at all: it inherits.
 */

/* ------------------------------------------------------------------ helpers */

/** `#rrggbb` plus an alpha, as `rgba()`. Kept out of CSS `color-mix` so the
 *  values are computed once here rather than resolved per paint. */
export function alpha(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const n = parseInt(full, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/** Moves a colour towards white (`amount > 0`) or black (`amount < 0`). */
export function shade(hex: string, amount: number): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const n = parseInt(full, 16);
  const mix = (channel: number) => {
    const target = amount > 0 ? 255 : 0;
    const t = Math.abs(amount);
    return Math.round(channel + (target - channel) * t);
  };
  const r = mix((n >> 16) & 255);
  const g = mix((n >> 8) & 255);
  const b = mix(n & 255);
  return `#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')}`;
}

/** Black or white, whichever stays legible on top of `hex`. */
export function readableOn(hex: string): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const n = parseInt(full, 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(c => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.42 ? '#0B0B0F' : '#FFFFFF';
}

/* ----------------------------------------------------------------- sections */

export type SectionId = 'home' | 'order' | 'orders' | 'analytics' | 'inventory' | 'settings';

/**
 * Every section owns a colour, and everything inside it — tabs, focus rings,
 * chart bars, hover gradients, drop shadows — is derived from that one value.
 *
 * The colours are the ones from the home sketch, so the tile you press and the
 * screen it opens are recognisably the same place.
 */
export const SECTION_COLOR: Record<SectionId, string> = {
  home: '#FE9A00',
  order: '#14A89B',
  orders: '#3F6FC4',
  analytics: '#8B5CD6',
  inventory: '#E87722',
  // Lighter than the sketch's near-black grey: an active tab or a chosen
  // segment has to read as chosen, and at #5A5A66 the lit state was almost
  // indistinguishable from the resting one.
  settings: '#7C7C8C',
};

export const SECTION_LABEL: Record<SectionId, string> = {
  home: 'Home',
  order: 'Order Mode',
  orders: 'All Orders',
  analytics: 'Analytics',
  inventory: 'Inventory',
  settings: 'Settings',
};

/**
 * The one colour that never changes with the section.
 *
 * A section tints its own chrome, but the button that takes the money, saves the
 * form or confirms the thing is this amber everywhere. Somebody working the
 * counter should never have to work out which button is the one that commits.
 */
export const PRIMARY = '#FE9A00';
export const ON_PRIMARY = '#1B1206';

/* ---------------------------------------------------------------- semantics */

/** Meanings, not decoration. These are identical in every section. */
export const DANGER = '#F9624E';
export const WARNING = '#F79634';
export const SUCCESS = '#63D07F';
export const INFO = '#76DFDA';
export const MUTED = '#A1A1AA';

/** The kitchen's colour language. Deliberately frozen — staff learn these. */
export const STATUS_COLOR = {
  preparing: '#F9624E',
  grill: '#F79634',
  ready: '#76DFDA',
  completed: '#22C55E',
  parked: '#A1A1AA',
  editing: '#A855F7',
} as const;

/** Chart series, ordered so the first four stay apart at a glance. */
export const SERIES = ['#8B5CD6', '#76DFDA', '#FE9A00', '#63D07F', '#F9624E', '#8AB4F8', '#E87722', '#3F6FC4'];

/* -------------------------------------------------------------------- shape */

export const RADIUS = {
  sm: 8,
  md: 11,
  lg: 14,
  xl: 18,
  pill: 999,
} as const;

/** Hit targets. The counter screen is used with a finger as often as a mouse,
 *  so nothing interactive is allowed below `control`. */
export const SIZE = {
  control: 46,
  controlSm: 36,
  controlLg: 56,
} as const;

/* -------------------------------------------------------------------- depth */

export const ELEVATION = {
  none: 'none',
  /** A panel resting on the page. */
  low: '0 1px 2px rgba(0,0,0,0.28), 0 4px 12px -6px rgba(0,0,0,0.45)',
  /** A menu or popover floating above it. */
  mid: '0 4px 10px rgba(0,0,0,0.32), 0 16px 34px -12px rgba(0,0,0,0.6)',
  /** A dialog that owns the screen. */
  high: '0 8px 20px rgba(0,0,0,0.4), 0 32px 64px -20px rgba(0,0,0,0.7)',
} as const;

/**
 * Glass is used sparingly and only on layers that genuinely float — dialogs,
 * popovers, the ticket action overlay. A blur behind every panel costs real
 * frames on the low-powered machines this runs on, and buys nothing: a panel
 * that never moves has nothing interesting behind it to reveal.
 */
export const GLASS = {
  panel: {
    background: 'linear-gradient(180deg, rgba(255,255,255,0.045) 0%, rgba(255,255,255,0.012) 100%)',
  },
  floating: {
    backdropFilter: 'blur(14px) saturate(1.3)',
    WebkitBackdropFilter: 'blur(14px) saturate(1.3)',
  },
  scrim: {
    background: 'rgba(6,6,9,0.55)',
    backdropFilter: 'blur(6px)',
    WebkitBackdropFilter: 'blur(6px)',
  },
} as const;

/* ------------------------------------------------------- derived section set */

export interface SectionPalette {
  id: SectionId;
  label: string;
  /** The section's colour at full strength. Text, icons, active borders. */
  color: string;
  /** Legible foreground on top of a solid `color` fill. */
  on: string;
  /** A wash for the background of an active tab or a selected row. */
  soft: string;
  /** A slightly stronger wash, for hover on a resting control. */
  softer: string;
  /** Border colour for a resting control that belongs to the section. */
  line: string;
  /** Focus ring / glow. */
  glow: string;
  /** The section's signature gradient, used on hover and on solid fills. */
  gradient: string;
  /** The same gradient at wash strength, for hover on a quiet control. */
  gradientSoft: string;
}

export function sectionTheme(id: SectionId): SectionPalette {
  const color = SECTION_COLOR[id];
  const lift = shade(color, 0.22);
  return {
    id,
    label: SECTION_LABEL[id],
    color,
    on: readableOn(color),
    soft: alpha(color, 0.13),
    softer: alpha(color, 0.22),
    line: alpha(color, 0.42),
    glow: alpha(color, 0.3),
    gradient: `linear-gradient(135deg, ${lift} 0%, ${color} 55%, ${shade(color, -0.14)} 100%)`,
    gradientSoft: `linear-gradient(135deg, ${alpha(lift, 0.24)} 0%, ${alpha(color, 0.1)} 100%)`,
  };
}

/** The CSS custom properties a section wrapper sets, so primitives can simply
 *  read `var(--sec)` and be right wherever they are mounted. */
export function sectionVars(id: SectionId): Record<string, string> {
  const t = sectionTheme(id);
  return {
    '--sec': t.color,
    '--sec-on': t.on,
    '--sec-soft': t.soft,
    '--sec-softer': t.softer,
    '--sec-line': t.line,
    '--sec-glow': t.glow,
    '--sec-gradient': t.gradient,
    '--sec-gradient-soft': t.gradientSoft,
  };
}
