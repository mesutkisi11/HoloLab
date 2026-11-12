// Geliştirme aracı: sayfayı başsız Chrome'da açar, konsol hatalarını toplar, ekran görüntüsü alır.
// Kullanım: node scripts/snap.mjs <çıktı.png> [url] [bekleme ms] [tuşlar: "e,space"]
import { chromium } from 'playwright-core';

const [out = 'snap.png', url = 'http://localhost:5173/', waitMs = '4000', keys = ''] = process.argv.slice(2);

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: [
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
  ],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const logs = [];
page.on('console', (m) => {
  if (m.type() === 'error') logs.push(`[${m.type()}] ${m.text()}`);
});
page.on('response', (r) => { if (r.status() >= 400) logs.push(`[http ${r.status()}] ${r.url()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

await page.goto(url);
await page.waitForTimeout(Number(waitMs));
for (const key of keys.split(',').filter(Boolean)) {
  await page.keyboard.press(key === 'space' ? 'Space' : key);
  await page.waitForTimeout(400);
}
await page.screenshot({ path: out });
console.log(logs.length ? logs.join('\n') : 'no console errors');
await browser.close();
