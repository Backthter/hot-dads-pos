import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { invoke } from '@tauri-apps/api/core';
import { Check, ChevronDown, Download, FileSpreadsheet, FolderOpen } from 'lucide-react';
import {
  Button, DANGER, HINT, Popover, PopoverNote, SUCCESS as GOOD, Tooltip,
  DURATION, ELEVATION, alpha, useSection,
} from '../ui';
import { buildDataWorkbook, buildSummaryWorkbook, exportFileName } from './workbook';
import { resolveRange } from './metrics';
import type {
  CostEntry, InventorySnapshot, MenuItem, MenuItemStockAssignment, Order, OversellEvent,
  StockItem, StockMovement, TradingEvent, TradingSession,
} from '../types';

/**
 * Export, as a dropdown rather than a screen of its own.
 *
 * A whole tab for two buttons was a tab's worth of chrome for a job that takes
 * one click, and it sat furthest from the numbers people actually want to take
 * away with them. It now lives beside them.
 *
 * The export ignores whatever scope the screen is showing and always writes
 * everything. A workbook is opened weeks later, by which point nobody
 * remembers which filter was on when it was made — and a spreadsheet silently
 * missing half the year is worse than a large one.
 */
export interface ExportMenuProps {
  orders: Order[];
  menuItems: MenuItem[];
  stockItems: StockItem[];
  assignments: MenuItemStockAssignment[];
  movements: StockMovement[];
  snapshots: InventorySnapshot[];
  oversells: OversellEvent[];
  sessions: TradingSession[];
  events: TradingEvent[];
  costs: CostEntry[];
  taxEnabled: boolean;
}

export function ExportMenu(props: ExportMenuProps) {
  const [folder, setFolder] = useState('');
  const [busy, setBusy] = useState(false);
  const [written, setWritten] = useState<string[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    invoke<string>('export_folder').then(setFolder).catch(() => setFolder(''));
  }, []);

  const run = async (which: 'both' | 'data' | 'summary') => {
    setBusy(true);
    setError('');
    setWritten([]);
    const generatedAt = Date.now();
    // Everything, always — see the note above.
    const range = resolveRange('all', undefined, generatedAt);
    const input = { ...props, range, generatedAt };

    try {
      const files: { name: string; bytes: Uint8Array }[] = [];
      if (which !== 'summary') {
        files.push({ name: exportFileName('data', generatedAt), bytes: buildDataWorkbook(input) });
      }
      if (which !== 'data') {
        files.push({ name: exportFileName('summary', generatedAt), bytes: buildSummaryWorkbook(input) });
      }

      const paths: string[] = [];
      for (const file of files) {
        paths.push(await invoke<string>('write_export', {
          fileName: file.name,
          contents: Array.from(file.bytes),
        }));
      }
      setWritten(paths);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Popover
      label="Export"
      width={370}
      trigger={({ open, toggle }) => (
        <Tooltip label={HINT.exportData}>
          <Button
            variant="secondary"
            onClick={toggle}
            active={open}
            data-export-menu
            icon={<Download size={18} />}
            trailing={
              <motion.span animate={{ rotate: open ? 180 : 0 }} className="flex">
                <ChevronDown size={16} />
              </motion.span>
            }
          >
            Export
          </Button>
        </Tooltip>
      )}
    >
      <div className="flex flex-col gap-[8px]">
              <PopoverNote>
                Two spreadsheets covering everything on record — {props.orders.length} orders,
                {' '}{props.sessions.length} session{props.sessions.length === 1 ? '' : 's'} and
                {' '}{props.costs.length} logged cost{props.costs.length === 1 ? '' : 's'}. Whatever
                period the screen is showing, these always contain the lot.
              </PopoverNote>

              <Option
                title="Every record"
                detail="One row per thing that happened — orders, the items on them, payments, sessions, costs, stock movements and recipes. The shape to use if you want to build your own PivotTables."
                onClick={() => run('data')}
                busy={busy}
                testId="data"
              />
              <Option
                title="Worked-out summary"
                detail="The figures already calculated — takings, break-even, food cost, best and worst sellers, what sells together, and the reorder list. This is the one to read."
                onClick={() => run('summary')}
                busy={busy}
                testId="summary"
              />

              <Button
                variant="primary"
                block
                onClick={() => run('both')}
                disabled={busy}
                data-export-both
                icon={busy ? undefined : <Download size={16} />}
              >
                {busy ? 'Writing…' : 'Save both'}
              </Button>

              {folder && (
                <span className="flex items-center gap-[6px] text-[var(--app-text-muted)] text-[10.5px] px-[3px] break-all">
                  <FolderOpen size={11} className="shrink-0" /> {folder}
                </span>
              )}

              <AnimatePresence>
                {written.length > 0 && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden"
                    data-export-result
                  >
                    <div className="rounded-[10px] border px-[11px] py-[9px] flex flex-col gap-[3px]"
                      style={{ borderColor: alpha(GOOD, 0.4), background: alpha(GOOD, 0.08) }}>
                      <span className="flex items-center gap-[6px] text-[12px] font-semibold" style={{ color: GOOD }}>
                        <Check size={13} /> Saved
                      </span>
                      {written.map(path => (
                        <span key={path} className="text-[var(--app-text-secondary)] text-[10.5px] break-all">
                          {path}
                        </span>
                      ))}
                    </div>
                  </motion.div>
                )}

                {error && (
                  <motion.p
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    className="text-[11.5px] px-[3px]" style={{ color: DANGER }}
                    data-export-error
                  >
                    {error.includes('not implemented') || error.includes('undefined')
                      ? 'Saving files only works in the installed app, not in a browser preview.'
                      : error}
                  </motion.p>
                )}
              </AnimatePresence>
      </div>
    </Popover>
  );
}

function Option({
  title, detail, onClick, busy, testId,
}: { title: string; detail: string; onClick: () => void; busy: boolean; testId: string }) {
  const theme = useSection();
  const [hover, setHover] = useState(false);
  return (
    <motion.button
      onClick={onClick}
      disabled={busy}
      onHoverStart={() => setHover(true)}
      onHoverEnd={() => setHover(false)}
      whileTap={{ scale: 0.99 }}
      data-export-option={testId}
      className="text-left rounded-[12px] border p-[12px]"
      style={{
        opacity: busy ? 0.5 : 1,
        background: hover ? `${theme.gradientSoft}, var(--app-surface)` : 'var(--app-surface)',
        borderColor: hover ? theme.line : 'var(--app-border)',
        boxShadow: hover ? ELEVATION.low : 'none',
        transitionProperty: 'background-image, border-color, box-shadow',
        transitionDuration: `${DURATION.fast * 1000}ms`,
      }}
    >
      <span className="flex items-center gap-[7px] text-[var(--app-text)] text-[13.5px] font-bold mb-[4px]">
        <FileSpreadsheet size={15} style={{ color: theme.color }} /> {title}
      </span>
      <span className="block text-[var(--app-text-muted)] text-[11.5px] leading-[16px]">{detail}</span>
    </motion.button>
  );
}
