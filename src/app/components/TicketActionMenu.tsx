import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'motion/react';
import { Ban, BellRing, CheckCircle2, Flame, Pencil, RotateCcw } from 'lucide-react';
import { viewport, type Rect } from '../ui/geometry';

export type TicketAction = 'completed' | 'grill' | 'ready' | 'edit' | 'preparing';

type Direction = 'up' | 'down' | 'left' | 'right';

/** A beat before the menu opens — enough to ignore a brush, short enough to feel instant. */
const HOLD_MS = 35;
/** Movement past this before the hold elapses cancels the press (treated as a scroll). */
const CANCEL_SLOP = 10;
/** Distance at which a direction lights up. Releasing while lit performs it —
 *  one threshold, so what you can see is exactly what will happen. */
const ARM_DISTANCE = 34;
/** The ticket only nudges toward the finger — the targets sit close enough that
 *  following properly would cover the label being aimed at. */
const FOLLOW_RATIO = 0.22;
const FOLLOW_MAX = 14;

/** Up/down targets are labelled pills; left/right are compact discs, so they fit
 *  beside a ticket sitting at the edge of the board. */
const PILL_W = 150;
const PILL_H = 38;
const DISC = 52;
/** Clearance between the ticket and its targets. Allows for the armed ring,
 *  which is drawn outside the ticket's own edge. */
const TARGET_GAP = 20;
/** Targets keep at least this much clearance from the viewport edge. */
const VIEWPORT_PAD = 10;
/** How far outside the ticket the armed ring sits, on every side equally. */
const RING_OFFSET = 5;
/** Cap on how far the ticket may slide to make room for its targets. */
const MAX_SHIFT = 170;

export interface ActionMeta {
  action: TicketAction;
  direction: Direction;
  label: string;
  hint: string;
  color: string;
  glow: string;
  /** Foreground used once the target lights up. */
  onColor: string;
  /** Unit direction, used for entry offsets and the commit fly-out. */
  vector: { x: number; y: number };
  /** Short caption used under the disc-shaped left/right targets. */
  short: string;
  icon: typeof Flame;
}

export const ACTION_META: Record<TicketAction, ActionMeta> = {
  completed: {
    action: 'completed',
    direction: 'up',
    label: 'Completed',
    hint: 'Swipe up',
    color: '#22c55e',
    glow: 'rgba(34,197,94,0.55)',
    onColor: '#052e16',
    vector: { x: 0, y: -1 },
    short: 'Completed',
    icon: CheckCircle2,
  },
  grill: {
    action: 'grill',
    direction: 'right',
    label: 'On the Grill',
    hint: 'Swipe right',
    color: '#f79634',
    glow: 'rgba(247,150,52,0.55)',
    onColor: '#2b1400',
    vector: { x: 1, y: 0 },
    short: 'Grill',
    icon: Flame,
  },
  ready: {
    action: 'ready',
    direction: 'down',
    label: 'Ready',
    hint: 'Swipe down',
    color: '#76DFDA',
    glow: 'rgba(118,223,218,0.55)',
    onColor: '#04312f',
    vector: { x: 0, y: 1 },
    short: 'Ready',
    icon: BellRing,
  },
  preparing: {
    action: 'preparing',
    // Direction is assigned dynamically: it takes over whichever slot the
    // ticket's current section would otherwise occupy.
    direction: 'up',
    label: 'Preparing',
    vector: { x: 0, y: -1 },
    short: 'Prep',
    hint: 'Send back',
    color: '#F9624E',
    glow: 'rgba(249,98,78,0.55)',
    onColor: '#340a05',
    icon: RotateCcw,
  },
  edit: {
    action: 'edit',
    direction: 'left',
    label: 'Edit',
    hint: 'Swipe left',
    color: '#A855F7',
    glow: 'rgba(168,85,247,0.55)',
    onColor: '#2a0a45',
    vector: { x: -1, y: 0 },
    short: 'Edit',
    icon: Pencil,
  },
};

