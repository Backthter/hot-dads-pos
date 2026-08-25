/**
 * Writes the demo database.
 *
 *   pnpm demo:build            build it, and install it beside the real one
 *   pnpm demo:build -- --here  build it in demo/ only, install nothing
 *
 * Two things here are deliberate and worth reading before changing them.
 *
 * **The schema is read out of `src-tauri/src/lib.rs`, not copied.** The real
 * database gets its tables from `run_migrations` at startup; a demo file is
 * created by this script and never sees that function, so a second copy of the
 * DDL here would be correct exactly until the next `add_column_if_missing` and
 * then silently wrong. Parsing the Rust is less pretty and cannot drift. If the
 * parse stops finding what it expects, this script fails rather than writing a
 * database with a hole in it.
 *
 * **The rows are written by the app's own save path.** `saveAllData` needs only
 * `execute` and `select`, so a small `better-sqlite3` adapter is enough to run
 * it outside the app. The alternative was reimplementing twenty INSERT
 * statements, which is the same drift one layer down — and this way the seed is
 * proof that the save path works, not just that the script does.
 *
 * It will not write a file called `hotdads.db`. That is a real shop's takings.
 */
import { createRequire } from 'node:module';
import { existsSync, copyFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDemoSnapshot, describeDemo } from './data';
import {
  breakEvenCrossing, costSummary, itemPerformance, moneyLedger, resolveCosts,
  salesMix, totalsFor,
} from '../src/app/analytics/metrics';
import { eventGroups, ordersForSession } from '../src/app/lib/sessions';
import type { DataSnapshot } from '../src/app/state/core';
import { setDbDriver, type DbLike } from '../src/db/database';
import { loadAllData, saveAllData } from '../src/db/persistence';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

/** The one filename this script must never produce. */
const REAL_DB = 'hotdads.db';
const DEMO_DB = 'hotdads-demo.db';

/* ------------------------------------------------- the schema, from Rust */

/**
 * Every `CREATE TABLE` and every additive column migration, in order.
 *
 * `run_migrations` is one `execute_batch` of `CREATE TABLE IF NOT EXISTS`
 * statements followed by a list of `add_column_if_missing` calls. Both are
 * simple enough to read literally, and reading them is what keeps this file
 * from being a copy that rots.
 */
function schemaFromRust(): { ddl: string; columns: [string, string, string][] } {
  const rust = readFileSync(join(ROOT, 'src-tauri', 'src', 'lib.rs'), 'utf8');

  const batch = rust.match(/conn\.execute_batch\(\s*"((?:[^"\\]|\\.)*)"\s*\)/);
  if (!batch) throw new Error('Could not find the CREATE TABLE batch in lib.rs');
  const ddl = batch[1].replace(/\\"/g, '"').replace(/\\n/g, '\n');
  if (!/CREATE TABLE IF NOT EXISTS orders/.test(ddl)) {
    throw new Error('The batch found in lib.rs does not look like the schema');
  }

  const columns: [string, string, string][] = [];
  const call = /add_column_if_missing\(\s*&conn,\s*"([^"]+)",\s*"([^"]+)",\s*"([^"]+)",?\s*\)/g;
  for (const m of rust.matchAll(call)) {
    columns.push([m[1], m[2], m[3]]);
  }
  if (columns.length < 20) {
    throw new Error(`Only found ${columns.length} column migrations in lib.rs; expected many more`);
  }

  return { ddl, columns };
}

/* ------------------------------------------- better-sqlite3 as a `DbLike` */

/**
 * The thirty lines that let the app's persistence layer run under Node.
 *
 * `undefined` is mapped to `null` because the driver refuses it outright, and
 * because at this layer they mean the same thing — *no value on file*. The
 * distinction invariant 2 protects is between `null` and `0`, and that one is
 * preserved exactly.
 */
function adapter(file: string): DbLike {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');

  const clean = (params: unknown[] = []) => params.map(p => {
    if (p === undefined) return null;
    if (typeof p === 'boolean') return p ? 1 : 0;
    return p;
  });

  return {
    async execute(sql: string, params: unknown[] = []) {
      return db.prepare(sql).run(clean(params));
    },
    async select<T>(sql: string, params: unknown[] = []) {
      return db.prepare(sql).all(clean(params)) as T;
    },
  };
}

