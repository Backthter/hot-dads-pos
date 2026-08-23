import { createPortal } from 'react-dom';
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { motion } from 'motion/react';
import {
  BarChart3, Boxes, ChevronLeft, LayoutGrid, ReceiptText, Redo2, Settings as SettingsIcon,
  ShoppingBasket, ShoppingCart, Undo2,
} from 'lucide-react';
import { useNavigation, type View } from '../lib/navigation';
import { useHistory } from '../lib/history';
import {
  Button, HINT, IconButton, SECTION_COLOR, SECTION_LABEL, Tooltip, alpha, useSection,
  DURATION, GLIDE, useReducedMotion, type SectionId,
} from '../ui';

/**
 * The one permanent strip across the top of the app.
 *
 * It carries four things and always in the same order: how to go back, where
 * you are, what else there is inside where you are, and how to take back what
 * you just did. Sections used to stack a second row of their own tabs
 * underneath — which cost a line of vertical space on every screen and made the
 * bar above look like something unrelated — and only two of them did it at all.
 * Now every section puts its menus in this bar, so the top of the app is one
 * continuous strip whatever screen you are on.
 */

/**
 * Where a section's own tabs go.
 *
 * This used to be a global element id that `NavSlot` looked up with
 * `document.getElementById`. That is fine while exactly one page is mounted —
 * and wrong the moment two are, which is precisely what a cross-fade between
 * sections does. With both pages on screen there were two elements carrying the
 * id, `getElementById` returned the first in document order, and the *outgoing*
 * page won. A moment later it unmounted and took the incoming page's tabs with
 * it: leave Analytics for Inventory, come back, and the tab row was gone.
 *
 * Each page now owns its own host. A page's `NavSlot` can only ever find that
 * page's bar, because that is the only one in scope. No ids, nothing global,
 * and nothing to collide.
 */
const SlotCtx = createContext<{
  node: HTMLElement | null;
  setNode: (el: HTMLElement | null) => void;
} | null>(null);

export function NavSlotHost({ children }: { children: ReactNode }) {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const value = useMemo(() => ({ node, setNode }), [node]);
  return <SlotCtx.Provider value={value}>{children}</SlotCtx.Provider>;
}

const SECTION_ICON: Record<SectionId, ReactNode> = {
  home: <LayoutGrid size={19} />,
  order: <ShoppingCart size={19} />,
  orders: <ReceiptText size={19} />,
  analytics: <BarChart3 size={19} />,
  inventory: <Boxes size={19} />,
  settings: <SettingsIcon size={19} />,
};

