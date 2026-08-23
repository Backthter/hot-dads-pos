import type { Order, CartItem } from '../app/types';
import { invoke } from '@tauri-apps/api/core';

const LINE = '─'.repeat(42);
const DOUBLE_LINE = '═'.repeat(42);

export interface TicketOptions {
  storeName?: string;
  /** Marks a reprint of an order that was changed after it was first sent. */
  edited?: boolean;
}

export function formatTicket(order: Order, options: TicketOptions | string = {}): string {
  const opts: TicketOptions = typeof options === 'string' ? { storeName: options } : options;
  const storeName = opts.storeName ?? 'Hot Dads POS';
  const now = new Date(order.timestamp);
  const dateStr = now.toLocaleDateString();
  const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const lines: string[] = [];

  lines.push(DOUBLE_LINE);
  lines.push(`              ${storeName}`);
  lines.push(DOUBLE_LINE);
  if (opts.edited) {
    lines.push('');
    lines.push('             *** EDITED ***');
  }
  lines.push('');
  lines.push(`  Order #${order.orderNumber}`);
  lines.push(`  Date: ${dateStr}  ${timeStr}`);
  lines.push(`  Status: ${order.status.toUpperCase()}`);
  if (order.customerName) {
    lines.push(`  Customer: ${order.customerName}`);
  }
  lines.push('');
  lines.push(LINE);

  for (const item of order.items) {
    lines.push(formatItem(item));
  }

  if (order.notes) {
    lines.push(LINE);
    lines.push(`  Notes: ${order.notes}`);
  }

  lines.push(LINE);
  if (order.discountAmount > 0 || order.taxAmount > 0) {
    lines.push(`  SUBTOTAL:              Rs ${order.subtotal.toFixed(0)}`);
    if (order.discountAmount > 0) {
      const label = order.discount?.kind === 'percent'
        ? `DISCOUNT (${order.discount.value}%):`
        : 'DISCOUNT:';
      lines.push(`  ${label.padEnd(21, ' ')}-Rs ${order.discountAmount.toFixed(0)}`);
    }
    if (order.taxAmount > 0) {
      lines.push(`  ${`TAX (${order.taxRate}%):`.padEnd(21, ' ')}+Rs ${order.taxAmount.toFixed(0)}`);
    }
  }
  lines.push(`  TOTAL:                 Rs ${order.total.toFixed(0)}`);
  if (order.paid) {
    lines.push(`  Paid via: ${order.paid.toUpperCase()}`);
  }
  lines.push(DOUBLE_LINE);
  lines.push('');
  lines.push('');

  return lines.join('\n');
}

function formatItem(item: CartItem): string {
  const price = item.price * item.quantity;
  const name = item.name.length > 22 ? item.name.slice(0, 20) + '..' : item.name;
  const paddedName = `  ${name}`.padEnd(26, ' ');
  const qty = `x${item.quantity}`.padStart(4, ' ');
  const paddedPrice = `Rs ${price.toFixed(0)}`.padStart(10, ' ');
  let result = `${paddedName}${qty}${paddedPrice}`;

  if (item.dealItems && item.dealItems.length > 0) {
    for (const di of item.dealItems) {
      // Deal contents print as a total across every copy of the deal.
      result += `\n    · ${di.quantity * item.quantity}x ${di.name}`;
    }
  }

  return result;
}

export async function printOrder(
  order: Order,
  printerName?: string,
  options: TicketOptions = {},
): Promise<void> {
  const ticket = formatTicket(order, options);

  try {
    await invoke('print_ticket', {
      printerName: printerName ?? '',
      ticketText: ticket,
    });
  } catch (err) {
    console.error('Print failed:', err);
  }
}
