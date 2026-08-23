import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from 'react';

/**
 * One back button for the whole program.
 *
 * Back means one thing everywhere: undo the last thing that changed what is on
 * screen — whatever kind of thing it was. That covers three cases, and the
 * first version only handled one of them:
 *
 *  1. A panel or sub-screen is open. It closes.
 *  2. A tab inside a section changed. It goes back to the previous tab, so
 *     Sales → Costs → back lands on Sales rather than throwing you out to the
 *     main menu.
 *  3. Neither. The section closes and you return to wherever you came from.
 *
 * All three live on one stack, in the order they happened, so back walks your
 * actual path rather than a guess at it.
 */

export type View = 'home' | 'orderMode' | 'allOrders' | 'settings' | 'analytics' | 'inventory';

/** A step you can be returned to. */
interface Step {
  kind: 'view' | 'state';
  /** For a view step, where to go back to. */
  view?: View;
  /** For a state step — a tab, a filter — how to put it back. */
  restore?: () => void;
  /** Plain language for the back button's label. */
  label: string;
  /**
   * Which screen the step belongs to. Leaving a section drops its state steps:
   * restoring a tab in a screen you are no longer looking at would be
   * meaningless, and worse, would make back appear to do nothing.
   */
  owner: View;
}

interface Handler {
  token: number;
  label: string;
  run: () => void;
}

interface NavigationApi {
  view: View;
  /** Moves to a section, remembering where you came from. */
  navigate: (view: View) => void;
  /** Moves without adding a step — for redirects that are not a journey. */
  replace: (view: View) => void;
  back: () => void;
  canGoBack: boolean;
  backLabel: string;
  /** Registers what "back" means while some part of a screen is open. */
  pushHandler: (label: string, run: () => void) => () => void;
  /**
   * Records a change *within* a screen — a tab, a mode — so back can undo it.
   * Call it with what the screen looked like before the change.
   */
  pushStep: (label: string, restore: () => void) => void;
}

const Ctx = createContext<NavigationApi | null>(null);

export function useNavigation(): NavigationApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useNavigation must be used inside a NavigationProvider');
  return ctx;
}

const VIEW_LABEL: Record<View, string> = {
  home: 'the main menu',
  orderMode: 'Order Mode',
  allOrders: 'All Orders',
  settings: 'Settings',
  analytics: 'Analytics',
  inventory: 'Inventory',
};

/** Deep enough to walk back through a session's worth of wandering. */
const DEPTH = 40;

