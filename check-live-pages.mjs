import { chromium } from 'playwright';

const browser = await chromium.launch();
const out = '/tmp/claude-1000/-workspaces-three-ws/69a867c4-6154-4064-8a14-fe64b7f05e63/scratchpad';

async function shot(path, width, name, prep) {
  const ctx = await browser.newContext({ viewport: { width, height: 1000 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  await page.goto('http://127.0.0.1:8399' + path, { waitUntil: 'load' });
  await page.waitForTimeout(1200);
  if (prep) await prep(page);
  await page.waitForTimeout(800);
  const m = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    cw: document.documentElement.clientWidth,
  }));
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: true });
  console.log(name, JSON.stringify(m), 'errors=' + errors.length, errors.map((e) => e.slice(0, 90)).join(' | '));
  await ctx.close();
}

await shot('/live/dashboard.html', 1440, 'dash-1440');
await shot('/live/dashboard.html', 320, 'dash-320');
await shot('/live/dashboard.html', 1440, 'dash-scanner', async (p) => {
  await p.click('.sidebar nav a[data-page="scanner"]');
});
await shot('/live/dashboard.html', 1440, 'dash-alerts', async (p) => {
  await p.click('.sidebar nav a[data-page="alerts"]');
});
await shot('/live/dashboard.html', 1440, 'dash-api', async (p) => {
  await p.click('.sidebar nav a[data-page="api"]');
});
await shot('/live/dashboard.html', 1440, 'dash-watch-modal', async (p) => {
  await p.click('.sidebar nav a[data-page="watches"]');
  await p.click('button.btn-primary');
});
await shot('/live/vanity.html', 1440, 'vanity-1440', async (p) => {
  await p.fill('#prefix', 'a');
  await p.click('#btnStart');
  await p.waitForTimeout(2500);
});
await shot('/live/vanity.html', 320, 'vanity-320');
await shot('/live/sell-demo.html', 1440, 'sell-1440');
await shot('/live/sell-demo.html', 320, 'sell-320');
await shot('/live/sell-demo.html', 1440, 'sell-error', async (p) => {
  await p.fill('#mint', 'notavalidmint');
  await p.click('#btn-quote');
  await p.waitForTimeout(1500);
});

await browser.close();
