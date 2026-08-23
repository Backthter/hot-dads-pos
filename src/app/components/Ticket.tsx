import { useRef } from 'react';
import svgPaths from "../../imports/1440WDefault/svg-0htr32os96";
import { measure } from '../ui/geometry';
import { useTicketMenu, type TicketAction } from './TicketActionMenu';
import type { OrderStatus, CartItem } from '../types';

interface TicketFaceProps {
  orderNumber: string;
  items: CartItem[];
  notes?: string;
  status: OrderStatus;
  total: number;
  timestamp?: number;
  showTimestamp?: boolean;
}

export function statusColor(status: OrderStatus): string {
  if (status === 'preparing') return '#F9624E';
  if (status === 'grill') return '#f79634';
  if (status === 'ready') return '#76DFDA';
  if (status === 'parked') return '#A1A1AA';
  return '#D9D9D9';
}

/**
 * The ticket's visual body, with no interaction attached. Rendered both on the
 * board and as the centred copy inside the ticket action menu.
 */
export function TicketFace({
  orderNumber, items, notes, status, total, timestamp, showTimestamp,
}: TicketFaceProps) {
  const formattedTime = showTimestamp && timestamp
    ? new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null;
  const formattedDate = showTimestamp && timestamp
    ? new Date(timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' })
    : null;

  return (
    <div
      className="grid-cols-[max-content] grid-rows-[max-content] inline-grid place-items-start relative shrink-0 select-none overflow-hidden"
      data-name="Ticket"
      style={{ borderRadius: '10px' }}
    >
      <div className="col-1 h-[108px] ml-0 mt-0 relative row-1 w-[225.599px]">
        <svg className="absolute block inset-0 size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 225.599 108">
          <path d={svgPaths.p38f6c7c0} fill="var(--fill-0, #D9D9D9)" id="Rectangle 1" />
        </svg>
      </div>

      <div className="col-1 h-[108px] ml-[76.79px] mt-0 relative row-1 w-[148.814px] transition-all duration-200">
        <svg className="absolute block inset-0 size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 148.814 108">
          <path d={svgPaths.p1dfa8280} fill={statusColor(status)} id="Vector 1" style={{ transition: 'fill 200ms ease' }} />
        </svg>
      </div>

      <p className="col-1 font-['Francois_One',sans-serif] h-[24px] ml-[6px] mt-[8px] not-italic relative row-1 text-[0px] text-black tracking-[0.055px] w-[67px]">
        <span className="leading-[11px] text-[12px]">Rs.</span>
        <span className="leading-[11px] text-[16px]">{` `}</span>
        <span className="leading-[11px] text-[20px]">{total.toFixed(0)}</span>
      </p>

      {notes && (
        <p className="col-1 font-['Francois_One',sans-serif] h-[9px] leading-[11px] ml-[82px] mt-[96px] not-italic relative row-1 text-[10px] text-black tracking-[0.055px] w-[137px] overflow-hidden text-ellipsis whitespace-nowrap">
          {notes}
        </p>
      )}

      <div className="col-1 font-['Francois_One',sans-serif] max-h-[85px] ml-[82.75px] mt-[6px] not-italic relative row-1 text-[17px] text-black tracking-[0.055px] w-[135.762px] overflow-y-auto">
        {items.map((item, index) => (
          <div key={index}>
            <p className="leading-[16px] mb-0 truncate">
              x{item.quantity} {item.name}
            </p>
            {item.dealItems && item.dealItems.length > 0 && (
              <div className="pl-2 text-[12px] text-[#52525c]">
                {item.dealItems.map((dealItem, idx) => (
                  <p key={idx} className="leading-[14px] mb-0 truncate">
                    • {dealItem.quantity * item.quantity}x {dealItem.name}
                  </p>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {formattedTime && (
        <div className="col-1 ml-[6px] mt-[28px] relative row-1 flex flex-col leading-none">
          <span className="font-['Segoe_UI',sans-serif] text-[9px] font-semibold text-black/50 tracking-[0.3px] uppercase">{formattedDate}</span>
          <span className="font-['Segoe_UI',sans-serif] text-[11px] font-bold text-black/70 tracking-[0.2px]">{formattedTime}</span>
        </div>
      )}

      <p className="col-1 font-['Francois_One',sans-serif] h-[27px] leading-[26px] ml-[8px] mt-[58px] not-italic relative row-1 text-[36px] text-black text-right tracking-[0.055px] w-[65px]">
        {orderNumber}
      </p>
    </div>
  );
}

interface TicketProps extends TicketFaceProps {
  orderId: string;
  /** Actions that are meaningless for this ticket, e.g. Ready on a ready ticket. */
  disabledActions?: TicketAction[];
  /** Editing tickets are frozen: pressing jumps to their session instead. */
  frozen?: boolean;
  onFrozenPress?: () => void;
}

export function Ticket({ orderId, disabledActions, frozen, onFrozenPress, ...face }: TicketProps) {
  const { beginPress, activeOrderId } = useTicketMenu();
  const ref = useRef<HTMLDivElement | null>(null);
  const isActive = activeOrderId === orderId;

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== undefined && e.button !== 0) return;

    if (frozen) {
      onFrozenPress?.();
      return;
    }

    // Measured through `measure` rather than `getBoundingClientRect` directly,
    // so the overlay is handed coordinates in the space it will paint in.
    const rect = measure(ref.current);
    if (!rect) return;

    beginPress(
      {
        orderId,
        orderNumber: face.orderNumber,
        rect,
        status: face.status,
        disabled: disabledActions,
        preview: <TicketFace {...face} />,
      },
      e.clientX,
      e.clientY,
    );
  };

  return (
    <div
      ref={ref}
      onPointerDown={handlePointerDown}
      className={`relative inline-grid transition-all duration-150 ${frozen ? 'cursor-pointer' : 'cursor-pointer active:scale-[0.98]'}`}
      style={{
        touchAction: 'none',
        borderRadius: '10px',
        // Hidden outright while its action menu holds a copy, so only one
        // instance of the ticket is ever on screen.
        opacity: isActive ? 0 : 1,
      }}
    >
      <TicketFace {...face} />
      {/* Drawn as an overlay rather than a box-shadow: the ticket face is an SVG
          that paints over an inset shadow, and an outer ring bleeds into the
          neighbouring tickets. */}
      {frozen && (
        <span
          className="absolute inset-0 pointer-events-none"
          style={{ border: '2px solid #A855F7', borderRadius: '10px' }}
          data-editing-ring="true"
        />
      )}
      {frozen && (
        <span
          className="absolute -top-[9px] left-1/2 -translate-x-1/2 px-[8px] py-[2px] rounded-full font-['Segoe_UI',sans-serif] text-[9px] font-bold uppercase tracking-[0.8px] pointer-events-none"
          style={{ background: '#A855F7', color: '#2a0a45' }}
        >
          Editing
        </span>
      )}
    </div>
  );
}
