import { chromium } from 'playwright';
import fs from 'fs';
const OUT='/home/claude/shots5'; fs.mkdirSync(OUT,{recursive:true});
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
for (const [w,h,name] of [[1600,1000,'wide'],[1280,800,'mid']]) {
  const page = await b.newPage({ viewport: { width: w, height: h } });
  await page.goto('http://127.0.0.1:5177/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.fill('input[placeholder="Your username"]','hottestdad');
  await page.fill('input[placeholder="Your password"]','root');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1400);
  await page.screenshot({ path: `${OUT}/70-home-${name}.png` });
  if (name === 'wide') {
    await page.locator('[data-home-tile="inventory"]').hover();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/71-home-hover.png` });
  }
  await page.close();
}
await b.close();
console.log('ok');
