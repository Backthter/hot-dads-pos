import { useCallback, useState } from 'react';

/**
 * State that outlives its screen.
 *
 * Leaving a section unmounts it, and an ordinary `useState` goes with it — so
 * opening Inventory from Analytics and coming back dropped you on Overview with
 * the period reset, having thrown away the view you had set up. Nothing about
 * that is what "back" or "return" should mean.
 *
 * The alternative would be threading every screen's tab, scope and sub-screen
 * up into App as props, which spreads one screen's business across two files
 * and grows every time a screen gains a mode. This keeps the state where it is
 * used and simply remembers it between mounts.
 *
 * Deliberately not persisted to disk: it is where you were in the session, not
 * a setting. Coming back to the app tomorrow should start you somewhere
 * predictable rather than wherever you happened to stop.
 */
const store = new Map<string, unknown>();

export function useStickyState<T>(key: string, initial: T | (() => T)): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(() => {
    if (store.has(key)) return store.get(key) as T;
    return typeof initial === 'function' ? (initial as () => T)() : initial;
  });

  const set = useCallback((next: T) => {
    store.set(key, next);
    setValue(next);
  }, [key]);

  return [value, set];
}

/** Forgets everything. Used when the data underneath it stops being true. */
export function clearScreenState() {
  store.clear();
}
