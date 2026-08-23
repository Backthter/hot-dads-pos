import { useEffect, useRef, useState, type ReactNode } from 'react';
import { animate, motion, useMotionValue } from 'motion/react';
import { AlertTriangle } from 'lucide-react';
import { StockIcon } from './icons';
import { formatQuantity, isLowStock } from '../lib/inventory';
import { useBackHandler } from '../lib/navigation';
import {
  Button, ELEVATION, GLASS, Panel as SharedPanel, ScreenHeading, ToneOverride, Tooltip,
  DANGER as TOKEN_DANGER, SECTION_COLOR, SUCCESS, alpha, useSection,
  DURATION, PRESS, SNAP, useReducedMotion,
} from '../ui';
import type { StockItem } from '../types';

/**
 * Inventory's own bits and pieces.
 *
 * This file used to be a second design system: its own button, its own panel,
 * its own accent constant. Everything that was a general-purpose control now
 * comes from `../ui` and is defined once for the whole program; what is left
 * here is the handful of things that are genuinely about stock — a tile that
 * knows what "running low" looks like, a number that counts to its new value.
 *
 * The exported names are unchanged so the screens did not all have to be
 * rewritten at once.
 */

/** Inventory's colour, from the one table that holds all of them. */
export const ACCENT = SECTION_COLOR.inventory;
/** Reserved for "you need to reorder" links — a warning, not the accent. */
export const ACCENT_WARM = '#F9624E';
export const DANGER = TOKEN_DANGER;
export const GOOD = SUCCESS;
/** Legible text on top of a solid ACCENT fill. */
export const ON_ACCENT = '#1B1206';

/** Counts from the previous value to the new one, so a change is never silent. */
export function NumberRoll({
  value, decimals = 0, className, style,
}: { value: number; decimals?: number; className?: string; style?: React.CSSProperties }) {
  const motionValue = useMotionValue(value);
  const [shown, setShown] = useState(value);
  const first = useRef(true);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (first.current || reduced) {
      first.current = false;
      motionValue.set(value);
      setShown(value);
      return;
    }
    const controls = animate(motionValue, value, {
      duration: 0.45,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: v => setShown(v),
    });
    return () => controls.stop();
  }, [value, motionValue, reduced]);

  return (
    <span className={className} style={style}>
      {shown.toFixed(decimals)}
    </span>
  );
}

/** A quantity that rolls its number and keeps its unit steady beside it. */
export function QuantityDisplay({
  quantity, unit, size = 20, muted = false,
}: { quantity: number; unit: string; size?: number; muted?: boolean }) {
  const formatted = formatQuantity(quantity, unit);
  const decimals = formatted.value.includes('.') ? formatted.value.split('.')[1].length : 0;
  return (
    <span className="inline-flex items-baseline gap-[4px] tabular-nums">
      <NumberRoll
        value={parseFloat(formatted.value)}
        decimals={decimals}
        style={{ fontSize: size, fontWeight: 700, color: muted ? 'var(--app-text-secondary)' : 'var(--app-text)' }}
      />
      <span style={{ fontSize: Math.max(10, size * 0.5), color: 'var(--app-text-muted)' }}>
        {formatted.unit}
      </span>
    </span>
  );
}

/** The shared panel, kept under its old name for the screens that import it. */
export function Panel({
  children, className = '', ...rest
}: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`rounded-[14px] border border-[var(--app-border)] ${className}`}
      style={{ background: `${GLASS.panel.background}, var(--app-surface)`, boxShadow: ELEVATION.low }}
      {...rest}
    >
      {children}
    </div>
  );
}

export function PrimaryButton({
  children, onClick, disabled, tone, className = '', type = 'button', title,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  tone?: string;
  className?: string;
  type?: 'button' | 'submit';
  title?: string;
}) {
  return (
    <Button
      type={type}
      variant="primary"
      size="lg"
      tone={tone}
      hint={title}
      onClick={onClick}
      disabled={disabled}
      className={className}
    >
      {children}
    </Button>
  );
}

export function GhostButton({
  children, onClick, active = false, className = '', title, tone, ...rest
}: {
  children: ReactNode;
  onClick?: () => void;
  active?: boolean;
  className?: string;
  title?: string;
  tone?: string;
} & Record<string, unknown>) {
  return (
    <Button
      variant="secondary"
      active={active}
      tone={tone}
      hint={title}
      onClick={onClick}
      className={className}
      {...rest}
    >
      {children}
    </Button>
  );
}

