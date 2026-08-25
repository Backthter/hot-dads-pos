import {
  forwardRef, useId, useState,
  type ButtonHTMLAttributes, type CSSProperties, type InputHTMLAttributes,
  type ReactNode,
} from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Check, ChevronDown, Minus, Plus } from 'lucide-react';
import { useSection } from './SectionTheme';
import { Tooltip } from './Tooltip';
import { Popover, PopoverItem } from './Popover';
import {
  DANGER, ELEVATION, GLASS, ON_PRIMARY, PRIMARY, RADIUS, SIZE, alpha, readableOn, shade,
} from './tokens';
import { DURATION, EASE, GLIDE, HOVER_LIFT, PRESS, SNAP, useReducedMotion } from './motion';

/**
 * The shared vocabulary. Every screen builds from these, which is the whole
 * point: the old app had four different ideas of what a button looked like and
 * three of what a panel was, and the inconsistency read — accurately — as
 * unfinished rather than as variety.
 *
 * Two rules hold throughout:
 *  · Anything you can press responds to hover, to focus and to the press
 *    itself. No exceptions, because a control that does not respond reads as
 *    broken next to one that does.
 *  · Colour comes from the section unless the control is a primary action or
 *    carries a fixed meaning like danger.
 */

/* ------------------------------------------------------------------ Button */

export type ButtonVariant =
  /** The action that commits. Always the app's amber, in every section. */
  | 'primary'
  /** The section's own colour, filled. For the main action *within* a screen. */
  | 'section'
  /** A resting control: neutral surface, section colour on hover. */
  | 'secondary'
  /** Outline only until touched. */
  | 'ghost'
  /** Text and icon, no chrome. For tertiary actions inside dense rows. */
  | 'quiet'
  /** Destructive. Always red, everywhere. */
  | 'danger';

export type ButtonSize = 'sm' | 'md' | 'lg';

