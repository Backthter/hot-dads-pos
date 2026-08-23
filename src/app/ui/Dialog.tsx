import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle } from 'lucide-react';
import { Button } from './primitives';
import { DURATION, EASE, SNAP, useReducedMotion } from './motion';
import { DANGER, ELEVATION, GLASS, alpha } from './tokens';

/**
 * Every modal in the app.
 *
 * There were five hand-rolled ones before — the close prompt, the discount PIN,
 * the revenue PIN, the sold-out prompt and the wipe confirmation — with five
 * different paddings, three different backdrops and no shared escape handling.
 * The glass here is the one place it earns its cost: the board behind stays
 * legible enough to keep your bearings while clearly being out of reach.
 */

export function Dialog({
  open, onClose, title, description, icon, tone, children, actions, width = 420, dismissable = true,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  icon?: ReactNode;
  tone?: string;
  children?: ReactNode;
  actions?: ReactNode;
  width?: number;
  /** False for a decision that genuinely has to be made. */
  dismissable?: boolean;
}) {
  const reduced = useReducedMotion();

  useEffect(() => {
    if (!open || !dismissable) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, dismissable]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[300] flex items-center justify-center p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={reduced ? { duration: 0 } : { duration: DURATION.fast, ease: EASE }}
          style={GLASS.scrim}
          onMouseDown={e => { if (dismissable && e.target === e.currentTarget) onClose(); }}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            initial={{ opacity: 0, scale: 0.94, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 6 }}
            transition={reduced ? { duration: 0 } : SNAP}
            className="w-full rounded-[18px] border p-[26px] flex flex-col gap-[18px]"
            style={{
              maxWidth: width,
              background: 'var(--app-bg-darker)',
              borderColor: 'var(--app-border)',
              boxShadow: ELEVATION.high,
            }}
          >
            <div className="flex flex-col items-center text-center gap-[12px]">
              {icon && (
                <span
                  className="flex items-center justify-center rounded-full"
                  style={{
                    width: 54, height: 54,
                    background: alpha(tone ?? '#FFFFFF', 0.12),
                    color: tone ?? 'var(--app-text)',
                  }}
                >
                  {icon}
                </span>
              )}
              <div>
                <p className="text-[var(--app-text)] text-[20px] font-bold leading-[26px]">{title}</p>
                {description && (
                  <p className="text-[var(--app-text-secondary)] text-[14px] leading-[20px] mt-[6px]">
                    {description}
                  </p>
                )}
              </div>
            </div>

            {children}

            {actions && <div className="flex gap-[10px]">{actions}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/**
 * "Are you sure" with one shape and one set of words.
 *
 * `confirmLabel` should say what will happen — "Void order", "Undo the count" —
 * rather than "OK", so the choice can be read without re-reading the question.
 */
export function ConfirmDialog({
  open, onCancel, onConfirm, title, description, confirmLabel = 'Confirm', cancelLabel = 'Cancel', destructive = false,
}: {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}) {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={title}
      description={description}
      tone={destructive ? DANGER : undefined}
      icon={destructive ? <AlertTriangle size={24} /> : undefined}
      actions={
        <>
          <Button variant="secondary" block onClick={onCancel}>{cancelLabel}</Button>
          <Button
            variant={destructive ? 'danger' : 'primary'}
            block
            onClick={onConfirm}
            autoFocus
          >
            {confirmLabel}
          </Button>
        </>
      }
    />
  );
}
