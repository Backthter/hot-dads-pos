import { useCallback, useRef } from 'react';
import { useToast } from '../ui';

/**
 * Says why something cannot be taken back, and what to do instead.
 *
 * Three things sit outside the undo stack on purpose: ringing an order up,
 * saving an edit to a rung-up order, and starting or ending a session. Each
 * settles money or hands out kitchen ticket numbers, and each has a proper
 * reversal that is not Ctrl+Z — voiding the ticket, editing it again, resuming
 * the session.
 *
 * Silence would be worse than the limitation. Pressing Ctrl+Z after ringing an
 * order up and having the *previous* action disappear instead is how somebody
 * loses a ticket move they had not noticed was still on the stack.
 */
export function useNotUndoable() {
  const toast = useToast();
  const explainedOnce = useRef(new Set<string>());

  return useCallback((what: string, instead: string, topic = what) => {
    // The explanation is worth saying, but not on every ticket. After the first
    // time it becomes nagging, so what remains is a plain confirmation that the
    // thing happened.
    const first = !explainedOnce.current.has(topic);
    explainedOnce.current.add(topic);
    toast.show(what, {
      kind: first ? 'warning' : 'success',
      detail: first ? instead : undefined,
      duration: first ? 4600 : 1800,
    });
  }, [toast]);
}

export type ExplainNotUndoable = ReturnType<typeof useNotUndoable>;