const DIRECTIONS: Direction[] = ['up', 'right', 'down', 'left'];

/** The action each direction performs on a ticket that is still preparing. */
const DEFAULT_DIRECTION_ACTION: Record<Direction, TicketAction> = {
  up: 'completed',
  right: 'grill',
  down: 'ready',
  left: 'edit',
};

/** The section a ticket is already in has nothing to offer, so that slot sends
 *  the ticket back to Preparing instead of sitting there greyed out. */
const STATUS_SLOT: Record<string, Direction | undefined> = {
  completed: 'up',
  grill: 'right',
  ready: 'down',
  preparing: undefined,
};

/** Resolves which action sits in each direction for a given ticket. */
export function actionsForStatus(status?: string): Record<Direction, TicketAction> {
  const slot = status ? STATUS_SLOT[status] : undefined;
  const map = { ...DEFAULT_DIRECTION_ACTION };
  if (slot) map[slot] = 'preparing';
  return map;
}

export interface TicketMenuPayload {
  orderId: string;
  orderNumber: string;
  /** A non-interactive copy of the ticket, shown at the centre of the overlay. */
  preview: ReactNode;
  /**
   * Where the ticket is, in the coordinate space this overlay paints in.
   *
   * It must arrive already normalised against the interface zoom — see
   * `ui/geometry`. A raw `getBoundingClientRect()` is measured *after* the
   * zoom is applied, and everything in here is inside that same zoom, so
   * passing one straight through scales the copy and its outline up by the
   * zoom factor a second time. That is precisely what put the armed-state
   * stroke off the bottom and well off the right of the ticket it traces.
   */
  rect: Rect;
  /** Board section the ticket is in, which decides where "Preparing" appears. */
  status?: string;
  /** Actions that cannot be performed right now, e.g. a full grill. */
  disabled?: TicketAction[];
}

interface TicketMenuContextValue {
  /** Called from a ticket's onPointerDown. Opens after a short hold, or on release. */
  beginPress: (payload: TicketMenuPayload, clientX: number, clientY: number) => void;
  activeOrderId: string | null;
}

const Ctx = createContext<TicketMenuContextValue | null>(null);

export function useTicketMenu() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useTicketMenu must be used inside TicketMenuProvider');
  return ctx;
}

function prefersReducedMotion() {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

const DENIED_COLOR = '#F9624E';

function buzz(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // vibration unsupported — silent
  }
}

function directionFor(dx: number, dy: number): Direction | null {
  const distance = Math.hypot(dx, dy);
  if (distance < ARM_DISTANCE) return null;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'down' : 'up';
}

interface PressState {
  payload: TicketMenuPayload;
  startX: number;
  startY: number;
  timer: number | null;
  opened: boolean;
  tracking: boolean;
}

