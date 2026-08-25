# Hot Dads POS — V2, the commercial build

*Begins after V1 ships and has run a real trading season. Everything here assumes
the V1 foundations are in place; where it doesn't, it says so.*

---

## What V1 handed over

If V1 went to plan, V2 starts with five things that would otherwise each be a
month of work:

| From V1 | Why V2 needs it |
|---|---|
| `edition.ts` capability seam | The commercial build is a config, not a fork |
| `updated_at` / `deleted_at` / `origin` on every row | Sync has something to reason about |
| The mutation log | Sync is log shipping, not table diffing |
| Domain hooks instead of a 3,500-line `App.tsx` | A web client can reuse the logic |
| An analytics engine whose numbers are defensible | The thing you're actually selling |

And one thing it deliberately left broken: **authentication.** V1 ships a
plaintext username and password in `app_state` with a hardcoded fallback. That
was the right call for a single-operator build on your own laptop. It is the
first thing that has to go here.

---

## The commercial question, before any code

You proposed $50 base, $100 for web and phone access, with the extra covering
hosting. That pricing has a structural problem worth confronting before you build
against it.

**A one-time fee cannot fund a recurring cost.** Hosting, backups, domain, TLS,
webhook endpoints, monitoring, and the support inbox all cost money every month
for as long as the customer stays. A customer who pays $100 once and stays four
years costs you money for three and a half of them — and the better your product
is, the longer they stay, so success makes the loss worse. This is the failure
mode that kills small software businesses that price like this, and it kills them
slowly enough that they don't notice until the hosting bill is the business.

Three ways out. Pick one before writing the billing code, because it shapes the
licensing architecture:

**Option A — Local is one-time, cloud is a subscription.**
```
Local            $60 one-time, perpetual, offline forever, no account needed
Connected        $60 + $8/month  (or $80/year, two months free)
```
Cleanest and the easiest to explain. The customer understands that the recurring
part is the part that costs you every month, because that's true. This is what
I'd recommend.

**Option B — Everything annual.**
```
Local            $39/year
Connected        $99/year
```
Better revenue predictability, but "you have to keep paying for software on my
own computer" is a harder sell to exactly your market — a stall owner who bought
a cash register once and expects it to keep working.

**Option C — One-time with a bring-your-own-cloud path.**
```
Local            $60 one-time
Connected        $150 one-time, but they point it at their own Supabase/Neon/VPS
Hosted           $10/month if they'd rather you ran it
```
The most honest with a market that hates subscriptions, and it makes the hosted
tier a genuine convenience purchase rather than a tax. Also more support burden,
because now you're debugging other people's Postgres.

Whichever you pick, one thing follows for the architecture: **the local edition
must never phone home.** Not for licence checks, not for telemetry, not for
updates. A stall with no signal must keep taking orders. A licence check that
fails closed at a market on a Saturday is the kind of thing that ends a software
business by word of mouth. Licence validation happens once at activation, writes
a signed offline token, and never asks again.

### Where you actually sit against Zoho

Worth being explicit, because it should drive the feature list more than any
individual feature request:

Zoho POS is part of a suite, is priced per outlet per month, assumes an
accountant somewhere in the picture, and is built for a business that already has
processes. Your advantages are not features — you will lose a feature comparison
badly and permanently. Your advantages are:

1. **It works with no internet.** Zoho does not, meaningfully. For a stall at an
   outdoor market this is not a preference, it's the whole decision.
2. **Setup is minutes, not a project.** No onboarding call, no chart of accounts.
3. **It knows about ingredients.** The stock-ledger-to-recipe-to-margin chain in
   V1 is genuinely better than what most SMB POS systems do, because most of them
   treat stock as a count of finished goods. A burger stall doesn't have finished
   goods; it has mince.
4. **The stall model.** Sessions, events, pitch fees, per-event break-even.
   Nobody at this price point models a trading day that pauses overnight.
5. **One price, no seats.**

Every one of those is a thing V1 already does. The commercial work is not adding
features — it's making them safe to hand to a stranger.

---

## Phase A — The strip-down (and it should be small)

If the V1 seam works, this phase is a config file and a week of testing.

