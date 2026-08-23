import { useCallback, useEffect, useState, useRef } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import { restoreAction, useHistory } from '../lib/history';
import { getAppSetting, setAppSetting } from '../../db/persistence';
import { printOrder, formatTicket } from '../../print/printTicket';
import type { View } from '../lib/navigation';
import type { Order } from '../types';

/**
 * Everything the shop configures, and the two things that read a printer.
 *
 * Settings are the one domain that does not live in the main snapshot: they are
 * key/value rows in `app_state` rather than tables, written individually and
 * loaded individually. That is why this hook does its own persistence instead
 * of going through the save coordinator — there is no shared write for it to
 * be part of.
 */

/** Whole-interface zoom is clamped to what stays usable on a counter-top screen. */
const MIN_UI_SCALE = 0.9;
const MAX_UI_SCALE = 1.5;

const DEFAULT_REVENUE_PIN = '1234';

export function useSettings(currentView: View) {
  const history = useHistory();

  const [autoPrint, setAutoPrint] = useState(false);
  const [printerName, setPrinterName] = useState('');
  const [discountRequiresPin, setDiscountRequiresPin] = useState(false);
  const [taxEnabled, setTaxEnabled] = useState(false);
  const [taxRateInput, setTaxRateInput] = useState('0');
  const [grillCapacityInput, setGrillCapacityInput] = useState('8');
  const [tapToExpandParked, setTapToExpandParked] = useState(false);
  /**
   * Whether the fixed/variable migration notice has been dealt with.
   *
   * A settings row rather than screen state: it is an answer the shop gave
   * once, and asking again after a restart would make it look as though the
   * answer had not been taken.
   */
  const [costBasisNoticeDismissed, setCostBasisNoticeDismissed] = useState(false);
  const [lightMode, setLightMode] = useState(false);
  /** Whole-interface zoom. Larger is easier to hit on a counter-top screen. */
  const [uiScale, setUiScale] = useState(1.12);
  const [fullscreen, setFullscreen] = useState(false);

  const [revenueLocked, setRevenueLocked] = useState(true);
  const [showRevenuePin, setShowRevenuePin] = useState(false);
  const [currentRevenuePin, setCurrentRevenuePin] = useState(DEFAULT_REVENUE_PIN);

  /**
   * Live mirror of the grill capacity, assigned during render.
   *
   * `moveOrder` is called from a drag handler and has to know whether the grill
   * is full at the moment of the drop, not as of the last render it closed
   * over.
   */
  const grillCapacityRef = useRef(8);

  /** Wraps a setting change so it can be taken back like anything else. */
  const recordSetting = useCallback(<T,>(
    label: string, before: T, after: T, apply: (value: T) => void,
  ) => {
    apply(after);
    if (before !== after) history.record(restoreAction(label, 'settings', before, after, apply));
  }, [history]);

  /**
   * Reads the settings rows out of `app_state`.
   *
   * Each is absent until it has been set once, and an absent row means "leave
   * the default alone" rather than "set this to false" — which is why every one
   * of these is a null check rather than a coalesce.
   */
  const hydrate = useCallback(async () => {
    const pin = await getAppSetting('revenue_pin');
    if (pin) {
      setCurrentRevenuePin(pin);
    } else {
      await setAppSetting('revenue_pin', DEFAULT_REVENUE_PIN);
    }

    const savedAutoPrint = await getAppSetting('auto_print');
    if (savedAutoPrint !== null) setAutoPrint(savedAutoPrint === 'true');

    const savedPrinterName = await getAppSetting('printer_name');
    if (savedPrinterName !== null) setPrinterName(savedPrinterName);

    const savedDiscountPin = await getAppSetting('discount_requires_pin');
    if (savedDiscountPin !== null) setDiscountRequiresPin(savedDiscountPin === 'true');

    const savedTaxEnabled = await getAppSetting('tax_enabled');
    if (savedTaxEnabled !== null) setTaxEnabled(savedTaxEnabled === 'true');

    const savedTaxRate = await getAppSetting('tax_rate');
    if (savedTaxRate !== null) setTaxRateInput(savedTaxRate);

    const savedLightMode = await getAppSetting('light_mode');
    if (savedLightMode !== null) setLightMode(savedLightMode === 'true');

    const savedGrillCapacity = await getAppSetting('grill_capacity');
    if (savedGrillCapacity !== null) setGrillCapacityInput(savedGrillCapacity);

    const savedTapToExpand = await getAppSetting('tap_to_expand_parked');
    if (savedTapToExpand !== null) setTapToExpandParked(savedTapToExpand === 'true');

    const savedCostNotice = await getAppSetting('cost_basis_notice_dismissed');
    if (savedCostNotice !== null) setCostBasisNoticeDismissed(savedCostNotice === 'true');

    const savedUiScale = await getAppSetting('ui_scale');
    if (savedUiScale !== null) {
      const parsed = parseFloat(savedUiScale);
      if (Number.isFinite(parsed) && parsed >= MIN_UI_SCALE && parsed <= MAX_UI_SCALE) {
        setUiScale(parsed);
      }
    }
  }, []);

  /**
   * Fullscreen through Tauri where it exists, through the browser where it does
   * not. The state is set either way, so the switch never reads as stuck.
   */
  const applyFullscreen = useCallback(async (next: boolean) => {
    try {
      await getCurrentWindow().setFullscreen(next);
    } catch {
      try {
        if (next) await document.documentElement.requestFullscreen();
        else await document.exitFullscreen();
      } catch {
        // Neither route is available — the setting still reflects the intent.
      }
    }
    setFullscreen(next);
  }, []);

  /** Sends one sample ticket so the printer can be proved before service. */
  const testPrint = useCallback(async () => {
    const testOrder: Order = {
      id: 'test',
      seq: 0,
      orderNumber: 'TEST',
      customerName: 'Test',
      items: [{ menuItemId: 'test', name: 'Test Item', price: 100, quantity: 1 }],
      notes: 'Printer test — please ignore',
      status: 'preparing',
      subtotal: 100,
      discountAmount: 0,
      taxRate: 0,
      taxAmount: 0,
      total: 100,
      timestamp: Date.now(),
      paid: 'cash',
    };
    await invoke('print_ticket', {
      printerName: printerName || '',
      ticketText: formatTicket(testOrder, { storeName: 'Hot Dads POS — Test' }),
    });
  }, [printerName]);

  const printOrderIfNeeded = useCallback(async (order: Order) => {
    if (!autoPrint) return;
    if (order.status !== 'preparing') return;
    try {
      await printOrder(order, printerName || undefined);
    } catch {
      // print unavailable or failed silently
    }
  }, [autoPrint, printerName]);

  const printEditedOrder = useCallback(async (order: Order) => {
    if (!autoPrint) return;
    try {
      await printOrder(order, printerName || undefined, { edited: true });
    } catch {
      // print unavailable or failed silently
    }
  }, [autoPrint, printerName]);

  const printReorderList = useCallback(async (lines: string[]) => {
    try {
      const body = [
        '='.repeat(42),
        '              REORDER LIST',
        '='.repeat(42),
        '',
        new Date().toLocaleString(),
        '',
        ...lines.map(l => `  ${l}`),
        '',
        '='.repeat(42),
        '',
        '',
      ].join('\n');
      await invoke('print_ticket', { printerName: printerName || '', ticketText: body });
    } catch {
      // no printer configured — the list stays on screen
    }
  }, [printerName]);

  const lockRevenue = useCallback(() => {
    setRevenueLocked(true);
    setShowRevenuePin(false);
  }, []);

  const unlockRevenue = useCallback(() => {
    setRevenueLocked(false);
    setShowRevenuePin(false);
  }, []);

  /* --------------------------------------------------------------- effects */

  useEffect(() => {
    // The theme lives in a `.light` class on <html> — setting only the inline
    // background left every CSS variable on its dark value.
    document.documentElement.classList.toggle('light', lightMode);
    const bg = lightMode ? '#fafafa' : '#09090b';
    document.documentElement.style.backgroundColor = bg;
    document.body.style.backgroundColor = bg;
  }, [lightMode]);

  useEffect(() => {
    document.documentElement.style.setProperty('--ui-scale', String(uiScale));
  }, [uiScale]);

  useEffect(() => {
    const onChange = () => {
      setFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  // Revenue relocks itself the moment Analytics is left. Money on screen is
  // opt-in per visit, not per session.
  useEffect(() => {
    if (currentView !== 'analytics') {
      setRevenueLocked(true);
      setShowRevenuePin(false);
      }
  }, [currentView]);

  /** Tax rate in force right now; 0 whenever the setting is switched off. */
  const activeTaxRate = taxEnabled ? Math.max(0, parseFloat(taxRateInput) || 0) : 0;
  const grillCapacity = Math.max(1, parseInt(grillCapacityInput) || 8);
  // Mirror for the drag handlers, assigned during render.
  grillCapacityRef.current = grillCapacity;

  return {
    state: {
      autoPrint,
      printerName,
      discountRequiresPin,
      taxEnabled,
      taxRateInput,
      activeTaxRate,
      grillCapacityInput,
      grillCapacity,
      grillCapacityRef,
      tapToExpandParked,
      costBasisNoticeDismissed,
      lightMode,
      uiScale,
      fullscreen,
      revenueLocked,
      showRevenuePin,
      currentRevenuePin,
    },
    actions: {
      hydrate,
      recordSetting,
      setAutoPrint,
      setPrinterName,
      setDiscountRequiresPin,
      setTaxEnabled,
      setTaxRateInput,
      setGrillCapacityInput,
      setTapToExpandParked,
      setCostBasisNoticeDismissed,
      setLightMode,
      setUiScale,
      setCurrentRevenuePin,
      setShowRevenuePin,
      applyFullscreen,
      testPrint,
      printOrderIfNeeded,
      printEditedOrder,
      printReorderList,
      lockRevenue,
      unlockRevenue,
    },
  };
}

export type SettingsHandle = ReturnType<typeof useSettings>;

/**
 * Writes the settings rows back whenever one changes.
 *
 * Separate from the hook so it can be gated on `dataLoaded`: running before the
 * load has finished would write the defaults over whatever is on disk, which is
 * how a shop loses its tax rate on a slow start.
 */
export function useSettingsPersistence(settings: SettingsHandle, dataLoaded: boolean): void {
  const {
    autoPrint, printerName, discountRequiresPin, taxEnabled, taxRateInput,
    lightMode, grillCapacityInput, tapToExpandParked, uiScale,
    costBasisNoticeDismissed,
  } = settings.state;

  useEffect(() => {
    if (!dataLoaded) return;
    (async () => {
      await setAppSetting('auto_print', String(autoPrint));
      await setAppSetting('printer_name', printerName);
      await setAppSetting('discount_requires_pin', String(discountRequiresPin));
      await setAppSetting('tax_enabled', String(taxEnabled));
      await setAppSetting('tax_rate', taxRateInput);
      await setAppSetting('light_mode', String(lightMode));
      await setAppSetting('grill_capacity', grillCapacityInput);
      await setAppSetting('tap_to_expand_parked', String(tapToExpandParked));
      await setAppSetting('ui_scale', String(uiScale));
      await setAppSetting('cost_basis_notice_dismissed', String(costBasisNoticeDismissed));
    })();
  }, [autoPrint, printerName, discountRequiresPin, taxEnabled, taxRateInput,
      lightMode, grillCapacityInput, tapToExpandParked, uiScale,
      costBasisNoticeDismissed, dataLoaded]);
}
