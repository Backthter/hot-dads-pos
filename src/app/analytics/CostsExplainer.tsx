import { ArrowLeft } from 'lucide-react';
import { Panel } from './AnalyticsUI';
import { Button, useSection } from '../ui';

/**
 * What the four money-shaped things are, and the rule that separates them.
 *
 * A page rather than a tooltip, and that is a decision rather than an accident.
 * The distinction between what stock *cost to buy* and what stock *cost to use*
 * is the frame the whole reporting rebuild sits inside — every figure in
 * Finance is one or the other — and a frame that only appears when you hover
 * over something is a frame most people never see. It is reachable from Finance
 * and from History · Money, which are the two places the question comes up.
 *
 * Written for somebody who runs a stall, not for somebody who maintains this
 * program: no bases, no ledgers, no consumption model. The vocabulary is
 * deliberately the shop's — a delivery, the till, what you sold.
 */
export function CostsExplainer({ onBack }: { onBack: () => void }) {
  const theme = useSection();

  return (
    <div className="flex flex-col gap-[16px] max-w-[860px]" data-costs-explainer>
      <div className="flex items-center gap-[12px]">
        <Button variant="quiet" size="sm" icon={<ArrowLeft size={16} />} onClick={onBack}>
          Back
        </Button>
        <span className="text-[var(--app-text)] text-[19px] font-bold leading-[24px]">
          What each of these costs means
        </span>
      </div>

      <Panel title="The four things" subtitle="Money moves in four different shapes, and they are not versions of each other">
        <div className="flex flex-col">
          <Thing
            name="Revenue"
            source="Your orders, after any discount, with tax taken out"
            question="What did we sell?"
          />
          <Thing
            name="Ingredient cost"
            source="The cost frozen onto every line at the moment it was rung up"
            question="What did the things we sold cost to make?"
          />
          <Thing
            name="Stock bought"
            source="Your deliveries — what you actually paid the wholesaler"
            question="What money left the till for stock?"
          />
          <Thing
            name="Running costs"
            source="What you log yourself: the pitch fee, staff, fuel, packaging"
            question="What did trading cost, other than ingredients?"
          />
        </div>
      </Panel>

      <div
        className="rounded-[14px] border px-[18px] py-[16px]"
        style={{ borderColor: theme.line, background: 'var(--app-bg-darker)' }}
      >
        <p
          className="text-[17px] font-bold leading-[23px]"
          style={{ color: theme.color }}
        >
          Profit is measured on what you used. Cash is measured on what you bought.
        </p>
        <p className="text-[var(--app-text-secondary)] text-[14px] leading-[21px] mt-[10px]">
          Say a delivery of mince costs you Rs 8,000 on Friday, and over Saturday you
          sell burgers that between them use Rs 900 of it. Both figures are true, and
          neither is the other one worked out wrongly. They are answers to two different
          questions, and the day needs both.
        </p>
        <p className="text-[var(--app-text-secondary)] text-[14px] leading-[21px] mt-[10px]">
          <strong className="text-[var(--app-text)]">Rs 900 is what Saturday cost you.</strong>{' '}
          The rest of the mince is still yours — it is in the freezer, and it will be
          somebody&rsquo;s burger next week. Charging Saturday for all of it would say the
          day lost money when what actually happened is that you went shopping.
        </p>
        <p className="text-[var(--app-text-secondary)] text-[14px] leading-[21px] mt-[10px]">
          <strong className="text-[var(--app-text)]">Rs 8,000 is what left the till.</strong>{' '}
          That is the number that decides whether you can pay the pitch fee this week. A
          profit figure will never tell you that, because profit does not know when you
          paid.
        </p>
      </div>

      <Panel title="Why they are kept apart" subtitle="The mistake this prevents">
        <p className="text-[var(--app-text-secondary)] text-[13.5px] leading-[20px]">
          Put the two together and you get a number that is neither. Add the whole
          delivery to the day it arrived and every shopping day looks like a disaster and
          every other day looks like pure profit — the same trade, told twice, in the
          wrong order. Do the reverse and count only what was eaten, and the shop is
          never told that Rs 8,000 has gone.
        </p>
        <p className="text-[var(--app-text-secondary)] text-[13.5px] leading-[20px] mt-[10px]">
          So the app keeps them separate and says which is which everywhere it shows one.
          Gross profit deducts the ingredients that were actually eaten. Break-even asks
          what has to come in before the day pays for itself. And when you want to know
          where the money went, that is a question about deliveries, and it has its own
          answer.
        </p>
        <p className="text-[var(--app-text-muted)] text-[13px] leading-[19px] mt-[10px]">
          One exception is worth knowing about, because it is the case where the two
          questions genuinely meet. Stock bought <em>for</em> a market, the night before
          it — you can count that against the market with the &ldquo;Earlier stock&rdquo;
          switch beside the period. It is off by default, because it changes what
          break-even means: with it on, the market has to earn back the shopping as well
          as the day.
        </p>
      </Panel>

      <Panel title="Two things that are not costs" subtitle="Kept out on purpose">
        <p className="text-[var(--app-text-secondary)] text-[13.5px] leading-[20px]">
          <strong className="text-[var(--app-text)]">Tax</strong> is collected on the
          state&rsquo;s behalf and was never yours, so it is out of revenue rather than
          counted as a cost of trading.
        </p>
        <p className="text-[var(--app-text-secondary)] text-[13.5px] leading-[20px] mt-[8px]">
          <strong className="text-[var(--app-text)]">Ingredients you log by hand</strong>{' '}
          would be counted twice. What you spend on stock is already worked out from your
          deliveries; typing it in again as a running cost adds it a second time. Running
          costs are for the things the till cannot see.
        </p>
      </Panel>
    </div>
  );
}

function Thing({ name, source, question }: { name: string; source: string; question: string }) {
  return (
    <div
      className="grid gap-[10px] py-[11px] border-b border-[var(--app-border)] last:border-0"
      style={{ gridTemplateColumns: '150px 1fr 1fr' }}
      data-money-thing={name}
    >
      <span className="text-[var(--app-text)] text-[14px] font-bold">{name}</span>
      <span className="text-[var(--app-text-muted)] text-[13px] leading-[19px]">{source}</span>
      <span className="text-[var(--app-text-secondary)] text-[13px] leading-[19px] italic">
        {question}
      </span>
    </div>
  );
}
