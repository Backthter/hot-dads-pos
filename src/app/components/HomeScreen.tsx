import { memo, useState, type ReactNode } from 'react';
import { motion } from 'motion/react';
import {
  BarChart3, Boxes, LogOut, ReceiptText, Settings as SettingsIcon, ShoppingCart,
} from 'lucide-react';
import type { View } from '../lib/navigation';
import {
  IconButton, SECTION_COLOR, alpha, readableOn, shade, useReducedMotion, type SectionId,
} from '../ui';

/**
 * The main menu: five tiles, sized by how much they are used.
 *
 * Two problems with what was here before, and the second is the one that
 * mattered.
 *
 * The first is that a ring of petals is a shape, not an interface. Every
 * destination was the same size, so the screen you open two hundred times a day
 * looked exactly like the one you open twice a month, and the hit areas were
 * curved slices whose centre of mass was nowhere near where the label was. Here
 * Order is four times the size of anything else because that is four times what
 * it is worth, and every target is a rectangle.
 *
 * The second is that it was slow — a measured median of 50ms per frame while
 * moving the pointer across it, worst frame 217ms, on hardware far faster than
 * a counter-top till. That was not the shape's fault; it was three animated
 * properties that cannot be composited:
 *
 *   · a full-screen `radial-gradient` animated as a *string*, which repaints the
 *     entire window every frame and makes the animation library interpolate
 *     gradient syntax while it does;
 *   · `filter: drop-shadow()` on five large SVG paths, each of which
 *     re-rasterises the whole shape's bounding box per frame;
 *   · `scale` on those same vector paths, which re-rasterises rather than
 *     transforming a finished layer.
 *
 * Nothing in this file animates anything but `opacity` and `transform`. Hover
 * is a pre-painted overlay whose opacity changes — the layer already exists, so
 * lighting it costs a composite and no paint at all. That is the whole
 * technique, and it is why this holds 60fps with room to spare.
 */

interface Tile {
  id: SectionId;
  view: View;
  label: string;
  caption: string;
  icon: ReactNode;
  /** Where it sits in the grid at full width. */
  area: string;
  badge?: string;
  primary?: boolean;
}

export function HomeScreen({
  onNavigate, onLogout, lowStockCount, liveSessionName, openOrderCount,
}: {
  onNavigate: (view: View) => void;
  onLogout: () => void;
  lowStockCount: number;
  liveSessionName: string | null;
  openOrderCount: number;
}) {
  const reduced = useReducedMotion();

  const tiles: Tile[] = [
    {
      id: 'order',
      view: 'orderMode',
      label: 'Order',
      caption: liveSessionName ? `${liveSessionName} · trading` : 'Take an order',
      icon: <ShoppingCart size={64} strokeWidth={1.9} />,
      area: 'order',
      primary: true,
    },
    {
      id: 'orders',
      view: 'allOrders',
      label: 'All Orders',
      caption: openOrderCount > 0 ? `${openOrderCount} on the board` : 'The board',
      icon: <ReceiptText size={34} strokeWidth={2} />,
      area: 'orders',
      badge: openOrderCount > 0 ? String(openOrderCount) : undefined,
    },
    {
      id: 'inventory',
      view: 'inventory',
      label: 'Inventory',
      caption: lowStockCount > 0 ? `${lowStockCount} running low` : 'Stock and recipes',
      icon: <Boxes size={34} strokeWidth={2} />,
      area: 'inventory',
      badge: lowStockCount > 0 ? String(lowStockCount) : undefined,
    },
    {
      id: 'analytics',
      view: 'analytics',
      label: 'Analytics',
      caption: 'Sales and profit',
      icon: <BarChart3 size={34} strokeWidth={2} />,
      area: 'analytics',
    },
    {
      id: 'settings',
      view: 'settings',
      label: 'Settings',
      caption: 'Menu, tax, printer',
      icon: <SettingsIcon size={34} strokeWidth={2} />,
      area: 'settings',
    },
  ];

  return (
    <div className="screen-h screen-w overflow-hidden bg-[var(--app-bg)] text-[var(--app-text)] relative flex flex-col">
      <div className="flex items-center justify-between px-[26px] pt-[22px] pb-[16px] shrink-0">
        <div className="min-w-0">
          <h1 className="text-[var(--app-text)] text-[26px] font-bold leading-[32px]">Hot Dads POS</h1>
          {liveSessionName && (
            <p className="text-[14px] font-semibold mt-[2px]" style={{ color: SECTION_COLOR.order }}>
              {liveSessionName} is trading
            </p>
          )}
        </div>
        <IconButton
          variant="ghost"
          onClick={onLogout}
          aria-label="Log out"
          data-home-logout
          tone="#F9624E"
          icon={<LogOut size={21} />}
        />
      </div>

      <div
        className="flex-1 min-h-0 grid gap-[16px] px-[26px] pb-[26px]"
        data-home-grid
        style={{
          gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
          gridTemplateRows: 'repeat(2, minmax(0, 1fr))',
          gridTemplateAreas: `
            "order order orders inventory"
            "order order analytics settings"
          `,
        }}
      >
        {tiles.map((tile, index) => (
          <HomeTile
            key={tile.id}
            tile={tile}
            index={index}
            reduced={reduced}
            onPress={() => onNavigate(tile.view)}
          />
        ))}
      </div>
    </div>
  );
}