export function TicketMenuProvider({
  children,
  onAction,
}: {
  children: ReactNode;
  onAction: (orderId: string, action: TicketAction) => void;
}) {
  const [payload, setPayload] = useState<TicketMenuPayload | null>(null);
  const [drag, setDrag] = useState({ x: 0, y: 0 });
  const [armed, setArmed] = useState<TicketAction | null>(null);
  const [committing, setCommitting] = useState<TicketAction | null>(null);
  /** A target the gesture is pointing at that cannot accept the ticket. */
  const [denied, setDenied] = useState<TicketAction | null>(null);
  /** Fading out. The overlay stops accepting pointers the moment this is set. */
  const [closing, setClosing] = useState(false);

  const pressRef = useRef<PressState | null>(null);
  const armedRef = useRef<TicketAction | null>(null);
  const deniedRef = useRef<TicketAction | null>(null);
  const payloadRef = useRef<TicketMenuPayload | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const unmountTimerRef = useRef<number | null>(null);
  const reduceMotion = useRef(prefersReducedMotion());
  // Held in a ref so the gesture listeners, captured when the press began,
  // always dispatch against the latest app state rather than a stale closure.
  const onActionRef = useRef(onAction);

  payloadRef.current = payload;
  armedRef.current = armed;
  deniedRef.current = denied;
  onActionRef.current = onAction;

  const isDisabled = useCallback((action: TicketAction) => {
    return payloadRef.current?.disabled?.includes(action) ?? false;
  }, []);

  const detachWindowListeners = useRef<(() => void) | null>(null);

  const finishClose = useCallback(() => {
    setPayload(null);
    setDrag({ x: 0, y: 0 });
    setArmed(null);
    setDenied(null);
    setCommitting(null);
    setClosing(false);
  }, []);

  /**
   * Fades the overlay out, then unmounts it on a timer we control. Leaving the
   * unmount to an exit animation risks the scrim lingering invisibly over the
   * board and swallowing the next press.
   */
  const close = useCallback(() => {
    pressRef.current = null;
    detachWindowListeners.current?.();
    setClosing(true);
    if (unmountTimerRef.current) clearTimeout(unmountTimerRef.current);
    unmountTimerRef.current = window.setTimeout(finishClose, reduceMotion.current ? 0 : 140);
  }, [finishClose]);

  const commit = useCallback((action: TicketAction) => {
    const current = payloadRef.current;
    if (!current || isDisabled(action)) return;

    setCommitting(action);
    setArmed(action);
    buzz(18);
    onActionRef.current(current.orderId, action);

    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = window.setTimeout(close, reduceMotion.current ? 60 : 260);
  }, [close, isDisabled]);

  /** Starts steering the open menu from the current pointer position. */
  const startTracking = useCallback((clientX: number, clientY: number) => {
    const press = pressRef.current;
    if (!press) return;
    press.startX = clientX;
    press.startY = clientY;
    press.tracking = true;
    setDrag({ x: 0, y: 0 });
    setArmed(null);
  }, []);

  const attachWindowListeners = useCallback(() => {
    detachWindowListeners.current?.();

    const onPointerMove = (e: PointerEvent) => {
      const press = pressRef.current;
      if (!press) return;

      const dx = e.clientX - press.startX;
      const dy = e.clientY - press.startY;

      if (!press.opened) {
        // Still waiting on the hold — a real drag means the user is scrolling.
        if (Math.hypot(dx, dy) > CANCEL_SLOP) {
          if (press.timer) clearTimeout(press.timer);
          pressRef.current = null;
          detach();
        }
        return;
      }

      if (!press.tracking) return;
      e.preventDefault();

      const distance = Math.hypot(dx, dy);
      const blockedNow = deniedRef.current !== null;
      const cap = blockedNow ? FOLLOW_MAX * 0.45 : FOLLOW_MAX;
      const scale = distance > 0 ? Math.min(distance * FOLLOW_RATIO, cap) / distance : 0;
      setDrag({ x: dx * scale, y: dy * scale });

      const direction = directionFor(dx, dy);
      const slots = actionsForStatus(press.payload.status);
      const next = direction ? slots[direction] : null;
      const blocked = next !== null && isDisabled(next);
      const resolved = blocked ? null : next;

      if (resolved !== armedRef.current) {
        armedRef.current = resolved;
        setArmed(resolved);
        if (resolved) buzz(8);
      }

      const nextDenied = blocked ? next : null;
      if (nextDenied !== deniedRef.current) {
        deniedRef.current = nextDenied;
        setDenied(nextDenied);
        // A short double buzz reads as "no" rather than "yes".
        if (nextDenied) buzz([12, 50, 12]);
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      const press = pressRef.current;
      if (!press) return;

      // Letting go always ends the interaction: the menu is a held state, not a
      // toggled one. Whatever is lit at that moment is what happens.
      if (!press.opened) {
        if (press.timer) clearTimeout(press.timer);
        pressRef.current = null;
        detach();
        return;
      }

      const dx = e.clientX - press.startX;
      const dy = e.clientY - press.startY;
      const direction = press.tracking ? directionFor(dx, dy) : null;
      const slots = actionsForStatus(press.payload.status);
      const action = direction ? slots[direction] : null;

      press.tracking = false;

      if (action && !isDisabled(action)) {
        commit(action);
      } else {
        close();
      }
    };

    const onPointerCancel = () => {
      const press = pressRef.current;
      if (!press) return;
      if (!press.opened) {
        if (press.timer) clearTimeout(press.timer);
        pressRef.current = null;
        detach();
        return;
      }
      press.tracking = false;
      close();
    };

    const detach = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
      detachWindowListeners.current = null;
    };

    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
    detachWindowListeners.current = detach;
  }, [commit, close, isDisabled]);

  const beginPress = useCallback((next: TicketMenuPayload, clientX: number, clientY: number) => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    if (unmountTimerRef.current) clearTimeout(unmountTimerRef.current);
    if (pressRef.current?.timer) clearTimeout(pressRef.current.timer);
    setClosing(false);

    const press: PressState = {
      payload: next,
      startX: clientX,
      startY: clientY,
      timer: null,
      opened: false,
      tracking: false,
    };
    pressRef.current = press;

    press.timer = window.setTimeout(() => {
      if (pressRef.current !== press) return;
      press.opened = true;
      press.tracking = true;
      press.timer = null;
      buzz(10);
      setPayload(press.payload);
      setDrag({ x: 0, y: 0 });
      setArmed(null);
    }, HOLD_MS);

    attachWindowListeners();
  }, [attachWindowListeners]);

  // Keyboard: escape dismisses, arrows commit.
  useEffect(() => {
    if (!payload) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
        return;
      }
      const map: Record<string, Direction> = {
        ArrowUp: 'up',
        ArrowDown: 'down',
        ArrowLeft: 'left',
        ArrowRight: 'right',
      };
      const direction = map[e.key];
      if (!direction) return;
      e.preventDefault();
      commit(actionsForStatus(payload?.status)[direction]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [payload, close, commit]);

  useEffect(() => () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    if (unmountTimerRef.current) clearTimeout(unmountTimerRef.current);
    if (pressRef.current?.timer) clearTimeout(pressRef.current.timer);
    detachWindowListeners.current?.();
  }, []);

  const overlay = payload && typeof document !== 'undefined'
    ? createPortal(
        <TicketMenuOverlay
          payload={payload}
          drag={drag}
          armed={armed}
          denied={denied}
          committing={committing}
          closing={closing}
          reduceMotion={reduceMotion.current}
          onDismiss={close}
          onPick={commit}
          onRegrab={(x, y) => {
            if (!pressRef.current) return;
            startTracking(x, y);
            attachWindowListeners();
          }}
        />,
        document.body,
      )
    : null;

  return (
    <Ctx.Provider value={{ beginPress, activeOrderId: payload?.orderId ?? null }}>
      {children}
      {overlay}
    </Ctx.Provider>
  );
}