/** One tile in the stock grid. */
export function StockTile({
  item, onPress, onHoverChange, highlighted = false, subtitle, trailing, compact = false, tone,
}: {
  item: StockItem;
  onPress?: () => void;
  onHoverChange?: (hovering: boolean) => void;
  highlighted?: boolean;
  subtitle?: ReactNode;
  trailing?: ReactNode;
  compact?: boolean;
  /**
   * Overrides the section colour. Used by the emptying mode, where a tap
   * destroys what is on the shelf and the tile ought to say so before it is
   * pressed rather than after.
   */
  tone?: string;
}) {
  const low = isLowStock(item);
  const theme = useSection();
  const reduced = useReducedMotion();
  const [hover, setHover] = useState(false);
  const lit = hover || highlighted;
  const accent = tone ?? (low ? DANGER : theme.color);

  return (
    <motion.button
      type="button"
      layout
      onClick={onPress}
      onHoverStart={() => { setHover(true); onHoverChange?.(true); }}
      onHoverEnd={() => { setHover(false); onHoverChange?.(false); }}
      whileTap={reduced ? undefined : PRESS}
      initial={{ opacity: 0, scale: 0.94 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.94 }}
      transition={reduced ? { duration: 0 } : SNAP}
      data-stock-tile={item.id}
      className="relative flex flex-col items-start gap-[7px] rounded-[16px] p-[16px] text-left border overflow-hidden"
      /*
        Hover lights the tile in place rather than lifting it.
        A two-pixel rise looks fine in isolation and is wrong here: the grid
        scrolls, so the top row rose straight into the container's clipped edge
        and came back with its top shaved off. Nothing moves now — the tile
        gains an inner ring and a wash, which cannot be clipped because it does
        not leave the tile's own box.
      */
      style={{
        background: lit
          ? `linear-gradient(135deg, ${alpha(accent, 0.14)} 0%, ${alpha(accent, 0.03)} 100%), var(--app-bg-darker)`
          : `${GLASS.panel.background}, var(--app-bg-darker)`,
        borderColor: low ? DANGER : lit ? accent : 'var(--app-border)',
        boxShadow: lit ? `inset 0 0 0 1px ${alpha(accent, 0.45)}, ${ELEVATION.low}` : ELEVATION.low,
        minHeight: compact ? 112 : 146,
        transitionProperty: 'background-image, border-color, box-shadow',
        transitionDuration: `${DURATION.fast * 1000}ms`,
      }}
    >
      {low && !reduced && (
        <motion.span
          className="absolute inset-0 pointer-events-none rounded-[15px]"
          style={{ border: `1px solid ${DANGER}` }}
          animate={{ opacity: [0.25, 0.7] }}
          transition={{ duration: 1.6, repeat: Infinity, repeatType: 'mirror', ease: 'easeInOut' }}
        />
      )}

      <div className="flex items-center justify-between w-full">
        <span
          className="flex items-center justify-center rounded-[11px] shrink-0"
          style={{
            width: 42, height: 42,
            background: lit ? alpha(accent, 0.2) : 'var(--app-surface)',
            transition: `background ${DURATION.fast}s`,
          }}
        >
          <StockIcon id={item.iconId} size={24} color={accent} />
        </span>
        {low && (
          <Tooltip label={`${item.name} has fallen to or below the level you set as low.`}>
            <span className="flex"><AlertTriangle size={17} style={{ color: DANGER }} /></span>
          </Tooltip>
        )}
        {trailing}
      </div>

      <span className="text-[var(--app-text)] text-[16px] font-bold leading-[20px] truncate w-full">
        {item.name}
      </span>

      {!compact && <QuantityDisplay quantity={item.quantity} unit={item.unit} size={23} />}

      {subtitle && (
        <span className="text-[var(--app-text-muted)] text-[12px] leading-[15px] truncate w-full">
          {subtitle}
        </span>
      )}
    </motion.button>
  );
}

/** Confirms an action in place: the label swaps for a tick and fades back. */
export function useFlash(duration = 900) {
  const [flash, setFlash] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const fire = (message: string) => {
    setFlash(message);
    if (timer.current) clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setFlash(null), duration);
  };
  return { flash, fire };
}

/**
 * A sub-screen's heading.
 *
 * It no longer draws a back button. It registers one instead: while this header
 * is on screen, the app's single back arrow means "leave this sub-screen", and
 * it goes back to the section only once there is nothing left open. Two back
 * buttons on screen at the same time, doing two different things, was the
 * confusion worth removing — and doing it here means every screen that already
 * passed `onBack` was fixed without being touched.
 */
export function ScreenHeader({
  title, subtitle, onBack, actions, tone, icon,
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  actions?: ReactNode;
  /** Kept for the few sub-screens that are deliberately not the section colour. */
  tone?: string;
  /** The screen's own mark, in the section colour. Every stock screen has one. */
  icon?: ReactNode;
}) {
  useBackHandler(Boolean(onBack), title.toLowerCase(), () => onBack?.());

  const heading = <ScreenHeading title={title} subtitle={subtitle} actions={actions} icon={icon} />;
  return tone ? <ToneOverride color={tone}>{heading}</ToneOverride> : heading;
}

export { SharedPanel };
