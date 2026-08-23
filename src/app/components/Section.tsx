import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { BellRing, CheckCircle2, Flame, Inbox } from 'lucide-react';
import { Ticket } from './Ticket';
import { type TicketAction } from './TicketActionMenu';
import { DANGER, HINT, Tooltip, alpha } from '../ui';
import type { Order, OrderStatus } from '../types';

/**
 * One band of the kitchen board: a heading, a count, and the tickets in it.
 *
 * The grill band can be pinned and collapsed while the board is scrolled, which
 * is why it alone takes `sticky`, `minimized` and a ref — the collapse is driven
 * from the scroll handler that owns the scrolling element.
 */
const SECTION_CONFIG: Record<string, {
  bg: string;
  border: string;
  accent: string;
  icon: React.ReactNode;
  empty: string;
}> = {
  preparing: {
    bg: 'var(--dropzone-preparing-bg)',
    border: 'var(--dropzone-preparing-border)',
    accent: 'var(--dropzone-preparing-icon)',
    icon: <Inbox size={22} style={{ color: 'var(--dropzone-preparing-icon)' }} />,
    empty: 'No tickets preparing',
  },
  grill: {
    bg: 'var(--dropzone-grill-bg)',
    border: 'var(--dropzone-grill-border)',
    accent: 'var(--dropzone-grill-icon)',
    icon: <Flame size={22} style={{ color: 'var(--dropzone-grill-icon)' }} />,
    empty: 'Nothing on the grill',
  },
  ready: {
    bg: 'var(--dropzone-ready-bg)',
    border: 'var(--dropzone-ready-border)',
    accent: 'var(--dropzone-ready-icon)',
    icon: <BellRing size={22} style={{ color: 'var(--dropzone-ready-icon)' }} />,
    empty: 'Nothing ready yet',
  },
  completed: {
    bg: 'var(--dropzone-completed-bg)',
    border: 'var(--dropzone-completed-border)',
    accent: 'var(--dropzone-completed-icon)',
    icon: <CheckCircle2 size={22} style={{ color: 'var(--dropzone-completed-icon)' }} />,
    empty: 'No completed orders',
  },
};