const SIZING: Record<ButtonSize, { height: number; padding: number; font: number; gap: number; radius: number }> = {
  sm: { height: SIZE.controlSm, padding: 12, font: 13, gap: 6, radius: RADIUS.sm },
  md: { height: SIZE.control, padding: 17, font: 15, gap: 9, radius: RADIUS.md },
  lg: { height: SIZE.controlLg, padding: 22, font: 16, gap: 10, radius: RADIUS.lg },
};

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'title' | 'onAnimationStart' | 'onDragStart' | 'onDragEnd' | 'onDrag'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Leading icon. Sized automatically to match the label. */
  icon?: ReactNode;
  /** Trailing icon — a chevron, a count. */
  trailing?: ReactNode;
  /** Marks a toggle-style button as on. */
  active?: boolean;
  /** Fills the width of its container. */
  block?: boolean;
  /** Plain-language explanation, shown on hover and on long press. */
  hint?: string;
  /** Overrides the section colour for this one control. */
  tone?: string;
  children?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({
  variant = 'secondary', size = 'md', icon, trailing, active = false, block = false,
  hint, tone, children, style, disabled, className = '', ...rest
}, ref) {
  const section = useSection();
  const reduced = useReducedMotion();
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const metrics = SIZING[size];

  const accent = tone ?? (variant === 'primary' ? PRIMARY : variant === 'danger' ? DANGER : section.color);
  const lit = hover || active || focus;

  const skin = ((): CSSProperties => {
    switch (variant) {
      case 'primary':
        return {
          background: `linear-gradient(135deg, ${shade(PRIMARY, 0.2)} 0%, ${PRIMARY} 60%, ${shade(PRIMARY, -0.1)} 100%)`,
          color: ON_PRIMARY,
          border: '1px solid transparent',
          boxShadow: lit ? `0 0 0 4px ${alpha(PRIMARY, 0.2)}, ${ELEVATION.low}` : ELEVATION.low,
        };
      case 'section':
        return {
          background: tone
            ? `linear-gradient(135deg, ${shade(accent, 0.22)} 0%, ${accent} 55%, ${shade(accent, -0.14)} 100%)`
            : section.gradient,
          color: readableOn(accent),
          border: '1px solid transparent',
          boxShadow: lit ? `0 0 0 4px ${alpha(accent, 0.2)}, ${ELEVATION.low}` : ELEVATION.low,
        };
      case 'danger':
        return {
          background: lit
            ? `linear-gradient(135deg, ${shade(DANGER, 0.16)} 0%, ${DANGER} 100%)`
            : alpha(DANGER, 0.14),
          color: lit ? readableOn(DANGER) : DANGER,
          border: `1px solid ${lit ? DANGER : alpha(DANGER, 0.4)}`,
          boxShadow: focus ? `0 0 0 4px ${alpha(DANGER, 0.22)}` : 'none',
        };
      case 'ghost':
        return {
          background: lit ? alpha(accent, 0.13) : 'transparent',
          color: lit ? accent : 'var(--app-text-secondary)',
          border: `1px solid ${lit ? alpha(accent, 0.55) : 'transparent'}`,
          boxShadow: focus ? `0 0 0 4px ${alpha(accent, 0.2)}` : 'none',
        };
      case 'quiet':
        return {
          background: hover ? alpha(accent, 0.1) : 'transparent',
          color: active ? accent : hover ? accent : 'var(--app-text-secondary)',
          border: '1px solid transparent',
          boxShadow: focus ? `0 0 0 4px ${alpha(accent, 0.2)}` : 'none',
        };
      default:
        return {
          background: active
            ? alpha(accent, 0.16)
            : hover
              ? `linear-gradient(135deg, ${alpha(shade(accent, 0.25), 0.2)} 0%, ${alpha(accent, 0.08)} 100%), var(--app-surface)`
              : 'var(--app-surface)',
          color: lit ? accent : 'var(--app-text)',
          border: `1px solid ${active ? accent : lit ? alpha(accent, 0.5) : 'var(--app-border)'}`,
          boxShadow: focus ? `0 0 0 4px ${alpha(accent, 0.2)}` : 'none',
        };
    }
  })();

  const button = (
    <motion.button
      ref={ref}
      type="button"
      disabled={disabled}
      onHoverStart={() => setHover(true)}
      onHoverEnd={() => setHover(false)}
      onFocus={() => setFocus(true)}
      onBlur={() => setFocus(false)}
      whileTap={disabled || reduced ? undefined : PRESS}
      transition={reduced ? { duration: 0 } : SNAP}
      className={`relative inline-flex items-center justify-center font-semibold select-none outline-none ${className}`}
      style={{
        height: metrics.height,
        paddingInline: children ? metrics.padding : 0,
        width: block ? '100%' : children ? undefined : metrics.height,
        gap: metrics.gap,
        fontSize: metrics.font,
        borderRadius: metrics.radius,
        opacity: disabled ? 0.36 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
        transitionProperty: 'background-color, background-image, border-color, color, box-shadow',
        transitionDuration: `${DURATION.fast * 1000}ms`,
        ...skin,
        ...style,
      }}
      {...rest}
    >
      {icon}
      {/* Children go inside a flex row of their own rather than a plain span.
          Tailwind's reset makes `svg { display: block }`, so a caller that
          passes its own icon as part of the label — `<Button><Plus /> Add</Button>`
          — used to get the icon stacked on top of the words. */}
      {children && (
        <span className="flex items-center min-w-0 truncate" style={{ gap: metrics.gap }}>
          {children}
        </span>
      )}
      {trailing}
    </motion.button>
  );

  return hint ? <Tooltip label={hint}>{button}</Tooltip> : button;
});

/** A square button holding nothing but an icon. */
export const IconButton = forwardRef<HTMLButtonElement, Omit<ButtonProps, 'children' | 'trailing'>>(
  function IconButton(props, ref) {
    return <Button ref={ref} {...props} />;
  },
);

/* ------------------------------------------------------------------- Panel */

/**
 * A titled container. One shape, one rule under the heading, everywhere.
 *
 * The rule is tinted with the section colour rather than drawn in grey: it is
 * the cheapest way to make a screen read as belonging somewhere, and it costs
 * no vertical space.
 */
