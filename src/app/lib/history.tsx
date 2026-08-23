import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from 'react';
import { ConfirmDialog, useToast } from '../ui';

/**
 * Undo and redo for the whole program.
 *
 * What was here before only ever knew about one thing: it kept a stack of
 * snapshots of the orders array, so Ctrl+Z could take back a ticket move and
 * nothing else. Adding a stock item, renaming a category, changing the tax rate
 * or emptying a cart were all one-way doors, which is a bad property for
 * software being operated at speed by someone who is also cooking.
 *
 * The replacement stores *actions* rather than snapshots. Each one carries the
 * two functions that put the world back and forward again, captured at the
 * moment it happened with whatever values it needs already closed over. That
 * buys three things a snapshot stack could not have:
 *
 *  · Different kinds of state can share one stack. A stock adjustment and a
 *    menu rename sit next to each other and undo in the order they were done.
 *  · Undo can be *asymmetric*, which the stock ledger requires. Taking back a
 *    delivery must not delete the line that recorded it — it appends a
 *    correcting line, so what is on the shelf and what the history says
 *    happened never disagree. Only an action knows how to reverse itself
 *    properly; a snapshot would just overwrite.
 *  · An action can refuse, or ask first. Anything touching money says what it
 *    is about to undo and waits to be told to go ahead.
 */

export type UndoScope = 'board' | 'cart' | 'stock' | 'menu' | 'settings' | 'session' | 'costs';

export interface UndoableAction {
  /**
   * What was done, in the past tense, naming the thing: "Moved #014 to the
   * grill", "Added 2 crates of Buns". This is read back to the user when the
   * action is undone, so a vague label makes the shortcut a guess.
   */
  label: string;
  scope: UndoScope;
  /**
   * Set on anything money-adjacent. Undoing or redoing asks this question
   * first rather than acting on a keystroke.
   */
  confirm?: string;
  /**
   * Runs of the same edit collapse into one step.
   *
   * Typing a menu item's name fires a change per keystroke, and eleven
   * undo steps to take back the word "Cheeseburger" is not undo, it is
   * punishment. Consecutive actions sharing a key, close together in time,
   * merge: the oldest way back is kept and the newest way forward, so the
   * single remaining step spans the whole run.
   */
  coalesceKey?: string;
  undo: () => void | Promise<void>;
  redo: () => void | Promise<void>;
}

interface Entry extends UndoableAction {
  id: number;
  at: number;
}

interface HistoryApi {
  record: (action: UndoableAction) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** Labels for the buttons' tooltips, so they say what they will do. */
  nextUndoLabel: string | null;
  nextRedoLabel: string | null;
  /** Wipes the stack — used when the underlying data is replaced wholesale. */
  reset: () => void;
}

const Ctx = createContext<HistoryApi | null>(null);

export function useHistory(): HistoryApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useHistory must be used inside a HistoryProvider');
  return ctx;
}

/** How many steps back it is possible to go. Deep enough to cover a mistake
 *  noticed a few actions later, shallow enough that the closures held alive by
 *  the stack never amount to anything. */
const DEPTH = 60;

/** How long a run of the same edit stays open to merging. */
const COALESCE_MS = 1800;

