import { useEffect, useRef, useState, type ReactNode } from 'react';
import { animate, motion, useMotionValue } from 'motion/react';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import {
  ELEVATION, GLASS, InfoDot, SECTION_COLOR, SERIES as TOKEN_SERIES, Tooltip,
  DANGER as TOKEN_DANGER, MUTED as TOKEN_MUTED, SUCCESS, alpha, useSection,
  DURATION, GLIDE, SETTLE, useReducedMotion,
} from '../ui';

/**
 * Analytics' own charts and figures.
 *
 * The general-purpose parts of this file — its panel, its accent — have gone to
 * `../ui`. The accent is the reason: it was hard-coded amber, so every bar,
 * every ranked row and every highlighted figure in the section was drawn in
 * orange while the section itself, and the tile that opened it, were purple.
 * Nothing here picks a colour any more; it asks the section it is mounted in.
 */

/** Kept for the handful of imports that still name it. It is the section's. */
export const ACCENT = SECTION_COLOR.analytics;
export const DANGER = TOKEN_DANGER;
export const GOOD = SUCCESS;
export const MUTED = TOKEN_MUTED;
/** Series colours, ordered so the first few stay distinguishable. */
export const SERIES = TOKEN_SERIES;

export const money = (n: number) => `Rs ${Math.round(n).toLocaleString()}`;
export const compactMoney = (n: number) =>
  Math.abs(n) >= 100000 ? `Rs ${(n / 1000).toFixed(0)}k` : money(n);

export function RollingNumber({ value, format }: { value: number; format: (n: number) => string }) {
  const mv = useMotionValue(value);
  const [shown, setShown] = useState(value);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; mv.set(value); setShown(value); return; }
    const controls = animate(mv, value, {
      duration: 0.45, ease: [0.22, 1, 0.36, 1], onUpdate: v => setShown(v),
    });
    return () => controls.stop();
  }, [value, mv]);
  return <>{format(shown)}</>;
}

/**
 * A KPI with its comparison and its definition.
 *
 * The definition is not decoration. "Revenue" means six different things
 * depending on whether tax and discounts are in or out, and a number nobody can
 * pin down is a number nobody trusts.
 */
export function KpiCard({
  label, value, format, previous, definition, tone, unavailable, onClick,
}: {
  label: string;
  value: number;
  format: (n: number) => string;
  previous?: number;
  definition: string;
  tone?: string;
  /** Shown instead of the value when the figure genuinely cannot be computed. */
  unavailable?: string;
  onClick?: () => void;
}) {
  const theme = useSection();
  const reduced = useReducedMotion();
  const [hover, setHover] = useState(false);
  const delta = previous !== undefined && previous !== 0
    ? ((value - previous) / Math.abs(previous)) * 100
    : undefined;
  const direction = delta === undefined ? 'flat' : delta > 0.5 ? 'up' : delta < -0.5 ? 'down' : 'flat';

  return (
    <motion.div
      layout
      onClick={onClick}
      onHoverStart={() => setHover(true)}
      onHoverEnd={() => setHover(false)}
      whileHover={onClick && !reduced ? { y: -2 } : undefined}
      transition={reduced ? { duration: 0 } : GLIDE}
      data-kpi={label}
      className="relative rounded-[14px] border p-[14px] flex flex-col gap-[6px] overflow-hidden"
      style={{
        cursor: onClick ? 'pointer' : 'default',
        background: hover && onClick
          ? `${theme.gradientSoft}, var(--app-bg-darker)`
          : `${GLASS.panel.background}, var(--app-bg-darker)`,
        borderColor: hover && onClick ? theme.line : 'var(--app-border)',
        boxShadow: hover && onClick ? ELEVATION.mid : ELEVATION.low,
        transitionProperty: 'background-image, border-color, box-shadow',
        transitionDuration: `${DURATION.fast * 1000}ms`,
      }}
    >
      <div className="flex items-center gap-[5px]">
        <span className="text-[var(--app-text-muted)] text-[11px] uppercase tracking-[0.6px] font-bold truncate">
          {label}
        </span>
        <span data-kpi-info={label}><InfoDot label={definition} size={12} /></span>
      </div>

      {unavailable ? (
        <span className="text-[var(--app-text-muted)] text-[15px] font-semibold leading-[24px]">
          {unavailable}
        </span>
      ) : (
        <span
          className="text-[24px] font-bold leading-[28px] tabular-nums truncate"
          style={{ color: tone ?? 'var(--app-text)' }}
        >
          <RollingNumber value={value} format={format} />
        </span>
      )}

      {delta !== undefined && !unavailable && (
        <span
          className="flex items-center gap-[4px] text-[12px] font-semibold"
          style={{ color: direction === 'up' ? GOOD : direction === 'down' ? DANGER : MUTED }}
        >
          {direction === 'up' ? <ArrowUpRight size={13} />
            : direction === 'down' ? <ArrowDownRight size={13} /> : <Minus size={13} />}
          {Math.abs(delta).toFixed(1)}%
          <span className="text-[var(--app-text-muted)] font-normal">vs previous</span>
        </span>
      )}

    </motion.div>
  );
}

