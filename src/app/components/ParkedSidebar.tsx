import React, { useCallback, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Banknote, CheckCircle2, ChevronLeft, ChevronRight, Pencil, Plus, Smartphone, Trash2, XCircle,
} from 'lucide-react';
import { useDrag, useDropTarget, type DragOrigin } from './DragContext';
import { computeTotals } from '../lib/orders';
import { Button, HINT, SECTION_COLOR, measure } from '../ui';
import type { OrderStatus, ParkedSession } from '../types';

/** One parked order, as it appears in the sidebar. */
const ParkedTicketInline = React.memo(function ParkedTicketInline({
  session,
  total,
  isDragging,
  isActive,
  expanded,
  onSwitchSession,
  onDeleteSession,
  onCheckoutParked,
  startDragFn,
  onToggleExpand,
  tapToExpandParked,
}: {
  session: ParkedSession;
  total: number;
  isDragging: boolean;
  isActive: boolean;
  expanded: boolean;
  onSwitchSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  onCheckoutParked: (sessionId: string, paymentType: 'cash' | 'transfer') => void;
  startDragFn: (orderId: string, x: number, y: number, label: string, origin?: DragOrigin) => void;
  onToggleExpand: () => void;
  tapToExpandParked: boolean;
}) {
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    startDragFn(`parked-${session.id}`, e.clientX, e.clientY, session.label, {
      rect: measure(e.currentTarget)!,
      editing: Boolean(session.editingOrderId),
    });
  }, [session.id, session.label, session.editingOrderId, startDragFn]);

  const handleClick = useCallback((e: React.MouseEvent) => {
    if (tapToExpandParked) {
      onToggleExpand();
    } else {
      onSwitchSession(session.id);
    }
  }, [session.id, onSwitchSession, tapToExpandParked, onToggleExpand]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const t = e.touches[0];
    if (!t) return;
    e.stopPropagation();
    startDragFn(`parked-${session.id}`, t.clientX, t.clientY, session.label, {
      rect: measure(e.currentTarget)!,
      editing: Boolean(session.editingOrderId),
    });
  }, [session.id, session.label, session.editingOrderId, startDragFn]);

  const handleDeleteClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onDeleteSession(session.id);
  }, [session.id, onDeleteSession]);

  const handleCashClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onCheckoutParked(session.id, 'cash');
  }, [session.id, onCheckoutParked]);

  const handleTransferClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onCheckoutParked(session.id, 'transfer');
  }, [session.id, onCheckoutParked]);

  const isEditing = Boolean(session.editingOrderId);

  return (
    <motion.div
      layout
      onMouseDown={expanded ? undefined : handleMouseDown}
      onClick={handleClick}
      onTouchStart={expanded ? undefined : handleTouchStart}
      className={`rounded-[9px] p-[3px] flex flex-col relative group select-none ${
        tapToExpandParked ? 'cursor-pointer' : expanded ? 'cursor-default' : 'cursor-grab active:cursor-grabbing'
      } ${
        isActive
          ? 'bg-[#d9d9d9] ring-inset ring-3 ring-[#15d2b2]'
          : 'bg-[#d9d9d9] hover:bg-[#e9e9e9]'
      }`}
      style={{ touchAction: 'none', boxShadow: isEditing ? 'inset 0 0 0 2px #7c3fb0' : undefined }}
      // Hands off to the drag chip: the card recedes as the chip grows out of it.
      animate={{ opacity: isDragging ? 0.25 : 1, scale: isDragging ? 0.94 : 1 }}
      transition={{ type: 'spring', stiffness: 500, damping: 35 }}
    >
      {isEditing && (
        <div className="flex items-center gap-[3px] px-[3px] pb-[2px]">
          <Pencil size={9} style={{ color: '#7c3fb0' }} />
          <span className="font-['Segoe_UI',sans-serif] text-[8px] font-bold uppercase tracking-[0.6px]" style={{ color: '#7c3fb0' }}>
            Editing
          </span>
        </div>
      )}
      <div className="flex items-start justify-between gap-[6px] px-[2px]" style={{ minHeight: '59px' }}>
        <div className="font-['Barlow_Semi_Condensed',sans-serif] font-semibold text-[12px] uppercase tracking-[0.3px] leading-[13px] text-black flex-1 pt-[6px] overflow-hidden min-w-0">
          {session.cart.map(item => (
            <div key={item.menuItemId}>
              <p className="truncate">X{item.quantity} {item.name}</p>
              {item.dealItems && item.dealItems.length > 0 && (
                <div className="pl-2 text-[10px] text-[#3f3f46]">
                  {item.dealItems.map((dealItem, idx) => (
                    <p key={idx} className="truncate">• {dealItem.quantity * item.quantity}x {dealItem.name}</p>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="flex flex-col items-end justify-between pt-[5px] pb-[3px] shrink-0" style={{ minHeight: '53px' }}>
          <p
            className={`font-['Barlow_Semi_Condensed',sans-serif] font-bold uppercase tracking-[0.2px] leading-[12px] text-right ${isEditing ? 'text-[18px]' : 'text-[24px]'}`}
            style={{ color: isEditing ? '#7c3fb0' : '#000' }}
          >
            {isEditing ? `#${session.label}` : session.label}
          </p>
          <p className="font-['Barlow_Semi_Condensed',sans-serif] font-bold leading-[12px] text-black text-right whitespace-nowrap">
            <span className="text-[5px]">rs</span>
            <span className="text-[18px]">{total.toFixed(0)}</span>
          </p>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="actions"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            className="overflow-hidden"
          >
            <div className="flex gap-[4px] px-[2px] pb-[3px] pt-[4px] border-t border-[#b0b0b0] mt-[2px]">
              <button
                onClick={handleDeleteClick}
                className="flex-1 bg-[#3d1f1f] hover:bg-[#F9624E] text-white text-[10px] font-semibold uppercase tracking-[0.5px] rounded-[6px] py-[5px] transition-colors"
              >
                {isEditing ? 'Cancel' : 'Delete'}
              </button>
              <button
                onClick={handleCashClick}
                className="flex-1 bg-[#504040] hover:bg-[#5BBFB6] hover:text-black text-white text-[10px] font-semibold uppercase tracking-[0.5px] rounded-[6px] py-[5px] transition-colors"
              >
                {isEditing ? 'Save·Cash' : 'Cash'}
              </button>
              <button
                onClick={handleTransferClick}
                className="flex-1 bg-[#3d4c58] hover:bg-[#5BBFB6] hover:text-black text-white text-[10px] font-semibold uppercase tracking-[0.5px] rounded-[6px] py-[5px] transition-colors"
              >
                {isEditing ? 'Save·Trf' : 'Transfer'}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
});


export function ParkedSidebar({
  open, setOpen, sessions, activeSessionId, onSwitchSession, onNewSession, onDeleteSession, onMove, onCheckoutParked, tapToExpandParked, taxRate
}: {
  open: boolean;
  setOpen: (b: boolean) => void;
  sessions: ParkedSession[];
  activeSessionId: string;
  onSwitchSession: (id: string) => void;
  onNewSession: () => void;
  onDeleteSession: (id: string) => void;
  onMove: (orderId: string, status: OrderStatus, paid?: 'cash' | 'transfer') => void;
  onCheckoutParked: (sessionId: string, paymentType: 'cash' | 'transfer') => void;
  tapToExpandParked: boolean;
  taxRate: number;
}) {
  const [cashDropSuccess, setCashDropSuccess] = useState(false);
  const [transferDropSuccess, setTransferDropSuccess] = useState(false);
  const [deleteDropSuccess, setDeleteDropSuccess] = useState(false);
  const [cashDropDenied, setCashDropDenied] = useState(false);
  const [transferDropDenied, setTransferDropDenied] = useState(false);
  const [expandedParkedId, setExpandedParkedId] = useState<string | null>(null);

  const triggerDropEffect = (setter: (v: boolean) => void) => {
    setter(true);
    setTimeout(() => setter(false), 700);
  };

  const isSessionEmpty = useCallback((id: string) => {
    if (!id.startsWith('parked-')) return false;
    const sessionId = id.replace('parked-', '');
    const session = sessions.find(s => s.id === sessionId);
    return !session || session.cart.length === 0;
  }, [sessions]);

  const handleDrop = useCallback((id: string, paymentType: 'cash' | 'transfer') => {
    if (id.startsWith('parked-')) {
      if (isSessionEmpty(id)) {
        triggerDropEffect(paymentType === 'cash' ? setCashDropDenied : setTransferDropDenied);
        return;
      }
      const sessionId = id.replace('parked-', '');
      onCheckoutParked(sessionId, paymentType);
    } else {
      onMove(id, 'completed', paymentType);
    }
    triggerDropEffect(paymentType === 'cash' ? setCashDropSuccess : setTransferDropSuccess);
  }, [onCheckoutParked, onMove, isSessionEmpty]);

  // Always call hooks unconditionally — never inside conditional branches
  const cashZone = useDropTarget('paid-cash', useCallback((id) => handleDrop(id, 'cash'), [handleDrop]));
  const transferZone = useDropTarget('paid-transfer', useCallback((id) => handleDrop(id, 'transfer'), [handleDrop]));
  const handleDeleteDrop = useCallback((id: string) => {
    if (id.startsWith('parked-')) {
      const sessionId = id.replace('parked-', '');
      onDeleteSession(sessionId);
    }
    triggerDropEffect(setDeleteDropSuccess);
  }, [onDeleteSession]);
  const deleteZone = useDropTarget('delete-parked', handleDeleteDrop);
  const { startDrag, draggingId } = useDrag();

  return (
    <div
      className="bg-[var(--sidebar-bg)] h-full flex flex-col shrink-0 overflow-hidden relative"
      style={{
        width: open ? '197px' : '35px',
        transition: 'width 200ms ease',
      }}
    >
      {/* Collapsed strip — always rendered, hidden when open */}
      <div
        className="absolute flex flex-col items-center justify-between py-[24px] px-[5px] h-full"
        style={{
          width: '35px',
          opacity: open ? 0 : 1,
          pointerEvents: open ? 'none' : 'auto',
          transition: 'opacity 150ms ease',
        }}
      >
        <button
          onClick={() => setOpen(true)}
          className="w-full h-[52px] shrink-0 flex items-center justify-center bg-[var(--app-surface)] hover:bg-[#FE9A00] rounded-[10px] transition-colors group"
        >
          <ChevronLeft size={18} className="text-[#FE9A00] group-hover:text-black transition-colors" />
        </button>
        <div className="flex-1 flex flex-col gap-[8px] items-center overflow-auto py-[8px]">
          <AnimatePresence mode="popLayout">
            {sessions.map(session => (
              <motion.div
                key={session.id}
                layout
                initial={{ opacity: 0, scale: 0.5, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.5, y: -10 }}
                transition={{ type: 'spring', stiffness: 400, damping: 25 }}
              >
                <button
                  onClick={() => onSwitchSession(session.id)}
                  title={session.editingOrderId ? `Editing order #${session.label}` : `Order ${session.label}`}
                  className={`rounded-[9px] w-[25px] h-[35px] flex items-center justify-center font-['Barlow_Semi_Condensed',sans-serif] font-bold text-[28px] uppercase tracking-[0.6px] leading-[16px] transition-all ${
                    session.editingOrderId
                      ? 'bg-[#f0e2ff]'
                      : session.id === activeSessionId
                        ? 'bg-[#15D2B2] text-black'
                        : 'bg-[#d9d9d9] text-black hover:bg-[#e9e9e9]'
                  }`}
                  style={session.editingOrderId
                    ? { boxShadow: session.id === activeSessionId ? 'inset 0 0 0 2px #7c3fb0' : undefined }
                    : undefined}
                >
                  {session.editingOrderId ? (
                    <motion.span
                      className="flex items-center justify-center"
                      // A slow float, mirrored so the loop has no seam.
                      initial={{ y: -2.5 }}
                      animate={{ y: 2.5 }}
                      transition={{
                        duration: 1.4,
                        repeat: Infinity,
                        repeatType: 'mirror',
                        ease: 'easeInOut',
                      }}
                    >
                      <Pencil size={13} style={{ color: '#7c3fb0' }} strokeWidth={2.6} />
                    </motion.span>
                  ) : (
                    session.label
                  )}
                </button>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>

      {/* Expanded panel — always rendered, hidden when collapsed */}
      <div
        className="flex flex-col h-full w-[197px]"
        style={{
          opacity: open ? 1 : 0,
          pointerEvents: open ? 'auto' : 'none',
          transition: 'opacity 150ms ease',
        }}
      >
        <div className="flex flex-col items-start px-[10px] py-[24px] gap-[18px] flex-1 overflow-hidden">
          <div className="flex items-center gap-[10px] w-full">
            <button
              onClick={() => setOpen(false)}
              className="w-[44px] h-[44px] shrink-0 flex items-center justify-center bg-[var(--app-surface)] hover:bg-[#FE9A00] rounded-[10px] transition-colors group"
            >
              <ChevronRight size={18} className="text-[#FE9A00] group-hover:text-black transition-colors" />
            </button>
            <p className="text-white text-[13px] font-semibold uppercase tracking-[0.6px] leading-[16px]">Parked</p>
            <div
              ref={deleteZone.ref}
              className="ml-auto rounded-[8px] w-[44px] h-[44px] flex items-center justify-center transition-all cursor-pointer relative overflow-hidden"
              style={{
                background: deleteDropSuccess ? '#F9624E' : deleteZone.isOver ? '#F9624E' : '#3d1f1f',
                outline: deleteZone.isActive && !deleteZone.isOver ? '2px dashed rgba(249,98,78,0.4)' : 'none',
              }}
            >
              {deleteDropSuccess ? (
                <motion.span
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 15 }}
                >
                  <CheckCircle2 size={16} className="text-white" />
                </motion.span>
              ) : (
                <Trash2 size={16} className="text-[#b7b7b7]" />
              )}
            </div>
          </div>

          <div className="flex gap-[4px] justify-center w-full">
            <div
              ref={cashZone.ref}
              className="rounded-[8px] w-[84px] h-[67px] flex flex-col items-center justify-center transition-all gap-[4px] relative overflow-hidden"
              style={{
                background: cashDropDenied ? '#8B3A3A' : cashDropSuccess ? '#5BBFB6' : cashZone.isOver ? '#5BBFB6' : '#504040',
                outline: cashZone.isActive && !cashZone.isOver ? '2px dashed rgba(91,191,182,0.4)' : 'none',
              }}
            >
              {cashDropDenied ? (
                <motion.span
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 15 }}
                >
                  <XCircle size={22} className="text-white" />
                </motion.span>
              ) : cashDropSuccess ? (
                <motion.span
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 15 }}
                >
                  <CheckCircle2 size={22} className="text-black" />
                </motion.span>
              ) : (
                <>
                  <Banknote size={18} className={cashZone.isOver ? 'text-black' : 'text-[#b7b7b7]'} />
                  <p className={`text-[10px] uppercase text-center leading-[12px] tracking-[0.6px] font-semibold ${cashZone.isOver ? 'text-black' : 'text-[#b7b7b7]'}`}>Cash</p>
                </>
              )}
            </div>
            <div
              ref={transferZone.ref}
              className="rounded-[8px] w-[84px] h-[67px] flex flex-col items-center justify-center transition-all gap-[4px] relative overflow-hidden"
              style={{
                background: transferDropDenied ? '#8B3A3A' : transferDropSuccess ? '#5BBFB6' : transferZone.isOver ? '#5BBFB6' : '#3d4c58',
                outline: transferZone.isActive && !transferZone.isOver ? '2px dashed rgba(91,191,182,0.4)' : 'none',
              }}
            >
              {transferDropDenied ? (
                <motion.span
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 15 }}
                >
                  <XCircle size={22} className="text-white" />
                </motion.span>
              ) : transferDropSuccess ? (
                <motion.span
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 15 }}
                >
                  <CheckCircle2 size={22} className="text-black" />
                </motion.span>
              ) : (
                <>
                  <Smartphone size={18} className={transferZone.isOver ? 'text-black' : 'text-[#b7b7b7]'} />
                  <p className={`text-[10px] uppercase text-center leading-[12px] tracking-[0.6px] font-semibold ${transferZone.isOver ? 'text-black' : 'text-[#b7b7b7]'}`}>Transfer</p>
                </>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto overflow-x-hidden w-full">
            <div className="flex flex-col gap-[8px]">
              <AnimatePresence mode="popLayout">
                {sessions.map(session => {
                  // Matches what the order will actually come to, discount and tax included.
                  const total = computeTotals(session.cart, session.discount, taxRate).total;
                  const isDragging = draggingId === `parked-${session.id}`;

                  return (
                    <motion.div
                      key={session.id}
                      layout
                      initial={{ opacity: 0, x: 40, scale: 0.9 }}
                      animate={{ opacity: 1, x: 0, scale: 1 }}
                      exit={{ opacity: 0, x: -40, scale: 0.9 }}
                      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                    >
                      <ParkedTicketInline
                        session={session}
                        total={total}
                        isDragging={isDragging}
                        isActive={session.id === activeSessionId}
                        expanded={tapToExpandParked && expandedParkedId === session.id}
                        onSwitchSession={onSwitchSession}
                        onDeleteSession={onDeleteSession}
                        onCheckoutParked={onCheckoutParked}
                        startDragFn={startDrag}
                        onToggleExpand={() => {
                          setExpandedParkedId(prev => prev === session.id ? null : session.id);
                        }}
                        tapToExpandParked={tapToExpandParked}
                      />
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          </div>
        </div>

        {/* Undo and redo used to live down here, 22 pixels wide, which meant
            they existed only in Order Mode and were barely reachable with a
            finger. They are in the top bar now, where every screen can see
            them. This slot goes to the thing that genuinely belongs to the
            parked list. */}
        <div className="px-[10px] py-[10px] border-t border-[rgba(255,255,255,0.1)]">
          <Button
            variant="secondary"
            block
            tone={SECTION_COLOR.order}
            icon={<Plus size={17} />}
            onClick={onNewSession}
            hint={HINT.newOrder}
            data-park-new-order
          >
            New order
          </Button>
        </div>
      </div>
    </div>
  );
}