**Off in commercial builds:**
- `grillBoard` — the grill column and capacity. Burger-specific.
- `portionUnits` — *reconsider after a season.* Any bakery, juice bar, or
  butcher has the same grams-to-countable-thing problem. If it proves out on your
  own stall, ship it as a Pro feature rather than cutting it.

**On, and load-bearing:**
- Sessions and events. These are the differentiator. Do not cut them.
- The stock ledger, recipes, costing, oversell tracking.
- Undo/redo. It is unusual at this price point and it makes the software feel
  safe to a nervous first-time user, which matters more than it sounds.

**Removed outright, not gated:**
- The hardcoded `hottestdad`/`root` fallback in `LoginPage.tsx`.
- Any Pakistan-specific default that isn't a setting: the `Rs` prefix, the tax
  model, the phone number format. All become locale config in Phase G.

**The real work of Phase A** is not removal — it's discovering what you'd hard-
coded without noticing. Do this by setting up the app from scratch, on a clean
machine, as a stranger, with no database. What breaks or confuses is the list.
Write it down as you go; that list is Phase G's spec.

---

## Phase B — Accounts and security

This is the phase that has to be right, because it's the one where getting it
wrong means other people's money and other people's data.

### B.1 Credentials

Replace the current scheme entirely:

- **Argon2id** for password hashing, per-user salt, parameters tuned so hashing
  takes ~250ms on a low-end machine. Not bcrypt, not PBKDF2, and absolutely not
  the current plaintext.
- Hashing happens in **Rust**, not JS. `argon2` crate, exposed as a Tauri
  command. Keeps the hash out of the renderer entirely.
- **No password minimums beyond length.** Require 10+ characters, reject the
  top 10k common passwords from a bundled list, and stop there. Complexity rules
  produce `Password1!` and nothing else.
- **A PIN for the till, a password for the account.** These are different
  security objects. A 4-digit PIN unlocks a shift on a shared device and rate-
  limits to five attempts before requiring the account password. The account
  password is never typed at the counter.

### B.2 Roles

Three, and no more, because a fourth means an admin screen and this market will
not use an admin screen:

| Role | Can |
|---|---|
| **Owner** | Everything. Sees revenue, costs, margins. Manages staff. Billing. |
| **Manager** | Everything operational. Sees sales, not costs or margins. Voids with a reason. |
| **Cashier** | Takes orders, moves tickets. No analytics, no settings, no voids without a manager PIN. |

The existing `RevenueLock` / revenue PIN is the seed of this and the concept is
right — generalise it from "a PIN hides revenue" to "a role determines
visibility." Enforce in the data layer, not the view layer: a cashier's query
should not return cost columns at all, so a UI bug can't leak them.

### B.3 Secrets at rest

- API credentials (foodpanda `client_id`/`client_secret`, payment gateway keys)
  go in the **OS keychain** via `keyring-rs` — Windows Credential Manager, macOS
  Keychain, libsecret on Linux. Never in SQLite, never in `app_state`, never in
  a `.env` that ships.
- The local SQLite file gets **SQLCipher** with a key derived from the account
  password and held only in memory. A stolen laptop is the realistic threat
  model here, and a stall laptop gets stolen.
- **Redact secrets from logs and from the diagnostics report.** `diagnoseStorage`
  currently dumps paths and row counts, which is fine, but the moment credentials
  exist it needs an explicit allowlist rather than an explicit denylist.

### B.4 Audit

The mutation log from V1 becomes user-attributed: every entry carries a user id.
Then "who voided ticket 34" and "who changed the burger price on Tuesday" are
queries, not arguments. For a business with two staff and a cash drawer this is,
in practice, the single most requested feature in POS software. It costs almost
nothing here because the log already exists.

---

## Phase C — Sync that survives two devices

### The current state, honestly

The existing sync is in use in the personal build and works — for one person who
knows what it does and does not do. That is a meaningfully different bar from
"works for a stranger with two tills," and the gap is where this phase lives.

`src-tauri/src/sync.rs` pushes whole tables with `INSERT OR REPLACE` over a raw
TCP connection. V1 Phase 0.6 patches the most damaging problem — three tables
(`stock_movements`, `inventory_snapshots`, `oversell_events`) were missing from
`SYNC_TABLES` entirely, so every movement-derived analytics figure was wrong on
any device that wasn't doing the stocking. Assume that patch has landed.