export function Panel({
  title, subtitle, actions, children, className = '', padded = true, style, ...rest
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  padded?: boolean;
  style?: CSSProperties;
} & Omit<React.HTMLAttributes<HTMLDivElement>, 'title'>) {
  return (
    <div
      className={`flex flex-col min-h-0 rounded-[14px] border border-[var(--app-border)] ${className}`}
      style={{
        background: `${GLASS.panel.background}, var(--app-bg-darker)`,
        boxShadow: ELEVATION.low,
        padding: padded ? 14 : 0,
        ...style,
      }}
      {...rest}
    >
      {(title || actions) && (
        <div
          className="flex items-baseline gap-[10px] pb-[9px] mb-[11px] border-b"
          style={{ borderColor: 'var(--sec-line, var(--app-border))', paddingInline: padded ? 0 : 14, paddingTop: padded ? 0 : 12 }}
        >
          {title && (
            <span className="text-[var(--app-text-muted)] text-[11px] uppercase tracking-[0.7px] font-bold">
              {title}
            </span>
          )}
          {subtitle && (
            <span className="text-[var(--app-text-muted)] text-[11px] truncate min-w-0">{subtitle}</span>
          )}
          <span className="ml-auto flex items-center gap-[6px] shrink-0">{actions}</span>
        </div>
      )}
      {children}
    </div>
  );
}

/**
 * A settings-style row: a heading, an explanation, and one control on the right.
 * Settings used to hand-roll this shape nine times with nine sets of spacing.
 */
export function SettingRow({
  title, description, control, children, footer,
}: {
  title: string;
  description?: ReactNode;
  control?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <Panel style={{ padding: 18 }}>
      <div className="flex items-start justify-between gap-[18px]">
        <div className="min-w-0">
          <h3 className="text-[var(--app-text)] text-[17px] font-bold leading-[22px]">{title}</h3>
          {description && (
            <p className="text-[var(--app-text-secondary)] text-[13px] leading-[19px] mt-[4px] max-w-[62ch]">
              {description}
            </p>
          )}
        </div>
        {control && <div className="shrink-0 flex items-center gap-[8px]">{control}</div>}
      </div>
      {children && <div className="mt-[14px] pt-[14px] border-t border-[var(--app-border)]">{children}</div>}
      {footer}
    </Panel>
  );
}

/* ------------------------------------------------------------------ inputs */

/**
 * Capitalises the first letter of a value as it is typed.
 *
 * Menu items, categories, stock and session names are all proper nouns in
 * practice — "burger" is a thing, "Burger" is a line on a menu — and every one
 * of them was being typed lowercase and then fixed by hand, or not fixed at
 * all, which is how a menu ends up half sentence case.
 *
 * Only the first character, and only ever upward: it never touches the rest of
 * what somebody wrote, so "iPhone case" and "pack of 6" survive intact.
 */
export function capitalizeFirst(value: string): string {
  if (!value) return value;
  const first = value[0];
  return first === first.toUpperCase() ? value : first.toUpperCase() + value.slice(1);
}

