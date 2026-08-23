/**
 * Measuring things while the whole interface is zoomed.
 *
 * `html { zoom: var(--ui-scale) }` scales the entire app so every control and
 * label grows together. The catch is that `getBoundingClientRect()` reports the
 * *zoomed* box — a ticket laid out 225px wide measures 252 at a scale of 1.12 —
 * while anything positioned from those numbers is itself inside the zoom and so
 * gets multiplied a second time. Feeding a raw rect into a fixed overlay
 * therefore places it 12% too far from the origin and draws it 12% too large,
 * which is exactly why the ticket action menu's outline sat off the bottom and
 * far off the right of the ticket it was meant to trace.
 *
 * Everything that measures the page and then paints on top of it goes through
 * here, so the two are always in the same coordinate space.
 */

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The zoom currently applied to the document. Never zero. */
export function uiScale(): number {
  if (typeof document === 'undefined') return 1;
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--ui-scale');
  const parsed = parseFloat(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

/** A measured rect converted into the coordinate space its own document uses. */
export function normalizeRect(rect: DOMRect | Rect): Rect {
  const scale = uiScale();
  return {
    left: rect.left / scale,
    top: rect.top / scale,
    width: rect.width / scale,
    height: rect.height / scale,
  };
}

/** Measures an element in the space that positioning it will use. */
export function measure(el: Element | null | undefined): Rect | null {
  if (!el) return null;
  return normalizeRect(el.getBoundingClientRect());
}

/**
 * The viewport, in the same space. `window.innerWidth` is unaffected by zoom,
 * so it has to be divided back out — the same correction the `.screen-w` and
 * `.screen-h` utilities make in CSS.
 */
export function viewport(): { width: number; height: number } {
  const scale = uiScale();
  const width = typeof window === 'undefined' ? 1440 : window.innerWidth;
  const height = typeof window === 'undefined' ? 900 : window.innerHeight;
  return { width: width / scale, height: height / scale };
}

/** Pointer coordinates, in the same space as `measure` and `viewport`. */
export function pointerPoint(e: { clientX: number; clientY: number }): { x: number; y: number } {
  const scale = uiScale();
  return { x: e.clientX / scale, y: e.clientY / scale };
}