What the patch does **not** fix, and cannot:

- **`INSERT OR REPLACE` on whole tables clobbers concurrent writes.** Two tills
  taking orders at the same market overwrite each other on the next push. Fine
  for one device syncing to a backup; fatal for two devices trading.
- **There is no conflict model at all.** Later push wins, wholesale, per table.
  Nobody is choosing that — it's what falls out of the implementation.
- **Ordering depends on wall clocks**, which disagree, and a market laptop's
  clock is frequently wrong by minutes.
- **No partial or resumable sync.** A dropped connection mid-push leaves an
  indeterminate state.
- **Stock levels are synced as values**, so two devices adjusting the same item
  produce a last-writer-wins level rather than a correct sum.

So this is a rebuild rather than an extension — but a rebuild that can happen
behind the same `sync-client.ts` interface, with the current implementation left
running until the replacement passes the test in C.4. Do not remove the working
one first.

### C.1 The insight that makes this tractable

**Sync the movements, not the levels.**

`StockItem.quantity` is a derived value — the ledger already records `resulting`
on every line, and `ledgerLevelsAt` already reconstructs any point in time. If
levels are derived rather than stored-and-synced, then stock has no conflicts at
all: two devices each appending movements produce a union, and the union is
correct. Device A sells three burgers, device B receives a delivery, and the
merged ledger is simply both, in timestamp order.

Same argument for orders: an order is an immutable fact plus a small set of
append-only state transitions (`grilledAt`, `readyAt`, `voidedAt`). Two devices
cannot conflict on creating different orders. They can only conflict on moving
the *same* ticket, which is rare and resolvable by taking the later transition.

So the conflict surface collapses to a small set:

| Data | Strategy |
|---|---|
| Orders, order items | Append-only. No conflict possible. |
| Stock movements | Append-only. Levels derived. No conflict possible. |
| Cost entries, oversells | Append-only. |
| Sessions, events | Append-only + last-writer-wins on status transitions |
| Menu items, categories, assignments | **Field-level** LWW on `updated_at` |
| Settings | LWW per key |

Only the last two rows can genuinely conflict, and both are low-frequency
config edits where last-writer-wins is what a human would expect anyway.
Field-level rather than row-level matters: two people editing different fields of
the same menu item on different devices should both survive, and row-level LWW
throws one away.

### C.2 Ordering

Wall clocks disagree, and a stall laptop's clock is frequently wrong. Use a
**hybrid logical clock** — `(wallMs, counter, deviceId)` — on every mutation.
Compare on the tuple, not on `Date.now()`. Roughly 40 lines, and it removes an
entire class of "the delivery arrived before it was ordered" bug that is
otherwise impossible to reproduce.

### C.3 The transport

Replace the raw TCP + `cloudsync.dll` arrangement. Recommendation:

- **Postgres** (Supabase or Neon) as the server. Both have generous free tiers
  that will carry the first dozen customers at zero cost, which matters when the
  business model is uncertain.
- A single `mutations` table per tenant: `(id, tenant_id, hlc, device_id,
  entity, op, payload jsonb, created_at)`.
- Push: send mutations since the last acknowledged HLC. Pull: request mutations
  after the local high-water mark. Apply in HLC order. Idempotent by mutation id,
  so a retry after a dropped connection is free.
- **Realtime** via Postgres logical replication (Supabase Realtime) or plain
  polling at 5s. Polling is fine for this scale and much easier to debug; add
  realtime later if the latency actually bothers anyone.
- Offline is the default state, not an error state. The queue drains when there's
  signal. The UI shows a small pending-count, and never blocks an order on it.

### C.4 The test that has to pass

Before this ships, one specific scenario, run as an automated test:

> Two devices, both offline. Device A takes 20 orders and drains 3kg of mince.
> Device B receives a 5kg delivery and edits the burger price. Both reconnect
> simultaneously. Assert: 20 orders present on both, stock level identical on
> both and equal to the ledger replay, price edit present on both, no duplicate
> mutations, and analytics figures identical on both devices.

If that test doesn't pass, sync is not shippable, regardless of how well it
demos.

---

## Phase D — Web and phone

