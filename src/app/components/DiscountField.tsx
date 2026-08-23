import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Check, Lock, X } from 'lucide-react';
import { formatDiscount, parseDiscount } from '../lib/orders';
import type { Discount } from '../types';
import { HINT, SECTION_COLOR, Tooltip } from '../ui';

interface DiscountFieldProps {
  subtotal: number;
  discount?: Discount;
  discountAmount: number;
  onApply: (discount: Discount) => void;
  onClear: () => void;
  /** Reports the unconfirmed value so the totals breakdown can preview it. */
  onPreviewChange?: (amount: number) => void;
  disabled?: boolean;
  /** When set, applying a discount asks for the revenue PIN first. */
  requirePin?: boolean;
  onRequestPin?: (onGranted: () => void) => void;
}

const BOX_H = 46;

export function DiscountField({
  subtotal,
  discount,
  discountAmount,
  onApply,
  onClear,
  onPreviewChange,
  disabled = false,
  requirePin = false,
  onRequestPin,
}: DiscountFieldProps) {
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  const parsed = parseDiscount(input, subtotal);
  const preview = parsed.ok === true ? parsed : null;
  const canApply = !disabled && preview !== null;
  // Bad input explains itself as you type, rather than staying silent until you
  // press apply and nothing happens.
  const message = error ?? (parsed.ok === false ? parsed.reason : null);

  // Keep the totals breakdown in step with the unconfirmed value.
  const reportRef = useRef(onPreviewChange);
  reportRef.current = onPreviewChange;
  useEffect(() => {
    reportRef.current?.(preview?.amount ?? 0);
  }, [preview?.amount]);
  useEffect(() => () => reportRef.current?.(0), []);

  // A discount cleared elsewhere (new order, session switch) resets the field.
  useEffect(() => {
    if (!discount) {
      setInput('');
      setError(null);
    }
  }, [discount]);

  const doApply = () => {
    if (!preview) return;
    onApply(preview.discount);
    setInput('');
    setError(null);
  };

  const handleApply = () => {
    if (!canApply) {
      if (parsed.ok === false) setError(parsed.reason);
      return;
    }
    if (requirePin && onRequestPin) {
      onRequestPin(doApply);
      return;
    }
    doApply();
  };

  // Applied state — collapsed chip.
  if (discount) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.94 }}
        animate={{ opacity: 1, scale: 1 }}
        className="flex flex-col items-center justify-center rounded-[8px] border px-[10px] shrink-0"
        style={{ height: BOX_H, borderColor: '#15D2B2', background: 'rgba(21,210,178,0.08)' }}
      >
        <p className="text-[#0fa88a] text-[8px] uppercase tracking-[0.5px] leading-[10px] mb-[3px]">
          Off {formatDiscount(discount)}
        </p>
        <div className="flex items-center gap-[5px]">
          <span className="text-[#0fa88a] text-[15px] font-semibold leading-none tabular-nums">
            −{discountAmount.toFixed(0)}
          </span>
          <Tooltip label={HINT.clearDiscount}>
            <button
              onClick={onClear}
              aria-label="Remove the discount"
              className="p-[2px] rounded-[5px] text-[#0fa88a] hover:bg-[rgba(21,210,178,0.18)] transition-colors"
            >
              <X size={12} />
            </button>
          </Tooltip>
        </div>
      </motion.div>
    );
  }

  return (
    <Tooltip label={HINT.discount}>
    <div
      className="flex items-stretch rounded-[9px] border overflow-hidden bg-[var(--app-order-card)] shrink-0"
      style={{
        height: BOX_H,
        borderColor: message ? '#F9624E' : 'var(--app-order-border)',
        opacity: disabled ? 0.45 : 1,
      }}
    >
      <div className="flex flex-col items-center justify-center px-[8px]">
        <p
          className="text-[8px] uppercase tracking-[0.5px] leading-[10px] mb-[3px] flex items-center gap-[3px]"
          style={{ color: message ? '#F9624E' : 'var(--app-text-muted)' }}
        >
          {message ?? 'Discount'}
          {requirePin && !message && <Lock size={7} />}
        </p>
        <input
          type="text"
          inputMode="decimal"
          value={input}
          disabled={disabled}
          onChange={e => {
            setInput(e.target.value);
            setError(null);
          }}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleApply();
            }
          }}
          placeholder="–"
          className="bg-transparent text-[var(--app-order-text)] text-[15px] font-semibold text-center w-[52px] focus:outline-none placeholder:text-[var(--app-text-muted)]"
        />
      </div>
      <button
        onClick={handleApply}
        disabled={!canApply}
        aria-label="Apply the discount"
        className="w-[30px] flex items-center justify-center border-l transition-colors disabled:cursor-not-allowed"
        style={{
          borderColor: 'var(--app-order-border)',
          background: canApply ? SECTION_COLOR.order : 'transparent',
          color: canApply ? '#04312f' : 'var(--app-text-muted)',
          opacity: canApply ? 1 : 0.4,
        }}
      >
        <Check size={15} />
      </button>
    </div>
    </Tooltip>
  );
}
