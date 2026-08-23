import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, Check, Info, Undo2 } from 'lucide-react';
import { DURATION, EASE, SNAP, useReducedMotion } from './motion';
import { DANGER, ELEVATION, GLASS, SUCCESS, WARNING, alpha } from './tokens';

/**
 * A short line telling you what just happened.
 *
 * Global undo needs this more than anything else in the app did: pressing
 * Ctrl+Z somewhere other than the board has to say *what* it undid, or the
 * shortcut is a guess. It is equally the honest way to refuse — an action that
 * cannot be taken back should say so rather than silently doing nothing.
 */

type ToastKind = 'info' | 'success' | 'warning' | 'danger' | 'undo';

interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
  detail?: string;
}

interface ToastApi {
  show: (message: string, options?: { kind?: ToastKind; detail?: string; duration?: number }) => void;
}

const Ctx = createContext<ToastApi>({ show: () => {} });

export function useToast(): ToastApi {
  return useContext(Ctx);
}

const TONE: Record<ToastKind, string> = {
  info: '#8AB4F8',
  success: SUCCESS,
  warning: WARNING,
  danger: DANGER,
  undo: '#C4B5FD',
};

function iconFor(kind: ToastKind) {
  if (kind === 'success') return <Check size={17} />;
  if (kind === 'warning' || kind === 'danger') return <AlertTriangle size={17} />;
  if (kind === 'undo') return <Undo2 size={17} />;
  return <Info size={17} />;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const reduced = useReducedMotion();

  const show = useCallback<ToastApi['show']>((message, options) => {
    const id = nextId.current++;
    const item: ToastItem = { id, kind: options?.kind ?? 'info', message, detail: options?.detail };
    // Only ever a couple on screen. A stack of them during a rush is noise, and
    // the newest is always the one that matters.
    setItems(prev => [...prev.slice(-2), item]);
    window.setTimeout(() => {
      setItems(prev => prev.filter(t => t.id !== id));
    }, options?.duration ?? 2600);
  }, []);

  const api = useMemo(() => ({ show }), [show]);

  return (
    <Ctx.Provider value={api}>
      {children}
      {typeof document !== 'undefined' && createPortal(
        <div className="fixed left-1/2 -translate-x-1/2 bottom-[26px] z-[350] flex flex-col items-center gap-[8px] pointer-events-none">
          <AnimatePresence initial={false}>
            {items.map(item => (
              <motion.div
                key={item.id}
                layout
                initial={{ opacity: 0, y: 18, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.97 }}
                transition={reduced ? { duration: 0 } : SNAP}
                className="flex items-center gap-[11px] rounded-[13px] px-[16px] py-[11px] max-w-[440px]"
                style={{
                  background: 'rgba(20,20,25,0.93)',
                  border: `1px solid ${alpha(TONE[item.kind], 0.4)}`,
                  boxShadow: ELEVATION.mid,
                  ...GLASS.floating,
                }}
              >
                <span style={{ color: TONE[item.kind] }} className="shrink-0 flex">
                  {iconFor(item.kind)}
                </span>
                <span className="min-w-0">
                  <span className="block text-[#F2F2F6] text-[14px] font-semibold leading-[18px]">
                    {item.message}
                  </span>
                  {item.detail && (
                    <span className="block text-[#A6A6B2] text-[12px] leading-[16px] mt-[1px]">
                      {item.detail}
                    </span>
                  )}
                </span>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>,
        document.body,
      )}
    </Ctx.Provider>
  );
}

/** Kept exported so a screen can animate its own inline confirmations to match. */
export const TOAST_TRANSITION = { duration: DURATION.base, ease: EASE };