### D.1 The structural move

Extract a `core/` package that has no Tauri and no DOM in it:

```
packages/
  core/        types, metrics, inventory, sessions, scope, workbook — pure TS
  ui/          the design system: tokens, primitives, SectionTheme
  desktop/     Tauri shell, SQLite, printing, keychain
  web/         Vite + React, IndexedDB via SQLite WASM, service worker
  server/      sync endpoint, foodpanda connector, webhook receiver
```

`core/` is already almost this — `metrics.ts`, `lib/inventory.ts`,
`lib/sessions.ts`, and `analytics/scope.ts` are pure functions with no React and
no platform assumptions. That's a considerable head start and it's the direct
payoff of how V1 was structured.

### D.2 The web client is a PWA, not a website

- **SQLite WASM + OPFS** for local storage, so the web client is genuinely
  offline-capable rather than merely cached. Same schema, same queries, same
  `core/` code paths as desktop. This is the single decision that keeps the two
  clients from diverging.
- Service worker for the shell. Installable. Runs full-screen on Android and iOS.
- Same sync protocol as desktop — the web client is just another device.

### D.3 Phone is a different program wearing the same clothes

Do not ship the desktop layout at 390px. Nobody takes orders on a phone the way
they take them on a 15" laptop. The phone build is three screens:

1. **Take order** — single column, large tiles, cart as a bottom sheet.
2. **The board** — tickets as cards, swipe to advance a stage.
3. **Today** — the Finance table's top row and nothing else.

Analytics tables, menu editing, and stock management are desktop-and-tablet
only, and the phone says so plainly rather than rendering an unusable version.
"This works better on a bigger screen" is a better experience than a horizontally
scrolling twelve-column table.

Tablet gets the full layout — a 10" tablet is the real second device for this
market, more than a phone is.

---

## Phase E — Payments

Two entirely different problems that share a word. Both are needed; don't let
them get conflated in planning.

### E.1 Taking money from customers

The market is Pakistan and it is wallet-first. <cite index="18-1">JazzCash and Easypaisa together account for over 85% of mobile wallet transactions in Pakistan</cite>, and card penetration is low. <cite index="11-1">Raast — the State Bank's instant payment rail — moved to Person-to-Merchant in 2023–24 and accelerated through 2025 and 2026, and it lets a customer pay directly from their bank app with no wallet account needed.</cite>

**Recommended shape:**

- **Start with Raast P2M dynamic QR.** Lowest fees, instant settlement, no card
  data anywhere near your stack, and no wallet account required of the customer.
  For a stall, a QR on the counter is also physically the right interaction — no
  terminal, no card reader, no signal needed on the merchant side beyond
  confirming receipt.
- **Then add an aggregator** rather than integrating wallets one at a time.
  Going direct to JazzCash means going direct to Easypaisa separately, then to
  cards separately, each with its own contract, credentials, dashboard and
  reconciliation. <cite index="6-1">Aggregators exist precisely to collapse that into one API endpoint covering JazzCash, Easypaisa, cards and bank transfers.</cite> Safepay, PayFast, and several
  newer aggregators cover this ground; evaluate on published MDR, settlement
  speed (T+1 or better), and whether they'll onboard a micro-merchant without a
  registered company — that last one is the real filter for your market and it
  is not on anybody's pricing page. Ask directly.
- **Build a provider abstraction, not an integration.**
  ```ts
  interface PaymentProvider {
    createCharge(amount: number, ref: string): Promise<Charge>;
    pollStatus(chargeId: string): Promise<ChargeStatus>;
    onWebhook(payload: unknown): ChargeStatus;
  }
  ```
  You will change providers. Everyone does. The abstraction costs a day and saves
  a rewrite.

**Two things that matter more than the integration itself:**

1. **Offline reconciliation.** A digital payment taken while the POS is offline
   must not be lost or double-counted. Every charge gets a local `pending` row
   keyed by order id; the sync layer reconciles against the provider on
   reconnect. Design this before the happy path, because the happy path is easy
   and this is where the money actually goes missing.
2. **The `paid` field has to grow up.** It's currently `'cash' | 'transfer'`.
   It needs to become a `Payment[]` — split payments are common (part cash, part
   wallet), and a single enum cannot express that. Do this in V1 if you can; it's
   a migration and migrations are cheaper before you have customers.