export interface TextInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  /** Shown above the field. */
  label?: string;
  /** Plain-language help, shown under the field. */
  hint?: string;
  /** Turns the field red and shows the message. */
  error?: string;
  icon?: ReactNode;
  block?: boolean;
  /**
   * Capitalise the first letter as it is typed. On by default for ordinary
   * text; off automatically for passwords and anything numeric, where a
   * capital would be meaningless or actively wrong.
   */
  capitalize?: boolean;
}

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput({
  label, hint, error, icon, block = true, capitalize, className = '', style,
  onChange, onFocus, onBlur, ...rest
}, ref) {
  const section = useSection();
  const [focus, setFocus] = useState(false);
  const id = useId();
  const accent = error ? DANGER : section.color;

  const numeric = rest.inputMode === 'numeric' || rest.inputMode === 'decimal' || rest.type === 'number';
  const secret = rest.type === 'password' || rest.type === 'email';
  const autoCaps = capitalize ?? (!numeric && !secret);

  return (
    <div className={`flex flex-col gap-[6px] ${block ? 'w-full' : ''}`}>
      {label && (
        <label htmlFor={id} className="text-[var(--app-text-secondary)] text-[12px] font-semibold uppercase tracking-[0.5px]">
          {label}
        </label>
      )}
      <div
        className="flex items-center gap-[9px] rounded-[11px] px-[13px]"
        style={{
          height: SIZE.control,
          background: 'var(--app-bg-darker)',
          border: `1px solid ${focus || error ? accent : 'var(--app-border)'}`,
          boxShadow: focus ? `0 0 0 4px ${alpha(accent, 0.2)}` : 'none',
          transition: `border-color ${DURATION.fast}s, box-shadow ${DURATION.fast}s`,
        }}
      >
        {icon && <span className="shrink-0 text-[var(--app-text-muted)] flex">{icon}</span>}
        {/*
          The spread comes first and the handlers after it, deliberately. The
          other way round — which is how this was first written — meant a
          caller's own `onChange` silently replaced the one below, and the
          capitalisation never ran on any field that had a handler, which is
          all of them.
        */}
        <input
          {...rest}
          ref={ref}
          id={id}
          onFocus={e => { setFocus(true); onFocus?.(e); }}
          onBlur={e => { setFocus(false); onBlur?.(e); }}
          onChange={e => {
            if (autoCaps) {
              const fixed = capitalizeFirst(e.target.value);
              if (fixed !== e.target.value) {
                // The node's own value is rewritten, not just the copy handed
                // upward: the field is controlled, so the parent has to receive
                // the corrected string or the next render puts the lowercase
                // letter straight back. Rewriting moves the caret to the end,
                // so it is put back where the typist left it.
                const caret = e.target.selectionStart;
                e.target.value = fixed;
                if (caret !== null) e.target.setSelectionRange(caret, caret);
              }
            }
            onChange?.(e);
          }}
          className={`flex-1 min-w-0 bg-transparent text-[var(--app-text)] text-[15px] placeholder:text-[var(--app-text-muted)] focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${className}`}
          style={style}
        />
      </div>
      {error
        ? <span className="text-[13px]" style={{ color: DANGER }}>{error}</span>
        : hint && <span className="text-[var(--app-text-muted)] text-[12px] leading-[16px]">{hint}</span>}
    </div>
  );
});

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  /** A second line, for when the label alone is ambiguous. */
  detail?: string;
  /**
   * How far to indent, for a list whose options contain one another — an event
   * and the sessions inside it.
   *
   * Presentation only. It says nothing about what selecting the option does,
   * and a child is selected exactly like a parent; the indent is there because
   * a flat list of events and sessions never showed which sessions belonged to
   * which market. Omitted or 0 is a top-level row.
   */
  depth?: number;
}

export interface SelectProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: SelectOption<T>[];
  label?: string;
  hint?: string;
  placeholder?: string;
  block?: boolean;
  disabled?: boolean;
}

/**
 * A dropdown, built out of the same popover every other menu in the app uses.
 *
 * It was a restyled native `<select>`, on the reasoning that the platform's own
 * picker is bigger and scrolls better with a thumb. That is true on a phone. It
 * is not true here: this runs in a desktop webview, where the native menu is a
 * small grey list drawn by the operating system in the operating system's
 * colours, ignoring the interface scale and looking nothing like the program
 * around it. Every other menu in the app already had a better surface — the
 * only reason this one did not use it was that it came from a different phase
 * of the project.
 */
