import { useCallback } from 'react';
import { SessionBar } from '../components/SessionBar';
import { ScreenShell } from '../components/ScreenShell';
import { Section } from '../components/Section';
import { NavSlot, NavTabs } from '../components/Navigation';
import { HINT, SegmentedControl } from '../ui';
import { withDisplayNumbers } from '../lib/sessions';
import type { OrdersHandle, SessionsHandle } from '../state';
import type { Order } from '../types';

/**
 * All Orders: the kitchen board, with the session controls above it.
 *
 * Four bands and a bar. Everything it can do belongs to `useOrders` or
 * `useSessions`; this file decides only what is shown and in what order.
 */
export interface BoardScreenProps {
  orders: OrdersHandle;
  sessions: SessionsHandle;
  grillCapacity: number;
  onOtherBoard: () => void;
}

export function BoardScreen({ orders, sessions, grillCapacity, onOtherBoard }: BoardScreenProps) {
  const sessionIsLive = sessions.state.live !== null;
  const grillIsFull = orders.state.grill.length >= grillCapacity;

  /**
   * Re-labels a band with session ticket numbers while a session is live.
   * Display only — the stored orders keep their lifetime numbers throughout,
   * which is what lets ending a session reveal them again for free.
   */
  const liveId = sessions.state.live?.id ?? null;
  const numbered = useCallback(
    (list: Order[]) => withDisplayNumbers(list, liveId),
    [liveId],
  );

  // While a session runs the board can show only its own completed tickets,
  // which is what the kitchen wants; everything ever completed is a click away.
  const completedOrders = sessions.state.completedFilter === 'session' && sessionIsLive
    ? orders.state.completed.filter(o => o.sessionId === sessions.state.live?.id)
    : orders.state.completed;

  return (
      <ScreenShell section="orders" onOtherBoard={onOtherBoard}>
        {sessionIsLive && (
          <NavSlot>
            <NavTabs>
              <span className="ml-[2px]">
                <SegmentedControl
                  value={sessions.state.completedFilter}
                  onChange={sessions.actions.setCompletedFilter}
                  options={[
                    { value: 'session' as const, label: 'This session', hint: HINT.completedThisSession },
                    { value: 'all' as const, label: 'Everything', hint: HINT.completedAll },
                  ]}
                />
              </span>
            </NavTabs>
          </NavSlot>
        )}

        <div className="flex-1 overflow-auto p-[20px] flex flex-col gap-[12px]">
          <SessionBar
            sessions={sessions.state.tradingSessions}
            events={sessions.state.tradingEvents}
            orders={orders.state.orders}
            onStart={sessions.actions.start}
            onPause={sessions.actions.pause}
            onResume={sessions.actions.resume}
            onEnd={sessions.actions.end}
            onRename={sessions.actions.rename}
            onGroup={sessions.actions.group}
            onUngroup={sessions.actions.ungroup}
            onMoveSession={sessions.actions.moveSessionToEvent}
            onMakeEvent={sessions.actions.makeSessionAnEvent}
            onCreateEvent={sessions.actions.addEvent}
            onEditEvent={sessions.actions.editEvent}
            onDeleteEvent={sessions.actions.deleteEvent}
          />
          <Section title="PREPARING" status="preparing" orders={numbered(orders.state.preparing)} editingOrderIds={orders.state.editingOrderIds} grillIsFull={grillIsFull} onEditOrder={orders.actions.startEditingOrder} showDelete={true} pendingDeleteId={orders.state.pendingDeleteId} onDelete={orders.actions.voidOrder} showTimestamp={true} />
          <Section title="ON THE GRILL" status="grill" orders={numbered(orders.state.grill)} capacity={grillCapacity} editingOrderIds={orders.state.editingOrderIds} grillIsFull={grillIsFull} onEditOrder={orders.actions.startEditingOrder} showDelete={true} pendingDeleteId={orders.state.pendingDeleteId} onDelete={orders.actions.voidOrder} showTimestamp={true} />
          <Section title="READY" status="ready" orders={numbered(orders.state.ready)} editingOrderIds={orders.state.editingOrderIds} grillIsFull={grillIsFull} onEditOrder={orders.actions.startEditingOrder} showDelete={true} pendingDeleteId={orders.state.pendingDeleteId} onDelete={orders.actions.voidOrder} showTimestamp={true} />
          <Section
            title="COMPLETED"
            status="completed"
            orders={numbered(completedOrders)}
            editingOrderIds={orders.state.editingOrderIds}
            grillIsFull={grillIsFull}
            onEditOrder={orders.actions.startEditingOrder}
            showDelete={true}
            pendingDeleteId={orders.state.pendingDeleteId}
            onDelete={orders.actions.voidOrder}
            showTimestamp={true}
            note={sessionIsLive && sessions.state.completedFilter === 'session' ? 'Showing this session only' : undefined}
          />
        </div>
      </ScreenShell>  );
}
