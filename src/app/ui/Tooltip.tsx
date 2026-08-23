import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Info } from 'lucide-react';
import { measure, viewport, type Rect } from './geometry';
import { DURATION, EASE, useReducedMotion } from './motion';
import { ELEVATION, GLASS } from './tokens';

/**
 * The app's one way of explaining something.
 *
 * `title=""` was doing this job before, which had three problems: the delay is
 * the operating system's and is far too long to be useful behind a counter, the
 * styling is the operating system's and matched nothing, and it never appears
 * at all on a touchscreen — so on the hardware this program actually runs on,
 * every explanation in the app was invisible. This one shows quickly on hover,
 * on keyboard focus, and after a short press on a finger.
 *
 * Wrapping uses `display: contents`, so putting a tooltip around a control
 * never changes how that control is laid out. Mouse and focus events still
 * bubble through, because event propagation follows the DOM tree rather than
 * the box tree.
 */

const SHOW_DELAY = 260;
const TOUCH_DELAY = 380;
const GAP = 10;
const MAX_WIDTH = 300;

type Side = 'top' | 'bottom';

export function Tooltip({
  label, children, side = 'top', disabled = false,
}: {
  label: ReactNode;
  children: ReactNode;
  side?: Side;
  disabled?: boolean;
}) {
  const hostRef = useRef<HTMLSpanElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const [anchor, setAnchor] = useState<Rect | null>(null);
  const reduced = useReducedMotion();

  const clear = useCallback(() => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const open = useCallback((delay: number) => {
    if (disabled || !label) return;
    clear();
    timerRef.current = window.setTimeout(() => {
      const target = hostRef.current?.firstElementChild ?? hostRef.current;
      const rect = measure(target);
      if (rect) setAnchor(rect);
    }, delay);
  }, [clear, disabled, label]);

  const close = useCallback(() => {
    clear();
    setAnchor(null);
  }, [clear]);

  useEffect(() => () => clear(), [clear]);

  // A tooltip must never outlive what it describes, and must never survive a
  // scroll — it is positioned once and would otherwise float away from its
  // anchor.
  useEffect(() => {
    if (!anchor) return;
    const onScroll = () => close();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [anchor, close]);

  return (
    <>
      <span
        ref={hostRef}
        style={{ display: 'contents' }}
        onMouseOver={() => open(SHOW_DELAY)}
        onMouseOut={close}
        onFocus={() => open(0)}
        onBlur={close}
        onPointerDown={e => { if (e.pointerType === 'touch') open(TOUCH_DELAY); }}
        onPointerUp={close}
        onPointerCancel={close}
      >
        {children}
      </span>
      {typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          {anchor && (
            <TooltipBubble anchor={anchor} side={side} reduced={reduced}>{label}</TooltipBubble>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}

function TooltipBubble({
  anchor, side, reduced, children,
}: { anchor: Rect; side: Side; reduced: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [placed, setPlaced] = useState<{ left: number; top: number; side: Side } | null>(null);

  // Measured after mount rather than estimated: the copy is user-facing prose
  // of unpredictable length, and guessing its height puts it through the edge
  // of the screen exactly when it has the most to say.
  useEffect(() => {
    const own = measure(ref.current);
    if (!own) return;
    const view = viewport();
    const centre = anchor.left + anchor.width / 2;

    let resolved: Side = side;
    const above = anchor.top - GAP - own.height;
    const below = anchor.top + anchor.height + GAP;
    if (side === 'top' && above < 8) resolved = 'bottom';
    if (side === 'bottom' && below + own.height > view.height - 8) resolved = 'top';

    const top = resolved === 'top' ? anchor.top - GAP - own.height : anchor.top + anchor.height + GAP;
    const left = Math.min(
      Math.max(8, centre - own.width / 2),
      Math.max(8, view.width - own.width - 8),
    );
    setPlaced({ left, top, side: resolved });
  }, [anchor, side]);

  return (
    <motion.div
      ref={ref}
      role="tooltip"
      initial={{ opacity: 0, y: side === 'top' ? 4 : -4, scale: 0.97 }}
      animate={{ opacity: placed ? 1 : 0, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={reduced ? { duration: 0 } : { duration: DURATION.fast, ease: EASE }}
      className="fixed z-[400] pointer-events-none rounded-[10px] px-[12px] py-[8px]"
      style={{
        left: placed?.left ?? -9999,
        top: placed?.top ?? -9999,
        maxWidth: MAX_WIDTH,
        background: 'rgba(20,20,25,0.94)',
        border: '1px solid rgba(255,255,255,0.09)',
        boxShadow: ELEVATION.mid,
        ...GLASS.floating,
      }}
    >
      <span className="block text-[#EDEDF2] text-[12.5px] leading-[17px] font-medium">
        {children}
      </span>
    </motion.div>
  );
}

/**
 * The little "i" beside a figure whose definition is not obvious.
 *
 * Used where the explanation is genuinely needed to read the number — a KPI
 * whose basis matters — rather than sprinkled over every label.
 */
export function InfoDot({ label, size = 13 }: { label: ReactNode; size?: number }) {
  return (
    <Tooltip label={label}>
      <button
        type="button"
        tabIndex={0}
        aria-label="What this means"
        className="shrink-0 flex items-center justify-center text-[var(--app-text-muted)] hover:text-[var(--app-text)] transition-colors rounded-full outline-none focus-visible:ring-2"
        style={{ width: size + 6, height: size + 6 }}
        onClick={e => e.stopPropagation()}
      >
        <Info size={size} />
      </button>
    </Tooltip>
  );
}