export function Select<T extends string>({
  value, onChange, options, label, hint, placeholder = 'Choose…', block = true, disabled = false,
}: SelectProps<T>) {
  const section = useSection();
  const id = useId();
  const current = options.find(o => o.value === value);

  return (
    <div className={`flex flex-col gap-[6px] ${block ? 'w-full' : ''}`}>
      {label && (
        <span id={id} className="text-[var(--app-text-secondary)] text-[12px] font-semibold uppercase tracking-[0.5px]">
          {label}
        </span>
      )}
      <Popover
        width={280}
        maxHeight={320}
        align="left"
        label={label}
        trigger={({ open, toggle }) => (
          <button
            type="button"
            role="combobox"
            aria-expanded={open}
            aria-labelledby={label ? id : undefined}
            disabled={disabled}
            onClick={toggle}
            className="flex items-center gap-[9px] w-full rounded-[11px] pl-[13px] pr-[11px] outline-none"
            style={{
              height: SIZE.control,
              background: 'var(--app-bg-darker)',
              border: `1px solid ${open ? section.color : 'var(--app-border)'}`,
              boxShadow: open ? `0 0 0 4px ${alpha(section.color, 0.2)}` : 'none',
              opacity: disabled ? 0.4 : 1,
              cursor: disabled ? 'not-allowed' : 'pointer',
              transition: `border-color ${DURATION.fast}s, box-shadow ${DURATION.fast}s`,
            }}
          >
            <span
              className="flex-1 min-w-0 truncate text-left text-[15px]"
              style={{ color: current ? 'var(--app-text)' : 'var(--app-text-muted)' }}
            >
              {current?.label ?? placeholder}
            </span>
            <motion.span
              animate={{ rotate: open ? 180 : 0 }}
              transition={{ duration: DURATION.fast, ease: EASE }}
              className="flex shrink-0"
              style={{ color: open ? section.color : 'var(--app-text-muted)' }}
            >
              <ChevronDown size={17} />
            </motion.span>
          </button>
        )}
      >
        {close => (
          <>
            {options.length === 0 && (
              <span className="px-[11px] py-[9px] text-[var(--app-text-muted)] text-[13px]">
                Nothing to choose from yet.
              </span>
            )}
            {options.map(option => (
              <div key={option.value} style={{ paddingLeft: (option.depth ?? 0) * 20 }}>
                <PopoverItem
                  title={option.label}
                  detail={option.detail}
                  selected={option.value === value}
                  onClick={() => { onChange(option.value); close(); }}
                  data-select-option={option.value}
                  data-select-depth={option.depth ?? 0}
                />
              </div>
            ))}
          </>
        )}
      </Popover>
      {hint && <span className="text-[var(--app-text-muted)] text-[12px] leading-[16px]">{hint}</span>}
    </div>
  );
}

/** A number with a minus and a plus either side. Easier than a keyboard on a
 *  touchscreen, and the only stepper shape in the app. */
export function NumberStepper({
  value, onChange, min = 0, max = 9999, step = 1, width = 76, hint,
}: {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  step?: number;
  width?: number;
  hint?: string;
}) {
  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  return (
    <div className="flex items-center gap-[8px]" title={hint}>
      <IconButton
        variant="secondary"
        size="sm"
        aria-label="Decrease"
        onClick={() => onChange(clamp(value - step))}
        disabled={value <= min}
        icon={<Minus size={16} />}
      />
      <input
        type="text"
        inputMode="numeric"
        value={String(value)}
        onChange={e => {
          const parsed = parseFloat(e.target.value);
          if (Number.isFinite(parsed)) onChange(clamp(parsed));
          else if (e.target.value === '') onChange(min);
        }}
        className="text-[var(--app-text)] text-[16px] font-bold text-center rounded-[10px] focus:outline-none tabular-nums"
        style={{
          width,
          height: SIZE.controlSm,
          background: 'var(--app-bg-darker)',
          border: '1px solid var(--app-border)',
        }}
      />
      <IconButton
        variant="secondary"
        size="sm"
        aria-label="Increase"
        onClick={() => onChange(clamp(value + step))}
        disabled={value >= max}
        icon={<Plus size={16} />}
      />
    </div>
  );
}

