import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Delete, Eye, Lock, LockOpen } from 'lucide-react';
import { ON_PRIMARY, PRIMARY, SECTION_COLOR } from '../ui';

/** Analytics' own colour, so the lock screen belongs to the section it guards. */
const ACCENT = SECTION_COLOR.analytics;
const DANGER = '#F9624E';
const GOOD = '#63D07F';

/**
 * The placeholder shown where the figures would be, with the way in.
 *
 * A single small "Unlock" button in the middle of an empty screen read as an
 * error state. This says what is behind the lock and invites the tap.
 */
export function LockedRevenue({ onUnlock }: { onUnlock: () => void }) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-[18px]">
      <motion.span
        className="flex items-center justify-center rounded-[20px]"
        style={{ width: 76, height: 76, background: `${ACCENT}1a`, border: `1px solid ${ACCENT}44` }}
        animate={{ scale: [1, 1.04, 1] }}
        transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
      >
        <Lock size={32} style={{ color: ACCENT }} />
      </motion.span>

      <div className="text-center">
        <p className="text-[var(--app-text)] text-[19px] font-bold leading-[24px]">
          Revenue is locked
        </p>
        <p className="text-[var(--app-text-muted)] text-[14px] leading-[19px] mt-[4px] max-w-[380px]">
          Takings, profit and margin are hidden until the PIN is entered. History &middot; Orders
          and History &middot; Stock stay open, and Inventory still shows what is on the shelf —
          quantities, without the money.
        </p>
      </div>

      <motion.button
        whileTap={{ scale: 0.97 }}
        onClick={onUnlock}
        data-unlock-revenue
        className="flex items-center gap-[10px] px-[24px] h-[54px] rounded-[13px] font-bold text-[16px]"
        style={{ background: PRIMARY, color: ON_PRIMARY }}
      >
        <LockOpen size={20} /> Enter PIN
      </motion.button>
    </div>
  );
}

/**
 * The PIN pad.
 *
 * A keypad rather than a text field: this is a counter-top touchscreen, and a
 * four-digit code typed on a keyboard that may not be there is the wrong shape.
 * The dots fill as you go, a wrong code shakes and clears itself, and a right
 * one turns green before it closes — so the result is felt, not read.
 */
export function RevenuePinPad({
  open, expected, onSuccess, onClose,
}: {
  open: boolean;
  expected: string;
  onSuccess: () => void;
  onClose: () => void;
}) {
  const [entry, setEntry] = useState('');
  const [state, setState] = useState<'idle' | 'wrong' | 'right'>('idle');
  const max = Math.max(4, expected.length || 4);

  useEffect(() => {
    if (!open) { setEntry(''); setState('idle'); }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Backspace') setEntry(v => v.slice(0, -1));
      if (/^[0-9]$/.test(e.key)) setEntry(v => (v.length >= max ? v : v + e.key));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, max]);

  // Judged as soon as it is long enough — no separate confirm to hunt for.
  //
  // The timer lives in a ref rather than in the effect's cleanup: setting the
  // result state re-runs this effect, and a cleanup would then cancel the very
  // timeout that completes the unlock.
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  useEffect(() => {
    if (!open || state !== 'idle' || entry.length < expected.length) return;
    if (timer.current) clearTimeout(timer.current);
    if (entry === expected) {
      setState('right');
      timer.current = window.setTimeout(onSuccess, 420);
      return;
    }
    setState('wrong');
    timer.current = window.setTimeout(() => { setEntry(''); setState('idle'); }, 620);
  }, [entry, expected, open, state, onSuccess]);

  const press = (key: string) => {
    if (state !== 'idle') return;
    if (key === 'del') { setEntry(v => v.slice(0, -1)); return; }
    setEntry(v => (v.length >= max ? v : v + key));
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[130] flex items-center justify-center"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ duration: 0.14 }}
          style={{ background: 'rgba(6,6,8,0.55)', backdropFilter: 'blur(5px)' }}
          onClick={onClose}
          data-pin-pad
        >
          <motion.div
            onClick={e => e.stopPropagation()}
            initial={{ scale: 0.94, y: 14 }}
            animate={{
              scale: 1,
              y: 0,
              x: state === 'wrong' ? [0, -9, 9, -6, 6, 0] : 0,
            }}
            exit={{ scale: 0.96, opacity: 0 }}
            transition={state === 'wrong'
              ? { duration: 0.34 }
              : { type: 'spring', stiffness: 480, damping: 32 }}
            className="rounded-[20px] border p-[22px] w-[336px]"
            style={{
              background: 'var(--app-bg-darker)',
              borderColor: state === 'wrong' ? DANGER : state === 'right' ? GOOD : 'var(--app-border)',
            }}
          >
            <div className="flex flex-col items-center gap-[4px] mb-[18px]">
              <motion.span
                className="flex items-center justify-center rounded-[14px] mb-[6px]"
                style={{
                  width: 52, height: 52,
                  background: state === 'right' ? `${GOOD}22` : state === 'wrong' ? `${DANGER}22` : `${ACCENT}1a`,
                }}
                animate={{ rotate: state === 'right' ? [0, -8, 0] : 0 }}
              >
                {state === 'right'
                  ? <LockOpen size={24} style={{ color: GOOD }} />
                  : <Eye size={24} style={{ color: state === 'wrong' ? DANGER : ACCENT }} />}
              </motion.span>
              <span className="text-[var(--app-text)] text-[17px] font-bold">
                {state === 'right' ? 'Unlocked' : state === 'wrong' ? 'Not that one' : 'Revenue PIN'}
              </span>
              <span className="text-[var(--app-text-muted)] text-[12px]">
                {state === 'wrong' ? 'Try again' : 'Enter to reveal the figures'}
              </span>
            </div>

            {/* Dots */}
            <div className="flex items-center justify-center gap-[13px] mb-[20px]">
              {Array.from({ length: max }, (_, i) => {
                const filled = i < entry.length;
                return (
                  <motion.span
                    key={i}
                    className="rounded-full"
                    animate={{
                      width: filled ? 15 : 11,
                      height: filled ? 15 : 11,
                      backgroundColor: state === 'wrong' ? DANGER
                        : state === 'right' ? GOOD
                          : filled ? ACCENT : 'var(--app-bg-tertiary)',
                    }}
                    transition={{ type: 'spring', stiffness: 620, damping: 24 }}
                  />
                );
              })}
            </div>

            {/* Keypad */}
            <div className="grid grid-cols-3 gap-[9px]">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'].map((key, i) => (
                key === '' ? <span key={i} /> : (
                  <motion.button
                    key={key}
                    whileTap={{ scale: 0.93 }}
                    onClick={() => press(key)}
                    data-pin-key={key}
                    className="h-[58px] rounded-[13px] text-[22px] font-semibold flex items-center justify-center border transition-colors duration-150 hover:border-[color:var(--sec)]"
                    style={{
                      background: 'var(--app-surface)',
                      borderColor: 'var(--app-border)',
                      color: key === 'del' ? 'var(--app-text-muted)' : 'var(--app-text)',
                    }}
                  >
                    {key === 'del' ? <Delete size={22} /> : key}
                  </motion.button>
                )
              ))}
            </div>

            <button
              onClick={onClose}
              data-pin-cancel
              className="w-full mt-[14px] h-[42px] rounded-[11px] text-[14px] font-semibold text-[var(--app-text-muted)] transition-colors hover:text-[var(--app-text)]"
            >
              Cancel
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
