/**
 * One set of movements for the whole app.
 *
 * The complaint these answer is that some things animated and some did not, so
 * the program felt half-finished — a button that lights up next to one that
 * snaps reads as a bug rather than as two styles. Every interactive primitive
 * pulls its motion from here, which means "everything responds" is enforced by
 * construction rather than by remembering.
 */

import { useEffect, useState } from 'react';
import type { Transition } from 'motion/react';

/* ------------------------------------------------------------------ springs */

/** Controls, taps, anything the finger is touching right now. */
export const SNAP: Transition = { type: 'spring', stiffness: 620, damping: 34, mass: 0.55 };
/** Layout moves — a ticket changing section, a panel resizing. */
export const GLIDE: Transition = { type: 'spring', stiffness: 380, damping: 32 };
/** Large surfaces entering or leaving. Slower, so it does not feel snatched. */
export const SETTLE: Transition = { type: 'spring', stiffness: 260, damping: 30 };

/* ----------------------------------------------------------------- tweening */

export const DURATION = {
  instant: 0.09,
  fast: 0.14,
  base: 0.2,
  slow: 0.32,
} as const;

/** The house easing curve. Fast out of the gate, long tail — reads as weight. */
export const EASE = [0.22, 1, 0.36, 1] as const;

export const fade = (duration: number = DURATION.base): Transition => ({ duration, ease: EASE });

/* ------------------------------------------------------------- interactions */

/** What a control does under the finger. */
export const PRESS = { scale: 0.97 } as const;
export const PRESS_SOFT = { scale: 0.985 } as const;
/** What a card does when the pointer is over it. */
export const HOVER_LIFT = { y: -2 } as const;

/* ----------------------------------------------------------- page transition */

/**
 * Sections cross-dissolve with a small push in the direction of travel.
 *
 * The old code swapped views with no animation at all, on the reasoning that
 * cross-fading two opaque pages let the background flash through between them.
 * That is true of a symmetric fade; it is not true when the outgoing page holds
 * full opacity until the incoming one is painted over it, which is what the
 * `mode="popLayout"` + higher z-index on the entering page buys.
 */
export const pageVariants = {
  initial: { opacity: 0, scale: 0.985, y: 10 },
  animate: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 1.004, y: -6 },
};

export const pageTransition: Transition = { duration: DURATION.base, ease: EASE };

/* ------------------------------------------------------------------ staging */

/** Children appear one after another rather than all at once. */
export const stagger = (each = 0.035, delay = 0): Transition => ({
  staggerChildren: each,
  delayChildren: delay,
});

export const riseIn = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
};

/* ---------------------------------------------------------- reduced motion */

/**
 * Honoured everywhere. Somebody who has asked their machine for less movement
 * has asked this program too, and the answer cannot be "except in Analytics".
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(prefersReducedMotion);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

/** Strips a transition down to nothing when movement is unwanted. */
export function respect(reduced: boolean, transition: Transition): Transition {
  return reduced ? { duration: 0 } : transition;
}
