// Geliştirme aracı: sayfayı başsız Chrome'da açar, konsol hatalarını toplar, ekran görüntüsü alır.
// Kullanım: node scripts/snap.mjs <çıktı.png> [url] [bekleme ms] [tuşlar: "e,space"]
import { chromium } from 'playwright-core';

const [out = 'snap.png', url = 'http://localhost:5173/', waitMs = '4000', keys = '', drag = '', afterMs = '0'] =
  process.argv.slice(2);

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
await page.waitForTimeout(Number(afterMs));
// drag: "x1,y1,x2,y2" fare ile sürükleme (parça çekme testi)
if (drag) {
  const [x1, y1, x2, y2] = drag.split(',').map(Number);
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  for (let i = 1; i <= 20; i++) {
    await page.mouse.move(x1 + ((x2 - x1) * i) / 20, y1 + ((y2 - y1) * i) / 20);
    await page.waitForTimeout(30);
  }
  await page.waitForTimeout(300);
  await page.screenshot({ path: out.replace('.png', '-drag.png') });
  await page.mouse.up();
  await page.waitForTimeout(900);
}
await page.screenshot({ path: out });
console.log(logs.length ? logs.join('\n') : 'no console errors');
await browser.close();