export function Panel({
  title, subtitle, children, actions, className = '',
}: {
  title: string; subtitle?: string; children: ReactNode; actions?: ReactNode; className?: string;
}) {
  const theme = useSection();
  return (
    <div
      className={`rounded-[14px] border border-[var(--app-border)] p-[14px] flex flex-col min-h-0 ${className}`}
      style={{ background: `${GLASS.panel.background}, var(--app-bg-darker)`, boxShadow: ELEVATION.low }}
    >
      <div
        className="flex items-baseline gap-[10px] pb-[9px] mb-[11px] border-b"
        style={{ borderColor: theme.line }}
      >
        <span className="text-[var(--app-text-muted)] text-[11px] uppercase tracking-[0.7px] font-bold">
          {title}
        </span>
        {subtitle && (
          <span className="text-[var(--app-text-muted)] text-[11px] truncate min-w-0">{subtitle}</span>
        )}
        <span className="ml-auto flex items-center gap-[6px] shrink-0">{actions}</span>
      </div>
      {children}
    </div>
  );
}

/**
 * A column chart drawn as divs.
 *
 * Deliberately not a charting library: the data is a couple of dozen buckets,
 * and hand-drawn bars keep the type, spacing and colour identical to everything
 * around them. A library would arrive with its own opinions about all three.
 */
export function BarChart({
  data, format, height = 150, highlight,
}: {
  data: { label: string; value: number; key?: string | number }[];
  format: (n: number) => string;
  height?: number;
  highlight?: (index: number) => boolean;
}) {
  const theme = useSection();
  const reduced = useReducedMotion();
  const max = Math.max(1, ...data.map(d => d.value));
  if (data.length === 0) {
    return (
      <p className="text-[var(--app-text-muted)] text-[12px] py-[24px] text-center">
        Nothing was sold in this period.
      </p>
    );
  }
  // Bar heights are in pixels, not percentages. A percentage resolves against
  // a parent whose height is itself content-derived, which collapses the whole
  // chart to a hairline the moment there is only one bucket.
  const plot = Math.max(24, height - 34);

  return (
    <div className="flex items-end gap-[3px] w-full" style={{ height }}>
      {data.map((d, i) => (
        <div key={d.key ?? d.label} className="flex-1 min-w-0 flex flex-col items-center justify-end gap-[5px] group h-full">
          <span className="text-[10px] tabular-nums opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap"
            style={{ color: 'var(--app-text-secondary)' }}>
            {format(d.value)}
          </span>
          <Tooltip label={`${d.label} — ${format(d.value)}`}>
            <motion.div
              className="w-full rounded-t-[5px] max-w-[64px] cursor-default"
              initial={reduced ? false : { height: 0 }}
              animate={{ height: Math.max(3, (d.value / max) * plot) }}
              whileHover={{ opacity: 1 }}
              transition={reduced ? { duration: 0 } : { ...SETTLE, delay: Math.min(0.3, i * 0.01) }}
              style={{
                background: highlight?.(i)
                  ? `linear-gradient(180deg, ${theme.color} 0%, ${alpha(theme.color, 0.72)} 100%)`
                  : `linear-gradient(180deg, ${alpha(theme.color, 0.5)} 0%, ${alpha(theme.color, 0.24)} 100%)`,
                boxShadow: highlight?.(i) ? `0 0 14px -4px ${theme.glow}` : 'none',
              }}
              data-bar={d.label}
            />
          </Tooltip>
          <span className="text-[9px] text-[var(--app-text-muted)] truncate w-full text-center">
            {d.label}
          </span>
        </div>
      ))}
    </div>
  );
}

/** A ranked list with a proportional bar behind each row. */
export function RankedRows({
  rows, format, emptyLabel = 'Nothing to rank yet.', onPick,
}: {
  rows: { label: string; value: number; sub?: string }[];
  format: (n: number) => string;
  emptyLabel?: string;
  onPick?: (label: string) => void;
}) {
  const theme = useSection();
  const reduced = useReducedMotion();
  const max = Math.max(1, ...rows.map(r => r.value));
  if (rows.length === 0) {
    return <p className="text-[var(--app-text-muted)] text-[12px] py-[12px]">{emptyLabel}</p>;
  }
  return (
    <div className="flex flex-col gap-[3px] overflow-auto">
      {rows.map(row => (
        <button
          key={row.label}
          onClick={() => onPick?.(row.label)}
          data-ranked-row={row.label}
          className="group relative flex items-center gap-[8px] rounded-[9px] px-[10px] h-[34px] text-left overflow-hidden"
          style={{ cursor: onPick ? 'pointer' : 'default' }}
        >
          <motion.span
            className="absolute inset-y-0 left-0 rounded-[9px] group-hover:opacity-100"
            initial={reduced ? false : { width: 0 }}
            animate={{ width: `${(row.value / max) * 100}%` }}
            transition={reduced ? { duration: 0 } : GLIDE}
            style={{
              background: `linear-gradient(90deg, ${alpha(theme.color, 0.26)} 0%, ${alpha(theme.color, 0.08)} 100%)`,
            }}
          />
          <span
            className="absolute inset-0 rounded-[9px] opacity-0 group-hover:opacity-100 pointer-events-none"
            style={{ border: `1px solid ${theme.line}`, transition: `opacity ${DURATION.fast}s` }}
          />
          <span className="relative text-[var(--app-text)] text-[13px] font-medium truncate">
            {row.label}
          </span>
          {row.sub && (
            <span className="relative text-[var(--app-text-muted)] text-[11px] truncate">{row.sub}</span>
          )}
          <span className="relative ml-auto text-[13px] font-semibold tabular-nums"
            style={{ color: 'var(--app-text-secondary)' }}>
            {format(row.value)}
          </span>
        </button>
      ))}
    </div>
  );
}