/** An on/off switch. One shape for every setting in the program. */
export function Toggle({
  checked, onChange, label, disabled = false, tone, size = 'md',
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: string;
  disabled?: boolean;
  tone?: string;
  /** `sm` for dense lists, where a full-size switch on every row shouts. */
  size?: 'sm' | 'md';
}) {
  const reduced = useReducedMotion();
  // Deliberately not the section colour: "on" is a state, not decoration, and
  // Settings' graphite made a switch that was on look like one that was off.
  const accent = tone ?? PRIMARY;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="relative inline-flex items-center shrink-0 rounded-full outline-none focus-visible:ring-4"
      style={{
        width: size === 'sm' ? 42 : 52,
        height: size === 'sm' ? 24 : 30,
        padding: 3,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        background: checked
          ? `linear-gradient(135deg, ${shade(accent, 0.2)} 0%, ${accent} 100%)`
          : 'var(--app-bg-tertiary)',
        boxShadow: checked ? `0 0 0 1px ${alpha(accent, 0.5)}, 0 0 14px -4px ${alpha(accent, 0.7)}` : 'inset 0 0 0 1px var(--app-border)',
        transition: `background ${DURATION.base}s, box-shadow ${DURATION.base}s`,
      }}
    >
      <motion.span
        layout
        transition={reduced ? { duration: 0 } : GLIDE}
        className="block rounded-full bg-white"
        style={{
          width: size === 'sm' ? 18 : 24,
          height: size === 'sm' ? 18 : 24,
          marginLeft: checked ? (size === 'sm' ? 18 : 22) : 0,
          boxShadow: '0 2px 5px rgba(0,0,0,0.35)',
        }}
      />
    </button>
  );
}

/** A row of mutually exclusive choices. Replaces four different tab styles. */
export function SegmentedControl<T extends string | number>({
  value, options, onChange, size = 'md', block = false,
}: {
  value: T;
  options: { value: T; label: ReactNode; icon?: ReactNode; hint?: string }[];
  onChange: (next: T) => void;
  size?: ButtonSize;
  block?: boolean;
}) {
  const section = useSection();
  const reduced = useReducedMotion();
  const groupId = useId();
  const height = SIZING[size].height;

  return (
    <div
      className={`inline-flex items-center gap-[3px] p-[3px] rounded-[13px] ${block ? 'w-full' : ''}`}
      style={{ background: 'var(--app-bg-darker)', border: '1px solid var(--app-border)' }}
      role="tablist"
    >
      {options.map(option => {
        const active = option.value === value;
        const content = (
          <button
            key={String(option.value)}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={`relative flex items-center justify-center gap-[7px] px-[14px] font-semibold outline-none ${block ? 'flex-1' : ''}`}
            style={{
              height: height - 8,
              fontSize: SIZING[size].font - 1,
              borderRadius: 10,
              color: active ? section.on : 'var(--app-text-secondary)',
              transition: `color ${DURATION.fast}s`,
              cursor: 'pointer',
            }}
          >
            {active && (
              <motion.span
                layoutId={`segment-${groupId}`}
                transition={reduced ? { duration: 0 } : GLIDE}
                className="absolute inset-0 rounded-[10px]"
                style={{ background: section.gradient, boxShadow: `0 2px 10px -3px ${section.glow}` }}
              />
            )}
            <span className="relative flex items-center gap-[7px] whitespace-nowrap">
              {option.icon}
              {option.label}
            </span>
          </button>
        );
        return option.hint
          ? <Tooltip key={String(option.value)} label={option.hint}>{content}</Tooltip>
          : content;
      })}
    </div>
  );
}

/* ------------------------------------------------------------------- misc */

export function Badge({
  children, tone, icon, pulse = false,
}: { children: ReactNode; tone?: string; icon?: ReactNode; pulse?: boolean }) {
  const section = useSection();
  const accent = tone ?? section.color;
  const reduced = useReducedMotion();
  return (
    <motion.span
      className="inline-flex items-center gap-[6px] px-[10px] h-[26px] rounded-full text-[12px] font-bold whitespace-nowrap"
      style={{ background: alpha(accent, 0.16), color: accent, border: `1px solid ${alpha(accent, 0.36)}` }}
      animate={pulse && !reduced ? { opacity: [0.72, 1] } : undefined}
      transition={pulse ? { duration: 1.6, repeat: Infinity, repeatType: 'mirror', ease: 'easeInOut' } : undefined}
    >
      {icon}
      {children}
    </motion.span>
  );
}

