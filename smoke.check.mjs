/**
 * A scripted run through the till, for checking that a refactor changed nothing.
 *
 * Not a test suite and not an assertion of correctness — it asserts *sameness*.
 * It drives a real browser through the ordinary work of a service and prints
 * what the screen says at each step. Run it against two builds and diff the
 * output; anything that differs is a behaviour change, whether or not it was
 * meant.
 *
 * This is how Phase 0's extraction of App.tsx was verified. A typecheck cannot
 * see a handler wired to the wrong setter, and neither can a build.
 *
 * Needs a browser and Playwright, neither of which is a dependency of the app:
 *
 *     npm i --no-save playwright && npx playwright install chromium
 *     npm run build && npx vite preview --port 4321 &
 *     node smoke.check.mjs http://localhost:4321
 *
 * The Tauri APIs are absent outside the desktop shell, so the database calls
 * fail and the app runs in memory. That is exactly what is wanted here: the
 * same starting state every run.
 */
import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://localhost:4321';
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
const out = [];
// Wall-clock times differ between two runs a minute apart; the app's
// behaviour does not, so they are normalised out of the comparison.
const say = s => out.push(String(s).replace(/\b\d{2}:\d{2} [AP]M\b/g, '<time>'));

page.on('pageerror', e => say('PAGEERROR: ' + e.message));

const txt = async sel => {
  const l = page.locator(sel).first();
  return (await l.count()) ? (await l.innerText()).replace(/\s+/g, ' ').trim() : '<missing>';
};
const step = async (label, sel) => say(`[${label}] ${await txt(sel)}`);
const click = async (sel, ms = 500) => {
  const l = page.locator(sel).first();
  if (!(await l.count())) { say(`!! no element ${sel}`); return false; }
  await l.click(); await page.waitForTimeout(ms); return true;
};

await page.goto(base, { waitUntil: 'networkidle' });
await page.fill('input[placeholder="Your username"]', 'hottestdad');
await page.fill('input[placeholder="Your password"]', 'root');
await page.locator('button', { hasText: 'Sign in' }).click();
await page.waitForTimeout(1400);

// ---- Order Mode: build a cart
await click('[data-home-tile="order"]', 1000);
await click('[data-menu-tile="Burger"]');
await click('[data-menu-tile="Burger"]');
await click('[data-category-tab="Drinks"]');
await click('[data-menu-tile="Coke"]');
await step('cart', '.scrollbar-light');
await step('totals', 'div.px-\\[14px\\].py-\\[12px\\]');

// ---- discount
const df = page.locator('input[placeholder="–"]').first();
if (await df.count()) { await df.fill('%10'); await df.press('Enter'); await page.waitForTimeout(500); }
await step('totals+discount', 'div.px-\\[14px\\].py-\\[12px\\]');

// ---- pay cash
await click('[data-pay="Cash"]', 1200);
await step('board after checkout', '[data-section="preparing"]');
await step('cart after checkout', '.scrollbar-light');

// ---- second order via a parked session
await click('[data-new-order]', 700);
await click('[data-category-tab="Food"]');
await click('[data-menu-tile="Chicken"]');
await click('[data-pay="Transfer"]', 1200);
await step('board after 2nd', '[data-section="preparing"]');

// ---- All Orders + session
await page.keyboard.press('Alt+ArrowLeft'); await page.waitForTimeout(700);
await click('[data-home-tile="orders"]', 1000);
await click('[data-session-start]', 500);
const nameInput = page.locator('[data-session-name-input]');
if (await nameInput.count()) { await nameInput.fill('Test market'); }
await click('[data-session-start-confirm]', 900);
await step('session bar', '[data-session-bar="active"]');

// ---- third order lands in the session, and is numbered from 1 for the kitchen
await page.keyboard.press('Alt+ArrowLeft'); await page.waitForTimeout(700);
await click('[data-home-tile="order"]', 900);
await click('[data-menu-tile="Burger"]');
await click('[data-pay="Cash"]', 1200);
await step('board with session numbering', '[data-section="preparing"]');

// ---- void the first ticket, twice-press
await page.keyboard.press('Alt+ArrowLeft'); await page.waitForTimeout(600);
await click('[data-home-tile="orders"]', 1000);
const voidBtn = page.locator('[data-void-order]').first();
if (await voidBtn.count()) {
  await voidBtn.click(); await page.waitForTimeout(300);
  say('[void armed] ' + (await voidBtn.innerText()).trim());
  await voidBtn.click(); await page.waitForTimeout(900);
}
await step('board after void', '[data-section="preparing"]');
await step('completed after void', '[data-section="completed"]');

// ---- undo the void (confirms first)
await page.keyboard.press('Control+z'); await page.waitForTimeout(600);
await step('undo confirm', '[role="alertdialog"], [data-confirm-dialog], .fixed');
await page.keyboard.press('Escape'); await page.waitForTimeout(400);

// ---- end the session
await click('[data-session-end]', 900);
await step('session bar after end', '[data-session-bar="active"]');
await step('board at end', '[data-section="preparing"]');

console.log(out.join('\n'));
await browser.close();