export function NavigationProvider({
  initial = 'home', children, onViewChange,
}: {
  initial?: View;
  children: ReactNode;
  onViewChange?: (view: View) => void;
}) {
  /**
   * View and stack move together, in one piece of state.
   *
   * They used to be two, with the stack pushed from inside the view's own
   * `setState` updater — an updater with a side effect in it, which React is
   * free to run twice, and does in development. That is how the same screen
   * ended up on the stack twice and how back could appear to do nothing.
   */
  const [{ view, stack }, setNav] = useState<{ view: View; stack: Step[] }>({
    view: initial,
    stack: [],
  });

  const handlers = useRef<Handler[]>([]);
  const nextToken = useRef(1);
  /** Bumped when the open-panel handlers change, purely so the label updates. */
  const [handlerVersion, setHandlerVersion] = useState(0);

  const pushHandler = useCallback((label: string, run: () => void) => {
    const token = nextToken.current++;
    handlers.current = [...handlers.current, { token, label, run }];
    setHandlerVersion(v => v + 1);
    return () => {
      handlers.current = handlers.current.filter(h => h.token !== token);
      setHandlerVersion(v => v + 1);
    };
  }, []);

  const pushStep = useCallback((label: string, restore: () => void) => {
    setNav(current => ({
      view: current.view,
      stack: [...current.stack.slice(-(DEPTH - 1)), {
        kind: 'state', restore, label, owner: current.view,
      }],
    }));
  }, []);

  const navigate = useCallback((next: View) => {
    setNav(current => {
      if (next === current.view) return current;
      return {
        view: next,
        stack: [...current.stack.slice(-(DEPTH - 1)), {
          kind: 'view', view: current.view, label: VIEW_LABEL[current.view], owner: current.view,
        }],
      };
    });
  }, []);

  const replace = useCallback((next: View) => {
    setNav(current => (next === current.view ? current : { view: next, stack: current.stack }));
  }, []);

  const back = useCallback(() => {
    // Anything open closes first, and does not touch the stack — closing a
    // panel is not a journey.
    const deepest = handlers.current[handlers.current.length - 1];
    if (deepest) {
      deepest.run();
      return;
    }

    setNav(current => {
      const stack = [...current.stack];

      while (stack.length > 0) {
        const step = stack.pop()!;

        if (step.kind === 'state') {
          // A tab in a screen you have since left cannot be restored in any
          // meaningful way, so it is dropped rather than acted on.
          if (step.owner !== current.view) continue;
          step.restore?.();
          return { view: current.view, stack };
        }

        const target = step.view ?? 'home';
        // Leaving a screen invalidates every in-screen step it owned.
        return { view: target, stack: stack.filter(s => !(s.kind === 'state' && s.owner === current.view)) };
      }

      return { view: current.view === 'home' ? 'home' : 'home', stack: [] };
    });
  }, []);

  // Report view changes as an effect rather than from inside an updater, so it
  // fires once per actual change and never during render.
  const reportedView = useRef(view);
  useEffect(() => {
    if (reportedView.current !== view) {
      reportedView.current = view;
      onViewChange?.(view);
    }
  }, [view, onViewChange]);

  // Alt+Left is what every other program on the machine uses for back.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && e.key === 'ArrowLeft') {
        e.preventDefault();
        back();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [back]);

  const api = useMemo<NavigationApi>(() => {
    const deepest = handlers.current[handlers.current.length - 1];

    // The next step back is the newest one that still belongs somewhere.
    let next: Step | undefined;
    for (let i = stack.length - 1; i >= 0; i--) {
      const step = stack[i];
      if (step.kind === 'state' && step.owner !== view) continue;
      next = step;
      break;
    }

    const canGoBack = Boolean(deepest) || Boolean(next) || view !== 'home';
    const backLabel = deepest
      ? `Close ${deepest.label}`
      : next
        ? `Back to ${next.label}`
        : view === 'home' ? 'Already at the main menu' : `Back to ${VIEW_LABEL.home}`;

    return { view, navigate, replace, back, canGoBack, backLabel, pushHandler, pushStep };
    // `handlerVersion` is what makes the label recompute when a panel opens.

  }, [view, stack, navigate, replace, back, pushHandler, pushStep, handlerVersion]);

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

/**
 * Declares what back should do while some part of a screen is open.
 *
 * Call it unconditionally and let `active` decide — a hook that only sometimes
 * runs is a hook that eventually runs in the wrong order.
 */
export function useBackHandler(active: boolean, label: string, run: () => void) {
  const { pushHandler } = useNavigation();
  const runRef = useRef(run);
  runRef.current = run;

  useEffect(() => {
    if (!active) return;
    return pushHandler(label, () => runRef.current());
  }, [active, label, pushHandler]);
}

/**
 * A tab, or any other in-screen mode, that back can step through.
 *
 * Returns a setter to use instead of the raw one. Changing the tab through it
 * records where you were, so back returns you there rather than closing the
 * whole section — the difference between Sales → Costs → back landing on Sales
 * and landing on the main menu.
 */
export function useTabStep<T>(
  value: T,
  setValue: (next: T) => void,
  label: (value: T) => string,
): (next: T) => void {
  const { pushStep } = useNavigation();
  const valueRef = useRef(value);
  valueRef.current = value;

  return useCallback((next: T) => {
    const previous = valueRef.current;
    if (next === previous) return;
    pushStep(label(previous), () => setValue(previous));
    setValue(next);
  }, [pushStep, setValue, label]);
}
