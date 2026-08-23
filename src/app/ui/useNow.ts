import { useCallback, useSyncExternalStore } from 'react';

/**
 * The current time, as a value that actually changes.
 *
 * Analytics captured `Date.now()` at render time and then never looked again.
 * `resolveScope` defaulted `now` to it, `foodCost` took it as a default
 * parameter — but no dependency array contained it, so nothing recomputed
 * unless the orders or the scope changed. A "Today" range froze at whatever
 * time the screen was opened, and revenue per trading hour did not move during
 * a live service, which is precisely when somebody is watching it.
 *
 * This is one clock for the whole program, not a timer per hook call. Two
 * timers drift, so two figures on the same screen can disagree about what time
 * it is; and the count of timers would grow with the number of consumers,
 * which is the wrong shape for something a till leaves open all day.
 *
 * It ticks only while the window is visible. A laptop lid closed for six hours
 * must not wake to seven hundred queued ticks — the timer is stopped while
 * hidden, so waking is one read of the clock and one render.
 */

/** Coarse on purpose. Every consumer's dependency array pays for each tick. */
export const DEFAULT_INTERVAL_MS = 30_000;

/** A floor, so no caller can turn this into an animation loop by accident. */
const MIN_INTERVAL_MS = 1_000;

let now = Date.now();

/** Listener → the interval that listener asked for. */
const subscribers = new Map<() => void, number>();

let timerId: number | null = null;
/** The interval the running timer was started with, so it is only restarted
 *  when the shortest requested interval actually changes. */
let timerInterval = 0;
let watchingVisibility = false;

function isHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

function tick(): void {
  const next = Date.now();
  if (next === now) return;
  now = next;
  // Copied, because a listener is free to unsubscribe while being notified.
  for (const listener of [...subscribers.keys()]) listener();
}

/**
 * The interval the shared timer should be running at, or null when it should
 * not be running at all.
 *
 * The fastest request wins. A consumer that asked for 30s and gets 5s is being
 * told the time more often than it needed, which is harmless; the reverse is
 * not, so the minimum is the only safe answer.
 */
function desiredInterval(): number | null {
  if (subscribers.size === 0 || isHidden()) return null;
  let shortest = Number.POSITIVE_INFINITY;
  for (const ms of subscribers.values()) {
    if (ms < shortest) shortest = ms;
  }
  return Math.max(MIN_INTERVAL_MS, shortest);
}

function reconcileTimer(): void {
  const wanted = desiredInterval();

  if (wanted === null) {
    if (timerId !== null) {
      clearInterval(timerId);
      timerId = null;
      timerInterval = 0;
    }
    return;
  }

  if (timerId !== null && timerInterval === wanted) return;
  if (timerId !== null) clearInterval(timerId);
  timerInterval = wanted;
  timerId = setInterval(tick, wanted) as unknown as number;
}

function handleVisibilityChange(): void {
  // Coming back is a resync, not a catch-up: nothing accumulated while the
  // timer was stopped, so reading the clock once is the whole of it.
  if (!isHidden()) tick();
  reconcileTimer();
}

function subscribe(listener: () => void, intervalMs: number): () => void {
  subscribers.set(listener, intervalMs);

  if (!watchingVisibility && typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', handleVisibilityChange);
    watchingVisibility = true;
  }

  // The clock stops when the last consumer leaves, so the first one back may
  // be looking at a value from hours ago. Refresh it — but only when this is
  // the only subscriber, because notifying the others from inside a subscribe
  // call would tear a render that is already in progress. React re-reads the
  // snapshot immediately after subscribing, so this listener still sees it.
  if (subscribers.size === 1) now = Date.now();

  reconcileTimer();

  return () => {
    subscribers.delete(listener);
    reconcileTimer();
  };
}

function getSnapshot(): number {
  return now;
}

/**
 * Subscribes to the shared clock and returns the current time in milliseconds.
 *
 * `intervalMs` is a request, not a guarantee: the shared timer runs at the
 * shortest interval anybody asked for, so a consumer may be told the time more
 * often than it asked to be. It is never told less often.
 *
 * Pass the result explicitly into anything that would otherwise call
 * `Date.now()` for itself, and put it in the dependency array of the memos that
 * genuinely depend on the current time — and only those. Adding `now` to an
 * expensive computation that does not depend on it means recomputing it on
 * every tick for no change in the answer.
 */
export function useNow(intervalMs: number = DEFAULT_INTERVAL_MS): number {
  const subscribeAtInterval = useCallback(
    (listener: () => void) => subscribe(listener, intervalMs),
    [intervalMs],
  );
  return useSyncExternalStore(subscribeAtInterval, getSnapshot, getSnapshot);
}