### E.2 Collecting your licence fee

Different problem. You are a Pakistan-based seller with (potentially)
international customers, which constrains the options.

<cite index="22-1">Stripe cannot be used directly from Pakistan — it requires a registered entity in a Stripe-supported country, commonly a US LLC, which brings its own cost and compliance overhead.</cite> The practical route is a **merchant of record**: <cite index="23-1">a platform that acts as the legal seller of your product, collects and remits sales tax, VAT and GST in every jurisdiction, and handles refunds and chargebacks, so you receive a single payout.</cite>

For a desktop app sold with licence keys, this points fairly clearly at
**Lemon Squeezy** — <cite index="25-1">it can generate, validate and deactivate software licence keys natively, which eliminates a significant integration burden for a licence-gated desktop product</cite>. Paddle is the stronger platform for complex subscription billing but has no native licensing.

Both take roughly 5% + $0.50. Verify two things before committing, since they're
the ones that actually bite:

- **Payout method from Pakistan.** Payoneer and Wise are the usual routes; confirm
  which each platform supports for your situation.
- **Onboarding approval.** Both review new accounts, and approval for a
  Pakistan-based seller of a desktop POS is not automatic. Start this process
  early — well before you need it — because a two-week approval delay discovered
  the week you planned to launch is avoidable and infuriating.

**Licensing implementation:**
- Activation exchanges a licence key for a **signed offline token** (Ed25519,
  public key embedded in the binary) containing tier, expiry, and device count.
- The app verifies the signature locally, forever. **No network call at startup.**
- Connected tier: the sync server checks subscription status, and a lapsed
  subscription **stops sync, never stops the POS**. Local operation continues
  indefinitely. Holding someone's till hostage over a failed card is not a
  business you want to be in, and it's the fastest possible way to acquire a
  reputation.

---

## Phase F — foodpanda

### F.1 The 2-hour token is not the problem

You flagged token expiry as threatening the feature's convenience. Reading the
docs, that concern dissolves — the flow is <cite index="4-1">OAuth 2.0 client credentials: you generate a `client_id` and `client_secret` from the Partner Portal, POST them to the token endpoint, and receive a bearer token valid for 2 hours which you include in the `Authorization` header</cite>.

There is no user in that loop. Nobody re-authenticates. The token is a **cache**,
not a session — you hold the client credentials permanently, and when the token
is near expiry you POST for another one. Standard implementation:

```ts
async function token(): Promise<string> {
  if (cached && cached.expiresAt > Date.now() + 5 * 60_000) return cached.value;
  cached = await mint(clientId, clientSecret);   // ~200ms, invisible
  return cached.value;
}
```

Refresh at 90 minutes, retry with backoff on failure, treat a 401 as "mint and
retry once." Roughly 30 lines. The user never sees it.

### F.2 The problems that are real

Four, and they're bigger than token expiry:

**1. It requires a webhook, which requires a public URL.**
<cite index="4-1">The integration requires developing a webhook to receive live order events — `RECEIVED`, `READY_FOR_PICKUP`, `DISPATCHED`, `CANCELLED`, `DELIVERED` — and the technical capacity and infrastructure to receive those updates.</cite> Orders are *pushed to you*. A Tauri app on a laptop behind a home router or a market's phone hotspot cannot receive a push.

This is why the feature cannot exist in the local tier, and it is not a
limitation you can engineer around — it's how the API works. Which is actually
good news commercially: **foodpanda integration is a natural Connected-tier
feature and one of the clearest justifications for the higher price.** It is a
capability the cheap tier physically cannot have.

**2. The eligibility gate is high for your target customer.**
<cite index="4-1">To integrate, a partner needs their own picking solution, API development capability, access to the Partner Portal, access to the Integrations Plugin to configure webhooks, an active store on the platform, and their Account Manager to enable "Direct POS Integration" in the catalog configuration.</cite>

A one-person burger stall does not have an Account Manager on speed dial. Some of
your customers will be able to do this and most will not. Plan support
accordingly: a written walkthrough with screenshots of exactly what to ask the
Account Manager for, and realistic expectations set on the pricing page.