/** Unit vector for each direction — the slot's geometry, independent of which
 *  action currently occupies it. */
const DIRECTION_VECTOR: Record<Direction, { x: number; y: number }> = {
  up: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
};

/** Left and right are discs; up and down are labelled pills. */
function targetSize(meta: { vector: { x: number; y: number } }) {
  return meta.vector.x !== 0 ? { w: DISC, h: DISC } : { w: PILL_W, h: PILL_H };
}

const DIRECTION_META: Record<Direction, { vector: { x: number; y: number } }> = {
  up: { vector: DIRECTION_VECTOR.up },
  right: { vector: DIRECTION_VECTOR.right },
  down: { vector: DIRECTION_VECTOR.down },
  left: { vector: DIRECTION_VECTOR.left },
};

/**
 * Lays the four targets out around the ticket. The ticket normally stays exactly
 * where it is; only when a target would not fit on screen does the whole cluster
 * (ticket included) slide inward, by the smallest amount that works.
 */
function layoutTargets(rect: Rect) {
  // Divided back out of the zoom for the same reason the rect is: the two have
  // to be measured in the same units or the clamping is wrong by 12%.
  const { width: vw, height: vh } = viewport();

  const reach = (meta: { vector: { x: number; y: number } }) => {
    const { w, h } = targetSize(meta);
    return meta.vector.x !== 0
      ? rect.width / 2 + TARGET_GAP + w / 2
      : rect.height / 2 + TARGET_GAP + h / 2;
  };

  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;

  // How far the cluster must move for every target to clear the viewport.
  let shiftX = 0;
  let shiftY = 0;
  for (const direction of DIRECTIONS) {
    const meta = DIRECTION_META[direction];
    const { w, h } = targetSize(meta);
    const x = cx + meta.vector.x * reach(meta);
    const y = cy + meta.vector.y * reach(meta);

    const overLeft = VIEWPORT_PAD + w / 2 - x;
    if (overLeft > 0) shiftX = Math.max(shiftX, overLeft);
    const overRight = x + w / 2 - (vw - VIEWPORT_PAD);
    if (overRight > 0) shiftX = Math.min(shiftX, -overRight);

    const overTop = VIEWPORT_PAD + h / 2 - y;
    if (overTop > 0) shiftY = Math.max(shiftY, overTop);
    const overBottom = y + h / 2 - (vh - VIEWPORT_PAD);
    if (overBottom > 0) shiftY = Math.min(shiftY, -overBottom);
  }
  shiftX = Math.max(-MAX_SHIFT, Math.min(MAX_SHIFT, shiftX));
  shiftY = Math.max(-MAX_SHIFT, Math.min(MAX_SHIFT, shiftY));

  const centre = { x: cx + shiftX, y: cy + shiftY };
  const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);

  const place = (meta: { vector: { x: number; y: number } }) => {
    const { w, h } = targetSize(meta);
    return {
      w,
      h,
      x: clamp(centre.x + meta.vector.x * reach(meta), VIEWPORT_PAD + w / 2, vw - VIEWPORT_PAD - w / 2),
      y: clamp(centre.y + meta.vector.y * reach(meta), VIEWPORT_PAD + h / 2, vh - VIEWPORT_PAD - h / 2),
    };
  };

  return { place, shift: { x: shiftX, y: shiftY } };
}

