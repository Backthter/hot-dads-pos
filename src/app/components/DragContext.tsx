import { createContext, useContext, useState, useRef, useCallback, useEffect, ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Pencil } from 'lucide-react';
import { pointerPoint, type Rect } from '../ui/geometry';

type DropTarget = { id: string; rect: DOMRect; onDrop: (orderId: string) => void };

/** Where the drag started, so the chip can grow out of the card it came from. */
export interface DragOrigin {
  /**
   * Where the card was, already converted out of the interface zoom.
   *
   * Hit-testing below compares raw pointer coordinates against raw
   * `getBoundingClientRect()` values, and those two agree with each other, so
   * it stays as it is. Painting does not: the chip is drawn inside the zoomed
   * document, so anything used to position it has to be divided back out first
   * or the chip drifts further from the finger the further across the screen it
   * goes.
   */
  rect: Rect;
  /** Edit sessions show a pencil rather than their letter. */
  editing?: boolean;
}

interface DragCtx {
  draggingId: string | null;
  hoverTargetId: string | null;
  startDrag: (orderId: string, x: number, y: number, label: string, origin?: DragOrigin) => void;
  registerTarget: (id: string, el: HTMLElement, onDrop: (orderId: string) => void) => () => void;
}

const Ctx = createContext<DragCtx | null>(null);

export function useDrag() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useDrag must be inside DragProvider');
  return ctx;
}

export function DragProvider({ children }: { children: ReactNode }) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [hoverTargetId, setHoverTargetId] = useState<string | null>(null);
  const [ghost, setGhost] = useState<
    { x: number; y: number; label: string; origin?: DragOrigin } | null
  >(null);

  const targetsRef = useRef<Map<string, { el: HTMLElement; onDrop: (orderId: string) => void; count: number }>>(new Map());
  const draggingRef = useRef<string | null>(null);

  const registerTarget = useCallback((id: string, el: HTMLElement, onDrop: (orderId: string) => void) => {
    const existing = targetsRef.current.get(id);
    if (existing) {
      existing.count++;
      existing.el = el;
      existing.onDrop = onDrop;
    } else {
      targetsRef.current.set(id, { el, onDrop, count: 1 });
    }
    return () => {
      const entry = targetsRef.current.get(id);
      if (entry) {
        entry.count--;
        if (entry.count <= 0) {
          targetsRef.current.delete(id);
        }
      }
    };
  }, []);

  const findTargetAt = (x: number, y: number): string | null => {
    for (const [id, { el }] of targetsRef.current) {
      const rect = el.getBoundingClientRect();
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
        return id;
      }
    }
    return null;
  };

  const startDrag = useCallback((orderId: string, x: number, y: number, label: string, origin?: DragOrigin) => {
    draggingRef.current = orderId;
    setDraggingId(orderId);
    setGhost({ x, y, label, origin });

    const handleMove = (clientX: number, clientY: number) => {
      setGhost(g => g ? { ...g, x: clientX, y: clientY } : null);
      setHoverTargetId(findTargetAt(clientX, clientY));
    };

    const onMouseMove = (e: MouseEvent) => handleMove(e.clientX, e.clientY);
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches[0]) {
        e.preventDefault();
        handleMove(e.touches[0].clientX, e.touches[0].clientY);
      }
    };

    const finishDrag = (clientX: number, clientY: number) => {
      const targetId = findTargetAt(clientX, clientY);
      const oid = draggingRef.current;
      if (targetId && oid) {
        const t = targetsRef.current.get(targetId);
        t?.onDrop(oid);
      }
      cleanup();
    };

    const onMouseUp = (e: MouseEvent) => finishDrag(e.clientX, e.clientY);
    const onTouchEnd = (e: TouchEvent) => {
      const t = e.changedTouches[0];
      if (t) finishDrag(t.clientX, t.clientY);
      else cleanup();
    };

    const cleanup = () => {
      draggingRef.current = null;
      setDraggingId(null);
      setHoverTargetId(null);
      setGhost(null);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('touchcancel', cleanup as any);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEnd);
    window.addEventListener('touchcancel', cleanup as any);
  }, []);

  return (
    <Ctx.Provider value={{ draggingId, hoverTargetId, startDrag, registerTarget }}>
      {children}
      <AnimatePresence>
        {ghost && (
          <GhostChip key="drag-ghost" ghost={ghost} />
        )}
      </AnimatePresence>
    </Ctx.Provider>
  );
}

/**
 * The chip that follows the pointer. It starts as an outline of the card it came
 * from and shrinks into the chip, so the card visibly becomes the thing being
 * dragged rather than one popping out of the other.
 */
function GhostChip({ ghost }: { ghost: { x: number; y: number; label: string; origin?: DragOrigin } }) {
  const start = useRef(ghost.origin ?? null).current;
  // The pointer arrives in the page's own coordinates; the chip is painted
  // inside the zoom, so it is placed in the zoom's coordinates.
  const point = pointerPoint({ clientX: ghost.x, clientY: ghost.y });
  const anchorX = point.x + 12;
  const anchorY = point.y + 12;

  // Offset and scale that place the chip exactly over the original card.
  const initial = start
    ? {
        x: start.rect.left - anchorX,
        y: start.rect.top - anchorY,
        scaleX: Math.max(1, start.rect.width / 64),
        scaleY: Math.max(1, start.rect.height / 40),
        opacity: 0.35,
      }
    : { x: 0, y: 0, scaleX: 1, scaleY: 1, opacity: 0 };

  return (
    <motion.div
      className="fixed pointer-events-none z-50 flex items-center justify-center gap-[5px] bg-[#27272a] border-2 border-[#5BBFB6] rounded-[10px] px-4 py-2 text-white text-[16px] shadow-2xl"
      style={{ left: anchorX, top: anchorY, transformOrigin: 'top left' }}
      initial={initial}
      animate={{ x: 0, y: 0, scaleX: 1, scaleY: 1, opacity: 0.95 }}
      exit={{ opacity: 0, scale: 0.85 }}
      transition={{ type: 'spring', stiffness: 520, damping: 34, mass: 0.5 }}
    >
      {ghost.origin?.editing && <Pencil size={14} className="text-[#c9a3f0]" />}
      {ghost.label}
    </motion.div>
  );
}

export function useDropTarget(id: string, onDrop: (orderId: string) => void) {
  const { registerTarget, hoverTargetId, draggingId } = useDrag();
  const ref = useRef<HTMLDivElement | null>(null);
  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;

  useEffect(() => {
    if (!ref.current) return;
    return registerTarget(id, ref.current, (orderId) => onDropRef.current(orderId));
  }, [id, registerTarget]);

  return {
    ref,
    isOver: hoverTargetId === id && draggingId !== null,
    isActive: draggingId !== null,
  };
}