export function Section({
  title, status, orders, editingOrderIds, capacity, grillIsFull, onEditOrder,
  showDelete = true, pendingDeleteId, onDelete, showTimestamp = false,
  sticky = false, minimized = false, onExpand, sectionRef, note,
}: {
  title: string;
  /** A short aside beside the count — what is being filtered, for instance. */
  note?: string;
  status: OrderStatus;
  orders: Order[];
  editingOrderIds?: Set<string>;
  /** Shown as "03/08" in the header. Only the grill has one. */
  capacity?: number;
  grillIsFull?: boolean;
  onEditOrder?: (orderId: string) => void;
  showDelete?: boolean;
  pendingDeleteId?: string | null;
  onDelete?: (id: string) => void;
  showTimestamp?: boolean;
  /** Pins the section to the top of the board while it is scrolled. */
  sticky?: boolean;
  /** Collapses to a single strip of order numbers. */
  minimized?: boolean;
  onExpand?: () => void;
  sectionRef?: React.MutableRefObject<HTMLDivElement | null>;
}) {
  const cfg = SECTION_CONFIG[status] ?? SECTION_CONFIG.preparing;
  // Nothing is greyed out for being redundant any more — that slot offers
  // "Preparing" instead. Only a full grill actually blocks an action.
  const disabledActions = grillIsFull && status !== 'grill' ? ['grill' as TicketAction] : undefined;
  const atCapacity = capacity !== undefined && orders.length >= capacity;
  const collapsed = sticky && minimized;

  return (
    <div
      ref={sectionRef}
      className="flex flex-col gap-[5px]"
      data-section={status}
      data-collapsed={collapsed ? 'true' : 'false'}
      style={sticky ? {
        position: 'sticky',
        top: 0,
        zIndex: 20,
        background: 'var(--app-bg)',
        paddingTop: collapsed ? 8 : 0,
        paddingBottom: collapsed ? 8 : 0,
        marginTop: collapsed ? -8 : 0,
        boxShadow: collapsed ? '0 8px 16px -8px rgba(0,0,0,0.7)' : 'none',
      } : undefined}>
      <div className="flex items-center gap-[7px] font-['Segoe_UI',sans-serif] text-[var(--app-text-muted)] text-[14px] leading-[20px] not-italic">
        <span style={{ color: cfg.accent, display: 'flex' }}>
          {React.isValidElement(cfg.icon)
            ? React.cloneElement(cfg.icon as React.ReactElement<{ size?: number }>, { size: 14 })
            : cfg.icon}
        </span>
        <span className="font-bold tracking-[0.6px]">
          {title} {String(orders.length).padStart(2, '0')}
          {capacity !== undefined && (
            <span style={{ color: atCapacity ? cfg.accent : undefined }}>
              /{String(capacity).padStart(2, '0')}
            </span>
          )}
          {atCapacity && (
            <span className="ml-[8px] text-[12px] font-bold uppercase" style={{ color: cfg.accent }}>
              Full
            </span>
          )}
        </span>
        {note && (
          <span className="text-[12px] font-medium opacity-80 normal-case">· {note}</span>
        )}
        <span
          aria-hidden
          className="flex-1 h-px ml-[4px]"
          style={{ background: `linear-gradient(90deg, ${cfg.border} 0%, rgba(0,0,0,0) 100%)` }}
        />
      </div>
      {collapsed ? (
        <button
          onClick={onExpand}
          title={HINT.collapsedGrill}
          className="flex items-center gap-[8px] w-full overflow-x-auto py-[4px] text-left"
        >
          {orders.length === 0 ? (
            <span className="text-[var(--app-text-muted)] text-[12px]">{cfg.empty}</span>
          ) : (
            orders.map(order => (
              <motion.span
                key={order.id}
                layout
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                className="shrink-0 flex items-center gap-[9px] rounded-[9px] px-[11px] py-[7px] font-['Segoe_UI',sans-serif]"
                style={{ background: cfg.bg, border: `1px solid ${cfg.border}`, minWidth: 132 }}
              >
                <span className="text-[19px] font-bold leading-none" style={{ color: cfg.accent }}>
                  {order.orderNumber}
                </span>
                <span className="flex flex-col leading-[13px] min-w-0">
                  <span className="text-[12px] font-semibold text-[var(--app-text)] truncate max-w-[132px]">
                    ×{order.items[0]?.quantity ?? 0} {order.items[0]?.name ?? '—'}
                  </span>
                  {order.items.length > 1 && (
                    <span className="text-[10px] text-[var(--app-text-muted)]">
                      +{order.items.length - 1} more
                    </span>
                  )}
                </span>
              </motion.span>
            ))
          )}
        </button>
      ) : (
      <div className="relative w-full">
        {orders.length === 0 ? (
          <div
            className="flex flex-col items-center justify-center py-[26px] rounded-[12px] w-full border border-dashed transition-colors"
            style={{ backgroundColor: cfg.bg, borderColor: cfg.border }}
          >
            {cfg.icon}
            <p className="text-[var(--app-text-secondary)] text-[13px] mt-[8px] font-semibold">{cfg.empty}</p>
          </div>
        ) : (
          <div className="flex flex-wrap gap-[14px] py-[14px] content-start w-full">
            <AnimatePresence mode="popLayout">
              {orders.map(order => (
                <motion.div
                  key={order.id}
                  layout
                  className="relative group"
                  initial={{ opacity: 0, scale: 0.85, y: 8 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.8, y: -6 }}
                  transition={{ type: 'spring', stiffness: 380, damping: 28 }}
                >
                  <Ticket
                    orderId={order.id}
                    orderNumber={order.orderNumber}
                    items={order.items}
                    notes={order.notes}
                    status={order.status}
                    total={order.total}
                    timestamp={order.timestamp}
                    showTimestamp={showTimestamp}
                    disabledActions={disabledActions}
                    frozen={editingOrderIds?.has(order.id) ?? false}
                    onFrozenPress={() => onEditOrder?.(order.id)}
                  />
                  {showDelete && onDelete && (
                    <Tooltip label={HINT.voidOrder}>
                      <button
                        onClick={() => onDelete(order.id)}
                        data-void-order={order.orderNumber}
                        className={`absolute top-2 right-2 px-[11px] h-[26px] rounded-[8px] text-[12px] font-bold transition-all duration-150 ${
                          pendingDeleteId === order.id
                            ? 'opacity-100'
                            : 'opacity-0 group-hover:opacity-100 focus:opacity-100'
                        }`}
                        style={pendingDeleteId === order.id
                          ? { background: DANGER, color: '#fff', boxShadow: `0 3px 12px -3px ${alpha(DANGER, 0.9)}` }
                          : { background: 'rgba(9,9,12,0.72)', color: '#fff', border: '1px solid rgba(255,255,255,0.14)' }}
                      >
                        {pendingDeleteId === order.id ? 'Void it?' : 'Void'}
                      </button>
                    </Tooltip>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
      )}
    </div>
  );
}
