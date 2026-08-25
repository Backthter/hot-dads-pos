import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Coins, Info, Plus, Trash2 } from 'lucide-react';
import { ACCENT, Panel, money } from './AnalyticsUI';
import { Button, Select, TextInput, alpha } from '../ui';
import { costSummary } from './metrics';
import {
  COST_BASIS_LABEL, COST_BASIS_UNIT, allEvents, describeCostAmount, describeCostItems,
  describeCostTarget, needsRefiling, targetAfterBasisChange, ungroupedSessions,
} from '../lib/sessions';
import type { EventListing } from '../lib/sessions';
import type { PerEventAvailability } from './scope';
import type {
  Category, CostAppliesTo, CostBasis, CostEntry, MenuItem, TradingEvent, TradingSession,
} from '../types';

/** `14–16 Aug`, or a single day. The span an event actually ran. */
function spanWords(start: number, end?: number): string {
  const day = (ms: number) =>
    new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  if (end === undefined) return `from ${day(start)}`;
  return day(start) === day(end) ? day(start) : `${day(start)}–${day(end)}`;
}

/** The five bases, in the order the form offers them: flat first, then rates. */
const BASES: CostBasis[] = ['per-session', 'per-event', 'per-order', 'per-unit', 'per-revenue'];

/** Which bases are rates rather than flat amounts. Only used for colour. */
const SCALES: Record<CostBasis, boolean> = {
  'per-session': false, 'per-event': false, 'per-order': true, 'per-unit': true, 'per-revenue': true,
};

/** What each basis is for, in the words a stall would use. */
const BASIS_HINT: Record<CostBasis, string> = {
  'per-session': 'Paid once for this service — a pitch fee, a shift',
  'per-event': 'Paid once for the whole market, however many days it runs',
  'per-order': 'Every ticket costs you this — bags, receipt roll, cutlery',
  'per-unit': 'Every item sold costs you this',
  'per-revenue': 'A true percentage — delivery commission, card fees',
};

/**
 * The costs ledger.
 *
 * Ingredient cost comes out of the stock ledger on its own and needs no typing.
 * Everything else — the pitch fee, the staff, the gas, the packaging — is
 * invisible to a till, so the app runs perfectly well without it and simply
 * cannot answer certain questions until it is there. That is the trade this
 * screen makes explicit: log what you spent, get break-even back.
 *
 * Two fields and a toggle, deliberately. A form long enough to feel like
 * bookkeeping is a form nobody fills in at the end of a market day, and a cost
 * ledger with gaps in it is worse than none — it looks complete.
 */
