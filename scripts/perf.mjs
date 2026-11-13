// Geliştirme aracı: gerçek GPU ile sayfayı açar, senaryo boyunca 50 ms'den uzun kareleri ve uzun işleri kaydeder.
// Kullanım: node scripts/perf.mjs [url]
import { chromium } from 'playwright-core';

const url = process.argv[2] ?? 'http://localhost:5173/';
const browser = await chromium.launch({
  channel: 'chrome',
  headless: false,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--window-size=1400,900'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.addInitScript(() => {
  localStorage.setItem('hololab-tutorial-seen', '1');
  window.__perf = { frames: [], tasks: [], marks: [] };
  let last = performance.now();
  const loop = (t) => {
    const d = t - last;
    last = t;
    if (d > 50) window.__perf.frames.push([Math.round(t), Math.round(d)]);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__perf.tasks.push([Math.round(e.startTime), Math.round(e.duration)]))).observe({ type: 'longtask', buffered: true });
});
const mark = (name) => page.evaluate((n) => window.__perf.marks.push([Math.round(performance.now()), n]), name);
await page.goto(url);
await page.waitForTimeout(15000);
await mark('gallery-ready');
for (let i = 0; i < 6; i++) {
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(900);
}
await mark('browse-done');
await page.keyboard.press('ArrowLeft');
await page.waitForTimeout(900);
await mark('open');
await page.keyboard.press('Enter');
await page.waitForTimeout(6000);
await mark('play');
await page.keyboard.press('e');
await page.waitForTimeout(3000);
await page.keyboard.press('a');
await page.waitForTimeout(3000);
await mark('back');
await page.keyboard.press('Escape');
await page.waitForTimeout(3000);
const r = await page.evaluate(() => ({ ...window.__perf, fps: document.querySelector('.hud-telemetry')?.textContent }));
console.log('marks', JSON.stringify(r.marks));
console.log('slow frames', JSON.stringify(r.frames));
console.log('long tasks', JSON.stringify(r.tasks.filter((t) => t[1] > 80)));
console.log('hud', r.fps);
await browser.close();