export function Navigation({
  section, onOtherBoard, isOrderMode = false,
}: {
  section: SectionId;
  /** Jumps between the two order screens. */
  onOtherBoard: () => void;
  isOrderMode?: boolean;
}) {
  const { back, canGoBack, backLabel, navigate } = useNavigation();
  const history = useHistory();
  const theme = useSection();

  return (
    <div
      className="h-[68px] relative shrink-0 w-full z-30"
      style={{
        background: `linear-gradient(180deg, ${alpha(theme.color, 0.07)} 0%, rgba(0,0,0,0) 100%), var(--app-bg)`,
      }}
    >
      {/* The rule under the bar is the section's colour rather than grey. It is
          the cheapest possible way to say where you are, and it never competes
          with anything for space. */}
      <span
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-px pointer-events-none"
        style={{ background: `linear-gradient(90deg, ${theme.color} 0%, ${alpha(theme.color, 0.16)} 42%, rgba(39,39,42,0.5) 100%)` }}
      />

      <div className="flex flex-row items-center size-full gap-[9px] px-[16px]">
        <Tooltip label={canGoBack ? backLabel : 'Already at the main menu'}>
          <IconButton
            variant="ghost"
            onClick={back}
            disabled={!canGoBack}
            aria-label="Back"
            data-nav-back
            icon={<ChevronLeft size={28} strokeWidth={2.4} />}
          />
        </Tooltip>

        {/* No hover text on these two. The icons say what they are, they never
            change, and an explanation that appears every time the pointer
            crosses the bar is noise rather than help. */}
        <IconButton
          variant={section === 'home' ? 'primary' : 'secondary'}
          onClick={() => navigate('home')}
          aria-label="Home"
          data-nav-home
          icon={<LayoutGrid size={24} strokeWidth={2.3} />}
        />

        <IconButton
          variant="secondary"
          onClick={onOtherBoard}
          aria-label={isOrderMode ? 'All orders' : 'Order mode'}
          data-nav-orders
          tone={isOrderMode ? SECTION_COLOR.orders : SECTION_COLOR.order}
          icon={isOrderMode ? <ReceiptText size={23} strokeWidth={2.2} /> : <ShoppingBasket size={23} strokeWidth={2.2} />}
        />

        {/* Where you are. Reads as a label rather than a control, because it is
            not one — pressing the section you are already in does nothing, and
            a button that does nothing is worse than no button. */}
        {section !== 'home' && (
          <span
            className="hidden lg:flex items-center gap-[9px] pl-[13px] pr-[15px] h-[46px] rounded-[11px] shrink-0 ml-[3px]"
            style={{ background: theme.soft, border: `1px solid ${alpha(theme.color, 0.28)}`, color: theme.color }}
            data-nav-section={section}
          >
            {SECTION_ICON[section]}
            <span className="text-[15px] font-bold whitespace-nowrap">{SECTION_LABEL[section]}</span>
          </span>
        )}

        <NavSlotTarget />

        <span className="w-px h-[30px] shrink-0" style={{ background: 'var(--app-border)' }} />

        {/* Undo and redo, deliberately the smallest controls in the bar.
            They sit next to the section's own tabs and are pressed rarely, so a
            full-size target here mostly catches sleeves and stray thumbs. No
            hover text either — the toast already names what was undone, at the
            moment it matters, which is after the press rather than before it. */}
        <div className="flex items-center gap-[4px] shrink-0" data-history-controls>
          <IconButton
            variant="ghost"
            size="sm"
            onClick={history.undo}
            disabled={!history.canUndo}
            aria-label={history.nextUndoLabel ? `Undo ${history.nextUndoLabel}` : 'Nothing to undo'}
            data-nav-undo
            icon={<Undo2 size={17} strokeWidth={2.3} />}
          />
          <IconButton
            variant="ghost"
            size="sm"
            onClick={history.redo}
            disabled={!history.canRedo}
            aria-label={history.nextRedoLabel ? `Redo ${history.nextRedoLabel}` : 'Nothing to redo'}
            data-nav-redo
            icon={<Redo2 size={17} strokeWidth={2.3} />}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * Renders its children into the permanent bar.
 *
 * A portal rather than props threaded down from App, so each screen keeps its
 * own tab state next to the thing that state controls.
 */
export function NavSlot({ children }: { children: ReactNode }) {
  const slot = useContext(SlotCtx);
  return slot?.node ? createPortal(children, slot.node) : null;
}

/** The bar's own half of the arrangement: it registers the node to portal into. */
function NavSlotTarget() {
  const slot = useContext(SlotCtx);
  return (
    <div
      ref={slot?.setNode}
      data-nav-slot
      className="flex-1 min-w-0 flex items-center justify-end gap-[8px]"
    />
  );
}

/**
 * A menu inside a section, sitting in the permanent bar.
 *
 * The lit state is a moving pill rather than a swapped background, so changing
 * tab reads as one thing sliding rather than two things blinking.
 */
export function NavTab({
  active, onClick, icon, label, hint, badge, tone, groupId = 'nav', ...rest
}: {
  active: boolean;
  onClick: () => void;
  icon?: ReactNode;
  label: string;
  hint?: string;
  badge?: ReactNode;
  tone?: string;
  /** Tabs sharing an id share the sliding pill. */
  groupId?: string;
} & Record<string, unknown>) {
  const theme = useSection();
  const reduced = useReducedMotion();
  const accent = tone ?? theme.color;
  const [hover, setHover] = useState(false);

  const button = (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="relative flex items-center gap-[9px] px-[15px] h-[46px] rounded-[11px] text-[15px] font-bold shrink-0 outline-none"
      style={{
        color: active ? theme.on : hover ? accent : 'var(--app-text-muted)',
        transition: `color ${DURATION.fast}s`,
        cursor: 'pointer',
      }}
      {...rest}
    >
      {active && (
        <motion.span
          layoutId={`navtab-${groupId}`}
          transition={reduced ? { duration: 0 } : GLIDE}
          className="absolute inset-0 rounded-[11px]"
          style={{
            background: `linear-gradient(135deg, ${accent} 0%, ${accent} 100%)`,
            boxShadow: `0 3px 14px -4px ${alpha(accent, 0.75)}`,
          }}
        />
      )}
      {!active && hover && (
        <span
          className="absolute inset-0 rounded-[11px]"
          style={{ background: alpha(accent, 0.11), border: `1px solid ${alpha(accent, 0.3)}` }}
        />
      )}
      <span className="relative flex items-center gap-[9px]">
        {icon}
        <span className="truncate">{label}</span>
        {badge}
      </span>
    </button>
  );

  return hint ? <Tooltip label={hint}>{button}</Tooltip> : button;
}

/** The container a section's tabs go in, so their spacing is not re-invented. */
export function NavTabs({ children }: { children: ReactNode }) {
  return <div className="flex items-center gap-[4px] mr-auto ml-[6px] min-w-0 overflow-x-auto">{children}</div>;
}

/** Right-aligned actions belonging to the current screen. */
export function NavActions({ children }: { children: ReactNode }) {
  return <div className="flex items-center gap-[8px] shrink-0">{children}</div>;
}

export type { View };
export { Button as NavButton };