/** What a screen shows when there is nothing to show. Always this shape. */
export function EmptyState({
  icon, title, description, action, compact = false,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  compact?: boolean;
}) {
  const section = useSection();
  return (
    <div
      className="flex flex-col items-center justify-center text-center rounded-[14px] border border-dashed w-full"
      style={{
        padding: compact ? '20px 16px' : '38px 24px',
        gap: 9,
        borderColor: alpha(section.color, 0.24),
        background: `linear-gradient(135deg, ${alpha(section.color, 0.07)} 0%, ${alpha(section.color, 0.02)} 100%)`,
      }}
    >
      {icon && <span style={{ color: section.color, opacity: 0.85 }}>{icon}</span>}
      <p className="text-[var(--app-text)] text-[15px] font-semibold">{title}</p>
      {description && (
        <p className="text-[var(--app-text-muted)] text-[13px] leading-[18px] max-w-[46ch]">{description}</p>
      )}
      {action && <div className="mt-[6px]">{action}</div>}
    </div>
  );
}

/** A heading for a screen or a major block within one. */
export function ScreenHeading({
  title, subtitle, actions, icon,
}: { title: string; subtitle?: string; actions?: ReactNode; icon?: ReactNode }) {
  const section = useSection();
  return (
    <div className="flex items-center gap-[14px] mb-[18px] pb-[14px] border-b" style={{ borderColor: section.line }}>
      {icon && (
        <span
          className="flex items-center justify-center rounded-[12px] shrink-0"
          style={{ width: 44, height: 44, background: section.soft, color: section.color }}
        >
          {icon}
        </span>
      )}
      <div className="min-w-0">
        <h1 className="text-[var(--app-text)] text-[24px] font-bold leading-[30px] truncate">{title}</h1>
        {subtitle && <p className="text-[var(--app-text-secondary)] text-[14px] leading-[19px] mt-[1px]">{subtitle}</p>}
      </div>
      <div className="ml-auto flex items-center gap-[10px] shrink-0">{actions}</div>
    </div>
  );
}

/** A confirmation that happens in place: the label swaps for a tick. */
export function useFlash(duration = 1000) {
  const [flash, setFlash] = useState<string | null>(null);
  const fire = (message: string) => {
    setFlash(message);
    window.setTimeout(() => setFlash(current => (current === message ? null : current)), duration);
  };
  return { flash, fire };
}

export function FlashLabel({ flash, children }: { flash: string | null; children: ReactNode }) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      {flash ? (
        <motion.span
          key="flash"
          className="flex items-center gap-[6px]"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: DURATION.fast, ease: EASE }}
        >
          <Check size={16} /> {flash}
        </motion.span>
      ) : (
        <motion.span
          key="label"
          className="flex items-center gap-[6px]"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: DURATION.fast, ease: EASE }}
        >
          {children}
        </motion.span>
      )}
    </AnimatePresence>
  );
}

/** A card that lifts under the pointer. For grids of pressable things. */
export function LiftCard({
  children, onClick, className = '', style, active = false, ...rest
}: {
  children: ReactNode;
  onClick?: () => void;
  className?: string;
  style?: CSSProperties;
  active?: boolean;
} & Record<string, unknown>) {
  const section = useSection();
  const reduced = useReducedMotion();
  const [hover, setHover] = useState(false);
  return (
    <motion.button
      type="button"
      onClick={onClick}
      onHoverStart={() => setHover(true)}
      onHoverEnd={() => setHover(false)}
      whileHover={reduced ? undefined : HOVER_LIFT}
      whileTap={reduced ? undefined : PRESS}
      transition={reduced ? { duration: 0 } : SNAP}
      className={`relative text-left rounded-[14px] border overflow-hidden ${className}`}
      style={{
        background: hover || active
          ? `${section.gradientSoft}, var(--app-bg-darker)`
          : `${GLASS.panel.background}, var(--app-bg-darker)`,
        borderColor: active ? section.color : hover ? section.line : 'var(--app-border)',
        boxShadow: hover ? ELEVATION.mid : ELEVATION.low,
        transitionProperty: 'background-color, border-color, box-shadow',
        transitionDuration: `${DURATION.fast * 1000}ms`,
        ...style,
      }}
      {...rest}
    >
      {children}
    </motion.button>
  );
}