function TicketMenuOverlay({
  payload,
  drag,
  armed,
  denied,
  committing,
  closing,
  reduceMotion,
  onDismiss,
  onPick,
  onRegrab,
}: {
  payload: TicketMenuPayload;
  drag: { x: number; y: number };
  armed: TicketAction | null;
  denied: TicketAction | null;
  committing: TicketAction | null;
  closing: boolean;
  reduceMotion: boolean;
  onDismiss: () => void;
  onPick: (action: TicketAction) => void;
  onRegrab: (clientX: number, clientY: number) => void;
}) {
  const { rect } = payload;
  const { place, shift } = layoutTargets(rect);
  const slots = actionsForStatus(payload.status);
  const committingDirection = committing
    ? DIRECTIONS.find(d => slots[d] === committing)
    : undefined;
  const committingVector = committingDirection ? DIRECTION_VECTOR[committingDirection] : null;

  const snap = reduceMotion
    ? { duration: 0 }
    : { type: 'spring' as const, stiffness: 700, damping: 38, mass: 0.5 };

  /** What the ring is showing: a refusal, an armed action, or nothing. */
  const ringColor = denied
    ? DENIED_COLOR
    : armed
      ? ACTION_META[armed].color
      : null;

  return (
    <div
      className="fixed inset-0 z-[100]"
      style={{ pointerEvents: closing ? 'none' : 'auto', touchAction: 'none' }}
      onPointerDown={onDismiss}
      onWheel={e => e.preventDefault()}
    >
      {/* Backdrop is its own layer so the ticket copy below does not fade with
          it — otherwise closing leaves a gap where neither the copy nor the real
          ticket is on screen, which reads as a flash. */}
      <motion.div
        className="absolute inset-0"
        initial={{ opacity: 0 }}
        animate={{ opacity: closing ? 0 : 1 }}
        transition={{ duration: reduceMotion ? 0 : 0.09, ease: 'easeOut' }}
        style={{
          background: 'rgba(6,6,8,0.42)',
          backdropFilter: 'blur(4px)',
          WebkitBackdropFilter: 'blur(4px)',
        }}
      />
      {DIRECTIONS.map(direction => {
        const action = slots[direction];
        const meta = ACTION_META[action];
        const geometry = DIRECTION_META[direction];
        const disabled = payload.disabled?.includes(action) ?? false;
        const isArmed = armed === action;
        const isDenied = denied === action;
        const isCommitting = committing === action;
        const pos = place(geometry);
        const isDisc = geometry.vector.x !== 0;
        const caption = disabled && action === 'grill' ? 'Full' : meta.short;
        const tint = isDenied ? DENIED_COLOR : meta.color;
        const fg = isDenied ? '#fff' : isArmed ? meta.onColor : meta.color;

        return (
          <motion.button
            key={direction}
            type="button"
            disabled={disabled}
            aria-label={meta.label}
            aria-pressed={isArmed}
            data-action={action}
            data-armed={isArmed ? 'true' : 'false'}
            data-denied={isDenied ? 'true' : 'false'}
            onPointerDown={e => e.stopPropagation()}
            onClick={e => {
              e.stopPropagation();
              if (!disabled) onPick(action);
            }}
            className="absolute flex items-center justify-center gap-[8px] rounded-full select-none"
            style={{
              left: pos.x - pos.w / 2,
              top: pos.y - pos.h / 2,
              width: pos.w,
              height: pos.h,
              cursor: disabled ? 'not-allowed' : 'pointer',
              border: `2px solid ${tint}`,
              pointerEvents: disabled ? 'none' : 'auto',
            }}
            initial={{ opacity: 0, scale: 0.82, x: geometry.vector.x * -16, y: geometry.vector.y * -16 }}
            animate={{
              opacity: closing ? 0 : isDenied ? 1 : disabled ? 0.3 : armed && !isArmed ? 0.32 : 1,
              scale: isCommitting ? 1.16 : isArmed ? 1.09 : isDenied ? 1.015 : 1,
              x: 0,
              y: 0,
              backgroundColor: isDenied
                ? 'rgba(249,98,78,0.85)'
                : isArmed ? meta.color : 'rgba(16,16,20,0.94)',
              boxShadow: isDenied
                ? '0 0 0 3px rgba(249,98,78,0.12), 0 8px 18px rgba(249,98,78,0.32)'
                : isArmed
                  ? `0 0 0 6px ${meta.glow.replace('0.55', '0.16')}, 0 10px 26px ${meta.glow}`
                  : '0 6px 18px rgba(0,0,0,0.5)',
            }}
            transition={snap}
          >
            {/* The refusal shake lives on an inner wrapper so it cannot fight
                with the button's own entry animation. */}
            <motion.span
              className="flex items-center justify-center gap-[8px]"
              animate={isDenied && !reduceMotion ? { x: [0, -3, 3, -2, 2, 0] } : { x: 0 }}
              transition={isDenied ? { duration: 0.28, ease: 'easeOut' } : { duration: 0.12 }}
              key={isDenied ? 'denied' : 'idle'}
            >
              {isDenied ? (
                <Ban size={isDisc ? 21 : 17} color={fg} strokeWidth={2.6} />
              ) : (
                <meta.icon size={isDisc ? 21 : 17} color={fg} strokeWidth={2.5} />
              )}
              {!isDisc && (
                <span
                  className="font-['Segoe_UI',sans-serif] text-[12px] font-bold uppercase tracking-[0.7px]"
                  style={{ color: fg }}
                >
                  {isDenied ? 'Full' : meta.label}
                </span>
              )}
            </motion.span>
            {isDisc && (
              <span
                className="absolute -bottom-[19px] left-1/2 -translate-x-1/2 px-[6px] py-[1px] rounded-full font-['Segoe_UI',sans-serif] text-[10px] font-bold uppercase tracking-[0.6px] whitespace-nowrap"
                style={{
                  color: isDenied ? '#fff' : meta.color,
                  background: isDenied ? DENIED_COLOR : 'rgba(10,10,12,0.88)',
                }}
              >
                {caption}
              </span>
            )}
          </motion.button>
        );
      })}

      {/* The ticket, lifted where it already sits — no travel, so the gesture
          starts the instant it appears. */}
      <motion.div
        className="absolute"
        data-ticket-menu-preview="true"
        style={{
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
          touchAction: 'none',
          transformOrigin: 'center',
        }}
        onPointerDown={e => {
          e.stopPropagation();
          onRegrab(e.clientX, e.clientY);
        }}
        initial={{ x: 0, y: 0, scale: 1 }}
        animate={
          closing && !committingVector
            ? { x: shift.x + drag.x, y: shift.y + drag.y, scale: 1, opacity: 1 }
            : committingVector
            ? {
                x: shift.x + committingVector.x * 26,
                y: shift.y + committingVector.y * 26,
                scale: 0.9,
                opacity: 0,
              }
            : { x: shift.x + drag.x, y: shift.y + drag.y, scale: 1.04, opacity: 1 }
        }
        transition={snap}
      >
        {/*
          The ring that tells you what is about to happen.

          It was an *inset* box-shadow, which cannot work here: the ticket's
          face is an SVG that fills its box, and an inset shadow paints beneath
          an element's children — so the ring was hidden behind the artwork
          except where it overhung the ticket. It only appeared at all because
          the wrapper was accidentally 12% too large, and only along the two
          edges that overhang, which is exactly the "offset far too much on the
          right, a bit on the bottom" that was reported.

          Drawn as a sibling ring instead: it sits just outside the ticket, the
          same distance on every side, and is painted over the artwork rather
          than under it. Being inside the overlay it has no neighbouring tickets
          to bleed into, which is the reason the board's own editing ring has to
          stay tucked inside its ticket.
        */}
        {/* `flex`, not `block`. The ticket face is an inline-grid, so in a block
            container it sits on a line box and picks up the descender gap
            underneath — which put the ring seven pixels further from the bottom
            edge than from the other three. */}
        <div className="relative flex" style={{ borderRadius: 10, boxShadow: '0 14px 30px rgba(0,0,0,0.55)' }}>
          {payload.preview}
          <motion.span
            aria-hidden
            className="absolute pointer-events-none"
            data-arm-ring={ringColor ? 'true' : 'false'}
            initial={false}
            animate={{ opacity: ringColor ? 1 : 0, scale: ringColor ? 1 : 0.985 }}
            transition={reduceMotion ? { duration: 0 } : { duration: 0.11, ease: 'easeOut' }}
            style={{
              inset: -RING_OFFSET,
              borderRadius: 10 + RING_OFFSET,
              border: `3px solid ${ringColor ?? 'transparent'}`,
              boxShadow: ringColor ? `0 0 0 5px ${ringColor}22, 0 0 20px -2px ${ringColor}` : 'none',
              transition: 'border-color 110ms ease, box-shadow 110ms ease',
            }}
          />
        </div>
      </motion.div>
    </div>
  );
}
