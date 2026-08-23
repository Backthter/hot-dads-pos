import {
  useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Check } from 'lucide-react';
import { useSection } from './SectionTheme';
import { measure, viewport, type Rect } from './geometry';
import { DURATION, EASE, SNAP, useReducedMotion } from './motion';
import { ELEVATION, GLASS, RADIUS, alpha } from './tokens';

/**
 * Every dropdown in the app.
 *
 * There were four of them, each written from scratch — the scope picker, the
 * export menu, the session menu, the filter builder — and they agreed on
 * nothing: two had a blurred surface and two did not, three different corner
 * radii, three different ways of showing which row was chosen, and one of them
 * could not be closed with the keyboard at all. This is that surface, once.
 *
 * The panel is portalled to the body and positioned in fixed coordinates rather
 * than sitting absolutely inside its trigger. Absolute positioning is simpler
 * and works right up until a dropdown appears inside something that scrolls —
 * at which point the list is clipped by the scroll container and the options
 * below the fold are unreachable, which is exactly what happened to a menu item
 * near the bottom of Settings. Being outside the tree, it also flips above the
 * trigger when there is no room below instead of running off the screen.
 */

const GAP = 8;

export function Popover({
  trigger, children, align = 'right', width = 320, maxHeight = 360, label,
}: {
  /** Renders the button. Gets the open state so it can show a chevron. */
  trigger: (state: { open: boolean; toggle: () => void }) => ReactNode;
  children: ReactNode | ((close: () => void) => ReactNode);
  align?: 'left' | 'right';
  width?: number;
  maxHeight?: number;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<Rect | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);

  const close = useCallback(() => setOpen(false), []);

  /**
   * Measured outside the state updater, not inside it.
   *
   * An updater has to be a pure function of its argument: React is entitled to
   * run it twice, and in development it does. Measuring and setting a second
   * piece of state from within one meant the panel opened and closed itself in
   * the same tick.
   */
  const openRef = useRef(false);
  openRef.current = open;
  const toggle = useCallback(() => {
    if (openRef.current) { setOpen(false); return; }
    const rect = measure(hostRef.current?.firstElementChild ?? hostRef.current);
    if (rect) setAnchor(rect);
    setOpen(true);
  }, []);

  // Escape closes, because a menu that can only be dismissed with the mouse is
  // a menu that traps anyone working from the keyboard.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  // A panel positioned once cannot follow its trigger, so scrolling closes it
  // rather than leaving it stranded somewhere the button no longer is.
  useEffect(() => {
    if (!open) return;
    const onScroll = (e: Event) => {
      if (hostRef.current && e.target instanceof Node && hostRef.current.contains(e.target)) return;
      close();
    };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', close);
    };
  }, [open, close]);

  return (
    <div className="relative shrink-0" ref={hostRef}>
      {trigger({ open, toggle })}

      {typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          {open && anchor && (
            <PopoverPanel
              anchor={anchor}
              align={align}
              width={width}
              maxHeight={maxHeight}
              label={label}
              onDismiss={close}
            >
              {typeof children === 'function' ? children(close) : children}
            </PopoverPanel>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </div>
  );
}

function PopoverPanel({
  anchor, align, width, maxHeight, label, onDismiss, children,
}: {
  anchor: Rect;
  align: 'left' | 'right';
  width: number;
  maxHeight: number;
  label?: string;
  onDismiss: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const reduced = useReducedMotion();
  const [placed, setPlaced] = useState<{ left: number; top: number; height: number } | null>(null);

  // Measured after mount rather than estimated: the list's height depends on
  // how many options it holds, and guessing puts a long one through the bottom
  // of the screen exactly when it has the most to show.
  useLayoutEffect(() => {
    const own = ref.current?.scrollHeight ?? 0;
    const view = viewport();
    const wanted = Math.min(own, maxHeight);

    const below = view.height - (anchor.top + anchor.height) - GAP - 8;
    const above = anchor.top - GAP - 8;
    const openUp = wanted > below && above > below;
    const height = Math.max(120, Math.min(wanted, openUp ? above : below));

    const top = openUp ? anchor.top - GAP - height : anchor.top + anchor.height + GAP;
    const rawLeft = align === 'right' ? anchor.left + anchor.width - width : anchor.left;
    const left = Math.min(Math.max(8, rawLeft), Math.max(8, view.width - width - 8));

    setPlaced({ left, top, height });
  }, [anchor, align, width, maxHeight]);

  return (
    <>
      {/* Catches the click that dismisses. Kept transparent — dimming the whole
          screen for a four-item menu is the kind of ceremony that makes a
          program feel slow. */}
      <div className="fixed inset-0 z-[190]" onMouseDown={onDismiss} />
      <motion.div
        ref={ref}
        role="menu"
        aria-label={label}
        initial={reduced ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.98 }}
        animate={{ opacity: placed ? 1 : 0, y: 0, scale: 1 }}
        exit={reduced ? { opacity: 0 } : { opacity: 0, y: -4, scale: 0.98 }}
        transition={reduced ? { duration: 0 } : SNAP}
        className="fixed z-[200] overflow-y-auto overflow-x-hidden p-[6px] flex flex-col gap-[2px] border"
        style={{
          left: placed?.left ?? -9999,
          top: placed?.top ?? -9999,
          width,
          maxHeight: placed?.height ?? maxHeight,
          borderRadius: RADIUS.lg,
          borderColor: 'var(--app-border)',
          background: 'rgba(20,20,25,0.94)',
          boxShadow: ELEVATION.high,
          ...GLASS.floating,
        }}
      >
        {children}
      </motion.div>
    </>
  );
}

/** A small heading inside a popover. */
export function PopoverSection({ children }: { children: ReactNode }) {
  return (
    <span className="px-[11px] pt-[7px] pb-[4px] text-[10px] font-bold uppercase tracking-[0.7px] text-[var(--app-text-muted)]">
      {children}
    </span>
  );
}

export function PopoverDivider() {
  return <div className="h-px my-[5px] mx-[8px] shrink-0" style={{ background: 'var(--app-border)' }} />;
}

/**
 * One row. Selected rows are marked with a tick *and* colour, never colour
 * alone — the section palettes are not all equally visible against the surface,
 * and one of them is grey.
 */
export function PopoverItem({
  onClick, selected = false, icon, title, detail, trailing, disabled = false, ...rest
}: {
  onClick?: () => void;
  selected?: boolean;
  icon?: ReactNode;
  title: ReactNode;
  detail?: ReactNode;
  trailing?: ReactNode;
  disabled?: boolean;
} & Record<string, unknown>) {
  const theme = useSection();
  const [hover, setHover] = useState(false);

  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="flex items-center gap-[10px] px-[11px] py-[9px] rounded-[10px] text-left w-full outline-none shrink-0"
      style={{
        background: selected
          ? alpha(theme.color, 0.16)
          : hover ? 'var(--app-surface)' : 'transparent',
        opacity: disabled ? 0.4 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
        transition: `background ${DURATION.fast}s`,
      }}
      {...rest}
    >
      {icon && (
        <span className="shrink-0 flex" style={{ color: selected ? theme.color : 'var(--app-text-muted)' }}>
          {icon}
        </span>
      )}
      <span className="flex flex-col min-w-0 flex-1">
        <span
          className="text-[13.5px] font-semibold truncate"
          style={{ color: selected ? theme.color : 'var(--app-text)' }}
        >
          {title}
        </span>
        {detail && (
          <span className="text-[11px] leading-[15px] text-[var(--app-text-muted)]">{detail}</span>
        )}
      </span>
      {trailing}
      {selected && <Check size={15} className="shrink-0" style={{ color: theme.color }} />}
    </button>
  );
}

/** Explanatory copy inside a popover, in the one style it should be in. */
export function PopoverNote({ children }: { children: ReactNode }) {
  return (
    <p className="px-[11px] py-[6px] text-[11.5px] leading-[16px] text-[var(--app-text-muted)] shrink-0">
      {children}
    </p>
  );
}

export const POPOVER_TRANSITION = { duration: DURATION.fast, ease: EASE };