export function CostsPanel({
  costs, sessions, events, menuItems, menuCategories, onAdd, onRefile, onDelete, onMakeEvent,
  scopeLabel, scopedCosts, noticeDismissed, onDismissNotice, perEvent,
}: {
  costs: CostEntry[];
  sessions: TradingSession[];
  events: TradingEvent[];
  /** The menu, for choosing what a `per-unit` cost is charged against. */
  menuItems: MenuItem[];
  menuCategories: Category[];
  onAdd: (
    amount: number,
    note: string,
    basis: CostBasis,
    target?: { sessionId?: string; eventId?: string },
    appliesTo?: CostAppliesTo,
  ) => void;
  /** Changes what a cost is charged per, leaving the amount exactly as typed. */
  onRefile: (id: string, basis: CostBasis) => void;
  onDelete: (id: string) => void;
  /**
   * Makes an event of one containing this session, so a cost can belong to the
   * market rather than to the day.
   *
   * Called from a press and never from a code path. ADR-018 rejects the program
   * creating an event so a basis stops being disabled; what makes this
   * legitimate is that a person pressed a button saying what it would do.
   */
  onMakeEvent: (sessionId: string) => void;
  scopeLabel: string;
  scopedCosts: CostEntry[];
  /** Whether the shop has already dealt with the fixed/variable migration. */
  noticeDismissed: boolean;
  onDismissNotice: () => void;
  /**
   * Whether `per-event` has anywhere to go from the scope this panel was opened
   * in, and what to say when it has not. Resolved by `resolveScope`, not worked
   * out here — the panel and the figures have to agree about the same market
   * (ADR-018).
   */
  perEvent: PerEventAvailability;
}) {
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [basisPicked, setBasisPicked] = useState<CostBasis>('per-session');
  const [error, setError] = useState('');
  /** Empty means "whatever is trading now", which is the usual case. */
  const [target, setTarget] = useState('');
  /**
   * What a `per-unit` cost is charged against (ADR-022). Empty means every
   * item, which is what every cost meant before this existed.
   *
   * Held as one combined string like the target, for the same reason: one
   * select, one value, and no way for a kind and an id to disagree.
   * `items:<id>` or `category:<id>`.
   */
  const [charge, setCharge] = useState('');
  /**
   * Migrated entries the shop has just re-filed, so they leave the list as they
   * are dealt with. Deliberately not persisted: what is on disk is the basis
   * itself, and an entry left as per-session is genuinely still unplaced until
   * the notice is dismissed.
   */
  const [justRefiled, setJustRefiled] = useState<string[]>([]);

  /**
   * The basis actually in force.
   *
   * Derived rather than corrected in an effect: the scope can change under an
   * open panel, and a basis that was legal when it was pressed must not stay
   * selected once it has nothing to attach to. Falling back to `per-session`
   * loses nothing — it is where an unplaceable cost would end up anyway, and
   * the reason is on screen beside the button.
   */
  const basis: CostBasis = !perEvent.available && basisPicked === 'per-event'
    ? 'per-session'
    : basisPicked;

  const live = sessions.find(s => s.status === 'active') ?? null;
  const names = useMemo(() => new Map(sessions.map(s => [s.id, s.name])), [sessions]);
  const eventNames = useMemo(() => new Map(events.map(e => [e.id, e.name])), [events]);

  /**
   * Every event, with its status and what it actually spanned.
   *
   * `allEvents` rather than the raw `events` prop, which is what this read
   * before: the membership is the same — a session-less event is still
   * offerable, and has to be, because the pitch fee is paid on Saturday morning
   * before Sunday exists (ADR-021) — but the raw list carries only a name, so
   * the picker could not say whether an event had traded or when.
   *
   * Note this is deliberately *not* `eventGroups`, which `ScopePicker` uses.
   * That one drops session-less events because there is nothing to report on a
   * period that has not traded; this one keeps them because a plan is a
   * perfectly good thing to file a cost against. The two lists differ on
   * purpose — see `docs/01-DOMAIN.md`.
   */
  const listings = useMemo(() => allEvents(events, sessions), [events, sessions]);
  const loose = useMemo(() => ungroupedSessions(events, sessions), [events, sessions]);

  const describeListing = (l: EventListing) => {
    const span = l.span ? spanWords(l.span.start, l.span.end) : null;
    if (l.sessions.length === 0) return 'Planned · no sessions yet';
    const count = `${l.sessions.length} session${l.sessions.length === 1 ? '' : 's'}`;
    return `${count}${span ? ` · ${span}` : ''}${l.status === 'active' ? ' · running' : ''}`;
  };

  /**
   * Where a cost can be filed.
   *
   * Events come first because they are the reason this exists: a pitch fee for
   * a three-day market is paid once, for the market, and filing it against one
   * of the three days is a choice with no right answer.
   *
   * The list is hierarchical, matching `ScopePicker`, so an event shows what it
   * contains rather than sitting in a flat list beside its own days.
   *
   * **On truncation.** This used to offer the last twelve sessions, newest
   * first, which under a hierarchy reads wrongly: day four of a market could
   * fall outside the window while days one to three were shown, so a shop would
   * see "Winter Market, 3 sessions" above a market that ran four. An event's
   * own sessions are the thing the hierarchy exists to show, so they are never
   * truncated — every session of a listed event is listed. The bound moved to
   * the two lists that have no containment to break: twelve events, and twelve
   * sessions belonging to none.
   *
   * A per-event cost can only be filed against an event, so under that basis
   * the sessions drop out entirely rather than being offered and then refused.
   * The events keep their detail line, so what a market contains is still
   * legible without the rows being selectable.
   */
  const targets = useMemo(() => {
    const shownEvents = listings.slice(0, 12);
    if (basis === 'per-event') {
      return [
        { value: '', label: 'Pick an event' },
        ...shownEvents.map(l => ({
          value: `event:${l.event.id}`, label: l.event.name, detail: describeListing(l),
        })),
      ];
    }
    return [
      { value: '', label: live ? `${live.name} (trading now)` : 'No session — dated only' },
      ...shownEvents.flatMap(l => [
        {
          value: `event:${l.event.id}`, label: l.event.name,
          detail: `Whole event · ${describeListing(l)}`,
        },
        ...l.sessions.map(session => ({
          value: `session:${session.id}`, label: session.name,
          detail: 'One session', depth: 1,
        })),
      ]),
      ...loose.slice(0, 12).map(session => ({
        value: `session:${session.id}`, label: session.name, detail: 'Not in an event',
      })),
    ];
  }, [basis, listings, loose, live]);
  const scoped = useMemo(() => costSummary(scopedCosts), [scopedCosts]);
  const history = useMemo(() => [...costs].sort((a, b) => b.timestamp - a.timestamp), [costs]);

  /**
   * What the migration left unplaced: everything that used to say `variable`
   * and has not been re-filed since. Shown once, until it is dismissed.
   */
  const migrated = useMemo(
    () => (noticeDismissed ? [] : history.filter(c => needsRefiling(c) && !justRefiled.includes(c.id))),
    [history, noticeDismissed, justRefiled]);

  const unit = COST_BASIS_UNIT[basis];

  /* ---------------------------------- what a per-unit cost is charged against */

  /**
   * The item and category options, categories first.
   *
   * A category is offered by **id** while the menu stores an item's category by
   * name — the join happens here and in `salesMix`, and nowhere else. Storing
   * the name instead would break on a rename: every item's category is
   * rewritten and the cost's target is not, so it would quietly stop matching.
   */
  const chargeOptions = useMemo(() => [
    { value: '', label: 'Every item sold' },
    ...menuCategories.map(c => ({
      value: `category:${c.id}`, label: c.name, detail: 'Everything in this category',
    })),
    ...menuItems.map(m => ({
      value: `items:${m.id}`, label: m.name, detail: m.category, depth: 1,
    })),
  ], [menuCategories, menuItems]);

  /** The state above, as the field that is stored. Undefined means every item. */
  const appliesTo = useMemo((): CostAppliesTo | undefined => {
    if (basis !== 'per-unit' || !charge) return undefined;
    const [kind, id] = charge.split(':');
    if (kind === 'category') return { kind: 'category', id };
    if (kind === 'items') return { kind: 'items', ids: [id] };
    return undefined;
  }, [basis, charge]);

  /* ------------------------------------------ what this is about to be filed as */

  /**
   * The attachment, stated under the basis rather than left to a dropdown
   * value. `Whole event` and `Winter Market` are both true, and neither says
   * that the amount is paid once for three days of trading.
   */
  const attachment = useMemo(() => {
    const [kindOfTarget, id] = target.split(':');
    const listing = kindOfTarget === 'event' ? listings.find(l => l.event.id === id) : undefined;
    const session = kindOfTarget === 'session'
      ? sessions.find(sn => sn.id === id)
      : (kindOfTarget === 'event' ? undefined : live);
    return describeCostTarget({
      basis,
      ...(listing ? {
        event: {
          name: listing.event.name,
          sessionCount: listing.sessions.length,
          ...(listing.span ? { span: spanWords(listing.span.start, listing.span.end) } : {}),
        },
      } : {}),
      ...(session ? { session: { name: session.name } } : {}),
    });
  }, [basis, target, listings, sessions, live]);

  /** The same sentence for the items, when the basis is the one that has them. */
  const itemAttachment = useMemo(() => {
    if (basis !== 'per-unit') return null;
    return describeCostItems(appliesTo, {
      items: appliesTo?.kind === 'items'
        ? appliesTo.ids.map(id => menuItems.find(m => m.id === id)?.name ?? 'an item that is gone')
        : [],
      ...(appliesTo?.kind === 'category'
        ? { category: menuCategories.find(c => c.id === appliesTo.id)?.name }
        : {}),
    });
  }, [basis, appliesTo, menuItems, menuCategories]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const value = parseFloat(amount.replace(/[^\d.]/g, ''));
    if (!Number.isFinite(value) || value <= 0) {
      setError('Enter an amount over 0');
      return;
    }
    const [kindOfTarget, id] = target.split(':');
    // A per-event cost is paid once for the whole event, so without one there
    // is nothing for it to belong to and no figure it would appear in. The
    // basis is not offered at all when the scope has no event (ADR-018); this
    // stays as the guard of last resort.
    if (basis === 'per-event' && kindOfTarget !== 'event') {
      setError('Pick the event this was paid for');
      return;
    }
    onAdd(
      value, note, basis,
      id ? (kindOfTarget === 'event' ? { eventId: id } : { sessionId: id }) : undefined,
      // Only ever sent on the basis it means something on. `assertCostEntry`
      // refuses it elsewhere, and this is what keeps a target from surviving a
      // basis change into a filing where nothing would read it (ADR-022).
      appliesTo,
    );
    setAmount('');
    setNote('');
    setError('');
  };

  const refile = (id: string, next: CostBasis) => {
    onRefile(id, next);
    setJustRefiled(prev => [...prev, id]);
  };

  return (
    <div className="flex flex-col gap-[16px]">
      {migrated.length > 0 && (
        <MigrationNotice
          entries={migrated}
          onRefile={refile}
          onDismiss={onDismissNotice}
          hasEvents={events.length > 0}
        />
      )}

      <div className="grid gap-[16px]" style={{ gridTemplateColumns: '1fr 1.25fr' }}>
        <Panel title="Log a cost" subtitle={live ? `This will be counted against ${live.name}` : 'No session running — it will just be dated'}>
          <form onSubmit={submit} className="flex flex-col gap-[10px]">
            {/*
              The unit comes from the basis and is shown beside the number,
              because the same 18 is Rs 18 under one basis and 18% under
              another — and an amount whose unit is only implied is the kind of
              thing that gets typed once and read wrongly for a year.
            */}
            <div className="flex items-start gap-[8px]">
              <div className="flex-1">
                <TextInput
                  value={amount}
                  onChange={e => { setAmount(e.target.value); setError(''); }}
                  inputMode="decimal"
                  placeholder="0"
                  data-cost-amount
                  icon={unit.prefix
                    ? <span className="text-[var(--app-text-muted)] text-[14px] font-bold">{unit.prefix}</span>
                    : undefined}
                  error={error || undefined}
                />
              </div>
              <span
                className="text-[var(--app-text-secondary)] text-[13px] leading-[38px] shrink-0"
                data-cost-unit={basis}
              >
                {unit.suffix}
              </span>
            </div>

            <TextInput
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="What was it for?"
              data-cost-note
            />

            <Select
              label="Counts against"
              value={target}
              onChange={setTarget}
              options={targets}
            />

            {/*
              What a per-unit cost rides on. Only this basis has items to name:
              a cost charged once for a service, or per ticket, or as a share of
              sales, has no item for the amount to be divided by, and offering
              the control there would suggest a filter every figure ignores
              (ADR-022).
            */}
            {basis === 'per-unit' && (
              <Select
                label="Charged on"
                value={charge}
                onChange={setCharge}
                options={chargeOptions}
              />
            )}

            <div className="grid gap-[6px]" style={{ gridTemplateColumns: '1fr 1fr' }}>
              {BASES.map((b, index) => {
                // Offered only when it has somewhere to go. The alternative —
                // offering it and refusing the submission — was the bug 1A-ii
                // recorded: the basis was reachable from a lone session and
                // could not attach to anything (ADR-018).
                const disabled = b === 'per-event' && !perEvent.available;
                return (
                  <button
                    key={b}
                    type="button"
                    disabled={disabled}
                    aria-disabled={disabled}
                    title={disabled ? perEvent.reason : undefined}
                    onClick={() => {
                      if (disabled) return;
                      setBasisPicked(b);
                      setError('');
                      // The session that was picked is not on offer under
                      // per-event, and leaving it selected would show a control
                      // whose value is not one of its options. The rule is a
                      // pure function so that a rewrite of this control cannot
                      // drop it silently; it is checked in metrics.check.ts.
                      setTarget(targetAfterBasisChange(b, target));
                    }}
                    data-cost-basis={b}
                    data-cost-basis-disabled={disabled ? '' : undefined}
                    className="flex flex-col items-start gap-[2px] px-[11px] py-[9px] rounded-[10px] border text-left transition-colors duration-150"
                    style={{
                      gridColumn: index === BASES.length - 1 ? '1 / -1' : undefined,
                      borderColor: basis === b ? ACCENT : 'var(--app-border)',
                      background: basis === b ? alpha(ACCENT, 0.13) : 'transparent',
                      opacity: disabled ? 0.45 : 1,
                      cursor: disabled ? 'not-allowed' : 'pointer',
                    }}
                  >
                    <span
                      className="text-[13px] font-semibold"
                      style={{ color: basis === b ? ACCENT : 'var(--app-text)' }}
                    >
                      {COST_BASIS_LABEL[b]}
                    </span>
                    <span className="text-[10.5px] text-[var(--app-text-muted)] leading-[14px]">
                      {disabled ? perEvent.reason : BASIS_HINT[b]}
                    </span>
                  </button>
                );
              })}
            </div>

            {/*
              What this will actually be filed as, in a sentence.

              Under the basis rather than beside the dropdown, because it is the
              consequence of every control above it taken together — the basis
              says what the amount is charged per, the target says whose it is,
              and neither alone tells the shop that Rs 3,000 is about to be paid
              once for three days of trading.
            */}
            <div
              className="flex flex-col gap-[3px] px-[11px] py-[9px] rounded-[10px] border"
              style={{ borderColor: alpha(ACCENT, 0.35), background: alpha(ACCENT, 0.07) }}
              data-cost-attachment={basis}
            >
              <span className="text-[12.5px] leading-[17px] text-[var(--app-text)]">
                {attachment}
              </span>
              {itemAttachment && (
                <span
                  className="text-[12.5px] leading-[17px] text-[var(--app-text-secondary)]"
                  data-cost-item-attachment
                >
                  {itemAttachment}
                </span>
              )}
            </div>

            {/*
              The dead end, turned into the thing the shop was trying to do.

              1C-i correctly disabled `per-event` where it had nowhere to go and
              said why — but "group the sessions first" is an instruction to go
              somewhere else and come back. Where the scope is one session in no
              event, there is exactly one session to group, and the shop can say
              so from here.

              ADR-018 still stands: the program is not inventing the event. The
              button names what it will make and a person presses it.
            */}
            {!perEvent.available && perEvent.makeable && (
              <div
                className="flex flex-col items-start gap-[7px] px-[11px] py-[10px] rounded-[10px] border"
                style={{ borderColor: 'var(--app-border)', background: 'var(--app-bg-darker)' }}
                data-cost-make-event
              >
                <span className="text-[12.5px] leading-[17px] text-[var(--app-text-secondary)]">
                  {perEvent.makeable.name} isn&rsquo;t part of an event. Make it one and this cost
                  can belong to the market rather than to the day.
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => onMakeEvent(perEvent.makeable!.sessionId)}
                  data-cost-make-event-action
                >
                  Make {perEvent.makeable.name} an event
                </Button>
              </div>
            )}

            <Button type="submit" variant="primary" block data-cost-add icon={<Plus size={16} />}>
              Add cost
            </Button>

            <p className="flex items-start gap-[7px] text-[var(--app-text-muted)] text-[11.5px] leading-[16px] mt-[2px]">
              <Info size={12} className="shrink-0 mt-[2px]" />
              Do not log ingredients here — those are already worked out from your stock, and
              entering them again would count them twice. What a cost is charged <em>per</em>
              {' '}genuinely matters: Rs 4 a ticket and Rs 4 for the day are different amounts of
              money, and it changes what you need to take before the day breaks even.
            </p>
          </form>
        </Panel>

        <Panel title={`Costs · ${scopeLabel}`} subtitle="What this period has cost you so far">
          {/*
            One figure per basis, and a total that adds only the two that are
            already money. A rate is shown with its unit rather than folded into
            the total, because Rs 4 a ticket only becomes rupees once you know
            how many tickets — which is a different question from what this
            period has cost so far.
          */}
          <div className="grid grid-cols-3 gap-[10px]">
            <Figure label="Per session" value={scoped.byBasis['per-session']} />
            <Figure label="Whole event" value={scoped.byBasis['per-event']} />
            <Figure label="Committed" value={scoped.total} strong />
          </div>
          <div className="grid grid-cols-3 gap-[10px] mt-[10px]">
            <Figure label="Per ticket" value={scoped.byBasis['per-order']} suffix="/ ticket" />
            <Figure label="Per item" value={scoped.byBasis['per-unit']} suffix="/ item" />
            <Figure label="Share of sales" value={scoped.byBasis['per-revenue']} percent />
          </div>
          {scoped.entries === 0 && (
            <p className="text-[var(--app-text-muted)] text-[12px] leading-[17px] mt-[12px]">
              Nothing logged for this period yet. Until there is, break-even cannot be worked
              out — the app will not show it as zero, because zero would be a lie: it simply
              does not know what the day costs you.
            </p>
          )}
        </Panel>
      </div>

      <Panel title="History" subtitle={`${history.length} entr${history.length === 1 ? 'y' : 'ies'}, newest first`}>
        {history.length === 0 ? (
          <p className="text-[var(--app-text-muted)] text-[13px] py-[18px] text-center">
            No costs logged yet.
          </p>
        ) : (
          <div className="flex flex-col">
            <AnimatePresence initial={false}>
              {history.map(entry => (
                <motion.div
                  key={entry.id}
                  layout
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ type: 'spring', stiffness: 480, damping: 38 }}
                  className="overflow-hidden"
                >
                  <div
                    className="flex items-center gap-[11px] py-[9px] border-b border-[var(--app-border)]"
                    data-cost-row={entry.id}
                  >
                    <Coins size={15} style={{ color: SCALES[entry.basis] ? '#76DFDA' : ACCENT }} />
                    <span className="text-[var(--app-text)] text-[13px] font-semibold tabular-nums w-[132px]">
                      {describeCostAmount(entry)}
                    </span>
                    <span
                      className="text-[10px] font-bold uppercase tracking-[0.4px] px-[7px] h-[19px] rounded-[5px] flex items-center"
                      style={{
                        color: SCALES[entry.basis] ? '#76DFDA' : ACCENT,
                        border: `1px solid ${SCALES[entry.basis] ? '#76DFDA55' : `${ACCENT}55`}`,
                      }}
                    >
                      {COST_BASIS_LABEL[entry.basis]}
                    </span>
                    <span className="text-[var(--app-text-secondary)] text-[13px] truncate flex-1">
                      {entry.note || <em className="text-[var(--app-text-muted)]">No note</em>}
                    </span>
                    <span className="text-[var(--app-text-muted)] text-[11px] shrink-0">
                      {entry.eventId
                        ? `${eventNames.get(entry.eventId) ?? 'Deleted event'} · whole event`
                        : entry.sessionId
                          ? names.get(entry.sessionId) ?? 'Deleted session'
                          : 'No session'}
                    </span>
                    <span className="text-[var(--app-text-muted)] text-[11px] shrink-0 w-[104px] text-right">
                      {new Date(entry.timestamp).toLocaleString(undefined, {
                        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                      })}
                    </span>
                    <button
                      onClick={() => onDelete(entry.id)}
                      data-cost-delete={entry.id}
                      className="text-[var(--app-text-muted)] hover:text-[#F9624E] transition-colors shrink-0"
                      title="Remove"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </Panel>
    </div>
  );
}

function Figure({ label, value, strong, suffix, percent }: {
  label: string;
  value: number;
  strong?: boolean;
  /** Shown after the amount for a rate — `/ ticket`, `/ item`. */
  suffix?: string;
  /** Renders percentage points rather than rupees. */
  percent?: boolean;
}) {
  return (
    <div className="rounded-[11px] border border-[var(--app-border)] bg-[var(--app-surface)] px-[13px] py-[11px]">
      <span className="block text-[var(--app-text-muted)] text-[11px] uppercase tracking-[0.5px] font-semibold">
        {label}
      </span>
      <span
        className="block text-[21px] leading-[26px] tabular-nums mt-[3px]"
        style={{ color: strong ? ACCENT : 'var(--app-text)', fontWeight: strong ? 800 : 700 }}
      >
        {percent ? `${Math.round(value * 100) / 100}%` : money(value)}
        {suffix && (
          <span className="text-[12px] font-semibold text-[var(--app-text-muted)] ml-[4px]">
            {suffix}
          </span>
        )}
      </span>
    </div>
  );
}

/**
 * The one-time notice for costs the fixed/variable migration could not place.
 *
 * Every row written before Phase 1A became `per-session`, including the ones
 * filed as `variable`. That is deliberate: deciding from a cost's name that
 * "fuel" was really a share of sales would invent information, and the figure
 * it changed would be one the shop has already read and acted on. So the rows
 * that said `variable` are listed here with what they used to say, and the shop
 * — which knows what it bought — puts each one where it belongs.
 *
 * Dismissing is a real answer, not a way out of the question: "they were all
 * per-session" is true for most stalls, whose variable costs were packaging
 * bought in one go for the day. It is remembered, so this is asked once.
 */
function MigrationNotice({ entries, onRefile, onDismiss, hasEvents }: {
  entries: CostEntry[];
  onRefile: (id: string, basis: CostBasis) => void;
  onDismiss: () => void;
  hasEvents: boolean;
}) {
  return (
    <div
      className="rounded-[13px] border px-[15px] py-[13px]"
      style={{ borderColor: alpha(ACCENT, 0.4), background: alpha(ACCENT, 0.07) }}
      data-cost-migration-notice
    >
      <div className="flex items-start gap-[9px]">
        <Info size={15} style={{ color: ACCENT }} className="shrink-0 mt-[2px]" />
        <div className="flex-1">
          <p className="text-[var(--app-text)] text-[13px] font-semibold leading-[18px]">
            {entries.length} cost{entries.length === 1 ? '' : 's'} used to be filed as “variable”
          </p>
          <p className="text-[var(--app-text-muted)] text-[11.5px] leading-[16px] mt-[3px]">
            Costs now say what they are charged <em>per</em> — a ticket, an item, a share of
            sales — instead of just “variable”, which never said what it varied with. These
            were moved to “per session” and left alone rather than guessed at, because
            guessing would have changed figures you have already seen. Put any that were
            really per-ticket or per-item where they belong.
          </p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          data-cost-migration-dismiss
          className="text-[var(--app-text-muted)] hover:text-[var(--app-text)] text-[11.5px] font-semibold shrink-0 transition-colors"
        >
          They are right as they are
        </button>
      </div>

      <div className="flex flex-col mt-[10px]">
        {entries.map(entry => (
          <div
            key={entry.id}
            className="flex items-center gap-[10px] py-[7px] border-t"
            style={{ borderColor: 'var(--app-border)' }}
            data-cost-migration-row={entry.id}
          >
            <span className="text-[var(--app-text)] text-[13px] font-semibold tabular-nums w-[92px]">
              {money(entry.amount)}
            </span>
            <span
              className="text-[10px] font-bold uppercase tracking-[0.4px] px-[7px] h-[19px] rounded-[5px] flex items-center shrink-0"
              style={{ color: '#76DFDA', border: '1px solid #76DFDA55' }}
              title="What this cost was filed as before"
            >
              was {entry.kind}
            </span>
            <span className="text-[var(--app-text-secondary)] text-[13px] truncate flex-1">
              {entry.note || <em className="text-[var(--app-text-muted)]">No note</em>}
            </span>
            <div className="w-[168px] shrink-0">
              <Select
                value={entry.basis}
                onChange={next => onRefile(entry.id, next as CostBasis)}
                options={BASES
                  // A cost with no event cannot be filed against one, and
                  // offering the choice only to refuse it is worse than not
                  // offering it.
                  .filter(b => b !== 'per-event' || (hasEvents && Boolean(entry.eventId)))
                  .map(b => ({ value: b, label: COST_BASIS_LABEL[b] }))}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