/* --------------------------------------------- where the app would find it */

/**
 * The directory Tauri hands the SQL plugin, which is where the app looks.
 *
 * Windows is the platform this stall actually runs on; the other two are here
 * so the script does not simply fail on a developer's laptop.
 */
function appDataDir(): string | null {
  const id = 'com.hotdads.pos';
  if (process.platform === 'win32') {
    return process.env.APPDATA ? join(process.env.APPDATA, id) : null;
  }
  if (process.platform === 'darwin') {
    return process.env.HOME ? join(process.env.HOME, 'Library', 'Application Support', id) : null;
  }
  return process.env.HOME ? join(process.env.HOME, '.local', 'share', id) : null;
}

/* -------------------------------------------------------------------- run */

async function main() {
  const installing = !process.argv.includes('--here');
  const target = join(HERE, DEMO_DB);

  if (target.endsWith(REAL_DB)) throw new Error('Refusing to write the real database');
  for (const suffix of ['', '-wal', '-shm']) {
    rmSync(target + suffix, { force: true });
  }

  const { ddl, columns } = schemaFromRust();
  const raw = new Database(target);
  raw.pragma('journal_mode = WAL');
  raw.exec(ddl);
  for (const [table, column, definition] of columns) {
    const present = raw.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (present.some(c => c.name === column)) continue;
    raw.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
  const tables = (raw.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
  ).all() as { name: string }[]).map(t => t.name);
  raw.close();
  console.log(`Schema from lib.rs: ${tables.length} tables, ${columns.length} column migrations.`);

  const data = buildDemoSnapshot();
  console.log(`Generated: ${describeDemo(data)}`);

  setDbDriver(adapter(target));
  await saveAllData(data);

  // Read it back through the app's own loader. A seed that writes without
  // checking is a seed that produces a database the app cannot open, and finds
  // out about it in the one place nobody is watching — startup.
  const back = await loadAllData();
  setDbDriver(null);
  if (!back) throw new Error('Wrote the database but loadAllData refused it');

  const mismatch = [
    ['orders', back.orders.length, data.orders.length],
    ['menu items', back.menuItems.length, data.menuItems.length],
    ['stock items', back.stockItems.length, data.stockItems.length],
    ['movements', back.stockMovements?.length ?? 0, data.stockMovements.length],
    ['sessions', back.tradingSessions?.length ?? 0, data.tradingSessions.length],
    ['events', back.tradingEvents?.length ?? 0, data.tradingEvents.length],
    ['costs', back.costEntries?.length ?? 0, data.costEntries.length],
  ].filter(([, got, want]) => got !== want);
  if (mismatch.length > 0) {
    throw new Error(`Round trip lost rows: ${mismatch.map(m => `${m[0]} ${m[1]}/${m[2]}`).join(', ')}`);
  }
  console.log('Round trip through loadAllData: every row came back.');

  report(data);

  console.log(`\nWrote ${target}`);

  if (!installing) return;
  const dir = appDataDir();
  if (!dir) {
    console.log('Could not work out the app data directory; skipping install.');
    return;
  }
  mkdirSync(dir, { recursive: true });
  const installed = join(dir, DEMO_DB);
  if (installed.endsWith(REAL_DB)) throw new Error('Refusing to overwrite the real database');
  for (const suffix of ['', '-wal', '-shm']) {
    rmSync(installed + suffix, { force: true });
    if (existsSync(target + suffix)) copyFileSync(target + suffix, installed + suffix);
  }
  console.log(`Installed  ${installed}`);
  console.log(`Left alone ${join(dir, REAL_DB)}`);
}

/**
 * What the dataset actually demonstrates, measured rather than claimed in prose.
 *
 * A demo is only worth having while it still contains the awkward cases, and
 * those are exactly what a later edit smooths away without noticing: raise the
 * delivery sizes a little and the oversells vanish, drop the staff cost and
 * every session breaks even on its second ticket. Measuring them every build
 * makes a change that flattens the dataset visible when it happens, rather than
 * the next time somebody wonders why a column is empty.
 */