**3. Credentials are per-chain, and capped.**
<cite index="4-1">You can create up to 10 `client_id`s per chain, and a generated token is valid for all stores under that chain.</cite> So you cannot mint credentials per customer from a single account — each customer brings their own `client_id`/`client_secret` from their own Partner Portal. The architecture is **bring-your-own-credentials, stored per tenant**, which is also the right answer for liability: you never hold credentials that let you act as someone else's shop.

**4. There is a second integration mode, and it's the wrong one.**
The docs distinguish Pelican Picking (their app, their device) from Partner
Picking (your software). You want **Partner Picking / Direct POS Integration** —
which means the customer's Account Manager must select that specific
configuration. If they select Indirect, nothing works and the error is nowhere
near the cause. Put this in bold in the setup guide.

### F.3 The architecture

Everything server-side. The desktop app never talks to foodpanda.

```
foodpanda ──webhook──► your server ──► tenant queue ──► sync ──► POS device(s)
POS device ──► mutation ──► your server ──► PUT /orders ──► foodpanda
```

- One HTTPS endpoint, `/webhooks/foodpanda/:tenantId`, with signature
  verification (the docs mandate securing the webhook — treat an unverified
  payload as hostile, not as a bug).
- Incoming orders become normal `Order` rows with `channel: 'foodpanda'`, a
  status mapping to your board states, and the commission recorded as a
  `per-revenue` cost entry — which is exactly the cost basis introduced in V1
  Phase 1.2, and the reason that basis exists.
- Outgoing state changes (accept, ready for pickup, cancel) queue as mutations
  and the server issues the PUT. If the till is offline when the kitchen marks
  ready, the update goes out on reconnect.
- **Menu sync is a separate, later feature.** The Catalog API can push
  availability and price to foodpanda, which would let you mark an item
  unavailable once and have it reflected in both places. Genuinely valuable —
  <cite index="2-1">foodpanda's own figures claim integrated partners see substantially fewer out-of-stock failures</cite> — but it doubles the integration surface. Ship order intake first, prove it works, then do catalog.

### F.4 Sandbox first, and budget more time than seems reasonable

There's a documented sandbox. Use it for everything, and assume the eligibility
and account-manager coordination takes longer than the code. Delivery platform
integrations are, reliably, 20% engineering and 80% waiting for someone's
partner ops team to flip a flag.

---

## Phase G — Everything that makes it a product rather than your program

This is the phase that is easy to underestimate and is usually what determines
whether the thing sells.

### G.1 First run

A stranger opens the app with an empty database. Currently that produces a
program with no menu, no categories, no stock, and no explanation. Needed:

- **A five-minute setup**: business name → currency and locale → business type
  (food stall / cafe / retail / other) → a starter menu for that type they can
  edit or discard → optionally, import from CSV.
- **Sample data they can delete in one press.** Learning an analytics screen with
  no data in it is impossible. Ship a plausible week of trading, clearly marked,
  with one obvious button to wipe it.
- **Progressive disclosure.** Sessions, events, cost bases and recipes are all
  *off* on first run. The app is a till. Each feature offers itself when its
  moment arrives — "you've taken 50 orders; want to see what they cost you?"
  This is the single biggest thing separating your product from Zoho for this
  market, and it's an interaction design problem, not an engineering one.

### G.2 Localisation

- Currency: symbol, position, decimals, thousands separator. `Rs` is hardcoded
  in a dozen places (`money()`, `compactMoney()`, hint strings, the workbook) —
  grep for it and route everything through one formatter.
- Tax: currently a single flat rate. Needs at minimum inclusive-vs-exclusive
  pricing (the difference between most of Europe and most of North America) and
  per-item rates.
- Dates and first-day-of-week already go through `toLocaleDateString`. Good.
- Language: structure for it, ship English only. Urdu is the obvious second, and
  RTL is a real project — don't start it speculatively.

### G.3 Data safety

- **Automatic local backups.** Rolling daily, 30 days, to a folder the user
  chooses. This costs a day and prevents the worst support conversation you will
  ever have.
- **Export everything, always.** The V1 workbook export becomes a guaranteed
  path out — full data, standard formats, no lock-in. Say so on the pricing
  page; for this market, "you can always get your data out" is a purchase
  argument, not a concession.