export function HistoryProvider({ children }: { children: ReactNode }) {
  const [past, setPast] = useState<Entry[]>([]);
  const [future, setFuture] = useState<Entry[]>([]);
  const [pending, setPending] = useState<{ entry: Entry; direction: 'undo' | 'redo' } | null>(null);
  const nextId = useRef(1);
  const toast = useToast();

  const record = useCallback((action: UndoableAction) => {
    const now = Date.now();
    setPast(prev => {
      const top = prev[prev.length - 1];
      if (
        action.coalesceKey
        && top?.coalesceKey === action.coalesceKey
        && now - top.at < COALESCE_MS
      ) {
        const merged: Entry = { ...action, undo: top.undo, id: top.id, at: now };
        return [...prev.slice(0, -1), merged];
      }
      return [...prev.slice(-(DEPTH - 1)), { ...action, id: nextId.current++, at: now }];
    });
    // Doing something new invalidates the branch that was undone away from.
    setFuture([]);
  }, []);

  const perform = useCallback(async (entry: Entry, direction: 'undo' | 'redo') => {
    try {
      await (direction === 'undo' ? entry.undo() : entry.redo());
    } catch (error) {
      console.error(`Failed to ${direction}:`, error);
      toast.show(`Could not ${direction} that`, {
        kind: 'danger',
        detail: 'Nothing was changed. The step is still in the list.',
      });
      // Put it back where it came from — a failed reversal must not silently
      // swallow the step, or the next Ctrl+Z skips over a mistake.
      if (direction === 'undo') setPast(prev => [...prev, entry]);
      else setFuture(prev => [entry, ...prev]);
      return;
    }
    if (direction === 'undo') {
      setFuture(prev => [entry, ...prev]);
      toast.show(`Undone — ${entry.label.toLowerCase()}`, { kind: 'undo', detail: 'Ctrl+Y puts it back.' });
    } else {
      setPast(prev => [...prev, entry]);
      toast.show(`Redone — ${entry.label.toLowerCase()}`, { kind: 'undo' });
    }
  }, [toast]);

  const undo = useCallback(() => {
    setPast(prev => {
      if (prev.length === 0) {
        toast.show('Nothing to undo', { kind: 'info' });
        return prev;
      }
      const entry = prev[prev.length - 1];
      if (entry.confirm) setPending({ entry, direction: 'undo' });
      else void perform(entry, 'undo');
      return prev.slice(0, -1);
    });
  }, [perform, toast]);

  const redo = useCallback(() => {
    setFuture(prev => {
      if (prev.length === 0) {
        toast.show('Nothing to redo', { kind: 'info' });
        return prev;
      }
      const entry = prev[0];
      if (entry.confirm) setPending({ entry, direction: 'redo' });
      else void perform(entry, 'redo');
      return prev.slice(1);
    });
  }, [perform, toast]);

  const reset = useCallback(() => {
    setPast([]);
    setFuture([]);
    setPending(null);
  }, []);

  /**
   * The keyboard binding.
   *
   * It deliberately keeps its hands off text fields: inside an input, Ctrl+Z
   * means "take back what I just typed", and stealing it there to revert a
   * ticket move would be both surprising and destructive. The browser's own
   * text history is the right behaviour in that one place.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;

      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return;
      }

      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if (key === 'y' || (key === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  const api = useMemo<HistoryApi>(() => ({
    record,
    undo,
    redo,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
    nextUndoLabel: past.length > 0 ? past[past.length - 1].label : null,
    nextRedoLabel: future.length > 0 ? future[0].label : null,
    reset,
  }), [record, undo, redo, past, future, reset]);

  return (
    <Ctx.Provider value={api}>
      {children}
      <ConfirmDialog
        open={pending !== null}
        destructive
        title={pending?.direction === 'redo' ? 'Do this again?' : 'Undo this?'}
        description={pending?.entry.confirm}
        confirmLabel={pending?.direction === 'redo' ? 'Do it again' : 'Undo it'}
        cancelLabel="Leave it"
        onCancel={() => {
          // Cancelling has to put the step back on the stack it was taken from,
          // or declining once would quietly lose the ability to undo it later.
          if (pending) {
            if (pending.direction === 'undo') setPast(prev => [...prev, pending.entry]);
            else setFuture(prev => [pending.entry, ...prev]);
          }
          setPending(null);
        }}
        onConfirm={() => {
          if (pending) void perform(pending.entry, pending.direction);
          setPending(null);
        }}
      />
    </Ctx.Provider>
  );
}

/**
 * Records an action whose reversal is simply "put these values back".
 *
 * Most state in the app is a plain React array or scalar, and for those the
 * inverse really is a pair of setter calls. Stock is the exception and does not
 * use this — see `useStockHistory` in App.tsx.
 */
export function restoreAction<T>(
  label: string,
  scope: UndoScope,
  before: T,
  after: T,
  apply: (value: T) => void,
  confirm?: string,
  coalesceKey?: string,
): UndoableAction {
  return {
    label,
    scope,
    confirm,
    coalesceKey,
    undo: () => apply(before),
    redo: () => apply(after),
  };
}