const HomeTile = memo(function HomeTile({
  tile, index, reduced, onPress,
}: {
  tile: Tile;
  index: number;
  reduced: boolean;
  onPress: () => void;
}) {
  const [hover, setHover] = useState(false);
  const colour = SECTION_COLOR[tile.id];
  const ink = readableOn(colour);

  return (
    <motion.button
      type="button"
      onClick={onPress}
      onHoverStart={() => setHover(true)}
      onHoverEnd={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
      data-home-tile={tile.id}
      className="relative overflow-hidden rounded-[20px] flex flex-col justify-between text-left outline-none"
      style={{
        gridArea: tile.area,
        // Painted once. Nothing about the resting state ever animates.
        background: colour,
        color: ink,
        padding: tile.primary ? 30 : 22,
        willChange: 'transform',
      }}
      // Entry and press are transform and opacity only — the two things the
      // compositor can do without asking the main thread to paint anything.
      initial={reduced ? false : { opacity: 0, transform: 'translateY(14px)' }}
      animate={{ opacity: 1, transform: 'translateY(0px)' }}
      transition={reduced ? { duration: 0 } : {
        duration: 0.26,
        ease: [0.22, 1, 0.36, 1],
        delay: index * 0.035,
      }}
      whileTap={reduced ? undefined : { scale: 0.985 }}
    >
      {/*
        The hover treatment, as a layer that is already painted and simply
        fades in. Animating the tile's own `background` would repaint it every
        frame; changing one child's opacity is handled entirely on the
        compositor.
      */}
      <span
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `linear-gradient(135deg, ${alpha('#ffffff', 0.16)} 0%, ${alpha('#ffffff', 0)} 60%)`,
          opacity: hover ? 1 : 0,
          transition: 'opacity 140ms ease',
        }}
      />
      <span
        aria-hidden
        className="absolute inset-0 pointer-events-none rounded-[20px]"
        style={{
          boxShadow: `inset 0 0 0 3px ${alpha(shade(colour, 0.55), 0.9)}`,
          opacity: hover ? 1 : 0,
          transition: 'opacity 140ms ease',
        }}
      />

      <span className="relative flex items-start justify-between w-full">
        <span style={{ opacity: 0.95 }}>{tile.icon}</span>
        {tile.badge && (
          <span
            className="flex items-center justify-center rounded-full font-bold shrink-0"
            style={{
              minWidth: tile.primary ? 44 : 34,
              height: tile.primary ? 44 : 34,
              paddingInline: 10,
              fontSize: tile.primary ? 19 : 15,
              background: 'rgba(0,0,0,0.28)',
              color: ink,
              border: `1px solid ${alpha('#ffffff', 0.24)}`,
            }}
          >
            {tile.badge}
          </span>
        )}
      </span>

      <span className="relative flex flex-col gap-[3px] min-w-0">
        <span
          className="font-bold leading-none truncate"
          style={{ fontSize: tile.primary ? 'clamp(32px, 4.4vh, 54px)' : 'clamp(18px, 2.4vh, 26px)' }}
        >
          {tile.label}
        </span>
        <span
          className="font-semibold truncate"
          style={{
            fontSize: tile.primary ? 16 : 13,
            opacity: 0.72,
          }}
        >
          {tile.caption}
        </span>
      </span>
    </motion.button>
  );
});