- **Restore.** Backup without tested restore is theatre. Test it on a real
  corrupted database, not a clean one.

### G.4 Updates

- Tauri's updater with signed releases.
- **Never auto-update during a session.** Check on launch, install on quit. An
  update that restarts the app mid-market is a catastrophe, and this is precisely
  the kind of thing that seems obvious in retrospect.
- Migrations must be forward-only, idempotent, and tested against a real database
  from the previous version. Keep a fixture database per released version in the
  repo and run every migration against every one of them in CI.

### G.5 Support

Budget for it honestly — it will be a larger share of your time than development
once there are more than about twenty customers.

- In-app **diagnostics export**: version, OS, row counts, recent errors, sync
  state, with secrets redacted. `diagnoseStorage` is most of this already.
- A written manual, not a video. People search text.
- One support email, and a public changelog. The `CHANGES.md` you already write
  is unusually good and is most of a public changelog already.

---

## Risks, ranked by how much they'd hurt

**1. Sync corrupts someone's data.**
The worst outcome available. Mitigation: the append-only model in C.1 (which
makes most corruption structurally impossible), the two-device test in C.4, local
backups before every sync-triggered schema change, and a staged rollout — your
own stall, then three friendly customers, then everyone.

**2. Support volume exceeds what one person can carry.**
Mitigation: onboarding quality (G.1) is the lever, not headcount. Every question
you answer twice becomes a manual page. Consider capping the connected tier's
customer count deliberately for the first six months.

**3. The pricing doesn't cover the hosting.**
Mitigation: decide the model *before* Phase C, not after. Instrument per-tenant
cost from the first day of the beta so you know the real number rather than the
estimate.

**4. foodpanda eligibility blocks most customers who want it.**
Mitigation: sell it as "if your foodpanda account has API access, we connect to
it" rather than as a headline feature. Do not put it on the box until you've seen
a real customer complete the setup unaided.

**5. Scope creep from the first ten customers.**
Every one will ask for one thing. Ten different things is a year. Mitigation:
a public roadmap, a policy of building only what three customers ask for
independently, and the knowledge that "simple" is the product.

**6. The web client and the desktop client diverge.**
Mitigation: the shared `core/` package (D.1) with a CI check that neither
`desktop/` nor `web/` contains business logic. Enforce with a lint rule, not with
discipline.

---

## Sequence

**Stage 1 — Safe to hand to a stranger** *(nothing ships before this is done)*
1. Argon2id credentials, roles, keychain, SQLCipher (B.1–B.3)
2. Audit trail on the mutation log (B.4)
3. First-run setup and progressive disclosure (G.1)
4. Currency and locale extraction (G.2)
5. Backups and restore (G.3)
6. Signed updates with tested migrations (G.4)

**Stage 2 — The local edition ships**
7. Edition config and strip-down (A)
8. Licensing: Ed25519 offline tokens, merchant-of-record checkout (E.2)
9. Beta with 3–5 real stalls. Fix what they break. This stage takes longer than
   you plan for and shortening it is the most expensive mistake available.

**Stage 3 — Connected**
10. `core/` extraction into a workspace (D.1)
11. Sync: HLC, mutation shipping, derived stock levels (C.1–C.3)
12. The two-device test, passing (C.4)
13. Web PWA with SQLite WASM (D.2)
14. Phone layouts (D.3)

**Stage 4 — Money**
15. `Payment[]` migration, provider abstraction (E.1)
16. Raast QR
17. One aggregator for wallets and cards

**Stage 5 — Delivery**
18. Server-side foodpanda connector, order intake only (F.3)
19. Catalog sync, once intake is proven

Stage 1 is not optional and not reorderable. Everything after Stage 2 can be
resequenced according to what customers actually ask for — and they will ask for
something not on this list, and that's the point of shipping Stage 2 early.

---

## The thing worth remembering

The temptation, once this is a product, will be to compete on the feature list.
You will lose that. Zoho has more engineers on their POS onboarding flow than you
have hours in a week.

What you have that they structurally cannot have is a program small enough to
understand in an afternoon, that works with no internet, and that knows the
difference between a kilo of mince and a burger. Every feature request should be
measured against whether it costs you one of those three. Most will.