function report(data: DataSnapshot) {
  const all = { start: 0, end: Number.MAX_SAFE_INTEGER, label: 'All' };
  const totals = totalsFor(data.orders);
  const mix = salesMix(
    itemPerformance(data.orders, data.menuItems, all), data.menuItems, data.categories);
  const resolved = resolveCosts(costSummary(data.costEntries), totals, 'range', mix);
  const units = mix.reduce((sum, m) => sum + m.units, 0);

  const operating = resolved.fixed
    + resolved.perOrderCost * totals.orders
    + resolved.perUnitCost * units
    + resolved.revenueRate * totals.netRevenue;
  const profit = totals.netRevenue - totals.cogs - operating;

  const ledger = moneyLedger({
    orders: data.orders, costs: data.costEntries, movements: data.stockMovements,
    stockItems: data.stockItems, sessions: data.tradingSessions, mix, range: all,
  });

  const market = eventGroups(data.tradingEvents, data.tradingSessions)
    .find(g => g.sessions.length > 1);
  const busiest = [...data.tradingSessions].sort((a, b) =>
    ordersForSession(data.orders, b.id).length - ordersForSession(data.orders, a.id).length)[0];
  const busiestOrders = ordersForSession(data.orders, busiest.id);
  const crossing = breakEvenCrossing(
    busiestOrders, data.menuItems,
    costSummary(data.costEntries.filter(c => c.sessionId === busiest.id)),
    totalsFor(busiestOrders), 'session', mix);

  const rs = (n: number) => `Rs ${Math.round(n).toLocaleString('en-IN')}`;
  const line = (label: string, value: string) => console.log(`  ${label.padEnd(30)}${value}`);

  console.log('\nWhat this dataset shows');
  line('Takings', rs(totals.netRevenue));
  line('Net profit', `${rs(profit)}  (${((profit / totals.netRevenue) * 100).toFixed(1)}%)`);
  // The lesson the costs explainer teaches, as two figures that disagree.
  line('Cash in less cash out', `${rs(ledger.moneyIn - ledger.moneyOut)}  <- profit is measured on`);
  line('', '   consumption, cash on outlay');
  line('Cost coverage', `${(totals.costCoverage * 100).toFixed(0)}% of lines carry a cost`);
  line('Unpriced deliveries', `${ledger.unpriced}  (an em dash, never Rs 0)`);
  line('Multi-day market', market ? `${market.name}, ${market.sessions.length} sessions` : 'NONE');
  line('Break-even crossing', crossing.order
    ? `${busiest.name}: ticket ${crossing.order.sessionTicket} of ${busiestOrders.length}`
    : `blocked: ${crossing.blocked}`);
  line('Oversells recorded', String(data.oversellEvents.length));
  line('Voided orders', String(totals.voided));
  line('Reversed movements', String(data.stockMovements.filter(m => m.reversed).length));
  line('Below their threshold',
    `${data.stockItems.filter(s => s.quantity <= s.lowStockThreshold).length} stock items`);

  // The cases whose absence would leave a whole screen with nothing to say.
  // Worth failing the build over, because a demo that quietly stops
  // demonstrating anything is worse than no demo: it looks like evidence.
  const missing: string[] = [];
  if (!market) missing.push('a multi-day event');
  if (!crossing.order) missing.push('a break-even crossing');
  if (ledger.unpriced === 0) missing.push('an unpriced delivery');
  if (data.oversellEvents.length === 0) missing.push('an oversell');
  if (totals.voided === 0) missing.push('a voided order');
  if (totals.costCoverage >= 1) missing.push('an uncosted line');
  if (profit <= 0) missing.push('a shop that makes money');
  if (ledger.moneyIn - ledger.moneyOut >= profit) missing.push('cash and profit disagreeing');
  if (missing.length > 0) {
    throw new Error(`The dataset no longer demonstrates: ${missing.join(', ')}`);
  }
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
